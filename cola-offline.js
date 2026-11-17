/* ==========================================================================
   TRABAJO SIN CONEXIÓN (v21.191)
   Transferencias entre bodegas y ajustes de inventario hechos sin internet quedan en una cola en el teléfono
   (localStorage) y se aplican solos cuando vuelve la conexión: al detectar internet, cada 30 minutos y con
   «Sincronizar ahora». Cada operación se aplica con su transacción normal y el stock real del momento: si ya no
   alcanza, queda marcada para revisar (no se descuenta a ciegas).
   Para no duplicar, la decisión «guardar en cola» se toma ANTES de intentar (prueba de conexión), nunca a mitad de una operación.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const CLAVE = 'sar-cola-v1', esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ejecutores = {};
  let procesando = false;

  // ---------------- almacenamiento ----------------
  function leer() { try { const l = JSON.parse(localStorage.getItem(CLAVE) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function guardar(l) { try { localStorage.setItem(CLAVE, JSON.stringify(l)); } catch (e) { /* lleno o bloqueado */ } pintarChip(); }
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || ''; };

  /** ¿Hay internet de verdad? (wifi sin salida también cuenta como «sin conexión»). */
  async function hayConexion(ms) {
    if (navigator.onLine === false) return false;
    try { await Promise.race([fetch('https://firestore.googleapis.com/?ping=' + Date.now(), { mode: 'no-cors', cache: 'no-store' }), new Promise((_, r) => setTimeout(() => r(new Error('lento')), ms || 5000))]); return true; } catch (e) { return false; }
  }
  /** Guarda una operación para aplicarla después. op = { tipo, titulo, datos } */
  function encolar(op) {
    const l = leer(), id = 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    l.push({ id, tipo: op.tipo, titulo: op.titulo || op.tipo, datos: op.datos || {}, creadoEn: new Date().toISOString(), por: usuario(), estado: 'pendiente', intentos: 0 });
    guardar(l); return id;
  }
  function registrar(tipo, fn) { ejecutores[tipo] = fn; }
  const esDeRed = (e) => /unavailable|offline|network|failed to fetch|deadline|timeout|lento|sin conexi/i.test(String((e && (e.code || '')) + ' ' + (e && e.message || e)));

  /** Aplica lo pendiente, en el orden en que se hizo. Devuelve {ok, error, quedan}. */
  /** Una sola pestaña a la vez aplica la cola (Web Locks; si el navegador no lo tiene, sigue como antes). */
  function procesar(opc) {
    if (navigator.locks && navigator.locks.request) return navigator.locks.request('sar-cola', { ifAvailable: true }, (l) => l ? procesarUna(opc) : { ok: 0, error: 0, quedan: pendientes().length, ocupado: true });
    return procesarUna(opc);
  }
  async function procesarUna(opc) {
    const o = opc || {}; if (procesando) return { ok: 0, error: 0, quedan: pendientes().length };
    if (!pendientes().length) return { ok: 0, error: 0, quedan: 0 };
    if (!usuario() || !(await hayConexion())) return { ok: 0, error: 0, quedan: pendientes().length, sinRed: true };
    procesando = true; pintarChip(); let ok = 0, err = 0;
    try {
      for (const op of leer().filter(x => x.estado === 'pendiente' || (o.reintentarErrores && x.estado === 'error'))) {
        const fn = ejecutores[op.tipo]; if (!fn) continue;
        try { await fn(op.datos, op); ok++; guardar(leer().filter(x => x.id !== op.id)); }
        catch (e) {
          if (esDeRed(e)) break;   // se cortó otra vez: lo que queda sigue pendiente
          err++; guardar(leer().map(x => x.id === op.id ? { ...x, estado: 'error', error: (e && e.message) || String(e), intentos: (x.intentos || 0) + 1 } : x));
        }
      }
    } finally { procesando = false; pintarChip(); }
    if (ok) { try { localStorage.setItem('sar-cola-ult', JSON.stringify({ en: new Date().toISOString(), ok })); } catch (e) { /* sin almacenamiento */ } }
    window.dispatchEvent(new Event('sar-avisos'));
    if ((ok || err) && typeof window.showToast === 'function') window.showToast('Sincronización', `${ok} operación(es) hechas sin conexión ya aplicadas${err ? ` · ${err} para revisar` : ''}.`, err ? 'warning' : 'success');
    if (ok && typeof window.loadFirstPage === 'function') try { window.loadFirstPage(); } catch (e) { /* sin tabla */ }
    return { ok, error: err, quedan: pendientes().length };
  }
  const pendientes = () => leer().filter(x => x.estado === 'pendiente' || x.estado === 'error');

  // ---------------- indicador y panel ----------------
  function pintarChip() {
    if (!document.body) return; let c = document.getElementById('cola-chip'); const l = pendientes(), err = l.filter(x => x.estado === 'error').length;
    if (!l.length) { if (c) c.remove(); return; }
    if (!c) { c = document.createElement('button'); c.type = 'button'; c.id = 'cola-chip'; c.className = 'cola-chip'; c.addEventListener('click', abrirPanel); document.body.appendChild(c); }
    c.classList.toggle('cola-chip--err', !!err);
    c.innerHTML = `<i class="ph-bold ${procesando ? 'ph-arrows-clockwise cola-gira' : 'ph-cloud-slash'}"></i> ${procesando ? 'Sincronizando…' : `${l.length} sin sincronizar${err ? ` · ${err} para revisar` : ''}`}`;
  }
  function abrirPanel() {
    const ov = document.createElement('div'); ov.className = 'sar-conf'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const pinta = () => { const l = pendientes(); ov.innerHTML = `<div class="sar-conf__c cola-pan"><h3 class="sar-conf__t">Hecho sin conexión</h3><p class="sar-conf__x">Se aplica solo al volver internet (y cada 30 minutos). Si algo quedó «para revisar», el stock cambió entre medio: reintenta o descártalo.</p>
      <ul class="sar-conf__l">${l.map(x => `<li><b>${esc(x.titulo)}</b><br><small>${esc(new Date(x.creadoEn).toLocaleString('es-CL'))}${x.estado === 'error' ? ` · <span class="cola-e">Para revisar: ${esc(x.error)}</span>` : ' · pendiente'}</small>${x.estado === 'error' ? ` <button type="button" class="btn btn-secondary btn-sm" data-des="${esc(x.id)}">Descartar</button>` : ''}</li>`).join('') || '<li>Todo sincronizado.</li>'}</ul>
      <div class="sar-conf__b"><button type="button" class="btn btn-secondary" data-cer="1">Cerrar</button><button type="button" class="btn btn-primary" data-sync="1">Sincronizar ahora</button></div></div>`; };
    pinta();
    ov.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (e.target === ov || (b && b.dataset.cer)) { ov.remove(); return; } if (!b) return;
      if (b.dataset.des) { if (!confirm('¿Descartar esta operación? No se aplicará.')) return; guardar(leer().filter(x => x.id !== b.dataset.des)); pinta(); }
      if (b.dataset.sync) { b.disabled = true; b.textContent = 'Sincronizando…'; const r = await procesar({ reintentarErrores: true }); if (r.sinRed && window.showToast) window.showToast('Sin conexión', 'Todavía no hay internet. Se intentará de nuevo solo.', 'warning'); pinta(); }
    });
    document.body.appendChild(ov);
  }

  // ---------------- ejecutores ----------------
  // idMov = id de la operación: si dos pestañas o un reintento la aplican, la segunda ve el movimiento ya creado y no mueve de nuevo (v21.212)
  registrar('traspaso', async (d, op) => { if (!window.SAR_Traspaso || !window.SAR_Traspaso.moverUno) throw new Error('sin conexión: módulo de transferencias aún no cargado'); try { await window.SAR_Traspaso.moverUno(d.id, d.desde, d.hasta, d.lotes, (d.nota ? d.nota + ' · ' : '') + 'hecho sin conexión el ' + new Date(d.en || Date.now()).toLocaleString('es-CL'), { idMov: op && op.id }); } catch (e) { if (!e.ya) throw e; } });
  registrar('ajuste', async (d, op) => {   /* v21.230: idempotente con op.id (un reintento tras corte no descuenta dos veces) */
    const f = window.firebaseFirestore, db = window.firebaseDb, G = window.SAR_Gobernanza;
    const snap = await f.getDoc(f.doc(f.collection(db, 'Insumos'), d.docId)); if (!snap.exists()) throw new Error('El producto ya no existe.');
    const stock = Number(snap.data().quantity) || 0; if (stock + d.cantidad < 0) throw new Error(`Hoy hay ${stock}: el ajuste de ${d.cantidad} dejaría stock negativo.`);
    const cod = d.codigo || (G ? await G.codigo('AJU') : null), just = `${d.justificacion} · hecho sin conexión el ${new Date(d.en).toLocaleString('es-CL')}`;
    if (!d.codigo && cod) guardar(leer().map(x => x.id === (op && op.id) ? { ...x, datos: { ...x.datos, codigo: cod } } : x));   /* el mismo código en cada reintento */
    let aplicado = true;
    if (d.directo) { if (!window.ejecutarAjusteDirecto) throw new Error('sin conexión: módulo de ajustes aún no cargado'); try { await window.ejecutarAjusteDirecto(d.docId, stock, d.nombre, d.cantidad, just, cod, { idMov: op && op.id }); } catch (e) { if (!e.ya) throw e; aplicado = false; } }
    else { const ref = f.doc(f.collection(db, 'Solicitudes_Ajuste'), 'cola-' + ((op && op.id) || Date.now())); const ya = await f.getDoc(ref).catch(() => null); if (ya && ya.exists()) aplicado = false; else await f.setDoc(ref, { code: cod || (window.SAR_Folio ? window.SAR_Folio.provisional('AJU') : 'ADJ-' + Math.floor(10000 + Math.random() * 90000)), insumoId: d.docId, insumoName: d.nombre, cantidad: d.cantidad, justificacion: just, previousStock: stock, projectedStock: stock + d.cantidad, status: 'pendiente', date: f.serverTimestamp(), requester: usuario() }); }
    if (aplicado && G && d.motivo) await G.registrar({ nombre: d.nombre, delta: d.cantidad, codigo: cod, motivo: d.motivo, nota: d.nota, origen: 'AJUSTE', antes: stock, despues: stock + d.cantidad, insumoId: d.docId }).catch(() => {});   // después del ajuste, una sola vez
  });

  // ---------------- disparadores ----------------
  window.addEventListener('online', () => setTimeout(() => procesar(), 2000));
  setInterval(() => { if (pendientes().length) procesar(); }, 30 * 60 * 1000);
  const alIniciar = () => { pintarChip(); let n = 0; const t = setInterval(() => { n++; if (usuario() || n > 60) { clearInterval(t); if (usuario()) procesar(); } }, 2000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', alIniciar); else alIniciar();

  window.SAR_Cola = { encolar, registrar, procesar, pendientes, hayConexion, abrirPanel };
})(window, document);
