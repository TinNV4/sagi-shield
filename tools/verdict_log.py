"""Read a verdict log (JSONL from VERDICT_LOG, or Cloud Logging export) and show WHY.

  python tools/verdict_log.py backend/eval/logs/replay.jsonl                 # summary: looks per level, reasons per playbook
  python tools/verdict_log.py backend/eval/logs/replay.jsonl --session 3f2a  # one call, look by look
  python tools/verdict_log.py backend/eval/logs/replay.jsonl --level MEDIUM  # every record that ended at that level
  gcloud logging read 'jsonPayload.kind="live_look"' --format=json | python tools/verdict_log.py -   # Cloud Run

Prints levels, scores, stages, rule hits and the judge's reasons - never a transcript (the log holds none unless it
was written with LOG_TEXT=1, and even then --text is needed to show it).
"""
import argparse, collections, json, sys


def load(path: str) -> list[dict]:
    raw = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    if raw.lstrip().startswith("["):  # gcloud --format=json: a list of log entries with jsonPayload
        return [e.get("jsonPayload", e) for e in json.loads(raw)]
    return [json.loads(l) for l in raw.splitlines() if l.strip()]


def short(rec: dict) -> str:
    llm = rec.get("llm") or {}
    hits = ", ".join(f"{k.lower()}:{len(v)}" for k, v in ((rec.get("rules") or {}).get("hits") or {}).items())
    second = rec.get("second")
    parts = [f"{rec.get('ts', '')[11:19]}", f"look {rec.get('look', '-'):>2}" if "look" in rec else rec.get("kind", ""),
             f"{rec.get('trigger', ''):5}", f"{rec.get('level', '?'):6} {rec.get('score', '?'):>3}",
             f"rules {(rec.get('rules') or {}).get('score', '-'):>3} [{hits}]",
             f"llm {llm.get('risk', '-'):>3} st{llm.get('stage', '-')} {llm.get('scam_type', '-')} c{llm.get('confidence', '-')}" if llm else f"llm -- {rec.get('llm_error', '')}",
             "2nd " + (f"{second.get('risk', '?')} {second.get('scam_type', '?')}" if second and "risk" in second else second.get("error", "")) if second else "",
             "LATCHED" if rec.get("latched") else "", "veto" if rec.get("review_veto") else "", "precursor" if rec.get("precursor") else "",
             f"{rec.get('latency_ms', '')}ms"]
    return "  ".join(p for p in parts if p)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Japanese reasons on a cp932 Windows console
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--session", help="show one call look by look (prefix match)")
    ap.add_argument("--level", choices=["LOW", "MEDIUM", "HIGH"])
    ap.add_argument("--kind", help="check | live_look | precheck ...")
    ap.add_argument("--text", action="store_true", help="also print the window text when the log holds it")
    a = ap.parse_args()
    recs = load(a.path)
    if a.kind:
        recs = [r for r in recs if r.get("kind") == a.kind]
    if a.level:
        recs = [r for r in recs if r.get("level") == a.level]
    if a.session:
        recs = [r for r in recs if str(r.get("session", "")).startswith(a.session)]
    if a.session or a.level:
        for r in recs:
            print(short(r))
            if r.get("call_state"):
                print(f"           state: {r['call_state']}")
            for reason in (r.get("llm") or {}).get("reasons") or r.get("reasons") or []:
                print(f"           why:   {reason}")
            if a.text and r.get("text"):
                print("           text:  " + r["text"].replace("\n", " / ")[:300])
        return
    by_kind = collections.Counter(r.get("kind") for r in recs)
    print("records:", dict(by_kind))
    levels = collections.Counter((r.get("kind"), r.get("level")) for r in recs)
    for (k, lv), n in sorted(levels.items(), key=lambda x: (str(x[0][0]), str(x[0][1]))):
        print(f"  {k:10} {lv or '-':7} {n}")
    triggers = collections.Counter(r.get("trigger") for r in recs if r.get("kind") == "live_look")
    if triggers:
        print("looks by trigger:", dict(triggers))
    lat = [r["latency_ms"] for r in recs if r.get("latency_ms") is not None]
    if lat:
        lat.sort()
        print(f"latency ms: median {lat[len(lat) // 2]}  p90 {lat[int(len(lat) * 0.9)]}  max {lat[-1]}")
    errors = sum(1 for r in recs if r.get("llm_error"))
    if errors:
        print("looks without a verdict:", errors)
    reasons = collections.defaultdict(collections.Counter)
    for r in recs:
        llm = r.get("llm") or {}
        for reason in llm.get("reasons") or r.get("reasons") or []:
            reasons[llm.get("scam_type") or r.get("scam_type") or "?"][reason] += 1
    for scam, c in sorted(reasons.items(), key=lambda x: -sum(x[1].values())):
        print(f"\n{scam} ({sum(c.values())} reasons)")
        for reason, n in c.most_common(5):
            print(f"  {n:3}  {reason}")
    sessions = collections.defaultdict(list)
    for r in recs:
        if r.get("kind") == "live_look":
            sessions[r.get("session")].append(r)
    if sessions:
        print("\ncalls (last look):")
        for s, rs in sessions.items():
            last = rs[-1]
            first_high = next((r.get("look") for r in rs if r.get("level") == "HIGH"), None)
            print(f"  {s}  looks {len(rs):2}  ends {last.get('level', '?'):6} {last.get('score', '?'):>3}  first HIGH at look {first_high}")


if __name__ == "__main__":
    main()
