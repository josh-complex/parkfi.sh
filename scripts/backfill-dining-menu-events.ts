/**
 * One-time backfill of `dining_menu_event` from retained `dining_menu_item`
 * generations.
 *
 * The old dining-facilities impl only logged price moves; it discarded item
 * adds/removes/renames. But `dining_menu_item` is append-only and never pruned,
 * so every historical menu generation is still on disk. This script replays the
 * SAME `diffMenu` the cron now runs over each venue's consecutive generations,
 * stamping the reconstructed events at the newer generation's `observed_at` — so
 * the "New!" badges, add/remove counts, and item history reflect the full past,
 * not just changes observed after the feature shipped.
 *
 * Idempotent-ish: refuses to run if `dining_menu_event` already has rows (so a
 * second accidental run can't double-count), unless FORCE=1 is set, in which
 * case it TRUNCATEs the table first. Price changes are NOT touched — those were
 * always logged and already live in `dining_menu_price_change`.
 *
 * Run:  bun run backfill:dining-events
 *       FORCE=1 bun run backfill:dining-events   # wipe + rebuild
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { asc, eq, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { diningMenuEvent, diningMenuItem } from "#/db/schema.ts";
import { diffMenu, type PrevMenuRow } from "#/server/dining/menu-diff.ts";
import type { DiningMenuItemRow } from "#/server/dining/disney-dining-detail.ts";

async function main() {
  const force = process.env.FORCE === "1";
  const existing = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM dining_menu_event`,
  );
  const have = existing.rows[0]?.n ?? 0;
  if (have > 0) {
    if (!force) {
      console.log(
        `[backfill] dining_menu_event already has ${have} rows — refusing to run. ` +
          `Set FORCE=1 to wipe and rebuild.`,
      );
      process.exit(0);
    }
    console.log(`[backfill] FORCE=1 — truncating ${have} existing event rows`);
    await db.execute(sql`TRUNCATE dining_menu_event RESTART IDENTITY`);
  }

  // Every (facility, generation) that has menu items, oldest first.
  const gens = await db
    .selectDistinct({
      facilityId: diningMenuItem.facilityId,
      observedAt: diningMenuItem.observedAt,
    })
    .from(diningMenuItem)
    .orderBy(asc(diningMenuItem.facilityId), asc(diningMenuItem.observedAt));

  const gensByFacility = new Map<string, Array<Date>>();
  for (const g of gens) {
    const list = gensByFacility.get(g.facilityId);
    if (list) list.push(g.observedAt);
    else gensByFacility.set(g.facilityId, [g.observedAt]);
  }

  let facilitiesWithHistory = 0;
  let added = 0;
  let removed = 0;
  let renamed = 0;
  const eventRows: Array<typeof diningMenuEvent.$inferInsert> = [];

  for (const [facilityId, observedAts] of gensByFacility) {
    if (observedAts.length < 2) continue; // need ≥2 generations to diff
    facilitiesWithHistory++;

    // Load this venue's generations once, bucketed by observed_at.
    const rows = await db
      .select({
        observedAt: diningMenuItem.observedAt,
        mealPeriod: diningMenuItem.mealPeriod,
        groupName: diningMenuItem.groupName,
        itemType: diningMenuItem.itemType,
        title: diningMenuItem.title,
        description: diningMenuItem.description,
        price: diningMenuItem.price,
        priceType: diningMenuItem.priceType,
        currency: diningMenuItem.currency,
      })
      .from(diningMenuItem)
      .where(eq(diningMenuItem.facilityId, facilityId))
      .orderBy(asc(diningMenuItem.id));

    const byGen = new Map<number, Array<DiningMenuItemRow>>();
    for (const r of rows) {
      const key = r.observedAt.getTime();
      const row: DiningMenuItemRow = {
        facilityId,
        mealPeriod: r.mealPeriod,
        groupName: r.groupName,
        itemType: r.itemType,
        title: r.title,
        description: r.description,
        price: r.price,
        priceType: r.priceType,
        currency: r.currency,
      };
      const list = byGen.get(key);
      if (list) list.push(row);
      else byGen.set(key, [row]);
    }

    // Diff each consecutive pair; stamp events at the newer generation's time.
    for (let i = 1; i < observedAts.length; i++) {
      const prev = (byGen.get(observedAts[i - 1].getTime()) ?? []) as Array<PrevMenuRow>;
      const next = byGen.get(observedAts[i].getTime()) ?? [];
      const { eventRows: evs } = diffMenu(facilityId, prev, next);
      for (const e of evs) {
        eventRows.push({ ...e, changedAt: observedAts[i] });
        if (e.changeType === "added") added++;
        else if (e.changeType === "removed") removed++;
        else renamed++;
      }
    }
  }

  for (let i = 0; i < eventRows.length; i += 500) {
    await db.insert(diningMenuEvent).values(eventRows.slice(i, i + 500));
  }

  console.log(
    `[backfill] ${facilitiesWithHistory} venues with ≥2 generations → ` +
      `${eventRows.length} events (${added} added / ${removed} removed / ${renamed} renamed)`,
  );
}

main()
  .catch((err) => {
    console.error("[backfill] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
