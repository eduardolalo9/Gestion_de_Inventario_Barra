// ════════════════════════════════════════════════════════════════════════════
//  BarInventory — Service Worker v2.4
//  Estrategia: Cache-First para assets estáticos, Network-First para Firebase.
//  Garantiza funcionamiento offline y actualizaciones automáticas al deployar.
//
//  CORRECCIONES v2.3 (heredadas):
//  ─ SW1: OFFLINE_URL usa ruta calculada desde el scope real (no '/index.html'
//         absoluta que falla en despliegues en subdirectorio).
//  ─ SW2: 'fonts.googleapis.com' separado de 'googleapis.com' genérico para
//         que las fuentes Google se cacheen correctamente.
//  ─ SW3: staleWhileRevalidate espera la promesa de red cuando no hay caché,
//         sin posibilidad de retornar null silenciosamente.
//  ─ SW4: Ambas estrategias filtran respuestas opacas (type === 'opaque')
//         para no cachear errores 0 de CORS que bloquearían recursos críticos.
//  ─ SW5: notificationclick usa la URL completa del payload cuando existe.
//  ─ SW6: PRECACHE_URLS sin entradas duplicadas.
//  ─ SW7: install relanza el error si addAll falla, forzando reintento.
//
//  CORRECCIONES v2.4 (nuevas):
//  ─ SW8: OFFLINE_URL calculado dinámicamente desde self.registration.scope
//         en el evento 'activate'. Antes, '/index.html' no coincidía con la
//         clave cacheada './index.html' cuando la app corría en subdirectorio,
//         haciendo que el fallback offline nunca funcionara.
//  ─ SW9: Manejador CACHE_ICONS en el listener 'message'. El manifest.json
//         referencia icons/icon-192.png e icons/icon-512.png que no existen
//         como archivos físicos. La página los genera via Canvas y los envía
//         al SW; el SW los convierte en Response PNG y los cachea. Resultado:
//         el browser valida los iconos del manifest → prompt de instalación OK.
//  ─ SW10: Handler fetch para rutas icons/icon-*.png. Sirve desde caché si
//         existen (puestos por SW9), o los genera con OffscreenCanvas como
//         fallback (Chrome 69+/Android 9+), o devuelve un PNG 1×1 transparente
//         como último recurso para evitar el 404 que bloquea la instalabilidad.
// ════════════════════════════════════════════════════════════════════════════

const CACHE_NAME = 'barinventory-v2.4';

// SW8: OFFLINE_URL se calcula en 'activate' desde el scope real.
// self.registration.scope termina en '/' → concatenar 'index.html' da la URL
// canónica exacta que cache.addAll(['./index.html']) registró como clave.
// Ejemplo raíz:        'https://host/'        → 'https://host/index.html'
// Ejemplo subdir:      'https://host/bar/'    → 'https://host/bar/index.html'
let OFFLINE_URL = '';

// Shell de la app: cacheada en install para disponibilidad offline inmediata.
const PRECACHE_URLS = [
    './index.html',
    './manifest.json',
];

// Dominios que van SIEMPRE a la red (tokens de auth, Firestore, tiempo real).
// NUNCA cachear respuestas de estos dominios.
const NETWORK_ONLY_ORIGINS = [
    'firestore.googleapis.com',
    'firebase.googleapis.com',
    'securetoken.googleapis.com',
    'identitytoolkit.googleapis.com',
    'firebaseio.com',
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
    console.info('[SW] Instalando', CACHE_NAME);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) { return cache.addAll(PRECACHE_URLS); })
            .then(function() { return self.skipWaiting(); })
            .catch(function(err) {
                // SW7: relanzar para que el navegador reintente la instalación.
                console.error('[SW] Error crítico en precache — abortando:', err);
                throw err;
            })
    );
});

// ── ACTIVATE ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
    console.info('[SW] Activando — limpiando cachés obsoletos…');

    // SW8: calcular OFFLINE_URL una vez que el scope está disponible.
    OFFLINE_URL = self.registration.scope + 'index.html';
    console.info('[SW] OFFLINE_URL =', OFFLINE_URL);

    event.waitUntil(
        caches.keys()
            .then(function(names) {
                return Promise.all(
                    names
                        .filter(function(n) { return n !== CACHE_NAME; })
                        .map(function(n) {
                            console.info('[SW] Eliminando caché obsoleto:', n);
                            return caches.delete(n);
                        })
                );
            })
            .then(function() { return self.clients.claim(); })
    );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
    var url = new URL(event.request.url);

    // 1. Solo interceptar GET.
    if (event.request.method !== 'GET') return;

    // 2. Solo interceptar HTTP/HTTPS.
    if (!event.request.url.startsWith('http')) return;

    // 3. Firebase / Auth APIs → siempre red, nunca cachear.
    if (NETWORK_ONLY_ORIGINS.some(function(o) { return url.hostname.includes(o); })) {
        return; // dejar pasar al navegador sin intervenir
    }

    // 4. SW10: Rutas de íconos PWA → servir desde caché o generar dinámicamente.
    //    icons/icon-192.png e icons/icon-512.png no existen como archivos físicos;
    //    el SW los sirve desde el caché donde la página los guardó (SW9) o los
    //    genera con OffscreenCanvas para evitar un 404 que bloquea la instalabilidad.
    if (url.pathname.endsWith('/icon-192.png') || url.pathname.endsWith('/icon-512.png')) {
        event.respondWith(serveIcon(event.request, url));
        return;
    }

    // 5. CDNs de terceros → Cache-First con fallback a red.
    //    SW2: fonts.googleapis.com ahora entra aquí (fue removido de NETWORK_ONLY).
    if (
        url.hostname.includes('cdn.tailwindcss.com')   ||
        url.hostname.includes('cdnjs.cloudflare.com')  ||
        url.hostname.includes('fonts.googleapis.com')  ||
        url.hostname.includes('fonts.gstatic.com')     ||
        url.hostname.includes('kit.fontawesome.com')   ||
        url.hostname.includes('use.fontawesome.com')   ||
        url.hostname.includes('www.gstatic.com')
    ) {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // 6. Assets propios → Stale-While-Revalidate (sirve caché, actualiza en fondo).
    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(event.request));
        return;
    }
});

// ── ESTRATEGIAS DE CACHÉ ──────────────────────────────────────────────────────

/**
 * SW4: Solo cachear respuestas 200 no opacas.
 * Una respuesta 'opaque' (status 0, type 'opaque') puede encubrir un error
 * real de CORS — cachearla serviría ese error como si fuera un recurso válido.
 */
function isCacheable(response) {
    return response && response.status === 200 && response.type !== 'opaque';
}

/** Cache-First: sirve caché si existe; si no, va a la red y cachea el resultado. */
function cacheFirst(request) {
    return caches.match(request).then(function(cached) {
        if (cached) return cached;
        return fetch(request).then(function(response) {
            if (isCacheable(response)) {
                var clone = response.clone();
                caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
            }
            return response;
        }).catch(function() {
            return new Response('', { status: 503, statusText: 'Sin conexión' });
        });
    });
}

/**
 * SW3: Stale-While-Revalidate corregido.
 * Lanza la petición de red inmediatamente (actualiza caché en segundo plano).
 * Devuelve la caché si existe (rápido), o espera la red si no hay caché.
 * Si red y caché fallan, devuelve la página offline.
 */
function staleWhileRevalidate(request) {
    var networkPromise = fetch(request).then(function(response) {
        if (isCacheable(response)) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
        }
        return response;
    });
    return caches.match(request).then(function(cached) {
        if (cached) return cached;
        // SW8: OFFLINE_URL tiene la URL canónica correcta en cualquier entorno.
        return networkPromise.catch(function() { return caches.match(OFFLINE_URL); });
    });
}

// ── ÍCONOS PWA DINÁMICOS (SW9 / SW10) ────────────────────────────────────────

/**
 * SW10: Sirve un ícono PWA para icons/icon-192.png o icons/icon-512.png.
 * Prioridad:
 *   1. Caché (puesto por CACHE_ICONS desde la página).
 *   2. OffscreenCanvas generado en el SW (Chrome 69+ / Android 9+).
 *   3. PNG 1×1 transparente como último recurso (evita 404 fatal).
 */
function serveIcon(request, url) {
    return caches.match(request).then(function(cached) {
        if (cached) return cached;
        var size = url.pathname.includes('192') ? 192 : 512;
        return generateIconPNG(size).catch(function() {
            // Último recurso: PNG 1×1 transparente para evitar 404
            var b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            var bytes = Uint8Array.from(atob(b64), function(c) { return c.charCodeAt(0); });
            return new Response(bytes, {
                status: 200,
                headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }
            });
        });
    });
}

/**
 * Genera un PNG cuadrado de `size`×`size` con OffscreenCanvas.
 * Diseño: fondo azul redondeado con letra "B" blanca (idéntico a generatePWAIcons() en page).
 * @param {number} size
 * @returns {Promise<Response>}
 */
function generateIconPNG(size) {
    return new Promise(function(resolve, reject) {
        try {
            var canvas = new OffscreenCanvas(size, size);
            var ctx    = canvas.getContext('2d');
            // Fondo azul con bordes redondeados
            ctx.fillStyle = '#0A84FF';
            try { ctx.roundRect(0, 0, size, size, Math.round(size * 0.22)); }
            catch (_) { ctx.rect(0, 0, size, size); }
            ctx.fill();
            // Letra "B" centrada
            ctx.fillStyle     = '#FFFFFF';
            ctx.font          = 'bold ' + Math.round(size * 0.52) + 'px system-ui, sans-serif';
            ctx.textAlign     = 'center';
            ctx.textBaseline  = 'middle';
            ctx.fillText('B', size / 2, size / 2 + Math.round(size * 0.03));
            canvas.convertToBlob({ type: 'image/png' }).then(function(blob) {
                resolve(new Response(blob, {
                    status: 200,
                    headers: {
                        'Content-Type':  'image/png',
                        'Cache-Control': 'public, max-age=86400'
                    }
                }));
            }).catch(reject);
        } catch (e) { reject(e); }
    });
}

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────────
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

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────
self.addEventListener('push', function(event) {
    if (!event.data) return;
    var data = {};
    try { data = event.data.json(); }
    catch (e) { data = { title: 'BarInventory', body: event.data.text() }; }

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

// SW5: usar URL completa del payload cuando existe; fallback al scope.
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
            if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        })
    );
});

// ── MENSAJES DESDE LA APP ─────────────────────────────────────────────────────
self.addEventListener('message', function(event) {
    if (!event.data) return;

    // Forzar activación inmediata de nueva versión del SW.
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    // Cachear URLs adicionales enviadas desde la app (por ejemplo, assets dinámicos).
    if (event.data.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
        caches.open(CACHE_NAME).then(function(cache) {
            cache.addAll(event.data.urls).catch(function(e) {
                console.warn('[SW] Error cacheando URLs adicionales:', e);
            });
        });
    }

    /**
     * SW9: CACHE_ICONS — Recibe los PNGs generados por Canvas en la página
     * y los almacena en caché bajo las URLs exactas que el manifest.json declara.
     *
     * Flujo:
     *   1. page genera icon-192.png e icon-512.png via <canvas>.toDataURL()
     *   2. page envía { type:'CACHE_ICONS', icon192: 'data:image/png;base64,...', icon512: '...' }
     *   3. SW convierte cada data-URL → Uint8Array → Response con Content-Type correcto
     *   4. SW guarda en caché bajo scope + 'icons/icon-192.png'
     *   5. Cuando el browser fetcha el ícono para validar el manifest, SW lo sirve (SW10)
     */
    if (event.data.type === 'CACHE_ICONS') {
        var scope = self.registration.scope;
        var icons = [
            { key: scope + 'icons/icon-192.png', dataUrl: event.data.icon192 },
            { key: scope + 'icons/icon-512.png', dataUrl: event.data.icon512 },
        ];

        caches.open(CACHE_NAME).then(function(cache) {
            icons.forEach(function(icon) {
                if (!icon.dataUrl || !icon.dataUrl.startsWith('data:image/png;base64,')) {
                    console.warn('[SW] CACHE_ICONS: data URL inválida para', icon.key);
                    return;
                }
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
                    cache.put(icon.key, response).then(function() {
                        console.info('[SW] Ícono PWA cacheado ✓', icon.key);
                    });
                } catch (e) {
                    console.warn('[SW] Error convirtiendo ícono a Response:', icon.key, e);
                }
            });
        });
    }
});
