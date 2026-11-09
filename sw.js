const CACHE_NAME = 'visor-logistico-v21.135';
const urlsToCache = [
  './',
  './index.html',
  './style.css?v=21.135',
  './script.js?v=21.135',
  './patch-plantillas.js?v=21.135',
  './visor-triaje.js?v=20.11',
'./bodegas-estantes.js?v=21.135',
'./bodega-explorador.js?v=21.135',
'./precintos-inventario.js?v=21.135',
'./prestamos-otros-centros.js?v=21.135',
'./precinto-escaneo.js?v=21.135',
'./sonidos.js?v=21.135',
'./avisos-campana.js?v=21.135',
  './bodegas-cierre.js?v=21.135',
  './progreso.js?v=21.135',
  './oc-lector.js?v=21.135',
  './acta-edicion.js?v=21.135',
  './anonimizar-pacientes.js?v=21.135',
  './cdp-presupuesto.js?v=21.135',
  './imagenes-producto.js?v=21.135',
  './catalogo-vista.js?v=21.135',
  './correo-html.js?v=21.135',
  './avisos-correo.js?v=21.135',
  './monitor-errores.js?v=21.135',
  './lotes-alertas.js?v=21.135',
  './codigo-sar.js?v=21.135',
  './categorias.js?v=21.135',
  './gobernanza.js?v=21.135',
  './resumen-stock.js?v=21.135',
  './vista-previa-agenda.js?v=21.135',
  './menu-lateral.js?v=21.135',
  './buscador-global.js?v=21.135',
  './cargando-global.js?v=21.135',
  './respaldo-diario.js?v=21.135',
  './cierre-mensual.js?v=21.135',
  './tabla-columnas.js?v=21.135',
  './acerca.js?v=21.135',
  './primeros-pasos.js?v=21.135',
  './seguimiento-oc.js?v=21.135',
  './compras-agiles.js?v=21.135',
  './ingreso-rapido.js?v=21.135',
  './pendientes-entrega.js?v=21.135',
  './sugerencias-producto.js?v=21.135',
  './duplicados.js?v=21.135',
  './recepciones-conformes.js?v=21.135',
  './sustituciones.js?v=21.135',
  './bitacora-oc.js?v=21.135',
  './id-producto.js?v=21.135',
  './home-compras.js?v=21.135',
  './home-ingresos.js?v=21.135',
  './login-animado.js?v=21.135',
  './errores.js?v=21.135',
  './saldos-contables.js?v=21.135',
  './assets/logo/marca.svg',
  './assets/icon-192.png',
  './assets/favicon-32.png',
  './recepcion-conforme.js?v=21.135',
  './acta-documentos.js?v=21.135',
  './actas-entrega.js?v=21.135',
  './oxigeno.js?v=21.135',
  './oxigeno-prestamos.js?v=21.135',
  './vida-producto.js?v=21.135',
  './editar-ingreso.js?v=21.135',
  './bodega-transitoria.js?v=21.135',
  './assets/logo-acta.png',
  './visor-adquisiciones.js?v=21.135',
  './excelUtils.js?v=20.11',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap',
  'https://unpkg.com/@phosphor-icons/web@2.1.1',
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
