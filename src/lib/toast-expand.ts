"use client";

import * as React from "react";

/**
 * Lets a caller force the global sonner Toaster into its expanded (unfurled)
 * layout for a moment, so a set of related toasts all show at once instead of
 * collapsing into a hover-to-open stack. Used by the achievement level-up
 * celebration (gold level card + green unlock card, both visible together).
 *
 * Ref-counted: overlapping celebrations each hold the expand open until their
 * own release runs, so one ending early can't collapse another mid-flight.
 */
let count = 0;
let expanded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Force-expand the toaster; returns an idempotent release. */
export function pushToastExpand(): () => void {
  count += 1;
  if (count === 1) {
    expanded = true;
    emit();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    if (count === 0) {
      expanded = false;
      emit();
    }
  };
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive read of the force-expand flag for the Toaster. */
export function useToastExpand(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => expanded,
    () => false,
  );
}
