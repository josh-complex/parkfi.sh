/**
 * WDW resort-availability sweep (Railway cron, frequent — e.g. "*&#47;10 * * * *").
 *
 * Disney's resort-availability endpoint is slow but PUBLIC and cookieless, and a
 * single call returns ~30 resorts for one (dates, party) tuple — so this sweep is
 * a plain `fetch` loop (no Browserless / OneID, unlike dining-availability). It
 * keeps the `stays.availability` read path off Disney's slow API: each swept
 * tuple writes a fresh `stay_obs` generation that the read path serves from.
 *
 * Per run: re-seed a rolling warm set (upcoming weekends × small parties) into
 * `stay_query`, sweep that frontier least-recently-swept under one wall-clock
 * budget (flush per tuple so a budget abort leaves the tail for next run), then
 * age out demand-only tuples that have gone cold so the swept space stays bounded.
 *
 * Run:  bun run stays:availability
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { eq, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { stayQuery } from "#/db/schema.ts";
import { evaluateStayAlerts } from "#/server/notifications/stayAlerts.ts";
import { config } from "#/server/parks/config.ts";
import {
  buildPartyKey,
  fetchResortAvailability,
  stayQueryToParams,
  writeStayObs,
  type ResortSearchParams,
} from "#/server/stays/availability.ts";
import type { ResortStore } from "#/server/stays/resort-catalog.generated.ts";

// Parties to keep warm for cold browse (count of adults; no children).
const WARM_PARTIES = [
  { adults: 2, children: 0 },
  { adults: 4, children: 0 },
] as const;

// Stores kept warm every run. Each is a separate Disney availability endpoint;
// one fetch per (store, dates, party) returns all of that store's resorts.
const WARM_STORES: ReadonlyArray<ResortStore> = ["wdw", "dlr"];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Friday→Sunday (2-night) weekend stays within the warm horizon. */
function warmWeekends(
  horizonDays: number,
  from: Date,
): Array<{ checkIn: string; checkOut: string }> {
  const out: Array<{ checkIn: string; checkOut: string }> = [];
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    if (d.getDay() !== 5) continue; // Friday
    const checkOut = new Date(d);
    checkOut.setDate(checkOut.getDate() + 2);
    out.push({ checkIn: isoDate(d), checkOut: isoDate(checkOut) });
  }
  return out;
}

/** Seed the rolling warm set into `stay_query` (idempotent; never clobbers demand). */
async function seedWarmSet(now: Date): Promise<number> {
  const weekends = warmWeekends(config.staysWarmHorizonDays, now);
  let seeded = 0;
  for (const store of WARM_STORES) {
    for (const w of weekends) {
      for (const p of WARM_PARTIES) {
        const params: ResortSearchParams = {
          store,
          checkInDate: w.checkIn,
          checkOutDate: w.checkOut,
          adults: p.adults,
          children: p.children,
          childAges: [],
          accessible: false,
          floridaResident: false,
        };
        const res = await db
          .insert(stayQuery)
          .values({
            checkIn: w.checkIn,
            checkOut: w.checkOut,
            partyKey: buildPartyKey(params),
            store,
            adults: p.adults,
            children: p.children,
            accessible: false,
            floridaResident: false,
          })
          .onConflictDoNothing();
        seeded += res.rowCount ?? 0;
      }
    }
  }
  return seeded;
}

/**
 * Drop demand-only tuples that have gone cold (and any whose stay is in the
 * past), keeping alert-backed and warm rows. Warm rows have a null
 * `last_requested_at`, so the demand clause never touches them — they leave
 * naturally once their dates pass.
 */
async function ageOutDemand(): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM stay_query
    WHERE check_out < CURRENT_DATE
       OR (alert_backed = false
           AND last_requested_at IS NOT NULL
           AND last_requested_at < now() - make_interval(days => ${config.staysDemandAgeOutDays}))
  `);
  return res.rowCount ?? 0;
}

async function main() {
  const now = new Date();
  const seeded = await seedWarmSet(now);

  // Least-recently-swept first (NULLS FIRST leads with never-swept tuples), so a
  // budget-bounded run advances a coverage frontier instead of starving the tail.
  const targets = await db
    .select()
    .from(stayQuery)
    .orderBy(sql`${stayQuery.lastSweptAt} asc nulls first`);

  let swept = 0;
  let rows = 0;
  // One AbortSignal bounds the whole run; the per-fetch timeout is separate.
  const signal = AbortSignal.timeout(config.staysSweepBudgetMs);
  for (const t of targets) {
    if (signal.aborted) break;
    const params = stayQueryToParams(t);
    const observedAt = new Date();
    let offers;
    try {
      offers = await fetchResortAvailability(params, AbortSignal.timeout(config.fetchTimeoutMs));
    } catch (err) {
      if (signal.aborted) break;
      console.warn(`[stays-availability] fetch failed for query ${t.id}:`, err);
      continue;
    }
    // Flush per tuple so a budget abort never loses completed work.
    await writeStayObs(params, t.partyKey, offers, observedAt);
    await db.update(stayQuery).set({ lastSweptAt: observedAt }).where(eq(stayQuery.id, t.id));
    swept++;
    rows += offers.length;
  }

  // Alerts read the obs we just wrote; isolate so a failure here never breaks
  // the sweep (the cache write is the primary job).
  let fired = 0;
  try {
    fired = await evaluateStayAlerts();
  } catch (err) {
    console.error("[stays-availability] alert eval failed:", err);
  }

  const dropped = await ageOutDemand();
  console.log(
    `[stays-availability] seeded=${seeded} swept=${swept}/${targets.length} rows=${rows} alerts=${fired} aged-out=${dropped}` +
      (signal.aborted ? " (budget exhausted — tail leads next run)" : ""),
  );
}

main()
  .catch((err) => {
    reportServiceError("stays-availability", "main", err);
    process.exitCode = 1;
  })
  // Flush queued PostHog events BEFORE exiting — process.exit would drop them.
  .finally(async () => {
    await flushTelemetry();
    process.exit(process.exitCode ?? 0);
  });
