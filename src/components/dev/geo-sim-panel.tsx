"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { showUnlockToasts } from "#/components/achievements/unlock-toasts.tsx";
import { useDetectedRideHandler } from "#/components/achievements/use-detected-ride.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { armSim, disarmSim, useGeoSim, type LngLat } from "#/lib/dev-geo-sim.ts";
import { buildSyntheticTrace, TRACE_PRESETS } from "#/lib/dev-ride-trace.ts";
import { isNative } from "#/lib/platform.ts";
import {
  armRideMonitoring,
  startRideRecording,
  stopRideRecording,
} from "#/lib/ride-recorder-client.ts";
import { cn } from "#/lib/utils.ts";

import type { RideMetrics } from "#/lib/ride-metrics.ts";

const HEADING = "px-3 pt-2 text-[10px] uppercase tracking-wide text-white/40";
const BTN =
  "flex-1 rounded px-2 py-1.5 text-[11px] transition hover:bg-white/10 bg-white/[0.06] text-white/80";

/** Small labelled row. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-[11px]">
      <span className="w-14 shrink-0 text-white/40">{label}</span>
      {children}
    </div>
  );
}

/**
 * Device-test-tooling console (Layers A/B/C1/C3): drive the location simulator,
 * fire time-warp scenarios, make it rain, push synthetic ride traces, and run
 * manual record mode — all from the on-device dev panel. Rendered inside
 * {@link ErrorTestPanel}, so it inherits its dev/`nav-test-tools` gate; the
 * server procedures it calls are all owner-only (adminProcedure).
 */
export function GeoSimSection() {
  const trpc = useTRPC();
  const sim = useGeoSim();
  const handleDetectedRide = useDetectedRideHandler();

  const parksQ = useQuery({
    ...trpc.achievements.adminSimParks.queryOptions(undefined, { meta: { errorToast: false } }),
    staleTime: 5 * 60_000,
  });
  const parks = parksQ.data ?? [];

  const [parkId, setParkId] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (parkId == null && parks.length > 0) setParkId(parks[0].id);
  }, [parks, parkId]);

  const parkQ = useQuery({
    ...trpc.achievements.adminSimPark.queryOptions(
      { parkId: parkId ?? 0 },
      { meta: { errorToast: false } },
    ),
    enabled: parkId != null,
  });
  const park = parkQ.data;

  const [attractionId, setAttractionId] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (park && park.attractions.length > 0) {
      setAttractionId((cur) =>
        cur != null && park.attractions.some((a) => a.id === cur) ? cur : park.attractions[0].id,
      );
    }
  }, [park]);

  const [fastPing, setFastPing] = React.useState(true);
  const [fastWalk, setFastWalk] = React.useState(false);

  const attraction = park?.attractions.find((a) => a.id === attractionId) ?? null;

  const ack = useMutation(
    trpc.achievements.ackUnlocks.mutationOptions({ meta: { errorToast: false } }),
  );

  const scenario = useMutation(
    trpc.achievements.adminSimulateScenario.mutationOptions({
      onSuccess: (r) => {
        if (r.newlyUnlocked.length > 0) {
          showUnlockToasts(
            r.newlyUnlocked.map((u) => u.id),
            { xp: r.xp, level: r.level, onShown: (ids) => ack.mutate({ ids }) },
          );
        }
        toast.success(
          `Ran ${r.pings} pings · ${r.newlyUnlocked.length} new unlock${
            r.newlyUnlocked.length === 1 ? "" : "s"
          }`,
        );
      },
      onError: (err) => toast.error(err.message || "Scenario failed"),
    }),
  );

  const weather = useMutation(
    trpc.achievements.adminSetWeather.mutationOptions({
      onSuccess: () => toast.success("Rain observation inserted (2 h window)"),
      onError: (err) => toast.error(err.message || "Could not set weather"),
    }),
  );

  const runScenario = (
    preset: "fullParkDay" | "parkHopDay" | "weekendPair" | "streak" | "crossMidnightDwell",
  ) => {
    if (parkId == null) return;
    const secondParkId =
      preset === "parkHopDay" ? parks.find((p) => p.id !== parkId)?.id : undefined;
    scenario.mutate({
      preset,
      parkId,
      secondParkId,
      days: preset === "streak" ? 7 : undefined,
    });
  };

  // --- Location simulator arming -------------------------------------------
  const armTeleport = () => {
    if (!attraction) return;
    armSim({
      kind: "teleport",
      label: attraction.name,
      point: [attraction.lng, attraction.lat],
      fastPing,
    });
  };
  const armQueue = () => {
    if (!attraction) return;
    armSim({
      kind: "queue",
      label: `Queue · ${attraction.name}`,
      point: [attraction.lng, attraction.lat],
      fastPing,
    });
  };
  const armWalk = () => {
    if (!attraction) return;
    const end: LngLat = [attraction.lng, attraction.lat];
    // Start from the park entrance if geocoded, else ~330 m south of the ride.
    const start: LngLat = park?.entrance ?? [end[0], end[1] - 0.003];
    armSim({
      kind: "walk",
      label: `Walk → ${attraction.name}`,
      waypoints: [start, end],
      speedMs: fastWalk ? 6 : 1.4,
      fastPing,
    });
  };
  const armExit = () => {
    if (!attraction) return;
    armSim({
      kind: "exit",
      label: "Outside park",
      point: [attraction.lng, attraction.lat + 0.02],
      fastPing,
    });
  };

  // --- Manual record mode (C3) ---------------------------------------------
  const [recording, setRecording] = React.useState(false);
  const [recorded, setRecorded] = React.useState<RideMetrics | null>(null);
  const startRec = async () => {
    setRecorded(null);
    setRecording(true);
    // Both natives guard startRecording behind an active monitor (iOS
    // `guard monitoring`, Android's service instance), and monitoring normally
    // arms only on the in-park ping edge — so arm explicitly for couch
    // recording. Left armed afterwards; the tracker's park-exit edge or app
    // close disarms.
    await armRideMonitoring();
    await startRideRecording();
  };
  const stopRec = async () => {
    const trace = await stopRideRecording();
    setRecording(false);
    if (trace) {
      setRecorded(trace.metrics);
      // Through the real submit funnel, minus the field-tuning analytics.
      handleDetectedRide(trace, { simulated: true });
    } else {
      toast.message("No trace recorded (web or empty)");
    }
  };

  return (
    <div className="border-t border-white/10">
      <div className={HEADING}>Location sim</div>

      <Row label="Park">
        <select
          value={parkId ?? ""}
          onChange={(e) => setParkId(Number(e.target.value))}
          className="min-w-0 flex-1 rounded bg-white/10 px-1.5 py-1 text-[11px] text-white"
        >
          {parks.map((p) => (
            <option key={p.id} value={p.id} className="bg-neutral-900">
              {p.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Ride">
        <select
          value={attractionId ?? ""}
          onChange={(e) => setAttractionId(Number(e.target.value))}
          className="min-w-0 flex-1 rounded bg-white/10 px-1.5 py-1 text-[11px] text-white"
        >
          {(park?.attractions ?? []).map((a) => (
            <option key={a.id} value={a.id} className="bg-neutral-900">
              {a.name}
            </option>
          ))}
        </select>
      </Row>

      <div className="flex gap-1.5 px-3 py-1">
        <button type="button" className={BTN} onClick={armTeleport} disabled={!attraction}>
          Teleport
        </button>
        <button type="button" className={BTN} onClick={armQueue} disabled={!attraction}>
          Queue at
        </button>
      </div>
      <div className="flex gap-1.5 px-3 py-1">
        <button type="button" className={BTN} onClick={armWalk} disabled={!attraction}>
          Walk to
        </button>
        <button type="button" className={BTN} onClick={armExit} disabled={!attraction}>
          Exit park
        </button>
      </div>

      <div className="flex items-center gap-3 px-3 py-1 text-[11px] text-white/60">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={fastPing}
            onChange={(e) => setFastPing(e.target.checked)}
          />
          Fast ping
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={fastWalk}
            onChange={(e) => setFastWalk(e.target.checked)}
          />
          Fast walk
        </label>
      </div>

      {sim.armed && (
        <div className="mx-3 my-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-2 text-[11px] ring-1 ring-emerald-400/20">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-emerald-300">Armed · {sim.config?.label}</span>
            <button
              type="button"
              onClick={disarmSim}
              className="rounded px-1.5 py-0.5 text-[10px] text-white/60 hover:bg-white/10 hover:text-white"
            >
              Disarm
            </button>
          </div>
          {sim.coords && (
            <div className="mt-0.5 text-white/50 tabular-nums">
              {sim.coords.lat.toFixed(5)}, {sim.coords.lng.toFixed(5)} ·{" "}
              {Math.round(sim.coords.accuracy)} m
            </div>
          )}
          {sim.lastPing ? (
            <div
              className={cn("mt-0.5", sim.lastPing.inPark ? "text-emerald-300" : "text-white/40")}
            >
              {sim.lastPing.inPark ? "In park" : "Outside"}
              {sim.lastPing.inPark &&
                ` · ${sim.lastPing.rides ?? 0} rides · ${Math.round(
                  (sim.lastPing.queueSeconds ?? 0) / 60,
                )} min queue · ${Math.round(sim.lastPing.distanceM ?? 0)} m`}
            </div>
          ) : (
            <div className="mt-0.5 text-white/30">waiting for first ping…</div>
          )}
        </div>
      )}

      {/* --- Time-warp scenarios (Layer B) --- */}
      <div className={HEADING}>Time-warp scenarios</div>
      <div className="grid grid-cols-2 gap-1.5 px-3 py-1">
        <button
          type="button"
          className={BTN}
          onClick={() => runScenario("fullParkDay")}
          disabled={scenario.isPending}
        >
          Full park day
        </button>
        <button
          type="button"
          className={BTN}
          onClick={() => runScenario("streak")}
          disabled={scenario.isPending}
        >
          7-day streak
        </button>
        <button
          type="button"
          className={BTN}
          onClick={() => runScenario("weekendPair")}
          disabled={scenario.isPending}
        >
          Weekend pair
        </button>
        <button
          type="button"
          className={BTN}
          onClick={() => runScenario("parkHopDay")}
          disabled={scenario.isPending}
        >
          Park hop
        </button>
        <button
          type="button"
          className={BTN}
          onClick={() => runScenario("crossMidnightDwell")}
          disabled={scenario.isPending}
        >
          Cross-midnight
        </button>
        <button
          type="button"
          className={BTN}
          onClick={() => parkId != null && weather.mutate({ parkId })}
          disabled={weather.isPending || parkId == null}
        >
          Make it rain
        </button>
      </div>

      {/* --- Synthetic ride traces (Layer C1) --- */}
      <div className={HEADING}>Synthetic ride traces</div>
      <div className="grid grid-cols-2 gap-1.5 px-3 py-1">
        {TRACE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.note}
            onClick={() => handleDetectedRide(buildSyntheticTrace(preset), { simulated: true })}
            className={cn(BTN, preset.bad && "text-rose-300 hover:bg-rose-500/15")}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {!sim.armed && (
        <div className="px-3 pb-1 text-[10px] text-white/30">
          Arm the sim at a ride first — traces need a fresh in-park anchor.
        </div>
      )}

      {/* --- Manual record mode (C3, native only) --- */}
      {isNative() && (
        <>
          <div className={HEADING}>Manual record (IMU)</div>
          <div className="flex gap-1.5 px-3 py-1">
            {!recording ? (
              <button type="button" className={BTN} onClick={startRec}>
                Start recording
              </button>
            ) : (
              <button
                type="button"
                className={cn(BTN, "text-rose-300 hover:bg-rose-500/15")}
                onClick={stopRec}
              >
                Stop & submit
              </button>
            )}
          </div>
          {recorded && (
            <div className="mx-3 mb-1.5 rounded bg-white/5 px-2.5 py-1.5 text-[11px] text-white/50 tabular-nums">
              {recorded.durationS.toFixed(0)}s · {recorded.dropCount} drops · maxG{" "}
              {recorded.maxG.toFixed(1)} · airtime {recorded.airtimeS.toFixed(1)}s · conf{" "}
              {recorded.confidence.toFixed(2)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
