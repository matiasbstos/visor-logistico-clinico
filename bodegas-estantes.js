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

    /** Amplía un estante existente de forma correlativa (puro).
     *  - espaciosNuevos: espacios que se suman a CADA nivel, a continuación del último existente.
     *  - nivelesNuevos: niveles que se suman encima del último (letras siguientes).
     *  `existentes` = todas las ubicaciones de ese estante (activas o archivadas), para no repetir códigos. */
    function planificarAmpliacion({ prefijo, estante, existentes, espaciosNuevos, nivelesNuevos }) {
        espaciosNuevos = Math.max(0, Number(espaciosNuevos) || 0);
        nivelesNuevos = Math.max(0, Number(nivelesNuevos) || 0);
        const maxEsp = {}; let sinEspacio = false, maxIdx = -1;
        existentes.forEach(u => {
            const i = LETRAS.indexOf(u.nivel); if (i > maxIdx) maxIdx = i;
            maxEsp[u.nivel] = Math.max(maxEsp[u.nivel] || 0, u.espacio || 0);
            if (!u.espacio) sinEspacio = true;
        });
        if (maxIdx < 0) return { error: 'El estante no tiene niveles.' };
        if (espaciosNuevos > 0 && sinEspacio) return { error: 'Este estante se creó sin espacios por nivel; no se le pueden agregar espacios correlativos.' };
        if (maxIdx + nivelesNuevos >= LETRAS.length) return { error: `Máximo ${LETRAS.length} niveles por estante.` };
        const conEspacios = !sinEspacio;
        const baseEsp = conEspacios ? Math.max(...Object.values(maxEsp)) : 0;
        const totalEsp = baseEsp + espaciosNuevos;
        const codigos = new Set(existentes.map(u => u.codigo));
        const out = [];
        const push = (nivel, espacio) => {
            const codigo = codigoUbicacion(prefijo, estante, nivel, espacio);
            if (!codigos.has(codigo)) { codigos.add(codigo); out.push({ codigo, estante, nivel, espacio: espacio || null }); }
        };
        // Espacios nuevos en los niveles que ya existían (continúan desde el último de cada nivel)
        if (espaciosNuevos > 0) Object.keys(maxEsp).forEach(nivel => { for (let s = maxEsp[nivel] + 1; s <= totalEsp; s++) push(nivel, s); });
        // Niveles nuevos encima del último
        for (let k = 1; k <= nivelesNuevos; k++) {
            const nivel = LETRAS[maxIdx + k];
            if (conEspacios) { for (let s = 1; s <= Math.max(totalEsp, 1); s++) push(nivel, s); } else push(nivel, null);
        }
        return { plan: out };
    }

    function nuevoLote() {
        const d = new Date(), p = (n) => String(n).padStart(2, '0');
        return { lote: `L${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`, creadoEn: d.toISOString() };
    }
    function fmtFecha(iso) {
        const d = new Date(iso); if (isNaN(d)) return 'Anterior';
        return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    }
    /** Agrupa ubicaciones por lote de creación (las antiguas, sin lote, quedan juntas). */
    function agruparLotes(lista) {
        const m = {};
        lista.forEach(u => { const k = u.lote || 'anterior'; (m[k] = m[k] || { lote: k, creadoEn: u.creadoEn || '', por: u.creadoPor || '', items: [] }).items.push(u); });
        return Object.values(m).sort((a, b) => String(a.creadoEn).localeCompare(String(b.creadoEn)));
    }
    function rangoTexto(items) {
        const c = items.map(u => u.codigo).sort(); return c.length > 1 ? `${c[0]} … ${c[c.length - 1]}` : (c[0] || '');
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
        const sinNombre = !String(bodega.name || '').trim();
        sec.innerHTML = `
            ${admin ? `<div class="bodega-estantes__row be-nombre"><label class="bodega-estantes__prefijo" style="flex:1">Nombre de la bodega${sinNombre ? ' <strong style="color:#c0392b">(falta)</strong>' : ''}
                <input type="text" id="be-nombre" maxlength="60" value="${esc(sinNombre ? 'Bodega Central' : bodega.name)}" placeholder="Ej.: Bodega Central"></label>
                <button type="button" class="btn btn-outline" id="be-guardar-nombre">Guardar nombre</button></div>` : ''}
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
            ${admin && bodega.isActive === false ? `<div class="bodega-estantes__hint" style="display:flex;gap:10px;align-items:center;"><span><strong>Esta bodega está ${bodega.archivada ? 'archivada' : 'inactiva'}.</strong></span><button type="button" class="btn btn-primary btn-sm" id="be-reactivar">Reactivar</button></div>` : ''}
            <p class="bodega-estantes__hint"><strong>Guardado:</strong> prefijo ${bodega.prefijo ? esc(bodega.prefijo) : '(ninguno)'} • ${usa ? 'usa estantes' : 'sin estantes'}</p>
            <p class="bodega-estantes__hint">${usa ? 'Los productos de esta bodega se ubican por estante, nivel y espacio. Puede haber productos "sin ubicar" mientras se asignan.' : 'Modo simple: los productos se asignan a la bodega, sin estantes.'}</p>
            <div id="be-contenido"></div>
            ${admin && bodega.isActive !== false ? '<div class="bodega-estantes__cierre"><button type="button" class="btn btn-outline" id="be-cerrar"><i class="ph-bold ph-lock-key"></i> Cerrar bodega…</button><span class="bodega-estantes__hint">Devuelve todo el stock a otra bodega y archiva esta. Antes te muestra qué se movería.</span></div>' : ''}`;
        const btnCerrar = sec.querySelector('#be-cerrar');
        if (btnCerrar) btnCerrar.addEventListener('click', () => { if (window.SAR_Cierre) window.SAR_Cierre.abrir({ id: bodega.id, name: nombreBodega(bodega) }); });

        const reactivar = sec.querySelector('#be-reactivar');
        if (reactivar) reactivar.addEventListener('click', async () => {
            reactivar.disabled = true;
            try {
                const ref = fs().doc(fs().collection(db(), 'Bodegas'), bodega.id);
                await fs().updateDoc(ref, { isActive: true, archivada: false });
                const leido = (await fs().getDoc(ref)).data() || {};
                if (leido.isActive !== true) throw new Error('el dato no quedó guardado');
                bodega.isActive = true; bodega.archivada = false;
                toast('Bodega reactivada', 'Vuelve a figurar como activa.', 'success');
                renderSeccion(bodega);
            } catch (e) { toast('No se reactivó', `${e.code || 'error'}: ${e.message}`, 'error'); reactivar.disabled = false; }
        });

        const gn = sec.querySelector('#be-guardar-nombre');
        if (gn) gn.addEventListener('click', async () => {
            const nuevo = sec.querySelector('#be-nombre').value.trim().replace(/\s+/g, ' ');
            if (!nuevo) { toast('Falta el nombre', 'Escribe el nombre de la bodega.', 'warning'); return; }
            let antes = String(bodega.name || '').trim();   // v21.123: una bodega nueva sin nombre NO hereda el stock de «Bodega Central»
            gn.disabled = true; gn.textContent = 'Guardando…';
            const prog = window.SAR_Progreso.iniciar('Guardando el nombre de la bodega…', ['Comprobando que el nombre no esté repetido…']);
            try {
                const todas = await fs().getDocs(fs().collection(db(), 'Bodegas'));
                let repetido = false; todas.forEach(d => { if (d.id !== bodega.id && String(d.data().name || '').trim().toLowerCase() === nuevo.toLowerCase()) repetido = true; });
                if (repetido) throw new Error('Ya existe otra bodega con ese nombre.');
                if (!antes) { let hayCentral = false; todas.forEach(d => { if (d.id !== bodega.id && /^bodega central$/i.test(String(d.data().name || '').trim())) hayCentral = true; }); if (!hayCentral) antes = 'Bodega Central'; }   // solo la bodega original, sin nombre, equivale a «Bodega Central»
                if (antes && antes.toLowerCase() !== nuevo.toLowerCase()) {
                    const n0 = await fs().getDocs(fs().query(fs().collection(db(), 'Insumos'), fs().where('location', '==', antes), fs().limit(1500)));
                    if (n0.size && !confirm(`Al cambiar el nombre de «${antes}» a «${nuevo}», ${n0.size} producto(s) con stock pasarán a llamarse «${nuevo}».\n\n¿Es lo que quieres?`)) throw new Error('Cancelado: el nombre no se cambió.');
                }
                const ref = fs().doc(fs().collection(db(), 'Bodegas'), bodega.id);
                await fs().setDoc(ref, { name: nuevo, ...(bodega.type ? {} : { type: 'principal' }) }, { merge: true });
                let movidos = 0;
                if (antes && antes.toLowerCase() !== nuevo.toLowerCase()) {      // el stock que estaba en la bodega sigue con ella
                    const ins = await fs().getDocs(fs().query(fs().collection(db(), 'Insumos'), fs().where('location', '==', antes), fs().limit(1500)));
                    for (const d of ins.docs) { await fs().updateDoc(d.ref, { location: nuevo }); movidos++; }
                }
                const leido = (await fs().getDoc(ref)).data() || {};
                if (leido.name !== nuevo) throw new Error('el dato no quedó guardado');
                bodega.name = nuevo; if (!bodega.type) bodega.type = 'principal';
                const t = document.getElementById('modal-bodega-name'); if (t) t.innerText = nuevo;
                const m = document.getElementById('bodega-modal'); if (m) m.dataset.currentBodegaName = nuevo;
                prog.listo(movidos ? `${nuevo}: ${movidos} producto(s) pasaron a esta bodega con su nuevo nombre` : `Nombre guardado: ${nuevo}`);
                renderSeccion(bodega);
            } catch (e) { prog.error(); toast('No se guardó el nombre', e.message || String(e), 'error'); gn.disabled = false; gn.textContent = 'Guardar nombre'; }
        });

        const guardar = sec.querySelector('#be-guardar');
        if (guardar) guardar.addEventListener('click', async () => {
            const prefijo = sec.querySelector('#be-prefijo').value.trim().toUpperCase();
            const usaNuevo = sec.querySelector('#be-usa').checked;
            if (prefijo && !prefijoValido(prefijo)) { toast('Prefijo no válido', 'Usa de 1 a 4 letras o números, sin guiones (ej. BS).', 'warning'); return; }
            if (usaNuevo && !prefijo) { toast('Falta el prefijo', 'Para usar estantes la bodega necesita un prefijo (ej. BS).', 'warning'); return; }
            guardar.disabled = true; guardar.textContent = 'Guardando…';
            const prog = window.SAR_Progreso.iniciar('Guardando la configuración de la bodega…', ['Guardando prefijo y estantes…']);
            try {
                const ref = fs().doc(fs().collection(db(), 'Bodegas'), bodega.id);
                await fs().setDoc(ref, { usaEstantes: usaNuevo, prefijo }, { merge: true });
                // Verificación: se vuelve a leer el documento y se compara
                const leido = (await fs().getDoc(ref)).data() || {};
                if ((leido.prefijo || '') !== prefijo || (leido.usaEstantes === true) !== usaNuevo) throw new Error('el dato no quedó guardado');
                bodega.usaEstantes = usaNuevo; bodega.prefijo = prefijo;
                prog.listo(`Guardado y verificado: prefijo ${prefijo || '(ninguno)'} • ${usaNuevo ? 'usa estantes' : 'sin estantes'}`);
                renderSeccion(bodega);
            } catch (e) {
                prog.error();
                toast('No se guardó', `${e.code || 'error'}: ${e.message}`, 'error');
                guardar.disabled = false; guardar.textContent = 'Guardar';
            }
        });

        const cont = sec.querySelector('#be-contenido');
        if (!usa) { cont.innerHTML = `<button type="button" class="btn btn-outline" id="be-etq-bodega"><i class="ph-bold ph-qr-code"></i> Etiqueta general de la bodega</button>`;
            const b = cont.querySelector('#be-etq-bodega'); if (b) b.addEventListener('click', () => imprimirEtiquetas(bodega, [], true)); return; }

        cont.innerHTML = (window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando ubicaciones…') : 'Cargando ubicaciones…');
        let ubic = [];
        try { ubic = await cargarUbicaciones(bodega.id); } catch (e) { cont.innerHTML = '<p class="bodega-estantes__hint">No se pudieron cargar las ubicaciones.</p>'; return; }
        const activas = ubic.filter(u => u.activo !== false);
        const maxEstante = ubic.reduce((m, u) => Math.max(m, u.estante || 0), 0); // incluye archivadas: la numeración nunca retrocede
        const lotes = agruparLotes(ubic.filter(u => u.activo !== false));
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
            </div>
            <div class="bodega-estantes__gen" id="be-ampliar-box">
                <strong>Ampliar un estante existente</strong>
                <label>Estante <select id="be-amp-est">${Object.keys(porEstante).sort((a, b) => a - b).map(e => `<option value="${e}">${pad2(e)}</option>`).join('')}</select></label>
                <label>Espacios a sumar por nivel <input type="number" id="be-amp-esp" min="0" max="9" value="0"></label>
                <label>Niveles a sumar arriba <input type="number" id="be-amp-niv" min="0" max="9" value="0"></label>
                <button type="button" class="btn btn-primary" id="be-amp">Agregar</button>
                <span class="bodega-estantes__hint" id="be-amp-prev"></span>
            </div>` : ''}
            <div class="bodega-estantes__acciones">
                <button type="button" class="btn btn-outline" id="be-etq-todas" ${activas.length ? '' : 'disabled'}><i class="ph-bold ph-printer"></i> Imprimir etiquetas de estantes (${activas.length})</button>
                <button type="button" class="btn btn-outline" id="be-etq-bodega"><i class="ph-bold ph-qr-code"></i> Etiqueta general de la bodega</button>
            </div>
            <div class="bodega-estantes__lista">
                ${Object.keys(porEstante).length ? Object.keys(porEstante).sort((a, b) => a - b).map(e => `
                    <div class="bodega-estantes__estante"><strong>Estante ${pad2(e)}</strong>
                        <button type="button" class="btn btn-outline btn-sm" data-reimp-estante="${e}" title="Reimprimir las etiquetas de este estante"><i class="ph-bold ph-printer"></i></button>
                        ${porEstante[e].map(u => `<span class="bodega-estantes__chip">${esc(u.codigo)}</span>`).join('')}
                    </div>`).join('') : '<p class="bodega-estantes__hint">Aún no hay estantes. Usa "Generar" para crearlos.</p>'}
            </div>
            <details class="bodega-estantes__historial" ${lotes.length ? '' : 'hidden'}>
                <summary><strong>Historial de etiquetas</strong> — ${Object.keys(porEstante).length} estantes • ${activas.length} ubicaciones • ${lotes.length} ${lotes.length === 1 ? 'tanda' : 'tandas'}${ubic.length > activas.length ? ` • ${ubic.length - activas.length} archivadas` : ''}</summary>
                ${lotes.map((l, i) => `<div class="bodega-estantes__lote">
                    <span><strong>${l.lote === 'anterior' ? 'Anteriores' : fmtFecha(l.creadoEn)}</strong>${l.por ? ' • ' + esc(l.por) : ''}<br><small>${l.items.length} ubicaciones: ${esc(rangoTexto(l.items))}</small></span>
                    <button type="button" class="btn btn-outline btn-sm" data-reimp-lote="${i}"><i class="ph-bold ph-printer"></i> Reimprimir</button>
                </div>`).join('')}
            </details>`;

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
            await crearUbicaciones(plan, pre, gen, 'Estantes creados');
        });
        async function crearUbicaciones(plan, pre, boton, titulo) {
            const existentes = new Set(ubic.map(u => u.codigo));
            const nuevas = plan.filter(u => !existentes.has(u.codigo)); // nunca se sobrescribe una ubicación existente
            if (!nuevas.length) { toast('Nada que crear', 'Esas ubicaciones ya existen.', 'warning'); return; }
            boton.disabled = true;
            try {
                const col = fs().collection(db(), 'Bodegas', bodega.id, 'Ubicaciones');
                const { lote, creadoEn } = nuevoLote();
                const autor = (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || '';
                for (const u of nuevas) {
                    await fs().setDoc(fs().doc(col, u.codigo), { ...u, bodegaId: bodega.id, prefijo: pre, activo: true, creadoPor: autor, lote, creadoEn });
                }
                toast(titulo, `${nuevas.length} ubicaciones nuevas (${rangoTexto(nuevas)}). Las encuentras en el historial para imprimirlas.`, 'success');
                renderSeccion(bodega);
            } catch (e) { toast('Error', 'No se pudieron crear: ' + e.message, 'error'); boton.disabled = false; }
        }

        // Ampliar un estante: espacios correlativos y/o niveles nuevos
        const ampEst = cont.querySelector('#be-amp-est'), ampEsp = cont.querySelector('#be-amp-esp'), ampNiv = cont.querySelector('#be-amp-niv'), ampPrev = cont.querySelector('#be-amp-prev'), ampBtn = cont.querySelector('#be-amp');
        const planAmpliar = () => {
            const pre = (bodega.prefijo || '').toUpperCase();
            if (!ampEst || !ampEst.value) return { error: 'Primero crea un estante.' };
            if (!prefijoValido(pre)) return { error: 'Define y guarda el prefijo primero.' };
            const est = Number(ampEst.value);
            return planificarAmpliacion({ prefijo: pre, estante: est, existentes: ubic.filter(u => u.estante === est), espaciosNuevos: ampEsp.value, nivelesNuevos: ampNiv.value });
        };
        const actualizarAmp = () => {
            if (!ampPrev) return; const r = planAmpliar();
            ampPrev.textContent = r.error ? r.error : (r.plan.length ? `${r.plan.length} nuevas: ${rangoTexto(r.plan)}` : 'Indica cuántos espacios o niveles sumar.');
        };
        [ampEst, ampEsp, ampNiv].forEach(i => i && i.addEventListener('input', actualizarAmp));
        actualizarAmp();
        if (ampBtn) ampBtn.addEventListener('click', async () => {
            const r = planAmpliar();
            if (r.error) { toast('No se puede ampliar', r.error, 'warning'); return; }
            if (!r.plan.length) { toast('Nada que agregar', 'Indica cuántos espacios o niveles sumar.', 'warning'); return; }
            await crearUbicaciones(r.plan, (bodega.prefijo || '').toUpperCase(), ampBtn, 'Estante ampliado');
        });

        // Reimpresión por estante o por tanda
        cont.querySelectorAll('[data-reimp-estante]').forEach(btn => btn.addEventListener('click', () => {
            const est = Number(btn.dataset.reimpEstante); imprimirEtiquetas(bodega, activas.filter(u => u.estante === est), false);
        }));
        cont.querySelectorAll('[data-reimp-lote]').forEach(btn => btn.addEventListener('click', () => {
            const l = lotes[Number(btn.dataset.reimpLote)]; if (l) imprimirEtiquetas(bodega, l.items, false);
        }));
        const t = cont.querySelector('#be-etq-todas'); if (t) t.addEventListener('click', () => imprimirEtiquetas(bodega, activas, false));
        const b = cont.querySelector('#be-etq-bodega'); if (b) b.addEventListener('click', () => imprimirEtiquetas(bodega, [], true));
    }

    // ---------------------------------------------------------------
    // Etiquetas imprimibles (código en letra grande + barras + QR)
    // ---------------------------------------------------------------
    /** Nombre visible de la bodega, con respaldos por si el objeto llega incompleto. */
    function nombreBodega(b) {
        const el = document.getElementById('modal-bodega-name');
        return String((b && (b.name || b.nombre)) || (el && el.textContent) || (b && b.prefijo) || (b && b.id) || '').trim();
    }
    function imprimirEtiquetas(bodega, ubicaciones, soloBodega) {
        const nombre = nombreBodega(bodega);
        const items = [];
        const pre = (bodega.prefijo || '').toUpperCase();
        if (soloBodega || !ubicaciones.length) {
            items.push({ titulo: nombre, codigo: pre || (String(nombre).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'BOD'), url: `${URL_BASE}#b/${encodeURIComponent(bodega.id)}`, general: true });
        }
        if (!soloBodega) ubicaciones.forEach(u => items.push({ titulo: nombre, codigo: u.codigo, url: `${URL_BASE}#u/${encodeURIComponent(bodega.id)}/${encodeURIComponent(u.codigo)}`, general: false }));
        const w = window.open('', '_blank');
        if (!w) { toast('Ventana bloqueada', 'Permite ventanas emergentes para imprimir las etiquetas.', 'warning'); return; }
        const datos = JSON.stringify(items).replace(/</g, '\\u003c');
        w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas ${esc(nombre)}</title>
<style>
 @page { size: A4; margin: 10mm; }
 body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #0f172a; }
 .barra { padding: 10px 14px; background: #1A3668; color: #fff; display: flex; gap: 12px; align-items: center; }
 .barra button { padding: 8px 14px; font-weight: 700; border: 0; border-radius: 6px; cursor: pointer; }
 .hoja { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6mm; padding: 8mm; }
 .etq { border: 1.5px solid #1A3668; border-radius: 3mm 3mm 3mm 0; padding: 4mm; display: grid; grid-template-columns: 1fr 34mm; gap: 3mm; align-items: center; break-inside: avoid; }
 .etq--general { border-color: #CC1B23; }
 .etq-top { display: flex; align-items: center; gap: 2.5mm; margin-bottom: 1.5mm; }
 .etq-top img { height: 10mm; width: auto; }
 .etq small { display: block; font-size: 9pt; color: #475569; margin: 0; }
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
     const top = document.createElement('div'); top.className = 'etq-top';
     const logo = document.createElement('img'); logo.src = '${URL_BASE}assets/logo-sar.png'; logo.alt = 'SAR'; top.appendChild(logo);
     const s = document.createElement('small'); s.textContent = (it.general ? 'BODEGA • ' : '') + (it.titulo || ''); top.appendChild(s); izq.appendChild(top);
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
    // Asignaciones: cuánto de cada producto hay en cada ubicación
    // (el stock total sigue en Insumos; lo no asignado queda "sin ubicar")
    // ---------------------------------------------------------------
    const slug = (t) => String(t || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'SIN_NOMBRE';
    const idAsignacion = (bodegaId, codigo, nombre) => `${bodegaId}__${codigo}__${slug(nombre)}`;

    async function cargarAsignaciones(bodegaId) {
        const f = fs();
        const q = bodegaId
            ? f.query(f.collection(db(), 'Asignaciones_Ubicacion'), f.where('bodegaId', '==', bodegaId), f.limit(3000))
            : f.query(f.collection(db(), 'Asignaciones_Ubicacion'), f.limit(3000));
        const snap = await f.getDocs(q);
        const out = [];
        snap.forEach(d => out.push({ id: d.id, ...d.data() }));
        return out;
    }

    /** Puro: cuánto queda sin ubicar de un producto (total - asignado), sin contar la asignación que se está editando. */
    function sinUbicar(total, asignaciones, nombre, excluirId) {
        const asignado = asignaciones.filter(a => slug(a.insumoName) === slug(nombre) && a.id !== excluirId).reduce((s, a) => s + (Number(a.cantidad) || 0), 0);
        return Math.max(0, (Number(total) || 0) - asignado);
    }

    async function guardarAsignacion(bodegaId, codigo, nombre, cantidad) {
        const f = fs();
        const id = idAsignacion(bodegaId, codigo, nombre);
        const ref = f.doc(f.collection(db(), 'Asignaciones_Ubicacion'), id);
        if (!(cantidad > 0)) { await f.deleteDoc(ref); return; }
        await f.setDoc(ref, {
            bodegaId, codigo, insumoName: nombre, cantidad: Number(cantidad),
            actualizadoPor: (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || '',
            actualizadoEn: new Date().toISOString()
        });
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
            cont.innerHTML = (window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando la bodega…') : 'Cargando la bodega…');
            const f = fs();
            try {
                const bSnap = await f.getDoc(f.doc(f.collection(db(), 'Bodegas'), ctx.bodegaId));
                if (!bSnap.exists()) { pintarError('No encontré esa bodega. Puede que la etiqueta sea antigua.'); return; }
                const bodega = { id: bSnap.id, ...bSnap.data() };
                window.__bodegaContexto = { id: bodega.id, name: bodega.name };

                // Stock de la bodega (hasta 600 lotes, agrupados por producto)
                let lineas = [];
                if (ctx.tipo === 'u' && ctx.codigo) {
                    lineas = [];
                } else {
                    const q = f.query(f.collection(db(), 'Insumos'), f.where('location', '==', bodega.name), f.limit(600));
                    lineas = agrupar(await f.getDocs(q));
                }
                let ubic = [];
                if (bodega.usaEstantes === true) { try { ubic = (await cargarUbicaciones(bodega.id)).filter(u => u.activo !== false); } catch (e) { /* sin permiso o sin datos */ } }
                let asign = [];
                if (bodega.usaEstantes === true) { try { asign = await cargarAsignaciones(bodega.id); } catch (e) { /* sin permiso */ } }
                if (ctx.tipo === 'u' && ctx.codigo) {
                    // en la pantalla de un estante, la lista es lo asignado a ese estante (el stock total se toma de la bodega)
                    const qb = f.query(f.collection(db(), 'Insumos'), f.where('location', '==', bodega.name), f.limit(600));
                    const totales = agrupar(await f.getDocs(qb));
                    lineas = asign.filter(a => a.codigo === ctx.codigo).map(a => ({ name: a.insumoName, cantidad: Number(a.cantidad) || 0, limite: 0 })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
                    datos = { bodega, lineas, ubic, ctx, asign, totales };
                } else {
                    datos = { bodega, lineas, ubic, ctx, asign, totales: lineas };
                }
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
            const { bodega, lineas, ubic, ctx, asign, totales } = datos;
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
                <div id="acceso-ubicar"></div>
                ${bodega.usaEstantes === true ? `<div class="erp-card acceso-bodega__ubic" id="acceso-ubic"><h3>Ubicaciones de la bodega</h3>${ubic.length ? ubic.map(u => `<a class="bodega-estantes__chip" href="#u/${encodeURIComponent(bodega.id)}/${encodeURIComponent(u.codigo)}">${esc(u.codigo)}</a>`).join(' ') : '<p class="bodega-estantes__hint">Aún no hay estantes creados.</p>'}</div>` : ''}
                <p class="acceso-bodega__pie"><a href="#view-panel">Ver el sitio completo</a></p>`;
            const lista = cont.querySelector('#acceso-lista');
            const pintarLista = (filtro) => {
                const f = String(filtro || '').toLowerCase();
                const filas = lineas.filter(l => !f || l.name.toLowerCase().includes(f));
                lista.innerHTML = filas.length ? filas.map(l => {
                    const crit = l.limite > 0 && l.cantidad <= l.limite;
                    let extra = '';
                    if (bodega.usaEstantes === true && !esUbic) {
                        const su = sinUbicar(l.cantidad, asign, l.name);
                        if (su > 0) extra = `<small class="acceso-bodega__sinubicar">${su} sin ubicar</small>`;
                    }
                    const quitar = esUbic && esStaff ? `<button type="button" class="acceso-bodega__quitar" data-quitar="${esc(l.name)}" aria-label="Quitar de esta ubicación">Quitar</button>` : '';
                    return `<div class="acceso-bodega__fila${crit ? ' acceso-bodega__fila--crit' : ''}"><span>${esc(l.name)}${extra}</span><span class="acceso-bodega__cant"><strong>${l.cantidad}</strong>${quitar}</span></div>`;
                }).join('') : `<div class="home-empty">${lineas.length ? 'Sin resultados.' : (esUbic ? 'Aún no hay productos asignados a esta ubicación.' : 'Esta bodega no tiene productos registrados.')}</div>`;
                lista.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', async () => {
                    try { await guardarAsignacion(bodega.id, ctx.codigo, b.dataset.quitar, 0); toast('Listo', 'Quitado de esta ubicación.', 'success'); abrir(ctx); }
                    catch (e) { toast('Error', 'No se pudo quitar: ' + e.message, 'error'); }
                }));
            };
            pintarLista('');
            cont.querySelector('#acceso-buscar').addEventListener('input', (e) => pintarLista(e.target.value));
            cont.querySelectorAll('[data-acc]').forEach(btn => btn.addEventListener('click', () => {
                const id = btn.dataset.acc;
                if (id === 'stock') { lista.scrollIntoView({ behavior: 'smooth', block: 'start' }); const i = cont.querySelector('#acceso-buscar'); if (i) i.focus(); }
                else if (id === 'ubicar') {
                    if (bodega.usaEstantes !== true) { toast('Sin estantes', 'Esta bodega no usa estantes.', 'info'); return; }
                    if (!ubic.length) { toast('Sin estantes', 'Primero crea los estantes en Bodegas.', 'info'); return; }
                    panelUbicar(cont.querySelector('#acceso-ubicar'), esUbic ? ctx.codigo : null);
                }
                else {
                    window.location.hash = id;
                    if (id === 'view-toma-inventario') preseleccionarBodega('toma-ubicacion', nombreBodega(bodega));
                }
            }));
        }

        /** Deja elegida la bodega en un selector de otra pantalla (espera a que sus opciones carguen). */
        function preseleccionarBodega(selectId, nombre) {
            let intentos = 0;
            const t = setInterval(() => {
                const sel = document.getElementById(selectId);
                const opt = sel && Array.from(sel.options).find(o => o.value === nombre || o.textContent.trim() === nombre);
                if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); clearInterval(t); }
                else if (++intentos > 25) clearInterval(t);
            }, 200);
        }

        function panelUbicar(host, codigoFijo) {
            const { bodega, ubic, ctx, asign, totales } = datos;
            const productos = totales.slice().sort((a, b) => (sinUbicar(b.cantidad, asign, b.name) > 0) - (sinUbicar(a.cantidad, asign, a.name) > 0) || a.name.localeCompare(b.name, 'es'));
            host.innerHTML = `
                <div class="erp-card acceso-bodega__form">
                    <h3>Ubicar un producto</h3>
                    <label>Producto
                        <select id="ub-prod">${productos.map(p => `<option value="${esc(p.name)}">${esc(p.name)} (${sinUbicar(p.cantidad, asign, p.name)} sin ubicar)</option>`).join('')}</select>
                    </label>
                    <label>Ubicación
                        <select id="ub-cod" ${codigoFijo ? 'disabled' : ''}>${ubic.map(u => `<option value="${esc(u.codigo)}" ${u.codigo === codigoFijo ? 'selected' : ''}>${esc(u.codigo)}</option>`).join('')}</select>
                    </label>
                    <label>Cantidad en esa ubicación
                        <input type="number" id="ub-cant" min="0" step="1" inputmode="numeric">
                    </label>
                    <p class="bodega-estantes__hint" id="ub-ayuda"></p>
                    <div class="acceso-bodega__acciones"><button type="button" class="btn btn-primary" id="ub-guardar">Guardar</button> <button type="button" class="btn btn-outline" id="ub-cerrar">Cerrar</button></div>
                </div>`;
            const sel = host.querySelector('#ub-prod'), cod = host.querySelector('#ub-cod'), cant = host.querySelector('#ub-cant'), ayuda = host.querySelector('#ub-ayuda');
            const refrescar = () => {
                const p = productos.find(x => x.name === sel.value); if (!p) return;
                const existente = asign.find(a => a.id === idAsignacion(bodega.id, cod.value, p.name));
                const libre = sinUbicar(p.cantidad, asign, p.name, existente && existente.id) ;
                cant.max = libre; cant.value = existente ? existente.cantidad : libre;
                ayuda.textContent = `Stock total: ${p.cantidad}. Se puede ubicar hasta ${libre} aquí.${existente ? ' Ya hay ' + existente.cantidad + ' en esta ubicación; el número reemplaza esa cantidad (0 la quita).' : ''}`;
            };
            sel.addEventListener('change', refrescar); cod.addEventListener('change', refrescar); refrescar();
            host.querySelector('#ub-cerrar').addEventListener('click', () => { host.innerHTML = ''; });
            host.querySelector('#ub-guardar').addEventListener('click', async () => {
                const p = productos.find(x => x.name === sel.value); if (!p) return;
                const existente = asign.find(a => a.id === idAsignacion(bodega.id, cod.value, p.name));
                const libre = sinUbicar(p.cantidad, asign, p.name, existente && existente.id);
                const n = Math.floor(Number(cant.value));
                if (!(n >= 0)) { toast('Cantidad no válida', 'Ingresa un número de 0 o más.', 'warning'); return; }
                if (n > libre) { toast('Supera el stock', `Solo hay ${libre} sin ubicar de este producto.`, 'warning'); return; }
                try { await guardarAsignacion(bodega.id, cod.value, p.name, n); toast('Guardado', `${p.name}: ${n} en ${cod.value}.`, 'success'); abrir(ctx); }
                catch (e) { toast('Error', 'No se pudo guardar: ' + e.message, 'error'); }
            });
            host.scrollIntoView({ behavior: 'smooth' });
        }

        return { abrir };
    })();

    // ---------------------------------------------------------------
    // ¿Dónde está?: producto -> bodega -> estante
    // ---------------------------------------------------------------
    const DondeEsta = (() => {
        let cache = null; // { t, insumos, bodegas, asign }
        let iniciado = false;

        async function cargar() {
            if (cache && Date.now() - cache.t < 120000) return cache;
            const f = fs();
            const [ins, bod, asg] = await Promise.all([
                f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(3000))),
                f.getDocs(f.collection(db(), 'Bodegas')),
                cargarAsignaciones(null).catch(() => [])
            ]);
            const insumos = []; ins.forEach(d => insumos.push(d.data()));
            const bodegas = []; bod.forEach(d => bodegas.push({ id: d.id, ...d.data() }));
            cache = { t: Date.now(), insumos, bodegas, asign: asg };
            return cache;
        }

        function resultados(q, { insumos, bodegas, asign }) {
            const t = slug(q).replace(/_/g, ' ');
            const porProducto = new Map(); // nombre -> Map(bodegaNombre -> cantidad)
            insumos.forEach(i => {
                const n = String(i.name || ''); if (!n) return;
                const dq = String(q).replace(/\D/g, ''), esId = dq.length >= 3 && !/[a-z]/i.test(String(q).replace(/[\s-]/g, ''));
                if (!slug(n).replace(/_/g, ' ').includes(t) && !(esId && (String(i.codigoMP || '').replace(/\D/g, '').includes(dq) || (window.SAR_IdProducto && window.SAR_IdProducto.coincide(n, q))))) return;
                const loc = String(i.location || 'Sin bodega');
                const m = porProducto.get(n) || new Map();
                m.set(loc, (m.get(loc) || 0) + (Number(i.quantity) || 0));
                porProducto.set(n, m);
            });
            return Array.from(porProducto.entries()).sort((a, b) => a[0].localeCompare(b[0], 'es')).slice(0, 25).map(([nombre, m]) => ({
                nombre,
                bodegas: Array.from(m.entries()).map(([loc, cant]) => {
                    const b = bodegas.find(x => x.name === loc);
                    const ub = b ? asign.filter(a => a.bodegaId === b.id && slug(a.insumoName) === slug(nombre)).sort((x, y) => String(x.codigo).localeCompare(String(y.codigo))) : [];
                    const asignado = ub.reduce((s, a) => s + (Number(a.cantidad) || 0), 0);
                    return { bodega: loc, bodegaId: b && b.id, usaEstantes: b && b.usaEstantes === true, cantidad: cant, ubicaciones: ub, sinUbicar: Math.max(0, cant - asignado) };
                }).sort((x, y) => y.cantidad - x.cantidad)
            }));
        }

        function pintar(res) {
            const cont = document.getElementById('donde-resultados');
            if (!res.length) { cont.innerHTML = '<div class="home-empty">No encontré productos con ese nombre.</div>'; return; }
            cont.innerHTML = res.map(r => `
                <div class="erp-card donde__prod">
                    <h3>${esc(r.nombre)}</h3>
                    ${r.bodegas.map(b => `
                        <div class="donde__bodega">
                            <div class="donde__bodega-top"><strong>${esc(b.bodega)}</strong><span>${b.cantidad}</span></div>
                            ${b.usaEstantes ? `<div class="donde__ubic">
                                ${b.ubicaciones.map(u => `<a class="bodega-estantes__chip" href="#u/${encodeURIComponent(b.bodegaId)}/${encodeURIComponent(u.codigo)}">${esc(u.codigo)} · ${u.cantidad}</a>`).join(' ')}
                                ${b.sinUbicar > 0 ? `<span class="acceso-bodega__sinubicar">${b.sinUbicar} sin ubicar</span>` : ''}
                            </div>` : '<div class="donde__ubic"><span class="acceso-bodega__sinubicar">Bodega sin estantes</span></div>'}
                        </div>`).join('')}
                </div>`).join('');
        }

        // Estado inicial (v21.75): búsquedas recientes, bodegas y productos críticos en vez de una pantalla vacía
        const LS_REC = 'sar_donde_recientes';
        const recientes = () => { try { return JSON.parse(localStorage.getItem(LS_REC) || '[]').slice(0, 6); } catch (e) { return []; } };
        function recordar(q) { try { const l = [q, ...recientes().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 6); localStorage.setItem(LS_REC, JSON.stringify(l)); } catch (e) { /* sin almacenamiento */ } }
        function buscarTexto(t) { const inp = document.getElementById('donde-buscar'); if (!inp) return; inp.value = t; inp.dispatchEvent(new Event('input')); inp.focus(); }
        async function inicio() {
            const cont = document.getElementById('donde-resultados'); if (!cont) return;
            const rec = recientes();
            cont.innerHTML = `<div class="donde__inicio">${rec.length ? `<section><h4 class="donde__sec">Búsquedas recientes</h4><div class="donde__chips">${rec.map(r => `<button type="button" class="donde__chip" data-q="${esc(r)}"><i class="ph-bold ph-clock-counter-clockwise" aria-hidden="true"></i>${esc(r)}</button>`).join('')}</div></section>` : ''}<div id="donde-ini-datos">${window.SAR_Progreso ? window.SAR_Progreso.cargando('Preparando atajos…') : ''}</div></div>`;
            const alClic = () => cont.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => buscarTexto(b.dataset.q)));
            alClic();
            try {
                const c = await cargar(); const host = document.getElementById('donde-ini-datos'); if (!host) return;
                const tot = new Map(); c.insumos.forEach(i => { const k = String(i.location || ''); if (k) tot.set(k, (tot.get(k) || 0) + (Number(i.quantity) || 0)); });
                const bods = c.bodegas.filter(b => b.name && b.isActive !== false).map(b => ({ b, n: tot.get(b.name) || 0 })).sort((x, y) => y.n - x.n);
                const crit = new Map(); c.insumos.forEach(i => { if (i.isCritical === true && i.name) { const m = crit.get(i.name) || { n: 0, loc: new Map(), cod: i.codigoMP }; m.n += Number(i.quantity) || 0; m.loc.set(String(i.location || ''), (m.loc.get(String(i.location || '')) || 0) + (Number(i.quantity) || 0)); crit.set(i.name, m); } });
                const filas = Array.from(crit.entries()).sort((a, b) => a[1].n - b[1].n).slice(0, 6);
                host.innerHTML = `${bods.length ? `<section><h4 class="donde__sec">Bodegas</h4><div class="donde__chips">${bods.map(x => `<a class="donde__chip" href="#b/${encodeURIComponent(x.b.id)}"><i class="ph-bold ph-buildings" aria-hidden="true"></i>${esc(x.b.name)} <b>${x.n}</b></a>`).join('')}</div></section>` : ''}${filas.length ? `<section><h4 class="donde__sec">Críticos ahora</h4><div class="donde__crit">${filas.map(([nombre, m]) => { const top = Array.from(m.loc.entries()).sort((a, b) => b[1] - a[1])[0]; return `<button type="button" class="donde__fila" data-q="${esc(nombre)}">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(nombre, { codigo: m.cod }) : ''}<span class="donde__fila-t"><b>${esc(nombre)}</b><small>${top && top[0] ? esc(top[0]) : 'Sin bodega'}</small></span><span class="donde__fila-n"><i class="donde__dot" aria-hidden="true"></i>${m.n} u. · Crítico</span></button>`; }).join('')}</div></section>` : '<p class="donde__nada">Sin productos críticos por ahora.</p>'}`;
                alClic();
            } catch (e) { const host = document.getElementById('donde-ini-datos'); if (host) host.innerHTML = '<p class="donde__nada">Escribe el nombre del producto para empezar.</p>'; }
        }

        async function abrir() {
            const inp = document.getElementById('donde-buscar'); if (!inp) return;
            if (!iniciado) {
                iniciado = true;
                let tmr = null;
                inp.addEventListener('input', () => {
                    clearTimeout(tmr);
                    tmr = setTimeout(async () => {
                        const q = inp.value.trim();
                        const cont = document.getElementById('donde-resultados');
                        if (q.length < 3) { inicio(); return; }
                        cont.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Buscando…') : '<div class="home-empty">Buscando…</div>';
                        try { const rs = resultados(q, await cargar()); pintar(rs); if (rs.length) recordar(q); }
                        catch (e) { cont.innerHTML = `<div class="home-empty">No se pudo buscar. Intenta de nuevo (ref. DE-01).</div>`; }
                    }, 250);
                });
            }
            cache = null; // al entrar a la vista se refresca la próxima búsqueda
            inp.focus();
            if (inp.value.trim().length < 3) inicio();
        }

        return { abrir, resultados };
    })();

    window.SAR_AccesoBodega = AccesoBodega;
    window.SAR_DondeEsta = DondeEsta;
    window.SAR_Estantes = { renderSeccion, planificarUbicaciones, planificarAmpliacion, agruparLotes, codigoUbicacion, prefijoValido, imprimirEtiquetas, sinUbicar, slug };
})(window, document);
