import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { FerrisWheelIcon, FootprintsIcon, TrophyIcon } from "lucide-react";

import { LoginLink } from "#/components/login-link.tsx";
import { AllBadges } from "#/components/achievements/family-shelf.tsx";
import {
  LifetimeCard,
  RecapCard,
  formatDayLabel,
  type DayEntry,
} from "#/components/activity/recap-card.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/components/ui/empty.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { seo } from "#/lib/seo.ts";
import { formatDistance, preferredUnitSystem, type UnitSystem } from "#/lib/units.ts";
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
  units: UnitSystem;
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
        "flex w-full items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-left transition-colors",
        selected ? "border-primary/60 ring-1 ring-primary/40" : "hover:bg-accent/50",
      )}
    >
      <div className="min-w-0">
        <p className="font-rounded text-sm font-semibold">
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
      { getNextPageParam: (last) => last.nextCursor ?? undefined, enabled: signedIn },
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

  // Locale-derived, so read once client-side; SSR renders metric either way.
  const [units, setUnits] = React.useState<UnitSystem>("metric");
  React.useEffect(() => {
    setUnits(preferredUnitSystem());
  }, []);

  if (isPending) {
    return (
      <div className="font-rubik-all mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 lg:px-6">
        <Skeleton className="h-[40rem] w-full rounded-3xl" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="font-rubik-all mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 lg:px-6">
        <Empty>
          <EmptyMedia variant="icon">
            <FootprintsIcon />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Sign in to see your park days</EmptyTitle>
            <EmptyDescription>
              Visit a park with ParkFi running and every day gets recapped here automatically — no
              check-in required.
            </EmptyDescription>
          </EmptyHeader>
          <Button render={<LoginLink />}>Sign in</Button>
        </Empty>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: <FootprintsIcon className="size-5" />,
              title: "Steps & distance",
              desc: "How far you walked, park by park.",
            },
            {
              icon: <FerrisWheelIcon className="size-5" />,
              title: "Rides detected",
              desc: "Every ride you rode, logged for you.",
            },
            {
              icon: <TrophyIcon className="size-5" />,
              title: "Badges & XP",
              desc: "Park days level you up and unlock badges.",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border bg-card px-4 py-5 text-center">
              <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-xl bg-muted">
                {f.icon}
              </div>
              <p className="font-rounded text-sm font-bold">{f.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const unlockedIds = new Set(progressQ.data?.unlocked.map((u) => u.id) ?? []);
  const stats = progressQ.data?.stats ?? {};
  const level = progressQ.data?.level;
  // Any badge unlocked or any nonzero lifetime stat — a pins-only or sensor-only
  // account has these without ever logging a park day, and we must not hide them.
  const hasLifetime = unlockedIds.size > 0 || Object.values(stats).some((v) => (v ?? 0) > 0);

  const showRecap = days.length > 0 && !!selected;
  const showLifetimeCard = days.length === 0 && !progressQ.isLoading && hasLifetime && !!level;
  const showEmpty = days.length === 0 && !progressQ.isLoading && !hasLifetime;

  return (
    <div className="font-rubik-all flex w-full flex-col">
      {/* Full-bleed recap surface (runs to the device edges on mobile). */}
      {feedQ.isLoading ? (
        <div className="px-4 pt-[calc(var(--safe-top)_+_var(--app-header-h)_+_1.25rem)] md:px-6 md:pt-6">
          <Skeleton className="h-[34rem] w-full rounded-2xl" />
        </div>
      ) : showRecap ? (
        <RecapCard
          day={selected!.day}
          entries={selected!.entries}
          detail={detailQ.data}
          detailLoading={detailQ.isLoading}
          stats={stats}
          unlockedIds={unlockedIds}
          units={units}
          level={level}
        />
      ) : showLifetimeCard ? (
        // No park days, but there IS lifetime progress — surface it, don't hide it.
        <LifetimeCard stats={stats} unlockedIds={unlockedIds} level={level!} />
      ) : null}

      {/* Everything below the hero sits in the normal padded, app-themed column. */}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 lg:px-6">
        {showEmpty && (
          <div className="rounded-2xl border bg-card px-4 py-10 text-center">
            <p className="font-rounded text-lg font-bold">No park days yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Visit a park with ParkFi running and your day shows up here automatically — no
              check-in required.
            </p>
          </div>
        )}

        {days.length > 1 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-rounded text-base font-bold tracking-tight">History</h2>
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

        {/* All earnable badges — the full catalog, same shelves as the Badges page. */}
        {progressQ.data && (
          <section className="flex flex-col gap-5">
            <div>
              <h2 className="font-rounded text-lg font-bold tracking-tight">All badges</h2>
              <p className="text-sm text-muted-foreground">
                Every badge you can earn — {unlockedIds.size} unlocked so far.
              </p>
            </div>
            <AllBadges stats={stats} unlockedIds={unlockedIds} />
          </section>
        )}
      </div>
    </div>
  );
}
