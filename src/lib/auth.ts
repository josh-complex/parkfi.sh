import { dash } from "@better-auth/infra";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import {
  captcha,
  haveIBeenPwned,
  lastLoginMethod,
  oAuthProxy,
  oneTap,
  twoFactor,
} from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
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

export const auth = betterAuth({
  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => ({
          data: { ...newUser, image: generateBotAvatar(newUser.id ?? newUser.email) },
        }),
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
      trustedProviders: ["google", "apple"],
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
    },
  },
  plugins: [
    dash(),
    oAuthProxy({
      productionURL: process.env.PRODUCTION_URL ?? process.env.BETTER_AUTH_URL,
      secret: process.env.OAUTH_PROXY_SECRET,
    }),
    // Google One Tap — uses the google social provider clientId automatically
    oneTap(),
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
    // Cookie integration MUST be last so it forwards Set-Cookie headers set by
    // any preceding plugin's `hooks.after` to the framework cookie store.
    tanstackStartCookies(),
  ],
  trustedOrigins: import.meta.env.DEV ? ["http://localhost:3000"] : [],
});
