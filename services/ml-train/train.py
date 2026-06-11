"""Train the global quantile wait-time model and persist it.

One global LightGBM regressor (not per-ride) with `attraction_id` as a
categorical — cold-start friendly and the only thing that scales to ~4080 rides.
Three quantile fits (α = 0.1 / 0.5 / 0.9) give the honest confidence band the UI
needs: p50 → predicted_wait, p10 → lower, p90 → upper.

Splits are by TIME (most-recent `VAL_DAYS` held out), never random — the lag
features would leak the future into the past under a random split.

On success: writes the `model_artifact` bundle, inserts a `model_run` row with
`status='active'`, and demotes any prior active run to 'retired'. All in one
transaction so a half-written model can never be marked active.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

import lightgbm as lgb
import numpy as np
import pandas as pd

import features as F
from db import connect
from model_io import BUNDLE_FORMAT, QUANTILES, save_bundle


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


TRAIN_DAYS = _env_int("ML_TRAIN_DAYS", 60)  # history window for the training frame
VAL_DAYS = _env_int("ML_VAL_DAYS", 7)  # most-recent days held out for validation
NUM_BOOST_ROUND = _env_int("ML_NUM_BOOST_ROUND", 400)


def _metrics(actual: np.ndarray, pred: np.ndarray) -> dict[str, float]:
    err = pred - actual
    abs_err = np.abs(err)
    mae = float(np.mean(abs_err))
    rmse = float(np.sqrt(np.mean(err**2)))
    nz = actual != 0
    mape = float(np.mean(abs_err[nz] / np.abs(actual[nz]))) if nz.any() else float("nan")
    ss_res = float(np.sum(err**2))
    ss_tot = float(np.sum((actual - np.mean(actual)) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")
    return {"mae": mae, "rmse": rmse, "mape": mape, "r2": r2}


def _fit_quantile(
    train: pd.DataFrame, alpha: float, cat_idx: list[int]
) -> lgb.Booster:
    dataset = lgb.Dataset(
        train[F.FEATURE_COLUMNS],
        label=train["y"],
        categorical_feature=cat_idx,
        free_raw_data=False,
    )
    params = {
        "objective": "quantile",
        "alpha": alpha,
        "learning_rate": 0.05,
        "num_leaves": 63,
        "min_data_in_leaf": 200,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "verbosity": -1,
    }
    return lgb.train(params, dataset, num_boost_round=NUM_BOOST_ROUND)


def train() -> str:
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=TRAIN_DAYS)).isoformat()
    end = now.isoformat()
    split = now - timedelta(days=VAL_DAYS)

    conn = connect()
    try:
        print(f"[ml-train] building training frame {start[:10]}..{end[:10]}")
        req = F.build_training_requests(conn, start, end)
        if req.empty:
            raise SystemExit("[ml-train] no queue_15min history in window — nothing to train")
        df = F.assemble_features(conn, req)
        df = df.dropna(subset=["y"]).reset_index(drop=True)
        if df.empty:
            raise SystemExit("[ml-train] no labeled rows after feature join")

        ts = pd.to_datetime(df["target_ts"], utc=True)
        train_df = df[ts < split].reset_index(drop=True)
        val_df = df[ts >= split].reset_index(drop=True)
        if train_df.empty:
            raise SystemExit("[ml-train] empty training split — widen ML_TRAIN_DAYS")
        print(f"[ml-train] rows: {len(train_df)} train / {len(val_df)} val")

        cat_idx = [F.FEATURE_COLUMNS.index(c) for c in F.CATEGORICAL_FEATURES]
        boosters = {key: _fit_quantile(train_df, a, cat_idx) for key, a in QUANTILES.items()}

        metrics: dict = {"train_rows": len(train_df), "val_rows": len(val_df)}
        if not val_df.empty:
            p50 = boosters["q50"].predict(val_df[F.FEATURE_COLUMNS])
            metrics["val"] = _metrics(val_df["y"].to_numpy(), np.asarray(p50))
            print(f"[ml-train] val metrics: {metrics['val']}")

        version = f"v1-{now:%Y%m%d-%H%M}"
        meta = {
            "feature_columns": F.FEATURE_COLUMNS,
            "categorical_features": F.CATEGORICAL_FEATURES,
            "near_term_horizons": list(F.NEAR_TERM_HORIZONS),
            "trained_at": now.isoformat(),
        }
        blob = save_bundle(boosters, meta)

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE model_run SET status = 'retired' WHERE status = 'active'"
            )
            cur.execute(
                """
                INSERT INTO model_run
                  (model_version, trained_at, train_rows, feature_set, metrics_json, status)
                VALUES (%s, %s, %s, %s, %s, 'active')
                """,
                (
                    version,
                    now,
                    len(train_df),
                    "v1:lags+weather+calendar+schedule",
                    json.dumps(metrics),
                ),
            )
            cur.execute(
                """
                INSERT INTO model_artifact (model_version, format, artifact)
                VALUES (%s, %s, %s)
                """,
                (version, BUNDLE_FORMAT, blob),
            )
        conn.commit()
        print(f"[ml-train] wrote model_run + artifact {version} ({len(blob)} bytes)")
        return version
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    train()
