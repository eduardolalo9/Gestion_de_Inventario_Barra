const CACHE_NAME = 'inventario-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json'
  // Si tienes archivos .css o .js separados, agrégalos aquí. Ej: './style.css'
];

// Instalación del Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Archivos en caché');
        return cache.addAll(urlsToCache);
      })
  );
});

// Interceptar las peticiones para cargar desde el caché si no hay internet
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Devuelve el archivo del caché si existe, si no, lo descarga de internet
        return response || fetch(event.request);
      })
  );
});
