import { describe, expect, it } from "vite-plus/test";

import { cfImageUrl, imageFocus, imageFocusClass, resolveImageUrls } from "./image.ts";

/** Real Epic Universe assets: the logo-backplate comps we crop from the right,
 *  and the plain photos in the same feed that we must leave centred. */
const BACKPLATE = [
  "https://www.universalorlando.com/contentdata/uor/en/us/files/Images/gds/ueu-dark-universe-curse-of-the-werewolf-guests-logo-a.jpg",
  "https://www.universalorlando.com/contentdata/uor/en/us/files/Images/gds/ueu-celestial-park-stardust-racers-logo-backplate-a.jpg",
  "https://www.universalorlando.com/contentdata/uor/en/us/files/Images/gds/ueu-super-nintendo-world-yoshis-adventure-with-logo-a-0.jpg",
];
const CENTRED = [
  "https://www.universalorlando.com/contentdata/uor/en/us/files/Images/gds/ueu-httyd-character-meet-guest-with-toothless-a.jpg",
  "https://www.universalorlando.com/contentdata/uor/en/us/files/Images/gds/ueu-super-nintendo-world-princess-peach-walkaround-character-a.jpg",
  "https://services.universalorlando.com:443/api/Images/IOA-Blutos1_list.jpg",
  "https://cdn1.parksmedia.wdprapps.disney.com/resize/mwImage/1/800/450/75/dam/x.jpg",
];

describe("imageFocus", () => {
  it("points Universal's logo-backplate comps at the photo half", () => {
    for (const url of BACKPLATE) expect(imageFocus(url)).toBe("right");
    expect(imageFocusClass(BACKPLATE[0])).toBe("object-right");
  });

  it("leaves ordinary photos — including Epic Universe's own — centred", () => {
    for (const url of CENTRED) expect(imageFocus(url)).toBeUndefined();
    expect(imageFocusClass(CENTRED[0])).toBeUndefined();
    expect(imageFocus(null)).toBeUndefined();
  });

  it("still fires on a source already wrapped in a CF transform", () => {
    expect(imageFocus(cfImageUrl(BACKPLATE[0], { width: 448 }))).toBe("right");
  });
});

describe("cfImageUrl gravity", () => {
  it("crops from the right when the transform crops at all", () => {
    expect(cfImageUrl(BACKPLATE[0], { width: 448, height: 448 })).toContain("gravity=right");
  });

  it("stays off a width-only render, which doesn't crop", () => {
    expect(cfImageUrl(BACKPLATE[0], { width: 448 })).not.toContain("gravity");
  });

  it("stays off centred sources", () => {
    expect(cfImageUrl(CENTRED[0], { width: 448, height: 448 })).not.toContain("gravity");
  });

  it("reaches the srcSet rungs too, so every candidate frames alike", () => {
    const { src, srcSet } = resolveImageUrls(BACKPLATE[0], { cf: true, sizes: "100vw", aspect: 1 });
    expect(src).toContain("gravity=right");
    for (const rung of srcSet!.split(", ")) expect(rung).toContain("gravity=right");
  });
});

describe("resizer-blocked hosts", () => {
  it("serves wdwnt and allears images straight from the source", () => {
    for (const url of [
      "https://r2-media.wdwnt.com/2026/09/recap-8-31-26.jpg",
      "https://allears.net/wp-content/uploads/2026/09/photo.jpg",
      "https://WWW.allears.net/wp-content/uploads/2026/09/photo.jpg?w=1",
    ]) {
      expect(cfImageUrl(url, { width: 448 })).toBe(url);
      expect(resolveImageUrls(url, { cf: true, sizes: "100vw" })).toEqual({
        src: url,
        srcSet: undefined,
      });
    }
  });

  it("still transforms every other remote host", () => {
    const url = "https://media.blogmickey.com/2026/09/photo.jpg";
    expect(cfImageUrl(url, { width: 448 })).toContain("/cdn-cgi/image/");
  });
});
