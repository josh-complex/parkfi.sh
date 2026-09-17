import { describe, expect, it } from "vite-plus/test";

import { boundsCenter, parkFillZoom } from "./park-camera.ts";

/** Universal Studios Florida, as `parks.list` ships it: taller than it is wide. */
const USF = {
  latMin: 28.473249,
  latMax: 28.480557,
  lngMin: -81.47126,
  lngMax: -81.4657229,
};

/** The park page's map card, minus its own padding. */
const CARD = { width: 848, height: 488 };

describe("parkFillZoom", () => {
  /** The plain contain fit, worked independently of the code under test. */
  function containZoom(b: typeof USF, box: typeof CARD): number {
    const merc = (lat: number) =>
      (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
    const zx = Math.log2(box.width / (512 * (Math.abs(b.lngMax - b.lngMin) / 360)));
    const zy = Math.log2(box.height / (512 * Math.abs(merc(b.latMin) - merc(b.latMax))));
    return Math.min(zx, zy);
  }

  it("frames a tall park on a wide card tighter than a plain contain fit", () => {
    const zoom = parkFillZoom(USF, CARD, 18)!;
    const contain = containZoom(USF, CARD);
    // Pushed in past contain — but never by more than the cap, so the crop
    // stays a trim rather than eating the park.
    expect(zoom).toBeGreaterThan(contain + 0.29);
    expect(zoom - contain).toBeLessThanOrEqual(0.3 + 1e-9);
  });

  it("puts the park in the frame at a sane park-scale zoom", () => {
    expect(parkFillZoom(USF, CARD, 18)).toBeGreaterThan(15);
    expect(parkFillZoom(USF, CARD, 18)).toBeLessThan(17.5);
  });

  it("spends nothing when the park's shape already matches the frame", () => {
    // A box whose mercator aspect matches the card has no slack to spend, so
    // the fill fit and the contain fit are the same camera.
    const square = { latMin: 28.4, latMax: 28.41, lngMin: -81.5, lngMax: -81.49 };
    const box = { width: 400, height: 400 };
    const zoom = parkFillZoom(square, box, 22)!;
    const dx = 0.01 / 360;
    const contain = Math.log2(400 / (512 * dx));
    // Mercator stretches latitude slightly at 28°N, so the two axes differ by a
    // hair rather than exactly — the bias it can spend is that hair, not 0.3.
    expect(Math.abs(zoom - contain)).toBeLessThan(0.1);
  });

  it("honours the max zoom", () => {
    const tiny = { latMin: 28.4, latMax: 28.4001, lngMin: -81.5, lngMax: -81.4999 };
    expect(parkFillZoom(tiny, CARD, 18)).toBe(18);
  });

  it("returns null for a collapsed box or an unmeasured frame", () => {
    expect(
      parkFillZoom({ latMin: 28.4, latMax: 28.4, lngMin: -81.5, lngMax: -81.5 }, CARD, 18),
    ).toBeNull();
    expect(parkFillZoom(USF, { width: 0, height: 0 }, 18)).toBeNull();
  });
});

describe("boundsCenter", () => {
  it("is the middle of the box", () => {
    expect(boundsCenter(USF)).toEqual({
      lng: (USF.lngMin + USF.lngMax) / 2,
      lat: (USF.latMin + USF.latMax) / 2,
    });
  });
});
