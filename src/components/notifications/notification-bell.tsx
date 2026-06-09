import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTRPC } from "#/integrations/trpc/react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "#/components/ui/button";
import { toast } from "sonner";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  // eslint-disable-next-line no-restricted-syntax
  return Uint8Array.from(Array.from(rawData).map((c) => c.charCodeAt(0)));
}

interface NotificationBellProps {
  attractionId?: string;
}

export function NotificationBell({ attractionId: _attractionId }: NotificationBellProps) {
  const [subscribed, setSubscribed] = useState(false);
  const [supported, setSupported] = useState(false);
  const trpc = useTRPC();

  useEffect(() => {
    setSupported("serviceWorker" in navigator && "PushManager" in window && !!VAPID_PUBLIC_KEY);
  }, []);

  const subscribe = useMutation(
    trpc.notifications.subscribe.mutationOptions({
      onSuccess: () => {
        setSubscribed(true);
        toast.success("Push notifications enabled");
      },
      onError: () => toast.error("Failed to enable notifications"),
    }),
  );

  const unsubscribe = useMutation(
    trpc.notifications.unsubscribe.mutationOptions({
      onSuccess: () => {
        setSubscribed(false);
        toast.success("Push notifications disabled");
      },
    }),
  );

  if (!supported) return null;

  async function toggle() {
    const reg = await navigator.serviceWorker.ready;

    if (subscribed) {
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
        unsubscribe.mutate({ endpoint: existing.endpoint });
      } else {
        setSubscribed(false);
      }
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast.error("Notification permission denied");
      return;
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!).buffer as ArrayBuffer,
    });
    const json = sub.toJSON();
    subscribe.mutate({
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={() => void toggle()}
      disabled={subscribe.isPending || unsubscribe.isPending}
      title={subscribed ? "Disable notifications" : "Enable notifications"}
    >
      {subscribed ? <Bell className="h-4 w-4 fill-current" /> : <BellOff className="h-4 w-4" />}
    </Button>
  );
}
