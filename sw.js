// ════════════════════════════════════════════════════════════════════════════
//  BarInventory — Service Worker v3.1
//  CORRECCIÓN v3.1: PRECACHE_URLS actualizado con firebase-bundle.js
//  (antes referenciaba firebase-app/auth/firestore-compat.js que ya no existen)
// ════════════════════════════════════════════════════════════════════════════

const CACHE_NAME  = 'barinventory-v3.1';
const OFFLINE_URL = '/index.html';

const PRECACHE_URLS = [
    './index.html',
    './manifest.json',
    './xlsx.full.min.js',
    './firebase-bundle.js',   // FIX v3.1: bundle unificado en lugar de 3 archivos separados
];

const NETWORK_ONLY_ORIGINS = [
    'firestore.googleapis.com',
    'firebase.googleapis.com',
    'securetoken.googleapis.com',
    'identitytoolkit.googleapis.com',
    'firebaseio.com',
];

self.addEventListener('install', function(event) {
    console.info('[SW] Instalando v' + CACHE_NAME);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) { return cache.addAll(PRECACHE_URLS); })
            .then(function() { return self.skipWaiting(); })
            .catch(function(err) {
                console.error('[SW] Error crítico en precache:', err);
                throw err;
            })
    );
});

self.addEventListener('activate', function(event) {
    console.info('[SW] Activando — limpiando cachés viejos…');
    event.waitUntil(
        caches.keys()
            .then(function(cacheNames) {
                return Promise.all(
                    cacheNames
                        .filter(function(name) { return name !== CACHE_NAME; })
                        .map(function(name) { return caches.delete(name); })
                );
            })
            .then(function() { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function(event) {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET') return;
    if (!event.request.url.startsWith('http')) return;
    if (NETWORK_ONLY_ORIGINS.some(function(o) { return url.hostname.includes(o); })) return;
    if (url.hostname.includes('cdn.tailwindcss.com') ||
        url.hostname.includes('cdnjs.cloudflare.com') ||
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com') ||
        url.hostname.includes('kit.fontawesome.com') ||
        url.hostname.includes('use.fontawesome.com') ||
        url.hostname.includes('www.gstatic.com')) {
        event.respondWith(cacheFirst(event.request));
        return;
    }
    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(event.request));
        return;
    }
});

function isCacheable(r) { return r && r.status === 200 && r.type !== 'opaque'; }

function cacheFirst(request) {
    return caches.match(request).then(function(cached) {
        if (cached) return cached;
        return fetch(request).then(function(response) {
            if (isCacheable(response)) {
                var clone = response.clone();
                caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
            }
            return response;
        }).catch(function() { return new Response('', { status: 503 }); });
    });
}

function staleWhileRevalidate(request) {
    var net = fetch(request).then(function(response) {
        if (isCacheable(response)) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
        }
        return response;
    });
    return caches.match(request).then(function(cached) {
        return cached || net.catch(function() { return caches.match(OFFLINE_URL); });
    });
}

self.addEventListener('sync', function(event) {
    if (event.tag === 'sync-inventario') {
        event.waitUntil(
            self.clients.matchAll({ type: 'window', includeUncontrolled: true })
                .then(function(clients) {
                    clients.forEach(function(c) { c.postMessage({ type: 'SYNC_PENDING' }); });
                })
        );
    }
});

self.addEventListener('push', function(event) {
    if (!event.data) return;
    var data = {};
    try { data = event.data.json(); } catch(e) { data = { title: 'BarInventory', body: event.data.text() }; }
    event.waitUntil(
        self.registration.showNotification(data.title || 'BarInventory', {
            body: data.body || 'Tienes una actualización pendiente',
            icon: data.icon || './icons/icon-192.png',
            badge: data.badge || '',
            vibrate: [200, 100, 200],
            data: data.url ? { url: data.url } : {}
        })
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    var targetUrl = (event.notification.data && event.notification.data.url)
        ? event.notification.data.url : self.registration.scope;
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(function(clients) {
            for (var i = 0; i < clients.length; i++) {
                if (clients[i].url === targetUrl && 'focus' in clients[i]) return clients[i].focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        })
    );
});

self.addEventListener('message', function(event) {
    if (!event.data) return;
    if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
    if (event.data.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
        caches.open(CACHE_NAME).then(function(cache) {
            cache.addAll(event.data.urls).catch(function(e) {
                console.warn('[SW] Error cacheando URLs adicionales:', e);
            });
        });
    }
});
