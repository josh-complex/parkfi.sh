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
 * Durability vs. timing — the token lives in TWO places:
 *  - `localStorage`: synchronous, read at module load so the token is in memory
 *    before the first render. better-auth's `useSession` fires `/get-session`
 *    on mount, and a root-level subscriber mounts before `loadToken()`'s async
 *    `Preferences.get` resolves — without a synchronously-available token that
 *    request goes out with no bearer header, caches a signed-out session, and
 *    never refetches. This is the fast mirror.
 *  - Capacitor `Preferences` (app-sandboxed): the durable store, reconciled by
 *    `loadToken()` at boot. Upgrade path is a secure-storage plugin — keep this
 *    module's API identical so callers don't change.
 *
 * Reads/writes are guarded for SSR/prerender, where `localStorage` and the
 * native bridge are absent.
 */
const KEY = "parkfi.session-token";

function readLocal(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
  } catch {
    return null;
  }
}

function writeLocal(token: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage disabled — Preferences still persists the token */
  }
}

// Seeded synchronously from localStorage so `currentToken()` is populated before
// the first `/get-session` fetch. `undefined` = not loaded yet (fall back to
// Preferences in loadToken); `null` = loaded, no token; string = the token.
let cached: string | null | undefined = readLocal() ?? undefined;

export async function loadToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  // localStorage had nothing — reconcile from the durable store and re-mirror.
  const stored = (await Preferences.get({ key: KEY })).value;
  cached = stored;
  writeLocal(stored);
  return cached;
}

export async function setToken(token: string): Promise<void> {
  cached = token;
  writeLocal(token); // synchronous — available on the next boot before any fetch
  await Preferences.set({ key: KEY, value: token });
}

export async function clearToken(): Promise<void> {
  cached = null;
  writeLocal(null);
  await Preferences.remove({ key: KEY });
}

/** Synchronous read of the in-memory token (empty string if unset/not loaded). */
export function currentToken(): string {
  return cached ?? "";
}

/**
 * Synchronous header builder for the tRPC links. Relies on the module-load seed
 * (and `loadToken()` at bootstrap) so the in-memory `cached` value is populated
 * before the first query fires. On web it always returns `{}` (cookies carry the
 * session).
 */
export function nativeAuthHeaders(): Record<string, string> {
  return isNative() && cached ? { authorization: `Bearer ${cached}` } : {};
}
