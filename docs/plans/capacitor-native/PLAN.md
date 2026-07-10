# Capacitor Migration + Sensor-Based Coaster Achievements — Implementation Handoff

> ## Implementation status (2026-07-09)
>
> **Shipped & verified (`vp check` 0 errors, `vp test` 267 passing, both native +
> web builds green):**
>
> - **A1** SPA build target — `NATIVE_BUILD=1` gates `tanstackStart` SPA/prerender
>   mode + bakes `VITE_API_BASE`; shell emitted as `dist-native/index.html`
>   (`outputPath`). `getUrl()` + both tRPC links updated; `build:native`/`ios`/
>   `android`/`cap:sync` scripts; `.gitignore`. Native prerender build verified
>   (the #1 risk — root loaders don't crash at build time). Web build unchanged.
> - **A2** Cross-origin bearer auth — `bearer()`+`oneTimeToken()` in auth.ts,
>   native `trustedOrigins`; `src/lib/native-token.ts`; auth-client bearer capture;
>   `src/server/edge/cors-native.ts` (registered in nitro plugins). NOTE: the CORS
>   plugin pushes to `nitroApp.h3["~middleware"]` — the base `H3Core` in this Nitro
>   build has **no public `.use()`** (an earlier `.use()` attempt crashed server
>   init; caught by the native build).
> - **A5** Platform guards — `src/lib/platform.ts`; pwa-register no-ops on native;
>   passkey button hidden on native; token loaded in root `beforeLoad`; sign-out
>   clears the token (`src/lib/sign-out.ts`, 3 call sites).
> - **A6 (partial)** deps installed, `capacitor.config.ts`. DEFERRED: `cap add ios/android` (needs Xcode/Android Studio).
> - **B1** migration `drizzle/20260709120000_coaster_stats_ride_events/` +
>   `coasterStats`/`userRideEvent` in schema.ts + `Source.MANUAL_SEED` (codes.ts,
>   seed.ts). Shared metric type in `src/lib/ride-metrics.ts`.
> - **B3** `src/server/achievements/rides.ts` (`ingestRideTrace` + pure helpers) +
>   `submitRideTrace` mutation + `track_distance_m` join in `computeStats` +
>   `rides.test.ts` (29 tests: plausibility/geofence/resolution/clamp/dedupe/
>   double-count guard).
> - **B4** 6 sensor families + `"g"` unit in `src/lib/achievements.ts` (28 families,
>   97 tiers; invariant test updated).
> - **B5** `services/coaster-stats/` (main.ts + seed.csv, 19 curated rows) +
>   `cron:coaster-stats`. Slugs are best-effort — unresolved rows log & skip; tune
>   `seed.csv` against the live DB.
> - **A3** native OAuth — `src/lib/native-oauth.ts` (system-browser social flow via
>   `signIn.social({ disableRedirect })` + `@capacitor/browser`; `initNativeAuthDeepLinks()`
>   `appUrlOpen` listener → `oneTimeToken.verify`), `src/routes/native-callback.ts`
>   (server route: mints an OTT from the browser-cookie session → bounces to
>   `parkfi://auth-callback?ott=`), native Apple SIWA on iOS (`@capacitor-community/apple-sign-in`
>   → idToken sign-in; Android Apple falls back to the browser flow), `oneTimeTokenClient()`
>   - apple `audience: [servicesId, bundleId]` array, login.tsx branched on `isNative()`.
>     iOS Info.plist `CFBundleURLTypes` + Android `parkfi` intent-filter already wired.
>     `vp check` 0 errors, 267 tests pass. **Not yet device-verified** (G1/G2 in DEPLOY.md).
>
> **Remaining — all need native toolchains / device + Swift/Kotlin, not
> verifiable in this env:**
>
> - **A4** FCM push (`firebase-admin`, `StoredSub` union, native-push.ts,
>   use-push-notifications native path)
> - **B2** `packages/ride-recorder/` custom Capacitor plugin (iOS CMMotion / Android
>   SensorManager)
> - **B6** tracker wiring (arm/disarm monitoring on `inPark`), ride-recap toast,
>   ride-page coaster-stats block + `myRideStats` query
>
> Follow-up when picking up native work: after deploy, run
> `achievements.adminReevaluateAll` so `track_distance_m` credits retroactively.
>
> ---

> Status: planned 2026-07-09. Approved architecture: **bundled SPA shell** (not remote-URL wrapper).
> Scope: Part A = Capacitor shell (iOS/Android), Part B = coaster stats + native sensor achievements.
> Toolchain notes for the implementer: `node` is NOT on PATH — run every CLI through bun
> (`bun vp …`, `bun cap …`, `bun x @capacitor/cli …`). Migrations are hand-written timestamped
> folders under `drizzle/` (no `_journal.json`, never `drizzle-kit generate`). Do not commit —
> the repo owner handles all git operations.

---

## Verified facts this plan relies on

- `@tanstack/react-start` **1.168.19** is installed and supports first-class SPA mode:
  `tanstackStart({ spa: { enabled, maskPath, prerender: {…} } })` — see
  `node_modules/@tanstack/start-plugin-core/dist/esm/schema.d.ts` (~line 201). SPA mode
  prerenders a shell HTML and serves it for every route. So the native build is **an env-gated
  option on the existing plugin**, not a second Vite config.
- tRPC client builds URLs in `getUrl()` at `src/integrations/tanstack-query/root-provider.tsx:45-51`
  (relative `/api/trpc` in browser; `http://localhost:$PORT` during SSR).
- `src/lib/auth.ts` plugin order matters: a comment at line 227-229 says `tanstackStartCookies()`
  **must stay last**. `trustedOrigins` is at line 231 (`DEV ? ["http://localhost:3000"] : []`).
  Active plugins: dash, oAuthProxy, captcha (Turnstile on email flows), haveIBeenPwned,
  lastLoginMethod, twoFactor, passkey, genericOAuth (microsoft-disney), tanstackStartCookies.
- Push subs live in Redis (`src/server/notifications/subscriptions.ts`): blob `push:sub:{sha256(endpoint)[:16]}`
  = `JSON{ userId, endpoint, p256dh, auth }`, set `push:user:{userId}` of hashes.
- Achievement engine: `src/server/achievements/engine.ts` — `computeStats()` (line ~510) =
  `aggregateDayRows(dayRows)` + cross-table counts (`user_attraction`, `pin_have`) + `user_stat`
  rows layered on by key (lines 539-542: `stats[row.stat] = row.value` — any new `StatKey` written
  to `user_stat` automatically flows into evaluation). `bumpEventStat()` (line 576) shows the
  upsert pattern. `evaluateAndUnlock()` (line 550) returns `{ newlyUnlocked, xp, level }` — the
  shape the client toast funnel consumes.
- Catalog: `src/lib/achievements.ts` — `StatKey` union (line 14), `TRACK_EVENTS` allowlist
  (line 42, client-bumpable — sensor keys must NOT go here), `StatUnit = "count" | "meters" | "seconds"`
  (line 51), `fam()` helper (line 73), `formatStatValue` (line 350).
- Migration precedent: `drizzle/20260707130000_user_attraction/migration.sql` — banner comment
  with SAFETY paragraph, `CREATE TABLE IF NOT EXISTS`, quoted identifiers, index statements after.
- `user_attraction` (PK user_id+attraction_id, ride_count int, first/last_ridden_at) is upserted
  by `settleAnchorRow()` (engine.ts ~line 221) when a queue dwell settles.
- Ghost duplicates: un-enriched duplicate attraction rows have `category IS NULL` — every
  proximity/slug resolution must filter `category IS NOT NULL`.
- `achievements.ping` responds with `IngestResult { inPark: boolean, … }` (engine.ts line 53) —
  the client already learns in-park state every ~30 s; use it to arm/disarm sensor monitoring.

---

# Part A — Capacitor shell

## A1. SPA build target (web deploy untouched)

**`vite.config.ts`** — gate on env:

```ts
const isNativeBuild = process.env.NATIVE_BUILD === "1";

// in plugins:
tanstackStart(
  isNativeBuild
    ? { spa: { enabled: true, prerender: { enabled: true, crawlLinks: false } } }
    : {},
),
```

Notes:

- Keep the `nitro()` plugin in both modes — Start's prerender uses the server build to render the
  shell; output remains `.output/public`.
- The Railway pipeline never sets `NATIVE_BUILD`, so the web SSR build is byte-identical.
- API base for native: create **`.env.native`** with `VITE_API_BASE=https://parkfi.sh` and load it
  only for native builds (e.g. `NATIVE_BUILD=1 dotenv -e .env.native -- vp build`, or simpler:
  `define: { "import.meta.env.VITE_API_BASE": JSON.stringify(isNativeBuild ? "https://parkfi.sh" : "") }`
  in the config — the `define` approach avoids a new env file and is recommended).
- **Prerender caveat**: the shell prerender executes `src/routes/__root.tsx` (and its loaders) on
  the build machine. Audit the root loader for DB/env access; guard anything SSR-only. Verify
  early with `NATIVE_BUILD=1 bun vp build` before building anything else on top.

**`src/integrations/tanstack-query/root-provider.tsx`** — replace `getUrl()` (lines 45-51):

```ts
function getUrl() {
  const base = (() => {
    // Native shell: absolute origin baked in at build time.
    if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
    if (typeof window !== "undefined") return "";
    return `http://localhost:${process.env.PORT ?? 3000}`;
  })();
  return `${base}/api/trpc`;
}
```

Both links (`httpLink` and `httpBatchStreamLink`) additionally get:

```ts
headers: () => nativeAuthHeaders(), // {} on web; { authorization: `Bearer …` } on native
```

where `nativeAuthHeaders()` comes from `src/lib/native-token.ts` (A2). Keep the `splitLink`
CACHEABLE_TRPC_PATHS structure exactly as is — cacheable GETs work fine cross-origin (they're
public/unauthenticated by definition, and CF caching still applies).

**`package.json` scripts:**

```jsonc
"build:native": "NATIVE_BUILD=1 vp build && rm -rf dist-native && cp -R .output/public dist-native && cap sync",
"ios": "cap open ios",
"android": "cap open android"
```

(`dist-native/` copy avoids the SPA build clobbering a local SSR `.output/`. Add `dist-native/`
to `.gitignore`.)

## A2. Cross-origin auth — better-auth `bearer` plugin

WebView origin is `capacitor://localhost` (iOS) / `https://localhost` (Android); cookies to
`https://parkfi.sh` are third-party → dropped unpredictably by ITP/WebView. Web keeps cookies;
native uses bearer tokens.

**`src/lib/auth.ts`:**

```ts
import { bearer, oneTimeToken /* + existing */ } from "better-auth/plugins";

// in plugins[], AFTER captcha/2FA etc., BEFORE tanstackStartCookies() (which must stay last):
bearer(),
oneTimeToken(),

// trustedOrigins (line 231) becomes:
trustedOrigins: [
  ...(import.meta.env.DEV ? ["http://localhost:3000"] : []),
  "capacitor://localhost", // iOS WebView origin
  "https://localhost",     // Android WebView origin
  "parkfi://",             // deep-link callback scheme
],
```

How bearer works in better-auth 1.6: on sign-in the response carries the session token in the
`set-auth-token` response header; subsequent requests send `Authorization: Bearer <token>` and
`auth.api.getSession({ headers })` resolves it — **no change needed** in
`src/integrations/trpc/init.ts`.

**New `src/lib/native-token.ts`:**

```ts
import { Preferences } from "@capacitor/preferences";
import { isNative } from "#/lib/platform.ts";

const KEY = "parkfi.session-token";
let cached: string | null | undefined; // undefined = not loaded yet

export async function loadToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  cached = (await Preferences.get({ key: KEY })).value;
  return cached;
}
export async function setToken(token: string): Promise<void> {
  cached = token;
  await Preferences.set({ key: KEY, value: token });
}
export async function clearToken(): Promise<void> {
  cached = null;
  await Preferences.remove({ key: KEY });
}
/** Synchronous header builder for tRPC links (relies on loadToken() having run at app boot). */
export function nativeAuthHeaders(): Record<string, string> {
  return isNative() && cached ? { authorization: `Bearer ${cached}` } : {};
}
```

Call `loadToken()` once at app bootstrap (e.g. in the root route's client entry) before queries
fire. v1 uses `@capacitor/preferences` (unencrypted but app-sandboxed); upgrade path is a
secure-storage plugin — keep the module API identical.

**`src/lib/auth-client.ts`:**

```ts
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_BASE || undefined, // undefined on web = same-origin
  fetchOptions: {
    auth: { type: "Bearer", token: () => cachedTokenOrEmpty() },
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get("set-auth-token");
      if (token) void setToken(token);
    },
  },
  plugins: [
    /* unchanged */
  ],
});
```

Sign-out on native must also `clearToken()`.

**CORS middleware** — new `src/server/edge/cors-native.ts`, registered alongside
`no-cache-html.ts` in the `nitro({ plugins: […] })` list in `vite.config.ts`:

- Applies to paths starting `/api/auth` and `/api/trpc`.
- If `Origin` ∈ {`capacitor://localhost`, `https://localhost`}:
  - `Access-Control-Allow-Origin: <that origin>` (echo, not `*`)
  - `Access-Control-Allow-Methods: GET,POST,OPTIONS`
  - `Access-Control-Allow-Headers: authorization, content-type, trpc-accept, x-trpc-source`
  - `Access-Control-Expose-Headers: set-auth-token`
  - OPTIONS → 204 short-circuit.
- Bearer means **no** `Access-Control-Allow-Credentials` needed (cleaner security posture).
- Watch Cloudflare: ensure the CF cache rule for `/api/trpc/*` GETs doesn't strip/cache-poison
  CORS response headers (vary on Origin or exclude the native origins from cache).

**Known compat risks to test first (in this order):**

1. Email+password sign-in from the native origin — Turnstile `captcha()` runs on email flows and
   may not render/verify from `capacitor://localhost`. If it fails, exempt the native origins in
   the captcha plugin config (or gate email sign-in behind OAuth-only on native v1).
2. 2FA + `lastLoginMethod` (cookie-based) under bearer.
3. Passkeys are origin-bound to parkfi.sh — **hide passkey UI on native** (`isNative()` check in
   the login component). Defer native passkeys.

## A3. OAuth on native — system browser + deep link

Google blocks WebView user agents, so all social login opens the **system browser** and returns
via deep link.

Flow (implement in new `src/lib/native-oauth.ts`):

1. `authClient.signIn.social({ provider, callbackURL: "https://parkfi.sh/native-callback", disableRedirect: true })`
   → returns the provider authorization URL.
2. `Browser.open({ url })` (`@capacitor/browser` → `ASWebAuthenticationSession`/Custom Tabs).
3. OAuth completes on the server (cookie session set in the _browser_ context — irrelevant to the
   app). The `/native-callback` route (new, tiny: `src/routes/native-callback.tsx` or a server
   route) calls the oneTimeToken mint endpoint (`auth.api.generateOneTimeToken` server-side for
   the just-signed-in session) and redirects to `parkfi://auth-callback?ott=<token>`.
4. App listens via `@capacitor/app` `appUrlOpen`, calls `Browser.close()`, then verifies:
   `authClient.oneTimeToken.verify({ token: ott })` → session token → `setToken()`.
5. Register the scheme: `CFBundleURLTypes` with `parkfi` in `ios/App/App/Info.plist`;
   `<intent-filter>` with `<data android:scheme="parkfi"/>` in `AndroidManifest.xml`.
   Upgrade later to universal links (`applinks:parkfi.sh`) — not required for v1.

**Sign in with Apple (App Store requirement when offering third-party login):**

- iOS: `@capacitor-community/apple-sign-in` → native sheet → identity token →
  `authClient.signIn.social({ provider: "apple", idToken: { token, nonce } })` (better-auth
  supports idToken sign-in; verifies audience against `appBundleIdentifier`).
- `APPLE_BUNDLE_ID` env (already read at `src/lib/auth.ts:158`) must equal the Capacitor `appId`.
  **Decision: `appId: "sh.parkfi.app"`** — confirm `APPLE_BUNDLE_ID` matches or add the app id to
  the accepted audiences.
- Login UI (`src/routes/login.tsx`): branch on `isNative()` — Apple button → native plugin;
  Google/Microsoft → system-browser flow; hide passkey.

## A4. Push notifications (web push untouched, FCM added)

Server storage — **`src/server/notifications/subscriptions.ts`**: widen the stored blob to a
discriminated union, keyed the same way (`endpointHash(endpoint)` for webpush,
`endpointHash(token)` for native):

```ts
export type StoredSub =
  | ({ kind?: "webpush"; userId: string } & PushSub) // kind absent = legacy web push
  | { kind: "fcm"; userId: string; token: string; platform: "ios" | "android" };
```

`addSub`/`removeSub`/`getSubsForUser` take/return `StoredSub`; existing blobs (no `kind`) parse as
webpush — zero migration.

- tRPC `notifications.subscribe`/`unsubscribe` inputs become a discriminated union
  (`{ kind: "webpush", endpoint, p256dh, auth } | { kind: "fcm", token, platform }`, with the
  legacy non-kinded shape still accepted → webpush).
- New **`src/server/notifications/native-push.ts`**: `firebase-admin` messaging. Route APNs
  **through FCM** (single sender for both platforms). Env: `FIREBASE_SERVICE_ACCOUNT_JSON`.
  Map the payload the SW currently receives (title/body/url/tag) onto FCM notification + data.
- Fan-out in `services/notifications/main.ts` (and `src/server/notifications/push.ts` callers):
  switch on `kind`; treat FCM error `messaging/registration-token-not-registered` exactly like
  the existing web-push 410 → `removeStale`.
- Client — **`src/hooks/use-push-notifications.ts`**: branch at the top of the support-detection
  effect and in `subscribe`/`unsubscribe`:
  - Native path: `PushNotifications.requestPermissions()` → `register()` → `registration` event
    yields the token → `subscribeM.mutate({ kind: "fcm", token, platform })`. `supported = true`
    on native regardless of `VAPID_PUBLIC_KEY`.
  - Keep the existing bind-on-login effect; for native it re-binds the FCM token to the account
    (same idempotent upsert).
  - Foreground taps: listen `pushNotificationActionPerformed` → router.navigate(path from
    `data.url`) — which requires notification payload URLs to be **path-relative** (audit
    `src/server/notifications/deepLinkRedirect.ts` and payload construction).
- iOS: enable Push capability in Xcode, upload APNs auth key to the Firebase project.
  Android: `google-services.json` under `android/app/`.

## A5. Platform detection & guards

**New `src/lib/platform.ts`:**

```ts
import { Capacitor } from "@capacitor/core";
export const isNative = (): boolean => Capacitor.isNativePlatform();
export const nativePlatform = (): "ios" | "android" | "web" =>
  Capacitor.getPlatform() as "ios" | "android" | "web";
```

- `src/components/pwa-register.tsx`: `if (isNative()) return null;` before SW registration
  (no service worker in the native shell; the stale-chunk reload logic is also irrelevant there).
- Hide PWA install prompts and passkey buttons on native.
- Geolocation (`src/hooks/use-geolocation.ts`) and heading (`src/hooks/use-device-heading.ts`)
  work as-is in the Capacitor WebView (permissions bridge to native prompts). Required
  Info.plist keys: `NSLocationWhenInUseUsageDescription`, `NSMotionUsageDescription` (for
  DeviceOrientation + Part B). AndroidManifest: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
  and later `HIGH_SAMPLING_RATE_SENSORS` (Android 12+, needed for 50 Hz IMU in Part B).
- Defer `@capacitor/geolocation` and background location — not needed while the foreground
  WebView APIs suffice.

## A6. Repo layout, deps, config

**`capacitor.config.ts` (root):**

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "sh.parkfi.app",
  appName: "ParkFi",
  webDir: "dist-native",
  // Live-reload dev: CAP_SERVER_URL=http://<mac-lan-ip>:3000 bun cap run ios
  ...(process.env.CAP_SERVER_URL
    ? { server: { url: process.env.CAP_SERVER_URL, cleartext: true } }
    : {}),
};
export default config;
```

Dev loop: `bun vp dev` (normal SSR dev server) + `CAP_SERVER_URL` pointing the shell at it —
auth is same-origin in that mode, so bearer/CORS paths are exercised only against prod-style
builds; test both.

**Install (exact packages):**
`@capacitor/core @capacitor/cli @capacitor/ios @capacitor/android @capacitor/browser
@capacitor/app @capacitor/preferences @capacitor/push-notifications
@capacitor-community/apple-sign-in` + server `firebase-admin`.
Then `bun cap add ios && bun cap add android`. Commit `ios/` and `android/` (gitignore
`ios/App/Pods`, `android/.gradle`, `android/app/build`, `dist-native/`).

CI/signing: manual Xcode (TestFlight) + Android Studio (internal track) first; fastlane later.

---

# Part B — Coaster stats + sensor achievements

## B1. Schema + migration

New folder **`drizzle/20260709120000_coaster_stats_ride_events/migration.sql`** (adjust timestamp
to creation time; match the banner/SAFETY comment style of
`drizzle/20260707130000_user_attraction/migration.sql`):

```sql
-- ============================================================================
-- Coaster achievements: static per-coaster stats + per-ride event log.
--
-- coaster_stats: 1:1 enrichment side table on attractions (attraction_meta
-- precedent) — published figures (track length, official top speed, drops,
-- inversions). Sparse: only coasters get rows. Seeded manually (services/
-- coaster-stats); RCDB has no API.
--
-- user_ride_event: one row per verified ride (dwell-settled and/or sensor-
-- verified) with on-device-computed metrics. user_attraction keeps collapsing
-- to counts; this is the per-ride fact log it never had.
--
-- SAFETY: purely additive. Two new tables, FKs to existing user (CASCADE),
-- attractions, parks, ref_source. Nothing existing is touched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "coaster_stats" (
  "attraction_id"  bigint PRIMARY KEY REFERENCES "attractions"("id"),
  "track_length_m" double precision,
  "top_speed_kmh"  double precision,   -- official/published figure, never sensor-derived
  "drop_height_m"  double precision,
  "max_height_m"   double precision,
  "inversions"     smallint,
  "coaster_type"   text,               -- 'steel' | 'wooden' | 'hybrid'
  "manufacturer"   text,
  "opened_year"    smallint,
  "source"         smallint NOT NULL REFERENCES "ref_source"("id"),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_ride_event" (
  "id"            bigserial PRIMARY KEY,
  "user_id"       text   NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "attraction_id" bigint NOT NULL REFERENCES "attractions"("id"),
  "park_id"       bigint NOT NULL REFERENCES "parks"("id"),
  "ridden_at"     timestamptz NOT NULL,
  "source"        text NOT NULL,        -- 'dwell' | 'sensor' | 'sensor+dwell'
  "metrics"       jsonb,                -- RideMetrics; null for dwell-only rides
  "trace"         jsonb,                -- optional ~4 Hz downsampled audit trace (≤600 samples)
  "created_at"    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "user_ride_event_user_idx"
  ON "user_ride_event" ("user_id", "ridden_at" DESC);
CREATE INDEX IF NOT EXISTS "user_ride_event_user_attraction_idx"
  ON "user_ride_event" ("user_id", "attraction_id");
```

Mirror both tables in `src/db/schema.ts` (`coasterStats` next to `attractionMeta`,
`userRideEvent` next to `userAttraction`), matching existing naming/relations style. Check how
`ref_source` values are defined (enum table) and add/reuse a `MANUAL_SEED`-style source row.

**Aggregates — no new table.** New `user_stat` keys (server-written only):
`coaster_drops`, `airtime_seconds`, `max_g_best`, `inversions_ridden`, `vertical_m`.
They flow into `computeStats` automatically via the existing layering loop (engine.ts:539-542).
`max_g_best` is a high-water mark → upsert with
`set: { value: sql\`GREATEST(${userStat.value}, ${v})\` }`instead of`+`.
**`track_distance_m`is NOT a counter** — compute it in`computeStats` as a third cross-table
aggregate so it's retroactive when stats get seeded later:

```ts
// engine.ts computeStats(), after the pinHave count:
const [trackRow] = await db
  .select({
    m: sql<number>`coalesce(sum(${userAttraction.rideCount} * ${coasterStats.trackLengthM}), 0)`,
  })
  .from(userAttraction)
  .innerJoin(coasterStats, eq(coasterStats.attractionId, userAttraction.attractionId))
  .where(eq(userAttraction.userId, userId));
stats.track_distance_m = trackRow?.m ?? 0;
```

## B2. Custom Capacitor plugin `ride-recorder`

Location: **`packages/ride-recorder/`** (first package dir in the repo; keep it out of the app's
`src/`). Standard Capacitor plugin layout: `package.json`, `src/definitions.ts`, `src/index.ts`,
`src/web.ts` (no-op stub: `startMonitoring` rejects with "unavailable"), `ios/Sources/…`
(Swift), `android/src/main/java/…` (Kotlin). Registered as a local file dependency
(`"ride-recorder": "file:packages/ride-recorder"`) so `cap sync` picks it up.

**`src/definitions.ts` (the contract — server Zod schema must mirror `RideMetrics`):**

```ts
export interface RideMetrics {
  startedAt: string; // ISO
  endedAt: string;
  durationS: number;
  dropCount: number;
  airtimeS: number; // cumulative seconds |a| < 0.4 g
  maxG: number; // peak of 0.3–0.5 s windowed-median |a|/9.81
  inversions: number;
  verticalM: number; // Σ|Δaltitude| (barometric), 0 if !baroAvailable
  maxDropM: number; // largest single barometric descent
  estTopSpeedKmh: number | null; // 3.6·√(2·9.81·maxDropM) — ALWAYS an estimate, label it so
  baroAvailable: boolean;
  gyroAvailable: boolean;
  confidence: number; // 0..1 ride-signature score
}

export interface RideTrace {
  metrics: RideMetrics;
  /** ~4 Hz downsample for server plausibility checks; hard cap 600 samples. */
  samples?: Array<{ t: number; aMag: number; altRel: number | null }>;
}

export interface RideRecorderPlugin {
  requestPermissions(): Promise<{ motion: "granted" | "denied" | "prompt" }>;
  /** Arm passive detection. Cheap: accel-only ~10 Hz until variance trigger. */
  startMonitoring(opts?: { imuHz?: number; baroHz?: number }): Promise<void>;
  stopMonitoring(): Promise<void>;
  /** Manual "I'm on the ride" affordance. */
  startRecording(): Promise<void>;
  stopRecording(): Promise<RideTrace | null>;
  addListener(event: "rideStarted", cb: () => void): Promise<PluginListenerHandle>;
  addListener(event: "rideDetected", cb: (trace: RideTrace) => void): Promise<PluginListenerHandle>;
}
```

**Platform implementation notes:**

- iOS: `CMMotionManager.deviceMotion` @ 50 Hz (`deviceMotionUpdateInterval = 0.02`), reference
  frame `.xArbitraryZVertical` — gives `userAcceleration` (gravity-removed), `gravity`, and
  `attitude` for free. `CMAltimeter.startRelativeAltitudeUpdates` (~1 Hz, meters directly).
  Requires `NSMotionUsageDescription`. Foreground-alive is enough while the location tracker's
  background mode keeps the app running.
- Android: `SensorManager` — `TYPE_LINEAR_ACCELERATION` + `TYPE_GRAVITY` + `TYPE_GYROSCOPE` at
  `SENSOR_DELAY_GAME` (~50 Hz), `TYPE_PRESSURE` ~2 Hz →
  `SensorManager.getAltitude(PRESSURE_STANDARD_ATMOSPHERE, p)`; use **relative** deltas only
  (absolute is weather-biased). Foreground service while monitoring. Manifest:
  `HIGH_SAMPLING_RATE_SENSORS` (API 31+). Many midrange phones lack a barometer →
  `baroAvailable=false`, baro-derived metrics zero/null out, confidence reflects it.
- **Compute metrics on device; upload the compact summary** (+optional 10–50 KB trace). Never
  ship raw 50 Hz streams.
- Battery: monitoring is armed by the JS layer only while in-park (see B6). Monitoring mode =
  accel-only 10 Hz; escalate to full 50 Hz IMU + baro on trigger. Keep a **10 s pre-trigger ring
  buffer** so the lift hill / launch isn't lost.

**Detection algorithm spec (all orientation-independent — magnitude + gravity-relative frames):**

| Metric         | Rule                                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------- |
| Ride start     | rolling 5 s window: `var(                                                                                                                                                              | a    | ) > 1.5 (m/s²)²` sustained ≥3 s                                                                         |
| Ride end       | variance < ~0.3 for ≥20 s, or 6 min hard cap; discard sessions <20 s                                                                                                                   |
| Drop           | baro `dz/dt < −4 m/s` sustained ≥0.7 s AND `                                                                                                                                           | a    | < 0.6 g` ≥0.3 s within ±1 s; merge drops <2 s apart; no baro → low-g ≥0.8 s fallback (lower confidence) |
| Airtime        | Σ time `                                                                                                                                                                               | a    | < 0.4 g`, 100 ms enter/exit hysteresis                                                                  |
| Max G          | max over session of windowed **median** (0.3–0.5 s) of `                                                                                                                               | a    | /9.81` (kills impact spikes)                                                                            |
| Inversion      | gravity vector (iOS `deviceMotion.gravity` / Android `TYPE_GRAVITY`) deviates >150° from 5 s trailing baseline AND gyro angular rate >90°/s through the flip (rejects pocket fumbling) |
| Vertical m     | Σ                                                                                                                                                                                      | Δalt | of 1 s-EMA-smoothed relative altitude                                                                   |
| Est. top speed | `3.6·√(2·9.81·maxDropM)`; server prefers `coaster_stats.top_speed_kmh` when present; UI always labels "est."                                                                           |
| Confidence     | weighted: variance profile ✚ ≥1 low-g event ✚ baro range >3 m ✚ duration 30 s–4 min. `<0.5` → don't auto-submit                                                                        |

Documented false-positive handling (plugin README): elevators (baro change, no accel variance),
buses/monorail (variance, no low-g, no attraction anchor), phone drops (single spike — median
window kills), pocket fumbling (gyro-rate gate).

## B3. Server ingestion

**New `src/server/achievements/rides.ts`** — `ingestRideTrace(userId, input)`; keeps `engine.ts`
focused on the ping machine. **New mutation in `src/integrations/trpc/routers/achievements.ts`:**

```ts
submitRideTrace: protectedProcedure
  .input(rideTraceSchema) // zod mirror of RideTrace with plausibility bounds baked in
  .mutation(({ ctx, input }) => ingestRideTrace(ctx.userId, input)),
```

Zod bounds (reject, don't clamp, at the schema level): `maxG ∈ [0, 8]`,
`0 < durationS ≤ 360`, `airtimeS ≤ durationS`, `dropCount ≤ 20`, `inversions ≤ 15`,
`verticalM ≤ 600`, `samples.length ≤ 600`, `confidence ∈ [0,1]`, timestamps parseable and
`endedAt − startedAt ≈ durationS` (±10%).

`ingestRideTrace` flow:

1. **Geofence cross-check**: read `user_geo_state` for the user; require a ping `at` within
   ~15 min. Resolve attraction: prefer the state's anchor attraction id; else nearest **active**
   attraction within ~120 m of the state's last lng/lat, filtered `category IS NOT NULL` (ghost
   dupes) — reuse `getAttractions(parkId)` from engine.ts (export it). No resolution →
   `TRPCError PRECONDITION_FAILED` ("couch shake" rejection).
2. **coaster_stats clamp** (when the attraction has a row): reject if
   `metrics.inversions > stats.inversions + 2` or `verticalM > 3 × drop_height_m` etc. Set
   `source = 'sensor+dwell'` if the geo state is/was anchored to the same attraction, else `'sensor'`.
3. **Dedupe**: existing `user_ride_event` for (user, attraction) with `ridden_at` within ±5 min
   of `metrics.startedAt` → return existing (idempotent), don't double-write.
4. **Write** `user_ride_event` (metrics + optional trace).
5. **Credit** — the double-count guard (trickiest part, unit-test hard):
   - If the geo state is **currently anchored** to the same attraction, the dwell settle path
     (`settleAnchorRow`, engine.ts ~221) will credit `user_attraction` + `user_park_day.rides`
     when the user exits the geofence — so the sensor path must NOT also credit ride count.
     Only attach metrics.
   - Otherwise (no anchor / different attraction): upsert `user_attraction` (same
     `onConflictDoUpdate` shape as `settleAnchorRow`) and bump `user_park_day.rides` for the
     park-local day.
   - Then bump `user_stat`: `coaster_drops += dropCount`, `airtime_seconds += round(airtimeS)`,
     `inversions_ridden += inversions`, `vertical_m += round(verticalM)`, and
     `max_g_best = GREATEST(value, maxG)`.
6. `return evaluateAndUnlock(userId)` — same `{ newlyUnlocked, xp, level }` shape the client
   toast funnel already consumes (see `ping`).

Also modify `computeStats` in `engine.ts` with the `track_distance_m` join from B1.

**Tests**: vitest unit tests for `ingestRideTrace` fixtures — plausibility rejection, geofence
rejection, dedupe idempotency, anchored-vs-unanchored credit paths, GREATEST upsert. The pure
detection math (if any lands in TS for the web stub) tests like `aggregateDayRows` does.

## B4. Catalog additions (`src/lib/achievements.ts`)

- Extend `StatKey` with a new comment group:

```ts
  // sensor-derived (server-written via submitRideTrace — NOT in TRACK_EVENTS)
  | "coaster_drops"
  | "airtime_seconds"
  | "max_g_best"
  | "inversions_ridden"
  | "vertical_m"
  | "track_distance_m"
```

- Do **not** touch `TRACK_EVENTS` (that allowlist is client-bumpable via `achievements.track`).
- `StatUnit`: add `"g"`; `formatStatValue` case: `` `${value.toFixed(1)} g` ``.
- Six new families appended to `ACHIEVEMENTS` (update the "22 families, 77 tiers" count comment).
  Thresholds/XP follow neighboring ladders (50→800 XP); names match the house voice ("The couch
  misses you" register). Suggested (polish copy in place):

```ts
fam("drops", "Gravity's Customer", "coaster_drops", "count", "🕳️", [
  [1, 50, "Stomach, Meet Floor", "Your first sensor-verified drop."],
  [25, 100, "Freefall Frequent Flyer", "Twenty-five drops. Your organs have a commute."],
  [100, 200, "Terminal Velocity Fan Club", "One hundred drops survived, allegedly enjoyed."],
  [500, 400, "Down Is a Direction", "Five hundred drops. The ground gave up on you."],
]),
fam("airtime", "Certified Floaty", "airtime_seconds", "seconds", "🪶", [
  [10, 75, "Brief Weightlessness", "Ten cumulative seconds out of your seat."],
  [60, 150, "Minute of Levitation", "A full minute of airtime, collected one hill at a time."],
  [300, 300, "Part-Time Astronaut", "Five minutes weightless. NASA called; it went to voicemail."],
]),
fam("gforce", "G Whiz", "max_g_best", "g", "🧲", [
  [3, 100, "Pulling Threes", "3 g sustained. Your cheeks noticed."],
  [4, 200, "Fighter Pilot Adjacent", "4 g. Blink twice if you can."],
  [4.5, 400, "Certified Heavy", "4.5 g. Briefly, you weighed twice as much and loved it."],
]),
fam("inversions", "Upside-Down Economy", "inversions_ridden", "count", "🙃", [
  [1, 75, "First Flip", "The sky and ground traded places. You allowed it."],
  [25, 150, "Frequent Flipper", "Twenty-five inversions. Loose change fears you."],
  [100, 300, "Corkscrew Connoisseur", "One hundred flips. Your inner ear filed a complaint."],
]),
fam("vertical", "Elevation Enjoyer", "vertical_m", "meters", "⛰️", [
  [500, 75, "Foothill", "500 vertical meters of coaster hills."],
  [2_000, 150, "Alpine Start", "2,000 m of climb and plunge."],
  [8_849, 400, "Everest, Cumulatively", "You've done Everest — 20 meters at a time."],
]),
fam("trackmiles", "Rails to Nowhere", "track_distance_m", "meters", "🛤️", [
  [5_000, 50, "Short Line", "Your first 5 km of track."],
  [25_000, 100, "Commuter Rail", "25 km of coaster track under your seat."],
  [100_000, 200, "Main Line", "100 km. Officially a rail network."],
  [500_000, 400, "Transcontinental", "500 km of track. The railroad barons salute you."],
]),
```

Additive + deployable dark (no stats exist → thresholds unsatisfied). After deploy, run
`achievements.adminReevaluateAll` per its doc comment — note it collects users from
`userParkDay`/`userStat`/`pinHave`, which covers everyone `track_distance_m` could retroactively
credit (they necessarily have park-day rows).

## B5. Coaster-stats seed pipeline

- **New `services/coaster-stats/main.ts`** mirroring `services/geo/main.ts` structure (dotenv →
  telemetry → `runStep` per step → flush) + package.json script `"cron:coaster-stats"`.
- **`services/coaster-stats/seed.csv`** — hand-curated (~40 rows WDW + UOR):
  `park_slug,attraction_slug,track_length_m,top_speed_kmh,drop_height_m,max_height_m,inversions,coaster_type,manufacturer,opened_year`.
  Facts sourced from RCDB pages (facts aren't copyrightable; there is no RCDB API — do not scrape
  programmatically, just curate).
- Job: resolve `attraction_id` by `(parks.slug, attractions.slug)` join with
  `attractions.category IS NOT NULL` and `active = true`; log-and-skip unresolved slugs; upsert
  `coaster_stats` with the manual `ref_source`. Idempotent (`onConflictDoUpdate` by PK).
- v1.5 (optional): `adminUpsertCoasterStats` mutation in the achievements router for one-off edits.

## B6. Client wiring + UI

- **`src/components/achievements/achievement-tracker.tsx`**: it already calls
  `achievements.ping` (~30 s cadence) and receives `IngestResult.inPark`. Add (native-only,
  dynamic import so web bundles don't grow):
  - `inPark` false→true: `RideRecorder.requestPermissions()` (once) → `startMonitoring()`.
  - true→false or tracker stop: `stopMonitoring()`.
  - `rideDetected` listener → `submitRideTrace` mutation → pipe the returned
    `{ newlyUnlocked, xp, level }` through the same `showUnlockToasts` funnel the ping path uses.
- **New `src/components/achievements/ride-recap-toast.tsx`**: post-ride summary — e.g.
  "2 drops · 4.1 g · 8 s airtime · speed est. 96 km/h" (estTopSpeedKmh always labeled "est.";
  prefer `coaster_stats.top_speed_kmh` when the server echoes it back).
- **Ride detail page** (the route behind `og.ride.$parkSlug.$rideSlug`): coaster stats block
  (length/speed/drop/inversions/type/manufacturer/year) when `coaster_stats` exists; signed-in
  users additionally see personal bests — new small query `achievements.myRideStats({ attractionId })`
  reading `user_ride_event` (best maxG, total drops, ride count, last ridden).
- Achievements page renders the new families automatically from the catalog — no changes.

---

## Ordering

1. **A1–A2**: SPA build flag + `getUrl` + bearer/CORS/native-token (testable: prod-style build in simulator, email sign-in — flushes out the Turnstile risk immediately)
2. **A6**: capacitor.config, `cap add ios/android`, first simulator run, Info.plist/manifest permissions
3. **A3** native OAuth + Apple SIWA · **A4** FCM push · **A5** guards
4. **B1** migration + schema.ts · **B4** catalog (ship dark) · **B5** seed service → `track_distance_m` goes retroactively live via the computeStats join
5. **B3** ingestion + unit tests (fixture-driven; no native code needed)
6. **B2** ride-recorder plugin (longest lead; iOS and Android can go in parallel)
7. **B6** tracker wiring + recap toast + ride-page stats

## Key risks

- **Shell prerender** executes root loaders at build time — verify `NATIVE_BUILD=1 bun vp build` first thing.
- **Turnstile captcha** on email flows from `capacitor://localhost` — likely needs a native exemption; test in step 1.
- **Bearer × cookie-plugin coexistence** (2FA, lastLoginMethod) — test sign-in matrix early.
- **Ride double-crediting** (dwell settle vs sensor submit racing on the same anchored attraction) — the guard in B3 step 5 needs deliberate unit tests.
- **Barometer absence** on midrange Android → degraded drop/vertical metrics; surfaced via `baroAvailable` + confidence, families still progress.
- **Sensor spoofing**: metrics are client-computed; mitigations = geofence cross-check, Zod bounds, coaster_stats clamps, optional trace audit. Acceptable for low-stakes achievements.
- **Apple review**: native SIWA required (planned, A3); account deletion already exists (auth.ts `deleteUser`) ✓.
- **CF cache × CORS**: `/api/trpc` GET cache rule must vary on Origin or skip native origins.

## Verification

- `bun vp check && bun vp test` after each phase.
- `NATIVE_BUILD=1 bun vp build` → inspect `dist-native/index.html`; plain `bun vp build` output unchanged.
- Simulator (`bun cap run ios`): email sign-in via bearer (watch for `set-auth-token`), geolocation prompt, achievements page, push token registration (real APNs via TestFlight).
- Ingestion: vitest fixtures for `ingestRideTrace` (plausibility/geofence/dedupe/double-count); curl a synthetic trace at a dev server.
- Plugin field tests before park validation: car ride → rejected/low-confidence; elevator/stairs → no ride; then an actual coaster.
