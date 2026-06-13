import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "#/lib/auth-client.ts";
import { accountsQueryOptions } from "#/lib/auth-queries.ts";
import { seo } from "#/lib/seo.ts";
import { ConfirmButton } from "#/components/account/confirm-button.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { toast } from "sonner";

export const Route = createFileRoute("/_dash/account/connections")({
  component: ConnectionsPage,
  head: () =>
    seo({
      title: "Connections — Account Settings — ParkFi",
      path: "/account/connections",
      noindex: true,
    }),
});

const PROVIDERS = [
  { id: "google", label: "Google", abbrev: "G" },
  { id: "apple", label: "Apple", abbrev: "" },
  { id: "credential", label: "Email & Password", abbrev: "@" },
] as const;

function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type LinkedAccount = {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: Date;
};

function ConnectionsSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-7 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-7 w-16 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

function ConnectionsPage() {
  const queryClient = useQueryClient();
  const opts = accountsQueryOptions();
  const { data: accounts = [], isLoading } = useQuery(opts);
  const [linkingGoogle, setLinkingGoogle] = useState(false);

  const linkedProviders = new Set((accounts as LinkedAccount[]).map((a) => a.providerId));

  const handleUnlink = async (providerId: string) => {
    const { error } = await authClient.unlinkAccount({ providerId });
    if (error) {
      toast.error(error.message ?? "Failed to unlink account");
    } else {
      const label = PROVIDERS.find((p) => p.id === providerId)?.label ?? providerId;
      toast.success(`${label} unlinked`);
      await queryClient.invalidateQueries({ queryKey: opts.queryKey });
    }
  };

  const handleLinkGoogle = async () => {
    setLinkingGoogle(true);
    const { error } = await authClient.linkSocial({
      provider: "google",
      callbackURL: "/account/connections",
    });
    setLinkingGoogle(false);
    if (error) toast.error(error.message ?? "Failed to link Google");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected accounts</CardTitle>
        <CardDescription>Sign-in methods linked to your account</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ConnectionsSkeleton />
        ) : (
          <ul className="space-y-1">
            {PROVIDERS.map(({ id, label, abbrev }) => {
              const linked = linkedProviders.has(id);
              const acct = (accounts as LinkedAccount[]).find((a) => a.providerId === id);
              return (
                <li
                  key={id}
                  className="flex items-center justify-between rounded-2xl bg-muted/50 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="size-7 rounded-full bg-background border flex items-center justify-center text-xs font-bold shrink-0">
                      {abbrev}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">
                        {linked
                          ? (acct?.accountId ? `${acct.accountId} · ` : "") +
                            `Connected ${formatDate(acct?.createdAt)}`
                          : "Not connected"}
                      </p>
                    </div>
                  </div>
                  {linked ? (
                    <div className="flex items-center gap-2">
                      <CheckIcon className="size-4 text-green-500" />
                      {(accounts as LinkedAccount[]).length > 1 && id !== "credential" && (
                        <ConfirmButton
                          label="Unlink"
                          confirmLabel="Yes, unlink"
                          variant="outline"
                          onConfirm={() => handleUnlink(id)}
                        />
                      )}
                    </div>
                  ) : id === "google" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleLinkGoogle()}
                      disabled={linkingGoogle}
                    >
                      <ChevronRightIcon />
                      Connect
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
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
