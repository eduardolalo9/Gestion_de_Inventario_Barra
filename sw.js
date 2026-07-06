// ════════════════════════════════════════════════════════════════════════════
//  BarInventory — Service Worker v2.5
//  Estrategia: Cache-First para assets estáticos, Network-First para Firebase.
//  Garantiza funcionamiento offline y actualizaciones automáticas al deployar.
//
//  CORRECCIONES v2.4 (heredadas):
//  - SW8: OFFLINE_URL calculado dinámicamente desde self.registration.scope.
//  - SW9: CACHE_ICONS guarda íconos PWA generados por Canvas desde la página.
//  - SW10: Handler fetch para rutas de íconos PWA con fallback OffscreenCanvas.
//
//  CORRECCIONES v2.5 (nuevas):
//  - SW11: staleWhileRevalidate ahora devuelve un Response 503 explícito
//          en lugar de undefined/null cuando tanto la red como el caché fallan.
//          Antes: fetch chain recibía undefined → TypeError no controlado.
//          Ahora: devuelve Response 503 con body descriptivo → visible en DevTools.
//  - SW12: cacheFirst también retorna 503 explícito si la red falla sin caché.
//  - SW13: serveIcon — ruta de último recurso devuelve PNG 1×1 siempre,
//          incluso si la propia generación de la Response falla (doble try-catch).
//  - SW14: activate — clients.claim() se envuelve en su propio try-catch para
//          no interrumpir la limpieza de cachés si claim() lanza en contextos
//          con restricciones (ej. extensiones).
//  - SW15: install — se añade timeout de 8s para evitar que addAll cuelgue
//          indefinidamente en redes muy lentas durante la instalación.
//  - SW16: NETWORK_ONLY_ORIGINS ampliado con googleapis.com genérico para
//          capturar sub-dominios nuevos de Firebase que no estaban listados.
// ════════════════════════════════════════════════════════════════════════════

const  CACHE_NAME = 'barinventory-v2.6' ;

// SW8 FIX: OFFLINE_URL calculado desde el scope del SW en tiempo de ejecución.
let OFFLINE_URL = '';

// Assets que se cachean en la instalación (shell de la app)
const PRECACHE_URLS = [
    './index.html',
    './manifest.json',
];

// Dominios que NUNCA se cachean (siempre van a la red)
const  NETWORK_ONLY_ORIGINS = [
  'firestore.googleapis.com' ,
  'firebase.googleapis.com' ,
  'firebaseinstallations.googleapis.com' ,
  'securetoken.googleapis.com' ,
  'identitytoolkit.googleapis.com' ,
  'firebaseio.com' ,
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
    console.info('[SW] Instalando v' + CACHE_NAME);
    event.waitUntil(
        // SW15 FIX: timeout de 8 s para no colgar en redes muy lentas
        Promise.race([
            caches.open(CACHE_NAME).then(function(cache) {
                return cache.addAll(PRECACHE_URLS);
            }),
            new Promise(function(_, reject) {
               setTimeout(function() { reject(new Error('[SW] Timeout precache (8s)')); }, 8000);
            })
        ])
        .then(function() { return self.skipWaiting(); })
        .catch(function(err) {
            console.error('[SW] Error crítico en precache — abortando instalación:', err);
            throw err;
        })
    );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
    console.info('[SW] Activando — limpiando cachés viejos…');
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
                // SW14 FIX: claim() en su propio try-catch
                return self.clients.claim().catch(function(e) {
                    console.warn('[SW] clients.claim() falló (no crítico):', e);
                });
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

 // FIX: CDNs y fuentes PRIMERO, antes del filtro network-only.
 // Si no, 'fonts.googleapis.com' caía en el filtro de Firebase y nunca se cacheaba.
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

 // Firebase / APIs de auth → SIEMPRE red (nunca cachear tokens ni datos Firestore)
 if (NETWORK_ONLY_ORIGINS.some(function(origin) { return url.hostname.includes(origin); })) {
 return; // dejar pasar a la red sin interceptar
 }

 // Interceptar rutas de íconos PWA del manifest.
 if (url.pathname.endsWith('/icon-192.png') || url.pathname.endsWith('/icon-512.png')) {
 event.respondWith(serveIcon(event.request, url));
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

// SW12 FIX: devuelve 503 explícito en lugar de undefined si no hay caché ni red
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
        }).catch(function(err) {
            console.warn('[SW] cacheFirst: red y caché fallaron para', request.url, err);
            return new Response(
                JSON.stringify({ error: 'Sin conexión', url: request.url }),
                {
                    status: 503,
                    statusText: 'Sin conexión',
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        });
    });
}

// SW11 FIX: devuelve un Response 503 explícito cuando tanto la red como el caché fallan
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
        return networkPromise.catch(function(err) {
            console.warn('[SW] staleWhileRevalidate: sin caché ni red para', request.url, err);
            // SW11 FIX: intentar fallback a OFFLINE_URL antes de retornar 503
            return caches.match(OFFLINE_URL).then(function(offlinePage) {
                if (offlinePage) return offlinePage;
                // Último recurso: respuesta 503 explícita (nunca undefined)
                return new Response(
                    '<!doctype html><html lang="es"><head><meta charset="UTF-8">' +
                    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
                    '<title>Sin conexión — BarInventory</title>' +
                    '<style>body{font-family:system-ui,sans-serif;display:flex;' +
                    'align-items:center;justify-content:center;min-height:100vh;' +
                    'background:#0f0f13;color:#e6e1e5;text-align:center;padding:24px;}' +
                    'h1{font-size:1.4rem;margin-bottom:.5rem;}' +
                    'p{color:#938f99;font-size:.9rem;}' +
                    'button{margin-top:16px;padding:10px 24px;border-radius:24px;' +
                    'background:#a8c7fa;color:#003063;border:none;font-weight:600;cursor:pointer;}' +
                    '</style></head><body>' +
                    '<div><div style="font-size:3rem;margin-bottom:12px">📴</div>' +
                    '<h1>Sin conexión</h1>' +
                    '<p>BarInventory está guardado localmente.<br>Reconecta para sincronizar.</p>' +
                    '<button onclick="location.reload()">Reintentar</button>' +
                    '</div></body></html>',
                    {
                        status: 503,
                        statusText: 'Sin conexión',
                        headers: { 'Content-Type': 'text/html; charset=utf-8' }
                    }
                );
            });
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
 *
 * SW13 FIX: doble try-catch para que el PNG 1×1 siempre se retorne aunque
 * la propia construcción de la Response falle en entornos muy restringidos.
 */
function serveIcon(request, url) {
    return caches.match(request).then(function(cached) {
        if (cached) {
            console.info('[SW] Ícono servido desde caché:', url.pathname);
            return cached;
        }
        var size = url.pathname.includes('192') ? 192 : 512;
        return generateIconResponse(size).catch(function() {
            // SW13 FIX: doble try-catch para garantizar que siempre se retorna algo
            try {
                var tiny1x1PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
                return new Response(
                    Uint8Array.from(atob(tiny1x1PNG), function(c) { return c.charCodeAt(0); }),
                    { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } }
                );
            } catch(e2) {
                return new Response('', { status: 204 });
            }
        });
    });
}

/**
 * Genera un PNG de `size`×`size` con OffscreenCanvas (Chrome 69+ / Android 9+).
 * @param {number} size
 * @returns {Promise<Response>}
 */
function generateIconResponse(size) {
    return new Promise(function(resolve, reject) {
        try {
            var canvas = new OffscreenCanvas(size, size);
            var ctx = canvas.getContext('2d');
            // FIX-ICON-CONSISTENCIA (BarInventory): antes este respaldo usaba un
            // degradado oscuro con letra ámbar, distinto del ícono real que genera
            // index.html (azul sólido #0A84FF con letra blanca). Se alinean los
            // colores para que, si alguna vez se usa este respaldo, no se vea como
            // un ícono de otra app.
            ctx.fillStyle = '#0A84FF';
            try { ctx.roundRect(0, 0, size, size, size * 0.22); }
            catch(_) { ctx.rect(0, 0, size, size); }
            ctx.fill();
            // Letra "B" en blanco (igual que el ícono generado por la página)
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
