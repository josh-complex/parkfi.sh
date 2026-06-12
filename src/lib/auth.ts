import { dash } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { captcha, haveIBeenPwned, lastLoginMethod, oAuthProxy, oneTap } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db/index.ts";
import { account, session, user, verification } from "#/db/auth-schema.ts";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
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
    tanstackStartCookies(),
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
  ],
  trustedOrigins: import.meta.env.DEV ? ["http://localhost:3000"] : [],
});
