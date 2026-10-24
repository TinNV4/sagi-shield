"""
Sagi Shield - hourly sweep for silent Live Guard devices.

    python -m app.heartbeat_sweep        # what the Cloud Run Job runs (STORE=firestore in its env); prints the counts

A household with Live Guard turned on whose newest heartbeat is older than OFFLINE_AFTER_S gets one "device offline"
alert (stored + a normal-urgency push). A household that never sent a heartbeat is measured from `created_at`.
The next heartbeat clears `offline_notified_at`, so a later outage notifies again. Heartbeats carry no text.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone

OFFLINE_AFTER_S = 24 * 3600


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso).timestamp()


def sweep(now: float | None = None) -> dict:
    from .notifier import notify_offline
    from .storage import STORE, device_status  # looked up at call time: the job sets STORE=firestore

    now = time.time() if now is None else now
    checked = notified = 0
    for hh in STORE.households_for_sweep():
        checked += 1
        since = device_status(hh)["last_seen"] or hh.get("created_at")
        if not since or now - _ts(since) <= OFFLINE_AFTER_S:
            continue
        done = hh.get("offline_notified_at")
        if done and _ts(done) >= _ts(since):
            continue
        if notify_offline(hh, since, hh.get("market", "ja")):
            STORE.mark_offline_notified(hh["household_id"], datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="seconds"))
            notified += 1
    return {"checked": checked, "notified": notified}


if __name__ == "__main__":
    print(json.dumps(sweep()))
    sys.exit(0)
