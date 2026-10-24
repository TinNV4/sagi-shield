from app.auth import Principal
from app.storage import MemoryStore

DEV, GUARD, GUARD2 = Principal("dev1", "device"), Principal("g1", "guardian", "Taro"), Principal("g2", "guardian", "Hana")

def test_device_creates_and_first_guardian_becomes_owner():
    s = MemoryStore()
    h = s.create_household("", "Mom", "ja", DEV)
    assert h["devices"] == ["dev1"] and h["guardians"] == [] and len(h["pair_code"]) == 6
    assert s.join_household(h["pair_code"], GUARD, "tok")["guardians"] == [{"uid": "g1", "name": "Taro", "owner": True, "fcm_token": "tok"}]
    assert s.join_household(h["pair_code"], GUARD2, None) is None          # single use
    h2 = s.refresh_household_code(h["household_id"])
    assert s.join_household(h2["pair_code"], GUARD2, None)["guardians"][1]["owner"] is False
    assert [x["household_id"] for x in s.households_for("g1")] == [h["household_id"]]

def test_guardian_creates_then_device_joins_without_duplicates():
    s = MemoryStore()
    h = s.create_household("Grandma", "Mom", "vi", GUARD)
    assert h["guardians"][0]["owner"] is True and h["devices"] == []
    s.join_household(h["pair_code"], DEV, None)
    s.join_household(s.refresh_household_code(h["household_id"])["pair_code"], DEV, None)
    assert s.get_household(h["household_id"])["devices"] == ["dev1"]

def test_owner_reassignment_and_removal():
    s = MemoryStore()
    h = s.create_household("", "", "ja", GUARD)
    s.join_household(h["pair_code"], GUARD2, None)
    assert s.set_owner(h["household_id"], "g2") and [g["owner"] for g in s.get_household(h["household_id"])["guardians"]] == [False, True]
    assert s.set_owner(h["household_id"], "nobody") is False
    assert s.remove_guardian(h["household_id"], "g1") and len(s.get_household(h["household_id"])["guardians"]) == 1

def test_delete_removes_alerts_too():
    s = MemoryStore()
    h = s.create_household("", "Mom", "ja", DEV)
    s.add_household_alert(h["household_id"], "HIGH", "fake_police", 4, "summary")
    assert s.delete_household(h["household_id"]) and s.get_household(h["household_id"]) is None
    assert s.list_household_alerts(h["household_id"]) == [] and s.delete_household(h["household_id"]) is False

def test_clear_devices_unpairs_every_device_and_keeps_the_guardians():
    s = MemoryStore()
    h = s.create_household("", "Mom", "ja", DEV)
    s.join_household(h["pair_code"], GUARD, None)
    s.join_household(s.refresh_household_code(h["household_id"])["pair_code"], Principal("dev2", "device"), None)
    assert s.clear_household_devices(h["household_id"]) == 2
    kept = s.get_household(h["household_id"])
    assert kept["devices"] == [] and [g["uid"] for g in kept["guardians"]] == ["g1"]
    assert s.households_for("dev1") == [] and s.clear_household_devices("nope") == 0
