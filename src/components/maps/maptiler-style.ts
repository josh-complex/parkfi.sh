// MapTiler API key (client-side, domain-restricted — safe to expose via VITE_).
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

/** Same vector style as the interactive park map, so every map surface in the
 *  app shares one basemap look. */
const MAPTILER_STYLE_ID = "019f3593-8a6f-771b-96d5-db0fec38726e";

/**
 * Built-in MapTiler raster styles used as the Leaflet/no-WebGL fallback.
 * Rasterizing our custom Cloud style (`MAPTILER_STYLE_ID`) 404s as an invalid
 * key on our plan tier — first-party styles like these are rasterizable on the
 * base plan, so the fallback doesn't visually match the GL map exactly. We keep
 * a light/dark pair so the fallback tracks the app theme instead of dropping to
 * a light basemap in dark mode.
 */
const MAPTILER_FALLBACK_RASTER_STYLE_ID = "streets-v4";
const MAPTILER_FALLBACK_RASTER_STYLE_ID_DARK = "streets-v4-dark";

export function maptilerStyleUrl(): string {
  // Cache-bust the style *document* once per day. MapTiler serves style.json
  // with a `Last-Modified` header but no `Cache-Control`, so clients (esp. the
  // Capacitor WebView) apply heuristic freshness and can serve a pre-publish
  // style for a long time without revalidating. A day-bucketed param means a
  // republished style shows up within 24h at most, while the tiles/sprites/
  // glyphs referenced *inside* the style keep caching normally.
  const day = Math.floor(Date.now() / 86_400_000);
  return `https://api.maptiler.com/maps/${MAPTILER_STYLE_ID}/style.json?key=${MAPTILER_KEY}&_=${day}`;
}

/**
 * Vector style document for the GL map's dark theme. Until we build a dark
 * variant of our custom Cloud style (`MAPTILER_STYLE_ID`), the GL renderer falls
 * back to MapTiler's first-party `streets-v4-dark`. It's a full vector style, so
 * the label-stripping in `park-map.tsx` still applies (OpenMapTiles schema).
 */
export function maptilerDarkStyleUrl(): string {
  return `https://api.maptiler.com/maps/${MAPTILER_FALLBACK_RASTER_STYLE_ID_DARK}/style.json?key=${MAPTILER_KEY}`;
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
