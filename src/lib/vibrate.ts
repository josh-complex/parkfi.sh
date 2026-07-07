/**
 * Best-effort haptics for achievement celebrations. The Vibration API is
 * missing on iOS Safari and inert outside a secure context — every call here
 * degrades to a silent no-op rather than throwing.
 */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined") navigator.vibrate?.(pattern);
  } catch {
    /* no-op — Vibration API unsupported/blocked */
  }
}

/**
 * Tier-scaled "ta-da": tier 1 is a short double-pulse with a punchy finale.
 * Each additional tier prepends another [35, 60] pulse and grows the finale by
 * 40ms (capped at 250ms), so higher tiers read as a bigger celebration.
 */
export function vibrateUnlock(tierIndex: number): void {
  const tier = Math.max(1, Math.floor(tierIndex));
  const extraPulses = tier - 1;
  const pulses: number[] = [];
  for (let i = 0; i < extraPulses; i++) pulses.push(35, 60);
  const finale = Math.min(90 + extraPulses * 40, 250);
  vibrate([...pulses, 35, 60, 35, 60, finale]);
}

/** Level-up drumroll: six 15ms taps at 30ms gaps, then a 250ms boom. */
export function vibrateLevelUp(): void {
  const taps: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (i > 0) taps.push(30);
    taps.push(15);
  }
  vibrate([...taps, 30, 250]);
}
