import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

export type SortDir = "asc" | "desc";

export interface SortOption<K extends string> {
  key: K;
  label: string;
  /**
   * Directional options carry an asc/desc arrow and flip when re-tapped.
   * Non-directional options (a grouping like "Park / Resort", or "Recommended")
   * select without a direction and render no arrow.
   */
  directional?: boolean;
  /** Direction applied the first time this option is selected. Defaults to "asc". */
  defaultDir?: SortDir;
  /** Muted helper shown on the active row, e.g. "longest first" / "shortest first". */
  ascHint?: string;
  descHint?: string;
}

/** Flip a direction. */
export function flipDir(dir: SortDir): SortDir {
  return dir === "asc" ? "desc" : "asc";
}

/** The direction a row should display: the live direction when active, else its default. */
export function optionDir<K extends string>(
  opt: SortOption<K>,
  active: boolean,
  activeDir: SortDir,
): SortDir {
  if (active) return activeDir;
  return opt.defaultDir ?? "asc";
}

function DirArrow({ dir, active }: { dir: SortDir; active: boolean }) {
  const Icon = dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "opacity-40")} />;
}

/**
 * The rows inside a Sort drawer: each criterion is one row with a direction
 * arrow. Tapping an inactive row selects it (at its default direction); tapping
 * the active row flips its direction. Shared by every sort surface so the
 * interaction reads identically across Waits, the Ride Board, Eats, and Stays.
 *
 * Rows don't auto-dismiss the drawer — re-tapping to flip needs it to stay open,
 * so the user closes the sheet themselves (swipe / tap-away).
 */
export function SortRows<K extends string>({
  options,
  activeKey,
  activeDir,
  onChange,
}: {
  options: ReadonlyArray<SortOption<K>>;
  activeKey: K;
  activeDir: SortDir;
  onChange: (key: K, dir: SortDir) => void;
}) {
  return (
    <div className="flex flex-col gap-1 px-4 pb-4">
      {options.map((opt) => {
        const active = opt.key === activeKey;
        const dir = optionDir(opt, active, activeDir);
        const hint = active ? (dir === "asc" ? opt.ascHint : opt.descHint) : undefined;
        return (
          <Button
            key={opt.key}
            variant={active ? "secondary" : "ghost"}
            className="w-full justify-between"
            onClick={() => {
              if (!opt.directional) onChange(opt.key, "asc");
              else if (active) onChange(opt.key, flipDir(activeDir));
              else onChange(opt.key, opt.defaultDir ?? "asc");
            }}
          >
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate">{opt.label}</span>
              {hint ? (
                <span className="text-muted-foreground text-xs font-normal">{hint}</span>
              ) : null}
            </span>
            {opt.directional ? <DirArrow dir={dir} active={active} /> : null}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * A standalone asc/desc arrow toggle for the desktop toolbars, where the sort
 * criterion is chosen from a dropdown. Disabled (dimmed) when the active
 * criterion isn't directional.
 */
export function SortDirToggle({
  dir,
  onToggle,
  disabled,
}: {
  dir: SortDir;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="icon-sm"
      className="shrink-0"
      disabled={disabled}
      onClick={onToggle}
      aria-label={dir === "asc" ? "Sort ascending" : "Sort descending"}
    >
      {dir === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
    </Button>
  );
}
