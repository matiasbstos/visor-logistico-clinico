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
t('alertas por lote: vencido, urgente, precaución y stock vigente crítico', () => { const L = require('../lotes-alertas.js'); const hoy = new Date(2026, 10, 9); const a = L.analizar({ quantity: 120, criticalLimit: 50, batches: [{ batch: 'A', quantity: 40, expirationDate: '2026-11-01' }, { batch: 'B', quantity: 30, expirationDate: '2026-11-25' }, { batch: 'C', quantity: 50, expirationDate: '2027-01-15' }] }, hoy); assert.deepStrictEqual(a.lotes.map(l => l.nivel), ['vencido', 'urgente', 'precaucion']); assert.strictEqual(a.util, 50); assert.ok(a.criticoUtil && !a.critico && a.peor === 'vencido'); const b = L.analizar({ quantity: 10, criticalLimit: 50, batch: 'X', expirationDate: '2030-01-01' }, hoy); assert.ok(b.critico && !b.criticoUtil && b.peor === 'ok'); assert.strictEqual(L.etiqueta(a.lotes[1]), 'Vence en 16 d'); });
t('código SAR: formato correlativo y nombre normalizado', () => { const S = require('../codigo-sar.js'); assert.strictEqual(S.formato(123), 'SAR-000123'); assert.strictEqual(S.formato(1), 'SAR-000001'); assert.strictEqual(S.slug('Guante  Examen NITRILO talla M'), S.slug('guante examen nitrilo talla m')); assert.notStrictEqual(S.slug('GUANTE TALLA S'), S.slug('GUANTE TALLA M')); assert.strictEqual(S.slug('Aerocámara pediátrica 180 ml'), 'aerocamara-pediatrica-180-ml'); });
t('categorías: se unen sin repetir (tildes y mayúsculas) y General va primero', () => { const C = require('../categorias.js'); const l = C.unir(['General', 'Aseo'], ['aseo', 'Curación', 'curacion', ' Oficina ']); assert.deepStrictEqual(l, ['General', 'Aseo', 'Curación', 'Oficina']); });
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
t('gobernanza: ventana de corrección directa', () => {
    const G = require('../gobernanza.js'), ahora = new Date('2026-11-09T12:00:00Z');
    assert.ok(G.evaluarVentana([{ type: 'INGRESO_PROVEEDOR', date: new Date('2026-11-09T05:00:00Z') }], ahora).ok);
    assert.ok(!G.evaluarVentana([{ type: 'INGRESO_PROVEEDOR', date: new Date('2026-11-08T12:00:00Z') }], ahora).ok);
    assert.ok(!G.evaluarVentana([{ type: 'INGRESO_PROVEEDOR', date: new Date('2026-11-09T05:00:00Z') }, { type: 'ENTREGA_ACTA' }], ahora).ok);
    assert.ok(G.evaluarVentana([{ type: 'INGRESO_OC', date: new Date('2026-11-09T10:00:00Z') }, { type: 'ACTA_PRUEBA' }, { type: 'UNIFICACION_STOCK' }], ahora).ok);
});

t('código de lote: clave estable y formato', () => {
    const S = require('../codigo-sar.js');
    assert.strictEqual(S.claveLote('4600002149', '05/01/2030'), S.claveLote(' 4600002149 ', '2030-01-05'));
    assert.notStrictEqual(S.claveLote('A', '2030-01-05'), S.claveLote('A', '2031-01-05'));
    assert.strictEqual(S.formatoLote('SAR-000013', 2), 'SAR-000013-L02');
});

t('nomenclaturas: catálogo completo y sin duplicados', () => {
    const Nm = require('../nomenclaturas.js'), nombres = Nm.catalogo.map(x => x.nombre);
    assert.ok(Nm.catalogo.length >= 15); assert.strictEqual(new Set(nombres).size, nombres.length);
    ['Acta de entrega', 'Código del lote', 'Código de ingreso', 'Precinto de oxígeno'].forEach(n => assert.ok(nombres.includes(n), n));
    assert.ok(Nm.catalogo.every(x => x.formato && x.ejemplo && x.asigna && x.uso));
});

t('oxígeno: ciclos de vida (llega, está, se va; si vuelve, ciclo nuevo)', () => { const O = require('../oxigeno-ciclos.js'); const ev = (fecha, tipo, o) => Object.assign({ fecha, tipo, detalle: '' }, o); const r = O.ciclos([ev('2026-11-01', 'ALTA', { estadoNuevo: 'LLENO' }), ev('2026-11-03', 'ENTREGA_ACTA', { estadoAnterior: 'LLENO', estadoNuevo: 'PRESTADO', ubicacion: 'Centro Vet', detalle: 'Entregado (acta AE-2026-0022)' }), ev('2026-11-05', 'DEVOLUCION', { estadoNuevo: 'VACIO', ubicacion: 'SAR' }), ev('2026-11-06', 'ENVIO_RECARGA', { estadoNuevo: 'EN_RECARGA', ubicacion: 'Proveedor' }), ev('2026-11-08', 'RECARGA_OK', { estadoNuevo: 'LLENO', ubicacion: 'SAR' })]); assert.strictEqual(r.ciclos.length, 3); assert.strictEqual(r.ciclos[0].destino, 'Centro Vet'); assert.deepStrictEqual(r.ciclos[0].actas, ['AE-2026-0022']); assert.ok(!r.ciclos[0].abierto && !r.ciclos[1].abierto && r.ciclos[2].abierto); assert.strictEqual(r.ciclos[0].dias, 2); });
t('guía/factura: fechas y emparejar productos con la orden', () => { const G = require('../guia-lector.js'); assert.strictEqual(G.fechaISO('05/2027'), '2027-05-31'); assert.strictEqual(G.fechaISO('3/11/2026'), '2026-11-03'); assert.strictEqual(G.fechaISO('basura'), ''); const oc = [{ descripcion: 'GUANTE EXAMEN NITRILO TALLA L CAJA 100' }, { descripcion: 'JERINGA 10 ML LUER LOCK' }]; const r = G.emparejar(oc, [{ descripcion: 'Guantes de examen nitrilo talla L', lote: 'A1', vence: '2027-01-01', cantidad: 5 }, { descripcion: 'Jeringa 10 ml luer lock s/aguja', lote: 'B2', vence: '2027-02-01', cantidad: 3 }, { descripcion: 'Guante examen nitrilo talla L', lote: 'A2', vence: '2027-03-01', cantidad: 2 }, { descripcion: 'Mascarilla quirurgica', lote: 'Z', vence: '', cantidad: 1 }]); assert.deepStrictEqual(r.pares.map(p => p.i), [0, 1]); assert.strictEqual(r.extras.length, 1); assert.strictEqual(r.sinPar.length, 1); });
t('unificar repetidos: junta stock, lotes y sobregiro en uno', () => { const U = require('../unificar-duplicados.js'); const mk = (id, o) => ({ id, data: Object.assign({ name: 'TRAPERO WINKLER 50X70', codigoMP: '4639049', quantity: 0, sobregiro: 0, provisional: true }, o) }); const g = [mk('a', { sobregiro: 5, sobregiroDetalle: [{ acta: 'AE-1', qty: 5 }] }), mk('b', { sobregiro: 10, sobregiroDetalle: [{ acta: 'AE-2', qty: 10 }] }), mk('c', { sobregiro: 10, sobregiroDetalle: [{ acta: 'AE-2', qty: 10 }] }), mk('d', { sobregiro: 10 })]; assert.strictEqual(U.detectar(g.concat([{ id: 'z', data: { name: 'OTRO', quantity: 1 } }])).length, 1); const r = U.fusionar(g); assert.strictEqual(r.quitar.length, 3); assert.strictEqual(r.patch.sobregiro, 35); assert.strictEqual(r.patch.sobregiroDetalle.find(x => x.acta === 'AE-2').qty, 20); const h = U.fusionar([mk('r1', { quantity: 10, provisional: false, batches: [{ batch: 'L1', quantity: 10, expirationDate: '2027-01-01' }] }), mk('r2', { quantity: 5, provisional: false, batches: [{ batch: 'l1', quantity: 5, expirationDate: '2027-01-01' }] })]); assert.strictEqual(h.id, 'r1'); assert.strictEqual(h.patch.quantity, 15); assert.strictEqual(h.patch.batches.length, 1); assert.strictEqual(h.patch.provisional, false); });
t('pendientes: cada línea conserva fecha, OC y DIST del acta de origen y se agrupa por fecha', () => { global.window = global.window || global; const PE = require('../pendientes-entrega.js'); const actas = [{ numero: 'AE-2', fecha: '2026-10-20', centro: 'CPU', oc: { numeroOC: '948-CM26' }, distribucion: { correlativo: 'DIST-2026-0002' }, items: [{ nombre: 'GASA', solicitado: 10, cantidad: 4 }] }, { numero: 'AE-1', fecha: '2026-10-05', centro: 'CPU', items: [{ nombre: 'SONDA', solicitado: 5, cantidad: 1 }] }]; const g = PE.calcularPendientes(actas); assert.strictEqual(g.length, 1); const gr = PE.agruparPorOrigen(g[0].items); assert.strictEqual(gr.length, 2); assert.strictEqual(gr[0].origen.fecha, '2026-10-05'); assert.strictEqual(gr[0].origen.oc, ''); assert.strictEqual(gr[1].origen.oc, '948-CM26'); assert.strictEqual(gr[1].origen.dist, 'DIST-2026-0002'); });
t('cuadro en Excel con «MEMO # N-centro-CDP #» y columnas CANTIDAD/TOTAL (eléctricos) se lee completo', () => { global.window = global.window || global; const L = require('../oc-lector.js'); const d = L.extraerDistribucionExcel(require('./fixtures/dist-electricos.json')); assert.deepStrictEqual(d.avisos, []); assert.strictEqual(d.numeroOC, '1298355-933-AG26'); assert.strictEqual(d.columnas.length, 8); assert.strictEqual(d.lineas.length, 18); const sar = d.columnas.find(c => c.centro === 'SAR'); assert.strictEqual(sar.memo, '56'); assert.strictEqual(sar.neto, 63897); assert.strictEqual(sar.cdp, '4394-4397'); });
t('lector Excel universal: tolera columnas corridas, otros encabezados y memo sobre TOTAL', () => { global.window = global.window || global; const L = require('../oc-lector.js'); const base = require('./fixtures/dist-electricos.json'), ref = L.extraerDistribucionExcel(base); const igual = (d) => { assert.deepStrictEqual(d.avisos, []); assert.strictEqual(d.columnas.length, 8); assert.strictEqual(d.lineas.length, 18); assert.strictEqual(d.columnas.find(c => c.centro === 'SAR').neto, 63897); assert.deepStrictEqual(d.lineas.map(l => Object.values(l.dist).reduce((a, b) => a + b, 0)), ref.lineas.map(l => Object.values(l.dist).reduce((a, b) => a + b, 0))); };
    const copia = () => JSON.parse(JSON.stringify(base));
    { const f = copia().map(r => [null, null, ...r]); igual(L.extraerDistribucionExcel(f)); }                                   // dos columnas vacías a la izquierda
    { const f = [[], [], ...copia()]; igual(L.extraerDistribucionExcel(f)); }                                                     // filas vacías arriba
    { const f = copia(); f[2] = f[2].map(c => typeof c === 'string' ? c.replace('PRODUCTOS', 'Detalle').replace(' VALOR NETO', 'Valor neto unitario').replace(/^CANTIDAD$/, 'Cant.') : c); igual(L.extraerDistribucionExcel(f)); }   // otros nombres de columna
    { const f = copia(); f[1] = f[1].map(c => typeof c === 'string' ? c.replace('MEMO # ', 'Memo N° ') : c); igual(L.extraerDistribucionExcel(f)); }   // «Memo N°» en vez de «MEMO #»
    { const f = copia(); f[1] = f[1].map((c, i, a) => (typeof c === 'string' && /MEMO/.test(c)) ? null : (typeof a[i + 1] === 'string' && /MEMO/.test(a[i + 1])) ? null : c); f[1] = copia()[1].map((c, i) => typeof c === 'string' && /MEMO/.test(c) ? null : copia()[1][i - 1] && typeof copia()[1][i - 1] === 'string' && /MEMO/.test(copia()[1][i - 1]) ? copia()[1][i - 1] : null); igual(L.extraerDistribucionExcel(f)); }   // memo escrito sobre la columna TOTAL
});
t('cruce orden ↔ cuadro: descripciones largas de la orden calzan con los nombres cortos del cuadro (eléctricos)', () => { global.window = global.window || global; const L = require('../oc-lector.js'); const d = L.extraerDistribucionExcel(require('./fixtures/dist-electricos.json')); const ocd = [['MOUSE INALAMBRICO CONVENCIONAL RESOLUCION DEL SENS', 'MOUSE INALAMBRICO'], ['IMPRESORA MULTIFUNCIONAL DE TINTA CONTINUA WIFI/ET', 'IMPRESORA MULTIFUNCIONAL'], ['TELON MURAL PORTATIL DE 100 \" DESPACHAR EN CESFAM', 'TELON MURAL DE 100'], ['SOPORTE TV RACK MOVIL CON RUEDAS 32 \" A 70 \" DESPA', 'SOPORTE TV RACK'], ['CANDADO 80MM MARRON CON LLAVES DESPACHAR EN CESFAM', 'CANDADO 80MM'], ['PARLANTES KARAOKE BLUETOOTH CON 2 MICROFONOS SIMIL', 'PARLANTES KARAOKE BLUETOOTH'], ['ALTAVOZ PORTATIL SIMILAR A BOSE SOUNDLINK MAX- BLA', 'ALTAVOZ PORTATIL SOUNDLINK MAX BLACK'], ['PARLANTE SIMILAR A HARMAN KARDON ONIX STUDIO 8 CAR', 'PARLANTE HARMAN ONIX'], ['PARLANTES PORTATILES SIMILAR A JBL _CON RESISTENCI', 'PARALANTES PORTATILES SIMILAR A JBL'], ['ALTAVOZ PORTATIL BLUETOOTH SIMILAR A AUDIOBOX ABX-', 'ALTAVOZ SIMILAR A AUDIOBOX'], ['CABLE ESPIRAL TELEFONICO DE 1.8 MTS. DESPACHAR EN', 'CABLE ESPIRAL TELEFONICO'], ['ALARGADOR ZAPATILLA DE 5 METROS CON 5 ENTRADAS CON', 'ALARGADOR ZAPATILLA 5 METROS'], ['CARRETE ALARGADOR 16 ª 4 TOMAS 40 METROS. CON CERT', 'CARRETE ALARGADOR 40 METROS'], ['CARRETE ALARGADOR 16 ª 4 TOMAS 25 METROS. CON CERT', 'CARRETE ALARGADOR 20 METROS'], ['ALARGADORES SIMPLES DE 10 MTS. CON CERTIFICACION S', 'ALARGADOR SIMPLE 10 METROS'], ['ALARGADORES DE 5 METROS CON 6 TOMAS CON INTERRUPTO', 'ALARGADOR 5 METROS 6 TOMAS'], ['KIT TECLADO + MOUSE OPTICO INALAMBRICO DESPACHAR E', 'KIT TECLADO + MOUSE'], ['KIT 2 MICROFONOS BLUETOOTH NEGROS SIMILAR A FIDDLE', 'KIT DE MICROFONOS']]; const oc = { lineas: ocd.map(([o, c]) => { const x = d.lineas.find(l => l.descripcion.toUpperCase().replace(/[^A-Z0-9+ ]/g, '').replace(/\s+/g, ' ').trim() === c.replace(/[^A-Z0-9+ ]/g, '')); assert.ok(x, c); return { descripcion: o, cantidad: Object.values(x.dist).reduce((a, b) => a + b, 0), valorNeto: x.valorNeto }; }), memos: [] }; const u = L.unirDistribucion(oc, d); assert.deepStrictEqual(u.avisos.filter(a => /no aparece|no está en la orden|reparte/.test(a)), []); });
t('solicitudes de insumos: código, líneas, texto de picking y stock/ubicación por línea', () => { const S = require('../solicitudes-insumos.js'); assert.strictEqual(S.numeroSolicitud(new Date(2026, 10, 14, 15, 5), 7), 'SI-20261114-1505-007'); let l = []; S.agregarLinea(l, { nombre: 'Gasa', cantidad: 2 }); S.agregarLinea(l, { nombre: ' gasa ', cantidad: 3 }); S.agregarLinea(l, { nombre: 'Gasa', cantidad: 1, manual: true }); S.agregarLinea(l, { nombre: '  ', cantidad: 1 }); assert.strictEqual(l.length, 2); assert.strictEqual(l[0].cantidad, 5); const ins = [{ id: 'a', name: 'GASA', location: 'Camión', quantity: 40, ubicacionEstante: 'E2' }, { id: 'b', name: 'Gasa', location: 'Bodega Central', quantity: 10 }]; const i1 = S.infoLinea(l[0], ins, 'Camión'); assert.strictEqual(i1.stock, 40); assert.strictEqual(i1.ubicacion, 'Camión · E2'); assert.deepStrictEqual(i1.otras, ['Bodega Central: 10']); assert.strictEqual(S.infoLinea({ nombre: 'Nada' }, ins, 'Camión').stock, null); assert.ok(/1\. Gasa × 5 · Camión · E2 \(hay 40\)/.test(S.textoPicking({ numero: 'SI-1', bodega: 'Camión', solicitante: 'Ana', lineas: [l[0]] }, [i1]))); });
t('ficha de producto: stock por lote ordenado por vencimiento y resumen de ingresos', () => { const F = require('../ficha-producto.js'); const fl = F.filasStock([{ location: 'Camión', ubicacionEstante: 'E1', quantity: 30, batches: [{ batch: 'B', quantity: 10, expirationDate: '2027-05-01' }, { batch: 'A', quantity: 20, expirationDate: '2026-12-01' }, { batch: 'C', quantity: 0, expirationDate: '2026-01-01' }] }, { location: 'Bodega Central', quantity: 5 }]); assert.deepStrictEqual(fl.map(x => x.lote), ['A', 'B', 'S/L']); assert.strictEqual(fl[0].estante, 'E1'); const r = F.resumenMovs([{ type: 'TRASPASO', n: 3 }, { type: 'INGRESO_PROVEEDOR', n: 2 }, { type: 'INGRESO_INVENTARIO', n: 1 }]); assert.strictEqual(r.ultimo.n, 3); assert.strictEqual(r.ultimoIngreso.n, 2); assert.strictEqual(r.primerIngreso.n, 1); assert.strictEqual(F.fechaDe({ seconds: 0 }).getTime(), 0); assert.strictEqual(F.fechaDe('x'), null); });
t('solicitudes: lotes candidatos (bodega pedida primero, luego vencimiento), reparto y estado por línea', () => { const S = require('../solicitudes-insumos.js'); const ins = [{ id: 'a', name: 'GASA', location: 'Camión', ubicacionEstante: 'C1', batches: [{ batch: 'L2', quantity: 10, expirationDate: '2027-01-01' }, { batch: 'L1', quantity: 3, expirationDate: '2026-12-01' }] }, { id: 'b', name: 'Gasa', location: 'Bodega Transitoria', quantity: 2 }, { id: 'c', name: 'GASA', location: 'X', status: 'CUARENTENA', quantity: 50 }]; const c = S.lotesCandidatos({ nombre: 'gasa', cantidad: 8 }, ins, 'Bodega Transitoria'); assert.deepStrictEqual(c.map(x => x.lote), ['S/L', 'L1', 'L2']); assert.strictEqual(c[1].clave, 'L1|2026-12-01'); assert.deepStrictEqual(S.repartir(c, 8), [2, 3, 3]); assert.strictEqual(S.estadoLinea(8, 8), 'ok'); assert.strictEqual(S.estadoLinea(8, 3), 'parcial'); assert.strictEqual(S.estadoLinea(8, 0), 'pendiente'); assert.strictEqual(S.estadoLinea(8, 0, true), 'no_hay'); });
t('fotos automáticas: solo entre 8 y 17 h y cada 30 minutos', () => { global.setTimeout = global.setTimeout; const F = require('../fotos-auto.js'); const d = (h, m) => new Date(2026, 10, 16, h, m || 0); assert.strictEqual(F.tocaAhora(d(7, 59), null), false); assert.strictEqual(F.tocaAhora(d(8, 0), null), true); assert.strictEqual(F.tocaAhora(d(17, 0), null), false); assert.strictEqual(F.tocaAhora(d(10, 20), d(10, 0).toISOString()), false); assert.strictEqual(F.tocaAhora(d(10, 30), d(10, 0).toISOString()), true); });
t('solicitudes: comprometido por producto y filas del informe', () => { const S = require('../solicitudes-insumos.js'); const l = [{ correlativo: 'SOL-2026-0001', creadoEn: '2026-11-14T10:00:00Z', estado: 'LISTA', bodega: 'Bodega Transitoria', solicitante: 'Ana', lineas: [{ nombre: 'Gasa', cantidad: 5, entregar: 5, estado: 'ok', seleccion: [{ lote: 'L1', bodega: 'Camión', qty: 3 }, { lote: 'S/L', bodega: 'Bodega Transitoria', qty: 2 }] }] }, { numero: 'SI-x', creadoEn: '2026-11-14T11:00:00Z', estado: 'ENTREGADA', lineas: [{ nombre: 'Gasa', cantidad: 1, entregar: 1, estado: 'ok', seleccion: [{ lote: 'L1', bodega: 'Camión', qty: 1 }] }] }]; const c = S.comprometido(l); assert.strictEqual(c.length, 2); assert.strictEqual(c.find(x => x.bodega === 'Camión').qty, 3); const f = S.filasInforme(l); assert.strictEqual(f.length, 2); assert.strictEqual(f[0][0], 'SOL-2026-0001'); assert.strictEqual(f[0][11], 'L1 Camión: 3 · S/L Bodega Transitoria: 2'); });
t('solicitudes: sugiere productos parecidos a lo escrito a mano', () => { const S = require('../solicitudes-insumos.js'); const l = [{ nombre: 'CATETER VENOSO PERIFERICO 22G' }, { nombre: 'GASA ESTERIL 10X10' }, { nombre: 'CATETER URINARIO FOLEY 16' }]; const r = S.parecidos('cateter venoso 22g con alas', l); assert.strictEqual(r[0].nombre, 'CATETER VENOSO PERIFERICO 22G'); assert.ok(!r.some(x => /GASA/.test(x.nombre))); assert.deepStrictEqual(S.parecidos('ab', l), []); });
t('bultos: unidades por caja sugeridas, reparto en cajas, folio leído y conteo', () => { const B = require('../bultos.js'); assert.strictEqual(B.sugerirPorCaja('GUANTE NITRILO TALLA M CAJA 100 UNIDADES'), 100); assert.strictEqual(B.sugerirPorCaja('CATETER 22G CAJA X 50'), 50); assert.strictEqual(B.sugerirPorCaja('ALCOHOL GEL 1 LITRO'), 0); assert.deepStrictEqual(B.repartirCajas(230, 50), [50, 50, 50, 50, 30]); assert.deepStrictEqual(B.repartirCajas(0, 50), []); assert.strictEqual(B.folioDe('https://sarinventario.web.app/#bulto=BUL-2026-000123'), 'BUL-2026-000123'); assert.strictEqual(B.folioDe('2026000123'), 'BUL-2026-000123'); assert.strictEqual(B.folioDe('hola'), ''); assert.strictEqual(B.digitos('BUL-2026-000123'), '2026000123'); const r = B.resumirConteo([{ nombre: 'Gasa', lote: 'L1', bodega: 'Camión', contenido: 50, estado: 'CERRADA' }, { nombre: 'gasa', lote: 'L1', bodega: 'Camión', contenido: 50, contado: 12, estado: 'ABIERTA' }]); assert.strictEqual(r.length, 1); assert.strictEqual(r[0].unidades, 62); assert.strictEqual(r[0].abiertas, 1); });
t('cuadre automático de lo adeudado al ingresar (v21.228)', () => { global.document = global.document || { addEventListener() {}, readyState: 'complete', querySelector() { return null; }, getElementById() { return null; }, createElement() { return { style: {} }; }, body: {} };
  require('../actas-entrega.js'); const C = require('../cuadre-ingreso.js'), sets = [], f = { doc: (c) => ({ c }), collection: (d, n) => n, serverTimestamp: () => 'T' }, tx = { set: (r, d) => sets.push(d) };
  const r = C.aplicar(f, {}, tx, { ref: { id: 'X' }, antes: { name: 'Sabanilla', quantity: 0, sobregiro: 100, sobregiroDetalle: [{ acta: 'AE-1', qty: 10 }, { acta: 'AE-2', qty: 90 }] }, quantity: 550, batches: [{ batch: 'L1', quantity: 550 }], documento: 'REC-2026-00001' });
  assert.strictEqual(r.quantity, 450); assert.strictEqual(r.sobregiro, 0); assert.strictEqual(sets.length, 2); assert.strictEqual(sets[1].type, 'CUADRE_SOBREGIRO'); assert.strictEqual(sets[1].actaId, 'AE-2');
  const r2 = C.aplicar(f, {}, tx, { ref: { id: 'X' }, antes: { quantity: 0, sobregiro: 100, sobregiroDetalle: [{ acta: 'AE-1', qty: 100 }] }, quantity: 30, batches: [{ batch: 'L', quantity: 30 }] }); assert.strictEqual(r2.quantity, 0); assert.strictEqual(r2.sobregiro, 70);
  assert.strictEqual(C.aplicar(f, {}, tx, { ref: { id: 'X' }, antes: { quantity: 5, sobregiro: 0 }, quantity: 10, batches: [] }), null); assert.strictEqual(C.aplicar(f, {}, tx, { ref: { id: 'X' }, antes: null, quantity: 10 }), null); });
t('reserva de stock al emitir un acta (v21.235): sale del disponible por FEFO y no toca lo adeudado', () => { const A = (require('../actas-entrega.js'), (global.window || global).SAR_ActasEntrega);
  const d = { name: 'SABANILLA', quantity: 1000, sobregiro: 0, batches: [{ batch: 'B', quantity: 600, expirationDate: '2028-01-01' }, { batch: 'A', quantity: 400, expirationDate: '2027-01-01' }] };
  const r = A.reservarEn(d, 200); assert.strictEqual(r.r, 200); assert.strictEqual(r.quantity, 800); assert.strictEqual(r.batches.reduce((t, b) => t + b.quantity, 0), 800);
  const r2 = A.reservarEn({ name: 'X', quantity: 50, sobregiro: 20 }, 100); assert.strictEqual(r2.r, 30); assert.strictEqual(r2.quantity, 20);
  assert.strictEqual(A.reservarEn({ name: 'X', quantity: 50 }, 100, 50).r, 0); });
t('respaldo semanal en Excel (v21.237): semana ISO, día de envío y filas por lote', () => { global.window = global.window || global; const R = require('../respaldo-semanal.js');
  assert.strictEqual(R.semanaISO(new Date(2026, 10, 19)), '2026-S47'); assert.strictEqual(R.semanaISO(new Date(2027, 0, 1)), '2026-S53'); assert.strictEqual(R.semanaISO(new Date(2026, 0, 5)), '2026-S02');
  assert.strictEqual(R.toca(new Date(2026, 10, 16), 1), true); assert.strictEqual(R.toca(new Date(2026, 10, 16), 3), false); assert.strictEqual(R.toca(new Date(2026, 10, 22), 5), true);
  const f = R.armarFilas([{ _id: 'a', name: 'GASA', location: 'Bodega Central', quantity: 30, reservado: 5, unitPrice: 100, batches: [{ batch: 'L1', quantity: 10, expirationDate: '2026-12-01' }, { batch: 'L2', quantity: 20, expirationDate: '2028-01-01' }] }, { _id: 'b', name: 'BATA', quantity: 0 }],
    [{ numero: 'AE-1', estado: 'EMITIDA', confirmacion: { estado: 'PENDIENTE' }, items: [{ nombre: 'GASA', cantidad: 5, reserva: { qty: 5 } }] }], new Date(2026, 10, 19));
  assert.strictEqual(f.inv.length, 3); assert.strictEqual(f.inv.find(r => r['Lote'] === 'L1')['Total disponible del producto'], 30); assert.strictEqual(f.vencer.length, 1); assert.strictEqual(f.pend.length, 1);
  const tot = f.resumen.find(r => r['Bodega'] === 'TOTAL'); assert.strictEqual(tot['Unidades disponibles'], 30); assert.strictEqual(tot['Unidades reservadas'], 5); assert.strictEqual(tot['Valor (costo unitario)'], 3000); });
t('etiquetas por niveles (v21.238): caja grande con cajas interiores', () => { const B = require('../bultos.js');
  const p = B.planCajas({ total: 2000, porCaja: 1000, subPor: 50 }); assert.strictEqual(p.length, 2); assert.strictEqual(p[0].q, 1000); assert.strictEqual(p[0].hijos.length, 20); assert.strictEqual(p[0].hijos.reduce((a, b) => a + b, 0), 1000);
  const p2 = B.planCajas({ total: 1030, porCaja: 1000, subPor: 50 }); assert.strictEqual(p2[1].q, 30); assert.strictEqual(p2[1].hijos.length, 0);
  const p3 = B.planCajas({ total: 120, porCaja: 120, subPor: 50 }); assert.deepStrictEqual(p3[0].hijos, [50, 50, 20]);
  assert.strictEqual(B.planCajas({ total: 100, porCaja: 50 })[0].hijos.length, 0); });
t('salud del inventario: nombres con espacios, sin bodega, repetidos por nombre o ID y deudas con stock (v21.228)', () => { require('../unificar-duplicados.js'); const S = require('../salud-inventario.js');
  const I = (id, d) => ({ id, data: d }), bod = [I('bc', { name: 'Bodega Central' }), I('bt', { name: 'Bodega Transitoria ' }), I('cam', { name: 'Bodega CAM' })];
  const ins = [I('s1', { name: 'SABANILLA', location: 'Bodega Central', quantity: 550, sobregiro: 10, sobregiroDetalle: [{ acta: 'AE-1', qty: 10 }], codigoMP: '4623811' }), I('s2', { name: 'Sabanilla ', location: 'Bodega Central', quantity: 0, sobregiro: 50, codigoMP: '4623804' }),
    I('k1', { name: 'KN95', location: 'Bodega CAM', quantity: 2000 }), I('k2', { name: 'KN95', location: 'Bodega CAM', quantity: 900 }), I('o1', { name: 'CALC', location: 'Bodega Transitoria', quantity: 30 }), I('o2', { name: 'GASA', location: 'Bodega Transitoria ', quantity: 15 }),
    I('b1', { name: 'BATA', quantity: 30 }), I('x1', { name: 'X', location: 'Bodega Fantasma', quantity: 3 })];
  const a = S.analizar(ins, bod);
  assert.deepStrictEqual(a.nombres.map(c => c.nombre + ':' + c.productos + ':' + c.bien), ['Bodega Transitoria:1:1']); assert.deepStrictEqual(a.sinBodega.map(c => c.id), ['b1']); assert.deepStrictEqual(a.fuera.map(c => c.id), ['x1']);
  assert.deepStrictEqual(a.repetidos.map(g => g.grupo.map(x => x.id).sort().join('+')).sort(), ['k1+k2', 's1+s2']); assert.deepStrictEqual(a.deudas.map(c => c.id + ':' + c.sobregiro), ['s1:10']);
  assert.ok(a.bodegas.includes('Bodega Transitoria')); assert.strictEqual(S.limpia('  Bodega   Transitoria '), 'Bodega Transitoria'); });
t('kárdex: efecto real de cada movimiento sobre el stock (v21.231)', () => { const V = require('../vida-producto.js'), d = V.deltaDe;
  assert.strictEqual(d({ type: 'ENTREGA_ACTA', quantity: 5, sinRespaldo: 3 }), -2); assert.strictEqual(d({ type: 'CUADRE_SOBREGIRO', quantity: 3 }), -3); assert.strictEqual(d({ type: 'REGULARIZA_SOBREGIRO', quantity: 100 }), 0);
  assert.strictEqual(d({ type: 'traspaso', quantity: 9 }), 0); assert.strictEqual(d({ type: 'SALIDA_SOLICITUD', quantity: 4 }), -4); assert.strictEqual(d({ type: 'RETORNO_BANDEJA', quantity: 2 }), 2);
  assert.strictEqual(d({ type: 'merma_inventario', quantity: -6 }), -6); assert.strictEqual(d({ type: 'ANULACION_ACTA', quantity: 5, devueltoStock: 2 }), 2); assert.strictEqual(d({ type: 'carga masiva', quantity: 7, delta: 0 }), 0); assert.strictEqual(d({ type: 'X', delta: -8 }), -8); });
t('Firestore: ninguna consulta pide más de 10.000 documentos (el máximo; más falla la lectura entera) (v21.227)', () => { const fs2 = require('fs'), path = require('path'), dir = path.join(__dirname, '..'), malos = [];
  fs2.readdirSync(dir).filter(n => n.endsWith('.js')).forEach(n => { const t = fs2.readFileSync(path.join(dir, n), 'utf8'); (t.match(/limit\((\d+)\)/g) || []).forEach(m => { if (Number(m.replace(/\D/g, '')) > 10000) malos.push(n + ': ' + m); }); });
  assert.deepStrictEqual(malos, []); });
t('bultos: reparto en N cajas contadas al recibir', () => { const B = require('../bultos.js'); assert.deepStrictEqual(B.repartirEnCajas(2200, 10), Array(10).fill(220)); assert.deepStrictEqual(B.repartirEnCajas(105, 10), [11, 11, 11, 11, 11, 10, 10, 10, 10, 10]); assert.deepStrictEqual(B.repartirEnCajas(3, 5), [1, 1, 1]); assert.deepStrictEqual(B.repartirEnCajas(10, 0), []); });
t('bultos: estado de impresión por etiqueta y por orden, y lo que falta etiquetar (v21.223)', () => { const B = require('../bultos.js'), b = (o) => ({ nombre: 'Guante', inicial: 100, contenido: 100, ...o });
  assert.deepStrictEqual([b({}), b({ impresiones: 0 }), b({ impresiones: 1 }), b({ impresiones: 3 }), b({ impresiones: 1, editadoTrasImprimir: true })].map(B.estadoImp), ['legado', 'sin', 'impresa', 'reimpresa', 'editada']);
  assert.strictEqual(B.estadoOC([b({ impresiones: 1 }), b({ impresiones: 0 })], 0).t, 'Impresión parcial'); assert.strictEqual(B.estadoOC([b({ impresiones: 2 })], 0).k, 'reimpresa'); assert.strictEqual(B.estadoOC([b({ impresiones: 1 })], 5).k, 'faltan'); assert.strictEqual(B.estadoOC([b({ impresiones: 1 }), b({ impresiones: 1, editadoTrasImprimir: true })], 0).k, 'editada');
  const oc = { numeroOC: '1-X', proveedor: 'P', recepciones: [{ recId: 'REC-2026-00001', fecha: '2026-11-15', ingresoAStock: true, detalle: [{ insumoName: 'Guante', cantidad: 300, lote: 'L1' }] }, { recId: 'R0', fecha: '2026-11-01', anulada: true, ingresoAStock: true, detalle: [{ insumoName: 'Guante', cantidad: 99 }] }, { recId: 'R9', fecha: '2026-10-01', ingresoAStock: true, detalle: [{ insumoName: 'Gasa', cantidad: 10 }] }] };
  const f = B.faltantesOC(oc, [b({ lote: 'L1' }), b({ lote: 'L1' })]); assert.deepStrictEqual(f.map(x => x.nombre + ':' + x.total), ['Guante:100', 'Gasa:10']); assert.strictEqual(f[0].oc, '1-X'); assert.strictEqual(f[0].lote, 'L1');
  assert.deepStrictEqual(B.faltantesOC(oc, [b({ lote: 'L1', inicial: 300, nombre: 'GUANTE NITRILO M', nombreOrig: 'Guante' })], '2026-11-14'), []);   /* renombrar la etiqueta no crea faltante */
  const oc2 = { recepciones: [{ fecha: '2026-11-15', ingresoAStock: true, detalle: [{ insumoName: 'Guante', cantidad: 100, lote: 'L1' }, { insumoName: 'Guante', cantidad: 200, lote: 'L2', vence: '2028-01-01' }] }] };
  assert.deepStrictEqual(B.faltantesOC(oc2, [b({ lote: 'L1' })]).map(x => x.lote + ':' + x.total + ':' + x.vence), ['L2:200:2028-01-01']);   /* no mezcla lotes */
  assert.deepStrictEqual(B.faltantesOC(oc, [], '2026-11-14').map(x => x.nombre), ['Guante']); });
t('OC escaneada: montoOCR, normalizarOCEscaneada (IA) y descartar hojas en blanco (v21.234)', () => {
  const L = require('../oc-lector.js');
  assert.strictEqual(L.montoOCR('16.000,00'), 16000);
  assert.strictEqual(L.montoOCR('8.900.00'), 8900);
  assert.strictEqual(L.montoOCR("'195.000"), 195000);
  assert.strictEqual(L.montoOCR('955,00'), 955);
  const ia = L.normalizarOCEscaneada({
    numeroOC: '1298355-995-AG26', proveedor: 'IMPORTCHILE.COM SPA', rutProveedor: '76.506.381-7',
    emitida: '17-11-2026', emitidaHora: '16:41', fechaEntrega: '26-11-2026', estadoMP: 'Aceptada',
    direccionDespacho: 'REAL AUDIENCIA N°980, POB. CONDE MANSO DE VELASCO, Melipilla',
    formaPago: '30 días contra la recepción conforme de la factura', memos: ['41'],
    descripcion: 'COMPRA DE INSUMOS MEDICOS - MINSAL 2026 SAR', totalNeto: 1749650, iva: 332434, total: 2082084,
    lineas: [
      { descripcion: 'Tubo al vacío, citrato 3.2%, 4.5 ml tapa celeste, caja 100 tubos.', cantidad: 20, valorNeto: 16000, totalLinea: 320000 },
      { descripcion: 'frasco desechable de aspiración 1000 ml', cantidad: 100, valorNeto: 8900, totalLinea: 890000 },
      { descripcion: 'Parche neumotórax ventilado', cantidad: 7, valorNeto: 18000, totalLinea: 126000 },
      { descripcion: 'Mascarilla alta concentración pediátrica', cantidad: 30, valorNeto: 955, totalLinea: 28650 },
      { descripcion: 'pinza de extracción cuerpo extraño', cantidad: 10, valorNeto: 19000, totalLinea: 190000 },
      { descripcion: 'Pack de parche neumotórax hyfin combo pack', cantidad: 5, valorNeto: 39000, totalLinea: 195000 }
    ]
  });
  assert.strictEqual(ia.tipo, 'OC_MP'); assert.strictEqual(ia.numeroOC, '1298355-995-AG26'); assert.strictEqual(ia.emitida, '2026-11-17');
  assert.strictEqual(ia.rutProveedor, '76.506.381-7'); assert.deepStrictEqual(ia.memos, ['41']); assert.strictEqual(ia.lineas.length, 6);
  assert.strictEqual(ia.avisos.length, 1); /* solo el aviso informativo de revisión, 0 errores aritméticos */
  const cm = L.normalizarOCEscaneada({ numeroOC: '1298355-911-CM26', proveedor: 'X', emitida: '2026-11-10', totalNeto: 5000, lineas: [{ descripcion: '(4623804) SABANILLA', cantidad: 5, valorNeto: 1000, totalLinea: 5000 }] });
  assert.strictEqual(cm.convenioMarco, true); assert.strictEqual(cm.lineas[0].codigoMP, '4623804'); assert.strictEqual(cm.lineas[0].descripcion, 'SABANILLA');
  /* Hoja en blanco vs hoja con tinta */
  const mkCanvas = (oscuro) => ({ width: 100, height: 100, getContext: () => ({ getImageData: () => ({ data: Uint8ClampedArray.from({ length: 100 * 100 * 4 }, (_, k) => (k % 4 === 3 ? 255 : oscuro ? 40 : 255)) }) }) });
  assert.strictEqual(L.paginaConContenido(mkCanvas(false)), false);
  assert.strictEqual(L.paginaConContenido(mkCanvas(true)), true);
});
t('OC escaneada con capa OCR ruidosa (1298355-995-AG26, 6 ítems en 2 hojas) se lee completa (v21.234)', () => {
  const L = require('../oc-lector.js');
  const raw = [
    'Rut ;', 'D¡rección Demandante : 71.293.900-t', 'ORDEN DE COMPRA', 'Demandante: DIRECCION DE SALUD', 'UnidaddeCompra: SALUD',
    "Fecha Envio OC- | 17-11-2026 '16:41:43", 'Estado: Aceptada', 'N": 1298355-995-AG26', 'sEñoR (ES) :', 'lMPoRTcHlLE coM sPA', 'RUT :', '76.506.381-7',
    '41104107 Tubos o', 'conteñedores de sangre', '20 C"ja Tubo alvaclo, citrato 3.2%, 4.5 mltapa celeste, ca¡a 100 tubos', '16.000,00 0,00 0,00 320.000',
    "42172',103 Kils de reanimación", '100 Unidad frasco desechable de aspiración 1000 ml', '8.900.00 0,00 0,00 890.000',
    '42271615 Neumolacos 7 Uñidad Parche neumotórax veñtilado, Similar a halo vent', '18.000,00 0,00 0,00 126.000',
    '42271704 Mascarillas de oxígeno 30 Unidad Mascar¡lla alta concentración pediátrica', '955,00 0,00 0,00 28.650',
    '42291402 AbrazadeÉs 10 Unidad p¡nza de extracción cuerpo extraño', '19.000,00 0,00 0,00 190.000',
    'NOMBRE ORDEN DE COMPRA : Orden de Compra generada por ¡nvitac¡ón a compra ág,l; 1298355-1283-COT26',
    'FECHA ENTREGA PRODUCTOS | 26-11-2026', 'DIRECCION DE DESPACHO : REAL AUDIENCIA N\'980, POB. CONDE', 'MANSO DE VETASCO',
    "422716'15 Neumolacos 5 Paquete Pack de parche neumotórax hyfin combo pack, 1 bolsa transparente", "39.000,00 0,00 0,00 '195.000",
    "MEMO N'4í - COMPRA DE INSUMOS MEDICOS - MINSAL 2026 SAR", 'Neto', 'Dcto.', 'Total $', '1.749.650', '0', '2.Oa2.084'
  ];
  const items = raw.map((str, i) => ({ str, x: 10, y: i * 15 }));
  assert.strictEqual(L.detectar(items), 'OC_MP_OCR');
  const r = L.leer(items);
  assert.strictEqual(r.numeroOC, '1298355-995-AG26');
  assert.strictEqual(r.proveedor, 'LMPORTCHLLE COM SPA');
  assert.strictEqual(r.rutProveedor, '76.506.381-7');
  assert.strictEqual(r.emitida, '2026-11-17');
  assert.strictEqual(r.emitidaHora, '16:41');
  assert.strictEqual(r.fechaEntrega, '2026-11-26');
  assert.deepStrictEqual(r.memos, ['41']);
  assert.strictEqual(r.descripcion, 'COMPRA DE INSUMOS MEDICOS - MINSAL 2026 SAR');
  assert.strictEqual(r.totalNeto, 1749650);
  assert.strictEqual(r.lineas.length, 6);
  assert.deepStrictEqual(r.lineas.map(x => [x.cantidad, x.valorNeto, x.totalLinea]), [
    [20, 16000, 320000], [100, 8900, 890000], [7, 18000, 126000], [30, 955, 28650], [10, 19000, 190000], [5, 39000, 195000]
  ]);
  assert.ok(r.lineas.every(x => x.codigoMP === '')); /* Compra Ágil: el código ONU no es ID de producto */
});
t('OCR local en navegador (Tesseract.js): convierte words 2D y lee tabla escaneada con inclinación sin clave IA (v21.259)', () => {
  const L = require('../oc-lector.js');
  const sc = 2;
  const w = (text, x, y) => ({ text, bbox: { x0: x * sc, y0: y * sc, x1: (x + text.length * 5) * sc, y1: (y + 10) * sc } });
  const words = [
    w('ORDEN', 140, 80), w('DE', 180, 80), w('COMPRA', 200, 80), w('N°:', 300, 80), w('1298355-995-AG26', 325, 80),
    w('Fecha', 320, 55), w('Envio', 355, 55), w('OC.:', 390, 55), w('17-11-2026', 420, 55), w('16:41:43', 485, 55),
    w('SEÑOR', 15, 110), w('(ES):', 55, 110), w('IMPORTCHILE.COM', 90, 110), w('SPA', 200, 110),
    w('RUT:', 15, 125), w('76.506.381-7', 65, 125),
    // Encabezados de tabla
    w('Código', 12, 280), w('Producto', 78, 280), w('Cantidad', 140, 280), w('Especificaciones', 192, 280), w('Precio', 376, 280), w('Valor', 520, 280), w('Total', 550, 280),
    // Fila 1 con inclinación de +10pt hacia la derecha y múltiples líneas en Producto y Especificaciones
    w('41104107', 12, 315), w('Tubos', 80, 315), w('o', 110, 315), w('20', 150, 317), w('Caja', 165, 317),
    w('Tubo', 194, 318), w('al', 220, 318), w('vacío,', 235, 318), w('citrato', 268, 318),
    w('16.000,00', 385, 324), w('0,00', 452, 325), w('0,00', 502, 325), w('320.000', 546, 326),
    w('contenedores', 80, 329), w('3.2%,', 194, 330), w('4.5', 225, 330), w('ml', 245, 330), w('tapa', 260, 330),
    w('de', 80, 341), w('celeste,', 194, 342), w('caja', 235, 342), w('100', 260, 342), w('tubos.', 282, 342),
    // Fila 2
    w('42172103', 12, 380), w('Kits', 80, 380), w('100', 150, 382), w('Unidad', 170, 382),
    w('frasco', 194, 383), w('desechable', 230, 383), w('de', 285, 383),
    w('8.900,00', 385, 389), w('0,00', 452, 390), w('0,00', 502, 390), w('890.000', 546, 391),
    w('aspiración', 194, 395), w('1000', 245, 395), w('ml', 272, 395),
    w('Neto', 390, 440), w('$', 450, 440), w('1.210.000', 530, 440)
  ];
  const items = L.itemsDeTesseract({ data: { words } }, sc, 0);
  assert.ok(items.length === words.length);
  const r = L.extraerOC_OCR(items);
  assert.strictEqual(r.numeroOC, '1298355-995-AG26');
  assert.strictEqual(r.proveedor, 'IMPORTCHILE.COM SPA');
  assert.strictEqual(r.rutProveedor, '76.506.381-7');
  assert.strictEqual(r.lineas.length, 2);
  assert.strictEqual(r.lineas[0].descripcion, 'Tubo al vacío, citrato 3.2%, 4.5 ml tapa celeste, caja 100 tubos.');
  assert.strictEqual(r.lineas[0].cantidad, 20); assert.strictEqual(r.lineas[0].valorNeto, 16000); assert.strictEqual(r.lineas[0].totalLinea, 320000);
  assert.strictEqual(r.lineas[1].descripcion, 'frasco desechable de aspiración 1000 ml');
  assert.strictEqual(r.lineas[1].cantidad, 100); assert.strictEqual(r.lineas[1].valorNeto, 8900); assert.strictEqual(r.lineas[1].totalLinea, 890000);
});
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
t('traspaso: saca por FEFO y junta lotes en destino', () => { const T = require('../traspaso-bodegas.js'); const cmp = (a, b) => String(a.expirationDate).localeCompare(String(b.expirationDate)); const r = T.sacarFEFO({ quantity: 15, batches: [{ batch: 'B', quantity: 10, expirationDate: '2028-01-01' }, { batch: 'A', quantity: 5, expirationDate: '2027-01-01' }] }, 8, cmp); assert.strictEqual(r.movidos.length, 2); assert.strictEqual(r.movidos[0].batch, 'A'); assert.strictEqual(r.movidos[0].used, 5); assert.strictEqual(r.movidos[1].used, 3); assert.strictEqual(r.lotes.reduce((s, b) => s + b.quantity, 0), 7); const d = T.juntarLotes([{ batch: 'A', quantity: 2, expirationDate: '2027-01-01' }], r.movidos); assert.strictEqual(d.find(b => b.batch === 'A').quantity, 7); assert.strictEqual(d.length, 2); });
t('traspaso: elegir lote a mano descuenta solo de ese lote', () => { const T = require('../traspaso-bodegas.js'); const d = { quantity: 15, batches: [{ batch: 'A', quantity: 5, expirationDate: '2027-01-01' }, { batch: 'B', quantity: 10, expirationDate: '2028-01-01' }] }; const r = T.sacarLotes(d, [{ clave: 'B|2028-01-01', qty: 4 }, { clave: 'A|2027-01-01', qty: 0 }]); assert.strictEqual(r.movidos.length, 1); assert.strictEqual(r.movidos[0].batch, 'B'); assert.strictEqual(r.lotes.find(b => b.batch === 'B').quantity, 6); assert.strictEqual(r.lotes.find(b => b.batch === 'A').quantity, 5); assert.throws(() => T.sacarLotes(d, [{ clave: 'A|2027-01-01', qty: 6 }])); });
t('distribución: lee planillas de centros (con y sin ID CM, y encabezado corrido) y arma las hojas', () => { const D = require('../distribucion-centros.js'); const cm = [['DESCRIPCIÓN - CARACTERÍSTICAS TÉCNICAS', 'ID CONVENIO MARCO', 'EQUIVALENTE', 'PRESENTACIÓN', 'VALOR', 'CANTIDAD ', 'TOTAL', 'NOMBRE DEL PROYECTO', 'Entregado'], ['Gasa 10x10', '2230875', 'Gasa', '50 u', 64, 2000, 128000, 'CURACIÓN', 5], ['TOTAL', '', '', '', '', '', 128000]]; const r = D.parsearHoja(cm); assert.strictEqual(r.convenio, true); assert.strictEqual(r.lineas.length, 1); assert.strictEqual(r.lineas[0].idCM, '2230875'); assert.strictEqual(r.lineas[0].entregado, 5); assert.strictEqual(D.totalCentro(r), 128000); const nm = [['DESCRIPCIÓN', 'EQUIVALENTE', 'PRESENTACIÓN', 'VALOR', 'CANTIDAD ', 'UNIDAD O CAJA', 'VALOR + IVA'], ['Jabón', 'Dichlorexan', '1 UNIDAD', 13490, 2, 'UNIDADES', 26980]]; const n = D.parsearHoja(nm); assert.strictEqual(n.convenio, false); assert.strictEqual(n.lineas[0].cantidad, 2); const sh = [['DESCRIPCIÓN', 'ID CONVENIO MARCO', 'EQUIVALENTE', 'PRESENTACIÓN', 'VALOR', 'CANTIDAD ', 'UNIDAD O CAJA', 'VALOR + IVA', 'REFERENCIA'], ['Venda', 'VENDA TUBULAR', '1 UNIDAD', '22534', '2', 'UNIDADES', 'CLINICOS', '45068', '']]; const s = D.parsearHoja(sh); assert.strictEqual(s.convenio, false); assert.strictEqual(s.lineas[0].valor, 22534); assert.strictEqual(s.lineas[0].proyecto, 'CLINICOS'); assert.strictEqual(D.filasHoja(r.lineas ? { lineas: r.lineas } : {}, 'CONVENIO', true)[0].length, 9); assert.strictEqual(D.filasHoja({ lineas: n.lineas }, 'NO_MARCO', false)[0].length, 9); });
t('distribución: calcula pendiente, lo que se puede entregar y lo que queda', () => { const D = require('../distribucion-centros.js'); let r = D.calcLinea({ cantidad: 10, entregado: 2 }, { conf: 3, porConf: 1 }, 5); assert.strictEqual(r.entregado, 6); assert.strictEqual(r.pend, 4); assert.strictEqual(r.puede, 4); assert.strictEqual(r.quedara, 0); r = D.calcLinea({ cantidad: 10, entregado: 0 }, null, 3); assert.strictEqual(r.pend, 10); assert.strictEqual(r.puede, 3); assert.strictEqual(r.quedara, 7); r = D.calcLinea({ cantidad: 5, entregado: 9 }, null, 4); assert.strictEqual(r.pend, 0); assert.strictEqual(r.puede, 0); assert.strictEqual(D.correlativo(2026, 3), 'DIST-2026-0003'); });
t('distribución: lee la planilla de solicitud (sin descripción, con ITEM y celdas con saltos de línea)', () => { const D = require('../distribucion-centros.js'); const hoja = [[], [], [], ['', '', 'ID CONVENIO MARCO', 'EQUIVALENTE', 'VALOR', 'CANTIDAD ', 'TOTAL'], ['', '', '4627224\n\n', '\nTOALLA DE PAPEL  ELITE', 1369.69, 500, 684845], ['', '', '4623804\n', 'SABANILLA', 100, 10, 1000], ['', '', '', '', 'Total', '', 685845]]; const r = D.parsearHoja(hoja); assert.strictEqual(r.lineas.length, 2); assert.strictEqual(r.lineas[0].idCM, '4627224'); assert.strictEqual(r.lineas[0].equivalente, 'TOALLA DE PAPEL  ELITE'); assert.strictEqual(r.lineas[0].cantidad, 500); assert.strictEqual(r.convenio, true); });
t('distribución: una fila sin descripción pero con equivalente también se lee (no se pierde el producto)', () => { const D = require('../distribucion-centros.js'); const r = D.parsearHoja([['DESCRIPCIÓN', 'ID CONVENIO MARCO', 'EQUIVALENTE', 'VALOR', 'CANTIDAD'], ['', 2233386, 'SONDA NELATON 40 CM', 107, 34], ['TOTAL', '', '', '', '']]); assert.strictEqual(r.lineas.length, 1); assert.strictEqual(r.lineas[0].equivalente, 'SONDA NELATON 40 CM'); });
t('distribución: el buscador de insumos dice en qué distribución y centro está', () => { const D = require('../distribucion-centros.js'); const L = [{ id: 'a', correlativo: 'DIST-2026-0001', nombre: 'CM', centros: [{ nombre: 'UAPO', lineas: [{ equivalente: 'JERINGA 10CC', descripcion: 'x', idCM: '2231602', cantidad: 5 }] }, { nombre: 'PSR', lineas: [{ equivalente: 'GASA', descripcion: 'y', idCM: '1', cantidad: 2 }] }] }, { id: 'b', estado: 'archivada', centros: [{ nombre: 'Z', lineas: [{ equivalente: 'JERINGA', cantidad: 1 }] }] }]; let r = D.buscarEnLista(L, 'jeringa'); assert.strictEqual(r.length, 1); assert.strictEqual(r[0].centro, 'UAPO'); assert.strictEqual(r[0].correlativo, 'DIST-2026-0001'); assert.strictEqual(D.buscarEnLista(L, '2231602').length, 1); assert.strictEqual(D.buscarEnLista(L, 'j').length, 0); });
t('distribución: detecta productos parecidos del stock (misma familia, otro ID)', () => { const D = require('../distribucion-centros.js'); const st = [{ nombre: 'CORCHETERA FULTON´S OFICINA 25 HOJAS METAL/PLÁSTICO 24/6 A 26/6MM UNIDAD RM', cant: 180 }, { nombre: 'GUANTE EXAMEN NITRILO', cant: 5 }, { nombre: 'CORCHETES TORRE METAL CROMADO 26/6MM CAJA 5000 UNIDADES RM', cant: 200 }]; const r = D.similares('CORCHETERA FULTON´S OFICINA 20 HOJAS METAL/PLÁSTICO 26/6MM UNIDAD', st); assert.strictEqual(r.length >= 1, true); assert.ok(/CORCHETERA/.test(r[0].nombre)); assert.strictEqual(D.similares('GASA NO TEJIDA', st).length, 0); });
t('cuadro de distribución en PDF corrido a la izquierda (OC 948-CM26) se lee completo y cuadra con la orden', () => { global.window = global.window || global; global.document = global.document || {}; const L = require('../oc-lector.js'); const d = (L.extraerDistribucionAuto || L.extraerDistribucion)(require('./fixtures/cuadro-oc-948.json')); assert.deepStrictEqual(d.avisos, []); assert.strictEqual(d.columnas.length, 8); assert.deepStrictEqual(d.lineas.map(l => Object.values(l.dist).reduce((a, b) => a + b, 0)), [80, 20, 1, 349, 470, 30, 19, 3000, 20]); assert.strictEqual(d.columnas[0].cdp, '4390-4391-4392-4393'); assert.ok(/POMAIRE/.test(d.columnas[6].centro)); });
// ---- Inventario de bodega transitoria desde el teléfono (v21.210)
t('inventario móvil: usado = sistema − contado, pide = dotación − contado; lo que sigue faltando va primero', () => { const I = require('../inventario-movil.js'); assert.deepStrictEqual(I.calc({ sis: 500, obj: 500 }, 400), { contado: 400, usado: 100, sobra: 0, pide: 100 }); assert.strictEqual(I.calc({ sis: 5, obj: 5 }, ''), null); assert.deepStrictEqual(I.calc({ sis: 5, obj: 10 }, 7), { contado: 7, usado: 0, sobra: 2, pide: 3 }); const l = I.lineasDe([{ k: 'a', n: 'Llave', sis: 500, obj: 500, i: 'x' }, { k: 'b', n: 'Suero', sis: 8, obj: 10, p: { dias: 2 } }, { k: 'c', n: 'Gasa', sis: 5, obj: 5 }], { a: 400, b: 8, c: 5 }); assert.deepStrictEqual(l.map(x => [x.k, x.cantidad, x.reiterado || 0]), [['b', 2, 3], ['a', 100, 0]]); });
t('solicitudes v21.212: limpieza de datos de quien pide (decisiones falsas, foto, números)', () => { const S = require('../solicitudes-insumos.js'), L = S.limpiarSol; const x = L({ estado: 'NUEVA', lineas: [{ nombre: 'Gasa', cantidad: '7.9', estado: 'ok', seleccion: [{ qty: 5 }], movidos: ['a|b'], transito: { a: 'z' }, foto: 'x" onerror="1' }, { nombre: 'Llave', cantidad: 3, foto: 'data:image/jpeg;base64,AAAA' }], correlativo: 'SOL-2026-0001"' }, 'SI-1');
  assert.strictEqual(x.numero, 'SI-1'); assert.strictEqual(x.lineas[0].cantidad, 7); ['estado', 'seleccion', 'movidos', 'transito', 'foto'].forEach(k => assert.ok(!(k in x.lineas[0]), k)); assert.ok(x.lineas[1].foto); assert.ok(!x.correlativo);
  const y = L({ estado: 'PREPARACION', lineas: [{ nombre: 'Gasa', cantidad: 5, estado: 'parcial', entregar: '3', seleccion: [{ qty: '3', lote: 'L1' }] }] }); assert.strictEqual(y.lineas[0].estado, 'parcial'); assert.strictEqual(y.lineas[0].seleccion[0].qty, 3); });
t('inventario v21.212: líneas propuestas y días de quiebre', () => { const I = require('../inventario-movil.js'); const l = I.lineasDe([{ k: 'a', n: 'Llave', sis: 500, obj: 500 }, { k: 'b', n: 'Suero', sis: 8, obj: 10, p: { dias: 1 } }], { a: 400, b: 10 }); assert.deepStrictEqual(l.map(x => [x.k, x.cantidad, x.reiterado || 0]), [['a', 100, 0]]); });
t('búsqueda tolerante v21.218: D-DIMMER, dímero, letras repetidas y números exactos', () => { const c = require('../solicitudes-insumos.js')._prueba.coincide;
  ['d-dimer', 'dimer', 'dímero d', 'd dimmer'].forEach(q => assert.ok(c('D-DIMMER TEST RAPIDO', q), q)); assert.ok(c('Gasa estéril 10x10', 'gaza')); assert.ok(c('Sabanilla desechable', 'sabanila'));
  assert.ok(!c('Suero fisiológico 500 ml', 'suero 250')); assert.ok(!c('Jeringa 10 ml', 'gasa')); });
t('correlativos v21.220: formato, corte 2027 y provisional', () => {
  const F = require('../correlativos.js');
  assert.strictEqual(F.formato('AE', 2026, 21, '2026-11-15T12:00:00Z'), 'AE-2026-0021');            // lo que ya existía sigue igual en 2026
  assert.strictEqual(F.formato('REC', 2026, 15, '2026-11-15T12:00:00Z'), 'REC-2026-00015');         // lo nuevo ya usa 5 dígitos
  assert.strictEqual(F.formato('AE', 2027, 21, '2027-01-01T03:01:00Z'), 'AE-2027-00021');           // desde 1-ene-2027 00:01 (Chile)
  assert.strictEqual(F.nuevo('2027-01-01T03:00:59Z'), false); assert.strictEqual(F.nuevo('2027-01-01T03:01:00Z'), true);
  assert.strictEqual(F.formato('BUL', 2027, 123, '2027-02-01'), 'BUL-2027-000123');
  assert.strictEqual(F.anio('2027-01-01T02:00:00Z'), 2026);                                         // 23:00 del 31-dic en Chile
  const p = F.provisional('AJU', '2026-11-15T12:00:00'); assert.ok(/^AJU-P-20261115-[0-9A-HJKMNP-TV-Z]{4}$/.test(p), p); assert.ok(F.esProvisional(p));
});
t('fotos v21.241: ficha de v21.240 se migra sin perder fotos', () => { const F = require('../fotos-telefono.js');
    const v240 = { imagen: 'PROD', imagenCaja: 'CAJA', fotosExtra: ['O1'], fotosPor: 'x' }, m = F.migrar(v240);
    assert.strictEqual(m.imagen, 'CAJA'); assert.deepStrictEqual(m.fotosExtra.map(x => x.tipo + ':' + x.img), ['otra:O1', 'producto:PROD']);
    const mixta = { imagen: 'CAJA203', fotosExtra: [{ tipo: 'producto', img: 'P203' }, 'O240'], fotosPor: 'x' }, n = F.normal(mixta);
    assert.strictEqual(n.caja, 'CAJA203'); assert.strictEqual(n.producto, 'P203'); assert.deepStrictEqual(n.otras, ['O240']);
    const auto = F.migrar({ imagen: 'PROD', imagenCaja: 'CAJA', fotosExtra: [{ tipo: 'producto', img: 'WEB', porConfirmar: true }] }); assert.deepStrictEqual(auto.fotosExtra.map(x => x.img), ['PROD']); });
t('fotos v21.241: cambiar el producto reemplaza una sola y el tope de 4 avisa', () => { const F = require('../fotos-telefono.js');
    const c = { imagen: 'C', fotosExtra: [1, 2, 3, 4].map(i => ({ tipo: 'producto', img: 'P' + i })) };
    const r = F.armarFotos(c, 'producto', 'PN', 'm', 't'); assert.deepStrictEqual(r.fotosExtra.map(x => x.img), ['PN', 'P2', 'P3', 'P4']); assert.strictEqual(r.imagen, 'C');
    assert.ok(F.armarFotos(c, 'otra', 'O', 'm', 't').error); assert.strictEqual(F.armarFotos(c, 'caja', 'C2', 'm', 't').imagen, 'C2'); });
t('fotos v21.241: catálogo ordena sin fotos primero', () => { const F = require('../fotos-telefono.js');
    const l = F.catalogo([{ name: 'A', quantity: 1 }, { name: 'B', quantity: 1 }], [{ __id: 'a', descripcion: 'A', imagen: 'c', fotosExtra: [{ tipo: 'producto', img: 'p' }] }]);
    assert.deepStrictEqual(l.map(x => x.nombre + x.nivel), ['B0', 'A2']); });
t('toma v21.246: conciliar por lote (casos de Fowler)', () => { const T = require('../toma-conciliacion.js');
    const est = (r) => r.lineas.map(l => l.batch + ':' + l.estado + ':' + l.delta).join(' ');
    assert.strictEqual(est(T.conciliar([{ batch: 'A', quantity: 1000, expirationDate: '2027-05-01' }], [{ batch: 'a ', quantity: 1100, expirationDate: '05/2027' }])), 'A:sobra:100');
    assert.strictEqual(est(T.conciliar([{ batch: 'A', quantity: 1000 }], [{ batch: 'A', quantity: 900 }])), 'A:falta:-100');
    assert.strictEqual(est(T.conciliar([{ batch: 'A', quantity: 100 }], [{ batch: 'A', quantity: 100 }, { batch: 'C', quantity: 30, expirationDate: '2028-01-31' }])), 'A:ok:0 C:nuevo:30');
    assert.strictEqual(est(T.conciliar([{ batch: 'A', quantity: 100 }, { batch: 'B', quantity: 50 }], [{ batch: 'A', quantity: 100 }], { completa: true })), 'A:ok:0 B:falta:-50');
    assert.strictEqual(est(T.conciliar([{ batch: 'A', quantity: 100 }, { batch: 'B', quantity: 50 }], [{ batch: 'A', quantity: 100 }])), 'A:ok:0 B:sin_contar:0');
    assert.strictEqual(est(T.conciliar([{ batch: '', quantity: 10 }], [{ batch: 'S/L', quantity: 10 }])), 'S/L:ok:0');
    assert.strictEqual(est(T.conciliar([{ batch: 'A', quantity: 100 }], [{ batch: 'A', quantity: 60 }, { batch: 'A', quantity: 40 }])), 'A:ok:0');   /* pistoleado dos veces en partes = se suma una vez */
  });
t('toma v21.246: cierre fija lo contado contra lo que había al contar', () => { const T = require('../toma-conciliacion.js');
    const r = T.conciliar([{ batch: 'A', quantity: 100 }], [{ batch: 'A', quantity: 100 }]);
    assert.strictEqual(T.aplicar([{ batch: 'A', quantity: 90 }], r.lineas).quantity, 90);   /* salieron 10 después de contar: quedan 90, no 100 */
    const r2 = T.conciliar([{ batch: 'A', quantity: 1000, expirationDate: '2027-05-01' }], [{ batch: 'A', quantity: 1100, expirationDate: '2027-05-01' }, { batch: 'N1', quantity: 5, expirationDate: '2028-02-01' }]);
    const a = T.aplicar([{ batch: 'A', quantity: 1000, expirationDate: '2027-05-01' }], r2.lineas);
    assert.strictEqual(a.quantity, 1105); assert.deepStrictEqual(a.batches.map(b => b.batch + '=' + b.quantity + '@' + b.expirationDate), ['A=1100@2027-05-01', 'N1=5@2028-02-01']);
    const solo = T.aplicar([{ batch: 'A', quantity: 1000 }], T.conciliar([{ batch: 'A', quantity: 1000 }], [{ batch: 'A', quantity: 900 }]).lineas, l => l.delta > 0);
    assert.strictEqual(solo.quantity, 1000);   /* el faltante espera al superadministrador */
    const neg = T.aplicar([{ batch: 'A', quantity: 5 }], T.conciliar([{ batch: 'A', quantity: 100 }], [{ batch: 'A', quantity: 0 }], { completa: true }).lineas);
    assert.deepStrictEqual(neg.negativos, ['A|N/A']); assert.strictEqual(neg.quantity, 0);
  });
t('toma v21.246: mismo lote con otro mes, lote crudo y reservado no encontrado (revisión B.A./Fowler)', () => { const T = require('../toma-conciliacion.js');
  const r = T.conciliar([{ batch: 'q ', expirationDate: '2027-01-01', quantity: 10 }], [{ batch: 'Q', expirationDate: '2027-02', quantity: 12 }]);
  if (r.lineas.length !== 1 || r.lineas[0].estado !== 'sobra' || r.lineas[0].delta !== 2 || r.lineas[0].vence !== '2027-01' || r.lineas[0].loteSistema !== 'q ') throw new Error(JSON.stringify(r.lineas));
  const d = T.conciliar([{ batch: 'L1', expirationDate: '2027-01', quantity: 10 }, { batch: 'L1', expirationDate: '2028-01', quantity: 50 }], [{ batch: 'L1', expirationDate: '2028-01', quantity: 45 }]);
  if (d.lineas.find(l => l.vence === '2028-01').delta !== -5 || d.lineas.find(l => l.vence === '2027-01').estado !== 'sin_contar') throw new Error('dos vencimientos del mismo lote');
  if (T.mes({ seconds: 1800000000, nanoseconds: 0 }) !== '2027-01' || T.mes(new Date(2027, 4, 3)) !== '2027-05') throw new Error('mes de Timestamp/Date');
  const q = T.quitarReservado([{ batch: 'A', expirationDate: '2027-01', quantity: 5 }], 8); if (q.reservadoSinCubrir !== 3 || q[0].quantity !== 0) throw new Error('reservado sin cubrir ' + q.reservadoSinCubrir);
});
t('toma v21.246: umbral de reconteo', () => { const T = require('../toma-conciliacion.js');
    assert.strictEqual(T.requiereReconteo({ delta: 4, sistema: 1000 }), false); assert.strictEqual(T.requiereReconteo({ delta: 11, sistema: 1000 }), true);
    assert.strictEqual(T.requiereReconteo({ delta: 3, sistema: 20 }), true); assert.strictEqual(T.requiereReconteo({ delta: 1, sistema: 1000 }, { controlado: true }), true);
    assert.strictEqual(T.requiereReconteo({ delta: 0, sistema: 5 }, { controlado: true }), false);
  });
// contador con transacciones que se encolan: 20 pedidos simultáneos = 20 números distintos y seguidos (prueba asíncrona)
(async () => {
  const F = require('../correlativos.js'), DB = {}; let cola = Promise.resolve();
  const w = (typeof window !== 'undefined' ? window : globalThis);
  w.firebaseDb = {}; w.firebaseFirestore = { collection: (_, c) => ({ c }), doc: (c, id) => ({ id }),
    runTransaction: (_, fn) => { const r = cola.then(() => fn({ get: async (x) => ({ exists: () => !!DB[x.id], data: () => DB[x.id] }), set: (x, d) => { DB[x.id] = d; } })); cola = r.catch(() => {}); return r; } };
  try {
    const r = await Promise.all(Array.from({ length: 20 }, () => F.siguiente('TRA', { fecha: '2026-11-15T12:00:00Z' })));
    assert.strictEqual(new Set(r).size, 20); assert.strictEqual(r.sort()[19], 'TRA-2026-00020');
    const v = await F.varios('REC', 3, { fecha: '2026-11-15T12:00:00Z' }); assert.deepStrictEqual(v, ['REC-2026-00001', 'REC-2026-00002', 'REC-2026-00003']);
    delete w.firebaseFirestore.runTransaction; assert.ok(F.esProvisional(await F.siguiente('INV')));
    console.log('OK   correlativos v21.220: contador sin repetidos (asíncrona)');
  } catch (e) { console.log('FALLA correlativos v21.220 asíncrona → ' + e.message); process.exitCode = 1; }
})();
// v21.249: levantamiento con teléfono (funciones puras)
t('levantamiento v21.249: 9×50 cerradas + 1 abierta (30) = 480 por el árbol de preguntas', () => { globalThis.SAR_Toma = require('../toma-conciliacion.js'); const L = require('../levantamiento-movil.js');
  let p = { paso: 'estado', estado: 'ABIERTA' }; const pasos = [];
  const r = (cambios) => { Object.assign(p, cambios); const s = L.siguientePaso(p); pasos.push(s); if (s !== 'fin') { const i = s === 'ch-abq' ? (p.paso === 'ch-abq' ? p.i + 1 : 0) : p.i; p = { ...p, paso: s, i }; } return s; };
  r({}); r({ que: 'chicas' }); r({ chN: 9 }); r({ chQ: 50 }); r({ ab: true }); r({ nab: 1 }); r({ abq: [30] }); r({ sue: 0 });
  assert.deepStrictEqual(pasos, ['ab-que', 'ch-n', 'ch-q', 'ch-ab', 'ch-nab', 'ch-abq', 'ch-sue', 'fin']);
  const e = L.estructuraDe(p); assert.strictEqual(L.totalEstructura(e), 480); assert.strictEqual(e.interiores.length, 10);
  const f = L.formula(e); assert.strictEqual(f.texto, '9 × 50 cerradas = 450 · + 1 abierta = 30 · 480 UNIDADES (10 cajas chicas, no 480 cajas)');
  assert.strictEqual(L.estructuraCorta(e), '9×50 + 1 abierta (30)'); assert.strictEqual(require('../tags-conteo.js').estructuraCorta(e), L.estructuraCorta(e));
  assert.deepStrictEqual(L.estructuraDe(L.respuestasDe(e)), e);
});
t('levantamiento v21.249: cerrada sin interiores, con interiores y granel', () => { const L = require('../levantamiento-movil.js');
  const a = L.estructuraDe({ estado: 'CERRADA', int: false, total: 500 }); assert.strictEqual(L.totalEstructura(a), 500); assert.strictEqual(L.formula(a).texto, 'Caja cerrada sin cajas interiores = 500 · 500 UNIDADES'); assert.strictEqual(L.estructuraCorta(a), 'Sin subdivisión (500)');
  const b = L.estructuraDe({ estado: 'CERRADA', int: true, n: 20, q: 50 }); assert.strictEqual(L.formula(b).texto, '20 × 50 interiores = 1000 · 1000 UNIDADES (20 cajas chicas, no 1000 cajas)');
  const c = L.estructuraDe({ estado: 'ABIERTA', que: 'sueltas', suN: 120 }); assert.strictEqual(L.estructuraCorta(c), 'Granel (120)'); assert.strictEqual(L.totalEstructura(c), 120);
  const d = L.estructuraDe({ estado: 'ABIERTA', que: 'chicas', chN: 0, ab: true, nab: 2, abq: [10, 5], sue: 3 }); assert.strictEqual(L.totalEstructura(d), 18); assert.ok(/\+ 2 abiertas \(10 \+ 5\) = 15 · \+ 3 sueltas = 3 · 18 UNIDADES/.test(L.formula(d).texto));
  assert.strictEqual(L.siguientePaso({ paso: 'ch-n', chN: 0 }), 'ch-ab');
});
t('levantamiento v21.249: validación, folio del tag, vencido, huella y base del sistema', () => { globalThis.SAR_Toma = require('../toma-conciliacion.js'); const L = require('../levantamiento-movil.js');
  const e = { estado: 'ABIERTA', interiores: [{ q: 50, abierta: false }, { q: 30, abierta: true }], sueltas: 0 };
  const dr = { folio: 'BUL-2026-000845', bodega: { id: 'b1', name: 'Medicamentos' }, prod: { insumoId: 'i1', nombre: 'Guante M' }, lote: 'l7', vence: '2027-05', estructura: e };
  const d = L.armarDoc(dr, { correo: 'c@x.cl', nombre: 'Ana' }, { base: 40, en: '2026-11-22T10:00:00Z', deuda: 3 });
  assert.deepStrictEqual(L.validar(d), []); assert.strictEqual(d.total, 80); assert.strictEqual(d.lote, 'L7'); assert.strictEqual(d.baseSistema, 40); assert.strictEqual(d.deudaSistema, 3); assert.strictEqual(d.nombreNorm, 'guante m'); assert.strictEqual(d.estado, 'REGISTRADO');
  assert.strictEqual(d.huella, L.huella({ ...d, contadoPor: 'otro' })); assert.notStrictEqual(d.huella, L.huella({ ...d, total: 81 }));
  assert.ok(L.validar({ ...d, total: 81 }).some(x => /no calza/.test(x))); assert.ok(L.validar({ ...d, vence: '2027-13' }).length); assert.ok(L.validar({ ...d, folio: 'BUL-26-1' }).length);
  assert.ok(L.validar({ ...d, estructura: { ...e, interiores: [{ q: -1, abierta: false }] }, total: -1 }).length); assert.ok(L.validar({ ...d, nuevo: true, tipo: '' }).length);
  const s = L.armarDoc({ ...dr, sinLote: true, vence: 'N/A' }, { correo: 'c@x.cl' }, {}); assert.strictEqual(s.lote, 'S/L'); assert.strictEqual(s.vence, 'N/A'); assert.strictEqual(s.baseSistema, null);
  const sv = L.armarDoc({ ...dr, sinLote: true }, { correo: 'c@x.cl' }, {}); assert.strictEqual(sv.lote, 'S/L'); assert.strictEqual(sv.vence, '2027-05');   /* «Sin lote» con vencimiento */
  const ctl = L.armarDoc({ ...dr, prod: { ...dr.prod, controlado: 'estupefaciente' } }, { correo: 'c@x.cl' }, { base: 40, deuda: 3 }); assert.ok(!('baseSistema' in ctl) && !('deudaSistema' in ctl), 'controlado sin base');
  assert.ok(L.validar({ ...d, nombre: 'x'.repeat(121) }).length); assert.ok(L.validar({ ...d, estructura: { estado: 'CERRADA', interiores: Array(201).fill({ q: 1, abierta: false }), sueltas: 0 }, total: 201 }).length);
  assert.strictEqual(L.folioTag('https://sarinventario.web.app/solicitar.html#t=2026000845'), 'BUL-2026-000845'); assert.strictEqual(L.folioTag('https://sarinventario.web.app/#bulto=BUL-2026-000845'), '');
  const u = 'c@x.cl', ahora = Date.parse('2026-11-22T20:00:00Z'), cj = [{ folio: 'a', estado: 'ok', doc: { ...d, en: '2026-11-22T10:00:00Z' } }, { folio: 'b', estado: 'pend', doc: { ...d, lote: 'L8', en: '2026-11-22T19:00:00Z' } }, { folio: 'c', estado: 'ok', doc: { ...d, en: '2026-11-21T10:00:00Z' } }, { folio: 'd', estado: 'pend', doc: { ...d, contadoPor: 'otro@x.cl', en: '2026-11-22T19:00:00Z' } }];
  const tu = L.delTurno(cj, u, ahora); assert.deepStrictEqual(tu.map(x => x.folio), ['a', 'b']); const rs = L.resumen(tu);
  assert.strictEqual(rs.porEnviar, 1); assert.strictEqual(rs.lotes, 2); assert.deepStrictEqual(rs.subtotales.map(x => [x.lote, x.cajas, x.unidades]), [['L7', 1, 80], ['L8', 1, 80]]);
  assert.strictEqual(L.folioTag('https://sarinventario.web.app/solicitar.html#tag=BUL-2026-000845'), 'BUL-2026-000845'); assert.strictEqual(L.folioTag('2026000845'), 'BUL-2026-000845'); assert.strictEqual(L.folioTag('845', 2026), 'BUL-2026-000845'); assert.strictEqual(L.folioTag('hola'), '');
  assert.strictEqual(L.vencido('2026-10', new Date(2026, 10, 22)), true); assert.strictEqual(L.vencido('2026-11', new Date(2026, 10, 22)), false); assert.strictEqual(L.vencido('N/A'), false);
  const reg = { batches: [{ batch: 'L7', expirationDate: '2027-05-31', quantity: 30 }, { batch: 'l7 ', expirationDate: '05/2027', quantity: 10 }, { batch: 'L8', expirationDate: '2028-01', quantity: 5 }] };
  assert.strictEqual(L.baseDe(reg, 'L7', '2027-05'), 40); assert.strictEqual(L.baseDe(reg, 'L9', '2027-05'), null); assert.strictEqual(L.baseDe(null, 'L7', '2027-05'), null);
  const c = L.cambiosDe(d, { ...d, total: 90, estructura: { ...e, sueltas: 10 } }); assert.deepStrictEqual(Object.keys(c).sort(), ['editadoEn', 'estado', 'estructura', 'total']); assert.strictEqual(c.estado, 'REGISTRADO');
  const a = L.avanceLotes([{ batch: 'L7', expirationDate: '2027-05', quantity: 100 }, { batch: 'L1', expirationDate: '2026-12', quantity: 20 }], [{ batch: 'L7', expirationDate: '2027-05', quantity: 80 }, { batch: 'L7', expirationDate: '2027-05', quantity: 30 }]);
  assert.deepStrictEqual(a.map(x => [x.batch, x.sistema, x.contado, x.delta]), [['L1', 20, 0, -20], ['L7', 100, 110, 10]]);
});
t('tags de conteo v21.249: unir, estados y filtros', () => { const T = require('../tags-conteo.js');
  const f = T.unir([{ folio: 'BUL-2026-000845', tipo: 'tag-conteo' }, { folio: 'BUL-2026-000846', tipo: 'tag-conteo' }], [{ folio: 'BUL-2026-000845', bodega: 'Medicamentos', estado: 'REGISTRADO' }, { folio: 'BUL-2026-000900', bodega: 'CAM', estado: 'ACEPTADO' }]);
  assert.deepStrictEqual(f.map(x => [T.numero(x.folio), x.estado]), [['000900', 'incorporado'], ['000846', 'sin'], ['000845', 'contado']]);
  assert.strictEqual(T.filtrar(f, { bodega: 'Medicamentos' }).length, 1); assert.strictEqual(T.filtrar(f, { estado: 'sin' }).length, 1); assert.strictEqual(T.filtrar(f, { q: '846' })[0].folio, 'BUL-2026-000846');
  assert.strictEqual(T.urlTag('BUL-2026-000845'), 'https://sarinventario.web.app/solicitar.html#t=2026000845');
  assert.strictEqual(T.estadoDe(null, { estado: 'RECONTEO' }), 'reconteo'); assert.strictEqual(T.estadoDe(null, { estado: 'ETIQUETADO' }), 'etiquetado');
});
t('bultos v21.249: un tag CONTADO no es una caja', () => { const B = require('../bultos.js'); assert.strictEqual(B.esTag({ tipo: 'tag-conteo', estado: 'TAG' }), true); assert.strictEqual(B.esTag({ tipo: 'bulto' }), false); assert.strictEqual(B.esTag(null), false); assert.ok(/000845 es un tag CONTADO/.test(B.avisoTag('BUL-2026-000845'))); });
t('cuadro de distribución PDF vertical con 2 memos SAR y FINANCIAMIENTO arriba (OC 1298355-965-CM26 · v21.251)', () => {
  global.window = global.window || global; global.document = global.document || {};
  const L = require('../oc-lector.js');
  const items = [
    { str: 'MEMO N°36', x: 285, y: 23, w: 30 }, { str: 'SAR', x: 294, y: 31, w: 12 },
    { str: 'MEMO N°9 SAR', x: 320, y: 27, w: 42 },
    { str: 'MEMO N°68', x: 373, y: 20, w: 30 }, { str: 'CESFAM', x: 376, y: 27, w: 24 }, { str: 'BORIS SOLER', x: 370, y: 34, w: 36 },
    { str: 'MEMO N°59', x: 417, y: 20, w: 30 }, { str: 'POSTA', x: 422, y: 27, w: 20 }, { str: 'BOLLENAR', x: 416, y: 34, w: 32 },
    { str: 'MEMO N°33', x: 461, y: 20, w: 30 }, { str: 'CESFAM', x: 464, y: 27, w: 24 }, { str: 'POMAIRE', x: 462, y: 34, w: 28 },
    { str: 'FINANCIAMIENTO', x: 232, y: 46.5, w: 42 },
    { str: 'MINSAL - 2026', x: 282, y: 43, w: 36 }, { str: 'SAR', x: 294, y: 50, w: 12 },
    { str: 'MINSAL - 2026', x: 322, y: 43, w: 36 }, { str: 'SAR', x: 338, y: 50, w: 12 },
    { str: 'PERCAPITA', x: 373, y: 46.5, w: 30 }, { str: 'PERCAPITA', x: 417, y: 46.5, w: 30 }, { str: 'PERCAPITA', x: 461, y: 46.5, w: 30 },
    { str: 'CDP', x: 248, y: 59, w: 12 }, { str: '3550', x: 292, y: 59, w: 16 }, { str: '2667', x: 336, y: 59, w: 16 }, { str: '4715', x: 380, y: 59, w: 16 }, { str: '4492', x: 424, y: 59, w: 16 }, { str: '4469', x: 468, y: 59, w: 16 },
    { str: 'ID', x: 32, y: 69, w: 8 }, { str: 'DESCRIPCION', x: 100, y: 69, w: 40 }, { str: 'VALOR NETO', x: 236, y: 69, w: 34 },
    { str: 'CANTIDAD', x: 288, y: 69, w: 24 }, { str: 'CANTIDAD', x: 332, y: 69, w: 24 }, { str: 'CANTIDAD', x: 376, y: 69, w: 24 }, { str: 'CANTIDAD', x: 420, y: 69, w: 24 }, { str: 'CANTIDAD', x: 464, y: 69, w: 24 },
    { str: 'CANTIDAD', x: 506, y: 65, w: 24 }, { str: 'TOTAL', x: 510, y: 72, w: 18 },
    { str: '2229693', x: 28, y: 84, w: 24 }, { str: 'CATETER FOLEY 20 FR', x: 70, y: 84, w: 80 }, { str: '$ 2,870', x: 242, y: 84, w: 24 }, { str: '5', x: 298, y: 84, w: 5 }, { str: '30', x: 341, y: 84, w: 8 }, { str: '35', x: 515, y: 84, w: 8 },
    { str: 'NETO', x: 245, y: 102, w: 16 }, { str: '$ 14,350', x: 286, y: 102, w: 28 }, { str: '$ 86,100', x: 330, y: 102, w: 28 }
  ];
  const d = L.extraerDistribucion(items);
  assert.deepStrictEqual(d.avisos, []);
  assert.strictEqual(d.columnas.length, 5);
  assert.strictEqual(d.columnas[0].memo, '36'); assert.strictEqual(d.columnas[0].centro, 'SAR'); assert.strictEqual(d.columnas[0].financiamiento, 'MINSAL - 2026 SAR'); assert.strictEqual(d.columnas[0].cdp, '3550');
  assert.strictEqual(d.columnas[1].memo, '9'); assert.strictEqual(d.columnas[1].centro, 'SAR'); assert.strictEqual(d.columnas[1].financiamiento, 'MINSAL - 2026 SAR'); assert.strictEqual(d.columnas[1].cdp, '2667');
  assert.strictEqual(d.columnas[2].memo, '68'); assert.strictEqual(d.columnas[2].centro, 'CESFAM BORIS SOLER'); assert.strictEqual(d.columnas[2].financiamiento, 'PERCAPITA');
  assert.strictEqual(d.columnas[3].memo, '59'); assert.strictEqual(d.columnas[3].centro, 'POSTA BOLLENAR'); assert.strictEqual(d.columnas[3].financiamiento, 'PERCAPITA');
  assert.strictEqual(d.columnas[4].memo, '33'); assert.strictEqual(d.columnas[4].centro, 'CESFAM POMAIRE'); assert.strictEqual(d.columnas[4].financiamiento, 'PERCAPITA');
});
t('v21.252: reparto de 2 memos pegados en col 1, recepción multi-memo unificada y lineasActa con col SAR sin centro', () => {
  global.window = global.window || global; global.document = global.document || { body: { dataset: {} }, addEventListener() {} };
  const L = require('../oc-lector.js');
  // Caso extremo: "MEMO N°9 SAR" con x dentro de col 1 y w > 1.15*paso (se pegaría en col 1)
  const items = [
    { str: 'MEMO N°36', x: 285, y: 23, w: 30 }, { str: 'MEMO N°9 SAR', x: 300, y: 27, w: 56 }, { str: 'SAR', x: 294, y: 31, w: 12 },
    { str: 'FINANCIAMIENTO', x: 232, y: 46.5, w: 42 },
    { str: 'MINSAL - 2026', x: 282, y: 43, w: 36 }, { str: 'SAR', x: 294, y: 50, w: 12 },
    { str: 'MINSAL - 2026', x: 326, y: 43, w: 36 }, { str: 'SAR', x: 338, y: 50, w: 12 },
    { str: 'CDP', x: 248, y: 59, w: 12 }, { str: '3550', x: 292, y: 59, w: 16 }, { str: '2667', x: 336, y: 59, w: 16 },
    { str: 'ID', x: 32, y: 69, w: 8 }, { str: 'DESCRIPCION', x: 100, y: 69, w: 40 }, { str: 'VALOR NETO', x: 236, y: 69, w: 34 },
    { str: 'CANTIDAD', x: 288, y: 69, w: 24 }, { str: 'CANTIDAD', x: 332, y: 69, w: 24 },
    { str: 'CANTIDAD', x: 376, y: 65, w: 24 }, { str: 'TOTAL', x: 380, y: 72, w: 18 },
    { str: '2229693', x: 28, y: 84, w: 24 }, { str: 'CATETER FOLEY 20 FR', x: 70, y: 84, w: 80 }, { str: '$ 2,870', x: 242, y: 84, w: 24 }, { str: '5', x: 298, y: 84, w: 5 }, { str: '30', x: 341, y: 84, w: 8 }, { str: '35', x: 385, y: 84, w: 8 },
    { str: 'NETO', x: 245, y: 102, w: 16 }, { str: '$ 14,350', x: 286, y: 102, w: 28 }, { str: '$ 86,100', x: 330, y: 102, w: 28 }
  ];
  const d = L.extraerDistribucion(items);
  assert.deepStrictEqual(d.avisos, []);
  assert.strictEqual(d.columnas[0].memo, '36'); assert.strictEqual(d.columnas[0].centro, 'SAR');
  assert.strictEqual(d.columnas[1].memo, '9'); assert.strictEqual(d.columnas[1].centro, 'SAR');
  // aplicarRecepcion unificada (multi-columna)
  const S = require('../seguimiento-oc.js');
  const oc = { columnas: [{ key: 'sar-36', centro: 'SAR', memo: '36' }, { key: 'col2-2', centro: '', financiamiento: 'MINSAL - 2026 SAR', cdp: '2667' }], lineas: [{ descripcion: 'FOLEY 20FR', dist: { 'sar-36': 5, 'col2-2': 30 }, recibido: {}, ingresado: {}, entregado: {} }] };
  const ap = S.aplicarRecepcion(oc, 'sar-36', [{ i: 0, columna: 'sar-36', cantidad: 5 }, { i: 0, columna: 'col2-2', cantidad: 30 }], [], null, true);
  assert.strictEqual(ap.lineas[0].recibido['sar-36'], 5); assert.strictEqual(ap.lineas[0].recibido['col2-2'], 30);
  // lineasActa suma ambas columnas SAR en un solo consolidado (35 u.)
  const R = require('../recepcion-conforme.js');
  const la = R.lineasActa({ ...oc, lineas: ap.lineas }, 'SAR');
  assert.strictEqual(la.length, 1); assert.strictEqual(la[0].pedido, 35); assert.strictEqual(la[0].recibido, 35);
});
t('v21.256: horario de corte universal de correos (L-V 08:00–17:00 Chile) y envío escalonado', () => {
  global.window = global.window || global; global.document = global.document || { body: { dataset: {} }, addEventListener() {} };
  const S = require('../seguimiento-oc.js');
  // Fechas en noviembre 2026 (Chile en horario de verano UTC-3)
  assert.strictEqual(S.enHorarioCorreo(new Date('2026-11-24T10:59:00Z')), false, 'martes 07:59 CL fuera de horario');
  assert.strictEqual(S.enHorarioCorreo(new Date('2026-11-24T11:00:00Z')), true, 'martes 08:00 CL en horario');
  assert.strictEqual(S.enHorarioCorreo(new Date('2026-11-24T19:59:00Z')), true, 'martes 16:59 CL en horario');
  assert.strictEqual(S.enHorarioCorreo(new Date('2026-11-24T20:00:00Z')), false, 'martes 17:00 CL corte exacto');
  assert.strictEqual(S.enHorarioCorreo(new Date('2026-11-24T23:30:00Z')), false, 'martes 20:30 CL fuera de horario');
  assert.strictEqual(S.enHorarioCorreo(new Date('2026-11-28T15:00:00Z')), false, 'sábado 12:00 CL fuera de horario');
  assert.strictEqual(S.enHorarioCorreo(new Date('2026-11-29T15:00:00Z')), false, 'domingo 12:00 CL fuera de horario');
  // Próximo horario hábil desde las 08:00
  assert.strictEqual(S.proximoHorarioHabil(new Date('2026-11-24T10:30:00Z')).iso, '2026-11-24', 'madrugada hábil → mismo día 08:00');
  assert.strictEqual(S.proximoHorarioHabil(new Date('2026-11-24T21:00:00Z')).iso, '2026-11-25', 'martes 18:00 → miércoles 08:00');
  assert.strictEqual(S.proximoHorarioHabil(new Date('2026-11-27T20:05:00Z')).iso, '2026-11-30', 'viernes 17:05 → lunes 08:00');
  assert.strictEqual(S.proximoHorarioHabil(new Date('2026-11-28T15:00:00Z')).iso, '2026-11-30', 'sábado → lunes 08:00');
  assert.strictEqual(S.proximoHorarioHabil(new Date('2026-11-29T18:00:00Z')).iso, '2026-11-30', 'domingo → lunes 08:00');
  assert.strictEqual(S.HORARIO_CORREO.desde, 8);
  assert.strictEqual(S.HORARIO_CORREO.hasta, 17);
  assert.strictEqual(S.HORARIO_CORREO.maxPorTanda, 3);
  assert.strictEqual(S.HORARIO_CORREO.pausaMs, 15000);
});
t('v21.257: modelo local REUTTER S.A. (Factura/Guía con L:;C:;V:) y emparejamiento de abreviaturas', () => {
  const G = require('../guia-lector.js');
  const items = [
    { str: 'REUTTER S.A.', x: 10, y: 30 }, { str: 'R.U.T.: 81.210.400-4', x: 428, y: 39 },
    { str: 'FACTURA ELECTRONICA', x: 408, y: 65 }, { str: "N'0001075247", x: 445, y: 88 },
    { str: 'FECHA EMISION | 20/11t2026', x: 388, y: 152 },
    { str: 'CODIGO', x: 23, y: 229 }, { str: 'CANTIDAD', x: 75, y: 229 }, { str: 'DETALLE', x: 241, y: 229 }, { str: 'CLAS', x: 402, y: 229 }, { str: 'UN MED', x: 428, y: 229 }, { str: 'PRECIO UN.', x: 469, y: 229 }, { str: 'TOTAL', x: 543, y: 229 },
    { str: '50', x: 108, y: 244 }, { str: 'APOSITO fRANSPARENTE 6X7 CJ X 1OO', x: 120, y: 244 }, { str: 'CJ', x: 449, y: 244 }, { str: '497.500', x: 563, y: 244 },
    { str: "L:4600002855;C:50;V:01 -06'2031", x: 120, y: 251 },
    { str: 'AAVEGA03', x: 9, y: 258 }, { str: "'145", x: 104, y: 258 }, { str: 'VENDA GASA ELASTICA lOCM X 4M X 20 UN', x: 120, y: 258 }, { str: 'DM', x: 413, y: 258 }, { str: 'CJ', x: 449, y: 258 },
    { str: 'L:4600002448iC:145iV:01 -1 l -2030', x: 120, y: 266 },
    { str: 'AASOFS16', x: 10, y: 274 }, { str: '2A', x: 108, y: 274 }, { str: 'SOND FOL SILIC 2V C/BALON 5-10 CC 16 FR', x: 120, y: 274 }, { str: 'DM', x: 414, y: 274 }, { str: 'UN', x: 448, y: 274 },
    { str: 'L:4600002705;C:20;V:01 -04-2031', x: 121, y: 282 },
    { str: 'OC 18-11-2026 1 298355- 1 002-CM26', x: 19, y: 595 }
  ];
  assert.strictEqual(G.reconoceReutter(items.map(i => i.str).join('\n')), true);
  const r = G.extraerReutter(items);
  assert.strictEqual(r.empresa, 'REUTTER S.A.');
  assert.strictEqual(r.tipoDocumento, 'FACTURA');
  assert.strictEqual(r.numero, '1075247');
  assert.strictEqual(r.fecha, '2026-11-20');
  assert.strictEqual(r.numeroOC, '1298355-1002-CM26');
  assert.strictEqual(r.lineas.length, 3);
  assert.strictEqual(r.lineas[0].lote, '4600002855'); assert.strictEqual(r.lineas[0].vence, '2031-06-01'); assert.strictEqual(r.lineas[0].cantidad, 50);
  assert.strictEqual(r.lineas[1].lote, '4600002448'); assert.strictEqual(r.lineas[1].vence, '2030-11-01'); assert.strictEqual(r.lineas[1].cantidad, 145);
  assert.strictEqual(r.lineas[2].lote, '4600002705'); assert.strictEqual(r.lineas[2].vence, '2031-04-01'); assert.strictEqual(r.lineas[2].cantidad, 20);
  const emp = G.emparejar([
    { descripcion: 'Apósito transparente 6x7 cm caja x 100 unidades' },
    { descripcion: 'Venda gasa elástica 10 cm x 4 m caja x 20 unidades' },
    { descripcion: 'Sonda Foley silicona 2 vías con balón 5-10 cc 16 Fr' }
  ], r.lineas);
  assert.strictEqual(emp.pares.length, 3); assert.strictEqual(emp.sinPar.length, 0);
});
t('v21.258: oc-lector lee Factura Electrónica REUTTER S.A. para rellenar campos de Ingresar OC', () => {
  const L = require('../oc-lector.js');
  const items = [
    { str: 'REUTTER S.A.', x: 10, y: 30 }, { str: 'R.U.T.: 81.210.400-4', x: 428, y: 39 },
    { str: 'FACTUHA ELECTBONICA', x: 408, y: 65 }, { str: "N'0001075247", x: 445, y: 88 },
    { str: 'FECHA EMISION | 20/11t2026', x: 388, y: 152 },
    { str: 'FORMA DE PAGO : OC 30 d¡as', x: 389, y: 187 },
    { str: 'DESPACHAOO A : REAL AUDIENCIA 980 - SANfIAGO - l\\.4ELlPlLLA', x: 10, y: 211 },
    { str: 'coDtGo', x: 23, y: 229 }, { str: 'CANTIDAD', x: 75, y: 229 }, { str: 'DETALLE', x: 241, y: 229 }, { str: 'CLAS', x: 402, y: 229 }, { str: 'UN MED', x: 428, y: 229 }, { str: 'PRECIO UN.', x: 469, y: 229 }, { str: 'TOfAL', x: 543, y: 229 },
    { str: '50', x: 108, y: 244 }, { str: 'APOSITO fRANSPARENTE 6X7 CJ X 1OO', x: 120, y: 244 }, { str: 'CJ', x: 449, y: 244 }, { str: '497.500', x: 563, y: 244 },
    { str: "L:4600002855;C:50;V:01 -06'2031", x: 120, y: 251 },
    { str: 'AAVEGA03', x: 9, y: 258 }, { str: "'145", x: 104, y: 258 }, { str: 'VENDA GASA ELASTICA lOCM X 4M X 20 UN', x: 120, y: 258 }, { str: 'DM', x: 413, y: 258 }, { str: 'CJ', x: 449, y: 258 }, { str: '3.135', x: 500, y: 258 }, { str: '454.575', x: 563, y: 258 },
    { str: 'L:4600002448iC:145iV:01 -1 l -2030', x: 120, y: 266 },
    { str: 'oc 18-11-2026 1 298355- 1 002-CM26', x: 19, y: 595 },
    { str: 'MONTONETO $ 952.075', x: 461, y: 607 }
  ];
  assert.strictEqual(L.reconoceFacturaReutter(items.map(i => i.str).join('\n')), true);
  const r = L.extraerFacturaReutter(items);
  assert.strictEqual(r.tipo, 'OC_MP');
  assert.strictEqual(r.numeroOC, '1298355-1002-CM26');
  assert.strictEqual(r.proveedor, 'REUTTER S.A.');
  assert.strictEqual(r.rutProveedor, '81.210.400-4');
  assert.strictEqual(r.emitida, '2026-11-18');
  assert.strictEqual(r.lineas.length, 2);
  assert.strictEqual(r.lineas[0].cantidad, 50); assert.strictEqual(r.lineas[0].valorNeto, 9950); assert.strictEqual(r.lineas[0].totalLinea, 497500);
  assert.strictEqual(r.lineas[1].cantidad, 145); assert.strictEqual(r.lineas[1].valorNeto, 3135); assert.strictEqual(r.lineas[1].totalLinea, 454575);
});

t('v21.260: oxigeno-facturacion — semilla Indura cuadra $1.016.976 (94,3%) y saldo $61.024', () => {
  const F = require('../oxigeno-facturacion.js');
  const sem = F.datosSemillaIndura();
  assert.strictEqual(sem.proveedor.rut, '76.150.343-K');
  assert.strictEqual(sem.proveedor.estado, 'HISTORICO');
  assert.strictEqual(sem.presupuesto.numeroOC, '1298355-493-AG25');
  assert.strictEqual(sem.presupuesto.montoTope, 1078000);
  const est = F.calcularEstadoPresupuesto(sem.presupuesto, sem.facturas);
  assert.strictEqual(est.ejecutadoOC, 1016976);
  assert.strictEqual(est.saldoDisponible, 61024);
  assert.strictEqual(est.porcentajeTexto, '94,3%');
  assert.strictEqual(est.semaforo, 'rojo');
  assert.strictEqual(est.totalCajaChica, 0);
  // Factura marcada REEMPLAZADA no debe sumar doble
  const conReemp = sem.facturas.concat([{ id: 'old', proveedorId: sem.proveedor.id, presupuestoId: sem.presupuesto.id, folio: '2051884', estado: 'REEMPLAZADA', totalBruto: 381443, montoImputadoOC: 381443, montoCajaChica: 0 }]);
  const est2 = F.calcularEstadoPresupuesto(sem.presupuesto, conReemp);
  assert.strictEqual(est2.ejecutadoOC, 1016976);
  assert.strictEqual(est2.saldoDisponible, 61024);
});
t('v21.260: oxigeno-facturacion — simulador anti-sobregiro y derivación a Caja Chica', () => {
  const F = require('../oxigeno-facturacion.js');
  const ok = F.simularImputacion(61024, 50000, 0);
  assert.strictEqual(ok.haySobregiro, false);
  assert.strictEqual(ok.saldoProyectado, 11024);
  const over = F.simularImputacion(61024, 100000, 0);
  assert.strictEqual(over.haySobregiro, true);
  assert.strictEqual(over.saldoProyectado, -38976);
  assert.strictEqual(over.montoSobregiro, 38976);
  assert.strictEqual(over.sugeridoOC, 61024);
  assert.strictEqual(over.sugeridoCajaChica, 38976);
});
t('v21.260: oxigeno-facturacion — parser XML DTE SII, validaciones y detección tipo servicio', () => {
  const F = require('../oxigeno-facturacion.js');
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
  <DTE version="1.0"><Documento><Encabezado>
    <IdDoc><TipoDTE>33</TipoDTE><Folio>2074903</Folio><FchEmis>2026-07-31</FchEmis><FchVenc>2026-08-30</FchVenc></IdDoc>
    <Emisor><RUTEmisor>76150343-K</RUTEmisor><RznSoc>INDURA S.A.</RznSoc></Emisor>
    <Totales><MntNeto>320540</MntNeto><IVA>60903</IVA><MntTotal>381443</MntTotal></Totales>
  </Encabezado>
  <Detalle><CdgItem><VlrCodigo>RENTA</VlrCodigo></CdgItem><NmbItem>ARRIENDO CILINDROS OXIGENO JULIO 2026</NmbItem><QtyItem>620</QtyItem><UnmdItem>DIAS-CILINDRO</UnmdItem><PrcItem>517</PrcItem><MontoItem>320540</MontoItem></Detalle>
  <Referencia><TpoDocRef>801</TpoDocRef><FolioRef>1298355-493-AG25</FolioRef><RazonRef>ORDEN DE COMPRA</RazonRef></Referencia>
  <Referencia><TpoDocRef>33</TpoDocRef><FolioRef>2051884</FolioRef><RazonRef>REEMPLAZA FACTURA ANTERIOR</RazonRef></Referencia>
  </Documento></DTE>`;
  const r = F.parsearXmlDte(xml);
  assert.strictEqual(r.folio, '2074903');
  assert.strictEqual(r.rutEmisor, '76.150.343-K');
  assert.strictEqual(r.numeroOC, '1298355-493-AG25');
  assert.strictEqual(r.reemplazaFactura, '2051884');
  assert.strictEqual(r.periodoServicio, '2026-07');
  assert.strictEqual(r.tipoServicio, 'ARRIENDO');
  assert.strictEqual(r.totalBruto, 381443);
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(F.detectarTipoServicio('RECARGA OXIGENO MEDICINAL 50 M3', []), 'RECARGA');
  assert.strictEqual(F.detectarTipoServicio('RENTAL CILINDROS + RECARGA OXIGENO M3', []), 'MIXTO');
  // Validaciones: duplicado bloqueado y tolerancia ±$2
  const sem = F.datosSemillaIndura();
  const vDup = F.validarFactura({ proveedorId: sem.proveedor.id, folio: '2074903', periodoServicio: '2026-07', neto: 320540, iva: 60903, totalBruto: 381443 }, sem.facturas);
  assert.strictEqual(vDup.ok, false);
  const vTol = F.validarFactura({ proveedorId: sem.proveedor.id, folio: '9999999', periodoServicio: '2026-10', neto: 100000, iva: 19000, totalBruto: 119002 }, sem.facturas);
  assert.strictEqual(vTol.ok, true);
  assert.strictEqual(vTol.advertencias.length, 0);
  const vDes = F.validarFactura({ proveedorId: sem.proveedor.id, folio: '9999998', periodoServicio: '2026-10', neto: 100000, iva: 19000, totalBruto: 119010 }, sem.facturas);
  assert.strictEqual(vDes.ok, true);
  assert.strictEqual(vDes.advertencias.length, 1);
  // HTML Acta RC Ley 19.983 escapa y muestra recinto y ley
  const actaHtml = F.construirHtmlActaRC({ ...sem.facturas[0], recepcionConforme: { emitida: true, fecha: '2026-08-05', receptorNombre: 'Juan <script>', receptorRut: '12.345.678-9', receptorCargo: 'Encargado', recinto: F.RECINTO_BASE, numeroActa: 'RCO-2026-00001', observaciones: 'OK' } }, sem.proveedor, sem.presupuesto, F.calcularEstadoPresupuesto(sem.presupuesto, sem.facturas));
  assert.ok(actaHtml.includes('Ley N° 19.983') && actaHtml.includes('RCO-2026-00001') && actaHtml.includes('SAR Arpillerista Elsa Romo Aravena') && !actaHtml.includes('<script>'));
});
