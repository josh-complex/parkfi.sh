import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import type { PushPayload } from "./push.ts";

/**
 * APNs is routed through FCM (single sender for both platforms) — see
 * PLAN.md A4. Requires `FIREBASE_SERVICE_ACCOUNT_JSON` (the full service
 * account JSON, stringified) and, on iOS, the APNs auth key uploaded to the
 * Firebase project's Cloud Messaging settings.
 */
function getFirebaseApp() {
  const existing = getApps();
  if (existing.length) return existing[0]!;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
  return initializeApp({ credential: cert(JSON.parse(json)) });
}

export interface FcmSub {
  token: string;
  platform: "ios" | "android";
}

export async function sendNativePush(sub: FcmSub, payload: PushPayload): Promise<boolean> {
  try {
    await getMessaging(getFirebaseApp()).send({
      token: sub.token,
      notification: { title: payload.title, body: payload.body },
      data: payload.url ? { url: payload.url } : undefined,
      apns: sub.platform === "ios" ? { payload: { aps: { sound: "default" } } } : undefined,
    });
    return true;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "messaging/registration-token-not-registered"
    ) {
      return false; // token stale/uninstalled — caller should remove it
    }
    throw err;
  }
}
