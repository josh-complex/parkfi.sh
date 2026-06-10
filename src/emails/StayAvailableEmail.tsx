/** "A room opened" alert (mode 1 — becomes_available). */
import { Button, Heading, Section, Text } from "react-email";

import {
  AlertLayout,
  bodyText,
  ctaButton,
  heading,
  priceText,
  type StayEmailProps,
} from "./components.tsx";

export function StayAvailableEmail({
  resortName,
  dateRange,
  pricePerNight,
  ctaUrl,
  manageUrl,
  unsubscribeUrl,
  postalAddress,
}: StayEmailProps) {
  return (
    <AlertLayout
      preview={`${resortName} is available for ${dateRange}`}
      manageUrl={manageUrl}
      unsubscribeUrl={unsubscribeUrl}
      postalAddress={postalAddress}
    >
      <Section>
        <Heading style={heading}>A room just opened up 🎉</Heading>
        <Text style={bodyText}>
          <strong>{resortName}</strong> has availability for your dates,{" "}
          <strong>{dateRange}</strong>.
        </Text>
        {pricePerNight != null ? (
          <Text style={priceText}>From ${pricePerNight.toLocaleString()} / night</Text>
        ) : null}
        <Button style={ctaButton} href={ctaUrl}>
          Check availability
        </Button>
      </Section>
    </AlertLayout>
  );
}

export default StayAvailableEmail;
