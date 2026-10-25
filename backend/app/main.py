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

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core"))
from input_layer import URL_RE, analyze_phone, build_evidence, normalize_text, phone_hmac, prepare_image  # noqa: E402
from model_ids import model_id  # noqa: E402
from risk_engine import LANG_PACKS, analyze, level, precursor_hits as engine_precursor  # noqa: E402

from . import appcheck, auth, households, services, share  # noqa: E402
from .agent import router as agent_router  # noqa: E402
from .feedback import router as feedback_router  # noqa: E402
from .analytics import log_event  # noqa: E402
from .guard import GuardMiddleware  # noqa: E402
from .live import router as live_router  # noqa: E402
from .notifier import alert_family  # noqa: E402
from .storage import STORE, FamilyId, FirestoreStore, _today as storage_today  # noqa: E402
from .verdict_log import log_verdict  # noqa: E402

MAX_IMAGE, MAX_AUDIO, MAX_TEXT = 8 * 2**20, 20 * 2**20, 20_000
MAX_IMAGES = 5  # a story captured page by page; more than this is a batch job, not a quick check
FLAG_BONUS = {"international_number": 10, "url_lookalike": 15}

# Localized one-liners for verdicts that come from a rule outside the text engine.
MSG = {
    "official_doc": {"ja": "警察や裁判所が、身分証や逮捕状の画像をメッセージで送ることはありません。",
                     "vi": "Công an, tòa án không bao giờ gửi ảnh thẻ ngành hay lệnh bắt qua tin nhắn."},
    "webrisk": {"ja": "このリンクは危険なサイトとして報告されています。開かないでください。",
                "vi": "Đường link này đã bị báo cáo là trang nguy hiểm. Đừng mở."},
    "phish_list": {"ja": "このリンク先はフィッシングサイトとして公開リストに載っています。開かず、公式アプリや公式サイトから確認してください。",
                   "vi": "Đường link này nằm trong danh sách trang giả mạo đã công bố. Đừng mở, hãy kiểm tra qua ứng dụng hoặc trang chính thức."},
    "police_money": {"ja": "警察がお金の振込や預金の移動を求めることは絶対にありません。",
                     "vi": "Công an không bao giờ yêu cầu chuyển tiền hay chuyển tiền tiết kiệm sang tài khoản khác."},
    "official_to_person": {"ja": "役所や銀行が、個人の口座へ振り込むよう求めることはありません。",
                           "vi": "Cơ quan nhà nước, ngân hàng không yêu cầu chuyển tiền vào tài khoản cá nhân."},
    "intl_number": {"ja": "海外からの番号です。日本の警察・役所・銀行が国際電話でかけてくることはありません。",
                    "vi": "Đây là số gọi từ nước ngoài. Công an, cơ quan nhà nước, ngân hàng trong nước không gọi từ số quốc tế."},
    "url_lookalike": {"ja": "公式サイトに似せた偽のアドレスです。開かずに、公式アプリや公式サイトから確認してください。",
                      "vi": "Địa chỉ này giả mạo trang chính thức. Đừng mở; hãy vào ứng dụng hoặc trang chính thức để kiểm tra."},
    "url_odd": {"ja": "短縮URLや見慣れないドメインです。送り主に別の方法で確認するまで開かないでください。",
                "vi": "Đây là link rút gọn hoặc tên miền lạ. Đừng mở cho tới khi xác nhận với người gửi bằng cách khác."},
    "reported": {"ja": "この番号は、他の利用者から詐欺として{n}件報告されています。",
                 "vi": "Số này đã bị {n} người dùng khác báo cáo là lừa đảo."},
    "phone_no_reports": {"ja": "この番号への報告はまだありません。安全という意味ではありません。",
                         "vi": "Chưa có báo cáo nào về số này. Điều đó không có nghĩa là số này an toàn."},
    "precursor": {"ja": "「番号が変わった」「風邪で声が違う」は、後日お金を求める詐欺の前ぶれによくある言い方です。以前から知っている番号にかけ直して確認してください。",
                  "vi": "\"Con đổi số rồi\", \"con bị cảm nên giọng khác\" là lời mở đầu quen thuộc của kẻ gian trước khi hỏi tiền. Hãy gọi lại số cũ bạn đã lưu để xác nhận."},
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
app.include_router(households.router)
app.include_router(share.router)
app.include_router(feedback_router)


@app.exception_handler(auth.AuthError)
def _auth_error(request: Request, exc: auth.AuthError):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status)


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


def finish(result: dict, flags: list[str], community_hits: int, kind: str = "check", source: str = "text", lang: str = "ja") -> dict:
    llm_used = result.pop("llm_used", None)  # internal; the contract exposes it as the `llm_unavailable` flag
    result.update(evidence_flags=sorted(set(flags)), community_hits=community_hits)
    store.record_check(result["risk_level"])
    log_event(kind, lang=lang, source=source, risk_level=result["risk_level"], risk_score=result["risk_score"],
              scam_type=result["scam_type"], stage=result["stage"], llm_used=llm_used)  # aggregate fields only
    rec = log_verdict(kind, lang=lang, source=source, score=result["risk_score"], level=result["risk_level"], stage=result["stage"],
                scam_type=result["scam_type"], reasons=result["reasons"], rules={"hits": result.get("rule_hits")},
                flags=result["evidence_flags"], community_hits=community_hits, llm_used=llm_used)  # the "why"
    result["verdict_id"] = rec.get("verdict_id")  # the handle for "was this right?"; the record keeps the why
    return result


@app.get("/health")
@app.get("/healthz", include_in_schema=False)  # local alias; Cloud Run reserves paths ending in "z"
def healthz():
    return {"ok": True, "llm": use_llm(), "store": "firestore" if isinstance(store, FirestoreStore) else "memory",
            "database": getattr(store, "database", None), "model": model_id("GEMINI_MODEL")}


@app.post("/check")
async def check(request: Request):
    images, audio = [], None
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            body = await request.json()
        except ValueError:  # malformed JSON or not UTF-8
            raise HTTPException(422, "body must be UTF-8 JSON")
        if not isinstance(body, dict):
            raise HTTPException(422, "body must be a JSON object")
    else:
        body = await request.form()
        # `image` (one file, the original contract) and `images` (several, in the order they were taken)
        images = [f for f in [body.get("image")] + body.getlist("images") if f is not None and hasattr(f, "read")]
        audio = body.get("audio")
    lang = check_lang(str(body.get("lang") or "ja"))
    text = str(body.get("text") or "")[:MAX_TEXT]
    phone, url = (str(body.get(k) or "").strip() or None for k in ("phone", "url"))
    if not (text.strip() or phone or url or images or audio):
        raise HTTPException(422, "send at least one of: text, image, audio, phone, url")
    if len(images) > MAX_IMAGES:
        raise HTTPException(413, f"at most {MAX_IMAGES} images per check")

    flags, doc_type, per_image = [], None, None
    if images:
        jpegs = []
        for image in images:
            raw = await image.read()
            if len(raw) > MAX_IMAGE:
                raise HTTPException(413, "image too large")
            try:
                jpegs.append(prepare_image(io.BytesIO(raw)))  # resized, EXIF stripped
            except Exception:
                raise HTTPException(422, "image could not be read")
        seen = same_story = None
        if use_llm():
            if len(jpegs) == 1:
                one = services.describe_image(jpegs[0])
                seen, same_story = ([one] if one else None), True
            else:
                sset = services.describe_images(jpegs)
                if sset:
                    seen, same_story = sset.images, sset.same_story
                else:  # the joint look failed: read them one by one and treat them as one story
                    seen, same_story = [services.describe_image(j) for j in jpegs], True
                    if not all(seen):
                        seen = None
        if not seen:
            flags.append("image_not_analyzed")
        elif same_story or len(seen) == 1:
            # one incident captured in pieces: the pieces are judged as one text, in order
            doc_type = next((s.doc_type for s in seen if s.doc_type in services.OFFICIAL_DOCS), seen[0].doc_type)
            pieces = [s.ocr_text if len(seen) == 1 else f"[image {i + 1}]\n{s.ocr_text}" for i, s in enumerate(seen)]
            text = "\n".join([text] + pieces)
            if len(seen) > 1:
                per_image = {"mode": "combined", "items": [{"index": i + 1, "doc_type": s.doc_type} for i, s in enumerate(seen)]}
        else:
            # unrelated images: each gets its own verdict, the worst one leads the answer
            items = []
            for i, s in enumerate(seen):
                sub = analyze(build_evidence(lang=lang, text=s.ocr_text[:MAX_TEXT] or None).text, lang, use_llm=use_llm())
                if s.doc_type in services.OFFICIAL_DOCS:
                    raise_to(sub, 90, lang, MSG["official_doc"][lang], "fake_police")
                items.append({"index": i + 1, "doc_type": s.doc_type, "risk_level": sub["risk_level"],
                              "risk_score": sub["risk_score"], "scam_type": sub["scam_type"], "reasons": sub["reasons"][:1]})
            lead = max(range(len(seen)), key=lambda i: items[i]["risk_score"])
            doc_type, text = seen[lead].doc_type, f"{text}\n{seen[lead].ocr_text}"
            per_image = {"mode": "separate", "items": items}
    if audio is not None:
        raw = await audio.read()
        if len(raw) > MAX_AUDIO:
            raise HTTPException(413, "audio too large")
        transcript = services.transcribe_audio(raw, audio.content_type, lang) if use_llm() else None
        if transcript:
            text = f"{text}\n{transcript}"
        else:
            flags.append("audio_not_analyzed")

    if not (text.strip() or phone or url) and any(f.endswith("_not_analyzed") for f in flags):
        # nothing was actually looked at: "LOW, no danger found" would be a lie about a file we could not read
        raise HTTPException(503, "The file could not be analyzed right now. Please try again, or paste the text instead.")
    ev = build_evidence(lang=lang, text=text[:MAX_TEXT] or None, phone=phone, url=url)
    flags += ev.flags
    bonus = sum(v for k, v in FLAG_BONUS.items() if k in ev.flags)
    result = analyze(ev.text, lang, use_llm=use_llm(), bonus=bonus)
    if use_llm() and ev.text and not result.get("llm_used", True):
        # the model was asked and did not answer: rules alone miss keyword-free scams (ore-ore), so never call it "safe"
        flags.append("llm_unavailable")
        if result["scam_type"] == "safe":
            result["scam_type"] = "unknown"

    if doc_type in services.OFFICIAL_DOCS:
        flags.append(f"image_{doc_type}")
        raise_to(result, 90, lang, MSG["official_doc"][lang], "fake_police")
    urls = list(dict.fromkeys(URL_RE.findall(normalize_text(text)) + ([url] if url else [])))
    if os.getenv("USE_WEBRISK", "0") == "1":
        for u in urls:
            threats = services.webrisk_threats(u if u.startswith("http") else "http://" + u)
            if threats:
                flags += [f"url_webrisk_{t}" for t in threats]
                raise_to(result, 90, lang, MSG["webrisk"][lang])
    for u in urls:
        # published phishing lists loaded into the store (tools/load_phish_list.py: JPCERT/CC). A listed URL or a
        # host seen in the list floors the result at MEDIUM - lists lag by weeks, so absence proves nothing.
        try:
            hit = store.phish_lookup(u)
        except Exception as e:  # noqa: BLE001 - a lookup failing must never fail a check
            print(f"[main] phish lookup unavailable: {type(e).__name__}", file=sys.stderr)
            hit = None
        if hit:
            flags.append("reported_phishing_jpcertcc" if hit["match"] == "url" else "reported_phishing_host_jpcertcc")
            raise_to(result, 50, lang, MSG["phish_list"][lang], "fake_billing")
    if len(engine_precursor(ev.text, lang)) >= 2 and result["risk_level"] == "LOW":
        # not a verdict - a set-up call asks for nothing - but the one piece of advice that defeats it
        flags.append("precursor_call")
        result["reasons"] = ([MSG["precursor"][lang]] + result["reasons"])[:2]
        result["scam_type"] = "unknown" if result["scam_type"] == "safe" else result["scam_type"]
    # URL shape is evidence even when no model looked at it (flags come from input_layer; the URL is never fetched)
    if "url_lookalike" in ev.flags:
        raise_to(result, 70, lang, MSG["url_lookalike"][lang], "fake_billing")
    elif any(f in ev.flags for f in ("url_shortener", "url_punycode", "url_ip_host", "url_suspicious_tld")):
        raise_to(result, 50, lang, MSG["url_odd"][lang])
    # A phone number carries two signals of its own: where it calls from, and what other users reported.
    community_hits = sum(store.count_phone(p.hash) for p in ev.phones)
    if "international_number" in ev.flags:
        raise_to(result, 50, lang, MSG["intl_number"][lang])
    if community_hits:
        raise_to(result, 80 if community_hits >= 3 else 50, lang, MSG["reported"][lang].format(n=community_hits))
    if ev.phones and result["risk_level"] == "LOW":
        # an unreported number is unknown, not safe - say exactly that
        result["scam_type"] = "unknown" if result["scam_type"] == "safe" else result["scam_type"]
        result["reasons"] = ([MSG["phone_no_reports"][lang]] + result["reasons"])[:2]
    if per_image:
        result["images_mode"], result["images"] = per_image["mode"], per_image["items"]
    source = "image" if images else "audio" if audio is not None else "phone" if phone and not text.strip() else "url" if url else "text"
    return finish(result, flags, community_hits, "check", source, lang)


class DeepCheckIn(BaseModel):
    """Opt-in: search public reports about the domains / organisation in a check. Phone numbers are never searched."""
    lang: str = "ja"
    url: str | None = Field(default=None, max_length=2000)
    text: str | None = Field(default=None, max_length=MAX_TEXT)
    org: str | None = Field(default=None, max_length=80)   # organisation or sender name typed by the user


MAX_DEEP_SUBJECTS = 3


def deep_subjects(url: str | None, text: str | None, org: str | None, lang: str) -> list[str]:
    """Domains (host only, no path or query) plus an optional organisation name - masked first, so a number pasted
    with the text can never become a search query."""
    from urllib.parse import urlsplit
    subjects: list[str] = []
    masked = build_evidence(lang=lang, text="\n".join(filter(None, [url, text]))).text if (url or text) else ""
    for u in URL_RE.findall(normalize_text(masked)):
        host = (urlsplit(u if u.lower().startswith("http") else "http://" + u).hostname or "").lower().removeprefix("www.")
        if host and host not in subjects:
            subjects.append(host)
    if org:
        name = build_evidence(lang=lang, text=org).text.strip()
        if name and name not in subjects:
            subjects.append(name)
    return subjects[:MAX_DEEP_SUBJECTS]


@app.post("/deepcheck")
def deepcheck(body: DeepCheckIn):
    lang = check_lang(body.lang)
    subjects = deep_subjects(body.url, body.text, body.org, lang)
    if not subjects:
        raise HTTPException(422, "nothing to search: give a link or an organisation name")
    if not use_llm():
        raise HTTPException(503, "deep check needs the model")
    found = services.deep_check(subjects, lang)
    if found is None:
        raise HTTPException(503, "The search could not be completed right now. Please try again later.")
    out = {"subjects": subjects, "found": found.found, "summary": found.summary, "sources": found.sources,
           "queries": found.queries, "evidence_flags": ["public_reports_found"] if found.found else []}
    log_verdict("deepcheck", lang=lang, subjects=subjects, found=found.found, sources=len(found.sources))
    return out


class PreCheck(BaseModel):
    reason_text: str = Field(max_length=2000)
    amount: float | str | None = None  # the UI sends free text ("300万円"); informational only
    recipient_type: Literal["person", "company", "government", "unknown"] | None = None
    who_asked: Literal["police", "government", "bank", "family", "broker", "company", "stranger", "nobody"] | None = None
    lang: str = "ja"


@app.post("/precheck")
def precheck(body: PreCheck):
    """Before-you-pay check (furikomi-mae): "I am about to send money because ..." """
    lang = check_lang(body.lang)
    ev = build_evidence(lang=lang, text=body.reason_text)
    result = analyze(ev.text, lang, use_llm=use_llm())
    if body.who_asked == "police":
        raise_to(result, 90, lang, MSG["police_money"][lang], "fake_police")
    elif body.who_asked in ("bank", "government") and body.recipient_type == "person":
        raise_to(result, 90, lang, MSG["official_to_person"][lang])
    elif body.who_asked in ("stranger", "broker"):
        raise_to(result, 70, lang, MSG["stranger"][lang])
    return finish(result, ev.flags, 0, "precheck", "form", lang)


class Report(BaseModel):
    scam_type: str = Field(max_length=40)
    phone: str | None = Field(default=None, max_length=40)
    keywords: list[str] = Field(default_factory=list, max_length=10)
    prefecture: str | None = Field(default=None, max_length=40)
    consent: bool
    lang: str = "ja"
    reporter_id: str | None = Field(default=None, max_length=64)  # random id kept by the app; never an account


@app.post("/report")
def report(body: Report, request: Request):
    if not body.consent:
        raise HTTPException(400, "consent is required")
    # A report changes what other people see about a number, so in enforce mode it needs a fresh limited-use App Check
    # token, consumed here: a script cannot replay one token, and a page without reCAPTCHA cannot report (it can check).
    if appcheck.mode() != "off":
        ac = appcheck.status(request.headers.get(appcheck.HEADER), consume=True)
        appcheck.log.info("POST /report ac=%s", ac)
        if appcheck.mode() == "enforce" and ac != "valid":
            raise HTTPException(403, "This report could not be confirmed as sent from the app. Reload the page and try again.")
    info = analyze_phone(body.phone, check_lang(body.lang)) if body.phone else None
    # community_hits counts distinct reporters, so one person cannot flag an honest number alone. The reporter key is
    # an HMAC of the app's random id; without one, of address + date (rotates daily: not a persistent identifier).
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    origin = body.reporter_id or f"{forwarded or (request.client.host if request.client else '')}:{storage_today()}"
    store.add_report(body.scam_type, info.hash if info else None, [k[:40] for k in body.keywords], body.prefecture,
                     reporter=phone_hmac("reporter:" + origin))
    log_event("report", lang=body.lang, source="phone" if info else "form", scam_type=body.scam_type[:40], prefecture=body.prefecture)
    return {"ok": True}


class FamilyCode(BaseModel):
    member_name: str = Field(default="", max_length=40)
    family_id: FamilyId | None = None  # existing family: issue a fresh code


@app.post("/family/code", dependencies=[Depends(auth.require_legacy_family)])
def family_code(body: FamilyCode):
    """Protected person's device: start a family. Keep family_id secret; show pair_code (valid 15 min)."""
    fam = (store.refresh_code(body.family_id) if body.family_id else None) or store.create_family(body.member_name)
    return {"family_id": fam["family_id"], "pair_code": fam["pair_code"], "expires_in": 900,
            "guardians": [g["name"] for g in fam["guardians"]]}


class FamilyLink(BaseModel):
    pair_code: str = Field(max_length=12)
    guardian_name: str = Field(default="", max_length=40)
    fcm_token: str | None = Field(default=None, max_length=4096)


@app.post("/family/link", dependencies=[Depends(auth.require_legacy_family)])
def family_link(body: FamilyLink):
    fam = store.link_guardian("".join(c for c in body.pair_code if c.isdigit()), body.guardian_name, body.fcm_token)
    if not fam:
        raise HTTPException(404, "pair code is wrong or expired")
    return {"ok": True, "family_id": fam["family_id"], "guardian_name": body.guardian_name, "member_name": fam["member_name"]}


class FamilyPush(BaseModel):
    family_id: FamilyId
    fcm_token: str = Field(min_length=1, max_length=4096)


@app.post("/family/push", dependencies=[Depends(auth.require_legacy_family)])
def family_push(body: FamilyPush):
    """A paired guardian turns on notifications later (or the browser renewed its token). family_id is the secret."""
    if not store.add_push_token(body.family_id, body.fcm_token):
        raise HTTPException(404, "unknown family")
    return {"ok": True}


@app.get("/family/alerts", dependencies=[Depends(auth.require_legacy_family)])
def family_alerts(family_id: str):
    if not store.get_family(family_id):
        raise HTTPException(404, "unknown family")
    return store.list_alerts(family_id)


class FamilyNotify(BaseModel):
    family_id: FamilyId
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    scam_type: str = Field(default="unknown", max_length=40)
    stage: int = Field(default=0, ge=0, le=5)
    reasons: list[str] = Field(default_factory=list, max_length=2)
    lang: str = "ja"


@app.post("/family/notify", dependencies=[Depends(auth.require_legacy_family)])
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
