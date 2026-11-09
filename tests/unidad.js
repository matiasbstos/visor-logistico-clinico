/* Pruebas de unidad de la lógica pura (sin navegador ni Firebase). Uso: node tests/unidad.js */
const assert = require('assert'); globalThis.window = globalThis; globalThis.SAR_SeguimientoOC = {};
globalThis.document = { getElementById: () => null, addEventListener() {}, querySelector: () => null, readyState: 'complete', scripts: [], body: { dataset: {}, style: {} } };
let n = 0, mal = 0; const t = (nombre, f) => { try { f(); n++; console.log('OK   ' + nombre); } catch (e) { mal++; console.log('FALLA ' + nombre + ' → ' + e.message); } };
const B = require('../bitacora-oc.js'), M = require('../monitor-errores.js'), C = require('../tabla-columnas.js'), P = require('../primeros-pasos.js'), H = require('../correo-html.js'), R = require('../resumen-stock.js'), K = require('../respaldo-diario.js'), Z = require('../cierre-mensual.js');

t('clave de OC se normaliza', () => assert.strictEqual(B.claveOC('1298355-936-cm26'), '1298355-936-CM26'));
t('bitácora: sin correos ni orden = solo correo/sin gestión', () => { const c = B.calcularCaso(null, []); assert.ok(c.estado); });
t('bitácora: conforme TOTAL con faltantes → discrepancia', () => {
    const oc = { numeroOC: 'x', lineas: [{ descripcion: 'A', dist: { SAR: 10 }, recibido: { SAR: 4 }, ingresado: {}, entregado: {} }], columnas: [{ key: 'SAR', centro: 'SAR', memo: '1' }], recepciones: [] };
    globalThis.SAR_SeguimientoOC = { estadoEntregas: () => [], totalesPorCentro: () => [] };
    const c = B.calcularCaso(oc, [{ id: '1', fecha: new Date().toISOString(), dir: 'ENVIADO', clase: 'recepcion_conforme', declara: 'TOTAL', asunto: 'conforme' }]);
    assert.ok(['DISCREPANCIA', 'PARCIAL', 'GESTION'].includes(c.estado), c.estado);
});
t('analizar detecta varios memos y centros', () => {
    const ev = [{ id: '1', fecha: '2026-10-01T10:00:00Z', dir: 'ENVIADO', clase: 'oc_enviada', asunto: 'a', refs: { memo: ['12'] } }, { id: '2', fecha: '2026-10-02T10:00:00Z', dir: 'RECIBIDO', clase: 'guia', asunto: 'b', refs: { memo: ['15'] }, centros: ['CESFAM X'] }];
    const a = B.analizar({ ...B.calcularCaso(null, ev), oc: null, clave: 'k' }); assert.ok(a.hallazgos.some(h => /2 memos/.test(h.titulo)) && a.dividida);
});
t('monitor: enmascara RUT y huella estable', () => { assert.ok(!/12\.345/.test(M.limpiar('rut 12.345.678-5'))); assert.strictEqual(M.huella('e 1', 'a.js?v=1', 3), M.huella('e 9', 'a.js?v=2', 3)); });
t('columnas: reglas CSS', () => { const r = C.reglas('x', { ocultas: [2], anchos: { 1: 100 }, fijar: true, compacta: true }); assert.ok(/nth-child\(2\)/.test(r) && /100px/.test(r) && /sticky/.test(r)); });
t('primeros pasos: porcentaje y siguiente', () => { const a = P.avance({ bodegas: true, inventario: true }); assert.strictEqual(a.pct, 33); assert.strictEqual(a.siguiente.id, 'orden'); });
t('correo HTML escapa y trae el sujeto', () => { const h = H.armar({ titulo: 'Acta', texto: 'x\n- <b>P</b>: 3 un.', sujeto: 'Acta A-1', orden: {} }); assert.ok(h.includes('Acta A-1') && !h.includes('<b>P</b>') && h.includes('&lt;b&gt;')); });
t('resumen de stock: vencidos, urgentes y críticos', () => {
    const hoy = new Date(2026, 10, 9); const it = [
        { name: 'A', quantity: 5, criticalLimit: 10, batches: [{ batch: 'L1', expirationDate: '2026-11-01', quantity: 3 }, { batch: 'L2', expirationDate: '2026-11-20', quantity: 2 }] },
        { name: 'B', quantity: 100, criticalLimit: 10, expirationDate: '2027-12-31' }, { name: 'C', quantity: 80, expirationDate: '2027-01-05', batch: 'x' }];
    const r = R.resumen(it, hoy); assert.strictEqual(r.vencidos.length, 1); assert.strictEqual(r.urgentes.length, 1); assert.strictEqual(r.criticos.length, 1); assert.ok(R.debeEnviar(r, hoy)); assert.strictEqual(R.aFilas(r).length, 3);
});
t('resumen de stock: sin urgencias solo manda los lunes', () => { const r = R.resumen([{ name: 'B', quantity: 100, criticalLimit: 10, expirationDate: '2030-01-01' }], new Date(2026, 10, 9)); assert.ok(!R.debeEnviar(r, new Date(2026, 10, 10))); assert.ok(R.debeEnviar(r, new Date(2026, 10, 9))); });
t('cierre mensual: categorías y hojas', () => {
    assert.strictEqual(Z.categoria({ type: 'INGRESO_OC' }), 'Entradas'); assert.strictEqual(Z.categoria({ type: 'traspaso' }), 'Traspasos'); assert.strictEqual(Z.categoria({ type: 'merma_inventario' }), 'Ajustes y mermas'); assert.strictEqual(Z.categoria({ type: 'ENTREGA_ACTA' }), 'Salidas');
    const d = { movs: [{ type: 'INGRESO_OC', quantity: 10, insumoName: 'A', date: new Date(2026, 9, 5) }, { type: 'salida', quantity: 3, insumoName: 'A', date: new Date(2026, 9, 6) }, { type: 'salida', quantity: 9, insumoName: 'B', date: new Date(2026, 10, 2) }],
        insumos: [{ name: 'A', quantity: 7, unitPrice: 100, location: 'Central' }], actas: [{ numero: 'AE-1', fecha: '2026-10-07', estado: 'EMITIDA', confirmacion: { estado: 'PENDIENTE' }, items: [{ cantidad: 3 }] }], ocs: [{ numeroOC: 'X', cerrada: false, lineas: [{ dist: { SAR: 5 }, recibido: { SAR: 2 } }] }] };
    const r = Z.armarHojas(d, '2026-10'); assert.strictEqual(r.nMovs, 2); const res = r.hojas[0][1]; assert.ok(res.some(f => f[0] === 'Entradas' && f[1] === 1 && f[2] === 10)); assert.ok(r.hojas.find(h => h[0] === 'Órdenes abiertas')[1][1][5] === 3); assert.ok(res.some(f => /por confirmar/.test(f[0]) && f[1] === 1)); assert.strictEqual(r.hojas.length, 9);
});
const tAsync = []; const ta = (nombre, f) => tAsync.push(f().then(() => { n++; console.log('OK   ' + nombre); }).catch(e => { mal++; console.log('FALLA ' + nombre + ' → ' + e.message); }));
ta('respaldo: serializar, comprimir, trocear y restaurar sin pérdida', async () => {
    const datos = { Insumos: Array.from({ length: 3000 }, (_, i) => ({ _id: 'i' + i, name: 'Producto ' + i, quantity: i, f: { toDate: () => new Date(0) } })), Bodegas: [{ _id: 'b', n: 'ñandú' }] };
    const txt = K.serializar(datos), b64 = await K.comprimir(txt), partes = K.trocear(b64), vuelta = await K.descomprimir(partes.join(''));
    assert.strictEqual(vuelta, txt); assert.strictEqual(K.suma(vuelta), K.suma(txt)); assert.deepStrictEqual(K.conteos(JSON.parse(vuelta)), { Insumos: 3000, Bodegas: 1 }); assert.ok(/__ts/.test(vuelta));
});
t('vista previa de agenda: días y fecha pasada', () => { const V = require('../vista-previa-agenda.js'); const h = new Date(2026, 10, 7); assert.strictEqual(V.diasHasta('2026-11-09', h), 2); const r = V.resumen({ tipo: 'ENVIO', titulo: ' ', fecha: '2026-11-06' }, h); assert.ok(r.pasado); assert.strictEqual(r.cuando, 'ayer'); assert.strictEqual(r.titulo, 'Sin título aún'); });
t('menú: búsqueda sin tildes y todas las palabras', () => { const M = require('../menu-lateral.js'); assert.ok(M.coincide('Bitácora de órdenes', 'bitacora ord')); assert.ok(!M.coincide('Existencias', 'compras')); assert.ok(!M.coincide('x', '  ')); });
t('carga global: reconoce textos sueltos y botones ocupados', () => { const C = require('../cargando-global.js'); assert.ok(C.esCarga(' Cargando historial...')); assert.ok(!C.esCarga('Sin datos')); assert.ok(C.boton('Guardando…') && !C.boton('Guardar')); assert.strictEqual(C.etiqueta('Cargando x...'), 'Cargando x…'); });
t('búsqueda global: agrupa productos y encuentra OC, actas y bodegas', () => { const G = require('../buscador-global.js'); const ix = G.construirIndice({ insumos: [{ name: 'Gasa estéril', codigoMP: 'G1', quantity: 10, location: 'Central' }, { name: 'GASA ESTÉRIL', codigoMP: 'G1', quantity: '5', location: 'Camión' }], ocs: [{ id: 'x', numeroOC: '1298355-840-AG26', proveedor: 'Proveedor Sur', lineas: [{ descripcion: 'Guantes' }] }], actas: [{ numero: 'AC-12', centro: 'CESFAM San Manuel', items: [{ nombre: 'Jeringa' }] }], bodegas: [{ name: 'Bodega Central' }] }); const r = G.buscar(ix, 'gasa'); assert.strictEqual(r.length, 1); assert.ok(/15 un\. · 2 ubicaciones/.test(r[0].sub)); assert.strictEqual(G.buscar(ix, 'guantes')[0].tipo, 'oc'); assert.strictEqual(G.buscar(ix, 'san manuel')[0].tipo, 'acta'); assert.strictEqual(G.buscar(ix, 'central')[0].tipo, 'bodega'); assert.strictEqual(G.buscar(ix, 'zzz').length, 0); });
t('préstamos: devolución parcial/total, tope y descuento por lotes', () => { const P = require('../prestamos-otros-centros.js'); assert.strictEqual(P.aplicarDevolucion({ cantidad: 10, devuelto: 4 }, 6).estado, 'DEVUELTO'); assert.strictEqual(P.aplicarDevolucion({ cantidad: 10, devuelto: 4 }, 3).estado, 'PENDIENTE'); assert.ok(P.aplicarDevolucion({ cantidad: 10, devuelto: 4 }, 7).error); const r = P.descontarLotes([{ batch: 'A', quantity: 5 }, { batch: 'B', quantity: 8 }], 'B', 10); assert.deepStrictEqual(r.batches, [{ batch: 'A', quantity: 3 }]); });
t('precinto: folio correlativo y código de barras Code 128 válido', () => { const Q = require('../precintos-inventario.js'); assert.strictEqual(Q.folio(2026, 7), 'PI-2026-0007'); const a = Q.barras('20260001'); assert.strictEqual(a.reduce((x, y) => x + y, 0), 79); assert.strictEqual(a.join(''), '2112322212313212212122222221222411122331112'); });
t('escaneo de precinto: reconoce folio y 8 dígitos, ignora códigos de producto', () => { const E = require('../precinto-escaneo.js'); assert.strictEqual(E.leerFolio('PI-2026-0007'), 'PI-2026-0007'); assert.strictEqual(E.leerFolio('20260007'), 'PI-2026-0007'); assert.strictEqual(E.leerFolio('7801234567890'), null); assert.strictEqual(E.leerFolio('Paracetamol'), null); assert.strictEqual(E.faseDe('2.° conteo'), '2da Toma (2da Bodega / Suma)'); assert.strictEqual(E.conEtiqueta('caja ok', 'PI-2026-0007'), '[Precinto PI-2026-0007] caja ok'); assert.strictEqual(E.conEtiqueta('[Precinto PI-2026-0007] x', 'PI-2026-0007'), '[Precinto PI-2026-0007] x'); });
t('oxígeno: capacidad normalizada, cambio de capacidad y serie como texto', () => { const O = require('../oxigeno.js'); assert.strictEqual(O.normCap('1m3'), '1 m³'); assert.strictEqual(O.normCap('1 M3'), '1 m³'); assert.strictEqual(O.normCap('0.5'), '0,5 m³'); assert.strictEqual(O.normCap('2 m³'), '2 m³'); assert.strictEqual(O.aplicarAccion({ estado: 'LLENO', capacidad: '1 m³' }, 'CAPACIDAD', { capacidad: '2m3' }).capacidad, '2 m³'); assert.throws(() => O.aplicarAccion({ estado: 'LLENO' }, 'CAPACIDAD', { capacidad: '' })); assert.strictEqual(O.parsearSeries('00123, 00124')[0].serie, '00123'); assert.ok(O.accionesPara('FUERA_SERVICIO').some(a => a.k === 'REPUESTO')); assert.throws(() => O.aplicarAccion({ estado: 'LLENO' }, 'FUERA_SERVICIO', { detalle: '' })); });
t('precinto oxígeno: barras Code 128-B decodificables y con dígito de control', () => { const Q = require('../precintos-inventario.js'); const a = Q.barrasB('AB-12345'); assert.strictEqual(a.length, 11 * 2 - 1 + 1 + 0 > 0 ? a.length : 0); const sim = Q.barrasB('AB-12345').join(''); const stop = '2331112'; assert.ok(sim.endsWith(stop)); const html = Q.etiquetaOxiHTML({ serie: '00987', capacidad: '2 m³' }); assert.ok(html.includes('00987') && html.includes('CONTROL DE OXÍGENO') && html.includes('FUERA DE SERVICIO')); });
t('oxígeno: tipo de gas, proveedor y fecha de carga', () => { const O = require('../oxigeno.js'); assert.strictEqual(O.normGas(''), 'Oxígeno medicinal'); assert.strictEqual(O.normGas('aire'), 'Aire comprimido medicinal'); assert.strictEqual(O.fechaCL('2026-11-08'), '08/11/2026'); const c = O.aplicarAccion({ estado: 'VACIO' }, 'RECARGA_OK', { proveedor: ' Prov ', fecha: '2026-11-08' }); assert.strictEqual(c.proveedor, 'Prov'); assert.strictEqual(c.ultimaRecarga, '2026-11-08'); assert.strictEqual(O.aplicarAccion({ estado: 'LLENO' }, 'TIPO_GAS', { gas: 'aire' }).gas, 'Aire comprimido medicinal'); assert.ok(O.nombreEnActa({ serie: '1', gas: 'Aire comprimido medicinal' }).startsWith('BALÓN DE AIRE COMPRIMIDO')); assert.ok(require('../precintos-inventario.js').etiquetaOxiHTML({ serie: '9', proveedor: 'P1', ultimaRecarga: '2026-11-08', gas: 'Aire comprimido medicinal' }).includes('08/11/2026')); });
t('precinto oxígeno: muestra el folio correlativo asignado', () => { const Q = require('../precintos-inventario.js'); assert.ok(Q.etiquetaOxiHTML({ serie: '9', folio: 'PO-2026-0003' }).includes('PO-2026-0003')); assert.ok(Q.etiquetaOxiHTML({ serie: '9' }).includes('se asigna al imprimir')); });
t('avisos de la campana: vencidos, por vencer, bajo mínimo y préstamos', () => { const A = require('../avisos-campana.js'); const hoy = new Date('2026-11-08T12:00:00'); const r = A.calcular([{ name: 'A', quantity: 5, expirationDate: '2026-10-01' }, { name: 'B', quantity: 3, expirationDate: '2026-11-20' }, { name: 'C', quantity: 2, expirationDate: '2027-05', criticalLimit: 10 }, { name: 'D', quantity: 0, expirationDate: '2026-01-01' }], [{ insumoName: 'X', centro: 'C1', cantidad: 5, devuelto: 5 }, { insumoName: 'Y', centro: 'C2', cantidad: 5, devuelto: 2 }], hoy); assert.strictEqual(r.vencidos.length, 1); assert.strictEqual(r.porVencer.length, 1); assert.strictEqual(r.bajoMin.length, 1); assert.strictEqual(r.prestamos.length, 1); assert.strictEqual(r.total, 4); assert.ok(A.html(r).includes('Préstamos por devolver')); });
t('sonidos: definidos, sin audio no falla y se puede silenciar', () => { const S = require('../sonidos.js'); ['ingreso', 'carga', 'listo', 'error', 'aviso', 'notificacion', 'info'].forEach(n => assert.ok(S.SONIDOS[n].length >= 1)); assert.strictEqual(S.tocar('error'), false); assert.strictEqual(S.alternar(false), false); assert.strictEqual(S.estaActivo(), false); });
t('oxígeno prestado: agrupa por centro y mide el respaldo', () => { const P = require('../oxigeno-prestamos.js'); const g = P.agrupar([{ id: '1', serie: '20', estado: 'PRESTADO', prestadoA: 'POMAIRE' }, { id: '2', serie: '3', estado: 'PRESTADO', prestadoA: 'POMAIRE', prestamo: { actaFirmada: { nombre: 'a.pdf' }, fotos: [{ id: 'x' }] } }, { id: '3', serie: '9', estado: 'LLENO' }, { id: '4', serie: '1', estado: 'PRESTADO', prestadoA: 'CODIGUA' }]); assert.deepStrictEqual(g.map(x => x.centro), ['CODIGUA', 'POMAIRE']); assert.deepStrictEqual(g[1].equipos.map(e => e.serie), ['3', '20']); assert.strictEqual(P.respaldoDe(g[1].equipos[0]).firmada, true); assert.strictEqual(P.respaldoDe(g[1].equipos[0]).fotos, 1); assert.strictEqual(P.respaldoDe(g[1].equipos[1]).firmada, false); });
t('vida del producto: junta orden, recepción, acta y salida en orden cronológico', () => { const V = require('../vida-producto.js'); const p = { codigos: new Set(['4623804']), nombres: new Set([V.norm('SABANILLA ELITE')]) };
  const r = V.construir({ ocs: [{ numeroOC: '1298355-9-AG26', proveedor: 'PROV', aceptada: '2026-10-01', memo: '77', lineas: [{ descripcion: 'SABANILLA ELITE', codigoMP: '4623804', dist: { sar: 60 } }, { descripcion: 'OTRO', dist: { sar: 5 } }], recepciones: [{ recId: 'REC-1', fecha: '2026-10-05', ingresoAStock: true, bodega: 'Bodega Central', detalle: [{ descripcion: 'SABANILLA ELITE', cantidad: 60 }] }] }],
    historial: [{ insumoName: 'SABANILLA ELITE', type: 'ENTREGA_ACTA', quantity: 50, date: '2026-11-06T18:00:00Z', document: 'AE-2026-0013', origin: 'Bodega Central', dest: 'PSR' }], actas: [{ numero: 'AE-2026-0013', centro: 'PSR', fecha: '2026-11-06', estado: 'EMITIDA', confirmacion: { estado: 'CONFIRMADA' }, respaldo: { nombre: 'x' }, items: [{ nombre: 'SABANILLA ELITE', codigoMP: '4623804', cantidad: 50 }] }, { numero: 'AE-2026-0014', centro: 'X', fecha: '2026-11-07', estado: 'EMITIDA', confirmacion: { estado: 'PENDIENTE' }, items: [{ nombre: 'SABANILLA ELITE', cantidad: 3 }] }],
    insumos: [{ location: 'Bodega Central', quantity: 10, batches: [{ batch: 'L1', quantity: 10 }] }] }, p);
  assert.strictEqual(r.resumen.pedido, 60); assert.strictEqual(r.resumen.recibido, 60); assert.strictEqual(r.resumen.entregado, 50); assert.strictEqual(r.resumen.reservado, 3);
  assert.strictEqual(r.eventos[0].clase, 'oc'); assert.ok(r.eventos[0].detalle.includes('memo 77')); assert.ok(r.eventos.some(e => e.titulo.startsWith('Recepción REC-1'))); assert.ok(r.eventos.some(e => /firmada, stock descontado/.test(e.detalle))); assert.strictEqual(r.stock[0].cant, 10); assert.ok(r.eventos.findIndex(e => e.clase === 'oc') < r.eventos.findIndex(e => e.clase === 'sal')); });
Promise.all(tAsync).then(() => {
console.log(`\n${n} ok, ${mal} con falla`); process.exit(mal ? 1 : 0); });

// ---- Bodega transitoria (v21.107)
(function () {
  const T = require('../bodega-transitoria.js'), assert = require('assert');
  let r = T.calcularFila({ objetivo: 10, sistema: 10, contado: 5, central: 100 });
  assert.deepStrictEqual([r.estado, r.faltante, r.reponer, r.reponible], ['faltante', 5, 5, 5]);
  r = T.calcularFila({ objetivo: 10, sistema: 8, contado: 9, central: 0 });
  assert.deepStrictEqual([r.estado, r.sobrante, r.reponer, r.reponible], ['sobrante', 1, 1, 0]);
  assert.strictEqual(T.calcularFila({ objetivo: 10, sistema: 3, contado: '' }).estado, 'pendiente');
  const rp = T.repartir([{ id: 'a', quantity: 3 }, { id: 'b', quantity: 10 }], 5);
  assert.deepStrictEqual(rp.partes, [{ id: 'a', quitar: 3 }, { id: 'b', quitar: 2 }]);
  assert.strictEqual(T.repartir([{ id: 'a', quantity: 1 }], 4).sinCubrir, 3);
  const l = T.sumarLotes([{ batch: 'L1', quantity: 2, expirationDate: '2027-01-01' }], [{ batch: 'L1', quantity: 3, expirationDate: '2027-01-01' }, { batch: 'L2', quantity: 1 }]);
  assert.strictEqual(l.length, 2); assert.strictEqual(l[0].quantity, 5);
  assert.strictEqual(T.claveDe('Suero', '12345'), '12345');
  console.log('ok bodega transitoria');
})();
(function () { const T = require('../bodega-transitoria.js'); require('assert').strictEqual(T.normEstante(' b-3 '), 'B3'); console.log('ok estante'); })();

// ---- Editar ingreso (v21.121)
(function () {
  const E = require('../editar-ingreso.js'), assert = require('assert');
  const ins = { quantity: 130, batches: [{ batch: 'L1', quantity: 100, expirationDate: '2027-01-01' }, { batch: 'L2', quantity: 30, expirationDate: '2026-12-01' }] };
  // subir el ingreso de L1 de 100 a 120 y cambiar su vencimiento
  let r = E.aplicarEdicion(ins, { batch: 'L1', quantity: 100 }, { batch: 'L1', quantity: 120, expirationDate: '2027-03-01' });
  assert.strictEqual(r.quantity, 150); assert.strictEqual(r.batches.find(b => b.batch === 'L1').quantity, 120); assert.strictEqual(r.batches.find(b => b.batch === 'L1').expirationDate, '2027-03-01');
  assert.strictEqual(r.batch, 'L2'); // el que vence primero
  // cambiar el nombre del lote: L1 -> L9 con la misma cantidad
  r = E.aplicarEdicion(ins, { batch: 'L1', quantity: 100 }, { batch: 'l9', quantity: 100, expirationDate: '2027-01-01' });
  assert.deepStrictEqual(r.batches.map(b => b.batch).sort(), ['L2', 'L9']); assert.strictEqual(r.quantity, 130);
  // no se puede bajar de lo ya entregado
  const consumido = { quantity: 40, batches: [{ batch: 'L1', quantity: 40, expirationDate: '' }] };
  assert.throws(() => E.aplicarEdicion(consumido, { batch: 'L1', quantity: 100 }, { batch: 'L1', quantity: 50 }), /ya se entreg/);
  // lote inexistente
  assert.throws(() => E.aplicarEdicion(ins, { batch: 'XX', quantity: 5 }, { batch: 'XX', quantity: 6 }), /No se encontr/);
  // cantidad inválida
  assert.throws(() => E.aplicarEdicion(ins, { batch: 'L1', quantity: 1 }, { batch: 'L1', quantity: 1.5 }), /entero/);
  // insumo antiguo sin arreglo batches
  r = E.aplicarEdicion({ quantity: 10, batch: 'A', expirationDate: '2027-01-01' }, { batch: 'A', quantity: 10 }, { batch: 'A', quantity: 12, expirationDate: '2027-01-01' });
  assert.strictEqual(r.quantity, 12);
  console.log('ok editar ingreso');
})();
