import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { r2, R2_BUCKET } from "#/lib/r2.ts";
import { removeAllSubs } from "#/server/notifications/subscriptions.ts";
import { serverPostHog } from "#/server/posthog.ts";

/**
 * Personal-data cleanup for account deletion, run from better-auth's
 * `user.deleteUser.beforeDelete` hook (see `lib/auth.ts`). The auth-schema rows
 * (sessions, accounts/providers, 2FA, passkeys) and the user's alert rows are
 * removed by DB cascades when better-auth deletes the `user` row; this covers
 * everything the privacy policy promises that lives OUTSIDE those cascades:
 *
 *  - the uploaded avatar object in R2 (`avatars/{userId}.webp`)
 *  - web-push subscriptions in Redis (`push:user:{id}` + `push:sub:{hash}`)
 *  - `stay_query` sweep rows that exist only to back this user's alerts
 *    (no FK to user — linked via `stay_alert.query_id`)
 *  - the user's PostHog person + events (when a personal API key is configured)
 *
 * It runs BEFORE the user row is deleted because the stay-query step needs the
 * user's `stay_alert` rows to still exist, and so a crash mid-cleanup leaves an
 * account the user can simply retry deleting. Each step is best-effort: a
 * failure is reported to PostHog but never blocks the deletion itself —
 * honouring the delete request beats aborting over a leftover avatar object.
 */
export async function cleanupUserData(userId: string): Promise<void> {
  const steps: Array<[step: string, run: () => Promise<void>]> = [
    ["r2-avatar", () => deleteAvatar(userId)],
    ["push-subscriptions", () => removeAllSubs(userId)],
    ["stay-queries", () => deleteOrphanedStayQueries(userId)],
    ["posthog-person", () => deletePostHogPerson(userId)],
  ];
  await Promise.all(
    steps.map(async ([step, run]) => {
      try {
        await run();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[account-cleanup] ${step} failed for user ${userId}:`, err);
        serverPostHog()?.captureException(err, userId, {
          source: "account-cleanup",
          cleanup_step: step,
          service: "web",
        });
      }
    }),
  );
}

/** Avatar uploads always land at this fixed key (see routers/uploads.ts). */
async function deleteAvatar(userId: string): Promise<void> {
  // S3/R2 DeleteObject is idempotent — no error when the user never uploaded one.
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: `avatars/${userId}.webp` }));
}

/**
 * Drop `stay_query` rows that only this user's alerts reference. The user's
 * `stay_alert` rows still exist here (we run before the user-row cascade), so
 * "referenced by someone else" is the only reason to keep a row. Deleting the
 * query cascades this user's alerts pointing at it — harmless, the rest go with
 * the user row moments later. Queries shared with other users' alerts survive
 * untouched (they hold no per-user data; dims are deduped across users).
 */
async function deleteOrphanedStayQueries(userId: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM stay_query
    WHERE id IN (SELECT query_id FROM stay_alert WHERE user_id = ${userId})
      AND NOT EXISTS (
        SELECT 1 FROM stay_alert
        WHERE query_id = stay_query.id AND user_id <> ${userId}
      )
  `);
}

/**
 * Delete the user's PostHog person (and their events) via the private REST API.
 * The client identifies users by their Better-Auth id (`ph.identify(userId)` in
 * integrations/posthog/provider.tsx), so the distinct_id IS the user id. The
 * capture client in server/posthog.ts can't do this — person deletion needs a
 * personal API key + project id, so this no-ops until those are configured.
 * Private endpoints live on the app host (us.posthog.com), not the ingestion
 * host (us.i.posthog.com) used by POSTHOG_HOST.
 */
async function deletePostHogPerson(userId: string): Promise<void> {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) return;
  const host = process.env.POSTHOG_API_HOST ?? "https://us.posthog.com";
  const headers = { Authorization: `Bearer ${apiKey}` };

  // distinct_id → internal person id (deletion is keyed on the latter).
  const lookup = await fetch(
    `${host}/api/projects/${projectId}/persons/?distinct_id=${encodeURIComponent(userId)}`,
    { headers },
  );
  if (!lookup.ok) throw new Error(`PostHog person lookup failed: ${lookup.status}`);
  const { results } = (await lookup.json()) as { results: Array<{ id: number }> };

  for (const person of results) {
    const res = await fetch(
      `${host}/api/projects/${projectId}/persons/${person.id}/?delete_events=true`,
      { method: "DELETE", headers },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`PostHog person ${person.id} delete failed: ${res.status}`);
    }
  }
}
