"use client";

import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { isServer, useQuery } from "@tanstack/react-query";

import { HERO_FIELD, HERO_PAGE_PADDING } from "#/components/detail-hero.tsx";
import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { PinDetail } from "#/components/pins/pin-detail.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";
import { cn } from "#/lib/utils.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/_app/pins_/$pinId")({
  component: PinDetailPage,
  // SSR-prefetch the pin so the HTML carries the name/series/value content that
  // makes the page indexable, and hard-404 unknown ids so crawlers don't index
  // an infinite space of "Pin Details" shells (soft 404s).
  loader: async ({ context, params }) => {
    if (!UUID_RE.test(params.pinId)) throw notFound();
    const options = context.trpc.pinCatalog.detail.queryOptions({ id: params.pinId });
    if (!isServer) {
      // Client: warm the cache and render immediately — the component owns the
      // loading skeleton and the "pin not found" empty state, so we don't freeze
      // the previous page or block on the network here.
      void context.queryClient.prefetchQuery(options);
      return;
    }
    // Server: block so the HTML carries the indexable pin content, and hard-404
    // unknown ids so crawlers don't index an infinite space of empty shells.
    const pin = await context.queryClient.ensureQueryData(options);
    if (!pin) throw notFound();
    return {
      name: pin.name,
      series: pin.series ?? null,
      year: pin.year ?? null,
      image: pin.images.find((i) => i.isPrimary)?.url ?? pin.images[0]?.url ?? null,
    };
  },
  head: ({ params, loaderData }) => {
    const name = loaderData?.name ?? "Pin Details";
    const series = loaderData?.series ? ` from the ${loaderData.series} series` : "";
    const year = loaderData?.year ? ` (${loaderData.year})` : "";
    return seo({
      title: `${name} — Disney Pin Value & Trading — ParkFi`,
      description: `${name}${year}${series} — estimated value, reference photos, and live trade availability on ParkFi.`,
      path: `/pins/${params.pinId}`,
      image: loaderData?.image ?? undefined,
    });
  },
});

function PinDetailPage() {
  const { pinId } = Route.useParams();
  const trpc = useTRPC();
  const detailQ = useQuery(trpc.pinCatalog.detail.queryOptions({ id: pinId }));

  if (detailQ.isLoading) {
    // The hero's own box, not a generic block: a skeleton at any other height
    // leaves the stub's crease floating off the field's edge until the query
    // lands (see `HERO_CREASE_ALIGNED`).
    return (
      <div className={cn(PAGE_WIDTH, "flex flex-col gap-5", HERO_PAGE_PADDING)}>
        <Skeleton
          className={cn("-mx-4 w-[calc(100%+2rem)] rounded-none md:mx-0 md:w-full", HERO_FIELD)}
        />
        <Skeleton className="h-52 w-full rounded-none md:mx-auto md:max-w-[34rem]" />
        <Skeleton className="h-40 w-full rounded-3xl md:mx-auto md:max-w-[34rem]" />
      </div>
    );
  }

  if (!detailQ.data) {
    return (
      <div className={cn(PAGE_WIDTH, "py-16")}>
        <Empty>
          <EmptyTitle>Pin not found</EmptyTitle>
          <EmptyDescription>
            This pin isn&apos;t in our catalog, or the link is out of date.
          </EmptyDescription>
          <Button className="mt-4" render={<Link to="/pins" />}>
            Back to catalog
          </Button>
        </Empty>
      </div>
    );
  }

  return <PinDetail pin={detailQ.data} />;
}
