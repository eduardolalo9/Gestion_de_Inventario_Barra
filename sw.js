// ════════════════════════════════════════════════════════════════════════════
// BarInventory — Service Worker v2.6
// Cache-First para assets estáticos, Network-First para Firebase. Offline PWA.
// ════════════════════════════════════════════════════════════════════════════

const CACHE_NAME = 'barinventory-v2.6';

let OFFLINE_URL = '';

const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
];

// FIX: sin 'googleapis.com' genérico (rompía el cacheo de fuentes offline)
const NETWORK_ONLY_ORIGINS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'securetoken.googleapis.com',
  'identitytoolkit.googleapis.com',
  'firebaseio.com',
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  console.info('[SW] Instalando v' + CACHE_NAME);
  event.waitUntil(
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
        return self.clients.claim().catch(function(e) {
          console.warn('[SW] clients.claim() falló (no crítico):', e);
        });
      })
  );
});

// ── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  // FIX: CDNs y fuentes PRIMERO, antes del filtro network-only.
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

  // Firebase / APIs de auth → SIEMPRE red
  if (NETWORK_ONLY_ORIGINS.some(function(origin) { return url.hostname.includes(origin); })) {
    return;
  }

  // Íconos PWA del manifest
  if (url.pathname.endsWith('/icon-192.png') || url.pathname.endsWith('/icon-512.png')) {
    event.respondWith(serveIcon(event.request, url));
    return;
  }

  // Assets propios de la app → Stale-While-Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
});

// ── ESTRATEGIAS DE CACHÉ ─────────────────────────────────────────────────────

function isCacheable(response) {
  return response && response.status === 200 && response.type !== 'opaque';
}

function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
    if (cached) return cached;
    return fetch(request).then(function(response) {
      if (isCacheable(response)) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
      }
      return response;
    }).catch(function(err) {
      console.warn('[SW] cacheFirst: red y caché fallaron para', request.url, err);
      return new Response(
        JSON.stringify({ error: 'Sin conexión', url: request.url }),
        { status: 503, statusText: 'Sin conexión', headers: { 'Content-Type': 'application/json' } }
      );
    });
  });
}

function staleWhileRevalidate(request) {
  // FIX: .catch en la promesa de red evita unhandled rejection en cache-hit offline
  var networkPromise = fetch(request).then(function(response) {
    if (isCacheable(response)) {
      var clone = response.clone();
      caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
    }
    return response;
  }).catch(function(err) {
    console.warn('[SW] staleWhileRevalidate: red falló para', request.url, err);
    return undefined;
  });

  return caches.match(request).then(function(cached) {
    if (cached) return cached;
    return networkPromise.then(function(res) {
      if (res) return res;
      return caches.match(OFFLINE_URL).then(function(offlinePage) {
        if (offlinePage) return offlinePage;
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
          { status: 503, statusText: 'Sin conexión', headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      });
    });
  });
}

// ── ÍCONOS PWA ───────────────────────────────────────────────────────────────
function serveIcon(request, url) {
  return caches.match(request).then(function(cached) {
    if (cached) {
      console.info('[SW] Ícono servido desde caché:', url.pathname);
      return cached;
    }
    var size = url.pathname.includes('192') ? 192 : 512;
    return generateIconResponse(size).catch(function() {
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

  if (event.data.type === 'CACHE_ICONS') {
    var scope = self.registration.scope;
    var icons = [
      { key: scope + 'icons/icon-192.png', dataUrl: event.data.icon192 },
      { key: scope + 'icons/icon-512.png', dataUrl: event.data.icon512 },
    ];

    caches.open(CACHE_NAME).then(function(cache) {
      icons.forEach(function(icon) {
        if (!icon.dataUrl || !icon.dataUrl.startsWith('data:image/png;base64,')) return;
        try {
          var base64 = icon.dataUrl.split(',')[1];
          var binary = atob(base64);
          var bytes = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          var response = new Response(bytes.buffer, {
            status: 200,
            headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
          });
          cache.put(icon.key, response).then(function() {
            console.info('[SW] Ícono PWA cacheado:', icon.key);
          });
        } catch(e) {
          console.warn('[SW] Error convirtiendo ícono a Response:', icon.key, e);
        }
      });
    });
  }
});
