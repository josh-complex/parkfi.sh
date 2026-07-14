import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MailIcon } from "lucide-react";

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
    <div className="flex flex-1 flex-col p-6 max-w-3xl mx-auto w-full gap-8">
      <div className="flex items-center gap-3">
        <MailIcon className="size-8 text-muted-foreground shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Contact</h1>
          <p className="text-sm text-muted-foreground">
            We&rsquo;re a small team and read everything.
          </p>
        </div>
      </div>

      <Section title="Get in Touch">
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
      </Section>

      <Section title="Privacy Requests">
        <p>
          To request a copy of the data we hold about you, or to have it corrected or deleted, email
          the same address. See our{" "}
          <a href="/privacy" className="font-medium text-foreground underline underline-offset-4">
            Privacy Policy
          </a>{" "}
          for details on what we collect.
        </p>
      </Section>

      <Section title="Report a Scam">
        <p>
          ParkFi will never ask you to pay for any feature, including pin trading. If anyone
          claiming to represent ParkFi asks you for payment or a fee, please don&rsquo;t pay, and
          report it to us at the address above.
        </p>
      </Section>
    </div>
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
