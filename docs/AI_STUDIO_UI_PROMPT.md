# Prompt for Google AI Studio (Build mode)

> Matches `docs/PLAN.md` **v3** (kiosk mode, spoken alert, 振込前チェック, recovery agent, Guardian view).

How to use:
1. Open AI Studio → **Build** → paste **Prompt 1** below.
2. Iterate with the follow-up prompts (section "Follow-ups"), one at a time.
3. Export / download the code into `frontend/`. Copy `frontend/lib/audioCapture.js` into `src/lib/` if the generated one differs.

---

## Prompt 1 — full app

```
Build "Sagi Shield (サギシールド)" — an installable PWA that protects people from phone scams
(Japanese オレオレ詐欺 / ニセ警察詐欺 and Vietnamese fake-police scams).

TECH
- React + TypeScript + Vite + Tailwind. Mobile-first, works on phone and tablet (portrait + landscape).
- PWA: manifest (name "Sagi Shield", short_name "SagiShield", theme #1B4D3E), service worker, installable, offline shell.
- NO direct Gemini calls from the browser. All AI goes through my backend.
- FRONTEND ONLY: do NOT generate a Node.js/Express server runtime, do NOT add a Gemini API key or any
  server-side secret. This is a static SPA that talks to my existing Python backend on Cloud Run.
- Create src/api/client.ts with an interface SagiApi and TWO implementations:
  - RealApi: uses import.meta.env.VITE_API_BASE (REST + WebSocket).
  - MockApi: returns realistic fake results with 1–2 s delay; simulates live risk rising over 20 s,
    then a session_reset event 10 s after the user taps "I am safe now".
  - Use MockApi when VITE_API_BASE is empty. Show a small "DEMO MODE" badge when mock is active.
- i18n: Japanese (default), Vietnamese, English. All strings in src/i18n/{ja,vi,en}.json. Language switch in header.

API CONTRACT (types in src/api/types.ts)
- type CheckResult =
    { risk_score: number(0-100), risk_level: "LOW"|"MEDIUM"|"HIGH", stage: 0-5,
      scam_type: "fake_police"|"family_impersonation"|"fake_billing"|"refund"|"investment"|"safe"|"unknown",
      reasons: string[], advice: string, hotlines: string[], evidence_flags: string[],
      rule_hits: Record<string,string[]>, community_hits: number }
- POST /check  (multipart: text?, image?, audio?, phone?, url?, lang) -> CheckResult
- POST /precheck { reason_text, amount?, recipient_type?: "person"|"company"|"government"|"unknown",
                   who_asked?: "police"|"bank"|"family"|"company"|"stranger"|"nobody", lang } -> CheckResult
- WS /ws/live?lang=xx&mode=kiosk|manual&input=text : PRIVACY RULE - audio never leaves the device.
  The client runs speech recognition ON-DEVICE and sends JSON text only:
    { type: "transcript", text, final: true }   // one per finalized line; do not send interim results
    { type: "reset" }                            // when the user taps "I am safe now"
  server sends JSON, one of:
    { risk_score, risk_level, stage, trigger_phrase, transcript_tail, advice, speak?: string, session_id }
    { event: "session_reset" }   // call ended (silence timeout) -> reset meter, stages and latch
- POST /agent/recovery { session_id, message, lang }
    -> { reply: string, checklist: { step: string, done: boolean }[], draft_statement?: string }
- POST /report { scam_type, phone?, keywords[], prefecture?, consent: true } -> { ok }
- POST /family/link { pair_code, fcm_token? } -> { ok, guardian_name }
- GET /family/alerts -> [{ id, created_at, member_name, risk_level, scam_type, stage, summary, phone_tel? }]
- GET /stats -> { total_checks, high_risk, by_type: {type:count}, by_region: {region:count}, trend: [{date, count}] }

SCREENS
1. Home: three huge buttons —
   "通話を見守る / Live Guard", "今すぐチェック / Quick Check", "振り込む前に / Before you pay".
   Below them a quieter but always-visible button: "もう払ってしまった / I already paid" (-> Recovery).
   Small links to Family, Community, How it works, Settings. A one-line tip that rotates
   (e.g. 「警察がLINEで連絡することはありません」).

2. Live Guard — two modes, chosen in Settings (default: manual; kiosk once enabled persists):
   MANUAL
   - Instruction card: "Put your phone call on speaker and place this device next to it."
   - Big Start/Stop button. Mic permission handling with friendly error text.
   KIOSK (always-on, for an elderly person's tablet next to a landline; family sets it up once)
   - Opening the app goes straight to this view and starts listening automatically — no button press needed.
     (First time only: one big "見守りを始める / Start protection" tap, which grants mic permission,
     unlocks speech synthesis, and requests the Screen Wake Lock.)
   - Hold navigator.wakeLock ("screen"); re-acquire on visibilitychange. Auto-reconnect the WebSocket
     with backoff; auto-restart capture on error. Never show a technical error to the user — show
     "見守り中です" with a small grey status dot (green = connected, grey = reconnecting).
   - Idle state: very calm, large clock, "見守り中 / Protecting" label, a gentle "listening" indicator
     that is ALWAYS visible while the mic is open, and a one-tap "一時停止 / Pause (30 min)" button.
     Dim the screen colors after 1 min idle (burn-in friendly), wake on speech.
   - Exit kiosk only via Settings with a long-press (3 s) — so it is not closed by accident.
   BOTH MODES
   - Show the state: "listening (on this device)" vs "text being checked".
   - Circular risk meter (0-100) with color + icon + word (safe/caution/danger), updates live.
   - Kill-chain progress bar with 5 steps: Authority → Threat → Secrecy → Move to app → Money.
     Reached steps light up. Steps never go backwards until a session_reset event.
   - Last transcript line (small, grey).
   - On { event: "session_reset" }: meter, steps and transcript clear back to idle.
   - When risk_level becomes HIGH: full-screen red takeover with vibration (navigator.vibrate),
     giant text 「電話を切ってください」 / "Cúp máy ngay", advice, and big call buttons for hotlines
     (tel: links). It stays until the user taps "I am safe now".
   - SPOKEN ALERT: on HIGH, read the server's `speak` text aloud (fallback: the localized
     "この通話は詐欺の可能性があります。電話を切ってください。") using window.speechSynthesis at
     max volume, rate 0.9, voice matching the UI language; repeat every 8 s until dismissed, max 5 times.
     Put this in src/lib/speak.ts with warmUp() (called on the first user gesture — browsers block
     TTS before one), speak(text, lang), stop(). Settings toggle "声で警告する / Spoken warning" (default ON).
   - Speech recognition module at src/lib/liveGuard.ts:
     startLiveGuard(wsUrl, lang, { onRisk, onReset, onStatus }) -> { stop(), pause(ms), reset() }
     Uses the Web Speech API in ON-DEVICE mode: check SpeechRecognition.available({ langs, processLocally: true }),
     call SpeechRecognition.install(...) when the pack is "downloadable", set recognition.processLocally = true,
     continuous = true, interimResults = false, restart in onend while running, auto-reconnect the WebSocket.
     If on-device recognition is unavailable, do NOT silently use cloud recognition: show a clear notice
     ("This device cannot transcribe locally") and an explicit opt-in switch.
     Show a permanent privacy line on this screen: "Audio never leaves this device. Only text is checked."

3. Quick Check: tabs or segmented control — Text | Screenshot | Recording | Phone number | Link.
   Paste box, image picker (camera or gallery, preview), audio file picker, phone and URL inputs.
   One "Check" button. Loading state with calm message.

4. Before you pay (振込前チェック): a 3-question wizard, one question per screen, huge tap targets:
   a. "Who asked you to pay?" — Police / Bank / Family / Company / Someone I don't know / Nobody
   b. "Why are you paying?" — free text with 4 example chips (e.g. 「口座を守るため」「未払い料金」
      「家族が困っている」「投資」), optional amount.
   c. "Who receives the money?" — Person / Company / Government office / I don't know
   -> POST /precheck -> Result screen. If HIGH the verdict word is "STOP / 振り込まないで".
   Footer note: "Banks can embed this check" is NOT shown to users (deck only).

5. Result: big verdict card (color + icon + word), score, scam type label, stage bar,
   max 2 reasons as short sentences, advice, hotline buttons, evidence chips
   (e.g. "International number", "Fake-looking link"). Buttons: "Report to community" (consent
   checkbox), "Notify my family", and — for MEDIUM/HIGH — "もう払ってしまった / I already paid".
   Never say "100% safe"; for LOW show
   "No clear danger found. If unsure, call the official number yourself."

6. Recovery (「もう払ってしまった」): a calm chat with the recovery agent (POST /agent/recovery).
   - Opens with a reassuring line ("大丈夫です。今からできることを一緒に進めましょう。") and the
     first step; never blame the user.
   - Pinned checklist card above the chat, driven by `checklist` from the server (e.g. call the bank
     to freeze the account, call #9110, keep evidence, tell family). Each step has a big action
     button where possible (tel: link) and a "done" checkbox.
   - Quick-reply chips instead of typing where possible (How did you pay? Bank transfer / Cash card
     handed over / Convenience-store e-money / Crypto / Cash by mail).
   - When `draft_statement` arrives: show it in a card with "Copy" and "Share" (navigator.share) —
     labelled "Notes to read to the police".
   - Small disclaimer: procedural guidance, not legal advice.
   - Mock: a 5-turn scripted conversation that ends with a checklist of 4 steps and a draft statement.

7. Family: pair with a guardian via 6-digit code or QR (show QR of a pair URL); list of linked guardians;
   toggle "Alert my family on HIGH risk". Note for iPhone users: "Add this app to the Home Screen to
   receive alerts" (detect iOS + not standalone).

8. Guardian view (for the family member): list of recent alerts from GET /family/alerts, newest first,
   polled every 5 s (behind an interface so I can swap in a Firestore realtime listener). Each card:
   time, member name, risk level (color + icon + word), scam type, kill-chain stage reached,
   1-line summary, and a big "今すぐ電話する / Call now" button (tel:). New HIGH alert -> in-app banner
   + sound + vibration even if push did not arrive. Empty state: "No alerts. All quiet."

9. Community: dashboard from /stats — KPI cards (checks, high-risk), bar chart by scam type,
   line chart trend (use recharts), list by region. Anonymous data note.

10. How it works: 3 illustrated steps + privacy note ("Audio is not stored. While it is quiet,
    nothing leaves this device.").

11. Settings: language, Live Guard mode (manual / kiosk) with a short setup guide for family
    ("plug in the charger, place next to the phone, turn volume to max"), spoken warning toggle +
    "Test the voice" button, guardian alert toggle, dark mode.

DESIGN (elderly-first accessibility)
- Base font 20px, headings 28–40px, buttons min 64px tall, full-width on mobile.
- High contrast (WCAG AA+). Never rely on color alone: color + icon + word.
- Calm, trustworthy palette: deep green #1B4D3E primary, warm off-white background,
  risk colors: green #2E7D32, amber #F9A825, red #C62828. Dark mode support.
- Rounded cards, generous spacing, simple line icons (lucide-react). No clutter, no jargon.
- Japanese typography: "Noto Sans JP", Vietnamese: "Be Vietnam Pro", fallback system-ui.
- Respect prefers-reduced-motion. All buttons have aria-labels. Screen-reader friendly.
- Kiosk view: readable from 2 m away on a 10" tablet in landscape.

QUALITY
- Clean folder structure: src/{pages,components,api,lib,i18n,hooks}.
- No localStorage for sensitive data; only UI prefs (language, mode, toggles) with try/catch.
  Never persist transcripts, chat messages or check results.
- Treat all server strings (transcript_tail, reasons, reply, summary) as plain text — never render as HTML.
- Mock data must cover: fake police JP (HIGH), refund scam (HIGH), bank reminder (LOW),
  TV-drama-like transcript that rises to MEDIUM then resets (no HIGH),
  Vietnamese fake công an + VNeID link (HIGH), precheck "police told me to move savings to a safe
  account" (HIGH) and "paying my nephew's tuition to the university" (LOW).
```

---

## Follow-ups (use one at a time)

1. `Polish the Live Guard HIGH-risk takeover: make it impossible to miss, add a 3-second pulse, keep hotline buttons at the bottom within thumb reach. Make sure the spoken alert stops immediately when "I am safe now" is tapped.`
2. `Harden kiosk mode: survive network loss, tab backgrounding and mic errors without any user action; re-acquire the wake lock; add a hidden debug overlay (triple-tap the clock) showing WS state, VAD state and last server message.`
3. `Make the whole app usable at 200% zoom and on a 1024x768 tablet in landscape (Live Guard as a kiosk-like view).`
4. `Add a first-run onboarding (3 screens) that explains Live Guard needs a second device next to the phone, and offers "Set up for a family member (kiosk)" vs "Use it myself".`
5. `Add a demo helper at /demo (only when DEMO MODE is on): buttons to trigger a mock HIGH live session, a mock guardian alert, and a session_reset — for recording the pitch video.`
6. `Review the app for accessibility issues and fix them.`

## Switching to the real backend

Set `VITE_API_BASE=https://<cloud-run-url>` in `.env` → MockApi turns off automatically.

## After export — manual checks

- `src/lib/audioCapture.ts` vs `frontend/lib/audioCapture.js`: keep one; the VAD gate and `pause()` must survive.
- Types in `src/api/types.ts` must match `docs/PLAN.md` section 9 exactly.
- Spoken alert on a real tablet: iOS Safari and Android Chrome both need the first-tap `warmUp()`; check volume with the landline speaker playing.
