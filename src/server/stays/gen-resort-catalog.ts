/**
 * One-off generator for the WDW resort catalog (`bun src/server/stays/gen-resort-catalog.ts`).
 *
 * The resort-availability API (see `availability.ts`) returns only numeric
 * facility IDs and prices — no names, images, or area. This script joins the
 * PUBLIC finder explorer feeds to produce the static reference table the Stays
 * UI joins against at request time:
 *   1. `list-ancestor-entities/.../resorts` — id, title, urlFriendlyId, groups.
 *   2. `details-entity-simple/.../{slug}` — hero image + resort-area location.
 * Tier (Value / Moderate / Deluxe / Deluxe Villas / Campground) isn't in any
 * feed, so it's a curated map keyed by slug below — stable, well-known facts.
 *
 * Output is committed as `resort-catalog.generated.ts`; rerun only when Disney
 * opens/renames a resort.
 */
import { writeFileSync } from "node:fs";

import { computeThumbhash } from "#/server/parks/thumbhash.ts";

const FINDER = "https://disneyworld.disney.go.com/finder/api/v1/explorer-service";
const DESTINATION = "80007798;entityType=destination";
const DATE = "2026-06-28";
const UA = "Mozilla/5.0 (compatible; parkfi.sh/1.0)";

type Tier = "value" | "moderate" | "deluxe" | "villa" | "campground";

// Disney's marketing classification, keyed by finder slug. Deluxe Villas are
// the DVC properties; "villa" covers them. Swan/Dolphin/Reserve are Marriott-run
// and never appear in resort-availability, but are tiered here for completeness.
const TIER: Record<string, Tier> = {
  "all-star-movies-resort": "value",
  "all-star-music-resort": "value",
  "all-star-sports-resort": "value",
  "art-of-animation-resort": "value",
  "pop-century-resort": "value",
  "caribbean-beach-resort": "moderate",
  "coronado-springs-resort": "moderate",
  "port-orleans-resort-french-quarter": "moderate",
  "port-orleans-resort-riverside": "moderate",
  "campsites-at-fort-wilderness-resort": "campground",
  "animal-kingdom-lodge": "deluxe",
  "beach-club-resort": "deluxe",
  "boardwalk-inn": "deluxe",
  "contemporary-resort": "deluxe",
  "grand-floridian-resort-and-spa": "deluxe",
  "polynesian-resort": "deluxe",
  "wilderness-lodge-resort": "deluxe",
  "yacht-club-resort": "deluxe",
  "dolphin-hotel": "deluxe",
  "swan-hotel": "deluxe",
  "swan-reserve": "deluxe",
  "bay-lake-tower-at-contemporary": "villa",
  "boulder-ridge-villas-at-wilderness-lodge": "villa",
  "copper-creek-villas-and-cabins": "villa",
  "animal-kingdom-villas-jambo": "villa",
  "animal-kingdom-villas-kidani": "villa",
  "beach-club-villas": "villa",
  "boardwalk-villas": "villa",
  "old-key-west-resort": "villa",
  "polynesian-villas-bungalows": "villa",
  "riviera-resort": "villa",
  "saratoga-springs-resort-and-spa": "villa",
  "villas-at-grand-floridian-resort-and-spa": "villa",
  "cabins-at-fort-wilderness-resort": "villa",
};

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

type Store = "wdw" | "dlr";

interface CatalogRow {
  id: string;
  name: string;
  slug: string;
  tier: Tier;
  area: string | null;
  image: string | null;
  /** ThumbHash placeholder of `image` (base64) — computed below at generation
   *  time, since the catalog is a committed constant with no DB row for the
   *  cron-driven filler to maintain. */
  imageThumbhash: string | null;
  detailUrl: string;
  /** Which Disney store (booking system) prices this resort. */
  store: Store;
}

const list = await getJson(`${FINDER}/list-ancestor-entities/wdw/${DESTINATION}/${DATE}/resorts`);
const resorts: Array<{ id: string; title: string; urlFriendlyId: string }> = (
  list.locations ?? []
).filter((l: any) => l.locationType === "resort");

console.log(`Found ${resorts.length} resort entities; fetching details…`);

const rows: Array<CatalogRow> = [];
for (const r of resorts) {
  const id = String(r.id).split(";")[0];
  const slug = r.urlFriendlyId;
  let area: string | null = null;
  let image: string | null = null;
  try {
    const d = await getJson(`${FINDER}/details-entity-simple/wdw/${slug}/${DATE}/`);
    area = d.aagData?.location ?? null;
    image = d.aagData?.media?.desktop ?? d.aagData?.media?.mobile ?? null;
  } catch (e) {
    console.warn(`  ! detail failed for ${slug}: ${(e as Error).message}`);
  }
  rows.push({
    id,
    name: r.title,
    slug,
    tier: TIER[slug] ?? "deluxe",
    area,
    image,
    imageThumbhash: null, // filled in one pass below
    detailUrl: `https://disneyworld.disney.go.com/resorts/${slug}/`,
    store: "wdw",
  });
  if (!TIER[slug]) console.warn(`  ? no tier mapping for slug "${slug}" — defaulting to deluxe`);
}

// Curated extras: resorts that exist in resort-availability but aren't returned
// by the finder `resorts` list (the finder lags new openings). Verified by hand.
const EXTRAS: Array<CatalogRow> = [
  {
    id: "411930769",
    name: "The Cabins at Disney's Fort Wilderness Resort",
    slug: "cabins-at-fort-wilderness-resort",
    tier: "villa",
    area: "Magic Kingdom Resort Area",
    image:
      "https://cdn1.parksmedia.wdprapps.disney.com/resize/mwImage/1/1600/900/75/dam/wdpro-assets/places-to-stay/cabins-at-fort-wilderness/cabins-at-fort-wilderness-resort-00.jpg",
    imageThumbhash: null, // filled in one pass below
    detailUrl: "https://disneyworld.disney.go.com/resorts/cabins-at-fort-wilderness-resort/",
    store: "wdw",
  },
];
for (const extra of EXTRAS) {
  if (!rows.some((r) => r.id === extra.id)) rows.push(extra);
}

rows.sort((a, b) => a.name.localeCompare(b.name));

// --- Disneyland Resort (DLR) ---------------------------------------------
// DLR is a separate Disney store with its own catalog + availability API (the
// `disneyland.disney.go.com/dlr-resort-list-api` host). Only 3 Disney-owned
// hotels, all Deluxe. Unlike WDW there's no finder "resort area", so `area` is
// a single bucket. Tier + slug + media come straight off the catalog feed.
const DLR_CATALOG_URL =
  "https://disneyland.disney.go.com/dlr-resort-list-api/api/v1/resorts/" +
  "?storeId=dlr&region=us&disneyOwned=true&tradeStore=false&quickQuote=true";

console.log("Fetching DLR resort catalog…");
const dlrData = await getJson(DLR_CATALOG_URL);
const dlrRows: Array<CatalogRow> = [];
for (const [id, node] of Object.entries<any>(dlrData.resorts ?? {})) {
  const slug: string = node.urlFriendlyId;
  // Feed gives Title-cased tiers ("Deluxe"); our union is lowercase.
  const tier = String(node.tier ?? "deluxe").toLowerCase() as Tier;
  // Prefer a wide 16:9 hero; media entries carry a `transcodeTemplate` with
  // `{width}/{height}` placeholders, so mint 1600x900 to match the WDW rows.
  const media = node.media ?? {};
  const pick =
    media.finderDetailFullWidthHero ??
    media.finderDetailMobileHero ??
    media.finderStandardThumb ??
    Object.values<any>(media)[0];
  const image: string | null = pick
    ? pick.transcodeTemplate
      ? pick.transcodeTemplate.replace("{width}", "1600").replace("{height}", "900")
      : (pick.url ?? null)
    : null;
  dlrRows.push({
    id,
    name: node.name,
    slug,
    tier,
    area: "Disneyland Resort",
    image,
    imageThumbhash: null, // filled in one pass below
    detailUrl: `https://disneyland.disney.go.com/hotels/${slug}/`,
    store: "dlr",
  });
}
dlrRows.sort((a, b) => a.name.localeCompare(b.name));
console.log(`Found ${dlrRows.length} DLR resorts.`);

console.log("Computing ThumbHash placeholders…");
for (const row of [...rows, ...dlrRows]) {
  if (row.image) row.imageThumbhash = await computeThumbhash(row.image);
  if (row.image && !row.imageThumbhash) console.warn(`  ! thumbhash failed for ${row.slug}`);
}

const header = `// GENERATED by gen-resort-catalog.ts — do not edit by hand.
// Rerun: bun src/server/stays/gen-resort-catalog.ts

export type ResortTier = "value" | "moderate" | "deluxe" | "villa" | "campground";

/** Disney store (booking system) that prices a resort — Walt Disney World or
 *  Disneyland Resort. Each has its own resort-availability endpoint. */
export type ResortStore = "wdw" | "dlr";

export interface ResortCatalogEntry {
  /** Numeric facility ID — joins to the resort-availability response keys. */
  id: string;
  name: string;
  slug: string;
  tier: ResortTier;
  /** Disney "resort area" (e.g. "Magic Kingdom Resort Area"), or null. */
  area: string | null;
  image: string | null;
  /** ThumbHash placeholder of \`image\` (base64) — instant blurry preview. */
  imageThumbhash: string | null;
  detailUrl: string;
  store: ResortStore;
}

/** Walt Disney World resorts. This is the WDW-only browse catalog the Stays UI
 *  renders; DLR is kept separate so existing WDW surfaces are unchanged. */
export const RESORT_CATALOG: Array<ResortCatalogEntry> = ${JSON.stringify(rows, null, 2)};

/** Disneyland Resort hotels. Swept + priced like WDW, but not yet surfaced in
 *  the WDW browse UI (join only, via \`RESORT_BY_ID\`). */
export const DLR_RESORT_CATALOG: Array<ResortCatalogEntry> = ${JSON.stringify(dlrRows, null, 2)};

/** Every resort across stores, keyed by facility id — the price/availability
 *  join (WDW ids and DLR ids don't overlap). */
export const RESORT_BY_ID: Map<string, ResortCatalogEntry> = new Map(
  [...RESORT_CATALOG, ...DLR_RESORT_CATALOG].map((r) => [r.id, r]),
);
`;

const out = new URL("./resort-catalog.generated.ts", import.meta.url).pathname;
writeFileSync(out, header);
console.log(`Wrote ${rows.length} WDW + ${dlrRows.length} DLR resorts -> ${out}`);
