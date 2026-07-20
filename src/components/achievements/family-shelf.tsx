/**
 * A single achievement family rendered as a horizontally-scrolling shelf of
 * color-ramped tier medallions with a progress bar toward the next tier — the
 * building block of the full badge catalog. Shared by the Badges page and the
 * /activity "All badges" section so both stay in lock-step.
 */
import { TierBadge } from "#/components/achievements/tier-badge.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import {
  Carousel,
  CarouselArrows,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel.tsx";
import { Progress } from "#/components/ui/progress.tsx";
import {
  ACHIEVEMENTS,
  formatStatValue,
  type AchievementFamily,
  type Stats,
} from "#/lib/achievements.ts";

export function FamilyShelf({
  family,
  stats,
  unlockedIds,
}: {
  family: AchievementFamily;
  stats: Stats;
  unlockedIds: ReadonlySet<string>;
}) {
  const value = stats[family.stat] ?? 0;
  const maxed = family.tiers.every((t) => unlockedIds.has(t.id));
  const nextTier = family.tiers.find((t) => !unlockedIds.has(t.id));
  const tierCount = family.tiers.length;
  const unlockedCount = family.tiers.filter((t) => unlockedIds.has(t.id)).length;
  // The badge you're working toward (or the final one, once maxed) — its flavor
  // text sits under the title instead of a bare stat value.
  const featured = nextTier ?? family.tiers[tierCount - 1];

  return (
    <Carousel opts={{ align: "start", dragFree: true }} className="-mx-4 lg:-mx-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4 px-4 lg:px-6">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="font-rounded flex items-center gap-2 text-base font-bold tracking-tight">
              <span className="text-xl leading-none" aria-hidden>
                {family.icon}
              </span>
              {family.title}
            </h3>
            <p className="text-muted-foreground line-clamp-2 text-sm text-pretty">
              {featured.description}
            </p>
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
              <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                {/* left: badges earned in this family; right: progress to next tier */}
                <span>
                  {unlockedCount}/{tierCount} badges
                </span>
                <span>
                  {formatStatValue(family.unit, value)} /{" "}
                  {formatStatValue(family.unit, nextTier.threshold)}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </Carousel>
  );
}

/**
 * The whole badge catalog — every family's shelf. Rendered under the /activity
 * lifetime totals so all earnable badges are visible, and reused on the Badges
 * page itself.
 */
export function AllBadges({
  stats,
  unlockedIds,
}: {
  stats: Stats;
  unlockedIds: ReadonlySet<string>;
}) {
  return (
    <div className="flex flex-col gap-8">
      {ACHIEVEMENTS.map((family) => (
        <FamilyShelf key={family.key} family={family} stats={stats} unlockedIds={unlockedIds} />
      ))}
    </div>
  );
}
