import { Preferences } from "@capacitor/preferences";
import { isNative } from "#/lib/platform.ts";

/**
 * Bearer-token store for the native shell.
 *
 * The WebView origin (`capacitor://localhost` / `https://localhost`) can't rely
 * on third-party cookies to `https://parkfi.sh`, so native sessions ride on a
 * better-auth bearer token instead. better-auth returns the token in the
 * `set-auth-token` response header on sign-in (captured in auth-client.ts); we
 * persist it here and replay it as `Authorization: Bearer …` on every tRPC /
 * auth request.
 *
 * v1 uses `@capacitor/preferences` (unencrypted but app-sandboxed). Upgrade
 * path is a secure-storage plugin — keep this module's API identical so callers
 * don't change.
 */
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

/** Synchronous read of the in-memory token (null if unset/not loaded). */
export function currentToken(): string {
  return cached ?? "";
}

/**
 * Synchronous header builder for the tRPC links. Relies on `loadToken()` having
 * run at app bootstrap so the in-memory `cached` value is populated before the
 * first query fires. On web it always returns `{}` (cookies carry the session).
 */
export function nativeAuthHeaders(): Record<string, string> {
  return isNative() && cached ? { authorization: `Bearer ${cached}` } : {};
}
