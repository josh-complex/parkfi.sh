"use client";

import { CheckIcon, SlidersHorizontalIcon } from "lucide-react";

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
import { UOR_PARKS, WDW_PARKS } from "#/lib/parks.ts";
import { cn } from "#/lib/utils.ts";

type Resort = "WDW" | "UOR";
type AgeGroup = "ADULT" | "CHILD";

const RESORTS: Array<{ value: Resort; label: string }> = [
  { value: "WDW", label: "Walt Disney World" },
  { value: "UOR", label: "Universal Orlando" },
];

/** A selectable option row inside the Park section. */
function OptionRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "hover:bg-accent hover:text-accent-foreground flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors",
        selected && "font-medium",
      )}
    >
      <span className="truncate">{label}</span>
      {selected && <CheckIcon className="size-4 shrink-0" />}
    </button>
  );
}

/**
 * Mobile floating pill for the ticket-pricing controls — mirrors the dining FAB.
 * Opens a single drawer with Park / Ticket type / Age; selections apply
 * immediately (the page has no search-commit step), so the footer is just "Done".
 */
export function TicketsMobileControls({
  resort,
  park,
  parkHopper,
  ageGroup,
  onSelectPark,
  onParkHopper,
  onAgeGroup,
}: {
  resort: Resort;
  park: string | null;
  parkHopper: boolean;
  ageGroup: AgeGroup;
  onSelectPark: (resort: Resort, code: string | null) => void;
  onParkHopper: (hopper: boolean) => void;
  onAgeGroup: (age: AgeGroup) => void;
}) {
  const parks = resort === "WDW" ? WDW_PARKS : UOR_PARKS;
  const resortLabel = RESORTS.find((r) => r.value === resort)?.label ?? "";
  const parkLabel = park
    ? (parks.find((p) => p.code === park)?.label ?? "All parks")
    : `All ${resortLabel} parks`;

  const facets = [
    parkLabel,
    resort === "WDW" ? (parkHopper ? "Hopper" : "Standard") : null,
    ageGroup === "ADULT" ? "Adult" : "Child",
  ].filter(Boolean);

  return (
    <div
      className="fixed left-1/2 z-40 -translate-x-1/2 md:hidden"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height) + 1rem)" }}
    >
      <div className="bg-popover/95 supports-backdrop-filter:backdrop-blur flex items-center rounded-full border p-1 shadow-xl">
        <Drawer>
          <DrawerTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 rounded-full px-3 text-xs font-medium"
            >
              <SlidersHorizontalIcon className="size-3.5 shrink-0" />
              <span className="max-w-[60vw] truncate">{facets.join(" · ")}</span>
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader className="border-b pb-4">
              <DrawerTitle>Ticket options</DrawerTitle>
              <DrawerDescription>Choose a park, ticket type, and age.</DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4 pt-2">
              <Section label="Park">
                <div className="flex flex-col gap-2">
                  {RESORTS.map((r) => {
                    const groupParks = r.value === "WDW" ? WDW_PARKS : UOR_PARKS;
                    return (
                      <div key={r.value}>
                        <p className="text-muted-foreground px-3 pb-1 pt-1 text-xs font-medium">
                          {r.label}
                        </p>
                        <OptionRow
                          label={`All ${r.label} parks`}
                          selected={resort === r.value && !park}
                          onSelect={() => onSelectPark(r.value, null)}
                        />
                        {groupParks.map((p) => (
                          <OptionRow
                            key={p.code}
                            label={p.label}
                            selected={resort === r.value && park === p.code}
                            onSelect={() => onSelectPark(r.value, p.code)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </Section>

              {resort === "WDW" && (
                <Section label="Ticket type">
                  <PillRow
                    options={["standard", "hopper"]}
                    value={parkHopper ? "hopper" : "standard"}
                    onSelect={(v) => onParkHopper(v === "hopper")}
                    labelOf={(v) => (v === "hopper" ? "Park Hopper" : "Standard")}
                  />
                </Section>
              )}

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
    </div>
  );
}
