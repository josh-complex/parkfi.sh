# Valhalla pedestrian routing service

ParkFi routes guests to attractions on real OSM footpaths via a self-hosted
[Valhalla](https://github.com/valhalla/valhalla) engine. The app never talks to a
third-party routing API — it calls **this** service's `/route` endpoint with
`costing: "pedestrian"` (see `src/server/routing/valhalla.ts`).

## What's here

- `Dockerfile` — wraps the gis-ops `docker-valhalla` image. On first boot it
  downloads the OSM extract in `tile_urls` and **builds routing tiles** into the
  data volume; later boots reuse them (`use_tiles_ignore_pbf=True`).

## Deploy on Railway

1. **New service → Deploy from Dockerfile**, pointing at this `valhalla/` directory.
2. **Attach a volume** mounted at `/custom_files`. Built Florida tiles are a few
   GB — provision ~4 GB. This is what makes the one-time build persist across
   restarts.
3. **First deploy builds tiles** — this can take many minutes (a state extract is
   large). The container downloads `florida-latest.osm.pbf` and runs
   `valhalla_build_tiles`. Watch the logs until it prints that the service is
   listening on `:8002`. Subsequent deploys skip the build.
4. Note the service's internal address (e.g. `valhalla.railway.internal`) or its
   public domain.

### IPv6 (private networking)

Railway's private network is **IPv6-only**. Valhalla's HTTP server binds per the
generated config's `httpd.service.listen`, which defaults to `tcp://*:8002`
(IPv4 only) — so a `*.railway.internal` call can get `ConnectionRefused`. Two
options:

- **Simplest:** call Valhalla over its **public** Railway domain and set
  `VALHALLA_URL` to that `https://…` URL. `normalizeBaseUrl` accepts it as-is.
- **Private network:** make Valhalla listen dual-stack by setting the config
  `httpd.service.listen` to `tcp://[::]:8002` (e.g. patch `/custom_files/valhalla.json`
  on the volume, or regenerate the config with that listen address), then point
  `VALHALLA_URL` at `valhalla.railway.internal:8002` (schemeless is fine —
  `normalizeBaseUrl` adds `http://` and the `:8002` port).

## Wire it into the app

Set on the **ParkFi** service:

```
VALHALLA_URL=valhalla.railway.internal:8002      # or https://<public-domain>
```

`src/env.ts` reads it (plain string, optional) and `src/server/routing/valhalla.ts`
normalizes/uses it. With it unset, the routing endpoint falls back to
`http://localhost:8002` (i.e. only works against a locally-running Valhalla).

## Smaller, faster tiles (optional)

Only the Orlando parks region is ever routed, so a full Florida build is overkill.
Pre-clip the extract once:

```sh
osmium extract -b -81.62,28.30,-81.40,28.50 florida-latest.osm.pbf -o orlando.osm.pbf
```

Host `orlando.osm.pbf` somewhere fetchable and set `tile_urls` to it (or bake it
into the image and point the build at it). Smaller PBF → much faster build, less
disk.

## Local smoke test

```sh
docker build -t parkfi-valhalla ./valhalla
docker run --rm -p 8002:8002 -v "$PWD/valhalla/custom_files:/custom_files" parkfi-valhalla
# once tiles are built and it's listening:
curl -s localhost:8002/route -d '{"locations":[{"lat":28.418,"lon":-81.581},{"lat":28.421,"lon":-81.577}],"costing":"pedestrian"}' | head -c 400
```
