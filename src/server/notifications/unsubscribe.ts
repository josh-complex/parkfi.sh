/**
 * Signed, login-less unsubscribe tokens for stay-alert email. The email click is
 * unauthenticated, so the signed token IS the auth — same crypto posture as the
 * `scraper_session` blob (key from env, never stored). HMAC-SHA256 over a base64url
 * JSON payload; `verify` is timing-safe. A token's `scope` is either a single
 * `alertId` (disable that one alert) or `"all"` (global email kill switch).
 */
import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { alertOptout, stayAlert } from "#/db/schema.ts";

export interface UnsubscribePayload {
  userId: string;
  /** A `stay_alert.id` to silence one alert, or "all" for the global opt-out. */
  scope: number | "all";
}

function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (!s) throw new Error("UNSUBSCRIBE_SECRET not set");
  return s;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", secret()).update(body).digest("base64url");
}

/** `base64url(payload).base64url(hmac)` — opaque, tamper-evident, no DB lookup. */
export function signUnsubscribeToken(payload: UnsubscribePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Verify + decode a token, or null if the signature/shape is invalid. */
export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = sign(body);
  const got = Buffer.from(mac);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UnsubscribePayload;
    if (typeof p.userId !== "string") return null;
    if (p.scope !== "all" && typeof p.scope !== "number") return null;
    return p;
  } catch {
    return null;
  }
}

/** Honor an unsubscribe: disable the one alert, or set the global email opt-out. */
export async function applyUnsubscribe(payload: UnsubscribePayload): Promise<void> {
  if (payload.scope === "all") {
    await db
      .insert(alertOptout)
      .values({ userId: payload.userId, stayEmailOptOut: true })
      .onConflictDoUpdate({
        target: alertOptout.userId,
        set: { stayEmailOptOut: true, updatedAt: new Date() },
      });
    return;
  }
  await db
    .update(stayAlert)
    .set({ active: false })
    .where(and(eq(stayAlert.id, payload.scope), eq(stayAlert.userId, payload.userId)));
}
