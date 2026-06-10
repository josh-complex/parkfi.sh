"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "#/components/ui/popover.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

/** The search dims an alert watches — same shape the stays search sends. */
export interface StayAlertDims {
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  childAges: Array<number>;
  accessible: boolean;
  floridaResident: boolean;
}

const BECOMES_AVAILABLE = 1;
const PRICE_BELOW = 2;
const DEFAULT_PRICE = 400;

/**
 * "Alert me" bell for one resort + the current search dates/party. Logged-out
 * users get a sign-in prompt; logged-in users pick a rule (any room opens, or
 * price drops below a target) and `create` upserts it (so it edits in place).
 */
export function StayAlertButton({
  resortId,
  resortName,
  dims,
  loggedIn,
}: {
  resortId: string;
  resortName: string;
  dims: StayAlertDims;
  loggedIn: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<number>(BECOMES_AVAILABLE);
  const [price, setPrice] = React.useState<number>(DEFAULT_PRICE);

  const save = useMutation(
    trpc.stayAlerts.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.stayAlerts.list.queryKey() });
        setOpen(false);
        toast.success(`We'll email you about ${resortName}`);
      },
      onError: (err) => toast.error(err.message || "Could not save alert"),
    }),
  );

  function submit() {
    if (mode === PRICE_BELOW && (!Number.isFinite(price) || price <= 0)) {
      toast.error("Enter a price greater than zero");
      return;
    }
    save.mutate({
      ...dims,
      resortId,
      mode: mode === PRICE_BELOW ? PRICE_BELOW : BECOMES_AVAILABLE,
      ...(mode === PRICE_BELOW ? { priceBelow: price } : {}),
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="secondary"
            size="icon"
            className="bg-background/85 size-7 shadow-sm backdrop-blur-sm"
            aria-label={`Alert me about ${resortName}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        }
      >
        <BellIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {!loggedIn ? (
          <div className="space-y-3">
            <PopoverHeader>
              <PopoverTitle>Get a heads-up</PopoverTitle>
              <PopoverDescription>
                Sign in and we'll email you when {resortName} opens up for your dates.
              </PopoverDescription>
            </PopoverHeader>
            <Button size="sm" className="w-full" render={<Link to="/login" />}>
              Sign in
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <PopoverHeader>
              <PopoverTitle>{resortName}</PopoverTitle>
              <PopoverDescription>Email me when…</PopoverDescription>
            </PopoverHeader>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === BECOMES_AVAILABLE ? "default" : "outline"}
                onClick={() => setMode(BECOMES_AVAILABLE)}
              >
                A room opens
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === PRICE_BELOW ? "default" : "outline"}
                onClick={() => setMode(PRICE_BELOW)}
              >
                Price drops
              </Button>
            </div>

            {mode === PRICE_BELOW ? (
              <div className="space-y-1.5">
                <Label htmlFor="stay-alert-price">Notify under</Label>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm">$</span>
                  <Input
                    id="stay-alert-price"
                    type="number"
                    min={1}
                    max={100000}
                    inputMode="numeric"
                    value={Number.isFinite(price) ? price : ""}
                    onChange={(e) => setPrice(e.target.valueAsNumber)}
                    className="w-28"
                  />
                  <span className="text-muted-foreground text-sm">/ night</span>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                We'll email you the moment a room opens for your dates.
              </p>
            )}

            <Button size="sm" className="w-full" disabled={save.isPending} onClick={submit}>
              {save.isPending ? "Saving…" : "Set alert"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
