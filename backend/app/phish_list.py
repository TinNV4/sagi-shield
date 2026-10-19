"""
Sagi Shield - load the JPCERT/CC phishing URL list (github.com/JPCERTCC/phishurl-list, monthly CSVs) into the store.

    python -m app.phish_list --months 2          # what the monthly Cloud Run Job runs (STORE=firestore in its env)
    python -m app.phish_list --months 3 --dry-run

Columns (README of the repo): date (confirmed by JPCERT/CC), URL (entire phishing URL), description (spoofed brand).
Stored per URL: hashed URL key, brand, date, source - never the URL in clear (storage.phish_keys). Loading is
idempotent: URLs already in the store are skipped, so the job can re-read last month without inflating host counts.
The list lags by weeks to months and is Japanese-brand phishing; a miss proves nothing (the check says so).
Attribution: JPCERT/CC. The repo carries no licence file - keep the data server-side, do not redistribute it.
tools/load_phish_list.py is the laptop wrapper (local CSV files, gcloud user token instead of ADC).
"""
from __future__ import annotations

import argparse
import csv
import io
import sys
import time
import urllib.request
from datetime import date

RAW = "https://raw.githubusercontent.com/JPCERTCC/phishurl-list/main/{year}/{ym}.csv"
SOURCE = "jpcertcc"


def months_back(n: int, today: date | None = None) -> list[str]:
    """['202610', '202609', ...]: the current month first. JPCERT/CC publishes a month after it ends."""
    today = today or date.today()
    y, m = today.year, today.month
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
    except Exception as e:  # noqa: BLE001 - a month not published yet is normal
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


def collect(months: int) -> list[dict]:
    entries: list[dict] = []
    for ym in months_back(months):
        text = fetch(ym)
        if text:
            got = parse(text)
            print(f"  {ym}: {len(got)} urls")
            entries += got
    return entries


def load(store, entries: list[dict]) -> int:
    """Store the entries; returns the number of URLs that were new."""
    t0 = time.time()
    n = store.add_phish_urls(entries)
    print(f"{n} new of {len(entries)} urls into {type(store).__name__} in {time.time() - t0:.1f}s")
    return n


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--months", type=int, default=2, help="months back from the current one (default 2: this and last)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")
    entries = collect(a.months)
    hosts = {e["url"].split("/")[2].lower() for e in entries if "//" in e["url"]}
    print(f"{len(entries)} urls, {len(hosts)} hosts, source={SOURCE}")
    if not entries:  # no month of the window could be read: a failed execution, so it shows up in the job's history
        return 1
    if a.dry_run:
        return 0
    from app.storage import STORE
    load(STORE, entries)
    return 0


if __name__ == "__main__":
    sys.exit(main())
