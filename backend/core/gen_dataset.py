"""
Sagi Shield - synthetic dataset generator + evaluator (JP / VN).
No public JP/VN scam-call dataset exists -> generate one with Gemini, seeded by the kill chain,
then evaluate risk_engine against it.

  python gen_dataset.py gen  --lang ja --n 60 --out eval/ja.jsonl        # needs GOOGLE_API_KEY
  python gen_dataset.py seed --lang vi --out eval/vi_seed.jsonl           # offline templates (smoke test)
  python gen_dataset.py eval --data eval/ja.jsonl --lang ja [--no-llm]
"""
from __future__ import annotations
import argparse, json, os, random, sys
from pathlib import Path

SCAM_TYPES = {
    "ja": ["fake_police", "family_impersonation", "fake_billing", "refund", "investment"],
    "vi": ["fake_police", "family_impersonation", "fake_billing", "refund", "investment"],
}
BENIGN = {
    "ja": ["銀行からの正規の引き落とし案内", "病院の予約確認", "宅配の再配達連絡", "息子からの普通の近況電話", "市役所の健診案内"],
    "vi": ["ngân hàng nhắc lịch trả góp thật", "phòng khám xác nhận lịch hẹn", "shipper gọi giao hàng", "con gọi hỏi thăm bình thường", "phường thông báo họp tổ dân phố"],
}
# Offline seed templates: {stage_max: text}. Enough for a smoke test, not for real evaluation.
SEED = {
    "ja": [
        ("scam", "fake_police", "警視庁の者です。あなたの口座が犯罪に使われています。LINEで逮捕状を送りますので確認してください。"),
        ("scam", "refund", "市役所です。医療費の還付金があります。今日中にATMで手続きしてください。"),
        ("scam", "family_impersonation", "俺だけど、会社のお金をなくした。誰にも言わないで、300万円振り込んでほしい。"),
        ("safe", "safe", "〇〇病院です。明日10時の予約の確認でお電話しました。"),
        ("safe", "safe", "宅配便です。不在だったので再配達の時間を教えてください。"),
    ],
    "vi": [
        ("scam", "fake_police", "Tôi là công an quận, tài khoản của anh liên quan đường dây rửa tiền. Kết bạn Zalo để nhận lệnh bắt."),
        ("scam", "refund", "Bảo hiểm xã hội hoàn tiền cho chị, chị cài ứng dụng qua đường link này và đọc mã OTP."),
        ("scam", "family_impersonation", "Mẹ ơi con bị tai nạn, đừng nói với bố, chuyển gấp 20 triệu vào tài khoản này."),
        ("safe", "safe", "Phòng khám xin xác nhận lịch hẹn của chị lúc 9 giờ sáng mai."),
        ("safe", "safe", "Em shipper đây, chị ở nhà không để em giao hàng ạ?"),
    ],
}

GEN_PROMPT = """Generate ONE realistic phone-call transcript in {language} for a fraud-detection test set.
Label: {label}. Scenario: {scenario}. Target: {persona}.
{extra}
Format: alternating lines "A:" (caller) and "B:" (callee), 8-16 lines, natural spoken style.
Use placeholders <PHONE>, <ACCOUNT>, <URL> instead of real numbers or links. Output transcript only."""

PERSONAS = {"ja": ["70代の一人暮らしの女性", "30代の会社員男性", "60代の夫婦の夫"],
            "vi": ["cụ bà 70 tuổi sống một mình", "nhân viên văn phòng 30 tuổi", "chủ tiệm tạp hóa 55 tuổi"]}

def gen(lang: str, n: int, out: str, scam_ratio: float = 0.6):
    from google import genai
    client = genai.Client()
    model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    language = {"ja": "Japanese", "vi": "Vietnamese"}[lang]
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        for i in range(n):
            is_scam = random.random() < scam_ratio
            if is_scam:
                t = random.choice(SCAM_TYPES[lang])
                stop = random.choice(["the victim hangs up early (only authority claim + threat)",
                                      "reaches channel switch (chat app / video call / install app)",
                                      "reaches a money / OTP / cash-card request"])
                extra = f"Scam kill chain: authority -> fear -> isolation -> channel switch -> money. Conversation {stop}. Make it subtle, avoid obvious keywords half of the time."
                label, scenario = "scam", t
            else:
                t, label, scenario = "safe", "safe", random.choice(BENIGN[lang])
                extra = "Hard negative: may mention banks, police, money or accounts in a LEGITIMATE way."
            r = client.models.generate_content(model=model, contents=GEN_PROMPT.format(
                language=language, label=label, scenario=scenario,
                persona=random.choice(PERSONAS[lang]), extra=extra))
            f.write(json.dumps({"id": f"{lang}-{i:04d}", "lang": lang, "label": label,
                                "scam_type": t, "text": r.text.strip()}, ensure_ascii=False) + "\n")
            print(f"[{i+1}/{n}] {label}/{t}", file=sys.stderr)

def seed(lang: str, out: str):
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        for i, (label, t, text) in enumerate(SEED[lang]):
            f.write(json.dumps({"id": f"{lang}-seed-{i}", "lang": lang, "label": label,
                                "scam_type": t, "text": text}, ensure_ascii=False) + "\n")

def evaluate(data: str, lang: str, use_llm: bool, threshold: str = "MEDIUM"):
    sys.path.insert(0, str(Path(__file__).parent))
    from risk_engine import analyze
    order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
    tp = fp = tn = fn = 0
    misses = []
    for line in open(data, encoding="utf-8"):
        s = json.loads(line)
        r = analyze(s["text"], lang, use_llm)
        pred = order[r["risk_level"]] >= order[threshold]
        gold = s["label"] == "scam"
        tp += pred and gold; fp += pred and not gold; tn += (not pred) and (not gold); fn += (not pred) and gold
        if pred != gold:
            misses.append({"id": s["id"], "gold": s["label"], "pred": r["risk_level"], "score": r["risk_score"]})
    total = tp + fp + tn + fn
    rec = tp / (tp + fn) if tp + fn else 0
    prec = tp / (tp + fp) if tp + fp else 0
    fpr = fp / (fp + tn) if fp + tn else 0
    print(json.dumps({"n": total, "recall": round(rec, 3), "precision": round(prec, 3),
                      "false_positive_rate": round(fpr, 3), "confusion": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
                      "misses": misses[:20]}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["gen", "seed", "eval"])
    ap.add_argument("--lang", default="ja", choices=["ja", "vi"])
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--out", default="eval/dataset.jsonl")
    ap.add_argument("--data", default="eval/dataset.jsonl")
    ap.add_argument("--no-llm", action="store_true")
    a = ap.parse_args()
    if a.cmd == "gen": gen(a.lang, a.n, a.out)
    elif a.cmd == "seed": seed(a.lang, a.out)
    else: evaluate(a.data, a.lang, not a.no_llm)
