/* ==========================================================================
   BÚSQUEDA AUTOMÁTICA DE FOTOS (v21.194)
   Mientras alguien de bodega (admin/operador) tenga el visor abierto, cada 30 minutos entre las 8:00 y las 17:00 se buscan
   en segundo plano las fotos de los productos que no tienen (por código en la tienda de Convenio Marco o por descripción
   con el Apps Script). Un solo equipo lo hace cada vez: el turno se reserva en Contadores/fotos-auto.
   Lo hallado se ve de inmediato en todo el sitio con la marca «por confirmar» y se confirma o descarta en Catálogo; al terminar se vuelve a publicar la lista para quienes piden insumos.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const HORA_INI = 8, HORA_FIN = 17, CADA_MS = 28 * 60 * 1000, RONDAS = 10;   // cada 30 min, hasta 400 productos por vez
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || ''; };
  const esStaff = () => ['admin', 'superadmin', 'operador'].includes(String((document.body && document.body.getAttribute('data-user-role')) || '').toLowerCase());
  let corriendo = false;

  /** Lógica pura: ¿toca buscar ahora? (dentro del horario y pasada una hora desde la última vez). */
  function tocaAhora(ahora, ultimoISO) {
    const h = ahora.getHours(); if (h < HORA_INI || h >= HORA_FIN) return false;
    const u = ultimoISO ? new Date(ultimoISO).getTime() : 0; return !(u && ahora.getTime() - u < CADA_MS);
  }
  /** Reserva el turno de esta hora (para que no lo hagan dos equipos a la vez). */
  async function reservar() {
    const f = fs(), ref = f.doc(f.collection(db(), 'Contadores'), 'fotos-auto');
    return f.runTransaction(db(), async (tx) => { const s = await tx.get(ref), d = s.exists() ? s.data() : {}; if (!tocaAhora(new Date(), d.ultimo)) return false; tx.set(ref, { ...d, ultimo: new Date().toISOString(), por: usuario() }); return true; });
  }
  async function ciclo() {
    if (corriendo || !esStaff() || !usuario() || navigator.onLine === false) return;
    if (!tocaAhora(new Date(), null) || !window.SAR_SeguimientoOC || !window.SAR_SeguimientoOC.buscarFotosFaltantes) return;
    let ok = false; try { ok = await reservar(); } catch (e) { return; } if (!ok) return;
    corriendo = true; const bg = window.SAR_Progreso && window.SAR_Progreso.segundoPlano ? window.SAR_Progreso.segundoPlano('Fotos (automático)') : null;
    let tot = 0, enc = 0, r = { pendientes: 0 };
    try {
      for (let i = 1; i <= RONDAS; i++) { r = await window.SAR_SeguimientoOC.buscarFotosFaltantes((t) => bg && bg.paso(`Ronda ${i} · ${t}`), 40); tot += r.buscados; enc += r.encontrados; if (!r.pendientes || !r.buscados) break; }
      const f = fs(); await f.setDoc(f.doc(f.collection(db(), 'Contadores'), 'fotos-auto'), { ultimo: new Date().toISOString(), por: usuario(), buscados: tot, encontrados: enc, quedan: r.pendientes || 0 }, { merge: true }).catch(() => {});
      try { localStorage.setItem('sar-fotos-ult', JSON.stringify({ en: new Date().toISOString(), tot, enc })); } catch (e) { /* sin almacenamiento */ } window.dispatchEvent(new Event('sar-avisos'));
      if (bg) bg.listo(tot ? `${enc} foto(s) nueva(s) de ${tot} buscadas${enc ? ' · confírmalas en Catálogo' : ''}` : 'Todos los productos ya tienen foto');
      if (enc && typeof window.showToast === 'function') window.showToast('Fotos encontradas', `${enc} foto(s) nueva(s) quedaron por confirmar en Catálogo.`, 'info');
      if (window.SAR_Solicitudes && window.SAR_Solicitudes.publicarCatalogo) window.SAR_Solicitudes.publicarCatalogo(true).catch(() => {});
      if (window.SAR_CatalogoVista) window.SAR_CatalogoVista.recargar();
    } catch (e) { if (bg) bg.error((e && e.message) || String(e)); }
    finally { corriendo = false; }
  }
  if (typeof module === 'undefined' && typeof document.addEventListener === 'function') {   // solo en el navegador
    setTimeout(ciclo, 90 * 1000);            // un rato después de abrir (que cargue todo)
    setInterval(ciclo, 10 * 60 * 1000);      // revisa cada 10 min si ya toca
  }
  window.SAR_FotosAuto = { tocaAhora, ciclo };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SAR_FotosAuto;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: null });
