import { registerPlugin } from "@capacitor/core";

import type { RideRecorderPlugin } from "./definitions";

/**
 * The native `RideRecorder` plugin. On the web this proxy falls back to the
 * no-op stub in `web.ts` (every method rejects with "unavailable"); callers
 * must gate on the native platform first.
 */
const RideRecorder = registerPlugin<RideRecorderPlugin>("RideRecorder", {
  web: () => import("./web").then((m) => new m.RideRecorderWeb()),
});

export * from "./definitions";
export { RideRecorder };
