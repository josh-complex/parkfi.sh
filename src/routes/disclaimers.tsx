import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlertIcon } from "lucide-react";

import { AppSidebar } from "#/components/app-sidebar.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/disclaimers")({
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
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader title="Disclaimers & Legal" />
        <div className="flex flex-1 flex-col p-6 max-w-3xl mx-auto w-full gap-8">
          <div className="flex items-center gap-3">
            <ShieldAlertIcon className="size-8 text-muted-foreground shrink-0" />
            <div>
              <h1 className="text-2xl font-bold">Disclaimers &amp; Legal Notice</h1>
              <p className="text-sm text-muted-foreground">Last updated: June 7, 2026</p>
            </div>
          </div>

          <Section title="Independent Third-Party Tool">
            <p>
              parkfi.sh is an <strong>independent, unofficial, fan-made tool</strong> created and
              operated by private individuals. It is not affiliated with, endorsed by, sponsored by,
              or in any way officially connected to The Walt Disney Company, Disney Parks,
              Experiences and Products, Universal City Studios LLC, Universal Parks &amp; Resorts,
              Comcast Corporation, NBCUniversal, or any of their respective subsidiaries,
              affiliates, licensors, or related entities (collectively, &ldquo;the Parks&rdquo;).
            </p>
          </Section>

          <Section title="Trademark Notice">
            <p>
              All park names, attraction names, resort names, character names, logos, trade dress,
              and other intellectual property referenced on this site — including but not limited to
              Walt Disney World&reg;, Disneyland&reg;, EPCOT&reg;, Magic Kingdom&reg;, Hollywood
              Studios&reg;, Animal Kingdom&reg;, Universal Studios Florida&reg;, Universal&rsquo;s
              Islands of Adventure&reg;, Universal Epic Universe&reg;, and all associated marks —
              are the exclusive property of their respective owners.
            </p>
            <p>
              These marks are referenced solely for the purpose of identifying the real-world
              locations about which factual wait-time and operational data is displayed. Such
              references constitute nominative fair use and do not imply any sponsorship,
              affiliation, or endorsement.
            </p>
          </Section>

          <Section title="Data Sources &amp; Accuracy">
            <p>
              Wait times, ride availability, dining reservation windows, and ticket pricing data
              displayed on parkfi.sh are aggregated from publicly available sources and unofficial
              APIs. This data:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>May be delayed, inaccurate, incomplete, or out of date.</li>
              <li>Does not constitute official park information.</li>
              <li>Should not be relied upon for time-sensitive decisions.</li>
              <li>
                May differ from the data shown in official park apps, websites, or cast member
                communications.
              </li>
            </ul>
            <p>
              Always verify current conditions through the official park app or directly with park
              staff before making travel, dining, or purchasing decisions.
            </p>
          </Section>

          <Section title="No Commercial Relationship">
            <p>
              parkfi.sh does not sell theme park tickets, reservations, merchandise, or any product
              or service offered by or affiliated with the parks. We receive no compensation from
              any park operator. Any links to official park websites are provided for informational
              convenience only.
            </p>
          </Section>

          <Section title="Limitation of Liability">
            <p>
              parkfi.sh and its operators make no warranties, express or implied, regarding the
              accuracy, reliability, completeness, or fitness for any particular purpose of the
              information provided. To the fullest extent permitted by applicable law, parkfi.sh and
              its operators shall not be liable for any direct, indirect, incidental, consequential,
              or exemplary damages arising from your use of, or reliance on, any information
              displayed on this site, including missed attractions, dining reservations, or travel
              plans.
            </p>
          </Section>

          <Section title="Copyright">
            <p>
              The original software, design, and non-park-owned content of parkfi.sh are copyright
              &copy; {new Date().getFullYear()} parkfi.sh contributors. Park names, attraction
              names, and all associated intellectual property remain the sole property of their
              respective owners. No copyright in park-owned content is claimed by parkfi.sh.
            </p>
          </Section>

          <Section title="Contact &amp; Takedown Requests">
            <p>
              If you are a rights holder and believe any content on this site infringes your
              intellectual property rights, or if you have concerns about data displayed here,
              please contact us and we will respond promptly. We are happy to work cooperatively to
              address any legitimate concerns — we built this for fellow park fans and have no
              interest in causing harm to the parks or their operators.
            </p>
          </Section>

          <p className="text-xs text-muted-foreground border-t pt-4">
            This disclaimer is provided for informational purposes and does not constitute legal
            advice. parkfi.sh is a personal project and is not a legal entity. By using this site
            you acknowledge that you have read and understood these disclaimers.
          </p>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
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
