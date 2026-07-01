# Self-hosted Valhalla pedestrian routing engine for ParkFi.
#
# Uses the gis-ops "docker-valhalla" image, whose entrypoint downloads the OSM
# extract(s) in `tile_urls` on first boot and builds routing tiles into the data
# volume (/custom_files). Later boots reuse the built tiles (use_tiles_ignore_pbf),
# so the slow build runs once. Valhalla serves HTTP on :8002 and ParkFi calls its
# /route endpoint with pedestrian costing (see src/server/routing/valhalla.ts).
#
# Pin to a specific tag for reproducible builds.
FROM ghcr.io/gis-ops/docker-valhalla/valhalla:latest

# Florida extract covers Walt Disney World + Universal Orlando. For a smaller,
# faster build you can pre-clip to an Orlando bbox with `osmium extract` and host
# that PBF instead (see README) — only the parks region is ever routed.
ENV tile_urls="https://download.geofabrik.de/north-america/us/florida-latest.osm.pbf" \
    use_tiles_ignore_pbf="True" \
    force_rebuild="False" \
    build_elevation="False" \
    build_admins="True" \
    build_time_zones="False" \
    server_threads="2"

EXPOSE 8002
