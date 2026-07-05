"use client";

import { Link } from "@tanstack/react-router";

import { DiningAlertButton } from "#/components/dining/dining-alert-button.tsx";
import { DiningMenuDrawer } from "#/components/dining/dining-menu-drawer.tsx";
import {
  priceTier,
  type AvailabilityEntry,
  type AvailabilityMap,
  type DayEntry,
  type Restaurant,
} from "#/components/dining/dining-filters.ts";
import {
  hoursLabel,
  isOpenNow,
  type HoursMap,
  type ScheduleEntry,
} from "#/components/dining/dining-hours.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { cn } from "#/lib/utils.ts";

export function AvailabilityCalendar({
  days,
  windowDays,
  referenceDate,
}: {
  days: Array<DayEntry>;
  windowDays: number;
  referenceDate: string;
}) {
  const shown = days.slice(0, Math.min(windowDays, 7));
  return (
    <div className="flex gap-1">
      {shown.map((d) => {
        const date = new Date(`${d.date}T00:00:00`);
        const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
        const dayNum = date.getDate();
        const isToday = d.date === referenceDate;
        return (
          <div
            key={d.date}
            title={
              d.available
                ? `${d.offerCount} slot${d.offerCount === 1 ? "" : "s"}`
                : "No availability"
            }
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 rounded py-1",
              d.available
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground/60",
              isToday && "ring-2 ring-inset ring-foreground/20",
            )}
          >
            <span className="text-[10px] leading-none">{dayName}</span>
            <span className="text-xs font-medium leading-none">{dayNum}</span>
          </div>
        );
      })}
    </div>
  );
}

function RestaurantTagBadges({ restaurant }: { restaurant: Restaurant }) {
  const tag =
    "border-0 bg-background/85 text-foreground text-[11px] font-medium shadow-sm backdrop-blur-sm";
  return (
    <>
      {restaurant.requiresParkTicket && (
        <Badge className="bg-yellow-400 text-black text-[11px] font-medium border-0 shadow-sm">
          Needs Park Entry
        </Badge>
      )}
      {restaurant.characterDining && <Badge className={tag}>Characters</Badge>}
      {restaurant.dinnerShow && <Badge className={tag}>Dinner show</Badge>}
      {restaurant.diningPackage && <Badge className={tag}>Package</Badge>}
      {restaurant.fineDining && <Badge className={tag}>Signature</Badge>}
    </>
  );
}

/**
 * Label for the soonest available day: "Reservations available today", "…this Thu"
 * (within the next week), or "…Jul 15" (a specific date more than a week out).
 */
function nextAvailableLabel(days: Array<DayEntry>, referenceDate: string): string | null {
  const next = days.find((d) => d.available);
  if (!next) return null;
  const prefix = "Reservations available";
  if (next.date === referenceDate) return `${prefix} today`;
  const ref = new Date(`${referenceDate}T00:00:00`);
  const day = new Date(`${next.date}T00:00:00`);
  const diff = Math.round((day.getTime() - ref.getTime()) / 86_400_000);
  if (diff < 7) return `${prefix} this ${day.toLocaleDateString("en-US", { weekday: "short" })}`;
  return `${prefix} ${day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function RestaurantCard({
  restaurant,
  availability,
  referenceDate,
  schedules,
  nowMin,
  loggedIn,
  defaultPartySize,
}: {
  restaurant: Restaurant;
  availability: AvailabilityEntry | undefined;
  referenceDate: string;
  schedules: Array<ScheduleEntry> | undefined;
  nowMin: number;
  loggedIn: boolean;
  defaultPartySize: number;
}) {
  const subtitle = [restaurant.parkResort, restaurant.experienceType ?? restaurant.cuisine]
    .filter(Boolean)
    .join(" · ");
  const todayHours = schedules ? hoursLabel(schedules) : null;
  const openNow = schedules ? isOpenNow(schedules, nowMin) : false;
  const availLabel = availability ? nextAvailableLabel(availability.days, referenceDate) : null;

  const hasTags =
    restaurant.requiresParkTicket ||
    restaurant.characterDining ||
    restaurant.dinnerShow ||
    restaurant.diningPackage ||
    restaurant.fineDining;

  return (
    <div className="group flex gap-3">
      {/* Uber-style row: compact image on the left, details on the right */}
      <Link
        to="/dining/$facilityId"
        params={{ facilityId: restaurant.facilityId }}
        className="bg-muted relative block w-[7.5rem] shrink-0 self-stretch overflow-hidden rounded-2xl outline-none sm:w-[9.5rem]"
      >
        {restaurant.imageUrl ? (
          <img
            src={restaurant.imageUrl}
            alt={restaurant.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}
        {restaurant.priceRange && (
          <Badge
            variant="secondary"
            className="absolute top-2 left-2 bg-background/85 text-[11px] font-medium shadow-sm backdrop-blur-sm"
          >
            {priceTier(restaurant.priceRange)}
          </Badge>
        )}
        {hasTags && (
          <div className="absolute bottom-2 left-2 flex flex-col items-start gap-1">
            <RestaurantTagBadges restaurant={restaurant} />
          </div>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="min-w-0">
          <Link
            to="/dining/$facilityId"
            params={{ facilityId: restaurant.facilityId }}
            className="line-clamp-1 text-sm font-medium group-hover:underline sm:text-base"
          >
            {restaurant.name}
          </Link>
          <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">{subtitle}</p>
        </div>

        {todayHours && (
          <span
            className={cn(
              "text-xs font-medium",
              openNow ? "text-emerald-600" : "text-muted-foreground",
            )}
          >
            {openNow ? "Open" : "Closed"} · {todayHours}
          </span>
        )}

        <span className="flex items-center gap-1.5 text-xs">
          {availLabel ? (
            <>
              <span className="bg-primary size-2 shrink-0 rounded-sm" />
              <span className="font-medium">{availLabel}</span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {availability ? "No tables in range" : "No observations yet"}
            </span>
          )}
        </span>

        <div className="mt-auto flex items-center gap-2 pt-0.5">
          {restaurant.hasMenu ? (
            <div className="flex-1">
              <DiningMenuDrawer facilityId={restaurant.facilityId} name={restaurant.name} />
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <DiningAlertButton
            facilityId={restaurant.facilityId}
            restaurantName={restaurant.name}
            defaultPartySize={defaultPartySize}
            loggedIn={loggedIn}
          />
        </div>
      </div>
    </div>
  );
}

export type { AvailabilityMap, HoursMap };
