"""The recorded alert voices (frontend/public/voice) say what the app and the server say: an edited sentence without
re-running tools/make_alert_voice.py fails here instead of shipping a clip that speaks the old text."""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend" / "core"))
sys.path.insert(0, str(ROOT / "tools"))
from make_alert_voice import fingerprint  # noqa: E402
from risk_engine import LANG_PACKS  # noqa: E402

SPEC = json.loads((ROOT / "frontend" / "src" / "lib" / "alertVoice.json").read_text(encoding="utf-8"))
CLIPS = [(clip, lang, text) for clip, texts in SPEC["clips"].items() for lang, text in texts.items()]


@pytest.mark.parametrize("lang", ["ja", "vi"])
def test_hangup_clip_says_the_servers_sentence(lang):
    assert SPEC["clips"]["hangup"][lang] == LANG_PACKS[lang]["speak"]


@pytest.mark.parametrize("lang", ["ja", "vi", "en"])
def test_guardian_clip_says_the_screens_sentence(lang):
    i18n = json.loads((ROOT / "frontend" / "src" / "i18n" / f"{lang}.json").read_text(encoding="utf-8"))
    assert SPEC["clips"]["guardian"][lang] == i18n["guardian"]["alert_spoken"]


@pytest.mark.parametrize("clip,lang,text", CLIPS, ids=[f"{c}-{l}" for c, l, _ in CLIPS])
def test_every_clip_was_recorded_from_its_current_text(clip, lang, text):
    assert SPEC["generated"].get(f"{clip}-{lang}") == fingerprint(text, SPEC["voice"], SPEC["style"])
    assert (ROOT / "frontend" / "public" / "voice" / f"{clip}-{lang}.wav").stat().st_size > 10_000
