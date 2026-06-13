import { createFileRoute } from "@tanstack/react-router";
import { LaptopIcon, LogOutIcon, MonitorIcon, SmartphoneIcon } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "#/lib/auth-client.ts";
import { sessionsQueryOptions } from "#/lib/auth-queries.ts";
import { seo } from "#/lib/seo.ts";
import { ConfirmButton } from "#/components/account/confirm-button.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { toast } from "sonner";

export const Route = createFileRoute("/_dash/account/sessions")({
  component: SessionsPage,
  head: () =>
    seo({
      title: "Sessions — Account Settings — ParkFi",
      path: "/account/sessions",
      noindex: true,
    }),
});

function parseUserAgent(ua: string | null | undefined) {
  if (!ua) return { browser: "Unknown", os: "Unknown", icon: MonitorIcon };
  const lower = ua.toLowerCase();
  let browser = "Browser";
  let os = "Unknown";
  let icon: typeof MonitorIcon = MonitorIcon;

  if (lower.includes("iphone") || lower.includes("ipad")) {
    os = lower.includes("ipad") ? "iPad" : "iPhone";
    icon = SmartphoneIcon;
  } else if (lower.includes("android")) {
    os = "Android";
    icon = SmartphoneIcon;
  } else if (lower.includes("mac")) {
    os = "macOS";
    icon = LaptopIcon;
  } else if (lower.includes("windows")) {
    os = "Windows";
  } else if (lower.includes("linux")) {
    os = "Linux";
  }

  if (lower.includes("chrome") && !lower.includes("edg") && !lower.includes("opr"))
    browser = "Chrome";
  else if (lower.includes("safari") && !lower.includes("chrome")) browser = "Safari";
  else if (lower.includes("firefox")) browser = "Firefox";
  else if (lower.includes("edg")) browser = "Edge";
  else if (lower.includes("opr") || lower.includes("opera")) browser = "Opera";

  return { browser, os, icon };
}

function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type SessionItem = {
  id: string;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  userId: string;
};

function SessionsSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-8 rounded-xl shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="size-7 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

function SessionsPage() {
  const { data: session } = authClient.useSession();
  const currentToken = session?.session.token ?? "";

  const queryClient = useQueryClient();
  const opts = sessionsQueryOptions();
  const { data: sessions = [], isLoading } = useQuery(opts);

  const others = (sessions as SessionItem[]).filter((s) => s.token !== currentToken);

  const handleRevoke = async (token: string) => {
    const { error } = await authClient.revokeSession({ token });
    if (error) toast.error(error.message ?? "Failed to revoke session");
    else {
      toast.success("Session revoked");
      queryClient.setQueryData(
        opts.queryKey,
        (sessions as SessionItem[]).filter((s) => s.token !== token),
      );
    }
  };

  const handleRevokeAll = async () => {
    const { error } = await authClient.revokeOtherSessions();
    if (error) toast.error(error.message ?? "Failed to revoke sessions");
    else {
      toast.success("All other sessions revoked");
      queryClient.setQueryData(
        opts.queryKey,
        (sessions as SessionItem[]).filter((s) => s.token === currentToken),
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices and browsers currently signed in to your account</CardDescription>
        {!isLoading && others.length > 0 && (
          <CardAction>
            <ConfirmButton
              label="Revoke all others"
              confirmLabel="Yes, revoke"
              icon={<LogOutIcon />}
              variant="outline"
              onConfirm={() => void handleRevokeAll()}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SessionsSkeleton />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions found.</p>
        ) : (
          <ul className="space-y-1">
            {(sessions as SessionItem[]).map((s) => {
              const isCurrent = s.token === currentToken;
              const { browser, os, icon: DeviceIcon } = parseUserAgent(s.userAgent);
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-2xl bg-muted/50 px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-xl bg-background border flex items-center justify-center shrink-0">
                      <DeviceIcon className="size-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium">
                          {browser} on {os}
                        </p>
                        {isCurrent && (
                          <Badge variant="secondary" className="text-xs h-4 px-1.5">
                            This device
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {s.ipAddress ? `${s.ipAddress} · ` : ""}
                        Signed in {formatDate(s.createdAt)} · Expires {formatDate(s.expiresAt)}
                      </p>
                    </div>
                  </div>
                  {!isCurrent && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => void handleRevoke(s.token)}
                    >
                      <LogOutIcon className="size-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
