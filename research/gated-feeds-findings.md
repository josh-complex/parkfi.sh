# Gated theme-park feeds — captured evidence (working notes)

Date captured: 2026-06-05. Browser: logged-in WDW session (Akamai-protected site), in-page fetch.

## DISNEY — Ticket-date availability (park reservation calendar)

- Endpoint: `GET https://disneyworld.disney.go.com/availability-calendar/api/calendar?segment={tickets|passholder|resort}&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- Auth: NONE. Returns `[{}]` for ALL segments/ranges, anonymous AND logged-in (identical).
- **KEY REFRAME of the "dead end":** `[{}]` = "no restrictions = all parks available", NOT a gated/blocked response. Disney retired park-pass reservations for date-based tickets (Jan 2024). The on-page green-dot calendar ("All Parks Available") renders directly from this empty response. When restrictions exist (historic passholder blockouts), the array carries per-date objects.
- Server-reproducible with a plain HTTP client, no sensor cookies. The Akamai headers the user saw are edge-routing, not a data gate here.

## DISNEY — Date-based ticket PRICING + sold-out (the real per-date signal)

- Token: `GET https://disneyworld.disney.go.com/authentication/get-client-token` (credentials optional) -> `{access_token, expires_in}`. ANONYMOUS client token, no login.
- Pricing: `GET https://disneyworld.disney.go.com/api/lexicon-view-assembler-service/wdw/tickets/product-types/theme-parks?storeId=wdw&addOn=false&excludePricingCalendar=false`
  - Header: `Authorization: BEARER <access_token>` (401 "Authorization header missing" without it)
  - Response: `pricingCalendar.pricingCalendar[]` = 10 buckets (numDays 1..10). Each `.dates[]` (~514 days, ~16 months out). Each date: `{date, pricing:[{ageGroup, pricePerDay, subtotal, tax, validityStartDate, validityEndDate, stopSale, priceFromDPE}]}`.
  - Captured 1-day adult series: 2026-06-05=$169, 06-09=$164, 06-13=$174, 07-07=$159 ... (demand-varying).
  - `stopSale: true` = that date sold out for that product.
  - Also top-level `soldOut`, `hasBlockoutDates`, `blockoutDates[]`, `themeParks[{facilityId,name}]` (MK 80007944, AK 80007823, DHS 80007998, EPCOT 80007838).
- Other slugs at same endpoint: `special-summer-ticket`, `four-park-magic-ticket-offer`, `after-2pm-ticket-offer` (via product-listing?storeId=wdw).
- Gating = OAuth bearer (anonymous, mintable server-side), NOT Akamai sensor cookies. Token lifetime = expires_in (verify seconds).

## UNIVERSAL — Express Pass per-date price + availability + INVENTORY (headline feed) — CAPTURED

- Host: `api.universalparks.com` (WebSphere Commerce / "ICE" store, storeId 10101). Site front = www.universalorlando.com (Angular SPA web-store).
- Bot protection: Akamai (go-mpulse.net mPulse + obfuscated Akamai Bot Manager sensor path on www). Queue-It virtual waiting room script also present. NOTE: research assumed PerimeterX; observed evidence = Akamai. (api.universalparks.com may differ; unverified which sits in front of the API host specifically.)
- Two-step web flow, both gated by the SAME headers:
  - `GET api.universalparks.com/cp/personalization/gettickets` -> `{statusCode, result.page.cards[].groups[].items[]}`. Each item: `{name, partNumber, buyable, startDate, endDate, pricingAndInventory:{listPrice, currency, isVariablePriced, offerPricesAndInventory{ "<date 00:00:01>": {offerPrice, isAvailable, isInventoryControlled, inventoryEvents[]} }}}`. Initial call returns only today's date.
  - `POST api.universalparks.com/.../priceAndInventory/v2` (fires when you click "Select" on a product) -> `{messages, eventAvailability{ "<partNumber>": { "YYYY-MM-DD": {pricing:[{amount,quantity,currency}], inventoryEvents:[{eventId, availableUnits, totalCapacity, available, resourceId, eventName, startDate, endDate, ada}], paymentPlans:[]} } }}`. Returns a ~2-month window (57 dates 2026-06-05..07-31) per call.
- REQUIRED HEADERS (captured from live SPA request): `X-UNIWebService-ApiKey`, `X-UNIWebService-AppVersion`, `X-UNIWebService-Device`, `X-UNIWebService-Platform`, `X-IBM-Client-ID`, `Authorization` (Bearer), `WCToken`, `WCTrustedToken`, `Content-Type`, `Accept`. These are the WEB client's guest-session creds (minted via `guest/GuestProfiles/commerce/authN`), NOT the leaked mobile-app secret. A bare credentialed in-page fetch to api.universalparks.com FAILS CORS without these headers.
- Per-date schema -> product_price_obs: amount=price, available=="0"||availableUnits=="0" => SOLD_OUT. INVENTORY EXPOSED: availableUnits/totalCapacity per date (observed 15; may be a display cap — verify). Contradicts the common "Universal removed quantity" claim, at least on the web-store priceAndInventory/v2.
- Captured demand series (USF Express Unlimited AO-UEP_UU_USF): 06-05=$259.99, 06-19=$239.99, 07-03=$279.99, 07-17=$249.99, 07-31=$259.99 (listPrice/"starting" 159.99).
- Express products (partNumber encodes park): USF Express Unlimited AO-UEP_UU_USF ($159.99 from), USF Express AO-UEP_01U_USF ($119.99), IOA Express Unlimited AO-UEP_UU_UIOA ($169.99), IOA Express AO-UEP_01U_UIOA ($129.99), Volcano Bay Express Plus AO-UEP_01U_PV_UVB ($59.99), Volcano Bay Express AO-UEP_01U_SV_UVB ($29.99), Epic Universe 1-Day Express AO-UEP_1D_01U_EPIC ($199.99). Park codes: USF, UIOA, UVB, EPIC.

## TODO

- Universal date-based admission TICKET pricing (same gettickets + priceAndInventory/v2 API, different products — verify)
- Universal authN guest-session minting + token lifetime; datacenter-IP/Akamai test
- Universal virtual line
- Disney LL Multi Pass / Genie+ daily price (research: MDE app API, gated)
- Dining (stretch)
