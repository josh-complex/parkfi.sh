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
   * Target height in CSS px. With `width` + `fit: "cover"`, Cloudflare crops to
   * this box server-side — so a source wider/taller than the display box doesn't
   * ship pixels that `object-cover` would just discard. Omit to keep aspect.
   */
  height?: number;
  /**
   * 1–100. Lower = smaller bytes. Defaults to {@link DEFAULT_IMAGE_QUALITY}
   * (tuned for list tiles); detail heroes pass a higher value for crispness.
   */
  quality?: number;
  /** `auto` negotiates AVIF/WebP per the browser's Accept header. */
  format?: "auto" | "webp" | "avif";
  /**
   * How the image fits `width` (and height, when given). Defaults to `crop`
   * when both dimensions are set (the aspect-crop path) and `scale-down`
   * otherwise. Neither default ever *enlarges* a smaller source — `cover`
   * does (verified: a 500px master ballooned to a 457 kB 1600² upscale),
   * which is why it isn't a default; `crop` behaves like `cover` when
   * shrinking but returns the source untouched instead of upscaling.
   */
  fit?: "cover" | "contain" | "scale-down" | "crop" | "pad";
}

/**
 * The default width ladder for `srcSet`, spanning tiny tiles to full-bleed
 * heroes. Capped at 1280: the Disney hero masters top out at 1600px of real
 * detail, and CF's 1600-wide output measured byte-identical to the 1280 one —
 * a higher rung would only fragment the cache and bill extra transformations.
 */
export const DEFAULT_IMAGE_WIDTHS = [320, 480, 640, 960, 1280] as const;

/**
 * Default AVIF/WebP quality. Tuned down for the common case (list/grid tiles,
 * rendered ~120–280px, where higher q is invisible — a representative 448×336
 * tile measured ~21 kB here vs 32.5 kB at the old q64, and even q40 renders
 * clean at tile size). Detail heroes override this upward via `<Image quality>`
 * since they're viewed large.
 */
export const DEFAULT_IMAGE_QUALITY = 44;

/**
 * Width (CSS px) requested for an `<Image>` that declares no `sizes` — i.e. a
 * list/grid tile, which renders ~120–280px. Without this the CF `src` would
 * re-encode at the *source* resolution (a ~600px+ card asset), far larger than
 * a tile needs; capping here right-sizes every tile with no per-call-site work.
 * Comfortably covers a ~220px tile on a 2× display; bump it if tiles look soft.
 */
export const DEFAULT_TILE_WIDTH = 448;

/**
 * Transform a full-bleed detail-page hero applies to its (Disney) source:
 * upsize to {@link disneyResizeUrl} `resizeWidth`, then render at `sizes`/
 * `widths`/`quality`. Shared so an intent-preload can reproduce the *exact* URL
 * the hero `<Image>` will fetch — a warm is only a cache hit if it matches.
 * Heroes with a non-100vw layout (e.g. the shop hero) don't use this.
 *
 * `sizes` is deliberately >100vw on phones. The hero box is fixed-height, so
 * `object-cover` scales the 16:9 source to the box's *height* and crops the
 * sides — the browser needs a render wider than the viewport, not equal to it.
 * Since the ride hero went full-bleed (edge-to-edge, and tall enough to tuck
 * under the floating header) that box is roughly square, so it overscans ~1.8×;
 * the 640–767 band keeps the taller box at a wider viewport (~1.15×), and from
 * `md` the hero is a wide strip inside the content column, where 100vw is
 * already generous. Under-declaring this is what makes a cropped hero look soft.
 *
 * No `aspect` (server-side crop) on purpose: mobile wants a near-square crop and
 * desktop a ~2.5:1 strip, and one URL ladder serves both — cropping to either
 * starves the other. The overscan pays for that in bytes we can measure instead.
 */
export const HERO_IMAGE = {
  resizeWidth: 1600,
  sizes: "(max-width: 639px) 180vw, (max-width: 767px) 115vw, 100vw",
  /**
   * Heroes — and only heroes — buy one rung past the shared ladder. With the
   * overscan above, the 1280 cap lands ~730 real pixels across a ~390px box;
   * the Disney master carries 1600 of genuine detail (see `disneyResizeUrl`),
   * so the extra rung is the difference between a soft hero and a sharp one.
   * List tiles keep {@link DEFAULT_IMAGE_WIDTHS} — they never crop this hard.
   */
  widths: [...DEFAULT_IMAGE_WIDTHS, 1600] as const,
  quality: 80,
} as const;

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
    opts.height ? `height=${opts.height}` : null,
    `quality=${opts.quality ?? DEFAULT_IMAGE_QUALITY}`,
    `format=${opts.format ?? "auto"}`,
    opts.width || opts.height ? `fit=${opts.fit ?? (opts.height ? "crop" : "scale-down")}` : null,
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
 *  isn't transformable, so the caller falls back to a bare `src`. With `aspect`,
 *  each rung carries a matching `height` so CF crops server-side (see
 *  {@link resolveImageUrls}). */
export function cfImageSrcSet(
  url: string,
  widths: readonly number[] = DEFAULT_IMAGE_WIDTHS,
  opts: Omit<CfImageOpts, "width" | "height"> & { aspect?: number } = {},
): string | undefined {
  if (!isTransformable(url)) return undefined;
  const { aspect, ...cfOpts } = opts;
  return widths
    .map((w) => {
      const height = aspect ? Math.round(w / aspect) : undefined;
      return `${cfImageUrl(url, { ...cfOpts, width: w, height })} ${w}w`;
    })
    .join(", ");
}

/**
 * Resolve the `src`/`srcSet` an `<Image>` will actually request, so the same
 * logic can drive both rendering and a matching preload (a warm only helps if
 * its URL is identical to what the `<img>` fetches). With `cf` off, passes the
 * source through untouched. With `cf` on: a width-descriptor `srcSet` when
 * `sizes` is set, else a tile-width-capped `src` (see {@link DEFAULT_TILE_WIDTH}).
 */
export function resolveImageUrls(
  src: string,
  opts: {
    cf: boolean;
    sizes?: string;
    quality?: number;
    widths?: readonly number[];
    /** Display box ratio (width / height). Makes CF crop to the box so a
     *  mismatched source (e.g. a square master in a 4:3 tile, or a 16:9 hero
     *  in a short banner) doesn't ship pixels `object-cover` discards. On the
     *  `sizes`/srcSet path every rung gets a matching height. Only pass a
     *  ratio the box holds at *every* viewport — crop to the narrowest
     *  (tallest) ratio the layout reaches, or the edge starves the box. */
    aspect?: number;
    /** The display box's CSS width in px (e.g. `44` for a `size-11` thumb).
     *  Tile path only (no `sizes`): requests `boxWidth × 3` — sharp on the
     *  densest screens, and still a fraction of the 448px default (bytes
     *  scale with pixel *area*). Omit for card-size tiles, where the
     *  {@link DEFAULT_TILE_WIDTH} cap is the right call. */
    boxWidth?: number;
    /** Constrained connection (Save-Data header opt-in, or a 2g/3g effective
     *  type — see `useDataSaver`). Scales quality by 0.8: tiles q50→40 (−30%
     *  bytes measured), heroes q80→64 (−29%). Callers that mirror an
     *  `<Image>`'s URL (intent-preloads) must pass the same value or the warm
     *  misses the cache. */
    dataSaver?: boolean;
  },
): { src: string; srcSet: string | undefined } {
  if (!opts.cf) return { src, srcSet: undefined };
  const quality = opts.dataSaver
    ? Math.round((opts.quality ?? DEFAULT_IMAGE_QUALITY) * 0.8)
    : opts.quality;
  if (opts.sizes) {
    return {
      src: cfImageUrl(src, {
        quality,
        width: 640,
        height: opts.aspect ? Math.round(640 / opts.aspect) : undefined,
      }),
      srcSet: cfImageSrcSet(src, opts.widths, { quality, aspect: opts.aspect }),
    };
  }
  const width = opts.boxWidth ? opts.boxWidth * 3 : DEFAULT_TILE_WIDTH;
  return {
    src: cfImageUrl(src, {
      quality,
      width,
      height: opts.aspect ? Math.round(width / opts.aspect) : undefined,
    }),
    srcSet: undefined,
  };
}
