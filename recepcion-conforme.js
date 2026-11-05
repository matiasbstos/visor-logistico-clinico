/* ==========================================================================
   RECEPCIÓN CONFORME (v20.44)
   --------------------------------------------------------------------------
   Cierra la recepción de una OC: genera el "Acta de recepción conforme" (PDF),
   toma la guía de despacho o factura del proveedor (PDF; el archivo se nombra
   con su número) y envía un correo con ambos adjuntos a quien paga/gestiona
   (Para: Paulina Carrasco; Cc: lista fija editable). Deja el resultado en la OC
   y en la bitácora para poder verificarlo después.

   No se guardan los PDF en la base de datos: solo tipo, número, fecha, quién
   recibe y el resultado del envío.
   ========================================================================== */
(function (window, document) {
    'use strict';

    const PDFLIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
    const MAX_MB = 8;
    const DESTINATARIOS_BASE = {
        to: ['paulina.carrasco@cormumel.cl'],
        cc: ['daniela.medina@cormumel.cl', 'carolina.ortiz@cormumel.cl', 'nadia.sanchez@cormumel.cl', 'sar.melipilla@cormumel.cl', 'matias.bustos@cormumel.cl']
    };
    const CONTRAPARTE_BASE = 'Mariel Quintanilla L.';
    const FIRMA_BASE = { nombre: 'Matías Bustos Huerta', cargo: 'Encargado de insumos' };

    const fs = () => window.firebaseFirestore;
    const db = () => window.firebaseDb;
    const esc = (s) => (window.escapeHTML ? window.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const num = (v) => Number(v) || 0;
    const pad = (n) => String(n).padStart(2, '0');
    const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const emailValido = (e) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(e || '').trim());
    const lista = (s) => String(s || '').split(/[,\s;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
    const fmtLarga = (iso) => { const m = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']; const [y, mm, d] = String(iso).slice(0, 10).split('-').map(Number); return `${d} de ${m[mm - 1]} de ${y}`; };

    // ---------------------------------------------------------------
    // Puro
    // ---------------------------------------------------------------
    /** Guia_12345.pdf / Factura_9876.pdf (el número del documento es el nombre del archivo). */
    function nombreAdjunto(tipo, numero, ext) {
        const n = String(numero || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '').slice(0, 40);
        return `${tipo === 'FACTURA' ? 'Factura' : 'Guia'}_${n}.${ext || 'pdf'}`;
    }
    function nombreActa(oc) { return `RC${String(oc.numeroOC || '').replace(/[^A-Za-z0-9-]+/g, '')}.pdf`; }
    /** Líneas para el acta: lo recibido por el SAR en esta OC. */
    function lineasActa(oc, centro) {
        const cols = (oc.columnas || []).filter(c => c.centro === centro);
        const out = [];
        (oc.lineas || []).forEach(l => {
            const p = cols.reduce((t, c) => t + num(l.dist && l.dist[c.key]), 0), r = cols.reduce((t, c) => t + num(l.recibido && l.recibido[c.key]), 0);
            if (p || r) out.push({ producto: l.descripcion, pedido: p, recibido: r });
        });
        return out;
    }
    function validar(oc, d, centro) {
        const err = [];
        if (!d.numeroDoc || !String(d.numeroDoc).trim()) err.push('Falta el número de la guía o factura.');
        if (!d.archivo) err.push('Adjunta el PDF de la guía o factura.');
        else if (d.archivo.size > MAX_MB * 1024 * 1024) err.push(`El PDF pesa más de ${MAX_MB} MB.`);
        if (!(d.to || []).length) err.push('Indica al menos un destinatario en "Para".');
        if ([...(d.to || []), ...(d.cc || [])].some(x => !emailValido(x))) err.push('Hay un correo con formato no válido.');
        const abiertas = (oc.incidencias || []).filter(i => i.estado === 'ABIERTA');
        if (abiertas.length) err.push(`Hay ${abiertas.length} incidencia(s) abierta(s): resuélvelas antes de dar la recepción por conforme.`);
        const lin = lineasActa(oc, centro);
        if (!lin.some(l => l.recibido > 0)) err.push('Aún no hay unidades recibidas para el SAR en esta orden.');
        const pend = lin.reduce((t, l) => t + Math.max(0, l.pedido - l.recibido), 0);
        if (pend > 0 && !d.parcial) err.push(`Faltan ${pend} unidad(es) por recibir. Si igualmente das conforme lo recibido, marca "Recepción parcial".`);
        return err;
    }
    function armarCorreo(oc, d, centro) {
        const doc = d.tipoDoc === 'FACTURA' ? 'factura' : 'guía de despacho';
        const texto = `Estimada Paulina:

Junto con saludar, informo la recepción conforme de la orden de compra N° ${oc.numeroOC}${oc.proveedor ? ' del proveedor ' + oc.proveedor : ''} en ${centro === 'SAR' ? 'el SAR Arpillerista Elsa Romo Aravena' : centro}, con fecha ${fmtLarga(d.fecha)}${d.parcial ? ' (recepción parcial; el detalle está en el acta)' : ''}.

Se adjuntan el acta de recepción conforme y la ${doc} N° ${d.numeroDoc} para continuar con el proceso.${d.observaciones ? '\n\nObservaciones: ' + d.observaciones : ''}

Saludos cordiales,
${d.firmaNombre}
${d.firmaCargo}
SAR Arpillerista Elsa Romo Aravena`;
        return { subject: `Recepción conforme OC ${oc.numeroOC}${oc.proveedor ? ' · ' + oc.proveedor : ''}`, text: texto, html: '<div style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">' + esc(texto) + '</div>' };
    }

    // ---------------------------------------------------------------
    // PDF del acta
    // ---------------------------------------------------------------
    let pdfLibPromesa = null;
    function cargarPDFLib() {
        if (window.PDFLib) return Promise.resolve(window.PDFLib);
        if (!pdfLibPromesa) pdfLibPromesa = new Promise((ok, mal) => {
            const s = document.createElement('script'); s.src = PDFLIB_URL; s.onload = () => ok(window.PDFLib);
            s.onerror = () => { pdfLibPromesa = null; mal(new Error('No se pudo cargar el generador de PDF (revisa tu conexión).')); };
            document.head.appendChild(s);
        });
        return pdfLibPromesa;
    }
    async function cargarLogo() { try { const r = await fetch('assets/logo-corpo-melipilla.jpg'); if (!r.ok) return null; return new Uint8Array(await r.arrayBuffer()); } catch (e) { return null; } }

    /** Productos recibidos (acumulado del SAR) para el acta: descripción + cantidad. */
    function lineasRecibidas(oc, centro) { return lineasActa(oc, centro).filter(l => l.recibido > 0); }
    const miles = (n) => String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const fechaCorta = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

    /** Reproduce "RECEPCIÓN CONFORME PRODUCTO O SERVICIO (PARCIAL)" del modelo de la Corporación. */
    async function generarActaPDF(oc, d, centro, { PDFLib, logoBytes }) {
        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        const doc = await PDFDocument.create();
        doc.setTitle(`Recepción conforme OC ${oc.numeroOC}`); doc.setAuthor('Corporación Municipal de Melipilla'); doc.setCreator('Sistema de inventario SAR');
        const F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold);
        let logo = null; if (logoBytes) { try { logo = await doc.embedJpg(logoBytes); } catch (e) { try { logo = await doc.embedPng(logoBytes); } catch (e2) { logo = null; } } }
        const W = 612, H = 792, ML = 84, MR = 552, negro = rgb(0, 0, 0);
        const seguro = (font, s) => { const set = font.getCharacterSet(); return Array.from(String(s == null ? '' : s).replace(/³/g, '3').replace(/²/g, '2').replace(/\s+/g, ' ')).map(c => set.includes(c.codePointAt(0)) ? c : '?').join(''); };
        let page = doc.addPage([W, H]);
        const T = (s, x, yy, size, bold) => page.drawText(seguro(bold ? FB : F, s), { x, y: H - yy, size, font: bold ? FB : F, color: negro });
        const ancho = (s, size, bold) => (bold ? FB : F).widthOfTextAtSize(seguro(bold ? FB : F, s), size);
        const envolver = (s, size, bold, maxW) => { const out = []; let cur = ''; for (const w of String(s).split(' ')) { const t = cur ? cur + ' ' + w : w; if (ancho(t, size, bold) <= maxW || !cur) cur = t; else { out.push(cur); cur = w; } } if (cur) out.push(cur); return out; };
        const centrar = (s, size, bold, yy, x0, x1) => T(s, (x0 + x1 - ancho(s, size, bold)) / 2, yy, size, bold);
        if (logo) { const h = 66, w = logo.width * h / logo.height; page.drawImage(logo, { x: ML, y: H - 62 - h, width: w, height: h }); }
        const titulo = 'RECEPCIÓN CONFORME PRODUCTO O SERVICIO' + (d.parcial ? ' PARCIAL' : '');
        centrar(titulo, 10, true, 100, ML + 90, MR + 20);
        let y = 150;
        T('DATOS DEL PROVEEDOR', 160, y, 10.5, true); y += 24;
        T('Nombre de la empresa: ' + (oc.proveedor || ''), ML, y, 10.5, true); y += 22;
        T('RUT: ' + (oc.rutProveedor || ''), ML, y, 10.5, true); y += 22;
        T('Orden de Compra: ' + (oc.numeroOC || ''), ML, y, 10.5, true); y += 22;
        T(`Con fecha ${fechaCorta(d.fecha)}, en calidad de contraparte técnica, certifico lo siguiente:`, ML, y, 10.5, false); y += 22;
        // Caja con lo recibido (se parte en otra página si es muy larga)
        const items = lineasRecibidas(oc, centro).map(l => envolver(`${String(l.producto).toUpperCase()} (CANTIDAD: ${miles(l.recibido)})`, 9.5, false, MR - ML - 44));
        const encab = `Que se recibió conforme en forma ${d.parcial ? 'PARCIAL' : 'TOTAL'} el producto, donde se recibió lo siguiente:`;
        const caja = (x0, x1, yTop, yBot) => { const t = 0.8; [[x0, yTop, x1, yTop], [x0, yBot, x1, yBot], [x0, yTop, x0, yBot], [x1, yTop, x1, yBot]].forEach(([a, b, c, e]) => page.drawLine({ start: { x: a, y: H - b }, end: { x: c, y: H - e }, thickness: t, color: negro })); };
        let top = y, cy = y + 16; T(encab, ML + 6, cy, 8.5, false); cy += 16;
        items.forEach(ls => {
            const alto = ls.length * 12.5 + 6;
            if (cy + alto > H - 120) { caja(ML, MR, top, cy + 2); page = doc.addPage([W, H]); top = 60; cy = 76; T(`Recepción conforme OC ${oc.numeroOC} (continuación)`, ML + 6, cy, 8.5, true); cy += 16; }
            page.drawCircle({ x: ML + 26, y: H - cy + 3, size: 2.2, color: negro });
            ls.forEach((t, i) => T(t, ML + 40, cy + i * 12.5, 9.5, false)); cy += alto;
        });
        if (d.observaciones) { envolver('Observaciones: ' + d.observaciones, 8.5, false, MR - ML - 12).forEach(t => { T(t, ML + 6, cy, 8.5, false); cy += 11; }); cy += 4; }
        caja(ML, MR, top, cy + 2);
        let yf = cy + 80; if (yf > H - 90) { page = doc.addPage([W, H]); yf = 160; }
        page.drawLine({ start: { x: 190, y: H - yf }, end: { x: 420, y: H - yf }, thickness: 0.8, color: negro });
        centrar('Firma contraparte técnica', 10.5, false, yf + 24, 0, W);
        centrar('Nombre Contraparte Técnica: ' + (d.contraparte || CONTRAPARTE_BASE), 10.5, false, yf + 46, 0, W);
        return await doc.save();
    }

    const aBase64 = (bytes) => { let s = ''; const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    function bajar(bytes, nombre) {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
    }

    // ---------------------------------------------------------------
    // Interfaz
    // ---------------------------------------------------------------
    function abrir(ctx) {
        const { oc, modal, toast } = ctx; const centro = ctx.centroPropio || 'SAR';
        const cfg = (ctx.config && ctx.config.recepcionConforme) || {};
        const to = (cfg.to && cfg.to.length) ? cfg.to : DESTINATARIOS_BASE.to, cc = (cfg.cc && cfg.cc.length) ? cfg.cc : DESTINATARIOS_BASE.cc;
        const lin = lineasActa(oc, centro), pend = lin.reduce((t, l) => t + Math.max(0, l.pedido - l.recibido), 0);
        const f = (id, et, v, tipo, extra) => `<label>${et}<input type="${tipo || 'text'}" id="${id}" value="${esc(v == null ? '' : v)}" ${extra || ''}></label>`;
        const ov = modal('Recepción conforme', `
            <p class="cierre-hint">Genera el acta de recepción conforme y envía el correo con el acta y la guía/factura. Revisa los destinatarios.</p>
            <div class="soc-fila"><label>Documento del proveedor<select id="rc-tipo"><option value="GUIA">Guía de despacho</option><option value="FACTURA">Factura</option></select></label>${f('rc-num', 'N° del documento', oc.ultimaGuia || '')}${f('rc-fec', 'Fecha de recepción', hoyISO(), 'date')}</div>
            <label>PDF de la guía o factura<input type="file" id="rc-file" accept="application/pdf"></label>
            <label>Tipo de recepción<select id="rc-parcial"><option value="0"${pend > 0 ? '' : ' selected'}>Total</option><option value="1"${pend > 0 ? ' selected' : ''}>Parcial${pend > 0 ? ` (faltan ${pend} unidades)` : ''}</option></select></label>
            ${f('rc-ct', 'Contraparte técnica (firma del acta)', CONTRAPARTE_BASE)}
            <div class="soc-fila">${f('rc-fn', 'Correo firmado por', FIRMA_BASE.nombre)}${f('rc-fc', 'Cargo', FIRMA_BASE.cargo)}</div>
            <label>Observaciones (opcional)<textarea id="rc-obs" rows="2"></textarea></label>
            <label class="soc-toggle"><input type="checkbox" id="rc-enviar" checked> Enviar correo con el acta y la guía/factura a la lista</label>
            <label>Para<input type="text" id="rc-to" value="${esc(to.join(', '))}"></label>
            <label>Cc<input type="text" id="rc-cc" value="${esc(cc.join(', '))}"></label>
            <div id="rc-error" class="cierre-error"></div>`, async (o) => {
            const g = (id) => (o.querySelector('#' + id) || {}).value || '';
            const d = { tipoDoc: g('rc-tipo'), numeroDoc: g('rc-num').trim(), fecha: g('rc-fec') || hoyISO(), archivo: (o.querySelector('#rc-file').files || [])[0] || null, parcial: (o.querySelector('#rc-parcial') || {}).value === '1',
                contraparte: g('rc-ct').trim() || CONTRAPARTE_BASE, firmaNombre: g('rc-fn').trim() || FIRMA_BASE.nombre, firmaCargo: g('rc-fc').trim() || FIRMA_BASE.cargo, observaciones: g('rc-obs').trim(), to: lista(g('rc-to')), cc: lista(g('rc-cc')) };
            const err = validar(oc, d, centro);
            o.querySelector('#rc-error').innerHTML = err.map(e => `<div>${esc(e)}</div>`).join('');
            if (err.length) return false;
            const PDFLib = await cargarPDFLib(); const logoBytes = await cargarLogo();
            const acta = await generarActaPDF(oc, d, centro, { PDFLib, logoBytes });
            const guia = new Uint8Array(await d.archivo.arrayBuffer());
            const adj = [{ name: nombreActa(oc), mime: 'application/pdf', base64: aBase64(acta) }, { name: nombreAdjunto(d.tipoDoc, d.numeroDoc), mime: 'application/pdf', base64: aBase64(guia) }];
            const enviar = (o.querySelector('#rc-enviar') || {}).checked !== false;
            const correo = enviar ? await ctx.enviarCorreo(d.to, armarCorreo(oc, d, centro), { cc: d.cc, attachments: adj }) : { estado: 'no_enviado', detalle: 'Se emitió sin enviar el correo.', destinatarios: [], cc: [] };
            if (ctx.guardarArchivo) {
                try { await ctx.guardarArchivo(oc.id, { nombre: adj[0].name, categoria: 'Recepción conforme', bytes: acta }); await ctx.guardarArchivo(oc.id, { nombre: adj[1].name, categoria: d.tipoDoc === 'FACTURA' ? 'Factura' : 'Guía de despacho', bytes: guia }); }
                catch (e) { toast('Archivos no guardados', e.message || String(e), 'warning'); }
            }
            if (!enviar) { bajar(acta, adj[0].name); toast('Acta emitida', 'Quedó guardada en la orden. No se envió correo.', 'success'); }
            if (correo.estado === 'borrador') { bajar(acta, adj[0].name); bajar(guia, adj[1].name); toast('Adjunta los archivos', 'El envío automático no está configurado: se descargaron el acta y la guía/factura; adjúntalos al borrador.', 'warning'); }
            const resumen = { estado: correo.estado, to: correo.destinatarios || d.to, cc: correo.cc || d.cc, detalle: correo.detalle || '', fecha: hoyISO() };
            const textoEv = `Recepción conforme registrada (${d.tipoDoc === 'FACTURA' ? 'factura' : 'guía'} N° ${d.numeroDoc})${d.parcial ? ', parcial' : ''}. Correo: ${correo.estado}${correo.detalle ? ' — ' + correo.detalle : ''}.`;
            const ocRef = fs().doc(fs().collection(db(), 'Seguimiento_OC'), oc.id);
            await fs().updateDoc(ocRef, { recepcionConforme: { fecha: d.fecha, por: ctx.usuario, recibe: d.firmaNombre, tipoDoc: d.tipoDoc, numeroDoc: d.numeroDoc, parcial: d.parcial, observaciones: d.observaciones, correo: resumen } });
            await fs().setDoc(fs().doc(fs().collection(db(), 'Seguimiento_OC', oc.id, 'Eventos')), { tipo: 'CONFORME', texto: textoEv, autor: ctx.usuario, fecha: fs().serverTimestamp(), correo: { estado: correo.estado, destinatarios: [...(correo.destinatarios || []), ...(correo.cc || [])], detalle: correo.detalle || '' } });
            if (correo.estado === 'enviado') toast('Correo enviado', `Acta y ${d.tipoDoc === 'FACTURA' ? 'factura' : 'guía'} enviadas a ${(correo.destinatarios || []).length + (correo.cc || []).length} destinatario(s).`, 'success');
            else if (correo.estado !== 'borrador' && enviar) toast('Revisa el correo', correo.detalle || 'El correo no se pudo enviar.', 'error');
        });
        return ov;
    }

    window.SAR_RecepcionConforme = { abrir, nombreAdjunto, nombreActa, lineasActa, validar, armarCorreo, generarActaPDF, DESTINATARIOS_BASE };
})(window, document);
