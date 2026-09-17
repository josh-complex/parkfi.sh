"use client";

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, NewspaperIcon } from "lucide-react";

import { Image } from "#/components/ui/image.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

/**
 * How many stories the card carries: a lead across the full width, then two
 * rows of two beneath it. It's a card, not the blog.
 */
const ROWS = 5;

/**
 * The card's own shape in grey — a lead frame and two tiles. Not a plain box of
 * the right height: the point is that nothing *moves* when the posts land, and
 * a card that changes shape as well as filling in still reads as a jump.
 */
function ParkNewsSkeleton({ className }: { className?: string }) {
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-[22px] border border-card-edge bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 md:px-5 md:pt-5">
        <h2 className="flex min-w-0 items-center gap-2 text-[19px] font-extrabold tracking-[-0.01em]">
          <NewspaperIcon className="size-4 shrink-0 text-muted-foreground" />
          Park news
        </h2>
      </div>
      <Skeleton className="aspect-[16/9] w-full rounded-none" />
      <div className="grid grid-cols-2 gap-1.5 p-2 md:gap-2 md:p-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 p-1.5">
            <Skeleton className="aspect-[16/10] w-full rounded-xl" />
            <Skeleton className="h-3.5 w-4/5 rounded" />
            <Skeleton className="h-3 w-1/3 rounded" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Sep 14" — every story on this card is recent enough that the year is noise. */
function dayLabel(iso: Date | string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * "Park news" — our published posts that name this park, newest first: a lead
 * carrying its own artwork and standfirst, then the rest as tiles carrying
 * theirs.
 *
 * It sits in the page's left column now rather than in a band at the foot of
 * the page (2026-09-16, Josh). Three reasons the column is the right home: the
 * stories are *about today* as much as the wait chart is, the column has the
 * height to spare next to the board, and a news strip stranded below the
 * analytics was read by nobody.
 *
 * Every story gets a photograph. An earlier pass gave the older ones a bullet
 * and a headline instead, on the theory that they were worth less attention —
 * but a card that opens with two pictures and then trails off into a list reads
 * as a card that ran out of material, and the bulleted stories were the ones
 * nobody clicked. The lead keeps its size; everything else is an equal tile.
 *
 * Posts carry `parkSlugs` from the news pipeline's own tagging, so this is an
 * exact filter rather than a text match on the title: a story about Epic
 * Universe doesn't surface on the Studios page because the two share a resort.
 *
 * Renders nothing for a park we haven't written about yet — an empty "news"
 * card reads as a broken feed.
 */
export function ParkNews({ parkSlug, className }: { parkSlug: string | null; className?: string }) {
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.blog.list.queryOptions({ parkSlug: parkSlug ?? "", limit: ROWS }),
    enabled: !!parkSlug,
  });

  // Reserve the card's box while the query is out. Returning null and then
  // appearing at full height shoved everything under it down the page — and
  // this card sits in a column with four more below it, so one late query moved
  // all of them. `q.data` rather than `isLoading`: on the server the query
  // never fetches, so `isLoading` is false there and true on the client's first
  // render, which is a hydration mismatch. "No data yet" is true in both.
  if (!q.data) return <ParkNewsSkeleton className={className} />;

  const posts = q.data.items;
  if (posts.length === 0) return null;

  const [lead, ...rest] = posts;
  // A lone tile at half width reads as a layout that lost its partner, so the
  // grid is trimmed to whole pairs. With nothing left to demote an odd story to
  // (there are no lines any more), it simply doesn't run.
  const tiles = rest.slice(0, rest.length - (rest.length % 2));

  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-[22px] border border-card-edge bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 md:px-5 md:pt-5">
        <h2 className="flex min-w-0 items-center gap-2 text-[19px] font-extrabold tracking-[-0.01em]">
          <NewspaperIcon className="size-4 shrink-0 text-muted-foreground" />
          Park news
        </h2>
        <Link
          to="/blog"
          className="group flex shrink-0 items-center gap-1 text-xs font-bold text-wash-fg hover:underline"
        >
          All posts
          <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* The lead. The photo runs edge to edge of the card and the headline sits
          on it, because a story with its artwork beside it at thumbnail size is
          a row — and a column of rows is exactly the thing this card replaced. */}
      <Link
        to="/blog/$slug"
        params={{ slug: lead.slug }}
        className="group relative isolate block aspect-[16/9] w-full overflow-hidden bg-muted"
      >
        {lead.heroImageUrl && (
          <Image
            src={lead.heroImageUrl}
            alt={lead.title}
            loading="lazy"
            aspect={16 / 9}
            placeholder={lead.imageThumbhash ?? undefined}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/5" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3.5 md:p-4">
          {lead.publishedAt && (
            <span className="text-[11px] font-bold tracking-[0.06em] text-white/70 uppercase">
              ParkFi · {dayLabel(lead.publishedAt)}
            </span>
          )}
          <p className="line-clamp-3 text-[17px] leading-[1.18] font-extrabold tracking-[-0.01em] text-balance text-white">
            {lead.title}
          </p>
          {lead.dek && (
            <p className="line-clamp-2 text-[12.5px] leading-snug text-white/80">{lead.dek}</p>
          )}
        </div>
      </Link>

      {/* The rest. Artwork above the headline rather than beside it, so they
          read as a spread off the lead instead of as the rows of a list that
          happens to have pictures. */}
      {tiles.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 p-2 md:gap-2 md:p-2.5">
          {tiles.map((p) => (
            <Link
              key={p.slug}
              to="/blog/$slug"
              params={{ slug: p.slug }}
              className="group flex flex-col gap-2 rounded-2xl p-1.5 hover:bg-muted"
            >
              <span className="block aspect-[16/10] w-full overflow-hidden rounded-xl bg-muted">
                {p.heroImageUrl && (
                  <Image
                    src={p.heroImageUrl}
                    alt={p.title}
                    loading="lazy"
                    aspect={16 / 10}
                    placeholder={p.imageThumbhash ?? undefined}
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                )}
              </span>
              <span className="flex flex-col gap-0.5 px-0.5">
                <span className="line-clamp-3 text-[13px] leading-tight font-bold">{p.title}</span>
                {p.publishedAt && (
                  <span className="text-[11px] text-muted-foreground">
                    {dayLabel(p.publishedAt)}
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
