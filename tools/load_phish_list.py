"""Load the JPCERT/CC phishing URL list into the store from a laptop. The loader itself is backend/app/phish_list.py,
which the monthly Cloud Run Job runs (infra/setup_phish_job.ps1); this wrapper adds local files and a gcloud user token.

    STORE=firestore python tools/load_phish_list.py                 # last 12 months into Firestore (needs ADC)
    python tools/load_phish_list.py --months 3 --dry-run            # just count
    python tools/load_phish_list.py --file 2026/202605.csv          # one month, local file or repo path
    python tools/load_phish_list.py --gcloud-token --project <id>   # no ADC on this machine

Idempotent: URLs already stored are skipped. Attribution and terms: see the module docstring.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "core"))

from app.phish_list import SOURCE, collect, fetch, load, parse  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=12)
    ap.add_argument("--file", help="local CSV path or <year>/<yyyymm>.csv repo path")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--gcloud-token", action="store_true", help="no ADC on this machine: sign Firestore calls with `gcloud auth print-access-token`")
    ap.add_argument("--project", help="Firestore project (with --gcloud-token); default GOOGLE_CLOUD_PROJECT - note .env may hold the API-key project, not the Cloud Run one")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    entries: list[dict] = []
    if a.file:
        p = Path(a.file)
        text = p.read_text(encoding="utf-8") if p.exists() else fetch(Path(a.file).stem)
        entries = parse(text or "")
    else:
        entries = collect(a.months)
    hosts = {e["url"].split("/")[2].lower() for e in entries if "//" in e["url"]}
    print(f"{len(entries)} urls, {len(hosts)} hosts, source={SOURCE}")
    if a.dry_run or not entries:
        return
    if a.gcloud_token:  # this laptop has no ADC: build the Firestore store around the gcloud user token
        import subprocess
        from google.cloud import firestore
        from google.oauth2.credentials import Credentials
        from app.storage import FirestoreStore
        token = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True, shell=True, check=True).stdout.strip()
        store = FirestoreStore.__new__(FirestoreStore)
        store.database = os.getenv("FIRESTORE_DB", "(default)")  # FIRESTORE_DB=pilot loads the pilot service's database
        store.fs = firestore
        store.db = firestore.Client(project=a.project or os.environ["GOOGLE_CLOUD_PROJECT"], credentials=Credentials(token),
                                    database=store.database)
    else:
        from app.storage import STORE as store  # STORE=firestore for the real thing, memory for a dry test
    load(store, entries)


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")  # GOOGLE_CLOUD_PROJECT
    os.environ.setdefault("VERDICT_STDOUT", "0")
    main()
