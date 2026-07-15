import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { BlogSidebar } from "#/components/blog/blog-sidebar.tsx";
import { BlogTickerHeader } from "#/components/blog/blog-ticker-header.tsx";
import { ExternalCard, type ExternalItem } from "#/components/blog/external-shelves.tsx";
import { HeroCarousel, type HeroSlideData } from "#/components/blog/hero-carousel.tsx";
import { PostCard, type PostCardData } from "#/components/blog/post-card.tsx";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { blogJsonLd, seo } from "#/lib/seo.ts";

interface BlogSearch {
  tag?: string;
  month?: string;
}

/** Cap on how many external items mix into the main feed, newest-first. */
const MAX_MIXED_EXTERNAL = 12;

export const Route = createFileRoute("/blog/")({
  component: BlogIndex,
  validateSearch: (search: Record<string, unknown>): BlogSearch => ({
    tag: typeof search.tag === "string" ? search.tag : undefined,
    month:
      typeof search.month === "string" && /^\d{4}-\d{2}$/.test(search.month)
        ? search.month
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ tag: search.tag, month: search.month }),
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        context.trpc.blog.list.queryOptions({ limit: 20, tag: deps.tag, month: deps.month }),
      ),
      context.queryClient.ensureQueryData(
        context.trpc.blog.sidebar.queryOptions({ recentLimit: 6 }),
      ),
    ]);
    void context.queryClient.prefetchQuery(
      context.trpc.blog.externalFeed.queryOptions({ perSource: 12 }),
    );
  },
  head: () =>
    seo({
      title: "Orlando Theme Park News & Analysis — ParkFi",
      description:
        "Daily analysis of Walt Disney World and Universal Orlando news — ride updates, crowd impacts, and what it means for your trip, with live data from ParkFi.",
      keywords:
        "Disney World news, Universal Orlando news, theme park updates, Orlando park news, ride closures",
      path: "/blog",
    }),
});

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

const time = (d: Date | string | null | undefined): number => (d ? new Date(d).getTime() : 0);

/** One slot in the mixed feed grid — our post or an external outlet's article. */
type FeedEntry =
  | { kind: "post"; date: number; post: PostCardData }
  | { kind: "external"; date: number; item: ExternalItem };

function BlogIndex() {
  const { tag, month } = Route.useSearch();
  const trpc = useTRPC();
  const { data } = useQuery(trpc.blog.list.queryOptions({ limit: 20, tag, month }));
  const { data: external } = useQuery(trpc.blog.externalFeed.queryOptions({ perSource: 12 }));
  const posts = data?.items ?? [];

  const filtered = Boolean(tag || month);
  const [lead, ...rest] = posts;

  // The most recent item from each outlet is a hero-carousel candidate (only
  // ones with an image — the carousel is full-bleed); every other external
  // item, plus any latest-per-source item that lacked an image, is eligible
  // to mix into the main grid alongside ours.
  const shelves = external ?? [];
  const latestPerSource: ExternalItem[] = shelves.map((s) => s.items[0]).filter(Boolean);

  const heroSlides: HeroSlideData[] = [];
  if (!filtered) {
    if (lead?.heroImageUrl) {
      heroSlides.push({
        kind: "post",
        slug: lead.slug,
        title: lead.title,
        dek: lead.dek,
        tags: lead.tags,
        heroImageUrl: lead.heroImageUrl,
        imageThumbhash: lead.imageThumbhash,
        publishedAt: lead.publishedAt,
      });
    }
    for (const item of latestPerSource) {
      if (item.imageUrl) {
        heroSlides.push({
          kind: "external",
          source: item.source,
          title: item.title,
          url: item.url,
          imageUrl: item.imageUrl,
          imageThumbhash: item.imageThumbhash,
          publishedAt: item.publishedAt,
        });
      }
    }
  }
  const heroExternalUrls = new Set(
    heroSlides
      .filter((s): s is Extract<HeroSlideData, { kind: "external" }> => s.kind === "external")
      .map((s) => s.url),
  );
  const mixableExternal: ExternalItem[] = shelves
    .flatMap((s) => s.items)
    .filter((i) => !heroExternalUrls.has(i.url))
    .sort((a, b) => time(b.publishedAt) - time(a.publishedAt))
    .slice(0, MAX_MIXED_EXTERNAL);

  // Filtered views (by tag/month) stay ours-only; the unfiltered feed interleaves
  // our posts and external articles, newest first.
  const feed: FeedEntry[] = [
    ...rest.map((post): FeedEntry => ({ kind: "post", date: time(post.publishedAt), post })),
    ...(filtered
      ? []
      : mixableExternal.map(
          (item): FeedEntry => ({
            kind: "external",
            date: time(item.publishedAt),
            item,
          }),
        )),
  ].sort((a, b) => b.date - a.date);

  // A hero image failed to resolve for both us and every outlet — fall back to
  // the old static lead card so the top of the page isn't empty.
  const showFallbackLead = heroSlides.length === 0 && Boolean(lead);
  const empty = heroSlides.length === 0 && !lead && feed.length === 0;

  return (
    <div>
      <JsonLd data={blogJsonLd()} />

      <BlogTickerHeader />

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_18rem]">
          <main>
            {filtered && (
              <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  Showing posts {tag ? `tagged "${tag}"` : `from ${month ? monthLabel(month) : ""}`}
                </span>
                <Link to="/blog" className="font-medium text-primary hover:underline">
                  Clear filter ✕
                </Link>
              </div>
            )}

            {empty ? (
              <p className="text-muted-foreground">
                No posts {filtered ? "match this filter" : "yet"} — check back soon.
              </p>
            ) : (
              <div className="flex flex-col gap-8">
                {heroSlides.length > 0 && <HeroCarousel slides={heroSlides} />}
                {showFallbackLead && lead && (
                  <PostCard post={lead} variant={filtered ? "compact" : "feature"} />
                )}
                {feed.length > 0 && (
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    {feed.map((entry) =>
                      entry.kind === "post" ? (
                        <PostCard key={entry.post.slug} post={entry.post} />
                      ) : (
                        <ExternalCard key={entry.item.url} item={entry.item} />
                      ),
                    )}
                  </div>
                )}
              </div>
            )}
          </main>

          <BlogSidebar />
        </div>
      </div>
    </div>
  );
}
