/* Campana de avisos con protagonismo (v21.90): reúne lo que requiere acción — vencidos y por vencer,
   stock bajo el mínimo y préstamos por devolver — para sumarlo a las entregas y recepciones parciales. */
(function (window, document) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fechaVto = (v) => { if (!v || v === 'N/A') return null; const s = String(v); const d = new Date(s.length === 7 ? s + '-28T12:00:00' : s.length === 10 ? s + 'T12:00:00' : s); return isNaN(d) ? null : d; };

  /** Cálculo puro. insumos: [{name,quantity,expirationDate,criticalLimit,stock_minimo,location}], prestamos: [{insumoName,centro,cantidad,devuelto}]. */
  function calcular(insumos, prestamos, hoy) {
    const h = hoy || new Date(), vencidos = [], porVencer = [], bajoMin = [];
    (insumos || []).forEach(i => {
      const q = Number(i.quantity) || 0; if (q <= 0) return;
      const d = fechaVto(i.expirationDate);
      if (d) { const dias = Math.round((d - h) / 864e5); if (dias < 0) vencidos.push({ i, dias }); else if (dias <= 30) porVencer.push({ i, dias }); }
      const lim = Number(i.criticalLimit !== undefined && i.criticalLimit !== '' ? i.criticalLimit : i.stock_minimo) || 0;
      if (lim > 0 && q <= lim) bajoMin.push({ i, lim });
    });
    porVencer.sort((a, b) => a.dias - b.dias); bajoMin.sort((a, b) => (a.i.quantity / a.lim) - (b.i.quantity / b.lim));
    const pres = (prestamos || []).map(p => ({ p, falta: Math.max(0, (Number(p.cantidad) || 0) - (Number(p.devuelto) || 0)) })).filter(x => x.falta > 0);
    return { vencidos, porVencer, bajoMin, prestamos: pres, total: vencidos.length + porVencer.length + bajoMin.length + pres.length };
  }
  function datosActuales() {
    const pr = window.SAR_Prestamos && window.SAR_Prestamos.pendientesLista ? window.SAR_Prestamos.pendientesLista() : [];
    return calcular(window.insumosDataCache || [], pr, new Date());
  }
  function seccion(color, titulo, filas, ir, vista) {
    if (!filas.length) return '';
    return '<div class="noti-sec2"><div class="noti-h"><i style="background:' + color + '"></i><b>' + esc(titulo) + '</b><span>' + filas.length + '</span></div>' +
      filas.slice(0, 4).map(f => '<div class="noti-it">' + f + '</div>').join('') + (filas.length > 4 ? '<small class="noti-mas">y ' + (filas.length - 4) + ' más</small>' : '') +
      '<button type="button" class="noti-ver" data-ir="' + esc(vista) + '">' + esc(ir) + '</button></div>';
  }
  /** HTML de las secciones adicionales del panel. */
  function html(d) {
    return seccion('var(--sar-red)', 'Vencidos con stock', d.vencidos.map(x => '<b>' + esc(x.i.name) + '</b> <small>vencido hace ' + Math.abs(x.dias) + ' d · ' + esc(x.i.location || '') + ' · ' + (Number(x.i.quantity) || 0) + ' un.</small>'), 'Ver inventario', 'view-inventario') +
      seccion('var(--sar-orange)', 'Por vencer (30 días)', d.porVencer.map(x => '<b>' + esc(x.i.name) + '</b> <small>vence en ' + x.dias + ' d · ' + esc(x.i.location || '') + ' · ' + (Number(x.i.quantity) || 0) + ' un.</small>'), 'Ver inventario', 'view-inventario') +
      seccion('var(--sar-yellow)', 'Bajo el mínimo', d.bajoMin.map(x => '<b>' + esc(x.i.name) + '</b> <small>' + (Number(x.i.quantity) || 0) + ' un. (mínimo ' + x.lim + ')</small>'), 'Ver inventario', 'view-inventario') +
      seccion('var(--sar-blue)', 'Préstamos por devolver', d.prestamos.map(x => '<b>' + esc(x.p.insumoName) + '</b> <small>' + x.falta + ' un. a ' + esc(x.p.centro) + '</small>'), 'Ir a Ingresos', 'view-movimientos');
  }
  const api = { calcular, html, datosActuales, fechaVto };
  if (typeof window !== 'undefined') window.SAR_Avisos = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : {}, typeof document !== 'undefined' ? document : {});
