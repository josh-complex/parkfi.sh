# Universal Orlando — full ticket/Express catalog + pricing API deep dive

> **Status (2026-09-03): superseded.** The WebSphere store this documents was
> replaced in August 2026 by an SAP Commerce storefront at
> `store.universalorlando.com` (Queue-it-gated HTML) whose API is
> `comm-api.universaldestinationsandexperiences.com/occ/v2/uor_b2c`. `gettickets`
> no longer fires from the tickets page (the catalog crawl inserted 0 SKUs from
> 2026-07-29), while `priceAndInventory/v2` still answered for the old Express
> part numbers as late as 2026-09-03. The cron now reads the new store
> cookielessly — `products/search` per category for the catalog and
> `POST products/fetchCalendarDatesWithPriceAndInventory` for per-date price +
> sell-out, keyed by the store's numeric variant codes with dimensions decoded
> from the product code (`src/server/parks/universal-occ.ts`,
> `sources/universal-occ.ts`). Day tickets are date-priced in the new store;
> nothing carries unit counts. Everything below is the retired store, kept as
> the record of the `TPA-…`/`AO-UEP_…` part-number taxonomy still present on
> deactivated `product_dim` rows.

Captured 2026-06-05 by replaying the live web-store session (Claude-in-Chrome). Every endpoint/body below was **replayed and returned real data**. This supersedes the "verify" caveats in `gated-feeds-report.md` §U1/U2.

## 0. The two endpoints (both CORS-open: `Access-Control-Allow-Origin: *`, `Allow-Credentials: true`)

### A. Catalog — `POST https://api.universalparks.com/cp/personalization/gettickets`

Personalization endpoint. Returns the product cards for a given filter state. Body (real, captured):

```json
{
  "externalGuestId": "<guest-uuid>",
  "sessionId": "<guest-uuid>",
  "cards": "Tickets_MDVP_SC_Web~DAYS.3~PARK_NUM.3~POO.Outer%20US",
  "catalogId": "20004",
  "ic": "UO website",
  "geoLocation": "OUS", // "OUS" = Outer US (standard); "FL" = Florida
  "ticketsPageNumberOfDays": "3", // 1..7, or "Yes"/"365" for annual context
  "ticketsPageFloridaResidentFlag": "N", // "N" | "Y"
  "skipInventory": true,
  "dates": [],
  "firstTimeVisitor": "Y"
}
```

Response: `result.page.cards[].groups[].items[]`, each item:

```
{ name, partNumber, buyable, startDate, endDate,
  pricingAndInventory: { listPrice, currency, isVariablePriced, offerPricesAndInventory{...} } }
```

**Filtering is server-side** by `ticketsPageNumberOfDays` + `PARK_NUM` + `POO`. The page's day/park/FL toggles just drive these. The standard vs FL catalogs are DIFFERENT SKU sets — FL requires `geoLocation:"FL"` AND `cards:"...POO.Florida"` (the `ticketsPageFloridaResidentFlag` alone does nothing).

**Crawl recipe (deterministic, ~64 calls):** for `days ∈ {1,2,3,4,5,6,7,365}` × `PARK_NUM ∈ {1,2,3,4}` × `POO ∈ {Outer US (OUS), Florida (FL)}`, POST and union `items[].partNumber`. Most (days,park) cells are empty; the union = full catalog. Catalog changes rarely → crawl weekly.

### B. Price + availability + inventory — `POST .../shop/wcs/resources/store/10101/event/priceAndInventory/v2`

Body (real, captured):

```json
{
  "contractId": "4000000000000000003",
  "currency": "USD",
  "events": [
    {
      "partNumber": "TPA-01D_BSE_EPIC_AD_ABP",
      "startDate": "2026-06-05 00:00:01",
      "endDate": "2027-06-05 23:59:59",
      "quantity": 1
    }
  ]
}
```

- **No server-side window cap.** A 1-year window (2026-06-05→2027-06-05) returned **all 366 dates in one call** (Epic 1-Day adult $139–$209). The UI's "infinite scroll month-by-month" is cosmetic — we set any window we want. → 1 call per SKU per day for a full year of per-date pricing.
- Batch: `events[]` accepts multiple partNumbers per call (the page sends adult+child together).
- Same `contractId` (`4000000000000000003`) prices both standard and FL SKUs (residency is encoded in the partNumber `_FL_`, not the contract).
  Response:

```
eventAvailability: { "<partNumber>": { "YYYY-MM-DD": {
    pricing: [ { amount, quantity, currency } ],
    inventoryEvents: [ { availableUnits, totalCapacity, available, eventId, resourceId,
                         eventName, startDate, endDate, ada } ],
    paymentPlans: [] } } }
```

- Price → `pricing[0].amount`. Sold-out → `available=="0"` (or `availableUnits=="0"`).
- `availableUnits`/`totalCapacity` observed = constant **15** across all dates → treat as a display cap / soft signal, NOT true remaining inventory (do not over-trust as a sellout predictor; the `available` boolean is the reliable signal).

### Auth headers (both endpoints) — from the anonymous web guest session

`WCToken`, `WCTrustedToken`, `X-UNIWebService-ApiKey`, `X-UNIWebService-AppVersion`, `X-UNIWebService-Device`, `X-UNIWebService-Platform`, `X-IBM-Client-ID`, `Authorization: Bearer <jwt>`, `Content-Type: application/json`, `Accept`.
Minted via `GET api.universalparks.com/guest/GuestProfiles/commerce/authN` on page load (no user login — anonymous guest). The apikey + client-id are static public web keys. **No leaked mobile-app secret involved.** Production: drive a headless Chromium once per session to harvest WCToken+bearer, then replay both endpoints directly (CORS-open, so even a plain server client works with the headers). Token lifetime UNVERIFIED — re-mint per run.

## 1. partNumber taxonomy (decoded from 88 ticket SKUs)

```
TPA-{DUR}_{TYPE}_{PARKSCOPE}[_{ADDON}]_{AGE}[_GA]_{CONTRACT}[_FL][_{VARIANT}]
```

| Field         | Codes                 | Meaning                                                                                                                                         |
| ------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| DUR           | 01D–07D               | day tickets (per-date variable price); **12M** = 12-month annual (flat price)                                                                   |
| TYPE (day)    | BSE / PTP / UVB       | Base = one park per day; Park-to-Park = hop multiple parks/day; UVB = Volcano Bay water park only                                               |
| TYPE (annual) | PWR / SEA / PRF / PRM | Power < Seasonal < Preferred < Premier pass tiers                                                                                               |
| PARKSCOPE     | 1P/2P/3P/4P, EPIC     | # parks. 2P=USF+IOA, 3P=USF+IOA+Epic, 4P=+Volcano Bay. EPIC=Epic-only 1-park                                                                    |
| ADDON         | 1DEPIC                | base USF/IOA ticket + a 1-Day Epic Universe add-on                                                                                              |
| AGE           | AD / CH               | Adult (10+) / Child (3–9)                                                                                                                       |
| residency     | \_FL                  | Florida Resident SKU (separate product + lower price). absent = standard/non-resident                                                           |
| CONTRACT      | ABP / AP              | ABP = admission base product; AP = annual pass                                                                                                  |
| VARIANT       | NEW, PM, DAY, SS      | PM = promo ("2 Days Free"/"2nd Day Free"); SS on 3–7-day = the true multi-day season product; NEW = current-season SKU; DAY = dated day product |

Park codes also appear in `priceAndInventory` `eventName`/partNumber: **EPIC** (Epic Universe), **USF**, **UIOA** (Islands of Adventure), **UVB** (Volcano Bay).

## 2. Full catalog (88 ticket SKUs = 54 standard + 34 FL; + 7 Express = 95)

### Standard day tickets (variable per-date price; "list" = from-price anchor)

```
TPA-01D_BSE_EPIC_AD/CH_ABP            1-Day Epic Universe                A$139 C$134
TPA-01D_BSE_2P_AD/CH_GA_ABP          1-Day Base (one park: USF or IOA)   A$124 C$119
TPA-01D_PTP_2P_AD/CH_GA_ABP          1-Day Park-to-Park (USF+IOA)        A$179 C$174
TPA-01D_UVB_1P_AD/CH_GA_ABP_DAY      1-Day Volcano Bay                   A$80  C$75
TPA-01D_BSE_2P_1DEPIC_AD/CH_ABP_NEW  1-Day USF/IOA Base + 1-Day Epic     A$256.99 C$246.99
TPA-01D_PTP_2P_1DEPIC_AD/CH_ABP_NEW  1-Day USF/IOA P2P + 1-Day Epic      A$316.99 C$306.99
TPA-02D_BSE_2P_AD/CH_GA_ABP_NEW      2-Day Base                          A$241.99 C$231.99
TPA-02D_PTP_2P_AD/CH_GA_ABP_NEW      2-Day Park-to-Park                  A$301.99 C$291.99
TPA-03D_BSE_3P_SS_AD/CH_GA_ABP_NEW   3-Day Base (3 parks incl Epic)      A$309.99 C$299.99
TPA-03D_PTP_3P_SS_AD/CH_GA_ABP_NEW   3-Day Park-to-Park                  A$369.99 C$359.99
TPA-03D_PTP_4P_SS_AD/CH_GA_ABP_NEW   3-Day P2P + Volcano Bay             A$409.99 C$399.99
TPA-04D_PTP_3P/4P_SS_AD/CH_GA_ABP_NEW 4-Day P2P (±Volcano Bay)           A$384.99/$434.99
TPA-05D_PTP_3P/4P_SS_AD/CH_GA_ABP_NEW 5-Day P2P (±Volcano Bay)           A$399.99/$459.99
TPA-05D_BSE/PTP_3P/4P_..._PM_NEW     "3-Day + 2 Days Free" promo (5D SKU priced as 3D)  A$299.99–$409.99
TPA-06D_PTP_3P/4P_SS_AD/CH_GA_ABP    6-Day P2P (±Volcano Bay)            A$414.99/$474.99
TPA-07D_PTP_3P/4P_SS_AD/CH_GA_ABP    7-Day P2P (±Volcano Bay)            A$429.99/$489.99
```

### Standard annual passes (flat price; 10 SKUs)

```
TPA-12M_PWR_2P_AD/CH_AP   2-Park Power     $474.99
TPA-12M_SEA_2P_AD/CH_AP   2-Park Seasonal  $424.99
TPA-12M_SEA_3P_AD/CH_AP   3-Park Seasonal  $474.99
TPA-12M_PRF_2P_AD/CH_AP   2-Park Preferred $629.99
TPA-12M_PRM_2P_AD/CH_AP   2-Park Premier   $904.99
```

### Florida Resident — day tickets (24 SKUs, `_FL`, lower price)

```
TPA-01D_BSE_2P_AD/CH_FL_ABP          1-Day Base FL            A$99  C$94   (std $124/$119)
TPA-01D_BSE_EPIC_AD/CH_FL_ABP        1-Day Epic FL            A$139 C$134  (= std)
TPA-01D_PTP_2P_AD/CH_FL_ABP          1-Day P2P FL             A$144 C$139  (std $179/$174)
TPA-01D_UVB_1P_AD/CH_GA_ABP_FL_DAY   1-Day Volcano Bay FL     A$70  C$65   (std $80/$75)
TPA-02D_PTP_2P_AD/CH_FL_ABP_PM       FL 1-Day P2P + 2nd Free  A$144 C$139
TPA-03D_BSE/PTP_3P/4P_SS_AD/CH_FL_ABP_NEW  3-Day FL          A$199.99–$279.99
   (+ 01D/02D BSE & PTP, +1DEPIC FL combos)
```

### Florida Resident — annual passes (10 SKUs, `_FL`, cheaper than non-resident)

```
TPA-12M_PWR_2P_AD/CH_AP_FL  Power FL      $374.99  (std $474.99)
TPA-12M_SEA_2P_AD/CH_AP_FL  Seasonal FL   $324.99  (std $424.99)
TPA-12M_SEA_3P_AD/CH_AP_FL  3-Park Seas FL $374.99 (std $474.99)
TPA-12M_PRF_2P_AD/CH_AP_FL  Preferred FL  $529.99  (std $629.99)
TPA-12M_PRM_2P_AD/CH_AP_FL  Premier FL    $789.99  (std $904.99)
```

### Express Pass (7 SKUs, `AO-UEP_*`, variable per-date — see gated-feeds-report §U1)

```
AO-UEP_UU_USF (USF Unltd $159.99+), AO-UEP_01U_USF (USF $119.99+),
AO-UEP_UU_UIOA (IOA Unltd $169.99+), AO-UEP_01U_UIOA (IOA $129.99+),
AO-UEP_01U_PV_UVB (VB Plus $59.99+), AO-UEP_01U_SV_UVB (VB $29.99+),
AO-UEP_1D_01U_EPIC (Epic $199.99+)
```

## 3. Pricing behavior observed

- **Day tickets & Express = demand-priced per date** (`isVariablePriced:true`). Epic 1-Day adult ranged $139 (low) → $209 (peak) over 12 months; July 4 was the local peak; Sept dropped to $80 for Volcano Bay. This is the headline series.
- **Annual passes = flat** (not date-variable) → poll weekly, store one price.
- **Promo SKUs** ("2 Days Free", "2nd Day Free") are real distinct partNumbers (`_PM`) — a longer-duration product sold at a shorter-duration price. Track them as their own SKU; the discount is intrinsic, not a per-date thing.
- FL day tickets are ~15–25% below standard; FL annuals ~$100 below non-resident.

## 4. Domain modeling (drop-in for parkfi)

### `product_dim` (new dimension table — populate from gettickets crawl, weekly)

| column           | source                        | example                                   |
| ---------------- | ----------------------------- | ----------------------------------------- |
| product_id       | partNumber                    | `TPA-01D_PTP_2P_AD_GA_ABP`                |
| resort           | const                         | `UOR`                                     |
| family           | DUR/CONTRACT                  | `TICKET` / `ANNUAL` / `EXPRESS`           |
| duration_days    | DUR (01D→1 … 07D→7, 12M→null) | 1                                         |
| park_scope       | PARKSCOPE+name                | `{USF,IOA}` / `{USF,IOA,EPIC}` / `{UVB}`  |
| park_to_park     | TYPE=PTP                      | true                                      |
| age_group        | AGE                           | `ADULT`/`CHILD`                           |
| residency        | `_FL` present                 | `FL` / `STD`                              |
| pass_tier        | annual TYPE                   | `POWER/SEASONAL/PREFERRED/PREMIER` / null |
| variable_priced  | isVariablePriced              | true                                      |
| list_price_cents | gettickets listPrice          | 17900                                     |

### `product_price_obs` (daily, from priceAndInventory/v2)

`(product_id=partNumber, park_scope, date, price_cents=amount*100, currency, available (bool from `available`), available_units (soft), total_capacity (soft), observed_at)`

- Pull a forward window (e.g. today → +395 days) per variable-priced SKU in ONE call. Annuals/promos: store flat price weekly.
- For Express tiers, product*id=`AO-UEP*\*` slots straight in (tier dimension = partNumber).

### `ticket_availability` (per park/date state — derive, don't trust units)

Universal availability is per (SKU, date), not per park. Derive park/date state as: for each park, AVAILABLE if any admission SKU covering that park has `available=="1"` on that date; SOLD_OUT only if all do `=="0"`. Given `availableUnits` is a constant 15, do **not** map it to LIMITED — only use the boolean. (Universal rarely sells out dated tickets; sellouts are mostly Express + special events.)

### Crawl cadence / volume (low)

- gettickets catalog crawl: ~64 calls, **weekly** (catalog is stable).
- priceAndInventory: 1 call/variable-SKU/day with a full-year window; ~30 variable day-ticket SKUs + 7 Express ≈ <50 calls/day. Trivial volume. Batch adult+child in one `events[]` to halve it.

## 5. Risk / ToS

Anonymous public web endpoints, no user credentials, no leaked secrets. CORS-open so a server client works with harvested guest headers. Akamai + Queue-It front the www host; `api.universalparks.com` served the replays fine from a residential browser IP — **datacenter-IP behavior still UNVERIFIED** (test from Railway; residential proxy via Browserless `/unblock` is the fallback). Keep to daily cadence; honor any Queue-It waiting room.
