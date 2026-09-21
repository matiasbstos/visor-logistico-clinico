const CACHE_NAME = 'visor-logistico-v18.20';
const urlsToCache = [
  './',
  './index.html',
  './style.css?v=18.20',
  './script.js?v=18.20',
  './patch-plantillas.js?v=18.20',
  './visor-triaje.js?v=18.20',
  './excelUtils.js',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap',
  'https://unpkg.com/@phosphor-icons/web',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

// Instalar el Service Worker y almacenar en caché los recursos estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Archivos cacheados exitosamente');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// Activar el Service Worker y limpiar cachés antiguas si existen
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Limpiando caché antigua:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Estrategia Stale-While-Revalidate para recursos estáticos
self.addEventListener('fetch', event => {
  // Ignorar esquemas que no sean HTTP/HTTPS (como blob: o data:)
  if (!event.request.url.startsWith('http')) return;
  // Ignorar peticiones que no sean GET (como las de Firestore)
  if (event.request.method !== 'GET') return;
  // Ignorar peticiones a la API de Firestore para dejar que el SDK maneje su propia persistencia
  if (event.request.url.includes('firestore.googleapis.com')) return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          // Solo cachear respuestas válidas
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
          }
          return networkResponse;
        }).catch(() => {
            // Si la red falla y no hay caché, retornar el index.html (PWA Fallback)
            if (event.request.mode === 'navigate' || (event.request.method === 'GET' && event.request.headers.get('accept').includes('text/html'))) {
                return caches.match('./index.html');
            }
        });
        
        return cachedResponse || fetchPromise;
      })
  );
});
