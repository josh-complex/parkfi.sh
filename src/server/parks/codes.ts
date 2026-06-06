/**
 * Smallint code constants matching the reference tables in `src/db/schema.ts`.
 * Hot tables store these ints; reference tables hold the human-readable codes.
 * Keep these in lock-step with `src/db/seed.ts`.
 */

export const QueueType = {
  STANDBY: 1,
  SINGLE_RIDER: 2,
  RETURN_TIME: 3,
  PAID_RETURN_TIME: 4,
  PAID_STANDBY: 5,
  BOARDING_GROUP: 6,
} as const;
export type QueueTypeCode = (typeof QueueType)[keyof typeof QueueType];

export const AttractionStatus = {
  UNKNOWN: 0,
  OPERATING: 1,
  DOWN: 2,
  CLOSED: 3,
  REFURBISHMENT: 4,
} as const;
export type AttractionStatusCode = (typeof AttractionStatus)[keyof typeof AttractionStatus];

export const QueueState = {
  AVAILABLE: 1,
  LIMITED: 2,
  SOLD_OUT: 3,
  NOT_OFFERED: 4,
  PAUSED: 5,
} as const;
export type QueueStateCode = (typeof QueueState)[keyof typeof QueueState];

export const Source = {
  THEMEPARKS_WIKI: 1,
  QUEUE_TIMES: 2,
  DISNEY_DIRECT: 3,
  UNIVERSAL_DIRECT: 4,
} as const;
export type SourceCode = (typeof Source)[keyof typeof Source];

export const Product = {
  LIGHTNING_LANE_MULTI: 1,
  LIGHTNING_LANE_SINGLE: 2,
  DISNEY_VIRTUAL_QUEUE: 3,
  UNIVERSAL_EXPRESS: 4,
  UNIVERSAL_VIRTUAL_LINE: 5,
  SIXFLAGS_FLASH_PASS: 6,
  CEDAR_FAIR_FAST_LANE: 7,
  SEAWORLD_QUICK_QUEUE: 8,
  // Date-based admission tickets (demand-priced). Disney D2 / Universal U2.
  DISNEY_TICKET: 9,
  UNIVERSAL_TICKET: 10,
} as const;
export type ProductCode = (typeof Product)[keyof typeof Product];

// ---------------------------------------------------------------------------
// Mappers from upstream string enums -> our smallint codes
// ---------------------------------------------------------------------------

/** ThemeParks.wiki `status` -> AttractionStatus code. */
export function statusFromThemeparks(status?: string | null): AttractionStatusCode {
  switch (status) {
    case "OPERATING":
      return AttractionStatus.OPERATING;
    case "DOWN":
      return AttractionStatus.DOWN;
    case "CLOSED":
      return AttractionStatus.CLOSED;
    case "REFURBISHMENT":
      return AttractionStatus.REFURBISHMENT;
    default:
      return AttractionStatus.UNKNOWN;
  }
}

/**
 * ThemeParks.wiki queue `state` -> QueueState code.
 * Notably `FINISHED` means "sold out for the day".
 */
export function queueStateFromThemeparks(state?: string | null): QueueStateCode | null {
  switch (state) {
    case "AVAILABLE":
      return QueueState.AVAILABLE;
    case "LIMITED":
      return QueueState.LIMITED;
    case "FINISHED":
      return QueueState.SOLD_OUT;
    case "PAUSED":
      return QueueState.PAUSED;
    case "NOT_OFFERED":
      return QueueState.NOT_OFFERED;
    default:
      return null;
  }
}

/** Disney availability-calendar string -> QueueState code. */
export function availabilityToQueueState(availability?: string | null): QueueStateCode {
  switch (availability) {
    case "full":
      return QueueState.AVAILABLE;
    case "partial":
      return QueueState.LIMITED;
    case "none":
      return QueueState.SOLD_OUT;
    default:
      return QueueState.NOT_OFFERED;
  }
}

// ---------------------------------------------------------------------------
// Universal Orlando web-store (api.universalparks.com) helpers
// ---------------------------------------------------------------------------

/**
 * The Universal `partNumber` encodes the park as its trailing token, e.g.
 * `AO-UEP_UU_USF` -> USF, `AO-UEP_01U_PV_UVB` -> UVB, `AO-UEP_1D_01U_EPIC` ->
 * EPIC. These match the `external_ids` we seed under `UNIVERSAL_DIRECT`.
 */
export function universalParkCode(partNumber: string): string | null {
  const token = partNumber.split("_").pop();
  return token && token.length > 0 ? token : null;
}

/** Express products carry the `UEP` (Universal Express Pass) segment. */
export function universalProductId(partNumber: string): ProductCode {
  return partNumber.includes("UEP") ? Product.UNIVERSAL_EXPRESS : Product.UNIVERSAL_TICKET;
}

/**
 * Universal `priceAndInventory/v2` availability -> QueueState. `available` and
 * `availableUnits` arrive as strings; `"0"` on either means sold out.
 */
export function universalAvailabilityToQueueState(
  available?: string | null,
  availableUnits?: string | null,
): QueueStateCode {
  if (available === "0" || availableUnits === "0") return QueueState.SOLD_OUT;
  return QueueState.AVAILABLE;
}
