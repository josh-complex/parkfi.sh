import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "sh.parkfi.app",
  appName: "ParkFi",
  // Populated by `bun run build:native` (NATIVE_BUILD=1 vp build → copied here).
  webDir: "dist-native",
  plugins: {
    // SystemBars ships with @capacitor/core. Under mandatory edge-to-edge (Android
    // SDK 35+), the CSS `env(safe-area-inset-*)` values are 0/wrong on WebView < 140.
    // `insetsHandling: "css"` (the default, pinned here for intent) injects correct
    // native insets as `--safe-area-inset-*` CSS vars; our `--safe-*` vars in
    // styles.css read those first and fall back to `env()` on iOS/browser.
    SystemBars: { insetsHandling: "css" },
    // Hold the OS launch image until the SPA has painted, then `SplashScreen.hide()`
    // fires from __root (with a failsafe timeout). Auto-hiding instead flashes a
    // blank WebView before first paint on a cold start. Background matches the
    // brand `theme-color` so the seam is invisible.
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#1c468e",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    // `resize: "none"` matches the app's keyboard model — Android's
    // `windowSoftInputMode="adjustNothing"` + the viewport's
    // `interactive-widget=resizes-visual`, so the IME shrinks only the *visual*
    // viewport and keyboard-aware panels (omni-search) size off `visualViewport`
    // rather than the WebView being resized out from under a fixed layout.
    Keyboard: { resize: "none" },
  },
  // Live-reload dev: point the shell at a running `vp dev` server on the LAN:
  //   CAP_SERVER_URL=http://<mac-lan-ip>:3000 bun cap run ios
  // In that mode auth is same-origin, so the bearer/CORS paths are only
  // exercised against prod-style builds — test both.
  ...(process.env.CAP_SERVER_URL
    ? { server: { url: process.env.CAP_SERVER_URL, cleartext: true } }
    : {}),
};

export default config;
