/**
 * Smallint code constants matching the reference tables in `src/db/schema.ts`.
 * Hot tables store these ints; reference tables hold the human-readable codes.
 * Keep these in lock-step with `src/db/seed.ts`.
 */
import type { ParkHeroSlide } from "../../db/schema.ts";

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
  // External feature feeds for wait-time forecasting (services/cron-weather).
  OPENWEATHER: 5,
  // Hand-curated figures with no upstream feed (services/coaster-stats seed.csv).
  MANUAL_SEED: 6,
  /**
   * OpenStreetMap (Overpass). Park outlines have always come from here; it is
   * also the only source that maps in-park amenities individually — both
   * operators publish one representative location per service per park (Epic
   * Universe publishes none at all). Community-maintained and ODbL-licensed, so
   * these rows carry their own source and NEVER overwrite an operator's.
   */
  OSM: 7,
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

/**
 * Boarding-group `allocationStatus` -> QueueState code (plan item 1.5). Reuses
 * the QueueState vocabulary rather than a new ref table: AVAILABLE = groups
 * being distributed, PAUSED = distribution paused, SOLD_OUT = the day's groups
 * all distributed (`CLOSED` upstream).
 */
export function boardingAllocationFromThemeparks(state?: string | null): QueueStateCode | null {
  if (state === "CLOSED") return QueueState.SOLD_OUT;
  return queueStateFromThemeparks(state);
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
 * Class a non-facility Disney finder POI marker (guest-services / entertainment
 * / events-tours) into the map-pin category the client plots it as. Distinct
 * from `categoryFromDisneyPin` (attractions): these feed the `park_poi` table
 * and its own overlay layers, so the vocabulary is the four POI groups —
 *   info          guest services (restrooms, first aid, transport, lockers…)
 *   character     character meet-and-greets (pin 'characters')
 *   entertainment parades / fireworks / stage shows / streetmosphere
 *   tour          hard-ticket events + guided tours (the events-tours markers)
 * `poiType` is the marker `type`; `pin` is its raw finder pin.
 */
export type PoiCategory = "info" | "character" | "entertainment" | "tour";
export function categoryFromDisneyPoi(
  pin: string | null | undefined,
  poiType: string | null | undefined,
): PoiCategory {
  if (poiType === "guest-services") return "info";
  if (poiType === "events-tours") return "tour";
  // entertainment: split character meets out from the rest (parades, fireworks,
  // shows, cavalcades/streetmosphere which carry the generic 'activities' pin).
  return (pin ?? "").toLowerCase().includes("character") ? "character" : "entertainment";
}

/**
 * Rewrite a Disney finder thumbnail URL's resize segment to a larger hero size.
 * The finder serves ~90px thumbnails via a `/resize/mwImage/1/{w}/{h}/75/`
 * segment; Disney's own `transcodeTemplate` reuses the same `{width}/{height}`
 * slots, so swapping in 800x450 yields a clean hero. Returns null when the URL
 * doesn't carry the expected segment (degrade to the thumbnail).
 */
const MW_IMAGE_RESIZE_RE = /\/resize\/mwImage\/1\/\d+\/\d+\/75\//;

export function disneyHeroUrl(thumbUrl?: string | null): string | null {
  if (!thumbUrl) return null;
  if (!MW_IMAGE_RESIZE_RE.test(thumbUrl)) return null;
  return thumbUrl.replace(MW_IMAGE_RESIZE_RE, "/resize/mwImage/1/800/450/75/");
}

/**
 * Rewrite a Disney CDN image URL's resize segment down to a small list-tile
 * size. The resort catalog stores a single full 1600x900 hero URL (used as-is
 * on the detail page); shelf/grid cards render only a couple hundred px wide,
 * so requesting a proportionally smaller asset here cuts payload size and
 * load time for the browse/search views. Returns null when the URL doesn't
 * carry the expected resize segment (degrade to the original).
 */
export function disneyThumbUrl(url?: string | null): string | null {
  if (!url) return null;
  if (!MW_IMAGE_RESIZE_RE.test(url)) return null;
  return url.replace(MW_IMAGE_RESIZE_RE, "/resize/mwImage/1/640/360/75/");
}

/**
 * Rewrite a Disney finder URL's resize segment to a card-sized 16:9 asset. The
 * ride shelves render each attraction in a ~300px-wide box; the stored
 * `image_thumb_url` is only ~90px (blurry when upscaled) and the full hero is
 * 800x450 (more bytes than the card needs), so 600px wide covers a 2x display
 * without over-fetching. Returns null when the URL lacks the resize segment
 * (e.g. Universal CDN assets — degrade to the caller's fallback).
 */
export function disneyCardUrl(url?: string | null): string | null {
  if (!url) return null;
  if (!MW_IMAGE_RESIZE_RE.test(url)) return null;
  return url.replace(MW_IMAGE_RESIZE_RE, "/resize/mwImage/1/600/338/75/");
}

interface DisneyHeroImage {
  type?: string;
  poster?: string;
  desktop?: string;
  tablet?: string;
  mobile?: string;
  alt?: string;
  // Video slides: mp4 rendition URLs, largest first.
  source?: Array<string>;
}

/**
 * Strip inline HTML (Disney copy carries <em> etc.) and collapse whitespace —
 * the shared cleaner for official description text before it lands in a
 * `description` column.
 */
export function stripInlineHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pick a park-level hero photo from the Disney finder `heroData`. Prefers the
 * `mediaEngine.data` slide carousel (the four theme parks): first video slide's
 * `poster` still, then any image slide. Falls back to the single `media` image
 * (the water parks, which carry no carousel). The chosen URL's
 * `/resize/mwImage/1/{w}/{h}/75/` segment is upsized to a crisp 16:9 hero.
 * Returns null when nothing carries a usable image. `alt` comes from the slide/
 * image when present, else null.
 */
export function disneyParkHero(
  slides?: Array<DisneyHeroImage> | null,
  fallback?: DisneyHeroImage | null,
): { url: string; alt: string | null } | null {
  const urlOf = (s: DisneyHeroImage): string | null =>
    s.poster ?? s.desktop ?? s.tablet ?? s.mobile ?? null;
  const list = slides ?? [];
  // Video posters first (the destination still), then any image slide, then the
  // single `media` fallback (water parks).
  const chosen =
    list.find((s) => s.type === "video" && urlOf(s)) ??
    list.find((s) => urlOf(s)) ??
    (fallback && urlOf(fallback) ? fallback : null);
  if (!chosen) return null;
  const url = urlOf(chosen);
  if (!url) return null;
  return { url: disneyHeroUrl(url) ?? url, alt: chosen.alt ?? null };
}

/**
 * Normalize the full finder hero carousel into `parks.hero_media` slides (plan
 * item 1.9). Image slides keep their best still upsized to the 16:9 hero size;
 * video slides keep the first (largest) mp4 rendition + an upsized poster. The
 * feed repeats renditions of the same video as separate slides, so de-dupe on
 * the primary URL. Returns null when nothing usable (callers store null, not []).
 */
export function disneyParkHeroSlides(
  slides?: Array<DisneyHeroImage> | null,
  fallback?: DisneyHeroImage | null,
): Array<ParkHeroSlide> | null {
  const out: Array<ParkHeroSlide> = [];
  const seen = new Set<string>();
  const list = [...(slides ?? []), ...(fallback ? [fallback] : [])];
  for (const s of list) {
    const video = s.type === "video" ? (s.source?.find(Boolean) ?? null) : null;
    const still = s.poster ?? s.desktop ?? s.tablet ?? s.mobile ?? null;
    const url = video ?? (still ? (disneyHeroUrl(still) ?? still) : null);
    if (!url) continue;
    // De-dupe sans query (rendition timestamps differ, asset doesn't). The
    // feed repeats one video as slides with DIFFERENT mp4 rendition URLs but
    // the same poster — so videos key on their poster when they have one.
    const key = (video && still ? still : url).split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: video ? "video" : "image",
      url,
      poster: video && still ? (disneyHeroUrl(still) ?? still) : null,
      alt: s.alt ?? null,
    });
  }
  return out.length > 0 ? out : null;
}

interface DisneyEntitySlide {
  type?: string | null;
  thumbnail?: string | null;
  mobile?: string | null;
  source?: string | Array<string> | null;
  alt?: string | null;
}

/**
 * Normalize a per-entity `mediaEngine.data` collection (ride/venue detail
 * payloads — plan item 1.9, ride-level) into the shared `ParkHeroSlide` shape.
 * Image slides carry `source` as one 1600x900 URL (fallback `mobile`);
 * `video` / `cinemagraph` slides carry a rendition array — prefer the mp4
 * (Safari) and upsize the 43px square `thumbnail` into the poster via the
 * mwImage resize segment. Stored order is normalized to cinemagraph → video →
 * stills (stable within each kind) so slide 0 is always the best ambient
 * asset regardless of feed order; de-duped sans query. Null when nothing
 * usable.
 */
export function disneyEntityHeroSlides(
  slides?: Array<DisneyEntitySlide> | null,
): Array<ParkHeroSlide> | null {
  const rank = (s: DisneyEntitySlide): number =>
    s.type === "cinemagraph" ? 0 : s.type === "video" ? 1 : 2;
  const ordered = [...(slides ?? [])].sort((a, b) => rank(a) - rank(b));
  const out: Array<ParkHeroSlide> = [];
  const seen = new Set<string>();
  for (const s of ordered) {
    const sources = Array.isArray(s.source) ? s.source : s.source ? [s.source] : [];
    const isVideo = s.type === "video" || s.type === "cinemagraph";
    const url = isVideo
      ? (sources.find((u) => /\.mp4(\?|$)/.test(u)) ?? sources[0] ?? null)
      : (sources[0] ?? s.mobile ?? null);
    if (!url) continue;
    const key = url.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: isVideo ? "video" : "image",
      url,
      poster: isVideo && s.thumbnail ? (disneyHeroUrl(s.thumbnail) ?? s.thumbnail) : null,
      alt: s.alt ?? null,
    });
  }
  return out.length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// Disney typed facet slugs (`list-ancestor-entities/.../attractions`) — the
// data version of the prose labels `parseDisneyFacets` reads off a map marker.
// See research/disney-content-parity.md §2. Pure mappers over one result's
// `facets` record plus the feed's own `flatFacets` label dictionary.
// ---------------------------------------------------------------------------

/** Facet groups that describe *what a ride is*, in the order we want them read. */
const DISNEY_TAG_GROUPS = ["thrillFactor", "interests", "entertainmentType", "age"] as const;

/** Facet groups that describe *who can ride and how* — the accessibility strip. */
const DISNEY_ACCESSIBILITY_GROUPS = [
  "mobilityDisabilities",
  "hearingandVisualDisability",
  "serviceAnimals",
  "physicalConsiderations",
] as const;

/**
 * Slug -> label dictionary built from the feed's own `filters.flatFacets`
 * (60 entries across the 9 groups we read). Disney publishes far more slug
 * values than it defines here — `interests` alone carries values the dictionary
 * never lists — so callers fall back to `humanizeDisneyFacetSlug`.
 */
export function disneyFacetLabels(
  defs?: Array<{ urlFriendlyId: string; value?: string | null }> | null,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of defs ?? []) {
    const label = d.value?.trim();
    if (d.urlFriendlyId && label) out.set(d.urlFriendlyId, label);
  }
  return out;
}

/**
 * Last-resort humanization for a slug the dictionary doesn't define:
 * `animal-encounters-attractions` -> "Animal Encounters". The trailing
 * `-attractions` / `-entertainments` / `-events` qualifier is Disney's way of
 * scoping the same interest to an entity type, and `-rec` marks a
 * recommendation bucket — neither belongs in a guest-facing chip.
 */
const FACET_ACRONYMS = new Set(["atm", "aed", "ecv", "vip", "dvc", "vq", "3d", "4d"]);
const FACET_STOPWORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "or", "the", "to"]);

export function humanizeDisneyFacetSlug(slug: string): string {
  const trimmed = slug
    .trim()
    .replace(/-(attractions|entertainments|events|dining|wdw)$/i, "")
    .replace(/-rec$/i, "");
  if (!trimmed) return "";
  return trimmed
    .split("-")
    .filter(Boolean)
    .map((word, i) => {
      const w = word.toLowerCase();
      if (FACET_ACRONYMS.has(w)) return w.toUpperCase();
      if (i > 0 && FACET_STOPWORDS.has(w)) return w;
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function facetLabelList(
  facets: Record<string, Array<string>> | null | undefined,
  groups: ReadonlyArray<string>,
  labels: Map<string, string>,
): Array<string> {
  const out: Array<string> = [];
  for (const group of groups) {
    for (const slug of facets?.[group] ?? []) {
      const label = labels.get(slug) ?? humanizeDisneyFacetSlug(slug);
      if (label && !out.includes(label)) out.push(label);
    }
  }
  return out;
}

/**
 * Ride/show descriptors for `attraction_meta.tags` — the typed replacement for
 * the prose labels the map marker carries. PhotoPass is folded in as a tag
 * rather than a column: it's a single boolean-ish fact with no filter of its own
 * yet, and `tags` is already the chip source both operators share.
 */
export function disneyFacetTags(
  facets?: Record<string, Array<string>> | null,
  labels: Map<string, string> = new Map(),
): Array<string> {
  const out = facetLabelList(facets, DISNEY_TAG_GROUPS, labels);
  const photoPass = (facets?.photoPassAvailable ?? []).length > 0;
  if (photoPass && !out.includes("PhotoPass")) out.push("PhotoPass");
  return out;
}

/**
 * Accessibility strip for `attraction_meta.accessibility` — the WDW counterpart
 * to `universalAccessibilityLabels`. Disney splits the same information across
 * four facet groups (mobility, hearing/visual, service animals, physical
 * considerations); we flatten them in that order, which is how the operator's
 * own detail modal groups them.
 */
export function disneyAccessibilityLabels(
  facets?: Record<string, Array<string>> | null,
  labels: Map<string, string> = new Map(),
): Array<string> {
  return facetLabelList(facets, DISNEY_ACCESSIBILITY_GROUPS, labels);
}

/**
 * Numeric height bounds from the typed `height` facet. Slugs are
 * `any-height` | `NN-inches-MMM-cm-or-taller` | `NN-inches-MMM-cm-or-shorter`,
 * so this needs no prose parsing and — unlike Universal's cumulative buckets —
 * a ride carries exactly its own rule. `any-height` yields `{ min: 0 }`, the
 * value the no-height-requirement filter tests.
 *
 * A ride can carry both directions (a kiddie ride with a floor and a ceiling);
 * when several "or taller" slugs appear we keep the LOWEST, since that is the
 * one that admits the most guests and matches the operator's own slider.
 */
export function disneyHeightsFromFacets(heightSlugs?: Array<string> | null): {
  min: number | null;
  max: number | null;
} {
  let min: number | null = null;
  let max: number | null = null;
  for (const raw of heightSlugs ?? []) {
    const slug = raw.trim().toLowerCase();
    if (!slug) continue;
    if (slug === "any-height") {
      min = min == null ? 0 : Math.min(min, 0);
      continue;
    }
    const m = /^(\d+)-inches\b/.exec(slug);
    if (!m) continue;
    const inches = Number(m[1]);
    if (!Number.isFinite(inches)) continue;
    if (slug.endsWith("-or-shorter")) max = max == null ? inches : Math.max(max, inches);
    else if (slug.endsWith("-or-taller")) min = min == null ? inches : Math.min(min, inches);
  }
  return { min, max };
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
  const rawHeight = all.find((label) => heightRe.test(label)) ?? null;
  // Disney's labels carry a non-breaking space between the number and its
  // unit (e.g. `112 cm`); normalize so we render `112cm` with no gap.
  const heightRequirement = rawHeight ? rawHeight.replace(/(\d)\s*(cm|mm|m|")/gi, "$1$2") : null;

  // The last group is the location group ([park, land]); its last element is the land.
  const lastGroup = groups[groups.length - 1];
  const land = lastGroup[lastGroup.length - 1] ?? null;

  // Tags come from every group EXCEPT the trailing location group, with the
  // height label removed (it's surfaced separately). Compare against the raw
  // label since that's what still lives in the groups.
  const tags = groups
    .slice(0, -1)
    .flat()
    .filter((label) => label !== rawHeight);

  return { land, heightRequirement, tags };
}

// ---------------------------------------------------------------------------
// Disney "finder" dining catalog (public list-ancestor-entities feed) -> our
// `restaurant_dim` fields. Pure mappers over the `facets`/labels of one entry.
// ---------------------------------------------------------------------------

/** Normalize the finder `entityType` to our `restaurant_dim` entity_type enum. */
export function disneyDiningEntityType(
  entityType?: string | null,
): "restaurant" | "dinner-show" | "dining-event" {
  const t = (entityType ?? "").toLowerCase();
  if (t === "restaurant") return "restaurant";
  if (t.includes("dinner")) return "dinner-show";
  return "dining-event"; // Dining-Event / Event / anything else
}

/**
 * Dining entity types the availability sweep polls. dine-vas getAvailability
 * serves dinner-shows and dining-events (e.g. Hoop-Dee-Doo, Victoria & Albert's
 * Chef's Table) over the same path as plain restaurants, so the sweep — and the
 * `priority` curation that feeds it — treat all three as candidates.
 */
export const SWEEPABLE_DINING_ENTITY_TYPES = ["restaurant", "dinner-show", "dining-event"] as const;

/**
 * Whether a dining facility accepts online reservations (sweepable). The finder
 * marks these with a `checkavailmodulewdw` checkAvailability facet and/or a
 * `reservations-accepted` tableService facet.
 */
export function disneyDiningBookable(facets?: {
  checkAvailability?: Array<string>;
  tableService?: Array<string>;
}): boolean {
  return (
    (facets?.checkAvailability ?? []).includes("checkavailmodulewdw") ||
    (facets?.tableService ?? []).includes("reservations-accepted")
  );
}

/** Humanize the cuisine facets (["steakhouse-cuisine"] -> "Steakhouse"). */
export function disneyDiningCuisine(cuisine?: Array<string> | null): string | null {
  const labels = (cuisine ?? []).map((c) =>
    titleCase(c.replace(/-cuisine$/, "").replace(/-/g, " ")),
  );
  return labels.length > 0 ? labels.join(", ") : null;
}

/**
 * The price descriptor from a finder `facetsLabel`
 * ("$$$ ($35 to $59.99 per adult), American, Steakhouse" -> "$$$ ($35 to $59.99
 * per adult)"), falling back to the bare `priceRangeDining` symbol. Null when the
 * label carries no price (e.g. cuisine-only labels).
 */
export function disneyDiningPriceRange(
  facetsLabel?: string | null,
  priceRangeDining?: Array<string> | null,
): string | null {
  const m = (facetsLabel ?? "").match(/^\$+(?:\s*\([^)]*\))?/);
  if (m) return m[0].trim();
  return priceRangeDining?.[0] ?? null;
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
// Universal mobile-services (services.universalorlando.com) helpers — the typed
// POI/venue catalog. See research/universal-content-parity.md §2.3.
// ---------------------------------------------------------------------------

/**
 * Height requirement as the display string the ride card already renders, in
 * the exact shape the Disney finder publishes (`40" (102cm) or taller`) so both
 * operators read identically. `0` inches is the operator's explicit "no minimum"
 * and renders as Disney's own "Any Height"; `null` in means null out (unknown).
 */
export function heightRequirementLabel(
  minInches?: number | null,
  maxInches?: number | null,
): string | null {
  const cm = (inches: number) => Math.round(inches * 2.54);
  if (minInches != null && minInches > 0) {
    return `${minInches}" (${cm(minInches)}cm) or taller`;
  }
  if (maxInches != null && maxInches > 0) {
    return `${maxInches}" (${cm(maxInches)}cm) or shorter`;
  }
  return minInches === 0 || maxInches === 0 ? "Any Height" : null;
}

/**
 * Inverse of `heightRequirementLabel` — pull numeric inches back out of a stored
 * `height_requirement` string. Used to backfill the numeric columns for the WDW
 * rows the Disney finder only gives us prose for, so the height-band filter is
 * one comparison across both operators. "Any Height" is a real Disney value
 * meaning no requirement, so it yields `{ min: 0 }` — the reason the filter
 * tests `min_height_in`, not `height_requirement IS NULL`.
 */
export function parseHeightRequirementInches(label?: string | null): {
  min: number | null;
  max: number | null;
} {
  const text = (label ?? "").trim();
  if (!text) return { min: null, max: null };
  if (/^any height$/i.test(text)) return { min: 0, max: null };
  const inches = /(\d+(?:\.\d+)?)\s*["”″]/.exec(text);
  if (!inches) return { min: null, max: null };
  const n = Math.round(Number.parseFloat(inches[1]));
  if (!Number.isFinite(n)) return { min: null, max: null };
  return /shorter|under|maximum|below/i.test(text) ? { min: null, max: n } : { min: n, max: null };
}

/** "KidFriendly" / "Video3D4D" / "HHNHouse" -> "Kid Friendly" / "3D/4D" / "HHN House". */
const UNIVERSAL_TYPE_LABELS: Record<string, string> = {
  Video3D4D: "3D/4D",
  HHNHouse: "Haunted House",
  WaterThrill: "Water Thrill",
  WaterFamily: "Water Family",
  WaterRelax: "Water Relax",
  WaterKids: "Water Kids",
};

/**
 * Humanize the `RideTypes` / `ShowTypes` PascalCase vocabulary into the display
 * tags `attraction_meta.tags` already carries for WDW ("Thrill Rides", …).
 */
export function universalTypeLabels(types?: Array<string> | null): Array<string> {
  const out: Array<string> = [];
  for (const raw of types ?? []) {
    const type = raw.trim();
    if (!type) continue;
    const label = UNIVERSAL_TYPE_LABELS[type] ?? type.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * Humanize the `AccessibilityOptions` vocabulary. The `InApp*` variants are the
 * Universal app's own assistive features — kept, but labelled so they read as
 * device features rather than in-queue accommodations.
 */
const UNIVERSAL_ACCESSIBILITY_LABELS: Record<string, string> = {
  ClosedCaption: "Closed captioning",
  StandardWheelchair: "Standard wheelchair accessible",
  AnyWheelchair: "Any wheelchair accessible",
  StationarySeating: "Stationary seating available",
  WheelchairMustTransfer: "Must transfer from wheelchair",
  ECVMustTransfer: "Must transfer from ECV",
  TestSeat: "Test seat available",
  AssistiveListening: "Assistive listening",
  InAppAssistiveListening: "Assistive listening (app)",
  InAppClosedCaptions: "Closed captioning (app)",
  InAppDescriptiveAudio: "Descriptive audio (app)",
  InAppMultilanguageAudio: "Multi-language audio (app)",
  ParentalDiscretionAdvised: "Parental discretion advised",
  // Universal's catch-all "see the rider's guide" marker — no guest-facing
  // meaning on its own, so it's dropped rather than labelled.
  ExtraInfo: "",
};

export function universalAccessibilityLabels(options?: Array<string> | null): Array<string> {
  const out: Array<string> = [];
  for (const raw of options ?? []) {
    const key = raw.trim();
    if (!key) continue;
    const label =
      key in UNIVERSAL_ACCESSIBILITY_LABELS
        ? UNIVERSAL_ACCESSIBILITY_LABELS[key]
        : key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * The POI feed's amenity/entertainment buckets -> a `park_poi` row's
 * (`poi_type`, `category`) pair. `category` stays in the four-value client
 * vocabulary the map layers already switch on (`PoiCategory`), while `poi_type`
 * carries the specific kind — which is exactly the typing UOR was missing (every
 * amenity place used to land as an untyped `info` row).
 *
 * Buckets deliberately absent: `Rides`/`Shows`/`Parades` enrich `attractions`
 * and their own entertainment rows (handled separately), `DiningLocations` /
 * `Shops` / `Hotels` have their own catalog dims.
 */
export const UNIVERSAL_POI_BUCKETS: Record<string, { poiType: string; category: PoiCategory }> = {
  Restrooms: { poiType: "restroom", category: "info" },
  Lockers: { poiType: "locker", category: "info" },
  Atms: { poiType: "atm", category: "info" },
  FirstAidStations: { poiType: "first-aid", category: "info" },
  LostAndFoundStations: { poiType: "lost-and-found", category: "info" },
  GuestServices: { poiType: "guest-services", category: "info" },
  ServiceAnimalRestAreas: { poiType: "service-animal-area", category: "info" },
  SmokingAreas: { poiType: "smoking-area", category: "info" },
  FamilyServices: { poiType: "family-services", category: "info" },
  ChargingStations: { poiType: "charging-station", category: "info" },
  Rentals: { poiType: "rental", category: "info" },
  GeneralLocations: { poiType: "general", category: "info" },
  NightlifeLocations: { poiType: "nightlife", category: "entertainment" },
  Games: { poiType: "game", category: "entertainment" },
};

/**
 * Disney guest-service entity name -> the SAME `poi_type` vocabulary
 * `UNIVERSAL_POI_BUCKETS` writes, so a services pin means the same thing at
 * both resorts (the Disney finder types its guest-service markers only as
 * `guest-services`, where Universal's feed is bucketed by kind).
 *
 * Matched against the marker's generic `card.name` ("Restrooms"), not the
 * location-specific marker name ("Bayou Restrooms"), and by substring so the
 * handful of decorated variants land too. Order matters — first hit wins, so
 * the more specific patterns are listed first.
 */
const DISNEY_POI_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\brestroom/i, "restroom"],
  [/\bwater bottle refill|\bdrinking (water|fountain)/i, "water-refill"],
  [/\baed\b|defibrillator/i, "aed"],
  [/first aid/i, "first-aid"],
  [/\batm\b|\bbanking\b/i, "atm"],
  [/locker/i, "locker"],
  [/lost and found/i, "lost-and-found"],
  [/smoking/i, "smoking-area"],
  [/service animal/i, "service-animal-area"],
  [/baby care|nursing|companion restroom/i, "family-services"],
  [/charging (station|service)|phone charging/i, "charging-station"],
  [/picture spot|photopass/i, "photo-spot"],
  [/pressed (coin|penny)/i, "pressed-coin"],
  [/rental|rentals/i, "rental"],
  [
    /parking|monorail|skyliner|bus service|water transportation|minnie van|car (care|rental)|transportation/i,
    "transportation",
  ],
  [/guest relations|guest services|disability access/i, "guest-services"],
];

export function disneyPoiType(entityName?: string | null, fallbackName?: string | null): string {
  const name = (entityName ?? fallbackName ?? "").trim();
  if (!name) return "general";
  for (const [re, type] of DISNEY_POI_TYPE_PATTERNS) if (re.test(name)) return type;
  return "general";
}

/**
 * OpenStreetMap amenity tag -> the same shared `poi_type` vocabulary.
 *
 * Deliberately narrow: only tags whose meaning is unambiguous in a theme park.
 * `amenity=shelter` is excluded even though it is the densest tag in the WDW
 * bbox (133) — most of those are bus-stop and queue shelters, which would bury
 * the pins that matter.
 */
const OSM_POI_TYPES: Record<string, string> = {
  toilets: "restroom",
  drinking_water: "water-refill",
  water_point: "water-refill",
  atm: "atm",
  bank: "atm",
  bureau_de_change: "atm",
  first_aid: "first-aid",
  charging_station: "charging-station",
  locker: "locker",
  smoking_area: "smoking-area",
  baby_hatch: "family-services",
  nursery: "family-services",
};

export function osmPoiType(tags?: Record<string, string> | null): string | null {
  const amenity = tags?.amenity ?? "";
  if (amenity && amenity in OSM_POI_TYPES) return OSM_POI_TYPES[amenity];
  // `healthcare=first_aid` is the newer tagging for the same thing.
  if (tags?.healthcare === "first_aid") return "first-aid";
  return null;
}

/** Guest-facing name for an OSM amenity pin (OSM rarely names these nodes). */
const OSM_POI_LABELS: Record<string, string> = {
  restroom: "Restrooms",
  "water-refill": "Drinking Water",
  atm: "ATM",
  "first-aid": "First Aid",
  "charging-station": "Charging Station",
  locker: "Lockers",
  "smoking-area": "Designated Smoking Area",
  "family-services": "Baby Care",
};

export function osmPoiName(poiType: string, tags?: Record<string, string> | null): string {
  return tags?.name?.trim() || OSM_POI_LABELS[poiType] || "Guest Service";
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

// ---------------------------------------------------------------------------
// Disney water-park tickets (scraped from the static /tickets/water-parks/ page).
// Unlike the demand-priced theme-park feed, water-park admission is a flat list
// price hardcoded in the page markup — two tiers (a full-price ticket valid any
// day, and a cheaper one blocked out during summer). We model each tier as a
// `product_dim.family`, valid at "whichever water park is open" (park_scope
// covers both). See `services/cron-tickets/main.ts` (step D3).
// ---------------------------------------------------------------------------

/** `product_dim.family` values for the two water-park ticket tiers. */
export const WDW_WATER_PARK_FAMILY = "water-park" as const;
export const WDW_WATER_PARK_BLOCKOUT_FAMILY = "water-park-blockout" as const;
export const WDW_WATER_PARK_FAMILIES = [
  WDW_WATER_PARK_FAMILY,
  WDW_WATER_PARK_BLOCKOUT_FAMILY,
] as const;

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** "$74.00" / "$1,234.50" -> integer cents, or null when unparseable. */
function dollarsToCents(text: string): number | null {
  const n = Number(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

export interface WaterParkTierPrice {
  adultCents: number;
  childCents: number;
}
export interface WaterParkTickets {
  /** Full-price 1-Day Water Park Ticket (valid any operating day). */
  regular: WaterParkTierPrice | null;
  /** Cheaper 1-Day ticket, not valid during the blockout ranges below. */
  blockout: WaterParkTierPrice | null;
  /** Inclusive [start, end] ISO date ranges the blockout ticket is NOT valid. */
  blockoutRanges: Array<{ start: string; end: string }>;
}

/** Adult + child price for one `waterParks-*` price block, keyed by its DOM id. */
function parseWaterParkTier(html: string, blockId: string): WaterParkTierPrice | null {
  const anchor = html.indexOf(`id="${blockId}"`);
  if (anchor === -1) return null;
  // The two blocks are adjacent in the page; a bounded slice keeps the
  // non-greedy price match anchored to THIS block, not the next tier's.
  const block = html.slice(anchor, anchor + 900);
  const priceOf = (which: "adultPrice" | "childPrice"): number | null => {
    const m = block.match(
      new RegExp(`class="${which} singlePrice">[\\s\\S]*?class="waterParkPrice">([^<]+)<`),
    );
    return m ? dollarsToCents(m[1]) : null;
  };
  const adultCents = priceOf("adultPrice");
  const childCents = priceOf("childPrice");
  if (adultCents == null || childCents == null) return null;
  return { adultCents, childCents };
}

/**
 * Parse the two ticket tiers + the blockout date ranges out of the water-parks
 * ticket page HTML. Each field degrades to null/empty rather than throwing, so a
 * markup change on one tier doesn't sink the whole capture.
 */
export function parseDisneyWaterParkTickets(html: string): WaterParkTickets {
  const regular = parseWaterParkTier(html, "waterParks-water-park");
  const blockout = parseWaterParkTier(html, "waterParks-water-park-blockout");

  // "May 23 to September 26, 2026 and May 23 to September 26, 2027" (the ranges
  // are repeated across the markup — dedupe on the ISO pair).
  const ranges = new Map<string, { start: string; end: string }>();
  const re = /([A-Za-z]+)\s+(\d{1,2})\s+to\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/g;
  for (const m of html.matchAll(re)) {
    const sMonth = MONTHS[m[1].toLowerCase()];
    const eMonth = MONTHS[m[3].toLowerCase()];
    if (!sMonth || !eMonth) continue;
    const year = m[5];
    const pad = (n: string | number) => String(n).padStart(2, "0");
    const start = `${year}-${pad(sMonth)}-${pad(m[2])}`;
    const end = `${year}-${pad(eMonth)}-${pad(m[4])}`;
    ranges.set(`${start}:${end}`, { start, end });
  }

  return { regular, blockout, blockoutRanges: [...ranges.values()] };
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
