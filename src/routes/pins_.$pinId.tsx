"use client";

import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { PinCollectionButtons } from "#/components/pins/pin-collection-buttons.tsx";
import { PinImage } from "#/components/pins/pin-card.tsx";
import { formatCents } from "#/components/pins/format.ts";
import { SiteHeader } from "#/components/site-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";

import type { inferRouterOutputs } from "@trpc/server";
import type { TRPCRouter } from "#/integrations/trpc/router.ts";

type PinDetailData = NonNullable<inferRouterOutputs<TRPCRouter>["pinCatalog"]["detail"]>;

export const Route = createFileRoute("/pins_/$pinId")({
  component: PinDetailPage,
  head: ({ params }) =>
    seo({
      title: "Pin Details — ParkFi",
      description: "Disney trading pin details, estimated value, and trade availability on ParkFi.",
      path: `/pins/${params.pinId}`,
    }),
});

function PinDetailPage() {
  const { pinId } = Route.useParams();
  const trpc = useTRPC();
  const detailQ = useQuery(trpc.pinCatalog.detail.queryOptions({ id: pinId }));

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <AppInset>
        <SiteHeader title="Pins" mobileTitle={detailQ.data?.name ?? undefined} />
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
      </AppInset>
    </SidebarProvider>
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
