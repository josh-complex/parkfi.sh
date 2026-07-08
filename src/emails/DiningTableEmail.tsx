/** "A table opened" dining alert. */
import { Button, Heading, Section, Text } from "react-email";

import {
  AlertLayout,
  bodyText,
  ctaButton,
  heading,
  secondaryCtaButton,
  type DiningEmailProps,
} from "./components.tsx";

export function DiningTableEmail({
  restaurantName,
  dateLabel,
  partySize,
  ctaUrl,
  deepLinkUrl,
  manageUrl,
  unsubscribeUrl,
  postalAddress,
}: DiningEmailProps) {
  return (
    <AlertLayout
      preview={`${restaurantName} has a table for ${partySize} — ${dateLabel}`}
      manageUrl={manageUrl}
      unsubscribeUrl={unsubscribeUrl}
      postalAddress={postalAddress}
      footerReason="you set a dining-availability alert on parkfi.sh"
    >
      <Section>
        <Heading style={heading}>A table just opened up 🍽️</Heading>
        <Text style={bodyText}>
          <strong>{restaurantName}</strong> has a reservation available for a party of{" "}
          <strong>{partySize}</strong> — <strong>{dateLabel}</strong>.
        </Text>
        <Button style={ctaButton} href={ctaUrl}>
          Find a time
        </Button>
        {deepLinkUrl ? (
          <>
            <br />
            <Button style={secondaryCtaButton} href={deepLinkUrl}>
              Open in Disney App
            </Button>
          </>
        ) : null}
      </Section>
    </AlertLayout>
  );
}

export default DiningTableEmail;
