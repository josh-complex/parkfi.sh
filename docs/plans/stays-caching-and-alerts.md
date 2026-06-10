# Stays — server-side caching & resort-availability alerts

> **Theme:** Disney's resort-availability API is slow, and today `stays.availability`
> calls it live on every request. That's both a latency problem _and_ the reason we
> can't alert on hard-to-get openings — availability only exists while someone is
> actively looking. Both problems have one fix.

## Core insight

Caching and alerting are the same feature: **stop calling Disney on the request path;
sweep it on a schedule into an observation table.** Then (1) reads serve from the table
(fast cache) and (2) a per-sweep evaluator fires alerts (retention). We've already built
this shape twice — `dining_obs` + sweep cron, and `ride_alert` + evaluator + push.

A key advantage over dining: one Disney call returns **all ~30 resorts** for a (dates,
party) tuple, and the endpoint is **public/cookieless** (see `src/server/stays/availability.ts`
header). So the stays sweep is a plain `fetch` loop — no Browserless, no OneID session,
no reconnect machinery that `services/dining-availability` needs.

## Architecture

```
user search ─► stays.availability ─► fresh obs in stay_obs?  ─yes─► return (cache hit, instant)
                                              │ no/stale
                                              └► fetchResortAvailability (live) ─► write obs ─► return
                                                              also: upsert stay_query.last_requested_at

stay_query ──(least-recently-swept ∪ alert-backed ∪ warm defaults)──► services/stays-availability (cron ~10min)
                                                                          │ one fetch per query → ~30 resort rows
                                                                          ▼ write stay_obs
                                  evaluateStayAlerts() ─► insert notification(queued) ─► BullMQ "stay-alerts" queue
                                                                                                  │
                            services/notifications "stay-alerts" Worker ─► render React Email ─► Resend send
                                                                                                  │
                                                                          update notification(sent|failed) + retry/backoff
```

Reuses that keep this small: the **UI read path is unchanged** (`src/routes/stays.tsx`
keeps calling `stays.availability`), and **the durable queue already exists** (Redis +
BullMQ behind `getPushQueue()` / `services/notifications`). What's _new_ vs. ride alerts is
the **delivery channel**: stay alerts go out as logged, retried **email** (not best-effort
web push), because a missed money-saving alert is unacceptable. This supersedes the
email-first sketch in `tier-2-auth-and-alerts.md`.

## Decisions locked in

- **Alert grain:** resort-level for v1 ("any room at Fort Wilderness opens for these
  dates"). Uses exactly the data `fetchResortAvailability` already parses. Room-type
  grain (a _Cabin_ specifically) is a follow-up needing a deeper Disney endpoint + a
  `room_type_id` dimension.
- **Cache miss:** synchronous on miss. On stale/missing data, fetch live in-request,
  write obs, return. First user after expiry waits; everyone else is instant.
- **Channel:** **email via Resend**, templates in **React Email** (built by Resend — first-class
  integration). _Not_ self-hosted SMTP — Railway blocks port 25 and deliverability on a fresh
  IP (SPF/DKIM/DMARC/warmup) is the opposite of "stable alerts," which is exactly what these
  must be. SMS via Twilio is a follow-up (needs phone collection + verification + US **A2P 10DLC**
  brand/campaign registration — a multi-day carrier process; email needs none of it and we
  already have verified addresses from better-auth).
- **Durability:** alerts are sent through a logged BullMQ job (retry + backoff), not
  fire-and-forget. Every send is recorded in a `notification` row.
- **Cap:** **3 active stay alerts per user, total** (not per-park — stays have no park axis),
  enforced in `create` like `MAX_PER_PARK` in `rideAlerts.ts`.
- **Compliance:** every email carries a one-click unsubscribe (signed token, no login),
  `List-Unsubscribe` + `List-Unsubscribe-Post` headers (RFC 8058), and a physical postal
  address in the footer. Honored immediately.

## 1. Schema (`src/db/schema.ts`)

**`stay_obs`** — mirrors `dining_obs`. Grain = one row per resort per swept query.

```
observed_at     timestamptz  notnull
resort_id       text         notnull   -- Disney facility id; joins RESORT_BY_ID
check_in        date         notnull
check_out       date         notnull
party_key       text         notnull   -- canonical encoding of partyMix+accessible+floridaResident
available       boolean      notnull
price_per_night integer                -- null when unavailable
reason_code     text
source          smallint     notnull → refSource
PK (resort_id, check_in, check_out, party_key, observed_at)
index (check_in, check_out, party_key, observed_at desc)   -- latest-obs lookup
```

`party_key` = deterministic string of the non-date dims (e.g. `a2c1:5,8|acc0|fl0`). One
canonical builder shared by read path and sweep so keys collide correctly.

**`stay_query`** — sweep frontier (mirrors `restaurant_dim.priority` + dining's
least-recently-swept ordering).

```
id, check_in, check_out, party_key (+ raw dims to rebuild the request body),
last_requested_at  timestamptz   -- bumped on user search (demand signal)
last_swept_at      timestamptz   -- set by sweeper
alert_backed       boolean        -- has ≥1 active alert
unique (check_in, check_out, party_key)
```

**`stay_alert`** — mirrors `ride_alert`.

```
id, user_id → user (cascade), query_id → stay_query,
resort_id text   -- null = "any resort"
mode smallint    -- 1 = becomes_available, 2 = price_below
price_below integer
channel text default 'email'   -- 'email' (v1) | 'sms' (later)
armed bool default true, last_fired_at, last_available bool, last_price int,   -- edge-trigger + cooldown
active bool, created_at
partial unique (user_id, resort_id, query_id) WHERE active
index (query_id) WHERE active
```

> **Cap = 3 active per user, total.** Enforce in `create` (count `WHERE user_id = ? AND active`),
> same shape as `MAX_PER_PARK` in `rideAlerts.ts` but without the park grouping.

**`notification`** — durable send log (dedupe + audit + the "what we sent" UI + unsubscribe
correlation). Every fire writes one row _before_ the send job runs.

```
id, alert_id → stay_alert, user_id → user, channel text,
payload jsonb        -- resort, dates, matched price, rendered subject
status text          -- 'queued' | 'sent' | 'failed'
provider_msg_id text -- Resend id, for support/debugging
error text, created_at, sent_at
index (user_id, created_at desc)
```

**`alert_optout`** — global per-user kill switch hit by the unsubscribe link (so one click can
silence all stay-alert email without deleting individual alerts).

```
user_id → user (pk), stay_email_opt_out bool default false, updated_at
```

## 2. Read-path caching (`routers/stays.ts` + `availability.ts`)

Rewrite `stays.availability` to:

1. Build `party_key`; query latest `stay_obs` for (dates, party_key).
2. Fresh (≤ `STAYS_CACHE_TTL_MS`, ~15 min)? Return from DB — fast returning-user path.
3. Missing/stale? Call `fetchResortAvailability` live (current code), INSERT obs, return.
4. Either way, upsert `stay_query.last_requested_at = now()` so the sweeper keeps it warm.

`fetchResortAvailability` stays as-is; add a `writeStayObs(params, offers)` helper beside it.

## 3. Sweep service (`services/stays-availability/main.ts`)

Model on `services/dining-availability/main.ts` but much simpler (plain `fetch`, no
browser/login/reconnect):

1. Select targets from `stay_query` ordered `last_swept_at asc nulls first`. Target set =
   alert-backed ∪ recently-requested ∪ a seeded **warm set** (next ~8 weekends × party of
   2 & 4, so cold browse is fast).
2. Per query, bounded by one `AbortSignal.timeout` budget: one Disney call → write ~30
   `stay_obs` rows, set `last_swept_at`, flush per-query (budget abort leaves the tail for
   next run — dining's resume pattern).
3. After each query lands, evaluate that query's alerts.
4. Age out demand: `stay_query` rows not requested in N days and not alert-backed get
   dropped, bounding the swept space.

Railway Cron, ~10 min, single replica, low concurrency.

## 4. Alert evaluation (`src/server/notifications/stayAlerts.ts`)

Copy `src/server/notifications/alerts.ts` precisely:

- **`decideStayAlert(row, now, cooldownMs)`** pure function:
  - mode 1 `becomes_available`: `met = latest.available`; edge-trigger on
    `armed && met && cooled`, disarm on fire, re-arm when it goes unavailable. (The
    Fort-Wilderness-on-Halloween case.)
  - mode 2 `price_below`: `met = available && price ≤ price_below`.
  - Carry `last_available` / `last_price` like `lastStatus` / `lastWaitMin`.
- **`evaluateStayAlerts()`**: join active `stay_alert` → latest `stay_obs` for its query
  (+ resort filter; null = any), skip users with `alert_optout.stay_email_opt_out`, run
  `decideStayAlert`. On fire: **insert a `notification` row (status `queued`)**, then enqueue a
  `stay-alerts` BullMQ job carrying the `notification.id`; finally write back alert state.
  Reuse `config.alertCooldownMs`.
- Call at end of sweep run, in its own try/catch (isolation like `worker/main.ts`).

## 5. Delivery — second Worker in `services/notifications` + React Email

A durable BullMQ worker on a new `stay-alerts` queue, added as a **second `Worker` inside the
existing `services/notifications` process** (shares the Redis connection; one fewer Railway
service than a standalone mailer). Per job:

1. Load the `notification` row + alert + user email (from better-auth `user.email`).
2. **Render a React Email template** (`src/emails/StayAvailableEmail.tsx`,
   `StayPriceDropEmail.tsx`) → HTML via `@react-email/render`.
3. Send via **Resend** with a per-call timeout. On success → `status='sent'`,
   `provider_msg_id`, `sent_at`. On failure → BullMQ retry/backoff; after final attempt
   `status='failed'`, record `error`. **Never block the queue on a slow provider.**
4. Gate on `ALERTS_SEND_ENABLED` — defaults **off** in dev, so test runs log-instead-of-send
   (matches the safety note in `tier-2-auth-and-alerts.md`).

Why a queue and not a direct send in the evaluator: money-critical alerts need retries +
an audit trail, and the sweep service must not stall on Resend latency.

### Compliance & unsubscribe (legally required)

- **One-click unsubscribe, no login.** Each email embeds a signed token —
  `HMAC(UNSUBSCRIBE_SECRET, {userId, alertId|"all"})`, same crypto posture as the
  `scraper_session` encryption (key from env, never stored). Link → public route
  `GET /unsubscribe?token=…` (a server route; auth not required) that verifies the token and
  either disables that one `stay_alert` or sets `alert_optout.stay_email_opt_out = true`.
- **RFC 8058 headers** on every send: `List-Unsubscribe: <https://…/unsubscribe?token=…>` +
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` so Gmail/Apple show a native
  unsubscribe button and can POST it. Add a matching `POST /unsubscribe` handler.
- **Footer:** physical postal address (`ALERT_POSTAL_ADDRESS`) + a "Manage alerts" link to
  `/stays/alerts`. CAN-SPAM basics even though these are opt-in/transactional-leaning.
- **SMS (later):** Twilio auto-honors `STOP`, but you must persist the opt-out and complete
  **A2P 10DLC** registration before sending. Defer until email is proven.

## 6. tRPC + UI

- New `routers/stayAlerts.ts` mirroring `rideAlerts.ts` (`protectedProcedure`,
  list/create/update/remove, **3-per-user cap**). Create seeds/links a `stay_query` so the
  sweeper immediately covers it.
- "Alert me" affordance on a resort row in `src/components/stays/stays-board.tsx`,
  prefilling resort + current dates/party. A `/stays/alerts` manage page (list, condition,
  last-fired, toggle, delete). Surface recent `notification` rows in the existing inbox.

## 7. Config & deps (`src/server/parks/config.ts`, `package.json`)

- Config: `staysCacheTtlMs` (~15 min), `staysSweepIntervalMs`, `staysWarmHorizonDays`,
  `staysSweepBudgetMs`. Reuse `alertCooldownMs`, `fetchTimeoutMs`, `userAgent`.
- Env: `RESEND_API_KEY`, `ALERT_FROM_EMAIL`, `ALERTS_SEND_ENABLED` (off in dev),
  `UNSUBSCRIBE_SECRET`, `ALERT_POSTAL_ADDRESS`. (`TWILIO_*` later.)
- Deps: `resend`, `react-email`, `@react-email/components`, `@react-email/render`.

## Rollout

1. **Caching only** — `stay_obs` + SWR read path + warm-set sweep. Ships the
   returning-user latency win; no auth/alert/email surface. Validate cache hit-rate and that
   swept prices match live.
2. **Alerts + email** — `stay_alert`/`notification`/`alert_optout`, evaluator, the
   `stay-alerts` Worker added to `services/notifications`, React Email templates, unsubscribe
   route, `/stays/alerts` UI. Verify against a seeded test user with `ALERTS_SEND_ENABLED=false`
   first.
3. **SMS (deferred)** — phone collection + verification, Twilio, A2P 10DLC, `STOP` handling.
   The `channel` column + queue already accommodate it; just add an SMS branch in the Worker.

## Gotchas

- **Spam is the #1 failure mode.** Edge-trigger + cooldown + `last_fired_at` + the
  `notification` log are not optional. Explicitly test "stays available for hours → exactly
  one email."
- **Deliverability:** verify your sending domain in Resend (SPF/DKIM/DMARC) before launch, or
  alerts spam-folder — defeating the whole point. This is the reason we don't self-host.
- **Unsubscribe must work without a session** — the email click is unauthenticated; the
  signed token _is_ the auth.
- **Grain.** Resort-level v1 by design; room-type is a follow-up (deeper endpoint +
  `room_type_id`).
- Keep `stay_query` bounded via demand age-out, or the swept space grows without limit.
