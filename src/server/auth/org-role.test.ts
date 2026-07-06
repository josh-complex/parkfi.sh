import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { roleForTenant, tenantIdFromToken } from "./org-role.ts";

/** Build an (unsigned) JWT — header.payload.signature — from a claims object. */
function jwt(claims: Record<string, unknown>): string {
  const seg = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${seg({ alg: "none", typ: "JWT" })}.${seg(claims)}.sig`;
}

// A stand-in tenant GUID — deliberately NOT a real org, so no organization is
// baked into the repo. The prod value lives only in the env allowlist.
const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("tenantIdFromToken", () => {
  it("extracts the tid claim from a well-formed token", () => {
    expect(tenantIdFromToken(jwt({ tid: ORG, sub: "abc" }))).toBe(ORG);
  });

  it("returns null when the tid claim is absent", () => {
    expect(tenantIdFromToken(jwt({ sub: "abc" }))).toBeNull();
  });

  it("returns null for a non-string tid", () => {
    expect(tenantIdFromToken(jwt({ tid: 123 }))).toBeNull();
  });

  it("returns null for null/undefined/empty input", () => {
    expect(tenantIdFromToken(null)).toBeNull();
    expect(tenantIdFromToken(undefined)).toBeNull();
    expect(tenantIdFromToken("")).toBeNull();
  });

  it("returns null for a malformed token (no payload segment)", () => {
    expect(tenantIdFromToken("not-a-jwt")).toBeNull();
  });

  it("returns null when the payload isn't valid JSON", () => {
    expect(tenantIdFromToken("aGVhZGVy.bm90LWpzb24.sig")).toBeNull();
  });
});

describe("roleForTenant", () => {
  const KEY = "MICROSOFT_CAST_MEMBER_TENANT_IDS";
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env[KEY];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[KEY];
    else process.env[KEY] = prev;
  });

  it("elevates a tenant on the allowlist", () => {
    process.env[KEY] = ORG;
    expect(roleForTenant(ORG)).toBe("cast_member");
  });

  it("does not elevate a tenant that is not listed", () => {
    process.env[KEY] = ORG;
    expect(roleForTenant(OTHER)).toBeNull();
  });

  it("matches case-insensitively (Entra GUIDs are case-agnostic)", () => {
    process.env[KEY] = ORG.toUpperCase();
    expect(roleForTenant(ORG.toLowerCase())).toBe("cast_member");
  });

  it("handles a comma-separated allowlist with stray whitespace", () => {
    process.env[KEY] = ` ${OTHER} , ${ORG} `;
    expect(roleForTenant(ORG)).toBe("cast_member");
    expect(roleForTenant(OTHER)).toBe("cast_member");
  });

  it("returns null when the allowlist is empty or unset", () => {
    process.env[KEY] = "";
    expect(roleForTenant(ORG)).toBeNull();
    delete process.env[KEY];
    expect(roleForTenant(ORG)).toBeNull();
  });

  it("returns null for a null/undefined tid", () => {
    process.env[KEY] = ORG;
    expect(roleForTenant(null)).toBeNull();
    expect(roleForTenant(undefined)).toBeNull();
  });
});
