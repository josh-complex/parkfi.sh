/**
 * Delivers one filing-watch alert from a `public_record_notification` row: email
 * via Resend and/or push via the existing `push-notifications` queue, depending
 * on the row's channel. Gated by `config.alertsSendEnabled` — OFF in dev/test,
 * where it logs instead of sending. Mirrors `diningMailer.tsx`: throws on a
 * provider error so the BullMQ worker retries with backoff; idempotent on a
 * `sent` row.
 *
 * Push goes through the queue rather than `sendPush` directly so device fan-out,
 * stale-subscription pruning and retries stay in one place.
 */
import { eq } from "drizzle-orm";
import { Resend } from "resend";

import { db } from "#/db/index.ts";
import { publicRecordNotification, user } from "#/db/schema.ts";
import { FilingWatchEmail } from "#/emails/FilingWatchEmail.tsx";
import { config } from "#/server/parks/config.ts";
import { getPushQueue } from "#/server/notifications/queue.ts";
import { signUnsubscribeToken } from "#/server/notifications/unsubscribe.ts";
import {
  filingPushBody,
  kindLabel,
  type FilingNotificationPayload,
} from "#/server/notifications/filingFormat.ts";

let _resend: Resend | null = null;
function resend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

/** Our record page — we link our page, never rehost the agency's document. */
const recordUrl = (id: number) => `${config.appBaseUrl}/filings/${id}`;

export async function sendFilingNotification(notificationId: number): Promise<void> {
  const [row] = await db
    .select({
      userId: publicRecordNotification.userId,
      status: publicRecordNotification.status,
      channel: publicRecordNotification.channel,
      payload: publicRecordNotification.payload,
      watchId: publicRecordNotification.watchId,
      email: user.email,
    })
    .from(publicRecordNotification)
    .innerJoin(user, eq(user.id, publicRecordNotification.userId))
    .where(eq(publicRecordNotification.id, notificationId))
    .limit(1);
  if (!row) throw new Error(`public_record_notification ${notificationId} not found`);
  if (row.status === "sent") return; // idempotent: retry after a successful send

  const payload = row.payload as FilingNotificationPayload;
  const wantsPush = row.channel === "push" || row.channel === "both";
  const wantsEmail = row.channel === "email" || row.channel === "both";

  // Push first: it's the cheap half, and a push already queued is not re-sent
  // on an email retry because the row flips to `sent` only after both succeed.
  if (wantsPush) {
    await getPushQueue().add("filing-alert", {
      userId: row.userId,
      title: payload.subject,
      body: filingPushBody(payload),
      url: payload.records.length === 1 ? `/filings/${payload.records[0].id}` : "/filings",
    });
  }

  let providerMsgId: string | null = wantsPush ? "(push queued)" : null;

  if (wantsEmail) {
    const unsubscribeUrl = `${config.appBaseUrl}/unsubscribe?token=${encodeURIComponent(
      signUnsubscribeToken({ userId: row.userId, scope: row.watchId, kind: "filing" }),
    )}`;
    const element = (
      <FilingWatchEmail
        watchLabel={payload.watchLabel}
        count={payload.count}
        moreCount={payload.moreCount}
        records={payload.records.map((r) => ({
          id: r.id,
          title: r.title,
          kindLabel: kindLabel(r.kind),
          filer: r.filer,
          status: r.status,
          filedOn: r.filedOn,
          park: r.park,
          pageUrl: recordUrl(r.id),
        }))}
        ctaUrl={`${config.appBaseUrl}/filings`}
        manageUrl={`${config.appBaseUrl}/account/alerts`}
        unsubscribeUrl={unsubscribeUrl}
        postalAddress={config.alertPostalAddress}
      />
    );

    if (!config.alertsSendEnabled) {
      console.log(`[filing-mailer] (send disabled) would email ${row.email}: ${payload.subject}`);
      providerMsgId = "(send disabled)";
    } else {
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
      providerMsgId = data?.id ?? null;
    }
  }

  await db
    .update(publicRecordNotification)
    .set({ status: "sent", sentAt: new Date(), providerMsgId })
    .where(eq(publicRecordNotification.id, notificationId));
}

/** Record a terminal delivery failure (called by the worker on the final retry). */
export async function markFilingNotificationFailed(
  notificationId: number,
  error: string,
): Promise<void> {
  await db
    .update(publicRecordNotification)
    .set({ status: "failed", error: error.slice(0, 1000) })
    .where(eq(publicRecordNotification.id, notificationId));
}
