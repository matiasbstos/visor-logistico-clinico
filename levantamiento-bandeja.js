/* ==========================================================================
   LEVANTAMIENTOS POR APROBAR (PR2+PR3 del levantamiento) — DECISIONES 4.307
   Inventario → «Levantamientos por aprobar» (admin y superadmin).
   · Muestra en vivo los Conteos_Cajas REGISTRADO/RECONTEO agrupados por bodega → producto → lote, con lo que
     marcaba el sistema al contar (baseSistema), lo que hay ahora, lo contado y la diferencia.
   · Aceptar = UNA transacción por producto y bodega: lee el producto una vez, valida cada caja (REGISTRADO + huella vista),
     reclasifica S/L, suma altas y sobras, deja los faltantes como Solicitudes_Ajuste (no descuenta), salda la deuda,
     escribe el historial, el registro por lote del LEV y convierte el tag en la BUL real (más sus interiores). Todo o nada.
   · Modo «caja por caja»: solo lotes sin saldo previo y sin S/L del producto. Con saldo previo o S/L, el encargado marca
     «Producto contado completo» (lo no contado de ese producto cuenta como 0 → faltante).
   · Registro por lote: Levantamientos/<LEV>/lotes/<insumo|lote|mes> = {base, contadoAceptado, aplicado, vistos, n}.
     Se aplica max(0, contadoAceptado + total − base) − aplicado. El lote debe estar en base + aplicado (si no: «movido»).
   · Sin internet no se acepta. Quien contó no acepta su propia caja (salvo el superadmin, que queda marcado).
   · SAR_LevBandeja.pendientesDe(insumoId|nombre, bodega, lote, mes): cajas aún sin aceptar de ese lote (para Ingresos).
   ========================================================================== */
(function (window, document) {
  'use strict';
  const COL = 'Conteos_Cajas', PEND = ['REGISTRADO', 'RECONTEO'];
  const esc = (s) => (window.escapeHTML ? window.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const ent = (v) => Math.max(0, Math.floor(num(v)));
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const T = () => window.SAR_Toma;
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || ''; };
  const rol = () => String((document.body && document.body.dataset && document.body.dataset.userRole) || '').toLowerCase();
  const ADMIN = ['admin', 'superadmin', 'administrador', 'global'];
  const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); };
  const nTag = (folio) => String(folio || '').slice(-6);
  const mesCL = (v) => { const m = /^(\d{4})-(\d{2})$/.exec(v || ''); return m ? `${m[2]}/${m[1]}` : 'sin venc.'; };
  const hora = (iso) => { try { return iso ? new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; } catch (e) { return ''; } };
  const E = (tipo, msg, extra) => Object.assign(new Error(msg), { tipo }, extra || {});

  // ---------------- lógica pura ----------------
  const claveCaja = (c) => T().clave(c.lote, c.vence);
  const esSL = (lote) => T().lote(lote) === 'S/L';
  /** La caja volvió a contarse después de que bodega pidió reconteo (sirve de doble conteo / confirmación de falta o sobra grande). */
  const recontada = (c) => !!(c && c.reconteoEn && c.estado === 'REGISTRADO' && c.editadoEn && String(c.editadoEn) > String(c.reconteoEn));
  /** Lotes del registro de Insumos tal como están (sin lista → el stock queda como su lote o S/L, igual que el ajuste). */
  function lotesDoc(d) {
    if (!d) return [];
    const l = Array.isArray(d.batches) ? d.batches.map(b => ({ ...b, quantity: num(b.quantity) })) : [];
    if (!l.length && (d.batch || num(d.quantity) > 0)) l.push({ batch: d.batch || 'S/L', quantity: num(d.quantity), expirationDate: d.expirationDate || '' });
    return l;
  }
  const productoKey = (c) => (c.nombreNorm || norm(c.nombre)) + '|' + (c.bodegaId || norm(c.bodega));
  /** Cajas pendientes (REGISTRADO o RECONTEO) agrupadas por bodega → producto. */
  function agrupar(cajas) {
    const bods = new Map();
    (cajas || []).filter(c => c && PEND.includes(c.estado)).forEach(c => {
      const bk = c.bodega || '(sin bodega)', b = bods.get(bk) || { bodega: bk, bodegaId: c.bodegaId || '', productos: new Map(), cajas: 0 };
      const k = productoKey(c), p = b.productos.get(k) || { key: k, bodega: bk, bodegaId: c.bodegaId || '', nombre: c.nombre, nombreNorm: c.nombreNorm || norm(c.nombre), nuevo: false, controlado: null, insumoId: null, cajas: [] };
      p.cajas.push(c); if (c.nuevo) p.nuevo = true; if (c.controlado) p.controlado = c.controlado; if (!p.insumoId && c.insumoId) p.insumoId = c.insumoId;
      b.productos.set(k, p); b.cajas++; bods.set(bk, b);
    });
    return bods;
  }
  /**
   * planificar(p) — el corazón de la aceptación (lo usa la vista previa y la transacción con los datos leídos en ella).
   * p = { doc (Insumos o null), cajas (docs actuales de las cajas a aceptar), regs {clave: registro del LEV}, modo 'caja'|'completo',
   *       esSuper, yo, huellas {folio: huella vista}, confirmaFaltas, slVisto, deudaVista, vista {clave: cantidad al mostrarse} }
   * → { errores:[Error con .tipo], lineas, batches, quantity, delta, deuda, resumen }
   */
  function planificar(p) {
    const Tm = T(), o = p || {}, doc = o.doc || null, cajas = o.cajas || [], regs = o.regs || {}, modo = o.modo === 'completo' ? 'completo' : 'caja', errores = [];
    const ctl = !!(o.controlado || cajas.some(c => c.controlado) || (doc && doc.controlado));
    if (modo === 'completo' && num(o.enReconteo) > 0) errores.push(E('modo', `Hay ${num(o.enReconteo)} caja(s) de este producto en reconteo: espera que vuelvan antes de marcarlo contado completo.`));
    cajas.forEach(c => {
      if (c.estado !== 'REGISTRADO') errores.push(E('estado', `Tag ${nTag(c.folio)}: está ${c.estado === 'RECONTEO' ? 'en reconteo' : String(c.estado || 'sin registro').toLowerCase()}.`, { folios: [c.folio], estadoCaja: c.estado, levCaja: c.lev || '' }));
      else if (o.huellas && o.huellas[c.folio] && o.huellas[c.folio] !== c.huella) errores.push(E('cambio', `Tag ${nTag(c.folio)}: el contador la corrigió mientras la revisabas. Vuelve a mirarla.`, { folios: [c.folio] }));
      if (o.yo && norm(c.contadoPor) === norm(o.yo) && !o.esSuper) errores.push(E('propia', `Tag ${nTag(c.folio)}: la contaste tú; la acepta otra persona (o el superadmin).`, { folios: [c.folio] }));
    });
    if (ctl && !o.esSuper) errores.push(E('super', 'Producto controlado: solo lo acepta el superadmin.'));
    if (ctl && cajas.some(c => c.estado === 'REGISTRADO' && !recontada(c))) errores.push(E('doble', 'Producto controlado: cada caja necesita doble conteo (pide reconteo a otra persona).', { folios: cajas.filter(c => !recontada(c)).map(c => c.folio) }));
    const raw = lotesDoc(doc), S = Tm.agrupar(raw), ahoraDe = (k) => S.has(k) ? S.get(k).quantity : 0;
    const porClave = new Map(); cajas.forEach(c => { const k = claveCaja(c); if (!porClave.has(k)) porClave.set(k, []); porClave.get(k).push(c); });
    const lineas = [];
    porClave.forEach((cs, k) => {
      const reg = regs[k] || null, a = ahoraDe(k), aplicado = reg ? num(reg.aplicado) : 0; let base;
      if (ctl) base = reg ? num(reg.base) : (o.vista ? ent(o.vista[k]) : null);   /* controlados: el teléfono no guarda lo que marcaba el sistema → lo que se mostró (lote que no se mostró = 0) */
      else {
        const bs = cs.map(c => c.baseSistema == null ? 0 : ent(c.baseSistema));
        if (reg) { base = num(reg.base); const vs = Array.isArray(reg.vistos) ? reg.vistos : [0]; if (bs.some(b => !vs.includes(b - base))) base = NaN; }   /* contada después de aceptar otra caja del lote: su base incluye lo ya aplicado */
        else { base = bs[0]; if (bs.some(b => b !== base)) base = NaN; }
      }
      const malBase = base == null || isNaN(base);
      if (malBase || a !== base + aplicado) errores.push(E('movido', `Lote ${Tm.lote(cs[0].lote)} ${mesCL(Tm.mes(cs[0].vence))}: movido después del conteo (${malBase ? 'las cajas se contaron con el sistema distinto' : `esperaba ${base + aplicado}, hay ${a}`}). Recontar.`, { clave: k, folios: cs.map(c => c.folio) }));
      const nuevas = cs.reduce((t, c) => t + ent(c.total), 0);
      lineas.push({ clave: k, lote: Tm.lote(cs[0].lote), vence: Tm.mes(cs[0].vence), base: malBase ? null : base, aplicado, ahora: a, contadoAntes: reg ? num(reg.contadoAceptado) : 0, contado: (reg ? num(reg.contadoAceptado) : 0) + nuevas, nuevas, folios: cs.map(c => c.folio), cajas: cs, sl: esSL(cs[0].lote), alta: 0, sobra: 0, falta: 0, reclasIn: [], reclasOut: 0, reg });
    });
    let deuda = null;
    if (modo === 'caja') {
      lineas.forEach(l => { if (l.base !== 0 && l.base != null) errores.push(E('modo', `Lote ${l.lote}: ya tenía ${l.base} u. en el sistema. Marca «Producto contado completo».`, { clave: l.clave })); });
      S.forEach((s, k) => { if (s.batch === 'S/L' && s.quantity > 0 && !(regs[k] && num(regs[k].base) === 0)) errores.push(E('modo', `Hay ${s.quantity} u. sin lote (S/L) de este producto en la bodega: marca «Producto contado completo» para reclasificarlas.`, { clave: k })); });
      lineas.forEach(l => { if (l.base === 0) l.alta = Math.max(0, Math.max(0, l.contado - l.base) - l.aplicado); });
    } else {
      const contadas = new Set(lineas.map(l => l.clave));
      S.forEach((s, k) => { if (contadas.has(k) || !(s.quantity > 0)) return; const reg = regs[k] || null; lineas.push({ clave: k, lote: s.batch, crudo: s.crudo, vence: s.vence, base: reg ? num(reg.base) : s.quantity, aplicado: reg ? num(reg.aplicado) : 0, ahora: s.quantity, contadoAntes: 0, contado: 0, nuevas: 0, folios: [], cajas: [], sl: s.batch === 'S/L', sinContar: true, alta: 0, sobra: 0, falta: 0, reclasIn: [], reclasOut: 0, reg }); });
      lineas.forEach(l => { l.exceso = Math.max(0, l.contado - l.ahora); l.corto = Math.max(0, l.ahora - l.contado); });
      /* lo contado con lote consume primero el S/L del sistema (sin cambiar el total) */
      const pool = lineas.filter(l => l.sl && l.corto > 0);
      lineas.filter(l => !l.sl && l.exceso > 0).sort((a, b) => String(a.vence).localeCompare(String(b.vence))).forEach(l => {
        pool.forEach(s => { const t = Math.min(s.corto, l.exceso); if (!(t > 0)) return; s.corto -= t; s.reclasOut += t; l.exceso -= t; l.reclasIn.push({ de: s.clave, deLote: s.crudo || s.lote, q: t }); });
      });
      const usaSL = lineas.filter(l => l.sinContar && l.sl && l.reclasOut > 0);
      usaSL.filter(l => l.reg).forEach(l => { if (l.ahora !== num(l.reg.base) + num(l.reg.aplicado)) errores.push(E('movido', `El S/L de este producto se movió después del conteo (esperaba ${num(l.reg.base) + num(l.reg.aplicado)}, hay ${l.ahora}). Recontar.`, { clave: l.clave })); });
      const libres = usaSL.filter(l => !l.reg);
      if (libres.length) {
        const hay = libres.reduce((t, l) => t + l.ahora, 0), bsl = cajas.map(c => c.baseSL);
        let esperado = null;
        if (!ctl && bsl.length && bsl.every(v => v != null && v === bsl[0])) {
          const conReg = [...S.keys()].filter(k => S.get(k).batch === 'S/L' && regs[k]).reduce((t, k) => t + num(regs[k].base), 0);
          const contadasSinReg = lineas.filter(l => l.sl && !l.sinContar && !l.reg && l.base != null).reduce((t, l) => t + l.base, 0);
          esperado = ent(bsl[0]) - conReg - contadasSinReg;
        } else if (o.slVisto != null) esperado = ent(o.slVisto);   /* cajas contadas antes de 4.307 (sin baseSL): lo que se mostró */
        if (esperado == null || esperado !== hay) errores.push(E('movido', `El stock sin lote (S/L) cambió después del conteo (${esperado == null ? 'las cajas no coinciden' : `esperaba ${esperado}, hay ${hay}`}). Recontar.`, { clave: libres[0].clave }));
      }
      lineas.forEach(l => {
        if (l.exceso > 0) { if (l.base === 0) l.alta = l.exceso; else l.sobra = l.exceso; }
        if (l.corto > 0) l.falta = l.corto;
        if (l.sobra && Tm.requiereReconteo({ delta: l.sobra, sistema: l.base }, { controlado: ctl }) && !l.cajas.some(recontada)) errores.push(E('reconteo', `Lote ${l.lote}: sobran ${l.sobra} u. sobre ${l.base} (más del 5 % o de 10 u.). Pide reconteo antes de aceptar.`, { clave: l.clave, folios: l.folios }));
        if (l.falta) {
          if (!o.confirmaFaltas) errores.push(E('falta', `Lote ${l.lote}${l.sinContar ? ' (no contado)' : ''}: faltan ${l.falta} u. Pide reconteo a otra persona; si se confirma, marca «Confirmo los faltantes».`, { clave: l.clave, folios: l.folios }));
          else if (!l.sinContar && !l.cajas.some(recontada) && !o.esSuper) errores.push(E('falta', `Lote ${l.lote}: faltan ${l.falta} u. y nadie lo ha recontado. Pide reconteo antes de confirmar.`, { clave: l.clave, folios: l.folios }));
        }
      });
      const sg = num(doc && doc.sobregiro);
      if (sg > 0) {
        const ds = cajas.map(c => c.deudaSistema).filter(v => v != null), esp = ds.length === cajas.length && ds.every(v => ent(v) === ent(ds[0])) ? ent(ds[0]) : (o.deudaVista != null ? ent(o.deudaVista) : null);
        if (esp !== sg) errores.push(E('deuda', `La deuda (sobregiro) del producto cambió desde el conteo (${esp == null ? 'las cajas no coinciden' : `era ${esp}`}, ahora ${sg}). Recontar.`));
        else deuda = { saldar: sg };
      }
    }
    /* lotes finales */
    let bt = raw.map(b => ({ ...b }));
    const sumar = (k, q, lote, vence) => { const i = bt.findIndex(b => Tm.clave(b.batch, b.expirationDate) === k); if (i >= 0) bt[i].quantity = num(bt[i].quantity) + q; else bt.push({ batch: lote, quantity: q, expirationDate: vence === 'N/A' ? '' : vence }); };
    const restar = (k, q) => { let r = q; bt.forEach(b => { if (r <= 0 || Tm.clave(b.batch, b.expirationDate) !== k) return; const t = Math.min(num(b.quantity), r); b.quantity = num(b.quantity) - t; r -= t; }); if (r > 0) errores.push(E('movido', 'El S/L no alcanza para reclasificar: recontar.', { clave: k })); };
    lineas.forEach(l => { l.reclasIn.forEach(r => { restar(r.de, r.q); sumar(l.clave, r.q, l.lote, l.vence); }); if (l.alta) sumar(l.clave, l.alta, l.lote, l.vence); if (l.sobra) sumar(l.clave, l.sobra, l.lote, l.vence); });
    bt = bt.filter(b => num(b.quantity) > 0); if (typeof window.fefoCompare === 'function') { try { bt.sort(window.fefoCompare); } catch (e) { /* sin fechas */ } }
    const movidos = new Set(errores.filter(e => e.tipo === 'movido' && e.clave).map(e => e.clave));   /* un lote movido se recuenta: sus avisos de sobra/falta no sirven */
    for (let i = errores.length - 1; i >= 0; i--) if (errores[i].tipo !== 'movido' && errores[i].clave && movidos.has(errores[i].clave)) errores.splice(i, 1);
    const delta = lineas.reduce((t, l) => t + l.alta + l.sobra, 0);
    const resumen = { cajas: cajas.length, unidades: cajas.reduce((t, c) => t + ent(c.total), 0), altas: lineas.reduce((t, l) => t + l.alta, 0), sobras: lineas.reduce((t, l) => t + l.sobra, 0), reclas: lineas.reduce((t, l) => t + l.reclasOut, 0), faltas: lineas.reduce((t, l) => t + l.falta, 0) };
    return { errores, lineas, batches: bt, quantity: num(doc && doc.quantity) + delta, delta, deuda, ctl, modo, resumen };
  }
  /** Estado de un lote para la pantalla: movido · alta · reclasificar · sobra · falta · coincide. */
  function estadoLinea(l, errores) {
    if ((errores || []).some(e => e.tipo === 'movido' && e.clave === l.clave)) return 'movido';
    if (l.reclasIn && l.reclasIn.length) return 'reclasificar';
    if (l.alta) return 'alta'; if (l.sobra) return 'sobra'; if (l.falta) return 'falta';
    if (l.base === 0 && l.contado > 0) return 'alta';
    if (l.contado > l.ahora) return l.base === 0 ? 'alta' : 'sobra';
    if (l.contado < l.ahora) return l.sinContar && l.sl && l.reclasOut >= l.ahora ? 'reclasificar' : 'falta';
    return 'coincide';
  }
  /** Registros por lote después de aplicar (Levantamientos/<LEV>/lotes/…). */
  function registrosNuevos(plan, insumoId, ahoraISO) {
    const out = {};
    plan.lineas.forEach(l => {
      const mov = l.alta + l.sobra + l.reclasIn.reduce((t, r) => t + r.q, 0) - l.reclasOut;
      if (!l.nuevas && !mov && !l.falta) return;   /* un faltante también deja registro: el siguiente usa otro N° de solicitud */
      const r = l.reg || { base: l.base == null ? l.ahora : l.base, contadoAceptado: 0, aplicado: 0, vistos: [0], n: 0 };
      const aplicado = num(r.aplicado) + mov, vistos = [...new Set([...(Array.isArray(r.vistos) ? r.vistos : [0]), aplicado])].slice(-60);
      out[l.clave] = { insumoId, clave: l.clave, lote: l.lote, vence: l.vence, base: num(r.base), contadoAceptado: num(r.contadoAceptado) + l.nuevas, aplicado, vistos, n: num(r.n) + 1, cajas: [...new Set([...(r.cajas || []), ...l.folios])].slice(-300), actualizadoEn: ahoraISO };
    });
    return out;
  }
  /** Etiquetas BUL de una caja aceptada: el tag pasa a ser la caja grande; interiores (y la bolsa GRANEL de sueltas) con folios reservados. */
  function bultosDe(c, o) {
    const e = c.estructura || { estado: 'CERRADA', interiores: [], sueltas: 0 }, ints = Array.isArray(e.interiores) ? e.interiores : [], sue = ent(e.sueltas), total = ent(c.total);
    const hijosSpec = ints.map(i => ({ q: ent(i.q), abierta: !!i.abierta })).concat(ints.length && sue > 0 ? [{ q: sue, granel: true }] : []);
    const fol = (o.hijos || []).slice(0, hijosSpec.length); if (fol.length < hijosSpec.length) throw E('folios', `Faltan folios para las cajas interiores del tag ${nTag(c.folio)}.`);
    const cerr = ints.filter(i => !i.abierta).map(i => ent(i.q)), cap = cerr.length ? Math.max(...cerr) : null, granelSolo = e.estado === 'ABIERTA' && !ints.length;
    const det = window.SAR_TagsConteo && window.SAR_TagsConteo.estructuraCorta ? window.SAR_TagsConteo.estructuraCorta(e) : '';
    const comun = { tipo: 'bulto', grupo: c.folio, nombre: o.nombre, insumoId: o.insumoId, codigoMP: o.codigoMP || '', bodega: c.bodega, lote: T().lote(c.lote), vence: c.vence === 'N/A' ? '' : c.vence, proveedor: '', oc: '', rec: o.lev, lev: o.lev, origen: 'levantamiento', fechaRecepcion: String(o.ahora || '').slice(0, 10), creadoEn: o.ahora, creadoPor: o.por, impresiones: 0, totalGrupo: total, historial: [{ accion: 'CREADO', por: o.por, en: o.ahora, desde: 'tag CONTADO', lev: o.lev }] };
    const grande = { ...comun, folio: c.folio, estado: e.estado === 'ABIERTA' ? 'ABIERTA' : 'CERRADA', n: 1, de: 1, contenido: total, inicial: total, porCaja: total, copias: 2, detalle: det, contadoPor: c.contadoPor || '', ...(o.tagCreadoEn ? { tagCreadoEn: o.tagCreadoEn } : {}),
      ...(fol.length ? { hijos: fol, subcajas: fol.length, porSubcaja: cap || 0 } : {}), ...(granelSolo ? { granel: true, franja: 'GRANEL' } : {}) };
    const hijos = hijosSpec.map((h, j) => ({ ...comun, folio: fol[j], nivel: 'interior', padre: c.folio, padreN: 1, padreDe: 1, n: j + 1, de: fol.length, contenido: h.q, inicial: h.q, porCaja: cap || h.q,
      capacidad: h.abierta || h.granel ? cap : h.q, estado: h.abierta || h.granel ? 'ABIERTA' : 'CERRADA', ...(h.abierta ? { franja: 'ABIERTA – USAR PRIMERO' } : {}), ...(h.granel ? { granel: true, franja: 'GRANEL' } : {}) }));
    return [grande, ...hijos];
  }
  const nHijos = (c) => { const e = c.estructura || {}, ints = Array.isArray(e.interiores) ? e.interiores.length : 0; return ints + (ints && ent(e.sueltas) > 0 ? 1 : 0); };
  /** Cajas pendientes (sin aceptar) de un producto+bodega y, si se indica, de un lote y mes. */
  function pendientesEn(cajas, prod, bodega, lote, mes) {
    const Tm = T(), p = String(prod || ''), np = norm(p);
    return (cajas || []).filter(c => c && PEND.includes(c.estado) && (norm(c.bodega) === norm(bodega) || (c.bodegaId && c.bodegaId === bodega))
      && ((c.insumoId && c.insumoId === p) || (c.nombreNorm || norm(c.nombre)) === np)
      && (lote == null || lote === '' || Tm.lote(c.lote) === Tm.lote(lote)) && (mes == null || mes === '' || Tm.mes(c.vence) === Tm.mes(mes)));
  }
  /** IRA del LEV: lotes con saldo previo contados sin diferencia ÷ lotes con saldo previo. */
  function ira(lotes) { const c = (lotes || []).filter(l => num(l.base) > 0); if (!c.length) return null; return Math.round(1000 * c.filter(l => num(l.contadoAceptado) === num(l.base)).length / c.length) / 10; }

  // ---------------- datos ----------------
  const refCol = (...p) => fs().collection(db(), ...p);
  const refCaja = (folio) => fs().doc(refCol(COL), folio);
  const refTag = (folio) => fs().doc(refCol('Contadores'), 'bulto-' + folio);
  const refLevReg = (lev) => fs().doc(refCol('Contadores'), 'lev-' + lev);
  const refPtr = (bodega) => fs().doc(refCol('Contadores'), 'lev-abierto-' + (slug(bodega) || 'bodega'));
  const idReg = (insumoId, clave) => encodeURIComponent(insumoId + '|' + clave).replace(/\./g, '%2E');
  const refReg = (lev, insumoId, clave) => fs().doc(refCol('Levantamientos', lev, 'lotes'), idReg(insumoId, clave));
  const idMov = (lev, insumoId, clave, n) => `lev-${lev}-${insumoId}-${encodeURIComponent(clave)}-${n}`;
  async function enLinea() { try { if (window.SAR_Cola && window.SAR_Cola.hayConexion) return !!(await window.SAR_Cola.hayConexion()); } catch (e) { return false; } return typeof navigator === 'undefined' || navigator.onLine !== false; }
  const esDeBodega = (i, g) => !!i && ((i.bodegaId && g.bodegaId && i.bodegaId === g.bodegaId) || norm(i.location || i.bodegaNombre) === norm(g.bodega));

  /** LEV abierto de la bodega (o uno nuevo, LEV-AAAA-NNNNN con contador ctr-lev-AAAA). */
  async function levAbierto(bodega, bodegaId) {
    const f = fs(), F = window.SAR_Folio; if (!F) throw E('folio', 'Falta el módulo de correlativos.');
    return f.runTransaction(db(), async (tx) => {
      const ps = await tx.get(refPtr(bodega)), lev0 = ps.exists() ? ps.data().lev : null;
      if (lev0) { const r = await tx.get(refLevReg(lev0)); if (r.exists() && r.data().estado === 'abierto') return lev0; }
      const c = await F.leer(tx, 'LEV'), folio = F.escribir(tx, c), ahora = new Date().toISOString();
      tx.set(refPtr(bodega), { tipo: 'lev-abierto', bodega, bodegaId: bodegaId || '', lev: folio, en: ahora });
      tx.set(refLevReg(folio), { tipo: 'levantamiento', folio, bodega, bodegaId: bodegaId || '', estado: 'abierto', abiertoPor: usuario(), abiertoEn: ahora, cajas: 0, unidades: 0, productos: 0, aceptadoPor: [], altas: [], fichas: [], propias: [] });
      return folio;
    });
  }
  /** Dónde queda el stock: el registro del producto en esa bodega (o uno nuevo con id fijo lev_<nombre>__<bodega>). */
  async function resolverDestino(g, hom) {
    const f = fs(), D = db(), c0 = g.cajas[0] || {}, h = hom || g.homologar || null;
    if (g.nuevo && !h) throw E('homologar', `«${g.nombre}» es un producto nuevo: elige un producto del catálogo o «Crear ficha nueva».`);
    const crear = !!(h && h.tipo === 'ficha'), nombre = String(h && h.tipo === 'existente' && h.nombre ? h.nombre : (g.nombre || c0.nombre || '')).trim();
    let fuenteRef = null;
    if (!crear) {
      const id = h && h.tipo === 'existente' ? h.insumoId : c0.insumoId;
      if (id) { const s = await f.getDoc(f.doc(refCol('Insumos'), id)); if (s.exists()) { if (esDeBodega(s.data(), g) && s.data().status !== 'CUARENTENA') return { ref: s.ref || f.doc(refCol('Insumos'), id), fuenteRef: null, crear: false, nombre: s.data().name || nombre }; fuenteRef = f.doc(refCol('Insumos'), id); } }
      const q = await f.getDocs(f.query(refCol('Insumos'), f.where('name', '==', nombre), f.limit(20))), hit = (q.docs || []).find(x => esDeBodega(x.data(), g) && x.data().status !== 'CUARENTENA');
      if (hit) return { ref: hit.ref, fuenteRef: null, crear: false, nombre };
      if (!fuenteRef && q.docs && q.docs.length) fuenteRef = q.docs[0].ref;
    }
    return { ref: f.doc(refCol('Insumos'), `lev_${slug(nombre) || 'producto'}__${slug(g.bodega) || 'bodega'}`), fuenteRef, crear: crear || !fuenteRef, nombre: nombre.toUpperCase() };
  }
  /** Folios de las cajas interiores: se reservan ANTES de la transacción y se recuerdan por caja+huella (un reintento usa los mismos). */
  const reservas = new Map();
  async function reservarHijos(cajas) {
    const out = {}, faltan = cajas.filter(c => nHijos(c) > 0 && !reservas.has(c.folio + '|' + c.huella)), n = faltan.reduce((t, c) => t + nHijos(c), 0);
    if (n) { const B = window.SAR_Bultos; if (!B || !B.reservarFolios) throw E('folios', 'Falta el módulo de bultos.'); const r = await B.reservarFolios(n); let k = r.ini; faltan.forEach(c => { const l = []; for (let i = 0; i < nHijos(c); i++) l.push(`BUL-${r.anio}-${String(k++).padStart(6, '0')}`); reservas.set(c.folio + '|' + c.huella, l); }); }
    cajas.forEach(c => { out[c.folio] = reservas.get(c.folio + '|' + c.huella) || []; });
    return out;
  }
  /** Lee (fuera o dentro de una transacción) lo necesario para planificar. */
  async function leerTodo(get, destino, lev, cajasV, modo) {
    const sn = await get(destino.ref), doc = sn.exists() ? sn.data() : null, fuente = !doc && destino.fuenteRef ? await get(destino.fuenteRef) : null;
    const cajas = []; for (const c of cajasV) { const s = await get(refCaja(c.folio)); cajas.push(s.exists() ? { ...s.data(), folio: c.folio } : { folio: c.folio, estado: 'NO_EXISTE' }); }
    const claves = new Set(cajas.filter(c => c.lote).map(claveCaja)); lotesDoc(doc).forEach(b => { const k = T().clave(b.batch, b.expirationDate); if (modo === 'completo' || esSL(b.batch)) claves.add(k); });
    const regs = {}; for (const k of claves) { const r = await get(refReg(lev, destino.ref.id, k)); if (r.exists()) regs[k] = r.data(); }
    return { doc, fuente: fuente && fuente.exists() ? fuente.data() : null, cajas, regs };
  }
  /** Códigos de seguimiento (AJU para sobras y faltantes, CAM para reclasificar) — se piden antes, como en la toma. */
  async function codigos(plan) {
    const G = window.SAR_Gobernanza, P = window.SAR_Folio, pide = async (t) => (G && G.codigo ? await G.codigo(t).catch(() => null) : null) || (P ? P.provisional(t) : t + '-P');
    return { AJU: plan.resumen.sobras || plan.resumen.faltas ? await pide('AJU') : null, CAM: plan.resumen.reclas ? await pide('CAM') : null };
  }

  /**
   * Acepta cajas de un producto en una bodega. g = grupo de agrupar() (o {bodega, bodegaId, nombre, nuevo, cajas}).
   * o = { modo 'caja'|'completo', folios (subconjunto), homologar {tipo:'existente', insumoId, nombre}|{tipo:'ficha'}, confirmaFaltas, slVisto, deudaVista, vista, esSuper, lev }
   */
  async function aceptar(g, opc) {
    const o = opc || {}, f = fs(), D = db(), Tm = T();
    if (!(await enLinea())) throw E('red', 'Sin internet no se acepta: vuelve a intentarlo con conexión.');
    const yo = usuario(), esSuper = o.esSuper != null ? !!o.esSuper : rol() === 'superadmin', modo = o.modo === 'completo' ? 'completo' : 'caja';
    const vistas = (g.cajas || []).filter(c => !o.folios || o.folios.includes(c.folio)); if (!vistas.length) throw E('vacio', 'No hay cajas para aceptar.');
    const huellas = {}; vistas.forEach(c => { huellas[c.folio] = c.huella; });
    const destino = await resolverDestino(g, o.homologar);
    let lev = o.lev || await levAbierto(g.bodega, g.bodegaId);
    const base = { modo, esSuper, yo, huellas, confirmaFaltas: !!o.confirmaFaltas, slVisto: o.slVisto, deudaVista: o.deudaVista, vista: o.vista, controlado: g.controlado, enReconteo: (g.cajas || []).filter(c => c.estado === 'RECONTEO').length };
    const yaEstaba = (cs) => cs.length && cs.every(c => c.estado === 'ACEPTADO' || c.estado === 'ETIQUETADO') ? Object.assign(new Error('Ya estaba aceptado.'), { ya: true, lev: cs[0].lev || lev }) : null;   /* reintento de una aceptación que sí quedó */
    /* vista previa fuera de la transacción: avisa rápido y dice qué códigos se necesitan */
    const pre = await leerTodo((r) => f.getDoc(r), destino, lev, vistas, modo); if (yaEstaba(pre.cajas)) return { lev: pre.cajas[0].lev || lev, ya: true };
    const p0 = planificar({ ...base, doc: pre.doc, cajas: pre.cajas, regs: pre.regs });
    if (p0.errores.length) throw juntar(p0.errores);
    const cod = await codigos(p0), hijos = await reservarHijos(pre.cajas);
    try {
      return await f.runTransaction(D, async (tx) => {
        const levSn = await tx.get(refLevReg(lev)); if (!levSn.exists() || levSn.data().estado !== 'abierto') throw E('lev', `El ${lev} se cerró mientras aceptabas: vuelve a intentar (se abre otro).`);
        const L = await leerTodo((r) => tx.get(r), destino, lev, vistas, modo); { const y = yaEstaba(L.cajas); if (y) throw y; }
        const tags = []; for (const c of vistas) tags.push(await tx.get(refTag(c.folio)));
        const plan = planificar({ ...base, doc: L.doc, cajas: L.cajas, regs: L.regs });
        tags.forEach((t, i) => { const d = t.exists() ? t.data() : null; if (!d || d.tipo !== 'tag-conteo' || d.estado !== 'TAG') plan.errores.push(E('tag', `Tag ${nTag(vistas[i].folio)}: ya no es un tag CONTADO sin usar${d && d.tipo === 'bulto' ? ' (ya es una caja)' : ''}.`, { folios: [vistas[i].folio] })); });
        if ((plan.resumen.sobras || plan.resumen.faltas) && !cod.AJU) plan.errores.push(E('cambio', 'El conteo cambió mientras aceptabas: vuelve a intentar.'));
        if (plan.resumen.reclas && !cod.CAM) plan.errores.push(E('cambio', 'El conteo cambió mientras aceptabas: vuelve a intentar.'));
        if (plan.errores.length) throw juntar(plan.errores);
        const ahora = new Date().toISOString(), ts = f.serverTimestamp(), ref = destino.ref, id = ref.id, doc = L.doc, src = L.fuente || {};
        const nombre = (doc && doc.name) || src.name || destino.nombre || String(g.nombre || '').toUpperCase(), bod = g.bodega, ctl = plan.ctl;
        const prox = [...plan.batches].sort(window.fefoCompare || (() => 0))[0], lim = num((doc && (doc.criticalLimit || doc.stock_minimo)) || src.criticalLimit || 50);
        /* deuda (sobregiro): lo contado ya no incluye lo entregado sin stock → se salda sin mover lotes (como la toma) */
        let sd = null;
        if (plan.deuda && doc) {
          const A = window.SAR_ActasEntrega; const c = A && A.cuadrar ? A.cuadrar({ ...doc, quantity: 1e9, batches: [{ batch: '_', quantity: 1e9, expirationDate: '' }] }, num(doc.sobregiro)) : null;
          sd = c && c.cuadrado > 0 ? { sobregiro: c.sobregiro, sobregiroDetalle: c.sobregiroDetalle, cubiertas: c.cubiertas || [] } : { sobregiro: 0, sobregiroDetalle: [], cubiertas: [{ acta: '(sin detalle)', qty: num(doc.sobregiro) }] };
        }
        const campos = { quantity: plan.quantity, batches: plan.batches, batch: prox ? prox.batch : '', expirationDate: prox ? (prox.expirationDate || '') : '', isCritical: plan.quantity <= lim, origenLev: true, ultimoLev: lev, updatedAt: ts, lastUpdated: ts, ...(sd ? { sobregiro: sd.sobregiro, sobregiroDetalle: sd.sobregiroDetalle } : {}) };
        if (doc) tx.update(ref, campos);
        else {
          const b0 = { ...src }; ['sobregiro', 'sobregiroDetalle', 'provisional', 'ubicacionEstante', 'status', 'reservado', 'reservas', 'levProvisional', 'ultimoLev'].forEach(k => delete b0[k]);
          const c0 = L.cajas[0] || {};
          tx.set(ref, { ...b0, name: nombre, name_lowercase: nombre.toLowerCase(), location: bod, bodegaNombre: bod, bodegaId: g.bodegaId || '', criticalLimit: lim, category: src.category || 'General', ...(src.tipoInsumo || c0.tipo ? { tipoInsumo: src.tipoInsumo || c0.tipo } : {}), controlado: src.controlado || c0.controlado || null,
            origenIngreso: 'LEVANTAMIENTO', precioPendiente: true, ...(destino.crear ? { levProvisional: true, levFicha: { lev, creadaPor: yo, creadaEn: ahora, nombreContado: c0.nombre || '' } } : {}), creadoEn: ahora, ...campos });
        }
        const regsN = registrosNuevos(plan, id, ahora), mov = (k) => f.doc(refCol('Historial_Movimientos'), idMov(lev, id, k, regsN[k] ? regsN[k].n : 1));
        const comunH = { insumoName: nombre, item: nombre, insumoId: id, user: yo, date: ts, document: lev, lev, bodega: bod, origen: 'LEVANTAMIENTO' };
        const altas = [], solicitudes = [];
        plan.lineas.forEach(l => {
          const k = l.clave, ven = l.vence === 'N/A' ? '' : l.vence;
          l.reclasIn.forEach((r, j) => tx.set(f.doc(refCol('Historial_Movimientos'), idMov(lev, id, k, regsN[k].n) + '-r' + j), { ...comunH, type: 'CAMBIO_CONTROLADO', quantity: 0, delta: 0, cantidadReclasificada: r.q, batch: l.lote, desdeLote: r.deLote, haciaLote: l.lote, expirationDate: ven, codigoSeguimiento: cod.CAM, motivo: 'Levantamiento: S/L pasa al lote contado', observacion: `${lev}: ${r.q} u. sin lote (S/L) pasan al lote ${l.lote} ${mesCL(l.vence)} (el total no cambia).` }));
          if (l.alta) { tx.set(mov(k), { ...comunH, type: 'INGRESO_INVENTARIO', quantity: l.alta, delta: l.alta, batch: l.lote, expirationDate: ven, destination: bod, dest: bod, origin: 'Levantamiento', idInsumoDestino: id, precioPendiente: true, codigoSeguimiento: lev, observacion: `Levantamiento ${lev} · ${l.folios.length} caja(s): ${l.folios.map(nTag).join(', ')}` }); altas.push({ insumoId: id, nombre, lote: l.lote, vence: l.vence, q: l.alta }); }
          if (l.sobra) {
            tx.set(f.doc(refCol('Historial_Movimientos'), 'aju-' + idMov(lev, id, k, regsN[k].n)), { ...comunH, type: 'AJUSTE_CRITICO', quantity: l.sobra, delta: l.sobra, batch: l.lote, idInsumoOrigen: id, origin: 'Levantamiento', dest: 'N/A', codigoSeguimiento: cod.AJU, motivo: 'Levantamiento: sobrante', observacion: `${lev} · lote ${l.lote}: sistema ${l.base}, contado ${l.contado}` });
            tx.set(f.doc(refCol('Auditoria')), { code: cod.AJU, user: yo, item: nombre, action: `Suma de stock por levantamiento ${lev}: lote ${l.lote} +${l.sobra}`, justification: `Levantamiento ${lev} · ${bod}`, date: ts, lev });
          }
          if (l.falta) {
            const sid = `lev-${lev}-${id}-${encodeURIComponent(k)}-${(l.reg ? num(l.reg.n) : 0) + 1}`; solicitudes.push(sid);
            tx.set(f.doc(refCol('Solicitudes_Ajuste'), sid), { code: cod.AJU, insumoId: id, insumoName: nombre, cantidad: -l.falta, justificacion: `Levantamiento ${lev} · ${bod} · lote ${l.crudo || l.lote}: sistema ${l.ahora}, contado ${l.contado}${l.sinContar ? ' (no contado: producto contado completo)' : ''}`, previousStock: num(doc && doc.quantity), projectedStock: num(doc && doc.quantity) - l.falta,
              motivo: 'Levantamiento: faltante', observacion: `${lev}`, status: 'pendiente', date: ts, requester: yo, contadoPor: [...new Set(l.cajas.map(c => c.contadoPor))].join(', '), lev, lote: l.crudo != null ? l.crudo : l.lote, mesLote: l.vence, vence: '', loteSistema: l.ahora, conteo: false });
          }
        });
        if (sd) sd.cubiertas.forEach((cu, j) => tx.set(f.doc(refCol('Historial_Movimientos'), `lev-${lev}-${id}-deuda-${j}`), { ...comunH, type: 'CUADRE_SOBREGIRO', quantity: cu.qty, delta: 0, origin: bod, idInsumoOrigen: id, actaId: cu.acta, automatico: true, observacion: `Deuda del acta ${cu.acta} (${cu.qty} u.) saldada por el levantamiento ${lev}: producto contado completo.` }));
        Object.entries(regsN).forEach(([k, r]) => tx.set(refReg(lev, id, k), r));
        /* cajas → ACEPTADO; tag → BUL real con sus interiores (misma transacción) */
        const todasBul = [];
        L.cajas.forEach((c, i) => {
          const propia = norm(c.contadoPor) === norm(yo), bs = bultosDe(c, { lev, nombre, insumoId: id, codigoMP: (doc && doc.codigoMP) || src.codigoMP || '', hijos: hijos[c.folio], ahora, por: yo, tagCreadoEn: tags[i].data().creadoEn || '' });
          tx.update(refCaja(c.folio), { estado: 'ACEPTADO', aceptadoPor: yo, aceptadoEn: ahora, aceptadoTotal: c.total, aceptadoLote: c.lote, aceptadoVence: c.vence, aceptadoInsumoId: id, insumoId: id, lev, hijos: bs.slice(1).map(b => b.folio), contadoCompleto: modo === 'completo', ...(propia ? { aceptadoPropio: true } : {}) });
          bs.forEach(b => { tx.set(refTag(b.folio), b); todasBul.push(b.folio); });
        });
        const R = levSn.data(), cap = (a, n) => a.slice(-(n || 300));
        tx.update(refLevReg(lev), { cajas: num(R.cajas) + L.cajas.length, unidades: num(R.unidades) + plan.resumen.unidades, productos: num(R.productos) + 1, aceptadoPor: cap([...new Set([...(R.aceptadoPor || []), yo])], 50), altas: cap([...(R.altas || []), ...altas]),
          fichas: destino.crear && !doc ? cap([...new Set([...(R.fichas || []), id])]) : (R.fichas || []), propias: cap([...(R.propias || []), ...L.cajas.filter(c => norm(c.contadoPor) === norm(yo)).map(c => c.folio)]), solicitudes: cap([...(R.solicitudes || []), ...solicitudes]), ultimaEn: ahora, ultimoPor: yo });
        return { lev, insumoId: id, resumen: plan.resumen, bultos: todasBul, solicitudes, fichaNueva: destino.crear && !doc };
      });
    } catch (e) { if (e && e.ya) return { lev: e.lev || lev, ya: true }; throw e; }
  }
  function juntar(errores) { const e = E(errores[0].tipo, errores.map(x => x.message).filter((m, i, a) => a.indexOf(m) === i).slice(0, 4).join(' · ')); e.errores = errores; return e; }

  /** Bodega pide reconteo (la caja vuelve al teléfono marcada). */
  async function pedirReconteo(c, nota) {
    const f = fs(), yo = usuario();
    if (!(await enLinea())) throw E('red', 'Sin internet no se puede pedir el reconteo.');
    return f.runTransaction(db(), async (tx) => { const s = await tx.get(refCaja(c.folio)); if (!s.exists() || s.data().estado !== 'REGISTRADO') throw E('estado', `Tag ${nTag(c.folio)}: ya no está registrado.`);
      tx.update(refCaja(c.folio), { estado: 'RECONTEO', reconteoPedidoPor: yo, reconteoEn: new Date().toISOString(), nota: String(nota || 'Bodega pide recontar esta caja (otra persona).').slice(0, 300) }); });
  }
  /** Rechazar con motivo: la caja queda RECHAZADA y el tag sigue como TAG (no pasa a caja). */
  async function rechazar(c, motivo) {
    const f = fs(), yo = usuario(), m = String(motivo || '').trim(); if (!m) throw E('motivo', 'Escribe el motivo del rechazo.');
    if (!(await enLinea())) throw E('red', 'Sin internet no se puede rechazar.');
    return f.runTransaction(db(), async (tx) => { const s = await tx.get(refCaja(c.folio)); if (!s.exists() || !PEND.includes(s.data().estado)) throw E('estado', `Tag ${nTag(c.folio)}: ya no está pendiente.`);
      tx.update(refCaja(c.folio), { estado: 'RECHAZADO', rechazadoPor: yo, rechazadoEn: new Date().toISOString(), motivoRechazo: m.slice(0, 300) }); });
  }
  /** Cierra el LEV de una bodega: IRA (solo lotes con saldo previo), altas con precio pendiente y fichas provisionales. */
  async function cerrarLev(lev) {
    const f = fs(), sn = await f.getDocs(f.query(refCol('Levantamientos', lev, 'lotes'), f.limit(5000))), lotes = []; sn.forEach(d => lotes.push(d.data()));
    return f.runTransaction(db(), async (tx) => {
      const r = await tx.get(refLevReg(lev)); if (!r.exists() || r.data().estado !== 'abierto') throw E('lev', `${lev} ya no está abierto.`);
      const d = r.data(), ps = await tx.get(refPtr(d.bodega));
      tx.update(refLevReg(lev), { estado: 'cerrado', cerradoPor: usuario(), cerradoEn: new Date().toISOString(), ira: ira(lotes), lotes: lotes.length, lotesConSaldo: lotes.filter(l => num(l.base) > 0).length });
      if (ps.exists() && ps.data().lev === lev) tx.update(refPtr(d.bodega), { lev: null, ultimoCerrado: lev });
      return { ira: ira(lotes), lotes: lotes.length };
    });
  }
  /** Superadmin valida una ficha provisional (desde ahí se puede despachar). */
  async function validarFicha(id) {
    if (rol() !== 'superadmin') throw E('super', 'Solo el superadmin valida fichas provisionales.');
    const f = fs(); return f.runTransaction(db(), async (tx) => { const r = f.doc(refCol('Insumos'), id), s = await tx.get(r); if (!s.exists()) throw E('no', 'La ficha ya no existe.'); tx.update(r, { levProvisional: false, validadaPor: usuario(), validadaEn: new Date().toISOString() }); });
  }
  /** Para Ingresos: cajas del levantamiento aún sin aceptar de ese producto, bodega, lote y mes. */
  async function pendientesDe(prod, bodega, lote, mes) {
    const f = fs(), sn = await f.getDocs(f.query(refCol(COL), f.where('bodega', '==', bodega), f.limit(3000))), l = [];
    sn.forEach(x => l.push({ ...x.data(), folio: x.id }));
    return pendientesEn(l, prod, bodega, lote, mes);
  }
  /** Una ficha provisional del levantamiento no se despacha hasta que el superadmin la valide. */
  const bloqueaDespacho = (d) => !!(d && d.levProvisional === true);
  const AVISO_FICHA = (n) => `${n || 'Este producto'} es una ficha provisional del levantamiento: el superadmin debe validarla antes de despacharlo.`;

  // ---------------- pantalla ----------------
  let cajas = [], insumos = [], regsLev = {}, levs = {}, bodSel = '', opc = {}, desuscribir = null, busy = false, cargadoIns = false;
  const root = () => document.getElementById('levb-root');
  const esAdmin = () => ADMIN.includes(rol());
  const EST = { alta: ['Alta', 'ok'], reclasificar: ['Reclasificar', 'info'], sobra: ['Sobra', 'warn'], falta: ['Falta', 'bad'], coincide: ['Coincide', 'ok'], movido: ['Movido: recontar', 'bad'] };
  function badge() { const b = document.getElementById('lev-badge'), n = cajas.filter(c => c.estado === 'REGISTRADO').length; if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; } }
  function suscribir() {
    if (desuscribir || !fs() || !db() || !esAdmin()) return; const f = fs();
    try { desuscribir = f.onSnapshot(f.query(refCol(COL), f.limit(5000)), (sn) => { const l = []; sn.forEach(x => l.push({ ...x.data(), folio: x.data().folio || x.id })); cajas = l; badge(); if (root() && root().isConnected && document.getElementById('view-lev-bandeja') && !busy) pintar(); }, () => { desuscribir = null; }); } catch (e) { desuscribir = null; }
  }
  async function cargarInsumos() { const f = fs(), sn = await f.getDocs(f.query(refCol('Insumos'), f.limit(5000))), l = []; sn.forEach(x => l.push({ id: x.id, ...x.data() })); insumos = l; cargadoIns = true; }
  async function cargarLevs(bods) {
    const f = fs();
    for (const b of bods) {
      try { const p = await f.getDoc(refPtr(b)), lev = p.exists() ? p.data().lev : null; if (!lev) { levs[b] = null; continue; } const r = await f.getDoc(refLevReg(lev)); levs[b] = r.exists() && r.data().estado === 'abierto' ? r.data() : null;
        if (levs[b]) { const s = await f.getDocs(f.query(refCol('Levantamientos', lev, 'lotes'), f.limit(5000))), m = {}; s.forEach(x => { const d = x.data(); m[d.insumoId + '|' + d.clave] = d; }); regsLev[lev] = m; } } catch (e) { levs[b] = levs[b] || null; }
    }
  }
  /** Registro del producto en la bodega (para la vista previa; la transacción vuelve a leerlo). */
  function docDe(p) {
    const h = (opc[p.key] || {}).hom, nombre = h && h.tipo === 'existente' ? h.nombre : p.nombre;
    if (p.nuevo && (!h || h.tipo === 'ficha')) { const id = `lev_${slug(p.nombre)}__${slug(p.bodega)}`; const d = insumos.find(i => i.id === id); return d ? { id, d } : { id, d: null }; }
    const i = insumos.find(x => x.id === p.insumoId && esDeBodega(x, p)) || insumos.find(x => norm(x.name) === norm(nombre) && esDeBodega(x, p) && x.status !== 'CUARENTENA');
    return i ? { id: i.id, d: i } : { id: '', d: null };
  }
  function vistaPrevia(p) {
    const o = opc[p.key] || {}, { id, d } = docDe(p), lev = levs[p.bodega], rg = {}; if (lev && id) Object.values(regsLev[lev.folio] || {}).filter(r => r.insumoId === id).forEach(r => { rg[r.clave] = r; });
    const reg = p.cajas.filter(c => c.estado === 'REGISTRADO'), S = T().agrupar(lotesDoc(d)), vista = {}; S.forEach((s, k) => { vista[k] = s.quantity; });
    const sl = [...S.values()].filter(s => s.batch === 'S/L').reduce((t, s) => t + s.quantity, 0);
    const modo = o.completo ? 'completo' : 'caja';
    const plan = planificar({ doc: d, cajas: reg, regs: rg, modo, esSuper: rol() === 'superadmin', yo: usuario(), confirmaFaltas: !!o.faltas, slVisto: sl, deudaVista: d ? num(d.sobregiro) : 0, vista, controlado: p.controlado, enReconteo: p.cajas.filter(c => c.estado === 'RECONTEO').length });
    if (p.nuevo && !o.hom) plan.errores.unshift(E('homologar', 'Producto nuevo: elige un producto del catálogo o «Crear ficha nueva».'));
    if (!reg.length) plan.errores.unshift(E('vacio', 'Todas las cajas están en reconteo.'));
    return { plan, d, vista, sl, reg, modo };
  }
  function filaCaja(c, puedeCaja, enRed) {
    const est = c.estado === 'RECONTEO' ? '<span class="tg-est tg-est--reconteo">Reconteo pedido</span>' : recontada(c) ? '<span class="tg-est tg-est--contado">Recontada</span>' : '';
    const ET = window.SAR_TagsConteo && window.SAR_TagsConteo.estructuraCorta ? window.SAR_TagsConteo.estructuraCorta(c.estructura) : '';
    return `<tr class="lvb-caja"><td><b>N° ${esc(nTag(c.folio))}</b> ${est}</td><td colspan="2">${esc(ET)}</td><td><b>${ent(c.total)}</b> u.</td><td colspan="2"><small>${esc(c.contadoNombre || c.contadoPor || '')} · ${esc(hora(c.en))}${c.editadoEn ? ' · corregida ' + esc(hora(c.editadoEn)) : ''}${c.nota ? ' · ' + esc(c.nota) : ''}</small>
      <span class="lvb-acc">${c.estado === 'REGISTRADO' && puedeCaja ? `<button type="button" class="btn btn-primary btn-sm" data-lvb="caja" data-f="${esc(c.folio)}"${enRed ? '' : ' disabled'}>Aceptar</button>` : ''}${c.estado === 'REGISTRADO' ? `<button type="button" class="btn btn-secondary btn-sm" data-lvb="recontar" data-f="${esc(c.folio)}"${enRed ? '' : ' disabled'}>Pedir reconteo</button>` : ''}<button type="button" class="btn btn-outline btn-sm" data-lvb="rechazar" data-f="${esc(c.folio)}"${enRed ? '' : ' disabled'}>Rechazar</button></span></td></tr>`;
  }
  function tarjeta(p, enRed) {
    const o = opc[p.key] || {}, v = vistaPrevia(p), pl = v.plan, puedeCaja = !o.completo && !pl.errores.some(e => e.tipo === 'modo' || e.tipo === 'super' || e.tipo === 'doble' || e.tipo === 'homologar');
    const bloquea = pl.errores, total = v.reg.reduce((t, c) => t + ent(c.total), 0);
    const filas = [...pl.lineas].sort((a, b) => String(a.vence).localeCompare(String(b.vence))).map(l => {
      const st = estadoLinea(l, pl.errores), e = EST[st] || ['', ''], dif = l.contado - l.ahora, cs = p.cajas.filter(c => claveCaja(c) === l.clave);
      return `<tr class="lvb-lote${l.sinContar ? ' lvb-sin' : ''}"><td><b>${esc(l.crudo || l.lote)}</b> · ${esc(mesCL(l.vence))}</td><td>${l.base == null ? '—' : l.base}</td><td>${l.ahora}</td><td>${l.sinContar ? 'sin contar' : l.contado}</td><td>${dif > 0 ? '+' : ''}${dif}${l.reclasIn.length ? `<small>${l.reclasIn.reduce((t, r) => t + r.q, 0)} desde S/L</small>` : ''}</td><td><span class="lvb-chip lvb-chip--${e[1]}">${esc(e[0])}</span></td></tr>${cs.map(c => filaCaja(c, puedeCaja, enRed)).join('')}`;
    }).join('') + p.cajas.filter(c => c.estado === 'RECONTEO' && !pl.lineas.some(l => l.clave === claveCaja(c))).map(c => filaCaja(c, false, enRed)).join('');
    const hom = p.nuevo ? `<div class="lvb-hom"><label class="form-label" for="lvb-h-${esc(slug(p.key))}">Producto nuevo «${esc(p.nombre)}»: homologar</label><input class="form-control" id="lvb-h-${esc(slug(p.key))}" data-lvb-hom="${esc(p.key)}" list="lvb-cat" placeholder="Busca un producto del catálogo…" value="${o.hom && o.hom.tipo === 'existente' ? esc(o.hom.nombre) : ''}" autocomplete="off">
      <label class="lvb-chk"><input type="checkbox" data-lvb-ficha="${esc(p.key)}"${o.hom && o.hom.tipo === 'ficha' ? ' checked' : ''}> Crear ficha nueva (provisional: no se despacha hasta que el superadmin la valide)</label></div>` : '';
    const msgs = bloquea.filter(e => e.tipo !== 'vacio').map(e => `<li>${esc(e.message)}</li>`).join('');
    const faltas = pl.lineas.some(l => l.falta);
    const lbl = o.completo ? `Aceptar producto (${v.reg.length} caja${v.reg.length === 1 ? '' : 's'})` : `Aceptar ${v.reg.length === 1 ? 'la caja' : 'las ' + v.reg.length + ' cajas'}`;
    return `<article class="act-card lvb-prod" data-key="${esc(p.key)}"><header class="lvb-cab"><div><h3 class="act-h">${esc(p.nombre)}</h3><p class="act-hint">${p.cajas.length} caja${p.cajas.length === 1 ? '' : 's'} · contado ${total} u. · sistema ${num(v.d && v.d.quantity)} u.${v.d && num(v.d.sobregiro) ? ` · deuda ${num(v.d.sobregiro)}` : ''}${v.sl ? ` · ${v.sl} S/L` : ''}</p></div>
      <div class="lvb-tags">${p.nuevo ? '<span class="lvb-chip lvb-chip--info">Nuevo</span>' : ''}${p.controlado ? '<span class="lvb-chip lvb-chip--bad">Controlado: doble conteo + superadmin</span>' : ''}${v.d && v.d.levProvisional ? '<span class="lvb-chip lvb-chip--warn">Ficha provisional</span>' : ''}</div></header>${hom}
      <div class="sal-tabla"><table class="aud-lib lvb-t"><thead><tr><th>Lote · vence</th><th>Al contar</th><th>Ahora</th><th>Contado</th><th>Diferencia</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table></div>
      ${msgs ? `<ul class="lvb-msg">${msgs}</ul>` : ''}
      <div class="lvb-pie"><label class="lvb-chk"><input type="checkbox" data-lvb-comp="${esc(p.key)}"${o.completo ? ' checked' : ''}> Producto contado completo <small>(lo no contado de este producto en ${esc(p.bodega)} cuenta como 0)</small></label>
        ${o.completo && faltas ? `<label class="lvb-chk"><input type="checkbox" data-lvb-faltas="${esc(p.key)}"${o.faltas ? ' checked' : ''}> Confirmo los faltantes (ya se recontaron): quedan como solicitud de ajuste para el superadmin, no se descuentan</label>` : ''}
        <button type="button" class="btn btn-primary" data-lvb="producto" data-k="${esc(p.key)}"${enRed && !pl.errores.length ? '' : ' disabled'}>${lbl}</button>${enRed ? '' : '<small class="lvb-off">Sin internet no se acepta.</small>'}</div></article>`;
  }
  function pintar() {
    const r = root(); if (!r) return;
    if (!esAdmin()) { r.innerHTML = '<div class="home-empty">Esta bandeja es para administradores y el superadmin.</div>'; return; }
    const enRed = typeof navigator === 'undefined' || navigator.onLine !== false, B = agrupar(cajas), bods = [...B.keys()].sort((a, b) => a.localeCompare(b, 'es'));
    if (!bodSel || !B.has(bodSel)) bodSel = bods[0] || '';
    const b = B.get(bodSel), lev = levs[bodSel], fichas = rol() === 'superadmin' ? insumos.filter(i => i.levProvisional === true) : [];
    const cat = [...new Set(insumos.filter(i => !i.levProvisional && i.status !== 'CUARENTENA').map(i => String(i.name || '')).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es')).slice(0, 3000);
    r.innerHTML = `<div class="lvb"><div class="si-cab"><div><h2 class="si-t">Levantamientos por aprobar</h2><p class="si-s">Lo que contaron los tomadores con el teléfono. Al aceptar entra al stock (documento LEV) y el tag pasa a ser la etiqueta BUL de la caja: queda en «Impresión de etiquetas».</p></div></div>
      ${enRed ? '' : '<p class="lvb-banda">Sin internet: puedes revisar, pero no aceptar ni rechazar.</p>'}
      ${fichas.length ? `<div class="act-card"><h3 class="act-h">Fichas provisionales por validar (${fichas.length})</h3><p class="act-hint">Productos nuevos del levantamiento. No se despachan hasta validarlos.</p><ul class="lvb-fichas">${fichas.map(i => `<li><b>${esc(i.name)}</b> · ${esc(i.location || '')} · ${num(i.quantity)} u. <button type="button" class="btn btn-secondary btn-sm" data-lvb="validar" data-id="${esc(i.id)}"${enRed ? '' : ' disabled'}>Validar</button></li>`).join('')}</ul></div>` : ''}
      ${bods.length ? `<div class="lvb-bods" role="tablist">${bods.map(x => `<button type="button" role="tab" class="lvb-bod${x === bodSel ? ' is-on' : ''}" aria-selected="${x === bodSel}" data-lvb="bodega" data-b="${esc(x)}">${esc(x)} <span class="home-badge">${B.get(x).cajas}</span></button>`).join('')}</div>
        <div class="lvb-lev">${lev ? `<span><b>${esc(lev.folio)}</b> abierto · ${num(lev.cajas)} caja${num(lev.cajas) === 1 ? '' : 's'} aceptada${num(lev.cajas) === 1 ? '' : 's'} · ${num(lev.unidades)} u.</span><button type="button" class="btn btn-outline btn-sm" data-lvb="cerrar" data-lev="${esc(lev.folio)}"${enRed ? '' : ' disabled'}>Cerrar ${esc(lev.folio)}</button><a class="btn btn-outline btn-sm" href="#view-etiquetas">Impresión de etiquetas</a>` : '<span>Al aceptar la primera caja se abre el documento LEV de esta bodega.</span>'}</div>
        <datalist id="lvb-cat">${cat.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        ${[...b.productos.values()].sort((x, y) => x.nombre.localeCompare(y.nombre, 'es')).map(p => tarjeta(p, enRed)).join('')}` : `<div class="home-empty">${cargadoIns ? 'No hay cajas por aprobar.' : 'Cargando…'}</div>`}</div>`;
    enlazar(r);
  }
  const grupoDe = (k) => { for (const b of agrupar(cajas).values()) if (b.productos.has(k)) return b.productos.get(k); return null; };
  async function accion(btn, fn, ok) {
    btn.disabled = true; busy = true; const P = window.SAR_Progreso, pr = P && P.iniciar ? P.iniciar('Guardando…', ['Un momento…']) : null;
    try { const r = await fn(); if (pr) pr.listo(ok(r)); else toast('Listo', ok(r), 'success'); } catch (e) { if (pr) pr.error(); toast('No se pudo', esc(e.message || e), 'error'); }
    busy = false; try { await cargarInsumos(); await cargarLevs(agrupar(cajas).size ? [...agrupar(cajas).keys()] : []); } catch (e) { /* se ve al volver */ } pintar();
  }
  function enlazar(r) {
    r.querySelectorAll('[data-lvb="bodega"]').forEach(x => x.onclick = () => { bodSel = x.dataset.b; pintar(); });
    r.querySelectorAll('[data-lvb-comp]').forEach(x => x.onchange = () => { const k = x.dataset.lvbComp; opc[k] = { ...(opc[k] || {}), completo: x.checked }; pintar(); });
    r.querySelectorAll('[data-lvb-faltas]').forEach(x => x.onchange = () => { const k = x.dataset.lvbFaltas; opc[k] = { ...(opc[k] || {}), faltas: x.checked }; pintar(); });
    r.querySelectorAll('[data-lvb-ficha]').forEach(x => x.onchange = () => { const k = x.dataset.lvbFicha; opc[k] = { ...(opc[k] || {}), hom: x.checked ? { tipo: 'ficha' } : null }; pintar(); });
    r.querySelectorAll('[data-lvb-hom]').forEach(x => x.onchange = () => { const k = x.dataset.lvbHom, i = insumos.find(y => norm(y.name) === norm(x.value) && !y.levProvisional); opc[k] = { ...(opc[k] || {}), hom: i ? { tipo: 'existente', insumoId: i.id, nombre: i.name } : null }; if (!i && x.value.trim()) toast('Homologar', 'Elige un nombre de la lista del catálogo.', 'warning'); pintar(); });
    r.querySelectorAll('[data-lvb="producto"],[data-lvb="caja"]').forEach(x => x.onclick = () => {
      const k = x.dataset.k || (cajas.find(c => c.folio === x.dataset.f) ? productoKey(cajas.find(c => c.folio === x.dataset.f)) : ''), g = grupoDe(k); if (!g) return; const o = opc[k] || {}, v = vistaPrevia(g);
      const folios = x.dataset.lvb === 'caja' ? [x.dataset.f] : v.reg.map(c => c.folio);
      accion(x, () => aceptar(g, { modo: o.completo ? 'completo' : 'caja', folios, homologar: o.hom, confirmaFaltas: !!o.faltas, slVisto: v.sl, deudaVista: v.d ? num(v.d.sobregiro) : 0, vista: v.vista }),
        (res) => res.ya ? 'Ya estaba aceptado.' : `${res.lev}: ${res.resumen.cajas} caja(s), ${res.resumen.unidades} u.${res.resumen.altas ? ` · alta ${res.resumen.altas}` : ''}${res.resumen.reclas ? ` · reclasificado ${res.resumen.reclas}` : ''}${res.resumen.sobras ? ` · sobra ${res.resumen.sobras}` : ''}${res.solicitudes.length ? ` · ${res.solicitudes.length} faltante(s) al superadmin` : ''} · ${res.bultos.length} etiqueta(s) por imprimir`);
    });
    r.querySelectorAll('[data-lvb="recontar"]').forEach(x => x.onclick = async () => { const c = cajas.find(y => y.folio === x.dataset.f); if (!c) return; const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: `¿Pedir reconteo del tag N° ${nTag(c.folio)}?`, texto: 'La caja vuelve al teléfono marcada «Bodega pidió recontar». Que la cuente otra persona.', si: 'Pedir reconteo' }) : true; if (ok) accion(x, () => pedirReconteo(c), () => 'Reconteo pedido.'); });
    r.querySelectorAll('[data-lvb="rechazar"]').forEach(x => x.onclick = () => { const c = cajas.find(y => y.folio === x.dataset.f); if (!c) return; const m = window.prompt(`Motivo del rechazo del tag N° ${nTag(c.folio)}:`, ''); if (m == null) return; accion(x, () => rechazar(c, m), () => 'Caja rechazada.'); });
    r.querySelectorAll('[data-lvb="cerrar"]').forEach(x => x.onclick = async () => { const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: `¿Cerrar ${x.dataset.lev}?`, texto: 'Lo que se acepte después abre un LEV nuevo de esta bodega.', si: 'Cerrar' }) : true; if (ok) accion(x, () => cerrarLev(x.dataset.lev), (res) => `${x.dataset.lev} cerrado · ${res.lotes} lote(s)${res.ira != null ? ` · IRA ${res.ira} %` : ''}`); });
    r.querySelectorAll('[data-lvb="validar"]').forEach(x => x.onclick = () => accion(x, () => validarFicha(x.dataset.id), () => 'Ficha validada: ya se puede despachar.'));
  }
  async function abrir() {
    const r = root(); if (!r) return;
    if (!esAdmin()) { pintar(); return; }
    r.innerHTML = window.SAR_Progreso && window.SAR_Progreso.cargando ? window.SAR_Progreso.cargando('Leyendo los conteos…') : 'Cargando…';
    suscribir();
    try { if (!desuscribir) { const f = fs(), sn = await f.getDocs(f.query(refCol(COL), f.limit(5000))), l = []; sn.forEach(x => l.push({ ...x.data(), folio: x.data().folio || x.id })); cajas = l; }
      await cargarInsumos(); await cargarLevs([...agrupar(cajas).keys()]); } catch (e) { r.innerHTML = `<p class="err-vacio">No pude leer los conteos (${esc(e.code || e.message || e)}).</p>`; return; }
    pintar(); badge();
  }
  if (typeof window.addEventListener === 'function') { window.addEventListener('online', () => { if (root() && root().offsetParent) pintar(); }); window.addEventListener('offline', () => { if (root() && root().offsetParent) pintar(); }); }
  /* badge del menú: se suscribe cuando hay sesión de administrador */
  if (typeof setTimeout === 'function' && typeof document.getElementById === 'function') { let k = 0; const t = () => { if (desuscribir || k++ > 40) return; if (fs() && db() && usuario() && esAdmin()) suscribir(); else setTimeout(t, 3000); }; setTimeout(t, 4000); }

  const api = { abrir, pintar, aceptar, pedirReconteo, rechazar, cerrarLev, validarFicha, levAbierto, resolverDestino, pendientesDe, pendientesEn, bloqueaDespacho, AVISO_FICHA, planificar, estadoLinea, registrosNuevos, bultosDe, agrupar, recontada, lotesDoc, ira, idReg, nHijos };
  window.SAR_LevBandeja = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
