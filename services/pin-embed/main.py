"""pin-embed — self-hosted CLIP embedding service (Railway, replica = 1).

One forward pass per image, no per-call API fee. This is the cheap Stage-1
backbone of the pin identification cascade (see docs/plans/pin-traders.md). CPU
is fine at launch (~0.5-2 s/image behind a scan spinner); swap to a GPU host when
volume justifies it.

Contract (the ONLY contract with the app — it never imports app code):

  POST /embed   { "urls": [...] }  or  { "images": [<base64>, ...] }
       -> 200   { "model": "open_clip:ViT-L-14:v1", "embeddings": [[...768], ...] }
  GET  /health  -> 200 { "ok": true, "model": "...", "ready": <bool> }

Embeddings are L2-normalized so cosine distance (pgvector `<=>`) is meaningful.

Run:  python main.py        (local; binds $PORT, default 8000)

On Railway the start command pins the port and binds IPv6 dual-stack
(`uvicorn main:app --host :: --port 8000`, see railpack.json): the port is
deterministic so callers always target :8000, and `::` is required because
Railway's private network is IPv6-only — an IPv4-only bind (`0.0.0.0`) is
unreachable over *.railway.internal and refuses every internal connection.
"""

from __future__ import annotations

import base64
import io
import os
from typing import Optional

import open_clip
import torch
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel
import httpx
import uvicorn

# ViT-L/14 = 768-dim, matching the `vector(768)` column. Override via env to
# re-embed under a different model (also bump PIN_EMBED_MODEL in the app).
MODEL_NAME = os.environ.get("OPEN_CLIP_MODEL", "ViT-L-14")
PRETRAINED = os.environ.get("OPEN_CLIP_PRETRAINED", "openai")
MODEL_TAG = os.environ.get("PIN_EMBED_MODEL", "open_clip:ViT-L-14:v1")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

app = FastAPI(title="pin-embed")

_model = None
_preprocess = None


def get_model():
    """Lazy-load the model on first request so /health is up immediately."""
    global _model, _preprocess
    if _model is None:
        model, _, preprocess = open_clip.create_model_and_transforms(
            MODEL_NAME, pretrained=PRETRAINED
        )
        model.eval().to(DEVICE)
        _model = model
        _preprocess = preprocess
    return _model, _preprocess


class EmbedRequest(BaseModel):
    urls: Optional[list[str]] = None
    images: Optional[list[str]] = None  # base64, no data-URI prefix


class EmbedResponse(BaseModel):
    model: str
    embeddings: list[list[float]]


def _load_from_url(client: httpx.Client, url: str) -> Image.Image:
    resp = client.get(url, timeout=20.0, follow_redirects=True)
    resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content)).convert("RGB")


def _load_from_b64(data: str) -> Image.Image:
    raw = base64.b64decode(data)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def _embed(images: list[Image.Image]) -> list[list[float]]:
    model, preprocess = get_model()
    batch = torch.stack([preprocess(img) for img in images]).to(DEVICE)
    with torch.no_grad():
        feats = model.encode_image(batch)
        feats = feats / feats.norm(dim=-1, keepdim=True)  # L2 normalize
    return feats.cpu().tolist()


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": MODEL_TAG, "ready": _model is not None}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    if not req.urls and not req.images:
        raise HTTPException(status_code=400, detail="provide `urls` or `images`")

    images: list[Image.Image] = []
    try:
        if req.images:
            images.extend(_load_from_b64(d) for d in req.images)
        if req.urls:
            with httpx.Client() as client:
                images.extend(_load_from_url(client, u) for u in req.urls)
    except Exception as exc:  # noqa: BLE001 — surface decode/fetch errors to caller
        raise HTTPException(status_code=400, detail=f"image load failed: {exc}") from exc

    embeddings = _embed(images)
    return EmbedResponse(model=MODEL_TAG, embeddings=embeddings)


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    # Bind IPv6 dual-stack (`::`), NOT `0.0.0.0`: Railway's private network is
    # IPv6-only, so an IPv4-only bind is unreachable over *.railway.internal and
    # every internal call gets ECONNREFUSED. `::` accepts both v6 and v4.
    uvicorn.run(app, host="::", port=port)


if __name__ == "__main__":
    main()
