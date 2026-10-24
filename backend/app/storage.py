"""
Sagi Shield - storage. One small interface, two backends:
  MemoryStore    default; local dev, tests, and a demo that must not depend on Firestore
  FirestoreStore STORE=firestore (Cloud Run); needs google-cloud-firestore + project credentials
Only hashes and aggregates are stored - never raw phone numbers, audio or transcripts.
"""
from __future__ import annotations
import os
import secrets
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import Field


PAIR_CODE_TTL_S, MAX_ALERTS = 15 * 60, 50
RECOVERY_TTL_S, MAX_RECOVERY = 24 * 3600, 500  # a recovery chat is useful for a day, not for ever


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# One shape for family_id in every request model (secrets.token_urlsafe(16) = 22 chars)
FamilyId = Annotated[str, Field(max_length=40, pattern=r"^[A-Za-z0-9_-]+$")]


def _new_family(member_name: str) -> dict:
    # family_id is the shared secret of one family (unguessable); the 6-digit code only lives 15 min
    return {"family_id": secrets.token_urlsafe(16), "pair_code": f"{secrets.randbelow(10**6):06d}",
            "code_expires": time.time() + PAIR_CODE_TTL_S, "member_name": member_name[:40], "guardians": []}


MAX_PUSH_TOKENS = 10


def _with_token(fam: dict, token: str) -> dict:
    """push_tokens: guardians' browsers that turned notifications on after pairing; newest last, no repeats."""
    tokens = [t for t in fam.get("push_tokens", []) if t != token] + [token]
    fam["push_tokens"] = tokens[-MAX_PUSH_TOKENS:]
    return fam


def _alert(risk_level: str, scam_type: str, stage: int, summary: str, member_name: str) -> dict:
    return {"id": uuid.uuid4().hex[:12], "created_at": _now_iso(), "member_name": member_name,
            "risk_level": risk_level, "scam_type": scam_type, "stage": stage, "summary": summary[:300]}


def phish_keys(url: str) -> tuple[str, str]:
    """(url_key, host_key) for a known-phishing-URL lookup. The URL is normalised (scheme and host lower-cased,
    query / fragment / trailing slash dropped) and hashed so the collection never stores a victim's URL in clear;
    the host key lets a reused phishing host match even when the path changed. Never fetches anything."""
    u = url.strip()
    if not u.lower().startswith(("http://", "https://")):
        u = "http://" + u
    p = urlsplit(u)
    host = (p.hostname or "").lower().removeprefix("www.")
    path = p.path.rstrip("/")
    norm = f"{host}{path}".lower()
    return sha256(norm.encode()).hexdigest()[:32], sha256(host.encode()).hexdigest()[:32]


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# tools/seed_dashboard.py tags its simulated reports with this keyword; /stats counts them so the UI can say so.
SEED_KEYWORD = "demo-seed"


def _stats(checks: dict, reports: list[dict]) -> dict:
    trend = Counter(r["date"] for r in reports)
    return {
        "total_checks": checks.get("total", 0),
        "high_risk": checks.get("high", 0),
        "by_type": dict(Counter(r["scam_type"] for r in reports)),
        "by_region": dict(Counter(r["prefecture"] for r in reports if r.get("prefecture"))),
        "trend": [{"date": d, "count": c} for d, c in sorted(trend.items())],
        "simulated_reports": sum(SEED_KEYWORD in (r.get("keywords") or []) for r in reports),
    }


class MemoryStore:
    def __init__(self):
        self.reports: list[dict] = []
        self.checks: Counter = Counter()
        self.families: dict[str, dict] = {}
        self.alerts: dict[str, list[dict]] = {}
        self.recovery: dict[str, dict] = {}  # insertion-ordered: oldest first
        self.phish_urls: dict[str, dict] = {}   # url_key -> {brand, date, source}
        self.phish_hosts: dict[str, dict] = {}  # host_key -> {count, latest}

    def add_report(self, scam_type: str, phone_hash: str | None, keywords: list[str], prefecture: str | None,
                   reporter: str | None = None) -> None:
        self.reports.append({"scam_type": scam_type, "phone_hash": phone_hash, "keywords": keywords[:10],
                             "prefecture": prefecture, "date": _today(), "reporter": reporter})

    def add_phish_urls(self, entries: list[dict]) -> int:
        """entries: [{url, brand, date, source}] from a published phishing list. Returns the number of new URLs;
        a URL already stored is skipped, so reloading a month does not inflate the host counts."""
        n = 0
        for e in entries:
            uk, hk = phish_keys(e["url"])
            if uk in self.phish_urls:
                continue
            self.phish_urls[uk] = {"brand": e.get("brand", ""), "date": e.get("date", ""), "source": e.get("source", "")}
            h = self.phish_hosts.setdefault(hk, {"count": 0, "latest": ""})
            h["count"] += 1
            h["latest"] = max(h["latest"], e.get("date", ""))
            n += 1
        return n

    def phish_lookup(self, url: str) -> dict | None:
        """Exact URL hit -> {"match": "url", ...}; a host seen in the list -> {"match": "host", ...}; else None."""
        uk, hk = phish_keys(url)
        if uk in self.phish_urls:
            return {"match": "url", **self.phish_urls[uk]}
        if hk in self.phish_hosts:
            return {"match": "host", **self.phish_hosts[hk]}
        return None

    def count_phone(self, phone_hash: str) -> int:
        """Distinct reporters of this number (reports without a reporter key count once each)."""
        mine = [r for r in self.reports if r["phone_hash"] == phone_hash]
        return len({r.get("reporter") or id(r) for r in mine})

    def record_check(self, risk_level: str) -> None:
        self.checks["total"] += 1
        if risk_level == "HIGH":
            self.checks["high"] += 1

    def stats(self) -> dict:
        return _stats(self.checks, self.reports)

    def create_family(self, member_name: str) -> dict:
        fam = _new_family(member_name)
        self.families[fam["family_id"]] = fam
        return fam

    def refresh_code(self, family_id: str) -> dict | None:
        fam = self.families.get(family_id)
        if fam:
            fam.update(pair_code=_new_family("")["pair_code"], code_expires=time.time() + PAIR_CODE_TTL_S)
        return fam

    def link_guardian(self, pair_code: str, guardian_name: str, fcm_token: str | None) -> dict | None:
        for fam in self.families.values():
            if fam["pair_code"] == pair_code and fam["code_expires"] > time.time():
                fam["guardians"].append({"name": guardian_name[:40], "fcm_token": fcm_token})
                fam["code_expires"] = 0  # single use
                return fam
        return None

    def get_family(self, family_id: str) -> dict | None:
        return self.families.get(family_id)

    def add_push_token(self, family_id: str, token: str) -> bool:
        fam = self.families.get(family_id)
        if not fam:
            return False
        _with_token(fam, token)
        return True

    def add_alert(self, family_id: str, risk_level: str, scam_type: str, stage: int, summary: str) -> dict | None:
        fam = self.families.get(family_id)
        if not fam:
            return None
        alert = _alert(risk_level, scam_type, stage, summary, fam["member_name"])
        self.alerts[family_id] = ([alert] + self.alerts.get(family_id, []))[:MAX_ALERTS]
        return alert

    def list_alerts(self, family_id: str) -> list[dict]:
        return list(self.alerts.get(family_id, []))

    def get_recovery(self, session_id: str) -> dict | None:
        doc = self.recovery.get(session_id)
        return dict(doc) if doc and doc["expires_at"] > time.time() else None

    def save_recovery(self, session_id: str, data: dict) -> None:
        for value in data.values():  # fail here, in tests, on what Firestore would refuse in production
            if isinstance(value, list) and any(isinstance(item, (list, tuple)) for item in value):
                raise ValueError("Firestore does not support nested arrays")
        self.recovery.pop(session_id, None)
        self.recovery[session_id] = {**data, "expires_at": time.time() + RECOVERY_TTL_S}
        while len(self.recovery) > MAX_RECOVERY:
            self.recovery.pop(next(iter(self.recovery)))


def _firestore():
    """The SDK module, imported late so MemoryStore never needs it (tests replace this hook)."""
    from google.cloud import firestore
    return firestore


class FirestoreStore:
    def __init__(self):
        firestore = _firestore()
        self.fs = firestore
        # FIRESTORE_DB: one database per environment (the pilot service writes to "pilot"), so reports, stats and
        # households from a test family never change what the judged service shows
        self.database = os.getenv("FIRESTORE_DB", "(default)")
        self.db = firestore.Client(database=self.database)

    def probe(self) -> None:
        """One read at start-up: a database that does not exist must stop the process, not serve verdicts without a store."""
        try:
            next(self.db.collections(), None)
        except Exception as e:  # noqa: BLE001 - whatever the SDK raises, the message names the database
            raise RuntimeError(f"Firestore database '{self.database}' is missing or unreadable: {type(e).__name__}: {e}") from e

    def add_report(self, scam_type, phone_hash, keywords, prefecture, reporter=None) -> None:
        self.db.collection("reports").add({"scam_type": scam_type, "phone_hash": phone_hash, "keywords": keywords[:10],
                                           "prefecture": prefecture, "date": _today(), "reporter": reporter})

    def add_phish_urls(self, entries: list[dict]) -> int:
        """Batched writes: one doc per URL key, one counter doc per host (Firestore batches take 500 ops). URL keys
        already stored are read first and skipped (reads cost a third of writes), so a reload is idempotent."""
        n = 0
        urls = self.db.collection("phish_urls")
        for start in range(0, len(entries), 200):
            chunk = {}
            for e in entries[start:start + 200]:
                chunk.setdefault(phish_keys(e["url"]), e)  # the same URL twice in one chunk counts once
            known = {doc.id for doc in self.db.get_all([urls.document(uk) for uk, _ in chunk]) if doc.exists}
            fresh = [(uk, hk, e) for (uk, hk), e in chunk.items() if uk not in known]
            if not fresh:
                continue
            batch = self.db.batch()
            for uk, hk, e in fresh:
                batch.set(urls.document(uk), {"brand": e.get("brand", ""), "date": e.get("date", ""), "source": e.get("source", "")})
                batch.set(self.db.collection("phish_hosts").document(hk),
                          {"count": self.fs.Increment(1), "latest": e.get("date", "")}, merge=True)
            batch.commit()
            n += len(fresh)
        return n

    def phish_lookup(self, url: str) -> dict | None:
        uk, hk = phish_keys(url)
        doc = self.db.collection("phish_urls").document(uk).get()
        if doc.exists:
            return {"match": "url", **doc.to_dict()}
        doc = self.db.collection("phish_hosts").document(hk).get()
        if doc.exists:
            return {"match": "host", **doc.to_dict()}
        return None

    def count_phone(self, phone_hash: str) -> int:
        """Distinct reporters of this number (capped read: beyond 200 reports the answer is "many" either way)."""
        q = self.db.collection("reports").where(filter=self.fs.FieldFilter("phone_hash", "==", phone_hash)).limit(200)
        return len({(d.to_dict().get("reporter") or d.id) for d in q.stream()})

    def record_check(self, risk_level: str) -> None:
        inc = {"total": self.fs.Increment(1)}
        if risk_level == "HIGH":
            inc["high"] = self.fs.Increment(1)
        self.db.collection("stats").document("checks").set(inc, merge=True)

    def stats(self) -> dict:
        checks = self.db.collection("stats").document("checks").get().to_dict() or {}
        reports = [d.to_dict() for d in self.db.collection("reports").limit(5000).stream()]  # demo-sized
        return _stats(checks, reports)

    # families/{family_id} + families/{family_id}/alerts/{id}  (never run against a real Firestore yet)
    def create_family(self, member_name: str) -> dict:
        fam = _new_family(member_name)
        self.db.collection("families").document(fam["family_id"]).set(fam)
        return fam

    def refresh_code(self, family_id: str) -> dict | None:
        fam = self.get_family(family_id)
        if fam:
            fam.update(pair_code=_new_family("")["pair_code"], code_expires=time.time() + PAIR_CODE_TTL_S)
            self.db.collection("families").document(family_id).set(fam)
        return fam

    def link_guardian(self, pair_code: str, guardian_name: str, fcm_token: str | None) -> dict | None:
        q = self.db.collection("families").where(filter=self.fs.FieldFilter("pair_code", "==", pair_code)).limit(5)
        for doc in q.stream():
            fam = doc.to_dict()
            if fam["code_expires"] > time.time():
                fam["guardians"].append({"name": guardian_name[:40], "fcm_token": fcm_token})
                fam["code_expires"] = 0
                doc.reference.set(fam)
                return fam
        return None

    def get_family(self, family_id: str) -> dict | None:
        doc = self.db.collection("families").document(family_id).get()
        return doc.to_dict() if doc.exists else None

    def add_push_token(self, family_id: str, token: str) -> bool:
        fam = self.get_family(family_id)
        if not fam:
            return False
        self.db.collection("families").document(family_id).set(_with_token(fam, token))
        return True

    def add_alert(self, family_id: str, risk_level: str, scam_type: str, stage: int, summary: str) -> dict | None:
        fam = self.get_family(family_id)
        if not fam:
            return None
        alert = _alert(risk_level, scam_type, stage, summary, fam["member_name"])
        self.db.collection("families").document(family_id).collection("alerts").document(alert["id"]).set(alert)
        return alert

    def list_alerts(self, family_id: str) -> list[dict]:
        col = self.db.collection("families").document(family_id).collection("alerts")
        docs = col.order_by("created_at", direction=self.fs.Query.DESCENDING).limit(MAX_ALERTS).stream()
        return [d.to_dict() for d in docs]

    # recovery_sessions/{session_id}; set a Firestore TTL policy on `expires_at` so old chats are deleted for real
    def get_recovery(self, session_id: str) -> dict | None:
        doc = self.db.collection("recovery_sessions").document(session_id).get()
        data = doc.to_dict() if doc.exists else None
        return data if data and data["expires_at"].timestamp() > time.time() else None

    def save_recovery(self, session_id: str, data: dict) -> None:
        expires = datetime.fromtimestamp(time.time() + RECOVERY_TTL_S, timezone.utc)  # TTL policies need a timestamp field
        self.db.collection("recovery_sessions").document(session_id).set({**data, "expires_at": expires})


def get_store():
    if os.getenv("STORE", "memory") != "firestore":
        return MemoryStore()
    # Fail closed: hashes stored with input_layer's dev default key could be reversed by brute force (the phone-number
    # space is small) and would no longer match once a real key is set.
    if not (os.getenv("HASH_KEY") or os.getenv("HASH_SALT") or "").strip():
        raise RuntimeError("STORE=firestore needs HASH_KEY (mounted from Secret Manager); refusing the dev default key")
    store = FirestoreStore()
    store.probe()
    return store


STORE = get_store()  # one instance per process, shared by the HTTP routes and the live socket
