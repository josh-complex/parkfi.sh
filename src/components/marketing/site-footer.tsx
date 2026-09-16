"use client";

import { Link } from "@tanstack/react-router";

import { OmniSearch } from "#/components/omni-search.tsx";
import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { cn } from "#/lib/utils.ts";

import type { ReactNode } from "react";

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="font-heading text-xs font-bold tracking-widest text-foreground uppercase">
        {title}
      </h3>
      <ul className="mt-4 space-y-2.5 text-sm">{children}</ul>
    </div>
  );
}

const footerLinkClass =
  "text-muted-foreground transition-colors hover:text-primary hover:underline underline-offset-4";

/** Our own pages. One column, in the order a trip actually gets planned. */
const EXPLORE: ReadonlyArray<{ label: string; to: string }> = [
  { label: "Queue Times", to: "/" },
  { label: "Live Map", to: "/map" },
  { label: "Dining", to: "/dining" },
  { label: "Stays", to: "/stays" },
  { label: "Tickets", to: "/tickets" },
  { label: "Crowd Forecast", to: "/predictions" },
  { label: "Stay Alerts", to: "/stays/alerts" },
  { label: "Park News", to: "/blog" },
];

/**
 * Outbound columns. ParkFi aggregates public data and says so everywhere, so
 * the footer points at the operators' own sites for anything bookable and at
 * the fan press for the reporting we don't do. Nothing here is an affiliation —
 * the legal block below says as much — and none of these links are sponsored.
 */
const OFFICIAL: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Walt Disney World", href: "https://disneyworld.disney.go.com" },
  { label: "Universal Orlando", href: "https://www.universalorlando.com" },
  { label: "Disney Springs", href: "https://www.disneysprings.com" },
  { label: "Disney Parks Blog", href: "https://disneyparksblog.com" },
];

const FAN_SITES: ReadonlyArray<{ label: string; href: string }> = [
  { label: "WDWNT", href: "https://wdwnt.com" },
  { label: "Blog Mickey", href: "https://blogmickey.com" },
  { label: "Attractions Magazine", href: "https://attractionsmagazine.com" },
  { label: "Orlando Informer", href: "https://orlandoinformer.com" },
  { label: "Theme Park Insider", href: "https://themeparkinsider.com" },
];

function ExternalLinks({ items }: { items: ReadonlyArray<{ label: string; href: string }> }) {
  return (
    <>
      {items.map((item) => (
        <li key={item.href}>
          <a href={item.href} target="_blank" rel="noopener noreferrer" className={footerLinkClass}>
            {item.label}
          </a>
        </li>
      ))}
    </>
  );
}

/**
 * The site's footer, in two lengths. `full` is the landing page's — every link
 * column plus the four-paragraph legal block. `short` is what an app page
 * carries under the masthead: the same columns, one line of the disclaimer over
 * the legal links.
 *
 * One component on purpose: the columns are the same links in both places, and
 * a second copy of them would drift. Four link columns, always — two of ours
 * and two outbound (2026-09-15) — sized to `PAGE_WIDTH` so the columns line up
 * with the boards and detail pages above them.
 */
export function SiteFooter({ variant = "full" }: { variant?: "full" | "short" }) {
  const short = variant === "short";
  return (
    <footer className="border-t border-border bg-muted/30">
      {/* ── Quicklinks + search ────────────────────────────────────────────── */}
      <div className={cn(PAGE_WIDTH, short ? "py-10" : "py-16")}>
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          {/* Brand + search */}
          <div className="flex flex-col gap-5">
            <Link to="/" aria-label="ParkFi home" className="flex items-center">
              <img src="/img/brand/blue.webp" alt="ParkFi" className="h-9 w-auto" />
            </Link>
            <p className="max-w-xs text-sm text-muted-foreground">
              Live wait times, dining &amp; resort alerts, ticket prices, a live map, and daily park
              news for Walt Disney World and Universal Orlando. Always free.
            </p>
            <div className="w-full max-w-xs">
              <OmniSearch />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 sm:gap-12 lg:contents">
            <FooterColumn title="Explore">
              {EXPLORE.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className={footerLinkClass}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </FooterColumn>

            <FooterColumn title="Official">
              <ExternalLinks items={OFFICIAL} />
            </FooterColumn>

            <FooterColumn title="Fan Sites">
              <ExternalLinks items={FAN_SITES} />
            </FooterColumn>

            <FooterColumn title="Company">
              <li>
                <Link to="/disclaimers" className={footerLinkClass}>
                  Disclaimers
                </Link>
              </li>
              <li>
                <Link to="/privacy" className={footerLinkClass}>
                  Privacy
                </Link>
              </li>
              <li>
                <a href="mailto:hello@parkfi.sh" className={footerLinkClass}>
                  Contact
                </a>
              </li>
            </FooterColumn>
          </div>
        </div>
      </div>

      {/* ── Legal / disclaimers ────────────────────────────────────────────── */}
      <div className="border-t border-border">
        <div className={cn(PAGE_WIDTH, short ? "py-6" : "py-10")}>
          <div className="flex flex-col gap-4 text-xs leading-relaxed text-muted-foreground">
            {!short && (
              <p>
                <strong className="text-foreground">
                  ParkFi is an independent, unofficial, fan-made tool.
                </strong>{" "}
                It is not affiliated with, endorsed by, sponsored by, or in any way officially
                connected to The Walt Disney Company, Disney Parks, Experiences and Products,
                Universal City Studios LLC, Universal Parks &amp; Resorts, Comcast Corporation,
                NBCUniversal, or any of their respective subsidiaries, affiliates, or licensors.
              </p>
            )}
            {!short && (
              <p>
                All park names, attraction names, resort names, logos, and other intellectual
                property — including Walt Disney World&reg;, EPCOT&reg;, Magic Kingdom&reg;,
                Hollywood Studios&reg;, Animal Kingdom&reg;, Universal Studios Florida&reg;,
                Universal&rsquo;s Islands of Adventure&reg;, and Universal Epic Universe&reg; — are
                the property of their respective owners and are referenced here solely for
                identification (nominative fair use).
              </p>
            )}
            <p>
              Wait times, prices, dining availability, and resort rates are estimates aggregated
              from public sources, may be delayed or inaccurate, and should not be relied upon for
              time-sensitive or financial decisions. Always confirm in the official park app before
              you act. ParkFi sells nothing and processes no payments.
            </p>
            {!short && (
              <p>
                <strong className="text-foreground">PinPics &amp; pin trading:</strong> ParkFi is{" "}
                <strong className="text-foreground">
                  not affiliated with, endorsed by, or sponsored by PinPics
                </strong>
                . Pin images, identifiers, and data labeled &ldquo;PinPics&rdquo; are the property
                of PinPics and/or their respective owners and creators —{" "}
                <strong className="text-foreground">ParkFi does not own any of them</strong> and
                displays them solely for identification and trading reference. ParkFi&rsquo;s pin
                features are free; we will never require payment of any kind to collect or trade
                pins, and anyone asking you to pay a fee is not affiliated with ParkFi.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
              <Link to="/disclaimers" className="font-medium text-foreground hover:text-primary">
                Full disclaimers &amp; legal notice
              </Link>
              <Link to="/privacy" className="font-medium text-foreground hover:text-primary">
                Privacy
              </Link>
              <span>&copy; {new Date().getFullYear()} ParkFi</span>
              {/* Required attribution for the free animated status icons (toasts). */}
              <a
                href="https://lordicon.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
              >
                Icons by Lordicon.com
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
