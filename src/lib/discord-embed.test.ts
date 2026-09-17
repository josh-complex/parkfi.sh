import { describe, expect, it } from "vite-plus/test";

import {
  actionRow,
  canEmbedMedia,
  container,
  discordComponentEmbed,
  linkButton,
  section,
  separator,
  text,
  thumbnail,
} from "./discord-embed.ts";

/** The shape the ride route emits, so the test moves when that layout does. */
function rideEmbed(opts: { name: string; parkName: string; image?: string; wait?: number }) {
  const path = "/park/magic-kingdom/ride/space-mountain";
  return container([
    canEmbedMedia(opts.image)
      ? section(
          [text(`## [${opts.name}](https://parkfi.sh${path})\n${opts.parkName}`)],
          thumbnail(opts.image, opts.name),
        )
      : text(`## [${opts.name}](https://parkfi.sh${path})\n${opts.parkName}`),
    text(opts.wait != null ? `**${opts.wait} min** standby at last check` : "Live standby wait"),
    separator(),
    actionRow(
      linkButton(`All ${opts.parkName} waits`, "/park/magic-kingdom"),
      linkButton("Crowd forecast", "/predictions"),
    ),
  ]);
}

describe("discordComponentEmbed", () => {
  it("emits the crawler's exact script id and type", () => {
    const [script] = discordComponentEmbed(rideEmbed({ name: "Space Mountain", parkName: "MK" }));
    expect(script?.id).toBe("discord:component-embed");
    expect(script?.type).toBe("application/json");
  });

  it("wraps the container in the documented `component` key", () => {
    const [script] = discordComponentEmbed(rideEmbed({ name: "Space Mountain", parkName: "MK" }));
    const payload = JSON.parse(script!.children) as { component: { type: number } };
    expect(Object.keys(payload)).toEqual(["component"]);
    expect(payload.component.type).toBe(17);
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
    const [script] = discordComponentEmbed(
      container([actionRow(linkButton("Waits", "/park/epcot"))]),
    );
    const payload = JSON.parse(script!.children) as {
      component: {
        components: Array<{ components: Array<{ style: number; custom_id?: string }> }>;
      };
    };
    const button = payload.component.components[0]?.components[0];
    expect(button?.style).toBe(5);
    expect(button).not.toHaveProperty("custom_id");
  });

  it("drops the thumbnail rather than the card when the image isn't embeddable", () => {
    // A source with no image extension can't be verified as a format Discord
    // decodes, so the section degrades to a plain text display.
    const withBad = rideEmbed({
      name: "Test Track",
      parkName: "EPCOT",
      image: "https://cdn.x/i?id=9",
    });
    expect(withBad.components[0]?.type).toBe(10);

    const withGood = rideEmbed({
      name: "Test Track",
      parkName: "EPCOT",
      image: "https://cdn.x/a.jpg",
    });
    expect(withGood.components[0]?.type).toBe(9);
    // Both still produce a card.
    expect(discordComponentEmbed(withBad)).toHaveLength(1);
    expect(discordComponentEmbed(withGood)).toHaveLength(1);
  });

  it("stays inside the 3,000-byte budget for a realistic ride", () => {
    const [script] = discordComponentEmbed(
      rideEmbed({
        name: "Guardians of the Galaxy: Cosmic Rewind",
        parkName: "EPCOT",
        image:
          "https://cdn1.parksmedia.wdprapps.disney.com/media/attractions/cosmic-rewind-hero.jpg",
        wait: 95,
      }),
    );
    expect(new TextEncoder().encode(script!.children).length).toBeLessThan(3000);
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
});

describe("canEmbedMedia", () => {
  it("accepts the formats Discord decodes", () => {
    for (const ext of ["png", "gif", "jpg", "jpeg", "webp", "avif"]) {
      expect(canEmbedMedia(`https://parkfi.sh/a.${ext}`)).toBe(true);
    }
  });

  it("accepts our own live OG cards, query string and all", () => {
    expect(
      canEmbedMedia("https://parkfi.sh/og/ride/magic-kingdom/space-mountain/card.jpg?v=291"),
    ).toBe(true);
  });

  it("rejects what would silently void an embed", () => {
    expect(canEmbedMedia(null)).toBe(false);
    expect(canEmbedMedia("/relative/a.jpg")).toBe(false);
    expect(canEmbedMedia("https://parkfi.sh/a.svg")).toBe(false);
    expect(canEmbedMedia("https://parkfi.sh/clip.mp4")).toBe(false);
    expect(canEmbedMedia(`https://parkfi.sh/${"a".repeat(2100)}.jpg`)).toBe(false);
  });
});
