import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { blogPost } from "#/db/schema.ts";
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
          ),
        )
        .orderBy(desc(blogPost.publishedAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? (items.at(-1)?.publishedAt?.toISOString() ?? null) : null;
      return { items, nextCursor };
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
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
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
