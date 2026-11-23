/* ==========================================================================
   TRANSFERENCIAS ENTRE BODEGAS (v21.158)
   Pantalla del menú «Transferencias»: se elige bodega de origen y de destino, se marcan varios productos y la
   cantidad de cada uno, y se mueven en un paso. Cada producto es una transacción propia (origen por FEFO +
   destino + historial), igual que el traspaso de una fila de Existencias: conserva lote y vencimiento.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const num = (v) => Number(v) || 0;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const slug = (t) => norm(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const lotesDe = (d) => (Array.isArray(d.batches) && d.batches.length ? d.batches.map(b => ({ ...b })) : (num(d.quantity) > 0 ? [{ batch: d.batch || 'S/L', quantity: num(d.quantity), expirationDate: d.expirationDate || '' }] : []));

  /** Puro: saca `qty` unidades por FEFO. Devuelve los lotes que quedan en el origen y los lotes movidos. */
  function sacarFEFO(data, qty, cmp) {
    const lotes = lotesDe(data); if (cmp) lotes.sort(cmp);
    let falta = qty; const movidos = [];
    for (let i = 0; i < lotes.length && falta > 0; i++) {
      const disp = num(lotes[i].quantity); if (disp <= 0) continue;
      const usa = Math.min(disp, falta); lotes[i].quantity = disp - usa; falta -= usa;
      movidos.push({ batch: lotes[i].batch || 'S/L', used: usa, expirationDate: lotes[i].expirationDate || '', ...(lotes[i].codigoLote ? { codigoLote: lotes[i].codigoLote } : {}), ...(num(lotes[i].porCaja) > 0 ? { porCaja: num(lotes[i].porCaja) } : {}), ...(lotes[i].provider ? { provider: lotes[i].provider } : {}) });
    }
    if (falta > 0) movidos.push({ batch: 'S/L', used: falta, expirationDate: '' });
    return { lotes, movidos };
  }
  const claveL = (b) => String(b.batch || 'S/L') + '|' + String(b.expirationDate || '');
  /** Puro: saca cantidades de lotes elegidos a mano. sel = [{clave, qty}]. Falla si un lote no alcanza. */
  function sacarLotes(data, sel) {
    const lotes = lotesDe(data), movidos = [];
    sel.filter(s => s.qty > 0).forEach(s => {
      const b = lotes.find(x => claveL(x) === s.clave);
      if (!b || num(b.quantity) < s.qty) throw new Error(`El lote ${String(s.clave).split('|')[0]} solo tiene ${b ? num(b.quantity) : 0} unidad(es).`);
      b.quantity = num(b.quantity) - s.qty;
      movidos.push({ batch: b.batch || 'S/L', used: s.qty, expirationDate: b.expirationDate || '', ...(num(b.porCaja) > 0 ? { porCaja: num(b.porCaja) } : {}), ...(b.codigoLote ? { codigoLote: b.codigoLote } : {}), ...(b.provider ? { provider: b.provider } : {}) });
    });
    return { lotes, movidos };
  }
  /** Puro: suma los lotes movidos a la lista de lotes del destino (mismo lote y vencimiento se juntan). */
  function juntarLotes(destino, movidos) {
    const arr = destino.map(b => ({ ...b }));
    movidos.forEach(m => {
      const ex = arr.find(b => b.batch === m.batch && (b.expirationDate || '') === (m.expirationDate || ''));
      if (ex) ex.quantity = num(ex.quantity) + m.used;
      else arr.push({ batch: m.batch, quantity: m.used, expirationDate: m.expirationDate, ...(m.codigoLote ? { codigoLote: m.codigoLote } : {}), ...(m.provider ? { provider: m.provider } : {}), ...(num(m.porCaja) > 0 ? { porCaja: num(m.porCaja) } : {}) });
    });
    return arr;
  }

  /** Marca de una solicitud dentro de la MISMA transacción del movimiento (v21.212): el grupo (producto+lote) queda
   *  anotado en la línea; si ya estaba, no se mueve de nuevo (dos sesiones, dos pestañas o un reintento no duplican).
   *  marca = { numero, i, grupo, campo: 'movidos'|'recibidos', transito? } */
  async function leerMarca(tx, F, D, marca) {
    if (!marca || !marca.numero) return null; const ref = F.doc(D, 'Solicitudes_Insumos', marca.numero), sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('La solicitud ya no existe.');
    const lin = (sn.data().lineas || []).map(x => ({ ...x })), l = lin[marca.i];
    if (!l || (marca.nombre && norm(l.nombre) !== norm(marca.nombre))) throw new Error('La solicitud cambió: actualiza y vuelve a intentar.');
    if ((l[marca.campo] || []).includes(marca.grupo)) throw Object.assign(new Error('Ya estaba hecho.'), { ya: true });
    return { ref, lin, l };
  }
  function escribirMarca(tx, F, m, marca, extra) {
    if (!m) return; m.l[marca.campo] = (m.l[marca.campo] || []).concat([marca.grupo]);
    if (extra && extra.transitoId) m.l.transito = { ...(m.l.transito || {}), [marca.grupo]: extra.transitoId };
    tx.update(m.ref, { lineas: m.lin, actualizadoEn: new Date().toISOString() });
  }
  /** Destino: mismo producto en la bodega de llegada, nunca un registro en CUARENTENA. Primero por nombre exacto,
   *  después por código (como antes de v21.212, sin leer toda la bodega); si el id de respaldo está en cuarentena, otro id. */
  async function buscarDestino(F, D, d0, hasta) {
    const libre = (q) => (q.docs || []).find(x => x.data().status !== 'CUARENTENA');
    let x = libre(await F.getDocs(F.query(F.collection(D, 'Insumos'), F.where('name', '==', d0.name), F.where('location', '==', hasta), F.limit(10))));
    if (!x && d0.codigoMP) x = libre(await F.getDocs(F.query(F.collection(D, 'Insumos'), F.where('codigoMP', '==', d0.codigoMP), F.where('location', '==', hasta), F.limit(10))));
    if (x) return x.ref;
    const base = `tras_${slug(d0.name)}__${slug(hasta)}`; let ref = F.doc(D, 'Insumos', base);
    for (let n = 2; n < 6; n++) { const sn = await F.getDoc(ref); if (!sn.exists() || sn.data().status !== 'CUARENTENA') break; ref = F.doc(D, 'Insumos', `${base}_${n}`); }
    return ref;
  }
  async function moverUno(id, desde, hasta, sel, nota, marca) {
    hasta = String(hasta || '').trim().replace(/\s+/g, ' ');   /* v21.228: el destino nunca con espacios de más (partía el stock en dos «bodegas») */
    sel = sel.map(x => ({ ...x, qty: Math.max(0, Math.floor(num(x.qty))) })); const qty = sel.reduce((s, x) => s + x.qty, 0);
    if (!(qty > 0)) throw new Error('Cantidad inválida.');
    const F = fs(), D = db();
    const refO = F.doc(D, 'Insumos', id);
    const snap = await F.getDoc(refO); if (!snap.exists()) throw new Error('El producto ya no existe.');
    const d0 = snap.data(), refD = await buscarDestino(F, D, d0, hasta);
    // idMov (cola sin conexión): el movimiento usa ese id; si ya existe, la operación ya se aplicó (otra pestaña o reintento)
    const refH = marca && marca.idMov ? F.doc(D, 'Historial_Movimientos', marca.idMov) : F.doc(F.collection(D, 'Historial_Movimientos'));
    try { await F.runTransaction(D, async (tx) => {
      const o = await tx.get(refO); if (!o.exists()) throw new Error('El producto ya no existe.');
      const d = o.data(); const sd = await tx.get(refD); const m = await leerMarca(tx, F, D, marca);
      // Folio TRA-AAAA-NNNNN (estándar de correlativos): uno por operación si viene dado; si no, se toma aquí, en la misma transacción
      const ctr = !(marca && marca.folio) && window.SAR_Folio ? await window.SAR_Folio.leer(tx, 'TRA') : null;
      { const h = await tx.get(refH); if (h.exists()) throw Object.assign(new Error('Ya estaba hecho.'), { ya: true }); }   /* v21.230: siempre (un reintento del SDK tras confirmar no vuelve a mover) */
      const cajasW = marca && Array.isArray(marca.cajas) && marca.cajas.length && window.SAR_Bultos && window.SAR_Bultos.leerCajasTx ? await window.SAR_Bultos.leerCajasTx(tx, F, D, marca.cajas, { ref: marca.numero, destino: marca.destinoCaja || '', soloTraslado: !!marca.soloTraslado }) : null;   /* v21.243: cajas pistoleadas en la misma transacción */
      if (d.status === 'CUARENTENA') throw new Error('En CUARENTENA: no se puede mover.');
      if (qty > num(d.quantity)) throw new Error('Stock insuficiente.');
      const { lotes, movidos } = sacarLotes(d, sel);
      tx.update(refO, { quantity: num(d.quantity) - qty, batches: lotes, updatedAt: F.serverTimestamp() });
      if (sd.exists()) {
        const dd = sd.data(); const fin = num(dd.quantity) + qty, lim = num(dd.criticalLimit || dd.stock_minimo || 50);
        tx.update(refD, { quantity: fin, isCritical: fin <= lim, batches: juntarLotes(lotesDe(dd), movidos), updatedAt: F.serverTimestamp() });
      } else {
        const lim = num(d.criticalLimit || d.stock_minimo || 50), nuevos = juntarLotes([], movidos), prox = [...nuevos].sort(window.fefoCompare || (() => 0))[0];
        const base = { ...d }; delete base.sobregiro; delete base.sobregiroDetalle; delete base.provisional; delete base.bodegaId; delete base.ubicacionEstante; delete base.status; delete base.reservado; delete base.reservas;   /* v21.235: lo reservado por actas se queda en el origen */
        tx.set(refD, { ...base, location: hasta, bodegaNombre: hasta, quantity: qty, isCritical: qty <= lim, criticalLimit: lim, batches: nuevos, batch: prox ? prox.batch : (d.batch || ''), expirationDate: prox && prox.expirationDate ? prox.expirationDate : (d.expirationDate || ''), updatedAt: F.serverTimestamp() });
      }
      tx.set(refH, { insumoName: d.name, quantity: qty, type: 'traspaso', user: ((window.firebaseAuth || window.auth || {}).currentUser || {}).email || 'Usuario', date: F.serverTimestamp(), document: (marca && marca.folio) || (ctr ? window.SAR_Folio.escribir(tx, ctr) : `TRASP-${String(desde).substring(0, 3)}-${String(hasta).substring(0, 3)}`), batch: movidos.length === 1 ? movidos[0].batch : 'MULTI-LOTE', origin: desde, dest: hasta, lotes: movidos, idInsumoOrigen: id, idInsumoDestino: refD.id, ...(nota ? { nota } : {}), ...(marca && marca.numero ? { solicitud: marca.numero } : {}) });
      escribirMarca(tx, F, m, marca, { transitoId: marca && marca.transito ? refD.id : '' }); if (cajasW) cajasW();
    }); } catch (e) {
      if (e && e.ya && !(marca && (marca.idMov || marca.numero))) return { destinoId: refD.id, yaHecho: true };   /* reintento automático tras confirmar: ya se hizo */
      /* v21.230: con mala señal la confirmación puede llegar al servidor aunque el teléfono reciba error: si el movimiento existe, ya se hizo */
      if (!e.ya && /unavailable|deadline|network|offline|timeout/i.test(String((e && (e.code || '')) + ' ' + (e && e.message)))) { try { const h = await F.getDoc(refH); if (h.exists()) return { destinoId: refD.id, yaHecho: true }; } catch (e2) { /* sigue el error original */ } }
      throw e;
    }
    return { destinoId: refD.id };
  }
  /** Salida por lote elegido (pedidos que se consumen y no van a una bodega de uso): descuenta y deja el movimiento. */
  async function salidaUno(id, desde, sel, nota, marca) {
    sel = sel.map(x => ({ ...x, qty: Math.max(0, Math.floor(num(x.qty))) })); const qty = sel.reduce((s, x) => s + x.qty, 0);
    if (!(qty > 0)) throw new Error('Cantidad inválida.');
    const F = fs(), D = db(), refO = F.doc(D, 'Insumos', id), refH = F.doc(F.collection(D, 'Historial_Movimientos'));
    await F.runTransaction(D, async (tx) => {
      const o = await tx.get(refO); if (!o.exists()) throw new Error('El producto ya no existe.'); const m = await leerMarca(tx, F, D, marca);
      const cajasW = marca && Array.isArray(marca.cajas) && marca.cajas.length && window.SAR_Bultos && window.SAR_Bultos.leerCajasTx ? await window.SAR_Bultos.leerCajasTx(tx, F, D, marca.cajas, { ref: marca.numero }) : null;   /* v21.243: cajas pistoleadas en la misma transacción */
      const d = o.data(); if (d.status === 'CUARENTENA') throw new Error('En CUARENTENA: no se puede entregar.');
      if (qty > num(d.quantity)) throw new Error('Stock insuficiente.');
      const { lotes, movidos } = sacarLotes(d, sel);
      tx.update(refO, { quantity: num(d.quantity) - qty, batches: lotes, updatedAt: F.serverTimestamp() });
      tx.set(refH, { insumoName: d.name, quantity: qty, type: 'SALIDA_SOLICITUD', user: ((window.firebaseAuth || window.auth || {}).currentUser || {}).email || 'Usuario', date: F.serverTimestamp(), document: marca ? marca.numero : 'SALIDA', batch: movidos.length === 1 ? movidos[0].batch : 'MULTI-LOTE', origin: desde, lotes: movidos, idInsumoOrigen: id, ...(nota ? { nota, observacion: nota } : {}), ...(marca ? { solicitud: marca.numero } : {}) });
      escribirMarca(tx, F, m, marca); if (cajasW) cajasW();
    });
  }

  let bodegas = [], items = [];
  const root = () => document.getElementById('tb-root');
  async function cargarBodegas() {
    const F = fs(); const s = await F.getDocs(F.collection(db(), 'Bodegas')); const r = [];
    s.forEach(x => { const b = x.data(); if (b.name && b.isActive !== false) r.push(b.name); });
    bodegas = r.sort((a, z) => a.localeCompare(z, 'es'));
  }
  async function cargarItems(desde) {
    const F = fs(); const s = await F.getDocs(F.query(F.collection(db(), 'Insumos'), F.where('location', '==', desde)));
    items = []; s.forEach(x => { const d = x.data(); if (num(d.quantity) > 0) items.push({ id: x.id, d }); });
    items.sort((a, b) => String(a.d.name).localeCompare(String(b.d.name), 'es'));
  }
  /* 4.307: lo marcado (a mano o con la pistola) sobrevive a cada repintado (filtro, pistola) */
  function guardarMarcas(el) {
    const m = new Map(); el.querySelectorAll('tr[data-id]').forEach(tr => { const c = tr.querySelector('.tb-chk'); m.set(tr.dataset.id, { chk: !!(c && c.checked), lotes: [...tr.querySelectorAll('.tb-cant')].map(x => [x.dataset.clave, x.value]) }); });
    return m;
  }
  function ponerMarcas(el, m) {
    el.querySelectorAll('tr[data-id]').forEach(tr => { const g = m.get(tr.dataset.id); if (!g) return; const c = tr.querySelector('.tb-chk'); if (c && !c.disabled) c.checked = g.chk; g.lotes.forEach(([k, v]) => { const x = [...tr.querySelectorAll('.tb-cant')].find(z => z.dataset.clave === k); if (x) x.value = v; }); });
  }
  function pintar() {
    const el = root(); if (!el) return;
    const marcas = guardarMarcas(el);
    const desde = (document.getElementById('tb-desde') || {}).value || '', hasta = (document.getElementById('tb-hasta') || {}).value || '';
    const op = (sel) => `<option value="">Seleccione…</option>` + bodegas.map(b => `<option value="${esc(b)}"${b === sel ? ' selected' : ''}>${esc(b)}</option>`).join('');
    const filtro = norm((document.getElementById('tb-buscar') || {}).value || '');
    const vis = items.filter(i => !filtro || norm(i.d.name).includes(filtro) || String(i.d.codigoMP || '').includes(filtro));
    el.innerHTML = `<div class="tb-fila"><label>Bodega de origen<select id="tb-desde" class="form-control">${op(desde)}</select></label><span class="tb-flecha" aria-hidden="true"><i class="ph-bold ph-arrow-right"></i></span><label>Bodega de destino<select id="tb-hasta" class="form-control">${op(hasta)}</select></label></div>
      ${desde ? `<div class="tb-barra"><span class="scan-input-group tb-pistola"><i class="ph ph-barcode" aria-hidden="true"></i><input type="text" id="tb-pistola" autocomplete="off" placeholder="Pistolea una etiqueta BUL o el código del producto" aria-label="Pistola: etiqueta BUL o código del producto"></span><input type="search" id="tb-buscar" class="form-control" placeholder="Buscar producto o ID Mercado Público…" value="${esc((document.getElementById('tb-buscar') || {}).value || '')}"><button type="button" class="btn btn-outline btn-sm" id="tb-todo">Marcar todo lo visible</button></div>
      <div class="tb-tabla-w"><table class="bit-tabla"><thead><tr><th scope="col"></th><th scope="col">Producto</th><th scope="col">Stock</th><th scope="col">Cantidad a mover</th></tr></thead><tbody>${vis.length ? vis.map(i => { const cu = i.d.status === 'CUARENTENA', lt = lotesDe(i.d).filter(b => num(b.quantity) > 0).sort(window.fefoCompare || (() => 0)), uno = lt.length <= 1; const inputs = lt.map(b => `<label class="tb-lote"><span>${uno ? '' : 'Lote ' + esc(b.batch || 'S/L') + (b.expirationDate ? ' · ' + esc(b.expirationDate) : '') + ' (' + num(b.quantity) + ')'}</span><input type="number" class="tb-cant form-control" data-clave="${esc(claveL(b))}" min="0" max="${num(b.quantity)}" value="${uno ? num(b.quantity) : 0}"${cu ? ' disabled' : ''} aria-label="Cantidad ${esc(i.d.name)}"></label>`).join(''); return `<tr data-id="${esc(i.id)}"><td><input type="checkbox" class="tb-chk" aria-label="Mover ${esc(i.d.name)}"${cu ? ' disabled' : ''}></td><td><b>${esc(i.d.name)}</b>${cu ? ' <i class="mf-chip mf-warn">Cuarentena</i>' : ''}${uno ? '' : '<br><small class="act-hint">Tiene ' + lt.length + ' lotes: indica cuánto mover de cada uno.</small>'}</td><td>${num(i.d.quantity)}</td><td class="tb-lotes-in">${inputs || '—'}</td></tr>`; }).join('') : '<tr><td colspan="4">No hay productos con stock en esta bodega.</td></tr>'}</tbody></table></div>
      <label class="tb-nota">Nota (opcional)<input type="text" id="tb-nota" class="form-control" maxlength="120" placeholder="Ej: reposición de la bodega de turno"></label>
      <div class="tb-acc"><span id="tb-resumen" class="act-hint"></span><button type="button" class="btn btn-primary" id="tb-ir">Mover seleccionados</button></div><div id="tb-res"></div>` : '<p class="act-hint">Elige la bodega de origen para ver sus productos.</p>'}`;
    const resumen = () => { const n = el.querySelectorAll('.tb-chk:checked').length; const r = document.getElementById('tb-resumen'); if (r) r.textContent = n ? `${n} producto(s) seleccionado(s)` : 'Ningún producto seleccionado'; };
    ponerMarcas(el, marcas);
    const pi = document.getElementById('tb-pistola'); if (pi && window.SAR_Pistola) window.SAR_Pistola.conectar(pi, pistola);
    resumen(); el.addEventListener('change', (e) => { if (e.target.classList && e.target.classList.contains('tb-chk')) resumen(); }, { once: false });
  }
  /** 4.307: pistola en Transferencias. BUL → su producto y su lote, con el contenido de la caja; código de producto → lo marca. */
  const cajasLeidas = new Map();   /* id del insumo → folios BUL ya leídos en esta transferencia */
  async function pistola(txt) {
    const P = window.SAR_Pistola, t = window.showToast || (() => {}), el = root(); if (!P || !el) return;
    const pi = document.getElementById('tb-pistola'); if (pi) pi.value = '';
    const desde = (document.getElementById('tb-desde') || {}).value || '';
    let r; try { r = await P.interpretar(txt, items.map(i => ({ id: i.id, ...i.d }))); } catch (e) { t('Pistola', 'No pude leer el código: ' + ((e && e.message) || e), 'error'); return; }
    if (r.tipo === 'tag') { t('Tag CONTADO', window.SAR_Bultos && window.SAR_Bultos.avisoTag ? window.SAR_Bultos.avisoTag(r.folio) : `${r.folio} es un tag de conteo, no una caja.`, 'warning'); return; }
    if (r.tipo === 'nada') { t('Sin coincidencia', r.folio ? `${r.folio} no existe en el sistema.` : `«${String(r.texto).slice(0, 40)}» no es un producto de ${desde}.`, 'warning'); return; }
    const b = r.bulto, it = r.tipo === 'bulto' ? (items.find(i => i.id === b.insumoId) || items.find(i => norm(i.d.name) === norm(b.nombre))) : items.find(i => i.id === r.insumo.id);
    if (!it) { t('No está en el origen', `${r.tipo === 'bulto' ? `La caja ${r.folio} es de «${b.nombre}»` : `«${r.insumo.name}»`}, que no tiene stock en ${desde}.`, 'warning'); return; }
    const bus = document.getElementById('tb-buscar'); if (bus && bus.value) { bus.value = ''; pintar(); }   /* que la fila se vea */
    const tr = [...el.querySelectorAll('tr[data-id]')].find(x => x.dataset.id === it.id); if (!tr) return;
    const chk = tr.querySelector('.tb-chk'); if (!chk || chk.disabled) { t('Cuarentena', `«${it.d.name}» está en cuarentena: no se puede mover.`, 'warning'); return; }
    const cants = [...tr.querySelectorAll('.tb-cant')];
    if (r.tipo === 'bulto') {
      const lote = lotesDe(it.d).find(z => String(z.batch || 'S/L').toUpperCase() === String(b.lote || 'S/L').toUpperCase() && (!b.vence || !z.expirationDate || String(z.expirationDate).slice(0, 7) === String(b.vence).slice(0, 7))) || lotesDe(it.d).find(z => String(z.batch || 'S/L').toUpperCase() === String(b.lote || 'S/L').toUpperCase());
      const inp = lote && cants.find(c => c.dataset.clave === claveL(lote));
      if (!inp) { t('Lote no encontrado', `La caja ${r.folio} es del lote ${b.lote || 'S/L'}, que no está en ${desde}.`, 'warning'); return; }
      const yaUsadas = [...(cajasLeidas.get(it.id) || [])]; if (yaUsadas.includes(r.folio)) { t('Ya leída', `${r.folio} ya está en la lista.`, 'warning'); return; }
      /* la primera caja reemplaza lo que trae la fila por defecto (todo el stock o 0); las siguientes suman */
      const base = yaUsadas.length || chk.checked ? num(inp.value) : 0;
      if (!yaUsadas.length && !chk.checked) cants.forEach(c => { if (c !== inp) c.value = 0; });
      inp.value = Math.min(num(inp.max), base + num(b.contenido)); cajasLeidas.set(it.id, new Set([...yaUsadas, r.folio]));
      chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true }));
      t('Caja agregada', `${r.folio}: ${it.d.name} · lote ${b.lote || 'S/L'} · ${num(b.contenido)} u.`, 'success');
    } else {
      chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true }));
      t('Producto agregado', `${it.d.name}${cants.length > 1 ? ': indica cuánto mover de cada lote.' : ''}`, 'success');
    }
    tr.scrollIntoView({ block: 'nearest' }); const p2 = document.getElementById('tb-pistola'); if (p2) p2.focus();
  }
  async function ir() {
    const el = root(), desde = document.getElementById('tb-desde').value, hasta = document.getElementById('tb-hasta').value, nota = (document.getElementById('tb-nota').value || '').trim();
    const sel = [...el.querySelectorAll('tr[data-id]')].filter(tr => tr.querySelector('.tb-chk') && tr.querySelector('.tb-chk').checked).map(tr => { const it = items.find(i => i.id === tr.dataset.id); const lotes = [...tr.querySelectorAll('.tb-cant')].map(c => ({ clave: c.dataset.clave, qty: Math.floor(num(c.value)), max: num(c.max) })); return { id: tr.dataset.id, name: it.d.name, lotes, qty: lotes.reduce((s, l) => s + l.qty, 0) }; });
    const out = document.getElementById('tb-res'), t = window.showToast || (() => {});
    if (!desde || !hasta) { t('Transferencia', 'Elige la bodega de origen y la de destino.', 'warning'); return; }
    if (desde === hasta) { t('Transferencia', 'El destino debe ser distinto del origen.', 'warning'); return; }
    if (!sel.length) { t('Transferencia', 'Marca al menos un producto.', 'warning'); return; }
    const mal = sel.find(s => s.qty < 1 || s.lotes.some(l => l.qty < 0 || l.qty > l.max)); if (mal) { t('Cantidad', `«${mal.name}»: indica cuánto mover (en productos con varios lotes, de qué lote).`, 'warning'); return; }
    const P = window.SAR_Progreso;
    const sigue = P && P.confirmar ? await P.confirmar({ titulo: `¿Mover ${sel.length} producto${sel.length === 1 ? '' : 's'}?`, texto: `De <b>${esc(desde)}</b> a <b>${esc(hasta)}</b>.`, lineas: sel.slice(0, 8).map(s => `${esc(s.name)} · <b>${s.qty}</b> u.`).concat(sel.length > 8 ? [`y ${sel.length - 8} más…`] : []), si: 'Mover', no: 'Cancelar' }) : window.confirm(`¿Mover ${sel.length} producto(s) de «${desde}» a «${hasta}»?`);
    if (!sigue) return;
    if (window.SAR_Cola && !(await window.SAR_Cola.hayConexion())) {   // sin internet: queda en el teléfono y se aplica al volver la conexión
      sel.forEach(s => window.SAR_Cola.encolar({ tipo: 'traspaso', titulo: `Mover ${s.qty} · ${s.name}: ${desde} → ${hasta}`, datos: { id: s.id, desde, hasta, lotes: s.lotes.map(l => ({ clave: l.clave, qty: l.qty })), nota, en: Date.now() } }));
      ['tb-desde', 'tb-hasta', 'tb-nota', 'tb-buscar'].forEach(id => { const x = document.getElementById(id); if (x) x.value = ''; }); items = []; pintar();
      const o3 = document.getElementById('tb-res'); if (o3) o3.innerHTML = `<div class="tb-res"><p class="tb-ok"><b>Sin conexión: ${sel.length} movimiento(s) guardado(s) en este teléfono.</b> Se aplicarán solos al volver internet (verás el aviso abajo a la derecha).</p></div>`;
      t('Guardado sin conexión', `${sel.length} movimiento(s) quedan por sincronizar.`, 'warning'); return;
    }
    const btn = document.getElementById('tb-ir'); btn.disabled = true; const ok = [], mal2 = [];
    const prog = P && P.iniciar ? P.iniciar('Moviendo productos…', []) : null;
    const folioOp = sel.length > 1 && window.SAR_Folio ? await window.SAR_Folio.siguiente('TRA') : '';   /* un solo TRA para toda la operación */
    for (const [n, s] of sel.entries()) { if (prog) prog.paso(`Moviendo ${n + 1} de ${sel.length}: ${String(s.name).slice(0, 48)}`); try { await moverUno(s.id, desde, hasta, s.lotes.map(l => ({ clave: l.clave, qty: l.qty })), nota, folioOp ? { folio: folioOp } : undefined); ok.push(s); } catch (e) { mal2.push({ ...s, err: (e && e.message) || String(e) }); } }
    out.innerHTML = `<div class="tb-res">${ok.length ? `<p class="tb-ok"><b>${ok.length} movido(s):</b> ${ok.map(s => `${esc(s.name)} (${s.qty})`).join(', ')}.</p>` : ''}${mal2.length ? `<p class="tb-mal"><b>No se movieron ${mal2.length}:</b> ${mal2.map(s => `${esc(s.name)} — ${esc(s.err)}`).join('; ')}.</p>` : ''}</div>`;
    if (prog) { if (mal2.length && !ok.length) prog.error('No se pudo mover'); else prog.listo(`${ok.length} producto(s) movido(s) a ${hasta}`, { aviso: false }); }
    btn.disabled = false;
    if (!mal2.length) { ['tb-desde', 'tb-hasta', 'tb-nota', 'tb-buscar'].forEach(id => { const x = document.getElementById(id); if (x) x.value = ''; }); items = []; cajasLeidas.clear(); }   // todo movido: la pantalla queda en blanco, lista para otra transferencia
    else await cargarItems(desde);
    pintar(); const o2 = document.getElementById('tb-res'); if (o2) o2.innerHTML = out.innerHTML;
    if (mal2.length) t('Transferencia', `${mal2.length} producto(s) no se pudieron mover; revisa el detalle.`, 'warning');
  }
  function limpiar() { cajasLeidas.clear(); items = []; const el = root(); if (el) el.innerHTML = ''; }
  async function abrir() {
    const el = root(); if (!el) return; limpiar();
    try { await cargarBodegas(); pintar(); } catch (e) { el.innerHTML = '<p class="cierre-error">No se pudieron leer las bodegas. Revisa tu conexión.</p>'; }
  }
  function iniciar() {
    const el = root(); if (!el || el.dataset.ok) return; el.dataset.ok = '1';
    el.addEventListener('change', async (e) => { if (e.target.id === 'tb-desde') { cajasLeidas.clear(); await cargarItems(e.target.value).catch((er) => { items = []; if (window.showToast) window.showToast('No pude leer el stock', 'La bodega puede tener productos aunque la lista salga vacía: ' + ((er && er.message) || er) + '. Vuelve a elegirla o recarga.', 'error'); });   /* v21.228: antes se callaba y parecía «sin stock» */ pintar(); } else if (e.target.id === 'tb-hasta') { const h = e.target.value; pintar(); const s = document.getElementById('tb-hasta'); if (s) s.value = h; } });
    el.addEventListener('input', (e) => { if (e.target.id === 'tb-buscar') { const v = e.target.value; pintar(); const b = document.getElementById('tb-buscar'); if (b) { b.value = v; b.focus(); b.setSelectionRange(v.length, v.length); } } });
    el.addEventListener('click', (e) => { if (e.target.closest('#tb-ir')) ir(); if (e.target.closest('#tb-todo')) el.querySelectorAll('.tb-chk:not(:disabled)').forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); });
    window.addEventListener('hashchange', () => { if (window.location.hash !== '#view-transferencias') limpiar(); });
    document.querySelectorAll('.menu-item[data-target="view-transferencias"]').forEach(m => m.addEventListener('click', () => setTimeout(abrir, 50)));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  if (typeof module !== 'undefined' && module.exports) module.exports = { sacarFEFO, sacarLotes, juntarLotes };
  window.SAR_Traspaso = { moverUno, salidaUno, abrir, sacarFEFO, sacarLotes, juntarLotes };
})(typeof window !== 'undefined' ? window : {}, typeof document !== 'undefined' ? document : {});
