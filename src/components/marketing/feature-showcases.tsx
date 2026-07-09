"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, BellRing, CalendarDays, Minus, Zap } from "lucide-react";

import { AchievementCard, LevelUpCard } from "#/components/achievements/achievement-toast.tsx";
import { LevelDetails } from "#/components/achievements/level-badge.tsx";
import { parkNowMinutes, type ScheduleEntry } from "#/components/dining/dining-hours.ts";
import { PickCard, type PickVenue } from "#/components/dining/dining-picks.tsx";
import { Sway } from "#/components/marketing/marketing-motion.tsx";
import { Sparkline } from "#/components/park-dashboard/sparkline.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { ACHIEVEMENTS, levelForXp, xpForLevel } from "#/lib/achievements.ts";
import { cn } from "#/lib/utils.ts";

/**
 * The crisp foreground "product props" for the welcome page. Where we can, these
 * pull **real, live data** through the same tRPC queries the app uses (dining
 * photos & availability, ticket prices) and render the actual app components
 * (PickCard, Sparkline, AchievementCard, LevelUpCard, LevelDetails, LevelBadge).
 * The few illustrative pieces use deterministic sample data so they render
 * identically on server and client (no `Math.random`/`Date.now`). Ambient motion
 * lives behind these, never on them.
 */

type Trend = "up" | "down" | "flat";

function trendTone(trend: Trend): string {
  return trend === "up"
    ? "text-red-600 dark:text-red-400"
    : trend === "down"
      ? "text-emerald-500 dark:text-emerald-400"
      : "text-muted-foreground";
}

/** The wait chip used on the live board — number + trend arrow + delta. */
function TrendChip({ wait, trend, delta }: { wait: number; trend: Trend; delta: number }) {
  const Arrow = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "flex items-center gap-1 font-mono text-sm font-semibold tabular-nums",
        trendTone(trend),
      )}
    >
      {wait}m
      <Arrow className="size-3.5" aria-hidden />
      {delta !== 0 && <span className="text-xs">{Math.abs(delta)}</span>}
    </span>
  );
}

const LiveDot = () => (
  <span className="relative flex size-2" aria-hidden>
    <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
    <span className="relative inline-flex size-2 rounded-full bg-primary" />
  </span>
);

/* ── Live wait board (hero prop) ──────────────────────────────────────────── */

const WAIT_ROWS: ReadonlyArray<{
  name: string;
  park: string;
  wait: number;
  trend: Trend;
  delta: number;
  data: Array<number | null>;
}> = [
  {
    name: "Guardians of the Galaxy: Cosmic Rewind",
    park: "EPCOT",
    wait: 95,
    trend: "up",
    delta: 10,
    data: [40, 45, 50, 55, 60, 65, 70, 68, 72, 75, 80, 85, 90, 88, 92, 95],
  },
  {
    name: "Remy's Ratatouille Adventure",
    park: "EPCOT",
    wait: 45,
    trend: "down",
    delta: 15,
    data: [70, 68, 65, 60, 58, 55, null, null, 52, 50, 48, 46, 45, 44, 45, 45],
  },
  {
    name: "Test Track",
    park: "EPCOT",
    wait: 60,
    trend: "flat",
    delta: 0,
    data: [55, 58, 60, 62, 60, 61, 60, 59, 60, 62, 61, 60, 60, 61, 60, 60],
  },
  {
    name: "Frozen Ever After",
    park: "EPCOT",
    wait: 70,
    trend: "up",
    delta: 5,
    data: [50, 52, 55, 58, 60, 62, 64, 66, 68, 66, 68, 70, 69, 70, 70, 70],
  },
];

export function WaitBoardShowcase({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "w-full max-w-md rounded-3xl border border-border bg-card p-4 shadow-lg shadow-primary/5 sm:p-5",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LiveDot />
          <span className="font-heading text-sm font-bold tracking-tight">EPCOT · Live waits</span>
        </div>
        <span className="text-xs text-muted-foreground">Updated just now</span>
      </div>
      <div className="mt-2 divide-y divide-border/70">
        {WAIT_ROWS.map((r) => (
          <div key={r.name} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.name}</p>
              <p className="text-xs text-muted-foreground">{r.park}</p>
            </div>
            <Sparkline data={r.data} className="hidden shrink-0 sm:block" />
            <div className="w-12 text-right">
              <TrendChip wait={r.wait} trend={r.trend} delta={r.delta} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Live map pins (dark — rides only) ────────────────────────────────────── */

const MAP_PINS: ReadonlyArray<{
  emoji: string;
  wait: number;
  top: string;
  left: string;
  trend: Trend;
}> = [
  { emoji: "🏰", wait: 55, top: "20%", left: "26%", trend: "up" },
  { emoji: "🚀", wait: 95, top: "32%", left: "64%", trend: "up" },
  { emoji: "🎢", wait: 35, top: "58%", left: "40%", trend: "down" },
  { emoji: "🐘", wait: 20, top: "70%", left: "70%", trend: "flat" },
  { emoji: "⛰️", wait: 65, top: "44%", left: "20%", trend: "up" },
];

/** Interim stylized Magic Kingdom map (rides only) on a dark surface. */
export function MapPinsShowcase({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden rounded-3xl border border-white/10 bg-white/5",
        className,
      )}
    >
      <svg
        aria-hidden
        className="absolute inset-0 size-full text-white/10"
        viewBox="0 0 400 300"
        preserveAspectRatio="xMidYMid slice"
      >
        <path
          d="M40 0 V300 M120 0 V300 M210 0 V300 M300 0 V300 M360 0 V300 M0 50 H400 M0 130 H400 M0 210 H400 M0 270 H400"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
        <path
          d="M-20 40 L180 180 L440 120"
          stroke="currentColor"
          strokeWidth="6"
          fill="none"
          opacity="0.6"
        />
      </svg>

      {MAP_PINS.map((p) => (
        <div
          key={p.emoji}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ top: p.top, left: p.left }}
        >
          <span className="relative grid size-10 place-items-center rounded-full border-2 border-primary bg-card text-lg shadow-md">
            {p.emoji}
            <span
              className={cn(
                "absolute -top-2 -right-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white shadow",
                p.trend === "up"
                  ? "bg-red-500"
                  : p.trend === "down"
                    ? "bg-emerald-500"
                    : "bg-primary",
              )}
            >
              {p.wait}
            </span>
          </span>
        </div>
      ))}

      <div className="absolute bottom-3 left-3 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white shadow-sm backdrop-blur">
        Magic Kingdom · 33 rides open
      </div>
    </div>
  );
}

/**
 * Real static screenshot of the live map zoomed to Magic Kingdom (rides only).
 * Drop the export at `public/img/marketing/magic-kingdom-map.webp`. Until that
 * file exists (or if it fails to load), we fall back to the stylized map above,
 * so the spotlight is never broken.
 */
export function MapScreenshotShowcase({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <MapPinsShowcase className={className} />;
  return (
    <img
      src="/img/marketing/magic-kingdom-map.webp"
      alt="ParkFi live map zoomed to Magic Kingdom, showing ride wait times"
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("w-full rounded-3xl border border-white/10 shadow-2xl", className)}
    />
  );
}

/* ── Lightning Lane ───────────────────────────────────────────────────────── */

const LL_SLOTS: ReadonlyArray<{ time: string; state: "gone" | "next" | "open" }> = [
  { time: "10a", state: "gone" },
  { time: "12p", state: "gone" },
  { time: "2p", state: "next" },
  { time: "4p", state: "open" },
  { time: "6p", state: "open" },
  { time: "8p", state: "open" },
];

export function LightningLaneShowcase({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-lg shadow-primary/5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Zap className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">Space Mountain</p>
          <p className="text-xs text-muted-foreground">Lightning Lane · Magic Kingdom</p>
        </div>
        <span className="ml-auto rounded-full bg-primary/10 px-2.5 py-1 font-mono text-xs font-semibold text-primary tabular-nums">
          $16
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-1.5">
        {LL_SLOTS.map((s) => (
          <div key={s.time} className="flex flex-1 flex-col items-center gap-1.5">
            <span
              className={cn(
                "h-8 w-full rounded-md",
                s.state === "gone" && "bg-muted",
                s.state === "next" && "bg-primary",
                s.state === "open" && "bg-primary/25",
              )}
            />
            <span className="text-[10px] text-muted-foreground tabular-nums">{s.time}</span>
          </div>
        ))}
      </div>

      <p className="mt-4 flex items-center gap-2 text-sm">
        <span className="font-semibold text-primary">Next return 2:40 PM</span>
        <span className="text-muted-foreground">· 4 windows left today</span>
      </p>
    </div>
  );
}

/* ── Dining reservation cards (REAL data) ─────────────────────────────────── */

/** "YYYY-MM-DD" → "Today" / "Tomorrow" / "Jun 21" relative to today. */
function formatNextAvail(date: string, referenceDate: string): string {
  const ref = new Date(`${referenceDate}T00:00:00`);
  const d = new Date(`${date}T00:00:00`);
  const dayDiff = Math.round((d.getTime() - ref.getTime()) / 86_400_000);
  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Two real, currently-operating restaurants pulled from the same curated
 * `dining.picks` catalog the app uses — real photos, real price tiers, real
 * open status, and the real soonest-availability date. Curated picks exclude
 * permanently-closed venues, and we only surface venues that carry a photo.
 */
export function DiningShowcase({ className }: { className?: string }) {
  const trpc = useTRPC();
  const picksQ = useQuery(trpc.dining.picks.queryOptions());
  const availabilityQ = useQuery(trpc.dining.availability.queryOptions({ partySize: 2, days: 30 }));
  const hoursQ = useQuery(trpc.dining.hours.queryOptions({}));

  const referenceDate = new Date().toISOString().slice(0, 10);
  const nextAvail = new Map<string, string>();
  for (const entry of availabilityQ.data ?? []) {
    const day = entry.days.find((d) => d.available);
    if (day) nextAvail.set(entry.facilityId, formatNextAvail(day.date, referenceDate));
  }
  const hoursMap = new Map<string, Array<ScheduleEntry>>();
  for (const entry of hoursQ.data ?? []) hoursMap.set(entry.facilityId, entry.schedules);
  const nowMin = parkNowMinutes();

  // First two distinct venues (with a photo) across the curated shelves.
  const venues: Array<PickVenue> = [];
  const seen = new Set<string>();
  for (const shelf of picksQ.data ?? []) {
    for (const v of shelf.venues) {
      if (!v.imageUrl || seen.has(v.facilityId)) continue;
      seen.add(v.facilityId);
      venues.push(v);
      if (venues.length === 2) break;
    }
    if (venues.length === 2) break;
  }

  if (picksQ.isLoading || venues.length < 2) {
    return (
      <div className={cn("grid w-full max-w-md grid-cols-2 gap-4", className)}>
        <Skeleton className="aspect-[3/4] rounded-2xl" />
        <Skeleton className="aspect-[3/4] rounded-2xl" />
      </div>
    );
  }

  return (
    <div className={cn("grid w-full max-w-md grid-cols-2 gap-4", className)}>
      {venues.map((v) => (
        <PickCard
          key={v.facilityId}
          venue={v}
          nextAvail={nextAvail.get(v.facilityId)}
          schedules={hoursMap.get(v.facilityId)}
          nowMin={nowMin}
        />
      ))}
    </div>
  );
}

/* ── Stay / resort alert ──────────────────────────────────────────────────── */

export function StayAlertShowcase({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-lg shadow-primary/5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-2xl bg-primary/10 text-primary">
          <BellRing className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-bold">Disney&rsquo;s Animal Kingdom Lodge</p>
          <p className="text-xs text-muted-foreground">Email me when…</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <span className="rounded-full bg-primary px-3 py-1.5 text-center text-xs font-semibold text-primary-foreground">
          A room opens
        </span>
        <span className="rounded-full border border-border px-3 py-1.5 text-center text-xs font-semibold text-muted-foreground">
          Price drops
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-2xl bg-muted/60 px-3 py-2.5">
        <span className="text-sm">Only under $450 / night</span>
        <span className="relative h-5 w-9 rounded-full bg-primary">
          <span className="absolute top-0.5 right-0.5 size-4 rounded-full bg-white shadow" />
        </span>
      </div>

      <Button className="mt-4 h-10 w-full text-sm">Set alert</Button>
    </div>
  );
}

/* ── Ticket price calendar (REAL data) ────────────────────────────────────── */

const TIER_BG = ["bg-emerald-500", "bg-sky-500", "bg-amber-500", "bg-red-500"] as const;

export function TicketDuoShowcase({ className }: { className?: string }) {
  const trpc = useTRPC();
  const q = useQuery(
    trpc.tickets.priceCalendar.queryOptions({ resort: "WDW", days: 120, pastDays: 0 }),
  );

  const days = (q.data?.days ?? []).filter((d) => d.available && d.priceCents > 0).slice(0, 35);

  if (q.isLoading || days.length < 7) {
    return (
      <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
        <Skeleton className="h-56 rounded-3xl" />
        <Skeleton className="h-56 rounded-3xl" />
      </div>
    );
  }

  const prices = days.map((d) => d.priceCents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const cheapest = Math.round(min / 100);
  const peak = Math.round(max / 100);
  const savings = peak - cheapest;
  const cheapestIdx = prices.indexOf(min);
  const tierOf = (cents: number) =>
    max === min ? 0 : Math.min(3, Math.floor(((cents - min) / (max - min)) * 4));
  const lead = new Date(`${days[0].date}T00:00:00`).getDay();
  const trend = prices.slice(0, 14).map((c) => c / 100);

  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      {/* Calendar */}
      <div className="rounded-3xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-2 truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {q.data?.productLabel ?? "1-Day base"}
        </p>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: lead }).map((_, i) => (
            <span key={`b${i}`} />
          ))}
          {days.map((d, i) => (
            <span
              key={d.date}
              className={cn(
                "grid aspect-square place-items-center rounded-md text-[10px] font-semibold text-white tabular-nums",
                TIER_BG[tierOf(d.priceCents)],
                i === cheapestIdx && "ring-2 ring-emerald-300 ring-offset-1 ring-offset-card",
              )}
            >
              {new Date(`${d.date}T00:00:00`).getDate()}
            </span>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-emerald-500" />
            Low
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-amber-500" />
            Mid
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-red-500" />
            Peak
          </span>
        </div>
      </div>

      {/* Savings callout */}
      <div className="flex flex-col justify-center rounded-3xl border border-border bg-card p-5 shadow-sm">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Cheapest day ahead
        </p>
        <p className="mt-1 font-heading text-4xl font-bold text-primary tabular-nums">
          ${cheapest}
        </p>
        <Sparkline data={trend} width={180} height={40} className="mt-3 w-full" />
        {savings > 0 && (
          <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <CalendarDays className="size-3.5" aria-hidden />
            Save ${savings} vs. peak dates
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Achievements (centerpiece) ───────────────────────────────────────────── */

const ROPEDROP_FAMILY = ACHIEVEMENTS.find((f) => f.key === "ropedrop");
// Level 12 with a bit of progress into the next level.
const SAMPLE_LEVEL = levelForXp(xpForLevel(12) + 520);

/** The gold level panel — level, title, and XP-to-next progress. Sits between
 *  the eyebrow and title in the achievements spotlight (where the user chip used
 *  to be). */
export function AchievementLevelPanel({ className }: { className?: string }) {
  return <LevelDetails level={SAMPLE_LEVEL} className={cn("w-full max-w-md", className)} />;
}

export function AchievementsShowcase({ className }: { className?: string }) {
  return (
    <div className={cn("flex w-full max-w-sm flex-col gap-3", className)}>
      <Sway duration={4.4}>
        <LevelUpCard level={SAMPLE_LEVEL} />
      </Sway>
      {ROPEDROP_FAMILY && (
        <Sway duration={3.8} delay={0.6}>
          <AchievementCard entry={{ family: ROPEDROP_FAMILY, tier: ROPEDROP_FAMILY.tiers[0] }} />
        </Sway>
      )}
    </div>
  );
}

/* ── Crowd predictions ────────────────────────────────────────────────────── */

const FORECAST: ReadonlyArray<{ day: string; level: number; today?: boolean }> = [
  { day: "Mon", level: 2, today: true },
  { day: "Tue", level: 1 },
  { day: "Wed", level: 1 },
  { day: "Thu", level: 3 },
  { day: "Fri", level: 4 },
  { day: "Sat", level: 4 },
  { day: "Sun", level: 3 },
];
const FORECAST_BG = [
  "bg-emerald-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-orange-500",
  "bg-red-500",
];

export function PredictionShowcase({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-lg shadow-primary/5",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-heading text-sm font-bold tracking-tight">
          🔮 7-day crowd forecast
        </span>
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
          Best: Tue
        </span>
      </div>
      {/* Fixed-rem bar heights — percentage heights collapse inside an
          `items-end` flex column (the column isn't stretched, so there's no
          definite height to resolve against). */}
      <div className="mt-4 flex h-32 justify-between gap-2">
        {FORECAST.map((f) => (
          <div key={f.day} className="flex flex-1 flex-col items-center justify-end gap-1.5">
            <span
              className={cn("w-full rounded-t-md", FORECAST_BG[f.level])}
              style={{ height: `${f.level * 1.5}rem` }}
            />
            <span
              className={cn(
                "text-[10px] tabular-nums",
                f.today ? "font-bold text-foreground" : "text-muted-foreground",
              )}
            >
              {f.day}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        This week runs{" "}
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">below average</span>{" "}
        — rope-drop Tuesday.
      </p>
    </div>
  );
}

/* ── Daily park news ──────────────────────────────────────────────────────── */

const NEWS: ReadonlyArray<{ tag: string; title: string; ago: string; emoji: string }> = [
  {
    tag: "Ride update",
    title: "TRON Lightcycle Run adds a standby queue for the first time",
    ago: "2h ago",
    emoji: "🏍️",
  },
  {
    tag: "Closure",
    title: "Spaceship Earth down for refurb — here's what it means for your day",
    ago: "5h ago",
    emoji: "🌐",
  },
  {
    tag: "Crowds",
    title: "Epic Universe running 31-min averages after the morning surge",
    ago: "8h ago",
    emoji: "🌋",
  },
];

export function NewsShowcase({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "w-full max-w-md divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-lg shadow-primary/5",
        className,
      )}
    >
      {NEWS.map((n) => (
        <div key={n.title} className="flex items-center gap-3 p-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-xl">
            {n.emoji}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {n.tag}
              </span>
              <span className="text-[10px] text-muted-foreground">{n.ago}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug">{n.title}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Pins ─────────────────────────────────────────────────────────────────── */

const PINS: ReadonlyArray<{ emoji: string; gradient: string; trade?: boolean }> = [
  { emoji: "🏰", gradient: "from-fuchsia-500 to-purple-700" },
  { emoji: "🎃", gradient: "from-orange-500 to-amber-700", trade: true },
  { emoji: "❄️", gradient: "from-sky-400 to-blue-700" },
  { emoji: "🚀", gradient: "from-slate-500 to-slate-800" },
  { emoji: "🐭", gradient: "from-rose-500 to-red-700", trade: true },
  { emoji: "⭐", gradient: "from-yellow-400 to-amber-600" },
];

export function PinsShowcase({ className }: { className?: string }) {
  return (
    <div className={cn("grid w-full max-w-sm grid-cols-3 gap-3", className)}>
      {PINS.map((p, i) => (
        <div
          key={i}
          className="relative grid aspect-square place-items-center rounded-2xl border border-border bg-card shadow-sm"
        >
          <span
            className={cn(
              "grid size-12 place-items-center rounded-full bg-gradient-to-br text-2xl shadow-inner",
              p.gradient,
            )}
          >
            {p.emoji}
          </span>
          {p.trade && (
            <span className="absolute top-1.5 right-1.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
              Trade
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
