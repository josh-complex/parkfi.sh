/**
 * Stable, visually-distinct colors for the per-ride series in the whole-park
 * chart and its legend. The app's `--chart-*` tokens are a five-step blue ramp —
 * great for one or two series, useless for telling a dozen rides apart. So we
 * spread hues by the golden angle (137.5°), which keeps adjacent indices far
 * apart on the wheel and avoids clustering even past 30+ rides.
 */
export function rideColor(index: number): string {
  const hue = (index * 137.508) % 360;
  // Nudge lightness/sat per step so same-ish hues that wrap around still read
  // as different swatches.
  const sat = 62 + ((index * 13) % 18);
  const light = 48 + ((index * 7) % 14);
  return `hsl(${hue.toFixed(1)} ${sat}% ${light}%)`;
}
