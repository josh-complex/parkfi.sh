/**
 * "New public filings" watch alert. Deliberately plain: each row is the filing's
 * own words (title, filer, status) with a link to our record page — plan §9
 * forbids framing a filing as an announcement, so the template offers no verb
 * of its own beyond "filed".
 */
import { Button, Heading, Link, Section, Text } from "react-email";

import { AlertLayout, bodyText, ctaButton, heading, type FilingEmailProps } from "./components.tsx";

const rowStyle: React.CSSProperties = {
  borderTop: "1px solid #e4e4e7",
  paddingTop: "12px",
  marginTop: "12px",
};
const titleStyle: React.CSSProperties = {
  color: "#18181b",
  fontSize: "15px",
  fontWeight: 600,
  lineHeight: "21px",
  margin: "0 0 2px",
  textDecoration: "none",
};
const metaStyle: React.CSSProperties = {
  color: "#71717a",
  fontSize: "13px",
  lineHeight: "19px",
  margin: 0,
};

export function FilingWatchEmail({
  watchLabel,
  records,
  count,
  moreCount,
  ctaUrl,
  manageUrl,
  unsubscribeUrl,
  postalAddress,
}: FilingEmailProps) {
  return (
    <AlertLayout
      preview={`${count} new public ${count === 1 ? "filing" : "filings"} — ${watchLabel}`}
      manageUrl={manageUrl}
      unsubscribeUrl={unsubscribeUrl}
      postalAddress={postalAddress}
      footerReason="you set a filing watch on parkfi.sh"
    >
      <Section>
        <Heading style={heading}>
          {count === 1 ? "A new filing" : `${count} new filings`} 📄
        </Heading>
        <Text style={bodyText}>
          Filed with public agencies and matched to <strong>{watchLabel}</strong>. These are records
          as filed — not announcements.
        </Text>
        {records.map((r) => (
          <Section key={r.id} style={rowStyle}>
            <Link href={r.pageUrl} style={titleStyle}>
              {r.title}
            </Link>
            <Text style={metaStyle}>
              {[r.kindLabel, r.filer, r.status, r.filedOn ? `filed ${r.filedOn}` : null, r.park]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </Section>
        ))}
        {moreCount > 0 ? (
          <Text style={{ ...metaStyle, marginTop: "12px" }}>
            + {moreCount} more {moreCount === 1 ? "filing" : "filings"}.
          </Text>
        ) : null}
        <Section style={{ marginTop: "20px" }}>
          <Button style={ctaButton} href={ctaUrl}>
            See the filings
          </Button>
        </Section>
      </Section>
    </AlertLayout>
  );
}

export default FilingWatchEmail;
