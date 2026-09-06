/**
 * Every adapter we ship, in the order the cron runs them. The UI reads the
 * agency label from here so "View on City of Orlando" never drifts from the
 * adapter that produced the record.
 */
import { faaOeaaaAdapter } from "./adapters/faa-oeaaa.ts";
import { orlandoSodaAdapter } from "./adapters/orlando-soda.ts";
import { usptoPatentAdapter } from "./adapters/uspto-patent.ts";
import { usptoTmAdapter } from "./adapters/uspto-tm.ts";

import type { Adapter } from "./types.ts";

export const ADAPTERS: ReadonlyArray<Adapter> = [
  orlandoSodaAdapter,
  usptoTmAdapter,
  usptoPatentAdapter,
  faaOeaaaAdapter,
];

const BY_SOURCE = new Map(ADAPTERS.map((a) => [a.source, a]));

/** Human agency name for a ledger `source`, falling back to the id itself. */
export function agencyFor(source: string): string {
  return BY_SOURCE.get(source)?.agency ?? source;
}
