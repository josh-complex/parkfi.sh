import { createFileRoute } from "@tanstack/react-router";

import { JsonLd } from "#/components/seo/json-ld.tsx";
import { ResortDetail, resortBySlug } from "#/components/stays/resort-detail.tsx";
import { breadcrumbJsonLd, resortJsonLd, seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/resort/$slug")({
  component: ResortPage,
  head: ({ params }) => {
    const resort = resortBySlug(params.slug);
    const name = resort?.name ?? "Disney Resort";
    const inArea = resort?.area ? ` in the ${resort.area}` : "";
    return seo({
      title: `${name} — Availability & Rates — ParkFi`,
      description: `Live nightly availability and rates for ${name}${inArea} at Walt Disney World. Track openings and set price alerts on ParkFi.`,
      path: `/resort/${params.slug}`,
      image: `/og/resort/${params.slug}/card.png`,
      imageWidth: 1200,
      imageHeight: 630,
    });
  },
});

function ResortPage() {
  const { slug } = Route.useParams();
  const resort = resortBySlug(slug);

  return (
    <>
      {resort && (
        <>
          <JsonLd data={resortJsonLd({ slug, name: resort.name, image: resort.image })} />
          <JsonLd
            data={breadcrumbJsonLd([
              { name: "Stays", path: "/stays" },
              { name: resort.name, path: `/resort/${slug}` },
            ])}
          />
        </>
      )}
      <div className="flex flex-1 flex-col">
        <ResortDetail slug={slug} />
      </div>
    </>
  );
}
