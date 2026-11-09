/* ==========================================================================
   CÓDIGO SAR (v21.128)
   Cada producto (por nombre, en todas las bodegas y lotes) tiene un código interno único «SAR-000123»,
   correlativo y automático. Convive con el ID de Mercado Público (`codigoMP`), que se sigue usando para
   buscar la foto del catálogo. El código sirve para buscar, etiquetar y distinguir productos con nombres parecidos.
   Se guarda en Contadores: `codigo-sar-contador` ({n}) y `codigo-sar-<nombre normalizado>` ({codigo, nombre}).
   ========================================================================== */
(function (window) {
    'use strict';
    const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+(sar)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
    const formato = (n) => 'SAR-' + String(Math.max(0, Math.floor(Number(n) || 0))).padStart(6, '0');
    const cache = new Map();
    /** Devuelve el código SAR del producto, creándolo si no existe. Nunca lanza: si falla devuelve ''. */
    async function asignar(nombre) {
        const clave = slug(nombre); if (!clave) return '';
        if (cache.has(clave)) return cache.get(clave);
        const f = window.firebaseFirestore, db = window.firebaseDb; if (!f || !db) return '';
        try {
            const refP = f.doc(f.collection(db, 'Contadores'), 'codigo-sar-' + clave), refN = f.doc(f.collection(db, 'Contadores'), 'codigo-sar-contador');
            const codigo = await f.runTransaction(db, async (tx) => {
                const p = await tx.get(refP); if (p.exists() && p.data().codigo) return p.data().codigo;
                const c = await tx.get(refN), n = (c.exists() ? Number(c.data().n) || 0 : 0) + 1;
                tx.set(refN, { tipo: 'codigo-sar-contador', n, updatedAt: f.serverTimestamp() });
                tx.set(refP, { tipo: 'codigo-sar', codigo: formato(n), nombre: String(nombre).trim(), creadoEn: f.serverTimestamp() });
                return formato(n);
            });
            cache.set(clave, codigo); return codigo;
        } catch (e) { return ''; }
    }
    window.SAR_CodigoSAR = { asignar, slug, formato };
    if (typeof module !== 'undefined') module.exports = { slug, formato };
})(typeof window !== 'undefined' ? window : globalThis);
