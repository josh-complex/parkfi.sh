import { Link, createFileRoute } from "@tanstack/react-router";

import { PinScanner } from "#/components/pins/pin-scanner.tsx";
import { PageBody, PageMasthead } from "#/components/site-chrome/page-masthead.tsx";
import { Button } from "#/components/ui/button.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/pins_/scan")({
  component: PinScanPage,
  head: () =>
    seo({
      title: "Scan a Pin — ParkFi",
      description: "Snap a photo to identify a Disney trading pin and see its estimated value.",
      path: "/pins/scan",
      noindex: true,
    }),
});

function PinScanPage() {
  return (
    <>
      <PageMasthead
        kicker="Identify a pin"
        title="Scan a pin"
        description="Snap the pin on the board in front of you and we'll put the closest matches — and what they go for — beside it."
        actions={
          <Button variant="ticket" size="sm" render={<Link to="/pins" />}>
            Catalog
          </Button>
        }
      />
      <PageBody size="form">
        <PinScanner />
      </PageBody>
    </>
  );
}
