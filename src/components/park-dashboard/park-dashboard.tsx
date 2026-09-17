"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BellIcon, MapIcon } from "lucide-react";

import { useTRPC } from "#/integrations/trpc/react.ts";

import { ACTION_BAR_PAGE_PAD, DetailActionBar } from "#/components/detail/action-bar.tsx";
import {
  TICKET_DEFAULT_CREASE,
  Ticket,
  TicketStatusChip,
  type TicketFact,
} from "#/components/detail/ticket.tsx";
import {
  DetailHero,
  HERO_BLEED,
  HERO_CREASE_ALIGNED,
  HERO_OVERLAY_TOP_UNDER_NAV,
  HERO_PAGE_PADDING,
  HERO_UNDER_NAV,
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

import { Band, BandHeading } from "#/components/detail/band.tsx";
import { CrowdAhead } from "./crowd-ahead.tsx";
import { EatHere } from "#/components/dining/eat-here.tsx";
import { MovingNow } from "./moving-now.tsx";
import { NextShows } from "./next-shows.tsx";
import { ParkBoardTable } from "./park-board-table.tsx";
import { ParkCrowdCalendar } from "./park-crowd-calendar.tsx";
import { ParkHours, useParkHoursToday } from "./park-hours.tsx";
import { ParkNews } from "./park-news.tsx";
import { parkStats, shortRideName } from "./park-stats.ts";
import { SeasonalHouses } from "./seasonal-houses.tsx";
import { TicketPriceCard } from "./ticket-price-card.tsx";
import { TodayCurve } from "./today-curve.tsx";
import { useSelection } from "./selection-context.tsx";

// The analytics grid is chart-heavy and lives below the fold, so split it out
// of the critical park-page chunk and stream it in after the board renders.
const ParkAnalytics = lazyWithReload(
  () => import("./park-analytics.tsx").then((m) => ({ default: m.ParkAnalytics })),
  "park-analytics",
);

/** The board's anchor — the phone's "jump to the board" key scrolls here. */
const BOARD_ID = "ride-board";

/**
 * The analytics grid's shape in grey, for both of the states that stand in for
 * it: the pre-hydration render and the lazy chunk's Suspense fallback.
 *
 * Deliberately a copy of `ParkAnalytics`'s own loading grid rather than an
 * import of it — importing would pull the chart chunk back into the critical
 * bundle, which is the whole reason that module is split out. A single
 * `h-[640px]` block was the cheap version of this and it cost ~835px of jump
 * when the real grid arrived, which is the single largest shift on the page.
 */
function AnalyticsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("w-full rounded-[22px]", i >= 6 ? "h-[500px]" : "h-[309px]")}
        />
      ))}
    </div>
  );
}

/** Characters of ride name the ticket's "Longest" fact will carry — see the
 *  comment at the `facts` array. */
const LONGEST_NAME_MAX = 24;

/**
 * The park page, organised by time horizon (design direction A):
 *
 *  - **Now** — what the park is doing this minute: the ticket's headline
 *    figures, the live map, what's moving, and the whole board.
 *  - **Next / Ahead** — the left column under the ticket, in one run: the rest
 *    of today's curve, then what's *recent* about this park (our stories, the
 *    menus that moved), then which day to come instead and what it will cost.
 *    It shares the Now band's grid rather than taking bands of its own, because
 *    on a desktop it reads side by side with the live column — and the bands
 *    these cards used to live in, at the foot of the page, were reached by
 *    nobody. Today's hours and the shows still to start are on the ticket
 *    itself, being facts about this park rather than cards about it.
 *  - **Know** — everything that is reference: the rollups over this park's own
 *    history. The last band left: everything that used to follow it (hours,
 *    price, the crowd calendar, the filings) reads better in the column.
 *
 * The one structural rule the layout enforces is that standby is drawn twice,
 * not four times: once as today's curve (left) and once as the board (right).
 * Everything else about a wait is a link into it.
 */
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
  // `selection-context.tsx`) so clicking a marker highlights the board row and
  // the selection survives navigation.
  const { selected, setSelected } = useSelection();

  // We only clear a stale selection when the park changes and the previously-
  // picked ride isn't on this board.
  React.useEffect(() => {
    if (!board || !selected) return;
    const stillHere = board.some((b) => b.id === selected.id);
    if (!stillHere) setSelected(null);
  }, [board, selected, setSelected]);

  const park = parks?.find((p) => p.slug === activeSlug);
  const operatorSlug = park?.operatorSlug;
  const timezone = park?.timezone;

  // The page's headline numbers, shared by the ticket and the bands.
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

  // "Universal Orlando Resort". The stub used to stamp today's date beside it;
  // it doesn't any more (2026-09-16, Josh) — a guest standing in the park knows
  // what day it is, and the line's one slot is better spent on whether the
  // gates are open, which they can't know from the clock alone.
  const placeLine = park?.resortName ?? park?.operatorName ?? null;

  // That slot, filled: "Open til 10 PM" / "Closed · Opens 9 AM Thu". Null until
  // hydration — `openNow` is a reading of the viewer's clock, and the server
  // guessing at it would ship a wrong verdict *and* trip a mismatch. The dot
  // carries the state at a glance; the words carry the useful half of it.
  const status = (() => {
    if (hoursToday.openNow == null) return null;
    const open = hoursToday.openNow;
    const label = open
      ? hoursToday.closingLabel
        ? `Open til ${hoursToday.closingLabel}`
        : "Open now"
      : hoursToday.nextOpen
        ? `Closed · ${hoursToday.nextOpen}`
        : "Closed";
    return <TicketStatusChip tone={open ? "open" : "closed"}>{label}</TicketStatusChip>;
  })();

  // Does this park run timed entertainment today at all? Stable across
  // hydration (it reads the board, not the clock) — see the ticket's `footer`.
  const postsShowtimes = (board ?? []).some(
    (b) => b.entityType === "SHOW" && b.showtimes.length > 0,
  );

  // Exactly three facts, always (plan §4.9). "Longest" carries the ride's short
  // name beside the number; the full name rides in the cell's tooltip.
  //
  // It gets a longer leash than `shortRideName`'s 18-character default (2026-
  // 09-16, Josh): the stub's facts row now weights its cells by content, so
  // this one takes the lion's share of the width and there is room for the name
  // the 18-cap was cutting ("Buzz Lightyear's…" → "Buzz Lightyear's Space…").
  // 24 is where the second line starts to appear at the narrowest ticket.
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
          ? `${longest.standbyWait} · ${shortRideName(longest.name, LONGEST_NAME_MAX)}`
          : "—",
      hint: longest?.name ?? undefined,
    },
  ];

  return (
    // Two page containers with the event band between them, rather than one
    // container the band breaks out of: the band is full-bleed, and a
    // `100vw` breakout inside a max-width column overflows by exactly the
    // scrollbar's width (the app reserves its gutter — see `scrollbar-gutter`
    // in styles.css). A sibling section under the route's own `<main>` is
    // already the full width, with none of that arithmetic.
    <>
      <div
        style={{ "--crease": `${crease}px` } as React.CSSProperties}
        className={cn(PAGE_WIDTH, "flex flex-col", HERO_PAGE_PADDING, "pb-0 lg:pb-0")}
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
            crease="always"
            titleless
            underNav
            /* The hours chips are gone from the photo (2026-09-16, Josh): the
               ticket's own line now says whether the gates are open and until
               when, and the early-entry window is stated on the card that lists
               which rides it covers. What's left here is the one thing that is
               a *warning* rather than a schedule — a pass that won't get you
               through the turnstile today. */
            overlays={({ chipFx }) =>
              apBlockedToday ? (
                <div
                  className={cn(
                    "absolute right-4 flex max-w-[65%] flex-col items-end gap-1.5 text-right md:right-5",
                    HERO_OVERLAY_TOP_UNDER_NAV,
                  )}
                >
                  <span
                    style={chipFx(0).style}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm",
                      chipFx(0).className,
                    )}
                  >
                    Annual Pass blockout
                  </span>
                </div>
              ) : null
            }
          />
        ) : (
          /* No photo and no flight to seed one: hold the same crease-aligned box
           so the ticket's notches still land on an edge. */
          <Skeleton
            className={cn(
              HERO_BLEED,
              HERO_CREASE_ALIGNED,
              // Same box and the same corners as the real hero, or the page
              // jumps by the height of the masthead the moment `parks.list`
              // lands.
              "md:h-100 md:rounded-t-none md:rounded-b-3xl",
              HERO_UNDER_NAV,
            )}
          />
        )}

        {/* NOW + NEXT. Three children, placed explicitly on a two-column grid from
          `wide`: the ticket and the rest of the left column sit in rows 1 and 2 of
          column 1, and the live column spans both rows of column 2 — so the map
          and the board ride up beside the ticket into what would otherwise be
          dead space under the hero.

          `wide` (75rem), not `md` (2026-09-17, Josh): column 1 is a *fixed*
          30rem, so column 2 is whatever is left — 217px at `md`, and narrower
          than the ticket beside it until about 1000px. The board's row is
          160px of photo plus a 168px sparkline plus a nowrap price chip and a
          wait, ~590px before anything can shrink, so every width under 75rem
          drew it off the right edge of the page. One column below that is not
          a fallback: it hands the board 720–1130px, more than it gets in the
          two-column layout at `xl`.

          The order is chosen for the *phone*, where the grid collapses to this
          one flex column in DOM order: ticket, then what the park is doing now,
          then the rest of today — the same running order a tablet gets. On a
          desktop the placement classes put the "rest of today" panels back
          beside the live column. */}
        <div className="flex flex-col gap-5 wide:grid wide:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] wide:grid-rows-[auto_1fr] wide:items-start wide:gap-x-6 wide:gap-y-5 xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
          <Ticket
            onCreaseHeight={setCrease}
            // Pulled up by its own top half at every width, so the crease lands
            // on the hero's bottom edge (see the hero's `crease="always"`), and
            // nudged past the column's left edge on a desktop so the stub reads
            // as laid *on* the page rather than ruled into the grid.
            className="mt-[calc(var(--crease)*-1)] md:mx-auto md:w-full md:max-w-[34rem] wide:col-start-1 wide:row-start-1 wide:-mx-4.5 wide:w-auto wide:max-w-none"
            heroKey={heroKey}
            titleHidden={flight?.flying ? { opacity: 0, visibility: "hidden" } : undefined}
            title={parkName ?? flight?.seed.name ?? ""}
            subtitle={
              placeLine || status ? (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {placeLine && <span>{placeLine}</span>}
                  {status}
                </span>
              ) : undefined
            }
            facts={facts}
            // The stub's lower half: when this place is open, then what starts
            // next in it. Both are readings of *this park right now*, the same
            // as the three facts above — which is why they're on the ticket and
            // not in cards of their own further down the page.
            //
            // The showtimes half is gated on the *stable* "does this park post
            // showtimes at all today" rather than on whether any are still to
            // come: the latter is a reading of the clock, so the server and the
            // first client render would disagree about whether the block exists
            // at all, which is a structural hydration mismatch. A park that
            // posts shows and has run the last of them gets a closing line from
            // `NextShows` instead of an empty frame.
            footer={
              !hoursToday.ready || hoursToday.hasSchedule || postsShowtimes ? (
                <>
                  <ParkHours parkSlug={activeSlug ?? null} variant="ticket" />
                  {postsShowtimes && (
                    <NextShows
                      board={board}
                      parkSlug={activeSlug ?? null}
                      timezone={timezone}
                      variant="ticket"
                      // A rule between the two blocks, but only when there is
                      // something above to rule off from.
                      className={
                        !hoursToday.ready || hoursToday.hasSchedule
                          ? "border-t border-ink-on-yellow/12 pt-3"
                          : undefined
                      }
                    />
                  )}
                </>
              ) : null
            }
          />

          <div className="contents wide:col-start-2 wide:row-span-2 wide:row-start-1 wide:flex wide:flex-col wide:gap-4 wide:pt-4">
            {/* The map, bare — no panel, no band heading, no control row
              (2026-09-17, Josh). The mint panel was costing it 40-odd px of
              height on every side; "Where everyone is standing" named a map of
              the park standing right under it, which is the one thing a map
              does not need said; and the desktop's way into the full map — the
              last thing that row carried — now rides inside the map's own
              top-right corner (`FullMapButton`, traveling in the map portal)
              instead of spending a line of page height with dead space beside
              it. (The phone's way in is the floating bar.) `MapSlot` is a
              shared-layout slot: the persistent map morphs in from wherever it
              was last mounted. */}
            <MapSlot
              // No wheel zoom here: this map is a panel in a long scrolling
              // page, so a wheel over it is almost always someone scrolling
              // past — and swallowing that to zoom the basemap traps the page.
              // Drag, pinch, double-tap and the stage's zoom buttons still work.
              scrollZoom={false}
              className="relative isolate h-64 w-full overflow-hidden rounded-[22px] border border-card-edge sm:h-80 md:h-[34rem]"
            />

            {/* Desktop only (2026-09-16, Josh). On a phone it was a band of
              four chips restating four rows of the board a few hundred pixels
              below it, sitting between the map and the thing people came for —
              so it cost the board a screenful to say nothing new. */}
            <MovingNow parkSlug={activeSlug ?? null} className="hidden md:flex" />

            {/* One frame, not two (2026-09-16, Josh): the board keeps its own
              card, and the rows inside it don't have one. Thirty-five bordered
              cards inside a bordered card was three nested frames deep before
              any content — but with the outer frame gone as well, the list had
              no edge at all and stopped reading as one object beside the map.
              The padding is tighter than a normal panel's because the rows
              carry their own (see `RideRow`). */}
            <section
              id={BOARD_ID}
              className={cn(
                "flex flex-col",
                // The card is desktop-only. On a phone the column *is* the
                // page, so a frame around it is 24px of width spent drawing a
                // boundary the screen edge already draws — and the rows need
                // every pixel for a ride name, a trend and a wait.
                "md:rounded-[22px] md:border md:border-card-edge md:bg-card md:p-4",
                // Phone running order: the map, then the rest of today, then
                // the board. Only two `order`s are needed for it — this one and
                // the block below the curve — because everything else is
                // already in DOM order, and both reset at `wide`, where the two
                // columns place themselves on the grid instead.
                "order-1 wide:order-none",
              )}
            >
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
              {updatedLabel && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Every wait we track at this park. Updated {updatedLabel}.
                </p>
              )}
            </section>
          </div>

          <div className="contents wide:col-start-1 wide:row-start-2 wide:flex wide:flex-col wide:gap-5">
            {/* The curve is drawn from `crowd`, so it is loading until *that*
              lands — passing the board's flag let it render nothing in the gap
              between the two queries, and a 485px panel then appeared under
              the ticket and pushed the whole column down.

              On a phone this sits directly under the map, where "Moving now"
              used to: having looked at where everyone is standing, the next
              question is how the rest of the day goes, and the answer used to
              be thirty-five ride rows away. It is the first item here and the
              board carries `order-1`, so it lands between the map and the
              board without either of them moving in the DOM. */}
            <TodayCurve crowd={crowdQ.data} loading={loading || !crowdQ.data} />

            {/* Everything that isn't about the next few hours, in one block so
              the phone can push the lot past the board with a single `order`.
              `wide:contents` dissolves it again on a desktop, where these are
              just the rest of the left column. */}
            <div className="order-2 flex flex-col gap-5 wide:contents">
              {/* What we've written about this park, and what changed on its
                menus. Both used to sit in bands at the foot of the page, where
                nothing reached them. */}
              <ParkNews parkSlug={activeSlug ?? null} />

              <EatHere parkName={park?.name ?? null} />

              {/* AHEAD, in the column rather than in a band of its own
              (2026-09-16, Josh): what it will cost, and which day to come. The
              band's third card — hours — went to the ticket, and a two-card
              full-width band under everything else was a lot of page for the
              question "should I come back on Thursday instead". The column runs
              down beside the board anyway, so these ride for free.

              Price leads the calendar: the price bars already carry the date
              axis the calendar shades, so reading them in that order is one
              question ("when is it cheap?") followed by its check ("is it also
              quiet?") rather than two separate charts of the same two months. */}
              <TicketPriceCard parkSlug={activeSlug ?? null} operatorSlug={operatorSlug} />

              <CrowdAhead parkSlug={activeSlug ?? null} timezone={timezone} />

              {/* The government filings that name this park. Last in the column
              because it is the only card here that isn't about visiting — and
              it self-hides for a park with none. */}
              {park && (
                <PaperTrail
                  entityKind="park"
                  entityId={park.id}
                  entityName={parkName ?? park.name}
                  parkId={park.id}
                  watch={false}
                />
              )}

              <NotificationPrompt />
            </div>
          </div>
        </div>
      </div>

      {/* Hard-ticket event houses, when the park is running them — its own
          full-bleed field, so it reads as a different night rather than another
          section of this page. */}
      <SeasonalHouses board={board} parkSlug={activeSlug ?? null} className="mt-10 md:mt-14" />

      <div className={cn(PAGE_WIDTH, "flex flex-col", ACTION_BAR_PAGE_PAD)}>
        {/* ── KNOW: this park's own history, rolled up ── */}
        <Band className="mt-10 md:mt-14">
          <BandHeading
            kicker="Know"
            title="What this park usually does"
            meta="Rolling standby history, measured every five minutes"
          />
          <ParkCrowdCalendar crowd={crowdQ.data} />

          {/* A server-rendered `React.lazy` boundary whose chunk isn't ready at
            hydration tears out the server's markup and aborts hydration for the
            whole page, so keep it client-only. It isn't crawler content — the
            same numbers ship in the SSR'd board above. */}
          {hydrated ? (
            <ChartErrorBoundary
              label="analytics"
              fallback={
                <div className="flex h-[200px] w-full items-center justify-center rounded-[22px] border border-card-edge text-sm text-muted-foreground">
                  Analytics unavailable
                </div>
              }
            >
              <React.Suspense fallback={<AnalyticsSkeleton />}>
                <ParkAnalytics parkSlug={activeSlug ?? null} />
              </React.Suspense>
            </ChartErrorBoundary>
          ) : (
            <AnalyticsSkeleton />
          )}
        </Band>

        {/* Cast-member-only; renders nothing for everyone else. */}
        <RemovalRequestDialog
          entityType="park"
          entityId={activeSlug}
          entityName={park?.name}
          className="mt-8 w-fit"
        />

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
    </>
  );
}
