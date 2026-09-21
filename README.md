# Sagi Shield（サギシールド）

**A real-time AI guard against phone scams** - オレオレ詐欺 / ニセ警察詐欺 in Japan, fake-police ("công an") scams in Vietnam.
Google Cloud AI Builder Cup 2026 · Theme: BFSI.

**Live demo:** https://sagi-shield-api-209791011329.asia-northeast1.run.app (PWA + API on one Cloud Run service)

A tablet or an old phone sits next to the landline. It listens to speaker calls, follows the scam *kill chain*
(authority → fear → isolation → channel switch → money) and, the moment the pattern is clear, takes over the screen,
**speaks a warning out loud** and alerts the family. The caller's voice never leaves the device.

## What it does

| Feature | How |
|---|---|
| **Live Guard** | Speech-to-text **on the device** (Web Speech API, `processLocally`). Only finalized, number-masked text goes to the server: rules on every line, Gemini only once the rules reach MEDIUM. HIGH latches after two consecutive windows → full-screen alarm + spoken alert + family alert. |
| **Quick Check** | Text, screenshot (Gemini vision: a "warrant" or police ID sent by chat is HIGH by rule), audio file (`gemini-3.5-transcribe`, Chirp 3 fallback), phone number (overseas caller, community reports), link (URL shape + Web Risk; the link is never opened). |
| **Before You Pay** | Three questions before a transfer: who asked, who receives, why. "Police asked me to move my savings" is HIGH by rule. |
| **Recovery agent** | "I already paid": an ADK 2.x agent walks the victim through the first hour (freeze the transfer, police, evidence, family) and drafts the police statement. Steps and phone numbers are server-owned - the model cannot invent a hotline. |
| **Family** | 6-digit code / QR pairing; the guardian's dashboard shows a one-sentence summary of each alert - never the transcript. |

## Why rules *and* an LLM

Rules are instant, offline and cannot be talked out of a verdict (`HARD_COMBOS`: "police" + "move to LINE" has no
legitimate version). The LLM catches what keywords cannot - an ore-ore call contains no suspicious word - and
lowers false alarms on news, dramas and real bank calls. Fusion: `score = c·LLM + (1−c)·rules`, hard combos are final.

Measured on a held-out set of 117 synthetic ja/vi calls, **written by a different model family than the judge** and
never used for tuning ([docs/EVAL.md](docs/EVAL.md) has the method, the dev / test sets and the limits):

| Threshold | System | Recall | False-positive rate |
|---|---|---|---|
| any warning (MEDIUM) | rules only | 64.7% | 49.0% |
| any warning (MEDIUM) | **rules + Gemini** | **100%** | **4.1%** |
| alarm (HIGH) | rules only | 29.4% | 0.0% |
| alarm (HIGH) | **rules + Gemini** | **91.2%** | **0.0%** |

## Privacy by design

1. **Tier 0** - audio stays on the device; rules run on masked text.
2. **Tier 1** - the masked rolling window (phone / account numbers replaced) reaches Gemini only from MEDIUM, at most every 5 s.
3. Nothing is stored from a call. Reports keep an HMAC of the number (key in Secret Manager), never the number.
4. Transcripts, OCR text and URLs are untrusted data: structured output, no instructions followed, URLs never fetched.
5. The access log has no bodies, query strings or IP addresses.

## Architecture (all Google Cloud)

```
PWA (React + Vite, served by the API)
  ├─ on-device STT ──text──▶ WS /ws/live ─▶ rules ─▶ Gemini 3.5 Flash-Lite (from MEDIUM)
  ├─ POST /check  ─▶ input layer (mask, URL flags, EXIF strip) ─▶ rules + Gemini
  │                  ├─ image  ─▶ Gemini 3.8 Flash (vision)
  │                  ├─ audio  ─▶ gemini-3.5-transcribe ─▶ Chirp 3 fallback
  │                  └─ url    ─▶ Web Risk
  ├─ POST /agent/recovery ─▶ ADK 2.x agent (3 tools) ─▶ Firestore session (24 h TTL)
  └─ /family/* ─▶ Firestore
Cloud Run (asia-northeast1) · Gemini on Agent Platform (global) · Firestore · Web Risk · Speech-to-Text · Secret Manager
```

Details, decisions and the phase checklist: [docs/PLAN.md](docs/PLAN.md). Working notes for coding agents: [CLAUDE.md](CLAUDE.md).

## Run it locally

```bash
cd backend
pip install -r requirements.txt
cp ../.env.example ../.env          # Gemini API key, or an Agent Platform project
python -m pytest tests -q           # 82 tests, offline
USE_LLM=0 uvicorn app.main:app --port 8080     # rules only; drop USE_LLM=0 to use Gemini

cd ../frontend
npm install
echo VITE_API_BASE=http://localhost:8080 > .env
npm run dev                         # http://localhost:3000 (without VITE_API_BASE the app runs on mock data)
```

## Deploy

```bash
pwsh infra/setup.ps1 -Project <project-id>         # once: APIs, Firestore + TTL, secret, service account
pwsh infra/setup_stt_key.ps1 -Project <project-id> # once, optional: API key for gemini-3.5-transcribe
PROJECT=<project-id> ./infra/deploy.sh             # builds the PWA, deploys API + PWA to Cloud Run
python tools/check_tabs.py  https://<service-url>  # post-deploy checks
python tools/check_audio.py https://<service-url>
```

## Repository

```
backend/core/   input_layer.py (normalize + mask) · risk_engine.py (kill chain, fusion, LiveTracker) · gen_dataset.py (data + ablation)
backend/app/    FastAPI: main.py (/check …) · live.py (WS) · agent.py (ADK) · services.py (Google calls) · storage.py · guard.py
backend/eval/   synthetic evaluation set · backend/tests/ 82 offline tests
frontend/       React + Vite PWA (ja / vi / en)
infra/          setup + deploy scripts · tools/ test calls, post-deploy checks, model comparison · docs/ plan + evaluation
```

## Testing with recorded calls

No real victims or police recordings are used. `tools/test_calls.json` holds six scripted calls (Japanese and
Vietnamese, scam and benign); `pwsh tools/make_test_audio.ps1` turns them into WAV files with the voices installed
on a Windows machine (offline). Then either:

- `python tools/check_audio.py https://<service-url>` - uploads each file to `/check` and compares the level;
- Live Guard → **Test tools** - plays a file through the same on-device recognizer as the microphone
  (Chrome 139+), or lets you type what the caller says line by line;
- or simply play a file on another device next to the microphone - that is the real product setup.
