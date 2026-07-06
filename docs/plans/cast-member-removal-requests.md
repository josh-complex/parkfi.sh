# Cast-member content removal & correction requests

> **Theme:** We now verifiably know when a signed-in user is an employee of a park
> operator (Microsoft Entra tenant → `user.role = 'cast_member'`; see
> `src/lib/auth.ts` `syncOrgRoleFromMicrosoft` and `src/server/auth/org-role.ts`).
> That unlocks a courtesy channel we can't safely offer anyone else: let a verified
> insider flag content on the very page they're looking at — "this photo is
> unauthorized," "this menu is wrong," "please take this listing down" — and route
> it to us for review. It operationalizes the promise already on `/disclaimers`
> ("Contact & Takedown Requests… we will respond promptly") with a self-serve,
> identity-verified front door.

## Core insight

Removal is **request → review → reversible suppression**, never a destructive edit
and never instant deletion by a single actor. The verified role gates _who can ask_;
an admin still decides _what happens_. Enforcement is a **suppression overlay** on the
read path (like a soft-delete we can lift), so nothing in the ingested catalog is lost
and a mistaken request costs one toggle to undo. This mirrors patterns we already run:
role-gated tRPC procedures (`protectedProcedure` / `adminProcedure` in
`src/integrations/trpc/init.ts`), admin review surfaces (`/admin/blog`), and
Resend-backed operator notifications (`src/server/notifications`).

## Scope & guardrails

- **Who sees the affordance.** Only `session.user.role === 'cast_member'` — and only
  on entities belonging to _their_ operator. A Disney cast member gets it on Disney
  pages, not Universal ones. This requires mapping role → operator (see Open Questions);
  entities already carry `operator_id` / `source` / `disneyOwned` (`src/db/schema.ts`).
- **Where.** The Disney feature pages: `park/$slug`, `park/$slug/ride/$rideSlug`,
  `dining_.$facilityId`, `shop.$slug`, `resort/$slug`. One shared component, dropped
  into each page's header/overflow menu — deliberately understated, not a loud CTA.
- **What can be targeted.** A whole listing, or a specific field — most usefully the
  **hero image / photos** and **menu content**, since those are the copied-media items
  the `/disclaimers` copyright section calls out. The dialog scopes the request.
- **Server-enforced, always.** The UI hiding the button is cosmetic. The mutation
  re-checks role _and_ operator ownership on every call; `input: false` on `role`
  (already set) means the client can't grant itself the role.

## Architecture

```
cast member on a Disney page
        │  "Request removal / report" (visible iff role + operator match)
        ▼
  RemovalRequestDialog ── scope (listing│image│menu) + reason + note
        │  trpc.removal.submit    (castMemberProcedure)
        ▼
  validate: role === cast_member  ∧  entity.operator == viewer.org
        │  insert removal_request(status='open', org snapshot)
        ├─► notify ADMIN_EMAILS via Resend  (+ PostHog event)
        └─► toast: "Thanks — our team will review this."

admin (ADMIN_EMAILS)
        │  /admin/removal-requests  (adminProcedure)
        ▼
  triage ─► resolve:  acknowledge │ decline(reason) │ action
                                                │ action
                                                ▼
                        upsert content_suppression(entityType, entityId, field, active=true)
                                                │
        read paths (park/ride/dining/shop/resort queries) LEFT JOIN suppression
                                                ▼
                        suppressed field/listing omitted from the response (reversible)
```

## Data model

Two tables. Hand-written timestamped migration per repo convention (no
`drizzle-kit generate`; see other `drizzle/*/migration.sql`). Additive only.

```ts
// The request itself — an audit trail of who asked for what.
removal_request {
  id            text pk
  requesterId   text -> user.id            // see Open Questions re: deletion
  orgTenantId   text                        // snapshot of requester's tenant at submit
  entityType    text  // 'park'|'attraction'|'restaurant'|'shop'|'resort'
  entityId      text
  targetField   text? // null = whole listing; else 'image'|'menu'|...
  reason        text  // enum-ish: 'inaccurate'|'unauthorized_media'|'confidential'|'other'
  note          text?
  status        text  // 'open'|'acknowledged'|'actioned'|'declined'  (default 'open')
  resolvedById  text? -> user.id
  resolvedAt    timestamptz?
  resolutionNote text?
  createdAt / updatedAt  timestamptz
  // index on (status, createdAt) for the triage queue; (entityType, entityId) for page lookups
}

// The reversible enforcement overlay — what's currently hidden and why.
content_suppression {
  entityType    text
  entityId      text
  field         text  // '*' = whole listing, else field name
  active        boolean default true
  sourceRequestId text? -> removal_request.id
  createdAt / updatedAt
  primary key (entityType, entityId, field)
}
```

`content_suppression` is the single source of truth read paths consult, so lifting a
suppression is one `active=false`. Keeping it separate from `removal_request` means an
admin can suppress proactively (or for a non-request reason) without a fake request,
and one request can map to zero or many suppressions.

## Server

- **`castMemberProcedure`** in `src/integrations/trpc/init.ts`, alongside
  `protectedProcedure`/`adminProcedure`: extends `protectedProcedure`, throws
  `FORBIDDEN` unless `ctx.session.user.role === 'cast_member'`. Fail-closed.
- **`src/integrations/trpc/routers/removal.ts`**:
  - `submit` (`castMemberProcedure`) — Zod-validated input; resolves the entity, asserts
    its operator matches the caller's org, inserts the request, fires the admin notice.
    Rate-limited per user (reuse the Redis limiter pattern in `src/server/parks/ratelimit.ts`).
  - `myRequests` (`castMemberProcedure`) — so the page can show "you already reported this."
  - `list` / `resolve` (`adminProcedure`) — triage queue + state transitions; `resolve`
    with `action` upserts/lifts `content_suppression`.
- **Enforcement helper** `applySuppressions(entityType, rows)` used by the read queries in
  `routers/parks.ts`, `dining.ts`, `stays.ts`, shops. Omits or blanks suppressed
  fields/listings. Also honored by the OG-card generator (`src/server/og/card.tsx`) so a
  suppressed image doesn't leak through social cards.
- **Notifications** reuse Resend + `ADMIN_EMAILS`; a new-request email to admins, and an
  optional confirmation/decision email to the requester. PostHog event
  `removal_request_submitted` for volume visibility.

## UX notes

- Trigger lives in the page's overflow/"⋯" menu, labeled "Report or request removal" —
  calm, not alarmist. Insiders will look for it; guests never see it.
- Dialog: **scope** (radio: this listing / this photo / this menu), **reason** (select),
  **note** (optional), submit. On success, a toast and the trigger flips to "Reported —
  under review."
- If a suppression is already active on what they're viewing, show a small "Content
  hidden pending review" placeholder rather than a broken/empty slot.

## Legal & policy alignment

- Add one line to the `/disclaimers` "Contact & Takedown Requests" section: verified
  employees of a covered operator can submit removal/correction requests in-app, and we
  review them promptly. Frame it as a **cooperative courtesy**, consistent with the
  existing nominative-fair-use stance — not an admission of any obligation, and not a
  claim of affiliation (keep the wording in step with the "independent, unofficial" line
  and the corrected privacy copy: "employees of the theme parks we cover," never "partner").
- No new personal data beyond what's already disclosed; the tenant ID is covered by the
  privacy policy's OAuth section. The request note is user-supplied content.

## Rollout phases

1. **Backend spine** — migration (both tables), `castMemberProcedure`, `removal.submit` +
   `myRequests`, admin email notify. No enforcement, no UI yet. Testable via tRPC directly.
2. **Page affordance** — shared `RemovalRequestDialog`, wired into the five Disney entity
   pages behind the role+operator gate.
3. **Admin review + enforcement** — `/admin/removal-requests`, `resolve`, the
   `content_suppression` overlay applied across read paths + OG cards.
4. **Loop-closing polish** — requester status/confirmation emails, "under review"
   placeholders, `/disclaimers` copy line, PostHog dashboard.

## Open questions

- **Role → operator mapping.** Today `role` is a flat `'cast_member'` (Disney). To scope
  the affordance correctly (and to extend to Universal `team_member` later), we need to
  know which operator a role/tenant maps to. Options: derive from `orgTenantId` via a
  tenant→operator lookup, or split the role (`disney_cast_member` / `universal_team_member`).
  Leaning toward a tenant→operator map so `role` stays a privilege tier.
- **Auto-hide on submit?** Should an image request soft-hide the image immediately
  (good-faith, reversible) pending review, or wait for admin action? Immediate hide is a
  stronger cooperation signal but lets one insider blank content unilaterally. Proposal:
  **auto-hide media on submit, require review for whole-listing removal.**
- **Retention vs. account deletion.** `removal_request.requesterId` FK: cascade-delete with
  the account (matches the deletion promise) vs. retain the request as a takedown record
  (anonymizing `requesterId`) for legal audit. Proposal: **on account deletion, null the
  `requesterId` and keep the request** — the takedown record outlives the account, minus PII.
  Needs sign-off since it's a deliberate carve-out from "we delete everything."
- **Escalation.** Do high-signal requests (e.g. reason `confidential`) page a human
  faster (Slack) rather than just email? Probably yes once volume justifies it.

```

```
