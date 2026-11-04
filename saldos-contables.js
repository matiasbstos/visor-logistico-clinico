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
        return { id, nombre: d.name || '', bodega: d.location || '', q, sg, contable, disp: Math.max(0, contable), pu, valSg: sg * pu, valContable: contable * pu, valDisp: Math.max(0, contable) * pu, estado, provisional: !!d.provisional };
    }
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
            tx.update(insRef, { quantity: c.quantity, batches: c.batches, sobregiro: c.sobregiro, isCritical: c.quantity <= limite, updatedAt: f.serverTimestamp() });
            tx.set(hist, { insumoName: d.name, quantity: c.cuadrado, type: 'CUADRE_SOBREGIRO', user: usuario(), date: f.serverTimestamp(), document: ref || '', batch: 'MULTI-LOTE', origin: d.location || '', lotes: c.usados, idInsumoOrigen: id, observacion: `Cuadre de sobregiro${ref ? ' con ' + ref : ''}: ${c.cuadrado} u. ya entregadas se descuentan del stock ingresado` });
            return c;
        });
    }

    function csv(tipo) {
        const cab = tipo === 'contable'
            ? ['Insumo', 'Bodega', 'En sistema', 'Sobregiro', 'Saldo contable', 'Precio unitario', 'Valor contable', 'Estado']
            : ['Insumo', 'Bodega', 'En sistema', 'Sobregiro', 'Disponible', 'Precio unitario', 'Valor disponible', 'Estado'];
        const celda = (v) => { const t = String(v == null ? '' : v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        const l = filas.map(r => tipo === 'contable'
            ? [r.nombre, r.bodega, r.q, r.sg, r.contable, r.pu, r.valContable, ETIQ[r.estado]]
            : [r.nombre, r.bodega, r.q, r.sg, r.disp, r.pu, r.valDisp, ETIQ[r.estado]]);
        const tot = tipo === 'contable' ? ['TOTAL', '', '', filas.reduce((s, r) => s + r.sg, 0), filas.reduce((s, r) => s + r.contable, 0), '', filas.reduce((s, r) => s + r.valContable, 0), ''] : ['TOTAL', '', '', filas.reduce((s, r) => s + r.sg, 0), filas.reduce((s, r) => s + r.disp, 0), '', filas.reduce((s, r) => s + r.valDisp, 0), ''];
        return '﻿' + [cab, ...l, tot].map(x => x.map(celda).join(';')).join('\r\n');
    }
    function descargar(tipo) {
        if (!filas.length) { toast('Informe', 'No hay datos para exportar.', 'warning'); return; }
        const hoy = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv(tipo)], { type: 'text/csv;charset=utf-8' }));
        a.download = `Informe_${tipo}_${hoy}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    const root = () => document.getElementById('sal-root');
    function pintar() {
        const r = root(); if (!r) return;
        const vis = filas.filter(x => !bodega || x.bodega === bodega);
        const bodegas = [...new Set(filas.map(x => x.bodega).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
        const sum = (k) => vis.reduce((s, x) => s + x[k], 0);
        const listos = vis.filter(x => x.estado === 'LISTO');
        r.innerHTML = `
        <h3 class="act-h" style="margin-top:34px;">Saldos contables y disponibles</h3>
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
        ${cargando ? '<p class="act-hint">Cargando…</p>' : !vis.length ? '<p class="act-hint">Sin insumos en sobregiro. Todo cuadrado.</p>' : `
        <div class="sal-tabla"><div class="sal-fila sal-cab"><span>Insumo</span><span>En sistema</span><span>Sobregiro</span><span>Contable</span><span>Disponible</span><span>Estado</span><span></span></div>
        ${vis.slice(0, 300).map(x => `<div class="sal-fila"><span class="sal-n">${esc(x.nombre)}<small>${esc(x.bodega)}</small></span><span>${x.q}</span><span class="${x.sg > 0 ? 'act-sin' : ''}">${x.sg}</span><span class="${x.contable < 0 ? 'act-sin' : ''}">${x.contable}</span><span>${x.disp}</span><span><i class="sal-e sal-e--${x.estado}">${ETIQ[x.estado]}</i></span><span>${x.estado === 'LISTO' ? `<button type="button" class="btn btn-outline sal-q" data-id="${esc(x.id)}">Cuadrar</button>` : ''}</span></div>`).join('')}</div>${vis.length > 300 ? '<p class="act-hint">Se muestran 300; el informe Excel incluye todos.</p>' : ''}`}`;
        r.querySelector('#sal-b').addEventListener('change', (e) => { bodega = e.target.value; pintar(); });
        r.querySelector('#sal-sp').addEventListener('change', (e) => { soloPend = e.target.checked; cargar(); });
        r.querySelector('#sal-act').addEventListener('click', cargar);
        r.querySelector('#sal-cc').addEventListener('click', () => descargar('contable'));
        r.querySelector('#sal-cd').addEventListener('click', () => descargar('disponible'));
        r.querySelectorAll('.sal-q').forEach(b => b.addEventListener('click', async () => {
            const ref = (prompt('N° de la OC/SDC con que ingresó este stock (opcional):') || '').trim();
            b.disabled = true;
            try { const c = await cuadrarUno(b.dataset.id, ref); toast('Cuadrado', `${c.cuadrado} u. descontadas; sobregiro restante: ${c.sobregiro}.`, 'success'); await cargar(); }
            catch (e) { toast('No se cuadró', e.message, 'error'); b.disabled = false; }
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
    window.SAR_Saldos = { abrir, fila, csv: (t) => csv(t), _set: (f) => { filas = f; } };
})(window, document);
