import { useQuery } from "@tanstack/react-query";

import {
  Carousel,
  CarouselArrows,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(d));
}

function ExternalCard({
  item,
}: {
  item: { source: string; title: string; url: string; publishedAt: Date };
}) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="nofollow noopener noreferrer"
      className="group border-3d btn-3d-outline shadow-3d hover:shadow-3d-hover dark:border-[color-mix(in_oklch,var(--border),white_25%)] flex h-full flex-col gap-2 rounded-2xl bg-card p-4 text-card-foreground ring-foreground/5 transition-shadow dark:ring-foreground/10"
    >
      <span className="font-heading text-xs font-semibold tracking-wide text-primary uppercase">
        {item.source}
      </span>
      <span className="line-clamp-3 text-sm font-medium leading-snug group-hover:text-primary">
        {item.title}
      </span>
      <span className="mt-auto text-xs text-muted-foreground">
        {formatDate(item.publishedAt)} · Read on {item.source} ↗
      </span>
    </a>
  );
}

/**
 * "Around the parks" — one drag/arrow carousel per RSS supplier the park-news
 * cron ingests, modeled on the eats & stays shelves. Renders nothing until the
 * cron has populated `news_item`.
 */
export function ExternalShelves() {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.blog.externalFeed.queryOptions({ perSource: 12 }));
  const shelves = (data ?? []).filter((s) => s.items.length > 0);
  if (shelves.length === 0) return null;

  return (
    <section className="mt-14 border-t pt-10">
      <header className="mb-2">
        <h2 className="font-heading text-2xl font-bold tracking-tight">Around the parks</h2>
        <p className="mt-1 text-muted-foreground">
          The latest from across the Orlando theme-park press.
        </p>
      </header>

      <div className="flex flex-col">
        {shelves.map((shelf) => (
          <Carousel key={shelf.source} opts={{ align: "start", dragFree: true }} className="w-full">
            <div className="flex flex-col gap-3 py-4">
              <div className="flex items-end justify-between gap-4">
                <h3 className="font-heading text-lg font-semibold tracking-tight">
                  {shelf.source}
                </h3>
                <CarouselArrows className="hidden md:flex" />
              </div>
              <CarouselContent className="-ml-4">
                {shelf.items.map((item) => (
                  <CarouselItem
                    key={item.url}
                    className="basis-4/5 pl-4 sm:basis-1/2 md:basis-1/3 lg:basis-1/4"
                  >
                    <ExternalCard item={item} />
                  </CarouselItem>
                ))}
              </CarouselContent>
            </div>
          </Carousel>
        ))}
      </div>
    </section>
  );
}
