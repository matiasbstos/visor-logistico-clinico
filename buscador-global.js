/* Búsqueda global (v21.67): el buscador del menú también encuentra productos, órdenes de compra, actas y bodegas.
   Arma un índice en memoria la primera vez (10 min de vigencia) y respeta lo que cada rol puede ver en el menú. */
(function () {
    'use strict';
    const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
    /** Convierte lo leído de Firestore en filas buscables. Productos se agrupan por código o nombre (suma de lotes y ubicaciones). */
    function construirIndice(d) {
        const prods = new Map();
        (d.insumos || []).forEach(x => {
            const nombre = String(x.name || x.nombre || '').trim(); if (!nombre) return;
            const k = norm(x.codigoMP || nombre), p = prods.get(k) || { tipo: 'producto', titulo: nombre, codigo: x.codigoMP ? String(x.codigoMP) : '', total: 0, ubic: new Set() };
            p.total += num(x.quantity); if (x.location) p.ubic.add(String(x.location)); prods.set(k, p);
        });
        const filas = [];
        prods.forEach(p => filas.push({ tipo: 'producto', titulo: p.titulo, sub: `${p.codigo ? p.codigo + ' · ' : ''}${p.total} un. · ${p.ubic.size} ${p.ubic.size === 1 ? 'ubicación' : 'ubicaciones'}`, texto: norm(p.titulo + ' ' + p.codigo), accion: { nombre: p.titulo } }));
        (d.ocs || []).forEach(o => filas.push({ tipo: 'oc', titulo: 'OC ' + (o.numeroOC || o.id), sub: String(o.proveedor || '').trim() || 'Sin proveedor', texto: norm([o.numeroOC, o.proveedor, ...(o.lineas || []).map(l => l.descripcion)].join(' ')), accion: { id: o.id } }));
        (d.actas || []).forEach(a => filas.push({ tipo: 'acta', titulo: 'Acta ' + (a.numero || ''), sub: `${a.centro || ''}${a.estado ? ' · ' + String(a.estado).toLowerCase() : ''}`, texto: norm([a.numero, a.centro, ...(a.items || []).map(i => i.nombre), ...(a.documentos || []).map(x => x.numero)].join(' ')), accion: { numero: a.numero } }));
        (d.bodegas || []).forEach(b => { if (b.name) filas.push({ tipo: 'bodega', titulo: String(b.name), sub: 'Bodega', texto: norm(b.name), accion: { nombre: b.name } }); });
        return filas;
    }
    /** Todas las palabras deben aparecer; los que empiezan con la consulta van primero. Máx. `por` por tipo. */
    function buscar(indice, q, por) {
        const w = norm(q).split(' ').filter(Boolean); if (!w.length) return [];
        const out = {}, lim = por || 5;
        indice.forEach(f => { if (!w.every(x => f.texto.includes(x))) return; const r = f.texto.startsWith(w[0]) ? 0 : 1; (out[f.tipo] = out[f.tipo] || []).push({ f, r }); });
        const orden = ['producto', 'oc', 'acta', 'bodega'], res = [];
        orden.forEach(t => (out[t] || []).sort((a, b) => a.r - b.r).slice(0, lim).forEach(x => res.push(x.f)));
        return res;
    }
    if (typeof module !== 'undefined') module.exports = { norm, construirIndice, buscar };
    if (typeof document === 'undefined' || !document.createElement || !document.addEventListener) return;

    const META = { producto: ['ph-package', 'Productos', 'view-inventario'], oc: ['ph-clipboard-text', 'Órdenes de compra', 'view-seguimiento-oc'], acta: ['ph-file-text', 'Actas de entrega', 'view-actas-entrega'], bodega: ['ph-buildings', 'Bodegas', 'view-bodegas'] };
    const esc = s => (window.escapeHTML ? window.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    let indice = null, cuando = 0, cargando = null, panel = null, ultimo = [];
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const visible = t => { const m = document.querySelector(`.sidebar .menu-item[data-target="${t}"]`); return !!m && m.offsetParent !== null || (!!m && document.getElementById('app-sidebar') && m.getClientRects().length > 0); };

    async function cargar() {
        if (indice && Date.now() - cuando < 600000) return indice;
        if (cargando) return cargando;
        cargando = (async () => {
            const f = fs(); if (!f || !db()) return [];
            const leer = async (nombre, extra) => { try { const sn = await f.getDocs(extra ? f.query(f.collection(db(), nombre), ...extra) : f.collection(db(), nombre)); const r = []; sn.forEach(d => r.push({ id: d.id, ...d.data() })); return r; } catch (e) { return []; } };
            const [insumos, ocs, actas, bodegas] = await Promise.all([
                visible('view-inventario') ? leer('Insumos') : [], visible('view-seguimiento-oc') ? leer('Seguimiento_OC') : [],
                visible('view-actas-entrega') ? leer('Actas_Entrega', [f.orderBy('creadoEn', 'desc'), f.limit(300)]) : [], visible('view-bodegas') ? leer('Bodegas') : []]);
            indice = construirIndice({ insumos, ocs, actas, bodegas }); cuando = Date.now(); return indice;
        })().finally(() => { cargando = null; });
        return cargando;
    }
    function ir(fila) {
        const meta = META[fila.tipo], item = document.querySelector(`.sidebar .menu-item[data-target="${meta[2]}"]`); if (!item) return;
        item.click();
        const inp = document.getElementById('ml-buscar'); if (inp) { inp.value = ''; inp.dispatchEvent(new Event('input')); inp.blur(); }
        if (fila.tipo === 'producto') setTimeout(() => { const s = document.getElementById('inventory-search-input'); if (s) { s.value = fila.accion.nombre; s.dispatchEvent(new Event('input', { bubbles: true })); } }, 350);
        else if (fila.tipo === 'oc' && window.SAR_SeguimientoOC && window.SAR_SeguimientoOC.abrirCuando) window.SAR_SeguimientoOC.abrirCuando(fila.accion.id);
        else if (fila.tipo === 'acta' && window.SAR_ActasEntrega && window.SAR_ActasEntrega.ver) setTimeout(() => window.SAR_ActasEntrega.ver(fila.accion.numero), 1500);
    }
    function pintar(q, filas) {
        if (!panel) return; ultimo = filas;
        if (!q.trim()) { panel.hidden = true; panel.innerHTML = ''; return; }
        panel.hidden = false;
        if (!filas.length) { panel.innerHTML = '<p class="bg-vacio">Sin coincidencias en productos, órdenes, actas ni bodegas.</p>'; return; }
        let t = '', h = '';
        filas.forEach((f, i) => { if (f.tipo !== t) { t = f.tipo; h += `<h6 class="bg-h">${esc(META[t][1])}</h6>`; } h += `<button type="button" class="bg-fila" data-i="${i}"><i class="ph-bold ${META[f.tipo][0]}" aria-hidden="true"></i><span><b>${esc(f.titulo)}</b><small>${esc(f.sub)}</small></span></button>`; });
        panel.innerHTML = h; panel.querySelectorAll('.bg-fila').forEach(b => b.addEventListener('click', () => ir(ultimo[+b.dataset.i])));
    }
    function montar() {
        const inp = document.getElementById('ml-buscar'); if (!inp || inp.dataset.bg) return; inp.dataset.bg = '1';
        panel = document.createElement('div'); panel.id = 'bg-res'; panel.className = 'bg-res'; panel.hidden = true; panel.setAttribute('aria-live', 'polite');
        const caja = inp.closest('.ml-busq'); caja.parentNode.insertBefore(panel, caja.nextSibling);
        let tmr = null, seq = 0;
        inp.addEventListener('input', () => {
            clearTimeout(tmr); const q = inp.value, mi = ++seq;
            if (norm(q).length < 2) { pintar('', []); return; }
            tmr = setTimeout(async () => {
                if (!indice || Date.now() - cuando >= 600000) { panel.hidden = false; panel.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Preparando la búsqueda…') : 'Preparando la búsqueda…'; }
                const ix = await cargar(); if (mi !== seq) return; pintar(q, buscar(ix, q));
            }, 220);
        });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter' && inp.value.trim() && !inp.__primero && ultimo[0]) { e.preventDefault(); ir(ultimo[0]); } });
        inp.addEventListener('focus', () => { if (!indice) cargar().catch(() => {}); }, { once: true });
        document.addEventListener('visibilitychange', () => { if (document.hidden) cuando = 0; });
    }
    const intentar = (n) => { if (document.getElementById('ml-buscar')) montar(); else if (n < 40) setTimeout(() => intentar(n + 1), 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => intentar(0)); else intentar(0);
})();
