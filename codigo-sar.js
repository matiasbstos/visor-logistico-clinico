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

    /** Clave estable de un lote: LOTE|AAAA-MM-DD (el vencimiento se normaliza para que 05/01/2030 y 2030-01-05 sean el mismo). */
    function claveLote(lote, vence) {
        const L = String(lote || 'S/L').trim().toUpperCase() || 'S/L';
        let v = String(vence || '').trim();
        const m1 = v.match(/^(\d{4})-(\d{2})-(\d{2})/), m2 = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
        if (m1) v = m1[1] + '-' + m1[2] + '-' + m1[3]; else if (m2) v = m2[3] + '-' + m2[2].padStart(2, '0') + '-' + m2[1].padStart(2, '0'); else v = '';
        return L + '|' + v;
    }
    const formatoLote = (codigo, n) => codigo + '-L' + String(Math.max(1, Math.floor(Number(n) || 1))).padStart(2, '0');
    /** Código del lote «SAR-000013-L02»: correlativo por producto; mismo lote y vencimiento = mismo código en cualquier bodega. Nunca lanza. */
    async function asignarLote(nombre, lote, vence) {
        const clave = slug(nombre); if (!clave) return '';
        const f = window.firebaseFirestore, db = window.firebaseDb; if (!f || !db) return '';
        try {
            const base = await asignar(nombre); if (!base) return '';
            const k = claveLote(lote, vence), kd = k.replace(/[^A-Za-z0-9|-]+/g, '_');
            const ref = f.doc(f.collection(db, 'Contadores'), 'codigo-lote-' + clave);
            return await f.runTransaction(db, async (tx) => {
                const s = await tx.get(ref), d = s.exists() ? s.data() : { n: 0, lotes: {} }, lotes = d.lotes || {};
                if (lotes[kd]) return lotes[kd];
                const n = (Number(d.n) || 0) + 1, cod = formatoLote(base, n);
                lotes[kd] = cod; tx.set(ref, { tipo: 'codigo-lote', producto: String(nombre).trim(), n, lotes, updatedAt: f.serverTimestamp() });
                return cod;
            });
        } catch (e) { return ''; }
    }
    /** Pone código a los lotes que no lo tienen (devuelve true si cambió algo). */
    async function codificarLotes(nombre, batches) {
        let cambio = false;
        for (const b of batches || []) { if (!b.codigoLote) { const c = await asignarLote(nombre, b.batch, b.expirationDate); if (c) { b.codigoLote = c; cambio = true; } } }
        return cambio;
    }
    window.SAR_CodigoSAR = { asignar, slug, formato, claveLote, formatoLote, asignarLote, codificarLotes };
    if (typeof module !== 'undefined') module.exports = { slug, formato, claveLote, formatoLote };
})(typeof window !== 'undefined' ? window : globalThis);
