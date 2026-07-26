import { QueueType } from "#/server/parks/codes.ts";

import type { BoardItem } from "./types.ts";

/**
 * Operator-aware view of an attraction's paid/virtual line.
 *
 * The per-ride "skip the line" product differs by operator:
 *  - **Disney** → Lightning Lane. Most rides are LL **Multi** (a RETURN_TIME
 *    queue, bundled price); a few premium rides are LL **Single** (a
 *    PAID_RETURN_TIME queue, à-la-carte with a price).
 *  - **Universal** → two DIFFERENT products, which this used to conflate. The
 *    free **Virtual Line** is the per-ride RETURN_TIME/BOARDING_GROUP queue.
 *    **Express** is a separate park-wide paid add-on whose per-ride eligibility
 *    Universal publishes itself (`attraction_meta.express_pass`) and whose
 *    pricing lives on the tickets page. Labelling the Virtual Line "Express"
 *    both mislabelled the 28 rides that have a virtual queue and hid Express
 *    from the 64 rides that accept it. `expressPass` is now read as its own
 *    signal.
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
  /**
   * Universal only: the ride accepts Express Pass, per the operator's own feed.
   * Independent of `has` — Express is a park-wide paid add-on, not this ride's
   * queue — so a ride can accept Express with no virtual line, and vice versa.
   * Null at Disney and wherever Universal publishes nothing (never "false").
   */
  expressPass: boolean | null;
}

/**
 * Structural subset of a board/attraction row the paid-line logic reads. Both
 * `parks.board` rows and the single `parks.attraction` row satisfy it, so the
 * ride detail page and the board share this helper.
 */
export type PaidLineSource = Pick<
  BoardItem,
  "supportsQueueTypes" | "returnTimeState" | "returnTimeWindow" | "lightningLane"
> & { meta?: { expressPass?: boolean | null } | null };

const EMPTY: PaidLineInfo = {
  has: false,
  product: null,
  kind: null,
  state: null,
  soldOut: false,
  priceCents: null,
  returnStart: null,
  returnEnd: null,
  expressPass: null,
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
  return isUniversal(operatorSlug) ? "Virtual Line" : "Lightning Lane";
}

export function paidLineInfo(
  item: PaidLineSource,
  operatorSlug: string | null | undefined,
): PaidLineInfo {
  const supports = item.supportsQueueTypes;
  const sold = (s: string | null) => s === "SOLD_OUT";

  if (isUniversal(operatorSlug)) {
    // Universal: the free Virtual Line (RETURN_TIME / BOARDING_GROUP capability)
    // and Express Pass eligibility are separate facts — carry both, and don't
    // call one by the other's name.
    const expressPass = item.meta?.expressPass ?? null;
    const has =
      supports.includes(QueueType.RETURN_TIME) || supports.includes(QueueType.BOARDING_GROUP);
    if (!has) return { ...EMPTY, expressPass };
    return {
      has: true,
      product: "Virtual Line",
      kind: null,
      state: item.returnTimeState,
      soldOut: sold(item.returnTimeState),
      priceCents: null,
      returnStart: item.returnTimeWindow.start,
      returnEnd: item.returnTimeWindow.end,
      expressPass,
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
      expressPass: null,
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
    expressPass: null,
  };
}

export function formatPriceCents(cents: number | null, currency: string | null): string | null {
  if (cents == null) return null;
  const symbol = !currency || currency === "USD" ? "$" : "";
  return `${symbol}${(cents / 100).toFixed(2)}`;
}
