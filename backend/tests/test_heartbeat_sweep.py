"""Offline sweep: one push per outage, none for households without Live Guard or with a fresh heartbeat."""
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ.update(USE_LLM="0", STORE="memory", AUTH="fake")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import heartbeat_sweep, notifier, storage  # noqa: E402
from app.auth import Principal  # noqa: E402
from app.heartbeat_sweep import sweep  # noqa: E402

DEV = Principal("dev1", "device", "")
GUARD = Principal("g1", "guardian", "Taro")


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")


@pytest.fixture
def frozen_now():
    return 1_800_000_000.0


@pytest.fixture
def store(monkeypatch):
    s = storage.MemoryStore()
    for mod in (storage, notifier):
        monkeypatch.setattr(mod, "STORE", s)
    monkeypatch.setattr(heartbeat_sweep, "STORE", s, raising=False)
    return s


@pytest.fixture
def sent(monkeypatch):
    out = []
    fake = SimpleNamespace(MulticastMessage=lambda **kw: kw["tokens"], Notification=lambda **kw: kw,
                           WebpushConfig=lambda **kw: kw, send_each_for_multicast=lambda m: out.append(m))
    monkeypatch.setattr(notifier, "_messaging", lambda: fake)
    return out


def test_sweep_notifies_once_after_24h_and_resets_on_heartbeat(store, sent, frozen_now):
    hh = store.create_household("", "Mom", "ja", DEV); hid = hh["household_id"]
    store.join_household(hh["pair_code"], GUARD, "tok")
    store.update_household(hid, {"live_guard_enabled": True})
    store.record_heartbeat(hid, "dev1", True, at=iso(frozen_now - 25 * 3600))
    assert sweep(now=frozen_now) == {"checked": 1, "notified": 1, "failed": 0}
    assert store.list_household_alerts(hid)[0]["scam_type"] == "device_offline" and sent[-1] == ["tok"]
    assert sweep(now=frozen_now + 3600) == {"checked": 1, "notified": 0, "failed": 0}          # not again
    store.record_heartbeat(hid, "dev1", True, at=iso(frozen_now + 2 * 3600))
    assert sweep(now=frozen_now + 2 * 3600 + 25 * 3600) == {"checked": 1, "notified": 1, "failed": 0}  # new outage, new push


def test_sweep_ignores_households_without_live_guard_or_still_fresh(store, frozen_now):
    a = store.create_household("", "", "ja", DEV)
    store.record_heartbeat(a["household_id"], "dev1", True, at=iso(frozen_now - 48 * 3600))   # live guard off
    b = store.create_household("", "", "vi", Principal("dev2", "device"))
    store.update_household(b["household_id"], {"live_guard_enabled": True})
    store.record_heartbeat(b["household_id"], "dev2", True, at=iso(frozen_now - 3600))        # fresh
    assert sweep(now=frozen_now) == {"checked": 1, "notified": 0, "failed": 0}


def test_one_failing_household_does_not_stop_the_others(store, sent, frozen_now, monkeypatch, capsys):
    ids = []
    for i in range(2):
        hh = store.create_household("", f"M{i}", "ja", Principal(f"dev{i}", "device"))
        store.update_household(hh["household_id"], {"live_guard_enabled": True})
        store.record_heartbeat(hh["household_id"], f"dev{i}", True, at=iso(frozen_now - 30 * 3600))
        ids.append(hh["household_id"])
    real = store.add_household_alert

    def flaky(hid, *a, **kw):
        if hid == ids[0]:
            raise RuntimeError("boom")
        return real(hid, *a, **kw)
    monkeypatch.setattr(store, "add_household_alert", flaky)
    assert sweep(now=frozen_now) == {"checked": 2, "notified": 1, "failed": 1}
    assert ids[0] not in capsys.readouterr().err  # the log line carries a short prefix, never the whole id
