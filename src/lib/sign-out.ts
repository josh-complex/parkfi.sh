import { authClient } from "#/lib/auth-client.ts";
import { clearToken } from "#/lib/native-token.ts";
import { isNative } from "#/lib/platform.ts";

/**
 * Sign out everywhere. On the native shell the session rides on a persisted
 * bearer token (see native-token.ts) rather than a cookie, so we must drop it
 * too — otherwise a stale token would be replayed on the next app launch.
 * On web this is just `authClient.signOut()`.
 */
export async function signOut(): Promise<void> {
  await authClient.signOut();
  if (isNative()) await clearToken();
}
