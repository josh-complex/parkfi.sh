import { useEffect } from "react";
import { useTheme } from "next-themes";

import { hideNavigationBar, syncStatusBarStyle } from "#/lib/native-system-bars.ts";

/**
 * Native shell only: keeps the device system bars in step with the app.
 *
 * - The top status-bar icons follow the *app* theme (next-themes), so they read
 *   as dark on our light surfaces and only flip light in dark mode — the OS
 *   default of light icons is otherwise invisible against most app screens.
 * - Android: the bottom gesture bar is hidden (it returns on swipe, then
 *   auto-hides) for a cleaner edge-to-edge map/dashboard.
 *
 * Renders nothing and no-ops on web/SSR (the helpers gate on `isNative()`), but
 * must live inside the `ThemeProvider` so `useTheme` resolves.
 */
export function NativeSystemBars() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    void syncStatusBarStyle(resolvedTheme === "dark" ? "dark" : "light");
  }, [resolvedTheme]);

  useEffect(() => {
    void hideNavigationBar();
  }, []);

  return null;
}
