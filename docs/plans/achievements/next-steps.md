# Achievements — correctness fixes & expansion roadmap

Follow-up to the v1 build (`plan.md`). This captures the correctness audit done on
2026-07-07, the two fixes already landed, and a prioritized roadmap for expanding
the catalog. Same guardrails as v1 apply: **100% independent of the Living Layer**
(no imports from `src/server/living/**` or `src/components/living/**`), catalog
lives in code, DB stores only unlocked tier ids, migrations are hand-written
timestamped folders (no `_journal.json`, no `drizzle-kit generate`).

---

## 0. Shipped (2026-07-07)

Two calculation bugs on the flagship geo stats, fixed in `engine.ts` +
`schema.ts` + `drizzle/20260707120000_user_park_day_present_seconds/`:

1. **Dropped queue dwells on day-rollover / park-exit.** `settleAnchorRow` is an
   `UPDATE`; the cross-park/left-park settle path was targeting
   `localParts(now, …).day`. If the local day rolled over between the last
   anchored ping and the settling ping (anchored near a ride at 11:55pm, next
   ping outside the park at 12:05am — or the app closed overnight), the target
   row didn't exist and the ride + its `queue_seconds` were silently lost. Now
   settles to `settleDay(state.at, …)` — the day the dwell actually happened,
   which is the only day guaranteed to have a `user_park_day` row.
2. **`park_seconds` counted absence as presence.** It was
   `Σ(last_seen − first_seen)`, so a hotel nap or a closed app mid-day inflated
   the "Clocked In" family. Replaced with a `present_seconds` accumulator that
   only adds gap-bounded inter-ping deltas (`presenceDelta`, same `PING_MAX_GAP_S`
   guard as distance). Migration backfills existing rows from the old span so
   historical progress is preserved.

Both new helpers (`presenceDelta`, `settleDay`) are pure and unit-tested in
`engine.test.ts`, matching the `decideAlert` idiom.

## 0b. Shipped (2026-07-07, batch 2 — the roadmap below)

- **§1 backfill** — `progress` now runs `evaluateAndUnlock(userId, precomputedStats)`
  so unlocks self-heal on page load; added `adminReevaluateAll` for a one-shot
  sweep over every user with park-day / stat / pin data.
- **§3 distinct-attraction dimension** — new `user_attraction` table
  (`drizzle/20260707130000_user_attraction/`), written from `settleAnchorRow`;
  new `attractions_unique` stat + "Ride Explorer" family. (`park_completion`
  still deferred — needs per-park denominators + percentage-unit plumbing.)
- **§2 Tier A** — "Weekend Warrior" (`weekend_days`) + "Dawn to Dusk"
  (`full_days`) families, both pure over day-rows.
- **§4 pin collection** — `pins_owned` stat + "Pin Collector" family from
  `pin_have`. (`pin_value_cents` deferred — needs a new currency `StatUnit`;
  alert-counter split deferred to avoid churning the existing `alerts_created`.)
- **§5 pure `aggregateDayRows`** — extracted from `computeStats` and unit-tested;
  `computeStats` is now a thin DB shell that layers cross-table + event counters
  on top.

Catalog is now **22 families / 77 tiers** (was 18 / 63).

Still-open, deliberately deferred (low stakes for private achievements):

- Event counters (`searches`, `menus_viewed`, …) are client-reported with no
  idempotency and loose semantics (`search` fires on result-click, not query).
  Fine until anything valuable (leaderboards) is built on them.

---

## 1. Prerequisite for most expansion: backfill on catalog change

`evaluateAndUnlock` only runs on a ping or a tracked event. `progress` recomputes
stats live but **does not persist unlocks**. So any new family/tier only reaches
users on their next ping — a dormant user never gets it, and even an active user
sees a live-stat/unlocked mismatch until their next ping.

Before shipping new tiers, add a backfill path. Cheapest correct option:

- Call `evaluateAndUnlock(ctx.userId)` inside the `progress` query (it already
  computes stats; the extra insert is `onConflictDoNothing`). Opening the
  achievements page then self-heals. Downside: a write on a query.
- Or a one-shot admin/cron job that runs `evaluateAndUnlock` for every user with
  any `user_park_day` / `user_stat` row after a catalog change.

Recommend the `progress`-side evaluate (simplest, covers anyone who looks at the
page) plus a manual admin "re-evaluate all" button for completeness.

---

## 2. Tier A — new families from data we already store (zero schema change)

All derivable from existing `user_park_day` columns in `computeStats`. Each needs
a new `StatKey`, a `computeStats` aggregation, and a `fam(...)` entry.

| Family idea                    | New stat           | Derivation                                                |
| ------------------------------ | ------------------ | --------------------------------------------------------- |
| Weekend Warrior                | `weekend_days`     | `day` → Sat/Sun count                                     |
| Dawn-to-Dusk (open-to-close)   | `full_days`        | rows where `ropeDrop AND nightOwl`                        |
| Current streak (not just best) | `streak_current`   | trailing run of the distinct-day set ending today         |
| Consistency (rolling 30)       | `days_last_30`     | distinct days within `now − 30d`                          |
| Combo day                      | `best_day_combo`   | min(normalized distance, normalized queue) per day, maxed |
| Seasonal                       | `summer_days` etc. | `day` → month bucket                                      |

Effort: ~1 hr each (aggregation + catalog copy + a `computeStats` unit test once
that function is made testable — see §4).

## 3. Tier B — the big unlock: distinct-attraction dimension

The queue-dwell state machine already knows `anchorAttractionId` but
`settleAnchorRow` discards it into a scalar `rides` count. Recording _which_
attraction opens an entire genre of achievements. **Highest value per effort.**

**Schema** — new table:

```sql
CREATE TABLE user_attraction (
  user_id         text   NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  attraction_id   bigint NOT NULL REFERENCES attractions(id),
  park_id         bigint NOT NULL REFERENCES parks(id),
  first_ridden_at timestamptz NOT NULL DEFAULT now(),
  last_ridden_at  timestamptz NOT NULL DEFAULT now(),
  ride_count      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, attraction_id)
);
CREATE INDEX user_attraction_user_idx ON user_attraction (user_id);
```

**Engine** — `settleAnchorRow` already receives the settle context; thread the
`anchorAttractionId` through and upsert `user_attraction` (`ride_count + 1`,
`last_ridden_at = now`) in the same place it bumps `user_park_day.rides`.

**New stats + families:**

- `attractions_unique` — distinct attractions ridden → "Sampler / Completionist-ish".
- `park_completion` — max over parks of `distinct ridden / active ATTRACTION count`
  in that park (denominator from `attractions`). Powers "Cleared the Park".
- Enables future ride-specific / land-specific / coaster-count families.

**Also unlocks dining** with the same pattern: geo-anchor `dining_location` /
`parkPoi` coords (they exist) to record distinct restaurants visited.

Effort: ~half a day (migration + engine write + 2–3 families + tests).

## 4. Tier C — pin collection (data already in DB, untouched)

Today only `pin_scans` (the _scan action_) counts, not the actual collection.
`pin_have` / `pin_want` / `pin_offer` are rich and idle:

- `pins_owned` — distinct pins in `pin_have`.
- `pin_value_cents` — Σ `pin.est_value_cents` over owned (LE/rare tiers).
- `pins_for_trade`, first `pin_offer` completed — trading achievements.

These are counts/sums over existing tables; wire them into `computeStats`
(they're user-scoped queries, not event counters). Split the single
`alerts_created` counter into ride/dining/stay while here, and consider "alert
that actually fired" (`ride_alert.last_fired_at`) as a more meaningful signal
than mere creation.

## 5. Testability follow-up

`computeStats` / `evaluateAndUnlock` are DB-coupled and currently untested. As
Tier A/B/C land, extract the per-row → stats aggregation into a **pure**
function (`aggregateDayRows(rows): Stats`) that takes already-fetched rows, so
the arithmetic (streaks, distinct sets, completion ratios) is unit-testable
without a DB — leaving the thin DB shell around it. This mirrors the
`decideAlert` / `evaluateAlerts` split already used for notifications.

---

## Suggested order

1. ✅ **§1 backfill** — unblocks everything else; ship first.
2. ✅ **§3 distinct-attraction dimension** — biggest expansion surface.
3. ✅ **§2 Tier A families** — cheap content, ship in a batch.
4. ✅ **§4 pin collection** — self-contained, ship when pins get more UI love.
5. ✅ **§5 pure `aggregateDayRows`** — do alongside the first `computeStats` change.

## Remaining follow-ups (next batch)

- **Run `adminReevaluateAll` after this deploys** so existing users get the four
  new families retroactively (dormant users won't otherwise).
- **`park_completion`** ("Cleared the Park") — needs per-park active-attraction
  denominators and a percentage `StatUnit`.
- **`pin_value_cents`** collection-value family — needs a currency `StatUnit`
  (`formatStatValue` + progress-page rendering).
- **Split `alerts_created`** into ride/dining/stay + "alert that actually fired".
- **Distinct restaurants** — geo-anchor `dining_location` / `parkPoi` coords the
  same way `user_attraction` anchors rides.
