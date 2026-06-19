import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { useEffect } from "react";

import { BlogSidebar } from "#/components/blog/blog-sidebar.tsx";
import { BlogTickerHeader } from "#/components/blog/blog-ticker-header.tsx";
import { PostCard } from "#/components/blog/post-card.tsx";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { articleJsonLd, breadcrumbJsonLd, seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/blog/$slug")({
  component: BlogPost,
  loader: async ({ context, params }) => {
    const post = await context.queryClient.ensureQueryData(
      context.trpc.blog.bySlug.queryOptions({ slug: params.slug }),
    );
    void context.queryClient.prefetchQuery(
      context.trpc.blog.related.queryOptions({ slug: params.slug, limit: 3 }),
    );
    void context.queryClient.prefetchQuery(
      context.trpc.blog.sidebar.queryOptions({ recentLimit: 6 }),
    );
    return { title: post.title, dek: post.dek, heroImageUrl: post.heroImageUrl };
  },
  head: ({ params, loaderData }) =>
    seo({
      title: loaderData ? `${loaderData.title} — ParkFi` : "Park News & Analysis — ParkFi",
      description: loaderData?.dek ?? "Orlando theme park news and analysis from ParkFi.",
      path: `/blog/${params.slug}`,
      image: loaderData?.heroImageUrl ?? undefined,
    }),
});

function formatDate(d: Date | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/** Estimate read time from rendered article HTML at a typical 225 wpm. */
function readingMinutes(bodyHtml: string): number {
  const words = bodyHtml
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 225));
}

/** Map a park slug to a readable name for inline links. */
function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function BlogPost() {
  const { slug } = Route.useParams();
  const trpc = useTRPC();
  const { data: post } = useQuery(trpc.blog.bySlug.queryOptions({ slug }));
  const { data: related } = useQuery(trpc.blog.related.queryOptions({ slug, limit: 3 }));

  // Grow embedded X posts to their real height. The Tweet.html iframe posts a
  // `twttr.private.resize` message with its content height; without the
  // official widgets.js to listen, tall posts stayed clipped at the initial
  // height. Match the message to its iframe by contentWindow and resize.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (typeof event.origin !== "string" || !event.origin.endsWith("twitter.com")) return;
      let data: unknown = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const embed = (
        data as { "twttr.embed"?: { method?: string; params?: { height?: number }[] } }
      )?.["twttr.embed"];
      if (embed?.method !== "twttr.private.resize") return;
      const height = embed.params?.[0]?.height;
      if (!height) return;
      document
        .querySelectorAll<HTMLIFrameElement>('iframe[data-social-embed="twitter"]')
        .forEach((frame) => {
          if (frame.contentWindow === event.source) frame.style.height = `${height}px`;
        });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!post) return null;

  const minutes = readingMinutes(post.bodyHtml);

  return (
    <>
      <BlogTickerHeader />
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_18rem]">
        <article className="min-w-0">
          <JsonLd
            data={articleJsonLd({
              slug: post.slug,
              title: post.title,
              description: post.dek,
              publishedAt: post.publishedAt?.toISOString(),
              image: post.heroImageUrl ?? undefined,
            })}
          />
          <JsonLd
            data={breadcrumbJsonLd([
              { name: "Blog", path: "/blog" },
              { name: post.title, path: `/blog/${post.slug}` },
            ])}
          />

          <nav className="mb-6 text-sm text-muted-foreground">
            <Link to="/blog" className="hover:underline">
              ← Park News
            </Link>
          </nav>

          <header className="mb-8">
            <h1 className="font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              {post.title}
            </h1>
            <p className="mt-3 text-lg text-muted-foreground">{post.dek}</p>
            {post.sourceUrls[0] && (
              <p className="mt-3 text-sm text-muted-foreground">
                Originally reported by{" "}
                <a
                  href={post.sourceUrls[0].url}
                  target="_blank"
                  rel="nofollow noopener noreferrer"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  {post.sourceUrls[0].title.split(":")[0]}
                </a>{" "}
                — full credits and sources below.
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <time dateTime={post.publishedAt?.toISOString()}>{formatDate(post.publishedAt)}</time>
              {post.tags.length > 0 && <span aria-hidden>·</span>}
              {post.tags.slice(0, 4).map((t) => (
                <Link key={t} to="/blog" search={{ tag: t }}>
                  <Badge variant="secondary" className="font-normal">
                    {t}
                  </Badge>
                </Link>
              ))}
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-3.5" aria-hidden />
              {minutes} min read
            </p>
          </header>

          {post.heroImageUrl && (
            <figure className="mb-8">
              <img
                src={post.heroImageUrl}
                alt={post.heroImageAlt ?? post.title}
                className="w-full rounded-xl border"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
              {post.heroImageCredit && (
                <figcaption className="mt-2 text-xs text-muted-foreground">
                  Photo:{" "}
                  {post.heroImageCreditUrl ? (
                    <a
                      href={post.heroImageCreditUrl}
                      target="_blank"
                      rel="nofollow noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      {post.heroImageCredit}
                    </a>
                  ) : (
                    post.heroImageCredit
                  )}
                </figcaption>
              )}
            </figure>
          )}

          {/* Body is server-rendered + sanitized markdown (see server/blog/render.ts). */}
          <div
            className="prose prose-neutral dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
          />

          {post.parkSlugs.length > 0 && (
            <aside className="mt-10 rounded-xl border bg-muted/40 p-5">
              <h2 className="text-sm font-medium">Live data for parks in this story</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {post.parkSlugs.map((s) => (
                  <li key={s}>
                    <Link
                      to="/park/$slug"
                      params={{ slug: s }}
                      className="rounded-full border bg-background px-3 py-1 text-sm hover:bg-accent"
                    >
                      {titleizeSlug(s)} waits →
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          )}

          {post.sourceUrls.length > 0 && (
            <footer className="mt-10 border-t pt-6">
              <h2 className="text-sm font-medium text-muted-foreground">Sources</h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {post.sourceUrls.map((s) => (
                  <li key={s.url}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="nofollow noopener noreferrer"
                      className="text-primary underline underline-offset-4"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </footer>
          )}

          {related && related.length > 0 && (
            <section className="mt-12 border-t pt-8">
              <h2 className="font-heading text-xl font-semibold tracking-tight">Keep reading</h2>
              <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((p) => (
                  <PostCard key={p.slug} post={p} />
                ))}
              </div>
            </section>
          )}
        </article>

        <BlogSidebar currentSlug={post.slug} />
      </div>
    </>
  );
}
