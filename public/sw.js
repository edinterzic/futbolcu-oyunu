/* PairFC Service Worker
   - Offline-capable app shell (Guideline 4.2 için kritik)
   - Network-only: Supabase (API + realtime) ve PostHog (analitik) — asla cache'lenmez
   - Navigation: network-first, offline'da cache'lenmiş app shell'e düşer
   - Statik varlıklar: stale-while-revalidate
   - Web Push + notificationclick hazır
*/

const VERSION = "v2";
const CACHE = `pairfc-${VERSION}`;

// İlk yüklemede önbelleğe alınacak temel dosyalar
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/maskable-icon-512.png",
  "/og-image.png",
];

// Bu host'lara giden istekler ASLA cache'lenmez (canlı veri + analitik)
const NETWORK_ONLY = ["supabase.co", "supabase.in", "posthog.com"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // allSettled: bir dosya 404 olsa bile install çökmesin
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // 1) Canlı veri / analitik → dokunma, tarayıcı normal halletsin
  if (NETWORK_ONLY.some((h) => url.hostname.includes(h))) return;

  // 2) Sayfa gezintisi (navigation) → network-first, offline'da app shell
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((c) => c || caches.match("/"))
        )
    );
    return;
  }

  // 3) Aynı origin statik varlıklar → stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 4) Çapraz origin (Google Fonts vb.) → stale-while-revalidate, best-effort
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && (res.status === 200 || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

/* ============== WEB PUSH ============== */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "PairFC", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "PairFC";
  const options = {
    body: data.body || "Yeni günlük bulmaca hazır! 5 yeni eşleşme seni bekliyor.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    lang: data.lang || "tr",
    tag: data.tag || "pairfc-daily",
    renotify: true,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        // Açık bir pencere varsa ona odaklan
        for (const client of list) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            if ("navigate" in client) client.navigate(target);
            return client.focus();
          }
        }
        // Yoksa yeni pencere aç
        if (clients.openWindow) return clients.openWindow(target);
      })
  );
});
