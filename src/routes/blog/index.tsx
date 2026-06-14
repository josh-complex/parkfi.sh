import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { JsonLd } from "#/components/seo/json-ld.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { blogJsonLd, seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/blog/")({
  component: BlogIndex,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(context.trpc.blog.list.queryOptions({ limit: 20 }));
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function BlogIndex() {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.blog.list.queryOptions({ limit: 20 }));
  const posts = data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <JsonLd data={blogJsonLd()} />
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Park News &amp; Analysis</h1>
        <p className="mt-2 text-muted-foreground">
          What's changing at Walt Disney World and Universal Orlando — and what it means for your
          day, backed by{" "}
          <Link to="/" className="underline underline-offset-4">
            live ParkFi data
          </Link>
          .
        </p>
      </header>

      {posts.length === 0 ? (
        <p className="text-muted-foreground">No posts yet — check back soon.</p>
      ) : (
        <ul className="flex flex-col gap-8">
          {posts.map((p) => (
            <li key={p.slug} className="border-b pb-8 last:border-b-0">
              <Link to="/blog/$slug" params={{ slug: p.slug }} className="group block">
                <h2 className="text-xl font-medium tracking-tight group-hover:underline">
                  {p.title}
                </h2>
                <p className="mt-1.5 text-muted-foreground">{p.dek}</p>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <time dateTime={p.publishedAt?.toISOString()}>
                    {formatDate(p.publishedAt?.toISOString())}
                  </time>
                  {p.tags.length > 0 && <span aria-hidden>·</span>}
                  {p.tags.slice(0, 3).map((t) => (
                    <span key={t} className="rounded-full bg-muted px-2 py-0.5">
                      {t}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
