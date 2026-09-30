// Service Worker: офлайн-кэш статики (Firestore сам кэширует данные в IndexedDB)
const CACHE = "nexus-v2.1";
const ASSETS = [
  "./", "index.html", "product.html", "cart.html", "profile.html", "admin.html", "auth.html", "404.html",
  "css/style.css", "manifest.webmanifest", "img/icon-192.png",
  "js/firebase-config.js", "js/core/firebase.js", "js/core/config.js", "js/core/session.js", "js/core/ui.js", "js/core/actions.js",
  "js/db/products.js", "js/db/cart.js", "js/db/orders.js", "js/db/reviews.js", "js/db/users.js", "js/db/seed.js",
  "js/pages/index.js", "js/pages/notfound.js", "js/pages/product.js", "js/pages/cart.js", "js/pages/profile.js", "js/pages/admin.js", "js/pages/auth.js",
  "js/sdk/app.js", "js/sdk/auth.js", "js/sdk/firestore.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Стратегия «сеть, при ошибке — кэш» для своих файлов и SDK Firebase; запросы к API Firebase не трогаем
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const own = url.origin === location.origin;
  const sdk = url.hostname === "www.gstatic.com" || url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com");
  if (!own && !sdk) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: own }).then(r => r || caches.match("404.html")))
  );
});
