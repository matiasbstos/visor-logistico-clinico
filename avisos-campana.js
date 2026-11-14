/* Campana de avisos con protagonismo (v21.90): reúne lo que requiere acción — vencidos y por vencer,
   stock bajo el mínimo y préstamos por devolver — para sumarlo a las entregas y recepciones parciales. */
(function (window, document) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fechaVto = (v) => { if (!v || v === 'N/A') return null; const s = String(v); const d = new Date(s.length === 7 ? s + '-28T12:00:00' : s.length === 10 ? s + 'T12:00:00' : s); return isNaN(d) ? null : d; };

  /** Cálculo puro. insumos: [{name,quantity,expirationDate,criticalLimit,stock_minimo,location}], prestamos: [{insumoName,centro,cantidad,devuelto}]. */
  function calcular(insumos, prestamos, hoy, errores) {
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
    const errs = (errores || []).filter(e => e && e.mensaje);
    return { vencidos, porVencer, bajoMin, prestamos: pres, errores: errs, total: vencidos.length + porVencer.length + bajoMin.length + pres.length + errs.length };
  }
  function datosActuales() {
    const pr = window.SAR_Prestamos && window.SAR_Prestamos.pendientesLista ? window.SAR_Prestamos.pendientesLista() : [];
    const lim = Date.now() - 3 * 864e5, er = (window.SAR_ErroresRecientes || []).filter(e => { const t = Date.parse(e.ultimo || ''); return t && t >= lim; });
    return calcular(window.insumosDataCache || [], pr, new Date(), er);
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
      seccion('var(--sar-blue)', 'Préstamos por devolver', d.prestamos.map(x => '<b>' + esc(x.p.insumoName) + '</b> <small>' + x.falta + ' un. a ' + esc(x.p.centro) + '</small>'), 'Ir a Ingresos', 'view-movimientos') +
      seccion('var(--sar-red)', 'Errores del sistema (últimos 3 días)', (d.errores || []).map(x => '<b>' + esc(x.mensaje) + '</b> <small>' + esc(x.archivo || '') + (x.linea ? ':' + x.linea : '') + ' · ' + (x.veces || 1) + '× · ' + esc(x.ultimoUsuario || '') + '</small>'), 'Ver directorio de errores', 'view-errores');
  }
  // ---- v21.202: avisos separados en «Necesitan tu acción» y «Hecho automáticamente» (referencia MiseFlow) ----
  const leerLS = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const haceTxt = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
  /** Lo que necesita a una persona y no está en calcular(): solicitudes nuevas, operaciones sin conexión para revisar, fotos por confirmar. */
  function accionExtra() {
    const sols = window.SAR_SolicitudesNuevas || [], cola = window.SAR_Cola ? window.SAR_Cola.pendientes().filter(x => x.estado === 'error') : [], fp = Number(window.SAR_FotosPorConfirmar || 0), sf = Number(window.SAR_SinFoto || 0);
    return { sols, cola, fp, sf, total: sols.length + cola.length + (fp ? 1 : 0) + (sf ? 1 : 0) };
  }
  function htmlAccionExtra(x) {
    return seccion('var(--sar-red)', 'Solicitudes de insumos nuevas', x.sols.map(s => '<b>' + esc(s.correlativo || s.numero) + '</b> <small>' + esc(s.solicitante || '') + (s.servicio ? ' · ' + esc(s.servicio) : '') + ' · ' + (s.lineas || []).length + ' producto(s) · ' + esc(haceTxt(s.creadoEn)) + '</small>'), 'Ver solicitudes', 'view-solicitudes-insumos') +
      seccion('var(--sar-orange)', 'Hecho sin conexión: para revisar', x.cola.map(o => '<b>' + esc(o.titulo) + '</b> <small>' + esc(o.error || '') + '</small>'), 'Ver detalle', '#cola') +
      (x.fp ? seccion('var(--sar-yellow)', 'Fotos por confirmar', ['<b>' + x.fp + ' foto(s)</b> <small>halladas automáticamente: confírmalas o descártalas en la ficha de cada producto</small>'], 'Ir al catálogo', '#catalogo') : '') +
      (x.sf ? seccion('var(--sar-orange)', 'Productos sin fotografía', ['<b>' + x.sf + ' producto(s)</b> <small>a los que la búsqueda automática aún no les encuentra la foto de la caja o del producto: búscala a mano o sácale foto</small>'], 'Ver productos sin fotografía', '#sinfoto') : '');
  }
  /** Lo que el sistema ya hizo solo (informativo). */
  function automatico() {
    const out = [], sy = (() => { try { return localStorage.getItem('sar-sync-ult'); } catch (e) { return null; } })(), fo = leerLS('sar-fotos-ult'), co = leerLS('sar-cola-ult');
    if (sy) out.push({ ico: 'ph-cloud-check', t: 'Datos sincronizados', s: 'Inventario, solicitudes, actas y catálogo guardados en este equipo · ' + haceTxt(sy) });
    if (fo) out.push({ ico: 'ph-images', t: `Búsqueda de fotos: ${fo.enc} hallada(s) de ${fo.tot}`, s: (fo.enc ? 'Quedaron visibles con «?» hasta que las confirmes · ' : '') + haceTxt(fo.en) });
    if (co && co.ok) out.push({ ico: 'ph-arrows-clockwise', t: `${co.ok} operación(es) hechas sin conexión aplicadas`, s: haceTxt(co.en) });
    return out;
  }
  function htmlAutomatico(l) { return l.length ? l.map(x => `<div class="noti-auto"><i class="ph-bold ${x.ico}"></i><div><b>${esc(x.t)}</b><small>${esc(x.s)}</small></div></div>`).join('') : '<p class="act-hint">Aún no hay tareas automáticas registradas en este equipo.</p>'; }
  const api = { calcular, html, datosActuales, fechaVto, accionExtra, htmlAccionExtra, automatico, htmlAutomatico };
  if (typeof window !== 'undefined') window.SAR_AvisosCampana = api;   // no usar SAR_Avisos: ese nombre es del módulo de correo (avisos-correo.js)
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : {}, typeof document !== 'undefined' ? document : {});
