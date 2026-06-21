/**
 * Hand-curated landmark coordinates for the four Walt Disney World theme parks
 * plus Disney Springs — the anchors a resort's location is judged against
 * ("how close is this to the parks?"). Like `resort-coords.ts`, these are stable
 * approximate facts (park hubs / entrances, good to a few hundred metres); none
 * of our feeds carry geo, so they live in code. Pure data — safe to import into
 * the client bundle.
 */
export interface Landmark {
  name: string;
  /** Short label for the map pin / proximity chips. */
  short: string;
  lat: number;
  lng: number;
  kind: "park" | "springs";
}

export const WDW_LANDMARKS: ReadonlyArray<Landmark> = [
  { name: "Magic Kingdom", short: "Magic Kingdom", lat: 28.4177, lng: -81.5812, kind: "park" },
  { name: "EPCOT", short: "EPCOT", lat: 28.3747, lng: -81.5494, kind: "park" },
  {
    name: "Disney's Hollywood Studios",
    short: "Hollywood Studios",
    lat: 28.3575,
    lng: -81.5586,
    kind: "park",
  },
  {
    name: "Disney's Animal Kingdom",
    short: "Animal Kingdom",
    lat: 28.3587,
    lng: -81.5901,
    kind: "park",
  },
  { name: "Disney Springs", short: "Disney Springs", lat: 28.37, lng: -81.519, kind: "springs" },
];

const EARTH_RADIUS_MI = 3958.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two [lat, lng] points, in miles. */
export function haversineMiles(
  [lat1, lng1]: readonly [number, number],
  [lat2, lng2]: readonly [number, number],
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.asin(Math.sqrt(a));
}

export interface LandmarkDistance extends Landmark {
  miles: number;
}

/** Every landmark with its straight-line distance from a point, nearest first. */
export function landmarkDistances(coords: readonly [number, number]): Array<LandmarkDistance> {
  return WDW_LANDMARKS.map((l) => ({ ...l, miles: haversineMiles(coords, [l.lat, l.lng]) })).sort(
    (a, b) => a.miles - b.miles,
  );
}
