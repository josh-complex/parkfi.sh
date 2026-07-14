import { SystemBars, SystemBarType, SystemBarsStyle } from "@capacitor/core";

import { isNative, nativePlatform } from "#/lib/platform.ts";

/**
 * Native system-bar control (Capacitor 8's `SystemBars`, bundled with
 * `@capacitor/core`). No-ops on web/SSR so callers don't need to guard.
 *
 * See {@link file://../components/native-system-bars.tsx} for the component that
 * drives these off the app theme at runtime.
 */

/**
 * Colour the top status-bar icons/text to suit the app's *resolved* theme
 * (next-themes `resolvedTheme`, which follows the device setting when the theme
 * is "system"). On a light app surface we want dark icons; only on a dark
 * surface do they flip light — otherwise the default light icons are invisible
 * on our mostly-white surfaces.
 */
export async function syncStatusBarStyle(theme: "light" | "dark"): Promise<void> {
  if (!isNative()) return;
  await SystemBars.setStyle({
    // Capacitor's naming is inverted relative to the *background*: `Light` means
    // dark content on a light background (i.e. dark icons), `Dark` means light
    // content. So a light app theme maps to `Light`.
    style: theme === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    bar: SystemBarType.StatusBar,
  });
}

/**
 * Android only: hide the bottom gesture/navigation bar for a cleaner
 * edge-to-edge shell. It reappears transiently on an edge swipe and then
 * auto-hides again — the immersive-sticky behaviour is set natively in
 * `MainActivity` (`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`); `SystemBars.hide`
 * alone doesn't configure it. No-op on iOS (its home indicator isn't hideable).
 */
export async function hideNavigationBar(): Promise<void> {
  if (!isNative() || nativePlatform() !== "android") return;
  await SystemBars.hide({ bar: SystemBarType.NavigationBar });
}
