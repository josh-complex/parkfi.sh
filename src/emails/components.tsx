/**
 * Shared chrome for stay-alert emails. The footer carries the CAN-SPAM basics:
 * a one-click unsubscribe link (the signed token IS the auth), a "Manage alerts"
 * link, and a physical postal address. Inline styles only — email clients ignore
 * <style>/external CSS.
 */
import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from "react-email";
import * as React from "react";

export interface StayEmailProps {
  resortName: string;
  /** Human date span, e.g. "Jul 4 – Jul 6, 2026". */
  dateRange: string;
  pricePerNight: number | null;
  priceBelow?: number | null;
  /** Where the primary CTA points (the stays search / resort detail). */
  ctaUrl: string;
  manageUrl: string;
  unsubscribeUrl: string;
  postalAddress: string;
}

const main: React.CSSProperties = {
  backgroundColor: "#f4f4f5",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};
const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "32px",
  maxWidth: "520px",
  borderRadius: "12px",
};
const footerText: React.CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  lineHeight: "18px",
};
const footerLink: React.CSSProperties = { color: "#71717a", textDecoration: "underline" };

export function AlertLayout({
  preview,
  children,
  manageUrl,
  unsubscribeUrl,
  postalAddress,
}: {
  preview: string;
  children: React.ReactNode;
  manageUrl: string;
  unsubscribeUrl: string;
  postalAddress: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          {children}
          <Hr style={{ borderColor: "#e4e4e7", margin: "24px 0" }} />
          <Section>
            <Text style={footerText}>
              You're getting this because you set a resort-availability alert on parkfi.sh.{" "}
              <Link style={footerLink} href={manageUrl}>
                Manage alerts
              </Link>{" "}
              ·{" "}
              <Link style={footerLink} href={unsubscribeUrl}>
                Unsubscribe
              </Link>
            </Text>
            {postalAddress ? <Text style={footerText}>{postalAddress}</Text> : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export const ctaButton: React.CSSProperties = {
  backgroundColor: "#2563eb",
  borderRadius: "8px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: 600,
  padding: "12px 20px",
  textDecoration: "none",
};
export const heading: React.CSSProperties = {
  color: "#18181b",
  fontSize: "22px",
  fontWeight: 700,
  margin: "0 0 8px",
};
export const bodyText: React.CSSProperties = {
  color: "#3f3f46",
  fontSize: "15px",
  lineHeight: "23px",
  margin: "0 0 8px",
};
export const priceText: React.CSSProperties = {
  color: "#16a34a",
  fontSize: "18px",
  fontWeight: 700,
  margin: "8px 0 20px",
};
