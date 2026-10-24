"""
Sagi Shield - hourly sweep for silent Live Guard devices.

    python -m app.heartbeat_sweep        # what the Cloud Run Job runs (STORE=firestore in its env); prints the counts

A household with Live Guard turned on whose newest heartbeat is older than OFFLINE_AFTER_S gets one "device offline"
alert (stored + a normal-urgency push). Silence is measured from the newest heartbeat or from the moment Live Guard
was turned on (`live_guard_since`, else `created_at`), whichever is later: switching Live Guard on for an old household
must not page the family before the device had a day to check in.
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
    checked = notified = failed = 0
    for hh in STORE.households_for_sweep():
        checked += 1
        try:  # one broken household must not stop the sweep for the others
            marks = [m for m in (device_status(hh)["last_seen"], hh.get("live_guard_since") or hh.get("created_at")) if m]
            since = max(marks, key=_ts) if marks else None
            if not since or now - _ts(since) <= OFFLINE_AFTER_S:
                continue
            done = hh.get("offline_notified_at")
            if done and _ts(done) >= _ts(since):
                continue
            if notify_offline(hh, since, hh.get("market", "ja")):
                STORE.mark_offline_notified(hh["household_id"], datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="seconds"))
                notified += 1
        except Exception as e:
            failed += 1
            print(f"[heartbeat_sweep] household {str(hh.get('household_id', ''))[:4]}... failed: {type(e).__name__}", file=sys.stderr)
    return {"checked": checked, "notified": notified, "failed": failed}


def status_code(result: dict) -> int:
    """Non-zero when any household failed, so the Cloud Run Job execution shows red."""
    return 1 if result.get("failed") else 0


def main() -> int:
    result = sweep()
    print(json.dumps(result))
    return status_code(result)


if __name__ == "__main__":
    sys.exit(main())
