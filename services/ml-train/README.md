# ml-train — wait-time forecasting model service

Standalone **Python** service. The only contract with the app is **Postgres**:
it reads the feature store (`queue_15min`) + dimension/feature tables and writes
`queue_forecast`, `model_run`, `model_metrics`-feeding data, and `model_artifact`.
It does **not** import app code (unlike the TS services under `../`).

## Layout

| File          | Role                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `features.py` | One SQL feature-assembly path for both train + serve (no train/serve skew) |
| `train.py`    | Fit the global quantile LightGBM; write `model_run` + `model_artifact`     |
| `infer.py`    | Load active model → bulk-upsert `queue_forecast` (near-term + day curve)   |
| `model_io.py` | Serialize the 3-booster bundle to/from the `model_artifact.artifact` bytea |
| `db.py`       | psycopg connection (`DATABASE_URL`) + `read_df` helper                     |
| `main.py`     | Entrypoint: `train` (daily) / `infer` (every 15 min)                       |

## Model & features (decisions, per plan §2e)

- **One global LightGBM** with `attraction_id` as a categorical (not per-ride;
  cold-start friendly, scales to ~4080 rides).
- **Quantile fits** at α = 0.1 / 0.5 / 0.9 → `lower` / `predicted_wait` / `upper`.
- **Horizon-as-feature** (single model). Near-term horizons {30, 60, 120} min;
  the next-day hourly curve uses the implied (larger) horizon.
- **As-of anchoring** prevents leakage: every "recent" lag is measured back from
  `asof_ts`, and training sets `asof_ts = target_ts − horizon`, so a row only
  ever sees data known that far ahead of the target. Weather joins
  `weather_obs.kind = 'FORECAST'` only. Splits are by time (`ML_VAL_DAYS` held out).
- **Model storage = Postgres `model_artifact` (bytea)**, NOT a Railway volume.
  The daily `train` and 15-min `infer` run in separate containers with no shared
  disk, so the bundle rides the DB. The blob is a tar of three `.txt` boosters +
  `meta.json` (`model_io.BUNDLE_FORMAT = 'lgb-quantile-tar-v1'`).

## Run

```sh
cd services/ml-train
pip install -e .            # or: pip install -e '.[dev]' for ruff + pytest
python main.py train        # fit + write next-day curve
python main.py infer        # near-term forecasts only
```

`DATABASE_URL` must point at the same Postgres the app uses. Requires the
forecasting migrations + `db:cagg` applied first (so `queue_15min` exists).

## Railway

Own service on this repo. `railpack.json` here selects the **python** provider
(the repo-root `railpack.json` is node — set this service's root to
`services/ml-train`). Two cron deployments share this code:

| Railway service | Schedule       | Start command          |
| --------------- | -------------- | ---------------------- |
| `ml-train`      | `0 6 * * *`    | `python main.py train` |
| `ml-infer`      | `*/15 * * * *` | `python main.py infer` |

Railpack build notes (learned the hard way):

- Deps install via **`requirements.txt`** (pip), not `pyproject.toml`. A bare
  PEP 621 `pyproject.toml` with no `[build-system]`/lockfile is the uncovered
  case where Railpack installs nothing — keep `requirements.txt` in sync.
- **LightGBM needs the OpenMP runtime at runtime**: `lib_lightgbm.so` dlopens
  `libgomp.so.1`, absent from the slim runtime image → `railpack.json` adds it
  via `deploy.aptPackages: ["libgomp1"]`. (Linux-only; not reproducible on macOS,
  which links `libomp.dylib`.)
- `startCommand` is set per-service in the Railway UI (train vs infer), NOT in
  `railpack.json`, so one config serves both crons.

## Knobs (env)

| Var                  | Default | Purpose                               |
| -------------------- | ------- | ------------------------------------- |
| `ML_TRAIN_DAYS`      | `60`    | history window for the training frame |
| `ML_VAL_DAYS`        | `7`     | most-recent days held out for val     |
| `ML_NUM_BOOST_ROUND` | `400`   | boosting rounds per quantile fit      |
