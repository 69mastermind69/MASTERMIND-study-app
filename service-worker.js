
"use strict";

/*
 * MASTERMIND Study App
 * Updated service worker
 * Cache version: v2
 */

const CACHE_NAME = "mastermind-study-v2";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

/* Install the new cache */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

/* Activate new worker and remove old app caches */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key =>
            key.startsWith("mastermind-study-") &&
            key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/* Serve updated files from network, with offline fallback */
self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    try {
      const response = await fetch(request);

      if (response && response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }

      return response;
    } catch (error) {
      const cached = await cache.match(request);

      if (cached) return cached;

      if (request.mode === "navigate") {
        const home = await cache.match("./index.html");
        if (home) return home;
      }

      return new Response(
        "অফলাইন আছো। এই ফাইলটি আগে ক্যাশে সংরক্ষিত ছিল না।",
        {
          status: 503,
          headers: {
            "Content-Type": "text/plain; charset=utf-8"
          }
        }
      );
    }
  })());
});
