/**
 * Public, login-less unsubscribe endpoint for stay-alert email. The signed token
 * in the query string IS the auth (no session) — see server/notifications/
 * unsubscribe.ts. GET serves a confirmation page (the link in the email body);
 * POST is the RFC 8058 one-click handler Gmail/Apple invoke from their native
 * unsubscribe button (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`).
 */
import { createFileRoute } from "@tanstack/react-router";

import { applyUnsubscribe, verifyUnsubscribeToken } from "#/server/notifications/unsubscribe.ts";

function page(title: string, message: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f4f5;margin:0;padding:48px 16px;color:#18181b"><div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px"><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#3f3f46;line-height:22px;margin:0">${message}</p><p style="margin:20px 0 0"><a href="/stays/alerts" style="color:#2563eb">Manage your alerts</a></p></div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function handle(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  const payload = token ? verifyUnsubscribeToken(token) : null;
  if (!payload) {
    return page("Invalid link", "This unsubscribe link is invalid or has expired.", 400);
  }
  await applyUnsubscribe(payload);
  const message =
    payload.scope === "all"
      ? "You've been unsubscribed from all stay-alert emails."
      : "You've been unsubscribed from this alert.";
  return page("Unsubscribed", message, 200);
}

export const Route = createFileRoute("/unsubscribe")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
