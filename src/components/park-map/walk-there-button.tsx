"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { FootprintsIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { lastFixStore } from "#/hooks/use-geolocation.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { preferredRouteLanguage, preferredUnitSystem, valhallaUnits } from "#/lib/units.ts";

import { coarseCoord, roundCoord } from "./nav-geometry.ts";
import { NAV_ACCURACY_MAX_M, requestNavDirections } from "./nav-store.ts";

/**
 * App-level walking-nav entry point (§4.2): a "Walk there · 6 min" CTA for any
 * page that knows a destination's coordinates (ride, shop, dining). Tapping it
 * parks the trip in the shared nav store and lands on the map, where the stage
 * takes over (location grant, route preview, Start).
 *
 * The minutes come from the same `routing.route` procedure the map's preview
 * runs, but keyed on a coarse (~110 m) origin so a live location watch doesn't
 * churn the query key fix-by-fix (the map's preview re-routes from the precise
 * fix after the tap). They only render when a location fix already exists this
 * session (`lastFixStore`) — the button never prompts for location by itself.
 */
export function WalkThereButton({
  id = 0,
  name,
  latitude,
  longitude,
  className,
}: {
  /** Attraction id when the destination is one (keeps the live destination-wait
   *  chip working during the walk); omit for shops/dining POIs. */
  id?: number;
  name: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  className?: string;
}) {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const fix = useStore(lastFixStore);
  const coords = React.useMemo<[number, number] | null>(
    () => (latitude != null && longitude != null ? [longitude, latitude] : null),
    [latitude, longitude],
  );
  const estimateQ = useQuery({
    // The origin is keyed coarsely (~110 m): a live watch elsewhere in the app
    // updates the fix on a steady cadence, and a full-precision key would make
    // every wobble a fresh query — flickering the minutes off and re-hitting
    // the router while the user stands still.
    ...trpc.routing.route.queryOptions({
      from: fix ? coarseCoord(fix.coords) : [0, 0],
      to: coords ? roundCoord(coords) : [0, 0],
      units: valhallaUnits(preferredUnitSystem()),
      language: preferredRouteLanguage(),
    }),
    enabled: fix != null && coords != null,
    staleTime: 5 * 60_000,
    // When the key does move, keep showing the previous estimate until the new
    // one lands, so the label never blinks out mid-read.
    placeholderData: keepPreviousData,
    meta: { errorToast: false },
  });
  if (coords == null) return null;
  const mins =
    estimateQ.data && estimateQ.data.durationSeconds > 0
      ? Math.max(1, Math.round(estimateQ.data.durationSeconds / 60))
      : null;
  return (
    <Button
      size="sm"
      variant="outline"
      className={className}
      onClick={() => {
        // Same origin rule as the map's Directions tap: only a decent fix is
        // trusted as the trip origin; otherwise the destination parks pending
        // and the map stage locates.
        const origin = fix && fix.accuracy <= NAV_ACCURACY_MAX_M ? fix.coords : null;
        requestNavDirections({ id, name, coords }, origin);
        void navigate({ to: "/map" });
      }}
    >
      <FootprintsIcon className="size-4" />
      Walk there{mins != null ? ` · ${mins} min` : ""}
    </Button>
  );
}
