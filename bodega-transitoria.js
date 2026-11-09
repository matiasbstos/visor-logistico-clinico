/* ==========================================================================
   BODEGA TRANSITORIA · STOCK OBJETIVO Y CONTEO DIARIO (v21.107)
   Cada bodega de tipo «transitoria» (stock de uso por turno) tiene una DISPOSICIÓN: cuántas unidades de cada
   producto deben estar disponibles (ej. suero: 10). Cada mañana se cuenta y el sistema calcula:
     · Faltante   = lo que el sistema decía que había − lo contado  → se DESCUENTA del stock total (queda como
                    movimiento TRANSITORIA_FALTANTE, por lote que vence primero).
     · Sobrante   = lo contado − lo que decía el sistema → solo se avisa (no suma stock solo).
     · Reponer    = objetivo − contado → se traspasa desde Bodega Central (movimiento «traspaso»).
   Datos (sin reglas nuevas, en Contadores): transitoria-obj-<bodegaId> (objetivos), transitoria-conteo-<bodegaId>-<AAAA-MM-DD> (conteo del día).
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v) || 0;
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const soloDig = (t) => String(t || '').replace(/\D/g, '');
  const hoy = () => new Date().toISOString().slice(0, 10);
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };
  const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
  const CENTRAL = 'Bodega Central';
  const soloConteo = () => document.body && document.body.getAttribute && document.body.getAttribute('data-user-role') === 'transitoria';
  const slug = (t) => norm(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  const claveDe = (nombre, codigo) => soloDig(codigo) || slug(nombre);

  // ---------------- lógica pura ----------------
  /** Cálculo de una fila del conteo. contado null/'' = aún sin contar. */
  function calcularFila(o) {
    const objetivo = Math.max(0, Math.floor(num(o.objetivo))), sistema = Math.max(0, num(o.sistema));
    if (o.contado === null || o.contado === undefined || o.contado === '') return { estado: 'pendiente', faltante: 0, sobrante: 0, reponer: 0, reponible: 0 };
    const contado = Math.max(0, Math.floor(num(o.contado)));
    const faltante = Math.max(0, sistema - contado), sobrante = Math.max(0, contado - sistema);
    const reponer = Math.max(0, objetivo - contado), reponible = Math.min(reponer, Math.max(0, num(o.central)));
    return { estado: faltante > 0 ? 'faltante' : sobrante > 0 ? 'sobrante' : 'ok', contado, faltante, sobrante, reponer, reponible };
  }
  /** Reparte `cantidad` entre documentos [{id, quantity}] en orden; devuelve [{id, quitar}] y lo que no se pudo cubrir. */
  function repartir(docs, cantidad) {
    let falta = Math.max(0, cantidad); const out = [];
    for (const d of docs) { if (falta <= 0) break; const q = Math.min(falta, Math.max(0, num(d.quantity))); if (q > 0) { out.push({ id: d.id, quitar: q }); falta -= q; } }
    return { partes: out, sinCubrir: falta };
  }
  /** Suma lotes de `nuevos` ([{batch, quantity, expirationDate}]) a `existentes`, juntando el mismo lote y vencimiento. */
  function sumarLotes(existentes, nuevos) {
    const m = new Map(); const k = (b) => `${b.batch || 'S/L'}|${b.expirationDate || ''}`;
    (existentes || []).forEach(b => m.set(k(b), { batch: b.batch || 'S/L', quantity: num(b.quantity), expirationDate: b.expirationDate || '' }));
    (nuevos || []).forEach(b => { const x = m.get(k(b)); if (x) x.quantity += num(b.quantity); else m.set(k(b), { batch: b.batch || 'S/L', quantity: num(b.quantity), expirationDate: b.expirationDate || '' }); });
    return [...m.values()];
  }

  // ---------------- datos ----------------
  let bodegas = [], bodegaSel = null, objetivos = {}, insumosBod = [], insumosCentral = [], conteo = {}, cerrado = null, buscaProd = '';
  const doc = (col, id) => fs().doc(fs().collection(db(), col), id);
  async function leerInsumos(nombreBodega) {
    const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('location', '==', nombreBodega))), l = [];
    sn.forEach(d => l.push({ id: d.id, ...d.data() })); return l;
  }
  const coincideInsumo = (i, o) => (soloDig(o.codigo) && soloDig(i.codigoMP || i.code) === soloDig(o.codigo)) || norm(i.name) === norm(o.nombre);
  const docsDe = (lista, o) => lista.filter(i => coincideInsumo(i, o) && i.status !== 'CUARENTENA');
  const sumaQ = (docs) => docs.reduce((t, d) => t + num(d.quantity), 0);

  async function cargarBodegas() {
    const sn = await fs().getDocs(fs().collection(db(), 'Bodegas')); bodegas = [];
    sn.forEach(d => { const x = d.data(); bodegas.push({ id: d.id, name: x.name, type: x.type }); });
    bodegas = bodegas.filter(b => b.name).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (!bodegaSel || !bodegas.some(b => b.id === bodegaSel)) { const t = bodegas.find(b => b.type === 'transitoria') || bodegas.find(b => b.name === CENTRAL) || bodegas[0]; bodegaSel = t ? t.id : null; }
  }
  async function cargarBodega() {
    conteo = {}; cerrado = null; objetivos = {}; insumosBod = []; insumosCentral = [];
    const b = bodegas.find(x => x.id === bodegaSel); if (!b) return;
    const [o, cu, ib, ic] = await Promise.all([
      fs().getDoc(doc('Contadores', 'transitoria-obj-' + b.id)).catch(() => null),
      fs().getDoc(doc('Contadores', `transitoria-conteo-${b.id}-${hoy()}`)).catch(() => null),
      leerInsumos(b.name), leerInsumos(CENTRAL)
    ]);
    if (o && o.exists()) objetivos = o.data().items || {};
    if (cu && cu.exists() && cu.data().aplicado) cerrado = cu.data();
    insumosBod = ib; insumosCentral = ic;
  }
  async function guardarObjetivos() {
    const b = bodegas.find(x => x.id === bodegaSel);
    await fs().setDoc(doc('Contadores', 'transitoria-obj-' + b.id), { tipo: 'transitoria-objetivos', bodegaId: b.id, bodega: b.name, items: objetivos, actualizadoPor: usuario(), updatedAt: fs().serverTimestamp() });
  }

  /** Filas de la pantalla: una por producto con objetivo. */
  function filas() {
    return Object.entries(objetivos).map(([k, o]) => {
      const dB = docsDe(insumosBod, o), dC = docsDe(insumosCentral, o), sistema = sumaQ(dB), central = sumaQ(dC);
      const c = conteo[k] === undefined ? '' : conteo[k];
      return { k, o, dB, dC, sistema, central, calc: calcularFila({ objetivo: o.objetivo, sistema, contado: c, central }), contado: c };
    }).sort((a, b) => String(a.o.nombre).localeCompare(String(b.o.nombre), 'es'));
  }

  // ---------------- acciones con transacción ----------------
  async function cerrarConteo() {
    const b = bodegas.find(x => x.id === bodegaSel), lista = filas();
    if (lista.some(r => r.calc.estado === 'pendiente')) throw new Error('Falta contar algún producto. Ingresa el conteo de todos (0 si no hay).');
    const SA = window.SAR_ActasEntrega; if (!SA || !SA.descontarFEFO) throw new Error('El módulo de stock no está cargado.');
    const f = fs(), fecha = hoy(), cref = doc('Contadores', `transitoria-conteo-${b.id}-${fecha}`);
    const conF = lista.filter(r => r.calc.faltante > 0);
    await f.runTransaction(db(), async (tx) => {
      const prev = await tx.get(cref); if (prev.exists() && prev.data().aplicado) throw new Error('El conteo de hoy ya se cerró.');
      const refs = [], leidos = new Map();
      for (const r of conF) for (const d of r.dB) if (!leidos.has(d.id)) { const ref = doc('Insumos', d.id); refs.push(ref); leidos.set(d.id, await tx.get(ref)); }
      const cambios = [];
      for (const r of conF) {
        const docs = r.dB.map(d => ({ id: d.id, quantity: num(leidos.get(d.id).data().quantity) })), rp = repartir(docs, r.calc.faltante);
        if (rp.sinCubrir > 0) throw new Error(`${r.o.nombre}: el stock cambió mientras contabas. Actualiza y vuelve a contar.`);
        rp.partes.forEach(p => { const d = leidos.get(p.id).data(), pl = SA.descontarFEFO(d, p.quitar); cambios.push({ id: p.id, d, pl, cant: p.quitar, nombre: r.o.nombre }); });
      }
      cambios.forEach(c => {
        tx.update(doc('Insumos', c.id), { quantity: c.pl.quantity, batches: c.pl.batches, updatedAt: f.serverTimestamp() });
        tx.set(f.doc(f.collection(db(), 'Historial_Movimientos')), { insumoName: c.d.name, quantity: c.cant, type: 'TRANSITORIA_FALTANTE', user: usuario(), date: f.serverTimestamp(), document: `CONTEO-${b.name}-${fecha}`, batch: c.pl.usados.length === 1 ? c.pl.usados[0].batch : 'MULTI-LOTE', origin: b.name, lotes: c.pl.usados, idInsumoOrigen: c.id, observacion: `Faltante en el conteo diario de ${b.name} (${fecha}): sale del stock total` });
      });
      tx.set(cref, { tipo: 'transitoria-conteo', bodegaId: b.id, bodega: b.name, fecha, aplicado: true, por: usuario(), creadoEn: f.serverTimestamp(), filas: lista.map(r => ({ nombre: r.o.nombre, codigo: r.o.codigo || '', objetivo: num(r.o.objetivo), sistema: r.sistema, contado: r.calc.contado, faltante: r.calc.faltante, sobrante: r.calc.sobrante })) });
    });
  }
  async function reponer() {
    const b = bodegas.find(x => x.id === bodegaSel); const SA = window.SAR_ActasEntrega; if (!SA || !SA.descontarFEFO) throw new Error('El módulo de stock no está cargado.');
    const lista = filas().filter(r => r.calc.estado !== 'pendiente' && r.calc.reponible > 0);
    if (!lista.length) throw new Error('No hay nada para reponer (cuenta primero, o la Bodega Central no tiene stock).');
    const f = fs(), fecha = hoy(), docTxt = `REPOSICION-${b.name}-${fecha}`;
    await f.runTransaction(db(), async (tx) => {
      const leidos = new Map(), rd = async (id) => { if (!leidos.has(id)) leidos.set(id, await tx.get(doc('Insumos', id))); return leidos.get(id); };
      const trabajos = [];
      for (const r of lista) {
        for (const d of r.dC) await rd(d.id); for (const d of r.dB) await rd(d.id);
        const rp = repartir(r.dC.map(d => ({ id: d.id, quantity: num(leidos.get(d.id).data().quantity) })), r.calc.reponible), movidos = [];
        const total = r.calc.reponible - rp.sinCubrir; if (total <= 0) continue;
        rp.partes.forEach(p => { const d = leidos.get(p.id).data(), pl = SA.descontarFEFO(d, p.quitar); movidos.push({ p, d, pl }); });
        trabajos.push({ r, movidos, total });
      }
      if (!trabajos.length) throw new Error('La Bodega Central no tiene stock de lo que falta reponer.');
      trabajos.forEach(({ r, movidos, total }) => {
        const usados = movidos.flatMap(m => m.pl.usados).map(u => ({ batch: u.batch, quantity: u.used, expirationDate: u.expirationDate || '' }));
        movidos.forEach(m => tx.update(doc('Insumos', m.p.id), { quantity: m.pl.quantity, batches: m.pl.batches, updatedAt: f.serverTimestamp() }));
        const destino = r.dB[0], base = movidos[0].d;
        if (destino) {
          const dd = leidos.get(destino.id).data(), lotes = sumarLotes(SA.lotesDeDoc(dd), usados);
          tx.update(doc('Insumos', destino.id), { quantity: num(dd.quantity) + total, batches: lotes, updatedAt: f.serverTimestamp() });
        } else {
          const nuevo = f.doc(f.collection(db(), 'Insumos')), lotes = sumarLotes([], usados);
          tx.set(nuevo, Object.assign({}, base, { quantity: total, batches: lotes, location: b.name, bodegaId: b.id, sobregiro: 0, createdAt: f.serverTimestamp(), updatedAt: f.serverTimestamp(), createdBy: usuario() }));
        }
        tx.set(f.doc(f.collection(db(), 'Historial_Movimientos')), { insumoName: base.name, quantity: total, type: 'traspaso', user: usuario(), date: f.serverTimestamp(), document: docTxt, batch: usados.length === 1 ? usados[0].batch : 'MULTI-LOTE', origin: CENTRAL, dest: b.name, lotes: usados.map(u => ({ batch: u.batch, used: u.quantity, expirationDate: u.expirationDate })), observacion: `Reposición diaria a ${b.name} (objetivo ${num(r.o.objetivo)}, contado ${r.calc.contado})` });
      });
    });
  }

  // ---------------- planilla Excel (ubicación por estante) ----------------
  const ESTANTES = ['A1','A2','A3','A4','A5','A6','B1','B2','B3','B4','B5','B6','C1','C2','C3','C4','C5','C6'];
  const estanteDe = (o) => { const d = docsDe(insumosBod, o).find(x => x.ubicacionEstante); return d ? d.ubicacionEstante : ''; };
  const normEstante = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  /** Filas de la planilla: todo lo que hay en la bodega (stock del sistema) + productos con disposición sin stock. */
  function filasPlanilla() {
    const m = new Map();
    insumosBod.filter(i => i.status !== 'CUARENTENA').forEach(i => {
      const cod = soloDig(i.codigoMP || i.code), k = claveDe(i.name, cod), x = m.get(k) || { nombre: i.name, codigo: cod, sistema: 0, estante: '' };
      x.sistema += num(i.quantity); x.estante = x.estante || i.ubicacionEstante || ''; m.set(k, x);
    });
    Object.entries(objetivos).forEach(([k, o]) => { if (!m.has(k)) m.set(k, { nombre: o.nombre, codigo: o.codigo || '', sistema: 0, estante: '' }); });
    return [...m.entries()].map(([k, x]) => ({ k, ...x, objetivo: objetivos[k] ? num(objetivos[k].objetivo) : '' })).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  }
  function descargarPlanilla() {
    if (typeof XLSX === 'undefined') throw new Error('El generador de Excel aún no carga. Intenta de nuevo en unos segundos.');
    const b = bodegas.find(x => x.id === bodegaSel), fecha = hoy();
    const aoa = [['Estante / ubicación', 'Producto', 'ID', 'Stock sistema', 'Disposición', 'Contado', 'Responsable', 'Observación']]
      .concat(filasPlanilla().map(r => [r.estante, r.nombre, r.codigo, r.sistema, r.objetivo, '', '', '']));
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 18 }, { wch: 46 }, { wch: 14 }, { wch: 13 }, { wch: 12 }, { wch: 11 }, { wch: 16 }, { wch: 30 }];
    const wsE = XLSX.utils.aoa_to_sheet([['Estantes válidos'], ...ESTANTES.map(e => [e])]), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bodega'); XLSX.utils.book_append_sheet(wb, wsE, 'Estantes');
    XLSX.writeFile(wb, `Planilla_${slug(b.name)}_${fecha}.xlsx`);
  }
  /** Lee la planilla: asigna estante (se guarda en los Insumos de la bodega) y carga lo contado (sin cerrar el conteo). */
  async function subirPlanilla(file) {
    if (typeof XLSX === 'undefined') throw new Error('El lector de Excel aún no carga.');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]], filas = XLSX.utils.sheet_to_json(ws, { defval: '' });
    let asignados = 0, contados = 0; const sinMatch = [], f = fs(), _c = {};
    for (const r of filas) {
      const nombre = r['Producto'] || '', codigo = soloDig(r['ID']); if (!nombre && !codigo) continue;
      const o = { nombre, codigo }, est = normEstante(r['Estante / ubicación']), k = claveDe(nombre, codigo);
      const docs = docsDe(insumosBod, o);
      if (est) {
        if (!docs.length) { sinMatch.push(nombre || codigo); }
        else for (const d of docs) { if (d.ubicacionEstante !== est) { await f.updateDoc(doc('Insumos', d.id), { ubicacionEstante: est, updatedAt: f.serverTimestamp() }); asignados++; } }
      }
      const c = r['Contado'];
      if (c !== '' && c !== null && !isNaN(Number(c)) && objetivos[k]) { _c[k] = Math.max(0, Math.floor(Number(c))); contados++; }
    }
    return { asignados, contados, sinMatch, _c };
  }

  // ---------------- interfaz ----------------
  const root = () => document.getElementById('tra-root');
  function pintar() {
    const r = root(); if (!r) return;
    const b = bodegas.find(x => x.id === bodegaSel), lista = b ? filas() : [];
    const nSin = lista.filter(x => x.calc.estado === 'pendiente').length, tFalt = lista.reduce((t, x) => t + x.calc.faltante, 0), tRep = lista.reduce((t, x) => t + x.calc.reponible, 0);
    const sug = buscaProd.trim().length >= 2 ? sugerir(buscaProd) : [];
    r.innerHTML = `<div class="page-header mb-16"><div class="page-title"><h1>Bodega transitoria · reposición diaria</h1></div></div>
      <p class="act-hint">Define cuánto debe haber de cada producto. Cada mañana cuentas: lo que falta se descuenta del stock total y lo que hay que reponer sale de la Bodega Central.</p>
      <div class="tra-bar"><label class="act-l">Bodega transitoria<select id="tra-bod">${bodegas.length ? bodegas.map(x => `<option value="${esc(x.id)}"${x.id === bodegaSel ? ' selected' : ''}>${esc(x.name)}${x.type === 'transitoria' ? '' : ' (no es transitoria)'}</option>`).join('') : '<option value="">Sin bodegas</option>'}</select></label></div>
      ${!b ? '<p class="act-hint">No hay una bodega de tipo «Transitoria». Créala en Bodegas (tipo: Bodega Transitoria) y vuelve aquí.</p>' : `
      <div class="tra-ks"><div class="vp-k" style="--c:var(--sar-blue)"><b>${lista.length}</b><span>Productos con disposición</span></div><div class="vp-k" style="--c:var(--sar-yellow)"><b>${nSin}</b><span>Sin contar hoy</span></div><div class="vp-k" style="--c:var(--sar-red)"><b>${tFalt}</b><span>Faltante (se descuenta)</span></div><div class="vp-k" style="--c:var(--sar-green)"><b>${tRep}</b><span>A reponer desde Central</span></div></div>
      ${b.type !== 'transitoria' ? '<p class="act-hint"><b>Aún no hay una bodega transitoria</b> (créala en Bodegas, tipo «Bodega Transitoria»). Mientras tanto puedes descargar la planilla de esta bodega para compartirla.</p>' : ''}
      ${cerrado ? `<p class="tra-ok"><i class="ph-bold ph-seal-check"></i> El conteo de hoy ya se cerró (${esc(cerrado.por || '')}). Puedes reponer lo que falte; el conteo de mañana empieza limpio.</p>` : ''}
      <div class="data-table-card"><h3>Conteo de hoy (${esc(hoy().split('-').reverse().join('/'))})</h3>
        ${lista.length ? `<div class="tra-tabla"><table><thead><tr><th>Estante</th><th>Producto</th><th class="n">Disposición</th><th class="n">Sistema</th><th class="n">Contado</th><th class="n">Faltante</th><th class="n">Reponer</th><th class="n">En Central</th><th></th></tr></thead><tbody>${lista.map(x => `<tr class="tra-${x.calc.estado}"><td><b>${esc(estanteDe(x.o) || '—')}</b></td><td>${esc(x.o.nombre)}${x.o.codigo ? '<br><small>ID ' + esc(x.o.codigo) + '</small>' : ''}</td>
          <td class="n"><input type="number" min="0" class="tra-obj" data-k="${esc(x.k)}" value="${num(x.o.objetivo)}" aria-label="Disposición de ${esc(x.o.nombre)}"></td><td class="n">${x.sistema}</td>
          <td class="n"><input type="number" min="0" class="tra-cont" data-k="${esc(x.k)}" value="${esc(x.contado)}" placeholder="—" aria-label="Contado de ${esc(x.o.nombre)}"${cerrado ? ' disabled' : ''}></td>
          <td class="n tra-f">${x.calc.estado === 'pendiente' ? '—' : (x.calc.faltante || (x.calc.sobrante ? '+' + x.calc.sobrante : 0))}</td><td class="n tra-r">${x.calc.estado === 'pendiente' ? '—' : x.calc.reponible + (x.calc.reponer > x.calc.reponible ? ` <small>(faltan ${x.calc.reponer - x.calc.reponible} en Central)</small>` : '')}</td><td class="n">${x.central}</td>
          <td><button type="button" class="btn btn-outline btn-sm tra-quitar" data-k="${esc(x.k)}" aria-label="Quitar ${esc(x.o.nombre)}">Quitar</button></td></tr>`).join('')}</tbody></table></div>
        <div class="tra-acc"><button type="button" class="btn btn-primary" id="tra-cerrar"${cerrado ? ' disabled' : ''}>Cerrar conteo y descontar faltantes</button><button type="button" class="btn btn-outline" id="tra-reponer"${tRep ? '' : ' disabled'}>Reponer desde Bodega Central (${tRep} u.)</button></div>` : '<p class="act-hint">Aún no defines qué productos van en esta bodega. Agrégalos abajo.</p>'}</div>
      <div class="data-table-card mt-24"><h3>Planilla Excel de la bodega</h3><p class="act-hint">Descarga la planilla con todo lo que el sistema dice que hay aquí. Quien toma el inventario anota el <b>estante</b> (A1–C6) y lo <b>contado</b>; luego la subes y el Visor asigna las ubicaciones y carga el conteo (el descuento de faltantes sigue siendo con «Cerrar conteo»).</p>
        <div class="tra-acc"><button type="button" class="btn btn-outline" id="tra-xls-bajar"><i class="ph-bold ph-download-simple"></i> Descargar planilla</button><button type="button" class="btn btn-outline" id="tra-xls-subir"><i class="ph-bold ph-upload-simple"></i> Subir planilla</button><input type="file" id="tra-xls-file" accept=".xlsx,.xls" style="display:none" aria-label="Subir planilla de la bodega"></div></div>
      <div class="data-table-card mt-24"><h3>Agregar producto a la disposición</h3><input type="search" id="tra-bus" class="form-control" placeholder="ID o nombre del producto…" value="${esc(buscaProd)}" autocomplete="off">
        <div class="tra-sug">${sug.map((s, i) => `<button type="button" class="vp-op tra-add" data-i="${i}"><b>${esc(s.nombre)}</b>${s.codigo ? ' <small>ID ' + esc(s.codigo) + '</small>' : ''}</button>`).join('')}</div></div>`}`;
    if (soloConteo()) {
      r.querySelectorAll('.tra-quitar, #tra-cerrar, #tra-reponer, .tra-acc:has(#tra-cerrar)').forEach(e => e.remove());
      r.querySelectorAll('.tra-obj').forEach(e => { e.disabled = true; });
      const ag = [...r.querySelectorAll('.data-table-card')].find(c => c.querySelector('#tra-bus')); if (ag) ag.remove();
    }
    enlazar(sug);
  }
  function sugerir(q) {
    const t = norm(q).split(' ').filter(Boolean), d = soloDig(q), mapa = new Map();
    [...insumosCentral, ...insumosBod].forEach(i => { const cod = soloDig(i.codigoMP || i.code), k = claveDe(i.name, cod); if (objetivos[k] || mapa.has(k)) return; if ((d.length >= 4 && cod.includes(d)) || t.every(w => norm(i.name).includes(w))) mapa.set(k, { nombre: i.name, codigo: cod }); });
    return [...mapa.values()].slice(0, 10);
  }
  function enlazar(sug) {
    const r = root(), $$ = (s) => r.querySelectorAll(s), proteger = async (fn, ok) => { try { await fn(); if (ok) toast('Bodega transitoria', ok, 'success'); await cargarBodega(); pintar(); } catch (e) { toast('No se pudo', e.message || String(e), 'error'); } };
    const sb = r.querySelector('#tra-bod'); if (sb) sb.addEventListener('change', async () => { bodegaSel = sb.value; await cargarBodega(); pintar(); });
    const bus = r.querySelector('#tra-bus'); if (bus) bus.addEventListener('input', () => { buscaProd = bus.value; const p = bus.selectionStart; pintar(); const n = document.getElementById('tra-bus'); if (n) { n.focus(); n.setSelectionRange(p, p); } });
    $$('.tra-add').forEach(b => b.addEventListener('click', () => { const s = sug[+b.dataset.i]; objetivos[claveDe(s.nombre, s.codigo)] = { nombre: s.nombre, codigo: s.codigo, objetivo: 10 }; buscaProd = ''; proteger(guardarObjetivos, 'Producto agregado. Ajusta su disposición.'); }));
    $$('.tra-obj').forEach(i => i.addEventListener('change', () => { objetivos[i.dataset.k].objetivo = Math.max(0, Math.floor(num(i.value))); proteger(guardarObjetivos); }));
    $$('.tra-quitar').forEach(b => b.addEventListener('click', () => { delete objetivos[b.dataset.k]; delete conteo[b.dataset.k]; proteger(guardarObjetivos); }));
    $$('.tra-cont').forEach(i => i.addEventListener('change', () => { conteo[i.dataset.k] = i.value === '' ? undefined : Math.max(0, Math.floor(num(i.value))); pintar(); }));
    const xb = r.querySelector('#tra-xls-bajar'); if (xb) xb.addEventListener('click', () => { try { descargarPlanilla(); } catch (e) { toast('No se pudo', e.message, 'error'); } });
    const xs = r.querySelector('#tra-xls-subir'), xf = r.querySelector('#tra-xls-file');
    if (xs && xf) { xs.addEventListener('click', () => xf.click()); xf.addEventListener('change', async () => { const fl = xf.files[0]; if (!fl) return; try { const res = await subirPlanilla(fl); const prev = { ...conteo }; await cargarBodega(); Object.assign(conteo, prev, res._c); toast('Planilla cargada', `${res.asignados} ubicaciones asignadas, ${res.contados} conteos cargados${res.sinMatch.length ? '. Sin stock en esta bodega: ' + res.sinMatch.slice(0, 5).join(', ') : ''}.`, res.sinMatch.length ? 'warning' : 'success'); pintar(); } catch (e) { toast('No se pudo leer la planilla', e.message || String(e), 'error'); } }); }
    const c = r.querySelector('#tra-cerrar'); if (c) c.addEventListener('click', () => { if (!confirm('Se cerrará el conteo de hoy y los FALTANTES se descontarán del stock total.\n\n¿Continuar?')) return; c.disabled = true; proteger(cerrarConteo, 'Conteo cerrado: faltantes descontados del stock.'); });
    const rp = r.querySelector('#tra-reponer'); if (rp) rp.addEventListener('click', () => { if (!confirm('Se traspasará stock de la Bodega Central a esta bodega para llegar a la disposición.\n\n¿Reponer?')) return; rp.disabled = true; const keep = { ...conteo }; proteger(async () => { await reponer(); }, 'Reposición hecha: stock traspasado desde la Bodega Central.').then(() => { Object.assign(conteo, keep); }); });
  }
  async function abrir() {
    const r = root(); if (!r) return;
    r.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando la bodega transitoria…') : 'Cargando…';
    try { await cargarBodegas(); await cargarBodega(); pintar(); } catch (e) { r.innerHTML = `<p class="act-err" style="padding:24px">No se pudo cargar: ${esc(e.message || e)}</p>`; }
  }

  const api = { abrir, normEstante, calcularFila, repartir, sumarLotes, claveDe };
  if (typeof window !== 'undefined') window.SAR_Transitoria = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
