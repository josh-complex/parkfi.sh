import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { pinOffer } from "#/db/schema.ts";
import { getPushQueue } from "#/server/notifications/queue.ts";
import { pinPublicUrl } from "#/server/pins/storage.ts";
import { protectedProcedure } from "../init.ts";

/**
 * The trading board — the differentiator. `matches` is the pure-Postgres mutual-
 * match query ("a trader who HAS a pin I want and WANTS a pin I have for trade"),
 * ranked by overlap size. Offers are pin-for-pin only (no cash). Creating /
 * answering an offer enqueues a push to the counterparty via the existing worker.
 */

const pinRefSchema = z.object({
  pinId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
});

type DirectionRow = {
  direction: "give" | "want";
  partner_id: string;
  partner_name: string | null;
  partner_image: string | null;
  pin_id: string;
  name: string;
  est_value_cents: number | null;
  r2_key: string | null;
};

export const pinTradeRouter = {
  /**
   * Traders you could swap with right now. Returns one entry per counterparty,
   * with the pins they could give you (they HAVE for-trade ∩ you WANT) and the
   * pins you could give them (you HAVE for-trade ∩ they WANT), ranked by total
   * overlap. Trivially fast on the (user_id, pin_id) indexes.
   */
  matches: protectedProcedure.query(async ({ ctx }) => {
    const { rows } = await db.execute<DirectionRow>(sql`
      WITH my_want AS (SELECT pin_id FROM pin_want WHERE user_id = ${ctx.userId}),
           my_give AS (SELECT pin_id FROM pin_have WHERE user_id = ${ctx.userId} AND for_trade),
           they_give AS (
             SELECT h.user_id, h.pin_id
             FROM pin_have h JOIN my_want w ON w.pin_id = h.pin_id
             WHERE h.for_trade AND h.user_id <> ${ctx.userId}
           ),
           they_want AS (
             SELECT w.user_id, w.pin_id
             FROM pin_want w JOIN my_give g ON g.pin_id = w.pin_id
             WHERE w.user_id <> ${ctx.userId}
           ),
           partners AS (
             SELECT user_id FROM they_give
             INTERSECT
             SELECT user_id FROM they_want
           )
      SELECT 'give'::text AS direction, tg.user_id AS partner_id,
             u.name AS partner_name, u.image AS partner_image,
             tg.pin_id, p.name, p.est_value_cents,
             (SELECT r2_key FROM pin_image i WHERE i.pin_id = p.id
              ORDER BY i.is_primary DESC, i.created_at LIMIT 1) AS r2_key
      FROM they_give tg
      JOIN partners pa ON pa.user_id = tg.user_id
      JOIN "user" u ON u.id = tg.user_id
      JOIN pin p ON p.id = tg.pin_id
      UNION ALL
      SELECT 'want'::text AS direction, tw.user_id AS partner_id,
             u.name AS partner_name, u.image AS partner_image,
             tw.pin_id, p.name, p.est_value_cents,
             (SELECT r2_key FROM pin_image i WHERE i.pin_id = p.id
              ORDER BY i.is_primary DESC, i.created_at LIMIT 1) AS r2_key
      FROM they_want tw
      JOIN partners pa ON pa.user_id = tw.user_id
      JOIN "user" u ON u.id = tw.user_id
      JOIN pin p ON p.id = tw.pin_id
    `);

    type PinRef = {
      pinId: string;
      name: string;
      estValueCents: number | null;
      imageUrl: string | null;
    };
    const partners = new Map<
      string,
      {
        partnerId: string;
        partnerName: string | null;
        partnerImage: string | null;
        theyOffer: PinRef[];
        youOffer: PinRef[];
      }
    >();
    for (const r of rows) {
      let p = partners.get(r.partner_id);
      if (!p) {
        p = {
          partnerId: r.partner_id,
          partnerName: r.partner_name,
          partnerImage: r.partner_image,
          theyOffer: [],
          youOffer: [],
        };
        partners.set(r.partner_id, p);
      }
      const ref: PinRef = {
        pinId: r.pin_id,
        name: r.name,
        estValueCents: r.est_value_cents,
        imageUrl: r.r2_key ? pinPublicUrl(r.r2_key) : null,
      };
      (r.direction === "give" ? p.theyOffer : p.youOffer).push(ref);
    }

    return [...partners.values()].sort(
      (a, b) => b.theyOffer.length + b.youOffer.length - (a.theyOffer.length + a.youOffer.length),
    );
  }),

  /** Propose a pin-for-pin swap and ping the recipient. */
  createOffer: protectedProcedure
    .input(
      z.object({
        toUserId: z.string(),
        offeringPins: z.array(pinRefSchema).min(1),
        requestingPins: z.array(pinRefSchema).min(1),
        message: z.string().max(500).optional(),
        expiresInDays: z.number().int().min(1).max(30).default(14),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.toUserId === ctx.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You can't trade with yourself." });
      }
      const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
      const [offer] = await db
        .insert(pinOffer)
        .values({
          fromUserId: ctx.userId,
          toUserId: input.toUserId,
          offeringPins: input.offeringPins,
          requestingPins: input.requestingPins,
          message: input.message ?? null,
          status: "pending",
          expiresAt,
        })
        .returning({ id: pinOffer.id });

      await getPushQueue().add("push", {
        userId: input.toUserId,
        title: "New pin trade offer",
        body: "Someone wants to trade pins with you. Tap to review.",
        url: "/pins/trades",
      });

      return { id: offer?.id };
    }),

  /** Accept / decline / cancel an offer. Pings the other party on a decision. */
  respondOffer: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        action: z.enum(["accept", "decline", "cancel"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const offer = await db
        .select()
        .from(pinOffer)
        .where(eq(pinOffer.id, input.id))
        .limit(1)
        .then((r) => r[0]);
      if (!offer) throw new TRPCError({ code: "NOT_FOUND" });

      // Recipient accepts/declines; sender cancels. Enforce role per action.
      const isRecipient = offer.toUserId === ctx.userId;
      const isSender = offer.fromUserId === ctx.userId;
      if (input.action === "cancel" ? !isSender : !isRecipient) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (offer.status !== "pending") {
        throw new TRPCError({ code: "CONFLICT", message: "This offer is no longer pending." });
      }

      const status =
        input.action === "accept"
          ? "accepted"
          : input.action === "decline"
            ? "declined"
            : "cancelled";
      await db.update(pinOffer).set({ status }).where(eq(pinOffer.id, input.id));

      // Notify the counterparty (recipient's decision → sender; cancel → recipient).
      const notify = input.action === "cancel" ? offer.toUserId : offer.fromUserId;
      const verb =
        status === "accepted" ? "accepted" : status === "declined" ? "declined" : "cancelled";
      await getPushQueue().add("push", {
        userId: notify,
        title: `Trade offer ${verb}`,
        body:
          status === "accepted"
            ? "Your pin trade was accepted — coordinate the swap."
            : `A pin trade offer was ${verb}.`,
        url: "/pins/trades",
      });

      return { ok: true };
    }),

  /** Offers involving the current user (sent + received), newest first. */
  myOffers: protectedProcedure.query(async ({ ctx }) => {
    const { rows } = await db.execute<{
      id: string;
      from_user_id: string;
      to_user_id: string;
      from_name: string | null;
      to_name: string | null;
      offering_pins: Array<{ pinId: string; quantity: number }>;
      requesting_pins: Array<{ pinId: string; quantity: number }>;
      message: string | null;
      status: string;
      expires_at: string | null;
      created_at: string;
    }>(sql`
      SELECT o.id, o.from_user_id, o.to_user_id,
             fu.name AS from_name, tu.name AS to_name,
             o.offering_pins, o.requesting_pins, o.message, o.status,
             o.expires_at, o.created_at
      FROM pin_offer o
      JOIN "user" fu ON fu.id = o.from_user_id
      JOIN "user" tu ON tu.id = o.to_user_id
      WHERE o.from_user_id = ${ctx.userId} OR o.to_user_id = ${ctx.userId}
      ORDER BY o.created_at DESC
      LIMIT 100
    `);

    // Hydrate every referenced pin once for display.
    const pinIds = [
      ...new Set(
        rows.flatMap((r) => [
          ...r.offering_pins.map((p) => p.pinId),
          ...r.requesting_pins.map((p) => p.pinId),
        ]),
      ),
    ];
    const pinMap = new Map<string, { name: string; imageUrl: string | null }>();
    if (pinIds.length > 0) {
      const { rows: pins } = await db.execute<{
        id: string;
        name: string;
        r2_key: string | null;
      }>(sql`
        SELECT p.id, p.name,
               (SELECT r2_key FROM pin_image i WHERE i.pin_id = p.id
                ORDER BY i.is_primary DESC, i.created_at LIMIT 1) AS r2_key
        FROM pin p
        WHERE p.id = ANY(${sql`ARRAY[${sql.join(
          pinIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}]`})
      `);
      for (const p of pins) {
        pinMap.set(p.id, { name: p.name, imageUrl: p.r2_key ? pinPublicUrl(p.r2_key) : null });
      }
    }
    const hydrate = (refs: Array<{ pinId: string; quantity: number }>) =>
      refs.map((ref) => ({
        pinId: ref.pinId,
        quantity: ref.quantity,
        name: pinMap.get(ref.pinId)?.name ?? "Unknown pin",
        imageUrl: pinMap.get(ref.pinId)?.imageUrl ?? null,
      }));

    return rows.map((r) => ({
      id: r.id,
      direction: r.from_user_id === ctx.userId ? ("sent" as const) : ("received" as const),
      counterpartyName: r.from_user_id === ctx.userId ? r.to_name : r.from_name,
      offeringPins: hydrate(r.offering_pins),
      requestingPins: hydrate(r.requesting_pins),
      message: r.message,
      status: r.status,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    }));
  }),
} satisfies TRPCRouterRecord;
