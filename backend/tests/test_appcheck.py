"""App Check: checks are throttled, never refused, without a token; reports need a fresh limited-use token."""
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import appcheck, guard, main

CHECK = {"lang": "ja", "text": "こんにちは"}
REPORT = {"lang": "ja", "scam_type": "fake_police", "consent": True, "reporter_id": "r1"}


def fake_status(token, consume=False):
    """'good' verifies; 'used' is a limited-use token that was already consumed; anything else is a forgery."""
    if not token:
        return "missing"
    if token == "used":
        return "replayed" if consume else "valid"
    return "valid" if token == "good" else "invalid"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MIN", "30")
    monkeypatch.setenv("RATE_LIMIT_UNVERIFIED_PER_MIN", "2")
    monkeypatch.setattr(appcheck, "status", fake_status)
    guard._hits.clear()
    main.store.__init__()
    yield TestClient(main.app)
    guard._hits.clear()


def test_off_by_default_changes_nothing(client, monkeypatch):
    monkeypatch.delenv("APPCHECK", raising=False)
    assert [client.post("/check", json=CHECK).status_code for _ in range(4)] == [200] * 4
    assert client.post("/report", json=REPORT).status_code == 200


def test_monitor_only_logs(client, monkeypatch, caplog):
    monkeypatch.setenv("APPCHECK", "monitor")
    with caplog.at_level("INFO"):
        assert [client.post("/check", json=CHECK).status_code for _ in range(4)] == [200] * 4
        assert client.post("/report", json=REPORT).status_code == 200
    assert "ac=missing" in caplog.text


def test_enforce_throttles_unverified_checks_but_answers_them(client, monkeypatch):
    monkeypatch.setenv("APPCHECK", "enforce")
    assert [client.post("/check", json=CHECK).status_code for _ in range(3)] == [200, 200, 429]
    guard._hits.clear()
    signed = {appcheck.HEADER: "good"}
    assert [client.post("/check", json=CHECK, headers=signed).status_code for _ in range(4)] == [200] * 4
    guard._hits.clear()
    forged = {appcheck.HEADER: "forged"}
    assert [client.post("/check", json=CHECK, headers=forged).status_code for _ in range(3)] == [200, 200, 429]


def test_enforce_reads_the_socket_token_from_the_query(client, monkeypatch):
    monkeypatch.setenv("APPCHECK", "enforce")
    for _ in range(4):
        with client.websocket_connect("/ws/live?lang=ja&input=text&appcheck=good"):
            pass
    guard._hits.clear()
    for _ in range(2):
        with client.websocket_connect("/ws/live?lang=ja&input=text"):
            pass
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect("/ws/live?lang=ja&input=text"):
            pass
    assert e.value.code == 1013


def test_enforce_refuses_reports_without_a_fresh_token(client, monkeypatch):
    monkeypatch.setenv("APPCHECK", "enforce")
    assert client.post("/report", json=REPORT).status_code == 403
    assert client.post("/report", json=REPORT, headers={appcheck.HEADER: "used"}).status_code == 403  # replayed
    assert client.post("/report", json=REPORT, headers={appcheck.HEADER: "good"}).status_code == 200
    assert len(main.store.reports) == 1


def test_status_maps_the_sdk_results(monkeypatch):
    from firebase_admin import app_check
    monkeypatch.setattr(appcheck, "_app", lambda: object())

    def verify(token, app=None, consume=False):
        if token == "expired":
            raise ValueError("Verifying App Check token failed")
        if token == "offline":
            raise ConnectionError("jwks")
        return {"sub": "app", **({"already_consumed": token == "seen"} if consume else {})}

    monkeypatch.setattr(app_check, "verify_token", verify)
    assert appcheck.status(None) == "missing"
    assert appcheck.status("ok") == "valid"
    assert appcheck.status("expired") == "invalid"
    assert appcheck.status("offline") == "error"
    assert appcheck.status("fresh", consume=True) == "valid"
    assert appcheck.status("seen", consume=True) == "replayed"


def test_unknown_mode_is_off(monkeypatch):
    monkeypatch.setenv("APPCHECK", "Enforce ")
    assert appcheck.mode() == "enforce"
    monkeypatch.setenv("APPCHECK", "strict")
    assert appcheck.mode() == "off"
