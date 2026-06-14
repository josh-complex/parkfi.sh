import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ScrollTextIcon } from "lucide-react";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () =>
    seo({
      title: "Privacy Policy & Terms of Use — ParkFi.sh",
      description:
        "How parkfi.sh collects and uses your data, and the terms that govern your use of the service.",
      path: "/privacy",
    }),
});

function PrivacyPage() {
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
      <AppInset>
        <SiteHeader title="Privacy & Terms" />
        <div className="flex flex-1 flex-col p-6 max-w-3xl mx-auto w-full gap-8">
          <div className="flex items-center gap-3">
            <ScrollTextIcon className="size-8 text-muted-foreground shrink-0" />
            <div>
              <h1 className="text-2xl font-bold">Privacy Policy &amp; Terms of Use</h1>
              <p className="text-sm text-muted-foreground">Last updated: June 13, 2026</p>
            </div>
          </div>

          {/* ── Privacy Policy ─────────────────────────────────────────── */}

          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold">Privacy Policy</h2>
            <p className="text-sm text-muted-foreground">
              parkfi.sh is a personal project, not a data business. We collect only what we need to
              run the service, we do not sell your information to anyone, and we do not use it for
              advertising.
            </p>
          </div>

          <Section title="What We Collect">
            <p>
              When you create an account we collect the following information. All of it is stored
              in a private database and is used only to operate the service.
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>
                <strong>Name and email address</strong> — required to identify your account and send
                you service notifications.
              </li>
              <li>
                <strong>Password</strong> — stored as a one-way hash (bcrypt). We never store or
                transmit your password in plain text. Passwords are checked against the{" "}
                <a
                  href="https://haveibeenpwned.com/Passwords"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Have I Been Pwned
                </a>{" "}
                database at registration and change time using k‑anonymity — only the first 5
                characters of a SHA‑1 hash are transmitted, never your actual password.
              </li>
              <li>
                <strong>Profile avatar</strong> — optional. You may upload a photo or generate a bot
                avatar. Uploaded images are stored on our servers.
              </li>
              <li>
                <strong>OAuth provider IDs</strong> — if you sign in with Google or Apple we store
                the opaque account identifier returned by that provider. We do not store Google or
                Apple access tokens beyond what is needed to complete sign-in.
              </li>
              <li>
                <strong>Session data</strong> — a secure session token tied to your account, along
                with your IP address and browser User-Agent string at session creation. This is how
                you stay logged in and how the Sessions page shows you what devices are active.
              </li>
              <li>
                <strong>Two-factor authentication data</strong> — if you enable 2FA, we store your
                TOTP secret and hashed backup codes. If you register passkeys (Face ID, Touch ID, or
                hardware keys), we store the WebAuthn public key and associated metadata.
              </li>
            </ul>
            <p>
              You do not need an account to browse wait times, dining availability, ticket prices,
              or resort rates. Account creation is only required for the alerts and notifications
              features.
            </p>
          </Section>

          <Section title="How We Use Your Data">
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>To authenticate you and keep your account secure.</li>
              <li>
                To deliver alerts and notifications for attractions, dining slots, or resort
                availability you have set up.
              </li>
              <li>To send transactional emails — password resets, security notices.</li>
              <li>
                To detect and prevent abuse, including automated sign-up bots (via Cloudflare
                Turnstile CAPTCHA verification on the login page).
              </li>
            </ul>
            <p>
              We do <strong>not</strong> use your data for advertising, behavioral tracking,
              analytics profiling, or any commercial purpose. We do not sell, rent, or share your
              personal information with third parties, except as described in the section below.
            </p>
          </Section>

          <Section title="Third-Party Services">
            <p>
              The following third-party services process some of your data as part of operating the
              site. Each is governed by its own privacy policy.
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>
                <strong>Google OAuth</strong> — if you choose to sign in with Google, your browser
                communicates with Google&rsquo;s servers to authenticate you. Google may process
                your email address and account identifiers per their own privacy policy.
              </li>
              <li>
                <strong>Apple ID</strong> — same as above for Sign in with Apple.
              </li>
              <li>
                <strong>Cloudflare Turnstile</strong> — the CAPTCHA widget on the sign-in page sends
                a challenge token to Cloudflare to verify that you are human. No personal account
                data is shared; Cloudflare may collect browser signals per their privacy policy.
              </li>
              <li>
                <strong>Have I Been Pwned</strong> — when you set a password, the first 5 characters
                of a hash of your password are sent to the HIBP k‑anonymity API to check whether it
                appears in a known breach. Your full password and password hash are never sent.
              </li>
            </ul>
          </Section>

          <Section title="Cookies &amp; Local Storage">
            <p>
              parkfi.sh uses a single session cookie to keep you signed in. We do not use
              advertising cookies, cross-site tracking cookies, or third-party analytics cookies. No
              consent banner is shown because we do not use non-essential cookies.
            </p>
          </Section>

          <Section title="Push Notifications">
            <p>
              If you grant permission for browser push notifications, your browser&rsquo;s push
              service (operated by your browser vendor — e.g. Google FCM for Chrome or Apple&rsquo;s
              APNs gateway for Safari) is used to deliver notifications to your device. We store a
              push subscription endpoint URL tied to your account. You can revoke push permission at
              any time in your browser settings.
            </p>
          </Section>

          <Section title="Data Retention &amp; Deletion">
            <p>
              Your account data is retained for as long as your account exists. Session records
              expire automatically after their expiry date. You can revoke individual sessions at
              any time from the{" "}
              <a
                href="/account/security"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Security settings
              </a>
              .
            </p>
            <p>
              You can permanently delete your account from the{" "}
              <a
                href="/account/profile"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Profile
              </a>{" "}
              page. Deletion removes your name, email, avatar, credentials, sessions, linked
              providers, 2FA data, and all alert preferences. This action is irreversible.
            </p>
          </Section>

          <Section title="Children&rsquo;s Privacy">
            <p>
              parkfi.sh is not directed at children under 13. We do not knowingly collect personal
              information from children under 13. If you believe a child under 13 has created an
              account, please contact us and we will delete it promptly.
            </p>
          </Section>

          <Section title="Changes to This Policy">
            <p>
              If we materially change how we collect or use your data, we will update the date above
              and, for significant changes, notify signed-in users by email. Continued use of the
              service after a change is posted constitutes acceptance of the updated policy.
            </p>
          </Section>

          {/* ── Terms of Use ───────────────────────────────────────────── */}

          <hr className="border-dashed" />

          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold">Terms of Use</h2>
            <p className="text-sm text-muted-foreground">
              By using parkfi.sh you agree to these terms. They are short and written in plain
              English. Also see our{" "}
              <a
                href="/disclaimers"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Disclaimers &amp; Legal Notice
              </a>{" "}
              for data accuracy, trademark, and liability disclaimers.
            </p>
          </div>

          <Section title="Permitted Use">
            <p>
              parkfi.sh is provided for{" "}
              <strong>personal, non-commercial informational use only</strong>. You may use it to
              plan theme park visits, track wait times, monitor dining availability, or set up
              personal alerts. That&rsquo;s exactly what it is for.
            </p>
          </Section>

          <Section title="Prohibited Uses">
            <p>You may not:</p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>
                Scrape, crawl, or systematically download data from parkfi.sh by automated means,
                including but not limited to bots, scripts, browser automation tools, or data
                harvesting services.
              </li>
              <li>
                Use parkfi.sh or the data it provides to build a competing product or service, to
                resell data, or for any commercial purpose without our express written consent.
              </li>
              <li>
                Attempt to reverse-engineer, bypass, or interfere with the site&rsquo;s APIs,
                authentication, rate limits, or infrastructure.
              </li>
              <li>Create multiple accounts to circumvent feature limits or for abuse purposes.</li>
              <li>
                Impersonate any person or entity, or submit false information when creating an
                account.
              </li>
            </ul>
          </Section>

          <Section title="Your Account">
            <p>
              You are responsible for keeping your login credentials confidential and for all
              activity that occurs under your account. If you believe your account has been
              compromised, change your password immediately and revoke active sessions from the{" "}
              <a
                href="/account/security"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Security settings
              </a>
              .
            </p>
            <p>
              Accounts are for personal use. You may not share your account with others or transfer
              it to another person.
            </p>
          </Section>

          <Section title="Service Availability &amp; Modifications">
            <p>
              parkfi.sh is a personal project provided as-is and at no charge. We make no guarantees
              of uptime, feature availability, or continuity. We may modify, suspend, or discontinue
              any part of the service — including alert features, specific data feeds, or account
              functionality — at any time without notice.
            </p>
            <p>
              We may also terminate or suspend your account at our discretion if we believe you have
              violated these terms.
            </p>
          </Section>

          <Section title="Governing Law">
            <p>
              These terms are governed by the laws of the United States. Any disputes arising from
              your use of parkfi.sh shall be resolved through good-faith discussion first. If you
              have a concern, please reach out to us before taking any formal action.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions, privacy requests, or concerns? Email us at{" "}
              <a
                href="mailto:hello@parkfi.sh"
                className="font-medium text-foreground underline underline-offset-4"
              >
                hello@parkfi.sh
              </a>
              . We&rsquo;re a small team and we read everything.
            </p>
          </Section>

          <p className="text-xs text-muted-foreground border-t pt-4">
            This page covers the privacy policy and terms of use for parkfi.sh. It does not
            constitute legal advice. For data accuracy and trademark disclaimers, see our{" "}
            <a
              href="/disclaimers"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Disclaimers &amp; Legal Notice
            </a>
            .
          </p>
        </div>
      </AppInset>
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
