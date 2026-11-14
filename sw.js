const CACHE_NAME = 'visor-logistico-v21.203';
// Lo mínimo para abrir sin internet: la página de pedir insumos y el SDK de Firebase (v21.203)
const EXTRA_OFFLINE = [
  './solicitar.html',
  './manifest-solicitar.json',
  './assets/logo-sar.png',
  './assets/logo/horizontal.svg',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js',
  'https://unpkg.com/@phosphor-icons/web@2.1.1'
];
const urlsToCache = [
  './',
  './index.html',
  './style.css?v=21.203',
  './script.js?v=21.203',
  './patch-plantillas.js?v=21.203',
  './visor-triaje.js?v=20.11',
'./bodegas-estantes.js?v=21.203',
'./bodega-explorador.js?v=21.203',
'./precintos-inventario.js?v=21.203',
'./prestamos-otros-centros.js?v=21.203',
'./precinto-escaneo.js?v=21.203',
'./sonidos.js?v=21.203',
'./avisos-campana.js?v=21.203',
  './bodegas-cierre.js?v=21.203',
  './progreso.js?v=21.203',
  './oc-lector.js?v=21.203',
  './acta-edicion.js?v=21.203',
  './anonimizar-pacientes.js?v=21.203',
  './cdp-presupuesto.js?v=21.203',
  './imagenes-producto.js?v=21.203',
  './catalogo-vista.js?v=21.203',
  './correo-html.js?v=21.203',
  './avisos-correo.js?v=21.203',
  './monitor-errores.js?v=21.203',
  './lotes-alertas.js?v=21.203',
  './codigo-sar.js?v=21.203',
  './categorias.js?v=21.203',
  './gobernanza.js?v=21.203',
  './resumen-stock.js?v=21.203',
  './vista-previa-agenda.js?v=21.203',
  './menu-lateral.js?v=21.203',
  './buscador-global.js?v=21.203',
  './cargando-global.js?v=21.203',
  './respaldo-diario.js?v=21.203',
  './cierre-mensual.js?v=21.203',
  './tabla-columnas.js?v=21.203',
  './acerca.js?v=21.203',
  './memo-flujo.js?v=21.203',
  './traspaso-bodegas.js?v=21.203',
  './distribucion-centros.js?v=21.203',
  './primeros-pasos.js?v=21.203',
  './guia-lector.js?v=21.203',
  './seguimiento-oc.js?v=21.203',
  './compras-agiles.js?v=21.203',
  './ingreso-rapido.js?v=21.203',
  './pendientes-entrega.js?v=21.203',
  './sugerencias-producto.js?v=21.203',
  './duplicados.js?v=21.203',
  './recepciones-conformes.js?v=21.203',
  './sustituciones.js?v=21.203',
  './solicitudes-insumos.js?v=21.203',
  './ficha-producto.js?v=21.203',
  './fotos-auto.js?v=21.203',
  './sync-local.js?v=21.203',
  './cola-offline.js?v=21.203',
  './bitacora-oc.js?v=21.203',
  './id-producto.js?v=21.203',
  './home-compras.js?v=21.203',
  './home-ingresos.js?v=21.203',
  './login-animado.js?v=21.203',
  './nomenclaturas.js?v=21.203',
  './errores.js?v=21.203',
  './saldos-contables.js?v=21.203',
  './assets/logo/marca.svg',
  './assets/icon-192.png',
  './assets/favicon-32.png',
  './recepcion-conforme.js?v=21.203',
  './acta-documentos.js?v=21.203',
  './unificar-duplicados.js?v=21.203',
  './actas-entrega.js?v=21.203',
  './oxigeno.js?v=21.203',
  './oxigeno-prestamos.js?v=21.203',
  './oxigeno-ciclos.js?v=21.203',
  './vida-producto.js?v=21.203',
  './editar-ingreso.js?v=21.203',
  './bodega-transitoria.js?v=21.203',
  './assets/logo-acta.png',
  './visor-adquisiciones.js?v=21.203',
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

  // Fotos de productos (tienda de Convenio Marco, sin CORS): se guardan para verlas sin internet (v21.203)
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
