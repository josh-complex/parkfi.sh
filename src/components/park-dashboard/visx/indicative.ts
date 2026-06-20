/**
 * Shared "indicative series" helper for the park-dashboard trend charts.
 *
 * A ride's trend has three kinds of bucket:
 *  - `live`   — a real standby reading.
 *  - `gap`    — no reading mid-day (ride down / feed gap): a hole inside the data.
 *  - `closed` — the park calendar says shut for that bucket.
 *
 * Historically the sparkline *broke* the line on every gap and the main chart
 * floored closed buckets to 0, so a row could read as a jagged set of stubs. We
 * instead want the line to stay continuous and show an *indicative* shape across
 * the missing stretches — bridged with a dashed stroke over a hatch band so it's
 * obvious at a glance the data isn't live there.
 *
 * `indicativeSeries` fills every index with a drawable value (gaps linearly
 * interpolated between the nearest live readings, closed buckets sunk to the
 * baseline) and tags each index. `strokeRuns` then splits that into contiguous
 * runs the renderer strokes solid (live) or dashed (bridged), with adjacent runs
 * sharing a boundary index so the line has no visual seam.
 */

export type SparkKind = "live" | "gap" | "closed";

export interface RawPoint {
  /** A live numeric reading, or null when there's no reading for this bucket. */
  value: number | null;
  /** Park-calendar-closed at this bucket (sinks to the baseline, not bridged). */
  closed?: boolean;
}

export interface IndicativeSeries {
  /** A drawable value at every index — never null once there's any live data. */
  values: number[];
  /** Per-index classification, parallel to `values`. */
  kinds: SparkKind[];
  /** False when the series has no live reading at all (nothing to anchor to). */
  hasLive: boolean;
}

/**
 * Fill a raw (value | null, closed?) series into a continuous one:
 *  - live buckets keep their value,
 *  - closed buckets take `baseline` (the floor — the trend dips, not bridges),
 *  - gap buckets are linearly interpolated between the nearest live readings
 *    (held flat at a window edge that has live data on only one side).
 * With no live data anywhere, `values` is all `baseline` and `hasLive` is false.
 */
export function indicativeSeries(points: RawPoint[], baseline = 0): IndicativeSeries {
  const n = points.length;
  const kinds: SparkKind[] = points.map((p) =>
    p.closed ? "closed" : p.value == null ? "gap" : "live",
  );

  // Nearest live index at or before / at or after each position, for interpolation.
  const prevLive = Array.from({ length: n }, () => -1);
  const nextLive = Array.from({ length: n }, () => -1);
  for (let i = 0, last = -1; i < n; i++) {
    if (kinds[i] === "live") last = i;
    prevLive[i] = last;
  }
  for (let i = n - 1, next = -1; i >= 0; i--) {
    if (kinds[i] === "live") next = i;
    nextLive[i] = next;
  }

  const hasLive = prevLive[n - 1] >= 0;
  const values = Array.from({ length: n }, () => baseline);
  for (let i = 0; i < n; i++) {
    if (kinds[i] === "live") {
      values[i] = points[i].value as number;
    } else if (kinds[i] === "closed") {
      values[i] = baseline;
    } else {
      const a = prevLive[i];
      const b = nextLive[i];
      if (a < 0 && b < 0) values[i] = baseline;
      else if (a < 0) values[i] = points[b].value as number;
      else if (b < 0) values[i] = points[a].value as number;
      else {
        const va = points[a].value as number;
        const vb = points[b].value as number;
        values[i] = va + ((vb - va) * (i - a)) / (b - a);
      }
    }
  }
  return { values, kinds, hasLive };
}

/**
 * Split a kind series into contiguous stroke runs. A run is `bridge` (draw
 * dashed) unless both endpoints of every pair in it are live (draw solid).
 * Adjacent runs share their boundary index, so the rendered line is seamless.
 */
export function strokeRuns(kinds: SparkKind[]): Array<{ bridge: boolean; idx: number[] }> {
  const runs: Array<{ bridge: boolean; idx: number[] }> = [];
  for (let i = 0; i < kinds.length - 1; i++) {
    const bridge = !(kinds[i] === "live" && kinds[i + 1] === "live");
    const last = runs[runs.length - 1];
    if (!last || last.bridge !== bridge) runs.push({ bridge, idx: [i, i + 1] });
    else last.idx.push(i + 1);
  }
  return runs;
}
