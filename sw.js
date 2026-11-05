const CACHE_NAME = 'visor-logistico-v20.78';
const urlsToCache = [
  './',
  './index.html',
  './style.css?v=20.78',
  './script.js?v=20.78',
  './patch-plantillas.js?v=20.78',
  './visor-triaje.js?v=20.11',
'./bodegas-estantes.js?v=20.78',
  './bodegas-cierre.js?v=20.78',
  './oc-lector.js?v=20.78',
  './anonimizar-pacientes.js?v=20.78',
  './cdp-presupuesto.js?v=20.78',
  './seguimiento-oc.js?v=20.78',
  './compras-agiles.js?v=20.78',
  './home-compras.js?v=20.78',
  './login-animado.js?v=20.78',
  './errores.js?v=20.78',
  './saldos-contables.js?v=20.78',
  './assets/logo/marca.svg',
  './assets/icon-192.png',
  './assets/favicon-32.png',
  './recepcion-conforme.js?v=20.78',
  './acta-documentos.js?v=20.78',
  './actas-entrega.js?v=20.78',
  './oxigeno.js?v=20.78',
  './assets/logo-acta.png',
  './visor-adquisiciones.js?v=20.78',
  './excelUtils.js?v=20.11',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap',
  'https://unpkg.com/@phosphor-icons/web',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

// Instalar el Service Worker y activar inmediatamente la nueva versión
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker v19.00] Archivos cacheados exitosamente');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activar el Service Worker y purgar todas las cachés anteriores (< v19.00)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker v19.00] Purgando caché antigua:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Estrategia Híbrida:
// 1. Network-First (Red Primero) para index.html y navegación SPA (evita versión estancada).
// 2. Network-First con fallback a caché para JS/CSS versionados.
self.addEventListener('fetch', event => {
  if (!event.request.url.startsWith('http')) return;
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('firestore.googleapis.com') || event.request.url.includes('identitytoolkit.googleapis.com')) return;

  const isHTMLNavigation =
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) ||
    event.request.url.endsWith('/index.html') ||
    event.request.url.endsWith('/');

  if (isHTMLNavigation) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
