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
   Sin duplicar: cada ajuste lleva idMov fijo toma-<id>-<insumo>-<n> (ejecutarAjusteDirecto no lo aplica dos veces) y
   cada solicitud de ajuste usa id fijo.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const T = () => window.SAR_Toma;
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || ''; };
  const esSuper = () => String((document.body && document.body.dataset.userRole) || '').toLowerCase() === 'superadmin';
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
  function ficha(id) {
    if (!toma.productos[id]) { const x = insumos.find(i => i.id === id); if (!x) return null;
      toma.productos[id] = { nombre: x.name, codigo: x.codigoMP || '', controlado: !!x.controlado, snap: { batches: lotesDe(x), reservado: num(x.reservado), en: new Date().toISOString() }, conteos: [], recontado: {} }; guardarToma(); }
    return toma.productos[id];
  }
  /** Lotes para elegir: los del sistema + los lotes nuevos ya contados. */
  const lotesElegibles = (p) => { const v = new Set(p.snap.batches.map(b => T().clave(b.batch, b.expirationDate))), r = p.snap.batches.slice(); p.conteos.forEach(c => { const k = T().clave(c.lote, c.vence); if (!v.has(k)) { v.add(k); r.push({ batch: c.lote, expirationDate: c.vence, quantity: 0 }); } }); return r; };
  const contadoDe = (p) => p.conteos.map(c => ({ batch: c.lote, expirationDate: c.vence, quantity: c.qty }));
  function concilia(p, completa) { const t = T(); return t.conciliar(p.snap.batches, t.quitarReservado(contadoDe(p), p.snap.reservado), { completa }); }

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
        const av = T().avance(p.snap.batches, T().quitarReservado(contadoDe(p), p.snap.reservado));
        h += `<div class="card tm-prod"><div class="tm-prod-h">${foto(p.nombre, p.codigo)}<div><b>${esc(p.nombre)}</b><small>${p.codigo ? 'ID ' + esc(p.codigo) + ' · ' : ''}${p.snap.reservado ? `${p.snap.reservado} u. reservadas en actas (están en la bodega: se cuentan) · ` : ''}${p.controlado ? 'controlado · ' : ''}sistema al empezar: ${p.snap.batches.reduce((s, b) => s + b.quantity, 0) + p.snap.reservado} u.</small></div><button type="button" class="btn btn-secondary btn-sm" data-a="soltar">Otro producto</button></div>
          <table class="erp-table tm-lotes"><thead><tr><th>Lote</th><th>Vence</th><th>Sistema</th><th>Contado</th><th>Estado</th></tr></thead><tbody>${av.map(l => { const [et, cl] = ESTADO[l.estado] || ['', '']; const on = loteSel && loteSel.clave === l.clave;
            return `<tr class="${on ? 'tm-on' : ''}" data-l="${esc(l.clave)}" tabindex="0"><td><b>${esc(l.batch)}</b></td><td>${esc(fmtV(l.vence))}</td><td>${l.sistema}</td><td>${l.contado == null ? '—' : l.contado}</td><td><span class="tm-est ${cl}">${l.estado === 'sin_contar' ? `Quedan ${l.queda}` : l.estado === 'ok' ? 'Coincide' : l.estado === 'falta' ? `Quedan ${-l.delta}` : `${et} ${l.delta}`}</span></td></tr>`; }).join('') || '<tr><td colspan="5">El sistema no tiene lotes de este producto aquí: agrega lo que encuentres como lote nuevo.</td></tr>'}</tbody></table>
          <div class="tm-add"><fieldset class="tm-lotsel"><legend class="form-label">¿De qué lote es lo que cuentas?</legend>${lotesElegibles(p).map(b => { const k = T().clave(b.batch, b.expirationDate); return `<label class="tm-chip${loteSel && loteSel.clave === k ? ' on' : ''}"><input type="radio" name="tm-lote" value="${esc(k)}"${loteSel && loteSel.clave === k ? ' checked' : ''}> ${esc(T().lote(b.batch))} · ${esc(fmtV(T().mes(b.expirationDate)))}</label>`; }).join('')}<label class="tm-chip${loteSel && loteSel.nuevo ? ' on' : ''}"><input type="radio" name="tm-lote" value="__nuevo"${loteSel && loteSel.nuevo ? ' checked' : ''}> + Lote que no está</label></fieldset>
            ${loteSel && loteSel.nuevo ? `<div class="grid-2-col-even tm-nuevo"><label class="form-label">Lote<input id="tm-nl" class="form-control" value="${esc(loteSel.lote || '')}" placeholder="Ej: L2405"></label><label class="form-label">Vencimiento<input id="tm-nv" type="month" class="form-control" value="${esc(loteSel.vence || '')}"></label></div><button type="button" class="btn btn-secondary btn-sm tm-sl" data-a="sl">No trae lote ni vencimiento</button>` : ''}
            <div class="tm-qtyrow"><input id="tm-qty" type="number" min="0" inputmode="numeric" class="form-control" placeholder="Cantidad" aria-label="Cantidad contada"><button type="button" class="btn btn-primary" data-a="sumar"><i class="ph-bold ph-plus" aria-hidden="true"></i> Sumar al conteo</button></div>
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
  function resumen() {
    const completa = toma.tipo === 'completa', filas = [];
    if (completa) insumos.forEach(x => { if (num(x.quantity) > 0 || num(x.reservado) > 0) ficha(x.id); });
    Object.entries(toma.productos).forEach(([id, p]) => { const r = concilia(p, completa); r.lineas.forEach(l => { if (l.estado === 'ok' || l.estado === 'sin_contar') return; filas.push({ id, p, l, reconteo: T().requiereReconteo(l, { controlado: p.controlado }) && !p.recontado[l.clave] }); }); });
    return filas;
  }
  function pintarCierre() {
    const f = resumen(), pend = f.filter(x => x.reconteo), falt = f.filter(x => x.l.delta < 0), sob = f.filter(x => x.l.delta > 0);
    const filaH = (x, k) => `<tr class="${x.reconteo ? 'tm-rec' : ''}"><td>${esc(x.p.nombre)}</td><td>${esc(x.l.batch)} · ${esc(fmtV(x.l.vence))}</td><td>${x.l.sistema}</td><td>${x.l.contado == null ? 0 : x.l.contado}</td><td><span class="tm-est ${x.l.delta > 0 ? 'tm-sobra' : 'tm-falta'}">${x.l.delta > 0 ? (x.l.estado === 'nuevo' ? 'Lote nuevo +' : 'Sobran ') + x.l.delta : 'Faltan ' + (-x.l.delta)}</span></td><td>${x.reconteo ? `<button type="button" class="btn btn-secondary btn-sm" data-a="recontar" data-id="${esc(x.id)}" data-k="${esc(x.l.clave)}">Volví a contar: está bien</button>` : (x.l.delta < 0 && !esSuper() ? '<small>la aprueba el superadministrador</small>' : '<small>entra al cerrar</small>')}</td></tr>`;
    return `<div class="card tm-cierre"><p><b>${f.length ? f.length + ' diferencia(s)' : 'Todo coincide'}</b> · ${sob.length} sobrante(s) / lote(s) nuevo(s) · ${falt.length} faltante(s)${pend.length ? ` · <b class="tm-falta-t">${pend.length} por recontar</b> (diferencia mayor a 5 % o 10 u., o controlado)` : ''}</p>
      ${f.length ? `<div class="table-responsive"><table class="erp-table"><thead><tr><th>Producto</th><th>Lote</th><th>Sistema</th><th>Contado</th><th>Diferencia</th><th></th></tr></thead><tbody>${f.map(filaH).join('')}</tbody></table></div>` : ''}
      ${falt.length ? `<label class="form-label">Motivo de los faltantes<select id="tm-mot" class="form-control">${((window.SAR_Gobernanza && window.SAR_Gobernanza.MOTIVOS) || [MOTIVO]).map(m => `<option${m === MOTIVO ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></label><label class="form-label">Observación<input id="tm-obs" class="form-control" placeholder="Opcional"></label>` : ''}
      <button type="button" class="btn btn-primary btn-large" data-a="cerrar"${pend.length || cerrando ? ' disabled' : ''}><i class="ph-bold ph-check-circle" aria-hidden="true"></i> Cerrar toma ${esc(toma.folio)}</button>
      ${pend.length ? '<p class="act-hint">Recuenta las filas marcadas y, si el número está bien, toca «Volví a contar». Si cambió, vuelve a «Contar» y corrige.</p>' : '<p class="act-hint">Al cerrar, el sistema queda con lo contado: los sobrantes y lotes nuevos entran ahora con su código AJU; los faltantes ' + (esSuper() ? 'se aplican ahora (eres superadministrador).' : 'quedan en Aprobaciones para el superadministrador.') + '</p>'}</div>`;
  }

  // ---------------- acciones ----------------
  async function abrir() {
    const r = root(), bod = (r.querySelector('#tm-bod') || {}).value, tipo = (r.querySelector('input[name="tm-tipo"]:checked') || {}).value || 'parcial'; if (!bod) return;
    let folio = '';
    try { folio = window.SAR_Cola && !(await window.SAR_Cola.hayConexion()) ? window.SAR_Folio.provisional('INV') : await window.SAR_Folio.siguiente('INV'); } catch (e) { folio = window.SAR_Folio ? window.SAR_Folio.provisional('INV') : 'INV-P-' + Date.now().toString(36); }
    toma = { id: 'tm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), folio, bodega: bod, tipo, abiertaEn: new Date().toISOString(), por: usuario(), productos: {} };
    guardarToma(); vista = 'contar'; await cargarInsumos(); pintar();
  }
  function elegir(id) { sel = id; q = ''; loteSel = null; const p = ficha(id); if (p && p.snap.batches.length === 1) loteSel = { clave: T().clave(p.snap.batches[0].batch, p.snap.batches[0].expirationDate), lote: T().lote(p.snap.batches[0].batch), vence: p.snap.batches[0].expirationDate }; pintar(); }
  function sumar(qty, extra) {
    const p = ficha(sel); if (!p) return; const n = Math.floor(num(qty)); if (!(n > 0)) { toast('Cantidad', 'Escribe cuántas unidades contaste.', 'warning'); return; }
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
      const p = ficha(x.id); if (p.conteos.some(c => c.folio === folio)) { toast('Ya contada', `${folio} ya está en el conteo.`, 'warning'); sel = x.id; pintar(); return; }
      sel = x.id; loteSel = { clave: T().clave(b.lote, b.vence), lote: T().lote(b.lote), vence: b.vence || 'N/A', nuevo: !p.snap.batches.some(z => T().clave(z.batch, z.expirationDate) === T().clave(b.lote, b.vence)) };
      if (b.estado === 'CERRADA' && num(b.contenido) > 0) { sumar(num(b.contenido), { folio }); toast('Caja contada', `${folio}: ${num(b.contenido)} u. del lote ${T().lote(b.lote)}.`, 'success'); return; }
      pintar(); toast('Caja abierta', `${folio} está abierta: cuenta las unidades y súmalas.`, 'info'); return;
    }
    const t = norm(txt), x = insumos.find(i => [i.codigoSAR, i.codigoMP, i.code, i.codigoBarras].some(c => c && norm(c) === t)) || insumos.find(i => norm(i.name) === t);
    if (x) elegir(x.id); else { q = txt; pintar(); }
  }
  async function cerrar() {
    if (cerrando) return; const r = root(), motivo = (r.querySelector('#tm-mot') || {}).value || MOTIVO, obs = (r.querySelector('#tm-obs') || {}).value || '';
    const filas = resumen(); if (filas.some(x => x.reconteo)) return;
    const plan = { id: toma.id, folio: toma.folio, bodega: toma.bodega, tipo: toma.tipo, motivo, obs, por: usuario(), superadmin: esSuper(), en: new Date().toISOString(),
      lineas: filas.map((x, n) => ({ n, insumoId: x.id, nombre: x.p.nombre, lote: x.l.batch, vence: x.l.venceOriginal || (x.l.vence === 'N/A' ? 'N/A' : x.l.vence), delta: x.l.delta, sistema: x.l.sistema, contado: x.l.contado == null ? 0 : x.l.contado, estado: x.l.estado })) };
    const P = window.SAR_Progreso;
    if (P && P.confirmar && !(await P.confirmar({ titulo: `Cerrar toma ${toma.folio}`, texto: `${plan.lineas.length} diferencia(s) en ${esc(toma.bodega)}. El sistema queda con lo contado.`, si: 'Cerrar toma', no: 'Volver' }))) return;
    cerrando = true; pintar();
    try {
      if (window.SAR_Cola && !(await window.SAR_Cola.hayConexion())) { window.SAR_Cola.encolar({ tipo: 'toma-cierre', titulo: `Cierre de toma ${toma.folio} · ${toma.bodega} · ${plan.lineas.length} diferencia(s)`, datos: plan }); toast('Sin internet: cierre en cola', `La toma ${toma.folio} se aplicará sola al volver la conexión (mantén el Visor abierto).`, 'info'); }
      else { const res = await aplicarCierre(plan); toast('Toma cerrada', `${toma.folio}: ${res.aplicadas} ajuste(s) aplicados${res.solicitudes ? ` · ${res.solicitudes} faltante(s) esperando al superadministrador` : ''}.`, 'success'); }
      toma = null; sel = null; loteSel = null; guardarToma(); vista = 'contar';
    } catch (e) { toast('No se cerró la toma', (e.message || String(e)) + ' Lo aplicado no se repetirá al reintentar.', 'error'); }
    finally { cerrando = false; pintar(); }
  }
  /** Aplica el cierre. Idempotente: idMov / id de solicitud fijos por toma, producto y línea. */
  async function aplicarCierre(plan) {
    const f = fs(), aj = window.ejecutarAjusteDirecto; if (typeof aj !== 'function') throw new Error('sin conexión: el módulo de ajustes aún no carga');
    let aplicadas = 0, solicitudes = 0; const errores = [];
    for (const l of plan.lineas) {
      const idMov = `toma-${plan.id}-${l.insumoId}-${l.n}`.replace(/[^\w-]/g, '_'), just = `Toma ${plan.folio} (${plan.tipo}) · ${plan.bodega} · lote ${l.lote}: sistema ${l.sistema}, contado ${l.contado}${plan.obs ? ' · ' + plan.obs : ''}`;
      try {
        const sn = await f.getDoc(f.doc(f.collection(db(), 'Insumos'), l.insumoId)); if (!sn.exists()) throw new Error('el producto ya no existe');
        const stock = num(sn.data().quantity), opts = { idMov, motivo: l.delta < 0 ? plan.motivo : MOTIVO, observacion: just, lote: l.lote, ...(l.estado === 'nuevo' && l.vence && l.vence !== 'N/A' ? { vence: l.vence } : {}), saldarDeuda: true };
        if (l.delta > 0 || plan.superadmin) {
          const codigo = window.SAR_Gobernanza ? await window.SAR_Gobernanza.codigo('AJU').catch(() => null) : null;
          await aj(l.insumoId, stock, l.nombre, l.delta, just, codigo, opts); aplicadas++;
        } else {
          const ref = f.doc(f.collection(db(), 'Solicitudes_Ajuste'), idMov), ya = await f.getDoc(ref);
          if (!ya.exists()) await f.setDoc(ref, { code: window.SAR_Folio ? window.SAR_Folio.provisional('AJU') : 'AJU-P', insumoId: l.insumoId, insumoName: l.nombre, cantidad: l.delta, justificacion: just, previousStock: stock, projectedStock: stock + l.delta, motivo: plan.motivo, observacion: just, lote: l.lote, status: 'pendiente', date: f.serverTimestamp(), requester: plan.por || usuario(), inv: plan.folio, toma: plan.id });
          solicitudes++;
        }
      } catch (e) { if (/ya (se )?aplic|ya estaba|existe ya/i.test(String(e && e.message))) { aplicadas++; continue; } errores.push(`${l.nombre} (${l.lote}): ${e.message || e}`); if (/unavailable|offline|network|sin conexi/i.test(String(e && (e.code || '') + ' ' + e.message))) throw new Error('sin conexión: ' + (e.message || e)); }
    }
    try { await f.setDoc(f.doc(f.collection(db(), 'Contadores'), 'toma-' + plan.id), { tipo: 'toma', folio: plan.folio, bodega: plan.bodega, tipoToma: plan.tipo, por: plan.por, cerradaEn: new Date().toISOString(), abiertaPor: plan.por, lineas: plan.lineas, aplicadas, solicitudes, errores }, { merge: true }); } catch (e) { /* el registro de la toma es informativo */ }
    if (errores.length) throw new Error(errores.slice(0, 3).join(' · '));
    return { aplicadas, solicitudes };
  }
  if (window.SAR_Cola && window.SAR_Cola.registrar) window.SAR_Cola.registrar('toma-cierre', async (d) => { await aplicarCierre(d); });

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
      const x = e.target.closest('.tm-x'); if (x && sel) { const p = ficha(sel); p.conteos.splice(+x.dataset.q, 1); guardarToma(); pintar(); return; }
      const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
      if (a === 'abrir') return abrir();
      if (a === 'v-contar') { vista = 'contar'; return pintar(); }
      if (a === 'v-cerrar') { vista = 'cerrar'; sel = null; return pintar(); }
      if (a === 'soltar') { sel = null; loteSel = null; return pintar(); }
      if (a === 'sumar') return sumar((root().querySelector('#tm-qty') || {}).value);
      if (a === 'sl') { loteSel = { nuevo: true, lote: 'S/L', vence: 'N/A' }; return pintar(); }
      if (a === 'cam') { const t = await window.SAR_Bultos.leerConCamara('Leer la etiqueta de la caja'); if (t) leido(t); return; }
      if (a === 'recontar') { const p = toma.productos[b.dataset.id]; if (p) { p.recontado[b.dataset.k] = true; guardarToma(); } return pintar(); }
      if (a === 'cerrar') return cerrar();
      if (a === 'descartar') { const P = window.SAR_Progreso; if (P && P.confirmar && !(await P.confirmar({ titulo: 'Descartar la toma', texto: `Se borra el conteo de ${esc(toma.folio)} en este equipo. El stock no cambia.`, si: 'Descartar', no: 'Volver', peligro: true }))) return; toma = null; sel = null; guardarToma(); return pintar(); }
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
