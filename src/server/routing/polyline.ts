/**
 * Decoder for Google's "encoded polyline" format. Valhalla returns each route
 * leg's `shape` as an encoded polyline at **precision 6** (1e-6), not the Google
 * default of 5 — so the caller must pass `precision: 6` for Valhalla shapes.
 *
 * Pure and dependency-free (unit-tested in polyline.test.ts). Output is in the
 * project's [lng, lat] convention so it drops straight into GeoJSON / MapLibre.
 */
export function decodePolyline(str: string, precision = 6): Array<[number, number]> {
  const factor = Math.pow(10, precision);
  const coordinates: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lng / factor, lat / factor]);
  }

  return coordinates;
}
