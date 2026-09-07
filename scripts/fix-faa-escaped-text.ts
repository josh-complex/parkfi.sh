/**
 * One-off: FAA OE/AAA rows ingested before 2026-09-06 carry the archive's
 * literal `\r\n` escapes in `description` / `address` (and a doubled period
 * where the proposal already ended in one). Re-derive both columns with the
 * adapter's current helpers and recompute `content_hash` so the next cron run
 * sees them as unchanged — no `public_record_revision` row, no `changed_at`
 * bump, because nothing about the filing itself changed.
 *
 * Dry-run by default (prints the before/after); `--apply` writes.
 *
 *   bun scripts/fix-faa-escaped-text.ts
 *   bun scripts/fix-faa-escaped-text.ts --apply
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { publicRecord } from "#/db/schema.ts";
import {
  FAA_OEAAA_SOURCE,
  composeDescription,
  joinAddressLines,
} from "#/server/records/adapters/faa-oeaaa.ts";
import { cleanText, contentHash, decodeEscapedWhitespace } from "#/server/records/normalize.ts";

import type { PublicRecordInput } from "#/server/records/types.ts";

const apply = process.argv.includes("--apply");

/** `description` was `${proposal}. Location: ${address}` — peel the address back off. */
function proposalOf(description: string | null, address: string | null): string | null {
  if (!description) return null;
  if (!address) return description;
  const suffix = `Location: ${address}`;
  if (description === suffix) return null;
  if (description.endsWith(`. ${suffix}`)) return description.slice(0, -(suffix.length + 2));
  return description;
}

const rows = await db.select().from(publicRecord).where(eq(publicRecord.source, FAA_OEAAA_SOURCE));
let changed = 0;
let skipped = 0;
for (const row of rows) {
  // Guard: only touch rows whose stored hash we can reproduce from the columns,
  // otherwise the recomputed hash would be meaningless.
  const asInput = row as unknown as PublicRecordInput;
  if (contentHash(asInput) !== row.contentHash) {
    console.warn(`#${row.id} ${row.externalId}: stored hash not reproducible, skipping`);
    skipped++;
    continue;
  }
  const address = joinAddressLines(row.address);
  const proposal = cleanText(
    decodeEscapedWhitespace(proposalOf(row.description, row.address) ?? ""),
  );
  const description = composeDescription(proposal, address);
  if (address === row.address && description === row.description) continue;
  changed++;
  const next = { ...asInput, address, description };
  console.log(`#${row.id} ${row.externalId}`);
  console.log(
    `  address:     ${JSON.stringify(row.address)}\n            -> ${JSON.stringify(address)}`,
  );
  console.log(
    `  description: ${JSON.stringify(row.description)}\n            -> ${JSON.stringify(description)}`,
  );
  if (apply) {
    await db
      .update(publicRecord)
      .set({ address, description, contentHash: contentHash(next) })
      .where(eq(publicRecord.id, row.id));
  }
}
console.log(
  `${rows.length} FAA rows, ${changed} ${apply ? "rewritten" : "would change"}, ${skipped} skipped${apply ? "" : " (dry run — pass --apply to write)"}`,
);
process.exit(0);
