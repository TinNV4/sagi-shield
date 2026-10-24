# Households and Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `family_id` bearer secret with Firebase-authenticated principals (member device, guardian, admin) and a `household` that a guardian can own, share and delete, so relatives can be given the app.

**Architecture:** The PWA signs the protected person's device in anonymously and guardians with Google or phone number (Firebase Authentication, JS SDK already in the bundle); every request that touches a household carries the Firebase ID token as `Authorization: Bearer`. A new `app/auth.py` verifies tokens with `firebase-admin` and yields a `Principal` whose role is derived from the sign-in provider and an `admin` custom claim; `app/households.py` holds the routes, `storage.py` gains a household model next to the old family one. The old `/family/*` routes stay for two weeks behind `LEGACY_FAMILY=1`, then are deleted. Tests stub the verifier the way `tests/test_appcheck.py` stubs App Check.

**Tech Stack:** FastAPI, pydantic 2, firebase-admin 7.7 (`auth.verify_id_token`, `auth.set_custom_user_claims`), google-cloud-firestore, React 19 + Vite, `firebase` 13 (`firebase/auth`), vitest.

**Spec:** `docs/ROADMAP.md` section 4, step 1 ("accounts and roles"), plus the decisions table in section 8. The spec's **[decided]** items are the owner's; **[my call]** items may be revisited with the owner, never silently.

## Global Constraints

- All code, comments, docs and commit messages in English; UI strings in ja / vi / en, with every key present in all three (`frontend/src/i18n/keys.test.ts` enforces parity).
- The protected person's device never logs in with an email or password; it signs in anonymously and pairs by 6-digit code / QR (spec, decided).
- No `family_id` or `household_id` in a URL query string or fragment, except the household id as a REST path segment behind an `Authorization` header. The QR keeps carrying only the 6-digit code in the fragment (`/#pair=123456`).
- Never store raw audio, transcripts, or a phone number in clear; alerts stay a summary sentence of at most 300 chars (existing `_alert`).
- Google stack only: Firebase Authentication, no third-party identity provider, no own password store.
- Model IDs stay in `backend/core/model_ids.py`; this plan adds none.
- Backend tests run offline with `USE_LLM=0 STORE=memory RATE_LIMIT_PER_MIN=0 VERDICT_STDOUT=0` (`tests/conftest.py`); add `AUTH=fake` there.
- Frontend `npm` runs through PowerShell on this machine; `npm run lint` is `tsc`, `npm test` is vitest.
- Commit messages: no AI attribution trailer in this repository (owner's rule).

## Review Focus

Inputs the spec implies but no task's tests would otherwise exercise, most likely to bite first:

1. A guardian's ID token is expired or revoked mid-session (phone left open overnight): the API answers 401 with a sentence, the PWA refreshes the token once and retries, and the dashboard never shows a fabricated empty state as "no alerts". Test added in Task 3 (expired → 401) and Task 10 (`request()` retries once on 401).
2. A guardian scans a second household's QR while already in one: they join the second, `GET /household` lists both, alerts are read per household. Test in Task 6.
3. The last owner tries to leave or remove themself: refused 409; an admin can reassign the owner. Test in Task 7.
4. A member device whose household was deleted keeps sending Live Guard lines: the socket still works and warns the person on the phone; only the family alert is skipped. Test in Task 8.
5. A request with a syntactically valid token for a different Firebase project, or an anonymous token on a guardian-only route: 401 / 403, never a 500 and never treated as a member. Test in Task 3.

---

## File map

- Create `backend/app/auth.py`: token verification, `Principal`, FastAPI dependencies.
- Create `backend/app/households.py`: `/household/*` and `/admin/household/*` routes (APIRouter), `resolve_household()` helper used by live.py and agent.py.
- Modify `backend/app/storage.py`: household methods on `MemoryStore` and `FirestoreStore`, `HouseholdId` type.
- Modify `backend/app/notifier.py`: `alert_household(household_id, result, lang)` beside `alert_family`.
- Modify `backend/app/main.py`: include the router, gate `/family/*` behind `LEGACY_FAMILY`.
- Modify `backend/app/live.py`: `?token=` → household via `auth`, replaces `?family_id=`.
- Modify `backend/app/agent.py`: `household_id` in state, resolved from the request's token; `notify_guardian` uses it.
- Create `backend/tests/test_auth.py`, `backend/tests/test_household.py`; modify `tests/conftest.py`, `tests/test_family.py`, `tests/test_agent.py`.
- Create `backend/tools/grant_admin.py`, `infra/setup_auth.ps1`.
- Create `frontend/src/lib/auth.ts` (+ `auth.test.ts`); modify `frontend/src/api/client.ts` (+ `MockApi`), `frontend/src/pages/FamilyScreen.tsx`, `frontend/src/pages/GuardianViewScreen.tsx`, `frontend/src/i18n/{ja,vi,en}.json`.
- Modify `CLAUDE.md`, `docs/PLAN.md` section 9 (API contract), `.env.example`, `.github/workflows/deploy.yml`, `infra/deploy.sh`.

## Data model (shared by every task)

`households/{household_id}` (Firestore document; `MemoryStore.households` dict):

```
household_id   secrets.token_urlsafe(16)            # path segment, never a credential
name           str ≤ 40                              # "Grandma's house"; empty allowed
member_name    str ≤ 40                              # protected person's first name
market         "ja" | "vi"
devices        list[str]                             # anonymous Firebase uids of member devices (0..n)
guardians      list[{uid: str, name: str ≤ 40, owner: bool, fcm_token: str | None}]
push_tokens    list[str]                             # ≤ 10, newest last (reuse _with_token)
pair_code      "%06d"; code_expires: float epoch     # 15 min, single use (reuse PAIR_CODE_TTL_S)
live_guard_enabled  bool, default False              # roadmap step 2 reads it; this plan only stores it
created_at     ISO-8601 UTC
```

`households/{household_id}/alerts/{id}`: unchanged `_alert` shape.

`Principal` (`app/auth.py`):

```python
@dataclass(frozen=True)
class Principal:
    uid: str
    role: Literal["device", "guardian", "admin"]   # anonymous → device; google.com / phone → guardian; claim admin=True → admin
    name: str = ""                                  # token `name` claim, ≤ 40, may be empty
```

Roles compose: an admin is also allowed wherever a guardian is, for households they belong to only (spec: admin sees no household they are not a guardian of). A device is never allowed on guardian-only routes.

---

### Task 1: Household storage (memory and Firestore)

**Files:**
- Modify: `backend/app/storage.py` (after the family block in each class)
- Test: `backend/tests/test_household_store.py`

**Interfaces:**
- Produces, on both stores:
  - `create_household(name: str, member_name: str, market: str, creator: Principal | None) -> dict` (creator role device → appended to `devices`; guardian/admin → `guardians` with `owner=True`; None → nobody yet)
  - `get_household(household_id: str) -> dict | None`
  - `households_for(uid: str) -> list[dict]` (devices or guardians containing uid)
  - `refresh_household_code(household_id: str) -> dict | None`
  - `join_household(pair_code: str, principal: Principal, fcm_token: str | None) -> dict | None` (device → devices, deduplicated; guardian → guardians, `owner = not any existing owner`; code consumed)
  - `remove_guardian(household_id: str, uid: str) -> bool`
  - `set_owner(household_id: str, uid: str) -> bool` (uid must already be a guardian; exactly one owner afterwards)
  - `delete_household(household_id: str) -> bool` (document and its alerts subcollection)
  - `add_household_push_token(household_id, token) -> bool`, `add_household_alert(household_id, risk_level, scam_type, stage, summary) -> dict | None`, `list_household_alerts(household_id) -> list[dict]`
- `HouseholdId = Annotated[str, Field(max_length=40, pattern=r"^[A-Za-z0-9_-]+$")]`

- [ ] **Step 1: Write the failing tests** (`MemoryStore` only; Firestore has no emulator in CI)

```python
from app.auth import Principal
from app.storage import MemoryStore

DEV, GUARD, GUARD2 = Principal("dev1", "device"), Principal("g1", "guardian", "Taro"), Principal("g2", "guardian", "Hana")

def test_device_creates_and_first_guardian_becomes_owner():
    s = MemoryStore()
    h = s.create_household("", "Mom", "ja", DEV)
    assert h["devices"] == ["dev1"] and h["guardians"] == [] and len(h["pair_code"]) == 6
    assert s.join_household(h["pair_code"], GUARD, "tok")["guardians"] == [{"uid": "g1", "name": "Taro", "owner": True, "fcm_token": "tok"}]
    assert s.join_household(h["pair_code"], GUARD2, None) is None          # single use
    h2 = s.refresh_household_code(h["household_id"])
    assert s.join_household(h2["pair_code"], GUARD2, None)["guardians"][1]["owner"] is False
    assert [x["household_id"] for x in s.households_for("g1")] == [h["household_id"]]

def test_guardian_creates_then_device_joins_without_duplicates():
    s = MemoryStore()
    h = s.create_household("Grandma", "Mom", "vi", GUARD)
    assert h["guardians"][0]["owner"] is True and h["devices"] == []
    s.join_household(h["pair_code"], DEV, None)
    s.join_household(s.refresh_household_code(h["household_id"])["pair_code"], DEV, None)
    assert s.get_household(h["household_id"])["devices"] == ["dev1"]

def test_owner_reassignment_and_removal():
    s = MemoryStore()
    h = s.create_household("", "", "ja", GUARD)
    s.join_household(h["pair_code"], GUARD2, None)
    assert s.set_owner(h["household_id"], "g2") and [g["owner"] for g in s.get_household(h["household_id"])["guardians"]] == [False, True]
    assert s.set_owner(h["household_id"], "nobody") is False
    assert s.remove_guardian(h["household_id"], "g1") and len(s.get_household(h["household_id"])["guardians"]) == 1

def test_delete_removes_alerts_too():
    s = MemoryStore()
    h = s.create_household("", "Mom", "ja", DEV)
    s.add_household_alert(h["household_id"], "HIGH", "fake_police", 4, "summary")
    assert s.delete_household(h["household_id"]) and s.get_household(h["household_id"]) is None
    assert s.list_household_alerts(h["household_id"]) == [] and s.delete_household(h["household_id"]) is False
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_household_store.py -q`
Expected: FAIL, `ImportError` on `app.auth` (created in Task 2; for this task add the `Principal` dataclass to `app/auth.py` with nothing else).

- [ ] **Step 3: Implement** `_new_household()` next to `_new_family()`, the methods above on `MemoryStore` (`self.households: dict`, `self.household_alerts: dict`) and on `FirestoreStore` (collection `households`, alerts as subcollection; `households_for` = two `array_contains` queries on `devices` and on a mirrored `guardian_uids: list[str]` field kept in sync by join / remove, because Firestore cannot `array_contains` on a dict field; `delete_household` deletes the alerts subcollection documents in a batch first). `MAX_HOUSEHOLD_GUARDIANS = 10`, `MAX_HOUSEHOLD_DEVICES = 5`; `join_household` returns `None` when full.

- [ ] **Step 4: Run tests** → PASS; also `python -m pytest tests -q` stays green.

- [ ] **Step 5: Commit** `git commit -m "Storage: household model beside the family model"`

---

### Task 2: Token verification and principals

**Files:**
- Create: `backend/app/auth.py`
- Modify: `backend/tests/conftest.py` (add `AUTH="fake"`)
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- `mode() -> Literal["firebase", "fake", "off"]` from env `AUTH` (default `firebase`; `fake` only honoured when `STORE != "firestore"`, otherwise logged and treated as `firebase`).
- `verify(token: str) -> Principal` raises `AuthError(status: int, detail: str)`: 401 `"sign-in expired, please sign in again"` for invalid / expired / wrong project; 401 `"sign-in required"` for missing.
- Fake tokens (tests, local dev): `fake:<uid>:<provider>` with provider in `anonymous | google.com | phone`; `fake:<uid>:<provider>:admin` sets the admin role; anything else is invalid.
- Firebase path: `firebase_admin.auth.verify_id_token(token, app=appcheck._app(), check_revoked=False)`; role from `claims["firebase"]["sign_in_provider"]` (`anonymous` → device, else guardian) and `claims.get("admin") is True` → admin; `name = (claims.get("name") or "")[:40]`.
- FastAPI dependencies: `principal(request: Request) -> Principal` (reads `Authorization: Bearer <token>`), `guardian_or_admin(p = Depends(principal))` (403 `"a signed-in guardian is needed here"` for a device), `admin_only(...)` (403).
- `principal_from_query(token: str | None) -> Principal | None` for the WebSocket (returns None instead of raising; the socket must not refuse a scared caller).

- [ ] **Step 1: Write the failing tests**

```python
import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from app import auth

def test_fake_tokens_map_to_roles(monkeypatch):
    monkeypatch.setenv("AUTH", "fake")
    assert auth.verify("fake:d1:anonymous") == auth.Principal("d1", "device")
    assert auth.verify("fake:g1:google.com").role == "guardian"
    assert auth.verify("fake:a1:phone:admin").role == "admin"
    with pytest.raises(auth.AuthError) as e:
        auth.verify("fake:x")
    assert e.value.status == 401

def test_fake_mode_is_refused_on_firestore(monkeypatch):
    monkeypatch.setenv("AUTH", "fake"); monkeypatch.setenv("STORE", "firestore")
    assert auth.mode() == "firebase"

def test_firebase_claims_are_mapped(monkeypatch):
    monkeypatch.setenv("AUTH", "firebase")
    claims = {"uid": "u1", "name": "Taro Yamada", "firebase": {"sign_in_provider": "google.com"}}
    monkeypatch.setattr(auth, "_verify_firebase", lambda token: claims)
    assert auth.verify("x") == auth.Principal("u1", "guardian", "Taro Yamada")
    monkeypatch.setattr(auth, "_verify_firebase", lambda token: {**claims, "admin": True})
    assert auth.verify("x").role == "admin"

def test_dependencies(monkeypatch):
    monkeypatch.setenv("AUTH", "fake")
    app = FastAPI()
    @app.get("/who")
    def who(p: auth.Principal = Depends(auth.principal)): return p.role
    @app.get("/g")
    def g(p: auth.Principal = Depends(auth.guardian_or_admin)): return p.role
    @app.get("/a")
    def a(p: auth.Principal = Depends(auth.admin_only)): return p.role
    c = TestClient(app)
    assert c.get("/who").status_code == 401
    assert c.get("/who", headers={"Authorization": "Bearer fake:d:anonymous"}).json() == "device"
    assert c.get("/g", headers={"Authorization": "Bearer fake:d:anonymous"}).status_code == 403
    assert c.get("/g", headers={"Authorization": "Bearer fake:g:phone"}).status_code == 200
    assert c.get("/a", headers={"Authorization": "Bearer fake:g:phone"}).status_code == 403
    assert c.get("/a", headers={"Authorization": "Bearer fake:g:phone:admin"}).status_code == 200
    assert c.get("/who", headers={"Authorization": "Bearer nonsense"}).status_code == 401
```

- [ ] **Step 2: Run** `python -m pytest tests/test_auth.py -q` → FAIL (`mode`, `verify` undefined).
- [ ] **Step 3: Implement `app/auth.py`** as specified. `_verify_firebase(token) -> dict` wraps the SDK call and turns `ValueError`, `auth.ExpiredIdTokenError`, `auth.RevokedIdTokenError`, `auth.InvalidIdTokenError` into `AuthError(401, ...)`, any other exception into `AuthError(503, "sign-in could not be checked, try again")`. `AuthError` is converted by an `@app.exception_handler` registered in `main.py` (Task 5) and by `HTTPException` in the dependencies.
- [ ] **Step 4: Run** → PASS. Add `AUTH="fake"` to `tests/conftest.py`'s `os.environ.update`.
- [ ] **Step 5: Commit** `git commit -m "Auth: Firebase ID tokens become device / guardian / admin principals"`

---

### Task 3: Token edge cases (Review Focus 1 and 5)

**Files:**
- Test: `backend/tests/test_auth.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_expired_and_foreign_tokens_are_401_never_500(monkeypatch):
    monkeypatch.setenv("AUTH", "firebase")
    from firebase_admin import auth as fb
    def boom(token):
        raise fb.ExpiredIdTokenError("expired", cause=None)
    monkeypatch.setattr(auth, "_verify_firebase_raw", boom)
    with pytest.raises(auth.AuthError) as e:
        auth.verify("t")
    assert e.value.status == 401 and "sign in again" in e.value.detail
    monkeypatch.setattr(auth, "_verify_firebase_raw", lambda t: (_ for _ in ()).throw(ValueError("wrong aud")))
    assert pytest.raises(auth.AuthError, auth.verify, "t").value.status == 401

def test_anonymous_token_is_a_device_even_with_a_name_claim(monkeypatch):
    monkeypatch.setenv("AUTH", "firebase")
    monkeypatch.setattr(auth, "_verify_firebase", lambda t: {"uid": "d", "name": "x", "firebase": {"sign_in_provider": "anonymous"}, "admin": True})
    assert auth.verify("t") == auth.Principal("d", "device", "x")   # admin claim on an anonymous user is ignored
```

- [ ] **Step 2: Run** → FAIL (`_verify_firebase_raw` missing).
- [ ] **Step 3: Split** `_verify_firebase` into `_verify_firebase_raw(token) -> dict` (the SDK call) and the mapping; ignore `admin` unless the provider is not `anonymous`.
- [ ] **Step 4: Run** `python -m pytest tests/test_auth.py -q` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Auth: expired or foreign tokens answer 401; anonymous users are never admin"`

---

### Task 4: Household routes

**Files:**
- Create: `backend/app/households.py`
- Modify: `backend/app/notifier.py` (add `alert_household`)
- Test: `backend/tests/test_household.py`

**Interfaces (all JSON, all need `Authorization: Bearer` unless noted):**

```
POST   /household                  {name?, member_name?, market}        any role      → {household_id, pair_code, expires_in: 900, household}
POST   /household/{id}/code        {}                                   member*       → {pair_code, expires_in}
POST   /household/join             {pair_code, name?, fcm_token?}       any role      → {household}
GET    /household                                                       any role      → [household...]  (fields below)
GET    /household/{id}/alerts                                           member*       → [alert...]
POST   /household/{id}/push        {fcm_token}                          guardian*     → {ok}
POST   /household/{id}/notify      {risk_level, scam_type?, stage?, reasons?, lang}  member* → {ok, id}
DELETE /household/{id}/guardians/{uid}                                  owner, or the guardian themself (not the owner) → {ok}
DELETE /household/{id}                                                  owner         → {ok}
```

`member*` = the caller's uid is in `devices` or `guardians` of that household; `guardian*` = in `guardians`. 403 `"not a member of this household"`, 404 `"unknown household"`, 409 `"the owner cannot leave; hand the household to another guardian first"`. Public shape of a household (the `household` field and the list): `{household_id, name, member_name, market, live_guard_enabled, devices: int, guardians: [{name, owner, me: bool}], created_at}` — never uids or tokens.

- `households.py` also exports `resolve_household(principal: Principal | None) -> str | None`: the single household id of a device (first of `households_for`), used by live.py and agent.py.
- `notifier.alert_household(household_id: str | None, result: dict, lang: str) -> dict | None`: same body as `alert_family` over the household methods; the FCM token list = guardians' `fcm_token` + `push_tokens`.

- [ ] **Step 1: Write the failing tests** (fixture like `test_family.py`'s: `main.store.__init__()`, `TestClient(main.app)`; helper `H(tok) = {"Authorization": f"Bearer fake:{tok}"}`)

```python
DEV, G1, G2 = "d1:anonymous", "g1:google.com", "g2:phone"

def test_device_starts_household_guardian_joins_and_reads_alerts(client):
    h = client.post("/household", json={"member_name": "Mom", "market": "ja"}, headers=H(DEV)).json()
    assert h["household"]["devices"] == 1 and h["household"]["guardians"] == []
    j = client.post("/household/join", json={"pair_code": h["pair_code"], "name": "Taro", "fcm_token": "t"}, headers=H(G1))
    assert j.status_code == 200 and j.json()["household"]["guardians"] == [{"name": "Taro", "owner": True, "me": True}]
    hid = h["household_id"]
    assert client.get(f"/household/{hid}/alerts", headers=H(G1)).json() == []
    assert client.get(f"/household/{hid}/alerts", headers=H(G2)).status_code == 403
    assert client.get(f"/household/{hid}/alerts").status_code == 401
    sent = client.post(f"/household/{hid}/notify", json={"risk_level": "HIGH", "scam_type": "fake_police", "stage": 4,
                       "reasons": ["警察を名乗り…"], "lang": "ja"}, headers=H(DEV))
    assert sent.status_code == 200
    alerts = client.get(f"/household/{hid}/alerts", headers=H(G1)).json()
    assert alerts[0]["summary"] == "警察を名乗り…" and alerts[0]["member_name"] == "Mom"
    assert "uid" not in str(client.get("/household", headers=H(G1)).json())

def test_guardian_starts_household_device_joins(client):
    h = client.post("/household", json={"name": "Grandma", "market": "vi"}, headers=H(G1)).json()
    assert h["household"]["guardians"][0]["owner"] is True
    assert client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(DEV)).json()["household"]["devices"] == 1
    assert client.get("/household", headers=H(DEV)).json()[0]["household_id"] == h["household_id"]

def test_wrong_or_used_code_is_404_and_code_refresh_needs_membership(client):
    h = client.post("/household", json={"market": "ja"}, headers=H(DEV)).json()
    assert client.post("/household/join", json={"pair_code": "000000"}, headers=H(G1)).status_code == 404
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1))
    assert client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G2)).status_code == 404
    assert client.post(f"/household/{h['household_id']}/code", json={}, headers=H(G2)).status_code == 403
    fresh = client.post(f"/household/{h['household_id']}/code", json={}, headers=H(G1)).json()
    assert len(fresh["pair_code"]) == 6 and fresh["pair_code"] != h["pair_code"]

def test_market_is_validated(client):
    assert client.post("/household", json={"market": "en"}, headers=H(DEV)).status_code == 422

def test_push_is_guardian_only_and_delete_is_owner_only(client):
    h = client.post("/household", json={"market": "ja"}, headers=H(DEV)).json(); hid = h["household_id"]
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1))
    assert client.post(f"/household/{hid}/push", json={"fcm_token": "x"}, headers=H(DEV)).status_code == 403
    assert client.post(f"/household/{hid}/push", json={"fcm_token": "x"}, headers=H(G1)).status_code == 200
    assert client.delete(f"/household/{hid}", headers=H(DEV)).status_code == 403
    assert client.delete(f"/household/{hid}", headers=H(G1)).status_code == 200
    assert client.get(f"/household/{hid}/alerts", headers=H(G1)).status_code == 404
```

- [ ] **Step 2: Run** `python -m pytest tests/test_household.py -q` → FAIL 404 (routes missing).
- [ ] **Step 3: Implement `app/households.py`** (`router = APIRouter()`), request models with `market: Literal["ja", "vi"]`, `name`/`member_name` ≤ 40, `pair_code` digits-only normalisation as in `family_link`; `_member(store, hid, p) -> dict` helper raising 404/403; include the router in `main.py` (`app.include_router(households.router)`) and register the `AuthError` handler. Write `alert_household` in `notifier.py` by extracting the FCM send into `_push(tokens, lang, summary, alert)` shared with `alert_family`. `/household/{id}/notify` calls `alert_household` and logs `log_event("notify", ...)` with aggregate fields only.
- [ ] **Step 4: Run** `python -m pytest tests -q` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Households: create, pair, read alerts, push and delete behind Firebase sign-in"`

---

### Task 5: Legacy family routes behind a flag

**Files:**
- Modify: `backend/app/main.py` (family routes), `backend/tests/test_family.py`, `backend/tests/conftest.py`
- Modify: `CLAUDE.md` (one line), `docs/PLAN.md` section 9

**Interfaces:**
- Env `LEGACY_FAMILY` (default `"1"` until 2026-11-14, when Task 13 deletes the routes): when `"0"`, every `/family/*` route and the socket's `?family_id=` answer 410 `"this version of the app is outdated; reload to update"`.

- [ ] **Step 1: Write the failing test** in `tests/test_family.py`

```python
def test_legacy_routes_can_be_switched_off(client, monkeypatch):
    monkeypatch.setenv("LEGACY_FAMILY", "0")
    assert client.post("/family/code", json={}).status_code == 410
    assert client.get("/family/alerts", params={"family_id": "x"}).status_code == 410
```

- [ ] **Step 2: Run** → FAIL (200 / 404).
- [ ] **Step 3: Implement** `legacy_family_enabled() -> bool` in `main.py`; a `Depends(require_legacy_family)` on the five `/family/*` routes. Add `LEGACY_FAMILY="1"` to `conftest.py` so the existing family tests keep passing. In CLAUDE.md's `backend/app/` paragraph add: "`/household/*` (Firebase sign-in, `app/auth.py`) replaces `/family/*`; the old routes live behind `LEGACY_FAMILY=1` until 2026-11-14." In PLAN section 9 list the household routes from Task 4 and mark the family routes deprecated.
- [ ] **Step 4: Run** `python -m pytest tests -q` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Family routes: deprecated behind LEGACY_FAMILY, removed 2026-11-14"`

---

### Task 6: One guardian, several households (Review Focus 2)

**Files:**
- Test: `backend/tests/test_household.py`

- [ ] **Step 1: Write the failing test**

```python
def test_a_guardian_watches_two_households(client):
    a = client.post("/household", json={"member_name": "Mom", "market": "ja"}, headers=H("da:anonymous")).json()
    b = client.post("/household", json={"member_name": "Dad", "market": "ja"}, headers=H("db:anonymous")).json()
    for h in (a, b):
        assert client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1)).status_code == 200
    mine = client.get("/household", headers=H(G1)).json()
    assert sorted(x["member_name"] for x in mine) == ["Dad", "Mom"]
    client.post(f"/household/{b['household_id']}/notify", json={"risk_level": "HIGH", "lang": "ja"}, headers=H("db:anonymous"))
    assert client.get(f"/household/{a['household_id']}/alerts", headers=H(G1)).json() == []
    assert len(client.get(f"/household/{b['household_id']}/alerts", headers=H(G1)).json()) == 1
```

- [ ] **Step 2: Run** → expected to PASS already if Task 4 was implemented per spec; if it FAILS, fix `households_for` / membership checks until it passes.
- [ ] **Step 3: Commit** `git commit -m "Households: a guardian may watch several households"`

---

### Task 7: Owner handover and the admin reassignment route (Review Focus 3)

**Files:**
- Modify: `backend/app/households.py`
- Test: `backend/tests/test_household.py`

**Interfaces:**
- `POST /household/{id}/owner {uid}` → owner only; target must be a guardian of the household → `{ok}`.
- `POST /admin/household/{id}/owner {uid}` → `admin_only`; same body; the admin need not be a member (the one admin route that crosses households; it changes ownership, reveals nothing) → `{ok}`.
- Public household shape gains `guardians[].uid` **only** in the response of `GET /household/{id}` for guardians of that household (needed to pick a new owner); the list route stays uid-free.

- [ ] **Step 1: Write the failing tests**

```python
def test_owner_cannot_leave_but_can_hand_over(client):
    h = client.post("/household", json={"market": "ja"}, headers=H(G1)).json(); hid = h["household_id"]
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G2))
    assert client.delete(f"/household/{hid}/guardians/g1", headers=H(G1)).status_code == 409
    assert client.delete(f"/household/{hid}/guardians/g1", headers=H(G2)).status_code == 403    # not the owner
    assert client.post(f"/household/{hid}/owner", json={"uid": "g2"}, headers=H(G2)).status_code == 403
    assert client.post(f"/household/{hid}/owner", json={"uid": "g2"}, headers=H(G1)).status_code == 200
    assert client.delete(f"/household/{hid}/guardians/g1", headers=H(G1)).status_code == 200      # now a plain guardian leaving
    detail = client.get(f"/household/{hid}", headers=H(G2)).json()
    assert detail["guardians"] == [{"uid": "g2", "name": "", "owner": True, "me": True}]

def test_admin_reassigns_a_lost_owner(client):
    h = client.post("/household", json={"market": "ja"}, headers=H(G1)).json(); hid = h["household_id"]
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G2))
    assert client.post(f"/admin/household/{hid}/owner", json={"uid": "g2"}, headers=H(G2)).status_code == 403
    assert client.post(f"/admin/household/{hid}/owner", json={"uid": "g2"}, headers=H("root:google.com:admin")).status_code == 200
    assert client.post(f"/admin/household/{hid}/owner", json={"uid": "zz"}, headers=H("root:google.com:admin")).status_code == 404
    assert client.get(f"/household/{hid}/alerts", headers=H("root:google.com:admin")).status_code == 403  # admin is not a member
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the two routes and `GET /household/{id}`; the 409 in the guardian-removal route when the target is the sole owner.
- [ ] **Step 4: Run** `python -m pytest tests -q` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Households: owner handover; admin can reassign a lost owner"`

---

### Task 8: Live Guard socket takes a sign-in token (Review Focus 4)

**Files:**
- Modify: `backend/app/live.py:56-80, 131-133`
- Test: `backend/tests/test_live.py` or `tests/test_household.py`

**Interfaces:**
- Query `?token=<ID token>` replaces `?family_id=`; `household_id = resolve_household(principal_from_query(token))`. No token, bad token, or a device in no household → `household_id = None`: the socket runs, speaks the warning, and skips the family alert. `?family_id=` keeps working while `legacy_family_enabled()`.
- First HIGH → `alert_household(household_id, ...)` (falls back to `alert_family(family_id, ...)` for the legacy query).

- [ ] **Step 1: Write the failing test** (use the HIGH script from `test_family.py::test_live_high_alerts_the_family_once_and_stores_no_transcript`)

```python
def test_live_high_alerts_the_household_once_and_survives_deletion(client):
    h = client.post("/household", json={"member_name": "Mom", "market": "ja"}, headers=H(DEV)).json(); hid = h["household_id"]
    client.post("/household/join", json={"pair_code": h["pair_code"]}, headers=H(G1))
    with client.websocket_connect("/ws/live?lang=ja&token=fake:d1:anonymous") as ws:
        for line in SCAM_LINES: ws.send_json({"type": "final", "text": line}); ws.receive_json()
    alerts = client.get(f"/household/{hid}/alerts", headers=H(G1)).json()
    assert len(alerts) == 1 and alerts[0]["risk_level"] == "HIGH" and SCAM_LINES[0] not in str(alerts)
    client.delete(f"/household/{hid}", headers=H(G1))
    with client.websocket_connect("/ws/live?lang=ja&token=fake:d1:anonymous") as ws:   # orphaned device: still warns
        for line in SCAM_LINES: ws.send_json({"type": "final", "text": line}); last = ws.receive_json()
    assert last["risk_level"] == "HIGH"

def test_live_with_a_bad_token_still_runs(client):
    with client.websocket_connect("/ws/live?lang=ja&token=garbage") as ws:
        ws.send_json({"type": "final", "text": "もしもし"}); assert ws.receive_json()["risk_level"] == "LOW"
```

- [ ] **Step 2: Run** → FAIL (no alert stored).
- [ ] **Step 3: Implement** in `live.py`: read `token`, resolve once at connect time (a `to_thread` call: verification may hit the network), keep `household_id` in `state`; the HIGH branch calls `alert_household`. `verdict_log` and `analytics` receive no household id (unchanged).
- [ ] **Step 4: Run** `python -m pytest tests -q` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Live Guard: the socket identifies the household by sign-in token, never by a shared secret"`

---

### Task 9: Recovery agent notifies the household

**Files:**
- Modify: `backend/app/agent.py` (`new_state`, `notify_guardian`, `RecoveryIn`, `recovery`)
- Test: `backend/tests/test_agent.py`

**Interfaces:**
- `/agent/recovery` reads an optional `Authorization: Bearer` header (dependency `auth.optional_principal(request) -> Principal | None`, add to `auth.py`); `state["household_id"] = resolve_household(principal) or state.get("household_id")`. The body's `family_id` stays accepted while `legacy_family_enabled()`.
- `notify_guardian` uses `st["household_id"]` via `STORE.add_household_alert`, then `st["family_id"]` as the legacy fallback; the instruction text says "family paired = {bool(household or family)}".
- State never holds the token.

- [ ] **Step 1: Write the failing test** (mirror `test_notify_guardian_needs_a_paired_family_and_fires_once` and `test_family_id_is_kept_with_the_session`)

```python
def test_notify_guardian_uses_the_household_from_the_token(client, monkeypatch):
    h = client.post("/household", json={"member_name": "Mom", "market": "ja"}, headers=H(DEV)).json()
    seen = {}
    monkeypatch.setattr(agent, "run_agent", fake_run_agent_recording(seen))   # same helper the existing test uses
    ask(client, "hello", headers=H(DEV))
    assert seen["household_id"] == h["household_id"] and "token" not in str(seen)
    ask(client, "next turn")                                                    # header missing later: state keeps it
    assert seen["household_id"] == h["household_id"]
    Ctx.state = {**agent.new_state(), "household_id": h["household_id"]}
    assert agent.notify_guardian("paid a fake police caller", Ctx)["status"] == "ok"
    assert client.get(f"/household/{h['household_id']}/alerts", headers=H(DEV)).json()[0]["scam_type"] == "recovery"
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** as specified; `household_id: None` added to `new_state()`.
- [ ] **Step 4: Run** `python -m pytest tests -q` → PASS; also `python tools/eval_agent.py` is **not** run here (paid); note it in the commit body.
- [ ] **Step 5: Commit** `git commit -m "Recovery agent: notify_guardian reaches the signed-in device's household"`

---

### Task 10: Frontend sign-in and authenticated requests

**Files:**
- Create: `frontend/src/lib/auth.ts`, `frontend/src/lib/auth.test.ts`
- Modify: `frontend/src/api/client.ts` (`request()`, new household methods, `MockApi` parity), `frontend/src/api/types.ts` (or wherever `FamilyAlertItem` lives: add `Household`)

**Interfaces (`auth.ts`):**
- `authEnabled: boolean` (= `firebaseConfigured`).
- `ensureDeviceSignIn(): Promise<string | null>` → `signInAnonymously` once, returns uid; null when Firebase is not configured or fails (the app keeps working without a household).
- `signInGuardian(method: 'google' | 'phone', phone?: string): Promise<GuardianSession | null>`; phone uses `signInWithPhoneNumber` with an invisible `RecaptchaVerifier` on a container id `recaptcha-container`, and `confirmPhoneCode(code: string)` finishes it.
- `signOut(): Promise<void>`, `currentUser(): {uid, anonymous: boolean, name: string} | null`, `onAuth(cb)`.
- `idToken(force = false): Promise<string | null>` with a 3 s timeout like `appCheckToken`.
- `request()` in `client.ts` adds `Authorization: Bearer <idToken()>` when a user is signed in; on a 401 it calls `idToken(true)` once and retries once (Review Focus 1), then throws `ApiError('failed', detail, 401)`.
- `Api` interface gains: `createHousehold(input: {name?: string; member_name?: string; market: 'ja'|'vi'}): Promise<HouseholdCreated>`, `joinHousehold(code: string, name?: string, fcmToken?: string): Promise<Household>`, `myHouseholds(): Promise<Household[]>`, `householdCode(id): Promise<{pair_code: string; expires_in: number}>`, `householdAlerts(id): Promise<FamilyAlertItem[]>`, `registerHouseholdPush(id, token)`, `notifyHousehold(id, result, lang)`, `removeGuardian(id, uid)`, `deleteHousehold(id)`, `handOver(id, uid)`. `recovery()` and `connectLiveSocket()` stop sending `family_id`; the socket URL gets `&token=` from `idToken()` at connect time (and on every reconnect).
- `getFamilyId()` / `setFamilyId()` remain only for the legacy screens until Task 13; new code never calls them.

- [ ] **Step 1: Write the failing vitest** (`auth.test.ts`, mocking `firebase/auth` with `vi.mock`)

```ts
it('signs the device in anonymously once and returns the uid', async () => { /* signInAnonymously called once across two calls; uid returned */ });
it('returns null when Firebase is not configured', async () => { /* firebaseConfigured=false → ensureDeviceSignIn() === null, idToken() === null */ });
it('idToken gives up after 3 s and returns null', async () => { /* fake timers */ });
```

And in `client.test.ts` (exists? if not, create next to `appCheck.test.ts`): `it('retries once with a fresh token on 401 then throws ApiError')` — mock `fetch` to answer 401 then 200, assert two calls and `Authorization` headers differ.

- [ ] **Step 2: Run** (PowerShell) `cd frontend; npm test` → FAIL.
- [ ] **Step 3: Implement** `auth.ts` and the `client.ts` changes; `MockApi` returns one fake household with two guardians (reuse the mock guardian i18n names) and implements every new method in memory.
- [ ] **Step 4: Run** `npm test; npm run lint` → PASS.
- [ ] **Step 5: Commit** `git commit -m "PWA: Firebase sign-in (anonymous device, Google / phone guardian) and authenticated API calls"`

---

### Task 11: Member-side Family screen on households

**Files:**
- Modify: `frontend/src/pages/FamilyScreen.tsx`, `frontend/src/i18n/{ja,vi,en}.json`

**Behaviour:**
- On mount: `ensureDeviceSignIn()`; `myHouseholds()`; if none → "Create" (one tap, `member_name` optional field, market = current UI market; `en` UI maps to `ja`, as `apiLang` does) then show the 6-digit code and QR (`/#pair=` unchanged). If one exists → show its code (`householdCode`) and the guardians list (names, owner mark). "Alert my family" toggle unchanged.
- If `ensureDeviceSignIn()` returns null → the screen explains pairing is unavailable on this build (`family.signin_unavailable`), no fake code.
- New i18n keys (all three files): `family.signin_unavailable`, `family.create_btn`, `family.member_name_label`, `family.owner_badge`.

- [ ] **Step 1: Write the failing test** (`FamilyScreen.test.tsx`, jsdom, mock `api`): renders the code from `householdCode()` when a household exists; renders the create button when none; renders `signin_unavailable` when sign-in returns null.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test; npm run lint` → PASS (`keys.test.ts` proves the three dictionaries match).
- [ ] **Step 5: Commit** `git commit -m "Family screen: the protected device signs in anonymously and owns a household"`

---

### Task 12: Guardian dashboard with sign-in and several households

**Files:**
- Modify: `frontend/src/pages/GuardianViewScreen.tsx`, `frontend/src/i18n/{ja,vi,en}.json`

**Behaviour:**
- Not signed in (or signed in anonymously): a sign-in card with "Continue with Google" and "Use my phone number" (phone input + code input; `recaptcha-container` div present). `PAIR_FROM_LINK` is kept across sign-in and used right after.
- Signed in: `myHouseholds()`; a household switcher (chips) when more than one; alerts of the selected household polled every 5 s as today; "Add a household" opens the 6-digit code input → `joinHousehold`. Push: `registerHouseholdPush(selected, token)`.
- Manage sheet per household (owner only sees the destructive items): guardians with "remove", "hand over" (pick a guardian), "Delete this household" with a confirm step that names `member_name`. A non-owner sees "Leave".
- Sign out in the sheet.
- i18n keys: `guardian.signin_title`, `guardian.signin_google`, `guardian.signin_phone`, `guardian.phone_label`, `guardian.code_label`, `guardian.add_household`, `guardian.manage`, `guardian.remove`, `guardian.hand_over`, `guardian.leave`, `guardian.delete_household`, `guardian.delete_confirm` (with `{name}`), `guardian.owner_cannot_leave`, `guardian.sign_out`, `guardian.session_expired`.

- [ ] **Step 1: Write the failing test** (`GuardianViewScreen.test.tsx`, mock `auth` and `api`): shows the sign-in card when `currentUser()` is null; after a mocked sign-in with two households shows two chips and the first household's alerts; `ApiError` with status 401 renders `session_expired`, never an empty "no alerts" state.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test; npm run lint; npm run build` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Guardian dashboard: sign in, watch several households, manage and delete"`

---

### Task 13: Infrastructure, admin grant and the removal date

**Files:**
- Create: `infra/setup_auth.ps1`, `backend/tools/grant_admin.py`
- Modify: `.env.example`, `infra/deploy.sh`, `.github/workflows/deploy.yml`, `infra/terraform/*` (mirror), `CLAUDE.md`, `docs/ROADMAP.md` (tick step 1)

- [ ] **Step 1: `infra/setup_auth.ps1`** (style of `setup_appcheck.ps1`): enable `identitytoolkit.googleapis.com`; through the Identity Toolkit admin REST API turn on the anonymous and Google providers and the phone provider (`projects/{project}/config` PATCH: `signIn.anonymous.enabled`, `signIn.phoneNumber.enabled`; Google provider via `defaultSupportedIdpConfigs`), add the Cloud Run service URL and `localhost` to authorized domains; grant `roles/firebaseauth.admin` to `sagi-api` (needed for `set_custom_user_claims` from `grant_admin.py` only if run on Cloud Run; locally it uses the operator's ADC). Print what it did. Verification step: `python backend/tools/grant_admin.py --list` shows no admin yet.
- [ ] **Step 2: `backend/tools/grant_admin.py`**: `--email <addr>` sets `{"admin": True}` on that Firebase user (`auth.get_user_by_email`, `auth.set_custom_user_claims`), `--revoke`, `--list` (iterate `auth.list_users()` and print uids with the claim; emails only with `--show-emails`). Refuses an anonymous user.
- [ ] **Step 3: Env plumbing**: `AUTH` (`firebase` | `fake` | `off`) and `LEGACY_FAMILY` travel in `deploy.sh` and `deploy.yml`'s env loop next to `APPCHECK`; `.env.example` documents `AUTH=fake` for local dev with `STORE=memory`. `AUTH=off` is only read by `mode()` as "no verification, every request is a nameless device" and is refused when `STORE=firestore` (same guard as `fake`).
- [ ] **Step 4: Docs**: CLAUDE.md gains a short paragraph "Accounts (2026-10-xx)": roles, fake tokens for tests, `grant_admin.py`, `LEGACY_FAMILY` removal date 2026-11-14. `docs/ROADMAP.md` step 1 checklist ticked with the date. Add a calendar line to ROADMAP phase 0 exit criteria: "2026-11-14: delete `/family/*`, `getFamilyId`, `LEGACY_FAMILY` (one commit)".
- [ ] **Step 5: Verify on Cloud Run** (after CI deploys `main`): `pwsh infra/setup_auth.ps1`; open the deployed PWA on the iPhone as guardian (Google sign-in), on the PC in Chrome as the device (anonymous), pair, send a `/household/{id}/notify` from the result screen, see the alert on the iPhone within 5 s; delete the household from the iPhone. Record the result in CLAUDE.md's known-gaps list.
- [ ] **Step 6: Commit** `git commit -m "Auth setup: Identity Toolkit providers, admin grant tool, env plumbing"`

---

## Self-review notes

- Spec coverage: model (Task 1), guardian sign-in and roles (2, 3), enforcement on every `/family/*` equivalent and the socket (4, 8), recovery agent (9), App Check kept as second signal (untouched), `family_id` removed from URLs (8, 10), migration window (5, 13), household deletion (4), owner recovery (7), pairing in both directions and zero-device households (1, 4), `live_guard_enabled` stored (1). Not in scope, by the spec: the single-screen member UI, heartbeat, admin page (roadmap step 2 and 3, separate plans).
- Names used consistently: `Principal`, `resolve_household`, `alert_household`, `households_for`, `join_household`, `set_owner`, `legacy_family_enabled`, `idToken`, `ensureDeviceSignIn`, `myHouseholds`.
- Proportion: the plan is about the length of the spec section it implements plus the test code; function bodies are left to the implementer except where a value is pinned.
