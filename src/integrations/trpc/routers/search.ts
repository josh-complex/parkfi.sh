import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { publicProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

export const searchRouter = {
  global: publicProcedure
    .input(
      z.object({
        q: z.string().min(1).max(100),
      }),
    )
    .query(async ({ input }) => {
      const query = `%${input.q.toLowerCase()}%`;

      const [parks, attractions, dining, blogPosts] = await Promise.all([
        db.execute<{ id: string; name: string; slug: string }>(sql`
          SELECT id, name, slug
          FROM parks
          WHERE active = true AND LOWER(name) LIKE LOWER(${query})
          LIMIT 5
        `),
        db.execute<{ id: string; name: string; park_slug: string; park_name: string }>(sql`
          SELECT a.id, a.name, p.slug AS park_slug, p.name AS park_name
          FROM attractions a
          JOIN parks p ON p.id = a.park_id
          WHERE a.active = true AND LOWER(a.name) LIKE LOWER(${query})
          LIMIT 5
        `),
        db.execute<{ facility_id: string; name: string; park_resort: string }>(sql`
          SELECT facility_id, name, park_resort
          FROM restaurant_dim
          WHERE LOWER(name) LIKE LOWER(${query}) AND priority = true AND active = true
          LIMIT 5
        `),
        db.execute<{ id: string; slug: string; title: string }>(sql`
          SELECT id, slug, title
          FROM blog_post
          WHERE status = 'published' AND (
            LOWER(title) LIKE LOWER(${query})
            OR LOWER(dek) LIKE LOWER(${query})
          )
          LIMIT 5
        `),
      ]);

      return {
        parks: parks.rows.map((p) => ({
          type: "park" as const,
          id: p.id,
          name: p.name,
          slug: p.slug,
        })),
        attractions: attractions.rows.map((a) => ({
          type: "attraction" as const,
          id: a.id,
          name: a.name,
          parkName: a.park_name,
          parkSlug: a.park_slug,
        })),
        dining: dining.rows.map((d) => ({
          type: "dining" as const,
          id: d.facility_id,
          name: d.name,
          parkName: d.park_resort,
        })),
        blogPosts: blogPosts.rows.map((b) => ({
          type: "blog" as const,
          id: b.id,
          title: b.title,
          slug: b.slug,
        })),
      };
    }),
} satisfies TRPCRouterRecord;
