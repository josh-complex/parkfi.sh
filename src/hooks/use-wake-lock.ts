import * as React from "react";

/**
 * Hold a screen wake lock while `active`, so the phone doesn't sleep mid-walk —
 * the single biggest real-world nav flow killer (§3.1). Uses the Screen Wake
 * Lock API, which is supported in modern browsers and in both Capacitor WebViews
 * (Android WebView, iOS 16.4+ WKWebView), so the native shell is covered without
 * an extra plugin. The lock auto-releases whenever the page is hidden, so we
 * re-acquire on `visibilitychange`. A plain no-op where the API is unavailable.
 */
export function useWakeLock(active: boolean): void {
  React.useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    const wakeLock = navigator.wakeLock;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const lock = await wakeLock.request("screen");
        // Cleanup may have run while the request was in flight — its release()
        // saw a null sentinel, so this lock is ours to drop or it leaks for the
        // rest of the session.
        if (cancelled) {
          void lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
      } catch {
        /* rejected (not visible, low battery, unsupported) — best-effort */
      }
    };
    // Re-acquire when we come back to the foreground: the OS drops the lock when
    // the page is hidden (app switch, screen off from a hardware button).
    const onVisibility = () => {
      if (document.visibilityState === "visible") void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {
        /* already released */
      });
      sentinel = null;
    };
  }, [active]);
}
