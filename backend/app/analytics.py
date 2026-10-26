"""
Sagi Shield - anonymous event stream to BigQuery, the source of the community scam map (Looker Studio).

Firestore answers "has this number been reported?" while a user waits; BigQuery answers "what is spreading, where,
this week?" across millions of rows. Different questions, different stores.

One row per verdict. A row holds NO text, NO phone number or hash, NO family or session id, NO address - only:
  ts, kind (check | precheck | live_alarm | report | feedback), lang, source, risk_level, risk_score, scam_type, stage,
  prefecture (only when the user typed one in a report), llm_used, latency_ms, feedback_correct (feedback rows)
Enabled by BQ_TABLE=project.dataset.table. Rows are queued and written by a thread, never on the verdict's path; any
failure is swallowed after one warning - analytics must never fail a check. Cloud Run throttles the CPU once a request
has ended and may stop an idle instance, so a row still queued then is lost: FlushMiddleware (main.py) keeps the
request open until flush() has seen the queue written, which costs the caller nothing (the response is already sent).
"""
from __future__ import annotations
import os
import queue
import sys
import threading
import time
from datetime import datetime, timezone

FIELDS = ("kind", "lang", "source", "risk_level", "risk_score", "scam_type", "stage", "prefecture", "llm_used", "latency_ms", "feedback_correct")
_queue: queue.Queue = queue.Queue(maxsize=1000)
_state = {"thread": None, "warned": False, "pending": 0}
_idle = threading.Condition()


def _worker() -> None:
    from google.cloud import bigquery
    client, table = bigquery.Client(), os.environ["BQ_TABLE"]
    while True:
        rows = [_queue.get()]
        while len(rows) < 50 and not _queue.empty():
            rows.append(_queue.get_nowait())
        _insert(client, table, rows)
        with _idle:
            _state["pending"] -= len(rows)
            _idle.notify_all()


def flush(timeout: float = 5.0) -> bool:
    """Block until every queued row has been handed to BigQuery (or failed); False when the timeout ran out."""
    deadline = time.monotonic() + timeout
    with _idle:
        while _state["pending"] > 0:
            left = deadline - time.monotonic()
            if left <= 0:
                return False
            _idle.wait(left)
    return True


def pending() -> bool:
    return _state["pending"] > 0


def _insert(client, table: str, rows: list[dict]) -> None:
    """ignore_unknown_values: a column the code emits before the live table has it is dropped, not the whole row."""
    try:
        errors = client.insert_rows_json(table, rows, ignore_unknown_values=True)
        if errors and not _state["warned"]:
            _state["warned"] = True
            print(f"[analytics] BigQuery rejected rows: {str(errors)[:200]}", file=sys.stderr)
    except Exception as e:
        if not _state["warned"]:
            _state["warned"] = True
            print(f"[analytics] BigQuery unavailable: {type(e).__name__}: {str(e)[:200]}", file=sys.stderr)


def row(kind: str, **fields) -> dict:
    """Whitelisted columns only: a caller cannot leak text into the warehouse by passing an extra field."""
    data = {k: fields.get(k) for k in FIELDS if k != "kind"}
    return {"ts": datetime.now(timezone.utc).isoformat(), "kind": kind, **data}


def log_event(kind: str, **fields) -> None:
    if not os.getenv("BQ_TABLE"):
        return
    if _state["thread"] is None:
        _state["thread"] = threading.Thread(target=_worker, daemon=True, name="bq-writer")
        _state["thread"].start()
    try:
        _queue.put_nowait(row(kind, **fields))
        with _idle:
            _state["pending"] += 1
    except queue.Full:
        pass  # under a flood, dropping analytics is the right thing to drop
