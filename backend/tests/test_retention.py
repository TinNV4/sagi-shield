import json
from pathlib import Path

from app import retention


def test_retention_constants_match_the_frontend_json():
    data = json.load(open(Path(__file__).resolve().parents[2] / "frontend/src/content/retention.json"))
    assert data == {"alert_days": retention.ALERT_DAYS, "feedback_days": retention.FEEDBACK_DAYS, "verdict_days": retention.VERDICT_PARTITION_DAYS}
    assert (retention.ALERT_DAYS, retention.FEEDBACK_DAYS, retention.VERDICT_PARTITION_DAYS) == (90, 365, 400)


def test_expires_at_is_utc_and_in_the_future():
    at = retention.expires_at(90, now=1_800_000_000.0)
    assert at.tzinfo is not None and at.timestamp() == 1_800_000_000.0 + 90 * 86400
