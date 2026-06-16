"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTRPC } from "#/integrations/trpc/react";
import { authClient } from "#/lib/auth-client.ts";

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
 * Centralizes browser-support detection, the current permission, whether an
 * active push subscription exists, and the VAPID subscribe handshake so the
 * notification bell and the one-shot enable prompt stay in sync.
 */
export function usePushNotifications() {
  const trpc = useTRPC();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [existing, setExisting] = useState<PushSubscription | null>(null);

  useEffect(() => {
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
  }, []);

  const subscribeM = useMutation(
    trpc.notifications.subscribe.mutationOptions({
      onSuccess: () => {
        setSubscribed(true);
        toast.success("Push notifications enabled");
      },
      onError: () => toast.error("Failed to enable notifications"),
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

  // Re-bind an already-registered browser subscription to the signed-in account.
  // A subscription created before login is stored server-side under "anonymous",
  // and the browser keeps that subscription across login — so without this the
  // account never gets associated with the device and its ride-alert pushes are
  // delivered to nobody. The server upserts by endpoint, so this is idempotent.
  const bindSub = useMutation(trpc.notifications.subscribe.mutationOptions()).mutate;
  useEffect(() => {
    if (!userId || !existing) return;
    const json = existing.toJSON();
    bindSub({
      endpoint: existing.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    });
  }, [userId, existing, bindSub]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;

    // Request permission FIRST, synchronously within the click handler. Safari
    // (iOS in particular) discards the permission prompt if anything is awaited
    // before the request, since the user-gesture activation is already spent —
    // so awaiting serviceWorker.ready beforehand silently no-ops the prompt.
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") {
      toast.error("Notification permission denied");
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
  }, [supported, subscribeM]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!supported) return;
    const reg = await navigator.serviceWorker.ready;
    const existingSub = await reg.pushManager.getSubscription();
    if (existingSub) {
      await existingSub.unsubscribe();
      unsubscribeM.mutate({ endpoint: existingSub.endpoint });
    }
    setSubscribed(false);
    setExisting(null);
  }, [supported, unsubscribeM]);

  return {
    supported,
    permission,
    subscribed,
    subscribe,
    unsubscribe,
    pending: subscribeM.isPending || unsubscribeM.isPending,
  };
}
