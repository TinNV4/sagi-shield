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
| **Live Guard** | Speech-to-text **on the device** (Web Speech API, `processLocally`). Only finalized, number-masked text goes to the server: rules on every line, and the masked rolling window goes to Gemini about every 20 s (or, with `gate=rules`, only once the rules reach MEDIUM). A set-up call ("my number changed, I have a cold") is remembered **on the device** for 48 h, so the money request that follows a day later raises the alarm. HIGH latches after two consecutive windows → full-screen alarm + spoken alert (a Gemini TTS voice recorded once, the browser voice as fallback) + family alert. |
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

On real recordings published by the Nagano police (private check, never committed): 15 of 15 scam cases warned, 14 of 15
alarmed. On 93 minutes of real non-scam speech: 0 false alarms. On 79 legitimate calls written to sound like scams: 6.3%
alarmed. Details, method and limits: [docs/EVAL.md](docs/EVAL.md).

## Roadmap

- **Deepfake video calls** (a cloned face and voice of a relative asking for money): today an awareness card and the judge's playbook; next, on-device liveness cues and a one-tap "call back on the saved number" flow with guardian confirmation.
- Bank-embedded 振込前チェック API, Vietnamese Live Guard at full parity, real held-out evaluation with police-published calls, fine-tuning once consented real data exists.

## Privacy by design

1. **Tier 0** - audio stays on the device; rules run on masked text.
2. **Tier 1** - the masked rolling window (phone / account numbers replaced) reaches Gemini about every 20 s during a call. Real police recordings showed why: natural speech rarely matches rule patterns, so a rules-only gate never consulted the model on real calls. Strict mode (`gate=rules`) keeps the old behaviour: text leaves the rules only from MEDIUM.
3. Nothing is stored from a call. Reports keep an HMAC of the number (key in Secret Manager), never the number.
4. Transcripts, OCR text and URLs are untrusted data: structured output, no instructions followed, URLs never fetched.
5. The access log has no bodies, query strings or IP addresses.

## Architecture (all Google Cloud)

```
PWA (React + Vite, served by the API)
  ├─ on-device STT ──text──▶ WS /ws/live ─▶ rules ─▶ Gemini 3.5 Flash-Lite (every ~20 s; 3.8 Flash confirms an alarm the rules cannot back)
  ├─ POST /check  ─▶ input layer (mask, URL flags, EXIF strip) ─▶ rules + Gemini
  │                  ├─ image  ─▶ Gemini 3.8 Flash (vision)
  │                  ├─ audio  ─▶ gemini-3.5-transcribe ─▶ Chirp 3 fallback
  │                  └─ url    ─▶ Web Risk
  ├─ POST /agent/recovery ─▶ ADK 2.x agent (6 tools) · CI on every push, auto-deploy to Cloud Run after CI passes on main (`.github/workflows/`, WIF via `infra/setup_cd.sh`) · JPCERT/CC phishing list in Firestore, reloaded monthly by a Cloud Run Job on Cloud Scheduler (`backend/app/phish_list.py`, `infra/setup_phish_job.ps1`) · opt-in deep check (`/deepcheck`, Gemini grounded with Google Search) ─▶ Firestore session (24 h TTL)
  ├─ /family/*, /report ─▶ Firestore (lookups while the user waits: reported numbers, pairing, alerts)
  └─ every verdict ─▶ BigQuery `sagi.events` (anonymous: no text, numbers or ids) ─▶ Looker Studio scam map
Cloud Run (asia-northeast1) + a Cloud Run Job on Cloud Scheduler · Gemini on Agent Platform (global) · Gemini TTS (alert voices, generated once) · Firestore · BigQuery · Web Risk · Speech-to-Text · Secret Manager
```

Details, decisions and the phase checklist: [docs/PLAN.md](docs/PLAN.md). Working notes for coding agents: [CLAUDE.md](CLAUDE.md).

## Run it locally

```bash
cd backend
pip install -r requirements.txt
cp ../.env.example ../.env          # Gemini API key, or an Agent Platform project
python -m pytest tests -q           # 111 tests, offline, no network
USE_LLM=0 uvicorn app.main:app --port 8080     # rules only; drop USE_LLM=0 to use Gemini

cd ../frontend
npm install
echo VITE_API_BASE=http://localhost:8080 > .env
npm run dev                         # http://localhost:3000 (without VITE_API_BASE the app runs on mock data)
```

Or the container, exactly as Cloud Run runs it (the PWA is served by the API when `frontend/` was built into
`backend/static/`):

```bash
cd frontend && VITE_API_BASE=same-origin npm run build && rm -rf ../backend/static && cp -r dist ../backend/static && cd ..
docker build -t sagi-shield-api backend
docker run --rm -p 8080:8080 --env-file .env -e USE_LLM=1 -e STORE=memory sagi-shield-api
# open http://localhost:8080
```

### Configuration (`.env`, all optional except the model access)

| Variable | Default | Meaning |
|---|---|---|
| `GOOGLE_GENAI_USE_ENTERPRISE`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | `true`, -, `global` | Gemini on Agent Platform (production). With `GEMINI_API_KEY` instead, set `GOOGLE_GENAI_USE_ENTERPRISE=false` |
| `GEMINI_MODEL` / `GEMINI_LIVE_MODEL` / `GEMINI_VISION_MODEL` / `GEMINI_CONFIRM_MODEL` | `gemini-3.5-flash-lite` / same / `gemini-3.8-flash` / `gemini-3.8-flash` | text judge + agent / Live Guard judge / screenshots / second opinion |
| `USE_LLM` | `1` | `0` = rules only, offline (tests, demos without credentials) |
| `STORE` | `memory` | `firestore` on Cloud Run |
| `USE_WEBRISK` | `0` | `1` = check links against Web Risk |
| `HASH_KEY` | `change-me` | HMAC key for reported numbers; a Secret Manager secret in production |
| `STT_API_KEY` | - | Gemini Developer API key for `gemini-3.5-transcribe` (uploads); Chirp 3 otherwise |
| `LIVE_LLM_GATE`, `LIVE_PERIODIC_S`, `LIVE_PERIODIC_LINES`, `LIVE_CONTEXT` | `periodic`, `20`, `6`, `on` | when the Live Guard judge is consulted, and whether it gets the pinned opening + call state |
| `BQ_TABLE` | - | `project.sagi.events`: anonymous verdict rows for the scam map |
| `VERDICT_LOG`, `LOG_TEXT` | -, `0` | JSONL copy of the verdict log (why each verdict); `LOG_TEXT=1` adds masked text, local evaluation only |
| `RATE_LIMIT_PER_MIN`, `CORS_ORIGINS` | `30`, `*` | per-client brake; allowed origins |

## Deploy

Scripts (the quick path, used for the live demo):

```bash
pwsh infra/setup.ps1 -Project <project-id>         # once: APIs, Firestore + TTL, secret, service account
pwsh infra/setup_stt_key.ps1 -Project <project-id> # once, optional: API key for gemini-3.5-transcribe
pwsh infra/setup_analytics.ps1 -Project <project-id> # once, optional: BigQuery events + views for Looker Studio
PROJECT=<project-id> ./infra/deploy.sh             # builds the PWA, deploys API + PWA to Cloud Run
python tools/check_tabs.py  https://<service-url>  # post-deploy checks
python tools/check_audio.py https://<service-url>
```

Or as code, `infra/terraform/` (APIs, least-privilege service account, Firestore + TTL, the HMAC secret, BigQuery,
Cloud Run with secrets mounted; the image is built by Cloud Build from `backend/Dockerfile`):

```bash
gcloud builds submit backend --tag asia-northeast1-docker.pkg.dev/<project-id>/cloud-run-source-deploy/sagi-shield-api:latest
cd infra/terraform && terraform init && terraform apply -var project=<project-id> \
  -var image=asia-northeast1-docker.pkg.dev/<project-id>/cloud-run-source-deploy/sagi-shield-api:latest
```

**Where to look when it runs:** every check and every Live Guard look writes a structured line to Cloud Logging
(`jsonPayload.kind="live_look"`: rule hits, the judge's verdict and reasons, the call state it was given, latency);
`python tools/verdict_log.py <jsonl | ->` summarises a local log or a `gcloud logging read --format=json` export.

## Repository

```
backend/core/   input_layer.py (normalize + mask) · risk_engine.py (kill chain, fusion, LiveTracker) · gen_dataset.py (data + ablation)
backend/app/    FastAPI: main.py (/check …) · live.py (WS) · agent.py (ADK) · services.py (Google calls) · storage.py · guard.py
backend/eval/   synthetic evaluation set · backend/tests/ 101 offline tests
frontend/       React + Vite PWA (ja / vi / en)
infra/          setup + deploy scripts, terraform/ · tools/ test calls, post-deploy checks, replay, verdict log viewer, model comparison · docs/ plan, evaluation, related work, deck data
```

## Testing with recorded calls

No real victims or police recordings are used. `tools/test_calls.json` holds six scripted calls (Japanese and
Vietnamese, scam and benign); `pwsh tools/make_test_audio.ps1` turns them into WAV files with the voices installed
on a Windows machine (offline). Then either:

- `python tools/check_audio.py https://<service-url>` - uploads each file to `/check` and compares the level;
- Live Guard → **Test tools** - plays a file through the same on-device recognizer as the microphone
  (Chrome 139+), or lets you type what the caller says line by line;
- or simply play a file on another device next to the microphone - that is the real product setup.

## License

Copyright 2026 Tin Nguyen and Team YM. Licensed under the [Apache License, Version 2.0](LICENSE); see also
[NOTICE](NOTICE). The police-published recordings used for private evaluation are not in this repository and are not
covered by this license.
