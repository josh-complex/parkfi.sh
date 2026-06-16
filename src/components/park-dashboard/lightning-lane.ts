import { QueueType } from "#/server/parks/codes.ts";

import type { BoardItem } from "./types.ts";

/**
 * Operator-aware view of an attraction's paid/virtual line.
 *
 * The per-ride "skip the line" product differs by operator:
 *  - **Disney** → Lightning Lane. Most rides are LL **Multi** (a RETURN_TIME
 *    queue, bundled price); a few premium rides are LL **Single** (a
 *    PAID_RETURN_TIME queue, à-la-carte with a price).
 *  - **Universal** → labeled "Express". The per-ride signal we get is the
 *    RETURN_TIME (Virtual Line) queue; true Universal Express is a *park-wide*
 *    paid product whose pricing lives on the tickets page.
 *
 * `has` comes from authoritative capability (`supportsQueueTypes`), so it's true
 * even when no return time is posted right now. `state` is the current, fresh
 * availability (null when nothing is posted).
 */
export interface PaidLineInfo {
  has: boolean;
  product: string | null;
  kind: string | null;
  state: string | null;
  soldOut: boolean;
  priceCents: number | null;
  returnStart: string | null;
  returnEnd: string | null;
}

/**
 * Structural subset of a board/attraction row the paid-line logic reads. Both
 * `parks.board` rows and the single `parks.attraction` row satisfy it, so the
 * ride detail page and the board share this helper.
 */
export type PaidLineSource = Pick<
  BoardItem,
  "supportsQueueTypes" | "returnTimeState" | "returnTimeWindow" | "lightningLane"
>;

const EMPTY: PaidLineInfo = {
  has: false,
  product: null,
  kind: null,
  state: null,
  soldOut: false,
  priceCents: null,
  returnStart: null,
  returnEnd: null,
};

export function isUniversal(operatorSlug: string | null | undefined): boolean {
  return operatorSlug === "universal";
}

/**
 * Universal posts a standalone "<Ride> Single Rider" attraction row alongside
 * the main ride. We collapse those into the parent (hide the row, flag the base
 * ride as accepting single riders), so these helpers detect such rows and
 * recover the parent ride's name for matching.
 */
const SINGLE_RIDER_RE = /\s*[-–—:]?\s*single\s+rider\b.*$/i;

export function isSingleRiderName(name: string): boolean {
  return /\bsingle\s+rider\b/i.test(name);
}

/** The parent ride's name, with the "Single Rider" suffix stripped. */
export function baseRideName(name: string): string {
  return name.replace(SINGLE_RIDER_RE, "").trim();
}

/** Loose key for matching a single-rider row to its parent ride row. */
export function normalizeRideName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Human label for an operator's per-ride line product. */
export function paidLineProduct(operatorSlug: string | null | undefined): string {
  return isUniversal(operatorSlug) ? "Express" : "Lightning Lane";
}

export function paidLineInfo(
  item: PaidLineSource,
  operatorSlug: string | null | undefined,
): PaidLineInfo {
  const supports = item.supportsQueueTypes;
  const sold = (s: string | null) => s === "SOLD_OUT";

  if (isUniversal(operatorSlug)) {
    // Universal: free Virtual Line (RETURN_TIME / BOARDING_GROUP capability).
    const has =
      supports.includes(QueueType.RETURN_TIME) || supports.includes(QueueType.BOARDING_GROUP);
    if (!has) return EMPTY;
    return {
      has: true,
      product: "Express",
      kind: null,
      state: item.returnTimeState,
      soldOut: sold(item.returnTimeState),
      priceCents: null,
      returnStart: item.returnTimeWindow.start,
      returnEnd: item.returnTimeWindow.end,
    };
  }

  // Disney: Lightning Lane — prefer the priced Single signal, else Multi.
  const single = supports.includes(QueueType.PAID_RETURN_TIME);
  const multi = supports.includes(QueueType.RETURN_TIME);
  if (!single && !multi) return EMPTY;
  if (single) {
    return {
      has: true,
      product: "Lightning Lane",
      kind: "Single",
      state: item.lightningLane.state,
      soldOut: sold(item.lightningLane.state),
      priceCents: item.lightningLane.priceCents,
      returnStart: item.lightningLane.returnStart,
      returnEnd: item.lightningLane.returnEnd,
    };
  }
  return {
    has: true,
    product: "Lightning Lane",
    kind: "Multi",
    state: item.returnTimeState,
    soldOut: sold(item.returnTimeState),
    priceCents: null,
    returnStart: item.returnTimeWindow.start,
    returnEnd: item.returnTimeWindow.end,
  };
}

export function formatPriceCents(cents: number | null, currency: string | null): string | null {
  if (cents == null) return null;
  const symbol = !currency || currency === "USD" ? "$" : "";
  return `${symbol}${(cents / 100).toFixed(2)}`;
}
