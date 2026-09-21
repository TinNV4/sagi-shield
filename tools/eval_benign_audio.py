"""False alarms on REAL human speech that is not a scam: public-domain Japanese LibriVox recordings from archive.org
(sources, sizes and licences in tools/benign_audio_sources.json). Literature read aloud is not a phone call - it is the
"radio / TV / audiobook next to the always-on kiosk" case, with real voices, real microphones and old novels that do
mention police, money and crime. Expected level for every file: LOW.

  python tools/eval_benign_audio.py download                 # -> backend/eval/real_benign/ (git-ignored, ~45 MB)
  python tools/eval_benign_audio.py score https://<service>  # uploads each file to /check, prints levels only
"""
import json, pathlib, sys, time, urllib.request, urllib.error, uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "backend" / "eval" / "real_benign"
SOURCES = json.loads((ROOT / "tools" / "benign_audio_sources.json").read_text(encoding="utf-8"))
UA = {"User-Agent": "SagiShieldEval/0.1 (private evaluation)"}


def download() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for s in SOURCES:
        target = OUT / f"{s['id']}.mp3"
        if not target.exists():
            url = f"https://archive.org/download/{s['id']}/{urllib.request.quote(s['file'])}"
            for attempt in (1, 2, 3):  # archive.org answers 500 / 503 now and then
                try:
                    target.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read())
                    break
                except Exception as e:
                    print(f"  {s['id']}: {type(e).__name__} (attempt {attempt})")
                    time.sleep(5 * attempt)
            if not target.exists():
                continue
            time.sleep(1)
        print(f"{target.name:46} {target.stat().st_size / 1024:6.0f} KB")


def score(url: str) -> None:
    order, rows = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}, []
    for s in SOURCES:
        path = OUT / f"{s['id']}.mp3"
        if not path.exists():
            continue
        b = uuid.uuid4().hex
        body = (f'--{b}\r\nContent-Disposition: form-data; name="lang"\r\n\r\nja\r\n--{b}\r\nContent-Disposition: form-data; '
                f'name="audio"; filename="{path.name}"\r\nContent-Type: audio/mpeg\r\n\r\n').encode() + path.read_bytes() + f"\r\n--{b}--\r\n".encode()
        req = urllib.request.Request(url.rstrip("/") + "/check", data=body, method="POST", headers={"Content-Type": f"multipart/form-data; boundary={b}"})
        t = time.time()
        try:
            out = json.loads(urllib.request.urlopen(req, timeout=400).read())
        except urllib.error.HTTPError as e:
            out = {"risk_level": f"HTTP {e.code}", "risk_score": -1}
        rows.append({"id": s["id"], "secs": s["secs"], "risk_level": out.get("risk_level"), "risk_score": out.get("risk_score"),
                     "scam_type": out.get("scam_type"), "flags": out.get("evidence_flags"), "took": round(time.time() - t, 1)})
        r = rows[-1]
        print(f"{s['id'][:40]:40} {s['secs']:4}s -> {str(r['risk_level']):8} {str(r['risk_score']):>3} type={r['scam_type']} flags={r['flags']} {r['took']}s")
        time.sleep(3)
    ok = [r for r in rows if r["risk_level"] in order]
    for th in ("MEDIUM", "HIGH"):
        n = sum(order[r["risk_level"]] >= order[th] for r in ok)
        print(f"false alarms at {th}: {n}/{len(ok)}")
    (OUT / "results.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    download() if sys.argv[1:2] == ["download"] else score(sys.argv[2])
