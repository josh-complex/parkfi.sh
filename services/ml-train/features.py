"""Feature build: SQL → tidy DataFrame.

One assembly path serves BOTH training and inference. The caller supplies a
*request* set — one row per `(attraction_id, target_ts, asof_ts, horizon_min)` —
and `assemble_features` LEFT JOINs every feature source onto it. Keeping a single
SQL means train and serve see byte-identical features (no train/serve skew).

The anchoring contract (this is the whole trick — read it):

  * `target_ts` — the 15-min bucket we predict standby `avg_wait` FOR.
  * `asof_ts`   — the wall-clock moment the prediction is made. Everything
                  "recent" (the lag trail) is measured backwards from here, so
                  it only ever uses data that would actually be known at serve
                  time. `horizon_min = (target_ts - asof_ts)` in minutes.

In TRAINING we set `asof_ts = target_ts - horizon` and replay each horizon, so a
row's recent-lag trail is exactly what we'd have had `horizon` minutes early —
no future leakage. In INFERENCE `asof_ts ≈ now` (the last observed bucket) and
`target_ts` is in the future. Identical SQL either way.

Leakage rules baked in here (see docs/plans §7):
  * Weather joins `weather_obs.kind = 'FORECAST'` only — never ACTUAL.
  * Splits are by time, done in train.py (lags make random splits leak).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import psycopg

from db import read_df

STANDBY = 1  # ref_queue_type.STANDBY — the only target we forecast

# Near-term lead times (minutes) we train/serve as discrete horizons. The
# next-day hourly curve uses whatever (large) horizon the target implies.
NEAR_TERM_HORIZONS = (30, 60, 120)

# Long lead times trained so the next-day curve isn't extrapolating: the curve
# is served at ~24-40h horizons where the recent-lag trail is NULL (asof lands
# overnight while parks are closed). Without these rows LightGBM only ever saw
# horizon <= 120 with populated lags and collapsed to a low baseline at curve
# time. Trained on hourly buckets only (see build_training_requests) to keep
# the frame size sane.
CURVE_TRAIN_HORIZONS = (24 * 60, 36 * 60)

# Numeric feature columns fed to LightGBM, in a fixed order (persisted in the
# model bundle so inference rebuilds the exact same matrix).
NUMERIC_FEATURES = [
    "horizon_min",
    "recent_wait",
    "recent_wait_15",
    "recent_wait_30",
    "recent_wait_60",
    "lag_1d",
    "lag_1w",
    "temp_c",
    "precip_mm",
    "precip_prob",
    "wind_kph",
    "humidity",
    "is_holiday",
    "is_school_break",
    "min_to_open",
    "min_to_close",
    "is_ticketed_event",
    "is_extra_hours",
    "hour_sin",
    "hour_cos",
    "dow_sin",
    "dow_cos",
    "month_sin",
    "month_cos",
]
# LightGBM categoricals (label-encoded ints; see encode_categoricals).
CATEGORICAL_FEATURES = ["attraction_id", "condition_code"]
FEATURE_COLUMNS = NUMERIC_FEATURES + CATEGORICAL_FEATURES

# OpenWeather `weather[0].main` buckets → small int. Unknown/NULL → 0.
_CONDITION_CODES = {
    "Clear": 1,
    "Clouds": 2,
    "Rain": 3,
    "Drizzle": 4,
    "Thunderstorm": 5,
    "Snow": 6,
    "Mist": 7,
    "Fog": 7,
    "Haze": 7,
}


# One row per (attraction_id, target_ts, asof_ts, horizon_min) feeds in via the
# `feat_req` temp table; this stitches every source on. `y` is NULL at inference.
_FEATURE_SQL = """
SELECT
  fr.attraction_id,
  fr.target_ts,
  fr.horizon_min,
  yq.avg_wait                              AS y,
  r0.avg_wait                              AS recent_wait,
  r15.avg_wait                             AS recent_wait_15,
  r30.avg_wait                             AS recent_wait_30,
  r60.avg_wait                             AS recent_wait_60,
  yd.avg_wait                              AS lag_1d,
  yw.avg_wait                              AS lag_1w,
  wo.temp_c, wo.precip_mm, wo.precip_prob, wo.wind_kph, wo.humidity,
  wo.condition,
  COALESCE(cd.is_us_federal_holiday, false)::int AS is_holiday,
  COALESCE(cd.is_school_break, false)::int       AS is_school_break,
  sched.min_to_open,
  sched.min_to_close,
  COALESCE(sched.is_ticketed_event, false)::int  AS is_ticketed_event,
  COALESCE(sched.is_extra_hours, false)::int     AS is_extra_hours,
  EXTRACT(HOUR FROM fr.target_ts) + EXTRACT(MINUTE FROM fr.target_ts) / 60.0 AS hour_f,
  EXTRACT(DOW FROM fr.target_ts)   AS dow,
  EXTRACT(MONTH FROM fr.target_ts) AS month
FROM feat_req fr
JOIN attractions a ON a.id = fr.attraction_id
JOIN parks p ON p.id = a.park_id
LEFT JOIN queue_15min yq
  ON yq.attraction_id = fr.attraction_id AND yq.queue_type = 1 AND yq.bucket = fr.target_ts
LEFT JOIN queue_15min r0
  ON r0.attraction_id = fr.attraction_id AND r0.queue_type = 1 AND r0.bucket = fr.asof_ts
LEFT JOIN queue_15min r15
  ON r15.attraction_id = fr.attraction_id AND r15.queue_type = 1
     AND r15.bucket = fr.asof_ts - INTERVAL '15 minutes'
LEFT JOIN queue_15min r30
  ON r30.attraction_id = fr.attraction_id AND r30.queue_type = 1
     AND r30.bucket = fr.asof_ts - INTERVAL '30 minutes'
LEFT JOIN queue_15min r60
  ON r60.attraction_id = fr.attraction_id AND r60.queue_type = 1
     AND r60.bucket = fr.asof_ts - INTERVAL '60 minutes'
LEFT JOIN queue_15min yd
  ON yd.attraction_id = fr.attraction_id AND yd.queue_type = 1
     AND yd.bucket = fr.target_ts - INTERVAL '1 day'
LEFT JOIN queue_15min yw
  ON yw.attraction_id = fr.attraction_id AND yw.queue_type = 1
     AND yw.bucket = fr.target_ts - INTERVAL '7 days'
LEFT JOIN weather_obs wo
  ON wo.park_id = a.park_id AND wo.kind = 'FORECAST'
     AND wo.observed_at = date_trunc('hour', fr.target_ts)
LEFT JOIN park_calendar_map pcm ON pcm.park_id = a.park_id
LEFT JOIN calendar_day cd
  ON cd.region = pcm.region AND cd.date = (fr.target_ts AT TIME ZONE p.timezone)::date
LEFT JOIN LATERAL (
  -- Latest snapshot's operating window for the target's service date, plus
  -- same-day special-schedule flags. Times are absolute timestamptz, so the
  -- minutes-to-open/close are simple differences.
  WITH day AS (
    SELECT DISTINCT ON (ps.type, ps.opening_time)
           ps.type, ps.opening_time, ps.closing_time
    FROM park_schedule ps
    WHERE ps.park_id = a.park_id
      AND ps.service_date = (fr.target_ts AT TIME ZONE p.timezone)::date
    ORDER BY ps.type, ps.opening_time, ps.snapshot_date DESC
  ),
  op AS (
    SELECT min(opening_time) AS opening, max(closing_time) AS closing
    FROM day WHERE type = 'OPERATING'
  )
  SELECT
    EXTRACT(EPOCH FROM (fr.target_ts - op.opening)) / 60.0 AS min_to_open,
    EXTRACT(EPOCH FROM (op.closing - fr.target_ts)) / 60.0 AS min_to_close,
    EXISTS (SELECT 1 FROM day WHERE type = 'TICKETED_EVENT') AS is_ticketed_event,
    EXISTS (SELECT 1 FROM day WHERE type = 'EXTRA_HOURS')    AS is_extra_hours
  FROM op
) sched ON true
"""

_REQ_DDL = """
CREATE TEMP TABLE feat_req (
  attraction_id bigint NOT NULL,
  target_ts     timestamptz NOT NULL,
  asof_ts       timestamptz NOT NULL,
  horizon_min   integer NOT NULL
) ON COMMIT DROP
"""


def _finalize(df: pd.DataFrame) -> pd.DataFrame:
    """Derive cyclical encodings + categorical codes; coerce dtypes."""
    if df.empty:
        return df
    # Cyclical time (period: 24h, 7d, 12mo).
    hour = df["hour_f"].astype(float)
    dow = df["dow"].astype(float)
    month = df["month"].astype(float)
    df["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)
    df["dow_sin"] = np.sin(2 * np.pi * dow / 7.0)
    df["dow_cos"] = np.cos(2 * np.pi * dow / 7.0)
    df["month_sin"] = np.sin(2 * np.pi * (month - 1) / 12.0)
    df["month_cos"] = np.cos(2 * np.pi * (month - 1) / 12.0)
    # Weather condition → small int code (LightGBM categorical).
    df["condition_code"] = (
        df["condition"].map(_CONDITION_CODES).fillna(0).astype("int32")
    )
    df["attraction_id"] = df["attraction_id"].astype("int64")
    for col in NUMERIC_FEATURES:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def assemble_features(conn: psycopg.Connection, req: pd.DataFrame) -> pd.DataFrame:
    """Stitch all feature sources onto a request frame.

    `req` columns: attraction_id, target_ts, asof_ts, horizon_min. Returns the
    request rows enriched with `y` (NULL at inference) + every model feature.
    Uses a COMMIT-scoped temp table fed by COPY for speed.
    """
    if req.empty:
        return req
    with conn.cursor() as cur:
        cur.execute(_REQ_DDL)
        with cur.copy(
            "COPY feat_req (attraction_id, target_ts, asof_ts, horizon_min) FROM STDIN"
        ) as copy:
            for row in req.itertuples(index=False):
                copy.write_row(
                    (
                        int(row.attraction_id),
                        row.target_ts,
                        row.asof_ts,
                        int(row.horizon_min),
                    )
                )
        cur.execute(_FEATURE_SQL)
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=cols)
    out = _finalize(df)
    conn.commit()  # drops the ON COMMIT temp table
    return out


def active_standby_attractions(conn: psycopg.Connection) -> pd.DataFrame:
    """Active attractions that report standby waits (the inference universe).

    The reporting filter drops entities that don't meaningfully report a
    standby queue — Universal's "Single Rider" queues and character meets are
    their own active ATTRACTION rows with only a couple dozen stray 0-wait
    buckets in 90 days (real rides have thousands). Forecasting them wastes
    rows and their near-zero predictions diluted park-average crowd math
    downstream. The 100-bucket floor (~25h of reporting) matches the app's
    `reporting` CTEs; new rides self-admit within days of opening.
    """
    return read_df(
        conn,
        """
        SELECT a.id AS attraction_id, a.park_id, p.timezone
        FROM attractions a JOIN parks p ON p.id = a.park_id
        WHERE a.active = true AND a.entity_type = 'ATTRACTION'
          AND 100 <= (
            SELECT count(*) FROM queue_15min q
            WHERE q.attraction_id = a.id AND q.queue_type = 1
              AND q.avg_wait IS NOT NULL
              AND q.bucket >= now() - INTERVAL '90 days'
          )
        ORDER BY a.id
        """,
    )


def build_training_requests(
    conn: psycopg.Connection,
    start: str,
    end: str,
    horizons: tuple[int, ...] = NEAR_TERM_HORIZONS,
    curve_horizons: tuple[int, ...] = CURVE_TRAIN_HORIZONS,
) -> pd.DataFrame:
    """One request per observed (attraction, bucket) × horizon over [start, end).

    `asof_ts = target_ts - horizon` so each row's recent-lag trail is exactly
    what we'd have known `horizon` minutes before the target (no leakage). The
    label is joined later by `assemble_features` from the same `target_ts`.

    Near-term horizons replay every 15-min bucket; curve horizons replay only
    hourly buckets — matching how the next-day curve is served (hourly grid)
    while keeping the frame from ballooning.
    """
    obs = read_df(
        conn,
        """
        SELECT attraction_id, bucket AS target_ts
        FROM queue_15min
        WHERE queue_type = 1 AND avg_wait IS NOT NULL
          AND bucket >= %(start)s AND bucket < %(end)s
        """,
        {"start": start, "end": end},
    )
    if obs.empty:
        return obs
    hourly = obs[pd.to_datetime(obs["target_ts"], utc=True).dt.minute == 0]
    frames = []
    for h, base in [(h, obs) for h in horizons] + [(h, hourly) for h in curve_horizons]:
        f = base.copy()
        f["horizon_min"] = h
        f["asof_ts"] = pd.to_datetime(f["target_ts"], utc=True) - pd.Timedelta(minutes=h)
        frames.append(f)
    return pd.concat(frames, ignore_index=True)
