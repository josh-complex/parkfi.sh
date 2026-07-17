"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useDetectedRideHandler } from "#/components/achievements/use-detected-ride.ts";
import { LOCNUDGE_TOAST_IDS, showUnlockToasts } from "#/components/achievements/unlock-toasts.tsx";
import { useGeolocation } from "#/hooks/use-geolocation.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { reportSimPing, useGeoSim } from "#/lib/dev-geo-sim.ts";
import { isNative } from "#/lib/platform.ts";
import {
  addRideDetectedListener,
  armRideMonitoring,
  disarmRideMonitoring,
} from "#/lib/ride-recorder-client.ts";

import type { PluginListenerHandle } from "@capacitor/core";
import type { LevelInfo } from "#/lib/achievements.ts";

const PING_INTERVAL_MS = 30_000;
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
  const { state, locate } = useGeolocation({ watch: true, rememberActive: true });
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
  // Coords + the mutation object are kept in refs so the interval callback
  // always sees the latest values without tearing down/recreating the timer
  // on every render (useMutation returns a fresh object each render).
  const coordsRef = React.useRef<{ lng: number; lat: number; accuracy: number } | null>(null);
  if (state.status === "granted") {
    coordsRef.current = { lng: state.coords[0], lat: state.coords[1], accuracy: state.accuracy };
  }

  const ping = useMutation(trpc.achievements.ping.mutationOptions({ meta: { errorToast: false } }));
  const pingRef = React.useRef(ping);
  pingRef.current = ping;

  React.useEffect(() => {
    if (!loggedIn || state.status !== "granted") return;
    const tick = () => {
      if (pingRef.current.isPending) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const coords = coordsRef.current;
      if (!coords) return;
      pingRef.current.mutate(coords, {
        onSuccess: (r) => {
          // Echo the response to the dev sim panel (no-op when disarmed).
          reportSimPing({
            inPark: r.inPark,
            parkId: r.parkId,
            distanceM: r.today?.distanceM,
            queueSeconds: r.today?.queueSeconds,
            rides: r.today?.rides,
          });
          // Arm/disarm the native ride recorder on park entry/exit (no-op on
          // web). Only sensor-monitor while actually in a park — that's what
          // bounds battery. Edge-triggered off the ping's inPark flag.
          if (r.inPark !== inParkRef.current) {
            inParkRef.current = r.inPark;
            if (r.inPark) void armRideMonitoring();
            else void disarmRideMonitoring();
          }
          if (r.newlyUnlocked.length > 0 && r.xp != null && r.level != null) {
            celebrate(
              r.newlyUnlocked.map((u) => u.id),
              r.xp,
              r.level,
            );
          }
        },
      });
    };
    const id = setInterval(tick, pingIntervalMs);
    return () => clearInterval(id);
  }, [loggedIn, state.status, celebrate, pingIntervalMs]);

  // --- Native ride detection -------------------------------------------------
  // On device only: a sensor-detected coaster ride flows through the shared
  // detected-ride funnel (signature gate → submit → recap toast + unlocks +
  // debug ring) — the exact path the synthetic-trace dev panel drives too.
  const inParkRef = React.useRef(false);
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
