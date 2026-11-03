/* ==========================================================================
   SEGUIMIENTO DE ÓRDENES DE COMPRA (v20.36)
   --------------------------------------------------------------------------
   Para órdenes de compra de Mercado Público que reúnen varios memos / CDP de
   distintos centros (ej. 1298355-840-AG26): se ingresa la OC con su cuadro de
   distribución, se registran las recepciones, se ven las discrepancias (pedido vs
   recibido y plazo vencido), se dejan notas y, cada vez que se registra una
   notificación, se envía un correo a la lista de destinatarios.

   Datos (no se guardan datos de pacientes):
   - Seguimiento_OC/{id}              la OC, sus columnas (memo/CDP por centro), líneas y recibido.
   - Seguimiento_OC/{id}/Eventos/*    bitácora INMUTABLE (notas, recepciones, multa, correos).
   - Config_Correo/principal          URL + token del envío de correo y destinatarios base.
   Envío de correo: Google Apps Script propio (sin plan Blaze); si no está configurado,
   se abre un borrador en el correo del usuario.
   ========================================================================== */
(function (window, document) {
    'use strict';

    const fs = () => window.firebaseFirestore;
    const db = () => window.firebaseDb;
    const esc = (s) => (window.escapeHTML ? window.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const rol = () => String(document.body.dataset.userRole || '').toLowerCase();
    const esAdmin = () => ['admin', 'administrador', 'global', 'superadmin'].includes(rol());
    const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
    const num = (v) => Number(v) || 0;
    const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const peso = (n) => '$' + Math.round(num(n)).toLocaleString('es-CL');
    const CENTRO_PROPIO = 'SAR';

    // ---------------------------------------------------------------
    // Días hábiles (lunes a viernes sin feriados). Feriados de Chile 2026 verificados;
    // los de otros años se agregan en Configuración de correo/feriados (feriadosExtra).
    // ---------------------------------------------------------------
    const FERIADOS_BASE = ['2026-01-01', '2026-04-03', '2026-04-04', '2026-05-01', '2026-05-21', '2026-06-20', '2026-06-29', '2026-07-16',
        '2026-08-15', '2026-09-18', '2026-09-19', '2026-10-12', '2026-10-31', '2026-11-01', '2026-12-08', '2026-12-25'];
    let feriados = new Set(FERIADOS_BASE);
    function setFeriadosExtra(lista) { feriados = new Set([...FERIADOS_BASE, ...(Array.isArray(lista) ? lista : [])]); }
    const pad = (n) => String(n).padStart(2, '0');
    const aISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const deISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 12); };
    const hoyISO = () => aISO(new Date());
    function esHabil(d) { const w = d.getDay(); return w !== 0 && w !== 6 && !feriados.has(aISO(d)); }
    /** Fecha en que vence un plazo de `n` días hábiles contados desde el día siguiente a `desdeISO`. */
    function sumarHabiles(desdeISO, n) {
        const d = deISO(desdeISO); let c = 0;
        while (c < n) { d.setDate(d.getDate() + 1); if (esHabil(d)) c++; }
        return aISO(d);
    }
    /** Días hábiles en el tramo (desde, hasta]. Negativo si hasta < desde. */
    function habilesEntre(desdeISO, hastaISO) {
        if (hastaISO === desdeISO) return 0;
        const sg = hastaISO > desdeISO ? 1 : -1;
        let a = deISO(desdeISO), b = deISO(hastaISO), c = 0;
        if (sg < 0) [a, b] = [b, a];
        while (a < b) { a.setDate(a.getDate() + 1); if (esHabil(a)) c++; }
        return sg * c;
    }

    // ---------------------------------------------------------------
    // Cálculos de la OC (puros)
    // ---------------------------------------------------------------
    function centrosDe(oc) {
        const m = {};
        (oc.columnas || []).forEach(c => { (m[c.centro] = m[c.centro] || { centro: c.centro, columnas: [] }).columnas.push(c); });
        return Object.values(m);
    }
    function totalesPorCentro(oc) {
        return centrosDe(oc).map(ce => {
            let pedido = 0, recibido = 0, netoPend = 0, netoTotal = 0;
            (oc.lineas || []).forEach(l => ce.columnas.forEach(c => {
                const p = num(l.dist && l.dist[c.key]), r = num(l.recibido && l.recibido[c.key]);
                pedido += p; recibido += r; netoTotal += p * num(l.valorNeto); netoPend += Math.max(0, p - r) * num(l.valorNeto);
            }));
            return { centro: ce.centro, pedido, recibido, pendiente: Math.max(0, pedido - recibido), netoPend, netoTotal, completo: pedido > 0 && recibido >= pedido };
        });
    }
    function estadoLinea(pedido, recibido) {
        if (pedido <= 0 && recibido <= 0) return 'sin';
        if (recibido <= 0) return 'pendiente';
        if (recibido > pedido) return 'exceso';
        return recibido === pedido ? 'completo' : 'parcial';
    }
    /** Estado del plazo respecto de hoy. */
    function estadoPlazo(oc, hoy) {
        hoy = hoy || hoyISO();
        const limite = oc.fechaLimite || sumarHabiles(oc.aceptada, num(oc.plazoDiasHabiles) || 5);
        const tot = totalesPorCentro(oc);
        const pendiente = tot.some(t => t.pendiente > 0);
        if (oc.cerrada) return { codigo: 'CERRADA', limite, texto: 'Seguimiento cerrado', atraso: 0 };
        if (!pendiente && tot.length) return { codigo: 'COMPLETA', limite, texto: 'Recibida completa', atraso: 0 };
        if (hoy > limite) { const a = habilesEntre(limite, hoy); return { codigo: 'ATRASADA', limite, atraso: a, texto: `Atrasada ${a} día${a === 1 ? '' : 's'} hábil${a === 1 ? '' : 'es'}` }; }
        const r = habilesEntre(hoy, limite);
        return { codigo: 'EN_PLAZO', limite, restan: r, texto: r === 0 ? 'Vence hoy' : `Vence en ${r} día${r === 1 ? '' : 's'} hábil${r === 1 ? '' : 'es'}` };
    }
    /** Lista de discrepancias a revisar (nivel: alto / medio / info). */
    function discrepancias(oc, hoy) {
        const out = [], pl = estadoPlazo(oc, hoy), tot = totalesPorCentro(oc);
        if (pl.codigo === 'ATRASADA') {
            const pend = tot.filter(t => t.pendiente > 0);
            out.push({ nivel: 'alto', texto: `Plazo vencido el ${fmtFecha(pl.limite)}: ${pl.texto}. Sin recibir completo: ${pend.map(t => `${t.centro} (${t.pendiente} un.)`).join(', ')}.` });
        }
        (oc.lineas || []).forEach(l => (oc.columnas || []).forEach(c => {
            const p = num(l.dist && l.dist[c.key]), r = num(l.recibido && l.recibido[c.key]);
            const e = estadoLinea(p, r);
            if (e === 'exceso') out.push({ nivel: 'alto', texto: `Llegó de más — ${c.centro}: ${l.descripcion} (pedido ${p}, recibido ${r}).` });
            else if (e === 'parcial') out.push({ nivel: 'medio', texto: `Recepción parcial — ${c.centro}: ${l.descripcion} (${r} de ${p}).` });
        }));
        (oc.lineas || []).forEach(l => {
            if (l.totalDeclarado != null) {
                const s = (oc.columnas || []).reduce((t, c) => t + num(l.dist && l.dist[c.key]), 0);
                if (s !== num(l.totalDeclarado)) out.push({ nivel: 'medio', texto: `El cuadro no cuadra — ${l.descripcion}: suma por centro ${s}, total declarado ${l.totalDeclarado}.` });
            }
        });
        return out;
    }

    // ---------------------------------------------------------------
    // Lectura del "Cuadro de distribución" (filas de la hoja ya convertidas a arreglos)
    // ---------------------------------------------------------------
    function parsearCuadro(filas) {
        if (!Array.isArray(filas) || filas.length < 3) throw new Error('El archivo no tiene el formato del cuadro de distribución.');
        const cab = filas[0] || [];
        const columnas = [];
        for (let i = 2; i < cab.length; i++) {
            const t = cab[i]; if (!t) continue;
            const m = String(t).replace(/\s+/g, ' ').match(/MEMO\s*N[°º]?\s*(\d+)\s+(.*?)\s+CDP\s*N[°º]?\s*(\d+)/i);
            if (!m) continue;
            columnas.push({ idx: i, memo: m[1], centro: m[2].trim().toUpperCase(), cdp: m[3], key: `${slug(m[2])}-${m[3]}` });
        }
        if (!columnas.length) throw new Error('No encontré las columnas "MEMO N° … CDP N° …" en la primera fila.');
        const idxTotal = (filas[1] || []).findIndex(x => /cantidad\s+total/i.test(String(x || '')));
        const lineas = [];
        for (let r = 2; r < filas.length; r++) {
            const f = filas[r] || [];
            if (!f[0] || typeof f[1] !== 'number') { if (lineas.length) break; else continue; }
            const dist = {};
            columnas.forEach(c => { const v = num(f[c.idx]); if (v > 0) dist[c.key] = v; });
            lineas.push({ descripcion: String(f[0]).replace(/\s+/g, ' ').trim(), valorNeto: f[1], dist, recibido: {}, totalDeclarado: idxTotal >= 0 && f[idxTotal] != null ? num(f[idxTotal]) : null });
        }
        if (!lineas.length) throw new Error('No encontré líneas de productos en el cuadro.');
        return { columnas: columnas.map(({ idx, ...c }) => c), lineas };
    }

    // ---------------------------------------------------------------
    // Correo
    // ---------------------------------------------------------------
    function fmtFecha(iso) { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}-${m}-${y}`; }
    function fmtFechaHora(ts) {
        try { const d = ts && ts.toDate ? ts.toDate() : new Date(ts); if (isNaN(d)) return ''; return d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
    }
    function resumenTexto(oc, hoy) {
        const pl = estadoPlazo(oc, hoy), tot = totalesPorCentro(oc);
        return [`OC ${oc.numeroOC}${oc.proveedor ? ' — ' + oc.proveedor : ''}`,
            `Aceptada el ${fmtFecha(oc.aceptada)} · plazo ${num(oc.plazoDiasHabiles) || 5} días hábiles · vence el ${fmtFecha(pl.limite)} · ${pl.texto}.`,
            ...tot.map(t => `- ${t.centro}: recibido ${t.recibido} de ${t.pedido} unidades${t.pendiente ? ` (pendiente ${t.pendiente})` : ' (completo)'}`)].join('\n');
    }
    function armarCorreo(oc, titulo, texto, autor, hoy) {
        const cuerpo = `${texto}\n\n— Estado de la orden —\n${resumenTexto(oc, hoy)}\n\nEnviado desde el sistema de inventario SAR Melipilla por ${autor}.`;
        return { subject: `OC ${oc.numeroOC} · ${titulo}`, text: cuerpo, html: '<div style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">' + esc(cuerpo) + '</div>' };
    }
    const emailValido = (e) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(e || '').trim());

    let configCorreo = { webhookUrl: '', token: '', destinatariosBase: [], feriadosExtra: [] };
    async function cargarConfig() {
        try {
            const s = await fs().getDoc(fs().doc(fs().collection(db(), 'Config_Correo'), 'principal'));
            if (s.exists()) { configCorreo = { ...configCorreo, ...s.data() }; setFeriadosExtra(configCorreo.feriadosExtra); }
        } catch (e) { /* sin permiso o sin configurar: se usa borrador */ }
        return configCorreo;
    }
    /** Envía el correo por el Apps Script; si no está configurado, abre un borrador. Nunca lanza. */
    async function enviarCorreo(destinatarios, correo) {
        const to = (destinatarios || []).filter(emailValido);
        if (!to.length) return { estado: 'sin_destinatarios', destinatarios: [] };
        if (!configCorreo.webhookUrl || !configCorreo.token) {
            try { window.open(`mailto:${encodeURIComponent(to.join(','))}?subject=${encodeURIComponent(correo.subject)}&body=${encodeURIComponent(correo.text)}`, '_blank'); } catch (e) { /* bloqueado */ }
            return { estado: 'borrador', destinatarios: to };
        }
        try {
            const r = await fetch(configCorreo.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ token: configCorreo.token, to, subject: correo.subject, text: correo.text, html: correo.html }) });
            const j = await r.json();
            return j && j.ok ? { estado: 'enviado', destinatarios: to } : { estado: 'error', destinatarios: to, detalle: String((j && j.error) || 'respuesta no válida') };
        } catch (e) { return { estado: 'error', destinatarios: to, detalle: String((e && e.message) || e) }; }
    }

    // ---------------------------------------------------------------
    // Interfaz
    // ---------------------------------------------------------------
    let lista = [], unsubLista = null, unsubEventos = null, ocActual = null, eventos = [];
    const root = () => document.getElementById('soc-root');
    const usuario = () => (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || 'Usuario';
    const ETIQ = { EN_PLAZO: 'En plazo', ATRASADA: 'Atrasada', COMPLETA: 'Completa', CERRADA: 'Cerrada' };

    async function abrir() {
        if (!root()) return;
        await cargarConfig();
        if (unsubLista) { try { unsubLista(); } catch (e) { /* noop */ } }
        root().innerHTML = '<div class="home-empty">Cargando órdenes…</div>';
        unsubLista = fs().onSnapshot(fs().collection(db(), 'Seguimiento_OC'), (snap) => {
            lista = []; snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
            lista.sort((a, b) => String(b.aceptada || '').localeCompare(String(a.aceptada || '')));
            if (!ocActual) pintarLista();
            else { const nueva = lista.find(x => x.id === ocActual.id); if (nueva) { ocActual = nueva; pintarDetalle(); } }
        }, (e) => { root().innerHTML = `<div class="home-empty">No se pudo leer el seguimiento: ${esc(e.code || e.message)}</div>`; });
    }

    function chip(pl) { return `<span class="soc-chip soc-chip--${pl.codigo.toLowerCase()}">${esc(pl.texto)}</span>`; }

    function pintarLista() {
        ocActual = null; if (unsubEventos) { try { unsubEventos(); } catch (e) { /* noop */ } unsubEventos = null; }
        root().innerHTML = `
            <div class="page-header mb-24"><div class="page-title"><h1>Seguimiento de órdenes de compra</h1>
                <p>Plazos, recepciones por centro, discrepancias, notas y avisos por correo.</p></div>
                <button type="button" class="btn btn-primary" id="soc-nueva"><i class="ph-bold ph-plus"></i> Ingresar orden</button></div>
            <div class="soc-lista">${lista.length ? lista.map(oc => {
                const pl = estadoPlazo(oc), tot = totalesPorCentro(oc), mio = tot.find(t => t.centro === CENTRO_PROPIO) || tot[0];
                const pct = mio && mio.pedido ? Math.min(100, Math.round(mio.recibido * 100 / mio.pedido)) : 0;
                return `<button type="button" class="erp-card soc-card" data-oc="${esc(oc.id)}">
                    <div class="soc-card__top"><strong>${esc(oc.numeroOC)}</strong>${chip(pl)}</div>
                    <div class="soc-card__sub">${esc(oc.proveedor || 'Proveedor sin indicar')} · vence ${fmtFecha(pl.limite)}</div>
                    ${mio ? `<div class="soc-barra" title="${esc(mio.centro)}"><span style="width:${pct}%"></span></div><small>${esc(mio.centro)}: ${mio.recibido} de ${mio.pedido} unidades recibidas</small>` : ''}
                </button>`; }).join('') : '<div class="home-empty">Aún no hay órdenes en seguimiento. Usa "Ingresar orden".</div>'}</div>`;
        root().querySelector('#soc-nueva').addEventListener('click', formNueva);
        root().querySelectorAll('[data-oc]').forEach(b => b.addEventListener('click', () => abrirDetalle(b.dataset.oc)));
    }

    function abrirDetalle(id) {
        ocActual = lista.find(x => x.id === id); if (!ocActual) return;
        if (unsubEventos) { try { unsubEventos(); } catch (e) { /* noop */ } }
        eventos = [];
        unsubEventos = fs().onSnapshot(fs().query(fs().collection(db(), 'Seguimiento_OC', id, 'Eventos'), fs().orderBy('fecha', 'desc'), fs().limit(100)), (snap) => {
            eventos = []; snap.forEach(d => eventos.push({ id: d.id, ...d.data() })); if (ocActual) pintarBitacora();
        }, () => { /* sin permiso: no se muestra bitácora */ });
        pintarDetalle();
    }

    let verTodos = false;
    function pintarDetalle() {
        const oc = ocActual; if (!oc) return;
        const pl = estadoPlazo(oc), tot = totalesPorCentro(oc), disc = discrepancias(oc);
        const cols = (oc.columnas || []).filter(c => verTodos || c.centro === CENTRO_PROPIO);
        const colsVis = cols.length ? cols : (oc.columnas || []);
        root().innerHTML = `
            <div class="page-header mb-24"><div class="page-title"><button type="button" class="btn btn-outline btn-sm" id="soc-volver">← Órdenes</button>
                <h1>OC ${esc(oc.numeroOC)}</h1><p>${esc(oc.proveedor || '')}${oc.descripcion ? ' · ' + esc(oc.descripcion) : ''}</p></div>${chip(pl)}</div>
            <div class="erp-card soc-fechas">
                <div><small>Emitida</small><strong>${fmtFecha(oc.emitida)}</strong></div>
                <div><small>Aceptada</small><strong>${fmtFecha(oc.aceptada)}</strong></div>
                <div><small>Plazo</small><strong>${num(oc.plazoDiasHabiles) || 5} días hábiles</strong></div>
                <div><small>Vence</small><strong>${fmtFecha(pl.limite)}</strong></div>
                <div><small>Multa</small><strong>${esc(({ por_evaluar: 'Por evaluar', no_se_cursa: 'No se cursa', cursada: 'Cursada' })[(oc.multa && oc.multa.estado) || 'por_evaluar'])}${oc.multa && oc.multa.monto ? ' · ' + peso(oc.multa.monto) : ''}</strong></div>
            </div>
            <div class="erp-card"><h3>Discrepancias <span class="soc-n">${disc.length}</span></h3>
                ${disc.length ? '<ul class="soc-disc">' + disc.map(d => `<li class="soc-disc--${d.nivel}">${esc(d.texto)}</li>`).join('') + '</ul>' : '<p class="bodega-estantes__hint">Sin discrepancias.</p>'}</div>
            <div class="erp-card"><div class="soc-sub"><h3>Pedido y recibido</h3>
                <label class="soc-toggle"><input type="checkbox" id="soc-todos" ${verTodos ? 'checked' : ''}> Ver todos los centros</label>
                <button type="button" class="btn btn-primary btn-sm" id="soc-recep"><i class="ph-bold ph-package"></i> Registrar recepción</button></div>
                <div class="soc-tabla"><table><thead><tr><th>Producto</th><th>Neto</th>${colsVis.map(c => `<th>${esc(c.centro)}<br><small>memo ${esc(c.memo)} · CDP ${esc(c.cdp)}</small></th>`).join('')}</tr></thead><tbody>
                ${(oc.lineas || []).map(l => `<tr><td>${esc(l.descripcion)}</td><td>${peso(l.valorNeto)}</td>${colsVis.map(c => {
                    const p = num(l.dist && l.dist[c.key]), r = num(l.recibido && l.recibido[c.key]); if (!p && !r) return '<td class="soc-vacio">—</td>';
                    return `<td class="soc-est--${estadoLinea(p, r)}"><strong>${r}</strong> / ${p}</td>`; }).join('')}</tr>`).join('')}
                </tbody></table></div>
                <div class="soc-resumen">${tot.filter(t => verTodos || t.centro === CENTRO_PROPIO).map(t => `<span><strong>${esc(t.centro)}</strong>: pendiente ${t.pendiente} un. · ${peso(t.netoPend)} neto de ${peso(t.netoTotal)}</span>`).join('')}</div></div>
            <div class="erp-card"><h3>Destinatarios del correo</h3><div id="soc-dest"></div></div>
            <div class="erp-card"><h3>Notas y avisos</h3>
                <textarea id="soc-texto" rows="3" maxlength="1500" placeholder="Escribe la nota o aviso (ej.: proveedor informa despacho por Pullman Cargo, OT …)"></textarea>
                <div class="soc-componer"><label class="soc-toggle"><input type="checkbox" id="soc-correo" checked> Enviar correo a la lista</label>
                    <button type="button" class="btn btn-primary" id="soc-guardar-nota">Registrar</button></div>
                <div id="soc-bitacora"></div></div>
            <div class="soc-pie">${esAdmin() ? '<button type="button" class="btn btn-outline btn-sm" id="soc-multa">Registrar decisión de multa</button> <button type="button" class="btn btn-outline btn-sm" id="soc-cerrar">' + (oc.cerrada ? 'Reabrir seguimiento' : 'Cerrar seguimiento') + '</button> <button type="button" class="btn btn-outline btn-sm" id="soc-config">Configurar correo</button>' : ''}</div>`;
        const q = (s) => root().querySelector(s);
        q('#soc-volver').addEventListener('click', () => { ocActual = null; pintarLista(); });
        q('#soc-todos').addEventListener('change', (e) => { verTodos = e.target.checked; pintarDetalle(); });
        q('#soc-recep').addEventListener('click', formRecepcion);
        q('#soc-guardar-nota').addEventListener('click', guardarNota);
        const m = q('#soc-multa'); if (m) m.addEventListener('click', formMulta);
        const c = q('#soc-cerrar'); if (c) c.addEventListener('click', alternarCierre);
        const cf = q('#soc-config'); if (cf) cf.addEventListener('click', formConfig);
        pintarDestinatarios(); pintarBitacora();
    }

    function pintarDestinatarios() {
        const host = root().querySelector('#soc-dest'); if (!host || !ocActual) return;
        const dest = ocActual.destinatarios || [];
        host.innerHTML = `<div class="soc-chips">${dest.length ? dest.map((d, i) => `<span class="bodega-estantes__chip">${esc(d)} <button type="button" class="soc-x" data-quitar="${i}" aria-label="Quitar ${esc(d)}">×</button></span>`).join('') : '<small>Aún no hay destinatarios.</small>'}</div>
            <div class="soc-add"><input type="email" id="soc-nuevo-mail" placeholder="correo@dominio.cl" autocomplete="off"><button type="button" class="btn btn-outline btn-sm" id="soc-add-mail">Agregar</button>
            ${(configCorreo.destinatariosBase || []).length ? '<button type="button" class="btn btn-outline btn-sm" id="soc-base">Agregar lista base</button>' : ''}</div>
            <small class="bodega-estantes__hint">${configCorreo.webhookUrl ? 'Envío automático configurado.' : 'El envío automático aún no está configurado: se abrirá un borrador en tu correo.'}</small>`;
        const guardar = async (arr) => { try { await fs().updateDoc(fs().doc(fs().collection(db(), 'Seguimiento_OC'), ocActual.id), { destinatarios: arr }); } catch (e) { toast('Error', 'No se guardó la lista: ' + (e.code || e.message), 'error'); } };
        host.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', () => guardar(dest.filter((_, i) => i !== Number(b.dataset.quitar)))));
        host.querySelector('#soc-add-mail').addEventListener('click', () => {
            const v = host.querySelector('#soc-nuevo-mail').value.trim().toLowerCase();
            if (!emailValido(v)) { toast('Correo no válido', 'Revisa la dirección.', 'warning'); return; }
            if (!dest.includes(v)) guardar([...dest, v]);
        });
        const b = host.querySelector('#soc-base'); if (b) b.addEventListener('click', () => guardar([...new Set([...dest, ...configCorreo.destinatariosBase])]));
    }

    const ICONOS = { NOTA: 'Nota', RECEPCION: 'Recepción', MULTA: 'Multa', ESTADO: 'Estado', CREACION: 'Ingreso' };
    function pintarBitacora() {
        const host = root() && root().querySelector('#soc-bitacora'); if (!host) return;
        host.innerHTML = eventos.length ? '<ul class="soc-bit">' + eventos.map(e => `<li><div><strong>${esc(ICONOS[e.tipo] || e.tipo)}</strong> · ${esc(e.autor || '')} · <small>${esc(fmtFechaHora(e.fecha))}</small></div>
            <div class="soc-bit__txt">${esc(e.texto || '')}</div>
            ${e.correo ? `<small class="soc-correo soc-correo--${esc(e.correo.estado)}">${({ enviado: 'Correo enviado a ' + (e.correo.destinatarios || []).length + ' destinatario(s)', borrador: 'Borrador de correo abierto', error: 'El correo no se pudo enviar' + (e.correo.detalle ? ': ' + e.correo.detalle : ''), sin_destinatarios: 'Sin destinatarios: no se envió correo' })[e.correo.estado] || ''}</small>` : ''}</li>`).join('') + '</ul>'
            : '<p class="bodega-estantes__hint">Aún no hay notas.</p>';
    }

    /** Registra un evento (con correo opcional). El evento se escribe una sola vez, con el resultado del envío. */
    async function registrarEvento(oc, { tipo, texto, titulo, notificar, extra, cambiosOC }) {
        let correo = null;
        if (notificar) {
            const aplicado = cambiosOC ? (typeof cambiosOC === 'function' ? cambiosOC(oc) : cambiosOC) : {};
            const mail = armarCorreo({ ...oc, ...aplicado }, titulo || ICONOS[tipo] || 'Aviso', texto, usuario());
            correo = await enviarCorreo(oc.destinatarios || [], mail);
        }
        const f = fs();
        const evRef = f.doc(f.collection(db(), 'Seguimiento_OC', oc.id, 'Eventos'));
        const ocRef = f.doc(f.collection(db(), 'Seguimiento_OC'), oc.id);
        const ev = { tipo, texto, autor: usuario(), fecha: f.serverTimestamp(), ...(correo ? { correo } : {}), ...(extra || {}) };
        await f.runTransaction(db(), async (tx) => {
            if (cambiosOC) {
                const s = await tx.get(ocRef); if (!s.exists()) throw new Error('La orden ya no existe.');
                tx.update(ocRef, { ...(typeof cambiosOC === 'function' ? cambiosOC(s.data()) : cambiosOC), actualizadoEn: f.serverTimestamp() });
            }
            tx.set(evRef, ev);
        });
        return correo;
    }

    async function guardarNota() {
        const t = root().querySelector('#soc-texto').value.trim(), notificar = root().querySelector('#soc-correo').checked;
        if (!t) { toast('Falta el texto', 'Escribe la nota o el aviso.', 'warning'); return; }
        const btn = root().querySelector('#soc-guardar-nota'); btn.disabled = true;
        try {
            const c = await registrarEvento(ocActual, { tipo: 'NOTA', texto: t, titulo: 'Aviso de seguimiento', notificar });
            root().querySelector('#soc-texto').value = '';
            toast('Registrado', c ? ({ enviado: 'Nota guardada y correo enviado.', borrador: 'Nota guardada; se abrió un borrador de correo.', error: 'Nota guardada, pero el correo no se pudo enviar.', sin_destinatarios: 'Nota guardada. No hay destinatarios para el correo.' })[c.estado] : 'Nota guardada.', c && c.estado === 'error' ? 'warning' : 'success');
        } catch (e) { toast('No se guardó', (e.code || '') + ' ' + e.message, 'error'); }
        btn.disabled = false;
    }

    // --- ventanas de formulario simples ---
    function modal(titulo, html, onListo) {
        const ov = document.createElement('div'); ov.className = 'cierre-overlay';
        ov.innerHTML = `<div class="cierre-box" role="dialog" aria-modal="true" aria-label="${esc(titulo)}"><h3>${esc(titulo)}</h3>${html}<div class="cierre-acciones"><button type="button" class="btn btn-outline" data-x>Cancelar</button><button type="button" class="btn btn-primary" data-ok>Guardar</button></div></div>`;
        document.body.appendChild(ov);
        const cerrar = () => ov.remove();
        ov.querySelector('[data-x]').addEventListener('click', cerrar);
        ov.querySelector('[data-ok]').addEventListener('click', async (e) => { e.target.disabled = true; try { const r = await onListo(ov); if (r !== false) cerrar(); else e.target.disabled = false; } catch (err) { toast('Error', (err.code || '') + ' ' + err.message, 'error'); e.target.disabled = false; } });
        return ov;
    }

    function formNueva() {
        let cuadro = null;
        const ov = modal('Ingresar orden de compra', `
            <label>N° de orden (Mercado Público)<input type="text" id="n-num" placeholder="1298355-840-AG26" autocomplete="off"></label>
            <label>Proveedor<input type="text" id="n-prov" placeholder="Nombre del proveedor"></label>
            <label>Descripción<input type="text" id="n-desc" placeholder="Ej.: productos para monitoreo de pacientes"></label>
            <div class="soc-fila"><label>Emitida<input type="date" id="n-emi"></label><label>Aceptada por el proveedor<input type="date" id="n-ace"></label><label>Plazo (días hábiles)<input type="number" id="n-plazo" min="1" max="60" value="5"></label></div>
            <label>Cuadro de distribución (Excel)<input type="file" id="n-file" accept=".xlsx,.xls"></label>
            <div id="n-prev" class="cierre-hint">Sube el Excel con las columnas "MEMO N° … CDP N° …" para cargar los productos y la distribución por centro.</div>`,
            async (o) => {
                const q = (s) => o.querySelector(s);
                const numero = q('#n-num').value.trim().toUpperCase(), ace = q('#n-ace').value;
                if (!numero) { toast('Falta el número', 'Escribe el N° de la orden.', 'warning'); return false; }
                if (!ace) { toast('Falta la fecha', 'Indica cuándo aceptó la orden el proveedor (desde ahí corre el plazo).', 'warning'); return false; }
                if (!cuadro) { toast('Falta el cuadro', 'Sube el Excel del cuadro de distribución.', 'warning'); return false; }
                const id = slug(numero);
                const ref = fs().doc(fs().collection(db(), 'Seguimiento_OC'), id);
                if ((await fs().getDoc(ref)).exists()) { toast('Ya existe', 'Esa orden ya está en seguimiento.', 'warning'); return false; }
                const plazo = num(q('#n-plazo').value) || 5;
                const oc = { numeroOC: numero, proveedor: q('#n-prov').value.trim(), descripcion: q('#n-desc').value.trim(), emitida: q('#n-emi').value || '', aceptada: ace,
                    plazoDiasHabiles: plazo, fechaLimite: sumarHabiles(ace, plazo), columnas: cuadro.columnas, lineas: cuadro.lineas, destinatarios: [...(configCorreo.destinatariosBase || [])],
                    multa: { estado: 'por_evaluar' }, cerrada: false, creadoPor: usuario(), creadoEn: fs().serverTimestamp() };
                await fs().runTransaction(db(), async (tx) => {
                    tx.set(ref, oc);
                    tx.set(fs().doc(fs().collection(db(), 'Seguimiento_OC', id, 'Eventos')), { tipo: 'CREACION', texto: `Orden ingresada: ${cuadro.lineas.length} productos, ${cuadro.columnas.length} memos/CDP. Vence el ${fmtFecha(oc.fechaLimite)}.`, autor: usuario(), fecha: fs().serverTimestamp() });
                });
                toast('Orden ingresada', `Vence el ${fmtFecha(oc.fechaLimite)}.`, 'success');
            });
        ov.querySelector('#n-file').addEventListener('change', async (e) => {
            const prev = ov.querySelector('#n-prev'); cuadro = null;
            try {
                if (typeof XLSX === 'undefined') throw new Error('No cargó la librería de Excel.');
                const f = e.target.files[0]; if (!f) return;
                const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
                cuadro = parsearCuadro(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null }));
                const aviso = cuadro.lineas.filter(l => l.totalDeclarado != null && Object.values(l.dist).reduce((a, b) => a + b, 0) !== l.totalDeclarado).length;
                prev.innerHTML = `<strong>${cuadro.lineas.length}</strong> productos · <strong>${cuadro.columnas.length}</strong> memos/CDP (${[...new Set(cuadro.columnas.map(c => c.centro))].map(esc).join(', ')})${aviso ? ` · <span class="cierre-error">${aviso} línea(s) no cuadran con el total del archivo</span>` : ''}`;
            } catch (err) { prev.innerHTML = `<span class="cierre-error">${esc(err.message)}</span>`; }
        });
    }

    function formRecepcion() {
        const oc = ocActual; const cols = oc.columnas || [];
        const ov = modal('Registrar recepción', `
            <label>¿Qué memo/CDP se recibió?<select id="r-col">${cols.map(c => `<option value="${esc(c.key)}" ${c.centro === CENTRO_PROPIO ? '' : ''}>${esc(c.centro)} · memo ${esc(c.memo)} · CDP ${esc(c.cdp)}</option>`).join('')}</select></label>
            <div class="soc-fila"><label>N° guía de despacho<input type="text" id="r-guia" autocomplete="off"></label><label>Fecha<input type="date" id="r-fecha" value="${hoyISO()}"></label></div>
            <div id="r-lineas"></div>
            <label>Observación (opcional)<input type="text" id="r-obs" maxlength="300"></label>
            <label class="soc-toggle"><input type="checkbox" id="r-correo" checked> Avisar por correo a la lista</label>`,
            async (o) => {
                const q = (s) => o.querySelector(s), key = q('#r-col').value;
                const det = []; o.querySelectorAll('[data-i]').forEach(inp => { const v = num(inp.value); if (v > 0) det.push({ i: Number(inp.dataset.i), v }); });
                if (!det.length) { toast('Sin cantidades', 'Indica al menos una cantidad recibida.', 'warning'); return false; }
                const col = cols.find(c => c.key === key), guia = q('#r-guia').value.trim(), fecha = q('#r-fecha').value || hoyISO();
                const detalle = det.map(d => ({ descripcion: oc.lineas[d.i].descripcion, cantidad: d.v }));
                const texto = `Recepción en ${col.centro} (memo ${col.memo}, CDP ${col.cdp}) el ${fmtFecha(fecha)}${guia ? ' · guía N° ' + guia : ''}:\n` + detalle.map(d => `- ${d.descripcion}: ${d.cantidad} un.`).join('\n') + (q('#r-obs').value.trim() ? '\nObs.: ' + q('#r-obs').value.trim() : '');
                const aplicar = (data) => { const lineas = (data.lineas || []).map(l => ({ ...l, recibido: { ...(l.recibido || {}) } })); det.forEach(d => { const l = lineas[d.i]; l.recibido[key] = num(l.recibido[key]) + d.v; }); return { lineas }; };
                await registrarEvento(oc, { tipo: 'RECEPCION', texto, titulo: `Recepción en ${col.centro}`, notificar: q('#r-correo').checked, extra: { columna: key, guia, fechaRecepcion: fecha, detalle }, cambiosOC: (data) => aplicar(data) });
                toast('Recepción registrada', 'Se actualizó lo recibido.', 'success');
            });
        const pintar = () => {
            const key = ov.querySelector('#r-col').value;
            ov.querySelector('#r-lineas').innerHTML = '<div class="soc-tabla"><table><thead><tr><th>Producto</th><th>Pedido</th><th>Ya recibido</th><th>Recibido ahora</th></tr></thead><tbody>' +
                oc.lineas.map((l, i) => { const p = num(l.dist && l.dist[key]); return p ? `<tr><td>${esc(l.descripcion)}</td><td>${p}</td><td>${num(l.recibido && l.recibido[key])}</td><td><input type="number" min="0" data-i="${i}" value=""></td></tr>` : ''; }).join('') + '</tbody></table></div>';
        };
        ov.querySelector('#r-col').addEventListener('change', pintar); pintar();
    }

    function formMulta() {
        const m = ocActual.multa || {};
        modal('Decisión sobre la multa', `
            <label>Estado<select id="m-est"><option value="por_evaluar">Por evaluar</option><option value="no_se_cursa">No se cursa</option><option value="cursada">Cursada</option></select></label>
            <label>Monto (opcional, $)<input type="number" id="m-monto" min="0" value="${num(m.monto) || ''}"></label>
            <label>Fundamento<input type="text" id="m-nota" maxlength="300" placeholder="Ej.: monto menor a $100.000, el trámite cuesta más que la multa"></label>
            <label class="soc-toggle"><input type="checkbox" id="m-correo" checked> Avisar por correo a la lista</label>`,
            async (o) => {
                const est = o.querySelector('#m-est').value, monto = num(o.querySelector('#m-monto').value), nota = o.querySelector('#m-nota').value.trim();
                if (!nota) { toast('Falta el fundamento', 'Escribe por qué se decide así.', 'warning'); return false; }
                const nombre = { por_evaluar: 'por evaluar', no_se_cursa: 'no se cursa', cursada: 'cursada' }[est];
                await registrarEvento(ocActual, { tipo: 'MULTA', texto: `Multa ${nombre}${monto ? ' (' + peso(monto) + ')' : ''}. ${nota}`, titulo: 'Decisión sobre multa', notificar: o.querySelector('#m-correo').checked, cambiosOC: { multa: { estado: est, monto, nota } } });
                toast('Registrado', 'Decisión guardada.', 'success');
            }).querySelector('#m-est').value = m.estado || 'por_evaluar';
    }

    async function alternarCierre() {
        const nuevo = !ocActual.cerrada;
        if (!window.confirm(nuevo ? 'Cerrar el seguimiento de esta orden?' : 'Reabrir el seguimiento de esta orden?')) return;
        try { await registrarEvento(ocActual, { tipo: 'ESTADO', texto: nuevo ? 'Seguimiento cerrado.' : 'Seguimiento reabierto.', notificar: false, cambiosOC: { cerrada: nuevo } }); }
        catch (e) { toast('Error', e.message, 'error'); }
    }

    const SCRIPT_GAS = `// Pega este código en script.google.com (proyecto nuevo) y publícalo como "Aplicación web".
// Ejecutar como: Yo · Quién tiene acceso: Cualquier persona. Luego copia la URL en "Configurar correo".
const TOKEN = 'CAMBIA-ESTE-TOKEN-POR-UNA-CLAVE-LARGA';
const DOMINIOS = ['cormumel.cl', 'vivirsalud.cl'];   // solo se envía a estos dominios
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return salida({ ok: false, error: 'token' });
    const to = (d.to || []).filter(m => DOMINIOS.some(x => String(m).toLowerCase().endsWith('@' + x)));
    if (!to.length) return salida({ ok: false, error: 'sin destinatarios permitidos' });
    MailApp.sendEmail({ to: to.join(','), subject: String(d.subject).slice(0, 200), body: String(d.text), htmlBody: String(d.html), name: 'Sistema SAR Melipilla' });
    return salida({ ok: true, enviados: to.length });
  } catch (err) { return salida({ ok: false, error: String(err) }); }
}
function salida(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }`;

    function formConfig() {
        const c = configCorreo;
        const ov = modal('Configurar correo', `
            <p class="cierre-hint">El envío automático usa un Google Apps Script con tu cuenta de Gmail (gratis, sin plan Blaze). Pasos: 1) abre script.google.com, 2) pega el código de abajo, 3) cambia la clave, 4) Implementar → Nueva implementación → Aplicación web (ejecutar como "Yo", acceso "Cualquier persona"), 5) pega aquí la URL y la misma clave.</p>
            <textarea id="c-script" rows="9" readonly style="font-family:monospace;font-size:11px">${esc(SCRIPT_GAS)}</textarea>
            <button type="button" class="btn btn-outline btn-sm" id="c-copiar">Copiar código</button>
            <label>URL de la aplicación web<input type="text" id="c-url" value="${esc(c.webhookUrl || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
            <label>Clave (la misma del script)<input type="text" id="c-token" value="${esc(c.token || '')}" autocomplete="off"></label>
            <label>Lista base de destinatarios (separados por coma)<input type="text" id="c-base" value="${esc((c.destinatariosBase || []).join(', '))}"></label>
            <label>Feriados adicionales (AAAA-MM-DD, separados por coma)<input type="text" id="c-fer" value="${esc((c.feriadosExtra || []).join(', '))}" placeholder="Hoy están cargados los de 2026"></label>`,
            async (o) => {
                const lst = (s) => s.split(/[,\s;]+/).map(x => x.trim()).filter(Boolean);
                const base = lst(o.querySelector('#c-base').value).map(x => x.toLowerCase()), fer = lst(o.querySelector('#c-fer').value);
                if (base.some(x => !emailValido(x))) { toast('Correo no válido', 'Revisa la lista base.', 'warning'); return false; }
                if (fer.some(x => !/^\d{4}-\d{2}-\d{2}$/.test(x))) { toast('Fecha no válida', 'Usa el formato AAAA-MM-DD.', 'warning'); return false; }
                const nueva = { webhookUrl: o.querySelector('#c-url').value.trim(), token: o.querySelector('#c-token').value.trim(), destinatariosBase: base, feriadosExtra: fer };
                await fs().setDoc(fs().doc(fs().collection(db(), 'Config_Correo'), 'principal'), nueva, { merge: true });
                configCorreo = { ...configCorreo, ...nueva }; setFeriadosExtra(fer);
                toast('Guardado', 'Configuración de correo actualizada.', 'success');
                if (ocActual) pintarDetalle();
            });
        ov.querySelector('#c-copiar').addEventListener('click', async () => { try { await navigator.clipboard.writeText(SCRIPT_GAS); toast('Copiado', 'Código copiado.', 'success'); } catch (e) { ov.querySelector('#c-script').select(); } });
    }

    window.SAR_SeguimientoOC = { abrir, sumarHabiles, habilesEntre, estadoPlazo, estadoLinea, totalesPorCentro, discrepancias, parsearCuadro, armarCorreo, resumenTexto, setFeriadosExtra, emailValido, enviarCorreo, _setConfig: (c) => { configCorreo = { ...configCorreo, ...c }; } };
})(window, document);
