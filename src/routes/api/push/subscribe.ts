import { createFileRoute } from "@tanstack/react-router";

import { auth } from "#/lib/auth.ts";
import { addSub } from "#/server/notifications/subscriptions.ts";

/**
 * Plain JSON endpoint for (re)registering a Web Push subscription, callable from
 * the service worker's `pushsubscriptionchange` handler — which has no tRPC
 * client. Auth-gated by the session cookie (the SW fetch is same-origin, so the
 * cookie rides along); we never store a subscription without a real user, which
 * is what created the "anonymous" orphan before.
 */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handlePost({ request }: { request: Request }): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user.id;
  if (!userId) return json({ ok: false, error: "unauthorized" }, 401);

  let body: { endpoint?: unknown; p256dh?: unknown; auth?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  const { endpoint, p256dh, auth: authKey } = body;
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof authKey !== "string") {
    return json({ ok: false, error: "missing fields" }, 400);
  }

  await addSub(userId, { endpoint, p256dh, auth: authKey });
  return json({ ok: true }, 200);
}

export const Route = createFileRoute("/api/push/subscribe")({
  server: {
    handlers: {
      POST: handlePost,
    },
  },
});
