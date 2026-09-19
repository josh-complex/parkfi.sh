import { Link, createFileRoute } from "@tanstack/react-router";

import { PinTradeBoard } from "#/components/pins/pin-trade-board.tsx";
import { PageBody, PageMasthead } from "#/components/site-chrome/page-masthead.tsx";
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
    <>
      <PageMasthead
        kicker="Your pins"
        title="Trades"
        description="Traders whose wants meet your haves, and every offer you have open."
        actions={
          <Button variant="ticket" size="sm" render={<Link to="/pins/collection" />}>
            My collection
          </Button>
        }
      />
      <PageBody size="prose">
        <PinTradeBoard />
      </PageBody>
    </>
  );
}
