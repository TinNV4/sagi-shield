"""Rate limit + access log: the public API must brake abuse and must not log personal data."""
import logging
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import guard, main  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MIN", "3")
    guard._hits.clear()
    return TestClient(main.app)


def test_costly_routes_are_limited_per_client_and_reads_are_not(client):
    body = {"lang": "ja", "text": "こんにちは"}
    codes = [client.post("/check", json=body).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    assert client.post("/check", json=body, headers={"X-Forwarded-For": "203.0.113.9, 10.0.0.1"}).status_code == 200
    assert all(client.get("/healthz").status_code == 200 for _ in range(10))
    res = client.post("/check", json=body, headers={"Origin": "https://example.com"})
    assert res.status_code == 429 and res.headers["access-control-allow-origin"] and res.headers["retry-after"] == "60"


def test_window_slides():
    guard._hits.clear()
    import os
    os.environ["RATE_LIMIT_PER_MIN"] = "2"
    try:
        assert [guard.allow("k", now=t) for t in (0, 1, 2, 61.5)] == [True, True, False, True]
    finally:
        os.environ["RATE_LIMIT_PER_MIN"] = "0"


def test_websocket_handshake_is_limited(client):
    for _ in range(3):
        with client.websocket_connect("/ws/live?lang=ja&input=text"):
            pass
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect("/ws/live?lang=ja&input=text"):
            pass
    assert e.value.code == 1013


def test_access_log_has_no_personal_data(client, caplog):
    caplog.set_level(logging.INFO, logger="sagi.access")
    client.post("/check", json={"lang": "ja", "text": "090-1234-5678 から電話", "phone": "+81312345678"})
    client.get("/family/alerts?family_id=super-secret-family-id")
    text = caplog.text
    assert "POST /check 200" in text and "GET /family/alerts" in text
    assert not any(leak in text for leak in ("1234", "super-secret", "testclient", "family_id"))
