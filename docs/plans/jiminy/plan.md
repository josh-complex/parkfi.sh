# Jiminy — on-behalf-of booking via Friends & Family delegation

> _"When you wish upon a star…"_ parkfi watches for the dining reservation or
> Lightning Lane you want and grabs it for your party — the moment it appears,
> while you sleep.

Feasibility + risk work behind this: `../../` deep-research (2026-07-07) and the
`mde-onbehalf-integration-feasibility` memory. This plan turns that finding into
a build. **Read it before touching this — the whole design exists to stay on the
one account-safe path and avoid the one that gets users banned.**

---

## 0. The one rule that shapes everything

There are two ways to book on a user's behalf. We build **only** the second.

1. **❌ Credential-holding.** Take the user's OneID login / refresh token, drive
   Disney's write APIs as them. Technically easiest, and _flatly forbidden_:
   Disney's Terms of Use ban both automation and sharing "account or account
   information." It bans **the user's** account and stacks CFAA/DMCA/contract
   exposure on us. **Never ingest a user's Disney credentials.**
2. **✅ Friends & Family delegation.** parkfi operates its _own_ Disney
   account(s) — "**Jiminys**." The user adds a Jiminy to their My Disney
   Experience Friends & Family list and grants "**can make plans**" permission.
   parkfi then books into the user's party _as the Jiminy_, using only
   credentials **we own**. No user credential ever leaves MDE. This is exactly
   how StandbySkipper, Wait Magic, and Add More Magic operate in production
   today.

Disney's own MDE terms authorize this: _"By sending and/or accepting an
invitation to become a family or friend, you authorize that family or friend to
plan and modify activities for you, without notice to you."_

**Consequences of choosing path 2** (design constraints, not options):

- We hold credentials for a **pool of Jiminy Disney accounts we control**,
  never for users. Our existing rotating-refresh-token infra
  (`disney-session.ts`) generalizes from one service token to N Jiminy
  tokens.
- We can only do what a friend-with-planning-permission can do: **book/modify
  dining for the party, book + modify Lightning Lane Multi Pass, modify Single
  Pass.** We **cannot** buy passes or make the _initial_ LL selection — the user
  does those in MDE themselves. The UX must state this plainly.
- There is **no delegated surface for purchase / folio / mobile-order data.**
  Spend-based achievements stay on the receipt-photo path (see
  `../achievements/next-steps.md`); Jiminy does not rescue them.

---

## 1. What already exists (and gets reused wholesale)

Jiminy is mostly **already built as the _read_ half** — dining alerts.
The new work is the _write_ half plus the linking handshake.

| Existing piece                                               | Role in Jiminy                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `server/dining/availability.ts` (dine-vas `getAvailability`) | The watch loop. Already polls slots per (facility, partySize, date range).   |
| `dining_alert` table + `diningAlerts` router                 | The request model. A booking request _is_ an alert with "book it" turned on. |
| `server/notifications/*` (queue, push, mailer)               | Post-booking confirmation & failure notices.                                 |
| `disney-session.ts` rotating refresh token                   | The Jiminy auth pattern, generalized to a pool.                              |
| `dining_obs` generational availability                       | The trigger signal the booker consumes.                                      |

The read poller already knows the instant a slot opens. Today it emails you.
Jiminy adds: _if this request is delegated and armed for auto-book, hand
it to the booking worker instead of (or before) the email._

---

## 2. Architecture

```
                 ┌─────────────────────────────────────────────┐
   user's MDE    │  1. user invites a Jiminy (F&F) + grants  │
  ◄──────────────┤     "can make plans"                          │
                 │  2. parkfi detects the link is live           │
                 └───────────────┬─────────────────────────────┘
                                 │
   ┌─────────────────────────────▼──────────────────────────────┐
   │  jiminy_request  (what the user wants booked)       │
   │  — restaurant / date / party  OR  LL park+day                │
   └─────────────────────────────┬──────────────────────────────┘
                                 │  armed & delegated?
   dine-vas availability poller ─┤
   (existing dining_obs signal)  │  slot appears
                                 ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Booking worker ("wish")                                       │
   │  • pick a Jiminy that is linked to THIS user & idle         │
   │  • mint Jiminy bearer (refreshDineBearer, per-account)      │
   │  • POST the reservation into the user's party  ← THE SPIKE     │
   │  • on success: write booking row, notify user, unarm request   │
   │  • on failure: backoff / re-queue / surface                    │
   └──────────────────────────────────────────────────────────────┘
```

The single genuinely-new, genuinely-unknown box is the **write call**. Everything
else is composition of parts we have.

---

## 3. The write endpoint — the spike that gates the whole project

Our deep research confirmed the **read** endpoints are plain HTTPS + bearer (no
cert pinning, no Akamai on GETs — we've proven this live). It also found that
**no open-source prior art demonstrates a booking write**, and we have never
inspected a live dine-vas / LL _write_ request. So the real difficulty is
**unmeasured**. This must be de-risked _first_, before any schema or UX work.

**Spike 0 (do this before committing to the build).** Full runbook:
[`write-spike.md`](./write-spike.md). In brief:

1. Stand up one Jiminy Disney account + a throwaway test user; from a
   residential/human context, link them and grant planning permission.
2. Capture the booking write for the _friend's_ party — method, host, path,
   headers, body, and especially **what anti-bot / attestation guards it** (Akamai
   sensor data? device attestation? a `conversation-id` minted earlier in the
   flow?). **Dining is capturable in the browser** — the web MDE `/dine-res/` SPA
   hits the same dine-vas backend as our read, no cert-pinning. **MDE is app-only
   for Lightning Lane**, so LL capture needs the app + a cert-pinning bypass
   (emulator + Frida/objection) — do that only when greenlighting Phase 2.
3. Replay that write from a bare HTTP client with a freshly-minted Jiminy
   bearer. **Does it succeed cookieless like availability does, or does it demand
   session/attestation state the GET path doesn't?**

Outcome decides the shape of the whole project:

- **Bearer + headers is enough (like reads):** booking is a plain server-side
  `fetch`. Build proceeds as a normal backend feature. _Best case._
- **Needs Akamai sensor / device attestation:** we need a **headless real MDE
  client** per Jiminy — Playwright driving the web MDE for dining, an instrumented
  app for LL — heavier, more fragile, but still credential-clean and still what
  the incumbents likely do. This is the operational-fragility fork.

**✅ Answered 2026-07-07 (live) — Verdict B, but feasible.** Full detail in
[`write-spike.md`](./write-spike.md). Summary: the dining write is two-stage —
**search + 10-min hold succeed on the session bearer (no friction)**, but the
**commit redirects to `/checkout-booking/` and hard-stops on a OneID password
step-up (registerdisney authenticator iframe) + reCAPTCHA.** Critically, the
step-up is **once-per-session, not per-commit** (verified: a second booking in the
same authenticated session skipped the prompt). So commit needs a **per-Jiminy
session warmed once by a human step-up, then driven by a headless real browser** —
NOT a stateless `fetch`, but workable. Post-auth checkout is Contact Info → **Credit
Card Guarantee** (guarantee-required restaurants need a card on the Jiminy account)
→ confirm. Remaining unknown: warmed-session TTL before step-up re-triggers.

---

## 4. Data model (new tables — hand-written timestamped migrations, per convention)

```sql
-- A Jiminy = a Disney account WE own and book through.
CREATE TABLE jiminy_account (
  id            bigserial PRIMARY KEY,
  swid          text NOT NULL UNIQUE,        -- OneID SWID of the account
  label         text NOT NULL,               -- "jiminy-01"
  resort        text NOT NULL DEFAULT 'wdw', -- wdw | dlr — F&F is per-destination
  active        boolean NOT NULL DEFAULT true,
  -- refresh token lives in the existing secret store keyed by swid, not here
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A user has invited a Jiminy and (we've verified) granted planning perms.
CREATE TABLE jiminy_link (
  id            bigserial PRIMARY KEY,
  user_id       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  jiminy_id  bigint NOT NULL REFERENCES jiminy_account(id),
  -- pending: invite sent/known, permission not yet confirmed live.
  -- active: Jiminy sees the user in its friends list WITH make-plans grant.
  -- revoked: link dropped (by user or by us after booking).
  status        text NOT NULL DEFAULT 'pending',
  guest_id      text,                        -- the user's Disney guest id (NOT creds)
  linked_at     timestamptz,
  last_checked_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, jiminy_id)
);

-- What the user wants booked. Superset of dining_alert; LL variant is separate cols.
CREATE TABLE jiminy_request (
  id            bigserial PRIMARY KEY,
  user_id       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  link_id       bigint REFERENCES jiminy_link(id),
  kind          text NOT NULL,               -- 'dining' | 'll_multi' | 'll_single_modify'
  -- dining
  facility_id   text,
  party_size    smallint,
  service_date  date,
  window_days   smallint,
  -- ll
  park_id       bigint,
  ll_day        date,
  -- lifecycle
  status        text NOT NULL DEFAULT 'armed', -- armed | booking | booked | failed | cancelled
  attempts      smallint NOT NULL DEFAULT 0,
  booked_ref    text,                        -- Disney confirmation / reservation id
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jiminy_request_armed_idx ON jiminy_request (status) WHERE status = 'armed';
```

Notes:

- We store only a **guest id**, never credentials — mirror the incumbents' "your
  Guest identifier is shared, never your account."
- `jiminy_request` deliberately parallels `dining_alert`. Options: extend
  `dining_alert` with a `delegated`/`link_id` column and a `book` flag, or keep a
  separate table and let the poller fan a match to both. Recommend **separate
  table** — the lifecycle (booking/booked/failed, attempts, confirmation ref) is
  materially different from an alert's edge-trigger/cooldown, and mixing them
  muddies both. The poller already produces `dining_obs`; both consumers read it.

---

## 5. The linking handshake (the trickiest UX)

F&F is a **human-to-human, in-app** grant — there's no API to request it. So the
flow is guided-manual:

1. **Assign a Jiminy.** On "enable Jiminy," pick an `active` Jiminy
   for the user's resort (pool for load-spread + blast-radius limits, see §7).
   Create a `jiminy_link` (`pending`).
2. **Guide the user through MDE.** Show the Jiminy's exact name / email /
   invite link and step-by-step: _add this friend, then toggle "This person can
   make plans."_ (Screenshots. This is where users get stuck.)
3. **Detect the link is live.** A worker, authenticated **as the Jiminy**,
   polls the Jiminy's own Friends & Family list until the user appears **with
   the make-plans permission set**, then flips `jiminy_link` → `active` and
   captures `guest_id`. (This read is on the Jiminy's own account — safe, and
   the exact endpoint is a small sub-spike alongside §3.)
4. **Only `active` links can arm requests.** UI gates on it.
5. **Teardown.** Add More Magic auto-removes itself after booking; offer the same
   ("your Jiminy leaves once she's done") plus a manual "revoke" that drops the
   friend on our side and marks the link `revoked`.

### 5b. Permission directionality — verified live (2026-07-07)

Inspected on a real Jiminy account's `/profile/family-friends/` page with a linked
test guest. **The reverse-control risk is real but fully containable**, and the
mechanics are now known rather than assumed:

- F&F permissions are **per-connection and directional.** What lets _us_ book for
  a user is a grant the **user** makes to Jiminy on **their** list. What a user
  could do back to us is governed by a **separate** set of switches on **Jiminy's**
  side ("_<User>'s Settings_"), which we control independently. We accept their
  grant while granting them nothing.
- Jiminy's side exposes three switches per connection:
  1. **"Allow <User> to view and modify _all_ of your plans"** — **defaults ON.**
     Off ⇒ the user can only see/modify plans **we explicitly share.** **Hard
     rule: force this OFF on every user link.** This is what stops a user touching
     Jiminy's own plans (and any reservation Jiminy transiently holds).
  2. "Allow <User> to view your PhotoPass photos" — cosmetic; off.
  3. **"Allow <User> to make plans for the Guests _you manage_"** — applies only to
     **Managed Guests** (dependent profiles with no own login).
- **Structural rule that isolates users from each other:** every parkfi user must
  connect as an **independent Disney account (a peer connection)**, **never** as a
  **Managed Guest** of a Jiminy. F&F gives one peer connection **zero visibility
  into another peer connection**, so user A cannot reach user B. Enrolling users as
  Managed Guests would collapse that wall — **prohibited.**
- **Programmatic check:** the connection list + each connection's permission flags
  read from `GET /profile-api/profile-svc/profile-service/guests/{SWID}/affiliations/?site=ALL`
  (auth: `pep_oauth_token` bearer **+** `swid` and `cast-identifier` headers). The
  detection worker (step 3) uses this both to confirm the user's make-plans grant
  **and to assert switch #1 is OFF** before a link goes `active`.

---

## 6. Capabilities & phasing

Ranked by feasibility × value × risk (from the research matrix):

### Phase 1 — Dining auto-book (build first)

Highest value, best-proven. Reuses the entire dining-alert read stack; adds only
the booking worker + linking. Ship this alone as the MVP. _"Tell us the hard-to-
get table you want; we'll grab it."_

### Phase 2 — Lightning Lane Multi Pass book/modify

Same delegation, different (unmapped) write endpoint. **Hard dependency the UX
must enforce:** the user must have _already purchased_ LL Multi Pass and made
their _initial_ selection in MDE — the Jiminy can only book/modify _after_
that. Big value (rebooking the next slot the instant one is used is the core
Genie+-optimizer loop) but more moving parts and a second write spike.

### Phase 3 — Single Pass modify

Modify-only (can't book the initial). Small, do it alongside Phase 2 if the write
generalizes.

### Explicitly out of scope

- **Virtual queue joins** — undemonstrated anywhere, highest anti-bot exposure,
  time-critical (7am/1pm drops) so most bot-like. Don't.
- **Purchase / receipt / folio import** — no data surface exists. Not here.
- **Buying passes / tickets on behalf** — F&F grants no purchasing authority.

---

## 7. Risk register & mitigations

| Risk                                                                                                    | Severity                            | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Write endpoint needs attestation we can't cleanly replay**                                            | **Confirmed (Verdict B), feasible** | Live 2026-07-07: dining _commit_ forces OneID password step-up + reCAPTCHA at `/checkout-booking/`; search+hold don't. Step-up is **once-per-session** (verified), so warm each Jiminy once via headless real browser, then book unattended. Not a stateless `fetch`.                                                                                                                                                                                                                                                                |
| **No-show/cancellation-fee liability lands on parkfi's card**                                           | **Med, path identified**            | Web `/dine-res` locks primary guest = Jiminy (no fix on web). **Solution (per prior-art research): book the USER as lead guest** — reservation lands in their MDE, their card-on-file guarantees it, they bear the no-show fee (how Add More Magic operates; Disney's own "make them in their name to start with" model). Requires the **app flow** (web can't set lead guest) — folds into the same cert-pinned app-client as LL — plus user has a card on file in their own MDE. Confirm card-follows-lead-guest in the app spike. |
| **Warmed-session TTL unknown**                                                                          | Low-med                             | Monitor session liveness; re-warm (human step-up) when a Jiminy session lapses. Measure TTL during build.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **ToS-gray for the operator** (F&F is sanctioned for guests, less clearly for a commercial automator)   | Med                                 | Model _exactly_ on incumbents (StandbySkipper et al. operate openly). Credential-clean design is the core defense. Consider counsel before charging money for it.                                                                                                                                                                                                                                                                                                                                                                    |
| **Jiminy account pool gets flagged/banned**                                                             | Med-high                            | Pool of accounts; cap links & bookings per Jiminy; human-like pacing; rotate; auto-remove after booking to minimize dwell. A banned Jiminy burns _our_ account, never a user's — that's the whole point.                                                                                                                                                                                                                                                                                                                             |
| **Disney tightens auth** (Feb 2026 MDE added password re-entry; didn't break F&F but signals direction) | Med                                 | Isolate the write behind one adapter; keep the read-only product valuable on its own so Jiminy is upside, not a dependency.                                                                                                                                                                                                                                                                                                                                                                                                          |
| **MDE app requires a real device (hardened root/emulator/Play-Integrity detection)**                    | **Confirmed 2026-07-07**            | Live test: MDE crash-loops at splash on a rooted arm64 emulator (probes /proc, sees qemu/ranchu/dev-keys/su/frida). App-flow capabilities (LL, friend-as-lead-guest dining) can't run on an emulator — need **real unmodified devices** (a phone farm), as the incumbents likely do. Answer app-flow feasibility via a **manual check on a physical phone** first; only build the capture rig on real hardware. See write-spike.md Tier 2 RESULT.                                                                                    |
| **User account safety**                                                                                 | **Low by design**                   | No user credentials touched; worst case for the user is the reservation doesn't get booked. This is the property we refuse to compromise.                                                                                                                                                                                                                                                                                                                                                                                            |
| **Reverse control — a user modifies OUR plans or another user's plans**                                 | Med (mitigated)                     | Verified §5b: force the "view/modify _all_ your plans" switch **OFF** per link (detection worker asserts it before `active`); **never enroll users as Managed Guests** — peers can't see peers. Both are hard rules, not options.                                                                                                                                                                                                                                                                                                    |
| **User grants perms then blames us for a missed table**                                                 | Low                                 | Clear "best-effort, no guarantee" framing; never promise a specific reservation.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

The account-safety row is the whole reason for the design. If a proposed change
would put a _user's_ Disney account at risk, it's out of bounds — research memory
`mde-onbehalf-integration-feasibility` is the standing reference.

---

## 8. Open questions (resolve via spikes before/early in build)

1. **Write transport** (§3): bearer-only or attestation-gated? _Gates the build._
2. **Friends-list read**: exact endpoint to enumerate a Jiminy's friends and
   read each one's planning-permission flag (for link detection).
3. **Party targeting**: how a booking write specifies _which linked guest's
   party_ the reservation is for (the `guest_id` we store — confirm it's the
   right identifier).
4. **How the incumbents actually execute** — official API from their own account,
   or headless MDE automation? Determines our operational fragility. (Research
   left this open.)
5. **Disney enforcement history** against these services / their users — none
   documented, but worth a fresh check before charging money.

---

## 9. Suggested order

1. **§3 write spike + §5.3 friends-list read spike** — one Jiminy, one test
   user, capture and replay a real booking. _Everything downstream is gated on
   this; do not build schema/UX until it's answered._
2. **Phase 1 dining**: `jiminy_account` + `jiminy_link` + `jiminy_request`
   tables → linking flow + detection worker → booking worker wired to the existing
   availability poller → confirmation via existing notifications.
3. **Phase 2/3 Lightning Lane** once dining is stable and the LL write is mapped.
4. Fold learnings back into the `mde-onbehalf-integration-feasibility` memory.

---

## Naming

- **Jiminy** — the feature. "Let Jiminy grab it for you."
- **a Jiminy** (`jiminy_account`, labeled `jiminy-01`, …) — an internal Disney
  account we own and book _through_. The feature and the accounts share the name:
  Jiminy the helper is embodied by a pool of Jiminy accounts.
- **jiminy_link** — a user's verified F&F grant linking them to a Jiminy account.
- **wish** — the booking worker (the one that grants the wish and makes the
  reservation appear).

Kept independent of the Living Layer, same as achievements — no imports from
`src/server/living/**`.
