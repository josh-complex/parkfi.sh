"use client";

import * as React from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ArrowUpLeftIcon,
  ArrowUpRightIcon,
  ChevronDownIcon,
  CircleCheckBigIcon,
  ClockIcon,
  CompassIcon,
  CornerUpLeftIcon,
  CornerUpRightIcon,
  FlagIcon,
  FootprintsIcon,
  LoaderCircleIcon,
  LocateFixedIcon,
  NavigationIcon,
  RotateCwIcon,
  RouteIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog.tsx";
import { useStore } from "@tanstack/react-store";

import { cn } from "#/lib/utils.ts";
import { formatDistance, type UnitSystem } from "#/lib/units.ts";
import type { NavProgress } from "#/components/park-map/nav-geometry.ts";
import { navStore, type NavSummary } from "#/components/park-map/nav-store.ts";
import type { RouteManeuver } from "#/server/routing/valhalla.ts";

// Nav-green 3D chrome — the same emboss system as the app's popovers/buttons
// (see the "3D surface system" in styles.css), tinted for the solid green
// panels: shelf/border in a darker green, glare a faint white top highlight.
// The full treatment (border + shelf shadow) is the top turn sign's; the bottom
// bar and arrival card take the border-only variant — their bottom edge sits
// against the nav island, where a 3D shelf reads as clutter.
const GREEN_PANEL_3D =
  "border-3d shadow-3d [--btn-3d:color-mix(in_oklch,var(--color-green-700),black_32%)] [--btn-glare:oklch(1_0_0_/_25%)]";
const GREEN_PANEL_BORDER =
  "border-3d [--btn-3d:color-mix(in_oklch,var(--color-green-700),black_32%)]";
// White action pills (Start / Retry / Exit) get the standard outline emboss +
// the press-down active state used by the app's other 3D buttons.
const PILL_3D =
  "border-3d btn-3d-outline shadow-3d active:translate-y-[3px] active:[--btn-glare:var(--btn-3d)] active:shadow-3d-active";
// Translucent circle buttons (swap / close) — dark-green shelf so the emboss
// still reads against the green panel behind them.
const CIRCLE_3D =
  "border-3d shadow-3d [--btn-3d:color-mix(in_oklch,var(--color-green-700),black_38%)] [--btn-glare:oklch(1_0_0_/_30%)] active:translate-y-[3px] active:[--btn-glare:var(--btn-3d)] active:shadow-3d-active";

function formatWalk(s: number): string {
  const mins = Math.max(1, Math.round(s / 60));
  if (mins < 60) return `${mins} min walk`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr walk` : `${h} hr ${m} min walk`;
}
/** Wall-clock arrival time ("3:42 PM") for a walk `s` seconds out — guests plan
 *  around showtimes and return windows, so the clock time is more actionable
 *  than the duration alone. Locale-formatted, hour+minute only. */
function formatArrivalClock(s: number): string {
  const at = new Date(Date.now() + s * 1000);
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
/** Elapsed walk time for the completion summary — seconds under a minute, else
 *  minutes (with trailing seconds when it isn't a clean minute). */
function formatElapsed(s: number): string {
  if (s < 60) return `${Math.max(1, s)} sec`;
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return secs === 0 ? `${mins} min` : `${mins} min ${secs} sec`;
}

/**
 * Map a Valhalla maneuver `type` code to a turn icon. Codes follow Valhalla's
 * `DirectionsLeg.Maneuver.Type` enum; we collapse the ones a pedestrian on OSM
 * footpaths actually hits (start/continue/turns/destination) and fall back to a
 * straight arrow for anything exotic (ramps, ferries, transit).
 */
function maneuverIcon(type: number): LucideIcon {
  switch (type) {
    case 4: // destination
    case 5: // destination right
    case 6: // destination left
      return FlagIcon;
    case 9: // slight right
    case 23: // stay right
      return ArrowUpRightIcon;
    case 10: // right
    case 18: // ramp right
    case 20: // exit right
      return CornerUpRightIcon;
    case 11: // sharp right
      return ArrowRightIcon;
    case 16: // slight left
    case 24: // stay left
      return ArrowUpLeftIcon;
    case 15: // left
    case 19: // ramp left
    case 21: // exit left
      return CornerUpLeftIcon;
    case 14: // sharp left
      return ArrowLeftIcon;
    case 12: // uturn right
    case 13: // uturn left
      return RotateCwIcon;
    default: // 1 start, 8 continue, 25 merge, roundabouts, unknown…
      return ArrowUpIcon;
  }
}

/**
 * Heading-lock compass (GL only). The needle counter-rotates with the map
 * bearing so it always points to true north. Tap toggles heading-up (map
 * rotates to your facing) vs north-lock; the icon fills in when north-lock is
 * engaged so the current mode reads at a glance.
 *
 * Reads the live bearing straight from the nav store: it changes on every
 * animation frame of a rotate, so subscribing here keeps those per-frame writes
 * from re-rendering anything beyond this one button.
 */
function HeadingCompassButton({
  headingUp,
  onToggle,
}: {
  headingUp: boolean;
  onToggle: () => void;
}) {
  const bearing = useStore(navStore, (s) => s.mapBearing);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={headingUp ? "Lock map to north" : "Rotate map to my heading"}
      aria-pressed={!headingUp}
      className={cn(
        "pointer-events-auto inline-flex size-11 items-center justify-center rounded-full bg-green-700 text-white ring-1 ring-white/15 transition",
        CIRCLE_3D,
      )}
    >
      <CompassIcon
        // North-lock engaged → fill just the needle (the icon's polygon),
        // not the whole circle, so it reads as an active/pressed state.
        className={cn("size-6 transition-transform", !headingUp && "[&>polygon]:fill-current")}
        style={{ transform: `rotate(${-bearing}deg)` }}
        aria-hidden
      />
    </button>
  );
}

/**
 * Google-style walking-nav UI, overlaid on the map while a trip is active (it
 * travels in the portal with the map, and the filter chrome hides beneath it).
 * Two parts, deliberately solid highway-sign green to read as "actively
 * navigating" against the light 3D chips:
 *  - a top turn sign where the park/category chips were — the next maneuver,
 *    tappable to expand the full step list;
 *  - a bottom bar where the Filter button was — ETA + distance, with Swap
 *    (reverse origin/destination) and Cancel (end nav → plain UI).
 */
export function NavOverlay({
  destName,
  geoBlocked,
  locating,
  loading,
  error,
  distanceMeters,
  durationSeconds,
  maneuvers,
  progress,
  rerouting,
  unitSystem,
  started,
  arrived,
  summary,
  walkedMeters,
  canRotate,
  headingUp,
  onStart,
  onRetry,
  onToggleHeadingUp,
  onOverview,
  onSwap,
  onClear,
}: {
  destName: string;
  geoBlocked: boolean;
  /** Waiting on a location fix — trip not resolved yet, so no route to show. */
  locating: boolean;
  loading: boolean;
  error: boolean;
  /** Reached the destination — swap the nav UI for the completion card. */
  arrived: boolean;
  /** Frozen trip stats for the completion card (walked distance + elapsed). */
  summary: NavSummary | null;
  /** Live distance walked this trip (metres) — with the ticking remaining
   *  distance it yields a progress fraction that survives reroutes (a re-keyed
   *  route shrinks the route total, but not what's already been walked). */
  walkedMeters: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
  maneuvers: Array<RouteManeuver> | null;
  /** Live per-fix progress while navigating — next-turn distance, remaining
   *  distance/ETA. Null in preview / before the first fix. */
  progress: NavProgress | null;
  /** A wrong turn was detected and a fresh route is being computed. */
  rerouting: boolean;
  /** Distance units (feet/miles vs metres/km) inferred from the guest's locale. */
  unitSystem: UnitSystem;
  /** Preview (route framed) vs navigating (follow-cam). */
  started: boolean;
  /** Whether the map can rotate (GL) — gates the compass. */
  canRotate: boolean;
  /** Heading-up engaged (compass needle points off-north). */
  headingUp: boolean;
  onStart: () => void;
  /** Re-run the route query after a full failure (Retry button). */
  onRetry: () => void;
  onToggleHeadingUp: () => void;
  /** Frame the whole remaining route (overview peek); recenter returns to follow. */
  onOverview: () => void;
  onSwap: () => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // Steps only make sense on a resolved route; keep the ones with real copy
  // (Valhalla sometimes emits an empty final maneuver).
  const steps = (maneuvers ?? []).filter((m) => m.instruction.trim().length > 0);
  const fmtDist = (m: number) => formatDistance(m, unitSystem);
  const routed =
    !geoBlocked &&
    !locating &&
    !loading &&
    !error &&
    distanceMeters != null &&
    durationSeconds != null;
  const canExpand = routed && steps.length > 0;
  // Collapse whenever the route goes away (new fetch, cleared, errored) so a
  // stale step list can't linger open over the next trip.
  React.useEffect(() => {
    if (!canExpand) setExpanded(false);
  }, [canExpand]);
  // Top sign headline. In preview we headline the route's opening step
  // (`steps[0]`, which may be a "walk east on the path" start maneuver — fine
  // before you've moved). While navigating, the live projection picks the next
  // *actionable* turn (start maneuvers skipped, §1.1) and a ticking distance to
  // it (§1.2); a detected wrong turn shows a "Rerouting…" state instead.
  const first = steps[0];
  const liveManeuver =
    started && progress?.nextManeuverIndex != null
      ? (maneuvers?.[progress.nextManeuverIndex] ?? null)
      : null;
  // The live pick indexes the *unfiltered* maneuvers, so Valhalla's empty final
  // maneuver can land here — treat it as "no maneuver" so the headline falls
  // through to "Heading to <dest>" instead of a blank sign on the final leg.
  const headManeuver =
    liveManeuver != null
      ? liveManeuver.instruction.trim().length > 0
        ? liveManeuver
        : null
      : first;
  const HeadIcon = geoBlocked
    ? LocateFixedIcon
    : locating || loading || rerouting
      ? LoaderCircleIcon
      : routed && headManeuver
        ? maneuverIcon(headManeuver.type)
        : ArrowUpIcon;
  let headline: React.ReactNode;
  if (geoBlocked) headline = "Enable location to navigate";
  else if (locating) headline = "Getting your location…";
  else if (loading) headline = "Finding route…";
  else if (error || !routed) headline = `No walking route found to ${destName}`;
  else if (rerouting) headline = "Rerouting…";
  else headline = headManeuver ? headManeuver.instruction : `Heading to ${destName}`;
  // Sub-line: the live ticking distance to the next turn while navigating, else
  // the maneuver's own (static) length in preview.
  const liveDistToTurn = started && progress ? progress.distToNextM : null;
  const headSub =
    rerouting || !routed
      ? null
      : liveDistToTurn != null
        ? fmtDist(liveDistToTurn)
        : headManeuver && headManeuver.distanceMeters > 0
          ? fmtDist(headManeuver.distanceMeters)
          : null;
  // Bottom-bar figures: the live remaining distance/ETA while navigating (ticking
  // between reroutes), the whole-route totals in preview.
  const barDistanceMeters = started && progress ? progress.remainingM : distanceMeters;
  const barDurationSeconds = started && progress ? progress.etaSeconds : durationSeconds;
  // Estimated wall-clock arrival, and how far along the route we are (0–1) for
  // the progress bar — both only meaningful once actually navigating. The
  // fraction is walked / (walked + remaining), both live model-space metres, so
  // it neither disagrees with Valhalla's summary total nor collapses when a
  // reroute re-keys the route to just the remaining leg.
  const arrivalClock =
    routed && barDurationSeconds != null ? formatArrivalClock(barDurationSeconds) : null;
  const progressFraction =
    started && progress && walkedMeters + progress.remainingM > 0
      ? Math.min(1, Math.max(0, walkedMeters / (walkedMeters + progress.remainingM)))
      : null;

  const topSign = (
    <div className="flex items-center gap-3 px-4 py-3 text-left">
      <HeadIcon
        className={cn("size-7 shrink-0", (locating || loading || rerouting) && "animate-spin")}
        aria-hidden
      />
      {/* Announce instruction changes to screen readers as they update, without
          stealing focus (§5). */}
      <div className="min-w-0 flex-1" aria-live="polite">
        <div className="font-semibold leading-snug">{headline}</div>
        {headSub && <div className="text-xs text-white/70">{headSub}</div>}
      </div>
      {canExpand && (
        <ChevronDownIcon
          className={cn("size-5 shrink-0 transition-transform", expanded && "rotate-180")}
          aria-hidden
        />
      )}
    </div>
  );

  // Arrival — replace the whole nav UI with a completion summary: how far you
  // walked and how long it took, plus a single Exit button. No confirm on Exit:
  // the trip is finished, so ending it isn't a destructive mis-tap.
  if (arrived) {
    const showWalked = summary != null && summary.walkedMeters >= 1;
    const showElapsed = summary != null && summary.elapsedSeconds >= 1;
    return (
      <div
        data-map-chrome="bottom"
        className={cn(
          "pointer-events-auto absolute inset-x-4 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+1.4rem)] z-10 mx-auto flex max-w-md flex-col gap-3 rounded-3xl border-t-3 bg-green-700 px-4 py-4 text-white ring-1 ring-white/15 md:bottom-3",
          GREEN_PANEL_BORDER,
        )}
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15">
            <CircleCheckBigIcon className="size-6" aria-hidden />
          </span>
          {/* role=status so arrival is announced to screen readers — the polite
              live region up in the top sign unmounts in this branch, and the
              haptic is the only other signal. */}
          <div className="min-w-0 flex-1" role="status">
            <div className="font-semibold leading-tight">You’ve completed your navigation!</div>
            {destName && (
              <div className="truncate text-sm text-white/80">Arrived at {destName}</div>
            )}
          </div>
        </div>
        {/* Trip summary — only the stats we actually captured (a quick hop right
            next to the destination may have neither). */}
        {(showWalked || showElapsed) && (
          <div className="flex gap-2">
            {showElapsed && (
              <div className="flex flex-1 items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
                <ClockIcon className="size-4 shrink-0 text-white/70" aria-hidden />
                <div className="min-w-0">
                  <div className="text-[0.65rem] font-medium tracking-wide text-white/60 uppercase">
                    Time
                  </div>
                  <div className="truncate text-sm font-semibold tabular-nums">
                    {formatElapsed(summary.elapsedSeconds)}
                  </div>
                </div>
              </div>
            )}
            {showWalked && (
              <div className="flex flex-1 items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
                <FootprintsIcon className="size-4 shrink-0 text-white/70" aria-hidden />
                <div className="min-w-0">
                  <div className="text-[0.65rem] font-medium tracking-wide text-white/60 uppercase">
                    Distance
                  </div>
                  <div className="truncate text-sm font-semibold tabular-nums">
                    {fmtDist(summary.walkedMeters)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onClear}
          className={cn(
            "inline-flex w-full items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-green-700 transition hover:bg-white/90",
            PILL_3D,
          )}
        >
          Exit
        </button>
      </div>
    );
  }

  const showCompass = started && canRotate;
  return (
    <>
      {/* Top turn sign — sits where the park/category chips were. Spans the full
          width; the heading-lock compass lives down by the bottom bar so it never
          steals room from the instruction. */}
      <div
        data-map-chrome="top"
        className={cn(
          "pointer-events-auto absolute inset-x-4 top-[calc(var(--safe-top)+4.5rem)] z-10 mx-auto max-w-md overflow-hidden rounded-3xl bg-green-700 text-white ring-1 ring-white/15 md:top-3",
          GREEN_PANEL_3D,
        )}
      >
        {canExpand ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="block w-full transition hover:bg-white/5"
          >
            {topSign}
          </button>
        ) : (
          topSign
        )}
        {/* Step list expands/collapses via an animated grid-rows track (0fr↔1fr),
            so it slides open smoothly instead of popping. */}
        {canExpand && (
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
              expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="overflow-hidden">
              <ol className="max-h-64 divide-y divide-white/15 overflow-y-auto border-t border-white/15">
                {steps.map((m, i) => {
                  const Icon = maneuverIcon(m.type);
                  return (
                    <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                      <Icon className="mt-0.5 size-4 shrink-0 text-white/80" aria-hidden />
                      <span className="min-w-0 flex-1">{m.instruction}</span>
                      {m.distanceMeters > 0 && (
                        <span className="shrink-0 text-xs text-white/70 tabular-nums">
                          {fmtDist(m.distanceMeters)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}
      </div>

      {/* Bottom-left control stack (while navigating), above the ETA bar so the
          instruction sign can span the full width up top. The column's bottom
          edge is pinned; buttons stack upward — the compass sits lowest (where it
          always has), the route-overview peek above it. */}
      {started && (
        <div className="pointer-events-none absolute left-4 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+5.75rem)] z-10 flex flex-col gap-2 md:bottom-[5rem]">
          {/* Route overview — frame the whole remaining route, then the recenter
              button returns to follow (§3.4). */}
          <button
            type="button"
            onClick={onOverview}
            aria-label="Show the whole route"
            className={cn(
              "pointer-events-auto inline-flex size-11 items-center justify-center rounded-full bg-green-700 text-white ring-1 ring-white/15 transition",
              CIRCLE_3D,
            )}
          >
            <RouteIcon className="size-6" aria-hidden />
          </button>
          {showCompass && (
            <HeadingCompassButton headingUp={headingUp} onToggle={onToggleHeadingUp} />
          )}
        </div>
      )}

      {/* Bottom ETA bar — sits where the Filter button was. */}
      <div
        data-map-chrome="bottom"
        className={cn(
          "pointer-events-auto absolute inset-x-4 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+1.4rem)] z-10 mx-auto flex max-w-md items-center gap-3 overflow-hidden rounded-3xl border-t-3 bg-green-700 px-4 py-2.5 text-white ring-1 ring-white/15 md:bottom-3",
          GREEN_PANEL_BORDER,
        )}
      >
        <div className="min-w-0 flex-1">
          {routed && barDurationSeconds != null && barDistanceMeters != null ? (
            <div className="leading-tight">
              <span className="font-semibold">{formatWalk(barDurationSeconds)}</span>
              <span className="text-white/70"> · {fmtDist(barDistanceMeters)}</span>
            </div>
          ) : (
            <div className="font-medium leading-tight">
              {geoBlocked ? "Location off" : error ? "Route unavailable" : "Routing…"}
            </div>
          )}
          <div className="truncate text-xs text-white/70">
            {arrivalClock ? `Arrive ${arrivalClock} · to ${destName}` : `to ${destName}`}
          </div>
        </div>
        {/* Progress bar hugging the bar's bottom edge — fraction of the route
            walked (§5). Only while navigating, where "how far along am I" reads. */}
        {progressFraction != null && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-white/15">
            <div
              className="h-full bg-white/80 transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${progressFraction * 100}%` }}
            />
          </div>
        )}
        {/* Start — the preview→navigate CTA, next to the ETA. White-on-green so
            it reads as the primary action; hidden once navigating. */}
        {routed && !started && (
          <button
            type="button"
            onClick={onStart}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-green-700 transition hover:bg-white/90",
              PILL_3D,
            )}
          >
            <NavigationIcon className="size-4 fill-current" />
            Start
          </button>
        )}
        {/* Retry — the recovery action after a full routing failure (React
            Query's retries already exhausted, no route to fall back on). */}
        {error && (
          <button
            type="button"
            onClick={onRetry}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-green-700 transition hover:bg-white/90",
              PILL_3D,
            )}
          >
            <RotateCwIcon className="size-4" />
            Retry
          </button>
        )}
        {/* Swap only in preview — once navigating, the origin tracks your live
            position (and re-keys on a reroute), so a reversed origin wouldn't
            stick. */}
        {!locating && !geoBlocked && !started && (
          <button
            type="button"
            onClick={onSwap}
            aria-label="Reverse route"
            className={cn(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25",
              CIRCLE_3D,
            )}
          >
            <ArrowUpDownIcon className="size-4" />
          </button>
        )}
        {/* In preview (route not yet started) the X just cancels — nothing is
            underway to lose, so a mis-tap costs nothing. Once navigating, confirm
            first so a stray tap doesn't drop the trip. */}
        <button
          type="button"
          onClick={() => (started ? setConfirmOpen(true) : onClear())}
          aria-label={started ? "End navigation" : "Cancel route"}
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25",
            CIRCLE_3D,
          )}
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {/* Confirm before dropping the route — a mis-tap on the map shouldn't
          silently end navigation. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>End navigation?</AlertDialogTitle>
            <AlertDialogDescription>
              You’ll stop navigating{destName ? ` to ${destName}` : ""} and return to the map.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep navigating</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                onClear();
              }}
            >
              End
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
