"use client";

import * as React from "react";
import { useStore } from "@tanstack/react-store";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import { SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";

import {
  clearExtraFilters,
  diningStore,
  patchFilters,
  setPartySize,
} from "#/components/dining/dining-store.ts";
import {
  countExtraFilters,
  FEATURE_FILTERS,
  OPERATOR_LABELS,
  type FilterOptions,
  type Operator,
} from "#/components/dining/dining-filters.ts";
import { HOURS_LABELS, HOURS_OPTIONS } from "#/components/dining/dining-hours.ts";
import { Button, buttonVariants } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Switch } from "#/components/animate-ui/components/switch-anim";
import { cn } from "#/lib/utils.ts";

// Shared-layout ids: the panel id morphs the trigger box ↔ the modal container;
// the label id carries the "Filters" word from the button into the dialog title.
const FILTERS_PANEL_ID = "dining-filters-panel";
const FILTERS_LABEL_ID = "dining-filters-label";
const FILTERS_RADIUS = 18;
const FILTERS_SPRING = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.9 };

// Same 3D border + glare + drop-shadow the outline Button wears.
const FILTERS_SURFACE =
  "bg-background border border-(--btn-3d) [--btn-3d:color-mix(in_oklch,var(--border),var(--border))] [--btn-glare:oklch(1_0_0/0.55)] shadow-[0_4px_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)] dark:bg-popover dark:[--btn-3d:transparent] dark:[--btn-glare:oklch(1_0_0/0.06)] dark:ring-1 dark:ring-foreground/10";

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4">
      <span className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

/** Full-width single-select segmented control used in filter panels. */
export function PillRow<T extends string>({
  options,
  value,
  onSelect,
  labelOf,
}: {
  options: Array<T>;
  value: T;
  onSelect: (v: T) => void;
  labelOf: (v: T) => string;
}) {
  return (
    <ToggleGroup
      multiple={false}
      value={[value]}
      onValueChange={(v) => onSelect((v[0] as T) ?? value)}
      variant="outline"
      size="sm"
      className="w-full"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o}
          value={o}
          className="flex-1 px-2 text-center leading-tight whitespace-normal"
        >
          {labelOf(o)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A single-select dropdown with a leading "All" option, for long option lists. */
export function AllSelect({
  value,
  onValueChange,
  allLabel,
  options,
  ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  allLabel: string;
  options: Array<string>;
  ariaLabel: string;
}) {
  const items: Record<string, string> = { ALL: allLabel };
  for (const o of options) items[o] = o;
  return (
    <Select value={value} onValueChange={(v) => v && onValueChange(v)} items={items}>
      <SelectTrigger size="sm" className="w-full" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Post-search extended-filter body — every facet the pill doesn't own. Rendered
 * inside the FiltersModal for both mobile and desktop.
 */
export function ExtendedFilters({ options }: { options: FilterOptions }) {
  const filters = useStore(diningStore, (s) => s.filters);
  const partySize = useStore(diningStore, (s) => s.partySize);
  const todayOnly = filters.availability === "today";

  return (
    <div className="divide-y">
      <div className="relative py-4">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={filters.search}
          onChange={(e) => patchFilters({ search: e.target.value })}
          placeholder="Search by name"
          aria-label="Search restaurants"
          className="pl-9"
        />
      </div>

      <Section label="Operator">
        <PillRow
          options={Object.keys(OPERATOR_LABELS) as Array<Operator>}
          value={filters.operator}
          onSelect={(v) => patchFilters({ operator: v })}
          labelOf={(v) => (v === "ALL" ? "All" : OPERATOR_LABELS[v])}
        />
      </Section>

      {options.prices.length > 0 && (
        <Section label="Price">
          <div className="flex flex-wrap gap-2">
            {options.prices.map((p) => {
              const on = filters.prices.includes(p);
              return (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  className="min-w-10 rounded-full"
                  onClick={() =>
                    patchFilters({
                      prices: on ? filters.prices.filter((x) => x !== p) : [...filters.prices, p],
                    })
                  }
                >
                  {p}
                </Button>
              );
            })}
          </div>
        </Section>
      )}

      <Section label="Availability">
        <label className="flex cursor-pointer items-center gap-3">
          <Switch
            checked={todayOnly}
            onCheckedChange={(checked) => patchFilters({ availability: checked ? "today" : "ALL" })}
          />
          <span className="text-sm font-medium">Open today</span>
        </label>
      </Section>

      <Section label="Hours">
        <PillRow
          options={[...HOURS_OPTIONS]}
          value={filters.hours}
          onSelect={(v) => patchFilters({ hours: v })}
          labelOf={(v) => HOURS_LABELS[v]}
        />
      </Section>

      <Section label="Features">
        <div className="flex flex-wrap gap-2">
          {FEATURE_FILTERS.map((f) => {
            const on = filters.features.includes(f.key);
            return (
              <Button
                key={f.key}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                className="rounded-full"
                onClick={() =>
                  patchFilters({
                    features: on
                      ? filters.features.filter((x) => x !== f.key)
                      : [...filters.features, f.key],
                  })
                }
              >
                {f.label}
              </Button>
            );
          })}
        </div>
      </Section>

      <Section label="Party size">
        <PillRow
          options={Array.from({ length: 8 }, (_, i) => String(i + 1))}
          value={partySize}
          onSelect={setPartySize}
          labelOf={(v) => v}
        />
      </Section>
    </div>
  );
}

/**
 * The desktop "Filters" control. The trigger is a standard outline button that
 * physically morphs into the filter modal via shared-layout animation.
 */
export function FiltersModal({ options }: { options: FilterOptions }) {
  const extraCount = useStore(diningStore, (s) => countExtraFilters(s.filters));

  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <motion.button
        layoutId={FILTERS_PANEL_ID}
        type="button"
        onClick={() => setOpen(true)}
        animate={{ opacity: open ? 0 : 1 }}
        transition={{
          layout: FILTERS_SPRING,
          opacity: { duration: open ? 0.06 : 0.18, delay: open ? 0 : 0.2 },
        }}
        style={{ borderRadius: FILTERS_RADIUS }}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        <SlidersHorizontalIcon data-icon="inline-start" />
        {!open && (
          <motion.span
            layoutId={FILTERS_LABEL_ID}
            transition={{ layout: FILTERS_SPRING }}
            className="inline-block"
          >
            Filters
          </motion.span>
        )}
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
              <motion.div
                className="absolute inset-0 bg-black/40 supports-backdrop-filter:backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.14 } }}
                exit={{ opacity: 0, transition: { duration: 0.07 } }}
                onClick={() => setOpen(false)}
              />

              <motion.div
                layoutId={FILTERS_PANEL_ID}
                role="dialog"
                aria-modal="true"
                aria-label="Filters"
                style={{ borderRadius: FILTERS_RADIUS }}
                transition={{ layout: FILTERS_SPRING }}
                className={cn(
                  "relative z-10 flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden",
                  FILTERS_SURFACE,
                )}
              >
                <div className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-3.5">
                  <motion.span
                    layoutId={FILTERS_LABEL_ID}
                    transition={{ layout: FILTERS_SPRING }}
                    className="inline-block text-base font-semibold"
                  >
                    Filters
                  </motion.span>
                  <motion.button
                    type="button"
                    onClick={() => setOpen(false)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: { delay: 0.16, duration: 0.12 } }}
                    exit={{ opacity: 0, transition: { duration: 0.05 } }}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground -mr-1 rounded-full p-1.5 transition-colors"
                    aria-label="Close"
                  >
                    <XIcon className="size-4" />
                  </motion.button>
                </div>

                <motion.div
                  className="flex min-h-0 flex-1 flex-col"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.16, duration: 0.12 } }}
                  exit={{ opacity: 0, transition: { duration: 0.05 } }}
                >
                  <div className="flex-1 overflow-y-auto px-5">
                    <ExtendedFilters options={options} />
                  </div>

                  <div className="flex shrink-0 gap-2 border-t p-4">
                    <Button
                      variant="outline"
                      className={cn("flex-1", extraCount === 0 && "opacity-40")}
                      disabled={extraCount === 0}
                      onClick={clearExtraFilters}
                    >
                      Clear all
                    </Button>
                    <Button className="flex-1" onClick={() => setOpen(false)}>
                      Done
                    </Button>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
