/**
 * Express Pass / date-priced ticket inventory scarcity (plan item 3.1).
 *
 * `sku_price_obs.available_units` is captured for Universal SKUs (Express, day
 * tickets) but research flagged that Universal appears to *cap* the reported
 * number (observed max 15) — so a raw "15 left" count can't be trusted as an
 * absolute. We therefore surface conservative scarcity *tiers* and only ever
 * claim scarcity (never abundance): a value at/above the cap reads as "plenty",
 * and we render nothing for it. Thresholds live here so they're config-side and
 * easy to retune once a real sell-out cycle confirms the cap's behavior.
 */

/** Tiers, most-scarce first. `plenty`/`null` intentionally render no badge. */
export type ScarcityTier = "selling_out" | "low" | "plenty";

/**
 * At/above this many units we assume the number is the display cap, not a true
 * count, and treat the date as unconstrained. Keep in sync with the observed cap.
 */
export const SCARCITY_CAP = 15;
/** ≤ this many units → "selling out". */
export const SELLING_OUT_MAX = 3;
/** ≤ this many units → "low" (but above the selling-out threshold). */
export const LOW_MAX = 8;

/**
 * Derive a scarcity tier from a captured unit count. Returns null when we have
 * no unit data (WDW admission never carries units) — the caller shows nothing.
 */
export function scarcityTier(availableUnits: number | null | undefined): ScarcityTier | null {
  if (availableUnits == null || availableUnits >= SCARCITY_CAP) {
    return availableUnits == null ? null : "plenty";
  }
  if (availableUnits <= SELLING_OUT_MAX) return "selling_out";
  if (availableUnits <= LOW_MAX) return "low";
  return "plenty";
}

/**
 * A raw "N left" chip for surfaces that want the actual number rather than a
 * hedged tier (the Tickets page shows real availability even when plentiful).
 * At/above the cap we render "N+" since Universal appears to cap the count, so
 * the true figure may be higher — honest without over-claiming. Color tracks the
 * scarcity tier so low counts still read as urgent. Returns null with no data.
 */
export function unitsLeftChip(
  availableUnits: number | null | undefined,
): { label: string; pill: string } | null {
  if (availableUnits == null) return null;
  const label = availableUnits >= SCARCITY_CAP ? `${SCARCITY_CAP}+ left` : `${availableUnits} left`;
  switch (scarcityTier(availableUnits)) {
    case "selling_out":
      return { label, pill: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300" };
    case "low":
      return {
        label,
        pill: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
      };
    default:
      return {
        label,
        pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
      };
  }
}

/**
 * Coarse capacity level for the map's zoomed-out park badges (the "limited
 * display" — a chip, not a number). `full` = today's Express is sold out or
 * nearly gone; `nearing` = getting low. Well-stocked / no-data → null (no chip).
 * Kept tier-based (not raw counts) here precisely because the display cap makes
 * absolute numbers unreliable at a glance.
 */
export type CapacityLevel = "nearing" | "full";

export function capacityFromUnits(
  available: boolean,
  availableUnits: number | null | undefined,
): CapacityLevel | null {
  if (!available) return "full"; // sold out for today
  switch (scarcityTier(availableUnits)) {
    case "selling_out":
      return "full";
    case "low":
      return "nearing";
    default:
      return null;
  }
}

export function capacityLabel(level: CapacityLevel): string {
  return level === "full" ? "At capacity" : "Nearing capacity";
}
