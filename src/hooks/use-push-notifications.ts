"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import posthog from "posthog-js";

import { useTRPC } from "#/integrations/trpc/react";
import { authClient } from "#/lib/auth-client.ts";
import { reportError } from "#/lib/report-error.ts";
import { isNative } from "#/lib/platform.ts";
import {
  checkNativePermission,
  getCachedFcmToken,
  initNativePushTapHandler,
  nativePushPlatform,
  registerForFcmToken,
  unregisterFcm,
} from "#/lib/native-push-client.ts";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  // eslint-disable-next-line no-restricted-syntax
  return Uint8Array.from(Array.from(rawData).map((c) => c.charCodeAt(0)));
}

/**
 * Shared push-notification state + subscribe/unsubscribe flow.
 *
 * Two backends behind one API:
 *  - **Web**: the browser service worker + VAPID push handshake.
 *  - **Native shell (Capacitor)**: `@capacitor/push-notifications` → an FCM
 *    device token (iOS APNs routed through FCM). `supported` is true on native
 *    regardless of `VAPID_PUBLIC_KEY` — the plugin, not the SW, does the work.
 *
 * Centralizes support detection, the current permission, whether an active
 * subscription/registration exists, and the subscribe handshake so the
 * notification bell and the one-shot enable prompt stay in sync on both.
 */
export function usePushNotifications() {
  const trpc = useTRPC();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const native = isNative();
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [existing, setExisting] = useState<PushSubscription | null>(null);
  // Native: the FCM token once registered (parallels `existing` on web). Used to
  // re-bind on login and to unsubscribe.
  const [nativeToken, setNativeToken] = useState<string | null>(null);

  useEffect(() => {
    if (native) {
      setSupported(true);
      void initNativePushTapHandler((path) => void router.navigate({ to: path }));
      void checkNativePermission().then((p) => {
        setPermission(p);
        // Permission already granted from a prior session — silently re-register
        // to recover the token (it can rotate) and mark subscribed. The bind
        // effect below then re-associates it with the signed-in account.
        if (p === "granted") {
          void registerForFcmToken()
            .then((token) => {
              if (token) {
                setNativeToken(token);
                setSubscribed(true);
              }
            })
            .catch(() => {
              /* registration hiccup — user can retry via the bell */
            });
        }
      });
      return;
    }

    const ok =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window &&
      !!VAPID_PUBLIC_KEY;
    setSupported(ok);
    if (!ok) return;

    setPermission(Notification.permission);
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setSubscribed(!!sub);
        setExisting(sub);
      })
      .catch(() => {
        /* no active registration yet */
      });
  }, [native, router]);

  const subscribeM = useMutation(
    trpc.notifications.subscribe.mutationOptions({
      onSuccess: () => {
        setSubscribed(true);
        toast.success("Push notifications enabled");
      },
      onError: (error) => {
        toast.error("Failed to enable notifications");
        // The toast is the user surface; also count the failure. Degraded, not
        // critical — push is an opt-in extra, the app keeps working without it.
        reportError(error, { source: "device", severity: "degraded", toast: false });
      },
    }),
  );

  const unsubscribeM = useMutation(
    trpc.notifications.unsubscribe.mutationOptions({
      onSuccess: () => {
        setSubscribed(false);
        toast.success("Push notifications disabled");
      },
    }),
  );

  // Re-bind an already-registered subscription/token to the signed-in account.
  // A subscription created before login is stored server-side under "anonymous",
  // and the device keeps it across login — so without this the account never gets
  // associated with the device and its ride-alert pushes go to nobody. The server
  // upserts by endpoint/token, so this is idempotent.
  const bindSub = useMutation(trpc.notifications.subscribe.mutationOptions()).mutate;
  useEffect(() => {
    if (!userId) return;
    if (native) {
      const token = nativeToken ?? getCachedFcmToken();
      if (token) bindSub({ kind: "fcm", token, platform: nativePushPlatform() });
      return;
    }
    if (!existing) return;
    const json = existing.toJSON();
    bindSub({
      endpoint: existing.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    });
  }, [userId, existing, nativeToken, native, bindSub]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;

    if (native) {
      const token = await registerForFcmToken();
      if (!token) {
        setPermission("denied");
        toast.error("Notification permission denied");
        posthog.capture("notification_permission_denied", { permission: "denied" });
        return false;
      }
      setPermission("granted");
      setNativeToken(token);
      subscribeM.mutate({ kind: "fcm", token, platform: nativePushPlatform() });
      return true;
    }

    // Request permission FIRST, synchronously within the click handler. Safari
    // (iOS in particular) discards the permission prompt if anything is awaited
    // before the request, since the user-gesture activation is already spent —
    // so awaiting serviceWorker.ready beforehand silently no-ops the prompt.
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") {
      toast.error("Notification permission denied");
      // Expected user choice — a named event, not an exception.
      posthog.capture("notification_permission_denied", { permission: result });
      return false;
    }

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!).buffer as ArrayBuffer,
    });
    setExisting(sub);
    const json = sub.toJSON();
    subscribeM.mutate({
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    });
    return true;
  }, [supported, native, subscribeM]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!supported) return;

    if (native) {
      const token = nativeToken ?? getCachedFcmToken();
      await unregisterFcm();
      if (token) unsubscribeM.mutate({ kind: "fcm", token });
      setSubscribed(false);
      setNativeToken(null);
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    const existingSub = await reg.pushManager.getSubscription();
    if (existingSub) {
      await existingSub.unsubscribe();
      unsubscribeM.mutate({ endpoint: existingSub.endpoint });
    }
    setSubscribed(false);
    setExisting(null);
  }, [supported, native, nativeToken, unsubscribeM]);

  return {
    supported,
    permission,
    subscribed,
    subscribe,
    unsubscribe,
    pending: subscribeM.isPending || unsubscribeM.isPending,
  };
}
