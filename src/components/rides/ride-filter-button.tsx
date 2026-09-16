import { SearchIcon, SlidersHorizontalIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Input } from "#/components/ui/input.tsx";
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
  HEIGHT_BAND_OPTIONS,
  MAX_WAIT_OPTIONS,
  useRideFilter,
} from "./ride-filter.tsx";

import type { RIDE_CATEGORIES } from "./ride-filter.tsx";
import type { ParkPulse } from "./waits-data.ts";

/**
 * The map's filter-pill look, shared verbatim by every mobile filter/sort FAB so
 * they match the map's bottom-left `Filter` button exactly. It's the same
 * embossed 3D pill the map renders — a `DrawerTrigger`/`button` gets this class,
 * with an icon (auto-sized to `size-4`) + label as children. Each surface owns
 * its own drawer content; only the trigger's design is shared.
 */
export const MAP_FILTER_PILL =
  "btn-3d-outline border-3d shadow-3d pointer-events-auto inline-flex w-fit items-center gap-1.5 rounded-full bg-background px-4 py-2 text-sm font-medium transition active:scale-95 dark:border-[color-mix(in_oklch,var(--border),white_25%)] [&>svg]:size-4";

/** Vertical stack wrapper matching the map's bottom-left control cluster:
 *  left-anchored, above the mobile nav island, mobile-only. Hugs the same
 *  `--chrome-gutter` as the nav island and the map clusters. */
export const MAP_FILTER_STACK =
  "pointer-events-none fixed left-(--chrome-gutter) z-40 flex flex-col items-start gap-2 md:hidden";

/** Right-hand mirror of `MAP_FILTER_STACK` for the view/layout toggles that sit
 *  opposite the filter pills (see the Waits board). */
export const MAP_FILTER_STACK_RIGHT =
  "pointer-events-none fixed right-(--chrome-gutter) z-40 flex flex-col items-end gap-2 md:hidden";

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

/** A section of the filter body: an uppercase label over its control. */
function Group({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

/** One park in the Parks group: a checkbox, the name, and its live average. */
function ParkRow({
  park,
  checked,
  onChange,
}: {
  park: ParkPulse;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        // The selected row is tinted `--wash` so the strip's pressed card and
        // this ticked box visibly are the same filter (§2.2).
        "-mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1 transition-colors",
        checked ? "bg-wash" : "hover:bg-muted/60",
      )}
    >
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span className={cn("flex-1 truncate text-sm", checked && "font-semibold")}>{park.name}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {park.closed ? "closed" : park.avg != null ? `${park.avg} min` : "—"}
      </span>
    </label>
  );
}

/**
 * The filter body, writing straight to the shared `useRideFilter` state.
 *
 * **One component, two faces.** The Waits page's desktop rail and its phone
 * drawer both render *this* — and so does the map's drawer — so a filter can
 * never exist on one surface and not the other (docs/plans/waits-redesign §3).
 * The groups a surface has no business showing are simply not passed: the map
 * gets no `parks` (it is already scoped to one) and no `categories` (it draws
 * its own chips on the map itself).
 */
export interface RideFilterControlsProps {
  /** Park rows for the Parks group; omit to hide it (the map). */
  parks?: ReadonlyArray<ParkPulse>;
  /** Attraction types actually present in the data; omit to hide the group. */
  categories?: typeof RIDE_CATEGORIES;
  /** Show the name-search field. */
  search?: boolean;
  className?: string;
}

export function RideFilterControls({
  parks,
  categories,
  search,
  className,
}: RideFilterControlsProps) {
  const { filter, setFilter } = useRideFilter();
  const toggleSet = (key: "parks" | "categories", value: string) =>
    setFilter((f) => {
      const next = new Set(f[key]);
      if (!next.delete(value)) next.add(value);
      return { ...f, [key]: next };
    });

  return (
    <div className={cn("flex flex-col gap-6 overflow-y-auto px-4 pt-6 pb-4", className)}>
      {search && (
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
            placeholder="Find an attraction"
            aria-label="Find an attraction by name"
            className="h-11 pl-10"
          />
        </div>
      )}

      {parks && parks.length > 0 && (
        <Group label="Parks">
          <div className="flex flex-col gap-1">
            {parks.map((p) => (
              <ParkRow
                key={p.slug}
                park={p}
                checked={filter.parks.has(p.slug)}
                onChange={() => toggleSet("parks", p.slug)}
              />
            ))}
          </div>
        </Group>
      )}

      {categories && categories.length > 0 && (
        <Group label="Type" className={parks ? "border-t pt-4" : undefined}>
          <div className="flex flex-wrap gap-2 pt-1">
            {categories.map((c) => (
              <Chip
                key={c.key}
                active={filter.categories.has(c.key)}
                onClick={() => toggleSet("categories", c.key)}
              >
                {c.emoji} {c.label}
              </Chip>
            ))}
          </div>
        </Group>
      )}

      <Group
        label="Longest I'll wait"
        className={parks || categories ? "border-t pt-4" : undefined}
      >
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
      </Group>

      <Group label="Rider height" className="border-t pt-4">
        <div className="flex flex-wrap gap-2 pt-1">
          <Chip
            active={!filter.noHeightReq && filter.heightBand == null}
            onClick={() => setFilter((f) => ({ ...f, noHeightReq: false, heightBand: null }))}
          >
            Any
          </Chip>
          <Chip
            active={filter.noHeightReq}
            onClick={() =>
              setFilter((f) => ({ ...f, noHeightReq: !f.noHeightReq, heightBand: null }))
            }
          >
            No minimum
          </Chip>
          {/* "Rides my 42-incher can get on" — the band is the rider's height,
              so it matches every ride whose minimum is at or below it. */}
          {HEIGHT_BAND_OPTIONS.map((h) => (
            <Chip
              key={h}
              active={filter.heightBand === h}
              onClick={() =>
                setFilter((f) => ({
                  ...f,
                  heightBand: f.heightBand === h ? null : h,
                  noHeightReq: false,
                }))
              }
            >
              {h}&quot;
            </Chip>
          ))}
        </div>
      </Group>

      <Group label="Only show" className="border-t pt-4">
        <div className="flex flex-wrap gap-2 pt-1">
          <Chip
            active={filter.openOnly}
            onClick={() => setFilter((f) => ({ ...f, openOnly: !f.openOnly }))}
          >
            Open now
          </Chip>
          {/* Universal publishes these three; Disney publishes none of them, so a
              row with no data never matches and the chips simply find nothing at
              a WDW park rather than lying about it. */}
          <Chip
            active={filter.expressPass}
            onClick={() => setFilter((f) => ({ ...f, expressPass: !f.expressPass }))}
          >
            Express Pass
          </Chip>
          <Chip
            active={filter.singleRider}
            onClick={() => setFilter((f) => ({ ...f, singleRider: !f.singleRider }))}
          >
            Single rider
          </Chip>
          <Chip
            active={filter.childSwap}
            onClick={() => setFilter((f) => ({ ...f, childSwap: !f.childSwap }))}
          >
            Child swap
          </Chip>
        </div>
      </Group>
    </div>
  );
}

/** Footer actions for a ride-filter drawer: clear-all + a close button. */
export function RideFilterFooter({ closeLabel = "Show rides" }: { closeLabel?: string }) {
  const { setFilter } = useRideFilter();
  return (
    <DrawerFooter className="flex-row gap-2">
      <Button
        variant="outline"
        className="flex-1 rounded-full"
        onClick={() => setFilter(EMPTY_RIDE_FILTER)}
      >
        Clear all
      </Button>
      <DrawerClose asChild>
        <Button className="flex-1 rounded-full">{closeLabel}</Button>
      </DrawerClose>
    </DrawerFooter>
  );
}

/**
 * Ride filter trigger + drawer, shared by the map and the Waits list. Renders a
 * pill button that opens a bottom drawer of filter
 * controls; everything writes straight to the shared `useRideFilter` state.
 * Pass `className` to position/skin the trigger for each surface.
 */
export function RideFilterButton({ className }: { className?: string }) {
  return (
    <Drawer>
      <DrawerTrigger
        className={cn(
          "btn-3d-outline border-3d shadow-3d inline-flex w-fit items-center gap-2 rounded-full bg-background px-4.5 py-2.5 text-base font-medium transition active:scale-95 dark:border-[color-mix(in_oklch,var(--border),white_25%)]",
          className,
        )}
      >
        <SlidersHorizontalIcon className="size-5" />
        Filter
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="border-b pb-4">
          <DrawerTitle>Filter rides</DrawerTitle>
        </DrawerHeader>
        <RideFilterControls />
        <RideFilterFooter />
      </DrawerContent>
    </Drawer>
  );
}
