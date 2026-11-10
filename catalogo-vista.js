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
            try { const sn = await fs().getDocs(fs().query(fs().collection(db(), 'Insumos'), fs().limit(5000))); sn.forEach(d => { const x = d.data(); if (!x.origenOC) return; const k = norm(x.name), b = x.location || 'Sin asignar'; const e = stock.get(k) || { total: 0, b: {}, cat: '', lim: 0 }; e.total += Number(x.quantity) || 0; e.lim += Number(x.criticalLimit) || 0; if (!e.cat || e.cat === 'General') e.cat = String(x.category || x.categoria || '').trim() || e.cat; e.b[b] = (e.b[b] || 0) + (Number(x.quantity) || 0); stock.set(k, e); }); } catch (e) { /* sin stock */ }
            // por recibir: lo pedido y aún no recibido en órdenes abiertas (columna SAR)
            const porRecibir = new Map();
            try {
                const sn = await fs().getDocs(fs().query(fs().collection(db(), 'Seguimiento_OC'), fs().limit(300)));
                sn.forEach(d => { const o = d.data(); if (o.cerrada) return; const col = (o.columnas || []).find(c => /^sar/i.test(String(c.centro || '')) || c.key === 'sar') || (o.columnas || [])[0]; if (!col) return;
                    (o.lineas || []).forEach(l => { const p = (Number(l.dist && l.dist[col.key]) || 0) - (Number(l.recibido && l.recibido[col.key]) || 0); if (p <= 0) return;
                        const k = l.codigoMP ? 'c' + l.codigoMP : 'd' + norm(l.descripcion); const e = porRecibir.get(k) || { n: 0, ocs: [] }; e.n += p; if (!e.ocs.includes(o.numeroOC)) e.ocs.push(o.numeroOC); porRecibir.set(k, e); }); });
            } catch (e) { /* sin permiso */ }
            datos = prods.map(p => ({ ...p, st: stock.get(norm(p.insumoName || p.descripcion)) || { total: 0, b: {}, cat: '', lim: 0 }, rec: porRecibir.get(p.codigoMP ? 'c' + p.codigoMP : 'd' + norm(p.descripcion)) || null })).sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion)));
            if (window.SAR_Imagenes) await window.SAR_Imagenes.cargar(true).catch(() => {});
        })().finally(() => { cargando = null; });
        return cargando;
    }
    const nivel = (p) => p.st.total <= 0 ? 'CRITICO' : (p.st.lim > 0 && p.st.total <= p.st.lim ? 'BAJO' : 'OPTIMO');
    const catDe = (p) => (p.st.cat && p.st.cat !== 'General') ? p.st.cat : (p.st.cat === 'General' ? 'General' : 'Sin categoría');
    function kpis() {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        const c = { OPTIMO: 0, BAJO: 0, CRITICO: 0 }; datos.forEach(p => { c[nivel(p)]++; });
        set('erp-cat-kpi-total', datos.length); set('erp-cat-kpi-optimo', c.OPTIMO); set('erp-cat-kpi-bajo', c.BAJO); set('erp-cat-kpi-critico', c.CRITICO);
    }
    function llenarCategorias() {
        const sel = document.getElementById('erp-catalog-category-filter'); if (!sel) return;
        const cats = [...new Set(datos.map(catDe))].sort((a, b) => a.localeCompare(b, 'es')), ant = sel.value;
        sel.innerHTML = '<option value="ALL">Categoría: Todas</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        sel.value = cats.includes(ant) ? ant : 'ALL';
    }
    function pintar(grid) {
        const inp = document.getElementById('erp-catalog-search'), q = norm(inp ? inp.value : '');
        const st = (document.getElementById('erp-catalog-status-filter') || {}).value || 'ALL', cf = (document.getElementById('erp-catalog-category-filter') || {}).value || 'ALL';
        const lista = datos.filter(p => (!q || norm(p.descripcion + ' ' + p.codigoMP + ' ' + (p.insumoName || '') + ' ' + (p.proveedor || '')).includes(q)) && (st === 'ALL' || nivel(p) === st) && (cf === 'ALL' || catDe(p) === cf));
        if (!lista.length) { grid.innerHTML = `<div class="erp-card" style="grid-column:1/-1;text-align:center;padding:32px;color:#64748B">${datos.length ? 'Ningún producto coincide con el filtro.' : 'Aún no hay productos. Ingresa una orden de compra o usa "Cargar productos y fotos" en Seguimiento de OC → Catálogo de productos.'}</div>`; return; }
        grid.innerHTML = '<div class="cv-barra"><button type="button" class="btn btn-outline btn-sm" id="cv-sync"><i class="ph-bold ph-images"></i> Cargar productos y fotos de las órdenes ingresadas</button><small>Busca las fotos con el script y las deja por confirmar.</small></div>' + (() => { const g = new Map(); lista.forEach(p => { const c = catDe(p); (g.get(c) || g.set(c, []).get(c)).push(p); }); return [...g.keys()].sort((a, b) => a.localeCompare(b, 'es')).map(c => { const grupo = g.get(c); return `<h3 class="cv-cat" style="grid-column:1/-1;margin:14px 0 4px;font-size:15px;">${esc(c)} <small style="font-weight:400;color:#64748B;">· ${grupo.length} producto${grupo.length > 1 ? 's' : ''}</small></h3>` + grupo.map(p => `<article class="erp-catalog-card cv-card"><div class="cv-foto">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(p.descripcion, { codigo: p.codigoMP, grande: true, candidata: !!p.rec }) : ''}</div><div class="erp-catalog-card__body"><h4 class="cv-n">${esc(p.descripcion)}</h4><p class="cv-m">${p.codigoMP ? 'Cód. MP ' + esc(p.codigoMP) + ' · ' : ''}${esc(p.proveedor || '')}</p>${p.rec ? `<div class="cv-pend">Pendiente de recepción: ${p.rec.n} un. (OC ${esc(p.rec.ocs.join(', '))})${p.st.total === 0 ? ' · aún no está en stock' : ''}</div>` : ''}<div class="erp-catalog-card__stock-box"><strong>${p.st.total.toLocaleString('es-CL')}</strong> un. en stock<small>${Object.keys(p.st.b).map(b => esc(b) + ': ' + p.st.b[b]).join(' · ')}</small></div></div></article>`).join('');  }).join(''); })();
        if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(grid);
        const bs = grid.querySelector('#cv-sync'); if (bs) bs.addEventListener('click', () => { if (window.SAR_SeguimientoOC) window.SAR_SeguimientoOC.formCatalogo().then(() => { datos = null; }).catch(() => {}); });
    }
    async function render(grid) {
        if (!datos || !datos.length) { grid.innerHTML = '<div class="erp-card" style="grid-column:1/-1">' + (window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando el catálogo…') : 'Cargando catálogo…') + '</div>'; await cargar(); }
        kpis(); llenarCategorias(); pintar(grid);
    }
    window.SAR_CatalogoVista = { render, recargar: () => { datos = null; } };
})(window, document);
