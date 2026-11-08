/* Explorador de bodega (v21.78): dentro del detalle de una bodega, ver qué hay por categoría,
   buscar, ver foto/stock/vencimiento y actuar (ajuste, transferencia) sin salir. */
(function () {
  'use strict';
  const esc = (s) => (window.escapeHTML ? window.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  let estado = { items: [], cat: 'all', q: '', bodega: null };

  function filtrar() {
    return estado.items.filter(i => (estado.cat === 'all' || (i.category || 'General') === estado.cat) &&
      (!estado.q || norm(i.name).includes(estado.q) || norm(i.codigoMP || i.code).includes(estado.q) || norm(i.batch).includes(estado.q)));
  }
  function vto(i) {
    const f = i.expirationDate; if (!f || f === 'N/A') return { t: 'Sin vencimiento', c: '' };
    const d = new Date(String(f).length === 7 ? f + '-28' : f); if (isNaN(d)) return { t: String(f), c: '' };
    const dias = Math.round((d - Date.now()) / 864e5);
    const t = d.toLocaleDateString('es-CL', { month: '2-digit', year: 'numeric' });
    return dias < 0 ? { t: t + ' · vencido', c: 'bx-mal' } : dias <= 90 ? { t: t + ' · por vencer', c: 'bx-ojo' } : { t, c: '' };
  }
  function pintar(root) {
    const lista = filtrar();
    const cats = {}; estado.items.forEach(i => { const c = i.category || 'General'; cats[c] = (cats[c] || 0) + 1; });
    const unid = estado.items.reduce((a, i) => a + (Number(i.quantity) || 0), 0);
    const st = document.getElementById('modal-bodega-stock'); if (st) st.textContent = unid.toLocaleString('es-CL') + ' un. · ' + estado.items.length + ' productos';
    root.innerHTML =
      '<div class="bx-barra"><div class="bx-busca"><i class="ph ph-magnifying-glass"></i><input type="search" id="bx-q" placeholder="Buscar en esta bodega…" value="' + esc(estado.q) + '" aria-label="Buscar en esta bodega"></div>' +
      '<select id="bx-cat" aria-label="Categoría"><option value="all">Todas (' + estado.items.length + ')</option>' +
      Object.keys(cats).sort().map(c => '<option value="' + esc(c) + '"' + (c === estado.cat ? ' selected' : '') + '>' + esc(c) + ' (' + cats[c] + ')</option>').join('') + '</select></div>' +
      (lista.length ? '<div class="bx-lista">' + lista.map(i => {
        const v = vto(i), q = Number(i.quantity) || 0;
        return '<div class="bx-fila" data-id="' + esc(i.id) + '"><div class="bx-foto">' + (window.SAR_Imagenes ? window.SAR_Imagenes.thumb(i.name, { codigo: i.codigoMP || i.code }) : '') + '</div>' +
          '<div class="bx-dato"><b>' + esc(i.name) + '</b><span>' + esc(i.category || 'General') + (i.batch ? ' · Lote ' + esc(i.batch) : '') + (i.codigoMP ? ' · ' + esc(i.codigoMP) : '') + '</span><span class="' + v.c + '">Vence: ' + esc(v.t) + '</span></div>' +
          '<div class="bx-stock ' + (q <= 0 ? 'bx-mal' : '') + '">' + q.toLocaleString('es-CL') + '<small>un.</small></div>' +
          '<div class="bx-acc"><button type="button" class="btn btn-outline" data-bx="ajuste" title="Ajustar stock"><i class="ph ph-sliders"></i><span>Ajuste</span></button>' +
          '<button type="button" class="btn btn-outline" data-bx="mover" title="Transferir a otra bodega"><i class="ph ph-arrows-left-right"></i><span>Mover</span></button></div></div>';
      }).join('') + '</div>' : '<div class="bx-vacio">' + (estado.items.length ? 'Nada coincide con el filtro.' : 'Esta bodega aún no tiene productos registrados.') + '</div>');
    const q = root.querySelector('#bx-q'); if (q) q.addEventListener('input', () => { estado.q = norm(q.value); const pos = q.selectionStart; pintar(root); const n = root.querySelector('#bx-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } });
    const c = root.querySelector('#bx-cat'); if (c) c.addEventListener('change', () => { estado.cat = c.value; pintar(root); });
    root.querySelectorAll('[data-bx]').forEach(b => b.addEventListener('click', () => accion(b.dataset.bx, b.closest('.bx-fila').dataset.id)));
  }
  function accion(tipo, id) {
    const i = estado.items.find(x => x.id === id); if (!i) return;
    const modal = document.getElementById('bodega-modal');
    if (tipo === 'ajuste') {
      if (modal) modal.classList.remove('active');
      const m = document.querySelector('.menu-item[data-target="view-ajustes"]'); if (m) m.click();
      setTimeout(() => { const b = document.getElementById('buscador-ajuste'); if (b) { b.value = i.name; b.dispatchEvent(new Event('input', { bubbles: true })); } }, 400);
    } else {
      const bt = document.getElementById('btn-trigger-transfer'); if (!bt) return; bt.click();
      let n = 0; const t = setInterval(() => { const s = document.getElementById('transfer-insumo-id'); n++;
        if (s && s.querySelector('option[value="' + id + '"]')) { s.value = id; s.dispatchEvent(new Event('change', { bubbles: true })); clearInterval(t); } else if (n > 25) clearInterval(t); }, 200);
    }
  }
  async function render(bodega) {
    const root = document.getElementById('bodega-explorador'); if (!root) return;
    estado = { items: [], cat: 'all', q: '', bodega };
    root.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando productos de la bodega…') : 'Cargando…';
    try {
      let items = (window.insumosDataCache || []).filter(i => i.location === bodega.name);
      if (!items.length && window.firebaseFirestore && window.firebaseDb) {
        const f = window.firebaseFirestore, s = await f.getDocs(f.query(f.collection(window.firebaseDb, 'Insumos'), f.where('location', '==', bodega.name)));
        items = []; s.forEach(d => items.push(Object.assign({ id: d.id }, d.data())));
      }
      estado.items = items.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
      pintar(root);
    } catch (e) { root.innerHTML = '<div class="bx-vacio">No se pudieron cargar los productos (código BX-01).</div>'; console.error('[BodegaExplorador]', e); }
  }
  const api = { render, _filtrar: (items, cat, q) => { estado = { items, cat, q: norm(q) }; return filtrar(); } };
  if (typeof window !== 'undefined') window.SAR_BodegaExplorador = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
