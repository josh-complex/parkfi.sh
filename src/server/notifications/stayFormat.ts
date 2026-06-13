/**
 * Shared shape + formatting for stay-alert notifications. The evaluator builds a
 * `StayNotificationPayload` (persisted as `notification.payload`); the mailer
 * renders from it. Kept framework-free so both the worker and the evaluator can
 * import it without pulling in React.
 */
import {
  RESORT_BY_ID,
  RESORT_CATALOG,
  type ResortTier,
} from "#/server/stays/resort-catalog.generated.ts";

/** What we persist on `notification.payload` — enough to render + audit. */
export interface StayNotificationPayload {
  mode: number; // 1 = becomes_available, 2 = price_below
  resortId: string; // '' = any resort
  resortName: string;
  checkInDate: string;
  checkOutDate: string;
  dateRange: string;
  pricePerNight: number | null;
  priceBelow: number | null;
  subject: string;
}

// ---------------------------------------------------------------------------
// Alert scope — the canonical `stay_alert.scope` selector. '' = any resort,
// 'r:<id>' = one resort, 't:<tier>' = a tier, 'a:<area>' = a resort area. Kept
// here (framework-free) so the evaluator and the tRPC router resolve it the same.
// ---------------------------------------------------------------------------

const TIER_LABELS: Record<ResortTier, string> = {
  value: "Value resorts",
  moderate: "Moderate resorts",
  deluxe: "Deluxe resorts",
  villa: "Disney Vacation Club villas",
  campground: "Campgrounds",
};

/** Build a scope token from its parts; resortId wins, then tier, then area. */
export function buildScope(parts: { resortId?: string; tier?: ResortTier; area?: string }): string {
  if (parts.resortId) return `r:${parts.resortId}`;
  if (parts.tier) return `t:${parts.tier}`;
  if (parts.area) return `a:${parts.area}`;
  return "";
}

/**
 * The set of catalog resort ids a scope matches, or `null` for "any resort"
 * (the evaluator/list treat null as "no resort filter"). Tier/area scopes that
 * match nothing return an empty array (matches no resort, never fires).
 */
export function resortIdsForScope(scope: string): string[] | null {
  if (!scope) return null; // any resort
  if (scope.startsWith("r:")) return [scope.slice(2)];
  if (scope.startsWith("t:")) {
    const tier = scope.slice(2);
    return RESORT_CATALOG.filter((r) => r.tier === tier).map((r) => r.id);
  }
  if (scope.startsWith("a:")) {
    const area = scope.slice(2);
    return RESORT_CATALOG.filter((r) => r.area === area).map((r) => r.id);
  }
  return null;
}

/**
 * Two parallel arrays enumerating every (scope-token, resort-id) pair the
 * catalog implies — one 'r:<id>' row plus the resort's 't:<tier>' and 'a:<area>'
 * rows per resort. Fed to `unnest(...)` as a `scope_map` CTE so a single
 * set-based query can resolve any non-empty scope to its resort set (the ''
 * "any" scope is handled by a short-circuit, not the map).
 */
export function scopeResortPairs(): { scopes: string[]; resorts: string[] } {
  const scopes: string[] = [];
  const resorts: string[] = [];
  for (const r of RESORT_CATALOG) {
    scopes.push(`r:${r.id}`);
    resorts.push(r.id);
    scopes.push(`t:${r.tier}`);
    resorts.push(r.id);
    if (r.area) {
      scopes.push(`a:${r.area}`);
      resorts.push(r.id);
    }
  }
  return { scopes, resorts };
}

/** Human label for a scope token (for emails + the alerts manager). */
export function scopeLabel(scope: string): string {
  if (!scope) return "Any resort";
  if (scope.startsWith("r:")) return RESORT_BY_ID.get(scope.slice(2))?.name ?? "a Disney Resort";
  if (scope.startsWith("t:")) return TIER_LABELS[scope.slice(2) as ResortTier] ?? "resorts";
  if (scope.startsWith("a:")) return scope.slice(2);
  return "Any resort";
}

/** Display name for a resort alert; "any" alerts name the cheapest open resort. */
export function resortDisplayName(resortId: string, cheapestResortId?: string | null): string {
  if (resortId) return RESORT_BY_ID.get(resortId)?.name ?? "a Disney Resort";
  if (cheapestResortId) {
    return RESORT_BY_ID.get(cheapestResortId)?.name ?? "a Walt Disney World Resort";
  }
  return "Walt Disney World Resorts";
}

/** "Jul 4 – Jul 6, 2026" from two YYYY-MM-DD strings. */
export function formatDateRange(checkIn: string, checkOut: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(checkIn)} – ${fmt(checkOut)}, ${checkOut.slice(0, 4)}`;
}
