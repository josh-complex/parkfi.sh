import { createFileRoute } from "@tanstack/react-router";

import { auth } from "#/lib/auth.ts";
import {
  beaconBodySchema,
  ingestBeaconBatch,
  rateLimitWaitMs,
} from "#/server/achievements/beacon.ts";
import { serverPostHog } from "#/server/posthog.ts";

/**
 * Native presence beacon endpoint (park-tracking fixes 2, Workstream B).
 * `POST { pings: [{ lng, lat, accuracy, at, stepsCum?, stepsSessionMs? }] }`,
 * 1–50 entries, bearer-authenticated (better-auth's `bearer()` plugin resolves
 * `Authorization: Bearer <token>` — the same token the WebView's tRPC client
 * sends). Plain JSON rather than tRPC because the caller is the Kotlin/Swift
 * monitoring service, mirroring `api/push/subscribe.ts`. All the logic lives in
 * `server/achievements/beacon.ts`; this is the auth/parse shell.
 */
function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function handlePost({ request }: { request: Request }): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user.id;
  if (!userId) return json({ ok: false, error: "unauthorized" }, 401);

  const now = Date.now();
  const wait = rateLimitWaitMs(userId, now);
  if (wait > 0) {
    return json({ ok: false, error: "rate limited" }, 429, {
      "retry-after": String(Math.ceil(wait / 1000)),
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  const parsed = beaconBodySchema.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "invalid body" }, 400);

  const result = await ingestBeaconBatch(userId, parsed.data, now);

  // Server-side counterpart to the client's ping telemetry: per park-day,
  // Σ count here vs user_park_day.pings is the beacon's share of presence —
  // the dashboard number that proves pocketed time is being credited.
  serverPostHog()?.capture({
    distinctId: userId,
    event: "native_beacon_posted",
    properties: {
      count: result.accepted,
      skipped: result.skipped,
      inPark: result.inPark,
      parkId: result.parkId,
    },
  });

  return json({ ok: true, ...result }, 200);
}

export const Route = createFileRoute("/api/native/ping")({
  server: {
    handlers: {
      POST: handlePost,
    },
  },
});
