import { config } from "#/server/parks/config.ts";

import { loadSecret, saveSecret } from "./session.ts";

/**
 * dine-vas bearer mint via the OneID (registerdisney) refresh token — over
 * plain HTTP, no browser. The bearer is just the OneID `access_token` (24h);
 * a long-lived (180d) refresh token mints fresh ones. This replaced a
 * browser-login flow that tripped an email-OTP step-up on the datacenter /
 * headless Browserless fingerprint (residential logins skip it). The refresh
 * token ROTATES on every use, so we persist the new one each time — as long as
 * the cron runs at least once per 180d the window rolls forward indefinitely.
 * Seed the first token with the `seed-token` bootstrap.
 *
 * VERIFIED live (2026-06-10): refresh → 200 + bearer → dine-vas availability →
 * 200. See research/disney-ticket-deep-dive.md.
 */

const ONEID_REFRESH_SESSION = "disney_oneid_refresh";
const BROWSER_UA =
  process.env.DISNEY_BROWSER_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface OneIdRefreshState {
  refreshToken: string;
}

/** Recursively find the first string value under `key` anywhere in `obj`. */
function deepFindString(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === key && typeof v === "string") return v;
    if (v && typeof v === "object") {
      const found = deepFindString(v, key);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Mint a fresh dine-vas bearer by exchanging the stored OneID refresh token,
 * persisting the rotated refresh token before returning. Throws if no token is
 * seeded or the exchange fails (e.g. a 180d-expired / revoked token → re-seed).
 * `signal` lets the cron's budget abort a hung request.
 *
 * NB: `clientId` MUST be the token's `client_id` claim (`…WEB-PROD`), not the
 * browser SDK's `getConfig` value (`…WEB`) — the endpoint rejects a mismatch
 * with `AUTHORIZATION_INVALID_REFRESH_TOKEN`.
 */
export async function refreshDineBearer(signal?: AbortSignal): Promise<string> {
  const apiKey = config.disneyOneIdApiKey;
  if (!apiKey) throw new Error("DISNEY_ONEID_APIKEY not set");
  const stored = await loadSecret<OneIdRefreshState>(ONEID_REFRESH_SESSION);
  if (!stored?.refreshToken) {
    throw new Error(
      `no OneID refresh token stored (session "${ONEID_REFRESH_SESSION}") — run the seed-token bootstrap`,
    );
  }

  const url = `${config.disneyOneIdBase}/client/${config.disneyOneIdClientId}/guest/refresh-auth`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      Authorization: `APIKEY ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
    body: JSON.stringify({ refreshToken: stored.refreshToken }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OneID refresh failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json().catch(() => null)) as unknown;
  const accessToken = deepFindString(json, "access_token");
  if (!accessToken) throw new Error("OneID refresh: no access_token in response");

  // Rotation: the response carries a NEW refresh token and the old one is now
  // spent. Persist the new one BEFORE returning — if this save fails the old
  // token is already dead, so we surface it loudly (next run re-seeds) rather
  // than hand back a bearer atop an unsaved rotation.
  const newRefresh = deepFindString(json, "refresh_token");
  if (newRefresh && newRefresh !== stored.refreshToken) {
    await saveSecret(ONEID_REFRESH_SESSION, {
      refreshToken: newRefresh,
    } satisfies OneIdRefreshState);
  }
  return accessToken;
}

/** Seed (bootstrap) the OneID refresh token — used once by the seed-token CLI. */
export function seedDineRefreshToken(refreshToken: string): Promise<void> {
  return saveSecret(ONEID_REFRESH_SESSION, { refreshToken } satisfies OneIdRefreshState);
}
