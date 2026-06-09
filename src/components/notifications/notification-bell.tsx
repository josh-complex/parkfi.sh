import { Bell, BellOff } from "lucide-react";

import { Button } from "#/components/ui/button";
import { usePushNotifications } from "#/hooks/use-push-notifications.ts";

interface NotificationBellProps {
  attractionId?: string;
}

export function NotificationBell({ attractionId: _attractionId }: NotificationBellProps) {
  const { supported, subscribed, subscribe, unsubscribe, pending } = usePushNotifications();

  if (!supported) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={() => void (subscribed ? unsubscribe() : subscribe())}
      disabled={pending}
      title={subscribed ? "Disable notifications" : "Enable notifications"}
    >
      {subscribed ? <Bell className="h-4 w-4 fill-current" /> : <BellOff className="h-4 w-4" />}
    </Button>
  );
}
