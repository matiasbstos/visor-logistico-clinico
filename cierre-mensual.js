/* ==========================================================================
   INFORME DE CIERRE MENSUAL (v21.60)
   En Informes (administración): se elige un mes y se baja UN Excel con todo lo necesario para rendir:
   Resumen, Entradas, Salidas, Traspasos, Ajustes y mermas, Actas del mes, Órdenes abiertas, Vencimientos
   y bajo stock, y Saldos actuales por bodega. Solo lee datos; no modifica nada.
   Nota: los «Saldos» son los de hoy (el sistema no guarda una foto del stock al último día del mes);
   para un cierre exacto conviene generarlo el último día del mes o el primero del siguiente.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (v) => Number(v) || 0;
    const ms = (d) => d && d.toMillis ? d.toMillis() : (d && d.seconds ? d.seconds * 1000 : (d ? new Date(d).getTime() : 0));

    /** Puro: categoría de un movimiento. */
    function categoria(m) {
        const t = String(m.type || '');
        if (/^INGRESO/.test(t) || t === 'entrada' || t === 'carga masiva') return 'Entradas';
        if (t === 'salida' || t === 'ENTREGA_ACTA') return 'Salidas';
        if (t === 'traspaso') return 'Traspasos';
        if (/^(ajuste|AJUSTE_CRITICO|auditoria_modificacion_inventario|merma|eliminacion_inventario|toma_inventario|CUADRE_SOBREGIRO|reinicio_total)/.test(t) || /^merma/.test(t)) return 'Ajustes y mermas';
        return 'Otros';
    }
    const fechaTxt = (t) => t ? new Date(t).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    /** Puro: rango [desde, hasta) en ms de un mes "YYYY-MM". */
    function rango(ym) { const [y, m] = ym.split('-').map(Number); return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()]; }

    /** Puro: arma las hojas (arrays de arrays). datos: { movs[], insumos[], actas[], ocs[], resumenStock{vencidos,urgentes,criticos} } */
    function armarHojas(datos, ym) {
        const [d0, d1] = rango(ym), [y, m] = ym.split('-').map(Number), titulo = `${MESES[m - 1]} ${y}`;
        const movs = (datos.movs || []).filter(x => { const t = ms(x.date); return t >= d0 && t < d1; }).sort((a, b) => ms(a.date) - ms(b.date));
        const porCat = {}; movs.forEach(x => { const c = categoria(x); (porCat[c] = porCat[c] || []).push(x); });
        const filaMov = (x) => [fechaTxt(ms(x.date)), x.insumoName || x.item || '', num(x.quantity), x.type || '', x.batch && x.batch !== 'N/A' ? x.batch : '', x.origin || '', x.dest || x.destination || '', x.document || '', x.user || '', x.observacion || ''];
        const cab = ['Fecha', 'Producto', 'Cantidad', 'Tipo', 'Lote', 'Origen', 'Destino', 'Documento', 'Usuario', 'Observación'];
        const actas = (datos.actas || []).filter(a => { const t = new Date(String(a.fecha || '').length === 10 ? a.fecha + 'T12:00:00' : a.fecha).getTime(); return t >= d0 && t < d1; });
        const ocsAb = (datos.ocs || []).filter(o => !o.cerrada);
        const ins = datos.insumos || [], valor = ins.reduce((s, i) => s + num(i.quantity) * num(i.unitPrice), 0), unidades = ins.reduce((s, i) => s + num(i.quantity), 0);
        const rs = datos.resumenStock || { vencidos: [], urgentes: [], criticos: [] };
        const suma = (c) => (porCat[c] || []).reduce((s, x) => s + num(x.quantity), 0);
        const H = [];
        H.push(['Resumen', [[`Informe de cierre mensual · ${titulo}`], ['SAR Elsa Romo Aravena · Visor Logístico'], ['Generado', fechaTxt(Date.now())], [],
            ['Concepto', 'Movimientos', 'Unidades'],
            ...['Entradas', 'Salidas', 'Traspasos', 'Ajustes y mermas', 'Otros'].map(c => [c, (porCat[c] || []).length, suma(c)]), [],
            ['Actas de entrega emitidas en el mes', actas.length], ['  de ellas confirmadas (stock descontado)', actas.filter(a => a.estado === 'EMITIDA' && a.confirmacion && a.confirmacion.estado === 'CONFIRMADA' || (a.estado === 'EMITIDA' && a.stockDescontado !== false && !(a.confirmacion && a.confirmacion.estado === 'PENDIENTE'))).length], ['  por confirmar', actas.filter(a => a.estado === 'EMITIDA' && a.confirmacion && a.confirmacion.estado === 'PENDIENTE').length], ['  anuladas', actas.filter(a => a.estado === 'ANULADA').length],
            ['Órdenes de compra abiertas hoy', ocsAb.length], [],
            ['Stock actual: productos', ins.length], ['Stock actual: unidades', unidades], ['Stock actual: valor (CLP)', Math.round(valor)],
            ['Lotes vencidos hoy', rs.vencidos.length], ['Lotes que vencen en ≤30 días', rs.urgentes.length], ['Productos bajo el mínimo', rs.criticos.length]]]);
        ['Entradas', 'Salidas', 'Traspasos', 'Ajustes y mermas'].forEach(c => H.push([c, [cab, ...(porCat[c] || []).map(filaMov)]]));
        H.push(['Actas del mes', [['N° acta', 'Fecha', 'Centro', 'Bodega origen', 'Estado', 'Entrega', 'Productos', 'Unidades', 'Orden de compra', 'Acta firmada', 'Emitida por'],
            ...actas.map(a => [a.numero, a.fecha, a.centro, a.bodegaOrigen, a.estado === 'ANULADA' ? 'Anulada' : (a.confirmacion && a.confirmacion.estado === 'PENDIENTE' ? 'Por confirmar' : 'Entregada'), a.recibe && a.recibe.nombre || '', (a.items || []).length, (a.items || []).reduce((s, i) => s + num(i.cantidad), 0), a.oc && a.oc.numeroOC || '', a.respaldo ? 'Sí' : 'No', a.creadoPor || ''])]]);
        H.push(['Órdenes abiertas', [['Orden de compra', 'Proveedor', 'Líneas', 'Pedido (u.)', 'Recibido (u.)', 'Faltan (u.)'],
            ...ocsAb.map(o => { const L = o.lineas || []; let p = 0, r = 0; L.forEach(l => Object.keys(l.dist || {}).forEach(k => { p += num(l.dist[k]); r += num((l.recibido || {})[k]); })); return [o.numeroOC || o.id, o.proveedor || '', L.length, p, r, Math.max(0, p - r)]; })]]);
        H.push(['Vencimientos y bajo stock', [['Situación', 'Producto', 'Cantidad', 'Detalle', 'Bodega'],
            ...rs.vencidos.map(x => ['VENCIDO', x.nombre, x.cantidad, `Venció el ${x.vence}${x.lote ? ' · lote ' + x.lote : ''}`, x.bodega]), ...rs.urgentes.map(x => ['Vence en ≤30 días', x.nombre, x.cantidad, `${x.vence} (${x.dias} d)${x.lote ? ' · lote ' + x.lote : ''}`, x.bodega]), ...rs.criticos.map(x => ['Bajo el mínimo', x.nombre, x.cantidad, `Mínimo ${x.minimo}`, x.bodega])]]);
        H.push(['Saldos actuales', [['Bodega', 'Producto', 'Código', 'Cantidad', 'Precio unitario', 'Valor', 'Lote', 'Vence'],
            ...ins.slice().sort((a, b) => String(a.location || '').localeCompare(String(b.location || ''), 'es') || String(a.name || '').localeCompare(String(b.name || ''), 'es')).map(i => [i.location || '', i.name || '', i.code || i.codigoMP || '', num(i.quantity), num(i.unitPrice), Math.round(num(i.quantity) * num(i.unitPrice)), i.batch || '', i.expirationDate || ''])]]);
        return { titulo, hojas: H, nMovs: movs.length };
    }

    async function generar(ym) {
        const f = window.firebaseFirestore, db = window.firebaseDb, X = window.XLSX; if (!f || !db) throw new Error('Sin conexión con la base de datos.'); if (!X) throw new Error('La biblioteca de Excel no cargó. Recarga la página.');
        const [d0, d1] = rango(ym), leer = async (c, extra) => { const l = []; const sn = await f.getDocs(f.query(f.collection(db, c), ...(extra || []))); sn.forEach(d => l.push({ id: d.id, ...d.data() })); return l; };
        const [movs, insumos, actas, ocs] = await Promise.all([
            leer('Historial_Movimientos', [f.where('date', '>=', new Date(d0)), f.where('date', '<', new Date(d1)), f.limit(20000)]), leer('Insumos', [f.limit(5000)]), leer('Actas_Entrega', [f.limit(2000)]), leer('Seguimiento_OC', [f.limit(1000)])]);
        const rs = window.SAR_ResumenStock ? window.SAR_ResumenStock.resumen(insumos, new Date()) : { vencidos: [], urgentes: [], criticos: [] };
        const r = armarHojas({ movs, insumos, actas, ocs, resumenStock: rs }, ym), wb = X.utils.book_new();
        r.hojas.forEach(([nombre, filas]) => { const ws = X.utils.aoa_to_sheet(filas); ws['!cols'] = (filas.reduce((a, f2) => f2.length > a ? f2.length : a, 0) ? Array.from({ length: Math.max(...filas.map(x => x.length)) }, (_, i) => ({ wch: Math.min(60, Math.max(10, ...filas.slice(0, 200).map(x => String(x[i] == null ? '' : x[i]).length + 2))) })) : []); X.utils.book_append_sheet(wb, ws, nombre.slice(0, 31)); });
        X.writeFile(wb, `Cierre_mensual_${ym}.xlsx`); return r;
    }

    function panel() {
        const v = document.getElementById('view-informes'); if (!v || document.getElementById('cm-panel')) return;
        const ahora = new Date(), prev = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1), ym = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
        const p = document.createElement('div'); p.id = 'cm-panel'; p.className = 'bk-panel admin-only';
        p.innerHTML = `<h3>Informe de cierre mensual</h3><p class="act-hint">Un solo Excel con entradas, salidas, traspasos, ajustes y mermas, actas del mes, órdenes abiertas, vencimientos y saldos. Elige el mes y descárgalo.</p>
          <div class="cm-barra"><label>Mes <input type="month" id="cm-mes" value="${ym}" max="${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}"></label><button type="button" class="btn btn-primary btn-sm" id="cm-go"><i class="ph-bold ph-microsoft-excel-logo"></i> Generar Excel</button><small id="cm-msg" role="status"></small></div>
          <p class="act-hint">Los saldos son los de hoy; para un cierre exacto genéralo el último día del mes o el primero del siguiente.</p>`;
        (v.querySelector('.dashboard-container') || v).appendChild(p);
        p.querySelector('#cm-go').addEventListener('click', async (e) => {
            const b = e.currentTarget, msg = p.querySelector('#cm-msg'), mes = p.querySelector('#cm-mes').value; if (!/^\d{4}-\d{2}$/.test(mes)) { msg.textContent = 'Elige un mes.'; return; }
            b.disabled = true; msg.textContent = 'Reuniendo los datos del mes…';
            try { const r = await generar(mes); msg.textContent = `Listo: ${r.nMovs} movimientos de ${r.titulo}.`; } catch (x) { msg.textContent = 'No se pudo generar: ' + (x.message || x); }
            b.disabled = false;
        });
    }
    function iniciar() { panel(); const m = document.querySelector('.menu-item[data-target="view-informes"]'); if (m) m.addEventListener('click', () => setTimeout(panel, 200)); }
    if (typeof document !== 'undefined' && document.body) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar(); }
    window.SAR_CierreMensual = { categoria, rango, armarHojas, generar };
    if (typeof module !== 'undefined') module.exports = { categoria, rango, armarHojas };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
