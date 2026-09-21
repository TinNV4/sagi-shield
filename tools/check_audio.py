"""POST each synthetic test call (tools/make_test_audio.ps1) to /check as an audio upload and compare with the
expected level. Run from the repo root:  python tools/check_audio.py https://<service-url>"""
import json, sys, time, uuid, pathlib, urllib.request, urllib.error

BASE = sys.argv[1].rstrip("/")
calls = json.loads(pathlib.Path("tools/test_calls.json").read_text(encoding="utf-8"))
files = [(c, pathlib.Path("tools/test_audio") / f"{c['name']}{suffix}.wav") for c in calls for suffix in ("", "_fci")]
for call, wav in files:
    if not wav.exists():
        continue
    boundary = uuid.uuid4().hex
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="lang"\r\n\r\n{call["culture"][:2]}\r\n'.encode(),
             f'--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="{wav.name}"\r\nContent-Type: audio/wav\r\n\r\n'.encode(),
             wav.read_bytes(), f"\r\n--{boundary}--\r\n".encode()]
    req = urllib.request.Request(BASE + "/check", data=b"".join(parts), method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    t = time.time()
    try:
        out = json.loads(urllib.request.urlopen(req, timeout=180).read())
    except urllib.error.HTTPError as e:
        out = {"HTTP": e.code, "body": e.read().decode()[:200]}
    ok = "OK  " if out.get("risk_level") == call["expect"] else "MISS"
    print(f"{ok} {wav.stem:30} expect {call['expect']:5} got {out.get('risk_level')} {out.get('risk_score')} "
          f"type={out.get('scam_type')} flags={out.get('evidence_flags')} {time.time() - t:.0f}s")
    if ok == "MISS":
        print("     ", json.dumps(out, ensure_ascii=False)[:400])
