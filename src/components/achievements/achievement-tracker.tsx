"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import posthog from "posthog-js";
import { toast } from "sonner";

import { useStore } from "@tanstack/react-store";

import { useDetectedRideHandler } from "#/components/achievements/use-detected-ride.ts";
import {
  isNearAnyPark,
  selectBestFix,
  type CandidateFix,
  type FenceBox,
} from "#/components/achievements/tracker-geo.ts";
import { LOCNUDGE_TOAST_IDS, showUnlockToasts } from "#/components/achievements/unlock-toasts.tsx";
import {
  activeWatchesStore,
  GEO_PROFILES,
  lastFixStore,
  useGeolocation,
  type GeoProfile,
} from "#/hooks/use-geolocation.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { reportSimPing, useGeoSim } from "#/lib/dev-geo-sim.ts";
import { getOnce } from "#/lib/geolocation-source.ts";
import { isOnline } from "#/lib/native-network.ts";
import { maybeRequestReview } from "#/lib/native-review.ts";
import { parkGeofencesFromParks } from "#/lib/park-geofences.ts";
import { isNative, nativePlatform } from "#/lib/platform.ts";
import {
  addParkTransitionListener,
  addRideDetectedListener,
  armRideMonitoring,
  disarmRideMonitoring,
  queryStepSpan,
  readStepSample,
  requestBackgroundLocation,
  setParkGeofences,
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
// Armed loop with no usable fix for this long ⇒ the pipeline is silently
// starved (the 2026-07-26 field-test failure mode) — captured to PostHog.
const FIX_STARVATION_MS = 2 * 60 * 1000;
const NUDGE_DELAY_MS = 8_000;
const NUDGE_STAGGER_MS = 300;
const NUDGE_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const NUDGE_KEY = "parkfi:achv:locnudge";

/** What caused a ping — threaded through telemetry so field failures can be
 *  split by path (30 s loop vs geofence-entry one-shot vs resume tick). */
type PingTrigger = "loop" | "entry" | "visible";

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
  // Dynamic watch profile (W1): `high` whenever the user is plausibly at a park
  // — in-park per the server/geofence, or the freshest fix lands within ~2 km
  // of any park fence — else the ambient `low` profile. `low` was previously
  // unconditional, and its balanced-power fixes (Android 12+: the *coarse*
  // permission alias) landed above the server's 150 m accuracy gate outdoors,
  // silently starving every in-park stat. Coarse fixes remain exactly good
  // enough for the near-park bbox test that triggers the escalation.
  const [profile, setProfile] = React.useState<GeoProfile>("low");
  const { state, locate } = useGeolocation({ watch: true, rememberActive: true, profile });
  const sim = useGeoSim();
  // Faster cadence while the location sim is armed (Layer A) so dwell state
  // transitions show up in seconds, not 30-s multiples. No-op in normal use.
  const pingIntervalMs = sim.armed && sim.config?.fastPing ? 5_000 : PING_INTERVAL_MS;

  const ack = useMutation(
    trpc.achievements.ackUnlocks.mutationOptions({ meta: { errorToast: false } }),
  );
  const celebrate = React.useCallback(
    (ids: string[], xp: number, level: LevelInfo) => {
      // Positive funnel marker for conversion analysis — the unlock toast is
      // the app's clearest earned high point.
      posthog.capture("achievement_unlocked", { ids, count: ids.length, xp });
      showUnlockToasts(ids, { xp, level, onShown: (shown) => ack.mutate({ ids: shown }) });
      // An unlock is the app's clearest high point — the textbook moment to ask
      // for a store rating. `maybeRequestReview` is native-only and heavily
      // self-throttled (min euphoria count + long cooldown + once/session), so
      // calling it on every celebration is safe and never nags.
      void maybeRequestReview();
    },
    [ack],
  );

  // --- Location signals ------------------------------------------------------
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

  // Park list: geofence registration (native) + the near-park escalation test
  // (all platforms — W1 opened this beyond native so web gets the same
  // profile escalation).
  const parksQ = useQuery({
    ...trpc.parks.list.queryOptions(),
    enabled: loggedIn && (isNative() || locationOn),
    staleTime: Infinity,
  });
  const fenceBoxes = React.useMemo<FenceBox[]>(
    () =>
      (parksQ.data ?? []).flatMap((p) => {
        const box = p.fence ?? p.bounds;
        return box ? [box] : [];
      }),
    [parksQ.data],
  );

  // In-park state: ref for interval/listener callbacks + state mirror so the
  // profile derivation re-renders when it flips.
  const inParkRef = React.useRef(false);
  const [inParkState, setInParkState] = React.useState(false);
  const disarmMissesRef = React.useRef(0);
  const setInPark = React.useCallback((v: boolean) => {
    inParkRef.current = v;
    setInParkState(v);
  }, []);

  // Best-fix selection (W1): own watch fix vs the shared last-fix from any
  // other live watch (map nav) — fresher-and-more-accurate wins, so the map's
  // GPS-grade fixes feed the ping loop instead of being shadowed by this
  // instance's coarse ambient fix. The shared fix is only eligible while some
  // watch is actually delivering (`activeWatches > 0`); a dead session's
  // leftover one-shot shouldn't ping forever.
  const ownFix: CandidateFix | null =
    state.status === "granted"
      ? { lng: state.coords[0], lat: state.coords[1], accuracy: state.accuracy }
      : null;
  const bestFix = selectBestFix(ownFix, activeWatches > 0 ? lastFix : null, Date.now());
  const coordsRef = React.useRef<(CandidateFix & { source: "own" | "shared" }) | null>(null);
  coordsRef.current = bestFix;

  const nearPark =
    inParkState || (bestFix != null && isNearAnyPark(bestFix.lng, bestFix.lat, fenceBoxes));
  React.useEffect(() => {
    const next: GeoProfile = nearPark ? "high" : "low";
    setProfile((prev) => (prev === next ? prev : next));
  }, [nearPark]);
  const profileRef = React.useRef(profile);
  profileRef.current = profile;
  const prevProfileRef = React.useRef<GeoProfile | null>(null);
  React.useEffect(() => {
    // Escalation observability: how often (and where) the watch actually runs
    // hot is the battery-budget input for the open W1 decision.
    if (prevProfileRef.current != null && prevProfileRef.current !== profile) {
      posthog.capture("achv_watch_profile_changed", { profile });
    }
    prevProfileRef.current = profile;
  }, [profile]);

  // --- Ping send/handle ------------------------------------------------------
  // The mutation object is kept in a ref so interval/listener callbacks always
  // see the latest values without tearing down/recreating timers on every
  // render (useMutation returns a fresh object each render).
  const ping = useMutation(trpc.achievements.ping.mutationOptions({ meta: { errorToast: false } }));
  const pingRef = React.useRef(ping);
  pingRef.current = ping;

  const handlePingResult = React.useCallback(
    (
      r: {
        inPark: boolean | null;
        parkId?: number;
        newlyUnlocked: { id: string }[];
        xp?: number | null;
        level?: LevelInfo | null;
        today?: { distanceM: number; queueSeconds: number; rides: number };
      },
      sent: { accuracy: number; fixSource: string; trigger: PingTrigger },
    ) => {
      // Echo the response to the dev sim panel (no-op when disarmed).
      reportSimPing({
        inPark: r.inPark === true,
        parkId: r.parkId,
        distanceM: r.today?.distanceM,
        queueSeconds: r.today?.queueSeconds,
        rides: r.today?.rides,
      });
      // Failure telemetry (W1): a dropped ping (accuracy above the server's
      // 150 m gate) was completely invisible in the field — this event makes
      // fix quality observable per platform/profile/fix-source.
      if (r.inPark == null) {
        posthog.capture("achv_ping_dropped", {
          accuracy: Math.round(sent.accuracy),
          fixSource: sent.fixSource,
          trigger: sent.trigger,
          profile: profileRef.current,
          platform: isNative() ? "native" : "web",
        });
      }
      // Arm/disarm the native ride recorder on park entry/exit (no-op on
      // web). Only sensor-monitor while actually in a park — that's what
      // bounds battery. Arm on the first in-park response; disarm only
      // after DISARM_AFTER_MISSES consecutive out-of-park ones. A dropped
      // ping (inPark null — the fix was too inaccurate for the server to
      // trust) is evidence of nothing and moves neither edge.
      if (r.inPark === true) {
        disarmMissesRef.current = 0;
        if (!inParkRef.current) {
          setInPark(true);
          // Stable positive action: the server just credited park presence —
          // the top of the whole in-park stats funnel.
          posthog.capture("park_presence_started", {
            parkId: r.parkId,
            trigger: sent.trigger,
            platform: isNative() ? "native" : "web",
          });
          void armRideMonitoring();
        }
      } else if (r.inPark === false && inParkRef.current) {
        disarmMissesRef.current += 1;
        if (disarmMissesRef.current >= DISARM_AFTER_MISSES) {
          disarmMissesRef.current = 0;
          setInPark(false);
          posthog.capture("park_presence_ended", { trigger: sent.trigger });
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
    [celebrate, setInPark],
  );

  const sendPing = React.useCallback(
    async (coords: CandidateFix & { source?: string }, trigger: PingTrigger) => {
      // Steps ride along with the ping (native only; null on web/no sensor) as
      // the RAW session-cumulative count + session identity — the server diffs
      // against its own cursor, so retries/reloads are idempotent and the
      // client keeps no baseline. The counter accrues on the hardware
      // coprocessor even while the WebView was backgrounded, so the first
      // foreground ping after a pocketed stretch carries the whole backlog.
      const stepSample = await readStepSample();
      pingRef.current.mutate(
        {
          lng: coords.lng,
          lat: coords.lat,
          accuracy: coords.accuracy,
          stepsCum: stepSample?.cum,
          stepsSessionMs: stepSample?.sessionMs,
        },
        {
          onSuccess: (r) =>
            handlePingResult(r, {
              accuracy: coords.accuracy,
              fixSource: coords.source ?? "own",
              trigger,
            }),
          onError: (err) => {
            posthog.capture("achv_ping_failed", {
              trigger,
              message: err.message,
              accuracy: Math.round(coords.accuracy),
              offline: !isOnline(),
            });
          },
        },
      );
    },
    [handlePingResult],
  );
  const sendPingRef = React.useRef(sendPing);
  sendPingRef.current = sendPing;

  // --- Ping loop -------------------------------------------------------------
  React.useEffect(() => {
    if (!loggedIn || !locationOn) return;
    const armedAt = Date.now();
    let lastUsableFixAt: number | null = null;
    let starvationReported = false;
    const tick = async (trigger: PingTrigger) => {
      if (pingRef.current.isPending) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      // Parks have terrible signal — don't fire (and fail) pings into a dead
      // radio. A backgrounded pedometer backlog still uploads on the first ping
      // once connectivity returns; nothing is lost by waiting.
      if (!isOnline()) return;
      const coords = coordsRef.current;
      if (!coords) {
        // Failure telemetry (W1): armed but starved of fixes — once per
        // starvation episode, so a session-long drought is one event.
        const since = lastUsableFixAt ?? armedAt;
        if (!starvationReported && Date.now() - since > FIX_STARVATION_MS) {
          starvationReported = true;
          posthog.capture("achv_fix_starved", {
            starvedMs: Date.now() - since,
            profile: profileRef.current,
            platform: isNative() ? "native" : "web",
          });
        }
        return;
      }
      lastUsableFixAt = Date.now();
      starvationReported = false;
      await sendPingRef.current(coords, trigger);
    };
    // Immediate first tick (W1): the old loop only fired on the 30 s interval,
    // so short glance-sessions contributed zero pings.
    void tick("loop");
    const id = setInterval(() => void tick("loop"), pingIntervalMs);
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void tick("visible");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loggedIn, locationOn, pingIntervalMs]);

  // --- Native ride detection -------------------------------------------------
  // On device only: a sensor-detected coaster ride flows through the shared
  // detected-ride funnel (signature gate → submit → recap toast + unlocks +
  // debug ring) — the exact path the synthetic-trace dev panel drives too.
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

  // --- Background park geofencing (native) -----------------------------------
  // Region monitoring wakes the app on park entry/exit even when suspended —
  // what makes in-park detection work with the phone pocketed, which the
  // foreground `watchPosition` above cannot. On enter the native side arms the
  // ride recorder itself; here we sync the JS in-park state (so the ping loop's
  // disarm debounce stays coherent), report the transition to the server audit
  // trail (W2 Phase A), and fire an immediate high-accuracy ping so the entry
  // converts into server-side credit without waiting on the 30 s loop.
  const geofencesSetRef = React.useRef(false);
  React.useEffect(() => {
    if (!loggedIn || !isNative() || geofencesSetRef.current || !parksQ.data) return;
    geofencesSetRef.current = true;
    void (async () => {
      // Background monitoring needs the "always" grant; if the user declines,
      // setParkGeofences no-ops and we simply fall back to foreground pings.
      await requestBackgroundLocation();
      const from = lastFixStore.state?.coords ?? null;
      const regions = parkGeofencesFromParks(
        parksQ.data.map((p) => ({
          id: p.id,
          latitude: p.latitude,
          longitude: p.longitude,
          latMin: p.bounds?.latMin ?? null,
          latMax: p.bounds?.latMax ?? null,
          lngMin: p.bounds?.lngMin ?? null,
          lngMax: p.bounds?.lngMax ?? null,
          // Real-footprint bbox (W4) — the circle derives from this when
          // present, so MK's fence covers the park instead of the ~580 m
          // attraction hull that made rim walks flap EXIT/ENTER.
          fence: p.fence,
        })),
        from,
      );
      await setParkGeofences(regions);
    })();
  }, [loggedIn, parksQ.data]);

  const reportTransition = useMutation(
    trpc.achievements.reportParkTransition.mutationOptions({ meta: { errorToast: false } }),
  );
  const reportTransitionRef = React.useRef(reportTransition);
  reportTransitionRef.current = reportTransition;

  React.useEffect(() => {
    if (!loggedIn || !isNative()) return;
    let handle: PluginListenerHandle | null = null;
    let cancelled = false;
    void addParkTransitionListener(({ regionId, transition }) => {
      const parkId = Number(regionId);
      // Stable positive action events: geofencing demonstrably fired all day in
      // the field test while everything downstream was lost — these are the
      // recall baseline every other stat is measured against.
      posthog.capture(transition === "enter" ? "park_geofence_enter" : "park_geofence_exit", {
        parkId,
      });
      // W2 Phase A: server-side audit record of every transition (spam rate,
      // enter/exit flapping, platform asymmetry) — no stat credit yet.
      if (Number.isFinite(parkId)) {
        reportTransitionRef.current.mutate(
          { parkId, transition, at: Date.now(), platform: nativePlatform() },
          {
            onError: (err) => {
              posthog.capture("park_transition_report_failed", {
                parkId,
                transition,
                message: err.message,
                offline: !isOnline(),
              });
            },
          },
        );
      }
      if (transition === "enter") {
        disarmMissesRef.current = 0;
        if (!inParkRef.current) {
          setInPark(true);
          void armRideMonitoring();
        }
        // Entry-triggered ping (W1): one high-accuracy one-shot, fired for
        // fresh entries AND retained events consumed on resume — this is what
        // turns a geofence entry into a `user_park_day` row today.
        getOnce(GEO_PROFILES.high, {
          onFix: (fix) => {
            void sendPingRef.current(
              { lng: fix.coords[0], lat: fix.coords[1], accuracy: fix.accuracy, source: "entry" },
              "entry",
            );
          },
          onError: (err) => {
            posthog.capture("park_entry_ping_failed", {
              parkId,
              kind: err.kind,
              ...(err.kind === "error" ? { message: err.message } : {}),
            });
          },
        });
      } else if (inParkRef.current) {
        // A hard geofence exit is authoritative — disarm without waiting out the
        // ping debounce (which guards against noisy single fixes, not this).
        setInPark(false);
        disarmMissesRef.current = 0;
        void disarmRideMonitoring();
      }
    }).then((h) => {
      if (cancelled) void h?.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [loggedIn, setInPark]);

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
