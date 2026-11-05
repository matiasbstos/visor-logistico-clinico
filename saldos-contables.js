/* ==========================================================================
   SALDOS CONTABLES Y DISPONIBLES (v20.52)
   Complementa las Actas de entrega: lo entregado sin stock en sistema queda como "sobregiro".
     En sistema (quantity)  nunca baja de 0
     Saldo contable         = en sistema − sobregiro   (puede ser negativo)
     Disponible             = máx(0, en sistema − sobregiro)
   Cuando ingresa la OC/SDC (sube "en sistema") se CUADRA: se descuenta lo ya entregado y queda lo disponible.
   Informes CSV (Excel): contable (valorizado) y disponible. Sin datos de pacientes.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (v) => Number(v) || 0;
    const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); };
    const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };
    const clp = (n) => '$' + Math.round(num(n)).toLocaleString('es-CL');

    let filas = [], soloPend = true, bodega = '', cargando = false;

    function fila(id, d) {
        const q = num(d.quantity), sg = num(d.sobregiro), pu = num(d.unitPrice);
        const contable = q - sg;
        const estado = sg > 0 ? (q > 0 ? 'LISTO' : 'SIN_RESPALDO') : (d.provisional ? 'PROVISIONAL' : 'OK');
        return { id, nombre: d.name || '', bodega: d.location || '', q, sg, contable, disp: Math.max(0, contable), pu, valSg: sg * pu, valContable: contable * pu, valDisp: Math.max(0, contable) * pu, estado, codigo: String(d.codigoMP || ''), provisional: !!d.provisional, actas: (window.SAR_ActasEntrega && window.SAR_ActasEntrega.detalleDe ? window.SAR_ActasEntrega.detalleDe(d) : []) };
    }
    const actasTxt = (r) => (r.actas || []).map(a => `${a.acta} (${a.qty})`).join(', ');
    const ETIQ = { SIN_RESPALDO: 'Sin respaldo', LISTO: 'Listo para cuadrar', PROVISIONAL: 'Provisional', OK: 'OK' };

    async function cargar() {
        const f = fs(); cargando = true; pintar();
        try {
            const col = f.collection(db(), 'Insumos');
            const snap = await f.getDocs(soloPend ? f.query(col, f.where('sobregiro', '>', 0), f.limit(1500)) : f.query(col, f.limit(3000)));
            filas = []; snap.forEach(d => filas.push(fila(d.id, d.data())));
            filas.sort((a, b) => (b.sg - a.sg) || a.nombre.localeCompare(b.nombre, 'es'));
        } catch (e) { toast('Saldos', 'No se pudieron cargar los saldos: ' + e.message, 'error'); filas = []; }
        cargando = false; pintar();
    }

    async function cuadrarUno(id, ref) {
        const f = fs(), A = window.SAR_ActasEntrega;
        if (!A || !A.cuadrar) throw new Error('Módulo de actas no disponible.');
        const insRef = f.doc(f.collection(db(), 'Insumos'), id), hist = f.doc(f.collection(db(), 'Historial_Movimientos'));
        return f.runTransaction(db(), async (tx) => {
            const sn = await tx.get(insRef); if (!sn.exists()) throw new Error('El insumo ya no existe.');
            const d = sn.data(), c = A.cuadrar(d);
            if (!(c.cuadrado > 0)) throw new Error('No hay nada que cuadrar (aún no ingresa stock al sistema).');
            const limite = num(d.criticalLimit || d.stock_minimo || 50);
            tx.update(insRef, { quantity: c.quantity, batches: c.batches, sobregiro: c.sobregiro, sobregiroDetalle: c.sobregiroDetalle, isCritical: c.quantity <= limite, updatedAt: f.serverTimestamp() });
            c.cubiertas.forEach((cu, k) => tx.set(k === 0 ? hist : f.doc(f.collection(db(), 'Historial_Movimientos')), { insumoName: d.name, quantity: cu.qty, type: 'CUADRE_SOBREGIRO', user: usuario(), date: f.serverTimestamp(), document: ref || '', batch: 'MULTI-LOTE', origin: d.location || '', idInsumoOrigen: id, observacion: `Cuadre del acta ${cu.acta}${ref ? ' con ' + ref : ''}: ${cu.qty} u. ya entregadas se descuentan del stock ingresado`, actaId: cu.acta }));
            return c;
        });
    }

    function csv(tipo, extra) {
        const filasX = (extra && extra.filas) || filas, recepciones = (extra && extra.recs) || [];
        const cab = tipo === 'contable'
            ? ['Insumo', 'ID producto', 'Bodega', 'En sistema', 'Sobregiro', 'Saldo contable', 'Precio unitario', 'Valor contable', 'Estado', 'Actas con sobregiro (unidades)']
            : ['Insumo', 'ID producto', 'Bodega', 'En sistema', 'Sobregiro', 'Disponible', 'Precio unitario', 'Valor disponible', 'Estado', 'Actas con sobregiro (unidades)'];
        const celda = (v) => { const t = String(v == null ? '' : v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        const l = filasX.map(r => tipo === 'contable'
            ? [r.nombre, r.codigo, r.bodega, r.q, r.sg, r.contable, r.pu, r.valContable, ETIQ[r.estado], actasTxt(r)]
            : [r.nombre, r.codigo, r.bodega, r.q, r.sg, r.disp, r.pu, r.valDisp, ETIQ[r.estado], actasTxt(r)]);
        const tot = tipo === 'contable' ? ['TOTAL', '', '', '', filasX.reduce((s, r) => s + r.sg, 0), filasX.reduce((s, r) => s + r.contable, 0), '', filasX.reduce((s, r) => s + r.valContable, 0), '', ''] : ['TOTAL', '', '', '', filasX.reduce((s, r) => s + r.sg, 0), filasX.reduce((s, r) => s + r.disp, 0), '', filasX.reduce((s, r) => s + r.valDisp, 0), '', ''];
        const rec = recepciones.length ? [[], ['RECEPCIONES DE ORDEN DE COMPRA'], ['ID recepción', 'Orden', 'Fecha', 'Hora', 'Guía', 'Bodega', 'Producto', 'Unidades', 'Lote', 'Vence', 'Registró', 'Estado'],
            ...recepciones.flatMap(x => (x.detalle || []).map(d => [x.recId, x.numeroOC, x.fecha, x.hora || '', x.guia || '', x.bodega || '', d.insumoName || d.descripcion, d.cantidad, d.lote || 'S/L', d.vence || 'N/A', x.usuario || '', x.anulada ? 'ANULADA' : '']))] : [];
        return '﻿' + [cab, ...l, tot, ...rec].map(x => x.map(celda).join(';')).join('\r\n');
    }
    async function descargar(tipo) {
        const f = fs();
        try {
            // El informe lleva TODO el stock (no solo lo con sobregiro) y las recepciones de OC.
            const sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(3000)));
            const todas = []; sn.forEach(d => todas.push(fila(d.id, d.data())));
            todas.sort((a, b) => a.bodega.localeCompare(b.bodega, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
            if (recs == null) await cargarRec();
            if (!todas.length && !(recs || []).length) { toast('Informe', 'No hay datos para exportar.', 'warning'); return; }
            const hoy = new Date().toISOString().slice(0, 10);
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv(tipo, { filas: todas, recs: recs || [] })], { type: 'text/csv;charset=utf-8' }));
            a.download = `Informe_${tipo}_${hoy}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        } catch (e) { toast('Informe', 'No se pudo generar: ' + e.message, 'error'); }
    }

    // ---- seguimiento por ID de acta ----
    let segId = '', seg = null, segCargando = false;
    async function seguir() {
        const f = fs(); seg = null;
        if (!segId) { pintar(); return; }
        segCargando = true; pintar();
        try {
            const aq = await f.getDocs(f.query(f.collection(db(), 'Actas_Entrega'), f.where('numero', '==', segId), f.limit(1)));
            if (aq.empty) { seg = { vacio: true }; }
            else {
                const acta = aq.docs[0].data(); const ins = {};
                for (const it of acta.items || []) { try { const sn = await f.getDoc(f.doc(f.collection(db(), 'Insumos'), it.id)); if (sn.exists()) ins[it.id] = sn.data(); } catch (e) { /* sin permiso o borrado */ } }
                const hq = await f.getDocs(f.query(f.collection(db(), 'Historial_Movimientos'), f.where('actaId', '==', segId), f.limit(200)));
                const movs = []; hq.forEach(d => { const m = d.data(); const t = m.date && m.date.toDate ? m.date.toDate().getTime() : (Date.parse(m.date) || 0); movs.push({ ...m, _t: t }); });
                movs.sort((a, b) => a._t - b._t);
                seg = { acta, ins, movs };
            }
        } catch (e) { toast('Seguimiento', 'No se pudo buscar: ' + e.message, 'error'); seg = null; }
        segCargando = false; pintar();
    }
    const TIPOS = { ENTREGA_ACTA: 'Entrega', CUADRE_SOBREGIRO: 'Cuadre de sobregiro', ANULACION_ACTA: 'Anulación', EDICION_ACTA: 'Edición del acta', ACTA_PRUEBA: 'Acta de prueba', ANULACION_RECEPCION: 'Anulación de recepción' };
    const fh = (m) => m._t ? new Date(m._t).toLocaleString('es-CL') : '';
    function itemsSeg() {
        return (seg.acta.items || []).map(it => {
            const d = seg.ins[it.id] || {}; const det = (window.SAR_ActasEntrega && d ? window.SAR_ActasEntrega.detalleDe(d) : []);
            const pend = seg.acta.estado === 'ANULADA' ? 0 : det.filter(x => x.acta === seg.acta.numero).reduce((t, x) => t + x.qty, 0);
            const sin = num(it.sinRespaldo), cubierto = seg.acta.estado === 'ANULADA' ? 0 : Math.max(0, sin - pend);
            return { nombre: it.nombre, entregado: num(it.cantidad), conRespaldo: num(it.cantidad) - sin, sin, cubierto, pend, enSistema: num(d.quantity), sobregiroInsumo: num(d.sobregiro) };
        });
    }
    function segHtml() {
        if (segCargando) return '<p class="act-hint">Buscando…</p>';
        if (!seg) return '';
        if (seg.vacio) return `<p class="act-err" style="padding-left:0">No existe el acta ${esc(segId)}.</p>`;
        const a = seg.acta, its = itemsSeg(), pend = its.reduce((t, x) => t + x.pend, 0);
        const estado = a.estado === 'ANULADA' ? 'ANULADA' : !a.conSobregiro ? 'Entregada con respaldo' : pend > 0 ? `Sobregiro pendiente: ${pend} u.` : 'Cuadrada';
        return `<div class="seg-cab"><b>${esc(a.numero)}</b> · ${esc(a.centro)} · ${esc(a.fecha)} · ${esc(a.bodegaOrigen)} · ${esc(a.creadoPor || '')}<span class="sal-e sal-e--${a.estado === 'ANULADA' ? 'SIN_RESPALDO' : pend > 0 ? 'PROVISIONAL' : 'LISTO'}">${esc(estado)}</span></div>
        <div class="sal-tabla"><div class="sal-fila sal-cab seg-f"><span>Insumo</span><span>Entregado</span><span>Con respaldo</span><span>Sin respaldo</span><span>Cuadrado</span><span>Pendiente</span></div>
        ${its.map(x => `<div class="sal-fila seg-f"><span class="sal-n">${esc(x.nombre)}</span><span>${x.entregado}</span><span>${x.conRespaldo}</span><span class="${x.sin ? 'act-sin' : ''}">${x.sin}</span><span>${x.cubierto}</span><span class="${x.pend ? 'act-sin' : ''}">${x.pend}</span></div>`).join('')}</div>
        <h4 class="act-h4">Movimientos</h4>
        ${seg.movs.length ? `<ul class="seg-mov">${seg.movs.map(m => `<li><b>${esc(TIPOS[m.type] || m.type)}</b> · ${esc(m.insumoName || '')} · ${num(m.quantity)} u.<span>${esc(fh(m))} · ${esc(m.user || '')}${m.document && m.type === 'CUADRE_SOBREGIRO' ? ' · ref. ' + esc(m.document) : ''}</span>${m.observacion ? `<small>${esc(m.observacion)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="act-hint">Sin movimientos registrados.</p>'}`;
    }
    function descargarSeg() {
        if (!seg || !seg.acta) return;
        const celda = (v) => { const t = String(v == null ? '' : v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        const its = itemsSeg();
        const filasCsv = [[`Seguimiento del acta ${seg.acta.numero}`, seg.acta.centro, seg.acta.fecha, seg.acta.bodegaOrigen, seg.acta.estado], [], ['Insumo', 'Entregado', 'Con respaldo', 'Sin respaldo', 'Cuadrado', 'Pendiente (sobregiro)', 'En sistema hoy'], ...its.map(x => [x.nombre, x.entregado, x.conRespaldo, x.sin, x.cubierto, x.pend, x.enSistema]), [], ['Fecha', 'Movimiento', 'Insumo', 'Cantidad', 'Usuario', 'Referencia', 'Detalle'], ...seg.movs.map(m => [fh(m), TIPOS[m.type] || m.type, m.insumoName || '', num(m.quantity), m.user || '', m.type === 'CUADRE_SOBREGIRO' ? (m.document || '') : '', m.observacion || ''])];
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + filasCsv.map(x => x.map(celda).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `Seguimiento_${seg.acta.numero}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    // Recepciones de mercadería (ID REC-<orden>-NN) para seguimiento en Auditoría
    let recs = null, recQ = '', recCargando = false;
    async function cargarRec() {
        const f = fs(); if (!f || recCargando) return; recCargando = true; pintarRec();
        try { const sn = await f.getDocs(f.collection(db(), 'Seguimiento_OC')); recs = []; sn.forEach(d => { const o = d.data(); (o.recepciones || []).forEach(x => recs.push({ ...x, numeroOC: o.numeroOC, proveedor: o.proveedor })); }); recs.sort((a, b) => String(b.fecha + (b.hora || '')).localeCompare(String(a.fecha + (a.hora || '')))); }
        catch (e) { recs = []; toast('Recepciones', 'No se pudieron leer: ' + e.message, 'error'); }
        recCargando = false; pintarRec();
    }
    function pintarRec() {
        const h = document.getElementById('rec-aud'); if (!h) return;
        if (recs == null && !recCargando) { cargarRec(); return; }
        const t = recQ.trim().toLowerCase(), vis = (recs || []).filter(x => !t || [x.recId, x.numeroOC, x.guia, x.proveedor].join(' ').toLowerCase().includes(t));
        h.innerHTML = `<h3 class="act-h">Recepciones de mercadería</h3>
        <p class="act-hint">Cada recepción de una orden de compra tiene un ID propio (<b>REC-orden-NN</b>) para seguirla.</p>
        <div class="sal-barra"><input id="rec-q" type="search" placeholder="REC-…, orden o guía" value="${esc(recQ)}" autocomplete="off" style="max-width:260px"></div>
        ${recCargando ? (window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando recepciones…') : 'Cargando recepciones…') : !vis.length ? '<p class="act-hint">Sin recepciones registradas.</p>' : `<div class="sal-tabla"><div class="sal-fila sal-cab"><span>ID</span><span>Orden</span><span>Fecha</span><span>Guía</span><span>Unidades</span><span>Registró</span></div>${vis.slice(0, 200).map(x => `<div class="sal-fila"><span class="sal-n">${esc(x.recId)}<small>${esc((x.detalle || []).map(d => d.descripcion + ' (' + d.cantidad + ')').join(' · ').slice(0, 160))}</small></span><span>${esc(x.numeroOC)}</span><span>${esc(x.fecha)} ${esc(x.hora || '')}</span><span>${esc(x.guia || '—')}</span><span>${num(x.unidades)}</span><span>${esc(x.usuario || '')}</span></div>`).join('')}</div>`}`;
        const q = h.querySelector('#rec-q'); if (q) q.addEventListener('input', () => { recQ = q.value; const pos = q.selectionStart; pintarRec(); const n = document.getElementById('rec-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
    }

    const root = () => document.getElementById('sal-root');
    function pintarSeg() {
        const h = document.getElementById('seg-root'); if (!h) return;
        h.innerHTML = `
        <h3 class="act-h">Seguimiento de un acta</h3>
        <p class="act-hint">Escribe el ID del acta (ej. <b>AE-2026-0001</b>) para ver todo su movimiento: entrega, sobregiro, cuadres y anulación.</p>
        <div class="sal-barra"><input id="seg-q" type="search" placeholder="AE-2026-0001" value="${esc(segId)}" autocomplete="off" style="max-width:220px"><button type="button" class="btn btn-primary" id="seg-b">Buscar</button>${seg && seg.acta ? '<button type="button" class="btn btn-outline" id="seg-csv">Descargar seguimiento (Excel)</button>' : ''}</div>
`;
        const sq = h.querySelector('#seg-q'); const go = () => { segId = sq.value.trim().toUpperCase(); seguir(); };
        h.querySelector('#seg-b').addEventListener('click', go); sq.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        const sc = h.querySelector('#seg-csv'); if (sc) sc.addEventListener('click', descargarSeg);
    }
    function pintar() {
        pintarSeg();
        const r = root(); if (!r) return;
        const vis = filas.filter(x => !bodega || x.bodega === bodega);
        const bodegas = [...new Set(filas.map(x => x.bodega).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
        const sum = (k) => vis.reduce((s, x) => s + x[k], 0);
        const listos = vis.filter(x => x.estado === 'LISTO');
        r.innerHTML = `
        <div class="page-header mb-24"><div class="page-title"><h2>Auditoría</h2><p>Saldos contables y disponibles de los insumos entregados con sobregiro.</p></div></div>
        <h3 class="act-h">Saldos contables y disponibles</h3>
        <p class="act-hint">Lo entregado sin stock en sistema queda como <b>sobregiro</b>. <b>Saldo contable</b> = en sistema − sobregiro (puede ser negativo). Al ingresar la OC/SDC se <b>cuadra</b>: se descuenta lo ya entregado y queda lo disponible.</p>
        <div class="sal-barra">
          <select id="sal-b" aria-label="Bodega"><option value="">Todas las bodegas</option>${bodegas.map(b => `<option${b === bodega ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>
          <label class="act-chk"><input type="checkbox" id="sal-sp"${soloPend ? ' checked' : ''}> Solo con sobregiro</label>
          <button type="button" class="btn btn-outline" id="sal-act">Actualizar</button>
          <button type="button" class="btn btn-outline" id="sal-cc">Informe contable (Excel)</button>
          <button type="button" class="btn btn-outline" id="sal-cd">Informe disponible (Excel)</button>
          ${listos.length ? `<button type="button" class="btn btn-primary" id="sal-todo">Cuadrar ${listos.length} listo${listos.length > 1 ? 's' : ''}</button>` : ''}
        </div>
        <div class="sal-res"><div><b>${vis.filter(x => x.sg > 0).length}</b><span>insumos con sobregiro</span></div><div><b>${sum('sg')}</b><span>unidades sin respaldo</span></div><div><b>${clp(vis.reduce((s, x) => s + x.valSg, 0))}</b><span>valor sin respaldo</span></div><div><b>${listos.length}</b><span>listos para cuadrar</span></div></div>
        ${cargando ? (window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando el informe…') : 'Cargando el informe…') : !vis.length ? '<p class="act-hint">Sin insumos en sobregiro. Todo cuadrado.</p>' : `
        <div class="sal-tabla"><div class="sal-fila sal-cab"><span>Insumo</span><span>En sistema</span><span>Sobregiro</span><span>Contable</span><span>Disponible</span><span>Estado</span><span></span></div>
        ${vis.slice(0, 300).map(x => `<div class="sal-fila"><span class="sal-n">${esc(x.nombre)}<small>${x.codigo ? 'ID ' + esc(x.codigo) + ' · ' : (x.provisional ? 'sin ID · ' : '')}${esc(x.bodega)}${x.actas.length ? ' · ' + esc(actasTxt(x)) : ''}</small></span><span>${x.q}</span><span class="${x.sg > 0 ? 'act-sin' : ''}">${x.sg}</span><span class="${x.contable < 0 ? 'act-sin' : ''}">${x.contable}</span><span>${x.disp}</span><span><i class="sal-e sal-e--${x.estado}">${ETIQ[x.estado]}</i></span><span>${x.estado === 'LISTO' ? `<button type="button" class="btn btn-outline sal-q" data-id="${esc(x.id)}">Cuadrar</button>` : ''}${x.provisional && !x.codigo ? `<button type="button" class="btn btn-outline sal-id" data-id="${esc(x.id)}" data-n="${esc(x.nombre)}">Asignar ID</button>` : ''}</span></div>`).join('')}</div>${vis.length > 300 ? '<p class="act-hint">Se muestran 300; el informe Excel incluye todos.</p>' : ''}`}`;
        r.insertAdjacentHTML('beforeend', '<div id="rec-aud"></div>'); pintarRec();
        r.querySelector('#sal-b').addEventListener('change', (e) => { bodega = e.target.value; pintar(); });
        r.querySelector('#sal-sp').addEventListener('change', (e) => { soloPend = e.target.checked; cargar(); });
        r.querySelector('#sal-act').addEventListener('click', cargar);
        r.querySelector('#sal-cc').addEventListener('click', () => descargar('contable'));
        r.querySelector('#sal-cd').addEventListener('click', () => descargar('disponible'));
        r.querySelectorAll('.sal-q').forEach(b => b.addEventListener('click', async () => {
            const ref = (prompt('N° de la OC/SDC con que ingresó este stock (opcional):') || '').trim();
            b.disabled = true;
            try { const c = await window.SAR_Progreso.correr('Cuadrando el insumo…', () => cuadrarUno(b.dataset.id, ref), (x) => `${x.cuadrado} u. descontadas; sobregiro restante: ${x.sobregiro}`, { informe: true }); await cargar(); }
            catch (e) { toast('No se cuadró', e.message, 'error'); b.disabled = false; }
        }));
        // Producto ingresado a mano sin ID: se le asigna el ID de Mercado Público para asociarlo a la orden de compra y a su foto
        r.querySelectorAll('.sal-id').forEach(b => b.addEventListener('click', async () => {
            const cod = (prompt(`ID del producto (Mercado Público) para "${b.dataset.n}":`) || '').replace(/\D/g, '');
            if (!cod) return;
            b.disabled = true;
            try {
                await window.SAR_Progreso.correr('Asignando el ID al producto…', async () => {
                    const f = fs();
                    await f.updateDoc(f.doc(f.collection(db(), 'Insumos'), b.dataset.id), { codigoMP: cod });
                    const id = (String(cod).normalize('NFD').replace(/[^a-z0-9]+/gi, '-').toLowerCase()).slice(0, 60);
                    await f.setDoc(f.doc(f.collection(db(), 'Catalogo_Productos'), id), { descripcion: b.dataset.n, descripcion_lower: String(b.dataset.n).toLowerCase(), codigoMP: cod, insumoName: b.dataset.n, sinOrden: true, origen: 'MANUAL', actualizado: f.serverTimestamp() }, { merge: true });
                }, `ID ${cod} asignado a ${b.dataset.n}`);
                await cargar();
            } catch (e) { toast('No se asignó el ID', e.message || String(e), 'error'); b.disabled = false; }
        }));
        const t = r.querySelector('#sal-todo');
        if (t) t.addEventListener('click', async () => {
            const ref = (prompt(`Se cuadrarán ${listos.length} insumos. N° de la OC/SDC (opcional):`) || '').trim();
            t.disabled = true; let ok = 0, mal = 0;
            for (const x of listos) { try { await cuadrarUno(x.id, ref); ok++; } catch (e) { mal++; } }
            toast(mal ? 'Cuadre parcial' : 'Cuadrado', `${ok} cuadrados${mal ? `, ${mal} con error` : ''}.`, mal ? 'warning' : 'success'); await cargar();
        });
    }
    function abrir() { cargar(); }
    window.SAR_Saldos = { abrir, seguir, pintarSeg, _id: (v) => { segId = v; }, fila, csv: (t) => csv(t), _set: (f) => { filas = f; } };
})(window, document);
