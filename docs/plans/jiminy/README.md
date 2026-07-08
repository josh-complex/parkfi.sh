# Jiminy — final plan & roadmap

> _"When you wish upon a star…"_ parkfi watches for the hard-to-get dining
> reservation or Lightning Lane you want and gets you there first.

This is the decision doc. Detailed F&F design lives in [`plan.md`](./plan.md);
the live-investigation evidence is in [`write-spike.md`](./write-spike.md);
feasibility/legal grounding is the `mde-onbehalf-integration-feasibility` and
`jiminy-onbehalf-booking` memories.

---

## TL;DR — the decision

Ship in three tiers, cheapest-first. **v1 and v2 are the plan; v3 is an optional
premium someday.**

1. **v1 — Alert-only** _(build now)_. Cloud watches availability; the instant the
   thing opens, notify the user. They book it. Reuses infra we already have.
2. **v2 — Assisted one-tap** _(fast follow)_. Same detection, but the notification
   **deep-links the user straight into MDE's reservation flow, pre-scoped to the
   exact restaurant/date/party**, and bounces them back to parkfi when done.
3. **v3 — Full autobook via Friends & Family** _(optional, gated on business
   appetite)_. Books entirely hands-free. Viable and liability-clean, but requires
   a **fleet of real phones** — an ops business, not a backend feature.

**Everything runs on the read stack we already have, except v3.**

---

## Why the roadmap is shaped this way (what we proved, 2026-07-07)

All verified live — details in [`write-spike.md`](./write-spike.md):

- **Detection is cheap and cloud-native.** Availability + holds work on a plain
  server bearer (the dine-vas poller we already run). ✅
- **The booking _commit_ is not a server call.** It forces a OneID password
  step-up + reCAPTCHA (once per session, not a permablock), then a credit-card
  guarantee. So hands-free commit needs a **warm, human-established app session**.
- **The MDE app won't run on an emulator.** Hardened root/emulator/Play-Integrity
  detection crash-loops it. Hands-free autobook therefore needs **real,
  unmodified devices** — a phone farm. This is the whole reason v3 is heavy.
- **Liability can sit on the user, not us.** Booking with the **user as lead
  guest** puts the reservation in _their_ MDE and the no-show fee on _their_ card
  — but that's an app-flow capability (web locks lead guest to the booker).
- **The deep-link surface is a gift.** MDE exposes a parameterized dining deep
  link — `mdx://dining/reservation?id=<facilityId>&partySize=<n>&dateTime=<ISO>&completionDeepLink=<url>`
  — plus Branch (`disneyworld.app.link`) / https App Links as cross-platform
  carriers. This is what makes **v2 assisted one-tap** real and cheap.
- **Reverse-control is containable.** We can prevent users from touching our plans
  or each other's (per-connection `PLAN_VIEW_SHARED`; users stay independent
  peers, never managed guests). Matters only once we do F&F (v3).

---

## v1 — Alert-only (build now)

**What:** user says "I want Cinderella's Royal Table, party of 4, July 15." Cloud
polls dine-vas; the moment a slot opens, push/email them.

**How:** this is the existing dining-alert stack (`server/dining/availability.ts`
poller, `dining_obs`, `server/notifications/*`). Jiminy v1 is largely a UX layer +
a `jiminy_request`-style watch record over what we already run.

**Effort:** low. **Risk:** low (read-only, public/near-public endpoints).
**Covers:** dining today; Lightning Lane availability alerts likewise.

## v2 — Assisted one-tap (fast follow)

**What:** the alert becomes a button that drops the user **onto the exact
reservation** in MDE. They tap hold → confirm. It's their account, their card, and
the OS step-up/CAPTCHA is satisfied naturally by the human tap.

**How:** on slot detection, build
`mdx://dining/reservation?id=<facilityId>&partySize=<n>&dateTime=<ISO8601>&completionDeepLink=parkfi://booked`
(carried via a Branch/https link for iOS + Android reliability) and deliver it in
the push. `completionDeepLink` returns them to parkfi to confirm/close the loop.

**Effort:** low-moderate (build the link, wire Branch/App-Link, handle the
return). **Risk:** low — **no automation, no F&F, no device farm, no card
liability shift** (the human books). **Ceiling:** the link _navigates_ to the
pre-scoped reservation; it doesn't auto-confirm a held offer, so it's "right
screen + a couple taps," not zero-touch. That's ~90% of the real-world win (you
beat everyone else to the tap).

**One open item:** confirm the deep link deposits the user as deep into the flow
as hoped (facility+party+datetime pre-fill) on a real phone — a 5-minute manual
check. The route string is extracted; this just validates depth.

## v3 — Full autobook via Friends & Family (optional premium; gated on a phone farm)

**What:** fully hands-free. User grants a parkfi "Jiminy" account F&F "make plans"
permission; when a slot opens, we book it into their party with **them as lead
guest** (their card guarantees it). Detailed design: [`plan.md`](./plan.md).

**How & why it's heavy:** the booking worker must drive the **MDE app on real,
warmed devices** (emulators are blocked). That's a device-farm operation: real
phones, kept logged into pooled Jiminy accounts, sessions babysat, scaled by
adding hardware. Liability-clean (user as lead guest) and reverse-control-safe
(§5b of `plan.md`), but it's an ops commitment.

**Effort:** high (hardware + ops + the app-flow capture spike on real devices).
**Risk:** medium — ToS-gray (model exactly on StandbySkipper/Wait Magic/Add More
Magic, who operate openly), account-safe for _users_ by design (no user
credentials, no user account bans). **Decision:** only pursue if v1/v2 demand
proves people want true hands-free and are willing to pay for it.

---

## Explicitly rejected (and why)

- **Credential-holding autobook** — take the user's OneID/refresh token and drive
  writes as them. Flatly ToS-forbidden, bans the _user's_ account, stacks
  CFAA/DMCA/contract exposure on us. Never.
- **Crowdsourced autobook on users' own devices** — unattended automation on user
  phones violates MDE ToS regardless of whose hardware, gets pulled from the app
  stores (Android Accessibility abuse / iOS forbids it), can't run reliably in the
  background, and risks banning users' Disney accounts. More risk than a phone
  farm, not less. (The _legitimate_ "each user's device books" version **is** v2 —
  human-in-the-loop assisted booking.)
- **Spend / receipt / folio import** (the original "money spent" achievement idea)
  — no delegated data surface exists at any auth level. Use the receipt-photo +
  geo-presence path instead (see `../achievements/next-steps.md`). Not a Jiminy
  feature.
- **Buying passes/tickets or making the initial LL selection** — F&F grants no
  purchasing authority; the user does these once themselves.
- **Virtual queue joins** — undemonstrated, highest anti-bot exposure. Don't.

---

## Guardrails (unchanged from `plan.md`)

Independent of the Living Layer (no imports from `src/server/living/**`). If v3 is
ever built: no user credentials ever ingested; users connect as independent peers;
per-connection sharing forced to `PLAN_VIEW_SHARED`; never promise a specific
reservation (best-effort framing).

## Immediate next steps

1. Build **v1 alert-only** on the existing dining-alert stack.
2. Spike **v2**: validate the `mdx://dining/reservation` deep-link depth on a real
   phone (5 min), wire Branch/App-Links, ship the one-tap button.
3. Park **v3** behind a demand signal; if pursued, start with the real-device
   app-flow capture spike (`write-spike.md` Tier 2, on real hardware).
4. Housekeeping: remove the 246 MB MDE APK from `public/anim/` (it's in a
   publicly-served folder).
