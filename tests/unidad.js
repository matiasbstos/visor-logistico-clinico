/* Pruebas de unidad de la lógica pura (sin navegador ni Firebase). Uso: node tests/unidad.js */
const assert = require('assert'); globalThis.window = globalThis; globalThis.SAR_SeguimientoOC = {};
globalThis.document = { getElementById: () => null, addEventListener() {}, querySelector: () => null, readyState: 'complete', scripts: [], body: { dataset: {}, style: {} } };
let n = 0, mal = 0; const t = (nombre, f) => { try { f(); n++; console.log('OK   ' + nombre); } catch (e) { mal++; console.log('FALLA ' + nombre + ' → ' + e.message); } };
const B = require('../bitacora-oc.js'), M = require('../monitor-errores.js'), C = require('../tabla-columnas.js'), P = require('../primeros-pasos.js'), H = require('../correo-html.js');

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
console.log(`\n${n} ok, ${mal} con falla`); process.exit(mal ? 1 : 0);
