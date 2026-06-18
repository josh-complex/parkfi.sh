/**
 * Curated approximate coordinates for the WDW resorts, keyed by the catalog
 * `slug`. The resort-availability API and the finder feeds the catalog is built
 * from don't carry geo, and our `resorts` table is name/slug only — so, like the
 * tier map in `gen-resort-catalog.ts`, these are hand-curated stable facts.
 *
 * They're approximate property centroids (good to a few hundred metres), which
 * is all the locked-zoom location map needs; co-located DVC villas share their
 * host resort's point. Resorts without an entry simply render no map.
 */
export const RESORT_COORDS: Record<string, [number, number]> = {
  // Magic Kingdom area
  "contemporary-resort": [28.415, -81.5739],
  "bay-lake-tower-at-contemporary": [28.4163, -81.5731],
  "grand-floridian-resort-and-spa": [28.4106, -81.5867],
  "villas-at-grand-floridian-resort-and-spa": [28.4118, -81.586],
  "polynesian-resort": [28.4063, -81.5836],
  "polynesian-villas-bungalows": [28.4068, -81.5845],
  "wilderness-lodge-resort": [28.4124, -81.5719],
  "boulder-ridge-villas-at-wilderness-lodge": [28.4129, -81.5722],
  "copper-creek-villas-and-cabins": [28.4119, -81.5712],
  "campsites-at-fort-wilderness-resort": [28.4146, -81.5635],
  "cabins-at-fort-wilderness-resort": [28.4158, -81.5641],
  // EPCOT area
  "beach-club-resort": [28.37, -81.556],
  "beach-club-villas": [28.3708, -81.5566],
  "yacht-club-resort": [28.3717, -81.5566],
  "boardwalk-inn": [28.369, -81.5595],
  "boardwalk-villas": [28.3683, -81.5601],
  "swan-hotel": [28.366, -81.5585],
  "dolphin-hotel": [28.3645, -81.559],
  "swan-reserve": [28.3625, -81.556],
  "caribbean-beach-resort": [28.387, -81.571],
  "riviera-resort": [28.359, -81.556],
  // Animal Kingdom area
  "animal-kingdom-lodge": [28.3553, -81.6035],
  "animal-kingdom-villas-jambo": [28.3553, -81.6035],
  "animal-kingdom-villas-kidani": [28.3486, -81.6066],
  "coronado-springs-resort": [28.3596, -81.573],
  "all-star-movies-resort": [28.336, -81.5805],
  "all-star-music-resort": [28.3392, -81.5793],
  "all-star-sports-resort": [28.3416, -81.5781],
  "art-of-animation-resort": [28.3493, -81.5478],
  "pop-century-resort": [28.3525, -81.5494],
  // Disney Springs area
  "port-orleans-resort-french-quarter": [28.4146, -81.521],
  "port-orleans-resort-riverside": [28.41, -81.523],
  "old-key-west-resort": [28.392, -81.517],
  "saratoga-springs-resort-and-spa": [28.369, -81.518],
};

/** Approximate [lat, lng] for a resort slug, or null when uncurated. */
export function resortCoords(slug: string): [number, number] | null {
  return RESORT_COORDS[slug] ?? null;
}
