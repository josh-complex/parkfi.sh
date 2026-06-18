// Lean, self-contained service worker — NO bundler, NO ES imports, NO Workbox.
//
// Why hand-written and import-free: this file is served verbatim from `public/`
// by Nitro (it copies the public dir as-is into the deploy). A classic worker
// cannot use `import` statements or `import.meta.env`, so anything that needs
// bundling silently shipped broken source ("Cannot use import statement outside
// a module") and the worker never installed.
//
// Why no precaching: precaching the SPA shell on a live-data site is what served
// stale HTML after a redeploy — old HTML referencing hashed chunks that no longer
// exist, producing "Failed to fetch dynamically imported module". With no
// precache the server always serves current HTML, so the app self-heals on the
// next load. This worker's only job is Web Push.

// Public VAPID key — safe to inline (it's already shipped to every client in the
// app bundle and is, by definition, public). Must match the server's
// VAPID_PUBLIC_KEY env var. Rotating the VAPID keypair invalidates all existing
// push subscriptions, so this changes ~never; if you do rotate it, update here too.
const VAPID_PUBLIC_KEY =
  "BPiHXxCW5cBHyu7r5pT9JESLU35ArDGnTHi09wUZO6wU2DQU3PRCK8sdhsasX1BPZ7qPiMUYnyitbO95fC-pL4Y";

// Take over promptly on update so a fixed worker replaces a broken/old one
// without waiting for every tab to close.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      // Purge any precache left behind by the previous Workbox-based worker. This
      // worker has no fetch handler so those caches can no longer serve stale HTML,
      // but clearing them reclaims storage and removes the artifact that caused the
      // "stale chunk after deploy" failures in the first place.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("workbox-") || k.includes("precache"))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  ),
);

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

async function registerSubscription(sub) {
  const json = sub.toJSON();
  await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    }),
  });
}

// Browsers periodically rotate/expire push subscriptions. Without this, the old
// endpoint 410s on the next send, the server prunes it, and the device silently
// goes dark until the user manually re-enables. Re-subscribe and re-register the
// fresh endpoint with the account (the subscribe route is session-cookie gated).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      // Some browsers hand us the already-renewed subscription; reuse it when
      // present, otherwise renew it ourselves with the VAPID key.
      const sub =
        event.newSubscription ??
        (await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));
      await registerSubscription(sub);
    })(),
  );
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "ParkFi", {
      body: data.body ?? "",
      icon: "/img/brand/yellow_white_marker.webp",
      badge: "/img/brand/full_white.webp",
      data: { url: data.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      const url = event.notification.data?.url ?? "/";
      for (const client of windowClients) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    }),
  );
});
