import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { contentSuppression } from "#/db/schema.ts";

/**
 * The set of currently-suppressed fields for one entity, as written by the
 * removal-request admin flow (`content_suppression`). `"*"` means the whole
 * listing is hidden; otherwise it's a field name like `"image"` or `"menu"`.
 * Read paths consult this to blank suppressed content (reversible — an admin can
 * lift a suppression and it reappears).
 */
export async function suppressedFields(entityType: string, entityId: string): Promise<Set<string>> {
  const rows = await db
    .select({ field: contentSuppression.field })
    .from(contentSuppression)
    .where(
      and(
        eq(contentSuppression.entityType, entityType),
        eq(contentSuppression.entityId, entityId),
        eq(contentSuppression.active, true),
      ),
    );
  return new Set(rows.map((r) => r.field));
}

/** True when the whole listing (`"*"`) or the named field is suppressed. */
export function isSuppressed(fields: Set<string>, field: string): boolean {
  return fields.has("*") || fields.has(field);
}
