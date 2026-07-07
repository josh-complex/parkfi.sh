"use client";

import { useMutation } from "@tanstack/react-query";

import { showUnlockToasts } from "#/components/achievements/unlock-toasts.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

import type { TrackEvent } from "#/lib/achievements.ts";

/** Fire-and-forget achievement event. Silently no-ops for anonymous users. */
export function useAchievementTrack(): (event: TrackEvent) => void {
  const { data: session } = authClient.useSession();
  const trpc = useTRPC();

  const ack = useMutation(
    trpc.achievements.ackUnlocks.mutationOptions({ meta: { errorToast: false } }),
  );

  const track = useMutation(
    trpc.achievements.track.mutationOptions({
      meta: { errorToast: false },
      onSuccess: (result) => {
        showUnlockToasts(
          result.newlyUnlocked.map((u) => u.id),
          { xp: result.xp, level: result.level, onShown: (ids) => ack.mutate({ ids }) },
        );
      },
      // Never toast errors for background telemetry.
      onError: () => {},
    }),
  );

  const loggedIn = !!session?.user;

  return (event: TrackEvent) => {
    if (!loggedIn) return;
    track.mutate({ event });
  };
}
