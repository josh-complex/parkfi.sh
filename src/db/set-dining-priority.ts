/**
 * Curate the dining-availability "preferred list" — i.e. which restaurants the
 * `dining:availability` cron actually sweeps. That sweep only polls rows where
 * `priority = true AND bookable = true AND active = true AND entity_type IN
 * (restaurant, dinner-show, dining-event)` (see services/dining-availability/main.ts),
 * so this script flips `priority` on a
 * CURATED subset of the bookable catalog and (optionally) demotes everything else,
 * keeping the hot set exactly what you intend.
 *
 * It is idempotent and re-runnable — handy after a `dining:facilities` refresh
 * brings in new venues (which always land with priority=false).
 *
 *   bun run dining:priority --list-resorts        # see candidate venues grouped by resort
 *   bun run dining:priority --dry-run             # preview the change, write nothing
 *   bun run dining:priority                        # apply (uses the filters below)
 *   bun run dining:priority --reset                # also demote anything outside the curated set
 *
 * Curation filters (env, comma-separated, case-insensitive substring match):
 *   DINING_PRIORITY_RESORTS  match against restaurant_dim.park_resort  (e.g. "Magic Kingdom,EPCOT")
 *   DINING_PRIORITY_NAMES    match against restaurant_dim.name         (e.g. "Cinderella,Space 220")
 * If BOTH are empty, every bookable+active restaurant is selected (the broad case —
 * mind the call-volume warning in the availability service before doing this).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { and, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import { db } from "./index.ts";
import { restaurantDim } from "./schema.ts";
import { SWEEPABLE_DINING_ENTITY_TYPES } from "#/server/parks/codes.ts";

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has("--dry-run");
const RESET = argv.has("--reset");
const LIST_RESORTS = argv.has("--list-resorts");

function parseList(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const resortFilters = parseList(process.env.DINING_PRIORITY_RESORTS);
const nameFilters = parseList(process.env.DINING_PRIORITY_NAMES);

/** The pool the sweep can ever poll — mirror its WHERE exactly. */
const candidatePredicate = and(
  eq(restaurantDim.bookable, true),
  eq(restaurantDim.active, true),
  inArray(restaurantDim.entityType, [...SWEEPABLE_DINING_ENTITY_TYPES]),
);

/** Curated subset = candidate pool ∩ (resort OR name filters). Empty filters ⇒ whole pool. */
function curatedPredicate(): SQL | undefined {
  const matchers: SQL[] = [];
  for (const r of resortFilters) matchers.push(ilike(restaurantDim.parkResort, `%${r}%`));
  for (const n of nameFilters) matchers.push(ilike(restaurantDim.name, `%${n}%`));
  return matchers.length > 0 ? and(candidatePredicate, or(...matchers)) : candidatePredicate;
}

async function listResorts(): Promise<void> {
  const rows = await db
    .select({
      parkResort: restaurantDim.parkResort,
      total: sql<number>`count(*)::int`,
    })
    .from(restaurantDim)
    .where(candidatePredicate)
    .groupBy(restaurantDim.parkResort)
    .orderBy(restaurantDim.parkResort);
  console.log("Bookable restaurants by park_resort (candidate pool):");
  for (const r of rows)
    console.log(`  ${r.total.toString().padStart(4)}  ${r.parkResort ?? "(null)"}`);
  console.log(`\nUse DINING_PRIORITY_RESORTS / DINING_PRIORITY_NAMES to curate.`);
}

async function main(): Promise<void> {
  if (LIST_RESORTS) {
    await listResorts();
    return;
  }

  const predicate = curatedPredicate();
  const [{ matched }] = await db
    .select({ matched: sql<number>`count(*)::int` })
    .from(restaurantDim)
    .where(predicate);

  const filterDesc =
    resortFilters.length || nameFilters.length
      ? `resorts=[${resortFilters.join(", ")}] names=[${nameFilters.join(", ")}]`
      : "ALL bookable+active restaurants (no filters set)";
  console.log(`Curation: ${filterDesc}`);
  console.log(`Restaurants matching curated set: ${matched}`);

  // Sample so you can eyeball the selection before committing.
  const sample = await db
    .select({ name: restaurantDim.name, parkResort: restaurantDim.parkResort })
    .from(restaurantDim)
    .where(predicate)
    .orderBy(restaurantDim.parkResort, restaurantDim.name)
    .limit(20);
  for (const s of sample) console.log(`  • ${s.name}  —  ${s.parkResort ?? "(null)"}`);
  if (matched > sample.length) console.log(`  …and ${matched - sample.length} more`);

  if (DRY_RUN) {
    console.log("\n--dry-run: no changes written.");
    return;
  }

  const promoted = await db
    .update(restaurantDim)
    .set({ priority: true, updatedAt: new Date() })
    .where(and(predicate, eq(restaurantDim.priority, false)))
    .returning({ facilityId: restaurantDim.facilityId });
  console.log(`\nPromoted ${promoted.length} restaurant(s) to priority=true.`);

  if (RESET) {
    // Demote any currently-priority restaurant that is NOT in the curated set, so the
    // hot tier stays exactly the curated selection. Scoped to the candidate pool +
    // explicitly-flagged rows so we don't churn rows already false.
    const matchedIds = await db
      .select({ facilityId: restaurantDim.facilityId })
      .from(restaurantDim)
      .where(predicate);
    const keep = matchedIds.map((r) => r.facilityId);
    const demoted = await db
      .update(restaurantDim)
      .set({ priority: false, updatedAt: new Date() })
      .where(
        keep.length > 0
          ? and(eq(restaurantDim.priority, true), sql`${restaurantDim.facilityId} != ALL(${keep})`)
          : eq(restaurantDim.priority, true),
      )
      .returning({ facilityId: restaurantDim.facilityId });
    console.log(`--reset: demoted ${demoted.length} restaurant(s) outside the curated set.`);
  }

  const [{ live }] = await db
    .select({ live: sql<number>`count(*)::int` })
    .from(restaurantDim)
    .where(and(candidatePredicate, eq(restaurantDim.priority, true)));
  console.log(`Sweep will now poll ${live} restaurant(s) per run.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
