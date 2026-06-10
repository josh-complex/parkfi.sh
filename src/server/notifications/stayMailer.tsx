/**
 * Renders + sends one stay-alert email from a `notification` row, via Resend with
 * the template passed as a React element (Resend renders it to HTML). Gated by
 * `config.alertsSendEnabled` — OFF in dev/test, where it logs instead of sending.
 *
 * On a provider error it THROWS so the BullMQ worker retries with backoff; the
 * worker flips the row to `failed` only on the final attempt. A retry after a
 * successful send is a no-op (idempotent on `status`).
 */
import { eq } from "drizzle-orm";
import { Resend } from "resend";

import { db } from "#/db/index.ts";
import { notification, user } from "#/db/schema.ts";
import { StayAvailableEmail } from "#/emails/StayAvailableEmail.tsx";
import { StayPriceDropEmail } from "#/emails/StayPriceDropEmail.tsx";
import { config } from "#/server/parks/config.ts";
import { StayAlertMode } from "#/server/notifications/stayAlerts.ts";
import { signUnsubscribeToken } from "#/server/notifications/unsubscribe.ts";
import type { StayNotificationPayload } from "#/server/notifications/stayFormat.ts";

let _resend: Resend | null = null;
function resend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export async function sendStayNotification(notificationId: number): Promise<void> {
  const [row] = await db
    .select({
      userId: notification.userId,
      status: notification.status,
      payload: notification.payload,
      alertId: notification.alertId,
      email: user.email,
    })
    .from(notification)
    .innerJoin(user, eq(user.id, notification.userId))
    .where(eq(notification.id, notificationId))
    .limit(1);
  if (!row) throw new Error(`notification ${notificationId} not found`);
  if (row.status === "sent") return; // idempotent: retry after a successful send

  const payload = row.payload as StayNotificationPayload;
  const unsubscribeUrl = `${config.appBaseUrl}/unsubscribe?token=${encodeURIComponent(
    signUnsubscribeToken({ userId: row.userId, scope: row.alertId }),
  )}`;
  const emailProps = {
    resortName: payload.resortName,
    dateRange: payload.dateRange,
    pricePerNight: payload.pricePerNight,
    priceBelow: payload.priceBelow,
    ctaUrl: `${config.appBaseUrl}/stays`,
    manageUrl: `${config.appBaseUrl}/stays/alerts`,
    unsubscribeUrl,
    postalAddress: config.alertPostalAddress,
  };
  const element =
    payload.mode === StayAlertMode.PRICE_BELOW ? (
      <StayPriceDropEmail {...emailProps} />
    ) : (
      <StayAvailableEmail {...emailProps} />
    );

  if (!config.alertsSendEnabled) {
    console.log(`[stay-mailer] (send disabled) would email ${row.email}: ${payload.subject}`);
    await db
      .update(notification)
      .set({ status: "sent", sentAt: new Date(), providerMsgId: "(send disabled)" })
      .where(eq(notification.id, notificationId));
    return;
  }

  const { data, error } = await resend().emails.send({
    from: config.alertFromEmail,
    to: row.email,
    subject: payload.subject,
    react: element,
    headers: {
      // RFC 8058 one-click unsubscribe — Gmail/Apple render a native button.
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (error) throw new Error(`resend: ${error.message ?? JSON.stringify(error)}`);

  await db
    .update(notification)
    .set({ status: "sent", sentAt: new Date(), providerMsgId: data?.id ?? null })
    .where(eq(notification.id, notificationId));
}

/** Record a terminal delivery failure (called by the worker on the final retry). */
export async function markStayNotificationFailed(
  notificationId: number,
  error: string,
): Promise<void> {
  await db
    .update(notification)
    .set({ status: "failed", error: error.slice(0, 1000) })
    .where(eq(notification.id, notificationId));
}
