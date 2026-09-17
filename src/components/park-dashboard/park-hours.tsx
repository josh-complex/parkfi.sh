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
  /**
   * "10 PM" — when the window the guest is *standing in* shuts, which on an
   * event night is the party's close and not the regular one. Null while shut,
   * before hydration, or when the open window posts no end.
   */
  closingLabel: string | null;
  /** Open right now. Null until hydration — it's a reading of the clock, and
   *  the server has no business guessing what time it is where the guest is. */
  openNow: boolean | null;
  /** "Opens 9 AM" / "Opens 9 AM Wed" — where a shut park picks up again. Null
   *  while open, before hydration, or when nothing further is posted. */
  nextOpen: string | null;
  /** "Early entry 8 AM", when the park posts an early-entry window today. */
  earlyEntry: string | null;
  /** The operator has posted *any* days for this park. The ticket uses it to
   *  decide whether its lower half has an hours block to frame at all. */
  hasSchedule: boolean;
  /**
   * The hours query has answered, either way. False on the server *and* on the
   * client's first render (this query isn't SSR-prefetched), so a caller can
   * reserve space for the block without the two disagreeing about whether it
   * exists — which `loading` can't do, since TanStack reports `isLoading` false
   * on a server that never fetches and true on the client that does.
   */
  ready: boolean;
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
    closingLabel: active?.close ? clockTight(active.close, tz) : null,
    openNow,
    nextOpen,
    earlyEntry: early ? `Early entry ${clockTight(early.open, tz)}` : null,
    hasSchedule: (q.data?.days.length ?? 0) > 0,
    ready: !parkSlug || q.data != null,
    loading: q.isLoading || !parkSlug,
  };
}

/**
 * "Hours" — today's window and the next few days the park has posted, as a
 * list.
 *
 * `variant="ticket"` drops the card chrome and inks the list for the stub's own
 * lower half, which is where the park page carries it (2026-09-16, Josh). It
 * used to head the AHEAD band with the crowd calendar and the price; it reads
 * better on the ticket, because "what time does this place open" is a fact
 * about the park in the same way the longest wait is, and the band it was in
 * was asking a different question — which *other* day to come.
 *
 * Today keeps its own row (picked out) even though the ticket's own status pill
 * carries it too — a column of six dates whose first entry is tomorrow reads as
 * a park that isn't open today.
 *
 * Client-only (the hours query isn't SSR-prefetched), so it falls back to a
 * skeleton on the server + first client render — no hydration mismatch from the
 * timezone-aware "today" lookup. On the ticket it renders nothing at all until
 * the query lands: a grey slab inside the stub is worse than a stub that grows.
 */
export function ParkHours({
  parkSlug,
  variant = "card",
  className,
}: {
  parkSlug: string | null;
  /** `"ticket"` renders bare, in the stub's ink — see above. */
  variant?: "card" | "ticket";
  className?: string;
}) {
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.parks.hours.queryOptions({ parkSlug: parkSlug ?? "" }),
    enabled: !!parkSlug,
  });
  const ticket = variant === "ticket";

  // Same shape in grey rather than nothing: on the ticket this block sits above
  // the showtimes and above the whole left column, so appearing late pushed all
  // of it down. Keyed off the data, not `isLoading` — see `ready` above.
  if (!q.data) {
    if (!parkSlug) return null;
    if (ticket) {
      return (
        <div className={cn("flex flex-col gap-3", className)}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[11px] font-bold tracking-[0.06em] text-ink-on-yellow/60 uppercase">
              Hours
            </h3>
          </div>
          <div className="flex flex-col gap-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2.5 px-2 py-1">
                <Skeleton className="h-3.5 w-16 rounded bg-ink-on-yellow/10" />
                <Skeleton className="h-3.5 w-28 rounded bg-ink-on-yellow/10" />
              </div>
            ))}
          </div>
        </div>
      );
    }
    return <Skeleton className={cn("h-[248px] w-full rounded-[22px]", className)} />;
  }

  const data = q.data;
  if (!data || data.days.length === 0) return null;

  const tz = data.timezone;
  const today = todayInTz(tz);
  const todayEntry = data.days.find((d) => d.date === today) ?? null;
  // Fewer days on the ticket: the stub is carrying the showtimes under this,
  // and a week of dates there turns the identity block into a timetable.
  const upcoming = data.days.filter((d) => d.date > today).slice(0, ticket ? 3 : 5);
  if (upcoming.length === 0 && !todayEntry) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        !ticket && "rounded-[22px] border border-card-edge bg-card p-4 md:p-5",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3
          className={cn(
            "flex items-center gap-2",
            ticket
              ? "text-[11px] font-bold tracking-[0.06em] text-ink-on-yellow/60 uppercase"
              : "text-[19px] font-extrabold tracking-[-0.01em]",
          )}
        >
          {!ticket && <ClockIcon className="size-4 text-muted-foreground" />}
          Hours
        </h3>
        <span
          className={cn(
            "shrink-0 text-xs",
            ticket ? "font-semibold text-ink-on-yellow/55" : "text-muted-foreground",
          )}
        >
          Next {upcoming.length + (todayEntry ? 1 : 0)} days
        </span>
      </div>

      <div className={cn("flex flex-col", ticket ? "gap-1" : "gap-1.5")}>
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-xl px-3 py-2",
            ticket ? "-mx-1 bg-ink-on-yellow/8 px-2 py-1.5" : "bg-brand-yellow/10",
          )}
        >
          <span
            className={cn("w-16 shrink-0 font-extrabold", ticket ? "text-[13px]" : "text-[13px]")}
          >
            Today
          </span>
          <span className="flex-1 text-[13px] font-semibold tabular-nums">
            {todayEntry
              ? (formatHourRange(todayEntry.open, todayEntry.close, tz) ?? "Hours unavailable")
              : "Closed"}
          </span>
          {todayEntry?.extras.slice(0, 1).map((ex, i) => (
            <span
              key={`${ex.type}-${i}`}
              className={cn(
                "shrink-0 text-[11.5px] font-bold",
                ticket ? "text-ink-on-yellow/70" : "text-brand-yellow-shelf",
              )}
              title={extraLabel(ex.type, ex.description)}
            >
              {formatHour(ex.open, tz)}
            </span>
          ))}
        </div>
        {upcoming.map((d) => {
          const range = formatHourRange(d.open, d.close, tz, true);
          const label = new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", {
            weekday: "short",
            day: "numeric",
          });
          const extra = d.extras[0] ?? null;
          return (
            <div key={d.date} className={cn("flex items-center gap-2.5", ticket ? "px-2" : "px-3")}>
              <span
                className={cn(
                  "w-16 shrink-0 text-[13px] font-bold",
                  ticket ? "text-ink-on-yellow/85" : "text-foreground/80",
                )}
              >
                {label}
              </span>
              <span
                className={cn(
                  "flex-1 text-[13px] tabular-nums",
                  ticket ? "font-semibold text-ink-on-yellow/70" : "text-muted-foreground",
                )}
              >
                {range ?? "Closed"}
              </span>
              {extra && (
                <span
                  className={cn(
                    "shrink-0 text-[11.5px]",
                    ticket ? "text-ink-on-yellow/60" : "text-muted-foreground",
                  )}
                  title={extraLabel(extra.type, extra.description)}
                >
                  {formatHour(extra.open, tz)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
