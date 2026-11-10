/* ==========================================================================
   VIDA DEL PRODUCTO (v21.106) — pestaña en «Informes».
   Se busca un producto por ID (código) o nombre y se ve todo su recorrido en orden cronológico:
   orden de compra (con memo / SDC / CDP), recepciones, ingresos a bodega, traspasos, actas de entrega
   (por firmar / firmadas / anuladas), salidas y descuentos de stock, mermas, ajustes, y el stock actual
   por bodega con sus lotes. Solo lee datos; no modifica nada.
   Fuentes: Seguimiento_OC, Historial_Movimientos, Actas_Entrega, Insumos (caché) y Catalogo_Productos.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v) || 0;
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const soloDig = (t) => String(t || '').replace(/\D/g, '');
  const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };

  /** Fecha cualquiera (Timestamp, Date, ISO, AAAA-MM-DD) → ISO string o ''. */
  function iso(v) {
    if (!v) return '';
    try { if (v.toDate) return v.toDate().toISOString(); if (v instanceof Date) return v.toISOString(); if (typeof v === 'object' && v.seconds) return new Date(v.seconds * 1000).toISOString(); const d = new Date(String(v).length === 10 ? v + 'T12:00:00' : v); return isNaN(d) ? '' : d.toISOString(); } catch (e) { return ''; }
  }
  const fCL = (s) => { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? '—' : d.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }) + (String(s).length > 10 && !/T12:00:00/.test(String(s)) ? ' ' + d.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' }) : ''); };

  /** ¿La línea (texto + código) corresponde al producto buscado? p = {codigos:Set, nombres:Set(norm)} */
  function coincide(nombre, codigo, p) {
    const c = soloDig(codigo); if (c && p.codigos.has(c)) return true;
    const n = norm(nombre); return !!n && p.nombres.has(n);
  }

  const TIPOS = {
    entrada: ['Ingreso a bodega', 'ing'], INGRESO_PROVEEDOR: ['Ingreso de proveedor', 'ing'], INGRESO_INVENTARIO: ['Ingreso a inventario', 'ing'], 'carga masiva': ['Carga masiva', 'ing'],
    traspaso: ['Traspaso entre bodegas', 'mov'], ENTREGA_ACTA: ['Salida por acta de entrega (stock descontado)', 'sal'], CUADRE_SOBREGIRO: ['Cuadre de sobregiro', 'mov'],
    merma_despacho: ['Merma', 'baj'], merma_inventario: ['Merma de inventario', 'baj'], eliminacion_inventario: ['Eliminación de inventario', 'baj'],
    ajuste: ['Ajuste de inventario', 'aju'], AJUSTE_CRITICO: ['Ajuste crítico', 'aju'], auditoria_modificacion_inventario: ['Modificación de inventario', 'aju'], toma_inventario: ['Toma de inventario', 'aju'],
    ANULACION_ACTA: ['Acta anulada (stock devuelto)', 'ing'], salida: ['Salida', 'sal'], TRANSITORIA_FALTANTE: ['Faltante de bodega transitoria', 'baj'], TRANSITORIA_REPOSICION: ['Reposición a bodega transitoria', 'mov'],
    INGRESO_OC: ['Ingreso por orden de compra', 'ing'], UNIFICACION_STOCK: ['Unificación de stock', 'mov'], CAMBIO_CONTROLADO: ['Cambio con código de seguimiento', 'aju']
  };
  const ENTRAN = ['INGRESO_PROVEEDOR', 'INGRESO_OC', 'INGRESO_INVENTARIO', 'entrada', 'carga masiva', 'ANULACION_ACTA'], SALEN = ['ENTREGA_ACTA', 'CUADRE_SOBREGIRO', 'merma_despacho', 'merma_inventario', 'eliminacion_inventario', 'salida', 'TRANSITORIA_FALTANTE'];
  /** Efecto del movimiento sobre el stock total del producto (0 = no cambia el total o no es confiable). */
  function deltaDe(h) { const q = num(h.quantity), t = h.type; if (ENTRAN.includes(t)) return q; if (SALEN.includes(t)) return -Math.abs(q); if (t === 'AJUSTE_CRITICO') return q; if (t === 'CAMBIO_CONTROLADO') return h.origen === 'EDITAR_INSUMO' ? q : 0; return 0; }

  /**
   * Arma la línea de tiempo. datos: { ocs:[…], historial:[…], actas:[…], insumos:[…] }, p: {codigos, nombres}.
   * Devuelve { eventos:[{f, tipo, clase, titulo, detalle, cant}], resumen:{pedido, recibido, ingresado, entregado, merma}, stock:[{bodega, cant, lotes}] }
   */
  function construir(datos, p) {
    const ev = [], res = { pedido: 0, recibido: 0, ingresado: 0, entregado: 0, merma: 0, reservado: 0 };
    (datos.ocs || []).forEach(oc => {
      const idx = (oc.lineas || []).map((l, i) => ({ l, i })).filter(x => coincide(x.l.descripcion, x.l.codigoMP, p) || coincide(x.l.insumoName, x.l.codigoMP, p)); if (!idx.length) return;
      const pedido = idx.reduce((t, x) => t + Object.values(x.l.dist || {}).reduce((s, v) => s + num(v), 0), 0); res.pedido += pedido;
      const refs = [oc.memo && 'memo ' + oc.memo, oc.sdc && 'SDC ' + oc.sdc, oc.cdp && 'CDP ' + oc.cdp].filter(Boolean).join(' · ');
      ev.push({ f: iso(oc.aceptada || oc.emitida || oc.creadoEn), clase: 'oc', titulo: `Orden de compra ${oc.numeroOC || ''}`, detalle: `${oc.proveedor || ''} · pedido total ${pedido} u.${refs ? ' · ' + refs : ''}`, cant: pedido });
      (oc.recepciones || []).filter(r => !r.anulada).forEach(r => {
        const det = (r.detalle || []).filter(d => coincide(d.descripcion, '', p) || coincide(d.insumoName, '', p) || idx.some(x => norm(x.l.descripcion) === norm(d.descripcion)));
        det.forEach(d => { res.recibido += num(d.cantidad); ev.push({ f: iso(r.fecha) || iso(oc.ultimaRecepcion), clase: 'rec', titulo: `Recepción ${r.recId || ''} de la orden ${oc.numeroOC || ''}`, detalle: `${num(d.cantidad)} u.${d.lote ? ' · lote ' + d.lote : ''}${d.vence ? ' · vence ' + d.vence : ''}${r.guia ? ' · guía ' + r.guia : ''}${r.ingresoAStock ? ' · ingresó a ' + (r.bodega || 'bodega') : ''}`, cant: num(d.cantidad) }); });
      });
    });
    (datos.historial || []).forEach(h => {
      const t = TIPOS[h.type] || [String(h.type || 'Movimiento'), 'mov'], cant = num(h.quantity);
      if (t[1] === 'ing') res.ingresado += cant; if (t[1] === 'baj') res.merma += cant; if (h.type === 'ENTREGA_ACTA') res.entregado += cant;
      ev.push({ f: iso(h.date) || iso(h.fechaDocumento), clase: t[1], titulo: t[0], detalle: [`${cant} u.`, h.origin && h.dest ? `${h.origin} → ${h.dest}` : (h.origin || h.dest || ''), h.batch && h.batch !== 'N/A' ? 'lote ' + h.batch : '', h.document ? 'doc. ' + h.document : '', h.historica ? 'acta histórica' : '', h.user ? 'por ' + h.user : ''].filter(Boolean).join(' · '), cant, delta: deltaDe(h), tipo: h.type || '', bodega: h.destination && h.destination !== 'Principal' ? h.destination : (h.dest || h.origin || h.location || ''), lote: h.batch && h.batch !== 'N/A' ? h.batch : '', user: h.user || '', codigo: h.codigoSeguimiento || h.codigoIngreso || h.actaId || '', motivo: [h.motivo, h.nota, h.observacion || h.observations].filter(Boolean).join(' · ') });
    });
    (datos.actas || []).forEach(a => {
      if (a.estado === 'ANULADA') { /* se muestra igual, marcada */ }
      (a.items || []).filter(i => coincide(i.nombre, i.codigoMP, p)).forEach(i => {
        const pend = a.confirmacion && a.confirmacion.estado === 'PENDIENTE';
        if (a.estado === 'EMITIDA' && pend) res.reservado += num(i.cantidad);
        const estado = a.estado === 'ANULADA' ? 'ANULADA' : pend ? 'por confirmar (stock reservado)' : (a.respaldo ? 'firmada, stock descontado' : 'confirmada, sin acta firmada subida');
        ev.push({ f: iso(a.fecha), clase: 'acta', titulo: `Acta ${a.numero} · ${a.centro || ''}`, detalle: `${num(i.cantidad)} u. · ${estado}${a.historica ? ' · histórica' : ''}${i.solicitado && num(i.solicitado) > num(i.cantidad) ? ' · pedido ' + i.solicitado : ''}`, cant: num(i.cantidad), delta: 0, tipo: 'ACTA', bodega: a.bodegaOrigen || '', codigo: a.numero || '', motivo: 'Acta de entrega · ' + estado });
      });
    });
    ev.sort((x, y) => String(x.f || '9').localeCompare(String(y.f || '9')));
    const stock = (datos.insumos || []).map(i => ({ bodega: i.location || '—', cant: num(i.quantity), lotes: (i.batches || []).filter(b => num(b.quantity) > 0).map(b => ({ batch: b.batch || 'S/L', cant: num(b.quantity), vence: b.expirationDate || '' })), estado: i.status || '' }));
    return { eventos: ev, resumen: res, stock };
  }

  /** Libro contable (kárdex): eventos ordenados con entrada, salida y saldo corrido. Las órdenes y recepciones se muestran sin mover el saldo. */
  function libro(eventos) {
    let saldo = 0;
    return (eventos || []).slice().sort((x, y) => String(x.f || '9').localeCompare(String(y.f || '9'))).map(e => {
      const d = num(e.delta); saldo += d;
      return { ...e, entra: d > 0 ? d : 0, sale: d < 0 ? -d : 0, saldo, mueve: d !== 0 };
    });
  }

  // ---------------- datos ----------------
  let catalogo = null;
  async function cargarCatalogo() {
    if (catalogo) return catalogo; catalogo = [];
    try { const sn = await fs().getDocs(fs().query(fs().collection(db(), 'Catalogo_Productos'), fs().limit(3000))); sn.forEach(d => catalogo.push(d.data())); } catch (e) { /* sin catálogo */ }
    return catalogo;
  }
  /** Sugerencias por ID o nombre: [{nombre, codigo}] sin repetir. */
  async function sugerencias(q) {
    const t = norm(q).split(' ').filter(Boolean), d = soloDig(q); if (!t.length) return [];
    const mapa = new Map(), cat = await cargarCatalogo();
    const agrega = (nombre, codigo) => { const n = String(nombre || '').trim(); if (!n) return; const k = (soloDig(codigo) || '') + '|' + norm(n); if (!mapa.has(k)) mapa.set(k, { nombre: n, codigo: soloDig(codigo) }); };
    (window.insumosDataCache || []).forEach(i => agrega(i.name, i.codigoMP || i.code));
    cat.forEach(c => agrega(c.descripcion || c.insumoName, c.codigoMP));
    return [...mapa.values()].filter(x => (d.length >= 4 && x.codigo && x.codigo.includes(d)) || t.every(w => norm(x.nombre).includes(w))).slice(0, 14);
  }
  async function reunir(sel) {
    const f = fs(), p = { codigos: new Set(sel.codigo ? [soloDig(sel.codigo)] : []), nombres: new Set([norm(sel.nombre)]) };
    // alias: mismo código en insumos / catálogo
    const cat = await cargarCatalogo();
    cat.forEach(c => { const cod = soloDig(c.codigoMP); if ((cod && p.codigos.has(cod)) || norm(c.descripcion) === norm(sel.nombre) || norm(c.insumoName) === norm(sel.nombre)) { if (cod) p.codigos.add(cod); [c.descripcion, c.insumoName].forEach(n => { if (n) p.nombres.add(norm(n)); }); } });
    const insumos = (window.insumosDataCache || []).filter(i => coincide(i.name, i.codigoMP || i.code, p));
    insumos.forEach(i => p.nombres.add(norm(i.name)));
    const nombresReales = [...new Set([sel.nombre, ...insumos.map(i => i.name), ...cat.filter(c => coincide(c.descripcion, c.codigoMP, p)).map(c => c.insumoName).filter(Boolean)])].slice(0, 10);
    const [ocs, actas, historial] = await Promise.all([
      f.getDocs(f.collection(db(), 'Seguimiento_OC')).then(sn => { const l = []; sn.forEach(d => l.push({ id: d.id, ...d.data() })); return l; }).catch(() => []),
      f.getDocs(f.query(f.collection(db(), 'Actas_Entrega'), f.orderBy('creadoEn', 'desc'), f.limit(400))).then(sn => { const l = []; sn.forEach(d => l.push(d.data())); return l; }).catch(() => []),
      nombresReales.length ? f.getDocs(f.query(f.collection(db(), 'Historial_Movimientos'), f.where('insumoName', 'in', nombresReales), f.limit(600))).then(sn => { const l = []; sn.forEach(d => l.push(d.data())); return l; }).catch(() => []) : Promise.resolve([])
    ]);
    return { p, datos: { ocs, actas, historial, insumos } };
  }

  // ---------------- interfaz ----------------
  const CLASES = { oc: 'var(--sar-blue)', rec: 'var(--sar-green)', ing: 'var(--sar-green)', mov: 'var(--sar-blue)', sal: 'var(--sar-orange)', baj: 'var(--sar-red)', aju: 'var(--sar-yellow)', acta: 'var(--sar-orange)' };
  function html(sel, r) {
    const s = r.resumen, tot = r.stock.reduce((t, x) => t + x.cant, 0);
    const k = (n, t, c) => `<div class="vp-k" style="--c:${c}"><b>${n}</b><span>${t}</span></div>`;
    return `<div class="vp-cab"><h3>${esc(sel.nombre)}</h3><small>${sel.codigo ? 'ID ' + esc(sel.codigo) : 'sin ID'}</small></div>
      <div class="vp-ks">${k(s.pedido, 'Pedido en órdenes', 'var(--sar-blue)')}${k(s.recibido, 'Recibido', 'var(--sar-green)')}${k(s.entregado, 'Entregado por actas', 'var(--sar-orange)')}${k(s.reservado, 'Reservado (por confirmar)', 'var(--sar-yellow)')}${k(s.merma, 'Mermas / bajas', 'var(--sar-red)')}${k(tot, 'Stock actual', 'var(--sar-blue)')}</div>
      <h4>Stock actual por bodega</h4>${r.stock.length ? `<ul class="vp-stock">${r.stock.map(x => `<li><b>${esc(x.bodega)}</b> · ${x.cant} u.${x.lotes.length ? ' <small>' + x.lotes.map(l => esc(l.batch) + ' (' + l.cant + (l.vence ? ', vence ' + esc(l.vence) : '') + ')').join(' · ') + '</small>' : ''}</li>`).join('')}</ul>` : '<p class="act-hint">No figura en el inventario actual.</p>'}
      <h4>Recorrido (${r.eventos.length} eventos)</h4>${r.eventos.length ? `<ol class="vp-tl">${r.eventos.map(e => `<li style="--c:${CLASES[e.clase] || 'var(--sar-blue)'}"><time>${esc(fCL(e.f))}</time><b>${esc(e.titulo)}</b><span>${esc(e.detalle)}</span></li>`).join('')}</ol>` : '<p class="act-hint">Sin movimientos registrados para este producto.</p>'}`;
  }
  async function elegir(root, sel) {
    const out = root.querySelector('#vp-out'); out.innerHTML = '<p class="act-hint">Reuniendo el recorrido del producto…</p>';
    try { const { p, datos } = await reunir(sel); out.innerHTML = html(sel, construir(datos, p)); } catch (e) { out.innerHTML = `<p class="act-err">No se pudo armar el recorrido: ${esc(e.message || e)}</p>`; }
  }
  function montar() {
    const cont = document.querySelector('#view-informes .dashboard-container'); if (!cont || document.getElementById('vp-root')) return;
    const root = document.createElement('section'); root.id = 'vp-root'; root.className = 'vp-root'; root.hidden = true;
    root.innerHTML = `<h2>Vida del producto</h2><p class="act-hint">Busca por ID o nombre y mira todo su recorrido: orden de compra, recepción, ingreso, traspasos, actas de entrega y descuentos de stock.</p>
      <div class="vp-bus"><input type="search" id="vp-q" class="form-control" placeholder="ID o nombre del producto…" autocomplete="off" aria-label="Buscar producto"></div><div id="vp-sug" class="vp-sug"></div><div id="vp-out"></div>`;
    cont.appendChild(root);
    let tmr = null; const q = root.querySelector('#vp-q'), sug = root.querySelector('#vp-sug');
    q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(async () => { const l = await sugerencias(q.value); sug.innerHTML = l.length ? l.map((x, i) => `<button type="button" class="vp-op" data-i="${i}"><b>${esc(x.nombre)}</b>${x.codigo ? ' <small>ID ' + esc(x.codigo) + '</small>' : ''}</button>`).join('') : (q.value.trim() ? '<p class="act-hint">Sin coincidencias.</p>' : ''); sug.querySelectorAll('.vp-op').forEach(b => b.addEventListener('click', () => { sug.innerHTML = ''; elegir(root, l[+b.dataset.i]); })); }, 250); });
    const tabs = document.getElementById('informes-tabs');
    if (tabs && !tabs.querySelector('[data-report="vida"]')) { const a = document.createElement('a'); a.href = '#'; a.className = 'tab-link'; a.dataset.report = 'vida'; a.innerHTML = '<i class="ph ph-path"></i> Vida del producto'; tabs.appendChild(a); }
    tabs.addEventListener('click', (e) => { const a = e.target.closest('.tab-link'); if (!a) return; e.preventDefault(); const vida = a.dataset.report === 'vida'; cont.classList.toggle('vp-activa', vida); root.hidden = !vida; if (vida) setTimeout(() => q.focus(), 50); });
  }
  if (typeof document !== 'undefined' && document.addEventListener) { document.addEventListener('DOMContentLoaded', montar); setTimeout(montar, 1500); setTimeout(montar, 5000); }

  const api = { construir, coincide, iso, norm, soloDig, montar, sugerencias, reunir, libro, deltaDe, TIPOS };
  if (typeof window !== 'undefined') window.SAR_VidaProducto = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
