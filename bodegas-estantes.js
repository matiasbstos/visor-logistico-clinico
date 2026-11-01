/* ==========================================================================
   BODEGAS: ESTANTES, CÓDIGOS Y ETIQUETAS (v20.25)
   - Cada bodega decide si usa estantes (campo usaEstantes) y tiene un prefijo (BS, BT…).
   - Código: PREFIJO-LETRA+NÚMERO (BS-A01). Letra = nivel (A abajo), número = estante.
     Un nivel puede subdividirse en espacios: BS-A01-1, BS-A01-2.
   - Las ubicaciones viven en Bodegas/{id}/Ubicaciones/{codigo}. Nunca se borran: se archivan.
   - Etiquetas imprimibles con código de barras (pistola) y QR (celular).
   ========================================================================== */
(function (window, document) {
    'use strict';

    const URL_BASE = 'https://sarinventario.web.app/';
    const LETRAS = 'ABCDEFGHIJ';

    const fs = () => window.firebaseFirestore;
    const db = () => window.firebaseDb;
    const esc = (s) => (window.escapeHTML ? window.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s));
    const esAdmin = () => ['admin', 'administrador', 'global', 'superadmin'].includes(String(document.body.dataset.userRole || '').toLowerCase());
    const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };

    function pad2(n) { return String(n).padStart(2, '0'); }

    /** Código de una ubicación. espacio = null para el nivel completo. */
    function codigoUbicacion(prefijo, estante, nivel, espacio) {
        return `${prefijo}-${nivel}${pad2(estante)}${espacio ? '-' + espacio : ''}`;
    }

    /** Valida prefijo: 1 a 4 letras/números, sin guiones. */
    function prefijoValido(p) { return /^[A-Z0-9]{1,4}$/.test(p); }

    /** Genera la lista de ubicaciones nuevas (puro, para poder probarlo). */
    function planificarUbicaciones({ prefijo, desdeEstante, cantidadEstantes, niveles, espacios }) {
        const out = [];
        for (let e = desdeEstante; e < desdeEstante + cantidadEstantes; e++) {
            for (let n = 0; n < niveles; n++) {
                const letra = LETRAS[n];
                if (espacios > 0) {
                    for (let s = 1; s <= espacios; s++) out.push({ codigo: codigoUbicacion(prefijo, e, letra, s), estante: e, nivel: letra, espacio: s });
                } else {
                    out.push({ codigo: codigoUbicacion(prefijo, e, letra, null), estante: e, nivel: letra, espacio: null });
                }
            }
        }
        return out;
    }

    async function cargarUbicaciones(bodegaId) {
        const f = fs();
        const snap = await f.getDocs(f.collection(db(), 'Bodegas', bodegaId, 'Ubicaciones'));
        const lista = [];
        snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
        lista.sort((a, b) => (a.estante - b.estante) || String(a.nivel).localeCompare(String(b.nivel)) || ((a.espacio || 0) - (b.espacio || 0)));
        return lista;
    }

    // ---------------------------------------------------------------
    // Interfaz dentro del modal de bodega
    // ---------------------------------------------------------------
    async function renderSeccion(bodega) {
        const modalBody = document.querySelector('#bodega-modal .modal-body');
        if (!modalBody) return;
        let sec = document.getElementById('bodega-estantes-sec');
        if (!sec) {
            sec = document.createElement('div');
            sec.id = 'bodega-estantes-sec';
            sec.className = 'bodega-estantes';
            modalBody.appendChild(sec);
        }
        const admin = esAdmin();
        const usa = bodega.usaEstantes === true;
        sec.innerHTML = `
            <h4 class="bodega-estantes__title"><i class="ph-bold ph-stack"></i> Estantes y etiquetas</h4>
            <div class="bodega-estantes__row">
                <label class="bodega-estantes__switch">
                    <input type="checkbox" id="be-usa" ${usa ? 'checked' : ''} ${admin ? '' : 'disabled'}>
                    <span>Usar estantes / ubicaciones en esta bodega</span>
                </label>
                <label class="bodega-estantes__prefijo">Prefijo
                    <input type="text" id="be-prefijo" maxlength="4" value="${esc(bodega.prefijo || '')}" placeholder="BS" ${admin ? '' : 'disabled'}>
                </label>
                ${admin ? '<button type="button" class="btn btn-outline" id="be-guardar">Guardar</button>' : ''}
            </div>
            <p class="bodega-estantes__hint">${usa ? 'Los productos de esta bodega se ubican por estante, nivel y espacio. Puede haber productos "sin ubicar" mientras se asignan.' : 'Modo simple: los productos se asignan a la bodega, sin estantes.'}</p>
            <div id="be-contenido"></div>`;

        const guardar = sec.querySelector('#be-guardar');
        if (guardar) guardar.addEventListener('click', async () => {
            const prefijo = sec.querySelector('#be-prefijo').value.trim().toUpperCase();
            const usaNuevo = sec.querySelector('#be-usa').checked;
            if (usaNuevo && !prefijoValido(prefijo)) { toast('Prefijo no válido', 'Usa de 1 a 4 letras o números, sin guiones (ej. BS).', 'warning'); return; }
            try {
                await fs().setDoc(fs().doc(fs().collection(db(), 'Bodegas'), bodega.id), { usaEstantes: usaNuevo, prefijo: prefijo || '' }, { merge: true });
                bodega.usaEstantes = usaNuevo; bodega.prefijo = prefijo;
                toast('Guardado', usaNuevo ? 'La bodega usa estantes.' : 'La bodega queda en modo simple.', 'success');
                renderSeccion(bodega);
            } catch (e) { toast('Error', 'No se pudo guardar: ' + e.message, 'error'); }
        });

        const cont = sec.querySelector('#be-contenido');
        if (!usa) { cont.innerHTML = `<button type="button" class="btn btn-outline" id="be-etq-bodega"><i class="ph-bold ph-qr-code"></i> Etiqueta general de la bodega</button>`;
            const b = cont.querySelector('#be-etq-bodega'); if (b) b.addEventListener('click', () => imprimirEtiquetas(bodega, [], true)); return; }

        cont.innerHTML = '<p class="bodega-estantes__hint">Cargando ubicaciones…</p>';
        let ubic = [];
        try { ubic = await cargarUbicaciones(bodega.id); } catch (e) { cont.innerHTML = '<p class="bodega-estantes__hint">No se pudieron cargar las ubicaciones.</p>'; return; }
        const activas = ubic.filter(u => u.activo !== false);
        const maxEstante = activas.reduce((m, u) => Math.max(m, u.estante || 0), 0);
        const porEstante = {};
        activas.forEach(u => { (porEstante[u.estante] = porEstante[u.estante] || []).push(u); });

        cont.innerHTML = `
            ${admin ? `
            <div class="bodega-estantes__gen">
                <strong>Agregar estantes</strong>
                <label>Cantidad <input type="number" id="be-cant" min="1" max="60" value="1"></label>
                <label>Niveles <input type="number" id="be-niv" min="1" max="10" value="5"></label>
                <label>Espacios por nivel <input type="number" id="be-esp" min="0" max="9" value="0"></label>
                <button type="button" class="btn btn-primary" id="be-gen">Generar</button>
                <span class="bodega-estantes__hint" id="be-prev"></span>
            </div>` : ''}
            <div class="bodega-estantes__acciones">
                <button type="button" class="btn btn-outline" id="be-etq-todas" ${activas.length ? '' : 'disabled'}><i class="ph-bold ph-printer"></i> Imprimir etiquetas de estantes (${activas.length})</button>
                <button type="button" class="btn btn-outline" id="be-etq-bodega"><i class="ph-bold ph-qr-code"></i> Etiqueta general de la bodega</button>
            </div>
            <div class="bodega-estantes__lista">
                ${Object.keys(porEstante).length ? Object.keys(porEstante).sort((a, b) => a - b).map(e => `
                    <div class="bodega-estantes__estante"><strong>Estante ${pad2(e)}</strong>
                        ${porEstante[e].map(u => `<span class="bodega-estantes__chip">${esc(u.codigo)}</span>`).join('')}
                    </div>`).join('') : '<p class="bodega-estantes__hint">Aún no hay estantes. Usa "Generar" para crearlos.</p>'}
            </div>`;

        const cant = cont.querySelector('#be-cant'), niv = cont.querySelector('#be-niv'), esp = cont.querySelector('#be-esp'), prev = cont.querySelector('#be-prev');
        const actualizarPrev = () => {
            if (!cant) return;
            const pre = (bodega.prefijo || '').toUpperCase();
            if (!prefijoValido(pre)) { prev.textContent = 'Define y guarda el prefijo primero.'; return; }
            const plan = planificarUbicaciones({ prefijo: pre, desdeEstante: maxEstante + 1, cantidadEstantes: Number(cant.value) || 1, niveles: Number(niv.value) || 1, espacios: Number(esp.value) || 0 });
            prev.textContent = `${plan.length} ubicaciones: ${plan[0].codigo} … ${plan[plan.length - 1].codigo}`;
        };
        [cant, niv, esp].forEach(i => i && i.addEventListener('input', actualizarPrev));
        actualizarPrev();

        const gen = cont.querySelector('#be-gen');
        if (gen) gen.addEventListener('click', async () => {
            const pre = (bodega.prefijo || '').toUpperCase();
            if (!prefijoValido(pre)) { toast('Falta el prefijo', 'Guarda primero el prefijo de la bodega.', 'warning'); return; }
            const plan = planificarUbicaciones({ prefijo: pre, desdeEstante: maxEstante + 1, cantidadEstantes: Number(cant.value) || 1, niveles: Number(niv.value) || 1, espacios: Number(esp.value) || 0 });
            if (plan.length > 600) { toast('Demasiadas ubicaciones', 'Genera de a menos estantes (máximo 600 ubicaciones por vez).', 'warning'); return; }
            gen.disabled = true;
            try {
                const col = fs().collection(db(), 'Bodegas', bodega.id, 'Ubicaciones');
                for (const u of plan) {
                    await fs().setDoc(fs().doc(col, u.codigo), { ...u, bodegaId: bodega.id, prefijo: pre, activo: true, creadoPor: (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || '' });
                }
                toast('Estantes creados', `${plan.length} ubicaciones nuevas.`, 'success');
                renderSeccion(bodega);
            } catch (e) { toast('Error', 'No se pudieron crear: ' + e.message, 'error'); gen.disabled = false; }
        });
        const t = cont.querySelector('#be-etq-todas'); if (t) t.addEventListener('click', () => imprimirEtiquetas(bodega, activas, false));
        const b = cont.querySelector('#be-etq-bodega'); if (b) b.addEventListener('click', () => imprimirEtiquetas(bodega, [], true));
    }

    // ---------------------------------------------------------------
    // Etiquetas imprimibles (código en letra grande + barras + QR)
    // ---------------------------------------------------------------
    function imprimirEtiquetas(bodega, ubicaciones, soloBodega) {
        const items = [];
        const pre = (bodega.prefijo || '').toUpperCase();
        if (soloBodega || !ubicaciones.length) {
            items.push({ titulo: bodega.name, codigo: pre || (String(bodega.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'BOD'), url: `${URL_BASE}#b/${encodeURIComponent(bodega.id)}`, general: true });
        }
        if (!soloBodega) ubicaciones.forEach(u => items.push({ titulo: bodega.name, codigo: u.codigo, url: `${URL_BASE}#u/${encodeURIComponent(bodega.id)}/${encodeURIComponent(u.codigo)}`, general: false }));
        const w = window.open('', '_blank');
        if (!w) { toast('Ventana bloqueada', 'Permite ventanas emergentes para imprimir las etiquetas.', 'warning'); return; }
        const datos = JSON.stringify(items).replace(/</g, '\\u003c');
        w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas ${esc(bodega.name)}</title>
<style>
 @page { size: A4; margin: 10mm; }
 body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #0f172a; }
 .barra { padding: 10px 14px; background: #1A3668; color: #fff; display: flex; gap: 12px; align-items: center; }
 .barra button { padding: 8px 14px; font-weight: 700; border: 0; border-radius: 6px; cursor: pointer; }
 .hoja { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6mm; padding: 8mm; }
 .etq { border: 1.5px solid #1A3668; border-radius: 3mm 3mm 3mm 0; padding: 4mm; display: grid; grid-template-columns: 1fr 34mm; gap: 3mm; align-items: center; break-inside: avoid; }
 .etq--general { border-color: #CC1B23; }
 .etq small { display: block; font-size: 9pt; color: #475569; margin-bottom: 1mm; }
 .etq .cod { font-size: 30pt; font-weight: 800; letter-spacing: 1px; line-height: 1; color: #1A3668; }
 .etq--general .cod { color: #CC1B23; }
 .etq svg.bar { width: 100%; height: 14mm; margin-top: 2mm; }
 .etq .qr { width: 34mm; height: 34mm; }
 .etq .qr img, .etq .qr canvas { width: 100%; height: 100%; }
 @media print { .barra { display: none; } .hoja { padding: 0; } }
</style></head><body>
<div class="barra"><strong>${items.length} etiqueta${items.length === 1 ? '' : 's'}</strong>
<button onclick="window.print()">Imprimir</button><span id="estado">Preparando códigos…</span></div>
<div class="hoja" id="hoja"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"><\/script>
<script>
 const items = ${datos};
 const hoja = document.getElementById('hoja');
 const estado = document.getElementById('estado');
 const fallos = [];
 const msg = (e) => String((e && (e.message || e.name)) || e);
 // Code128 solo admite ASCII: se limpia el texto para las barras (el texto grande queda tal cual)
 const paraBarras = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '').trim() || 'SAR';
 window.addEventListener('load', () => {
   if (typeof JsBarcode === 'undefined') fallos.push('no cargó la librería de código de barras');
   if (typeof qrcode === 'undefined') fallos.push('no cargó la librería de QR');
   items.forEach((it, i) => {
     const d = document.createElement('div'); d.className = 'etq' + (it.general ? ' etq--general' : '');
     const izq = document.createElement('div');
     const s = document.createElement('small'); s.textContent = (it.general ? 'BODEGA • ' : '') + it.titulo; izq.appendChild(s);
     const c = document.createElement('div'); c.className = 'cod'; c.textContent = it.codigo; izq.appendChild(c);
     const q = document.createElement('div'); q.className = 'qr';
     d.appendChild(izq); d.appendChild(q); hoja.appendChild(d);
     if (typeof JsBarcode !== 'undefined') {
       try {
         const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'bar'); izq.appendChild(svg);
         JsBarcode(svg, paraBarras(it.codigo), { format: 'CODE128', displayValue: false, margin: 0, height: 50 });
       } catch (e) { fallos.push('barras de ' + it.codigo + ': ' + msg(e)); }
     }
     if (typeof qrcode !== 'undefined') {
       try {
         const qr = qrcode(0, 'M'); qr.addData(it.url); qr.make(); q.innerHTML = qr.createImgTag(6, 0);
       } catch (e) { fallos.push('QR de ' + it.codigo + ': ' + msg(e)); }
     }
   });
   estado.textContent = fallos.length ? 'Atención: ' + fallos.slice(0, 3).join(' | ') : 'Listo para imprimir';
 });
<\/script></body></html>`);
        w.document.close();
    }

    // ---------------------------------------------------------------
    // Pantalla de acceso rápido (QR de bodega o de ubicación), pensada para el celular
    // ---------------------------------------------------------------
    const AccesoBodega = (() => {
        let datos = null; // { bodega, lineas }

        function rol() { return String(document.body.dataset.userRole || '').toLowerCase(); }
        function pintarError(msg) {
            const c = document.getElementById('acceso-bodega-contenido');
            if (c) c.innerHTML = `<div class="home-empty">${esc(msg)} <a href="#view-panel" class="home-link">Ir al Inicio</a></div>`;
        }

        async function abrir(ctx) {
            const cont = document.getElementById('acceso-bodega-contenido');
            if (!cont || !ctx) return;
            cont.innerHTML = '<div class="home-empty">Cargando bodega…</div>';
            const f = fs();
            try {
                const bSnap = await f.getDoc(f.doc(f.collection(db(), 'Bodegas'), ctx.bodegaId));
                if (!bSnap.exists()) { pintarError('No encontré esa bodega. Puede que la etiqueta sea antigua.'); return; }
                const bodega = { id: bSnap.id, ...bSnap.data() };
                window.__bodegaContexto = { id: bodega.id, name: bodega.name };

                // Stock de la bodega (hasta 600 lotes, agrupados por producto)
                let lineas = [];
                if (ctx.tipo === 'u' && ctx.codigo) {
                    const q = f.query(f.collection(db(), 'Insumos'), f.where('ubicacionCodigo', '==', ctx.codigo), f.limit(300));
                    lineas = agrupar(await f.getDocs(q));
                } else {
                    const q = f.query(f.collection(db(), 'Insumos'), f.where('location', '==', bodega.name), f.limit(600));
                    lineas = agrupar(await f.getDocs(q));
                }
                let ubic = [];
                if (bodega.usaEstantes === true) { try { ubic = (await cargarUbicaciones(bodega.id)).filter(u => u.activo !== false); } catch (e) { /* sin permiso o sin datos */ } }
                datos = { bodega, lineas, ubic, ctx };
                pintar();
            } catch (e) {
                console.warn('[Acceso rápido]', e);
                pintarError('No pude cargar la bodega (' + (e.message || 'error') + ').');
            }
        }

        function agrupar(snap) {
            const m = new Map();
            snap.forEach(d => {
                const x = d.data();
                const k = String(x.name || 'Sin nombre');
                const cant = Number(x.quantity) || 0;
                const lim = Number(x.criticalLimit) || 0;
                const prev = m.get(k) || { name: k, cantidad: 0, limite: 0 };
                prev.cantidad += cant; prev.limite = Math.max(prev.limite, lim);
                m.set(k, prev);
            });
            return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
        }

        function pintar() {
            const cont = document.getElementById('acceso-bodega-contenido');
            const { bodega, lineas, ubic, ctx } = datos;
            const r = rol();
            const esStaff = ['admin', 'administrador', 'global', 'superadmin', 'operador'].includes(r);
            const esUbic = ctx.tipo === 'u' && ctx.codigo;
            const titulo = esUbic ? ctx.codigo : (bodega.prefijo || bodega.name);
            const criticos = lineas.filter(l => l.limite > 0 && l.cantidad <= l.limite).length;
            const botones = [
                { id: 'stock', ico: 'ph-list-magnifying-glass', txt: 'Ver stock', todos: true },
                { id: 'view-movimientos', ico: 'ph-arrow-square-down', txt: 'Ingresar', staff: true },
                { id: 'view-transferencias', ico: 'ph-arrow-square-up', txt: 'Sacar', staff: true },
                { id: 'view-ajustes', ico: 'ph-sliders', txt: 'Ajuste', staff: true },
                { id: 'ubicar', ico: 'ph-map-pin', txt: 'Ubicar', staff: true },
                { id: 'view-toma-inventario', ico: 'ph-clipboard-text', txt: 'Inventario', todos: true }
            ].filter(b => b.todos || (b.staff && esStaff));
            cont.innerHTML = `
                <div class="acceso-bodega__head">
                    <span class="acceso-bodega__tipo">${esUbic ? 'UBICACIÓN' : 'BODEGA'} • ${esc(bodega.name)}</span>
                    <h1 class="acceso-bodega__codigo">${esc(titulo)}</h1>
                    <span class="acceso-bodega__meta">${lineas.length} producto${lineas.length === 1 ? '' : 's'}${criticos ? ` • <strong class="acceso-bodega__alerta">${criticos} en stock crítico</strong>` : ''}</span>
                </div>
                <div class="acceso-bodega__botones">
                    ${botones.map(b => `<button type="button" class="acceso-bodega__btn" data-acc="${esc(b.id)}"><i class="ph-bold ${b.ico}"></i><span>${b.txt}</span></button>`).join('')}
                </div>
                <div class="acceso-bodega__buscar"><input type="search" id="acceso-buscar" placeholder="Buscar producto…" aria-label="Buscar producto"></div>
                <div class="erp-card acceso-bodega__lista" id="acceso-lista"></div>
                ${bodega.usaEstantes === true ? `<div class="erp-card acceso-bodega__ubic" id="acceso-ubic"><h3>Ubicaciones de la bodega</h3>${ubic.length ? ubic.map(u => `<a class="bodega-estantes__chip" href="#u/${encodeURIComponent(bodega.id)}/${encodeURIComponent(u.codigo)}">${esc(u.codigo)}</a>`).join(' ') : '<p class="bodega-estantes__hint">Aún no hay estantes creados.</p>'}</div>` : ''}
                <p class="acceso-bodega__pie"><a href="#view-panel">Ver el sitio completo</a></p>`;
            const lista = cont.querySelector('#acceso-lista');
            const pintarLista = (filtro) => {
                const f = String(filtro || '').toLowerCase();
                const filas = lineas.filter(l => !f || l.name.toLowerCase().includes(f));
                lista.innerHTML = filas.length ? filas.map(l => {
                    const crit = l.limite > 0 && l.cantidad <= l.limite;
                    return `<div class="acceso-bodega__fila${crit ? ' acceso-bodega__fila--crit' : ''}"><span>${esc(l.name)}</span><strong>${l.cantidad}</strong></div>`;
                }).join('') : `<div class="home-empty">${lineas.length ? 'Sin resultados.' : (esUbic ? 'Aún no hay productos asignados a esta ubicación.' : 'Esta bodega no tiene productos registrados.')}</div>`;
            };
            pintarLista('');
            cont.querySelector('#acceso-buscar').addEventListener('input', (e) => pintarLista(e.target.value));
            cont.querySelectorAll('[data-acc]').forEach(btn => btn.addEventListener('click', () => {
                const id = btn.dataset.acc;
                if (id === 'stock') { lista.scrollIntoView({ behavior: 'smooth', block: 'start' }); const i = cont.querySelector('#acceso-buscar'); if (i) i.focus(); }
                else if (id === 'ubicar') { const u = cont.querySelector('#acceso-ubic'); if (u) u.scrollIntoView({ behavior: 'smooth' }); else toast('Sin estantes', 'Esta bodega no usa estantes.', 'info'); }
                else window.location.hash = id;
            }));
        }

        return { abrir };
    })();

    window.SAR_AccesoBodega = AccesoBodega;
    window.SAR_Estantes = { renderSeccion, planificarUbicaciones, codigoUbicacion, prefijoValido, imprimirEtiquetas };
})(window, document);
