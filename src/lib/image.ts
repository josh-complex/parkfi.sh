/**
 * Cloudflare image transformation URL builders.
 *
 * These are pure URL rewriters — they do NOT check whether the feature is on.
 * Gating lives in `<Image>` (via the `cf-images` flag / {@link useCfImagesEnabled}),
 * which only calls these once enabled. Requesting a remote image through
 * `/cdn-cgi/image/<options>/<source>` lets the edge re-encode it to AVIF/WebP,
 * resize it, and serve it from our own zone (our cache headers), instead of the
 * origin CDN's full-size asset.
 *
 * `onerror=redirect` is always included so that if the transform fails — the
 * feature isn't enabled, the origin blocks it, the source 404s — the request
 * falls back to the original image rather than a broken tile.
 *
 * Docs: https://developers.cloudflare.com/images/transform-images/transform-via-url/
 */

export interface CfImageOpts {
  /** Target width in CSS px. Omit to re-encode at the source's own size. */
  width?: number;
  /** 1–100. Lower = smaller bytes. Defaults to 80, a good photo sweet spot. */
  quality?: number;
  /** `auto` negotiates AVIF/WebP per the browser's Accept header. */
  format?: "auto" | "webp" | "avif";
  /** How the image fits `width` (and height, when given). Only meaningful with `width`. */
  fit?: "cover" | "contain" | "scale-down" | "crop" | "pad";
}

/** The default width ladder for `srcSet`, spanning tiny tiles to full-bleed heroes. */
export const DEFAULT_IMAGE_WIDTHS = [320, 480, 640, 960, 1280, 1600] as const;

/** True when `url` is a remote http(s) source we can hand to the edge. Skips
 *  local/static assets (`/img/…`, already optimized), `data:` URIs, and
 *  already-transformed `/cdn-cgi/` URLs. */
function isTransformable(url: string): boolean {
  return /^https?:\/\//.test(url) && !url.includes("/cdn-cgi/image/");
}

function optionString(opts: CfImageOpts): string {
  return [
    opts.width ? `width=${opts.width}` : null,
    `quality=${opts.quality ?? 80}`,
    `format=${opts.format ?? "auto"}`,
    opts.width ? `fit=${opts.fit ?? "cover"}` : null,
    "onerror=redirect",
  ]
    .filter(Boolean)
    .join(",");
}

/** Rewrite a remote image URL to its Cloudflare-transformed form. Returns the
 *  input unchanged when it isn't a transformable remote source. */
export function cfImageUrl(url: string, opts: CfImageOpts = {}): string {
  if (!isTransformable(url)) return url;
  return `/cdn-cgi/image/${optionString(opts)}/${url}`;
}

/** Build a width-descriptor `srcSet` for `url`. Returns undefined when the URL
 *  isn't transformable, so the caller falls back to a bare `src`. */
export function cfImageSrcSet(
  url: string,
  widths: readonly number[] = DEFAULT_IMAGE_WIDTHS,
  opts: Omit<CfImageOpts, "width"> = {},
): string | undefined {
  if (!isTransformable(url)) return undefined;
  return widths.map((w) => `${cfImageUrl(url, { ...opts, width: w })} ${w}w`).join(", ");
}
