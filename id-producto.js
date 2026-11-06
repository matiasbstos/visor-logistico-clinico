/* ==========================================================================
   BÚSQUEDA POR ID DE PRODUCTO (v21.15)
   Une, por nombre, el ID (código Mercado Público) que tienen los insumos y el catálogo,
   para que cualquier buscador pueda encontrar un producto escribiendo su ID.
   Uso: SAR_IdProducto.coincide(nombreDelProducto, textoBuscado) → true si el texto es un
   ID (solo dígitos) contenido en alguno de los IDs de ese producto.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const digitos = (t) => String(t || '').replace(/\D/g, '');
    let mapa = new Map(), cargadoEn = 0, cargando = null;

    function indexar(insumos, catalogo) {
        const m = new Map(), add = (n, c) => { c = digitos(c); n = norm(n); if (!n || !c) return; if (!m.has(n)) m.set(n, new Set()); m.get(n).add(c); };
        (insumos || []).forEach(x => add(x.name, x.codigoMP));
        (catalogo || []).forEach(c => { add(c.descripcion, c.codigoMP); add(c.insumoName, c.codigoMP); });
        mapa = m; cargadoEn = Date.now();
    }
    async function cargar(forzar) {
        if (!forzar && cargadoEn && Date.now() - cargadoEn < 5 * 60 * 1000) return;
        if (cargando) return cargando;
        const f = window.firebaseFirestore, db = window.firebaseDb; if (!f || !db) return;
        cargando = (async () => {
            const [si, sc] = await Promise.all([
                f.getDocs(f.query(f.collection(db, 'Insumos'), f.limit(3000))),
                f.getDocs(f.query(f.collection(db, 'Catalogo_Productos'), f.limit(3000))).catch(() => null)
            ]);
            const ins = [], cat = []; si.forEach(d => ins.push(d.data())); if (sc) sc.forEach(d => cat.push(d.data()));
            indexar(ins, cat);
        })().catch(() => {}).finally(() => { cargando = null; });
        return cargando;
    }
    function codigos(nombre) { const s = mapa.get(norm(nombre)); return s ? [...s] : []; }
    function coincide(nombre, texto) {
        const t = digitos(texto); if (t.length < 3 || /[a-z]/i.test(String(texto).replace(/\s|-/g, ''))) return false;
        if (!cargadoEn) { cargar(); return false; }
        return codigos(nombre).some(c => c.includes(t));
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
        const ok = () => window.firebaseAuth && window.firebaseAuth.currentUser;
        const ciclo = () => { if (ok()) cargar(true); };
        setTimeout(ciclo, 7000); setInterval(ciclo, 10 * 60 * 1000);
    }
    window.SAR_IdProducto = { cargar, codigos, coincide, indexar };
    if (typeof module !== 'undefined') module.exports = window.SAR_IdProducto;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: { dataset: {} } });
