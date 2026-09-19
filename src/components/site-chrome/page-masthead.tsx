"use client";

import type { ReactNode } from "react";

import { HeroTear } from "#/components/detail/hero-tear.tsx";
import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * The page-level masthead for every route that has no photograph to open on:
 * account, alerts, the pin desks, the legal pages.
 *
 * It is the second half of the detail-page system (docs/plans/dining-redesign).
 * A detail page opens on a photo hero with a ticket over it; a *utility* page
 * has neither a picture nor a subject, so it opens on the same navy field the
 * Waits board uses (`band-masthead`) with the page's own name set in the
 * detail pages' band voice — yellow-dotted kicker, extrabold headline, one line
 * of what the page is for — and tears into the page underneath.
 *
 * Before this, those pages wore a `text-xl font-semibold` heading flush with
 * their content inside a `p-6 max-w-2xl` column. That column was designed for
 * the old sidebar inset; with the sidebar gone (§5) it pinned every settings
 * page to the left edge of a 1440px window.
 *
 * Chrome maths, both ends:
 *
 * - **Phone.** The floating search pill is `position: sticky` over the page, so
 *   the field starts at y=0 and pads its content past the pill
 *   (`--safe-top + --app-header-h`), exactly as a full-bleed hero does.
 * - **Desktop.** The field runs *up* behind the glass nav capsule and the
 *   pinned stripe so the page opens on one continuous navy, and takes the pull
 *   straight back as padding so nothing inside it moves. Both vars are `0px`
 *   off the app shell, which makes the pull a no-op rather than a special case.
 */
export function PageMasthead({
  kicker,
  title,
  description,
  actions,
  children,
  className,
}: {
  /** The band's horizon word — "Your account", "Pins", "The fine print". */
  kicker?: string;
  title: ReactNode;
  /** One line: what this page is for. Two at the very most. */
  description?: ReactNode;
  /** Keys on the right of the headline — yellow for the page's own action,
   *  `variant="ticket"` (white in both themes) for anything beside it. */
  actions?: ReactNode;
  /** Anything that belongs *on* the field: a tab strip, a row of chips. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "band-masthead relative text-white",
        // Phone: no pull. The floating search pill is `sticky`, so it takes flow
        // space at the top of the shell and the band simply starts under it —
        // the same thing the Waits board's navy field does. (A `HERO_BLEED`-style
        // pull-up is wrong here: the mobile header only mounts after hydration
        // — `useIsMobile` is false on the server — so a band that cancelled its
        // height would render its headline above the viewport until then.)
        "pt-5 pb-9",
        // Desktop: up behind the capsule and the stripe, and straight back.
        "md:mt-[calc((var(--floating-nav-height)+var(--site-header-height))*-1)]",
        "md:pt-[calc(var(--floating-nav-height)+var(--site-header-height)+2rem)] md:pb-11",
        className,
      )}
    >
      <div className={cn(PAGE_WIDTH, "flex flex-col gap-5")}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 max-w-2xl">
            {kicker && (
              <span className="inline-flex items-center gap-2 text-[11px] font-extrabold tracking-[0.14em] text-white/80 uppercase">
                <span className="size-[7px] rounded-full bg-brand-yellow" />
                {kicker}
              </span>
            )}
            <h1
              className={cn(
                "text-[26px] font-extrabold tracking-[-0.02em] text-balance md:text-[34px]",
                kicker && "mt-1.5",
              )}
            >
              {title}
            </h1>
            {description && (
              <p className="mt-2 text-sm leading-relaxed text-white/75 md:text-[15px]">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
      {/* Two instances rather than one responsive path, as on the detail hero:
          the bumps are drawn at a real radius per breakpoint, never scaled. */}
      <HeroTear radius={13} step={30} className="md:hidden" />
      <HeroTear radius={14} step={34} className="hidden md:block" />
    </section>
  );
}

/**
 * The content column under a masthead. Same width as the boards and the detail
 * pages (`PAGE_WIDTH`), with `size` capping the readable measure: `"prose"` for
 * the legal pages, `"form"` for a settings stack, `"wide"` for a catalog.
 */
export function PageBody({
  size = "wide",
  className,
  children,
}: {
  size?: "prose" | "form" | "wide";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(PAGE_WIDTH, "py-7 md:py-9")}>
      <div
        className={cn(
          "mx-auto flex w-full flex-col",
          size === "prose" && "max-w-3xl gap-8",
          size === "form" && "max-w-2xl gap-5",
          size === "wide" && "gap-6",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
