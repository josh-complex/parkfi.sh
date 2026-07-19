import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  DayRecapCard,
  formatDayLabel,
  type DayEntry,
} from "#/components/activity/day-recap-card.tsx";
import { LifetimeSection } from "#/components/activity/lifetime-section.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { seo } from "#/lib/seo.ts";
import { formatDistance, preferredUnitSystem } from "#/lib/units.ts";
import { cn } from "#/lib/utils.ts";

export const Route = createFileRoute("/_app/_dash/activity")({
  component: ActivityPage,
  head: () => seo({ title: "Activity — ParkFi", noindex: true }),
});

/** Compact history row: date, hop chain, headline numbers, flag glyphs. */
function DayRow({
  day,
  entries,
  selected,
  units,
  onSelect,
}: {
  day: string;
  entries: DayEntry[];
  selected: boolean;
  units: "imperial" | "metric";
  onSelect: () => void;
}) {
  const steps = entries.reduce((n, e) => n + e.steps, 0);
  const distanceM = entries.reduce((n, e) => n + e.distanceM, 0);
  const rides = entries.reduce((n, e) => n + e.rides, 0);
  const flags = [
    entries.some((e) => e.ropeDrop) && "🌅",
    entries.some((e) => e.nightOwl) && "🌙",
    entries.some((e) => e.rainy) && "🌧️",
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors",
        selected ? "border-primary/60 ring-1 ring-primary/40" : "hover:bg-accent/50",
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {formatDayLabel(day)}
          {flags.length > 0 && (
            <span className="ml-1.5" aria-hidden>
              {flags.join(" ")}
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {entries.map((e) => e.park.name).join(" → ")}
        </p>
      </div>
      <p className="shrink-0 text-right text-xs text-muted-foreground">
        {steps > 0 ? `${steps.toLocaleString()} steps` : formatDistance(distanceM, units)}
        <br />
        {rides} {rides === 1 ? "ride" : "rides"}
      </p>
    </button>
  );
}

function ActivityPage() {
  const { data: session, isPending } = authClient.useSession();
  const trpc = useTRPC();
  const signedIn = !!session?.user;

  const feedQ = useInfiniteQuery(
    trpc.activity.myActivityDays.infiniteQueryOptions(
      { limit: 15 },
      {
        getNextPageParam: (last) => last.nextCursor ?? undefined,
        enabled: signedIn,
      },
    ),
  );
  const progressQ = useQuery({
    ...trpc.achievements.progress.queryOptions(),
    enabled: signedIn,
  });

  const days = React.useMemo(() => feedQ.data?.pages.flatMap((p) => p.days) ?? [], [feedQ.data]);

  const [pickedDay, setPickedDay] = React.useState<string | null>(null);
  const selectedDay = pickedDay ?? days[0]?.day ?? null;
  const selected = days.find((d) => d.day === selectedDay);

  const detailQ = useQuery({
    ...trpc.activity.myDayDetail.queryOptions({ day: selectedDay ?? "1970-01-01" }),
    enabled: signedIn && selectedDay != null,
  });

  // Locale-derived, so read it once client-side; SSR renders metric either way.
  const [units, setUnits] = React.useState<"imperial" | "metric">("metric");
  React.useEffect(() => {
    setUnits(preferredUnitSystem());
  }, []);

  if (isPending) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 lg:px-6">
        <Skeleton className="h-72 w-full rounded-3xl" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 lg:px-6">
        <p className="text-sm text-muted-foreground">
          You must be signed in to view your park activity.
        </p>
      </div>
    );
  }

  const unlockedIds = new Set(progressQ.data?.unlocked.map((u) => u.id) ?? []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Every park day, recapped — steps, rides, queues, and the badges they earned.
        </p>
      </header>

      {feedQ.isLoading ? (
        <Skeleton className="h-72 w-full rounded-3xl" />
      ) : days.length === 0 ? (
        <div className="rounded-2xl border bg-card px-4 py-8 text-center">
          <p className="text-sm font-medium">No park days yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Visit a park with ParkFi running and your day shows up here automatically — no check-in
            required.
          </p>
        </div>
      ) : (
        <>
          {selected && (
            <DayRecapCard
              day={selected.day}
              entries={selected.entries}
              detail={detailQ.data}
              detailLoading={detailQ.isLoading}
              unlockedIds={unlockedIds}
              units={units}
            />
          )}

          {days.length > 1 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-base font-semibold tracking-tight">History</h2>
              {days.map((d) => (
                <DayRow
                  key={d.day}
                  day={d.day}
                  entries={d.entries}
                  selected={d.day === selectedDay}
                  units={units}
                  onSelect={() => setPickedDay(d.day)}
                />
              ))}
              {feedQ.hasNextPage && (
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void feedQ.fetchNextPage()}
                    disabled={feedQ.isFetchingNextPage}
                  >
                    {feedQ.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      <LifetimeSection stats={progressQ.data?.stats ?? {}} unlockedIds={unlockedIds} />
    </div>
  );
}
