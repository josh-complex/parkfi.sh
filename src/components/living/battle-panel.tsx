"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { useTRPC } from "#/integrations/trpc/react.ts";
import { MOVES, WIELDER_HP, type MoveKey } from "#/server/living/battle.ts";

type Phase = "loading" | "fight" | "won" | "lost" | "gone";

interface BattlePanelProps {
  markId: number;
  onClose: () => void;
  /** Called after a win is recorded so the caller can refresh the map. */
  onResolved: () => void;
}

function HpBar({ label, hp, max, tone }: { label: string; hp: number; max: number; tone: string }) {
  const pct = Math.max(0, Math.round((hp / max) * 100));
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-xs">
        <span>{label}</span>
        <span>
          {Math.max(0, hp)}/{max}
        </span>
      </div>
      <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
      </div>
    </div>
  );
}

export function BattlePanel({ markId, onClose, onResolved }: BattlePanelProps) {
  const trpc = useTRPC();
  const start = useMutation(trpc.living.startEncounter.mutationOptions());
  const resolve = useMutation(trpc.living.resolveEncounter.mutationOptions());

  const [phase, setPhase] = React.useState<Phase>("loading");
  const [foe, setFoe] = React.useState<{ name: string; hp: number; maxHp: number; atk: number }>();
  const [warHp, setWarHp] = React.useState(WIELDER_HP);
  const [surgeUsed, setSurgeUsed] = React.useState(false);
  const [log, setLog] = React.useState<string[]>([]);

  // Kick off the encounter once.
  React.useEffect(() => {
    let cancelled = false;
    start
      .mutateAsync({ markId })
      .then((spec) => {
        if (cancelled) return;
        setFoe({ name: spec.name, hp: spec.hp, maxHp: spec.hp, atk: spec.atk });
        setPhase("fight");
        setLog([`A ${spec.name} rises from the Darkness.`]);
      })
      .catch(() => {
        if (!cancelled) setPhase("gone");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markId]);

  const finish = (outcome: "win" | "loss") => {
    resolve.mutate({ markId, outcome }, { onSuccess: outcome === "win" ? onResolved : undefined });
  };

  const play = (move: MoveKey) => {
    if (phase !== "fight" || !foe) return;
    if (move === "surge" && surgeUsed) return;

    const dmg = MOVES[move].damage;
    const lines: string[] = [];
    if (move === "surge") setSurgeUsed(true);

    const foeHp = foe.hp - dmg;
    lines.push(dmg > 0 ? `You ${MOVES[move].label.toLowerCase()} for ${dmg}.` : `You brace.`);

    if (foeHp <= 0) {
      setFoe({ ...foe, hp: 0 });
      setLog((l) => [...lines, `The ${foe.name} fades. The breach is sealed.`, ...l]);
      setPhase("won");
      finish("win");
      return;
    }

    // The Heartless strikes back; Guard halves the incoming hit.
    const incoming = move === "guard" ? Math.ceil(foe.atk / 2) : foe.atk;
    const newWar = warHp - incoming;
    lines.push(`The ${foe.name} hits you for ${incoming}.`);
    setFoe({ ...foe, hp: foeHp });

    if (newWar <= 0) {
      setWarHp(0);
      setLog((l) => [...lines, `You're overwhelmed and retreat.`, ...l]);
      setPhase("lost");
      finish("loss");
      return;
    }
    setWarHp(newWar);
    setLog((l) => [...lines, ...l]);
  };

  return (
    <div className="bg-background w-full rounded-lg border p-4 shadow-lg">
      {phase === "loading" ? (
        <div className="py-6 text-center text-sm">Approaching the Darkness…</div>
      ) : phase === "gone" ? (
        <div className="py-4 text-center">
          <p className="text-sm">That Darkness has already cleared.</p>
          <button className="mt-3 rounded-md border px-3 py-1.5 text-sm" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <>
          <HpBar label="You" hp={warHp} max={WIELDER_HP} tone="#378ADD" />
          {foe ? <HpBar label={foe.name} hp={foe.hp} max={foe.maxHp} tone="#D85A30" /> : null}

          <div className="bg-muted/40 my-3 max-h-24 overflow-y-auto rounded-md p-2 text-xs leading-relaxed">
            {log.map((line, i) => (
              <div key={i} className={i === 0 ? "" : "text-muted-foreground"}>
                {line}
              </div>
            ))}
          </div>

          {phase === "fight" ? (
            <div className="flex gap-2">
              <button
                className="bg-primary text-primary-foreground flex-1 rounded-md px-3 py-2 text-sm"
                onClick={() => play("strike")}
              >
                {MOVES.strike.label}
              </button>
              <button
                className="flex-1 rounded-md border px-3 py-2 text-sm"
                onClick={() => play("guard")}
              >
                {MOVES.guard.label}
              </button>
              <button
                className="flex-1 rounded-md border px-3 py-2 text-sm disabled:opacity-40"
                disabled={surgeUsed}
                onClick={() => play("surge")}
              >
                {MOVES.surge.label}
              </button>
            </div>
          ) : (
            <div className="text-center">
              <p className="mb-2 text-sm font-medium">
                {phase === "won" ? "Breach sealed!" : "You retreat to regroup."}
              </p>
              <button className="rounded-md border px-3 py-1.5 text-sm" onClick={onClose}>
                Close
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
