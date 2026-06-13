"use client";

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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { cn } from "#/lib/utils.ts";

function AvailabilityCalendar({
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
  return (
    <>
      {restaurant.requiresParkTicket && (
        <Badge className="bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
          Park ticket
        </Badge>
      )}
      {restaurant.characterDining && (
        <Badge className="bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
          Characters
        </Badge>
      )}
      {restaurant.dinnerShow && (
        <Badge className="bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
          Dinner show
        </Badge>
      )}
      {restaurant.fineDining && (
        <Badge className="bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
          Signature
        </Badge>
      )}
    </>
  );
}

export function RestaurantCard({
  restaurant,
  availability,
  windowDays,
  referenceDate,
  schedules,
  nowMin,
}: {
  restaurant: Restaurant;
  availability: AvailabilityEntry | undefined;
  windowDays: number;
  referenceDate: string;
  schedules: Array<ScheduleEntry> | undefined;
  nowMin: number;
}) {
  const subtitle = [restaurant.parkResort, restaurant.experienceType ?? restaurant.cuisine]
    .filter(Boolean)
    .join(" · ");
  const todayHours = schedules ? hoursLabel(schedules) : null;
  const openNow = schedules ? isOpenNow(schedules, nowMin) : false;

  const hasTags =
    restaurant.requiresParkTicket ||
    restaurant.characterDining ||
    restaurant.dinnerShow ||
    restaurant.fineDining;

  return (
    <Card className="@container/card overflow-hidden pt-0 gap-2 pb-2">
      {restaurant.imageUrl && (
        <div className="bg-muted relative h-32 w-full overflow-hidden">
          <img
            src={restaurant.imageUrl}
            alt={restaurant.name}
            loading="lazy"
            className="size-full object-cover"
          />
          {restaurant.priceRange && (
            <Badge className="absolute top-2 left-2 bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
              {priceTier(restaurant.priceRange)}
            </Badge>
          )}
          {todayHours &&
            (openNow ? (
              <Badge className="absolute top-2 right-2 bg-emerald-500 text-white shadow">
                Open · {todayHours}
              </Badge>
            ) : (
              <Badge variant="secondary" className="absolute top-2 right-2 shadow">
                Closed · {todayHours}
              </Badge>
            ))}
          {hasTags && (
            <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
              <RestaurantTagBadges restaurant={restaurant} />
            </div>
          )}
        </div>
      )}
      <CardHeader
        className={cn("px-3 sm:px-4 pb-1", restaurant.imageUrl ? "pt-2 sm:pt-3" : "pt-3 sm:pt-4")}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-1 text-base sm:text-lg">
              {restaurant.detailUrl ? (
                <a
                  href={restaurant.detailUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {restaurant.name}
                </a>
              ) : (
                restaurant.name
              )}
            </CardTitle>
            <CardDescription className="mt-0.5 line-clamp-1">{subtitle}</CardDescription>
          </div>
          {!restaurant.imageUrl && todayHours && openNow && (
            <Badge className="bg-emerald-500 text-white shrink-0">Open · {todayHours}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-3 sm:px-4 flex flex-col gap-1 pt-0 pb-2">
        {availability ? (
          <AvailabilityCalendar
            days={availability.days}
            windowDays={windowDays}
            referenceDate={referenceDate}
          />
        ) : (
          <p className="text-xs text-muted-foreground">No observations yet</p>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {availability ? (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-primary shrink-0" />
              Reservations available
            </span>
          ) : (
            <span>No availability data</span>
          )}
          {!restaurant.imageUrl && restaurant.priceRange && (
            <Badge variant="outline" className="font-normal text-xs shrink-0">
              {priceTier(restaurant.priceRange)}
            </Badge>
          )}
        </div>
        {!restaurant.imageUrl && hasTags && (
          <div className="flex flex-wrap gap-1">
            <RestaurantTagBadges restaurant={restaurant} />
          </div>
        )}
        {restaurant.hasMenu && (
          <DiningMenuDrawer facilityId={restaurant.facilityId} name={restaurant.name} />
        )}
      </CardContent>
    </Card>
  );
}

export type { AvailabilityMap, HoursMap };
