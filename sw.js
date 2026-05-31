// ════════════════════════════════════════════════════════════════════════════
//  BarInventory — Service Worker v2.3
//  Estrategia: Cache-First para assets estáticos, Network-First para Firebase.
//  Garantiza funcionamiento offline y actualizaciones automáticas al deployar.
//
//  CORRECCIONES v2.3:
//  - SW1: OFFLINE_URL ahora usa ruta absoluta desde el scope para evitar
//         resolución incorrecta en sub-directorios.
//  - SW2: Separado 'googleapis.com' genérico del más específico 'fonts.googleapis.com'
//         para que las fuentes Google se cacheen correctamente.
//  - SW3: staleWhileRevalidate retorna la promesa de red correctamente cuando
//         no hay caché, sin posibilidad de devolver null silenciosamente.
//  - SW4: Ambas estrategias de caché filtran respuestas opacas (type !== 'opaque')
//         para no cachear errores 0 de CORS que bloquean recursos críticos.
//  - SW5: notificationclick ahora usa la URL completa del evento cuando existe.
//  - SW6: PRECACHE_URLS normalizada — solo una entrada por URL canónica.
//  - SW7: install propaga el error con throw si addAll falla, forzando reintentar.
// ════════════════════════════════════════════════════════════════════════════

const CACHE_NAME    = 'barinventory-v2.3';
const OFFLINE_URL   = '/index.html';

// Assets que se cachean en la instalación (shell de la app)
// BUG-SW6 FIX: eliminada entrada duplicada './' — solo './index.html' es canónica.
const PRECACHE_URLS = [
    './index.html',
    './manifest.json',
];

// Dominios que NUNCA se cachean (siempre van a la red)
// BUG-SW2 FIX: eliminado 'googleapis.com' genérico que bloqueaba caché de fonts.
// Ahora solo se listan los dominios de la API de Firebase/Google específicos.
const NETWORK_ONLY_ORIGINS = [
    'firestore.googleapis.com',
    'firebase.googleapis.com',
    'securetoken.googleapis.com',
    'identitytoolkit.googleapis.com',
    'firebaseio.com',
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
                return self.skipWaiting();
            })
            .catch(function(err) {
                // BUG-SW7 FIX: relanzar el error para que el SW no quede instalado roto.
                // El navegador reintentará la instalación en la próxima carga.
                console.error('[SW] Error crítico en precache — abortando instalación:', err);
                throw err;
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

    // 3. Firebase / APIs de auth → SIEMPRE red (nunca cachear tokens ni datos Firestore)
    if (NETWORK_ONLY_ORIGINS.some(function(origin) { return url.hostname.includes(origin); })) {
        return;
    }

    // 4. CDNs de terceros → Cache-First con fallback a red
    //    BUG-SW2 FIX: fonts.googleapis.com y fonts.gstatic.com se cachean correctamente
    //    ya que se quitaron de NETWORK_ONLY_ORIGINS.
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

    // 5. Assets propios de la app → Stale-While-Revalidate
    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(event.request));
        return;
    }
});

// ── ESTRATEGIAS DE CACHÉ ─────────────────────────────────────────────────────

// BUG-SW4 FIX: helper que solo cachea respuestas válidas y NO opacas.
// Una respuesta 'opaque' (type === 'opaque') puede encubrir un error HTTP real
// con status 0 — cachearla podría servir un error de CORS como recurso válido.
function isCacheable(response) {
    return response &&
           response.status === 200 &&
           response.type !== 'opaque';
}

function cacheFirst(request) {
    return caches.match(request).then(function(cached) {
        if (cached) return cached;
        return fetch(request).then(function(response) {
            // BUG-SW4 FIX: solo cachear respuestas válidas y no opacas
            if (isCacheable(response)) {
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

function staleWhileRevalidate(request) {
    // BUG-SW3 FIX: la promesa de red se lanza siempre en paralelo y se espera
    // correctamente cuando no hay caché, en lugar de retornar null silenciosamente.
    var networkPromise = fetch(request).then(function(response) {
        if (isCacheable(response)) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
                cache.put(request, clone);
            });
        }
        return response;
    });

    return caches.match(request).then(function(cached) {
        // Devolver caché inmediatamente si existe (stale); la red actualizará en segundo plano.
        // Si no hay caché, esperar la red; si la red falla, servir la página offline.
        if (cached) return cached;
        return networkPromise.catch(function() {
            return caches.match(OFFLINE_URL);
        });
    });
}

// ── BACKGROUND SYNC ──────────────────────────────────────────────────────────
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

// ── PUSH NOTIFICATIONS ───────────────────────────────────────────────────────
self.addEventListener('push', function(event) {
    if (!event.data) return;
    var data = {};
    try { data = event.data.json(); } catch(e) { data = { title: 'BarInventory', body: event.data.text() }; }

    event.waitUntil(
        self.registration.showNotification(data.title || 'BarInventory', {
            body:    data.body    || 'Tienes una actualización pendiente',
            icon:    data.icon    || './icons/icon-192.png',
            badge:   data.badge   || '',
            vibrate: [200, 100, 200],
            data:    data.url ? { url: data.url } : {}
        })
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    // BUG-SW5 FIX: usar la URL del payload si existe; fallback a la raíz del scope,
    // no a './' relativo que puede resolver incorrectamente en sub-directorios.
    var targetUrl = (event.notification.data && event.notification.data.url)
        ? event.notification.data.url
        : self.registration.scope;

    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(function(clients) {
            for (var i = 0; i < clients.length; i++) {
                if (clients[i].url === targetUrl && 'focus' in clients[i]) {
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
        self.skipWaiting();
    }

    if (event.data.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
        caches.open(CACHE_NAME).then(function(cache) {
            cache.addAll(event.data.urls).catch(function(e) {
                console.warn('[SW] Error cacheando URLs adicionales:', e);
            });
        });
    }
});

