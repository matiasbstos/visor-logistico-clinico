/* Gobernanza de cambios: motivo obligatorio + código de seguimiento + ventana de corrección directa.
   - Todo cambio de cantidad, lote, vencimiento, bodega o ingreso exige un motivo y deja un código (CAM-AAAA-NNNNNN / AJU-AAAA-NNNNNN).
   - La cantidad/lote/vencimiento solo se corrigen directo mientras NADA haya salido de ese insumo y hayan pasado <= 72 h del ingreso;
     después, solo por Ajustes/desajustes. */
(function (window, document) {
  'use strict';
  const MOTIVOS = [
    'Error de digitación', 'Producto no está / no se encontró', 'Merma o daño', 'Conteo físico (toma de inventario)',
    'Devolución', 'Corrección de lote o vencimiento', 'Corrección de proveedor o documento', 'Cambio de bodega', 'Otro'
  ];
  const HORAS = 72;
  const SALIDA = /ENTREGA|TRASPASO|TRANSFER|MERMA|SALIDA|CONSUMO|BAJA|AJUSTE_CRITICO|CUADRE/i;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };
  const aFecha = (v) => { if (!v) return null; if (v.toDate) return v.toDate(); const d = new Date(v); return isNaN(d) ? null : d; };

  // Puro (testeable): ¿se puede corregir directo? movs = movimientos del insumo.
  function evaluarVentana(movs, ahora, horas) {
    const lim = (horas || HORAS) * 3600e3, t = (ahora || new Date()).getTime();
    let ultIngreso = null;
    for (const m of movs || []) {
      const tipo = String(m.type || m.tipo || '');
      if (/^ACTA_PRUEBA/i.test(tipo)) continue;
      if (SALIDA.test(tipo)) return { ok: false, motivo: 'Ya salió stock de este insumo (' + tipo.toLowerCase().replace(/_/g, ' ') + ').' };
      if (/^INGRESO/i.test(tipo)) { const d = aFecha(m.date); if (d && (!ultIngreso || d > ultIngreso)) ultIngreso = d; }
    }
    if (ultIngreso && t - ultIngreso.getTime() > lim) return { ok: false, motivo: 'Pasaron más de ' + (horas || HORAS) + ' h desde el ingreso.' };
    return { ok: true, motivo: '' };
  }

  async function movimientosDe(nombre) {
    const f = fs(), col = f.collection(db(), 'Historial_Movimientos'), out = new Map();
    for (const campo of ['insumoName', 'item']) {
      try { const s = await f.getDocs(f.query(col, f.where(campo, '==', nombre), f.limit(400))); s.forEach((d) => out.set(d.id, d.data())); } catch (e) { /* sin índice: se ignora */ }
    }
    return [...out.values()];
  }
  async function puedeCorregir(nombre) { return evaluarVentana(await movimientosDe(nombre)); }

  async function codigo(pref) {
    const f = fs(), anio = new Date().getFullYear(), ref = f.doc(f.collection(db(), 'Contadores'), 'codigo-cambio-' + anio);
    const n = await f.runTransaction(db(), async (tx) => { const s = await tx.get(ref), v = (s.exists() ? Number(s.data().valor) || 0 : 0) + 1; tx.set(ref, { valor: v, actualizado: f.serverTimestamp() }); return v; });
    return (pref || 'CAM') + '-' + anio + '-' + String(n).padStart(6, '0');
  }

  // Modal: pide el motivo. Devuelve {motivo, nota} o null si cancela.
  function pedirMotivo(titulo, resumen) {
    return new Promise((res) => {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99995;display:flex;align-items:center;justify-content:center;padding:16px;';
      ov.innerHTML = '<div role="dialog" aria-modal="true" style="background:#fff;border-radius:14px;width:480px;max-width:100%;padding:22px;"><h3 style="margin:0 0 6px;">' + esc(titulo || '¿Por qué haces este cambio?') + '</h3>' +
        (resumen ? '<p class="act-hint" style="margin:0 0 10px;">' + resumen + '</p>' : '') +
        '<label class="form-label" for="gob-m">Motivo</label><select class="form-control" id="gob-m"><option value="">Selecciona un motivo…</option>' + MOTIVOS.map((m) => '<option>' + esc(m) + '</option>').join('') + '</select>' +
        '<label class="form-label" for="gob-n" style="margin-top:10px;">Detalle (opcional)</label><input class="form-control" id="gob-n" maxlength="200" placeholder="Ej.: se digitó 100 en vez de 10">' +
        '<div id="gob-e" style="color:#b42318;margin-top:8px;font-weight:600;"></div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;"><button type="button" class="btn btn-outline" id="gob-c">Cancelar</button><button type="button" class="btn btn-primary" id="gob-ok">Confirmar y generar código</button></div></div>';
      document.body.appendChild(ov);
      const fin = (v) => { ov.remove(); res(v); };
      ov.querySelector('#gob-c').onclick = () => fin(null);
      ov.querySelector('#gob-ok').onclick = () => {
        const m = ov.querySelector('#gob-m').value;
        if (!m) { ov.querySelector('#gob-e').textContent = 'Elige el motivo del cambio.'; return; }
        if (m === 'Otro' && !ov.querySelector('#gob-n').value.trim()) { ov.querySelector('#gob-e').textContent = 'Con "Otro" debes escribir el detalle.'; return; }
        fin({ motivo: m, nota: ov.querySelector('#gob-n').value.trim() });
      };
    });
  }

  // Deja el rastro visible (Historial + Auditoría).
  async function registrar(o) {
    const f = fs();
    await f.addDoc(f.collection(db(), 'Historial_Movimientos'), {
      type: 'CAMBIO_CONTROLADO', insumoName: o.nombre, item: o.nombre, quantity: Number(o.delta) || 0, batch: o.lote || '', user: usuario(), date: f.serverTimestamp(),
      document: o.codigo, codigoSeguimiento: o.codigo, motivo: o.motivo, nota: o.nota || '', origen: o.origen || '', antes: o.antes || null, despues: o.despues || null, idInsumo: o.insumoId || ''
    });
  }

  async function pintarLista(el) {
    if (!el) return;
    el.innerHTML = '<h3 class="act-h" style="margin-top:22px;">Cambios con código de seguimiento</h3><p class="act-hint">Cada cambio de cantidad, lote, vencimiento o bodega deja aquí su código, motivo y responsable.</p><div id="gob-l">Cargando…</div>';
    try {
      const f = fs(), s = await f.getDocs(f.query(f.collection(db(), 'Historial_Movimientos'), f.where('type', '==', 'CAMBIO_CONTROLADO'), f.limit(100)));
      const l = []; s.forEach((d) => l.push(d.data()));
      l.sort((a, b) => ((aFecha(b.date) || 0) - (aFecha(a.date) || 0)));
      const box = el.querySelector('#gob-l');
      box.innerHTML = !l.length ? '<p class="act-hint">Aún no hay cambios registrados.</p>' :
        '<div class="sal-tabla">' + l.slice(0, 50).map((x) => { const d = aFecha(x.date); return '<div class="sal-fila" style="grid-template-columns:150px 1.5fr 1.2fr 1fr 1fr;"><span><b>' + esc(x.codigoSeguimiento) + '</b></span><span class="sal-n">' + esc(x.insumoName) + '<small>' + esc(x.antes && x.despues ? Object.keys(x.despues).map((k) => k + ': ' + (x.antes[k] == null ? '' : x.antes[k]) + ' → ' + x.despues[k]).join(' · ') : '') + '</small></span><span>' + esc(x.motivo) + (x.nota ? '<small>' + esc(x.nota) + '</small>' : '') + '</span><span>' + esc(x.user) + '</span><span>' + (d ? d.toLocaleString('es-CL') : '') + '</span></div>'; }).join('') + '</div>';
    } catch (e) { const b = el.querySelector('#gob-l'); if (b) b.textContent = 'No se pudo cargar: ' + (e.message || e); }
  }

  const api = { MOTIVOS, HORAS, evaluarVentana, puedeCorregir, codigo, pedirMotivo, registrar, pintarLista };
  if (typeof window !== 'undefined') window.SAR_Gobernanza = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
