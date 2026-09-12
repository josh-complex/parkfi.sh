import * as React from "react";
import { SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";

import { KIND_LABELS } from "#/components/records/record-card.tsx";
import {
  DEFAULT_WINDOW,
  FILINGS_WINDOWS,
  activeFilterCount,
  type FilingsSearch,
  type FilingsSort,
  type FilingsStatus,
} from "#/components/records/filings-search-params.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { NativeSelect } from "#/components/ui/native-select.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import type { Operator, PublicRecordKind } from "#/lib/records.ts";
import { cn } from "#/lib/utils.ts";

/**
 * The `/filings` filter bar (plan §6.1a). One set of controls rendered two
 * ways: inline (and sticky) from `lg` up, and inside a bottom sheet behind a
 * "Filters (n)" button below that. State lives in the URL — this component
 * only reports patches via `onChange`.
 */

export interface KindCount {
  kind: string;
  n: number;
}
export interface ParkCount {
  id: number;
  name: string;
  n: number;
}

interface Props {
  search: FilingsSearch;
  onChange: (patch: Partial<FilingsSearch>) => void;
  kinds: KindCount[];
  parks: ParkCount[];
  className?: string;
}

const OPERATOR_OPTIONS: Array<{ value: Operator | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "disney", label: "Disney" },
  { value: "universal", label: "Universal" },
];
const STATUS_OPTIONS: Array<{ value: FilingsStatus | "any"; label: string }> = [
  { value: "any", label: "Any status" },
  { value: "open", label: "Open" },
  { value: "issued", label: "Issued" },
  { value: "closed", label: "Closed" },
];
const SORT_OPTIONS: Array<{ value: FilingsSort; label: string }> = [
  { value: "activity", label: "Latest activity" },
  { value: "score", label: "Most notable" },
  { value: "size", label: "Biggest jobs" },
];

function windowLabel(days: number | "all"): string {
  if (days === "all") return "All time";
  if (days === 365) return "1 year";
  return `${days} days`;
}

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
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-card text-foreground hover:bg-accent max-md:border-sidebar-foreground/30",
      )}
    >
      {children}
    </button>
  );
}

/** Search box with a local draft: commits on Enter, blur, or a short pause. */
function SearchBox({ value, onCommit }: { value: string; onCommit: (q: string) => void }) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  React.useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onCommit(draft), 450);
    return () => clearTimeout(t);
  }, [draft, value, onCommit]);
  return (
    <div className="relative">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(draft);
        }}
        onBlur={() => onCommit(draft)}
        placeholder="Search projects, marks, addresses, record numbers…"
        aria-label="Search filings"
        className="pl-9"
      />
    </div>
  );
}

/** The full control set, laid out for a column (sheet) or a row (desktop). */
function FilterControls({ search, onChange, kinds, parks }: Omit<Props, "className">) {
  const days = search.days ?? DEFAULT_WINDOW;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          multiple={false}
          value={[search.op ?? "all"]}
          onValueChange={(v) => {
            const next = (v[0] as Operator | "all" | undefined) ?? "all";
            onChange({ op: next === "all" ? undefined : next });
          }}
          variant="outline"
          size="sm"
          aria-label="Operator"
        >
          {OPERATOR_OPTIONS.map((o) => (
            <ToggleGroupItem key={o.value} value={o.value}>
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          multiple={false}
          value={[String(days)]}
          onValueChange={(v) => {
            const next = v[0] ?? String(DEFAULT_WINDOW);
            onChange({ days: next === "all" ? "all" : Number(next) });
          }}
          variant="outline"
          size="sm"
          aria-label="Window"
        >
          {[...FILINGS_WINDOWS, "all" as const].map((w) => (
            <ToggleGroupItem key={String(w)} value={String(w)}>
              {windowLabel(w)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <NativeSelect
          size="sm"
          value={search.sort ?? "activity"}
          onChange={(e) => {
            const v = e.target.value as FilingsSort;
            onChange({ sort: v === "activity" ? undefined : v });
          }}
          aria-label="Sort"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={!search.kind?.length} onClick={() => onChange({ kind: undefined })}>
          All kinds
        </Chip>
        {kinds.map((k) => {
          const active = search.kind?.includes(k.kind as PublicRecordKind) ?? false;
          return (
            <Chip
              key={k.kind}
              active={active}
              onClick={() => {
                const cur = search.kind ?? [];
                const next = active
                  ? cur.filter((x) => x !== k.kind)
                  : [...cur, k.kind as PublicRecordKind];
                onChange({ kind: next.length ? next : undefined });
              }}
            >
              {KIND_LABELS[k.kind] ?? k.kind}
              <span className="ml-1 opacity-70">{k.n.toLocaleString()}</span>
            </Chip>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          size="sm"
          value={search.park ? String(search.park) : ""}
          onChange={(e) => onChange({ park: e.target.value ? Number(e.target.value) : undefined })}
          aria-label="Park"
        >
          <option value="">All parks</option>
          {parks.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name} ({p.n.toLocaleString()})
            </option>
          ))}
        </NativeSelect>
        <ToggleGroup
          multiple={false}
          value={[search.status ?? "any"]}
          onValueChange={(v) => {
            const next = (v[0] as FilingsStatus | "any" | undefined) ?? "any";
            onChange({ status: next === "any" ? undefined : next });
          }}
          variant="outline"
          size="sm"
          aria-label="Status"
        >
          {STATUS_OPTIONS.map((o) => (
            <ToggleGroupItem key={o.value} value={o.value}>
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={search.routine ?? false}
            onCheckedChange={(v) => onChange({ routine: v ? true : undefined })}
            aria-label="Show routine maintenance permits"
          />
          Show routine
        </label>
      </div>
    </div>
  );
}

/** Removable chips for every non-default filter, shown under the bar at any width. */
function ActiveFilters({
  search,
  onChange,
  parks,
}: {
  search: FilingsSearch;
  onChange: Props["onChange"];
  parks: ParkCount[];
}) {
  const chips: Array<{ key: string; label: string; clear: Partial<FilingsSearch> }> = [];
  if (search.q) chips.push({ key: "q", label: `“${search.q}”`, clear: { q: undefined } });
  if (search.op) {
    chips.push({
      key: "op",
      label:
        search.op === "disney" ? "Disney" : search.op === "universal" ? "Universal" : search.op,
      clear: { op: undefined },
    });
  }
  for (const k of search.kind ?? []) {
    chips.push({
      key: `kind:${k}`,
      label: KIND_LABELS[k] ?? k,
      clear: { kind: (search.kind ?? []).filter((x) => x !== k) },
    });
  }
  if (search.park) {
    const p = parks.find((x) => x.id === search.park);
    chips.push({ key: "park", label: p?.name ?? "Park", clear: { park: undefined } });
  }
  if (search.status)
    chips.push({ key: "status", label: search.status, clear: { status: undefined } });
  if (search.days !== undefined) {
    chips.push({ key: "days", label: windowLabel(search.days), clear: { days: undefined } });
  }
  if (search.sort) {
    chips.push({
      key: "sort",
      label: SORT_OPTIONS.find((o) => o.value === search.sort)?.label ?? search.sort,
      clear: { sort: undefined },
    });
  }
  if (search.routine)
    chips.push({ key: "routine", label: "Routine shown", clear: { routine: undefined } });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onChange(c.clear)}
          className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs hover:bg-accent"
        >
          {c.label}
          <XIcon className="size-3" aria-hidden />
        </button>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange({
            q: undefined,
            op: undefined,
            kind: undefined,
            park: undefined,
            status: undefined,
            days: undefined,
            sort: undefined,
            routine: undefined,
          })
        }
        className="text-xs text-muted-foreground hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}

export function FilingsFilterBar({ search, onChange, kinds, parks, className }: Props) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const count = activeFilterCount(search);
  const commitQ = React.useCallback(
    (q: string) => onChange({ q: q.trim().length >= 2 ? q.trim() : undefined }),
    [onChange],
  );

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchBox value={search.q ?? ""} onCommit={commitQ} />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 lg:hidden"
          onClick={() => setSheetOpen(true)}
        >
          <SlidersHorizontalIcon className="size-4" aria-hidden />
          Filters
          {count > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5">
              {count}
            </Badge>
          )}
        </Button>
      </div>

      <div className="max-lg:hidden">
        <FilterControls search={search} onChange={onChange} kinds={kinds} parks={parks} />
      </div>

      <ActiveFilters search={search} onChange={onChange} parks={parks} />

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Filter filings</SheetTitle>
            <SheetDescription>Narrow by operator, kind, park, status and window.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <FilterControls search={search} onChange={onChange} kinds={kinds} parks={parks} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
