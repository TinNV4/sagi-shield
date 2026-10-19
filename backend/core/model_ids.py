"""
Sagi Shield - which model does which job. The ONLY model IDs in the code: every call site asks model_id(), and
the env var named after the job overrides the default (.env locally; on Cloud Run only if the deploy passes one -
infra/deploy.sh from the shell, .github/workflows/deploy.yml from repository variables). The defaults below are
what Cloud Run runs: flash-lite judges text, runs the agent and Live Guard (~1.3 s, docs/EVAL.md); 3.8 Flash reads
screenshots and gives the second opinion.

  GEMINI_MODEL          text judge, recovery agent, audio-transcription fallback, dataset generation
  GEMINI_LIVE_MODEL     Live Guard judge (fast)
  GEMINI_CONFIRM_MODEL  second opinion before an alarm the rules cannot back
  GEMINI_VISION_MODEL   screenshots / documents
  GEMINI_DEEP_MODEL     opt-in Google-Search deep check  (unset -> GEMINI_CONFIRM_MODEL)
  STT_BATCH_MODEL       uploaded-recording transcription
  GEMINI_TTS_MODEL      the spoken alerts, generated once by tools/make_alert_voice.py (never at run time)
"""
from __future__ import annotations
import os

DEFAULTS = {
    "GEMINI_MODEL": "gemini-3.5-flash-lite",
    "GEMINI_VISION_MODEL": "gemini-3.8-flash",
    "GEMINI_LIVE_MODEL": "gemini-3.5-flash-lite",
    "GEMINI_CONFIRM_MODEL": "gemini-3.8-flash",
    "STT_BATCH_MODEL": "gemini-3.5-transcribe",
    "GEMINI_TTS_MODEL": "gemini-3.8-flash-tts",
}
FALLBACK = {"GEMINI_DEEP_MODEL": "GEMINI_CONFIRM_MODEL"}


def model_id(job: str) -> str:
    value = os.getenv(job, "").strip()
    if value:
        return value
    return model_id(FALLBACK[job]) if job in FALLBACK else DEFAULTS[job]
