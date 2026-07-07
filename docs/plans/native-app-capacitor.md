# Native App via Capacitor

**Goal:** ship parkfi.sh as native iOS/Android apps to get real haptics (iOS Safari has no
Vibration API — see `src/lib/vibrate.ts`), native permission prompts (location, notifications,
camera), and reliable push via APNs/FCM instead of best-effort web push.

**Status:** not started. Drafted 2026-07-07.

## Decision: Capacitor, not React Native / not PWA-only

- **React Native / Expo** — full UI rewrite; visx, maplibre/leaflet, Tailwind, radix/base-ui
  don't carry over. Only revisit if Living Layer AR eventually demands heavy native UI.
- **PWA-only** — iOS push requires manual Add-to-Home-Screen, no haptics, throttled
  notifications. Doesn't meet the goal.
- **Capacitor** — web code runs in a WebView, native features via plugins with a JS API.
  One codebase; web app unchanged for browser users.

## Architectural wrinkle: SSR

Capacitor bundles static files; TanStack Start is SSR on Nitro. Two shapes:

1. **Remote-URL shell** (phase 1): `server.url` → `https://parkfi.sh`. Zero build changes;
   plugins still work (bridge injects into the WebView). Requires connectivity; Apple can be
   picky about wrappers — mitigated by genuine native integration (push, haptics, location,
   camera).
2. **Bundled SPA build** (end state): second build target using TanStack Start SPA mode,
   tRPC client pointed at absolute prod URL. Instant offline shell.

Plan: ship phase 1 with the remote-URL shell to validate native features, move to bundled
SPA before wide release.

## Phases

### Phase 0 — prep in the web app (do first; zero risk, benefits web too)

- [ ] Create `src/lib/native/` abstraction layer: `haptics.ts`, `push.ts`, `geo.ts`,
      `device.ts`. Each checks `Capacitor.isNativePlatform()` and falls back to the current
      web implementation (`src/lib/vibrate.ts`, `src/hooks/use-geolocation.ts`,
      `src/hooks/use-push-notifications.ts` become the web branches). Call sites unchanged.
- [ ] Audit browser-only assumptions: `window.location` redirects in better-auth flow,
      absolute vs relative API URLs in the tRPC client, cookie handling.
- [ ] Start Apple Developer enrollment ($99/yr) — takes days, gates everything in phase 2.

### Phase 1 — Capacitor shell (~a few days)

- [ ] `bun add @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android` plus
      `@capacitor/haptics @capacitor/push-notifications @capacitor/geolocation
@capacitor/camera @capacitor/app @capacitor/status-bar`.
- [ ] `capacitor.config.ts`: `appId` `sh.parkfi.app`, `server.url` → prod (phase 1 only).
- [ ] Check in `ios/` and `android/` projects (Xcode + Android Studio).
- [ ] Wire native haptics branch: map the `number[]` vibration patterns to sequenced
      `Haptics.vibrate({duration})` calls or discrete impact styles. This is where the
      tier-scaled achievement unlock patterns finally work on iPhones.

### Phase 2 — native push (biggest backend chunk, ~a week)

- [ ] APNs key from Apple Developer; Firebase project for FCM (optionally FCM as unified
      sender for both platforms).
- [ ] Schema: extend push subscriptions (or add `device_tokens`) with
      `platform: 'web' | 'ios' | 'android'`, token, user id.
- [ ] `services/notifications` worker branches: web-push for web subs, APNs/FCM for native
      tokens. Shared payload shape.
- [ ] Client: native `push.ts` branch — `PushNotifications.requestPermissions()` →
      `register()` → new tRPC mutation to store the token.
- [ ] Handle `pushNotificationActionPerformed` to deep-link into the router
      (ride alert → attraction page).

### Phase 3 — auth & device polish

- [ ] Better-auth sessions: fine with remote-URL shell (same origin). Bundled SPA origin is
      `capacitor://localhost` → needs CORS + `trustedOrigins` + `SameSite=None; Secure`
      cookies, or switch native clients to bearer-token sessions (better-auth supports this).
- [ ] `@capacitor/geolocation` for proper when-in-use/background permission tiers
      (relevant for Living Layer later).
- [ ] Camera plugin for the pin scanner instead of `getUserMedia`.
- [ ] Status bar theming, safe-area insets (`env(safe-area-inset-*)`), splash screen, icons.

### Phase 4 — SPA bundle + store release

- [ ] SPA build target; tRPC at absolute prod URL; verify edge-cached GET links work from
      the app origin.
- [ ] App Store review prep: privacy nutrition labels (location, PostHog analytics),
      in-app account deletion (surface `src/server/accountCleanup.ts` flow — Apple requires
      it), TestFlight beta → release. Play Store is comparatively painless.
- [ ] CI: Fastlane signed builds; consider `@capacitor/live-updates` or Capgo later for OTA
      web-layer updates without store review.

## Rough effort

| Chunk                                               | Estimate                                  |
| --------------------------------------------------- | ----------------------------------------- |
| Phases 0–1 → working iPhone build with real haptics | ~1 week                                   |
| Phase 2 → native push end-to-end                    | ~1 week                                   |
| Phases 3–4 → polish + store bureaucracy             | ~2 weeks (Apple review latency dominates) |

**First concrete step:** the `src/lib/native/` abstraction layer — pure refactor, zero risk
to the web app, makes Capacitor adoption a leaf-node change instead of surgery.
