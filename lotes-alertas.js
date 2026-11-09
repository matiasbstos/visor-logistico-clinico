/* ==========================================================================
   ALERTAS POR LOTE (v21.126)
   Un producto tiene UN stock total y se desglosa por lote (lote, vencimiento, cantidad, proveedor).
   Para cada lote se calcula el estado de su vencimiento:
     · vencido (ya pasó) · urgente (vence en 30 días o menos) · precaución (31 a 90 días) · ok
   y para el producto:
     · crítico        → el total está en el mínimo o bajo él
     · crítico útil   → el total aún supera el mínimo, pero lo que queda vigente (sin lotes vencidos ni urgentes)
                        está en el mínimo o bajo él: se acaba pronto aunque haya stock
   ========================================================================== */
(function (window) {
    'use strict';
    const DIAS_URGENTE = 30, DIAS_PRECAUCION = 90;
    const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : (d === undefined ? 0 : d); };
    function parseFecha(v) {
        if (v === undefined || v === null || v === '' || v === 'N/A') return null;
        if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return isNaN(d.getTime()) ? null : new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
        const s = String(v), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        const c = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s.replace(/\s/g, '')); return c ? new Date(+c[3], +c[2] - 1, +c[1]) : null;
    }
    function nivelDe(dias) { return dias < 0 ? 'vencido' : dias <= DIAS_URGENTE ? 'urgente' : dias <= DIAS_PRECAUCION ? 'precaucion' : 'ok'; }
    /** item: documento de Insumos. Devuelve { lotes, total, minimo, critico, criticoUtil, util, vencido, urgente, peor } */
    function analizar(item, hoy) {
        hoy = new Date((hoy || new Date()).getTime()); hoy.setHours(0, 0, 0, 0);
        const total = num(item.quantity !== undefined ? item.quantity : item.cantidad), lim = num(item.criticalLimit !== undefined ? item.criticalLimit : item.stock_minimo, 50);
        const bruto = Array.isArray(item.batches) && item.batches.length ? item.batches : [{ batch: item.batch, quantity: total, expirationDate: item.expirationDate }];
        const lotes = bruto.map(b => {
            const d = parseFecha(b.expirationDate), dias = d ? Math.ceil((d - hoy) / 86400000) : null;
            return { batch: b.batch || 'S/L', quantity: num(b.quantity), expirationDate: b.expirationDate || '', provider: b.provider || '', codigoLote: b.codigoLote || '', dias, nivel: dias === null ? 'sin_fecha' : nivelDe(dias) };
        }).filter(l => l.quantity > 0 || bruto.length === 1);
        const suma = (n) => lotes.filter(l => l.nivel === n).reduce((t, l) => t + l.quantity, 0);
        const vencido = suma('vencido'), urgente = suma('urgente'), util = Math.max(0, lotes.reduce((t, l) => t + l.quantity, 0) - vencido - urgente);
        const critico = total <= lim, criticoUtil = !critico && util <= lim && (vencido + urgente) > 0;
        const orden = ['vencido', 'urgente', 'precaucion'], peor = orden.find(n => lotes.some(l => l.nivel === n && l.quantity > 0)) || 'ok';
        return { lotes, total, minimo: lim, critico, criticoUtil, util, vencido, urgente, peor };
    }
    const etiqueta = (l) => l.nivel === 'vencido' ? `VENCIDO hace ${-l.dias} d` : l.nivel === 'urgente' ? `Vence en ${l.dias} d` : l.nivel === 'precaucion' ? `Vence en ${l.dias} d` : '';
    window.SAR_LotesAlertas = { analizar, etiqueta, parseFecha, DIAS_URGENTE, DIAS_PRECAUCION };
    if (typeof module !== 'undefined') module.exports = { analizar, etiqueta, parseFecha, DIAS_URGENTE, DIAS_PRECAUCION };
})(typeof window !== 'undefined' ? window : globalThis);
