/**
 * Camera maths for framing one park in an embedded map card.
 *
 * Kept out of the renderers (and free of any maplibre import) so it can be
 * reasoned about and tested on its own — see `park-camera.test.ts`.
 */

/** A park's bounding box, as `parks.list` ships it. */
export interface CameraBounds {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** The pixels a fit may use, after the frame's own padding. */
export interface CameraBox {
  width: number;
  height: number;
}

/** Web Mercator tile size the GL renderer scales its zoom against. */
const TILE = 512;

/**
 * How much of the *slack* axis a fit is allowed to spend, in zoom levels.
 *
 * A park page's map card is about 2:1 and most parks are nearer square or
 * portrait, so a plain "contain" fit is decided by the park's taller axis and
 * leaves the wider one showing half the resort — which is what made every park
 * open framed on its neighbours. Spending the slack pushes in until the park
 * actually fills the card.
 *
 * Capped, because past this the crop stops being padding and starts being the
 * park: at 0.3 a height-constrained fit loses about a tenth off each end, which
 * a small pan recovers, and `zoomOutBounds` still lets you pull back for
 * context.
 */
const FILL_BIAS = 0.3;

/**
 * Normalized Mercator y for a latitude (0 at the north pole, 1 at the south) —
 * the projection maplibre scales its zoom against, so a park's *height* in
 * pixels can't be computed from degrees of latitude alone.
 */
function mercatorY(lat: number): number {
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const rad = (clamped * Math.PI) / 180;
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + rad / 2))) / 360;
}

/**
 * The zoom at which `bounds` fills `box`: a contain fit, pushed toward the
 * looser axis by up to `FILL_BIAS` so the park uses the frame it's given.
 *
 * A park whose shape already matches the card gets no push at all (the two axis
 * zooms agree, so there's no slack to spend) — the bias only ever eats the
 * emptiness a mismatched aspect ratio creates.
 */
export function parkFillZoom(bounds: CameraBounds, box: CameraBox, maxZoom: number): number | null {
  const dx = Math.abs(bounds.lngMax - bounds.lngMin) / 360;
  const dy = Math.abs(mercatorY(bounds.latMin) - mercatorY(bounds.latMax));
  if (!(dx > 0) || !(dy > 0) || !(box.width > 0) || !(box.height > 0)) return null;
  const zx = Math.log2(box.width / (TILE * dx));
  const zy = Math.log2(box.height / (TILE * dy));
  const contain = Math.min(zx, zy);
  return Math.min(maxZoom, contain + Math.min(FILL_BIAS, Math.abs(zx - zy) / 2));
}

/** The centre of a bounding box, in the projection the zoom above assumes. */
export function boundsCenter(bounds: CameraBounds): { lng: number; lat: number } {
  return {
    lng: (bounds.lngMin + bounds.lngMax) / 2,
    lat: (bounds.latMin + bounds.latMax) / 2,
  };
}
