/**
 * The /activity day-recap hero — one park-day rendered as the night-sky card:
 * steps/distance hero, park-hop chain, stat tiles carrying lifetime badge
 * levels, "badges leveled up today", and the ride timeline. Pure presentation;
 * all data arrives via props from the activity route's queries.
 */
import type { inferRouterOutputs } from "@trpc/server";

import { Sparkle } from "#/components/achievements/achievement-toast.tsx";
import { hueForFamily, tierGradient } from "#/components/achievements/tier-badge.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import type { TRPCRouter } from "#/integrations/trpc/router.ts";
import { ACHIEVEMENTS, TIER_BY_ID, formatStatValue } from "#/lib/achievements.ts";
import { rideRecapSegments } from "#/lib/ride-recap.ts";
import { formatDistance, type UnitSystem } from "#/lib/units.ts";
import { cn } from "#/lib/utils.ts";

type ActivityOutputs = inferRouterOutputs<TRPCRouter>["activity"];
export type DayEntry = ActivityOutputs["myActivityDays"]["days"][number]["entries"][number];
export type DayDetail = ActivityOutputs["myDayDetail"];

/** "Jul 18 · Sat" from a park-local YYYY-MM-DD (rendered in UTC so the label
 *  never shifts a day for viewers in other timezones). */
export function formatDayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const md = new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(d);
  const wd = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "short" }).format(d);
  return `${md} · ${wd}`;
}

/** Park-local clock time for a timeline row, e.g. "2:14 PM". */
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

/** The day's flavor label, most distinctive flag first. */
function dayVariant(entries: DayEntry[]): string {
  if (entries.some((e) => e.nightOwl)) return "Park day · After dark";
  if (entries.some((e) => e.ropeDrop)) return "Park day · Rope drop";
  if (entries.some((e) => e.rainy)) return "Park day · Rain or shine";
  return "Park day";
}

/** Lifetime tier progress for a family: how many tiers unlocked / total. */
function familyLevel(
  famKey: string,
  unlockedIds: ReadonlySet<string>,
): { level: number; total: number } | null {
  const family = ACHIEVEMENTS.find((f) => f.key === famKey);
  if (!family) return null;
  const level = family.tiers.filter((t) => unlockedIds.has(t.id)).length;
  return { level, total: family.tiers.length };
}

/** One colored stat tile — value, label, and the linked family's lifetime
 *  badge level. Color identity comes from the family's stable hue. */
function StatTile({
  famKey,
  value,
  label,
  unlockedIds,
}: {
  famKey: string;
  value: string;
  label: string;
  unlockedIds: ReadonlySet<string>;
}) {
  const lvl = familyLevel(famKey, unlockedIds);
  return (
    <div
      className="flex flex-col gap-1 rounded-2xl p-4 text-white shadow-sm"
      style={{ backgroundImage: tierGradient(hueForFamily(famKey), 0.85) }}
    >
      <p className="text-xl font-black tracking-tight sm:text-2xl">{value}</p>
      <p className="text-xs font-medium opacity-85">{label}</p>
      {lvl && lvl.level > 0 && (
        <p className="mt-1 w-fit rounded-full bg-black/25 px-2 py-0.5 text-[0.6rem] font-bold tracking-wider uppercase">
          Lvl {lvl.level}/{lvl.total}
        </p>
      )}
    </div>
  );
}

/** "Badges leveled up today" rows — unlock ids resolved through the catalog. */
function DayUnlocks({ unlocks }: { unlocks: DayDetail["unlocks"] }) {
  const resolved = unlocks
    .map((u) => TIER_BY_ID.get(u.id))
    .filter((ref): ref is NonNullable<typeof ref> => ref != null);
  if (resolved.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-bold">Badges leveled up today</h3>
      <ul className="flex flex-col gap-2">
        {resolved.map(({ family, tier, tierIndex }) => (
          <li
            key={tier.id}
            className="activity-hero__panel flex items-center gap-3 rounded-xl px-3 py-2.5"
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-black text-white shadow-sm"
              style={{
                backgroundImage: tierGradient(
                  hueForFamily(family.key),
                  family.tiers.length > 1 ? tierIndex / (family.tiers.length - 1) : 1,
                ),
              }}
            >
              {tierIndex + 1}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {family.icon} {family.title} — {tier.name}
              </p>
              <p className="truncate text-xs opacity-75">
                {tier.description} · +{tier.xp} XP
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The ride-by-ride timeline. Dwell rides are name + time; sensor rides get
 *  their metrics recap line. Historical days predating dwell logging simply
 *  have fewer rows than the day's ride count — that's expected. */
function DayTimeline({ rideEvents }: { rideEvents: DayDetail["rideEvents"] }) {
  if (rideEvents.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-bold">Rides</h3>
      <ul className="flex flex-col gap-1.5">
        {rideEvents.map((r) => {
          const recap = r.metrics ? rideRecapSegments(r.metrics).join(" · ") : null;
          return (
            <li
              key={r.id}
              className="activity-hero__panel flex items-baseline gap-3 rounded-xl px-3 py-2"
            >
              <span className="shrink-0 text-xs font-semibold tabular-nums opacity-75">
                {formatClock(r.riddenAt, r.park.timezone)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.attraction.name}</p>
                {recap && <p className="truncate text-xs opacity-70">{recap}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DayRecapCard({
  day,
  entries,
  detail,
  detailLoading,
  unlockedIds,
  units,
}: {
  day: string;
  entries: DayEntry[];
  /** myDayDetail for this day; undefined while loading/unselected. */
  detail?: DayDetail;
  detailLoading?: boolean;
  unlockedIds: ReadonlySet<string>;
  units: UnitSystem;
}) {
  const steps = entries.reduce((n, e) => n + e.steps, 0);
  const distanceM = entries.reduce((n, e) => n + e.distanceM, 0);
  const queueSeconds = entries.reduce((n, e) => n + e.queueSeconds, 0);
  const rides = entries.reduce((n, e) => n + e.rides, 0);
  const hops = entries.length;
  const distance = formatDistance(distanceM, units);

  return (
    <div className="activity-hero flex flex-col gap-5 rounded-3xl p-5 sm:p-6">
      <Sparkle className="achv-sparkle--tl" />
      <Sparkle className="achv-sparkle--br" />

      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold tracking-widest uppercase opacity-70">
          {dayVariant(entries)}
        </p>
        <p className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold tracking-wider uppercase">
          {formatDayLabel(day)}
        </p>
      </div>

      <div>
        {steps > 0 ? (
          <p className="text-4xl font-black tracking-tight sm:text-5xl">
            {steps.toLocaleString()}
            <span className="ml-2 text-base font-medium opacity-80">steps · {distance}</span>
          </p>
        ) : (
          <p className="text-4xl font-black tracking-tight sm:text-5xl">
            {distance}
            <span className="ml-2 text-base font-medium opacity-80">walked</span>
          </p>
        )}
        {entries.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm font-medium">
            {entries.map((e, i) => (
              <span key={`${e.park.slug}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>→</span>}
                <span className="rounded-full bg-white/10 px-2.5 py-1">{e.park.name}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          famKey="rider"
          value={rides.toLocaleString()}
          label={rides === 1 ? "ride" : "rides"}
          unlockedIds={unlockedIds}
        />
        <StatTile
          famKey="queue"
          value={formatStatValue("seconds", queueSeconds)}
          label="in queues"
          unlockedIds={unlockedIds}
        />
        <StatTile
          famKey="hopper"
          value={hops.toLocaleString()}
          label={hops === 1 ? "park visited" : "parks hopped"}
          unlockedIds={unlockedIds}
        />
        <StatTile
          famKey={steps > 0 ? "stepper" : "walker"}
          value={distance}
          label="walked"
          unlockedIds={unlockedIds}
        />
      </div>

      {detailLoading ? (
        <Skeleton className={cn("h-16 w-full rounded-xl", "bg-white/10")} />
      ) : detail ? (
        <>
          <DayUnlocks unlocks={detail.unlocks} />
          <DayTimeline rideEvents={detail.rideEvents} />
        </>
      ) : null}
    </div>
  );
}
