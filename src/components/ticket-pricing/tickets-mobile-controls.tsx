"use client";

import { SlidersHorizontalIcon } from "lucide-react";

import { MAP_FILTER_PILL, MAP_FILTER_STACK } from "#/components/rides/ride-filter-button.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import { PillRow, Section } from "#/components/ui/drawer-form.tsx";

type AgeGroup = "ADULT" | "CHILD";

/**
 * Mobile floating pill for the ticket-pricing controls — mirrors the dining FAB.
 * With the mobile page now showing every park as its own shelf, the park picker
 * is gone; the drawer just tunes what price the shelves show: the Disney ticket
 * type (park hopper affects the WDW shelves) and the age group.
 */
export function TicketsMobileControls({
  parkHopper,
  ageGroup,
  onParkHopper,
  onAgeGroup,
}: {
  parkHopper: boolean;
  ageGroup: AgeGroup;
  onParkHopper: (hopper: boolean) => void;
  onAgeGroup: (age: AgeGroup) => void;
}) {
  return (
    <div
      className={MAP_FILTER_STACK}
      style={{ bottom: "calc(var(--safe-bottom) + var(--bottom-nav-height) + 1.4rem)" }}
    >
      {/* Single Filter pill matching the map's Filter button exactly. */}
      <Drawer>
        <DrawerTrigger className={MAP_FILTER_PILL}>
          <SlidersHorizontalIcon />
          Filter
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="border-b pb-4">
            <DrawerTitle>Ticket options</DrawerTitle>
            <DrawerDescription>Choose a ticket type and age.</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4 pt-2">
            <Section label="Disney ticket type">
              <PillRow
                options={["standard", "hopper"]}
                value={parkHopper ? "hopper" : "standard"}
                onSelect={(v) => onParkHopper(v === "hopper")}
                labelOf={(v) => (v === "hopper" ? "Park Hopper" : "Standard")}
              />
            </Section>

            <Section label="Age">
              <PillRow
                options={["ADULT", "CHILD"]}
                value={ageGroup}
                onSelect={(v) => onAgeGroup(v as AgeGroup)}
                labelOf={(v) => (v === "ADULT" ? "Adult" : "Child")}
              />
            </Section>
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button className="rounded-full">Done</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
