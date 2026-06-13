import { PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { z } from "zod";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "#/lib/r2.ts";
import { protectedProcedure } from "../init.ts";
import type { TRPCRouterRecord } from "@trpc/server";

export const uploadsRouter = {
  avatar: protectedProcedure
    .input(
      z.object({
        // data URI: "data:image/jpeg;base64,..."
        dataUri: z.string().startsWith("data:image/"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const commaIdx = input.dataUri.indexOf(",");
      const b64 = input.dataUri.slice(commaIdx + 1);
      const raw = Buffer.from(b64, "base64");

      const body = await sharp(raw)
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();

      const key = `avatars/${ctx.userId}.webp`;

      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: body,
          ContentType: "image/webp",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );

      return { url: `${R2_PUBLIC_URL}/${key}` };
    }),
} satisfies TRPCRouterRecord;
