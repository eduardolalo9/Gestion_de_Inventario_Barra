// ════════════════════════════════════════════════════════════════════════════
//  BarInventory — Service Worker v2.1
//  Estrategia: Cache-First para assets estáticos, Network-First para Firebase.
//  Garantiza funcionamiento offline y actualizaciones automáticas al deployar.
// ════════════════════════════════════════════════════════════════════════════

const CACHE_NAME    = 'barinventory-v2.1';
const OFFLINE_URL   = './index.html';

// Assets que se cachean en la instalación (shell de la app)
const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    // CDNs críticos — se cachean en primera visita (runtime cache)
];

// Dominios que NUNCA se cachean (siempre van a la red)
const NETWORK_ONLY_ORIGINS = [
    'firestore.googleapis.com',
    'firebase.googleapis.com',
    'securetoken.googleapis.com',
    'identitytoolkit.googleapis.com',
    'firebaseio.com',
    'googleapis.com',
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
    console.info('[SW] Instalando v' + CACHE_NAME);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) {
                return cache.addAll(PRECACHE_URLS);
            })
            .then(function() {
                // Activar inmediatamente sin esperar a que cierren las pestañas anteriores
                return self.skipWaiting();
            })
            .catch(function(err) {
                console.warn('[SW] Error en precache:', err);
            })
    );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
    console.info('[SW] Activando — limpiando cachés viejos…');
    event.waitUntil(
        caches.keys()
            .then(function(cacheNames) {
                return Promise.all(
                    cacheNames
                        .filter(function(name) { return name !== CACHE_NAME; })
                        .map(function(name) {
                            console.info('[SW] Eliminando caché obsoleto:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(function() {
                // Tomar control de todas las pestañas abiertas inmediatamente
                return self.clients.claim();
            })
    );
});

// ── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
    const url = new URL(event.request.url);

    // 1. Ignorar peticiones que no son GET
    if (event.request.method !== 'GET') return;

    // 2. Ignorar extensiones de Chrome y protocolos especiales
    if (!event.request.url.startsWith('http')) return;

    // 3. Firebase / APIs externas → SIEMPRE red (nunca cachear datos de Firestore)
    if (NETWORK_ONLY_ORIGINS.some(function(origin) { return url.hostname.includes(origin); })) {
        return; // dejar que el browser maneje normalmente
    }

    // 4. Tailwind CDN y otros CDNs → Cache-First con fallback a red
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

    // 5. Assets propios de la app (index.html, manifest.json, etc.)
    //    Estrategia: Stale-While-Revalidate — sirve del caché y actualiza en background
    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(event.request));
        return;
    }
});

// ── ESTRATEGIAS DE CACHÉ ─────────────────────────────────────────────────────

/**
 * Cache-First: Sirve del caché; si no está, va a la red y lo cachea.
 * Ideal para assets estáticos de CDN que no cambian.
 */
function cacheFirst(request) {
    return caches.match(request).then(function(cached) {
        if (cached) return cached;
        return fetch(request).then(function(response) {
            if (response && response.status === 200) {
                var clone = response.clone();
                caches.open(CACHE_NAME).then(function(cache) {
                    cache.put(request, clone);
                });
            }
            return response;
        }).catch(function() {
            return new Response('', { status: 503, statusText: 'Sin conexión' });
        });
    });
}

/**
 * Stale-While-Revalidate: Sirve del caché inmediatamente mientras
 * actualiza en background. Ideal para el shell de la app.
 */
function staleWhileRevalidate(request) {
    var fetchPromise = fetch(request).then(function(response) {
        if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
                cache.put(request, clone);
            });
        }
        return response;
    }).catch(function() { return null; });

    return caches.match(request).then(function(cached) {
        // Si hay caché → devolver inmediatamente; la red actualiza en background
        if (cached) return cached;
        // Si no hay caché → esperar a la red
        return fetchPromise.then(function(response) {
            if (response) return response;
            // Sin red y sin caché → página offline
            return caches.match(OFFLINE_URL);
        });
    });
}

// ── BACKGROUND SYNC ──────────────────────────────────────────────────────────
// Cuando el navegador recupera conexión, avisar a la app para que suba
// los cambios pendientes a Firestore.
self.addEventListener('sync', function(event) {
    if (event.tag === 'sync-inventario') {
        event.waitUntil(notifyClientsToSync());
    }
});

function notifyClientsToSync() {
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(function(clients) {
            clients.forEach(function(client) {
                client.postMessage({ type: 'SYNC_PENDING' });
            });
        });
}

// ── PUSH NOTIFICATIONS (futuro) ──────────────────────────────────────────────
self.addEventListener('push', function(event) {
    if (!event.data) return;
    var data = {};
    try { data = event.data.json(); } catch(e) { data = { title: 'BarInventory', body: event.data.text() }; }

    event.waitUntil(
        self.registration.showNotification(data.title || 'BarInventory', {
            body:    data.body    || 'Tienes una actualización pendiente',
            icon:    data.icon    || './manifest.json',
            badge:   data.badge   || '',
            vibrate: [200, 100, 200],
            data:    data.url ? { url: data.url } : {}
        })
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    var targetUrl = (event.notification.data && event.notification.data.url) || './';
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(function(clients) {
            for (var i = 0; i < clients.length; i++) {
                if (clients[i].url.includes(targetUrl) && 'focus' in clients[i]) {
                    return clients[i].focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});

// ── MENSAJE DESDE LA APP ─────────────────────────────────────────────────────
self.addEventListener('message', function(event) {
    if (!event.data) return;

    if (event.data.type === 'SKIP_WAITING') {
        // La app pide activar la nueva versión inmediatamente
        self.skipWaiting();
    }

    if (event.data.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
        // La app pide pre-cachear URLs adicionales
        caches.open(CACHE_NAME).then(function(cache) {
            cache.addAll(event.data.urls).catch(function(e) {
                console.warn('[SW] Error cacheando URLs adicionales:', e);
            });
        });
    }
    // IMPORTANTE: No retornar true — evita el error "message channel closed"
});
