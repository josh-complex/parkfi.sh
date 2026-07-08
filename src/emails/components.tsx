/**
 * Shared chrome for stay-alert emails. The footer carries the CAN-SPAM basics:
 * a one-click unsubscribe link (the signed token IS the auth), a "Manage alerts"
 * link, and a physical postal address. Inline styles only — email clients ignore
 * <style>/external CSS.
 */
import { Body, Container, Head, Hr, Html, Img, Link, Preview, Section, Text } from "react-email";
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

export interface DiningEmailProps {
  restaurantName: string;
  /** Human description of the watched dates, e.g. "Jul 4" or "the next 30 days". */
  dateLabel: string;
  partySize: number;
  /** Where the primary CTA points (the dining search). */
  ctaUrl: string;
  /** `mdx://` deep link into the matched offer, when one could be built. */
  deepLinkUrl?: string;
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
const brandHeader: React.CSSProperties = {
  paddingBottom: "20px",
};
const brandWordmark: React.CSSProperties = {
  color: "#1c468e",
  fontSize: "20px",
  fontWeight: 700,
  letterSpacing: "-0.01em",
  marginLeft: "10px",
  verticalAlign: "middle",
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
  footerReason = "you set a resort-availability alert on parkfi.sh",
}: {
  preview: string;
  children: React.ReactNode;
  manageUrl: string;
  unsubscribeUrl: string;
  postalAddress: string;
  /** Why this email was sent, e.g. "you set a dining-availability alert…". */
  footerReason?: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Brand header. PNG (not webp) + absolute URL for broad email-client
              support; the yellow/white marker reads well on the white card. */}
          <Section style={brandHeader}>
            <Img
              src="https://parkfi.sh/img/brand/yellow_white_marker.png"
              width="40"
              height="40"
              alt="ParkFi"
              style={{ display: "inline-block", verticalAlign: "middle" }}
            />
            <span style={brandWordmark}>ParkFi</span>
          </Section>
          {children}
          <Hr style={{ borderColor: "#e4e4e7", margin: "24px 0" }} />
          <Section>
            <Text style={footerText}>
              You're getting this because {footerReason}.{" "}
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
export const secondaryCtaButton: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #d4d4d8",
  borderRadius: "8px",
  color: "#18181b",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: 600,
  marginLeft: "10px",
  padding: "11px 20px",
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
