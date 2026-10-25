"""The pilot owner's weekly report: the pure formatting is tested here, the Google reads are not."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from pilot_report import collect_bigquery, format_report  # noqa: E402

ROWS = {
    "days": 7,
    "verdicts": [
        {"day": "2026-10-20", "kind": "check", "level": "HIGH", "lang": "ja", "n": 3},
        {"day": "2026-10-21", "kind": "check", "level": "HIGH", "lang": "ja", "n": 2},
        {"day": "2026-10-21", "kind": "check", "level": "LOW", "lang": "vi", "n": 10},
        {"day": "2026-10-22", "kind": "live_alarm", "level": "HIGH", "lang": "ja", "n": 1},
    ],
    "latency": [{"kind": "check", "p50": 1300.4, "p95": 9000}, {"kind": "live_look", "p50": 900, "p95": None}],
    "live": {"calls": 4, "looks": 120, "alarms": 1},
    "feedback": {"checks": {"n": 8, "correct": 6}, "alerts": {"n": 0, "correct": 0}},
    "households": {"n": 3, "live_guard_on": 2, "devices_seen_24h": 2},
    "offline_alerts": 1,
}


def test_report_lists_counts_percentages_and_households():
    text = format_report(ROWS)
    assert "check: HIGH 5, LOW 10" in text
    assert "live_alarm: HIGH 1" in text
    assert "calls 4, looks 120, alarms 1" in text
    assert "check: p50 1300 ms, p95 9000 ms" in text
    assert "live_look: p50 900 ms, p95 n/a" in text
    assert "checks: 6 of 8 right (75%)" in text
    assert "alerts: no answers yet" in text
    assert "households 3, live guard on 2, seen in 24 h 2" in text
    assert "offline alerts sent: 1" in text


def test_missing_verdict_table_prints_the_note_and_zeros():
    text = format_report({**ROWS, "verdicts": None, "latency": None, "live": None})
    assert "no verdict table" in text
    assert "calls 0, looks 0, alarms 0" in text
    assert "checks: 6 of 8 right (75%)" in text  # Firestore sections still print


def test_empty_rows_print_zeros():
    text = format_report({})
    assert "no verdict table" in text
    assert "no answers yet" in text
    assert "households 0, live guard on 0, seen in 24 h 0" in text
    assert "offline alerts sent: 0" in text
    assert "Traceback" not in text


def test_expired_gcloud_login_returns_a_message_not_a_traceback(monkeypatch):
    import subprocess
    import pilot_report

    def boom(*a, **k):
        raise subprocess.CalledProcessError(1, "gcloud")
    monkeypatch.setattr(subprocess, "run", boom)
    creds, error = pilot_report.credentials("p", True)
    assert creds is None and "gcloud auth login" in error
    assert pilot_report.credentials("p", False) == (None, None)


def test_one_failing_query_keeps_the_sections_that_succeeded():
    def run(name):
        if name == "latency":
            raise RuntimeError("quota")
        return {"verdicts": ROWS["verdicts"], "live": [ROWS["live"]]}[name]

    rows = {"days": 7, "verdicts": None, "latency": None, "live": None}
    collect_bigquery(rows, run)
    assert rows["verdicts"] == ROWS["verdicts"]
    assert rows["latency"] is None
    assert rows["live"] == ROWS["live"]
    assert "quota" in rows["note"]
    text = format_report({**ROWS, **rows})
    assert "check: HIGH 5, LOW 10" in text
    assert "calls 4, looks 120, alarms 1" in text
