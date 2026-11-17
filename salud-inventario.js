/* ==========================================================================
   SALUD DEL INVENTARIO (v21.228) — solo administración
   Revisa los datos que hacen que un producto con stock real «no aparezca» o se vea en 0 (caso sabanilla, 16-11-2026)
   y ofrece la corrección de cada caso, siempre con registro en el historial:
   · Nombres de bodega con espacios de más (p. ej. «Bodega Transitoria » vs «Bodega Transitoria»): se unifica el nombre
     de la bodega y de sus productos.
   · Productos con stock sin bodega: se les asigna una.
   · Productos repetidos en una misma bodega (mismo nombre o mismo ID de Mercado Público): se unen sumando stock,
     lotes y lo adeudado; las actas, solicitudes y cajas pasan al registro que queda (SAR_Unificar.unir).
   · Lo adeudado (entregado con acta sin stock en el sistema) en productos que ya tienen stock: «Descontar del stock»
     o «Regularizar» (el conteo físico ya lo refleja: se anula la deuda sin tocar el stock).
   Desde v21.228 todo ingreso descuenta solo lo adeudado (cuadre-ingreso.js); esta pantalla arregla lo anterior.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const num = (v) => Number(v) || 0;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const limpia = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  const usuario = () => (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || '';
  const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); };
  const TRANSITO = 'En tránsito';
  const lotesDe = (d) => (Array.isArray(d.batches) && d.batches.length ? d.batches : (num(d.quantity) > 0 ? [{ batch: d.batch || 'S/L', quantity: num(d.quantity), expirationDate: d.expirationDate || '' }] : []));

  // ---------------- lógica pura (probada en tests/unidad.js) ----------------
  /** Revisa insumos [{id, data}] y bodegas [{id, data}] y devuelve los casos a corregir. */
  function analizar(insumos, bodegas) {
    const B = (bodegas || []).map(b => ({ id: b.id, nombre: String(b.data.name || b.data.nombre || ''), tipo: b.data.type || '' }));
    const limpias = new Map(); B.forEach(b => limpias.set(limpia(b.nombre), b));
    const ubic = (d) => String(d.location || d.bodegaNombre || '');
    const conStock = (d) => num(d.quantity) > 0 || lotesDe(d).some(l => num(l.quantity) > 0);
    // 1) nombres con espacios de más: bodega registrada o ubicación de productos que solo difiere en espacios
    const variantes = new Map();   // nombre limpio → Set(formas distintas)
    B.forEach(b => { if (b.nombre && b.nombre !== limpia(b.nombre)) { const k = limpia(b.nombre); if (!variantes.has(k)) variantes.set(k, new Set()); variantes.get(k).add(b.nombre); } });
    (insumos || []).forEach(x => ['location', 'bodegaNombre'].forEach(c => { const v = String(x.data[c] || ''); if (v && v !== limpia(v)) { const k = limpia(v); if (!variantes.has(k)) variantes.set(k, new Set()); variantes.get(k).add(v); } }));
    const nombres = [...variantes.entries()].map(([k, set]) => ({ nombre: k, formas: [...set], bodega: limpias.get(k) || null,
      productos: (insumos || []).filter(x => set.has(String(x.data.location || '')) || set.has(String(x.data.bodegaNombre || ''))).length,
      bien: (insumos || []).filter(x => String(x.data.location || '') === k).length }));
    // 2) con stock y sin bodega
    const sinBodega = (insumos || []).filter(x => !limpia(x.data.location) && conStock(x.data)).map(x => ({ id: x.id, nombre: x.data.name, cantidad: num(x.data.quantity), sobregiro: num(x.data.sobregiro), sugerida: limpia(x.data.bodegaNombre) }));   /* sin location (aunque tenga bodegaNombre): actas, traspasos y unificar buscan por location */
    // 3) ubicación que no es ninguna bodega registrada (ni limpiando espacios)
    const fuera = (insumos || []).filter(x => { const u = limpia(ubic(x.data)); return u && u !== TRANSITO && !limpias.has(u) && conStock(x.data); }).map(x => ({ id: x.id, nombre: x.data.name, bodega: ubic(x.data), cantidad: num(x.data.quantity) }));
    // 4) repetidos por bodega (nombre limpio o ID de Mercado Público)
    const U = window.SAR_Unificar, porB = new Map();
    (insumos || []).forEach(x => { const u = limpia(ubic(x.data)); if (!u || u === TRANSITO) return; if (!porB.has(u)) porB.set(u, []); porB.get(u).push(x); });
    const repetidos = []; if (U && U.detectar) porB.forEach((l, b) => U.detectar(l).forEach(g => repetidos.push({ bodega: b, grupo: g, stock: g.reduce((t, x) => t + num(x.data.quantity), 0), adeudado: g.reduce((t, x) => t + num(x.data.sobregiro), 0) })));
    repetidos.sort((a, b) => (b.stock > 0) - (a.stock > 0) || b.adeudado - a.adeudado);
    // 5) adeudado con stock disponible (lo entregado sin respaldo nunca se descontó)
    const deudas = (insumos || []).filter(x => num(x.data.sobregiro) > 0 && num(x.data.quantity) > 0).map(x => ({ id: x.id, nombre: x.data.name, bodega: ubic(x.data), cantidad: num(x.data.quantity), sobregiro: num(x.data.sobregiro),
      actas: (Array.isArray(x.data.sobregiroDetalle) ? x.data.sobregiroDetalle : []).filter(s => num(s.qty) > 0).map(s => `${s.acta}: ${num(s.qty)}`) }));
    // 6) lotes que no suman el total, negativos
    const lotes = (insumos || []).filter(x => { const d = x.data; if (!Array.isArray(d.batches) || !d.batches.length) return false; return d.batches.reduce((t, b) => t + num(b.quantity), 0) !== num(d.quantity); }).map(x => ({ id: x.id, nombre: x.data.name, cantidad: num(x.data.quantity), lotes: x.data.batches.reduce((t, b) => t + num(b.quantity), 0) }));
    const negativos = (insumos || []).filter(x => num(x.data.quantity) < 0 || (x.data.batches || []).some(b => num(b.quantity) < 0)).map(x => ({ id: x.id, nombre: x.data.name, cantidad: num(x.data.quantity) }));
    const total = nombres.length + sinBodega.length + repetidos.length + deudas.length + lotes.length + negativos.length + fuera.length;
    return { nombres, sinBodega, fuera, repetidos, deudas, lotes, negativos, total, bodegas: B.map(b => limpia(b.nombre)).filter(Boolean).sort() };
  }

  // ---------------- acciones (siempre con historial) ----------------
  const hist = (tx, datos) => tx.set(fs().doc(fs().collection(db(), 'Historial_Movimientos')), { user: usuario(), date: fs().serverTimestamp(), batch: 'N/A', ...datos });
  /** Unifica el nombre de una bodega: la ficha de Bodegas y todos sus productos quedan con el nombre limpio. */
  async function corregirNombre(caso, paso) {
    const f = fs(), nuevo = caso.nombre, formas = caso.formas.filter(v => v !== nuevo); let n = 0;
    if (caso.bodega && caso.bodega.nombre !== nuevo) { await f.updateDoc(f.doc(f.collection(db(), 'Bodegas'), caso.bodega.id), { name: nuevo }); }
    for (const v of formas) for (const campo of ['location', 'bodegaNombre']) {
      const sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where(campo, '==', v), f.limit(5000)));
      for (const d of sn.docs) { if (paso) paso(`Corrigiendo ${++n}: ${String(d.data().name || '').slice(0, 40)}…`); const x = d.data(); await f.updateDoc(d.ref, { ...(String(x.location || '') === v ? { location: nuevo } : {}), ...(String(x.bodegaNombre || '') === v ? { bodegaNombre: nuevo } : {}) }); }
    }
    await f.setDoc(f.doc(f.collection(db(), 'Historial_Movimientos')), { type: 'RENOMBRE_BODEGA', insumoName: `Bodega: ${formas.map(v => '«' + v + '»').join(' / ')} → «${nuevo}»`, quantity: 0, origin: formas.join(' / '), dest: nuevo, user: usuario(), date: f.serverTimestamp(), document: 'Salud del inventario', observacion: `Nombre de bodega con espacios de más unificado; ${n} actualización(es) de productos, sin cambio de stock.` });
    return n;
  }
  /** Asigna bodega a un producto con stock que no tenía. */
  async function asignarBodega(id, bodega) {
    const f = fs(), ref = f.doc(f.collection(db(), 'Insumos'), id);
    return f.runTransaction(db(), async (tx) => {
      const sn = await tx.get(ref); if (!sn.exists()) throw new Error('El producto ya no existe.'); const d = sn.data();
      if (limpia(d.location)) throw new Error(`Ya tiene bodega: ${d.location}.`);
      tx.update(ref, { location: bodega, bodegaNombre: bodega, updatedAt: f.serverTimestamp() });
      hist(tx, { type: 'ASIGNACION_BODEGA', insumoName: d.name, item: d.name, quantity: 0, origin: '(sin bodega)', dest: bodega, idInsumoDestino: id, document: 'Salud del inventario', observacion: `Producto con ${num(d.quantity)} u. sin bodega asignado a ${bodega} (sin cambio de stock).` });
    });
  }
  /** Lo adeudado: descontar del stock (cuadre) o regularizar (el conteo físico ya lo refleja). */
  async function resolverDeuda(id, modo) {
    const f = fs(), ref = f.doc(f.collection(db(), 'Insumos'), id), A = window.SAR_ActasEntrega;
    return f.runTransaction(db(), async (tx) => {
      const sn = await tx.get(ref); if (!sn.exists()) throw new Error('El producto ya no existe.'); const d = sn.data(), sg = num(d.sobregiro);
      if (!(sg > 0)) throw new Error('Ya no tiene unidades adeudadas.');
      const det = (Array.isArray(d.sobregiroDetalle) ? d.sobregiroDetalle : []).filter(s => num(s.qty) > 0);
      if (modo === 'descontar') {
        if (!A || !A.cuadrar) throw new Error('Módulo de actas no disponible: recarga la página.');
        const c = A.cuadrar(d); if (!(c.cuadrado > 0)) throw new Error('No hay stock para descontar.');
        const limite = num(d.criticalLimit || d.stock_minimo || 50);
        tx.update(ref, { quantity: c.quantity, batches: c.batches, sobregiro: c.sobregiro, sobregiroDetalle: c.sobregiroDetalle, isCritical: c.quantity <= limite, updatedAt: f.serverTimestamp() });
        c.cubiertas.forEach(cu => hist(tx, { type: 'CUADRE_SOBREGIRO', delta: -num(cu.qty), insumoName: d.name, item: d.name, quantity: cu.qty, batch: 'MULTI-LOTE', origin: d.location || '', idInsumoOrigen: id, document: cu.acta, actaId: cu.acta, observacion: `Salud del inventario: ${cu.qty} u. entregadas con el acta ${cu.acta} sin stock en el sistema se descuentan del stock.` }));
        return { modo, unidades: c.cuadrado };
      }
      tx.update(ref, { sobregiro: 0, sobregiroDetalle: [], sobregiroRegularizado: (Array.isArray(d.sobregiroRegularizado) ? d.sobregiroRegularizado : []).concat([{ qty: sg, actas: det.map(s => ({ acta: s.acta, qty: num(s.qty) })), por: usuario(), en: new Date().toISOString(), stock: num(d.quantity) }]).slice(-20), updatedAt: f.serverTimestamp() });
      hist(tx, { type: 'REGULARIZA_SOBREGIRO', delta: 0, insumoName: d.name, item: d.name, quantity: sg, origin: d.location || '', idInsumoOrigen: id, document: det.map(s => s.acta).join(', ') || 'Salud del inventario', observacion: `Regularizado por conteo físico: ${sg} u. entregadas con acta(s) ${det.map(s => s.acta + ' (' + num(s.qty) + ')').join(', ') || '(sin acta)'} salieron de stock que no estaba ingresado; el stock (${num(d.quantity)}) no cambia.` });
      return { modo, unidades: sg };
    });
  }

  // ---------------- pantalla ----------------
  let datos = null, cargando = false;
  async function leer() {
    const f = fs(); const [a, b] = await Promise.all([f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(10000))), f.getDocs(f.collection(db(), 'Bodegas'))]);
    const ins = [], bod = []; a.forEach(d => ins.push({ id: d.id, data: d.data() })); b.forEach(d => bod.push({ id: d.id, data: d.data() }));
    return { ins, bod, tope: a.size >= 10000 };
  }
  const tarjeta = (titulo, ayuda, n, cuerpo, k) => `<section class="shi-sec${n ? '' : ' shi-sec--ok'}" data-sec="${k}"><header><h3>${titulo}</h3><span class="shi-n">${n ? n : '<i class="ph-bold ph-check"></i> Sin casos'}</span></header><p class="si-v">${ayuda}</p>${n ? cuerpo : ''}</section>`;
  function pintar() {
    const r = document.getElementById('sal-root'); if (!r) return;
    if (!datos) { r.innerHTML = `<div class="si-wrap si-ancho"><div class="si-cab"><div><h2 class="si-t">Salud del inventario</h2><p class="si-s">Revisando el inventario…</p></div></div>${window.SAR_Progreso ? window.SAR_Progreso.cargando('Leyendo productos y bodegas…') : ''}</div>`; return; }
    const a = datos.a, opts = (sel) => a.bodegas.map(b => `<option${b === sel ? ' selected' : ''}>${esc(b)}</option>`).join('');
    r.innerHTML = `<div class="si-wrap si-ancho"><div class="si-cab"><div><h2 class="si-t">Salud del inventario</h2><p class="si-s">Lo que puede hacer que un producto con stock no aparezca, salga en 0 o quede con deuda. Cada corrección queda en el historial. ${a.total ? `<b>${a.total} caso${a.total === 1 ? '' : 's'} por revisar.</b>` : '<b>Todo en orden.</b>'} Antes de corregir, descarga el respaldo del día.</p></div><button type="button" class="btn btn-secondary btn-sm" id="sal-re"><i class="ph-bold ph-arrows-clockwise"></i> Volver a revisar</button></div>
      ${datos.tope ? '<p class="shi-aviso">El inventario llegó a 10.000 registros (el máximo que se lee de una vez): la revisión puede estar incompleta.</p>' : ''}
      ${tarjeta('Nombres de bodega con espacios de más', 'Una misma bodega escrita con y sin espacio al final cuenta como dos: sus productos no se ven juntos, la reposición y los traspasos fallan.', a.nombres.length,
        a.nombres.map((c, i) => `<div class="shi-fila"><div><b>${esc(c.nombre)}</b><small>Escrita como ${c.formas.map(v => '«' + esc(v.replace(/ /g, '·')) + '»').join(', ')} (· = espacio) en ${c.bodega && c.bodega.nombre !== c.nombre ? 'la ficha de la bodega y ' : ''}${c.productos} producto(s); otros ${c.bien} producto(s) ya están como «${esc(c.nombre)}»</small></div><button type="button" class="btn btn-primary btn-sm" data-nom="${i}">Unificar nombre</button></div>`).join(''), 'nom')}
      ${tarjeta('Productos con stock sin bodega', 'No aparecen en actas, traspasos ni en la lista para pedir. Elige dónde están.', a.sinBodega.length,
        a.sinBodega.map((c, i) => `<div class="shi-fila"><div><b>${esc(c.nombre)}</b><small>${c.cantidad} u.${c.sobregiro ? ' · adeudado ' + c.sobregiro : ''}</small></div><div class="shi-acc"><select class="si-in shi-sel" data-sb="${i}" aria-label="Bodega para ${esc(c.nombre)}">${opts(c.sugerida || 'Bodega CAM')}</select><button type="button" class="btn btn-primary btn-sm" data-asig="${i}">Asignar</button></div></div>`).join(''), 'sb')}
      ${tarjeta('Productos repetidos en una bodega', 'El mismo producto en varios registros (mismo nombre o mismo ID de Mercado Público). Al unir se suman stock, lotes y lo adeudado; actas, solicitudes y cajas pasan al registro que queda.', a.repetidos.length,
        a.repetidos.map((g, i) => `<div class="shi-fila"><div><b>${esc(g.grupo[0].data.name)}</b><small>${esc(g.bodega)} · ${g.grupo.length} registros · stock ${g.grupo.map(x => num(x.data.quantity)).join(' + ')} = ${g.stock}${g.adeudado ? ' · adeudado ' + g.adeudado : ''}${[...new Set(g.grupo.map(x => String(x.data.codigoMP || '')).filter(Boolean))].length > 1 ? ' · <b>con IDs distintos: ' + esc([...new Set(g.grupo.map(x => x.data.codigoMP).filter(Boolean))].join(', ')) + '</b>' : ''}${g.grupo.some(x => x.data.provisional) ? ' · ' + g.grupo.filter(x => x.data.provisional).length + ' provisional(es) creados por actas sin stock' : ''}</small></div><button type="button" class="btn btn-primary btn-sm" data-unir="${i}">Unir en uno</button></div>`).join(''), 'rep')}
      ${tarjeta('Unidades adeudadas en productos que ya tienen stock', 'Se entregaron con acta cuando no había stock en el sistema. «Descontar» las resta del stock; «Regularizar» las da por saldadas sin tocar el stock (cuando el conteo físico ya coincide con el sistema).', a.deudas.length,
        a.deudas.map((c, i) => `<div class="shi-fila"><div><b>${esc(c.nombre)}</b><small>${esc(c.bodega)} · stock ${c.cantidad} · adeudado ${c.sobregiro}${c.actas.length ? ' (' + esc(c.actas.join(', ')) + ')' : ''}${a.repetidos.some(g => g.grupo.some(x => x.id === c.id)) ? ' · <b>primero únelo en «repetidos»: ahí hay más unidades adeudadas</b>' : ''}</small></div><div class="shi-acc"><button type="button" class="btn btn-secondary btn-sm" data-reg="${i}">Regularizar</button><button type="button" class="btn btn-primary btn-sm" data-desc="${i}">Descontar ${Math.min(c.sobregiro, c.cantidad)}</button></div></div>`).join(''), 'deu')}
      ${tarjeta('Bodega que no existe', 'Productos con stock en una bodega que no está registrada. Créala en Bodegas con ese nombre o trasládalos.', a.fuera.length, a.fuera.map(c => `<div class="shi-fila"><div><b>${esc(c.nombre)}</b><small>«${esc(c.bodega)}» · ${c.cantidad} u.</small></div></div>`).join(''), 'fue')}
      ${tarjeta('Lotes que no suman el total', 'El desglose por lote no coincide con la cantidad del producto.', a.lotes.length, a.lotes.map(c => `<div class="shi-fila"><div><b>${esc(c.nombre)}</b><small>total ${c.cantidad} · lotes ${c.lotes}</small></div></div>`).join(''), 'lot')}
      ${tarjeta('Cantidades negativas', 'No debería pasar: revísalo con un ajuste.', a.negativos.length, a.negativos.map(c => `<div class="shi-fila"><div><b>${esc(c.nombre)}</b><small>${c.cantidad}</small></div></div>`).join(''), 'neg')}
    </div>`;
    r.querySelector('#sal-re').onclick = () => abrir();
    const conf = async (o) => (window.SAR_Progreso && window.SAR_Progreso.confirmar) ? window.SAR_Progreso.confirmar(o) : window.confirm(String(o.texto || '').replace(/<[^>]+>/g, ''));
    const correr = async (btn, titulo, fn, ok) => { btn.disabled = true; const p = window.SAR_Progreso ? window.SAR_Progreso.iniciar(titulo, ['Trabajando…']) : null;
      try { const res = await fn(p ? p.paso : null); if (p) p.listo(typeof ok === 'function' ? ok(res) : ok); await abrir(); } catch (e) { if (p) p.error(); toast('No se pudo', (e && e.message) || String(e), 'error'); btn.disabled = false; } };
    r.querySelectorAll('[data-nom]').forEach(b => b.onclick = async () => { const c = a.nombres[+b.dataset.nom];
      if (await conf({ titulo: 'Unificar nombre de bodega', texto: `Todo lo escrito como ${c.formas.map(v => '«' + esc(v) + '»').join(', ')} quedará como <b>«${esc(c.nombre)}»</b> (${c.productos} producto(s)). No cambia el stock.`, si: 'Unificar', no: 'Cancelar' }))
        correr(b, 'Unificando el nombre de la bodega…', (p) => corregirNombre(c, p), (n) => `${c.nombre}: ${n} producto(s) corregidos`); });
    r.querySelectorAll('[data-asig]').forEach(b => b.onclick = async () => { const c = a.sinBodega[+b.dataset.asig], bod = r.querySelector(`[data-sb="${b.dataset.asig}"]`).value;
      if (await conf({ titulo: 'Asignar bodega', texto: `<b>${esc(c.nombre)}</b> (${c.cantidad} u.) quedará en <b>${esc(bod)}</b>. Si ahí ya existe el mismo producto, después aparecerá en «repetidos» para unirlo.`, si: 'Asignar', no: 'Cancelar' }))
        correr(b, 'Asignando bodega…', () => asignarBodega(c.id, bod), `${c.nombre}: ahora en ${bod}`); });
    r.querySelectorAll('[data-unir]').forEach(b => b.onclick = async () => { const g = a.repetidos[+b.dataset.unir], U = window.SAR_Unificar, fz = U.fusionar(g.grupo);
      if (await conf({ titulo: 'Unir registros repetidos', texto: `<b>${esc(g.grupo[0].data.name)}</b> en ${esc(g.bodega)}: ${g.grupo.length} registros quedan en uno con <b>${fz.patch.quantity}</b> u.${fz.patch.sobregiro ? ' y <b>' + fz.patch.sobregiro + '</b> adeudadas' : ''}. Actas, solicitudes y cajas pasan al que queda. No se puede deshacer.`, si: 'Unir', no: 'Cancelar' }))
        correr(b, 'Uniendo registros…', () => U.unir(g.grupo, usuario()), `${g.grupo[0].data.name}: un solo registro`); });
    r.querySelectorAll('[data-desc]').forEach(b => b.onclick = async () => { const c = a.deudas[+b.dataset.desc], n = Math.min(c.sobregiro, c.cantidad);
      if (await conf({ titulo: 'Descontar lo adeudado', texto: `<b>${esc(c.nombre)}</b>: se descuentan <b>${n}</b> u. del stock (queda en ${c.cantidad - n}) porque ya se entregaron con acta. Úsalo si en bodega hay físicamente ${c.cantidad - n}.`, si: 'Descontar', no: 'Cancelar' }))
        correr(b, 'Descontando lo adeudado…', () => resolverDeuda(c.id, 'descontar'), (x) => `${c.nombre}: ${x.unidades} u. descontadas`); });
    r.querySelectorAll('[data-reg]').forEach(b => b.onclick = async () => { const c = a.deudas[+b.dataset.reg];
      if (await conf({ titulo: 'Regularizar lo adeudado', texto: `<b>${esc(c.nombre)}</b>: las ${c.sobregiro} u. adeudadas se dan por saldadas y el stock <b>sigue en ${c.cantidad}</b>. Úsalo si en bodega hay físicamente ${c.cantidad} (lo entregado salió de stock que no estaba ingresado).`, si: 'Regularizar', no: 'Cancelar' }))
        correr(b, 'Regularizando…', () => resolverDeuda(c.id, 'regularizar'), (x) => `${c.nombre}: ${x.unidades} u. regularizadas`); });
    pintarBadge();
  }
  function pintarBadge() { const b = document.getElementById('sal-badge'); if (!b || !datos) return; const n = datos.a.total; b.style.display = n ? '' : 'none'; b.textContent = n > 99 ? '99+' : String(n); }
  async function abrir() {
    if (cargando) return; cargando = true; datos = null; pintar();
    try { const l = await leer(); datos = { a: analizar(l.ins, l.bod), tope: l.tope }; }
    catch (e) { const r = document.getElementById('sal-root'); if (r) r.innerHTML = `<div class="si-wrap"><p class="shi-aviso">No pude revisar el inventario: ${esc((e && e.message) || e)}</p></div>`; cargando = false; return; }
    cargando = false; pintar();
  }
  const api = { analizar, abrir, corregirNombre, asignarBodega, resolverDeuda, limpia };
  window.SAR_Salud = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : null);
