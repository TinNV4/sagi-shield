"""The verdict log: every look and every check leaves a record that says why - and never the text."""
import json
import os
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

os.environ.update(USE_LLM="0", STORE="memory")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import live, main, verdict_log  # noqa: E402


def read(path):
    return [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]


def test_record_drops_text_unless_asked(monkeypatch):
    monkeypatch.delenv("LOG_TEXT", raising=False)
    assert "text" not in verdict_log.record("check", text="警察です", score=10)
    monkeypatch.setenv("LOG_TEXT", "1")
    assert verdict_log.record("check", text="警察です")["text"] == "警察です"


def test_check_writes_why(tmp_path, monkeypatch):
    monkeypatch.setenv("VERDICT_LOG", str(tmp_path / "v.jsonl"))
    r = TestClient(main.app).post("/check", json={"text": "警察です。口座が犯罪に使われています。LINEで逮捕状を送ります", "lang": "ja"})
    assert r.status_code == 200
    recs = read(tmp_path / "v.jsonl")
    rec = recs[-1]
    assert rec["kind"] == "check" and rec["level"] == "HIGH" and "AUTHORITY" in rec["rules"]["hits"]
    assert rec["llm_used"] is False and "text" not in rec and "逮捕状を送ります" not in json.dumps(rec, ensure_ascii=False)


def test_live_look_records_rules_verdict_and_fusion(tmp_path, monkeypatch):
    def verdict(text, lang, backend=None, model=None, context=None):
        return live.engine.LlmVerdict(stage=5, scam_type="fake_police", confidence=0.9, reasons=["警察を名乗り送金を求めている"], risk=95)

    monkeypatch.setenv("USE_LLM", "1")
    monkeypatch.setenv("LIVE_PERIODIC_S", "0")
    monkeypatch.setenv("LIVE_LLM_EVERY_S", "0")
    monkeypatch.setenv("VERDICT_LOG", str(tmp_path / "v.jsonl"))
    monkeypatch.setattr(live.engine, "llm_verdict", verdict)
    with TestClient(main.app).websocket_connect("/ws/live?lang=ja") as ws:
        for line in ["警察です。", "口座が犯罪に使われています。", "LINEで逮捕状を送ります。", "振り込んでください。", "急いで。"]:
            ws.send_json({"type": "transcript", "text": line, "final": True})
            time.sleep(0.05)
        time.sleep(0.4)
    looks = [r for r in read(tmp_path / "v.jsonl") if r["kind"] == "live_look"]
    assert looks, "every look leaves a record"
    rec = looks[-1]
    assert rec["trigger"] in ("rules", "clock", "lines") and rec["gate"] == "periodic"
    assert rec["llm"]["scam_type"] == "fake_police" and rec["llm"]["reasons"] and rec["llm"]["model"]
    assert rec["rules"]["hits"] and rec["score"] >= 70 and rec["level"] == "HIGH" and "latency_ms" in rec
    assert "text" not in rec and "call_state" in rec        # state travels, transcript does not
