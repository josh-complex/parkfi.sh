/**
 * Synthetic ride-trace presets (device-test-tooling Layer C1).
 *
 * Fabricate a `RideTrace` shaped like a plausible (or deliberately implausible)
 * ride, so the sensor achievement families, the recap toast, and the ride-debug
 * ring can be exercised on a device build without a real coaster. The fakes are
 * pushed through the very same path a native `rideDetected` trace takes
 * (`useDetectedRideHandler`), so they hit the real client signature gate and the
 * authoritative server `submitRideTrace` pipeline.
 *
 * A "good" preset clears both `hasRideSignature` and — for attractions with
 * published `coaster_stats` — the server's coaster clamp. The "bad" presets
 * exercise the two rejection surfaces: one the client suppresses (no signature),
 * one the server rejects (confidence too low).
 */
import type { RideMetrics, RideTrace } from "#/lib/ride-metrics.ts";

export interface TracePreset {
  id: string;
  label: string;
  /** What this preset is meant to demonstrate. */
  note: string;
  /** True for the deliberately-rejected/suppressed cases (panel styles them). */
  bad?: boolean;
  /** Field overrides applied over a plausible baseline. */
  metrics: Partial<RideMetrics>;
}

/** Estimated top speed from the largest drop: 3.6·√(2·g·h). */
function estTopSpeedKmh(maxDropM: number): number {
  return Math.round(3.6 * Math.sqrt(2 * 9.81 * maxDropM) * 10) / 10;
}

/** Build a full, schema-valid `RideTrace` from a preset, timestamped to end now. */
export function buildSyntheticTrace(preset: TracePreset, now = new Date()): RideTrace {
  const base: RideMetrics = {
    startedAt: "",
    endedAt: "",
    durationS: 90,
    dropCount: 2,
    airtimeS: 2,
    maxG: 3.5,
    inversions: 0,
    verticalM: 40,
    maxDropM: 20,
    estTopSpeedKmh: null,
    baroAvailable: true,
    gyroAvailable: true,
    confidence: 0.85,
  };
  const merged: RideMetrics = { ...base, ...preset.metrics };
  const endedAt = now;
  const startedAt = new Date(now.getTime() - merged.durationS * 1000);
  merged.startedAt = startedAt.toISOString();
  merged.endedAt = endedAt.toISOString();
  // Keep airtime within duration (schema invariant) and fill the speed estimate.
  merged.airtimeS = Math.min(merged.airtimeS, merged.durationS);
  merged.estTopSpeedKmh = merged.maxDropM > 0 ? estTopSpeedKmh(merged.maxDropM) : null;
  return { metrics: merged };
}

/**
 * The preset library. Conservative maxDrop/inversions on the "good" presets so
 * they clear the coaster clamp for most real attractions; match the preset to
 * the attraction you've armed the sim at for a genuine coaster.
 */
export const TRACE_PRESETS: readonly TracePreset[] = [
  {
    id: "kiddie",
    label: "Kiddie coaster",
    note: "One gentle drop; clears the signature by airtime + mild G.",
    metrics: {
      durationS: 45,
      dropCount: 1,
      airtimeS: 0.7,
      maxG: 2.0,
      inversions: 0,
      verticalM: 8,
      maxDropM: 4,
      confidence: 0.7,
    },
  },
  {
    id: "launched",
    label: "Launched coaster",
    note: "High sustained G, modest drop — launch-style signature.",
    metrics: {
      durationS: 90,
      dropCount: 2,
      airtimeS: 2.5,
      maxG: 4.4,
      inversions: 0,
      verticalM: 45,
      maxDropM: 20,
      confidence: 0.88,
    },
  },
  {
    id: "hyper",
    label: "Hyper coaster",
    note: "Big airtime + tall drop; drives vertical_m and drops.",
    metrics: {
      durationS: 150,
      dropCount: 5,
      airtimeS: 9,
      maxG: 3.6,
      inversions: 0,
      verticalM: 130,
      maxDropM: 35,
      confidence: 0.92,
    },
  },
  {
    id: "inverting",
    label: "Inverting coaster",
    note: "Two inversions + high G; drives inversions_ridden.",
    metrics: {
      durationS: 130,
      dropCount: 3,
      airtimeS: 4,
      maxG: 4.9,
      inversions: 2,
      verticalM: 90,
      maxDropM: 25,
      confidence: 0.9,
    },
  },
  {
    id: "walk-like",
    label: "Walk-like (suppressed)",
    note: "No drop, low G, sub-threshold airtime — client suppresses it.",
    bad: true,
    metrics: {
      durationS: 25,
      dropCount: 0,
      airtimeS: 0.1,
      maxG: 1.2,
      inversions: 0,
      verticalM: 1,
      maxDropM: 0.5,
      confidence: 0.2,
    },
  },
  {
    id: "low-confidence",
    label: "Low confidence (rejected)",
    note: "Clears the client signature but the server rejects on confidence.",
    bad: true,
    metrics: {
      durationS: 60,
      dropCount: 3,
      airtimeS: 3,
      maxG: 5.5,
      inversions: 1,
      verticalM: 60,
      maxDropM: 22,
      confidence: 0.3,
    },
  },
];
