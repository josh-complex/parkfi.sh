/**
 * Pure menu-diff logic shared by the `dining-facilities` cron (live diffing) and
 * the one-time event backfill (reconstructing history from retained
 * `dining_menu_item` generations). No I/O — given a previous and next menu it
 * returns the price-move rows and the item lifecycle events. Kept side-effect
 * free so both callers, and unit tests, run the exact same rules.
 */
import type { DiningMenuItemRow } from "#/server/dining/disney-dining-detail.ts";
import type { diningMenuEvent, diningMenuPriceChange } from "#/db/schema.ts";

export type PrevMenuRow = Pick<
  DiningMenuItemRow,
  | "mealPeriod"
  | "groupName"
  | "itemType"
  | "title"
  | "description"
  | "price"
  | "priceType"
  | "currency"
  | "prices"
>;

/**
 * An item's price tiers for diffing (plan item 1.6). Generations captured
 * before the `prices` column existed degrade to the single denormalized price,
 * so a first post-upgrade diff compares tier-vs-first-price rather than
 * treating every tier as new.
 */
function tiersOf(r: PrevMenuRow | DiningMenuItemRow): Map<string, number> {
  const m = new Map<string, number>();
  const list =
    r.prices ?? (r.price != null ? [{ amount: r.price, type: r.priceType, currency: null }] : []);
  for (const t of list) {
    const key = t.type ?? "";
    if (!m.has(key)) m.set(key, t.amount);
  }
  return m;
}

/**
 * Pair the prev/next rows that share a price-key bucket. The common case is one
 * row per side — a trivial pairing. But Disney sometimes publishes DUPLICATE
 * TITLES within a (period, group): two genuinely different items both named,
 * e.g., "Chicken Milanesa Sandwich" (one a cutlet, one a beef burger). Those
 * land in the same bucket, and pairing by raw occurrence index can cross-match
 * the chicken row against the beef row across generations — emitting a phantom
 * price move. So for multi-row buckets we align by `description` first (like
 * with like); only leftovers with no description match fall back to order (a
 * real description edit on a dup-title item). Single-row buckets are untouched,
 * so normal items — including a same-title item whose description AND price both
 * changed — behave exactly as before.
 */
function pairForPriceMoves(
  prevRows: Array<PrevMenuRow>,
  nextRows: Array<DiningMenuItemRow>,
): Array<[PrevMenuRow, DiningMenuItemRow]> {
  if (prevRows.length <= 1 || nextRows.length <= 1) {
    return prevRows.length > 0 && nextRows.length > 0 ? [[prevRows[0]!, nextRows[0]!]] : [];
  }
  const pairs: Array<[PrevMenuRow, DiningMenuItemRow]> = [];
  const prevPool = [...prevRows];
  const leftoverNext: Array<DiningMenuItemRow> = [];
  for (const n of nextRows) {
    const idx = prevPool.findIndex((p) => p.description === n.description);
    if (idx >= 0) {
      pairs.push([prevPool[idx]!, n]);
      prevPool.splice(idx, 1);
    } else {
      leftoverNext.push(n);
    }
  }
  for (let i = 0; i < Math.min(prevPool.length, leftoverNext.length); i++) {
    pairs.push([prevPool[i]!, leftoverNext[i]!]);
  }
  return pairs;
}

/** Groups menu rows by a composed key, preserving insertion order per bucket. */
function bucketBy<T>(rows: Array<T>, keyOf: (r: T) => string): Map<string, Array<T>> {
  const m = new Map<string, Array<T>>();
  for (const r of rows) {
    const key = keyOf(r);
    const list = m.get(key);
    if (list) list.push(r);
    else m.set(key, [r]);
  }
  return m;
}

/**
 * The rows in `a` with no counterpart in `b`, matched by title and occurrence
 * count — the multiset difference a \ b. Titles present in both (persisting
 * items) are consumed pair-for-pair; only the excess falls through. Used per
 * (meal period, group) to find the items added / removed between generations.
 */
function titleExcess<T extends { title: string }>(
  a: Array<T>,
  b: Array<{ title: string }>,
): Array<T> {
  const remaining = new Map<string, number>();
  for (const r of b) remaining.set(r.title, (remaining.get(r.title) ?? 0) + 1);
  const out: Array<T> = [];
  for (const r of a) {
    const rem = remaining.get(r.title) ?? 0;
    if (rem > 0) remaining.set(r.title, rem - 1);
    else out.push(r);
  }
  return out;
}

/**
 * Diff a venue's previous menu generation against the next one, producing both
 * the price-move log rows and the item lifecycle events (added / removed).
 * Two independent passes:
 *   • Price moves — persisting items matched by (period, group, title, type),
 *     duplicate titles aligned by description (see `pairForPriceMoves`) so a
 *     chicken row never diffs against a same-named beef row; each price TIER
 *     that differs emits a row naming the tier (plan item 1.6).
 *   • Roster — per (period, group), the multiset title difference gives the
 *     items added and removed.
 * Composite keys join fields with a U+0001 delimiter (a control char that can't
 * occur in a title/group name) so adjacent fields can't fuse into one key.
 */
export function diffMenu(
  facilityId: string,
  prev: Array<PrevMenuRow>,
  next: Array<DiningMenuItemRow>,
): {
  priceRows: Array<typeof diningMenuPriceChange.$inferInsert>;
  eventRows: Array<typeof diningMenuEvent.$inferInsert>;
} {
  const priceRows: Array<typeof diningMenuPriceChange.$inferInsert> = [];
  const eventRows: Array<typeof diningMenuEvent.$inferInsert> = [];

  // --- Price moves on persisting items. ---
  const priceKey = (r: PrevMenuRow | DiningMenuItemRow): string =>
    `${r.mealPeriod}${r.groupName ?? ""}${r.title}${r.priceType ?? ""}`;
  const prevByPriceKey = bucketBy(prev, priceKey);
  for (const [key, nextRows] of bucketBy(next, priceKey)) {
    const prevRows = prevByPriceKey.get(key) ?? [];
    for (const [prevRow, r] of pairForPriceMoves(prevRows, nextRows)) {
      // Compare per tier (plan item 1.6): one row per tier that moved, its
      // `priceType` naming the tier ("Per Glass $14 → $16"). A tier appearing
      // or vanishing logs with a null old/new side.
      const oldTiers = tiersOf(prevRow);
      const newTiers = tiersOf(r);
      for (const tierType of new Set([...oldTiers.keys(), ...newTiers.keys()])) {
        const oldPrice = oldTiers.get(tierType) ?? null;
        const newPrice = newTiers.get(tierType) ?? null;
        if (oldPrice === newPrice) continue;
        priceRows.push({
          facilityId,
          mealPeriod: r.mealPeriod,
          groupName: r.groupName,
          title: r.title,
          oldPrice,
          newPrice,
          priceType: tierType || null,
          currency: r.currency,
        });
      }
    }
  }

  // --- Roster changes (adds / removes), per (period, group). ---
  const groupKey = (r: PrevMenuRow | DiningMenuItemRow): string =>
    `${r.mealPeriod}${r.groupName ?? ""}`;
  const prevGroups = bucketBy(prev, groupKey);
  const nextGroups = bucketBy(next, groupKey);

  for (const g of new Set([...prevGroups.keys(), ...nextGroups.keys()])) {
    const removed = titleExcess(prevGroups.get(g) ?? [], nextGroups.get(g) ?? []);
    const added = titleExcess(nextGroups.get(g) ?? [], prevGroups.get(g) ?? []);

    for (const rem of removed) {
      eventRows.push({
        facilityId,
        changeType: "removed",
        mealPeriod: rem.mealPeriod,
        groupName: rem.groupName,
        itemType: rem.itemType,
        title: rem.title,
        price: rem.price,
        priceType: rem.priceType,
        currency: rem.currency,
      });
    }
    for (const a of added) {
      eventRows.push({
        facilityId,
        changeType: "added",
        mealPeriod: a.mealPeriod,
        groupName: a.groupName,
        itemType: a.itemType,
        title: a.title,
        price: a.price,
        priceType: a.priceType,
        currency: a.currency,
      });
    }
  }

  return { priceRows, eventRows };
}
