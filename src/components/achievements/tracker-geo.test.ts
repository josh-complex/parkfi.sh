import { describe, expect, it } from "vite-plus/test";

import {
  isNearAnyPark,
  LAST_FIX_FRESH_MS,
  NEAR_PARK_PAD_M,
  selectBestFix,
  type FenceBox,
  type SharedFix,
} from "./tracker-geo.ts";

const NOW = 1_753_800_000_000;

function shared(overrides: Partial<SharedFix> = {}): SharedFix {
  return { coords: [-81.581, 28.418], accuracy: 12, capturedAt: NOW - 5_000, ...overrides };
}

describe("selectBestFix", () => {
  const own = { lng: -81.58, lat: 28.417, accuracy: 90 };

  it("returns null with no fix at all", () => {
    expect(selectBestFix(null, null, NOW)).toBeNull();
  });

  it("falls back to the shared fix when there's no own fix", () => {
    const f = selectBestFix(null, shared(), NOW);
    expect(f).toMatchObject({ lng: -81.581, lat: 28.418, accuracy: 12, source: "shared" });
  });

  it("prefers a fresh, more accurate shared fix over the own coarse fix", () => {
    const f = selectBestFix(own, shared({ accuracy: 12 }), NOW);
    expect(f?.source).toBe("shared");
    expect(f?.accuracy).toBe(12);
  });

  it("keeps the own fix when the shared one is stale", () => {
    const stale = shared({ capturedAt: NOW - LAST_FIX_FRESH_MS - 1 });
    expect(selectBestFix(own, stale, NOW)?.source).toBe("own");
  });

  it("keeps the own fix when the shared one is less accurate", () => {
    expect(selectBestFix(own, shared({ accuracy: 150 }), NOW)?.source).toBe("own");
  });

  it("keeps the own fix on an accuracy tie (no churn for equal fixes)", () => {
    expect(selectBestFix(own, shared({ accuracy: own.accuracy }), NOW)?.source).toBe("own");
  });
});

describe("isNearAnyPark", () => {
  // ~1.7 km square around MK-ish coordinates.
  const mk: FenceBox = {
    latMin: 28.4106,
    latMax: 28.4259,
    lngMin: -81.5889,
    lngMax: -81.5735,
  };

  it("is true inside the fence", () => {
    expect(isNearAnyPark(-81.581, 28.418, [mk])).toBe(true);
  });

  it("is true within the ~2 km pad outside the fence", () => {
    // ~1 km north of the fence edge.
    expect(isNearAnyPark(-81.581, mk.latMax + 1_000 / 111_320, [mk])).toBe(true);
  });

  it("is false beyond the pad", () => {
    const farLat = mk.latMax + (NEAR_PARK_PAD_M + 2_000) / 111_320;
    expect(isNearAnyPark(-81.581, farLat, [mk])).toBe(false);
  });

  it("is false with no fences", () => {
    expect(isNearAnyPark(-81.581, 28.418, [])).toBe(false);
  });

  it("pads longitude by the latitude-corrected amount", () => {
    // ~1.5 km east of the fence edge at 28.4°N — inside the 2 km pad only when
    // the lng pad is cos-corrected (2000 m ≈ 0.0204° lng there, vs 0.018° raw).
    const lng = mk.lngMax + 1_900 / (111_320 * Math.cos((28.418 * Math.PI) / 180));
    expect(isNearAnyPark(lng, 28.418, [mk])).toBe(true);
  });
});
