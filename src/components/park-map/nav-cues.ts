import * as React from "react";

import { vibrateTurnCue } from "#/lib/vibrate.ts";

import type { NavProgress, RouteModel } from "./nav-geometry.ts";
import type { RouteManeuver } from "#/server/routing/valhalla.ts";

/**
 * Haptic + spoken turn cues for the active walk (§3.2). In-park users walk with
 * the phone at their side, so each approaching maneuver gets a vibration pulse
 * — and, unless muted, the instruction read aloud — once the live projection
 * says the turn is CUE_DISTANCE_M away. Each maneuver cues once per route
 * (re-armed by a reroute, which swaps the route model), so hovering at a corner
 * can't machine-gun the buzzer.
 */

// How far (metres) before a maneuver its cue fires. Far enough to react at
// walking speed, close enough that the turn being announced is *this* corner.
const CUE_DISTANCE_M = 20;

function speak(text: string, lang: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    // Match the narrative language (see preferredRouteLanguage) so the voice
    // pronounces the instruction the way it's written.
    u.lang = lang;
    window.speechSynthesis.speak(u);
  } catch {
    /* speech unavailable — the haptic already fired */
  }
}

function cancelSpeech(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* nothing to cancel */
  }
}

export function useTurnCues(opts: {
  started: boolean;
  arrived: boolean;
  /** Spoken cues muted (haptics still fire). */
  muted: boolean;
  progress: NavProgress | null;
  maneuvers: Array<RouteManeuver> | null;
  /** Identity re-arms the cued set — a reroute's fresh model starts clean. */
  routeModel: RouteModel | null;
  destName: string;
  /** BCP-47 tag of the narrative language, for the speech voice. */
  language: string;
}): void {
  const { started, arrived, muted, progress, maneuvers, routeModel, destName, language } = opts;
  const cuedRef = React.useRef<Set<number>>(new Set());

  // Fresh route (or a new trip) — no maneuver has been announced yet.
  React.useEffect(() => {
    cuedRef.current = new Set();
  }, [routeModel]);

  // Approaching-turn cue, driven by the per-fix projection.
  React.useEffect(() => {
    if (!started || arrived || !progress || progress.nextManeuverIndex == null) return;
    const idx = progress.nextManeuverIndex;
    if (progress.distToNextM == null || progress.distToNextM > CUE_DISTANCE_M) return;
    if (cuedRef.current.has(idx)) return;
    cuedRef.current.add(idx);
    vibrateTurnCue();
    const instruction = maneuvers?.[idx]?.instruction.trim();
    if (!muted && instruction) speak(instruction, language);
  }, [started, arrived, progress, maneuvers, muted, language]);

  // Spoken arrival — pairs with the arrival haptic fired by the stage.
  const arrivedSpokenRef = React.useRef(false);
  React.useEffect(() => {
    if (!arrived) {
      arrivedSpokenRef.current = false;
      return;
    }
    if (arrivedSpokenRef.current) return;
    arrivedSpokenRef.current = true;
    if (!muted) speak(destName ? `You've arrived at ${destName}` : "You've arrived", language);
  }, [arrived, muted, destName, language]);

  // Muting mid-sentence stops the voice immediately; so does ending the trip.
  React.useEffect(() => {
    if (muted) cancelSpeech();
  }, [muted]);
  React.useEffect(() => {
    if (!started) cancelSpeech();
    return cancelSpeech;
  }, [started]);
}
