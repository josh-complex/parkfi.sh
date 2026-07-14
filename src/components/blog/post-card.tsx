import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge.tsx";
import { Image } from "#/components/ui/image.tsx";
import { cn } from "#/lib/utils.ts";

export interface PostCardData {
  slug: string;
  title: string;
  dek: string;
  tags: string[];
  heroImageUrl: string | null;
  publishedAt: Date | null;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/**
 * Editorial post card used across the blog feed and "keep reading" rows.
 * `variant="feature"` renders a large lead card; "compact" is the dense row
 * used in read-more grids.
 */
export function PostCard({
  post,
  variant = "compact",
  className,
}: {
  post: PostCardData;
  variant?: "feature" | "compact";
  className?: string;
}) {
  // Lead card: a full-bleed hero image with the headline overlaid on a dark
  // gradient scrim, so the text stays legible over any (busy) source photo.
  if (variant === "feature" && post.heroImageUrl) {
    return (
      <Link
        to="/blog/$slug"
        params={{ slug: post.slug }}
        className={cn(
          "group/post relative flex min-h-[20rem] flex-col justify-end overflow-hidden rounded-3xl text-white ring-1 ring-foreground/10 sm:min-h-[26rem]",
          className,
        )}
      >
        <Image
          src={post.heroImageUrl}
          alt=""
          className="absolute inset-0 size-full object-cover group-hover/post:scale-[1.04]"
          loading="lazy"
          referrerPolicy="no-referrer"
          sizes="(min-width: 640px) 42rem, 100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/5" />
        <div className="relative max-w-2xl p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/80">
            <time dateTime={post.publishedAt?.toISOString()}>{formatDate(post.publishedAt)}</time>
            {post.tags.slice(0, 3).map((t) => (
              <Badge key={t} className="border-white/30 bg-white/15 font-normal text-white">
                {t}
              </Badge>
            ))}
          </div>
          <h3 className="font-heading mt-2 text-2xl font-bold tracking-tight text-balance sm:text-4xl">
            {post.title}
          </h3>
          <p className="mt-2 line-clamp-2 max-w-xl text-white/85 sm:text-lg">{post.dek}</p>
          <span className="mt-3 inline-flex text-sm font-medium text-white">Read more →</span>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to="/blog/$slug"
      params={{ slug: post.slug }}
      className={cn(
        "group/post border-3d btn-3d-outline shadow-3d hover:shadow-3d-hover dark:border-[color-mix(in_oklch,var(--border),white_25%)] flex flex-col overflow-hidden rounded-3xl bg-card text-card-foreground ring-foreground/5 transition-shadow dark:ring-foreground/10",
        className,
      )}
    >
      {post.heroImageUrl && (
        <div className="aspect-[16/9] overflow-hidden bg-muted">
          <Image
            src={post.heroImageUrl}
            alt=""
            className="size-full object-cover group-hover/post:scale-[1.03]"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <time dateTime={post.publishedAt?.toISOString()}>{formatDate(post.publishedAt)}</time>
          {post.tags.slice(0, 2).map((t) => (
            <Badge key={t} variant="secondary" className="font-normal">
              {t}
            </Badge>
          ))}
        </div>
        <h3 className="font-heading mt-2 text-lg font-semibold tracking-tight text-balance group-hover/post:text-primary">
          {post.title}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{post.dek}</p>
        <span className="mt-3 text-sm font-medium text-primary">Read more →</span>
      </div>
    </Link>
  );
}
