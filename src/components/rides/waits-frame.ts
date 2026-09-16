/**
 * The Waits board's map frame — "what's in view right now", as a plain box.
 *
 * The map itself is a lazily-loaded MapLibre chunk; this module is the part the
 * board reasons with, so the frame filter can be tested (and reasoned about)
 * without a GL context anywhere near it. The map reports a frame on every
 * `moveend`; the board narrows its results to the attractions inside it, the
 * way Airbnb narrows its listings to the visible map area.
 */

/** A viewport box in degrees. `west`/`east` are longitudes, `south`/`north` latitudes. */
export interface MapFrame {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Anything the frame can place: a point, or a row that has yet to be geocoded. */
export interface FramePoint {
  latitude: number | null;
  longitude: number | null;
}

/**
 * Is this point inside the frame?
 *
 * A row with no coordinates is **out**: the board's promise while the map is on
 * is "these are the attractions you can see", and something we cannot draw is
 * not something you can see. (Every ride the feeds geocode has coordinates;
 * this is the handful that don't.)
 *
 * Longitude wraps. Orlando never straddles the antimeridian, but a map panned
 * across it reports `west > east`, and treating that as an empty box would
 * blank the list rather than degrade.
 */
export function pointInFrame(p: FramePoint, f: MapFrame): boolean {
  const { latitude: lat, longitude: lng } = p;
  if (lat == null || lng == null) return false;
  if (lat < f.south || lat > f.north) return false;
  return f.west <= f.east ? lng >= f.west && lng <= f.east : lng >= f.west || lng <= f.east;
}

/** The rows inside the frame, in the order they came in. A null frame — the map
 *  is off, or hasn't reported yet — narrows nothing. */
export function filterToFrame<T extends FramePoint>(
  rows: ReadonlyArray<T>,
  frame: MapFrame | null,
): Array<T> {
  if (!frame) return [...rows];
  return rows.filter((r) => pointInFrame(r, frame));
}

/**
 * Frames equal to within a hair, so a map that settles a few microdegrees from
 * where it started doesn't re-run the whole board. 1e-6° is ~11cm — far below
 * anything a pan can mean and far above float noise.
 */
export function framesEqual(a: MapFrame | null, b: MapFrame | null): boolean {
  if (a == null || b == null) return a === b;
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  return (
    near(a.west, b.west) && near(a.east, b.east) && near(a.south, b.south) && near(a.north, b.north)
  );
}
