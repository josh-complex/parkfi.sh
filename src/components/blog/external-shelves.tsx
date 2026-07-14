import { Image } from "#/components/ui/image.tsx";

/** An external RSS item surfaced from the park-news cron's `news_item` table. */
export interface ExternalItem {
  source: string;
  title: string;
  url: string;
  imageUrl: string | null;
  publishedAt: Date | string;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(d));
}

/**
 * A card linking out to an original article from another Orlando park outlet.
 * Renders the source's og:image when we have one and degrades gracefully to a
 * text-only card (source · title · date) when we don't — so mixed shelves of
 * image and text cards still read cleanly.
 */
export function ExternalCard({ item }: { item: ExternalItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="nofollow noopener noreferrer"
      className="group/post border-3d btn-3d-outline shadow-3d hover:shadow-3d-hover dark:border-[color-mix(in_oklch,var(--border),white_25%)] flex h-full flex-col overflow-hidden rounded-3xl bg-card text-card-foreground ring-foreground/5 transition-shadow dark:ring-foreground/10"
    >
      {item.imageUrl && (
        <div className="aspect-[16/9] overflow-hidden bg-muted">
          <Image
            src={item.imageUrl}
            alt=""
            className="size-full object-cover group-hover/post:scale-[1.03]"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col p-5">
        <span className="font-heading text-xs font-semibold tracking-wide text-primary uppercase">
          {item.source}
        </span>
        <span className="mt-1 line-clamp-3 text-sm font-medium leading-snug group-hover/post:text-primary">
          {item.title}
        </span>
        <span className="mt-auto pt-3 text-xs text-muted-foreground">
          {formatDate(item.publishedAt)} · Read on {item.source} ↗
        </span>
      </div>
    </a>
  );
}
