"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "#/integrations/trpc/react.ts";

interface WielderPanelProps {
  parkSlug: string;
  onClose: () => void;
}

export function WielderPanel({ parkSlug, onClose }: WielderPanelProps) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const profileQ = useQuery(trpc.living.profile.queryOptions());
  const companionsQ = useQuery(trpc.living.companions.queryOptions({ parkSlug }));

  const recruit = useMutation(
    trpc.living.recruit.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpc.living.profile.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.living.companions.queryKey({ parkSlug }) });
      },
    }),
  );

  const profile = profileQ.data;
  const companions = companionsQ.data ?? [];

  return (
    <div className="bg-background animate-in fade-in slide-in-from-top-2 pointer-events-auto absolute right-3 top-[calc(env(safe-area-inset-top)+9rem)] z-20 max-h-[70%] w-[min(92%,340px)] overflow-y-auto rounded-lg border p-4 shadow-lg duration-200 md:top-14">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Kingdom Hearts</div>
          <div className="text-muted-foreground text-xs">
            Rank {profile?.rank ?? 1} · {profile?.xp ?? 0} XP
          </div>
        </div>
        <button className="text-muted-foreground text-sm" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-1 text-xs font-medium">Your party</div>
        {profile && profile.roster.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {profile.roster.map((c) => (
              <span
                key={c.id}
                className="bg-muted rounded-full px-2 py-0.5 text-xs"
                title={c.worldName ?? undefined}
              >
                {c.name} · L{c.level}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">No companions yet.</p>
        )}
      </div>

      <div className="mb-1 text-xs font-medium">Companions in this park</div>
      <div className="space-y-2">
        {companions.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
            <div className="min-w-0">
              <div className="truncate text-sm">{c.name}</div>
              <div className="text-muted-foreground truncate text-xs">
                {c.worldName}
                {c.signatureName ? ` · ${c.signatureName}` : ""}
              </div>
            </div>
            {c.recruited ? (
              <span className="text-xs text-green-600">✓ Recruited</span>
            ) : c.recruitable ? (
              <button
                className="bg-primary text-primary-foreground shrink-0 rounded-md px-2.5 py-1 text-xs disabled:opacity-50"
                disabled={recruit.isPending}
                onClick={() => recruit.mutate({ companionId: c.id })}
              >
                Recruit
              </button>
            ) : (
              <span className="text-muted-foreground shrink-0 text-right text-[11px] leading-tight">
                Defeat the Darkness
                <br />
                at its ride
              </span>
            )}
          </div>
        ))}
        {companions.length === 0 ? (
          <p className="text-muted-foreground text-xs">No companions seeded for this park yet.</p>
        ) : null}
      </div>
    </div>
  );
}
