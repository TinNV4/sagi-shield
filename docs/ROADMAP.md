# Sagi Shield - from contest entry to a product people use

Written 2026-10-24, after the AI Builder Cup submission (deadline 2026-10-18; finalists announced 2026-11-07). This document is the roadmap: what has to be true for real families to use Sagi Shield, in what order, and why. `docs/PLAN.md` stays the record of the contest build and of the decided technical approach; nothing here overrides a decision there unless it says so.

Status markers: **[decided]** = settled with the project owner on 2026-10-24; **[my call]** = chosen by the author of this document, the owner can overrule; **[open]** = still to decide.

## 1. Intent

Sagi Shield exists so that an elderly person who picks up a scam call, or opens a scam message, gets a plain warning before money moves, and so that their family hears about it at once. The contest build proved the pieces work on synthetic and police-published recordings. The next step is not more features: it is making the existing pieces survive a month in a real household, with a real family installing it and a real grandparent never touching it.

**Who it is for [decided]:** elderly people and their families, in Japan and Vietnam in parallel. The family member (child, grandchild) is the one who installs, pairs and watches; the elderly person is the protected one and should have to do as little as possible. The first users are the owner's own relatives and acquaintances.

**Long-term centre of gravity [decided]:** Live Guard, the always-on listener, ends up as a device attached to the landline. Today it is a browser tab on a spare tablet, and it is the least verified part of the product. The roadmap therefore leads with what already works, and treats Live Guard as a controlled experiment until it has earned trust.

## 2. What works today and what does not

Verified on Cloud Run (project `sagi-shield-560661`, `asia-northeast1`; details and dates in CLAUDE.md):

- Quick Check in all four shapes: text, up to five screenshots, link (URL shape + Web Risk + JPCERT/CC phishing list), phone number (overseas prefix + community reports). No microphone needed, works on any phone.
- Before You Pay (pre-transfer questions) and the recovery agent (ADK, checklist, official numbers, guardian notification, deep check).
- Family pairing (6-digit code + QR), guardian dashboard (5 s poll), FCM web push for HIGH alerts, trusted-contact one-tap call.
- Evaluation: final synthetic set MEDIUM 100% recall / 4.1% FPR, HIGH 91.2% / 0%; 36 real police recordings 28 warned, 25 alarmed; 93 min of real benign speech 0 false alarms.
- CI on every push, auto-deploy to Cloud Run after green CI, smoke test, one-command rollback.

Never exercised with a real person:

- **On-device speech recognition in a real Chrome** for ja-JP and vi-VN. Everything about Live Guard's privacy claim ("audio never leaves the device") depends on the browser offering an on-device pack. The desktop app's browser pane reports it unavailable, so the answer is unknown. This is the single largest product risk and is checked in the first week (section 4, step 0).
- The Live Guard screen with a microphone, a living room, a TV, and a landline on speaker.
- Any login. `family_id` is a bearer secret returned to the device and sent as a query parameter; whoever has it can read a family's alerts. Acceptable for a demo, not for relatives.

## 3. Goals, non-goals, anti-goals

**Goals for the first three months**

1. Ten or more households (mixed ja / vi) have Sagi Shield installed by a family member and used it for at least four weeks.
2. Every verdict a pilot user sees can be traced back by the admin (why HIGH, which rule, which model reason) within a minute, without reading raw text.
3. Live Guard has run beside a real landline for at least 20 real calls, and we know its false-alarm rate per call and whether on-device STT exists for ja / vi.
4. Nothing in the system identifies a person: no raw audio, no stored transcripts, numbers hashed, accounts hold only what pairing needs.

**Non-goals (not in these three months)**

- Charging money, pricing, app store revenue.
- A native Android or iOS app that listens to cellular calls (see section 7 for why).
- English, Chinese or other market packs.
- Public launch, marketing, press.

**Anti-goals (what would make it a failure even if it "works")**

- The grandparent switches the tablet off because it shouted at a TV drama or at a call from the grandchild. One such event per household per month is the limit; above that, Live Guard is turned off by us, not by them.
- A relative has to type an email address and password on the grandparent's device. The protected device never logs in **[decided]**.
- A verdict is shown that nobody can explain afterwards.
- A fabricated "safe" when a backend call failed (the UI already refuses this; keep it that way).

## 4. Phase 0 - pilot-ready (target: three weeks, by 2026-11-14)

Order matters. Step 0 runs in the first days because its answer changes how Live Guard is pitched to every pilot family.

### Step 0 - on-device STT reality check (days 1-3)

Devices on hand (2026-10-24): a Windows PC, an iPhone, and an Amazon Fire HD 10 (the child's tablet). No stock Android device yet; buying one is not a precondition.

Run in this order, each one answering a different question:

1. **Android emulator** (Android Studio image with Google Play, Chrome 139 or later) on the PC: does `SpeechRecognition.available()` with `processLocally` report a pack for ja-JP and vi-VN at all, and does the existing `OnDeviceSpeechSetupModal` flow behave? Free, same day. An emulator may lack packs a real device has, so a "no" here is not final.
2. **Fire HD 10**: install Google Play (the four well-known APKs) and Chrome, update Chrome, open the deployed PWA, repeat the check, then read a scripted call from `tools/test_calls.json` aloud across the room with the TV on, following `docs/REAL_CALL_TEST.md`. This is the real test of the pack and of far-field speech; if it passes, the Fire is also the pilot kiosk device (cheap, loud speaker, sits on a charger beside the landline). Nothing of the child's is removed; Play and Chrome can be uninstalled afterwards.
3. **iPhone**: Safari recognises speech only through Apple's servers, so it cannot test the on-device claim. Use it for Quick Check, the guardian dashboard as a home-screen PWA, push, and the labelled opt-in cloud recogniser branch of Live Guard.

Outcome A, a pack exists on the Fire and transcripts are usable: Live Guard goes to pilot families as "experiment, tablet beside the landline", starting with this Fire.
Outcome B, no pack or unusable on the Fire: borrow a stock Android phone from a relative for one afternoon before concluding; if still no, Live Guard is offered only with the explicit opt-in cloud recogniser the UI already labels, the pilot leads with Quick Check alone, and phase 1 opens with the STT question. A stock Android device is then the first purchase of phase 1, not a phase 0 blocker.

Either way the result is written into CLAUDE.md and PLAN section 14, replacing "never executed".

### Step 0b - pilot environment (done 2026-10-24)

The submission is being scored from 2026-10-19 to 2026-11-07 and the judged URL auto-deploys from `main`, so `main` is frozen and every phase 0 change ships to a second Cloud Run service, `sagi-shield-pilot`, from the `pilot` branch (`.github/workflows/deploy-pilot.yml`). Own Firestore database `pilot`, no analytics stream, `PILOT` badge; setup by `infra/setup_pilot.ps1`. The three pilot households of the exit criteria run on the pilot URL. Plan: `docs/superpowers/plans/2026-10-24-pilot-environment.md`.

### Step 1 - accounts and roles (done 2026-10-24)

**Model [decided in shape, details my call]**

- `household`: replaces the current `family`. Holds a display name, the protected person's first name, the member devices, the guardians, the alerts, the trusted contact (moves from localStorage to the household, optional), market (`ja` / `vi`).
- `member device`: the protected person's phone or tablet. Identified by a random device id generated on first open and bound to one household through the existing 6-digit pair code. No account, no email, no password **[decided]**. The device id is exchanged for a short-lived signed device token on each session start; the token, not `family_id`, authorises `/family/*` calls and the Live Guard socket.
- Pairing works in both directions **[my call]**: the member device creates the household and shows the code (today's flow, kept), or the guardian creates it on their phone and shows the QR to the device. A household may have zero member devices: a grandparent with only their own smartphone, or none, is a Quick Check household whose guardian checks messages on their behalf.
- `guardian`: signs in with Firebase Authentication, Google sign-in or phone number **[my call: Google stack, no password handling of our own]**. One guardian can watch several households (a child with two parents in different houses). A guardian is added to a household by scanning the household's QR, as today; the first guardian becomes the household owner and can remove others.
- `admin`: a Firebase custom claim set by hand (`gcloud` / a small script in `tools/`), granted to the project owner only. Admin can read verdict-log summaries, community reports and household counts, and toggle feature flags; admin never sees transcripts or alert text of a household they are not a guardian of.

**Enforcement**

- FastAPI verifies the Firebase ID token with `firebase-admin` (already a dependency) on every `/family/*` route and the socket handshake; the role comes from the token claims plus a Firestore lookup of household membership. The existing App Check header stays as a second, independent signal.
- The device token covers every place `family_id` is a credential today: `/family/alerts`, `/family/push`, `/family/notify` (from the result screen), the Live Guard socket, and the recovery agent's `notify_guardian` tool (the app passes the token, the agent never sees it). `/report` stays anonymous behind App Check. `family_id` disappears from URLs, query strings and localStorage. Migration: the old flow stays alive for two weeks behind a flag so current demo devices keep working, then is removed **[my call]**.
- Owner recovery: if the only owner loses access, the admin has a "reassign owner" action, used only after confirming by phone with the family **[my call]**.
- Household deletion: a guardian who owns the household can delete it; this removes alerts, tokens and the pairing. Needed before any relative is asked to install (Japan's APPI and Vietnam's Decree 13 both expect a deletion path).

**Why now:** the pilot cannot start without it. Today anybody who shoulder-surfs a `family_id` can read a family's alerts, and there is no way to remove a guardian or wipe a household.

### Step 2 - the guardian sets up the grandparent (done 2026-10-25)

The guardian's phone becomes the control panel; the grandparent's device shows one screen.

- "Protect a parent" flow on the guardian side: create household, choose market, print or show the QR, step-by-step instructions for the grandparent's device (open URL, add to home screen on iOS, allow microphone once, leave it on the charger). Instructions in ja / vi / en, with photos of the actual screens.
- The grandparent's device, once paired, opens straight into a single large screen: Live Guard status (or Quick Check if Live Guard is not enabled for this household), a "Call <guardian>" button and nothing else. The bottom bar and settings are reachable only through a long-press or from the guardian's phone **[my call]**.
- Web Share Target in the PWA manifest so a screenshot or a text can be shared from LINE, Zalo, Messages or Photos directly into Quick Check. This is the single largest usability gain for the guardian persona and costs an afternoon.
- Everything in this step that only makes sense with Live Guard (heartbeat, kiosk single screen) is built behind a per-household `live_guard_enabled` flag from the start, so a step 0 outcome B costs nothing and a Quick Check-only household never sees it **[my call]**.
- Device heartbeat: the member device pings every few minutes while Live Guard is on; the guardian dashboard shows "listening since 09:12" or "offline since Tuesday", and a push after 24 h offline **[my call]**. Without this a tablet that died on Monday is discovered when a scam call lands on Friday.

### Step 3 - see what the system does

- Verdict log to BigQuery through a Cloud Logging sink (records already exist as `jsonPayload`; the sink and a view are infrastructure only).
- Admin page in the PWA (admin claim required): aggregates only (verdicts per day by level and market, rule hits versus model reasons, Live Guard looks per call, community reports, households count, latency), read through a small `/admin/*` API, never raw text. Per-household drill-down exists only for households the signed-in user is also a guardian of, through the guardian routes, not the admin ones **[my call]**.
- "Was this right?" on every result screen and on the guardian alert card: thumbs up / down plus an optional reason chip. Stored with the verdict id, no text. This is the only labelled real-world data we will ever get and it feeds the eval sets.
- Cloud Monitoring uptime check on `/health`, alert policy on 5xx rate and on Cloud Run instance count, both to the owner's phone. Error Reporting on the backend.

### Step 4 - pilot kit and consent

- One page for the family, in ja and vi: what the app does, what leaves the device (masked text, no audio), what is stored (alerts for 90 days, no transcripts), how to delete, who to call. Written as the privacy notice the app links to.
- Caller consent, Japan and Vietnam: a party to a call may analyse or record it; Live Guard on speaker is the protected person's own analysis of their own call. Phase 1 adds a short spoken notice option (section 5) so the design also fits the device route later. **[open: a lawyer reads the notice before any non-relative household joins]**.
- Weekly check-in script for the owner: number of checks, number of alarms, any complaint, any call the app missed. `tools/real_call_report.py` summarises the verdict log per household id.
- Household retention: alerts auto-expire after 90 days (Firestore TTL). The anonymous analytics stream (`app/analytics.py`) stays without any household identifier. The verdict log, which the admin page and the weekly check-in read, carries a stable household id **during the pilot only**, because the pilot families consented to per-household review and a daily-rotating hash cannot follow a household across days; the field is removed, and rows older than the pilot deleted, before phase 2 **[my call]**.

### Phase 0 exit criteria

- Three households (two ja, one vi, all relatives) installed by a guardian without the owner touching the grandparent's device, on the pilot URL.
  - The three households are set up through "Protect a parent" and the printed setup card (step 2), not by hand.
- Step 0 answer recorded.
- Admin page shows the three households' verdicts within a minute of them happening.
- `python -m pytest`, `npm test`, CI and auto-deploy green; no `family_id` in any URL.
- 2026-11-14: delete `/family/*`, `getFamilyId`, `LEGACY_FAMILY` (one commit).

## 5. Phase 1 - Live Guard earns trust (months 2-3)

Only if step 0 produced outcome A, or the opt-in cloud recogniser is accepted by the pilot families.

- **Field test protocol as written in `docs/REAL_CALL_TEST.md`:** tablet beside a landline, TV on, three scripted calls per language plus every real call the household takes for four weeks. Target: zero alarms on legitimate calls per household per month; HIGH on the scripted money call before its last third.
- **Kiosk hardening:** screen wake lock survives, recogniser restarts after the 10-minute limit and after the browser kills the tab, auto-reopen after a tablet reboot (document the Android "pinned app" setting; no third-party kiosk software).
- **Cross-call memory moves to the household [my call]:** the 48-hour precursor flag lives today in the device's localStorage. Store it on the household so a set-up call on the landline arms the member's phone too, and so the guardian sees "a suspicious set-up call was taken on Tuesday".
- **Guardian confirmation loop:** on HIGH the guardian gets the push and two buttons: "I called them, false alarm" / "it was a scam". Feeds the feedback table; a false alarm on a household lowers nothing automatically but is reviewed weekly.
- **Spoken notice option:** a household setting that makes the tablet say, once per call, "this call is being checked for fraud" in the household's language. Deters scammers (the municipal devices in Japan do exactly this) and settles consent for the device route later. Off by default in the pilot so the baseline is measured first.
- **Benign real calls:** the one measurement never done. Ask pilot guardians to let us count (not read) the household's legitimate calls through Live Guard; the per-call false-alarm rate on real legitimate calls is the headline number of phase 1.
- **On-device judge experiment [my call, time-boxed to one week]:** Gemma 4 scored 33/34 in the comparison set. Try Chrome's built-in model API or a WebGPU Gemma for the first-look judge so strict-privacy mode (`gate=rules`) consults a model without any text leaving the device. Keep Gemini as the second opinion. Drop it if the tablet cannot run it in under two seconds.

Exit: ten households, four weeks, false-alarm rate known, STT pack status known for both languages, decision whether Live Guard becomes default-on for new households.

## 6. Phase 2 - reach (months 3-6)

- **Play Store listing through a Trusted Web Activity** of the same PWA: no code change, Google tooling (Bubblewrap), and "install from Play" is what relatives in both countries understand. iOS stays PWA-on-home-screen until there is a reason to do more.
- **Messaging channels for Quick Check:** a LINE official account (Japan) and a Zalo OA (Vietnam) that accept a forwarded message or screenshot and answer with the verdict card. Not Google-native, but it is where the messages that need checking already are. Thin adapters over `/check`; the PWA stays the product.
- **Pre-transfer check as an embeddable API** for a bank or a municipality: `/precheck` with an API key, rate limits per key, a one-page integration guide. This is the BFSI story from the deck; one pilot partner would be enough.
- **Legal and policy pack:** privacy policy and terms (ja / vi / en), APPI and Decree 13 review, data residency statement (Gemini is served from `global`, Cloud Run and Firestore from Tokyo), a security page describing masking and retention. A real lawyer reads it before the Play listing.
- **Operations:** on-call is one person, so keep it boring: budget alert, error budget on `/check` latency, monthly phishing-list reload already automated, quarterly eval re-run on a fresh seed (never the final set).

## 7. Phase 3 - the device (6-18 months, direction only)

Live Guard becomes the centre only when it hears the call without a speakerphone. The paths, assessed honestly:

- **Smartphone native app that taps the call audio:** not available. Android removed call-recording access for third-party apps (Accessibility-based recording was banned from Play in 2022); iOS never allowed it. `CallScreeningService` gives caller id and block decisions, not audio. The only legal route on mobile is a carrier or handset-maker partnership; worth a conversation with one JP and one VN carrier in phase 2, not worth engineering before that.
- **Landline-attached box:** the realistic route for Japan, where the victims are on 固定電話 and dozens of municipalities subsidise 迷惑電話防止機器 (devices that announce "this call is recorded" and warn). Two options: partner with an existing vendor and run Sagi Shield as the brain behind their device, or build a small Android-based box with a line adapter. Partnering first; hardware is a second company.
- **Legal shape:** the device announces at pickup that the call is being checked, which both deters and gives notice. The on-device STT plus masked text design is already what such a device needs; nothing in the backend changes.
- **Vietnam:** scam calls reach mobiles and Zalo, not landlines, so Vietnam's long-term centre is the messaging channel and the carrier route, not the box.

This phase is not planned further here. It becomes its own design document when phase 1 shows Live Guard is worth it.

## 8. Decisions, summarised

| Decision | Who | Note |
|---|---|---|
| Pilot leads with Quick Check + family alerts; Live Guard is a controlled experiment | owner | 2026-10-24 |
| Long term, Live Guard is the centre; ends as a landline device | owner | section 7 |
| Both markets, pilot with relatives first | owner | |
| Protected person's device never logs in; pairing by code / QR stays | owner | |
| Three roles: member device, guardian, admin | owner (roles) / author (shape) | section 4 step 1 |
| Firebase Authentication (Google, phone) for guardians; custom claim for admin | author | Google stack, no own password handling |
| Household replaces family; device token replaces `family_id` secret | author | |
| Web Share Target, device heartbeat, feedback buttons in phase 0 | author | cheap, high value |
| Cost is not a constraint for the pilot | owner | revisit before phase 2 |
| No native call-audio app; device route via partnership first | author | platform facts, section 7 |

## 9. Left to the builder

- Firestore layout for households, devices, guardians and feedback, and the migration from `families`.
- Token format and lifetime for member devices; whether to use Firebase anonymous auth for the device or a custom JWT signed by the backend (either is fine; anonymous auth keeps one verifier).
- Exact admin page layout and which BigQuery views back it.
- Share Target handling of multiple images and of text with URLs.
- How the single-screen member UI coexists with the existing screens (route guard by role is enough).
- Test strategy: the existing pytest suite stubs services and runs with `USE_LLM=0`; auth gets the same treatment with a fake token verifier.

## 10. Open questions

0. Do the first pilot households have a spare tablet or old phone for the grandparent, or only the grandparent's own smartphone? (Decides which households start as Live Guard versus Quick Check only; devices for step 0 itself are settled above.)
1. Does a lawyer review the pilot notice before non-relative households join, and who pays for that review? (Blocks phase 0 step 4 only for non-relatives.)
2. For guardians who refuse Google sign-in, is phone-number sign-in enough, or is email magic link needed? (Phase 0 step 1, small.)
3. Which carrier conversations, if any, are worth starting in phase 2? (Phase 3 direction only.)
