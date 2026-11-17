/* ==========================================================================
   CUADRE AUTOMÁTICO DE LO ADEUDADO AL INGRESAR (v21.228)
   Regla del usuario: si un producto quedó «adeudado» (sobregiro: se entregó con acta sin stock en el sistema,
   porque había unidades que aún no estaban ingresadas), al ingresar unidades se descuenta primero lo adeudado.
   Se usa dentro de la MISMA transacción del ingreso (recepción de OC, ingreso manual, ingreso rápido):
   ajusta cantidad, lotes (FEFO) y sobregiro, y deja un movimiento CUADRE_SOBREGIRO por cada acta cubierta.
   ========================================================================== */
(function (window) {
  'use strict';
  const num = (v) => Number(v) || 0;
  /**
   * o = { ref, antes (datos del producto antes del ingreso o null), quantity y batches ya con el ingreso sumado,
   *       documento (REC-…, ING-…, INV-…), bodega, nombre, usuario }
   * Devuelve null si no hay nada que cuadrar, o { quantity, batches, sobregiro, sobregiroDetalle, cuadrado, cubiertas }.
   */
  function aplicar(f, db, tx, o) {
    const A = window.SAR_ActasEntrega;
    if (!o || !o.antes || !(num(o.antes.sobregiro) > 0) || !A || typeof A.cuadrar !== 'function') return null;
    /* v21.230: se cuadra a lo más lo que INGRESA ahora (no el stock que ya había), para que anular la recepción lo deshaga exacto */
    const ingresa = Math.max(0, num(o.quantity) - num(o.antes.quantity));
    const c = A.cuadrar({ ...o.antes, quantity: num(o.quantity), batches: o.batches || [] }, ingresa);
    if (!c || !(c.cuadrado > 0)) return null;
    (c.cubiertas || []).forEach(cu => tx.set(f.doc(f.collection(db, 'Historial_Movimientos')), {
      insumoName: o.nombre || o.antes.name || '', item: o.nombre || o.antes.name || '', quantity: cu.qty, type: 'CUADRE_SOBREGIRO', delta: -num(cu.qty), user: o.usuario || '',
      date: f.serverTimestamp(), document: o.documento || '', batch: 'MULTI-LOTE', origin: o.bodega || o.antes.location || '', idInsumoOrigen: o.ref.id,
      observacion: `Cuadre automático al ingresar (${o.documento || 'ingreso'}): ${cu.qty} u. entregadas antes con el acta ${cu.acta} sin stock en el sistema se descuentan de lo ingresado.`,
      actaId: cu.acta, automatico: true }));
    return { quantity: c.quantity, batches: c.batches, sobregiro: c.sobregiro, sobregiroDetalle: c.sobregiroDetalle, cuadrado: c.cuadrado, cubiertas: c.cubiertas, usados: (c.usados || []).map(u => ({ batch: u.batch, expirationDate: u.expirationDate || '', used: num(u.used) })) };
  }
  window.SAR_CuadreIngreso = { aplicar };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SAR_CuadreIngreso;
})(typeof window !== 'undefined' ? window : globalThis);
