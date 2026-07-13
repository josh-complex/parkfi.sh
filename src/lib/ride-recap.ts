/**
 * Pure formatting for the post-ride recap (B6). Turns on-device
 * {@link RideMetrics} into a short human summary — e.g.
 * "2 drops · 4.1 g · 8 s airtime · speed est. 96 km/h".
 *
 * `estTopSpeedKmh` is ALWAYS an estimate (derived from the barometric drop),
 * so it's labeled "est." here and everywhere it surfaces.
 */
import type { RideMetrics } from "#/lib/ride-metrics.ts";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The recap segments, most salient first. Empty-valued metrics are dropped. */
export function rideRecapSegments(m: RideMetrics): string[] {
  const parts: string[] = [];
  if (m.dropCount > 0) parts.push(plural(m.dropCount, "drop"));
  if (m.inversions > 0) parts.push(plural(m.inversions, "inversion"));
  if (m.maxG >= 1) parts.push(`${m.maxG.toFixed(1)} g`);
  if (m.airtimeS >= 1) parts.push(`${Math.round(m.airtimeS)} s airtime`);
  if (m.estTopSpeedKmh != null && m.estTopSpeedKmh > 0) {
    parts.push(`speed est. ${Math.round(m.estTopSpeedKmh)} km/h`);
  }
  return parts;
}

/** Single-line recap; falls back to a neutral line when nothing stood out. */
export function formatRideRecap(m: RideMetrics): string {
  const parts = rideRecapSegments(m);
  if (parts.length === 0) return "Ride logged.";
  return parts.join(" · ");
}
