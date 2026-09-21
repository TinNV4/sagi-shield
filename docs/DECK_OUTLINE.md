# Pitch deck outline (export to PDF, English, ~12 slides)

Every number below is either sourced (NPA) or reproducible from this repo (`docs/EVAL.md`). Re-check them on the day
the deck is exported.

1. **Title** - Sagi Shield（サギシールド）: a real-time AI guard against phone scams. Team, theme (BFSI), live URL, repo.
2. **The problem** - Japan 2025 (NPA final figures): 27,832 cases (+32%), ¥142.3B lost (+98%), ¥390M a day; fake-police
   scams alone 11,014 cases / ¥100.5B. The pattern: phone call → move to LINE → fake warrant image → transfer.
   Same playbook in Vietnam (fake công an). Source link on the slide.
3. **Why existing defences miss it** - call blockers work on numbers (scammers rotate them, spoof, call from
   overseas); bank warnings come at the ATM, after hours of persuasion; the victim is alone in a *conversation*.
4. **The idea** - sit next to the landline, follow the *kill chain* of the conversation (authority → fear → isolation →
   channel switch → money), interrupt out loud, bring in the family. One photo of the kiosk tablet.
5. **Demo storyboard** - four frames: green meter → climbing → red takeover + spoken alert → guardian alert.
6. **What Gen AI does here** (Technical merit 40%) - Gemini 3.5 Flash-Lite judges the masked transcript with structured
   output (stage, risk, playbook, reasons in the user's language) in ~1.3 s; Gemini 3.8 Flash gives the second opinion
   before an alarm the rules cannot back, and reads screenshots (fake warrants); `gemini-3.5-transcribe` + Chirp 3 for
   uploaded audio; an ADK 2.x agent with three tools for the first hour after a loss. Rules + LLM fusion: hard combos
   cannot be vetoed, everything else is confidence-weighted.
7. **Evidence** - the ablation table: rules only 64.7% recall / 49.0% false alarms → rules + Gemini 100% / 4.1%
   (alarm level: 29.4% → 97.1%, 0% false alarms), on a held-out set written by a different model family. Real police
   recordings: 15 of 15 scam cases warned, 14 of 15 alarmed. 93 minutes of real non-scam speech: 0 false alarms.
   Live path on real recordings: [fill from docs/EVAL.md].
8. **What real data taught us** (Innovation 25%) - three faults no synthetic test showed: the transcriber looped on
   noisy audio and the judge called garbage "safe"; rules almost never fire on real speech, so the LLM gate starved;
   two-call scams need memory across calls. Each fix is in the repo with a regression test.
9. **Privacy by design** - audio never leaves the device (on-device STT); numbers masked before any model; nothing
   stored from a call; cross-call memory is a flag on the device; HMAC for reported numbers; anonymous analytics
   (whitelisted columns). Strict mode for users who want rules-first.
10. **Architecture** - PWA → Cloud Run (API + static) → Gemini on Agent Platform · Firestore (lookups) · BigQuery →
    Looker Studio (scam map) · Web Risk · Speech-to-Text · Secret Manager. All Google Cloud, one deployable service.
11. **Impact & scale** - cost per protected call ([COMPUTE from the current flash-lite price list: ~180 short calls per hour of talk] - do not quote a number until it is calculated); markets are
    language packs (ja, vi today); channels: family kiosk → municipal senior programmes → **bank-embedded
    振込前チェック API** (the three-question pre-transfer check at the moment of payment).
12. **Roadmap** - deepfake video calls (liveness cues, call-back flow is already in); fully on-device judge (Gemini
    Nano / Gemma) for tier 2 privacy; real benign phone-call data with consent → fine-tuning; carrier / bank pilots.
13. **Team & ask** - who we are, what we need (pilot partner, anonymised call data).

Appendix slides: evaluation method (three sets, judge ≠ writer), limits (synthetic data, no real benign phone calls
yet), security notes (prompt injection handling, rate limit, no URL fetching).
