/**
 * Renders + sends one dining-alert email from a `dining_notification` row, via
 * Resend. Gated by `config.alertsSendEnabled` — OFF in dev/test, where it logs
 * instead of sending. Mirrors `stayMailer.tsx`: throws on a provider error so the
 * BullMQ worker retries with backoff; idempotent on a `sent` row.
 */
import { eq } from "drizzle-orm";
import { Resend } from "resend";

import { db } from "#/db/index.ts";
import { diningNotification, user } from "#/db/schema.ts";
import { DiningTableEmail } from "#/emails/DiningTableEmail.tsx";
import { config } from "#/server/parks/config.ts";
import { signUnsubscribeToken } from "#/server/notifications/unsubscribe.ts";
import type { DiningNotificationPayload } from "#/server/notifications/diningFormat.ts";

let _resend: Resend | null = null;
function resend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export async function sendDiningNotification(notificationId: number): Promise<void> {
  const [row] = await db
    .select({
      userId: diningNotification.userId,
      status: diningNotification.status,
      payload: diningNotification.payload,
      alertId: diningNotification.alertId,
      email: user.email,
    })
    .from(diningNotification)
    .innerJoin(user, eq(user.id, diningNotification.userId))
    .where(eq(diningNotification.id, notificationId))
    .limit(1);
  if (!row) throw new Error(`dining_notification ${notificationId} not found`);
  if (row.status === "sent") return; // idempotent: retry after a successful send

  const payload = row.payload as DiningNotificationPayload;
  const unsubscribeUrl = `${config.appBaseUrl}/unsubscribe?token=${encodeURIComponent(
    signUnsubscribeToken({ userId: row.userId, scope: row.alertId, kind: "dining" }),
  )}`;
  const element = (
    <DiningTableEmail
      restaurantName={payload.restaurantName}
      dateLabel={payload.dateLabel}
      partySize={payload.partySize}
      ctaUrl={`${config.appBaseUrl}/dining`}
      manageUrl={`${config.appBaseUrl}/account/alerts`}
      unsubscribeUrl={unsubscribeUrl}
      postalAddress={config.alertPostalAddress}
    />
  );

  if (!config.alertsSendEnabled) {
    console.log(`[dining-mailer] (send disabled) would email ${row.email}: ${payload.subject}`);
    await db
      .update(diningNotification)
      .set({ status: "sent", sentAt: new Date(), providerMsgId: "(send disabled)" })
      .where(eq(diningNotification.id, notificationId));
    return;
  }

  const { data, error } = await resend().emails.send({
    from: config.alertFromEmail,
    to: row.email,
    subject: payload.subject,
    react: element,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (error) throw new Error(`resend: ${error.message ?? JSON.stringify(error)}`);

  await db
    .update(diningNotification)
    .set({ status: "sent", sentAt: new Date(), providerMsgId: data?.id ?? null })
    .where(eq(diningNotification.id, notificationId));
}

/** Record a terminal delivery failure (called by the worker on the final retry). */
export async function markDiningNotificationFailed(
  notificationId: number,
  error: string,
): Promise<void> {
  await db
    .update(diningNotification)
    .set({ status: "failed", error: error.slice(0, 1000) })
    .where(eq(diningNotification.id, notificationId));
}
