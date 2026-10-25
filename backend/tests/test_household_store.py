from app.auth import Principal
from app.storage import MemoryStore, device_status

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

def test_heartbeat_keeps_one_entry_per_device_and_clears_the_offline_mark():
    s = MemoryStore()
    h = s.create_household("", "Mom", "ja", DEV)
    hid = h["household_id"]
    h["offline_notified_at"] = "2026-10-01T00:00:00+00:00"
    assert s.record_heartbeat(hid, "dev1", True, at="2026-10-02T00:00:00+00:00") and s.record_heartbeat(hid, "dev1", False, at="2026-10-03T00:00:00+00:00")
    got = s.get_household(hid)
    assert got["devices_seen"] == {"dev1": {"at": "2026-10-03T00:00:00+00:00", "listening": False}} and got["offline_notified_at"] is None
    assert s.record_heartbeat("nope", "dev1", True) is False
    s.clear_household_devices(hid)
    assert s.get_household(hid)["devices_seen"] == {}

def test_update_household_whitelists_fields_and_cuts_names():
    s = MemoryStore()
    h = s.create_household("", "", "ja", DEV)
    out = s.update_household(h["household_id"], {"name": "x" * 50, "live_guard_enabled": True, "market": "vi", "devices": []})
    assert len(out["name"]) == 40 and out["live_guard_enabled"] is True and out["market"] == "ja" and out["devices"] == ["dev1"]
    assert s.update_household("nope", {"name": "a"}) is None

def test_device_status_is_the_newest_heartbeat_across_devices():
    s = MemoryStore()
    h = s.create_household("", "Mom", "ja", DEV)
    hid = h["household_id"]
    s.record_heartbeat(hid, "dev1", True, at="2026-10-02T00:00:00+00:00")
    s.record_heartbeat(hid, "dev2", False, at="2026-10-01T00:00:00+00:00")
    assert device_status(s.get_household(hid)) == {"last_seen": "2026-10-02T00:00:00+00:00", "listening": True}
    s.record_heartbeat(hid, "dev2", False, at="2026-10-03T00:00:00+00:00")
    assert device_status(s.get_household(hid)) == {"last_seen": "2026-10-03T00:00:00+00:00", "listening": False}

def test_turning_live_guard_on_stamps_live_guard_since_once(monkeypatch):
    from app import storage
    s = MemoryStore()
    h = s.create_household("", "", "ja", DEV)
    hid = h["household_id"]
    monkeypatch.setattr(storage, "_now_iso", lambda: "2026-10-05T00:00:00+00:00")
    assert s.update_household(hid, {"live_guard_enabled": True})["live_guard_since"] == "2026-10-05T00:00:00+00:00"
    monkeypatch.setattr(storage, "_now_iso", lambda: "2026-10-06T00:00:00+00:00")
    assert s.update_household(hid, {"live_guard_enabled": True, "name": "a"})["live_guard_since"] == "2026-10-05T00:00:00+00:00"
    s.update_household(hid, {"live_guard_enabled": False})
    assert s.update_household(hid, {"live_guard_enabled": True})["live_guard_since"] == "2026-10-06T00:00:00+00:00"

def test_firestore_update_household_writes_live_guard_since_as_a_field(monkeypatch):
    from app import storage
    doc = {"household_id": "h1", "live_guard_enabled": False, "name": ""}
    updates = []

    class Snap:
        exists = True
        def to_dict(self):
            return dict(doc)

    class Ref:
        def get(self):
            return Snap()
        def update(self, changed):
            updates.append(changed)
            doc.update(changed)

    class Db:
        def collection(self, _name):
            return self
        def document(self, _id):
            return Ref()

    fs = object.__new__(storage.FirestoreStore)
    fs.db = Db()
    monkeypatch.setattr(storage, "_now_iso", lambda: "2026-10-05T00:00:00+00:00")
    fs.update_household("h1", {"live_guard_enabled": True})
    fs.update_household("h1", {"live_guard_enabled": True})
    assert updates == [{"live_guard_enabled": True, "live_guard_since": "2026-10-05T00:00:00+00:00"}, {"live_guard_enabled": True}]


def test_feedback_stats_ignores_documents_older_than_since():
    s = MemoryStore()
    s.save_feedback("check", "a" * 16, "w1", True, None, "ja")
    s.save_feedback("alert", "x1", "g1", False, "not_scam", "ja")
    s.feedback[next(iter(s.feedback))]["created_at"] = "2000-01-01T00:00:00+00:00"
    assert s.feedback_stats("2001-01-01T00:00:00+00:00") == {"checks": {"n": 0, "correct": 0}, "alerts": {"n": 1, "correct": 0}}


def test_alerts_and_feedback_carry_expires_at_and_old_alerts_still_list():
    s = MemoryStore(); h = s.create_household("", "Mom", "ja", DEV); hid = h["household_id"]
    a = s.add_household_alert(hid, "HIGH", "fake_police", 4, "x")
    assert a["expires_at"] > a["created_at"]
    s.household_alerts[hid].append({**a, "id": "old"}); del s.household_alerts[hid][-1]["expires_at"]   # a pre-retention document
    assert [x["id"] for x in s.list_household_alerts(hid)] == [a["id"], "old"]
    fb = s.save_feedback("check", "0123456789abcdef", "who", True, None, "ja")
    assert "expires_at" in fb
