"""BigQuery event stream: what is written, and above all what is not."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import analytics, main  # noqa: E402


@pytest.fixture
def events(monkeypatch):
    seen = []
    monkeypatch.setattr(main, "log_event", lambda kind, **f: seen.append(analytics.row(kind, **f)))
    main.store.__init__()
    return seen


def test_one_anonymous_row_per_verdict(events):
    client = TestClient(main.app)
    client.post("/check", json={"lang": "ja", "text": "警察です。口座が犯罪に使われています。LINEで逮捕状を送ります。090-1234-5678"})
    client.post("/check", json={"lang": "ja", "phone": "+44 20 7946 0000"})
    client.post("/report", json={"scam_type": "fake_police", "phone": "03-3210-0000", "prefecture": "長野県", "consent": True})
    assert [(e["kind"], e["source"], e["risk_level"]) for e in events] == [("check", "text", "HIGH"), ("check", "phone", "MEDIUM"), ("report", "phone", None)]
    assert events[2]["prefecture"] == "長野県"
    blob = str(events)
    assert not any(leak in blob for leak in ("警察", "1234", "7946", "3210", "reporter", "family"))  # no text, numbers or ids
    assert set(events[0]) == {"ts", *analytics.FIELDS}


def test_extra_fields_cannot_reach_the_warehouse_and_it_is_off_by_default(monkeypatch):
    assert "text" not in analytics.row("check", text="secret transcript", risk_level="LOW")
    monkeypatch.delenv("BQ_TABLE", raising=False)
    analytics.log_event("check", risk_level="LOW")
    assert analytics._queue.empty() and analytics._state["thread"] is None


def test_unknown_columns_never_reject_a_batch():
    """A column added in code before the live table has it (feedback_correct) must not drop the whole row."""
    calls = []

    class Client:
        def insert_rows_json(self, table, rows, **kw):
            calls.append((table, rows, kw))
            return []
    analytics._insert(Client(), "p.sagi.events", [analytics.row("feedback", feedback_correct=True)])
    assert calls and calls[0][2].get("ignore_unknown_values") is True
