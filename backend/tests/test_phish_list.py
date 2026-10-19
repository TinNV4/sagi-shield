"""The monthly phishing-list job: month window, CSV parsing, idempotent reloads (no network)."""
from datetime import date

from app import phish_list
from app.storage import MemoryStore

CSV = "date,URL,description\n2026/09/30,https://uffzuoynym.top/jp/,SAISON CARD\n2026/09/30,https://uffzuoynym.top/login,SAISON CARD\n,,\n"


def test_months_back_crosses_the_year():
    assert phish_list.months_back(3, date(2026, 2, 10)) == ["202602", "202601", "202512"]


def test_parse_skips_blank_rows_and_normalises_the_date():
    rows = phish_list.parse(CSV)
    assert [r["date"] for r in rows] == ["2026-09-30", "2026-09-30"]
    assert rows[0]["brand"] == "SAISON CARD" and rows[0]["source"] == "jpcertcc"


def test_reloading_the_same_month_stores_nothing_new():
    store = MemoryStore()
    rows = phish_list.parse(CSV)
    assert store.add_phish_urls(rows) == 2
    assert store.add_phish_urls(rows) == 0  # the job re-reads last month: no duplicate, no inflated host count
    assert [h["count"] for h in store.phish_hosts.values()] == [2]
    assert store.phish_lookup("https://uffzuoynym.top/jp")["match"] == "url"


def test_job_fails_when_no_month_could_be_read(monkeypatch):
    monkeypatch.setattr(phish_list, "fetch", lambda ym: None)
    assert phish_list.main(["--months", "2"]) == 1


def test_job_loads_into_the_configured_store(monkeypatch):
    store = MemoryStore()
    monkeypatch.setattr(phish_list, "fetch", lambda ym: CSV if ym.endswith("09") else None)
    monkeypatch.setattr(phish_list, "months_back", lambda n: ["202610", "202609"])
    monkeypatch.setattr("app.storage.STORE", store)
    assert phish_list.main(["--months", "2"]) == 0
    assert len(store.phish_urls) == 2
