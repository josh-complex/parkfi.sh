import { config } from "../config.ts";
import { themeparksBucket } from "../ratelimit.ts";
import {
  EntityChildrenSchema,
  LiveSchema,
  type EntityChildrenPayload,
  type LivePayload,
} from "../schemas.ts";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    signal,
    headers: { "user-agent": config.userAgent, accept: "application/json" },
  });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  return res.json();
}

/** Live data for a park entity (waits + LL availability + LL price + sell-out). */
export async function fetchLive(parkUuid: string, signal: AbortSignal): Promise<LivePayload> {
  await themeparksBucket.take();
  const json = await getJson(`${config.themeparksBase}/entity/${parkUuid}/live`, signal);
  // zod parse = schema-drift guard
  return LiveSchema.parse(json);
}

export interface DestinationPark {
  id: string;
  name: string;
}
export interface Destination {
  id: string;
  name: string;
  slug: string;
  parks: Array<DestinationPark>;
}

/**
 * Children of a park entity (attractions/shows/restaurants) WITH geo `location`.
 * The geo backbone: each child's `externalId` is the operator numeric id and the
 * UUID is our `external_ids` join key. Used by the monthly geo cron, not the
 * live poller, so it takes a rate-limit token like the other themeparks calls.
 */
export async function fetchChildren(
  parkUuid: string,
  signal: AbortSignal,
): Promise<EntityChildrenPayload> {
  await themeparksBucket.take();
  const json = await getJson(`${config.themeparksBase}/entity/${parkUuid}/children`, signal);
  return EntityChildrenSchema.parse(json);
}

/** All destinations (used by seeding / park discovery). */
export async function fetchDestinations(signal: AbortSignal): Promise<Array<Destination>> {
  await themeparksBucket.take();
  const json = (await getJson(`${config.themeparksBase}/destinations`, signal)) as {
    destinations?: Array<Destination>;
  };
  return json.destinations ?? [];
}
