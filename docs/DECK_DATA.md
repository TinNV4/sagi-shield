# Deck data pack

Everything a slide may claim, with where the number comes from. Order follows the story: statistics → pain points →
solution → working proof. Slide layout is in `DECK_OUTLINE.md`; this file is the evidence behind it.
Status tags: **[OK]** sourced or reproducible today · **[CHECK]** re-verify before export · **[DO NOT USE]**.

## 1. Statistics (the size of the problem)

Source for every row: National Police Agency, 特殊詐欺 2025 final figures (published 2026-05-22)
https://www.npa.go.jp/bureau/criminal/souni/tokusyusagi/hurikomesagi_toukei2025.pdf

| Claim | Value | Status |
|---|---|---|
| Cases in 2025 | 27,832 (+32.3% YoY) | [OK] re-verified 2026-09-19 |
| Losses in 2025 | ¥142.3 billion (+98% YoY) | [OK] |
| Loss per day | ¥390 million (142.3B / 365) | [OK] derived |
| Fake-police scams alone | 11,014 cases, ¥100.5B = 71% of all losses | [OK]; the 71% is derived |
| Share of calls from international numbers | ~75.5% | [CHECK] not found again in the PDF - find it or drop it |
| "Most victims are over 65" | - | [DO NOT USE] the PDF says case count peaks in the 20s-30s, *loss amount* peaks in the 60s-70s. Say: "the largest losses fall on people in their 60s and 70s" after checking the age table |
| 2026 year-to-date | NPA monthly provisional figures (令和8年 暫定値) | [CHECK] add the latest month for freshness |
| Vietnam | same fake-police script (fake công an, Zalo, fake VNeID app) | [CHECK] needs one official source (Bộ Công an / Cục An toàn thông tin) before it goes on a slide |

## 2. Pain points (why today's defences miss it)

1. **The scam is a conversation, not a number.** Call blockers work on numbers; scammers rotate, spoof and call from
   overseas. Nothing listens to *what is being said*.
2. **Help arrives after the persuasion.** Bank warnings appear at the ATM, hours into the call, when the victim has
   already been told "tell no one".
3. **The victim is alone.** Isolation is a step of the playbook (「誰にも言わないでください」). Family learns about it afterwards.
4. **The channel switch defeats single-channel tools.** Phone call → LINE → image of a fake warrant → transfer: each
   tool sees one fragment.
5. **Two-call scams look innocent call by call.** "It's me, my number changed" asks for nothing; the money request
   comes days later. (Seen in the real police recordings: the first calls of a 7-call case score LOW on their own.)
6. **After the loss, the first hour decides** whether the transfer can be frozen - and the victim does not know whom to
   call in which order.

## 3. Solution (one line per pain point)

| Pain point | Sagi Shield feature | Where in the repo |
|---|---|---|
| 1 | Live Guard follows the scam kill chain (authority → fear → isolation → channel switch → money) in the transcript | `backend/core/risk_engine.py`, `backend/app/live.py` |
| 2 | Full-screen takeover + **spoken** alert during the call; 振込前チェック (three questions before a transfer) | `HighRiskTakeover.tsx`, `/precheck` |
| 3 | Family pairing by QR; guardian gets one sentence, never the transcript; "call Taro on the saved number" button | `FamilyScreen.tsx`, `TrustedContact.tsx` |
| 4 | Quick Check: message, screenshot (Gemini vision reads the fake warrant), link (never fetched), phone number, recording | `/check`, `services.py` |
| 5 | Cross-call memory: a flag on the device for 48 h, no text stored | `LiveTracker.prior_precursor`, `sagi_precursor_until` |
| 6 | ADK recovery agent: server-owned checklist, six tools (state, official-number lookup, family alert, grounded deep check), drafts the police statement, model-boundary masking callback | `backend/app/agent.py` |
| privacy | audio never leaves the device; numbers masked before any model; strict mode = rules first | PLAN 6.9 |

Gen AI surface (judging: 40%): Gemini 3.5 Flash-Lite judge with structured output (~1.3 s) · Gemini 3.8 Flash second
opinion + vision · `gemini-3.5-transcribe` + Chirp 3 for uploads · ADK 2.x agent · DeepSeek-written evaluation data so
the judge never grades its own writing.

## 4. Actual POC (what runs today)

Live URL: https://sagi-shield-api-209791011329.asia-northeast1.run.app (Cloud Run, asia-northeast1; PWA + API, one origin)

**Verified end to end on Cloud Run** [OK]: `/check` for text / screenshot / recording / phone / link · Web Risk ·
Firestore (pairing, alerts, recovery sessions) · recovery agent with all three tools · `/ws/live` · rate limit ·
Secret Manager · BigQuery event stream → Looker Studio · PWA at 360 px, light/dark, ja / vi / en · 96 backend tests.

**Measured** (all reproducible from `docs/EVAL.md`):

| Evidence | Number | Status |
|---|---|---|
| Held-out synthetic set (117 calls, written by a different model family), any warning | rules only 64.7% recall / 49.0% false alarms → rules + Gemini **100% / 4.1%** | [OK] |
| Same set, alarm level | rules only 29.4% → rules + Gemini **91.2%**, 0% false alarms | [OK] 2026-10-03: quote the run-once table everywhere. A later re-run after the second-opinion step measured 97.1%, but the final set is not re-run for headline numbers |
| Real police recordings, uploaded file (36 recordings, 15 scam cases) | **15 / 15 cases warned, 14 / 15 alarmed** | [OK] private data - numbers only, never the audio |
| Real police recordings, live path (34 recordings, 14 cases) | **14 / 14 cases warned, 13 / 14 alarmed** with the pinned opening + call state (A/B vs bare window 13 / 12; 7 recordings up, 0 down; 11 alarms earlier); set-up call remembered → money call alarms at sentence 5 of 33 (one-call replay) | [OK] 2026-09-22, `docs/EVAL.md`; hard negatives not yet replayed through the live path |
| Real non-scam speech (93 min, LibriVox) | **0 / 14** above LOW | [OK] audiobooks, not phone calls - say so |
| 79 hard-negative legitimate calls (bank fraud desk, real refund, son borrowing money) | alarms 13.9% → **6.3%** after the two-model review | [OK] development number |
| After speech recognition (40 calls, TTS → STT → judge) | transcripts 97% similar, recall unchanged | [OK] upper bound: synthetic voices |
| Latency | text check ~1.3 s judge, `/check` 5-15 s end to end, agent turn ~22 s | [OK] |
| Cost per protected call | **about ¥3 per 10-minute scam call**, under ¥1 per ordinary 3-minute call, about ¥16 per hour of listening | [OK] measured 2026-09-22: one judge call = 1,257 input + ~80 output tokens (12-line window + system prompt, `usage_metadata`); periodic gate = one call per 20 s; Gemini API list price Flash-Lite $0.30 in / $2.50 out per 1M, 3.8 Flash $0.75 / $3.75 (through 2026-12-31, doubles from 2027-01-01); ¥150/$ assumed; model cost only. Quick Check text ≈ ¥0.1, screenshot ≈ ¥0.4, 3-min recording ≈ ¥1.4 (transcribe $0.003/min). Re-check the price page before export |

**Screens to capture for the deck** (all from the live URL, no police audio, no real phone numbers):
home · Quick Check result HIGH for a fake-warrant screenshot · Live Guard meter climbing → red takeover · guardian
alert · recovery agent with a ticked checklist · Looker Studio dashboard (label the map "simulated data").

## 5. Honest limits (appendix slide - judges ask)

- Never run with a real microphone yet: on-device STT packs for ja-JP / vi-VN in Chrome, and FCM push.
  Field-test protocol, scripts, observer sheet and report tool: `docs/REAL_CALL_TEST.md` (written 2026-10-18,
  not run yet). The Claude desktop browser pane reports on-device recognition `unavailable` for every language,
  so the run needs a real Chrome (Android or desktop).
- No corpus of real *benign phone calls*; false-alarm numbers come from audiobooks and synthetic hard negatives.
- One real refund-scam recording stays below the alarm in the live path; late alarms on some long calls.
- Evaluation data is synthetic except the police recordings; Vietnamese has no real recordings at all.
- Deepfake video calls are not analyzed (warning notice + call-back flow only).

## 6. Not yet done for submission

- [ ] Team of 2-4 registered (solo entries are not accepted) - deadline to re-check on aibuildercup.com (10-04 vs 10-11)
- [ ] Public GitHub repository (no remote configured yet)
- [ ] Demo video ≤ 3 min (`VIDEO_SCRIPT.md`) · deck PDF (`DECK_OUTLINE.md` + this file)
- [ ] Live Guard tried with a real microphone in Chrome - run `docs/REAL_CALL_TEST.md`, then quote its counts
- [ ] `min-instances=1` and budget alert on demo day
