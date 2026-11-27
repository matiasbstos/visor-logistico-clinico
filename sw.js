const CACHE_NAME = 'visor-logistico-v21.276';
// Lo mínimo para abrir sin internet: la página de pedir insumos y el SDK de Firebase (v21.232)
const EXTRA_OFFLINE = [
  './solicitar.html',
  './manifest-solicitar.json',
  './manifest-conteo.json',
  './assets/logo-sar.png',
  './assets/logo/horizontal.svg',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-storage.js',
  'https://unpkg.com/@phosphor-icons/web@2.1.1',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8',   /* cámara del levantamiento (v21.249); copia local pendiente: DECISIONES 4.305 */
  './toma-conciliacion.js?v=21.276',
  './levantamiento-movil.js?v=21.276'
];
const urlsToCache = [
  './',
  './index.html',
  './style.css?v=21.276',
  './script.js?v=21.276',
  './patch-plantillas.js?v=21.276',
  './visor-triaje.js?v=20.11',
'./bodegas-estantes.js?v=21.276',
'./bodega-explorador.js?v=21.276',
'./precintos-inventario.js?v=21.276',
'./prestamos-otros-centros.js?v=21.276',
'./precinto-escaneo.js?v=21.276',
'./sonidos.js?v=21.276',
'./avisos-campana.js?v=21.276',
  './bodegas-cierre.js?v=21.276',
  './progreso.js?v=21.276',
  './oc-lector.js?v=21.276',
  './acta-edicion.js?v=21.276',
  './anonimizar-pacientes.js?v=21.276',
  './cdp-presupuesto.js?v=21.276',
  './imagenes-producto.js?v=21.276',
  './catalogo-vista.js?v=21.276',
  './correo-html.js?v=21.276',
  './avisos-correo.js?v=21.276',
  './monitor-errores.js?v=21.276',
  './lotes-alertas.js?v=21.276',
  './correlativos.js?v=21.276',
  './cuadre-ingreso.js?v=21.276',
  './salud-inventario.js?v=21.276',
  './codigo-sar.js?v=21.276',
  './categorias.js?v=21.276',
  './gobernanza.js?v=21.276',
  './resumen-stock.js?v=21.276',
  './vista-previa-agenda.js?v=21.276',
  './menu-lateral.js?v=21.276',
  './buscador-global.js?v=21.276',
  './buscador-secciones.js?v=21.276',
  './ajuste-ui.js?v=21.276',
  './toma-conciliacion.js?v=21.276',
  './toma-pantalla.js?v=21.276',
  './fotos-telefono.js?v=21.276',
  './fotos.html',
  './manifest-fotos.json',
  './cargando-global.js?v=21.276',
  './respaldo-diario.js?v=21.276',
  './respaldo-semanal.js?v=21.276',
  './cierre-mensual.js?v=21.276',
  './tabla-columnas.js?v=21.276',
  './acerca.js?v=21.276',
  './memo-flujo.js?v=21.276',
  './traspaso-bodegas.js?v=21.276',
  './distribucion-centros.js?v=21.276',
  './primeros-pasos.js?v=21.276',
  './guia-lector.js?v=21.276',
  './seguimiento-oc.js?v=21.276',
  './compras-agiles.js?v=21.276',
  './ingreso-rapido.js?v=21.276',
  './pendientes-entrega.js?v=21.276',
  './sugerencias-producto.js?v=21.276',
  './duplicados.js?v=21.276',
  './recepciones-conformes.js?v=21.276',
  './sustituciones.js?v=21.276',
  './solicitudes-insumos.js?v=21.276',
  './inventario-movil.js?v=21.276',
  './ficha-producto.js?v=21.276',
  './fotos-auto.js?v=21.276',
  './sync-local.js?v=21.276',
  './bultos.js?v=21.276',
  './tags-conteo.js?v=21.276',
  './cola-offline.js?v=21.276',
  './bitacora-oc.js?v=21.276',
  './id-producto.js?v=21.276',
  './home-compras.js?v=21.276',
  './home-ingresos.js?v=21.276',
  './login-animado.js?v=21.276',
  './nomenclaturas.js?v=21.276',
  './errores.js?v=21.276',
  './saldos-contables.js?v=21.276',
  './assets/logo/marca.svg',
  './assets/icon-192.png',
  './assets/icon-fotos-192.png',
  './assets/icon-pedidos-192.png',
  './assets/icon-conteo-192.png',
  './assets/apple-touch-icon-conteo.png',
  './assets/apple-touch-icon-fotos.png',
  './assets/apple-touch-icon-pedidos.png',
  './assets/favicon-32.png',
  './recepcion-conforme.js?v=21.276',
  './acta-documentos.js?v=21.276',
  './unificar-duplicados.js?v=21.276',
  './actas-entrega.js?v=21.276',
  './oxigeno.js?v=21.276',
  './oxigeno-prestamos.js?v=21.276',
  './oxigeno-ciclos.js?v=21.276',
  './oxigeno-facturacion.js?v=21.276',
  './vida-producto.js?v=21.276',
  './editar-ingreso.js?v=21.276',
  './bodega-transitoria.js?v=21.276',
  './assets/logo-acta.png',
  './visor-adquisiciones.js?v=21.276',
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
  if (event.request.url.includes('firestore.googleapis.com') || event.request.url.includes('identitytoolkit.googleapis.com') || event.request.url.includes('firebasestorage.googleapis.com') || event.request.url.includes('cloudfunctions.net')) return;

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

  // Fotos de productos (tienda de Convenio Marco, sin CORS): se guardan para verlas sin internet (v21.232)
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
      .catch(() => caches.match(event.request).then(r => r || Response.error()))
  );
});
