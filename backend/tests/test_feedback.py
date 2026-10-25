"""Feedback on a check: one answer per reporter, enum reasons only, App Check like /report."""
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.update(USE_LLM="0", STORE="memory", USE_WEBRISK="0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import appcheck, guard, main  # noqa: E402


def fake_status(token, consume=False):
    if not token:
        return "missing"
    if token == "used":
        return "replayed" if consume else "valid"
    return "valid" if token == "good" else "invalid"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(appcheck, "status", fake_status)
    monkeypatch.delenv("APPCHECK", raising=False)
    guard._hits.clear()
    main.store.__init__()
    yield TestClient(main.app)
    guard._hits.clear()


def test_feedback_is_stored_once_per_reporter_last_press_wins(client):
    vid = client.post("/check", json={"lang": "ja", "text": "こんにちは"}).json()["verdict_id"]
    assert client.post("/feedback", json={"verdict_id": vid, "correct": False, "reason": "missed", "lang": "ja", "reporter_id": "r1"}).status_code == 200
    assert client.post("/feedback", json={"verdict_id": vid, "correct": True, "lang": "ja", "reporter_id": "r1"}).status_code == 200
    stats = main.store.feedback_stats("2000-01-01T00:00:00+00:00")
    assert stats["checks"] == {"n": 1, "correct": 1}


def test_feedback_rejects_bad_ids_and_reasons(client):
    assert client.post("/feedback", json={"verdict_id": "nope", "correct": True, "lang": "ja"}).status_code == 422
    assert client.post("/feedback", json={"verdict_id": "0123456789abcdef", "correct": True, "reason": "because", "lang": "ja"}).status_code == 422


def test_feedback_needs_a_fresh_app_check_token_in_enforce(client, monkeypatch):
    monkeypatch.setenv("APPCHECK", "enforce")
    body = {"verdict_id": "0123456789abcdef", "correct": True, "lang": "ja"}
    assert client.post("/feedback", json=body).status_code == 403
    assert client.post("/feedback", json=body, headers={"X-Firebase-AppCheck": "good"}).status_code == 200
    assert client.post("/feedback", json=body, headers={"X-Firebase-AppCheck": "used"}).status_code == 403
