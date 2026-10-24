# Guardian Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A relative sets Sagi Shield up for a grandparent from their own phone: create the household, hand the grandparent's device a code, decide whether it runs Live Guard, share screenshots from LINE / Zalo into Quick Check, and learn when the tablet has gone quiet.

**Architecture:** The household gains owner-editable settings (`live_guard_enabled`, names), a per-device heartbeat and an hourly sweep job that pushes "offline since" to the guardians. The PWA gains three flows: "Protect a parent" (guardian creates, prints a card), device-side join by code (the same 6-digit code joins either role, the token's role decides), and a Web Share Target handled by the service worker that drops the shared text or images into Quick Check. A device whose household has Live Guard on opens into the existing kiosk mode.

**Tech Stack:** FastAPI, pydantic 2, Firestore, Cloud Run Jobs + Cloud Scheduler (same pattern as `sagi-phish-loader`), React 19 + Vite, vite-plugin-pwa (Workbox `importScripts`), Firebase Messaging, vitest.

**Spec:** `docs/ROADMAP.md` section 4, step 2 ("the guardian sets up the grandparent") and the `[my call]` items there; the household model and roles from `docs/superpowers/plans/2026-10-24-households-and-roles.md` (shipped on branch `pilot`).

## Global Constraints

- All code, comments, docs and commit messages in English; UI strings ja / vi / en with identical keys (`frontend/src/i18n/keys.test.ts`).
- Branch `pilot` only; `main` and `.github/workflows/deploy.yml` stay untouched until 2026-11-07. Every push to `pilot` deploys to the pilot service.
- The protected device never logs in with email or password; it is an anonymous Firebase user. No household id in a query string or fragment; the fragment may carry only the 6-digit code (`/#pair=` today).
- Never store raw audio, transcripts or phone numbers; a heartbeat carries no text; the offline push carries no transcript.
- The Live Guard warning to the person on the phone is never delayed or refused by any of this (heartbeat, household lookups).
- Shared content from the share target is treated like any pasted text or uploaded image: never fetched, never stored server-side beyond the check.
- Google stack only; model IDs stay in `backend/core/model_ids.py`.
- Backend tests offline (`tests/conftest.py`: `USE_LLM=0 STORE=memory AUTH=fake LEGACY_FAMILY=1`); frontend tests with `npx vitest run --pool=threads` on this machine; `npm run lint`, `npm run build` green before each commit. CRLF preserved per file.
- No AI attribution trailer in commits.

## Review Focus

1. A shared image larger than the API's 8 MB limit, or a PDF, arrives through the share target: Quick Check shows the normal size / type error, never a blank screen or a lost share. Test in Task 6 (`shareInbox` rejects by size and type with a reason).
2. The share target is used before the service worker has ever installed (first visit from the share sheet): the POST reaches the API; it must answer a redirect to `/#share` with nothing to show rather than a 404 page. Test in Task 6 (backend `/share-target` route).
3. The tablet loses Wi-Fi for an hour: heartbeats fail silently, Live Guard keeps running on-device rules, and the dashboard shows "offline since" from the last heartbeat; no push before 24 h. Test in Task 2 (sweep threshold) and Task 3 (ping failure is swallowed).
4. A guardian creates a household, prints the card, and the grandparent's device joins two days later: the printed code has expired; the card must say so and the dashboard must offer "new code". Test in Task 4 (card shows the expiry time; `householdCode` refresh path).
5. A guardian turns Live Guard on for a household whose device is a phone, not a tablet: the device opens into kiosk mode and the grandparent cannot find Quick Check. Task 5 keeps the kiosk's existing pause / exit path and the bottom bar reachable through the kiosk unlock in Settings, and the manage sheet labels the toggle "tablet beside the landline".

---

## File map

- Modify `backend/app/households.py`: `PATCH /household/{id}` (owner), `POST /household/{id}/heartbeat` (device), `device_status` in the public shape.
- Modify `backend/app/storage.py`: `update_household(id, fields)`, `record_heartbeat(id, uid, listening)`, `households_for_sweep()`, `mark_offline_notified(id, at)`; `devices_seen` map on the household.
- Create `backend/app/heartbeat_sweep.py` (job entry point, `python -m app.heartbeat_sweep`), modify `backend/app/notifier.py` (`notify_offline`), `infra/setup_heartbeat_job.ps1`, Terraform job + scheduler, `_deploy-service.yml` optional job image update (pilot: `update_heartbeat_job: true`).
- Create `backend/app/share.py`: `POST /share-target` fallback redirect.
- Frontend: `src/lib/heartbeat.ts`, `src/lib/shareInbox.ts`, `public/share-sw.js`, `src/lib/householdState.ts` additions, `src/pages/GuardianViewScreen.tsx` (Protect a parent, settings in the manage sheet, device status), `src/pages/SetupCardScreen.tsx` (printable), `src/pages/FamilyScreen.tsx` (join by code), `src/pages/LiveGuardScreen.tsx` (heartbeat), `src/pages/QuickCheckScreen.tsx` (shared input), `src/App.tsx` (`#join=`, `#share`, kiosk from household), `src/api/client.ts` (+ MockApi), `vite.config.ts` (share_target, importScripts), i18n.
- Docs: `docs/ROADMAP.md` (tick step 2), `CLAUDE.md`, `docs/PLAN.md` section 9.

## Shared definitions

Household document gains:

```
devices_seen        {uid: {"at": ISO-8601 UTC, "listening": bool}}   # one entry per device, last heartbeat
offline_notified_at ISO-8601 UTC | null                               # last "offline" push, reset by a heartbeat
```

Public household shape gains `device_status: {"last_seen": ISO | null, "listening": bool}` = the newest `devices_seen` entry (null when none). `HEARTBEAT_EVERY_S = 180` (client), `OFFLINE_AFTER_S = 24 * 3600` (sweep), `CODE_TTL` stays `PAIR_CODE_TTL_S` = 900.

The one 6-digit code joins either role: the token's role decides (`join_household` already does this). `/#pair=CODE` opens the guardian dashboard with the code (exists); `/#join=CODE` opens the Family screen on the device with the code (new). `/#share` opens Quick Check with the share inbox (new).

---

### Task 1: Household settings and heartbeat routes

**Files:**
- Modify: `backend/app/households.py`, `backend/app/storage.py`
- Test: `backend/tests/test_household.py`, `backend/tests/test_household_store.py`

**Interfaces:**
- Produces: `PATCH /household/{id}` body `{name?, member_name?, live_guard_enabled?}` (owner only; 422 on empty body) → `{household}`; `POST /household/{id}/heartbeat` body `{listening: bool}` (device member only; guardians 403) → `{ok}`; `public()` adds `device_status`.
- Storage (both stores): `update_household(hid, fields: dict) -> dict | None` (whitelist `name`, `member_name`, `live_guard_enabled`; names cut to 40), `record_heartbeat(hid, uid, listening: bool, at: str | None = None) -> bool` (also clears `offline_notified_at`), `device_status(hh) -> dict` helper.

- [ ] **Step 1: Write the failing tests**

```python
def test_owner_updates_settings_and_device_sees_them(client):
    h = client.post("/household", json={"market": "ja"}, headers=H(DEV)).json(); hid = h["household_id"]
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1))
    client.post("/household/join", json={"pair_code": client.post(f"/household/{hid}/code", json={}, headers=H(G1)).json()["pair_code"]}, headers=H(G2))
    assert client.patch(f"/household/{hid}", json={"live_guard_enabled": True}, headers=H(G2)).status_code == 403
    assert client.patch(f"/household/{hid}", json={}, headers=H(G1)).status_code == 422
    r = client.patch(f"/household/{hid}", json={"live_guard_enabled": True, "member_name": "Mom"}, headers=H(G1))
    assert r.status_code == 200 and r.json()["household"]["live_guard_enabled"] is True
    mine = client.get("/household", headers=H(DEV)).json()[0]
    assert mine["live_guard_enabled"] is True and mine["member_name"] == "Mom"

def test_heartbeat_is_device_only_and_shows_on_the_dashboard(client):
    h = client.post("/household", json={"market": "ja"}, headers=H(DEV)).json(); hid = h["household_id"]
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1))
    assert client.get(f"/household/{hid}", headers=H(G1)).json()["device_status"] == {"last_seen": None, "listening": False}
    assert client.post(f"/household/{hid}/heartbeat", json={"listening": True}, headers=H(G1)).status_code == 403
    assert client.post(f"/household/{hid}/heartbeat", json={"listening": True}, headers=H(DEV)).status_code == 200
    status = client.get(f"/household/{hid}", headers=H(G1)).json()["device_status"]
    assert status["listening"] is True and status["last_seen"] is not None
    assert "devices_seen" not in client.get(f"/household/{hid}", headers=H(G1)).json()  # uids never leave the server
```

- [ ] **Step 2: Run** `python -m pytest tests/test_household.py -q` (PowerShell, from backend/) → FAIL 405 / KeyError.
- [ ] **Step 3: Implement** the storage helpers (memory + Firestore mirror, `devices_seen` written with `update` on Firestore), the two routes, `device_status` in `public()`.
- [ ] **Step 4: Run** `python -m pytest tests -q` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Households: owner settings (Live Guard on/off, names) and device heartbeat"`

---

### Task 2: Offline sweep job

**Files:**
- Create: `backend/app/heartbeat_sweep.py`, `infra/setup_heartbeat_job.ps1`
- Modify: `backend/app/storage.py`, `backend/app/notifier.py`, `infra/terraform/main.tf` + `variables.tf`, `.github/workflows/_deploy-service.yml` (new boolean input `update_heartbeat_job`, default false; `deploy-pilot.yml` passes true), `infra/deploy.sh`
- Test: `backend/tests/test_heartbeat_sweep.py`

**Interfaces:**
- Storage: `households_for_sweep() -> list[dict]` (households with `live_guard_enabled` true), `mark_offline_notified(hid, at: str) -> None`.
- `heartbeat_sweep.sweep(now: float | None = None) -> dict` returns `{"checked": n, "notified": m}`; a household is notified when its newest `devices_seen.at` is older than `OFFLINE_AFTER_S`, or when `devices_seen` is empty but `live_guard_enabled` has been true for longer than `OFFLINE_AFTER_S` (use `created_at` as the floor), and `offline_notified_at` is null or older than the newest heartbeat.
- `notifier.notify_offline(household: dict, since_iso: str, lang: str) -> dict | None`: stores an alert with `risk_level="LOW"`, `scam_type="device_offline"`, `stage=0`, summary from `OFFLINE_TEXT = {"ja": "見守り端末から{hours}時間以上応答がありません。電源と Wi-Fi を確認してください。", "vi": "Thiết bị bảo vệ không phản hồi hơn {hours} giờ. Hãy kiểm tra nguồn và Wi-Fi."}`, pushed with the normal urgency (not `high`).
- Job: `python -m app.heartbeat_sweep` prints the counts and exits 0; Cloud Run Job `sagi-heartbeat-sweep` (same image as the service, env `STORE=firestore`, `FIRESTORE_DB`, `GOOGLE_CLOUD_PROJECT`, `HASH_KEY` secret, FCM via the runtime account), Cloud Scheduler hourly (`0 * * * *`, Asia/Tokyo), set up by `infra/setup_heartbeat_job.ps1 -Service sagi-shield-pilot -Database pilot` (style of `setup_phish_job.ps1`) and mirrored in Terraform behind `pilot_enabled` / for production.

- [ ] **Step 1: Write the failing tests** (memory store, stub `notifier._messaging` like test_household.py)

```python
def test_sweep_notifies_once_after_24h_and_resets_on_heartbeat(store, sent, frozen_now):
    hh = store.create_household("", "Mom", "ja", DEV); hid = hh["household_id"]
    store.join_household(hh["pair_code"], GUARD, "tok")
    store.update_household(hid, {"live_guard_enabled": True})
    store.record_heartbeat(hid, "dev1", True, at=iso(frozen_now - 25 * 3600))
    assert sweep(now=frozen_now) == {"checked": 1, "notified": 1}
    assert store.list_household_alerts(hid)[0]["scam_type"] == "device_offline" and sent[-1] == ["tok"]
    assert sweep(now=frozen_now + 3600) == {"checked": 1, "notified": 0}          # not again
    store.record_heartbeat(hid, "dev1", True, at=iso(frozen_now + 2 * 3600))
    assert sweep(now=frozen_now + 2 * 3600 + 25 * 3600) == {"checked": 1, "notified": 1}  # new outage, new push

def test_sweep_ignores_households_without_live_guard_or_still_fresh(store, frozen_now):
    a = store.create_household("", "", "ja", DEV)
    store.record_heartbeat(a["household_id"], "dev1", True, at=iso(frozen_now - 48 * 3600))   # live guard off
    b = store.create_household("", "", "vi", Principal("dev2", "device"))
    store.update_household(b["household_id"], {"live_guard_enabled": True})
    store.record_heartbeat(b["household_id"], "dev2", True, at=iso(frozen_now - 3600))        # fresh
    assert sweep(now=frozen_now) == {"checked": 1, "notified": 0}
```

- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement** module, storage helpers (Firestore: `where("live_guard_enabled", "==", True)`), notifier, job script, workflow input, deploy.sh and Terraform (`google_cloud_run_v2_job` "sagi-heartbeat-sweep" + scheduler, reuse the `scheduler` service account).
- [ ] **Step 4: Run** `python -m pytest tests -q` → PASS; `terraform fmt -check`, `terraform validate` clean; YAML parses.
- [ ] **Step 5: Commit** `git commit -m "Heartbeat sweep: guardians are told when a Live Guard device has been silent for a day"`

---

### Task 3: Device heartbeat and kiosk from the household

**Files:**
- Create: `frontend/src/lib/heartbeat.ts`, `frontend/src/lib/heartbeat.test.ts`
- Modify: `frontend/src/api/client.ts` (+ MockApi), `frontend/src/pages/LiveGuardScreen.tsx`, `frontend/src/App.tsx`, `frontend/src/lib/householdState.ts`

**Interfaces:**
- `Api.heartbeat(id: string, listening: boolean): Promise<void>`, `Api.updateHousehold(id, fields: {name?: string; member_name?: string; live_guard_enabled?: boolean}): Promise<Household>`.
- `heartbeat.ts`: `startHeartbeat(getListening: () => boolean, send: (listening: boolean) => Promise<void>, everyMs = 180000): () => void` sends at once and every `everyMs`, swallows errors (one `console.warn` per failure), returns stop. `householdState.ts`: `deviceHousehold(households: Household[] | null): Household | null` (the household a device belongs to: for an anonymous user the first one), `kioskFromHousehold(h: Household | null): boolean` (= `h?.live_guard_enabled ?? false`).
- LiveGuardScreen: while running on a device (anonymous user) that has a household, heartbeats with `listening = status is listening/checking/connected`; stops with the guard.
- App.tsx: on start, for an anonymous user with a household whose `live_guard_enabled` is true, kiosk mode is turned on (same path as the onboarding's `'kiosk'` choice) unless the user exited kiosk through the Settings unlock in the last 24 h (`sagi_kiosk_unlocked_until` in localStorage); the bottom bar and Settings behave as they do in kiosk mode today.

- [ ] **Step 1: Write the failing tests** (`heartbeat.test.ts` with fake timers: sends immediately, every 180 s, stops; a rejected send does not throw and does not stop the loop; `householdState.test.ts`: `deviceHousehold` / `kioskFromHousehold`; `client.auth.test.ts`: `heartbeat` posts `/household/<id>/heartbeat` with `{listening}`, `updateHousehold` sends PATCH).
- [ ] **Step 2: Run** `npx vitest run --pool=threads` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** vitest, `npm run lint`, build → PASS.
- [ ] **Step 5: Commit** `git commit -m "PWA: Live Guard heartbeats to the household; a household with Live Guard on opens the device in kiosk mode"`

---

### Task 4: Protect a parent, settings and the printable card

**Files:**
- Create: `frontend/src/pages/SetupCardScreen.tsx`
- Modify: `frontend/src/pages/GuardianViewScreen.tsx`, `frontend/src/lib/householdState.ts`, `frontend/src/App.tsx` (tab `setup_card`), `frontend/src/i18n/{ja,vi,en}.json`

**Behaviour:**
- Dashboard (signed-in guardian, any number of households): a "Protect a parent" button (`guardian.protect_parent`) opens a form: parent's first name (optional), market (ja / vi, default from the UI language), "Live Guard on a tablet beside the landline" toggle (default off, help text `guardian.live_guard_help`). Submit → `createHousehold` (the guardian becomes owner) then `updateHousehold` for the toggle when on → the new household is selected and the card opens.
- The card (`SetupCardScreen`): the 6-digit code large, a QR of `/#join=CODE`, the pilot URL in text, the expiry time ("valid until 14:32", from `expires_in`), a "New code" button (`householdCode`), and the steps for the grandparent's device in the household's market language with the UI language underneath when different: 1 open the link or scan, 2 enter the code on the Family screen, 3 allow the microphone (only when Live Guard is on), 4 leave it on the charger. An iPhone note: add to the home screen from Safari, turn notifications on inside the home-screen app (this is the lesson of 2026-10-24). A "Print" button (`window.print()`; `@media print` hides the app chrome).
- Manage sheet gains "Settings": parent's name, household name, Live Guard toggle (owner only; others see the values). Dashboard header shows `device_status`: "Listening since HH:MM" (green), "Last seen DD/MM HH:MM" (grey), "No device yet" with a "Show setup card" link.
- `householdState.ts`: `deviceStatusLabel(status, now, t)` → `{kind: 'listening' | 'seen' | 'none', at?: string}`; `cardSteps(market, liveGuard)` → ordered step keys.
- i18n keys (all three): `guardian.protect_parent`, `guardian.parent_name`, `guardian.market`, `guardian.live_guard_toggle`, `guardian.live_guard_help`, `guardian.settings`, `guardian.household_name`, `guardian.status_listening`, `guardian.status_seen`, `guardian.status_none`, `guardian.show_card`, `card.title`, `card.code_valid_until`, `card.new_code`, `card.open_link`, `card.step_open`, `card.step_code`, `card.step_mic`, `card.step_charger`, `card.iphone_note`, `card.print`.

- [ ] **Step 1: Write the failing tests** (`householdState.test.ts`: `deviceStatusLabel` for the three cases and the 24 h boundary; `cardSteps` with and without Live Guard).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the screen, the form, the manage-sheet settings, the status line.
- [ ] **Step 4: Run** vitest, lint, build, `keys.test.ts` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Guardian: protect a parent, printable setup card, household settings and device status"`

---

### Task 5: Device joins by code

**Files:**
- Modify: `frontend/src/pages/FamilyScreen.tsx`, `frontend/src/lib/householdState.ts`, `frontend/src/api/client.ts` (`JOIN_FROM_LINK` like `PAIR_FROM_LINK`, fragment stripped on load), `frontend/src/App.tsx` (`#join=` opens the Family screen), i18n

**Behaviour:**
- On the Family screen, the `create` state gains a second path: "I have a code from my family" (`family.have_code`) → 6-digit input (pre-filled from `/#join=`) → `joinHousehold(code)` as the anonymous device → the `household` state (guardians list, Live Guard status). Errors: wrong / expired → `family.join_wrong_code`; full → same text (deferred minor from the households plan). A device already in a household does not see the join path (one household per device, spec).
- `memberScreenState` gains `kind: 'join'` when the user chose the code path; `/#join=` lands straight in it with the code.

- [ ] **Step 1: Write the failing tests** (`householdState.test.ts`: `memberScreenState` with `joinChosen: true` → `join`; a device with a household never gets `join`; `client.ts` fragment parsing test for `#join=123456` → `JOIN_FROM_LINK = "123456"` and the hash cleared).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** vitest, lint, build → PASS.
- [ ] **Step 5: Commit** `git commit -m "Family screen: the protected device joins a household its family created"`

---

### Task 6: Web Share Target into Quick Check

**Files:**
- Create: `frontend/public/share-sw.js`, `frontend/src/lib/shareInbox.ts`, `frontend/src/lib/shareInbox.test.ts`, `backend/app/share.py`
- Modify: `frontend/vite.config.ts` (manifest `share_target`, `workbox.importScripts` adds `share-sw.js`, `navigateFallbackDenylist` adds `/share-target`), `frontend/src/App.tsx` (`#share` → Quick Check), `frontend/src/pages/QuickCheckScreen.tsx` (initial input from the inbox), `backend/app/main.py` (include `share.router`), `backend/tests/test_api.py`

**Interfaces:**
- Manifest: `share_target: {action: "/share-target", method: "POST", enctype: "multipart/form-data", params: {title: "title", text: "text", url: "url", files: [{name: "images", accept: ["image/*"]}]}}`.
- `share-sw.js`: on `fetch` for `POST /share-target`: read `formData()`, store `{title, text, url, files: [{name, type, blob}]}` into the Cache Storage cache `sagi-share` under the key `/share-inbox` as a JSON index plus one entry per file (`/share-inbox/<i>`), then `Response.redirect('/#share', 303)`. Never forwards the POST to the network.
- `shareInbox.ts`: `readShareInbox(): Promise<SharedInput | null>` (reads and clears the cache entries), `toCheckInput(shared: SharedInput): {text: string; images: File[]; rejected: {name: string; reason: 'size' | 'type'}[]}` with `MAX_IMAGE_BYTES = 8 * 1024 * 1024`, `MAX_IMAGES = 5`, text = `[title, text, url].filter(Boolean).join('\n')`.
- `backend/app/share.py`: `POST /share-target` → `RedirectResponse("/#share", status_code=303)` (Review Focus 2: no service worker yet, nothing to show); `GET /share-target` → 405 is fine.
- `QuickCheckScreen` accepts `initialInput?: {text: string; images: File[]; rejected: ...}` and shows a one-line notice for rejected files (`quick.share_rejected_size`, `quick.share_rejected_type`).

- [ ] **Step 1: Write the failing tests** (`shareInbox.test.ts`: `toCheckInput` joins title/text/url, keeps at most 5 images, rejects a 9 MB file by size and a PDF by type with reasons; backend: `test_share_target_without_a_worker_redirects_to_the_app` → 303 to `/#share`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; `share-sw.js` is plain JS (no bundling), checked by `node --check public/share-sw.js`.
- [ ] **Step 4: Run** vitest, lint, build (check `dist/manifest.webmanifest` contains `share_target`), backend tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "Share a screenshot or text from any app straight into Quick Check (Web Share Target)"`

---

### Task 7: Pilot setup, docs and the end-to-end run

**Files:**
- Modify: `docs/ROADMAP.md` (tick step 2 with the date), `CLAUDE.md` (Accounts paragraph: settings, heartbeat, sweep job, share target, `#join=`), `docs/PLAN.md` section 9 (new routes)

- [ ] **Step 1: Docs.**
- [ ] **Step 2: Commit** `git commit -m "Docs: guardian setup flow, heartbeat sweep and share target"`
- [ ] **Step 3 (controller, after the pilot deploy):** `pwsh infra/setup_heartbeat_job.ps1 -Service sagi-shield-pilot -Database pilot`; on the iPhone: Protect a parent → card → on the PC browser (device) join by `/#join=` → turn Live Guard on from the manage sheet → the PC opens in kiosk → dashboard shows "Listening since"; share a screenshot from Photos on an Android or the iPhone into Sagi PILOT → Quick Check pre-filled; run the sweep by hand (`gcloud run jobs execute sagi-heartbeat-sweep`) with a household whose heartbeat is older than 24 h (set `devices_seen` by hand in Firestore) → the offline push arrives. Record the result in CLAUDE.md.

---

## Self-review notes

- Spec coverage (ROADMAP step 2): Protect a parent flow (T4), printable instructions with the iOS lesson (T4), single-screen member UI = kiosk from the household flag with the existing exit path (T3; the roadmap's long-press idea is replaced by the existing Settings unlock), Web Share Target (T6), heartbeat + "offline since" + push after 24 h (T1-T3), everything behind `live_guard_enabled` (T1, T3, T4). Device-side join by code (carried over from the households plan's reset-devices ruling) is T5.
- Names used consistently: `device_status`, `devices_seen`, `offline_notified_at`, `update_household`, `record_heartbeat`, `households_for_sweep`, `mark_offline_notified`, `notify_offline`, `startHeartbeat`, `deviceHousehold`, `kioskFromHousehold`, `JOIN_FROM_LINK`, `readShareInbox`, `toCheckInput`.
- Left to the builder: exact layouts; the print stylesheet; how `QuickCheckScreen` merges `initialInput` with its own state; whether `devices_seen` is pruned when devices are reset (clear it in `clear_household_devices`, one line).
