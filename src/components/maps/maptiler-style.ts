// MapTiler API key (client-side, domain-restricted — safe to expose via VITE_).
// Still needed on the client for the raster tiles the Leaflet fallback builds
// directly; the vector *style documents* now go through our own edge proxy.
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

/**
 * Origin the `/api/map-style/*` proxy path resolves against. Empty on the web
 * build so it stays relative to whatever Cloudflare-fronted host serves us; in
 * the native shell the WebView runs from `capacitor://` / `https://localhost`,
 * so `VITE_API_BASE` (baked to `https://parkfi.sh` for native builds) makes it
 * absolute — exactly as `lib/image.ts`, the tRPC client, and auth do.
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

/** Same vector style as the interactive park map, so every map surface in the
 *  app shares one basemap look. Exported so the style proxy route
 *  (`routes/api/map-style/$theme.ts`) resolves `theme=light` to it. */
export const MAPTILER_STYLE_ID = "019f3593-8a6f-771b-96d5-db0fec38726e";

/**
 * Built-in MapTiler raster styles used as the Leaflet/no-WebGL fallback.
 * Rasterizing our custom Cloud style (`MAPTILER_STYLE_ID`) 404s as an invalid
 * key on our plan tier — first-party styles like these are rasterizable on the
 * base plan, so the fallback doesn't visually match the GL map exactly. We keep
 * a light/dark pair so the fallback tracks the app theme instead of dropping to
 * a light basemap in dark mode.
 */
const MAPTILER_FALLBACK_RASTER_STYLE_ID = "streets-v4";
/** GL dark-theme style ID. Exported for the style proxy route to resolve
 *  `theme=dark`. Until we build a dark variant of our custom Cloud style, the GL
 *  renderer falls back to MapTiler's first-party `streets-v4-dark` — a full
 *  vector style, so the label-stripping in `park-map.tsx` still applies. */
export const MAPTILER_FALLBACK_RASTER_STYLE_ID_DARK = "streets-v4-dark";

/**
 * Vector style documents are served through our own edge proxy
 * (`routes/api/map-style/$theme.ts`) rather than fetched straight from
 * `api.maptiler.com`. MapTiler returns style.json with a `Last-Modified` header
 * but no `Cache-Control`, so clients — especially the Capacitor WebView — apply
 * unbounded heuristic freshness (serving pre-publish styles) or needlessly
 * re-fetch on the critical first-paint path. The proxy stamps `CACHE.MAP_STYLE`
 * and lets Cloudflare serve it from an edge near the user. The tiles / sprites /
 * glyphs referenced *inside* the returned style still load direct from MapTiler
 * (per their ToS); only the descriptor is proxied.
 */
export function maptilerStyleUrl(): string {
  return `${API_BASE}/api/map-style/light`;
}

/** Dark-theme companion to {@link maptilerStyleUrl}, via the same edge proxy. */
export function maptilerDarkStyleUrl(): string {
  return `${API_BASE}/api/map-style/dark`;
}

/**
 * Rasterized PNG tiles for the Leaflet/no-WebGL fallback. `{r}` is Leaflet's
 * retina placeholder — resolves to `@2x` with `detectRetina: true`. Pass `dark`
 * to serve the dark basemap so the fallback matches the app theme.
 */
export function maptilerFallbackRasterTileUrl(dark = false): string {
  const styleId = dark ? MAPTILER_FALLBACK_RASTER_STYLE_ID_DARK : MAPTILER_FALLBACK_RASTER_STYLE_ID;
  return `https://api.maptiler.com/maps/${styleId}/256/{z}/{x}/{y}{r}.png?key=${MAPTILER_KEY}`;
}

export const MAPTILER_ATTRIBUTION = "© MapTiler © OpenStreetMap contributors";
