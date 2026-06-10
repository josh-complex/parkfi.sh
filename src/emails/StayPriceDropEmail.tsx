/** "Price dropped below your target" alert (mode 2 — price_below). */
import { Button, Heading, Section, Text } from "react-email";

import {
  AlertLayout,
  bodyText,
  ctaButton,
  heading,
  priceText,
  type StayEmailProps,
} from "./components.tsx";

export function StayPriceDropEmail({
  resortName,
  dateRange,
  pricePerNight,
  priceBelow,
  ctaUrl,
  manageUrl,
  unsubscribeUrl,
  postalAddress,
}: StayEmailProps) {
  return (
    <AlertLayout
      preview={`${resortName} dropped to $${pricePerNight?.toLocaleString() ?? ""}/night`}
      manageUrl={manageUrl}
      unsubscribeUrl={unsubscribeUrl}
      postalAddress={postalAddress}
    >
      <Section>
        <Heading style={heading}>Price drop 📉</Heading>
        <Text style={bodyText}>
          <strong>{resortName}</strong> is now within your target for <strong>{dateRange}</strong>.
        </Text>
        {pricePerNight != null ? (
          <Text style={priceText}>
            ${pricePerNight.toLocaleString()} / night
            {priceBelow != null ? ` (your alert: ≤ $${priceBelow.toLocaleString()})` : ""}
          </Text>
        ) : null}
        <Button style={ctaButton} href={ctaUrl}>
          Book your stay
        </Button>
      </Section>
    </AlertLayout>
  );
}

export default StayPriceDropEmail;
