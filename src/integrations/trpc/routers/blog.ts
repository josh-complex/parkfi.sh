import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, arrayOverlaps, desc, eq, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { blogPost, newsItem } from "#/db/schema.ts";
import { renderMarkdown } from "#/server/blog/render.ts";
import { purgeEdge } from "#/server/edge/purge.ts";
import { adminProcedure, publicProcedure } from "../init.ts";

interface SourceUrl {
  title: string;
  url: string;
}

/** Card-level fields for list views (no body). */
const listColumns = {
  slug: blogPost.slug,
  title: blogPost.title,
  dek: blogPost.dek,
  tags: blogPost.tags,
  heroImageUrl: blogPost.heroImageUrl,
  publishedAt: blogPost.publishedAt,
};

export const blogRouter = {
  /** Published posts, newest first, keyset-paginated by publishedAt. */
  list: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).default(20),
          /** ISO timestamp of the last item from the previous page. */
          cursor: z.string().optional(),
          /** Filter to a single topic tag (archival sidebar quicklink). */
          tag: z.string().optional(),
          /** Filter to a calendar month, "YYYY-MM" (archive quicklink). */
          month: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 20;
      const rows = await db
        .select(listColumns)
        .from(blogPost)
        .where(
          and(
            eq(blogPost.status, "published"),
            input?.cursor ? lt(blogPost.publishedAt, new Date(input.cursor)) : undefined,
            input?.tag ? arrayOverlaps(blogPost.tags, [input.tag]) : undefined,
            input?.month
              ? sql`to_char(${blogPost.publishedAt} at time zone 'utc', 'YYYY-MM') = ${input.month}`
              : undefined,
          ),
        )
        .orderBy(desc(blogPost.publishedAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? (items.at(-1)?.publishedAt?.toISOString() ?? null) : null;
      return { items, nextCursor };
    }),

  /** Sidebar payload: our recent posts, topic tags, and a month-by-month archive. */
  sidebar: publicProcedure
    .input(z.object({ recentLimit: z.number().int().min(1).max(12).default(6) }).optional())
    .query(async ({ input }) => {
      const recentLimit = input?.recentLimit ?? 6;
      const [recent, tags, months] = await Promise.all([
        db
          .select(listColumns)
          .from(blogPost)
          .where(eq(blogPost.status, "published"))
          .orderBy(desc(blogPost.publishedAt))
          .limit(recentLimit),
        db
          .select({
            tag: sql<string>`tag`.as("tag"),
            count: sql<number>`count(*)::int`.as("count"),
          })
          .from(sql`${blogPost}, unnest(${blogPost.tags}) as tag`)
          .where(eq(blogPost.status, "published"))
          .groupBy(sql`tag`)
          .orderBy(sql`count(*) desc`, sql`tag asc`)
          .limit(15),
        db
          .select({
            month: sql<string>`to_char(${blogPost.publishedAt} at time zone 'utc', 'YYYY-MM')`.as(
              "month",
            ),
            count: sql<number>`count(*)::int`.as("count"),
          })
          .from(blogPost)
          .where(and(eq(blogPost.status, "published"), sql`${blogPost.publishedAt} is not null`))
          .groupBy(sql`month`)
          .orderBy(sql`month desc`)
          .limit(24),
      ]);
      return { recent, tags, months };
    }),

  /**
   * "Around the parks" — the latest items pulled from the RSS suppliers the
   * park-news cron ingests, grouped into one shelf per source (newest source
   * first) for the homepage carousels. Links out to the original article.
   */
  externalFeed: publicProcedure
    .input(z.object({ perSource: z.number().int().min(1).max(20).default(12) }).optional())
    .query(async ({ input }) => {
      const perSource = input?.perSource ?? 12;
      const rows = await db
        .select({
          source: newsItem.source,
          title: newsItem.title,
          url: newsItem.url,
          publishedAt: sql<Date>`coalesce(${newsItem.publishedAt}, ${newsItem.fetchedAt})`.as("ts"),
        })
        .from(newsItem)
        .orderBy(desc(sql`coalesce(${newsItem.publishedAt}, ${newsItem.fetchedAt})`))
        .limit(300);

      // Group newest-first rows into per-source shelves, preserving the order in
      // which each source's freshest item appeared (so shelves sort newest-first).
      const shelves: Array<{ source: string; items: typeof rows }> = [];
      const bySource = new Map<string, (typeof shelves)[number]>();
      for (const row of rows) {
        let shelf = bySource.get(row.source);
        if (!shelf) {
          shelf = { source: row.source, items: [] };
          bySource.set(row.source, shelf);
          shelves.push(shelf);
        }
        if (shelf.items.length < perSource) shelf.items.push(row);
      }
      return shelves;
    }),

  /** "Keep reading" cards: posts sharing a tag or park, newest first;
   *  falls back to the most recent posts when nothing overlaps. */
  related: publicProcedure
    .input(z.object({ slug: z.string(), limit: z.number().int().min(1).max(6).default(3) }))
    .query(async ({ input }) => {
      const [post] = await db
        .select({ tags: blogPost.tags, parkSlugs: blogPost.parkSlugs })
        .from(blogPost)
        .where(and(eq(blogPost.slug, input.slug), eq(blogPost.status, "published")))
        .limit(1);
      if (!post) return [];

      const overlap =
        post.tags.length > 0 || post.parkSlugs.length > 0
          ? or(
              post.tags.length > 0 ? arrayOverlaps(blogPost.tags, post.tags) : undefined,
              post.parkSlugs.length > 0
                ? arrayOverlaps(blogPost.parkSlugs, post.parkSlugs)
                : undefined,
            )
          : undefined;

      const related = await db
        .select(listColumns)
        .from(blogPost)
        .where(and(eq(blogPost.status, "published"), ne(blogPost.slug, input.slug), overlap))
        .orderBy(desc(blogPost.publishedAt))
        .limit(input.limit);

      if (related.length >= input.limit) return related;

      // Top up with recent posts (excluding the current + already-picked).
      const have = new Set([input.slug, ...related.map((r) => r.slug)]);
      const recent = await db
        .select(listColumns)
        .from(blogPost)
        .where(and(eq(blogPost.status, "published"), ne(blogPost.slug, input.slug)))
        .orderBy(desc(blogPost.publishedAt))
        .limit(input.limit + related.length);
      for (const r of recent) {
        if (related.length >= input.limit) break;
        if (!have.has(r.slug)) {
          related.push(r);
          have.add(r.slug);
        }
      }
      return related;
    }),

  /** A single published post, with its body rendered to sanitized HTML. */
  bySlug: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ input }) => {
    const [post] = await db
      .select()
      .from(blogPost)
      .where(and(eq(blogPost.slug, input.slug), eq(blogPost.status, "published")))
      .limit(1);
    if (!post) throw new TRPCError({ code: "NOT_FOUND" });
    return {
      slug: post.slug,
      title: post.title,
      dek: post.dek,
      bodyHtml: renderMarkdown(post.bodyMd),
      tags: post.tags,
      parkSlugs: post.parkSlugs,
      sourceUrls: (post.sourceUrls as Array<SourceUrl>) ?? [],
      heroImageUrl: post.heroImageUrl,
      heroImageAlt: post.heroImageAlt,
      heroImageCredit: post.heroImageCredit,
      heroImageCreditUrl: post.heroImageCreditUrl,
      publishedAt: post.publishedAt,
    };
  }),

  // --- Admin (auth-gated): the draft → approve → publish queue ---------------

  /** All drafts (and archived), newest first — the review queue. */
  drafts: adminProcedure.query(async () => {
    return db
      .select({
        id: blogPost.id,
        slug: blogPost.slug,
        title: blogPost.title,
        dek: blogPost.dek,
        status: blogPost.status,
        tags: blogPost.tags,
        parkSlugs: blogPost.parkSlugs,
        sourceUrls: blogPost.sourceUrls,
        model: blogPost.model,
        createdAt: blogPost.createdAt,
      })
      .from(blogPost)
      .where(sql`${blogPost.status} <> 'published'`)
      .orderBy(desc(blogPost.createdAt));
  }),

  /** Full draft incl. rendered preview, for the review screen. */
  draftById: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const [post] = await db.select().from(blogPost).where(eq(blogPost.id, input.id)).limit(1);
    if (!post) throw new TRPCError({ code: "NOT_FOUND" });
    return { ...post, bodyHtml: renderMarkdown(post.bodyMd) };
  }),

  /** Edit a draft before publishing. */
  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        dek: z.string().min(1).optional(),
        bodyMd: z.string().min(1).optional(),
        tags: z.array(z.string()).optional(),
        // Empty string clears the hero (e.g. a hallucinated / broken image).
        heroImageUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, heroImageUrl, ...rest } = input;
      const patch: Record<string, unknown> = { ...rest };
      if (heroImageUrl !== undefined) {
        const url = heroImageUrl.trim();
        // Clearing the image also clears its now-orphaned credit/alt.
        patch.heroImageUrl = url || null;
        if (!url) {
          patch.heroImageAlt = null;
          patch.heroImageCredit = null;
          patch.heroImageCreditUrl = null;
        }
      }
      await db.update(blogPost).set(patch).where(eq(blogPost.id, id));
      return { ok: true };
    }),

  /** Approve → publish. Stamps publishedAt and purges the edge so it appears now. */
  approve: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const [post] = await db
      .update(blogPost)
      .set({ status: "published", publishedAt: sql`now()` })
      .where(eq(blogPost.id, input.id))
      .returning({ slug: blogPost.slug });
    if (!post) throw new TRPCError({ code: "NOT_FOUND" });
    // Best-effort: make the new post visible immediately past the edge TTL.
    void purgeEdge(["/blog", `/blog/${post.slug}`, "/blog/rss.xml", "/sitemap.xml"]);
    return { ok: true, slug: post.slug };
  }),

  /** Reject a draft (soft-archive; keeps provenance for audit). */
  reject: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await db.update(blogPost).set({ status: "archived" }).where(eq(blogPost.id, input.id));
    return { ok: true };
  }),
} satisfies TRPCRouterRecord;
