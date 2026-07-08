import { Link, createFileRoute } from "@tanstack/react-router";

import { PinTradeBoard } from "#/components/pins/pin-trade-board.tsx";
import { Button } from "#/components/ui/button.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/pins_/trades")({
  component: PinTradesPage,
  head: () =>
    seo({
      title: "Pin Trades — ParkFi",
      description: "Find trade matches for your Disney pins and manage your trade offers.",
      path: "/pins/trades",
      noindex: true,
    }),
});

function PinTradesPage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold">Pin trades</h1>
              <p className="text-muted-foreground text-sm">Trade matches and your open offers.</p>
            </div>
            <Button variant="outline" size="sm" render={<Link to="/pins/collection" />}>
              My collection
            </Button>
          </div>
          <PinTradeBoard />
        </div>
      </div>
    </div>
  );
}
