/* ==========================================================================
   UNIFICAR PRODUCTOS DUPLICADOS DE UNA BODEGA (v21.153)
   Un producto debe existir una sola vez por bodega. Si quedó repetido (mismo ID de Mercado Público o mismo nombre),
   se junta en uno: suma cantidad y lotes, suma el sobregiro con su detalle por acta, y las actas ya emitidas pasan a
   apuntar al producto que queda. Deja un movimiento UNIFICACION_STOCK en el historial. Siempre pide confirmación.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const num = (v) => Number(v) || 0;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const clave = (d) => { const mp = String(d.codigoMP || '').replace(/\D/g, ''); return mp ? 'mp:' + mp : 'n:' + norm(d.name); };
  const lotesDe = (d) => (Array.isArray(d.batches) && d.batches.length ? d.batches : (num(d.quantity) > 0 ? [{ batch: d.batch || 'S/L', quantity: num(d.quantity), expirationDate: d.expirationDate || '' }] : []));

  /** Puro: grupos de duplicados dentro de una lista [{id, data}] (misma bodega).
   *  v21.228: repetido = mismo ID de Mercado Público O mismo nombre (sin tildes ni espacios). Antes solo por ID cuando lo había:
   *  la sabanilla con 3 registros 4623811 y 1 registro 4623804, todos con el mismo nombre, no se juntaba. */
  function detectar(docs) {
    const l = (docs || []).filter(x => x.data && String(x.data.name || '').trim() && x.data.status !== 'CUARENTENA'), padre = l.map((_, i) => i);
    const raiz = (i) => { while (padre[i] !== i) { padre[i] = padre[padre[i]]; i = padre[i]; } return i; }, une = (a, b) => { a = raiz(a); b = raiz(b); if (a !== b) padre[b] = a; };
    const porN = new Map(), porMp = new Map();
    l.forEach((x, i) => { const n = norm(x.data.name), mp = String(x.data.codigoMP || '').replace(/\D/g, '');
      if (porN.has(n)) une(porN.get(n), i); else porN.set(n, i); if (mp) { if (porMp.has(mp)) une(porMp.get(mp), i); else porMp.set(mp, i); } });
    const g = new Map(); l.forEach((x, i) => { const r = raiz(i); if (!g.has(r)) g.set(r, []); g.get(r).push(x); });
    return [...g.values()].filter(x => x.length > 1);
  }
  /** Puro: junta un grupo en un solo producto. Sobrevive el que tiene más stock (a igualdad, el que no es provisional y luego el primero). */
  function fusionar(grupo) {
    const orden = grupo.slice().sort((a, b) => (num(b.data.quantity) - num(a.data.quantity)) || ((a.data.provisional ? 1 : 0) - (b.data.provisional ? 1 : 0)));
    const sobre = orden[0], lotes = new Map(), det = new Map();
    let sg = 0;
    orden.forEach(x => {
      lotesDe(x.data).forEach(b => { const k = String(b.batch || 'S/L').toUpperCase() + '|' + String(b.expirationDate || ''); const p = lotes.get(k); if (p) p.quantity += num(b.quantity); else lotes.set(k, { ...b, batch: String(b.batch || 'S/L').toUpperCase(), quantity: num(b.quantity) }); });
      sg += num(x.data.sobregiro);
      (Array.isArray(x.data.sobregiroDetalle) ? x.data.sobregiroDetalle : []).forEach(s => { const k = String(s.acta || ''); det.set(k, (det.get(k) || 0) + num(s.qty)); });
    });
    const batches = [...lotes.values()].filter(b => b.quantity > 0), quantity = batches.reduce((t, b) => t + b.quantity, 0);
    const detalle = [...det.entries()].map(([acta, qty]) => ({ acta, qty })).filter(s => s.qty > 0);
    const provisional = orden.every(x => !!x.data.provisional);
    return { id: sobre.id, quitar: orden.slice(1).map(x => x.id), patch: { quantity, cantidad: quantity, batches, sobregiro: sg, sobregiroDetalle: detalle, provisional, ...(provisional ? {} : { provisional: false }) } };
  }

  async function insumosDe(bodega) {
    const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('location', '==', bodega), f.limit(5000))), l = [];
    sn.forEach(d => l.push({ id: d.id, data: d.data() })); return l;
  }
  /** v21.228: no se puede unir si una solicitud tiene unidades «En tránsito» o por recibir de un registro que se borraría. */
  async function revisarSolicitudes(quitar) {
    const f = fs(), set = new Set(quitar), sn = await f.getDocs(f.query(f.collection(db(), 'Solicitudes_Insumos'), f.limit(2000))), cambiar = [];
    for (const d of sn.docs) {
      const x = d.data(); if (!Array.isArray(x.lineas)) continue; let toca = false;
      x.lineas.forEach(l => { if (set.has(l.insumoId) || (l.seleccion || []).some(z => set.has(z.insumoId)) || Object.values(l.transito || {}).some(v => set.has(v))) toca = true; });
      if (!toca) continue;
      const abierta = !['ENTREGADA', 'ANULADA'].includes(x.estado);
      if (abierta && x.lineas.some(l => Object.values(l.transito || {}).some(v => set.has(v)) || (l.seleccion || []).some(z => set.has(z.insumoId) && (l.movidos || []).length > (l.recibidos || []).length)))
        throw new Error(`La solicitud ${x.correlativo || d.id} tiene unidades en camino de uno de estos registros: márcala «Recibido» antes de unir.`);
      cambiar.push(d);
    }
    return cambiar;
  }
  async function repuntarSolicitudes(docs, quitar, id) {
    const f = fs(), set = new Set(quitar), cambia = (v) => set.has(v) ? id : v;
    for (const d of docs) { const x = d.data(); await f.updateDoc(d.ref, { lineas: x.lineas.map(l => ({ ...l, ...(l.insumoId ? { insumoId: cambia(l.insumoId) } : {}), ...(Array.isArray(l.seleccion) ? { seleccion: l.seleccion.map(z => ({ ...z, insumoId: cambia(z.insumoId) })) } : {}) })), actualizadoEn: new Date().toISOString() }); }
  }
  async function repuntarBultos(quitar, id) {
    const f = fs(), set = new Set(quitar); let sn; try { sn = await f.getDocs(f.query(f.collection(db(), 'Contadores'), f.where('tipo', '==', 'bulto'), f.limit(5000))); } catch (e) { return; }
    for (const d of sn.docs) if (set.has(d.data().insumoId)) await f.setDoc(d.ref, { insumoId: id }, { merge: true });
  }
  async function repuntarActas(quitar, id) {
    const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Actas_Entrega'), f.limit(5000))), set = new Set(quitar);   // v21.228: antes 600
    for (const d of sn.docs) {
      const items = d.data().items; if (!Array.isArray(items) || !items.some(i => set.has(i.id))) continue;
      if (d.data().estado && d.data().estado !== 'EMITIDA') continue;   /* v21.228: las reglas solo dejan editar actas EMITIDA; las anuladas o de prueba quedan como registro histórico */
      await f.updateDoc(d.ref, { items: items.map(i => set.has(i.id) ? { ...i, id } : i) });
    }
  }
  async function unir(grupo, usuario) {
    const f = fs(), r = fusionar(grupo);
    /* v21.228: no unir si algún registro tiene lotes que no suman su total (cambiaría el stock sin explicación) */
    grupo.forEach(x => { const b = x.data.batches; if (Array.isArray(b) && b.length && b.reduce((t, l) => t + num(l.quantity), 0) !== num(x.data.quantity)) throw new Error(`«${x.data.name}» tiene lotes que no suman su total: corrígelo con un ajuste antes de unir.`); });
    const sols = await revisarSolicitudes(r.quitar);   // v21.228: bloquea si hay unidades en camino; luego reapunta solicitudes y cajas
    await repuntarActas(r.quitar, r.id); await repuntarSolicitudes(sols, r.quitar, r.id); await repuntarBultos(r.quitar, r.id);
    await f.runTransaction(db(), async (tx) => {
      const refs = [r.id].concat(r.quitar).map(i => f.doc(f.collection(db(), 'Insumos'), i)), snaps = [];
      for (const rf of refs) snaps.push(await tx.get(rf));
      const fresco = fusionar(snaps.map((s, k) => ({ id: refs[k].id, data: s.exists() ? s.data() : {} })).filter(x => x.data && x.data.name));
      if (fresco.id !== r.id) throw new Error('El stock de estos registros cambió mientras se unían: vuelve a revisar y une de nuevo.');   /* v21.228: actas y solicitudes ya apuntan a r.id */
      tx.update(f.doc(f.collection(db(), 'Insumos'), fresco.id), { ...fresco.patch, updatedAt: f.serverTimestamp() });
      fresco.quitar.forEach(i => tx.delete(f.doc(f.collection(db(), 'Insumos'), i)));
      tx.set(f.doc(f.collection(db(), 'Historial_Movimientos')), { type: 'UNIFICACION_STOCK', insumoName: grupo[0].data.name, insumoId: fresco.id, quantity: 0, batch: 'S/L', document: 'UNIFICACION', user: usuario, date: f.serverTimestamp(), observations: `Se unieron ${fresco.quitar.length + 1} registros repetidos en uno (stock ${fresco.patch.quantity}, sobregiro ${fresco.patch.sobregiro}).`, observacion: `Se unieron ${fresco.quitar.length + 1} registros repetidos en uno (stock ${fresco.patch.quantity}, adeudado ${fresco.patch.sobregiro}). Registros quitados: ${fresco.quitar.join(', ')}.`, origin: (grupo[0].data.location || ''), quitados: fresco.quitar });
    });
    return r;
  }

  async function abrir(bodega, alTerminar) {
    const grupos = detectar(await insumosDe(bodega));
    const ov = document.createElement('div'); ov.className = 'sm-ov'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99990;display:flex;align-items:center;justify-content:center;padding:16px;';
    const fila = (g) => { const r = fusionar(g); return `<li><b>${esc(g[0].data.name)}</b> <small>· ${g.length} registros → 1 · stock ${r.patch.quantity}${r.patch.sobregiro ? ' · sobregiro ' + r.patch.sobregiro : ''}</small></li>`; };
    ov.innerHTML = `<div role="dialog" aria-modal="true" style="background:#fff;border-radius:14px;width:640px;max-width:100%;max-height:86vh;overflow:auto;padding:22px;"><h3 style="margin:0 0 6px;">Unificar productos repetidos</h3>
      <p class="act-hint">Bodega: <b>${esc(bodega)}</b>. ${grupos.length ? `Hay ${grupos.length} producto${grupos.length === 1 ? '' : 's'} repetido${grupos.length === 1 ? '' : 's'}. Se suma el stock, los lotes y el sobregiro en un solo registro; las actas emitidas siguen funcionando. No se puede deshacer.` : 'No hay productos repetidos.'}</p>
      ${grupos.length ? `<ul class="act-hint" style="text-align:left;padding-left:18px;">${grupos.map(fila).join('')}</ul>` : ''}
      <div id="sm-err" style="color:#b42318;font-weight:600;margin-top:8px;"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;"><button type="button" class="btn btn-outline" id="sm-c">${grupos.length ? 'Cancelar' : 'Cerrar'}</button>${grupos.length ? '<button type="button" class="btn btn-primary" id="sm-ok">Unificar ahora</button>' : ''}</div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#sm-c').onclick = () => ov.remove();
    const ok = ov.querySelector('#sm-ok'); if (!ok) return;
    ok.onclick = async () => {
      ok.disabled = true; const er = ov.querySelector('#sm-err'); er.textContent = 'Unificando…'; let n = 0;
      try {
        const u = ((window.firebaseAuth || window.auth || {}).currentUser || {}).email || 'admin';
        for (const g of grupos) { await unir(g, u); n++; }
        ov.remove(); if (typeof window.showToast === 'function') window.showToast('Productos unificados', `${n} producto${n === 1 ? '' : 's'} quedaron en un solo registro.`, 'success');
        if (alTerminar) alTerminar();
      } catch (e) { er.textContent = `Se unificaron ${n}; falló uno: ${e.message || e}`; ok.disabled = false; if (n && alTerminar) alTerminar(); }
    };
  }
  if (document) document.addEventListener('click', (e) => { const b = e.target && e.target.closest && e.target.closest('[data-unificar-bodega]'); if (b) abrir(b.dataset.unificarBodega, () => { if (window.SAR_ActasEntrega && window.SAR_ActasEntrega.recargarStock) window.SAR_ActasEntrega.recargarStock(); }); });
  const api = { detectar, fusionar, abrir, insumosDe, unir };
  window.SAR_Unificar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : null);
