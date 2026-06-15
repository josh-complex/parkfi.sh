import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { pinPublicUrl } from "#/server/pins/storage.ts";
import { publicProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

/**
 * Public read API for the reference catalog. `browse` is the filterable grid
 * (series / character / year / price), `search` is the trigram-ranked text
 * lookup (mirrors the dining/menu trigram pattern), and `detail` is a single
 * pin with all its reference images. `facets` powers the filter dropdowns.
 */

/** Shared SELECT of a pin card + its primary reference image. */
const pinCardSql = sql`
  SELECT p.id, p.name, p.series, p.characters, p.year, p.edition_type,
         p.le_count, p.park, p.est_value_cents,
         (SELECT r2_key FROM pin_image i WHERE i.pin_id = p.id
          ORDER BY i.is_primary DESC, i.created_at LIMIT 1) AS r2_key
`;

type PinCardRow = {
  id: string;
  name: string;
  series: string | null;
  characters: string[] | null;
  year: number | null;
  edition_type: string | null;
  le_count: number | null;
  park: string | null;
  est_value_cents: number | null;
  r2_key: string | null;
};

function toCard(r: PinCardRow) {
  return {
    id: r.id,
    name: r.name,
    series: r.series,
    characters: r.characters ?? [],
    year: r.year,
    editionType: r.edition_type,
    leCount: r.le_count,
    park: r.park,
    estValueCents: r.est_value_cents,
    imageUrl: r.r2_key ? pinPublicUrl(r.r2_key) : null,
  };
}

const browseInput = z.object({
  series: z.string().optional(),
  character: z.string().optional(),
  year: z.number().int().optional(),
  minValueCents: z.number().int().nonnegative().optional(),
  maxValueCents: z.number().int().nonnegative().optional(),
  sort: z.enum(["name", "year_desc", "value_desc"]).default("name"),
  limit: z.number().int().min(1).max(60).default(30),
  cursor: z.number().int().nonnegative().default(0),
});

export const pinCatalogRouter = {
  /** Filterable, paginated grid. Returns `{ pins, nextCursor }`. */
  browse: publicProcedure.input(browseInput).query(async ({ input }) => {
    const where = [sql`true`];
    if (input.series) where.push(sql`p.series = ${input.series}`);
    if (input.character) where.push(sql`${input.character} = ANY(p.characters)`);
    if (input.year != null) where.push(sql`p.year = ${input.year}`);
    if (input.minValueCents != null) where.push(sql`p.est_value_cents >= ${input.minValueCents}`);
    if (input.maxValueCents != null) where.push(sql`p.est_value_cents <= ${input.maxValueCents}`);

    const order =
      input.sort === "year_desc"
        ? sql`p.year DESC NULLS LAST, p.name`
        : input.sort === "value_desc"
          ? sql`p.est_value_cents DESC NULLS LAST, p.name`
          : sql`p.name`;

    const { rows } = await db.execute<PinCardRow>(sql`
      ${pinCardSql}
      FROM pin p
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY ${order}
      LIMIT ${input.limit + 1} OFFSET ${input.cursor}
    `);

    const hasMore = rows.length > input.limit;
    const pins = rows.slice(0, input.limit).map(toCard);
    return { pins, nextCursor: hasMore ? input.cursor + input.limit : null };
  }),

  /** Trigram-ranked text search over pin names. */
  search: publicProcedure
    .input(z.object({ q: z.string(), limit: z.number().int().min(1).max(30).default(12) }))
    .query(async ({ input }) => {
      const q = input.q.trim();
      if (q.length < 2) return [];
      const { rows } = await db.execute<PinCardRow>(sql`
        ${pinCardSql}
        FROM pin p
        WHERE p.name % ${q} OR p.name ILIKE '%' || ${q} || '%'
        ORDER BY similarity(p.name, ${q}) DESC, p.name
        LIMIT ${input.limit}
      `);
      return rows.map(toCard);
    }),

  /** A single pin with every reference image + the live trade-availability count. */
  detail: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const { rows } = await db.execute<PinCardRow>(sql`
        ${pinCardSql}
        FROM pin p
        WHERE p.id = ${input.id}::uuid
      `);
    const pin = rows[0];
    if (!pin) return null;

    const images = await db.execute<{ id: string; r2_key: string; is_primary: boolean }>(sql`
        SELECT id, r2_key, is_primary FROM pin_image
        WHERE pin_id = ${input.id}::uuid
        ORDER BY is_primary DESC, created_at
      `);

    const counts = await db.execute<{ have_for_trade: number; want: number }>(sql`
        SELECT
          (SELECT count(*) FROM pin_have WHERE pin_id = ${input.id}::uuid AND for_trade) AS have_for_trade,
          (SELECT count(*) FROM pin_want WHERE pin_id = ${input.id}::uuid) AS want
      `);

    return {
      ...toCard(pin),
      images: images.rows.map((i) => ({
        id: i.id,
        url: pinPublicUrl(i.r2_key),
        isPrimary: i.is_primary,
      })),
      availableForTrade: Number(counts.rows[0]?.have_for_trade ?? 0),
      wantedBy: Number(counts.rows[0]?.want ?? 0),
    };
  }),

  /** Distinct series + characters + year range for the filter UI. */
  facets: publicProcedure.query(async () => {
    const [series, characters, years] = await Promise.all([
      db.execute<{ series: string }>(sql`
        SELECT DISTINCT series FROM pin WHERE series IS NOT NULL ORDER BY series LIMIT 200
      `),
      db.execute<{ character: string }>(sql`
        SELECT DISTINCT unnest(characters) AS character FROM pin ORDER BY character LIMIT 300
      `),
      db.execute<{ min: number | null; max: number | null }>(sql`
        SELECT min(year) AS min, max(year) AS max FROM pin
      `),
    ]);
    return {
      series: series.rows.map((r) => r.series),
      characters: characters.rows.map((r) => r.character),
      yearMin: years.rows[0]?.min ?? null,
      yearMax: years.rows[0]?.max ?? null,
    };
  }),
} satisfies TRPCRouterRecord;
