"""How much accuracy survives speech recognition? Clean synthetic transcripts flatter the judge: real calls reach it
through STT. This tool speaks N evaluation transcripts with the local Windows voices, transcribes the audio with the
product's transcriber, and scores clean text vs heard text side by side.

  python tools/eval_stt_noise.py prepare --n 20          # pick samples -> tools/stt_eval_calls.json, then run:
  pwsh tools/make_test_audio.ps1 -CallsFile tools/stt_eval_calls.json -OutDir tools/stt_eval_audio
  python tools/eval_stt_noise.py score                   # transcribe + judge -> appends a section to docs/EVAL.md

Synthetic voices are cleaner than a speakerphone across a room; treat the result as an upper bound.
"""
import argparse, json, pathlib, random, re, sys
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend")); sys.path.insert(0, str(ROOT / "backend" / "core"))
CALLS, AUDIO = ROOT / "tools" / "stt_eval_calls.json", ROOT / "tools" / "stt_eval_audio"
VOICES = {"ja": ("ja-JP", "Microsoft Ichiro"), "vi": ("vi-VN", "Microsoft An")}


def prepare(n: int) -> None:
    rng, calls = random.Random(5), []
    for lang in ("ja", "vi"):
        rows = [json.loads(l) for l in open(ROOT / "backend" / "eval" / f"{lang}_final.jsonl", encoding="utf-8")]
        scam, safe = [r for r in rows if r["label"] == "scam"], [r for r in rows if r["label"] != "scam"]
        for r in rng.sample(scam, n * 6 // 10) + rng.sample(safe, n - n * 6 // 10):
            lines = [re.sub(r"^[AB]\s*[:：]\s*", "", x).strip() for x in re.split(r"\s(?=[AB]\s*[:：])|\n", r["text"]) if x.strip()]
            lines = [re.sub(r"<(PHONE|ACCOUNT|URL)>", "", x) for x in lines]  # placeholders are not speakable
            calls.append({"name": r["id"], "culture": VOICES[lang][0], "voice": VOICES[lang][1],
                          "expect": "HIGH" if r["label"] == "scam" else "LOW", "label": r["label"], "lang": lang,
                          "lines": [x for x in lines if x], "clean_text": r["text"]})
    CALLS.write_text(json.dumps(calls, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(calls)} calls to {CALLS}")


def score(model: str) -> None:
    import risk_engine as engine
    from input_layer import build_evidence
    from app import services
    calls = [c for c in json.loads(CALLS.read_text(encoding="utf-8")) if (AUDIO / f"{c['name']}.wav").exists()]

    def run(c):
        heard = services.transcribe_audio((AUDIO / f"{c['name']}.wav").read_bytes(), "audio/wav", c["lang"]) or ""
        out = {}
        for key, text in (("clean", c["clean_text"]), ("heard", heard)):
            masked = build_evidence(lang=c["lang"], text=text).text if text else ""
            verdict = engine.llm_verdict(masked, c["lang"], "gemini", model) if masked else None
            out[key if key == "clean" else "heard_level"] = engine.analyze(masked, c["lang"], use_llm=False, verdict=verdict)["risk_level"] if masked else "LOW"
        import difflib
        spoken = " ".join(c["lines"])
        return {**c, **out, "heard": heard, "similarity": difflib.SequenceMatcher(None, spoken, heard).ratio() if heard else 0.0}

    with ThreadPoolExecutor(2) as pool:  # the transcribe model has a low per-minute quota
        rows = list(pool.map(run, calls))
    order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}

    def metrics(key, threshold):
        tp = sum(order[r[key]] >= order[threshold] and r["label"] == "scam" for r in rows)
        fp = sum(order[r[key]] >= order[threshold] and r["label"] != "scam" for r in rows)
        pos, neg = sum(r["label"] == "scam" for r in rows), sum(r["label"] != "scam" for r in rows)
        return f"{tp / pos:.1%} / {fp / neg:.1%}" if pos and neg else "-"

    changed = [r for r in rows if r["clean"] != r["heard_level"]]
    empty = sum(not r["heard"] for r in rows)
    sims = sorted(r["similarity"] for r in rows if r["heard"])
    lines = ["", "## After speech recognition (TTS → transcription → judge)", "",
             f"{len(rows)} calls from the final set, spoken by local Windows voices and transcribed by the product's transcription chain (`gemini-3.5-transcribe`; the general Gemini model takes over when it is rate-limited, which happened for about half of the calls in this run). "
             "Recall / false-positive rate:", "", "| Input to the judge | MEDIUM | HIGH |", "|---|---|---|",
             f"| clean transcript | {metrics('clean', 'MEDIUM')} | {metrics('clean', 'HIGH')} |",
             f"| heard transcript | {metrics('heard_level', 'MEDIUM')} | {metrics('heard_level', 'HIGH')} |", "",
             f"Transcription: {empty} of {len(rows)} came back empty; character similarity to the spoken script: median {sims[len(sims) // 2]:.0%}, worst {sims[0]:.0%}." if sims else "Transcription failed for every call.",

             f"Verdict level changed on {len(changed)} of {len(rows)} calls: " +
             (", ".join(f"`{r['name']}` {r['clean']}→{r['heard_level']}" for r in changed[:12]) or "none") + ".",
             "Synthetic voices are cleaner than a speakerphone across a room: read this as an upper bound."]
    report = ROOT / "docs" / "EVAL.md"
    text = report.read_text(encoding="utf-8")
    text = re.sub(r"\n## After speech recognition.*?(?=\n## |\Z)", "", text, flags=re.S).rstrip("\n")
    report.write_text(text + "\n" + "\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["prepare", "score"])
    ap.add_argument("--n", type=int, default=20, help="prepare: calls per language")
    ap.add_argument("--model", default="gemini-3.5-flash-lite")
    a = ap.parse_args()
    prepare(a.n) if a.cmd == "prepare" else score(a.model)
