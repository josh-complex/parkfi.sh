"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellIcon } from "lucide-react";
import { toast } from "sonner";

import { format } from "date-fns";

import { LoginLink } from "#/components/login-link.tsx";
import { Button } from "#/components/ui/button.tsx";
import { DatePicker } from "#/components/ui/date-picker.tsx";
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
import { useAchievementTrack } from "#/hooks/use-achievement-track.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";

const PARTY_OPTIONS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => {
    const n = i + 1;
    return [String(n), `${n} ${n === 1 ? "guest" : "guests"}`];
  }),
);
const WINDOW_OPTIONS: Record<string, string> = {
  "7": "Next week",
  "14": "Next 2 weeks",
  "30": "Next 30 days",
  "60": "Next 60 days",
  "90": "Next 90 days",
};

/**
 * "Alert me" bell for one restaurant. Logged-out users get a sign-in prompt;
 * logged-in users pick a party size and a date axis (any day in a rolling window,
 * or a specific service date) and `create` upserts the alert. Mirrors
 * `StayAlertButton`.
 */
export function DiningAlertButton({
  facilityId,
  restaurantName,
  defaultPartySize,
  loggedIn,
}: {
  facilityId: string;
  restaurantName: string;
  defaultPartySize: number;
  loggedIn: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const track = useAchievementTrack();
  const [open, setOpen] = React.useState(false);
  const [party, setParty] = React.useState(String(Math.min(Math.max(defaultPartySize, 1), 8)));
  const [mode, setMode] = React.useState<"window" | "date">("window");
  const [windowDays, setWindowDays] = React.useState("30");
  const [date, setDate] = React.useState<Date | undefined>(undefined);

  const save = useMutation(
    trpc.diningAlerts.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.diningAlerts.list.queryKey() });
        setOpen(false);
        toast.success(`We'll let you know about ${restaurantName}`);
        track("alert_created");
      },
      onError: (err) => toast.error(err.message || "Could not save alert"),
    }),
  );

  function submit() {
    if (mode === "date" && !date) {
      toast.error("Pick a date");
      return;
    }
    save.mutate({
      facilityId,
      partySize: Number(party),
      ...(mode === "date" && date
        ? { serviceDate: format(date, "yyyy-MM-dd") }
        : { windowDays: Number(windowDays) }),
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="secondary"
            size="icon"
            className="size-9 shrink-0 shadow-sm md:size-7"
            aria-label={`Alert me about ${restaurantName}`}
          />
        }
      >
        <BellIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="w-[min(18rem,calc(100vw-2rem))] gap-0"
      >
        {!loggedIn ? (
          <div className="space-y-3">
            <PopoverHeader>
              <PopoverTitle>Get a heads-up</PopoverTitle>
              <PopoverDescription>
                Sign in and we'll let you know when a table opens at {restaurantName}.
              </PopoverDescription>
            </PopoverHeader>
            <Button size="sm" className="w-full" render={<LoginLink />}>
              Sign in
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <PopoverHeader>
              <PopoverTitle>{restaurantName}</PopoverTitle>
              <PopoverDescription>Notify me when a table opens…</PopoverDescription>
            </PopoverHeader>

            <div className="space-y-1.5">
              <Label>Party size</Label>
              <Select value={party} onValueChange={(v) => v && setParty(v)} items={PARTY_OPTIONS}>
                <SelectTrigger size="sm" className="w-full" aria-label="Party size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PARTY_OPTIONS).map(([v, label]) => (
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
                variant={mode === "window" ? "default" : "outline"}
                onClick={() => setMode("window")}
              >
                Any day
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "date" ? "default" : "outline"}
                onClick={() => setMode("date")}
              >
                Specific date
              </Button>
            </div>

            {mode === "window" ? (
              <div className="space-y-1.5">
                <Label>Within</Label>
                <Select
                  value={windowDays}
                  onValueChange={(v) => v && setWindowDays(v)}
                  items={WINDOW_OPTIONS}
                >
                  <SelectTrigger size="sm" className="w-full" aria-label="Window">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(WINDOW_OPTIONS).map(([v, label]) => (
                      <SelectItem key={v} value={v}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="dining-alert-date">Date</Label>
                <DatePicker
                  id="dining-alert-date"
                  value={date}
                  onChange={setDate}
                  fromDate={new Date()}
                  placeholder="Pick a date"
                />
              </div>
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
