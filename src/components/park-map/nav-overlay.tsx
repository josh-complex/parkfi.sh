"use client";

import * as React from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
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
  Volume2Icon,
  VolumeXIcon,
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

import { useIsNative } from "#/hooks/use-is-native.ts";
import { cn } from "#/lib/utils.ts";
import { formatDistance, type UnitSystem } from "#/lib/units.ts";
import {
  bearingBetween,
  compassDirection,
  type NavProgress,
} from "#/components/park-map/nav-geometry.ts";
import { navStore, toggleVoiceMuted, type NavSummary } from "#/components/park-map/nav-store.ts";
import { distanceMeters } from "#/server/living/geofence.ts";
import type { RouteManeuver } from "#/server/routing/valhalla.ts";

// Nav-green 3D chrome — the same emboss system as the app's popovers/buttons
// (see the "3D surface system" in styles.css), tinted for the solid green
// panels: shelf/border in a darker green, glare a faint white top highlight.
//
// The subtle white ring on these panels is dropped in dark mode (where it reads
// as a stray light outline against the dark basemap) via `dark:ring-transparent`
// — NOT `dark:ring-0`: width utilities re-declare the composed `box-shadow`
// chain after `shadow-3d` in the cascade, which wipes the 3D shelf; the color
// utility only flips the ring's color variable.
// The full treatment (border + shelf shadow) is the top turn sign's; the bottom
// bar and arrival card take the border-only variant — their bottom edge sits
// against the nav island, where a 3D shelf reads as clutter.
const GREEN_PANEL_3D =
  "border-3d shadow-3d [--btn-3d:color-mix(in_oklch,var(--color-green-700),black_32%)] [--btn-glare:oklch(1_0_0_/_25%)]";
const GREEN_PANEL_BORDER =
  "border-3d [--btn-3d:color-mix(in_oklch,var(--color-green-700),black_32%)]";
// White action pills (Start / Retry / Exit) get the outline emboss + the
// press-down active state used by the app's other 3D buttons. The shelf is a
// fixed neutral gray rather than btn-3d-outline: these pills stay white-on-green
// in both themes, and the outline preset's dark-mode shelf (--border lightened)
// is *lighter* than the face — a faintly blue rim under a white button.
const PILL_3D =
  "border-3d shadow-3d [--btn-3d:oklch(0.72_0_0)] [--btn-glare:oklch(1_0_0_/_0.55)] [--btn-glare-hover:oklch(1_0_0_/_0.8)] active:translate-y-[3px] active:[--btn-glare:var(--btn-3d)] active:shadow-3d-active";
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
 * Heading-lock compass (GL only). A two-tone rose needle — red half pointing
 * true north (hand-drawn SVG; the Lucide icon is a single-path glyph that can't
 * split colors) — counter-rotates with the map bearing. Tap toggles route-up
 * (map rotates to the walking direction) vs north-lock. The button restyles per
 * mode so it reads at a glance: nav green while following the walking
 * direction, white with a black rose (red north kept) while locked due north.
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
  const northLocked = !headingUp;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={headingUp ? "Lock map to north" : "Rotate map to the walking direction"}
      aria-pressed={northLocked}
      className={cn(
        "pointer-events-auto inline-flex size-11 items-center justify-center rounded-full ring-1 ring-white/15 dark:ring-transparent transition",
        CIRCLE_3D,
        northLocked
          ? // North-lock: white face with the rose in a mid gray — full black
            // reads far too heavy at this size (red north stays) — and a
            // neutral gray shelf so the emboss reads on the white face.
            "bg-white text-gray-600 [--btn-3d:oklch(0.72_0_0)] [--btn-glare:oklch(1_0_0_/_0.9)]"
          : "bg-green-700 text-white",
      )}
    >
      {/* Sized to nearly fill the button (unlike the stock size-6 glyphs, the
          rose carries its own circular frame, so at glyph size it reads tiny),
          with clear air between the frame and the needle tips. */}
      <svg viewBox="0 0 24 24" className="size-8" aria-hidden>
        <circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        {/* The needle counter-rotates so its red tip always points true north. */}
        <g transform={`rotate(${-bearing} 12 12)`}>
          <polygon points="12,4.5 14.8,12 9.2,12" fill="#ef4444" />
          <polygon points="12,19.5 9.2,12 14.8,12" fill="currentColor" />
        </g>
      </svg>
    </button>
  );
}

/**
 * Voice-cue mute toggle (§3.2) — spoken turn instructions on/off; the haptic
 * pulse stays either way. Reads/writes the persisted flag straight from the nav
 * store, so the overlay tree doesn't need the state threaded through it.
 */
function VoiceMuteButton() {
  const muted = useStore(navStore, (s) => s.voiceMuted);
  return (
    <button
      type="button"
      onClick={toggleVoiceMuted}
      aria-label={muted ? "Unmute spoken directions" : "Mute spoken directions"}
      aria-pressed={muted}
      className={cn(
        "pointer-events-auto inline-flex size-11 items-center justify-center rounded-full bg-green-700 text-white ring-1 ring-white/15 dark:ring-transparent transition",
        CIRCLE_3D,
      )}
    >
      {muted ? (
        <VolumeXIcon className="size-6" aria-hidden />
      ) : (
        <Volume2Icon className="size-6" aria-hidden />
      )}
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
  geoStatus,
  onRetryLocation,
  locating,
  loading,
  error,
  distanceMeters: routeDistanceMeters,
  durationSeconds,
  maneuvers,
  progress,
  toRouteM,
  rerouting,
  unitSystem,
  destWait,
  userCoords,
  destCoords,
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
  onClear,
}: {
  destName: string;
  /** Why location is blocked: `denied` (user said no — settings can fix it) vs
   *  `unavailable` (no hardware / insecure context). Null when location works. */
  geoStatus: "denied" | "unavailable" | null;
  /** Re-attempt the location grant (the "Try again" action when denied). */
  onRetryLocation: () => void;
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
  /** Distance (metres) to the routed path while live tracking hasn't engaged
   *  yet (the user started nav away from the route — still inside a building,
   *  say). Non-null flips the top sign to "Walk to the route". */
  toRouteM: number | null;
  /** A wrong turn was detected and a fresh route is being computed. */
  rerouting: boolean;
  /** Distance units (feet/miles vs metres/km) inferred from the guest's locale. */
  unitSystem: UnitSystem;
  /** Live standby wait (minutes) at an attraction destination, or null (§3.5). */
  destWait: number | null;
  /** Latest fix + destination pin, for the crow-flies fallback when routing is
   *  down — a straight-line bearing beats a dead error in a park (§5). */
  userCoords: [number, number] | null;
  destCoords: [number, number] | null;
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
  onClear: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const native = useIsNative();
  const geoBlocked = geoStatus != null;
  // Steps only make sense on a resolved route; keep the ones with real copy
  // (Valhalla sometimes emits an empty final maneuver).
  const steps = (maneuvers ?? []).filter((m) => m.instruction.trim().length > 0);
  const fmtDist = (m: number) => formatDistance(m, unitSystem);
  const routed =
    !geoBlocked &&
    !locating &&
    !loading &&
    !error &&
    routeDistanceMeters != null &&
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
  // Crow-flies fallback (§5): with routing down but a fix + a destination in
  // hand, a straight-line bearing is genuinely walkable inside a park — far
  // better than a dead "no route found".
  const crowFlies =
    error && userCoords && destCoords
      ? {
          direction: compassDirection(bearingBetween(userCoords, destCoords)),
          distM: distanceMeters(userCoords, destCoords),
        }
      : null;
  // Live tracking hasn't engaged: the user tapped Start away from the routed
  // path (GPS wandering inside a building, a hotel room above the walkway) —
  // the sign says to walk to the route instead of counting down a turn they
  // haven't started toward (§1).
  const walkToRoute = started && toRouteM != null;
  const HeadIcon = geoBlocked
    ? LocateFixedIcon
    : locating || loading || rerouting
      ? LoaderCircleIcon
      : crowFlies
        ? CompassIcon
        : walkToRoute
          ? FootprintsIcon
          : routed && headManeuver
            ? maneuverIcon(headManeuver.type)
            : ArrowUpIcon;
  let headline: React.ReactNode;
  // Denied is a user choice a settings toggle can undo; unavailable is the
  // device/context — different dead ends, different copy (§4.3).
  if (geoStatus === "denied") headline = "Location permission needed";
  else if (geoStatus === "unavailable") headline = "Location isn’t available here";
  else if (locating) headline = "Getting your location…";
  else if (loading) headline = "Finding route…";
  else if (crowFlies) headline = `Head ${crowFlies.direction} about ${fmtDist(crowFlies.distM)}`;
  else if (error || !routed) headline = `No walking route found to ${destName}`;
  else if (rerouting) headline = "Rerouting…";
  else if (walkToRoute) headline = "Walk to the route";
  else headline = headManeuver ? headManeuver.instruction : `Heading to ${destName}`;
  // Sub-line: the live ticking distance to the next turn while navigating, else
  // the maneuver's own (static) length in preview. Blocked/fallback states carry
  // their own explanatory sub-copy instead.
  const liveDistToTurn = started && progress ? progress.distToNextM : null;
  const headSub =
    geoStatus === "denied"
      ? native
        ? "Turn on location for ParkFi in your device settings, then try again."
        : "Allow location for this site in your browser settings, then try again."
      : geoStatus === "unavailable"
        ? "This device or browser can’t share a location."
        : crowFlies
          ? `No walking route — straight line to ${destName}`
          : rerouting || !routed
            ? null
            : started && toRouteM != null
              ? `${fmtDist(toRouteM)} away`
              : liveDistToTurn != null
                ? fmtDist(liveDistToTurn)
                : headManeuver && headManeuver.distanceMeters > 0
                  ? fmtDist(headManeuver.distanceMeters)
                  : null;
  // Bottom-bar figures: the live remaining distance/ETA while navigating (ticking
  // between reroutes), the whole-route totals in preview.
  const barDistanceMeters = started && progress ? progress.remainingM : routeDistanceMeters;
  const barDurationSeconds = started && progress ? progress.etaSeconds : durationSeconds;
  // In preview nothing re-renders on its own, so the wall-clock arrival estimate
  // would silently go stale while the user reads the route — tick it along.
  // While navigating every GPS fix re-renders anyway.
  const [, tickClock] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!routed || started) return;
    const id = window.setInterval(tickClock, 30_000);
    return () => window.clearInterval(id);
  }, [routed, started]);
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
          "pointer-events-auto absolute inset-x-4 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+1.4rem)] z-10 mx-auto flex max-w-md flex-col gap-3 rounded-3xl border-t-3 bg-green-700 px-4 py-4 text-white ring-1 ring-white/15 dark:ring-transparent md:bottom-3",
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
          "pointer-events-auto absolute inset-x-4 top-[calc(var(--safe-top)+4.5rem)] z-10 mx-auto max-w-md overflow-hidden rounded-3xl bg-green-700 text-white ring-1 ring-white/15 dark:ring-transparent md:top-3",
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
              {/* The scroll thumb is re-themed to the panel's own dark-green
                  shelf tone — the app-wide gray (light) / blue (dark) thumb
                  looks foreign on the solid green sign. Both the standard
                  inherited property and the --scrollbar-thumb var (the WebKit
                  fallback path in styles.css) need the override. */}
              <ol className="max-h-64 divide-y divide-white/15 overflow-y-auto border-t border-white/15 [--scrollbar-thumb:color-mix(in_oklch,var(--color-green-700),black_35%)] [--scrollbar-thumb-hover:color-mix(in_oklch,var(--color-green-700),black_50%)] [scrollbar-color:color-mix(in_oklch,var(--color-green-700),black_35%)_transparent]">
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
        <div className="pointer-events-none absolute left-4 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+7rem)] z-10 flex flex-col gap-2 md:bottom-[6.25rem]">
          {/* Route overview — frame the whole remaining route, then the recenter
              button returns to follow (§3.4). */}
          <button
            type="button"
            onClick={onOverview}
            aria-label="Show the whole route"
            className={cn(
              "pointer-events-auto inline-flex size-11 items-center justify-center rounded-full bg-green-700 text-white ring-1 ring-white/15 dark:ring-transparent transition",
              CIRCLE_3D,
            )}
          >
            <RouteIcon className="size-6" aria-hidden />
          </button>
          <VoiceMuteButton />
          {showCompass && (
            <HeadingCompassButton headingUp={headingUp} onToggle={onToggleHeadingUp} />
          )}
        </div>
      )}

      {/* Bottom ETA bar — sits where the Filter button was. */}
      <div
        data-map-chrome="bottom"
        className={cn(
          "pointer-events-auto absolute inset-x-4 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+1.4rem)] z-10 mx-auto flex max-w-md items-center gap-3 overflow-hidden rounded-3xl border-t-3 bg-green-700 px-4 py-2.5 text-white ring-1 ring-white/15 dark:ring-transparent md:bottom-3",
          GREEN_PANEL_BORDER,
        )}
      >
        <div className="min-w-0 flex-1">
          {routed && barDurationSeconds != null && barDistanceMeters != null ? (
            <div className="truncate leading-tight">
              <span className="font-semibold">{formatWalk(barDurationSeconds)}</span>
              <span className="text-white/70"> · {fmtDist(barDistanceMeters)}</span>
            </div>
          ) : (
            <div className="font-medium leading-tight">
              {geoBlocked ? "Location off" : error ? "Route unavailable" : "Routing…"}
            </div>
          )}
          {/* Arrival clock on its own line — guests plan around showtimes and
              return windows, so it earns more size than the detail row. */}
          {arrivalClock && (
            <div className="truncate text-sm font-medium text-white/90">Arrive {arrivalClock}</div>
          )}
          {/* Destination line, with the live wait when heading to an attraction
              (§3.5) — a mid-walk spike is a "keep going or bail" decision. */}
          <div className="truncate text-xs text-white/70">
            to {destName}
            {destWait != null && (
              <span className="font-semibold text-white/90"> · {destWait} min wait</span>
            )}
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
        {/* Try again — after a denial, the user may have just re-enabled the
            permission in settings; give them a way back that isn't a reload. */}
        {geoStatus === "denied" && (
          <button
            type="button"
            onClick={onRetryLocation}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-green-700 transition hover:bg-white/90",
              PILL_3D,
            )}
          >
            <LocateFixedIcon className="size-4" />
            Try again
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
