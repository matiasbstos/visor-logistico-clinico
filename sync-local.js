/* ==========================================================================
   DATOS LOCALES SIEMPRE AL DÍA (v21.196)
   Al abrir el visor, al volver internet y cada 30 minutos con conexión, descarga a este equipo (caché de Firestore)
   todo lo que bodega necesita para trabajar sin internet, y sube lo hecho sin conexión (cola de SAR_Cola; las
   escrituras normales las sube Firestore solo). La insignia de arriba («Nube…») muestra el estado y al tocarla sincroniza.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || ''; };
  const rol = () => String((document.body && document.body.getAttribute('data-user-role')) || '').toLowerCase();
  const CLAVE = 'sar-sync-ult', MIN_ENTRE = 10 * 60 * 1000;
  // [colección, etiqueta, límite, ordenar por fecha desc]
  const PARTES_STAFF = [['Insumos', 'Inventario', 5000], ['Bodegas', 'Bodegas', 200], ['Asignaciones_Ubicacion', 'Ubicaciones', 5000], ['Catalogo_Productos', 'Catálogo', 3000],
    ['Solicitudes_Insumos', 'Solicitudes', 1000], ['Actas_Entrega', 'Actas', 800], ['Seguimiento_OC', 'Órdenes', 400], ['Contadores', 'Distribuciones y contadores', 2000],
    ['Centros_Entrega', 'Centros', 500], ['Historial_Movimientos', 'Movimientos recientes', 3000, 'date']];
  const PARTES_BASICO = [['Insumos', 'Inventario', 5000], ['Bodegas', 'Bodegas', 200], ['Asignaciones_Ubicacion', 'Ubicaciones', 5000]];
  let corriendo = false;

  const hora = (iso) => iso ? new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '';
  function badge(estado, txt) {
    const b = document.querySelector('.status-badge'); if (!b) return;
    if (!b.dataset.sync) { b.dataset.sync = '1'; b.style.cursor = 'pointer'; b.setAttribute('role', 'button'); b.tabIndex = 0; b.title = 'Toca para descargar y subir ahora'; b.addEventListener('click', () => sincronizar({ forzar: true, aviso: true })); }
    const ico = { ok: 'ph-cloud-check', sin: 'ph-cloud-slash', bajando: 'ph-cloud-arrow-down' }[estado] || 'ph-cloud-check';
    b.classList.toggle('status-badge--sin', estado === 'sin'); b.classList.toggle('status-badge--bajando', estado === 'bajando');
    b.innerHTML = `<i class="ph-fill ${ico}"></i><span>${txt}</span>`;
  }
  const ultimo = () => { try { return localStorage.getItem(CLAVE) || ''; } catch (e) { return ''; } };
  function pintarReposo() { const u = ultimo(); badge(navigator.onLine === false ? 'sin' : 'ok', navigator.onLine === false ? `Sin conexión${u ? ' · datos de las ' + hora(u) : ''}` : `Nube actualizada${u ? ' · ' + hora(u) : ''}`); }

  /** Descarga todo a local y sube lo pendiente. opc: {forzar, aviso} */
  async function sincronizar(opc) {
    const o = opc || {}; if (corriendo || !usuario() || !fs() || !db()) return;
    const u = ultimo(); if (!o.forzar && u && Date.now() - new Date(u).getTime() < MIN_ENTRE) return pintarReposo();
    const red = window.SAR_Cola ? await window.SAR_Cola.hayConexion() : navigator.onLine !== false;
    if (!red) { pintarReposo(); if (o.aviso && window.showToast) window.showToast('Sin conexión', 'Se sincronizará solo al volver internet.', 'warning'); return; }
    corriendo = true; const f = fs(), partes = ['admin', 'superadmin', 'operador'].includes(rol()) ? PARTES_STAFF : PARTES_BASICO; let n = 0, k = 0;
    try {
      if (window.SAR_Cola) { badge('bajando', 'Subiendo lo hecho sin conexión…'); await window.SAR_Cola.procesar().catch(() => {}); }
      for (const [col, txt, lim, ord] of partes) {
        badge('bajando', `Descargando ${txt} (${++k}/${partes.length})`);
        try { const q = ord ? f.query(f.collection(db(), col), f.orderBy(ord, 'desc'), f.limit(lim)) : f.query(f.collection(db(), col), f.limit(lim)); const sn = await f.getDocs(q); n += sn.size; } catch (e) { /* sin permiso para esa colección: sigue */ }
      }
      if (window.SAR_Solicitudes && window.SAR_Solicitudes.publicarCatalogo && partes === PARTES_STAFF) await window.SAR_Solicitudes.publicarCatalogo().catch(() => {});
      if (window.SAR_Imagenes) await window.SAR_Imagenes.cargar(true).catch(() => {});
      if (partes === PARTES_STAFF) { try { const pc = await f.getDocs(f.query(f.collection(db(), 'Catalogo_Productos'), f.where('fotoEstado', '==', 'por_confirmar'), f.limit(2000))); window.SAR_FotosPorConfirmar = pc.size; } catch (e) { /* sin permiso */ } }
      window.dispatchEvent(new Event('sar-avisos'));
      try { localStorage.setItem(CLAVE, new Date().toISOString()); } catch (e) { /* sin almacenamiento */ }
      if (o.aviso && window.showToast) window.showToast('Sincronizado', `${n} registros guardados en este equipo y cambios subidos.`, 'success');
    } finally { corriendo = false; pintarReposo(); }
  }

  if (typeof module === 'undefined' && typeof document.addEventListener === 'function') {   // solo en el navegador
    const arrancar = () => { let i = 0; const t = setInterval(() => { i++; if (usuario() || i > 90) { clearInterval(t); if (usuario()) setTimeout(() => sincronizar({ forzar: true }), 15000); } }, 2000); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
    window.addEventListener('online', () => { pintarReposo(); setTimeout(() => sincronizar({ forzar: true }), 3000); });
    window.addEventListener('offline', pintarReposo);
    setInterval(() => sincronizar({ forzar: true }), 30 * 60 * 1000);
  }
  window.SAR_Sync = { sincronizar };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: null });
