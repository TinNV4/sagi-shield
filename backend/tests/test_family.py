"""Family pairing + guardian alerts: in-memory store, no FCM."""
import os
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.update(USE_LLM="0", STORE="memory")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import main  # noqa: E402


@pytest.fixture
def client():
    main.store.__init__()
    return TestClient(main.app)


def pair(client, **link):
    fam = client.post("/family/code", json={"member_name": "Mom"}).json()
    linked = client.post("/family/link", json={"pair_code": fam["pair_code"], "guardian_name": "Taro", **link})
    return fam, linked


def test_pairing_is_single_use_and_expires(client):
    fam, linked = pair(client)
    assert len(fam["pair_code"]) == 6 and linked.json()["family_id"] == fam["family_id"]
    assert linked.json()["member_name"] == "Mom"
    assert client.post("/family/link", json={"pair_code": fam["pair_code"]}).status_code == 404      # used
    fam2 = client.post("/family/code", json={}).json()
    main.store.families[fam2["family_id"]]["code_expires"] = time.time() - 1
    assert client.post("/family/link", json={"pair_code": fam2["pair_code"]}).status_code == 404     # expired
    assert client.post("/family/link", json={"pair_code": "000000"}).status_code == 404


def test_pair_code_accepts_the_dashed_form_shown_in_the_ui(client):
    fam = client.post("/family/code", json={}).json()
    dashed = fam["pair_code"][:3] + "-" + fam["pair_code"][3:]
    assert client.post("/family/link", json={"pair_code": dashed}).status_code == 200


def test_existing_family_gets_a_fresh_code_and_keeps_its_guardians(client):
    fam, _ = pair(client)
    again = client.post("/family/code", json={"family_id": fam["family_id"]}).json()
    assert again["family_id"] == fam["family_id"] and again["guardians"] == ["Taro"]
    assert client.post("/family/link", json={"pair_code": again["pair_code"], "guardian_name": "Hana"}).status_code == 200


def test_alerts_need_the_family_secret(client):
    assert client.get("/family/alerts", params={"family_id": "nope"}).status_code == 404
    assert client.post("/family/notify", json={"family_id": "nope", "risk_level": "HIGH"}).status_code == 404


def test_notify_my_family_from_a_result(client):
    fam, _ = pair(client)
    result = client.post("/check", json={"text": "警察です。口座が犯罪に使われています。LINEで逮捕状を送ります"}).json()
    sent = client.post("/family/notify", json={"family_id": fam["family_id"], **{k: result[k] for k in
                       ("risk_level", "scam_type", "stage", "reasons")}})
    assert sent.status_code == 200
    alert = client.get("/family/alerts", params={"family_id": fam["family_id"]}).json()[0]
    assert alert["risk_level"] == "HIGH" and alert["member_name"] == "Mom" and alert["stage"] == 4
    assert alert["summary"] == result["reasons"][0] and set(alert) == {
        "id", "created_at", "member_name", "risk_level", "scam_type", "stage", "summary"}


def test_live_high_alerts_the_family_once_and_stores_no_transcript(client):
    fam, _ = pair(client)
    with client.websocket_connect(f"/ws/live?lang=ja&family_id={fam['family_id']}") as ws:
        for line in ["警視庁の者です。電話番号は 03-1234-5678 です", "これからLINEで逮捕状を送ります", "すぐに確認してください", "もしもし"]:
            ws.send_json({"type": "transcript", "text": line, "final": True})
            ws.receive_json()
    alerts = client.get("/family/alerts", params={"family_id": fam["family_id"]}).json()
    assert len(alerts) == 1 and alerts[0]["risk_level"] == "HIGH"
    assert "1234" not in str(alerts) and "警視庁の者です" not in str(alerts)


def test_push_failure_does_not_lose_the_alert(client):
    fam, _ = pair(client, fcm_token="not-a-real-token")     # firebase_admin missing / unconfigured here
    assert client.post("/family/notify", json={"family_id": fam["family_id"], "risk_level": "HIGH",
                                               "reasons": ["r"]}).status_code == 200
    assert len(client.get("/family/alerts", params={"family_id": fam["family_id"]}).json()) == 1


@pytest.fixture
def sent(monkeypatch):
    """A stand-in for firebase_admin.messaging that records the multicast instead of sending it."""
    from types import SimpleNamespace
    from app import notifier
    out = []
    fake = SimpleNamespace(MulticastMessage=lambda **kw: kw, Notification=lambda **kw: kw, WebpushConfig=lambda **kw: kw,
                           send_each_for_multicast=lambda m: out.append(m))
    monkeypatch.setattr(notifier, "_messaging", lambda: fake)
    return out


def test_a_paired_guardian_can_turn_on_push_later(client, sent):
    fam, _ = pair(client)                                      # paired before notifications existed: no token
    for _ in range(2):                                         # the same browser asking twice stores one token
        assert client.post("/family/push", json={"family_id": fam["family_id"], "fcm_token": "tok-browser-1"}).status_code == 200
    client.post("/family/notify", json={"family_id": fam["family_id"], "risk_level": "HIGH", "reasons": ["警察を名乗る電話"]})
    assert len(sent) == 1 and sent[0]["tokens"] == ["tok-browser-1"]
    assert sent[0]["notification"]["body"] == "警察を名乗る電話" and sent[0]["webpush"]["headers"]["Urgency"] == "high"


def test_push_goes_to_pairing_tokens_and_later_tokens_once_each(client, sent):
    fam, _ = pair(client, fcm_token="tok-a")
    client.post("/family/push", json={"family_id": fam["family_id"], "fcm_token": "tok-a"})
    client.post("/family/push", json={"family_id": fam["family_id"], "fcm_token": "tok-b"})
    client.post("/family/notify", json={"family_id": fam["family_id"], "risk_level": "HIGH", "reasons": ["r"]})
    assert sent[0]["tokens"] == ["tok-a", "tok-b"]


def test_push_needs_a_known_family(client):
    assert client.post("/family/push", json={"family_id": "x" * 22, "fcm_token": "tok"}).status_code == 404
