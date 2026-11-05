/* ==========================================================================
   FOTOS DE PRODUCTOS (v20.85)
   --------------------------------------------------------------------------
   Cada producto de una orden de Mercado Público trae un código entre paréntesis
   ("(4540135) BOLSA DE BASURA…"). Con ese código se busca la foto en la tienda de
   Convenio Marco: se guarda el nombre del archivo de la imagen (no la imagen) en el
   Catálogo de productos y se muestra desde la propia tienda.

   Orden de búsqueda de la foto de un producto:
   1) foto propia subida a mano al catálogo (campo `imagen`),
   2) archivo de Mercado Público ya guardado en el catálogo (`imagenMP`),
   3) tabla incluida en assets/imagenes-mp.json (órdenes ya leídas),
   4) Apps Script (acción "imagenes") para códigos nuevos, si está configurado.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const BASE = 'https://conveniomarco.mercadopublico.cl/media/catalog/product/';
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let descartados = new Set(), candidatas = new Map();
    let semilla = {}, porCodigo = new Map(), porNombre = new Map(), cargando = null, listo = false;

    function urlMP(archivo, tam) { const t = tam || 120; return `${BASE}${archivo}?width=${t}&height=${t}&canvas=${t},${t}&quality=80&fit=bounds`; }
    // Una foto de la tienda solo se muestra si está CONFIRMADA: la que quedó "por_confirmar" (código nuevo o con descripción
    // parecida a otro producto) o "descartada" no se usa en ninguna pantalla hasta que la persona la mire en la tienda y la confirme.
    const sinConfirmar = (c) => c.fotoEstado === 'por_confirmar' || c.fotoEstado === 'descartada';
    function entrada(c) { return { codigo: c.codigoMP ? String(c.codigoMP) : '', imagen: c.imagen || '', archivo: sinConfirmar(c) ? '' : (c.imagenMP || (c.codigoMP && semilla[String(c.codigoMP)]) || '') }; }
    function indexar(lista) {
        porCodigo = new Map(); porNombre = new Map(); descartados = new Set(); candidatas = new Map();
        lista.forEach(c => {
            if (c.codigoMP && c.fotoEstado === 'por_confirmar' && c.imagenMP) candidatas.set(String(c.codigoMP), { codigo: String(c.codigoMP), imagen: '', archivo: c.imagenMP, pendiente: true });
            if (c.codigoMP && sinConfirmar(c)) descartados.add(String(c.codigoMP));
            const e = entrada(c); if (!e.imagen && !e.archivo) return;
            if (c.codigoMP) porCodigo.set(String(c.codigoMP), e);
            [c.descripcion, c.insumoName].forEach(n => { if (n) porNombre.set(norm(n), e); });
        });
        Object.keys(semilla).forEach(cod => { if (!porCodigo.has(cod) && !descartados.has(cod)) porCodigo.set(cod, { codigo: cod, imagen: '', archivo: semilla[cod] }); });
    }
    async function cargar(forzar) {
        if (listo && !forzar) return true;
        if (cargando) return cargando;
        cargando = (async () => {
            try { const r = await fetch('assets/imagenes-mp.json'); if (r.ok) semilla = await r.json(); } catch (e) { /* sin tabla */ }
            let lista = [];
            try { if (fs() && db()) { const sn = await fs().getDocs(fs().query(fs().collection(db(), 'Catalogo_Productos'), fs().limit(3000))); sn.forEach(d => lista.push({ id: d.id, ...d.data() })); } } catch (e) { /* sin catálogo */ }
            indexar(lista); listo = true; rellenar(); return true;
        })().finally(() => { cargando = null; });
        return cargando;
    }
    /** Por código si lo hay; por nombre solo si el producto no tiene código o es el mismo código (nunca la foto de otro código). */
    function buscar(nombre, codigo) {
        const c = codigo ? String(codigo) : '';
        if (c && porCodigo.get(c)) return porCodigo.get(c);
        const e = porNombre.get(norm(nombre)) || null;
        return e && (!c || !e.codigo || e.codigo === c) ? e : null;
    }
    /** Como buscar(), pero si no hay foto confirmada devuelve la candidata marcada como "por confirmar" (solo para la orden en curso). */
    function buscarConCandidata(nombre, codigo) { return buscar(nombre, codigo) || (codigo ? candidatas.get(String(codigo)) || null : null); }
    function src(e, tam) { return e ? (e.imagen || (e.archivo ? urlMP(e.archivo, tam) : '')) : ''; }
    function imgHTML(e, tam, alt) { const s = src(e, tam); return s ? `<img src="${esc(s)}" alt="${esc(alt || '')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode&&this.parentNode.classList.add('prod-img--sin');this.remove()">` : ''; }
    /** Marcador con la foto del producto (se completa solo cuando el catálogo termina de cargar). */
    function thumb(nombre, opc) {
        const o = opc || {}; if (!listo) cargar().catch(() => {});
        const e = listo ? (o.candidata ? buscarConCandidata(nombre, o.codigo) : buscar(nombre, o.codigo)) : null;
        return `<span class="prod-img${o.grande ? ' prod-img--g' : ''}${e && e.pendiente ? ' prod-img--pend' : ''}" data-img-name="${esc(nombre)}" data-img-code="${esc(o.codigo || '')}"${o.candidata ? ' data-img-cand="1"' : ''}${e && e.pendiente ? ' title="Foto por confirmar"' : ''}>${imgHTML(e, o.grande ? 240 : 96, nombre)}</span>`;
    }
    function rellenar(raiz) {
        if (!listo) return;
        (raiz || document).querySelectorAll('.prod-img[data-img-name]:not(:has(img)):not(.prod-img--sin)').forEach(sp => {
            const e = sp.dataset.imgCand ? buscarConCandidata(sp.dataset.imgName, sp.dataset.imgCode) : buscar(sp.dataset.imgName, sp.dataset.imgCode);
            const h = imgHTML(e, sp.classList.contains('prod-img--g') ? 240 : 96, sp.dataset.imgName); if (h) { sp.innerHTML = h; if (e && e.pendiente) { sp.classList.add('prod-img--pend'); sp.title = 'Foto por confirmar'; } }
        });
    }
    /** Archivo de la tienda para un código: tabla incluida o Apps Script (códigos nuevos). */
    /** Devuelve {archivo, origen}: 'semilla' (tabla ya verificada contra la tienda), 'tienda' (Apps Script) o 'supuesto' (se probó el nombre habitual). */
    async function buscarFoto(codigo, cfg) {
        const c = String(codigo || '').replace(/\D/g, ''); if (!c) return { archivo: '', origen: '', motivo: 'sin_codigo' };
        if (!listo) await cargar();
        if (semilla[c]) return { archivo: semilla[c], origen: 'semilla' };
        let motivo = 'no_en_tiendas';
        if (cfg && cfg.webhookUrl && cfg.token) {
            try {
                const r = await fetch(cfg.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: cfg.token, accion: 'imagenes', codigos: [c] }) });
                const j = await r.json(); const f = j && j.ok && j.imagenes && j.imagenes[c]; if (f) return { archivo: f, origen: 'tienda' };
                if (!(j && j.ok)) motivo = 'script_rechazo:' + String((j && j.error) || 'respuesta no válida');
            } catch (e) { motivo = 'script_inaccesible:' + String((e && e.message) || e); }
        } else motivo = 'sin_script';
        const g = await adivinar(c); if (g) return { archivo: g, origen: 'supuesto' };
        return { archivo: '', origen: '', motivo };
    }
    const archivoPara = async (codigo, cfg) => (await buscarFoto(codigo, cfg)).archivo;
    /** Sin Apps Script: prueba los nombres de archivo habituales (código−7, con o sin _1) cargando la imagen. */
    function probar(url) { return new Promise(ok => { const im = new Image(); im.onload = () => ok(im.naturalWidth > 20); im.onerror = () => ok(false); im.src = url; }); }
    async function adivinar(c) {
        const n = Number(c); if (!n) return '';
        for (const f of [n - 7, n - 7 + '_1']) {
            const nom = String(f), arch = `${nom[0]}/${nom[1]}/${nom}.jpg`;
            if (await probar(urlMP(arch, 60))) return arch;
        }
        return '';
    }
    /** Ampliación al hacer clic en cualquier foto de producto. */
    function ampliar(img) {
        const sp = img.closest('.prod-img'), nombre = (sp && sp.dataset.imgName) || img.alt || '';
        const s = img.src.replace(/width=\d+&height=\d+&canvas=\d+,\d+/, 'width=900&height=900&canvas=900,900');
        const ov = document.createElement('div'); ov.className = 'prod-zoom'; ov.setAttribute('role', 'dialog');
        ov.innerHTML = `<div class="prod-zoom-box"><button type="button" class="prod-zoom-x" aria-label="Cerrar">×</button><img src="${esc(s)}" alt="${esc(nombre)}" referrerpolicy="no-referrer"><p>${esc(nombre)}${sp && sp.classList.contains('prod-img--pend') ? '<br><small>Foto por confirmar: compárala con la tienda (Catálogo de productos → Fotos por confirmar).</small>' : ''}</p></div>`;
        const cerrar = () => { ov.remove(); document.removeEventListener('keydown', tecla); };
        const tecla = (e) => { if (e.key === 'Escape') cerrar(); };
        ov.addEventListener('click', (e) => { if (e.target === ov || e.target.classList.contains('prod-zoom-x')) cerrar(); });
        document.addEventListener('keydown', tecla); document.body.appendChild(ov);
    }
    document.addEventListener('click', (e) => { const im = e.target && e.target.closest && e.target.closest('.prod-img img'); if (im) { e.preventDefault(); e.stopPropagation(); ampliar(im); } }, true);
    let t = null;
    if (typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (!listo) return; clearTimeout(t); t = setTimeout(() => rellenar(), 250); }).observe(document.documentElement, { childList: true, subtree: true });
    window.SAR_Imagenes = { buscarFoto, ampliar, cargar, thumb, buscar, src, imgHTML, rellenar, archivoPara, urlMP, recargar: () => cargar(true) };
})(window, document);
