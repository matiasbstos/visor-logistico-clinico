const CACHE_NAME = 'visor-logistico-v21.160';
const urlsToCache = [
  './',
  './index.html',
  './style.css?v=21.160',
  './script.js?v=21.160',
  './patch-plantillas.js?v=21.160',
  './visor-triaje.js?v=20.11',
'./bodegas-estantes.js?v=21.160',
'./bodega-explorador.js?v=21.160',
'./precintos-inventario.js?v=21.160',
'./prestamos-otros-centros.js?v=21.160',
'./precinto-escaneo.js?v=21.160',
'./sonidos.js?v=21.160',
'./avisos-campana.js?v=21.160',
  './bodegas-cierre.js?v=21.160',
  './progreso.js?v=21.160',
  './oc-lector.js?v=21.160',
  './acta-edicion.js?v=21.160',
  './anonimizar-pacientes.js?v=21.160',
  './cdp-presupuesto.js?v=21.160',
  './imagenes-producto.js?v=21.160',
  './catalogo-vista.js?v=21.160',
  './correo-html.js?v=21.160',
  './avisos-correo.js?v=21.160',
  './monitor-errores.js?v=21.160',
  './lotes-alertas.js?v=21.160',
  './codigo-sar.js?v=21.160',
  './categorias.js?v=21.160',
  './gobernanza.js?v=21.160',
  './resumen-stock.js?v=21.160',
  './vista-previa-agenda.js?v=21.160',
  './menu-lateral.js?v=21.160',
  './buscador-global.js?v=21.160',
  './cargando-global.js?v=21.160',
  './respaldo-diario.js?v=21.160',
  './cierre-mensual.js?v=21.160',
  './tabla-columnas.js?v=21.160',
  './acerca.js?v=21.160',
  './memo-flujo.js?v=21.160',
  './traspaso-bodegas.js?v=21.160',
  './primeros-pasos.js?v=21.160',
  './guia-lector.js?v=21.160',
  './seguimiento-oc.js?v=21.160',
  './compras-agiles.js?v=21.160',
  './ingreso-rapido.js?v=21.160',
  './pendientes-entrega.js?v=21.160',
  './sugerencias-producto.js?v=21.160',
  './duplicados.js?v=21.160',
  './recepciones-conformes.js?v=21.160',
  './sustituciones.js?v=21.160',
  './bitacora-oc.js?v=21.160',
  './id-producto.js?v=21.160',
  './home-compras.js?v=21.160',
  './home-ingresos.js?v=21.160',
  './login-animado.js?v=21.160',
  './nomenclaturas.js?v=21.160',
  './errores.js?v=21.160',
  './saldos-contables.js?v=21.160',
  './assets/logo/marca.svg',
  './assets/icon-192.png',
  './assets/favicon-32.png',
  './recepcion-conforme.js?v=21.160',
  './acta-documentos.js?v=21.160',
  './unificar-duplicados.js?v=21.160',
  './actas-entrega.js?v=21.160',
  './oxigeno.js?v=21.160',
  './oxigeno-prestamos.js?v=21.160',
  './oxigeno-ciclos.js?v=21.160',
  './vida-producto.js?v=21.160',
  './editar-ingreso.js?v=21.160',
  './bodega-transitoria.js?v=21.160',
  './assets/logo-acta.png',
  './visor-adquisiciones.js?v=21.160',
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
