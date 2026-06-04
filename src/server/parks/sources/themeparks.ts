import { config } from "../config.ts";
import { themeparksBucket } from "../ratelimit.ts";
import { LiveSchema, type LivePayload } from "../schemas.ts";

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

/** All destinations (used by seeding / park discovery). */
export async function fetchDestinations(signal: AbortSignal): Promise<Array<Destination>> {
  await themeparksBucket.take();
  const json = (await getJson(`${config.themeparksBase}/destinations`, signal)) as {
    destinations?: Array<Destination>;
  };
  return json.destinations ?? [];
}
