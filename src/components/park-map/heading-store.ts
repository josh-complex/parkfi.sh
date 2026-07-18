import { Store } from "@tanstack/store";

import type { GeoState } from "#/hooks/use-geolocation.ts";

import { angleDelta, bearingBetween } from "./nav-geometry.ts";

// A movement (course) sample is only trusted this long — after that the user
// has stopped and displacement direction is just GPS wander.
const COURSE_FRESH_MS = 8_000;

// Minimum displacement between fixes for a delta-position bearing. Below this
// the "movement" is mostly GPS noise and its direction is junk.
const COURSE_MIN_MOVE_M = 3;

// Fixes further apart in time than this don't form a course — the gap means
// standing still (wander), not walking.
const COURSE_MAX_GAP_MS = 15_000;

// The compass leads while it's genuinely swinging: a net rotation of at least
// this many degrees across the recent window reads as the user turning (in
// place, or the device in hand), where delta-position knows nothing yet.
const TURN_WINDOW_MS = 1_500;
const TURN_THRESHOLD_DEG = 30;

// Per-update smoothing gain toward the target source, circular. High enough to
// converge in a few sensor ticks after a source handoff, low enough that the
// handoff itself doesn't visibly snap the cone/camera.
const FUSE_ALPHA = 0.35;

// Cheap local distance for the min-move gate (avoids importing the geofence
// helper client-side just for this).
function roughMeters(a: [number, number], b: [number, number]): number {
  const cosLat = Math.cos((a[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * cosLat * 111_320;
  const dy = (b[1] - a[1]) * 111_320;
  return Math.hypot(dx, dy);
}

/**
 * Fused facing direction for navigation, in degrees clockwise from north — or
 * null when neither source has anything trustworthy.
 *
 * The magnetometer compass is jumpy and orientation-dependent (holding the
 * phone flat vs upright can disagree by a lot), while the direction you're
 * actually *moving* — the delta between successive GPS fixes, or the device's
 * own course-over-ground — is rock solid once you're walking. So while a fresh
 * movement course exists, it is weighted as the heading… unless the compass is
 * swinging past TURN_THRESHOLD_DEG within its window, which means the user is
 * actively turning and delta-position hasn't caught up yet — then the compass
 * leads until it settles. Standing still (course gone stale) it's all compass,
 * which is the one thing the magnetometer is good at. Transitions between the
 * two sources are circularly smoothed so handoffs never snap.
 *
 * Deliberately a module-level TanStack store, NOT React state: compass ticks
 * arrive at sensor rate (a hand-held phone wobbles ≥1° virtually every frame),
 * and routing them through component state re-rendered the whole map stage tree
 * — provider, renderer, nav overlay — per tick. Every consumer is imperative
 * (the puck's facing cone, the heading-up rotation, the engage-time camera
 * flys), so they subscribe or read here directly and React never sees a tick.
 */
export const fusedHeadingStore = new Store<number | null>(null);

// Fusion working state. Module-level because the store is a singleton — exactly
// one compass and one GPS watch feed it (the map stage's).
let fused: number | null = null;
let compass: number | null = null;
let course: { bearing: number; at: number } | null = null;
let lastFix: { coords: [number, number]; at: number } | null = null;
let hist: Array<{ h: number; t: number }> = [];

// Publish only real changes: null↔value flips, and moves of ≥1° — the same
// emit threshold the raw compass path uses, so subscribers (DOM cone paints,
// map easeTo) aren't invoked for sub-visible wobble.
function emit(next: number | null): void {
  const prev = fusedHeadingStore.state;
  if (next == null ? prev == null : prev != null && Math.abs(angleDelta(prev, next)) < 1) return;
  fusedHeadingStore.setState(() => next);
}

function recompute(): void {
  const now = Date.now();
  const freshCourse = course && now - course.at <= COURSE_FRESH_MS ? course.bearing : null;
  // Net compass rotation across the window — jitter cancels, a real turn adds.
  const turning =
    hist.length >= 2 &&
    Math.abs(angleDelta(hist[0].h, hist[hist.length - 1].h)) >= TURN_THRESHOLD_DEG;

  let target: number | null;
  if (compass == null) target = freshCourse;
  else if (freshCourse == null || turning) target = compass;
  else target = freshCourse;

  if (target == null) {
    fused = null;
    emit(null);
    return;
  }
  fused = fused == null ? target : (fused + angleDelta(fused, target) * FUSE_ALPHA + 360) % 360;
  emit(fused);
}

/** Feed a smoothed compass reading (from {@link useDeviceHeading}); null when
 *  the compass turns off. Records it for the turn detector, then re-fuses. */
export function recordCompassHeading(heading: number | null): void {
  compass = heading;
  if (heading == null) {
    hist = [];
    recompute();
    return;
  }
  const now = Date.now();
  hist.push({ h: heading, t: now });
  while (hist.length > 0 && now - hist[0].t > TURN_WINDOW_MS) hist.shift();
  recompute();
}

/**
 * Feed a geolocation state change. A granted fix updates the movement course —
 * the device's own course-over-ground when it reports one, else the bearing of
 * the displacement since the last sufficiently-far fix. Losing location drops
 * the course (the compass alone carries the heading until fixes return).
 */
export function recordHeadingFix(geo: GeoState): void {
  if (geo.status !== "granted") {
    course = null;
    lastFix = null;
    return;
  }
  const now = Date.now();
  if (geo.heading != null && !Number.isNaN(geo.heading)) {
    course = { bearing: geo.heading, at: now };
  }
  if (!lastFix) {
    lastFix = { coords: geo.coords, at: now };
  } else if (roughMeters(lastFix.coords, geo.coords) >= COURSE_MIN_MOVE_M) {
    if (geo.heading == null && now - lastFix.at <= COURSE_MAX_GAP_MS) {
      course = { bearing: bearingBetween(lastFix.coords, geo.coords), at: now };
    }
    lastFix = { coords: geo.coords, at: now };
  }
  recompute();
}
