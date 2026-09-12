"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellIcon, BellRingIcon } from "lucide-react";
import { toast } from "sonner";

import { LoginLink } from "#/components/login-link.tsx";
import { Button } from "#/components/ui/button.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { cn } from "#/lib/utils.ts";

/**
 * "Watch filings" entry point for a ride / restaurant / shop page (public-records
 * plan §6.3). Creates an entity-scoped filing watch on the spot — no form: the
 * entity IS the scope, every kind, both channels. A second click on a page the
 * user already watches removes the watch, so the button is a toggle. Signed-out
 * users get the login link instead of a dead button.
 */
export function WatchFilingsButton({
  entityKind,
  entityId,
  entityName,
  size = "sm",
  className,
}: {
  entityKind: "attraction" | "facility" | "shop";
  entityId: string;
  entityName: string;
  size?: "sm" | "default";
  className?: string;
}) {
  const { data: session, isPending } = authClient.useSession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const watchesQ = useQuery({
    ...trpc.filingWatches.list.queryOptions(),
    enabled: !!session?.user,
  });
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: trpc.filingWatches.list.queryKey() });

  const existing = watchesQ.data?.find(
    (w) => w.entityKind === entityKind && w.entityId === entityId,
  );

  const create = useMutation(
    trpc.filingWatches.create.mutationOptions({
      onSuccess: (res) => {
        invalidate();
        toast.success(
          res.existed
            ? `Already watching filings for ${entityName}.`
            : `Watching filings for ${entityName} — we'll tell you what gets filed next.`,
        );
      },
      onError: (err) => toast.error(err.message || "Could not create the watch"),
    }),
  );
  const remove = useMutation(
    trpc.filingWatches.remove.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast.success("Filing watch removed");
      },
      onError: (err) => toast.error(err.message || "Could not remove the watch"),
    }),
  );

  if (isPending) return null;
  if (!session?.user) {
    return (
      <Button
        variant="outline"
        size={size}
        className={cn("gap-1.5", className)}
        render={<LoginLink />}
      >
        <BellIcon className="size-3.5" />
        Watch filings
      </Button>
    );
  }

  const busy = create.isPending || remove.isPending || watchesQ.isLoading;
  return (
    <Button
      variant={existing ? "secondary" : "outline"}
      size={size}
      className={cn("gap-1.5", className)}
      disabled={busy}
      aria-pressed={!!existing}
      onClick={() =>
        existing
          ? remove.mutate({ id: existing.id })
          : create.mutate({ entity: { kind: entityKind, id: entityId }, channel: "both" })
      }
    >
      {existing ? <BellRingIcon className="size-3.5" /> : <BellIcon className="size-3.5" />}
      {existing ? "Watching filings" : "Watch filings"}
    </Button>
  );
}
