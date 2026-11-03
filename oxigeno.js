/* ==========================================================================
   OXÍGENO PORTÁTIL (v20.38)
   --------------------------------------------------------------------------
   Registro de balones de oxígeno portátiles (equipos médicos) con N° de serie:
   estado (lleno / vacío / en recarga / entregado a un centro / fuera de servicio),
   dónde está, historial de recargas, préstamos, devoluciones e incidencias, y acta
   de entrega (mismo formato y correlativo AE-AAAA-NNNN de las actas de insumos).

   Datos:  Equipos_Oxigeno/{serie}            el equipo y su estado actual
           Equipos_Oxigeno/{serie}/Eventos/*  bitácora INMUTABLE
   No se guardan datos de pacientes.
   ========================================================================== */
(function (window, document) {
    'use strict';

    const fs = () => window.firebaseFirestore;
    const db = () => window.firebaseDb;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
    const num = (v) => Number(v) || 0;
    const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const hoy = () => new Date().toISOString().slice(0, 10);
    const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };
    const CENTROS = ['CESFAM San Manuel', 'CESFAM Elgueta', 'UAPO', 'Antumalen', 'Posta Pahuilmo', 'Pomaire', 'CECOSF Obispo Lizama', 'Anexo Dental', 'Anides'];
    const SEDE = 'SAR';

    const ESTADOS = {
        LLENO: { txt: 'Lleno', color: '#15803d' },
        VACIO: { txt: 'Vacío', color: '#b45309' },
        EN_RECARGA: { txt: 'En recarga', color: '#1d4ed8' },
        PRESTADO: { txt: 'Entregado a centro', color: '#7c3aed' },
        FUERA_SERVICIO: { txt: 'Fuera de servicio', color: '#b91c1c' }
    };
    /** Acciones: a qué estado pasan y si piden destino/proveedor. */
    const ACCIONES = {
        ENVIO_RECARGA: { txt: 'Enviado a recarga', estado: 'EN_RECARGA', desde: ['VACIO', 'LLENO'], pide: 'proveedor' },
        RECARGA_OK: { txt: 'Recarga recibida (lleno)', estado: 'LLENO', desde: ['EN_RECARGA', 'VACIO'], pide: 'proveedor', recarga: true },
        MARCAR_VACIO: { txt: 'Marcar como vacío (se usó)', estado: 'VACIO', desde: ['LLENO', 'PRESTADO'] },
        DEVOLUCION: { txt: 'Devuelto al SAR', estado: null, desde: ['PRESTADO'], pide: 'estadoDevuelto' },
        INCIDENCIA: { txt: 'Registrar incidencia (sin cambiar estado)', estado: null, desde: null, nota: true },
        FUERA_SERVICIO: { txt: 'Fuera de servicio', estado: 'FUERA_SERVICIO', desde: null, nota: true },
        REPUESTO: { txt: 'Volver a servicio (vacío)', estado: 'VACIO', desde: ['FUERA_SERVICIO'] }
    };

    // ---------------------------------------------------------------
    // Lógica pura
    // ---------------------------------------------------------------
    function resumen(equipos) {
        const r = { total: equipos.length, LLENO: 0, VACIO: 0, EN_RECARGA: 0, PRESTADO: 0, FUERA_SERVICIO: 0 };
        equipos.forEach(e => { if (r[e.estado] != null) r[e.estado]++; });
        return r;
    }
    function accionesPara(estado) {
        return Object.entries(ACCIONES).filter(([, a]) => !a.desde || a.desde.includes(estado)).map(([k, a]) => ({ k, txt: a.txt }));
    }
    /** Resultado de aplicar una acción: {estado, ubicacion, ...campos}. Lanza si no es válida. */
    function aplicarAccion(equipo, clave, datos) {
        const a = ACCIONES[clave];
        if (!a) throw new Error('Acción desconocida.');
        if (a.desde && !a.desde.includes(equipo.estado)) throw new Error(`No se puede "${a.txt}" un equipo ${ESTADOS[equipo.estado] ? ESTADOS[equipo.estado].txt.toLowerCase() : equipo.estado}.`);
        if (a.nota && !String(datos.detalle || '').trim()) throw new Error('Escribe qué pasó.');
        if (a.pide === 'estadoDevuelto' && !['LLENO', 'VACIO'].includes(datos.estadoDevuelto)) throw new Error('Indica si vuelve lleno o vacío.');
        const cambios = {};
        if (clave === 'DEVOLUCION') { cambios.estado = datos.estadoDevuelto; cambios.ubicacion = SEDE; cambios.prestadoA = ''; }
        else if (a.estado) cambios.estado = a.estado;
        if (clave === 'ENVIO_RECARGA') { cambios.ubicacion = (datos.proveedor || 'Proveedor').trim() || 'Proveedor'; cambios.prestadoA = ''; }
        if (clave === 'RECARGA_OK') { cambios.ubicacion = SEDE; cambios.ultimaRecarga = datos.fecha || hoy(); cambios.recargas = num(equipo.recargas) + 1; }
        if (clave === 'REPUESTO') cambios.ubicacion = SEDE;
        return cambios;
    }
    function parsearSeries(texto) {
        const vistos = new Set(), out = [];
        String(texto || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).forEach(s => { const id = slug(s); if (id && !vistos.has(id)) { vistos.add(id); out.push({ id, serie: s }); } });
        return out;
    }
    const nombreEnActa = (e) => `BALÓN DE OXÍGENO PORTÁTIL ${String(e.capacidad || '1 m³').toUpperCase()} — N° DE SERIE ${e.serie}`;
    function validarEntrega(centro, equipos) {
        const err = [];
        if (!String(centro || '').trim()) err.push('Indica a qué centro se entrega.');
        if (!equipos.length) err.push('Selecciona al menos un balón.');
        equipos.forEach(e => { if (e.estado !== 'LLENO') err.push(`El balón ${e.serie} no está lleno (${(ESTADOS[e.estado] || {}).txt || e.estado}).`); });
        return err;
    }

    // ---------------------------------------------------------------
    // Estado y datos
    // ---------------------------------------------------------------
    let equipos = [], filtro = 'TODOS', busca = '', sel = new Set(), eventosAbiertos = {};
    let firma = { nombre: 'Matias Bustos Huerta', cargo: 'Encargado de insumos' };

    async function cargar() {
        const f = fs();
        const snap = await f.getDocs(f.collection(db(), 'Equipos_Oxigeno'));
        equipos = []; snap.forEach(d => equipos.push({ id: d.id, ...d.data() }));
        equipos.sort((a, b) => String(a.serie).localeCompare(String(b.serie), 'es', { numeric: true }));
        sel = new Set([...sel].filter(id => equipos.some(e => e.id === id && e.estado === 'LLENO')));
    }

    async function crearEquipos(series, base) {
        const f = fs(), creados = [], existentes = [];
        for (const s of series) {
            const ref = f.doc(f.collection(db(), 'Equipos_Oxigeno'), s.id);
            const evRef = f.doc(f.collection(db(), 'Equipos_Oxigeno', s.id, 'Eventos'));
            await f.runTransaction(db(), async (tx) => {
                const ex = await tx.get(ref);
                if (ex.exists()) { existentes.push(s.serie); return; }
                tx.set(ref, { serie: s.serie, tipo: 'Oxígeno portátil', capacidad: base.capacidad, estado: base.estado, ubicacion: SEDE, prestadoA: '', recargas: 0, ultimaRecarga: '', observacion: base.observacion || '', creadoPor: usuario(), creadoEn: f.serverTimestamp() });
                tx.set(evRef, { tipo: 'ALTA', fecha: hoy(), detalle: base.observacion || 'Alta del equipo', estadoNuevo: base.estado, usuario: usuario(), creadoEn: f.serverTimestamp() });
                creados.push(s.serie);
            });
        }
        return { creados, existentes };
    }

    async function registrarAccion(equipoId, clave, datos) {
        const f = fs();
        const ref = f.doc(f.collection(db(), 'Equipos_Oxigeno'), equipoId);
        const evRef = f.doc(f.collection(db(), 'Equipos_Oxigeno', equipoId, 'Eventos'));
        return f.runTransaction(db(), async (tx) => {
            const s = await tx.get(ref);
            if (!s.exists()) throw new Error('El equipo ya no existe.');
            const e = s.data();
            const cambios = aplicarAccion(e, clave, datos);
            if (Object.keys(cambios).length) tx.update(ref, { ...cambios, updatedAt: f.serverTimestamp() });
            tx.set(evRef, {
                tipo: clave, fecha: datos.fecha || hoy(), detalle: String(datos.detalle || '').trim(), proveedor: String(datos.proveedor || '').trim(), documento: String(datos.documento || '').trim(),
                estadoAnterior: e.estado, estadoNuevo: cambios.estado || e.estado, ubicacion: cambios.ubicacion || e.ubicacion || '', usuario: usuario(), creadoEn: f.serverTimestamp()
            });
            return cambios;
        });
    }

    /** Acta de entrega de balones: correlativo + acta + estado de cada equipo, en una transacción. */
    async function entregar(centro, lista, firmaEntrega, recibe, documentos) {
        const f = fs();
        const anio = new Date().getFullYear();
        const ctrRef = f.doc(f.collection(db(), 'Contadores'), `acta-${anio}`);
        const refs = lista.map(e => ({ e, ref: f.doc(f.collection(db(), 'Equipos_Oxigeno'), e.id), ev: f.doc(f.collection(db(), 'Equipos_Oxigeno', e.id, 'Eventos')) }));
        return f.runTransaction(db(), async (tx) => {
            const cs = await tx.get(ctrRef);
            const n = (cs.exists() ? num(cs.data().ultimo) : 0) + 1;
            const numero = `AE-${anio}-${String(n).padStart(4, '0')}`;
            const snaps = []; for (const r of refs) snaps.push(await tx.get(r.ref));
            snaps.forEach((s, k) => { if (!s.exists()) throw new Error(`El balón ${refs[k].e.serie} ya no existe.`); if (s.data().estado !== 'LLENO') throw new Error(`El balón ${refs[k].e.serie} ya no está lleno.`); });
            refs.forEach((r) => {
                tx.update(r.ref, { estado: 'PRESTADO', ubicacion: centro, prestadoA: centro, ultimaEntregaActa: numero, updatedAt: f.serverTimestamp() });
                tx.set(r.ev, { tipo: 'ENTREGA_ACTA', fecha: hoy(), detalle: `Entregado a ${centro} (acta ${numero})`, estadoAnterior: 'LLENO', estadoNuevo: 'PRESTADO', ubicacion: centro, documento: numero, usuario: usuario(), creadoEn: f.serverTimestamp() });
            });
            tx.set(ctrRef, { ultimo: n, anio, updatedAt: f.serverTimestamp() });
            const acta = {
                numero, fecha: hoy(), centro, tipo: 'OXIGENO', bodegaOrigen: SEDE, estado: 'EMITIDA', stockDescontado: false,
                items: refs.map(r => ({ id: r.e.id, nombre: nombreEnActa(r.e), cantidad: 1, serie: r.e.serie })), pendientes: [],
                documentos: documentos || [], entrega: firmaEntrega, recibe: recibe || { nombre: '', cargo: '' }, creadoPor: usuario(), creadoEn: f.serverTimestamp()
            };
            tx.set(f.doc(f.collection(db(), 'Actas_Entrega'), numero), acta);
            return { ...acta, creadoEn: new Date().toISOString() };
        });
    }

    // ---------------------------------------------------------------
    // Interfaz
    // ---------------------------------------------------------------
    const root = () => document.getElementById('oxi-root');
    function filtrados() {
        const q = busca.trim().toLowerCase();
        return equipos.filter(e => (filtro === 'TODOS' || e.estado === filtro) && (!q || `${e.serie} ${e.ubicacion} ${e.prestadoA}`.toLowerCase().includes(q)));
    }
    function pintar() {
        const r = root(); if (!r) return;
        const rs = resumen(equipos), lista = filtrados();
        const chip = (k, t, n, c) => `<button type="button" class="oxi-card${filtro === k ? ' oxi-on' : ''}" data-f="${k}" style="--c:${c}"><b>${n}</b><span>${t}</span></button>`;
        r.innerHTML = `
        <div class="page-header mb-24"><div class="page-title"><h2>Oxígeno portátil</h2><p>Balones con N° de serie: estado, recargas, entregas a centros e incidencias.</p></div></div>
        <div class="oxi-cards">${chip('TODOS', 'Total', rs.total, '#334155')}${Object.entries(ESTADOS).map(([k, v]) => chip(k, v.txt, rs[k], v.color)).join('')}</div>
        <div class="oxi-barra"><input id="oxi-buscar" type="search" placeholder="Buscar serie, lugar o centro…" value="${esc(busca)}" autocomplete="off">
            <button type="button" class="btn btn-outline" id="oxi-alta">+ Agregar balones</button>
            <button type="button" class="btn btn-primary" id="oxi-entrega"${sel.size ? '' : ' disabled'}>Acta de entrega (${sel.size})</button></div>
        <div class="oxi-lista">${lista.length ? lista.map(e => {
            const st = ESTADOS[e.estado] || { txt: e.estado, color: '#64748b' };
            return `<div class="oxi-fila"><div class="oxi-chk">${e.estado === 'LLENO' ? `<input type="checkbox" class="oxi-sel" data-id="${esc(e.id)}"${sel.has(e.id) ? ' checked' : ''} aria-label="Seleccionar ${esc(e.serie)}">` : ''}</div>
              <div class="oxi-info"><strong>N° ${esc(e.serie)}</strong> <small>${esc(e.capacidad || '')}</small>
                <span class="oxi-est" style="background:${st.color}">${esc(st.txt)}</span>
                <small>${esc(e.ubicacion || '')}${e.estado === 'PRESTADO' && e.ultimaEntregaActa ? ' · acta ' + esc(e.ultimaEntregaActa) : ''} · ${num(e.recargas)} recarga(s)${e.ultimaRecarga ? ' · última ' + esc(e.ultimaRecarga) : ''}</small></div>
              <select class="oxi-acc" data-id="${esc(e.id)}"><option value="">Acción…</option>${accionesPara(e.estado).map(a => `<option value="${a.k}">${esc(a.txt)}</option>`).join('')}</select>
              <button type="button" class="btn btn-outline oxi-hist" data-id="${esc(e.id)}">Historial</button></div>
              <div class="oxi-ev" id="oxi-ev-${esc(e.id)}"${eventosAbiertos[e.id] ? '' : ' style="display:none"'}>${eventosAbiertos[e.id] ? eventosHTML(eventosAbiertos[e.id]) : ''}</div>`;
        }).join('') : '<p class="act-hint">Sin equipos con ese filtro. Usa "+ Agregar balones".</p>'}</div>`;
        enlazar();
    }
    function eventosHTML(evs) {
        if (!evs.length) return '<p class="act-hint">Sin movimientos.</p>';
        return '<ul>' + evs.map(v => `<li><b>${esc(v.fecha)}</b> · ${esc((ACCIONES[v.tipo] || { txt: v.tipo === 'ALTA' ? 'Alta' : v.tipo === 'ENTREGA_ACTA' ? 'Entrega con acta' : v.tipo }).txt)}${v.detalle ? ' — ' + esc(v.detalle) : ''}${v.proveedor ? ' · ' + esc(v.proveedor) : ''}${v.documento ? ' · doc ' + esc(v.documento) : ''} <small>(${esc(v.usuario)})</small></li>`).join('') + '</ul>';
    }
    function modal(titulo, html, alAceptar, textoOk) {
        const ov = document.createElement('div'); ov.className = 'cierre-overlay';
        ov.innerHTML = `<div class="cierre-box" role="dialog" aria-modal="true"><h3>${esc(titulo)}</h3>${html}<p class="cierre-error" id="oxi-m-err"></p>
            <div class="cierre-acciones"><button type="button" class="btn btn-outline" id="oxi-m-no">Cancelar</button><button type="button" class="btn btn-primary" id="oxi-m-ok">${esc(textoOk || 'Guardar')}</button></div></div>`;
        document.body.appendChild(ov);
        const q = (s) => ov.querySelector(s);
        q('#oxi-m-no').addEventListener('click', () => ov.remove());
        q('#oxi-m-ok').addEventListener('click', async () => {
            const b = q('#oxi-m-ok'); b.disabled = true; q('#oxi-m-err').textContent = '';
            try { await alAceptar(q); ov.remove(); } catch (e) { q('#oxi-m-err').textContent = e.message || String(e); b.disabled = false; }
        });
        return ov;
    }

    function enlazar() {
        const r = root(), $$ = (s) => r.querySelectorAll(s);
        $$('.oxi-card').forEach(b => b.addEventListener('click', () => { filtro = b.dataset.f; pintar(); }));
        r.querySelector('#oxi-buscar').addEventListener('input', (e) => { busca = e.target.value; const p = e.target.selectionStart; pintar(); const n = document.getElementById('oxi-buscar'); n.focus(); n.setSelectionRange(p, p); });
        $$('.oxi-sel').forEach(c => c.addEventListener('change', () => { c.checked ? sel.add(c.dataset.id) : sel.delete(c.dataset.id); pintar(); }));
        $$('.oxi-hist').forEach(b => b.addEventListener('click', async () => {
            const id = b.dataset.id;
            if (eventosAbiertos[id]) { delete eventosAbiertos[id]; pintar(); return; }
            const f = fs();
            try {
                const snap = await f.getDocs(f.query(f.collection(db(), 'Equipos_Oxigeno', id, 'Eventos'), f.orderBy('creadoEn', 'desc'), f.limit(60)));
                const evs = []; snap.forEach(d => evs.push(d.data()));
                eventosAbiertos[id] = evs; pintar();
            } catch (e) { toast('Error', 'No se pudo leer el historial: ' + e.message, 'error'); }
        }));
        $$('.oxi-acc').forEach(s => s.addEventListener('change', () => { if (s.value) dialogoAccion(s.dataset.id, s.value); else return; s.value = ''; }));
        r.querySelector('#oxi-alta').addEventListener('click', dialogoAlta);
        r.querySelector('#oxi-entrega').addEventListener('click', dialogoEntrega);
    }

    function dialogoAlta() {
        modal('Agregar balones portátiles', `
            <label class="act-l">N° de serie (uno por línea o separados por coma)<textarea id="oxi-series" rows="4" style="width:100%" placeholder="Ej: 12345&#10;12346"></textarea></label>
            <label class="act-l">Capacidad<input id="oxi-cap" value="1 m³"></label>
            <label class="act-l">Estado actual<select id="oxi-est"><option value="LLENO">Lleno</option><option value="VACIO">Vacío</option></select></label>
            <label class="act-l">Observación (opcional)<input id="oxi-obs"></label>`, async (q) => {
            const series = parsearSeries(q('#oxi-series').value);
            if (!series.length) throw new Error('Escribe al menos un N° de serie.');
            const res = await crearEquipos(series, { capacidad: q('#oxi-cap').value.trim() || '1 m³', estado: q('#oxi-est').value, observacion: q('#oxi-obs').value.trim() });
            toast('Balones', `${res.creados.length} agregado(s)${res.existentes.length ? '; ya existían: ' + res.existentes.join(', ') : ''}.`, res.existentes.length ? 'warning' : 'success');
            await cargar(); pintar();
        });
    }
    function dialogoAccion(id, clave) {
        const e = equipos.find(x => x.id === id), a = ACCIONES[clave]; if (!e) return;
        modal(`${a.txt} · N° ${e.serie}`, `
            <label class="act-l">Fecha<input id="oxi-f" type="date" value="${hoy()}"></label>
            ${a.pide === 'proveedor' ? '<label class="act-l">Proveedor / lugar de recarga<input id="oxi-p" placeholder="Ej: proveedor, centro de recarga"></label><label class="act-l">N° guía / factura (opcional)<input id="oxi-d"></label>' : ''}
            ${a.pide === 'estadoDevuelto' ? `<label class="act-l">Vuelve<select id="oxi-dev"><option value="VACIO">Vacío</option><option value="LLENO">Lleno</option></select></label>` : ''}
            <label class="act-l">${a.nota ? 'Qué pasó (obligatorio)' : 'Detalle (opcional)'}<input id="oxi-t"></label>`, async (q) => {
            const g = (s) => { const n = q(s); return n ? n.value : ''; };
            await registrarAccion(id, clave, { fecha: g('#oxi-f'), proveedor: g('#oxi-p'), documento: g('#oxi-d'), estadoDevuelto: g('#oxi-dev'), detalle: g('#oxi-t') });
            toast('Registrado', `${a.txt}: N° ${e.serie}.`, 'success'); delete eventosAbiertos[id]; await cargar(); pintar();
        });
    }
    function dialogoEntrega() {
        const lista = equipos.filter(e => sel.has(e.id));
        modal('Acta de entrega de oxígeno', `
            <p class="cierre-hint">${lista.map(e => 'N° ' + esc(e.serie)).join(' · ')}</p>
            <label class="act-l">Centro al que se entrega<input id="oxi-c" list="oxi-cl" placeholder="Ej: Pomaire"><datalist id="oxi-cl">${CENTROS.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
            <label class="act-l">Documento asociado (opcional, ej. SDC)<input id="oxi-doc" placeholder="Ej: SDC N° 123"></label>
            <label class="act-l">Entrega<input id="oxi-en" value="${esc(firma.nombre)}"></label><label class="act-l">Cargo<input id="oxi-ec" value="${esc(firma.cargo)}"></label>
            <label class="act-l">Recibe (opcional)<input id="oxi-rn"></label><label class="act-l">Cargo de quien recibe (opcional)<input id="oxi-rc"></label>`, async (q) => {
            const centro = q('#oxi-c').value.trim();
            const err = validarEntrega(centro, lista); if (err.length) throw new Error(err[0]);
            firma = { nombre: q('#oxi-en').value.trim(), cargo: q('#oxi-ec').value.trim() };
            const docTxt = q('#oxi-doc').value.trim();
            const acta = await entregar(centro, lista, firma, { nombre: q('#oxi-rn').value.trim(), cargo: q('#oxi-rc').value.trim() }, docTxt ? [{ tipo: 'Documento', numero: docTxt, detalle: '' }] : []);
            toast('Acta emitida', `${acta.numero} · ${lista.length} balón(es) a ${centro}.`, 'success');
            sel.clear(); await cargar(); pintar();
            const A = window.SAR_ActasEntrega;
            if (A && A.descargarActa) { try { await A.descargarActa(acta, 'pdf'); } catch (e) { toast('Descarga', 'El acta se emitió; bájala desde Actas de entrega. ' + e.message, 'warning'); } }
        }, 'Emitir acta');
    }

    async function abrir() {
        const r = root(); if (!r) return;
        r.innerHTML = '<p class="act-hint" style="padding:24px;">Cargando…</p>';
        try { await cargar(); } catch (e) { r.innerHTML = `<p class="act-err" style="padding:24px;">No se pudo cargar: ${esc(e.message)}</p>`; return; }
        pintar();
    }

    window.SAR_Oxigeno = { abrir, resumen, accionesPara, aplicarAccion, parsearSeries, validarEntrega, nombreEnActa, registrarAccion, crearEquipos, entregar, ESTADOS, ACCIONES };
    if (typeof module !== 'undefined') module.exports = window.SAR_Oxigeno;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: { dataset: {} } });
