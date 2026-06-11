"""Serialize the quantile-booster bundle to/from a single `bytea` blob.

Layout `lgb-quantile-tar-v1`: an uncompressed tar holding `q10.txt`, `q50.txt`,
`q90.txt` (LightGBM text models) and `meta.json` (feature order + categoricals).
The blob is stored in `model_artifact.artifact`; both `train` and `infer` go
through here so the on-disk/on-wire format has exactly one definition.
"""

from __future__ import annotations

import io
import json
import tarfile

import lightgbm as lgb

BUNDLE_FORMAT = "lgb-quantile-tar-v1"
QUANTILES = {"q10": 0.1, "q50": 0.5, "q90": 0.9}


def save_bundle(boosters: dict[str, lgb.Booster], meta: dict) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:

        def _add(name: str, data: bytes) -> None:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))

        for key, booster in boosters.items():
            _add(f"{key}.txt", booster.model_to_string().encode("utf-8"))
        _add("meta.json", json.dumps(meta).encode("utf-8"))
    return buf.getvalue()


def load_bundle(blob: bytes) -> tuple[dict[str, lgb.Booster], dict]:
    boosters: dict[str, lgb.Booster] = {}
    meta: dict = {}
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r") as tar:
        for member in tar.getmembers():
            f = tar.extractfile(member)
            if f is None:
                continue
            payload = f.read()
            if member.name == "meta.json":
                meta = json.loads(payload.decode("utf-8"))
            elif member.name.endswith(".txt"):
                key = member.name[: -len(".txt")]
                boosters[key] = lgb.Booster(model_str=payload.decode("utf-8"))
    return boosters, meta
