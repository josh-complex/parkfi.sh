# Gated theme-park feeds — integration spec (Disney WDW + Universal Orlando)

**Captured:** 2026-06-05, via real Chrome + network/JS inspection on the live purchase flows.
**Execution target:** Browserless v2 headless Chromium on Railway (datacenter IP), puppeteer/playwright over WebSocket.
**Proof standard:** every "WORKING" request below was replayed and returned real data in this session. Unverified items are labeled.

> **UPDATE 2026-06-05 (later session):** Two dedicated deep-dives now supersede the per-feed detail here and are the authoritative source:
>
> - `research/universal-ticket-deep-dive.md` — full Universal catalog crawl (95 SKUs), taxonomy, no-window-cap pricing pipeline, domain model.
> - `research/disney-ticket-deep-dive.md` — full WDW ticket crawl via the `affiliations` toggle (STD_GST + **Canada Resident** + Florida Resident, 19 product configs), the E0/E1/E2 endpoint chain, 1-day **park-specific** pricing, **and dining (§7) now fully VERIFIED logged-in** (populated `getAvailability` schema + auth + automated-login/env-var guidance). Where this report and the deep-dives disagree, trust the deep-dives.

---

## TL;DR per feed

| Feed                                          | Resort | Source (proven)                                                                            | Server-reproducible?                                       | Bot/proxy risk                    | Confidence                                                                                       |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Ticket-date availability (park reservation)   | WDW    | `availability-calendar/api/calendar`                                                       | YES, plain HTTP, no auth                                   | low                               | **High**                                                                                         |
| Date-based ticket price + sold-out            | WDW    | `get-client-token` → `lexicon-view-assembler-service/.../product-types/{slug}`             | YES, anonymous bearer, **cookieless**                      | low–med (datacenter IP untested)  | **High**                                                                                         |
| LL Multi Pass / Genie+ daily price            | WDW    | My Disney Experience app/web API (auth)                                                    | only per-user logged-in                                    | high (login + Akamai)             | **Medium**                                                                                       |
| Express Pass price + availability + inventory | UOR    | `gettickets` + `priceAndInventory/v2` on `api.universalparks.com`                          | YES, via web guest-auth handshake                          | med–high (Akamai + guest session) | **High**                                                                                         |
| Date-based admission ticket price             | UOR    | same `gettickets` + `priceAndInventory/v2`                                                 | YES (same handshake)                                       | med–high                          | **High (schema = Express, verified); ticket per-date call observed not separately replayed**     |
| Virtual Line                                  | UOR    | official app OIDC API; mostly dormant in 2026                                              | per-user app session                                       | high                              | **Medium**                                                                                       |
| Date-based ticket price (all affiliations)    | WDW    | `get-client-token` → `tickets/product-listing?affiliations={CSV}` + `product-types/{slug}` | YES, anonymous bearer, cookieless                          | low–med (datacenter IP untested)  | **High** — full crawl in `disney-ticket-deep-dive.md` (STD/Canada/FL, 1-day park-specific)       |
| Dining availability (`getAvailability`)       | WDW    | `/api/availability/{party}/{date},{date}?facilityId=…` ("dine-vas")                        | only logged-in (Authorization + session + routing headers) | high (OneID + Akamai)             | **Medium** — schema+auth VERIFIED logged-in (`disney-ticket-deep-dive.md` §7); no anonymous path |

---

# DISNEY (Walt Disney World)

## D1. Ticket-date availability / park-reservation calendar — the user's "dead end", RESOLVED

### Working request

```
GET https://disneyworld.disney.go.com/availability-calendar/api/calendar?segment=tickets&startDate=2026-06-05&endDate=2026-07-31
Accept: application/json
# No auth, no special cookies required.
```

Response (every segment ∈ {tickets,passholder,resort}, every date range tested, anonymous AND logged-in, with/without cookies):

```json
[{}]
```

### What `[{}]` actually means (the reframe)

The user concluded `[{}]` = data gated behind Akamai. **It is not.** Evidence:

- The live on-page calendar widget ("Check Theme Park Reservation Availability") renders **every date green = "All Parks Available"** by consuming exactly this `[{}]` response. No other availability XHR fires (confirmed via `performance.getEntriesByType('resource')` and a fetch interceptor — the only network calls on modal open are Adobe/analytics).
- I replayed it logged-in, in-browser, with `credentials:'include'`, for all three segments and for holiday ranges (late-Dec): identical `[{}]`.
- Disney **retired park-pass reservations for date-based tickets in Jan 2024**. So there are no per-date restrictions to report → empty array → UI defaults every date to AVAILABLE.

So `[{}]` is a legitimate **"no restrictions"** payload, not a block. The array is populated only when restrictions exist (historic passholder blockout dates), as `[{<date>: {...status, parks[]}}]`.

### Server-side reproduction

Plain server HTTP client. No sensor cookies, no login, no proxy needed. The Akamai headers the user saw are edge routing; the JSON endpoint is not bot-gated for this data.

### Schema → `ticket_availability`

- Empty `[{}]` → state = **AVAILABLE** for all (park,date) for date-based tickets (current regime).
- When populated: per-date object keyed by date with a status (`none`/`partial`) + array of available park facilityIds → map `none`→AVAILABLE, `partial`→LIMITED, absent/blockout→SOLD_OUT.
- Park facilityIds (confirmed from the product API `themeParks[]`): MK `80007944`, EPCOT `80007838`, AK `80007823`, DHS `80007998`.

### Note

For standard date-based tickets the _meaningful_ per-date signal today is **price** (D2), not availability — availability is effectively always-open. Keep D1 as a cheap daily sentinel that will light up if/when Disney reinstates caps or for restricted promo tickets.

---

## D2. Date-based ticket price + sold-out (per park-set, per date, demand-priced) — the real WDW ticket feed

### Working handshake (replayed, returns REAL data, **works cookieless**)

```
# Step 1 — anonymous client token (no login, no cookies)
GET https://disneyworld.disney.go.com/authentication/get-client-token
→ 200 {"access_token":"<jwt>","expires_in":1000}        # ~16.7 min lifetime

# Step 2 — pricing calendar (Authorization: BEARER <token>)
GET https://disneyworld.disney.go.com/api/lexicon-view-assembler-service/wdw/tickets/product-types/theme-parks?storeId=wdw&addOn=false&excludePricingCalendar=false
Authorization: BEARER <access_token>
Accept: application/json
→ 200 (full product + pricing calendar)
```

Verified with `credentials:'omit'`: token 200 and pricing 200 with `pricingCalendar` present — **no browser session cookies required**. Without the bearer header the pricing endpoint returns `401 {"errors":[{"typeId":"UNAUTHORIZED","message":"Authorization header missing"}]}`. So the gate is the bearer token, NOT Akamai sensor cookies.

Product slugs (from `product-listing?storeId=wdw`): `theme-parks` (standard date-based — the demand-priced one), `special-summer-ticket`, `four-park-magic-ticket-offer`, `after-2pm-ticket-offer`. (Fixed-price products like FL-resident use `api/wdw/tickets/product-types/{slug}`; the standard demand-priced calendar lives under the `lexicon-view-assembler-service` path.)

### Response schema (captured)

```
{
  storeId, bookingContextId, destinationId, discountGroup, ticketDays,
  soldOut, hasBlockoutDates, blockoutDates[], themeParks[{facilityId,name,sortOrder,imageURL}],
  pricingCalendar: {
    pricingCalendar: [                       # 10 buckets, one per numDays (1..10)
      { numDays: "1",
        dates: [                             # ~514 dates (~16 months out)
          { date: "2026-06-05",
            pricing: [                       # per ageGroup
              { id, ageGroup:"adult"|"child",
                pricePerDay:"169.00", subtotal, tax, commission,
                taxInclusiveIndicator, validityStartDate, validityEndDate,
                stopSale:false, priceFromDPE:true }
            ] } ] } ] } }
```

Captured 1-day adult series (demand variation, USD): 06-05=169, 06-09=164, 06-13=174, 07-07=159, 07-15=159 …

### Schema → `product_price_obs`

- `(park="WDW-anypark", date, tier="ticket_{numDays}day_{ageGroup}", price_cents = pricePerDay*100, sold_out = stopSale)`.
- WDW date-based tickets are park-set-wide (not per individual park), so treat `park` as resort-level WDW or per chosen-park add-on. Per-park "Park Hopper" vs single-park is a product feature, not a price-calendar dimension.
- Top-level `soldOut` and `blockoutDates[]` feed `ticket_availability` too.

### Operational

- Token TTL 1000s — mint once, reuse <16 min, then re-mint. One pricing call returns the entire ~16-month × 10-day-bucket matrix, so 1–2 calls/day is plenty.
- No login. No cookies. Lowest-risk gated feed found in this whole investigation.

---

## D3. Lightning Lane Multi Pass / Genie+ daily bundle price (per park, per date) — HARDER

### Status: NOT reproduced cleanly. Requires authenticated My Disney Experience (MDE) context.

- ThemeParks.wiki carries LL **Single** per-ride price + LL availability/sell-out, but NOT the LL **Multi Pass** daily _bundle_ price.
- The LL Multi Pass daily price is demand-priced per park and exposed only inside the 21-day booking window, via the **MDE app/web API** (WDPRO auth, behind Akamai). Competitors (Thrill Data, AllEars, WDWMagic) source it from the MDE app API — Thrill Data states pricing comes "directly from the My Disney Experience app's API."
- I did not find a public/anonymous endpoint for it in the ticket-purchase surface (that surface is admission tickets only; LL Multi is a separate in-app product).

### Recommendation

- Treat as an **authenticated, per-user-session** feed: the production scraper logs into a real MDE account (the platform's own account, or user-supplied) inside Browserless Chromium, opens the LL Multi Pass purchase/tip-board screen, and harvests the price via in-page fetch/XHR intercept (same technique used for D2/Universal here).
- Do NOT use leaked app client secrets. If a central account is used, accept ToS risk knowingly or design per-user-session (user supplies own login). **UNVERIFIED**: exact MDE endpoint/headers — needs a logged-in capture session to pin down.
- Confidence Medium on source (MDE API), Low on a clean unauthenticated path (likely none exists).

---

# UNIVERSAL (Universal Orlando — USF, IOA, Epic Universe, Volcano Bay)

Front end: `www.universalorlando.com/web-store` (Angular SPA). Data host: `api.universalparks.com` (IBM WebSphere Commerce / "ICE", storeId **10101**). Bot protection observed on the www host: **Akamai** (go-mpulse.net mPulse + an obfuscated Akamai Bot-Manager sensor path) plus a **Queue-It** virtual waiting room — _not_ PerimeterX as commonly assumed. (Which shield sits in front of `api.universalparks.com` specifically is UNVERIFIED.)

## Shared gated handshake (all Universal feeds)

Every priced call to `api.universalparks.com` carries these headers (captured from the live SPA via fetch/XHR interceptor):

```
X-UNIWebService-ApiKey        # static public web key (in app JS / app-config)
X-UNIWebService-AppVersion
X-UNIWebService-Device
X-UNIWebService-Platform
X-IBM-Client-ID               # static public client id
Authorization: Bearer <jwt>   # from guest authN
WCToken / WCTrustedToken      # WebSphere Commerce guest session
Content-Type / Accept
```

These are the **web client's anonymous-guest** credentials (minted via `GET api.universalparks.com/guest/GuestProfiles/commerce/authN`), NOT the leaked mobile-app secret. The Express flow worked with no Universal login. A bare in-page `fetch` to `api.universalparks.com` **fails CORS** without these headers (confirmed) — so the request must carry them.

Server-side reproduction = replicate the web handshake: (1) load static apikey + client-id (from app-config), (2) guest `authN` → WCToken/WCTrustedToken + bearer, (3) call the data endpoints with the full header set. This is the legitimate web path; no leaked secrets.

## U1. Express Pass per-date price + availability + INVENTORY (headline) — CAPTURED

### Working requests

```
GET  api.universalparks.com/cp/personalization/gettickets        # catalog (today's price only)
POST api.universalparks.com/.../priceAndInventory/v2             # full per-date calendar (fires on "Select")
```

(both with the shared header set)

`gettickets` → `{statusCode, result.page.cards[].groups[].items[]}`, each item:

```
{ name, partNumber, buyable, startDate, endDate,
  pricingAndInventory: { listPrice, currency, isVariablePriced:true,
    offerPricesAndInventory: { "2026-06-05 00:00:01": {offerPrice, isAvailable, isInventoryControlled, inventoryEvents[]} } } }
```

`priceAndInventory/v2` → `{messages, eventAvailability}`, the per-date calendar (≈2-month window per call, 57 dates 06-05…07-31 captured):

```
eventAvailability: {
  "AO-UEP_UU_USF": {
    "2026-06-14": {
      pricing: [ { amount:259.99, quantity:1, currency:"USD" } ],
      inventoryEvents: [ { eventId:"1343868", availableUnits:"15", totalCapacity:"15",
                           available:"1", resourceId:"1561", eventName:"1 Day Studios Express Unlimited VP",
                           startDate, endDate, ada:false } ],
      paymentPlans: []
    }, … } } }
```

### Captured demand series (USF Express Unlimited, `AO-UEP_UU_USF`)

06-05=$259.99, 06-19=$239.99, 07-03=$279.99, 07-17=$249.99, 07-31=$259.99 (listPrice/"from" 159.99).

### Inventory finding

Contrary to the common "Universal stopped emitting quantity" claim, the web-store `priceAndInventory/v2` **still returns `availableUnits` / `totalCapacity` per date** (observed 15 — possibly a display cap; **verify** whether it's true remaining inventory) and an `available` flag (`"0"` = sold out).

### Product → park map (partNumber encodes park)

| partNumber         | product                     | from$  | park          |
| ------------------ | --------------------------- | ------ | ------------- |
| AO-UEP_UU_USF      | USF Express Unlimited       | 159.99 | USF           |
| AO-UEP_01U_USF     | USF Express                 | 119.99 | USF           |
| AO-UEP_UU_UIOA     | IOA Express Unlimited       | 169.99 | IOA           |
| AO-UEP_01U_UIOA    | IOA Express                 | 129.99 | IOA           |
| AO-UEP_01U_PV_UVB  | Volcano Bay Express Plus    | 59.99  | Volcano Bay   |
| AO-UEP_01U_SV_UVB  | Volcano Bay Express         | 29.99  | Volcano Bay   |
| AO-UEP_1D_01U_EPIC | Epic Universe 1-Day Express | 199.99 | Epic Universe |

Park codes: `USF`, `UIOA`, `UVB`, `EPIC`.

### Schema → `product_price_obs`

`(park=<code>, date, tier=<partNumber>, price_cents=amount*100, sold_out = available=="0"||availableUnits=="0")`. Optionally store `available_units`/`total_capacity` for an inventory series.

## U2. Date-based admission ticket price — same API

The "Park Tickets" step of the same web-store uses the **same** `gettickets` + `priceAndInventory/v2` endpoints and header set. Captured the ticket catalog: park selector (USF/IOA/Epic/Volcano Bay), Days Visiting (1–7 / Annual), One-Park-vs-Multi-Park toggle, FL-resident toggle, **Adult (10+) / Child (3-9)** price tiers, "Starting From $…", and the disclaimer "Prices may vary by day… lowest prices available on select dates only" — i.e. identical per-date demand model.

- The per-date calendar schema is the one verified in U1 (Express): `eventAvailability[partNumber][date].pricing[]` (ticket pricing entries are dimensioned by age tier).
- **Caveat:** the specific ticket `priceAndInventory/v2` call was not separately replayed because the multi-day promo bundle's "Select" stayed disabled (needs date/options selection). Confidence High by architectural identity; flagged for a confirming capture.

## U3. Virtual Line

- Largely **dormant in 2026** (no standby-replacement VL at USF/IOA; Epic Universe used it briefly then dropped). When active, VL state lives behind the **authenticated official-app OIDC API** (`api.universalparks.com`, account login). Unauthenticated `assets.universalparks.com/{region}/wait-time/wait-time-attraction-list.json` exposes ride status/wait times (and could surface a VL flag) without auth — but VL _booking_ state needs the app session.
- Recommendation: rely on ThemeParks.wiki for waits/VL state where it carries them; treat live VL booking availability as authenticated/per-user, low priority given 2026 dormancy. Confidence Medium.

---

# Stretch — Dining availability

## Disney

- Endpoint family exists: `disneyworld.disney.go.com/finder/api/v1/explorer-service/dining-availability-details/{facilityId}?searchDate=…&partySize=…&mealPeriod=…`.
- Probed with the **anonymous client token** (D2 handshake): returned **405** (wrong method/path) — crucially **not 401/403**, i.e. the anonymous bearer was _accepted_. Strong signal that dining-availability search is reachable with the same `get-client-token` → bearer pattern as ticket pricing, once the exact method (likely POST) + payload are captured from the dining-finder flow. **Not yet reproduced — UNVERIFIED.**
- Booking (vs. search) requires a logged-in MDE session. Competitors (MouseDining, Park Prodigy, Mouse Hour) poll the dining-availability search endpoint on a schedule; booking is per-user.
- → `dining_obs`: `(restaurant_facilityId, date, mealPeriod, partySize, available_times[] / available:bool)`. Next step: capture one working request from `/dining-reservations/` finder.

## Universal

- Dining is largely walk-up / OpenTable-backed for table service; priority dining at select venues runs through the same web-store/WCS commerce surface or OpenTable. Not investigated in depth. **UNVERIFIED**; lower value than Disney dining.

# Bot protection & datacenter-IP / proxy question (the production blocker)

### What was tested

- **Disney JSON APIs are NOT gated by Akamai sensor cookies.** `get-client-token` and the pricing calendar both returned 200 from the browser with `credentials:'omit'` (zero cookies). The gate is the bearer token only. Akamai protects the HTML pages/sensor, not these data endpoints (from a residential IP).
- **Universal data APIs ARE gated by a guest session** (WCToken/bearer/apikey), obtained via `authN`. CORS blocks header-less calls.

### What was NOT tested (the real unknown)

Whether a **Railway datacenter IP** is blocked by Akamai _edge IP-reputation_ even with correct tokens. I tested from a residential IP only. Industry evidence is strong that Akamai (and PerimeterX/HUMAN) independently down-score datacenter ranges regardless of cookie/token validity, and that residential/mobile proxies are the standard mitigation — but this is **UNVERIFIED for these specific hosts from a datacenter IP**.

### Recommended validation + fallback

1. First deploy: run both handshakes from Railway with a **plain HTTPS client** (Disney) / **headless Chromium** (Universal) on the datacenter IP. Disney's cookieless API may well work directly.
2. If Akamai 403/challenge appears on the datacenter IP: route through **Browserless v2 `/unblock` + residential proxy** (Browserless supports residential proxy + BrowserQL stealth). Use the real Chromium context to mint tokens/guest session, then optionally hand cookies/tokens to a lightweight client.
3. Cache lifetimes: Disney client token `expires_in=1000s` (~16 min). Universal guest session — **UNVERIFIED**, capture from `authN` response; treat as short-lived, re-mint per run.

---

# Competitor sourcing (with evidence)

- **Thrill Data** — "We pull data directly from theme park applications." LL Multi price "directly from the My Disney Experience app's API." Universal Express + tickets "pulled directly from Universal and updated every few minutes"; notes Universal "ended outputting specific Express/VIP quantity data" (so they keep price+availability). → matches what we captured: Disney via MDE/web APIs, Universal via the web-store `gettickets`/`priceAndInventory` surface.
- **TouringPlans** — wait times + crowd calendar from user-app submissions + staff observers + MDE; publishes historical CSV datasets; no public pricing API.
- **Queue-Times.com** — free real-time _wait_ API (attribution required); no pricing.
- **ThemeParks.wiki / parksapi** — aggregator; ships no secrets, user must supply Universal/Disney creds; waits/schedules/entities only, no ticket/Express pricing.
- **Mouse Hour / Park Genie** — sourcing not corroborated (UNVERIFIED).

# Legal / ToS / risk

- Disney D1/D2 and Universal U1/U2 use **public/anonymous web endpoints with no credentials of any user** — lowest risk, but still subject to each resort's ToS on automated access; keep volume to true daily cadence.
- Do **NOT** use leaked/hardcoded mobile-app client secrets (Universal OIDC password-grant secret circulating on GitHub) — ToS-violating and rotatable.
- Disney D3 (LL Multi) and Universal U3 (VL) need authenticated sessions: prefer a **per-user-session** design (user supplies own login) over a central scraping account.

# Recommendations (ranked, per feed)

1. **WDW ticket availability (D1)** — plain server HTTP GET `availability-calendar/api/calendar`. No browser. Confidence High.
2. **WDW ticket price (D2)** — plain server HTTP: get-client-token → bearer → lexicon pricing calendar. No browser, cookieless. Validate from Railway IP; residential proxy only if Akamai blocks. Confidence High.
3. **Universal Express + tickets (U1/U2)** — headless Chromium (Browserless v2) to run the guest-auth handshake and harvest tokens/WCToken, then call `gettickets`/`priceAndInventory/v2`. Residential proxy likely needed if datacenter IP is challenged. Confidence High.
4. **WDW LL Multi (D3)** — authenticated MDE session in Browserless; per-user-session design. Confidence Medium.
5. **Universal VL (U3)** — low priority (dormant); ThemeParks.wiki + public wait-time JSON. Confidence Medium.
