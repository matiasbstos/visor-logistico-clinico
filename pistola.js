/* Pistola lectora (4.307): un solo lector para Ingresos y Transferencias.
   Lee al recibir Enter, Tab o una pausa en la escritura (la pistola Spektra «teclea» muy rápido y puede no mandar Enter).
   Reconoce:
   - etiqueta de bulto (BUL-AAAA-NNNNNN, sus 10 dígitos o el QR con la URL), con SAR_Bultos.folioDe / leer;
   - código del producto: codigoSAR, codigoMP (ID Mercado Público), code o codigoBarras del insumo.
   No escribe nada en Firestore: solo lee y avisa. */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '').trim();
  const toast = (t, m, k) => { if (window.showToast) window.showToast(t, m, k); };
  const CAMPOS = ['codigoSAR', 'codigoMP', 'code', 'codigoBarras'];

  let cache = null, cacheEn = 0;
  /** Insumos para buscar por código: primero lo que ya cargó Ingresos (insumosDataCache); si no, se leen (1 min de caché). */
  async function insumos() {
    if (Array.isArray(window.insumosDataCache) && window.insumosDataCache.length) return window.insumosDataCache;
    if (cache && Date.now() - cacheEn < 60000) return cache;
    const F = fs(); if (!F || !db()) return [];
    const s = await F.getDocs(F.collection(db(), 'Insumos')); const r = [];
    s.forEach(d => r.push({ id: d.id, ...d.data() }));
    cache = r; cacheEn = Date.now(); return r;
  }
  /** Busca un insumo por cualquiera de sus códigos (coincidencia exacta, sin espacios ni mayúsculas). `lista` opcional. */
  async function porCodigo(txt, lista) {
    const t = norm(txt); if (!t) return null;
    const l = lista || await insumos();
    return l.find(i => CAMPOS.some(c => i[c] != null && i[c] !== '' && norm(i[c]) === t)) || null;
  }
  /** Interpreta lo leído. Devuelve { tipo: 'bulto', folio, bulto } | { tipo: 'tag', folio } | { tipo: 'producto', insumo } | { tipo: 'nada', texto }. */
  async function interpretar(txt, lista) {
    const B = window.SAR_Bultos, texto = String(txt || '').trim();
    const folio = B && B.folioDe ? B.folioDe(texto) : '';
    if (folio) {
      const b = await B.leer(folio).catch(() => null);
      if (!b) return { tipo: 'nada', texto, folio };
      if ((B.esTag && B.esTag(b)) || b.tipo === 'tag-conteo') return { tipo: 'tag', folio, bulto: b };
      return { tipo: 'bulto', folio, bulto: b };
    }
    const x = await porCodigo(texto, lista);
    return x ? { tipo: 'producto', insumo: x } : { tipo: 'nada', texto };
  }
  /** Conecta un campo de texto a la pistola. `alLeer(texto)` recibe lo leído ya recortado. */
  function conectar(input, alLeer, pausa) {
    if (!input || input.dataset.pistola) return; input.dataset.pistola = '1';
    let tm = null; const ms = pausa || 450;
    const disparar = () => { clearTimeout(tm); const v = input.value.trim(); if (!v) return; alLeer(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || (e.key === 'Tab' && input.value.trim())) { e.preventDefault(); disparar(); } });
    /* pausa: solo si parece una lectura (al menos 6 caracteres seguidos); quien escribe a mano usa Enter */
    input.addEventListener('input', () => { clearTimeout(tm); if (input.value.trim().length >= 6) tm = setTimeout(disparar, ms); });
  }

  /* ---------- Ingresos: selecciona el producto en #ingreso-insumo, igual que el lector #btn-scan-barcode ---------- */
  async function leerIngreso(txt) {
    const inp = document.getElementById('ingreso-pistola'), dest = document.getElementById('ingreso-insumo');
    let r; try { r = await interpretar(txt); } catch (e) { toast('Pistola', 'No pude leer el código: ' + ((e && e.message) || e), 'error'); return; }
    if (inp) inp.value = '';
    if (r.tipo === 'tag') { toast('Tag CONTADO', (window.SAR_Bultos && window.SAR_Bultos.avisoTag) ? window.SAR_Bultos.avisoTag(r.folio) : `${r.folio} es un tag de conteo, no una caja.`, 'warning'); return; }
    if (r.tipo === 'bulto') {
      const b = r.bulto;
      toast('Es una caja', `${r.folio}: ${b.nombre || 'producto sin nombre'} · lote ${b.lote || 'S/L'} · ${Number(b.contenido) || 0} u. Una caja con etiqueta ya está en el stock; para ingresar más, lee el código del producto.`, 'warning');
      return;
    }
    if (r.tipo === 'producto') {
      if (dest) { dest.value = r.insumo.name || ''; dest.dispatchEvent(new Event('input', { bubbles: true })); dest.dispatchEvent(new Event('change', { bubbles: true })); }
      toast('Producto encontrado', `${r.insumo.name || ''} quedó seleccionado.`, 'success'); return;
    }
    if (dest) { dest.value = r.texto; dest.dispatchEvent(new Event('input', { bubbles: true })); dest.focus(); }
    toast('Sin coincidencia', r.folio ? `${r.folio} no existe en el sistema.` : `El código «${String(r.texto).slice(0, 40)}» no corresponde a ningún producto. Quedó escrito en el buscador para que lo elijas a mano.`, 'warning');
  }
  function iniciar() { const i = document.getElementById('ingreso-pistola'); if (i) conectar(i, leerIngreso); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  window.SAR_Pistola = { conectar, interpretar, porCodigo, leerIngreso, norm };
})(window, document);
