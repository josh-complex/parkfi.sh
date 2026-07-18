/**
 * Distance-unit preference for the walking-nav chrome. WDW/Universal guests think
 * in feet and miles, so we show imperial for US (and the two other imperial
 * holdouts) and metric everywhere else, inferred from the browser locale's
 * region. The same choice is passed to Valhalla (`directions_options.units`) so
 * the narrative instructions ("Continue for 300 feet") agree with the chrome.
 */

export type UnitSystem = "imperial" | "metric";

// The only countries that don't use metric for everyday distance.
const IMPERIAL_REGIONS = new Set(["US", "LR", "MM"]);

const M_PER_FOOT = 0.3048;
const M_PER_MILE = 1609.344;

/** Infer the guest's distance units from their locale. Defaults to metric off a
 *  secure/SSR context (no `navigator`) or an unrecognised region. */
export function preferredUnitSystem(): UnitSystem {
  if (typeof navigator === "undefined") return "metric";
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    if (!tag) continue;
    try {
      const region = new Intl.Locale(tag).maximize().region;
      if (region) return IMPERIAL_REGIONS.has(region) ? "imperial" : "metric";
    } catch {
      /* malformed tag — try the next */
    }
  }
  return "metric";
}

/** Valhalla's `directions_options.units` string for a unit system. */
export function valhallaUnits(units: UnitSystem): "miles" | "kilometers" {
  return units === "imperial" ? "miles" : "kilometers";
}

/**
 * Format a metre distance for display in the chosen units. Short distances read
 * in feet/metres (rounded to a walkable increment); longer ones in miles/km to
 * one decimal — the same shape nav apps use so "120 ft" / "0.3 mi" feel native.
 */
export function formatDistance(meters: number, units: UnitSystem): string {
  // Pick the unit *after* rounding, so a distance that rounds up to the
  // boundary ("1000 ft", "1000 m") tips into the larger unit instead.
  if (units === "imperial") {
    const feet = Math.max(0, Math.round(meters / M_PER_FOOT / 10) * 10);
    if (feet < 1000) return `${feet} ft`;
    return `${(meters / M_PER_MILE).toFixed(1)} mi`;
  }
  const m = Math.round(meters);
  return m < 1000 ? `${m} m` : `${(meters / 1000).toFixed(1)} km`;
}
