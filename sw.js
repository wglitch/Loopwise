const CACHE_NAME = "loopwise-v3";
const APP_SHELL = [
  ".",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "assets/icon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});

self.addEventListener("push", (event) => {
  const fallback = {
    title: "Loopwise",
    body: "Dags att återvända till din loop."
  };
  const payload = event.data ? event.data.json() : fallback;

  event.waitUntil(self.registration.showNotification(payload.title || fallback.title, {
    body: payload.body || fallback.body,
    tag: payload.tag || "loopwise",
    icon: "assets/icon-192.png",
    badge: "assets/icon-192.png",
    data: payload.data || {}
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => "focus" in client);
      if (existing) return existing.focus();
      return self.clients.openWindow(".");
    })
  );
});
