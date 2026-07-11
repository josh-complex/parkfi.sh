import { dash } from "@better-auth/infra";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import {
  bearer,
  captcha,
  haveIBeenPwned,
  lastLoginMethod,
  oAuthProxy,
  oneTimeToken,
  twoFactor,
} from "better-auth/plugins";
import { genericOAuth, microsoftEntraId } from "better-auth/plugins/generic-oauth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  account,
  passkey as passkeyTable,
  session,
  twoFactor as twoFactorTable,
  user,
  verification,
} from "#/db/auth-schema.ts";
import { generateBotAvatar } from "#/lib/avatar.ts";
import { cleanupUserData } from "#/server/accountCleanup.ts";
import { claimsFromToken, roleForTenant, tenantIdFromToken } from "#/server/auth/org-role.ts";

/**
 * The Disney-tenant-locked generic-OAuth provider id (see the `genericOAuth`
 * plugin below). Its authorization/token endpoints are pinned to Disney's Entra
 * tenant, so Microsoft itself rejects any non-Disney account — a successful
 * sign-in through it is proof of Disney membership.
 */
const DISNEY_PROVIDER_ID = "microsoft-disney";

/**
 * Elevate a user's role from a linked Microsoft account.
 *
 * Runs whenever a Microsoft `account` row is created or updated (initial link,
 * and every subsequent sign-in / token refresh). Two entry points, one rule —
 * grant `cast_member` to Disney, never downgrade, never block sign-in:
 *
 *  - `microsoft-disney` (tenant-locked button): the endpoint already guarantees
 *    Disney, so any successful sign-in elevates. No tid check needed.
 *  - `microsoft` (open-to-all button): elevate only if the token's tenant id is
 *    on the allowlist; otherwise it's just a normal user from some other org.
 *
 * Any other provider is ignored.
 */
async function syncOrgRoleFromMicrosoft(acct: {
  providerId: string;
  userId: string;
  idToken?: string | null;
}): Promise<void> {
  const set: { orgTenantId?: string; role?: string } = {};
  if (acct.providerId === DISNEY_PROVIDER_ID) {
    set.role = "cast_member";
    const tid = tenantIdFromToken(acct.idToken);
    if (tid) set.orgTenantId = tid;
  } else if (acct.providerId === "microsoft") {
    const tid = tenantIdFromToken(acct.idToken);
    if (tid) set.orgTenantId = tid;
    if (roleForTenant(tid)) set.role = "cast_member";
  } else {
    return;
  }
  if (Object.keys(set).length === 0) return;
  try {
    await db
      .update(user)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(user.id, acct.userId));
  } catch (err) {
    console.error("[auth] failed to sync org role from Microsoft sign-in", err);
  }
}

export const auth = betterAuth({
  // Pin the canonical origin in prod so the trusted origin and OAuth callback
  // URLs never depend on a Railway env var (BETTER_AUTH_URL / its fallbacks)
  // resolving correctly — an explicit baseURL takes precedence over all of
  // them. Dev falls back to BETTER_AUTH_URL (localhost). This is what makes the
  // apex the one trusted web origin; without it, a stale/mis-scoped env var
  // left the app trusting www and rejecting apex sign-in (INVALID_CALLBACK_URL).
  baseURL: import.meta.env.DEV ? undefined : "https://parkfi.sh",
  user: {
    // Server-managed fields. `input: false` is load-bearing: it stops a user
    // from setting their own role/orgTenantId through the sign-up or update-user
    // API — they're only ever written by syncOrgRoleFromMicrosoft below.
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "user", input: false },
      orgTenantId: { type: "string", required: false, input: false },
    },
    deleteUser: {
      enabled: true,
      // DB cascades on the user row remove sessions, accounts/providers, 2FA,
      // passkeys, and alerts; this hook removes the personal data they can't
      // reach — R2 avatar, Redis push subs, orphaned stay queries, PostHog
      // person. Runs before the row delete so the user's alerts still exist
      // (the stay-query step needs them) and a mid-cleanup crash stays
      // retryable. Best-effort inside — it never blocks the deletion.
      beforeDelete: async (userToDelete) => {
        await cleanupUserData(userToDelete.id);
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => ({
          data: { ...newUser, image: generateBotAvatar(newUser.id ?? newUser.email) },
        }),
      },
    },
    // Detect org membership from a linked Microsoft account's Entra tenant, on
    // both first link (create) and every subsequent sign-in (update).
    account: {
      create: {
        after: async (acct) => {
          await syncOrgRoleFromMicrosoft(acct);
        },
      },
      update: {
        after: async (acct) => {
          await syncOrgRoleFromMicrosoft(acct);
        },
      },
    },
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user,
      session,
      account,
      verification,
      twoFactor: twoFactorTable,
      passkey: passkeyTable,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  account: {
    accountLinking: {
      enabled: true,
      // "microsoft-disney" is the tenant-locked generic-OAuth provider: Microsoft
      // only issues its tokens for the Disney tenant, so the email is org-verified
      // — safe to trust for auto-linking an existing account by email. Without it,
      // better-auth refuses to link (account_not_linked) since the generic
      // provider isn't trusted and Entra tokens carry no email_verified claim.
      trustedProviders: ["google", "apple", "microsoft", "microsoft-disney"],
      requireLocalEmailVerified: false,
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      accessType: "offline",
    },
    apple: {
      clientId: process.env.APPLE_CLIENT_ID!,
      clientSecret: process.env.APPLE_CLIENT_SECRET!,
      appBundleIdentifier: process.env.APPLE_BUNDLE_ID,
      // Two different Apple audiences must both verify:
      //  - web SIWA (authorization-code redirect): id_token `aud` = the Services
      //    ID (APPLE_CLIENT_ID);
      //  - native SIWA (@capacitor-community/apple-sign-in → idToken sign-in):
      //    `aud` = the app bundle id (APPLE_BUNDLE_ID = sh.parkfi.app).
      // Without an explicit list, better-auth's apple provider collapses the
      // audience to `appBundleIdentifier` alone (see apple.mjs verifyIdToken),
      // which would reject the web token. List both so either flow passes.
      audience: [process.env.APPLE_CLIENT_ID, process.env.APPLE_BUNDLE_ID].filter(
        (v): v is string => !!v,
      ),
    },
    // Multi-tenant Entra ("common") so any Microsoft 365 org can sign in. The
    // `tid` claim on the returned token is what syncOrgRoleFromMicrosoft matches
    // against the org allowlist to grant elevated roles.
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      tenantId: "common",
      // Entra omits the `email` claim for accounts without a mailbox (many org
      // and test users), which makes better-auth reject sign-in with
      // `email_not_found`. Fall back to `preferred_username` — the UPN, which is
      // email-shaped for workforce accounts (e.g. someone@disney.com).
      mapProfileToUser: (profile) => ({
        email: profile.email ?? profile.preferred_username,
      }),
    },
  },
  plugins: [
    dash(),
    oAuthProxy({
      productionURL: process.env.PRODUCTION_URL ?? process.env.BETTER_AUTH_URL,
      secret: process.env.OAUTH_PROXY_SECRET,
    }),
    // Cloudflare Turnstile on email sign-in, sign-up, and password reset
    captcha({
      provider: "cloudflare-turnstile",
      secretKey: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY!,
    }),
    // Reject passwords found in known breach databases via HIBP k-anonymity API
    haveIBeenPwned(),
    // Cookie-based tracking of the last method used to sign in
    lastLoginMethod(),
    // TOTP two-factor authentication
    twoFactor(),
    // WebAuthn passkeys
    passkey(),
    // Native (Capacitor) shell auth: the WebView origin can't hold a
    // third-party cookie to parkfi.sh, so native sessions ride on a bearer
    // token. `bearer()` accepts `Authorization: Bearer <token>` for session
    // resolution and emits the token in `set-auth-token` on sign-in;
    // `oneTimeToken()` mints the short-lived token the system-browser OAuth flow
    // hands back to the app via deep link (see native-oauth). Web is unaffected
    // — it never sends a bearer header and keeps using cookies.
    bearer(),
    oneTimeToken(),
    // Disney-only Microsoft sign-in, separate from the open `microsoft` social
    // provider above. Same Entra app, but the authority is pinned to Disney's
    // tenant GUID, so Microsoft's own login rejects non-Disney accounts and a
    // successful sign-in is proof of Disney membership. Uses the generic-OAuth
    // callback path: /api/auth/oauth2/callback/microsoft-disney.
    genericOAuth({
      config: [
        {
          ...microsoftEntraId({
            clientId: process.env.MICROSOFT_CLIENT_ID!,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
            tenantId: process.env.MICROSOFT_DISNEY_TENANT_ID!,
          }),
          providerId: DISNEY_PROVIDER_ID,
          // The helper's default getUserInfo hits Microsoft's userinfo endpoint,
          // which omits `preferred_username` — so mailbox-less accounts fail with
          // `email_is_missing`. Read the id_token instead (it carries both `email`
          // and the UPN), mirroring the social `microsoft` provider's fallback.
          getUserInfo: (tokens) => {
            const claims = claimsFromToken(tokens.idToken);
            const email = (claims?.email ?? claims?.preferred_username) as string | undefined;
            if (!claims || !email) return Promise.resolve(null);
            return Promise.resolve({
              id: claims.sub as string,
              name: (claims.name as string | undefined) ?? email,
              email,
              emailVerified: false,
            });
          },
        },
      ],
    }),
    // Cookie integration MUST be last so it forwards Set-Cookie headers set by
    // any preceding plugin's `hooks.after` to the framework cookie store.
    tanstackStartCookies(),
  ],
  trustedOrigins: [
    ...(import.meta.env.DEV ? ["http://localhost:3000"] : []),
    "capacitor://localhost", // iOS WebView origin
    "https://localhost", // Android WebView origin
    "parkfi://", // deep-link callback scheme (native OAuth)
  ],
});
