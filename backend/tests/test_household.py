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
def client():
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
