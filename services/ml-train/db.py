"""Postgres access for the model service.

Postgres is the ONLY contract with the app (see docs/plans + schema.ts
§ "Wait-time forecasting"): this service reads the feature store / dimension
tables and writes `queue_forecast`, `model_run`, `model_metrics`, and
`model_artifact`. It never imports app code.

Connection string comes from `DATABASE_URL` (the same private-network Postgres
the app and TS crons use). psycopg3 understands the standard libpq URL.
"""

from __future__ import annotations

import os

import pandas as pd
import psycopg


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is unset — point it at the private-network Postgres")
    return url


def connect() -> psycopg.Connection:
    """A new autocommit=False connection; callers manage transactions."""
    return psycopg.connect(database_url())


def read_df(conn: psycopg.Connection, sql: str, params: dict | None = None) -> pd.DataFrame:
    """Run a SELECT and return a DataFrame (column names from the cursor)."""
    with conn.cursor() as cur:
        cur.execute(sql, params or {})
        cols = [d.name for d in cur.description] if cur.description else []
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)
