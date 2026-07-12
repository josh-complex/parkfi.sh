"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import {
  CoreSearchOption,
  CoreSearchSegment,
  useCloseOnScroll,
  type SegPos,
} from "#/components/core-search.tsx";
import { TicketsMobileControls } from "#/components/ticket-pricing/tickets-mobile-controls.tsx";
import { TicketsMobileShelves } from "#/components/ticket-pricing/tickets-mobile-shelves.tsx";
import {
  crowdConfig,
  DAYS,
  dollars,
  localIso,
  PriceCalendarGrid,
  RESORTS,
  usePricingData,
  type AgeGroup,
  type Resort,
} from "#/components/ticket-pricing/shared.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { UOR_PARKS, WDW_PARKS } from "#/lib/parks.ts";
import { cn } from "#/lib/utils.ts";

export function PricingCalendar() {
  const isMobile = useIsMobile();
  const trpc = useTRPC();
  const [resort, setResort] = React.useState<Resort>("WDW");
  const [parkHopper, setParkHopper] = React.useState(false);
  const [ageGroup, setAgeGroup] = React.useState<AgeGroup>("ADULT");
  const [park, setPark] = React.useState<string | null>(null);
  const [openSeg, setOpenSeg] = React.useState<string | null>(null);

  useCloseOnScroll(openSeg !== null, () => setOpenSeg(null));

  // Desktop-only data: the header blurb, summary cards, and calendar legend all
  // read from the selected park's calendar. Gated off on mobile, where the
  // shelves (their own endpoint) drive the page instead.
  const data = usePricingData({ resort, park, parkHopper, ageGroup, enabled: !isMobile });
  const { productLabel, lastUpdatedAt, stats, priceMap, today } = data;

  // Picking a park also sets its resort (the resort segment is gone — resort is
  // inferred from the chosen park). A null code = that resort's "All parks".
  const selectPark = (nextResort: Resort, code: string | null) => {
    setResort(nextResort);
    setPark(code);
    setOpenSeg(null);
  };

  const parks = resort === "WDW" ? WDW_PARKS : UOR_PARKS;
  const resortLabel = RESORTS.find((r) => r.value === resort)?.label ?? "";

  // Build the visible segment list so pill positions (rounded ends, shared
  // borders) stay correct as the ticket-type field appears only for WDW.
  const segKeys = resort === "WDW" ? ["park", "type", "age"] : ["park", "age"];
  const posOf = (key: string): SegPos =>
    segKeys[0] === key ? "first" : segKeys[segKeys.length - 1] === key ? "last" : "middle";
  const parkLabel = park
    ? (parks.find((p) => p.code === park)?.label ?? "All parks")
    : `All ${resortLabel} parks`;

  // Default the desktop calendar to the busiest park today; applied once, and
  // only if the user hasn't already touched the picker.
  const busiestQ = useQuery(trpc.forecast.busiestPark.queryOptions({}));
  const appliedDefault = React.useRef(false);
  React.useEffect(() => {
    if (appliedDefault.current || park) return;
    const b = busiestQ.data;
    if (!b) return;
    appliedDefault.current = true;
    setResort(b.resort);
    setPark(b.code);
  }, [busiestQ.data, park]);

  return (
    <div className="flex flex-col gap-4 md:gap-6 md:py-6">
      <div className="hidden flex-col gap-1 px-4 md:flex lg:px-6">
        <h2 className="text-xl font-semibold tracking-tight">Ticket Pricing</h2>
        <p className="text-muted-foreground text-sm">
          Cheapest {productLabel.toLowerCase()} by date — find the cheapest day to go.
          {lastUpdatedAt && (
            <span className="ml-2 text-xs">
              Updated{" "}
              {(() => {
                const diff = Date.now() - new Date(lastUpdatedAt).getTime();
                const min = Math.floor(diff / 60_000);
                if (min < 1) return "just now";
                if (min < 60) return `${min}m ago`;
                return `${Math.floor(min / 60)}h ago`;
              })()}
            </span>
          )}
        </p>
      </div>

      {/* Mobile: per-park shelves of price/weather/crowd tiles — the whole mobile
          experience. Desktop keeps the picker + summary + calendar below. */}
      <TicketsMobileShelves
        parkHopper={parkHopper}
        ageGroup={ageGroup}
        enabled={isMobile}
        className="md:hidden"
      />

      {/* Core-search bar — park (resort inferred) + (WDW) ticket type + age.
          Hidden on mobile; the floating FAB drawer carries these controls there. */}
      <div className="-mx-1 hidden min-w-0 overflow-x-auto overflow-y-clip px-5 py-1 md:block lg:px-7">
        <div className="flex w-max items-stretch">
          <CoreSearchSegment
            pos={posOf("park")}
            label="Park"
            value={parkLabel}
            muted={!park}
            open={openSeg === "park"}
            onOpenChange={(o) => setOpenSeg(o ? "park" : null)}
            align="start"
            contentClassName="w-72"
          >
            {RESORTS.map((r) => {
              const groupParks = r.value === "WDW" ? WDW_PARKS : UOR_PARKS;
              return (
                <div key={r.value} className="not-first:mt-1">
                  <p className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-medium">
                    {r.label}
                  </p>
                  <CoreSearchOption
                    label={`All ${r.label} parks`}
                    selected={resort === r.value && !park}
                    onSelect={() => selectPark(r.value, null)}
                  />
                  {groupParks.map((p) => (
                    <CoreSearchOption
                      key={p.code}
                      label={p.label}
                      selected={resort === r.value && park === p.code}
                      onSelect={() => selectPark(r.value, p.code)}
                    />
                  ))}
                </div>
              );
            })}
          </CoreSearchSegment>

          {resort === "WDW" && (
            <CoreSearchSegment
              pos={posOf("type")}
              label="Ticket type"
              value={parkHopper ? "Park Hopper" : "Standard"}
              muted={false}
              open={openSeg === "type"}
              onOpenChange={(o) => setOpenSeg(o ? "type" : null)}
              align="center"
            >
              <CoreSearchOption
                label="Standard"
                selected={!parkHopper}
                onSelect={() => {
                  setParkHopper(false);
                  setOpenSeg(null);
                }}
              />
              <CoreSearchOption
                label="Park Hopper"
                selected={parkHopper}
                onSelect={() => {
                  setParkHopper(true);
                  setOpenSeg(null);
                }}
              />
            </CoreSearchSegment>
          )}

          <CoreSearchSegment
            pos={posOf("age")}
            label="Age"
            value={ageGroup === "ADULT" ? "Adult" : "Child"}
            muted={false}
            open={openSeg === "age"}
            onOpenChange={(o) => setOpenSeg(o ? "age" : null)}
            align="end"
          >
            <CoreSearchOption
              label="Adult"
              selected={ageGroup === "ADULT"}
              onSelect={() => {
                setAgeGroup("ADULT");
                setOpenSeg(null);
              }}
            />
            <CoreSearchOption
              label="Child"
              selected={ageGroup === "CHILD"}
              onSelect={() => {
                setAgeGroup("CHILD");
                setOpenSeg(null);
              }}
            />
          </CoreSearchSegment>
        </div>
      </div>

      <div className="hidden grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs md:grid lg:px-6 @xl/main:grid-cols-3 dark:*:data-[slot=card]:bg-card">
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Cheapest day</CardDescription>
            <CardTitle className="text-xl font-semibold tabular-nums @sm/card:text-2xl">
              {stats ? dollars(stats.min) : "—"}
            </CardTitle>
            <CardDescription>
              {stats?.cheapest
                ? new Date(`${stats.cheapest.date}T00:00:00`).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "long",
                    day: "numeric",
                  })
                : "No pricing yet"}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Price range</CardDescription>
            <CardTitle className="text-xl font-semibold tabular-nums @sm/card:text-2xl">
              {stats ? `${dollars(stats.min)}–${dollars(stats.max)}` : "—"}
            </CardTitle>
            <CardDescription>
              {productLabel} over the next {DAYS} days
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Today</CardDescription>
            <CardTitle className="text-xl font-semibold tabular-nums @sm/card:text-2xl">
              {priceMap.get(localIso(today))
                ? dollars(priceMap.get(localIso(today))!.priceCents)
                : "—"}
            </CardTitle>
            <CardDescription>{productLabel} for today</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <div className="hidden px-4 md:block lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>{resortLabel}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {productLabel} · cheapest in <span className="text-primary">color</span>, sold-out
                struck through
              </span>
              {data.hasOverlay && (
                <span
                  className="flex flex-wrap items-center gap-1.5"
                  aria-label="Crowd level legend"
                >
                  {([1, 4, 6, 8] as const).map((idx) => {
                    const cfg = crowdConfig(idx);
                    return (
                      <span
                        key={cfg.label}
                        className={cn(
                          "rounded-full px-2 py-[3px] text-[10px] font-semibold uppercase tracking-widest leading-none",
                          cfg.pill,
                        )}
                      >
                        {cfg.label}
                      </span>
                    );
                  })}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <div className="px-2 pb-4 sm:px-6">
            <PriceCalendarGrid
              resort={resort}
              park={park}
              parkHopper={parkHopper}
              ageGroup={ageGroup}
              enabled={!isMobile}
            />
          </div>
        </Card>
      </div>

      <TicketsMobileControls
        parkHopper={parkHopper}
        ageGroup={ageGroup}
        onParkHopper={setParkHopper}
        onAgeGroup={setAgeGroup}
      />
    </div>
  );
}
