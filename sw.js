// ============================================================
// SERVICE WORKER — BarInventory
// Versión: 1.0.0
// ============================================================

const CACHE_NAME = 'bar-inventory-v2';
const CACHE_VERSION = 'v1.1.0';

// Archivos que se guardan para funcionar sin internet
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json'
];

// ── Instalación ──────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Instalando versión:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Guardando archivos en caché');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Error en caché:', err))
  );
});

// ── Activación ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activado:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Borrando caché viejo:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ── Interceptar peticiones ───────────────────────────────────
self.addEventListener('fetch', event => {
  // Solo interceptar peticiones GET
  if (event.request.method !== 'GET') return;

  // No interceptar peticiones a Firebase
  const url = event.request.url;
  if (
    url.includes('firebaseio.com') ||
    url.includes('googleapis.com') ||
    url.includes('firestore.googleapis.com') ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('cdnjs.cloudflare.com') ||
    url.includes('cdn.tailwindcss.com') ||
    url.includes('gstatic.com') ||
    url.includes('kit.fontawesome.com') ||
    url.includes('use.fontawesome.com') ||
    url.includes('fonts.googleapis.com') ||
    url.includes('fonts.gstatic.com')
  ) {
    return; // No cachear CDNs externos — siempre pedir versión fresca
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) {
          // Devolver caché y actualizar en segundo plano
          fetch(event.request)
            .then(response => {
              if (response && response.status === 200) {
                caches.open(CACHE_NAME)
                  .then(cache => cache.put(event.request, response));
              }
            })
            .catch(() => {}); // Sin conexión — ignorar
          return cached;
        }

        // No está en caché — pedir a la red
        return fetch(event.request)
          .then(response => {
            if (!response || response.status !== 200) return response;
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, responseClone));
            return response;
          })
          .catch(() => {
            // Sin conexión y sin caché
            if (event.request.destination === 'document') {
              return caches.match('./index.html');
            }
          });
      })
  );
});

// ── Mensajes desde la app ────────────────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});