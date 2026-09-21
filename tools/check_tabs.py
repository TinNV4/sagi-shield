"""Exercise the Quick Check tabs (phone / link / screenshot) against a running API, sending exactly what the UI sends.
Run from the repo root:  python tools/check_tabs.py https://<service-url>
Note: the last case files three reports for a made-up number - use a throw-away store or accept the test rows."""
import io, json, sys, time, uuid, urllib.request, urllib.error
from PIL import Image, ImageDraw, ImageFont

BASE = sys.argv[1].rstrip("/")

def post(fields, files=None):
    b = uuid.uuid4().hex
    body = b"".join(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items())
    for k, (name, data, mime) in (files or {}).items():
        body += f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + data + b"\r\n"
    body += f"--{b}--\r\n".encode()
    req = urllib.request.Request(BASE + "/check", data=body, method="POST", headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    t = time.time()
    try:
        out = json.loads(urllib.request.urlopen(req, timeout=120).read())
    except urllib.error.HTTPError as e:
        out = {"HTTP": e.code, "body": e.read().decode()[:200]}
    return out, time.time() - t

def show(title, fields, files=None):
    out, dt = post(fields, files)
    keep = {k: out.get(k) for k in ("risk_level", "risk_score", "scam_type", "reasons", "evidence_flags", "community_hits")} if "HTTP" not in out else out
    print(f"\n## {title} ({dt:.1f}s)\n{json.dumps(keep, ensure_ascii=False)}")
    return out

def picture(lines):
    img = Image.new("RGB", (900, 600), "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/msgothic.ttc", 44)
    except OSError:
        font = ImageFont.load_default()
    for i, line in enumerate(lines):
        d.text((60, 60 + i * 80), line, fill="black", font=font)
    buf = io.BytesIO(); img.save(buf, "PNG"); return buf.getvalue()

# exactly what the UI tabs send
show("PHONE tab: international number", {"lang": "ja", "phone": "+44 20 7946 0000"})
show("PHONE tab: ordinary domestic number", {"lang": "ja", "phone": "03-3210-0000"})
show("LINK tab: bank lookalike on a bad TLD", {"lang": "ja", "url": "https://smbc-card-kakunin.top/login", "text": "https://smbc-card-kakunin.top/login"})
show("LINK tab: official site", {"lang": "ja", "url": "https://www.npa.go.jp/", "text": "https://www.npa.go.jp/"})
show("SCREENSHOT tab: fake arrest warrant", {"lang": "ja"}, {"image": ("warrant.png", picture(["逮 捕 状", "被疑者 山田 花子", "罪名 詐欺・資金洗浄", "東京地方裁判所 裁判官"]), "image/png")})
show("SCREENSHOT tab: harmless chat", {"lang": "ja"}, {"image": ("chat.png", picture(["お母さん、今日の夕飯なに？", "カレーだよ。7時に帰ってきてね", "了解！"]), "image/png")})
# report a number three times, then check it again -> community signal
for n in range(3):  # three different reporters: community_hits counts distinct ones
    urllib.request.urlopen(urllib.request.Request(BASE + "/report", method="POST", headers={"Content-Type": "application/json"},
        data=json.dumps({"scam_type": "fake_police", "phone": "+81 50 5555 0142", "keywords": ["警察"], "prefecture": "東京都", "consent": True, "reporter_id": f"check-tabs-{n}"}).encode()), timeout=30).read()
show("PHONE tab: a number the community reported 3x", {"lang": "ja", "phone": "+81 50 5555 0142"})
