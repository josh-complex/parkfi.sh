import { config } from "../config.ts";
import { QueueTimesSchema, type QueueTimesPayload } from "../schemas.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * queue-times.com — degraded fallback for STANDBY waits + open/closed ONLY.
 * It carries no LL/price data, so during a ThemeParks.wiki outage the app
 * marks LL fields `unknown` rather than going dark on waits.
 *
 * Attribution: a visible "Powered by Queue-Times.com" link is required wherever
 * this data is shown.
 */
export async function fetchQueueTimes(
  queueTimesParkId: string,
  signal: AbortSignal,
): Promise<QueueTimesPayload> {
  const url = `${config.queueTimesBase}/parks/${queueTimesParkId}/queue_times.json`;
  const res = await fetch(url, {
    signal,
    headers: { "user-agent": config.userAgent, accept: "application/json" },
  });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  return QueueTimesSchema.parse(await res.json());
}
