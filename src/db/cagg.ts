/**
 * Applies the continuous aggregate in `cagg.sql` — the one piece of Timescale
 * DDL that can't live in a Drizzle migration (continuous aggregates can't be
 * created inside a transaction block, and drizzle-kit migrate wraps migrations
 * in one).
 *
 * Each statement is executed SEPARATELY: the Postgres simple-query protocol
 * runs a multi-statement string as one implicit transaction, which would
 * re-trigger the very restriction we're avoiding. Run AFTER `db:migrate`.
 *
 *   bun run db:cagg
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";

import { db } from "./index.ts";

const sqlPath = fileURLToPath(new URL("./cagg.sql", import.meta.url));

/** Split into statements, dropping `--` line comments and blank lines. */
function statements(ddl: string): Array<string> {
  return ddl
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  for (const stmt of statements(readFileSync(sqlPath, "utf8"))) {
    await db.execute(sql.raw(stmt));
  }
  console.log("Applied cagg.sql (queue_hourly continuous aggregate + policy).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
