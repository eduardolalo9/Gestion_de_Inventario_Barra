/* ================================================================
   BarInventory — Service Worker v3
   Estrategia: Cache-First para assets, Network-First para Firebase
   ================================================================ */

const SW_VERSION   = 'barinventory-v3';
const STATIC_CACHE = SW_VERSION + '-static';
const DYNAMIC_CACHE = SW_VERSION + '-dynamic';
const FONT_CACHE   = SW_VERSION + '-fonts';

/* Assets que se cachean en el install (app shell) */
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/apple-touch-icon.png',
];

/* Dominios que van SIEMPRE a la red (Firebase, APIs externas) */
const NETWORK_ONLY_PATTERNS = [
  'firebaseio.com',
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'googleapis.com/identitytoolkit',
  'googleapis.com/token',
];

/* Dominios de fuentes → cache agresivo */
const FONT_PATTERNS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

/* Tamaño máximo del cache dinámico */
const MAX_DYNAMIC_ITEMS = 60;

/* ── Helpers ── */
const isNetworkOnly = (url) =>
  NETWORK_ONLY_PATTERNS.some(p => url.includes(p));

const isFontRequest = (url) =>
  FONT_PATTERNS.some(p => url.includes(p));

const isStaticAsset = (url) =>
  /\.(png|jpg|jpeg|webp|svg|ico|woff2?|ttf|eot)$/i.test(url) ||
  url.includes('cdnjs.cloudflare.com') ||
  url.includes('cdn.tailwindcss.com');

async function limitCacheSize(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    await limitCacheSize(cacheName, maxItems);
  }
}

/* ══════════════════════════════════════════
   INSTALL — Pre-cache app shell
   ══════════════════════════════════════════ */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Pre-caching app shell…');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => {
        console.warn('[SW] Pre-cache partial failure (OK):', err.message);
        return self.skipWaiting();
      })
  );
});

/* ══════════════════════════════════════════
   ACTIVATE — Limpieza de caches viejos
   ══════════════════════════════════════════ */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('barinventory-') && k !== STATIC_CACHE && k !== DYNAMIC_CACHE && k !== FONT_CACHE)
          .map(k => {
            console.log('[SW] Borrando cache antiguo:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ══════════════════════════════════════════
   FETCH — Estrategias de cache
   ══════════════════════════════════════════ */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = request.url;

  /* Solo GET */
  if (request.method !== 'GET') return;
  /* Solo http/https */
  if (!url.startsWith('http')) return;

  /* ── 1. Firebase / APIs → SIEMPRE red (nunca cachear) ── */
  if (isNetworkOnly(url)) return;

  /* ── 2. Fuentes → Cache-First agresivo (1 año) ── */
  if (isFontRequest(url)) {
    event.respondWith(
      caches.open(FONT_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          return new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  /* ── 3. App shell (index.html) → Network-First con fallback ── */
  if (url.endsWith('index.html') || url.endsWith('/') || url === self.location.origin + '/') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then(c => c.put(request, clone));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  /* ── 4. Assets estáticos (CDN, imágenes, iconos) → Cache-First ── */
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            caches.open(STATIC_CACHE).then(c => c.put(request, response.clone()));
          }
          return response;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  /* ── 5. Resto → Stale-While-Revalidate ── */
  event.respondWith(
    caches.match(request).then(async cached => {
      const fetchPromise = fetch(request)
        .then(response => {
          if (response.ok) {
            caches.open(DYNAMIC_CACHE).then(cache => {
              cache.put(request, response.clone());
              limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_ITEMS);
            });
          }
          return response;
        })
        .catch(() => cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }));

      return cached || fetchPromise;
    })
  );
});

/* ══════════════════════════════════════════
   MESSAGE — Comunicación con la app
   ══════════════════════════════════════════ */
self.addEventListener('message', event => {
  const { type } = event.data || {};

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: SW_VERSION });
  }

  if (type === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('barinventory-')).map(k => caches.delete(k)))
    ).then(() => {
      event.ports[0]?.postMessage({ ok: true });
    });
  }
});

/* ══════════════════════════════════════════
   PUSH NOTIFICATIONS (base para futuro)
   ══════════════════════════════════════════ */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json().catch(() => ({ title: 'BarInventory', body: event.data.text() }));
  event.waitUntil(
    data.then(d =>
      self.registration.showNotification(d.title || 'BarInventory', {
        body: d.body || '',
        icon: './icons/icon-192x192.png',
        badge: './icons/icon-72x72.png',
        vibrate: [100, 50, 100],
        data: { url: d.url || './' },
      })
    )
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const existing = wins.find(w => w.url.includes('index.html') || w.url === url);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});

console.log('[SW] BarInventory Service Worker', SW_VERSION, 'loaded');
