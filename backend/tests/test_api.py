"""API tests: rules only, in-memory store, Google services stubbed.  Run: python -m pytest tests -q"""
import io
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

os.environ.update(USE_LLM="0", STORE="memory", USE_WEBRISK="0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import main, services  # noqa: E402

SCAM = "警察です。口座が犯罪に使われています。LINEで逮捕状を送ります"
CONTRACT = {"risk_score", "risk_level", "stage", "scam_type", "reasons", "advice", "hotlines",
            "evidence_flags", "rule_hits", "community_hits"}


_analyze = main.analyze


def rules_only(text, lang, use_llm, bonus=0):
    """Media paths need USE_LLM=1 to reach the (stubbed) services; keep the text engine offline."""
    return _analyze(text, lang, use_llm=False, bonus=bonus)


@pytest.fixture
def client():
    main.store.__init__()
    return TestClient(main.app)


def png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), "white").save(buf, "PNG")
    return buf.getvalue()


def test_check_json_matches_the_contract(client):
    r = client.post("/check", json={"text": SCAM, "lang": "ja"})
    assert r.status_code == 200 and set(r.json()) == CONTRACT
    body = r.json()
    assert body["risk_level"] == "HIGH" and body["hotlines"] == ["#9110", "188"] and 1 <= len(body["reasons"]) <= 2


def test_check_multipart_and_vietnamese(client):
    r = client.post("/check", data={"lang": "vi", "text": "Tôi là công an quận, kết bạn Zalo để nhận lệnh bắt."})
    assert r.json()["risk_level"] == "HIGH" and r.json()["hotlines"] == ["113"]


def test_benign_text_is_low_and_never_says_safe(client):
    body = client.post("/check", json={"text": "宅配便です。再配達の時間を教えてください。"}).json()
    assert body["risk_level"] == "LOW" and body["reasons"] == [] and "公式" in body["advice"]


def test_evidence_flags_add_a_bonus_and_raw_numbers_never_come_back(client):
    plain = client.post("/check", json={"text": "警察です。口座が犯罪に使われています。"}).json()
    flagged = client.post("/check", json={"text": "警察です。口座が犯罪に使われています。",
                                          "phone": "+44 20 7946 0000", "url": "https://mufg-secure.top/login"}).json()
    assert flagged["risk_score"] == plain["risk_score"] + 25
    assert {"international_number", "url_lookalike"} <= set(flagged["evidence_flags"])
    assert "7946" not in str(flagged)


def test_validation(client):
    assert client.post("/check", json={"lang": "ja"}).status_code == 422
    assert client.post("/check", json={"text": "hi", "lang": "xx"}).status_code == 422
    bad = {"content-type": "application/json"}
    assert client.post("/check", content="{\"text\":\"警察\"}".encode("cp932"), headers=bad).status_code == 422
    assert client.post("/check", content=b"[1]", headers=bad).status_code == 422
    assert client.post("/check", data={"lang": "ja"}, files={"image": ("x.png", b"not an image")}).status_code == 422


def test_unanalyzed_file_is_never_reported_as_low(client):
    # seen on Cloud Run: transcription 404 -> "LOW, no danger found" for a scam call nobody had listened to
    res = client.post("/check", data={"lang": "ja"}, files={"image": ("x.png", png(), "image/png")})
    assert res.status_code == 503
    res = client.post("/check", data={"lang": "ja"}, files={"audio": ("x.wav", b"RIFF....", "audio/wav")})
    assert res.status_code == 503
    # with other evidence the check still runs, and says what it could not look at
    body = client.post("/check", data={"lang": "ja", "text": "こんにちは"}, files={"image": ("x.png", png(), "image/png")}).json()
    assert body["risk_level"] == "LOW" and "image_not_analyzed" in body["evidence_flags"]


def test_warrant_image_is_high_by_rule(client, monkeypatch):
    monkeypatch.setenv("USE_LLM", "1")
    monkeypatch.setattr(services, "describe_image", lambda jpeg: services.ImageVerdict(doc_type="arrest_warrant", ocr_text="逮捕状"))
    monkeypatch.setattr(main, "analyze", rules_only)
    body = client.post("/check", data={"lang": "ja"}, files={"image": ("w.png", png(), "image/png")}).json()
    assert body["risk_level"] == "HIGH" and body["scam_type"] == "fake_police"
    assert "image_arrest_warrant" in body["evidence_flags"] and "逮捕状" in body["reasons"][0]


def test_audio_transcript_feeds_the_engine(client, monkeypatch):
    monkeypatch.setenv("USE_LLM", "1")
    monkeypatch.setattr(services, "transcribe_audio", lambda data, mime, lang: SCAM)
    monkeypatch.setattr(main, "analyze", rules_only)
    body = client.post("/check", data={"lang": "ja"}, files={"audio": ("c.wav", b"RIFF", "audio/wav")}).json()
    assert body["risk_level"] == "HIGH" and "audio_not_analyzed" not in body["evidence_flags"]


def test_webrisk_hit_is_high(client, monkeypatch):
    monkeypatch.setenv("USE_WEBRISK", "1")
    monkeypatch.setattr(services, "webrisk_threats", lambda url: ["social_engineering"])
    body = client.post("/check", json={"url": "https://example.com/x"}).json()
    assert body["risk_level"] == "HIGH" and "url_webrisk_social_engineering" in body["evidence_flags"]


@pytest.mark.parametrize("payload, expected", [
    ({"reason_text": "貯金を安全な口座に移すように言われました", "who_asked": "police"}, "HIGH"),
    ({"reason_text": "手数料を先に払う必要があると言われた", "who_asked": "bank", "recipient_type": "person"}, "HIGH"),
    ({"reason_text": "当選金の受け取りに必要と言われた", "who_asked": "stranger"}, "HIGH"),
    ({"reason_text": "還付の手続きと言われた", "who_asked": "government", "recipient_type": "person", "amount": "30万円"}, "HIGH"),
    ({"reason_text": "必ず儲かる投資と言われた", "who_asked": "broker", "amount": ""}, "HIGH"),
    ({"reason_text": "甥の大学の授業料を大学に支払います", "who_asked": "family", "recipient_type": "company"}, "LOW"),
])
def test_precheck(client, payload, expected):
    r = client.post("/precheck", json=payload)
    assert r.status_code == 200 and set(r.json()) == CONTRACT and r.json()["risk_level"] == expected


def test_report_needs_consent_and_feeds_community_hits_and_stats(client):
    report = {"scam_type": "fake_police", "phone": "+44 20 7946 0000", "keywords": ["LINE"], "prefecture": "長野県"}
    assert client.post("/report", json={**report, "consent": False}).status_code == 400
    for who in ("app-a", "app-b"):
        assert client.post("/report", json={**report, "consent": True, "reporter_id": who}).json() == {"ok": True}
    assert all("7946" not in str(r) and "app-" not in str(r) for r in main.store.reports)  # only HMACs are kept
    assert client.post("/check", json={"phone": "+442079460000"}).json()["community_hits"] == 2
    client.post("/check", json={"text": SCAM})
    s = client.get("/stats").json()
    assert s["total_checks"] == 2 and s["high_risk"] == 1
    assert s["by_type"] == {"fake_police": 2} and s["by_region"] == {"長野県": 2} and s["trend"][0]["count"] == 2


def test_rule_verdict_never_keeps_a_safe_label(client, monkeypatch):
    # seen on Cloud Run: Web Risk hit -> HIGH, but scam_type stayed "safe" next to "no sign of a scam"
    monkeypatch.setenv("USE_WEBRISK", "1")
    monkeypatch.setattr(services, "webrisk_threats", lambda url: ["SOCIAL_ENGINEERING"])
    monkeypatch.setattr(main, "analyze", lambda *a, **k: {"risk_score": 2, "risk_level": "LOW", "scam_type": "safe", "stage": 0,
                                                          "reasons": ["no sign of a scam"], "advice": "", "hotlines": []})
    out = client.post("/check", json={"lang": "ja", "text": "見てください", "url": "http://bad.example"}).json()
    assert out["risk_level"] == "HIGH" and out["scam_type"] == "unknown" and out["reasons"] == [main.MSG["webrisk"]["ja"]]
    assert client.get("/health").json()["ok"] and client.get("/healthz").json()["ok"]


def test_transcription_reads_the_right_field_and_falls_back_in_order(monkeypatch):
    from types import SimpleNamespace as NS

    def response(heard=None, text=None):
        part = NS(audio_transcription=NS(text=heard) if heard else None)
        return NS(candidates=[NS(content=NS(parts=[part]))], text=text, prompt_feedback="block_reason=SAFETY")

    # 1. the transcribe model answers in parts[].audio_transcription, not in .text (found 2026-09-21)
    client = NS(models=NS(generate_content=lambda **kw: response(heard="もしもし")))
    monkeypatch.setattr(services, "_stt_clients", lambda: iter([client]))
    assert services.transcribe_audio(b"RIFF", "audio/wav", "ja") == "もしもし"
    # 2. transcribe model 404 everywhere, general model blocked for SAFETY -> Chirp 3
    def not_found(**kw):
        err = RuntimeError("404"); err.code = 404
        raise err
    calls = []
    monkeypatch.setitem(services._stt, "client", None)
    monkeypatch.setattr(services, "_stt_clients", lambda: iter([NS(models=NS(generate_content=lambda **kw: (calls.append(1), not_found())[1]))] * 2))
    monkeypatch.setattr(services, "_generate", lambda **kw: response())
    monkeypatch.setattr(services, "transcribe_chirp", lambda data, lang: f"chirp:{lang}")
    assert services.transcribe_audio(b"RIFF", "audio/wav", "vi") == "chirp:vi" and len(calls) == 2


def test_missing_llm_verdict_is_flagged_not_hidden(client, monkeypatch):
    # seen on Cloud Run: Gemini 429 -> rules only -> an ore-ore call came back "LOW / safe" with no hint
    import risk_engine
    monkeypatch.setenv("USE_LLM", "1")
    monkeypatch.setattr(risk_engine, "llm_verdict", lambda text, lang, backend=None, model=None: None)
    monkeypatch.setattr(main, "analyze", risk_engine.analyze)
    out = client.post("/check", json={"lang": "ja", "text": "母さん、俺だけど。今日中に300万必要なんだ"}).json()
    assert "llm_unavailable" in out["evidence_flags"] and out["scam_type"] != "safe"


def test_phone_number_signals(client):
    # seen on Cloud Run: an overseas number came back "LOW / safe", and community reports did not move the score
    abroad = client.post("/check", json={"lang": "ja", "phone": "+44 20 7946 0000"}).json()
    assert abroad["risk_level"] == "MEDIUM" and abroad["reasons"][0] == main.MSG["intl_number"]["ja"]
    fresh = client.post("/check", json={"lang": "ja", "phone": "03-3210-0000"}).json()
    assert fresh["risk_level"] == "LOW" and fresh["scam_type"] == "unknown" and fresh["reasons"][0] == main.MSG["phone_no_reports"]["ja"]
    for _ in range(5):  # one person reporting five times is still one reporter
        client.post("/report", json={"scam_type": "fake_police", "phone": "03-3210-0000", "consent": True, "reporter_id": "app-1"})
    assert client.post("/check", json={"lang": "ja", "phone": "03-3210-0000"}).json()["community_hits"] == 1
    for n, expected in ((2, "MEDIUM"), (3, "HIGH")):
        client.post("/report", json={"scam_type": "fake_police", "phone": "03-3210-0000", "consent": True, "reporter_id": f"app-{n}"})
        out = client.post("/check", json={"lang": "ja", "phone": "03 3210 0000"}).json()  # same number, typed differently
        assert (out["community_hits"], out["risk_level"]) == (n, expected)
    assert "3" in out["reasons"][0] and "3210" not in str(out)


def test_url_shape_counts_without_a_model(client):
    lookalike = client.post("/check", json={"lang": "ja", "url": "https://smbc-card-kakunin.top/login"}).json()
    assert lookalike["risk_level"] == "HIGH" and lookalike["reasons"][0] == main.MSG["url_lookalike"]["ja"]
    short = client.post("/check", json={"lang": "ja", "url": "https://bit.ly/3abcd"}).json()
    assert short["risk_level"] == "MEDIUM" and short["reasons"][0] == main.MSG["url_odd"]["ja"]
    assert client.post("/check", json={"lang": "ja", "url": "https://www.npa.go.jp/"}).json()["risk_level"] == "LOW"


def test_katakana_long_vowel_survives_normalisation(client):
    # regression: every "ー" used to become "-", so キャッシュカード / マネーロンダリング never matched through /check
    from input_layer import normalize_text
    assert normalize_text("キャッシュカード 03ー1234ー5678") == "キャッシュカード 03-1234-5678"
    out = client.post("/check", json={"lang": "ja", "text": "警察です。マネーロンダリングの疑いです。キャッシュカードを預かります"}).json()
    assert out["risk_level"] == "HIGH"
