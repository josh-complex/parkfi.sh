import { isNative } from "#/lib/platform.ts";

/**
 * Native splash-screen control (`@capacitor/splash-screen`). No-op on web/SSR.
 *
 * We run with `launchAutoHide: false` (capacitor.config.ts) so the OS launch
 * image stays up through the WebView cold start instead of auto-dismissing to a
 * white flash before the SPA has painted. This helper is the *only* place that
 * dismisses it — called once the first route has resolved and rendered (see
 * `__root.tsx`). A belt-and-braces timeout guarantees the splash never wedges on
 * forever if that call site somehow doesn't run (a hydration error, say).
 */

let hidden = false;

/** Dismiss the launch splash once the app has painted. Idempotent; safe to call
 *  more than once. The dynamic import keeps the plugin out of the web bundle. */
export async function hideSplash(): Promise<void> {
  if (!isNative() || hidden) return;
  hidden = true;
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    /* plugin unavailable — nothing to hide */
  }
}

/** Arm a fallback that force-hides the splash after `ms`, so a stalled first
 *  paint can't leave the user staring at the launch image indefinitely. */
export function armSplashFailsafe(ms = 4_000): void {
  if (!isNative()) return;
  setTimeout(() => void hideSplash(), ms);
}
