import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "sh.parkfi.app",
  appName: "ParkFi",
  // Populated by `bun run build:native` (NATIVE_BUILD=1 vp build → copied here).
  webDir: "dist-native",
  // Live-reload dev: point the shell at a running `vp dev` server on the LAN:
  //   CAP_SERVER_URL=http://<mac-lan-ip>:3000 bun cap run ios
  // In that mode auth is same-origin, so the bearer/CORS paths are only
  // exercised against prod-style builds — test both.
  ...(process.env.CAP_SERVER_URL
    ? { server: { url: process.env.CAP_SERVER_URL, cleartext: true } }
    : {}),
};

export default config;
