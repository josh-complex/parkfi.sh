"use client";

import * as React from "react";

/** The attraction currently driving the wait chart. */
export type Selection = { id: number; name: string } | null;

const SelectionContext = React.createContext<{
  selected: Selection;
  setSelected: (s: Selection) => void;
} | null>(null);

/**
 * Holds the charted-attraction selection at the dashboard-layout level so the
 * shared map (in `_dash.tsx`), the wait chart, and the board table can all read
 * and drive it across route changes without the map remounting.
 */
export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = React.useState<Selection>(null);
  const value = React.useMemo(() => ({ selected, setSelected }), [selected]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection() {
  const ctx = React.useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used within a SelectionProvider");
  return ctx;
}
