/**
 * WDW dining availability sweep (Railway cron, frequent — e.g. "*&#47;10 * * * *").
 * Single-shot: reuse the maintained OneID session and poll dine-vas
 * getAvailability for the PRIORITY + bookable restaurants × party sizes × the
 * day-horizon, writing per-slot rows (+ a "checked, none available" sentinel)
 * to `dining_obs`. Re-login only on a 401. See disney-ticket-deep-dive.md §7-8.
 *
 * Volume note: this is facilities × parties × days authenticated calls per run —
 * keep the priority set small and BROWSERLESS_TIMEOUT_MS generous.
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
import { ensureLoggedIn, relogin } from "#/server/dining/disney-session.ts";
import { browserlessConfigured, withBrowser } from "#/server/parks/sources/browserless.ts";

const PARTY_SIZES = (process.env.DINING_PARTY_SIZES ?? "2,4")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const DAY_HORIZON = Number(process.env.DINING_DAY_HORIZON ?? 14);

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
  if (!browserlessConfigured()) {
    console.error("[dining-availability] BROWSER_WS_ENDPOINT not set");
    process.exit(1);
  }
  const observedAt = new Date();
  const dates = Array.from({ length: DAY_HORIZON }, (_, i) => {
    const d = new Date(observedAt);
    d.setDate(d.getDate() + i);
    return isoDate(d);
  });

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
    .select({ facilityId: restaurantDim.facilityId, entityType: restaurantDim.entityType })
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

  let total = 0;
  let swept = 0;
  // Hoisted so the catch below can tell a budget abort (graceful — partial work
  // is already flushed) from a genuine failure (re-throw → exit 1).
  const signal = AbortSignal.timeout(config.browserlessTimeoutMs);
  try {
    await withBrowser(async (browser) => {
      const page = await ensureLoggedIn(browser);
      let reloggedIn = false;

      // Flush per target so a mid-sweep timeout doesn't lose completed work.
      for (const t of targets) {
        const rows: Array<typeof diningObs.$inferInsert> = [];
        for (const partySize of PARTY_SIZES) {
          for (const serviceDate of dates) {
            let res = await fetchAvailability(
              page,
              t.facilityId,
              t.entityType,
              serviceDate,
              partySize,
            );
            if (!res.loggedIn && !reloggedIn) {
              await relogin(page); // stored session died — re-seed once per run
              reloggedIn = true;
              res = await fetchAvailability(
                page,
                t.facilityId,
                t.entityType,
                serviceDate,
                partySize,
              );
            }
            if (res.offers.length === 0) {
              rows.push({
                observedAt,
                facilityId: t.facilityId,
                serviceDate,
                partySize,
                source: Source.DISNEY_DIRECT,
              });
            } else {
              for (const o of res.offers) {
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
        await flush(rows);
        total += rows.length;
        swept++;
      }
    }, signal);
  } catch (err) {
    // The whole sweep shares one Browserless budget; when it's exhausted the run
    // aborts mid-list. Completed venues are already flushed and the unreached
    // tail leads the next run (least-recently-swept ordering), so a budget abort
    // is partial progress — log it and exit clean. Anything else is a real
    // failure → re-throw (exit 1).
    if (!signal.aborted) throw err;
    console.warn(
      `[dining-availability] budget exhausted after ${swept}/${targets.length} venues — tail leads next run`,
    );
  }

  console.log(
    `[dining-availability] ${swept}/${targets.length} venues × ${PARTY_SIZES.length} parties × ${dates.length} days → ${total} rows`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
