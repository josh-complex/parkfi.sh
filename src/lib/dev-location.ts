/**
 * Dev-only test destinations near home (Benoi Drive, ChampionsGate / Davenport,
 * FL), so navigation can be exercised locally — routing from your *real* GPS
 * location to a nearby point — without driving to a park. This is just a static
 * list of places to navigate *to*; it never touches or overrides your location.
 * The picker that uses it is gated on the `nav-test-tools` PostHog flag (and dev
 * builds), so it stays hidden for normal users.
 */

/** [lng, lat] — the project's GeoJSON / MapLibre order (no flip needed). */
export type LngLat = [number, number];

export type DevSpot = { id: string; label: string; coords: LngLat };

/**
 * Points on the real road network around Benoi Drive (coordinates snapped to
 * actual OSM ways so Valhalla routes cleanly). Ordered roughly by distance from
 * Benoi Drive — a short-walk target first, out to ~900 m — so there's a range of
 * trips to test the follow-cam and mid-trip re-routing on a real device.
 */
export const DEV_SPOTS: ReadonlyArray<DevSpot> = [
  { id: "cg-blvd-west", label: "Champions Gate Blvd West", coords: [-81.6248143, 28.254754] },
  { id: "festival", label: "Festival community loop", coords: [-81.6227336, 28.2541403] },
  { id: "sanibel", label: "Sanibel Drive", coords: [-81.6284743, 28.2529877] },
  { id: "whirlaway", label: "Whirlaway Drive", coords: [-81.6192971, 28.2519462] },
  { id: "ronald-reagan", label: "Ronald Reagan Pkwy", coords: [-81.6204512, 28.2542181] },
];
