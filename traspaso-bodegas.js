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
      movidos.push({ batch: lotes[i].batch || 'S/L', used: usa, expirationDate: lotes[i].expirationDate || '', ...(lotes[i].codigoLote ? { codigoLote: lotes[i].codigoLote } : {}), ...(lotes[i].provider ? { provider: lotes[i].provider } : {}) });
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
      movidos.push({ batch: b.batch || 'S/L', used: s.qty, expirationDate: b.expirationDate || '', ...(b.codigoLote ? { codigoLote: b.codigoLote } : {}), ...(b.provider ? { provider: b.provider } : {}) });
    });
    return { lotes, movidos };
  }
  /** Puro: suma los lotes movidos a la lista de lotes del destino (mismo lote y vencimiento se juntan). */
  function juntarLotes(destino, movidos) {
    const arr = destino.map(b => ({ ...b }));
    movidos.forEach(m => {
      const ex = arr.find(b => b.batch === m.batch && (b.expirationDate || '') === (m.expirationDate || ''));
      if (ex) ex.quantity = num(ex.quantity) + m.used;
      else arr.push({ batch: m.batch, quantity: m.used, expirationDate: m.expirationDate, ...(m.codigoLote ? { codigoLote: m.codigoLote } : {}), ...(m.provider ? { provider: m.provider } : {}) });
    });
    return arr;
  }

  async function moverUno(id, desde, hasta, sel, nota) {
    const qty = sel.reduce((s, x) => s + x.qty, 0);
    const F = fs(), D = db();
    const refO = F.doc(D, 'Insumos', id);
    const snap = await F.getDoc(refO); if (!snap.exists()) throw new Error('El producto ya no existe.');
    const d0 = snap.data();
    let refD;
    let q = await F.getDocs(F.query(F.collection(D, 'Insumos'), F.where('name', '==', d0.name), F.where('location', '==', hasta), F.limit(1)));
    if (q.empty && d0.codigoMP) q = await F.getDocs(F.query(F.collection(D, 'Insumos'), F.where('codigoMP', '==', d0.codigoMP), F.where('location', '==', hasta), F.limit(1)));
    refD = !q.empty ? q.docs[0].ref : F.doc(D, 'Insumos', `tras_${slug(d0.name)}__${slug(hasta)}`);
    const refH = F.doc(F.collection(D, 'Historial_Movimientos'));
    await F.runTransaction(D, async (tx) => {
      const o = await tx.get(refO); if (!o.exists()) throw new Error('El producto ya no existe.');
      const d = o.data(); const sd = await tx.get(refD);
      if (d.status === 'CUARENTENA') throw new Error('En CUARENTENA: no se puede mover.');
      if (qty > num(d.quantity)) throw new Error('Stock insuficiente.');
      const { lotes, movidos } = sacarLotes(d, sel);
      tx.update(refO, { quantity: num(d.quantity) - qty, batches: lotes, updatedAt: F.serverTimestamp() });
      if (sd.exists()) {
        const dd = sd.data(); const fin = num(dd.quantity) + qty, lim = num(dd.criticalLimit || dd.stock_minimo || 50);
        tx.update(refD, { quantity: fin, isCritical: fin <= lim, batches: juntarLotes(lotesDe(dd), movidos), updatedAt: F.serverTimestamp() });
      } else {
        const lim = num(d.criticalLimit || d.stock_minimo || 50), nuevos = juntarLotes([], movidos), prox = [...nuevos].sort(window.fefoCompare || (() => 0))[0];
        const base = { ...d }; delete base.sobregiro; delete base.sobregiroDetalle; delete base.provisional;
        tx.set(refD, { ...base, location: hasta, quantity: qty, isCritical: qty <= lim, criticalLimit: lim, batches: nuevos, batch: prox ? prox.batch : (d.batch || ''), expirationDate: prox && prox.expirationDate ? prox.expirationDate : (d.expirationDate || ''), updatedAt: F.serverTimestamp() });
      }
      tx.set(refH, { insumoName: d.name, quantity: qty, type: 'traspaso', user: ((window.firebaseAuth || window.auth || {}).currentUser || {}).email || 'Usuario', date: F.serverTimestamp(), document: `TRASP-${String(desde).substring(0, 3)}-${String(hasta).substring(0, 3)}`, batch: movidos.length === 1 ? movidos[0].batch : 'MULTI-LOTE', origin: desde, dest: hasta, lotes: movidos, idInsumoOrigen: id, idInsumoDestino: refD.id, ...(nota ? { nota } : {}) });
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
  function pintar() {
    const el = root(); if (!el) return;
    const desde = (document.getElementById('tb-desde') || {}).value || '', hasta = (document.getElementById('tb-hasta') || {}).value || '';
    const op = (sel) => `<option value="">Seleccione…</option>` + bodegas.map(b => `<option value="${esc(b)}"${b === sel ? ' selected' : ''}>${esc(b)}</option>`).join('');
    const filtro = norm((document.getElementById('tb-buscar') || {}).value || '');
    const vis = items.filter(i => !filtro || norm(i.d.name).includes(filtro) || String(i.d.codigoMP || '').includes(filtro));
    el.innerHTML = `<div class="tb-fila"><label>Bodega de origen<select id="tb-desde" class="form-control">${op(desde)}</select></label><span class="tb-flecha" aria-hidden="true"><i class="ph-bold ph-arrow-right"></i></span><label>Bodega de destino<select id="tb-hasta" class="form-control">${op(hasta)}</select></label></div>
      ${desde ? `<div class="tb-barra"><input type="search" id="tb-buscar" class="form-control" placeholder="Buscar producto o ID Mercado Público…" value="${esc((document.getElementById('tb-buscar') || {}).value || '')}"><button type="button" class="btn btn-outline btn-sm" id="tb-todo">Marcar todo lo visible</button></div>
      <div class="tb-tabla-w"><table class="bit-tabla"><thead><tr><th scope="col"></th><th scope="col">Producto</th><th scope="col">Stock</th><th scope="col">Cantidad a mover</th></tr></thead><tbody>${vis.length ? vis.map(i => { const cu = i.d.status === 'CUARENTENA', lt = lotesDe(i.d).filter(b => num(b.quantity) > 0).sort(window.fefoCompare || (() => 0)), uno = lt.length <= 1; const inputs = lt.map(b => `<label class="tb-lote"><span>${uno ? '' : 'Lote ' + esc(b.batch || 'S/L') + (b.expirationDate ? ' · ' + esc(b.expirationDate) : '') + ' (' + num(b.quantity) + ')'}</span><input type="number" class="tb-cant form-control" data-clave="${esc(claveL(b))}" min="0" max="${num(b.quantity)}" value="${uno ? num(b.quantity) : 0}"${cu ? ' disabled' : ''} aria-label="Cantidad ${esc(i.d.name)}"></label>`).join(''); return `<tr data-id="${esc(i.id)}"><td><input type="checkbox" class="tb-chk" aria-label="Mover ${esc(i.d.name)}"${cu ? ' disabled' : ''}></td><td><b>${esc(i.d.name)}</b>${cu ? ' <i class="mf-chip mf-warn">Cuarentena</i>' : ''}${uno ? '' : '<br><small class="act-hint">Tiene ' + lt.length + ' lotes: indica cuánto mover de cada uno.</small>'}</td><td>${num(i.d.quantity)}</td><td class="tb-lotes-in">${inputs || '—'}</td></tr>`; }).join('') : '<tr><td colspan="4">No hay productos con stock en esta bodega.</td></tr>'}</tbody></table></div>
      <label class="tb-nota">Nota (opcional)<input type="text" id="tb-nota" class="form-control" maxlength="120" placeholder="Ej: reposición de la bodega de turno"></label>
      <div class="tb-acc"><span id="tb-resumen" class="act-hint"></span><button type="button" class="btn btn-primary" id="tb-ir">Mover seleccionados</button></div><div id="tb-res"></div>` : '<p class="act-hint">Elige la bodega de origen para ver sus productos.</p>'}`;
    const resumen = () => { const n = el.querySelectorAll('.tb-chk:checked').length; const r = document.getElementById('tb-resumen'); if (r) r.textContent = n ? `${n} producto(s) seleccionado(s)` : 'Ningún producto seleccionado'; };
    resumen(); el.addEventListener('change', (e) => { if (e.target.classList && e.target.classList.contains('tb-chk')) resumen(); }, { once: false });
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
    const btn = document.getElementById('tb-ir'); btn.disabled = true; const ok = [], mal2 = [];
    const prog = P && P.iniciar ? P.iniciar('Moviendo productos…', []) : null;
    for (const [n, s] of sel.entries()) { if (prog) prog.paso(`Moviendo ${n + 1} de ${sel.length}: ${String(s.name).slice(0, 48)}`); try { await moverUno(s.id, desde, hasta, s.lotes.map(l => ({ clave: l.clave, qty: l.qty })), nota); ok.push(s); } catch (e) { mal2.push({ ...s, err: (e && e.message) || String(e) }); } }
    out.innerHTML = `<div class="tb-res">${ok.length ? `<p class="tb-ok"><b>${ok.length} movido(s):</b> ${ok.map(s => `${esc(s.name)} (${s.qty})`).join(', ')}.</p>` : ''}${mal2.length ? `<p class="tb-mal"><b>No se movieron ${mal2.length}:</b> ${mal2.map(s => `${esc(s.name)} — ${esc(s.err)}`).join('; ')}.</p>` : ''}</div>`;
    if (prog) { if (mal2.length && !ok.length) prog.error('No se pudo mover'); else prog.listo(`${ok.length} producto(s) movido(s) a ${hasta}`, { aviso: false }); }
    btn.disabled = false; await cargarItems(desde); const nt = document.getElementById('tb-nota'); pintar(); const o2 = document.getElementById('tb-res'); if (o2) o2.innerHTML = out.innerHTML;
    if (mal2.length) t('Transferencia', `${mal2.length} producto(s) no se pudieron mover; revisa el detalle.`, 'warning');
  }
  function limpiar() { items = []; const el = root(); if (el) el.innerHTML = ''; }
  async function abrir() {
    const el = root(); if (!el) return; limpiar();
    try { await cargarBodegas(); pintar(); } catch (e) { el.innerHTML = '<p class="cierre-error">No se pudieron leer las bodegas. Revisa tu conexión.</p>'; }
  }
  function iniciar() {
    const el = root(); if (!el || el.dataset.ok) return; el.dataset.ok = '1';
    el.addEventListener('change', async (e) => { if (e.target.id === 'tb-desde') { await cargarItems(e.target.value).catch(() => { items = []; }); pintar(); } else if (e.target.id === 'tb-hasta') { const h = e.target.value; pintar(); const s = document.getElementById('tb-hasta'); if (s) s.value = h; } });
    el.addEventListener('input', (e) => { if (e.target.id === 'tb-buscar') { const v = e.target.value; pintar(); const b = document.getElementById('tb-buscar'); if (b) { b.value = v; b.focus(); b.setSelectionRange(v.length, v.length); } } });
    el.addEventListener('click', (e) => { if (e.target.closest('#tb-ir')) ir(); if (e.target.closest('#tb-todo')) el.querySelectorAll('.tb-chk:not(:disabled)').forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); });
    window.addEventListener('hashchange', () => { if (window.location.hash !== '#view-transferencias') limpiar(); });
    document.querySelectorAll('.menu-item[data-target="view-transferencias"]').forEach(m => m.addEventListener('click', () => setTimeout(abrir, 50)));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  if (typeof module !== 'undefined' && module.exports) module.exports = { sacarFEFO, sacarLotes, juntarLotes };
  window.SAR_Traspaso = { abrir, sacarFEFO, sacarLotes, juntarLotes };
})(typeof window !== 'undefined' ? window : {}, typeof document !== 'undefined' ? document : {});
