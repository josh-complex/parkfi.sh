import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "#/components/ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-heading text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Classic blog archival sidebar: a subscribe card, recent posts, browse-by-topic
 * tags, and a month-by-month archive. Quicklinks filter the /blog feed via search
 * params; `currentSlug` hides the post you're currently reading.
 */
export function BlogSidebar({ currentSlug }: { currentSlug?: string }) {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.blog.sidebar.queryOptions({ recentLimit: 6 }));
  if (!data) return null;

  const recent = data.recent.filter((p) => p.slug !== currentSlug).slice(0, 5);

  return (
    <aside className="flex flex-col gap-8 lg:sticky lg:top-8">
      <Card size="sm" className="gap-3">
        <CardHeader>
          <CardTitle className="text-base">Park News &amp; Analysis</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Daily reads on Walt Disney World &amp; Universal Orlando, backed by{" "}
            <Link to="/" className="text-primary underline underline-offset-4">
              live ParkFi data
            </Link>
            .
          </p>
          <a
            href="/blog/rss.xml"
            className="inline-flex text-sm font-medium text-primary hover:underline"
          >
            Subscribe via RSS →
          </a>
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <Section title="Recent posts">
          <ul className="flex flex-col gap-3">
            {recent.map((p) => (
              <li key={p.slug}>
                <Link
                  to="/blog/$slug"
                  params={{ slug: p.slug }}
                  className="group flex gap-3 text-sm"
                >
                  {p.heroImageUrl && (
                    <img
                      src={p.heroImageUrl}
                      alt=""
                      className="size-14 shrink-0 rounded-xl border object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <span className="font-medium leading-snug group-hover:text-primary">
                    {p.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.tags.length > 0 && (
        <Section title="Browse by topic">
          <ul className="flex flex-wrap gap-2">
            {data.tags.map((t) => (
              <li key={t.tag}>
                <Link to="/blog" search={{ tag: t.tag }}>
                  <Badge variant="outline" className="cursor-pointer">
                    {t.tag}
                    <span className="text-muted-foreground">{t.count}</span>
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.months.length > 0 && (
        <Section title="Archive">
          <ul className="flex flex-col gap-1.5 text-sm">
            {data.months.map((m) => (
              <li key={m.month}>
                <Link
                  to="/blog"
                  search={{ month: m.month }}
                  className="flex items-center justify-between text-muted-foreground hover:text-primary"
                >
                  <span>{monthLabel(m.month)}</span>
                  <span className="text-xs">{m.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </aside>
  );
}
