# Pilot Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second Cloud Run service, `sagi-shield-pilot`, deployed automatically from the `pilot` branch, so post-contest work and the family pilot run on their own URL while the judged service `sagi-shield-api` and the `main` branch stay untouched until 2026-11-07 (2026-12-04 if shortlisted).

**Architecture:** One reusable GitHub workflow holds the build-and-roll steps that `deploy.yml` has today; a new `deploy-pilot.yml` on `push` to `pilot` runs the tests and then calls it with `service=sagi-shield-pilot`. The pilot service runs the same image and runtime account but its own Firestore database (`pilot`), no analytics stream, and a `PILOT` badge in the PWA, so nothing a pilot family does can change what a judge sees. `deploy.yml` on `main` is not edited in this plan: GitHub runs `workflow_run` workflows from the default branch, so any change to it would only take effect after the freeze anyway; a follow-up commit after 2026-11-07 turns it into a caller of the same reusable workflow.

**Tech Stack:** GitHub Actions (reusable workflows, `workflow_call`), gcloud, Cloud Run, Firestore named databases, Terraform (validate only in CI), Vite env, React.

**Spec:** `docs/ROADMAP.md` phase 0 and the owner's decision of 2026-10-24: the judged URL must not change during evaluation; post-contest work needs its own environment. Memory note: `main-frozen-during-judging`.

## Global Constraints

- Nothing in this plan is merged to `main`, pushed to `main`, or run through `deploy.yml` / `infra/deploy.sh` against `sagi-shield-api` before 2026-11-07. Every commit lands on `pilot`.
- Same GCP project `sagi-shield-560661`, same region `asia-northeast1`, same runtime service account `sagi-api`, same secrets (`sagi-hash-key`, `sagi-stt-api-key`), same Artifact Registry repository `sagi` (image name `sagi-shield-pilot` so tags never collide).
- Google stack only; model IDs stay in `backend/core/model_ids.py`; no new model is named.
- All code, comments, docs and commit messages in English; no AI attribution trailer.
- Backend tests run offline (`tests/conftest.py`); CI's `terraform fmt -check` and `terraform validate` must stay green.

## Review Focus

1. A push to `pilot` that fails tests must not deploy: `deploy-pilot.yml` makes the deploy job `needs` the test jobs (Task 2 verifies by pushing a deliberately failing commit, then reverting).
2. A pilot deploy must never touch `sagi-phish-loader` (the judged service's monthly job): the reusable workflow skips that step unless `service == sagi-shield-api` (Task 1 input `update_phish_job`, default `false`).
3. With `FIRESTORE_DB=pilot` a missing database must fail loudly at start-up (503 on `/health` is wrong; the process must refuse to serve a "LOW" with no store): `get_store()` raises on a database that does not exist (Task 3 test with a fake client).
4. The pilot PWA installed on a relative's phone must be distinguishable from the judged one: `PILOT` badge (Task 4) and a different `manifest.name` suffix so two home-screen icons are not identical.
5. App Check tokens on the new host: the reCAPTCHA key must list the pilot URL or every pilot request is throttled to 5/min (`RATE_LIMIT_UNVERIFIED_PER_MIN`); Task 5 adds the domain and the smoke test checks the access log shows `ac=valid`.

---

## File map

- Create `.github/workflows/_deploy-service.yml` (reusable: build PWA, build + push image, `gcloud run deploy`, optional phish-job update, smoke test).
- Create `.github/workflows/deploy-pilot.yml` (push to `pilot` → tests → call the reusable workflow).
- Modify `.github/workflows/ci.yml` (`branches: [main, pilot]`, so PRs into `pilot` and pushes get the same CI badge; harmless for `main`).
- Modify `backend/app/storage.py` (`FIRESTORE_DB`), `backend/app/phish_list.py` and `backend/tools/load_phish_list.py` if they build their own client (same env).
- Modify `infra/deploy.sh` (`FIRESTORE_DB`, `BQ_TABLE` opt-out, `IMAGE_NAME`), `infra/terraform/main.tf` + `variables.tf` (optional pilot service, `count`), `infra/setup_appcheck.ps1` (`-ExtraDomains`), create `infra/setup_pilot.ps1` (database, one-off phish load, App Check domain, GitHub environment vars).
- Modify `frontend/src/components/Header.tsx`, `frontend/src/api/client.ts` (`VITE_ENV_LABEL`), `frontend/vite.config.ts` manifest name, `frontend/src/i18n/*.json` (no new keys: the badge text is the literal label).
- Modify `CLAUDE.md`, `docs/ROADMAP.md` (phase 0 gains "step 0b: pilot environment"), `docs/PLAN.md` section 7 one line.

---

### Task 1: Reusable deploy workflow

**Files:**
- Create: `.github/workflows/_deploy-service.yml`

**Interfaces:**
- `on: workflow_call` with inputs: `service` (string, required), `image_name` (string, required), `ref` (string, required: the SHA to check out), `environment` (string, required: GitHub environment name), `firestore_db` (string, default `(default)`), `bq_table` (string, default `""` = analytics off), `env_label` (string, default `""`), `update_phish_job` (boolean, default `false`), `min_instances` (number, default 0). Secrets: none (WIF via `vars`).
- Steps are a copy of `deploy.yml`'s job body with these substitutions: `SERVICE=${{ inputs.service }}`, `IMAGE=asia-northeast1-docker.pkg.dev/${{ vars.GCP_PROJECT }}/sagi/${{ inputs.image_name }}`, `SHA=${{ inputs.ref }}`, `environment: ${{ inputs.environment }}`; the `ENV` string gains `@FIRESTORE_DB=${{ inputs.firestore_db }}`, includes `@BQ_TABLE=...` only when `inputs.bq_table != ''`; `npm run build` gets `VITE_ENV_LABEL: ${{ inputs.env_label }}`; the phish-job step runs only `if: inputs.update_phish_job`; the smoke test is unchanged and additionally `curl -fsS "$URL/health" | grep -q '"store":"firestore"'` is **not** added (health does not expose it; see Task 3 for what health returns).
- `concurrency: group: deploy-${{ inputs.service }}`.

- [ ] **Step 1: Write the workflow** from `deploy.yml`; keep comments that explain the `^@^` separator and the single `--set-env-vars`.
- [ ] **Step 2: Validate syntax** with `actionlint` if available (`winget install rhysd.actionlint` or skip) and by `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/_deploy-service.yml'))"`.
- [ ] **Step 3: Commit** `git commit -m "CI: reusable Cloud Run deploy workflow (service, image and database as inputs)"`

---

### Task 2: Pilot deploy on push

**Files:**
- Create: `.github/workflows/deploy-pilot.yml`
- Modify: `.github/workflows/ci.yml:5` (`branches: [main, pilot]`)

**Interfaces:**
- `on: push: branches: [pilot]` (no `paths-ignore`: a docs-only push redeploys too; cheap and simpler than reasoning about skips) plus `workflow_dispatch`.
- Jobs: `backend` and `frontend` copied from `ci.yml` (tests only, no terraform / docker job: the deploy builds the image itself), then `deploy: needs: [backend, frontend]` → `uses: ./.github/workflows/_deploy-service.yml` with `service: sagi-shield-pilot`, `image_name: sagi-shield-pilot`, `ref: ${{ github.sha }}`, `environment: pilot`, `firestore_db: pilot`, `bq_table: ""`, `env_label: PILOT`, `update_phish_job: false`.
- `permissions: contents: read, id-token: write` on the caller too (required for the callee's WIF step).

- [ ] **Step 1: Write the workflow.**
- [ ] **Step 2: GitHub environment `pilot`**: `gh api -X PUT repos/{owner}/{repo}/environments/pilot`; set `APPCHECK=monitor` as an environment variable (`gh variable set APPCHECK --env pilot --body monitor`). Repository-level `GCP_*`, `VITE_*` variables are inherited.
- [ ] **Step 3: First run**: `git push -u origin pilot`; watch `gh run watch`. Expected: tests green, `gcloud run deploy sagi-shield-pilot` creates the service, smoke test prints `Deployed: https://sagi-shield-pilot-....a.run.app`. The first deploy will **fail at the smoke test** if Task 3 is not merged yet (no `pilot` database) — do Task 3 before this step, or accept one red run.
- [ ] **Step 4: Review Focus 1**: push a commit that breaks one backend test, confirm the deploy job is skipped, revert with `git revert`.
- [ ] **Step 5: Commit** `git commit -m "CI: deploy the pilot branch to sagi-shield-pilot after tests"`

---

### Task 3: Firestore database per environment

**Files:**
- Modify: `backend/app/storage.py:194-199, 311-320`, `backend/app/phish_list.py` / `backend/tools/load_phish_list.py` (wherever `firestore.Client()` is built)
- Test: `backend/tests/test_storage_env.py`

**Interfaces:**
- Env `FIRESTORE_DB` (default `(default)`): `FirestoreStore.__init__` builds `firestore.Client(database=os.getenv("FIRESTORE_DB", "(default)"))`.
- `get_store()` probes the database once (`next(self.db.collections(), None)`, wrapped) and raises `RuntimeError("Firestore database '<name>' is missing or unreadable: <error>")` so Cloud Run marks the revision unhealthy instead of serving without a store (Review Focus 3).
- `/health` returns `{"ok": true, "store": "memory" | "firestore", "database": "<name>" | null}` (today it returns a smaller dict; extend, do not replace).

- [ ] **Step 1: Write the failing tests**

```python
import os, pytest
from app import storage

class FakeFs:
    class Query: DESCENDING = "desc"
    class FieldFilter:
        def __init__(self, *a): pass
    def __init__(self, exists=True): self.exists = exists; self.database = None
    def Client(self, database="(default)"):
        self.database = database
        fake = self
        class C:
            def collections(self):
                if not fake.exists: raise RuntimeError("NotFound: database pilot")
                return iter([])
        return C()

def test_firestore_db_env_selects_the_database(monkeypatch):
    fs = FakeFs(); monkeypatch.setitem(__import__("sys").modules, "google.cloud.firestore", fs)
    monkeypatch.setenv("FIRESTORE_DB", "pilot")
    storage.FirestoreStore()
    assert fs.database == "pilot"

def test_missing_database_refuses_to_start(monkeypatch):
    fs = FakeFs(exists=False); monkeypatch.setitem(__import__("sys").modules, "google.cloud.firestore", fs)
    monkeypatch.setenv("STORE", "firestore"); monkeypatch.setenv("HASH_KEY", "k"); monkeypatch.setenv("FIRESTORE_DB", "pilot")
    with pytest.raises(RuntimeError, match="pilot"):
        storage.get_store()

def test_health_names_the_store(client):   # client fixture from test_api.py style
    body = client.get("/health").json()
    assert body["store"] == "memory" and body["database"] is None
```

- [ ] **Step 2: Run** `python -m pytest tests/test_storage_env.py -q` → FAIL.
- [ ] **Step 3: Implement** (`FirestoreStore.database` attribute; `get_store()` probe; health fields). Grep `firestore.Client(` across `backend/` and give every call the same `database=` argument.
- [ ] **Step 4: Run** `python -m pytest tests -q` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Storage: FIRESTORE_DB selects the database; a missing one stops the service at start-up"`

---

### Task 4: PILOT badge and manifest name

**Files:**
- Modify: `frontend/src/api/client.ts` (export `envLabel`), `frontend/src/components/Header.tsx`, `frontend/vite.config.ts` (PWA manifest `name` / `short_name`)
- Test: `frontend/src/components/Header.test.tsx`

**Interfaces:**
- `export const envLabel: string = (import.meta.env.VITE_ENV_LABEL || '').trim().slice(0, 12)` in `client.ts`.
- Header shows the existing DEMO badge for mock mode; otherwise, when `envLabel` is non-empty, the same badge component with `envLabel` as text and `title="Pilot environment"`.
- `vite.config.ts`: when `process.env.VITE_ENV_LABEL` is set, manifest `name` becomes `"Sagi Shield (PILOT)"` and `short_name` `"Sagi PILOT"` (Review Focus 4).

- [ ] **Step 1: Write the failing test**: render `Header` with `vi.stubEnv('VITE_ENV_LABEL', 'PILOT')` and mock mode off → text `PILOT` present; with mock mode on → `DEMO` present and `PILOT` absent.
- [ ] **Step 2: Run** (PowerShell) `cd frontend; npm test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test; npm run lint; $env:VITE_ENV_LABEL='PILOT'; npm run build` → PASS; `dist/manifest.webmanifest` contains `Sagi PILOT`.
- [ ] **Step 5: Commit** `git commit -m "PWA: environment badge and manifest name for the pilot build"`

---

### Task 5: One-time project setup for the pilot service

**Files:**
- Create: `infra/setup_pilot.ps1`
- Modify: `infra/setup_appcheck.ps1` (parameter `-ExtraDomains string[]`, appended to the reCAPTCHA key's allowed domains), `infra/deploy.sh` (`FIRESTORE_DB`, `IMAGE_NAME`, `BQ_TABLE` opt-out via `NO_ANALYTICS=1`)

**Interfaces (`setup_pilot.ps1`, style of the other setup scripts, idempotent):**
1. `gcloud firestore databases create --database=pilot --location=asia-northeast1 --type=firestore-native` (skip if it exists); enable TTL on `recovery_sessions.expires_at` as the default database has (`gcloud firestore fields ttls update expires_at --collection-group=recovery_sessions --database=pilot --enable-ttl`).
2. `python backend/tools/load_phish_list.py --months 2` with `FIRESTORE_DB=pilot` (the pilot has no scheduler job; the owner reruns by hand, noted in CLAUDE.md), `--gcloud-token` on a laptop without ADC.
3. After the first deploy: read the pilot URL (`gcloud run services describe sagi-shield-pilot --format 'value(status.url)'`), call `setup_appcheck.ps1 -ExtraDomains <host>` so App Check tokens verify there (Review Focus 5); print the URL and the two things the owner does by hand: add the host to Firebase Authentication authorized domains (needed by the households plan), and bookmark it as the pilot URL.

- [ ] **Step 1: Write the script and the `deploy.sh` changes** (`SERVICE=sagi-shield-pilot FIRESTORE_DB=pilot NO_ANALYTICS=1 VITE_ENV_LABEL=PILOT PROJECT=... ./infra/deploy.sh` must deploy the same thing the workflow does, for a laptop without GitHub).
- [ ] **Step 2: Run** `pwsh infra/setup_pilot.ps1` (needs `gcloud` on PATH: `%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin`). Expected output: database exists, phish rows loaded (count printed), App Check domain added.
- [ ] **Step 3: Verify in the built-in browser**: open the pilot URL, Quick Check a text, see `PILOT` badge; `gcloud logging read 'resource.labels.service_name="sagi-shield-pilot" AND textPayload:"ac="' --limit 5` shows `ac=valid` (or `ac=missing` only for the socket probe). Judged service untouched: `gcloud run revisions list --service sagi-shield-api` shows no new revision today.
- [ ] **Step 4: Commit** `git commit -m "Infra: pilot setup script (database, phishing list, App Check domain); deploy.sh takes the same inputs"`

---

### Task 6: Terraform mirror and docs

**Files:**
- Modify: `infra/terraform/main.tf`, `infra/terraform/variables.tf`, `infra/terraform/outputs.tf`
- Modify: `CLAUDE.md`, `docs/ROADMAP.md`, `docs/PLAN.md` section 7

- [ ] **Step 1: Terraform**: `variable "pilot_enabled" (bool, default false)`, `variable "pilot_image"`; `resource "google_firestore_database" "pilot"` and `resource "google_cloud_run_v2_service" "pilot"` with `count = var.pilot_enabled ? 1 : 0`, same template as `api` except name `sagi-shield-pilot`, env `FIRESTORE_DB=pilot`, no `BQ_TABLE`; public invoker binding; output `pilot_url`. Run `terraform fmt -recursive; terraform init -backend=false; terraform validate` in `infra/terraform` → clean.
- [ ] **Step 2: Docs**: CLAUDE.md gets a paragraph "Environments (2026-10-xx)": `sagi-shield-api` = judged / production, deployed from `main` by `deploy.yml`, frozen until 2026-11-07; `sagi-shield-pilot` = pilot, deployed from `pilot` by `deploy-pilot.yml`, database `pilot`, no analytics, phishing list loaded by hand; after the freeze, `deploy.yml` becomes a caller of `_deploy-service.yml` (one follow-up commit). ROADMAP phase 0 gains "step 0b, done <date>: pilot environment" and the exit criteria say the three households run on the pilot URL. PLAN section 7 gets one line pointing at the environments paragraph.
- [ ] **Step 3: Commit** `git commit -m "Terraform: optional pilot service; docs name the two environments"`

---

## Self-review notes

- Coverage of the owner's requirement: judged URL untouched (no change to `deploy.yml`, no `main` push, separate image name, phish job skipped, separate database so reports and stats from relatives never reach the judged app); fast path for the roadmap (the households plan deploys to the pilot URL by pushing `pilot`).
- Order of execution: Task 3 → 1 → 2 → 4 → 5 → 6 avoids the red first run; Task 2's step 3 says so.
- Known gap left on purpose: pilot has no analytics and no scheduled phishing reload; both return in roadmap step 3.
- Names: `_deploy-service.yml` inputs (`service`, `image_name`, `ref`, `environment`, `firestore_db`, `bq_table`, `env_label`, `update_phish_job`), env `FIRESTORE_DB`, `VITE_ENV_LABEL`, `envLabel`.
