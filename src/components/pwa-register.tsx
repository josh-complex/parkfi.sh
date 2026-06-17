import { useEffect } from "react";
import { registerSW } from "virtual:pwa-register";

import { installPreloadErrorReload } from "#/lib/lazy-with-reload.tsx";

export function PWARegister() {
  useEffect(() => {
    registerSW({ immediate: true });
    // Backstop for any dynamic import not wrapped in `lazyWithReload`: a stale
    // chunk after a redeploy fires `vite:preloadError`, which we recover from by
    // reloading once for fresh HTML rather than crashing into the error boundary.
    installPreloadErrorReload();
  }, []);

  return null;
}
