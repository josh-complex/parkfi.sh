import { Resend } from "resend";

import { config } from "#/server/parks/config.ts";

/** Owner allowlist, same source as the tRPC `adminProcedure` gate. */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let _resend: Resend | null = null;
function resend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

interface RemovalNotice {
  id: number;
  entityType: string;
  entityId: string;
  scope: string;
  reason: string;
  note: string | null;
  requesterEmail: string | null;
}

/**
 * Notify admins that a verified cast member filed a removal/correction request.
 * Best-effort: no-ops when there are no admins configured, logs instead of
 * sending when alert delivery is disabled (dev), and the caller never awaits its
 * failure so a mail hiccup can't block the submit.
 */
export async function notifyAdminsOfRemovalRequest(n: RemovalNotice): Promise<void> {
  if (ADMIN_EMAILS.length === 0) return;

  const subject = `Removal request #${n.id}: ${n.entityType}/${n.entityId}`;
  const text = [
    "A verified cast member submitted a content removal / correction request.",
    "",
    `Request:  #${n.id}`,
    `Entity:   ${n.entityType} / ${n.entityId}`,
    `Scope:    ${n.scope}`,
    `Reason:   ${n.reason}`,
    `From:     ${n.requesterEmail ?? "(unknown)"}`,
    n.note ? `Note:     ${n.note}` : "",
    "",
    `Review:   ${config.appBaseUrl}/admin/removal-requests`,
  ]
    .filter(Boolean)
    .join("\n");

  if (!config.alertsSendEnabled) {
    console.log(`[removal-mailer] (send disabled) would notify admins:\n${text}`);
    return;
  }

  const { error } = await resend().emails.send({
    from: config.alertFromEmail,
    to: ADMIN_EMAILS,
    subject,
    text,
  });
  if (error) throw new Error(`resend: ${error.message ?? JSON.stringify(error)}`);
}
