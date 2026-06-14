// ════════════════════════════════════════════════════════════════════════════
//  BarInventory — Service Worker v2.4
//  Estrategia: Cache-First para assets estáticos, Network-First para Firebase.
//  Garantiza funcionamiento offline y actualizaciones automáticas al deployar.
//
//  CORRECCIONES v2.3 (heredadas):
//  - SW1: OFFLINE_URL ahora usa ruta calculada desde el scope real del SW.
//  - SW2: Separado 'googleapis.com' genérico del más específico 'fonts.googleapis.com'.
//  - SW3: staleWhileRevalidate retorna la promesa de red correctamente.
//  - SW4: Ambas estrategias de caché filtran respuestas opacas (type !== 'opaque').
//  - SW5: notificationclick ahora usa la URL completa del evento cuando existe.
//  - SW6: PRECACHE_URLS normalizada — solo una entrada por URL canónica.
//  - SW7: install propaga el error con throw si addAll falla.
//
//  CORRECCIONES v2.4 (nuevas):
//  - SW8: OFFLINE_URL se calcula dinámicamente desde self.registration.scope
//         para funcionar correctamente tanto en la raíz como en subdirectorios.
//         La versión anterior ('/index.html') fallaba en despliegues en
//         subdirectorios porque nunca coincidía con el cache key relativo.
//  - SW9: Nuevo manejador CACHE_ICONS en el listener 'message'. El manifest.json
//         apunta a icons/icon-192.png e icons/icon-512.png que no existen como
//         archivos físicos en el repositorio. Sin este fix el browser recibe 404
//         al validar los iconos del manifest y la instalación PWA falla silenciosamente.
//         Solución: la página genera los íconos con Canvas y los envía al SW vía
//         postMessage; el SW los guarda en caché como Responses con el Content-Type
//         correcto. Cuando el browser pide los íconos del manifest, el SW los sirve
//         desde caché. Incluye ruta de fetch (SW10) para interceptar esas URLs.
//  - SW10: Nuevo handler fetch para las rutas de íconos PWA (icons/icon-*.png).
//          Sirve desde caché si existe; si no, genera un PNG mínimo usando
//          OffscreenCanvas (soportado en Chrome 69+ / Android 9+) como fallback
//          para evitar un 404 aunque la página aún no haya enviado los íconos.
// ════════════════════════════════════════════════════════════════════════════

const CACHE_NAME = 'barinventory-v2.4';

// SW8 FIX: OFFLINE_URL calculado desde el scope del SW en tiempo de ejecución.
// self.registration.scope es la URL base del SW (ej. 'https://host/bar/').
// Concatenando 'index.html' obtenemos la URL canónica exacta que fue cacheada
// en PRECACHE_URLS con './index.html', evitando la desincronización entre
// '/index.html' (absoluta) y './index.html' (relativa al scope).
// Se inicializa en '' y se asigna en el evento 'activate' cuando el scope
// ya está disponible. Para el fallback offline se usa el scope directamente.
let OFFLINE_URL = '';

// Assets que se cachean en la instalación (shell de la app)
const PRECACHE_URLS = [
    './index.html',
    './manifest.json',
];

// Dominios que NUNCA se cachean (siempre van a la red)
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
                console.error('[SW] Error crítico en precache — abortando instalación:', err);
                throw err;
            })
    );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
    console.info('[SW] Activando — limpiando cachés viejos…');

    // SW8 FIX: Calcular OFFLINE_URL usando el scope real una vez que el SW está activo.
    // self.registration.scope siempre termina en '/', por lo que concatenamos 'index.html'.
    // Ejemplo raíz:        'https://example.com/'          → 'https://example.com/index.html'
    // Ejemplo subdirectorio: 'https://example.com/bar/'    → 'https://example.com/bar/index.html'
    OFFLINE_URL = self.registration.scope + 'index.html';
    console.info('[SW] OFFLINE_URL calculado:', OFFLINE_URL);

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

    // SW10 FIX: Interceptar rutas de íconos PWA del manifest.
    // icons/icon-192.png e icons/icon-512.png no existen como archivos físicos;
    // el SW los sirve desde el caché donde la página los guardó via CACHE_ICONS.
    // Si todavía no están en caché (primera carga antes de que la página los envíe),
    // intentamos generarlos con OffscreenCanvas o devolvemos un PNG mínimo hardcoded.
    if (url.pathname.endsWith('/icon-192.png') || url.pathname.endsWith('/icon-512.png')) {
        event.respondWith(serveIcon(event.request, url));
        return;
    }

    // 4. CDNs de terceros → Cache-First con fallback a red
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

function isCacheable(response) {
    return response &&
           response.status === 200 &&
           response.type !== 'opaque';
}

function cacheFirst(request) {
    return caches.match(request).then(function(cached) {
        if (cached) return cached;
        return fetch(request).then(function(response) {
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
        if (cached) return cached;
        return networkPromise.catch(function() {
            // SW8 FIX: OFFLINE_URL ya tiene la URL absoluta correcta en todos los entornos.
            return caches.match(OFFLINE_URL);
        });
    });
}

// ── MANEJO DE ÍCONOS PWA (SW9 / SW10) ───────────────────────────────────────

/**
 * Sirve un ícono PWA para las rutas icons/icon-192.png e icons/icon-512.png.
 * Orden de prioridad:
 *   1. Cache (colocado por CACHE_ICONS desde la página principal)
 *   2. OffscreenCanvas generado en el SW (fallback, Chrome 69+)
 *   3. PNG 1×1 transparente como último recurso (evita el 404)
 */
function serveIcon(request, url) {
    return caches.match(request).then(function(cached) {
        if (cached) {
            console.info('[SW] Ícono servido desde caché:', url.pathname);
            return cached;
        }
        // Fallback: intentar generar el ícono con OffscreenCanvas
        var size = url.pathname.includes('192') ? 192 : 512;
        return generateIconResponse(size).catch(function() {
            // Último recurso: PNG 1×1 transparente (evita 404 rompiendo instalabilidad)
            var tiny1x1PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            return new Response(
                Uint8Array.from(atob(tiny1x1PNG), function(c) { return c.charCodeAt(0); }),
                { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } }
            );
        });
    });
}

/**
 * Genera un PNG de `size`×`size` con OffscreenCanvas (Chrome 69+ / Android 9+).
 * Mismo diseño que la función makeIcon() de la página principal.
 * @param {number} size
 * @returns {Promise<Response>}
 */
function generateIconResponse(size) {
    return new Promise(function(resolve, reject) {
        try {
            var canvas = new OffscreenCanvas(size, size);
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#0A84FF';
            try { ctx.roundRect(0, 0, size, size, size * 0.22); }
            catch(_) { ctx.rect(0, 0, size, size); }
            ctx.fill();
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold ' + Math.round(size * 0.52) + 'px system-ui,sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('B', size / 2, size / 2 + size * 0.03);
            canvas.convertToBlob({ type: 'image/png' }).then(function(blob) {
                resolve(new Response(blob, {
                    status: 200,
                    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
                }));
            }).catch(reject);
        } catch(e) {
            reject(e);
        }
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

    // SW9 FIX: Recibir íconos PWA generados por Canvas en la página principal
    // y almacenarlos en caché con las URLs exactas del manifest.json.
    // La página genera los PNG via Canvas (que sí existe en el DOM) y los envía
    // como data URLs; el SW los convierte en Responses con Content-Type correcto
    // y los guarda bajo las rutas que el browser va a pedir al validar el manifest.
    if (event.data.type === 'CACHE_ICONS') {
        var scope   = self.registration.scope;
        var icons   = [
            { key: scope + 'icons/icon-192.png', dataUrl: event.data.icon192 },
            { key: scope + 'icons/icon-512.png', dataUrl: event.data.icon512 },
        ];

        caches.open(CACHE_NAME).then(function(cache) {
            icons.forEach(function(icon) {
                if (!icon.dataUrl || !icon.dataUrl.startsWith('data:image/png;base64,')) return;
                try {
                    var base64 = icon.dataUrl.split(',')[1];
                    var binary = atob(base64);
                    var bytes  = new Uint8Array(binary.length);
                    for (var i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }
                    var response = new Response(bytes.buffer, {
                        status:  200,
                        headers: {
                            'Content-Type':  'image/png',
                            'Cache-Control': 'public, max-age=86400'
                        }
                    });
                    cache.put(icon.key, response)
                        .then(function() {
                            console.info('[SW] Ícono PWA cacheado:', icon.key);
                        });
                } catch(e) {
                    console.warn('[SW] Error convirtiendo ícono a Response:', icon.key, e);
                }
            });
        });
    }
});
