"""Live Guard (text mode) over WebSocket: rules offline, LLM verdicts stubbed."""
import os
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.update(USE_LLM="0", STORE="memory")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import live, main  # noqa: E402

CALL = ["警視庁の者です", "あなたの口座が犯罪に使われています", "これからLINEで逮捕状を送ります"]


def say(ws, text, final=True):
    ws.send_json({"type": "transcript", "text": text, "final": final})


@pytest.fixture
def client():
    return TestClient(main.app)


def test_scam_call_escalates_and_speaks_once(client):
    with client.websocket_connect("/ws/live?lang=ja") as ws:
        levels = []
        for line in CALL:
            say(ws, line)
            levels.append(ws.receive_json())
        assert [m["risk_level"] for m in levels] == ["LOW", "MEDIUM", "MEDIUM"]   # hard combo seen once: not latched yet
        assert levels[2]["trigger_phrase"] and "speak" not in levels[2]
        say(ws, "すぐに確認してください")
        high = ws.receive_json()
        assert high["risk_level"] == "HIGH" and high["stage"] == 4 and "電話を切って" in high["speak"]
        say(ws, "もしもし")
        again = ws.receive_json()
        assert again["risk_level"] == "HIGH" and "speak" not in again and again["session_id"] == high["session_id"]


def test_benign_call_stays_low_and_interim_lines_are_ignored(client):
    with client.websocket_connect("/ws/live?lang=ja") as ws:
        say(ws, "警察です。LINEで逮捕状を", final=False)     # interim hypothesis: no reply, no state
        for line in ["もしもし母さん？", "LINEで写真送るね"]:
            say(ws, line)
            assert ws.receive_json()["risk_level"] == "LOW"


def test_numbers_are_masked_before_they_are_echoed(client):
    with client.websocket_connect("/ws/live?lang=ja") as ws:
        say(ws, "折り返し 03-1234-5678 までお電話ください")
        assert "1234" not in ws.receive_json()["transcript_tail"]


def test_manual_reset_and_silence_timeout_start_a_new_session(client, monkeypatch):
    monkeypatch.setenv("LIVE_SILENCE_S", "0.3")
    with client.websocket_connect("/ws/live?lang=ja") as ws:
        say(ws, "警察です。LINEで逮捕状を送ります")
        first = ws.receive_json()
        ws.send_json({"type": "reset"})
        assert ws.receive_json() == {"event": "session_reset"}
        say(ws, "もしもし")
        second = ws.receive_json()
        assert second["risk_level"] == "LOW" and second["session_id"] != first["session_id"]
        time.sleep(0.5)
        assert ws.receive_json() == {"event": "session_reset"}


def test_llm_is_asked_only_from_medium_and_can_lower_the_score(client, monkeypatch):
    asked = []

    def verdict(text, lang, backend=None, model=None):
        asked.append(text)
        return live.engine.LlmVerdict(stage=0, scam_type="safe", confidence=0.95, reasons=[])

    monkeypatch.setenv("USE_LLM", "1")
    monkeypatch.setattr(live.engine, "llm_verdict", verdict)
    with client.websocket_connect("/ws/live?lang=ja") as ws:
        say(ws, "今度の連休に帰るよ。ATMでお金おろしておくね")
        assert ws.receive_json()["risk_level"] == "LOW" and not asked          # tier 0 only
        say(ws, "警察です。落とし物の財布にキャッシュカードが入っていました。電話は 090-1234-5678 です")
        assert ws.receive_json()["risk_level"] == "MEDIUM"
        lowered = ws.receive_json()                                            # pushed when the verdict arrives
        assert lowered["risk_level"] == "LOW" and len(asked) == 1 and "1234" not in asked[0]


def test_unsupported_modes_are_refused(client):
    for q in ["lang=xx", "lang=ja&input=audio"]:
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/live?{q}") as ws:
                ws.receive_json()


def test_periodic_gate_consults_the_model_even_when_the_rules_are_silent(client, monkeypatch):
    # real recordings: a call the model scores 97 gets 0-50 from the rules - a rules-only gate never asks the judge
    asked = []

    def verdict(text, lang, backend=None, model=None):
        asked.append(text)
        return live.engine.LlmVerdict(stage=5, scam_type="family_impersonation", confidence=0.9, reasons=["x"], risk=95)

    monkeypatch.setenv("USE_LLM", "1")
    monkeypatch.setenv("LIVE_PERIODIC_S", "0")
    monkeypatch.setattr(live.engine, "llm_verdict", verdict)
    chat = ["もしもし、久しぶり。", "元気にしてた？", "ちょっと相談があってね。", "会社でトラブルがあって、助けてほしいんだ。", "詳しくはこれから話すよ。"]
    with client.websocket_connect("/ws/live?lang=ja&gate=rules") as ws:
        for line in chat:
            say(ws, line)
    assert asked == []                                  # strict privacy: nothing left the rules, nothing sent
    with client.websocket_connect("/ws/live?lang=ja") as ws:
        for line in chat:
            say(ws, line)
        levels = [ws.receive_json()["risk_level"] for _ in range(len(asked))]
    assert asked and "<PHONE>" not in asked[0] and levels    # the masked window reached the judge on the clock


def test_a_batch_of_unseen_lines_triggers_a_look_before_the_clock_does(client, monkeypatch):
    # a short call ends, and a fast talker fills the window, long before LIVE_PERIODIC_S has passed
    asked = []

    def verdict(text, lang, backend=None, model=None):
        asked.append(text.count("\n") + 1)
        return live.engine.LlmVerdict(stage=0, scam_type="safe", confidence=0.9, reasons=[], risk=5)

    monkeypatch.setenv("USE_LLM", "1")
    monkeypatch.setenv("LIVE_PERIODIC_S", "3600")
    monkeypatch.setenv("LIVE_LLM_EVERY_S", "0")
    monkeypatch.setattr(live.engine, "llm_verdict", verdict)
    with client.websocket_connect("/ws/live?lang=ja") as ws:
        for i in range(11):
            say(ws, f"今日はいい天気ですね、その{i}。")
            time.sleep(0.05)
    assert asked[:2] == [4, 10]                         # first look at 4 lines, the next one 6 lines later
