/**
 * UOR dining availability sweep (Railway cron, frequent — e.g. "*&#47;15 * * * *").
 * The Universal analog of `dining-availability`, but cheaper: the
 * reservation-availability endpoint is reachable with the anonymous guest
 * session (no login) and one POST returns the whole day-horizon, so it's a
 * single call per (restaurant, party-size). Writes one `dining_obs` row per
 * AVAILABLE slot (+ a "checked, none available" sentinel per date with no
 * availability), source UNIVERSAL_DIRECT.
 *
 * Run:  bun run dining:availability:universal
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { diningObs, restaurantDim } from "#/db/schema.ts";
import { Source, universalMealPeriod } from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";
import { fetchUniversalReservationAvailability } from "#/server/dining/universal-reservations.ts";
import { browserlessConfigured } from "#/server/parks/sources/browserless.ts";
import { withUniversalSession } from "#/server/parks/sources/universal-session.ts";

const PARTY_SIZES = (process.env.DINING_PARTY_SIZES ?? "2,4")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const DAY_HORIZON = Number(process.env.DINING_DAY_HORIZON ?? 14);
const AVAILABLE = "AVAILABLE";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function flush(rows: Array<typeof diningObs.$inferInsert>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(diningObs)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing();
  }
}

async function main() {
  if (!browserlessConfigured()) {
    console.error("[dining-availability-universal] BROWSER_WS_ENDPOINT not set");
    process.exit(1);
  }
  const observedAt = new Date();
  const end = new Date(observedAt);
  end.setDate(end.getDate() + DAY_HORIZON - 1);
  const startDate = isoDate(observedAt);
  const endDate = isoDate(end);

  const targets = await db
    .select({ facilityId: restaurantDim.facilityId })
    .from(restaurantDim)
    .where(
      and(
        eq(restaurantDim.source, Source.UNIVERSAL_DIRECT),
        eq(restaurantDim.bookable, true),
        eq(restaurantDim.active, true),
        eq(restaurantDim.priority, true),
      ),
    );
  if (targets.length === 0) {
    console.warn(
      "[dining-availability-universal] no UOR targets — run dining:facilities:universal first",
    );
    return;
  }

  let total = 0;
  await withUniversalSession(async (page, session) => {
    // Flush per target so a mid-sweep timeout doesn't lose completed work.
    for (const t of targets) {
      const rows: Array<typeof diningObs.$inferInsert> = [];
      // Reservation bounds ride on every response; capture from the first one so
      // we can refresh restaurant_dim once per venue (plan item 3.2).
      let bounds: {
        min_party_size?: number;
        max_party_size?: number;
        min_advanced_minutes?: number;
        max_advanced_days?: number;
      } | null = null;
      for (const partySize of PARTY_SIZES) {
        const avail = await fetchUniversalReservationAvailability(
          page,
          session.headers,
          t.facilityId,
          startDate,
          endDate,
          partySize,
        );
        if (avail && bounds == null) bounds = avail;
        for (const d of avail?.dates ?? []) {
          const serviceDate = d.date.slice(0, 10);
          const open = d.slots.filter((s) => s.availability_status === AVAILABLE);
          if (open.length === 0) {
            rows.push({
              observedAt,
              facilityId: t.facilityId,
              serviceDate,
              partySize,
              source: Source.UNIVERSAL_DIRECT,
            });
          } else {
            for (const s of open) {
              rows.push({
                observedAt,
                facilityId: t.facilityId,
                serviceDate,
                partySize,
                mealPeriod: universalMealPeriod(s.time),
                offerTime: `${s.time}:00`,
                source: Source.UNIVERSAL_DIRECT,
              });
            }
          }
        }
      }
      await flush(rows);
      total += rows.length;

      // Refresh the venue's reservation bounds when the response carried any.
      if (
        bounds &&
        (bounds.min_party_size != null ||
          bounds.max_party_size != null ||
          bounds.min_advanced_minutes != null ||
          bounds.max_advanced_days != null)
      ) {
        await db
          .update(restaurantDim)
          .set({
            minPartySize: bounds.min_party_size ?? null,
            maxPartySize: bounds.max_party_size ?? null,
            minAdvanceMinutes: bounds.min_advanced_minutes ?? null,
            maxAdvanceDays: bounds.max_advanced_days ?? null,
          })
          .where(eq(restaurantDim.facilityId, t.facilityId));
      }
    }
  }, AbortSignal.timeout(config.browserlessTimeoutMs));

  console.log(
    `[dining-availability-universal] ${targets.length} venues × ${PARTY_SIZES.length} parties × ${DAY_HORIZON}d → ${total} rows`,
  );
}

main()
  .catch((err) => {
    reportServiceError("dining-availability-universal", "main", err);
    process.exitCode = 1;
  })
  // Flush queued PostHog events BEFORE exiting — process.exit would drop them.
  .finally(async () => {
    await flushTelemetry();
    process.exit(process.exitCode ?? 0);
  });
