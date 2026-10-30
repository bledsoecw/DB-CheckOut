// The retired DB Close Out app installed a service worker that cached the
// whole app. This replaces it on any phone that still has it: the browser
// fetches this file the next time the old app opens, and it clears the old
// caches, unregisters itself and reloads the page, which is now the notice
// that Close Out lives in DB Crew. Nothing registers a worker any more.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});
