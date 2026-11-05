/* ==========================================================================
   ACTA DE ENTREGA — GENERADORES DE ARCHIVO (v20.37)
   --------------------------------------------------------------------------
   Reproducen el "ACTA DE ENTREGA - FORMATO" del SAR: encabezado con logo, fecha,
   lista de lo entregado, productos pendientes, apartado opcional de documentos
   asociados (SDC, factura, guía, OC…) y cuadro de firmas.
   - generarPDF:  pdf-lib (fuente Helvetica, tamaños ajustados para que los saltos
                  de línea coincidan con el modelo en Calibri).
   - generarDOCX: archivo Word editable escrito a mano (OOXML + zip sin compresión),
                  con Calibri y medidas del modelo.
   Entrada: acta = { numero, fecha:'AAAA-MM-DD', centro, items:[{nombre,cantidad}],
                     pendientes:[{nombre,cantidad}], documentos:[{tipo,numero,detalle}],
                     entrega:{nombre,cargo}, recibe:{nombre,cargo} }
   ========================================================================== */
(function (window) {
    'use strict';

    const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    function fechaLarga(iso) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return '';
        return `${m[3]} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
    }
    const lim = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim();
    function nombreArchivo(acta, ext) {
        const b = lim(acta.bodegaOrigen), m = String(acta.fecha || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (b && m) return `ACTA DE ENTREGA - ${b.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\\/:*?"<>|]+/g, ' ')} - ${m[3]}-${m[2]}-${m[1]}.${ext}`;
        const centro = lim(acta.centro).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
        return `Acta_${lim(acta.numero)}${centro ? '_' + centro : ''}.${ext}`;
    }
    const fechaCorta2 = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : ''; };
    // Modelo: "PILA ALCALINA BLISTER AAA 2 UN — Entregado: 24 unidades con fecha del 03/11/26"
    const lineaItem = (it, acta) => `${lim(it.nombre)} — Entregado: ${it.cantidad} ${Number(it.cantidad) === 1 ? 'unidad' : 'unidades'}${acta && acta.fecha ? ' con fecha del ' + fechaCorta2(acta.fecha) : ''}`;
    const lineaPend = (it) => `${lim(it.nombre)} — Pendiente: ${it.cantidad}`;
    const lineaDoc = (d) => `${lim(d.tipo)}${d.numero ? ' N° ' + lim(d.numero) : ''}${d.detalle ? ' — ' + lim(d.detalle) : ''}`;
    const docsValidos = (acta) => (acta.documentos || []).filter(d => lim(d.tipo) || lim(d.numero));

    // ---------------------------------------------------------------
    // PDF
    // ---------------------------------------------------------------
    async function generarPDF(acta, { PDFLib, logoBytes }) {
        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        const doc = await PDFDocument.create();
        doc.setTitle(`Acta de entrega ${acta.numero}`); doc.setAuthor('SAR Arpillerista Elsa Romo Aravena'); doc.setCreator('Sistema de inventario SAR');
        const F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold);
        const logo = logoBytes ? await doc.embedPng(logoBytes) : null;
        const HF = 0.91;                       // Calibri → Helvetica: mismo ancho de texto
        const W = 612, H = 792, negro = rgb(0, 0, 0);
        let page = doc.addPage([W, H]);
        const Y = (y) => H - y;
        const seguro = (font, s) => { const set = font.getCharacterSet(); return Array.from(String(s).replace(/³/g, '3').replace(/²/g, '2')).map(c => set.includes(c.codePointAt(0)) ? c : '?').join(''); };
        // Helvetica es más ancha que Calibri, sobre todo en MAYÚSCULAS: el factor se elige por párrafo
        const fct = (s) => { const l = String(s).replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, ''); return l && (l.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length / l.length) > 0.6 ? 0.85 : HF; };
        const ancho = (s, size, bold, hf) => (bold ? FB : F).widthOfTextAtSize(seguro(bold ? FB : F, s), size * (hf || HF));
        const texto = (s, x, y, size, bold, hf) => { if (s) page.drawText(seguro(bold ? FB : F, s), { x, y: Y(y), size: size * (hf || HF), font: bold ? FB : F, color: negro }); };
        const centrado = (s, cx, y, size, bold) => texto(s, cx - ancho(s, size, bold) / 2, y, size, bold);
        const linea = (x1, y1, x2, y2, g) => page.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, thickness: g || 0.75, color: negro });
        const caja = (x1, y1, x2, y2) => { linea(x1, y1, x2, y1); linea(x2, y1, x2, y2); linea(x2, y2, x1, y2); linea(x1, y2, x1, y1); };
        function envolver(s, size, bold, maxW, hf) {
            const out = []; let cur = '';
            for (const w of String(s).split(' ')) {
                const t = cur ? cur + ' ' + w : w;
                if (ancho(t, size, bold, hf) <= maxW || !cur) cur = t; else { out.push(cur); cur = w; }
            }
            if (cur) out.push(cur);
            return out;
        }
        const ML = 85, MR = 527, BASE = 740;     // márgenes del modelo (3 cm) y límite inferior
        let y;
        function nuevaPagina() {
            page = doc.addPage([W, H]);
            texto(`Acta de entrega N° ${acta.numero} (continuación)`, ML, 60, 10, true);
            y = 95;
        }
        const necesita = (alto) => { if (y + alto > BASE) nuevaPagina(); };

        // Encabezado (caja con logo, título y establecimiento)
        caja(40.6, 57.6, 567.5, 155.8); linea(142, 57.6, 142, 155.8); linea(142, 106.7, 567.5, 106.7);
        if (logo) { const w = 92.9, h = w * logo.height / logo.width; page.drawImage(logo, { x: 91.3 - w / 2, y: Y(106.7 + h / 2), width: w, height: h }); }
        centrado('ACTA DE ENTREGA', 354.7, 89, 18, true);
        centrado('SAR Arpillerista Elsa Romo Aravena', 354.7, 138, 18, true);
        // N° de acta (a la izquierda) y fecha (a la derecha)
        texto(`N° ${acta.numero}`, ML, 183, 12, true);
        const f = fechaLarga(acta.fecha); texto(f, MR - ancho(f, 16, false), 183, 16, false);
        centrado('ACTA DE ENTREGA', 306, 215, 16, true);
        const wT = ancho('ACTA DE ENTREGA', 16, true); linea(306 - wT / 2, 217.5, 306 + wT / 2, 217.5, 0.9);
        texto(`Se hace entrega al centro ${lim(acta.centro)} de lo siguiente:`, ML, 269, 12, false);
        y = 298;

        // Lo entregado
        (acta.items || []).forEach((it, i) => {
            const hf = fct(lineaItem(it, acta)), ls = envolver(lineaItem(it, acta), 12, false, MR - 121, hf);
            necesita(ls.length * 15.8 + 5);
            texto(`${i + 1}.`, 108, y, 12, false);
            ls.forEach((l, k) => texto(l, 121, y + k * 15.8, 12, false, hf));
            y += ls.length * 15.8 + 4.6;
        });
        // Pendientes
        const pend = acta.pendientes || [];
        if (pend.length) {
            y += 12; necesita(40);
            texto('PRODUCTOS SOLICITADOS QUE AÚN NO LLEGAN (pendientes de entrega):', ML, y, 12, true); y += 16.7;
            pend.forEach(it => {
                const hf = fct(lineaPend(it)), ls = envolver('• ' + lineaPend(it), 12, false, MR - ML, hf);
                necesita(ls.length * 16.7); ls.forEach((l, k) => texto(l, ML, y + k * 16.7, 12, false, hf)); y += ls.length * 16.7;
            });
        }
        // Documentos asociados (opcional)
        const docs = docsValidos(acta);
        if (docs.length) {
            y += 12; necesita(40);
            texto('DOCUMENTOS ASOCIADOS:', ML, y, 12, true); y += 16.7;
            docs.forEach(d => { const hf = fct(lineaDoc(d)), ls = envolver('• ' + lineaDoc(d), 12, false, MR - ML, hf); necesita(ls.length * 16.7); ls.forEach((l, k) => texto(l, ML, y + k * 16.7, 12, false, hf)); y += ls.length * 16.7; });
        }
        // Firmas (siempre completas en una misma página)
        y += 33; necesita(125);
        const x1 = 85, xm = 302.4, x2 = 508, t0 = y - 14;
        const rEnt = 15.7, rNom = 29.5, rFirma = 73.3;
        caja(x1, t0, x2, t0 + rEnt + rNom + rFirma); linea(xm, t0, xm, t0 + rEnt + rNom + rFirma);
        linea(x1, t0 + rEnt, x2, t0 + rEnt); linea(x1, t0 + rEnt + rNom, x2, t0 + rEnt + rNom);
        centrado('Entrega', (x1 + xm) / 2, t0 + 12, 12, true); centrado('Recibe', (xm + x2) / 2, t0 + 12, 12, true);
        const ent = acta.entrega || {}, rec = acta.recibe || {};
        const nombres = (p, cx) => { const a = lim(p.nombre).toUpperCase(), b = lim(p.cargo).toUpperCase(); if (a) centrado(a, cx, t0 + rEnt + 12, 12, true); if (b) centrado(b, cx, t0 + rEnt + 26, 12, true); };
        nombres(ent, (x1 + xm) / 2); nombres(rec, (xm + x2) / 2);
        texto('Firma:', x1 + 5, t0 + rEnt + rNom + 13, 12, true); texto('Firma:', xm + 5, t0 + rEnt + rNom + 13, 12, true);
        return doc.save();
    }

    // ---------------------------------------------------------------
    // Zip mínimo (sin compresión) para armar el .docx
    // ---------------------------------------------------------------
    const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    function zip(archivos) {
        const enc = new TextEncoder(), partes = [], central = []; let offset = 0;
        const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
        for (const a of archivos) {
            const nombre = enc.encode(a.nombre), datos = typeof a.datos === 'string' ? enc.encode(a.datos) : a.datos, crc = crc32(datos);
            const cab = new Uint8Array([0x50, 0x4B, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(datos.length), ...u32(datos.length), ...u16(nombre.length), ...u16(0)]);
            partes.push(cab, nombre, datos);
            central.push({ nombre, crc, tam: datos.length, offset });
            offset += cab.length + nombre.length + datos.length;
        }
        let tamCentral = 0; const cd = [];
        for (const c of central) {
            const h = new Uint8Array([0x50, 0x4B, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c.crc), ...u32(c.tam), ...u32(c.tam), ...u16(c.nombre.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset)]);
            cd.push(h, c.nombre); tamCentral += h.length + c.nombre.length;
        }
        const fin = new Uint8Array([0x50, 0x4B, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(tamCentral), ...u32(offset), ...u16(0)]);
        const todo = [...partes, ...cd, fin], total = todo.reduce((t, p) => t + p.length, 0), out = new Uint8Array(total); let o = 0;
        for (const p of todo) { out.set(p, o); o += p.length; }
        return out;
    }

    // ---------------------------------------------------------------
    // DOCX
    // ---------------------------------------------------------------
    const x = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const run = (t, o = {}) => `<w:r><w:rPr>${o.b ? '<w:b/>' : ''}${o.u ? '<w:u w:val="single"/>' : ''}${o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : ''}</w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
    const par = (runs, o = {}) => `<w:p><w:pPr>${o.keep ? '<w:keepNext/>' : ''}<w:spacing w:before="${o.antes || 0}" w:after="${o.despues == null ? 160 : o.despues}"${o.linea ? ` w:line="${o.linea}" w:lineRule="auto"` : ''}/>${o.ind ? `<w:ind w:left="${o.ind.left}" w:hanging="${o.ind.hanging}"/>` : ''}${o.jc ? `<w:jc w:val="${o.jc}"/>` : ''}</w:pPr>${runs}</w:p>`;
    const borde = '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
    const celda = (ancho, contenido, o = {}) => `<w:tc><w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>${o.vm ? `<w:vMerge${o.vm === 'start' ? ' w:val="restart"' : ''}/>` : ''}${o.va ? `<w:vAlign w:val="${o.va}"/>` : ''}</w:tcPr>${contenido}</w:tc>`;

    function generarDOCX(acta, { logoBytes }) {
        const ent = acta.entrega || {}, rec = acta.recibe || {};
        const cuerpo = [];
        const imgW = Math.round(92.9 * 12700), imgH = Math.round(92.9 * (199 / 258) * 12700);
        const imagen = logoBytes ? `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${imgW}" cy="${imgH}"/><wp:docPr id="1" name="Logo SAR"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${imgW}" cy="${imgH}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>` : '';
        // Encabezado: tabla de 2 columnas; el logo ocupa las dos filas de la izquierda
        const centro = (t) => par(run(t, { b: true, sz: 36 }), { jc: 'center', despues: 0, linea: 240 });
        cuerpo.push(`<w:tbl><w:tblPr><w:tblW w:w="10538" w:type="dxa"/><w:tblInd w:w="-888" w:type="dxa"/><w:tblBorders>${borde}<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2028"/><w:gridCol w:w="8510"/></w:tblGrid>
            <w:tr><w:trPr><w:trHeight w:val="982" w:hRule="atLeast"/></w:trPr>${celda(2028, par(imagen, { jc: 'center', despues: 0, linea: 240 }), { vm: 'start', va: 'center' })}${celda(8510, centro('ACTA DE ENTREGA'), { va: 'center' })}</w:tr>
            <w:tr><w:trPr><w:trHeight w:val="982" w:hRule="atLeast"/></w:trPr>${celda(2028, par('', { despues: 0 }), { vm: 'cont' })}${celda(8510, centro('SAR Arpillerista Elsa Romo Aravena'), { va: 'center' })}</w:tr></w:tbl>`);
        // Número y fecha (tabulador derecho al margen)
        cuerpo.push(`<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="8820"/></w:tabs><w:spacing w:before="240" w:after="160"/></w:pPr>${run(`N° ${acta.numero}`, { b: true })}<w:r><w:tab/></w:r>${run(fechaLarga(acta.fecha), { sz: 32 })}</w:p>`);
        cuerpo.push(par(run('ACTA DE ENTREGA', { b: true, u: true, sz: 32 }), { jc: 'center', antes: 28, despues: 770 }));
        cuerpo.push(par(run(`Se hace entrega al centro ${lim(acta.centro)} de lo siguiente:`), { despues: 270 }));
        (acta.items || []).forEach((it, i) => cuerpo.push(par(run(`${i + 1}.`) + '<w:r><w:tab/></w:r>' + run(lineaItem(it, acta)), { ind: { left: 720, hanging: 270 }, despues: 90 })));
        if ((acta.pendientes || []).length) {
            cuerpo.push(par(run('PRODUCTOS SOLICITADOS QUE AÚN NO LLEGAN (pendientes de entrega):', { b: true }), { antes: 240, despues: 40, keep: true }));
            acta.pendientes.forEach(it => cuerpo.push(par(run('• ' + lineaPend(it)), { despues: 0 })));
        }
        const docs = docsValidos(acta);
        if (docs.length) {
            cuerpo.push(par(run('DOCUMENTOS ASOCIADOS:', { b: true }), { antes: 200, despues: 40, keep: true }));
            docs.forEach(d => cuerpo.push(par(run('• ' + lineaDoc(d)), { despues: 0 })));
        }
        // Cuadro de firmas
        const nombres = (p) => par(run(lim(p.nombre).toUpperCase(), { b: true }), { jc: 'center', despues: 0, linea: 240 }) + par(run(lim(p.cargo).toUpperCase(), { b: true }), { jc: 'center', despues: 0, linea: 240 });
        const fila = (alto, a, b, h) => `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${alto}" w:hRule="atLeast"/></w:trPr>${celda(4348, a)}${celda(4112, b)}</w:tr>`;
        cuerpo.push(par('', { antes: 190, despues: 0, keep: true }));
        cuerpo.push(`<w:tbl><w:tblPr><w:tblW w:w="8460" w:type="dxa"/><w:tblBorders>${borde}<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4348"/><w:gridCol w:w="4112"/></w:tblGrid>
            ${fila(0, par(run('Entrega', { b: true }), { jc: 'center', despues: 0, keep: true, linea: 240 }), par(run('Recibe', { b: true }), { jc: 'center', despues: 0, keep: true, linea: 240 }))}
            ${fila(0, nombres(ent), lim(rec.nombre) || lim(rec.cargo) ? nombres(rec) : par('', { despues: 0, linea: 240 }))}
            ${fila(1466, par(run('Firma:', { b: true }), { despues: 0, linea: 240 }), par(run('Firma:', { b: true }), { despues: 0, linea: 240 }))}</w:tbl>`);
        cuerpo.push(par('', { despues: 0 }));
        const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
        const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${cuerpo.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1152" w:right="1701" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
        const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="es-CL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
        const archivos = [
            { nombre: '[Content_Types].xml', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
            { nombre: '_rels/.rels', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
            { nombre: 'word/document.xml', datos: documento },
            { nombre: 'word/styles.xml', datos: estilos },
            { nombre: 'word/_rels/document.xml.rels', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${logoBytes ? '<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>' : ''}</Relationships>` }
        ];
        if (logoBytes) archivos.push({ nombre: 'word/media/logo.png', datos: logoBytes });
        return zip(archivos);
    }

    window.SAR_ActaDoc = { generarPDF, generarDOCX, fechaLarga, nombreArchivo, lineaItem, lineaPend, lineaDoc };
    if (typeof module !== 'undefined') module.exports = window.SAR_ActaDoc;
})(typeof window !== 'undefined' ? window : globalThis);
