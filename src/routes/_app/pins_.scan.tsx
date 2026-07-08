import { Link, createFileRoute } from "@tanstack/react-router";

import { PinScanner } from "#/components/pins/pin-scanner.tsx";
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
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold">Scan a pin</h1>
              <p className="text-muted-foreground text-sm">
                Snap a photo and we'll find the closest matches.
              </p>
            </div>
            <Button variant="outline" size="sm" render={<Link to="/pins" />}>
              Catalog
            </Button>
          </div>
          <PinScanner />
        </div>
      </div>
    </div>
  );
}
