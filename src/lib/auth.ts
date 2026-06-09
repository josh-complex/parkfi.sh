import { betterAuth } from "better-auth";
import { oAuthProxy } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import { db } from "#/db/index.ts";
import { account, passkey as passkeyTable, session, user, verification } from "#/db/auth-schema.ts";

// WebAuthn relying-party config is derived from the deployment origin so dev
// (localhost:3000) and prod (parkfi.sh) both work without extra env. rpID is the
// registrable domain; origin is the exact URL the ceremony must run against.
const baseURL = import.meta.env.BETTER_AUTH_URL || "http://localhost:3000";
const rpURL = new URL(baseURL);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification, passkey: passkeyTable },
  }),
  // Password login is disabled — authentication is passkey-only (see the passkey
  // plugin below). Leaving emailAndPassword off means `/sign-in/email` 404s.
  emailAndPassword: {
    enabled: false,
  },
  plugins: [
    passkey({
      rpID: rpURL.hostname,
      rpName: "ParkFi",
      origin: rpURL.origin,
      // Passkey-first onboarding: no prior session needed to register. The client
      // passes the new account's email/name as JSON `context`; we create the user
      // here (rejecting an email that already exists, so a known email can't be
      // hijacked by registering a fresh passkey against it).
      registration: {
        requireSession: false,
        resolveUser: async ({ ctx, context }) => {
          let parsed: { email?: unknown; name?: unknown } = {};
          try {
            parsed = context ? JSON.parse(context) : {};
          } catch {
            parsed = {};
          }
          const email = (typeof parsed.email === "string" ? parsed.email : "").trim().toLowerCase();
          if (!email || !email.includes("@")) {
            throw ctx.error("BAD_REQUEST", {
              message: "A valid email is required to create a passkey account.",
            });
          }
          const name =
            (typeof parsed.name === "string" ? parsed.name : "").trim() || email.split("@")[0];

          const existing = await ctx.context.internalAdapter.findUserByEmail(email);
          if (existing?.user) {
            throw ctx.error("UNPROCESSABLE_ENTITY", {
              message: "An account with this email already exists. Sign in with your passkey.",
            });
          }
          const created = await ctx.context.internalAdapter.createUser({
            email,
            name,
            emailVerified: false,
          });
          return { id: created.id, name: created.name };
        },
      },
    }),
    tanstackStartCookies(),
    oAuthProxy({
      productionURL: import.meta.env.BETTER_AUTH_URL,
      secret: import.meta.env.OAUTH_PROXY_SECRET,
    }),
  ],
  trustedOrigins: import.meta.env.DEV ? ["http://localhost:3000"] : [],
});
