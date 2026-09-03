import { createFileRoute } from "@tanstack/react-router";

import { RESORT_CATALOG, type ResortTier } from "#/server/stays/resort-catalog.generated.ts";
import { renderOgCard, titleizeSlug, type OgChip } from "#/server/og/card.tsx";

const RESORT_BY_SLUG = new Map(RESORT_CATALOG.map((r) => [r.slug, r]));

const TIER_LABEL: Record<ResortTier, string> = {
  value: "Value Resort",
  moderate: "Moderate Resort",
  deluxe: "Deluxe Resort",
  villa: "Deluxe Villa",
  campground: "Campground",
};

async function renderJpeg(slug: string): Promise<Buffer> {
  const resort = RESORT_BY_SLUG.get(slug);
  const chips: Array<OgChip> = [];
  if (resort) chips.push({ value: TIER_LABEL[resort.tier], label: "Resort type" });
  return renderOgCard({
    title: resort?.name ?? titleizeSlug(slug),
    subtitle: resort?.area ?? "Walt Disney World Resort",
    chips,
    imageUrl: resort?.image,
  });
}

export const Route = createFileRoute("/og/resort/$slug/card.jpg")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Path: `/og/resort/<slug>/card.jpg`.
        const path = new URL(request.url).pathname;
        const slug = path.replace(/^\/og\/resort\//, "").replace(/\/card\.jpg$/, "");
        const jpeg = await renderJpeg(slug);
        return new Response(new Uint8Array(jpeg), {
          headers: {
            "content-type": "image/jpeg",
            "cache-control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
          },
        });
      },
    },
  },
});
