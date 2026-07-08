# Jiminy §3 — the write-endpoint spike (runbook)

> Go/no-go experiment. **Nothing else in the Jiminy plan gets built until this
> answers one question:** can a bare server-side HTTP client, holding only a
> freshly-minted Jiminy bearer, submit a real booking into a linked friend's
> party — or is the write guarded by anti-bot / device attestation that a plain
> client can't reproduce?

Reference: [`plan.md`](./plan.md) §3, and the `disney-dining-auth` memory (how
the dine-vas bearer is minted, refreshed, and which headers the read needs).

---

## ✅ RESULT — live capture 2026-07-07 (Verdict B for the dining commit)

Ran the flow end-to-end on real accounts (Jiminy `disney@parkfi.sh` + linked test
guest "Google Proxy"), web MDE, browser-driven. Findings:

**The dining write is a two-stage flow, and the stages are guarded differently:**

1. **Search (availability)** — `GET` on dine-vas, existing bearer/session → 200.
   Unchanged from the known read. No friction.
2. **Hold** — clicking a time slot fires a **write that places a 10-minute hold**
   ("_We are holding your reservation for 10 minutes_") and lands on
   `/dine-res/reservation`. **Succeeded on the existing session bearer — no
   step-up, no CAPTCHA.** So the _hold_ is a bearer-class write.
3. **Commit** — clicking **Continue** redirects to **`/checkout-booking/`
   ("UnifiedCheckout")**, which **hard-stops on a OneID step-up re-authentication:
   "Enter your password to continue"** for the Jiminy account, served inside a
   **`cdn.registerdisney.go.com/v4` OneID authenticator iframe**, with a
   **reCAPTCHA** running inside that iframe. (Also present: a
   `disneyworld.disney.go.com/authenticator` iframe and an OTP fallback — "_send a
   one-time code_".)

**Verdict: B for the commit.** The final booking is **not** a plain
bearer POST. It is gated by an interactive **OneID password step-up + reCAPTCHA**
at the UnifiedCheckout layer — exactly the "Feb 2026 MDE password re-entry"
tightening the research flagged. A headless server-side client holding only a
refresh-token-minted bearer **cannot clear this cleanly**.

**Follow-up test — step-up frequency (RESOLVED same session):** entered the
password once (user-supplied; the agent never handled it) → cleared to the real
Checkout. Then ran a **second** booking in the same session: **it went straight to
Checkout with NO password prompt.** So the OneID step-up is **once-per-session,
not per-commit.** ⇒ **The workable case.** A Jiminy account can be warmed with a
single human step-up and then book unattended until the session expires.

**Post-auth checkout shape:** `/checkout-booking/` is a normal multi-step form:
**(1) Contact Info** (pre-filled Jiminy name/email, optional phone) → **(2) Credit
Card Guarantee** → confirm. So one more real gate: **guarantee-required
restaurants (e.g. 1900 Park Fare) need a credit card on the Jiminy account.** Not
all restaurants require it, but the worker must handle a saved-card selection for
those that do.

**What this means for the build:**

- Booking-commit automation needs a **persistent, human-warmed authenticated
  session per Jiminy account** — log in + satisfy the step-up **once**, keep the
  session/cookies alive, then drive commits via a **headless real-browser client**
  (not a stateless `fetch`). Matches how the incumbents (StandbySkipper, Wait
  Magic, Add More Magic) most likely run. **This is now confirmed feasible, not
  just hypothesized** — the once-per-session step-up is the linchpin that makes it
  work.
- The **initial per-Jiminy warm-up (login + step-up)** is a manual/ops step; plan
  for session-liveness monitoring + re-warm when a Jiminy session lapses.
- Guarantee-required restaurants ⇒ **keep a card on file per Jiminy account** and
  have the worker pick the saved card at checkout step 2. (Agent did **not** enter
  any card or complete a booking; the two test holds auto-expire.)
- The bearer + `x-disney-internal-dine-vas-*` headers still cover **search and
  hold**, so read/alerting features remain a plain `fetch`. Only _commit_ needs
  the warm browser session.

**Remaining unknown:** how long a warmed session lasts before the step-up
re-triggers (session TTL / device-trust window). Measure during build to size the
re-warm cadence.

### ⚠️ Primary guest / card-liability finding (2026-07-07) — the web flow can't shift no-show liability off Jiminy

Question raised: can the **linked friend (the parkfi user) be the primary guest**,
so the **no-show / cancellation fee lands on the user's card** instead of forcing
a card onto the Jiminy account? Checked live:

- The web `/dine-res` reservation flow **never asks who is in the party** — only a
  **headcount** ("2 Guests"). There is **no F&F member / lead-guest picker.**
- At checkout, **Primary Guest is locked to the logged-in account (Jiminy
  Cricket)**. The only editable fields under "Change" are **email and phone** —
  **primary guest cannot be reassigned.**
- Therefore the **Credit Card Guarantee is Jiminy's card**, and any no-show fee
  hits **our** card. **The web flow gives us no way to put the liability on the
  user.**

**Implications / options (unresolved — needs a decision + possibly app testing):**

1. **MDE app flow (unverified):** the _app_ dining flow DOES let the booker pick
   party members from F&F and can associate the reservation with a specific guest.
   Whether that shifts the **guarantee to the guest's card** (vs. the booker's) is
   **unknown and must be tested** — and the app is behind cert pinning (same fork
   as LL). This is the only plausible path to user-borne liability, and it's not
   confirmed to work.
2. **Non-guarantee restaurants only:** many table-service ADRs now require a card
   guarantee, but some don't. Auto-booking could be **scoped to non-guarantee
   restaurants**, eliminating card risk entirely (at the cost of coverage).
3. **Accept the liability with controls:** put a card on the Jiminy account but
   cap exposure — auto-cancel/modify well before the cancellation window, cap
   concurrent held guarantees per Jiminy, and surface the no-show-fee risk to the
   user in ToS. (This is what the user wants to avoid.)
4. **User-supplied card at commit:** have the _user_ enter their own card at the
   guarantee step — but that breaks the unattended model (defeats the point).

**Net:** on the web path, on-behalf dining booking **forces parkfi's card to carry
no-show liability.** Moving liability to the user is either an **app-flow question
(unverified, cert-pinned)** or a **scope decision (non-guarantee restaurants
only)**. Resolve before building the dining booker.

### ✅ Resolution via prior-art research (2026-07-07) — book the USER as lead guest

Investigated how the incumbents avoid this. Findings:

- **Thrill Data / Wait Magic do NOT auto-book dining** — Wait Magic is
  Lightning-Lane-only (LL has no per-booking card guarantee; the user
  pre-purchases), and Thrill Data's dining product is **alerts** ("Premium Dining
  Alerts"), i.e. the _user_ books it themselves with the user's own card. So they
  never hit this problem.
- **Add More Magic DOES auto-book dining via F&F** and the reservation "**will
  appear in your MDE under Future Plans**" — and it **never mentions a credit card
  or guarantee anywhere.** The tell: it books with the **user as lead guest**, so
  the user's own card-on-file carries the guarantee.
- **The mechanic (Disney's own model, per F&F dining docs + forums):** a friend
  with "make plans" permission can **book an ADR with a linked guest as the lead
  guest — "make them in their name to start with"** — and then "the ADR will show
  in **their** MDE." **No-show liability follows the lead guest** ("the lead guest
  is whose credit card is on file and who is charged"; "you can't transfer dining
  reservations" — so lead guest must be set at booking time, which is exactly what
  we'd do).

**Conclusion — parkfi does NOT need a card on the Jiminy accounts.** Book with the
**parkfi user as the lead guest**; the user's own card (on file in _their_ MDE)
guarantees the reservation and the user bears any no-show fee — the correct
liability model. The user (as lead guest) also controls cancellation.

**BUT — this is the app-flow, not the web flow I tested.** The web `/dine-res`
flow locks lead guest to the account holder and has no F&F member picker. Setting
a _friend_ as lead guest is an **MDE app capability** (well-supported by forum
evidence; the exact card-follows-lead-guest behavior still wants a direct app
confirmation). So this **folds into the same cert-pinned app-client requirement
as Lightning Lane** — the app flow isn't just for LL, it's what makes
liability-clean dining booking possible too.

**Preconditions to bake into onboarding:** (1) the user must have a **card on file
in their own MDE**; (2) booking must set the **user as lead guest**; (3) build on
the **app flow**, not web. Confirm the card-follows-lead-guest behavior in the
app-capture spike (Path B) before committing.

**Note on capture fidelity:** the browser tool's safety filter redacts any request
carrying tokens/cookies/query strings, so the exact dine-vas hold/commit request
bodies could not be exfiltrated to the agent. That's fine — the _gating mechanism_
(step-up + reCAPTCHA at commit) is the decision-relevant finding, and it's
unambiguous. Exact request bodies can be lifted from DevTools by hand if/when the
headless-session approach is built.

**Permission-write (reverse-control) capture succeeded fully** — see plan §5b:
`PUT /profile-api/gam/assembly/friend/{connectionId}` with body
`{"access-classification":"PLAN_VIEW_SHARED", ...}` (headers: bearer, `x-swid`,
`X-Disney-Internal-CastProxy`, `X-Conversation-Id`, `X-Correlation-Id`) → 201.
This is the enforcement call that keeps a user from controlling our plans, and
it _is_ a clean bearer-class write.

---

---

## The one question, stated precisely

The **read** (`dine-vas getAvailability`) is proven: `Authorization: BEARER <jwt>`

- `x-disney-internal-dine-vas-eks: true` + `x-disney-internal-dine-vas-365: true`,
  cookieless, from a bare client → 200. The **write** (actually reserving the slot)
  has never been inspected. It resolves to one of:

* **Verdict A — "bearer + headers is enough."** The booking POST succeeds
  cookieless from a bare client, exactly like availability. → Jiminy is a plain
  server-side `fetch`. Normal backend build. _Best case._
* **Verdict B — "attestation-gated."** The POST demands session state the GET
  path doesn't: Akamai `_abck`/sensor cookies, a `conversation-id`/correlation
  token minted earlier in the flow, a CSRF/nonce, or device attestation. → we
  need a **headless real MDE client per Jiminy account** (Playwright for web
  dining; instrumented app for LL). Heavier, more fragile, still credential-clean.

Write the verdict — with the captured request and the replay result — back into
the `mde-onbehalf-integration-feasibility` memory regardless of outcome.

---

## Why this isn't just "proxy the app"

MDE's booking flows are **app-first**, and the app almost certainly **pins its TLS
certificates** — a normal proxy (mitmproxy/Charles/Proxyman) presents its own CA,
the app rejects it, and you see nothing. Getting past that is the whole difficulty
of app capture. So the runbook is **tiered**: do the part that needs no phone
first.

| Capability                   | Where the write lives                                                                      | Capture difficulty                           |
| ---------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| **Dining** (Phase 1)         | **Web MDE** (`disneyworld.disney.go.com`, `/dine-res/` SPA) hits the same dine-vas backend | **Easy** — browser devtools, no cert pinning |
| **Lightning Lane** (Phase 2) | App-centric; no full web equivalent                                                        | **Hard** — app + cert-pinning bypass         |

**Do Path A first.** It answers Verdict A/B for the whole project at the lowest
cost; only start Path B if you're greenlighting Phase 2 (LL) specifically.

---

## Prerequisites (both paths)

1. **Two Disney accounts you own**: one "Jiminy" account, one "test guest" (a
   throwaway that plays the user). Use real residential context — the dining-auth
   memory documents that datacenter/headless logins trip a 6-digit email OTP.
2. **A live F&F link between them.** In MDE (app or web), from the _test guest_
   account: add the Jiminy account as a Friend & Family member and toggle **"This
   person can make plans."** Confirm the Jiminy account sees the guest with the
   make-plans grant. _This is also the §5.3 friends-list-read sub-spike — capture
   that read while you're here._
3. **A booking worth making**: pick a real restaurant + date + party size with
   actual availability (a non-hard-to-get table so you can rebook it repeatedly
   without burning a real ADR you care about).
4. **Guardrails**: your own accounts only, minimal volume, cancel test
   reservations promptly. This is interop research on accounts you control — keep
   it that way. No third-party accounts, no load.

---

## Path A — Web dining write (do this first)

### A1. Capture

1. Log into `disneyworld.disney.go.com` as the **Jiminy** account in a real
   Chrome profile. Open DevTools → **Network**, enable "Preserve log."
2. Walk the reservation SPA on the `/dine-res/` path: pick the restaurant → party
   size (the "1".."10" buttons) → a calendar day → **Next** (this is the click
   that mints the bearer into cookie `TPR-WDW-LBJS.WEB-PROD.token` and fires the
   `availability` call — per the dining-auth memory).
3. **Select a time slot and complete the booking** through to confirmation. Watch
   for the request(s) after slot-select: the create/commit call is the target.
   There may be a two-step **hold → confirm** (a `POST` that reserves a lock/
   offer id, then a `POST` that commits it). Capture **both**.
4. **Crucially, book it for the _friend's_ party, not the Jiminy account itself.**
   The party picker should list the linked test guest (that's what the F&F grant
   buys). Note how the guest is identified in the request body — this is the
   `guest_id` the plan stores.

### A2. Record the request anatomy (checklist per captured POST)

- [ ] Method + full URL (host, path, query)
- [ ] `Authorization` header — is it the same `BEARER` from the token cookie?
- [ ] The two `x-disney-internal-dine-vas-*` headers? Any _new_ headers the read
      didn't have?
- [ ] Cookies sent — is `_abck` / `bm_sz` / other **Akamai** cookies present and
      non-trivial? (Their presence is the tell for Verdict B.)
- [ ] Body: facility id, date, meal period, party size, **how the friend's guest
      is referenced**, and any **id minted earlier in the flow** (offer/hold id,
      conversation-id, csrf token). Anything that came from a _prior_ response is
      a session-state dependency.
- [ ] Response: confirmation id shape (this is `booked_ref`).

### A3. Replay (the actual test)

1. Mint a **fresh** Jiminy bearer via the refresh endpoint (the plain `fetch` to
   `/guest/refresh-auth` from the dining-auth memory) — do **not** reuse the
   browser session.
2. From a bare HTTP client (curl / a tiny script — no browser, no cookies beyond
   what you deliberately add), replay the create/commit POST(s) with a fresh
   bearer and a fresh test-guest party target.
3. **Result:**
   - Succeeds cookieless → **Verdict A**. 🎉 Booking is a server `fetch`. Note
     whether the hold→confirm two-step is required (it shapes the worker's retry
     logic) and whether the offer/hold id must be freshly fetched each attempt.
   - 4xx/403/challenge that the browser didn't get → **Verdict B**. Record
     _exactly what was missing_ (which cookie/token/nonce). That missing piece is
     the spec for the headless-client fallback.

---

## Path B — App capture (only if greenlighting LL / Phase 2)

Needed because LL has no full web flow **and** because liability-clean dining
(user-as-lead-guest) is an app capability the web flow lacks. Split into two tiers
— **do Tier 1 first; it answers the feasibility questions with zero tooling.**

### The questions the app flow must answer

1. **Lead guest = friend?** In the app dining flow, can you set a **linked F&F
   guest (the parkfi user) as the lead guest** of the ADR ("make it in their name
   to start with")? Forum evidence says yes — confirm firsthand.
2. **Whose card guarantees it?** At the credit-card-guarantee step with the friend
   as lead guest, does it use **the friend's card on file**, prompt for the
   friend's card, or fall back to **the booker's (Jiminy's) card**? _This is the
   crux of the whole no-show-liability question._
3. **Where does it land + who can cancel?** Confirm the ADR shows in the **user's**
   MDE Future Plans and the **user** (lead guest) controls cancellation.
4. **Does booking trigger the same OneID step-up** we saw on web, and is it
   once-per-session in the app too?
5. **(LL)** Can the Jiminy modify LL Multi Pass selections for the party after the
   user pre-purchases + makes the initial pick?

### Tier 1 — manual observation in the app (DO FIRST; ~5–10 min, no tooling, no cert-pinning)

You do NOT need to intercept traffic to answer Q1–Q4. Just walk the flow by hand
on a phone with the MDE app, signed into a **Jiminy** account, with the **test
guest linked and "can make plans" granted**:

1. MDE → **Check Dining Availability** → restaurant + date + party size.
2. At the guest/party step, **look for the Friends & Family member picker** and
   **select the test guest — and try to designate them as the _lead_ guest** (the
   "in their name" option). _(Q1)_
3. Proceed to the **credit-card-guarantee** step and **stop**. Observe, without
   completing: whose name is the reservation under, and **whose card does it show
   / ask for** — the guest's saved card, a prompt, or the account's card? _(Q2)_
   Note whether a **password step-up** appears. _(Q4)_
4. _(Optional, to fully confirm)_ complete it using the **test guest's** card,
   verify it lands in the **test guest's** MDE, that the test guest can cancel it,
   then cancel. _(Q3)_

Screenshot each screen. This alone tells us whether the liability-clean model
works — **before** investing in any capture rig. If Q2 shows the guest's card
carries the guarantee → the whole dining model is confirmed viable with no card on
Jiminy. If it falls back to the booker's card → rethink (non-guarantee
restaurants, or accept capped liability).

### Tier 2 — network capture for the worker (only after Tier 1 confirms viability, and only when building)

Everything below is for **replicating** the booking programmatically. The obstacle
is **cert pinning**; pick the lowest-friction bypass you can tolerate.

### B1. Set up an intercepting proxy + trusted CA

- Run **mitmproxy** (or Proxyman) on your machine; point the device's Wi-Fi proxy
  at it; install the mitmproxy CA on the device.
- On Android that's not enough for app traffic (since API 24, apps don't trust
  user CAs by default) — you need one of the pinning bypasses below.

### B2. Defeat pinning — easiest viable option first

Ranked by friction:

1. **Android emulator + Frida + objection** _(recommended; no physical device, no
   real jailbreak)_
   - Google-APIs (not Play) x86 emulator image → rootable via `adb root`.
   - Push a `frida-server` matching the emulator arch; run it.
   - `objection -g <mde.package> explore` → `android sslpinning disable`
     (hooks the pinning checks at runtime). Traffic now flows through mitmproxy.
   - Sideload the MDE APK (apkmirror) into the emulator. Log in as the **Jiminy**
     account.
2. **`apk-mitm` patched APK** — repackages MDE with a permissive
   `network_security_config` and strips common pinning. No root/Frida, but fails
   if MDE uses native/low-level pinning; try if Frida setup is a pain.
3. **Jailbroken iOS + SSL Kill Switch 2** — only if you're already an iOS device
   person; more setup than the emulator.

> Reality check: if MDE ships **native-code pinning or Play Integrity / device
> attestation**, the emulator itself may be rejected (rooted/emulator detection).
> If you hit that wall, that _is_ a finding — it strongly implies Verdict B for LL
> and that the incumbents run patched apps on real devices. Record it and stop;
> don't rathole on attestation-defeat.

### B3. Capture + replay

For **dining**: capture the booking write with the **friend set as lead guest**
and the **guarantee resolving to the friend's card** — that exact request (party =
friend, lead-guest id, guarantee source) is what the `wish` worker replicates.
For **LL**: **the user must have already purchased LL Multi Pass and made their
initial selection in MDE** (the F&F grant can't buy or make the first pick — see
plan §6). Capture the **modify/next-selection** write (the rebook-the-instant-a-
slot-frees loop is the real value), record its anatomy, and replay it.

---

### ⛔ Tier 2 RESULT — live attempt 2026-07-07: MDE won't run on a rooted emulator

Actually stood up the full rig and tried it:

- Apple-Silicon Mac → Android 14 (API 34) **arm64 Google-APIs emulator**, `adb root`,
  **frida-server** running, **mitmproxy** on :8080 with its **CA installed** in the
  conscrypt system store, guest proxy set. All working (verified HTTP capture).
- Installed the real **MDE APK** (`com.disney.wdw.android` v8.0, universal) — clean
  `adb install`.
- Launched it → **Disney splash screen, then a hard native crash, restarting in a
  loop (64+ times in seconds).** Logcat shows the app probing `/proc/keys`,
  `/proc/kmsg`, `/proc/iomem`, `/proc/stat` (classic root/tamper detection) right
  before each death. No user-facing message — a silent native abort.
- The environment is trivially detectable on every axis: `ro.kernel.qemu=1`,
  `ro.hardware=ranchu`, `ro.product.model=sdk_gphone64_arm64`,
  `ro.build.tags=dev-keys`, `/system/xbin/su`, `/data/local/tmp/frida-server`.

**Verdict: MDE ships hardened root/emulator/tamper detection and refuses to run on
a rooted emulator.** Fully defeating it means hiding root **and** every QEMU/ranchu
emulator artifact **and** (almost certainly) beating **Play Integrity** server-side
hardware attestation — which local Frida hooks fundamentally cannot do. That is the
attestation-defeat rathole this runbook warns against. **We stopped, as planned.**

**Consequences:**

- On-behalf booking via the MDE **app cannot run on an emulator.** It needs a
  **real, unmodified Android/iOS device** (or a device farm). This is almost
  certainly how the incumbents (Add More Magic et al.) operate — fleets of real
  phones, not emulators. Materially raises the ops cost/complexity of the app-flow
  parts (LL, and liability-clean dining with friend-as-lead-guest).
- **Therefore the feasibility questions (lead guest = friend? whose card
  guarantees?) should be answered by the Tier-1 manual check on a physical
  phone** — no rig, ~5 min. The capture rig only becomes worthwhile later, on real
  hardware, when actually building the worker.

**Rig teardown:** `adb emu kill`; `pkill -f mitmdump`; emulator AVD `jiminy` and
tools remain installed for future real-device capture (mitmproxy still proxies a
real device on the same Wi-Fi). The **MDE APK was placed in `public/anim/`** for
this test — it's a 246 MB binary in a **publicly-served** folder; remove it before
it ships.

### ✅ Deep-link route table — recovered by static decompile 2026-07-07 (enables assisted one-tap)

Decompiled the MDE APK (jadx, `com.disney.wdpro.recommender.core.RecommenderConstants`)
— no device, no running app, pure static analysis of a binary we possess. MDE's
deep-link scheme is **`mdx`** (`WDW_SCHEME = "mdx"`; `[site]` → `mdx` for WDW,
separate scheme for DLR). The parameterized routes:

- **Dining (the one we want):**
  `mdx://dining/reservation?id=<facilityId>&partySize=<n>&dateTime=<ISO8601>&completionDeepLink=<url>`
  Opens the reservation flow **pre-scoped to facility + party size + date/time**,
  and `completionDeepLink` bounces the user back (e.g. `parkfi://booked`).
- **Genie+/LL purchase:** `mdx://magicaccess/genie_plus?onboardedGuestIds=…&completionDeepLink=…`
- **Single Pass purchase:** `mdx://magicaccess/planning/purchase/pass?facilityId=…&dateToSelect=…&productId=…`
- **LL Multi Pass modify:** `mdx://magicaccess/planning/modify/bundle/experience?planId=…`
- **Single Pass modify:** `mdx://magicaccess/planning/modify/singlepass?orderId=…&facilityId=…&selectedDate=…`
- Also: `mdx://finder/home`, `mdx://virtualqueue/redeem`, `mdx://magicaccess/mygenieday?tab=day&displayDate=…`.

**Version-stable (checked v8.0 vs v8.22, 2026-07-07):** across a major version
jump (targetSdk 29→36), the entire deep-link route table is byte-for-byte
identical except one unrelated added constant (`TIP_BOARD_DEEPLINK`). The dining
link, LL purchase/modify, and scheme (`WDW_SCHEME="mdx"`, `DLR_SCHEME="dlr"`) are
unchanged — so v2 builds on a durable interface, not a fragile one.

Cross-platform note: `mdx://` is the on-device custom scheme; MDE also registers
the Branch domain `disneyworld.app.link` and `https` App Links on
`disneyworld.disney.go.com`, so a Branch/https wrapper is the robust cross-platform
(esp. iOS) carrier for the same params. **This makes assisted one-tap real:**
parkfi's cloud already has `facilityId`/`dateTime`/`partySize` from the dine-vas
poller → push a deep link → MDE opens on the exact reservation → user taps
hold/confirm (their account, their card, step-up satisfied naturally) → returns to
parkfi via `completionDeepLink`. **Honest ceiling:** the link _navigates_ the user
to the pre-scoped reservation; it doesn't auto-confirm a held offer, so it's
"land-on-the-right-screen + a couple taps," not zero-touch — but that's the whole
speed win with none of the automation/device-farm/ToS problems.

## Deliverable

A short `research/` note (or an update to this file) stating, per capability:

1. **Verdict A or B**, with the captured request(s) and the replay outcome.
2. If A: the exact request spec the `wish` worker will issue (endpoints, headers,
   body shape, hold→confirm sequencing, how the friend's party is targeted).
3. If B: precisely which session/attestation state is missing — i.e. the spec for
   the headless-client fallback.
4. The friends-list-read endpoint (§5.3) captured alongside step-2 linking.

Then fold the verdict into the `mde-onbehalf-integration-feasibility` memory. That
verdict is the go/no-go for building anything in `plan.md` §4 onward.
