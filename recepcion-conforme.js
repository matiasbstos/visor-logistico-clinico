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
    /** Correo tipo (modelo real enviado por Compras SAR): asunto = RC + N° de orden; cuerpo corto; firma con logo SAR. */
    const FIRMA_CORREO = { unidad: 'Compras SAR', cargo: 'Analista de compras y adquisiciones', direccion: 'Real audiencia #980, Melipilla', telefono: '2 2568 8652', web: 'www.corpomelipilla.cl', logo: 'https://sarinventario.web.app/assets/logo-sar.png' };
    function armarCorreo(oc, d, centro) {
        const rc = 'RC' + String(oc.numeroOC || '').replace(/[^A-Za-z0-9-]+/g, '');
        const prov = String(oc.proveedor || '').trim();
        const extra = (d.parcial ? '\n\nRecepción parcial: quedan unidades pendientes de entrega por el proveedor.' : '') + (d.observaciones ? '\n\nObservaciones: ' + d.observaciones : '');
        const cuerpo = `Estimada:\n\nEspero se encuentre bien. Adjunto ${rc}${prov ? ' de ' + prov : ''}${extra}\n\nSaludos Cordiales.\n\n${d.firmaNombre || FIRMA_BASE.nombre}.`;
        const F = FIRMA_CORREO;
        const texto = `${cuerpo}\n\n${F.unidad}\n${F.cargo}\n${F.direccion}\n${F.telefono}\n${F.web}`;
        const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;white-space:pre-wrap">${esc(cuerpo)}</div>
<table style="margin-top:14px;font-family:Arial,sans-serif;border-collapse:collapse"><tr>
<td style="padding-right:14px;vertical-align:middle"><img src="${F.logo}" alt="SAR" width="150" style="display:block;border:0"></td>
<td style="vertical-align:middle;font-size:12px;color:#555;line-height:1.4"><b style="color:#1A3668;font-size:14px">${esc(F.unidad)}</b><br><b>${esc(F.cargo)}</b><br>${esc(F.direccion)}<br>${esc(F.telefono)}<br>${esc(F.web)}</td></tr></table>`;
        return { subject: rc, text: texto, html };
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
    /** Firma y timbre de la contraparte técnica (imagen del modelo vigente de la Corporación). */
    async function cargarFirma() { try { const r = await fetch('assets/firma-contraparte-mariel.png'); if (!r.ok) return null; return new Uint8Array(await r.arrayBuffer()); } catch (e) { return null; } }
    async function cargarLogo() { try { const r = await fetch('assets/logo-corpo-melipilla.jpg'); if (!r.ok) return null; return new Uint8Array(await r.arrayBuffer()); } catch (e) { return null; } }

    /** Productos recibidos (acumulado del SAR) para el acta: descripción + cantidad. */
    function lineasRecibidas(oc, centro) { return lineasActa(oc, centro).filter(l => l.recibido > 0); }
    const miles = (n) => String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const fechaCorta = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

    /** Reproduce "RECEPCIÓN CONFORME PRODUCTO O SERVICIO (PARCIAL)" del modelo de la Corporación. */
    async function generarActaPDF(oc, d, centro, { PDFLib, logoBytes, firmaBytes }) {
        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        const doc = await PDFDocument.create();
        doc.setTitle(`Recepción conforme OC ${oc.numeroOC}`); doc.setAuthor('Corporación Municipal de Melipilla'); doc.setCreator('Sistema de inventario SAR');
        const F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold);
        let firmaImg = null; if (firmaBytes && d.conFirma !== false && /quintanilla/i.test(d.contraparte || CONTRAPARTE_BASE)) { try { firmaImg = await doc.embedPng(firmaBytes); } catch (e) { firmaImg = null; } }
        let logo = null; if (logoBytes) { try { logo = await doc.embedJpg(logoBytes); } catch (e) { try { logo = await doc.embedPng(logoBytes); } catch (e2) { logo = null; } } }
        const W = 612, H = 792, ML = 84, MR = 552, negro = rgb(0, 0, 0);
        const seguro = (font, s) => { const set = font.getCharacterSet(); return Array.from(String(s == null ? '' : s).replace(/³/g, '3').replace(/²/g, '2').replace(/\s+/g, ' ')).map(c => set.includes(c.codePointAt(0)) ? c : '?').join(''); };
        let page = doc.addPage([W, H]);
        const T = (s, x, yy, size, bold) => page.drawText(seguro(bold ? FB : F, s), { x, y: H - yy, size, font: bold ? FB : F, color: negro });
        const ancho = (s, size, bold) => (bold ? FB : F).widthOfTextAtSize(seguro(bold ? FB : F, s), size);
        const envolver = (s, size, bold, maxW) => { const out = []; let cur = ''; for (const w of String(s).split(' ')) { const t = cur ? cur + ' ' + w : w; if (ancho(t, size, bold) <= maxW || !cur) cur = t; else { out.push(cur); cur = w; } } if (cur) out.push(cur); return out; };
        const centrar = (s, size, bold, yy, x0, x1) => T(s, (x0 + x1 - ancho(s, size, bold)) / 2, yy, size, bold);
        if (logo) { const h = 66, w = logo.width * h / logo.height; page.drawImage(logo, { x: ML, y: H - 62 - h, width: w, height: h }); }
        const titulo = 'RECEPCIÓN CONFORME PRODUCTO O SERVICIO' + (d.parcial ? ' PARCIAL' : ' TOTAL');
        centrar(titulo, 10, true, 100, ML + 90, MR + 20);
        let y = 150;
        T('DATOS DEL PROVEEDOR', 160, y, 10.5, true); y += 24;
        envolver('Nombre de la empresa: ' + (oc.proveedor || ''), 10.5, true, MR - ML + 8).forEach((t, i) => { T(t, ML, y, 10.5, true); y += i >= 0 ? 15 : 0; }); y += 7;
        T('RUT: ' + (oc.rutProveedor || ''), ML, y, 10.5, true); y += 22;
        T('Orden de Compra: ' + (oc.numeroOC || ''), ML, y, 10.5, true); y += 22;
        T(`Con fecha ${fechaCorta(d.fecha)}, en calidad de contraparte técnica, certifico lo siguiente:`, ML, y, 10.5, false); y += 22;
        // Caja con lo recibido (se parte en otra página si es muy larga)
        const items = (d.lineas && d.lineas.length ? d.lineas : lineasRecibidas(oc, centro)).map(l => envolver(`${String(l.producto).toUpperCase()} (CANTIDAD:${miles(l.recibido)})`, 10.5, false, MR - ML - 44));
        const encab = (d.encabezado && String(d.encabezado).trim()) || `Que se recibió conforme en forma ${d.parcial ? 'Parcial' : 'Total'} de los productos, donde se recibió lo siguiente:`;
        const caja = (x0, x1, yTop, yBot) => { const t = 0.8; [[x0, yTop, x1, yTop], [x0, yBot, x1, yBot], [x0, yTop, x0, yBot], [x1, yTop, x1, yBot]].forEach(([a, b, c, e]) => page.drawLine({ start: { x: a, y: H - b }, end: { x: c, y: H - e }, thickness: t, color: negro })); };
        let top = y, cy = y + 16; T(encab, ML + 6, cy, 8.5, false); cy += 16;
        items.forEach(ls => {
            const alto = ls.length * 13.5 + 8;
            if (cy + alto > H - 120) { caja(ML, MR, top, cy + 2); page = doc.addPage([W, H]); top = 60; cy = 76; T(`Recepción conforme OC ${oc.numeroOC} (continuación)`, ML + 6, cy, 8.5, true); cy += 16; }
            page.drawCircle({ x: ML + 26, y: H - cy + 3, size: 2.2, color: negro });
            ls.forEach((t, i) => T(t, ML + 40, cy + i * 13.5, 10.5, false)); cy += alto;
        });
        if (d.observaciones) { envolver('Observaciones: ' + d.observaciones, 8.5, false, MR - ML - 12).forEach(t => { T(t, ML + 6, cy, 8.5, false); cy += 11; }); cy += 4; }
        caja(ML, MR, top, cy + 2);
        let yf = cy + 80; if (yf > H - 90) { page = doc.addPage([W, H]); yf = 160; }
        if (firmaImg) { const w = 196, h = w * firmaImg.height / firmaImg.width; page.drawImage(firmaImg, { x: (W - w) / 2, y: H - yf - 4, width: w, height: h }); }
        else page.drawLine({ start: { x: 190, y: H - yf }, end: { x: 420, y: H - yf }, thickness: 0.8, color: negro });
        centrar('Firma contraparte técnica', 10.5, false, yf + 24, 0, W);
        centrar('Nombre Contraparte Técnica: ' + (d.contraparte || CONTRAPARTE_BASE), 10.5, false, yf + 46, 0, W);
        return await doc.save();
    }

    const aBase64 = (bytes) => { let s = ''; const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

    /** Encabezado por defecto del acta según Total/Parcial (editable por el usuario). */
    const encabezadoBase = (parcial) => `Que se recibió conforme en forma ${parcial ? 'Parcial' : 'Total'} de los productos, donde se recibió lo siguiente:`;
    const escA = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    /** Tabla editable del detalle del acta: incluir, producto y cantidad. */
    function detalleHTML(lineas, pre) {
        return `<div class="rc-det" id="${pre}-det"><div class="rc-det-cab"><span></span><span>Producto (como saldrá en el acta)</span><span>Cantidad</span></div>${lineas.map((l, i) => `<div class="rc-det-fila"><input type="checkbox" class="${pre}-inc" checked title="Incluir en el acta"><input type="text" class="${pre}-prod" value="${escA(l.producto)}"><input type="number" min="0" class="${pre}-cant" value="${l.recibido}"></div>`).join('')}</div>`;
    }
    function leerDetalle(root, pre) {
        const inc = [...root.querySelectorAll('.' + pre + '-inc')], pr = [...root.querySelectorAll('.' + pre + '-prod')], ca = [...root.querySelectorAll('.' + pre + '-cant')];
        return inc.map((c, i) => ({ on: c.checked, producto: (pr[i].value || '').trim(), recibido: Math.max(0, Number(ca[i].value) || 0) })).filter(l => l.on && l.producto && l.recibido > 0).map(l => ({ producto: l.producto, recibido: l.recibido }));
    }
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
        const ultRec = (Array.isArray(oc.recepciones) ? oc.recepciones : []).filter(r => r && r.fecha).slice(-1)[0];
        const fechaRec = (ultRec && /^\d{4}-\d{2}-\d{2}/.test(String(ultRec.fecha)) ? String(ultRec.fecha).slice(0, 10) : '') || hoyISO();
        const f = (id, et, v, tipo, extra) => `<label>${et}<input type="${tipo || 'text'}" id="${id}" value="${esc(v == null ? '' : v)}" ${extra || ''}></label>`;
        const ov = modal('Recepción conforme', `
            <p class="cierre-hint">Genera el acta de recepción conforme y envía el correo con el acta y la guía/factura. Revisa los destinatarios.</p>
            <div class="soc-fila"><label>Documento del proveedor<select id="rc-tipo"><option value="GUIA">Guía de despacho</option><option value="FACTURA">Factura</option></select></label>${f('rc-num', 'N° del documento', oc.ultimaGuia || '')}${f('rc-fec', '¿Con qué fecha se emite el acta?', fechaRec, 'date')}</div>
            <p class="cierre-hint" id="rc-fec-ayuda">${fechaRec !== hoyISO() ? `Se propone el <b>${fechaCorta(fechaRec)}</b>, día en que se registró la recepción de los productos (hoy es ${fechaCorta(hoyISO())}). ` : ''}Si los productos llegaron otro día, cambia la fecha: el acta llevará la fecha que indiques. <a href="#" id="rc-fec-hoy">Usar hoy</a></p>
            <label>PDF de la guía o factura<input type="file" id="rc-file" accept="application/pdf"></label>
            <label>Tipo de recepción<select id="rc-parcial"><option value="0"${pend > 0 ? '' : ' selected'}>Total</option><option value="1"${pend > 0 ? ' selected' : ''}>Parcial${pend > 0 ? ` (faltan ${pend} unidades)` : ''}</option></select></label>
            <label>Encabezado del acta (editable)<textarea id="rc-enc" rows="2">${escA(encabezadoBase(pend > 0))}</textarea></label>
            <p class="cierre-hint">Detalle del acta: quita, corrige o cambia cantidades. Se ve igual en el PDF.</p>
            ${detalleHTML(lineasActa(oc, centro).filter(l => l.recibido > 0), 'rc')}
            ${f('rc-ct', 'Contraparte técnica (firma del acta)', CONTRAPARTE_BASE)}
            <label class="soc-toggle"><input type="checkbox" id="rc-firma" checked> Incluir firma y timbre de la contraparte en el acta</label>
            <div class="soc-fila">${f('rc-fn', 'Correo firmado por', FIRMA_BASE.nombre)}${f('rc-fc', 'Cargo', FIRMA_BASE.cargo)}</div>
            <label>Observaciones (opcional)<textarea id="rc-obs" rows="2"></textarea></label>
            <label class="soc-toggle"><input type="checkbox" id="rc-enviar" checked> Enviar correo con el acta y la guía/factura a la lista</label>
            <label>Para<input type="text" id="rc-to" value="${esc(to.join(', '))}"></label>
            <label>Cc<input type="text" id="rc-cc" value="${esc(cc.join(', '))}"></label>
            <div id="rc-error" class="cierre-error"></div>`, async (o) => {
            const g = (id) => (o.querySelector('#' + id) || {}).value || '';
            const d = { tipoDoc: g('rc-tipo'), numeroDoc: g('rc-num').trim(), fecha: g('rc-fec') || hoyISO(), archivo: (o.querySelector('#rc-file').files || [])[0] || null, parcial: (o.querySelector('#rc-parcial') || {}).value === '1',
                contraparte: g('rc-ct').trim() || CONTRAPARTE_BASE, conFirma: (o.querySelector('#rc-firma') || {}).checked !== false, firmaNombre: g('rc-fn').trim() || FIRMA_BASE.nombre, firmaCargo: g('rc-fc').trim() || FIRMA_BASE.cargo, observaciones: g('rc-obs').trim(), to: lista(g('rc-to')), cc: lista(g('rc-cc')), encabezado: g('rc-enc').trim(), lineas: leerDetalle(o, 'rc') };
            const err = validar(oc, d, centro);
            if (!d.fecha) err.push('Indica la fecha del acta.');
            if (!d.lineas.length) err.push('El detalle del acta no puede quedar vacío.');
            o.querySelector('#rc-error').innerHTML = err.map(e => `<div>${esc(e)}</div>`).join('');
            if (err.length) return false;
            const PDFLib = await cargarPDFLib(); const logoBytes = await cargarLogo(); const firmaBytes = await cargarFirma();
            const acta = await generarActaPDF(oc, d, centro, { PDFLib, logoBytes, firmaBytes });
            const guia = new Uint8Array(await d.archivo.arrayBuffer());
            const adj = [{ name: nombreActa(oc), mime: 'application/pdf', base64: aBase64(acta) }, { name: nombreAdjunto(d.tipoDoc, d.numeroDoc), mime: 'application/pdf', base64: aBase64(guia) }];
            const enviar = (o.querySelector('#rc-enviar') || {}).checked !== false;
            const correo = enviar ? await ctx.enviarCorreo(d.to, armarCorreo(oc, d, centro), { cc: d.cc, attachments: adj, respaldo: true }) : { estado: 'no_enviado', detalle: 'Se emitió sin enviar el correo.', destinatarios: [], cc: [] };
            if (ctx.guardarArchivo) {
                try { await ctx.guardarArchivo(oc.id, { nombre: adj[0].name, categoria: 'Recepción conforme', bytes: acta }); await ctx.guardarArchivo(oc.id, { nombre: adj[1].name, categoria: d.tipoDoc === 'FACTURA' ? 'Factura' : 'Guía de despacho', bytes: guia }); }
                catch (e) { toast('Archivos no guardados', e.message || String(e), 'warning'); }
            }
            if (!enviar) { bajar(acta, adj[0].name); toast('Acta emitida', 'Quedó guardada en la orden. No se envió correo.', 'success'); }
            if (correo.estado === 'borrador') { bajar(acta, adj[0].name); bajar(guia, adj[1].name); toast('Adjunta los archivos', 'El envío automático no está configurado: se descargaron el acta y la guía/factura; adjúntalos al borrador.', 'warning'); }
            const resumen = { estado: correo.estado, to: correo.destinatarios || d.to, cc: correo.cc || d.cc, detalle: correo.detalle || '', fecha: hoyISO() };
            const textoEv = `Recepción conforme registrada (${d.tipoDoc === 'FACTURA' ? 'factura' : 'guía'} N° ${d.numeroDoc})${d.parcial ? ', parcial' : ''}. Correo: ${correo.estado}${correo.detalle ? ' — ' + correo.detalle : ''}.`;
            const ocRef = fs().doc(fs().collection(db(), 'Seguimiento_OC'), oc.id);
            await fs().updateDoc(ocRef, { recepcionConforme: { fecha: d.fecha, por: ctx.usuario, recibe: d.firmaNombre, tipoDoc: d.tipoDoc, numeroDoc: d.numeroDoc, parcial: d.parcial, observaciones: d.observaciones, encabezado: d.encabezado, lineas: d.lineas, correo: resumen } });
            await fs().setDoc(fs().doc(fs().collection(db(), 'Seguimiento_OC', oc.id, 'Eventos')), { tipo: 'CONFORME', texto: textoEv, autor: ctx.usuario, fecha: fs().serverTimestamp(), correo: { estado: correo.estado, destinatarios: [...(correo.destinatarios || []), ...(correo.cc || [])], detalle: correo.detalle || '' } });
            if (correo.estado === 'enviado') toast('Correo enviado', `Acta y ${d.tipoDoc === 'FACTURA' ? 'factura' : 'guía'} enviadas a ${(correo.destinatarios || []).length + (correo.cc || []).length} destinatario(s).`, 'success');
            else if (correo.estado === 'programado') toast('Correo programado', correo.detalle, 'info');
            else if (correo.estado !== 'borrador' && enviar) toast('Revisa el correo', correo.detalle || 'El correo no se pudo enviar.', 'error');
        });
        try { const sel = ov.querySelector('#rc-parcial'), enc = ov.querySelector('#rc-enc'); let tocado = false; enc.addEventListener('input', () => { tocado = true; }); sel.addEventListener('change', () => { if (!tocado) enc.value = encabezadoBase(sel.value === '1'); }); } catch (e) { /* sin sincronía */ }
        try { const h = ov && ov.querySelector('#rc-fec-hoy'); if (h) h.addEventListener('click', (ev) => { ev.preventDefault(); ov.querySelector('#rc-fec').value = hoyISO(); }); } catch (e) { /* sin atajo */ }
        return ov;
    }

    /** Rehace el acta de una recepción conforme ya registrada con el modelo vigente y la guarda en la orden. */
    async function regenerar(ctx) {
        const { oc, toast } = ctx; const centro = ctx.centroPropio || 'SAR', rc = oc.recepcionConforme;
        if (!rc) throw new Error('Esta orden aún no tiene recepción conforme registrada.');
        const lin = lineasActa(oc, centro), pend = lin.reduce((t, l) => t + Math.max(0, l.pedido - l.recibido), 0);
        const d = { fecha: rc.fecha || hoyISO(), parcial: typeof rc.parcial === 'boolean' ? rc.parcial : pend > 0, observaciones: rc.observaciones || '', contraparte: rc.contraparte || CONTRAPARTE_BASE, conFirma: true, encabezado: rc.encabezado || '', lineas: rc.lineas || null };
        const prog = window.SAR_Progreso.iniciar('Regenerando la recepción conforme…', ['Armando el documento con el modelo vigente…']);
        try {
        const PDFLib = await cargarPDFLib(); const logoBytes = await cargarLogo(); const firmaBytes = await cargarFirma();
        const acta = await generarActaPDF(oc, d, centro, { PDFLib, logoBytes, firmaBytes });
        bajar(acta, nombreActa(oc));
        if (ctx.guardarArchivo) await ctx.guardarArchivo(oc.id, { nombre: nombreActa(oc), categoria: 'Recepción conforme (modelo vigente)', bytes: acta });
        await fs().setDoc(fs().doc(fs().collection(db(), 'Seguimiento_OC', oc.id, 'Eventos')), { tipo: 'CONFORME', texto: 'Acta de recepción conforme regenerada con el modelo vigente (la versión anterior se conserva en los archivos).', autor: ctx.usuario || 'Usuario', fecha: fs().serverTimestamp() });
        prog.listo(`${nombreActa(oc)} regenerada y guardada en la orden`, { informe: true });
        } catch (e) { prog.error(); throw e; }
    }

    /** Edita los datos de una recepción conforme ya registrada (fecha, guía/factura, contraparte, parcial, observaciones, quien recibe),
     *  rehace el acta y reemplaza el archivo guardado en la orden. Los productos y cantidades siguen lo recibido en la orden. */
    async function editar(ctx) {
        const { oc, toast } = ctx, centro = ctx.centroPropio || 'SAR', rc = oc.recepcionConforme;
        if (!rc) { toast('Sin recepción conforme', 'Esta orden aún no tiene recepción conforme registrada.', 'warning'); return; }
        const e = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const ov = document.createElement('div'); ov.className = 'cierre-overlay';
        ov.innerHTML = `<div class="cierre-box" role="dialog" aria-modal="true"><h3>Editar recepción conforme</h3>
            <p class="cierre-hint">Al guardar se rehace el acta con estos datos y reemplaza el archivo de la orden. Puedes corregir encabezado, productos y cantidades.</p>
            <div class="soc-fila"><label>Fecha<input type="date" id="rce-fecha" value="${e(rc.fecha || hoyISO())}"></label><label>Documento<select id="rce-tipo"><option value="GUIA"${rc.tipoDoc !== 'FACTURA' ? ' selected' : ''}>Guía de despacho</option><option value="FACTURA"${rc.tipoDoc === 'FACTURA' ? ' selected' : ''}>Factura</option></select></label><label>N° del documento<input id="rce-num" value="${e(rc.numeroDoc || '')}"></label></div>
            <div class="soc-fila"><label>Contraparte técnica<input id="rce-ct" value="${e(rc.contraparte || CONTRAPARTE_BASE)}"></label><label>Quien recibe (firma del correo)<input id="rce-rec" value="${e(rc.recibe || '')}"></label></div>
            <label class="soc-toggle"><input type="checkbox" id="rce-par"${rc.parcial ? ' checked' : ''}> Recepción parcial</label>
            <label>Encabezado del acta<textarea id="rce-enc" rows="2">${e(rc.encabezado || encabezadoBase(!!rc.parcial))}</textarea></label>
            <p class="cierre-hint">Detalle del acta (corrige productos y cantidades):</p>
            ${detalleHTML((rc.lineas && rc.lineas.length) ? rc.lineas : lineasActa(oc, centro).filter(l => l.recibido > 0), 'rce')}
            <label>Observaciones<textarea id="rce-obs" rows="3">${e(rc.observaciones || '')}</textarea></label>
            <div class="cierre-acciones"><button type="button" class="btn btn-outline" id="rce-x">Cancelar</button><button type="button" class="btn btn-primary" id="rce-ok">Guardar y rehacer el acta</button></div></div>`;
        document.body.appendChild(ov);
        const q = (s) => ov.querySelector(s); q('#rce-x').addEventListener('click', () => ov.remove());
        { let t = false; q('#rce-enc').addEventListener('input', () => { t = true; }); q('#rce-par').addEventListener('change', () => { if (!t) q('#rce-enc').value = encabezadoBase(q('#rce-par').checked); }); }
        q('#rce-ok').addEventListener('click', async () => {
            const nuevo = { ...rc, fecha: q('#rce-fecha').value || rc.fecha, tipoDoc: q('#rce-tipo').value, numeroDoc: q('#rce-num').value.trim(), contraparte: q('#rce-ct').value.trim() || CONTRAPARTE_BASE, recibe: q('#rce-rec').value.trim(), parcial: q('#rce-par').checked, observaciones: q('#rce-obs').value.trim(), encabezado: q('#rce-enc').value.trim(), lineas: leerDetalle(ov, 'rce'), editadaPor: ctx.usuario, editadaEn: hoyISO() };
            if (!nuevo.lineas.length) { toast('Detalle vacío', 'El acta debe tener al menos un producto con cantidad.', 'warning'); return; }
            if (!nuevo.numeroDoc) { toast('Falta el número', 'Indica el N° de la guía o factura.', 'warning'); return; }
            ov.remove();
            const prog = window.SAR_Progreso.iniciar('Guardando los cambios de la recepción conforme…', ['Actualizando los datos de la orden…']);
            try {
                await fs().updateDoc(fs().doc(fs().collection(db(), 'Seguimiento_OC'), oc.id), { recepcionConforme: nuevo, actualizadoEn: fs().serverTimestamp() });
                prog.paso('Rehaciendo el acta de recepción conforme…');
                const d = { fecha: nuevo.fecha, parcial: nuevo.parcial, observaciones: nuevo.observaciones, contraparte: nuevo.contraparte, conFirma: true, tipoDoc: nuevo.tipoDoc, numeroDoc: nuevo.numeroDoc, firmaNombre: nuevo.recibe, encabezado: nuevo.encabezado, lineas: nuevo.lineas };
                const PDFLib = await cargarPDFLib(); const logoBytes = await cargarLogo(); const firmaBytes = await cargarFirma();
                const acta = await generarActaPDF({ ...oc, recepcionConforme: nuevo }, d, centro, { PDFLib, logoBytes, firmaBytes });
                bajar(acta, nombreActa(oc));
                prog.paso('Reemplazando el archivo guardado en la orden…');
                if (ctx.eliminarCategoria) { await ctx.eliminarCategoria(oc.id, 'Recepción conforme'); await ctx.eliminarCategoria(oc.id, 'Recepción conforme (modelo vigente)'); }
                if (ctx.guardarArchivo) await ctx.guardarArchivo(oc.id, { nombre: nombreActa(oc), categoria: 'Recepción conforme', bytes: acta });
                await fs().setDoc(fs().doc(fs().collection(db(), 'Seguimiento_OC', oc.id, 'Eventos')), { tipo: 'CONFORME', texto: `Recepción conforme editada (${nuevo.tipoDoc === 'FACTURA' ? 'factura' : 'guía'} N° ${nuevo.numeroDoc}${nuevo.parcial ? ', parcial' : ''}). Se rehizo el acta y reemplazó el archivo anterior.`, autor: ctx.usuario, fecha: fs().serverTimestamp() });
                prog.listo('Recepción conforme actualizada y archivo reemplazado', { informe: true });
            } catch (err) { prog.error(); toast('No se guardó', err.message || String(err), 'error'); }
        });
    }

    window.SAR_RecepcionConforme = { cargarPDFLib, cargarLogo, cargarFirma, bajar, fechaCorta, CONTRAPARTE_BASE, FIRMA_BASE, editar, regenerar, abrir, nombreAdjunto, nombreActa, lineasActa, validar, armarCorreo, generarActaPDF, DESTINATARIOS_BASE };
})(window, document);
