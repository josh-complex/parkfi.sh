import { Link, createFileRoute } from "@tanstack/react-router";

import { PinCollectionManager } from "#/components/pins/pin-collection-manager.tsx";
import { PageBody, PageMasthead } from "#/components/site-chrome/page-masthead.tsx";
import { Button } from "#/components/ui/button.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/pins_/collection")({
  component: PinCollectionPage,
  head: () =>
    seo({
      title: "My Pin Collection — ParkFi",
      description: "Track the Disney pins you have and want, and mark pins available for trade.",
      path: "/pins/collection",
      noindex: true,
    }),
});

function PinCollectionPage() {
  return (
    <>
      <PageMasthead
        kicker="Your pins"
        title="My collection"
        description="What you have, what you're hunting, and what you'd part with — the three lists a trade is made of."
        actions={
          <>
            <Button variant="yellow" size="sm" render={<Link to="/pins/trades" />}>
              Find a trade
            </Button>
            <Button variant="ticket" size="sm" render={<Link to="/pins" />}>
              Catalog
            </Button>
          </>
        }
      />
      <PageBody size="form">
        <PinCollectionManager />
      </PageBody>
    </>
  );
}
