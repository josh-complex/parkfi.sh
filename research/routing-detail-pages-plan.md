# Detail pages & deep-linking — implementation spec

> Offloadable design brief. Goal: give every first-class entity (park, attraction/ride,
> restaurant + its menu, resort/hotel) its own canonical URL so the omni-search (and blog,
> sitemap, OG cards, alerts) can deep-link to it and its inner contents. Self-contained —
> read this plus the cited files before starting.

## Why this is needed now

The omni-search ([src/components/omni-search.tsx](../src/components/omni-search.tsx)) already surfaces
parks, attractions, dining venues, **menu items**, and blog posts. But several result kinds
have nowhere to land:

- **Attractions** → currently navigate to the parent park page (`/park/$slug`), not the ride.
- **Dining venues** → navigate to `/dining` (the board), losing the selected venue.
- **Menu items** (new) → navigate to `/dining`, losing both the venue _and_ the item/menu.

Restaurants' menus today live only inside a modal drawer
([src/components/dining/dining-menu-drawer.tsx](../src/components/dining/dining-menu-drawer.tsx))
triggered from a card on the `/dining` board — there is no URL that opens a specific venue's
menu. Resorts have no detail page at all (only the resort-level `/stays` board). So deep links,
SEO, OG cards, and "open this exact thing" UX are all blocked on routing.

## Current routing inventory

TanStack Start file-based routing under [src/routes](../src/routes). Relevant existing routes:

| Route file                     | URL            | Notes                                                  |
| ------------------------------ | -------------- | ------------------------------------------------------ |
| `_dash/park.$slug.tsx`         | `/park/$slug`  | The one real entity detail page. Pattern to copy.      |
| `blog/$slug.tsx`               | `/blog/$slug`  | Slug-keyed detail page.                                |
| `dining.tsx`                   | `/dining`      | Board + filters + modal menu drawer. No per-venue URL. |
| `stays.tsx`                    | `/stays`       | Resort availability board. Resort-level only.          |
| `tickets.tsx`                  | `/tickets`     | Pricing calendar.                                      |
| `og.park.$slug.card[.]png.tsx` | OG image       | Per-park OG card generator — replicate per entity.     |
| `sitemap[.]xml.tsx`            | `/sitemap.xml` | Must enumerate all new detail URLs.                    |

`_dash.tsx` is the authed/dashboard layout wrapper; non-`_dash` routes (dining, stays, tickets)
use the `SidebarProvider` + `AppSidebar` + `AppInset` + `SiteHeader` shell directly (see
[dining.tsx](../src/routes/dining.tsx) for the canonical shell).

## Data model — keys to route on

From [src/db/schema.ts](../src/db/schema.ts):

- **Parks**: `parks.slug` (unique, globally). Already routed.
- **Attractions**: `attractions.slug` is **per-park, NOT globally unique** (line ~136). Deep links
  must be nested under the park: `/park/$parkSlug/ride/$rideSlug`, or use `attractions.id`.
  `attraction_meta` holds land/images. Decide: nested slug route (SEO-friendly) vs id route.
- **Restaurants**: `restaurant_dim.facilityId` (text, the stable upstream id and the join key for
  menus/availability/hours). No slug column exists today. Either (a) add a `slug` column to
  `restaurant_dim` (nicer URLs, needs a migration + backfill) or (b) route on `facilityId`
  (`/dining/$facilityId`) for zero migration. Menus key off `facilityId` regardless.
- **Menus**: `dining_menu_item` joined to `dining_menu_snapshot` (live generation pointer).
  Already exposed via `trpc.dining.menu({ facilityId })`. A menu-item deep link only needs to
  open the venue page and scroll/anchor to the item — items have no stable id worth routing on.
- **Resorts**: `resorts` table + the static `RESORT_BY_ID` catalog referenced by `/stays`
  (see memory: stays data is resort-level only — no room granularity). Route on a resort slug/id.

## Proposed routes

```
/park/$slug                         (exists)
/park/$slug/ride/$rideSlug          NEW — attraction detail (nested; slug unique within park)
/dining/$facilityId                 NEW — restaurant detail + full menu (replaces modal-only)
/dining/$facilityId#menu-<itemkey>  NEW — anchor target for omni-search menu-item rows
/resort/$slug   (or /stays/$slug)   NEW — resort/hotel detail
```

Recommendation: **route restaurants on `facilityId`** first (no migration, unblocks omni-search
immediately); add a human `slug` column as a fast-follow if SEO URLs matter. **Nest rides under
parks** because their slugs aren't globally unique.

## Work breakdown (suggested order)

### 1. Restaurant detail page + menu deep-link (highest leverage — unblocks new omni menu search)

- Add `src/routes/dining.$facilityId.tsx`. Reuse the dining shell from
  [dining.tsx](../src/routes/dining.tsx). Render the venue header (from `trpc.dining.restaurants`
  or a new `trpc.dining.venue({ facilityId })` single-row procedure) + the existing menu content.
- **Refactor the menu content out of the drawer**: the menu rendering already lives in a shared
  `MenuContent`-style block inside
  [dining-menu-drawer.tsx](../src/components/dining/dining-menu-drawer.tsx) (`useMenuState`,
  the meal-period/group/item renderer ~lines 186-340). Extract it into a standalone component
  the new route and the existing drawer both import, so the page and the modal stay in sync.
- Give each menu item a stable anchor id (e.g. `menu-${slugify(mealPeriod)}-${slugify(title)}`)
  so `#menu-…` deep links scroll to it; highlight the anchored row briefly on mount.
- Update omni-search: dining rows →
  `navigate({ to: "/dining/$facilityId", params: { facilityId } })`; menu-item rows → same with
  `hash: menu-<itemkey>`. The omni `menuItems` result already returns `facilityId` and `title`
  — add the same `slugify` so the client can build the hash. (See
  [search.ts](../src/integrations/trpc/routers/search.ts) `menuItems`.)
- 404/empty handling: facility inactive or no menu → graceful "menu not yet captured" state
  (the `menu` procedure already returns empty `mealPeriods`).

### 2. Attraction/ride detail page

- Add `src/routes/_dash/park.$slug.ride.$rideSlug.tsx` (or non-dash, match park.$slug's layout).
- New `trpc.parks.attraction({ parkSlug, rideSlug })` procedure → attraction + meta + latest
  wait/queue + LL price (the parks router already computes wait/LL data — see
  [parks.ts](../src/integrations/trpc/routers/parks.ts) lines ~100-210; factor a single-ride
  variant). Wire forecast/history charts if cheap to reuse.
- Update omni-search attraction rows to navigate here (they have `parkSlug` + need `rideSlug` —
  add `slug` to the attractions payload in [search.ts](../src/integrations/trpc/routers/search.ts)
  `index`; the attractions query already selects from `attractions a`).

### 3. Resort/hotel detail page

- Add `src/routes/resort.$slug.tsx`. Source from `resorts` + the static resort catalog used by
  [stays.ts](../src/integrations/trpc/routers/stays.ts). Show availability summary (link into
  `/stays` pre-filtered), tier/area, map. **Add resorts to the omni-search `index`** as a new
  group (they're absent today) — mirror the parks block.

### 4. Cross-cutting

- **Sitemap**: extend [sitemap[.]xml.tsx](../src/routes/sitemap[.]xml.tsx) to enumerate every
  ride, restaurant, and resort URL.
- **OG cards**: generalize the `og.park.$slug.card.png` generator to rides/restaurants/resorts,
  and set per-page `seo()` head ([src/lib/seo.ts](../src/lib/seo.ts)) with canonical paths.
- **Internal links**: make the dining board cards, park page attraction lists, and `/stays`
  rows link to the new detail routes (progressive — modal can stay as a quick-peek that also
  offers "open full page").
- **Alerts/blog**: ride & dining alert emails and blog embeds can now deep-link to canonical
  detail URLs instead of board pages.

## Decisions to confirm before coding

1. Restaurant URL: `facilityId` (no migration) vs new `slug` column (migration + backfill). →
   Recommend `facilityId` first.
2. Ride route nesting under park vs flat `/ride/$id`. → Recommend nested (slug not globally unique).
3. Resort path: `/resort/$slug` vs `/stays/$slug`. → Recommend `/resort/$slug` (stays = the board).
4. Keep the menu modal drawer as a quick-peek, or replace entirely with navigation? →
   Recommend keep drawer, extract shared menu content, add "open full page" affordance.

## Definition of done

- Every omni-search result row lands on a canonical, shareable URL (no more `/dining` catch-alls).
- Menu-item rows open the venue page scrolled to the item.
- New routes have `seo()` heads, OG cards, and sitemap entries.
- Menu rendering is shared by the drawer and the venue page (no duplication).
- `vp check` and `vp test` pass (run bins via `bun`, per repo convention).
