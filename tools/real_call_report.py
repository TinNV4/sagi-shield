"""Join the real-call observer sheet with the deployed service's verdict log (docs/REAL_CALL_TEST.md).

  python tools/real_call_report.py --sheet tools/real_call_sheet.csv --fetch --project sagi-shield-560661 --date 2026-10-18
  python tools/real_call_report.py --sheet tools/real_call_sheet.csv --logs live.json   # saved `gcloud logging read --format=json`

One row per call: sentences the server heard, the highest level it showed, the sentence and second that raised the
alarm, and pass / fail against the sheet's `expect`. Counts only - the log holds no transcript and neither does this.
"""
import argparse, collections, csv, json, shutil, subprocess, sys
from datetime import datetime, timedelta, timezone

RANK = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
KINDS = ("live_call", "live_alarm", "live_look")


def fetch(project: str, date: str, tz: timezone) -> list[dict]:
    day = datetime.fromisoformat(date).replace(tzinfo=tz)
    start, end = day.astimezone(timezone.utc), (day + timedelta(days=1)).astimezone(timezone.utc)
    flt = (f'jsonPayload.kind=("{KINDS[0]}" OR "{KINDS[1]}" OR "{KINDS[2]}") '
           f'AND timestamp>="{start:%Y-%m-%dT%H:%M:%SZ}" AND timestamp<"{end:%Y-%m-%dT%H:%M:%SZ}"')
    gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not gcloud:
        sys.exit("gcloud not found on PATH (on Windows it lives in %LOCALAPPDATA%\\Google\\Cloud SDK\\google-cloud-sdk\\bin)")
    out = subprocess.run([gcloud, "logging", "read", flt, "--project", project, "--format=json", "--limit=5000"],
                         capture_output=True, text=True, encoding="utf-8", check=True).stdout
    return parse(out)


def parse(raw: str) -> list[dict]:
    raw = raw.strip()
    if raw.startswith("["):  # gcloud: a list of log entries
        return [e.get("jsonPayload", e) for e in json.loads(raw)]
    return [json.loads(line) for line in raw.splitlines() if line.strip()]  # VERDICT_LOG JSONL


def ts(rec: dict) -> datetime:
    return datetime.fromisoformat(rec["ts"].replace("Z", "+00:00"))


def calls_from(records: list[dict]) -> list[dict]:
    by = collections.defaultdict(lambda: {"looks": [], "alarm": None, "call": None})
    for r in records:
        if r.get("kind") not in KINDS or not r.get("session"):
            continue
        slot = by[r["session"]]
        if r["kind"] == "live_call":
            slot["call"] = r
        elif r["kind"] == "live_alarm":
            slot["alarm"] = r
        else:
            slot["looks"].append(r)
    calls = []
    for session, s in by.items():
        c = s["call"]
        if c:
            start = ts(c) - timedelta(seconds=c.get("duration_s", 0))
            lines, level = c.get("lines"), c.get("max_level", "LOW")
        else:  # still open, or the instance died before the socket closed: rebuild from what is there
            first = min((ts(r) for r in s["looks"] + [s["alarm"]] if r), default=None)
            if first is None:
                continue
            start = first
            lines = max((r.get("line", 0) for r in s["looks"]), default=None)
            level = "HIGH" if s["alarm"] else max((r.get("level", "LOW") for r in s["looks"]), key=RANK.get, default="LOW")
        a = s["alarm"]
        calls.append({"session": session, "start": start, "lines": lines, "level": level, "open": c is None,
                      "looks": len(s["looks"]), "alarm_line": a.get("line") if a else None,
                      "alarm_s": a.get("seconds") if a else None, "precursor": (c or {}).get("precursor"),
                      "prior": (c or {}).get("prior"), "stt_lang": (c or a or s["looks"][0]).get("lang")})
    return sorted(calls, key=lambda x: x["start"])


def show(x) -> str:
    return "-" if x is None else str(x)


def verdict(expect: str, level: str) -> str:
    if expect == "HIGH":
        return "pass" if level == "HIGH" else "FAIL"
    if expect == "MEDIUM+":
        return "pass" if RANK[level] >= 1 else "FAIL"
    return "FALSE ALARM" if level == "HIGH" else ("pass (MEDIUM)" if level == "MEDIUM" else "pass")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", required=True)
    ap.add_argument("--logs", help="saved gcloud JSON or a VERDICT_LOG JSONL file ('-' = stdin)")
    ap.add_argument("--fetch", action="store_true", help="read the day's records from Cloud Logging")
    ap.add_argument("--project", default="sagi-shield-560661")
    ap.add_argument("--date", help="YYYY-MM-DD in --tz (default: the sheet's day is today)")
    ap.add_argument("--tz", type=float, default=9.0, help="UTC offset of start_jst, hours (default 9)")
    ap.add_argument("--grace", type=int, default=120, help="seconds a call may start before its sheet time")
    a = ap.parse_args()
    tz = timezone(timedelta(hours=a.tz))
    date = a.date or datetime.now(tz).date().isoformat()
    if a.fetch:
        records = fetch(a.project, date, tz)
    elif a.logs:
        records = parse(sys.stdin.read() if a.logs == "-" else open(a.logs, encoding="utf-8").read())
    else:
        sys.exit("give --fetch or --logs")
    rows = [r for r in csv.DictReader(open(a.sheet, encoding="utf-8-sig")) if r.get("start_jst", "").strip()]
    for r in rows:
        r["_start"] = datetime.fromisoformat(f"{date}T{r['start_jst'].strip()}").replace(tzinfo=tz)
    rows.sort(key=lambda r: r["_start"])
    calls = calls_from(records)

    matched = collections.defaultdict(list)
    unmatched = []
    for c in calls:
        # the sheet time nearest to the call start, within the clock slack; else the last row before it (a call that
        # was split by Stop/Start or a silence reset belongs to the run that was going on)
        near = [r for r in rows if abs((r["_start"] - c["start"]).total_seconds()) <= a.grace]
        before = [r for r in rows if r["_start"] <= c["start"]]
        row = (min(near, key=lambda r: abs((r["_start"] - c["start"]).total_seconds())) if near
               else (before[-1] if before else None))
        (matched[row["run_id"]] if row else unmatched).append(c)

    print(f"Real-call field test {date}: {len(rows)} sheet rows, {len(calls)} calls in the log\n")
    print("| run | script | lang | stt | expect | calls | sentences | highest | alarm at sentence | alarm s | observer line | spoken | guardian s | result |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    tally = collections.Counter()
    for r in rows:
        cs = matched.get(r["run_id"], [])
        level = max((c["level"] for c in cs), key=RANK.get, default="-")
        res = verdict(r["expect"], level) if cs else "NO LOG"
        main_call = max(cs, key=lambda c: (RANK[c["level"]], c["lines"] or 0), default={})
        note = " (open)" if main_call.get("open") else ""
        print(f"| {r['run_id']} | {r['script']} | {r['lang']} | {r.get('stt_mode') or '?'} | {r['expect']} | {len(cs)} | "
              f"{show(main_call.get('lines'))}{note} | {level} | {show(main_call.get('alarm_line'))} | "
              f"{show(main_call.get('alarm_s'))} | {r.get('line_high') or r.get('line_medium') or '-'} | "
              f"{r.get('spoken_alert') or '-'} | {r.get('guardian_s') or '-'} | {res} |")
        kind = "scam" if r["expect"] in ("HIGH", "MEDIUM+") else "benign"
        tally[(kind, "n")] += 1
        if cs:
            tally[(kind, level)] += 1
        if len(cs) > 1:
            tally["split"] += 1
    print()
    print(f"scam calls: {tally[('scam', 'n')]}, warned (MEDIUM+) {tally[('scam', 'MEDIUM')] + tally[('scam', 'HIGH')]}, "
          f"alarmed (HIGH) {tally[('scam', 'HIGH')]}")
    print(f"benign calls: {tally[('benign', 'n')]}, false alarms (HIGH) {tally[('benign', 'HIGH')]}, "
          f"at MEDIUM {tally[('benign', 'MEDIUM')]}")
    if tally["split"]:
        print(f"{tally['split']} sheet row(s) matched more than one call: Stop/Start pressed mid-call, or a silence reset")
    if unmatched:
        print(f"{len(unmatched)} call(s) started before the first sheet row - not counted")


if __name__ == "__main__":
    main()
