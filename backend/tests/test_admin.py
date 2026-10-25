import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.update(USE_LLM="0", STORE="memory", USE_WEBRISK="0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import admin, guard, main  # noqa: E402


@pytest.fixture
def client():
    guard._hits.clear()
    main.store.__init__()
    yield TestClient(main.app)
    guard._hits.clear()


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

    def boom(sql, params, timeout_s=20):
        raise admin.bq.Unavailable("timeout")
    monkeypatch.setattr(admin.bq, "query", boom)
    r = client.get("/admin/summary", headers=ADMIN)
    assert r.status_code == 503 and "timeout" in r.json()["detail"]


def test_every_query_is_named_and_uses_the_table_placeholder():
    for name, sql in admin.QUERIES.items():
        assert admin.which(sql) == name and "`@table`" in sql and "@days" in sql


def test_households_overview_counts_without_ids():
    from app.storage import MemoryStore, _now_iso
    s = MemoryStore()
    s.households = {"a": {"live_guard_enabled": True, "devices_seen": {"u": {"at": _now_iso()}}},
                    "b": {"devices_seen": {"u": {"at": "2020-01-01T00:00:00+00:00"}}}}
    assert s.households_overview() == {"n": 2, "live_guard_on": 1, "devices_seen_24h": 1}


def test_rule_hit_regex_counts_only_stages_with_markers():
    import json
    sample = json.dumps({"AUTHORITY": ["police"], "FEAR": [], "MONEY": ["transfer", "atm"], "ISOLATION": None}, separators=(",", ":"))  # BigQuery writes no spaces
    assert admin.HIT_RE.findall(sample) == ["AUTHORITY", "MONEY"]
    assert admin.HIT_PATTERN in admin.QUERIES["rule_hits"]


def test_one_failing_query_does_not_hide_the_rest(client, monkeypatch):
    monkeypatch.setenv("VERDICT_TABLE", "p.sagi_pilot.verdicts")

    def fake(sql, params, timeout_s=20):
        if admin.which(sql) == "latency":
            raise admin.bq.Unavailable("no such field")
        return [{"day": "2026-10-25", "kind": "check", "level": "LOW", "lang": "ja", "n": 1}] if admin.which(sql) == "verdicts" else []
    monkeypatch.setattr(admin.bq, "query", fake)
    r = client.get("/admin/summary", headers=ADMIN)
    assert r.status_code == 200 and r.json()["unavailable"] == ["latency"] and r.json()["verdicts"][0]["n"] == 1
    monkeypatch.setattr(admin.bq, "query", lambda sql, params, timeout_s=20: (_ for _ in ()).throw(admin.bq.Unavailable("x")))
    assert client.get("/admin/summary", headers=ADMIN).status_code == 503
