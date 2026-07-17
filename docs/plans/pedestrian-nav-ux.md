# Pedestrian navigation — UI/UX/flow improvements

> **Theme:** The nav stack's bones are genuinely good — snapped breadcrumb trail,
> fused compass/course heading, follow-cam, silent reroutes via
> `keepPreviousData`, arrival card. The gaps cluster in three places: (1) the
> guidance shown _during_ the walk is stale and sometimes wrong, (2) nav is hard
> to get into (one entry point, no walk-time hook), and (3) real-world phone
> behavior (screen sleep, GPS staleness/accuracy) isn't handled. Fix order:
> the client-side route-tracking chunk first (it fixes three defects at once),
> then the walk-experience wins, then adoption levers.

## Current architecture (orientation)

| Piece            | File                                                                         | Role                                                                                              |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Trip state store | `src/components/park-map/nav-store.ts`                                       | TanStack store: pending dest → trip → started → arrived; breadcrumb; reroute + arrival thresholds |
| Overlay UI       | `src/components/park-map/nav-overlay.tsx`                                    | Green turn sign (expandable step list), bottom ETA bar, compass toggle, arrival card              |
| Orchestration    | `src/components/park-map/map-stage.tsx`                                      | Owns the geolocation watch, `routing.route` query, follow-cam engagement, arrival toast           |
| Geometry         | `src/components/park-map/nav-geometry.ts`                                    | Bearing math, `projectOntoRoute` (with `alongM`), snapped-trail extension                         |
| Heading fusion   | `src/components/park-map/use-fused-heading.ts`                               | Magnetometer ⊕ GPS course, turn detection, circular smoothing                                     |
| GL renderer      | `src/components/park-map/park-map.tsx`                                       | Marching route dots, traveled trail, follow-cam easeTo, popup "Directions" entry                  |
| Leaflet fallback | `src/components/park-map/park-map-leaflet.tsx`                               | Route polyline, no rotation/heading-up/compass                                                    |
| Server           | `src/server/routing/valhalla.ts`, `src/integrations/trpc/routers/routing.ts` | Self-hosted Valhalla pedestrian costing; public tRPC query                                        |

Flow today: popup **Directions** → preview (route framed, Start/Swap/Cancel) →
**Start** (follow-cam, heading-up, marching dots) → silent reroute whenever the
fix moves ≥10 m from the last-routed origin (`REROUTE_MIN_MOVE_M`) → arrival at
≤15 m from the destination or route ETA ≤30 s → completion card + toast.

## 1. Defects — fix first

### 1.1 The turn sign rarely shows the actual next turn

`nav-overlay.tsx` headlines `steps[0]`. The comment assumes that after a mid-trip
reroute "the first step _is_ the next turn" — but Valhalla's first maneuver on
every route is a **start** maneuver (types 1–3: "Walk east on the pathway"), so
after each 10 m reroute the headline resets to "Walk east…" and the real next
turn sits at `steps[1]`. Users walking an active trip mostly see a bearing
statement, not "Turn right, 40 m".

**Fix:** skip start-type maneuvers (1/2/3) when picking the headline during an
active trip (show them only in preview / before first movement), and pair the
first real turn with a live countdown distance (§2).

### 1.2 Numbers freeze between reroutes

Next-turn distance, remaining distance, and ETA only change when a Valhalla
response lands. Between the ≥10 m reroute hops everything is frozen — the
bottom bar can read "6 min walk" for the entire first minute of walking.
Fixed properly by §2.

### 1.3 Instant-arrival edge case

`recordNavFix` latches arrival when `etaSeconds ≤ ARRIVE_ETA_S` (30 s) — but
`etaSeconds` is the **total route ETA**. Tap Start on a destination 25 s away
and the very first GPS fix declares arrival with zero steps taken.

**Fix:** apply the ETA condition only after some minimum walked distance
(e.g. `summary`-tracked trail length > 10 m), or only after the first reroute.

### 1.4 Metric-only distances for a US-centric audience

`formatDistance` is m/km. WDW/Universal guests think in feet and miles.
Choose units from locale (or the park's country), and pass the matching
`directions_options.units` to Valhalla so narrative instructions ("Continue for
300 feet") agree with the chrome. Small change, outsized perceived quality.

### 1.5 GPS fixes can be 15 s stale during nav

`GEO_OPTS.maximumAge` is 15 000 ms (`use-geolocation.ts`). At walking speed
that's ~20 m of puck lag — enough to blow through a turn cue or delay arrival.
Fine for the ambient app watch; wrong for turn-by-turn.

**Fix:** while a trip is `started`, run the watch with `maximumAge` ≈ 1–2 s
(restart the watch with tighter options on start, restore on clear). Consider
the inverse too: the remembered-active watch currently runs
`enableHighAccuracy` for the whole session even when nothing consumes it —
worth a lower-power profile outside nav/play for battery.

### 1.6 No accuracy gating on fixes

`recordNavFix` trusts every fix. A 50 m-accuracy fix (canyon between show
buildings, just-woke GPS) can extend the trail with a bogus raw point, trigger
a pointless reroute, or falsely latch arrival. `accuracy` is already in
`GeoState` — drop fixes above ~30–35 m for trail/arrival purposes (still fine
to render the puck with its accuracy ring).

## 2. Core upgrade: client-side route tracking (one coherent chunk)

Today "progress along the route" is delegated to Valhalla by re-keying the trip
origin every 10 m. That causes §1.1/§1.2, spams the routing engine (~1 request
per 10 m per active user), and provides no off-route signal. All the machinery
for doing it client-side already exists — `projectOntoRoute` returns `alongM`,
and maneuvers carry `beginShapeIndex`.

Per fix, project onto the current route and derive:

- **Live next-maneuver distance** — `maneuvers[i].alongM − fix.alongM` (compute
  each maneuver's `alongM` once per route from `beginShapeIndex`). Powers a
  ticking "Turn right · 120 ft" headline and maneuver advancement (advance the
  active step when `alongM` passes its begin point).
- **Live remaining distance/ETA** — `total − alongM`, scaled by the route's
  average speed (or remaining maneuver `timeSeconds`). Powers the bottom bar
  countdown and a progress bar.
- **Off-route detection** — `distM > SNAP_OFF_ROUTE_M` (15 m, already defined)
  for N consecutive fixes → _now_ reroute, and show a real "Rerouting…" state.
  Delete the 10 m origin-re-key timer entirely.

Payoffs: correct next-turn headline, continuously ticking numbers, an honest
rerouting indicator, ~10–50× fewer Valhalla calls, and the live
distance-to-turn signal that haptic/voice cues (§3.2) need. This also makes the
arrival check able to use _remaining route distance_ instead of crow-flies
distance to the pin — more honest when the pin sits deep inside a building.

## 3. High-value walk-experience additions

### 3.1 Screen wake lock while navigating

A phone that sleeps 30 s into a 10-minute walk is the biggest real-world flow
killer. `navigator.wakeLock` on web (re-acquire on `visibilitychange`), the
KeepAwake plugin in the Capacitor shell. Acquire on `startNav()`, release on
clear/arrival.

### 3.2 Haptic + spoken turn cues

In-park users walk with the phone at their side. Once §2 provides live
distance-to-turn:

- **Haptic:** a vibration pulse at ~20 m before each maneuver
  (`navigator.vibrate` / Capacitor Haptics), plus a distinct arrival buzz.
- **Voice:** `speechSynthesis.speak()` of the maneuver instruction at the same
  trigger, behind a mute toggle on the turn sign. Nearly free once the trigger
  exists.

### 3.3 Follow-cam framing: puck low, camera tilted

The follow-cam centers the puck mid-screen at a flat overhead angle
(`easeTo({ center })` in `park-map.tsx`). Standard walking-nav framing puts the
puck in the lower third (most of the screen shows what's _ahead_) with a modest
pitch (~40–50°) while heading-up. MapLibre supports both — `easeTo` with
`padding: { bottom }` (or `offset`) and `pitch`. Restore flat/centered when
follow drops or heading-up is off. Cheap, and it makes "navigating" feel like a
mode rather than a map with a line on it.

### 3.4 Route-overview toggle

Once navigating, seeing the whole remaining route requires pinch-zooming, which
drops the follow-cam. Add a small overview button (or make the ETA bar
tappable): frame the full route with the existing `fitBounds` +
`chromePadding` path, then one tap (or a timeout) returns to follow. The
existing preview-framing code is 90% of it.

### 3.5 Destination context in the bottom bar

While walking to an attraction the one number that matters is its current wait.
`NavDest` already carries the attraction id — show "to Space Mountain · 35 min
wait" and keep it live. If the wait spikes mid-walk, that's a decision the user
wants to make _now_. (POI destinations fall back to plain name.)

## 4. Adoption: getting people into nav

### 4.1 Walk time before commitment

The popup's Directions button gives no hint of cost until the preview loads.
Prefetch the route when an attraction card opens (the card already prefetches
the ride page query — same pattern) and render "**6 min walk**" on the card
itself. That number is the hook that converts a glance into a trip.

### 4.2 More entry points

Nav is only reachable from map popup cards (`[data-directions]` in
`park-map.tsx`). The stage owns `requestDirections`; expose an app-level action
(store call + navigate to `/map`) so these can start a trip:

- Ride detail pages — "Walk there · 6 min" CTA
- Wait-board rows / dining pages / shop pages
- Deep links (`/map?nav=<attractionId>`) for shares and notifications

### 4.3 Geo-blocked dead end

"Enable location to navigate" has no action attached. On native, deep-link to
app settings (capacitor `NativeSettings`); on web, an inline "how to re-enable"
hint per browser. Also distinguish `denied` (user said no — needs settings)
from `unavailable` (insecure context / no hardware — different copy).

## 5. Polish

- **Arrival clock time** — "Arrive 3:42 PM" beside the duration; guests plan
  around showtimes and return windows.
- **Progress bar** on the ETA bar (fraction `alongM / total`, from §2).
- **`aria-live="polite"` on the turn headline** so instruction changes are
  announced to screen readers; `aria-label` the compass state changes too.
- **Arrival haptic + drop the duplicate toast** — the completion card and the
  `toast.success` in `map-stage.tsx` fire simultaneously and say the same
  thing; the card alone is cleaner.
- **En-route POI context** — active nav hides every marker except the
  destination (`navDest` filter in both renderers). Deliberate focus, but
  consider keeping restrooms (and maybe quick service) visible dimmed; they're
  the things people actually divert for mid-walk.
- **Crow-flies fallback** — when Valhalla is down/unreachable, instead of a
  dead "No walking route found", offer a compass-style fallback: straight-line
  bearing + distance to the destination ("head that way, ~400 ft"). In a park,
  that's genuinely useful.
- **Valhalla narrative language** — pass `directions_options.language` from the
  user's locale when we localize; instructions are currently en-US only.

## 6. Data / platform considerations

- **Pin vs. entrance.** Routing targets the attraction's map pin; Valhalla
  snaps it to the nearest footpath edge, which for a large show building can be
  the wrong side. The ETA≤30 s arrival fallback papers over this today. A
  longer-term fix is curated entrance coords for the worst offenders (queue
  entrance, not building centroid). Worth an audit pass with the nav QA tools.
- **Query-key churn / caching.** `routing.route` is keyed on full-precision GPS
  floats, so no two requests ever share a cache entry. After §2 removes the
  10 m reroute this matters much less, but rounding coords to 6 decimals
  (~11 cm) before keying is free hygiene. `routing.route` is deliberately not
  in the edge-cache allowlist (`lib/cache.ts`) — with GPS-precision keys it
  would never hit anyway; leave it out.
- **Leaflet parity.** The fallback renderer draws route/trail/destination but
  has no rotation, heading-up, or compass — acceptable degradation, but §2's
  live numbers and §3.2's cues are renderer-independent and should work there
  too. Keep the overlay logic renderer-agnostic.
- **Telemetry funnel.** Only `geolocation_denied/error` and the Leaflet
  fallback are captured today. Add `nav_previewed → nav_started →
nav_arrived | nav_abandoned` (with trip distance/duration and
  reroute/off-route counts). Mid-trip abandonment rate is the metric that says
  which of the above actually matters.

## 7. Suggested build order

1. **Client-side route tracking** (§2) — subsumes defects 1.1/1.2/1.3, adds
   off-route + rerouting state, cuts Valhalla load. The keystone chunk.
2. **Units** (§1.4) + **nav-mode GPS options** (§1.5) + **accuracy gating**
   (§1.6) — small, independent, all improve the same walk.
3. **Wake lock** (§3.1) + **arrival haptic / toast cleanup** (§5).
4. **Follow-cam framing** (§3.3) + **route overview** (§3.4) — the "feels like
   real nav" pass.
5. **Walk-time prefetch on cards** (§4.1) + **entry points** (§4.2) — the
   adoption lever; measure with the §6 funnel added in the same change.
6. **Haptic/voice cues** (§3.2), **destination wait** (§3.5), remaining polish
   as follow-ups.
