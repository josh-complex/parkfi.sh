import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlertIcon } from "lucide-react";

import { SparklesIcon, type SparklesIconHandle } from "#/components/ui/anim-icons/sparkles.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/disclaimers")({
  component: DisclaimersPage,
  head: () =>
    seo({
      title: "Disclaimers & Legal Notice — ParkFi.sh",
      description:
        "ParkFi.sh is an independent service and is not affiliated with The Walt Disney Company or Universal. Read our data, trademark, and legal disclaimers.",
      path: "/disclaimers",
    }),
});

function DisclaimersPage() {
  return (
    <div className="flex flex-1 flex-col p-6 max-w-3xl mx-auto w-full gap-8">
      <div className="flex items-center gap-3">
        <ShieldAlertIcon className="size-8 text-muted-foreground shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Disclaimers &amp; Legal Notice</h1>
          <p className="text-sm text-muted-foreground">Last updated: July 6, 2026</p>
        </div>
      </div>

      <Section title="Independent Third-Party Tool">
        <p>
          parkfi.sh is an <strong>independent, unofficial, fan-made tool</strong> created and
          operated by private individuals. It is not affiliated with, endorsed by, sponsored by, or
          in any way officially connected to The Walt Disney Company, Disney Parks, Experiences and
          Products, Universal City Studios LLC, Universal Parks &amp; Resorts, Comcast Corporation,
          NBCUniversal, or any of their respective subsidiaries, affiliates, licensors, or related
          entities (collectively, &ldquo;the Parks&rdquo;).
        </p>
      </Section>

      <Section title="Trademark Notice">
        <p>
          All park names, attraction names, resort names, character names, logos, trade dress, and
          other intellectual property referenced on this site — including but not limited to Walt
          Disney World&reg;, Disneyland&reg;, EPCOT&reg;, Magic Kingdom&reg;, Hollywood
          Studios&reg;, Animal Kingdom&reg;, Universal Studios Florida&reg;, Universal&rsquo;s
          Islands of Adventure&reg;, Universal Epic Universe&reg;, and all associated marks — are
          the exclusive property of their respective owners.
        </p>
        <p>
          These marks are referenced solely for the purpose of identifying the real-world locations
          about which factual wait-time and operational data is displayed. Such references
          constitute nominative fair use and do not imply any sponsorship, affiliation, or
          endorsement.
        </p>
      </Section>

      <Section title="Data Sources &amp; Accuracy">
        <p>
          All information on parkfi.sh — including wait times and ride status, ticket prices, dining
          reservation availability, resort room availability and nightly rates, crowd forecasts, and
          maps and walking routes — is aggregated, derived, or estimated from publicly available
          sources and unofficial APIs. It is collected by automated systems on a periodic basis and
          is presented &ldquo;as is.&rdquo; This data:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>May be delayed, cached, inaccurate, incomplete, or out of date.</li>
          <li>Does not constitute official park information, pricing, or inventory.</li>
          <li>Should not be relied upon for time-sensitive or financial decisions.</li>
          <li>
            May differ from the data shown in official park apps, websites, booking systems, or cast
            member and team member communications.
          </li>
          <li>
            Reflects only a snapshot in time and may have already changed by the time you view it.
          </li>
        </ul>
        <p>
          Always verify current conditions, prices, and availability through the official park app,
          website, or directly with park staff before making travel, dining, lodging, or purchasing
          decisions.
        </p>
      </Section>

      <Section title="Wait Times &amp; Ride Status">
        <p>
          Posted wait times, ride operating status, and downtime information are estimates derived
          from third-party data and may not reflect actual conditions at the parks. Attractions may
          open, close, or experience unexpected downtime at any time, and posted standby waits
          frequently differ from real-world queue times. Nothing on parkfi.sh should be treated as a
          guarantee that any attraction will be operating or available during your visit.
        </p>
      </Section>

      <Section title="Maps, Navigation &amp; Walking Directions">
        <p>
          The interactive map and walking-directions features are provided as a planning convenience
          only. Routes, distances, and estimated walking times are computed by our own routing
          engine from{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-4"
          >
            OpenStreetMap
          </a>{" "}
          data, which is community-maintained and may be incomplete, outdated, or simply wrong. A
          suggested route:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            May not reflect temporary closures, parade routes, crowd-control measures, construction
            walls, or restricted and cast-member-only areas.
          </li>
          <li>
            May show your position inaccurately — GPS inside theme parks is frequently degraded by
            buildings, structures, and crowds.
          </li>
          <li>Is an estimate, not a guarantee that a path is open, safe, or fastest.</li>
        </ul>
        <p>
          <strong>
            Posted signage, physical barriers, and instructions from park staff always override
            anything shown in this app.
          </strong>{" "}
          Please keep your eyes on your surroundings — not on your screen — while walking,
          especially in crowds and around vehicles, strollers, and parade routes. parkfi.sh is not
          suitable for emergency use; in an emergency, follow park staff instructions and official
          park channels.
        </p>
        <p>
          Map data &copy; OpenStreetMap contributors, rendered via MapTiler. Attribution is also
          displayed on the map itself.
        </p>
      </Section>

      <Section title="Crowd Forecasts &amp; Wait-Time Predictions">
        <p>
          Crowd calendars, crowd-level scores, predicted wait-time curves, and any figures labeled
          as forecasts or predictions are <strong>statistical estimates</strong> produced by models
          trained on historical data. Ranges and confidence bands describe the model&rsquo;s
          uncertainty — they are not promises about what will happen. Forecasts can be materially
          wrong, particularly around holidays, special events, weather disruptions, new attraction
          openings, and anything else history does not predict well. Where we show accuracy
          statistics, they describe past performance only. Do not make plans that depend on a
          forecast being right.
        </p>
      </Section>

      <Section title="Ticket Pricing">
        <p>
          The ticket prices and pricing-calendar figures shown on parkfi.sh are{" "}
          <strong>informational estimates only</strong>. parkfi.sh does not sell tickets, set
          prices, or process any transaction. Actual prices depend on date, park, ticket type,
          promotions, taxes, fees, and other factors determined solely by the park operators and
          their authorized sellers, and may change without notice.
        </p>
        <p>
          Any &ldquo;cheapest day&rdquo; or comparison feature is a convenience based on best-effort
          data and is not a price quote, offer, or recommendation. Always confirm the final price on
          the official park website or with an authorized ticket seller before purchasing.
        </p>
      </Section>

      <Section title="Dining Reservations &amp; Availability">
        <p>
          Dining availability shown on parkfi.sh reflects table-service reservation slots that
          appeared available at the time our systems last checked. Availability is highly volatile
          and may be claimed, released, or changed at any moment. parkfi.sh{" "}
          <strong>does not book, hold, modify, or cancel dining reservations</strong> on your
          behalf, and we cannot guarantee that any slot shown will still be available when you
          attempt to book it.
        </p>
        <p>
          All dining reservations must be made through the official park app or website. Any
          cancellation policies, deposits, party-size limits, and prepayment requirements are set
          and enforced solely by the parks and their dining operators.
        </p>
      </Section>

      <Section title="Resort &amp; Stay Availability">
        <p>
          Resort hotel room availability, room types, and nightly rates — including any figures
          shown for Value, Moderate, and Deluxe resorts or Disney Vacation Club Villas — are
          estimates aggregated from public sources for informational and comparison purposes only.
          They may not reflect current inventory, may exclude taxes, resort fees, discounts, or
          eligibility restrictions, and may differ materially from the rates and availability shown
          at the time of booking.
        </p>
        <p>
          parkfi.sh <strong>does not sell, reserve, or broker lodging</strong> of any kind, is not a
          travel agency, and has no relationship with Disney Vacation Club or any resort operator.
          All bookings, rates, points charts, and membership terms are governed solely by the
          official operator. Confirm everything directly with them before relying on it.
        </p>
      </Section>

      <Section title="Accounts, Alerts &amp; Notifications">
        <p>
          parkfi.sh offers optional user accounts and alert features (for example, notifications
          when a watched attraction&rsquo;s wait time changes or its status updates). These alerts
          are provided on a <strong>best-effort basis only</strong> and depend on the timing and
          accuracy of upstream data, background processing, and notification delivery by your
          browser, device, operating system, or email provider — none of which we control.
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            Alerts may be delayed, duplicated, delivered out of order, or not delivered at all.
          </li>
          <li>
            You should never rely on an alert (or the absence of one) for any time-sensitive
            decision.
          </li>
          <li>
            Features, alert limits, and account functionality may change, be interrupted, or be
            discontinued at any time without notice.
          </li>
        </ul>
        <p>
          Accounts are intended for personal, non-commercial use. You are responsible for
          maintaining the confidentiality of your credentials and for activity that occurs under
          your account.
        </p>
      </Section>

      <Section title="No Commercial Relationship">
        <p>
          parkfi.sh does not sell or resell theme park tickets, dining reservations, resort stays,
          vacation packages, merchandise, or any other product or service offered by or affiliated
          with the parks. It is not a ticket seller, travel agency, booking platform, or reseller,
          and it processes no payments or transactions. We receive no compensation from any park
          operator, and any links to official park websites or booking systems are provided for
          informational convenience only.
        </p>
      </Section>

      <Section title="Limitation of Liability">
        <p>
          parkfi.sh and its operators make no warranties, express or implied, regarding the
          accuracy, reliability, completeness, or fitness for any particular purpose of the
          information provided. To the fullest extent permitted by applicable law, parkfi.sh and its
          operators shall not be liable for any direct, indirect, incidental, consequential, or
          exemplary damages arising from your use of, or reliance on, any information, feature, or
          alert provided by this site — including but not limited to missed attractions, missed or
          lost dining reservations, unavailable or mispriced tickets, unavailable or mispriced
          resort rooms, delayed or undelivered notifications, and any travel, lodging, or financial
          decisions made in reliance on the foregoing.
        </p>
      </Section>

      <Section title="Copyright">
        <p>
          The original software, design, and non-park-owned content of parkfi.sh are copyright
          &copy; {new Date().getFullYear()} parkfi.sh contributors. Park names, attraction names,
          and all associated intellectual property remain the sole property of their respective
          owners. No copyright in park-owned content is claimed by parkfi.sh.
        </p>
        <p>
          Some photographs, artwork, menu descriptions, and similar media shown on this site (for
          example, restaurant, shop, and attraction imagery) are sourced from the parks&rsquo; own
          publicly available listings and are displayed solely to help you identify the real-world
          locations and offerings they depict. All rights in that material remain with their
          respective owners; no ownership is claimed by parkfi.sh. If you are a rights holder and
          would like any of it removed, see the contact section below — we will act promptly.
        </p>
      </Section>

      <Section title="Contact &amp; Takedown Requests">
        <p>
          If you are a rights holder and believe any content on this site infringes your
          intellectual property rights, or if you have concerns about data displayed here, please
          contact us and we will respond promptly. We are happy to work cooperatively to address any
          legitimate concerns — we built this for fellow park fans and have no interest in causing
          harm to the parks or their operators.
        </p>
      </Section>

      <section className="flex flex-col gap-3 rounded-xl border border-dashed bg-muted/30 p-5">
        <div className="flex items-center gap-2">
          <LoopingSparkles className="text-muted-foreground shrink-0" size={22} />
          <h2 className="text-lg font-semibold">With all of that being said&hellip;</h2>
        </div>
        <div className="text-sm text-muted-foreground leading-relaxed flex flex-col gap-2">
          <p>
            &hellip; we say all of the above with the deepest possible affection. We did not build
            wait-time graphs, a ticket-price calendar, a dining-availability scanner, and a
            resort-rate board at 2&nbsp;a.m. because we resent the parks. We built them because we
            are completely, hopelessly enchanted by them — by the engineering, the storytelling, the
            logistics of moving a small city&rsquo;s worth of delighted people through a day, and
            the fact that someone, somewhere, sweats the paint on a trash can so a six-year-old
            gasps in the right spot.
          </p>
          <p>
            So here is the quiet part, said out loud:{" "}
            <a
              href="mailto:hire@parkfi.sh"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Disney, you know where to find us.
            </a>{" "}
            (Universal, your application is also very much welcome — we contain multitudes.) We are
            the kind of obsessive who reads the queue-theory paper for fun and then ships the
            dashboard. We would rather build this <em>with</em> you, on the inside, with real data
            and real APIs, than reverse-engineer it lovingly from the outside. Imagine what
            we&rsquo;d do with a badge.
          </p>
          <p>
            This is, to be unmistakably clear, a joke that we mean entirely. If anyone at the parks
            ever reads this far down a legal page: hi. We come in peace, we&rsquo;re great in code
            review, and our calendars are wide open.
          </p>
        </div>
      </section>

      <p className="text-xs text-muted-foreground border-t pt-4">
        This disclaimer is provided for informational purposes and does not constitute legal advice.
        parkfi.sh is a personal project and is not a legal entity. By using this site you
        acknowledge that you have read and understood these disclaimers.
      </p>
    </div>
  );
}

/**
 * SparklesIcon is hover/imperative-driven; here we want it twinkling on its own.
 * Kick off the animation on mount and re-trigger on the animation's natural
 * cadence (~3s: 1s sparkle + 1s star delay + 2s star blink) so it loops forever.
 */
function LoopingSparkles({ className, size }: { className?: string; size?: number }) {
  const ref = React.useRef<SparklesIconHandle>(null);

  React.useEffect(() => {
    ref.current?.startAnimation();
    const id = setInterval(() => ref.current?.startAnimation(), 3000);
    return () => clearInterval(id);
  }, []);

  return <SparklesIcon ref={ref} className={className} size={size} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed flex flex-col gap-2">
        {children}
      </div>
    </section>
  );
}
