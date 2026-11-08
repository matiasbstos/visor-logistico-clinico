/* ==========================================================================
   RESUMEN DE VENCIMIENTOS Y BAJO STOCK POR CORREO (v21.58)
   Una vez al día, la primera vez que el personal abre el Visor después de las 07:00, se revisa el
   inventario. Si hay algo vencido, por vencer en 30 días o bajo el mínimo, sale un correo a los tres
   destinatarios (mismo formato de los demás avisos). Si no hay urgencias, solo se manda un resumen
   los lunes. Un registro en Contadores/resumen-stock-<día> evita enviar dos veces el mismo día,
   aunque abran el Visor varias personas. Solo lee Insumos.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const STAFF = ['admin', 'administrador', 'operador', 'global', 'superadmin'];
    const MAX_FILAS = 30, DIAS_URGENTE = 30, DIAS_PRECAUCION = 90;
    const num = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) ? d : Number(v);
    const diaKey = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
    function parseFecha(v) {
        if (window.SAR_Utils && window.SAR_Utils.parseDate) { const d = window.SAR_Utils.parseDate(v); return d && !isNaN(d.getTime()) ? d : null; }
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')) || null; if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        const c = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(String(v || '')); return c ? new Date(+c[3], +c[2] - 1, +c[1]) : null;
    }
    /** Puro: { vencidos[], urgentes[], precaucion[], criticos[] } a partir de la lista de insumos y la fecha de hoy. */
    function resumen(items, hoy) {
        hoy = new Date((hoy || new Date()).getTime()); hoy.setHours(0, 0, 0, 0);
        const r = { vencidos: [], urgentes: [], precaucion: [], criticos: [] };
        (items || []).forEach(it => {
            const qty = num(it.quantity !== undefined ? it.quantity : it.totalAcumulado, 0), lim = num(it.criticalLimit !== undefined && it.criticalLimit !== '' ? it.criticalLimit : it.stock_minimo, 50);
            const nombre = String(it.name || it.insumoName || '').trim(); if (!nombre) return;
            if (qty <= lim) r.criticos.push({ nombre, cantidad: qty, minimo: lim, bodega: it.location || '' });
            const lotes = (Array.isArray(it.batches) && it.batches.length) ? it.batches.map(l => ({ batch: l.batch, vence: l.expirationDate, quantity: num(l.quantity, 0) })) : [{ batch: it.batch, vence: it.expirationDate, quantity: qty }];
            lotes.forEach(l => {
                if (!(l.quantity > 0)) return; const d = parseFecha(l.vence); if (!d) return;
                const dias = Math.ceil((d - hoy) / 86400000), fila = { nombre, cantidad: l.quantity, lote: l.batch || '', vence: d.toLocaleDateString('es-CL'), dias, bodega: it.location || '' };
                if (dias < 0) r.vencidos.push(fila); else if (dias <= DIAS_URGENTE) r.urgentes.push(fila); else if (dias <= DIAS_PRECAUCION) r.precaucion.push(fila);
            });
        });
        r.vencidos.sort((a, b) => a.dias - b.dias); r.urgentes.sort((a, b) => a.dias - b.dias); r.precaucion.sort((a, b) => a.dias - b.dias); r.criticos.sort((a, b) => a.cantidad - b.cantidad);
        return r;
    }
    /** Puro: ¿corresponde mandar correo hoy? Urgencias → siempre; si no, solo los lunes. */
    function debeEnviar(r, hoy) { const urg = r.vencidos.length + r.urgentes.length + r.criticos.length > 0; return urg || (hoy || new Date()).getDay() === 1; }
    function aFilas(r) {
        const f = [];
        r.vencidos.slice(0, MAX_FILAS).forEach(x => f.push({ nombre: x.nombre, cantidad: x.cantidad, extra: `VENCIDO hace ${-x.dias} d (${x.vence})${x.lote ? ' · lote ' + x.lote : ''}${x.bodega ? ' · ' + x.bodega : ''}` }));
        r.urgentes.slice(0, MAX_FILAS).forEach(x => f.push({ nombre: x.nombre, cantidad: x.cantidad, extra: `Vence en ${x.dias} d (${x.vence})${x.lote ? ' · lote ' + x.lote : ''}${x.bodega ? ' · ' + x.bodega : ''}` }));
        r.criticos.slice(0, MAX_FILAS).forEach(x => f.push({ nombre: x.nombre, cantidad: x.cantidad, extra: `Bajo el mínimo (${x.minimo})${x.bodega ? ' · ' + x.bodega : ''}` }));
        return f;
    }
    async function revisar() {
        const f = window.firebaseFirestore, db = window.firebaseDb; if (!f || !db || !window.SAR_Avisos) return;
        const ahora = new Date(); if (ahora.getHours() < 7) return;
        const id = 'resumen-stock-' + diaKey(ahora), ref = f.doc(f.collection(db, 'Contadores'), id);
        try { if ((await f.getDoc(ref)).exists()) return; } catch (e) { return; }
        let items = []; try { const sn = await f.getDocs(f.query(f.collection(db, 'Insumos'), f.limit(4000))); sn.forEach(d => items.push(d.data())); } catch (e) { return; }
        if (!items.length) return;
        const r = resumen(items, ahora), enviar = debeEnviar(r, ahora);
        const usuario = (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || '';
        try { await f.setDoc(ref, { tipo: 'resumen-stock', dia: diaKey(ahora), enviado: enviar, por: usuario, vencidos: r.vencidos.length, urgentes: r.urgentes.length, criticos: r.criticos.length, precaucion: r.precaucion.length, updatedAt: f.serverTimestamp() }); } catch (e) { return; }
        if (!enviar) return;
        const notas = [];
        if (r.precaucion.length) notas.push(`Además, ${r.precaucion.length} lote(s) vencen entre 31 y ${DIAS_PRECAUCION} días.`);
        [['vencidos', r.vencidos], ['urgentes', r.urgentes], ['criticos', r.criticos]].forEach(([k, l]) => { if (l.length > MAX_FILAS) notas.push(`Se muestran ${MAX_FILAS} de ${l.length} ${k === 'criticos' ? 'productos bajo el mínimo' : k === 'vencidos' ? 'lotes vencidos' : 'lotes por vencer'}; el resto está en el Visor.`); });
        const titulo = r.vencidos.length || r.urgentes.length ? 'Vencimientos y bajo stock' : 'Resumen semanal de stock';
        window.SAR_Avisos.avisar({ id: 'aviso-' + id, evento: 'resumen-stock', titulo, sujeto: `Revisión del ${ahora.toLocaleDateString('es-CL')}`, asunto: `[Visor SAR] ${titulo}: ${r.vencidos.length} vencidos, ${r.urgentes.length} por vencer, ${r.criticos.length} bajo mínimo`,
            intro: `${r.vencidos.length} lote(s) vencido(s) · ${r.urgentes.length} vencen en ${DIAS_URGENTE} días o menos · ${r.criticos.length} producto(s) bajo el mínimo.`, filas: aFilas(r), notas });
    }
    function iniciar() { const t = setInterval(() => { const rol = String(document.body.dataset.userRole || '').toLowerCase(); if (STAFF.includes(rol) && window.firebaseFirestore && window.firebaseDb) { clearInterval(t); setTimeout(() => revisar().catch(() => {}), 6000); } }, 2000); }
    if (document.body) iniciar();
    window.SAR_ResumenStock = { resumen, debeEnviar, aFilas, revisar };
    if (typeof module !== 'undefined') module.exports = { resumen, debeEnviar, aFilas };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
