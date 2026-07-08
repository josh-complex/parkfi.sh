import { Link, createFileRoute } from "@tanstack/react-router";

import { PinCollectionManager } from "#/components/pins/pin-collection-manager.tsx";
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
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold">My pins</h1>
              <p className="text-muted-foreground text-sm">
                Track what you have and want, and mark pins for trade.
              </p>
            </div>
            <Button variant="outline" size="sm" render={<Link to="/pins/trades" />}>
              Trades
            </Button>
          </div>
          <PinCollectionManager />
        </div>
      </div>
    </div>
  );
}
