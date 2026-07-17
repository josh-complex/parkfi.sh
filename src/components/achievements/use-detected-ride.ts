"use client";

import * as React from "react";
import posthog from "posthog-js";
import { useMutation } from "@tanstack/react-query";

import { showRideRecapToast } from "#/components/achievements/ride-recap-toast.tsx";
import { showUnlockToasts } from "#/components/achievements/unlock-toasts.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { logRideDebug } from "#/lib/ride-debug-log.ts";
import { hasRideSignature } from "#/lib/ride-metrics.ts";

import type { RideTrace } from "#/lib/ride-metrics.ts";

/**
 * The one canonical path a detected ride travels: client-side signature gate →
 * `submitRideTrace` → recap toast + any newly-unlocked sensor achievements
 * through the shared unlock funnel, recording each trace's fate in the debug
 * ring. Both the native `rideDetected` listener (`AchievementTracker`) and the
 * synthetic-trace dev panel (Layer C1) call this, so QA'd fakes exercise exactly
 * what a real coaster does — no divergent second implementation to drift.
 */
export function useDetectedRideHandler(): (
  trace: RideTrace,
  opts?: { simulated?: boolean },
) => void {
  const trpc = useTRPC();
  const ack = useMutation(
    trpc.achievements.ackUnlocks.mutationOptions({ meta: { errorToast: false } }),
  );
  const ackRef = React.useRef(ack);
  ackRef.current = ack;
  const submit = useMutation(
    trpc.achievements.submitRideTrace.mutationOptions({ meta: { errorToast: false } }),
  );
  const submitRef = React.useRef(submit);
  submitRef.current = submit;

  return React.useCallback((trace: RideTrace, opts?: { simulated?: boolean }) => {
    // QA traces (synthetic presets, couch manual-record) skip the PostHog
    // captures below — those events feed detector field-tuning, and fabricated
    // metrics would poison that data. The debug ring still logs everything.
    const simulated = opts?.simulated ?? false;
    // Client-side signature gate: don't even submit ordinary movement. The
    // server enforces the same rule authoritatively; this just spares the
    // round-trip and keeps the field-tuning ring honest about detected vs.
    // suppressed.
    if (!hasRideSignature(trace.metrics)) {
      logRideDebug({ kind: "suppressed", reason: "no ride signature", metrics: trace.metrics });
      if (!simulated) {
        posthog.capture("ride_trace_suppressed", {
          confidence: trace.metrics.confidence,
          durationS: trace.metrics.durationS,
          maxG: trace.metrics.maxG,
        });
      }
      return;
    }
    submitRef.current.mutate(trace, {
      onSuccess: (r) => {
        logRideDebug({ kind: r.duplicate ? "duplicate" : "accepted", metrics: trace.metrics });
        if (!r.duplicate) showRideRecapToast(trace.metrics);
        if (r.newlyUnlocked.length > 0) {
          showUnlockToasts(
            r.newlyUnlocked.map((u) => u.id),
            { xp: r.xp, level: r.level, onShown: (ids) => ackRef.current.mutate({ ids }) },
          );
        }
      },
      onError: (err) => {
        logRideDebug({ kind: "rejected", reason: err.message, metrics: trace.metrics });
        if (!simulated) {
          posthog.capture("ride_trace_rejected", {
            reason: err.message,
            confidence: trace.metrics.confidence,
            durationS: trace.metrics.durationS,
            maxG: trace.metrics.maxG,
          });
        }
      },
    });
  }, []);
}
