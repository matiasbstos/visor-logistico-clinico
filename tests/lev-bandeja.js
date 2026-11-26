/* Bandeja «Levantamientos por aprobar» (DECISIONES 4.307): la transacción por producto y bodega contra un Firestore en memoria
   con transacciones optimistas (lecturas versionadas, reintento si otra escritura cambió lo leído), como el SDK real.
   Uso: node tests/lev-bandeja.js */
const assert = require('assert');
globalThis.window = globalThis;
globalThis.document = { body: { dataset: { userRole: 'admin' } }, getElementById: () => null };
let EN_LINEA = true;

// ---------------- Firestore en memoria ----------------
let DB = new Map(), VER = new Map(), conflictoUnaVez = null;
const cl = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const tick = () => new Promise(r => setImmediate(r));
const ref = (path) => ({ path, id: path.split('/').pop() });
const snap = (path) => { const d = DB.get(path); return { id: path.split('/').pop(), ref: ref(path), exists: () => d !== undefined, data: () => cl(d), metadata: { hasPendingWrites: false } }; };
const escribir = (path, data, merge) => { const prev = DB.get(path); DB.set(path, merge && prev ? { ...prev, ...cl(data) } : cl(data)); VER.set(path, (VER.get(path) || 0) + 1); };
const hijos = (col) => [...DB.keys()].filter(p => p.startsWith(col + '/') && p.slice(col.length + 1).indexOf('/') < 0).sort();
let reintentos = 0;
globalThis.firebaseDb = {};
globalThis.firebaseAuth = { currentUser: { email: 'admin@sar.cl' } };
globalThis.firebaseFirestore = {
  collection: (_db, ...seg) => ({ col: seg.join('/') }),
  doc: (a, ...seg) => a && a.col ? ref(a.col + '/' + (seg[0] || 'auto' + Math.random().toString(36).slice(2, 10))) : ref(seg.join('/')),
  where: (f, op, v) => ({ f, op, v }), limit: () => null,
  query: (c, ...w) => ({ col: c.col, w: w.filter(Boolean) }),
  serverTimestamp: () => '2026-11-23T12:00:00.000Z', deleteField: () => undefined,
  getDoc: async (r) => { await tick(); return snap(r.path); },
  getDocs: async (q) => { await tick(); const l = hijos(q.col).filter(p => (q.w || []).every(w => (DB.get(p) || {})[w.f] === w.v)).map(snap); return { docs: l, size: l.length, empty: !l.length, forEach: (fn) => l.forEach(fn) }; },
  setDoc: async (r, d, o) => escribir(r.path, d, o && o.merge),
  updateDoc: async (r, d) => escribir(r.path, d, true),
  runTransaction: async (_db, fn) => {
    for (let intento = 0; intento < 6; intento++) {
      const leidas = new Map(), w = [];
      const tx = { get: async (r) => { await tick(); leidas.set(r.path, VER.get(r.path) || 0); return snap(r.path); },
        set: (r, d, o) => w.push([r.path, d, !!(o && o.merge)]), update: (r, d) => { w.push([r.path, d, true, true]); } };
      const res = await fn(tx);
      if (conflictoUnaVez) { const p = conflictoUnaVez; conflictoUnaVez = null; escribir(p, { tocado: Date.now() }, true); }   /* otra escritura justo antes del commit */
      if ([...leidas].some(([p, v]) => (VER.get(p) || 0) !== v)) { reintentos++; continue; }   /* el SDK reintenta la función completa */
      w.forEach(([p, d, m, upd]) => { if (upd && !DB.has(p)) throw new Error('update de un documento que no existe: ' + p); escribir(p, d, m); });
      return res;
    }
    throw new Error('demasiados reintentos');
  }
};
// ---------------- módulos ----------------
require('../toma-conciliacion.js'); require('../correlativos.js'); require('../tags-conteo.js');
globalThis.SAR_Cola = { hayConexion: async () => EN_LINEA };
let nCod = 0; globalThis.SAR_Gobernanza = { codigo: async (t) => `${t}-2026-${String(++nCod).padStart(6, '0')}` };
let folioBul = 900; globalThis.SAR_Bultos = { reservarFolios: async (n) => { const ini = folioBul + 1; folioBul += n; return { anio: 2026, ini, enLinea: true }; } };
globalThis.fefoCompare = (a, b) => String(a.expirationDate || '9999').localeCompare(String(b.expirationDate || '9999'));
const LB = require('../levantamiento-bandeja.js');

// ---------------- datos ----------------
const YO = 'admin@sar.cl', ANA = 'ana@sar.cl', BOD = 'Bodega CAM';
let nTag = 100;
function reset(insumos) { DB = new Map(); VER = new Map(); reintentos = 0; Object.entries(insumos || {}).forEach(([id, d]) => escribir('Insumos/' + id, { name: id.toUpperCase(), location: BOD, quantity: (d.batches || []).reduce((t, b) => t + b.quantity, 0), ...d })); }
function caja(o) {
  const folio = `BUL-2026-${String(++nTag).padStart(6, '0')}`, e = o.estructura || { estado: 'CERRADA', interiores: [], sueltas: o.total };
  const c = { folio, bodega: BOD, bodegaId: '', insumoId: o.insumoId || null, nombre: o.nombre || String(o.insumoId || '').toUpperCase(), nombreNorm: String(o.nombre || o.insumoId || '').toLowerCase(), nuevo: !!o.nuevo, tipo: null, controlado: o.controlado || null,
    lote: o.lote, vence: o.vence || '2027-05', sinLote: o.lote === 'S/L', estructura: e, total: o.total, contadoPor: o.por || ANA, contadoNombre: 'Ana', en: '2026-11-23T10:00:00.000Z', servidorEn: 'x', estado: 'REGISTRADO', app: '21.250',
    baseSistema: o.base === undefined ? null : o.base, baseSistemaEn: '2026-11-23T10:00:00.000Z', deudaSistema: o.deuda || 0, ...(o.baseSL !== undefined ? { baseSL: o.baseSL } : {}), huella: 'h' + folio + o.total, ...(o.extra || {}) };
  escribir('Conteos_Cajas/' + folio, c); escribir('Contadores/bulto-' + folio, { tipo: 'tag-conteo', folio, estado: 'TAG', creadoEn: '2026-11-20T09:00:00.000Z' });
  return c;
}
const recontar = (c, cambios) => { const d = { ...DB.get('Conteos_Cajas/' + c.folio), ...cambios, estado: 'REGISTRADO', reconteoEn: '2026-11-23T11:00:00.000Z', reconteoPedidoPor: YO, editadoEn: '2026-11-23T11:30:00.000Z' }; d.huella = 'h' + c.folio + d.total + 'r'; escribir('Conteos_Cajas/' + c.folio, d); return d; };
const grupo = (cs, extra) => ({ bodega: BOD, bodegaId: '', nombre: cs[0].nombre, nuevo: cs.some(c => c.nuevo), controlado: cs.find(c => c.controlado) ? cs.find(c => c.controlado).controlado : null, cajas: cs.map(c => DB.get('Conteos_Cajas/' + c.folio)), ...(extra || {}) });
const ins = (id) => DB.get('Insumos/' + id);
const lotes = (id) => (ins(id).batches || []).map(b => `${b.batch}:${b.quantity}`).sort().join(' ');
const hist = () => [...DB.keys()].filter(p => p.startsWith('Historial_Movimientos/')).map(p => DB.get(p));
const estado = (c) => DB.get('Conteos_Cajas/' + c.folio).estado;
const bul = () => [...DB.keys()].filter(p => p.startsWith('Contadores/bulto-') && DB.get(p).tipo === 'bulto');
const desp = (id, lote, q) => { const d = ins(id), b = d.batches.find(x => x.batch === lote); b.quantity -= q; escribir('Insumos/' + id, { ...d, quantity: d.quantity - q }); };   /* despacho / traspaso entre el conteo y la aceptación */
const debe = async (p, tipo) => { try { await p; } catch (e) { assert.strictEqual(e.tipo, tipo, `esperaba error «${tipo}», vino «${e.tipo}»: ${e.message}`); return e; } throw new Error(`esperaba error «${tipo}» y se aceptó`); };

let n = 0, mal = 0; const R = [];
const t = async (nombre, f) => { try { const r = await f(); n++; R.push(['OK', nombre, r || '']); } catch (e) { mal++; R.push(['FALLA', nombre, e.stack || e.message]); } };

(async () => {
  await t('1. Alta caja por caja (lote nuevo; producto que no estaba en la bodega se crea copiando la ficha)', async () => {
    reset({ g1: { batches: [{ batch: 'A', quantity: 100, expirationDate: '2027-01' }] } }); escribir('Insumos/x9', { name: 'X9', location: 'Bodega Central', quantity: 5, criticalLimit: 7, codigoMP: '123', batches: [] });
    const c1 = caja({ insumoId: 'g1', lote: 'N', total: 30 }), c2 = caja({ insumoId: 'x9', nombre: 'X9', lote: 'Z', total: 12 });
    const r = await LB.aceptar(grupo([c1]), { modo: 'caja' });
    assert.strictEqual(lotes('g1'), 'A:100 N:30'); assert.strictEqual(ins('g1').quantity, 130); assert.strictEqual(estado(c1), 'ACEPTADO');
    const h = hist().filter(x => x.type === 'INGRESO_INVENTARIO'); assert.strictEqual(h.length, 1); assert.strictEqual(h[0].quantity, 30); assert.strictEqual(h[0].document, r.lev); assert.ok(/^LEV-2026-00001$/.test(r.lev));
    const r2 = await LB.aceptar(grupo([c2]), { modo: 'caja' }); const nd = DB.get('Insumos/lev_x9__bodega-cam');
    assert.ok(nd && nd.quantity === 12 && nd.codigoMP === '123' && nd.criticalLimit === 7 && nd.location === BOD && !nd.levProvisional && nd.origenLev === true, JSON.stringify(nd)); assert.strictEqual(ins('x9').quantity, 5); assert.strictEqual(r2.lev, r.lev);
    return `g1 ${lotes('g1')} · X9 nueva en CAM 12 (Central sigue 5) · ${r.lev}`;
  });
  await t('2. Dos cajas del mismo lote nuevo, una tras otra → 100 (no 50)', async () => {
    reset({ g1: { batches: [] } });
    const a = caja({ insumoId: 'g1', lote: 'M', total: 50 }), b = caja({ insumoId: 'g1', lote: 'M', total: 50 });
    await LB.aceptar(grupo([a]), { modo: 'caja' }); await LB.aceptar(grupo([b]), { modo: 'caja' });
    assert.strictEqual(lotes('g1'), 'M:100'); assert.strictEqual(ins('g1').quantity, 100);
    const c = caja({ insumoId: 'g1', lote: 'M', total: 50, base: 100 });   /* contada DESPUÉS de aceptar las otras: su base ya incluye lo aplicado */
    await LB.aceptar(grupo([c]), { modo: 'caja' }); assert.strictEqual(lotes('g1'), 'M:150');
    const reg = [...DB.keys()].filter(p => p.startsWith('Levantamientos/')).map(p => DB.get(p))[0]; assert.deepStrictEqual([reg.base, reg.contadoAceptado, reg.aplicado], [0, 150, 150]);
    return 'M = 100 tras 2 cajas; 3.ª caja contada después (base 100) → 150; registro {base 0, contado 150, aplicado 150}';
  });
  await t('3. Despacho entre el conteo y la aceptación → se rechaza y pide recontar', async () => {
    reset({ g1: { batches: [{ batch: 'A', quantity: 100, expirationDate: '2027-01' }] } });
    const c = caja({ insumoId: 'g1', lote: 'A', vence: '2027-01', total: 100, base: 100 }); desp('g1', 'A', 10);
    const e = await debe(LB.aceptar(grupo([c]), { modo: 'completo' }), 'movido');
    assert.strictEqual(lotes('g1'), 'A:90'); assert.strictEqual(estado(c), 'REGISTRADO'); assert.strictEqual(hist().length, 0); assert.ok(/Recontar/.test(e.message));
    await LB.pedirReconteo(c); assert.strictEqual(estado(c), 'RECONTEO'); recontar(c, { total: 90, baseSistema: 90, estructura: { estado: 'CERRADA', interiores: [], sueltas: 90 } });
    await LB.aceptar(grupo([c]), { modo: 'completo' }); assert.strictEqual(lotes('g1'), 'A:90'); assert.strictEqual(estado(c), 'ACEPTADO');
    return `«${e.message}» → reconteo 90 → coincide, A=90`;
  });
  await t('4. Dos pestañas aceptan a la vez → +20, no +40', async () => {
    reset({ g1: { batches: [{ batch: 'B', quantity: 100, expirationDate: '2027-01' }] } });
    const c = caja({ insumoId: 'g1', lote: 'B', vence: '2027-01', total: 120, base: 100 }); recontar(c, {});
    const g = grupo([c]); const [r1, r2] = await Promise.all([LB.aceptar(g, { modo: 'completo' }), LB.aceptar(g, { modo: 'completo' })]);
    assert.strictEqual(lotes('g1'), 'B:120'); assert.strictEqual(hist().filter(x => x.type === 'AJUSTE_CRITICO').length, 1); assert.ok(!!r1.ya !== !!r2.ya, 'una sola aplica');
    return `B = 120 · una pestaña aplicó, la otra «ya estaba aceptado» · ${reintentos} reintento(s) de transacción`;
  });
  await t('5. Reclasificación S/L → lotes con despacho de por medio: todo o nada', async () => {
    reset({ g1: { batches: [{ batch: 'S/L', quantity: 100, expirationDate: '' }] } });
    const d = caja({ insumoId: 'g1', lote: 'D', total: 60, baseSL: 100 }), e = caja({ insumoId: 'g1', lote: 'E', vence: '2028-01', total: 40, baseSL: 100 });
    const antes = JSON.stringify(ins('g1')); desp('g1', 'S/L', 10); const tras = JSON.stringify(ins('g1'));
    const er = await debe(LB.aceptar(grupo([d, e]), { modo: 'completo', confirmaFaltas: true }), 'movido');
    assert.strictEqual(JSON.stringify(ins('g1')), tras); assert.notStrictEqual(antes, tras); assert.strictEqual(estado(d), 'REGISTRADO'); assert.strictEqual(estado(e), 'REGISTRADO'); assert.strictEqual(hist().length, 0); assert.strictEqual(bul().length, 0);
    recontar(d, { baseSL: 90 }); recontar(e, { total: 30, baseSL: 90, estructura: { estado: 'CERRADA', interiores: [], sueltas: 30 } });
    await LB.aceptar(grupo([d, e]), { modo: 'completo' });
    assert.strictEqual(lotes('g1'), 'D:60 E:30'); assert.strictEqual(ins('g1').quantity, 90); const cam = hist().filter(x => x.type === 'CAMBIO_CONTROLADO'); assert.strictEqual(cam.length, 2); assert.strictEqual(cam.reduce((s, x) => s + x.cantidadReclasificada, 0), 90);
    return `con despacho: «${er.message}» y nada escrito · recontado: S/L 90 → D 60 + E 30 (total 90, 2 CAM)`;
  });
  await t('6. Sobra sobre el umbral → pide reconteo', async () => {
    reset({ g1: { batches: [{ batch: 'C', quantity: 100, expirationDate: '2027-01' }] } });
    const c = caja({ insumoId: 'g1', lote: 'C', vence: '2027-01', total: 130, base: 100 });
    const e = await debe(LB.aceptar(grupo([c]), { modo: 'completo' }), 'reconteo'); assert.strictEqual(lotes('g1'), 'C:100');
    const p = caja({ insumoId: 'g1', lote: 'C', vence: '2027-01', total: 104, base: 100 });   /* +4 (4 %, ≤ 10 u.): no pide */
    const pl = LB.planificar({ doc: ins('g1'), cajas: [DB.get('Conteos_Cajas/' + p.folio)], modo: 'completo', yo: YO }); assert.ok(!pl.errores.length, pl.errores.map(x => x.message).join());
    await LB.pedirReconteo(c); recontar(c, {}); await LB.aceptar(grupo([c]), { modo: 'completo' });
    assert.strictEqual(lotes('g1'), 'C:130'); const a = hist().find(x => x.type === 'AJUSTE_CRITICO'); assert.ok(a && a.quantity === 30 && /^AJU-/.test(a.codigoSeguimiento) && a.document);
    return `«${e.message}» · +4 no pide · tras reconteo: C=130 con ${a.codigoSeguimiento} en ${a.document}`;
  });
  await t('7. Falta → Solicitudes_Ajuste (pendiente) y no descuenta', async () => {
    reset({ g1: { batches: [{ batch: 'F', quantity: 100, expirationDate: '2027-01' }, { batch: 'G', quantity: 7, expirationDate: '2028-01' }] } });
    const c = caja({ insumoId: 'g1', lote: 'F', vence: '2027-01', total: 80, base: 100 });
    await debe(LB.aceptar(grupo([c]), { modo: 'completo' }), 'falta');
    await debe(LB.aceptar(grupo([c]), { modo: 'completo', confirmaFaltas: true }), 'falta');   /* sin reconteo no basta con confirmar */
    await LB.pedirReconteo(c); recontar(c, {});
    await LB.aceptar(grupo([c]), { modo: 'completo', confirmaFaltas: true });
    assert.strictEqual(lotes('g1'), 'F:100 G:7'); assert.strictEqual(ins('g1').quantity, 107);
    const s = [...DB.keys()].filter(p => p.startsWith('Solicitudes_Ajuste/')).map(p => DB.get(p)).sort((a, b) => a.cantidad - b.cantidad);
    assert.deepStrictEqual(s.map(x => [x.lote, x.cantidad, x.loteSistema, x.status, x.requester]), [['F', -20, 100, 'pendiente', YO], ['G', -7, 7, 'pendiente', YO]]);
    return 'F sigue 100 y G 7 (G no se contó: contado completo) · 2 solicitudes pendientes: F −20 y G −7 con loteSistema';
  });
  await t('8. BUL en la misma transacción, sin duplicarse al reintentar', async () => {
    reset({ g1: { batches: [] } }); folioBul = 900;
    const est = { estado: 'ABIERTA', interiores: [...Array(9)].map(() => ({ q: 50, abierta: false })).concat([{ q: 30, abierta: true }]), sueltas: 5 };
    const c = caja({ insumoId: 'g1', lote: 'H', total: 485, estructura: est });
    conflictoUnaVez = 'Contadores/lev-LEV-2026-00001';   /* el SDK repite la función de la transacción */
    const lev = await LB.levAbierto(BOD); conflictoUnaVez = 'Contadores/lev-' + lev; const r0 = reintentos;
    const r = await LB.aceptar(grupo([c]), { modo: 'caja' }); const rein = reintentos - r0;
    const b = bul().map(p => DB.get(p)); assert.strictEqual(b.length, 12); const g = DB.get('Contadores/bulto-' + c.folio);
    assert.ok(g.tipo === 'bulto' && g.estado === 'ABIERTA' && g.contenido === 485 && g.copias === 2 && g.hijos.length === 11 && g.lev === r.lev);
    const ab = b.filter(x => x.franja === 'ABIERTA – USAR PRIMERO'), gr = b.filter(x => x.granel); assert.ok(ab.length === 1 && ab[0].contenido === 30 && ab[0].capacidad === 50 && ab[0].estado === 'ABIERTA'); assert.ok(gr.length === 1 && gr[0].contenido === 5);
    assert.strictEqual(b.filter(x => x.nivel === 'interior').reduce((s, x) => s + x.contenido, 0), 485);
    const r2 = await LB.aceptar(grupo([c]), { modo: 'caja' }); assert.ok(r2.ya); assert.strictEqual(bul().length, 12); assert.strictEqual(lotes('g1'), 'H:485'); assert.strictEqual(folioBul, 911);
    assert.deepStrictEqual(DB.get('Conteos_Cajas/' + c.folio).hijos, g.hijos);
    return `12 etiquetas (grande ×2 caras, 9 cerradas, 1 abierta 30/50, granel 5) · ${rein} reintento(s) del SDK sin duplicar · 2.º clic: «ya estaba» · 11 folios reservados una vez`;
  });
  await t('9. Quien contó no acepta su propia caja (el superadmin sí, marcado)', async () => {
    reset({ g1: { batches: [] } });
    const c = caja({ insumoId: 'g1', lote: 'P', total: 10, por: YO });
    const e = await debe(LB.aceptar(grupo([c]), { modo: 'caja' }), 'propia'); assert.strictEqual(estado(c), 'REGISTRADO');
    await LB.aceptar(grupo([c]), { modo: 'caja', esSuper: true }); const d = DB.get('Conteos_Cajas/' + c.folio); assert.ok(d.estado === 'ACEPTADO' && d.aceptadoPropio === true);
    const lev = DB.get('Contadores/lev-' + d.lev); assert.deepStrictEqual(lev.propias, [c.folio]);
    return `«${e.message}» · superadmin: ACEPTADO con aceptadoPropio y anotado en el LEV`;
  });
  /* extras */
  await t('Extra: sin internet no se acepta', async () => { reset({ g1: { batches: [] } }); const c = caja({ insumoId: 'g1', lote: 'Q', total: 5 }); EN_LINEA = false; try { await debe(LB.aceptar(grupo([c]), {}), 'red'); } finally { EN_LINEA = true; } assert.strictEqual(estado(c), 'REGISTRADO'); });
  await t('Extra: caja por caja no sirve si el lote ya tenía saldo o hay S/L', async () => {
    reset({ g1: { batches: [{ batch: 'A', quantity: 10, expirationDate: '2027-05' }, { batch: 'S/L', quantity: 3, expirationDate: '' }] } });
    const c = caja({ insumoId: 'g1', lote: 'A', total: 10, base: 10 }); const e = await debe(LB.aceptar(grupo([c]), { modo: 'caja' }), 'modo'); assert.ok(/contado completo/.test(e.message));
  });
  await t('Extra: producto nuevo → ficha provisional; controlado exige superadmin y doble conteo', async () => {
    reset({}); const c = caja({ nombre: 'GASA NUEVA', nuevo: true, lote: 'K', total: 20 });
    await debe(LB.aceptar(grupo([c]), {}), 'homologar');
    await LB.aceptar(grupo([c]), { homologar: { tipo: 'ficha' } }); const f = DB.get('Insumos/lev_gasa-nueva__bodega-cam'); assert.ok(f.levProvisional === true && f.quantity === 20 && LB.bloqueaDespacho(f));
    const k = caja({ nombre: 'MORFINA', nuevo: true, controlado: 'controlado', lote: 'Y', total: 5 });
    await debe(LB.aceptar(grupo([k]), { homologar: { tipo: 'ficha' } }), 'super');
    globalThis.document.body.dataset.userRole = 'superadmin'; try { await debe(LB.aceptar(grupo([k]), { homologar: { tipo: 'ficha' } }), 'doble'); recontar(k, {}); await LB.aceptar(grupo([k]), { homologar: { tipo: 'ficha' }, vista: {} }); } finally { globalThis.document.body.dataset.userRole = 'admin'; }
    assert.strictEqual(DB.get('Insumos/lev_morfina__bodega-cam').quantity, 5);
  });
  await t('Extra: deuda saldada con esperadoDeuda; cerrar LEV con IRA; pendientesDe', async () => {
    reset({ g1: { batches: [{ batch: 'A', quantity: 50, expirationDate: '2027-05' }], sobregiro: 4 } });
    const c = caja({ insumoId: 'g1', lote: 'A', total: 50, base: 50, deuda: 4 }), p = caja({ insumoId: 'g1', lote: 'B', total: 9 });
    assert.strictEqual((await LB.pendientesDe('g1', BOD, 'b', '2027-05')).length, 1); assert.strictEqual((await LB.pendientesDe('g1', BOD, 'A')).length, 1); assert.strictEqual((await LB.pendientesDe('g1', BOD)).length, 2);
    const r = await LB.aceptar(grupo([c]), { modo: 'completo' }); assert.strictEqual(ins('g1').sobregiro, 0); assert.strictEqual(hist().filter(x => x.type === 'CUADRE_SOBREGIRO').length, 1);
    assert.strictEqual((await LB.pendientesDe('g1', BOD, 'A')).length, 0);
    const z = await LB.cerrarLev(r.lev); assert.strictEqual(z.ira, 100); assert.strictEqual(DB.get('Contadores/lev-' + r.lev).estado, 'cerrado');
    const r2 = await LB.aceptar(grupo([p]), { modo: 'caja' }); assert.notStrictEqual(r2.lev, r.lev);
  });
  R.forEach(([e, nom, d]) => console.log(`${e === 'OK' ? 'OK   ' : 'FALLA'} ${nom}${d ? '\n      → ' + d : ''}`));
  console.log(`\n${n} ok, ${mal} con falla`); process.exit(mal ? 1 : 0);
})();
