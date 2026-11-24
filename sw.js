const CACHE_NAME = 'visor-logistico-v21.254';
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
  'https://unpkg.com/@phosphor-icons/web@2.1.1',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8',   /* cámara del levantamiento (v21.249); copia local pendiente: DECISIONES 4.305 */
  './toma-conciliacion.js?v=21.254',
  './levantamiento-movil.js?v=21.254'
];
const urlsToCache = [
  './',
  './index.html',
  './style.css?v=21.254',
  './script.js?v=21.254',
  './patch-plantillas.js?v=21.254',
  './visor-triaje.js?v=20.11',
'./bodegas-estantes.js?v=21.254',
'./bodega-explorador.js?v=21.254',
'./precintos-inventario.js?v=21.254',
'./prestamos-otros-centros.js?v=21.254',
'./precinto-escaneo.js?v=21.254',
'./sonidos.js?v=21.254',
'./avisos-campana.js?v=21.254',
  './bodegas-cierre.js?v=21.254',
  './progreso.js?v=21.254',
  './oc-lector.js?v=21.254',
  './acta-edicion.js?v=21.254',
  './anonimizar-pacientes.js?v=21.254',
  './cdp-presupuesto.js?v=21.254',
  './imagenes-producto.js?v=21.254',
  './catalogo-vista.js?v=21.254',
  './correo-html.js?v=21.254',
  './avisos-correo.js?v=21.254',
  './monitor-errores.js?v=21.254',
  './lotes-alertas.js?v=21.254',
  './correlativos.js?v=21.254',
  './cuadre-ingreso.js?v=21.254',
  './salud-inventario.js?v=21.254',
  './codigo-sar.js?v=21.254',
  './categorias.js?v=21.254',
  './gobernanza.js?v=21.254',
  './resumen-stock.js?v=21.254',
  './vista-previa-agenda.js?v=21.254',
  './menu-lateral.js?v=21.254',
  './buscador-global.js?v=21.254',
  './buscador-secciones.js?v=21.254',
  './ajuste-ui.js?v=21.254',
  './toma-conciliacion.js?v=21.254',
  './toma-pantalla.js?v=21.254',
  './fotos-telefono.js?v=21.254',
  './fotos.html',
  './manifest-fotos.json',
  './cargando-global.js?v=21.254',
  './respaldo-diario.js?v=21.254',
  './respaldo-semanal.js?v=21.254',
  './cierre-mensual.js?v=21.254',
  './tabla-columnas.js?v=21.254',
  './acerca.js?v=21.254',
  './memo-flujo.js?v=21.254',
  './traspaso-bodegas.js?v=21.254',
  './distribucion-centros.js?v=21.254',
  './primeros-pasos.js?v=21.254',
  './guia-lector.js?v=21.254',
  './seguimiento-oc.js?v=21.254',
  './compras-agiles.js?v=21.254',
  './ingreso-rapido.js?v=21.254',
  './pendientes-entrega.js?v=21.254',
  './sugerencias-producto.js?v=21.254',
  './duplicados.js?v=21.254',
  './recepciones-conformes.js?v=21.254',
  './sustituciones.js?v=21.254',
  './solicitudes-insumos.js?v=21.254',
  './inventario-movil.js?v=21.254',
  './ficha-producto.js?v=21.254',
  './fotos-auto.js?v=21.254',
  './sync-local.js?v=21.254',
  './bultos.js?v=21.254',
  './tags-conteo.js?v=21.254',
  './cola-offline.js?v=21.254',
  './bitacora-oc.js?v=21.254',
  './id-producto.js?v=21.254',
  './home-compras.js?v=21.254',
  './home-ingresos.js?v=21.254',
  './login-animado.js?v=21.254',
  './nomenclaturas.js?v=21.254',
  './errores.js?v=21.254',
  './saldos-contables.js?v=21.254',
  './assets/logo/marca.svg',
  './assets/icon-192.png',
  './assets/icon-fotos-192.png',
  './assets/icon-pedidos-192.png',
  './assets/icon-conteo-192.png',
  './assets/apple-touch-icon-conteo.png',
  './assets/apple-touch-icon-fotos.png',
  './assets/apple-touch-icon-pedidos.png',
  './assets/favicon-32.png',
  './recepcion-conforme.js?v=21.254',
  './acta-documentos.js?v=21.254',
  './unificar-duplicados.js?v=21.254',
  './actas-entrega.js?v=21.254',
  './oxigeno.js?v=21.254',
  './oxigeno-prestamos.js?v=21.254',
  './oxigeno-ciclos.js?v=21.254',
  './vida-producto.js?v=21.254',
  './editar-ingreso.js?v=21.254',
  './bodega-transitoria.js?v=21.254',
  './assets/logo-acta.png',
  './visor-adquisiciones.js?v=21.254',
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
      .catch(() => caches.match(event.request))
  );
});
