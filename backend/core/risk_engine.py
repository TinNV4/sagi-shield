"""
Sagi Shield - core risk engine (reusable, market-agnostic).

Hybrid scoring:  rules (deterministic)  +  Gemini stage detector (LLM)
                 -> fusion (max) -> per-call accumulation + latch for live mode.

Rules score the kill chain by CO-OCCURRENCE, not by the deepest single keyword:
  1 link alone ("LINE", "キャッシュカード")  -> LOW
  2 links                                    -> MEDIUM
  3+ links, or a pair with no legit version  -> HIGH   (e.g. "police" + move to a chat app)

Usage:
  pip install google-genai pydantic
  export GEMINI_API_KEY=...            # or Agent Platform (ex-Vertex): GOOGLE_GENAI_USE_ENTERPRISE=true + project/location
  python risk_engine.py --lang ja --text "警察です。あなたの口座が犯罪に使われています。LINEで逮捕状を送ります"
  python risk_engine.py --lang vi --text "Tôi là công an, tài khoản của anh liên quan đường dây rửa tiền" --no-llm
"""
from __future__ import annotations
import argparse, json, os, re, unicodedata
from dataclasses import dataclass, field
from enum import IntEnum
from pydantic import BaseModel

# ---------- Scam kill chain (shared across markets) ----------
class Stage(IntEnum):
    NONE = 0
    AUTHORITY = 1      # claims to be police / bank / gov
    FEAR = 2           # pressure: threat or lure (crime, arrest, unpaid bill, refund)
    ISOLATION = 3      # keep secret, don't tell family
    CHANNEL_SWITCH = 4 # move to LINE / Zalo / video call / install app
    MONEY = 5          # transfer, ATM, cash card, OTP

STAGE_SCORE = {0: 0, 1: 25, 2: 45, 3: 65, 4: 80, 5: 95}  # maps the LLM's stage verdict to a score

# ---------- Language packs: swap to support a new market ----------
LANG_PACKS = {
    "ja": {
        "patterns": {
            Stage.AUTHORITY: [r"警察", r"けいさつ", r"警視庁|県警|府警|道警", r"刑事", r"検事", r"検察", r"銀行協会", r"金融庁",
                              r"市役所|区役所|年金事務所|税務署"],
            Stage.FEAR: [r"口座.{0,15}(犯罪|悪用)", r"逮捕", r"たいほ", r"不正(に)?契約", r"マネーロンダリング", r"捜査",
                         r"還付金", r"未納|未払", r"法的措置|差し?押さ?え|訴訟"],
            Stage.ISOLATION: [r"(誰|家族).{0,12}(言わ|話さ)ない", r"秘密", r"守秘義務"],
            # LINE / ライン must stand alone: "online", "オンライン", "ガイドライン" are not the chat app
            Stage.CHANNEL_SWITCH: [r"(?<![A-Za-z])LINE(?![A-Za-z])", r"(?<![ァ-ヶー])ライン(?![ァ-ヶー])", r"らいん",
                                   r"ビデオ通話", r"アプリ.{0,20}(入れ|インストール)", r"逮捕状.{0,20}送"],
            Stage.MONEY: [r"振り?込", r"ATM", r"キャッシュカード", r"暗証番号", r"送金", r"資金.{0,10}(確認|調査)",
                          r"電子マネー|プリペイドカード|ギフトカード"],
        },
        # third-person words used when talking ABOUT scams (news, police warnings), not while running one
        "reporting": [r"名乗", r"によりますと", r"ニュース", r"手口", r"注意を呼びかけ"],
        "advice": {
            "HIGH": "詐欺の可能性が高いです。すぐに電話を切ってください。#9110 に相談してください。",
            "MEDIUM": "注意してください。公式の電話番号にかけ直して確認してください。",
            "LOW": "大きな危険は見つかりませんでした。不安なら公式番号で確認してください。",
        },
        "hotlines": ["#9110", "188"],
    },
    "vi": {
        "patterns": {
            Stage.AUTHORITY: [r"công an", r"cảnh sát", r"viện kiểm sát", r"tòa án", r"ngân hàng nhà nước", r"nhà mạng",
                              r"bảo hiểm xã hội", r"(cơ quan|chi cục|cục) thuế", r"điện lực"],
            Stage.FEAR: [r"rửa tiền", r"đường dây", r"bắt (giữ|giam)", r"khóa (tài khoản|sim)", r"điều tra", r"lệnh bắt",
                         r"hoàn (tiền|thuế)", r"nợ cước", r"quá hạn"],
            Stage.ISOLATION: [r"(không|đừng) (được )?(nói|kể)", r"bí mật", r"bảo mật (điều tra|thông tin)"],
            Stage.CHANNEL_SWITCH: [r"zalo", r"gọi video", r"cài (đặt )?(app|ứng dụng)", r"vneid", r"đường link"],
            Stage.MONEY: [r"chuyển.{0,15}(tiền|khoản|triệu)", r"tài khoản tạm giữ", r"\botp\b", r"mã xác (nhận|thực)",
                          r"xác minh (dòng )?tiền"],
        },
        "reporting": [r"giả danh", r"mạo danh", r"thủ đoạn", r"cảnh báo", r"khuyến cáo"],
        "advice": {
            "HIGH": "Nhiều khả năng là lừa đảo. Hãy cúp máy ngay, không chuyển tiền, gọi 113 hoặc công an địa phương.",
            "MEDIUM": "Cần cảnh giác. Hãy tự gọi lại số chính thức của cơ quan/ngân hàng để xác minh.",
            "LOW": "Chưa thấy dấu hiệu nguy hiểm rõ ràng. Nếu lo lắng, hãy xác minh qua số chính thức.",
        },
        "hotlines": ["113"],
    },
}

# ---------- LLM structured output ----------
class LlmVerdict(BaseModel):
    stage: int            # 0..5 highest kill-chain stage reached
    scam_type: str        # fake_police | family_impersonation | fake_billing | refund | investment | safe
    confidence: float     # 0..1
    reasons: list[str]    # short, in the user's language

SYSTEM_PROMPT = """You are a phone-scam analyst. Given a transcript/message, identify the highest
scam kill-chain stage reached: 0 none, 1 authority claim, 2 fear/threat, 3 isolation/secrecy,
4 channel switch (chat app, video call, install app, sending ID/warrant images), 5 money/OTP request.
Real police/banks never move to chat apps, send warrants as images, or ask for transfers/OTP.
Reply in JSON only. Write reasons (max 2, short) in language: {lang}."""

def llm_verdict(text: str, lang: str) -> LlmVerdict | None:
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return None
    client = genai.Client()  # reads GOOGLE_API_KEY or Vertex env vars
    resp = client.models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
        contents=text,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT.format(lang=lang),
            response_mime_type="application/json",
            response_schema=LlmVerdict,
            temperature=0.1,
        ),
    )
    return resp.parsed

# ---------- Rule layer ----------
# One link on its own is weak evidence ("LINE", "キャッシュカード" come up in normal calls all day).
# Weights are chosen so that: any single link < 40 (LOW), any pair 45-55 (MEDIUM), any triple >= 70 (HIGH).
STAGE_WEIGHT = {Stage.AUTHORITY: 20, Stage.FEAR: 25, Stage.ISOLATION: 25, Stage.CHANNEL_SWITCH: 25, Stage.MONEY: 30}
# Combinations with no legitimate version -> floor, whatever else is (not) present.
HARD_COMBOS = [
    ({Stage.AUTHORITY, Stage.CHANNEL_SWITCH}, 90),     # "police" moving you to a chat app / sending a warrant
    ({Stage.AUTHORITY, Stage.FEAR, Stage.MONEY}, 90),  # official + threat/lure + money
    ({Stage.ISOLATION, Stage.MONEY}, 80),              # "tell no one" + transfer (family impersonation)
]
# Text ABOUT scams (news, warnings) contains the whole chain. Rules alone then stop at MEDIUM;
# the LLM can still raise it, so a scammer cannot silence the alert by saying these words.
REPORTING_CAP = 55

def rule_stages(text: str, lang: str) -> dict[Stage, list[str]]:
    text = unicodedata.normalize("NFKC", text)  # ＬＩＮＥ -> LINE, ＡＴＭ -> ATM (STT / SMS variants)
    hits: dict[Stage, list[str]] = {}
    for stage, pats in LANG_PACKS[lang]["patterns"].items():
        for p in pats:
            m = re.search(p, text, re.IGNORECASE)
            if m:
                hits.setdefault(stage, []).append(m.group(0))
    return hits

def is_reporting(text: str, lang: str) -> bool:
    text = unicodedata.normalize("NFKC", text)
    return any(re.search(p, text, re.IGNORECASE) for p in LANG_PACKS[lang].get("reporting", []))

def rule_score(hits: dict[Stage, list[str]], reporting: bool = False) -> int:
    if not hits:
        return 0
    seen = set(hits)
    score = sum(STAGE_WEIGHT[s] for s in seen)
    for combo, floor in HARD_COMBOS:
        if combo <= seen:
            score = max(score, floor)
    score = min(100, score)
    return min(score, REPORTING_CAP) if reporting else score

def rule_stage(hits: dict[Stage, list[str]]) -> int:
    """Deepest stage that counts as reached. A lone deep keyword (just "LINE", just "ATM") is not a
    kill chain, so stages past FEAR need at least one other link."""
    if not hits:
        return 0
    deepest = max(hits)
    return int(deepest) if len(hits) >= 2 or deepest <= Stage.FEAR else 0

# ---------- Fusion + live tracking ----------
def level(score: float) -> str:
    return "HIGH" if score >= 70 else "MEDIUM" if score >= 40 else "LOW"

@dataclass
class LiveTracker:
    """State for ONE live call. The kill chain unfolds over minutes while each scoring window holds
    ~30 s, so stage hits accumulate for the whole call and the rule score is computed on the
    accumulated set. It can only grow -> stages never go backwards. The noisy per-window LLM score
    is EMA-smoothed. Latch: once HIGH, stays HIGH until reset() (silence timeout = call ended)."""
    alpha: float = 0.6
    ema: float = 0.0
    latched: bool = False
    max_stage: int = 0
    reporting: bool = False
    hits: dict[Stage, list[str]] = field(default_factory=dict)
    history: list[float] = field(default_factory=list)

    def update(self, window_hits: dict[Stage, list[str]], llm_score: float = 0.0,
               llm_stage: int = 0, reporting: bool = False) -> float:
        for stage, found in window_hits.items():
            kept = self.hits.setdefault(stage, [])
            kept.extend(m for m in found if m not in kept)
        self.reporting = self.reporting or reporting
        self.max_stage = max(self.max_stage, rule_stage(self.hits), llm_stage)
        self.ema = self.alpha * llm_score + (1 - self.alpha) * self.ema
        score = max(rule_score(self.hits, self.reporting), self.ema)
        if score >= 70:
            self.latched = True
        out = max(score, 70.0) if self.latched else score
        self.history.append(out)
        return out

    def reset(self) -> None:
        self.ema, self.latched, self.max_stage, self.reporting = 0.0, False, 0, False
        self.hits.clear()
        self.history.clear()

def analyze(text: str, lang: str = "ja", use_llm: bool = True) -> dict:
    hits = rule_stages(text, lang)
    r_score = rule_score(hits, is_reporting(text, lang))
    v = llm_verdict(text, lang) if use_llm else None
    l_score = STAGE_SCORE.get(v.stage, 0) * (0.5 + 0.5 * v.confidence) if v else 0
    score = round(max(r_score, l_score))
    lv = level(score)
    return {
        "risk_score": score,
        "risk_level": lv,
        "stage": max(rule_stage(hits), v.stage if v else 0),
        "scam_type": v.scam_type if v else ("unknown" if r_score >= 40 else "safe"),
        "rule_hits": {Stage(s).name: m for s, m in hits.items()},
        "reasons": v.reasons if v else [],
        "advice": LANG_PACKS[lang]["advice"][lv],
        "hotlines": LANG_PACKS[lang]["hotlines"],
    }

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True)
    ap.add_argument("--lang", default="ja", choices=list(LANG_PACKS))
    ap.add_argument("--no-llm", action="store_true")
    a = ap.parse_args()
    print(json.dumps(analyze(a.text, a.lang, not a.no_llm), ensure_ascii=False, indent=2))
