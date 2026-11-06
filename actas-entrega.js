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
        else if (!b.items.some(i => num(i.cantidad) > 0 || num(i.solicitado) > 0)) errores.push('Indica cantidad a entregar, o 0 con la cantidad pedida para dejarlo pendiente del centro.');
        if (b.items.length > MAX_ITEMS) errores.push(`Máximo ${MAX_ITEMS} productos por acta.`);
        b.items.forEach(i => { if (!(num(i.cantidad) > 0 || (num(i.cantidad) === 0 && num(i.solicitado) > 0)) || num(i.cantidad) !== Math.floor(num(i.cantidad))) errores.push(`Cantidad inválida en ${i.nombre}.`); else if (!String(i.nombre || '').trim() || (i.manual && String(i.nombre).trim().length < 3)) errores.push('Un producto manual necesita nombre.'); else if (i.controlado && num(i.cantidad) > num(i.stock)) errores.push(`${i.nombre}: es medicamento controlado, no puede entregarse sin stock en sistema (requiere folio DAU en registro separado).`); });
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
    let centrosGuardados = [];
    let catalogo = [], catCargado = false;   // Catalogo_Productos: nombre <-> ID del producto (Mercado Público)
    const slugC = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const normN = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const codDe = (nombre) => { const n = normN(nombre); const c = catalogo.find(x => x.codigoMP && (normN(x.insumoName) === n || normN(x.descripcion) === n)); return c ? String(c.codigoMP) : ''; };
    async function cargarCatalogo() {
        if (catCargado) return; catCargado = true;
        try { const sn = await fs().getDocs(fs().query(fs().collection(db(), 'Catalogo_Productos'), fs().limit(5000))); catalogo = []; sn.forEach(d => catalogo.push({ id: d.id, ...d.data() })); } catch (e) { catCargado = false; return; }
        // Otros lugares donde puede haber quedado registrado un producto (otras bodegas, órdenes de compra, actas anteriores): se suman a la búsqueda
        const f = fs(), vistoN = new Set(catalogo.map(c => normN(c.descripcion || c.insumoName))), vistoC = new Set(catalogo.map(c => String(c.codigoMP || '')).filter(Boolean));
        const sumar = (nombre, cod, origen, imagen) => {
            const nom = String(nombre || '').trim(); if (nom.length < 3) return; const c = cod ? String(cod).replace(/\D/g, '') : '', nn = normN(nom);
            if (vistoN.has(nn) || (c && vistoC.has(c))) return; vistoN.add(nn); if (c) vistoC.add(c);
            catalogo.push({ id: null, descripcion: nom, insumoName: nom, codigoMP: c, derivado: origen, ...(imagen ? { imagen } : {}) });
        };
        try { const sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(4000))); sn.forEach(d => { const x = d.data(); sumar(x.name, x.codigoMP, 'otra bodega'); }); } catch (e) { /* sin permiso o sin conexión */ }
        try { const sn = await f.getDocs(f.query(f.collection(db(), 'Seguimiento_OC'), f.limit(400))); sn.forEach(d => (d.data().lineas || []).forEach(l => sumar(l.descripcion, l.codigoMP, 'orden de compra'))); } catch (e) { /* idem */ }
        try { const sn = await f.getDocs(f.query(f.collection(db(), 'Actas_Entrega'), f.orderBy('creadoEn', 'desc'), f.limit(150))); sn.forEach(d => { const a = d.data(); (a.items || []).forEach(i => sumar(i.nombre, i.codigoMP, 'acta anterior')); (a.pendientes || []).forEach(i => sumar(i.nombre, i.codigoMP, 'acta anterior')); }); } catch (e) { /* idem */ }
    }
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
        bodegas = []; snap.forEach(d => { const b = { id: d.id, ...d.data() }; if (b.name && b.isActive !== false) bodegas.push(b); });
        // También aparecen las bodegas que tienen stock (p. ej. donde ingresó una recepción) y la Central, aunque no tengan ficha en Bodegas
        try {
            const ins = await fs().getDocs(fs().query(fs().collection(db(), 'Insumos'), fs().limit(3000)));
            const ya = new Set(bodegas.map(x => String(x.name).toLowerCase()));
            ins.forEach(d => { const l = String(d.data().location || '').trim(); if (l && !ya.has(l.toLowerCase())) { ya.add(l.toLowerCase()); bodegas.push({ id: 'loc_' + l, name: l, derivada: true }); } });
        } catch (e) { /* solo las fichas */ }
        if (!bodegas.some(x => /central/i.test(String(x.name)))) bodegas.push({ id: 'loc_central', name: 'Bodega Central', derivada: true });
        const central = (b) => /central/i.test(String(b.name || ''));
        bodegas.sort((a, b) => (central(b) - central(a)) || String(a.name).localeCompare(String(b.name), 'es'));
    }
    // Centros a los que se entrega: los de siempre + los que se agregan (quedan guardados en Centros_Entrega) + los de actas anteriores
    const normC = (t) => String(t || '').trim().replace(/\s+/g, ' ');
    function listaCentros() {
        const m = new Map(); [...CENTROS, ...centrosGuardados, ...historial.map(a => a.centro)].forEach(c => { const n = normC(c); if (n && !m.has(n.toLowerCase())) m.set(n.toLowerCase(), n); });
        return [...m.values()].sort((a, b) => a.localeCompare(b, 'es'));
    }
    async function cargarCentros() {
        try { const sn = await fs().getDocs(fs().collection(db(), 'Centros_Entrega')); centrosGuardados = []; sn.forEach(d => { if (d.data().nombre) centrosGuardados.push(d.data().nombre); }); } catch (e) { /* sin lista guardada */ }
    }
    async function guardarCentro(nombre) {
        const n = normC(nombre); if (!n) return false;
        if (listaCentros().some(c => c.toLowerCase() === n.toLowerCase()) && centrosGuardados.some(c => c.toLowerCase() === n.toLowerCase())) return false;
        const id = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'centro';
        await fs().setDoc(fs().doc(fs().collection(db(), 'Centros_Entrega'), id), { nombre: n, creadoPor: usuarioEmail(), creadoEn: fs().serverTimestamp() }, { merge: true });
        centrosGuardados.push(n); return true;
    }
    // Actas emitidas que aún esperan el acta firmada: su stock sigue en bodega pero está comprometido (reservado)
    let pendConf = [];
    async function cargarPendConf() {
        const f = fs();
        try { const sn = await f.getDocs(f.query(f.collection(db(), 'Actas_Entrega'), f.where('confirmacion.estado', '==', 'PENDIENTE'), f.limit(300))); pendConf = []; sn.forEach(d => { const a = d.data(); if (a.estado === 'EMITIDA') pendConf.push({ id: d.id, ...a }); }); } catch (e) { pendConf = []; }
    }
    const reservadoItem = (id, nombre) => pendConf.reduce((t, a) => t + (a.items || []).filter(i => (id && i.id === id) || (!i.id && nombre && normN(i.nombre) === normN(nombre))).reduce((s2, i) => s2 + num(i.cantidad), 0), 0);
    const reservadoOC = (ocId, key, ocI) => pendConf.filter(a => a.oc && a.oc.id === ocId && a.oc.columna === key).reduce((t, a) => t + (a.items || []).filter(i => i.ocI === ocI).reduce((s2, i) => s2 + num(i.cantidad), 0), 0);
    async function cargarStock() {
        stock = [];
        await cargarPendConf();
        if (!borrador.origen) return;
        await cargarCatalogo();
        const f = fs();
        const snap = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('location', '==', borrador.origen), f.limit(1500)));
        snap.forEach(d => { const x = d.data(); if (x.status !== 'CUARENTENA') stock.push({ id: d.id, codigo: String(x.codigoMP || '') || codDe(x.name), name: x.name || '', quantity: num(x.quantity), sobregiro: num(x.sobregiro), reserv: reservadoItem(d.id, x.name), disp: Math.max(0, num(x.quantity) - num(x.sobregiro) - reservadoItem(d.id, x.name)), controlado: !!x.controlado, provisional: !!x.provisional, batches: lotesDeDoc(x) }); });
        stock.sort((a, b) => (b.disp > 0) - (a.disp > 0) || a.name.localeCompare(b.name, 'es'));
    }
    async function cargarHistorial() {
        const f = fs();
        const snap = await f.getDocs(f.query(f.collection(db(), 'Actas_Entrega'), f.orderBy('creadoEn', 'desc'), f.limit(40)));
        historial = []; snap.forEach(d => historial.push({ id: d.id, ...d.data() }));
    }


    /** Emite el acta SIN descontar stock: queda "por confirmar" hasta subir el acta firmada (el stock solo se reserva). */
    async function emitirDiferido(b, usuario) {
        const f = fs();
        const soloPend = b.items.filter(i => num(i.cantidad) === 0 && num(i.solicitado) > 0);
        if (soloPend.length) b = { ...b, items: b.items.filter(i => num(i.cantidad) > 0), pendientes: [...(b.pendientes || []), ...soloPend.map(i => ({ nombre: i.nombre, cantidad: num(i.solicitado), ...(i.codigo ? { codigoMP: String(i.codigo) } : {}) }))] };
        const anio = new Date().getFullYear(), ctrRef = f.doc(f.collection(db(), 'Contadores'), `acta-${anio}`), fecha = new Date().toISOString().slice(0, 10);
        const items = b.items.map(i => ({ ...i }));
        await cargarPendConf();
        const resultado = await f.runTransaction(db(), async (tx) => {
            const cs = await tx.get(ctrRef); const n = (cs.exists() ? num(cs.data().ultimo) : 0) + 1; const numero = numeroActa(anio, n);
            let ocLineas = null, autoPend = [];
            if (b.oc) {
                const ocRef = f.doc(f.collection(db(), 'Seguimiento_OC'), b.oc.id), ocSnap = await tx.get(ocRef);
                if (!ocSnap.exists()) throw new Error('La orden de compra ya no existe.');
                ocLineas = ocSnap.data().lineas || [];
                items.forEach(i => {
                    const l = ocLineas[i.ocI]; if (!l) throw new Error(`${i.nombre}: la línea de la orden no existe.`);
                    const ent = num(l.entregado && l.entregado[b.oc.key]), disp = num(l.ingresado && l.ingresado[b.oc.key]) - ent - reservadoOC(b.oc.id, b.oc.key, i.ocI);
                    if (num(i.cantidad) > disp) throw new Error(`${i.nombre}: solo quedan ${Math.max(0, disp)} u. por entregar de esta orden (hay actas por confirmar o alguien entregó antes). Actualiza la pantalla.`);
                    i.solicitado = num(l.dist && l.dist[b.oc.key]); i.entregadoTotal = ent + num(i.cantidad);
                });
                const yaEn = new Set(items.map(i => i.ocI));
                autoPend = ocLineas.map((l, idx) => ({ l, idx, p: num(l.dist && l.dist[b.oc.key]) - num(l.entregado && l.entregado[b.oc.key]) - items.filter(i => i.ocI === idx).reduce((t, i) => t + num(i.cantidad), 0) }))
                    .filter(x => !yaEn.has(x.idx) && x.p > 0).map(x => ({ nombre: String(x.l.descripcion || '').toUpperCase(), cantidad: x.p }));
            }
            const itemsActa = items.map(i => ({ id: i.id || null, nombre: String(i.nombre || '').toUpperCase() === i.nombre ? i.nombre : i.nombre, cantidad: num(i.cantidad), ...(i.manual && !i.id ? { manual: true } : {}), ...(i.codigo ? { codigoMP: String(i.codigo) } : {}), ...(!b.oc && num(i.solicitado) > num(i.cantidad) ? { solicitado: num(i.solicitado), entregadoTotal: num(i.cantidad) } : {}), ...(i.fisico && normN(i.fisico) !== normN(i.nombre) ? { entregaFisica: { nombre: String(i.fisico).trim().toUpperCase(), ...(codDe(i.fisico) ? { codigoMP: codDe(i.fisico) } : {}) } } : {}), ...(b.oc ? { ocI: i.ocI, solicitado: i.solicitado, entregadoTotal: i.entregadoTotal } : {}) }));
            tx.set(ctrRef, { ultimo: n, anio, updatedAt: f.serverTimestamp() });
            const acta = {
                numero, fecha, centro: b.centro.trim(), bodegaOrigen: b.origen, estado: 'EMITIDA', stockDescontado: false, conSobregiro: false,
                confirmacion: { estado: 'PENDIENTE' },
                items: itemsActa, pendientes: [...b.pendientes.map(p => ({ nombre: p.nombre, cantidad: num(p.cantidad), ...(p.codigoMP ? { codigoMP: String(p.codigoMP) } : {}) })), ...autoPend],
                documentos: b.documentos.map(d => ({ tipo: d.tipo, numero: d.numero, detalle: d.detalle || '' })),
                entrega: { nombre: firma.nombre, cargo: firma.cargo }, recibe: { nombre: (b.recibe && b.recibe.nombre) || '', cargo: (b.recibe && b.recibe.cargo) || '' },
                creadoPor: usuario, creadoEn: f.serverTimestamp()
            };
            if (b.oc) acta.oc = { id: b.oc.id, numeroOC: b.oc.numeroOC || '', columna: b.oc.key, memo: b.oc.memo || '', cdp: b.oc.cdp || '' };
            tx.set(f.doc(f.collection(db(), 'Actas_Entrega'), numero), acta);
            return { ...acta, creadoEn: new Date().toISOString() };
        });
        for (const i of [...items, ...soloPend].filter(x => x.manual || x.codigoNuevo || x.imagen)) {
            try {
                const cod = String(i.codigo || '').trim(), id = slugC(cod || i.nombre) || 'manual';
                await f.setDoc(f.doc(f.collection(db(), 'Catalogo_Productos'), id), { descripcion: i.nombre, descripcion_lower: String(i.nombre).toLowerCase(), codigoMP: cod, insumoName: i.nombre, ...(i.imagen ? { imagen: i.imagen } : {}), ...(i.manual ? { sinOrden: true, origen: 'MANUAL', creadoEn: f.serverTimestamp(), creadoPor: usuario } : {}), actualizado: f.serverTimestamp() }, { merge: true });
                catCargado = false;
            } catch (e) { /* el acta ya se emitió */ }
        }
        buscarFotosEnSegundoPlano([...items, ...soloPend]);
        await cargarPendConf();
        return resultado;
    }

    // Respaldo (acta firmada escaneada): se guarda en partes en Contadores (colección ya abierta al personal) y, si el acta viene de una orden, también en los archivos de la OC
    const TROZO_R = 700000, MAX_R = 6 * 1024 * 1024;
    async function guardarRespaldo(numero, file, usuario, ocId) {
        const f = fs(); if (!file) throw new Error('Falta el archivo del acta firmada.');
        if (!/^(application\/pdf|image\/)/.test(file.type || '')) throw new Error('El respaldo debe ser PDF o una foto/imagen.');
        if (file.size > MAX_R) throw new Error('El archivo pesa más de 6 MB. Reduce la calidad del escaneo.');
        const u = new Uint8Array(await file.arrayBuffer()); let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
        const b64 = btoa(bin), partes = []; for (let i = 0; i < b64.length; i += TROZO_R) partes.push(b64.slice(i, i + TROZO_R));
        for (let i = 0; i < partes.length; i++) await f.setDoc(f.doc(f.collection(db(), 'Contadores'), `respaldo-${numero}-${String(i).padStart(3, '0')}`), { tipo: 'respaldo-acta', actaId: numero, n: i, b64: partes[i], mime: file.type, updatedAt: f.serverTimestamp() });
        if (ocId && window.SAR_SeguimientoOC && window.SAR_SeguimientoOC.guardarArchivo) { try { await window.SAR_SeguimientoOC.guardarArchivo(ocId, { nombre: file.name, categoria: 'Acta firmada ' + numero, bytes: u, mime: file.type }); } catch (e) { /* queda igual en el acta */ } }
        return { nombre: file.name, mime: file.type, tamano: u.length, partes: partes.length, subidoPor: usuario, fecha: new Date().toISOString() };
    }
    async function verRespaldo(a) {
        const f = fs(), r = a.respaldo; if (!r) return;
        const bs = []; for (let i = 0; i < r.partes; i++) { const d = await f.getDoc(f.doc(f.collection(db(), 'Contadores'), `respaldo-${a.numero}-${String(i).padStart(3, '0')}`)); if (!d.exists()) throw new Error('Falta una parte del archivo.'); bs.push(d.data().b64); }
        const bin = atob(bs.join('')), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        window.open(URL.createObjectURL(new Blob([u], { type: r.mime || 'application/pdf' })), '_blank');
    }
    /** Confirma la entrega: sube el acta firmada y recién ahí se descuenta el stock (misma lógica de lotes, sobregiro, historial y orden de compra). */
    async function confirmarEntrega(a, file, usuario) {
        const f = fs();
        const resp = await guardarRespaldo(a.numero, file, usuario, a.oc && a.oc.id);
        const b = { origen: a.bodegaOrigen, centro: a.centro, pendientes: a.pendientes || [], documentos: a.documentos || [], recibe: a.recibe || {}, oc: a.oc && a.oc.id ? { id: a.oc.id, key: a.oc.columna, numeroOC: a.oc.numeroOC, memo: a.oc.memo, cdp: a.oc.cdp } : null,
            items: (a.items || []).map(i => ({ id: i.id || null, manual: !i.id, nombre: i.nombre, codigo: i.codigoMP || '', cantidad: num(i.cantidad), solicitado: num(i.solicitado), ocI: i.ocI, fisico: i.entregaFisica ? i.entregaFisica.nombre : '' })) };
        return emitir(b, usuario, { numero: a.numero, respaldo: resp });
    }
    async function subirFirmada(a, file, usuario) {
        const resp = await guardarRespaldo(a.numero, file, usuario, a.oc && a.oc.id);
        await fs().updateDoc(fs().doc(fs().collection(db(), 'Actas_Entrega'), a.numero), { respaldo: resp, respaldoEn: fs().serverTimestamp() });
        return resp;
    }
    const pedirArchivo = () => new Promise((ok) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/pdf,image/*'; i.onchange = () => ok(i.files && i.files[0] || null); i.oncancel = () => ok(null); i.click(); });

    /** Emite el acta: correlativo + descuento + sobregiro + historial en una sola transacción. */
    async function emitir(b, usuario, opc) {
        const f = fs(); opc = opc || {};
        // Productos con cantidad 0 y pedido: no se entregan, quedan como pendientes del centro (y su nombre/ID/foto van al catálogo)
        const soloPend = b.items.filter(i => num(i.cantidad) === 0 && num(i.solicitado) > 0);
        if (soloPend.length) b = { ...b, items: b.items.filter(i => num(i.cantidad) > 0), pendientes: [...(b.pendientes || []), ...soloPend.map(i => ({ nombre: i.nombre, cantidad: num(i.solicitado), ...(i.codigo ? { codigoMP: String(i.codigo) } : {}) }))] };
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
        const resultado = await f.runTransaction(db(), async (tx) => {
            let n = 0, numero = opc.numero;
            if (!numero) { const cs = await tx.get(ctrRef); n = (cs.exists() ? num(cs.data().ultimo) : 0) + 1; numero = numeroActa(anio, n); }
            const actaRef = f.doc(f.collection(db(), 'Actas_Entrega'), numero);
            if (opc.numero) { const as0 = await tx.get(actaRef); const c0 = as0.exists() && as0.data().confirmacion; if (!c0 || c0.estado !== 'PENDIENTE' || as0.data().estado !== 'EMITIDA') throw new Error('Esta acta ya no está pendiente de confirmar.'); }
            const snaps = [];
            for (const r of refs) snaps.push(r.i.nuevo ? null : await tx.get(r.ref));
            // Entrega desde una orden de compra (v20.55): se valida y se actualiza lo entregado de cada línea
            let ocSnap = null, ocRef = null, ocLineas = null, autoPend = [];
            if (b.oc) {
                ocRef = f.doc(f.collection(db(), 'Seguimiento_OC'), b.oc.id); ocSnap = await tx.get(ocRef);
                if (!ocSnap.exists()) throw new Error('La orden de compra ya no existe.');
                ocLineas = (ocSnap.data().lineas || []).map(l => ({ ...l, entregado: { ...(l.entregado || {}) } }));
                items.forEach(i => {
                    const l = ocLineas[i.ocI]; if (!l) throw new Error(`${i.nombre}: la línea de la orden no existe.`);
                    const disp = num(l.ingresado && l.ingresado[b.oc.key]) - num(l.entregado[b.oc.key]);
                    if (num(i.cantidad) > disp) throw new Error(`${i.nombre}: solo quedan ${Math.max(0, disp)} u. por entregar de esta orden (alguien más pudo entregar antes). Actualiza la pantalla.`);
                    l.entregado[b.oc.key] = num(l.entregado[b.oc.key]) + num(i.cantidad);
                    i.solicitado = num(l.dist && l.dist[b.oc.key]); i.entregadoTotal = l.entregado[b.oc.key];
                });
                // Lo solicitado que aún no se entrega (no llegó o queda fuera de esta acta) figura como pendiente en el acta
                const yaEn = new Set(items.map(i => i.ocI));
                autoPend = ocLineas.map((l, idx) => ({ idx, l, p: num(l.dist && l.dist[b.oc.key]) - num(l.entregado[b.oc.key]) }))
                    .filter(x => !yaEn.has(x.idx) && x.p > 0).map(x => ({ nombre: String(x.l.descripcion || '').toUpperCase(), cantidad: x.p }));
            }
            const base = (r) => ({ ...(r.i.codigo ? { codigoMP: String(r.i.codigo) } : {}), name: r.i.nombre, name_lowercase: String(r.i.nombre).toLowerCase(), location: b.origen, quantity: 0, batches: [], sobregiro: 0, provisional: true, category: 'Provisional', criticalLimit: 50, isCritical: true, unitPrice: 0, status: 'ACTIVO', createdAt: f.serverTimestamp(), createdBy: usuario });
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
            const itemsActa = refs.map((r, k) => ({ id: r.ref.id, nombre: r.i.nombre, cantidad: num(r.i.cantidad), lotes: calc[k].usados, sinRespaldo: calc[k].faltante, ...(datos[k].codigoMP || r.i.codigo ? { codigoMP: String(datos[k].codigoMP || r.i.codigo) } : {}), ...(!b.oc && num(r.i.solicitado) > num(r.i.cantidad) ? { solicitado: num(r.i.solicitado), entregadoTotal: num(r.i.cantidad) } : {}), ...(r.i.nuevo ? { provisional: true } : {}), ...(r.i.fisico && normN(r.i.fisico) !== normN(r.i.nombre) ? { entregaFisica: { nombre: String(r.i.fisico).trim().toUpperCase(), ...(codDe(r.i.fisico) ? { codigoMP: codDe(r.i.fisico) } : {}) } } : {}), ...(b.oc ? { ocI: r.i.ocI, solicitado: r.i.solicitado, entregadoTotal: r.i.entregadoTotal } : {}) }));
            refs.forEach((r, k) => {
                const d = datos[k], c = calc[k];
                const limite = num(d.criticalLimit || d.stock_minimo || 50);
                const prox = c.batches[0];
                const cambios = { ...(r.i.codigoNuevo && r.i.codigo && !d.codigoMP ? { codigoMP: String(r.i.codigo) } : {}), quantity: c.quantity, batches: c.batches, sobregiro: c.sobregiro, sobregiroDetalle: c.sobregiroDetalle, isCritical: c.quantity <= limite, ...(prox ? { batch: prox.batch, expirationDate: prox.expirationDate || '' } : {}), updatedAt: f.serverTimestamp() };
                if (r.i.nuevo) tx.set(r.ref, { ...d, ...cambios }); else tx.update(r.ref, cambios);
                c.cubiertas.forEach(cu => tx.set(f.doc(f.collection(db(), 'Historial_Movimientos')), { insumoName: d.name, quantity: cu.qty, type: 'CUADRE_SOBREGIRO', user: usuario, date: f.serverTimestamp(), document: numero, batch: 'MULTI-LOTE', origin: b.origen, idInsumoOrigen: r.ref.id, observacion: `Cuadre automático al ${opc.numero ? 'confirmar' : 'emitir'} ${numero}: ${cu.qty} u. del acta ${cu.acta} ya estaban entregadas sin respaldo`, actaId: cu.acta, cuadradoPor: numero }));
                tx.set(r.hist, {
                    insumoName: d.name, quantity: num(r.i.cantidad), type: 'ENTREGA_ACTA', user: usuario, date: f.serverTimestamp(), document: numero,
                    batch: c.usados.length === 1 ? c.usados[0].batch : (c.usados.length ? 'MULTI-LOTE' : 'SIN-RESPALDO'), origin: b.origen, dest: b.centro, lotes: c.usados,
                    idInsumoOrigen: r.ref.id, sinRespaldo: c.faltante,
                    observacion: `Acta de entrega ${numero}${c.faltante > 0 ? ` · ${c.faltante} u. sin respaldo en sistema (sobregiro)` : ''}${r.i.nuevo ? ' · insumo provisional' : ''}`, actaId: numero
                });
            });
            if (!opc.numero) tx.set(ctrRef, { ultimo: n, anio, updatedAt: f.serverTimestamp() });
            const acta = {
                numero, fecha, centro: b.centro.trim(), bodegaOrigen: b.origen, estado: 'EMITIDA', stockDescontado: true,
                conSobregiro: itemsActa.some(i => i.sinRespaldo > 0),
                items: itemsActa, pendientes: [...b.pendientes.map(p => ({ nombre: p.nombre, cantidad: num(p.cantidad), ...(p.codigoMP ? { codigoMP: String(p.codigoMP) } : {}) })), ...autoPend],
                documentos: b.documentos.map(d => ({ tipo: d.tipo, numero: d.numero, detalle: d.detalle || '' })),
                entrega: { nombre: firma.nombre, cargo: firma.cargo }, recibe: { nombre: (b.recibe && b.recibe.nombre) || '', cargo: (b.recibe && b.recibe.cargo) || '' },
                creadoPor: usuario, creadoEn: f.serverTimestamp()
            };
            if (b.oc) acta.oc = { id: b.oc.id, numeroOC: b.oc.numeroOC || '', columna: b.oc.key, memo: b.oc.memo || '', cdp: b.oc.cdp || '' };
            if (opc.numero) tx.update(actaRef, { items: itemsActa, stockDescontado: true, conSobregiro: acta.conSobregiro, confirmacion: { estado: 'CONFIRMADA', fecha: fecha, por: usuario, ...(opc.respaldo ? { respaldo: opc.respaldo } : {}) }, respaldo: opc.respaldo || null, confirmadaEn: f.serverTimestamp() });
            else tx.set(actaRef, acta);
            if (b.oc) {
                tx.update(ocRef, { lineas: ocLineas, actualizadoEn: f.serverTimestamp() });
                tx.set(f.doc(f.collection(db(), 'Seguimiento_OC', b.oc.id, 'Eventos')), { tipo: 'ENTREGA', texto: `Acta ${numero} a ${b.centro.trim()}${b.oc.memo ? ' (memo ' + b.oc.memo + ')' : ''}:\n` + itemsActa.map(i => `- ${i.nombre}: ${i.cantidad} un.`).join('\n'), autor: usuario, fecha: f.serverTimestamp(), columna: b.oc.key, actaId: numero });
            }
            return { ...acta, creadoEn: new Date().toISOString() };
        });
        // Productos que no venían de ninguna orden: quedan en el catálogo (nombre + ID) para reconocerlos la próxima vez y asociarlos a una orden
        for (const i of [...items, ...soloPend].filter(x => x.nuevo || x.manual || x.codigoNuevo || x.imagen)) {
            try {
                const cod = String(i.codigo || '').trim(), id = slugC(cod || i.nombre) || 'manual';
                await f.setDoc(f.doc(f.collection(db(), 'Catalogo_Productos'), id), { descripcion: i.nombre, descripcion_lower: String(i.nombre).toLowerCase(), codigoMP: cod, insumoName: i.nombre, ...(i.imagen ? { imagen: i.imagen } : {}), ...((i.nuevo || i.manual) ? { sinOrden: true, origen: 'MANUAL', creadoEn: f.serverTimestamp(), creadoPor: usuario } : {}), actualizado: f.serverTimestamp() }, { merge: true });
                catCargado = false;
            } catch (e) { /* el acta ya se emitió */ }
        }
        buscarFotosEnSegundoPlano([...items, ...soloPend]);   // sin esperar: el acta ya quedó emitida
        return resultado;
    }

    /** Tras emitir: si un producto del acta no tiene foto, la busca (por ID o, si no hay, por su descripción) y la deja "por confirmar" en el catálogo. */
    async function buscarFotosEnSegundoPlano(items) {
        try {
            const IM = window.SAR_Imagenes, f = fs(); if (!IM || !IM.buscarFoto) return;
            const faltan = items.filter(i => !(IM.buscar(i.nombre, i.codigo) || (IM.buscarConCandidata && IM.buscarConCandidata(i.nombre, i.codigo)))).slice(0, 10); if (!faltan.length) return;
            const sn = await f.getDoc(f.doc(f.collection(db(), 'Config_Correo'), 'principal')); const cfg = sn.exists() ? sn.data() : null;
            if (!(cfg && cfg.webhookUrl && cfg.token)) return;
            let n = 0;
            for (const i of faltan) {
                const cod = String(i.codigo || '').trim();
                const r = cod ? await IM.buscarFoto(cod, cfg) : await IM.buscarPorDescripcion(i.nombre, cfg);
                if (!(r && r.archivo)) continue;
                const prev = catalogo.find(c => (cod && String(c.codigoMP || '') === cod) || normN(c.descripcion) === normN(i.nombre));
                await f.setDoc(f.doc(f.collection(db(), 'Catalogo_Productos'), prev ? prev.id : (slugC(cod || i.nombre) || 'manual')), { descripcion: i.nombre, descripcion_lower: String(i.nombre).toLowerCase(), codigoMP: cod, imagenMP: r.archivo, fotoEstado: r.origen === 'semilla' ? 'confirmada' : 'por_confirmar', ...(r.titulo ? { fotoTitulo: r.titulo } : {}), actualizado: f.serverTimestamp() }, { merge: true }); n++;
            }
            if (n) { catCargado = false; if (IM.recargar) IM.recargar(); toast('Fotos', `${n} foto(s) encontrada(s) para productos del acta: confírmalas en Catálogo de productos.`, 'info'); }
        } catch (e) { /* la foto es un extra: nunca debe afectar al acta */ }
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
            if (a.confirmacion && a.confirmacion.estado === 'PENDIENTE') { tx.update(actaRef, { estado: 'ANULADA', stockDescontado: false, anuladaEn: f.serverTimestamp(), anuladaPor: usuario, anulacionMotivo: motivo }); return; }   // nunca salió del stock
            const refs = a.items.map(i => ({ i, ref: f.doc(f.collection(db(), 'Insumos'), i.id), hist: f.doc(f.collection(db(), 'Historial_Movimientos')) }));
            const snaps = []; for (const r of refs) snaps.push(await tx.get(r.ref));
            let ocRef = null, ocLineas = null;
            if (a.oc && a.oc.id) {                  // devuelve lo entregado a la orden
                ocRef = f.doc(f.collection(db(), 'Seguimiento_OC'), a.oc.id); const os = await tx.get(ocRef);
                if (os.exists()) { ocLineas = (os.data().lineas || []).map(l => ({ ...l, entregado: { ...(l.entregado || {}) } })); a.items.forEach(i => { const l = ocLineas[i.ocI]; if (l) l.entregado[a.oc.columna] = Math.max(0, num(l.entregado[a.oc.columna]) - num(i.cantidad)); }); }
            }
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
            if (ocLineas) {
                tx.update(ocRef, { lineas: ocLineas, actualizadoEn: f.serverTimestamp() });
                tx.set(f.doc(f.collection(db(), 'Seguimiento_OC', a.oc.id, 'Eventos')), { tipo: 'ANULACION_ENTREGA', texto: `Acta ${numero} anulada: lo entregado vuelve a quedar pendiente. Motivo: ${motivo}`, autor: usuario, fecha: f.serverTimestamp(), columna: a.oc.columna, actaId: numero });
            }
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
            const bytes = await D.generarPDF(acta, { PDFLib, logoBytes });
            bajar(bytes, D.nombreArchivo(acta, 'pdf'), 'application/pdf');
            return { bytes, nombre: D.nombreArchivo(acta, 'pdf') };
        } else {
            bajar(D.generarDOCX(acta, { logoBytes }), D.nombreArchivo(acta, 'docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        }
    }
    const actaParaDoc = (a) => ({ ...a, items: (a.items || []).map(i => ({ nombre: i.nombre, cantidad: i.cantidad, solicitado: i.solicitado, entregadoTotal: i.entregadoTotal })) });

    // ---------------------------------------------------------------
    // Interfaz
    // ---------------------------------------------------------------
    const root = () => document.getElementById('act-root');
    let tab = 'emitir';
    const TABS = [['emitir', 'ph-file-plus', 'Emitir acta'], ['emitidas', 'ph-files', 'Actas emitidas'], ['seguimiento', 'ph-magnifying-glass', 'Seguimiento de acta']];

    function pintar() {
        const r = root(); if (!r) return;
        const q = busqueda.trim().toLowerCase();
        const lista = stock.filter(s => !q || s.name.toLowerCase().includes(q) || String(s.codigo || '').includes(q)).slice(0, 80);
        const yaEsta = (id) => borrador.items.some(i => i.id === id);
        // Productos del catálogo (p. ej. ingresados a mano antes) que no están en el stock de esta bodega: también aparecen al buscar
        const enCat = (!borrador.origen || q.length < 2) ? [] : (() => {
            const vistos = new Set(stock.map(x => normN(x.name))), codS = new Set(stock.map(x => String(x.codigo || '')).filter(Boolean)), out = [];
            catalogo.forEach((c, ci) => {
                const nom = String(c.descripcion || c.insumoName || '').toUpperCase(), cod = c.codigoMP ? String(c.codigoMP) : '', nn = normN(nom);
                if (!nom || vistos.has(nn) || (cod && codS.has(cod))) return;
                if (!(nom.toLowerCase().includes(q) || cod.includes(q))) return;
                vistos.add(nn); out.push({ ci, nombre: nom, codigo: cod, imagen: c.imagen || '', derivado: c.derivado || '' });
            });
            return out.slice(0, 15);
        })();
        const yaCat = (x) => borrador.items.some(i => i.manual && (normN(i.nombre) === normN(x.nombre) || (x.codigo && i.codigo === x.codigo)));
        const esCero = (i) => num(i.cantidad) === 0 && num(i.solicitado) > 0;   // no se entrega nada: queda pendiente del centro
        const pares = borrador.items.map((i, k) => [i, k]);
        const entregan = pares.filter(([i]) => !esCero(i)), enCero = pares.filter(([i]) => esCero(i));
        const filaItem = (i, k) => `<div class="act-fila"><div class="act-fn">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(i.nombre, { codigo: i.codigo }) : ''}${esc(i.nombre)}${i.manual ? ' <small>(manual · provisional)</small>' : ''}<small>${i.codigo ? '<b>ID ' + esc(i.codigo) + '</b> · ' : (i.manual ? '' : `<input class="act-cod" data-k="${k}" inputmode="numeric" placeholder="Sin ID: escríbelo aquí (opcional)" aria-label="ID de Mercado Público"> `)}Disponible: ${num(i.stock)}${num(i.solicitado) > num(i.cantidad) ? ` · pedido ${num(i.solicitado)} · <b>pendiente ${num(i.solicitado) - num(i.cantidad)}</b>` : ''}${num(i.cantidad) > num(i.stock) ? ` · <span class="act-sin">sin respaldo: ${num(i.cantidad) - num(i.stock)}</span>` : ''}</small>${fotoDe(i, k)}<small class="act-fis-w"><input class="act-fis" data-k="${k}" list="act-fisl" value="${esc(i.fisico || '')}" placeholder="¿Entregas físicamente otro similar? Escríbelo (solo interno, no sale en el acta)" aria-label="Producto que se entrega físicamente"></small></div>
                <input type="number" min="0" value="${num(i.solicitado) > num(i.cantidad) ? num(i.solicitado) : ''}" class="act-qty act-sedit" data-k="${k}" placeholder="Pedido" aria-label="Cantidad pedida"><input type="number" min="0" value="${i.cantidad}" class="act-qty act-edit" data-k="${k}" aria-label="Cantidad a entregar"><button type="button" class="btn btn-outline act-del" data-k="${k}" aria-label="Quitar">✕</button></div>`;
        const errores = validarBorrador(borrador);
        r.innerHTML = `
        <div class="page-header mb-24"><div class="page-title"><h2>Actas de entrega</h2>
            <p>Arma el acta desde el stock de la bodega. Al emitirla se descuenta el stock y queda con su número.</p></div></div>
        <nav class="act-tabs" role="tablist" aria-label="Secciones de actas de entrega">${TABS.map(t => `<button type="button" role="tab" class="act-tab${t[0] === tab ? ' active' : ''}" data-tab="${t[0]}" aria-selected="${t[0] === tab}"><i class="ph-bold ${t[1]}"></i><span>${t[2]}</span>${t[0] === 'emitidas' ? `<em>${historial.length}</em>` : ''}</button>`).join('')}</nav>
        <div data-act-tab="emitir"${tab === 'emitir' ? '' : ' hidden'}>
        <div class="act-grid">
          <div class="act-col">
            <h3 class="act-h">1 · Stock disponible</h3>
            <label class="act-l">Bodega de origen
              <select id="act-origen"><option value="">— elegir —</option>${bodegas.map(b => `<option value="${esc(b.name)}"${b.name === borrador.origen ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
            <input id="act-buscar" type="search" placeholder="Buscar por nombre o ID del producto…" value="${esc(busqueda)}" autocomplete="off">
            <details class="act-det act-manual"${(manualAbierto || borrador.items.some(i => i.manual)) ? ' open' : ''}><summary>¿No está en el sistema? Ingreso manual</summary>
              <p class="act-hint">Se asume que lo tienes físicamente. Queda como insumo provisional y como <b>sobregiro</b> (saldo contable negativo) hasta que ingrese la OC/SDC y se cuadre.</p>
              <div class="act-fila act-docs"><input id="act-mn" list="act-mnl" placeholder="Nombre del insumo" autocomplete="off"><datalist id="act-mnl">${catalogo.slice(0, 1500).map(c => `<option value="${esc(String(c.descripcion || c.insumoName || '').toUpperCase())}">`).join('')}</datalist><input id="act-mid" inputmode="numeric" placeholder="ID del producto (Mercado Público)" autocomplete="off"></div>
              <div class="act-fila act-docs act-mfoto"><label class="btn btn-outline btn-sm"><i class="ph-bold ph-camera"></i> Cargar foto del producto (opcional)<input type="file" accept="image/*,.webp,.jpg,.jpeg,.png,.gif,.bmp,.avif" id="act-mimg" hidden></label><span id="act-mimg-v">${vistaMImg()}</span></div>
              <div class="act-fila act-docs"><input id="act-ms" type="number" min="0" class="act-qty" placeholder="Pedido" aria-label="Cantidad pedida (opcional)"><input id="act-mq" type="number" min="0" value="1" class="act-qty" aria-label="Cantidad a entregar"><button type="button" class="btn btn-outline" id="act-madd">Agregar</button></div>
              <p class="act-hint">Pedido = lo solicitado en total (opcional); el segundo número es lo que entregas ahora. Lo que falte queda como pendiente en el acta; si no tienes nada para entregar, pon 0 y el pedido: todo queda pendiente para el centro. El nombre y el ID quedan guardados en el catálogo.</p>
              <label class="act-l act-chk"><input type="checkbox" id="act-mc"> Es medicamento controlado (no se permite sin stock)</label></details>
            <div class="act-stock">${!borrador.origen ? '<p class="act-hint">Elige una bodega para ver su stock.</p>' : !lista.length ? '<p class="act-hint">Sin resultados. Si no está en el sistema, agrégalo a mano abajo.</p>' : lista.map(s => `
              <div class="act-fila${yaEsta(s.id) ? ' act-ya' : ''}"><div class="act-fn">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(s.name, { codigo: s.codigo }) : ''}${esc(s.name)}${s.controlado ? ' <small>(controlado)</small>' : ''}${s.provisional ? ' <small>(provisional)</small>' : ''}<small>${s.codigo ? '<b>ID ' + esc(s.codigo) + '</b> · ' : '<span class="act-sin">sin ID</span> · '}${s.disp > 0 ? 'Disponible: ' + s.disp + (s.reserv > 0 ? ' · reservado en actas por confirmar: ' + s.reserv : '') : '<span class="act-sin">Sin stock en sistema</span>'}${s.sobregiro > 0 ? ' · sobregiro: ' + s.sobregiro : ''}</small></div>
                ${yaEsta(s.id) ? '<span class="act-chip">agregado</span>' : `<input type="number" min="0" class="act-qty" data-sid="${esc(s.id)}" placeholder="Pedido" aria-label="Cantidad pedida (opcional)"><input type="number" min="1" value="1" class="act-qty" data-qid="${esc(s.id)}" aria-label="Cantidad a entregar"><button type="button" class="btn btn-outline act-add" data-id="${esc(s.id)}">Agregar</button>`}</div>`).join('')}
              ${enCat.length ? '<p class="act-hint"><b>Del catálogo o registrados antes, sin stock en esta bodega</b> (se agregan como manual · provisional):</p>' + enCat.map(x => `
              <div class="act-fila${yaCat(x) ? ' act-ya' : ''}"><div class="act-fn">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(x.nombre, { codigo: x.codigo }) : ''}${esc(x.nombre)} <small>(${x.derivado ? 'registrado en ' + esc(x.derivado) : 'catálogo'})</small><small>${x.codigo ? '<b>ID ' + esc(x.codigo) + '</b>' : '<span class="act-sin">sin ID</span>'} · <span class="act-sin">Sin stock en esta bodega</span></small></div>
                ${yaCat(x) ? '<span class="act-chip">agregado</span>' : `<input type="number" min="0" class="act-qty" data-csid="${x.ci}" placeholder="Pedido" aria-label="Cantidad pedida (opcional)"><input type="number" min="0" value="1" class="act-qty" data-cqid="${x.ci}" aria-label="Cantidad a entregar"><button type="button" class="btn btn-outline act-addcat" data-ci="${x.ci}">Agregar</button>`}</div>`).join('') : ''}
              ${stock.filter(s => !q || s.name.toLowerCase().includes(q) || String(s.codigo || '').includes(q)).length > 80 ? '<p class="act-hint">Hay más resultados: afina la búsqueda.</p>' : ''}</div>
          </div>
          <div class="act-col">
            <h3 class="act-h">2 · Acta</h3>
            <label class="act-l">Centro al que se entrega
              <input id="act-centro" list="act-centros" value="${esc(borrador.centro)}" placeholder="Ej: Pomaire"><datalist id="act-fisl">${stock.slice(0, 400).map(x => `<option value="${esc(x.name)}">`).join('')}</datalist><datalist id="act-centros">${listaCentros().map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
              <div class="act-centro-acc"><button type="button" class="btn btn-outline btn-sm" id="act-centro-add">+ Guardar este centro en la lista</button></div>
            <h4 class="act-h4">Productos entregados (${entregan.length})</h4>
            ${entregan.length ? entregan.map(([i, k]) => filaItem(i, k)).join('') : '<p class="act-hint">Aún no agregas productos que se entreguen.</p>'}
            <details class="act-det"${(borrador.pendientes.length || enCero.length) ? ' open' : ''}><summary>Productos pendientes de entrega${enCero.length ? ` (${enCero.length} sin stock, entrega 0)` : ' (opcional)'}</summary>
              ${enCero.map(([i, k]) => filaItem(i, k)).join('')}
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
            <div class="act-prueba"><b>Probar el formato</b><span>Genera el acta con los productos elegidos para comparar con el modelo. <u>No descuenta stock</u> ni se numera; queda registrada como "ACTA_PRUEBA" en el historial (informes contable y disponible).</span>
              <div class="act-acc"><button type="button" class="btn btn-outline" id="act-prueba-pdf"${borrador.items.length ? '' : ' disabled'}>Acta de prueba · PDF</button><button type="button" class="btn btn-outline" id="act-prueba-docx"${borrador.items.length ? '' : ' disabled'}>Acta de prueba · Word</button></div></div>
          </div>
        </div></div>
        <div data-act-tab="emitidas"${tab === 'emitidas' ? '' : ' hidden'}>
        <h3 class="act-h">Actas emitidas</h3>
        <div class="act-hist">${historial.length ? historial.map(a => `<div class="act-fila${a.estado === 'ANULADA' ? ' act-anulada' : ''}"><div class="act-fn"><strong>${esc(a.numero)}</strong> · ${esc(a.centro)}<small>${esc(a.fecha)} · ${a.tipo === 'OXIGENO' ? 'oxígeno · ' : ''}${(a.items || []).length} ${a.tipo === 'OXIGENO' ? 'balones' : 'productos'} · ${esc(a.bodegaOrigen)} · ${esc(a.creadoPor || '')}${a.estado === 'ANULADA' ? ' · <b>ANULADA</b>' : ''}${a.confirmacion && a.confirmacion.estado === 'PENDIENTE' && a.estado === 'EMITIDA' ? ' · <b class="act-sin">ENTREGA POR CONFIRMAR (stock aún en bodega)</b>' : ''}${a.estado === 'EMITIDA' && a.tipo !== 'OXIGENO' && a.respaldo ? ' · <b>firmada ✔</b>' : ''}${a.conSobregiro ? ' · <b class="act-sin">con sobregiro</b>' : ''}</small></div>
            <button type="button" class="btn btn-outline act-dl" data-n="${esc(a.numero)}" data-f="pdf">PDF</button><button type="button" class="btn btn-outline act-dl" data-n="${esc(a.numero)}" data-f="docx">Word</button>
            ${a.estado === 'EMITIDA' && a.tipo !== 'OXIGENO' && a.confirmacion && a.confirmacion.estado === 'PENDIENTE' && esAdmin() ? `<button type="button" class="btn btn-primary act-conf" data-n="${esc(a.numero)}">Confirmar entrega (subir acta firmada)</button>` : ''}${a.estado === 'EMITIDA' && a.tipo !== 'OXIGENO' && !(a.confirmacion && a.confirmacion.estado === 'PENDIENTE') && !a.respaldo && esAdmin() ? `<button type="button" class="btn btn-outline act-firm" data-n="${esc(a.numero)}">Subir acta firmada</button>` : ''}${a.respaldo ? `<button type="button" class="btn btn-outline act-verr" data-n="${esc(a.numero)}">Ver acta firmada</button>` : ''}
            ${esAdmin() && a.estado === 'EMITIDA' ? `<button type="button" class="btn btn-outline act-ed" data-n="${esc(a.numero)}">Editar</button>` : ''}${esAdmin() && a.estado !== 'ANULADA' && a.tipo !== 'OXIGENO' ? `<button type="button" class="btn btn-outline act-an" data-n="${esc(a.numero)}">Eliminar acta</button>` : ''}</div>`).join('') : '<p class="act-hint">Todavía no hay actas emitidas.</p>'}</div></div>
        <div data-act-tab="seguimiento" id="seg-root"${tab === 'seguimiento' ? '' : ' hidden'}></div>`;
        r.querySelectorAll('.act-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; pintar(); }));
        if (window.SAR_Saldos && window.SAR_Saldos.pintarSeg) window.SAR_Saldos.pintarSeg();
        enlazar();
    }

    /** Foto del producto: desplegable en cada fila del acta (si aún no tiene foto en el sistema). */
    function fotoDe(i, k) {
        if (i.imagen) return `<div class="act-foto-ok"><img src="${esc(i.imagen)}" alt=""><small>Foto cargada (se guarda en el catálogo)</small><button type="button" class="btn btn-outline btn-sm act-img-quitar" data-k="${k}">Quitar</button></div>`;
        const IM = window.SAR_Imagenes; let tiene = false;
        try { tiene = !!(IM && (IM.buscar(i.nombre, i.codigo) || (IM.buscarConCandidata && IM.buscarConCandidata(i.nombre, i.codigo)))); } catch (e) { tiene = false; }
        if (tiene) return '';
        return `<details class="act-foto"><summary>Agregar foto del producto</summary><input type="file" accept="image/*,.webp,.jpg,.jpeg,.png,.gif,.bmp,.avif" class="act-img" data-k="${k}" aria-label="Foto del producto"></details>`;
    }
    function reducirFoto(file) {
        return new Promise((ok, mal) => {
            const img = new Image(), url = URL.createObjectURL(file);
            img.onload = () => { const k = Math.min(1, 220 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.8)); };
            img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la imagen.')); }; img.src = url;
        });
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
        const bca = document.getElementById('act-centro-add'); if (bca) bca.addEventListener('click', async () => {
            leerCampos(); const n = normC(borrador.centro); if (!n) { toast('Falta el centro', 'Escribe el nombre del centro y luego guárdalo.', 'warning'); return; }
            try { const nuevo = await guardarCentro(n); toast(nuevo ? 'Centro guardado' : 'Ya estaba en la lista', n, nuevo ? 'success' : 'info'); pintar(); } catch (e) { toast('No se guardó el centro', e.message || String(e), 'error'); }
        });
        ['act-centro', 'act-rn', 'act-rc', 'act-en', 'act-ec'].forEach(id => { const e = document.getElementById(id); if (e) e.addEventListener('change', () => { leerCampos(); guardarBorrador(); if (id === 'act-centro') pintar(); }); });
        $$('.act-addcat').forEach(b => b.addEventListener('click', () => {
            const c0 = catalogo[+b.dataset.ci]; if (!c0) return;
            const c = Math.floor(num((r.querySelector(`.act-qty[data-cqid="${b.dataset.ci}"]`) || {}).value)), solC = Math.floor(num((r.querySelector(`.act-qty[data-csid="${b.dataset.ci}"]`) || {}).value));
            if (!(c > 0 || (c === 0 && solC > 0))) { toast('Cantidad', 'Indica una cantidad mayor que 0 (o 0 con el pedido, para dejarlo pendiente).', 'warning'); return; }
            if (borrador.items.length >= MAX_ITEMS) { toast('Límite', `Máximo ${MAX_ITEMS} productos por acta.`, 'warning'); return; }
            const nom = String(c0.descripcion || c0.insumoName || '').toUpperCase(), cod = c0.codigoMP ? String(c0.codigoMP) : '';
            borrador.items.push({ id: null, manual: true, nombre: nom, codigo: cod, cantidad: c, solicitado: solC > c ? solC : 0, stock: 0, ...(c0.imagen ? { imagen: c0.imagen } : {}) }); refrescar();
        }));
        $$('.act-add').forEach(b => b.addEventListener('click', () => {
            const s = stock.find(x => x.id === b.dataset.id); const inp = r.querySelector(`.act-qty[data-qid="${CSS.escape(b.dataset.id)}"]`);
            const c = Math.floor(num(inp && inp.value));
            const solS = Math.floor(num((r.querySelector(`.act-qty[data-sid="${CSS.escape(b.dataset.id)}"]`) || {}).value));
            if (!s || !(c > 0 || (c === 0 && solS > 0))) { toast('Cantidad', 'Indica una cantidad mayor que 0 (o 0 con el pedido, para dejarlo pendiente).', 'warning'); return; }
            if (borrador.items.length >= MAX_ITEMS) { toast('Límite', `Máximo ${MAX_ITEMS} productos por acta.`, 'warning'); return; }
            if (s.controlado && c > s.disp) { toast('Medicamento controlado', 'No puede entregarse sin stock en sistema.', 'error'); return; }
            const sp = r.querySelector(`.act-qty[data-sid="${CSS.escape(b.dataset.id)}"]`), sol = Math.floor(num(sp && sp.value));
            borrador.items.push({ id: s.id, nombre: s.name, codigo: s.codigo || '', cantidad: c, solicitado: sol > c ? sol : 0, stock: s.disp, controlado: s.controlado }); refrescar();
        }));
        // Sugerencias con foto: al escribir una letra aparece el nombre sugerido, su ID y su fotografía (stock de la bodega + catálogo, incluidos los ingresados manualmente)
        const fuenteSug = () => {
            const a = stock.map(x => ({ nombre: x.name, codigo: x.codigo, nota: x.provisional ? 'manual · provisional' : `disp. ${x.disp}` }));
            const b = catalogo.map(c => ({ nombre: String(c.descripcion || c.insumoName || '').toUpperCase(), codigo: c.codigoMP ? String(c.codigoMP) : '', nota: c.derivado ? 'registrado en ' + c.derivado : 'catálogo' })).filter(x => x.nombre);
            return a.concat(b);
        };
        if (window.SAR_Sugerir) {
            window.SAR_Sugerir.enlazar($('#act-mn'), fuenteSug, (x) => { const m = $('#act-mid'); if (m && x.codigo && !m.value) m.value = x.codigo; });
            window.SAR_Sugerir.enlazar($('#act-pn'), fuenteSug, null);
            $$('.act-fis').forEach(i => window.SAR_Sugerir.enlazar(i, fuenteSug, null));
        }
        $$('.act-fis').forEach(i => i.addEventListener('change', () => { const it = borrador.items[+i.dataset.k]; if (it) { it.fisico = i.value.trim(); guardarBorrador(); } }));
        $$('.act-edit').forEach(i => i.addEventListener('change', () => { borrador.items[+i.dataset.k].cantidad = Math.floor(num(i.value)); refrescar(); }));
        $$('.act-img').forEach(i => i.addEventListener('change', async () => { const it = borrador.items[+i.dataset.k], file = i.files && i.files[0]; if (!it || !file) return; try { it.imagen = await reducirFoto(file); refrescar(); } catch (e) { toast('Foto', e.message || 'No se pudo leer la foto.', 'error'); } }));
        $$('.act-img-quitar').forEach(b => b.addEventListener('click', () => { const it = borrador.items[+b.dataset.k]; if (it) { delete it.imagen; refrescar(); } }));
        $$('.act-cod').forEach(i => i.addEventListener('change', () => { const it = borrador.items[+i.dataset.k]; const v = String(i.value || '').replace(/\D/g, ''); if (!it || !v) return; it.codigo = v; it.codigoNuevo = true; refrescar(); }));
        $$('.act-sedit').forEach(i => i.addEventListener('change', () => { const it = borrador.items[+i.dataset.k]; const v = Math.floor(num(i.value)); it.solicitado = v > num(it.cantidad) ? v : 0; refrescar(); }));
        // Manual: al elegir un nombre del catálogo se completa el ID, y al escribir un ID conocido se completa el nombre
        const mn = document.getElementById('act-mn'), mid = document.getElementById('act-mid');
        if (mn && mid) {
            mn.addEventListener('change', () => { if (!mid.value.trim()) { const c = codDe(mn.value); if (c) mid.value = c; } });
            mid.addEventListener('change', () => { const v = mid.value.replace(/\D/g, ''); mid.value = v; const c = v && catalogo.find(x => String(x.codigoMP) === v); if (c && !mn.value.trim()) mn.value = String(c.descripcion || c.insumoName || '').toUpperCase(); });
        }
        $$('.act-del').forEach(b => b.addEventListener('click', () => { borrador.items.splice(+b.dataset.k, 1); refrescar(); }));
        $$('.act-pedit').forEach(i => i.addEventListener('change', () => { borrador.pendientes[+i.dataset.k].cantidad = Math.floor(num(i.value)) || 1; refrescar(); }));
        $$('.act-pdel').forEach(b => b.addEventListener('click', () => { borrador.pendientes.splice(+b.dataset.k, 1); refrescar(); }));
        $$('.act-ddel').forEach(b => b.addEventListener('click', () => { borrador.documentos.splice(+b.dataset.k, 1); refrescar(); }));
        const detM = $('.act-manual'); if (detM) detM.addEventListener('toggle', () => { manualAbierto = detM.open; });
        const ligarQuitar = () => { const q = $('#act-mimg-q'); if (q) q.addEventListener('click', () => { manualImg = ''; $('#act-mimg-v').innerHTML = vistaMImg(); }); };
        const mi = $('#act-mimg'); if (mi) mi.addEventListener('change', async () => { const file = mi.files && mi.files[0]; if (!file) return; try { manualImg = await reducirFoto(file); $('#act-mimg-v').innerHTML = vistaMImg(); ligarQuitar(); } catch (e) { toast('Foto', e.message || 'No se pudo leer la foto.', 'error'); } });
        ligarQuitar();
        $('#act-madd').addEventListener('click', () => {
            const n = $('#act-mn').value.trim().toUpperCase(); const c = Math.floor(num($('#act-mq').value)); const solM = Math.floor(num($('#act-ms').value));
            if (n.length < 3 || !(c > 0 || (c === 0 && solM > 0))) { toast('Ingreso manual', 'Escribe el nombre del insumo y la cantidad a entregar (si no la tienes, pon 0 y anota el pedido: queda como pendiente).', 'warning'); return; }
            if ($('#act-mc').checked) { toast('Medicamento controlado', 'No se permite sin stock en sistema: use el circuito con folio DAU.', 'error'); return; }
            if (borrador.items.length >= MAX_ITEMS) { toast('Límite', `Máximo ${MAX_ITEMS} productos por acta.`, 'warning'); return; }
            const cod = String(($('#act-mid').value || '').replace(/\D/g, ''));
            const par = stock.find(x => x.name.toLowerCase() === n.toLowerCase() || (cod && x.codigo === cod));
            if (par) { toast('Ya existe', `"${par.name}" ya está en esta bodega: agrégalo desde la lista.`, 'warning'); return; }
            if (!cod && !confirm('No indicaste el ID del producto. Sirve para asociar la foto y la orden de compra después. ¿Agregar sin ID?')) return;
            const sol = Math.floor(num($('#act-ms').value));
            borrador.items.push({ id: null, manual: true, nombre: n, codigo: cod, cantidad: c, solicitado: sol > c ? sol : 0, stock: 0, ...(manualImg ? { imagen: manualImg } : {}) }); manualImg = ''; refrescar();
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
        ['pdf', 'docx'].forEach(fm => { const bt = document.getElementById('act-prueba-' + fm); if (bt) bt.addEventListener('click', async () => { bt.disabled = true; try { await probarActa(fm); } finally { bt.disabled = false; } }); });
        $$('.act-conf').forEach(b => b.addEventListener('click', async () => {
            const a = historial.find(x => x.numero === b.dataset.n); if (!a) return;
            if (!confirm(`Confirmar la entrega del acta ${a.numero} a ${a.centro}.\n\nVas a subir el acta firmada (PDF o foto). Al guardarla se DESCUENTAN del stock de ${a.bodegaOrigen} los ${(a.items || []).length} productos del acta.\n\n¿Continuar?`)) return;
            const file = await pedirArchivo(); if (!file) return;
            const prog = window.SAR_Progreso.iniciar('Confirmando la entrega…', ['Subiendo el acta firmada y descontando el stock…']);
            try { await confirmarEntrega(a, file, usuarioEmail()); await Promise.all([cargarStock(), cargarHistorial()]); pintar(); prog.listo(`Entrega ${a.numero} confirmada · stock descontado`, { informe: true }); }
            catch (e) { prog.error(); toast('No se confirmó', e.message || String(e), 'error'); }
        }));
        $$('.act-firm').forEach(b => b.addEventListener('click', async () => {
            const a = historial.find(x => x.numero === b.dataset.n); if (!a) return;
            const file = await pedirArchivo(); if (!file) return;
            const prog = window.SAR_Progreso.iniciar('Guardando el acta firmada…', ['Subiendo el respaldo…']);
            try { await subirFirmada(a, file, usuarioEmail()); await cargarHistorial(); pintar(); prog.listo(`Acta firmada de ${a.numero} guardada (el stock no cambia)`, { informe: false }); }
            catch (e) { prog.error(); toast('No se guardó', e.message || String(e), 'error'); }
        }));
        $$('.act-verr').forEach(b => b.addEventListener('click', async () => { const a = historial.find(x => x.numero === b.dataset.n); try { await verRespaldo(a); } catch (e) { toast('Acta firmada', e.message || String(e), 'error'); } }));
        $$('.act-dl').forEach(b => b.addEventListener('click', async () => {
            const a = historial.find(x => x.numero === b.dataset.n); if (!a) return;
            b.disabled = true; try { await descargar(actaParaDoc(a), b.dataset.f); } catch (e) { toast('Descarga', e.message, 'error'); } finally { b.disabled = false; }
        }));
        $$('.act-ed').forEach(b => b.addEventListener('click', () => {
            const a = historial.find(x => x.numero === b.dataset.n); if (!a || !window.SAR_ActaEdicion) return;
            window.SAR_ActaEdicion.abrir(a, { centros: listaCentros(), refrescar: async () => { await Promise.all([cargarHistorial(), cargarStock()]); pintar(); } });
        }));
        $$('.act-an').forEach(b => b.addEventListener('click', async () => {
            const motivo = (prompt(`Eliminar el acta ${b.dataset.n}: se borra su archivo, el stock vuelve a la bodega de origen y lo entregado vuelve a quedar pendiente en la orden. Queda el registro en el historial.\n\nMotivo:`, 'Acta mal generada') || '').trim();
            if (!motivo) return;
            const prog = window.SAR_Progreso.iniciar('Eliminando el acta…', ['Devolviendo el stock a la bodega de origen…']);
            try {
                const a = historial.find(x => x.numero === b.dataset.n);
                await anular(b.dataset.n, motivo, usuarioEmail());
                prog.paso('Quitando el archivo de la orden…');
                let arch = 0; if (a && a.oc && a.oc.id && window.SAR_SeguimientoOC && window.SAR_SeguimientoOC.eliminarArchivosActa) { try { arch = await window.SAR_SeguimientoOC.eliminarArchivosActa(a.oc.id, a.numero); } catch (e2) { toast('Archivo no eliminado', 'El stock se devolvió, pero el archivo de la orden no se pudo borrar: ' + (e2.message || e2), 'warning'); } }
                prog.listo(`Acta ${b.dataset.n} eliminada: stock devuelto${arch ? ' y archivo borrado de la orden' : ''}`, { informe: true }); await Promise.all([cargarHistorial(), cargarStock()]); borrador.items = []; guardarBorrador(); pintar(); }
            catch (e) { prog.error(); toast('No se anuló', e.message, 'error'); }
        }));
    }

    /** Acta de prueba: arma el documento como si se emitiera, sin tocar stock ni órdenes. */
    async function probarActa(formato) {
        leerCampos();
        const b = borrador; if (!b.items.length) { toast('Acta de prueba', 'Agrega al menos un producto.', 'warning'); return; }
        const f = fs(), usuario = usuarioEmail(), hoy = new Date();
        const numero = 'PRUEBA-' + hoy.toISOString().slice(0, 19).replace(/\D/g, '').slice(2);
        let items = b.items.map(i => ({ id: i.id || '', nombre: i.nombre, cantidad: num(i.cantidad), ...(b.oc ? { ocI: i.ocI } : {}) }));
        let pendientes = b.pendientes.map(p => ({ nombre: p.nombre, cantidad: num(p.cantidad) }));
        if (b.oc) {
            try {
                const os = await f.getDoc(f.doc(f.collection(db(), 'Seguimiento_OC'), b.oc.id));
                if (os.exists()) {
                    const ls = os.data().lineas || [];
                    items = items.map(i => { const l = ls[i.ocI]; if (!l) return i; const ent = num(l.entregado && l.entregado[b.oc.key]); return { ...i, solicitado: num(l.dist && l.dist[b.oc.key]), entregadoTotal: ent + i.cantidad }; });
                    const yaEn = new Set(items.map(i => i.ocI));
                    ls.forEach((l, idx) => { const p = num(l.dist && l.dist[b.oc.key]) - num(l.entregado && l.entregado[b.oc.key]); if (!yaEn.has(idx) && p > 0) pendientes.push({ nombre: String(l.descripcion || '').toUpperCase(), cantidad: p }); });
                }
            } catch (e) { /* sin la orden: se arma con lo elegido */ }
        }
        const acta = { numero, fecha: hoy.toISOString().slice(0, 10), centro: (b.centro || '').trim() || 'CENTRO (prueba)', bodegaOrigen: b.origen || '', estado: 'PRUEBA', items, pendientes,
            documentos: b.documentos.map(d => ({ tipo: d.tipo, numero: d.numero, detalle: d.detalle || '' })), entrega: { nombre: firma.nombre, cargo: firma.cargo }, recibe: { nombre: (b.recibe && b.recibe.nombre) || '', cargo: (b.recibe && b.recibe.cargo) || '' } };
        const prog = window.SAR_Progreso.iniciar('Generando el acta de prueba…', [`Armando el documento ${formato.toUpperCase()}…`]);
        try { await descargar(actaParaDoc(acta), formato); }
        catch (e) { prog.error(); toast('Acta de prueba', 'No se pudo generar: ' + (e.message || e), 'error'); return; }
        prog.paso('Registrando la prueba en el historial…');
        try {
            await f.setDoc(f.doc(f.collection(db(), 'Historial_Movimientos')), { insumoName: 'ACTA DE PRUEBA (sin efecto en stock)', quantity: items.reduce((s, i) => s + i.cantidad, 0), type: 'ACTA_PRUEBA', user: usuario, date: f.serverTimestamp(), document: numero, batch: 'N/A', origin: b.origen || '', dest: acta.centro, actaId: numero, sinEfectoStock: true,
                observacion: `Acta de prueba ${numero} (${formato.toUpperCase()}): ${items.map(i => i.nombre + ' x' + i.cantidad).join('; ')}`.slice(0, 900) });
            prog.listo(`Acta de prueba ${numero} generada (sin descontar stock)`, { informe: true });
        } catch (e) { prog.error(); toast('Acta de prueba', 'Se generó el documento, pero no se pudo registrar en el historial: ' + (e.message || e), 'warning'); }
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
        if (!confirm(`Se emitirá el acta para ${borrador.centro.trim()} con ${borrador.items.length} productos (${total} unidades).\n\nEl stock de ${borrador.origen} NO se descuenta ahora: queda reservado hasta que confirmes la entrega subiendo el acta firmada (desde "Actas emitidas").${avisoSin}\n\n¿Emitir?`)) return;
        emitiendo = true; const btn = document.getElementById('act-emitir'); if (btn) btn.disabled = true;
        const prog = window.SAR_Progreso.iniciar('Emitiendo el acta de entrega…', ['Numerando el acta…']);
        try {
            const centroNuevo = borrador.centro;
            const acta = await emitirDiferido(borrador, usuarioEmail());
            prog.paso('Generando el documento PDF…');
            guardarCentro(centroNuevo).catch(() => {});
            toast('Acta emitida', `${acta.numero} · el stock sale al subir el acta firmada.`, 'success');
            borrador = { ...vacio(), origen: borrador.origen, centro: '' }; guardarBorrador();
            await Promise.all([cargarStock(), cargarHistorial()]);
            pintar();
            try {
                const r = await descargar(actaParaDoc(acta), 'pdf');
                if (r && acta.oc && acta.oc.id && window.SAR_SeguimientoOC && window.SAR_SeguimientoOC.guardarArchivo) {   // queda adosada a la orden
                    try { await window.SAR_SeguimientoOC.guardarArchivo(acta.oc.id, { nombre: r.nombre, categoria: 'Acta de entrega ' + acta.numero, bytes: r.bytes }); toast('Acta guardada en la orden', `Quedó en los archivos de la OC ${acta.oc.numeroOC || ''}.`, 'success'); }
                    catch (e2) { toast('Acta no guardada en la orden', e2.message || String(e2), 'warning'); }
                }
            } catch (e) { toast('Descarga', 'El acta se emitió, pero el PDF no se pudo generar: ' + e.message + ' Descárgalo desde "Actas emitidas".', 'warning'); }
            prog.listo(`Acta ${acta.numero} emitida · pendiente de confirmar la entrega`, { informe: true });
        } catch (e) { prog.error(); toast('No se emitió', e.message, 'error'); if (btn) btn.disabled = false; }
        finally { emitiendo = false; }
    }

    async function abrir() {
        const r = root(); if (!r) return;
        const f = leerFirma(); if (f) firma = f;
        borrador = cargarBorrador();
        r.innerHTML = (window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando las actas y el stock…') : 'Cargando las actas y el stock…');
        try {
            if (window.SAR_Imagenes) window.SAR_Imagenes.cargar().catch(() => {});
            await Promise.all([cargarCatalogo(), cargarBodegas(), cargarCentros(), cargarHistorial().catch(() => { historial = []; })]);
            if (!borrador.origen) { const c = bodegas.find(b => /central/i.test(b.name)); if (c) borrador.origen = c.name; }
            else if (!bodegas.some(b => b.name === borrador.origen)) { borrador.origen = null; borrador.items = []; }
            await cargarStock();
            if (precarga) {   // viene de "Pendientes por entregar": el acta queda lista con lo que hay en stock
                const pc = precarga; precarga = null; borrador.centro = pc.centro; borrador.items = [];
                pc.lista.forEach(p => {
                    const s = stock.find(x => (p.codigo && String(x.codigo).replace(/\D/g, '') === String(p.codigo).replace(/\D/g, '')) || normN(x.name) === normN(p.nombre)); if (!s || !(s.disp > 0)) return;
                    const c = Math.min(num(p.entregable), s.disp); borrador.items.push({ id: s.id, nombre: s.name, codigo: s.codigo || p.codigo || '', cantidad: c, solicitado: num(p.pendiente) > c ? num(p.pendiente) : 0, stock: s.disp, controlado: s.controlado });
                });
                guardarBorrador(); if (!borrador.items.length) toast('Pendientes', 'No encontré esos productos en la bodega de origen elegida.', 'warning');
            }
        } catch (e) { r.innerHTML = `<p class="act-err" style="padding:24px;">No se pudo cargar: ${esc(e.message)}</p>`; return; }
        pintar();
    }

    let precarga = null, manualImg = '', manualAbierto = false;
    const vistaMImg = () => manualImg ? `<img src="${esc(manualImg)}" alt="" class="act-mimg-v"><button type="button" class="btn btn-outline btn-sm" id="act-mimg-q">Quitar</button>` : '<small>WEBP, JPG, PNG… (queda en el catálogo)</small>';
    function precargar(centro, lista) { precarga = { centro, lista: lista || [] }; if (window.location.hash === '#view-actas-entrega') abrir(); else window.location.hash = 'view-actas-entrega'; }
    window.SAR_ActasEntrega = { precargar, listaCentros, abrir, planificar, cuadrar, restaurarConSobregiro, detalleDe, descargarActa: (a, f) => descargar(actaParaDoc(a), f), descontarFEFO, restaurarLotes, numeroActa, validarBorrador, emitir, anular, lotesDeDoc };
    if (typeof module !== 'undefined') module.exports = window.SAR_ActasEntrega;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: { dataset: {} } });
