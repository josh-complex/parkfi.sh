import { z } from "zod";

/**
 * Versioned zod schemas validating the *real* upstream shapes (verified live
 * against Magic Kingdom). Validation is the schema-drift guard: on a shape
 * change we archive + alert rather than crash ingestion.
 */

const Price = z.object({
  amount: z.number(),
  currency: z.string().optional(),
  formatted: z.string().optional(),
});

const Queue = z
  .object({
    STANDBY: z.object({ waitTime: z.number().nullable() }).optional(),
    SINGLE_RIDER: z.object({ waitTime: z.number().nullable() }).optional(),
    PAID_STANDBY: z.object({ waitTime: z.number().nullable() }).optional(),
    RETURN_TIME: z
      .object({
        state: z.string().optional(),
        returnStart: z.string().nullable().optional(),
        returnEnd: z.string().nullable().optional(),
      })
      .optional(),
    PAID_RETURN_TIME: z
      .object({
        state: z.string().optional(),
        price: Price.optional(),
        returnStart: z.string().nullable().optional(),
        returnEnd: z.string().nullable().optional(),
      })
      .optional(),
    BOARDING_GROUP: z
      .object({
        state: z.string().optional(),
        currentGroupStart: z.number().nullable().optional(),
        currentGroupEnd: z.number().nullable().optional(),
        allocationStatus: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export const LiveEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  entityType: z.string(),
  parkId: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  lastUpdated: z.string().nullable().optional(),
  queue: Queue.optional(),
});
export type LiveEntity = z.infer<typeof LiveEntitySchema>;

export const LiveSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  liveData: z.array(LiveEntitySchema),
});
export type LivePayload = z.infer<typeof LiveSchema>;

// queue-times.com — wait times + open/closed only (degraded fallback)
export const QueueTimesSchema = z.object({
  lands: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        rides: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
            is_open: z.boolean(),
            wait_time: z.number(),
            last_updated: z.string().nullable().optional(),
          }),
        ),
      }),
    )
    .default([]),
  // some parks expose top-level `rides` with no lands
  rides: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        is_open: z.boolean(),
        wait_time: z.number(),
        last_updated: z.string().nullable().optional(),
      }),
    )
    .optional(),
});
export type QueueTimesPayload = z.infer<typeof QueueTimesSchema>;

// Disney availability-calendar.
// Fields are optional because the endpoint returns placeholder entries (`[{}]`)
// for anonymous callers / segments with no data. The cron filters to usable
// entries rather than crashing on the empties.
export const AvailabilityCalendarSchema = z.array(
  z.object({
    date: z.string().optional(),
    availability: z.string().optional(),
    parks: z.array(z.string()).default([]),
  }),
);
export type AvailabilityCalendar = z.infer<typeof AvailabilityCalendarSchema>;
