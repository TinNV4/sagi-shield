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


PAIR_CODE_TTL_S, MAX_ALERTS = 15 * 60, 50
RECOVERY_TTL_S, MAX_RECOVERY = 24 * 3600, 500  # a recovery chat is useful for a day, not for ever


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_family(member_name: str) -> dict:
    # family_id is the shared secret of one family (unguessable); the 6-digit code only lives 15 min
    return {"family_id": secrets.token_urlsafe(16), "pair_code": f"{secrets.randbelow(10**6):06d}",
            "code_expires": time.time() + PAIR_CODE_TTL_S, "member_name": member_name[:40], "guardians": []}


def _alert(risk_level: str, scam_type: str, stage: int, summary: str, member_name: str) -> dict:
    return {"id": uuid.uuid4().hex[:12], "created_at": _now_iso(), "member_name": member_name,
            "risk_level": risk_level, "scam_type": scam_type, "stage": stage, "summary": summary[:300]}


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _stats(checks: dict, reports: list[dict]) -> dict:
    trend = Counter(r["date"] for r in reports)
    return {
        "total_checks": checks.get("total", 0),
        "high_risk": checks.get("high", 0),
        "by_type": dict(Counter(r["scam_type"] for r in reports)),
        "by_region": dict(Counter(r["prefecture"] for r in reports if r.get("prefecture"))),
        "trend": [{"date": d, "count": c} for d, c in sorted(trend.items())],
    }


class MemoryStore:
    def __init__(self):
        self.reports: list[dict] = []
        self.checks: Counter = Counter()
        self.families: dict[str, dict] = {}
        self.alerts: dict[str, list[dict]] = {}
        self.recovery: dict[str, dict] = {}  # insertion-ordered: oldest first

    def add_report(self, scam_type: str, phone_hash: str | None, keywords: list[str], prefecture: str | None) -> None:
        self.reports.append({"scam_type": scam_type, "phone_hash": phone_hash, "keywords": keywords[:10],
                             "prefecture": prefecture, "date": _today()})

    def count_phone(self, phone_hash: str) -> int:
        return sum(1 for r in self.reports if r["phone_hash"] == phone_hash)

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


class FirestoreStore:
    def __init__(self):
        from google.cloud import firestore
        self.fs = firestore
        self.db = firestore.Client()

    def add_report(self, scam_type, phone_hash, keywords, prefecture) -> None:
        self.db.collection("reports").add({"scam_type": scam_type, "phone_hash": phone_hash,
                                           "keywords": keywords[:10], "prefecture": prefecture, "date": _today()})

    def count_phone(self, phone_hash: str) -> int:
        q = self.db.collection("reports").where(filter=self.fs.FieldFilter("phone_hash", "==", phone_hash))
        return int(q.count().get()[0][0].value)

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
    return FirestoreStore() if os.getenv("STORE", "memory") == "firestore" else MemoryStore()


STORE = get_store()  # one instance per process, shared by the HTTP routes and the live socket
