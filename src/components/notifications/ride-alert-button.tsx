"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellIcon, BellRingIcon } from "lucide-react";
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
import { useAchievementTrack } from "#/hooks/use-achievement-track.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

/** The current user's active alert for one ride (subset of `rideAlerts.list`). */
export interface RideAlertEntry {
  id: number;
  mode: number;
  thresholdMin: number | null;
  changeDelta: number | null;
}

const THRESHOLD = 1;
const CHANGE = 2;
const LL_AVAILABLE = 3;
const DEFAULT_THRESHOLD = 20;
const DEFAULT_DELTA = 15;

/**
 * A bell toggle for tracking a single ride's wait time. Logged-out users see a
 * sign-in prompt; logged-in users get a small form to pick the rule (drop below
 * a target, or change by an amount) — `create` upserts, so it edits in place.
 */
export function RideAlertButton({
  attractionId,
  attractionName,
  alert,
  loggedIn,
}: {
  attractionId: number;
  attractionName: string;
  alert?: RideAlertEntry;
  loggedIn: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const track = useAchievementTrack();
  const [open, setOpen] = React.useState(false);
  const tracked = !!alert;

  const [mode, setMode] = React.useState<number>(alert?.mode ?? THRESHOLD);
  const [value, setValue] = React.useState<number>(
    alert?.thresholdMin ?? alert?.changeDelta ?? DEFAULT_THRESHOLD,
  );

  // Re-sync the form to the saved alert whenever the popover opens.
  React.useEffect(() => {
    if (!open) return;
    setMode(alert?.mode ?? THRESHOLD);
    setValue(alert?.thresholdMin ?? alert?.changeDelta ?? DEFAULT_THRESHOLD);
  }, [open, alert]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.rideAlerts.list.queryKey() });

  const save = useMutation(
    trpc.rideAlerts.create.mutationOptions({
      onSuccess: () => {
        void invalidate();
        setOpen(false);
        toast.success(`Tracking ${attractionName}`);
        if (!tracked) track("alert_created");
      },
      onError: (err) => toast.error(err.message || "Could not save alert"),
    }),
  );

  const remove = useMutation(
    trpc.rideAlerts.remove.mutationOptions({
      onSuccess: () => {
        void invalidate();
        setOpen(false);
        toast.success(`Stopped tracking ${attractionName}`);
      },
      onError: (err) => toast.error(err.message || "Could not remove alert"),
    }),
  );

  const pending = save.isPending || remove.isPending;

  function pickMode(next: number) {
    setMode(next);
    // Carry a sensible default when switching rule types.
    if (next !== LL_AVAILABLE) setValue(next === THRESHOLD ? DEFAULT_THRESHOLD : DEFAULT_DELTA);
  }

  function submit() {
    if (mode !== LL_AVAILABLE && (!Number.isFinite(value) || value <= 0)) {
      toast.error("Enter a number greater than zero");
      return;
    }
    save.mutate({
      attractionId,
      mode: mode === CHANGE ? CHANGE : mode === LL_AVAILABLE ? LL_AVAILABLE : THRESHOLD,
      ...(mode === THRESHOLD
        ? { thresholdMin: value }
        : mode === CHANGE
          ? { changeDelta: value }
          : {}),
    });
  }

  const Icon = tracked ? BellRingIcon : BellIcon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={tracked ? `Edit alert for ${attractionName}` : `Track ${attractionName}`}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <Icon className={cn("size-4", tracked && "fill-current text-primary")} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72" onClick={(e) => e.stopPropagation()}>
        {!loggedIn ? (
          <div className="space-y-3">
            <PopoverHeader>
              <PopoverTitle>Track this ride</PopoverTitle>
              <PopoverDescription>
                Sign in to get a push notification when {attractionName}’s wait changes.
              </PopoverDescription>
            </PopoverHeader>
            <Button size="sm" className="w-full" render={<LoginLink />}>
              Sign in
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <PopoverHeader>
              <PopoverTitle>{attractionName}</PopoverTitle>
              <PopoverDescription>Notify me when…</PopoverDescription>
            </PopoverHeader>

            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === THRESHOLD ? "default" : "outline"}
                onClick={() => pickMode(THRESHOLD)}
              >
                Drops below
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === CHANGE ? "default" : "outline"}
                onClick={() => pickMode(CHANGE)}
              >
                Changes by
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === LL_AVAILABLE ? "default" : "outline"}
                onClick={() => pickMode(LL_AVAILABLE)}
              >
                Lightning Lane
              </Button>
            </div>

            {mode === LL_AVAILABLE ? (
              <p className="text-muted-foreground text-xs">
                Alerts the moment Lightning Lane opens up for this ride.
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="ride-alert-value">
                  {mode === THRESHOLD ? "Target standby wait" : "Change amount"}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ride-alert-value"
                    type="number"
                    min={1}
                    max={600}
                    inputMode="numeric"
                    value={Number.isFinite(value) ? value : ""}
                    onChange={(e) => setValue(e.target.valueAsNumber)}
                    className="w-24"
                  />
                  <span className="text-muted-foreground text-sm">minutes</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {mode === THRESHOLD
                    ? `Alerts once standby is ${Number.isFinite(value) ? value : "—"} min or less.`
                    : `Alerts when standby moves by ${Number.isFinite(value) ? value : "—"} min, or the ride opens/closes.`}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" className="flex-1" disabled={pending} onClick={submit}>
                {tracked ? "Update" : "Track"}
              </Button>
              {tracked ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => remove.mutate({ id: alert.id })}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
