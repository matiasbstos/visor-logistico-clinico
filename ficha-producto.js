/* ==========================================================================
   FICHA DE PRODUCTO (v21.190)
   Clic en un producto del Catálogo: foto, stock total, stock por bodega/estante/lote/vencimiento,
   cuándo y cómo ingresó, último movimiento y los movimientos recientes (Historial_Movimientos).
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v) || 0;
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const soloDig = (t) => String(t || '').replace(/\D/g, '');
  const TIPOS = { INGRESO_PROVEEDOR: 'Ingreso de proveedor', INGRESO_INVENTARIO: 'Ingreso de inventario', RECEPCION_OC: 'Recepción de orden', INGRESO: 'Ingreso', EGRESO: 'Salida', SALIDA: 'Salida', TRASPASO: 'Traspaso', traspaso: 'Traspaso', TRANSFERENCIA: 'Transferencia', AJUSTE: 'Ajuste', ACTA_ENTREGA: 'Acta de entrega', ENTREGA_ACTA: 'Acta de entrega', TRANSITORIA_FALTANTE: 'Faltante bodega transitoria', CUADRE_SOBREGIRO: 'Cuadre de sobregiro', MERMA: 'Merma' };
  const tipoTxt = (t) => TIPOS[t] || String(t || '—').replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
  const esIngreso = (t) => /INGRESO|RECEP/i.test(String(t || ''));

  // ---------------- lógica pura ----------------
  /** Fecha de un movimiento (Timestamp de Firestore, Date, número o texto) → Date | null. */
  function fechaDe(v) { if (!v) return null; if (typeof v.toDate === 'function') return v.toDate(); if (typeof v.seconds === 'number') return new Date(v.seconds * 1000); const d = new Date(v); return isNaN(d) ? null : d; }
  /** Filas de stock por bodega · estante · lote · vencimiento, ordenadas por vencimiento (lo que vence antes, primero). */
  function filasStock(docs) {
    const out = [];
    (docs || []).forEach(d => {
      const lotes = (d.batches || []).filter(b => num(b.quantity) > 0);
      if (lotes.length) lotes.forEach(b => out.push({ bodega: d.location || 'Sin bodega', estante: d.ubicacionEstante || '', lote: b.batch || 'S/L', vence: b.expirationDate || '', cantidad: num(b.quantity) }));
      else if (num(d.quantity) > 0) out.push({ bodega: d.location || 'Sin bodega', estante: d.ubicacionEstante || '', lote: 'S/L', vence: '', cantidad: num(d.quantity) });
    });
    return out.sort((a, b) => (a.vence || '9999').localeCompare(b.vence || '9999') || a.bodega.localeCompare(b.bodega));
  }
  /** Resumen de movimientos: primer ingreso, último ingreso, último movimiento (lista ya ordenada del más nuevo al más viejo). */
  function resumenMovs(movs) {
    const ing = movs.filter(m => esIngreso(m.type));
    return { primerIngreso: ing[ing.length - 1] || null, ultimoIngreso: ing[0] || null, ultimo: movs[0] || null };
  }
  /** ¿Este documento de Insumos es el mismo producto? por código MP o por nombre. */
  const coincide = (d, nombre, codigo) => (soloDig(codigo) && soloDig(d.codigoMP || d.code) === soloDig(codigo)) || norm(d.name) === norm(nombre);

  // ---------------- pantalla ----------------
  const fmtF = (d) => d ? d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtV = (v) => { if (!v) return '—'; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); return m ? `${m[3]}-${m[2]}-${m[1]}` : esc(v); };
  const venceClase = (v) => { if (!v) return ''; const d = new Date(v), dias = (d - new Date()) / 864e5; return dias < 0 ? 'fp-venc' : dias < 90 ? 'fp-prox' : ''; };
  const comoTxt = (m) => [tipoTxt(m.type), m.document, m.provider ? 'Proveedor ' + m.provider : '', m.origin && !/^Inventario inicial$/i.test(m.origin) ? 'desde ' + m.origin : ''].filter(Boolean).map(esc).join(' · ');

  async function abrir(p) {
    const nombre = p.nombre || p.descripcion || '', codigo = p.codigo || p.codigoMP || '';
    const ov = document.createElement('div'); ov.className = 'fp-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Ficha de ' + nombre);
    ov.innerHTML = `<div class="fp-c"><button type="button" class="fp-x" aria-label="Cerrar">×</button><div class="fp-body">${window.SAR_Progreso ? window.SAR_Progreso.cargando('Buscando stock, lotes y movimientos…') : 'Cargando…'}</div></div>`;
    const cerrar = () => { ov.remove(); document.removeEventListener('keydown', tecla, true); };
    const tecla = (e) => { if (e.key === 'Escape' && !document.querySelector('.prod-zoom')) { e.stopPropagation(); cerrar(); } };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.fp-x')) cerrar(); });
    document.addEventListener('keydown', tecla, true); document.body.appendChild(ov);
    const cuerpo = ov.querySelector('.fp-body'), f = fs();
    try {
      const sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(5000))), docs = [];
      sn.forEach(d => { const x = { id: d.id, ...d.data() }; if (coincide(x, nombre, codigo)) docs.push(x); });
      const nombres = [...new Set([nombre, ...docs.map(d => d.name)].filter(Boolean))].slice(0, 6), movs = [], vistos = new Set();
      for (const n of nombres) { const hs = await f.getDocs(f.query(f.collection(db(), 'Historial_Movimientos'), f.where('insumoName', '==', n), f.limit(300))); hs.forEach(d => { if (vistos.has(d.id)) return; vistos.add(d.id); const m = d.data(); if (m.sinEfectoStock) return; movs.push({ ...m, _f: fechaDe(m.date || m.timestamp || m.fecha) }); }); }
      movs.sort((a, b) => (b._f || 0) - (a._f || 0));
      const filas = filasStock(docs), total = docs.reduce((t, d) => t + num(d.quantity), 0), r = resumenMovs(movs);
      const porBod = {}; filas.forEach(x => { porBod[x.bodega] = (porBod[x.bodega] || 0) + x.cantidad; });
      const cat = (docs.find(d => d.category && d.category !== 'General') || docs[0] || {}).category || '';
      cuerpo.innerHTML = `<div class="fp-cab">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(nombre, { codigo, grande: true }) : ''}<div><h2 class="fp-t">${esc(nombre)}</h2><p class="fp-s">${codigo ? 'Cód. MP ' + esc(codigo) + ' · ' : ''}${cat ? esc(cat) + ' · ' : ''}${docs.length} registro(s) en inventario</p>
          <div class="fp-kpis"><div><b>${total.toLocaleString('es-CL')}</b><span>unidades en stock</span></div><div><b>${Object.keys(porBod).length}</b><span>bodega(s)</span></div><div><b>${filas.length ? fmtV(filas[0].vence) : '—'}</b><span>próximo vencimiento</span></div></div></div></div>
        <h3 class="fp-h">Dónde está y por lote</h3>
        ${filas.length ? `<div class="fp-tw"><table class="fp-tb"><thead><tr><th>Bodega</th><th>Estante</th><th>Lote</th><th>Vence</th><th>Cantidad</th></tr></thead><tbody>${filas.map(x => `<tr><td>${esc(x.bodega)}</td><td>${esc(x.estante || '—')}</td><td>${esc(x.lote)}</td><td class="${venceClase(x.vence)}">${fmtV(x.vence)}</td><td><b>${x.cantidad.toLocaleString('es-CL')}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="fp-v">Sin stock en ninguna bodega.</p>'}
        <h3 class="fp-h">Ingresos y movimientos</h3>
        <div class="fp-res">
          <div><span>Primer ingreso</span><b>${r.primerIngreso ? fmtF(r.primerIngreso._f) : '—'}</b><small>${r.primerIngreso ? comoTxt(r.primerIngreso) + ' · ' + num(r.primerIngreso.quantity) + ' u.' : 'Sin registro de ingreso'}</small></div>
          <div><span>Último ingreso</span><b>${r.ultimoIngreso ? fmtF(r.ultimoIngreso._f) : '—'}</b><small>${r.ultimoIngreso ? comoTxt(r.ultimoIngreso) + ' · ' + num(r.ultimoIngreso.quantity) + ' u.' : ''}</small></div>
          <div><span>Último movimiento</span><b>${r.ultimo ? fmtF(r.ultimo._f) : '—'}</b><small>${r.ultimo ? comoTxt(r.ultimo) + ' · ' + num(r.ultimo.quantity) + ' u.' + (r.ultimo.user ? ' · ' + esc(r.ultimo.user) : '') : 'Sin movimientos'}</small></div>
        </div>
        ${movs.length ? `<div class="fp-tw"><table class="fp-tb"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Cant.</th><th>Lote</th><th>Desde → hacia</th><th>Documento</th><th>Usuario</th></tr></thead><tbody>${movs.slice(0, 25).map(m => `<tr><td>${fmtF(m._f)}</td><td>${esc(tipoTxt(m.type))}</td><td>${num(m.quantity)}</td><td>${esc(m.batch || '—')}</td><td>${esc([m.origin, m.destination || m.dest].filter(Boolean).join(' → ') || '—')}</td><td>${esc(m.document || m.actaId || '—')}</td><td>${esc(m.user || '—')}</td></tr>`).join('')}</tbody></table></div>${movs.length > 25 ? `<p class="fp-v">Mostrando los 25 más recientes de ${movs.length}. El detalle completo está en Historial.</p>` : ''}` : '<p class="fp-v">Sin movimientos registrados.</p>'}`;
      if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(cuerpo);
    } catch (e) { cuerpo.innerHTML = `<p class="fp-v">No pude leer la información (${esc(e.message || e)}).</p>`; }
  }

  window.SAR_Ficha = { abrir, filasStock, resumenMovs, fechaDe };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SAR_Ficha;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : null);
