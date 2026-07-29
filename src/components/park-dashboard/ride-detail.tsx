"use client";

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, type CSSProperties } from "react";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";

import { AmbientHeroVideo, HeroCrossfade } from "#/components/hero-media.tsx";
import {
  launchRideReturn,
  releaseRideFlight,
  rideFlightKey,
  useRideFlight,
} from "#/components/park-map/card-flight.ts";
import { getLastMapView } from "#/components/park-map/map-stage.tsx";
import { WalkThereButton } from "#/components/park-map/walk-there-button.tsx";
import { RemovalRequestDialog } from "#/components/removal-request-dialog.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Image } from "#/components/ui/image.tsx";
import { disneyResizeUrl, HERO_IMAGE } from "#/lib/image.ts";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useIsNative } from "#/hooks/use-is-native.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { QueueType } from "#/server/parks/codes.ts";
import { cn } from "#/lib/utils.ts";

import { showClock } from "#/lib/showtimes.ts";

import { formatPriceCents, isUniversal, paidLineInfo, paidLineProduct } from "./lightning-lane.ts";
import { LightningLaneAvailability } from "./ll-availability.tsx";
import { LightningLaneDrops } from "./ll-drops.tsx";
import { RideAnalytics } from "./ride-analytics.tsx";
import { rideTagGroups } from "./ride-tags.ts";
import { ShowtimesCard } from "./showtimes-card.tsx";

/** Hero status pill: plain words + a colour dot, legible over any photo. */
const STATUS_LABEL: Record<string, string> = {
  OPERATING: "Open",
  DOWN: "Temporarily down",
  REFURBISHMENT: "Refurbishment",
  CLOSED: "Closed",
  UNKNOWN: "Status unknown",
};

const STATUS_DOT: Record<string, string> = {
  OPERATING: "bg-emerald-400",
  DOWN: "bg-red-400",
  REFURBISHMENT: "bg-amber-400",
  CLOSED: "bg-white/60",
  UNKNOWN: "bg-white/40",
};

/**
 * Mobile full-bleed hero: the photo runs to the device's top and side edges,
 * under the floating search header. The upward pull is exactly the header's
 * locked height (`--safe-top + --app-header-h` — see SiteHeader) plus this
 * page's own `pt-2`, so it provably reaches the top edge on every device; the
 * box grows by the identical amount so the photo *below* the header keeps its
 * designed height. Gated on `md` (not `sm`), because the floating header mounts
 * below 768px. Desktop keeps the rounded card nested in the content column.
 */
const HERO_BLEED = [
  // The width must be stated, not implied: negative margins only *shift* a
  // `w-full` box (it stays pinned to the container's content width and hangs off
  // one side), so the box has to claim the gutters back explicitly.
  "-mx-4 w-[calc(100%_+_2rem)] md:mx-0 md:w-full",
  "-mt-[calc(var(--safe-top)_+_var(--app-header-h)_+_0.5rem)] rounded-none",
  "h-[calc(16rem_+_var(--safe-top)_+_var(--app-header-h)_+_0.5rem)]",
  "sm:h-[calc(20rem_+_var(--safe-top)_+_var(--app-header-h)_+_0.5rem)]",
  "md:mt-0 md:h-80 md:rounded-2xl",
].join(" ");

/** Top-pinned hero overlays, dropped clear of the floating search pill. */
const HERO_OVERLAY_TOP = "top-[calc(var(--safe-top)_+_var(--app-header-h))] md:top-4";

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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-base font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Published coaster facts (length/speed/drop/…) plus, for signed-in riders, the
 * personal bests recorded by the native ride sensor. Facts are public + SSR'd;
 * the "your rides" line loads client-side and only when the user has ridden it.
 */
function CoasterStatsCard({ stats, attractionId }: { stats: CoasterStats; attractionId: number }) {
  const trpc = useTRPC();
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;
  const mine = useQuery({
    ...trpc.achievements.myRideStats.queryOptions({ attractionId }),
    enabled: loggedIn,
  });

  const facts: Array<{ label: string; value: string }> = [];
  if (stats.trackLengthM != null)
    facts.push({ label: "Length", value: `${Math.round(stats.trackLengthM).toLocaleString()} m` });
  if (stats.topSpeedKmh != null)
    facts.push({ label: "Top speed", value: `${Math.round(stats.topSpeedKmh)} km/h` });
  if (stats.dropHeightM != null)
    facts.push({ label: "Drop", value: `${Math.round(stats.dropHeightM)} m` });
  if (stats.maxHeightM != null)
    facts.push({ label: "Height", value: `${Math.round(stats.maxHeightM)} m` });
  if (stats.inversions != null)
    facts.push({ label: "Inversions", value: String(stats.inversions) });
  if (stats.coasterType)
    facts.push({
      label: "Type",
      value: stats.coasterType.charAt(0).toUpperCase() + stats.coasterType.slice(1),
    });
  if (stats.manufacturer) facts.push({ label: "Maker", value: stats.manufacturer });
  if (stats.openedYear != null) facts.push({ label: "Opened", value: String(stats.openedYear) });

  const r = mine.data;
  const ridden = r && r.rideCount > 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Coaster stats
        </span>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {facts.map((f) => (
            <Fact key={f.label} label={f.label} value={f.value} />
          ))}
        </div>
        {loggedIn && ridden && (
          <div className="flex flex-col gap-1 border-t pt-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your rides
            </span>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">{r.rideCount}</span>{" "}
              {r.rideCount === 1 ? "ride" : "rides"}
              {r.bestMaxG != null && (
                <>
                  {" · best "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {r.bestMaxG.toFixed(1)} g
                  </span>
                </>
              )}
              {r.totalDrops > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {r.totalDrops}
                  </span>{" "}
                  {r.totalDrops === 1 ? "drop" : "drops"}
                </>
              )}
              {r.lastRiddenAt && <> · last {new Date(r.lastRiddenAt).toLocaleDateString()}</>}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The identity hero, shared by the loaded page and its loading state.
 *
 * Both render it in the *same* configuration — same bleed, same overlay
 * positions, same type — because arriving from a map card lands three flown
 * clones on it (see `card-flight.ts`) and they need real boxes to land on. The
 * loading state fills it from the card's own seed rather than grey blocks, so
 * data landing changes no geometry at all; only the parts the card couldn't
 * know (hours, gallery, ambient loop) fade in afterwards.
 *
 * `flying` means those clones are still in the air: the three landing targets
 * stay transparent (but laid out, so they can be measured) and the flight
 * reveals them itself when it settles.
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
  status,
  hourLines,
  earlyEntry,
  flying,
  entrance,
  waitFlown,
}: {
  heroKey: string;
  name: string;
  subtitle: string | null;
  image: string | null;
  /** The hero-crop preview the flight fades to in mid-air — see the layer below. */
  underlay?: string | null;
  imageAlt?: string | null;
  thumbhash?: string | null;
  video?: { url: string; poster?: string | null } | null;
  slides?: Array<{ url: string; alt: string | null }>;
  waitValue: number | null;
  waitIsLive: boolean;
  status: string | null;
  hourLines?: string[];
  earlyEntry?: boolean;
  flying: boolean;
  /** Opened via a map-card flight (whether or not clones are still airborne):
   *  the overlay chips that aren't landing targets stagger in after touchdown. */
  entrance: boolean;
  /** The wait chip is one of the flight's landing targets (the card flew its
   *  own chip here), so it reveals under the dissolving clone instead. */
  waitFlown: boolean;
}) {
  // Transparent, not unmounted: the flight measures these boxes to land on.
  // `visibility` as well as opacity, because Chrome paints an element's
  // backdrop-filter even at opacity 0 — a wait chip that's merely transparent
  // still blits its blur rectangle at the landing spot mid-flight.
  const hidden = flying ? ({ opacity: 0, visibility: "hidden" } as CSSProperties) : undefined;
  /**
   * Entrance for the overlay chips that *aren't* landing targets (status, hours,
   * Early Entry — and the wait chip when the card didn't fly one). Arriving from
   * a map card they hold invisible while the clones are in the air, then stagger
   * in top-first with a short fade-down once the flight settles. Delay and
   * fill-mode ride inline so each chip waits its turn unseen; chips the query
   * adds later simply join the cascade at their own slot when they mount.
   */
  const chipFx = (i: number): { className?: string; style?: CSSProperties } => {
    if (!entrance) return {};
    if (flying) return { style: { opacity: 0, visibility: "hidden" } };
    return {
      className: "animate-in fade-in slide-in-from-top-2 duration-300 motion-reduce:animate-none",
      style: { animationDelay: `${i * 70}ms`, animationFillMode: "backwards" },
    };
  };
  const waitFx: { className?: string; style?: CSSProperties } = waitFlown
    ? { style: hidden }
    : chipFx(0);
  const earlyFx = chipFx(1 + (hourLines?.length ?? 0));
  return (
    <div
      data-ride-hero={heroKey}
      className={cn(
        "relative isolate overflow-hidden md:shadow-sm",
        HERO_BLEED,
        image || video ? "bg-muted" : "bg-gradient-to-br from-slate-600 via-slate-800 to-slate-900",
      )}
    >
      {/* The photo, its ambient loop and its gallery crossfade travel together
          as one layer — that whole stack is what the card's header flies into,
          so it hides and reveals as a unit. */}
      <div data-ride-hero-image className="absolute inset-0" style={hidden}>
        {/* A light copy of the photo in the hero's *own* crop, held underneath
            for the life of the page — the same rendition the flight fades to in
            mid-air, so it's already decoded when it gets here. It gives the
            <Image> above something correctly-framed to fade in over: anything
            that makes that element replay its fade (a src resolving differently
            once the query lands, or the thumbhash arriving and restructuring it)
            becomes a crossfade between two identical framings rather than a
            blink through an empty box. */}
        {underlay && (
          <img
            src={underlay}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {image && (
          <Image
            src={disneyResizeUrl(image, HERO_IMAGE.resizeWidth)}
            alt={imageAlt ?? name}
            className="size-full object-cover"
            loading="eager"
            fetchPriority="high"
            sizes={HERO_IMAGE.sizes}
            widths={HERO_IMAGE.widths}
            quality={HERO_IMAGE.quality}
            // A thumbhash placeholder switches `Image` to its wrapper-span
            // structure, so passing one only *after* the query lands would
            // remount the <img> and replay its blur/scale fade-in — the shift
            // this underlay exists to remove. With a real photo already beneath,
            // the hash has nothing left to stand in for.
            placeholder={underlay ? undefined : (thumbhash ?? undefined)}
          />
        )}
        {/* Ambient hero loop (plan item 1.9, ride-level): fades in over
            the still once it can play; never mounts under
            prefers-reduced-motion. Video-less rides crossfade their
            gallery stills instead. */}
        {video ? (
          <AmbientHeroVideo src={video.url} poster={video.poster ?? null} />
        ) : (
          <HeroCrossfade slides={slides ?? []} />
        )}
      </div>
      {/* Scrim: heavy at the bottom for the title, light at the top so the
          overlay chips keep their contrast without flattening the photo.
          Tagged so the card flight can copy this exact gradient onto the
          flying photo and fade it in en route (see `flyPhoto`). */}
      <div
        data-ride-hero-scrim
        className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40"
      />

      {/* The headline number. Live standby when the ride is running,
          otherwise the 24–48h typical — never both. */}
      {waitValue != null && (
        <div
          data-ride-hero-wait
          style={waitFx.style}
          className={cn(
            "absolute left-4 flex items-center gap-2 rounded-2xl bg-black/75 px-3.5 py-2 text-white shadow-lg backdrop-blur-sm",
            HERO_OVERLAY_TOP,
            waitFx.className,
          )}
        >
          {/* Tagged because the flight morphs the card pill's own number
              straight onto this one rather than crossfading past it. */}
          <span
            data-ride-hero-wait-num
            className="text-3xl font-bold leading-none tabular-nums sm:text-4xl"
          >
            {waitValue}
          </span>
          {/* Tagged so the return flight can shed the wording while the number
              shrinks back into the marker's badge (see `launchRideReturn`). */}
          <span
            data-ride-hero-wait-label
            className="flex flex-col text-[10px] font-semibold uppercase leading-tight tracking-wide"
          >
            <span>min</span>
            <span className="text-white/70">{waitIsLive ? "wait now" : "typical"}</span>
          </span>
        </div>
      )}

      {/* Live state + today's windows, opposite the wait so neither crowds
          the title underneath. */}
      <div
        className={cn(
          "absolute right-4 flex max-w-[60%] flex-col items-end gap-1.5 text-right",
          HERO_OVERLAY_TOP,
        )}
      >
        {status && (
          <span
            style={chipFx(0).style}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm",
              chipFx(0).className,
            )}
          >
            <span className={cn("size-1.5 rounded-full", STATUS_DOT[status] ?? "bg-white/40")} />
            {STATUS_LABEL[status] ?? "Status unknown"}
          </span>
        )}
        {/* Per-entity hours today (plan item 1.4) — only published when the
            ride's windows differ from park hours. */}
        {(hourLines ?? []).map((line, i) => (
          <span
            key={line}
            style={chipFx(i + 1).style}
            className={cn(
              "rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white/90 backdrop-blur-sm",
              chipFx(i + 1).className,
            )}
          >
            {line}
          </span>
        ))}
        {earlyEntry && (
          <span
            style={earlyFx.style}
            className={cn(
              "rounded-full bg-amber-400/90 px-2.5 py-1 text-[11px] font-semibold text-amber-950 backdrop-blur-sm",
              earlyFx.className,
            )}
          >
            Open during Early Entry
          </span>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-4 sm:p-6">
        <h1
          data-ride-hero-title
          style={hidden}
          className="truncate text-2xl font-bold tracking-tight text-white drop-shadow-md sm:whitespace-normal sm:text-3xl"
        >
          {name}
        </h1>
        {/* Always one line, even before the park name is known: the title's box
            is a landing target, and a subtitle that appeared later would shift
            it up out from under the clone that just landed on it. */}
        <p className="truncate text-sm text-white/85 sm:whitespace-normal">{subtitle || " "}</p>
      </div>
    </div>
  );
}

/**
 * Standalone attraction detail page: live status + standby wait + paid-line
 * (Lightning Lane / Express) state for one ride, with a 24h standby trend and a
 * link back to the park board. Sourced from `parks.attraction`.
 */
export function RideDetail({ parkSlug, rideSlug }: { parkSlug: string; rideSlug: string }) {
  const trpc = useTRPC();
  const native = useIsNative();
  const rideQ = useQuery(trpc.parks.attraction.queryOptions({ parkSlug, rideSlug }));
  const ride = rideQ.data;
  // Set when this page was opened by tapping a map card: the card's own name,
  // photo and wait, plus whether its three flown clones are still in the air.
  const flight = useRideFlight(parkSlug, rideSlug);
  const heroKey = rideFlightKey(parkSlug, rideSlug);
  // Heading back to a map view, pop the hero down into its marker. A *layout*
  // effect, deliberately: its cleanup runs while the page is still in the DOM
  // (so the hero can be measured and cloned) but with history already pointing
  // at the destination (so the flight knows this exit is map-bound).
  useLayoutEffect(() => () => launchRideReturn(parkSlug, rideSlug), [parkSlug, rideSlug]);
  // Drop the seed on the way out, so coming back later from somewhere that
  // isn't the map doesn't paint a stale hero from it.
  useEffect(() => () => releaseRideFlight(parkSlug, rideSlug), [parkSlug, rideSlug]);

  if (rideQ.isLoading) {
    return (
      /* This shell mirrors the loaded return exactly — same outer classes, a
         placeholder where the desktop nav row will be (same h-8 as its button),
         same <header> wrapper — so React reconciles the hero into the *same*
         DOM node when the query lands. The query usually resolves mid-flight,
         and a hero that remounted then would replay its image fade, orphan the
         flight's settle listeners, and replay the chips' entrance stagger. */
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-2 pb-6 lg:px-6">
        <div className="hidden h-8 md:block" />
        <header className="flex flex-col gap-4">
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
              status={flight.seed.status}
              flying={flight.flying}
              entrance
              waitFlown={flight.seed.waitMinutes != null}
            />
          ) : (
            /* Same bleed as the real hero, so data landing doesn't shift the page. */
            <Skeleton className={HERO_BLEED} />
          )}
          <Skeleton className="h-6 w-72" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </header>
      </div>
    );
  }

  if (!ride) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-16 text-center lg:px-6">
        <p className="text-lg font-semibold">Ride not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This attraction may no longer be listed.{" "}
          <Link to="/park/$slug" params={{ slug: parkSlug }} className="underline">
            Back to the park
          </Link>
          .
        </p>
      </div>
    );
  }

  const operatorSlug = ride.park.operatorSlug;
  const ll = paidLineInfo(ride, operatorSlug);
  const llPrice = formatPriceCents(ll.priceCents, ride.lightningLane.currency);
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
  const subtitleParts = [ride.park.name, ride.meta?.land].filter(Boolean);
  const status = ride.status ?? "UNKNOWN";

  // One wait number, not two: an operating ride shows what the line is RIGHT
  // NOW, and everything else falls back to the 24–48h typical. Rides that
  // report neither (shows, parades) get no chip at all.
  const isOpen = status === "OPERATING";
  const liveWait = isOpen ? ride.standbyWait : null;
  const waitValue = liveWait ?? ride.histStandbyWait;
  const waitIsLive = liveWait != null;

  // Today's windows, split: the Early Entry flag is a badge of its own
  // (rope-drop gold), the rest read as plain clock ranges.
  const earlyEntry = ride.hoursToday.some((h) => h.type === "Early Entry");
  const hourLines = ride.hoursToday
    .filter((h) => h.type !== "Early Entry")
    .map(
      (h) =>
        `${h.type && h.type !== "Operating" ? `${h.type}: ` : ""}${showClock(h.start!, ride.park.timezone)}${
          h.end ? ` – ${showClock(h.end, ride.park.timezone)}` : ""
        }`,
    );

  // Operator descriptors, regrouped: one age chip instead of four age labels,
  // alias forms folded together, perks split from plain descriptors.
  const { ageLabel, perks, descriptors } = rideTagGroups(ride.meta?.tags ?? []);
  // Booleans we store as columns are the same kind of fact as the perk tags, so
  // they share the row — de-duped, since Disney publishes "Single Rider Offered"
  // as a tag while Universal publishes it as a flag.
  const essentials = [
    ride.meta?.heightRequirement,
    ageLabel,
    ride.meta?.expressPass === true ? "Express Pass" : null,
    ride.meta?.singleRider === true ? "Single rider" : null,
    ride.meta?.childSwap === true ? "Child swap" : null,
    ride.meta?.virtualLine === true ? "Virtual line" : null,
    ...perks,
  ].filter((v): v is string => !!v);
  const essentialChips = [...new Set(essentials)];

  const hasAbout = !!ride.meta?.description || !!ride.meta?.funFact;
  const hasAccessibility = (ride.meta?.accessibility?.length ?? 0) > 0;

  // Return to wherever the user last was on the map (the free-roam map at its
  // remembered camera, or a park dashboard) rather than always the park page.
  const back = getLastMapView();
  const backClass = "-m-2 inline-flex items-center gap-1.5 p-2 hover:underline";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-2 pb-6 lg:px-6">
      <div className="hidden items-center justify-between gap-3 md:flex">
        <nav className="text-sm text-muted-foreground">
          {back.to === "/map" ? (
            <Link to="/map" className={backClass}>
              <ArrowLeftIcon className="size-3.5" />
              {ride.park.name}
            </Link>
          ) : (
            <Link to="/park/$slug" params={back.params} className={backClass}>
              <ArrowLeftIcon className="size-3.5" />
              {ride.park.name}
            </Link>
          )}
        </nav>
        <RemovalRequestDialog
          entityType="attraction"
          entityId={String(ride.id)}
          entityName={ride.name}
        />
      </div>

      <header className="flex flex-col gap-4">
        {/* Identity hero, matching the park pages: name + location overlaid at
            the bottom, live state at the top. Rides with no published photo get
            the same layout over a neutral gradient rather than a second,
            differently-shaped header. */}
        <RideHero
          heroKey={heroKey}
          name={ride.name}
          subtitle={subtitleParts.join(" · ")}
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
          status={status}
          hourLines={hourLines}
          earlyEntry={earlyEntry}
          flying={flight?.flying ?? false}
          entrance={!!flight}
          waitFlown={flight?.seed.waitMinutes != null}
        />

        <div className="flex flex-col gap-2">
          {/* Row 1 — the facts that decide whether you can and should ride:
              height, the collapsed age range, and the perks (Express, single
              rider, PhotoPass…). Filled chips, so they read ahead of row 2. */}
          {essentialChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {essentialChips.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {/* Row 2 — what the ride is like: format first, then themes, then any
              operator label we don't have a category for. */}
          {descriptors.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {descriptors.map((t) => (
                <Badge key={t} variant="outline" className="font-normal">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Walking-nav entry point (§4.2) — routes to this ride on the map. */}
            <WalkThereButton
              id={ride.id}
              name={ride.name}
              latitude={ride.latitude}
              longitude={ride.longitude}
            />
            {ride.meta?.detailUrl && (
              <a
                href={ride.meta.detailUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                View on the official site
                <ExternalLinkIcon className="size-3.5" />
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Boarding-group range + allocation state (plan item 1.5). */}
      {(ride.boardingGroup != null || ride.boardingAllocation != null) && (
        <Card size="sm">
          <CardContent className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Virtual queue
            </span>
            <span className="text-base">
              {ride.boardingAllocation === "SOLD_OUT" ? (
                "All boarding groups distributed for today"
              ) : ride.boardingAllocation === "PAUSED" ? (
                "Boarding-group distribution paused"
              ) : ride.boardingGroup != null ? (
                <>
                  Now boarding groups{" "}
                  <span className="font-semibold tabular-nums">
                    {ride.boardingGroup}
                    {ride.boardingGroupEnd != null && ride.boardingGroupEnd !== ride.boardingGroup
                      ? `–${ride.boardingGroupEnd}`
                      : ""}
                  </span>
                </>
              ) : (
                "Boarding groups available"
              )}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Prose and accessibility share a row — both are short, read-once
          reference text, and stacking them pushed everything below the fold.
          Falls back to a single full-width column when only one is published. */}
      {(hasAbout || hasAccessibility) && (
        <div
          className={cn("grid gap-6", hasAbout && hasAccessibility && "md:grid-cols-2 md:gap-8")}
        >
          {hasAbout && (
            <div className="flex flex-col gap-4">
              {/* Official marketing copy (plan item 2.3). */}
              {ride.meta?.description && (
                <section className="flex flex-col gap-1.5">
                  <h2 className="text-lg font-semibold tracking-tight">About</h2>
                  <p className="max-w-prose text-sm text-muted-foreground">
                    {ride.meta.description}
                  </p>
                </section>
              )}
              {/* Universal publishes a trivia blurb per ride; Disney publishes none. */}
              {ride.meta?.funFact && (
                <section className="flex flex-col gap-1.5">
                  <h2 className="text-lg font-semibold tracking-tight">Did you know?</h2>
                  <p className="max-w-prose text-sm text-muted-foreground">{ride.meta.funFact}</p>
                </section>
              )}
            </div>
          )}
          {hasAccessibility && (
            <section className="flex flex-col gap-1.5">
              <h2 className="text-lg font-semibold tracking-tight">Accessibility</h2>
              <ul className="max-w-prose list-inside list-disc text-sm text-muted-foreground">
                {ride.meta?.accessibility?.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* Published coaster facts sit directly under the prose — they're the
          same kind of reference detail, and they read better beside the
          accessibility list than buried under the Lightning Lane charts. */}
      {ride.coasterStats && <CoasterStatsCard stats={ride.coasterStats} attractionId={ride.id} />}

      {ride.showtimes.length > 0 && (
        <ShowtimesCard showtimes={ride.showtimes} timeZone={ride.park.timezone} />
      )}

      {ll.has && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {paidLineProduct(operatorSlug)}
              </span>
              <span className="flex items-center gap-2 text-base">
                {ll.state ? (
                  <Badge variant={ll.soldOut ? "destructive" : "secondary"}>
                    {ll.state.toLowerCase().replace("_", " ")}
                  </Badge>
                ) : (
                  <Badge variant="outline">offered</Badge>
                )}
                {llPrice && <span className="tabular-nums">{llPrice}</span>}
              </span>
            </div>
            {/* Lightning Lane lives only in the MDE app — no web page to fall
                back to — so this is native-only; web users have the official-site
                link in the header above. */}
            {native && ride.lightningLaneDeepLink && (
              <Button
                size="sm"
                className="w-fit gap-1.5"
                render={<a href={ride.lightningLaneDeepLink} target="_blank" rel="noreferrer" />}
              >
                Open in Disney App
                <ExternalLinkIcon className="size-3.5" />
              </Button>
            )}
            {isUniversal(operatorSlug) && (
              <p className={cn("text-xs text-muted-foreground")}>
                Universal’s per-ride signal is the free Virtual Line return time. Paid Express is a
                separate park-wide pass — see the{" "}
                <Link to="/tickets" className="underline">
                  Ticket Pricing
                </Link>{" "}
                page.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Availability timeline — only for rides that actually offer the paid line.
          Single LL is a PAID_RETURN_TIME queue; Multi LL and Universal's Virtual
          Line are RETURN_TIME. */}
      {ll.has && (
        <LightningLaneAvailability
          attractionId={ride.id}
          queueType={ll.kind === "Single" ? QueueType.PAID_RETURN_TIME : QueueType.RETURN_TIME}
          timeZone={ride.park.timezone}
          product={paidLineProduct(operatorSlug)}
        />
      )}

      {/* Drop analysis sits under the timeline: the strip shows *today*, these
          charts show the 30-day pattern behind it. Self-hides when the ride has
          never sold out and come back. */}
      {ll.has && (
        <LightningLaneDrops
          attractionId={ride.id}
          queueType={ll.kind === "Single" ? QueueType.PAID_RETURN_TIME : QueueType.RETURN_TIME}
          product={paidLineProduct(operatorSlug)}
        />
      )}

      <RideAnalytics attractionId={ride.id} timezone={ride.park.timezone} />
    </div>
  );
}
