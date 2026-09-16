import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import {
  genericOAuthClient,
  inferAdditionalFields,
  lastLoginMethodClient,
  oneTimeTokenClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { currentToken, setToken } from "#/lib/native-token.ts";
import { isNative } from "#/lib/platform.ts";

export const authClient = createAuthClient({
  // On web: undefined = same-origin (cookies). On native: the absolute origin
  // baked in at build time (see vite.config.ts) so requests reach parkfi.sh.
  baseURL: import.meta.env.VITE_API_BASE || undefined,
  fetchOptions: {
    // Native auth is bearer-only (no cookies), and cors-native.ts deliberately
    // omits Access-Control-Allow-Credentials. If this fetch still sent
    // `credentials: "include"` (better-auth's default, for web's cookie auth),
    // the WebView would require that header and fail every cross-origin
    // request with a CORS error before it even reached the bearer token.
    credentials: isNative() ? "omit" : "include",
    // Replay the stored bearer token on every request — native only. On web this
    // must stay empty: better-auth's bearer hook swaps the request's session
    // cookie for the token, so a token that has drifted from the cookie (a
    // redirect-based OAuth sign-in never returns through this fetch, so it never
    // updates the token) would authenticate the account menu against one session
    // while tRPC authenticates against the cookie — or against nothing, once the
    // stale token makes the server clear that cookie. Cookies are the only web
    // auth channel; see native-token.ts.
    auth: { type: "Bearer", token: () => (isNative() ? currentToken() : "") },
    // Capture the rotated session token better-auth returns on sign-in — native
    // only. The `bearer()` plugin emits `set-auth-token` on every response that
    // sets a session cookie, web included, so an ungated store would hand every
    // browser a second, cookie-independent credential (see the token seed in
    // native-token.ts for what that costs).
    // Await the persistence (better-fetch awaits onSuccess): native sign-in
    // reloads the app immediately afterward, and a fire-and-forget write would
    // lose the race — the reload would boot before the token hit disk, so
    // loadToken() would read an empty store and the app would start signed-out.
    onSuccess: async (ctx) => {
      if (!isNative()) return;
      const token = ctx.response.headers.get("set-auth-token");
      if (token) await setToken(token);
    },
  },
  plugins: [
    // Mirror the server's server-managed user fields so `session.user.role` and
    // `orgTenantId` are typed on the client. Declared literally (not via the
    // server auth type) so no server code is pulled into the client bundle.
    inferAdditionalFields({
      user: {
        role: { type: "string", required: false, input: false },
        orgTenantId: { type: "string", required: false, input: false },
      },
    }),
    // Enables authClient.signIn.oauth2() for the Disney-only Microsoft provider.
    genericOAuthClient(),
    lastLoginMethodClient(),
    twoFactorClient(),
    passkeyClient(),
    // Native shell only: the system-browser OAuth flow hands the app a
    // one-time token via `parkfi://` deep link, which native-oauth.ts exchanges
    // for a bearer session through authClient.oneTimeToken.verify(). Harmless on
    // web (the method is just never called there).
    oneTimeTokenClient(),
  ],
});
