"use client";

import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { LoginLink } from "#/components/login-link.tsx";
import { PinImage } from "#/components/pins/pin-card.tsx";
import { CONDITION_LABEL, formatCents } from "#/components/pins/format.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

import type { inferRouterOutputs } from "@trpc/server";
import type { TRPCRouter } from "#/integrations/trpc/router.ts";

type Collection = inferRouterOutputs<TRPCRouter>["pinCollection"]["list"];
type HaveItem = Collection["have"][number];
type WantItem = Collection["want"][number];

export function PinCollectionManager() {
  const { data: session, isPending } = authClient.useSession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const listQ = useQuery({
    ...trpc.pinCollection.list.queryOptions(),
    enabled: !!session?.user,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.pinCollection.list.queryKey() });

  const toggleForTrade = useMutation(
    trpc.pinCollection.toggleForTrade.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (err) => toast.error(err.message || "Could not update"),
    }),
  );

  const remove = useMutation(
    trpc.pinCollection.remove.mutationOptions({
      onSuccess: () => {
        void invalidate();
        toast.success("Removed");
      },
      onError: (err) => toast.error(err.message || "Could not remove"),
    }),
  );

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <Empty>
        <EmptyTitle>Sign in to track your pins</EmptyTitle>
        <EmptyDescription>
          Your collection and wishlist are tied to your account so we can match you with traders.
        </EmptyDescription>
        <Button className="mt-4" render={<LoginLink />}>
          Sign in
        </Button>
      </Empty>
    );
  }

  const have = listQ.data?.have ?? [];
  const want = listQ.data?.want ?? [];

  return (
    <Tabs defaultValue="have" className="w-full">
      <TabsList>
        <TabsTrigger value="have">Have ({have.length})</TabsTrigger>
        <TabsTrigger value="want">Want ({want.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="have" className="pt-4">
        {listQ.isLoading ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : have.length === 0 ? (
          <Empty>
            <EmptyTitle>No pins yet</EmptyTitle>
            <EmptyDescription>Scan a pin or add one from the catalog.</EmptyDescription>
            <Button className="mt-4" render={<Link to="/pins/scan" />}>
              Scan a pin
            </Button>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {have.map((item) => (
              <HaveRow
                key={item.id}
                item={item}
                onToggle={(forTrade) => toggleForTrade.mutate({ pinId: item.pinId, forTrade })}
                onRemove={() => remove.mutate({ pinId: item.pinId, list: "have" })}
                removing={remove.isPending}
              />
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="want" className="pt-4">
        {listQ.isLoading ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : want.length === 0 ? (
          <Empty>
            <EmptyTitle>No wishlist pins</EmptyTitle>
            <EmptyDescription>Add pins you're hunting for from the catalog.</EmptyDescription>
            <Button className="mt-4" render={<Link to="/pins" />}>
              Browse catalog
            </Button>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {want.map((item) => (
              <WantRow
                key={item.id}
                item={item}
                onRemove={() => remove.mutate({ pinId: item.pinId, list: "want" })}
                removing={remove.isPending}
              />
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
}

function HaveRow({
  item,
  onToggle,
  onRemove,
  removing,
}: {
  item: HaveItem;
  onToggle: (forTrade: boolean) => void;
  onRemove: () => void;
  removing: boolean;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border p-3">
      <Link
        to="/pins/$pinId"
        params={{ pinId: item.pinId }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <PinImage
          src={item.imageUrl}
          alt={item.name}
          className="size-12 shrink-0 rounded-lg bg-muted"
        />
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{item.name}</span>
            {item.quantity > 1 ? (
              <Badge variant="secondary" className="shrink-0">
                ×{item.quantity}
              </Badge>
            ) : null}
            {item.condition ? (
              <Badge variant="outline" className="shrink-0">
                {CONDITION_LABEL[item.condition] ?? item.condition}
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs tabular-nums">
            {formatCents(item.estValueCents)}
          </p>
        </div>
      </Link>
      <label className="flex shrink-0 items-center gap-2 text-xs">
        <span className="text-muted-foreground hidden sm:inline">For trade</span>
        <Switch
          checked={item.forTrade}
          onCheckedChange={(v) => onToggle(v)}
          aria-label="Available for trade"
        />
      </label>
      <Button variant="outline" size="sm" disabled={removing} onClick={onRemove}>
        Remove
      </Button>
    </li>
  );
}

function WantRow({
  item,
  onRemove,
  removing,
}: {
  item: WantItem;
  onRemove: () => void;
  removing: boolean;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border p-3">
      <Link
        to="/pins/$pinId"
        params={{ pinId: item.pinId }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <PinImage
          src={item.imageUrl}
          alt={item.name}
          className="size-12 shrink-0 rounded-lg bg-muted"
        />
        <div className="min-w-0 space-y-0.5">
          <span className="block truncate text-sm font-medium">{item.name}</span>
          <p className="text-muted-foreground text-xs tabular-nums">
            {item.maxValueCents != null
              ? `Up to ${formatCents(item.maxValueCents)}`
              : formatCents(item.estValueCents)}
          </p>
        </div>
      </Link>
      <Button variant="outline" size="sm" disabled={removing} onClick={onRemove}>
        Remove
      </Button>
    </li>
  );
}
