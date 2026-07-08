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
import { cn } from "#/lib/utils.ts";
import type { NavSummary } from "#/components/park-map/nav-store.ts";
import type { RouteManeuver } from "#/server/routing/valhalla.ts";

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
function formatWalk(s: number): string {
  const mins = Math.max(1, Math.round(s / 60));
  if (mins < 60) return `${mins} min walk`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr walk` : `${h} hr ${m} min walk`;
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
  started,
  arrived,
  summary,
  canRotate,
  headingUp,
  bearing,
  onStart,
  onRetry,
  onToggleHeadingUp,
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
  distanceMeters: number | null;
  durationSeconds: number | null;
  maneuvers: Array<RouteManeuver> | null;
  /** Preview (route framed) vs navigating (follow-cam). */
  started: boolean;
  /** Whether the map can rotate (GL) — gates the compass. */
  canRotate: boolean;
  /** Heading-up engaged (compass needle points off-north). */
  headingUp: boolean;
  /** Live map bearing in degrees, for the compass needle. */
  bearing: number;
  onStart: () => void;
  /** Re-run the route query after a full failure (Retry button). */
  onRetry: () => void;
  onToggleHeadingUp: () => void;
  onSwap: () => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // Steps only make sense on a resolved route; keep the ones with real copy
  // (Valhalla sometimes emits an empty final maneuver).
  const steps = (maneuvers ?? []).filter((m) => m.instruction.trim().length > 0);
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
  // Top sign: headline the first maneuver once routed. While navigating the trip
  // origin re-keys to the live position (see the re-route logic in nav-store), so
  // the route is recomputed from where you are and its first step *is* the next
  // turn; otherwise a status line.
  const first = steps[0];
  const HeadIcon = geoBlocked
    ? LocateFixedIcon
    : locating || loading
      ? LoaderCircleIcon
      : routed && first
        ? maneuverIcon(first.type)
        : ArrowUpIcon;
  let headline: React.ReactNode;
  if (geoBlocked) headline = "Enable location to navigate";
  else if (locating) headline = "Getting your location…";
  else if (loading) headline = "Finding route…";
  else if (error || !routed) headline = `No walking route found to ${destName}`;
  else headline = first ? first.instruction : `Heading to ${destName}`;
  const headSub =
    routed && first && first.distanceMeters > 0 ? formatDistance(first.distanceMeters) : null;

  const topSign = (
    <div className="flex items-center gap-3 px-4 py-3 text-left">
      <HeadIcon
        className={cn("size-7 shrink-0", (locating || loading) && "animate-spin")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
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
        className="pointer-events-auto absolute inset-x-3 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+0.75rem)] z-10 mx-auto flex max-w-md flex-col gap-3 rounded-2xl bg-green-700 px-4 py-4 text-white shadow-lg ring-1 ring-white/15 md:bottom-3"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15">
            <CircleCheckBigIcon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
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
                    {formatDistance(summary.walkedMeters)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onClear}
          className="inline-flex w-full items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-green-700 shadow-sm transition hover:bg-white/90 active:scale-95"
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
        className="pointer-events-auto absolute inset-x-3 top-[calc(env(safe-area-inset-top)+4.5rem)] z-10 mx-auto max-w-md overflow-hidden rounded-2xl bg-green-700 text-white shadow-lg ring-1 ring-white/15 md:top-3"
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
                          {formatDistance(m.distanceMeters)}
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

      {/* Heading-lock compass — bottom-left, above the ETA bar (GL only), so the
          instruction sign can span the full width up top. The needle
          counter-rotates with the map bearing so it always points to true north.
          Tap toggles heading-up (map rotates to your facing) vs north-lock; the
          icon fills in when north-lock is engaged so the current mode reads at a
          glance. */}
      {showCompass && (
        <button
          type="button"
          onClick={onToggleHeadingUp}
          aria-label={headingUp ? "Lock map to north" : "Rotate map to my heading"}
          aria-pressed={!headingUp}
          className="pointer-events-auto absolute left-3 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+4.75rem)] z-10 inline-flex size-11 items-center justify-center rounded-full bg-green-700 text-white shadow-lg ring-1 ring-white/15 transition active:scale-95 md:bottom-[4.75rem]"
        >
          <CompassIcon
            // North-lock engaged → fill just the needle (the icon's polygon), not
            // the whole circle, so it reads as an active/pressed state.
            className={cn("size-6 transition-transform", !headingUp && "[&>polygon]:fill-current")}
            style={{ transform: `rotate(${-bearing}deg)` }}
            aria-hidden
          />
        </button>
      )}

      {/* Bottom ETA bar — sits where the Filter button was. */}
      <div
        data-map-chrome="bottom"
        className="pointer-events-auto absolute inset-x-3 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+0.75rem)] z-10 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-green-700 px-4 py-2.5 text-white shadow-lg ring-1 ring-white/15 md:bottom-3"
      >
        <div className="min-w-0 flex-1">
          {routed ? (
            <div className="leading-tight">
              <span className="font-semibold">{formatWalk(durationSeconds)}</span>
              <span className="text-white/70"> · {formatDistance(distanceMeters)}</span>
            </div>
          ) : (
            <div className="font-medium leading-tight">
              {geoBlocked ? "Location off" : error ? "Route unavailable" : "Routing…"}
            </div>
          )}
          <div className="truncate text-xs text-white/70">to {destName}</div>
        </div>
        {/* Start — the preview→navigate CTA, next to the ETA. White-on-green so
            it reads as the primary action; hidden once navigating. */}
        {routed && !started && (
          <button
            type="button"
            onClick={onStart}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-green-700 shadow-sm transition hover:bg-white/90 active:scale-95"
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
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-green-700 shadow-sm transition hover:bg-white/90 active:scale-95"
          >
            <RotateCwIcon className="size-4" />
            Retry
          </button>
        )}
        {/* Swap only in preview — once navigating, the origin re-keys to your
            live position every fix, so a reversed origin wouldn't stick. */}
        {!locating && !geoBlocked && !started && (
          <button
            type="button"
            onClick={onSwap}
            aria-label="Reverse route"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 active:scale-95"
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
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 active:scale-95"
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
