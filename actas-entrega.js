/* ==========================================================================
   ACTAS DE ENTREGA (v20.37)
   --------------------------------------------------------------------------
   Se elige la bodega de origen, se agregan productos desde su stock, se indica el
   centro de destino (y opcionalmente productos pendientes y documentos asociados:
   SDC, OC, factura...) y se genera el acta en PDF y Word con el formato oficial.

   - Borrador: vive en este navegador, no toca el stock.
   - Emitir: toma un correlativo único (AE-AAAA-NNNN), descuenta el stock de la bodega
     de origen (FEFO por lote) y deja cada movimiento en el historial con el N° de acta,
     todo en UNA transacción (o se hace todo o no se hace nada).
   - Anular (solo administrador): devuelve el stock y deja el acta marcada ANULADA;
     el número no se reutiliza.
   No se guardan datos de pacientes.
   ========================================================================== */
(function (window, document) {
    'use strict';

    const fs = () => window.firebaseFirestore;
    const db = () => window.firebaseDb;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const rol = () => String(document.body.dataset.userRole || '').toLowerCase();
    const esAdmin = () => ['admin', 'administrador', 'global', 'superadmin'].includes(rol());
    const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
    const num = (v) => Number(v) || 0;
    const MAX_ITEMS = 60;
    const BORRADOR_KEY = 'sar_acta_borrador_v1';
    const FIRMA_KEY = 'sar_acta_firma_v1';
    const CENTROS = ['CESFAM San Manuel', 'CESFAM Elgueta', 'UAPO', 'Antumalen', 'Posta Pahuilmo', 'Pomaire', 'CECOSF Obispo Lizama', 'Anexo Dental', 'Anides'];
    const TIPOS_DOC = ['SDC', 'OC', 'Factura', 'Guía de despacho', 'Memo', 'Otro'];
    const PDFLIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';

    // ---------------------------------------------------------------
    // Lógica pura (testeable)
    // ---------------------------------------------------------------
    function lotesDeDoc(d) {
        if (Array.isArray(d.batches) && d.batches.length) return d.batches.map(b => ({ batch: b.batch || 'S/L', quantity: num(b.quantity), expirationDate: b.expirationDate || '' }));
        const q = num(d.quantity);
        return q > 0 ? [{ batch: d.batch || 'S/L', quantity: q, expirationDate: d.expirationDate || '' }] : [];
    }
    /** Descuenta `cantidad` por FEFO. Devuelve {usados, batches, quantity} o lanza si no alcanza. */
    function descontarFEFO(d, cantidad) {
        const q = num(d.quantity), c = num(cantidad);
        if (!(c > 0) || c !== Math.floor(c)) throw new Error('La cantidad debe ser un entero mayor que 0.');
        if (c > q) throw new Error(`Stock insuficiente de ${d.name}: hay ${q} y se piden ${c}.`);
        const cmp = typeof window.fefoCompare === 'function' ? window.fefoCompare : () => 0;
        const lotes = lotesDeDoc(d).sort(cmp);
        const usados = []; let falta = c;
        for (const l of lotes) {
            if (falta <= 0) break;
            const u = Math.min(l.quantity, falta);
            if (u > 0) { usados.push({ batch: l.batch, used: u, expirationDate: l.expirationDate }); l.quantity -= u; falta -= u; }
        }
        // stock sin lote registrado
        if (falta > 0) usados.push({ batch: 'S/L', used: falta, expirationDate: '' });
        return { usados, batches: lotes.filter(l => l.quantity > 0), quantity: q - c };
    }
    /** Descuenta `n` unidades por FEFO sobre `lotes` (se modifica) y las anota en `usados`. */
    function quitarFEFO(lotes, n, usados) {
        let falta = n;
        for (const l of lotes) {
            if (falta <= 0) break;
            const u = Math.min(l.quantity, falta);
            if (u > 0) { usados.push({ batch: l.batch, used: u, expirationDate: l.expirationDate }); l.quantity -= u; falta -= u; }
        }
        if (falta > 0) usados.push({ batch: 'S/L', used: falta, expirationDate: '' });
    }
    /** Detalle del sobregiro por acta [{acta, qty}] (el más antiguo primero); cuadra con `sobregiro`. */
    function detalleDe(d) {
        const det = (Array.isArray(d.sobregiroDetalle) ? d.sobregiroDetalle : []).map(x => ({ acta: x.acta, qty: num(x.qty) })).filter(x => x.qty > 0);
        const dif = num(d.sobregiro) - det.reduce((t, x) => t + x.qty, 0);
        if (dif > 0) det.unshift({ acta: '(sin acta)', qty: dif });
        return det;
    }
    /** Consume `n` unidades del detalle (FIFO). Devuelve {det, cubiertas:[{acta,qty}]}. */
    function consumirDetalle(det, n) {
        let falta = n; const cubiertas = [], rest = [];
        for (const x of det) {
            if (falta > 0) { const u = Math.min(x.qty, falta); if (u > 0) cubiertas.push({ acta: x.acta, qty: u }); falta -= u; if (x.qty - u > 0) rest.push({ acta: x.acta, qty: x.qty - u }); }
            else rest.push({ ...x });
        }
        return { det: rest, cubiertas };
    }
    /**
     * Entrega con sobregiro. 1) Cuadra: si ya entró stock al sistema y hay unidades entregadas antes sin respaldo
     * (sobregiro), se descuentan primero. 2) Entrega lo que alcance. 3) Lo que falte queda como sobregiro nuevo
     * asociado al acta. Saldo contable = quantity − sobregiro (puede ser negativo). quantity nunca baja de 0.
     */
    function planificar(d, cantidad, acta) {
        const c = num(cantidad);
        if (!(c > 0) || c !== Math.floor(c)) throw new Error('La cantidad debe ser un entero mayor que 0.');
        let q = num(d.quantity), sg = num(d.sobregiro);
        let det = detalleDe(d), cubiertas = [];
        const cmp = typeof window.fefoCompare === 'function' ? window.fefoCompare : () => 0;
        const lotes = lotesDeDoc(d).sort(cmp);
        const cuadrado = Math.min(sg, q), cuadreUsados = [];
        if (cuadrado > 0) { quitarFEFO(lotes, cuadrado, cuadreUsados); q -= cuadrado; sg -= cuadrado; const r = consumirDetalle(det, cuadrado); det = r.det; cubiertas = r.cubiertas; }
        const take = Math.min(c, q), usados = [];
        if (take > 0) { quitarFEFO(lotes, take, usados); q -= take; }
        const faltante = c - take; sg += faltante;
        if (faltante > 0) det.push({ acta: acta || '(sin acta)', qty: faltante });
        return { usados, cuadreUsados, batches: lotes.filter(l => l.quantity > 0), quantity: q, sobregiro: sg, sobregiroDetalle: det, cubiertas, faltante, cuadrado };
    }
    /** Cuadre explícito (sin entrega): descuenta del stock lo ya entregado sin respaldo. */
    function cuadrar(d) {
        const q = num(d.quantity), sg = num(d.sobregiro), n = Math.min(q, sg);
        if (!(n > 0)) return { cuadrado: 0, batches: lotesDeDoc(d), quantity: q, sobregiro: sg, sobregiroDetalle: detalleDe(d), cubiertas: [], usados: [] };
        const cmp = typeof window.fefoCompare === 'function' ? window.fefoCompare : () => 0;
        const lotes = lotesDeDoc(d).sort(cmp), usados = [];
        quitarFEFO(lotes, n, usados);
        const r = consumirDetalle(detalleDe(d), n);
        return { cuadrado: n, batches: lotes.filter(l => l.quantity > 0), quantity: q - n, sobregiro: sg - n, sobregiroDetalle: r.det, cubiertas: r.cubiertas, usados };
    }
    /** Anulación: devuelve lo descontado y retira del sobregiro lo que nunca salió del sistema. */
    function restaurarConSobregiro(d, usados, sinRespaldo, acta) {
        const res = restaurarLotes(d, usados);
        const sr = num(sinRespaldo), sg = num(d.sobregiro);
        const det = detalleDe(d).map(x => ({ ...x }));
        const e = det.find(x => x.acta === acta) || det.find(x => x.acta === '(sin acta)');
        const quita = Math.min(e ? e.qty : 0, sr, sg), resto = sr - quita;
        if (e) e.qty -= quita;
        let batches = res.batches, quantity = res.quantity;
        if (resto > 0) { batches = batches.concat([{ batch: 'S/L', quantity: resto, expirationDate: '' }]); quantity += resto; }
        return { batches, quantity, sobregiro: sg - quita, sobregiroDetalle: det.filter(x => x.qty > 0) };
    }
    /** Devuelve a un doc los lotes usados (anulación). */
    function restaurarLotes(d, usados) {
        const arr = lotesDeDoc(d).map(b => ({ ...b }));
        let total = 0;
        for (const u of usados || []) {
            total += num(u.used);
            const ex = arr.find(b => b.batch === u.batch && (b.expirationDate || '') === (u.expirationDate || ''));
            if (ex) ex.quantity += num(u.used); else arr.push({ batch: u.batch, quantity: num(u.used), expirationDate: u.expirationDate || '' });
        }
        return { batches: arr, quantity: num(d.quantity) + total };
    }
    const numeroActa = (anio, n) => `AE-${anio}-${String(n).padStart(4, '0')}`;
    function validarBorrador(b) {
        const errores = [];
        if (!String(b.centro || '').trim()) errores.push('Indica a qué centro se entrega.');
        if (!b.origen) errores.push('Elige la bodega de origen.');
        if (!b.items.length) errores.push('Agrega al menos un producto.');
        if (b.items.length > MAX_ITEMS) errores.push(`Máximo ${MAX_ITEMS} productos por acta.`);
        b.items.forEach(i => { if (!(num(i.cantidad) > 0) || num(i.cantidad) !== Math.floor(num(i.cantidad))) errores.push(`Cantidad inválida en ${i.nombre}.`); else if (!String(i.nombre || '').trim() || (i.manual && String(i.nombre).trim().length < 3)) errores.push('Un producto manual necesita nombre.'); else if (i.controlado && num(i.cantidad) > num(i.stock)) errores.push(`${i.nombre}: es medicamento controlado, no puede entregarse sin stock en sistema (requiere folio DAU en registro separado).`); });
        return errores;
    }

    // ---------------------------------------------------------------
    // Estado
    // ---------------------------------------------------------------
    const vacio = () => ({ origen: null, centro: '', items: [], pendientes: [], documentos: [], recibe: { nombre: '', cargo: '' } });
    let borrador = vacio();
    let stock = [];           // docs de la bodega elegida
    let bodegas = [];
    let historial = [];
    let busqueda = '';
    let pdfLibPromesa = null, logoPromesa = null;

    const usuarioEmail = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };
    function leerFirma() { try { return JSON.parse(localStorage.getItem(FIRMA_KEY)) || null; } catch (e) { return null; } }
    function guardarFirma(f) { try { localStorage.setItem(FIRMA_KEY, JSON.stringify(f)); } catch (e) { /* sin storage */ } }
    function guardarBorrador() { try { localStorage.setItem(BORRADOR_KEY, JSON.stringify(borrador)); } catch (e) { /* sin storage */ } }
    function cargarBorrador() { try { const b = JSON.parse(localStorage.getItem(BORRADOR_KEY)); if (b && Array.isArray(b.items)) return { ...vacio(), ...b }; } catch (e) { /* nada */ } return vacio(); }
    let firma = { nombre: 'Matias Bustos Huerta', cargo: 'Encargado de insumos' };

    // ---------------------------------------------------------------
    // Datos
    // ---------------------------------------------------------------
    async function cargarBodegas() {
        const snap = await fs().getDocs(fs().collection(db(), 'Bodegas'));
        bodegas = []; snap.forEach(d => { const b = { id: d.id, ...d.data() }; if (b.isActive !== false) bodegas.push(b); });
        const central = (b) => /central/i.test(String(b.name || ''));
        bodegas.sort((a, b) => (central(b) - central(a)) || String(a.name).localeCompare(String(b.name), 'es'));
    }
    async function cargarStock() {
        stock = [];
        if (!borrador.origen) return;
        const f = fs();
        const snap = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('location', '==', borrador.origen), f.limit(1500)));
        snap.forEach(d => { const x = d.data(); if (x.status !== 'CUARENTENA') stock.push({ id: d.id, name: x.name || '', quantity: num(x.quantity), sobregiro: num(x.sobregiro), disp: Math.max(0, num(x.quantity) - num(x.sobregiro)), controlado: !!x.controlado, provisional: !!x.provisional, batches: lotesDeDoc(x) }); });
        stock.sort((a, b) => (b.disp > 0) - (a.disp > 0) || a.name.localeCompare(b.name, 'es'));
    }
    async function cargarHistorial() {
        const f = fs();
        const snap = await f.getDocs(f.query(f.collection(db(), 'Actas_Entrega'), f.orderBy('creadoEn', 'desc'), f.limit(40)));
        historial = []; snap.forEach(d => historial.push({ id: d.id, ...d.data() }));
    }

    /** Emite el acta: correlativo + descuento + sobregiro + historial en una sola transacción. */
    async function emitir(b, usuario) {
        const f = fs();
        const anio = new Date().getFullYear();
        const ctrRef = f.doc(f.collection(db(), 'Contadores'), `acta-${anio}`);
        const fecha = new Date().toISOString().slice(0, 10);
        // Productos manuales: si ya existe uno con ese nombre en la bodega se usa; si no, se crea como PROVISIONAL.
        const items = b.items.map(i => ({ ...i }));
        for (const i of items) {
            if (i.id || !i.manual) continue;
            const nombre = String(i.nombre || '').trim().toUpperCase();
            const q = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('name_lowercase', '==', nombre.toLowerCase()), f.where('location', '==', b.origen), f.limit(1)));
            if (!q.empty) { i.id = q.docs[0].id; i.nombre = q.docs[0].data().name || nombre; }
            else { i.nuevo = true; i.nombre = nombre; }
        }
        const refs = items.map(i => ({ i, ref: i.nuevo ? f.doc(f.collection(db(), 'Insumos')) : f.doc(f.collection(db(), 'Insumos'), i.id), hist: f.doc(f.collection(db(), 'Historial_Movimientos')), histC: f.doc(f.collection(db(), 'Historial_Movimientos')) }));
        return f.runTransaction(db(), async (tx) => {
            const cs = await tx.get(ctrRef);
            const n = (cs.exists() ? num(cs.data().ultimo) : 0) + 1;
            const numero = numeroActa(anio, n);
            const actaRef = f.doc(f.collection(db(), 'Actas_Entrega'), numero);
            const snaps = [];
            for (const r of refs) snaps.push(r.i.nuevo ? null : await tx.get(r.ref));
            const base = (r) => ({ name: r.i.nombre, name_lowercase: String(r.i.nombre).toLowerCase(), location: b.origen, quantity: 0, batches: [], sobregiro: 0, provisional: true, category: 'Provisional', criticalLimit: 50, isCritical: true, unitPrice: 0, status: 'ACTIVO', createdAt: f.serverTimestamp(), createdBy: usuario });
            const datos = refs.map((r, k) => {
                if (r.i.nuevo) return base(r);
                if (!snaps[k].exists()) throw new Error(`${r.i.nombre} ya no existe en la bodega.`);
                const d = snaps[k].data();
                if ((d.location || '') !== b.origen) throw new Error(`${r.i.nombre} cambió de bodega.`);
                if (d.status === 'CUARENTENA') throw new Error(`${r.i.nombre} está en CUARENTENA.`);
                return d;
            });
            const calc = refs.map((r, k) => {
                const p = planificar({ ...datos[k], name: datos[k].name }, r.i.cantidad, numero);
                if (datos[k].controlado && p.faltante > 0) throw new Error(`${r.i.nombre} es medicamento controlado: no puede entregarse sin stock en sistema.`);
                return p;
            });
            const itemsActa = refs.map((r, k) => ({ id: r.ref.id, nombre: r.i.nombre, cantidad: num(r.i.cantidad), lotes: calc[k].usados, sinRespaldo: calc[k].faltante, ...(r.i.nuevo ? { provisional: true } : {}) }));
            refs.forEach((r, k) => {
                const d = datos[k], c = calc[k];
                const limite = num(d.criticalLimit || d.stock_minimo || 50);
                const prox = c.batches[0];
                const cambios = { quantity: c.quantity, batches: c.batches, sobregiro: c.sobregiro, sobregiroDetalle: c.sobregiroDetalle, isCritical: c.quantity <= limite, ...(prox ? { batch: prox.batch, expirationDate: prox.expirationDate || '' } : {}), updatedAt: f.serverTimestamp() };
                if (r.i.nuevo) tx.set(r.ref, { ...d, ...cambios }); else tx.update(r.ref, cambios);
                c.cubiertas.forEach(cu => tx.set(f.doc(f.collection(db(), 'Historial_Movimientos')), { insumoName: d.name, quantity: cu.qty, type: 'CUADRE_SOBREGIRO', user: usuario, date: f.serverTimestamp(), document: numero, batch: 'MULTI-LOTE', origin: b.origen, idInsumoOrigen: r.ref.id, observacion: `Cuadre automático al emitir ${numero}: ${cu.qty} u. del acta ${cu.acta} ya estaban entregadas sin respaldo`, actaId: cu.acta, cuadradoPor: numero }));
                tx.set(r.hist, {
                    insumoName: d.name, quantity: num(r.i.cantidad), type: 'ENTREGA_ACTA', user: usuario, date: f.serverTimestamp(), document: numero,
                    batch: c.usados.length === 1 ? c.usados[0].batch : (c.usados.length ? 'MULTI-LOTE' : 'SIN-RESPALDO'), origin: b.origen, dest: b.centro, lotes: c.usados,
                    idInsumoOrigen: r.ref.id, sinRespaldo: c.faltante,
                    observacion: `Acta de entrega ${numero}${c.faltante > 0 ? ` · ${c.faltante} u. sin respaldo en sistema (sobregiro)` : ''}${r.i.nuevo ? ' · insumo provisional' : ''}`, actaId: numero
                });
            });
            tx.set(ctrRef, { ultimo: n, anio, updatedAt: f.serverTimestamp() });
            const acta = {
                numero, fecha, centro: b.centro.trim(), bodegaOrigen: b.origen, estado: 'EMITIDA', stockDescontado: true,
                conSobregiro: itemsActa.some(i => i.sinRespaldo > 0),
                items: itemsActa, pendientes: b.pendientes.map(p => ({ nombre: p.nombre, cantidad: num(p.cantidad) })),
                documentos: b.documentos.map(d => ({ tipo: d.tipo, numero: d.numero, detalle: d.detalle || '' })),
                entrega: { nombre: firma.nombre, cargo: firma.cargo }, recibe: { nombre: (b.recibe && b.recibe.nombre) || '', cargo: (b.recibe && b.recibe.cargo) || '' },
                creadoPor: usuario, creadoEn: f.serverTimestamp()
            };
            tx.set(actaRef, acta);
            return { ...acta, creadoEn: new Date().toISOString() };
        });
    }

    /** Anula un acta emitida: devuelve el stock a la bodega de origen. */
    async function anular(numero, motivo, usuario) {
        const f = fs();
        const actaRef = f.doc(f.collection(db(), 'Actas_Entrega'), numero);
        return f.runTransaction(db(), async (tx) => {
            const as = await tx.get(actaRef);
            if (!as.exists()) throw new Error('El acta no existe.');
            const a = as.data();
            if (a.estado === 'ANULADA') throw new Error('El acta ya estaba anulada.');
            const refs = a.items.map(i => ({ i, ref: f.doc(f.collection(db(), 'Insumos'), i.id), hist: f.doc(f.collection(db(), 'Historial_Movimientos')) }));
            const snaps = []; for (const r of refs) snaps.push(await tx.get(r.ref));
            refs.forEach((r, k) => {
                if (!snaps[k].exists()) throw new Error(`${r.i.nombre} ya no existe: no se puede devolver el stock.`);
                const d = snaps[k].data(), res = restaurarConSobregiro(d, r.i.lotes, r.i.sinRespaldo, numero);
                const limite = num(d.criticalLimit || d.stock_minimo || 50);
                tx.update(r.ref, { quantity: res.quantity, batches: res.batches, sobregiro: res.sobregiro, sobregiroDetalle: res.sobregiroDetalle, isCritical: res.quantity <= limite, updatedAt: f.serverTimestamp() });
                tx.set(r.hist, {
                    insumoName: d.name, quantity: num(r.i.cantidad), type: 'ANULACION_ACTA', user: usuario, date: f.serverTimestamp(), document: numero,
                    batch: 'MULTI-LOTE', origin: a.centro, dest: a.bodegaOrigen, lotes: r.i.lotes || [], idInsumoDestino: r.i.id,
                    observacion: `Anulación de acta ${numero}: ${motivo}`, actaId: numero
                });
            });
            tx.update(actaRef, { estado: 'ANULADA', stockDescontado: false, anuladaEn: f.serverTimestamp(), anuladaPor: usuario, anulacionMotivo: motivo });
        });
    }

    // ---------------------------------------------------------------
    // Descarga
    // ---------------------------------------------------------------
    function cargarPDFLib() {
        if (window.PDFLib) return Promise.resolve(window.PDFLib);
        if (!pdfLibPromesa) pdfLibPromesa = new Promise((ok, mal) => {
            const s = document.createElement('script'); s.src = PDFLIB_URL; s.onload = () => ok(window.PDFLib);
            s.onerror = () => { pdfLibPromesa = null; mal(new Error('No se pudo cargar el generador de PDF (revisa tu conexión).')); };
            document.head.appendChild(s);
        });
        return pdfLibPromesa;
    }
    function cargarLogo() {
        if (!logoPromesa) logoPromesa = fetch('assets/logo-acta.png').then(r => { if (!r.ok) throw new Error('logo'); return r.arrayBuffer(); }).then(b => new Uint8Array(b)).catch(() => { logoPromesa = null; return null; });
        return logoPromesa;
    }
    function bajar(bytes, nombre, mime) {
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
    }
    async function descargar(acta, formato) {
        const D = window.SAR_ActaDoc; if (!D) throw new Error('Módulo de documentos no cargado.');
        const logoBytes = await cargarLogo();
        if (formato === 'pdf') {
            const PDFLib = await cargarPDFLib();
            bajar(await D.generarPDF(acta, { PDFLib, logoBytes }), D.nombreArchivo(acta, 'pdf'), 'application/pdf');
        } else {
            bajar(D.generarDOCX(acta, { logoBytes }), D.nombreArchivo(acta, 'docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        }
    }
    const actaParaDoc = (a) => ({ ...a, items: (a.items || []).map(i => ({ nombre: i.nombre, cantidad: i.cantidad })) });

    // ---------------------------------------------------------------
    // Interfaz
    // ---------------------------------------------------------------
    const root = () => document.getElementById('act-root');

    function pintar() {
        const r = root(); if (!r) return;
        const q = busqueda.trim().toLowerCase();
        const lista = stock.filter(s => !q || s.name.toLowerCase().includes(q)).slice(0, 80);
        const yaEsta = (id) => borrador.items.some(i => i.id === id);
        const errores = validarBorrador(borrador);
        r.innerHTML = `
        <div class="page-header mb-24"><div class="page-title"><h2>Actas de entrega</h2>
            <p>Arma el acta desde el stock de la bodega. Al emitirla se descuenta el stock y queda con su número.</p></div></div>
        <div class="act-grid">
          <div class="act-col">
            <h3 class="act-h">1 · Stock disponible</h3>
            <label class="act-l">Bodega de origen
              <select id="act-origen"><option value="">— elegir —</option>${bodegas.map(b => `<option value="${esc(b.name)}"${b.name === borrador.origen ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
            <input id="act-buscar" type="search" placeholder="Buscar producto…" value="${esc(busqueda)}" autocomplete="off">
            <details class="act-det act-manual"${borrador.items.some(i => i.manual) ? ' open' : ''}><summary>¿No está en el sistema? Ingreso manual</summary>
              <p class="act-hint">Se asume que lo tienes físicamente. Queda como insumo provisional y como <b>sobregiro</b> (saldo contable negativo) hasta que ingrese la OC/SDC y se cuadre.</p>
              <div class="act-fila act-docs"><input id="act-mn" placeholder="Nombre del insumo"><input id="act-mq" type="number" min="1" value="1" class="act-qty" aria-label="Cantidad"><button type="button" class="btn btn-outline" id="act-madd">Agregar</button></div>
              <label class="act-l act-chk"><input type="checkbox" id="act-mc"> Es medicamento controlado (no se permite sin stock)</label></details>
            <div class="act-stock">${!borrador.origen ? '<p class="act-hint">Elige una bodega para ver su stock.</p>' : !lista.length ? '<p class="act-hint">Sin resultados. Si no está en el sistema, agrégalo a mano abajo.</p>' : lista.map(s => `
              <div class="act-fila${yaEsta(s.id) ? ' act-ya' : ''}"><div class="act-fn">${esc(s.name)}${s.controlado ? ' <small>(controlado)</small>' : ''}${s.provisional ? ' <small>(provisional)</small>' : ''}<small>${s.disp > 0 ? 'Disponible: ' + s.disp : '<span class="act-sin">Sin stock en sistema</span>'}${s.sobregiro > 0 ? ' · sobregiro: ' + s.sobregiro : ''}</small></div>
                ${yaEsta(s.id) ? '<span class="act-chip">agregado</span>' : `<input type="number" min="1" value="1" class="act-qty" data-qid="${esc(s.id)}" aria-label="Cantidad"><button type="button" class="btn btn-outline act-add" data-id="${esc(s.id)}">Agregar</button>`}</div>`).join('')}
              ${stock.filter(s => !q || s.name.toLowerCase().includes(q)).length > 80 ? '<p class="act-hint">Hay más resultados: afina la búsqueda.</p>' : ''}</div>
          </div>
          <div class="act-col">
            <h3 class="act-h">2 · Acta</h3>
            <label class="act-l">Centro al que se entrega
              <input id="act-centro" list="act-centros" value="${esc(borrador.centro)}" placeholder="Ej: Pomaire"><datalist id="act-centros">${CENTROS.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
            <h4 class="act-h4">Productos entregados (${borrador.items.length})</h4>
            ${borrador.items.length ? borrador.items.map((i, k) => `<div class="act-fila"><div class="act-fn">${esc(i.nombre)}${i.manual ? ' <small>(manual · provisional)</small>' : ''}<small>Disponible: ${num(i.stock)}${num(i.cantidad) > num(i.stock) ? ` · <span class="act-sin">sin respaldo: ${num(i.cantidad) - num(i.stock)}</span>` : ''}</small></div>
                <input type="number" min="1" value="${i.cantidad}" class="act-qty act-edit" data-k="${k}" aria-label="Cantidad"><button type="button" class="btn btn-outline act-del" data-k="${k}" aria-label="Quitar">✕</button></div>`).join('') : '<p class="act-hint">Aún no agregas productos.</p>'}
            <details class="act-det"${borrador.pendientes.length ? ' open' : ''}><summary>Productos pendientes de entrega (opcional)</summary>
              ${borrador.pendientes.map((p, k) => `<div class="act-fila"><div class="act-fn">${esc(p.nombre)}</div><input type="number" min="1" value="${p.cantidad}" class="act-qty act-pedit" data-k="${k}"><button type="button" class="btn btn-outline act-pdel" data-k="${k}">✕</button></div>`).join('')}
              <div class="act-fila"><input id="act-pn" placeholder="Nombre del producto pendiente"><input id="act-pq" type="number" min="1" value="1" class="act-qty"><button type="button" class="btn btn-outline" id="act-padd">Añadir</button></div></details>
            <details class="act-det"${borrador.documentos.length ? ' open' : ''}><summary>Documentos asociados: SDC, OC, factura… (opcional)</summary>
              ${borrador.documentos.map((d, k) => `<div class="act-fila"><div class="act-fn">${esc(d.tipo)} N° ${esc(d.numero)}${d.detalle ? ' — ' + esc(d.detalle) : ''}</div><button type="button" class="btn btn-outline act-ddel" data-k="${k}">✕</button></div>`).join('')}
              <div class="act-fila act-docs"><select id="act-dt">${TIPOS_DOC.map(t => `<option>${esc(t)}</option>`).join('')}</select><input id="act-dn" placeholder="Número"><input id="act-dd" placeholder="Detalle (opcional)"><button type="button" class="btn btn-outline" id="act-dadd">Añadir</button></div></details>
            <details class="act-det"><summary>Firmas</summary>
              <div class="act-fila act-docs"><input id="act-en" value="${esc(firma.nombre)}" placeholder="Entrega: nombre"><input id="act-ec" value="${esc(firma.cargo)}" placeholder="Entrega: cargo"></div>
              <div class="act-fila act-docs"><input id="act-rn" value="${esc(borrador.recibe.nombre)}" placeholder="Recibe: nombre (opcional)"><input id="act-rc" value="${esc(borrador.recibe.cargo)}" placeholder="Recibe: cargo (opcional)"></div></details>
            ${errores.length && (borrador.items.length || borrador.centro) ? `<ul class="act-err">${errores.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
            <div class="act-acc"><button type="button" class="btn btn-outline" id="act-limpiar">Vaciar borrador</button>
              <button type="button" class="btn btn-primary" id="act-emitir"${errores.length ? ' disabled' : ''}>Emitir acta y descontar stock</button></div>
          </div>
        </div>
        <h3 class="act-h" style="margin-top:28px;">Actas emitidas</h3>
        <div class="act-hist">${historial.length ? historial.map(a => `<div class="act-fila${a.estado === 'ANULADA' ? ' act-anulada' : ''}"><div class="act-fn"><strong>${esc(a.numero)}</strong> · ${esc(a.centro)}<small>${esc(a.fecha)} · ${a.tipo === 'OXIGENO' ? 'oxígeno · ' : ''}${(a.items || []).length} ${a.tipo === 'OXIGENO' ? 'balones' : 'productos'} · ${esc(a.bodegaOrigen)} · ${esc(a.creadoPor || '')}${a.estado === 'ANULADA' ? ' · <b>ANULADA</b>' : ''}${a.conSobregiro ? ' · <b class="act-sin">con sobregiro</b>' : ''}</small></div>
            <button type="button" class="btn btn-outline act-dl" data-n="${esc(a.numero)}" data-f="pdf">PDF</button><button type="button" class="btn btn-outline act-dl" data-n="${esc(a.numero)}" data-f="docx">Word</button>
            ${esAdmin() && a.estado !== 'ANULADA' && a.tipo !== 'OXIGENO' ? `<button type="button" class="btn btn-outline act-an" data-n="${esc(a.numero)}">Anular</button>` : ''}</div>`).join('') : '<p class="act-hint">Todavía no hay actas emitidas.</p>'}</div>`;
        enlazar();
    }

    function leerCampos() {
        const g = (id) => { const e = document.getElementById(id); return e ? e.value : null; };
        const c = g('act-centro'); if (c !== null) borrador.centro = c;
        if (g('act-rn') !== null) borrador.recibe = { nombre: g('act-rn'), cargo: g('act-rc') };
        if (g('act-en') !== null) { firma = { nombre: g('act-en'), cargo: g('act-ec') }; guardarFirma(firma); }
    }

    function enlazar() {
        const r = root(), $ = (s) => r.querySelector(s), $$ = (s) => r.querySelectorAll(s);
        const refrescar = () => { leerCampos(); guardarBorrador(); pintar(); };
        $('#act-origen').addEventListener('change', async (e) => {
            leerCampos();
            if (borrador.items.length && !confirm('Cambiar de bodega vacía los productos agregados. ¿Continuar?')) { e.target.value = borrador.origen || ''; return; }
            borrador.origen = e.target.value || null; borrador.items = [];
            try { await cargarStock(); } catch (x) { toast('Error', 'No se pudo cargar el stock: ' + x.message, 'error'); }
            guardarBorrador(); pintar();
        });
        $('#act-buscar').addEventListener('input', (e) => { busqueda = e.target.value; leerCampos(); const pos = e.target.selectionStart; pintar(); const n = document.getElementById('act-buscar'); n.focus(); n.setSelectionRange(pos, pos); });
        ['act-centro', 'act-rn', 'act-rc', 'act-en', 'act-ec'].forEach(id => { const e = document.getElementById(id); if (e) e.addEventListener('change', () => { leerCampos(); guardarBorrador(); if (id === 'act-centro') pintar(); }); });
        $$('.act-add').forEach(b => b.addEventListener('click', () => {
            const s = stock.find(x => x.id === b.dataset.id); const inp = r.querySelector(`.act-qty[data-qid="${CSS.escape(b.dataset.id)}"]`);
            const c = Math.floor(num(inp && inp.value));
            if (!s || !(c > 0)) { toast('Cantidad', 'Indica una cantidad mayor que 0.', 'warning'); return; }
            if (borrador.items.length >= MAX_ITEMS) { toast('Límite', `Máximo ${MAX_ITEMS} productos por acta.`, 'warning'); return; }
            if (s.controlado && c > s.disp) { toast('Medicamento controlado', 'No puede entregarse sin stock en sistema.', 'error'); return; }
            borrador.items.push({ id: s.id, nombre: s.name, cantidad: c, stock: s.disp, controlado: s.controlado }); refrescar();
        }));
        $$('.act-edit').forEach(i => i.addEventListener('change', () => { borrador.items[+i.dataset.k].cantidad = Math.floor(num(i.value)); refrescar(); }));
        $$('.act-del').forEach(b => b.addEventListener('click', () => { borrador.items.splice(+b.dataset.k, 1); refrescar(); }));
        $$('.act-pedit').forEach(i => i.addEventListener('change', () => { borrador.pendientes[+i.dataset.k].cantidad = Math.floor(num(i.value)) || 1; refrescar(); }));
        $$('.act-pdel').forEach(b => b.addEventListener('click', () => { borrador.pendientes.splice(+b.dataset.k, 1); refrescar(); }));
        $$('.act-ddel').forEach(b => b.addEventListener('click', () => { borrador.documentos.splice(+b.dataset.k, 1); refrescar(); }));
        $('#act-madd').addEventListener('click', () => {
            const n = $('#act-mn').value.trim().toUpperCase(); const c = Math.floor(num($('#act-mq').value));
            if (n.length < 3 || !(c > 0)) { toast('Ingreso manual', 'Escribe el nombre del insumo y una cantidad mayor que 0.', 'warning'); return; }
            if ($('#act-mc').checked) { toast('Medicamento controlado', 'No se permite sin stock en sistema: use el circuito con folio DAU.', 'error'); return; }
            if (borrador.items.length >= MAX_ITEMS) { toast('Límite', `Máximo ${MAX_ITEMS} productos por acta.`, 'warning'); return; }
            const par = stock.find(x => x.name.toLowerCase() === n.toLowerCase());
            if (par) { toast('Ya existe', `"${par.name}" ya está en esta bodega: agrégalo desde la lista.`, 'warning'); return; }
            borrador.items.push({ id: null, manual: true, nombre: n, cantidad: c, stock: 0 }); refrescar();
        });
        $('#act-padd').addEventListener('click', () => {
            const n = $('#act-pn').value.trim(); const c = Math.floor(num($('#act-pq').value));
            if (!n || !(c > 0)) { toast('Pendiente', 'Escribe el producto y una cantidad.', 'warning'); return; }
            borrador.pendientes.push({ nombre: n.toUpperCase(), cantidad: c }); refrescar();
        });
        $('#act-dadd').addEventListener('click', () => {
            const n = $('#act-dn').value.trim(); if (!n) { toast('Documento', 'Escribe el número del documento.', 'warning'); return; }
            borrador.documentos.push({ tipo: $('#act-dt').value, numero: n, detalle: $('#act-dd').value.trim() }); refrescar();
        });
        $('#act-limpiar').addEventListener('click', () => { if (!confirm('¿Vaciar el borrador?')) return; borrador = { ...vacio(), origen: borrador.origen }; guardarBorrador(); pintar(); });
        $('#act-emitir').addEventListener('click', onEmitir);
        $$('.act-dl').forEach(b => b.addEventListener('click', async () => {
            const a = historial.find(x => x.numero === b.dataset.n); if (!a) return;
            b.disabled = true; try { await descargar(actaParaDoc(a), b.dataset.f); } catch (e) { toast('Descarga', e.message, 'error'); } finally { b.disabled = false; }
        }));
        $$('.act-an').forEach(b => b.addEventListener('click', async () => {
            const motivo = (prompt(`Motivo de la anulación del acta ${b.dataset.n} (el stock vuelve a la bodega de origen):`) || '').trim();
            if (!motivo) return;
            try { await anular(b.dataset.n, motivo, usuarioEmail()); toast('Acta anulada', `${b.dataset.n}: stock devuelto.`, 'success'); await Promise.all([cargarHistorial(), cargarStock()]); borrador.items = []; guardarBorrador(); pintar(); }
            catch (e) { toast('No se anuló', e.message, 'error'); }
        }));
    }

    let emitiendo = false;
    async function onEmitir() {
        if (emitiendo) return;
        leerCampos();
        const errores = validarBorrador(borrador);
        if (errores.length) { toast('Revisa el acta', errores[0], 'warning'); return; }
        const total = borrador.items.reduce((s, i) => s + num(i.cantidad), 0);
        const sin = borrador.items.map(i => ({ n: i.nombre, f: Math.max(0, num(i.cantidad) - num(i.stock)) })).filter(x => x.f > 0);
        const avisoSin = sin.length ? `\n\nSIN RESPALDO EN SISTEMA (quedan como sobregiro, saldo contable negativo hasta cuadrar con la OC/SDC):\n${sin.map(x => `• ${x.n}: ${x.f} u.`).join('\n')}` : '';
        if (!confirm(`Se emitirá el acta para ${borrador.centro.trim()} con ${borrador.items.length} productos (${total} unidades) y se descontarán de ${borrador.origen}.${avisoSin}\n\n¿Emitir?`)) return;
        emitiendo = true; const btn = document.getElementById('act-emitir'); if (btn) btn.disabled = true;
        try {
            const acta = await emitir(borrador, usuarioEmail());
            toast('Acta emitida', `${acta.numero} · stock descontado.`, 'success');
            borrador = { ...vacio(), origen: borrador.origen, centro: '' }; guardarBorrador();
            await Promise.all([cargarStock(), cargarHistorial()]);
            pintar();
            try { await descargar(actaParaDoc(acta), 'pdf'); } catch (e) { toast('Descarga', 'El acta se emitió, pero el PDF no se pudo generar: ' + e.message + ' Descárgalo desde "Actas emitidas".', 'warning'); }
        } catch (e) { toast('No se emitió', e.message, 'error'); if (btn) btn.disabled = false; }
        finally { emitiendo = false; }
    }

    async function abrir() {
        const r = root(); if (!r) return;
        const f = leerFirma(); if (f) firma = f;
        borrador = cargarBorrador();
        r.innerHTML = '<p class="act-hint" style="padding:24px;">Cargando…</p>';
        try {
            await Promise.all([cargarBodegas(), cargarHistorial().catch(() => { historial = []; })]);
            if (!borrador.origen) { const c = bodegas.find(b => /central/i.test(b.name)); if (c) borrador.origen = c.name; }
            else if (!bodegas.some(b => b.name === borrador.origen)) { borrador.origen = null; borrador.items = []; }
            await cargarStock();
        } catch (e) { r.innerHTML = `<p class="act-err" style="padding:24px;">No se pudo cargar: ${esc(e.message)}</p>`; return; }
        pintar();
    }

    window.SAR_ActasEntrega = { abrir, planificar, cuadrar, restaurarConSobregiro, detalleDe, descargarActa: (a, f) => descargar(actaParaDoc(a), f), descontarFEFO, restaurarLotes, numeroActa, validarBorrador, emitir, anular, lotesDeDoc };
    if (typeof module !== 'undefined') module.exports = window.SAR_ActasEntrega;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: { dataset: {} } });
