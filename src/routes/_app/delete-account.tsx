import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";

import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/delete-account")({
  component: DeleteAccountPage,
  head: () =>
    seo({
      title: "Delete Your ParkFi Account — ParkFi.sh",
      description:
        "How to delete your ParkFi account and associated data, what is removed, and what is retained.",
      path: "/delete-account",
    }),
});

function DeleteAccountPage() {
  return (
    <div className="flex flex-1 flex-col p-6 max-w-3xl mx-auto w-full gap-8">
      <div className="flex items-center gap-3">
        <Trash2Icon className="size-8 text-muted-foreground shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Delete Your ParkFi Account</h1>
          <p className="text-sm text-muted-foreground">Last updated: July 13, 2026</p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        This page explains how to permanently delete your <strong>ParkFi</strong> account and the
        data associated with it. You can delete your account yourself from inside the app, or ask us
        to do it for you by email.
      </p>

      <Section title="Delete your account from the app">
        <ol className="list-decimal pl-5 flex flex-col gap-2">
          <li>Open the ParkFi app or go to parkfi.sh and sign in.</li>
          <li>
            Open your <strong>Account → Profile</strong> page (parkfi.sh/account/profile).
          </li>
          <li>
            Scroll to <strong>Delete account</strong> and tap it.
          </li>
          <li>Confirm the prompt. Your account is deleted immediately and cannot be recovered.</li>
        </ol>
      </Section>

      <Section title="Request deletion by email">
        <p>
          If you can’t access your account, email{" "}
          <a
            href="mailto:hello@parkfi.sh?subject=Account%20deletion%20request"
            className="font-medium text-foreground underline underline-offset-4"
          >
            hello@parkfi.sh
          </a>{" "}
          from the address on your account and ask us to delete it. We’ll verify ownership and
          remove your account, usually within 30 days.
        </p>
      </Section>

      <Section title="What is deleted">
        <p>Deleting your account permanently removes:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>Your name, email address, and profile avatar (including the stored image file)</li>
          <li>Your login credentials, active sessions, and any linked sign-in providers</li>
          <li>Two-factor authentication data and passkeys</li>
          <li>All alert preferences, saved alert searches, and push-notification subscriptions</li>
          <li>Your notification history and sensor-recorded ride events</li>
          <li>
            Your analytics profile and events — we request their deletion from our analytics
            provider (PostHog)
          </li>
        </ul>
        <p>This action is irreversible.</p>
      </Section>

      <Section title="What is retained, and for how long">
        <p>
          ParkFi keeps your account data only while your account exists — deleting the account
          removes it. After deletion, residual copies in encrypted backups are purged on the normal
          backup rotation, within <strong>30 days</strong>.
        </p>
        <p>
          Anonymous, non-identifying data that is not linked to your account (for example aggregate
          wait-time and ride statistics used to run the service) is not tied to you and is not
          removed by account deletion.
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
