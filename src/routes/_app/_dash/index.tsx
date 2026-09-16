import { createFileRoute, redirect } from "@tanstack/react-router";

import { CrossParkWaits } from "#/components/rides/cross-park-waits.tsx";
import { validateWaitsSearch } from "#/components/rides/waits-search.ts";
import { hasLaunched } from "#/lib/app-launch.ts";
import { load } from "#/lib/loader.ts";
import { isNative } from "#/lib/platform.ts";
import { seo } from "#/lib/seo.ts";

// Tailwind's `md` breakpoint — below this we treat the client as mobile.
const MOBILE_BREAKPOINT = 768;

export const Route = createFileRoute("/_app/_dash/")({
  component: Waits,
  // The board's filter, sort and map switch live in the URL (docs/plans/
  // waits-redesign §4) so a filtered board can be shared and survives a reload —
  // this is the app's most-linked surface. The list/tiles view deliberately does
  // not: it's a per-reader display preference and lives in `localStorage`.
  // Every key is optional and absent at its default,
  // so the plain board is exactly `/`; the `head` below keeps pointing every
  // filtered variant's canonical back at it.
  validateSearch: validateWaitsSearch,
  // On the app's initial launch only, mobile + native users land on the map (the
  // home surface there) instead of the Waits list. Gated to launch via
  // `hasLaunched()` so a later tap of the Waits tab — which also routes to "/" —
  // still shows Waits. Kept client-side (`window` guard) so SSR and crawlers get
  // the rich, keyword-dense Waits page, preserving its wait-times SEO.
  beforeLoad: () => {
    if (typeof window === "undefined" || hasLaunched()) return;
    if (isNative() || window.innerWidth < MOBILE_BREAKPOINT) {
      throw redirect({ to: "/map" });
    }
  },
  // SSR-prefetch the cross-park ride list so the page ships real ride names +
  // live waits in its HTML (good for crawlers and instant first paint). `load`
  // blocks server-side; on the client it warms the cache and lets CrossParkWaits
  // render its own loading state immediately.
  loader: async ({ context }) => {
    await load(context.queryClient, context.trpc.parks.allRides.queryOptions());
  },
  head: () =>
    seo({
      title: "Live Theme Park Wait Times — Disney World & Universal Orlando | ParkFi",
      description:
        "Live standby wait times for every ride across Walt Disney World and Universal Orlando in one filterable list, updated in real time. Sort by wait, filter by type, and plan your day.",
      path: "/",
    }),
});

function Waits() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CrossParkWaits />
    </div>
  );
}
