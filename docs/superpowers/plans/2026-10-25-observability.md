# Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner can see what the system does to the pilot households within a minute of it happening, without reading any text: verdict records in BigQuery, an admin page of aggregates, a "was this right?" button on every verdict and alert, and an alarm when the pilot service is down.

**Architecture:** Every verdict record gets a `verdict_id`; a Cloud Logging sink copies the existing `jsonPayload` records into a BigQuery dataset per environment, so no schema code is added. A new `app/admin.py` serves aggregates computed by BigQuery SQL to a lazy `AdminScreen` (admin custom claim). Feedback is a tiny Firestore collection (ids, booleans, an enum reason, never text) written by `POST /feedback` (checks, App Check like `/report`) and `POST /household/{id}/alerts/{aid}/feedback` (guardians). Cloud Monitoring gets an uptime check on `/health` and an alert policy to an email channel; Error Reporting needs nothing (uncaught exceptions already land in Cloud Logging with stack traces).

**Tech Stack:** FastAPI, google-cloud-bigquery (already a dependency), Cloud Logging sinks, Cloud Monitoring, React 19 + recharts (already a dependency), vitest.

**Spec:** `docs/ROADMAP.md` section 4, step 3 ("see what the system does") and goal 2 of section 3; `CLAUDE.md` paragraphs on the verdict log and BigQuery; the pilot-only ruling of the roadmap (a stable household id travels in the verdict log during the pilot, removed before phase 2 — this plan does NOT add it: the household is not needed for the admin aggregates, and alerts are already per household).

## Global Constraints

- Branch `pilot` only; `main` and `.github/workflows/deploy.yml` untouched until 2026-11-07.
- A verdict record, a feedback document and an admin response never carry text, phone numbers, uids, household ids or transcripts; the judge's two short `reasons` already in the log stay as they are.
- Admin routes need the `admin` custom claim (`auth.admin_only`); admin responses are aggregates only.
- Feedback on a check needs no sign-in (App Check limited-use token like `/report`); feedback on an alert needs a guardian of that household.
- Google stack only; model IDs stay in `backend/core/model_ids.py`; the pilot writes BigQuery dataset `sagi_pilot`, production (after the freeze) `sagi`.
- Backend tests offline (`tests/conftest.py`), BigQuery stubbed; frontend `npx vitest run --pool=threads`, `npm run lint`, `npm run build` green; i18n ja/vi/en parity; CRLF preserved; no AI attribution trailer.
- Every enrichment degrades: a BigQuery failure makes the admin page say so, never a 500; a feedback failure never changes a verdict screen.

## Review Focus

1. A feedback POST replayed or spammed (a script hitting `/feedback` with random ids): the limited-use App Check token is consumed like `/report`, and an unknown `verdict_id` format is 422 — never stored. Test in Task 1.
2. The admin page opened by a signed-in guardian who is not admin: 403 with a calm sentence, no partial data. Test in Task 2 (route) and Task 4 (screen state).
3. BigQuery is slow or quota-limited: the admin route times out at 20 s and answers 503 with a sentence; the page shows a retry. Test in Task 2.
4. The sink filter must not copy App Check-related or access-log lines, only `jsonPayload.kind` records; the dataset must be partitioned by day so queries over 7 days scan little. Verified live in Task 3.
5. A guardian presses "false alarm" twice, or "false alarm" then "it was a scam": one document per (alert, guardian), last press wins. Test in Task 1.

---

## File map

- Modify `backend/app/verdict_log.py` (`verdict_id`), `backend/app/main.py` (`verdict_id` in `/check` and `/precheck` responses), `backend/app/households.py` (alert feedback route), `backend/app/storage.py` (`save_feedback`, `feedback_stats`), `backend/app/notifier.py` (FCM failure count log).
- Create `backend/app/feedback.py` (`POST /feedback`), `backend/app/admin.py` (`GET /admin/summary`, `GET /admin/households`), `backend/app/bq.py` (one `query(sql, params, timeout) -> list[dict]` wrapper; stubbed in tests).
- Create `infra/setup_verdict_sink.ps1`, `infra/setup_monitoring.ps1`; modify `infra/terraform/*.tf` (sink + dataset + uptime check + alert policy, gated for production), `.github/workflows/_deploy-service.yml` (`VERDICT_TABLE` input), `deploy-pilot.yml`, `infra/deploy.sh`.
- Frontend: `src/lib/feedback.ts` + test, `src/lib/adminState.ts` + test, `src/pages/AdminScreen.tsx`, `src/pages/ResultScreen.tsx`, `src/pages/GuardianViewScreen.tsx`, `src/api/client.ts` (+ MockApi), `src/App.tsx` (`#admin`), i18n.
- Docs: `docs/ROADMAP.md`, `CLAUDE.md`, `docs/PLAN.md` section 9.

## Shared definitions

```
verdict_id   uuid4().hex[:16] generated in verdict_log.record() for kinds check / precheck / live_look; returned in the
             /check and /precheck responses as "verdict_id"; live looks carry it in the record only (the alert stores none)
feedback doc (Firestore collection "feedback", id = f"{kind}:{target}:{who}")
  kind       "check" | "alert"
  target     verdict_id (check) or alert id (alert)
  who        reporter HMAC (check: phone_hmac("reporter:" + reporter_id), as /report) or guardian uid (alert)
  correct    bool
  reason     null | "not_scam" | "wrong_type" | "too_weak" | "too_strong" | "missed"      (enum, no text)
  lang       "ja" | "vi"
  created_at ISO-8601 UTC
analytics row kind="feedback": correct (bool as llm_used? no — add column "feedback_correct" BOOLEAN to the events table
             in Terraform and to analytics.FIELDS; the pilot has no BQ_TABLE so the row is simply dropped there)
VERDICT_TABLE  env, e.g. "sagi-shield-560661.sagi_pilot.verdicts" (the sink's table); unset → admin routes answer 503
               "verdict table not configured"
```

Admin summary shape (`GET /admin/summary?days=7`, days 1..30):

```
{"days": 7, "table": "…", "verdicts": [{"day": "2026-10-25", "kind": "check", "level": "HIGH", "lang": "ja", "n": 12}, …],
 "latency_ms": {"p50": 1300, "p95": 4200}, "live": {"calls": 3, "looks": 17, "alarms": 1},
 "rule_hits": [{"name": "authority", "n": 9}, …], "reasons": [{"playbook": "fake_police", "n": 7}, …],
 "feedback": {"checks": {"n": 5, "correct": 4}, "alerts": {"n": 2, "correct": 1}},
 "households": {"n": 3, "live_guard_on": 1, "devices_seen_24h": 1}}
```

---

### Task 1: Verdict ids and feedback

**Files:**
- Modify: `backend/app/verdict_log.py`, `backend/app/main.py`, `backend/app/households.py`, `backend/app/storage.py`, `backend/app/notifier.py`
- Create: `backend/app/feedback.py`
- Test: `backend/tests/test_verdict_log.py`, `backend/tests/test_api.py`, `backend/tests/test_household.py`, `backend/tests/test_feedback.py`

**Interfaces:**
- `verdict_log.record()` adds `verdict_id` (16 hex) for kinds `check`, `precheck`, `live_look`; `log_verdict()` returns the record (already does) so `main.finish()` can copy `verdict_id` into the response.
- `POST /feedback` body `{verdict_id: ^[0-9a-f]{16}$, correct: bool, reason?: enum, lang, reporter_id?: str}`; App Check like `/report` (limited-use token consumed in `monitor`/`enforce`, refused 403 in `enforce` without one); → `{ok}`; stores through `store.save_feedback(kind="check", target, who, correct, reason, lang)`; `log_event("feedback", lang=…, feedback_correct=correct)`.
- `POST /household/{id}/alerts/{aid}/feedback` body `{correct: bool, reason?: enum}` (guardian member; 404 unknown alert) → `{ok}`; `who = p.uid`.
- Storage (both stores): `save_feedback(kind, target, who, correct, reason, lang) -> dict` (upsert, id `f"{kind}:{target}:{who}"`), `feedback_stats(since_iso) -> {"checks": {"n", "correct"}, "alerts": {"n", "correct"}}`, `alert_exists(hid, aid) -> bool`.
- `notifier._push`: after `send_each_for_multicast`, log one line `[notifier] push sent=%d failed=%d` (counts only) when any failed.

- [ ] **Step 1: Write the failing tests**

```python
# test_verdict_log.py
def test_check_records_carry_a_verdict_id():
    rec = verdict_log.record("check", level="LOW", score=0)
    assert re.fullmatch(r"[0-9a-f]{16}", rec["verdict_id"])
    assert "verdict_id" not in verdict_log.record("live_call", session="abc")

# test_api.py
def test_check_response_has_a_verdict_id(client):
    r = client.post("/check", json={"lang": "ja", "text": "こんにちは"}).json()
    assert re.fullmatch(r"[0-9a-f]{16}", r["verdict_id"])

# test_feedback.py (fixture like test_appcheck.py: fake_status, APPCHECK=enforce for the replay test)
def test_feedback_is_stored_once_per_reporter_last_press_wins(client):
    vid = client.post("/check", json={"lang": "ja", "text": "こんにちは"}).json()["verdict_id"]
    assert client.post("/feedback", json={"verdict_id": vid, "correct": False, "reason": "missed", "lang": "ja", "reporter_id": "r1"}).status_code == 200
    assert client.post("/feedback", json={"verdict_id": vid, "correct": True, "lang": "ja", "reporter_id": "r1"}).status_code == 200
    stats = main.store.feedback_stats("2000-01-01T00:00:00+00:00")
    assert stats["checks"] == {"n": 1, "correct": 1}

def test_feedback_rejects_bad_ids_and_reasons(client):
    assert client.post("/feedback", json={"verdict_id": "nope", "correct": True, "lang": "ja"}).status_code == 422
    assert client.post("/feedback", json={"verdict_id": "0123456789abcdef", "correct": True, "reason": "because", "lang": "ja"}).status_code == 422

def test_feedback_needs_a_fresh_app_check_token_in_enforce(client, monkeypatch):
    monkeypatch.setenv("APPCHECK", "enforce")
    body = {"verdict_id": "0123456789abcdef", "correct": True, "lang": "ja"}
    assert client.post("/feedback", json=body).status_code == 403
    assert client.post("/feedback", json=body, headers={"X-Firebase-AppCheck": "good"}).status_code == 200
    assert client.post("/feedback", json=body, headers={"X-Firebase-AppCheck": "used"}).status_code == 403

# test_household.py
def test_guardian_feedback_on_an_alert_last_press_wins(client):
    h = client.post("/household", json={"market": "ja"}, headers=H(DEV)).json(); hid = h["household_id"]
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1))
    client.post(f"/household/{hid}/notify", json={"risk_level": "HIGH", "lang": "ja"}, headers=H(DEV))
    aid = client.get(f"/household/{hid}/alerts", headers=H(G1)).json()[0]["id"]
    assert client.post(f"/household/{hid}/alerts/{aid}/feedback", json={"correct": False, "reason": "not_scam"}, headers=H(DEV)).status_code == 403
    assert client.post(f"/household/{hid}/alerts/{aid}/feedback", json={"correct": False, "reason": "not_scam"}, headers=H(G1)).status_code == 200
    assert client.post(f"/household/{hid}/alerts/{aid}/feedback", json={"correct": True}, headers=H(G1)).status_code == 200
    assert client.post(f"/household/{hid}/alerts/zzz/feedback", json={"correct": True}, headers=H(G1)).status_code == 404
    assert main.store.feedback_stats("2000-01-01T00:00:00+00:00")["alerts"] == {"n": 1, "correct": 1}
```

- [ ] **Step 2: Run** (PowerShell, backend/) `python -m pytest tests/test_verdict_log.py tests/test_api.py tests/test_feedback.py tests/test_household.py -q` → FAIL.
- [ ] **Step 3: Implement** (Firestore: collection `feedback`, document id as above, `feedback_stats` with two `where` queries on `kind` and `created_at`; `events` analytics column `feedback_correct` added to `analytics.FIELDS` and Terraform's table schema).
- [ ] **Step 4: Run** `python -m pytest tests -q` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Feedback: a verdict id on every check, 'was this right?' stored without text"`

---

### Task 2: Admin API over BigQuery

**Files:**
- Create: `backend/app/bq.py`, `backend/app/admin.py`
- Modify: `backend/app/main.py` (include router)
- Test: `backend/tests/test_admin.py`

**Interfaces:**
- `bq.query(sql: str, params: dict, timeout_s: float = 20) -> list[dict]` using `google.cloud.bigquery.Client().query(sql, job_config=QueryJobConfig(query_parameters=[…])).result(timeout=timeout_s)`; raises `bq.Unavailable(detail)` on any failure or when `VERDICT_TABLE` is unset. Tests monkeypatch `bq.query`.
- `GET /admin/summary?days=7` (`admin_only`; 1 ≤ days ≤ 30, else 422) → the shape in Shared definitions; SQL lives in `admin.py` as constants with `@table` substituted from `VERDICT_TABLE` (validated `^[\w-]+\.\w+\.\w+$`), `@days` as a query parameter; the household figures come from `store.households_overview() -> {"n", "live_guard_on", "devices_seen_24h"}` (both stores; Firestore: count aggregation queries) and feedback from `store.feedback_stats(since)`.
- `GET /admin/households` (`admin_only`) → `{"n": …}` only (no ids) — folded into summary; keep one route.
- `bq.Unavailable` → 503 `{"detail": "verdict table not available: <reason>"}`; an unset table → 503 `"verdict table not configured"`.

- [ ] **Step 1: Write the failing tests**

```python
ADMIN = {"Authorization": "Bearer fake:root:google.com:admin"}

def test_summary_needs_admin(client):
    assert client.get("/admin/summary").status_code == 401
    assert client.get("/admin/summary", headers={"Authorization": "Bearer fake:g1:google.com"}).status_code == 403

def test_summary_shapes_bigquery_rows(client, monkeypatch):
    monkeypatch.setenv("VERDICT_TABLE", "p.sagi_pilot.verdicts")
    rows = {"verdicts": [{"day": "2026-10-25", "kind": "check", "level": "HIGH", "lang": "ja", "n": 2}],
            "latency": [{"p50": 1300.0, "p95": 4200.0}], "live": [{"calls": 1, "looks": 4, "alarms": 1}],
            "rule_hits": [{"name": "authority", "n": 3}], "reasons": [{"playbook": "fake_police", "n": 2}]}
    monkeypatch.setattr(admin.bq, "query", lambda sql, params, timeout_s=20: rows[admin.which(sql)])
    r = client.get("/admin/summary?days=7", headers=ADMIN)
    assert r.status_code == 200
    body = r.json()
    assert body["verdicts"][0]["n"] == 2 and body["latency_ms"] == {"p50": 1300, "p95": 4200}
    assert body["households"] == {"n": 0, "live_guard_on": 0, "devices_seen_24h": 0} and body["feedback"]["checks"]["n"] == 0
    assert client.get("/admin/summary?days=99", headers=ADMIN).status_code == 422

def test_summary_without_bigquery_is_503_with_a_sentence(client, monkeypatch):
    monkeypatch.delenv("VERDICT_TABLE", raising=False)
    r = client.get("/admin/summary", headers=ADMIN)
    assert r.status_code == 503 and "not configured" in r.json()["detail"]
    monkeypatch.setenv("VERDICT_TABLE", "p.sagi_pilot.verdicts")
    def boom(sql, params, timeout_s=20): raise admin.bq.Unavailable("timeout")
    monkeypatch.setattr(admin.bq, "query", boom)
    assert client.get("/admin/summary", headers=ADMIN).status_code == 503
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (`admin.which(sql)` returns the query's name from a leading `-- name:` comment so tests can route by query; five queries: verdicts per day/kind/level/lang, latency percentiles via `APPROX_QUANTILES(latency_ms, 100)`, live counts (`COUNTIF(kind='live_call')` etc.), rule hits (`UNNEST` of `rules.hits` keys — look at how `rules={"hits": result.get("rule_hits")}` is logged and query the field that exists), reasons per playbook (`llm.playbook` where present).
- [ ] **Step 4: Run** `python -m pytest tests -q` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Admin API: verdict aggregates from BigQuery, households and feedback counts"`

---

### Task 3: Sink, monitoring, env plumbing

**Files:**
- Create: `infra/setup_verdict_sink.ps1`, `infra/setup_monitoring.ps1`
- Modify: `infra/terraform/main.tf`, `variables.tf`, `outputs.tf`; `.github/workflows/_deploy-service.yml` (input `verdict_table`, env `VERDICT_TABLE`), `.github/workflows/deploy-pilot.yml` (`verdict_table: sagi-shield-560661.sagi_pilot.verdicts` — use `${{ vars.GCP_PROJECT }}`), `infra/deploy.sh` (`VERDICT_TABLE` passthrough)

**Behaviour:**
- `setup_verdict_sink.ps1 -Service sagi-shield-pilot -Dataset sagi_pilot`: `bq mk --dataset --location=asia-northeast1` if missing (or `gcloud alpha bq`… use `bq` with `--flag=value` syntax per CLAUDE.md); `gcloud logging sinks create sagi-verdicts-<service> bigquery.googleapis.com/projects/<p>/datasets/<dataset> --log-filter 'resource.type="cloud_run_revision" AND resource.labels.service_name="<service>" AND jsonPayload.kind:*' --use-partitioned-tables`; grant the sink's writer identity `roles/bigquery.dataEditor` on the dataset; print the table name (`<p>.<dataset>.run_googleapis_com_stdout` is what a Cloud Run sink creates — read the actual table name after the first record lands and print how to set `VERDICT_TABLE`; the admin SQL must use the sink's column layout: `jsonPayload.kind`, `jsonPayload.level`, … — Task 2's SQL is written against that layout: `jsonPayload.<field>` columns, `timestamp` for the day).
- `setup_monitoring.ps1 -Service sagi-shield-pilot -Email <addr>`: `gcloud monitoring uptime create` on `https://<host>/health` every 5 min; a notification channel of type email; an alert policy "<service> down" on the uptime check failing in 2 regions for 5 min; print what it did; idempotent by display name.
- Terraform: `google_logging_project_sink` + `google_bigquery_dataset` + IAM, `google_monitoring_uptime_check_config`, `google_monitoring_notification_channel` (email var), `google_monitoring_alert_policy`, each for the pilot behind `pilot_enabled` and for production behind `observability_prod_enabled` (default false); `terraform fmt -check` + `validate`.
- Review Focus 4 is checked live by the controller after the first deploy: the sink's table holds only `jsonPayload.kind` rows and is day-partitioned.

- [ ] **Step 1: Write** scripts and Terraform; validate (`ParseFile`, YAML parse, `bash -n` with CR stripped, `terraform validate`).
- [ ] **Step 2: Commit** `git commit -m "Infra: verdict log sink to BigQuery, uptime check and alert policy, VERDICT_TABLE plumbing"`

---

### Task 4: Feedback buttons and the admin page

**Files:**
- Create: `frontend/src/lib/feedback.ts` + `feedback.test.ts`, `frontend/src/lib/adminState.ts` + `adminState.test.ts`, `frontend/src/pages/AdminScreen.tsx`
- Modify: `frontend/src/api/client.ts` (+ MockApi), `frontend/src/pages/ResultScreen.tsx`, `frontend/src/pages/GuardianViewScreen.tsx`, `frontend/src/App.tsx`, i18n

**Behaviour:**
- `Api.sendFeedback(verdictId, correct, reason?)` (limited-use App Check like `report`), `Api.sendAlertFeedback(householdId, alertId, correct, reason?)`, `Api.adminSummary(days)`; `CheckResult` gains `verdict_id?: string`.
- Result screen: under the verdict, "Was this right?" with 👍 / 👎; 👎 opens four reason chips (`not_scam`, `wrong_type`, `too_weak`, `too_strong`; `missed` is for a LOW that was a scam — show `missed` and `too_weak` on LOW/MEDIUM, `not_scam`/`too_strong`/`wrong_type` on MEDIUM/HIGH); one send, then "Thanks" (`feedback.thanks`); failure → nothing changes but a quiet "could not send" line; the pure chip-choice logic `reasonsFor(level)` and the send-state machine `feedbackState` in `feedback.ts`, tested. Stored once per device: `localStorage['sagi_feedback:'+verdict_id]` to hide the buttons after sending.
- Guardian alert card: "False alarm" / "It was a scam" (keys `guardian.fb_false_alarm`, `guardian.fb_real`) → `sendAlertFeedback`; after sending the card shows the chosen word; not shown on `device_offline` rows.
- Admin page (`AdminScreen`, lazy; opened by `/#admin` or a Settings link visible only when the signed-in user has the admin claim — `auth.ts` exposes `isAdmin()` from the ID token result's `claims.admin === true`): day selector (1/7/30), a bar chart of verdicts per day by level (recharts), a small table per kind/lang, the live counts, latency p50/p95, feedback agreement rate, households line; states loading / forbidden (403: `admin.not_admin`) / unavailable (503 with the server sentence + retry) / data; `adminState.ts` holds `adminScreenState` and `agreementRate` tested.
- i18n keys ja/vi/en for everything above.

- [ ] **Step 1: Write the failing tests** (`feedback.test.ts`: `reasonsFor` per level, `feedbackState` transitions incl. failure; `adminState.test.ts`: state from 401/403/503/data, `agreementRate` with zero; `client.auth.test.ts`: `sendFeedback` uses a limited-use token and posts `/feedback`; `adminSummary` sends the Bearer header).
- [ ] **Step 2: Run** `npx vitest run --pool=threads` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** vitest, lint, build → PASS.
- [ ] **Step 5: Commit** `git commit -m "PWA: 'was this right?' on verdicts and alerts; admin page of aggregates"`

---

### Task 5: Docs and the live run

- [ ] **Step 1: Docs** — ROADMAP step 3 heading "built <date>, verified: pending"; CLAUDE.md paragraph "Observability (2026-10-25)" (verdict ids, feedback, sink dataset per environment, admin page + claim, monitoring scripts, `VERDICT_TABLE`); PLAN section 9 routes. Commit `git commit -m "Docs: observability — verdict ids, feedback, sink, admin page, monitoring"`.
- [ ] **Step 2 (controller):** after the pilot deploy: `pwsh infra/setup_verdict_sink.ps1 -Service sagi-shield-pilot -Dataset sagi_pilot`, run a check, wait for the table, set the GitHub `pilot` environment variable / workflow input `VERDICT_TABLE` to the real table name and redeploy; `pwsh infra/setup_monitoring.ps1 -Service sagi-shield-pilot -Email <owner>`; grant the owner the admin claim with `grant_admin.py --gcloud-token --project … --email <owner>`; open `/#admin` on the iPhone; press 👎 on a check and "false alarm" on an alert; confirm the feedback documents and the summary counts. Record in CLAUDE.md.
