import { Link } from "@tanstack/react-router";
import { CompassIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";

/**
 * The router's `defaultNotFoundComponent`. Until now an unmatched URL fell
 * through to TanStack's built-in "Not Found" string on a blank page, which is
 * the one screen on the site that looked like nobody had ever seen it.
 *
 * It is deliberately self-contained — a 404 can render outside the `_app`
 * shell, where there is no masthead, no nav island and no footer to lean on —
 * so it carries its own field, its own keys and nothing else. Four exits,
 * because a 404 is a wrong turn and the fix is a signpost, not an apology.
 */
export function NotFound() {
  return (
    <div className="flex min-h-[70svh] flex-col items-center justify-center px-4 py-16">
      <div className="surface-wash flex w-full max-w-xl flex-col items-center gap-5 p-8 text-center md:p-10">
        <span className="flex size-14 items-center justify-center rounded-full bg-background/70 text-wash-fg">
          <CompassIcon className="size-7" />
        </span>
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center justify-center gap-2 text-[11px] font-extrabold tracking-[0.14em] text-wash-fg uppercase">
            <span className="size-[7px] rounded-full bg-brand-yellow" />
            404
          </span>
          <h1 className="text-[26px] font-extrabold tracking-[-0.02em] text-balance md:text-[32px]">
            This page is closed for refurbishment
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground md:text-[15px]">
            The link you followed doesn&rsquo;t point anywhere on ParkFi — it may have moved, or the
            page may never have existed. Here&rsquo;s the way back in.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="yellow" render={<Link to="/" />}>
            Live wait times
          </Button>
          <Button variant="outline" render={<Link to="/map" />}>
            Park map
          </Button>
          <Button variant="outline" render={<Link to="/dining" />}>
            Dining
          </Button>
          <Button variant="outline" render={<Link to="/blog" />}>
            News
          </Button>
        </div>
      </div>
    </div>
  );
}
