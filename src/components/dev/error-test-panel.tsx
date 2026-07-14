"use client";

import * as React from "react";
import posthog from "posthog-js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BugIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import {
  resetCelebratedLevel,
  showUnlockToasts,
} from "#/components/achievements/unlock-toasts.tsx";
import { useNavTestToolsEnabled } from "#/integrations/posthog/feature-flags.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { reportError } from "#/lib/report-error.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Admin QA panel for firing the telemetry/toast error states on demand, so the
 * PostHog Error Tracking wiring (reportError funnel, query/mutation cache sinks,
 * global capture nets, named events) can be exercised on a real device without
 * waiting for a genuine failure.
 *
 * Gated exactly like the nav QA tools: always on in local dev, and in prod only
 * for accounts with the `nav-test-tools` PostHog flag (see `useNavTestToolsEnabled`
 * and `DevLocationPanel`). Renders `null` for everyone else, so it never ships to
 * normal users.
 *
 * Mounted inside the router's `Wrap` (see `router.tsx`) so it has the QueryClient,
 * tRPC, and PostHog contexts the triggers need.
 */

// Throws during render — arms the router error boundary / RouteErrorFallback path
// (and, if it escapes, the global `capture_exceptions` net). Either way the error
// lands in PostHog.
function Boom(): never {
  throw new Error("Test render crash — thrown during render");
}

type Action = {
  label: string;
  run: () => void;
  /** Neutral confirmation toast for triggers that don't surface their own UI. */
  confirm?: string;
  danger?: boolean;
};

export function ErrorTestPanel() {
  const navTestTools = useNavTestToolsEnabled();
  const enabled = import.meta.env.DEV || navTestTools;

  const [open, setOpen] = React.useState(false);
  const [crash, setCrash] = React.useState(false);
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  // No local onError, so the global mutationCache sink owns the toast + capture.
  const testMutation = useMutation({
    mutationKey: ["__error_test_mutation__"],
    mutationFn: () => Promise.reject(new Error("Test mutation failure")),
  });

  // Achievements QA — bypasses real stat thresholds server-side (adminProcedure,
  // owner-only; see achievements.ts router).
  const ackUnlock = useMutation(
    trpc.achievements.ackUnlocks.mutationOptions({ meta: { errorToast: false } }),
  );
  const devUnlock = useMutation(
    trpc.achievements.devUnlock.mutationOptions({
      onSuccess: (r) => {
        if (r.newlyUnlocked.length === 0) {
          toast.success("All achievements already unlocked");
          return;
        }
        showUnlockToasts(
          r.newlyUnlocked.map((u) => u.id),
          { xp: r.xp, level: r.level, onShown: (ids) => ackUnlock.mutate({ ids }) },
        );
      },
      onError: (err) => toast.error(err.message || "Could not unlock (requires sign-in)"),
    }),
  );
  const devReset = useMutation(
    trpc.achievements.devReset.mutationOptions({
      onSuccess: () => {
        // Server state is wiped; also forget the celebrated-level marker so a
        // full reset really replays from zero (level-ups re-fire on re-earn).
        resetCelebratedLevel();
        toast.success("Achievements reset");
      },
      onError: (err) => toast.error(err.message || "Could not reset"),
    }),
  );
  const devResetRides = useMutation(
    trpc.achievements.devResetRides.mutationOptions({
      onSuccess: () => toast.success("Ride/sensor data cleared"),
      onError: (err) => toast.error(err.message || "Could not clear ride data"),
    }),
  );

  // Alerts QA — runs the real sweeps/dispatch path against live data (admin-only
  // server-side, see adminAlerts.ts).
  const runDiningSweep = useMutation(
    trpc.adminAlerts.runDiningSweep.mutationOptions({
      onSuccess: (r) => toast.success(`Dining sweep fired ${r.fired} alert(s)`),
      onError: (err) => toast.error(err.message || "Sweep failed"),
    }),
  );
  const runRideSweep = useMutation(
    trpc.adminAlerts.runRideSweep.mutationOptions({
      onSuccess: (r) => toast.success(`Ride/Lightning Lane sweep fired ${r.fired} alert(s)`),
      onError: (err) => toast.error(err.message || "Sweep failed"),
    }),
  );
  const sendTestPushToMe = useMutation(
    trpc.adminAlerts.sendTestPushToMe.mutationOptions({
      onSuccess: () => toast.success("Push enqueued — check this device"),
      onError: (err) => toast.error(err.message || "Could not send push"),
    }),
  );
  const fireMyDiningAlert = useMutation(
    trpc.adminAlerts.fireMyDiningAlert.mutationOptions({
      onSuccess: (r) =>
        toast.success(`Fired: ${r.payload.subject}`, {
          action: r.payload.deepLink
            ? {
                label: "Open in Disney App",
                onClick: () => window.open(r.payload.deepLink!, "_blank"),
              }
            : undefined,
        }),
      onError: (err) => toast.error(err.message || "Could not fire alert"),
    }),
  );

  // Hooks above run unconditionally; gate rendering only after them.
  if (!enabled) return null;
  if (crash) return <Boom />;

  const groups: Array<{ heading: string; actions: Array<Action> }> = [
    {
      heading: "Toasts + capture",
      actions: [
        {
          label: "Critical → toast",
          run: () =>
            reportError(new Error("Test critical error"), {
              source: "manual",
              severity: "critical",
            }),
        },
        {
          label: "Critical → custom copy",
          run: () =>
            reportError(new Error("Test critical (custom copy)"), {
              source: "manual",
              severity: "critical",
              toast: "That ride's temporarily down",
              toastDescription: "We couldn't load the latest wait times. Try again shortly.",
            }),
        },
        {
          label: "Degraded → silent capture",
          run: () =>
            reportError(new Error("Test degraded error"), {
              source: "manual",
              severity: "degraded",
              toast: false,
            }),
          confirm: "Degraded captured (no error toast)",
        },
        {
          label: "Expected → event only",
          run: () =>
            reportError(new Error("Test expected error"), {
              source: "manual",
              severity: "expected",
            }),
          confirm: "expected_error event sent",
        },
      ],
    },
    {
      heading: "React Query sinks",
      actions: [
        {
          label: "Query failure → toast",
          run: () => {
            void queryClient
              .fetchQuery({
                queryKey: ["__error_test_query__"],
                queryFn: () => Promise.reject(new Error("Test query failure")),
                retry: false,
              })
              .catch(() => {
                /* the queryCache.onError sink handles it — swallow here */
              });
          },
        },
        {
          label: "Mutation failure → toast",
          run: () => testMutation.mutate(),
        },
      ],
    },
    {
      heading: "Global nets",
      actions: [
        {
          label: "Uncaught error",
          run: () => {
            // Thrown out of a timer so it reaches window.onerror → capture_exceptions
            // rather than this click handler.
            setTimeout(() => {
              throw new Error("Test uncaught error");
            }, 0);
          },
          confirm: "Threw uncaught error",
        },
        {
          label: "Unhandled rejection",
          run: () => {
            void Promise.reject(new Error("Test unhandled rejection"));
          },
          confirm: "Rejected a promise",
        },
        {
          label: "Crash React render",
          run: () => setCrash(true),
          danger: true,
        },
      ],
    },
    {
      heading: "Achievements",
      actions: [
        {
          label: "Unlock next achievement",
          run: () => devUnlock.mutate(),
        },
        {
          label: "Reset my level",
          run: () => resetCelebratedLevel(),
          confirm: "Level reset — next unlock re-celebrates your current level",
        },
        {
          label: "Clear ride/sensor data",
          run: () => devResetRides.mutate(),
          danger: true,
        },
        {
          label: "Reset my achievements",
          run: () => devReset.mutate(),
          danger: true,
        },
      ],
    },
    {
      heading: "Alerts",
      actions: [
        {
          label: "Run dining sweep",
          run: () => runDiningSweep.mutate(),
        },
        {
          label: "Run ride / Lightning Lane sweep",
          run: () => runRideSweep.mutate(),
        },
        {
          label: "Send myself a test push",
          run: () => sendTestPushToMe.mutate(),
        },
        {
          label: "Fire my dining alert",
          run: () => fireMyDiningAlert.mutate(),
        },
      ],
    },
    {
      heading: "Auth",
      actions: [
        {
          // Mimics the Entra admin-consent block: a real full-page redirect to
          // /login with the error params better-auth forwards — same path as a
          // genuine OAuth failure — which opens CastMemberBlockedDialog.
          label: "Cast-member blocked modal",
          run: () => {
            const qs = new URLSearchParams({
              error: "access_denied",
              error_description:
                "AADSTS65001: The user or administrator has not consented to use the application.",
            });
            window.location.assign(`/login?${qs.toString()}`);
          },
        },
      ],
    },
    {
      heading: "Named events",
      actions: [
        {
          label: "chunk_reload",
          run: () => posthog.capture("chunk_reload", { chunk: "__test__" }),
          confirm: "chunk_reload event sent",
        },
        {
          label: "map_fallback_leaflet",
          run: () => posthog.capture("map_fallback_leaflet", { parkSlug: "__test__" }),
          confirm: "map_fallback_leaflet event sent",
        },
      ],
    },
  ];

  const fire = (action: Action) => {
    action.run();
    if (action.confirm) toast.success(action.confirm, { id: `errtest:${action.label}` });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Error test tools"
        className="pointer-events-auto fixed left-4 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+1.4rem)] z-80 inline-flex size-9 items-center justify-center rounded-full bg-black/60 text-white shadow-lg ring-1 ring-white/20 transition active:scale-95 md:bottom-4"
      >
        <BugIcon className="size-4" />
      </button>
    );
  }

  return (
    <div className="pointer-events-auto fixed left-4 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+1.4rem)] z-80 w-64 overflow-hidden rounded-2xl bg-black/85 text-white shadow-xl ring-1 ring-white/20 backdrop-blur md:bottom-4">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <BugIcon className="size-4 text-rose-400" />
        <span className="flex-1 text-xs font-semibold">Error test tools</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="inline-flex size-6 items-center justify-center rounded-full transition hover:bg-white/10"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto py-1">
        {groups.map((group) => (
          <div key={group.heading}>
            <div className="px-3 pt-2 text-[10px] uppercase tracking-wide text-white/40">
              {group.heading}
            </div>
            <ul className="py-1">
              {group.actions.map((action) => (
                <li key={action.label}>
                  <button
                    type="button"
                    onClick={() => fire(action)}
                    className={cn(
                      "flex w-full items-center px-3 py-1.5 text-left text-xs transition hover:bg-white/10",
                      action.danger && "text-rose-300 hover:bg-rose-500/20",
                    )}
                  >
                    {action.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
