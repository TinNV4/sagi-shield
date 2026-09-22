"""
Sagi Shield - the verdict log: WHY a check or a live look ended where it did.

analytics.py answers "what is spreading, where" with a few aggregate columns. This answers "why did this call get
MEDIUM at look 4": the rule hits, the judge's structured verdict (stage, risk, confidence, playbook, reasons),
the call state the judge was given, the fused score, the gate that triggered the look, and how long it took.
Evidence for the evaluation and the material for later analysis; an admin page can read the same records.

One JSON object per record, written to
  - stdout, one line, as Cloud Logging expects (jsonPayload with `kind`, `severity`): on Cloud Run this is the
    production trail - Logs Explorer filters on `jsonPayload.kind="live_look" AND jsonPayload.llm.risk>=70`; a
    logging sink can copy it to BigQuery without any schema code here. VERDICT_STDOUT=0 turns it off (tests).
  - a JSONL file when VERDICT_LOG=<path> is set (local runs, replays, A/B): `python tools/verdict_log.py <path>`
    prints timelines per session and reason tallies per playbook.

What a record never holds: the transcript window or the checked text (LOG_TEXT=1 adds the masked text, meant for
local evaluation only - never set it on Cloud Run), phone numbers (masked upstream), family ids, addresses.
The judge's `reasons` are two short sentences the model wrote; they may quote a word of the call. That is the point
of the log - it is the "why" - and it is the one place text-derived content is kept; keep them short (they are
capped at 2 upstream).
"""
from __future__ import annotations
import json
import os
import sys
import threading
from datetime import datetime, timezone

_lock = threading.Lock()


def _jsonable(x):
    if isinstance(x, dict):
        return {str(k): _jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple, set)):
        return [_jsonable(v) for v in x]
    if hasattr(x, "model_dump"):
        return _jsonable(x.model_dump())
    if hasattr(x, "name") and hasattr(x, "value"):  # IntEnum stages -> their names
        return x.name
    return x


def record(kind: str, **fields) -> dict:
    """Build the record. `text` is dropped unless LOG_TEXT=1; None fields are dropped for a quieter line."""
    if os.getenv("LOG_TEXT", "0") != "1":
        fields.pop("text", None)
    data = {k: _jsonable(v) for k, v in fields.items() if v is not None}
    return {"ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), "kind": kind, **data}


def log_verdict(kind: str, **fields) -> dict:
    """Write one record everywhere it is configured to go. Never raises: a log must not fail a check."""
    rec = record(kind, **fields)
    line = json.dumps(rec, ensure_ascii=False)
    try:
        if os.getenv("VERDICT_STDOUT", "1") == "1":
            # Cloud Logging reads `severity` and keeps the rest as jsonPayload; `message` is the one-line summary
            summary = f"{kind} {rec.get('level') or ''} {rec.get('score') if rec.get('score') is not None else ''}".strip()
            print(json.dumps({"severity": "INFO", "message": f"[verdict] {summary}", **rec}, ensure_ascii=False), flush=True)
        path = os.getenv("VERDICT_LOG")
        if path:
            with _lock, open(path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception as e:  # disk full, closed stdout: say so once per process, keep serving
        if not getattr(log_verdict, "_warned", False):
            log_verdict._warned = True  # type: ignore[attr-defined]
            print(f"[verdict_log] cannot write: {type(e).__name__}: {str(e)[:120]}", file=sys.stderr)
    return rec
