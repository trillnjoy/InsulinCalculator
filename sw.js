/* =============================================================================
 *  Insulin Dose Calculator — Service Worker
 *
 *  VERSION CONTROL / CACHE BUSTING
 *  --------------------------------
 *  Bump VERSION on every deploy. The cache key is derived from it, so a new
 *  version creates a fresh cache and the `activate` handler deletes every older
 *  `insulin-calc-*` cache. Clients get the new assets on their next load.
 *
 *  STRATEGY
 *  --------
 *  · Navigations / HTML  -> network-first (the freshest deployed calculator wins
 *                           when online; falls back to cache when offline).
 *  · Static assets       -> cache-first (the VERSION bump is what invalidates them).
 *  · Non-GET / cross-origin (e.g. the optional result webhook) -> passthrough.
 * ===========================================================================*/

const VERSION = "v1.1.0";
const CACHE = `insulin-calc-${VERSION}`;

// App shell — fully self-contained, no external assets.
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./insulin_calc_192.png",
  "./insulin_calc_512.png",
  "./Insulin_Calc_Parameters.pdf"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache each entry independently so one missing/renamed file can't fail the install.
    await Promise.allSettled(PRECACHE.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith("insulin-calc-") && k !== CACHE)
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;                    // ignore POSTs (webhook, etc.)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // same-origin only

  // Static files (PDF, icons, manifest, etc.) are cache-first even when opened
  // as a top-level navigation — e.g. the parameter grid PDF in a new tab — so an
  // offline open serves the file, not the app-shell HTML fallback.
  if (/\.(pdf|png|jpe?g|svg|gif|webp|css|js|json|webmanifest|ico|woff2?|ttf)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  const isHTML = req.mode === "navigate" ||
                 (req.headers.get("accept") || "").includes("text/html");

  event.respondWith(isHTML ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req){
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    return (await cache.match(req)) ||
           (await cache.match("./index.html")) ||
           (await cache.match("./")) ||
           Response.error();
  }
}

async function cacheFirst(req){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    return cached || Response.error();
  }
}

// Page <-> worker messaging: version readout + optional immediate update.
self.addEventListener("message", event => {
  if (event.data === "GET_VERSION" && event.source) {
    event.source.postMessage({ type: "VERSION", version: VERSION });
  }
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
