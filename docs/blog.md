# Blog + park-news pipeline

An in-app, DB-backed blog at `/blog` — no separate Astro build. It reuses the
app's SSR, edge caching, SEO helper, JSON-LD, and sitemap. LLM-drafted posts go
through a human approval gate before they're ever published.

## How it flows

```
cron-park-news (hourly/bihourly, Railway)
  → pull RSS (WDWMagic, Disney Parks Blog, Orlando Informer)
  → dedupe vs news_item
  → Gemini writes ORIGINAL analysis per salient item (capped per run)
  → INSERT blog_post status='draft'
/admin/blog (you, logged in)   → review → Publish  (or Archive)
  → status='published', publishedAt=now, edge purge of /blog + the post
/blog, /blog/$slug (public)    → SSR-prefetched, edge-cached, Article JSON-LD
/blog/rss.xml                  → feed of published posts
```

- Posts: [src/routes/blog/index.tsx](../src/routes/blog/index.tsx), [src/routes/blog/$slug.tsx](../src/routes/blog/$slug.tsx)
- Admin review queue: [src/routes/\_dash/admin.blog.tsx](../src/routes/_dash/admin.blog.tsx) → **/admin/blog** (owner-only, noindex)

> **Owner-only access.** The admin procedures use `adminProcedure`, which checks
> the logged-in user's email against `ADMIN_EMAILS` (comma-separated) — set this
> on the **web service**. It's **fail-closed**: if `ADMIN_EMAILS` is unset, no one
> can see or manage drafts (important, since signup is open). Set it to your email,
> e.g. `ADMIN_EMAILS=josh@composer.trade`.

- API: [src/integrations/trpc/routers/blog.ts](../src/integrations/trpc/routers/blog.ts) (public `list`/`bySlug`; protected `drafts`/`approve`/`reject`/`update`)
- Cron: [services/cron-park-news/main.ts](../services/cron-park-news/main.ts) (`bun run cron:park-news`)
- Tables: `blog_post`, `news_item` (migration `drizzle/20260613210000_blog/`)

## DB migration

Apply the new migration before deploying (creates `blog_post` + `news_item`):

```
bun run db:migrate    # or your usual apply step for drizzle/<ts>_blog/migration.sql
```

## Railway: the news cron

Add a cron service:

```
Start command: bun run cron:park-news
Schedule:      0 */2 * * *      # every 2 hours
```

Env vars on that service:

```
DATABASE_URL=<postgres url>     # required — same as the other cron services
GEMINI_API_KEY=<key>            # required; without it the cron no-ops
NEWS_MODEL=gemini-3.5-flash     # optional override
NEWS_MAX_DRAFTS=2               # optional, per-run ceiling (skips yield fewer)
NEWS_MAX_AGE_DAYS=4             # optional, ignore items older than this
NEWS_FEEDS=<csv of RSS urls>    # optional, overrides the ~10 default feeds
NEWS_USER_AGENT=<ua string>    # optional, override the browser UA
NEWS_WEB_SEARCH=1              # optional, set 0 to disable Google Search grounding
NEWS_SERVICE_TIER=flex        # "flex" (cheap, PAID TIER ONLY) or "standard" (free tier)
NEWS_MIN_INLINE_IMAGES=2      # optional, in-body image floor (palette top-up + media-thin flag)
NEWS_MAX_OUTPUT_TOKENS=16000  # optional, output ceiling (incl. thinking tokens)
NEWS_THINKING_LEVEL=low       # optional, minimal|low|medium|high (Gemini 3 thinking)
NEWS_REQUEST_TIMEOUT_MS=180000 # optional, per-request timeout for the grounded call
CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN   # optional: lets publish purge the edge
```

The cron uses **Gemini (`@google/genai`)** with **Google Search grounding** for
the light extra-research step — get a key from Google AI Studio.

> **Flex tier needs billing.** `serviceTier: flex` is the cheap tier but is
> **paid-tier only** — a free-tier key returns `429 RESOURCE_EXHAUSTED`. Either
> enable billing on the Google project (cost is pennies/month at this volume), or
> set `NEWS_SERVICE_TIER=standard` to stay on the free tier (tighter rate limits).
> The cron stops cleanly on a 429 and retries the items next run.

> **Empty / unparseable drafts.** Gemini 3 is a thinking model and thought
> tokens count against `maxOutputTokens` — with deep thinking a long prompt can
> spend the whole budget thinking and return an empty answer. The numeric
> `thinkingBudget` knob is a no-op on Gemini 3; thinking is controlled by
> `NEWS_THINKING_LEVEL` (default `low`), with the answer given headroom via
> `NEWS_MAX_OUTPUT_TOKENS` (default 12000). The unparseable-draft log prints
> `finish=` / `block=` / `parts=` + token usage: `finish=MAX_TOKENS` with
> `answer=0` means lower the thinking level / raise the ceiling; `block=…` means
> the item was filtered. A grounded call that hangs throws a `TimeoutError`
> (bounded by `NEWS_REQUEST_TIMEOUT_MS`, default 180s) and simply retries next run.

**Feeds.** ~9 confirmed `/feed/` endpoints (Disney Parks Blog, WDW News Today,
Blog Mickey, Inside the Magic, Attractions Magazine, AllEars, Orlando Informer,
Disney Tourist Blog, Disney Food Blog). The cron sends a browser User-Agent
(some sites 403 default agents) and logs each feed failure, so a changed URL
self-reports — swap via `NEWS_FEEDS` if needed.

**Cadence & no-repeat.** The cron only considers items from the last
`NEWS_MAX_AGE_DAYS`, and feeds the model each recent post's `ai_summary` (a dense
internal-only summary) so it SKIPS anything already covered — a quiet day yields
zero drafts rather than filler. Drafts are edited in a Markdown editor in
`/admin/blog` (rich preview + toolbar) before publishing.

**What's in a draft.** The writer prompt aims for human, opinionated analysis
(900–1300 words) — not corporate filler — and Search grounding lets it add: a real
attributed **quote** (blockquote) when one exists, **inline backlinks** (to
related `/blog/<slug>` posts and authoritative external pages), **inline images**
(`![alt](url)` + an italic `*Photo: …*` credit), and **social embeds** (a bare
TikTok / YouTube / Instagram / X post URL on its own line). Headlines are
normalized to consistent title case on insert.

**Verified media palette (the reliability trick).** Asking the model for live
image/embed URLs is fragile — it guesses paths that 404, and `validateBodyMedia`
then drops them, leaving a lone-hero post. So before writing, the cron
_harvests_ real media straight out of the source article
(`harvestSourceMedia`): content `<img>`s (skipping logos/icons/sprites/pixels)
and any embedded YouTube / TikTok / Instagram / X post — including YouTube embed
iframes, normalized to a watch URL. Each is liveness-checked (`verifyHarvest`)
and handed to the writer as a "VERIFIED MEDIA" palette it's told to prefer. The
post must carry **at least `NEWS_MIN_INLINE_IMAGES` (default 2)** in-body images;
if the finished body falls short (or carries no embed), `ensureBodyMedia` tops it
up from the leftover palette with a correct `*Photo: [source](url)*` credit.
Anything still under the floor is logged and flagged **media-thin** in the review
queue (a count-based badge — no schema change). Internal `/blog/<slug>` backlinks
are validated against real slugs too (`validateInternalLinks`); a hallucinated
one is unwrapped to plain text. The post page also shows an **"Originally
reported by …"** byline linking the primary source.

**Media & link validation (cron, before insert).** Hallucinated media and dead
links never reach review: every inline image URL is fetched (`isLiveImage`) and
dropped with its credit line if it 404s / isn't an image; every social URL is
verified to exist (`socialExists`, via oEmbed where available) and dropped
otherwise; and every cited source plus every external inline link is liveness-
checked (`isDeadLink`: HEAD then a GET recheck) — a confirmed-dead source (404/
410/bad host) is dropped from the list and a dead inline link is unwrapped to
plain text. The check is deliberately conservative: only an unambiguous 404/410
or a non-resolving host counts as dead, so a bot-blocked (403/429) or slow
source is kept rather than false-dropped. The original feed URL is always kept
(it came from the feed). The renderer
([src/server/blog/render.ts](../src/server/blog/render.ts)) turns a surviving
social URL into a sandboxed iframe via a post-sanitization token, so `<iframe>`
stays blanket-stripped everywhere else. Shared parser/embed logic lives in
[src/server/blog/embeds.ts](../src/server/blog/embeds.ts).

For the **hero image** the cron deterministically pulls the source article's
OpenGraph image (also liveness-checked) and credits it back to that source
(`hero_image_url` + `hero_image_credit`/`_credit_url`/`_alt`); that hero doubles
as the post's `og:image`. The review screen shows the hero with an editable URL —
clear it to drop a bad image before publishing. Migration:
`drizzle/20260614120000_blog_hero_credit_and_richer/`.

## Cloudflare: cache /blog

Add Cache Rules (same pattern as [edge-caching.md](edge-caching.md)) — but
**exclude `/admin`** (it's already in the bypass rule via `starts_with /admin`):

| When (URI Path)                    | Action                                                              |
| ---------------------------------- | ------------------------------------------------------------------- |
| `eq /blog` OR `starts_with /blog/` | Eligible for cache · Edge TTL 300s · Serve stale while revalidating |

Publishing a post calls `purgeEdge(["/blog", "/blog/<slug>", "/blog/rss.xml", "/sitemap.xml"])`,
so approved posts appear immediately rather than after the TTL.

## Quality / safety notes

- **Approval gate is mandatory** — drafts never auto-publish. This is the guard
  against Google's "scaled content abuse" policy; edit drafts (`update`) or
  archive weak ones before publishing.
- The LLM is prompted for original analysis (not rewrites) and to cite + link
  the source; sources render with `rel="nofollow"`. Internal park links are
  validated against real slugs (hallucinated slugs are dropped).
- Post bodies are sanitized server-side ([src/server/blog/render.ts](../src/server/blog/render.ts))
  before render.
