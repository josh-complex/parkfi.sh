/**
 * The park page's headline numbers — rides open, average wait, longest wait —
 * derived from one live board. They used to live inside the blue stat bar
 * (`ParkStatCards`, retired with the Option C redesign); they're a pure
 * function so the ticket, the wash panel and any future surface all quote the
 * same figures.
 */

import { isHauntedHouse, isSingleRiderName } from "./lightning-lane.ts";
import type { BoardItem } from "./types.ts";

export interface ParkStats {
  /** Real attractions: no single-rider rows, no un-enriched ghost duplicates. */
  rides: Array<BoardItem>;
  operating: Array<BoardItem>;
  /** Rides down or in refurbishment right now. */
  issues: Array<BoardItem>;
  /** Mean posted standby across operating rides; null when nobody posts one. */
  avgWait: number | null;
  /** Operating rides with a posted standby, longest first. */
  busiest: Array<BoardItem>;
  /** The whole park is shut — every ride reads CLOSED (see `parks.board`). */
  closed: boolean;
}

/**
 * Two kinds of junk row ship in the feed beside the real attractions, and both
 * would double-count these tallies: Universal's standalone "<Ride> Single
 * Rider" rows, and un-enriched duplicates that never got a category. The board
 * table drops both the same way — see the memory notes
 * `single-rider-attraction-rows` and `ghost-duplicate-attractions`.
 */
export function parkStats(board: Array<BoardItem> | undefined): ParkStats {
  const rides = (board ?? []).filter(
    (b) => b.entityType === "ATTRACTION" && b.category != null && !isSingleRiderName(b.name),
  );
  const operating = rides.filter((b) => b.status === "OPERATING");
  const issues = rides.filter((b) => b.status === "DOWN" || b.status === "REFURBISHMENT");
  const waits = operating
    .map((b) => b.standbyWait)
    .filter((w): w is number => typeof w === "number");
  const avgWait =
    waits.length === 0 ? null : Math.round(waits.reduce((a, b) => a + b, 0) / waits.length);
  const busiest = operating
    .filter((b) => typeof b.standbyWait === "number")
    .sort((a, b) => (b.standbyWait ?? 0) - (a.standbyWait ?? 0));
  return {
    rides,
    operating,
    issues,
    avgWait,
    busiest,
    closed: rides.length > 0 && rides.every((b) => b.status === "CLOSED"),
  };
}

/**
 * The park's busiest rides for the "Right now" panel. Haunted houses are held
 * back the way the board holds them back: on an event night they are the only
 * rides posting a wait and they'd take every slot, and off one they're ten dead
 * closed rows — either way they're a separate, separately-ticketed evening.
 * They're allowed in only when nothing else is running.
 */
export function busiestRides(stats: ParkStats, limit: number): Array<BoardItem> {
  const ordinary = stats.busiest.filter((r) => !isHauntedHouse(r));
  return (ordinary.length > 0 ? ordinary : stats.busiest).slice(0, limit);
}

/** Cut points for a ride name's marketing tail ("VelociCoaster: The Ride"). */
const NAME_TAIL = /\s+[–—-]\s+|:\s+/;

/**
 * A ride name small enough for a ticket fact cell ("65 · Hagrid's"), which is
 * about a third of a phone-wide stub. The full name always travels with it as
 * the cell's tooltip, so this can afford to be aggressive.
 *
 * Possessives are the one special case worth having: "Hagrid's" identifies the
 * ride to anybody who'd recognise "Hagrid's Magical Creatures Motorbike
 * Adventure", where a blind truncation gives the useless "Hagrid's Magical…".
 */
export function shortRideName(name: string, max = 18): string {
  const clean = name.replace(/[™®©]/g, "").trim();
  const head = clean.split(NAME_TAIL)[0]!.trim() || clean;
  if (head.length <= max) return head;
  const first = head.split(/\s+/)[0]!;
  if (/['’]s$/.test(first)) return first;
  const words = head.split(/\s+/);
  let out = words[0]!;
  for (const word of words.slice(1)) {
    if (`${out} ${word}`.length > max) break;
    out = `${out} ${word}`;
  }
  // "TRON Lightcycle /" is a cut mid-name; drop the dangling connector so the
  // ellipsis does the work ("TRON Lightcycle…").
  return `${out.replace(/[\s/&+–—-]+$/, "")}…`;
}
