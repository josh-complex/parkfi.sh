/**
 * Living Layer / Kingdom Hearts — scoped battle rules (M4a).
 *
 * Pure, deterministic functions (no I/O) so the encounter economy is testable
 * at the desk and the client + server agree on the same numbers. The turn-by-
 * turn loop runs in the UI ([battle-panel.tsx]); the server derives the Heartless
 * from the mark's payload (heartlessType + rarity) and validates the outcome.
 */
import { HeartlessType, type HeartlessTypeCode } from "./codes.ts";
import { tierFor, type ProximityTier } from "./geofence.ts";

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

/* -------------------------------------------------------------------------- *
 * Companions in battle (GDD §6 / §3.6 — decided 2026-07-03)
 *
 * A recruited party member takes **one ally action per round** — an attacker
 * hits the Heartless, a support mends the Wielder — and enjoys a **home-World
 * passive**: fought at the breach in the companion's own World, that action is
 * amplified. Geography is the party-builder — which ride broke decides who
 * fights at full strength. All pure/deterministic so the client and server
 * agree and it's tunable at the desk (battle.test.ts).
 *
 * BALANCE: with an empty party this is a no-op — the solo tuning above stands.
 * A fielded attacker meaningfully shortens a Breaker fight (that's the felt
 * power of recruiting); low ranks field only one slot, so the shift is gated.
 * -------------------------------------------------------------------------- */

export type CompanionRole = "attacker" | "support";

/** A recruited companion as the battle needs it (from the roster join). */
export interface CompanionInput {
  id: number;
  name: string;
  element: string | null;
  role: string | null;
  /** Per-Wielder roster level (wielder_companion.level). */
  level: number;
  baseStats: { hp?: number; atk?: number } | null;
  homeWorldId: number | null;
  homeParkId: number | null;
}

/** A companion resolved for one specific breach — ready for the turn loop. */
export interface FieldedCompanion {
  id: number;
  name: string;
  element: string | null;
  role: CompanionRole;
  /** Where the Wielder is relative to this companion's home (home | guest). */
  tier: ProximityTier;
  /** What the ally action does each round. */
  kind: "attack" | "heal";
  /** Magnitude of the action (foe damage for attack, HP mended for heal). */
  action: number;
}

/**
 * Party slots unlocked by rank (GDD §3.6 / §4.1): 1 at Dreamer, a 2nd at
 * Apprentice (rank 5), a 3rd at Guardian (rank 15). Capacity gates *how many*
 * companions field — never which verbs the Wielder has.
 */
export function partyCapacity(rank: number): number {
  if (rank >= 15) return 3;
  if (rank >= 5) return 2;
  return 1;
}

/** Home-World passive: the amplifier on an ally action by proximity tier. */
const TIER_MULT: Record<ProximityTier, number> = { home: 1.5, guest: 1, away: 0 };

/** Base ally-action magnitude before the tier amplifier (level nudges it up). */
function actionBase(c: CompanionInput): number {
  const atk = Math.max(0, Math.floor(c.baseStats?.atk ?? 0));
  return atk + Math.max(0, Math.floor(c.level) - 1);
}

/**
 * Resolve the Wielder's roster into the party that actually fights this breach.
 * Pure: each companion's proximity tier comes from `tierFor` (home if the breach
 * is in their World, guest elsewhere in-park, away in another park). Away
 * companions are benched; the rest sort home-first then by action, capped at the
 * rank's party capacity.
 */
export function fieldParty(
  roster: ReadonlyArray<CompanionInput>,
  breachWorldId: number | null,
  breachParkId: number | null,
  rank: number,
): FieldedCompanion[] {
  return roster
    .map((c): FieldedCompanion => {
      const tier = tierFor({
        homeWorldId: c.homeWorldId,
        currentWorldId: breachWorldId,
        homeParkId: c.homeParkId,
        currentParkId: breachParkId,
      });
      const role: CompanionRole = c.role === "support" ? "support" : "attacker";
      return {
        id: c.id,
        name: c.name,
        element: c.element,
        role,
        tier,
        kind: role === "support" ? "heal" : "attack",
        action: Math.round(actionBase(c) * TIER_MULT[tier]),
      };
    })
    .filter((c) => c.tier !== "away" && c.action > 0)
    .sort((a, b) => (a.tier !== b.tier ? (a.tier === "home" ? -1 : 1) : b.action - a.action))
    .slice(0, partyCapacity(rank));
}
