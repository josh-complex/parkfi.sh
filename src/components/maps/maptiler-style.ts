// MapTiler API key (client-side, domain-restricted — safe to expose via VITE_).
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

/** Same vector style as the interactive park map, so every map surface in the
 *  app shares one basemap look. */
const MAPTILER_STYLE_ID = "019f3593-8a6f-771b-96d5-db0fec38726e";

/**
 * Built-in MapTiler raster style used as the Leaflet/no-WebGL fallback.
 * Rasterizing our custom Cloud style (`MAPTILER_STYLE_ID`) 404s as an invalid
 * key on our plan tier — first-party styles like this one are rasterizable on
 * the base plan, so the fallback doesn't visually match the GL map exactly.
 */
const MAPTILER_FALLBACK_RASTER_STYLE_ID = "streets-v4";

export function maptilerStyleUrl(): string {
  return `https://api.maptiler.com/maps/${MAPTILER_STYLE_ID}/style.json?key=${MAPTILER_KEY}`;
}

/**
 * Rasterized PNG tiles for the Leaflet/no-WebGL fallback. `{r}` is Leaflet's
 * retina placeholder — resolves to `@2x` with `detectRetina: true`.
 */
export function maptilerFallbackRasterTileUrl(): string {
  return `https://api.maptiler.com/maps/${MAPTILER_FALLBACK_RASTER_STYLE_ID}/256/{z}/{x}/{y}{r}.png?key=${MAPTILER_KEY}`;
}

export const MAPTILER_ATTRIBUTION = "© MapTiler © OpenStreetMap contributors";
