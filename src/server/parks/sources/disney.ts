import { config } from "../config.ts";
import { AvailabilityCalendarSchema, type AvailabilityCalendar } from "../schemas.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * Disney park-pass / ticket-date availability. Public, no auth — but requires a
 * normal User-Agent. Returns one entry per date with an availability state and
 * the Disney numeric park IDs that the state applies to.
 *
 * segment ∈ 'tickets' | 'resort' | 'passholder'
 */
export async function fetchAvailabilityCalendar(
  startDate: string,
  endDate: string,
  segment: "tickets" | "resort" | "passholder",
  signal: AbortSignal,
): Promise<AvailabilityCalendar> {
  const url = `${config.disneyAvailabilityBase}/calendar?segment=${segment}&startDate=${startDate}&endDate=${endDate}`;
  const res = await fetch(url, {
    signal,
    headers: {
      "user-agent": config.userAgent,
      accept: "application/json",
    },
  });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  return AvailabilityCalendarSchema.parse(await res.json());
}
