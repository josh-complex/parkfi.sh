"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3Icon, ExternalLinkIcon } from "lucide-react";

import { ACTION_BAR_PAGE_PAD, DetailActionBar } from "#/components/detail/action-bar.tsx";
import { Band, BandHeading } from "#/components/detail/band.tsx";
import { FactTile, TintPanel, WashPanel } from "#/components/detail/panels.tsx";
import {
  TICKET_DEFAULT_CREASE,
  Ticket,
  TicketBlock,
  TicketChip,
  TicketRow,
  TicketStatusChip,
  type TicketFact,
} from "#/components/detail/ticket.tsx";
import {
  DetailHero,
  HERO_BLEED,
  HERO_CREASE_ALIGNED,
  HERO_OVERLAY_HEADLINE,
  HERO_PAGE_PADDING,
  HERO_UNDER_NAV,
} from "#/components/detail-hero.tsx";
import { LocationMap } from "#/components/maps/location-map.tsx";
import { RideAlertButton } from "#/components/notifications/ride-alert-button.tsx";
import {
  launchHeroReturn,
  releaseHeroFlight,
  rideFlightKey,
  useHeroFlight,
} from "#/components/park-map/card-flight.ts";
import { WalkThereButton } from "#/components/park-map/walk-there-button.tsx";
import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { PaperTrail, usePaperTrail } from "#/components/records/paper-trail.tsx";
import { RemovalRequestDialog } from "#/components/removal-request-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useIsNative } from "#/hooks/use-is-native.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { formatParkName } from "#/lib/parks.ts";
import { QueueType } from "#/server/parks/codes.ts";
import { cn } from "#/lib/utils.ts";

import { showClock } from "#/lib/showtimes.ts";

import { formatPriceCents, isUniversal, paidLineInfo, paidLineProduct } from "./lightning-lane.ts";
import { LightningLaneAvailability } from "./ll-availability.tsx";
import { LightningLaneDrops } from "./ll-drops.tsx";
import { ParkCrowdCalendar } from "./park-crowd-calendar.tsx";
import { RideAnalytics } from "./ride-analytics.tsx";
import { rideTagGroups } from "./ride-tags.ts";
import { ShowtimesCard } from "./showtimes-card.tsx";
import { TodayCurve } from "./today-curve.tsx";

/** Hero status pill: plain words + a colour dot, legible over any photo. */
const STATUS_LABEL: Record<string, string> = {
  OPERATING: "Open",
  DOWN: "Temporarily down",
  REFURBISHMENT: "Refurbishment",
  CLOSED: "Closed",
  UNKNOWN: "Status unknown",
};

/** Ticket chips shown before the "+N" fold, as on the venue page (plan D5). */
const MAX_TICKET_CHIPS = 5;

/** The analytics band's anchor — the phone's "Wait history" key scrolls here. */
const HISTORY_ID = "wait-history";

type CoasterStats = {
  trackLengthM: number | null;
  topSpeedKmh: number | null;
  dropHeightM: number | null;
  maxHeightM: number | null;
  inversions: number | null;
  coasterType: string | null;
  manufacturer: string | null;
  openedYear: number | null;
};

/**
 * Published coaster facts (length/speed/drop/…) plus, for signed-in riders, the
 * personal bests recorded by the native ride sensor. Facts are public + SSR'd;
 * the "your rides" line loads client-side and only when the user has ridden it.
 *
 * The mint panel is the page's *reference* block — the same job the menu board
 * does on a venue page — so the numbers are flat tiles: they're read, not
 * pressed (plan deviation D1).
 */
function CoasterStatsPanel({ stats, attractionId }: { stats: CoasterStats; attractionId: number }) {
  const trpc = useTRPC();
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;
  const mine = useQuery({
    ...trpc.achievements.myRideStats.queryOptions({ attractionId }),
    enabled: loggedIn,
  });

  const facts: Array<{ label: string; value: string }> = [];
  if (stats.topSpeedKmh != null)
    facts.push({ label: "Top speed", value: `${Math.round(stats.topSpeedKmh)} km/h` });
  if (stats.maxHeightM != null)
    facts.push({ label: "Height", value: `${Math.round(stats.maxHeightM)} m` });
  if (stats.dropHeightM != null)
    facts.push({ label: "Drop", value: `${Math.round(stats.dropHeightM)} m` });
  if (stats.trackLengthM != null)
    facts.push({ label: "Length", value: `${Math.round(stats.trackLengthM).toLocaleString()} m` });
  if (stats.inversions != null)
    facts.push({ label: "Inversions", value: String(stats.inversions) });
  if (stats.coasterType)
    facts.push({
      label: "Type",
      value: stats.coasterType.charAt(0).toUpperCase() + stats.coasterType.slice(1),
    });
  if (stats.manufacturer) facts.push({ label: "Maker", value: stats.manufacturer });
  if (stats.openedYear != null) facts.push({ label: "Opened", value: String(stats.openedYear) });
  if (facts.length === 0) return null;

  const r = mine.data;
  const ridden = r && r.rideCount > 0;

  return (
    <TintPanel tone="mint" title="Coaster stats">
      {/* Counted off the panel, not the viewport: this sits in the page's
          narrow column, which is ~480px on a desktop and the full page width
          below `wide` — so `lg:grid-cols-4` was cutting "Bolliger & Mabillard"
          into 110px tiles on exactly the screens that had room to spare. */}
      <div className="@container/stats">
        <div className="grid grid-cols-2 gap-2 @sm/stats:grid-cols-3 @2xl/stats:grid-cols-4">
          {facts.map((f) => (
            <FactTile key={f.label} className="bg-card" label={f.label} value={f.value} />
          ))}
        </div>
      </div>
      {/* The one line here that is about *you* rather than about the ride —
          recorded by the native sensor, so it only ever appears for a signed-in
          rider who has actually been on it. */}
      {loggedIn && ridden && (
        <p className="text-[13px] text-mint-fg">
          <span className="font-bold tabular-nums">{r.rideCount}</span>{" "}
          {r.rideCount === 1 ? "ride" : "rides"} logged
          {r.bestMaxG != null && (
            <>
              {" · best "}
              <span className="font-bold tabular-nums">{r.bestMaxG.toFixed(1)} g</span>
            </>
          )}
          {r.totalDrops > 0 && (
            <>
              {" · "}
              <span className="font-bold tabular-nums">{r.totalDrops}</span>{" "}
              {r.totalDrops === 1 ? "drop" : "drops"}
            </>
          )}
          {r.lastRiddenAt && <> · last {new Date(r.lastRiddenAt).toLocaleDateString()}</>}
        </p>
      )}
    </TintPanel>
  );
}

/**
 * The ride page's identity hero: the shared `DetailHero` shell plus the ride's
 * one overlay — the headline wait block, the only number here that is a reading
 * of this minute. Shared by the loaded page and its loading state (see
 * `DetailHero` for why both render it in the same configuration).
 *
 * `titleless` + `tear` + `crease="always"` + `underNav`, as the venue and park
 * heroes are since the redesign: the photo runs up behind the desktop nav
 * capsule and the ticket's own crease is the single tear line at every width.
 *
 * Status, today's windows and Early Entry used to ride here as chips. They are
 * on the ticket now — whether this ride is running, and when, is the same kind
 * of fact as how tall you have to be for it.
 */
function RideHero({
  heroKey,
  name,
  subtitle,
  image,
  underlay,
  imageAlt,
  thumbhash,
  video,
  slides,
  waitValue,
  waitIsLive,
  flying,
  entrance,
  waitFlown,
}: {
  heroKey: string;
  name: string;
  subtitle: string | null;
  image: string | null;
  /** The hero-crop preview the flight fades to in mid-air — see `DetailHero`. */
  underlay?: string | null;
  imageAlt?: string | null;
  thumbhash?: string | null;
  video?: { url: string; poster?: string | null } | null;
  slides?: Array<{ url: string; alt: string | null }>;
  waitValue: number | null;
  waitIsLive: boolean;
  flying: boolean;
  /** Opened via a map-card flight (whether or not clones are still airborne):
   *  the overlay chips that aren't landing targets stagger in after touchdown. */
  entrance: boolean;
  /** The wait chip is one of the flight's landing targets (the card flew its
   *  own chip here), so it reveals under the dissolving clone instead. */
  waitFlown: boolean;
}) {
  return (
    <DetailHero
      heroKey={heroKey}
      name={name}
      subtitle={subtitle}
      image={image}
      underlay={underlay}
      imageAlt={imageAlt}
      thumbhash={thumbhash}
      video={video}
      slides={slides}
      flying={flying}
      entrance={entrance}
      tear
      crease="always"
      titleless
      underNav
      overlays={({ chipFx, hidden }) => {
        // The wait chip is a landing target when the card flew one; otherwise
        // it joins the entrance cascade like any other chip.
        const waitFx: { className?: string; style?: React.CSSProperties } = waitFlown
          ? { style: hidden }
          : chipFx(0);
        // The headline number. Live standby when the ride is running, otherwise
        // the 24–48h typical — never both. Rides that report neither (shows,
        // parades) get no chip at all.
        return waitValue != null ? (
          <div
            data-hero-wait
            style={waitFx.style}
            className={cn(
              "absolute flex items-center gap-2 rounded-2xl bg-black/75 px-3.5 py-2 text-white shadow-lg backdrop-blur-sm",
              HERO_OVERLAY_HEADLINE,
              waitFx.className,
            )}
          >
            {/* Tagged because the flight morphs the card pill's own number
                straight onto this one rather than crossfading past it. */}
            <span
              data-hero-wait-num
              className="text-3xl font-bold leading-none tabular-nums sm:text-4xl"
            >
              {waitValue}
            </span>
            {/* Tagged so the return flight can shed the wording while the number
                shrinks back into the marker's badge (see `launchHeroReturn`). */}
            <span
              data-hero-wait-label
              className="flex flex-col text-[10px] font-semibold uppercase leading-tight tracking-wide"
            >
              <span>min</span>
              <span className="text-white/70">{waitIsLive ? "wait now" : "typical"}</span>
            </span>
          </div>
        ) : null;
      }}
    />
  );
}

/**
 * Standalone attraction detail page, built on the ticket-stub system
 * (docs/plans/dining-redesign §4.2): a torn photo hero, the ticket carrying the
 * name, three facts and today's windows, then the page's job — when to ride —
 * in the wash panel, the ride's own reference material beside it, and its whole
 * measured history in the "Know" band at the foot.
 */
export function RideDetail({ parkSlug, rideSlug }: { parkSlug: string; rideSlug: string }) {
  const trpc = useTRPC();
  const native = useIsNative();
  const rideQ = useQuery(trpc.parks.attraction.queryOptions({ parkSlug, rideSlug }));
  const ride = rideQ.data;
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;

  // Today's hour-by-hour curve for this ride, plus five weeks of daily
  // averages for the crowd calendar — the park page's payload, scoped to one
  // attraction, so both pages draw the same two charts.
  const crowdQ = useQuery({
    ...trpc.parks.rideCrowd.queryOptions({ attractionId: ride?.id ?? 0 }),
    enabled: !!ride?.id,
  });

  // The viewer's own alert for this ride, so the page's primary key can say
  // "edit" rather than offering to create a second one. Signed-out visitors
  // never fetch it (the procedure is protected).
  const alertsQ = useQuery({ ...trpc.rideAlerts.list.queryOptions(), enabled: loggedIn });
  // `list` groups by park, so flatten before looking for this ride's alert.
  const myAlert = alertsQ.data?.parks
    .flatMap((group) => group.alerts)
    .find((a) => a.attractionId === ride?.id);

  // Linked government records (public-records plan §6.2). Fetched here, above
  // the early returns, because the ticket's chip row reads it too.
  const trailQ = usePaperTrail("attraction", ride?.id);
  // Set when this page was opened by tapping a map card: the card's own name,
  // photo and wait, plus whether its three flown clones are still in the air.
  const heroKey = rideFlightKey(parkSlug, rideSlug);
  const flight = useHeroFlight(heroKey);
  // Heading back to a map view, pop the hero down into its marker. A *layout*
  // effect, deliberately: its cleanup runs while the page is still in the DOM
  // (so the hero can be measured and cloned) but with history already pointing
  // at the destination (so the flight knows this exit is map-bound).
  React.useLayoutEffect(() => () => launchHeroReturn(heroKey), [heroKey]);
  // Drop the seed on the way out, so coming back later from somewhere that
  // isn't the map doesn't paint a stale hero from it.
  React.useEffect(() => () => releaseHeroFlight(heroKey), [heroKey]);

  // The phone layout hangs the ticket's crease on the hero's bottom edge, so
  // both boxes need the stub's top-half height — it varies with how many lines
  // the ride's name takes. The ticket measures it; the page publishes it as
  // `--crease` for the hero (height) and the ticket (pull-up) to read.
  const [crease, setCrease] = React.useState(TICKET_DEFAULT_CREASE);

  if (rideQ.isLoading) {
    return (
      /* This shell mirrors the loaded return exactly — same outer classes, the
         same crease-aligned hero box — so React reconciles the hero into the
         *same* DOM node when the query lands. The query usually resolves
         mid-flight, and a hero that remounted then would replay its image fade,
         orphan the flight's settle listeners, and replay the chips' entrance
         stagger. */
      <div
        style={{ "--crease": `${crease}px` } as React.CSSProperties}
        className={cn(PAGE_WIDTH, "flex flex-col", HERO_PAGE_PADDING)}
      >
        {/* Arriving from a map card, the hero is already known — paint it from
            the card's seed rather than a grey block, so the flown clones land
            on the real thing and the query resolving shifts nothing. */}
        {flight ? (
          <RideHero
            heroKey={heroKey}
            name={flight.seed.name}
            subtitle={flight.seed.subtitle}
            image={flight.seed.imageUrl}
            underlay={flight.seed.previewImageUrl ?? flight.seed.cardImageUrl}
            waitValue={flight.seed.waitMinutes}
            waitIsLive={flight.seed.waitMinutes != null}
            flying={flight.flying}
            entrance
            waitFlown={flight.seed.waitMinutes != null}
          />
        ) : (
          /* Same bleed, the same crease-aligned height *and* the same run up
             behind the nav as the real hero, so nothing shifts when data lands. */
          <Skeleton
            className={cn(
              HERO_BLEED,
              HERO_CREASE_ALIGNED,
              "md:h-100 md:rounded-t-none md:rounded-b-3xl",
              HERO_UNDER_NAV,
            )}
          />
        )}
        <Skeleton className="mt-[calc(var(--crease)*-1)] h-52 rounded-none md:mx-auto md:w-full md:max-w-[34rem] wide:max-w-none wide:w-[30rem]" />
      </div>
    );
  }

  if (!ride) {
    return (
      <div
        style={{ "--crease": `${crease}px` } as React.CSSProperties}
        className={cn(PAGE_WIDTH, "flex flex-col", HERO_PAGE_PADDING)}
      >
        {/* Still a hero, bare: the masthead inks itself for a photograph on this
            route (`UNDER_NAV_PAGES` in site-header-desktop), so a page that
            drops the hero entirely prints white nav links on a white page. */}
        <RideHero
          heroKey={heroKey}
          name=""
          subtitle={null}
          image={null}
          waitValue={null}
          waitIsLive={false}
          flying={false}
          entrance={false}
          waitFlown={false}
        />
        <div className="mt-6 rounded-4xl border bg-muted/30 py-16 text-center">
          <p className="text-lg font-semibold">Ride not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This attraction may no longer be listed.{" "}
            <Link to="/park/$slug" params={{ slug: parkSlug }} className="underline">
              Back to the park
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  const operatorSlug = ride.park.operatorSlug;
  const universal = isUniversal(operatorSlug);
  const ll = paidLineInfo(ride, operatorSlug);
  const llPrice = formatPriceCents(ll.priceCents, ride.lightningLane.currency);
  const lineProduct = paidLineProduct(operatorSlug);
  // Which queue the paid-line charts read: Single LL is a priced
  // PAID_RETURN_TIME queue; Multi LL and Universal's Virtual Line are plain
  // RETURN_TIME. Named once — the timeline and the drop charts must agree.
  const llQueueType = ll.kind === "Single" ? QueueType.PAID_RETURN_TIME : QueueType.RETURN_TIME;
  // Base still: the marker hero, falling back to the media collection's first
  // image slide (some rides — e.g. TRON — publish only videos + gallery).
  const firstSlideImage = ride.meta?.heroMedia?.find((s) => s.kind === "image")?.url ?? null;
  const heroImage = ride.meta?.imageHeroUrl ?? ride.meta?.imageThumbUrl ?? firstSlideImage;
  // Ambient loop (plan item 1.9, ride-level): slide 0 is the best ambient
  // asset — the normalizer orders cinemagraph → video → stills.
  const heroVideo = ride.meta?.heroMedia?.find((s) => s.kind === "video") ?? null;
  // No video: crossfade the gallery stills instead (de-duped vs the base
  // still, compared sans query — CDN timestamps churn). Plain computation —
  // this sits below the loading/not-found early returns, so no hooks here.
  const heroSlides: Array<{ url: string; alt: string | null }> = [];
  if (!heroVideo) {
    const baseKey = heroImage?.split("?")[0];
    const seen = new Set(baseKey ? [baseKey] : []);
    for (const s of ride.meta?.heroMedia ?? []) {
      if (s.kind !== "image") continue;
      const key = s.url.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      heroSlides.push({ url: s.url, alt: s.alt });
    }
  }
  const parkName = formatParkName(ride.park.name);
  // The ticket's one line of place, mirroring the venue page's "Park · Land".
  const placeLine = [parkName, ride.meta?.land].filter(Boolean).join(" · ");
  const status = ride.status ?? "UNKNOWN";

  // One wait number, not two: an operating ride shows what the line is RIGHT
  // NOW, and everything else falls back to the 24–48h typical. Rides that
  // report neither (shows, parades) get no chip at all.
  const isOpen = status === "OPERATING";
  const liveWait = isOpen ? ride.standbyWait : null;
  const waitValue = liveWait ?? ride.histStandbyWait;
  const waitIsLive = liveWait != null;
  // Universal's single-rider line, from the operator's own wait board.
  // Live-only, like the standby chip. (Express has no per-ride live wait —
  // whether the ride accepts it is the ticket's Express fact.)
  const singleRiderWait = isOpen && universal ? ride.singleRiderWait : null;

  // Today's windows, split: the Early Entry flag is a chip of its own
  // (rope-drop gold), the rest read as plain clock ranges on the stub's lower
  // half — the same block the park and venue stubs carry their hours in.
  const earlyEntry = ride.hoursToday.some((h) => h.type === "Early Entry");
  const hourRows = ride.hoursToday
    .filter((h) => h.type !== "Early Entry")
    .map((h) => ({
      label: h.type && h.type !== "Operating" ? h.type : "Today",
      range: `${showClock(h.start!, ride.park.timezone)}${
        h.end ? ` – ${showClock(h.end, ride.park.timezone)}` : ""
      }`,
    }));

  // Operator descriptors, regrouped: one age chip instead of four age labels,
  // alias forms folded together, perks split from plain descriptors.
  const { ageLabel, perks, descriptors } = rideTagGroups(ride.meta?.tags ?? []);

  // ── Ticket contents ────────────────────────────────────────────────────────
  // Exactly three facts, always filled: what decides whether you can ride, how
  // you can queue for it, and what the operator's skip-the-line product says.
  // A fact whose source publishes nothing is *dropped*, not filled with a guess
  // — an unposted height rule is not "any height" — and the fillers below top
  // the row back up from the ride's stable metadata (plan §4.9).
  //
  // The queue fact is the *first true* flag rather than a list of them: three
  // words in an eleven-character cell is a four-line cell, and the rest of the
  // flags are chips a row below.
  const queueFlags = [
    ride.meta?.singleRider === true ? "Single rider" : null,
    ride.meta?.virtualLine === true ? "Virtual line" : null,
    ride.meta?.childSwap === true ? "Child swap" : null,
  ].filter((v): v is string => !!v);
  // Universal's Express is a park-wide add-on whose per-ride eligibility the
  // operator publishes itself, so that is what this cell says there; at Disney
  // the cell is the Lightning Lane's own tier or price.
  const lineFact: TicketFact | null = universal
    ? ride.meta?.expressPass != null
      ? { label: "Express", value: ride.meta.expressPass ? "Accepted" : "Not accepted" }
      : null
    : ll.has
      ? {
          label: "Lightning Lane",
          value: llPrice ?? (ll.kind === "Multi" ? "Multi Pass" : "Offered"),
        }
      : null;
  const facts: Array<TicketFact> = [];
  if (ride.meta?.heightRequirement) {
    facts.push({ label: "Height", value: ride.meta.heightRequirement });
  }
  if (queueFlags.length > 0) {
    facts.push({
      label: "Queue",
      value: queueFlags[0]!,
      hint: queueFlags.length > 1 ? queueFlags.join(" · ") : undefined,
    });
  }
  if (lineFact) facts.push(lineFact);
  // Fillers, in order of usefulness, for a ride missing one of the above.
  const fillers: Array<TicketFact | null> = [
    ride.category ? { label: "Type", value: ride.category } : null,
    ride.coasterStats?.topSpeedKmh != null
      ? { label: "Top speed", value: `${Math.round(ride.coasterStats.topSpeedKmh)} km/h` }
      : null,
    ride.coasterStats?.openedYear != null
      ? { label: "Opened", value: String(ride.coasterStats.openedYear) }
      : null,
    // The land is a short name; the park's is on the subtitle already, so it
    // only fills a cell when there is nothing better and it fits one.
    ride.meta?.land && ride.meta.land.length <= 20
      ? { label: "Area", value: ride.meta.land }
      : null,
  ];
  for (const f of fillers) {
    if (facts.length >= 3) break;
    if (f && !facts.some((existing) => existing.label === f.label)) facts.push(f);
  }

  // Chip pool: what the ride *is* and what it offers, then its themes — capped
  // at five plus a "+N" that names the rest in its tooltip (plan D5). Deduped,
  // since Disney publishes "Single Rider Offered" as a tag while Universal
  // publishes it as a flag. Anything the facts row above already states drops
  // out at the end: the ticket must not print "Single rider" twice.
  const chipPool = [
    ...new Set(
      [
        ageLabel,
        ...queueFlags.slice(1),
        ...perks,
        // An open, non-routine building permit on the ride — a real predictor
        // of a refurbishment closure (plan §6.2). Says "permit", not
        // "construction".
        (trailQ.data?.activePermits ?? 0) > 0 ? "Open construction permit" : null,
        ...descriptors,
      ].filter((v): v is string => !!v),
    ),
  ].filter((label) => !facts.some((f) => f.value === label));
  const shownChips = chipPool.slice(0, MAX_TICKET_CHIPS);
  const foldedChips = chipPool.slice(MAX_TICKET_CHIPS);

  // The status line beside the place, the same shape the park and venue stubs
  // carry. `status` is a server fact here (not a reading of the viewer's
  // clock), so there's no hydration hazard and it renders straight away.
  const statusChip = (
    <TicketStatusChip tone={isOpen ? "open" : status === "DOWN" ? "down" : "closed"}>
      {STATUS_LABEL[status] ?? STATUS_LABEL.UNKNOWN}
    </TicketStatusChip>
  );

  // A show has no standby to curve: its job block is the clock. Everything
  // else — a ride we hold history for — gets the day.
  const isShow = ride.showtimes.length > 0;
  const hasAbout = !!ride.meta?.description || !!ride.meta?.funFact;
  const hasAccessibility = (ride.meta?.accessibility?.length ?? 0) > 0;
  // The peach panel's title takes the land only when it fits one line beside
  // the Walk-there key (the venue page's rule).
  const mapPlace =
    [ride.meta?.land, parkName].find((place) => !!place && place.length <= 20) ?? null;

  // Is there a day to draw? `TodayCurve` withholds itself under three hours —
  // a park with no posted schedule today, or a ride we have barely watched —
  // and the wide column would then open on a heading over nothing.
  const hasCurve =
    (crowdQ.data?.hours ?? []).filter((h) => h.actual != null || h.typical != null).length >= 3;

  // The page's one primary key, printed twice in two places that are never both
  // visible: inside the job block on a desktop, in the floating bar on a phone.
  // A function rather than one element, so each site sizes its own copy.
  const alertKey = (className?: string) => (
    <RideAlertButton
      attractionId={ride.id}
      attractionName={ride.name}
      alert={myAlert}
      loggedIn={loggedIn}
      variant="key"
      className={className}
    />
  );

  /** The job block's desktop footer — the same pair whichever block it is. */
  const desktopKeys = (
    <div className="hidden md:flex md:flex-wrap md:gap-2">
      {alertKey()}
      {!isShow && (
        <Button
          variant="outline"
          size="lg"
          className="font-bold"
          render={<a href={`#${HISTORY_ID}`} />}
        >
          <BarChart3Icon />
          Wait history
        </Button>
      )}
    </div>
  );

  // The stub's lower half: this ride's own printing. Its posted window today,
  // the copy the operator publishes about it, and how it seats you — all three
  // are the same kind of thing as the height rule already on the face, so they
  // ride on the ticket rather than in loose prose under it (2026-09-17, Josh).
  // Sections are ruled off from one another with the hairline the `Ticket`
  // already opens its footer with, so the stub's fine print reads as one
  // printing in several paragraphs rather than three stacked cards.
  const footerSections: Array<{ key: string; node: React.ReactNode }> = [];
  if (hourRows.length > 0) {
    footerSections.push({
      key: "today",
      node: (
        <TicketBlock title="Today" gap="tight">
          {hourRows.map((h) => (
            <TicketRow key={`${h.label}-${h.range}`} lead={h.label}>
              <span className="tabular-nums">{h.range}</span>
            </TicketRow>
          ))}
        </TicketBlock>
      ),
    });
  }
  if (hasAbout) {
    footerSections.push({
      key: "about",
      // The ride's own copy — official marketing text, never rewritten.
      node: (
        <TicketBlock title="About">
          {/* One wrapper rather than two children of the block: `TicketBlock`
              spaces a list of rows, and 6px between two paragraphs of running
              copy reads as one paragraph with a fault in it. */}
          <div className="flex flex-col gap-2.5">
            {ride.meta?.description && (
              <p className="text-[13px] leading-[1.5] text-pretty text-ink-on-yellow/85">
                {ride.meta.description}
              </p>
            )}
            {/* Universal publishes a trivia blurb per ride; Disney none. */}
            {ride.meta?.funFact && (
              <p className="text-[13px] leading-[1.5] text-pretty text-ink-on-yellow/70">
                {ride.meta.funFact}
              </p>
            )}
          </div>
        </TicketBlock>
      ),
    });
  }
  if (hasAccessibility) {
    footerSections.push({
      key: "accessibility",
      node: (
        <TicketBlock title="Accessibility" gap="tight">
          {/* Bulleted by a pseudo-element rather than `list-disc`: a marker
              inherits the list's ink at full strength, and a solid dot in
              `--ink-on-yellow` beside 85%-opacity text reads as a misprint. */}
          <ul className="flex flex-col gap-1 text-[13px] leading-[1.4] text-ink-on-yellow/85">
            {ride.meta?.accessibility?.map((a) => (
              <li
                key={a}
                className="relative pl-3.5 before:absolute before:left-1 before:top-[0.55em] before:size-1 before:rounded-full before:bg-ink-on-yellow/45"
              >
                {a}
              </li>
            ))}
          </ul>
        </TicketBlock>
      ),
    });
  }

  return (
    <div
      style={{ "--crease": `${crease}px` } as React.CSSProperties}
      className={cn(PAGE_WIDTH, "flex flex-col", HERO_PAGE_PADDING, ACTION_BAR_PAGE_PAD)}
    >
      <RideHero
        heroKey={heroKey}
        name={ride.name}
        subtitle={placeLine}
        image={heroImage}
        // Identical expression to the loading shell's, so the underlay <img>
        // keeps its src (and stays decoded) across the query landing.
        underlay={flight ? (flight.seed.previewImageUrl ?? flight.seed.cardImageUrl) : null}
        imageAlt={ride.meta?.imageAlt}
        thumbhash={ride.meta?.imageThumbhash}
        video={heroVideo}
        slides={heroSlides}
        waitValue={waitValue}
        waitIsLive={waitIsLive}
        flying={flight?.flying ?? false}
        entrance={!!flight}
        waitFlown={flight?.seed.waitMinutes != null}
      />

      {/* Three children on a two-column grid, placed explicitly (the park and
          venue pages' arrangement, over a ride's material): the ticket and the
          rest of the narrow column take rows 1 and 2 of column 1, and the wide
          column spans both rows of column 2 — so the day's curve rides up
          beside the ticket into what would otherwise be dead space under the
          hero.

          The order is chosen for the *phone*, where the grid collapses to one
          flex column: ticket, when to ride, what the ride is, then where it is.
          Two `order`s carry it, and both dissolve at `wide`. */}
      <div className="flex flex-col gap-5 wide:grid wide:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] wide:grid-rows-[auto_1fr] wide:items-start wide:gap-x-6 wide:gap-y-5 xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
        <Ticket
          onCreaseHeight={setCrease}
          // Pulled up by its own top half at every width, so the crease lands
          // on the hero's bottom edge (the hero is `crease="always"`), and
          // nudged past the column's left edge on a desktop so the stub reads
          // as laid *on* the page rather than ruled into the grid.
          className="mt-[calc(var(--crease)*-1)] md:mx-auto md:w-full md:max-w-[34rem] wide:col-start-1 wide:row-start-1 wide:-mx-4.5 wide:w-auto wide:max-w-none"
          heroKey={heroKey}
          titleHidden={flight?.flying ? { opacity: 0, visibility: "hidden" } : undefined}
          title={ride.name}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {placeLine && <span>{placeLine}</span>}
              {statusChip}
            </span>
          }
          facts={facts}
          chips={
            shownChips.length > 0 || earlyEntry ? (
              <>
                {/* The ticket's one accent chip is spent on the fact that gets
                    you on this ride an hour before everyone else. */}
                {earlyEntry && <TicketChip accent>Early Entry</TicketChip>}
                {shownChips.map((label) => (
                  <TicketChip key={label}>{label}</TicketChip>
                ))}
                {foldedChips.length > 0 && (
                  <TicketChip title={foldedChips.join(" · ")}>+{foldedChips.length}</TicketChip>
                )}
              </>
            ) : null
          }
          keys={
            ride.meta?.detailUrl || (native && ride.lightningLaneDeepLink) ? (
              <div className="grid gap-2">
                {/* Lightning Lane lives only in the MDE app — no web page to
                    fall back to — so this is native-only; web visitors have the
                    official-site key below. */}
                {native && ride.lightningLaneDeepLink && (
                  <Button
                    variant="ticket"
                    size="lg"
                    render={
                      <a href={ride.lightningLaneDeepLink} target="_blank" rel="noreferrer" />
                    }
                  >
                    <span className="truncate">Open in Disney App</span>
                    <ExternalLinkIcon />
                  </Button>
                )}
                {ride.meta?.detailUrl && (
                  <Button
                    variant="ticket"
                    size="lg"
                    render={<a href={ride.meta.detailUrl} target="_blank" rel="noreferrer" />}
                  >
                    <span className="truncate">Official site</span>
                    <ExternalLinkIcon />
                  </Button>
                )}
              </div>
            ) : null
          }
          // The stub's lower half (see `footerSections`): today's posted
          // window, the ride's own copy, and its accessibility notes.
          footer={
            footerSections.length > 0 ? (
              <>
                {footerSections.map((s, i) => (
                  <div
                    key={s.key}
                    className={i > 0 ? "border-t border-ink-on-yellow/12 pt-3.5" : undefined}
                  >
                    {s.node}
                  </div>
                ))}
              </>
            ) : null
          }
        />

        {/* THE DAY. The wide column, spanning both of the grid's rows so it runs
            up beside the ticket — the park page's live column, over one ride's
            material. It opens on the job block itself: the panel is the page's
            "Now". */}
        <div className="contents wide:col-start-2 wide:row-span-2 wide:row-start-1 wide:flex wide:flex-col wide:gap-4 wide:pt-4">
          {/* No band heading over the job block (2026-09-17, Josh): the panel
              under it already says "When to ride" and states the wait in its
              own header row, so the band was a heading about a heading — a
              kicker, a 26px title and a wait the ticket beside it was already
              carrying, spent on three lines of restatement. The panel gets the
              space. */}
          <div className="order-1 flex flex-col gap-4 wide:contents">
            {isShow ? (
              <ShowtimesCard
                showtimes={ride.showtimes}
                timeZone={ride.park.timezone}
                variant="wash"
              >
                {/* Desktop's primary key. The phone's is in the floating bar,
                    so the page carries exactly one of them at any width. */}
                {desktopKeys}
              </ShowtimesCard>
            ) : hasCurve ? (
              <TodayCurve
                crowd={crowdQ.data}
                loading={!crowdQ.data}
                title="When to ride"
                subject="this ride"
              >
                {desktopKeys}
              </TodayCurve>
            ) : (
              /* A ride whose park posts no hours today, or that we hold under
                 three hours of history for: the curve would be two sticks, but
                 the page still owes the reader a job block — the number, and
                 the key that watches it for them. */
              <WashPanel
                title="When to ride"
                meta={ride.observedAt ? "Live from the operator's board" : undefined}
              >
                <p className="text-[15px] text-wash-fg">
                  {waitValue != null
                    ? `${waitIsLive ? "Standby is" : "This ride typically runs"} about ${waitValue} minutes right now.`
                    : "This ride isn’t posting a standby wait at the moment."}{" "}
                  We haven’t measured enough of its day yet to draw the curve.
                </p>
                {desktopKeys}
              </WashPanel>
            )}

            {/* The two live readings the curve can't carry: the other queue you
                could join right now, and where the virtual one has got to. Both
                self-hide — single-rider waits are Universal-only, and boarding
                groups run on a handful of headliners. */}
            {(singleRiderWait != null ||
              ride.boardingGroup != null ||
              ride.boardingAllocation != null) && (
              <div className="@container/queues">
                <div className="grid gap-2 @sm/queues:grid-cols-2">
                  {singleRiderWait != null && (
                    <FactTile label="Single rider" value={`${singleRiderWait} min`} />
                  )}
                  {(ride.boardingGroup != null || ride.boardingAllocation != null) && (
                    <FactTile
                      label="Virtual queue"
                      value={
                        ride.boardingAllocation === "SOLD_OUT"
                          ? "All groups distributed"
                          : ride.boardingAllocation === "PAUSED"
                            ? "Distribution paused"
                            : ride.boardingGroup != null
                              ? `Now boarding ${ride.boardingGroup}${
                                  ride.boardingGroupEnd != null &&
                                  ride.boardingGroupEnd !== ride.boardingGroup
                                    ? `–${ride.boardingGroupEnd}`
                                    : ""
                                }`
                              : "Groups available"
                      }
                    />
                  )}
                </div>
              </div>
            )}

            {/* Today's paid-line timeline — how the line has been running since
                the park opened. Only for rides that actually offer it: Single
                LL is a PAID_RETURN_TIME queue, Multi LL and Universal's Virtual
                Line are RETURN_TIME. The 30-day drop pattern behind it is
                reference, so it sits in the Know band instead. */}
            {ll.has && (
              <LightningLaneAvailability
                attractionId={ride.id}
                queueType={llQueueType}
                timeZone={ride.park.timezone}
                product={lineProduct}
              />
            )}
          </div>
        </div>

        {/* The rest of the narrow column, under the ticket: what this ride *is*,
            rather than what it is doing this afternoon. Behind the day on a
            phone (`order-2`), beside it on a desktop, where `wide:contents`
            dissolves this wrapper into the column. */}
        <div className="contents wide:col-start-1 wide:row-start-2 wide:flex wide:flex-col wide:gap-5">
          <div className="order-2 flex flex-col gap-5 wide:contents">
            {/* The ride's own copy and its accessibility notes used to open
                this column; both are printed on the ticket's lower half now
                (2026-09-17, Josh), so the column starts on the reference
                block: published coaster facts, plus your own sensor-recorded
                bests when you've ridden it. */}
            {ride.coasterStats && (
              <CoasterStatsPanel stats={ride.coasterStats} attractionId={ride.id} />
            )}

            {/* The exit block: where it is, and the key that walks you there.
                Tested inline rather than through a boolean, so the coordinates
                are narrowed for the map below. */}
            {ride.latitude != null && ride.longitude != null && (
              <TintPanel
                tone="peach"
                pad="tight"
                title={mapPlace ? `Find it in ${mapPlace}` : "Find it"}
                meta={
                  <WalkThereButton
                    id={ride.id}
                    name={ride.name}
                    latitude={ride.latitude}
                    longitude={ride.longitude}
                    variant="yellow"
                    className="h-9 font-bold"
                  />
                }
              >
                <LocationMap
                  latitude={ride.latitude}
                  longitude={ride.longitude}
                  label={ride.name}
                  zoom={17}
                  caption={
                    [...new Set([ride.meta?.land, parkName].filter(Boolean))].join(", ") ||
                    undefined
                  }
                  className="h-48 w-full overflow-hidden rounded-[18px] sm:h-56 md:h-[15.5rem]"
                />
              </TintPanel>
            )}

            {/* Government records linked to this ride (permits, marks, patents,
                FAA studies). Self-hides when there are none — most Disney rides,
                whose permits sit behind CFTOD's login wall. */}
            <PaperTrail
              entityKind="attraction"
              entityId={ride.id}
              entityName={ride.name}
              parkId={ride.park.id}
            />

            {/* Cast-member-only; renders nothing for everyone else. */}
            <RemovalRequestDialog
              entityType="attraction"
              entityId={String(ride.id)}
              entityName={ride.name}
              className="w-fit"
            />
          </div>
        </div>
      </div>

      {/* ── KNOW: this ride's own history, rolled up ──

          Withheld for a show, which posts times rather than a standby wait: the
          whole band would be a heading over four empty charts. The condition is
          a server fact (does this entity publish showtimes), so it can't differ
          between the SSR'd markup and the first client render. */}
      {!isShow && (
        <Band id={HISTORY_ID} className="mt-10 scroll-mt-24 md:mt-14">
          <BandHeading
            kicker="Know"
            title="What this ride usually does"
            meta="Rolling standby history, measured every five minutes"
          />
          <ParkCrowdCalendar crowd={crowdQ.data} subject="This ride's" />
          <RideAnalytics attractionId={ride.id} timezone={ride.park.timezone} />
          {/* When the paid line sells out and comes back: the 30-day rhythm
              behind today's timeline above. Self-hides for a ride that has
              never sold out and reopened. */}
          {ll.has && (
            <LightningLaneDrops
              attractionId={ride.id}
              queueType={llQueueType}
              product={lineProduct}
            />
          )}
        </Band>
      )}

      {/* The phone's one-line answer to "what do I do here". */}
      <DetailActionBar>
        {alertKey("h-12 min-w-0 flex-1 text-[15px]")}
        {!isShow && (
          <Button
            variant="outline"
            size="lg"
            className="h-12 shrink-0 text-[15px] font-bold"
            render={<a href={`#${HISTORY_ID}`} />}
          >
            <BarChart3Icon />
            History
          </Button>
        )}
      </DetailActionBar>
    </div>
  );
}
