const CACHE_NAME = 'visor-logistico-v21.145';
const urlsToCache = [
  './',
  './index.html',
  './style.css?v=21.145',
  './script.js?v=21.145',
  './patch-plantillas.js?v=21.145',
  './visor-triaje.js?v=20.11',
'./bodegas-estantes.js?v=21.145',
'./bodega-explorador.js?v=21.145',
'./precintos-inventario.js?v=21.145',
'./prestamos-otros-centros.js?v=21.145',
'./precinto-escaneo.js?v=21.145',
'./sonidos.js?v=21.145',
'./avisos-campana.js?v=21.145',
  './bodegas-cierre.js?v=21.145',
  './progreso.js?v=21.145',
  './oc-lector.js?v=21.145',
  './acta-edicion.js?v=21.145',
  './anonimizar-pacientes.js?v=21.145',
  './cdp-presupuesto.js?v=21.145',
  './imagenes-producto.js?v=21.145',
  './catalogo-vista.js?v=21.145',
  './correo-html.js?v=21.145',
  './avisos-correo.js?v=21.145',
  './monitor-errores.js?v=21.145',
  './lotes-alertas.js?v=21.145',
  './codigo-sar.js?v=21.145',
  './categorias.js?v=21.145',
  './gobernanza.js?v=21.145',
  './resumen-stock.js?v=21.145',
  './vista-previa-agenda.js?v=21.145',
  './menu-lateral.js?v=21.145',
  './buscador-global.js?v=21.145',
  './cargando-global.js?v=21.145',
  './respaldo-diario.js?v=21.145',
  './cierre-mensual.js?v=21.145',
  './tabla-columnas.js?v=21.145',
  './acerca.js?v=21.145',
  './primeros-pasos.js?v=21.145',
  './seguimiento-oc.js?v=21.145',
  './compras-agiles.js?v=21.145',
  './ingreso-rapido.js?v=21.145',
  './pendientes-entrega.js?v=21.145',
  './sugerencias-producto.js?v=21.145',
  './duplicados.js?v=21.145',
  './recepciones-conformes.js?v=21.145',
  './sustituciones.js?v=21.145',
  './bitacora-oc.js?v=21.145',
  './id-producto.js?v=21.145',
  './home-compras.js?v=21.145',
  './home-ingresos.js?v=21.145',
  './login-animado.js?v=21.145',
  './nomenclaturas.js?v=21.145',
  './errores.js?v=21.145',
  './saldos-contables.js?v=21.145',
  './assets/logo/marca.svg',
  './assets/icon-192.png',
  './assets/favicon-32.png',
  './recepcion-conforme.js?v=21.145',
  './acta-documentos.js?v=21.145',
  './actas-entrega.js?v=21.145',
  './oxigeno.js?v=21.145',
  './oxigeno-prestamos.js?v=21.145',
  './vida-producto.js?v=21.145',
  './editar-ingreso.js?v=21.145',
  './bodega-transitoria.js?v=21.145',
  './assets/logo-acta.png',
  './visor-adquisiciones.js?v=21.145',
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
