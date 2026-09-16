"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BellIcon, MapIcon } from "lucide-react";

import { useTRPC } from "#/integrations/trpc/react.ts";
import { showClock } from "#/lib/showtimes.ts";

import { ACTION_BAR_PAGE_PAD, DetailActionBar } from "#/components/detail/action-bar.tsx";
import { SectionHeading, TintPanel } from "#/components/detail/panels.tsx";
import { TICKET_DEFAULT_CREASE, Ticket, type TicketFact } from "#/components/detail/ticket.tsx";
import {
  DetailHero,
  HERO_BLEED,
  HERO_CREASE_ALIGNED,
  HERO_OVERLAY_TOP,
  HERO_PAGE_PADDING,
} from "#/components/detail-hero.tsx";
import { MapSlot } from "#/components/park-map/map-stage.tsx";
import {
  heroFlightKey,
  launchHeroReturn,
  releaseHeroFlight,
  useHeroFlight,
} from "#/components/park-map/card-flight.ts";
import { NotificationPrompt } from "#/components/notifications/notification-prompt.tsx";
import { PaperTrail } from "#/components/records/paper-trail.tsx";
import { RemovalRequestDialog } from "#/components/removal-request-dialog.tsx";
import { ChartErrorBoundary } from "#/components/chart-error-boundary.tsx";
import { Button } from "#/components/ui/button.tsx";
import { lazyWithReload } from "#/lib/lazy-with-reload.tsx";
import { useHydrated } from "#/lib/use-hydrated.ts";

import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { formatParkName } from "#/lib/parks.ts";
import { cn } from "#/lib/utils.ts";

import { EntertainmentRail } from "./entertainment-rail.tsx";
import { ParkBoardTable } from "./park-board-table.tsx";
import { ParkCrowdCalendar } from "./park-crowd-calendar.tsx";
import { ParkHours, useParkHoursToday } from "./park-hours.tsx";
import { ParkRightNow } from "./park-right-now.tsx";
import { parkStats, shortRideName } from "./park-stats.ts";
import { ParkTicketsCta } from "./park-tickets-cta.tsx";
import { useSelection } from "./selection-context.tsx";

// visx + d3 are heavy and the chart isn't crawler content (the same numbers
// live in the SSR'd board table), so split it out of the critical park-page
// chunk and stream it in after first paint.
const ParkWaitChart = lazyWithReload(
  () => import("./park-wait-chart.tsx").then((m) => ({ default: m.ParkWaitChart })),
  "park-wait-chart",
);

// The analytics grid is chart-heavy and lives below the fold, so split it out
// of the critical park-page chunk and stream it in after the board renders.
const ParkAnalytics = lazyWithReload(
  () => import("./park-analytics.tsx").then((m) => ({ default: m.ParkAnalytics })),
  "park-analytics",
);

/** The board section's anchor — the wash panel's "All N rides" key scrolls here. */
const BOARD_ID = "ride-board";

/**
 * "Early Entry rides today" (plan item 1.4): rides whose per-entity hours carry
 * an `Early Entry` window — otherwise-unpublished rope-drop planning data.
 * Renders nothing when no ride posts one (non-Disney parks, most days until the
 * evening feed refresh).
 */
function EarlyEntryRides({
  board,
  parkSlug,
  timezone,
}: {
  board:
    | Array<{
        name: string;
        slug: string;
        hoursToday: Array<{ type: string | null; start: string | null; end: string | null }>;
      }>
    | undefined;
  parkSlug: string | null;
  timezone: string | undefined;
}) {
  const rides = (board ?? []).filter((b) =>
    (b.hoursToday ?? []).some((h) => h.type === "Early Entry"),
  );
  if (rides.length === 0 || !parkSlug) return null;
  const window = rides[0].hoursToday.find((h) => h.type === "Early Entry");
  const windowLabel =
    window?.start && timezone
      ? `${showClock(window.start, timezone)}${window.end ? ` – ${showClock(window.end, timezone)}` : ""}`
      : null;
  return (
    <div className="flex flex-col gap-2 rounded-[22px] border border-card-edge bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold tracking-tight">Early Entry rides today</h3>
        {windowLabel && <span className="text-xs text-muted-foreground">{windowLabel}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rides.map((r) => (
          <Link
            key={r.slug}
            to="/park/$slug/ride/$rideSlug"
            params={{ slug: parkSlug, rideSlug: r.slug }}
            className="rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-muted"
          >
            {r.name}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ParkDashboard({ parkSlug }: { parkSlug: string }) {
  const trpc = useTRPC();
  const parksQ = useQuery(trpc.parks.list.queryOptions());
  const parks = parksQ.data;

  const activeSlug = parkSlug;

  const boardQ = useQuery({
    ...trpc.parks.board.queryOptions({ parkSlug: activeSlug ?? "" }),
    enabled: !!activeSlug,
  });
  const board = boardQ.data;
  const loading = boardQ.isLoading || !activeSlug;

  // Today's hour-by-hour curve behind the wash panel, and the park-local date
  // the ticket is stamped with. Owned here rather than inside the panel so the
  // stub and the panel read one payload (and one round trip).
  const crowdQ = useQuery({
    ...trpc.parks.crowd.queryOptions({ parkSlug: activeSlug ?? "" }),
    enabled: !!activeSlug,
  });

  // Annual Pass blockout for today (plan item 2.4) — a WDW-only concept, so the
  // chip only ever lights up for a blocked Disney park. `days: 1` scopes the
  // fetch to today.
  const blockoutQ = useQuery(trpc.tickets.passholderBlockouts.queryOptions({ days: 1 }));
  const apBlockedToday = blockoutQ.data?.todayBlocked.some((p) => p.slug === activeSlug) ?? false;

  // Selection is shared with the persistent map in the dash layout (see
  // `selection-context.tsx`) so clicking a marker drives the chart and the
  // selection survives navigation.
  const { selected, setSelected } = useSelection();

  // Nothing is selected by default — the chart shows the busiest few series and
  // the park average on its own. We only clear a stale selection when the park
  // changes and the previously-picked ride isn't on this board.
  React.useEffect(() => {
    if (!board || !selected) return;
    const stillHere = board.some((b) => b.id === selected.id);
    if (!stillHere) setSelected(null);
  }, [board, selected, setSelected]);

  const park = parks?.find((p) => p.slug === activeSlug);
  const operatorSlug = park?.operatorSlug;
  const timezone = park?.timezone;

  // The page's headline numbers, shared by the ticket and the wash panel.
  const stats = React.useMemo(() => parkStats(board), [board]);
  const hoursToday = useParkHoursToday(activeSlug ?? null);

  // Set when this page was opened by tapping a park badge on the overview map:
  // the badge's own name and photo, plus whether its flown clones (disc face →
  // hero photo, name chip → ticket title) are still in the air. Park badges
  // never stage a card, so the seed carries no wait/status (see `parkFlightSeed`).
  const heroKey = heroFlightKey("park", parkSlug);
  const flight = useHeroFlight(heroKey);
  // Heading back to the overview map, pop the hero down into its badge — a
  // *layout* effect, so the cleanup can still measure the hero while history
  // already points at the destination (see the ride page).
  React.useLayoutEffect(() => () => launchHeroReturn(heroKey), [heroKey]);
  // Drop the seed on the way out, so coming back later from somewhere that
  // isn't the map doesn't paint a stale hero from it.
  React.useEffect(() => () => releaseHeroFlight(heroKey), [heroKey]);

  // The ticket's top half hangs over the hero's bottom edge on a phone, and its
  // height depends on how many lines the park's name takes — so the hero grows
  // by whatever the stub reports (see `Ticket` and `HERO_CREASE_ALIGNED`).
  const [crease, setCrease] = React.useState(TICKET_DEFAULT_CREASE);

  // "Updated x ago" is computed from the current clock, so the server HTML and
  // the first client render would disagree and trip a hydration mismatch. Only
  // render it once we've hydrated on the client.
  const hydrated = useHydrated();

  const updatedLabel = (() => {
    if (!hydrated || !board) return null;
    const latest = board.reduce<string | null>((m, b) => {
      if (!b.observedAt) return m;
      return !m || b.observedAt > m ? b.observedAt : m;
    }, null);
    if (!latest) return null;
    const diff = Date.now() - new Date(latest).getTime();
    const min = Math.floor(diff / 60_000);
    return min < 1 ? "just now" : min < 60 ? `${min}m ago` : `${Math.floor(min / 60)}h ago`;
  })();

  // Park hero photo (Disney finder / Universal places), if we have one.
  const heroUrl = park?.imageUrl ?? null;

  // Extra carousel stills beyond the base image (plan item 1.9): stored slides
  // de-duped against the base hero (compare sans query — CDN timestamps churn).
  const heroSlides = React.useMemo(() => {
    const baseKey = heroUrl?.split("?")[0];
    const seen = new Set(baseKey ? [baseKey] : []);
    const out: Array<{ url: string; alt: string | null }> = [];
    for (const s of park?.heroMedia ?? []) {
      const url = s.kind === "video" ? s.poster : s.url;
      if (!url) continue;
      const key = url.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url, alt: s.alt });
    }
    return out;
  }, [park?.heroMedia, heroUrl]);

  // Trim the redundant "Theme Park" / "Park" suffix the feeds tack on, so the
  // page title doesn't read as a repeat (e.g. "Animal Kingdom Theme Park").
  const parkName = park ? formatParkName(park.name) : null;

  // "Universal Orlando Resort · Sun, Sep 13". The date comes off the server's
  // park-local date rather than the viewer's clock, so it can't disagree with
  // itself across hydration — and it simply isn't there until `crowd` lands.
  const dateLabel = crowdQ.data?.date
    ? new Date(`${crowdQ.data.date}T00:00:00`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;
  const placeLine = [park?.resortName ?? park?.operatorName ?? null, dateLabel]
    .filter(Boolean)
    .join(" · ");

  // Exactly three facts, always (plan §4.9). "Longest" carries the ride's short
  // name beside the number; the full name rides in the cell's tooltip.
  const longest = stats.busiest[0] ?? null;
  const facts: Array<TicketFact> = [
    {
      label: "Rides open",
      value: loading ? "—" : `${stats.operating.length} of ${stats.rides.length}`,
    },
    { label: "Avg wait", value: stats.avgWait != null ? `${stats.avgWait} min` : "—" },
    {
      label: "Longest",
      value:
        longest?.standbyWait != null
          ? `${longest.standbyWait} · ${shortRideName(longest.name)}`
          : "—",
      hint: longest?.name ?? undefined,
    },
  ];

  return (
    <div
      style={{ "--crease": `${crease}px` } as React.CSSProperties}
      className={cn(PAGE_WIDTH, "flex flex-col", HERO_PAGE_PADDING, ACTION_BAR_PAGE_PAD)}
    >
      {/* The hero. Rendered in the same configuration whether the park's photo
          is loaded or still seeded from a map badge, so a flight lands on a real
          box and nothing remounts when `parks.list` resolves. */}
      {heroUrl || flight || parksQ.isLoading ? (
        <DetailHero
          heroKey={heroKey}
          name={parkName ?? flight?.seed.name ?? ""}
          // Carried by the ticket now — the hero is `titleless`.
          subtitle={null}
          image={heroUrl ?? flight?.seed.imageUrl ?? null}
          underlay={flight ? (flight.seed.previewImageUrl ?? flight.seed.cardImageUrl) : null}
          imageAlt={park?.imageAlt ?? parkName}
          thumbhash={park?.imageThumbhash}
          slides={heroSlides}
          flying={flight?.flying ?? false}
          entrance={!!flight}
          tear
          creaseAligned
          titleless
          overlays={({ chipFx }) => (
            <div
              className={cn(
                "absolute right-4 flex max-w-[65%] flex-col items-end gap-1.5 text-right md:right-5",
                HERO_OVERLAY_TOP,
              )}
            >
              {hoursToday.range && (
                <span
                  style={chipFx(0).style}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm",
                    chipFx(0).className,
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      hoursToday.openNow ? "bg-emerald-400" : "bg-white/60",
                    )}
                  />
                  {/* Before hydration the clock is nobody's business, so the
                      chip states the hours and adds the verdict after. */}
                  {hoursToday.openNow == null
                    ? hoursToday.range
                    : `${hoursToday.openNow ? "Open" : "Closed"} · ${hoursToday.range}`}
                </span>
              )}
              {hoursToday.earlyEntry && (
                <span
                  style={chipFx(1).style}
                  className={cn(
                    "rounded-full bg-brand-yellow px-2.5 py-1 text-[11px] font-bold text-ink-on-yellow",
                    chipFx(1).className,
                  )}
                >
                  {hoursToday.earlyEntry}
                </span>
              )}
              {apBlockedToday && (
                <span
                  style={chipFx(2).style}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm",
                    chipFx(2).className,
                  )}
                >
                  Annual Pass blockout
                </span>
              )}
            </div>
          )}
        />
      ) : (
        /* No photo and no flight to seed one: hold the same crease-aligned box
           so the ticket's notches still land on an edge. */
        <Skeleton
          className={cn(
            HERO_BLEED,
            HERO_CREASE_ALIGNED,
            "md:h-100 md:rounded-t-3xl md:rounded-b-none",
          )}
        />
      )}

      {/* Two independent columns on desktop, one stack on a phone — the columns
          never share grid rows, so the wash panel can't drift away from the
          ticket. On mobile each wrapper collapses to `contents` and its children
          become items of this one flex column, in DOM order. */}
      {/* `minmax(0, …)` on both tracks, not a bare `3fr_2fr`: a bare fraction is
          `minmax(auto, 3fr)`, so one wide child — the entertainment carousel's
          track — pushes the left column past the page and squeezes the right one
          to nothing. */}
      <div className="flex flex-col gap-5 md:-mt-12 md:grid md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-start md:gap-6">
        <div className="contents md:flex md:flex-col md:gap-6">
          <Ticket
            onCreaseHeight={setCrease}
            // Phone: pulled up by its own top half, so the crease lands on the
            // hero's bottom edge. Desktop: the grid's -48px overlap instead.
            className="mt-[calc(var(--crease)*-1)] md:mt-0"
            heroKey={heroKey}
            titleHidden={flight?.flying ? { opacity: 0, visibility: "hidden" } : undefined}
            title={parkName ?? flight?.seed.name ?? ""}
            subtitle={placeLine || undefined}
            facts={facts}
          />

          <ParkRightNow
            parkSlug={activeSlug ?? null}
            stats={stats}
            crowd={crowdQ.data}
            hours={hoursToday}
            loading={loading}
            boardId={BOARD_ID}
          />

          <EntertainmentRail board={board} parkSlug={activeSlug ?? null} timezone={timezone} />

          {/* The week ahead sits under the curve — same subject, longer horizon
              — and it's also what keeps the two columns near the same height on
              a park whose left side is otherwise a ticket and one panel. */}
          <ParkHours parkSlug={activeSlug ?? null} />
        </div>

        <div className="contents md:flex md:flex-col md:gap-6 md:pt-16">
          {/* The exit block: out to the operator's ticket store. */}
          {operatorSlug && <ParkTicketsCta operatorSlug={operatorSlug} />}

          {/* The live map, in its mint mount. `MapSlot` is a shared-layout slot:
              the persistent map morphs in from wherever it was last mounted. */}
          <TintPanel
            tone="mint"
            title="Live map"
            pad="tight"
            meta={
              <Button variant="outline" className="h-9 font-bold" render={<Link to="/map" />}>
                <MapIcon />
                Open
              </Button>
            }
          >
            <MapSlot className="relative isolate h-44 w-full overflow-hidden rounded-[18px] sm:h-56 md:h-[15.5rem]" />
          </TintPanel>

          {/* Which rides open during Early Entry today (plan item 1.4). Disney-
              only data; renders nothing elsewhere. */}
          <EarlyEntryRides board={board} parkSlug={activeSlug ?? null} timezone={timezone} />

          <NotificationPrompt />

          {/* Cast-member-only; renders nothing for everyone else. */}
          <RemovalRequestDialog
            entityType="park"
            entityId={activeSlug}
            entityName={park?.name}
            className="w-fit"
          />
        </div>
      </div>

      <section id={BOARD_ID} className="mt-8 flex flex-col gap-4 md:mt-12 md:gap-6">
        <SectionHeading
          title="Today at the park"
          description={
            updatedLabel
              ? `Every wait we're tracking, and how the day has run. Updated ${updatedLabel}.`
              : "Every wait we're tracking, and how the day has run."
          }
        />

        {/* The chart is a `React.lazy` boundary that DOES server-render (React
            ships the resolved subtree), but its chunk isn't loaded yet when the
            client hydrates — so the client falls back to this skeleton, the
            server's chart markup is torn out, and the resulting `removeChild`
            throw aborts hydration of the whole page. Render the skeleton on the
            server AND the first client render (gate on `hydrated`); the lazy
            chart then mounts cleanly after hydration. It isn't crawler content
            — the same numbers ship in the SSR'd board table below. */}
        {hydrated ? (
          <ChartErrorBoundary
            label="wait-chart"
            fallback={
              <div className="flex h-[320px] w-full items-center justify-center rounded-[22px] border border-card-edge text-sm text-muted-foreground">
                Chart unavailable
              </div>
            }
          >
            <React.Suspense fallback={<Skeleton className="h-[320px] w-full rounded-[22px]" />}>
              <ParkWaitChart
                parkSlug={activeSlug ?? null}
                focusedId={selected?.id ?? null}
                onClearFocus={() => setSelected(null)}
                operatorSlug={operatorSlug}
              />
            </React.Suspense>
          </ChartErrorBoundary>
        ) : (
          <Skeleton className="h-[320px] w-full rounded-[22px]" />
        )}

        <div className="rounded-[22px] border border-card-edge bg-card p-4 md:p-5">
          <ParkBoardTable
            board={board}
            loading={loading}
            parkSlug={activeSlug ?? null}
            selectedId={selected?.id ?? null}
            onSelect={(item) => setSelected({ id: item.id, name: item.name })}
            operatorSlug={operatorSlug}
            timezone={timezone}
            // The page already floats its own action bar over the nav island;
            // the board's usual sort/filter FAB would land on top of it.
            controls="inline"
          />
        </div>
      </section>

      <section className="mt-8 flex flex-col gap-4 md:mt-12 md:gap-6">
        <SectionHeading
          title="Crowd calendar"
          description="Which days this park rewards, and which ones it punishes."
        />
        <ParkCrowdCalendar crowd={crowdQ.data} />
      </section>

      {/* The deeper rollups keep their own heading, so this section adds none. */}
      <section className="mt-8 flex flex-col gap-4 md:mt-12 md:gap-6">
        {/* Same hazard as the chart above: a server-rendered `React.lazy`
            boundary whose chunk isn't ready at hydration. Keep it client-only. */}
        {hydrated ? (
          <ChartErrorBoundary
            label="analytics"
            fallback={
              <div className="flex h-[200px] w-full items-center justify-center rounded-[22px] border border-card-edge text-sm text-muted-foreground">
                Analytics unavailable
              </div>
            }
          >
            <React.Suspense fallback={<Skeleton className="h-[640px] w-full rounded-[22px]" />}>
              <ParkAnalytics parkSlug={activeSlug ?? null} />
            </React.Suspense>
          </ChartErrorBoundary>
        ) : (
          <Skeleton className="h-[640px] w-full rounded-[22px]" />
        )}
      </section>

      {/* Government filings that name this park (public-records plan §6.2):
          kind mix over the last year, the latest few, open permits and FAA
          determinations. Self-hides for parks with no linked records. */}
      {park && (
        <div className="mt-8 md:mt-12">
          <PaperTrail
            entityKind="park"
            entityId={park.id}
            entityName={parkName ?? park.name}
            parkId={park.id}
            watch={false}
          />
        </div>
      )}

      {/* The phone's one-line answer to "what do I do here". */}
      <DetailActionBar>
        <Button
          variant="yellow"
          size="lg"
          className="h-12 min-w-0 flex-1 text-[15px] font-bold"
          render={<Link to="/map" />}
        >
          <MapIcon />
          Open live map
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="h-12 shrink-0 text-[15px] font-bold"
          render={<Link to="/alerts" />}
        >
          <BellIcon />
          Alerts
        </Button>
      </DetailActionBar>
    </div>
  );
}
