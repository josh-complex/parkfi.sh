import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  BellRing,
  CalendarCheck,
  Clock,
  Hotel,
  LineChart,
  MapPin,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Users,
} from "lucide-react";

import { BlogTickerHeader } from "#/components/blog/blog-ticker-header.tsx";
import {
  AchievementLevelPanel,
  AchievementsShowcase,
  DiningShowcase,
  LightningLaneShowcase,
  MapScreenshotShowcase,
  NewsShowcase,
  PinsShowcase,
  PredictionShowcase,
  StayAlertShowcase,
  TicketDuoShowcase,
  WaitBoardShowcase,
} from "#/components/marketing/feature-showcases.tsx";
import { InstallPwaButton } from "#/components/marketing/install-pwa.tsx";
import { AmbientLayer, Drift, Reveal } from "#/components/marketing/marketing-motion.tsx";
import { OmniSearch } from "#/components/omni-search.tsx";
import { Sparkline } from "#/components/park-dashboard/sparkline.tsx";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { Button } from "#/components/ui/button.tsx";
import { usePinsEnabled } from "#/integrations/posthog/feature-flags.ts";
import { cn } from "#/lib/utils.ts";
import { SITE_URL, seo } from "#/lib/seo.ts";

import type { ReactNode } from "react";

export const Route = createFileRoute("/welcome")({
  component: WelcomePage,
  head: () =>
    seo({
      title:
        "ParkFi — Live Wait Times, Dining, Stays & Alerts for Disney World & Universal Orlando",
      description:
        "Plan a better Orlando theme park day with ParkFi: live wait times, Lightning Lane tracking, dining-reservation and resort-rate alerts, ticket-price calendars, a live park map, crowd predictions, achievements, and daily park news. Always free — we never ask for payment.",
      keywords:
        "Disney World wait times, Universal Orlando wait times, theme park app, Lightning Lane tracker, Disney dining alerts, resort rate alerts, ticket price calendar, Disney crowd calendar, Orlando park planner",
      path: "/welcome",
    }),
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FAQ schema — drives an FAQ rich result in Google, which helps a paid landing
 * page double as organic surface area. Keep the answers in sync with the
 * <FaqList> copy below.
 * -------------------------------------------------------------------------- */
const FAQS: ReadonlyArray<{ q: string; a: string; pin?: boolean }> = [
  {
    q: "Is ParkFi free?",
    a: "Yes. ParkFi is completely free to use. We will never require payment of any kind to view wait times, set alerts, track dining and resort availability, or use any feature on the site. We do not sell tickets, reservations, or rooms, and we never ask for a credit card.",
  },
  {
    q: "Is ParkFi affiliated with Disney or Universal?",
    a: "No. ParkFi is an independent, unofficial, fan-made tool. It is not affiliated with, endorsed by, or sponsored by The Walt Disney Company, Universal, Comcast/NBCUniversal, or any of their subsidiaries. All park names and trademarks belong to their respective owners.",
  },
  {
    q: "Which parks does ParkFi cover?",
    a: "Walt Disney World (Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom) and Universal Orlando (Universal Studios Florida, Islands of Adventure, and Epic Universe).",
  },
  {
    q: "How accurate is the data?",
    a: "Wait times, prices, dining availability, and resort rates are aggregated from public sources and refreshed continuously, but they are estimates and may be delayed or out of date. Always confirm in the official park app before making decisions.",
  },
  {
    q: "Do I need an account?",
    a: "You can browse live wait times, the park map, dining, stays, and news without an account. A free account unlocks personalized alerts, and it tracks your achievements and level as you visit the parks.",
  },
  {
    q: "Will ParkFi ever charge me or ask for payment to trade pins?",
    a: "Never. ParkFi will never request payment, deposits, or fees of any kind — including for pin features. If anyone claiming to be ParkFi ever asks you to pay, it is a scam. Report it to us.",
    pin: true,
  },
  {
    q: "Does ParkFi own the pin images, and is it affiliated with PinPics?",
    a: 'No. ParkFi is not affiliated with, endorsed by, or sponsored by PinPics. Pin images, identifiers, and data labeled "PinPics" are the property of PinPics and/or their respective owners and creators. ParkFi claims no ownership of them and displays them for identification and trading-reference purposes only.',
    pin: true,
  },
];

function WelcomePage() {
  const pinsEnabled = usePinsEnabled();
  const faqs = pinsEnabled ? FAQS : FAQS.filter((f) => !f.pin);
  return (
    <div className="bg-background">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "ParkFi",
          applicationCategory: "TravelApplication",
          operatingSystem: "Web",
          url: `${SITE_URL}/welcome`,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }}
      />

      <BlogTickerHeader />

      <Hero />
      <ParksStrip />
      <Features pinsEnabled={pinsEnabled} />
      <HowItWorks />
      <UseCases pinsEnabled={pinsEnabled} />
      <FreePledge />
      <Faq faqs={faqs} />
      <FinalCta />
      <SiteFooter pinsEnabled={pinsEnabled} />
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────────── */

// A faded, drifting duplicate trend line — pure atmosphere, sits behind the
// crisp product card. Deliberately dimmed and blurred via the layer classes.
const HERO_TREND_A = [30, 34, 31, 40, 44, 38, 52, 60, 55, 68, 74, 70, 82, 88];
const HERO_TREND_B = [80, 72, 66, 70, 58, 62, 48, 44, 50, 40, 36, 42, 30, 34];

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      {/* Ambient backdrop: faint dot grid + two drifting, blurred sparklines,
          then the soft brand wash. Everything here is decorative and dimmed. */}
      <AmbientLayer>
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: "radial-gradient(var(--primary) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        <Drift
          className="absolute top-24 -left-16 opacity-10 blur-[1px]"
          x={22}
          y={12}
          duration={24}
        >
          <Sparkline data={HERO_TREND_A} width={440} height={130} />
        </Drift>
        <Drift
          className="absolute -right-10 bottom-0 opacity-[0.08] blur-[2px]"
          y={-16}
          duration={28}
          delay={3}
        >
          <Sparkline data={HERO_TREND_B} width={420} height={120} />
        </Drift>
        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-background to-background" />
      </AmbientLayer>

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
        <div className="flex flex-col items-start gap-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-semibold tracking-wide text-primary uppercase">
            <Sparkles className="size-3.5" aria-hidden />
            Free for every park fan
          </span>

          <h1 className="font-heading text-4xl leading-tight font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Win the day at <span className="text-primary">Disney World</span> &amp;{" "}
            <span className="text-primary">Universal Orlando</span>.
          </h1>

          <p className="max-w-xl text-lg text-muted-foreground">
            ParkFi turns the chaos of an Orlando park day into a clear plan: live wait times,
            Lightning Lane tracking, dining and resort alerts, ticket-price calendars, a live map,
            crowd predictions, and daily park news — all in one place, always free.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button size="lg" className="h-12 px-6 text-base" render={<Link to="/" />}>
              Open the live map
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 px-6 text-base"
              render={<Link to="/blog" />}
            >
              Read today&rsquo;s park news
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            No credit card. No paywall. <span className="font-medium text-foreground">Ever.</span>
          </p>
        </div>

        {/* Crisp, real product: the live wait board. Only the backdrop above
            is faded — the board itself stays sharp. */}
        <div className="flex justify-center lg:justify-end">
          <WaitBoardShowcase />
        </div>
      </div>
    </section>
  );
}

/* ── Parks strip ──────────────────────────────────────────────────────────── */

const PARKS = [
  "Magic Kingdom",
  "EPCOT",
  "Hollywood Studios",
  "Animal Kingdom",
  "Universal Studios",
  "Islands of Adventure",
  "Epic Universe",
] as const;

function ParksStrip() {
  return (
    <section className="border-b border-border bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <p className="text-center text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Real-time coverage across every major Orlando park
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          {PARKS.map((p) => (
            <span key={p} className="font-heading text-sm font-semibold text-foreground/70">
              {p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Features ─────────────────────────────────────────────────────────────── *
 * A module *system*, not one repeated row. Three shapes carry different jobs:
 *   • Spotlight — a full-bleed panel with ambient motion behind a crisp product
 *     component; reserved for the flagship surfaces (live map, achievements).
 *   • Split — text beside a product component. Sides alternate on purpose, and
 *     the ordering is set at *every* breakpoint (some modules lead with the
 *     visual on mobile) so the phone view actually varies instead of stacking
 *     text-image-text-image the whole way down.
 *   • Duo — two related panels side by side, for a compare/analysis moment.
 * -------------------------------------------------------------------------- */

interface FeatureDef {
  eyebrow: string;
  title: string;
  body: ReactNode;
  showcase: ReactNode;
  cta?: ReactNode;
  /** Rendered between the eyebrow and the title (e.g. the profile level chip). */
  badge?: ReactNode;
}

function FeatureCopy({ feature, onDark }: { feature: FeatureDef; onDark?: boolean }) {
  return (
    <div className="flex flex-col items-start">
      <p
        className={cn(
          "text-xs font-semibold tracking-widest uppercase",
          onDark ? "text-sky-300" : "text-primary",
        )}
      >
        {feature.eyebrow}
      </p>
      {feature.badge && <div className="mt-4">{feature.badge}</div>}
      <h3
        className={cn(
          "mt-4 font-heading text-2xl font-bold tracking-tight text-balance sm:text-3xl",
          onDark && "text-white",
        )}
      >
        {feature.title}
      </h3>
      <p className={cn("mt-3 max-w-lg", onDark ? "text-white/75" : "text-muted-foreground")}>
        {feature.body}
      </p>
      {feature.cta}
    </div>
  );
}

function SplitModule({
  feature,
  align,
  mobileShowcaseFirst,
}: {
  feature: FeatureDef;
  /** Which side the product component sits on at the `lg` breakpoint. */
  align: "left" | "right";
  /** Lead with the visual on mobile (breaks the text-first stack rhythm). */
  mobileShowcaseFirst?: boolean;
}) {
  const showcaseRight = align === "right";
  const textOrder = cn(
    mobileShowcaseFirst ? "order-2" : "order-1",
    showcaseRight ? "lg:order-1" : "lg:order-2",
  );
  const showcaseOrder = cn(
    mobileShowcaseFirst ? "order-1" : "order-2",
    showcaseRight ? "lg:order-2" : "lg:order-1",
  );

  return (
    <Reveal as="section" className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
        <div className={textOrder}>
          <FeatureCopy feature={feature} />
        </div>
        <div className={cn("flex justify-center", showcaseOrder)}>{feature.showcase}</div>
      </div>
    </Reveal>
  );
}

/**
 * Full-bleed dark band. `isolate` makes it its own stacking context so the
 * `-z-20` background gradient and the `-z-10` ambient layer stack correctly
 * beneath the crisp `z-10` content instead of slipping behind the page.
 */
function SpotlightModule({
  feature,
  showcaseSide,
  ambient,
}: {
  feature: FeatureDef;
  showcaseSide: "left" | "right";
  ambient: ReactNode;
}) {
  const showcaseRight = showcaseSide === "right";
  return (
    <Reveal
      as="section"
      className="relative isolate overflow-hidden py-16 text-white sm:py-20 lg:py-24"
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-20"
        style={{ background: "linear-gradient(155deg,#0c1a35,#14346b)" }}
      />
      {ambient}
      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-14">
        <div className={showcaseRight ? "lg:order-1" : "lg:order-2"}>
          <FeatureCopy feature={feature} onDark />
        </div>
        <div className={cn("flex justify-center", showcaseRight ? "lg:order-2" : "lg:order-1")}>
          {feature.showcase}
        </div>
      </div>
    </Reveal>
  );
}

function DuoModule({ feature }: { feature: FeatureDef }) {
  return (
    <Reveal as="section" className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold tracking-widest text-primary uppercase">
          {feature.eyebrow}
        </p>
        <h3 className="mt-3 font-heading text-2xl font-bold tracking-tight text-balance sm:text-3xl">
          {feature.title}
        </h3>
        <p className="mt-3 text-muted-foreground">{feature.body}</p>
      </div>
      <div className="mx-auto mt-8 max-w-3xl">{feature.showcase}</div>
    </Reveal>
  );
}

/* Ambient backdrops for the two spotlight modules — soft radial glows only, no
   decorative shapes; the crisp product component renders above at z-10. */
const MapAmbient = (
  <AmbientLayer>
    <div
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(circle at 72% 30%, color-mix(in oklch, var(--primary), transparent 80%), transparent 60%)",
      }}
    />
  </AmbientLayer>
);

const AchievementsAmbient = (
  <AmbientLayer>
    <div
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(circle at 80% 45%, rgba(234,179,8,0.14), transparent 55%), radial-gradient(circle at 18% 22%, rgba(91,143,232,0.22), transparent 60%)",
      }}
    />
  </AmbientLayer>
);

function Features({ pinsEnabled }: { pinsEnabled: boolean }) {
  return (
    <section id="features" className="py-20 sm:py-24">
      <Reveal className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Everything in one place"
          title="One app for the entire park day"
          subtitle="From planning the trip to deciding which line to join, every screen below is the real ParkFi — not a mockup."
        />
        {/* Renders only when the PWA is installable (Chrome/Android, not already
            installed); otherwise it's a no-op. The margin rides on the button so
            there's no empty gap when it's hidden. Centered under the heading. */}
        <div className="text-center">
          <InstallPwaButton className="mt-8 px-6" />
        </div>
      </Reveal>

      <div className="mt-14 flex flex-col gap-20 sm:gap-28">
        <SpotlightModule
          showcaseSide="right"
          ambient={MapAmbient}
          feature={{
            eyebrow: "Live interactive map",
            title: "See every wait, right where you're standing",
            body: "A real-time map of all seven parks with standby waits, ride status, and dining pinned in place. Tap a pin, read the trend, and decide your next move without ever leaving the map.",
            showcase: <MapScreenshotShowcase className="max-w-md" />,
            // Outline-on-dark: the spotlight sets `text-white`, so a default
            // outline button would render white text on its white pill. Force a
            // transparent fill + white border/text (same pattern as FinalCta).
            cta: (
              <Button
                variant="outline"
                className="mt-6 h-11 border-white/30 bg-transparent px-5 text-white hover:bg-white/10 hover:text-white"
                render={<Link to="/" />}
              >
                Open the live map
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ),
          }}
        />

        <SplitModule
          align="right"
          feature={{
            eyebrow: "Lightning Lane tracking",
            title: "Grab the return time before it's gone",
            body: "Follow Lightning Lane price and availability through the day. ParkFi shows which windows are still open and the smart moment to buy — no refreshing the official app every ten minutes.",
            showcase: <LightningLaneShowcase />,
          }}
        />

        <SplitModule
          align="left"
          mobileShowcaseFirst
          feature={{
            eyebrow: "Dining reservations",
            title: "Hunt hard-to-get tables — and browse the whole resort",
            body: "Scan availability across 300+ restaurants, watch a full week at a glance, and get pinged the second a slot opens. New: browse every venue at a resort in one shelf — signature dining to snack carts — with live menus and price history.",
            showcase: <DiningShowcase className="max-w-md" />,
            cta: (
              <Button variant="outline" className="mt-6 h-11 px-5" render={<Link to="/dining" />}>
                Explore dining
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ),
          }}
        />

        <DuoModule
          feature={{
            eyebrow: "Ticket-price calendar",
            title: "Find the cheapest day before you buy",
            body: "Ticket prices swing by date. ParkFi color-codes the whole month so you can spot the low days at a glance — and see exactly what peak pricing would have cost you.",
            showcase: <TicketDuoShowcase />,
          }}
        />

        <SplitModule
          align="right"
          feature={{
            eyebrow: "Resort & stay alerts",
            title: "Rebook the moment a rate drops",
            body: "Watch nightly rates and sold-out rooms for any on-property resort. Set a ceiling and we'll email you the moment a room opens or the price falls into range — even on trips you've already booked.",
            showcase: <StayAlertShowcase />,
            cta: (
              <Button variant="outline" className="mt-6 h-11 px-5" render={<Link to="/stays" />}>
                Browse stays
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ),
          }}
        />

        <SpotlightModule
          showcaseSide="right"
          ambient={AchievementsAmbient}
          feature={{
            eyebrow: "New · Levels & achievements",
            badge: <AchievementLevelPanel />,
            title: "Every park day earns you something",
            body: "ParkFi quietly tracks your park days, rides, steps, rope drops and more — then turns them into 77 achievements across 22 families and 20 levels. Level up in a park and the badge shows up right on your profile.",
            showcase: <AchievementsShowcase />,
          }}
        />

        <SplitModule
          align="left"
          feature={{
            eyebrow: "New · Crowd predictions",
            title: "Know how busy it'll be before you go",
            body: "ParkFi forecasts crowd levels for the week ahead so you can pick the quietest day and plan around the surge. Green means go.",
            showcase: <PredictionShowcase />,
          }}
        />

        <SplitModule
          align="right"
          feature={{
            eyebrow: "Daily park news",
            title: "What changed overnight, in plain English",
            body: "Ride updates, closures, and crowd shifts — summarized every day with what it actually means for your trip. No forums to dig through.",
            showcase: <NewsShowcase />,
            cta: (
              <Button variant="outline" className="mt-6 h-11 px-5" render={<Link to="/blog" />}>
                Read today&rsquo;s news
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ),
          }}
        />

        {pinsEnabled && (
          <SplitModule
            align="left"
            mobileShowcaseFirst
            feature={{
              eyebrow: "Pin trading & collection",
              title: "Catalog, track, and trade — no fees, ever",
              body: "Scan a pin to identify it, track your collection, and line up trades with other fans. ParkFi never charges to collect or trade a pin.",
              showcase: <PinsShowcase />,
              cta: (
                <Button variant="outline" className="mt-6 h-11 px-5" render={<Link to="/pins" />}>
                  Open the Pin Hub
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              ),
            }}
          />
        )}
      </div>
    </section>
  );
}

/* ── How it works ─────────────────────────────────────────────────────────── */

const STEPS = [
  {
    icon: MapPin,
    title: "Pick your park",
    body: "Open ParkFi and choose where you're headed. Everything is live the moment you land — no setup, no sign-in required to look.",
  },
  {
    icon: TimerReset,
    title: "See what matters now",
    body: "Wait times, Lightning Lane, dining openings, and rates are all on one screen, updated continuously throughout the day.",
  },
  {
    icon: BellRing,
    title: "Let alerts do the work",
    body: "Create a free account, set the alerts you care about, and go enjoy the parks. We'll tap you on the shoulder when it's time to act.",
  },
] as const;

function HowItWorks() {
  return (
    <section id="how-it-works" className="border-y border-border bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <Reveal>
          <SectionHeading
            eyebrow="How it works"
            title="Up and running in seconds"
            subtitle="No download required. ParkFi runs in your browser and installs to your home screen if you want it there."
          />
        </Reveal>
        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <Reveal key={s.title} delay={i * 0.08}>
                <div className="relative rounded-3xl border border-border bg-card p-7 shadow-sm">
                  <span className="font-heading absolute -top-3 left-7 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
                    Step {i + 1}
                  </span>
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <h3 className="mt-4 font-heading text-lg font-bold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── Use cases / personas ─────────────────────────────────────────────────── */

const PERSONAS = [
  {
    icon: Users,
    title: "First-time families",
    body: "Skip the guesswork. Know which rides have short lines, when to eat, and how to avoid the worst of the crowds — without a guidebook.",
  },
  {
    icon: LineChart,
    title: "Budget planners",
    body: "Compare ticket prices by date and watch resort rates so you book your trip on the cheapest days and never overpay.",
  },
  {
    icon: Clock,
    title: "Commando day-trippers",
    body: "Maximize a single day. Live waits and Lightning Lane tracking help you rope-drop, pivot, and hit every headliner.",
  },
  {
    icon: CalendarCheck,
    title: "Foodies & date nights",
    body: "Chasing Cinderella's table or a tough Universal reservation? Let the scanner watch for openings so you don't have to.",
  },
  {
    icon: Hotel,
    title: "Resort guests",
    body: "Already booked? Watch for rate drops on your dates and rebook to save — plus track waits before you even leave your room.",
  },
  {
    icon: Sparkles,
    title: "Pin traders & collectors",
    body: "Catalog, track, and trade your pins with a community of fans. No fees, no listings to buy — just trading, the way it should be.",
    pin: true,
  },
] as const;

function UseCases({ pinsEnabled }: { pinsEnabled: boolean }) {
  const personas = pinsEnabled ? PERSONAS : PERSONAS.filter((p) => !("pin" in p));
  return (
    <section id="use-cases" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <Reveal>
        <SectionHeading
          eyebrow="Who it's for"
          title="Built for every kind of park person"
          subtitle="However you do the parks, ParkFi meets you there."
        />
      </Reveal>
      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {personas.map((p, i) => {
          const Icon = p.icon;
          return (
            <Reveal key={p.title} delay={(i % 3) * 0.08}>
              <div className="h-full rounded-3xl border border-border bg-card p-7">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden />
                </div>
                <h3 className="mt-4 font-heading text-lg font-bold">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

/* ── "Always free" pledge ─────────────────────────────────────────────────── */

function FreePledge() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
      <Reveal>
        <div className="overflow-hidden rounded-4xl border border-primary/30 bg-primary/5">
          <div className="grid items-center gap-8 p-8 sm:p-12 lg:grid-cols-[auto_1fr]">
            <div className="flex size-16 items-center justify-center rounded-3xl bg-primary/15 text-primary">
              <ShieldCheck className="size-8" aria-hidden />
            </div>
            <div>
              <h2 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
                ParkFi is free — and we will never ask you for payment.
              </h2>
              <p className="mt-3 max-w-3xl text-muted-foreground">
                Every feature on ParkFi — wait times, alerts, dining and resort tracking, the map,
                the news, and all pin-trading and collection features — is free to use. We do not
                sell tickets, reservations, or rooms, and we will{" "}
                <strong className="text-foreground">never require payment of any kind</strong>, ask
                for a deposit, or request your card details to trade pins or use the app.
              </p>
              <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
                <strong className="text-foreground">Safety note:</strong> if anyone claiming to
                represent ParkFi ever asks you to pay a fee — to join, to trade a pin, to unlock a
                feature, or to &ldquo;verify&rdquo; your account — it is not us, and it is a scam.
                Please don&rsquo;t pay, and let us know.
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────────────── */

function Faq({ faqs }: { faqs: ReadonlyArray<{ q: string; a: string }> }) {
  return (
    <section id="faq" className="border-y border-border bg-muted/30">
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />
        <div className="mt-12 divide-y divide-border">
          {faqs.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-left font-heading text-lg font-semibold marker:content-['']">
                {f.q}
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <p className="mt-3 text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Final CTA ────────────────────────────────────────────────────────────── */

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="relative overflow-hidden rounded-4xl bg-sidebar px-6 py-16 text-center text-sidebar-foreground sm:px-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-0 opacity-30 [background:radial-gradient(circle_at_30%_20%,white,transparent_55%)]"
        />
        <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center gap-6">
          <h2 className="font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Your best park day starts here.
          </h2>
          <p className="text-sidebar-foreground/80">
            Live data, smart alerts, and zero cost. Jump in — no account needed to start exploring.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              variant="secondary"
              className="h-12 px-6 text-base"
              render={<Link to="/" />}
            >
              Open ParkFi
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 border-white/30 bg-transparent px-6 text-base text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground"
              render={<Link to="/blog" />}
            >
              Browse park news
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Site footer (quicklinks + search) over the legal disclaimer block ──────── */

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

function SiteFooter({ pinsEnabled }: { pinsEnabled: boolean }) {
  return (
    <footer className="border-t border-border bg-muted/30">
      {/* ── Quicklinks + search ────────────────────────────────────────────── */}
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div
          className={cn(
            "grid gap-12",
            // One fewer column track when the Pins column is hidden, so the
            // `lg:contents` columns still fill the row evenly.
            pinsEnabled
              ? "lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]"
              : "lg:grid-cols-[1.4fr_1fr_1fr_1fr]",
          )}
        >
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

          <div className="grid grid-cols-2 gap-8 sm:gap-12 lg:contents">
            <FooterColumn title="Explore">
              <li>
                <Link to="/" className={footerLinkClass}>
                  Live Map
                </Link>
              </li>
              <li>
                <Link to="/blog" className={footerLinkClass}>
                  Park News
                </Link>
              </li>
              <li>
                <Link to="/dining" className={footerLinkClass}>
                  Dining
                </Link>
              </li>
              <li>
                <Link to="/stays" className={footerLinkClass}>
                  Stays
                </Link>
              </li>
              <li>
                <Link to="/tickets" className={footerLinkClass}>
                  Tickets
                </Link>
              </li>
              <li>
                <Link to="/predictions" className={footerLinkClass}>
                  Crowd Predictions
                </Link>
              </li>
            </FooterColumn>

            {pinsEnabled && (
              <FooterColumn title="Pins">
                <li>
                  <Link to="/pins" className={footerLinkClass}>
                    Pin Hub
                  </Link>
                </li>
                <li>
                  <Link to="/pins/collection" className={footerLinkClass}>
                    My Collection
                  </Link>
                </li>
                <li>
                  <Link to="/pins/trades" className={footerLinkClass}>
                    Trades
                  </Link>
                </li>
                <li>
                  <Link to="/pins/scan" className={footerLinkClass}>
                    Scan a Pin
                  </Link>
                </li>
              </FooterColumn>
            )}

            <FooterColumn title="On this page">
              <li>
                <a href="#features" className={footerLinkClass}>
                  Features
                </a>
              </li>
              <li>
                <a href="#how-it-works" className={footerLinkClass}>
                  How it works
                </a>
              </li>
              <li>
                <a href="#use-cases" className={footerLinkClass}>
                  Who it&rsquo;s for
                </a>
              </li>
              <li>
                <a href="#faq" className={footerLinkClass}>
                  FAQ
                </a>
              </li>
            </FooterColumn>

            <FooterColumn title="Company">
              <li>
                <Link to="/stays/alerts" className={footerLinkClass}>
                  Stay Alerts
                </Link>
              </li>
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
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-4 text-xs leading-relaxed text-muted-foreground">
            <p>
              <strong className="text-foreground">
                ParkFi is an independent, unofficial, fan-made tool.
              </strong>{" "}
              It is not affiliated with, endorsed by, sponsored by, or in any way officially
              connected to The Walt Disney Company, Disney Parks, Experiences and Products,
              Universal City Studios LLC, Universal Parks &amp; Resorts, Comcast Corporation,
              NBCUniversal, or any of their respective subsidiaries, affiliates, or licensors.
            </p>
            <p>
              All park names, attraction names, resort names, logos, and other intellectual property
              — including Walt Disney World&reg;, EPCOT&reg;, Magic Kingdom&reg;, Hollywood
              Studios&reg;, Animal Kingdom&reg;, Universal Studios Florida&reg;, Universal&rsquo;s
              Islands of Adventure&reg;, and Universal Epic Universe&reg; — are the property of
              their respective owners and are referenced here solely for identification (nominative
              fair use).
            </p>
            <p>
              Wait times, prices, dining availability, and resort rates are estimates aggregated
              from public sources, may be delayed or inaccurate, and should not be relied upon for
              time-sensitive or financial decisions. Always confirm in the official park app before
              you act. ParkFi sells nothing and processes no payments.
            </p>
            <p>
              <strong className="text-foreground">PinPics &amp; pin trading:</strong> ParkFi is{" "}
              <strong className="text-foreground">
                not affiliated with, endorsed by, or sponsored by PinPics
              </strong>
              . Pin images, identifiers, and data labeled &ldquo;PinPics&rdquo; are the property of
              PinPics and/or their respective owners and creators —{" "}
              <strong className="text-foreground">ParkFi does not own any of them</strong> and
              displays them solely for identification and trading reference. ParkFi&rsquo;s pin
              features are free; we will never require payment of any kind to collect or trade pins,
              and anyone asking you to pay a fee is not affiliated with ParkFi.
            </p>
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

/* ── Shared bits ──────────────────────────────────────────────────────────── */

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold tracking-widest text-primary uppercase">{eyebrow}</p>
      <h2 className="mt-3 font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      {subtitle && <p className="mt-4 text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
