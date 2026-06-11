"""Batch inference → `queue_forecast`.

Loads the active model bundle and emits standby-wait forecasts with a p10/p90
band. Two shapes (the plan's two cadences):

  * "near"  — now+{30,60,120} min for every active ride. Lightweight; the 15-min
              cron path. Leans on the recent-lag trail.
  * "curve" — tomorrow's hourly curve across each park's operating window, for
              the crowd-calendar use case. Runs daily right after training.

Writes go through a temp table + upsert so a re-run within the same model
version is idempotent. `queue_forecast` has 30-day retention (Timescale drops
old chunks) — no manual cleanup here.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

import features as F
from db import connect, read_df
from model_io import load_bundle

STANDBY = 1


def _floor_15(dt: datetime) -> datetime:
    m = dt.minute - (dt.minute % 15)
    return dt.replace(minute=m, second=0, microsecond=0)


def _load_active_model(conn):
    row = read_df(
        conn,
        """
        SELECT mr.model_version, ma.artifact
        FROM model_run mr
        JOIN model_artifact ma ON ma.model_version = mr.model_version
        WHERE mr.status = 'active'
        ORDER BY mr.trained_at DESC
        LIMIT 1
        """,
    )
    if row.empty:
        return None
    version = row.iloc[0]["model_version"]
    blob = row.iloc[0]["artifact"]
    blob = bytes(blob) if not isinstance(blob, bytes) else blob
    boosters, meta = load_bundle(blob)
    return version, boosters, meta


def _near_term_requests(conn, asof: datetime) -> pd.DataFrame:
    rides = F.active_standby_attractions(conn)
    if rides.empty:
        return rides
    frames = []
    for h in F.NEAR_TERM_HORIZONS:
        f = pd.DataFrame({"attraction_id": rides["attraction_id"]})
        f["target_ts"] = asof + timedelta(minutes=h)
        f["asof_ts"] = asof
        f["horizon_min"] = h
        frames.append(f)
    return pd.concat(frames, ignore_index=True)


def _curve_requests(conn, asof: datetime) -> pd.DataFrame:
    """Hourly targets across each park's operating window for tomorrow."""
    rides = F.active_standby_attractions(conn)
    if rides.empty:
        return rides
    target_date = (asof + timedelta(days=1)).date().isoformat()
    windows = read_df(
        conn,
        """
        WITH day AS (
          SELECT DISTINCT ON (park_id, opening_time) park_id, opening_time, closing_time
          FROM park_schedule
          WHERE type = 'OPERATING'
            AND service_date = %(d)s
            AND closing_time IS NOT NULL
          ORDER BY park_id, opening_time, snapshot_date DESC
        )
        SELECT park_id, min(opening_time) AS opening, max(closing_time) AS closing
        FROM day GROUP BY park_id
        """,
        {"d": target_date},
    )
    if windows.empty:
        print(f"[ml-infer] no operating windows for {target_date} — skipping curve")
        return pd.DataFrame()
    rows = []
    for w in windows.itertuples(index=False):
        park_rides = rides[rides["park_id"] == w.park_id]["attraction_id"].tolist()
        if not park_rides:
            continue
        opening = pd.Timestamp(w.opening).tz_convert("UTC")
        closing = pd.Timestamp(w.closing).tz_convert("UTC")
        bucket = opening
        while bucket < closing:
            for aid in park_rides:
                rows.append((aid, bucket.to_pydatetime()))
            bucket += pd.Timedelta(hours=1)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["attraction_id", "target_ts"])
    df["asof_ts"] = asof
    df["horizon_min"] = (
        (pd.to_datetime(df["target_ts"], utc=True) - asof).dt.total_seconds() / 60
    ).round().astype(int)
    return df


def _predict(df: pd.DataFrame, boosters) -> pd.DataFrame:
    x = df[F.FEATURE_COLUMNS]
    preds = np.vstack(
        [boosters["q10"].predict(x), boosters["q50"].predict(x), boosters["q90"].predict(x)]
    ).T
    preds = np.clip(preds, 0, None)
    preds.sort(axis=1)  # enforce lower <= p50 <= upper (no quantile crossing)
    out = df[["attraction_id", "target_ts", "horizon_min"]].copy()
    out["lower"] = preds[:, 0]
    out["predicted_wait"] = preds[:, 1]
    out["upper"] = preds[:, 2]
    return out


def _write(conn, out: pd.DataFrame, version: str, generated_at: datetime) -> int:
    if out.empty:
        return 0
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TEMP TABLE qf_stage (
              attraction_id bigint, queue_type smallint, target_ts timestamptz,
              horizon_min integer, predicted_wait real, lower real, upper real,
              model_version text, generated_at timestamptz
            ) ON COMMIT DROP
            """
        )
        with cur.copy(
            "COPY qf_stage (attraction_id, queue_type, target_ts, horizon_min, "
            "predicted_wait, lower, upper, model_version, generated_at) FROM STDIN"
        ) as copy:
            for r in out.itertuples(index=False):
                copy.write_row(
                    (
                        int(r.attraction_id),
                        STANDBY,
                        r.target_ts,
                        int(r.horizon_min),
                        float(r.predicted_wait),
                        float(r.lower),
                        float(r.upper),
                        version,
                        generated_at,
                    )
                )
        cur.execute(
            """
            INSERT INTO queue_forecast
              (attraction_id, queue_type, target_ts, horizon_min,
               predicted_wait, lower, upper, model_version, generated_at)
            SELECT attraction_id, queue_type, target_ts, horizon_min,
                   predicted_wait, lower, upper, model_version, generated_at
            FROM qf_stage
            ON CONFLICT (attraction_id, queue_type, horizon_min, model_version, target_ts)
            DO UPDATE SET predicted_wait = excluded.predicted_wait,
                          lower = excluded.lower,
                          upper = excluded.upper,
                          generated_at = excluded.generated_at
            """
        )
        n = cur.rowcount
    conn.commit()
    return n


def infer(mode: str = "near") -> None:
    conn = connect()
    try:
        loaded = _load_active_model(conn)
        if loaded is None:
            print("[ml-infer] no active model — run `train` first; skipping")
            return
        version, boosters, _meta = loaded
        now = datetime.now(timezone.utc)
        asof = _floor_15(now)

        modes = ["near", "curve"] if mode == "both" else [mode]
        for m in modes:
            req = _near_term_requests(conn, asof) if m == "near" else _curve_requests(conn, asof)
            if req.empty:
                print(f"[ml-infer] {m}: no requests")
                continue
            feats = F.assemble_features(conn, req)
            out = _predict(feats, boosters)
            n = _write(conn, out, version, now)
            print(f"[ml-infer] {m}: wrote {n} forecasts ({version})")
    finally:
        conn.close()


if __name__ == "__main__":
    infer(sys.argv[1] if len(sys.argv) > 1 else "near")
