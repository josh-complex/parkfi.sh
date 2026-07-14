# Stay22 — resort booking exit & affiliate monetization

> **Theme:** parkfi already tracks Disney resort availability + price and alerts on
> it. What it can't do is let a high-intent user _book_, or earn a cent when they
> do. Disney doesn't wholesale its resorts and booking-on-behalf is a legal
> rathole — but **Stay22's Direct Travel API carries Disney-owned resort inventory
> (via Expedia/Hotels.com) with live rates and a per-supplier affiliate link.**
> This plan bolts that on as a monetized booking exit **without touching the
> tracking data moat we already own.**

This is the decision doc. Feasibility grounding is the conversation that produced
it (2026-07-12) and the `stays-data-resort-level-only` /
`mde-onbehalf-integration-feasibility` memories. Related plan:
[`../stays-caching-and-alerts.md`](../stays-caching-and-alerts.md) (the tracking
stack this sits on top of).

---

## TL;DR — the decision

Ship in tiers, cheapest-first. **v0 + v1 are the plan; v2 is a fast follow; v3 is
optional.**

0. **v0 — Coverage map** _(do first, ~1 day)_. One-off sweep of Stay22's Direct
   Travel API against `resort-catalog.generated.ts` to learn _exactly_ which of our
   35 catalog resorts are monetizable vs. handoff-only. Decides everything below.
1. **v1 — Live-rate booking exit** _(build now)_. On the resort detail/board, call
   Stay22 on demand at the moment of booking intent, show the best live supplier
   rate, and hand off via the affiliate `link`. Earn commission. **Persist
   nothing.**
2. **v2 — Attribution & reporting** _(fast follow)_. Pull the Stay22 Hub Data
   Reporting API for clicks/bookings/earnings; wire a `stay_click` record for our
   own funnel analytics; surface "booked via parkfi" in the account area.
3. **v3 — Direct-affiliate escalation** _(optional, gated on volume)_. Once volume
   justifies it, negotiate Stay22's split up, or go direct-affiliate with Expedia
   (EPS) / Booking.com to keep the full commission. Build-vs-buy; only when the
   numbers say so.

**The one inviolable rule:** Stay22 data is **display-and-handoff only**. It may
**never** be written to `stay_obs` or any table, and never fed to the price-history
/ alert engine. That would violate Stay22's API terms _and_ poison our
independently-sourced data moat. See [The hard boundary](#the-hard-boundary).

---

## What we proved live (2026-07-12)

All verified against the Stay22 Direct Travel API demo endpoint (no auth, 5
req/min) — `GET https://api.stay22.com/v2/accommodations`:

- **Disney-owned resorts are really in the inventory.** A geo search around WDW
  (`lat=28.3852&lng=-81.5639`) returned **9 Disney-owned resorts** with live 3-night
  rates: Contemporary, Polynesian, Wilderness Lodge, Beach Club, Yacht Club,
  BoardWalk Inn + Villas, Coronado Springs, Boulder Ridge Villas. ✅
- **The supplier is always Expedia / Hotels.com — never Booking.com.** Exactly as
  predicted: Booking's Disney-owned inventory is absent; the Expedia/Hotels.com legs
  carry it. **We don't need a Booking relationship for the Disney piece.**
- **The response shape is a gift.** One object per property with a `suppliers` map
  → each supplier carries `{ id, link, price.total }`. The `link` _is_ the affiliate
  link; `price.total` is a live, real OTA rate (no bedbank markup — this is why it
  beats Nuitée on price). Search by `address`, `lat/lng+radius`, or `hotelids`.
- **Coverage is partial.** Deluxes + DVC villas are well-represented; **value
  resorts and some moderates did not appear** in the sample. Consistent with the
  known "limited third-party allocation" reality of Disney room-only OTA inventory.
  v0 exists to quantify this precisely.
- **The blocker is contractual, not technical.** The API terms forbid cold-storing
  listings or using the data for analysis (cache ≤ 60 min KV). This is the whole
  reason for [the hard boundary](#the-hard-boundary).

---

## Why this shape (the two-brain architecture)

parkfi already runs a **tracking brain**: the Disney _public_ resort-availability
proxy ([`src/server/stays/availability.ts`](../../src/server/stays/availability.ts))
sweeps into `stay_obs`, powers price history + "good time to book?" trends, and
fires `stay_alert`s. That endpoint is cookieless and has **no storage restriction**
— it's our data moat and system of record.

Stay22 is a **booking muscle**, not a second brain. It answers exactly one question
— "right now, what's the cheapest real rate and where do I send the user to book?"
— at the instant of intent, then forgets. The two never share data:

```
                          ┌─────────────────────────────────────────────┐
   TRACKING BRAIN         │  Disney public availability API (no ToS      │
   (system of record) ◄───┤  storage limit) → stay_obs → history/alerts  │
                          └─────────────────────────────────────────────┘
                                          (unchanged; the moat)

                          ┌─────────────────────────────────────────────┐
   BOOKING MUSCLE         │  Stay22 Direct Travel API (display+handoff   │
   (ephemeral) ──────────►│  ONLY, cache ≤60min) → best supplier link    │
                          └─────────────────────────────────────────────┘
        called on demand at booking-intent; persist nothing
```

This separation is what makes Stay22 usable at all: its data can't touch the parts
of parkfi that need persistence, so we only ever use it where ephemeral is fine.

---

## The hard boundary

**Non-negotiable, enforced in code and review:**

1. **No Stay22 field is ever written to a durable store.** Not `stay_obs`, not a new
   table, not a log we query later. Response caching, if any, is a short-TTL
   in-memory / Redis KV (≤ 60 min) keyed by request — never a row we analyze.
2. **`stay_obs` continues to come only from the Disney public API.** Price history,
   charts (`resort-price-chart.tsx`), and alerts read exclusively our own
   observations. Stay22 prices are display-only and may differ from `stay_obs`
   (different source, room-only, room-type opaque) — **never reconcile or blend
   them**; label the Stay22 number as a live third-party rate.
3. **All Stay22 calls are server-side** (like the existing availability proxy) to
   keep the API key server-only, sidestep CORS, and centralize the TTL cache.

A single fetch helper (`src/server/stays/stay22.ts`) is the _only_ code that talks
to Stay22, so the boundary is auditable in one file.

---

## Legal / ToS posture

- **Clean.** This is affiliate routing — the user completes the booking on
  Expedia/Hotels.com in their own session, with their own card. parkfi never holds
  credentials, never transacts, never books on-behalf. None of the
  `mde-onbehalf-integration-feasibility` red lines are touched.
- **Room-only.** Third-party Disney inventory is strictly room-only — no dining
  plans, tickets, or packages. Frame the exit as "book the room"; the rest of the
  trip stays in Disney's own flow. (Matches `stays-data-resort-level-only`.)
- **Disclosure.** Affiliate links require an FTC-style disclosure ("we may earn a
  commission"). Add it near the CTA and in a footer/affiliate-disclosure page.
- **Respect Stay22's terms** verbatim: the no-store clause above, the 60-min cache
  ceiling, and rate limits. Violating them risks losing the account (and the
  commission).

---

## v0 — Coverage map (do first)

**Goal:** a static answer to "which of our 35 resorts can Stay22 actually book?"

**How:** a one-off script (`scripts/stay22-coverage.ts`, run manually, **not** a
cron, **not** persisted to the DB) that, respecting the 5 req/min demo limit (or an
API key if we have one):

1. For a couple of representative (dates, party) tuples, sweep WDW by `lat/lng +
radius` with pagination (165 total properties observed; page through all).
2. Match returned property `name`s against `RESORT_CATALOG` (name-normalize; the
   Disney-owned ones are unambiguous — `Disney's …`). Also probe `hotelids` direct
   lookup if we can recover Stay22 ids for our catalog.
3. Emit a table: catalog resort → { in Stay22? which suppliers? sample rate } →
   classify each as **bookable** (has a supplier) vs **handoff-only** (Disney
   direct only).

**Output:** commit the resulting classification as a plain markdown/JSON artifact
in this folder (`coverage.md`) — _that's_ allowed (it's our derived analysis, run
once, not the live listing cache the ToS forbids; keep it coarse — resort-level
yes/no + which supplier, no stored prices). It drives v1's per-resort UX (show a
"Book" button only where bookable).

**Decision gate:** if coverage is mostly deluxe/villa and values/moderates are
absent, v1 still ships (deluxes are the high-AOV bookings anyway) but the UI must
gracefully fall back to the Disney deep-link/detail handoff for uncovered resorts.

---

## v1 — Live-rate booking exit (build now)

**What:** on the resort detail view (`resort-detail.tsx`) and optionally the board
row (`stays-board.tsx`), when a user is looking at a resort for specific dates, show
the best live Stay22 supplier rate + a "Book on Expedia" CTA that opens the
affiliate `link`. For uncovered resorts, fall back to the existing Disney detail
URL.

**How:**

- **Server helper** `src/server/stays/stay22.ts`: one function
  `fetchStay22Offer({ resort, checkin, checkout, adults, children })` →
  `{ bestSupplier, price, affiliateLink } | null`. Calls the Direct Travel API
  (prefer `hotelids` if we mapped ids in v0, else `lat/lng+radius` filtered to the
  resort), picks the cheapest supplier from the `suppliers` map, returns null if the
  resort isn't covered. Short-TTL in-memory/Redis cache (≤ 60 min) keyed by
  (resortId, dates, party). **No DB writes.**
- **tRPC:** add a `stays.bookingOffer` query (public) in
  [`routers/stays.ts`](../../src/integrations/trpc/routers/stays.ts) that wraps the
  helper. Keep it separate from `stays.availability` (different source, different
  lifecycle, different storage rules).
- **UI:** a `<BookResortButton>` in `src/components/stays/` that renders the live
  rate + CTA when an offer exists, and the Disney detail-URL fallback otherwise.
  Include the affiliate disclosure inline. **Native gating** (`use-is-native.ts`):
  external OTA links open in the system browser / in-app browser appropriately, same
  pattern as the MDE deep-link platform gating.
- **Config/env:** `STAY22_API_KEY` (server-only; demo mode works for v0),
  `STAY22_BASE` (default `https://api.stay22.com/v2`), `STAY22_CACHE_TTL_MS`
  (≤ 3_600_000), `STAY22_AID`/affiliate identifier if required for attribution.

**Effort:** low-moderate (one server helper + one query + one button; no schema, no
cron, no worker). **Risk:** low — read-only, ephemeral, ToS-clean.

**Ceiling:** room-only, one opaque rate per property (no room-type control — same
grain limit as `stay_obs`). The rate shown may not match our tracked `stay_obs`
price; label it clearly as a live third-party rate.

---

## v2 — Attribution & reporting (fast follow)

**What:** know when a handoff converts, and show the user their "booked via parkfi"
history.

**How:**

- **Hub Data Reporting API** (bearer token from the Stay22 dashboard) — pull-based
  clicks/bookings/earnings. A small periodic job reconciles our click log against
  Stay22's booking/earning records. This _is_ our own performance data (not the
  listing cache), so persisting it is fine.
- **`stay_click`** (new, small): `{ id, user_id?, resort_id, supplier, checkin,
checkout, party_key, clicked_at }` — written when a user hits the CTA, for
  funnel/attribution. This is _our_ event, not Stay22 listing data — allowed.
- Surface earnings in an internal dashboard; optionally show users a lightweight
  "your bookings" list in the account area.

**Effort:** low. **Risk:** low.

---

## v3 — Direct-affiliate escalation (optional; gated on volume)

Stay22 starts at a **30% commission split** (negotiable up with volume; pays 7 days
post-checkout, monthly). It's the **buy** option: one API, all suppliers, best-rate
routing, link-fixing, guaranteed access — for ~70% of the commission skimmed.

**Escalation paths, only when volume justifies the work:**

1. **Negotiate the Stay22 split up** (they invite this with traffic) — zero new
   integration.
2. **Direct-affiliate with Expedia (EPS) / Hotels.com** — keep the _full_
   commission, but eat per-OTA approval (not guaranteed; Booking.com has cut small
   partners) + build/maintain each integration + link health + best-rate routing
   ourselves.

**Decision:** don't build this on spec. Ship v1/v2, watch conversion + earnings, and
escalate only if the direct-affiliate delta clears the integration + ops cost.

---

## Explicitly rejected (and why)

- **Nuitée / bedbank resale (book in-app).** Resold inventory is marked up — rates
  run high (the user's own observation), and it makes parkfi the merchant of record
  with support/refund liability. Stay22's affiliate routing shows _real_ OTA rates
  and keeps us out of the transaction. Rejected in favor of Stay22.
- **Booking Disney resorts on-behalf via credentials.** No delegation surface exists
  for lodging (unlike dining's F&F); it's the credential-holding rathole —
  ToS-forbidden, bans the user's account, stacks legal exposure. Never. (See
  `mde-onbehalf-integration-feasibility`.)
- **Feeding Stay22 data into `stay_obs` / price history / alerts.** Violates Stay22's
  no-store term _and_ corrupts our independently-sourced moat with room-only,
  room-type-opaque, differently-sourced numbers. The hard boundary exists precisely
  to prevent this.
- **Booking.com as the Disney supplier.** Its Disney-owned inventory is absent; the
  Expedia/Hotels.com legs carry it. Don't build a Booking dependency for the Disney
  piece.
- **Client-side Stay22 calls / embedding the LMA widget.** Keep calls server-side for
  key safety, CORS, and one auditable boundary file; the raw Direct Travel API gives
  us full control over the UX vs. the drop-in widget.

---

## Open items / risks

- **Coverage breadth (v0 resolves).** How many of the 35 resorts are bookable? If
  values/moderates are largely absent, set expectations: this monetizes the
  high-AOV deluxe bookings, with graceful Disney fallback elsewhere.
- **Rate/room-type opacity.** One rate per property, room-only; the room behind the
  number isn't controllable and may look premium (e.g. a villa rate). Label as a
  live third-party starting rate, not "the" price.
- **Rate limits / API key.** Demo is 5 req/min — fine for v0 and low v1 traffic;
  confirm production key terms and per-call quota before scaling. The ≤60-min cache
  is both a ToS requirement and the rate-limit guard.
- **Attribution correctness (v2).** Confirm the affiliate `link` carries our
  identifier and that Hub reporting reconciles to our click log.
- **Stay22 supplier drift.** Suppliers/inventory can change; treat a null offer as
  "fall back to Disney handoff," never an error.
- **FTC disclosure + Stay22 terms compliance** are launch blockers, not polish.

---

## Immediate next steps

1. **v0:** write + run `scripts/stay22-coverage.ts` (respect 5 req/min; no DB
   writes); commit `coverage.md` classifying all 35 catalog resorts.
2. **v1:** build `src/server/stays/stay22.ts` (the single boundary file) +
   `stays.bookingOffer` tRPC query + `<BookResortButton>` with disclosure and Disney
   fallback; wire env/config.
3. **v2:** add `stay_click` + Hub Reporting reconciliation once v1 is live.
4. **Guardrail check in review:** grep that nothing outside `stay22.ts` imports the
   Stay22 client, and that no Stay22 field reaches `stay_obs` or any migration.
