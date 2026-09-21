"""
Sagi Shield - HTTP API (PLAN section 9). A thin wrapper over backend/core.

  cd backend && uvicorn app.main:app --reload --port 8080
  curl -s localhost:8080/check -H "content-type: application/json" \
       -d '{"text":"警察です。LINEで逮捕状を送ります","lang":"ja"}'

Env: USE_LLM=0 rules only · STORE=firestore · USE_WEBRISK=1 · CORS_ORIGINS=https://a,https://b
"""
from __future__ import annotations
import io
import logging
import os
import sys
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core"))
from input_layer import URL_RE, analyze_phone, build_evidence, normalize_text, prepare_image  # noqa: E402
from risk_engine import LANG_PACKS, analyze, level  # noqa: E402

from . import services  # noqa: E402
from .agent import router as agent_router  # noqa: E402
from .guard import GuardMiddleware  # noqa: E402
from .live import router as live_router  # noqa: E402
from .notifier import alert_family  # noqa: E402
from .storage import STORE  # noqa: E402

MAX_IMAGE, MAX_AUDIO, MAX_TEXT = 8 * 2**20, 20 * 2**20, 20_000
FLAG_BONUS = {"international_number": 10, "url_lookalike": 15}

# Localized one-liners for verdicts that come from a rule outside the text engine.
MSG = {
    "official_doc": {"ja": "警察や裁判所が、身分証や逮捕状の画像をメッセージで送ることはありません。",
                     "vi": "Công an, tòa án không bao giờ gửi ảnh thẻ ngành hay lệnh bắt qua tin nhắn."},
    "webrisk": {"ja": "このリンクは危険なサイトとして報告されています。開かないでください。",
                "vi": "Đường link này đã bị báo cáo là trang nguy hiểm. Đừng mở."},
    "police_money": {"ja": "警察がお金の振込や預金の移動を求めることは絶対にありません。",
                     "vi": "Công an không bao giờ yêu cầu chuyển tiền hay chuyển tiền tiết kiệm sang tài khoản khác."},
    "official_to_person": {"ja": "役所や銀行が、個人の口座へ振り込むよう求めることはありません。",
                           "vi": "Cơ quan nhà nước, ngân hàng không yêu cầu chuyển tiền vào tài khoản cá nhân."},
    "stranger": {"ja": "知らない人から頼まれた支払いは、家族や公式窓口に確認してからにしてください。",
                 "vi": "Người lạ yêu cầu chuyển tiền: hãy hỏi người thân hoặc kênh chính thức trước."},
}

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
app = FastAPI(title="Sagi Shield API")
app.add_middleware(GuardMiddleware)  # added first = innermost: CORS headers are still put on a 429
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])
store = STORE
app.include_router(live_router)
app.include_router(agent_router)
SPIKE = Path(__file__).resolve().parents[2] / "frontend" / "spike"  # dev only: not copied into the Docker image
if SPIKE.is_dir():
    app.mount("/spike", StaticFiles(directory=SPIKE), name="spike")


def use_llm() -> bool:
    return os.getenv("USE_LLM", "1") == "1"


def check_lang(lang: str) -> str:
    if lang not in LANG_PACKS:
        raise HTTPException(422, f"lang must be one of {sorted(LANG_PACKS)}")
    return lang


def raise_to(result: dict, floor: int, lang: str, reason: str, scam_type: str | None = None) -> dict:
    """Apply a rule that sits outside the text engine: lift the score and lead with its reason."""
    if floor > result["risk_score"]:
        if result["risk_level"] == "LOW":  # the text looked fine, the rule says otherwise: drop "no sign of a scam"
            result["reasons"] = []
        lv = level(floor)
        result.update(risk_score=floor, risk_level=lv, advice=LANG_PACKS[lang]["advice"][lv])
        if result["scam_type"] in ("safe", "unknown"):
            result["scam_type"] = scam_type or "unknown"
    result["reasons"] = ([reason] + [r for r in result["reasons"] if r != reason])[:2]
    return result


def finish(result: dict, flags: list[str], community_hits: int) -> dict:
    result.update(evidence_flags=sorted(set(flags)), community_hits=community_hits)
    store.record_check(result["risk_level"])
    return result


@app.get("/health")
@app.get("/healthz", include_in_schema=False)  # local alias; Cloud Run reserves paths ending in "z"
def healthz():
    return {"ok": True, "llm": use_llm(), "store": type(store).__name__}


@app.post("/check")
async def check(request: Request):
    image = audio = None
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            body = await request.json()
        except ValueError:  # malformed JSON or not UTF-8
            raise HTTPException(422, "body must be UTF-8 JSON")
        if not isinstance(body, dict):
            raise HTTPException(422, "body must be a JSON object")
    else:
        body = await request.form()
        image, audio = body.get("image"), body.get("audio")
    lang = check_lang(str(body.get("lang") or "ja"))
    text = str(body.get("text") or "")[:MAX_TEXT]
    phone, url = (str(body.get(k) or "").strip() or None for k in ("phone", "url"))
    if not (text.strip() or phone or url or image or audio):
        raise HTTPException(422, "send at least one of: text, image, audio, phone, url")

    flags, doc_type = [], None
    if image is not None:
        raw = await image.read()
        if len(raw) > MAX_IMAGE:
            raise HTTPException(413, "image too large")
        try:
            jpeg = prepare_image(io.BytesIO(raw))  # resized, EXIF stripped
        except Exception:
            raise HTTPException(422, "image could not be read")
        seen = services.describe_image(jpeg) if use_llm() else None
        if seen:
            doc_type, text = seen.doc_type, f"{text}\n{seen.ocr_text}"
        else:
            flags.append("image_not_analyzed")
    if audio is not None:
        raw = await audio.read()
        if len(raw) > MAX_AUDIO:
            raise HTTPException(413, "audio too large")
        transcript = services.transcribe_audio(raw, audio.content_type) if use_llm() else None
        if transcript:
            text = f"{text}\n{transcript}"
        else:
            flags.append("audio_not_analyzed")

    ev = build_evidence(lang=lang, text=text[:MAX_TEXT] or None, phone=phone, url=url)
    flags += ev.flags
    bonus = sum(v for k, v in FLAG_BONUS.items() if k in ev.flags)
    result = analyze(ev.text, lang, use_llm=use_llm(), bonus=bonus)

    if doc_type in services.OFFICIAL_DOCS:
        flags.append(f"image_{doc_type}")
        raise_to(result, 90, lang, MSG["official_doc"][lang], "fake_police")
    if os.getenv("USE_WEBRISK", "0") == "1":
        for u in dict.fromkeys(URL_RE.findall(normalize_text(text)) + ([url] if url else [])):
            threats = services.webrisk_threats(u if u.startswith("http") else "http://" + u)
            if threats:
                flags += [f"url_webrisk_{t}" for t in threats]
                raise_to(result, 90, lang, MSG["webrisk"][lang])
    return finish(result, flags, sum(store.count_phone(p.hash) for p in ev.phones))


class PreCheck(BaseModel):
    reason_text: str = Field(max_length=2000)
    amount: float | str | None = None  # the UI sends free text ("300万円"); informational only
    recipient_type: Literal["person", "company", "government", "unknown"] | None = None
    who_asked: Literal["police", "government", "bank", "family", "broker", "company", "stranger", "nobody"] | None = None
    lang: str = "ja"


@app.post("/precheck")
def precheck(body: PreCheck):
    """振込前チェック: "I am about to send money because ..." """
    lang = check_lang(body.lang)
    ev = build_evidence(lang=lang, text=body.reason_text)
    result = analyze(ev.text, lang, use_llm=use_llm())
    if body.who_asked == "police":
        raise_to(result, 90, lang, MSG["police_money"][lang], "fake_police")
    elif body.who_asked in ("bank", "government") and body.recipient_type == "person":
        raise_to(result, 90, lang, MSG["official_to_person"][lang])
    elif body.who_asked in ("stranger", "broker"):
        raise_to(result, 70, lang, MSG["stranger"][lang])
    return finish(result, ev.flags, 0)


class Report(BaseModel):
    scam_type: str = Field(max_length=40)
    phone: str | None = Field(default=None, max_length=40)
    keywords: list[str] = Field(default_factory=list, max_length=10)
    prefecture: str | None = Field(default=None, max_length=40)
    consent: bool
    lang: str = "ja"


@app.post("/report")
def report(body: Report):
    if not body.consent:
        raise HTTPException(400, "consent is required")
    info = analyze_phone(body.phone, check_lang(body.lang)) if body.phone else None
    store.add_report(body.scam_type, info.hash if info else None, [k[:40] for k in body.keywords], body.prefecture)
    return {"ok": True}


class FamilyCode(BaseModel):
    member_name: str = Field(default="", max_length=40)
    family_id: str | None = Field(default=None, max_length=64)  # existing family: issue a fresh code


@app.post("/family/code")
def family_code(body: FamilyCode):
    """Protected person's device: start a family. Keep family_id secret; show pair_code (valid 15 min)."""
    fam = (store.refresh_code(body.family_id) if body.family_id else None) or store.create_family(body.member_name)
    return {"family_id": fam["family_id"], "pair_code": fam["pair_code"], "expires_in": 900,
            "guardians": [g["name"] for g in fam["guardians"]]}


class FamilyLink(BaseModel):
    pair_code: str = Field(max_length=12)
    guardian_name: str = Field(default="", max_length=40)
    fcm_token: str | None = Field(default=None, max_length=4096)


@app.post("/family/link")
def family_link(body: FamilyLink):
    fam = store.link_guardian("".join(c for c in body.pair_code if c.isdigit()), body.guardian_name, body.fcm_token)
    if not fam:
        raise HTTPException(404, "pair code is wrong or expired")
    return {"ok": True, "family_id": fam["family_id"], "guardian_name": body.guardian_name, "member_name": fam["member_name"]}


@app.get("/family/alerts")
def family_alerts(family_id: str):
    if not store.get_family(family_id):
        raise HTTPException(404, "unknown family")
    return store.list_alerts(family_id)


class FamilyNotify(BaseModel):
    family_id: str = Field(max_length=64)
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    scam_type: str = Field(default="unknown", max_length=40)
    stage: int = Field(default=0, ge=0, le=5)
    reasons: list[str] = Field(default_factory=list, max_length=2)
    lang: str = "ja"


@app.post("/family/notify")
def family_notify(body: FamilyNotify):
    """"Notify my family" on a result screen."""
    alert = alert_family(body.family_id, body.model_dump(), check_lang(body.lang))
    if not alert:
        raise HTTPException(404, "unknown family")
    return {"ok": True, "id": alert["id"]}


@app.get("/stats")
def stats():
    return store.stats()


# Last, so every API route wins: the built PWA (frontend/dist copied to backend/static by infra/deploy.sh).
# One Cloud Run URL serves both -> same origin, no CORS, and the WebSocket shares the host.
STATIC = Path(__file__).resolve().parents[1] / "static"
if STATIC.is_dir():
    app.mount("/", StaticFiles(directory=STATIC, html=True), name="pwa")
