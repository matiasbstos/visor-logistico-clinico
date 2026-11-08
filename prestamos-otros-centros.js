/* Préstamos recibidos de otros centros (v21.82): lo que entró por «Préstamo / traspaso desde otro centro»
   queda PENDIENTE hasta devolverlo. Devolver descuenta el stock y lo audita. Datos: Contadores/prestamo-<id>. */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); };
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };
  const pendiente = (p) => Math.max(0, (Number(p.cantidad) || 0) - (Number(p.devuelto) || 0));
  let lista = [];

  /** Cálculo puro: cuánto se puede devolver y el nuevo estado. */
  function aplicarDevolucion(p, qty) {
    const q = Number(qty);
    if (!(q > 0)) return { error: 'Indica una cantidad mayor que 0.' };
    if (q > pendiente(p)) return { error: 'No puedes devolver más de lo pendiente (' + pendiente(p) + ').' };
    const devuelto = (Number(p.devuelto) || 0) + q;
    return { devuelto, estado: devuelto >= Number(p.cantidad) ? 'DEVUELTO' : 'PENDIENTE' };
  }
  /** Descuenta del lote del préstamo y, si no alcanza, de los demás lotes (el más próximo a vencer primero). */
  function descontarLotes(batches, lote, qty) {
    const b = (batches || []).map(x => Object.assign({}, x)); let resto = qty;
    const orden = b.map((x, i) => i).sort((i, j) => (b[i].batch === lote ? -1 : 0) - (b[j].batch === lote ? -1 : 0));
    for (const i of orden) { if (resto <= 0) break; const t = Math.min(resto, Number(b[i].quantity) || 0); b[i].quantity = (Number(b[i].quantity) || 0) - t; resto -= t; }
    return { batches: b.filter(x => (Number(x.quantity) || 0) > 0), faltante: resto };
  }

  async function devolver(p, qty) {
    const f = fs(), r = aplicarDevolucion(p, qty); if (r.error) { toast('Devolución', r.error, 'error'); return false; }
    const ref = f.doc(f.collection(db(), 'Contadores'), p.id), insRef = f.doc(f.collection(db(), 'Insumos'), p.insumoId), hist = f.doc(f.collection(db(), 'Historial_Movimientos'));
    try {
      await f.runTransaction(db(), async (tx) => {
        const s = await tx.get(insRef); if (!s.exists()) throw new Error('El producto ya no existe en inventario.');
        const d = s.data(), stock = Number(d.quantity) || 0; if (stock < Number(qty)) throw new Error('Stock insuficiente (' + stock + ') para devolver ' + qty + '.');
        const dl = descontarLotes(d.batches, p.batch, Number(qty));
        tx.update(insRef, { quantity: stock - Number(qty), batches: dl.batches, updatedAt: f.serverTimestamp() });
        tx.update(ref, { devuelto: r.devuelto, estado: r.estado, updatedAt: f.serverTimestamp() });
        tx.set(hist, { insumoName: p.insumoName, item: p.insumoName, quantity: Number(qty), type: 'DEVOLUCION_PRESTAMO', batch: p.batch || '', origenCentro: p.centro, destination: p.centro, user: usuario(), date: f.serverTimestamp(), document: 'S/N' });
      });
      toast('Devolución registrada', qty + ' un. de ' + p.insumoName + ' devueltas a ' + p.centro + '.', 'success'); return true;
    } catch (e) { console.error('[Préstamos]', e); toast('No se pudo devolver', e.message || 'Error (código PR-01).', 'error'); return false; }
  }

  function pintar() {
    const box = document.getElementById('prestamos-pendientes'); if (!box) return;
    if (!lista.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<h4 style="font-size:11px; font-weight:700; color:var(--text-muted); margin-bottom:12px;">PRÉSTAMOS DE OTROS CENTROS POR DEVOLVER (' + lista.length + ')</h4><div class="pm-lista">' +
      lista.map(p => '<div class="pm-fila" data-id="' + esc(p.id) + '"><div class="pm-dato"><b>' + esc(p.insumoName) + '</b><span>Prestó: ' + esc(p.centro) + (p.batch ? ' · Lote ' + esc(p.batch) : '') + '</span></div>' +
        '<div class="pm-num"><b>' + pendiente(p) + '</b><small>de ' + p.cantidad + ' por devolver</small></div>' +
        '<div class="pm-acc"><input type="number" min="1" max="' + pendiente(p) + '" value="' + pendiente(p) + '" aria-label="Cantidad a devolver"><button type="button" class="btn btn-outline" data-dev="1"><i class="ph-bold ph-arrow-u-up-left"></i> Devolver</button></div></div>').join('') + '</div>';
    box.querySelectorAll('[data-dev]').forEach(b => b.addEventListener('click', async () => {
      const fila = b.closest('.pm-fila'), p = lista.find(x => x.id === fila.dataset.id); if (!p) return;
      b.disabled = true; await devolver(p, fila.querySelector('input').value); b.disabled = false;
    }));
  }
  function escuchar() {
    const f = fs(); if (!f || !db() || !document.getElementById('prestamos-pendientes')) return false;
    try {
      f.onSnapshot(f.query(f.collection(db(), 'Contadores'), f.where('tipo', '==', 'prestamo-recibido')), (snap) => {
        lista = []; snap.forEach(d => { const x = Object.assign({ id: d.id }, d.data()); if (x.estado === 'PENDIENTE') lista.push(x); });
        lista.sort((a, b) => String(a.insumoName).localeCompare(String(b.insumoName), 'es')); pintar();
      }, (e) => console.warn('[Préstamos]', e && e.code));
      return true;
    } catch (e) { return false; }
  }
  function iniciar() { let n = 0; const t = setInterval(() => { n++; if (escuchar() || n > 40) clearInterval(t); }, 1500); }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('DOMContentLoaded', iniciar);
  const api = { pendientesLista: () => lista.slice(), aplicarDevolucion, descontarLotes, pendiente };
  if (typeof window !== 'undefined') window.SAR_Prestamos = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : {}, typeof document !== 'undefined' ? document : {});
