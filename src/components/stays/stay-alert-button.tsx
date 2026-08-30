"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellIcon } from "lucide-react";
import { toast } from "sonner";

import { LoginLink } from "#/components/login-link.tsx";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { useAchievementTrack } from "#/hooks/use-achievement-track.ts";
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

const TIER_LABEL: Record<string, string> = {
  value: "Value resorts",
  moderate: "Moderate resorts",
  deluxe: "Deluxe resorts",
  villa: "DVC villas",
  campground: "Campgrounds",
};

type ScopeChoice = "resort" | "tier" | "area" | "any";

/**
 * "Alert me" bell for one resort + the current search dates/party. Logged-out
 * users get a sign-in prompt; logged-in users pick a scope (this resort, its
 * tier, its area, or any resort), a rule (a room opens, or price drops), and an
 * optional price ceiling on the "room opens" rule. `create` upserts in place.
 */
export function StayAlertButton({
  resortId,
  resortName,
  tier,
  area,
  dims,
  loggedIn,
}: {
  resortId: string;
  resortName: string;
  tier?: string;
  area?: string | null;
  dims: StayAlertDims;
  loggedIn: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const track = useAchievementTrack();
  const [open, setOpen] = React.useState(false);
  const [scope, setScope] = React.useState<ScopeChoice>("resort");
  const [mode, setMode] = React.useState<number>(BECOMES_AVAILABLE);
  const [capped, setCapped] = React.useState(false);
  const [price, setPrice] = React.useState<number>(DEFAULT_PRICE);

  const save = useMutation(
    trpc.stayAlerts.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.stayAlerts.list.queryKey() });
        setOpen(false);
        toast.success("Alert saved — we'll email you");
        track("alert_created");
      },
      onError: (err) => toast.error(err.message || "Could not save alert"),
    }),
  );

  // mode 2 always needs a price; mode 1 needs one only when the ceiling is on.
  const wantsPrice = mode === PRICE_BELOW || (mode === BECOMES_AVAILABLE && capped);

  function submit() {
    if (wantsPrice && (!Number.isFinite(price) || price <= 0)) {
      toast.error("Enter a price greater than zero");
      return;
    }
    const scopeFields =
      scope === "resort"
        ? { resortId }
        : scope === "tier" && tier
          ? { tier: tier as "value" | "moderate" | "deluxe" | "villa" | "campground" }
          : scope === "area" && area
            ? { area }
            : {};
    save.mutate({
      ...dims,
      ...scopeFields,
      mode: mode === PRICE_BELOW ? PRICE_BELOW : BECOMES_AVAILABLE,
      ...(wantsPrice ? { priceBelow: price } : {}),
    });
  }

  const scopeItems: Record<string, string> = {
    resort: resortName,
    ...(tier ? { tier: TIER_LABEL[tier] ?? "Same tier" } : {}),
    ...(area ? { area } : {}),
    any: "Any resort",
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="secondary"
            size="icon"
            className="bg-background/85 size-9 shadow-sm backdrop-blur-sm md:size-7"
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
        collisionPadding={12}
        className="w-[min(18rem,calc(100vw-2rem))]"
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
            <Button size="sm" className="w-full" render={<LoginLink />}>
              Sign in
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <PopoverHeader>
              <PopoverTitle>{resortName}</PopoverTitle>
              <PopoverDescription>Email me when…</PopoverDescription>
            </PopoverHeader>

            <div className="space-y-1.5">
              <Label>Watch</Label>
              <Select
                value={scope}
                onValueChange={(v) => v && setScope(v as ScopeChoice)}
                items={scopeItems}
              >
                <SelectTrigger size="sm" className="w-full" aria-label="What to watch">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(scopeItems).map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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

            {mode === BECOMES_AVAILABLE && (
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>Only under a price</span>
                <Switch checked={capped} onCheckedChange={setCapped} />
              </label>
            )}

            {wantsPrice ? (
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
