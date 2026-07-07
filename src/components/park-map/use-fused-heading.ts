import * as React from "react";

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
 * Fused facing direction for navigation, in degrees clockwise from north.
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
 */
export function useFusedHeading(geo: GeoState, compassHeading: number | null): number | null {
  const [heading, setHeading] = React.useState<number | null>(null);

  const fusedRef = React.useRef<number | null>(null);
  const courseRef = React.useRef<{ bearing: number; at: number } | null>(null);
  const lastFixRef = React.useRef<{ coords: [number, number]; at: number } | null>(null);
  const compassRef = React.useRef<number | null>(null);
  compassRef.current = compassHeading;
  const histRef = React.useRef<Array<{ h: number; t: number }>>([]);

  const recompute = React.useCallback(() => {
    const now = Date.now();
    const compass = compassRef.current;
    const course =
      courseRef.current && now - courseRef.current.at <= COURSE_FRESH_MS
        ? courseRef.current.bearing
        : null;
    // Net compass rotation across the window — jitter cancels, a real turn adds.
    const hist = histRef.current;
    const turning =
      hist.length >= 2 &&
      Math.abs(angleDelta(hist[0].h, hist[hist.length - 1].h)) >= TURN_THRESHOLD_DEG;

    let target: number | null;
    if (compass == null) target = course;
    else if (course == null || turning) target = compass;
    else target = course;

    if (target == null) {
      fusedRef.current = null;
      setHeading(null);
      return;
    }
    const prev = fusedRef.current;
    const fused =
      prev == null ? target : (prev + angleDelta(prev, target) * FUSE_ALPHA + 360) % 360;
    fusedRef.current = fused;
    // Same ≥1° emit threshold the raw compass hook uses, so React isn't
    // re-rendered for sub-visible wobble.
    setHeading((h) => (h == null || Math.abs(angleDelta(h, fused)) >= 1 ? fused : h));
  }, []);

  // Movement course: the device's own course-over-ground when it reports one,
  // else the bearing of the displacement since the last sufficiently-far fix.
  React.useEffect(() => {
    if (geo.status !== "granted") {
      courseRef.current = null;
      lastFixRef.current = null;
      return;
    }
    const now = Date.now();
    if (geo.heading != null && !Number.isNaN(geo.heading)) {
      courseRef.current = { bearing: geo.heading, at: now };
    }
    const last = lastFixRef.current;
    if (!last) {
      lastFixRef.current = { coords: geo.coords, at: now };
    } else if (roughMeters(last.coords, geo.coords) >= COURSE_MIN_MOVE_M) {
      if (geo.heading == null && now - last.at <= COURSE_MAX_GAP_MS) {
        courseRef.current = { bearing: bearingBetween(last.coords, geo.coords), at: now };
      }
      lastFixRef.current = { coords: geo.coords, at: now };
    }
    recompute();
  }, [geo, recompute]);

  // Compass ticks: record for the turn detector, then re-fuse.
  React.useEffect(() => {
    if (compassHeading == null) {
      histRef.current = [];
      recompute();
      return;
    }
    const now = Date.now();
    const hist = histRef.current;
    hist.push({ h: compassHeading, t: now });
    while (hist.length > 0 && now - hist[0].t > TURN_WINDOW_MS) hist.shift();
    recompute();
  }, [compassHeading, recompute]);

  return heading;
}
