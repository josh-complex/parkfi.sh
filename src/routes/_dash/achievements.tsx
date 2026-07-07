import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "#/components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Progress } from "#/components/ui/progress.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.tsx";
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
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_dash/achievements")({
  component: AchievementsPage,
  head: () => seo({ title: "Achievements — ParkFi", noindex: true }),
});

const TOTAL_TIERS = ACHIEVEMENTS.reduce((n, f) => n + f.tiers.length, 0);

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
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-2xl">
          <span>Level {level.level}</span>
          <span className="text-base font-normal text-muted-foreground">{level.title}</span>
        </CardTitle>
        <CardDescription>
          {xp.toLocaleString()} XP total · {unlockedCount}/{TOTAL_TIERS} unlocked
        </CardDescription>
      </CardHeader>
      <CardContent>
        {level.forNext != null ? (
          <div className="space-y-1.5">
            <Progress value={pct} />
            <p className="text-xs text-muted-foreground">
              {level.intoLevel.toLocaleString()} / {level.forNext.toLocaleString()} XP to level{" "}
              {level.level + 1}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Max level reached — you've seen it all.</p>
        )}
      </CardContent>
    </Card>
  );
}

function FamilyCard({
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="text-xl leading-none">{family.icon}</span>
          {family.title}
        </CardTitle>
        <CardDescription>{formatStatValue(family.unit, value)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {family.tiers.map((tier) => {
            const unlocked = unlockedIds.has(tier.id);
            return (
              <Tooltip key={tier.id}>
                <TooltipTrigger>
                  <Badge variant={unlocked ? "default" : "outline"}>{tier.name}</Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-56 text-pretty">
                  <p className="font-medium">{tier.name}</p>
                  <p>{tier.description}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

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
      </CardContent>
    </Card>
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:px-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
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

      <div className="grid gap-4 sm:grid-cols-2">
        {ACHIEVEMENTS.map((family) => (
          <FamilyCard
            key={family.key}
            family={family}
            stats={data?.stats ?? {}}
            unlockedIds={unlockedIds}
          />
        ))}
      </div>

      {!everGrantedLocation && (
        <p className="text-xs text-muted-foreground">
          Most of these unlock from being in the parks — turn on location to start counting.
        </p>
      )}
    </div>
  );
}
