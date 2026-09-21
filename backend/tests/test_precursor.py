"""Cross-call memory: the set-up call of a two-call "it's me" scam asks for nothing; the money request comes later."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import main  # noqa: E402
import risk_engine as engine  # noqa: E402

SETUP = ["もしもし、俺だけど。", "携帯を水に落として壊れちゃって、番号が変わったんだ。", "風邪ひいて声が変だけど気にしないで。また明日電話する。"]
# the alarm latches on the second consecutive high update, so a realistic ask has more than one sentence
ASK = ["昨日話した件だけど、会社のお金を使い込んでしまって。", "今日中に200万円、振り込んでほしいんだ。", "同僚が取りに行くから、用意しておいてくれる？"]
ORDINARY_NEXT_DAY = ["お世話になっております。先日のお振込みの件で、確認のお電話です。"]


def say(ws, line):
    ws.send_json({"type": "transcript", "text": line, "final": True})
    return ws.receive_json()


def test_one_marker_is_ordinary_life_two_make_a_setup_call():
    t = engine.LiveTracker()
    assert not t.note_precursor(engine.precursor_hits("携帯の番号が変わったから登録しておいてね", "ja"))
    assert t.note_precursor(engine.precursor_hits("風邪ひいて声が変なんだ", "ja"))
    assert engine.precursor_hits("Con đây, mẹ khỏe không", "vi") == set()          # every call starts like this
    assert len(engine.precursor_hits("Con đổi số mới rồi, con bị cảm nên giọng hơi khác", "vi")) >= 2


def test_tracker_remembers_across_calls_and_the_model_can_still_veto():
    t = engine.LiveTracker()
    for line in SETUP:
        t.note_precursor(engine.precursor_hits(line, "ja"))
        score = t.update(engine.rule_stages(line, "ja"))
    assert t.precursor and score < 40                     # the set-up call itself stays quiet
    t.reset()
    assert t.prior_precursor and not t.precursor
    score = t.update(engine.rule_stages(ASK[1], "ja"))
    assert score >= 80                                    # money request after a set-up call
    fresh = engine.LiveTracker()
    assert fresh.update(engine.rule_stages(ASK[1], "ja")) < 40   # the same sentence with no history is one link
    vetoed = t.update({}, llm_score=5, llm_stage=0, llm_confidence=0.95)
    assert vetoed < 40                                    # soft floor: a real son sorting out a real transfer


def test_two_calls_on_one_kiosk_socket(monkeypatch):
    monkeypatch.setenv("USE_LLM", "0")
    with TestClient(main.app).websocket_connect("/ws/live?lang=ja") as ws:
        msgs = [say(ws, line) for line in SETUP]
        assert msgs[-1]["risk_level"] == "LOW" and msgs[-1]["precursor"] is True and "precursor" not in msgs[0]
        ws.send_json({"type": "reset"})
        assert ws.receive_json() == {"event": "session_reset"}
        msgs = [say(ws, line) for line in ASK]
        assert msgs[-1]["risk_level"] == "HIGH" and msgs[-1].get("speak")


def test_the_device_carries_the_flag_between_sockets(monkeypatch):
    monkeypatch.setenv("USE_LLM", "0")
    with TestClient(main.app).websocket_connect("/ws/live?lang=ja&prior=precursor") as ws:
        assert [say(ws, line) for line in ASK][-1]["risk_level"] == "HIGH"
    with TestClient(main.app).websocket_connect("/ws/live?lang=ja") as ws:
        assert [say(ws, line) for line in ASK][-1]["risk_level"] != "HIGH"   # no history, no alarm from one link
    with TestClient(main.app).websocket_connect("/ws/live?lang=ja&prior=precursor") as ws:
        assert say(ws, "来週の日曜日、みんなでご飯に行こうよ。")["risk_level"] == "LOW"  # memory alone accuses nobody


def test_quick_check_gives_the_callback_advice():
    out = TestClient(main.app).post("/check", json={"lang": "ja", "text": " ".join(SETUP)}).json()
    assert out["risk_level"] == "LOW" and "precursor_call" in out["evidence_flags"] and out["reasons"][0] == main.MSG["precursor"]["ja"]
    assert out["scam_type"] != "safe"


def test_model_flag_counts_only_for_a_call_that_asked_for_nothing():
    V = engine.LlmVerdict
    assert engine.is_setup_call(V(stage=1, scam_type="family_impersonation", confidence=0.8, reasons=[], risk=30, precursor=True))
    assert not engine.is_setup_call(V(stage=5, scam_type="fake_police", confidence=0.9, reasons=[], risk=95, precursor=True))  # a scam in progress
    assert not engine.is_setup_call(V(stage=0, scam_type="safe", confidence=0.9, reasons=[], risk=5, precursor=True))          # an ordinary family call
    assert not engine.is_setup_call(V(stage=1, scam_type="unknown", confidence=0.8, reasons=[], risk=30))
