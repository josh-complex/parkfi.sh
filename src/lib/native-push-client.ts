/**
 * Native (Capacitor) push registration for the ParkFi shell — iOS + Android.
 *
 * Both platforms route through FCM (see server `native-push.ts`): iOS APNs is
 * proxied by Firebase Cloud Messaging so there's a single sender. The
 * `@capacitor/push-notifications` `register()` call returns the FCM token via
 * the async `registration` event, which we bridge into a promise here.
 *
 * Everything is dynamically imported so the web bundle never pulls in the
 * plugin — callers gate on `isNative()` first (see use-push-notifications.ts).
 */
import { isNative, nativePlatform } from "#/lib/platform.ts";

type NativePermission = "granted" | "denied" | "prompt";

// The device's current FCM token, cached after the first successful register so
// unsubscribe + the bind-on-login re-registration can reference it.
let cachedToken: string | null = null;
let tapHandlerReady = false;

export function getCachedFcmToken(): string | null {
  return cachedToken;
}

export function nativePushPlatform(): "ios" | "android" {
  // Callers gate on isNative(), so getPlatform() is never "web" here.
  return nativePlatform() === "android" ? "android" : "ios";
}

/** Current OS-level push permission, mapped to the DOM `NotificationPermission` shape. */
export async function checkNativePermission(): Promise<NotificationPermission> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const { receive } = await PushNotifications.checkPermissions();
  return toDomPermission(receive);
}

/**
 * Request permission (if needed), call `register()`, and resolve with the FCM
 * token once the `registration` event fires. Resolves `null` if the user
 * denies permission; rejects on a registration error.
 */
export async function registerForFcmToken(): Promise<string | null> {
  const { PushNotifications } = await import("@capacitor/push-notifications");

  const current = await PushNotifications.checkPermissions();
  const status =
    current.receive === "prompt" || current.receive === "prompt-with-rationale"
      ? (await PushNotifications.requestPermissions()).receive
      : current.receive;
  if (status !== "granted") return null;

  return await new Promise<string>((resolve, reject) => {
    let done = false;
    void PushNotifications.addListener("registration", (token) => {
      if (done) return;
      done = true;
      cachedToken = token.value;
      resolve(token.value);
    });
    void PushNotifications.addListener("registrationError", (err) => {
      if (done) return;
      done = true;
      reject(new Error(err.error ?? "Push registration failed."));
    });
    void PushNotifications.register().catch((err: unknown) => {
      if (done) return;
      done = true;
      reject(err instanceof Error ? err : new Error("Push registration failed."));
    });
  });
}

/** Tear down the device token (deletes the FCM token on Android / unregisters APNs on iOS). */
export async function unregisterFcm(): Promise<void> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.unregister();
  cachedToken = null;
}

/**
 * Register the notification-tap handler once (idempotent, native-only). A tap
 * routes in-app to the payload's `data.url` — which must be path-relative so we
 * stay inside the SPA rather than jumping to the origin (see
 * server deepLinkRedirect / payload construction).
 */
export async function initNativePushTapHandler(navigate: (path: string) => void): Promise<void> {
  if (tapHandlerReady || !isNative()) return;
  tapHandlerReady = true;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  void PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const url = action.notification.data?.url;
    if (typeof url === "string" && url.startsWith("/")) navigate(url);
  });
}

function toDomPermission(p: NativePermission | "prompt-with-rationale"): NotificationPermission {
  if (p === "granted") return "granted";
  if (p === "denied") return "denied";
  return "default";
}
