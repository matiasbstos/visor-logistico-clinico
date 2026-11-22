/* ==========================================================================
   TOMA DE INVENTARIO · PANTALLA (v21.246) — DECISIONES 4.302
   Reemplaza la toma anterior (que SUMABA lo contado al stock). Flujo:
   1) Abrir toma: bodega + tipo (completa: lo no contado = 0 · parcial: lo no contado no cambia).
   2) Contar: pistola (etiqueta BUL o código), cámara (QR) o búsqueda con foto. Por cada producto se ve, lote por lote,
      lo que dice el sistema y cómo se va descontando lo pistoleado («quedan N» / «sobran N»). El conteo es local
      (sirve sin internet) y no toca el stock.
   3) Cerrar toma: conciliar() por lote contra lo que había AL CONTAR; > 5 % o > 10 u. (o controlado) pide recontar;
      sobrantes y lotes nuevos entran con el cierre (AJU); faltantes los aprueba el superadministrador
      (si quien cierra lo es, se aplican al tiro). Sin internet, el cierre queda en la cola y se aplica solo.
   Sin duplicar: cada ajuste lleva idMov fijo toma-<id>-<insumo>-<lote|mes> (ejecutarAjusteDirecto no lo aplica dos veces),
   cada solicitud de ajuste usa id fijo, y cada lote debe seguir con lo que tenía al contar (esperadoLote): un segundo cierre
   de la misma bodega, o un movimiento entre el conteo y el cierre, se rechaza y pide volver a contar ese producto.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const T = () => window.SAR_Toma;
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || ''; };
  const rol = () => String((document.body && document.body.dataset.userRole) || '').toLowerCase();
  const esSuper = () => rol() === 'superadmin';
  const esAdmin = () => ['admin', 'superadmin', 'administrador', 'global'].includes(rol());   /* = isAdmin() de las reglas (el ajuste escribe en Auditoria) */
  const toast = (t, m, k) => { if (window.showToast) window.showToast(t, m, k || 'info'); };
  const fmtV = (v) => { const m = /^(\d{4})-(\d{2})/.exec(String(v || '')); return m ? `${m[2]}/${m[1]}` : (v === 'N/A' || !v ? 'sin venc.' : String(v)); };
  const CLAVE = 'sar-toma-v2', MOTIVO = 'Conteo físico (toma de inventario)';
  const ESTADO = { ok: ['Coincide', 'tm-ok'], sobra: ['Sobran', 'tm-sobra'], falta: ['Faltan', 'tm-falta'], nuevo: ['Lote nuevo', 'tm-sobra'], sin_contar: ['Sin contar', 'tm-gris'] };

  let toma = null, insumos = [], bodegas = [], sel = null, loteSel = null, q = '', cerrando = false, vista = 'contar';
  const leerToma = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || 'null'); } catch (e) { return null; } };
  const guardarToma = () => { try { if (toma) localStorage.setItem(CLAVE, JSON.stringify(toma)); else localStorage.removeItem(CLAVE); } catch (e) { toast('Sin espacio', 'No se pudo guardar el conteo en este equipo.', 'error'); } };
  const root = () => document.getElementById('toma2-root');
  const foto = (n, c) => window.SAR_Imagenes && window.SAR_Imagenes.thumb ? window.SAR_Imagenes.thumb(n || '', { codigo: c || '' }) : '';
  const rellenar = (el) => { const I = window.SAR_Imagenes; if (I && I.cargar) I.cargar().then(() => I.rellenar(el)).catch(() => {}); };

  async function cargar() {
    const f = fs(); if (!f) return;
    const sb = await f.getDocs(f.collection(db(), 'Bodegas')); bodegas = []; sb.forEach(d => { const x = d.data(); if (x.name && !x.archivada) bodegas.push({ id: d.id, name: x.name }); });
    bodegas.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (toma) await cargarInsumos();
  }
  async function cargarInsumos() {
    const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('location', '==', toma.bodega)));
    insumos = []; sn.forEach(d => { const x = d.data(); if (x.status === 'ELIMINADO') return; insumos.push({ id: d.id, ...x }); });
    insumos.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
  }
  const lotesDe = (x) => (Array.isArray(x.batches) && x.batches.length ? x.batches : (num(x.quantity) ? [{ batch: x.batch || 'S/L', quantity: num(x.quantity), expirationDate: x.expirationDate || 'N/A' }] : [])).map(b => ({ batch: b.batch, quantity: num(b.quantity), expirationDate: b.expirationDate }));
  /** Lo que el sistema decía de ese producto cuando se empezó a contar (la diferencia se calcula contra esto). */
  const snapDe = (x) => ({ batches: lotesDe(x), reservado: num(x.reservado), deuda: num(x.sobregiro), en: new Date().toISOString() });
  const fichaDe = (x, rec) => ({ nombre: x.name, codigo: x.codigoMP || '', controlado: !!x.controlado, snap: snapDe(x), conteos: [], recontado: rec || {} });
  function ficha(id) {
    if (!toma.productos[id]) { const x = insumos.find(i => i.id === id); if (!x) return null;
      toma.productos[id] = fichaDe(x, (toma.rsc || {})[id]); guardarToma(); }
    return toma.productos[id];
  }
  /** Relee el producto (servidor o copia local) y rehace su foto del sistema. Se usa al primer conteo y cuando cambió entre el conteo y el cierre. */
  async function reSnap(id) {
    try { const f = fs(), sn = await f.getDoc(f.doc(f.collection(db(), 'Insumos'), id)); if (!sn.exists()) return false; const x = { id, ...sn.data() }, k = insumos.findIndex(i => i.id === id); if (k >= 0) insumos[k] = x; else insumos.push(x);
      const p = toma.productos[id]; if (p) { p.snap = snapDe(x); p.nombre = x.name || p.nombre; } return true; } catch (e) { return false; }
  }
  /** Lotes para elegir: los del sistema + los lotes nuevos ya contados. */
  const lotesElegibles = (p) => { const v = new Set(p.snap.batches.map(b => T().clave(b.batch, b.expirationDate))), r = p.snap.batches.slice(); p.conteos.forEach(c => { const k = T().clave(c.lote, c.vence); if (!v.has(k)) { v.add(k); r.push({ batch: c.lote, expirationDate: c.vence, quantity: 0 }); } }); return r; };
  const contadoDe = (p) => p.conteos.map(c => ({ batch: c.lote, expirationDate: c.vence, quantity: c.qty }));
  /** Lo contado sin lo reservado en actas. Lo reservado solo se puede descontar si se contaron TODOS los lotes del producto
      (en la parcial, si falta alguno, no se sabe de qué lote salió la reserva). */
  function neto(p, completa) {
    const t = T(), c = contadoDe(p), todos = completa || p.conteos.length > 0 && t.conciliar(p.snap.batches, c, { completa: false }).lineas.every(l => l.estado !== 'sin_contar');
    if (!todos) { const o = c.slice(); o.reservadoSinCubrir = 0; o.todos = false; return o; }
    const o = t.quitarReservado(c, p.snap.reservado); o.todos = true; return o;
  }
  function concilia(p, completa) { const t = T(), n = neto(p, completa), r = t.conciliar(p.snap.batches, n, { completa });
    r.todos = n.todos; r.reservadoSinCubrir = n.reservadoSinCubrir || 0; r.reservaIncompleta = !n.todos && p.snap.reservado > 0 && p.conteos.length > 0; return r; }

  // ---------------- pantalla ----------------
  function pintar() {
    const r = root(); if (!r) return;
    if (!toma) { r.innerHTML = `<div class="tm-cab"><h1><i class="ph-bold ph-clipboard-text" aria-hidden="true"></i> Toma de inventario</h1><p class="act-hint">Cuenta lo que hay en una bodega, lote por lote, y al cerrar el sistema queda con lo contado. Funciona sin internet.</p></div>
      <div class="card tm-abrir"><label class="form-label">Bodega<select id="tm-bod" class="form-control">${bodegas.map(b => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('')}</select></label>
        <fieldset class="tm-tipo"><legend class="form-label">Tipo de toma</legend>
          <label><input type="radio" name="tm-tipo" value="parcial" checked> <b>Parcial</b> <small>lo que no cuentes queda igual</small></label>
          <label><input type="radio" name="tm-tipo" value="completa"> <b>Completa</b> <small>lo que no cuentes queda en 0 (faltante)</small></label></fieldset>
        <button type="button" class="btn btn-primary btn-large" data-a="abrir"><i class="ph-bold ph-play" aria-hidden="true"></i> Abrir toma</button></div>`; return; }
    const prods = Object.entries(toma.productos), nCont = prods.filter(([, p]) => p.conteos.length).length;
    r.innerHTML = `<div class="tm-cab"><div><h1><i class="ph-bold ph-clipboard-text" aria-hidden="true"></i> Toma ${esc(toma.folio)}</h1><p class="act-hint">${esc(toma.bodega)} · ${toma.tipo === 'completa' ? 'Completa (lo no contado queda en 0)' : 'Parcial (lo no contado no cambia)'} · ${nCont} producto(s) contados · abierta ${esc(new Date(toma.abiertaEn).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</p></div>
        <div class="tm-acc"><button type="button" class="btn ${vista === 'contar' ? 'btn-primary' : 'btn-outline'}" data-a="v-contar">Contar</button><button type="button" class="btn ${vista === 'cerrar' ? 'btn-primary' : 'btn-outline'}" data-a="v-cerrar"${nCont || toma.tipo === 'completa' ? '' : ' disabled'}>Revisar y cerrar</button></div></div>
      ${vista === 'cerrar' ? pintarCierre() : pintarConteo()}`;
    rellenar(r);
    if (vista === 'contar') { const x = r.querySelector(sel ? '#tm-qty' : '#tm-scan'); if (x && document.activeElement !== x && !/INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) x.focus(); }
  }
  function pintarConteo() {
    const t = norm(q), sug = !sel && t.length >= 2 ? insumos.filter(x => norm(x.name + ' ' + (x.codigoMP || '') + ' ' + (x.codigoSAR || '')).includes(t)).slice(0, 8) : [];
    let h = `<div class="card tm-scanbox"><div class="tm-scanrow"><input id="tm-scan" class="form-control" placeholder="Pistolea la etiqueta o escribe el producto…" autocomplete="off" value="${esc(q)}" aria-label="Pistolear o buscar producto">${window.SAR_Bultos && window.SAR_Bultos.leerConCamara ? '<button type="button" class="btn btn-secondary" data-a="cam"><i class="ph-bold ph-camera" aria-hidden="true"></i> QR</button>' : ''}</div>
      ${sug.length ? `<div class="tm-sug">${sug.map(x => `<button type="button" class="tm-sugi" data-p="${esc(x.id)}">${foto(x.name, x.codigoMP)}<span><b>${esc(x.name)}</b><small>${x.codigoMP ? 'ID ' + esc(x.codigoMP) + ' · ' : ''}${num(x.quantity)} u. en sistema</small></span></button>`).join('')}</div>` : (t.length >= 2 && !sel ? '<p class="act-hint">No hay un producto así en esta bodega. Si llegó nuevo, regístralo en Ingresos.</p>' : '')}</div>`;
    if (sel) {
      const p = ficha(sel); if (p) {
        const nt = neto(p, false), av = T().avance(p.snap.batches, nt);
        h += `<div class="card tm-prod"><div class="tm-prod-h">${foto(p.nombre, p.codigo)}<div><b>${esc(p.nombre)}</b><small>${p.codigo ? 'ID ' + esc(p.codigo) + ' · ' : ''}${p.snap.reservado ? `${p.snap.reservado} u. reservadas en actas (están en la bodega: se cuentan) · ` : ''}${p.controlado ? 'controlado · ' : ''}${p.snap.reservado && p.conteos.length && !nt.todos ? '<b class="tm-falta-t">tiene reservas: cuenta todos sus lotes (0 si no hay)</b> · ' : ''}${nt.reservadoSinCubrir && p.conteos.length ? `<b class="tm-falta-t">${nt.reservadoSinCubrir} u. reservadas en actas no aparecieron en el conteo</b> · ` : ''}${p.snap.deuda ? `deuda (entregado sin stock): ${p.snap.deuda} u.; se salda si cuentas todos sus lotes · ` : ''}sistema al empezar: ${p.snap.batches.reduce((s, b) => s + b.quantity, 0) + p.snap.reservado} u.</small></div><button type="button" class="btn btn-secondary btn-sm" data-a="soltar">Otro producto</button></div>
          <table class="erp-table tm-lotes"><thead><tr><th>Lote</th><th>Vence</th><th>Sistema</th><th>Contado</th><th>Estado</th></tr></thead><tbody>${av.map(l => { const [et, cl] = ESTADO[l.estado] || ['', '']; const on = loteSel && loteSel.clave === l.clave;
            return `<tr class="${on ? 'tm-on' : ''}" data-l="${esc(l.clave)}" tabindex="0"><td><b>${esc(l.batch)}</b></td><td>${esc(fmtV(l.vence))}</td><td>${l.sistema}</td><td>${l.contado == null ? '—' : l.contado}</td><td><span class="tm-est ${cl}">${l.estado === 'sin_contar' ? `Quedan ${l.queda}` : l.estado === 'ok' ? 'Coincide' : l.estado === 'falta' ? `Quedan ${-l.delta}` : `${et} ${l.delta}`}</span></td></tr>`; }).join('') || '<tr><td colspan="5">El sistema no tiene lotes de este producto aquí: agrega lo que encuentres como lote nuevo.</td></tr>'}</tbody></table>
          <div class="tm-add"><fieldset class="tm-lotsel"><legend class="form-label">¿De qué lote es lo que cuentas?</legend>${lotesElegibles(p).map(b => { const k = T().clave(b.batch, b.expirationDate); return `<label class="tm-chip${loteSel && loteSel.clave === k ? ' on' : ''}"><input type="radio" name="tm-lote" value="${esc(k)}"${loteSel && loteSel.clave === k ? ' checked' : ''}> ${esc(T().lote(b.batch))} · ${esc(fmtV(T().mes(b.expirationDate)))}</label>`; }).join('')}<label class="tm-chip${loteSel && loteSel.nuevo ? ' on' : ''}"><input type="radio" name="tm-lote" value="__nuevo"${loteSel && loteSel.nuevo ? ' checked' : ''}> + Lote que no está</label></fieldset>
            ${loteSel && loteSel.nuevo ? `<div class="grid-2-col-even tm-nuevo"><label class="form-label">Lote<input id="tm-nl" class="form-control" value="${esc(loteSel.lote || '')}" placeholder="Ej: L2405"></label><label class="form-label">Vencimiento<input id="tm-nv" type="month" class="form-control" value="${esc(loteSel.vence || '')}"></label></div><button type="button" class="btn btn-secondary btn-sm tm-sl" data-a="sl">No trae lote ni vencimiento</button>` : ''}
            <div class="tm-qtyrow"><input id="tm-qty" type="number" min="0" inputmode="numeric" class="form-control" placeholder="Cantidad (0 si no hay)" aria-label="Cantidad contada"><button type="button" class="btn btn-primary" data-a="sumar"><i class="ph-bold ph-plus" aria-hidden="true"></i> Sumar al conteo</button></div>
            <small class="act-hint">Puedes contar el mismo lote en partes (cada estante o caja): se van sumando. Una caja con etiqueta se cuenta pistoleándola.</small></div>
          ${p.conteos.length ? `<ul class="tm-ents">${p.conteos.map((c, i) => `<li><span><b>${c.qty}</b> u. · lote ${esc(c.lote)}${c.vence && c.vence !== 'N/A' ? ' · ' + esc(fmtV(T().mes(c.vence))) : ''}${c.folio ? ' · caja ' + esc(c.folio) : ''}</span><button type="button" class="tm-x" data-q="${i}" aria-label="Quitar">✕</button></li>`).join('')}</ul>` : ''}</div>`;
      }
    }
    const contados = Object.entries(toma.productos).filter(([id, p]) => p.conteos.length && id !== sel);
    if (contados.length) h += `<h3 class="tm-h">Contados (${contados.length})</h3><div class="tm-grid">${contados.map(([id, p]) => { const r2 = concilia(p, false), d = r2.lineas.filter(l => l.estado !== 'ok' && l.estado !== 'sin_contar'); return `<button type="button" class="tm-card" data-p="${esc(id)}">${foto(p.nombre, p.codigo)}<span><b>${esc(p.nombre)}</b><small>${r2.totales.contado} contadas · ${d.length ? d.map(l => `${ESTADO[l.estado][0].toLowerCase()} ${Math.abs(l.delta)} (${esc(l.batch)})`).join(', ') : 'coincide'}</small></span></button>`; }).join('')}</div>`;
    h += `<p class="tm-pie"><button type="button" class="btn btn-secondary btn-sm tm-peligro" data-a="descartar">Descartar esta toma</button></p>`;
    return h;
  }
  /** Revisión antes de cerrar. */
  /** Productos a revisar: los contados y, en la completa, todos los de la bodega (los no contados se arman al vuelo con lo cargado ahora,
      sin guardarlos: si después se cuentan, su foto se toma fresca al contar). */
  function productosCierre() {
    const out = Object.entries(toma.productos).map(([id, p]) => ({ id, p }));
    if (toma.tipo === 'completa') { toma.rsc = toma.rsc || {}; insumos.forEach(x => { if (toma.productos[x.id]) return; if (num(x.quantity) > 0 || num(x.reservado) > 0 || num(x.sobregiro) > 0 || lotesDe(x).length) out.push({ id: x.id, p: fichaDe(x, toma.rsc[x.id] = toma.rsc[x.id] || {}), efimero: true }); }); }
    return out;
  }
  function resumen() {
    const completa = toma.tipo === 'completa', filas = [];
    productosCierre().forEach(({ id, p }) => { const r = concilia(p, completa);
      if (r.reservaIncompleta) { filas.push({ id, p, aviso: 'reserva-incompleta', l: { clave: '_res', batch: '—', vence: 'N/A', sistema: p.snap.reservado, contado: null, delta: 0 }, reconteo: true }); return; }
      r.lineas.forEach(l => { if (l.estado === 'ok' || l.estado === 'sin_contar') return; filas.push({ id, p, l, reconteo: T().requiereReconteo(l, { controlado: p.controlado }) && !p.recontado[l.clave] }); });
      if (r.reservadoSinCubrir > 0) filas.push({ id, p, aviso: 'reserva-falta', l: { clave: '_rsc', batch: '—', vence: 'N/A', sistema: r.reservadoSinCubrir, contado: 0, delta: 0 }, reconteo: !p.recontado._rsc });
      if (p.snap.deuda > 0 && r.todos) filas.push({ id, p, aviso: 'deuda', l: { clave: '_deuda', batch: '—', vence: 'N/A', sistema: p.snap.deuda, contado: null, delta: 0 }, reconteo: false });
    });
    return filas;
  }
  function pintarCierre() {
    const f = resumen(), pend = f.filter(x => x.reconteo), falt = f.filter(x => x.l.delta < 0), sob = f.filter(x => x.l.delta > 0);
    const AVISO = { 'reserva-incompleta': (x) => `Tiene ${x.p.snap.reservado} u. reservadas en actas: cuenta <b>todos</b> sus lotes (pon 0 en los que no estén) para saber de cuál salieron.`, 'reserva-falta': (x) => `${x.l.sistema} u. reservadas en actas por confirmar no aparecieron en el conteo. Búscalas; si no están, revisa esas actas (no se descuentan aquí).`, deuda: (x) => `Deuda de ${x.p.snap.deuda} u. (entregado sin stock): con todos sus lotes contados, el conteo la salda.` };
    const filaH = (x, k) => x.aviso ? `<tr class="${x.reconteo ? 'tm-rec' : ''}"><td>${esc(x.p.nombre)}</td><td colspan="4">${AVISO[x.aviso](x)}</td><td>${x.aviso === 'reserva-falta' && x.reconteo ? `<button type="button" class="btn btn-secondary btn-sm" data-a="recontar" data-id="${esc(x.id)}" data-k="_rsc">Revisado</button>` : x.aviso === 'reserva-incompleta' ? `<button type="button" class="btn btn-secondary btn-sm" data-a="ir" data-id="${esc(x.id)}">Contar</button>` : ''}</td></tr>` : `<tr class="${x.reconteo ? 'tm-rec' : ''}"><td>${esc(x.p.nombre)}</td><td>${esc(x.l.batch)} · ${esc(fmtV(x.l.vence))}</td><td>${x.l.sistema}</td><td>${x.l.contado == null ? 0 : x.l.contado}</td><td><span class="tm-est ${x.l.delta > 0 ? 'tm-sobra' : 'tm-falta'}">${x.l.delta > 0 ? (x.l.estado === 'nuevo' ? 'Lote nuevo +' : 'Sobran ') + x.l.delta : 'Faltan ' + (-x.l.delta)}</span></td><td>${x.reconteo ? `<button type="button" class="btn btn-secondary btn-sm" data-a="recontar" data-id="${esc(x.id)}" data-k="${esc(x.l.clave)}">Volví a contar: está bien</button>` : ((x.l.delta < 0 && !esSuper()) || !esAdmin() ? '<small>la aprueba el superadministrador</small>' : '<small>entra al cerrar</small>')}</td></tr>`;
    return `<div class="card tm-cierre"><p><b>${f.filter(x => !x.aviso).length ? f.filter(x => !x.aviso).length + ' diferencia(s)' : 'Todo coincide'}</b> · ${sob.length} sobrante(s) / lote(s) nuevo(s) · ${falt.length} faltante(s)${pend.length ? ` · <b class="tm-falta-t">${pend.length} por recontar</b> (diferencia mayor a 5 % o 10 u., o controlado)` : ''}</p>
      ${f.length ? `<div class="table-responsive"><table class="erp-table"><thead><tr><th>Producto</th><th>Lote</th><th>Sistema</th><th>Contado</th><th>Diferencia</th><th></th></tr></thead><tbody>${f.map(filaH).join('')}</tbody></table></div>` : ''}
      ${falt.length ? `<label class="form-label">Motivo de los faltantes<select id="tm-mot" class="form-control">${((window.SAR_Gobernanza && window.SAR_Gobernanza.MOTIVOS) || [MOTIVO]).map(m => `<option${m === MOTIVO ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></label><label class="form-label">Observación<input id="tm-obs" class="form-control" placeholder="Opcional"></label>` : ''}
      <button type="button" class="btn btn-primary btn-large" data-a="cerrar"${pend.length || cerrando ? ' disabled' : ''}><i class="ph-bold ph-check-circle" aria-hidden="true"></i> Cerrar toma ${esc(toma.folio)}</button>
      ${pend.length ? '<p class="act-hint">Resuelve las filas marcadas. Recuenta y, si el número está bien, toca «Volví a contar». Si cambió, vuelve a «Contar» y corrige.</p>' : '<p class="act-hint">Al cerrar, el sistema queda con lo contado: los sobrantes y lotes nuevos entran ahora con su código AJU; los faltantes ' + (esSuper() ? 'se aplican ahora (eres superadministrador).' : 'quedan en Aprobaciones para el superadministrador.') + (esAdmin() ? '' : ' Como no eres administrador, también los sobrantes quedan para aprobar.') + '</p>'}</div>`;
  }

  // ---------------- acciones ----------------
  async function abrir() {
    const r = root(), bod = (r.querySelector('#tm-bod') || {}).value, tipo = (r.querySelector('input[name="tm-tipo"]:checked') || {}).value || 'parcial'; if (!bod) return;
    let folio = '';
    try { folio = window.SAR_Cola && !(await window.SAR_Cola.hayConexion()) ? window.SAR_Folio.provisional('INV') : await window.SAR_Folio.siguiente('INV'); } catch (e) { folio = window.SAR_Folio ? window.SAR_Folio.provisional('INV') : 'INV-P-' + Date.now().toString(36); }
    const f = fs();
    try { if (!window.SAR_Cola || await window.SAR_Cola.hayConexion()) { const sn = await f.getDocs(f.query(f.collection(db(), 'Contadores'), f.where('tipo', '==', 'toma'), f.where('bodega', '==', bod), f.where('estado', '==', 'abierta'))); const otras = []; sn.forEach(d => otras.push(d.data()));
      const P = window.SAR_Progreso; if (otras.length && P && P.confirmar && !(await P.confirmar({ titulo: 'Ya hay una toma abierta', texto: `${otras.map(o => `${esc(o.folio)} (${esc(o.abiertaPor || '')})`).join(', ')} en ${esc(bod)}. Si dos equipos cuentan la misma bodega, el segundo cierre se rechaza lote por lote. ¿Abrir otra igual?`, si: 'Abrir igual', no: 'Volver' }))) return; } } catch (e) { /* sin red o sin índice: se abre igual */ }
    toma = { id: 'tm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), folio, bodega: bod, tipo, abiertaEn: new Date().toISOString(), por: usuario(), productos: {}, rsc: {} };
    guardarToma();
    f.setDoc(f.doc(f.collection(db(), 'Contadores'), 'toma-' + toma.id), { tipo: 'toma', folio, bodega: bod, tipoToma: tipo, estado: 'abierta', abiertaPor: toma.por, abiertaEn: toma.abiertaEn }, { merge: true }).catch(() => {});   /* aviso a otros equipos; sin red se sincroniza solo */ vista = 'contar'; await cargarInsumos(); pintar();
  }
  /** Antes del primer conteo de un producto se relee del servidor/copia local: la diferencia es contra lo que había AL CONTAR. */
  async function refrescar(id) { if (toma.productos[id]) return; try { const f = fs(), sn = await f.getDoc(f.doc(f.collection(db(), 'Insumos'), id)); if (sn.exists()) { const k = insumos.findIndex(i => i.id === id), x = { id, ...sn.data() }; if (k >= 0) insumos[k] = x; else insumos.push(x); } } catch (e) { /* sin red: se usa lo cargado */ } }
  async function elegir(id) { await refrescar(id); sel = id; q = ''; loteSel = null; const p = ficha(id); if (p && p.snap.batches.length === 1) loteSel = { clave: T().clave(p.snap.batches[0].batch, p.snap.batches[0].expirationDate), lote: T().lote(p.snap.batches[0].batch), vence: p.snap.batches[0].expirationDate }; pintar(); }
  async function sumar(qty, extra) {
    let p = ficha(sel); if (!p) return; const n = Math.floor(num(qty)); if (String(qty == null ? '' : qty).trim() === '' || !(n >= 0)) { toast('Cantidad', 'Escribe cuántas unidades contaste (0 si no hay).', 'warning'); return; }
    if (!p.conteos.length) { await reSnap(sel); p = ficha(sel); }   /* la diferencia es contra lo que había AL CONTAR, no al abrir */
    if (!loteSel) { toast('Lote', 'Elige de qué lote es lo que contaste.', 'warning'); return; }
    let lote = loteSel.lote, vence = loteSel.vence;
    if (loteSel.nuevo) { const r = root(); lote = String((r.querySelector('#tm-nl') || {}).value || loteSel.lote || '').trim().toUpperCase() || 'S/L'; vence = (r.querySelector('#tm-nv') || {}).value || loteSel.vence || 'N/A'; }
    p.conteos.push({ lote, vence, qty: n, en: new Date().toISOString(), ...(extra || {}) }); delete p.recontado[T().clave(lote, vence)];
    if (loteSel.nuevo) loteSel = { clave: T().clave(lote, vence), lote: T().lote(lote), vence };   /* el lote nuevo queda elegido para seguir contándolo */
    guardarToma(); try { if (window.SAR_Sonidos) window.SAR_Sonidos.tocar('ok'); } catch (e) { /* sin sonido */ } pintar();
  }
  /** Pistola o cámara: etiqueta BUL (producto + lote + contenido) o código del producto. */
  async function leido(txt) {
    const B = window.SAR_Bultos, folio = B && B.folioDe ? B.folioDe(txt) : '';
    if (folio) {
      const b = await B.leer(folio).catch(() => null); if (!b) { toast('Etiqueta', `${folio} no existe en el sistema.`, 'warning'); return; }
      const x = insumos.find(i => i.id === b.insumoId) || insumos.find(i => norm(i.name) === norm(b.nombre)); if (!x) { toast('Etiqueta', `La caja es de «${b.nombre}», que no está en ${toma.bodega}.`, 'warning'); return; }
      await refrescar(x.id); const p = ficha(x.id); if (p.conteos.some(c => c.folio === folio)) { toast('Ya contada', `${folio} ya está en el conteo.`, 'warning'); sel = x.id; pintar(); return; }
      sel = x.id; loteSel = { clave: T().clave(b.lote, b.vence), lote: T().lote(b.lote), vence: b.vence || 'N/A', nuevo: !p.snap.batches.some(z => T().clave(z.batch, z.expirationDate) === T().clave(b.lote, b.vence)) };
      if (b.estado === 'CERRADA' && num(b.contenido) > 0) { await sumar(num(b.contenido), { folio }); toast('Caja contada', `${folio}: ${num(b.contenido)} u. del lote ${T().lote(b.lote)}.`, 'success'); return; }
      pintar(); toast('Caja abierta', `${folio} está abierta: cuenta las unidades y súmalas.`, 'info'); return;
    }
    const t = norm(txt), x = insumos.find(i => [i.codigoSAR, i.codigoMP, i.code, i.codigoBarras].some(c => c && norm(c) === t)) || insumos.find(i => norm(i.name) === t);
    if (x) elegir(x.id); else { q = txt; pintar(); }
  }
  async function cerrar() {
    if (cerrando) return; const r = root(), motivo = (r.querySelector('#tm-mot') || {}).value || MOTIVO, obs = (r.querySelector('#tm-obs') || {}).value || '';
    if (toma.tipo === 'completa') { try { if (!window.SAR_Cola || await window.SAR_Cola.hayConexion()) await cargarInsumos(); } catch (e) { /* se usa lo cargado */ } }   /* incluye lo que llegó a la bodega después de abrir */
    const filas = resumen(); if (filas.some(x => x.reconteo)) { pintar(); return; }
    const completa = toma.tipo === 'completa', prods = productosCierre(), conc = new Map(prods.map(({ id, p }) => [id, concilia(p, completa)]));
    const saldar = (id) => { const x = prods.find(z => z.id === id); return !!(x && x.p.snap.deuda > 0 && conc.get(id).todos); };
    const lineas = filas.filter(x => !x.aviso).map((x, n) => ({ n, clave: x.l.clave, insumoId: x.id, nombre: x.p.nombre, lote: x.l.estado === 'nuevo' ? x.l.batch : (x.l.loteSistema != null && x.l.loteSistema !== '' ? x.l.loteSistema : x.l.batch), mesLote: x.l.vence, vence: x.l.venceOriginal || (x.l.vence === 'N/A' ? 'N/A' : x.l.vence), delta: x.l.delta, sistema: x.l.sistema, contado: x.l.contado == null ? 0 : x.l.contado, estado: x.l.estado, snapEn: x.p.snap.en, saldarDeuda: saldar(x.id), ...(x.p.recontado[x.l.clave] ? { recontado: x.p.recontado[x.l.clave] } : {}) }));
    /* deuda de un producto contado entero sin sobrante: línea 0 que solo la salda (con sobrante, la salda esa línea) */
    filas.filter(x => x.aviso === 'deuda' && !lineas.some(l => l.insumoId === x.id && l.delta > 0)).forEach(x => lineas.push({ n: lineas.length, clave: '_deuda', insumoId: x.id, nombre: x.p.nombre, lote: '', mesLote: '', vence: '', delta: 0, sistema: x.p.snap.deuda, contado: 0, estado: 'deuda', snapEn: x.p.snap.en, saldarDeuda: true }));
    const avisos = filas.filter(x => x.aviso === 'reserva-falta').map(x => ({ insumoId: x.id, nombre: x.p.nombre, reservadoNoEncontrado: x.l.sistema, revisado: x.p.recontado._rsc || null }));
    let contados = 0, sinDiferencia = 0; conc.forEach(r => r.lineas.forEach(l => { if (l.estado === 'sin_contar') return; if (l.estado === 'ok' && !l.sistema && !l.contado) return; contados++; if (l.estado === 'ok') sinDiferencia++;   /* un lote en 0 que nadie contó no infla el IRA */ }));
    const plan = { id: toma.id, folio: toma.folio, bodega: toma.bodega, tipo: toma.tipo, motivo, obs, por: usuario(), superadmin: esSuper(), admin: esAdmin(), en: new Date().toISOString(), lineas, avisos, contados, sinDiferencia, abiertaPor: toma.por, abiertaEn: toma.abiertaEn };
    const P = window.SAR_Progreso;
    if (P && P.confirmar && !(await P.confirmar({ titulo: `Cerrar toma ${toma.folio}`, texto: `${plan.lineas.filter(l => l.delta).length} diferencia(s) en ${esc(toma.bodega)}. El sistema queda con lo contado.`, si: 'Cerrar toma', no: 'Volver' }))) return;
    cerrando = true; pintar();
    try {
      if (window.SAR_Cola && !(await window.SAR_Cola.hayConexion())) { window.SAR_Cola.encolar({ tipo: 'toma-cierre', titulo: `Cierre de toma ${toma.folio} · ${toma.bodega} · ${plan.lineas.length} diferencia(s)`, datos: plan }); toast('Sin internet: cierre en cola', `La toma ${toma.folio} se aplicará sola al volver la conexión (mantén el Visor abierto).`, 'info'); }
      else { const res = await aplicarCierre(plan); toast('Toma cerrada', `${toma.folio}: ${res.aplicadas} ajuste(s) aplicados${res.solicitudes ? ` · ${res.solicitudes} ajuste(s) esperando al superadministrador` : ''}.`, 'success'); }
      toma = null; sel = null; loteSel = null; guardarToma(); vista = 'contar';
    } catch (e) {
      const camb = (e && e.cambiados) || [];
      for (const id of camb) { await reSnap(id); const p = toma.productos[id]; if (p) { p.recontado = {}; p.conteos = []; } }   /* lo contado ya no vale contra la foto nueva: se cuenta de nuevo */
      if (camb.length) guardarToma();
      toast('No se cerró la toma', (e.message || String(e)) + (camb.length ? ` ${camb.length} producto(s) tuvieron movimientos mientras contabas: se borró su conteo y ya se actualizó lo que dice el sistema: vuelve a contarlos y cierra de nuevo.` : '') + ' Lo aplicado no se repetirá al reintentar.', 'error'); }
    finally { cerrando = false; pintar(); }
  }
  /** Aplica el cierre. Idempotente: idMov / id de solicitud fijos por toma, producto y línea. */
  async function aplicarCierre(plan) {
    const f = fs(), aj = window.ejecutarAjusteDirecto; if (typeof aj !== 'function') throw new Error('sin conexión: el módulo de ajustes aún no carga');
    let aplicadas = 0, solicitudes = 0; const errores = [], cambiados = new Set(), admin = plan.admin !== false && (plan.admin || plan.superadmin);
    for (const l of plan.lineas) {
      const idMov = `toma-${plan.id}-${l.insumoId}-${encodeURIComponent(l.clave || String(l.n))}`,   /* por lote (no por posición): un reintento con el conteo cambiado no repite */ just = `Toma ${plan.folio} (${plan.tipo}) · ${plan.bodega} · lote ${l.lote}: sistema ${l.sistema}, contado ${l.contado}${plan.obs ? ' · ' + plan.obs : ''}`;
      try {
        const sn = await f.getDoc(f.doc(f.collection(db(), 'Insumos'), l.insumoId)); if (!sn.exists()) throw new Error('el producto ya no existe');
        const stock = num(sn.data().quantity), deuda = l.estado === 'deuda';
        /* el lote se identifica por su nombre tal como está en el sistema + mes de vencimiento, y debe seguir con lo que tenía al contar (si no, se rechaza: otro cierre u otro movimiento lo cambió) */
        const opts = { idMov, motivo: l.delta < 0 ? plan.motivo : MOTIVO, observacion: just, ...(deuda ? { saldarDeudaConteoTotal: true } : { lote: l.lote, mesLote: l.mesLote, esperadoLote: l.estado === 'nuevo' ? 0 : l.sistema }), ...(l.estado === 'nuevo' && l.vence && l.vence !== 'N/A' ? { vence: l.vence } : {}), saldarDeuda: !!l.saldarDeuda };
        if (l.delta < 0 ? plan.superadmin : admin) {
          const ya = await f.getDoc(f.doc(f.collection(db(), 'Historial_Movimientos'), 'aju-' + idMov)); if (ya.exists()) { aplicadas++; continue; }   /* sin gastar otro correlativo AJU */
          const codigo = deuda ? plan.folio : (window.SAR_Gobernanza ? await window.SAR_Gobernanza.codigo('AJU').catch(() => null) : null);   /* saldar deuda no mueve stock: lleva el folio INV, no gasta AJU */
          await aj(l.insumoId, stock, l.nombre, l.delta, just, codigo, opts); aplicadas++;
        } else {
          const ref = f.doc(f.collection(db(), 'Solicitudes_Ajuste'), idMov), ya = await f.getDoc(ref);
          if (!ya.exists()) { const codigo = (window.SAR_Gobernanza ? await window.SAR_Gobernanza.codigo('AJU').catch(() => null) : null) || (window.SAR_Folio ? window.SAR_Folio.provisional('AJU') : 'AJU-P');
            await f.setDoc(ref, { code: codigo, insumoId: l.insumoId, insumoName: l.nombre, cantidad: l.delta, justificacion: just, previousStock: stock, projectedStock: stock + l.delta, motivo: opts.motivo, observacion: just, status: 'pendiente', date: f.serverTimestamp(), requester: plan.por || usuario(), inv: plan.folio, toma: plan.id, snapEn: l.snapEn || '',
              ...(deuda ? { conteo: true, deudaTotal: true } : { lote: l.lote, mesLote: l.mesLote, vence: l.estado === 'nuevo' && l.vence !== 'N/A' ? l.vence : '', loteSistema: l.estado === 'nuevo' ? 0 : l.sistema, conteo: !!l.saldarDeuda }) }); }
          solicitudes++;
        }
      } catch (e) {
        if (/cambi(ó|o) desde el conteo|no se pueden descontar/i.test(String(e && e.message))) cambiados.add(l.insumoId); if (/ya (se )?aplic|ya estaba|existe ya/i.test(String(e && e.message))) { aplicadas++; continue; } errores.push(`${l.nombre} (${l.lote}): ${e.message || e}`); if (/unavailable|offline|network|sin conexi/i.test(String(e && (e.code || '') + ' ' + e.message))) throw new Error('sin conexión: ' + (e.message || e)); }
    }
    try { await f.setDoc(f.doc(f.collection(db(), 'Contadores'), 'toma-' + plan.id), { tipo: 'toma', folio: plan.folio, bodega: plan.bodega, tipoToma: plan.tipo, por: plan.por, cerradaEn: new Date().toISOString(), abiertaPor: plan.abiertaPor || plan.por, abiertaEn: plan.abiertaEn || '', lineas: plan.lineas, contados: plan.contados || 0, sinDiferencia: plan.sinDiferencia || 0, ira: plan.contados ? Math.round(1000 * (plan.sinDiferencia || 0) / plan.contados) / 10 : null, avisos: plan.avisos || [], aplicadas, solicitudes, errores, estado: errores.length ? 'con errores' : 'cerrada' }, { merge: true }); } catch (e) { console.warn('[Toma] no se guardó el registro de la toma', e); toast('Registro de la toma', 'Los ajustes quedaron aplicados, pero no se guardó el registro de ' + plan.folio + ': ' + (e.message || e), 'warning'); }   /* no bloquea: el stock ya quedó bien */   /* IRA = lotes sin diferencia ÷ lotes contados */
    if (errores.length) { const er = new Error(errores.slice(0, 3).join(' · ')); er.cambiados = [...cambiados]; throw er; }
    return { aplicadas, solicitudes };
  }
  /* En la cola: un error que no es de conexión no se reintenta para siempre; queda en el registro de la toma (Contadores/toma-<id>, «con errores») y se avisa. */
  if (window.SAR_Cola && window.SAR_Cola.registrar) window.SAR_Cola.registrar('toma-cierre', async (d) => { try { await aplicarCierre(d); } catch (e) { if (/sin conexi/i.test(String(e && e.message))) throw e; toast('Toma ' + d.folio + ' con errores', (e.message || e) + ' Esos lotes quedan sin ajustar: cuéntalos en una nueva toma.', 'error'); } });

  // ---------------- eventos ----------------
  function enlazar(r) {
    if (r.dataset.ok) return; r.dataset.ok = '1';
    let tm = null;
    r.addEventListener('input', (e) => {
      if (e.target.id === 'tm-scan') { clearTimeout(tm); const v = e.target.value; const B = window.SAR_Bultos;
        if (B && B.folioDe && B.folioDe(v)) { tm = setTimeout(() => { e.target.value = ''; leido(v); }, 300); return; }   /* pistola sin Enter */
        tm = setTimeout(() => { q = v; const pos = e.target.selectionStart; pintar(); const n = root().querySelector('#tm-scan'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 180); }
      if (e.target.id === 'tm-nl' && loteSel) loteSel.lote = e.target.value.trim().toUpperCase();
      if (e.target.id === 'tm-nv' && loteSel) loteSel.vence = e.target.value;
    });
    r.addEventListener('keydown', (e) => {
      if (e.target.id === 'tm-scan' && (e.key === 'Enter' || (e.key === 'Tab' && e.target.value.trim()))) { e.preventDefault(); clearTimeout(tm); const v = e.target.value.trim(); e.target.value = ''; if (v) leido(v); }
      if (e.target.id === 'tm-qty' && e.key === 'Enter') { e.preventDefault(); sumar(e.target.value); }
      if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-l]')) e.target.click();
    });
    r.addEventListener('change', (e) => { if (e.target.name === 'tm-lote') { const v = e.target.value; if (v === '__nuevo') loteSel = { nuevo: true, lote: '', vence: '' }; else { const p = ficha(sel), b = lotesElegibles(p).find(z => T().clave(z.batch, z.expirationDate) === v); loteSel = { clave: v, lote: T().lote(b && b.batch), vence: (b && b.expirationDate) || 'N/A' }; } pintar(); } });
    r.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr[data-l]'); if (tr && sel) { const p = ficha(sel), b = lotesElegibles(p).find(z => T().clave(z.batch, z.expirationDate) === tr.dataset.l); if (b) { loteSel = { clave: tr.dataset.l, lote: T().lote(b.batch), vence: b.expirationDate || 'N/A' }; pintar(); } return; }
      const pb = e.target.closest('[data-p]'); if (pb) { elegir(pb.dataset.p); return; }
      const x = e.target.closest('.tm-x'); if (x && sel) { const p = ficha(sel), c = p.conteos.splice(+x.dataset.q, 1)[0]; if (c) p.recontado = {}; guardarToma(); pintar(); return; }   /* cambió el conteo: hay que volver a confirmar los reconteos */
      const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
      if (a === 'abrir') return abrir();
      if (a === 'v-contar') { vista = 'contar'; return pintar(); }
      if (a === 'v-cerrar') { vista = 'cerrar'; sel = null; if (toma.tipo === 'completa') { try { if (!window.SAR_Cola || await window.SAR_Cola.hayConexion()) await cargarInsumos(); } catch (e) { /* lo cargado */ } } return pintar(); }
      if (a === 'soltar') { sel = null; loteSel = null; return pintar(); }
      if (a === 'sumar') return sumar((root().querySelector('#tm-qty') || {}).value);
      if (a === 'sl') { loteSel = { nuevo: true, lote: 'S/L', vence: 'N/A' }; return pintar(); }
      if (a === 'cam') { const t = await window.SAR_Bultos.leerConCamara('Leer la etiqueta de la caja'); if (t) leido(t); return; }
      if (a === 'recontar') { const id = b.dataset.id, p = toma.productos[id], rec = p ? p.recontado : ((toma.rsc = toma.rsc || {})[id] = (toma.rsc || {})[id] || {}); rec[b.dataset.k] = { por: usuario(), en: new Date().toISOString() }; guardarToma(); return pintar(); }
      if (a === 'ir') { vista = 'contar'; return elegir(b.dataset.id); }
      if (a === 'cerrar') return cerrar();
      if (a === 'descartar') { const P = window.SAR_Progreso; if (P && P.confirmar && !(await P.confirmar({ titulo: 'Descartar la toma', texto: `Se borra el conteo de ${esc(toma.folio)} en este equipo. El stock no cambia.`, si: 'Descartar', no: 'Volver', peligro: true }))) return; try { await fs().setDoc(fs().doc(fs().collection(db(), 'Contadores'), 'toma-' + toma.id), { tipo: 'toma', folio: toma.folio, bodega: toma.bodega, tipoToma: toma.tipo, estado: 'anulada', anuladaPor: usuario(), anuladaEn: new Date().toISOString(), abiertaPor: toma.por, abiertaEn: toma.abiertaEn }, { merge: true }); } catch (e) { /* sin red: queda solo el hueco del folio */ }   /* el folio INV no queda como hueco sin explicar */
        toma = null; sel = null; guardarToma(); return pintar(); }
    });
  }
  async function abrirVista() {
    const r = root(); if (!r) return; enlazar(r); toma = toma || leerToma();
    r.innerHTML = window.SAR_Progreso && window.SAR_Progreso.cargando ? window.SAR_Progreso.cargando('Cargando la bodega…') : '<p class="act-hint">Cargando…</p>';
    try { await cargar(); } catch (e) { toast('Toma', 'No se pudo cargar: ' + (e.message || e), 'error'); }
    pintar();
  }
  window.SAR_TomaUI = { abrirVista, aplicarCierre };
})(window, document);
