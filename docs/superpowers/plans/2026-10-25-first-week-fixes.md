# First-Week Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the seven things the two final reviews and the live run of 2026-10-25 flagged as likely to bite the first pilot households, before any household is set up.

**Architecture:** Two batches, no new subsystem: a backend batch (log redaction in `app/guard.py`, `tools/grant_admin.py` gcloud-token path, alert summary fallback in `app/notifier.py`) and a PWA batch (household chip labels, image+text share hint, return to Live Guard after a share on a kiosk device, kiosk marker back-fill).

**Tech Stack:** FastAPI / Python logging, firebase-admin, React 19 + Vite, vitest.

**Spec:** the findings recorded in `CLAUDE.md` ("Guardian setup (2026-10-25)" paragraph: identical chips, App Check token in the WebSocket handshake log) and the deferred-minor triage of the final reviews of `docs/superpowers/plans/2026-10-24-households-and-roles.md` and `docs/superpowers/plans/2026-10-25-guardian-setup.md`.

## Global Constraints

- Branch `pilot` only; `main` and `.github/workflows/deploy.yml` untouched until 2026-11-07.
- English code and comments; UI strings ja / vi / en with identical keys (`keys.test.ts`); Vietnamese with full diacritics; copy short and calm.
- Never log a token, query string, transcript or phone number; a share is never fetched or stored server-side.
- The Live Guard warning is never delayed or refused.
- Backend tests offline (`tests/conftest.py`); frontend `npx vitest run --pool=threads`, `npm run lint`, `npm run build` green; CRLF preserved per file; no AI attribution trailer.

## Review Focus

1. A non-ASCII or very long `?appcheck=` value in the handshake URL: the redaction must drop everything after `?`, never truncate mid-token and never raise inside a logging filter (a filter that throws kills the log line, not the request). Test in Task 1.
2. A household with `member_name` set and another without: chips must differ visibly, and the one without a name must still be identifiable (date). Test in Task 2.
3. A share with text only on a kiosk device: after the result screen, the device returns to Live Guard; a share with images only does the same. Test in Task 2 (pure decision).
4. A device already in kiosk from the old code whose household has Live Guard on: the marker is written on the next foreground so a later "off" releases it; a device in kiosk by the user's own onboarding choice with Live Guard off never gets the marker. Test in Task 2.
5. An alert with no reasons and no advice in either language: the fallback sentence is in the household's market language. Test in Task 1.

---

### Task 1: Backend batch

**Files:**
- Modify: `backend/app/guard.py`, `backend/app/notifier.py`, `backend/tools/grant_admin.py`
- Test: `backend/tests/test_guard.py`, `backend/tests/test_household.py`

**Interfaces / decisions:**
- `guard.py`: install a `logging.Filter` on the `uvicorn.error` logger at import (where the access log is configured) that rewrites any record whose message contains `"WebSocket "` and a `?` by cutting the path at the first `?` (`"WebSocket /ws/live?lang=ja&appcheck=…" [accepted]` → `"WebSocket /ws/live" [accepted]`). Works on `record.msg` with `record.args` (uvicorn passes the scope path as an arg): apply the cut to every string argument containing `?`. Never raises: wrap in try/except returning True.
- `notifier.py`: `summary = first reason or advice or FALLBACK_SUMMARY[lang]` with `FALLBACK_SUMMARY = {"ja": "危険度の高い通話が検知されました。", "vi": "Đã phát hiện một cuộc gọi có nguy cơ cao."}` (used by both `alert_family` and `alert_household`).
- `grant_admin.py`: `--gcloud-token` flag, same approach as `tools/load_phish_list.py` (`gcloud auth print-access-token` via subprocess) building `firebase_admin` credentials from `google.oauth2.credentials.Credentials(token)` for `initialize_app(credential=…)`; docstring updated; `--project` required with it.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_guard.py
def test_websocket_handshake_log_drops_the_query_string(caplog):
    import logging
    from app import guard  # installs the filter
    log = logging.getLogger("uvicorn.error")
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        log.info('%s - "WebSocket %s" [accepted]', "1.2.3.4:5", "/ws/live?lang=ja&appcheck=eyJhbGciOi.abc.def")
    assert "appcheck" not in caplog.text and '"WebSocket /ws/live" [accepted]' in caplog.text

def test_handshake_filter_never_raises(caplog):
    import logging
    from app import guard
    log = logging.getLogger("uvicorn.error")
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        log.info("WebSocket %s", None)
    assert "WebSocket" in caplog.text

# tests/test_household.py
def test_alert_without_reasons_gets_a_fallback_sentence(client):
    h = client.post("/household", json={"market": "vi"}, headers=H(DEV)).json(); hid = h["household_id"]
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1))
    client.post(f"/household/{hid}/notify", json={"risk_level": "HIGH", "lang": "vi"}, headers=H(DEV))
    assert client.get(f"/household/{hid}/alerts", headers=H(G1)).json()[0]["summary"] == "Đã phát hiện một cuộc gọi có nguy cơ cao."
```

- [ ] **Step 2: Run** (PowerShell, backend/) `python -m pytest tests/test_guard.py tests/test_household.py -q` → FAIL.
- [ ] **Step 3: Implement** the three changes; `python -m py_compile tools/grant_admin.py`.
- [ ] **Step 4: Run** `python -m pytest tests -q` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Pilot fixes: no token in the WebSocket handshake log, alert fallback sentence, grant_admin with a gcloud token"`

---

### Task 2: PWA batch

**Files:**
- Modify: `frontend/src/lib/householdState.ts` (+ test), `frontend/src/pages/GuardianViewScreen.tsx`, `frontend/src/pages/QuickCheckScreen.tsx`, `frontend/src/App.tsx`, `frontend/src/i18n/{ja,vi,en}.json`

**Interfaces / decisions:**
- Chips: `householdChipLabel(h, t)` = `member_name || name || t('guardian.household_created', {date: DD/MM})` from `created_at`; the chip also carries a small status dot from `deviceStatusLabel(...)` kind (green listening, amber offline, grey otherwise). New key `guardian.household_created` ("Household from {date}").
- Share hint: when `initialInput` has both text and images, Quick Check shows one line `quick.share_text_kept` ("The shared text is in the Text tab; this check uses the images.").
- Kiosk return: `afterResultTarget({kioskMode, cameFromShare}) → 'guard' | 'home'` in householdState.ts; App uses it for the result screen's back/finish when `SHARE_FROM_LINK` was set: on a kiosk device → `guard` (which restarts the guard as kiosk does), else `home`.
- Marker back-fill: `kioskDecision` gains the case `kioskOn && !fromHousehold && household?.live_guard_enabled` → `'mark'` (write `sagi_kiosk_from_household`, change nothing else); App handles `'mark'`. A user-chosen kiosk with Live Guard off stays untouched (`'keep'`).

- [ ] **Step 1: Write the failing tests** (householdState.test.ts): chip labels for named / unnamed households (date from `created_at`, `t` stubbed); `afterResultTarget` four combinations; `kioskDecision` → `'mark'` case and the user-chosen `'keep'` case; `shareNeedsTextHint(input)` true only with both text and images.
- [ ] **Step 2: Run** `npx vitest run --pool=threads` → FAIL.
- [ ] **Step 3: Implement** (keys in three files).
- [ ] **Step 4: Run** vitest, `npm run lint`, build → PASS.
- [ ] **Step 5: Commit** `git commit -m "Pilot fixes: household chips tell apart, shared text hint, back to Live Guard after a share, kiosk marker back-fill"`

---

### Task 3: Docs

- [ ] Update the two findings in `CLAUDE.md`'s "Guardian setup (2026-10-25)" paragraph to "fixed 2026-10-25 (…)" and commit `git commit -m "Docs: first-week fixes recorded"`.
