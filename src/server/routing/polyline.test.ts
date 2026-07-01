import { describe, expect, it } from "vite-plus/test";

import { decodePolyline } from "./polyline.ts";

describe("decodePolyline", () => {
  it("decodes the canonical Google precision-5 example to [lng, lat]", () => {
    // From the Google encoded-polyline reference; expected points (lat, lng):
    // (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
    const decoded = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);
    expect(decoded).toHaveLength(3);
    const approx = decoded.map(([lng, lat]) => [
      Math.round(lng * 1000) / 1000,
      Math.round(lat * 1000) / 1000,
    ]);
    expect(approx).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("respects precision 6 (Valhalla shapes)", () => {
    // The same deltas encoded at precision 6 land at 1/10th the magnitude.
    const decoded = decodePolyline("_p~iF~ps|U", 6);
    expect(decoded).toHaveLength(1);
    const [lng, lat] = decoded[0];
    expect(lat).toBeCloseTo(3.85, 2);
    expect(lng).toBeCloseTo(-12.02, 2);
  });

  it("returns an empty array for an empty string", () => {
    expect(decodePolyline("", 6)).toEqual([]);
  });
});
