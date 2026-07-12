import { describe, expect, it } from "vite-plus/test";

import { buildDiningDeepLink } from "./diningFormat.ts";

describe("buildDiningDeepLink", () => {
  it("builds a raw mdx:// reservation link scoped to facility/party/time", () => {
    const link = buildDiningDeepLink({
      facilityId: "90001234",
      partySize: 4,
      serviceDate: "2026-07-04",
      offerTime: "18:30:00",
      completionDeepLink: "https://parkfi.sh/dining/90001234",
    });
    // Raw custom-scheme URI — the caller owns platform context (email wraps it
    // behind /deep-link; web UI falls back to a Disney website URL instead).
    expect(link.startsWith("mdx://dining/reservation?")).toBe(true);
    const url = new URL(link);
    expect(url.searchParams.get("id")).toBe("90001234");
    expect(url.searchParams.get("partySize")).toBe("4");
    expect(url.searchParams.get("dateTime")).toBe("2026-07-04T18:30:00");
    expect(url.searchParams.get("completionDeepLink")).toBe("https://parkfi.sh/dining/90001234");
  });
});
