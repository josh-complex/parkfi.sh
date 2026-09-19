import { describe, expect, it } from "vite-plus/test";

import {
  actionRow,
  canEmbedMedia,
  container,
  discordComponentEmbed,
  linkButton,
  linkPreview,
  text,
} from "./discord-embed.ts";

/** Parse the emitted script back into the payload Discord would receive. */
function payloadOf(root: Parameters<typeof discordComponentEmbed>[0]) {
  const [script] = discordComponentEmbed(root);
  if (!script) return null;
  return JSON.parse(script.children) as {
    component: { type: number; accent_color?: number; components: Array<Record<string, unknown>> };
  };
}

const RIDE_CARD = "/og/ride/epcot/cosmic-rewind/card.jpg?v=291";

function ridePreview(photos?: Array<string>) {
  return linkPreview({
    title: "Guardians of the Galaxy: Cosmic Rewind",
    url: "/park/epcot/ride/guardians-of-the-galaxy-cosmic-rewind",
    subtitle: "World Discovery · EPCOT",
    body: "Lightning Lane status, standby history, and wait alerts.",
    card: RIDE_CARD,
    photos,
    buttons: [linkButton("All EPCOT waits", "/park/epcot")],
  });
}

describe("discordComponentEmbed", () => {
  it("emits the crawler's exact script id and type", () => {
    const [script] = discordComponentEmbed(ridePreview());
    expect(script?.id).toBe("discord:component-embed");
    expect(script?.type).toBe("application/json");
  });

  it("wraps a single accent-colored container in the documented `component` key", () => {
    const payload = payloadOf(ridePreview())!;
    expect(Object.keys(payload)).toEqual(["component"]);
    expect(payload.component.type).toBe(17);
    expect(payload.component.accent_color).toBe(0x1c468e);
  });

  it("escapes `<` so a description can't close the script tag early", () => {
    const [script] = discordComponentEmbed(
      container([text("Wait </script><script>alert(1)</script> times")]),
    );
    expect(script!.children).not.toContain("</script>");
    expect(script!.children).toContain("\\u003c");
    // Still valid JSON, and the escape round-trips back to the original text.
    const payload = JSON.parse(script!.children) as {
      component: { components: Array<{ content: string }> };
    };
    expect(payload.component.components[0]?.content).toContain("</script>");
  });

  it("promotes root-relative button urls to absolute", () => {
    const [script] = discordComponentEmbed(
      container([actionRow(linkButton("Waits", "/park/epcot"))]),
    );
    expect(script!.children).toContain("https://parkfi.sh/park/epcot");
  });

  it("only uses link-style buttons — anything else voids the payload in Discord", () => {
    const payload = payloadOf(container([actionRow(linkButton("Waits", "/park/epcot"))]))!;
    const row = payload.component.components[0] as {
      components: Array<{ style: number; custom_id?: string }>;
    };
    expect(row.components[0]?.style).toBe(5);
    expect(row.components[0]).not.toHaveProperty("custom_id");
  });

  it("drops the script — falling back to the OG card — on an invalid payload", () => {
    expect(discordComponentEmbed(container([]))).toEqual([]);
    expect(discordComponentEmbed(container([text("  ")]))).toEqual([]);
    expect(discordComponentEmbed(container([actionRow()]))).toEqual([]);
    // Over the 40-component ceiling.
    expect(
      discordComponentEmbed(container(Array.from({ length: 41 }, (_, i) => text(`line ${i}`)))),
    ).toEqual([]);
  });

  it("stays inside the 3,000-byte budget for a realistic page", () => {
    const [script] = discordComponentEmbed(
      ridePreview([
        "https://cdn1.parksmedia.wdprapps.disney.com/media/attractions/cosmic-rewind-1.jpg",
        "https://cdn1.parksmedia.wdprapps.disney.com/media/attractions/cosmic-rewind-2.jpg",
        "https://cdn1.parksmedia.wdprapps.disney.com/media/attractions/cosmic-rewind-3.jpg",
      ]),
    );
    expect(new TextEncoder().encode(script!.children).length).toBeLessThan(3000);
  });
});

describe("linkPreview", () => {
  it("puts the generated card in a full-bleed gallery, never a thumbnail", () => {
    // A thumbnail crops the 1200x630 card into an illegible square — the whole
    // reason the first cut looked worse than the plain Open Graph preview.
    const payload = payloadOf(ridePreview())!;
    const types = payload.component.components.map((c) => c.type);
    expect(types).not.toContain(11); // thumbnail
    expect(types).not.toContain(9); // section (only exists to hold an accessory)
    const galleries = payload.component.components.filter((c) => c.type === 12) as Array<{
      items: Array<{ media: { url: string } }>;
    }>;
    expect(galleries).toHaveLength(1);
    expect(galleries[0]?.items).toHaveLength(1);
    expect(galleries[0]?.items[0]?.media.url).toBe(`https://parkfi.sh${RIDE_CARD}`);
  });

  it("renders the heading as a link with the subtitle as subtext", () => {
    const payload = payloadOf(ridePreview())!;
    const heading = payload.component.components[0] as { type: number; content: string };
    expect(heading.type).toBe(10);
    expect(heading.content).toBe(
      "### [Guardians of the Galaxy: Cosmic Rewind](https://parkfi.sh/park/epcot/ride/guardians-of-the-galaxy-cosmic-rewind)\n-# World Discovery · EPCOT",
    );
  });

  it("drops a lone extra photo but grids two or more", () => {
    const one = payloadOf(ridePreview(["https://cdn.x/a.jpg"]))!;
    expect(one.component.components.filter((c) => c.type === 12)).toHaveLength(1);

    const two = payloadOf(ridePreview(["https://cdn.x/a.jpg", "https://cdn.x/b.jpg"]))!;
    const galleries = two.component.components.filter((c) => c.type === 12) as Array<{
      items: Array<unknown>;
    }>;
    expect(galleries).toHaveLength(2);
    expect(galleries[1]?.items).toHaveLength(2);
  });

  it("never repeats the lead card inside the photo grid", () => {
    // Pin pages pass their whole image set as `photos` and the primary as `card`.
    const primary = "https://pins.parkfi.sh/pins/ref/a.webp";
    const payload = payloadOf(
      linkPreview({
        title: "Figment Pin",
        url: "/pins/abc",
        card: primary,
        photos: [primary, "https://pins.parkfi.sh/pins/ref/b.webp"],
      }),
    )!;
    const galleries = payload.component.components.filter((c) => c.type === 12);
    // Only one other photo survives deduping, so no grid — and no duplicate.
    expect(galleries).toHaveLength(1);
    expect(JSON.stringify(payload).match(/ref\/a\.webp/g)).toHaveLength(1);
  });

  it("caps the photo grid at three, holding the whole embed to four images", () => {
    // Discord measures every image inside the page's 10s budget and a component
    // embed can't declare dimensions to skip that, so the margin matters.
    const payload = payloadOf(
      ridePreview(Array.from({ length: 9 }, (_, i) => `https://cdn.x/${i}.jpg`)),
    )!;
    const galleries = payload.component.components.filter((c) => c.type === 12) as Array<{
      items: Array<unknown>;
    }>;
    expect(galleries[1]?.items).toHaveLength(3);
    const total = galleries.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBeLessThanOrEqual(4);
  });

  it("escapes a `]` in the title so the heading link survives", () => {
    const payload = payloadOf(
      linkPreview({ title: "Mickey Waffles [GF]", url: "/dining/x/item/waffles" }),
    )!;
    const heading = payload.component.components[0] as { content: string };
    expect(heading.content).toContain("\\[GF\\]");
  });

  it("omits the separator and row when a page has no buttons", () => {
    const payload = payloadOf(linkPreview({ title: "Shop", url: "/shop/x" }))!;
    const types = payload.component.components.map((c) => c.type);
    expect(types).not.toContain(14);
    expect(types).not.toContain(1);
  });
});

describe("canEmbedMedia", () => {
  it("accepts the formats Discord decodes", () => {
    for (const ext of ["png", "gif", "jpg", "jpeg", "webp", "avif"]) {
      expect(canEmbedMedia(`https://parkfi.sh/a.${ext}`)).toBe(true);
    }
  });

  it("accepts our own live OG cards, absolute or root-relative", () => {
    expect(
      canEmbedMedia("https://parkfi.sh/og/ride/magic-kingdom/space-mountain/card.jpg?v=291"),
    ).toBe(true);
    expect(canEmbedMedia("/og/ride/magic-kingdom/space-mountain/card.jpg?v=291")).toBe(true);
  });

  it("accepts a published hero loop — the animated card has to survive this gate", () => {
    // Rides with a cinemagraph spend their card slot on an animated WebP, which
    // is the only format that actually moves in a preview (video in a gallery
    // renders a poster frame with play controls). Sweeping `webp` into the
    // denylist alongside the video formats would silently turn every one of
    // those cards back into a plain link.
    expect(canEmbedMedia("https://assets.parkfi.sh/hero-loops/haunted-mansion-9f2c1a04.webp")).toBe(
      true,
    );
  });

  it("accepts extensionless CDN urls — Discord sniffs the content type", () => {
    // Disney's `/resize/mwImage/...` segments and R2 keys don't always end in an
    // extension; an allowlist here silently killed galleries across the site.
    expect(
      canEmbedMedia("https://cdn1.parksmedia.wdprapps.disney.com/resize/mwImage/1/1600/900"),
    ).toBe(true);
  });

  it("rejects what would silently void an embed", () => {
    expect(canEmbedMedia(null)).toBe(false);
    expect(canEmbedMedia(undefined)).toBe(false);
    expect(canEmbedMedia("images/card.png")).toBe(false); // not root-relative
    expect(canEmbedMedia("//cdn.x/a.jpg")).toBe(false); // protocol-relative
    expect(canEmbedMedia("data:image/png;base64,iVBOR")).toBe(false);
    expect(canEmbedMedia("https://parkfi.sh/a.svg")).toBe(false);
    expect(canEmbedMedia("https://parkfi.sh/clip.mp4")).toBe(false);
    expect(canEmbedMedia("https://parkfi.sh/clip.mov")).toBe(false);
    expect(canEmbedMedia(`https://parkfi.sh/${"a".repeat(2100)}.jpg`)).toBe(false);
  });
});
