"use client";

import * as React from "react";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { isServer, useQuery } from "@tanstack/react-query";

import { PinCollectionButtons } from "#/components/pins/pin-collection-buttons.tsx";
import { PinImage } from "#/components/pins/pin-card.tsx";
import { formatCents } from "#/components/pins/format.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";

import type { inferRouterOutputs } from "@trpc/server";
import type { TRPCRouter } from "#/integrations/trpc/router.ts";

type PinDetailData = NonNullable<inferRouterOutputs<TRPCRouter>["pinCatalog"]["detail"]>;

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

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8">
          {detailQ.isLoading ? (
            <div className="grid gap-6 sm:grid-cols-2">
              <Skeleton className="aspect-square w-full rounded-2xl" />
              <div className="space-y-3">
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-20 w-full" />
              </div>
            </div>
          ) : !detailQ.data ? (
            <Empty>
              <EmptyTitle>Pin not found</EmptyTitle>
              <EmptyDescription>
                This pin isn't in our catalog, or the link is out of date.
              </EmptyDescription>
              <Button className="mt-4" render={<Link to="/pins" />}>
                Back to catalog
              </Button>
            </Empty>
          ) : (
            <PinDetail pin={detailQ.data} />
          )}
        </div>
      </div>
    </div>
  );
}

function PinDetail({ pin }: { pin: PinDetailData }) {
  const images =
    pin.images.length > 0
      ? pin.images
      : pin.imageUrl
        ? [{ id: "primary", url: pin.imageUrl, isPrimary: true }]
        : [];
  const initial = images.find((i) => i.isPrimary)?.url ?? images[0]?.url ?? null;
  const [active, setActive] = React.useState<string | null>(initial);
  React.useEffect(() => setActive(initial), [initial]);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <PinImage
            src={active}
            alt={pin.name}
            className="aspect-square w-full rounded-2xl border bg-muted"
          />
          {images.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setActive(img.url)}
                  className={`size-16 overflow-hidden rounded-lg border ${
                    active === img.url ? "ring-2 ring-primary" : ""
                  }`}
                >
                  <PinImage src={img.url} alt="" className="size-full bg-muted" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{pin.name}</h1>
            {pin.series ? <p className="text-muted-foreground">{pin.series}</p> : null}
          </div>

          {pin.characters.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {pin.characters.map((c) => (
                <Badge key={c} variant="secondary">
                  {c}
                </Badge>
              ))}
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {pin.year != null ? <Field label="Year" value={String(pin.year)} /> : null}
            {pin.editionType ? <Field label="Edition" value={pin.editionType} /> : null}
            {pin.leCount != null ? (
              <Field label="LE count" value={pin.leCount.toLocaleString()} />
            ) : null}
            {pin.park ? <Field label="Park" value={pin.park} /> : null}
            <Field label="Est. value" value={formatCents(pin.estValueCents)} />
          </dl>

          <div className="text-muted-foreground flex gap-4 text-sm">
            <span>
              <span className="text-foreground font-semibold tabular-nums">
                {pin.availableForTrade}
              </span>{" "}
              available for trade
            </span>
            <span>
              <span className="text-foreground font-semibold tabular-nums">{pin.wantedBy}</span>{" "}
              want it
            </span>
          </div>

          <PinCollectionButtons pinId={pin.id} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
