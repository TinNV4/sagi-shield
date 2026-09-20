"""
Sagi Shield - storage. One small interface, two backends:
  MemoryStore    default; local dev, tests, and a demo that must not depend on Firestore
  FirestoreStore STORE=firestore (Cloud Run); needs google-cloud-firestore + project credentials
Only hashes and aggregates are stored - never raw phone numbers, audio or transcripts.
"""
from __future__ import annotations
import os
from collections import Counter
from datetime import datetime, timezone


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


def get_store():
    return FirestoreStore() if os.getenv("STORE", "memory") == "firestore" else MemoryStore()
