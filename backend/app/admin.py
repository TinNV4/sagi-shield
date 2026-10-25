"""
Sagi Shield - admin summary: aggregates over the verdict table (BigQuery) plus household and feedback counts.

Aggregates only: no verdict ids, no text, no uids, no household ids. Needs the `admin` custom claim.

The table is a Cloud Logging sink of the Cloud Run stdout JSON, so each record is `jsonPayload.<field>` and the
event time is `timestamp`. Shapes as logged (verdict_log.py / main.finish / live.py):
  - `rules.hits` is a dict {STAGE_NAME: markers} (not an array): the sink turns it into a RECORD with one column per
    stage name, so the stage names are recovered from its JSON text rather than by UNNEST.
  - the judge's verdict is logged as `llm` (live looks only; model_dump of LlmVerdict, whose playbook is `scam_type`);
    a Quick Check logs the final `scam_type` at the top level. COALESCE reads either.
Each query starts with `-- name: <x>` so tests can route by name (`which`).
"""
from __future__ import annotations
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from . import auth, bq
from .storage import STORE

router = APIRouter(prefix="/admin")

DAY = 'DATE(timestamp, "Asia/Tokyo")'
WHERE = "timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)"
CHECKS = "jsonPayload.kind IN ('check', 'precheck', 'live_look')"

# a stage that did not hit serialises as "FEAR":[] and must not count; one that did as "FEAR":["marker", ...]
HIT_PATTERN = r'"([A-Z_]+)":\[\s*"'
HIT_RE = re.compile(HIT_PATTERN)

QUERIES = {
    "verdicts": f"""-- name: verdicts
SELECT CAST({DAY} AS STRING) AS day, jsonPayload.kind AS kind, jsonPayload.level AS level, jsonPayload.lang AS lang, COUNT(*) AS n
FROM `@table` WHERE {WHERE} AND jsonPayload.kind IN ('check', 'precheck', 'live_alarm') AND jsonPayload.level IS NOT NULL
GROUP BY day, kind, level, lang ORDER BY day, kind, level, lang""",
    "latency": f"""-- name: latency
SELECT q[OFFSET(50)] AS p50, q[OFFSET(95)] AS p95 FROM (
  SELECT APPROX_QUANTILES(CAST(jsonPayload.latency_ms AS FLOAT64), 100) AS q
  FROM `@table` WHERE {WHERE} AND {CHECKS} AND jsonPayload.latency_ms IS NOT NULL)""",
    "live": f"""-- name: live
SELECT COUNTIF(jsonPayload.kind = 'live_call') AS calls, COUNTIF(jsonPayload.kind = 'live_look') AS looks,
       COUNTIF(jsonPayload.kind = 'live_alarm') AS alarms
FROM `@table` WHERE {WHERE} AND jsonPayload.kind IN ('live_call', 'live_look', 'live_alarm')""",
    "rule_hits": f"""-- name: rule_hits
SELECT name, COUNT(*) AS n FROM `@table`,
  UNNEST(REGEXP_EXTRACT_ALL(TO_JSON_STRING(jsonPayload.rules.hits), r'{HIT_PATTERN}')) AS name
WHERE {WHERE} AND {CHECKS}
GROUP BY name ORDER BY n DESC LIMIT 20""",
    "reasons": f"""-- name: reasons
SELECT COALESCE(jsonPayload.llm.scam_type, jsonPayload.scam_type) AS playbook, COUNT(*) AS n
FROM `@table` WHERE {WHERE} AND {CHECKS}
  AND COALESCE(jsonPayload.llm.scam_type, jsonPayload.scam_type) NOT IN ('safe', 'unknown')
GROUP BY playbook ORDER BY n DESC LIMIT 20""",
}


def which(sql: str) -> str:
    m = re.match(r"\s*--\s*name:\s*(\w+)", sql)
    return m.group(1) if m else ""


def _run(name: str, table: str, days: int) -> list[dict]:
    return bq.query(QUERIES[name].replace("@table", table), {"days": days})


def _int(x) -> int:
    return int(round(x)) if x is not None else 0


@router.get("/summary")
def summary(days: int = Query(7, ge=1, le=30), _=Depends(auth.admin_only)) -> dict:
    try:
        table = bq.table()
        rows = {"verdicts": _run("verdicts", table, days)}
    except bq.Unavailable as e:
        detail = e.detail if "not configured" in e.detail else f"verdict table not available: {e.detail}"
        raise HTTPException(503, detail)
    unavailable = []
    for name in QUERIES:  # a column the sink has not created yet fails one query, not the whole page
        if name == "verdicts":
            continue
        try:
            rows[name] = _run(name, table, days)
        except bq.Unavailable:
            rows[name] = []
            unavailable.append(name)
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    lat = (rows["latency"] or [{}])[0]
    live = (rows["live"] or [{}])[0]
    return {
        "days": days, "table": table, "unavailable": unavailable,
        "verdicts": [{"day": r["day"], "kind": r["kind"], "level": r["level"], "lang": r["lang"], "n": _int(r["n"])}
                     for r in rows["verdicts"]],
        "latency_ms": {"p50": _int(lat.get("p50")), "p95": _int(lat.get("p95"))},
        "live": {k: _int(live.get(k)) for k in ("calls", "looks", "alarms")},
        "rule_hits": [{"name": r["name"], "n": _int(r["n"])} for r in rows["rule_hits"]],
        "reasons": [{"playbook": r["playbook"], "n": _int(r["n"])} for r in rows["reasons"]],
        "feedback": STORE.feedback_stats(since),
        "households": STORE.households_overview(),
    }
