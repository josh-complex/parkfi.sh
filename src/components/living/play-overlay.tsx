"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SwordsIcon } from "lucide-react";

import { BattlePanel } from "#/components/living/battle-panel.tsx";
import { WielderPanel } from "#/components/living/wielder-panel.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

/**
 * Kingdom Hearts play-mode HUD, overlaid on the shared roam map (travels in the map
 * portal). The map itself renders the Darkness/discovery markers and reports
 * taps up via `battleMarkId` (a Darkness was engaged) and `dropAt` (the bare map
 * was tapped); this HUD turns those into the battle panel, the discovery-drop
 * sheet, the party panel, and a resting hint. Shown only when play mode is on
 * over a focused Disney park (the stage gates it).
 */
export function PlayOverlay({
  parkSlug,
  battleMarkId,
  dropAt,
  onCloseBattle,
  onCloseDrop,
}: {
  parkSlug: string;
  battleMarkId: number | null;
  dropAt: { lat: number; lng: number } | null;
  onCloseBattle: () => void;
  onCloseDrop: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;

  const [showWielder, setShowWielder] = React.useState(false);
  const [note, setNote] = React.useState("");

  const invalidateMarks = () =>
    void qc.invalidateQueries({ queryKey: trpc.living.marks.queryKey({ parkSlug }) });

  const leave = useMutation(
    trpc.living.leaveMark.mutationOptions({
      onSuccess: () => {
        setNote("");
        onCloseDrop();
        invalidateMarks();
      },
    }),
  );

  // Bottom-anchored panels sit ABOVE the floating Play button (which rides just
  // above the mobile nav island) so the two never overlap; on desktop there's no
  // nav/button, so they drop to the usual margin. A single shared anchor keeps
  // the hint→battle→drop swaps from jumping vertically. Each block fades+slides
  // in so state changes read as a smooth transition, not a pop.
  const bottomAnchor =
    "bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+3rem)] md:bottom-4";
  const enter = "animate-in fade-in slide-in-from-bottom-2 duration-200";

  return (
    <>
      {/* Party / roster button (top-right, below the header chrome). */}
      {loggedIn ? (
        <button
          type="button"
          onClick={() => setShowWielder((v) => !v)}
          className="animate-in fade-in slide-in-from-top-2 pointer-events-auto absolute right-3 top-[calc(env(safe-area-inset-top)+5.5rem)] z-10 flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-2 text-xs font-medium shadow-sm backdrop-blur duration-200 md:top-3"
        >
          <SwordsIcon className="size-4" />
          Party
        </button>
      ) : null}
      {showWielder ? (
        <WielderPanel parkSlug={parkSlug} onClose={() => setShowWielder(false)} />
      ) : null}

      {/* One bottom-center slot: an open battle wins, then a drop sheet, else a
          resting hint. */}
      {battleMarkId != null ? (
        <div
          className={`pointer-events-auto absolute left-1/2 z-10 w-[min(94%,440px)] -translate-x-1/2 ${bottomAnchor} ${enter}`}
        >
          <BattlePanel markId={battleMarkId} onClose={onCloseBattle} onResolved={invalidateMarks} />
        </div>
      ) : dropAt && loggedIn ? (
        <div
          className={`pointer-events-auto absolute left-1/2 z-10 w-[min(92%,420px)] -translate-x-1/2 rounded-lg border bg-background p-3 shadow-lg ${bottomAnchor} ${enter}`}
        >
          <div className="mb-2 text-sm font-medium">Leave a discovery here</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
            rows={2}
            placeholder="A tip, a hidden detail, a photo spot…"
            className="border-input bg-background w-full resize-none rounded-md border p-2 text-sm"
          />
          {leave.error ? (
            <div className="text-destructive mt-1 text-xs">{leave.error.message}</div>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm"
              onClick={() => {
                setNote("");
                onCloseDrop();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={!note.trim() || leave.isPending}
              onClick={() => leave.mutate({ parkSlug, lat: dropAt.lat, lng: dropAt.lng, note })}
            >
              {leave.isPending ? "Dropping…" : "Drop pin"}
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 rounded-full border bg-background/90 px-4 py-2 text-center text-xs shadow-sm backdrop-blur ${bottomAnchor} ${enter}`}
        >
          {loggedIn
            ? "Tap a coral breach to battle · tap the map to leave a discovery"
            : "Sign in to battle the Darkness and leave discoveries"}
        </div>
      )}
    </>
  );
}
