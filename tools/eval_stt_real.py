"""How well does the transcription chain hear REAL scam calls? Compares its output with the official PDF transcripts
of the Nagano police recordings (private held-out data, see tools/eval_real_audio.py). Prints numbers only - never
the transcripts. Run from the repo root:  python tools/eval_stt_real.py [file ...]

similarity = difflib ratio on text without spaces / punctuation / speaker labels; coverage = heard chars / reference chars
(low coverage on a long file = the transcriber stopped early or summarized).
"""
import contextlib, difflib, io, pathlib, re, sys, time, unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend")); sys.path.insert(0, str(ROOT / "backend" / "core"))
DATA = ROOT / "backend" / "eval" / "real_heldout"


def squash(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"(犯人|被害者|警察官|息子|母|父|男|女|[A-ZＡ-Ｚ])\s*[:：]", "", text)  # speaker labels
    return re.sub(r"[\W_]+", "", text)


def reference(pdf: pathlib.Path) -> str:
    """The police PDFs are scans without a text layer: Gemini reads them once, the result is cached next to the PDF
    (git-ignored). OCR noise lowers the similarity a little for every file alike."""
    cache = pdf.with_suffix(".ref.txt")
    if not cache.exists():
        from google.genai import types
        from app import services
        resp = services._generate(model="gemini-3.8-flash", contents=[
            types.Part.from_bytes(data=pdf.read_bytes(), mime_type="application/pdf"),
            "Transcribe the spoken dialogue in this document verbatim. Output the dialogue text only: no speaker labels, no headings, no notes."])
        cache.write_text(resp.text or "", encoding="utf-8")
        time.sleep(2)
    return squash(cache.read_text(encoding="utf-8"))


def main(names: list[str]) -> None:
    import risk_engine  # noqa: F401  (.env)
    from app import services
    files = [DATA / n for n in names] if names else sorted(DATA.glob("*.mp3"))
    rows = []
    for audio in files:
        pdf = audio.with_suffix(".pdf")
        if not pdf.exists():
            continue
        ref = reference(pdf)
        if len(ref) < 50:
            print(f"{audio.name:12} reference PDF has no text layer ({len(ref)} chars) - skipped"); continue
        log = io.StringIO(); t = time.time()
        with contextlib.redirect_stderr(log):
            heard = squash(services.transcribe_audio(audio.read_bytes(), "audio/mpeg", "ja") or "")
        path = "transcribe-model" if "transcribe model" not in log.getvalue() else "FALLBACK (" + ("chirp" if "gemini transcription" in log.getvalue() else "general model") + ")"
        sim = difflib.SequenceMatcher(None, ref, heard, autojunk=False).ratio() if heard else 0.0
        rows.append((audio.name, len(ref), len(heard), sim))
        print(f"{audio.name:12} ref={len(ref):5} heard={len(heard):5} coverage={len(heard) / len(ref):4.0%} similarity={sim:4.0%} {time.time() - t:5.1f}s {path}")
        time.sleep(4)  # stay under the per-minute quota of the transcribe model
    if rows:
        sims = sorted(r[3] for r in rows)
        print(f"files={len(rows)} median similarity={sims[len(sims) // 2]:.0%} worst={sims[0]:.0%} | coverage<70%: {[r[0] for r in rows if r[2] / r[1] < 0.7]}")


if __name__ == "__main__":
    main(sys.argv[1:])
