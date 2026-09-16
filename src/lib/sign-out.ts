import { authClient } from "#/lib/auth-client.ts";
import { clearToken } from "#/lib/native-token.ts";

/**
 * Sign out everywhere. On the native shell the session rides on a persisted
 * bearer token (see native-token.ts) rather than a cookie, so we must drop it
 * too — otherwise a stale token would be replayed on the next app launch.
 * Web clears it as well: it never mints one any more, but a browser that signed
 * in under an older build still has one sitting in localStorage, and sign-out is
 * the right moment to be rid of it.
 */
export async function signOut(): Promise<void> {
  await authClient.signOut();
  await clearToken();
}
