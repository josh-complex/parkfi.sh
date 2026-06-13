/**
 * WDW dining availability sweep (Railway cron, frequent — e.g. "*&#47;10 * * * *").
 * Mint the OneID bearer once via a brief browser session, then poll dine-vas
 * getAvailability over plain HTTP for the PRIORITY + bookable restaurants ×
 * party sizes, writing per-slot rows (+ a "checked, none available" sentinel)
 * to `dining_obs`. One request per (facility, party) covers the whole
 * day-horizon (the endpoint takes a date range), and the browser is needed only
 * for the token — the data path is bearer-gated, not session-gated. Re-mint only
 * on a 401. See disney-ticket-deep-dive.md §7-8.
 *
 * Volume note: facilities × parties plain-HTTP calls per run — cheap; the cost
 * is the one login. Keep the priority set curated all the same.
 *
 * Run:  bun run dining:availability
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { diningObs, restaurantDim } from "#/db/schema.ts";
import { Source, SWEEPABLE_DINING_ENTITY_TYPES } from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";
import { fetchAvailability } from "#/server/dining/availability.ts";
import { refreshDineBearer, seedDineRefreshToken } from "#/server/dining/disney-session.ts";
import { evaluateDiningAlerts } from "#/server/notifications/diningAlerts.ts";

const PARTY_SIZES = (process.env.DINING_PARTY_SIZES ?? "1,2,3,4,5,6,7,8,9,10")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0 && n <= 10);
const DAY_HORIZON = Number(process.env.DINING_DAY_HORIZON ?? 30);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function flush(rows: Array<typeof diningObs.$inferInsert>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(diningObs)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing();
  }
}

async function main() {
  if (!config.disneyOneIdApiKey) {
    console.error("[dining-availability] DISNEY_ONEID_APIKEY not set");
    process.exit(1);
  }
  const seedToken = process.env.DISNEY_REFRESH_TOKEN?.trim();
  if (seedToken) {
    await seedDineRefreshToken(seedToken);
    console.log("[dining-availability] seeded OneID refresh token from DISNEY_REFRESH_TOKEN");
  }
  const observedAt = new Date();
  // One inclusive [start, end] range covers the horizon in a single request per
  // (facility, party); `dates` drives sentinel coverage for the days the feed
  // omits (= no availability).
  const dates = Array.from({ length: DAY_HORIZON }, (_, i) => {
    const d = new Date(observedAt);
    d.setDate(d.getDate() + i);
    return isoDate(d);
  });
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  // Sweep only the verified, bookable, priority restaurants (catalog widens the
  // candidate pool; `priority` controls what's actually polled). Order
  // least-recently-swept first so a budget-bounded run advances a coverage
  // frontier rather than always re-polling the head of the list and starving the
  // tail; `max(observed_at)` is each venue's last sweep, NULLS FIRST leads with
  // never-observed venues.
  const lastSwept = db
    .select({
      facilityId: diningObs.facilityId,
      lastObservedAt: sql<string>`max(${diningObs.observedAt})`.as("last_observed_at"),
    })
    .from(diningObs)
    .where(eq(diningObs.source, Source.DISNEY_DIRECT))
    .groupBy(diningObs.facilityId)
    .as("last_swept");
  const targets = await db
    .select({
      facilityId: restaurantDim.facilityId,
      entityType: restaurantDim.entityType,
    })
    .from(restaurantDim)
    .leftJoin(lastSwept, eq(lastSwept.facilityId, restaurantDim.facilityId))
    .where(
      and(
        eq(restaurantDim.priority, true),
        eq(restaurantDim.bookable, true),
        eq(restaurantDim.active, true),
        inArray(restaurantDim.entityType, [...SWEEPABLE_DINING_ENTITY_TYPES]),
      ),
    )
    .orderBy(sql`${lastSwept.lastObservedAt} asc nulls first`);
  if (targets.length === 0) {
    console.warn(
      "[dining-availability] no priority targets — set restaurant_dim.priority=true (run dining:facilities first)",
    );
    return;
  }

  // One AbortSignal bounds the WHOLE run; it caps both the (brief) browser login
  // and any hung dine-vas fetch, and lets the catch tell a graceful budget abort
  // (partial work already flushed) from a genuine failure.
  const signal = AbortSignal.timeout(config.browserlessTimeoutMs);

  // Mint the bearer by exchanging the stored OneID refresh token over plain
  // HTTP — no browser. One exchange covers the whole sweep; re-mint only on a
  // 401 (below). The sweep itself is bearer-gated, not session-gated.
  let bearer: string;
  try {
    bearer = await refreshDineBearer(signal);
  } catch (err) {
    if (signal.aborted) {
      console.warn("[dining-availability] budget exhausted before first bearer mint");
      return;
    }
    throw err; // no/expired refresh token → exit 1 (re-seed via seed-token)
  }

  let total = 0;
  let swept = 0;
  let reminted = false;
  try {
    for (; swept < targets.length && !signal.aborted; swept++) {
      const t = targets[swept];
      const rows: Array<typeof diningObs.$inferInsert> = [];
      for (const partySize of PARTY_SIZES) {
        let res = await fetchAvailability(
          bearer,
          t.facilityId,
          t.entityType,
          startDate,
          endDate,
          partySize,
          signal,
        );
        if (!res.loggedIn && !reminted) {
          bearer = await refreshDineBearer(signal); // bearer died → exchange refresh token again
          reminted = true;
          res = await fetchAvailability(
            bearer,
            t.facilityId,
            t.entityType,
            startDate,
            endDate,
            partySize,
            signal,
          );
        }
        for (const serviceDate of dates) {
          const offers = res.offersByDate.get(serviceDate) ?? [];
          if (offers.length === 0) {
            rows.push({
              observedAt,
              facilityId: t.facilityId,
              serviceDate,
              partySize,
              source: Source.DISNEY_DIRECT,
            });
          } else {
            for (const o of offers) {
              rows.push({
                observedAt,
                facilityId: t.facilityId,
                serviceDate,
                partySize,
                mealPeriod: o.mealPeriod ?? "",
                offerTime: o.offerTime ?? "00:00:00",
                offerId: o.offerId,
                source: Source.DISNEY_DIRECT,
              });
            }
          }
        }
      }
      // Flush per venue so a budget abort never loses completed work; `swept`
      // (least-recently-swept ordering) is the resume frontier for next run.
      await flush(rows);
      total += rows.length;
    }
  } catch (err) {
    // Budget exhausted: completed venues are flushed and the unreached tail leads
    // next run — partial progress, log and exit clean.
    if (!signal.aborted) throw err; // genuine failure (network, DB, etc.) → exit 1
    console.warn(
      `[dining-availability] budget exhausted after ${swept}/${targets.length} venues — tail leads next run`,
    );
  }

  // Alerts read the obs we just wrote; isolate so a failure here never breaks the
  // sweep (the cache write is the primary job). Mirrors the stays sweep tail.
  let fired = 0;
  try {
    fired = await evaluateDiningAlerts();
  } catch (err) {
    console.error("[dining-availability] alert eval failed:", err);
  }

  console.log(
    `[dining-availability] ${swept}/${targets.length} venues × ${PARTY_SIZES.length} parties × ${dates.length} days → ${total} rows alerts=${fired}` +
      (reminted ? " (re-minted bearer)" : ""),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
