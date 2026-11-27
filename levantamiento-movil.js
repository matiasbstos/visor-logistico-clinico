/* ==========================================================================
   LEVANTAMIENTO CON TELÉFONO · tags «CONTADO» + captura por caja (v21.249) — DECISIONES 4.305
   Página «Pedir insumos» → «Levantamiento (contar cajas)», o directo con solicitar.html#tag=<folio>.
   · Es un LEVANTAMIENTO (apertura de saldos), no una toma ni un ingreso: el teléfono NUNCA toca el stock.
     Solo registra cuánto hay en cada caja, en Conteos_Cajas/<folio> (id = folio BUL del tag preimpreso).
   · Con usuario (correo y clave): rol contador, operador, admin o superadmin.
   · Pantallas: P0 inicio del turno · P1 ¿qué producto? · P2 producto + lote · P3 la caja (árbol de preguntas)
     · P4 confirmar · P5 guardado · resumen del turno · tag ya usado.
   · Sin internet: borrador y lista de cajas en localStorage; cada caja con setDoc (id fijo: reintentar no duplica);
     «4 s y luego a la cola» como inventario-movil.js. Un error de permisos queda «para revisar», no se reintenta solo.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const VERSION = '21.249', COL = 'Conteos_Cajas', TOPE = 1000000;
  const ROLES = ['contador', 'operador', 'admin', 'superadmin', 'administrador', 'global'];
  const TIPOS = [['medico', 'Médico'], ['aseo', 'Aseo'], ['oficina', 'Oficina'], ['medicamento', 'Medicamento']];
  const K_BOD = 'lev-bodega', K_BOR = 'lev-borrador-v1', K_CAJ = 'lev-cajas-v1', K_ULT = 'lev-ultimo', K_INS = 'lev-insumos-v1', K_BODS = 'lev-bodegas-v1', K_TAGS = 'lev-tags-v1';
  const URL_QR = 'https://unpkg.com/html5-qrcode@2.3.8';   /* misma versión que index.html (DECISIONES 4.305: copia local pendiente) */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const ent = (v) => Math.max(0, Math.floor(num(v)));
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } } };
  const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
  const vib = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms || 60); } catch (e) { /* sin vibración */ } };
  const numTag = (folio) => String(folio || '').slice(-6);
  const hora = (iso) => { try { return new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  const mesCL = (v) => { const m = /^(\d{4})-(\d{2})$/.exec(v || ''); return m ? `${m[2]}/${m[1]}` : 'sin vencimiento'; };
  const elabCL = (v) => {
    const s = String(v || '');
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    m = /^(\d{4})-(\d{2})$/.exec(s);
    if (m) return `${m[2]}/${m[1]}`;
    return '';
  };
  const RE_ELAB = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

  // ---------------- lógica pura ----------------
  /** Total en UNIDADES de una caja: suma de las cajas interiores (cerradas y abiertas) + sueltas. */
  function totalEstructura(e) { if (!e) return 0; return (Array.isArray(e.interiores) ? e.interiores : []).reduce((t, x) => t + ent(x && x.q), 0) + ent(e.sueltas); }
  /** Fórmula para confirmar: «9 × 50 cerradas = 450 · + 1 abierta = 30 · 480 UNIDADES (10 cajas chicas, no 480 cajas)». */
  function formula(e) {
    const ints = (e && Array.isArray(e.interiores) ? e.interiores : []), cerr = ints.filter(x => !x.abierta), ab = ints.filter(x => x.abierta), sue = ent(e && e.sueltas), total = totalEstructura(e), partes = [];
    const grupos = new Map(); cerr.forEach(x => grupos.set(ent(x.q), (grupos.get(ent(x.q)) || 0) + 1));
    const pal = e && e.estado === 'CERRADA' ? ['interior', 'interiores'] : ['cerrada', 'cerradas'];
    grupos.forEach((n, q) => partes.push(`${n} × ${q} ${n === 1 ? pal[0] : pal[1]} = ${n * q}`));
    if (ab.length) { const s = ab.reduce((t, x) => t + ent(x.q), 0); partes.push(`+ ${ab.length} abierta${ab.length === 1 ? '' : 's'}${ab.length > 1 ? ' (' + ab.map(x => ent(x.q)).join(' + ') + ')' : ''} = ${s}`); }
    if (sue || !ints.length) partes.push(ints.length ? `+ ${sue} suelta${sue === 1 ? '' : 's'} = ${sue}` : (e && e.estado === 'CERRADA' ? `Caja cerrada sin cajas interiores = ${sue}` : `Unidades sueltas = ${sue}`));
    const nota = ints.length ? `(${ints.length} caja${ints.length === 1 ? '' : 's'} chica${ints.length === 1 ? '' : 's'}, no ${total} cajas)` : '';
    return { partes, total, nota, texto: partes.join(' · ') + ` · ${total} UNIDADES` + (nota ? ' ' + nota : '') };
  }
  /** Estructura corta para la tabla del PC y el tag: «9×50 + 1 abierta (30)». */
  function estructuraCorta(e) {
    const ints = (e && Array.isArray(e.interiores) ? e.interiores : []), sue = ent(e && e.sueltas);
    if (!ints.length) return e && e.estado === 'ABIERTA' ? `Granel (${sue})` : `Sin subdivisión (${sue})`;
    const g = new Map(); ints.filter(x => !x.abierta).forEach(x => g.set(ent(x.q), (g.get(ent(x.q)) || 0) + 1));
    const ab = ints.filter(x => x.abierta), p = [...g].map(([q, n]) => `${n}×${q}`);
    if (ab.length) p.push(`${ab.length} abierta${ab.length === 1 ? '' : 's'} (${ab.map(x => ent(x.q)).join(' + ')})`);
    if (sue) p.push(`${sue} sueltas`);
    return p.join(' + ');
  }
  /** Lo que se lee o escribe → folio BUL: URL con #t=<10 dígitos> (o #tag= antiguo), «BUL-2026-000845», 10 dígitos de la pistola o el N° corto (año en curso).
   *  Una etiqueta de caja (#bulto=) no es un tag. */
  function folioTag(leido, anio) {
    const t = String(leido || '').trim(); if (/#bulto=/i.test(t)) return ''; let m = /BUL-?(\d{4})-?(\d{6})/i.exec(t); if (m) return `BUL-${m[1]}-${m[2]}`;
    const d = t.replace(/\D/g, ''); if (/^\d{10}$/.test(d)) return `BUL-${d.slice(0, 4)}-${d.slice(4)}`;
    if (/^\d{1,6}$/.test(d) && Number(d) > 0 && d === t.replace(/^N°?\s*/i, '')) return `BUL-${anio || new Date().getFullYear()}-${d.padStart(6, '0')}`;
    return '';
  }
  /** ¿Vencido? (AAAA-MM; el mes en curso todavía no se da por vencido). */
  function vencido(vence, hoy) { if (!/^\d{4}-\d{2}$/.test(vence || '')) return false; const h = hoy || new Date(); return vence < `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`; }
  /** Valida el documento antes de guardar (las reglas repiten lo esencial). Devuelve la lista de errores. */
  function validar(d) {
    const e = [], x = d || {}, s = x.estructura || {};
    if (!/^BUL-\d{4}-\d{6}$/.test(x.folio || '')) e.push('El número del tag no es válido.');
    if (!x.bodega || String(x.bodega).length > 120) e.push('Falta la bodega.');
    if (!String(x.nombre || '').trim() || String(x.nombre).length > 120) e.push('Falta el producto (máximo 120 letras).');
    if (x.nuevo && !TIPOS.some(t => t[0] === x.tipo)) e.push('Elige el tipo del producto nuevo.');
    if (typeof x.lote !== 'string' || !x.lote.trim() || x.lote.length > 60) e.push('Falta el lote (o «No trae lote»).');
    if (x.elaboracion != null && x.elaboracion !== '' && !RE_ELAB.test(String(x.elaboracion))) e.push('La fecha de elaboración no es válida.');
    if (!(x.vence === 'N/A' || (/^\d{4}-(0[1-9]|1[0-2])$/.test(x.vence || '')))) e.push('El vencimiento debe ser mes y año.');
    if (!['CERRADA', 'ABIERTA'].includes(s.estado)) e.push('Falta decir si la caja está cerrada o abierta.');
    const ints = Array.isArray(s.interiores) ? s.interiores : null;
    if (!ints || ints.length > 200) e.push('Las cajas interiores no son válidas (máximo 200).');
    else if (ints.some(i => !i || !Number.isInteger(i.q) || i.q < 0 || i.q > TOPE || typeof i.abierta !== 'boolean')) e.push('Una caja interior tiene una cantidad no válida.');
    if (!Number.isInteger(s.sueltas) || s.sueltas < 0 || s.sueltas > TOPE) e.push('Las unidades sueltas no son válidas.');
    if (!Number.isInteger(x.total) || x.total < 1 || x.total > TOPE) e.push('El total debe ser entre 1 y 1.000.000 unidades.');
    else if (x.total !== totalEstructura(s)) e.push('El total no calza con la caja.');
    if (!x.contadoPor) e.push('Falta la sesión de quien cuenta.');
    return e;
  }
  /** Avance por lote (producto que ya está en el sistema): «Sistema S · contado C · faltan/sobran D», ordenado por vencimiento. */
  function avanceLotes(sistema, contados) {
    const T = window.SAR_Toma; if (!T) return [];
    return T.conciliar(sistema, contados, { completa: false }).lineas.map(l => { const c = l.contado == null ? 0 : l.contado; return { batch: l.batch, vence: l.vence, sistema: l.sistema, contado: c, delta: c - l.sistema }; })
      .sort((a, b) => (a.vence === 'N/A' ? 1 : 0) - (b.vence === 'N/A' ? 1 : 0) || String(a.vence).localeCompare(String(b.vence)) || String(a.batch).localeCompare(String(b.batch)));
  }
  /** Árbol de preguntas de la caja (P3). p = respuestas; devuelve el paso siguiente o 'fin'. */
  function siguientePaso(p) {
    switch (p.paso) {
      case 'estado': return p.estado === 'CERRADA' ? 'cerr-int' : 'ab-que';
      case 'cerr-int': return p.int ? 'cerr-n' : 'cerr-total';
      case 'cerr-total': return 'fin';
      case 'cerr-n': return 'cerr-q';
      case 'cerr-q': return 'fin';
      case 'ab-que': return p.que === 'chicas' ? 'ch-n' : 'su-n';
      case 'ch-n': return ent(p.chN) > 0 ? 'ch-q' : 'ch-ab';
      case 'ch-q': return 'ch-ab';
      case 'ch-ab': return p.ab ? 'ch-nab' : 'ch-sue';
      case 'ch-nab': return 'ch-abq';
      case 'ch-abq': return ent(p.i) + 1 < ent(p.nab) ? 'ch-abq' : 'ch-sue';
      case 'ch-sue': return 'fin';
      case 'su-n': return 'fin';
      default: return 'estado';
    }
  }
  /** Respuestas de P3 → estructura {estado, interiores:[{q, abierta}], sueltas}. */
  function estructuraDe(p) {
    if (p.estado === 'CERRADA') return p.int ? { estado: 'CERRADA', interiores: Array.from({ length: ent(p.n) }, () => ({ q: ent(p.q), abierta: false })), sueltas: 0 } : { estado: 'CERRADA', interiores: [], sueltas: ent(p.total) };
    if (p.que === 'chicas') return { estado: 'ABIERTA', interiores: Array.from({ length: ent(p.chN) }, () => ({ q: ent(p.chQ), abierta: false })).concat(p.ab ? (p.abq || []).slice(0, ent(p.nab)).map(q => ({ q: ent(q), abierta: true })) : []), sueltas: ent(p.sue) };
    return { estado: 'ABIERTA', interiores: [], sueltas: ent(p.suN) };
  }
  /** Al corregir: estructura guardada → respuestas de P3 (para volver a recorrer el árbol con lo de antes). */
  function respuestasDe(e) {
    const ints = (e && e.interiores) || [], cerr = ints.filter(x => !x.abierta), ab = ints.filter(x => x.abierta);
    if (e && e.estado === 'CERRADA') return ints.length ? { paso: 'estado', estado: 'CERRADA', int: true, n: ints.length, q: ent(ints[0].q) } : { paso: 'estado', estado: 'CERRADA', int: false, total: ent(e.sueltas) };
    if (ints.length) return { paso: 'estado', estado: 'ABIERTA', que: 'chicas', chN: cerr.length, chQ: cerr.length ? ent(cerr[0].q) : 0, ab: ab.length > 0, nab: ab.length, abq: ab.map(x => ent(x.q)), sue: ent(e.sueltas) };
    return { paso: 'estado', estado: 'ABIERTA', que: 'sueltas', suN: ent(e && e.sueltas) };
  }
  /** Huella simple (djb2, hex) de bodega|bodegaId|nombreNorm|insumoId|lote|vence|total|JSON(estructura): el PC la usa para saber si la caja cambió (v21.276: también bodega y nombre). */
  function huella(d) {
    const x = d || {}, e = x.estructura || {}, txt = [x.bodega || '', x.bodegaId || '', x.nombreNorm || '', x.insumoId || '', x.lote || '', x.vence || '', ent(x.total), JSON.stringify({ estado: e.estado || '', interiores: (e.interiores || []).map(i => ({ q: ent(i.q), abierta: !!i.abierta })), sueltas: ent(e.sueltas) })].join('|');
    let h = 5381; for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(16).padStart(8, '0');
  }
  /** Lo que marcaba el sistema para ese lote (misma clave lote|mes que la toma). null si el lote no existía en la bodega. */
  function baseDe(reg, lote, vence) {
    const T = window.SAR_Toma; if (!reg || !T) return null; const k = T.clave(lote, vence), l = (Array.isArray(reg.batches) ? reg.batches : []).filter(b => T.clave(b.batch, b.expirationDate) === k);
    return l.length ? l.reduce((t, b) => t + num(b.quantity), 0) : null;
  }
  /** Lotes con stock de un registro de Insumos. */
  function lotesDe(i) { if (!i) return []; const l = Array.isArray(i.batches) && i.batches.length ? i.batches : [{ batch: i.batch, quantity: i.quantity, expirationDate: i.expirationDate }]; return l.filter(b => b && num(b.quantity) > 0).map(b => ({ batch: b.batch, quantity: num(b.quantity), expirationDate: b.expirationDate || '' })); }
  /** Documento Conteos_Cajas a partir del borrador (sin servidorEn, que se agrega al escribir). */
  function armarDoc(dr, u, sis) {
    const est = dr.estructura || { estado: 'CERRADA', interiores: [], sueltas: 0 }, s = sis || {};
    const elab = RE_ELAB.test(String(dr.elaboracion || '')) ? String(dr.elaboracion) : '';
    const d = { folio: dr.folio, bodega: dr.bodega && dr.bodega.name || '', bodegaId: dr.bodega && dr.bodega.id || '', insumoId: dr.prod && dr.prod.insumoId || null, nombre: String(dr.prod && dr.prod.nombre || '').trim(), nuevo: !!(dr.prod && dr.prod.nuevo), tipo: dr.prod && dr.prod.nuevo ? dr.prod.tipo || '' : null,
      controlado: dr.prod && dr.prod.controlado || null, lote: dr.sinLote ? 'S/L' : String(dr.lote || '').trim().toUpperCase(), vence: /^\d{4}-(0[1-9]|1[0-2])$/.test(dr.vence || '') ? dr.vence : 'N/A', sinLote: !!dr.sinLote,
      estructura: { estado: est.estado, interiores: (est.interiores || []).map(x => ({ q: ent(x.q), abierta: !!x.abierta })), sueltas: ent(est.sueltas) }, total: totalEstructura(est),
      contadoPor: u.correo || '', contadoNombre: u.nombre || '', en: new Date().toISOString(), estado: 'REGISTRADO', app: VERSION,
      baseSistema: s.base == null ? null : ent(s.base), baseSistemaEn: s.en || new Date().toISOString(), deudaSistema: ent(s.deuda), baseSL: s.sl == null ? null : ent(s.sl) };   /* 4.322: baseSL = S/L del producto en la bodega al contar (la bandeja lo reclasifica) */
    if (elab) d.elaboracion = elab;
    if (d.controlado) { delete d.baseSistema; delete d.deudaSistema; delete d.baseSL; }   /* Decker: en controlados no se guarda lo que marca el sistema */
    d.nombreNorm = norm(d.nombre).slice(0, 120); d.huella = huella(d); return d;
  }
  /** Al corregir: solo los campos que cambian (updateDoc). Nunca estado de bodega, autor ni folio. */
  const BORRAR = '__borrar__';   /* marca: el campo se elimina al corregir (controlados) */
  const EDITABLES = ['bodega', 'bodegaId', 'insumoId', 'nombre', 'nombreNorm', 'nuevo', 'tipo', 'controlado', 'lote', 'elaboracion', 'vence', 'sinLote', 'estructura', 'total', 'contadoNombre', 'baseSistema', 'baseSistemaEn', 'deudaSistema', 'baseSL', 'huella', 'app'];
  function cambiosDe(antes, d) { const c = {}; EDITABLES.forEach(k => { if (d[k] === undefined) { if (k === 'elaboracion' && antes && antes.elaboracion) c.elaboracion = BORRAR; return; } if (JSON.stringify(antes ? antes[k] : undefined) !== JSON.stringify(d[k])) c[k] = d[k]; }); if (d.controlado) { c.baseSistema = BORRAR; c.deudaSistema = BORRAR; c.baseSL = BORRAR; } c.estado = 'REGISTRADO'; c.editadoEn = new Date().toISOString(); return c; }
  /** Cajas del turno: las de este usuario en las últimas 12 horas (un turno de noche cruza la medianoche). */
  const TURNO_MS = 12 * 3600 * 1000;
  function delTurno(cajas, u, ahora) { const t0 = (ahora || Date.now()) - TURNO_MS; return (cajas || []).filter(c => c && c.doc && c.doc.contadoPor === u && new Date(c.doc.en).getTime() >= t0); }
  /** Resumen del turno: cajas, productos, lotes, nuevos, por enviar, enviadas y unidades por producto y lote. */
  function resumen(cajas) {
    const l = cajas || [], s = (f) => new Set(l.map(f).filter(Boolean)).size, sub = new Map();
    l.forEach(c => { const k = norm(c.doc.nombre) + '|' + c.doc.lote + '|' + c.doc.vence, e = sub.get(k) || { nombre: c.doc.nombre, lote: c.doc.lote, vence: c.doc.vence, cajas: 0, unidades: 0 }; e.cajas++; e.unidades += ent(c.doc.total); sub.set(k, e); });
    return { cajas: l.length, productos: s(c => norm(c.doc.nombre)), lotes: sub.size, nuevos: s(c => c.doc.nuevo ? norm(c.doc.nombre) : ''), porEnviar: l.filter(c => c.estado === 'pend').length, enviadas: l.filter(c => c.estado === 'ok').length, revisar: l.filter(c => c.estado === 'revisar').length, reconteo: l.filter(c => c.srv === 'RECONTEO').length,
      subtotales: [...sub.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || String(a.vence).localeCompare(String(b.vence))) };
  }

  // ---------------- estado ----------------
  let insumosAl = '', mostrar = false, busca = '', bodegas = null, insumos = null, cargandoIns = false, guardando = false, pendTag = '', nombreUsuario = '', otroLote = false, srv = new Map(), srvBod = '';
  const rol = () => String(window.SAR_Rol || '').toLowerCase();
  const usuario = () => (window.SAR_Sesion && window.SAR_Sesion.usuario && window.SAR_Sesion.usuario()) || '';
  const habil = () => ROLES.includes(rol());
  const fsx = () => window.firebaseFirestore, dbx = () => window.firebaseDb;
  const bor = () => ls.get(K_BOR) || { vista: 'p0' };
  const setBor = (d) => ls.set(K_BOR, d);
  const cajas = () => { const c = ls.get(K_CAJ); return Array.isArray(c) ? c : []; };
  const setCajas = (c) => { if (!ls.set(K_CAJ, c.slice(-800))) toast('Teléfono sin espacio', 'No se pudo guardar la lista de cajas en el teléfono.', 'error'); };
  const bodega = () => ls.get(K_BOD);
  const repintar = () => { if (window.SAR_Solicitudes && window.SAR_Solicitudes.repintar) window.SAR_Solicitudes.repintar(); else { const r = document.getElementById('si-pide'); if (r) pintar(r); } };
  const conTiempo = (p, ms) => Promise.race([p, new Promise((_, x) => setTimeout(() => x(Object.assign(new Error('sin respuesta'), { code: 'timeout' })), ms))]);
  const esPermiso = (e) => /permission|insufficient/i.test(String((e && (e.code || e.message)) || ''));
  function enCurso() { return mostrar; }
  function abrir() { mostrar = true; repintar(); window.scrollTo && window.scrollTo(0, 0); }
  function ir(vista, cambios) { const d = { ...bor(), ...(cambios || {}), vista }; setBor(d); repintar(); window.scrollTo && window.scrollTo(0, 0); return d; }

  // ---------------- datos ----------------
  async function cargarBodegas() {
    if (bodegas) return bodegas; const f = fsx();
    try { const sn = await conTiempo(f.getDocs(f.collection(dbx(), 'Bodegas')), 8000), l = []; sn.forEach(x => { const b = x.data() || {}; if (!b.archivada && b.estado !== 'ARCHIVADA') l.push({ id: x.id, name: String(b.name || b.nombre || x.id) }); }); l.sort((a, b) => a.name.localeCompare(b.name, 'es')); bodegas = l; ls.set(K_BODS, l); }
    catch (e) { bodegas = ls.get(K_BODS) || []; }
    return bodegas;
  }
  const compacto = (id, i) => ({ id, name: String(i.name || ''), location: i.location || i.bodegaNombre || '', bodegaId: i.bodegaId || '', controlado: i.controlado || null, codigoMP: i.codigoMP || '', sobregiro: num(i.sobregiro), batches: lotesDe(i) });
  async function cargarInsumos(forzar) {
    if (insumos && !forzar) return insumos; if (cargandoIns) return insumos || []; cargandoIns = true; const f = fsx();
    try { const sn = await conTiempo(f.getDocs(f.query(f.collection(dbx(), 'Insumos'), f.limit(5000))), forzar ? 30000 : 12000), l = []; sn.forEach(x => l.push(compacto(x.id, x.data() || {}))); insumos = l; insumosAl = new Date().toISOString(); ls.set(K_INS, { al: insumosAl, l }); }
    catch (e) { const c = ls.get(K_INS); insumos = c && Array.isArray(c.l) ? c.l : (insumos || []); if (c && c.al) insumosAl = c.al; if (forzar) { cargandoIns = false; throw e; } }
    cargandoIns = false; return insumos;
  }
  /** Conteos ya registrados en esta bodega (del servidor o de la copia local de Firestore): para la franja de avance. */
  async function cargarConteos(b) {
    if (!b) return; const f = fsx();
    try { const sn = await conTiempo(f.getDocs(f.query(f.collection(dbx(), COL), f.where('bodega', '==', b.name), f.limit(3000))), 8000), m = new Map(); sn.forEach(x => m.set(x.id, x.data())); srv = m; srvBod = b.name; } catch (e) { /* sin internet ni copia: solo lo del teléfono */ }
  }
  /** Folios de tags «CONTADO» reservados (para validar un tag sin internet, incluyendo su bodega preasignada). */
  async function cargarTags() {
    const f = fsx(), sn = await conTiempo(f.getDocs(f.query(f.collection(dbx(), 'Contadores'), f.where('tipo', '==', 'tag-conteo'), f.limit(5000))), 15000), l = [], meta = {};
    sn.forEach(x => { const d = x.data() || {}; if (d.folio) { l.push(d.folio); if (d.bodega || d.bodegaId) meta[d.folio] = { bodega: d.bodega || '', bodegaId: d.bodegaId || '' }; } });
    ls.set(K_TAGS, { al: new Date().toISOString(), l, meta }); return l;
  }
  /** ¿Qué es este folio? { tipo: 'tag'|'caja'|'otro'|'no'|'?', bodega, bodegaId }. */
  async function infoFolio(fo) {
    const f = fsx();
    try {
      const sn = await conTiempo(f.getDoc(f.doc(f.collection(dbx(), 'Contadores'), 'bulto-' + fo)), 2500);
      if (!sn.exists()) return { tipo: 'no' };
      const d = sn.data() || {}, t = d.tipo;
      return { tipo: t === 'tag-conteo' ? 'tag' : t === 'bulto' ? 'caja' : 'otro', bodega: d.bodega || '', bodegaId: d.bodegaId || '' };
    } catch (e) {
      const c = ls.get(K_TAGS);
      if (c && Array.isArray(c.l)) {
        const m = (c.meta && c.meta[fo]) || {};
        return { tipo: c.l.includes(fo) ? 'tag' : 'no', bodega: m.bodega || '', bodegaId: m.bodegaId || '' };
      }
      return { tipo: '?' };
    }
  }
  const esDeBodega = (i, b) => !!b && ((i.bodegaId && i.bodegaId === b.id) || norm(i.location) === norm(b.name));
  /** Cajas ya contadas en esta bodega (servidor + teléfono, sin repetir folio ni cajas rechazadas). */
  function cajasContadasBodega(b) {
    const m = new Map();
    if (srvBod === (b && b.name)) srv.forEach((d, fo) => { if (d && d.estado !== 'RECHAZADO') m.set(fo, d); });
    cajas().forEach(c => { if (c && c.doc && c.doc.bodega === (b && b.name) && c.srv !== 'RECHAZADO' && c.doc.estado !== 'RECHAZADO') m.set(c.folio, c.doc); });
    return [...m.values()];
  }
  /** Productos sin repetir (por nombre): incluye Insumos Y productos ya contados en esta bodega (evita duplicados al digitar). */
  function catalogo(b) {
    const m = new Map();
    (insumos || []).forEach(i => { const k = norm(i.name); if (!k) return; const e = m.get(k) || { k, nombre: i.name, enBodega: null, otro: null, controlado: null, codigoMP: '', contadoAqui: 0, nuevoContado: false, tipo: null }; if (esDeBodega(i, b)) e.enBodega = i; else if (!e.otro) e.otro = i; if (i.controlado) e.controlado = i.controlado; if (!e.codigoMP && i.codigoMP) e.codigoMP = i.codigoMP; m.set(k, e); });
    cajasContadasBodega(b).forEach(d => {
      const k = norm(d.nombre); if (!k) return;
      const e = m.get(k) || { k, nombre: d.nombre, enBodega: null, otro: null, controlado: d.controlado || null, codigoMP: '', contadoAqui: 0, nuevoContado: !!d.nuevo, tipo: d.tipo || null };
      e.contadoAqui += ent(d.total);
      if (d.controlado && !e.controlado) e.controlado = d.controlado;
      if (d.tipo && !e.tipo) e.tipo = d.tipo;
      m.set(k, e);
    });
    return [...m.values()];
  }
  function buscar(lista, q) {
    const w = norm(q).split(' ').filter(Boolean); const l = w.length ? lista.filter(p => w.every(x => norm(p.nombre).includes(x))) : lista.filter(p => p.enBodega || p.contadoAqui > 0);
    return l.sort((a, b) => ((b.enBodega || b.contadoAqui > 0) ? 1 : 0) - ((a.enBodega || a.contadoAqui > 0) ? 1 : 0) || (w.length ? (norm(b.nombre).startsWith(w[0]) ? 1 : 0) - (norm(a.nombre).startsWith(w[0]) ? 1 : 0) : 0) || a.nombre.localeCompare(b.nombre, 'es')).slice(0, 40);
  }
  /** Lo contado de un producto en la bodega: cajas del teléfono + las del servidor/copia (sin repetir folio). extra = la caja que se está confirmando. */
  function contadosDe(nombre, insumoId, b, extra) {
    const m = new Map(); if (srvBod === (b && b.name)) srv.forEach((d, fo) => { if (d && d.estado !== 'RECHAZADO') m.set(fo, d); }); cajas().forEach(c => { if (c && c.doc && c.srv !== 'RECHAZADO' && c.doc.estado !== 'RECHAZADO') m.set(c.folio, c.doc); }); if (extra) m.set(extra.folio, extra);
    return [...m.values()].filter(d => d && d.bodega === (b && b.name) && ((insumoId && d.insumoId === insumoId) || norm(d.nombre) === norm(nombre))).map(d => ({ batch: d.lote, expirationDate: d.vence, elaboracion: d.elaboracion || '', quantity: num(d.total) }));
  }
  /** Lotes visibles en P2 para elegir o sumar: une los del sistema con los ya contados en esta bodega. */
  function lotesCombinados(reg, nombre, insumoId, b) {
    const T = window.SAR_Toma;
    const mapa = new Map();
    const claveDe = (lote, mes) => (T ? T.clave(lote, mes) : `${String(lote || 'S/L').toUpperCase()}|${mes || 'N/A'}`);
    const normLote = (l) => (T ? T.lote(l) : String(l || 'S/L').trim().toUpperCase() || 'S/L');
    const normMes = (v) => (T ? T.mes(v) : (/^\d{4}-\d{2}$/.test(v || '') ? v : 'N/A'));
    if (reg) {
      lotesDe(reg).forEach(x => {
        const lote = normLote(x.batch), mes = normMes(x.expirationDate), k = claveDe(lote, mes);
        const e = mapa.get(k) || { lote, mes, sistema: 0, contado: 0, elaboracion: '' };
        e.sistema += num(x.quantity);
        mapa.set(k, e);
      });
    }
    contadosDe(nombre, insumoId, b, null).forEach(x => {
      const lote = normLote(x.batch), mes = normMes(x.expirationDate), k = claveDe(lote, mes);
      const e = mapa.get(k) || { lote, mes, sistema: 0, contado: 0, elaboracion: '' };
      e.contado += num(x.quantity);
      if (x.elaboracion && !e.elaboracion) e.elaboracion = x.elaboracion;
      mapa.set(k, e);
    });
    return [...mapa.values()].sort((a, z) => (a.mes === 'N/A' ? 1 : 0) - (z.mes === 'N/A' ? 1 : 0) || String(a.mes).localeCompare(String(z.mes)) || String(a.lote).localeCompare(String(z.lote)));
  }

  // ---------------- cámara (html5-qrcode desde unpkg, versión fija) ----------------
  let libQR = null;
  function cargarLibQR() {
    if (window.Html5Qrcode) return Promise.resolve(); if (libQR) return libQR;
    libQR = new Promise((ok, mal) => { const s = document.createElement('script'); s.src = URL_QR; s.onload = () => (window.Html5Qrcode ? ok() : mal(new Error('sin lector'))); s.onerror = () => { libQR = null; mal(new Error('No se pudo cargar el lector de la cámara.')); }; document.head.appendChild(s); });
    return libQR;
  }
  async function escanear() {
    const ov = document.createElement('div'); ov.className = 'lv-cam'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '<div class="lv-cam-c"><b>Apunta al QR del tag</b><div id="lv-cam-v" class="lv-cam-v"></div><p class="lv-s">También lee el código de barras.</p><button type="button" class="lv-btn lv-btn--sec" data-lv-camx>Cancelar</button></div>';
    document.body.appendChild(ov); let lector = null, listo = false;
    const fin = async (txt) => { if (listo) return; listo = true; try { if (lector) { await lector.stop(); lector.clear(); } } catch (e) { /* ya detenida */ } ov.remove(); if (txt) { const fo = folioTag(txt); if (fo) { vib(80); abrirTag(fo); } else toast('No es un tag', 'Lo leído no es un tag «CONTADO».', 'warning'); } };
    ov.querySelector('[data-lv-camx]').onclick = () => fin(null);
    try { await cargarLibQR(); if (listo) return; lector = new window.Html5Qrcode('lv-cam-v'); await lector.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.8, height: Math.min(w, h) * 0.6 }) }, (t) => { if (folioTag(t)) fin(t); }, () => {}); if (listo) { try { await lector.stop(); } catch (e) { /* nada */ } } }
    catch (e) { const v = ov.querySelector('#lv-cam-v'); if (v) v.innerHTML = '<p class="lv-s">No se pudo abrir la cámara (permiso, sin internet la primera vez o equipo sin cámara). Escribe el número del tag.</p>'; }
  }

  // ---------------- abrir un tag ----------------
  async function abrirTag(fo, alternativas) {
    pendTag = ''; try { localStorage.setItem('lev-ayuda-vista', '1'); } catch (e) { /* sin almacenamiento */ }   /* ya empezó a contar: el manual no vuelve a aparecer solo */
    const loc0 = cajas().find(c => c.folio === fo);
    let b = bodega();
    if (!loc0) {
      let info = await infoFolio(fo);
      /* N° corto: si no existe en el año en curso, se prueba con el año anterior */
      for (const alt of (alternativas || [])) { if (info.tipo !== 'no') break; const i2 = await infoFolio(alt); if (i2.tipo !== 'no') { fo = alt; info = i2; } }
      if (info.tipo === 'caja') { vib(200); toast('No es un tag', `N° ${esc(numTag(fo))}: esta es la etiqueta de una caja, no un tag «CONTADO».`, 'warning'); return; }
      if (info.tipo === 'no' || info.tipo === 'otro') { vib(200); toast('Tag no reconocido', `N° ${esc(numTag(fo))} no es un tag «CONTADO» reservado. Revisa el número.`, 'warning'); return; }
      if (info.tipo === '?') toast('Sin verificar', 'Sin internet no pude confirmar que sea un tag reservado: bodega lo revisará al enviar.', 'info');
      /* v21.273: si el tag viene preasignado a una bodega (ej. Bodega Satélite Vestidor), la selecciona automáticamente */
      if (info.bodega || info.bodegaId) {
        const matchB = (bodegas || []).find(x => (info.bodegaId && x.id === info.bodegaId) || (info.bodega && norm(x.name) === norm(info.bodega))) || (info.bodega ? { id: info.bodegaId || '', name: info.bodega } : null);
        if (matchB && (!b || b.id !== matchB.id || norm(b.name) !== norm(matchB.name))) {
          b = matchB; ls.set(K_BOD, b); cargarConteos(b).catch(() => {});
          toast('Bodega del tag', `Tag N° ${esc(numTag(fo))} asignado a ${esc(b.name)}.`, 'info');
        }
      }
    }
    if (!b) { pendTag = fo; toast('Elige la bodega', 'Primero elige en qué bodega estás contando.', 'warning'); ir('p0'); return; }
    const loc = cajas().find(c => c.folio === fo), f = fsx(); let d = null;
    try { const sn = await conTiempo(f.getDoc(f.doc(f.collection(dbx(), COL), fo)), 2500); if (sn.exists()) d = sn.data(); } catch (e) { /* sin internet: se sigue; al guardar, la regla impide pisar una caja de otro */ }
    if (loc && (!d || loc.estado === 'pend')) d = { ...loc.doc, estado: loc.srv || loc.doc.estado };   /* lo del teléfono manda si aún no se envía */
    if (d) { vib(40); ir('usado', { folio: fo, usado: d }); return; }
    vib(60); busca = ''; otroLote = false; ir('p1', { folio: fo, bodega: b, prod: null, lote: '', elaboracion: '', vence: '', sinLote: false, p3: null, estructura: null, editando: false, usado: null, guardado: null, hist: [] });
  }

  // ---------------- interfaz ----------------
  const cab = (dr, sub) => `<div class="lv-cab"><span class="lv-tag">N° ${esc(numTag(dr.folio))}</span><span class="lv-cab-t"><small>${esc(sub || (dr.bodega && dr.bodega.name) || '')}</small>${dr.prod ? `<b>${esc(dr.prod.nombre)}</b>` : '<b>Tag leído</b>'}</span><button type="button" class="lv-btn lv-btn--sec lv-btn--chico" data-lv-ir="p0">Salir</button></div>`;
  function franja(dr, conEsta) {
    const p = dr.prod; if (!p || p.controlado) return '';
    const b = dr.bodega, reg = (insumos || []).find(i => i.id === p.insumoId && esDeBodega(i, b)) || (insumos || []).find(i => esDeBodega(i, b) && norm(i.name) === norm(p.nombre));
    const extra = conEsta ? { folio: dr.folio, bodega: b.name, insumoId: p.insumoId, nombre: p.nombre, lote: dr.sinLote ? 'S/L' : dr.lote, vence: dr.vence || 'N/A', total: totalEstructura(dr.estructura) } : null;
    const cont = contadosDe(p.nombre, p.insumoId, b, extra);
    if (!reg || !lotesDe(reg).length) {
      const t = cont.reduce((s, x) => s + x.quantity, 0);
      const porLote = new Map();
      cont.forEach(x => { const k = `${x.batch}|${x.expirationDate}`; const e = porLote.get(k) || { batch: x.batch, vence: x.expirationDate, q: 0 }; e.q += num(x.quantity); porLote.set(k, e); });
      const filasL = [...porLote.values()].map(x => `<div class="lv-fr ok"><b>${esc(x.batch)}</b><span>${esc(mesCL(x.vence))}</span><span>Contado en esta bodega: ${x.q} u.</span></div>`).join('');
      return `<div class="lv-franja"><b>Sin stock previo en el sistema: partes de 0.</b>${t ? `<span>Total contado aquí: <b>${t}</b> u.${conEsta ? ' (incluye esta caja)' : ''}</span>${filasL}` : ''}</div>`;
    }
    const l = avanceLotes(lotesDe(reg), cont);
    return `<div class="lv-franja"><small>Avance en ${esc(b.name)}${conEsta ? ' (con esta caja)' : ''}</small>${l.map(x => `<div class="lv-fr ${x.delta === 0 ? 'ok' : x.delta < 0 ? 'falta' : 'sobra'}"><b>${esc(x.batch)}</b><span>${esc(mesCL(x.vence))}</span><span>Sistema ${x.sistema} u. · contado ${x.contado} u. · ${x.delta === 0 ? 'cuadra' : x.delta < 0 ? 'faltan ' + -x.delta + ' u.' : 'sobran ' + x.delta + ' u.'}</span></div>`).join('')}</div>`;
  }
  const venceTxt = (dr) => `${dr.sinLote ? 'S/L' : 'Lote ' + esc(dr.lote)}${elabCL(dr.elaboracion) ? ' · Elab. ' + esc(elabCL(dr.elaboracion)) : ''} · ${/^\d{4}-\d{2}$/.test(dr.vence || '') ? 'vence ' + esc(mesCL(dr.vence)) : 'sin vencimiento'}`;
  const avisoVencido = (dr) => vencido(dr.vence) ? '<p class="lv-vencido">VENCIDO: sepáralo</p>' : '';

  function pintarLogin(r, err) {
    r.innerHTML = `<div class="si-wrap lv"><div class="lv-cab"><span class="lv-cab-t"><small>Levantamiento de inventario</small><b>Ingresa con tu usuario</b></span><button type="button" class="lv-btn lv-btn--sec lv-btn--chico" data-lv-salir>Volver</button></div>
      ${pendTag ? `<p class="lv-s">Tag <b>N° ${esc(numTag(pendTag))}</b> leído: ingresa para contarlo.</p>` : ''}<p class="lv-s">El levantamiento queda a tu nombre, por eso necesita tu correo y tu clave (los mismos del Visor).</p>
      <form class="lv-login" data-lv-login autocomplete="on"><label class="si-l">Correo<input id="lv-c" class="si-in" type="email" autocomplete="username" inputmode="email" required></label><label class="si-l">Contraseña<input id="lv-p" class="si-in" type="password" autocomplete="current-password" required></label>
      <p class="sp-err" id="lv-err">${esc(err || '')}</p><button type="submit" class="lv-btn">Ingresar</button></form></div>`;
  }
  function pintarP0(r, dr) {
    const b = bodega(), u = usuario(), l = delTurno(cajas(), u), pend = cajas().filter(c => c.estado === 'pend' && c.doc.contadoPor === u).length;
    const enCursoTag = dr.folio && ['p1', 'nuevo', 'p2', 'p3', 'p4'].includes(dr.vistaAntes);
    r.innerHTML = `<div class="si-wrap lv"><div class="lv-cab"><span class="lv-cab-t"><small>Levantamiento · ${esc(nombreUsuario || u)}</small><b>Inicio del turno</b></span><button type="button" class="lv-btn lv-btn--sec lv-btn--chico" data-lv-ir="ayuda">¿Cómo se cuenta?</button><button type="button" class="lv-btn lv-btn--sec lv-btn--chico" data-lv-salir>Salir</button></div>
      <label class="si-l">Bodega donde cuentas<select id="lv-bod" class="si-in lv-in"><option value="">Elige la bodega…</option>${(bodegas || []).map(x => `<option value="${esc(x.id)}"${b && b.id === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      ${enCursoTag ? `<button type="button" class="lv-btn lv-btn--sec" data-lv-seguir>Seguir con el tag N° ${esc(numTag(dr.folio))}</button>` : ''}
      <button type="button" class="lv-btn lv-btn--grande" data-lv-cam${b ? '' : ' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>ESCANEAR TAG</button>
      <form class="lv-fila" data-lv-num><input id="lv-num" class="si-in lv-in" inputmode="numeric" placeholder="o escribe el N° del tag" value="${esc(pendTag ? numTag(pendTag) : '')}" autocomplete="off" aria-label="Número del tag"><button type="submit" class="lv-btn"${b ? '' : ' disabled'}>Abrir</button></form>
      <div class="lv-hoy"><span>Contadas en el turno: <b>${l.length}</b>${pend ? ` · <b class="lv-pend">${pend}</b> por enviar` : ''}</span><button type="button" class="lv-lnk" data-lv-ir="resumen">Ver resumen</button></div>
      <button type="button" class="lv-btn lv-btn--sec" data-lv-prep>Preparar sin internet</button><p class="lv-s">${(() => { const c = ls.get(K_INS); return c && c.al ? `Productos guardados en el teléfono: ${(c.l || []).length} (al ${esc(hora(c.al))}).` : 'Antes de ir a una bodega sin señal, toca «Preparar sin internet» con conexión.'; })()}</p></div>`;
  }
  const vistaAyuda = () => { try { return localStorage.getItem('lev-ayuda-vista') === '1'; } catch (e) { return true; } };
  /** Mini manual para el contador (v21.250): se muestra la primera vez y desde «¿Cómo se cuenta?». */
  function pintarAyuda(r) {
    const S = (t, c) => `<details class="lv-card lv-ay"${t.abierto ? ' open' : ''}><summary><b>${t.n}</b> ${t.t}</summary>${c}</details>`;
    r.innerHTML = `<div class="si-wrap lv"><div class="lv-cab"><span class="lv-cab-t"><small>Conteo e ingreso</small><b>¿Cómo se cuenta?</b></span><button type="button" class="lv-btn lv-btn--sec lv-btn--chico" data-lv-ir="p0">Volver</button></div>
      <p class="lv-s">Cuentas lo que hay en la bodega, <b>caja por caja</b>. Nada entra al stock hasta que bodega lo revise y lo acepte en el PC.</p>
      ${S({ n: '1', t: 'Antes de salir', abierto: true }, `<ul class="lv-ay-l"><li>Entra con <b>tu correo y tu clave</b>: cada caja queda a tu nombre.</li><li>Elige la <b>bodega</b> donde vas a contar.</li><li>Si allá no hay señal, toca <b>Preparar sin internet</b> aquí, con conexión.</li><li>Lleva tus <b>tags «CONTADO»</b> (ya traen número y QR) y un <b>bolígrafo</b> (no plumón).</li></ul>`)}
      ${S({ n: '2', t: 'Cada caja, paso a paso' }, `<ol class="lv-ay-l"><li><b>Pega un tag</b> en la caja, en una cara que se vea.</li><li>Toca <b>ESCANEAR TAG</b> y apunta al QR (o escribe el número).</li><li>Busca el <b>producto</b> y mira la <b>foto</b>: confirma que es el mismo (medida, estéril o no, mg/ml).</li><li>Elige el <b>lote</b> de la lista, o <b>+ Otro lote</b> si no aparece. El vencimiento se marca con los botones de mes y año.</li><li>Responde las <b>preguntas de la caja</b> (abajo, punto 4).</li><li>Revisa el <b>total en UNIDADES</b> y toca <b>GUARDAR</b>.</li><li>Cuando diga que llegó, <b>anota en el tag</b> lo que te indica la pantalla. Si dice «NO escribas todavía», pega el tag sin anotar y espera la confirmación.</li></ol>`)}
      ${S({ n: '3', t: 'Cómo llenar el tag' }, `<ul class="lv-ay-l"><li><b>Insumo</b>: el nombre como aparece en la pantalla.</li><li><b>Lote / Vence</b>: los de la caja (mes/año). Si no trae lote, escribe <b>S/L</b>.</li><li><b>Total</b>: las <b>unidades</b> de la caja (no la cantidad de cajas).</li><li>Marca <b>Sin subdivisión</b>, o escribe <b>___ cajas × ___ u.</b> si trae cajas chicas, o <b>Granel</b> si son unidades sueltas.</li><li>Marca <b>ABIERTA</b> si la caja está abierta.</li><li><b>Contó</b>: tus iniciales. <b>Fecha</b>: la de hoy.</li><li>En cajas grandes, el tag va en una cara; las etiquetas definitivas (dos caras) llegan después desde bodega.</li></ul>`)}
      ${S({ n: '4', t: 'Las variables del conteo' }, `<ul class="lv-ay-l"><li><b>Caja cerrada sin cajas chicas</b>: cuántas unidades trae (lo dice la caja).</li><li><b>Caja cerrada con cajas chicas</b>: cuántas cajas chicas y cuánto trae cada una. Ej.: 10 × 50 = 500 u.</li><li><b>Caja abierta con cajas chicas</b>: cuántas chicas <b>cerradas</b>, cuánto trae cada una y, por cada chica <b>abierta</b>, cuántas unidades quedan. Ej.: 9 × 50 + 1 abierta con 30 = <b>480 u.</b></li><li><b>Unidades sueltas (granel)</b>: cuéntalas de a 10 con los botones +10 / +50.</li><li><b>Sin lote</b>: si la caja tiene vencimiento pero no lote, usa «Sin lote» (igual pide mes y año). «Sin lote ni vencimiento» solo si no trae ninguno.</li><li><b>Vencido</b>: si sale «VENCIDO», cuéntalo igual y <b>sepáralo</b>.</li><li><b>Controlados</b>: se cuentan sin ver lo que dice el sistema; bodega pide un segundo conteo.</li></ul>`)}
      ${S({ n: '5', t: 'Mientras cuentas' }, `<ul class="lv-ay-l"><li>Arriba ves por lote: <b>Sistema</b> · <b>contado</b> · <b>faltan / sobran</b>. No cuentes «hasta que cuadre»: cuenta lo que hay.</li><li>Otra caja del mismo producto y lote: <b>MISMO PRODUCTO Y LOTE</b> (3 toques).</li><li>El mismo producto con otro lote: <b>Mismo producto, otro lote</b>.</li><li>Un tag por caja. Si un tag ya se usó, la pantalla te lo dice: no lo repitas.</li><li>Si bodega pide <b>recontar</b>, aparece en <b>Ver resumen</b>: abre esa caja y corrige.</li></ul>`)}
      ${S({ n: '6', t: 'Al terminar el turno' }, `<ul class="lv-ay-l"><li>Abre <b>Ver resumen</b>: revisa que no queden cajas <b>por enviar</b>.</li><li>Si quedan, conéctate a internet y espera a que se envíen antes de cerrar sesión.</li><li>Las cajas «para revisar»: sepáralas y avisa a bodega.</li></ul>`)}
      <button type="button" class="lv-btn lv-btn--grande" data-lv-ir="p0">Entendido: empezar</button></div>`;
    r.querySelectorAll('[data-lv-ir="p0"]').forEach(b => b.addEventListener('click', () => { try { localStorage.setItem('lev-ayuda-vista', '1'); } catch (e) { /* sin almacenamiento */ } }));   /* vista: solo al cerrarla, no al pintarla */
  }
  function pintarUsado(r, dr) {
    const d = dr.usado || {}, mio = d.contadoPor && d.contadoPor === usuario(), puede = (mio && ['REGISTRADO', 'RECONTEO'].includes(d.estado)) || (!mio && d.estado === 'RECONTEO');   /* v21.276: el reconteo lo puede (y para controlados lo debe) hacer otra persona */
    r.innerHTML = `<div class="si-wrap lv">${cab({ folio: dr.folio, bodega: dr.bodega || bodega() }, 'Tag ya usado')}
      <div class="lv-card lv-card--av"><p class="lv-q">Tag ${esc(numTag(dr.folio))} ya es <b>${esc(d.nombre)}</b> · <b>${num(d.total)}</b> u.</p><p class="lv-s">${esc(d.contadoNombre || d.contadoPor || '')} · ${esc(hora(d.en))}${d.bodega ? ' · ' + esc(d.bodega) : ''}${d.estado === 'RECONTEO' ? ' · <b>Bodega pidió recontar</b>' : d.estado && d.estado !== 'REGISTRADO' ? ' · ' + esc(d.estado) : ''}</p></div>
      ${puede ? `<button type="button" class="lv-btn" data-lv-corregir>${mio ? 'Corregir esa caja' : 'Recontar esa caja (bodega pidió otra persona)'}</button>` : `<p class="lv-s">${mio ? 'Esa caja ya fue revisada por bodega: no se puede corregir aquí.' : 'Solo quien la contó puede corregirla (otra persona solo cuando bodega pide recontar).'}</p>`}
      <button type="button" class="lv-btn lv-btn--sec" data-lv-otro>Escanear otro</button></div>`;
  }
  function pintarP1(r, dr) {
    const ult = ls.get(K_ULT), lista = buscar(catalogo(dr.bodega), busca), IM = window.SAR_Imagenes;
    r.innerHTML = `<div class="si-wrap lv">${cab(dr)}<h2 class="lv-t">¿Qué producto es?</h2>
      ${ult && ult.prod ? `<button type="button" class="lv-btn lv-btn--ult" data-lv-mismo><span>MISMO PRODUCTO Y LOTE</span><small>${esc(ult.prod.nombre)} · ${ult.sinLote ? 'S/L' : 'lote ' + esc(ult.lote)} · ${esc(mesCL(ult.vence))}</small></button><button type="button" class="lv-btn lv-btn--sec" data-lv-mismo-otro>Mismo producto, otro lote</button>` : ''}
      <label class="si-l">Buscar<input id="lv-bus" class="si-in lv-in" type="search" value="${esc(busca)}" placeholder="Escribe parte del nombre de la caja…" autocomplete="off" enterkeyhint="search"></label>
      <div class="lv-res" id="lv-res">${resHTML(lista, IM)}</div>
      <button type="button" class="lv-btn lv-btn--sec" data-lv-nuevo>No está: producto nuevo</button></div>`;
    if (IM) IM.rellenar(r);
  }
  const resHTML = (lista, IM) => lista.length ? lista.map(p => `<button type="button" class="lv-prod" data-lv-prod="${esc(p.k)}">${IM ? IM.thumb(p.nombre, { codigo: p.codigoMP || '' }) : ''}<span><b>${esc(p.nombre)}</b><small>${p.enBodega ? 'Está en esta bodega' : (p.contadoAqui ? 'Ya ingresado en conteo' : 'No está en esta bodega')}${p.contadoAqui ? ` · contado aquí: ${p.contadoAqui} u.` : ''}${p.controlado ? ' · controlado' : ''}</small></span></button>`).join('') : `<p class="lv-s">${busca ? 'Sin coincidencias. Prueba con otra palabra o crea el producto nuevo.' : 'Escribe para buscar en todo el catálogo.'}</p>`;
  const sugNuevoHTML = (txt, b) => {
    const t = norm(txt); if (t.length < 3) return '';
    const hits = buscar(catalogo(b), t).slice(0, 4);
    if (!hits.length) return '';
    return `<div class="lv-card lv-card--av"><b>Ya existe un producto parecido ingresado:</b><p class="lv-s">Tócalo para sumarle (en el mismo lote o en un lote distinto) y no duplicarlo:</p><div class="lv-res">${hits.map(p => `<button type="button" class="lv-prod" data-lv-prod="${esc(p.k)}"><span><b>${esc(p.nombre)}</b><small>${p.enBodega ? 'En esta bodega' : (p.contadoAqui ? 'Contado aquí: ' + p.contadoAqui + ' u.' : 'En otra bodega')}</small></span></button>`).join('')}</div></div>`;
  };
  function pintarNuevo(r, dr) {
    const n = dr.nuevoForm || { nombre: busca, tipo: '' };
    r.innerHTML = `<div class="si-wrap lv">${cab(dr)}<h2 class="lv-t">Producto nuevo</h2><p class="lv-s">Escribe el nombre <b>tal como dice la caja</b> (qué es, marca, medida).</p>
      <label class="si-l">Nombre<input id="lv-nn" class="si-in lv-in" value="${esc(n.nombre)}" autocomplete="off"></label>
      <div id="lv-nn-sug">${sugNuevoHTML(n.nombre, dr.bodega)}</div>
      <p class="lv-q">¿De qué tipo es?</p><div class="lv-g2">${TIPOS.map(([k, t]) => `<button type="button" class="lv-btn lv-btn--op${n.tipo === k ? ' on' : ''}" data-lv-tipo="${k}" aria-pressed="${n.tipo === k}">${t}</button>`).join('')}</div>
      ${n.tipo === 'medicamento' ? `<p class="lv-q">¿Es controlado?</p><div class="lv-g3">${[['si', 'Sí'], ['no', 'No'], ['revisar', 'No sé']].map(([k, t]) => `<button type="button" class="lv-btn lv-btn--op${n.ctl === k ? ' on' : ''}" data-lv-ctl="${k}" aria-pressed="${n.ctl === k}">${t}</button>`).join('')}</div>` : ''}
      <div class="lv-g2"><button type="button" class="lv-btn lv-btn--sec" data-lv-ir="p1">Volver</button><button type="button" class="lv-btn" data-lv-nuevo-ok>Seguir</button></div></div>`;
  }
  function pintarP2(r, dr) {
    const p = dr.prod, IM = window.SAR_Imagenes, b = dr.bodega, reg = p.insumoId ? (insumos || []).find(i => i.id === p.insumoId && esDeBodega(i, b)) : (insumos || []).find(i => esDeBodega(i, b) && norm(i.name) === norm(p.nombre));
    const lotes = lotesCombinados(reg, p.nombre, p.insumoId, b);
    const abierto = otroLote || !lotes.length, ol = dr.ol || {}, anio = new Date().getFullYear(), venceOl = ol.anio && ol.mes ? `${ol.anio}-${ol.mes}` : '';
    const elabVal = ol.elaboracion || dr.elaboracion || '';
    r.innerHTML = `<div class="si-wrap lv">${cab(dr)}<div class="lv-foto">${IM ? IM.thumb(p.nombre, { codigo: p.codigoMP || '', grande: true }) : ''}<div><b>${esc(p.nombre)}</b><small>${p.nuevo ? 'Producto nuevo · ' + esc((TIPOS.find(t => t[0] === p.tipo) || [])[1] || '') : reg ? 'Está en esta bodega' : 'No está en esta bodega'}${p.controlado ? ' · <b>controlado</b>' : ''}</small></div></div>
      ${franja(dr, false)}
      <h2 class="lv-t">¿Qué lote es?</h2>
      <label class="si-l">Fecha de elaboración (opcional)<input id="lv-elab" class="si-in lv-in" type="date" value="${esc(elabVal)}"></label>
      ${lotes.length ? `<div class="lv-lotes">${lotes.map((x, i) => `<button type="button" class="lv-btn lv-btn--lote" data-lv-lote="${i}"><b>${esc(x.lote)}</b><span>${esc(mesCL(x.mes))}${x.elaboracion ? ' · Elab. ' + esc(elabCL(x.elaboracion)) : ''}${vencido(x.mes) ? ' · <em class="lv-rojo">VENCIDO</em>' : ''}</span>${p.controlado ? (x.contado ? `<small>Ya contado: ${x.contado} u. (toca para sumar)</small>` : '') : `<small>${x.sistema ? `Sistema ${x.sistema} u.` : 'Lote nuevo en conteo'}${x.contado ? ` · ya contado: ${x.contado} u. (toca para sumar)` : ''}</small>`}</button>`).join('')}</div>` : ''}
      ${lotes.length && !abierto ? '<button type="button" class="lv-btn lv-btn--sec" data-lv-otrolote>+ Otro lote (sumar lote distinto)</button>' : ''}
      ${abierto ? `<div class="lv-card"><b>${lotes.length ? 'Otro lote' : 'Lote y vencimiento'}</b>${ol.sl ? '<p class="lv-q">Lote: <b>S/L</b> (sin lote) · elige el vencimiento</p><button type="button" class="lv-lnk" data-lv-conlote>Sí trae lote</button>' : `<label class="si-l">Lote (como dice la caja)<input id="lv-lote" class="si-in lv-in" value="${esc(ol.lote || '')}" autocomplete="off" autocapitalize="characters"></label>`}
        <p class="lv-s">Mes de vencimiento</p><div class="lv-meses">${Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => `<button type="button" class="lv-k${ol.mes === m ? ' on' : ''}" data-lv-mes="${m}">${m}</button>`).join('')}</div>
        <p class="lv-s">Año</p><div class="lv-anios">${Array.from({ length: 9 }, (_, i) => String(anio - 1 + i)).map(a => `<button type="button" class="lv-k${ol.anio === a ? ' on' : ''}" data-lv-anio="${a}">${a}</button>`).join('')}</div>
        ${venceOl && vencido(venceOl) ? '<p class="lv-vencido">VENCIDO: sepáralo</p>' : ''}
        <button type="button" class="lv-btn" data-lv-ol-ok>Seguir con este lote</button>
        <div class="lv-g2">${ol.sl ? '' : '<button type="button" class="lv-btn lv-btn--sec" data-lv-sl>Sin lote</button>'}<button type="button" class="lv-btn lv-btn--sec" data-lv-sinlote>Sin lote ni vencimiento</button></div></div>` : ''}
      <button type="button" class="lv-lnk" data-lv-ir="p1">Cambiar producto</button></div>`;
    if (IM) IM.rellenar(r);
  }
  const PREG = {
    estado: ['¿Cómo está la caja grande?', [['CERRADA', 'estado', 'CERRADA'], ['ABIERTA', 'estado', 'ABIERTA']]],
    'cerr-int': ['¿Esta caja se subdivide en cajas chicas adentro? (opcional)', [['NO, es una sola', 'int', false], ['SÍ, trae cajas chicas', 'int', true]]],
    'cerr-total': ['¿Cuántas unidades trae en total?', 'total'],
    'cerr-n': ['¿Cuántas cajas interiores trae?', 'n'],
    'cerr-q': ['¿Cuántas unidades trae cada caja interior?', 'q'],
    'ab-que': ['¿Esta caja abierta se subdivide en cajas chicas? (opcional)', [['SÍ, cajas chicas', 'que', 'chicas'], ['NO, solo sueltas', 'que', 'sueltas']]],
    'ch-n': ['¿Cuántas cajas chicas CERRADAS hay?', 'chN'],
    'ch-q': ['¿Cuántas unidades trae cada caja chica cerrada?', 'chQ'],
    'ch-ab': ['¿Hay cajas chicas ABIERTAS?', [['NO', 'ab', false], ['SÍ', 'ab', true]]],
    'ch-nab': ['¿Cuántas cajas chicas abiertas hay?', 'nab'],
    'ch-abq': ['', 'abq'],
    'ch-sue': ['¿Cuántas unidades sueltas hay fuera de las cajas chicas?', 'sue'],
    'su-n': ['¿Cuántas unidades sueltas hay?', 'suN']
  };
  const esCajas = (paso) => ['cerr-n', 'ch-n', 'ch-nab'].includes(paso);
  const valorDe = (p) => { const c = PREG[p.paso][1]; return c === 'abq' ? (p.abq || [])[ent(p.i)] : p[c]; };
  function pintarP3(r, dr) {
    const p = dr.p3 || { paso: 'estado' }, pr = PREG[p.paso] || PREG.estado, botones = Array.isArray(pr[1]);
    const preg = p.paso === 'ch-abq' ? `Caja chica abierta ${ent(p.i) + 1} de ${ent(p.nab)}: ¿cuántas unidades quedan?` : pr[0];
    if (!botones && p.tmp == null) { const v = valorDe(p); p.tmp = v != null && v !== '' ? String(v) : (p.paso === 'ch-sue' ? '0' : ''); p.pre = !!p.tmp; dr.p3 = p; setBor(dr); }   /* lo de antes (o el 0): la primera tecla lo reemplaza */
    r.innerHTML = `<div class="si-wrap lv">${cab(dr, venceTxt(dr))}${avisoVencido(dr)}<div class="lv-paso"><p class="lv-q lv-q--g">${esc(preg)}</p>
      ${botones ? `<div class="lv-g2">${pr[1].map(([t, k, v]) => `<button type="button" class="lv-btn lv-btn--op${p[k] === v ? ' on' : ''}" data-lv-resp="${esc(String(v))}" aria-pressed="${p[k] === v}">${esc(t)}</button>`).join('')}</div>`
      : `<output class="lv-disp${esCajas(p.paso) ? ' lv-disp--cajas' : ''}"><b id="lv-disp">${esc(p.tmp || '0')}</b> <span>${esCajas(p.paso) ? 'CAJAS' : 'UNIDADES'}</span></output>
        ${p.paso === 'su-n' ? '<div class="lv-g2"><button type="button" class="lv-btn lv-btn--sec" data-lv-mas="10">+10</button><button type="button" class="lv-btn lv-btn--sec" data-lv-mas="50">+50</button></div>' : ''}
        <div class="lv-tec" role="group" aria-label="Teclado numérico">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map(k => `<button type="button" class="lv-tk${k === 'OK' ? ' lv-tk--ok' : ''}" data-lv-tk="${k}" aria-label="${k === '⌫' ? 'Borrar' : k}">${k}</button>`).join('')}</div>`}
      </div><button type="button" class="lv-btn lv-btn--sec" data-lv-atras>Atrás</button></div>`;
  }
  function pintarP4(r, dr) {
    const fm = formula(dr.estructura);
    r.innerHTML = `<div class="si-wrap lv">${cab(dr, venceTxt(dr))}${avisoVencido(dr)}<h2 class="lv-t">Confirma la caja</h2>
      <div class="lv-card lv-formula">${fm.partes.map(x => `<p>${esc(x)}</p>`).join('')}<p class="lv-total"><b>${fm.total}</b> UNIDADES</p>${fm.nota ? `<p class="lv-nota">${esc(fm.nota)}</p>` : ''}</div>
      ${franja(dr, true)}
      <div class="lv-g2"><button type="button" class="lv-btn lv-btn--sec" data-lv-corr>Corregir</button><button type="button" class="lv-btn lv-btn--ok" data-lv-guardar${guardando ? ' disabled' : ''}>${guardando ? 'Guardando…' : 'GUARDAR'}</button></div>
      <button type="button" class="lv-lnk" data-lv-ir="p1">Cambiar producto o lote</button></div>`;
  }
  function pintarP5(r, dr) {
    const g = dr.guardado || {}, d = g.doc || {}, e = d.estructura || {}, ab = e.estado === 'ABIERTA' || (e.interiores || []).some(x => x.abierta);
    const ini = String(d.contadoNombre || d.contadoPor || '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('');
    const elabTxt = elabCL(d.elaboracion);
    const detErr = g.err ? `<p class="lv-s" style="text-align:center;color:#991b1b;">Detalle: ${esc(g.err)}${/permission/i.test(String(g.err)) ? ' (verifica que las reglas de Firestore para Conteos_Cajas estén desplegadas).' : ''}</p>` : '';
    /* Penny: si el envío no está confirmado, no se manda a escribir el tag (otro pudo contarlo, o bodega puede rechazarlo) */
    const anotar = g.estado === 'ok' ? `<div class="lv-card"><b>Escribe a mano en el tag:</b><ul class="lv-lista"><li>Insumo: <b>${esc(d.nombre)}</b></li><li>Lote: <b>${esc(d.lote)}</b>${elabTxt ? ` · Elab.: <b>${esc(elabTxt)}</b>` : ''} · Vence: <b>${esc(mesCL(d.vence))}</b></li><li>Total: <b>${num(d.total)} u.</b></li><li>${esc(estructuraCorta(e))}</li><li>Contó: <b>${esc(ini)}</b> · ${esc(new Date(d.en || Date.now()).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }))}</li>${ab ? '<li>Marca <b>☐ ABIERTA</b></li>' : ''}</ul>
      <p class="lv-s">Pega el tag en <b>2 caras</b> de la caja.</p></div>`
      : g.estado === 'revisar' ? `<p class="lv-alto">NO escribas el tag: bodega no aceptó esta caja. Sepárala y avisa a bodega.</p>${detErr}`
      : '<p class="lv-alto">NO escribas todavía: pega el tag sin anotar · pendiente de confirmar</p><p class="lv-s">Cuando llegue a bodega te avisaré aquí y en el resumen.</p>';
    r.innerHTML = `<div class="si-wrap lv"><div class="lv-ok${g.estado === 'ok' ? '' : ' lv-ok--pend'}"><span aria-hidden="true">${g.estado === 'ok' ? '✓' : '…'}</span><p>Tag <b>N° ${esc(numTag(d.folio))}</b> queda a nombre de <b>${esc(d.contadoNombre || d.contadoPor)}</b></p><small>${g.estado === 'ok' ? 'Enviado a bodega.' : g.estado === 'revisar' ? 'Bodega no lo aceptó: queda «para revisar» en el resumen.' : 'Guardado en el teléfono: se enviará solo al volver la señal.'}</small></div>
      ${anotar}
      <button type="button" class="lv-btn lv-btn--grande" data-lv-sig>SIGUIENTE CAJA</button></div>`;
  }
  function pintarResumen(r) {
    const u = usuario(), l = delTurno(cajas(), u).reverse(), s = resumen(l), enTurno = new Set(l.map(c => c.folio)), viejas = cajas().filter(c => c.doc.contadoPor === u && c.estado !== 'ok' && !enTurno.has(c.folio));
    const revPend = cajas().filter(c => c.doc.contadoPor === u && c.estado === 'revisar').length;
    const fila = (c) => `<div class="lv-caja lv-caja--${esc(c.estado)}"><b>N° ${esc(numTag(c.folio))}</b><span>${esc(c.doc.nombre)}<small>${c.doc.sinLote ? 'S/L' : 'Lote ' + esc(c.doc.lote)}${elabCL(c.doc.elaboracion) ? ' · Elab. ' + esc(elabCL(c.doc.elaboracion)) : ''} · ${esc(mesCL(c.doc.vence))} · ${esc(estructuraCorta(c.doc.estructura))}</small>${c.estado === 'revisar' ? `<small class="lv-rojo">${esc(c.err || 'Bodega no la aceptó')} · Separa la caja y avisa a bodega.</small>` : ''}</span><span class="lv-caja-t">${num(c.doc.total)} u.<small>${c.srv === 'RECONTEO' ? 'Bodega pidió recontar' : c.estado === 'ok' ? (c.srv && c.srv !== 'REGISTRADO' ? esc(c.srv.toLowerCase()) : 'Enviada') : c.estado === 'revisar' ? 'Para revisar' : 'Por enviar'}</small>${c.srv === 'RECONTEO' && c.estado !== 'pend' ? `<button type="button" class="lv-btn lv-btn--chico" data-lv-recontar="${esc(c.folio)}">Recontar</button>` : ''}</span></div>`;
    r.innerHTML = `<div class="si-wrap lv"><div class="lv-cab"><span class="lv-cab-t"><small>Levantamiento · últimas 12 horas</small><b>Resumen del turno</b></span><button type="button" class="lv-btn lv-btn--sec lv-btn--chico" data-lv-ir="p0">Volver</button></div>
      <div class="lv-res-g">${[['Cajas', s.cajas], ['Productos', s.productos], ['Lotes', s.lotes], ['Productos nuevos', s.nuevos], ['Por enviar', s.porEnviar], ['Enviadas', s.enviadas]].map(([t, v]) => `<div><b>${v}</b><small>${t}</small></div>`).join('')}</div>
      ${s.reconteo ? `<p class="lv-vencido">Bodega pidió recontar ${s.reconteo} caja(s).</p>` : ''}${s.revisar ? `<p class="lv-vencido">${s.revisar} caja(s) para revisar: sepáralas y avisa a bodega.</p>` : ''}
      ${s.porEnviar ? '<button type="button" class="lv-btn lv-btn--sec" data-lv-reint>Reintentar envío ahora</button>' : ''}
      ${revPend ? `<button type="button" class="lv-btn lv-btn--sec" data-lv-reint-rev>Reintentar cajas «para revisar» (${revPend})</button>` : ''}
      ${s.subtotales.length ? `<div class="lv-card"><b>Unidades por producto y lote</b><div class="lv-subt">${s.subtotales.map(x => `<div><span>${esc(x.nombre)}<small>${esc(x.lote)} · ${esc(mesCL(x.vence))} · ${x.cajas} caja${x.cajas === 1 ? '' : 's'}</small></span><b>${x.unidades} u.</b></div>`).join('')}</div></div>` : ''}
      <div class="lv-cajas">${l.map(fila).join('') || '<p class="lv-s">No hay cajas tuyas en las últimas 12 horas.</p>'}</div>
      ${viejas.length ? `<p class="lv-s">De turnos anteriores, sin cerrar:</p><div class="lv-cajas">${viejas.map(fila).join('')}</div>` : ''}</div>`;
  }
  async function pintar(r) {
    if (!r) return; r.classList.add('lv-root');
    if (!usuario()) { pintarLogin(r); return; }
    if (!habil()) { r.innerHTML = `<div class="si-wrap lv"><div class="lv-card"><b>Sin permiso para el levantamiento</b><p class="lv-s">Tu usuario (${esc(usuario())}${rol() ? ' · ' + esc(rol()) : ''}) no tiene el rol «contador». Pídelo a bodega.</p></div><button type="button" class="lv-btn lv-btn--sec" data-lv-salir>Volver</button></div>`; return; }
    if (!bodegas) { r.innerHTML = window.SAR_Progreso && window.SAR_Progreso.cargando ? window.SAR_Progreso.cargando('Preparando el levantamiento…') : 'Cargando…'; await cargarBodegas(); await cargarInsumos().catch(() => {}); cargarConteos(bodega()).catch(() => {}); reintentar(true).then(() => sincronizarMias()).catch(() => {}); }
    const dr = bor();
    if (pendTag && bodega()) { const t = pendTag; pendTag = ''; abrirTag(t); return; }
    if (!dr.folio && dr.vista !== 'p0' && dr.vista !== 'resumen') dr.vista = 'p0';
    ({ p0: pintarP0, ayuda: pintarAyuda, usado: pintarUsado, p1: pintarP1, nuevo: pintarNuevo, p2: pintarP2, p3: pintarP3, p4: pintarP4, p5: pintarP5, resumen: pintarResumen }[(!vistaAyuda() && !pendTag && (!dr.vista || dr.vista === 'p0')) ? 'ayuda' : (dr.vista || 'p0')] || pintarP0)(r, dr);
  }

  // ---------------- acciones ----------------
  function elegirProducto(k) {
    const dr = bor(), p = catalogo(dr.bodega).find(x => x.k === k); if (!p) return; const i = p.enBodega || p.otro;
    otroLote = false; ir('p2', { prod: { insumoId: i ? i.id : null, nombre: p.nombre, nuevo: !i && !!p.nuevoContado, tipo: !i ? (p.tipo || null) : null, controlado: p.controlado || null, codigoMP: p.codigoMP || '' }, elaboracion: '', ol: {} });
  }
  function aP3(cambios) { const dr = bor(); ir('p3', { ...cambios, p3: dr.editando && dr.p3prev ? { ...dr.p3prev, paso: 'estado' } : { paso: 'estado' }, hist: [] }); }
  function responder(valor) {
    const dr = bor(), p = { ...(dr.p3 || { paso: 'estado' }) }, pr = PREG[p.paso]; if (!pr) return;
    if (Array.isArray(pr[1])) { const op = pr[1].find(o => String(o[2]) === valor); if (!op) return; p[op[1]] = op[2]; }
    else {
      const v = ent(p.tmp), c = pr[1];
      if (v > TOPE) { toast('Número muy grande', 'Revisa la cantidad (máximo 1.000.000).', 'warning'); return; }
      if (!v && !['ch-n', 'ch-sue'].includes(p.paso)) { toast('Falta el número', 'Escribe una cantidad mayor que 0.', 'warning'); return; }
      if ((p.paso === 'cerr-n' || p.paso === 'ch-nab' || p.paso === 'ch-n') && v > 200) { toast('Demasiadas cajas', 'Máximo 200 cajas chicas por caja grande.', 'warning'); return; }
      if (c === 'abq') { const a = (p.abq || []).slice(); a[ent(p.i)] = v; p.abq = a; } else p[c] = v;
    }
    const hist = (dr.hist || []).concat([{ ...dr.p3, tmp: undefined }]), sig = siguientePaso(p);
    if (sig === 'fin') { const e = estructuraDe(p); if (totalEstructura(e) < 1) { toast('Caja vacía', 'La caja quedó con 0 unidades: revisa las respuestas.', 'warning'); return; } vib(30); ir('p4', { p3: { ...p, tmp: null }, p3prev: { ...p, tmp: null }, estructura: e, hist }); return; }
    const np = { ...p, paso: sig, tmp: null }; if (sig === 'ch-abq') np.i = p.paso === 'ch-abq' ? ent(p.i) + 1 : 0;
    ir('p3', { p3: np, hist });
  }
  function atras() { const dr = bor(), h = (dr.hist || []).slice(); if (!h.length) { ir(dr.prodDesdeUlt ? 'p1' : 'p2'); return; } const prev = h.pop(); ir('p3', { p3: { ...prev, tmp: null }, hist: h }); }
  /** Lo que marcaba el sistema para el lote de la caja (también en controlados): base, cuándo se leyó y la deuda del producto. */
  function sistemaDe(dr) {
    const p = dr.prod || {}, b = dr.bodega, reg = (insumos || []).find(i => p.insumoId && i.id === p.insumoId && esDeBodega(i, b)) || (p.nuevo ? null : (insumos || []).find(i => esDeBodega(i, b) && norm(i.name) === norm(p.nombre)));
    const sl = reg ? lotesDe(reg).filter(b => window.SAR_Toma && window.SAR_Toma.lote(b.batch) === 'S/L').reduce((t, b) => t + num(b.quantity), 0) : null;
    return { base: baseDe(reg, dr.sinLote ? 'S/L' : dr.lote, dr.vence || 'N/A'), en: insumosAl || new Date().toISOString(), deuda: reg ? num(reg.sobregiro) : 0, sl };
  }
  /** Escribe una caja: crear = setDoc (solo si no existe en el servidor); corregir = updateDoc con lo que cambia (la regla rechaza si ya fue aceptada). */
  function escribir(c) {
    const f = fsx(), ref = f.doc(f.collection(dbx(), COL), c.folio);
    const campos = {}; Object.entries(c.campos || {}).forEach(([k, v]) => { campos[k] = v === BORRAR ? (f.deleteField ? f.deleteField() : null) : v; });
    return c.op === 'editar' ? f.updateDoc(ref, campos) : f.setDoc(ref, { ...c.doc, servidorEn: f.serverTimestamp() });
  }
  async function guardar() {
    if (guardando) return; const dr = bor(), u = { correo: usuario(), nombre: nombreUsuario || usuario() }, d = armarDoc(dr, u, sistemaDe(dr)), errs = validar(d);
    if (errs.length) { toast('Revisa la caja', errs.map(esc).join(' · '), 'warning'); return; }
    if (!dr.editando && cajas().some(c => c.folio === d.folio)) { toast('Tag ya usado', 'Este tag ya está guardado en el teléfono.', 'warning'); return; }
    guardando = true; repintar();
    const previa = cajas().find(c => c.folio === d.folio), antes = dr.orig || (previa && previa.doc) || null;
    const reconteoAjeno = !!(dr.editando && antes && antes.contadoPor && antes.contadoPor !== u.correo);   /* v21.276: recuenta otra persona (doble conteo) */
    if (dr.editando && antes) { d.en = antes.en || d.en; d.contadoPor = antes.contadoPor || d.contadoPor; if (reconteoAjeno) { d.contadoNombre = antes.contadoNombre || d.contadoNombre; ['bodega', 'bodegaId', 'insumoId', 'nombre', 'nombreNorm', 'nuevo', 'controlado'].forEach(k => { if (k in antes) d[k] = antes[k]; else delete d[k]; }); }   /* el reconteo ajeno no cambia producto ni bodega (regla) */ d.huella = huella(d); }
    /* una corrección de una caja que aún no llegó al servidor sigue siendo «crear» con los datos nuevos */
    const entrada = dr.editando && !(previa && previa.estado === 'pend' && previa.op !== 'editar') ? { folio: d.folio, doc: { ...d, editadoEn: new Date().toISOString() }, estado: 'pend', op: 'editar', campos: cambiosDe(antes, d) } : { folio: d.folio, doc: d, estado: 'pend', op: 'crear' };
    if (entrada.op === 'editar' && previa && previa.op === 'editar' && previa.estado === 'pend') entrada.campos = { ...previa.campos, ...entrada.campos };
    if (entrada.op === 'editar' && reconteoAjeno) { const en = entrada.campos.editadoEn || new Date().toISOString(); entrada.campos.editadoEn = en; entrada.campos.recontadoPor = u.correo; entrada.campos.recontadoNombre = u.nombre || u.correo; entrada.campos.recontadoEn = en; entrada.doc = { ...entrada.doc, recontadoPor: u.correo, recontadoEn: en }; }
    const l = cajas().filter(c => c.folio !== d.folio); l.push(entrada); setCajas(l);
    const pr = escribir(entrada);
    let errGuard = '';
    const res = await Promise.race([pr.then(() => 'ok'), new Promise(x => setTimeout(() => x('cola'), 4000))]).catch(e => { errGuard = String((e && (e.code || e.message)) || e || ''); return esPermiso(e) ? 'revisar' : 'cola'; });
    pr.then(() => marcar(d.folio, 'ok', null, 'REGISTRADO')).catch(e => { if (esPermiso(e)) { marcar(d.folio, 'revisar', String(e.code || e.message || e)); toast('Caja para revisar', `Bodega no aceptó el tag N° ${esc(numTag(d.folio))}. Queda en el resumen.`, 'error'); } });
    if (res === 'revisar') marcar(d.folio, 'revisar', errGuard);
    if (res === 'cola') { const l2 = cajas(), c2 = l2.find(x => x.folio === d.folio); if (c2 && c2.estado === 'pend') { c2.avisar = true; setCajas(l2); } }   /* P5 dijo «no escribas todavía»: avisar cuando llegue */
    ls.set(K_ULT, { prod: dr.prod, lote: dr.lote, elaboracion: dr.elaboracion || '', vence: dr.vence, sinLote: dr.sinLote }); vib([60, 40, 60]);
    guardando = false; busca = ''; otroLote = false;
    ir('p5', { guardado: { doc: entrada.doc, estado: res, err: errGuard }, p3: null, p3prev: null, estructura: null, editando: false, orig: null, hist: [] });
  }
  function marcar(fo, estado, err, srvEstado) { const l = cajas(), c = l.find(x => x.folio === fo); if (!c) return; const antes = c.estado; c.estado = estado;
    if (antes === 'pend' && estado === 'ok' && c.avisar) { delete c.avisar; vib([40, 40, 40]); toast('Tag confirmado', `N° ${esc(numTag(fo))} llegó a bodega: ya puedes anotarlo en el tag.`, 'success'); } if (err) c.err = err; else delete c.err; if (srvEstado) c.srv = srvEstado; if (estado === 'ok') delete c.campos; setCajas(l); const dr = bor(); if (dr.vista === 'p5' && dr.guardado && dr.guardado.doc && dr.guardado.doc.folio === fo) { dr.guardado.estado = estado; if (err) dr.guardado.err = err; setBor(dr); } if (mostrar && ['p0', 'resumen', 'p5'].includes(dr.vista)) repintar(); }
  /** Reenvía lo que quedó en el teléfono. Crear: si ya existe en el servidor y es mía, llegó (no se pisa: bodega pudo cambiar su estado).
   *  Corregir: updateDoc; si la regla lo rechaza (ya aceptada), queda «para revisar» y no se reintenta. */
  let reintentando = false;
  async function reintentar(silencio, incluirRevisar) {
    if (reintentando || navigator.onLine === false) return; const u = usuario();
    if (incluirRevisar) { const lsC = cajas(); lsC.forEach(c => { if (c.estado === 'revisar' && c.doc.contadoPor === u) { c.estado = 'pend'; delete c.err; } }); setCajas(lsC); }
    const pend = cajas().filter(c => c.estado === 'pend' && (c.doc.contadoPor === u || c.doc.recontadoPor === u)); if (!pend.length) return; reintentando = true; const f = fsx(); let ok = 0;
    for (const c of pend) {
      try {
        if (c.op !== 'editar') { const sn = await conTiempo(f.getDoc(f.doc(f.collection(dbx(), COL), c.folio)), 5000); if (sn.metadata && sn.metadata.hasPendingWrites) continue; if (sn.exists()) { const x = sn.data();   /* lo que aún está solo en la copia local no cuenta como enviado */ if (x.contadoPor === u) { marcar(c.folio, 'ok', null, x.estado); ok++; } else marcar(c.folio, 'revisar', 'El tag ya lo contó otra persona'); continue; } }
        await conTiempo(escribir(c), 8000); marcar(c.folio, 'ok', null, 'REGISTRADO'); ok++;
      } catch (e) { if (esPermiso(e) || /not-found/i.test(String(e.code || ''))) marcar(c.folio, 'revisar', String(e.code || e.message || e)); else break; }
    }
    reintentando = false; if (!silencio) toast('Envío', ok ? `${ok} caja(s) enviadas.` : 'No se pudieron enviar (revisa conexión o permisos de Firestore).', ok ? 'success' : 'warning');
  }
  /** Estado de bodega de MIS cajas (RECONTEO, ACEPTADO…): se trae del servidor; si el teléfono perdió una, se recupera. */
  async function sincronizarMias() {
    const u = usuario(); if (!u || navigator.onLine === false) return; const f = fsx();
    try { const sn = await conTiempo(f.getDocs(f.query(f.collection(dbx(), COL), f.where('contadoPor', '==', u), f.limit(1000))), 8000), l = cajas(); let cambio = false;
      sn.forEach(x => { const d = x.data(), c = l.find(y => y.folio === x.id); if (!c) { l.push({ folio: x.id, doc: d, estado: 'ok', srv: d.estado }); cambio = true; } else if (c.estado === 'ok' && (c.srv !== d.estado || c.doc.huella !== d.huella)) { c.srv = d.estado; c.doc = d; cambio = true; } });
      if (cambio) { setCajas(l); if (mostrar && ['p0', 'resumen'].includes(bor().vista)) repintar(); } } catch (e) { /* sin conexión */ }
  }
  function corregir(d) { const p3 = respuestasDe(d.estructura); ir('p4', { folio: d.folio, bodega: (bodegas || []).find(b => b.name === d.bodega || b.id === d.bodegaId) || bodega(), prod: { insumoId: d.insumoId || null, nombre: d.nombre, nuevo: !!d.nuevo, tipo: d.tipo || null, controlado: d.controlado || null, codigoMP: '' }, lote: d.lote, elaboracion: d.elaboracion || '', vence: d.vence, sinLote: !!d.sinLote, estructura: d.estructura, p3, p3prev: p3, editando: true, orig: d, usado: null, hist: [] }); }
  async function preparar(btn) {
    btn.disabled = true; btn.textContent = 'Descargando…';
    try { bodegas = null; await cargarBodegas(); const l = await cargarInsumos(true); await cargarConteos(bodega()); await cargarTags().catch(() => {}); cargarLibQR().catch(() => {}); if (window.SAR_Imagenes && window.SAR_Imagenes.cargar) window.SAR_Imagenes.cargar().catch(() => {});
      toast('Listo sin internet', `${l.length} productos y sus lotes quedaron en el teléfono.`, 'success'); }
    catch (e) { toast('Sin conexión', 'Para preparar el teléfono necesitas internet.', 'warning'); }
    repintar();
  }

  /** Eventos delegados en el contenedor de la página (una sola vez). */
  function enlazar(r) {
    if (!r || r.dataset.lv) return; r.dataset.lv = '1';
    const leerElab = () => { const el = document.getElementById('lv-elab'); return el ? String(el.value || '').trim() : ''; };
    r.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t || !mostrar) return; const ds = t.dataset, dr = bor();
      if (t.hasAttribute('data-lv-salir')) { mostrar = false; repintar(); }
      else if (ds.lvIr) { if (ds.lvIr === 'p0') dr.vistaAntes = dr.vista; if (ds.lvIr === 'p1') busca = ''; if (ds.lvIr === 'resumen') sincronizarMias(); ir(ds.lvIr, ds.lvIr === 'p0' ? { vistaAntes: dr.vista === 'p0' ? dr.vistaAntes : dr.vista } : null); }
      else if (t.hasAttribute('data-lv-seguir')) ir(dr.vistaAntes || 'p1');
      else if (t.hasAttribute('data-lv-cam')) escanear();
      else if (t.hasAttribute('data-lv-prep')) preparar(t);
      else if (t.hasAttribute('data-lv-otro')) { ir('p0', { folio: '', usado: null }); escanear(); }
      else if (t.hasAttribute('data-lv-corregir')) { if (dr.usado) corregir({ ...dr.usado, folio: dr.folio }); }
      else if (ds.lvRecontar) { const c = cajas().find(x => x.folio === ds.lvRecontar); if (c) corregir(c.doc); }
      else if (t.hasAttribute('data-lv-mismo-otro')) { const u = ls.get(K_ULT); if (u && u.prod) { otroLote = true; ir('p2', { prod: u.prod, elaboracion: '', ol: {} }); } }
      else if (t.hasAttribute('data-lv-mismo')) { const u = ls.get(K_ULT); if (u && u.prod) aP3({ prod: u.prod, lote: u.lote, elaboracion: u.elaboracion || '', vence: u.vence, sinLote: !!u.sinLote, prodDesdeUlt: true }); }
      else if (ds.lvProd) elegirProducto(ds.lvProd);
      else if (t.hasAttribute('data-lv-nuevo')) ir('nuevo', { nuevoForm: { nombre: busca, tipo: '' } });
      else if (ds.lvTipo) { const n = { ...(dr.nuevoForm || {}), nombre: (document.getElementById('lv-nn') || {}).value || '', tipo: ds.lvTipo }; if (n.tipo !== 'medicamento') delete n.ctl; ir('nuevo', { nuevoForm: n }); }
      else if (ds.lvCtl) { const n = { ...(dr.nuevoForm || {}), nombre: (document.getElementById('lv-nn') || {}).value || '', ctl: ds.lvCtl }; ir('nuevo', { nuevoForm: n }); }
      else if (t.hasAttribute('data-lv-nuevo-ok')) { const n = { ...(dr.nuevoForm || {}), nombre: String((document.getElementById('lv-nn') || {}).value || '').trim().toUpperCase() };
        if (n.nombre.length < 4) { toast('Nombre', 'Escribe el nombre como dice la caja.', 'warning'); return; } if (!n.tipo) { toast('Tipo', 'Elige el tipo del producto.', 'warning'); return; }
        if (n.tipo === 'medicamento' && !n.ctl) { toast('Controlado', 'Indica si es controlado (o «No sé»).', 'warning'); return; }
        /* Sí = controlado (bodega define si es estupefaciente o psicotrópico); No sé = 'revisar' */
        otroLote = true; ir('p2', { prod: { insumoId: null, nombre: n.nombre.slice(0, 120), nuevo: true, tipo: n.tipo, controlado: n.tipo === 'medicamento' ? ({ si: 'controlado', revisar: 'revisar' }[n.ctl] || null) : null, codigoMP: '' }, elaboracion: '', ol: {}, nuevoForm: n }); }
      else if (ds.lvLote !== undefined) { const p = dr.prod, reg = p.insumoId ? (insumos || []).find(i => i.id === p.insumoId && esDeBodega(i, dr.bodega)) : (insumos || []).find(i => esDeBodega(i, dr.bodega) && norm(i.name) === norm(p.nombre)); const x = lotesCombinados(reg, p.nombre, p.insumoId, dr.bodega)[+ds.lvLote]; if (!x) return; aP3({ lote: x.lote, elaboracion: leerElab() || x.elaboracion || dr.elaboracion || '', vence: /^\d{4}-\d{2}$/.test(x.mes) ? x.mes : 'N/A', sinLote: x.lote === 'S/L' && x.mes === 'N/A', prodDesdeUlt: false }); }
      else if (t.hasAttribute('data-lv-otrolote')) { otroLote = true; repintar(); }
      else if (ds.lvMes || ds.lvAnio) { const ol = { ...(dr.ol || {}), lote: (document.getElementById('lv-lote') || {}).value || (dr.ol || {}).lote || '', elaboracion: leerElab() || (dr.ol || {}).elaboracion || '' }; if (ds.lvMes) ol.mes = ds.lvMes; if (ds.lvAnio) ol.anio = ds.lvAnio; dr.ol = ol; dr.elaboracion = ol.elaboracion; setBor(dr); repintar(); }
      else if (t.hasAttribute('data-lv-sl') || t.hasAttribute('data-lv-conlote')) { dr.ol = { ...(dr.ol || {}), sl: t.hasAttribute('data-lv-sl'), elaboracion: leerElab() || (dr.ol || {}).elaboracion || '' }; setBor(dr); repintar(); }
      else if (t.hasAttribute('data-lv-ol-ok')) { const elab = leerElab() || (dr.ol || {}).elaboracion || '', ol = { ...(dr.ol || {}), lote: String((document.getElementById('lv-lote') || {}).value || '').trim().toUpperCase(), elaboracion: elab };
        if (ol.sl) { if (!ol.mes || !ol.anio) { toast('Vencimiento', 'Elige el mes y el año de vencimiento (o «Sin lote ni vencimiento»).', 'warning'); return; } aP3({ lote: 'S/L', elaboracion: elab, vence: `${ol.anio}-${ol.mes}`, sinLote: true, ol, prodDesdeUlt: false }); return; }
        if (!ol.lote) { toast('Lote', 'Escribe el lote, o toca «Sin lote».', 'warning'); return; } if (!ol.mes || !ol.anio) { toast('Vencimiento', 'Elige el mes y el año de vencimiento.', 'warning'); return; }
        aP3({ lote: ol.lote, elaboracion: elab, vence: `${ol.anio}-${ol.mes}`, sinLote: false, ol, prodDesdeUlt: false }); }
      else if (t.hasAttribute('data-lv-sinlote')) aP3({ lote: 'S/L', elaboracion: leerElab() || dr.elaboracion || '', vence: 'N/A', sinLote: true, prodDesdeUlt: false });
      else if (ds.lvResp !== undefined) responder(ds.lvResp);
      else if (ds.lvTk) { const p = { ...(dr.p3 || {}) }; let v = String(p.tmp || ''); if (ds.lvTk === 'OK') { responder(''); return; } if (ds.lvTk === '⌫') v = v.slice(0, -1); else v = (v === '0' || p.pre ? '' : v) + ds.lvTk; if (v.length > 7) return; p.tmp = v; p.pre = false; dr.p3 = p; setBor(dr); const o = document.getElementById('lv-disp'); if (o) o.textContent = v || '0'; }
      else if (ds.lvMas) { const p = { ...(dr.p3 || {}) }; p.tmp = String(Math.min(TOPE, ent(p.tmp) + ent(ds.lvMas))); p.pre = false; dr.p3 = p; setBor(dr); const o = document.getElementById('lv-disp'); if (o) o.textContent = p.tmp; }
      else if (t.hasAttribute('data-lv-atras')) atras();
      else if (t.hasAttribute('data-lv-corr')) ir('p3', { p3: { ...(dr.p3prev || {}), paso: 'estado', tmp: null }, hist: [] });
      else if (t.hasAttribute('data-lv-guardar')) guardar();
      else if (t.hasAttribute('data-lv-sig')) { ir('p0', { folio: '', guardado: null, prod: null, vistaAntes: '' }); escanear(); }   /* Penny: directo a la cámara */
      else if (t.hasAttribute('data-lv-reint')) reintentar(false).then(repintar);
      else if (t.hasAttribute('data-lv-reint-rev')) reintentar(false, true).then(repintar);
    });
    r.addEventListener('submit', async (e) => {
      if (!mostrar) return; const fm = e.target;
      if (fm.hasAttribute('data-lv-login')) { e.preventDefault(); const c = document.getElementById('lv-c').value, p = document.getElementById('lv-p').value, er = document.getElementById('lv-err'), bt = fm.querySelector('button'); bt.disabled = true; bt.textContent = 'Ingresando…';
        try { await window.SAR_Sesion.entrar(c, p); } catch (x) { const k = String(x.code || ''); if (er) er.textContent = k === 'network' || /network/.test(k) ? 'Sin internet: la primera vez necesitas conexión.' : k === 'pendientes' ? x.message : 'Correo o contraseña incorrectos.'; bt.disabled = false; bt.textContent = 'Ingresar'; } }
      else if (fm.hasAttribute('data-lv-num')) { e.preventDefault(); const v = document.getElementById('lv-num').value, fo = folioTag(v); if (!fo) { toast('Número del tag', 'Escribe el número que está impreso en el tag.', 'warning'); return; }
        const corto = /^\s*(N°?\s*)?\d{1,6}\s*$/i.test(v), anio = new Date().getFullYear(); abrirTag(fo, corto ? [folioTag(v, anio - 1)] : []); }
    });
    r.addEventListener('input', (e) => {
      if (!mostrar) return;
      if (e.target.id === 'lv-bus') { busca = e.target.value; const box = document.getElementById('lv-res'); if (box) { box.innerHTML = resHTML(buscar(catalogo(bor().bodega), busca), window.SAR_Imagenes); if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(box); } }
      else if (e.target.id === 'lv-nn') { const dr = bor(); dr.nuevoForm = { ...(dr.nuevoForm || {}), nombre: e.target.value }; setBor(dr); const sg = document.getElementById('lv-nn-sug'); if (sg) sg.innerHTML = sugNuevoHTML(e.target.value, dr.bodega); }
      else if (e.target.id === 'lv-lote') { const dr = bor(); dr.ol = { ...(dr.ol || {}), lote: e.target.value }; setBor(dr); }
      else if (e.target.id === 'lv-elab') { const dr = bor(); dr.elaboracion = e.target.value; dr.ol = { ...(dr.ol || {}), elaboracion: e.target.value }; setBor(dr); }
    });
    r.addEventListener('change', (e) => {
      if (!mostrar) return;
      if (e.target.id === 'lv-elab') { const dr = bor(); dr.elaboracion = e.target.value; dr.ol = { ...(dr.ol || {}), elaboracion: e.target.value }; setBor(dr); return; }
      if (e.target.id !== 'lv-bod') return; const b = (bodegas || []).find(x => x.id === e.target.value) || null;
      if (b) ls.set(K_BOD, b); else ls.del(K_BOD); cargarConteos(b).catch(() => {}); repintar(); if (b && pendTag) abrirTag(pendTag);
    });
  }
  /** Enlace propio «Conteo e ingreso» (solicitar.html?modo=contar o #contar): abre directo el conteo. */
  const esEnlaceConteo = () => { try { return /(?:^|[?&])modo=contar\b/.test(location.search || '') || /^#contar\b/.test(location.hash || ''); } catch (e) { return false; } };
  function leerHash() { if (esEnlaceConteo()) mostrar = true; const m = /[#&](?:tag|t)=([^&]+)/.exec(location.hash || ''); if (!m) return; let v = ''; try { v = decodeURIComponent(m[1]); } catch (e) { v = m[1]; } const fo = folioTag(v); if (fo) { pendTag = fo; mostrar = true; try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* nada */ } } }

  if (typeof document.addEventListener === 'function' && typeof window.addEventListener === 'function' && typeof location !== 'undefined') {
    leerHash();
    window.addEventListener('hashchange', () => { leerHash(); if (pendTag) repintar(); });
    let n = 0; const tm = setInterval(() => { n++; const r = document.getElementById('si-pide'); if (r && window.SAR_SOLICITUD_PUBLICA === true) { enlazar(r); clearInterval(tm); } else if (n > 480) clearInterval(tm); }, 250);
    window.addEventListener('sar-rol', async () => {
      bodegas = null; const u = usuario(); nombreUsuario = '';
      if (!u) { ls.del(K_INS); ls.del(K_TAGS); insumos = null; insumosAl = ''; }   /* sesión cerrada: se borra la copia de productos del teléfono (no la caché de Firestore) */
      if (rol() === 'contador') mostrar = true;
      if (u) { try { const f = fsx(), s = await conTiempo(f.getDoc(f.doc(f.collection(dbx(), 'Usuarios'), u)), 4000); if (s.exists()) nombreUsuario = String(s.data().nombre || s.data().name || ''); } catch (e) { /* sin nombre: se usa el correo */ } }
      if (mostrar) repintar();
    });
    window.addEventListener('online', () => { if (usuario()) reintentar(true).then(() => sincronizarMias()).catch(() => {}); });
  }

  const api = { abrir, pintar, enCurso, totalEstructura, formula, estructuraCorta, folioTag, vencido, validar, avanceLotes, siguientePaso, estructuraDe, respuestasDe, armarDoc, resumen, delTurno, lotesDe, huella, baseDe, cambiosDe };
  window.SAR_Lev = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
