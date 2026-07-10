/**
 * Native (Capacitor) OAuth for the ParkFi shell — iOS and Android.
 *
 * Social providers (Google, Microsoft) refuse embedded WebView user agents, so
 * native social sign-in runs in the *system browser* (`@capacitor/browser` —
 * SFSafariViewController on iOS, Custom Tabs on Android) and returns to the app
 * through a `parkfi://` deep link:
 *
 *   1. `signIn.social({ …, disableRedirect: true })` returns the provider's
 *      authorize URL instead of navigating.
 *   2. `Browser.open()` runs the flow; `callbackURL` is `/native-callback`, which
 *      (server-side) mints a one-time token from the cookie session set in the
 *      browser and 302s to `parkfi://auth-callback?ott=…`.
 *   3. The OS hands that URL to `@capacitor/app`'s `appUrlOpen`; we close the
 *      browser and exchange the token for a bearer session via
 *      `oneTimeToken.verify()` (the authClient `onSuccess` hook persists the
 *      returned `set-auth-token`).
 *
 * Apple is special-cased: on **iOS** we use the native Sign in with Apple sheet
 * (`@capacitor-community/apple-sign-in`) → idToken sign-in (no browser, no deep
 * link). On **Android** there's no native Apple sheet, so Apple goes through the
 * same system-browser flow as the other providers.
 *
 * None of this runs on web — the browser app signs in with cookies directly.
 */
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

import { authClient } from "#/lib/auth-client.ts";
import { nativePlatform } from "#/lib/platform.ts";

// Relative, NOT absolute: better-auth validates callbackURL against its trusted
// origins and resolves a relative path against its own *canonical* origin
// (www.parkfi.sh). An absolute apex URL (https://parkfi.sh) both fails that
// trust check AND would land on a different host than the one the OAuth session
// cookie was set on — so /native-callback would see no session and never mint
// the one-time token.
const NATIVE_CALLBACK = "/native-callback";
// Must equal capacitor.config.ts `appId` and the OAuth deep-link scheme host.
const APP_ID = "sh.parkfi.app";
const CALLBACK_URL_PREFIX = "parkfi://auth-callback";

export type NativeSocialProvider = "google" | "microsoft" | "apple";

// The in-flight system-browser flow. Set when we open the browser, resolved when
// the deep link comes back (or rejected if the user closes the browser first).
let pending: { resolve: () => void; reject: (err: Error) => void } | null = null;
let listenersReady = false;
// Scheduled "browser was closed = cancelled" rejection. Held off briefly because
// on Android `browserFinished` fires BEFORE `appUrlOpen` delivers the deep link;
// appUrlOpen clears this timer when the link actually lands.
let cancelTimer: ReturnType<typeof setTimeout> | null = null;

function clearCancelTimer(): void {
  if (cancelTimer !== null) {
    clearTimeout(cancelTimer);
    cancelTimer = null;
  }
}

/**
 * Register the deep-link + browser-dismissal listeners once, at app bootstrap
 * (see __root.tsx). Idempotent and native-only; safe to call on every navigation.
 */
export function initNativeAuthDeepLinks(): void {
  if (listenersReady || nativePlatform() === "web") return;
  listenersReady = true;

  // The OAuth round-trip returns here as `parkfi://auth-callback?ott=…|error=…`.
  void App.addListener("appUrlOpen", ({ url }) => {
    if (!url.startsWith(CALLBACK_URL_PREFIX)) return;
    // The deep link landed — cancel the pending "browser closed" rejection that
    // browserFinished scheduled just before this event (Android fires them in
    // that order), then claim the flow.
    clearCancelTimer();
    const p = pending;
    pending = null;
    void completeDeepLink(url, p);
  });

  // The system browser closed. This fires on a genuine user cancel AND — on
  // Android — a moment BEFORE the successful deep link is delivered. So don't
  // reject immediately: wait briefly; if appUrlOpen lands, it clears this timer.
  // Only if no deep link arrives was it a real cancellation.
  void Browser.addListener("browserFinished", () => {
    if (!pending || cancelTimer !== null) return;
    cancelTimer = setTimeout(() => {
      cancelTimer = null;
      if (pending) {
        pending.reject(new Error("Sign-in was cancelled."));
        pending = null;
      }
    }, 1500);
  });
}

async function completeDeepLink(
  url: string,
  p: { resolve: () => void; reject: (err: Error) => void } | null,
): Promise<void> {
  try {
    // Dismiss the system browser (no-op / harmless if already gone).
    await Browser.close().catch(() => {});
    const params = new URL(url).searchParams;
    const error = params.get("error");
    const ott = params.get("ott");
    if (error) throw new Error(mapOAuthError(error));
    if (!ott) throw new Error("Sign-in did not return a token.");
    // The response's `set-auth-token` header is captured by the authClient
    // onSuccess hook and persisted as the bearer token — no manual store needed.
    const { error: verifyError } = await authClient.oneTimeToken.verify({ token: ott });
    if (verifyError) throw new Error(verifyError.message ?? "Could not complete sign-in.");
    p?.resolve();
  } catch (err) {
    p?.reject(err instanceof Error ? err : new Error("Sign-in failed."));
  }
}

function mapOAuthError(code: string): string {
  if (code === "no_session") return "Sign-in didn't complete. Please try again.";
  if (code === "access_denied") return "Sign-in was cancelled.";
  return "We couldn't complete that sign-in. Please try again.";
}

/** Drive a provider through the system browser and wait for the deep-link return. */
async function runBrowserFlow(authorizeUrl: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    pending = { resolve, reject };
    void Browser.open({ url: authorizeUrl }).catch((err: unknown) => {
      pending = null;
      reject(err instanceof Error ? err : new Error("Could not open the browser."));
    });
  });
}

/** Ask better-auth for the provider authorize URL without navigating the WebView. */
async function socialAuthorizeUrl(provider: NativeSocialProvider): Promise<string> {
  const { data, error } = await authClient.signIn.social({
    provider,
    callbackURL: NATIVE_CALLBACK,
    errorCallbackURL: NATIVE_CALLBACK,
    disableRedirect: true,
  });
  if (error || !data?.url) throw new Error(error?.message ?? "Could not start sign-in.");
  return data.url;
}

/**
 * Native social sign-in. Apple on iOS uses the native sheet; everything else
 * (incl. Apple on Android) uses the system-browser flow.
 */
export async function signInWithProviderNative(provider: NativeSocialProvider): Promise<void> {
  if (provider === "apple" && nativePlatform() === "ios") {
    return signInWithAppleNative();
  }
  return runBrowserFlow(await socialAuthorizeUrl(provider));
}

/** Disney cast-member sign-in (tenant-locked generic-OAuth provider) via system browser. */
export async function signInWithDisneyNative(): Promise<void> {
  const { data, error } = await authClient.signIn.oauth2({
    providerId: "microsoft-disney",
    callbackURL: NATIVE_CALLBACK,
    errorCallbackURL: NATIVE_CALLBACK,
    disableRedirect: true,
  });
  if (error || !data?.url) throw new Error(error?.message ?? "Could not start sign-in.");
  return runBrowserFlow(data.url);
}

/**
 * iOS-only native Sign in with Apple. The native sheet returns an identity token
 * that better-auth verifies directly (idToken sign-in) — no browser, no deep
 * link. We pass one raw nonce to both Apple and better-auth: better-auth's
 * `nonceMatches` accepts either the raw value or its SHA-256, so it verifies
 * regardless of whether the plugin hashes it before handing it to Apple.
 */
async function signInWithAppleNative(): Promise<void> {
  const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
  const nonce = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const result = await SignInWithApple.authorize({
    // clientId/redirectURI are ignored by the iOS native flow (bundle id is
    // implicit); passed only to satisfy the plugin's option type.
    clientId: APP_ID,
    redirectURI: NATIVE_CALLBACK,
    scopes: "name email",
    nonce,
  });
  const token = result.response.identityToken;
  if (!token) throw new Error("Apple sign-in returned no identity token.");
  const { error } = await authClient.signIn.social({
    provider: "apple",
    idToken: { token, nonce },
  });
  if (error) throw new Error(error.message ?? "Apple sign-in failed.");
}
