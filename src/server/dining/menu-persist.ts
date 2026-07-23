/**
 * Shared menu-generation persistence — the storage half of the menu pipeline,
 * used by both the WDW cron (`dining-facilities`, dinemenu API) and the UOR
 * cron (`dining-facilities-universal`, contentdata pages). Menus are
 * APPEND-ONLY + change-only: a venue's fetched menu is hashed and a new
 * `dining_menu_item` generation written only when the hash differs from
 * `dining_menu_snapshot`; item adds/removes and per-tier price moves between
 * generations are logged to `dining_menu_event` / `dining_menu_price_change`.
 */
import { createHash } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  diningMenuEvent,
  diningMenuItem,
  diningMenuPriceChange,
  diningMenuSnapshot,
} from "#/db/schema.ts";
import type { DiningMenuItemRow } from "./disney-dining-detail.ts";
import { diffMenu } from "./menu-diff.ts";

/**
 * Retry a query through a transient connection drop. A cron run holds a pooled
 * client idle across slow serial menu fetches; the server/pooler can reap that
 * socket ("Connection terminated unexpectedly"). The pool discards the dead
 * client (see the `pool.on('error')` handler in db/index.ts), so a retry
 * acquires a fresh one. Matters most on a hash-churn run, where the per-venue
 * prev read fires hundreds of times — one dropped read used to kill the whole
 * run before any writes committed, so it re-churned and died again every run.
 * Connection-shaped errors only; a real query error still throws straight
 * through.
 */
async function withDbRetry<T>(op: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await op();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        /Connection terminated|terminating connection|ECONNRESET|ECONNREFUSED|socket hang up|connection error/i.test(
          msg,
        );
      if (!transient || i >= attempts) throw err;
      await new Promise((res) => setTimeout(res, 250 * i));
    }
  }
}

/**
 * Stable content hash of a venue's menu — drives change detection. Includes
 * the full price-tier list (plan item 1.6) so a beyond-first-tier move
 * registers.
 */
export function menuHash(rows: Array<DiningMenuItemRow>): string {
  const lines = rows
    .map((r) =>
      [
        r.mealPeriod,
        r.groupName,
        r.itemType,
        r.title,
        r.description,
        r.price,
        r.priceType,
        r.currency,
        r.prices ? JSON.stringify(r.prices) : "",
      ].join(""),
    )
    .sort();
  return createHash("sha256").update(lines.join("")).digest("hex");
}

export interface MenuPersistStats {
  changed: number;
  unchanged: number;
  priceChanges: number;
  added: number;
  removed: number;
}

/**
 * Persist fetched menus as change-only generations + the price/event logs.
 * Only venues present in `menuByFacility` are touched (a failed fetch simply
 * isn't in the map); an unchanged venue just bumps `lastCheckedAt`.
 */
export async function persistMenuGenerations(
  menuByFacility: Map<string, Array<DiningMenuItemRow>>,
  now: Date,
): Promise<MenuPersistStats> {
  const menuOk = [...menuByFacility.keys()];
  const existing = menuOk.length
    ? await db
        .select({
          facilityId: diningMenuSnapshot.facilityId,
          contentHash: diningMenuSnapshot.contentHash,
          observedAt: diningMenuSnapshot.observedAt,
        })
        .from(diningMenuSnapshot)
        .where(inArray(diningMenuSnapshot.facilityId, menuOk))
    : [];
  const snapByFid = new Map(existing.map((s) => [s.facilityId, s]));

  const newItems: Array<typeof diningMenuItem.$inferInsert> = [];
  const snapUpserts: Array<typeof diningMenuSnapshot.$inferInsert> = [];
  const priceRows: Array<typeof diningMenuPriceChange.$inferInsert> = [];
  const eventRows: Array<typeof diningMenuEvent.$inferInsert> = [];
  const unchanged: Array<string> = [];

  for (const fid of menuOk) {
    const next = menuByFacility.get(fid) ?? [];
    const hash = menuHash(next);
    const snap = snapByFid.get(fid);
    if (snap && snap.contentHash === hash) {
      unchanged.push(fid);
      continue;
    }
    if (snap) {
      const prev = await withDbRetry(() =>
        db
          .select({
            mealPeriod: diningMenuItem.mealPeriod,
            groupName: diningMenuItem.groupName,
            itemType: diningMenuItem.itemType,
            title: diningMenuItem.title,
            description: diningMenuItem.description,
            price: diningMenuItem.price,
            priceType: diningMenuItem.priceType,
            currency: diningMenuItem.currency,
            prices: diningMenuItem.prices,
          })
          .from(diningMenuItem)
          .where(
            and(eq(diningMenuItem.facilityId, fid), eq(diningMenuItem.observedAt, snap.observedAt)),
          ),
      );
      const diff = diffMenu(fid, prev, next);
      priceRows.push(...diff.priceRows);
      eventRows.push(...diff.eventRows);
    }
    for (const r of next) newItems.push({ ...r, observedAt: now });
    snapUpserts.push({
      facilityId: fid,
      contentHash: hash,
      observedAt: now,
      itemCount: next.length,
      lastCheckedAt: now,
    });
  }

  for (let i = 0; i < newItems.length; i += 500) {
    await db.insert(diningMenuItem).values(newItems.slice(i, i + 500));
  }
  for (let i = 0; i < snapUpserts.length; i += 500) {
    await db
      .insert(diningMenuSnapshot)
      .values(snapUpserts.slice(i, i + 500))
      .onConflictDoUpdate({
        target: diningMenuSnapshot.facilityId,
        set: {
          contentHash: sql`excluded.content_hash`,
          observedAt: sql`excluded.observed_at`,
          itemCount: sql`excluded.item_count`,
          lastCheckedAt: sql`excluded.last_checked_at`,
          // first_seen_at is preserved (never in the update set).
        },
      });
  }
  // Unchanged venues: just bump liveness.
  for (let i = 0; i < unchanged.length; i += 200) {
    await db
      .update(diningMenuSnapshot)
      .set({ lastCheckedAt: now })
      .where(inArray(diningMenuSnapshot.facilityId, unchanged.slice(i, i + 200)));
  }
  for (let i = 0; i < priceRows.length; i += 500) {
    await db.insert(diningMenuPriceChange).values(priceRows.slice(i, i + 500));
  }
  for (let i = 0; i < eventRows.length; i += 500) {
    await db.insert(diningMenuEvent).values(eventRows.slice(i, i + 500));
  }

  return {
    changed: snapUpserts.length,
    unchanged: unchanged.length,
    priceChanges: priceRows.length,
    added: eventRows.filter((e) => e.changeType === "added").length,
    removed: eventRows.filter((e) => e.changeType === "removed").length,
  };
}
