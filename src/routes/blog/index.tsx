import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { BlogSidebar } from "#/components/blog/blog-sidebar.tsx";
import { ExternalShelves } from "#/components/blog/external-shelves.tsx";
import { PostCard } from "#/components/blog/post-card.tsx";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { blogJsonLd, seo } from "#/lib/seo.ts";

interface BlogSearch {
  tag?: string;
  month?: string;
}

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

function BlogIndex() {
  const { tag, month } = Route.useSearch();
  const trpc = useTRPC();
  const { data } = useQuery(trpc.blog.list.queryOptions({ limit: 20, tag, month }));
  const posts = data?.items ?? [];

  const filtered = Boolean(tag || month);
  const [lead, ...rest] = posts;

  return (
    <div>
      <JsonLd data={blogJsonLd()} />

      <header className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <p className="font-heading text-sm font-semibold tracking-wide text-sidebar-foreground/70 uppercase">
            The ParkFi Dispatch
          </p>
          <h1 className="font-heading mt-1 text-4xl font-bold tracking-tight sm:text-5xl">
            Park News &amp; Analysis
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-sidebar-foreground/80">
            What's changing at Walt Disney World and Universal Orlando — and what it means for your
            day, backed by{" "}
            <Link
              to="/"
              className="font-medium text-sidebar-foreground underline underline-offset-4"
            >
              live ParkFi data
            </Link>
            .
          </p>
        </div>
      </header>

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

            {posts.length === 0 ? (
              <p className="text-muted-foreground">
                No posts {filtered ? "match this filter" : "yet"} — check back soon.
              </p>
            ) : (
              <div className="flex flex-col gap-6">
                {lead && <PostCard post={lead} variant={filtered ? "compact" : "feature"} />}
                {rest.length > 0 && (
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    {rest.map((p) => (
                      <PostCard key={p.slug} post={p} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </main>

          <BlogSidebar />
        </div>

        <ExternalShelves />
      </div>
    </div>
  );
}
