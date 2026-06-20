/**
 * Living Layer / Wayfarer — scoped battle rules (M4a).
 *
 * Pure, deterministic functions (no I/O) so the encounter economy is testable
 * at the desk and the client + server agree on the same numbers. The turn-by-
 * turn loop runs in the UI ([battle-panel.tsx]); the server derives the Faded
 * from the mark's payload (fadedType + rarity) and validates the outcome.
 */
import { FadedType, type FadedTypeCode } from "./codes.ts";

export type BattleOutcome = "win" | "loss" | "flee";

export interface FadedSpec {
  fadedType: FadedTypeCode;
  rarity: number;
  name: string;
  /** Hit points — what the player must whittle down. */
  hp: number;
  /** Damage the Faded deals to the player each turn. */
  atk: number;
}

const FADED_NAME: Record<FadedTypeCode, string> = {
  [FadedType.SHADE]: "Shade",
  [FadedType.WISP]: "Wisp",
  [FadedType.BREAKER]: "Breaker",
};

/** Per-type base stats; rarity scales them up so headliner-downs are tougher. */
const FADED_BASE: Record<FadedTypeCode, { hp: number; atk: number }> = {
  [FadedType.SHADE]: { hp: 20, atk: 4 },
  [FadedType.WISP]: { hp: 14, atk: 3 },
  [FadedType.BREAKER]: { hp: 30, atk: 6 },
};

/**
 * Deterministic Faded stats for an encounter. `rarity` (>=1) scales hp/atk so a
 * long-standby headliner going down (higher rarity) is a meatier fight.
 */
export function fadedSpec(fadedType: FadedTypeCode, rarity: number): FadedSpec {
  const base = FADED_BASE[fadedType] ?? FADED_BASE[FadedType.SHADE];
  const r = Math.max(1, Math.floor(rarity));
  return {
    fadedType,
    rarity: r,
    name: FADED_NAME[fadedType] ?? "Faded",
    hp: base.hp + (r - 1) * 10,
    atk: base.atk + (r - 1) * 2,
  };
}

/** The Warden's starting hit points for a scoped (single-Warden) battle. */
export const WARDEN_HP = 30;

/** Move damage. Surge is a one-per-battle heavy hit; guard halves the next hit. */
export const MOVES = {
  strike: { label: "Strike", damage: 6 },
  surge: { label: "Surge", damage: 14 },
  guard: { label: "Guard", damage: 0 },
} as const;
export type MoveKey = keyof typeof MOVES;
