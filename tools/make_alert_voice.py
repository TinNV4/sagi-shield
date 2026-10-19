"""Spoken alerts in a Gemini voice, generated once and shipped with the PWA (frontend/public/voice/<clip>-<lang>.wav).

    python tools/make_alert_voice.py                 # (re)generate clips whose text / voice / style changed
    python tools/make_alert_voice.py --force         # all of them
    python tools/make_alert_voice.py --voice Charon --only hangup-ja --out <dir>   # try a voice without touching the app

The texts live in frontend/src/lib/alertVoice.json (speak.ts reads the same file for its browser-voice fallback);
hangup ja / vi must equal LANG_PACKS[...]['speak'] and guardian the i18n `guardian.alert_spoken` - a backend test
checks that, and that every clip's fingerprint matches its text, so an edited sentence without new audio fails CI.
Model: model_id("GEMINI_TTS_MODEL"), Gemini Developer API (GEMINI_API_KEY in .env). Nine short clips cost well under
one yen. Nothing is synthesized at run time: the alert must play the instant a call turns HIGH, even offline.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "core"))
SPEC = ROOT / "frontend" / "src" / "lib" / "alertVoice.json"
OUT = ROOT / "frontend" / "public" / "voice"
RATE = 24000  # Gemini TTS: 24 kHz, mono, 16-bit PCM


def fingerprint(text: str, voice: str, style: str) -> str:
    return hashlib.sha256(f"{voice}|{style}|{text}".encode()).hexdigest()[:12]


def as_wav(audio: bytes) -> bytes:
    if audio[:4] == b"RIFF":
        return audio
    header = b"RIFF" + struct.pack("<I", 36 + len(audio)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, RATE, RATE * 2, 2, 16)
    return header + b"data" + struct.pack("<I", len(audio)) + audio


def seconds(wav: bytes) -> float:
    return (len(wav) - 44) / (RATE * 2)


def synthesize(client, model: str, text: str, voice: str, style: str) -> bytes:
    interaction = client.interactions.create(
        model=model,
        input=[{"type": "user_input", "content": [{
            "type": "text", "text": text,  # read verbatim; the delivery goes in the style annotation
            "annotations": [{"type": "speech_metadata", "style": style}],
        }]}],
        response_format={"type": "audio"},
        generation_config={"speech_config": [{"voice": voice}]},
    )
    return as_wav(base64.b64decode(interaction.output_audio.data))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", nargs="*", help="clip keys like hangup-ja")
    ap.add_argument("--voice", help="override the voice in alertVoice.json (with --out: audition only)")
    ap.add_argument("--out", type=Path, help="write here and leave alertVoice.json alone")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    from dotenv import load_dotenv
    from google import genai
    from model_ids import model_id
    load_dotenv(ROOT / ".env")
    model = model_id("GEMINI_TTS_MODEL")
    # explicit enterprise=False: GOOGLE_GENAI_USE_ENTERPRISE=true would send the key to Agent Platform
    client = genai.Client(enterprise=False, api_key=os.environ["GEMINI_API_KEY"].strip())

    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    voice, style = a.voice or spec["voice"], spec["style"]
    audition = a.out is not None
    out = a.out or OUT
    out.mkdir(parents=True, exist_ok=True)
    for clip, texts in spec["clips"].items():
        for lang, text in texts.items():
            key = f"{clip}-{lang}"
            if a.only and key not in a.only:
                continue
            fp = fingerprint(text, voice, style)
            path = out / f"{key}.wav"
            if not (a.force or audition) and spec["generated"].get(key) == fp and path.exists():
                print(f"{key:<12} unchanged")
                continue
            wav = synthesize(client, model, text, voice, style)
            path.write_bytes(wav)
            print(f"{key:<12} {seconds(wav):4.1f} s {len(wav) / 1024:5.0f} KB  {voice}")  # speak.ts repeats after the end
            if not audition:
                spec["generated"][key] = fp
    if not audition:
        spec["voice"], spec["model"] = voice, model
        SPEC.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
