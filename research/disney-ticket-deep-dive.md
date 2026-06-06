# Walt Disney World ticket feed — deep dive

Captured & verified 2026-06-05 via Claude-in-Chrome on `disneyworld.disney.go.com` (same-origin in-page `fetch`, `credentials:'omit'` to prove no cookie dependence). Companion to `universal-ticket-deep-dive.md`. Disney's architecture is a near-mirror of Universal's: a **catalog/listing** endpoint (taxonomy + "starting from" anchors) plus a **per-date pricing-calendar** endpoint (the demand-priced grid). The discount-group toggle is `affiliations` (Disney's analog of Universal's POO/Florida-Resident).

All claims below were reproduced by replaying the request unless marked **UNVERIFIED**.

---

## 1. Three endpoints

### E0 — Store config (anonymous, no auth)

`GET /com-shared/api/get-store/wdw` — **200 with `credentials:'omit'`, no bearer.**
The bootstrap doc. Key fields driving everything else:

- `affiliations: [STD_GST, PASSHOLDER, STORE_INSTANCE_AFFILIATIONS_DVC, CHARTER, STORE_INSTANCE_AFFILIATIONS_DISNEY_STREAMING, CANADA_RESIDENT]` — the discount-group universe.
- `productCategories: [AnnualPass, NBAExperience, SpecialEvent, AnnualPassRenewal, MemoryMaker, RESORT_PACKAGE, ROOM_ONLY, PersonalMagic, ThemePark, WaterPark]`.
- `availNumDays: 120` (purchase/checkout window) — note this is the _cart_ window; the **pricing calendar reaches ~17 months** (see E2), so 120 is not the price horizon.
- `dtiName: "progenstr"` = the `bookingContextId`; it is the `_progenstr` suffix on every `productInstanceId`.
- `authorizationType: ...NO_AUTHENTICATION`, `maxEntitlementsPerTransaction: 15`.

### E1 — Catalog / product-listing (anonymous **client-token bearer** required)

`GET /api/lexicon-view-assembler-service/wdw/tickets/product-listing?storeId=wdw&affiliations={CSV}`

- **401 without a bearer**; **200 with the anonymous client token** (`credentials:'omit'` + bearer → 200, so it is gated by the token, NOT by Akamai sensor cookies).
- Token: `GET /authentication/get-client-token` → `{access_token, expires_in:1201}` (~20 min, anonymous, no login). Header on E1/E2: `Authorization: BEARER <token>`.
- `affiliations` is **additive/contextual, not a filter.** Requesting `STD_GST` alone returns only `STD_GST`; requesting `PASSHOLDER` (or the union) returns every group the _anonymous_ token may see. **The anonymous token surfaces exactly three groups: `STD_GST`, `CANADA_RESIDENT`, `FL_RESIDENT`.** `PASSHOLDER`, `DVC`, `CHARTER`, `DISNEY_STREAMING` add nothing without real authentication — they are login-gated affiliations.
- One union call enumerates the whole anonymous catalog:
  `affiliations=STD_GST,PASSHOLDER,STORE_INSTANCE_AFFILIATIONS_DVC,CHARTER,STORE_INSTANCE_AFFILIATIONS_DISNEY_STREAMING,CANADA_RESIDENT,FL_RESIDENT`
- Response: `discountGroups[group].products[productKey]` → `{productKey:{productType,addOn,discountGroup}, startingFromPrices{adult,child}, ticketDays{adult[],child[]}, isVariablePricing, names, descriptions}`. Each `ticketDays[age][]` entry has `{numDays, productInstanceId, startingFromPrice{subtotal,tax,total,pricePerDay}, priceDates[], names, policyIds, featureIds}`. Plus top-level `policies`, `productTypes`, `features` (incl. parkId features), `supportedAgeRanges`.
- `priceDates[]` here are only the _example_ lowest-price dates, **not** the full calendar — that is E2.

### E2 — Per-date pricing calendar (the demand feed)

`GET /api/lexicon-view-assembler-service/wdw/tickets/product-types/{productType}?storeId=wdw&addOn={false|park-hopper|park-hopper-plus|water-parks-sports}&excludePricingCalendar=false`

- Same bearer gate as E1 (anonymous client token; cookieless verified).
- Returns `pricingCalendar.pricingCalendar[]` = **10 buckets (numDays 1–10)**, each `.dates[]` = **514 dates**, spanning **2026-06-06 → 2027-10-31** (~17 months). Each date:
  ```
  {date, validityStartDate, validityEndDate, bufferDays, currency,
   pricing:[ {id, ageGroup, pricePerDay, subtotal, tax, commission,
              taxInclusiveIndicator:true, validityStartDate, validityEndDate,
              stopSale, priceFromDPE:true} ] }
  ```
  `id` == the `productInstanceId` (join key). `priceFromDPE:true` = priced by Disney Pricing Engine (demand).
- Top-level also: `soldOut`, `hasBlockoutDates`, `blockoutDates[]`, `themeParks[{facilityId,name}]`, `sellable`, `marketable`.
- **`stopSale:true` is the per-product/date sold-out flag.** Currently `false` on every date (date-based tickets effectively never sell out post-2024; park-pass reservations were retired Jan 2024 — see the `availability-calendar` reframe in `gated-feeds-report.md`).

---

## 2. The 1-day park-specific finding (Disney-specific, not in Universal)

For **1-day** products the pricing calendar emits **one row per park per age** on each date — the park is encoded in the `id` suffix:

| suffix | park              | facilityId |
| ------ | ----------------- | ---------- |
| `_mk`  | Magic Kingdom     | 80007944   |
| `_ep`  | EPCOT             | 80007838   |
| `_hs`  | Hollywood Studios | 80007998   |
| `_ak`  | Animal Kingdom    | 80007823   |

So a single 1-day date carries 4 parks × 2 ages = 8 pricing rows, each with its own price + `stopSale`. **Verified 1-day adult demand spread across 513 priced dates:**

| park              | min  | max  |
| ----------------- | ---- | ---- |
| Animal Kingdom    | $119 | $189 |
| EPCOT             | $129 | $214 |
| Hollywood Studios | $139 | $209 |
| Magic Kingdom     | $139 | $219 |

MK is the premium park, AK the cheapest — **per-park demand pricing is real and observable here**, and `_mk/_ep/_hs/_ak` is the only place the feed resolves price/availability to a specific park. Multi-day (2–10) products are park-agnostic ("1 park per day" / hopper) — e.g. 5-day per-day adult ranges $102.52–$163.50.

---

## 3. The complete anonymous catalog (3 discount groups)

`isVariablePricing` distinguishes demand-priced (E2 calendar applies) from flat. All `_progenstr` suffixes omitted below.

### STD_GST (Standard Guest) — all `variable=true`

| productKey                                             | type                         | addOn              | days | instanceId pattern                                   |
| ------------------------------------------------------ | ---------------------------- | ------------------ | ---- | ---------------------------------------------------- |
| `theme-parks`                                          | theme-park                   | — (1 park/day)     | 1–10 | `theme-park_{n}_{A/C}_0_0_RF_AF_SOF[_park]`          |
| `theme-parks-with-park-hopper`                         | theme-park                   | park-hopper        | 1–10 | `..._{A/C}_P_0_RF_AF_SOF`                            |
| `theme-parks-with-park-hopper-plus`                    | theme-park                   | park-hopper-plus   | 1–10 | `..._{A/C}_PHP_0_RF_AF_SOF`                          |
| `theme-parks-with-water-parks-sports`                  | theme-park                   | water-parks-sports | 2–10 | `..._{A/C}_WPS_0_RF_AF_SOF`                          |
| `after-2pm-ticket-offer`                               | after-2pm-ticket-offer       | —                  | 2–3  | `after-2pm-ticket-offer_{n}_{A/C}_0_0_RF_AF_SOT`     |
| `four-park-magic-ticket-offer`                         | four-park-magic-ticket-offer | —                  | 4    | `four-park-magic-ticket-offer_4_{A/C}_0_0_RF_AF_SOT` |
| `four-park-magic-ticket-offer-with-water-parks-sports` | four-park-magic-ticket-offer | water-parks-sports | 4    | `..._4_{A/C}_WPS_0_RF_AF_SOT`                        |

Anchor prices (adult subtotal): 1-day base $119–$219 (park-dependent), 10-day base $634.69; Park Hopper +~$78/ticket; Park Hopper Plus +~$94.50; WPS +~$95. 4-Park Magic $399 (4 admissions, 4 parks); After-2 PM 2-day $234.99.

### FL_RESIDENT (Florida Resident) — two distinct product families

**(a) `special-summer-ticket*` — `variable=false` (FLAT), 2–4 day, reservation-required** (`reservationRequired-true`, validity May 17–Oct 3 2026):
| productKey | addOn | adult start |
|---|---|---|
| `special-summer-ticket-for-fl-resident` | — | $219 (2d) |
| `special-summer-ticket-with-park-hopper-for-fl-resident` | park-hopper | $259 |
| `special-summer-ticket-with-water-parks-sports-for-fl-resident` | water-parks-sports | $254 |
| `special-summer-ticket-with-park-hopper-plus-for-fl-resident` | park-hopper-plus | $271.50 |
Pattern: `special-summer-ticket_{n}_{A/C}_{0/P/WPS/PHP}_2_RF_AF_SOT`. Flat per-tier ($65/day 4-day, $80/day 3-day, $110/day 2-day) — no E2 calendar.

**(b) `theme-parks-*-for-fl-resident` — `variable=true`, days 1/3/4** (regular date-based, FL-discounted ~30–40% on 3/4-day):
`theme-parks-for-fl-resident`, `-with-park-hopper-`, `-with-park-hopper-plus-`, `-with-water-parks-sports-`. Pattern `theme-park_{n}_{A/C}_{addon}_2_RF_AF_SOF[_park]`. 1-day base FL adult from $119 (park-specific, `_ak`).

### CANADA_RESIDENT — all `variable=true`, days 4–10

| productKey                                                  | addOn              | adult start (4d) |
| ----------------------------------------------------------- | ------------------ | ---------------- |
| `canada-ticket-for-canada-resident`                         | —                  | $392.69          |
| `canada-ticket-with-park-hopper-for-canada-resident`        | park-hopper        | $460.69          |
| `canada-ticket-with-water-parks-sports-for-canada-resident` | water-parks-sports | $456.69          |
| `canada-ticket-with-park-hopper-plus-for-canada-resident`   | park-hopper-plus   | $485.09          |

Pattern `canada-ticket_{n}_{A/C}_{addon}_21_RF_AF_SOT`. ~20% off std (4-day base $392.69 vs std $490.86). Demand-priced via E2 (`product-types/canada-ticket`).

**Catalog totals (anonymous):** STD_GST 7 productKeys, FL_RESIDENT 8 (4 flat summer + 4 variable theme-park), CANADA_RESIDENT 4 = **19 product configurations**, each fanning to adult+child × day-counts × (4 parks for 1-day).

---

## 4. productInstanceId taxonomy (decoded)

```
{productType}_{numDays}_{A|C}_{addOn}_{affiliation}_RF_AF_{SOF|SOT}_progenstr[_park]
```

- **productType**: `theme-park` | `after-2pm-ticket-offer` | `four-park-magic-ticket-offer` | `special-summer-ticket` | `canada-ticket`
- **numDays**: 1–10
- **age**: `A` adult (10+) | `C` child (3–9)
- **addOn**: `0` 1-park-per-day (base) | `P` Park Hopper | `PHP` Park Hopper Plus | `WPS` Water Park & Sports
- **affiliation**: `0` Std Guest | `2` FL Resident | `21` Canada Resident _(other digits presumably for the login-gated affiliations — UNVERIFIED)_
- `RF_AF`: constant flags on every SKU (refundable / agency? — exact meaning **UNVERIFIED**, but invariant so safe to treat as literal)
- **offer flag**: `SOF` on regular date-based theme-park tickets; `SOT` on special offers (after-2pm, 4-park-magic, summer, canada). Hypothesis: SOF = standard selectable-start, SOT = special-offer ticket. Exact meaning **UNVERIFIED**.
- **park** (1-day only): `_mk` | `_ep` | `_hs` | `_ak`

---

## 5. Domain model (drop-in for the parkfi schema)

Mirrors the Universal mapping so WDW + Universal share tables.

**`product_dim`** — populate from E1 weekly. Natural key = `productInstanceId` with `_progenstr` stripped (stable). Columns:
`resort='WDW'`, `product_family` (theme-park/after-2pm/4-park-magic/summer/canada), `duration_days`, `age_group` (adult/child), `addon` → derive `park_to_park` (P/PHP true), `water_park` (PHP/WPS true), `residency` (std/fl/canada), `park_scope` (specific MK/EP/HS/AK for 1-day else 'choose-1-per-day' or 'hopper'), `variable_priced` (= `isVariablePricing`), `reservation_required` (FL summer only).

**`product_price_obs`** — `(product_instance_id, park_id?, date, price_cents, tax_cents, stop_sale, observed_at)`. Source = E2. One call per (productType, addOn) returns the full 514-date × 10-day-bucket grid; for 1-day rows split out `park_id` from the `_park` suffix. `priceFromDPE` always true for variable products → store as the demand signal. Flat FL-summer products have no E2 calendar; take price from E1 `startingFromPrice` (it _is_ the price).

**`ticket_availability`** — `(park_id, date, state, observed_at)`. **Derive from `stopSale` on the 1-day park-specific E2 rows** (the only park-resolved product): `stopSale:true → SOLD_OUT`, else `AVAILABLE`. Also fold in top-level `blockoutDates[]` and `hasBlockoutDates`. Do **not** use the legacy `availability-calendar` API — it returns `[{}]` = "all available" since reservations were retired (see report). `stopSale` is currently uniformly false, so today every park/date reads AVAILABLE; the column exists for when Disney re-enables stop-sales (historically used on peak holidays).

**Cadence & cost:** E0 once (rarely changes); E1 catalog weekly; E2 daily — ~6–10 calls/day total (theme-parks base + 3 add-on variants + after-2pm + 4-park-magic + canada-ticket; FL summer is flat so skip E2). Mint one client token per run (~20 min TTL covers a full sweep). Each E2 call is ~5,000 price rows (514 dates × up to 8 park/age rows for 1-day, fewer for multi-day) — trivial volume.

---

## 6. Auth / bot / production notes

- **No login, no Akamai sensor cookie needed** for the ticket feed: E1+E2 proven with `credentials:'omit'` + anonymous client-token bearer → 200. E0 needs nothing.
- Anonymous token = STD_GST + CANADA_RESIDENT + FL_RESIDENT only. **Passholder, DVC, Charter, Disney-Streaming affiliations require real authenticated sessions** (login) — out of scope for an anonymous scraper, and their pricing is mostly flat/renewal anyway.
- **Annual Passes**: confirmed present in-store (`productCategories` has `AnnualPass`/`AnnualPassRenewal`) but **NOT served by the `/tickets/` assembler path** — `…/annual-passes/product-listing`, `…/passes/product-listing`, and `…/annual-passes/product-types/{incredi-pass|annual-pass}` all 400/404. The right slug is unmapped; to find it, load `disneyworld.disney.go.com/passes/` in the browser and capture the `lexicon-view-assembler-service` XHR. Low priority (flat-priced, infrequent changes). **UNVERIFIED.**
- **LL Multi Pass / Genie+ daily price** remains MDE-app-gated (per-user login) — unchanged from the report.
- **Disney dining** (`finder/api/v1/explorer-service/dining-availability-details/{facilityId}`) accepts an anonymous bearer (405 on wrong method, not 401) — promising, still **UNVERIFIED**.
- **Production risk (shared with Universal):** these are residential-browser captures; datacenter-IP (Railway) blocking by Akamai/Imperva at the `disneyworld.disney.go.com` edge is **UNVERIFIED**. Mitigation: Browserless v2 `/unblock` + residential proxy fallback. The token mint + E1/E2 are plain JSON GETs, so a lightweight headless or even server-side HTTP client should work if the IP isn't blocked.

---

## 7. Dining reservation availability ("dine-vas") — captured, but user-session-gated

Captured live from the dine-res SPA (`/dine-res/restaurant/{slug}/`) by intercepting its own XHR.

**Endpoint:**

```
GET https://disneyworld.disney.go.com/api/availability/{partySize}/{startDate},{endDate}?facilityId={facilityId};entityType=restaurant
```

- `partySize` integer; date is a **`start,end` range** — observed with `start==end` (single day). A multi-day span (27-day) replay returned 500, so treat **single-day as the supported form** (multi-day **UNVERIFIED**).
- `facilityId` carries a matrix param `;entityType=restaurant`. No mealPeriod needed (date+party+facility suffices).
- Service is internally "**dine-vas**" (Dining Availability Service), per the `x-disney-internal-dine-vas-*` headers.

**Auth — requires a logged-in guest (this is NOT the anonymous-token story tickets are). VERIFIED both directions:**

- **Required**: a logged-in **OneID/SWID session** (the dine-res app authenticates via `registerdisney.go.com`). When logged in, the live `getAvailability` XHR sends **both** an `Authorization` bearer (user token) **and** session cookies, plus these SPA routing headers (values captured):
  - `X-Function-Name: getAvailability`
  - `X-Correlation-Id: <uuid>`, `X-Conversation-Id: <uuid>` (client-generated per call)
  - `x-disney-internal-dine-vas-eks: true`, `x-disney-internal-dine-vas-365: true` (canary/routing flags)
  - `Accept: application/json, text/plain, */*`
- Reproduction matrix (all replayed in-page):
  - Logged out, no bearer/headers → **500**.
  - Anonymous **ticket** client-token bearer (the E1/E2 token), no routing headers → transport **HTTP 200** but app-level `{code:404,"error.404.default.message"}` (no `X-Function-Name`, no guest session) → **anonymous reproduction FAILS.**
  - **Logged in (user signed into Disney account in the browser) → HTTP 200 with populated data.** ✓
- Page is additionally behind **Akamai Bot Manager** (obfuscated sensor POSTs returning 201) + OneID.

**Populated success schema — VERIFIED** (captured logged-in: Tiffins, party 4, 2026-06-06):

```
{ statusCode, restaurants: { "<YYYY-MM-DD>": [ mealPeriod ] } }   // keyed by date
mealPeriod = {
  enterpriseMealPeriodId, mealPeriodType:"Lunch", mealPeriodName:"Tiffins Lunch",
  startTime:"11:30:00", endTime:"15:55:00", cuisine:"American", serviceStyle:"A la Carte",
  experienceType, isAddOnEnable, isUpgradeAvailable,
  offersByAccessibility: [ offer ]            // the bookable time slots (empty array = no tables)
}
offer = { offerId:"<id>:1", time:"11:30:00", label:"11:30 AM" }
```

Empty/no-availability states return `{code, message}` (e.g. `code:404`) or `{errors, statusCode, error}` instead of `restaurants`. So the **`dining_obs` signal** is: per `(facilityId, date, partySize)` → for each meal period, the list of `offer{time,label,offerId}`; **non-empty `offersByAccessibility` = a bookable table** at that time. `facilityId;entityType=restaurant` is the join key.

**Domain model — `dining_obs`:** `(facility_id, date, party_size, meal_period, offer_time, observed_at)` one row per available slot (+ a `(facility_id,date,party_size)` "checked, none available" marker for the empty case). Cadence: this is the most perishable feed (tables flip minute-to-minute near 60-day booking opening) — sweep hot restaurants/dates frequently, cold ones rarely.

See **§9** for the restaurant catalog / dimension source.

---

## 9. Dining catalog — `/dine-res/api/dine/facilities` (restaurant dimension)

`GET https://disneyworld.disney.go.com/dine-res/api/dine/facilities` returns the **full WDW dining catalog** — the source for `restaurant_dim` and for auto-discovering sweep targets.

- **Auth: session-gated, same as getAvailability.** 401 anonymous; **403 even with the anonymous client-token** (recognized but not entitled); 200 only under the logged-in OneID session. So the catalog refresh reuses the scraper's maintained session.
- **All three categories are sweepable** via `getAvailability` (confirmed) — pass the entry's `id` straight through as `facilityId`; the entityType is already embedded in it.

### Response shape

Top level = an object keyed by **category**, each a map of **`{facilityId}` → entry**:

```
{
  "restaurant":  { "<facilityId>": <entry>, ... },
  "dinnerShow":  { "<facilityId>": <entry>, ... },
  "diningEvent": { "<facilityId>": <entry>, ... }
}
```

Note: the live payload also contains an `errors`/`statusCode`/`error` envelope shape on failure — guard for `restaurant` presence before iterating.

**`id` field = the getAvailability join key**, with entityType embedded:
| category | `id` format | getAvailability `facilityId` arg |
|---|---|---|
| `restaurant` | `"98575;entityType=restaurant"` | `…?facilityId=98575;entityType=restaurant` |
| `dinnerShow` | `"80010856;entityType=dinner-show"` | `…?facilityId=80010856;entityType=dinner-show` |
| `diningEvent` | `"140873;entityType=dining-event"` | `…?facilityId=140873;entityType=dining-event` |

### Entry schema (fields used for the dimension)

```
entry = {
  id,                              // "{facilityId};entityType={restaurant|dinner-show|dining-event}"
  name,                            // "The Turf Club Bar and Grill"
  description, sortProductName,
  primaryCuisineType,              // "American"        (restaurant)
  priceRange,                      // "$$ ($15 to $34.99 per adult)"
  experienceType,                  // "Casual Dining" | "Signature Dining" | "Dinner Shows" ...
  mealPeriodType, type,            // "Dinner" | "Breakfast" | "Lunch"
  ancestorLocationParkResort,      // "Disney's Saratoga Springs Resort & Spa"  (park/resort name)
  ancestorLocationParkResortId,    // "80010383"
  ancestorLocationParkResortType,  // "WDW Resort Area" | "Theme Park"
  ancestorLocationLandArea(+Id +Type),  // sub-area
  coordinates: { "Guest Entrance": { gps: { latitude, longitude } } },
  sellableOnline,                  // bool
  admissionRequired, disneyOwned, quickServiceAvailable, reservationsRecommended,
  hasDiningEventsAssociated,
  webLinks: { wdwDetail:{href,title}, reservableExperience?:{href,title} },
  media / mediaGalleries,          // image URLs (skip for the dim)
  facets: [ { id, title, type, urlFriendlyId }, ... ]   // see below
}
```

(`dinnerShow`/`diningEvent` entries share the core fields; dinner-shows add e.g. a `seatingChart` media + family-style/price facets, dining-events add `eec-*` price/age/accessibility facets.)

### `facets[]` — how to classify / filter

Each facet: `{ id, title, type, urlFriendlyId }`. Useful flags by `urlFriendlyId` (or `id`):

- **bookable / reservable**: `reservations-accepted` (16983862) and/or `checkavailmodulewdw` (17385675) — gate sweeping on these + `sellableOnline:true`.
- **category type**: `is-restaurant` (16726823), `dinner-show` (16726809), `is-dining-event` (16726821), `dine-event-not-bookable` (412087442 → exclude).
- **service style**: `table-service-type`, `casual-dining`, `signature-dining`, `family-style`, `a-la-carte`, `quick-service`.
- **cuisine**: `*-cuisine` (e.g. `american-cuisine`), and `primaryCuisineType` on the entry.
- **price tier**: `Price Range Dining` type (`priceLegend1..4`), or the `priceRange` string.
- **location/area**: `Dining` type facets (`mk-area`, `epcot-area`, `ds-area`, `resort-dining`, `theme-park-dining`) — plus the structured `ancestorLocation*` fields (prefer those).
- **walk-up**: `walkupWaitList` (19569082).

### → `restaurant_dim` mapping & usage

Columns: `facility_id` (bare numeric, split off `;entityType`), `entity_type` (`restaurant`/`dinner-show`/`dining-event`), `name`, `cuisine` (`primaryCuisineType`), `price_range`, `experience_type`, `service_style` (from facets), `park_resort` + `park_resort_id` + `park_resort_type` (from `ancestorLocation*`), `lat`/`lng` (from `coordinates`), `wdw_url` (`webLinks.wdwDetail.href`), `bookable` (facet-derived), `sellable_online`, `is_active` + `last_seen_at`.

- **Refresh** weekly/daily via the maintained session → **upsert** on `facility_id`; **soft-delete** (set `is_active=false`/`last_seen_at`) when a venue drops out — never hard-delete (preserves `dining_obs` FK + history).
- **Sweep set** = `bookable` rows filtered by a separate, config-controlled `hot`/priority flag — so a catalog refresh widens the candidate pool without silently expanding the active sweep.

**Reproduction recommendation / confidence:** **MEDIUM, session-bound.** Schema + auth are now fully VERIFIED, but there is **no anonymous path** (unlike tickets). Production needs a **maintained logged-in session**:

- **Recommended pattern (decouple login from scraping):** seed once via a real interactive login, persist Playwright `storageState()` (cookies + localStorage incl. the OneID token) to a secret store, and **reuse** it across runs — replicating `X-Function-Name: getAvailability` + freshly-generated `X-Correlation-Id`/`X-Conversation-Id` UUIDs + the two `x-disney-internal-dine-vas-*: true` flags. Refresh/re-seed only on 401/redirect-to-login.
- **Automated-login (last-resort refresh only):** scripted Playwright/Puppeteer login reading creds from env vars — e.g. `DISNEY_LOGIN_EMAIL` / `DISNEY_LOGIN_PASSWORD` (better: a secret manager, not plain env, since env leaks into logs). Use a **dedicated throwaway account with no payment method on file**, a **residential proxy** (datacenter IPs both block and raise login risk-scoring), and expect intermittent Akamai/reCAPTCHA challenges — which is exactly why automated login should be the rare fallback, not the per-run mechanism. Automated login likely violates Disney ToS; account-ban risk applies.
- **Cheaper alternative for `dining_obs`:** a competitor reservation finder (Mouse Dining / TouringPlans) avoids the auth + ToS exposure entirely. Given dining is the one feed without an anonymous path, weigh whether the maintained-session cost is worth it vs. tickets (which are clean and anonymous).

---

## 8. Automating the MyDisney (OneID) login — Browserless/Puppeteer

The login is **MyDisney / Disney OneID**, an **identifier-first** flow (email step, then password step), rendered by the OneID "lightbox" client (`appid=DTCI-ONEID-UI`, client `TPR-WDW-LBJS.WEB-PROD`) and backed by `registerdisney.go.com`. Goal: produce a logged-in session (cookies + OneID token), persist it as Playwright/Puppeteer `storageState`, and reuse it for the dine-vas `getAvailability` calls (§7).

### Flow (observed & verified live, 2026-06-05)

1. Homepage `https://disneyworld.disney.go.com/` → top-right link **"Log In or Create Account"** = `a.signIn[href="/login/"]`. (Equivalently just `page.goto('/login/')`.)
2. `/login/` opens the **Disney OneID lightbox** — a **cross-origin iframe `#oneid-iframe` (src `cdn.registerdisney.go.com`)**; the top `<html>` gains class `oneid-lightbox-open`. (A same-origin helper iframe `#oneid-secure-responder` also exists; the real form is in `#oneid-iframe`.)
3. OneID screen 1 — **"Enter your email to continue"**: an `Email` text field + **Continue** button (alt link "Looking for username login?").
4. OneID screen 2 — **"…you already have a MyDisney account"**: a `Password` field (with show/hide eye toggle) + **Log In** button. Also present: an `edit` link (change email), a back arrow, and an optional **"Having trouble logging in? Send a one-time code"** link — the normal path is **flat email + password**; OTP is not forced.
5. On success → redirect back to disneyworld; guest session cookies (incl. `SWID`) + OneID token are set. Subsequent dine-vas XHRs carry `Authorization: BEARER <token>` + cookies.

### Critical gotchas (why a naïve script breaks)

- **The form is a CROSS-ORIGIN iframe** (`#oneid-iframe` → `cdn.registerdisney.go.com`). VERIFIED: top-frame `document.querySelector` and the browser a11y/`find` tools **cannot see into it** — they only see the disneyworld top doc (incl. the OneTrust dialog). **Puppeteer must grab the OneID frame handle** (`page.frames().find(f => /registerdisney/.test(f.url()))`) and query inputs on _that frame_. Puppeteer/CDP _can_ reach cross-origin frame DOM (unlike page JS), so this works — but only if you target the frame, not the page.
- **Dynamic element IDs** — IDs are generated; do **not** hard-code them. Use stable attributes within the frame: `input[type="email"]`, `input[type="password"]`, and match buttons by text (`Continue`, `Log In`).
- **Akamai Bot Manager** sits on the login + site (sensor POSTs). From a **datacenter IP this is the main failure point** — use Browserless **stealth** + a **residential proxy**, a realistic UA/viewport, and human-like typing (`{delay: 60}`). Expect intermittent reCAPTCHA / "verify it's you".
- **OneTrust cookie consent** (`cdn.cookielaw.org`) lives in the **top doc** and can overlay/intercept clicks — dismiss `#onetrust-accept-btn-handler` first, before touching the iframe.
- **OTP fallback exists but isn't required**: the "Send a one-time code" link is optional. The happy path is type-password → Log In. (If an account _forces_ a code or 2FA, you'd need IMAP OTP retrieval — avoid by using a dedicated account without 2FA.)
- **Decouple login from scraping**: log in _rarely_ (sessions are long-lived). Persist `storageState` to your secret store and **reuse**; only re-login on 401/redirect-to-login. Repeated logins are what trip lockouts/bot-scoring.

### Reference script (Puppeteer over Browserless)

```js
// ENV: DISNEY_EMAIL, DISNEY_PASS (prefer a secret manager over plain env),
//      BROWSERLESS_WS = wss://<region>.browserless.io?token=...&stealth&proxy=residential
const puppeteer = require("puppeteer-core");

// Wait for the OneID iframe (cdn.registerdisney.go.com) and return its Frame handle.
async function oneidFrame(page, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const f = page.frames().find((fr) => /registerdisney\.go\.com/.test(fr.url()));
    if (f) return f;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("OneID frame never appeared");
}
// Click a button/link inside a given frame by its visible text.
const clickByText = (frame, text) =>
  frame.evaluate((t) => {
    const b = [...document.querySelectorAll("button,[role=button],a,[type=submit]")].find(
      (e) => e.textContent.trim().toLowerCase() === t.toLowerCase(),
    );
    if (!b) throw new Error("no button: " + t);
    b.click();
  }, text);

async function login() {
  const browser = await puppeteer.connect({ browserWSEndpoint: process.env.BROWSERLESS_WS });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // entry: /login/ opens the OneID lightbox directly
  await page.goto("https://disneyworld.disney.go.com/login/", { waitUntil: "networkidle2" });

  // dismiss OneTrust consent (top doc) — it can overlay/intercept clicks
  await page
    .evaluate(() => document.querySelector("#onetrust-accept-btn-handler")?.click())
    .catch(() => {});

  // the form is INSIDE the cross-origin OneID iframe — operate on the frame, not the page
  const frame = await oneidFrame(page);

  // screen 1: email
  await frame.waitForSelector('input[type="email"]', { visible: true, timeout: 20000 });
  await frame.type('input[type="email"]', process.env.DISNEY_EMAIL, { delay: 60 });
  await clickByText(frame, "Continue");

  // screen 2: password (same iframe; wait for the field to render)
  await frame.waitForSelector('input[type="password"]', { visible: true, timeout: 20000 });
  await frame.type('input[type="password"]', process.env.DISNEY_PASS, { delay: 60 });
  await clickByText(frame, "Log In");

  // success: redirected back to disneyworld with the SWID session cookie set
  await page.waitForFunction(
    () => /disneyworld\.disney\.go\.com/.test(location.host) && /SWID/i.test(document.cookie),
    { timeout: 45000 },
  );

  // persist session for reuse (cookies + localStorage) → write to your secret store
  const cookies = await page.cookies();
  const localStorageState = await page.evaluate(() => JSON.stringify(localStorage));
  return { browser, page, cookies, localStorageState };
}
```

### Harvesting the session for dine-vas (two options)

- **(A) In-page replay (simplest, most robust):** keep the logged-in `page` and call `getAvailability` from the page context so it inherits cookies + OneID auth automatically:
  ```js
  const data = await page.evaluate(
    async (fid, date, party) => {
      const r = await fetch(
        `/api/availability/${party}/${date},${date}?facilityId=${fid};entityType=restaurant`,
        {
          headers: {
            Accept: "application/json, text/plain, */*",
            "X-Function-Name": "getAvailability",
            "X-Correlation-Id": crypto.randomUUID(),
            "X-Conversation-Id": crypto.randomUUID(),
            "x-disney-internal-dine-vas-eks": "true",
            "x-disney-internal-dine-vas-365": "true",
          },
        },
      );
      return r.json();
    },
    "<facilityId>",
    "2026-07-15",
    2,
  );
  // data.restaurants[date][].offersByAccessibility[] => bookable slots (§7)
  ```
- **(B) Extract the bearer for server-side replay:** intercept one live `getAvailability` request and read its `Authorization` header, then replay from your backend with cookies + that bearer + the routing headers. More fragile (token rotates) — prefer (A) unless you must run outside the browser.

### Re-seed / refresh

Treat the persisted `storageState` as the working session. Before/within a scrape run, hit one cheap `getAvailability`; on `401`/redirect-to-login, run `login()` again (rare path) and re-persist. Keep `login()` off the per-request path.

**Reminders:** dedicated throwaway account, no payment method on file, residential proxy, polite rate limits. Automated login likely violates Disney's ToS (account-ban risk) — this documents _how_, not an endorsement; weigh it against the competitor-feed alternative in §7.
