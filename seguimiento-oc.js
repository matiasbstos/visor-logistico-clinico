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
        '2026-08-15', '2026-09-18', '2026-09-19', '2026-10-12', '2026-10-31', '2026-11-01', '2026-12-08', '2026-12-25',
        // 2027: solo feriados que caen de lunes a viernes (los de fin de semana no cambian los días hábiles)
        '2027-01-01', '2027-03-26', '2027-05-21', '2027-06-28', '2027-07-16', '2027-10-11', '2027-11-01', '2027-12-08'];
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
                pedido += p; recibido += Math.min(p, r); netoTotal += p * num(l.valorNeto); netoPend += Math.max(0, p - r) * num(l.valorNeto);
            }));
            return { centro: ce.centro, pedido, recibido, pendiente: Math.max(0, pedido - recibido), netoPend, netoTotal, completo: pedido > 0 && recibido >= pedido };
        });
    }
    /** Entregas por columna (centro/memo): pedido, recibido, en stock, entregado y lo que falta. Puro. */
    function estadoEntregas(oc) {
        return (oc.columnas || []).map(c => {
            let pedido = 0, recibido = 0, ingresado = 0, entregado = 0, entregable = 0;
            (oc.lineas || []).forEach(l => {
                const p = num(l.dist && l.dist[c.key]), r = num(l.recibido && l.recibido[c.key]), g = num(l.ingresado && l.ingresado[c.key]), e = num(l.entregado && l.entregado[c.key]);
                pedido += p; recibido += r; ingresado += g; entregado += e; entregable += Math.max(0, g - e);
            });
            const estado = pedido > 0 && entregado >= pedido ? 'ENTREGADO' : entregado > 0 ? 'PARCIAL' : entregable > 0 ? 'EN_STOCK' : recibido > 0 ? 'RECIBIDO' : 'SIN_RECIBIR';
            return { key: c.key, centro: c.centro, memo: c.memo, cdp: c.cdp, pedido, recibido, ingresado, entregado, entregable, pendiente: Math.max(0, pedido - entregado), estado };
        });
    }
    const ETIQ_ENTREGA = { ENTREGADO: 'Entregado completo', PARCIAL: 'Entrega parcial', EN_STOCK: 'En bodega, listo para entregar', RECIBIDO: 'Recibido (sin ingresar a stock)', SIN_RECIBIR: 'Aún no llega' };
    function estadoLinea(pedido, recibido) {
        if (pedido <= 0 && recibido <= 0) return 'sin';
        if (recibido <= 0) return 'pendiente';
        if (recibido > pedido) return 'exceso';
        return recibido === pedido ? 'completo' : 'parcial';
    }
    /** Estado del plazo respecto de hoy. */
    function estadoPlazo(oc, hoy) {
        hoy = hoy || hoyISO();
        const recibida = (oc.lineas || []).some(l => Object.values(l.recibido || {}).some(v => num(v) > 0));   // si ya llegó mercadería, la orden fue aceptada de hecho
        const limite = oc.fechaLimite || (oc.aceptada ? sumarHabiles(oc.aceptada, num(oc.plazoDiasHabiles) || 5) : (recibida && oc.emitida ? sumarHabiles(oc.emitida, num(oc.plazoDiasHabiles) || 5) : ''));
        const tot = totalesPorCentro(oc);
        const pendiente = tot.some(t => t.pendiente > 0);
        if (oc.cerrada) return { codigo: 'CERRADA', limite, texto: 'Seguimiento cerrado', atraso: 0 };
        if (!pendiente && tot.length) return { codigo: 'COMPLETA', limite, texto: 'Recibida completa', atraso: 0 };
        if (!oc.aceptada && !recibida) {
            const lim = oc.aceptarLimite || '';
            if (lim && hoy > lim) return { codigo: 'ACEPT_VENCIDA', limite: lim, texto: 'Aceptación vencida: el proveedor no ha aceptado', atraso: 0 };
            return { codigo: 'POR_ACEPTAR', limite: lim, texto: lim ? `Por aceptar hasta el ${fmtFecha(lim)}` : 'Por aceptar', atraso: 0 };
        }
        if (hoy > limite) { const a = habilesEntre(limite, hoy); return { codigo: 'ATRASADA', limite, atraso: a, texto: `Atrasada ${a} día${a === 1 ? '' : 's'} hábil${a === 1 ? '' : 'es'}` }; }
        const r = habilesEntre(hoy, limite);
        return { codigo: 'EN_PLAZO', limite, restan: r, texto: r === 0 ? 'Vence hoy' : `Vence en ${r} día${r === 1 ? '' : 's'} hábil${r === 1 ? '' : 'es'}` };
    }
    /** Lista de discrepancias a revisar (nivel: alto / medio / info). */
    function discrepancias(oc, hoy) {
        const out = [], pl = estadoPlazo(oc, hoy), tot = totalesPorCentro(oc);
        if (pl.codigo === 'ACEPT_VENCIDA') out.push({ nivel: 'alto', texto: `El proveedor no aceptó la orden dentro del plazo (hasta el ${fmtFecha(pl.limite)}). Revisa en Mercado Público o contáctalo.` });
        (oc.incidencias || []).filter(i => i.estado === 'ABIERTA').forEach(i => out.push({ nivel: 'alto', texto: `Incidencia abierta (${INCIDENCIAS[i.tipo] || i.tipo}) — ${i.producto}${i.detalle ? ': ' + i.detalle : ''}.` }));
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
    const INCIDENCIAS = { DANADO: 'Dañado / defectuoso', VENCIMIENTO_CORTO: 'Vencimiento corto', DISTINTO: 'Producto distinto al pedido', FALTANTE: 'Faltante', OTRO: 'Otro' };
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
    async function enviarCorreo(destinatarios, correo, extra) {
        const to = (destinatarios || []).filter(emailValido);
        const cc = ((extra && extra.cc) || []).filter(emailValido), adj = (extra && extra.attachments) || [];
        if (!to.length) return { estado: 'sin_destinatarios', destinatarios: [] };
        if (!configCorreo.webhookUrl || !configCorreo.token) {
            try { window.open(`mailto:${encodeURIComponent(to.join(','))}?${cc.length ? 'cc=' + encodeURIComponent(cc.join(',')) + '&' : ''}subject=${encodeURIComponent(correo.subject)}&body=${encodeURIComponent(correo.text)}`, '_blank'); } catch (e) { /* bloqueado */ }
            return { estado: 'borrador', destinatarios: to, cc };
        }
        try {
            const r = await fetch(configCorreo.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ token: configCorreo.token, to, cc, subject: correo.subject, text: correo.text, html: correo.html, attachments: adj }) });
            const j = await r.json();
            if (j && j.ok && adj.length && num(j.adjuntos) !== adj.length) return { estado: 'sin_adjuntos', destinatarios: to, cc, detalle: 'El correo salió SIN adjuntos: el script de Apps Script no está actualizado. Pega el código nuevo en "Configurar correo" y vuelve a implementar.' };
            return j && j.ok ? { estado: 'enviado', destinatarios: to, cc } : { estado: 'error', destinatarios: to, cc, detalle: String((j && j.error) || 'respuesta no válida') };
        } catch (e) { return { estado: 'error', destinatarios: to, cc, detalle: String((e && e.message) || e) }; }
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
        if (window.SAR_CDP) await window.SAR_CDP.cargar();
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

    /** Stock pendiente de recepción (lo pedido al SAR que aún no llega), de las órdenes abiertas. */
    function pendientesDeRecepcion(ordenes) {
        const out = [];
        (ordenes || []).filter(o => !o.cerrada).forEach(oc => {
            const pl = estadoPlazo(oc);
            (oc.columnas || []).filter(c => c.centro === CENTRO_PROPIO).forEach(c => (oc.lineas || []).forEach(l => {
                const p = num(l.dist && l.dist[c.key]), r = num(l.recibido && l.recibido[c.key]);
                if (p > r) out.push({ ocId: oc.id, numeroOC: oc.numeroOC, proveedor: oc.proveedor, producto: l.descripcion, pendiente: p - r, pedido: p, codigo: pl.codigo, limite: pl.limite, aceptada: !!oc.aceptada });
            }));
        });
        return out.sort((a, b) => String(a.limite || '9999').localeCompare(String(b.limite || '9999')));
    }
    function pendienteHTML() {
        const pend = pendientesDeRecepcion(lista);
        if (!pend.length) return '';
        const unidades = pend.reduce((t, x) => t + x.pendiente, 0), por = new Map();
        pend.forEach(x => { const g = por.get(x.ocId) || { ...x, pendiente: 0, productos: 0 }; g.pendiente += x.pendiente; g.productos++; por.set(x.ocId, g); });
        return `<details class="erp-card soc-pend soc-det"><summary><h3>Stock pendiente de recepción <span class="soc-n">${unidades} un.</span></h3></summary>
            <div class="soc-tabla"><table><thead><tr><th>Orden</th><th>Productos</th><th>Unidades pend.</th><th>Estado</th></tr></thead><tbody>${[...por.values()].map(x => { const pl = estadoPlazo(lista.find(o => o.id === x.ocId) || {});
                return `<tr data-oc="${esc(x.ocId)}" class="soc-pend__fila"><td><strong>${esc(x.numeroOC)}</strong><br><small>${esc(x.proveedor || '')}</small></td><td>${x.productos}</td><td><strong>${x.pendiente}</strong></td><td>${chip(pl)}</td></tr>`; }).join('')}</tbody></table></div></details>`;
    }

    function pintarLista() {
        ocActual = null; if (unsubEventos) { try { unsubEventos(); } catch (e) { /* noop */ } unsubEventos = null; }
        root().innerHTML = `
            <div class="page-header mb-24"><div class="page-title"><h1>Seguimiento de órdenes de compra</h1>
                <p>Plazos, recepciones por centro, discrepancias, notas y avisos por correo.</p></div>
                <div class="soc-acc"><button type="button" class="btn btn-primary" id="soc-pdf"><i class="ph-bold ph-file-pdf"></i> Ingresar desde PDF</button>
                <button type="button" class="btn btn-outline" id="soc-nueva"><i class="ph-bold ph-microsoft-excel-logo"></i> Con cuadro Excel</button></div></div>
            <div class="soc-buscar"><input type="search" id="soc-buscar" placeholder="Buscar orden por número, proveedor o descripción…" aria-label="Buscar orden" autocomplete="off"></div>
            <div class="soc-lista">${lista.length ? lista.map(oc => {
                const pl = estadoPlazo(oc), tot = totalesPorCentro(oc), mio = tot.find(t => t.centro === CENTRO_PROPIO) || tot[0];
                const pct = mio && mio.pedido ? Math.min(100, Math.round(mio.recibido * 100 / mio.pedido)) : 0;
                return `<button type="button" class="erp-card soc-card" data-oc="${esc(oc.id)}">
                    <div class="soc-card__top"><strong>${esc(oc.numeroOC)}</strong>${chip(pl)}</div>
                    <div class="soc-card__sub">${esc(oc.proveedor || 'Proveedor sin indicar')} · ${oc.aceptada ? 'vence ' + fmtFecha(pl.limite) : (pl.limite ? 'acepta hasta ' + fmtFecha(pl.limite) : 'sin aceptar')}</div>
                    ${mio ? `<div class="soc-barra" title="${esc(mio.centro)}"><span style="width:${pct}%"></span></div><small>${esc(mio.centro)}: ${mio.recibido} de ${mio.pedido} unidades recibidas</small>` : ''}
                </button>`; }).join('') : '<div class="home-empty">Aún no hay órdenes en seguimiento. Usa "Ingresar desde PDF".</div>'}</div>
            ${pendienteHTML()}
            ${window.SAR_CDP ? `<details class="soc-det soc-det--cdp"><summary>Presupuesto por CDP (opcional)</summary>${window.SAR_CDP.cardHTML(lista)}</details>` : ''}`;
        if (window.SAR_CDP) window.SAR_CDP.enlazar(root(), lista, modal, toast, pintarLista);
        root().querySelector('#soc-nueva').addEventListener('click', formNueva);
        root().querySelector('#soc-pdf').addEventListener('click', formDesdePDF);
        root().querySelectorAll('[data-oc]').forEach(b => b.addEventListener('click', () => abrirDetalle(b.dataset.oc)));
        marcarMigas(false);
        const bus = root().querySelector('#soc-buscar');
        if (bus) bus.addEventListener('input', () => { const t = norm(bus.value); root().querySelectorAll('.soc-lista .soc-card').forEach(c => { c.style.display = !t || norm(c.textContent).includes(t) ? '' : 'none'; }); });
    }

    /** Abre la ficha de una orden recién creada apenas llegue en la lista (tiempo real). */
    function abrirCuando(id, n) { n = n || 0; if (lista.some(x => x.id === id)) { abrirDetalle(id); return; } if (n < 15) setTimeout(() => abrirCuando(id, n + 1), 300); }
    function abrirDetalle(id) {
        ocActual = lista.find(x => x.id === id); if (!ocActual) return;
        if (unsubEventos) { try { unsubEventos(); } catch (e) { /* noop */ } }
        eventos = [];
        unsubEventos = fs().onSnapshot(fs().query(fs().collection(db(), 'Seguimiento_OC', id, 'Eventos'), fs().orderBy('fecha', 'desc'), fs().limit(100)), (snap) => {
            eventos = []; snap.forEach(d => eventos.push({ id: d.id, ...d.data() })); if (ocActual) pintarBitacora();
        }, () => { /* sin permiso: no se muestra bitácora */ });
        pintarDetalle();
    }

    let verTodos = false, verPedido = false;
    function pintarDetalle() {
        const oc = ocActual; if (!oc) return;
        const pl = estadoPlazo(oc), tot = totalesPorCentro(oc), disc = discrepancias(oc);
        const cols = (oc.columnas || []).filter(c => verTodos || c.centro === CENTRO_PROPIO);
        const colsVis = cols.length ? cols : (oc.columnas || []);
        root().innerHTML = `
            <div class="page-header mb-24"><div class="page-title"><button type="button" class="btn btn-outline btn-sm" id="soc-volver">← Órdenes</button>
                <h1>OC ${esc(oc.numeroOC)}</h1><p>${esc(oc.proveedor || '')}${oc.descripcion ? ' · ' + esc(oc.descripcion) : ''}</p></div></div>
            <div class="erp-card soc-resumen-orden">
                <div class="soc-resumen-orden__top"><span class="soc-resumen-orden__t">Plazo de la orden</span>${chip(pl)}</div>
                <div class="soc-fechas">
                    <div><small>Emitida</small><strong>${fmtFecha(oc.emitida)}</strong></div>
                    <div><small>Aceptada (opcional)</small>${oc.aceptada ? `<strong>${fmtFecha(oc.aceptada)}</strong>` : `<strong>—</strong>${oc.aceptarLimite ? `<small>hasta el ${fmtFecha(oc.aceptarLimite)}</small>` : ''}`}</div>
                    <div><small>Plazo de entrega</small><strong>${num(oc.plazoDiasHabiles) || 5} días hábiles</strong></div>
                    <div><small>Vence</small><strong>${oc.aceptada ? fmtFecha(pl.limite) : '—'}</strong></div>
                    <div><small>Multa</small><strong>${esc(({ por_evaluar: 'Por evaluar', no_se_cursa: 'No se cursa', cursada: 'Cursada' })[(oc.multa && oc.multa.estado) || 'por_evaluar'])}${oc.multa && oc.multa.monto ? ' · ' + peso(oc.multa.monto) : ''}</strong></div>
                </div>
            </div>
            ${bannerSiguiente(oc, pl)}
            ${(oc.otrosCentros || []).length && !verTodos ? `<p class="soc-card__sub">La orden también incluye productos de ${esc(oc.otrosCentros.map(c => c.centro + ' (memo ' + c.memo + ')').join(', '))}: no se muestran aquí.</p>` : ''}
            <details class="erp-card soc-det soc-ped" id="soc-ped"${verPedido ? ' open' : ''}><summary><h3>Pedido y recibido</h3><span class="soc-n">${(tot.find(t => t.centro === CENTRO_PROPIO) || tot[0] || { recibido: 0, pedido: 0 }).recibido} de ${(tot.find(t => t.centro === CENTRO_PROPIO) || tot[0] || { pedido: 0 }).pedido} un. recibidas</span></summary><div class="soc-sub">
                ${(oc.columnas || []).length > 1 ? `<label class="soc-toggle"><input type="checkbox" id="soc-todos" ${verTodos ? 'checked' : ''}> Ver otros centros</label>` : ''}
                ${hayRecibido(oc) ? `<button type="button" class="btn btn-outline btn-sm" id="soc-lotes"><i class="ph-bold ph-barcode"></i> Lotes y vencimientos</button>
                <button type="button" class="btn btn-outline btn-sm" id="soc-pend"><i class="ph-bold ph-file-csv"></i> Descargar pendientes</button>` : ''}</div>
                ${oc.recepcionConforme ? `<p class="soc-card__sub">Recepción conforme registrada el ${fmtFecha(oc.recepcionConforme.fecha)} (${esc(oc.recepcionConforme.tipoDoc === 'FACTURA' ? 'factura' : 'guía')} ${esc(oc.recepcionConforme.numeroDoc)}). Correo: ${({ enviado: 'enviado', borrador: 'borrador abierto', error: 'NO se envió', sin_adjuntos: 'enviado SIN adjuntos', sin_destinatarios: 'sin destinatarios' })[(oc.recepcionConforme.correo || {}).estado] || '—'}.</p>` : ''}
                <div class="soc-tabla"><table><thead><tr><th>Producto</th><th>Neto</th>${colsVis.map(c => `<th>${esc(c.centro)}<br><small>memo ${esc(c.memo)} · CDP ${esc(c.cdp)}</small></th>`).join('')}</tr></thead><tbody>
                ${(oc.lineas || []).filter(l => colsVis.some(c => num(l.dist && l.dist[c.key]) || num(l.recibido && l.recibido[c.key]))).map(l => `<tr><td>${esc(l.descripcion)}</td><td>${peso(l.valorNeto)}</td>${colsVis.map(c => {
                    const p = num(l.dist && l.dist[c.key]), r = num(l.recibido && l.recibido[c.key]); if (!p && !r) return '<td class="soc-vacio">—</td>';
                    return `<td class="soc-est--${estadoLinea(p, r)}"><strong>${r}</strong> / ${p}</td>`; }).join('')}</tr>`).join('')}
                </tbody></table></div>
                <div class="soc-resumen">${tot.filter(t => verTodos || t.centro === CENTRO_PROPIO).map(t => `<span><strong>${esc(t.centro)}</strong>: pendiente ${t.pendiente} un. · ${peso(t.netoPend)} neto de ${peso(t.netoTotal)}</span>`).join('')}</div></details>
            <div class="erp-card"><h3>Discrepancias <span class="soc-n">${disc.length}</span></h3>
                ${disc.length ? '<ul class="soc-disc">' + disc.map(d => `<li class="soc-disc--${d.nivel}">${esc(d.texto)}</li>`).join('') + '</ul>' : '<p class="bodega-estantes__hint">Sin discrepancias.</p>'}
                ${(oc.incidencias || []).filter(i => i.estado === 'ABIERTA').map(i => `<button type="button" class="btn btn-outline btn-sm" data-resolver="${esc(i.id)}">Resolver: ${esc(i.producto.slice(0, 30))}</button>`).join(' ')}</div>
            <details class="erp-card soc-det"><summary><h3>Datos de la orden, memos y distribución</h3></summary>
            ${oc.datos ? `<div class="erp-card soc-datos"><h3>Datos de la orden</h3><div class="soc-datos__g">
                ${[['Despacho', oc.datos.direccionDespacho], ['Contraparte técnica', oc.datos.contraparte], ['Contacto', oc.datos.contacto], ['Horario', oc.datos.horario], ['Forma de pago', oc.datos.formaPago], ['Factura a', oc.datos.emailFactura], ['Memo', oc.datos.memo ? 'N° ' + oc.datos.memo + (oc.descripcion ? ' · ' + oc.descripcion : '') : ''], ['Total (con IVA)', oc.datos.total ? peso(oc.datos.total) : '']].filter(x => x[1]).map(x => `<div><small>${x[0]}</small><span>${esc(x[1])}</span></div>`).join('')}</div></div>` : ''}
            ${memosCDPHTML(oc)}${entregasHTML(oc)}
            </details>
            <div class="erp-card"><h3>Notas y avisos</h3>
                <textarea id="soc-texto" rows="3" maxlength="1500" placeholder="Escribe la nota o aviso (ej.: proveedor informa despacho por Pullman Cargo, OT …)"></textarea>
                <div class="soc-componer"><label class="soc-toggle"><input type="checkbox" id="soc-correo" checked> Enviar correo a la lista</label>
                    <button type="button" class="btn btn-outline" id="soc-guardar-nota">Registrar nota</button></div>
                <div id="soc-bitacora"></div></div>
            <div class="soc-pie">${esAdmin() ? '<button type="button" class="btn btn-outline btn-sm" id="soc-multa">Registrar decisión de multa</button> <button type="button" class="btn btn-outline btn-sm" id="soc-cerrar">' + (oc.cerrada ? 'Reabrir seguimiento' : 'Cerrar seguimiento') + '</button> <button type="button" class="btn btn-outline btn-sm" id="soc-config">Configurar correo</button>' : ''}</div>`;
        const q = (s) => root().querySelector(s);
        q('#soc-volver').addEventListener('click', () => { ocActual = null; pintarLista(); });
        marcarMigas(true);
        const ped = q('#soc-ped'); if (ped) ped.addEventListener('toggle', () => { verPedido = ped.open; });
        const tdo = q('#soc-todos'); if (tdo) tdo.addEventListener('change', (e) => { verTodos = e.target.checked; pintarDetalle(); });
        const bs = q('#soc-sig'); if (bs) bs.addEventListener('click', () => { window.location.hash = bs.dataset.go.slice(1); });
        const bre = q('#soc-recep'); if (bre) bre.addEventListener('click', () => { formRecepcion().catch(e => toast('No se pudo abrir la recepción', e.message || String(e), 'error')); });
        const bpe = q('#soc-pend'); if (bpe) bpe.addEventListener('click', () => { if (!pendientesDe(ocActual).some(x => x.pendiente > 0)) { toast('Sin pendientes', 'Todo lo de SAR ya fue recibido.', 'success'); return; } descargarPendientes(ocActual); });
        const blo = q('#soc-lotes'); if (blo) blo.addEventListener('click', formLotes);
        const bco = q('#soc-conforme'); if (bco) bco.addEventListener('click', () => { if (window.SAR_RecepcionConforme) window.SAR_RecepcionConforme.abrir({ oc: ocActual, modal, toast, enviarCorreo, config: configCorreo, usuario: usuario(), fmtFecha, peso, totalesPorCentro, centroPropio: CENTRO_PROPIO }); });
        root().querySelectorAll('[data-acta]').forEach(b => b.addEventListener('click', () => formActaCentro(b.dataset.acta)));
        const ac = q('#soc-acepta'); if (ac) ac.addEventListener('click', formAceptacion);
        root().querySelectorAll('[data-resolver]').forEach(b => b.addEventListener('click', () => formResolver(b.dataset.resolver)));
        q('#soc-guardar-nota').addEventListener('click', guardarNota);
        const m = q('#soc-multa'); if (m) m.addEventListener('click', formMulta);
        const c = q('#soc-cerrar'); if (c) c.addEventListener('click', alternarCierre);
        const cf = q('#soc-config'); if (cf) cf.addEventListener('click', formConfig);
        pintarDestinatarios(); pintarBitacora();
    }

    /** Banner con el siguiente paso según el estado de la orden. */
    /** El título de la ruta superior ("Seguimiento de OC") vuelve a la lista cuando hay una ficha abierta. */
    function marcarMigas(on) { const bc = document.getElementById('erp-breadcrumb-current'); if (bc) { bc.classList.toggle('soc-bc-link', !!on); bc.title = on ? 'Volver a la lista de órdenes' : ''; } }
    document.addEventListener('click', (e) => { if (ocActual && e.target.closest && e.target.closest('#erp-breadcrumb-current.soc-bc-link')) { ocActual = null; pintarLista(); } });
    const hayRecibido = (oc) => (oc.lineas || []).some(l => Object.values(l.recibido || {}).some(v => num(v) > 0));
    function bannerSiguiente(oc, pl) {
        if (oc.cerrada) return '';
        const pend = pendientesDe(oc).filter(x => x.pendiente > 0).length > 0, hayStock = (oc.lineas || []).some(l => Object.keys(l.ingresado || {}).some(k => num(l.ingresado[k]) > num(l.entregado && l.entregado[k])));
        const B = (id, t, pri, go) => `<button type="button" class="btn ${pri ? 'btn-primary' : 'btn-outline'} btn-sm" id="${id}"${go ? ` data-go="${go}"` : ''}>${esc(t)}</button>`;
        let txt, btns;
        if (pend) {
            txt = hayRecibido(oc) ? 'Falta mercadería por recibir. Regístrala cuando llegue, o envía la recepción conforme parcial.' : 'Siguiente paso: cuando llegue la mercadería, regístrala (puedes hacerlo por partes). La aceptación del proveedor es opcional.';
            btns = B('soc-recep', hayRecibido(oc) ? 'Recibir lo que falta' : 'Recibir mercadería', true) + (hayRecibido(oc) && !oc.recepcionConforme ? B('soc-conforme', 'Recepción conforme (parcial)', false) : '');
        } else if (!oc.recepcionConforme) { txt = 'Todo recibido. Siguiente paso: la recepción conforme con la guía o factura.'; btns = B('soc-conforme', 'Recepción conforme', true); }
        else { txt = 'Recepción conforme lista. Ya puedes entregar a los centros desde las actas.'; btns = B('soc-sig', 'Ir a Actas de entrega', true, '#view-actas-entrega'); }
        const extra = hayStock && pend ? ' Lo ya recibido está en Bodega Central y se entrega desde Actas de entrega.' : '';
        if (!oc.aceptada) btns += B('soc-acepta', 'Registrar aceptación', false);
        return `<div class="soc-siguiente"><span>${esc(txt)}${esc(extra)}</span><span class="soc-siguiente__btns">${btns}</span></div>`;
    }
    function memosCDPHTML(oc) {
        const cols = oc.columnas || []; if (!cols.length) return '';
        const hayExtra = cols.some(c => c.financiamiento || c.cdp || c.total);
        const memos = (oc.memos && oc.memos.length) ? oc.memos : [...new Set(cols.map(c => c.memo).filter(Boolean))];
        if (!hayExtra && !memos.length) return '';
        return `<div class="erp-card"><h3>Memos y CDP <span class="soc-n">${memos.length ? 'memo N° ' + esc(memos.join('-')) : ''}</span></h3>
            <div class="soc-tabla"><table><thead><tr><th>Memo</th><th>Centro</th><th>Financiamiento</th><th>CDP</th><th>Neto</th><th>IVA</th><th>Total</th><th>Despacho · contraparte · contacto</th></tr></thead><tbody>${cols.map(c => `<tr><td>${esc(c.memo)}</td><td>${esc(c.centro)}</td><td>${esc(c.financiamiento || '—')}</td><td>${esc(c.cdp || '—')}</td><td>${c.neto ? peso(c.neto) : '—'}</td><td>${c.iva ? peso(c.iva) : '—'}</td><td>${c.total ? peso(c.total) : '—'}</td>
                <td><small>${[c.direccion, c.contraparte, [c.contacto, c.correo].filter(Boolean).join(' · '), c.horario].filter(Boolean).map(esc).join('<br>')}</small></td></tr>`).join('')}</tbody></table></div>
            ${oc.descripcion ? `<p class="soc-card__sub">${esc(oc.descripcion)}</p>` : ''}</div>`;
    }
    function entregasHTML(oc) {
        const est = estadoEntregas(oc), cols = oc.columnas || []; if (!est.length || est.every(e => e.centro === CENTRO_PROPIO)) return '';
        const globalPed = est.reduce((t, e) => t + e.pedido, 0), globalEnt = est.reduce((t, e) => t + e.entregado, 0), globalRec = est.reduce((t, e) => t + e.recibido, 0);
        return `<div class="erp-card"><h3>Distribución y entregas por centro <span class="soc-n">${globalEnt} de ${globalPed} entregadas · ${globalRec} recibidas</span></h3>
            ${est.map(e => {
                const c = cols.find(x => x.key === e.key), propio = e.centro === CENTRO_PROPIO;
                return `<div class="soc-entrega"><div class="soc-sub"><strong>${esc(e.centro)}</strong> <small>memo ${esc(e.memo)}${e.cdp ? ' · CDP ' + esc(e.cdp) : ''}</small>
                    <span class="soc-chip soc-chip--${e.estado === 'ENTREGADO' ? 'completa' : e.estado === 'SIN_RECIBIR' ? 'en_plazo' : 'cerrada'}">${esc(ETIQ_ENTREGA[e.estado])}</span>
                    ${!propio && e.entregable > 0 ? `<button type="button" class="btn btn-primary btn-sm" data-acta="${esc(e.key)}"><i class="ph-bold ph-file-text"></i> Generar acta (${e.entregable} un.)</button>` : ''}</div>
                    <div class="soc-tabla"><table><thead><tr><th>Producto</th><th>Pedido</th><th>Recibido</th><th>En bodega</th><th>Entregado</th><th>Pendiente</th></tr></thead><tbody>${(oc.lineas || []).map(l => {
                        const p = num(l.dist && l.dist[e.key]); if (!p) return '';
                        const r = num(l.recibido && l.recibido[e.key]), g = num(l.ingresado && l.ingresado[e.key]), en = num(l.entregado && l.entregado[e.key]);
                        return `<tr><td>${esc(l.descripcion)}</td><td>${p}</td><td>${r}</td><td>${Math.max(0, g - en)}</td><td>${en}</td><td class="${p - en > 0 ? 'soc-est--parcial' : 'soc-est--ok'}"><strong>${Math.max(0, p - en)}</strong></td></tr>`; }).join('')}</tbody></table></div></div>`; }).join('')}
            <p class="bodega-estantes__hint">"Recibido" = lo registrado en Recibir mercadería · "En bodega" = ingresado al stock y aún sin entregar · "Entregado" = en actas emitidas desde esta orden. Cada acta descuenta el stock y deja el saldo pendiente actualizado.</p></div>`;
    }
    /** Acta de entrega a un centro con lo que ya llegó a bodega y aún no se entrega. */
    async function formActaCentro(key) {
        const oc = ocActual, c = (oc.columnas || []).find(x => x.key === key); if (!c || !window.SAR_ActasEntrega) { toast('No disponible', 'El módulo de actas no está cargado.', 'warning'); return; }
        let bodegas = [];
        try { const bs = await fs().getDocs(fs().collection(db(), 'Bodegas')); bs.forEach(d => { const b = d.data(); if (b.isActive !== false && b.name) bodegas.push(b.name); }); } catch (e) { /* sin lista */ }
        bodegas.sort((a, b) => (/central/i.test(b) - /central/i.test(a)) || a.localeCompare(b, 'es'));
        if (!bodegas.length) bodegas = ['Bodega Central'];
        const filas = (oc.lineas || []).map((l, i) => ({ i, l, disp: Math.max(0, num(l.ingresado && l.ingresado[key]) - num(l.entregado && l.entregado[key])) })).filter(x => x.disp > 0);
        if (!filas.length) { toast('Nada por entregar', 'No hay unidades en bodega para este centro. Registra la recepción con "Ingresar al stock".', 'warning'); return; }
        modal(`Acta de entrega · ${c.centro} (memo ${c.memo})`, `
            <div class="soc-fila"><label>Bodega de origen<select id="a-bod">${bodegas.map(b => `<option>${esc(b)}</option>`).join('')}</select></label><label>Centro que recibe<input type="text" id="a-centro" value="${esc(c.centro)}"></label></div>
            <div class="soc-fila"><label>Recibe (nombre)<input type="text" id="a-rn" value="${esc(c.contraparte || '')}"></label><label>Cargo<input type="text" id="a-rc"></label></div>
            <div class="soc-tabla"><table><thead><tr><th>Producto</th><th>En bodega</th><th>Entregar ahora</th></tr></thead><tbody>${filas.map(x => `<tr data-i="${x.i}"><td>${esc(x.l.insumoName || x.l.descripcion)}</td><td>${x.disp}</td><td><input type="number" min="0" max="${x.disp}" class="a-c" value="${x.disp}"></td></tr>`).join('')}</tbody></table></div>
            <small>Se emite el acta con el mismo formato de siempre, se descuenta el stock de la bodega (FEFO) y la orden queda con lo entregado y lo pendiente. Si entregas menos, el resto queda para otra acta.</small>`, async (o) => {
            const origen = o.querySelector('#a-bod').value, items = [];
            for (const tr of o.querySelectorAll('tr[data-i]')) {
                const i = Number(tr.dataset.i), cant = num(tr.querySelector('.a-c').value), l = oc.lineas[i], x = filas.find(f => f.i === i);
                if (cant > x.disp) { toast('Cantidad inválida', `${l.descripcion}: máximo ${x.disp}.`, 'warning'); return false; }
                if (cant > 0) {
                    const nombre = String(l.insumoName || l.descripcion).trim(); let id = null;
                    const q = await fs().getDocs(fs().query(fs().collection(db(), 'Insumos'), fs().where('name', '==', nombre), fs().limit(10)));
                    q.forEach(d => { if (!id && d.data().location === origen) id = d.id; });
                    if (!id) { const t = await fs().getDoc(fs().doc(db(), 'Insumos', `tras_${slug(nombre)}__${slug(origen)}`)); if (t.exists()) id = t.id; }
                    items.push(id ? { id, nombre, cantidad: cant, ocI: i } : { manual: true, nombre, cantidad: cant, ocI: i });
                }
            }
            if (!items.length) { toast('Sin cantidades', 'Indica cuántas unidades se entregan.', 'warning'); return false; }
            const A = window.SAR_ActasEntrega, borrador = { origen, centro: o.querySelector('#a-centro').value.trim(), items, pendientes: [], documentos: [{ tipo: 'OC', numero: oc.numeroOC, detalle: `memo ${c.memo}` }], recibe: { nombre: o.querySelector('#a-rn').value.trim(), cargo: o.querySelector('#a-rc').value.trim() }, oc: { id: oc.id, numeroOC: oc.numeroOC, key, memo: c.memo, cdp: c.cdp } };
            const err = A.validarBorrador(borrador); if (err.length) { toast('Revisa el acta', err[0], 'warning'); return false; }
            const total = items.reduce((t, x) => t + x.cantidad, 0);
            if (!(await confirmar('Emitir acta', `Se emitirá el acta para ${borrador.centro} (${total} unidades) y se descontará de ${origen}.`, 'Emitir acta'))) return false;
            const acta = await A.emitir(borrador, usuario());
            toast('Acta emitida', `${acta.numero} · stock descontado y orden actualizada.`, 'success');
            try { await A.descargarActa(acta, 'pdf'); } catch (e) { toast('Descarga', 'El acta se emitió; descárgala desde "Actas emitidas": ' + e.message, 'warning'); }
        });
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

    const DESTINO_RECEPCION = ['mariel.quintanilla@cormumel.cl', 'compras.sar@cormumel.cl', 'matias.bustos@cormumel.cl'];   // correo de cada recepción: siempre estos tres
    const ICONOS = { LOTE: 'Lote y vencimiento', CONFORME: 'Recepción conforme', INCIDENCIA: 'Incidencia', ACEPTACION: 'Aceptación', NOTA: 'Nota', RECEPCION: 'Recepción', MULTA: 'Multa', ESTADO: 'Estado', CREACION: 'Ingreso' };
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

    /** Aviso de confirmación con la identidad visual del sitio (reemplaza window.confirm). */
    function confirmar(titulo, texto, ok) {
        return new Promise((res) => {
            const ov = document.createElement('div'); ov.className = 'cierre-overlay';
            ov.innerHTML = `<div class="cierre-box cierre-box--aviso" role="alertdialog" aria-modal="true" aria-label="${esc(titulo)}"><h3>${esc(titulo)}</h3><p class="cierre-hint" style="white-space:pre-line">${esc(texto)}</p><div class="cierre-acciones"><button type="button" class="btn btn-outline" data-x>Cancelar</button><button type="button" class="btn btn-primary" data-ok>${esc(ok || 'Aceptar')}</button></div></div>`;
            document.body.appendChild(ov);
            const fin = (v) => { ov.remove(); res(v); };
            ov.querySelector('[data-x]').addEventListener('click', () => fin(false));
            ov.querySelector('[data-ok]').addEventListener('click', () => fin(true));
            ov.addEventListener('click', (e) => { if (e.target === ov) fin(false); });
            ov.querySelector('[data-ok]').focus();
        });
    }

    // --- ventanas de formulario simples ---
    function modal(titulo, html, onListo, opts) {
        opts = opts || {};
        const ov = document.createElement('div'); ov.className = 'cierre-overlay';
        ov.innerHTML = `<div class="cierre-box${opts.ancho ? ' cierre-box--ancho' : ''}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}"><h3>${esc(titulo)}</h3>${html}<div class="cierre-acciones"><button type="button" class="btn btn-outline" data-x>Cancelar</button><button type="button" class="btn btn-primary" data-ok>${esc(opts.ok || 'Guardar')}</button></div></div>`;
        document.body.appendChild(ov);
        const cerrar = () => ov.remove();
        ov.querySelector('[data-x]').addEventListener('click', cerrar);
        ov.querySelector('[data-ok]').addEventListener('click', async (e) => { e.target.disabled = true; try { const r = await onListo(ov); if (r !== false) cerrar(); else e.target.disabled = false; } catch (err) { toast('Error', (err.code || '') + ' ' + err.message, 'error'); e.target.disabled = false; } });
        return ov;
    }

    /** Unidades ingresadas al stock sin lote/vencimiento, aún por completar (recepciones menos asignaciones ya hechas). */
    function lotesPendientes(oc, evs) {
        const m = new Map();
        const k = (i, desc) => `${i}|${desc}`;
        evs.filter(e => e.tipo === 'RECEPCION' && e.ingresoAStock).forEach(e => (e.detalle || []).forEach(d => {
            if (d.lote || d.vence) return;
            const nombre = d.insumoName || ((oc.lineas || []).find(l => l.descripcion === d.descripcion) || {}).insumoName || d.descripcion;
            const key = k(nombre, d.descripcion), x = m.get(key) || { insumoName: nombre, descripcion: d.descripcion, cantidad: 0 };
            x.cantidad += num(d.cantidad); m.set(key, x);
        }));
        evs.filter(e => e.tipo === 'LOTE').forEach(e => (e.detalle || []).forEach(d => {
            const x = m.get(k(d.insumoName, d.descripcion)); if (x) x.cantidad -= num(d.cantidad);
        }));
        return [...m.values()].filter(x => x.cantidad > 0);
    }
    async function formLotes() {
        const oc = ocActual, pend = lotesPendientes(oc, eventos);
        if (!pend.length) { toast('Todo al día', 'No hay unidades recibidas sin lote o vencimiento.', 'info'); return; }
        const ov = modal('Lotes y vencimientos', `<p class="cierre-hint">Completa el lote y el vencimiento de lo que ya ingresó al stock. Puedes asignar solo una parte de las unidades.</p>
            <div class="soc-tabla"><table><thead><tr><th>Producto</th><th>Sin lote</th><th>Unidades</th><th>Lote</th><th>Vence</th></tr></thead><tbody>${pend.map((x, n) => `<tr data-n="${n}"><td>${esc(x.insumoName)}</td><td>${x.cantidad}</td><td><input type="number" class="l-c" min="0" max="${x.cantidad}" value="${x.cantidad}" aria-label="Unidades"></td><td><input class="l-l" placeholder="Lote" aria-label="Lote"></td><td><input type="date" class="l-v" aria-label="Vencimiento"></td></tr>`).join('')}</tbody></table></div>`, async (o) => {
            const cambios = [];
            o.querySelectorAll('tr[data-n]').forEach(tr => {
                const x = pend[+tr.dataset.n], c = num(tr.querySelector('.l-c').value), l = tr.querySelector('.l-l').value.trim().toUpperCase(), v = tr.querySelector('.l-v').value;
                if (c > 0 && (l || v)) cambios.push({ ...x, asignar: c, lote: l || 'S/L', vence: v || 'N/A' });
            });
            if (!cambios.length) { toast('Sin cambios', 'Indica lote o vencimiento en al menos una fila.', 'warning'); return false; }
            if (cambios.some(c => !Number.isInteger(c.asignar) || c.asignar > c.cantidad)) { toast('Cantidad no válida', 'Las unidades deben ser enteras y no superar las que no tienen lote.', 'warning'); return false; }
            if (cambios.some(c => c.vence !== 'N/A' && c.vence < hoyISO())) { toast('Vencimiento pasado', 'Hay una fecha anterior a hoy. Revísala.', 'warning'); return false; }
            await asignarLotes(oc, cambios);
            toast('Lotes actualizados', 'El stock quedó con los lotes y vencimientos indicados.', 'success');
        }, { ancho: true, ok: 'Guardar' });
        return ov;
    }
    async function asignarLotes(oc, cambios) {
        const f = fs(); let central = 'Bodega Central';
        const bs = await f.getDocs(f.collection(db(), 'Bodegas')); bs.forEach(d => { const b = d.data(); if (/central/i.test(String(b.name || '')) && b.isActive !== false) central = b.name; });
        const refs = [];
        for (const c of cambios) {
            const snap = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('name', '==', c.insumoName), f.limit(10)));
            let ref = null; snap.forEach(x => { const l = x.data().location; if (!ref && (l === central || !l)) ref = f.doc(f.collection(db(), 'Insumos'), x.id); });
            if (!ref) throw new Error(`No se encontró "${c.insumoName}" en ${central}.`);
            refs.push(ref);
        }
        await f.runTransaction(db(), async (tx) => {
            const docs = new Map();
            for (const r of refs) if (!docs.has(r.path)) docs.set(r.path, { ref: r, data: (await tx.get(r)).data() });
            cambios.forEach((c, n) => {
                const d = docs.get(refs[n].path), lotes = (Array.isArray(d.data.batches) ? d.data.batches : []).map(b => ({ ...b }));
                const sin = lotes.find(b => (b.batch || 'S/L') === 'S/L' && (b.expirationDate || 'N/A') === 'N/A');
                if (!sin || num(sin.quantity) < c.asignar) throw new Error(`"${c.insumoName}": ya no hay ${c.asignar} unidades sin lote en el stock.`);
                sin.quantity = num(sin.quantity) - c.asignar;
                const ex = lotes.find(b => b.batch === c.lote && (b.expirationDate || 'N/A') === c.vence);
                if (ex) ex.quantity = num(ex.quantity) + c.asignar; else lotes.push({ batch: c.lote, quantity: c.asignar, expirationDate: c.vence });
                d.data.batches = lotes.filter(b => num(b.quantity) > 0);
            });
            docs.forEach(d => { const b = d.data.batches; if (typeof window.fefoCompare === 'function') b.sort(window.fefoCompare); const prox = b[0]; tx.update(d.ref, { batches: b, batch: prox ? prox.batch : '', expirationDate: prox ? prox.expirationDate : 'N/A' }); });
        });
        await registrarEvento(oc, { tipo: 'LOTE', texto: 'Lote/vencimiento asignado:\n' + cambios.map(c => `- ${c.insumoName}: ${c.asignar} un. · lote ${c.lote} · vence ${c.vence === 'N/A' ? 's/v' : fmtFecha(c.vence)}`).join('\n'), extra: { detalle: cambios.map(c => ({ insumoName: c.insumoName, descripcion: c.descripcion, cantidad: c.asignar, lote: c.lote, vence: c.vence })) } });
    }

    function formNueva() {
        let cuadro = null;
        const ov = modal('Ingresar orden de compra (cuadro Excel)', `
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

    // ---------------------------------------------------------------
    // Ingreso de una OC desde el PDF de Mercado Público (con pantalla de revisión)
    // ---------------------------------------------------------------
    const sumarDias = (iso, n) => { const d = deISO(iso); d.setDate(d.getDate() + n); return aISO(d); };
    const memosDe = (v) => (String(v.memo || '').trim() ? String(v.memo).split(/\s*[-,/y]\s*/).filter(Boolean) : (v.memos || []));
    function armarOCdesdeRevision(v) {
        const numero = String(v.numeroOC || '').trim().toUpperCase();
        if (!numero) throw new Error('Falta el N° de la orden.');
        if (!v.emitida) throw new Error('Falta la fecha de envío de la orden.');
        const lineas = (v.lineas || []).filter(l => String(l.descripcion || '').trim() && num(l.cantidad) > 0);
        if (!lineas.length) throw new Error('Agrega al menos un producto con cantidad.');
        const horas = num(v.aceptarHoras) || 48, dias = num(v.entregaDias) || 2;
        // cuadro por centro tomado de la compra ágil: solo si calza con las líneas (misma cantidad)
        let cuadro0 = v.cuadro;
        if (v.distrib && window.SAR_Lector) {           // cuadro de distribución en PDF (v20.55): manda sobre la compra ágil
            const u = window.SAR_Lector.unirDistribucion({ lineas, memos: memosDe(v) }, v.distrib);
            cuadro0 = { columnas: u.columnas, dist: u.dist, compra: v.cuadro && v.cuadro.compra, desdePDF: true };
        }
        const cuadro = (cuadro0 && cuadro0.dist && cuadro0.dist.length === lineas.length
            && lineas.every((l, i) => Object.values(cuadro0.dist[i] || {}).reduce((t, x) => t + num(x), 0) === num(l.cantidad))) ? cuadro0 : null;
        if (v.distrib && !cuadro) throw new Error('El cuadro de distribución no calza con los productos de la orden (revisa los avisos). Corrige las cantidades o quita el cuadro.');
        const propia = cuadro && cuadro.columnas ? cuadro.columnas.find(c => c.centro === CENTRO_PROPIO) : null;
        // v20.65: del cuadro solo importa lo que dice SAR; lo de otros centros se omite (queda anotado cuáles).
        let cuadroF = cuadro; const otrosCentros = [];
        if (cuadro && propia && cuadro.columnas.length > 1) {
            cuadro.columnas.filter(c => c !== propia).forEach(c => otrosCentros.push({ centro: c.centro, memo: c.memo }));
            cuadroF = { ...cuadro, columnas: [propia], dist: cuadro.dist.map(d => (propia.key in d ? { [propia.key]: d[propia.key] } : {})) };
        }
        return {
            numeroOC: numero, proveedor: String(v.proveedor || '').trim(), rutProveedor: String(v.rutProveedor || '').trim(), descripcion: String(v.descripcion || '').trim(),
            emitida: v.emitida, emitidaHora: v.emitidaHora || '', aceptarHoras: horas, aceptarLimite: sumarDias(v.emitida, Math.ceil(horas / 24)), aceptada: '',
            plazoDiasHabiles: dias, fechaLimite: '', origen: v.origen || 'MANUAL',
            columnas: cuadroF ? cuadroF.columnas : [{ memo: String(v.memo || '').trim() || 's/n', centro: CENTRO_PROPIO, cdp: '', key: 'sar' }],
            lineas: lineas.map((l, i) => ({ descripcion: String(l.descripcion).trim(), codigoMP: l.codigoMP || '', licitacion: l.licitacion || '', valorNeto: num(l.valorNeto), dist: cuadroF ? { ...cuadroF.dist[i] } : { sar: num(l.cantidad) }, recibido: {}, entregado: {}, ingresado: {} })),
            ...(cuadroF && cuadroF.compra ? { compraAgil: cuadroF.compra } : {}),
            ...(cuadroF && cuadroF.desdePDF ? { distribucionPDF: true } : {}),
            ...(otrosCentros.length ? { otrosCentros } : {}),
            memos: memosDe(v),
            datos: { direccionDespacho: v.direccionDespacho || (propia && propia.direccion) || '', contraparte: v.contraparte || (propia && propia.contraparte) || '', contacto: v.contacto || (propia && propia.contacto) || '', horario: v.horario || (propia && propia.horario) || '', formaPago: v.formaPago || '', emailFactura: v.emailFactura || '', memo: v.memo || '', total: num(v.total), totalNeto: num(v.totalNeto) },
            incidencias: [], multa: { estado: 'por_evaluar' }, cerrada: false
        };
    }
    function formDesdePDF() {
        let rev = { lineas: [], aceptarHoras: 48, entregaDias: 2, origen: 'MANUAL' };
        const campo = (id, et, v, tipo) => `<label>${et}<input type="${tipo || 'text'}" id="${id}" value="${esc(v == null ? '' : v)}"></label>`;
        const ov = modal('Ingresar orden de compra', `
            <label>PDF de la orden (Mercado Público)<input type="file" id="p-file" accept="application/pdf"></label>
            <label>Cuadro de distribución (PDF, opcional): lee memos, CDP, cantidades por centro y montos<input type="file" id="p-dist" accept="application/pdf"></label>
            <div id="p-dist-est" class="cierre-hint"></div>
            <label>Correo del despacho (opcional: pega el texto para leer los plazos)<textarea id="p-correo" rows="3" placeholder="Pega aquí el correo con el plazo de aceptación y los días de entrega"></textarea></label>
            <div id="p-estado" class="cierre-hint">Sube el PDF y revisa lo que se leyó. También puedes completar todo a mano.</div>
            <div id="p-rev"></div>`, async (o) => {
            leerRev(o);
            let usoCuadro = null;
            if (window.SAR_ComprasAgiles && String(rev.numeroOC || '').trim() && !rev.distrib) {
                rev.cuadro = null;
                const r = await window.SAR_ComprasAgiles.cuadroParaOC(String(rev.numeroOC).trim().toUpperCase(), rev.lineas.filter(l => String(l.descripcion || '').trim() && num(l.cantidad) > 0));
                if (r && !r.error) { rev.cuadro = r; usoCuadro = r; } else if (r && r.error && r.error !== 'sin compra ágil') toast('Cuadro por centro', `No se usó el de la compra ágil ${r.compra}: ${r.error} Se ingresó todo al SAR; revisa el cuadro.`, 'warning');
            }
            const oc = armarOCdesdeRevision(rev);
            const id = slug(oc.numeroOC), ref = fs().doc(fs().collection(db(), 'Seguimiento_OC'), id);
            if ((await fs().getDoc(ref)).exists()) { toast('Ya existe', 'Esa orden ya está en seguimiento.', 'warning'); return false; }
            if (window.SAR_CDP) {                       // presupuesto CDP (opcional): avisa si esta orden lo sobregira
                const al = await window.SAR_CDP.alertaNuevaOC({ ...oc, id }, lista);
                if (al.length && !(await confirmar('Atención con el presupuesto', al.join('\n') + '\n\n¿Ingresar la orden de todos modos?', 'Ingresar igual'))) return false;
            }
            oc.destinatarios = [...(configCorreo.destinatariosBase || [])]; oc.creadoPor = usuario(); oc.creadoEn = fs().serverTimestamp();
            await fs().runTransaction(db(), async (tx) => {
                tx.set(ref, oc);
                tx.set(fs().doc(fs().collection(db(), 'Seguimiento_OC', id, 'Eventos')), { tipo: 'CREACION', texto: `Orden ingresada${oc.origen === 'OC_MP' ? ' desde el PDF' : ''}: ${oc.lineas.length} producto(s). El proveedor debe aceptarla hasta el ${fmtFecha(oc.aceptarLimite)}; entrega en ${oc.plazoDiasHabiles} días hábiles desde la aceptación.`, autor: usuario(), fecha: fs().serverTimestamp() });
            });
            if (usoCuadro) window.SAR_ComprasAgiles.vincularOC(usoCuadro.id, oc.numeroOC);
            abrirCuando(id);
            toast('Orden ingresada', `Acepta hasta el ${fmtFecha(oc.aceptarLimite)}.${oc.distribucionPDF ? ' Distribución por centro leída del PDF.' : ''}${usoCuadro && !oc.distribucionPDF ? ' Cuadro por centro tomado de la compra ágil ' + usoCuadro.compra + '.' : ''}`, 'success');
        }, { ok: 'Ingresar orden' });
        const q = (s) => ov.querySelector(s);
        function leerRev(o) {
            const g = (id) => { const e = o.querySelector('#' + id); return e ? e.value : ''; };
            ['numeroOC', 'proveedor', 'rutProveedor', 'emitida', 'emitidaHora', 'aceptarHoras', 'entregaDias', 'memo', 'descripcion', 'direccionDespacho', 'contraparte', 'contacto', 'horario', 'formaPago', 'emailFactura'].forEach(k => { if (o.querySelector('#v-' + k)) rev[k] = g('v-' + k); });
            rev.lineas = [...o.querySelectorAll('[data-fila]')].map(tr => ({ ...(rev.lineas[Number(tr.dataset.fila)] || {}), descripcion: tr.querySelector('.v-d').value, cantidad: num(tr.querySelector('.v-c').value), valorNeto: num(tr.querySelector('.v-v').value) }));
        }
        function pintarRev(avisos) {
            q('#p-rev').innerHTML = `${(avisos || []).length ? '<ul class="cierre-error">' + avisos.map(a => `<li>${esc(a)}</li>`).join('') + '</ul>' : ''}
                <div class="soc-fila">${campo('v-numeroOC', 'N° de orden', rev.numeroOC)}${campo('v-proveedor', 'Proveedor', rev.proveedor)}${campo('v-rutProveedor', 'RUT proveedor', rev.rutProveedor)}</div>
                <div class="soc-fila">${campo('v-emitida', 'Orden enviada el', rev.emitida, 'date')}${campo('v-emitidaHora', 'Hora', rev.emitidaHora, 'time')}${campo('v-aceptarHoras', 'Plazo para aceptar (horas)', rev.aceptarHoras, 'number')}${campo('v-entregaDias', 'Entrega (días hábiles desde aceptación)', rev.entregaDias, 'number')}</div>
                <div class="soc-fila">${campo('v-memo', 'Memo N°', rev.memo)}${campo('v-descripcion', 'Descripción', rev.descripcion)}</div>
                <div class="soc-fila">${campo('v-direccionDespacho', 'Dirección de despacho', rev.direccionDespacho)}${campo('v-contraparte', 'Contraparte técnica', rev.contraparte)}</div>
                <div class="soc-fila">${campo('v-contacto', 'Contacto', rev.contacto)}${campo('v-horario', 'Horario de recepción', rev.horario)}</div>
                <div class="soc-fila">${campo('v-formaPago', 'Forma de pago', rev.formaPago)}${campo('v-emailFactura', 'Email envío factura', rev.emailFactura)}</div>
                <div class="soc-tabla"><table><thead><tr><th>Producto</th><th>Cant.</th><th>Neto unit.</th><th></th></tr></thead><tbody>${rev.lineas.map((l, i) => `<tr data-fila="${i}"><td><input class="v-d" value="${esc(l.descripcion || '')}"></td><td><input class="v-c" type="number" min="0" value="${esc(l.cantidad || '')}"></td><td><input class="v-v" type="number" min="0" value="${esc(l.valorNeto || '')}"></td><td><button type="button" class="btn btn-outline btn-sm" data-del="${i}">✕</button></td></tr>`).join('')}</tbody></table></div>
                <button type="button" class="btn btn-outline btn-sm" id="v-add">+ Producto</button>${rev.totalNeto ? ` <small>Neto de la orden: ${peso(rev.totalNeto)} · Total con IVA: ${peso(rev.total)}</small>` : ''}`;
            q('#v-add').addEventListener('click', () => { leerRev(ov); rev.lineas.push({ descripcion: '', cantidad: 0, valorNeto: 0 }); pintarRev(avisos); });
            ov.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { leerRev(ov); rev.lineas.splice(Number(b.dataset.del), 1); pintarRev(avisos); }));
        }
        pintarRev([]);
        q('#p-file').addEventListener('change', async (e) => {
            const f = e.target.files[0]; if (!f) return;
            const est = q('#p-estado'); est.textContent = 'Leyendo el PDF…';
            try {
                if (!window.SAR_Lector) throw new Error('El lector de documentos no está cargado.');
                const r = await window.SAR_Lector.leerArchivo(f);
                const c = window.SAR_Lector.extraerCorreo(q('#p-correo').value);
                rev = { ...rev, ...r, aceptarHoras: c.aceptarHoras || rev.aceptarHoras || 48, entregaDias: c.entregaDias || rev.entregaDias || 2, contraparte: c.contraparte || r.contraparte, horario: c.horario || r.horario, origen: 'OC_MP' };
                est.innerHTML = `<strong>Leído:</strong> ${esc(r.numeroOC || '—')} · ${r.lineas.length} producto(s). Revisa cada dato antes de guardar.`;
                pintarRev(r.avisos);
            } catch (err) { est.innerHTML = `<span class="cierre-error">${esc(err.message)}</span>`; }
        });
        q('#p-dist').addEventListener('change', async (e) => {
            const f = e.target.files[0], est = q('#p-dist-est'); rev.distrib = null; if (!f) { est.textContent = ''; return; }
            est.textContent = 'Leyendo el cuadro…';
            try {
                if (!window.SAR_Lector) throw new Error('El lector de documentos no está cargado.');
                leerRev(ov);
                const d = await window.SAR_Lector.leerDistribucion(f); rev.distrib = d;
                const lineasOk = rev.lineas.filter(l => String(l.descripcion || '').trim() && num(l.cantidad) > 0);
                const u = lineasOk.length ? window.SAR_Lector.unirDistribucion({ lineas: lineasOk, memos: memosDe(rev) }, d) : { avisos: ['Sube primero el PDF de la orden para cruzar los productos.'] };
                const av = [...d.avisos, ...u.avisos];
                est.innerHTML = `<strong>Cuadro leído:</strong> ${d.columnas.length} columna(s) · ${d.lineas.length} producto(s)
                    <div class="soc-tabla"><table><thead><tr><th>Memo</th><th>Centro</th><th>Financiamiento</th><th>CDP</th><th>Neto</th><th>Total</th></tr></thead><tbody>${d.columnas.map(c => `<tr><td>${esc(c.memo)}</td><td>${esc(c.centro)}</td><td>${esc(c.financiamiento)}</td><td>${esc(c.cdp)}</td><td>${peso(c.neto)}</td><td>${peso(c.total)}</td></tr>`).join('')}</tbody></table></div>
                    ${av.length ? '<ul class="cierre-error">' + av.map(a => `<li>${esc(a)}</li>`).join('') + '</ul>' : ''}`;
            } catch (err) { rev.distrib = null; est.innerHTML = `<span class="cierre-error">${esc(err.message)}</span>`; }
        });
        q('#p-correo').addEventListener('change', () => { const c = window.SAR_Lector && window.SAR_Lector.extraerCorreo(q('#p-correo').value); if (!c) return; leerRev(ov); if (c.aceptarHoras) rev.aceptarHoras = c.aceptarHoras; if (c.entregaDias) rev.entregaDias = c.entregaDias; if (c.contraparte && !rev.contraparte) rev.contraparte = c.contraparte; if (c.horario && !rev.horario) rev.horario = c.horario; pintarRev([]); });
    }

    function formAceptacion() {
        const oc = ocActual;
        modal('Registrar aceptación del proveedor', `<p class="cierre-hint">Desde la fecha de aceptación corren los ${num(oc.plazoDiasHabiles) || 5} días hábiles de entrega.</p>
            <label>Fecha de aceptación<input type="date" id="a-fecha" value="${hoyISO()}"></label>
            <label class="soc-toggle"><input type="checkbox" id="a-correo" checked> Avisar por correo a la lista</label>`, async (o) => {
            const f = o.querySelector('#a-fecha').value; if (!f) { toast('Falta la fecha', 'Indica la fecha de aceptación.', 'warning'); return false; }
            const limite = sumarHabiles(f, num(oc.plazoDiasHabiles) || 5);
            await registrarEvento(oc, { tipo: 'ACEPTACION', texto: `El proveedor aceptó la orden el ${fmtFecha(f)}. Plazo de entrega: ${num(oc.plazoDiasHabiles) || 5} días hábiles, hasta el ${fmtFecha(limite)}.`, titulo: 'Orden aceptada', notificar: o.querySelector('#a-correo').checked, cambiosOC: { aceptada: f, fechaLimite: limite } });
            toast('Aceptación registrada', `Entrega hasta el ${fmtFecha(limite)}.`, 'success');
        });
    }

    function formResolver(idInc) {
        const oc = ocActual, inc = (oc.incidencias || []).find(i => i.id === idInc); if (!inc) return;
        modal('Resolver incidencia', `<p class="cierre-hint">${esc(INCIDENCIAS[inc.tipo] || inc.tipo)} — ${esc(inc.producto)}${inc.detalle ? ': ' + esc(inc.detalle) : ''}</p>
            <label>¿Cómo se resolvió? (obligatorio)<input type="text" id="x-res" maxlength="300" placeholder="Ej.: proveedor repuso 2 cajas el 10-11"></label>
            <label class="soc-toggle"><input type="checkbox" id="x-correo" checked> Avisar por correo a la lista</label>`, async (o) => {
            const res = o.querySelector('#x-res').value.trim(); if (!res) { toast('Falta la resolución', 'Escribe cómo se resolvió.', 'warning'); return false; }
            await registrarEvento(oc, { tipo: 'INCIDENCIA', texto: `Incidencia resuelta — ${inc.producto}: ${res}`, titulo: 'Incidencia resuelta', notificar: o.querySelector('#x-correo').checked,
                cambiosOC: (d) => ({ incidencias: (d.incidencias || []).map(i => i.id === idInc ? { ...i, estado: 'RESUELTA', resolucion: res, resueltaPor: usuario(), resueltaEn: hoyISO() } : i) }) });
            toast('Incidencia resuelta', 'Quedó registrada en la bitácora.', 'success');
        });
    }

    // ---------------------------------------------------------------
    // Recepción: lo recibido, incidencias y (opcional) ingreso al stock de Bodega Central
    // ---------------------------------------------------------------
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    /** Suma lotes recibidos a un doc de Insumos (mismo lote y vencimiento se acumulan). Puro. */
    function mezclarIngreso(doc, ingresos) {
        let lotes = Array.isArray(doc && doc.batches) ? doc.batches.map(b => ({ ...b })) : [];
        if (!lotes.length && doc && num(doc.quantity) > 0) lotes = [{ batch: doc.batch || 'S/L', quantity: num(doc.quantity), expirationDate: doc.expirationDate || 'N/A' }];
        let total = 0;
        ingresos.forEach(g => {
            total += g.cantidad;
            const ex = lotes.find(b => b.batch === g.lote && (b.expirationDate || 'N/A') === g.vence);
            if (ex) ex.quantity = num(ex.quantity) + g.cantidad; else lotes.push({ batch: g.lote, quantity: g.cantidad, expirationDate: g.vence });
        });
        if (typeof window.fefoCompare === 'function') lotes.sort(window.fefoCompare);
        return { batches: lotes, quantity: num(doc && doc.quantity) + total, ingresado: total };
    }
    /** Aplica lo recibido a las líneas de la OC. Puro. */
    function aplicarRecepcion(data, key, det, incidencias, extra, ingresaStock) {
        const lineas = (data.lineas || []).map(l => ({ ...l, recibido: { ...(l.recibido || {}) }, ingresado: { ...(l.ingresado || {}) }, entregado: { ...(l.entregado || {}) } }));
        det.forEach(d => { const l = lineas[d.i]; l.recibido[key] = num(l.recibido[key]) + d.cantidad; if (ingresaStock) l.ingresado[key] = num(l.ingresado[key]) + d.cantidad; if (d.insumoName) l.insumoName = d.insumoName; });
        return { lineas, incidencias: [...(data.incidencias || []), ...incidencias.map((n, k) => ({ id: `inc-${Date.now()}-${k}`, ...n, estado: 'ABIERTA', fecha: hoyISO(), ...(extra || {}) }))] };
    }
    async function recepcionConStock(oc, { recId, hora, key, det, incidencias, guia, fecha, obs, notificar, ingresaStock, central, texto, titulo }) {
        const f = fs();
        const aplicadoLocal = aplicarRecepcion(oc, key, det, incidencias, null, ingresaStock);
        let correo = null;
        const ocRef = f.doc(f.collection(db(), 'Seguimiento_OC'), oc.id);
        const evRef = f.doc(f.collection(db(), 'Seguimiento_OC', oc.id, 'Eventos'));
        // Productos del inventario (Bodega Central): se buscan por nombre antes de la transacción
        const grupos = new Map();
        if (ingresaStock) {
            for (const d of det) {
                const nombre = String(d.insumoName || '').trim(); if (!nombre) throw new Error('Indica el producto del inventario de cada línea recibida.');
                const snap = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('name', '==', nombre), f.limit(10)));
                let ref = null; snap.forEach(x => { const l = x.data().location; if (!ref && (l === central || !l)) ref = f.doc(f.collection(db(), 'Insumos'), x.id); });
                if (!ref) ref = f.doc(f.collection(db(), 'Insumos'), `tras_${slug(nombre)}__${slug(central)}`);
                const g = grupos.get(ref.path) || { ref, nombre, ingresos: [], lineas: [] };
                g.ingresos.push({ cantidad: d.cantidad, lote: (d.lote || '').trim().toUpperCase() || 'S/L', vence: d.vence || 'N/A' }); g.lineas.push(d); grupos.set(ref.path, g);
            }
        }
        await f.runTransaction(db(), async (tx) => {
            const os = await tx.get(ocRef); if (!os.exists()) throw new Error('La orden ya no existe.');
            const lecturas = []; for (const g of grupos.values()) lecturas.push([g, await tx.get(g.ref)]);
            const fresca = os.data();
            det.forEach(d => { const l = (fresca.lineas || [])[d.i] || {}, pe = num(l.dist && l.dist[key]) - num(l.recibido && l.recibido[key]); if (d.cantidad > Math.max(0, pe)) throw new Error(`"${String(l.descripcion || '').slice(0, 40)}": solo quedan ${Math.max(0, pe)} por recibir (otra recepción se registró antes). Cierra y vuelve a abrir.`); });
            tx.update(ocRef, { ...aplicarRecepcion(fresca, key, det, incidencias, null, ingresaStock), ...(guia ? { ultimaGuia: guia } : {}), ultimaRecepcion: fecha, recepciones: [...(fresca.recepciones || []), { recId, fecha, hora, guia: guia || '', columna: key, usuario: usuario(), unidades: det.reduce((t, d) => t + d.cantidad, 0), detalle: det.map(d => ({ descripcion: oc.lineas[d.i].descripcion, cantidad: d.cantidad })) }], actualizadoEn: f.serverTimestamp() });
            tx.set(evRef, { tipo: 'RECEPCION', texto, autor: usuario(), fecha: f.serverTimestamp(), ...(correo ? { correo } : {}), columna: key, guia, recId, horaLlegada: hora, fechaRecepcion: fecha, ingresoAStock: !!ingresaStock, detalle: det.map(d => ({ i: d.i, insumoName: d.insumoName || '', descripcion: oc.lineas[d.i].descripcion, cantidad: d.cantidad, lote: d.lote || '', vence: d.vence || '' })), incidencias: incidencias.map(n => ({ producto: n.producto, tipo: n.tipo, detalle: n.detalle })) });
            lecturas.forEach(([g, snap]) => {
                const actual = snap.exists() ? snap.data() : null, m = mezclarIngreso(actual, g.ingresos);
                const limite = num(actual && (actual.criticalLimit || actual.stock_minimo)) || 50;
                const prox = m.batches[0];
                const base = { quantity: m.quantity, batches: m.batches, isCritical: m.quantity <= limite, batch: prox ? prox.batch : '', expirationDate: prox ? prox.expirationDate : 'N/A', provider: oc.proveedor || (actual && actual.provider) || 'S/I', updatedAt: f.serverTimestamp() };
                if (actual) tx.update(g.ref, base); else tx.set(g.ref, { name: g.nombre, name_lowercase: String(g.nombre).toLowerCase(), location: central, criticalLimit: 50, ...base });
                g.ingresos.forEach(ing => tx.set(f.doc(f.collection(db(), 'Historial_Movimientos')), {
                    insumoName: g.nombre, item: g.nombre, quantity: ing.cantidad, type: 'INGRESO_OC', batch: ing.lote, expirationDate: ing.vence, destination: central, dest: central, origin: oc.proveedor || 'Proveedor',
                    provider: oc.proveedor || 'S/I', user: usuario(), date: f.serverTimestamp(), document: `${recId} · OC ${oc.numeroOC}${guia ? ' · guía ' + guia : ''}`, observacion: obs || '', ocId: oc.id, idInsumoDestino: g.ref.id }));
            });
        });
        if (notificar) { try { correo = await enviarCorreo(DESTINO_RECEPCION, armarCorreo({ ...oc, ...aplicadoLocal }, titulo, texto, usuario())); } catch (e) { toast('Recepción guardada', 'No se pudo preparar el correo: ' + e.message, 'warning'); } }
        return correo;
    }

    /** Unidades pendientes de recibir por producto (solo columnas de SAR). Puro. */
    function pendientesDe(oc) {
        const out = [];
        (oc.columnas || []).filter(c => c.centro === CENTRO_PROPIO).forEach(c => (oc.lineas || []).forEach(l => {
            const p = num(l.dist && l.dist[c.key]), r = num(l.recibido && l.recibido[c.key]);
            if (p) out.push({ producto: l.descripcion, codigoMP: l.codigoMP || '', memo: c.memo, pedido: p, recibido: r, pendiente: Math.max(0, p - r), valorNeto: num(l.valorNeto) });
        }));
        return out;
    }
    function descargarPendientes(oc) {
        const filas = pendientesDe(oc).filter(x => x.pendiente > 0), celda = (v) => { const t = String(v == null ? '' : v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        const csv = [[`Pendientes de recibir · OC ${oc.numeroOC} · ${oc.proveedor || ''}`], [], ['Producto', 'Código MP', 'Memo', 'Pedido', 'Recibido', 'Pendiente', 'Neto pendiente']]
            .concat(filas.map(x => [x.producto, x.codigoMP, x.memo, x.pedido, x.recibido, x.pendiente, x.pendiente * x.valorNeto])).concat([[], ['Total unidades pendientes', '', '', '', '', filas.reduce((t, x) => t + x.pendiente, 0)]]);
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv.map(r => r.map(celda).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `Pendientes_${oc.numeroOC}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    async function formRecepcion() {
        const oc = ocActual; const cols = oc.columnas || [];
        let central = 'Bodega Central', nombresInv = [];
        const propia = (key) => { const c = cols.find(x => x.key === key); return !!c && c.centro === CENTRO_PROPIO; };
        const cargaInv = (async () => {
            try {
                const bs = await fs().getDocs(fs().collection(db(), 'Bodegas')); bs.forEach(d => { const b = d.data(); if (/central/i.test(String(b.name || '')) && b.isActive !== false) central = b.name; });
                const ins = await fs().getDocs(fs().query(fs().collection(db(), 'Insumos'), fs().where('location', '==', central), fs().limit(1500)));
                const set = new Set(); ins.forEach(d => { if (d.data().name) set.add(d.data().name); }); nombresInv = [...set].sort((a, b) => a.localeCompare(b, 'es'));
            } catch (e) { /* sin lista de inventario: se escribe a mano */ }
        })();
        const ov = modal('Recibir mercadería', `
            <label${cols.length === 1 ? ' hidden' : ''}>¿Qué memo/CDP se recibió?<select id="r-col">${cols.map(c => `<option value="${esc(c.key)}">${esc(c.centro)} · memo ${esc(c.memo)}${c.cdp ? ' · CDP ' + esc(c.cdp) : ''}</option>`).join('')}</select></label>
            <div class="soc-fila"><label>N° guía de despacho<input type="text" id="r-guia" autocomplete="off"></label><label>Fecha<input type="date" id="r-fecha" value="${hoyISO()}"></label></div>
            <div class="soc-barra-rec"><button type="button" class="btn btn-outline btn-sm" id="r-total"><i class="ph-bold ph-checks"></i> Marcar todo recibido</button><button type="button" class="btn btn-outline btn-sm" id="r-nada">Limpiar</button><span id="r-resumen" class="soc-resumen-rec"></span></div>
            <div id="r-lineas"></div>
            <label class="soc-toggle"><input type="checkbox" id="r-lv"> Anotar lote y vencimiento ahora (también se puede hacer después)</label>
            <label class="soc-toggle" id="r-stock-w"><input type="checkbox" id="r-stock" checked> Ingresar lo recibido al stock de ${esc(central)} (así se descuenta al entregarlo por acta)</label>
            <label>Observación (opcional)<input type="text" id="r-obs" maxlength="300"></label>
            <label class="soc-toggle"><input type="checkbox" id="r-correo" checked> Avisar por correo a la lista</label>
            <datalist id="r-inv">${nombresInv.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`,
            async (o) => {
                const q = (s) => o.querySelector(s), key = q('#r-col').value, ingresaStock = q('#r-stock').checked;
                const det = [], incidencias = [];
                o.querySelectorAll('tr[data-i]').forEach(tr => {
                    const v = num(tr.querySelector('.r-c').value), tipo = tr.querySelector('.r-t').value, i = Number(tr.dataset.i);
                    if (v > 0) { const venc = tr.querySelector('.r-v'); det.push({ i, cantidad: v, lote: tr.querySelector('.r-l') ? tr.querySelector('.r-l').value : '', vence: venc && venc.value ? venc.value : '', insumoName: tr.querySelector('.r-n') ? tr.querySelector('.r-n').value.trim() : '' }); }
                    if (tipo) incidencias.push({ producto: oc.lineas[i].descripcion, tipo, detalle: tr.querySelector('.r-td').value.trim() });
                });
                if (!det.length && !incidencias.length) { toast('Sin datos', 'Indica una cantidad recibida o una incidencia.', 'warning'); return false; }
                const mal = det.find(d => !Number.isInteger(d.cantidad) || d.cantidad > Math.max(0, num(oc.lineas[d.i].dist && oc.lineas[d.i].dist[q('#r-col').value]) - num(oc.lineas[d.i].recibido && oc.lineas[d.i].recibido[q('#r-col').value])));
                if (mal) { toast('Cantidad no válida', `"${String(oc.lineas[mal.i].descripcion).slice(0, 40)}": indica un número entero que no supere lo pendiente.`, 'warning'); return false; }
                const vencida = det.find(d => d.vence && d.vence < hoyISO());
                if (vencida) { toast('Vencimiento pasado', `"${String(oc.lineas[vencida.i].descripcion).slice(0, 40)}" tiene un vencimiento anterior a hoy. Revisa la fecha.`, 'warning'); return false; }
                const col = cols.find(c => c.key === key), guia = q('#r-guia').value.trim(), fecha = q('#r-fecha').value || hoyISO(), obs = q('#r-obs').value.trim();
                if (ingresaStock && det.some(d => !d.insumoName)) { toast('Falta el producto', 'Indica el producto del inventario de cada línea que recibes.', 'warning'); return false; }
                const avisos = [], conoce = new Set(nombresInv.map(norm));
                if (ingresaStock) {
                    const nuevos = det.filter(d => !conoce.has(norm(d.insumoName))).map(d => d.insumoName);
                    if (nuevos.length) avisos.push(`${nuevos.length} producto(s) no existen en el inventario y se crearían como nuevos: ${nuevos.slice(0, 3).join(', ')}${nuevos.length > 3 ? '…' : ''}`);
                    
                }
                const guiaN = q('#r-guia').value.trim();
                if (guiaN && eventos.some(e => e.tipo === 'RECEPCION' && String(e.guia || '') === guiaN)) avisos.push(`la guía N° ${guiaN} ya se registró en esta orden`);
                const firma = avisos.join('|');
                if (avisos.length && o.dataset.aviso !== firma) { o.dataset.aviso = firma; toast('Revisa antes de guardar', avisos.join('. ') + '. Si es correcto, pulsa Guardar recepción otra vez.', 'warning'); return false; }
                const nRec = eventos.filter(e => e.tipo === 'RECEPCION').length + 1, recId = `REC-${String(oc.numeroOC).replace(/[^A-Za-z0-9-]+/g, '')}-${String(nRec).padStart(2, '0')}`, hora = new Date().toTimeString().slice(0, 5);
                const texto = `${recId} · Recepción en ${col.centro}${col.memo ? ' (memo ' + col.memo + (col.cdp ? ', CDP ' + col.cdp : '') + ')' : ''} el ${fmtFecha(fecha)} a las ${hora}${guia ? ' · guía N° ' + guia : ''}:\n` +
                    (det.length ? det.map(d => `- ${oc.lineas[d.i].descripcion}: ${d.cantidad} un.${d.lote ? ' · lote ' + d.lote : ''}${d.vence ? ' · vence ' + fmtFecha(d.vence) : ''}`).join('\n') : '- (sin unidades recibidas)') +
                    (incidencias.length ? '\nINCIDENCIAS:\n' + incidencias.map(n => `- ${n.producto}: ${INCIDENCIAS[n.tipo]}${n.detalle ? ' — ' + n.detalle : ''}`).join('\n') : '') + (obs ? '\nObs.: ' + obs : '') + (ingresaStock ? `\nIngresado al stock de ${central}.` : '');
                await recepcionConStock(oc, { recId, hora, key, det, incidencias, guia, fecha, obs, notificar: q('#r-correo').checked, ingresaStock, central, texto, titulo: incidencias.length ? `Recepción con incidencias en ${col.centro}` : `Recepción en ${col.centro}` });
                toast('Recepción registrada', ingresaStock ? `Lo recibido quedó en el stock de ${central}. Entrégalo a los centros desde Actas de entrega.` : 'Se actualizó lo recibido.', 'success');
            }, { ancho: true, ok: 'Guardar recepción' });
        const pintar = () => {
            const key = ov.querySelector('#r-col').value, st = ov.querySelector('#r-stock').checked, lv = ov.querySelector('#r-lv').checked;
            ov.querySelector('#r-lineas').innerHTML = '<div class="soc-tabla"><table><thead><tr><th>Producto</th><th>Pedido</th><th>Recibido</th><th>Pendiente</th><th>Llega ahora</th>' + (st ? '<th>Producto en inventario</th>' + (lv ? '<th>Lote</th><th>Vence</th>' : '') : '') + '<th>Incidencia</th></tr></thead><tbody>' +
                oc.lineas.map((l, i) => { const p = num(l.dist && l.dist[key]), ya = num(l.recibido && l.recibido[key]), pe = Math.max(0, p - ya); return p ? `<tr data-i="${i}" data-pe="${pe}"><td class="r-prod" data-l="Producto">${esc(l.descripcion)}</td><td data-l="Pedido">${p}</td><td data-l="Recibido">${ya}</td><td data-l="Pendiente"><strong>${pe}</strong></td><td class="r-celda" data-l="Llega ahora"><input type="number" min="0" max="${pe}" class="r-c" value="" aria-label="Unidades que llegaron"><button type="button" class="btn btn-outline btn-sm r-ok" title="Llegó completo"${pe ? '' : ' disabled'}>✔ ${pe || 'listo'}</button></td>` +
                    (st ? `<td data-l="Producto en inventario"><input class="r-n" list="r-inv" aria-label="Producto en inventario" value="${esc(l.insumoName || l.descripcion)}"></td>` + (lv ? `<td data-l="Lote"><input class="r-l" aria-label="Lote" placeholder="S/L"></td><td data-l="Vence"><input type="date" class="r-v" aria-label="Fecha de vencimiento"></td>` : '') : '') +
                    `<td data-l="Incidencia"><select class="r-t" aria-label="Incidencia"><option value="">Sin incidencia</option>${Object.entries(INCIDENCIAS).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select><input class="r-td" aria-label="Detalle de la incidencia" placeholder="Detalle"></td></tr>` : ''; }).join('') + '</tbody></table></div>';
        };
        const resumen = () => {
            let pe = 0, lleg = 0, sobra = 0; ov.querySelectorAll('tr[data-i]').forEach(tr => { const v = num(tr.querySelector('.r-c').value); pe += num(tr.dataset.pe); lleg += Math.min(num(tr.dataset.pe), v); sobra += Math.max(0, v - num(tr.dataset.pe)); tr.classList.toggle('r-sobra', v > num(tr.dataset.pe)); });
            const el = ov.querySelector('#r-resumen'); if (el) el.innerHTML = `Pendiente: <b>${pe}</b> un. · llegan ahora: <b>${lleg}</b> · quedarían pendientes: <b>${Math.max(0, pe - lleg)}</b>${sobra ? ` · <span class="cierre-error">${sobra} de más</span>` : ''}`;
        };
        ov.addEventListener('input', (e) => { if (e.target.classList && e.target.classList.contains('r-c')) resumen(); });
        ov.addEventListener('click', (e) => {
            const ok = e.target.closest('.r-ok'); if (ok) { const tr = ok.closest('tr'); const c = tr.querySelector('.r-c'); c.value = c.value && num(c.value) === num(tr.dataset.pe) ? '' : tr.dataset.pe; resumen(); }
            if (e.target.closest('#r-total')) { ov.querySelectorAll('tr[data-i]').forEach(tr => { if (num(tr.dataset.pe)) tr.querySelector('.r-c').value = tr.dataset.pe; }); resumen(); }
            if (e.target.closest('#r-nada')) { ov.querySelectorAll('.r-c').forEach(i => { i.value = ''; }); resumen(); }
        });
        ov.querySelector('#r-col').addEventListener('change', () => { pintar(); resumen(); }); ov.querySelector('#r-stock').addEventListener('change', () => { pintar(); resumen(); }); ov.querySelector('#r-lv').addEventListener('change', () => { pintar(); resumen(); });
        const sel = ov.querySelector('#r-col'); const iPropia = cols.findIndex(c => c.centro === CENTRO_PROPIO); if (iPropia > 0) sel.selectedIndex = iPropia;
        pintar(); resumen();
        cargaInv.then(() => {
            const dl = ov.querySelector('#r-inv'); if (dl) dl.innerHTML = nombresInv.map(n => `<option value="${esc(n)}">`).join('');
            const w = ov.querySelector('#r-stock-w'); if (w && w.lastChild) w.lastChild.textContent = ` Ingresar lo recibido al stock de ${central} (así se descuenta al entregarlo por acta)`;
        });
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
        const pu = pendientesDe(ocActual).reduce((t, x) => t + x.pendiente, 0);
        if (!(await confirmar(nuevo ? 'Cerrar seguimiento' : 'Reabrir seguimiento', nuevo ? (pu ? `Quedan ${pu} unidades sin recibir y dejarán de aparecer como pendientes.` : 'La orden dejará de aparecer entre las activas.') : 'La orden volverá a estar en seguimiento.', nuevo ? 'Cerrar' : 'Reabrir'))) return;
        try { await registrarEvento(ocActual, { tipo: 'ESTADO', texto: nuevo ? `Seguimiento cerrado${pu ? ` con ${pu} unidades sin recibir` : ''}.` : 'Seguimiento reabierto.', notificar: false, cambiosOC: { cerrada: nuevo } }); }
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
    const ok = (l) => (l || []).filter(m => DOMINIOS.some(x => String(m).toLowerCase().endsWith('@' + x)));
    const to = ok(d.to), cc = ok(d.cc);
    if (!to.length) return salida({ ok: false, error: 'sin destinatarios permitidos' });
    const adj = (d.attachments || []).slice(0, 5).map(a => Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime || 'application/pdf', String(a.name).slice(0, 120)));
    const op = { to: to.join(','), subject: String(d.subject).slice(0, 200), body: String(d.text), htmlBody: String(d.html), name: 'Sistema SAR Melipilla' };
    if (cc.length) op.cc = cc.join(',');
    if (adj.length) op.attachments = adj;
    MailApp.sendEmail(op);
    return salida({ ok: true, enviados: to.length + cc.length, adjuntos: adj.length });
  } catch (err) { return salida({ ok: false, error: String(err) }); }
}
function salida(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }`;

    function formConfig() {
        const c = configCorreo;
        const ov = modal('Configurar correo', `
            <p class="cierre-hint">El envío automático usa un Google Apps Script con tu cuenta de Gmail (gratis, sin plan Blaze). Pasos: 1) abre script.google.com, 2) pega el código de abajo, 3) cambia la clave, 4) Implementar → Nueva implementación → Aplicación web (ejecutar como "Yo", acceso "Cualquier persona"), 5) pega aquí la URL y la misma clave.</p>
            <div class="soc-dest-fijos"><b>Quién recibe cada correo</b><br>
                <span>Recepción de mercadería:</span> ${DESTINO_RECEPCION.map(esc).join(', ')}<br>
                <span>Recepción conforme:</span> Para ${((window.SAR_RecepcionConforme && window.SAR_RecepcionConforme.DESTINATARIOS_BASE.to) || []).map(esc).join(', ')} · Cc ${((window.SAR_RecepcionConforme && window.SAR_RecepcionConforme.DESTINATARIOS_BASE.cc) || []).map(esc).join(', ')}</div>
            <textarea id="c-script" rows="9" readonly style="font-family:monospace;font-size:11px">${esc(SCRIPT_GAS)}</textarea>
            <button type="button" class="btn btn-outline btn-sm" id="c-copiar">Copiar código</button>
            <label>URL de la aplicación web<input type="text" id="c-url" value="${esc(c.webhookUrl || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
            <label>Clave (la misma del script)<input type="text" id="c-token" value="${esc(c.token || '')}" autocomplete="off"></label>
            <label>Lista base de destinatarios (separados por coma)<input type="text" id="c-base" value="${esc((c.destinatariosBase || []).join(', '))}"></label>
            <label>Feriados adicionales (AAAA-MM-DD, separados por coma)<input type="text" id="c-fer" value="${esc((c.feriadosExtra || []).join(', '))}" placeholder="Cargados 2026 y los hábiles de 2027"></label>`,
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

    window.SAR_SeguimientoOC = { abrir, pendientesDe, estadoEntregas, pendientesDeRecepcion, armarOCdesdeRevision, mezclarIngreso, aplicarRecepcion, recepcionConStock, _setOcActual: (o) => { ocActual = o; }, sumarHabiles, habilesEntre, estadoPlazo, estadoLinea, totalesPorCentro, discrepancias, parsearCuadro, armarCorreo, resumenTexto, setFeriadosExtra, emailValido, enviarCorreo, _setConfig: (c) => { configCorreo = { ...configCorreo, ...c }; } };
})(window, document);
