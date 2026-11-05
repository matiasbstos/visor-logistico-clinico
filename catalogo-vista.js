/* Catálogo de Insumos (v20.86): muestra los productos reales (Catalogo_Productos) con su foto y
   el stock en bodega. Clic en la foto = ampliar. Sustituye la grilla de ejemplo. */
(function (window, document) {
    'use strict';
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    let datos = null, cargando = null;
    async function cargar() {
        if (cargando) return cargando;
        cargando = (async () => {
            const prods = [], stock = new Map();
            try { const sn = await fs().getDocs(fs().query(fs().collection(db(), 'Catalogo_Productos'), fs().limit(3000))); sn.forEach(d => prods.push({ id: d.id, ...d.data() })); } catch (e) { /* sin catálogo */ }
            try { const sn = await fs().getDocs(fs().query(fs().collection(db(), 'Insumos'), fs().limit(5000))); sn.forEach(d => { const x = d.data(); if (!x.origenOC) return; const k = norm(x.name), b = x.location || 'Sin asignar'; const e = stock.get(k) || { total: 0, b: {} }; e.total += Number(x.quantity) || 0; e.b[b] = (e.b[b] || 0) + (Number(x.quantity) || 0); stock.set(k, e); }); } catch (e) { /* sin stock */ }
            datos = prods.map(p => ({ ...p, st: stock.get(norm(p.insumoName || p.descripcion)) || { total: 0, b: {} } })).sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion)));
            if (window.SAR_Imagenes) await window.SAR_Imagenes.cargar(true).catch(() => {});
        })().finally(() => { cargando = null; });
        return cargando;
    }
    function kpis() {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        const n = datos.length, con = datos.filter(p => p.st.total > 0).length;
        set('erp-cat-kpi-total', n); set('erp-cat-kpi-optimo', con); set('erp-cat-kpi-bajo', '—'); set('erp-cat-kpi-critico', n - con);
    }
    function pintar(grid) {
        const inp = document.getElementById('erp-catalog-search'), q = norm(inp ? inp.value : '');
        const st = (document.getElementById('erp-catalog-status-filter') || {}).value || 'ALL';
        const lista = datos.filter(p => (!q || norm(p.descripcion + ' ' + p.codigoMP + ' ' + (p.insumoName || '') + ' ' + (p.proveedor || '')).includes(q)) && (st === 'ALL' || (st === 'OPTIMO' ? p.st.total > 0 : st === 'CRITICO' ? p.st.total === 0 : false)));
        if (!lista.length) { grid.innerHTML = `<div class="erp-card" style="grid-column:1/-1;text-align:center;padding:32px;color:#64748B">${datos.length ? 'Ningún producto coincide con el filtro.' : 'Aún no hay productos. Ingresa una orden de compra o usa "Cargar productos y fotos" en Seguimiento de OC → Catálogo de productos.'}</div>`; return; }
        grid.innerHTML = lista.map(p => `<article class="erp-catalog-card cv-card"><div class="cv-foto">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(p.descripcion, { codigo: p.codigoMP, grande: true }) : ''}</div><div class="erp-catalog-card__body"><h4 class="cv-n">${esc(p.descripcion)}</h4><p class="cv-m">${p.codigoMP ? 'Cód. MP ' + esc(p.codigoMP) + ' · ' : ''}${esc(p.proveedor || '')}</p><div class="erp-catalog-card__stock-box"><strong>${p.st.total.toLocaleString('es-CL')}</strong> un. en stock<small>${Object.keys(p.st.b).map(b => esc(b) + ': ' + p.st.b[b]).join(' · ')}</small></div></div></article>`).join('');
        if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(grid);
    }
    async function render(grid) {
        if (!datos) { grid.innerHTML = '<div class="erp-card" style="grid-column:1/-1;text-align:center;padding:32px;color:#64748B">Cargando catálogo…</div>'; await cargar(); }
        kpis(); pintar(grid);
    }
    window.SAR_CatalogoVista = { render, recargar: () => { datos = null; } };
})(window, document);
