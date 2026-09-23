"""Load the JPCERT/CC phishing URL list (github.com/JPCERTCC/phishurl-list, monthly CSVs) into the store.

    STORE=firestore python tools/load_phish_list.py                 # last 12 months into Firestore (needs ADC)
    python tools/load_phish_list.py --months 3 --dry-run            # just count
    python tools/load_phish_list.py --file 2026/202605.csv          # one month, local file or repo path

Columns (README of the repo): date (confirmed by JPCERT/CC), URL (entire phishing URL), description (spoofed brand).
Stored per URL: hashed URL key, brand, date, source - never the victim's URL, that is hashed at lookup time too.
The list lags by weeks to months and is Japanese-brand phishing; a miss proves nothing (the check says so).
Attribution: JPCERT/CC. The repo carries no licence file - keep the data server-side, do not redistribute it.
"""
from __future__ import annotations

import argparse
import csv
import io
import os
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "core"))

RAW = "https://raw.githubusercontent.com/JPCERTCC/phishurl-list/main/{year}/{ym}.csv"
SOURCE = "jpcertcc"


def months_back(n: int) -> list[str]:
    y, m = date.today().year, date.today().month
    out = []
    for _ in range(n):
        out.append(f"{y}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def fetch(ym: str) -> str | None:
    url = RAW.format(year=ym[:4], ym=ym)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.read().decode("utf-8")
    except Exception as e:  # noqa: BLE001
        print(f"  {ym}: not available ({type(e).__name__})")
        return None


def parse(text: str) -> list[dict]:
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        u = (r.get("URL") or "").strip()
        if not u:
            continue
        rows.append({"url": u, "brand": (r.get("description") or "")[:60], "date": (r.get("date") or "")[:10].replace("/", "-"),
                     "source": SOURCE})
    return rows


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
        for ym in months_back(a.months):
            text = fetch(ym)
            if text:
                got = parse(text)
                print(f"  {ym}: {len(got)} urls")
                entries += got
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
        store.fs, store.db = firestore, firestore.Client(project=a.project or os.environ["GOOGLE_CLOUD_PROJECT"], credentials=Credentials(token))
    else:
        from app.storage import STORE as store  # STORE=firestore for the real thing, memory for a dry test
    t0 = time.time()
    n = store.add_phish_urls(entries)
    print(f"stored {n} into {type(store).__name__} in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")  # GOOGLE_CLOUD_PROJECT
    os.environ.setdefault("VERDICT_STDOUT", "0")
    main()
