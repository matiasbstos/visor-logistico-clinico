/* ==========================================================================
   EDITAR INGRESO DESDE EL HISTORIAL (v21.121)
   Un ingreso (INGRESO_PROVEEDOR) se puede corregir: cantidad, lote, vencimiento, proveedor, tipo de compra,
   documento, tipo de insumo, observaciones y fecha. En UNA transacción:
     · se deshace el efecto anterior sobre el lote del insumo y se aplica el nuevo (stock, contable y disponible salen de ahí),
     · el movimiento queda con los valores nuevos y con la lista de ediciones (quién, cuándo, qué había antes),
     · queda un registro en la auditoría del insumo.
   No se permite dejar un lote con menos de lo que ya se entregó. Si el producto no existe en Existencias, se recrea.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const num = (v) => Number(v) || 0;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const up = (t) => String(t == null ? '' : t).trim().toUpperCase();
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+(sar)$/, '').trim();

  // ---------------- lógica pura ----------------
  /** Lotes del insumo (usa `batches`; si no hay, arma uno con los campos antiguos). */
  function lotesDe(d) {
    if (Array.isArray(d.batches) && d.batches.length) return d.batches.map(b => ({ batch: String(b.batch || 'S/L'), quantity: num(b.quantity), expirationDate: b.expirationDate || '', ...(b.provider ? { provider: b.provider } : {}) }));
    return num(d.quantity) > 0 || d.batch ? [{ batch: String(d.batch || 'S/L'), quantity: num(d.quantity), expirationDate: d.expirationDate || '' }] : [];
  }
  const claveVence = (b) => (/^\d{4}-\d{2}-\d{2}/.test(b.expirationDate || '') ? b.expirationDate : '9999-99-99');
  /**
   * Aplica la edición de un ingreso sobre el insumo.
   * ant = {batch, quantity}   nuevo = {batch, quantity, expirationDate}
   * Devuelve { batches, quantity, batch, expirationDate } o lanza Error si el stock ya no alcanza.
   */
  function aplicarEdicion(insumo, ant, nuevo) {
    const lotes = lotesDe(insumo).map(b => ({ ...b })), qa = Math.max(0, Math.floor(num(ant.quantity))), qn = Math.floor(num(nuevo.quantity));
    if (!(qn >= 0) || qn !== num(nuevo.quantity)) throw new Error('La cantidad debe ser un número entero, 0 o mayor.');
    const la = up(ant.batch) || 'S/L', ln = up(nuevo.batch) || 'S/L';
    if (qa > 0) {
      const i = lotes.findIndex(b => up(b.batch) === la);
      if (i < 0) throw new Error(`No se encontró el lote ${la} en el stock. Corrígelo desde «Editar» en Existencias.`);
      if (lotes[i].quantity < qa) throw new Error(`Del lote ${la} ya se entregó parte: quedan ${lotes[i].quantity} y este ingreso era de ${qa}. No se puede reducir el lote por debajo de lo ya entregado.`);
      lotes[i].quantity -= qa;
    }
    if (qn > 0 || qa === 0) {
      const j = lotes.findIndex(b => up(b.batch) === ln);
      if (j >= 0) { lotes[j].quantity += qn; if (nuevo.expirationDate) lotes[j].expirationDate = nuevo.expirationDate; }
      else lotes.push({ batch: ln, quantity: qn, expirationDate: nuevo.expirationDate || '' });
    }
    const batches = lotes.filter(b => b.quantity > 0).sort((a, b) => claveVence(a).localeCompare(claveVence(b)));
    const quantity = Math.max(0, num(insumo.quantity) - qa + qn), p = batches[0];
    return { batches, quantity, batch: p ? p.batch : '', expirationDate: p ? p.expirationDate : '' };
  }

  // ---------------- datos ----------------
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };
  const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
  const iso = (d) => { try { const x = d.toDate ? d.toDate() : new Date(d); return isNaN(x) ? '' : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; } catch (_) { return ''; } };
  const soloFecha = (t) => { const m = String(t || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; const d = window.SAR_Utils && window.SAR_Utils.parseDate ? window.SAR_Utils.parseDate(t) : null; return d && !isNaN(d) ? iso(d) : ''; };

  async function resolverInsumo(m) {
    const f = fs();
    if (m.insumoId) { const s = await f.getDoc(f.doc(db(), 'Insumos', m.insumoId)); if (s.exists()) return { id: s.id, data: s.data() }; }
    const q = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('name', '==', m.insumoName || m.item || '')));
    const l = []; q.forEach(d => l.push({ id: d.id, data: d.data() }));
    if (!l.length) return null;
    const dest = norm(m.destination === 'Principal' ? 'Bodega Central' : m.destination);
    return l.find(x => norm(x.data.location || x.data.ubicacion || 'Bodega Central') === dest) || l[0];
  }

  async function guardar(m, ins, v) {
    const f = fs(), ahora = new Date().toISOString(), quien = usuario();
    const ant = { quantity: num(m.quantity), batch: m.batch || 'S/L', expirationDate: m.expirationDate || '' };
    const nuevo = { quantity: Math.floor(num(v.quantity)), batch: up(v.batch) || 'S/L', expirationDate: v.expirationDate || '' };
    await f.runTransaction(db(), async (tx) => {
      const mRef = f.doc(db(), 'Historial_Movimientos', m.id), mSnap = await tx.get(mRef);
      if (!mSnap.exists()) throw new Error('El movimiento ya no existe.');
      const mAct = mSnap.data(); if (mAct.type !== 'INGRESO_PROVEEDOR') throw new Error('Solo se pueden editar ingresos de proveedor.');
      const antReal = { quantity: num(mAct.quantity), batch: mAct.batch || 'S/L' };
      let insId = ins ? ins.id : null, res, base;
      if (ins) {
        const iRef = f.doc(db(), 'Insumos', ins.id), iSnap = await tx.get(iRef);
        if (!iSnap.exists()) throw new Error('El producto ya no existe en Existencias. Cierra y vuelve a abrir.');
        base = iSnap.data(); res = aplicarEdicion(base, antReal, nuevo);
        tx.update(iRef, { quantity: res.quantity, cantidad: res.quantity, batches: res.batches, batch: res.batch, lote: res.batch, expirationDate: res.expirationDate, vencimiento: res.expirationDate, tipoInsumo: v.tipoInsumo || base.tipoInsumo || 'medico', updatedAt: f.serverTimestamp() });
      } else {
        const nRef = f.doc(f.collection(db(), 'Insumos')); insId = nRef.id;
        const dest = (mAct.destination && mAct.destination !== 'Principal') ? mAct.destination : 'Bodega Central';
        res = { quantity: nuevo.quantity, batches: nuevo.quantity > 0 ? [{ batch: nuevo.batch, quantity: nuevo.quantity, expirationDate: nuevo.expirationDate }] : [] };
        tx.set(nRef, { name: mAct.insumoName || mAct.item, name_lowercase: String(mAct.insumoName || mAct.item || '').toLowerCase(), category: 'General', quantity: res.quantity, batches: res.batches, batch: nuevo.batch, expirationDate: nuevo.expirationDate, provider: v.provider || 'S/I', purchaseType: v.purchaseType || 'S/I', tipoInsumo: v.tipoInsumo || 'medico', origenOC: true, location: dest, bodegaNombre: dest, createdAt: f.serverTimestamp(), updatedAt: f.serverTimestamp() });
      }
      const ediciones = (Array.isArray(mAct.ediciones) ? mAct.ediciones : []).concat([{ por: quien, en: ahora, antes: { quantity: antReal.quantity, batch: antReal.batch, expirationDate: mAct.expirationDate || '', provider: mAct.provider || '', purchaseType: mAct.purchaseType || '', document: mAct.document || '', tipoInsumo: mAct.tipoInsumo || '', observations: mAct.observations || '' } }]);
      const cambios = { quantity: nuevo.quantity, batch: nuevo.batch, expirationDate: nuevo.expirationDate, provider: v.provider || 'S/I', purchaseType: v.purchaseType || 'S/I', document: v.document || 'S/N', observations: v.observations || '', tipoInsumo: v.tipoInsumo || 'medico', insumoId: insId, editado: true, editadoPor: quien, editadoEn: ahora, ediciones };
      if (v.fecha) { const d = new Date(v.fecha + 'T12:00:00'); if (!isNaN(d)) cambios.date = d; }
      tx.update(mRef, cambios);
      tx.set(f.doc(f.collection(db(), 'Insumos', insId, 'audit_logs')), { action: 'ACTUALIZACION', origen: 'EDICION_INGRESO', movimiento: m.id, por: quien, en: ahora, antes: { quantity: antReal.quantity, batch: antReal.batch }, despues: { quantity: nuevo.quantity, batch: nuevo.batch, expirationDate: nuevo.expirationDate }, stockResultante: res.quantity });
    });
  }

  // ---------------- interfaz ----------------
  function cerrar() { const e = document.getElementById('ei-overlay'); if (e) e.remove(); }
  async function abrir(id) {
    const f = fs();
    try {
      const s = await f.getDoc(f.doc(db(), 'Historial_Movimientos', id)); if (!s.exists()) return toast('Historial', 'El movimiento ya no existe.', 'error');
      const m = { id, ...s.data() };
      if (m.type !== 'INGRESO_PROVEEDOR') return toast('Historial', 'Por ahora solo se editan los ingresos de proveedor. Las entregas, traspasos y ajustes afectan actas y otras bodegas.', 'info');
      const ins = await resolverInsumo(m);
      const stock = ins ? num(ins.data.quantity) : null;
      const fechaMov = iso(m.date) || iso(new Date());
      const campo = (id, etq, val, tipo, extra) => `<label class="form-label" for="${id}" style="margin-top:10px;">${etq}</label><input class="form-control" id="${id}" type="${tipo || 'text'}" value="${esc(val)}" ${extra || ''}>`;
      const ov = document.createElement('div'); ov.id = 'ei-overlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99990;display:flex;align-items:center;justify-content:center;padding:16px;';
      ov.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Editar ingreso" style="background:#fff;border-radius:14px;width:560px;max-width:100%;max-height:92vh;overflow:auto;padding:22px;">
        <h3 style="margin:0 0 4px;">Editar ingreso</h3>
        <div style="font-weight:700;">${esc(m.insumoName || m.item)}</div>
        <p class="act-hint" style="margin:6px 0 10px;">${ins ? `Stock actual en Existencias: <b>${stock}</b>. Al guardar, el stock, el saldo contable y el disponible se ajustan solos.` : '<b>Este producto no está en Existencias.</b> Al guardar se creará con los datos de abajo.'}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px;">
          <div>${campo('ei-cant', 'Cantidad', num(m.quantity), 'number', 'min="0" step="1"')}</div>
          <div>${campo('ei-lote', 'Lote', m.batch || '', 'text')}</div>
          <div>${campo('ei-vence', 'Vencimiento', soloFecha(m.expirationDate), 'date')}</div>
          <div>${campo('ei-fecha', 'Fecha del ingreso', fechaMov, 'date')}</div>
          <div>${campo('ei-prov', 'Proveedor', m.provider || '', 'text')}</div>
          <div>${campo('ei-compra', 'Tipo de compra', m.purchaseType && m.purchaseType !== 'S/I' ? m.purchaseType : '', 'text')}</div>
          <div>${campo('ei-doc', 'Documento de respaldo', m.document && m.document !== 'S/N' ? m.document : '', 'text')}</div>
          <div><label class="form-label" for="ei-tipo" style="margin-top:10px;">Tipo de insumo</label><select class="form-control" id="ei-tipo"><option value="medico">Insumos médicos</option><option value="aseo">Insumos de aseo</option><option value="oficina">Insumos de oficina</option></select></div>
        </div>
        ${campo('ei-obs', 'Observaciones', m.observations || '', 'text')}
        ${Array.isArray(m.ediciones) && m.ediciones.length ? `<p class="act-hint" style="margin-top:10px;">Editado ${m.ediciones.length} vez(es). Última: ${esc(m.editadoPor || '')}.</p>` : ''}
        <div id="ei-err" style="color:#b42318;margin-top:10px;font-weight:600;"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;"><button type="button" class="btn btn-outline" id="ei-cancel">Cancelar</button><button type="button" class="btn btn-primary" id="ei-save">Guardar cambios</button></div></div>`;
      document.body.appendChild(ov);
      document.getElementById('ei-tipo').value = m.tipoInsumo || (ins && ins.data.tipoInsumo) || 'medico';
      document.getElementById('ei-cancel').onclick = cerrar;
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) cerrar(); });
      document.getElementById('ei-save').onclick = async () => {
        const g = (i) => document.getElementById(i).value, err = document.getElementById('ei-err'), b = document.getElementById('ei-save');
        const q = g('ei-cant');
        if (q === '' || !(Number(q) >= 0) || Math.floor(Number(q)) !== Number(q)) { err.textContent = 'La cantidad debe ser un número entero, 0 o mayor.'; return; }
        if (!up(g('ei-lote'))) { err.textContent = 'Indica el lote (o S/L si no tiene).'; return; }
        const G = window.SAR_Gobernanza; let gob = null;
        const cambiaStock = Math.floor(Number(q)) !== num(m.quantity) || up(g('ei-lote')) !== (m.batch || 'S/L') || (g('ei-vence') || '') !== soloFecha(m.expirationDate);
        if (G && cambiaStock) {
          b.disabled = true; err.textContent = 'Verificando…';
          try {
            const v = await G.puedeCorregir(m.insumoName || m.item);
            if (!v.ok) { err.textContent = v.motivo + ' Para cambiar cantidad, lote o vencimiento usa Ajustes / Desajustes.'; b.disabled = false; return; }
          } catch (e) { /* si no se puede verificar, se deja continuar con motivo */ }
          err.textContent = ''; b.disabled = false;
          const r = await G.pedirMotivo('¿Por qué corriges este ingreso?', esc(m.insumoName || m.item) + ': cantidad ' + num(m.quantity) + ' → ' + Math.floor(Number(q)) + '.');
          if (!r) return;
          gob = { ...r, codigo: await G.codigo('CAM') };
        }
        b.disabled = true; err.textContent = '';
        try {
          await guardar(m, ins, { quantity: q, batch: g('ei-lote'), expirationDate: g('ei-vence'), fecha: g('ei-fecha'), provider: g('ei-prov').trim(), purchaseType: g('ei-compra').trim(), document: g('ei-doc').trim(), tipoInsumo: g('ei-tipo'), observations: g('ei-obs').trim() });
          if (gob) await G.registrar({ nombre: m.insumoName || m.item, lote: up(g('ei-lote')), delta: Math.floor(Number(q)) - num(m.quantity), codigo: gob.codigo, motivo: gob.motivo, nota: gob.nota, origen: 'EDITAR_INGRESO', antes: { cantidad: num(m.quantity), lote: m.batch || '', vence: soloFecha(m.expirationDate) }, despues: { cantidad: Math.floor(Number(q)), lote: up(g('ei-lote')), vence: g('ei-vence') || '' }, insumoId: ins ? ins.id : '' });
          cerrar(); toast('Ingreso actualizado', gob ? 'Código de seguimiento: ' + gob.codigo : 'Se corrigió el movimiento y el stock quedó ajustado.', 'success');
          // El Historial se actualiza solo (escucha en tiempo real); Existencias se recarga aquí
          if (typeof window.loadFirstPage === 'function') window.loadFirstPage();
          document.dispatchEvent(new CustomEvent('sar:ingreso-editado', { detail: { id } }));
        } catch (e) { err.textContent = e.message || String(e); b.disabled = false; }
      };
    } catch (e) { toast('No se pudo abrir', e.message || String(e), 'error'); }
  }

  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('.btn-edit-mov') : null;
    if (b) { e.preventDefault(); abrir(b.dataset.id); }
  });

  const api = { abrir, aplicarEdicion, lotesDe };
  if (typeof window !== 'undefined') window.SAR_EditarIngreso = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
