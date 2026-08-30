import { config } from "../config.ts";
import {
  UniversalFiltersDataSchema,
  UniversalRidePageSchema,
  type UniversalFiltersData,
  type UniversalRidePage,
  type UniversalTile,
} from "../schemas.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * Universal's Tridion content feeds (research/universal-content-parity.md
 * §2.1/§2.2) — plain cookieless GETs against `/contentdata/…/index.html`, the
 * same trick the UOR menu ingest already rides. Two things live here:
 *
 *  1. `filtersdata` — the tile database behind universalorlando.com's own
 *     filter UI. One 1.4 MB GET carries card copy, real ALT TEXT and the
 *     interest/age taxonomies for ~340 POIs, with a `PublishedOn` stamp.
 *     Epic Universe was REMOVED from this feed in Aug 2026 — zero EU tiles
 *     remain — so it now covers USF/IOA/Volcano Bay/CityWalk only.
 *  2. The per-ride/show pages — the guest-facing attribute strip ("GDS -
 *     Utility Section" → `featureList`) plus the "GDS - Hero" masthead image.
 *     This is the ONLY height/Express/artwork source that covers Epic Universe
 *     (the mobile POI feed publishes null for every EU ride) and the most
 *     accurate height source resort-wide.
 *
 * Deliberately NOT taken from `filtersdata`: its `HeightRequirements` facet.
 * Those are cumulative "which height filters does this tile appear under"
 * buckets and they are tagged inconsistently — Caro-Seuss-el (no minimum on its
 * own page) carries a 34" bucket, and Hogwarts Express carries 48". Using the
 * lowest bucket as a minimum would invent requirements that don't exist, so
 * heights come from the ride pages and the POI feed's numeric field only.
 *
 * Everything is parsed by schema title + field NAME, never by position, so a
 * republished component or a reordered page is a no-op (plan §8 risk note).
 */

const UTILITY_SECTION_SCHEMA = "GDS - Utility Section";
const HERO_SCHEMA = "GDS - Hero";
const RIDE_PATH_PREFIX = "/things-to-do/rides-attractions/";
/**
 * Sitemap sections whose pages carry the Utility Section / Hero components.
 * Shows, entertainment and character encounters are included because Epic
 * Universe's theatre shows (The Untrainable Dragon, Le Cirque Arcanus) and
 * nighttime show live there — with no `filtersdata` tile, these pages are
 * their only artwork source. Pages that match no attraction never join.
 */
const PAGE_PATH_PREFIXES = [
  RIDE_PATH_PREFIX,
  "/things-to-do/shows/",
  "/things-to-do/entertainment/",
  "/things-to-do/character-encounters/",
];
const RETRY_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET one contentdata document. Null on a redirect (Universal's "no such page"
 * signal — the URL 301s to `oops-sorry`) or a 404; soft blocks retry with
 * jittered backoff. Mirrors `universal-menu.getPage`.
 */
async function getJson(url: string, attempts = 3): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(config.fetchTimeoutMs),
        headers: { accept: "application/json" },
      });
      if (res.status >= 300 && res.status < 400) return null;
      if (res.status === 404) return null;
      if (res.ok) return await res.json();
      const err = new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
      if (!RETRY_STATUS.has(res.status)) throw err;
      lastErr = err;
    } catch (err) {
      if (err instanceof UpstreamError && err.status != null && !RETRY_STATUS.has(err.status)) {
        throw err;
      }
      lastErr = err;
    }
    if (attempt < attempts) {
      const base = 300 * 2 ** (attempt - 1);
      await sleep(base + Math.random() * base);
    }
  }
  throw lastErr;
}

// --- filtersdata ----------------------------------------------------------

/** The whole tile database — one GET, edge-cached, no session. */
export async function fetchUniversalFiltersData(): Promise<UniversalFiltersData> {
  const url = `${config.universalContentBase}/uor/en/us/api/filtersdata/index.html`;
  const body = await getJson(url);
  if (body == null) throw new UpstreamError(`GET ${url} -> redirect/404`);
  return UniversalFiltersDataSchema.parse(body);
}

/** Tile copy + alt text + taxonomy labels, flattened for the enrichment pass. */
export interface UniversalTileInfo {
  heading: string | null;
  /** Venue keys from `AttractionLocations` (`usf` | `ioa` | `vb` | …). */
  locationKeys: Array<string>;
  description: string | null;
  /** Alt text from the tile/hero image — 338/339 tiles carry real copy. */
  imageAlt: string | null;
  imageTile: string | null;
  imageHero: string | null;
  /** `AttractionInterests` + `Age` labels ("Fun For Grownups", "Teens 13-17"). */
  interests: Array<string>;
  /** `AreasToExplore` label — Universal's own land name for the tile. */
  land: string | null;
}

/**
 * Interest/age labels carry a sort prefix in `Value` ("007 Fun For Grownups")
 * but `Description` is the clean display string; fall back to a stripped Value.
 */
function keywordLabel(kw: { Value?: string | null; Description?: string | null }): string | null {
  const raw = kw.Description?.trim() || kw.Value?.trim() || "";
  return raw.replace(/^\d{3}\s+/, "").trim() || null;
}

/** Absolute URL for a `/uor/en/us/files/…` content path. */
function contentImageUrl(path?: string | null): string | null {
  const raw = path?.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${config.universalWebBase}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

export function tileInfo(tile: UniversalTile): UniversalTileInfo {
  const content = tile.Content ?? {};
  const meta = tile.Meta ?? {};
  const tileImage = content.TileImage ?? null;
  const heroImage = content.HeroImage ?? null;
  const interests = [...(meta.AttractionInterests ?? []), ...(meta.Age ?? [])]
    .map(keywordLabel)
    .filter((v): v is string => v != null);
  return {
    heading: content.Heading?.trim() || null,
    locationKeys: (meta.AttractionLocations ?? [])
      .map((k) => k.Key?.trim())
      .filter((k): k is string => Boolean(k)),
    // Longest available copy wins, matching how the places feed prefers
    // `long_description` — these three are alternates, not a hierarchy of one text.
    description:
      [content.LongDescription, content.MediumDescription, content.ShortDescription]
        .map((d) => d?.trim() || null)
        .filter((d): d is string => d != null)
        .sort((a, b) => b.length - a.length)[0] ?? null,
    imageAlt: tileImage?.AltText?.trim() || heroImage?.AltText?.trim() || null,
    imageTile: contentImageUrl(
      tileImage?.DesktopTabletImage ?? tileImage?.HightResolutionImage ?? tileImage?.MobileImage,
    ),
    imageHero: contentImageUrl(
      heroImage?.HightResolutionImage ?? heroImage?.DesktopTabletImage ?? heroImage?.MobileImage,
    ),
    interests: [...new Set(interests)],
    land: (meta.AreasToExplore ?? []).map(keywordLabel).find((l) => l != null) ?? null,
  };
}

// --- per-ride pages -------------------------------------------------------

/** Attraction/show page paths from the public sitemap (the complete
 *  contentdata index), e.g. `/things-to-do/shows/le-cirque-arcanus`. */
export async function fetchUniversalPagePaths(signal: AbortSignal): Promise<Array<string>> {
  const url = `${config.universalWebBase}/web/en/us/sitemap.xml`;
  const res = await fetch(url, { signal, headers: { accept: "application/xml" } });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  const xml = await res.text();
  const paths = new Set<string>();
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    let path: string;
    try {
      path = new URL(match[1]).pathname;
    } catch {
      continue;
    }
    for (const prefix of PAGE_PATH_PREFIXES) {
      const idx = path.indexOf(prefix);
      if (idx === -1) continue;
      const slug = path.slice(idx + prefix.length).replace(/\/+$/, "");
      if (slug && !slug.includes("/")) paths.add(`${prefix}${slug}`);
      break;
    }
  }
  return [...paths];
}

/** One ride's guest-facing attribute strip, normalized. */
export interface UniversalRideFacts {
  slug: string;
  /** The page's own display name — the join key back to our attractions. */
  heading: string | null;
  /** `null` when the page publishes no height feature at all (unknown), `0` for
   *  an explicit "No Minimum Height". */
  minHeightIn: number | null;
  /** Ride Type labels ("Thrill", "Kid Friendly", "Water Ride"). */
  rideTypes: Array<string>;
  childSwap: boolean;
  /** The page carries an "Express Pass" feature. Boilerplate on some pages
   *  (it appears on Volcano Bay rides, where Express isn't sold), so this is
   *  only a fallback for rides the mobile POI feed doesn't cover. */
  expressPass: boolean;
  /** "Under 48" (122 cm) Requires Supervising Companion" and friends. */
  companionRequirement: string | null;
  singleRider: boolean;
  /** The page's "GDS - Hero" masthead image (desktop rendition preferred).
   *  The only artwork source covering Epic Universe since the `filtersdata`
   *  feed dropped its EU tiles (Aug 2026). */
  imageHero: string | null;
  /** Alt text off the same hero slot — real copy, like the tile feed's. */
  imageAlt: string | null;
}

/**
 * "Minimum Height 42” (107 cm)" → 42; "No Minimum Height" → 0; anything else →
 * null.
 *
 * The "Height Requirement" slot is NOT always a minimum height: every Volcano
 * Bay pool files `Guest Under 48" (122 cm) - Life Jackets Required` under it,
 * and several rides file a supervising-companion rule there. Reading the first
 * number out of those would invent a 48" minimum for a wading pool, so a
 * description only counts when it actually says "Minimum Height" or explicitly
 * says there is none.
 */
export function parseFeatureHeightInches(description?: string | null): number | null {
  const text = (description ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/no\s+(?:minimum\s+)?height/i.test(text)) return 0;
  const labelled = /minimum\s+height\s*:?\s*(\d+(?:\.\d+)?)/i.exec(text);
  if (!labelled) return null;
  const n = Number.parseFloat(labelled[1]);
  return Number.isFinite(n) && n >= 0 && n < 100 ? Math.round(n) : null;
}

/** First non-empty value of a Tridion text field. */
function val(field?: { Values?: Array<string> }): string | null {
  return field?.Values?.find((v) => v.trim())?.trim() ?? null;
}

/** Strip an XHTML fragment down to bare text (feature copy is often a link). */
function text(raw: string | null): string | null {
  if (raw == null) return null;
  const out = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return out || null;
}

/**
 * Read the "GDS - Utility Section" attribute strip off a parsed ride page.
 * Features are matched on their `heading` (the guest-facing label, the most
 * stable key) with the icon keyword as a secondary signal — the icon slugs vary
 * across templates for the same concept (`height-limit` / `height-requirement`,
 * `wheel-chair` / `accessibility`).
 */
/** First linked Multimedia URL of a hero breakpoint slot. */
function renditionUrl(rendition?: {
  LinkedComponentValues?: Array<{ Multimedia?: { Url?: string | null } | null }>;
}): string | null {
  return rendition?.LinkedComponentValues?.[0]?.Multimedia?.Url ?? null;
}

export function rideFactsFromPage(slug: string, page: UniversalRidePage): UniversalRideFacts {
  const facts: UniversalRideFacts = {
    slug,
    heading: null,
    minHeightIn: null,
    rideTypes: [],
    childSwap: false,
    expressPass: false,
    companionRequirement: null,
    singleRider: false,
    imageHero: null,
    imageAlt: null,
  };
  for (const cp of page.ComponentPresentations) {
    const component = cp.Component;
    if (component?.Schema?.Title === HERO_SCHEMA) {
      // Desktop and tablet are usually the same asset; mobile is a taller
      // crop — same preference order as `universalPlaceImages`.
      const slot = component.Fields?.image?.EmbeddedValues?.[0];
      facts.imageHero ??= contentImageUrl(
        renditionUrl(slot?.desktop) ?? renditionUrl(slot?.tablet) ?? renditionUrl(slot?.mobile),
      );
      facts.imageAlt ??= text(val(slot?.alt));
      continue;
    }
    if (component?.Schema?.Title !== UTILITY_SECTION_SCHEMA) continue;
    facts.heading ??= text(val(component.Fields?.heading));
    const features = (component.Fields?.featureList?.LinkedComponentValues ?? []).flatMap(
      (container) => container.Fields?.feature?.LinkedComponentValues ?? [],
    );
    for (const feature of features) {
      const heading = (text(val(feature.Fields?.heading)) ?? "").toLowerCase();
      const icon = (
        feature.Fields?.icon?.KeywordValues?.[0]?.Key ??
        val(feature.Fields?.icon) ??
        ""
      ).toLowerCase();
      const description = text(val(feature.Fields?.description));
      const is = (needle: string) => heading.includes(needle) || icon.includes(needle);

      if (is("supervising companion") || icon.includes("compaider")) {
        facts.companionRequirement ??= description;
      } else if (heading.includes("height") || icon.startsWith("height-")) {
        facts.minHeightIn ??= parseFeatureHeightInches(description);
      } else if (is("ride type")) {
        facts.rideTypes = (description ?? "")
          .split(/[,/]/)
          .map((t) => t.trim())
          .filter(Boolean);
      } else if (is("child swap")) {
        facts.childSwap = true;
      } else if (is("express pass")) {
        facts.expressPass = !/not\s+(?:available|accepted)/i.test(description ?? "");
      } else if (is("single rider")) {
        facts.singleRider = true;
      }
    }
  }
  return facts;
}

/** Fetch + parse one attraction/show page by its `/things-to-do/…` path; null
 *  when the path no longer resolves. */
export async function fetchUniversalRideFacts(path: string): Promise<UniversalRideFacts | null> {
  const body = await getJson(`${config.universalContentBase}/uor/en/us${path}/index.html`);
  if (body == null) return null;
  const slug = path.replace(/\/+$/, "").split("/").at(-1) ?? path;
  return rideFactsFromPage(slug, UniversalRidePageSchema.parse(body));
}

/**
 * Crawl every attraction/show/entertainment page in the sitemap, serially with
 * a polite gap (~95 pages, monthly — the whole pass is a couple of minutes). A
 * page that fails is skipped, not fatal: this is a fill-in layer over the POI
 * feed. Pages that match no attraction (CityWalk venues, arcades) simply never
 * join.
 */
export async function fetchAllUniversalRideFacts(
  signal: AbortSignal,
  delayMs = 150,
): Promise<Array<UniversalRideFacts>> {
  const paths = await fetchUniversalPagePaths(signal);
  const out: Array<UniversalRideFacts> = [];
  for (const path of paths) {
    try {
      const facts = await fetchUniversalRideFacts(path);
      if (facts?.heading) out.push(facts);
    } catch {
      // Skipped — the POI feed still covers this ride for everything but EU.
    }
    if (delayMs > 0) await sleep(delayMs);
  }
  return out;
}
