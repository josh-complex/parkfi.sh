import { expect, test } from "vite-plus/test";

import { normalizeBaseUrl } from "./valhalla.ts";

test("keeps a public https domain on its implicit 443 (no :8002 rewrite)", () => {
  expect(normalizeBaseUrl("https://valhalla-production-aefd.up.railway.app")).toBe(
    "https://valhalla-production-aefd.up.railway.app",
  );
});

test("defaults the port to 8002 for a bare Railway internal host", () => {
  expect(normalizeBaseUrl("valhalla.railway.internal")).toBe(
    "http://valhalla.railway.internal:8002",
  );
});

test("respects an explicit port on a schemeless host", () => {
  expect(normalizeBaseUrl("valhalla.railway.internal:8002")).toBe(
    "http://valhalla.railway.internal:8002",
  );
});

test("keeps an explicit port on a full URL", () => {
  expect(normalizeBaseUrl("http://localhost:8002")).toBe("http://localhost:8002");
});

test("strips a trailing slash", () => {
  expect(normalizeBaseUrl("https://valhalla-production-aefd.up.railway.app/")).toBe(
    "https://valhalla-production-aefd.up.railway.app",
  );
});
