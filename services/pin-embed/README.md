# pin-embed

Self-hosted CLIP embedding service for ParkFi pin identification. One forward
pass per image, no per-call API fee — the cheap Stage-1 backbone of the
identification cascade (see `docs/plans/pin-traders.md`).

## Contract

The HTTP API is the **only** contract with the app (it never imports app code):

```
POST /embed   { "urls": [...] }  or  { "images": [<base64>, ...] }
     -> { "model": "open_clip:ViT-L-14:v1", "embeddings": [[...768], ...] }
GET  /health  -> { "ok": true, "model": "...", "ready": <bool> }
```

Embeddings are 768-dim (ViT-L/14), L2-normalized so pgvector cosine distance
(`<=>`) is meaningful. The model tag is stored on every `pin_embedding.model`.

## Run locally

```
pip install -r requirements.txt
python main.py            # binds $PORT (default 8000)
```

## Deploy (Railway)

Railpack (`railpack.json`) installs from `requirements.txt` and runs
`python main.py`. CPU is fine at launch; the app reaches it over the private
network at `PIN_EMBED_URL`. Env knobs: `OPEN_CLIP_MODEL`, `OPEN_CLIP_PRETRAINED`,
`PIN_EMBED_MODEL` (the tag stored in the DB — bump it when you re-embed).

## Bootstrap embed

The one-time catalog embed (~$10 GPU batch) just POSTs every reference image URL
to `/embed` in batches; the `pin-catalog` cron enqueues per-image embed jobs that
the `pin-identify` worker drains through this same endpoint.
