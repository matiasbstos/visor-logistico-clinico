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

    let filas = [], soloPend = false, bodega = '', cargando = false, tab = 'disp', busq = '', cont = null, contCargando = false, contQ = '';

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
            const snap = await f.getDocs(f.query(col, f.limit(3000)));
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
        const rec = recepciones.length ? [[], ['RECEPCIONES DE ORDEN DE COMPRA'], ['ID recepción', 'Orden', 'Fecha', 'Hora', 'Guía', 'Bodega', 'Producto', 'Unidades', 'Lote', 'Vence', 'Registró', 'Estado', 'Recepción conforme'],
            ...recepciones.flatMap(x => (x.detalle || []).map(d => [x.recId, x.numeroOC, x.fecha, x.hora || '', x.guia || '', x.bodega || '', d.insumoName || d.descripcion, d.cantidad, d.lote || 'S/L', d.vence || 'N/A', x.usuario || '', x.anulada ? 'ANULADA' : '', x.tipoConforme || '']))] : [];
        const porRec = (extra && extra.porRecibir) || [], grp = (extra && extra.grupos) || [];
        const secRec = porRec.length ? [[], ['PENDIENTE DE RECIBIR (órdenes abiertas con mercadería por llegar)'], ['Orden', 'Proveedor', 'Producto', 'ID producto', 'Pedido', 'Recibido', 'Falta recibir', 'Tipo'], ...porRec.flatMap(o => o.lineas.map(l => [o.numeroOC, o.proveedor, l.producto, l.codigoMP, l.pedido, l.recibido, l.pendiente, o.parcial ? 'Recepción parcial' : 'Sin recibir']))] : [];
        const secEnt = grp.length ? [[], ['PENDIENTE DE ENTREGA A CENTROS (según actas de entrega)'], ['Centro', 'Producto', 'ID producto', 'Pendiente', 'Disponible en stock', 'Se puede entregar'], ...grp.flatMap(g => g.items.map(p => [g.centro, p.nombre, p.codigo || '', p.pendiente, p.disponible, p.entregable]))] : [];
        return '﻿' + [cab, ...l, tot, ...rec, ...secRec, ...secEnt].map(x => x.map(celda).join(';')).join('\r\n');
    }
    async function descargar(tipo) {
        const f = fs();
        try {
            // El informe lleva TODO el stock (no solo lo con sobregiro) y las recepciones de OC.
            const sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(3000)));
            const todas = []; sn.forEach(d => todas.push(fila(d.id, d.data())));
            todas.sort((a, b) => a.bodega.localeCompare(b.bodega, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
            if (recs == null) await cargarRec();
            let porRecibir = [], grupos = []; try { if (window.SAR_Pendientes) { const dd = await window.SAR_Pendientes.datos(); porRecibir = dd.porRecibir; grupos = dd.grupos; } } catch (e) { /* el informe sale sin estas secciones */ }
            if (!todas.length && !(recs || []).length) { toast('Informe', 'No hay datos para exportar.', 'warning'); return; }
            const hoy = new Date().toISOString().slice(0, 10);
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv(tipo, { filas: todas, recs: recs || [], porRecibir, grupos })], { type: 'text/csv;charset=utf-8' }));
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
    let recs = null, ocsRaw = [], recQ = '', recCargando = false;
    async function cargarRec() {
        const f = fs(); if (!f || recCargando) return; recCargando = true; pintarRec();
        try { const sn = await f.getDocs(f.collection(db(), 'Seguimiento_OC')); recs = []; ocsRaw = []; sn.forEach(d => { const o = d.data(); ocsRaw.push({ id: d.id, ...o }); (o.recepciones || []).forEach(x => recs.push({ ...x, numeroOC: o.numeroOC, proveedor: o.proveedor, tipoConforme: x.conforme && typeof x.conforme.parcial === 'boolean' ? (x.conforme.parcial ? 'Parcial' : 'Total') : '' })); }); recs.sort((a, b) => String(b.fecha + (b.hora || '')).localeCompare(String(a.fecha + (a.hora || '')))); }
        catch (e) { recs = []; toast('Recepciones', 'No se pudieron leer: ' + e.message, 'error'); }
        recCargando = false; pintarRec();
    }
    function pintarRec() {
        const h = document.getElementById('rec-aud'); if (!h) return;
        if (recs == null && !recCargando) { cargarRec(); return; }
        const t = recQ.trim().toLowerCase(), vis = (recs || []).filter(x => !t || [x.recId, x.numeroOC, x.guia, x.proveedor].join(' ').toLowerCase().includes(t));
        h.innerHTML = `<h3 class="act-h">Recepciones de mercadería</h3>
        <p class="act-hint">Cada recepción de una orden de compra tiene un ID propio (<b>REC-orden-NN</b>) para seguirla.</p>
        <div class="sal-barra"><input id="rec-q" type="search" class="form-control" placeholder="REC-…, orden o guía" value="${esc(recQ)}" autocomplete="off" style="max-width:260px"></div>
        ${recCargando ? (window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando recepciones…') : 'Cargando recepciones…') : !vis.length ? '<p class="act-hint">Sin recepciones registradas.</p>' : `<div class="sal-tabla"><div class="sal-fila sal-cab"><span>ID</span><span>Orden</span><span>Fecha</span><span>Guía</span><span>Unidades</span><span>Motivo</span><span>Registró</span></div>${vis.slice(0, 200).map(x => `<div class="sal-fila"><span class="sal-n">${esc(x.recId)}<small>${esc((x.detalle || []).map(d => d.descripcion + ' (' + d.cantidad + ')').join(' · ').slice(0, 160))}</small></span><span>${esc(x.numeroOC)}</span><span>${esc(x.fecha)} ${esc(x.hora || '')}</span><span>${esc(x.guia || '—')}</span><span>${num(x.unidades)}</span><span>${x.anulada ? '<i class="sal-e sal-e--SIN_RESPALDO">Recepción anulada</i>' : '<i class="sal-e sal-e--LISTO">' + esc(x.tipoConforme ? 'Recepción conforme · ' + x.tipoConforme : 'Recepción de orden de compra') + '</i>'}${x.bodega ? '<small>Ingresó a ' + esc(x.bodega) + '</small>' : ''}</span><span>${esc(x.usuario || '')}</span></div>`).join('')}</div>`}`;
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
    // ---------- Contable: libro (kárdex) de un producto ----------
    const fCL = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }) + (String(v).length > 10 ? ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' }) : ''); };
    async function abrirLibro(sel) {
        const V = window.SAR_VidaProducto; if (!V) return;
        contCargando = true; cont = null; pintar();
        try {
            const { p, datos } = await V.reunir(sel);
            const mios = filas.filter(x => p.nombres.has(V.norm(x.nombre)) || (x.codigo && p.codigos.has(String(x.codigo))));
            datos.insumos = datos.insumos && datos.insumos.length ? datos.insumos : [];
            const r = V.construir(datos, p), lib = V.libro(r.eventos);
            const stock = mios.reduce((t, x) => t + x.q, 0), sg = mios.reduce((t, x) => t + x.sg, 0), porMov = lib.length ? lib[lib.length - 1].saldo : 0;
            cont = { sel, lib, mios, stock, sg, porMov, reservado: r.resumen.reservado };
        } catch (e) { toast('Contable', 'No se pudo armar el libro: ' + (e.message || e), 'error'); }
        contCargando = false; pintar();
    }
    function csvLibro() {
        if (!cont) return; const celda = (v) => { const t = String(v == null ? '' : v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        const V = window.SAR_VidaProducto, tipo = (e) => (V.TIPOS[e.tipo] ? V.TIPOS[e.tipo][0] : e.titulo);
        const l = [[`Informe contable · ${cont.sel.nombre}`, cont.sel.codigo ? 'ID ' + cont.sel.codigo : ''], [], ['Fecha', 'Evento', 'Detalle', 'Motivo', 'Bodega', 'Lote', 'Entra', 'Sale', 'Saldo', 'Código', 'Responsable'], ...cont.lib.map(e => [fCL(e.f), tipo(e), e.detalle, e.motivo || '', e.bodega || '', e.lote || '', e.entra || '', e.sale || '', e.mueve ? e.saldo : '', e.codigo || '', e.user || '']), [], ['Stock actual', cont.stock], ['Saldo según movimientos', cont.porMov], ['Sobregiro', cont.sg]];
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + l.map(x => x.map(celda).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `Contable_${(cont.sel.nombre || 'producto').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
    function libroHtml() {
        if (contCargando) return window.SAR_Progreso ? window.SAR_Progreso.cargando('Armando el libro del producto…') : '<p class="act-hint">Armando el libro…</p>';
        if (!cont) return '<p class="act-hint">Busca un producto por nombre o ID para ver toda su historia: cuándo llegó, a qué bodega, cuándo se movió, cuándo salió, ajustes y ediciones.</p>';
        const V = window.SAR_VidaProducto, dif = cont.stock - cont.porMov, k = (n, t, c) => `<div class="sal-k" style="--c:${c}"><b>${n}</b><span>${t}</span></div>`;
        const tipo = (e) => (V.TIPOS[e.tipo] ? V.TIPOS[e.tipo][0] : e.titulo);
        return `<div class="aud-cab"><h3>${esc(cont.sel.nombre)}</h3><small>${cont.sel.codigo ? 'ID ' + esc(cont.sel.codigo) + ' · ' : ''}${cont.mios.map(x => esc(x.bodega) + ': ' + x.q).join(' · ')}</small><button type="button" class="btn btn-outline" id="aud-lib-csv"><i class="ph ph-download-simple"></i> Descargar libro (Excel)</button></div>
        <div class="sal-res">${k(cont.stock, 'Stock actual (todas las bodegas)', 'var(--sar-blue)')}${k(cont.porMov, 'Saldo según movimientos', 'var(--sar-green)')}${k(cont.sg, 'Sobregiro', 'var(--sar-orange)')}${k(cont.reservado, 'Reservado por actas', 'var(--sar-yellow)')}</div>
        ${dif ? `<p class="aud-dif">El stock actual difiere en <b>${dif > 0 ? '+' : ''}${dif}</b> u. de lo que suman los movimientos registrados (ingresos anteriores al sistema, tomas de inventario o cargas sin movimiento). Cualquier cambio desde hoy queda con su código.</p>` : '<p class="aud-ok">El stock actual coincide con la suma de los movimientos.</p>'}
        <div class="sal-tabla"><table class="aud-lib"><thead><tr><th>Fecha</th><th>Evento</th><th>Bodega · lote</th><th class="n">Entra</th><th class="n">Sale</th><th class="n">Saldo</th><th>Código · responsable</th></tr></thead><tbody>
        ${cont.lib.map(e => `<tr class="aud-${esc(e.clase)}"><td>${esc(fCL(e.f))}</td><td><b>${esc(tipo(e))}</b><small>${esc(e.motivo ? e.motivo + ' · ' : '')}${esc(e.detalle || '')}</small></td><td>${esc(e.bodega || '—')}${e.lote ? '<small>' + esc(e.lote) + '</small>' : ''}</td><td class="n">${e.entra || ''}</td><td class="n">${e.sale || ''}</td><td class="n">${e.mueve ? '<b>' + e.saldo + '</b>' : ''}</td><td>${esc(e.codigo || '')}${e.user ? '<small>' + esc(e.user) + '</small>' : ''}</td></tr>`).join('')}</tbody></table></div>`;
    }

    function pintar() {
        pintarSeg();
        const r = root(); if (!r) return;
        const t = (busq || '').trim().toLowerCase();
        const vis = filas.filter(x => (!bodega || x.bodega === bodega) && (!soloPend || x.sg > 0) && (!t || (x.nombre + ' ' + x.codigo + ' ' + x.bodega).toLowerCase().includes(t)));
        const bodegas = [...new Set(filas.map(x => x.bodega).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
        const sum = (k) => vis.reduce((s, x) => s + x[k], 0);
        const listos = vis.filter(x => x.estado === 'LISTO');
        const tabs = `<div class="aud-tabs" role="tablist"><button type="button" role="tab" class="aud-tab${tab === 'disp' ? ' on' : ''}" data-tab="disp" aria-selected="${tab === 'disp'}"><i class="ph ph-package"></i> Disponible</button><button type="button" role="tab" class="aud-tab${tab === 'cont' ? ' on' : ''}" data-tab="cont" aria-selected="${tab === 'cont'}"><i class="ph ph-books"></i> Contable</button></div>`;
        const disp = `
        <p class="act-hint"><b>Disponible</b> = cuántas unidades hay para entregar: lo que está en sistema menos lo ya entregado sin respaldo (sobregiro). Al ingresar la OC/SDC se <b>cuadra</b> y queda lo disponible.</p>
        <div class="sal-barra">
          <input type="search" id="sal-q" class="form-control" placeholder="Buscar insumo, ID o bodega…" value="${esc(busq)}" autocomplete="off" aria-label="Buscar insumo">
          <select id="sal-b" class="form-control" aria-label="Bodega"><option value="">Todas las bodegas</option>${bodegas.map(b => `<option${b === bodega ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>
          <label class="act-chk"><input type="checkbox" id="sal-sp"${soloPend ? ' checked' : ''}> Solo con sobregiro</label>
          <button type="button" class="btn btn-outline" id="sal-act"><i class="ph ph-arrows-clockwise"></i> Actualizar</button>
          <button type="button" class="btn btn-outline" id="sal-cd"><i class="ph ph-download-simple"></i> Informe disponible (Excel)</button>
          ${listos.length ? `<button type="button" class="btn btn-primary" id="sal-todo">Cuadrar ${listos.length} listo${listos.length > 1 ? 's' : ''}</button>` : ''}
        </div>
        <div class="sal-res"><div><b>${vis.reduce((s, x) => s + x.disp, 0).toLocaleString('es-CL')}</b><span>unidades disponibles</span></div><div><b>${vis.length}</b><span>productos en bodega</span></div><div><b>${vis.filter(x => x.sg > 0).length}</b><span>con sobregiro (${sum('sg')} u.)</span></div><div><b>${clp(vis.reduce((s, x) => s + x.valDisp, 0))}</b><span>valor disponible</span></div></div>
        ${cargando ? (window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando el informe…') : 'Cargando el informe…') : !vis.length ? '<p class="act-hint">Sin insumos para mostrar.</p>' : `
        <div class="sal-tabla"><div class="sal-fila sal-cab"><span>Insumo</span><span>Disponible</span><span>En sistema</span><span>Sobregiro</span><span>Bodega</span><span>Estado</span><span></span></div>
        ${vis.slice(0, 400).map(x => `<div class="sal-fila"><span class="sal-n">${esc(x.nombre)}<small>${x.codigo ? 'ID ' + esc(x.codigo) + ' · ' : (x.provisional ? 'sin ID · ' : '')}${x.actas.length ? esc(actasTxt(x)) : ''}</small></span><span><b>${x.disp}</b></span><span>${x.q}</span><span class="${x.sg > 0 ? 'act-sin' : ''}">${x.sg}</span><span>${esc(x.bodega)}</span><span><i class="sal-e sal-e--${x.estado}">${ETIQ[x.estado]}</i></span><span>${x.estado === 'LISTO' ? `<button type="button" class="btn btn-outline sal-q" data-id="${esc(x.id)}">Cuadrar</button>` : ''}${x.provisional && !x.codigo ? `<button type="button" class="btn btn-outline sal-id" data-id="${esc(x.id)}" data-n="${esc(x.nombre)}">Asignar ID</button>` : ''}</span></div>`).join('')}</div>${vis.length > 400 ? '<p class="act-hint">Se muestran 400; el informe Excel incluye todos.</p>' : ''}`}`;
        const conta = `
        <p class="act-hint"><b>Contable</b> es la historia completa de un producto, como un libro: cuándo llegó, a qué bodega, cuándo se movió o salió, ajustes, ediciones y recepciones, cada línea con su motivo y código.</p>
        <div class="sal-barra"><input type="search" id="aud-q" class="form-control" placeholder="Producto o ID de Mercado Público…" value="${esc(contQ)}" autocomplete="off" aria-label="Buscar producto"></div><div id="aud-sug" class="vp-sug"></div>
        <div id="aud-lib">${libroHtml()}</div>
        <div id="rec-aud"></div><div id="gob-aud"></div>`;
        r.innerHTML = `<div class="page-header mb-24"><div class="page-title"><h2>Auditoría</h2><p>Dos informes: lo que hay disponible y la historia contable de cada insumo.</p></div></div>${tabs}${tab === 'disp' ? disp : conta}`;
        r.querySelectorAll('.aud-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; pintar(); }));
        if (tab === 'cont') {
            pintarRec(); if (window.SAR_Gobernanza) window.SAR_Gobernanza.pintarLista(r.querySelector('#gob-aud'));
            const q = r.querySelector('#aud-q'), sug = r.querySelector('#aud-sug'); let tmr = null, lista = [];
            q.addEventListener('input', () => { contQ = q.value; clearTimeout(tmr); tmr = setTimeout(async () => { lista = window.SAR_VidaProducto ? await window.SAR_VidaProducto.sugerencias(q.value) : []; sug.innerHTML = lista.map((x, i) => `<button type="button" class="vp-op" data-i="${i}"><b>${esc(x.nombre)}</b>${x.codigo ? ' <small>ID ' + esc(x.codigo) + '</small>' : ''}</button>`).join(''); }, 250); });
            sug.addEventListener('click', (e) => { const b = e.target.closest('.vp-op'); if (!b) return; const x = lista[Number(b.dataset.i)]; if (x) { contQ = x.nombre; abrirLibro(x); } });
            const c = r.querySelector('#aud-lib-csv'); if (c) c.addEventListener('click', csvLibro);
            return;
        }
        r.querySelector('#sal-b').addEventListener('change', (e) => { bodega = e.target.value; pintar(); });
        r.querySelector('#sal-sp').addEventListener('change', (e) => { soloPend = e.target.checked; pintar(); });
        const sq = r.querySelector('#sal-q'); sq.addEventListener('input', () => { busq = sq.value; const pos = sq.selectionStart; pintar(); const n = document.getElementById('sal-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
        r.querySelector('#sal-act').addEventListener('click', cargar);
        r.querySelector('#sal-cd').addEventListener('click', () => descargar('disponible'));
        r.querySelectorAll('.sal-q').forEach(b => b.addEventListener('click', async () => {
            const ref = (prompt('N° de la OC/SDC con que ingresó este stock (opcional):') || '').trim();
            b.disabled = true;
            try { const c = await window.SAR_Progreso.correr('Cuadrando el insumo…', () => cuadrarUno(b.dataset.id, ref), (x) => `${x.cuadrado} u. descontadas; sobregiro restante: ${x.sobregiro}`, { informe: true }); await cargar(); }
            catch (e) { toast('No se cuadró', e.message, 'error'); b.disabled = false; }
        }));
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
        const tt = r.querySelector('#sal-todo');
        if (tt) tt.addEventListener('click', async () => {
            const ref = (prompt(`Se cuadrarán ${listos.length} insumos. N° de la OC/SDC (opcional):`) || '').trim();
            tt.disabled = true; let ok = 0, mal = 0;
            for (const x of listos) { try { await cuadrarUno(x.id, ref); ok++; } catch (e) { mal++; } }
            toast(mal ? 'Cuadre parcial' : 'Cuadrado', `${ok} cuadrados${mal ? `, ${mal} con error` : ''}.`, mal ? 'warning' : 'success'); await cargar();
        });
    }
    function abrir() { cargar(); }
    window.SAR_Saldos = { abrir, seguir, pintarSeg, _id: (v) => { segId = v; }, fila, csv: (t) => csv(t), _set: (f) => { filas = f; } };
})(window, document);
