"use client";

import { useQuery } from "@tanstack/react-query";
import { ClockIcon } from "lucide-react";

import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { clockTight, formatHour, formatHourRange, todayInTz } from "#/lib/park-hours.ts";
import { useHydrated } from "#/lib/use-hydrated.ts";
import { cn } from "#/lib/utils.ts";

function extraLabel(type: string, description: string | null): string {
  if (description) return description;
  return type === "TICKETED_EVENT" ? "Special Event" : "Extra Hours";
}

/** Today's schedule, in the shape the park hero's chips need. */
export interface ParkHoursToday {
  timezone: string;
  /** "9 AM – 8 PM" for today's OPERATING window; null when the park is shut. */
  range: string | null;
  /** Today's two clock times on their own, for a chart's end ticks. */
  openLabel: string | null;
  closeLabel: string | null;
  /** Open right now. Null until hydration — it's a reading of the clock, and
   *  the server has no business guessing what time it is where the guest is. */
  openNow: boolean | null;
  /** "Opens 9 AM" / "Opens 9 AM Wed" — where a shut park picks up again. Null
   *  while open, before hydration, or when nothing further is posted. */
  nextOpen: string | null;
  /** "Early entry 8 AM", when the park posts an early-entry window today. */
  earlyEntry: string | null;
  loading: boolean;
}

/**
 * Today's hours for a park, as the hero chips read them. Shares its query cache
 * with `ParkHours` below, so the page pays for one `parks.hours` round trip.
 */
export function useParkHoursToday(parkSlug: string | null): ParkHoursToday {
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.parks.hours.queryOptions({ parkSlug: parkSlug ?? "" }),
    enabled: !!parkSlug,
  });
  const hydrated = useHydrated();

  const tz = q.data?.timezone ?? "America/New_York";
  const today = q.data ? (q.data.days.find((d) => d.date === todayInTz(tz)) ?? null) : null;
  // Disney posts early entry as an EXTRA_HOURS row; the description is the only
  // thing that separates it from an after-hours event on the same row type.
  const early = today?.extras.find((ex) => /early/i.test(ex.description ?? "")) ?? null;
  // Every window the park is running today — regular hours *and* the extras
  // (early entry, a hard-ticket Halloween night). A park is open if the clock
  // is inside any of them: Magic Kingdom at 10 PM on a party night is open, and
  // a chip that reads "Closed · 9 AM – 6 PM" while forty rides post waits is
  // simply wrong.
  const windows = today
    ? [
        ...(today.open
          ? [{ open: today.open, close: today.close, label: null as string | null }]
          : []),
        ...today.extras.map((ex) => ({
          open: ex.open,
          close: ex.close,
          label: extraLabel(ex.type, ex.description),
        })),
      ]
    : [];
  const active =
    !hydrated || !q.data
      ? null
      : (windows.find(
          (w) =>
            Date.now() >= Date.parse(w.open) &&
            (w.close == null || Date.now() < Date.parse(w.close)),
        ) ?? null);
  const openNow = !hydrated || !q.data ? null : active != null;

  // Where a shut park picks up again: this morning if the gates haven't opened
  // yet, otherwise the next day that posts an opening at all (parks skip days).
  const nextOpen = (() => {
    if (!hydrated || !q.data || openNow !== false) return null;
    if (today?.open && Date.now() < Date.parse(today.open)) {
      return `Opens ${clockTight(today.open, tz)}`;
    }
    const iso = todayInTz(tz);
    const ahead = q.data.days.find((d) => d.date > iso && d.open != null);
    if (!ahead?.open) return null;
    const weekday = new Date(`${ahead.date}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
    });
    return `Opens ${clockTight(ahead.open, tz)} ${weekday}`;
  })();

  return {
    timezone: tz,
    // While the park is open the chip states the window the guest is standing
    // in — which is the event's, on an event night — and otherwise today's
    // regular hours.
    range: active
      ? [active.label, formatHourRange(active.open, active.close, tz)].filter(Boolean).join(" · ")
      : today
        ? formatHourRange(today.open, today.close, tz)
        : null,
    openLabel: today?.open ? clockTight(today.open, tz) : null,
    closeLabel: today?.close ? clockTight(today.close, tz) : null,
    openNow,
    nextOpen,
    earlyEntry: early ? `Early entry ${clockTight(early.open, tz)}` : null,
    loading: q.isLoading || !parkSlug,
  };
}

/**
 * The week ahead — a flat card of upcoming operating hours. Today's own hours
 * moved up to the hero chips with the Option C redesign (plan §4.3), so this is
 * the planning strip only: the next six days the park has posted.
 *
 * Client-only (the hours query isn't SSR-prefetched), so it falls back to a
 * skeleton on the server + first client render — no hydration mismatch from the
 * timezone-aware "today" lookup.
 */
export function ParkHours({
  parkSlug,
  className,
}: {
  parkSlug: string | null;
  className?: string;
}) {
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.parks.hours.queryOptions({ parkSlug: parkSlug ?? "" }),
    enabled: !!parkSlug,
  });

  if (q.isLoading || !parkSlug) {
    return <Skeleton className={cn("h-[104px] w-full rounded-[22px]", className)} />;
  }

  const data = q.data;
  if (!data || data.days.length === 0) return null;

  const tz = data.timezone;
  const today = todayInTz(tz);
  const todayEntry = data.days.find((d) => d.date === today) ?? null;
  const upcoming = data.days.filter((d) => d.date > today).slice(0, 6);
  if (upcoming.length === 0 && !todayEntry) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[22px] border border-card-edge bg-card p-4 md:p-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <ClockIcon className="size-4" />
          <span className="text-[11px] font-bold uppercase tracking-[0.06em]">Hours</span>
        </span>
        <span className="text-[15px] font-bold tabular-nums">
          {todayEntry
            ? (formatHourRange(todayEntry.open, todayEntry.close, tz) ?? "Hours unavailable")
            : "Closed today"}
        </span>
        {todayEntry?.extras.map((ex, i) => {
          const range = formatHourRange(ex.open, ex.close, tz);
          return (
            <span
              key={`${ex.type}-${i}`}
              className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
            >
              {extraLabel(ex.type, ex.description)}
              {range ? ` · ${range}` : ` · from ${formatHour(ex.open, tz)}`}
            </span>
          );
        })}
      </div>

      {upcoming.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-t pt-3 text-xs">
          {upcoming.map((d) => {
            const range = formatHourRange(d.open, d.close, tz, true);
            const label = new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            return (
              <span key={d.date} className="text-muted-foreground">
                <span className="font-semibold text-foreground">{label}</span>{" "}
                <span className="tabular-nums">{range ?? "Closed"}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
