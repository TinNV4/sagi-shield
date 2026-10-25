"""
Sagi Shield - BigQuery reader for the admin page.

The verdict records reach BigQuery through a Cloud Logging sink (see verdict_log.py); this module only reads that
table. VERDICT_TABLE="project.dataset.table" names it. Any failure becomes `Unavailable(sentence)` so the admin route
answers 503 with a reason instead of a 500: the admin page is an enrichment, never a dependency of a check.
"""
from __future__ import annotations
import os
import re

TABLE_RE = re.compile(r"^[\w-]+\.\w+\.\w+$")


class Unavailable(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def table() -> str:
    name = (os.getenv("VERDICT_TABLE") or "").strip()
    if not name:
        raise Unavailable("verdict table not configured")
    if not TABLE_RE.match(name):
        raise Unavailable("verdict table name is not valid")
    return name


def query(sql: str, params: dict, timeout_s: float = 20) -> list[dict]:
    """Run `sql` with named scalar parameters; rows come back as plain dicts."""
    try:
        table()  # fail fast, with the sentence, before any client is built
        from google.cloud import bigquery
        types = {bool: "BOOL", int: "INT64", float: "FLOAT64", str: "STRING"}
        cfg = bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter(k, types[type(v)], v) for k, v in params.items()])
        return [dict(r.items()) for r in bigquery.Client().query(sql, job_config=cfg).result(timeout=timeout_s)]
    except Unavailable:
        raise
    except Exception as e:
        raise Unavailable(f"{type(e).__name__}: {str(e)[:120]}") from e
