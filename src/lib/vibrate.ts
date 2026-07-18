/**
 * Haptics for achievement celebrations.
 *
 * On the web this is the Vibration API — missing on iOS Safari and inert outside
 * a secure context, so every call degrades to a silent no-op. In the native
 * shell `navigator.vibrate` is undefined in WKWebView (and unreliable in Android
 * WebView), so unlocks/level-ups route through `@capacitor/haptics` instead. The
 * plugin is dynamically imported so the web bundle never pulls it in (callers
 * always reach this through `isNative()`-gated paths anyway).
 *
 * The exported API is identical on both platforms; only the delivery differs.
 */
import { isNative } from "#/lib/platform.ts";

/** Web Vibration API — no-op when unsupported (iOS Safari, insecure context). */
function webVibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined") navigator.vibrate?.(pattern);
  } catch {
    /* no-op — Vibration API unsupported/blocked */
  }
}

/** Raw pattern vibration (web only; a plain no-op in the native shell). */
export function vibrate(pattern: number | number[]): void {
  webVibrate(pattern);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Native impact ladder for a tier unlock: (tier−1) light taps building into a
 * Medium then a Heavy finale, so higher tiers read as a bigger celebration —
 * the native analogue of the web pulse pattern below.
 */
async function nativeUnlock(tier: number): Promise<void> {
  const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
  for (let i = 0; i < tier - 1; i++) {
    await Haptics.impact({ style: ImpactStyle.Light });
    await sleep(90);
  }
  await Haptics.impact({ style: ImpactStyle.Medium });
  await sleep(90);
  await Haptics.impact({ style: ImpactStyle.Heavy });
}

/** Native level-up: a short impact drumroll capped by a Success notification. */
async function nativeLevelUp(): Promise<void> {
  const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
  for (let i = 0; i < 4; i++) {
    await Haptics.impact({ style: ImpactStyle.Light });
    await sleep(45);
  }
  await Haptics.notification({ type: NotificationType.Success });
}

/**
 * Tier-scaled "ta-da". On web: tier 1 is a short double-pulse with a punchy
 * finale, each extra tier prepends a [35, 60] pulse and grows the finale by
 * 40 ms (capped 250 ms). On native: the impact ladder in {@link nativeUnlock}.
 */
export function vibrateUnlock(tierIndex: number): void {
  const tier = Math.max(1, Math.floor(tierIndex));
  if (isNative()) {
    void nativeUnlock(tier).catch(() => {
      /* haptics unavailable — best-effort */
    });
    return;
  }
  const extraPulses = tier - 1;
  const pulses: number[] = [];
  for (let i = 0; i < extraPulses; i++) pulses.push(35, 60);
  const finale = Math.min(90 + extraPulses * 40, 250);
  webVibrate([...pulses, 35, 60, 35, 60, finale]);
}

/** Arrival buzz for walking navigation: a short double-pulse capped by a Success
 *  notification on native — a distinct "you're here" that reads apart from the
 *  celebratory unlock ladder. Best-effort; silent where haptics are unavailable. */
export function vibrateArrival(): void {
  if (isNative()) {
    void (async () => {
      const { Haptics, NotificationType } = await import("@capacitor/haptics");
      await Haptics.notification({ type: NotificationType.Success });
    })().catch(() => {
      /* haptics unavailable — best-effort */
    });
    return;
  }
  webVibrate([60, 80, 120]);
}

/** Level-up drumroll: web = six 15 ms taps then a 250 ms boom; native = a short
 *  impact run capped by a Success notification. */
export function vibrateLevelUp(): void {
  if (isNative()) {
    void nativeLevelUp().catch(() => {
      /* haptics unavailable — best-effort */
    });
    return;
  }
  const taps: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (i > 0) taps.push(30);
    taps.push(15);
  }
  webVibrate([...taps, 30, 250]);
}
