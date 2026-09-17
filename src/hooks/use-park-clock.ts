"use client";

import * as React from "react";

import { useHydrated } from "#/lib/use-hydrated.ts";

/**
 * A place's own clock, to the minute — what a detail page's "Now" band is
 * stamped with.
 *
 * Null until hydration: the time is a reading of the clock, and the server has
 * no business guessing it — a server-rendered "2:14 PM" would be wrong by
 * however long the HTML sat in the edge cache, and it would trip a hydration
 * mismatch on the way.
 */
export function useParkClock(timezone: string | undefined): string | null {
  const hydrated = useHydrated();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!hydrated) return null;
  return new Date(now).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone ?? "America/New_York",
  });
}
