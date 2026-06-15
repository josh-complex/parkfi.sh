# Blog — periodic link-rot re-check for published posts

> **Theme:** We now liveness-check every source citation, inline link, image, and
> embed _at draft time_ (`services/cron-park-news`, `isDeadLink`/`isLiveImage`/
> `socialExists`). But a link that was alive when a post published can 404 months
> later — link rot. Nothing re-checks a post once it's live, so a published post
> slowly accumulates broken "Sources" links and dead embeds with no signal to us.

## Core insight

This is the same shape as the rest of the site: **stop trusting a one-time check;
sweep on a schedule into a freshness column, and surface what's gone stale.** The
draft-time gate proves the link was good _at publish_; a recheck cron proves it's
_still_ good. We already have the verification primitives — this plan is mostly
**scheduling + a flag, not new validation logic.**

The one hard rule that shapes everything: **never silently edit a published post.**
Unlike a draft (where we freely drop dead media before a human ever sees it), a live
post is indexed, linked, and trusted. A recheck that finds rot should **flag the post
for human review**, not rewrite it behind the author's back. Auto-repair is a possible
later mode, opt-in per-post-type, but v1 is detect-and-flag.

## Decisions to lock in

- **Detect, don't mutate (v1).** A confirmed-dead link flips the post into a review
  state and lists exactly which URLs failed. The human fixes it in `/admin/blog`
  (already a Markdown editor) and re-publishes. No silent unwrapping of live content.
- **Conservative + debounced.** Reuse the existing conservative `isDeadLink`
  (only 404/410/non-resolving host = dead; 403/429/5xx/timeout = kept). On top of
  that, require **2 consecutive dead observations across separate runs** before
  flagging — single-run failures flap (a CDN hiccup, a momentary 5xx that slips
  through, a rate-limit that briefly 404s). One green observation resets the counter.
- **Oldest-checked-first, capped per run.** Same least-recently-swept pattern as the
  stays/dining crons — a `links_checked_at` column, `ORDER BY links_checked_at NULLS
FIRST`, `LIMIT NEWS_LINKCHECK_BATCH`. The whole corpus drains over days, not in one
  hammering run that could itself look like a scraper.
- **Scope = everything a reader can click.** `source_urls` (jsonb), inline body
  links, inline body images, hero image, social embeds. Reuse `isDeadLink` for
  links, `isLiveImage` for images, `socialExists` for embeds — the exact functions
  the draft path uses, so the two paths can't drift on "what counts as dead."

## Prerequisite refactor: share the validators

`isDeadLink` and `isLiveImage` currently live _inside_
`services/cron-park-news/main.ts`. Before a second consumer exists, extract them
(with the shared `UA`) into **`src/server/blog/links.ts`**, mirroring how
`embeds.ts` already isolates `parseSocialUrl`/`socialExists`. Both crons import from
there. This is the same "shared parser so the two halves can't drift" rationale
already documented for embeds.

```
src/server/blog/
  embeds.ts   ← parseSocialUrl, socialExists, embedHtml  (exists)
  links.ts    ← isDeadLink, isLiveImage, UA              (NEW — extracted)
  render.ts   ← markdown → sanitized html                (exists)
```

`services/cron-park-news/main.ts` swaps its local definitions for imports; no
behavior change there (verify drafts still validate identically after the move).

## Architecture

```
blog_post (status=published) ──(oldest links_checked_at first, LIMIT N)──► services/blog-linkcheck (cron, daily-ish)
                                                                                │ per post: extract URLs
                                                                                │   - source_urls[]        → isDeadLink
                                                                                │   - inline [text](url)   → isDeadLink
                                                                                │   - inline ![alt](img)   → isLiveImage
                                                                                │   - hero_image_url       → isLiveImage
                                                                                │   - social embed URLs    → socialExists
                                                                                ▼
                                                  any confirmed-dead?  ─no──► stamp links_checked_at = now(), clear dead_link_count
                                                          │ yes
                                                          ▼ dead_link_count++ , stamp links_checked_at
                                                  dead_link_count >= 2 ? ─no──► (wait for next run to confirm)
                                                          │ yes
                                                          ▼ status='needs_review', store dead_links jsonb
                                                  /admin/blog review queue shows the post + which URLs broke
                                                          │ human edits + re-publishes (clears flag)
```

## Schema

Migration `drizzle/<ts>_blog_link_health/` (hand-written per repo convention — no
`drizzle-kit generate`, no `_journal.json`):

```sql
ALTER TABLE blog_post
  ADD COLUMN links_checked_at timestamptz,            -- last recheck sweep (NULL = never)
  ADD COLUMN dead_link_count  integer NOT NULL DEFAULT 0,  -- consecutive dead-observation runs
  ADD COLUMN dead_links       jsonb   NOT NULL DEFAULT '[]'::jsonb;  -- [{url, kind, status}] last failure

-- Sweep ordering: published posts, least-recently-checked first.
CREATE INDEX blog_post_linkcheck_idx
  ON blog_post (links_checked_at NULLS FIRST)
  WHERE status = 'published';
```

Reuse the existing `status` column for the flag. Today it's `'draft' | 'published'
| 'archived'`; add **`'needs_review'`** as a fourth value. A post in `needs_review`
is no longer `published` → it should fall out of the public list/index immediately
(decide: hard-pull from `/blog` vs. keep serving with a stale-link banner — see Open
questions). The `dead_links` jsonb drives the admin display ("these 2 URLs 404'd").

## Service: `services/blog-linkcheck/main.ts`

Model it on `cron-park-news/main.ts` (env-config block, `db` import, batch loop,
per-item try/catch, summary log). Skeleton:

1. **Select batch.** `SELECT id, slug, body_md, source_urls, hero_image_url FROM
blog_post WHERE status = 'published' ORDER BY links_checked_at NULLS FIRST LIMIT
$batch`.
2. **Extract URLs per post.** Body links via `BODY_LINK_RE`, images via
   `BODY_IMG_RE`, embeds via `parseSocialUrl` per line (same regexes as the draft
   path — move them into `links.ts` too, or import). Plus `source_urls[].url` and
   `hero_image_url`.
3. **Check each** with the matching validator (`isDeadLink` / `isLiveImage` /
   `socialExists`). Collect confirmed-dead ones with `{url, kind, status}`.
4. **Update.** Always stamp `links_checked_at = now()`. If clean → `dead_link_count
= 0`, `dead_links = '[]'`. If dead → `dead_link_count++`, store `dead_links`; when
   the counter reaches 2, set `status = 'needs_review'` and purge the edge cache for
   `/blog/<slug>` and `/blog` (same purge the publish path already does).
5. **Summary log** — `checked N, M flagged for review` — matching house style.

Env knobs (mirror the news cron's naming):

| Var                    | Default     | Purpose                                   |
| ---------------------- | ----------- | ----------------------------------------- |
| `LINKCHECK_BATCH`      | `25`        | posts per run (oldest-checked-first)      |
| `LINKCHECK_DEAD_RUNS`  | `2`         | consecutive dead runs before flagging     |
| `LINKCHECK_USER_AGENT` | shared `UA` | browser-ish UA (sites 403 default agents) |

Railway cron entry: daily is plenty (link rot is slow); `0 8 * * *`. With
`LINKCHECK_BATCH=25` the whole corpus rechecks every `ceil(total/25)` days.

## Admin surface

`/admin/blog` already lists drafts/archived for review (`blog.drafts` tRPC query).
Add `needs_review` to that query and render the `dead_links` list inline on the card
("⚠ 2 broken links: …") so the editor sees exactly what to fix. The existing
`update` + `approve` mutations already let them edit the body / source list and
re-publish — re-publishing flips `status` back to `published` and should reset
`dead_link_count`/`dead_links`. No new editor UI needed beyond surfacing the flag.

## Reuse summary (keeps this small)

- **Validation logic:** `isDeadLink`, `isLiveImage`, `socialExists`, the body
  regexes — all already written; this plan _moves_ them to `links.ts` and adds a
  second caller. No new "what counts as dead" rules.
- **Cron scaffold:** `cron-park-news/main.ts` is the template (config, db, loop,
  logging, `bun run` entry).
- **Edge purge:** the publish path's cache-purge helper is reused on flag/unflag.
- **Admin review:** existing `/admin/blog` queue + `update`/`approve` mutations.

## What's explicitly out of scope (v1)

- **Auto-repair** of published posts (silently unwrapping a dead inline link the way
  the draft path does). Possible v2 as an opt-in mode, but it mutates indexed content
  and needs its own thought.
- **Wayback/archive fallback** — swapping a dead source URL for its
  `web.archive.org` snapshot instead of flagging. Nice future enhancement.
- **Notifications** (email/Slack on flag). The admin queue is the v1 signal; wire a
  push later if the queue isn't watched often enough.

## Open questions

1. **`needs_review` visibility:** hard-pull the post from `/blog` the moment it's
   flagged (safest — no broken links public, but a brief disappearance), or keep it
   live until the human acts (a dead _source_ link is low-harm; a dead _hero image_
   is uglier)? Leaning: keep serving, but treat a dead **hero image** as
   higher-severity than a dead source citation — only hero/embed failures pull it.
2. **Debounce window:** is "2 consecutive runs" (≈2 days at daily cadence) the right
   confirmation, or too slow? Could shorten to same-run double-check (HEAD+GET is
   already a recheck) + 1 follow-up run.
3. **Severity tiers:** worth distinguishing a dead _source citation_ (drop it, low
   stakes) from a dead _hero image_ / _embed_ (visible breakage, higher stakes) and
   routing only the latter to `needs_review`? Ties into Q1.
