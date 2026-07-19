import { registerPlugin } from "@capacitor/core";

import { isNative } from "#/lib/platform.ts";

/**
 * Bridge to our local `DeviceCorners` plugin (see
 * `android/.../DeviceCornersPlugin.java` and `ios/.../DeviceCornersPlugin.swift`;
 * background in research/device-corner-radius.md): the physical display's
 * rounded-corner radii in CSS px, so edge-hugging UI (the bottom nav) can be
 * concentric with the bezel instead of guessing.
 */

interface DeviceCornersPlugin {
  getCorners(): Promise<{
    topLeft: number;
    topRight: number;
    bottomLeft: number;
    bottomRight: number;
  }>;
}

const DeviceCorners = registerPlugin<DeviceCornersPlugin>("DeviceCorners");

/**
 * Native shell only: publish the device's bottom corner radii as the
 * `--device-corner-radius-{bl,br}` CSS vars consumed in styles.css. The radius
 * is fixed per device, so a single read at startup is enough. On web/SSR (and
 * on any bridge error) this no-ops and the stylesheet defaults — tuned to
 * preserve the designed web rounding — stay in effect.
 */
export async function syncDeviceCornerRadius(): Promise<void> {
  if (!isNative()) return;
  try {
    const corners = await DeviceCorners.getCorners();
    const root = document.documentElement.style;
    root.setProperty("--device-corner-radius-bl", `${corners.bottomLeft}px`);
    root.setProperty("--device-corner-radius-br", `${corners.bottomRight}px`);
  } catch {
    // Older shell without the plugin — keep the CSS defaults.
  }
}
