/* ==========================================================================
   OXÍGENO · CICLOS DE VIDA DE CADA BALÓN (v21.146)
   Un balón va y viene: llega al SAR (alta, recarga recibida, devolución), está, y se va (entrega/préstamo
   a un centro, envío a recarga, fuera de servicio). Eso es UN ciclo. Cuando vuelve empieza el ciclo siguiente.
   - Seguimiento al buscar por N° de serie o por correlativo de acta (AE-AAAA-NNNN), como el de las compras.
   - Auditoría: el disponible (balones por estado) y el libro contable (todos los movimientos, por ciclo).
   Lee Equipos_Oxigeno/<id>/Eventos y Actas_Entrega (tipo OXIGENO). No escribe nada.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SEDE = 'SAR', ADENTRO = ['LLENO', 'VACIO'];
  const TXT = { ALTA: 'Alta del balón', ENVIO_RECARGA: 'Enviado a recarga', RECARGA_OK: 'Recarga recibida (lleno)', MARCAR_VACIO: 'Marcado vacío', DEVOLUCION: 'Devuelto al SAR', INCIDENCIA: 'Incidencia', FUERA_SERVICIO: 'Fuera de servicio', CAPACIDAD: 'Cambio de capacidad', TIPO_GAS: 'Cambio de gas', REPUESTO: 'Vuelve a servicio', EDICION_DATOS: 'Datos corregidos', ENTREGA_ACTA: 'Entregado con acta', PRESTAMO: 'Préstamo a centro', PRESTAMO_RESPALDO: 'Acta firmada subida', EDICION_ACTA: 'Acta modificada' };
  const ESTADO_TXT = { LLENO: 'Lleno', VACIO: 'Vacío', EN_RECARGA: 'En recarga', PRESTADO: 'Entregado a centro', FUERA_SERVICIO: 'Fuera de servicio' };
  const fCL = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s || ''); };
  const t = (v) => { const c = v && v.creadoEn; return c && c.toMillis ? c.toMillis() : (v && v.fecha ? Date.parse(v.fecha + 'T12:00:00') || 0 : 0); };
  const actaDe = (v) => { const m = /AE-\d{4}-\d{4}/.exec(`${v.documento || ''} ${v.detalle || ''}`); return m ? m[0] : ''; };

  /** Puro: eventos de un balón → ciclos. Cada ciclo: {n, desde, hasta, abierto, dias, destino, actas[], eventos[], fuera[]} */
  function ciclos(eventos) {
    const evs = (eventos || []).slice().sort((a, b) => t(a) - t(b));
    const out = []; let cur = null, dentro = false, huerfanos = [];
    evs.forEach(v => {
      const nuevo = v.estadoNuevo || '';
      const aDentro = v.ubicacion ? v.ubicacion === SEDE : (nuevo ? ADENTRO.includes(nuevo) : dentro);
      if (!dentro && aDentro) { cur = { n: out.length + 1, desde: v.fecha || '', hasta: '', abierto: true, destino: '', actas: [], eventos: [v], fuera: [], retorno: v.tipo }; out.push(cur); dentro = true; }
      else if (dentro && !aDentro) { cur.eventos.push(v); cur.hasta = v.fecha || ''; cur.abierto = false; cur.destino = v.ubicacion || ESTADO_TXT[nuevo] || ''; dentro = false; }
      else if (dentro) cur.eventos.push(v);
      else if (out.length) out[out.length - 1].fuera.push(v); else huerfanos.push(v);
      if (cur && actaDe(v) && !cur.actas.includes(actaDe(v))) cur.actas.push(actaDe(v));
      if (!dentro && out.length && actaDe(v)) { const u = out[out.length - 1]; if (!u.actas.includes(actaDe(v))) u.actas.push(actaDe(v)); }
    });
    out.forEach(c => { const a = Date.parse((c.desde || '') + 'T12:00:00'), b = c.abierto ? Date.now() : Date.parse((c.hasta || '') + 'T12:00:00'); c.dias = isFinite(a) && isFinite(b) ? Math.max(0, Math.round((b - a) / 86400000)) : 0; });
    return { ciclos: out, huerfanos };
  }
  const nombreMov = (v) => TXT[v.tipo] || v.tipo || 'Movimiento';

  async function eventosDe(id) {
    const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Equipos_Oxigeno', id, 'Eventos'), f.orderBy('creadoEn', 'asc'), f.limit(500)));
    const l = []; sn.forEach(d => l.push(d.data())); return l;
  }
  const liHTML = (v) => `<li><b>${esc(fCL(v.fecha))}</b> · ${esc(nombreMov(v))}${v.detalle ? ' — ' + esc(v.detalle) : ''}${v.proveedor ? ' · ' + esc(v.proveedor) : ''} <small>(${esc(v.usuario || '')})</small></li>`;

  /** HTML del seguimiento de un balón. */
  function balonHTML(e, evs) {
    const r = ciclos(evs), st = ESTADO_TXT[e.estado] || e.estado, actual = r.ciclos[r.ciclos.length - 1];
    const cab = actual ? (actual.abierto ? `Ciclo ${actual.n} en curso: está en el SAR desde ${fCL(actual.desde)} (${actual.dias} día${actual.dias === 1 ? '' : 's'})` : `Ciclo ${actual.n} cerrado: salió el ${fCL(actual.hasta)} a ${actual.destino || 'otro lugar'}. Cuando vuelva empieza el ciclo ${actual.n + 1}`) : 'Sin ciclos registrados';
    return `<div class="oc-balon"><div class="oc-cab"><strong>N° ${esc(e.serie)}</strong> <span class="act-chip">${esc(st)}</span><small>${esc(e.ubicacion || '')}${e.ultimaEntregaActa ? ' · acta ' + esc(e.ultimaEntregaActa) : ''} · ${Number(e.recargas) || 0} recarga(s)</small></div>
      <p class="oc-res">${esc(cab)}. Ciclos totales: <b>${r.ciclos.length}</b>.</p>
      ${r.ciclos.slice().reverse().map(c => `<div class="oc-ciclo${c.abierto ? ' oc-on' : ''}"><h5>Ciclo ${c.n} <small>${esc(fCL(c.desde))} → ${c.abierto ? 'en el SAR' : esc(fCL(c.hasta))} · ${c.dias} día${c.dias === 1 ? '' : 's'}${c.destino ? ' · salió a ' + esc(c.destino) : ''}${c.actas.length ? ' · ' + esc(c.actas.join(', ')) : ''}</small></h5>
        <ul>${c.eventos.concat(c.fuera).sort((a, b) => t(a) - t(b)).map(liHTML).join('')}</ul></div>`).join('')}
      ${r.huerfanos.length ? `<div class="oc-ciclo"><h5>Antes del primer ciclo</h5><ul>${r.huerfanos.map(liHTML).join('')}</ul></div>` : ''}</div>`;
  }

  /** Seguimiento por búsqueda: serie o correlativo de acta. Devuelve HTML ('' si no aplica). */
  async function seguimiento(q, equipos) {
    q = String(q || '').trim(); if (q.length < 3) return '';
    const ql = q.toLowerCase(); let ids = [], acta = null;
    if (/^ae-\d{4}-\d{1,4}$/i.test(q)) {
      const f = fs(), num = q.toUpperCase().replace(/^AE-(\d{4})-(\d+)$/, (m, a, b) => `AE-${a}-${b.padStart(4, '0')}`);
      try { const d = await f.getDoc(f.doc(f.collection(db(), 'Actas_Entrega'), num)); if (d.exists()) { acta = { ...d.data(), numero: d.id }; ids = (acta.items || []).map(i => i.id).filter(Boolean); } } catch (e) { /* sin permiso */ }
      if (!ids.length) ids = equipos.filter(e => String(e.ultimaEntregaActa || '').toUpperCase() === num).map(e => e.id);
    } else ids = equipos.filter(e => String(e.serie || '').toLowerCase() === ql || (ql.length >= 4 && String(e.serie || '').toLowerCase().includes(ql))).map(e => e.id);
    const lista = ids.map(id => equipos.find(e => e.id === id)).filter(Boolean).slice(0, 6); if (!lista.length) return '';
    const bloques = []; for (const e of lista) { try { bloques.push(balonHTML(e, await eventosDe(e.id))); } catch (x) { bloques.push(`<p class="act-hint">No se pudo leer el historial del balón ${esc(e.serie)}: ${esc(x.message || x)}</p>`); } }
    const ca = acta ? `<p class="oc-acta"><b>Acta ${esc(acta.numero)}</b> · ${esc(acta.centro || '')} · ${esc(fCL(acta.fecha))} · ${acta.respaldo ? 'firmada (' + esc(acta.respaldo.nombre || '') + ')' : 'sin acta firmada'}${acta.estado === 'ANULADA' ? ' · ANULADA' : ''}</p>` : '';
    return `<section class="oc-seg" aria-label="Seguimiento del balón"><h4>Seguimiento · ${esc(q)}</h4>${ca}${bloques.join('')}</section>`;
  }

  // ---------------- Auditoría ----------------
  async function libro(equipos) {
    const filas = [];
    for (const e of equipos) {
      let evs = []; try { evs = await eventosDe(e.id); } catch (x) { continue; }
      const r = ciclos(evs), mapa = new Map(); r.ciclos.forEach(c => c.eventos.concat(c.fuera).forEach(v => mapa.set(v, c.n)));
      evs.forEach(v => filas.push({ ms: t(v), fecha: v.fecha || '', serie: e.serie, ciclo: mapa.get(v) || 0, mov: nombreMov(v), detalle: v.detalle || '', acta: actaDe(v), de: ESTADO_TXT[v.estadoAnterior] || v.estadoAnterior || '', a: ESTADO_TXT[v.estadoNuevo] || v.estadoNuevo || '', lugar: v.ubicacion || '', usuario: v.usuario || '' }));
    }
    return filas.sort((a, b) => b.ms - a.ms);
  }
  const csvTxt = (filas) => { const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; const cab = ['Fecha', 'N° serie', 'Ciclo', 'Movimiento', 'Detalle', 'Acta', 'Estado anterior', 'Estado nuevo', 'Lugar', 'Usuario']; return '﻿' + [cab].concat(filas.map(x => [fCL(x.fecha), x.serie, x.ciclo || '', x.mov, x.detalle, x.acta, x.de, x.a, x.lugar, x.usuario])).map(r => r.map(q).join(';')).join('\r\n'); };
  async function equiposTodos() { const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Equipos_Oxigeno'), f.limit(500))), l = []; sn.forEach(d => l.push({ id: d.id, ...d.data() })); return l.sort((a, b) => String(a.serie).localeCompare(String(b.serie), 'es', { numeric: true })); }

  async function pintarDisponible(el) {
    if (!el) return;
    try {
      const eq = await equiposTodos(), c = {}; eq.forEach(e => { c[e.estado] = (c[e.estado] || 0) + 1; });
      el.innerHTML = `<div class="oc-aud"><h4>Oxígeno portátil · disponible</h4><div class="sal-res"><div><b>${c.LLENO || 0}</b><span>llenos disponibles en el SAR</span></div><div><b>${c.VACIO || 0}</b><span>vacíos en el SAR</span></div><div><b>${c.EN_RECARGA || 0}</b><span>en recarga</span></div><div><b>${c.PRESTADO || 0}</b><span>entregados a centros</span></div><div><b>${c.FUERA_SERVICIO || 0}</b><span>fuera de servicio</span></div></div></div>`;
    } catch (e) { el.innerHTML = ''; }
  }
  async function pintarContable(el) {
    if (!el) return;
    el.innerHTML = '<div class="oc-aud"><h4>Oxígeno portátil · libro por ciclos</h4><p class="act-hint">Cargando movimientos…</p></div>';
    try {
      const eq = await equiposTodos(), filas = await libro(eq);
      el.innerHTML = `<div class="oc-aud"><h4>Oxígeno portátil · libro por ciclos</h4><p class="act-hint">Cada movimiento de cada balón, con el ciclo al que pertenece (llega al SAR → está → se va; si vuelve, ciclo nuevo).</p>
        <div class="sal-barra"><button type="button" class="btn btn-outline" id="oc-csv"><i class="ph ph-download-simple"></i> Libro de oxígeno (Excel)</button></div>
        ${filas.length ? `<div class="sal-tabla">${filas.slice(0, 300).map(x => `<div class="oc-fila"><b>${esc(fCL(x.fecha))}</b><span>N° ${esc(x.serie)}${x.ciclo ? ' · ciclo ' + x.ciclo : ''}</span><span>${esc(x.mov)}${x.detalle ? ' — ' + esc(x.detalle) : ''}</span><small>${esc(x.acta)}${x.usuario ? ' · ' + esc(x.usuario) : ''}</small></div>`).join('')}</div>` : '<p class="act-hint">Sin movimientos de oxígeno.</p>'}</div>`;
      const b = el.querySelector('#oc-csv'); if (b) b.addEventListener('click', () => { const u = URL.createObjectURL(new Blob([csvTxt(filas)], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a'); a.href = u; a.download = 'libro-oxigeno.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 20000); });
    } catch (e) { el.innerHTML = `<div class="oc-aud"><p class="act-hint">No se pudo leer el oxígeno: ${esc(e.message || e)}</p></div>`; }
  }

  window.SAR_OxiCiclos = { ciclos, seguimiento, balonHTML, pintarDisponible, pintarContable, libro, csvTxt };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SAR_OxiCiclos;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : null);
