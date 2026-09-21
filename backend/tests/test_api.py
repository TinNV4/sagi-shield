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


def test_image_without_llm_is_flagged_not_failed(client):
    body = client.post("/check", data={"lang": "ja"}, files={"image": ("x.png", png(), "image/png")}).json()
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
    monkeypatch.setattr(services, "transcribe_audio", lambda data, mime: SCAM)
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
    for _ in range(2):
        assert client.post("/report", json={**report, "consent": True}).json() == {"ok": True}
    assert all("7946" not in str(r) for r in main.store.reports)          # only the HMAC is kept
    assert client.post("/check", json={"phone": "+442079460000"}).json()["community_hits"] == 2
    client.post("/check", json={"text": SCAM})
    s = client.get("/stats").json()
    assert s["total_checks"] == 2 and s["high_risk"] == 1
    assert s["by_type"] == {"fake_police": 2} and s["by_region"] == {"長野県": 2} and s["trend"][0]["count"] == 2


def test_katakana_long_vowel_survives_normalisation(client):
    # regression: every "ー" used to become "-", so キャッシュカード / マネーロンダリング never matched through /check
    from input_layer import normalize_text
    assert normalize_text("キャッシュカード 03ー1234ー5678") == "キャッシュカード 03-1234-5678"
    out = client.post("/check", json={"lang": "ja", "text": "警察です。マネーロンダリングの疑いです。キャッシュカードを預かります"}).json()
    assert out["risk_level"] == "HIGH"
