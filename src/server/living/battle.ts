/**
 * Living Layer / Kingdom Hearts — scoped battle rules (M4a).
 *
 * Pure, deterministic functions (no I/O) so the encounter economy is testable
 * at the desk and the client + server agree on the same numbers. The turn-by-
 * turn loop runs in the UI ([battle-panel.tsx]); the server derives the Heartless
 * from the mark's payload (heartlessType + rarity) and validates the outcome.
 */
import { HeartlessType, type HeartlessTypeCode } from "./codes.ts";

export type BattleOutcome = "win" | "loss" | "flee";

export interface HeartlessSpec {
  heartlessType: HeartlessTypeCode;
  rarity: number;
  name: string;
  /** Hit points — what the player must whittle down. */
  hp: number;
  /** Damage the Heartless deals to the player each turn. */
  atk: number;
}

const HEARTLESS_NAME: Record<HeartlessTypeCode, string> = {
  [HeartlessType.SHADE]: "Shade",
  [HeartlessType.WISP]: "Wisp",
  [HeartlessType.BREAKER]: "Breaker",
};

/** Per-type base stats; rarity scales them up so headliner-downs are tougher. */
const HEARTLESS_BASE: Record<HeartlessTypeCode, { hp: number; atk: number }> = {
  [HeartlessType.SHADE]: { hp: 20, atk: 4 },
  [HeartlessType.WISP]: { hp: 14, atk: 3 },
  [HeartlessType.BREAKER]: { hp: 30, atk: 6 },
};

/**
 * Deterministic Heartless stats for an encounter. `rarity` (>=1) scales hp/atk so a
 * long-standby headliner going down (higher rarity) is a meatier fight.
 */
export function heartlessSpec(heartlessType: HeartlessTypeCode, rarity: number): HeartlessSpec {
  const base = HEARTLESS_BASE[heartlessType] ?? HEARTLESS_BASE[HeartlessType.SHADE];
  const r = Math.max(1, Math.floor(rarity));
  return {
    heartlessType,
    rarity: r,
    name: HEARTLESS_NAME[heartlessType] ?? "Heartless",
    hp: base.hp + (r - 1) * 10,
    atk: base.atk + (r - 1) * 2,
  };
}

/**
 * The Wielder's starting hit points for a scoped (single-Wielder) battle.
 *
 * BALANCE — every *real* Darkness spawn is a BREAKER at rarity 2 (short standby)
 * or 3 (long-standby headliner), never a Shade/Wisp (see `spawnDecision` in
 * darkness.ts). So the Wielder's kit is tuned against those, not the base Shade:
 *   • Breaker r2 (hp 40, atk 8): comfortably winnable, surge optional.
 *   • Breaker r3 (hp 50, atk 10): winnable, but ONLY if Surge is spent — a
 *     strike-only line dies one turn short. Surge is the skill expression.
 */
export const WIELDER_HP = 42;

/** Move damage. Surge is a one-per-battle heavy hit; guard halves the next hit. */
export const MOVES = {
  strike: { label: "Strike", damage: 9 },
  surge: { label: "Surge", damage: 22 },
  guard: { label: "Guard", damage: 0 },
} as const;
export type MoveKey = keyof typeof MOVES;
