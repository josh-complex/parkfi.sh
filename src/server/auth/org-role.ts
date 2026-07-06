/**
 * Org-role detection from a Microsoft Entra tenant id.
 *
 * When a user signs in with Microsoft, the OIDC token carries a `tid` claim: the
 * GUID of the Entra tenant that issued it. That GUID identifies the organization
 * and cannot be spoofed by the user — it's a far stronger signal than an email
 * domain, because it covers every verified domain in the org's tenant and can't
 * be faked by typing a `@disney.com` address into a form.
 *
 * The allowlist is env-driven (comma-separated GUIDs) so tenants can be added —
 * Disney, NBCUniversal, subsidiaries — without a code change:
 *
 *   MICROSOFT_CAST_MEMBER_TENANT_IDS=<disney-guid>,<nbcu-guid>
 */

export type OrgRole = "cast_member";

function tenantAllowlist(): Set<string> {
  return new Set(
    (process.env.MICROSOFT_CAST_MEMBER_TENANT_IDS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** The elevated role for an Entra tenant id, or null for everyone else. */
export function roleForTenant(tid: string | null | undefined): OrgRole | null {
  if (!tid) return null;
  return tenantAllowlist().has(tid.toLowerCase()) ? "cast_member" : null;
}

/**
 * Decodes the claims of a JWT WITHOUT verifying its signature.
 *
 * Verification is unnecessary here: these tokens are never accepted from the
 * client. better-auth obtains them directly from Microsoft's token endpoint over
 * TLS during the server-side authorization-code exchange, so their integrity is
 * already guaranteed by that channel. We only need to read claims out of them.
 */
export function claimsFromToken(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/** Extracts the `tid` (Entra tenant) claim from a JWT. */
export function tenantIdFromToken(token: string | null | undefined): string | null {
  const tid = claimsFromToken(token)?.tid;
  return typeof tid === "string" ? tid : null;
}
