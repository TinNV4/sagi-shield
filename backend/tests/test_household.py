"""Households: routes behind Firebase sign-in (fake tokens), in-memory store."""
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.update(USE_LLM="0", STORE="memory", AUTH="fake")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import main  # noqa: E402


@pytest.fixture
def sent(monkeypatch):
    """A stand-in for firebase_admin.messaging that records the multicast: the suite never reaches real FCM."""
    from types import SimpleNamespace
    from app import notifier
    out = []
    fake = SimpleNamespace(MulticastMessage=lambda **kw: kw, Notification=lambda **kw: kw, WebpushConfig=lambda **kw: kw,
                           send_each_for_multicast=lambda m: out.append(m))
    monkeypatch.setattr(notifier, "_messaging", lambda: fake)
    return out


@pytest.fixture
def client(sent):
    main.store.__init__()
    return TestClient(main.app)


def H(tok):
    return {"Authorization": f"Bearer fake:{tok}"}


DEV, G1, G2 = "d1:anonymous", "g1:google.com", "g2:phone"


def test_device_starts_household_guardian_joins_and_reads_alerts(client):
    h = client.post("/household", json={"member_name": "Mom", "market": "ja"}, headers=H(DEV)).json()
    assert h["household"]["devices"] == 1 and h["household"]["guardians"] == []
    j = client.post("/household/join", json={"pair_code": h["pair_code"], "name": "Taro", "fcm_token": "t"}, headers=H(G1))
    assert j.status_code == 200 and j.json()["household"]["guardians"] == [{"name": "Taro", "owner": True, "me": True}]
    hid = h["household_id"]
    assert client.get(f"/household/{hid}/alerts", headers=H(G1)).json() == []
    assert client.get(f"/household/{hid}/alerts", headers=H(G2)).status_code == 403
    assert client.get(f"/household/{hid}/alerts").status_code == 401
    sent = client.post(f"/household/{hid}/notify", json={"risk_level": "HIGH", "scam_type": "fake_police", "stage": 4,
                       "reasons": ["警察を名乗り…"], "lang": "ja"}, headers=H(DEV))
    assert sent.status_code == 200
    alerts = client.get(f"/household/{hid}/alerts", headers=H(G1)).json()
    assert alerts[0]["summary"] == "警察を名乗り…" and alerts[0]["member_name"] == "Mom"
    assert "uid" not in str(client.get("/household", headers=H(G1)).json())


def test_guardian_starts_household_device_joins(client):
    h = client.post("/household", json={"name": "Grandma", "market": "vi"}, headers=H(G1)).json()
    assert h["household"]["guardians"][0]["owner"] is True
    assert client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(DEV)).json()["household"]["devices"] == 1
    assert client.get("/household", headers=H(DEV)).json()[0]["household_id"] == h["household_id"]


def test_wrong_or_used_code_is_404_and_code_refresh_needs_membership(client):
    h = client.post("/household", json={"market": "ja"}, headers=H(DEV)).json()
    assert client.post("/household/join", json={"pair_code": "000000"}, headers=H(G1)).status_code == 404
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1))
    assert client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G2)).status_code == 404
    assert client.post(f"/household/{h['household_id']}/code", json={}, headers=H(G2)).status_code == 403
    fresh = client.post(f"/household/{h['household_id']}/code", json={}, headers=H(G1)).json()
    assert len(fresh["pair_code"]) == 6 and fresh["pair_code"] != h["pair_code"]


def test_market_is_validated(client):
    assert client.post("/household", json={"market": "en"}, headers=H(DEV)).status_code == 422


def test_push_is_guardian_only_and_delete_is_owner_only(client):
    h = client.post("/household", json={"market": "ja"}, headers=H(DEV)).json(); hid = h["household_id"]
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1))
    assert client.post(f"/household/{hid}/push", json={"fcm_token": "x"}, headers=H(DEV)).status_code == 403
    assert client.post(f"/household/{hid}/push", json={"fcm_token": "x"}, headers=H(G1)).status_code == 200
    assert client.delete(f"/household/{hid}", headers=H(DEV)).status_code == 403
    assert client.delete(f"/household/{hid}", headers=H(G1)).status_code == 200
    assert client.get(f"/household/{hid}/alerts", headers=H(G1)).status_code == 404


def test_a_guardian_watches_two_households(client):
    a = client.post("/household", json={"member_name": "Mom", "market": "ja"}, headers=H("da:anonymous")).json()
    b = client.post("/household", json={"member_name": "Dad", "market": "ja"}, headers=H("db:anonymous")).json()
    for h in (a, b):
        assert client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1)).status_code == 200
    mine = client.get("/household", headers=H(G1)).json()
    assert sorted(x["member_name"] for x in mine) == ["Dad", "Mom"]
    client.post(f"/household/{b['household_id']}/notify", json={"risk_level": "HIGH", "lang": "ja"}, headers=H("db:anonymous"))
    assert client.get(f"/household/{a['household_id']}/alerts", headers=H(G1)).json() == []
    assert len(client.get(f"/household/{b['household_id']}/alerts", headers=H(G1)).json()) == 1


def test_owner_cannot_leave_but_can_hand_over(client):
    h = client.post("/household", json={"market": "ja"}, headers=H(G1)).json(); hid = h["household_id"]
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G2))
    assert client.delete(f"/household/{hid}/guardians/g1", headers=H(G1)).status_code == 409
    assert client.delete(f"/household/{hid}/guardians/g1", headers=H(G2)).status_code == 403    # not the owner
    assert client.post(f"/household/{hid}/owner", json={"uid": "g2"}, headers=H(G2)).status_code == 403
    assert client.post(f"/household/{hid}/owner", json={"uid": "g2"}, headers=H(G1)).status_code == 200
    assert client.delete(f"/household/{hid}/guardians/g1", headers=H(G1)).status_code == 200      # now a plain guardian leaving
    detail = client.get(f"/household/{hid}", headers=H(G2)).json()
    assert detail["guardians"] == [{"uid": "g2", "name": "", "owner": True, "me": True}]


def test_admin_reassigns_a_lost_owner(client):
    h = client.post("/household", json={"market": "ja"}, headers=H(G1)).json(); hid = h["household_id"]
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G2))
    assert client.post(f"/admin/household/{hid}/owner", json={"uid": "g2"}, headers=H(G2)).status_code == 403
    assert client.post(f"/admin/household/{hid}/owner", json={"uid": "g2"}, headers=H("root:google.com:admin")).status_code == 200
    assert client.post(f"/admin/household/{hid}/owner", json={"uid": "zz"}, headers=H("root:google.com:admin")).status_code == 404
    assert client.get(f"/household/{hid}/alerts", headers=H("root:google.com:admin")).status_code == 403  # admin is not a member


def _two_guardians(client, **kw):
    h = client.post("/household", json={"member_name": "Mom", "market": "ja"}, headers=H(DEV)).json()
    client.post("/household/join", json={"pair_code": h["pair_code"], **kw}, headers=H(G1))
    code = client.post(f"/household/{h['household_id']}/code", json={}, headers=H(G1)).json()["pair_code"]
    client.post("/household/join", json={"pair_code": code}, headers=H(G2))
    return h["household_id"]


def _notify(client, hid):
    return client.post(f"/household/{hid}/notify", json={"risk_level": "HIGH", "reasons": ["r"], "lang": "ja"}, headers=H(DEV))


def test_a_removed_guardian_stops_receiving_alerts(client, sent):
    hid = _two_guardians(client)
    for tok, who in (("tok-g1", G1), ("tok-g2", G2)):
        assert client.post(f"/household/{hid}/push", json={"fcm_token": tok}, headers=H(who)).status_code == 200
    _notify(client, hid)
    assert sorted(sent[-1]["tokens"]) == ["tok-g1", "tok-g2"]
    assert client.delete(f"/household/{hid}/guardians/g2", headers=H(G1)).status_code == 200
    _notify(client, hid)
    assert sent[-1]["tokens"] == ["tok-g1"]


def test_alert_household_sends_to_pairing_and_push_tokens_once(client, sent):
    hid = _two_guardians(client, fcm_token="a")
    for tok in ("a", "b", "b"):
        client.post(f"/household/{hid}/push", json={"fcm_token": tok}, headers=H(G1))
    _notify(client, hid)
    assert len(sent) == 1 and sent[0]["tokens"] == ["a", "b"]


def test_resolve_household_is_for_devices_only(client):
    from app.auth import Principal
    from app.households import resolve_household
    a = client.post("/household", json={"market": "ja"}, headers=H("da:anonymous")).json()
    b = client.post("/household", json={"market": "ja"}, headers=H("db:anonymous")).json()
    for h in (a, b):
        client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1))
    assert resolve_household(Principal("g1", "guardian")) is None
    assert resolve_household(Principal("da", "device")) == a["household_id"]
    assert resolve_household(Principal("nobody", "device")) is None and resolve_household(None) is None


def test_authorization_rows(client):
    hid = _two_guardians(client)
    out = "outsider:google.com"
    assert _notify_as(client, hid, out).status_code == 403
    assert client.get(f"/household/{hid}", headers=H(out)).status_code == 403
    assert "uid" not in str(client.get(f"/household/{hid}", headers=H(DEV)).json())
    assert "uid" in str(client.get(f"/household/{hid}", headers=H(G2)).json())
    assert client.delete(f"/household/{hid}/guardians/g2", headers=H(DEV)).status_code == 403
    assert client.post(f"/household/{hid}/owner", json={"uid": "g2"}, headers=H(DEV)).status_code == 403
    assert client.delete(f"/household/{hid}/guardians/nobody", headers=H(G1)).status_code == 404
    assert client.post(f"/admin/household/{hid}/owner", json={"uid": "g2"}).status_code == 401
    assert client.delete(f"/household/{hid}/guardians/g2", headers=H(G1)).status_code == 200      # owner removes another


def _notify_as(client, hid, who):
    return client.post(f"/household/{hid}/notify", json={"risk_level": "HIGH", "lang": "ja"}, headers=H(who))


def test_an_admin_who_is_also_a_guardian_may_use_guardian_routes(client):
    adm = "root:google.com:admin"
    h = client.post("/household", json={"market": "ja"}, headers=H(adm)).json()
    hid = h["household_id"]
    assert client.get(f"/household/{hid}/alerts", headers=H(adm)).status_code == 200
    assert client.post(f"/household/{hid}/push", json={"fcm_token": "x"}, headers=H(adm)).status_code == 200


SCAM_LINES = ["警視庁の者です。電話番号は 03-1234-5678 です", "これからLINEで逮捕状を送ります", "すぐに確認してください", "もしもし"]


def say(ws, text):
    ws.send_json({"type": "transcript", "text": text, "final": True})


def auth(ws, tok=DEV.split(":")[0] + ":anonymous"):
    ws.send_json({"type": "auth", "token": f"fake:{tok}"})


def test_live_high_alerts_the_household_once_and_survives_deletion(client):
    h = client.post("/household", json={"member_name": "Mom", "market": "ja"}, headers=H(DEV)).json()
    hid = h["household_id"]
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1))
    with client.websocket_connect("/ws/live?lang=ja") as ws:
        auth(ws)
        for line in SCAM_LINES:
            say(ws, line)
            ws.receive_json()
        auth(ws, "g1:google.com")   # a second auth message is ignored
    alerts = client.get(f"/household/{hid}/alerts", headers=H(G1)).json()
    assert len(alerts) == 1 and alerts[0]["risk_level"] == "HIGH" and SCAM_LINES[0] not in str(alerts)
    client.delete(f"/household/{hid}", headers=H(G1))
    with client.websocket_connect("/ws/live?lang=ja") as ws:   # orphaned device: still warns
        auth(ws)
        for line in SCAM_LINES:
            say(ws, line)
            last = ws.receive_json()
    assert last["risk_level"] == "HIGH"


def test_live_lines_before_auth_are_scored_without_a_household(client):
    h = client.post("/household", json={"member_name": "Mom", "market": "ja"}, headers=H(DEV)).json()
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1))
    with client.websocket_connect("/ws/live?lang=ja") as ws:
        for line in SCAM_LINES:
            say(ws, line)
            last = ws.receive_json()
        auth(ws)
        say(ws, "もしもし")
        ws.receive_json()
    assert last["risk_level"] == "HIGH"
    assert client.get(f"/household/{h['household_id']}/alerts", headers=H(G1)).json() == []


def test_live_with_a_bad_token_still_runs(client):
    with client.websocket_connect("/ws/live?lang=ja") as ws:
        ws.send_json({"type": "auth", "token": "garbage"})
        say(ws, "もしもし")
        assert ws.receive_json()["risk_level"] == "LOW"


def test_live_store_failure_never_silences_the_warning(client, monkeypatch):
    client.post("/household", json={"member_name": "Mom", "market": "ja"}, headers=H(DEV))

    def boom(uid):
        raise RuntimeError("firestore down")

    monkeypatch.setattr(main.STORE, "households_for", boom)
    with client.websocket_connect("/ws/live?lang=ja") as ws:
        auth(ws)
        for line in SCAM_LINES:
            say(ws, line)
            last = ws.receive_json()
    assert last["risk_level"] == "HIGH"


def test_live_legacy_family_id_is_told_to_update_when_the_flag_is_off(client, monkeypatch):
    monkeypatch.setenv("LEGACY_FAMILY", "0")
    with client.websocket_connect("/ws/live?lang=ja&family_id=x") as ws:
        assert ws.receive_json() == {"event": "outdated"}
        say(ws, "もしもし")
        assert ws.receive_json()["risk_level"] == "LOW"


def test_sign_out_drops_only_the_callers_copy_of_a_push_token(client, sent):
    hid = _two_guardians(client, fcm_token="pair-g1")
    for tok, who in (("tok-g1", G1), ("tok-g2", G2)):
        client.post(f"/household/{hid}/push", json={"fcm_token": tok}, headers=H(who))
    _notify(client, hid)
    assert sorted(sent[-1]["tokens"]) == ["pair-g1", "tok-g1", "tok-g2"]
    for tok in ("tok-g1", "pair-g1", "never-registered"):
        r = client.request("DELETE", f"/household/{hid}/push", json={"fcm_token": tok}, headers=H(G1))
        assert r.status_code == 200
    _notify(client, hid)
    assert sent[-1]["tokens"] == ["tok-g2"]


def test_removing_a_token_never_touches_another_guardians_identical_token(client, sent):
    hid = _two_guardians(client)
    client.post(f"/household/{hid}/push", json={"fcm_token": "same"}, headers=H(G1))
    client.post(f"/household/{hid}/push", json={"fcm_token": "same"}, headers=H(G2))  # the newest registration owns it
    assert client.request("DELETE", f"/household/{hid}/push", json={"fcm_token": "same"}, headers=H(G1)).status_code == 200
    _notify(client, hid)
    assert sent[-1]["tokens"] == ["same"]


def test_push_removal_is_guardian_only(client):
    hid = _two_guardians(client)
    body = {"fcm_token": "x"}
    assert client.request("DELETE", f"/household/{hid}/push", json=body, headers=H(DEV)).status_code == 403
    assert client.request("DELETE", f"/household/{hid}/push", json=body, headers=H("out:google.com")).status_code == 403
    assert client.request("DELETE", f"/household/{hid}/push", json=body).status_code == 401
