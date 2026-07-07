"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

import type { LevelInfo } from "#/lib/achievements.ts";

export interface UserLevel {
  level: LevelInfo;
  unlockedCount: number;
}

/**
 * The signed-in user's level + XP, for the badges shown on the user button and
 * mobile avatar. Null while anonymous, loading, or if the query fails — every
 * consumer treats "no level yet" as "show no badge", so this never blocks the
 * chrome from rendering. Telemetry-only on error (no toast).
 */
export function useUserLevel(): UserLevel | null {
  const { data: session } = authClient.useSession();
  const trpc = useTRPC();
  const query = useQuery({
    ...trpc.achievements.progress.queryOptions(),
    enabled: !!session?.user,
    staleTime: 60_000,
    meta: { errorToast: false },
  });
  if (!query.data) return null;
  return { level: query.data.level, unlockedCount: query.data.unlocked.length };
}
