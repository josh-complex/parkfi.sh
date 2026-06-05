/**
 * Disney ticket / park-pass availability poll (Railway cron, e.g. "0 8 * * *").
 * Single-shot: fetch the availability-calendar window, snapshot into
 * `ticket_availability`, exit. Idempotent on the table PK.
 *
 * Run:  bun run cron:tickets   (or: tsx services/cron-tickets/main.ts)
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { externalIds, ticketAvailability } from "#/db/schema.ts";
import { availabilityToQueueState, QueueState, Source } from "#/server/parks/codes.ts";
import { fetchAvailabilityCalendar } from "#/server/parks/sources/disney.ts";
import { config } from "#/server/parks/config.ts";

const SEGMENT = "tickets" as const;
const WINDOW_DAYS = Number(process.env.TICKET_WINDOW_DAYS ?? 60);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function disneyParkMap(): Promise<Map<string, number>> {
  const rows = await db
    .select({ externalId: externalIds.externalId, entityId: externalIds.entityId })
    .from(externalIds)
    .where(and(eq(externalIds.source, Source.DISNEY_DIRECT), eq(externalIds.entityKind, "park")));
  return new Map(rows.map((r) => [r.externalId, r.entityId]));
}

async function main() {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + WINDOW_DAYS);
  const snapshotDate = isoDate(today);

  const parkMap = await disneyParkMap();
  if (parkMap.size === 0) {
    console.warn("[cron-tickets] no disney_direct park mappings — run db:seed first");
    return;
  }

  const calendar = await fetchAvailabilityCalendar(
    isoDate(today),
    isoDate(end),
    SEGMENT,
    AbortSignal.timeout(config.fetchTimeoutMs),
  );

  // Disney returns placeholder entries (e.g. `[{}]`) when there's no data to
  // report for anonymous callers — keep only entries with a real date+state.
  const usable = calendar.filter(
    (e): e is { date: string; availability: string; parks: Array<string> } =>
      typeof e.date === "string" && typeof e.availability === "string",
  );

  if (usable.length === 0) {
    console.warn(
      `[cron-tickets] Disney returned ${calendar.length} entr${calendar.length === 1 ? "y" : "ies"} with no usable availability ` +
        `(the calendar gates data behind an authenticated session; standard-ticket Park Pass was retired). Nothing to record.`,
    );
    return;
  }

  const rows: Array<typeof ticketAvailability.$inferInsert> = [];
  for (const entry of usable) {
    const available = new Set(entry.parks);
    for (const [disneyId, parkId] of parkMap) {
      const state = available.has(disneyId)
        ? availabilityToQueueState(entry.availability)
        : QueueState.SOLD_OUT;
      rows.push({
        snapshotDate,
        parkId,
        serviceDate: entry.date,
        segment: SEGMENT,
        state,
        source: Source.DISNEY_DIRECT,
      });
    }
  }

  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(ticketAvailability)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing();
  }
  console.log(
    `[cron-tickets] ${usable.length} dates × ${parkMap.size} parks → ${rows.length} rows`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
