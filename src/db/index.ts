import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema.ts";

// Worker/seed/cron entrypoints load dotenv themselves, but the web server
// (nitro/vite dev) does not — so without this the tRPC API has no DATABASE_URL
// and node-postgres silently falls back to localhost defaults. No-op in prod,
// where the platform injects env and the .env files are absent.
if (!process.env.DATABASE_URL) loadEnv({ path: [".env.local", ".env"] });

export const db = drizzle(process.env.DATABASE_URL!, { schema });
