const CACHE_NAME = 'visor-logistico-v21.212';
// Lo mínimo para abrir sin internet: la página de pedir insumos y el SDK de Firebase (v21.212)
const EXTRA_OFFLINE = [
  './solicitar.html',
  './manifest-solicitar.json',
  './assets/logo-sar.png',
  './assets/logo/horizontal.svg',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js',
  'https://unpkg.com/@phosphor-icons/web@2.1.1',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'
];
const urlsToCache = [
  './',
  './index.html',
  './style.css?v=21.212',
  './script.js?v=21.212',
  './patch-plantillas.js?v=21.212',
  './visor-triaje.js?v=20.11',
'./bodegas-estantes.js?v=21.212',
'./bodega-explorador.js?v=21.212',
'./precintos-inventario.js?v=21.212',
'./prestamos-otros-centros.js?v=21.212',
'./precinto-escaneo.js?v=21.212',
'./sonidos.js?v=21.212',
'./avisos-campana.js?v=21.212',
  './bodegas-cierre.js?v=21.212',
  './progreso.js?v=21.212',
  './oc-lector.js?v=21.212',
  './acta-edicion.js?v=21.212',
  './anonimizar-pacientes.js?v=21.212',
  './cdp-presupuesto.js?v=21.212',
  './imagenes-producto.js?v=21.212',
  './catalogo-vista.js?v=21.212',
  './correo-html.js?v=21.212',
  './avisos-correo.js?v=21.212',
  './monitor-errores.js?v=21.212',
  './lotes-alertas.js?v=21.212',
  './codigo-sar.js?v=21.212',
  './categorias.js?v=21.212',
  './gobernanza.js?v=21.212',
  './resumen-stock.js?v=21.212',
  './vista-previa-agenda.js?v=21.212',
  './menu-lateral.js?v=21.212',
  './buscador-global.js?v=21.212',
  './cargando-global.js?v=21.212',
  './respaldo-diario.js?v=21.212',
  './cierre-mensual.js?v=21.212',
  './tabla-columnas.js?v=21.212',
  './acerca.js?v=21.212',
  './memo-flujo.js?v=21.212',
  './traspaso-bodegas.js?v=21.212',
  './distribucion-centros.js?v=21.212',
  './primeros-pasos.js?v=21.212',
  './guia-lector.js?v=21.212',
  './seguimiento-oc.js?v=21.212',
  './compras-agiles.js?v=21.212',
  './ingreso-rapido.js?v=21.212',
  './pendientes-entrega.js?v=21.212',
  './sugerencias-producto.js?v=21.212',
  './duplicados.js?v=21.212',
  './recepciones-conformes.js?v=21.212',
  './sustituciones.js?v=21.212',
  './solicitudes-insumos.js?v=21.212',
  './inventario-movil.js?v=21.212',
  './ficha-producto.js?v=21.212',
  './fotos-auto.js?v=21.212',
  './sync-local.js?v=21.212',
  './bultos.js?v=21.212',
  './cola-offline.js?v=21.212',
  './bitacora-oc.js?v=21.212',
  './id-producto.js?v=21.212',
  './home-compras.js?v=21.212',
  './home-ingresos.js?v=21.212',
  './login-animado.js?v=21.212',
  './nomenclaturas.js?v=21.212',
  './errores.js?v=21.212',
  './saldos-contables.js?v=21.212',
  './assets/logo/marca.svg',
  './assets/icon-192.png',
  './assets/favicon-32.png',
  './recepcion-conforme.js?v=21.212',
  './acta-documentos.js?v=21.212',
  './unificar-duplicados.js?v=21.212',
  './actas-entrega.js?v=21.212',
  './oxigeno.js?v=21.212',
  './oxigeno-prestamos.js?v=21.212',
  './oxigeno-ciclos.js?v=21.212',
  './vida-producto.js?v=21.212',
  './editar-ingreso.js?v=21.212',
  './bodega-transitoria.js?v=21.212',
  './assets/logo-acta.png',
  './visor-adquisiciones.js?v=21.212',
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
      .then(async cache => {
        // De a uno y tolerante: si un archivo falla, no se cae toda la instalación (antes un solo error dejaba la app sin modo sin conexión)
        await Promise.all(urlsToCache.concat(EXTRA_OFFLINE).map(u => cache.add(u).catch(() => null)));
      })
  );
});

// Activar el Service Worker y purgar todas las cachés anteriores (< v19.00)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName !== 'visor-fotos-v1') {
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
        .catch(() => caches.match(event.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Fotos de productos (tienda de Convenio Marco, sin CORS): se guardan para verlas sin internet (v21.212)
  if (event.request.destination === 'image' && !event.request.url.startsWith(self.location.origin)) {
    event.respondWith(caches.open('visor-fotos-v1').then(c => c.match(event.request).then(hit => {
      const red = fetch(event.request).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(event.request, r.clone()); return r; }).catch(() => hit);
      return hit || red;
    })));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
