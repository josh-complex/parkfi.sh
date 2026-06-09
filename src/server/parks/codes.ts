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

/**
 * Classify a ThemeParks.wiki `/schedule` purchase `id` into a park-date *bundle*
 * product + tier (for `product_price_obs`). Returns null for anything that isn't
 * a park-grain bundle — notably per-attraction Lightning Lane (`lightninglane_<id>`),
 * which is attraction-grain and captured on `queue_obs` via the `/live` poller.
 * Premier Pass is folded into LL Multi as the `Premier` tier (no distinct code).
 *   lightninglanemultipass_*  -> LL Multi, tier ''
 *   premierpass_*             -> LL Multi, tier 'Premier'
 */
export function themeparksScheduleProduct(
  id: string,
): { productId: ProductCode; tier: string } | null {
  const s = id.toLowerCase();
  if (s.startsWith("lightninglanemultipass")) {
    return { productId: Product.LIGHTNING_LANE_MULTI, tier: "" };
  }
  if (s.startsWith("premierpass")) {
    return { productId: Product.LIGHTNING_LANE_MULTI, tier: "Premier" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Map-pin categories (geo enrichment). Our taxonomy:
//   thrill | attraction | water | show | dine | shop | character | info
// ---------------------------------------------------------------------------

export type MapCategory =
  | "thrill"
  | "attraction"
  | "water"
  | "show"
  | "dine"
  | "shop"
  | "character"
  | "info";

/** Default pin class from a ThemeParks.wiki entityType (the geo backbone). */
export function categoryFromEntityType(entityType?: string | null): MapCategory {
  switch ((entityType ?? "").toUpperCase()) {
    case "ATTRACTION":
      return "attraction";
    case "SHOW":
      return "show";
    case "RESTAURANT":
      return "dine";
    default:
      return "info";
  }
}

/**
 * Disney explorer `pin` string -> our pin class (WDW override). The finder's pin
 * vocabulary (verified live): activities, characters, fireworks, parades, shows,
 * water-rides, thrill, info, dine, shop. Normalize tolerantly and fall back to
 * null (caller keeps the entityType-derived default) on anything unknown.
 */
export function categoryFromDisneyPin(pin?: string | null): MapCategory | null {
  const p = (pin ?? "").toLowerCase();
  if (!p) return null;
  if (p.includes("thrill") || p.includes("coaster")) return "thrill";
  if (p.includes("water")) return "water";
  if (p.includes("character")) return "character";
  if (
    p.includes("show") ||
    p.includes("fireworks") ||
    p.includes("parade") ||
    p.includes("entertainment")
  )
    return "show";
  if (p.includes("dining") || p.includes("dine") || p.includes("restaurant") || p.includes("food"))
    return "dine";
  if (p.includes("shop") || p.includes("merchandise") || p.includes("store")) return "shop";
  if (p === "info") return "info";
  if (p.includes("attraction") || p.includes("ride") || p.includes("activit")) return "attraction";
  return null;
}

/**
 * Rewrite a Disney finder thumbnail URL's resize segment to a larger hero size.
 * The finder serves ~90px thumbnails via a `/resize/mwImage/1/{w}/{h}/75/`
 * segment; Disney's own `transcodeTemplate` reuses the same `{width}/{height}`
 * slots, so swapping in 800x450 yields a clean hero. Returns null when the URL
 * doesn't carry the expected segment (degrade to the thumbnail).
 */
export function disneyHeroUrl(thumbUrl?: string | null): string | null {
  if (!thumbUrl) return null;
  const re = /\/resize\/mwImage\/1\/\d+\/\d+\/75\//;
  if (!re.test(thumbUrl)) return null;
  return thumbUrl.replace(re, "/resize/mwImage/1/800/450/75/");
}

export interface DisneyFacetInfo {
  land: string | null;
  heightRequirement: string | null;
  tags: Array<string>;
}

/**
 * Parse a Disney finder marker's `facets` (a 3-group array-of-arrays of labels)
 * into structured fields. Facet ordering is a heuristic, so each extraction
 * degrades to null/empty rather than throwing on an unexpected shape:
 *  - heightRequirement = first label (any group) that looks like a height rule
 *  - land              = last element of the LAST group (the [park, land] group)
 *  - tags              = every label in the non-location groups, minus the
 *                        height label
 */
export function parseDisneyFacets(facets?: Array<Array<string>> | null): DisneyFacetInfo {
  const groups = (facets ?? []).filter((g) => Array.isArray(g) && g.length > 0);
  if (groups.length === 0) return { land: null, heightRequirement: null, tags: [] };

  const heightRe = /\d+\s*"|taller|any height|height/i;
  const all = groups.flat();
  const heightRequirement = all.find((label) => heightRe.test(label)) ?? null;

  // The last group is the location group ([park, land]); its last element is the land.
  const lastGroup = groups[groups.length - 1];
  const land = lastGroup[lastGroup.length - 1] ?? null;

  // Tags come from every group EXCEPT the trailing location group, with the
  // height label removed (it's surfaced separately).
  const tags = groups
    .slice(0, -1)
    .flat()
    .filter((label) => label !== heightRequirement);

  return { land, heightRequirement, tags };
}

// ---------------------------------------------------------------------------
// Universal Orlando "places" feed -> geo enrichment (the UOR analog of the
// Disney finder). We can't join on ids: our `external_ids` store the
// ThemeParks.wiki UUID (not the operator's `uor.*` id), and the places feed's
// `place_id` prefix is unreliable for park scoping (amenities are all
// `uor.amenities.*`, and Epic's id token `ueu` disagrees with its `venue_id`
// `uor.eu`). Instead we join on the authoritative `venue_id` -> park map plus a
// normalized attraction name (verified 100% coverage across USF/IOA/Epic).
// ---------------------------------------------------------------------------

const SMALL_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "the", "to"]);

/** Title-case a space-separated phrase, keeping small joiner words lowercase. */
function titleCase(s: string): string {
  const words = s.toLowerCase().split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Lowercased, punctuation-stripped name — the cross-feed join key. */
export function normalizeUniversalName(name?: string | null): string {
  return (
    (name ?? "")
      .toLowerCase()
      .replace(/[™®©]/g, "")
      // Drop apostrophes so "Hagrid's" == "Hagrids" (join the word, don't split it).
      .replace(/['’`]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

/**
 * Universal place `place_type.type` + `categories` -> our pin class. Tolerant
 * keyword match over the combined haystack, ordered so the specific ride classes
 * (thrill/water) win before the generic "attraction", and dining/shop/show beat
 * the catch-all amenity -> info. Returns null on anything unknown (caller keeps
 * the entityType-derived default).
 */
export function categoryFromUniversalPlace(
  type?: string | null,
  categories?: Array<string> | null,
): MapCategory | null {
  const hay = `${type ?? ""} ${(categories ?? []).join(" ")}`.toLowerCase();
  if (!hay.trim()) return null;
  if (/thrill|coaster|intense/.test(hay)) return "thrill";
  if (/water/.test(hay)) return "water";
  if (/character|meet/.test(hay)) return "character";
  if (/dining|dine|restaurant|food|snack|beverage|quick-service|table-service/.test(hay))
    return "dine";
  if (/shop|retail|merchandise|store/.test(hay)) return "shop";
  if (/show|entertain|theat|cinema|parade|firework|fountain/.test(hay)) return "show";
  if (/ride|attraction|family|kid|play/.test(hay)) return "attraction";
  if (/amenity|locker|restroom|atm|photo|service|first.aid/.test(hay)) return "info";
  return null;
}

/**
 * Pick the hero + thumbnail from a place's `images[]` by `image_kind`, falling
 * back to the first usable image. Universal places carry no alt text, so the
 * place name is the alt. Prefers the desktop variant of each image.
 */
export function universalPlaceImages(
  images?: Array<{
    desktop?: string;
    mobile?: string;
    tablet?: string;
    image_kind?: string | null;
  }>,
  name?: string | null,
): { thumb: string | null; hero: string | null; alt: string | null } {
  const urlOf = (img?: { desktop?: string; mobile?: string; tablet?: string }) =>
    img?.desktop ?? img?.tablet ?? img?.mobile ?? null;
  let hero: string | null = null;
  let thumb: string | null = null;
  for (const img of images ?? []) {
    const kind = (img.image_kind ?? "").toLowerCase();
    const url = urlOf(img);
    if (!url) continue;
    if (!hero && kind.includes("hero")) hero = url;
    // Prefer an actual tile/list photo over the `avatarImage` (usually a logo);
    // the logo is still picked up by the first-usable fallback below.
    if (!thumb && /tile|icon|filterlist/.test(kind)) thumb = url;
  }
  const first = urlOf((images ?? []).find((img) => urlOf(img)));
  return { thumb: thumb ?? first, hero: hero ?? first, alt: name ?? null };
}

/** Humanize a place's `categories` slugs into display tags ("quick-service" -> "Quick Service"). */
export function universalPlaceTags(categories?: Array<string> | null): Array<string> {
  return (categories ?? []).map((c) => titleCase(c.replace(/[-_]/g, " "))).filter(Boolean);
}

/**
 * Fallback land label derived from a `land_id` slug (`uor.ioa.<land>` -> "The
 * Land"). Only used when the land isn't in the feed's own Land-place registry —
 * some parks (Epic) use cryptic slugs (`uor.eu.snw`), so the registry is
 * preferred; this just avoids a null when a land is missing from it.
 */
export function universalLandLabel(landId?: string | null): string | null {
  if (!landId) return null;
  const parts = landId.toLowerCase().split(".").filter(Boolean);
  let i = 0;
  if (parts[i] === "uo" || parts[i] === "uor") i += 1;
  i += 1; // drop the venue segment
  const slug = parts.slice(i).join("_");
  if (!slug) return null;
  const label = titleCase(slug.replace(/_/g, " "));
  return label || null;
}

/** The official detail-page URL from a place's `urls[]`, if present. */
export function universalDetailUrl(
  urls?: Array<{ url?: string; url_type?: string }> | null,
): string | null {
  for (const u of urls ?? []) {
    if ((u.url_type ?? "") === "PLACE_POI_DETAILS" && u.url) return u.url;
  }
  return null;
}

// Place `categories` that mark a table-service / reservable restaurant (verified
// live). Quick-service / mobile-food-ordering / snacks carry none of these and
// have no reservation-availability feed.
const UNIVERSAL_RESERVABLE_CATEGORIES = new Set([
  "casual-dining",
  "full-service",
  "fine-dining",
  "character-dining",
]);

/** Whether a dining place takes reservations (worth sweeping the availability feed). */
export function universalDiningBookable(categories?: Array<string> | null): boolean {
  return (categories ?? []).some((c) => UNIVERSAL_RESERVABLE_CATEGORIES.has(c.toLowerCase()));
}

/** Most specific dining experience label from a place's categories. */
export function universalDiningExperience(categories?: Array<string> | null): string | null {
  const set = new Set((categories ?? []).map((c) => c.toLowerCase()));
  if (set.has("fine-dining")) return "Fine Dining";
  if (set.has("character-dining")) return "Character Dining";
  if (set.has("full-service")) return "Full Service";
  if (set.has("casual-dining")) return "Casual Dining";
  return null;
}

/**
 * Coarse meal period from a "HH:MM" reservation slot time. Universal slots carry
 * no meal period (Disney's do), so we derive one — it both labels the slot and
 * keeps it distinguishable from the empty-string "none available" sentinel in
 * `dining_obs`.
 */
export function universalMealPeriod(time: string): string {
  const head = (time ?? "").split(":")[0];
  if (!head) return "Dining"; // Number("") is 0, so guard the empty case explicitly
  const hour = Number(head);
  if (!Number.isFinite(hour)) return "Dining";
  if (hour < 11) return "Breakfast";
  if (hour < 16) return "Lunch";
  return "Dinner";
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
