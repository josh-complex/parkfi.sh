/**
 * /activity lifetime footer — the headliner badge chips ("Everest ×10") and
 * the lifetime totals grid. Data comes from `achievements.progress` (stats +
 * unlocked tier ids); the Badges page remains the full catalog view and is
 * linked from here (it left the avatar menu when Activity replaced it).
 */
import { Link } from "@tanstack/react-router";

import { hueForFamily, tierGradient } from "#/components/achievements/tier-badge.tsx";
import { ACHIEVEMENTS, formatStatValue, type Stats } from "#/lib/achievements.ts";
import { HEADLINERS } from "#/lib/headliners.ts";

/** A headliner's lifetime chip: tier-numbered coin + short name + ride count. */
function HeadlinerChip({
  famKey,
  shortName,
  emoji,
  tierLevel,
  tierCount,
  rideCount,
}: {
  famKey: string;
  shortName: string;
  emoji: string;
  tierLevel: number;
  tierCount: number;
  rideCount: number;
}) {
  const rank = tierCount > 1 ? (tierLevel - 1) / (tierCount - 1) : 1;
  return (
    <div className="flex w-20 shrink-0 flex-col items-center gap-1.5 text-center">
      <span
        className="relative flex size-12 items-center justify-center rounded-full text-lg font-black text-white shadow-sm"
        style={{ backgroundImage: tierGradient(hueForFamily(famKey), rank) }}
        title={`${emoji} ×${rideCount}`}
      >
        {tierLevel}
        <span className="absolute -right-1 -bottom-1 text-sm" aria-hidden>
          {emoji}
        </span>
      </span>
      <span className="line-clamp-1 text-[0.65rem] leading-tight font-semibold">{shortName}</span>
      <span className="text-[0.6rem] text-muted-foreground">×{rideCount}</span>
    </div>
  );
}

export function LifetimeSection({
  stats,
  unlockedIds,
}: {
  stats: Stats;
  unlockedIds: ReadonlySet<string>;
}) {
  const chips = HEADLINERS.map((h) => {
    const family = ACHIEVEMENTS.find((f) => f.key === h.key);
    if (!family) return null;
    const tierLevel = family.tiers.filter((t) => unlockedIds.has(t.id)).length;
    if (tierLevel === 0) return null;
    return {
      famKey: h.key,
      shortName: h.shortName,
      emoji: h.emoji,
      tierLevel,
      tierCount: family.tiers.length,
      rideCount: Math.round(stats[h.key] ?? 0),
    };
  }).filter((c): c is NonNullable<typeof c> => c != null);
  chips.sort((a, b) => b.rideCount - a.rideCount);

  const totals: Array<{ label: string; value: string }> = [
    { label: "steps in-park", value: Math.round(stats.steps ?? 0).toLocaleString() },
    { label: "rides ridden", value: Math.round(stats.rides ?? 0).toLocaleString() },
    { label: "in queues", value: formatStatValue("seconds", stats.queue_seconds ?? 0) },
    { label: "park days", value: Math.round(stats.park_days ?? 0).toLocaleString() },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Lifetime badges</h2>
          <Link to="/achievements" className="text-sm font-medium text-primary hover:underline">
            {unlockedIds.size} unlocked · view all
          </Link>
        </div>
        {chips.length > 0 ? (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {chips.map((c) => (
              <HeadlinerChip key={c.famKey} {...c} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ride a headliner — Space Mountain, Everest, VelociCoaster — to start a collection here.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">Lifetime totals</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {totals.map((t) => (
            <div key={t.label} className="rounded-2xl border bg-card px-4 py-3">
              <p className="text-xl font-black tracking-tight">{t.value}</p>
              <p className="text-xs text-muted-foreground">{t.label}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
