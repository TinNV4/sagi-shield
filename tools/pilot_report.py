"""The pilot owner's weekly report: one screen of numbers from the verdict table and the Firestore database.

    python tools/pilot_report.py --gcloud-token --project <id> --days 7
    python tools/pilot_report.py --gcloud-token --project <id> --database pilot --verdict-table <p.d.t>

Reads the same queries as the admin page (app.admin.QUERIES) and the same store counts; aggregates only, no text, no
ids. A missing or empty verdict table prints a note instead of a traceback. Needs `gcloud` logged in with --gcloud-token.
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "core"))

LEVELS = ("HIGH", "MEDIUM", "LOW")


def _pct(correct: int, n: int) -> str:
    return f"{correct} of {n} right ({round(100 * correct / n)}%)" if n else "no answers yet"


def _ms(x) -> str:
    return f"{int(round(x))} ms" if x is not None else "n/a"


def format_report(rows: dict) -> str:
    """Plain text for the terminal. `rows` keys are all optional; None / missing verdict data prints the note."""
    out = [f"Pilot report, last {rows.get('days', 7)} days", ""]
    verdicts, latency, live = rows.get("verdicts"), rows.get("latency"), rows.get("live")

    out.append("Verdicts per level")
    if verdicts is None:
        out.append("  no verdict table" + (f" ({rows['note']})" if rows.get("note") else ""))
    else:
        per_kind: "OrderedDict[str, dict]" = OrderedDict()
        for r in verdicts:
            per_kind.setdefault(r["kind"], {}).setdefault(r["level"], 0)
            per_kind[r["kind"]][r["level"]] += int(r["n"])
        if not per_kind:
            out.append("  none")
        for kind, levels in per_kind.items():
            ordered = [l for l in LEVELS if l in levels] + sorted(l for l in levels if l not in LEVELS)
            out.append(f"  {kind}: " + ", ".join(f"{l} {levels[l]}" for l in ordered))

    live = live or {}
    out += ["", "Live Guard",
            f"  calls {int(live.get('calls') or 0)}, looks {int(live.get('looks') or 0)}, alarms {int(live.get('alarms') or 0)}"]

    out += ["", "Latency"]
    if not latency:
        out.append("  n/a")
    for r in latency or []:
        out.append(f"  {r['kind']}: p50 {_ms(r.get('p50'))}, p95 {_ms(r.get('p95'))}")

    fb = rows.get("feedback") or {}
    out += ["", "Feedback ('was this right?')"]
    for name in ("checks", "alerts"):
        b = fb.get(name) or {}
        out.append(f"  {name}: {_pct(int(b.get('correct') or 0), int(b.get('n') or 0))}")

    h = rows.get("households") or {}
    out += ["", "Households",
            f"  households {int(h.get('n') or 0)}, live guard on {int(h.get('live_guard_on') or 0)}, "
            f"seen in 24 h {int(h.get('devices_seen_24h') or 0)}",
            f"  offline alerts sent: {int(rows.get('offline_alerts') or 0)}"]
    if rows.get("store_note"):
        out.append(f"  note: {rows['store_note']}")
    return "\n".join(out)


GCLOUD_FAILED = "gcloud auth print-access-token failed; run `gcloud auth login`"


def _token() -> str:
    import subprocess
    return subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True, shell=True,
                          check=True).stdout.strip()


def credentials(project: str, gcloud_token: bool):
    """(credentials, None), (None, None) without --gcloud-token, or (None, message) when the gcloud login is unusable."""
    if not gcloud_token:
        return None, None
    try:
        from google.oauth2.credentials import Credentials
        token = _token()
        if not token:
            return None, GCLOUD_FAILED
        return Credentials(token, quota_project_id=project), None
    except Exception:  # CalledProcessError (expired login), FileNotFoundError (no gcloud), missing library
        return None, GCLOUD_FAILED


def _iso(x) -> str:
    return x.isoformat() if isinstance(x, datetime) else str(x or "")


def _offline_alerts(store, since_iso: str, limit: int = 2000) -> int:
    """Count `device_offline` alerts since `since_iso`: households are few in a pilot, so walk them (bounded) instead of a
    collection-group query, which would need its own composite index."""
    n = 0
    for doc in store.db.collection("households").select([]).limit(limit).stream():
        for a in store.list_household_alerts(doc.id):
            if a.get("scam_type") == "device_offline" and _iso(a.get("created_at")) >= since_iso:
                n += 1
    return n


def collect(a: argparse.Namespace, creds=None) -> dict:
    project = a.project or os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    table = a.verdict_table or os.getenv("VERDICT_TABLE") or f"{project}.sagi_pilot.run_googleapis_com_stdout"
    rows: dict = {"days": a.days, "verdicts": None, "latency": None, "live": None}

    try:  # BigQuery: any failure (no table yet, no rights) becomes the note, never a traceback
        from google.cloud import bigquery
        from app.admin import QUERIES, which
        client = bigquery.Client(project=project or None, credentials=creds)

        def run(name: str) -> list[dict]:
            cfg = bigquery.QueryJobConfig(query_parameters=[bigquery.ScalarQueryParameter("days", "INT64", a.days)])
            return [dict(r.items()) for r in client.query(QUERIES[name].replace("@table", table), job_config=cfg).result(timeout=60)]
        assert all(which(QUERIES[k]) == k for k in QUERIES)
        rows["verdicts"] = run("verdicts")
        rows["latency"] = run("latency")
        rows["live"] = (run("live") or [{}])[0]
    except Exception as e:
        rows["verdicts"] = None
        rows["note"] = f"{type(e).__name__}: {str(e)[:100]}"

    try:  # Firestore, same token as tools/load_phish_list.py
        from google.cloud import firestore
        from app.storage import FirestoreStore
        store = FirestoreStore.__new__(FirestoreStore)
        store.database = a.database
        store.fs = firestore
        store.db = firestore.Client(project=project or None, credentials=creds, database=a.database)
        since = (datetime.now(timezone.utc) - timedelta(days=a.days)).isoformat()
        rows["feedback"] = store.feedback_stats(since)
        rows["households"] = store.households_overview()
        rows["offline_alerts"] = _offline_alerts(store, since)
    except Exception as e:
        rows["store_note"] = f"Firestore not read: {type(e).__name__}: {str(e)[:100]}"
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--gcloud-token", action="store_true", help="no ADC on this machine: use `gcloud auth print-access-token`")
    ap.add_argument("--project", help="Google Cloud project (default GOOGLE_CLOUD_PROJECT; .env may hold the API-key project)")
    ap.add_argument("--verdict-table", help="project.dataset.table; default VERDICT_TABLE or <project>.sagi_pilot.run_googleapis_com_stdout")
    ap.add_argument("--database", default="pilot", help="Firestore database (default pilot)")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    creds, error = credentials(a.project or os.environ.get("GOOGLE_CLOUD_PROJECT", ""), a.gcloud_token)
    if error:
        print(error)
        sys.exit(1)
    print(format_report(collect(a, creds)))


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    os.environ.setdefault("VERDICT_STDOUT", "0")
    main()
