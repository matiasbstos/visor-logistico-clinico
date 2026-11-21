/* ==========================================================================
   FOTOS DESDE EL TELÉFONO (v21.240)
   Pedido del usuario: el estándar es que cada producto tenga la foto del PRODUCTO y la de la CAJA.
   En el computador se trabaja siempre; las fotos se toman con el teléfono. Página propia
   (fotos.html, acceso directo de color naranjo) que lista lo pendiente:
     · productos con stock sin foto propia del producto o sin foto de la caja,
     · productos pedidos desde el computador («Pedir foto al teléfono»: Catalogo_Productos.fotoPedida).
   Cada foto se achica en el teléfono (máx. 480 px, JPEG) y se guarda en Catalogo_Productos
   (imagen = producto, imagenCaja = caja, fotosExtra = otras, máx. 3), que alimenta todo el sitio.
   Sin colección nueva: Catalogo_Productos ya permite crear y editar al personal (isStaff).
   ========================================================================== */
(function (window, document) {
    'use strict';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const usuario = () => (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || '';
    const toast = (t, m, k) => { if (window.showToast) window.showToast(t, m, k); };
    /** Mismo id que usa «Editar insumo» para la foto propia: el ID de Mercado Público o el nombre normalizado. */
    const idCatalogo = (nombre, codigo) => { const mp = String(codigo || '').replace(/\D/g, ''); return mp || (String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 60) || 'manual'); };
    const URL_FOTOS = () => new URL('fotos.html', window.location.href).href;

    /** Achica la foto en el teléfono (producto 480 px, caja y otras 360 px; JPEG 0,72): 20–40 KB por foto, para que el catálogo no pese. */
    function achicar(archivo, lado) {
        return new Promise((ok, mal) => {
            const u = URL.createObjectURL(archivo), im = new Image();
            im.onload = () => { try { const k = Math.min(1, (lado || 480) / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c.toDataURL('image/jpeg', 0.72)); } catch (e) { mal(e); } };
            im.onerror = () => { URL.revokeObjectURL(u); mal(new Error('No se pudo leer la foto.')); }; im.src = u;
        });
    }
    /** Lista de pendientes: productos con stock (sin repetir por nombre o código) + los pedidos desde el computador. Puro.
        Un producto puede tener varias fichas en el catálogo (por código y por nombre): se miran todas. */
    function pendientes(insumos, catalogo) {
        const porCod = new Map(), porNom = new Map(), add = (m, k, c) => { const a = m.get(k) || []; if (!a.includes(c)) a.push(c); m.set(k, a); };
        (catalogo || []).forEach(c => { if (c.codigoMP) add(porCod, String(c.codigoMP), c); [c.descripcion, c.insumoName].forEach(n => { if (n) add(porNom, norm(n), c); }); });
        const fichas = (nombre, codigo) => { const r = []; ((codigo && porCod.get(String(codigo))) || []).concat(porNom.get(norm(nombre)) || []).forEach(c => { if (!r.includes(c)) r.push(c); }); return r; };
        const mpOk = (c) => c.imagenMP && c.fotoEstado !== 'por_confirmar' && c.fotoEstado !== 'descartada';
        const fila = (nombre, codigo, stock, bodegas, fs) => {
            const con = (k) => fs.find(c => c[k]), im = con('imagen'), cj = con('imagenCaja'), ex = fs.find(c => Array.isArray(c.fotosExtra) && c.fotosExtra.length);
            const destino = im || cj || (codigo && fs.find(c => String(c.codigoMP || '') === String(codigo))) || fs[0];   /* se guarda en la ficha que ya tiene fotos */
            const tieneProd = !!im || fs.some(mpOk), pedida = fs.some(c => c.fotoPedida);
            return { nombre, codigo: codigo ? String(codigo) : '', stock, bodegas, id: destino ? destino.__id : idCatalogo(nombre, codigo), ids: fs.map(c => c.__id), faltaProd: !tieneProd, faltaCaja: !cj, pedida, imagen: im ? im.imagen : '', caja: cj ? cj.imagenCaja : '', extra: ex ? ex.fotosExtra : [], comun: (fs.find(c => c.nombreComun) || {}).nombreComun || '', fabricante: (fs.find(c => c.fabricante) || {}).fabricante || '' };
        };
        const prods = new Map();
        (insumos || []).forEach(i => { if (!i.name || i.status === 'ELIMINADO') return; const k = i.codigoMP ? 'c' + i.codigoMP : 'n' + norm(i.name); const p = prods.get(k) || { nombre: i.name, codigo: i.codigoMP ? String(i.codigoMP) : '', stock: 0, bodegas: new Set() }; p.stock += Number(i.quantity) || 0; if (i.location) p.bodegas.add(i.location); prods.set(k, p); });
        const out = [], vistos = new Set();
        prods.forEach(p => {
            const f = fila(p.nombre, p.codigo, p.stock, [...p.bodegas], fichas(p.nombre, p.codigo));
            f.ids.forEach(x => vistos.add(x));
            if (!(p.stock > 0 || f.pedida) || !(f.faltaProd || f.faltaCaja || f.pedida)) return;
            out.push(f);
        });
        (catalogo || []).forEach(c => { if (!c.fotoPedida || vistos.has(c.__id)) return; const n = c.descripcion || c.insumoName || c.__id, fs = fichas(n, c.codigoMP); fs.forEach(x => vistos.add(x.__id)); out.push(fila(n, c.codigoMP, 0, [], fs.length ? fs : [c])); });
        return out.sort((a, b) => (b.pedida - a.pedida) || ((b.faltaProd + b.faltaCaja) - (a.faltaProd + a.faltaCaja)) || (b.stock - a.stock) || a.nombre.localeCompare(b.nombre, 'es'));
    }
    async function leer() {
        const f = fs(), ins = [], cat = [];
        (await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(10000)))).forEach(d => ins.push(d.data()));
        (await f.getDocs(f.query(f.collection(db(), 'Catalogo_Productos'), f.limit(5000)))).forEach(d => cat.push({ __id: d.id, ...d.data() }));
        return { ins, cat };
    }
    /** Guarda una foto en el catálogo. tipo: 'producto' | 'caja' | 'extra'. */
    async function guardarFoto(p, tipo, dataUrl) {
        const f = fs(), ref = f.doc(f.collection(db(), 'Catalogo_Productos'), p.id), sn = await f.getDoc(ref), c = sn.exists() ? sn.data() : {};
        const base = { descripcion: c.descripcion || p.nombre, descripcion_lower: String(c.descripcion || p.nombre).toLowerCase(), insumoName: c.insumoName || p.nombre, codigoMP: c.codigoMP || p.codigo || '' };
        const cambio = tipo === 'producto' ? { imagen: dataUrl } : tipo === 'caja' ? { imagenCaja: dataUrl } : { fotosExtra: (Array.isArray(c.fotosExtra) ? c.fotosExtra : []).concat([dataUrl]).slice(-3) };
        const queda = { ...c, ...cambio };
        const completo = !!((queda.imagen || p.imagen || p.faltaProd === false) && (queda.imagenCaja || p.caja));
        await f.setDoc(ref, { ...base, ...cambio, fotoPedida: !!(c.fotoPedida && !completo), fotosPor: usuario(), fotosEn: new Date().toISOString() }, { merge: true });
        if (completo) for (const otro of (p.ids || []).filter(x => x && x !== p.id)) { try { await f.setDoc(f.doc(f.collection(db(), 'Catalogo_Productos'), otro), { fotoPedida: false }, { merge: true }); } catch (e) { /* la otra ficha queda pedida */ } }
        return queda;
    }
    /** Desde el computador: deja el producto en la lista del teléfono. */
    async function pedir(nombre, codigo) {
        const f = fs(), id = idCatalogo(nombre, codigo), ref = f.doc(f.collection(db(), 'Catalogo_Productos'), id), sn = await f.getDoc(ref), c = sn.exists() ? sn.data() : {};
        await f.setDoc(ref, { descripcion: c.descripcion || nombre, descripcion_lower: String(c.descripcion || nombre).toLowerCase(), insumoName: c.insumoName || nombre, codigoMP: c.codigoMP || String(codigo || ''), fotoPedida: true, fotoPedidaPor: usuario(), fotoPedidaEn: new Date().toISOString() }, { merge: true });
        return URL_FOTOS();
    }
    /** Ventana en el computador: link para abrir en el teléfono (copiar o QR) y aviso de que quedó pedido. */
    async function mostrarLink(nombre) {
        const url = URL_FOTOS(), P = window.SAR_Progreso;
        let qr = '';
        try { if (window.SAR_Bultos && window.SAR_Bultos.cargarQR) { await window.SAR_Bultos.cargarQR(); const m = window.SAR_Bultos.matrizQR(url), n = m.length, c = 5; qr = `<svg viewBox="0 0 ${n * c} ${n * c}" width="180" height="180" role="img" aria-label="QR para abrir en el teléfono"><rect width="100%" height="100%" fill="#fff"/>${m.map((f, r) => f.map((on, k) => on ? `<rect x="${k * c}" y="${r * c}" width="${c}" height="${c}"/>` : '').join('')).join('')}</svg>`; } } catch (e) { /* sin QR */ }
        const texto = `${nombre ? `<b>${esc(nombre)}</b> quedó en la lista de fotos pendientes.<br>` : ''}Abre este enlace en el teléfono (o escanea el QR) y déjalo como acceso directo (ícono naranjo con cámara, «Fotos SAR»).`, bloque = `<div class="ft-link">${qr}<input class="form-control" readonly value="${esc(url)}" onclick="this.select()"></div>`;
        if (P && P.confirmar) { const ok = await P.confirmar({ titulo: 'Fotos desde el teléfono', texto, bloque, si: 'Copiar enlace', no: 'Cerrar' }); if (ok) { try { await navigator.clipboard.writeText(url); toast('Enlace copiado', 'Pégalo en WhatsApp o en el navegador del teléfono.', 'success'); } catch (e) { toast('Enlace', url, 'info'); } } }
    }

    // ---------------- página del teléfono (fotos.html) ----------------
    function pagina(main) {
        let lista = [], q = '', filtro = 'todo';
        const cargandoHTML = (t) => window.SAR_Progreso && window.SAR_Progreso.cargando ? window.SAR_Progreso.cargando(t) : `<p class="ft-nada">${esc(t)}</p>`;
        const caja = (p, t, ok, img, ico, txtOk, txt) => `<label class="ft-f${ok ? ' ok' : ''}${t === 'extra' ? ' ft-mas' : ''}">${img ? `<img src="${esc(img)}" alt="">` : `<i class="ph-bold ${ico} ft-ico" aria-hidden="true"></i>`}<span>${ok ? txtOk : txt}</span><input type="file" accept="image/*" capture="environment" data-t="${t}" hidden></label>`;
        /* el buscador se dibuja una sola vez; al escribir solo cambia la lista (no se pierde el teclado ni las letras) */
        main.innerHTML = `<div class="ft-wrap"><div class="ft-barra"><input type="search" class="form-control" id="ft-q" placeholder="Buscar producto…" autocomplete="off" aria-label="Buscar producto"></div><div class="ft-chips" id="ft-chips"></div><div id="ft-lista" aria-live="polite">${cargandoHTML('Buscando los productos sin fotos…')}</div></div>`;
        const iq = main.querySelector('#ft-q'), chips = main.querySelector('#ft-chips'), cont = main.querySelector('#ft-lista');
        const pintar = () => {
            const t = norm(q), vis = lista.filter(p => (!t || t.split(' ').every(w => norm(p.nombre + ' ' + p.codigo + ' ' + p.comun).includes(w))) && (filtro === 'todo' || (filtro === 'prod' && p.faltaProd) || (filtro === 'caja' && p.faltaCaja) || (filtro === 'pedidas' && p.pedida)));
            chips.innerHTML = [['todo', 'Todos', lista.length], ['pedidas', 'Pedidas', lista.filter(p => p.pedida).length], ['prod', 'Sin foto del producto', lista.filter(p => p.faltaProd).length], ['caja', 'Sin foto de la caja', lista.filter(p => p.faltaCaja).length]].map(([k, n, c]) => `<button type="button" class="ft-chip${filtro === k ? ' on' : ''}" data-f="${k}" aria-pressed="${filtro === k}">${n} <b>${c}</b></button>`).join('');
            cont.innerHTML = vis.length ? vis.slice(0, 150).map(p => `<article class="ft-p" data-i="${lista.indexOf(p)}">
                <header><b>${esc(p.nombre)}</b><small>${p.codigo ? 'ID ' + esc(p.codigo) + ' · ' : ''}${p.stock ? p.stock + ' u. · ' : ''}${esc(p.bodegas.join(', '))}${p.pedida ? ' · <span class="ft-ped">pedida</span>' : ''}</small></header>
                <div class="ft-fotos">${caja(p, 'producto', !p.faltaProd, p.imagen, 'ph-camera', 'Producto listo · cambiar', 'Foto del producto')}${caja(p, 'caja', !p.faltaCaja, p.caja, 'ph-package', 'Caja lista · cambiar', 'Foto de la caja')}${caja(p, 'extra', false, p.extra[p.extra.length - 1], 'ph-plus', '', 'Otra foto' + (p.extra.length ? ` (${p.extra.length}/3)` : ''))}</div></article>`).join('')
                : `<p class="ft-nada">${lista.length ? 'Nada coincide.' : 'Todo al día: no hay productos sin fotos.'}</p>`;
        };
        iq.addEventListener('input', () => { q = iq.value; pintar(); });
        chips.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { filtro = b.dataset.f; pintar(); } });
        cont.addEventListener('change', async (e) => {
            const inp = e.target; if (!inp || inp.type !== 'file') return;
            const art = inp.closest('.ft-p'), p = lista[Number(art.dataset.i)], fi = inp.files && inp.files[0]; if (!fi || !p) return;
            const lab = inp.closest('.ft-f'); lab.classList.add('ft-sub');
            try { const d = await achicar(fi, inp.dataset.t === 'producto' ? 480 : 360), c = await guardarFoto(p, inp.dataset.t, d); p.imagen = c.imagen || p.imagen; p.caja = c.imagenCaja || p.caja; p.extra = c.fotosExtra || p.extra; p.faltaProd = p.faltaProd && !p.imagen; p.faltaCaja = !p.caja; if (!p.faltaProd && !p.faltaCaja) p.pedida = false; toast('Foto guardada', `${p.nombre.slice(0, 40)} · ${inp.dataset.t === 'producto' ? 'producto' : inp.dataset.t === 'caja' ? 'caja' : 'otra foto'}`, 'success'); pintar(); }
            catch (x) { lab.classList.remove('ft-sub'); toast('No se guardó', (x && x.message) || String(x), 'error'); }
        });
        return leer().then(({ ins, cat }) => { lista = pendientes(ins, cat); pintar(); }).catch(e => { cont.innerHTML = `<p class="ft-nada">No se pudo cargar: ${esc(e.message || e)}</p>`; });
    }
    /* en el Visor: «Pedir al teléfono» en Editar insumo, foto de la caja junto a la del producto y «Fotos desde el teléfono» en Accesos */
    if (document && document.addEventListener && !/fotos\.html/.test(String(window.location && window.location.pathname))) {
        document.addEventListener('click', async (e) => {
            const t = e.target.closest && e.target.closest('#edit-foto-tel, [data-fotos-tel]'); if (!t) return;
            e.preventDefault();
            if (t.id === 'edit-foto-tel') { const n = (document.getElementById('edit-name') || {}).value || '', c = (document.getElementById('edit-codigoMP') || {}).value || ''; if (!n.trim()) return; try { await pedir(n.trim(), c.trim()); if (window.SAR_Imagenes && window.SAR_Imagenes.recargar) window.SAR_Imagenes.recargar(); mostrarLink(n.trim()); } catch (x) { toast('No se pudo', (x && x.message) || String(x), 'error'); } }
            else mostrarLink('');
        });
        const verCaja = () => { const el = document.getElementById('edit-foto-caja'), n = (document.getElementById('edit-name') || {}).value || ''; if (!el || !window.SAR_Imagenes || !window.SAR_Imagenes.fotos) return; const f = window.SAR_Imagenes.fotos(n, (document.getElementById('edit-codigoMP') || {}).value || ''); el.innerHTML = f.caja ? `<img src="${esc(f.caja)}" alt="Caja">` : ''; el.title = f.caja ? 'Foto de la caja' : 'Sin foto de la caja: usa «Pedir al teléfono»';; };
        const verCaja0 = verCaja;   /* espera a que el catálogo de fotos esté cargado */
        window.__ftVerCaja = () => { const I = window.SAR_Imagenes; if (I && I.cargar) I.cargar().then(verCaja0).catch(() => {}); else verCaja0(); };
    }
    window.SAR_FotosTel = { verCaja: () => { if (window.__ftVerCaja) window.__ftVerCaja(); }, achicar, pendientes, guardarFoto, pedir, mostrarLink, pagina, idCatalogo, URL_FOTOS };
    if (typeof module !== 'undefined') module.exports = { pendientes, idCatalogo };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : null);
