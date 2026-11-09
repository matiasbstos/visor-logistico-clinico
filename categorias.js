/* ==========================================================================
   CATEGORÍAS DE PRODUCTO (v21.129)
   Lista compartida y ampliable: se puede elegir una categoría en cualquier pantalla (Editar insumo, Ingresos,
   filtro de Existencias) o crear una nueva, y queda disponible en todas. Se guarda en Contadores/categorias-producto
   ({lista:[…]}); además se suman las categorías que ya tienen los productos.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const BASE = ['General', 'Insumo Médico', 'Medicamento', 'Aseo', 'Oficina'];
    const limpiar = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const clave = (t) => limpiar(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    /** Puro: une listas sin repetir (sin distinguir tildes ni mayúsculas) y ordena (General primero). */
    function unir(...listas) {
        const m = new Map();
        listas.flat().forEach(x => { const n = limpiar(x); if (n && !m.has(clave(n))) m.set(clave(n), n); });
        return [...m.values()].sort((a, b) => (clave(a) === 'general' ? -1 : clave(b) === 'general' ? 1 : a.localeCompare(b, 'es')));
    }
    let cache = null;
    async function cargar(forzar) {
        if (cache && !forzar) return cache;
        const f = window.firebaseFirestore, db = window.firebaseDb; let guardadas = [], deProductos = [], leido = false;
        if (f && db) {
            try { const d = await f.getDoc(f.doc(f.collection(db, 'Contadores'), 'categorias-producto')); if (d.exists()) guardadas = d.data().lista || []; } catch (e) { /* sin permiso: se usan las base */ }
            try { const sn = await f.getDocs(f.collection(db, 'Insumos')); sn.forEach(x => { const c = x.data().category || x.data().categoria; if (c) deProductos.push(c); }); leido = true; } catch (e) { /* sin lectura */ }
        }
        const lista = unir(BASE, guardadas, deProductos); if (leido) cache = lista; return lista;
    }
    async function agregar(nombre) {
        const n = limpiar(nombre); if (!n) return '';
        const f = window.firebaseFirestore, db = window.firebaseDb;
        const lista = unir(await cargar(), [n]); const hit = lista.find(x => clave(x) === clave(n));
        if (f && db) { try { await f.setDoc(f.doc(f.collection(db, 'Contadores'), 'categorias-producto'), { tipo: 'categorias-producto', lista: lista.filter(x => !BASE.includes(x)), updatedAt: f.serverTimestamp() }, { merge: true }); } catch (e) { throw new Error('No se pudo guardar la categoría: ' + (e.code || e.message)); } }
        cache = lista; document.dispatchEvent(new CustomEvent('sar-categorias', { detail: lista })); return hit;
    }
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    /** Llena un <select> con las categorías + «Crear categoría nueva…». opts.todas = texto de la opción «todas» (para filtros). */
    async function llenar(sel, actual, opts) {
        if (!sel) return; opts = opts || {};
        let lista = await cargar(); const act = limpiar(actual);
        if (act && !lista.some(x => clave(x) === clave(act))) lista = unir(lista, [act]);
        const pintar = (valor) => {
            sel.innerHTML = (opts.todas ? `<option value="all">${esc(opts.todas)}</option>` : '') + lista.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('') + (opts.sinCrear ? '' : '<option value="__nueva__">➕ Crear categoría nueva…</option>');
            sel.value = valor;
        };
        pintar(opts.todas && !act ? 'all' : (lista.find(x => clave(x) === clave(act)) || 'General'));
        if (sel.dataset.catLigado) return; sel.dataset.catLigado = '1';
        sel.addEventListener('change', async () => {
            if (sel.value !== '__nueva__') return;
            const previo = sel.dataset.catPrevio || (opts.todas ? 'all' : 'General');
            const nombre = window.prompt('Nombre de la nueva categoría (ej. Curación, Protección personal, Papelería):');
            if (!limpiar(nombre)) { sel.value = previo; return; }
            try { const creada = await agregar(nombre); lista = await cargar(); pintar(creada); sel.dispatchEvent(new Event('input', { bubbles: true })); if (window.showToast) window.showToast('Categoría creada', `«${creada}» ya está disponible en todos los apartados.`, 'success'); }
            catch (e) { sel.value = previo; if (window.showToast) window.showToast('No se creó la categoría', e.message, 'error'); }
        });
        sel.addEventListener('focus', () => { sel.dataset.catPrevio = sel.value; });
        document.addEventListener('sar-categorias', (ev) => { lista = ev.detail; const v = sel.value; pintar(lista.some(x => x === v) || v === 'all' ? v : 'General'); });
    }
    window.SAR_Categorias = { cargar, agregar, llenar, unir };
    if (typeof module !== 'undefined') module.exports = { unir };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
