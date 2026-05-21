const SCOREPAD_CACHE = "riftlite-scorepad-shell-v1";

const SHELL_URLS = [
  "/scorepad",
  "/manifest.webmanifest",
  "/brand/riftlite-logo-transparent.png",
  "/brand/riftlite-logo-transparent.webp",
  "/brand/riftlite-logo-ui.png",
  "/brand/riftlite-logo-ui.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SCOREPAD_CACHE)
      .then((cache) => Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SCOREPAD_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate" && url.pathname.startsWith("/scorepad")) {
    event.respondWith(networkFirst(request, "/scorepad"));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(cacheFirst(request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SCOREPAD_CACHE);
    cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SCOREPAD_CACHE);
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    return await caches.match(request) || await caches.match(fallbackUrl) || Response.error();
  }
}
