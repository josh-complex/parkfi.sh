import { Capacitor } from "@capacitor/core";

/**
 * Runtime platform detection for the Capacitor native shell.
 *
 * On the web (SSR or browser) `Capacitor.isNativePlatform()` is `false` and
 * `getPlatform()` returns `"web"`; inside the iOS/Android WebView they report
 * the native platform. Use `isNative()` to gate anything that only makes sense
 * in the shell — bearer auth headers, native OAuth, push token registration,
 * the sensor plugin — and to hide web-only affordances (service worker, PWA
 * install prompt, passkeys) on native.
 */
export const isNative = (): boolean => Capacitor.isNativePlatform();

export const nativePlatform = (): "ios" | "android" | "web" =>
  Capacitor.getPlatform() as "ios" | "android" | "web";
