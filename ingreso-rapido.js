/* ==========================================================================
   INGRESO RÁPIDO (v21.04) — inventariar una bodega (p. ej. el camión) de una sola vez
   --------------------------------------------------------------------------
   Se elige o crea la bodega, se pega la lista (desde Excel, WhatsApp o lo que lea una
   foto) o se escribe fila por fila, se revisa en una tabla editable y se confirma.
   Cada producto entra con ID, lote, vencimiento e historial (INGRESO_INVENTARIO), se
   ve en todo el sistema (origenOC) y el nombre + ID quedan en el catálogo.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const esc = (s) => (window.escapeHTML ? window.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
    const num = (v) => Number(String(v == null ? '' : v).replace(',', '.')) || 0;
    const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const pad = (n) => String(n).padStart(2, '0');
    const root = () => document.getElementById('irp-root');
    const usuario = () => (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || 'Usuario';
    const rol = () => String(document.body.dataset.userRole || '').toLowerCase();
    const puede = () => ['admin', 'administrador', 'global', 'superadmin', 'bodega', 'administrador_bodega', 'bodeguero'].includes(rol()) || rol() === '';

    let bodegas = [], catalogo = [], filas = [], bodegaSel = '', cfg = null, ocRef = '';
    const filaVacia = () => ({ nombre: '', codigo: '', cantidad: '', lote: '', vence: '', dudas: '' });

    /** Fecha flexible -> AAAA-MM-DD ('' si no se entiende). Mes/año => último día del mes. */
    function fecha(t) {
        t = String(t || '').trim(); if (!t || /^n\/?a$/i.test(t) || t === '-') return '';
        let m;
        if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
        if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(+m[2])}-${pad(+m[1])}`; }
        if ((m = t.match(/^(\d{1,2})[-/.](\d{4}|\d{2})$/))) { const y = m[2].length === 2 ? 2000 + +m[2] : +m[2], u = new Date(y, +m[1], 0).getDate(); return `${y}-${pad(+m[1])}-${pad(u)}`; }
        return '';
    }
    /** Texto pegado -> filas. Acepta tabulador, ; o , ; con o sin encabezado. Orden: producto, [ID], cantidad, lote, vence. */
    function parsear(texto) {
        const lineas = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean); if (!lineas.length) return [];
        const sep = lineas.some(l => l.includes('\t')) ? '\t' : (lineas.some(l => l.includes(';')) ? ';' : ',');
        const cel = (l) => l.split(sep).map(x => x.trim().replace(/^"|"$/g, ''));
        let mapa = null;
        const h = cel(lineas[0]).map(norm);
        if (h.some(x => /^(producto|descripcion|nombre|insumo)/.test(x)) && h.some(x => /^(cant|stock|unidades)/.test(x))) {
            mapa = {}; h.forEach((x, i) => { if (/^(producto|descripcion|nombre|insumo)/.test(x)) mapa.nombre = i; else if (/^(id|codigo|cod)/.test(x)) mapa.codigo = i; else if (/^(cant|stock|unidades)/.test(x)) mapa.cantidad = i; else if (/^lote/.test(x)) mapa.lote = i; else if (/^(venc|expira)/.test(x)) mapa.vence = i; });
            lineas.shift();
        }
        return lineas.map(l => {
            const c = cel(l);
            if (mapa) return { nombre: c[mapa.nombre] || '', codigo: String(c[mapa.codigo] || '').replace(/\D/g, ''), cantidad: c[mapa.cantidad] || '', lote: c[mapa.lote] || '', vence: fecha(c[mapa.vence]) };
            const conId = /^\d{4,9}$/.test(c[1] || '');
            return conId ? { nombre: c[0] || '', codigo: c[1], cantidad: c[2] || '', lote: c[3] || '', vence: fecha(c[4]) } : { nombre: c[0] || '', codigo: '', cantidad: c[1] || '', lote: c[2] || '', vence: fecha(c[3]) };
        }).filter(f => f.nombre || f.cantidad);
    }
    const codDe = (n) => { const x = norm(n); const c = catalogo.find(e => e.codigoMP && (norm(e.insumoName) === x || norm(e.descripcion) === x)); return c ? String(c.codigoMP) : ''; };
    const nomDe = (cod) => { const c = catalogo.find(e => String(e.codigoMP) === String(cod)); return c ? String(c.descripcion || c.insumoName || '').toUpperCase() : ''; };

    async function cargarDatos() {
        const f = fs();
        const [b, c] = await Promise.all([f.getDocs(f.collection(db(), 'Bodegas')), f.getDocs(f.query(f.collection(db(), 'Catalogo_Productos'), f.limit(3000))).catch(() => null)]);
        bodegas = []; b.forEach(d => { const x = d.data(); if (x.isActive !== false) bodegas.push({ id: d.id, name: x.name || '' }); }); bodegas.sort((a, z) => a.name.localeCompare(z.name, 'es'));
        catalogo = []; if (c) c.forEach(d => catalogo.push({ id: d.id, ...d.data() }));
        try { const s = await f.getDoc(f.doc(f.collection(db(), 'Config_Correo'), 'principal')); cfg = s.exists() ? s.data() : null; } catch (e) { cfg = null; }
    }

    /** Reduce la foto (lado mayor 1600 px, JPEG) para enviarla rápido; devuelve base64 sin cabecera. */
    function reducir(file) {
        return new Promise((ok, mal) => {
            const url = URL.createObjectURL(file), im = new Image();
            im.onload = () => { const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.82).split(',')[1]); };
            im.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No pude abrir la foto ' + file.name)); };
            im.src = url;
        });
    }
    /** Lee las fotos con el Apps Script (API de Claude) y agrega los productos a la tabla para revisar. */
    async function leerFotos(files) {
        if (!cfg || !cfg.webhookUrl || !cfg.token) { toast('Falta conectar el script', 'Configura primero la URL y el token en Seguimiento de OC → Configurar correo.', 'warning'); return; }
        const lista = Array.from(files).filter(f => /^image\//.test(f.type)); if (!lista.length) return;
        const prog = window.SAR_Progreso.iniciar(`Leyendo ${lista.length} foto(s)…`, ['Preparando las fotos…']);
        try {
            const fotos = []; for (let i = 0; i < lista.length; i++) { prog.paso(`Preparando la foto ${i + 1} de ${lista.length}…`); fotos.push(await reducir(lista[i])); }
            const encontrados = [];
            for (let i = 0; i < fotos.length; i += 4) {
                prog.paso(`Leyendo fotos ${i + 1}–${Math.min(i + 4, fotos.length)} de ${fotos.length}…`);
                const r = await fetch(cfg.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: cfg.token, accion: 'foto', fotos: fotos.slice(i, i + 4) }) });
                const j = await r.json();
                if (!j.ok) throw new Error(j.error === 'sin_clave' ? 'SIN_CLAVE' : (j.error === 'token' ? 'El token del script no coincide.' : String(j.error || 'respuesta no válida')));
                (j.productos || []).forEach(p => encontrados.push(p));
            }
            const mapa = new Map();
            encontrados.forEach(p => {
                const nombre = String(p.nombre || '').trim().toUpperCase(); if (!nombre) return;
                const art = String(p.art || '').trim(), n = nombre + (art && !nombre.includes(art.toUpperCase()) ? ` (ART ${art.toUpperCase()})` : '');
                const k = norm(n) + '|' + String(p.lote || '').trim().toUpperCase(), cajas = Math.floor(num(p.cajas)) || 0, previo = mapa.get(k);
                if (previo) { previo.cantidad = String(Math.max(num(previo.cantidad), cajas) || ''); if (p.dudas) previo.dudas = (previo.dudas ? previo.dudas + ' · ' : '') + p.dudas; return; }
                mapa.set(k, { nombre: n, codigo: codDe(n) || codDe(nombre), cantidad: cajas ? String(cajas) : '', lote: String(p.lote || '').trim().toUpperCase(), vence: fecha(p.vence) || '', dudas: [p.dudas, p.contenido ? 'Contenido: ' + p.contenido : '', p.barras ? 'Barras: ' + p.barras : ''].filter(Boolean).join(' · ') });
            });
            const nuevas = [...mapa.values()]; filas = filas.filter(x => x.nombre.trim() || x.cantidad).concat(nuevas);
            prog.listo(nuevas.length ? `${nuevas.length} producto(s) leídos: revisa la tabla antes de ingresar` : 'No encontré productos en las fotos');
            pintar();
        } catch (e) {
            prog.error();
            if (e.message === 'SIN_CLAVE') toast('Falta la clave de lectura', 'Hay que guardar la clave de la API en el Apps Script (te explico el paso en la conversación).', 'warning');
            else toast('No se pudieron leer las fotos', (e.message || String(e)).includes('Failed to fetch') ? 'No se pudo conectar con el script (¿acceso público y versión nueva publicada?).' : (e.message || String(e)), 'error');
        }
    }

    function pintar() {
        const r = root(); if (!r) return;
        const v = validar();
        r.innerHTML = `
        <div class="erp-card"><h2>Ingreso rápido de inventario</h2>
            <p class="act-hint">Para inventariar una bodega de una sola vez (por ejemplo el camión). Elige la bodega, pega la lista o escríbela, revisa y confirma. Cada producto queda con ID, lote y vencimiento, y se ve en todo el sistema.</p>
            <div class="act-fila"><select id="irp-b" aria-label="Bodega de destino"><option value="">— Elige la bodega de destino —</option>${bodegas.map(b => `<option value="${esc(b.name)}" ${b.name === bodegaSel ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
                <button type="button" class="btn btn-outline" id="irp-nb">+ Nueva bodega</button></div>
            <div class="act-fila"><input id="irp-oc" value="${esc(ocRef)}" placeholder="N° de orden de compra de origen (opcional, p. ej. 1298355-641-AG26)" autocomplete="off"></div>
            <p class="act-hint">Si estos productos ya llegaron con una orden, anota aquí su número: queda en el historial. Ojo: en esa orden registra la recepción <b>sin marcar "Ingresar al stock"</b>, para que el stock no se cuente dos veces (aquí es donde entra al stock del centro).</p></div>
        <div class="erp-card"><h3>Lista de productos <span class="soc-n">${filas.length}</span></h3>
            <div class="irp-foto"><label class="btn btn-primary irp-foto__b"><i class="ph-bold ph-camera"></i> Leer desde fotos<input type="file" id="irp-fotos" accept="image/*" multiple capture="environment" hidden></label>
                <small>Saca o elige fotos de las cajas (la cara con nombre, lote y vencimiento). Se leen solas y quedan en la tabla para que las revises. Hasta ~20 fotos por vez.</small></div>
            <details class="soc-det"><summary><strong>Pegar una lista</strong> (desde Excel, o lo que leí de una foto)</summary>
                <p class="act-hint">Una línea por producto: <b>producto ; ID ; cantidad ; lote ; vencimiento</b> (el ID, el lote y el vencimiento son opcionales; separa con tabulador, punto y coma o coma).</p>
                <textarea id="irp-txt" rows="6" placeholder="VENDA FIXOMULL ADHESIVA 10CM X 10M ; 3016531 ; 12 ; L2405 ; 03/2027"></textarea>
                <button type="button" class="btn btn-outline" id="irp-pegar">Agregar a la tabla</button></details>
            <datalist id="irp-dl">${catalogo.slice(0, 1500).map(c => `<option value="${esc(String(c.descripcion || c.insumoName || '').toUpperCase())}">`).join('')}</datalist>
            <div class="irp-tabla"><div class="irp-fila irp-cab"><span>Producto</span><span>ID</span><span>Cantidad</span><span>Lote</span><span>Vence</span><span></span></div>
            ${filas.map((x, i) => `${x.dudas ? `<div class="irp-dudas"><i class="ph-bold ph-warning"></i> ${esc(x.dudas)}</div>` : ''}<div class="irp-fila ${v.malas.has(i) ? 'irp-mala' : ''}"><input data-c="nombre" data-i="${i}" list="irp-dl" value="${esc(x.nombre)}" placeholder="Producto" autocomplete="off"><input data-c="codigo" data-i="${i}" inputmode="numeric" value="${esc(x.codigo)}" placeholder="ID"><input data-c="cantidad" data-i="${i}" type="number" min="1" value="${esc(x.cantidad)}" placeholder="Cant."><input data-c="lote" data-i="${i}" value="${esc(x.lote)}" placeholder="S/L"><input data-c="vence" data-i="${i}" type="date" value="${esc(x.vence)}"><button type="button" class="btn btn-outline btn-sm" data-del="${i}" aria-label="Quitar fila">✕</button></div>`).join('')}</div>
            <div class="act-fila"><button type="button" class="btn btn-outline" id="irp-add">+ Agregar fila</button><button type="button" class="btn btn-outline" id="irp-clr">Vaciar tabla</button></div>
            <p class="act-hint">${v.ok} fila(s) listas · ${v.unidades} unidades${v.malas.size ? ` · <b style="color:#B91C1C">${v.malas.size} con datos por completar (producto y cantidad)</b>` : ''}</p>
            <button type="button" class="btn btn-primary" id="irp-ok" ${v.ok && bodegaSel && !v.malas.size ? '' : 'disabled'}>Ingresar a ${esc(bodegaSel || 'la bodega')}</button></div>`;
        enlazar();
    }
    function validar() {
        const malas = new Set(); let ok = 0, unidades = 0;
        filas.forEach((x, i) => { const bien = x.nombre.trim() && num(x.cantidad) > 0; if (bien) { ok++; unidades += Math.floor(num(x.cantidad)); } else if (x.nombre.trim() || x.cantidad || x.codigo) malas.add(i); });
        return { malas, ok, unidades };
    }
    function enlazar() {
        const r = root();
        r.querySelector('#irp-b').addEventListener('change', (e) => { bodegaSel = e.target.value; pintar(); });
        r.querySelector('#irp-nb').addEventListener('click', nuevaBodega);
        r.querySelector('#irp-oc').addEventListener('change', (e) => { ocRef = e.target.value.trim(); });
        r.querySelector('#irp-pegar').addEventListener('click', () => { const n = parsear(r.querySelector('#irp-txt').value); if (!n.length) { toast('Nada que agregar', 'Pega al menos una línea.', 'warning'); return; } n.forEach(x => { if (!x.codigo) x.codigo = codDe(x.nombre); else if (!x.nombre) x.nombre = nomDe(x.codigo); }); filas = filas.concat(n); pintar(); });
        r.querySelector('#irp-add').addEventListener('click', () => { filas.push(filaVacia()); pintar(); });
        r.querySelector('#irp-clr').addEventListener('click', () => { if (!filas.length || confirm('¿Vaciar toda la tabla?')) { filas = []; pintar(); } });
        r.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { filas.splice(+b.dataset.del, 1); pintar(); }));
        r.querySelectorAll('.irp-fila input').forEach(inp => inp.addEventListener('change', () => {
            const x = filas[+inp.dataset.i]; x[inp.dataset.c] = inp.dataset.c === 'codigo' ? inp.value.replace(/\D/g, '') : inp.value;
            if (inp.dataset.c === 'nombre' && !x.codigo) x.codigo = codDe(x.nombre);
            if (inp.dataset.c === 'codigo' && x.codigo && !x.nombre.trim()) x.nombre = nomDe(x.codigo);
            pintar();
        }));
        r.querySelector('#irp-ok').addEventListener('click', ingresar);
        r.querySelector('#irp-fotos').addEventListener('change', (e) => { const fl = Array.from(e.target.files || []); e.target.value = ''; leerFotos(fl.slice(0, 20)); });
    }
    async function nuevaBodega() {
        const nombre = (prompt('Nombre de la nueva bodega (ej. Camión):') || '').trim(); if (!nombre) return;
        if (bodegas.some(b => norm(b.name) === norm(nombre))) { bodegaSel = bodegas.find(b => norm(b.name) === norm(nombre)).name; pintar(); return; }
        try {
            const f = fs();
            await f.addDoc(f.collection(db(), 'Bodegas'), { name: nombre, type: 'transitoria', managerId: '', capacityMetrics: '', prefijo: '', usaEstantes: false, isActive: true, createdAt: f.serverTimestamp() });
            await cargarDatos(); bodegaSel = nombre; pintar(); toast('Bodega creada', nombre, 'success');
        } catch (e) { toast('No se creó la bodega', e.message || String(e), 'error'); }
    }

    function mezclar(doc, ingresos) {
        let lotes = Array.isArray(doc && doc.batches) ? doc.batches.map(b => ({ ...b })) : [];
        if (!lotes.length && doc && num(doc.quantity) > 0) lotes = [{ batch: doc.batch || 'S/L', quantity: num(doc.quantity), expirationDate: doc.expirationDate || 'N/A' }];
        let total = 0;
        ingresos.forEach(g => { total += g.cantidad; const ex = lotes.find(b => b.batch === g.lote && (b.expirationDate || 'N/A') === g.vence); if (ex) ex.quantity = num(ex.quantity) + g.cantidad; else lotes.push({ batch: g.lote, quantity: g.cantidad, expirationDate: g.vence }); });
        if (typeof window.fefoCompare === 'function') lotes.sort(window.fefoCompare);
        return { batches: lotes, quantity: num(doc && doc.quantity) + total };
    }

    async function ingresar() {
        const v = validar(); if (!bodegaSel || !v.ok || v.malas.size) return;
        // agrupa por producto (mismo nombre o mismo ID)
        const grupos = new Map();
        filas.filter(x => x.nombre.trim() && num(x.cantidad) > 0).forEach(x => {
            const k = x.codigo ? 'c' + x.codigo : 'n' + norm(x.nombre);
            const g = grupos.get(k) || { nombre: x.nombre.trim().toUpperCase(), codigo: x.codigo || '', ingresos: [] };
            g.ingresos.push({ cantidad: Math.floor(num(x.cantidad)), lote: (x.lote || '').trim().toUpperCase() || 'S/L', vence: x.vence || 'N/A' }); grupos.set(k, g);
        });
        const lista = [...grupos.values()];
        if (!confirm(`Se ingresarán ${v.unidades} unidades de ${lista.length} productos a "${bodegaSel}". ¿Confirmas?`)) return;
        const recId = 'INV-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
        const prog = window.SAR_Progreso.iniciar(`Ingresando el inventario a ${bodegaSel}…`, ['Preparando…']);
        try {
            const f = fs(); let n = 0;
            for (const g of lista) {
                n++; prog.paso(`Guardando ${n} de ${lista.length}: ${g.nombre.slice(0, 40)}…`);
                let ref = null;
                const s1 = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('name', '==', g.nombre), f.limit(10)));
                s1.forEach(x => { if (!ref && x.data().location === bodegaSel) ref = f.doc(f.collection(db(), 'Insumos'), x.id); });
                if (!ref && g.codigo) { const s2 = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('codigoMP', '==', g.codigo), f.limit(10))); s2.forEach(x => { if (!ref && x.data().location === bodegaSel) ref = f.doc(f.collection(db(), 'Insumos'), x.id); }); }
                if (!ref) ref = f.doc(f.collection(db(), 'Insumos'), `inv_${slug(g.codigo || g.nombre)}__${slug(bodegaSel)}`);
                await f.runTransaction(db(), async (tx) => {
                    const sn = await tx.get(ref), actual = sn.exists() ? sn.data() : null, m = mezclar(actual, g.ingresos), limite = num(actual && (actual.criticalLimit || actual.stock_minimo)) || 50, prox = m.batches[0];
                    const base = { origenOC: true, origenIngreso: (actual && actual.origenIngreso) || 'INVENTARIO_RAPIDO', ...(ocRef ? { ultimaOC: ocRef } : {}), ...(g.codigo ? { codigoMP: g.codigo } : {}), quantity: m.quantity, batches: m.batches, isCritical: m.quantity <= limite, batch: prox ? prox.batch : '', expirationDate: prox ? prox.expirationDate : 'N/A', updatedAt: f.serverTimestamp() };
                    if (actual) tx.update(ref, base); else tx.set(ref, { name: g.nombre, name_lowercase: g.nombre.toLowerCase(), location: bodegaSel, criticalLimit: 50, category: 'General', ...base });
                    g.ingresos.forEach(ing => tx.set(f.doc(f.collection(db(), 'Historial_Movimientos')), { insumoName: g.nombre, item: g.nombre, quantity: ing.cantidad, type: 'INGRESO_INVENTARIO', batch: ing.lote, expirationDate: ing.vence, destination: bodegaSel, dest: bodegaSel, origin: 'Inventario inicial', user: usuario(), date: f.serverTimestamp(), document: `${recId} · Ingreso rápido${ocRef ? ' · OC ' + ocRef : ''}`, observacion: 'Ingreso rápido de inventario' + (ocRef ? ' (llegó con la OC ' + ocRef + ')' : ''), idInsumoDestino: ref.id }));
                });
                try {
                    const id = slug(g.codigo || g.nombre) || 'manual';
                    await f.setDoc(f.doc(f.collection(db(), 'Catalogo_Productos'), id), { descripcion: g.nombre, descripcion_lower: g.nombre.toLowerCase(), codigoMP: g.codigo, insumoName: g.nombre, sinOrden: true, origen: 'INVENTARIO', creadoPor: usuario(), actualizado: f.serverTimestamp() }, { merge: true });
                } catch (e) { /* el stock ya entró */ }
            }
            prog.listo(`${v.unidades} unidades de ${lista.length} productos ingresadas a ${bodegaSel} (${recId})`, { informe: true });
            filas = []; await cargarDatos(); pintar();
        } catch (e) { prog.error(); toast('No se terminó el ingreso', (e.message || String(e)) + ' Lo ya guardado queda en la bodega; revisa antes de repetir.', 'error'); }
    }

    async function abrir() {
        const r = root(); if (!r) return;
        if (!puede()) { r.innerHTML = '<div class="home-empty">Esta sección es para administradores y encargados de bodega.</div>'; return; }
        r.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando bodegas y catálogo…') : 'Cargando…';
        try { await cargarDatos(); if (!filas.length) filas = [filaVacia()]; pintar(); }
        catch (e) { r.innerHTML = `<div class="home-empty">No pude cargar (${esc(e.message || 'error')}).</div>`; }
    }
    window.SAR_IngresoRapido = { abrir, parsear, fecha };
})(window, document);
