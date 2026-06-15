# Pin traders — cold photo identification + trading board

> **Theme:** Add a pin-trading section that lets a collector point their phone at a
> Disney pin **with no prior context** and get back "this is _X_, here's its catalog
> entry, market value, and who near you will trade for it." This is a direct
> replacement for apps like PinTrader. The identification model is a few weeks of
> plumbing; the **reference dataset and the community-confirmation flywheel are the
> moat.** Everything below is sized to reach a useful product on the cheapest
> defensible path, reusing the infra we already run.

## Core insight

Cold pin ID is not one hard problem, it's three, and only one of them is hard:

1. **The reference dataset** (hard, slow, the real moat) — you cannot identify a pin
   you have no reference image for. ~100k+ pins have shipped over 25 years.
2. **The identification cascade** (easy, a few days of plumbing) — embedding search →
   reverse-image lookup → LLM re-rank → human confirm. Each stage is cheap and
   well-understood.
3. **The trading layer** (easy, standard CRUD) — have/want lists, mutual-match query,
   offers. This is where we actually _differentiate_; PinTrader's social/trade layer
   is thin.

The strategic move is to **ship identification that's merely good-enough on day one,
then let community confirmations compound it.** Every time a user confirms "yes, that's
the pin," we mint a labeled training pair. That feedback loop — not the model — is what
took the incumbents years to build, and it's reproducible faster than it looks if we
design for it from the first commit.

The whole feature rides on infra we **already operate**: Better-Auth, R2 uploads,
BullMQ workers, Timescale Postgres, a Python ML service pattern (`ml-train`), the
Claude-API cron pattern (`cron-park-news`), and tRPC + trigram search. The only
genuinely new building block is a vector index (`pgvector`, one `CREATE EXTENSION`)
and a small CLIP embedding service modeled on the Python service we already deploy.

## Decisions to lock in

- **Self-host the embedding model; don't pay per-embed.** A small Python service
  (`open_clip`, ViT-L/14) exposing `/embed`, modeled on the existing `ml-train`
  Python service on Railway. One forward pass per image, CPU is fine at launch
  (~0.5–2 s/image behind a scan spinner), no per-call API fee. This is dramatically
  cheaper than Google Product Search or HuggingFace Inference at any real volume, and
  it's the same deploy shape we already run.
- **Vector search lives in the DB we already have.** `CREATE EXTENSION vector` on
  Timescale; store embeddings in a `pin_embedding` table; ANN via HNSW (or
  `pgvectorscale` StreamingDiskANN if we want it). 100k vectors is trivial — sub-10ms
  queries. No new datastore.
- **Identification is a cascade with confidence gates, not a single model call.**
  Stage 1 CLIP (free, ~70% recall) → Stage 2 Google Vision Web Detection (only when
  Stage 1 is unsure) → Stage 3 LLM vision re-rank (only when still unsure) → Stage 4
  human confirm (always, on low confidence — and it _feeds the dataset_). Spend money
  only on the long tail.
- **Build the confirmation flywheel from commit #1.** Every scan + the user's
  confirmed answer is logged as a labeled pair (`pin_scan`). This is the asset. Even
  the v1 that's "only okay" at ID gets better every week _automatically_, and seeds an
  eventual fine-tune.
- **Dataset bootstrap: PinPics + eBay in week 1, owned data compounds.** PinPics is
  the broadest clean catalog (isolated, front-facing reference images + structured
  metadata) and is **established practice** for the pin-trading tooling ecosystem —
  other apps already source from it and PinPics has been fine with it. So it's a
  **primary week-1 source**, alongside eBay Browse (licensed, for prices + newer-wave
  images) and official Disney release pages. Our own user-contributed catalog grows on
  top. (Provenance still tracked per image — see Legal & ToS.)
- **Trade, don't sell.** Pin-for-pin swaps + want/have matching only. No cash escrow,
  no payments, no marketplace fraud surface in v1. Cash sales → point at eBay.
- **Force good photos instead of fighting bad ones.** A guided capture UX (flat
  surface, good light, one pin) plus server-side background removal (`rembg`, free)
  beats any amount of model spend at compensating for glare-on-enamel hand-held shots.

## Validated economics (June 2026)

Per-scan cost of the cascade, assuming Stage 2 fires when Stage 1 confidence < 0.85
and Stage 3 fires when combined confidence < 0.90:

| Scans/day | Stage 1 CLIP (self-host) | Stage 2 Web Detection¹ | Stage 3 LLM re-rank² | **Total/mo** |
| --------- | ------------------------ | ---------------------- | -------------------- | ------------ |
| 100       | ~$0                      | ~$0 (under free tier)  | <$1                  | **~$0–1**    |
| 500       | ~$0                      | ~$26                   | ~$1.50               | **~$28**     |
| 2,000     | ~$3 (host)               | ~$105                  | ~$6                  | **~$114**    |
| 10,000    | ~$10 (host)              | ~$525                  | ~$30                 | **~$565**    |

Web Detection dominates at scale — so **cache its result per identified pin** and only
call it for genuinely-unseen photos. With caching, the middle column collapses toward
zero for popular pins.

One-time bootstrap: CLIP-embed the full reference catalog in a single GPU batch job
(~$10, ~1 hr on Modal/Vast.ai) + LLM normalization of titles into structured fields
(~$15–30 via Claude Haiku, reusing the `cron-park-news` Claude pattern).

¹ Google Cloud Vision Web Detection: **$3.50 / 1,000**, first **1,000/mo free**.
² Gemini Flash-class vision: **~$0.0006 / input image** standard res; ~10 candidate
thumbnails + query + prompt per re-rank ≈ well under 1¢/scan. Claude Haiku / GPT-4o-mini
are comparable alternatives.

## Architecture

```
                            ┌──────────────────────── CLIENT (React 19 + TanStack Router) ───────────────────────┐
                            │  guided capture UX → upload → poll/stream candidates → confirm pick                  │
                            └───────────────┬───────────────────────────────────────────────┬───────────────────┘
                                            │ scan (image)                                   │ browse / collection / trade
                                            ▼                                                ▼
                  ┌──────────────────────────────────────────┐         ┌──────────────────────────────────────────┐
                  │ tRPC  pinIdentify.scan  (rate-limited)    │         │ tRPC pinCatalog / pinCollection / pinTrade │
                  │  1. presign + store photo → R2            │         │  (public browse; protectedProcedure CRUD)  │
                  └───────────────┬──────────────────────────┘         └───────────────┬────────────────────────────┘
                                  │ enqueue scan job (BullMQ)                           │
                                  ▼                                                     ▼
        ┌─────────────────────────────────────────────────┐              ┌──────────────────────────────────────┐
        │ IDENTIFICATION CASCADE  (worker)                 │              │ Postgres + Timescale                 │
        │                                                  │              │  pin, pin_image                      │
        │  rembg (bg removal)                              │              │  pin_embedding  vector(768) + HNSW   │
        │        │                                         │  pgvector    │  pin_have / pin_want                 │
        │        ▼                                         │◄────ANN──────│  pin_offer                           │
        │  ① CLIP /embed (self-host Python svc)            │  query       │  pin_scan  (labeled flywheel log)    │
        │        │  nearest-N in pin_embedding             │─────────────►│                                      │
        │        ▼  conf ≥ 0.85? ──yes──────────────┐      │              └──────────────────────────────────────┘
        │  ② Google Vision Web Detection (cached)    │      │
        │        │  conf ≥ 0.90? ──yes───────────────┤      │              ┌──────────────────────────────────────┐
        │        ▼                                   │      │              │ EXTERNAL                             │
        │  ③ LLM vision re-rank (Gemini/Haiku)       │      │              │  eBay Browse API  (catalog seed,     │
        │        │                                   │      │              │     prices, images — licensed)       │
        │        ▼                                   ▼      │              │  Disney release pages (new waves)    │
        │  ④ candidates + confidence ──────────────────────┼─────────────►│  Google Vision (web detection)       │
        │        │                                          │              │  LLM API (re-rank + normalize)       │
        └────────┼──────────────────────────────────────────┘             └──────────────────────────────────────┘
                 ▼  user confirms pick
        ┌─────────────────────────────────────────────────┐              ┌──────────────────────────────────────┐
        │ pin_scan += {photo, chosen_pin, conf, source}    │              │ services/pin-catalog  (cron/one-off) │
        │   → labeled pair → embed confirmed photo too     │              │   eBay sweep → LLM normalize →       │
        │   → (periodic) fine-tune CLIP from accumulated   │              │   upsert pin + enqueue embed job     │
        │     pairs   ── THE FLYWHEEL ──                    │              │ services/pin-embed (Python/open_clip)│
        └─────────────────────────────────────────────────┘              │   /embed → vectors → pin_embedding   │
                                                                          └──────────────────────────────────────┘
                                  trade matches / offers
                                            │ BullMQ notification worker (existing) → web-push + Resend email
                                            ▼
                                  "someone has the pin you want"
```

## Identification cascade — stage detail

- **Preprocess — `rembg` (free, self-hosted).** Isolate the pin from lanyard/hand/
  clutter before embedding. Plus guided-capture UX guidance up front. Biggest accuracy
  lever per dollar.
- **Stage 1 — CLIP embedding search (~free, ~70% recall).** Embed the query photo via
  the self-hosted service; `ORDER BY embedding <=> $1 LIMIT 10` against `pin_embedding`
  (HNSW index). Returns top-N visual neighbors in <10 ms. Vanilla `open_clip` ViT-L/14
  at launch; fine-tune later on accumulated `pin_scan` pairs for a domain bump.
- **Stage 2 — Google Vision Web Detection (~+15% recall, $3.50/1k, cached).** Only when
  Stage 1 is unsure. Reverse-image-search the web — 25 years of collector uploads on
  eBay/Pinterest/fan sites mean many pins have an indexed match even before our own
  catalog covers them. **Cache result per pin** so popular pins never re-query.
- **Stage 3 — LLM vision re-rank (~+12% precision, <1¢).** Pass the query photo + the
  top-10 candidate reference images to a Flash-class vision model; it reads pin text,
  characters, LE stamps, series markers and picks the best match with a rationale —
  exactly the distinctions humans use between near-identical variants.
- **Stage 4 — human confirm (free, and it's the point).** On low confidence, show top-3
  and let the user pick. Every pick is a labeled pair appended to `pin_scan` and the
  confirmed photo is embedded into the reference set. This is the compounding asset.

## Schema

Hand-written migration `drizzle/<ts>_pin_traders/migration.sql` (repo convention — no
`drizzle-kit generate`, no `_journal.json`). Requires `CREATE EXTENSION IF NOT EXISTS vector;`.

```sql
-- Reference catalog ------------------------------------------------------------
CREATE TABLE pin (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  series       text,
  characters   text[],
  year         smallint,
  edition_type text,                 -- 'open' | 'LE' | 'LR' | 'cast' | ...
  le_count     integer,             -- limited-edition size, null = open
  park         text,
  est_value_cents integer,          -- from eBay sold comps
  source       text NOT NULL,       -- 'ebay' | 'disney' | 'user' | 'community'
  source_ref   text,               -- external id for provenance/dedup
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pin_image (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pin_id    uuid NOT NULL REFERENCES pin(id) ON DELETE CASCADE,
  r2_key    text NOT NULL,          -- canonical reference image in R2
  is_primary boolean NOT NULL DEFAULT false,
  source    text NOT NULL
);

CREATE TABLE pin_embedding (
  pin_image_id uuid PRIMARY KEY REFERENCES pin_image(id) ON DELETE CASCADE,
  pin_id       uuid NOT NULL REFERENCES pin(id) ON DELETE CASCADE,
  embedding    vector(768) NOT NULL,    -- open_clip ViT-L/14 = 768-dim
  model        text NOT NULL            -- e.g. 'open_clip:ViT-L-14:v1' (track for re-embeds)
);
CREATE INDEX pin_embedding_hnsw ON pin_embedding USING hnsw (embedding vector_cosine_ops);

-- User collection --------------------------------------------------------------
CREATE TABLE pin_have (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  pin_id    uuid NOT NULL REFERENCES pin(id),
  quantity  smallint NOT NULL DEFAULT 1,
  condition text CHECK (condition IN ('mint','near_mint','good','worn')),
  for_trade boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, pin_id)
);

CREATE TABLE pin_want (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  pin_id    uuid NOT NULL REFERENCES pin(id),
  max_value_cents integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, pin_id)
);

-- Trading ----------------------------------------------------------------------
CREATE TABLE pin_offer (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  to_user_id      text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  offering_pins   jsonb NOT NULL,      -- [{pinId, quantity}]
  requesting_pins jsonb NOT NULL,      -- [{pinId, quantity}]
  message         text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pin_offer_to_idx   ON pin_offer (to_user_id, status);
CREATE INDEX pin_offer_from_idx ON pin_offer (from_user_id, status);

-- The flywheel -----------------------------------------------------------------
CREATE TABLE pin_scan (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text REFERENCES "user"(id) ON DELETE SET NULL,
  photo_r2_key  text NOT NULL,
  candidates    jsonb NOT NULL,        -- [{pinId, score, stage}] returned to user
  chosen_pin_id uuid REFERENCES pin(id),  -- null = user abandoned / "not listed"
  top_confidence real,
  stage_resolved smallint,             -- 1..4: which stage produced the pick
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pin_scan_label_idx ON pin_scan (chosen_pin_id) WHERE chosen_pin_id IS NOT NULL;
```

## Services & routers

New Railway services (mirror existing `services/cron-*` and the Python `ml-train` shape):

| Service                 | Shape                                         | Job                                                                                                                                  |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `services/pin-embed`    | Python (FastAPI + `open_clip`)                | `/embed` endpoint; CPU at launch. Embeds reference images and live scan photos.                                                      |
| `services/pin-catalog`  | TS cron / one-off (`cron-park-news` template) | eBay Browse sweep → Claude Haiku normalize → upsert `pin`/`pin_image` → enqueue embed jobs. Periodic refresh for prices + new waves. |
| `services/pin-identify` | BullMQ worker (existing queue infra)          | Runs the cascade: rembg → CLIP → (gate) Web Detection → (gate) LLM re-rank → write `pin_scan`.                                       |

New tRPC routers (`server/trpc/routers/`):

| Router          | Procedures                                                                                                    | Auth                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `pinCatalog`    | `search`, `detail`, `browse` (series/character/year/price filters; reuse trigram search pattern)              | public                                           |
| `pinIdentify`   | `scan` (presign + enqueue), `result` (poll/stream candidates), `confirm` (write label, embed confirmed photo) | rate-limited; `protectedProcedure` for `confirm` |
| `pinCollection` | have/want CRUD, `toggleForTrade`                                                                              | protected                                        |
| `pinTrade`      | `matches` (mutual-match query), `createOffer`, `respondOffer`, `myOffers`                                     | protected                                        |

Mutual-match query is pure Postgres (no new service): "traders who _have_ a pin I _want_
AND _want_ a pin I _have for trade_," ranked by overlap size, indexed on
`(user_id, pin_id)`. Trivially fast at 10k+ users.

## Reuse summary (keeps this small)

- **Auth:** Better-Auth + `protectedProcedure` — zero work to gate collection/trade.
- **Uploads:** the existing `uploads` router + R2 presign pattern (avatars) → pin
  photos and reference images, same flow.
- **Async + notifications:** existing BullMQ + the notification worker (web-push +
  Resend) → scan jobs, embed jobs, and "someone wants to trade" alerts.
- **LLM plumbing:** the `cron-park-news` Claude-API pattern → title normalization and
  Stage-3 re-rank.
- **Python service shape:** `ml-train` is the deploy template for `pin-embed`; the
  eventual CLIP fine-tune slots into the same training cadence.
- **Search:** the trigram-indexed search router → catalog text search / Stage-1 text
  fallback when image ID is ambiguous.
- **Cron scaffold + migration convention:** `services/cron-*` structure; hand-written
  timestamped `migration.sql` (no `_journal.json`).

## Phased rollout

- **Phase 0 — reference dataset (the actual work).** PinPics crawl (clean catalog
  images + metadata, the coverage backbone) + eBay Browse seed (segmented queries; see
  ToS note) + official Disney waves → Claude Haiku normalize → R2 + `pin`/`pin_image`.
  One-time GPU batch embed (~$10). Stand up `pin-embed`. _No app UI yet._ This phase
  determines whether the feature works at all — budget time here.
- **Phase 1 — ship ID (Stages 1 + 3 + 4) + catalog browse + collection.** CLIP search
  → LLM re-rank → human confirm; `pinCatalog` browse; have/want lists. Validate the
  scan UX and start the flywheel. _No Web Detection yet_ — measure Stage-1-alone
  accuracy first.
- **Phase 2 — add Web Detection (Stage 2) + trading board.** Add Stage 2 only if
  Phase-1 metrics show Stage 1 missing too often; cache aggressively. Ship
  `pinTrade` matches + offers + notifications — the differentiator.
- **Phase 3 — fine-tune CLIP on `pin_scan` pairs.** Once a few thousand confirmations
  accumulate, fine-tune (~$50–150 on Modal/Vast.ai) for the compounding accuracy edge.

## Legal & ToS (read before Phase 0)

- **eBay Browse API:** licensed under eBay's API TOS — the defensible primary source
  for titles, sold-comp prices, and images. **Constraints validated:** ~**5,000
  req/day** standard cap **and** a hard **10,000-results-per-query-window** ceiling, so
  seeding must use _segmented_ queries (by series/character/year buckets), not one
  giant sweep. Plan the bootstrap as a multi-day, bucketed crawl within rate limits.
- **PinPics — primary week-1 source.** Active and current (adding 2026 waves), with
  clean, isolated, front-facing reference images and structured metadata — the ideal
  Stage-1 reference shape. Sourcing from PinPics is **established practice** across the
  pin-trading tooling ecosystem and they've been okay with it, so it's a default here,
  not a flagged risk. Still: crawl politely (rate-limit, identify the UA, cache), and
  store provenance so we can purge by source if their stance ever changes.
- **Other community DBs (Pin Trading DB, Pin & Pop, Disney Pinventory):** useful
  gap-fillers for anything PinPics/eBay miss; same polite-crawl + provenance rules.
- **Reference images:** store provenance (`source`/`source_ref`) on every image so we
  can purge by source if a takedown or license change ever requires it.
- **User photos:** standard UGC handling — consent, deletion/export (the app already
  has a privacy posture for alerts), and don't expose other users' collections beyond
  what they opt to list `for_trade`.

## Out of scope (v1)

- Cash transactions / escrow / marketplace payments — pin-for-pin only; cash → eBay.
- In-app chat — coordinate trades via existing notifications + email; point to Discord.
- Formal grading/appraisal guarantees — eBay sold comps are the value signal, no
  promises.
- Counterfeit ("scrapper" pin) detection — known-hard, defer; maybe a Phase-3+ model
  trained on confirmed-fake labels.
- Geo/local trade matching — nice, but ships after the core match query proves out.

## Open questions

1. **Embedding model + dim:** `open_clip` ViT-L/14 (768-dim) as proposed, or ViT-B/32
   (512-dim, faster/cheaper, slightly lower recall) for the CPU-host launch? Schema
   pins the dim, so decide before the migration (or store `model` + allow re-embed).
2. **Scan latency budget:** CPU embed (~0.5–2 s) behind a spinner at launch, or pay for
   a small GPU host from day one for a snappier scan? Likely CPU first, GPU when volume
   justifies.
3. **Catalog cold-start coverage:** what % of the ~100k-pin universe must Phase 0 cover
   before ID feels "magic" vs. "often not listed"? PinPics + eBay should get most of
   the way; this sets how hard we lean on the other community DBs to close gaps.
4. **Stage-2 default:** ship Phase 1 with Web Detection off (measure Stage-1 recall
   first) — confirmed plan — but agree the recall threshold that would turn it on.
5. **`pin_scan` retention/consent:** how long do we keep user scan photos for the
   flywheel, and is the training-use consent explicit at capture time?

```

```
