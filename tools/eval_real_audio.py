"""Private held-out check on REAL scam calls published by the Nagano Prefectural Police
(https://www.pref.nagano.lg.jp/police/jikenjiko/tokushu/onsei.html - "All Rights Reserved", no reuse licence).

  python tools/eval_real_audio.py download                 # -> backend/eval/real_heldout/ (git-ignored)
  python tools/eval_real_audio.py score https://<service>  # uploads each file to /check, prints levels only

Rules of use (PLAN 6 / CLAUDE.md): private evaluation only. The audio, the transcripts and anything derived from
their wording are never committed, never used to write rules or prompts, never shown in the demo video. Only
aggregate numbers are reported, with the source cited. All recordings are scam calls: this measures recall only.
"""
import json, pathlib, sys, time, urllib.request, urllib.error, uuid

BASE = "https://www.pref.nagano.lg.jp/police/jikenjiko/tokushu/documents/"
OUT = pathlib.Path(__file__).resolve().parents[1] / "backend" / "eval" / "real_heldout"
# (file, playbook, note) - multi-part cases are successive calls of ONE scam: early parts may be build-up only
FILES = [("k1-1.mp3", "fake_police", ""), ("k1-2.mp3", "fake_police", ""), ("k1-3.mp3", "fake_police", "cash card"),
         ("k1-4.mp3", "fake_police", ""), ("240304_aizituroku.mp3", "fake_billing", "carrier impersonation"),
         ("s1.mp3", "refund", ""), ("n2.mp3", "family_impersonation", ""), ("n6.mp3", "family_impersonation", ""),
         ("n1-1.mp3", "family_impersonation", "part 1 of 7"), ("n1-2.mp3", "family_impersonation", "part 2 of 7"),
         ("n1-3.mp3", "family_impersonation", "part 3 of 7"), ("n5-1.mp3", "family_impersonation", "part 1 of 7"),
         ("n5-2.mp3", "family_impersonation", "part 2 of 7"), ("n7-2.mp3", "family_impersonation", "part 2 of 2"),
         ("n8-2.mp3", "family_impersonation", "part 2 of 2"), ("n1-4.mp3", "family_impersonation", "part 4 of 7"),
         ("n1-5.mp3", "family_impersonation", "part 5 of 7"), ("n1-6.mp3", "family_impersonation", "part 6 of 7"),
         ("n1-7.mp3", "family_impersonation", "part 7 of 7"), ("n4-1.mp3", "family_impersonation", "part 1 of 6"),
         ("n4-2.mp3", "family_impersonation", "part 2 of 6"), ("n4-3.mp3", "family_impersonation", "part 3 of 6"),
         ("n4-4.mp3", "family_impersonation", "part 4 of 6"), ("n4-5.mp3", "family_impersonation", "part 5 of 6"),
         ("n4-6.mp3", "family_impersonation", "part 6 of 6"), ("n5-3.mp3", "family_impersonation", "part 3 of 7"),
         ("n5-4.mp3", "family_impersonation", "part 4 of 7"), ("n5-5.mp3", "family_impersonation", "part 5 of 7"),
         ("n5-6.mp3", "family_impersonation", "part 6 of 7"), ("n5-7.mp3", "family_impersonation", "part 7 of 7"),
         ("n7-1.mp3", "family_impersonation", "part 1 of 2"), ("n8-1.mp3", "family_impersonation", "part 1 of 2"),
         ("n9-1.mp3", "family_impersonation", "part 1 of 3"), ("n9-2.mp3", "family_impersonation", "part 2 of 3"),
         ("n9-3.mp3", "family_impersonation", "part 3 of 3"),
         ("kinyusagi.wma", "investment", "corporate-bond sale, 10 min")]


def download() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, _, _ in FILES:
        target = OUT / name
        if not target.exists():
            req = urllib.request.Request(BASE + name, headers={"User-Agent": "Mozilla/5.0 (evaluation; one-off download)"})
            target.write_bytes(urllib.request.urlopen(req, timeout=120).read())
            time.sleep(1)  # be polite to a public server
        print(f"{name:26} {target.stat().st_size / 1024:7.0f} KB")


def score(url: str) -> None:
    order, rows = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}, []
    for name, playbook, note in FILES:
        path = OUT / name
        if not path.exists():
            continue
        b = uuid.uuid4().hex
        body = (f'--{b}\r\nContent-Disposition: form-data; name="lang"\r\n\r\nja\r\n--{b}\r\nContent-Disposition: form-data; '
                f'name="audio"; filename="{name}"\r\nContent-Type: audio/mpeg\r\n\r\n').encode() + path.read_bytes() + f"\r\n--{b}--\r\n".encode()
        req = urllib.request.Request(url.rstrip("/") + "/check", data=body, method="POST",
                                     headers={"Content-Type": f"multipart/form-data; boundary={b}"})
        t = time.time()
        try:
            out = json.loads(urllib.request.urlopen(req, timeout=300).read())
        except urllib.error.HTTPError as e:
            out = {"risk_level": f"HTTP {e.code}", "risk_score": -1, "scam_type": "-", "stage": "-"}
        rows.append({"file": name, "expected_type": playbook, "note": note, "seconds": round(time.time() - t, 1),
                     **{k: out.get(k) for k in ("risk_level", "risk_score", "scam_type", "stage", "evidence_flags")}})
        r = rows[-1]
        print(f"{name:24} {playbook:21} -> {str(r['risk_level']):8} {str(r['risk_score']):>3} type={r['scam_type']} stage={r['stage']} {r['seconds']}s {note}")
        time.sleep(3)  # the public API is rate-limited
    ok = [r for r in rows if r["risk_level"] in order]
    for th in ("MEDIUM", "HIGH"):
        hit = sum(order[r["risk_level"]] >= order[th] for r in ok)
        print(f"recall at {th}: {hit}/{len(ok)} = {hit / len(ok):.0%}" if ok else "no results")
    print("type matches the playbook:", sum(r["scam_type"] == r["expected_type"] for r in ok), "/", len(ok))
    (OUT / "results.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")  # levels only, no transcripts


if __name__ == "__main__":
    download() if sys.argv[1:2] == ["download"] else score(sys.argv[2])
