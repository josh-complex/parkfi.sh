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
 * Notably `FINISHED` means "sold out for the day"; `TEMP_FULL` (mostly Universal
 * virtual lines) means temporarily not distributing return times — we treat that
 * as LIMITED rather than dropping it to null.
 */
export function queueStateFromThemeparks(state?: string | null): QueueStateCode | null {
  switch (state) {
    case "AVAILABLE":
      return QueueState.AVAILABLE;
    case "LIMITED":
    case "TEMP_FULL":
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
 * The set of parks a Universal `partNumber` is valid at, decoded from its
 * taxonomy (see research/universal-ticket-deep-dive.md §1). Park scope codes:
 * 2P={USF,IOA}, 3P=+Epic, 4P=+Volcano Bay; explicit `EPIC`/`USF`/`UIOA`/`UVB`
 * tokens (and Express `AO-UEP_*_<PARK>`) name a single park. Stored as labels in
 * `product_dim.park_scope` (not park FKs — Universal pricing is SKU-keyed).
 */
export function universalParkScope(partNumber: string): Array<string> {
  const tokens = partNumber.split(/[-_]/);
  const has = (t: string) => tokens.includes(t);
  const scope = new Set<string>();

  // Explicit single-park tokens (Express SKUs + Epic/Volcano-Bay-only tickets).
  if (has("EPIC")) scope.add("EPIC");
  if (has("USF")) scope.add("USF");
  if (has("UIOA")) scope.add("UIOA");
  if (has("UVB")) scope.add("UVB");

  // Multi-park pool codes (TPA admission tickets).
  if (has("4P")) ["USF", "UIOA", "EPIC", "UVB"].forEach((p) => scope.add(p));
  else if (has("3P")) ["USF", "UIOA", "EPIC"].forEach((p) => scope.add(p));
  else if (has("2P")) ["USF", "UIOA"].forEach((p) => scope.add(p));
  else if (has("1P") && scope.size === 0) scope.add("USF"); // ambiguous one-park pool

  return [...scope];
}

/**
 * Decode a Universal `partNumber` into `product_dim` fields, per the taxonomy in
 * research/universal-ticket-deep-dive.md §1:
 *   TPA-{DUR}_{TYPE}_{PARKSCOPE}[_{ADDON}]_{AGE}[_GA]_{CONTRACT}[_FL][_{VARIANT}]
 * Express SKUs use the `AO-UEP_*` family.
 */
export interface UniversalSkuDims {
  family: "TICKET" | "ANNUAL" | "EXPRESS";
  durationDays: number | null;
  parkScope: Array<string>;
  parkToPark: boolean;
  ageGroup: "ADULT" | "CHILD" | null;
  residency: "STD" | "FL";
  passTier: "POWER" | "SEASONAL" | "PREFERRED" | "PREMIER" | null;
}

/**
 * Decode a WDW `productInstanceId` into `product_dim` fields, per the taxonomy
 * in research/disney-ticket-deep-dive.md §4:
 *   {productType}_{numDays}_{A|C}_{addOn}_{affiliation}_RF_AF_{SOF|SOT}_progenstr[_park]
 * 1-day products carry a `_mk/_ep/_hs/_ak` park suffix (the only park-resolved
 * rows); multi-day are valid at any park.
 */
export interface DisneySkuDims {
  family: string; // productType, e.g. 'theme-park' | 'canada-ticket'
  durationDays: number | null;
  parkScope: Array<string>;
  parkToPark: boolean;
  ageGroup: "ADULT" | "CHILD" | null;
  residency: "STD" | "FL" | "CA";
}

const DISNEY_PARK_SUFFIX: Record<string, string> = {
  mk: "MK",
  ep: "EP",
  hs: "HS",
  ak: "AK",
};

export function disneyDecodeSku(productInstanceId: string): DisneySkuDims {
  const t = productInstanceId.replace(/_progenstr/i, "").split("_");
  const numDays = Number(t[1]);
  const addOn = t[3]; // 0 | P | PHP | WPS
  const affiliation = t[4]; // 0 std | 2 FL | 21 Canada
  const park = DISNEY_PARK_SUFFIX[(t[t.length - 1] ?? "").toLowerCase()];
  return {
    family: t[0] ?? "theme-park",
    durationDays: Number.isFinite(numDays) ? numDays : null,
    parkScope: park ? [park] : ["MK", "EP", "HS", "AK"],
    parkToPark: addOn === "P" || addOn === "PHP",
    ageGroup: t[2] === "A" ? "ADULT" : t[2] === "C" ? "CHILD" : null,
    residency: affiliation === "2" ? "FL" : affiliation === "21" ? "CA" : "STD",
  };
}

export function universalDecodeSku(partNumber: string): UniversalSkuDims {
  const tokens = partNumber.split(/[-_]/);
  const has = (t: string) => tokens.includes(t);

  const isExpress = partNumber.startsWith("AO-UEP") || has("UEP");
  const isAnnual = has("12M") || has("AP");
  const family = isExpress ? "EXPRESS" : isAnnual ? "ANNUAL" : "TICKET";

  // DUR: 01D..07D -> 1..7; the Express add-on uses a bare `1D`.
  const dur = tokens.find((t) => /^0[1-7]D$/.test(t)) ?? (has("1D") ? "1D" : undefined);
  const durationDays = !isAnnual && dur ? Number(dur.replace(/^0/, "").replace(/D$/, "")) : null;

  const passTier = has("PWR")
    ? "POWER"
    : has("SEA")
      ? "SEASONAL"
      : has("PRF")
        ? "PREFERRED"
        : has("PRM")
          ? "PREMIER"
          : null;

  return {
    family,
    durationDays,
    parkScope: universalParkScope(partNumber),
    parkToPark: has("PTP"),
    ageGroup: has("AD") ? "ADULT" : has("CH") ? "CHILD" : null,
    residency: has("FL") ? "FL" : "STD",
    passTier,
  };
}
