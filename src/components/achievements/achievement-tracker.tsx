"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useStore } from "@tanstack/react-store";

import { useDetectedRideHandler } from "#/components/achievements/use-detected-ride.ts";
import { LOCNUDGE_TOAST_IDS, showUnlockToasts } from "#/components/achievements/unlock-toasts.tsx";
import { activeWatchesStore, lastFixStore, useGeolocation } from "#/hooks/use-geolocation.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { reportSimPing, useGeoSim } from "#/lib/dev-geo-sim.ts";
import { isNative } from "#/lib/platform.ts";
import {
  addRideDetectedListener,
  armRideMonitoring,
  disarmRideMonitoring,
  queryStepSpan,
  readStepSample,
} from "#/lib/ride-recorder-client.ts";

import type { PluginListenerHandle } from "@capacitor/core";
import type { LevelInfo } from "#/lib/achievements.ts";

const PING_INTERVAL_MS = 30_000;
// Consecutive out-of-park ping responses before the native ride recorder is
// disarmed (~2 min at the normal cadence). Arming is instant; disarming is
// debounced so a single noisy GPS fix near a park edge (or a brief geofence
// miss) can't kill sensor monitoring mid-visit — the battery cost of a couple
// extra minutes of monitoring is trivial next to a missed coaster.
const DISARM_AFTER_MISSES = 4;
const NUDGE_DELAY_MS = 8_000;
const NUDGE_STAGGER_MS = 300;
const NUDGE_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const NUDGE_KEY = "parkfi:achv:locnudge";

function readNudgeSnoozedAt(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(NUDGE_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeNudgeSnooze(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NUDGE_KEY, String(Date.now()));
  } catch {
    /* private mode / disabled storage — worst case we nag again next visit */
  }
}

/**
 * Headless, globally-mounted tracker (see `_dash.tsx`). Drives the achievement
 * ping loop off the existing geolocation hook, replays any unlock toasts that
 * never got acked, and — once per snooze window — nudges a logged-in user
 * with location off toward turning it on. Renders nothing.
 */
export function AchievementTracker() {
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;
  const trpc = useTRPC();
  // Low-power watch: the 30 s ping only needs park-level presence (parks are
  // hundreds of metres across), which wifi/cell fixes deliver. The default
  // high-accuracy profile would hold the GPS radio on for the whole session —
  // and this watch auto-resumes every session, all day. When something needs
  // GPS-grade fixes (a nav trip, play mode), the map stage's own watch
  // escalates and the OS serves the most demanding active request.
  const { state, locate } = useGeolocation({ watch: true, rememberActive: true, profile: "low" });
  const sim = useGeoSim();
  // Faster cadence while the location sim is armed (Layer A) so dwell state
  // transitions show up in seconds, not 30-s multiples. No-op in normal use.
  const pingIntervalMs = sim.armed && sim.config?.fastPing ? 5_000 : PING_INTERVAL_MS;

  const ack = useMutation(
    trpc.achievements.ackUnlocks.mutationOptions({ meta: { errorToast: false } }),
  );
  const celebrate = React.useCallback(
    (ids: string[], xp: number, level: LevelInfo) => {
      showUnlockToasts(ids, { xp, level, onShown: (shown) => ack.mutate({ ids: shown }) });
    },
    [ack],
  );

  // --- Ping loop -----------------------------------------------------------
  // The loop runs whenever *any* location signal is live — this instance's own
  // watch (nudge tap, cross-session auto-resume) or any other instance's (the
  // map's locate button). The instances are isolated, so without the shared
  // watch count a user who turned location on via the map would go a whole
  // session with the tracker's instance stuck `idle` and zero pings sent —
  // which also meant the ride recorder never armed (it's edge-triggered off
  // ping responses below).
  const activeWatches = useStore(activeWatchesStore);
  const lastFix = useStore(lastFixStore);
  const locationOn = state.status === "granted" || activeWatches > 0;
  // Coords + the mutation object are kept in refs so the interval callback
  // always sees the latest values without tearing down/recreating the timer
  // on every render (useMutation returns a fresh object each render).
  const coordsRef = React.useRef<{ lng: number; lat: number; accuracy: number } | null>(null);
  if (state.status === "granted") {
    coordsRef.current = { lng: state.coords[0], lat: state.coords[1], accuracy: state.accuracy };
  } else if (activeWatches > 0 && lastFix) {
    coordsRef.current = {
      lng: lastFix.coords[0],
      lat: lastFix.coords[1],
      accuracy: lastFix.accuracy,
    };
  }

  const ping = useMutation(trpc.achievements.ping.mutationOptions({ meta: { errorToast: false } }));
  const pingRef = React.useRef(ping);
  pingRef.current = ping;

  React.useEffect(() => {
    if (!loggedIn || !locationOn) return;
    const tick = async () => {
      if (pingRef.current.isPending) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const coords = coordsRef.current;
      if (!coords) return;
      // Steps ride along with the ping (native only; null on web/no sensor) as
      // the RAW session-cumulative count + session identity — the server diffs
      // against its own cursor, so retries/reloads are idempotent and the
      // client keeps no baseline. The counter accrues on the hardware
      // coprocessor even while the WebView was backgrounded, so the first
      // foreground ping after a pocketed stretch carries the whole backlog.
      const stepSample = await readStepSample();
      pingRef.current.mutate(
        { ...coords, stepsCum: stepSample?.cum, stepsSessionMs: stepSample?.sessionMs },
        {
          onSuccess: (r) => {
            // Echo the response to the dev sim panel (no-op when disarmed).
            reportSimPing({
              inPark: r.inPark === true,
              parkId: r.parkId,
              distanceM: r.today?.distanceM,
              queueSeconds: r.today?.queueSeconds,
              rides: r.today?.rides,
            });
            // Arm/disarm the native ride recorder on park entry/exit (no-op on
            // web). Only sensor-monitor while actually in a park — that's what
            // bounds battery. Arm on the first in-park response; disarm only
            // after DISARM_AFTER_MISSES consecutive out-of-park ones. A dropped
            // ping (inPark null — the fix was too inaccurate for the server to
            // trust) is evidence of nothing and moves neither edge.
            if (r.inPark === true) {
              disarmMissesRef.current = 0;
              if (!inParkRef.current) {
                inParkRef.current = true;
                void armRideMonitoring();
              }
            } else if (r.inPark === false && inParkRef.current) {
              disarmMissesRef.current += 1;
              if (disarmMissesRef.current >= DISARM_AFTER_MISSES) {
                disarmMissesRef.current = 0;
                inParkRef.current = false;
                void disarmRideMonitoring();
              }
            }
            if (r.newlyUnlocked.length > 0 && r.xp != null && r.level != null) {
              celebrate(
                r.newlyUnlocked.map((u) => u.id),
                r.xp,
                r.level,
              );
            }
          },
        },
      );
    };
    const id = setInterval(() => void tick(), pingIntervalMs);
    return () => clearInterval(id);
  }, [loggedIn, locationOn, celebrate, pingIntervalMs]);

  // --- Native ride detection -------------------------------------------------
  // On device only: a sensor-detected coaster ride flows through the shared
  // detected-ride funnel (signature gate → submit → recap toast + unlocks +
  // debug ring) — the exact path the synthetic-trace dev panel drives too.
  const inParkRef = React.useRef(false);
  const disarmMissesRef = React.useRef(0);
  const handleDetectedRide = useDetectedRideHandler();
  const handleRideRef = React.useRef(handleDetectedRide);
  handleRideRef.current = handleDetectedRide;

  React.useEffect(() => {
    if (!loggedIn || !isNative()) return;
    let handle: PluginListenerHandle | null = null;
    let cancelled = false;
    void addRideDetectedListener((trace) => handleRideRef.current(trace)).then((h) => {
      if (cancelled) void h?.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      void handle?.remove();
      void disarmRideMonitoring();
    };
  }, [loggedIn]);

  // --- Pedometer reconciliation (iOS) ----------------------------------------
  // Once per app session: for each recent park-day, ask the OS pedometer buffer
  // (CMPedometer, ~7 days) how many steps actually happened in the day's
  // in-park window, and max-repair the server total. This recovers whatever the
  // live cumulative stream lost — process death mid-visit, the tail after the
  // last ping. queryStepSpan resolves null on Android/web, so the whole pass
  // no-ops there.
  const reconcile = useMutation(
    trpc.achievements.reconcileSteps.mutationOptions({ meta: { errorToast: false } }),
  );
  const reconcileRef = React.useRef(reconcile);
  reconcileRef.current = reconcile;
  const stepWindowsQ = useQuery({
    ...trpc.achievements.myStepWindows.queryOptions(),
    enabled: loggedIn && isNative(),
    staleTime: Infinity,
  });
  const reconciledRef = React.useRef(false);
  React.useEffect(() => {
    if (reconciledRef.current || !stepWindowsQ.data || stepWindowsQ.data.length === 0) return;
    reconciledRef.current = true;
    void (async () => {
      // CMPedometer keeps ~7 days; stay inside it with margin.
      const cutoffMs = Date.now() - 6.5 * 24 * 60 * 60 * 1000;
      for (const w of stepWindowsQ.data) {
        if (w.fromMs < cutoffMs || w.toMs <= w.fromMs) continue;
        const measured = await queryStepSpan(w.fromMs, w.toMs);
        if (measured == null || measured <= w.steps) continue;
        reconcileRef.current.mutate(
          { parkId: w.parkId, day: w.day, steps: measured },
          {
            onSuccess: (r) => {
              if (r.newlyUnlocked.length > 0) {
                celebrate(
                  r.newlyUnlocked.map((u) => u.id),
                  r.xp,
                  r.level,
                );
              }
            },
          },
        );
      }
    })();
  }, [stepWindowsQ.data, celebrate]);

  // --- Pending replay --------------------------------------------------------
  // Anything still un-acked (app closed mid-toast, etc.) — replayed once.
  const pendingQ = useQuery({
    ...trpc.achievements.pendingUnlocks.queryOptions(),
    enabled: loggedIn,
    staleTime: Infinity,
  });
  const repliedRef = React.useRef(false);
  React.useEffect(() => {
    if (repliedRef.current || !pendingQ.data || pendingQ.data.unlocked.length === 0) return;
    repliedRef.current = true;
    celebrate(
      pendingQ.data.unlocked.map((u) => u.id),
      pendingQ.data.xp,
      pendingQ.data.level,
    );
  }, [pendingQ.data, celebrate]);

  // --- Location-services nudge -----------------------------------------------
  React.useEffect(() => {
    if (!loggedIn) return;
    const timer = setTimeout(() => {
      if (state.status === "granted" || state.status === "prompting") return;
      const snoozedAt = readNudgeSnoozedAt();
      if (snoozedAt && Date.now() - snoozedAt < NUDGE_SNOOZE_MS) return;

      const fireStack = () => {
        const dismissAll = () => LOCNUDGE_TOAST_IDS.forEach((id) => toast.dismiss(id));

        setTimeout(() => {
          toast.info("ParkFi is better in the park", {
            id: "locnudge:1",
            duration: Infinity,
            description: "Turn on location and the app starts noticing things…",
            onDismiss: writeNudgeSnooze,
          });
        }, 0);
        setTimeout(() => {
          toast.info("Earn achievements as you go", {
            id: "locnudge:2",
            duration: Infinity,
            description:
              "Miles walked, queues survived, rope drops conquered — all counted automatically.",
            onDismiss: writeNudgeSnooze,
          });
        }, NUDGE_STAGGER_MS);
        setTimeout(() => {
          toast("Enable location services?", {
            id: "locnudge:3",
            duration: Infinity,
            description: "Only used while the app is open. Never shared.",
            action: {
              label: "Turn on",
              onClick: () => {
                locate();
                dismissAll();
              },
            },
            cancel: {
              label: "Not now",
              onClick: () => {
                writeNudgeSnooze();
                dismissAll();
              },
            },
            onDismiss: writeNudgeSnooze,
          });
        }, NUDGE_STAGGER_MS * 2);
      };

      if (typeof navigator !== "undefined" && navigator.permissions?.query) {
        navigator.permissions
          .query({ name: "geolocation" })
          .then((res) => {
            if (res.state !== "granted") fireStack();
          })
          .catch(fireStack);
      } else {
        fireStack();
      }
    }, NUDGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loggedIn, state.status, locate]);

  // A permission denial anywhere (this nudge's "Turn on", or the normal locate
  // control elsewhere) means the user said no at the browser level — don't nag.
  const prevStatusRef = React.useRef(state.status);
  React.useEffect(() => {
    if (state.status === "denied" && prevStatusRef.current !== "denied") writeNudgeSnooze();
    prevStatusRef.current = state.status;
  }, [state.status]);

  return null;
}
