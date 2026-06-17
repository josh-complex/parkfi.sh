import { useEffect } from "react";

import { installPreloadErrorReload } from "#/lib/lazy-with-reload.tsx";

export function PWARegister() {
  useEffect(() => {
    // Backstop for any dynamic import not wrapped in `lazyWithReload`: a stale
    // chunk after a redeploy fires `vite:preloadError`, which we recover from by
    // reloading once for fresh HTML rather than crashing into the error boundary.
    installPreloadErrorReload();

    // Register the hand-written worker (public/sw.js) manually — we no longer use
    // vite-plugin-pwa. `updateViaCache: "none"` keeps the browser from serving a
    // cached sw.js, so a fixed/updated worker is picked up on the next visit; we
    // also kick an explicit update check. The worker itself does no precaching,
    // so there's no stale app shell to invalidate.
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => reg.update())
      .catch(() => {
        // A failed registration must not take the app down — push is best-effort.
      });
  }, []);

  return null;
}
