# Navigation performance — optimistic page changes, persistent shell, skeletons

> **Theme:** Page changes feel slow across the whole app. The click → new-page gap is
> dominated by (1) refusing to trust any cached data, (2) blocking loaders that freeze
> the old page with zero pending feedback, and (3) fourteen routes that each rebuild the
> entire sidebar/header shell from scratch on every cross-section navigation. Fix order:
> cheapest perceptual wins first, structural refactor once those have landed.

## Diagnosis

Four compounding causes, ranked by impact:

1. **Every query is stale on arrival.** The query client sets only `retry: 1`
   (`src/integrations/tanstack-query/root-provider.tsx` `defaultOptions`) — React Query's
   default `staleTime` is `0`, so every navigation refetches everything, even data
   fetched seconds ago.
2. **Intent-preloading is thrown away.** `defaultPreload: "intent"` with
   `defaultPreloadStaleTime: 0` (`src/router.tsx:18-19`) means hover-preloaded data is
   _immediately_ stale — the click refetches from scratch. We pay for the preload and
   get none of the benefit.
3. **Blocking loaders, no pending UI.** Most `_dash` routes `await
context.queryClient.ensureQueryData(...)` (e.g. `src/routes/_dash/park.$slug.tsx`
   awaits two queries). With no `pendingComponent` anywhere, TanStack Router keeps the
   **old page fully visible** until the loader resolves, then hard-swaps — the
   "I clicked and nothing happened, then it jumped" feel.
4. **No shared shell.** 14 routes each re-declare `SidebarProvider` + `AppSidebar` +
   `AppInset` + `SiteHeader` (`dining`, `stays`, `tickets`, `predictions`, `pins` ×5,
   `resort.$slug`, `stays_.alerts`, `dining_.$facilityId`, `disclaimers`, `privacy`);
   only `_dash/*` share a layout. Navigating dining → stays → pins tears down and
   rebuilds the whole shell tree — sidebar state, omni-search, notification center,
   their queries — every time.

**Constraint:** the blocking loaders are deliberate SSR-prefetch — crawlers must see the
full ride board in the HTML because `/api/trpc` is disallowed in robots.txt (see the
comment at `src/routes/_dash/park.$slug.tsx:20-24`). Every fix below keeps server-side
blocking intact and unblocks _client_ navigation only.

## Sequencing

| Phase | What                                             | Effort   | Risk   | Payoff                                      |
| ----- | ------------------------------------------------ | -------- | ------ | ------------------------------------------- |
| 1     | Trust the cache (staleTime + preload alignment)  | ½ day    | Low    | Warm-cache nav becomes instant              |
| 2     | Pending components + non-blocking client loaders | 1 day    | Low    | No more frozen-then-jump; instant skeletons |
| 3     | One persistent shell (`_app` pathless layout)    | 2–3 days | Medium | SPA-feel cross-section nav                  |
| 4     | Skeleton system + drop nav fade                  | 1–2 days | Low    | Consistent, layout-stable loading           |
| 5     | Stream heavy secondary data                      | ½ day    | Low    | Faster first paint on heavy pages           |

Phases 1–2 are a day and a half of low-risk work that fixes the bulk of the complaint.
Each phase is independently shippable.

---

## Phase 1 — Trust the cache

Make preloaded/cached data actually get reused.

**1a. Query-client defaults** (`src/integrations/tanstack-query/root-provider.tsx`):

```ts
defaultOptions: {
  queries: {
    retry: 1,
    staleTime: 30_000,   // 30s: navigations within the window are instant
    gcTime: 5 * 60_000,  // keep cache warm for back/forward
  },
}
```

This becomes the baseline for the per-component `staleTime` overrides scattered across
`omni-search.tsx` (5m/1m), `park-map.tsx` (30m POI), `auth-queries.ts` (2m/5m),
`achievements.ts` (`Infinity`), `use-level.ts` (1m), `account/security.tsx` (5m). Keep
the intentionally-longer ones; delete any that only exist to paper over the missing
default.

**1b. Align router preload** (`src/router.tsx`):

```ts
defaultPreloadStaleTime: 30_000,  // or omit → inherits query staleTime
```

Now hovering a link warms the cache and the click reads it synchronously —
`ensureQueryData` in loaders resolves from cache with no network round-trip.

**Result:** intent-preloaded routes navigate instantly; repeat visits within 30s are
instant. No structural change. Live-data freshness is preserved by existing refetch
behavior once mounted (and 30s staleness on a wait-time board is well within tolerance —
the sweep cadence is coarser than that anyway).

---

## Phase 2 — Never freeze on the old page

When a loader _does_ have to wait (cold cache), show a skeleton instantly instead of a
frozen old page.

**2a. Global pending component** (`src/router.tsx`):

```ts
defaultPendingComponent: RouteSkeleton,  // new shared shell-content skeleton (Phase 4 kit)
defaultPendingMs: 150,                   // cached loads never flash a skeleton
defaultPendingMinMs: 300,                // once shown, hold it long enough to not flicker
```

`defaultPendingMs: 150` means Phase-1 warm-cache loads never see a skeleton at all; any
load slower than 150ms gets immediate visual feedback.

**2b. Server blocks, client streams.** A tiny helper preserves the SEO contract while
unblocking client nav:

```ts
// src/lib/loader.ts
import { isServer } from "@tanstack/react-query";

/** SSR/crawler document requests need the data in the HTML → await.
 *  Client navigations: warm the cache but render the route (and its
 *  skeletons) immediately. */
export function load<T>(qc: QueryClient, opts: EnsureQueryDataOptions<T>) {
  if (isServer) return qc.ensureQueryData(opts);
  void qc.prefetchQuery(opts);
}
```

Apply to the blocking loaders: `_dash/park.$slug` (`parks.board`), `_dash/index`
(`parks.allRides`), `_dash/map` (`parks.overview`), `_dash/shop.$slug`,
`dining_.$facilityId` (`dining.venue`), `pins_.$pinId`, `blog/index`, `blog/$slug`.
`ParkDashboard` already renders proper skeletons for stat cards, board table, and the
lazy charts — the page appears instantly and fills in.

Two caveats:

- **Loader-derived `head()` data.** `park.$slug`'s loader returns `{ name, operatorSlug }`
  from `parks.list` for the title. `parks.list` is already prefetched by the parent
  `_dash` loader, so on the client this resolves from cache — keep that lookup awaited
  (it's synchronous in practice), only make the heavy `parks.board` non-blocking.
  Same pattern anywhere loaderData feeds `head()`: block on cheap/cached identity data,
  stream the heavy payload.
- **NOT_FOUND handling.** Routes that `throw notFound()` based on the awaited result
  (pin detail, blog slug) should keep the blocking await for the _identity_ query only,
  or move the not-found decision into the component. Handle per-route, don't force one
  shape.

**Result:** every click produces immediate visual change — instant content (warm cache)
or an instant skeleton (cold).

---

## Phase 3 — One persistent shell

Collapse the 14 duplicated shells into a single pathless `_app` layout so the
sidebar/header never remount across sections. **Zero URLs change** — `_app` is pathless,
and the `pins_.` / `dining_.` underscore-escape naming keeps working identically one
directory down.

Two discoveries that de-risk this:

- `SiteHeader`'s `title`/`mobileTitle` props are **already dead**
  (`src/components/site-header.tsx:66-68` — "currently unused but kept so callers need
  no change"). Desktop chrome lives in `AppInset`'s blue toolbar; mobile shows only the
  floating search pill. Nothing visible depends on per-route header props.
- `AppSidebar` and `MobileBottomNav` are already route-aware via `useRouterState`
  (`src/components/app-sidebar.tsx:74-83`, `src/components/mobile-bottom-nav.tsx:161`) —
  they take no route props. All 15 shell declarations are byte-identical (same
  `variant="inset"`, same two CSS vars). The duplication is pure copy-paste legacy.

### Target route tree

```
src/routes/
  __root.tsx                        (unchanged)
  _app.tsx                          ← NEW: SidebarProvider + AppSidebar + AppInset + SiteHeader
  _app/
    _dash.tsx                       ← map-stage providers ONLY + parks.list loader
    _dash/index.tsx                 → /
    _dash/map.tsx                   → /map
    _dash/park.$slug.tsx            → /park/:slug
    _dash/park.$slug_.ride.$rideSlug.tsx
    _dash/shop.$slug.tsx
    _dash/alerts.tsx, achievements.tsx, account/*, admin*
    dining.tsx                      → /dining
    dining_.$facilityId.tsx         → /dining/:facilityId
    stays.tsx, stays_.alerts.tsx
    resort.$slug.tsx
    tickets.tsx
    predictions.tsx
    pins.tsx, pins_.$pinId.tsx, pins_.collection.tsx, pins_.trades.tsx, pins_.scan.tsx
    disclaimers.tsx, privacy.tsx
  login.tsx, welcome.tsx, blog/*    (stay outside — no app shell)
  og.*, sitemap, api.*, unsubscribe (server routes, untouched)
```

### Step 1 — Create `_app.tsx`

Lift the exact shell every route duplicates:

```tsx
// src/routes/_app.tsx
export const Route = createFileRoute("/_app")({ component: AppShell });

function AppShell() {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <AppInset>
        <SiteHeader />
        <Outlet />
      </AppInset>
    </SidebarProvider>
  );
}
```

No loader on `_app` — the sidebar's `parks.list` query is `enabled: isDashboard` only,
so the prefetch belongs on `_dash`, not here (see SSR table below).

### Step 2 — Slim `_dash.tsx` to what's dash-specific

`src/routes/_dash.tsx` keeps only:

- `SelectionProvider` / `RideFilterProvider` / `MapStageProvider activeSlug={...}`
  wrapping `<Outlet>` — the persistent-map morph stays scoped to map routes exactly as
  today.
- Its loader: `ensureQueryData(parks.list)` — feeds the sidebar's park section, which
  only renders on dash routes. Keeping it here means `/privacy` never fetches parks.

Delete: the shell wrapper, plus the now-dead `title` / `parkName` computation and its
`parks.list` `useQuery` (`_dash.tsx:28-36`) — that data only fed the unused `SiteHeader`
props.

**Deliberate decision:** `AchievementTracker` currently mounts in `_dash` only. Keep it
there — no behavior change in this refactor. If achievements should track on
dining/stays/pins too, moving it to `_app` is a one-line follow-up, but that's a product
decision, not part of this phase.

### Step 3 — Migrate leaf routes mechanically

Per route, the diff is pure deletion:

```diff
 function DiningPage() {
   return (
-    <SidebarProvider style={{...}}>
-      <AppSidebar variant="inset" />
-      <AppInset>
-        <SiteHeader title="Dining Reservations" />
         <MaintenanceGate feature="dining" title="Dining is under maintenance">
           ...content unchanged...
         </MaintenanceGate>
-      </AppInset>
-    </SidebarProvider>
   );
 }
```

- `MaintenanceGate` stays in each leaf — per-feature content gating, not shell.
- `createFileRoute("/dining")` → `createFileRoute("/_app/dining")` — the router Vite
  plugin rewrites these automatically when files move; verify `routeTree.gen.ts`
  regenerates clean.
- Once all 15 callers are migrated, tighten `SiteHeader` to take no props.

**Migration order (each step independently shippable):**

1. Static pair as the proof: `privacy`, `disclaimers`.
2. Section boards: `dining`, `stays`, `tickets`, `predictions`, `pins` + its four
   siblings, `resort.$slug`, `stays_.alerts`, `dining_.$facilityId`.
3. `_dash` last — most intertwined, and the smallest win since `_dash/*` already share
   a shell internally.

### Step 4 — Route titles without props

`document.title` / SEO titles come from each route's `head()` — untouched. If an
in-shell page title is ever wanted (breadcrumbs etc.), the idiom is route `staticData`,
not prop-drilling:

```ts
// leaf route
staticData: { pageTitle: "Dining Reservations" },
// in shell
const title = useRouterState({
  select: (s) =>
    [...s.matches].reverse().find((m) => m.staticData?.pageTitle)?.staticData.pageTitle,
});
```

Not required for this phase; noted so nobody reintroduces the props.

### SSR: what we keep, explicitly

This refactor changes **client-side navigation topology only**. Server document
rendering is per-URL and always renders the full matched chain — an extra pathless
layout in the middle changes nothing about HTML output.

| SSR benefit today                                                                   | After refactor                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full crawlable HTML from blocking loaders (server-side `ensureQueryData`)           | Unchanged — loaders stay on leaf routes and still run server-side on document requests (Phase 2's `isServer` split preserves the server-blocking half).       |
| Per-route `head()` / canonical / OG meta                                            | Unchanged — head merges root→leaf across matched routes; `_app` defines no `head()`. The canonical-per-route setup in `__root.tsx` is untouched.              |
| Dehydrated query cache → no client refetch flash (`setupRouterSsrQueryIntegration`) | Unchanged — dehydration keys off the queryClient, not route shape.                                                                                            |
| Sidebar SSRs with real park names (`_dash` loader)                                  | Unchanged — `parks.list` prefetch stays on `_dash`, still matched server-side for `/` and `/park/*`. Non-dash pages never needed it (`enabled: isDashboard`). |
| robots.txt disallows `/api/trpc` → content must ship in HTML                        | Unchanged — nothing moves to client-only fetching.                                                                                                            |
| OG image routes, sitemap, RSS, api routes                                           | Outside `_app`, untouched.                                                                                                                                    |

Two things **improve**:

1. **Error containment.** Today an error in `/dining` replaces the whole page — shell
   included — with `RouteErrorFallback`. After the refactor the fallback renders
   _inside_ the persistent shell, so users keep the sidebar/nav to escape with.
2. **Hydration surface.** The hydration-sensitive shell components (`OmniSearch`,
   sidebar state, notification center) hydrate once per session instead of being torn
   down and re-created — fewer chances to hit the lazy-chunk-at-hydration bug class
   (cf. the park-chart `removeChild` incident).

### Watch items (the actual risks)

- **Scroll restoration.** Today a shell remount incidentally resets scroll. With a
  persistent shell, `scrollRestoration: true` (`src/router.tsx:17`) must handle
  scroll-to-top on forward nav / restore on back. It does by default for _window_
  scrolling — verify the scroll container is the window, not the `AppInset` content
  card. If the card scrolls internally, register it via the scroll-restoration element
  options.
- **CSS assumptions.** The fullscreen map route "opts out via absolute fill" of
  `AppInset`'s bottom padding (comment in `src/components/app-inset.tsx`) — that lives
  in route content and survives the move. Sanity-check `/map` at mobile width anyway.
- **`routeTree.gen.ts` churn.** One big regeneration; do file moves in one commit-sized
  unit per migration step so review stays sane.
- **Preload behavior.** `defaultPreload: "intent"` now preloads only the changing leaf
  segment on hover (parent `_app` already matched) — strictly less work than today.
  Expected, no action.

### Verification per migration step

`bun vp check && bun vp test` after each batch (note: run bins via `bun`, no bare
`node`/`vp`), then:

- Sidebar open/collapsed state survives dining → stays → tickets navigation.
- Mobile bottom-nav active states track correctly.
- `/park/magic-kingdom` SSR HTML still contains the ride board — `curl` the page and
  grep for a ride name; that's the crawlability contract.
- Each migrated page's `<title>` and canonical are unchanged (view-source, not devtools).

---

## Phase 4 — A real skeleton system

Skeletons today are ad-hoc: `pins`, `account`, `achievements` hand-roll their own; most
routes have none. The primitive exists (`src/components/ui/skeleton.tsx`).

- Build `RouteSkeleton` (the Phase-2 `defaultPendingComponent`) plus a small kit:
  `BoardTableSkeleton`, `StatCardsSkeleton`, `CardGridSkeleton`, `DetailSkeleton` —
  matching real layout dimensions to avoid layout shift.
- **Pick one convention and apply it uniformly:** route content = `useQuery` +
  `isLoading` → skeleton (as `ParkDashboard` already does). Given the SSR/hydration
  setup, this is lower-risk than converting to `useSuspenseQuery`; reserve
  `React.Suspense` for the already-lazy client-only chart chunks where it's proven.
- Drop (or shorten to ~100ms) the per-navigation `motion` opacity fade on the park page
  (`src/routes/_dash/park.$slug.tsx:61-66`) — a 250ms fade on every park switch adds
  perceived latency on top of everything else.

---

## Phase 5 — Stream heavy secondary data

For pages where one query is much slower than the rest, return the slow one as an
**un-awaited promise** from the loader and consume it via `Await`/`use()` behind a
Suspense boundary, so fast content paints first and the slow section streams in — on
SSR this streams into the initial HTML response too.

Candidates:

- Park analytics grid (`park-analytics` — already a lazy _chunk_; this defers the _data_).
- Blog related-posts shelf (`blog/$slug` → `blog.related`).
- Dining menu (`dining_.$facilityId` → `dining.menu`).

Before building any of this, **measure**: check whether `parks.board` / `parks.allRides`
are actually slow server-side, or whether the perceived slowness was entirely the
staleTime/refetch churn Phases 1–2 eliminate. If loaders resolve in <100ms server-side,
Phase 5 may not be worth it.

---

## Out of scope / follow-ups

- Moving `AchievementTracker` app-wide (product decision).
- Cloudflare edge-cache rule for `/api/trpc/*` (tracked separately — see
  `src/lib/cache.ts` allowlist; complements but doesn't block any phase here).
- `useSuspenseQuery` migration — revisit only if the Phase-4 convention proves limiting.
