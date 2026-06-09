import { dash } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { oAuthProxy } from "better-auth/plugins";
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
  plugins: [
    tanstackStartCookies(),
    oAuthProxy({
      productionURL: import.meta.env.BETTER_AUTH_URL,
      secret: import.meta.env.OAUTH_PROXY_SECRET,
    }),
    dash(),
  ],
  trustedOrigins: import.meta.env.DEV ? ["http://localhost:3000"] : [],
});
