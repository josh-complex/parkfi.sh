import { describe, expect, it } from "vite-plus/test";

import { buildDiningDeepLink } from "./diningFormat.ts";

describe("buildDiningDeepLink", () => {
  it("wraps an mdx:// reservation link, scoped to facility/party/time, behind /deep-link", () => {
    const link = buildDiningDeepLink({
      facilityId: "90001234",
      partySize: 4,
      serviceDate: "2026-07-04",
      offerTime: "18:30:00",
      completionDeepLink: "https://parkfi.sh/dining/90001234",
    });
    // Wrapped in an https:// redirect (raw mdx:// hrefs get stripped by email
    // HTML sanitizers) — unwrap the `to` param to check the real mdx URL.
    const wrapper = new URL(link);
    expect(wrapper.protocol).toBe("https:");
    expect(wrapper.pathname).toBe("/deep-link");

    const raw = wrapper.searchParams.get("to");
    expect(raw?.startsWith("mdx://dining/reservation?")).toBe(true);
    const url = new URL(raw!);
    expect(url.searchParams.get("id")).toBe("90001234");
    expect(url.searchParams.get("partySize")).toBe("4");
    expect(url.searchParams.get("dateTime")).toBe("2026-07-04T18:30:00");
    expect(url.searchParams.get("completionDeepLink")).toBe("https://parkfi.sh/dining/90001234");
  });
});
