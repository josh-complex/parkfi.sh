import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { Sparkle } from "#/components/achievements/achievement-toast.tsx";
import { LevelBadge } from "#/components/achievements/level-badge.tsx";
import { TierBadge } from "#/components/achievements/tier-badge.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Carousel,
  CarouselArrows,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel.tsx";
import { Progress } from "#/components/ui/progress.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { hasGrantedLocationBefore } from "#/hooks/use-geolocation.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import {
  ACHIEVEMENTS,
  formatStatValue,
  type AchievementFamily,
  type LevelInfo,
  type Stats,
} from "#/lib/achievements.ts";
import { authClient } from "#/lib/auth-client.ts";
import { rideRecapSegments } from "#/lib/ride-recap.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/_dash/achievements")({
  component: AchievementsPage,
  head: () => seo({ title: "Achievements — ParkFi", noindex: true }),
});

const TOTAL_TIERS = ACHIEVEMENTS.reduce((n, f) => n + f.tiers.length, 0);

/**
 * The "Level N" hero — the same gold, sparkle-accented treatment as the
 * level-up toast (`achievement-toast.tsx`) and the nav's level coin, rather
 * than a plain bordered stat card.
 */
function LevelHeaderCard({
  level,
  xp,
  unlockedCount,
}: {
  level: LevelInfo;
  xp: number;
  unlockedCount: number;
}) {
  const pct = level.forNext
    ? Math.min(100, Math.round((level.intoLevel / level.forNext) * 100))
    : 100;
  return (
    <div className="achv-hero flex items-start gap-4 rounded-3xl p-5 sm:p-6">
      <Sparkle className="achv-sparkle--tl" />
      <Sparkle className="achv-sparkle--br" />
      <LevelBadge level={level.level} size="lg" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold tracking-widest uppercase opacity-70">
          Level {level.level}
        </p>
        <p className="text-xl leading-tight font-black text-balance sm:text-2xl">{level.title}</p>
        <p className="mt-1 text-sm font-medium opacity-80">
          {xp.toLocaleString()} XP total · {unlockedCount}/{TOTAL_TIERS} unlocked
        </p>
        {level.forNext != null ? (
          <div className="mt-3 space-y-1">
            <div
              className="h-2.5 w-full overflow-hidden rounded-full"
              style={{ background: "oklch(0 0 0 / 0.12)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: "oklch(0.3 0.08 66)" }}
              />
            </div>
            <p className="text-xs font-medium opacity-70">
              {level.intoLevel.toLocaleString()} / {level.forNext.toLocaleString()} XP to level{" "}
              {level.level + 1}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm font-medium opacity-80">
            Max level reached — you've seen it all.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A family's tiers as a horizontally-scrolling shelf of color-ramped
 * medallions (grid on desktop via arrows, drag on mobile) — mirrors the
 * Eats/Stays picks shelves rather than a bordered card of flat pills.
 */
function FamilyShelf({
  family,
  stats,
  unlockedIds,
}: {
  family: AchievementFamily;
  stats: Stats;
  unlockedIds: Set<string>;
}) {
  const value = stats[family.stat] ?? 0;
  const maxed = family.tiers.every((t) => unlockedIds.has(t.id));
  const nextTier = family.tiers.find((t) => !unlockedIds.has(t.id));
  const tierCount = family.tiers.length;

  return (
    <Carousel opts={{ align: "start", dragFree: true }} className="-mx-4 lg:-mx-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4 px-4 lg:px-6">
          <div className="flex flex-col gap-0.5">
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <span className="text-xl leading-none" aria-hidden>
                {family.icon}
              </span>
              {family.title}
            </h3>
            <p className="text-muted-foreground text-sm">{formatStatValue(family.unit, value)}</p>
          </div>
          <CarouselArrows className="hidden md:flex" />
        </div>

        <CarouselContent viewportClassName="px-4 lg:px-6 [mask-image:linear-gradient(to_right,transparent,#000_1.5rem,#000_calc(100%_-_1.5rem),transparent)]">
          {family.tiers.map((tier, i) => (
            <CarouselItem key={tier.id} className="basis-auto">
              <TierBadge
                familyKey={family.key}
                icon={family.icon}
                name={tier.name}
                description={tier.description}
                rank={tierCount > 1 ? i / (tierCount - 1) : 1}
                unlocked={unlockedIds.has(tier.id)}
                next={tier.id === nextTier?.id}
              />
            </CarouselItem>
          ))}
        </CarouselContent>

        <div className="px-4 lg:px-6">
          {maxed ? (
            <Badge variant="secondary">Maxed</Badge>
          ) : nextTier ? (
            <div className="space-y-1">
              <Progress value={Math.min(100, (value / nextTier.threshold) * 100)} />
              <p className="text-xs text-muted-foreground">
                {formatStatValue(family.unit, value)} /{" "}
                {formatStatValue(family.unit, nextTier.threshold)}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </Carousel>
  );
}

/** park-local date + time for a ride, e.g. "Jul 9, 2:14 PM". */
function formatRiddenAt(riddenAt: string | Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(riddenAt));
  } catch {
    return new Date(riddenAt).toLocaleString();
  }
}

/**
 * The durable ride journal — the per-ride receipts behind the sensor stat
 * shelves above. Sensor-only (dwell rides carry no metrics), keyset-paginated.
 * Renders nothing until there's at least one ride, except a soft empty state so
 * pre-native users understand where sensor rides will land.
 */
function RideLogSection() {
  const trpc = useTRPC();
  const q = useInfiniteQuery(
    trpc.achievements.myRideLog.infiniteQueryOptions(
      { limit: 20 },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
  );

  const rides = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <span className="text-xl leading-none" aria-hidden>
            🎢
          </span>
          Ride log
        </h3>
        <p className="text-muted-foreground text-sm">
          Every sensor-verified ride, most recent first.
        </p>
      </div>

      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : rides.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sensor-verified rides will show up here once you ride a coaster with the app open in the
          park.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rides.map((ride) => {
              const recap = rideRecapSegments(ride.metrics!).join(" · ");
              return (
                <li
                  key={ride.id}
                  className="flex items-start justify-between gap-3 rounded-xl border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{ride.attraction.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ride.park.name} · {formatRiddenAt(ride.riddenAt, ride.park.timezone)}
                    </p>
                    {recap && <p className="mt-1 text-xs text-muted-foreground">{recap}</p>}
                  </div>
                  {ride.source === "sensor+dwell" && (
                    <Badge variant="secondary" className="shrink-0">
                      sensor+dwell
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
          {q.hasNextPage && (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void q.fetchNextPage()}
                disabled={q.isFetchingNextPage}
              >
                {q.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AchievementsPage() {
  const { data: session, isPending } = authClient.useSession();
  const trpc = useTRPC();
  const progressQ = useQuery({
    ...trpc.achievements.progress.queryOptions(),
    enabled: !!session?.user,
  });

  // Read once client-side (post-mount) to avoid an SSR/client hydration
  // mismatch on a localStorage-backed flag.
  const [everGrantedLocation, setEverGrantedLocation] = React.useState(false);
  React.useEffect(() => {
    setEverGrantedLocation(hasGrantedLocationBefore());
  }, []);

  if (isPending) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 lg:px-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-3">
            <Skeleton className="h-5 w-40" />
            <div className="flex gap-3">
              {[1, 2, 3, 4, 5].map((j) => (
                <Skeleton key={j} className="aspect-square w-24 shrink-0 rounded-2xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:px-6">
        <p className="text-sm text-muted-foreground">
          You must be signed in to view your achievements.
        </p>
      </div>
    );
  }

  const data = progressQ.data;
  const unlockedIds = new Set(data?.unlocked.map((u) => u.id) ?? []);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Achievements</h1>
        <p className="text-sm text-muted-foreground">
          Level up by spending time in the parks — geofenced automatically, no check-in required.
        </p>
      </header>

      {data ? (
        <LevelHeaderCard level={data.level} xp={data.xp} unlockedCount={data.unlocked.length} />
      ) : (
        <Skeleton className="h-32 w-full rounded-2xl" />
      )}

      <div className="flex flex-col gap-8">
        {ACHIEVEMENTS.map((family) => (
          <FamilyShelf
            key={family.key}
            family={family}
            stats={data?.stats ?? {}}
            unlockedIds={unlockedIds}
          />
        ))}
      </div>

      <RideLogSection />

      {!everGrantedLocation && (
        <p className="text-xs text-muted-foreground">
          Most of these unlock from being in the parks — turn on location to start counting.
        </p>
      )}
    </div>
  );
}
