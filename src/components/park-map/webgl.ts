/**
 * Can the browser actually give us a WebGL context? MapLibre needs one, and on
 * machines where WebGL is disabled (hardened browser settings, blocklisted GPU,
 * headless contexts) `new maplibregl.Map()` throws and takes the page down. We
 * probe once up front so the map stage can fall back to the DOM/raster Leaflet
 * renderer instead of crashing.
 */
export function hasWebGl(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    return gl != null;
  } catch {
    return false;
  }
}
