import { describe, expect, it } from "vite-plus/test";

import {
  FIX_MAX_AGE_MS,
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
  const own = { lng: -81.58, lat: 28.417, accuracy: 90, capturedAt: NOW - 2_000 };

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

  // R3 (round 2): a watch that stopped delivering while the app was frozen
  // leaves a pre-background fix behind; resume must not replay it.
  it("keeps the own fix under the age bound", () => {
    const aging = { ...own, capturedAt: NOW - FIX_MAX_AGE_MS };
    expect(selectBestFix(aging, null, NOW)?.source).toBe("own");
  });

  it("drops a stale own fix and falls back to a fresh shared one", () => {
    const stale = { ...own, capturedAt: NOW - FIX_MAX_AGE_MS - 1 };
    const f = selectBestFix(stale, shared({ accuracy: 150 }), NOW);
    // The shared fix is LESS accurate and older than LAST_FIX_FRESH_MS would
    // require to *beat* a live own fix — but the own fix is gone, so it wins.
    expect(f?.source).toBe("shared");
  });

  it("drops a stale own fix even with no shared fix at all", () => {
    const stale = { ...own, capturedAt: NOW - FIX_MAX_AGE_MS - 1 };
    expect(selectBestFix(stale, null, NOW)).toBeNull();
  });

  it("drops both when both are stale", () => {
    const stale = { ...own, capturedAt: NOW - FIX_MAX_AGE_MS - 1 };
    const staleShared = shared({ capturedAt: NOW - FIX_MAX_AGE_MS - 1 });
    expect(selectBestFix(stale, staleShared, NOW)).toBeNull();
  });

  it("carries capturedAt through on the selected fix", () => {
    expect(selectBestFix(own, null, NOW)?.capturedAt).toBe(own.capturedAt);
    expect(selectBestFix(null, shared(), NOW)?.capturedAt).toBe(NOW - 5_000);
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
