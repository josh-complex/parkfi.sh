/**
 * The /activity park-day recap — one self-contained, time-of-day-themed card
 * (see `.recap*` in styles.css and the phase engine in lib/activity-phase.ts).
 *
 * Layout follows the design mocks top-to-bottom: a phase-tinted hero (wordmark,
 * date, step hero, park-hop chain) over a cream-or-dark body holding the 2×2
 * stat tiles, "badges leveled up today", an optional ride timeline, and the
 * lifetime badges + totals. All values arrive via props from the route.
 */
import type { inferRouterOutputs } from "@trpc/server";

import { Sparkle } from "#/components/achievements/achievement-toast.tsx";
import { LevelBadge } from "#/components/achievements/level-badge.tsx";
import { MetalCoin } from "#/components/activity/metal-coin.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import type { TRPCRouter } from "#/integrations/trpc/router.ts";
import {
  ACHIEVEMENTS,
  TIER_BY_ID,
  formatStatValue,
  tierMetal,
  type LevelInfo,
  type Stats,
  type TierMetal,
} from "#/lib/achievements.ts";
import { dayPhase, phaseEyebrow, resolveDayPhase } from "#/lib/activity-phase.ts";
import { formatBigStat } from "#/lib/format-number.ts";
import { HEADLINERS } from "#/lib/headliners.ts";
import { rideRecapSegments } from "#/lib/ride-recap.ts";
import { formatDistance, type UnitSystem } from "#/lib/units.ts";

type ActivityOutputs = inferRouterOutputs<TRPCRouter>["activity"];
export type DayEntry = ActivityOutputs["myActivityDays"]["days"][number]["entries"][number];
export type DayDetail = ActivityOutputs["myDayDetail"];

/** "Jul 18 · Sat" from a park-local YYYY-MM-DD (rendered in UTC so the label
 *  never shifts a day for a viewer in another timezone). */
export function formatDayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const md = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(d);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(d);
  return `${md} · ${wd}`;
}

function formatClock(at: string | Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(at));
  } catch {
    return new Date(at).toLocaleTimeString();
  }
}

/** A family's lifetime standing: tiers climbed, total, and the metal band. */
function famStanding(
  key: string,
  unlockedIds: ReadonlySet<string>,
): { level: number; total: number; metal: TierMetal | null } {
  const family = ACHIEVEMENTS.find((f) => f.key === key);
  if (!family) return { level: 0, total: 0, metal: null };
  const level = family.tiers.filter((t) => unlockedIds.has(t.id)).length;
  return { level, total: family.tiers.length, metal: tierMetal(level, family.tiers.length) };
}

const METAL_LABEL: Record<TierMetal, string> = {
  bronze: "BRONZE",
  silver: "SILVER",
  gold: "GOLD",
  platinum: "PLATINUM",
};

// --- Hero -------------------------------------------------------------------

/** Full-bleed surface: fills content width and, on mobile, runs to the top +
 *  side edges under the floating search header (pulled up by the negative
 *  margin; the hero's top padding clears the search pill). Desktop nests it into
 *  the content card with matching top rounding. */
const SURFACE =
  "recap relative w-full overflow-hidden -mt-[calc(var(--safe-top)_+_var(--app-header-h))] md:mt-0 md:rounded-t-2xl";
const HERO =
  "recap-hero relative flex flex-col gap-5 px-5 pb-6 pt-[calc(var(--safe-top)_+_var(--app-header-h)_+_1.25rem)] sm:px-6 md:pt-6";

/** Level coin (reused app-wide) + date pill — the hero's top row. Replaces the
 *  old wordmark: the app chrome already brands ParkFi, so here we surface the
 *  player's level instead. */
function HeroTopRow({ level, dayLabel }: { level?: LevelInfo; dayLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      {level ? (
        <span className="flex items-center gap-2">
          <LevelBadge level={level.level} size="lg" className="size-11 text-2xl" />
          <span className="flex flex-col leading-tight">
            <span className="recap-eyebrow text-[0.6rem] font-bold tracking-[0.16em] uppercase">
              Level {level.level}
            </span>
            <span className="text-sm font-semibold">{level.title}</span>
          </span>
        </span>
      ) : (
        <span />
      )}
      <span className="recap-datepill rounded-full px-3 py-1.5 text-xs font-semibold uppercase">
        {dayLabel}
      </span>
    </div>
  );
}

function ParkHopChain({ entries }: { entries: DayEntry[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
      {entries.map((e, i) => (
        <span key={`${e.park.slug}-${i}`} className="flex items-center gap-2">
          {i > 0 && (
            <span className="opacity-60" aria-hidden>
              →
            </span>
          )}
          <span className="recap-chip rounded-full px-3 py-1.5">{e.park.name}</span>
        </span>
      ))}
    </div>
  );
}

// --- Stat tiles ------------------------------------------------------------

function StatTile({
  tone,
  value,
  label,
  famKey,
  unlockedIds,
}: {
  tone: "teal" | "coral" | "gold" | "flip";
  value: string;
  label: string;
  famKey: string;
  unlockedIds: ReadonlySet<string>;
}) {
  const s = famStanding(famKey, unlockedIds);
  return (
    <div className={`recap-tile recap-tile--${tone} flex flex-col gap-1 p-4 shadow-sm`}>
      <p className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">{value}</p>
      <p className="text-sm font-medium text-white/80">{label}</p>
      {s.metal && (
        <span className="recap-tile-pill mt-1.5 w-fit rounded-md px-2 py-1 text-[0.62rem] font-semibold text-white/90">
          LVL {s.level}/{s.total} · {METAL_LABEL[s.metal]}
        </span>
      )}
    </div>
  );
}

// --- Badges leveled up today ----------------------------------------------

function DayUnlocks({ unlocks }: { unlocks: DayDetail["unlocks"] }) {
  // Highest tier reached today per family (a family can cross two tiers in a day).
  const byFamily = new Map<string, { tierIndex: number; unlockedAt: string | Date }>();
  for (const u of unlocks) {
    const ref = TIER_BY_ID.get(u.id);
    if (!ref) continue;
    const cur = byFamily.get(ref.family.key);
    if (!cur || ref.tierIndex > cur.tierIndex) {
      byFamily.set(ref.family.key, { tierIndex: ref.tierIndex, unlockedAt: u.unlockedAt });
    }
  }
  const rows = [...byFamily.entries()]
    .map(([key, v]) => {
      const family = ACHIEVEMENTS.find((f) => f.key === key)!;
      const tier = family.tiers[v.tierIndex];
      const level = v.tierIndex + 1;
      const maxed = level === family.tiers.length;
      return { family, tier, level, maxed, metal: tierMetal(level, family.tiers.length) };
    })
    .sort((a, b) => b.level - a.level);

  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-rounded text-lg font-bold">Badges leveled up today</h2>
      <ul className="flex flex-col gap-2.5">
        {rows.map(({ family, tier, level, maxed, metal }) => (
          <li
            key={family.key}
            className="recap-panel flex items-center gap-3.5 rounded-2xl px-4 py-3"
          >
            <MetalCoin metal={metal} size={44}>
              {level}
            </MetalCoin>
            <div className="min-w-0">
              <p className="font-rounded text-base font-semibold">
                {family.icon} {family.title}
              </p>
              <p className="text-sm text-(--recap-ink-soft)">
                {tier.name}
                {metal && (
                  <>
                    {" · "}
                    {maxed ? "maxed to" : "reached"} {METAL_LABEL[metal].charAt(0)}
                    {METAL_LABEL[metal].slice(1).toLowerCase()}
                  </>
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Optional ride timeline (not in the mock, but the data's here) ---------

function DayTimeline({ rideEvents }: { rideEvents: DayDetail["rideEvents"] }) {
  if (rideEvents.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-rounded text-lg font-bold">Rides</h2>
      <ul className="flex flex-col gap-1.5">
        {rideEvents.map((r) => {
          const recap = r.metrics ? rideRecapSegments(r.metrics).join(" · ") : null;
          return (
            <li
              key={r.id}
              className="recap-panel flex items-baseline gap-3 rounded-xl px-3.5 py-2.5"
            >
              <span className="shrink-0 text-xs font-semibold tabular-nums text-(--recap-ink-soft)">
                {formatClock(r.riddenAt, r.park.timezone)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.attraction.name}</p>
                {recap && <p className="truncate text-xs text-(--recap-ink-soft)">{recap}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// --- Lifetime badges + totals ---------------------------------------------

function LifetimeBadges({
  stats,
  unlockedIds,
}: {
  stats: Stats;
  unlockedIds: ReadonlySet<string>;
}) {
  // Headliner coins with any unlock, most-ridden first (matches the mock's
  // Everest / Rise / TRON / VelociCstr row).
  const coins = HEADLINERS.map((h) => {
    const s = famStanding(h.key, unlockedIds);
    if (s.level === 0) return null;
    return { ...h, ...s, rideCount: Math.round(stats[h.key] ?? 0) };
  })
    .filter((c): c is NonNullable<typeof c> => c != null)
    .sort((a, b) => b.rideCount - a.rideCount)
    .slice(0, 4);

  const overflow = Math.max(0, unlockedIds.size - coins.length);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-rounded text-lg font-bold">Lifetime badges</h2>
      {coins.length > 0 ? (
        <div className="flex gap-4 overflow-x-auto pb-1">
          {coins.map((c) => (
            <div
              key={c.key}
              className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center"
            >
              <MetalCoin metal={c.metal} size={52}>
                {c.level}
              </MetalCoin>
              <span className="line-clamp-1 text-xs font-semibold">{c.shortName}</span>
              <span className="text-[0.65rem] text-(--recap-ink-soft)">×{c.rideCount}</span>
            </div>
          ))}
          {overflow > 0 && (
            <div className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center">
              <MetalCoin metal="muted" size={52}>
                +{overflow}
              </MetalCoin>
              <span className="text-xs font-semibold text-(--recap-ink-soft)">all</span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-(--recap-ink-soft)">
          Keep riding your favorites and they'll show up here — the more laps, the shinier the
          badge.
        </p>
      )}
    </section>
  );
}

function LifetimeTotals({ stats }: { stats: Stats }) {
  const totals: Array<{ value: string; label: string; color: string }> = [
    { value: formatBigStat(stats.steps ?? 0), label: "steps in-park", color: "#2f6fd0" },
    { value: formatBigStat(stats.rides ?? 0), label: "rides", color: "#f4685a" },
    {
      value: `${Math.round((stats.queue_seconds ?? 0) / 3600).toLocaleString("en-US")}h`,
      label: "in queues",
      color: "#e9ad1f",
    },
    { value: formatBigStat(stats.park_days ?? 0), label: "park days", color: "var(--recap-ink)" },
  ];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-rounded text-lg font-bold">Lifetime totals</h2>
      <div className="grid grid-cols-2 gap-3">
        {totals.map((t) => (
          <div key={t.label} className="recap-panel rounded-2xl px-4 py-3.5">
            <p
              className="font-rounded text-2xl font-bold tracking-tight"
              style={{ color: t.color }}
            >
              {t.value}
            </p>
            <p className="text-sm text-(--recap-ink-soft)">{t.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- Card ------------------------------------------------------------------

export function RecapCard({
  day,
  entries,
  detail,
  detailLoading,
  stats,
  unlockedIds,
  units,
  level,
  now,
}: {
  day: string;
  entries: DayEntry[];
  detail?: DayDetail;
  detailLoading?: boolean;
  stats: Stats;
  unlockedIds: ReadonlySet<string>;
  units: UnitSystem;
  level?: LevelInfo;
  /** Injectable clock (drives phase); defaults to real now. */
  now?: Date;
}) {
  const first = entries[0];
  const { phase, isToday } = resolveDayPhase(
    {
      day,
      lastSeenAt: entries.reduce<Date | string>(
        (latest, e) => (new Date(e.lastSeenAt) > new Date(latest) ? e.lastSeenAt : latest),
        first?.lastSeenAt ?? day,
      ),
      timezone: first?.park.timezone ?? "UTC",
    },
    now,
  );

  const eyebrow = phaseEyebrow(phase, isToday);
  const steps = entries.reduce((n, e) => n + e.steps, 0);
  const distanceM = entries.reduce((n, e) => n + e.distanceM, 0);
  const queueSeconds = entries.reduce((n, e) => n + e.queueSeconds, 0);
  const rides = entries.reduce((n, e) => n + e.rides, 0);
  const hops = entries.length;
  const distance = formatDistance(distanceM, units);

  return (
    <div className={SURFACE} data-phase={phase}>
      {/* Hero */}
      <div className={HERO}>
        <Sparkle className="achv-sparkle--tl" />
        <Sparkle className="achv-sparkle--br" />
        <HeroTopRow level={level} dayLabel={formatDayLabel(day)} />

        <div className="flex flex-col gap-3">
          <p className="recap-eyebrow text-xs font-bold tracking-[0.18em] uppercase">{eyebrow}</p>
          <p className="flex items-baseline gap-3 leading-none">
            <span className="recap-steps text-5xl sm:text-6xl">
              {steps > 0 ? steps.toLocaleString() : distance}
            </span>
            <span className="text-base font-medium opacity-85">
              {steps > 0 ? `steps · ${distance}` : "walked"}
            </span>
          </p>
          <ParkHopChain entries={entries} />
        </div>
      </div>

      <div className="recap-divider" />

      {/* Body */}
      <div className="recap-body flex flex-col gap-7 px-5 pt-6 pb-7 sm:px-6">
        <div className="grid grid-cols-2 gap-3">
          <StatTile
            tone="teal"
            value={rides.toLocaleString()}
            label={rides === 1 ? "ride" : "rides"}
            famKey="rider"
            unlockedIds={unlockedIds}
          />
          <StatTile
            tone="coral"
            value={formatStatValue("seconds", queueSeconds)}
            label="in queues"
            famKey="queue"
            unlockedIds={unlockedIds}
          />
          <StatTile
            tone="gold"
            value={hops.toLocaleString()}
            label={hops === 1 ? "park visited" : "park hops"}
            famKey="hopper"
            unlockedIds={unlockedIds}
          />
          <StatTile
            tone="flip"
            value={distance}
            label="distance walked"
            famKey={steps > 0 ? "stepper" : "walker"}
            unlockedIds={unlockedIds}
          />
        </div>

        {detailLoading ? (
          <Skeleton className="h-16 w-full rounded-2xl bg-black/10" />
        ) : detail ? (
          <>
            <DayUnlocks unlocks={detail.unlocks} />
            <DayTimeline rideEvents={detail.rideEvents} />
          </>
        ) : null}

        <LifetimeBadges stats={stats} unlockedIds={unlockedIds} />
        <LifetimeTotals stats={stats} />
      </div>
    </div>
  );
}

/**
 * The lifetime surface shown when there are no park days yet but the account
 * still has badges / stats (a pins-only or sensor-only user, say). Same themed
 * card — skinned to the live time of day — so their progress is never hidden
 * behind the empty state; the hero leads with the level + badge count and a
 * gentle "no park days yet" note.
 */
export function LifetimeCard({
  stats,
  unlockedIds,
  level,
  now = new Date(),
}: {
  stats: Stats;
  unlockedIds: ReadonlySet<string>;
  level: LevelInfo;
  now?: Date;
}) {
  const phase = dayPhase(now.getHours());
  const today = new Intl.DateTimeFormat("en-CA").format(now); // browser-local YYYY-MM-DD
  const badges = unlockedIds.size;
  return (
    <div className={SURFACE} data-phase={phase}>
      <div className={HERO}>
        <Sparkle className="achv-sparkle--tl" />
        <Sparkle className="achv-sparkle--br" />
        <HeroTopRow level={level} dayLabel={formatDayLabel(today)} />
        <div className="flex flex-col gap-3">
          <p className="recap-eyebrow text-xs font-bold tracking-[0.18em] uppercase">
            Your park life
          </p>
          <p className="flex items-baseline gap-3 leading-none">
            <span className="recap-steps text-5xl sm:text-6xl">{badges.toLocaleString()}</span>
            <span className="text-base font-medium opacity-85">
              {badges === 1 ? "badge earned" : "badges earned"}
            </span>
          </p>
          <p className="max-w-md text-sm font-medium opacity-85">
            No park days logged yet — visit a park with ParkFi running and your daily recaps show up
            here. Your badges and lifetime totals are below.
          </p>
        </div>
      </div>

      <div className="recap-divider" />

      <div className="recap-body flex flex-col gap-7 px-5 pt-6 pb-7 sm:px-6">
        <LifetimeBadges stats={stats} unlockedIds={unlockedIds} />
        <LifetimeTotals stats={stats} />
      </div>
    </div>
  );
}
