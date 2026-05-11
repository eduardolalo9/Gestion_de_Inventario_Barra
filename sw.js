// Nombre del caché
const CACHE_NAME = "inventario-cache-v1";

// Archivos críticos que se cachearán al instalar
const urlsToCache = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

// Instalar Service Worker y cachear archivos iniciales
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting(); // activa inmediatamente
});

// Activar y limpiar cachés antiguos
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim(); // toma control de todas las pestañas
});

// Interceptar peticiones y servir desde caché si está disponible
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      // Si está en caché, lo devuelve; si no, lo busca en la red
      return response || fetch(event.request).then(networkResponse => {
        // Cache dinámico: guarda nuevas respuestas
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      }).catch(() => {
        // Fallback offline: muestra un HTML básico si no hay conexión
        if (event.request.destination === "document") {
          return caches.match("/index.html");
        }
      });
    })
  );
});
