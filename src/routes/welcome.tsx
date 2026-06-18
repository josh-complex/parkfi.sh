import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  BellRing,
  CalendarCheck,
  Clock,
  Hotel,
  LineChart,
  MapPin,
  Newspaper,
  ShieldCheck,
  Sparkles,
  Ticket,
  TimerReset,
  Users,
  Zap,
} from "lucide-react";

import { BlogTickerHeader } from "#/components/blog/blog-ticker-header.tsx";
import { OmniSearch } from "#/components/omni-search.tsx";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { Button } from "#/components/ui/button.tsx";
import { SITE_URL, seo } from "#/lib/seo.ts";

import type { ReactNode } from "react";

export const Route = createFileRoute("/welcome")({
  component: WelcomePage,
  head: () =>
    seo({
      title:
        "ParkFi — Live Wait Times, Dining, Stays & Alerts for Disney World & Universal Orlando",
      description:
        "Plan a better Orlando theme park day with ParkFi: live wait times, Lightning Lane tracking, dining-reservation and resort-rate alerts, ticket-price calendars, a live park map, and daily park news. Always free — we never ask for payment.",
      keywords:
        "Disney World wait times, Universal Orlando wait times, theme park app, Lightning Lane tracker, Disney dining alerts, resort rate alerts, ticket price calendar, Orlando park planner",
      path: "/welcome",
    }),
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FAQ schema — drives an FAQ rich result in Google, which helps a paid landing
 * page double as organic surface area. Keep the answers in sync with the
 * <FaqList> copy below.
 * -------------------------------------------------------------------------- */
const FAQS: ReadonlyArray<{ q: string; a: string }> = [
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
    a: "You can browse live wait times, the park map, dining, stays, and news without an account. A free account unlocks personalized alerts so we can notify you when a wait drops, a reservation opens, or a resort rate changes.",
  },
  {
    q: "Will ParkFi ever charge me or ask for payment to trade pins?",
    a: "Never. ParkFi will never request payment, deposits, or fees of any kind — including for pin features. If anyone claiming to be ParkFi ever asks you to pay, it is a scam. Report it to us.",
  },
  {
    q: "Does ParkFi own the pin images, and is it affiliated with PinPics?",
    a: 'No. ParkFi is not affiliated with, endorsed by, or sponsored by PinPics. Pin images, identifiers, and data labeled "PinPics" are the property of PinPics and/or their respective owners and creators. ParkFi claims no ownership of them and displays them for identification and trading-reference purposes only.',
  },
];

function WelcomePage() {
  return (
    <div className="bg-background">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((f) => ({
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
      <Features />
      <HowItWorks />
      <UseCases />
      <FreePledge />
      <Faq />
      <FinalCta />
      <SiteFooter />
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      {/* Soft brand wash behind the hero. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-primary/10 via-background to-background"
      />
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
            and daily park news — all in one place, always free.
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

        {/* IMAGE: hero product shot */}
        <ImagePlaceholder
          id="hero-dashboard"
          aspect="4 / 3"
          label="Hero — ParkFi live dashboard"
          note="App screenshot: live map + wait-time panel"
        />
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

/* ── Features ─────────────────────────────────────────────────────────────── */

const FEATURES = [
  {
    icon: Clock,
    title: "Live wait times",
    body: "Standby waits across every park, refreshed continuously — with trend arrows so you can see what's climbing and what's dropping right now.",
    img: {
      id: "feature-waits",
      label: "Live wait-times board",
      note: "Ride list with up/down trend chips",
    },
  },
  {
    icon: Zap,
    title: "Lightning Lane tracking",
    body: "Follow Lightning Lane and paid-line availability through the day so you know the smart moment to grab a return time.",
    img: {
      id: "feature-ll",
      label: "Lightning Lane tracker",
      note: "Availability timeline for a headliner ride",
    },
  },
  {
    icon: CalendarCheck,
    title: "Dining reservation finder",
    body: "Hunting a hard-to-get table? Scan availability across restaurants and get alerted the moment a slot opens up.",
    img: {
      id: "feature-dining",
      label: "Dining finder",
      note: "Restaurant grid with open reservation slots",
    },
  },
  {
    icon: Hotel,
    title: "Resort & stay alerts",
    body: "Watch nightly rates and availability for on-property resorts and get a ping when a price drops into your range.",
    img: {
      id: "feature-stays",
      label: "Resort rate board",
      note: "Resort cards with nightly-rate sparklines",
    },
  },
  {
    icon: Ticket,
    title: "Ticket-price calendar",
    body: "See how ticket prices move by date so you can pick the cheapest day to visit before you ever buy.",
    img: {
      id: "feature-tickets",
      label: "Ticket-price calendar",
      note: "Month grid color-coded by price",
    },
  },
  {
    icon: BellRing,
    title: "Personalized alerts",
    body: "Set it and forget it. Tell ParkFi what you care about — a wait threshold, a reservation, a rate — and we'll notify you.",
    img: {
      id: "feature-alerts",
      label: "Alerts setup",
      note: "Alert rule builder + notification toast",
    },
  },
  {
    icon: MapPin,
    title: "Live interactive map",
    body: "A real-time map of every park with wait times, ride status, and dining overlaid right where you're standing.",
    img: { id: "feature-map", label: "Live park map", note: "Map with ride pins and wait badges" },
  },
  {
    icon: Newspaper,
    title: "Daily park news",
    body: "Plain-English daily analysis of ride updates, closures, and crowd impacts — what's changing and what it means for your trip.",
    img: {
      id: "feature-news",
      label: "Park news feed",
      note: "Blog article cards with hero images",
    },
  },
  {
    icon: Sparkles,
    title: "Pin trading & collection",
    body: "Catalog your pins, track your collection, scan new finds, and line up trades with other fans — no fees, no catch.",
    img: {
      id: "feature-pins",
      label: "Pin collection",
      note: "Grid of trading pins with trade badges",
    },
  },
] as const;

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <SectionHeading
        eyebrow="Everything in one place"
        title="One app for the entire park day"
        subtitle="From the moment you're planning the trip to the second you're deciding which line to join, ParkFi has the data you need."
      />

      <div className="mt-14 grid gap-12">
        {FEATURES.map((f, i) => (
          <FeatureRow key={f.title} feature={f} flip={i % 2 === 1} />
        ))}
      </div>
    </section>
  );
}

function FeatureRow({ feature, flip }: { feature: (typeof FEATURES)[number]; flip: boolean }) {
  const Icon = feature.icon;
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2">
      <div className={flip ? "lg:order-2" : undefined}>
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-6" aria-hidden />
        </div>
        <h3 className="mt-5 font-heading text-2xl font-bold tracking-tight">{feature.title}</h3>
        <p className="mt-3 max-w-lg text-muted-foreground">{feature.body}</p>
      </div>
      <ImagePlaceholder
        id={feature.img.id}
        aspect="16 / 10"
        label={feature.img.label}
        note={feature.img.note}
        className={flip ? "lg:order-1" : undefined}
      />
    </div>
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
        <SectionHeading
          eyebrow="How it works"
          title="Up and running in seconds"
          subtitle="No download required. ParkFi runs in your browser and installs to your home screen if you want it there."
        />
        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={s.title}
                className="relative rounded-3xl border border-border bg-card p-7 shadow-sm"
              >
                <span className="font-heading absolute -top-3 left-7 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
                  Step {i + 1}
                </span>
                <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden />
                </div>
                <h3 className="mt-4 font-heading text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </div>
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
  },
] as const;

function UseCases() {
  return (
    <section id="use-cases" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <SectionHeading
        eyebrow="Who it's for"
        title="Built for every kind of park person"
        subtitle="However you do the parks, ParkFi meets you there."
      />
      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {PERSONAS.map((p) => {
          const Icon = p.icon;
          return (
            <div key={p.title} className="rounded-3xl border border-border bg-card p-7">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </div>
              <h3 className="mt-4 font-heading text-lg font-bold">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
            </div>
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
              Every feature on ParkFi — wait times, alerts, dining and resort tracking, the map, the
              news, and all pin-trading and collection features — is free to use. We do not sell
              tickets, reservations, or rooms, and we will{" "}
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
    </section>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────────────── */

function Faq() {
  return (
    <section id="faq" className="border-y border-border bg-muted/30">
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />
        <div className="mt-12 divide-y divide-border">
          {FAQS.map((f) => (
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

function SiteFooter() {
  return (
    <footer className="border-t border-border bg-muted/30">
      {/* ── Quicklinks + search ────────────────────────────────────────────── */}
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
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

/**
 * Labeled stand-in for marketing imagery. Swap each one for a real asset by
 * replacing this element with an <img src="/img/marketing/{id}.webp" />. The
 * `id` matches the image-prompt list handed off with this page.
 */
function ImagePlaceholder({
  id,
  aspect,
  label,
  note,
  className,
}: {
  id: string;
  aspect: string;
  label: string;
  note: string;
  className?: string;
}) {
  return (
    <div
      data-image-id={id}
      style={{ aspectRatio: aspect }}
      className={[
        "flex w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-primary/30 bg-primary/5 p-6 text-center",
        className ?? "",
      ].join(" ")}
    >
      <span className="font-heading rounded-full bg-primary/10 px-3 py-1 text-xs font-bold tracking-wide text-primary uppercase">
        Image
      </span>
      <span className="font-heading text-base font-semibold text-foreground">{label}</span>
      <span className="max-w-xs text-xs text-muted-foreground">{note}</span>
      <code className="mt-1 rounded bg-background/70 px-2 py-0.5 text-[0.65rem] text-muted-foreground">
        /img/marketing/{id}.webp
      </code>
    </div>
  );
}
