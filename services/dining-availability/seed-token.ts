/**
 * One-time bootstrap for the dining cron's auth. Seeds the OneID refresh token
 * into the encrypted session store so `refreshDineBearer` can mint dine-vas
 * bearers over plain HTTP — no browser, no OTP.
 *
 * Grab a fresh refresh token from a logged-in session: log in at
 * disneyworld.disney.go.com from a normal/residential browser (no OTP there),
 * and read the OneID login/refresh response's `refreshToken` (or the
 * `TPR-WDW-LBJS.WEB-PROD.token` cookie's decoded `refresh_token`). It rotates on
 * first use, so seed a FRESH one. Then:
 *
 *   DISNEY_REFRESH_TOKEN='eyJ…' bun services/dining-availability/seed-token.ts
 *
 * Re-run only when the 180-day refresh token has lapsed (the cron normally
 * rolls it forward on every run).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { seedDineRefreshToken } from "#/server/dining/disney-session.ts";

async function main() {
  const token = process.env.DISNEY_REFRESH_TOKEN?.trim();
  if (!token) {
    console.error("[seed-token] set DISNEY_REFRESH_TOKEN to the OneID refresh token to seed");
    process.exit(1);
  }
  await seedDineRefreshToken(token);
  console.log(
    "[seed-token] stored OneID refresh token (encrypted) — the dining cron can now mint bearers without a browser",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
