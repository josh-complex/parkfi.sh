import { describe, expect, it } from "vite-plus/test";

import { decodeEntities } from "./text.ts";

describe("decodeEntities", () => {
  it("un-escapes the entities the operator feeds emit", () => {
    expect(decodeEntities("Disney&apos;s Grand Floridian Resort &amp; Spa")).toBe(
      "Disney's Grand Floridian Resort & Spa",
    );
    expect(decodeEntities("Mac &#38; Cheese")).toBe("Mac & Cheese");
    expect(decodeEntities("Caf&eacute; con leche")).toBe("Café con leche");
    expect(decodeEntities("Chef&#x27;s choice")).toBe("Chef's choice");
  });

  it("handles double-escaped entities", () => {
    expect(decodeEntities("Chef&amp;#39;s table")).toBe("Chef's table");
  });

  it("leaves plain text and unknown entities alone", () => {
    expect(decodeEntities("Bananas Foster-style Steel-cut Oatmeal")).toBe(
      "Bananas Foster-style Steel-cut Oatmeal",
    );
    expect(decodeEntities("Beans &beanz; rice")).toBe("Beans &beanz; rice");
    expect(decodeEntities("50% off & more")).toBe("50% off & more");
  });

  it("passes null and undefined straight through", () => {
    expect(decodeEntities(null)).toBeNull();
    expect(decodeEntities(undefined)).toBeUndefined();
    expect(decodeEntities("")).toBe("");
  });
});
