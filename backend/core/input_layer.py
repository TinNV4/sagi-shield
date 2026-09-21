"""
Sagi Shield - input layer (reusable).
Every input (text / image / audio file / phone / URL) -> one `Evidence` object -> risk_engine.

Usage:
  pip install pydantic phonenumbers pillow   # phonenumbers & pillow optional
  python input_layer.py --lang vi --text "Cong an day, goi lai 0283xxxxxxx hoac vao https://bit.ly/abc"
  python input_layer.py --lang ja --phone "+44 20 7946 0000" --url "http://xn--pl-2ja.jp"
  python input_layer.py --lang ja --image fake_warrant.png --audio call.m4a
"""
from __future__ import annotations
import argparse, hashlib, hmac, io, json, os, re, subprocess, unicodedata
from urllib.parse import urlparse
from pydantic import BaseModel, Field

# HMAC key: the phone-number space is small, so a plain salted hash is brute-forceable once the salt
# leaks. In production HASH_KEY comes from Secret Manager (mounted as an env var on Cloud Run).
HASH_KEY = (os.getenv("HASH_KEY") or os.getenv("HASH_SALT", "change-me")).encode()

def phone_hmac(digits: str) -> str:
    return hmac.new(HASH_KEY, digits.encode(), hashlib.sha256).hexdigest()[:32]
REGION = {"ja": "JP", "vi": "VN"}

class PhoneInfo(BaseModel):
    e164: str | None = None
    hash: str                      # store this, never the raw number
    is_international: bool = False
    country: str | None = None

class UrlInfo(BaseModel):
    domain: str
    flags: list[str] = []          # shortener, punycode, ip_host, suspicious_tld, lookalike

class Evidence(BaseModel):
    source_types: list[str] = []
    lang: str
    text: str = ""                 # normalized text for rules/LLM
    text_variants: list[str] = []  # e.g. Vietnamese without diacritics
    phones: list[PhoneInfo] = []
    urls: list[UrlInfo] = []
    accounts_masked: list[str] = []
    media: dict = Field(default_factory=dict)  # prepared bytes/paths for Gemini (not serialized)
    flags: list[str] = []

    def summary(self) -> dict:
        return self.model_dump(exclude={"media"})

# ---------------- Text ----------------
def normalize_text(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)          # ＬＩＮＥ -> LINE, ０９０ -> 090
    s = re.sub(r"[\u200b-\u200f\ufeff]", "", s)   # zero-width chars used to dodge filters
    s = re.sub(r"[\u2010-\u2015\u2212]", "-", s)  # dash variants (03−1234‐5678)
    s = re.sub(r"(?<=\d)[\u30fc\uff70](?=\d)", "-", s)  # the katakana long vowel is a dash only between digits
    return re.sub(r"\s+", " ", s).strip()

def strip_vi_diacritics(s: str) -> str:
    s = s.replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")

PHONE_RE = re.compile(r"(?:\+|00)?\d[\d\-\s()]{7,}\d")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>\"'、。]+|\b[a-z0-9-]+\.(?:com|net|vn|jp|xyz|top|info|site|online|shop)\b[^\s]*", re.I)
# account numbers only when a keyword precedes them (otherwise treated as phone candidates)
ACCOUNT_RE = re.compile(r"(?:STK|số tài khoản|tài khoản|口座番号|口座)\s*[:：]?\s*(\d[\d\s-]{5,20}\d)", re.I)

def mask(s: str) -> str:
    d = re.sub(r"\D", "", s)
    return f"{'*' * max(0, len(d) - 3)}{d[-3:]}"

# ---------------- Phone ----------------
def analyze_phone(raw: str, lang: str) -> PhoneInfo | None:
    digits = re.sub(r"[^\d+]", "", raw)
    info = PhoneInfo(hash=phone_hmac(digits))
    try:
        import phonenumbers
        n = phonenumbers.parse(digits, REGION.get(lang, "JP"))
        if not phonenumbers.is_possible_number(n):
            return None
        info.e164 = phonenumbers.format_number(n, phonenumbers.PhoneNumberFormat.E164)
        info.hash = phone_hmac(info.e164)  # same number, same hash, however it was typed
        info.country = phonenumbers.region_code_for_number(n)
        info.is_international = info.country != REGION.get(lang)
    except Exception:
        info.is_international = digits.startswith(("+", "00", "010"))  # 010 = JP intl prefix
    return info

# ---------------- URL (never fetch the URL itself) ----------------
SHORTENERS = {"bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "cutt.ly", "rb.gy", "s.id"}
BAD_TLDS = {"xyz", "top", "site", "online", "shop", "click", "icu", "buzz"}
# brand keyword -> official domain suffixes (extend per market)
BRANDS = {"ja": {"npa": ["npa.go.jp"], "police": [".lg.jp", "police.pref"], "mufg": ["mufg.jp"],
                 "smbc": ["smbc.co.jp"], "mizuho": ["mizuhobank.co.jp"], "yucho": ["jp-bank.japanpost.jp"]},
          "vi": {"bocongan": ["bocongan.gov.vn"], "vneid": ["vneid.gov.vn"], "vietcombank": ["vietcombank.com.vn"],
                 "techcombank": ["techcombank.com"], "bidv": ["bidv.com.vn"], "agribank": ["agribank.com.vn"]}}

def analyze_url(raw: str, lang: str) -> UrlInfo:
    u = raw if raw.startswith("http") else "http://" + raw
    host = (urlparse(u).hostname or "").lower()
    flags = []
    if host in SHORTENERS: flags.append("shortener")
    if "xn--" in host: flags.append("punycode")
    if re.fullmatch(r"[\d.]+", host): flags.append("ip_host")
    if host.rsplit(".", 1)[-1] in BAD_TLDS: flags.append("suspicious_tld")
    plain = host.replace("-", "")
    for key, official in BRANDS.get(lang, {}).items():
        if key in plain and not any(o in host for o in official):
            flags.append("lookalike")  # brand name in a non-official domain
    return UrlInfo(domain=host, flags=sorted(set(flags)))

# ---------------- Image ----------------
def prepare_image(path, max_side: int = 1600) -> bytes:
    """Resize + strip EXIF (location/device PII) before sending to Gemini vision."""
    from PIL import Image
    img = Image.open(path).convert("RGB")
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)  # re-encode drops EXIF
    return buf.getvalue()

# ---------------- Audio file ----------------
def prepare_audio(path: str) -> bytes:
    """Any format -> 16 kHz mono PCM16 WAV (what Chirp STT / Gemini expect)."""
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", "16000",
                          "-f", "wav", "pipe:1"], capture_output=True, check=True)
    return out.stdout

# ---------------- Builder ----------------
def build_evidence(lang: str = "ja", text: str | None = None, image: str | None = None,
                   audio: str | None = None, phone: str | None = None,
                   url: str | None = None) -> Evidence:
    ev = Evidence(lang=lang)
    if text:
        ev.source_types.append("text")
        ev.text = normalize_text(text)
    if image:
        ev.source_types.append("image"); ev.media["image_jpeg"] = prepare_image(image)
    if audio:
        ev.source_types.append("audio"); ev.media["audio_wav"] = prepare_audio(audio)
    # entities from text + explicit fields (accounts first so they aren't read as phones)
    accounts = ACCOUNT_RE.findall(ev.text)
    ev.accounts_masked = [mask(a) for a in accounts]
    body = ACCOUNT_RE.sub(lambda m: m.group(0).replace(m.group(1), "<ACCOUNT>"), ev.text)
    phones = PHONE_RE.findall(body) + ([phone] if phone else [])
    urls = URL_RE.findall(ev.text) + ([url] if url else [])
    for p in dict.fromkeys(phones):
        info = analyze_phone(p, lang)
        if info: ev.phones.append(info)
    for u in dict.fromkeys(urls): ev.urls.append(analyze_url(u, lang))
    if phone: ev.source_types.append("phone")
    if url: ev.source_types.append("url")
    # mask raw numbers in text before it goes to logs/LLM
    ev.text = PHONE_RE.sub("<PHONE>", body)
    if lang == "vi" and ev.text:
        ev.text_variants.append(strip_vi_diacritics(ev.text).lower())
    # evidence-level flags
    if any(p.is_international for p in ev.phones): ev.flags.append("international_number")
    for u in ev.urls: ev.flags += [f"url_{f}" for f in u.flags]
    ev.flags = sorted(set(ev.flags))
    return ev

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="ja", choices=["ja", "vi"])
    for k in ("text", "image", "audio", "phone", "url"): ap.add_argument(f"--{k}")
    a = ap.parse_args()
    ev = build_evidence(a.lang, a.text, a.image, a.audio, a.phone, a.url)
    print(json.dumps(ev.summary(), ensure_ascii=False, indent=2))
