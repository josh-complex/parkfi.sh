"use client";

import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";

import { TIER_LABEL } from "#/components/stays/stays-filters.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { buttonVariants } from "#/components/ui/button.tsx";
import { RESORT_CATALOG } from "#/server/stays/resort-catalog.generated.ts";

/** Resort hotels are a static catalog; resolve by slug for the detail page. */
const RESORT_BY_SLUG = new Map(RESORT_CATALOG.map((r) => [r.slug, r]));

export function resortBySlug(slug: string) {
  return RESORT_BY_SLUG.get(slug) ?? null;
}

/**
 * Standalone resort hotel detail page. The stays data is resort-level only (no
 * room/view granularity), so this is a catalog landing: identity, tier, area,
 * and a link into the `/stays` availability board.
 */
export function ResortDetail({ slug }: { slug: string }) {
  const resort = resortBySlug(slug);

  if (!resort) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-16 text-center lg:px-6">
        <p className="text-lg font-semibold">Resort not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This resort may no longer be listed.{" "}
          <Link to="/stays" className="underline">
            Browse all resorts
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 lg:px-6">
      <nav className="text-sm text-muted-foreground">
        <Link to="/stays" className="inline-flex items-center gap-1.5 hover:underline">
          <ArrowLeftIcon className="size-3.5" />
          All resorts
        </Link>
      </nav>

      {resort.image && (
        <div className="relative h-56 w-full overflow-hidden rounded-2xl bg-muted sm:h-80">
          <img
            src={resort.image}
            alt={resort.name}
            className="size-full object-cover"
            loading="eager"
          />
          <Badge
            variant="secondary"
            className="absolute top-3 left-3 bg-background/85 font-medium shadow-sm backdrop-blur-sm"
          >
            {TIER_LABEL[resort.tier]}
          </Badge>
        </div>
      )}

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{resort.name}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-normal">
            {TIER_LABEL[resort.tier]}
          </Badge>
          {resort.area && (
            <Badge variant="outline" className="font-normal">
              {resort.area}
            </Badge>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Link to="/stays" className={buttonVariants()}>
          Check availability &amp; rates
        </Link>
        <a
          href={resort.detailUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          View on the official site
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </div>

      <p className="text-sm text-muted-foreground">
        ParkFi tracks live nightly availability across Walt Disney World resorts. Open the{" "}
        <Link to="/stays" className="underline">
          availability board
        </Link>{" "}
        to add your dates and party, see this resort&apos;s rates, and set a price alert.
      </p>
    </div>
  );
}
