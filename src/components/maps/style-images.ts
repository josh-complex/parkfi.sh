import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Silence MapLibre's "Image X could not be loaded" console spam.
 *
 * Our MapTiler Cloud style points at a custom sprite sheet that doesn't carry
 * every icon its layers ask for — the POI layers resolve icon names straight
 * off feature properties (`["image", ["get", "subclass"]]`, so every OSM shop /
 * craft value in the tile: `kiosk`, `painter`, `hvac`, …) and the highway
 * junction layer builds `"road_{ref_length}"`, which collapses to a bare
 * `road_` on junctions with no ref. None of those exist in the sprite, and
 * MapLibre warns once per missing name per style load — dozens of lines on any
 * page with a map, drowning real errors.
 *
 * Registering a 1×1 transparent image for whatever the sprite is missing is the
 * documented escape hatch: the icon renders as nothing (exactly what it renders
 * as today) and the warning never fires. Attach this *before* the style loads.
 */
export function silenceMissingStyleImages(map: MapLibreMap): void {
  map.on("styleimagemissing", (e: { id: string }) => {
    // `setStyle` (theme swap) wipes added images, so this re-fires per style —
    // the guard keeps `addImage` from throwing on a duplicate id.
    if (map.hasImage(e.id)) return;
    map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
}
