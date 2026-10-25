"""Retention periods the privacy notice states; the TTL policies and the dataset partition expiry must match."""
from __future__ import annotations
import time
from datetime import datetime, timedelta, timezone

ALERT_DAYS = 90
FEEDBACK_DAYS = 365
VERDICT_PARTITION_DAYS = 400  # same as sagi.events


def expires_at(days: int, now: float | None = None) -> datetime:
    """When a document written at `now` should be deleted (UTC, tz-aware: Firestore TTL needs a timestamp)."""
    base = datetime.fromtimestamp(time.time() if now is None else now, timezone.utc)
    return base + timedelta(days=days)
