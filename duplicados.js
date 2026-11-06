/* ==========================================================================
   Revisar productos parecidos (v21.25) — solo para REVISAR, no cambia nada.
   Junta los productos (stock de todas las bodegas + catálogo) cuyo nombre es casi igual
   (una letra, un punto, un espacio o un acento de diferencia) o que comparten ID con
   nombres distintos, y lista aparte los ingresados manualmente (provisionales) para
   decidir uno a uno si corresponde unificarlos. Los números del nombre (250, 200, 2…)
   deben coincidir: "250 M" y "200 M" nunca se agrupan.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (v) => Number(v) || 0;
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const root = () => document.getElementById('dup-root');

    function lev(a, b, tope) {
        if (Math.abs(a.length - b.length) > tope) return tope + 1;
        let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const cur = [i]; let min = i;
            for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < min) min = cur[j]; }
            if (min > tope) return tope + 1; prev = cur;
        }
        return prev[b.length];
    }
    const numeros = (n) => (n.match(/\d+/g) || []).slice().sort().join(',');
    const compacto = (n) => n.replace(/\s+/g, '');

    /** items: [{fuente:'Stock'|'Catálogo', id, nombre, codigo, bodega, qty, sobregiro, provisional, origen}] → grupos de 2+ parecidos. */
    function agrupar(items) {
        const pre = items.map(x => { const n = norm(x.nombre); return { x, n, c: compacto(n), num: numeros(n), cod: String(x.codigo || '').replace(/\D/g, '') }; }).filter(p => p.n);
        const padre = pre.map((_, i) => i), raiz = (i) => padre[i] === i ? i : (padre[i] = raiz(padre[i])), unir = (a, b) => { padre[raiz(a)] = raiz(b); };
        const cubo = new Map(); pre.forEach((p, i) => { const k = p.c.slice(0, 4); if (!cubo.has(k)) cubo.set(k, []); cubo.get(k).push(i); });
        for (const ids of cubo.values()) for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
            const A = pre[ids[a]], B = pre[ids[b]];
            if (A.num !== B.num) continue;
            const tope = Math.max(1, Math.floor(Math.min(A.c.length, B.c.length) * 0.06));
            if (A.c === B.c || lev(A.c, B.c, tope) <= tope) unir(ids[a], ids[b]);
        }
        // mismo ID con nombres distintos
        const porCod = new Map(); pre.forEach((p, i) => { if (p.cod.length >= 5) { if (porCod.has(p.cod)) unir(i, porCod.get(p.cod)); else porCod.set(p.cod, i); } });
        const g = new Map(); pre.forEach((p, i) => { const r = raiz(i); if (!g.has(r)) g.set(r, []); g.get(r).push(p.x); });
        return [...g.values()].filter(a => a.length > 1 && new Set(a.map(x => (x.fuente || '') + '|' + (x.id || '') + '|' + norm(x.nombre) + '|' + (x.bodega || ''))).size > 1)
            .map(a => ({ miembros: a.sort((p, q) => String(p.nombre).localeCompare(String(q.nombre), 'es')), razon: new Set(a.map(x => norm(x.nombre))).size > 1 ? 'nombres casi iguales' : 'mismo nombre en varios lugares' }))
            .sort((a, b) => b.miembros.length - a.miembros.length);
    }

    let datos = { grupos: [], manuales: [] };
    async function traer() {
        const f = fs();
        const [si, sc] = await Promise.all([
            f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(4000))),
            f.getDocs(f.query(f.collection(db(), 'Catalogo_Productos'), f.limit(4000))).catch(() => null)
        ]);
        const items = [];
        si.forEach(d => { const x = d.data(); items.push({ fuente: 'Stock', id: d.id, nombre: x.name || '', codigo: x.codigoMP || '', bodega: x.location || '', qty: num(x.quantity), sobregiro: num(x.sobregiro), provisional: !!x.provisional, estado: x.status || '' }); });
        if (sc) sc.forEach(d => { const x = d.data(); items.push({ fuente: 'Catálogo', id: d.id, nombre: String(x.insumoName || x.descripcion || ''), codigo: x.codigoMP || '', origen: x.origen || '' }); });
        datos = { grupos: agrupar(items), manuales: items.filter(x => x.fuente === 'Stock' && x.provisional).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) };
    }
    const fila = (x) => `<tr><td>${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(x.nombre, { codigo: x.codigo }) : ''}</td><td>${esc(x.nombre)}</td><td>${esc(x.codigo || '')}</td><td>${esc(x.fuente)}${x.provisional ? ' · <b>manual provisional</b>' : ''}${x.origen === 'manual' ? ' · manual' : ''}</td><td>${esc(x.bodega || '')}</td><td class="n">${x.fuente === 'Stock' ? x.qty + (x.sobregiro ? ` <small>(sobregiro ${x.sobregiro})</small>` : '') : ''}</td></tr>`;
    function pintar() {
        const r = root(); if (!r) return;
        r.innerHTML = `<div class="sus-w"><h2>Revisar productos parecidos</h2>
          <p class="act-hint">Solo para revisar: no se modifica nada. Aquí aparecen productos con nombres casi iguales (una letra, un punto, un acento) y los ingresados manualmente en actas, para decidir uno a uno si corresponde unificarlos antes de cuadrar.</p>
          <div class="sus-acc"><button type="button" class="btn btn-outline btn-sm" id="dup-rec">Actualizar</button></div>
          <h3>Posibles duplicados (${datos.grupos.length} grupo(s))</h3>
          ${datos.grupos.length ? datos.grupos.map((g, n) => `<div class="dup-g"><h4>Grupo ${n + 1} · ${esc(g.razon)} (${g.miembros.length})</h4><table class="sus-t"><thead><tr><th></th><th>Nombre</th><th>ID</th><th>Dónde</th><th>Bodega</th><th>Stock</th></tr></thead><tbody>${g.miembros.map(fila).join('')}</tbody></table></div>`).join('') : '<p class="act-hint">No encontré productos parecidos.</p>'}
          <h3>Ingresados manualmente, aún provisionales (${datos.manuales.length})</h3>
          ${datos.manuales.length ? `<table class="sus-t"><thead><tr><th></th><th>Nombre</th><th>ID</th><th>Dónde</th><th>Bodega</th><th>Stock</th></tr></thead><tbody>${datos.manuales.map(fila).join('')}</tbody></table>` : '<p class="act-hint">No hay productos provisionales.</p>'}
        </div>`;
        r.querySelector('#dup-rec').addEventListener('click', abrir);
        if (window.SAR_Imagenes && window.SAR_Imagenes.rellenar) window.SAR_Imagenes.rellenar(r);
    }
    async function abrir() {
        const r = root(); if (!r) return;
        r.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Comparando nombres de productos…') : 'Cargando…';
        try { await traer(); pintar(); } catch (e) { r.innerHTML = `<p class="act-err" style="padding:24px;">No se pudo cargar: ${esc(e.message || e)}</p>`; }
    }
    window.SAR_Duplicados = { abrir, agrupar };
    if (typeof module !== 'undefined') module.exports = window.SAR_Duplicados;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
