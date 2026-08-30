"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { LoginLink } from "#/components/login-link.tsx";
import { PinImage } from "#/components/pins/pin-card.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

import type { inferRouterOutputs } from "@trpc/server";
import type { TRPCRouter } from "#/integrations/trpc/router.ts";

type Outputs = inferRouterOutputs<TRPCRouter>;
type Match = Outputs["pinTrade"]["matches"][number];
type Offer = Outputs["pinTrade"]["myOffers"][number];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "secondary",
  accepted: "default",
  declined: "destructive",
  cancelled: "outline",
  expired: "outline",
};

export function PinTradeBoard() {
  const { data: session, isPending } = authClient.useSession();
  const trpc = useTRPC();

  const matchesQ = useQuery({
    ...trpc.pinTrade.matches.queryOptions(),
    enabled: !!session?.user,
  });
  const offersQ = useQuery({
    ...trpc.pinTrade.myOffers.queryOptions(),
    enabled: !!session?.user,
  });

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <Empty>
        <EmptyTitle>Sign in to trade pins</EmptyTitle>
        <EmptyDescription>
          We match your for-trade pins against other collectors' wishlists.
        </EmptyDescription>
        <Button className="mt-4" render={<LoginLink />}>
          Sign in
        </Button>
      </Empty>
    );
  }

  const matches = matchesQ.data ?? [];
  const offers = offersQ.data ?? [];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Matches</h2>
        {matchesQ.isLoading ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : matches.length === 0 ? (
          <Empty>
            <EmptyTitle>No matches yet</EmptyTitle>
            <EmptyDescription>
              Mark pins for trade and add to your wishlist to find trade partners.
            </EmptyDescription>
            <Button className="mt-4" render={<Link to="/pins/collection" />}>
              Edit collection
            </Button>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {matches.map((m) => (
              <MatchCard key={m.partnerId} match={m} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your offers</h2>
        {offersQ.isLoading ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : offers.length === 0 ? (
          <p className="text-muted-foreground text-sm">No offers yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {offers.map((o) => (
              <OfferRow key={o.id} offer={o} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PinChip({ pin }: { pin: { name: string; imageUrl: string | null } }) {
  return (
    <span className="bg-muted/60 flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-xs">
      <PinImage src={pin.imageUrl} alt="" className="size-5 shrink-0 rounded-full bg-muted" />
      <span className="max-w-32 truncate">{pin.name}</span>
    </span>
  );
}

function MatchCard({ match }: { match: Match }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const createOffer = useMutation(
    trpc.pinTrade.createOffer.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.pinTrade.myOffers.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.pinTrade.matches.queryKey() });
        setOpen(false);
        setMessage("");
        toast.success("Offer sent");
      },
      onError: (err) => toast.error(err.message || "Could not send offer"),
    }),
  );

  function propose() {
    createOffer.mutate({
      toUserId: match.partnerId,
      offeringPins: match.youOffer.map((p) => ({ pinId: p.pinId, quantity: 1 })),
      requestingPins: match.theyOffer.map((p) => ({ pinId: p.pinId, quantity: 1 })),
      ...(message.trim() ? { message: message.trim() } : {}),
    });
  }

  const name = match.partnerName ?? "Collector";

  return (
    <li className="space-y-3 rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <Avatar size="sm">
          {match.partnerImage ? <AvatarImage src={match.partnerImage} alt="" /> : null}
          <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="font-medium">{name}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PinColumn label="They'll trade you" pins={match.theyOffer} />
        <PinColumn label="You can offer" pins={match.youOffer} />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button size="sm" />}>Propose trade</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Propose a trade with {name}</DialogTitle>
            <DialogDescription>
              You'll offer {match.youOffer.length} pin{match.youOffer.length === 1 ? "" : "s"} for{" "}
              {match.theyOffer.length} of theirs.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <PinColumn label="You give" pins={match.youOffer} />
            <PinColumn label="You get" pins={match.theyOffer} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trade-message">Message (optional)</Label>
            <Textarea
              id="trade-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a note for the trade…"
            />
          </div>

          <DialogFooter showCloseButton>
            <Button disabled={createOffer.isPending} onClick={propose}>
              {createOffer.isPending ? "Sending…" : "Send offer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function PinColumn({
  label,
  pins,
}: {
  label: string;
  pins: Array<{ pinId: string; name: string; imageUrl: string | null }>;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {pins.length === 0 ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : (
          pins.map((p) => <PinChip key={p.pinId} pin={p} />)
        )}
      </div>
    </div>
  );
}

function OfferRow({ offer }: { offer: Offer }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const respond = useMutation(
    trpc.pinTrade.respondOffer.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.pinTrade.myOffers.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.pinTrade.matches.queryKey() });
        toast.success("Updated");
      },
      onError: (err) => toast.error(err.message || "Could not update offer"),
    }),
  );

  const pending = offer.status === "pending";
  const received = offer.direction === "received";
  const name = offer.counterpartyName ?? "Collector";

  return (
    <li className="space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{received ? `From ${name}` : `To ${name}`}</span>
        <Badge variant={STATUS_VARIANT[offer.status] ?? "secondary"}>{offer.status}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PinColumn label={received ? "They give" : "You give"} pins={offer.offeringPins} />
        <PinColumn label={received ? "They want" : "You request"} pins={offer.requestingPins} />
      </div>

      {offer.message ? <p className="text-muted-foreground text-sm">“{offer.message}”</p> : null}

      {pending ? (
        <div className="flex gap-2">
          {received ? (
            <>
              <Button
                size="sm"
                disabled={respond.isPending}
                onClick={() => respond.mutate({ id: offer.id, action: "accept" })}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={respond.isPending}
                onClick={() => respond.mutate({ id: offer.id, action: "decline" })}
              >
                Decline
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ id: offer.id, action: "cancel" })}
            >
              Cancel
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}
