// Remember's service worker: receives Web Push messages and shows a
// notification; focuses (or opens) the app when the notification is tapped.
//
// The push payload is the JSON our Worker encrypts (see src/worker/push):
//   { title, body, url }

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Remember", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Remember";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    data: { url: data.url || "/" },
    tag: data.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus an existing tab on the same origin if one is open.
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client && client.url !== url) {
            await client.navigate(url).catch(() => undefined);
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});

// Activate immediately on update so push handling stays current.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
