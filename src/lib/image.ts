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
  /**
   * 1–100. Lower = smaller bytes. Defaults to {@link DEFAULT_IMAGE_QUALITY}
   * (tuned for list tiles); detail heroes pass a higher value for crispness.
   */
  quality?: number;
  /** `auto` negotiates AVIF/WebP per the browser's Accept header. */
  format?: "auto" | "webp" | "avif";
  /** How the image fits `width` (and height, when given). Only meaningful with `width`. */
  fit?: "cover" | "contain" | "scale-down" | "crop" | "pad";
}

/** The default width ladder for `srcSet`, spanning tiny tiles to full-bleed heroes. */
export const DEFAULT_IMAGE_WIDTHS = [320, 480, 640, 960, 1280, 1600] as const;

/**
 * Default AVIF/WebP quality. Tuned down for the common case (list/grid tiles,
 * where the extra bytes of q80+ aren't visible at tile size). Detail heroes
 * override this upward via `<Image quality>` since they're viewed large.
 */
export const DEFAULT_IMAGE_QUALITY = 64;

/**
 * The Disney CDN's own resize segment (`/resize/mwImage/1/{w}/{h}/75/`). Mirrors
 * the server-side rewriters in parks/codes.ts; duplicated here because that
 * module is server-only and must not be pulled into the client bundle.
 */
const DISNEY_RESIZE_RE = /\/resize\/mwImage\/1\/\d+\/\d+\/75\//;

/**
 * Rewrite a Disney CDN image URL to a `width`×(9/16) render. Disney re-renders
 * from the original master on every resize, so asking for a larger size yields
 * genuine detail — not an upscale — which lets detail-page heroes request more
 * than the ~800px the catalog stored without touching the shared list-card URL.
 * No-ops on non-Disney sources (Universal assets, `data:` URIs, etc.), returning
 * the input unchanged so it's safe to apply blindly at a hero call site.
 */
export function disneyResizeUrl<T extends string | null | undefined>(url: T, width: number): T {
  if (!url || !DISNEY_RESIZE_RE.test(url)) return url;
  const height = Math.round((width * 9) / 16);
  return url.replace(DISNEY_RESIZE_RE, `/resize/mwImage/1/${width}/${height}/75/`) as T;
}

/** True when `url` is a remote http(s) source we can hand to the edge. Skips
 *  local/static assets (`/img/…`, already optimized), `data:` URIs, and
 *  already-transformed `/cdn-cgi/` URLs. */
function isTransformable(url: string): boolean {
  return /^https?:\/\//.test(url) && !url.includes("/cdn-cgi/image/");
}

function optionString(opts: CfImageOpts): string {
  return [
    opts.width ? `width=${opts.width}` : null,
    `quality=${opts.quality ?? DEFAULT_IMAGE_QUALITY}`,
    `format=${opts.format ?? "auto"}`,
    opts.width ? `fit=${opts.fit ?? "cover"}` : null,
    "onerror=redirect",
  ]
    .filter(Boolean)
    .join(",");
}

/**
 * The origin the `/cdn-cgi/image/` path must resolve against. Empty on the web
 * build so the URL stays relative to whatever host is serving us (all behind
 * Cloudflare). In the native shell the WebView is served from `capacitor://` /
 * `https://localhost`, so a relative path would 404 there — `VITE_API_BASE`
 * (baked to `https://parkfi.sh` for native builds, see vite.config.ts) makes it
 * absolute, exactly as the tRPC and auth clients do for the same reason.
 */
const CF_ORIGIN = import.meta.env.VITE_API_BASE ?? "";

/** Rewrite a remote image URL to its Cloudflare-transformed form. Returns the
 *  input unchanged when it isn't a transformable remote source. */
export function cfImageUrl(url: string, opts: CfImageOpts = {}): string {
  if (!isTransformable(url)) return url;
  return `${CF_ORIGIN}/cdn-cgi/image/${optionString(opts)}/${url}`;
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
