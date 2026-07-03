"use client";

import * as React from "react";

import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";

/**
 * Shared building blocks for the mobile search/filter drawers (dining, stays,
 * tickets). A labelled section and a full-width single-select pill row — the
 * shape every drawer form repeats.
 */
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

/** Full-width single-select segmented control used in filter/search panels. */
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
