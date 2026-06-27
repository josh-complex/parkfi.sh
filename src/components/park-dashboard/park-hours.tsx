"use client";

import { useQuery } from "@tanstack/react-query";
import { ClockIcon } from "lucide-react";

import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { formatHour, formatHourRange, todayInTz } from "#/lib/park-hours.ts";
import { cn } from "#/lib/utils.ts";

function extraLabel(type: string, description: string | null): string {
  if (description) return description;
  return type === "TICKETED_EVENT" ? "Special Event" : "Extra Hours";
}

/**
 * Today's operating hours for the park, with a strip of the upcoming days.
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
    return <Skeleton className={cn("h-[88px] w-full rounded-2xl", className)} />;
  }

  const data = q.data;
  if (!data || data.days.length === 0) return null;

  const tz = data.timezone;
  const today = todayInTz(tz);
  const todayEntry = data.days.find((d) => d.date === today) ?? null;
  const todayRange = todayEntry ? formatHourRange(todayEntry.open, todayEntry.close, tz) : null;
  const upcoming = data.days.filter((d) => d.date > today).slice(0, 6);

  return (
    <div className={cn("rounded-2xl border bg-card p-4 shadow-sm", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <ClockIcon className="size-4" />
          <span className="text-xs font-medium uppercase tracking-wider">Today's Hours</span>
        </span>
        <span className="text-lg font-semibold tabular-nums">
          {todayRange ?? (todayEntry ? "Hours unavailable" : "Closed today")}
        </span>
        {todayEntry?.extras.map((ex, i) => {
          const range = formatHourRange(ex.open, ex.close, tz);
          return (
            <span
              key={`${ex.type}-${i}`}
              className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
            >
              {extraLabel(ex.type, ex.description)}
              {range ? ` · ${range}` : ` · from ${formatHour(ex.open, tz)}`}
            </span>
          );
        })}
      </div>

      {upcoming.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 border-t pt-3 text-xs">
          {upcoming.map((d) => {
            const range = formatHourRange(d.open, d.close, tz, true);
            const label = new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            return (
              <span key={d.date} className="text-muted-foreground">
                <span className="font-medium text-foreground">{label}</span>{" "}
                <span className="tabular-nums">{range ?? "Closed"}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
