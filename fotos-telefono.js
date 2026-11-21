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
    /* Ficha escrita por v21.240 al revés: solo se reconoce con seguridad si tiene `imagenCaja` (en ese caso `imagen` era el producto).
       Sin imagenCaja, `imagen` se lee como la caja (modelo de la casa): en el peor caso una foto queda en el lugar equivocado, nunca se pierde. */
    const legado = (c) => !!(c && c.imagenCaja && c.fotosV !== 2);
    const imgDe = (x) => typeof x === 'string' ? x : (x && x.img) || '';
    /** Ficha en el modelo de la casa, sin perder ninguna foto: {imagen (caja), fotosExtra[{tipo,img,…}]}. Pura. */
    function migrar(c) {
        let ex = (Array.isArray(c.fotosExtra) ? c.fotosExtra.filter(Boolean) : []).map(x => typeof x === 'string' ? { tipo: 'otra', img: x } : x);
        if (!legado(c)) return { imagen: c.imagen || '', fotosExtra: ex };
        if (c.imagen) {   /* la foto del producto que se sacó con el teléfono manda sobre la «por confirmar» automática */
            const k = ex.findIndex(x => x.tipo === 'producto' && x.porConfirmar), real = ex.some(x => x.tipo === 'producto' && !x.porConfirmar);
            const nueva = { tipo: real ? 'otra' : 'producto', img: c.imagen, por: c.fotosPor || '', en: c.fotosEn || '' };
            if (!real && k >= 0) ex[k] = nueva; else ex.push(nueva);
        }
        return { imagen: c.imagenCaja, fotosExtra: ex };
    }
    /** Lee una ficha: {c, caja, cajaAuto ({mp}|{web}), producto, otras[]} */
    function normal(c) {
        const m = migrar(c), ex = m.fotosExtra, prodEx = ex.find(x => x.tipo === 'producto' && !x.porConfirmar) || ex.find(x => x.tipo === 'producto');
        const caja = m.imagen || '', ok = c.fotoEstado !== 'descartada';
        const cajaAuto = !caja && ok && (c.imagenMP || c.imagenWeb) ? (c.imagenMP ? { mp: c.imagenMP } : { web: c.imagenWeb }) : null;
        return { c, caja, cajaAuto, producto: prodEx ? prodEx.img || '' : '', otras: ex.filter(x => x !== prodEx).map(imgDe).filter(Boolean) };
    }
    /** Qué se escribe al guardar una foto. tipo: caja | producto | otra. Pura; error si ya hay 4 fotos adicionales. */
    function armarFotos(c, tipo, img, por, en) {
        const m = migrar(c); let imagen = m.imagen, ex = m.fotosExtra.slice();
        if (tipo === 'caja') imagen = img;
        else if (tipo === 'producto') {   /* cambia UNA foto del producto: la «por confirmar», o la primera; las demás se quedan */
            let k = ex.findIndex(x => x.tipo === 'producto' && x.porConfirmar); if (k < 0) k = ex.findIndex(x => x.tipo === 'producto');
            const nueva = { tipo: 'producto', img, por, en }; if (k >= 0) ex[k] = nueva; else ex.push(nueva);
        } else ex.push({ tipo: 'otra', img, por, en });
        if (ex.length > 4) return { error: 'Ya tiene 4 fotos adicionales: quita una en la ficha del producto antes de agregar otra.' };
        return { imagen, fotosExtra: ex };
    }
    /** Lista de pendientes: productos con stock (sin repetir por nombre o código) + los pedidos desde el computador. Puro.
        Un producto puede tener varias fichas en el catálogo (por código y por nombre): se miran todas.
        todo = true: TODO el catálogo (con y sin stock), primero los sin ninguna foto, después los que les falta una, al final los completos. */
    function catalogo(insumos, cat) { return pendientes(insumos, cat, true); }
    function pendientes(insumos, catalogo, todo) {
        const porCod = new Map(), porNom = new Map(), add = (m, k, c) => { const a = m.get(k) || []; if (!a.includes(c)) a.push(c); m.set(k, a); };
        (catalogo || []).forEach(c => { if (c.codigoMP) add(porCod, String(c.codigoMP), c); [c.descripcion, c.insumoName].forEach(n => { if (n) add(porNom, norm(n), c); }); });
        const fichas = (nombre, codigo) => { const r = []; ((codigo && porCod.get(String(codigo))) || []).concat(porNom.get(norm(nombre)) || []).forEach(c => { if (!r.includes(c)) r.push(c); }); return r; };
        /* Modelo de fotos del catálogo (v21.203, ficha-producto.js): `imagen` = CAJA / envase (o la de Convenio Marco / internet
           en imagenMP / imagenWeb); `fotosExtra` = [{tipo:'producto'|'otra', img, por, en}] = cómo es el PRODUCTO y otras.
           v21.240 alcanzó a guardar al revés (imagen = producto, imagenCaja = caja, fotosExtra = textos): esas fichas se leen
           con `legado()` y se corrigen solas al guardar la próxima foto (fotosV: 2). */
        const fila = (nombre, codigo, stock, bodegas, fs) => {
            const ca = fs.map(normal), cj = ca.find(x => x.caja), au = ca.find(x => x.cajaAuto), pr = ca.find(x => x.producto);
            const destino = (cj && cj.c) || (pr && pr.c) || (codigo && fs.find(c => String(c.codigoMP || '') === String(codigo))) || fs[0];   /* se guarda en la ficha que ya tiene fotos */
            const tieneProd = !!pr || fs.some(c => c.fotoProdDescartada), pedida = fs.some(c => c.fotoPedida);
            const otras = [].concat(...ca.map(x => x.otras));
            const hist = [].concat(...fs.map(c => Array.isArray(c.fotosHist) ? c.fotosHist : [])).sort((a, b) => String(b.en).localeCompare(String(a.en)));
            return { nombre, codigo: codigo ? String(codigo) : '', stock, bodegas, id: destino ? destino.__id : idCatalogo(nombre, codigo), ids: fs.map(c => c.__id), faltaProd: !tieneProd, faltaCaja: !(cj || au), pedida, imagen: pr ? pr.producto : '', caja: cj ? cj.caja : '', cajaAuto: au && !cj ? au.cajaAuto : '', extra: otras, comun: (fs.find(c => c.nombreComun) || {}).nombreComun || '', fabricante: (fs.find(c => c.fabricante) || {}).fabricante || '', hist, nivel: (tieneProd ? 1 : 0) + (cj || au ? 1 : 0) };
        };
        const prods = new Map();
        (insumos || []).forEach(i => { if (!i.name || i.status === 'ELIMINADO') return; const k = i.codigoMP ? 'c' + i.codigoMP : 'n' + norm(i.name); const p = prods.get(k) || { nombre: i.name, codigo: i.codigoMP ? String(i.codigoMP) : '', stock: 0, bodegas: new Set() }; p.stock += Number(i.quantity) || 0; if (i.location) p.bodegas.add(i.location); prods.set(k, p); });
        const out = [], vistos = new Set();
        prods.forEach(p => {
            const f = fila(p.nombre, p.codigo, p.stock, [...p.bodegas], fichas(p.nombre, p.codigo));
            f.ids.forEach(x => vistos.add(x));
            if (!todo && (!(p.stock > 0 || f.pedida) || !(f.faltaProd || f.faltaCaja || f.pedida))) return;
            out.push(f);
        });
        /* fichas del catálogo sin stock: en «todo» entran todas; en pendientes, solo las pedidas */
        (catalogo || []).forEach(c => { if ((!todo && !c.fotoPedida) || vistos.has(c.__id)) return; const n = c.descripcion || c.insumoName || c.__id, fs = fichas(n, c.codigoMP); fs.forEach(x => vistos.add(x.__id)); out.push(fila(n, c.codigoMP, 0, [], fs.length ? fs : [c])); });
        if (todo) return out.sort((a, b) => (a.nivel - b.nivel) || (b.pedida - a.pedida) || (b.stock - a.stock) || a.nombre.localeCompare(b.nombre, 'es'));   /* primero los que no tienen ninguna foto */
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
        const n = normal(c), yo = usuario(), ahora = new Date().toISOString(), r = armarFotos(c, tipo === 'extra' ? 'otra' : tipo, dataUrl, yo, ahora);
        if (r.error) throw new Error(r.error);
        const habia = tipo === 'producto' ? !!(n.producto || p.imagen) : tipo === 'caja' ? !!(n.caja || p.caja) : false;
        /* seguimiento: quién cambió qué foto y cuándo (sin guardar la foto anterior, para no pesar) */
        const hist = (Array.isArray(c.fotosHist) ? c.fotosHist : []).concat([{ tipo, accion: habia ? 'cambio' : 'nueva', por: yo, en: ahora, desde: /fotos\.html/.test(String(window.location && window.location.pathname)) ? 'teléfono' : 'computador' }]).slice(-30);
        const tieneProd = r.fotosExtra.some(x => x.tipo === 'producto') || p.faltaProd === false, tieneCaja = !!r.imagen || !!p.cajaAuto || p.faltaCaja === false;
        const completo = tieneProd && tieneCaja;
        await f.setDoc(ref, { ...base, imagen: r.imagen || '', imagenCaja: '', fotosExtra: r.fotosExtra, fotosV: 2, fotoPedida: !!(c.fotoPedida && !completo), fotosPor: yo, fotosEn: ahora, fotosHist: hist, actualizado: f.serverTimestamp ? f.serverTimestamp() : ahora }, { merge: true });
        if (completo) for (const otro of (p.ids || []).filter(x => x && x !== p.id)) { try { await f.setDoc(f.doc(f.collection(db(), 'Catalogo_Productos'), otro), { fotoPedida: false }, { merge: true }); } catch (e) { /* la otra ficha queda pedida */ } }
        const nn = normal({ imagen: r.imagen, fotosExtra: r.fotosExtra, fotosV: 2 });
        return { caja: nn.caja, producto: nn.producto, otras: nn.otras, fotosHist: hist };
    }
    /** Pasa una ficha de v21.240 al modelo de la casa (la llama la ficha del producto antes de escribir). */
    const porMigrar = (c) => !!c && (legado(c) || (Array.isArray(c.fotosExtra) && c.fotosExtra.some(x => typeof x === 'string')));
    async function migrarFicha(id, c) { if (!porMigrar(c)) return c; const f = fs(), m = migrar(c); await f.setDoc(f.doc(f.collection(db(), 'Catalogo_Productos'), id), { imagen: m.imagen, imagenCaja: '', fotosExtra: m.fotosExtra, fotosV: 2 }, { merge: true }); return { ...c, imagen: m.imagen, imagenCaja: '', fotosExtra: m.fotosExtra, fotosV: 2 }; }
    /** Quita el pedido de fotos en todas las fichas del producto. */
    async function quitarPedido(p) { const f = fs(); for (const id of new Set([...(p.ids || []), p.id, idCatalogo(p.nombre, p.codigo)].filter(Boolean))) await f.setDoc(f.doc(f.collection(db(), 'Catalogo_Productos'), id), { fotoPedida: false }, { merge: true }); }
    /** Desde el computador: deja el producto en la lista del teléfono. */
    async function pedir(nombre, codigo, idFicha) {
        const f = fs(), id = idFicha || idCatalogo(nombre, codigo), ref = f.doc(f.collection(db(), 'Catalogo_Productos'), id), sn = await f.getDoc(ref), c = sn.exists() ? sn.data() : {};
        await f.setDoc(ref, { descripcion: c.descripcion || nombre, descripcion_lower: String(c.descripcion || nombre).toLowerCase(), insumoName: c.insumoName || nombre, codigoMP: c.codigoMP || String(codigo || ''), fotoPedida: true, fotoPedidaPor: usuario(), fotoPedidaEn: new Date().toISOString() }, { merge: true });
        return URL_FOTOS();
    }
    /** Ventana en el computador: link para abrir en el teléfono (copiar o QR) y aviso de que quedó pedido. */
    async function qrSVG(url, tam) {
        try { if (window.SAR_Bultos && window.SAR_Bultos.cargarQR) { await window.SAR_Bultos.cargarQR(); const m = window.SAR_Bultos.matrizQR(url), n = m.length, c = 5; return `<svg viewBox="0 0 ${n * c} ${n * c}" width="${tam || 180}" height="${tam || 180}" role="img" aria-label="QR para abrir en el teléfono"><rect width="100%" height="100%" fill="#fff"/>${m.map((f, r) => f.map((on, k) => on ? `<rect x="${k * c}" y="${r * c}" width="${c}" height="${c}"/>` : '').join('')).join('')}</svg>`; } } catch (e) { /* sin QR */ }
        return '';
    }
    async function mostrarLink(nombre) {
        const url = URL_FOTOS(), P = window.SAR_Progreso;
        const qr = await qrSVG(url);
        const texto = `${nombre ? `<b>${esc(nombre)}</b> quedó en la lista de fotos pendientes.<br>` : ''}Abre este enlace en el teléfono (o escanea el QR) y déjalo como acceso directo (ícono naranjo con cámara, «Fotos SAR»).`, bloque = `<div class="ft-link">${qr}<input class="form-control" readonly value="${esc(url)}" onclick="this.select()"></div>`;
        if (P && P.confirmar) { const ok = await P.confirmar({ titulo: 'Fotos desde el teléfono', texto, bloque, si: 'Copiar enlace', no: 'Cerrar' }); if (ok) { try { await navigator.clipboard.writeText(url); toast('Enlace copiado', 'Pégalo en WhatsApp o en el navegador del teléfono.', 'success'); } catch (e) { toast('Enlace', url, 'info'); } } }
    }

    // ---------------- página del teléfono (fotos.html) ----------------
    const fechaCorta = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); };
    const QUE = { producto: 'foto del producto', caja: 'foto de la caja', extra: 'otra foto' };
    const ultimo = (p) => { const h = p.hist && p.hist[0]; return h ? `${h.accion === 'cambio' ? 'Cambió' : 'Subió'} la ${QUE[h.tipo] || 'foto'} ${esc(String(h.por || '').split('@')[0])} · ${esc(fechaCorta(h.en))}` : ''; };
    const srcProd = (p) => p.imagen || '';
    const srcCaja = (p) => p.caja || (p.cajaAuto ? (p.cajaAuto.web || (window.SAR_Imagenes && window.SAR_Imagenes.urlMP ? window.SAR_Imagenes.urlMP(p.cajaAuto.mp, 320) : '')) : '');
    function pagina(main) {
        let lista = [], q = '', filtro = 'todo', modo = 'pend', datos = null, tope = 60;
        const cargandoHTML = (t) => window.SAR_Progreso && window.SAR_Progreso.cargando ? window.SAR_Progreso.cargando(t) : `<p class="ft-nada">${esc(t)}</p>`;
        const caja = (p, t, ok, img, ico, txtOk, txt) => `<label class="ft-f${ok ? ' ok' : ''}${t === 'extra' ? ' ft-mas' : ''}">${img ? `<img src="${esc(img)}" alt="">` : `<i class="ph-bold ${ico} ft-ico" aria-hidden="true"></i>`}<span>${ok ? txtOk : txt}</span><input type="file" accept="image/*" capture="environment" data-t="${t}" hidden></label>`;
        /* el buscador se dibuja una sola vez; al escribir solo cambia la lista (no se pierde el teclado ni las letras) */
        main.innerHTML = `<div class="ft-wrap"><div class="ft-modo" role="tablist" aria-label="Qué mostrar"><button type="button" role="tab" data-m="pend" aria-selected="true" class="on">Pendientes</button><button type="button" role="tab" data-m="todo" aria-selected="false">Todo el catálogo</button></div><div class="ft-barra"><input type="search" class="form-control" id="ft-q" placeholder="Buscar producto…" autocomplete="off" aria-label="Buscar producto"></div><div class="ft-chips" id="ft-chips"></div><div id="ft-lista" aria-live="polite">${cargandoHTML('Buscando los productos sin fotos…')}</div></div>`;
        const armar = () => { lista = datos ? (modo === 'todo' ? catalogo(datos.ins, datos.cat) : pendientes(datos.ins, datos.cat)) : []; tope = 60; };
        main.querySelector('.ft-modo').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b || b.dataset.m === modo) return; modo = b.dataset.m; main.querySelectorAll('.ft-modo [data-m]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); }); filtro = 'todo'; armar(); pintar(); });
        const iq = main.querySelector('#ft-q'), chips = main.querySelector('#ft-chips'), cont = main.querySelector('#ft-lista');
        const pintar = () => {
            const t = norm(q), vis = lista.filter(p => (!t || t.split(' ').every(w => norm(p.nombre + ' ' + p.codigo + ' ' + p.comun).includes(w))) && (filtro === 'todo' || (filtro === 'prod' && p.faltaProd) || (filtro === 'caja' && p.faltaCaja) || (filtro === 'pedidas' && p.pedida) || (filtro === 'nada' && p.nivel === 0) || (filtro === 'completos' && p.nivel === 2)));
            chips.innerHTML = [['todo', 'Todos', lista.length], ...(modo === 'todo' ? [['nada', 'Sin ninguna foto', lista.filter(p => p.nivel === 0).length], ['completos', 'Completos', lista.filter(p => p.nivel === 2).length]] : []), ['pedidas', 'Pedidas', lista.filter(p => p.pedida).length], ['prod', 'Sin foto del producto', lista.filter(p => p.faltaProd).length], ['caja', 'Sin foto de la caja', lista.filter(p => p.faltaCaja).length]].map(([k, n, c]) => `<button type="button" class="ft-chip${filtro === k ? ' on' : ''}" data-f="${k}" aria-pressed="${filtro === k}">${n} <b>${c}</b></button>`).join('');
            cont.innerHTML = vis.length ? vis.slice(0, tope).map(p => `<article class="ft-p" data-i="${lista.indexOf(p)}">
                <header><b>${esc(p.nombre)}</b><small>${p.codigo ? 'ID ' + esc(p.codigo) + ' · ' : ''}${p.stock ? p.stock + ' u. · ' : ''}${esc(p.bodegas.join(', '))}${p.pedida ? ' · <span class="ft-ped">pedida</span>' : ''}</small>${ultimo(p) ? `<small class="ft-ult"><i class="ph-bold ph-clock-counter-clockwise" aria-hidden="true"></i> ${ultimo(p)}</small>` : ''}</header>
                <div class="ft-fotos">${caja(p, 'producto', !p.faltaProd, srcProd(p), 'ph-camera', 'Producto listo · cambiar', 'Foto del producto')}${caja(p, 'caja', !p.faltaCaja, srcCaja(p), 'ph-package', 'Caja lista · cambiar', 'Foto de la caja')}${caja(p, 'extra', false, p.extra[p.extra.length - 1], 'ph-plus', '', 'Otra foto' + (p.extra.length ? ` (${p.extra.length})` : ''))}</div></article>`).join('')
                : `<p class="ft-nada">${lista.length ? 'Nada coincide.' : 'Todo al día: no hay productos sin fotos.'}</p>`;
            if (vis.length > tope) cont.insertAdjacentHTML('beforeend', `<button type="button" class="btn btn-outline ft-mas-btn" data-mas="1">Ver ${Math.min(60, vis.length - tope)} más (${vis.length - tope} restantes)</button>`);
        };
        iq.addEventListener('input', () => { q = iq.value; tope = 60; pintar(); });
        cont.addEventListener('click', (e) => { if (e.target.closest('[data-mas]')) { tope += 60; pintar(); } });
        chips.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { filtro = b.dataset.f; tope = 60; pintar(); } });
        cont.addEventListener('change', async (e) => {
            const inp = e.target; if (!inp || inp.type !== 'file') return;
            const art = inp.closest('.ft-p'), p = lista[Number(art.dataset.i)], fi = inp.files && inp.files[0]; if (!fi || !p) return;
            const lab = inp.closest('.ft-f'); lab.classList.add('ft-sub');
            try { const d = await achicar(fi, inp.dataset.t === 'producto' ? 480 : 360), c = await guardarFoto(p, inp.dataset.t, d); p.imagen = c.producto || p.imagen; p.caja = c.caja || p.caja; p.extra = c.otras; p.hist = [(c.fotosHist || []).slice(-1)[0]].filter(Boolean).concat(p.hist || []); p.faltaProd = p.faltaProd && !p.imagen; p.faltaCaja = !p.caja && !p.cajaAuto; p.nivel = (p.faltaProd ? 0 : 1) + (p.faltaCaja ? 0 : 1); if (!p.faltaProd && !p.faltaCaja) p.pedida = false; toast('Foto guardada', `${p.nombre.slice(0, 40)} · ${inp.dataset.t === 'producto' ? 'producto' : inp.dataset.t === 'caja' ? 'caja' : 'otra foto'}`, 'success'); pintar(); }
            catch (x) { lab.classList.remove('ft-sub'); toast('No se guardó', (x && x.message) || String(x), 'error'); }
        });
        return leer().then((d) => { datos = d; armar(); pintar(); }).catch(e => { cont.innerHTML = `<p class="ft-nada">No se pudo cargar: ${esc(e.message || e)}</p>`; });
    }
    // ---------------- sección del Visor (solo superadministrador): enlaces, todo el catálogo y seguimiento ----------------
    const esSuper = () => String((document.body && document.body.dataset.userRole) || '').toLowerCase() === 'superadmin';
    const ENLACES = () => [
        { t: 'Visor Logístico', d: 'El sistema completo, para el computador.', url: new URL('./', window.location.href).href.replace(/#.*$/, ''), ico: 'assets/icon-192.png' },
        { t: 'Pedir insumos', d: 'Para que los servicios pidan insumos desde el teléfono.', url: new URL('solicitar.html', window.location.href).href, ico: 'assets/icon-pedidos-192.png' },
        { t: 'Fotos SAR', d: 'Para sacar y cambiar fotos de productos y cajas (solo superadministrador).', url: URL_FOTOS(), ico: 'assets/icon-fotos-192.png' }];
    async function abrirVista(root) {
        if (!root) return;
        if (!esSuper()) { root.innerHTML = '<p class="act-hint">Solo el superadministrador puede administrar las fotos.</p>'; return; }
        let datos = null, lista = [], filtro = 'nada', q = '', tab = 'cat', tope = 48;
        const cargandoHTML = (t) => window.SAR_Progreso && window.SAR_Progreso.cargando ? window.SAR_Progreso.cargando(t) : `<p class="act-hint">${esc(t)}</p>`;
        root.innerHTML = `<div class="fv">
          <div class="fv-cab"><div><h2>Fotos de productos</h2><p class="act-hint">Cada producto debe tener la foto del producto y la de la caja. Aquí ves todo el catálogo, pides fotos al teléfono y revisas quién cambió qué.</p></div></div>
          <h3 class="fv-h">Accesos directos para el teléfono</h3>
          <div class="fv-links" id="fv-links">${ENLACES().map((x, i) => `<article class="fv-link"><img src="${esc(x.ico)}" alt="" width="48" height="48"><div class="fv-link-t"><b>${esc(x.t)}</b><small>${esc(x.d)}</small><input class="form-control" readonly value="${esc(x.url)}" aria-label="Enlace de ${esc(x.t)}" onclick="this.select()"></div><div class="fv-link-b"><button type="button" class="btn btn-outline btn-sm" data-qr="${i}"><i class="ph-bold ph-qr-code" aria-hidden="true"></i> QR</button><button type="button" class="btn btn-outline btn-sm" data-copiar="${i}"><i class="ph-bold ph-copy" aria-hidden="true"></i> Copiar</button></div></article>`).join('')}</div>
          <div class="fv-tabs" role="tablist"><button type="button" role="tab" class="on" aria-selected="true" data-tab="cat">Catálogo</button><button type="button" role="tab" aria-selected="false" data-tab="seg">Seguimiento de cambios</button><button type="button" class="btn btn-outline btn-sm fv-rec" data-recargar="1"><i class="ph-bold ph-arrows-clockwise" aria-hidden="true"></i> Actualizar</button></div>
          <div id="fv-cuerpo">${cargandoHTML('Cargando el catálogo y sus fotos…')}</div></div>`;
        const cuerpo = root.querySelector('#fv-cuerpo');
        const thumb = (src, alt, ico) => src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : `<span class="fv-sin"><i class="ph-bold ${ico}" aria-hidden="true"></i>Falta</span>`;
        const estado = (p) => p.nivel === 2 ? '<span class="fv-est fv-ok"><i class="ph-bold ph-check-circle" aria-hidden="true"></i> Completo</span>' : p.nivel === 0 ? '<span class="fv-est fv-no"><i class="ph-bold ph-image-broken" aria-hidden="true"></i> Sin fotos</span>' : `<span class="fv-est fv-med"><i class="ph-bold ph-warning-circle" aria-hidden="true"></i> Falta ${p.faltaProd ? 'el producto' : 'la caja'}</span>`;
        function pintarCat() {
            const t = norm(q), cuenta = (f) => lista.filter(f).length;
            const F = { nada: p => p.nivel === 0, prod: p => p.faltaProd, caja: p => p.faltaCaja, pedidas: p => p.pedida, completos: p => p.nivel === 2, todo: () => true };
            const vis = lista.filter(p => F[filtro](p) && (!t || t.split(' ').every(w => norm(p.nombre + ' ' + p.codigo + ' ' + p.comun).includes(w))));
            cuerpo.innerHTML = `<div class="fv-barra"><input type="search" class="form-control" id="fv-q" placeholder="Buscar por nombre, ID o nombre común…" value="${esc(q)}" aria-label="Buscar en el catálogo"></div>
              <div class="fv-chips">${[['nada', 'Sin ninguna foto', F.nada], ['prod', 'Sin foto del producto', F.prod], ['caja', 'Sin foto de la caja', F.caja], ['pedidas', 'Pedidas al teléfono', F.pedidas], ['completos', 'Completos', F.completos], ['todo', 'Todo el catálogo', F.todo]].map(([k, n, f]) => `<button type="button" class="ft-chip${filtro === k ? ' on' : ''}" data-f="${k}" aria-pressed="${filtro === k}">${n} <b>${cuenta(f)}</b></button>`).join('')}</div>
              <div class="fv-grid">${vis.slice(0, tope).map(p => `<article class="fv-p" data-i="${lista.indexOf(p)}">
                <div class="fv-fotos"><label class="fv-f" tabindex="0" title="Cambiar la foto del producto">${thumb(srcProd(p), 'Producto', 'ph-camera')}<span>Producto</span><input type="file" accept="image/*" data-t="producto" hidden></label><label class="fv-f" tabindex="0" title="Cambiar la foto de la caja">${thumb(srcCaja(p), 'Caja', 'ph-package')}<span>Caja</span><input type="file" accept="image/*" data-t="caja" hidden></label></div>
                <div class="fv-txt"><b>${esc(p.nombre)}</b><small>${p.codigo ? 'ID ' + esc(p.codigo) + ' · ' : ''}${p.stock ? p.stock + ' u.' : 'sin stock'}${p.extra.length ? ` · ${p.extra.length} foto${p.extra.length > 1 ? 's' : ''} más` : ''}</small>${estado(p)}${ultimo(p) ? `<small class="ft-ult">${ultimo(p)}</small>` : ''}</div>
                <button type="button" class="btn btn-sm btn-outline" data-pedir="1">${p.pedida ? '<i class="ph-bold ph-x" aria-hidden="true"></i> Quitar pedido' : '<i class="ph-bold ph-device-mobile-camera" aria-hidden="true"></i> Pedir al teléfono'}</button></article>`).join('') || '<p class="act-hint">Nada coincide con este filtro.</p>'}</div>
              ${vis.length > tope ? `<button type="button" class="btn btn-outline fv-mas" data-mas="1">Ver más (${vis.length - tope} restantes)</button>` : ''}`;
            const iq = cuerpo.querySelector('#fv-q'); iq.oninput = () => { q = iq.value; tope = 48; const pos = iq.selectionStart; pintarCat(); const n = cuerpo.querySelector('#fv-q'); n.focus(); n.setSelectionRange(pos, pos); };
            if (window.SAR_Imagenes && window.SAR_Imagenes.rellenar) window.SAR_Imagenes.rellenar(cuerpo);
        }
        function pintarSeg() {
            const filas = [].concat(...lista.map(p => (p.hist || []).map(h => ({ ...h, nombre: p.nombre })))).sort((a, b) => String(b.en).localeCompare(String(a.en))).slice(0, 150);
            cuerpo.innerHTML = filas.length ? `<div class="table-responsive"><table class="erp-table fv-tabla"><thead><tr><th>Fecha</th><th>Producto</th><th>Foto</th><th>Qué pasó</th><th>Quién</th><th>Desde</th></tr></thead><tbody>${filas.map(h => `<tr><td>${esc(fechaCorta(h.en))}</td><td>${esc(h.nombre)}</td><td>${esc(QUE[h.tipo] || h.tipo)}</td><td>${h.accion === 'cambio' ? 'Cambió la foto' : 'Subió foto nueva'}</td><td>${esc(h.por || '')}</td><td>${esc(h.desde || '')}</td></tr>`).join('')}</tbody></table></div>`
                : '<p class="act-hint">Todavía no hay cambios de fotos registrados. Desde esta versión, cada foto nueva o cambiada queda anotada aquí con quién y cuándo.</p>';
        }
        const pintar = () => tab === 'seg' ? pintarSeg() : pintarCat();
        const cargar = () => { cuerpo.innerHTML = cargandoHTML('Cargando el catálogo y sus fotos…'); return leer().then(d => { datos = d; lista = catalogo(d.ins, d.cat); if (!lista.some(p => p.nivel === 0) && filtro === 'nada') filtro = 'todo'; pintar(); }).catch(e => { cuerpo.innerHTML = `<p class="act-hint">No se pudo cargar: ${esc(e.message || e)}</p>`; }); };
        root.onclick = async (e) => {
            const b = e.target.closest('button'); if (!b) return;
            if (b.dataset.qr != null || b.dataset.copiar != null) { const x = ENLACES()[Number(b.dataset.qr != null ? b.dataset.qr : b.dataset.copiar)];
                if (b.dataset.copiar != null) { try { await navigator.clipboard.writeText(x.url); toast('Enlace copiado', x.t, 'success'); } catch (er) { toast('Enlace', x.url, 'info'); } return; }
                const P = window.SAR_Progreso; if (P && P.confirmar) P.confirmar({ titulo: x.t, texto: 'Escanéalo con la cámara del teléfono y guárdalo en la pantalla de inicio (Compartir → Agregar a inicio).', bloque: `<div class="ft-link">${await qrSVG(x.url, 220)}<input class="form-control" readonly value="${esc(x.url)}" onclick="this.select()"></div>`, si: 'Cerrar', soloSi: true }); return; }
            if (b.dataset.tab) { tab = b.dataset.tab; root.querySelectorAll('[data-tab]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); }); pintar(); return; }
            if (b.dataset.recargar) { cargar(); return; }
            if (b.dataset.f) { filtro = b.dataset.f; tope = 48; pintarCat(); return; }
            if (b.dataset.mas) { tope += 48; pintarCat(); return; }
            if (b.dataset.pedir) { const p = lista[Number(b.closest('.fv-p').dataset.i)]; if (!p) return; b.disabled = true;
                try { if (p.pedida) { await quitarPedido(p); p.pedida = false; toast('Pedido quitado', p.nombre.slice(0, 40), 'success'); } else { await pedir(p.nombre, p.codigo, p.id); p.pedida = true; toast('Pedido al teléfono', p.nombre.slice(0, 40), 'success'); } pintarCat(); }
                catch (er) { b.disabled = false; toast('No se pudo', (er && er.message) || String(er), 'error'); } }
        };
        root.onkeydown = (e) => { const l = e.target.closest && e.target.closest('label.fv-f'); if (l && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const i = l.querySelector('input[type=file]'); if (i) i.click(); } };
        root.onchange = async (e) => {
            const inp = e.target; if (!inp || inp.type !== 'file') return;
            const p = lista[Number(inp.closest('.fv-p').dataset.i)], fi = inp.files && inp.files[0]; if (!p || !fi) return;
            const lab = inp.closest('.fv-f'); lab.classList.add('ft-sub');
            try { const d = await achicar(fi, inp.dataset.t === 'producto' ? 480 : 360), c = await guardarFoto(p, inp.dataset.t, d); p.imagen = c.producto || p.imagen; p.caja = c.caja || p.caja; p.extra = c.otras; p.hist = [(c.fotosHist || []).slice(-1)[0]].filter(Boolean).concat(p.hist || []); p.faltaProd = p.faltaProd && !p.imagen; p.faltaCaja = !p.caja && !p.cajaAuto; p.nivel = (p.faltaProd ? 0 : 1) + (p.faltaCaja ? 0 : 1); if (p.nivel === 2) p.pedida = false; toast('Foto guardada', p.nombre.slice(0, 40), 'success'); if (window.SAR_Imagenes && window.SAR_Imagenes.recargar) window.SAR_Imagenes.recargar(); pintarCat(); }
            catch (er) { lab.classList.remove('ft-sub'); toast('No se guardó', (er && er.message) || String(er), 'error'); }
        };
        return cargar();
    }
    /* en el Visor: «Pedir al teléfono» en Editar insumo, foto de la caja junto a la del producto y «Fotos desde el teléfono» en Accesos */
    if (document && document.addEventListener && !/fotos\.html/.test(String(window.location && window.location.pathname))) {
        document.addEventListener('click', async (e) => {
            const t = e.target.closest && e.target.closest('#edit-foto-tel, [data-fotos-tel]'); if (!t) return;
            e.preventDefault();
            if (!esSuper()) { toast('Solo superadministrador', 'Pedir y cambiar fotos lo hace el superadministrador.', 'warning'); return; }
            if (t.id === 'edit-foto-tel') { const n = (document.getElementById('edit-name') || {}).value || '', c = (document.getElementById('edit-codigoMP') || {}).value || ''; if (!n.trim()) return; try { await pedir(n.trim(), c.trim()); if (window.SAR_Imagenes && window.SAR_Imagenes.recargar) window.SAR_Imagenes.recargar(); mostrarLink(n.trim()); } catch (x) { toast('No se pudo', (x && x.message) || String(x), 'error'); } }
            else { const m = document.querySelector('#app-sidebar .menu-item[data-target="view-fotos"]'); if (m) m.click(); else mostrarLink(''); }
        });
        const verCaja = () => { const el = document.getElementById('edit-foto-caja'), n = (document.getElementById('edit-name') || {}).value || ''; if (!el || !window.SAR_Imagenes || !window.SAR_Imagenes.fotos) return; const f = window.SAR_Imagenes.fotos(n, (document.getElementById('edit-codigoMP') || {}).value || ''); el.innerHTML = f.producto ? `<img src="${esc(f.producto)}" alt="Cómo es el producto">` : ''; el.title = f.producto ? 'Foto de cómo es el producto' : 'Sin foto de cómo es el producto: usa «Pedir al teléfono»';   /* la foto de arriba (imagen) es la de la caja */; };
        const verCaja0 = verCaja;   /* espera a que el catálogo de fotos esté cargado */
        window.__ftVerCaja = () => { const I = window.SAR_Imagenes; if (I && I.cargar) I.cargar().then(verCaja0).catch(() => {}); else verCaja0(); };
    }
    window.SAR_FotosTel = { migrarFicha, porMigrar, legado, abrirVista, catalogo, quitarPedido, verCaja: () => { if (window.__ftVerCaja) window.__ftVerCaja(); }, achicar, pendientes, guardarFoto, pedir, mostrarLink, pagina, idCatalogo, URL_FOTOS };
    if (typeof module !== 'undefined') module.exports = { pendientes, catalogo, idCatalogo, normal, migrar, armarFotos, legado };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : null);
