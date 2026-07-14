# Native Testing & Initial Deploy — iOS + Android

> Companion to [PLAN.md](./PLAN.md). This covers going from the current tree
> (editor-side spine shipped; `ios/`+`android/` not yet generated) to a build
> running on real devices and up on TestFlight + Google Play internal testing.
>
> **Scope status (updated 2026-07-14):** the native tail (A3 OAuth, A4 push, B2
> sensor plugin, B6 wiring) **is implemented** — see PLAN.md's status block — but
> **not device-verified**. The G1–G8 gates below are the remaining work: they need
> real hardware, Firebase/APNs artifacts live, and (G6–G8) a park visit. See also
> [FOLLOWUP.md](./FOLLOWUP.md) for audit findings that should land before the
> G6–G8 field runs (notably the W1 ride-signature gate).
>
> Toolchain reminder: `node` isn't on PATH — run CLIs via `bun` (`bun cap …`).
> Never commit; the repo owner handles git.

---

## Phase 0 — One-time accounts & tooling

**Accounts (do these first; approvals can take hours–days):**

- Apple Developer Program membership ($99/yr) — needed for a real-device build and TestFlight.
- App Store Connect: create the app record (bundle id **`sh.parkfi.app`** — must match
  `capacitor.config.ts` and `APPLE_BUNDLE_ID` in [auth.ts](../../src/lib/auth.ts:160)).
- Google Play Console account ($25 one-time). Create the app; note the package name
  **`sh.parkfi.app`**.
- Firebase project (for A4 push later): add an iOS app + Android app, download
  `GoogleService-Info.plist` and `google-services.json`. Upload an APNs auth key (.p8) to
  Firebase → Cloud Messaging. Skip until you start A4.

**Local tooling (macOS):**

- Xcode (latest stable) + Command Line Tools; open once to accept the license and install
  the iOS platform. A physical iPhone + a paid signing team for device installs.
- Android Studio + SDK (API 34+), one AVD (emulator) image, and a physical Android device
  with USB debugging for the barometer/IMU tests (emulators don't emit real sensor data).
- CocoaPods (`brew install cocoapods`) — Capacitor iOS uses it.
- Confirm `bun cap --version` resolves (the `@capacitor/cli` dep is already installed).

---

## Phase 1 — Generate the native projects (finishes deferred A6)

```bash
# 1. Produce the SPA shell + sync it into native projects.
bun run build:native          # NATIVE_BUILD=1 vp build → dist-native → cap sync
                              # (first run has no ios/android yet — see step 2)

# 2. Add the platforms (one-time; commit ios/ and android/ afterward).
bun cap add ios
bun cap add android

# 3. Re-sync now that platforms exist.
bun run cap:sync
```

Add to `.gitignore` (if not already): `ios/App/Pods/`, `ios/App/App/public/`,
`android/.gradle/`, `android/app/build/`, `android/app/src/main/assets/public/`,
`dist-native/`. Commit the rest of `ios/` and `android/`.

### 1a. Native config that MUST be wired before first run

**iOS — `ios/App/App/Info.plist`:**

- `NSLocationWhenInUseUsageDescription` — "ParkFi uses your location to track park visits and
  detect the rides you experience." (geolocation + heading already used by the web hooks)
- `NSMotionUsageDescription` — "ParkFi reads motion sensors to measure your coaster rides —
  drops, airtime, and G-forces." (needed for B2; harmless to add now)
- URL scheme for OAuth deep-link (A3): `CFBundleURLTypes` → `CFBundleURLSchemes` = `["parkfi"]`

**Android — `android/app/src/main/AndroidManifest.xml`:**

- `<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>` +
  `ACCESS_COARSE_LOCATION`
- `<uses-permission android:name="android.permission.HIGH_SAMPLING_RATE_SENSORS"/>` (API 31+,
  for 50 Hz IMU in B2)
- `<uses-feature android:name="android.hardware.sensor.barometer" android:required="false"/>`
  (don't exclude barometer-less phones from the store)
- Deep-link intent-filter on the main activity with `<data android:scheme="parkfi"/>` (A3)

**Both:** verify `appId`/package is `sh.parkfi.app` in the generated projects (Xcode target
Bundle Identifier; `android/app/build.gradle` `applicationId`).

### 1b. Smoke-test the shell before touching anything else

```bash
bun cap run ios        # pick a simulator
bun cap run android    # pick the AVD
```

Expected: the app boots to the ParkFi shell, the SPA hydrates, and it talks to
`https://parkfi.sh` (baked `VITE_API_BASE`). If it's blank, check the shell landed at
`dist-native/index.html` and DevTools (Safari → Develop → Simulator; Chrome → chrome://inspect).

---

## Phase 2 — Manual test matrix

Run each on **simulator/emulator first**, then a **physical device**. Sensor tests are
device-only. Use Safari Web Inspector (iOS) and `chrome://inspect` (Android) to watch the
WebView console + network.

### ✅ Testable now (shell + A1/A2/A5)

| #   | Area                    | Steps                                       | Pass criteria                                                                                                                                                  |
| --- | ----------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Shell boot / SSR→SPA    | Cold launch                                 | App loads offline-shell, hydrates, reaches parkfi.sh; no white screen                                                                                          |
| T2  | Bearer capture          | Email+password sign-in                      | Network shows `set-auth-token` response header; token persisted (Preferences); `authClient.useSession()` populated                                             |
| T3  | Bearer replay           | Kill + relaunch app                         | Still signed in (token rehydrated in root `beforeLoad`); no re-login                                                                                           |
| T4  | CORS preflight          | Trigger a tRPC mutation (e.g. create alert) | OPTIONS → 204 with `access-control-allow-origin: capacitor://localhost` (iOS) / `https://localhost` (Android) + `access-control-max-age: 86400`; POST succeeds |
| T5  | ⚠️ Turnstile risk       | Email sign-up / password reset              | Captcha renders + verifies from the native origin. **If it fails**, this is the known risk — exempt native origins or gate email behind OAuth on native        |
| T6  | Sign-out                | Sign out                                    | Token cleared (Preferences empty); session gone; all 3 sign-out call sites work                                                                                |
| T7  | Passkey hidden          | Login screen on native                      | Passkey button absent (origin-bound, deferred)                                                                                                                 |
| T8  | No service worker       | Inspect                                     | `pwa-register` no-ops; no SW registered; no stale-chunk logic firing                                                                                           |
| T9  | Geolocation             | Tap locate; enter/deny permission           | Native permission prompt appears; `watchPosition` streams; achievement ping fires (~30 s); `inPark` toggles near a geofence                                    |
| T10 | Heading                 | Move device                                 | Map marker cone orients (magnetometer via DeviceOrientation)                                                                                                   |
| T11 | Achievements page       | Open achievements                           | 28 families / 97 tiers render incl. the 6 sensor families (dark, thresholds unmet)                                                                             |
| T12 | Deep-link nav (partial) | Trigger a notification-style URL in-app     | Path-relative URLs route in-app (no origin jump)                                                                                                               |

### ⛔ GATED — needs the native tail implemented first

| #   | Area                   | Blocks on | Test once built                                                                               |
| --- | ---------------------- | --------- | --------------------------------------------------------------------------------------------- |
| G1  | Google/Microsoft OAuth | A3        | System browser opens; `parkfi://auth-callback?ott=…`; oneTimeToken → bearer; lands signed-in  |
| G2  | Apple SIWA             | A3        | Native SIWA sheet → idToken → session; audience = `sh.parkfi.app`                             |
| G3  | Push register          | A4        | `PushNotifications.register()` yields FCM token; stored as `{kind:"fcm"}`; test push delivers |
| G4  | Push tap routing       | A4        | `pushNotificationActionPerformed` navigates to the payload path                               |
| G5  | Sensor arm/disarm      | B2+B6     | Monitoring starts on `inPark:true`, stops on false                                            |
| G6  | Ride detection         | B2        | Real coaster → `rideDetected` with plausible drops/airtime/maxG                               |
| G7  | Ingestion              | B3+B6     | `submitRideTrace` → geofence check → `user_ride_event` write → unlock toast                   |
| G8  | False-positive reject  | B2+B3     | Car ride/elevator → low confidence or `PRECONDITION_FAILED`, no credit                        |

### Field protocol for sensor validation (G6–G8, device-only)

Before any park trip, on a physical device:

1. **Elevator / stairs** → expect _no_ ride detected (baro change without accel variance).
2. **Car or bus ride** → expect low confidence or server rejection (no attraction anchor).
3. **Then a real coaster** → sanity-check drops/airtime/maxG against the coaster's published
   `coaster_stats`; confirm `estTopSpeedKmh` is labeled "est." everywhere it appears.

---

## Phase 3 — Initial store deploys

Ship the **shell build first** (auth + geolocation + achievements) to lock down signing and
store review, then re-submit as native features land.

### iOS → TestFlight

1. `bun run build:native` then `bun cap open ios`.
2. In Xcode: select the **App** target → Signing & Capabilities → your Team; confirm Bundle ID
   `sh.parkfi.app`. Add the **Push Notifications** and **Background Modes → Location updates**
   capabilities now (even if unused yet) to avoid a re-provision later.
3. Set version (`CFBundleShortVersionString`) + build number (`CFBundleVersion`).
4. Product → Archive → Distribute App → App Store Connect → Upload.
5. App Store Connect → TestFlight: add internal testers (no review) or external (needs a
   lightweight review). Fill export-compliance (standard HTTPS = usually "no" to custom crypto).
6. Testers install via the TestFlight app.

**iOS review gotchas:** Apple requires **native Sign in with Apple** (G2/A3) _if_ you offer any
third-party login — so the OAuth tail must be in before the public App Store release (TestFlight
internal is fine without it). Account deletion is required and already implemented
(`deleteUser` in auth.ts) ✓.

### Android → Google Play internal testing

1. Set `versionCode`/`versionName` in `android/app/build.gradle`.
2. Create an upload keystore (one-time):
   `keytool -genkey -v -keystore parkfi-upload.keystore -alias parkfi -keyalg RSA -keysize 2048 -validity 10000`
   — store it and its passwords in your secrets manager, **never commit it**. Wire it into a
   `signingConfigs.release` block (or `keystore.properties` gitignored).
3. `bun cap open android` → Build → Generate Signed Bundle/APK → **Android App Bundle (.aab)** →
   release signing.
4. Play Console → your app → Testing → **Internal testing** → create release → upload the `.aab`
   → add testers by email → share the opt-in link.
5. Complete the required Play forms before promotion: Data safety (declare location + any
   sensor/motion use), privacy policy URL, content rating, target audience.

**Play gotchas:** enroll in **Play App Signing** (recommended) at first upload — Google
re-signs; your upload key just authenticates uploads. Location permission with any
background/precise use may need a declaration form.

---

## Phase 4 — Post-deploy

- After the schema + seed reach prod, run `achievements.adminReevaluateAll` so
  `track_distance_m` credits retroactively (existing users already have `user_attraction` rows).
- Run `bun run cron:coaster-stats` and check its logs for unresolved slugs; tune
  `services/coaster-stats/seed.csv` against the live DB (Epic Universe rows are the likeliest to
  need slug adjustment).
- Watch the first native sessions in PostHog/Sentry for CORS or bearer failures the simulator
  didn't surface (real ITP behavior, real network).

---

## Suggested order (minimize rework)

1. Phase 0 accounts (start now — approval latency).
2. Phase 1 generate + config + shell smoke test.
3. Phase 2 tests T1–T12 (everything shippable today).
4. **Phase 3 ship the shell to TestFlight + Play internal** — de-risks signing/review early.
5. Build the native tail (A3 → A4 → B2 → B6), running G1–G8 as each lands.
6. Re-submit with OAuth before any public App Store release (Apple SIWA requirement).
