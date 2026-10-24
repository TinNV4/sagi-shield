"""FIRESTORE_DB picks the Firestore database (the pilot service has its own); a missing one must stop the service."""
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.update(USE_LLM="0", STORE="memory")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import main, storage  # noqa: E402


class FakeFirestore:
    """Stands in for google.cloud.firestore: records the database name, optionally pretends it does not exist."""

    class Query:
        DESCENDING = "desc"

    class FieldFilter:
        def __init__(self, *args):
            pass

    def __init__(self, exists=True):
        self.exists, self.database = exists, None

    def Client(self, database="(default)"):  # noqa: N802 - mirrors the SDK
        self.database = database
        fake = self

        class C:
            def collections(self):
                if not fake.exists:
                    raise RuntimeError("404 NotFound: database pilot")
                return iter([])

        return C()


def test_firestore_db_env_selects_the_database(monkeypatch):
    fs = FakeFirestore()
    monkeypatch.setattr(storage, "_firestore", lambda: fs)
    monkeypatch.setenv("FIRESTORE_DB", "pilot")
    store = storage.FirestoreStore()
    assert fs.database == "pilot" and store.database == "pilot"


def test_missing_database_refuses_to_start(monkeypatch):
    monkeypatch.setattr(storage, "_firestore", lambda: FakeFirestore(exists=False))
    monkeypatch.setenv("STORE", "firestore")
    monkeypatch.setenv("HASH_KEY", "k")
    monkeypatch.setenv("FIRESTORE_DB", "pilot")
    with pytest.raises(RuntimeError, match="pilot"):
        storage.get_store()


def test_health_names_the_store():
    body = TestClient(main.app).get("/health").json()
    assert body["store"] == "memory" and body["database"] is None
