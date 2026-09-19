import { createFileRoute } from "@tanstack/react-router";

import { LegalSection } from "#/components/marketing/legal-section.tsx";
import { PageBody, PageMasthead } from "#/components/site-chrome/page-masthead.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/contact")({
  component: ContactPage,
  head: () =>
    seo({
      title: "Contact — ParkFi.sh",
      description: "Get in touch with the ParkFi team — questions, feedback, or support.",
      path: "/contact",
    }),
});

function ContactPage() {
  return (
    <>
      <PageMasthead
        kicker="Say hello"
        title="Contact"
        description="We're a small team and we read everything that lands in the inbox."
      />
      <PageBody size="prose">
        <LegalSection title="Get in Touch">
          <p>
            Questions, feedback, bug reports, or a data correction to flag? Email us at{" "}
            <a
              href="mailto:hello@parkfi.sh"
              className="font-medium text-foreground underline underline-offset-4"
            >
              hello@parkfi.sh
            </a>
            .
          </p>
        </LegalSection>

        <LegalSection title="Privacy Requests">
          <p>
            To request a copy of the data we hold about you, or to have it corrected or deleted,
            email the same address. See our{" "}
            <a href="/privacy" className="font-medium text-foreground underline underline-offset-4">
              Privacy Policy
            </a>{" "}
            for details on what we collect.
          </p>
        </LegalSection>

        <LegalSection title="Report a Scam">
          <p>
            ParkFi will never ask you to pay for any feature, including pin trading. If anyone
            claiming to represent ParkFi asks you for payment or a fee, please don&rsquo;t pay, and
            report it to us at the address above.
          </p>
        </LegalSection>
      </PageBody>
    </>
  );
}
