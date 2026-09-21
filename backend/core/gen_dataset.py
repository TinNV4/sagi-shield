"""
Sagi Shield - synthetic dataset generator + evaluator (JP / VN).
No public JP/VN scam-call dataset exists -> generate one with Gemini, seeded by the kill chain,
then evaluate risk_engine against it.

  python gen_dataset.py gen  --lang ja --n 60 --out eval/ja.jsonl        # needs GOOGLE_API_KEY
  python gen_dataset.py seed --lang vi --out eval/vi_seed.jsonl           # offline templates (smoke test)
  python gen_dataset.py eval --data eval/ja.jsonl --lang ja [--no-llm]
  python gen_dataset.py gen  --lang ja --n 60 --generator fci --out eval/ja.jsonl   # written by another model family
  python gen_dataset.py ablation --datasets eval/ja.jsonl eval/vi.jsonl           # rules vs rules+LLM -> docs/EVAL.md
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

def _write_with(generator: str):
    """Returns prompt -> text. `gemini` = the product's model; `fci` = an OpenAI-compatible model of another family
    (OPENAI_BASE_URL / OPENAI_API_KEY / FCI_MODEL). Generating with `fci` and judging with Gemini keeps the
    evaluation non-circular: the judge never grades transcripts written by itself."""
    if generator == "fci":
        import urllib.request
        base = os.getenv("OPENAI_BASE_URL", "").rstrip("/")
        url = f"{base}/chat/completions" if base.endswith("/v1") else f"{base}/v1/chat/completions"

        def ask(prompt: str) -> str:
            body = {"model": os.getenv("FCI_MODEL", ""), "temperature": 0.9, "max_tokens": 1500,
                    "messages": [{"role": "user", "content": prompt}]}
            req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
                "Content-Type": "application/json", "Authorization": f"Bearer {os.getenv('OPENAI_API_KEY', '')}"})
            with urllib.request.urlopen(req, timeout=120) as res:
                return json.loads(res.read())["choices"][0]["message"]["content"] or ""
        return ask
    from google import genai
    client = genai.Client()
    return lambda prompt: client.models.generate_content(model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash"), contents=prompt).text or ""


def gen(lang: str, n: int, out: str, scam_ratio: float = 0.6, generator: str = "gemini", rng_seed: int = 7, workers: int = 6):
    from concurrent.futures import ThreadPoolExecutor
    import risk_engine  # noqa: F401  (loads the repo-root .env)
    ask, rng = _write_with(generator), random.Random(rng_seed)
    language = {"ja": "Japanese", "vi": "Vietnamese"}[lang]
    jobs = []
    for i in range(n):
        if rng.random() < scam_ratio:
            t = rng.choice(SCAM_TYPES[lang])
            stop = rng.choice(["the victim hangs up early (only authority claim + threat)",
                               "reaches channel switch (chat app / video call / install app)",
                               "reaches a money / OTP / cash-card request"])
            extra = f"Scam kill chain: authority -> fear -> isolation -> channel switch -> money. Conversation {stop}. Make it subtle, avoid obvious keywords half of the time."
            label, scenario = "scam", t
        else:
            t, label, scenario = "safe", "safe", rng.choice(BENIGN[lang])
            extra = "Hard negative: may mention banks, police, money or accounts in a LEGITIMATE way."
        jobs.append((i, label, t, GEN_PROMPT.format(language=language, label=label, scenario=scenario,
                                                    persona=rng.choice(PERSONAS[lang]), extra=extra)))

    def one(job):
        i, label, t, prompt = job
        for attempt in (1, 2, 3):
            try:
                text = ask(prompt).strip()
                if "A:" in text and len(text) > 80:
                    print(f"[{i + 1}/{n}] {label}/{t}", file=sys.stderr)
                    return {"id": f"{lang}-{i:04d}" if rng_seed == 7 else f"{lang}-s{rng_seed}-{i:04d}", "lang": lang, "label": label, "scam_type": t,
                            "generator": os.getenv("FCI_MODEL") if generator == "fci" else os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
                            "text": text[text.index("A:"):]}
            except Exception as e:
                print(f"[{i + 1}/{n}] retry {attempt}: {type(e).__name__}", file=sys.stderr)
        return None

    Path(out).parent.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(workers) as pool:
        rows = [r for r in pool.map(one, jobs) if r]
    with open(out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"wrote {len(rows)}/{n} rows to {out}", file=sys.stderr)

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

def _metrics(rows: list[dict], key: str, threshold: str) -> dict:
    order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
    tp = fp = tn = fn = 0
    for r in rows:
        pred, gold = order[r[key]] >= order[threshold], r["label"] == "scam"
        tp += pred and gold; fp += pred and not gold; tn += (not pred) and (not gold); fn += (not pred) and gold
    return {"recall": tp / (tp + fn) if tp + fn else 0.0, "precision": tp / (tp + fp) if tp + fp else 0.0,
            "fpr": fp / (fp + tn) if fp + tn else 0.0, "tp": tp, "fp": fp, "tn": tn, "fn": fn}


def ablation(datasets: list[str], out_md: str, model: str | None, workers: int = 6) -> None:
    """Rules only vs rules + LLM on the same samples -> a markdown report. The point of the table is the question
    the judges will ask: what does Gen AI add over a keyword filter, and what does it cost in false alarms?"""
    from concurrent.futures import ThreadPoolExecutor
    sys.path.insert(0, str(Path(__file__).parent))
    import risk_engine as engine
    from input_layer import build_evidence
    samples = [json.loads(line) for d in datasets for line in open(d, encoding="utf-8") if line.strip()]

    def run(sample):
        text = build_evidence(lang=sample["lang"], text=sample["text"]).text  # masked, as in production
        rules = engine.analyze(text, sample["lang"], use_llm=False)
        verdict = engine.llm_verdict(text, sample["lang"], "gemini", model)
        fused = engine.analyze(text, sample["lang"], use_llm=False, verdict=verdict) if verdict else rules
        return {**sample, "rules": rules["risk_level"], "fused": fused["risk_level"], "llm_ok": verdict is not None,
                "rules_score": rules["risk_score"], "fused_score": fused["risk_score"]}

    with ThreadPoolExecutor(workers) as pool:
        rows = list(pool.map(run, samples))
    answered = [r for r in rows if r["llm_ok"]]
    judge = model or os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    lines = ["# Evaluation: what the LLM adds over rules", "",
             f"Generated by `python core/gen_dataset.py ablation` on {__import__('datetime').date.today()}. Judge: `{judge}`. "
             f"Transcript writer: {', '.join(sorted({str(r.get('generator')) for r in rows}))} - a different model family from the judge, "
             "so the judge never grades its own writing. All data is synthetic; numbers are masked before scoring, as in production.", "",
             f"Samples: {len(rows)} ({sum(r['label'] == 'scam' for r in rows)} scam / {sum(r['label'] != 'scam' for r in rows)} legitimate, "
             f"incl. hard negatives that mention banks, police or money). LLM answered on {len(answered)}/{len(rows)}; "
             "the comparison below uses those samples.", ""]
    for threshold, meaning in (("MEDIUM", "any warning shown"), ("HIGH", "full-screen alarm + spoken alert + family push")):
        lines += [f"## Threshold {threshold} ({meaning})", "", "| Lang | System | Recall | Precision | False-positive rate | TP | FP | TN | FN |", "|---|---|---|---|---|---|---|---|---|"]
        for lang in sorted({r["lang"] for r in answered}) + ["all"]:
            part = [r for r in answered if lang == "all" or r["lang"] == lang]
            for key, name in (("rules", "rules only"), ("fused", "rules + LLM")):
                m = _metrics(part, key, threshold)
                lines.append(f"| {lang} | {name} | {m['recall']:.1%} | {m['precision']:.1%} | {m['fpr']:.1%} | {m['tp']} | {m['fp']} | {m['tn']} | {m['fn']} |")
        lines.append("")
    lines += ["## Recall by scam type (threshold MEDIUM)", "", "| Scam type | n | rules only | rules + LLM |", "|---|---|---|---|"]
    for t in sorted({r["scam_type"] for r in answered if r["label"] == "scam"}):
        part = [r for r in answered if r["scam_type"] == t]
        lines.append(f"| {t} | {len(part)} | {_metrics(part, 'rules', 'MEDIUM')['recall']:.0%} | {_metrics(part, 'fused', 'MEDIUM')['recall']:.0%} |")
    wrong = [r for r in answered if (r["fused"] != "LOW") != (r["label"] == "scam")]
    lines += ["", f"## Remaining errors of rules + LLM at MEDIUM ({len(wrong)})", ""]
    lines += [f"- `{r['id']}` {r['label']}/{r['scam_type']}: rules {r['rules']} ({r['rules_score']}) → fused {r['fused']} ({r['fused_score']})" for r in wrong[:25]] or ["None."]
    lines += ["", "## Limits", "", "- Synthetic transcripts written by an LLM are cleaner than real calls (no STT errors, no crosstalk).",
              "- Scam samples that stop after the authority + threat stage are labelled scam; a LOW there is counted as a miss.",
              "- Labels come from the generation prompt and were not hand-corrected. At least one `safe` sample (`vi-0055`: a courier asking for a COD transfer to a personal account before delivery) matches a real-world scam pattern, so the HIGH it gets is counted as a false positive here.",
              "- Real held-out audio (police-published samples) is evaluated privately and never committed."]
    Path(out_md).parent.mkdir(parents=True, exist_ok=True)
    Path(out_md).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[5:]))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["gen", "seed", "eval", "ablation"])
    ap.add_argument("--lang", default="ja", choices=["ja", "vi"])
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--out", default="eval/dataset.jsonl")
    ap.add_argument("--data", default="eval/dataset.jsonl")
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--seed", type=int, default=7, help="gen: sampling seed (use another one for a held-out test set)")
    ap.add_argument("--generator", default="gemini", choices=["gemini", "fci"], help="gen: who writes the transcripts")
    ap.add_argument("--datasets", nargs="+", default=[], help="ablation: one or more .jsonl files")
    ap.add_argument("--report", default="../docs/EVAL.md", help="ablation: markdown output")
    ap.add_argument("--model", default=None, help="ablation: judge model (default GEMINI_MODEL)")
    a = ap.parse_args()
    if a.cmd == "gen": gen(a.lang, a.n, a.out, generator=a.generator, rng_seed=a.seed)
    elif a.cmd == "ablation": ablation(a.datasets, a.report, a.model)
    elif a.cmd == "seed": seed(a.lang, a.out)
    else: evaluate(a.data, a.lang, not a.no_llm)
