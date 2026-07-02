import { SlidersHorizontalIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import { cn } from "#/lib/utils.ts";

import {
  EMPTY_RIDE_FILTER,
  MAX_WAIT_OPTIONS,
  rideFilterCount,
  useRideFilter,
} from "./ride-filter.tsx";

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      className="rounded-full"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/**
 * Ride filter trigger + drawer, shared by the map and the Waits list. Renders a
 * pill button (with an active-count badge) that opens a bottom drawer of filter
 * controls; everything writes straight to the shared `useRideFilter` state.
 * Pass `className` to position/skin the trigger for each surface.
 */
export function RideFilterButton({ className }: { className?: string }) {
  const { filter, setFilter } = useRideFilter();
  const count = rideFilterCount(filter);

  return (
    <Drawer>
      <DrawerTrigger
        className={cn(
          "btn-3d-outline border-3d shadow-3d inline-flex w-fit items-center gap-2 rounded-full bg-background px-4.5 py-2.5 text-base font-medium transition active:scale-95 dark:border-border",
          className,
        )}
      >
        <SlidersHorizontalIcon className="size-5" />
        Filter
        {count > 0 && (
          <span className="bg-primary text-primary-foreground ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs font-bold leading-[1.25rem]">
            {count}
          </span>
        )}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="border-b pb-4">
          <DrawerTitle>Filter rides</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-4 pt-6">
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Max wait
            </span>
            <div className="flex flex-wrap gap-2 pt-1">
              <Chip
                active={filter.maxWait == null}
                onClick={() => setFilter((f) => ({ ...f, maxWait: null }))}
              >
                Any
              </Chip>
              {MAX_WAIT_OPTIONS.map((w) => (
                <Chip
                  key={w}
                  active={filter.maxWait === w}
                  onClick={() => setFilter((f) => ({ ...f, maxWait: f.maxWait === w ? null : w }))}
                >
                  ≤ {w}m
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Chip
              active={filter.openOnly}
              onClick={() => setFilter((f) => ({ ...f, openOnly: !f.openOnly }))}
            >
              Open now
            </Chip>
            <Chip
              active={filter.noHeightReq}
              onClick={() => setFilter((f) => ({ ...f, noHeightReq: !f.noHeightReq }))}
            >
              No height requirement
            </Chip>
          </div>
        </div>
        <DrawerFooter className="flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1 rounded-full"
            onClick={() => setFilter(EMPTY_RIDE_FILTER)}
          >
            Clear all
          </Button>
          <DrawerClose asChild>
            <Button className="flex-1 rounded-full">Show rides</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
