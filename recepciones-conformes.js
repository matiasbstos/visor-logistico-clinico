/* ==========================================================================
   RECEPCIONES CONFORMES POR RECEPCIÓN (v21.29)
   Cada recepción registrada en una OC (REC-xxxx) tiene su propio documento de
   "Recepción conforme": se arma con lo que llegó en ESA recepción (productos y
   cantidades), con el mismo modelo de la Corporación, en PDF y en Word. Se puede
   editar (fecha, N° de guía/factura, contraparte, total/parcial, observaciones y las
   líneas del documento) sin tocar el stock: es solo el documento. Los cambios se
   guardan en la recepción (recepciones[].conforme) y los archivos se rehacen al
   descargarlos, así que siempre salen con los datos vigentes.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (v) => Number(v) || 0;
    const hoyISO = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
    const RC = () => window.SAR_RecepcionConforme, AD = () => window.SAR_ActaDoc;

    /** Líneas del documento: las editadas, o lo recibido en esa recepción (agrupado por producto). */
    function lineasDe(rec) {
        if (rec.conforme && Array.isArray(rec.conforme.lineas)) return rec.conforme.lineas.map(l => ({ producto: l.producto, recibido: num(l.cantidad) }));
        const m = new Map();
        (rec.detalle || []).forEach(d => { const k = String(d.descripcion || ''); if (!k) return; m.set(k, (m.get(k) || 0) + num(d.cantidad)); });
        return [...m.entries()].map(([producto, recibido]) => ({ producto, recibido })).filter(l => l.recibido > 0);
    }
    /** ¿Queda algo por recibir de SAR en esa orden? (para proponer Parcial/Total). */
    function hayPendiente(oc) {
        return RC().lineasActa(oc, 'SAR').some(l => num(l.pedido) > num(l.recibido));
    }
    function datos(oc, rec, parcialPorDefecto) {
        const c = rec.conforme || {};
        return {
            fecha: c.fecha || rec.fecha || hoyISO(), tipoDoc: c.tipoDoc || 'GUIA', numeroDoc: c.numeroDoc != null ? c.numeroDoc : (rec.guia || ''),
            contraparte: c.contraparte || RC().CONTRAPARTE_BASE, parcial: typeof c.parcial === 'boolean' ? c.parcial : !!parcialPorDefecto,
            observaciones: c.observaciones || '', conFirma: c.conFirma !== false, lineas: lineasDe(rec)
        };
    }
    const nombreBase = (oc, rec) => `RC ${String(oc.numeroOC || '').replace(/[^A-Za-z0-9-]+/g, '')} ${rec.recId}`.trim();

    async function pdf(oc, rec, parcial) {
        const [PDFLib, logoBytes, firmaBytes] = await Promise.all([RC().cargarPDFLib(), RC().cargarLogo(), RC().cargarFirma()]);
        return RC().generarActaPDF(oc, datos(oc, rec, parcial), 'SAR', { PDFLib, logoBytes, firmaBytes });
    }
    // El logo de la Corporación es JPG: Word lo necesita como PNG dentro del paquete.
    async function logoPNG() {
        try {
            const bytes = await RC().cargarLogo(); if (!bytes) return null;
            const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = URL.createObjectURL(new Blob([bytes])); });
            const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
            const blob = await new Promise(r => c.toBlob(r, 'image/png')); return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
        } catch (e) { return null; }
    }
    function cuerpoWord(oc, d, logo) {
        const A = AD(), { run, par } = A, fc = RC().fechaCorta, cont = [];
        if (logo) {
            const w = Math.round(1.1 * 914400 * 1.0), h = Math.round(w * logo.h / logo.w);
            cont.push(par(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="1" name="Logo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, { despues: 120 }));
        }
        cont.push(par(run('RECEPCIÓN CONFORME PRODUCTO O SERVICIO' + (d.parcial ? ' PARCIAL' : ''), { b: true, sz: 22 }), { jc: 'center', despues: 360 }));
        cont.push(par(run('DATOS DEL PROVEEDOR', { b: true, sz: 21 }), { jc: 'center', despues: 200 }));
        cont.push(par(run('Nombre de la empresa: ' + (oc.proveedor || ''), { b: true, sz: 21 }), { despues: 120 }));
        cont.push(par(run('RUT: ' + (oc.rutProveedor || ''), { b: true, sz: 21 }), { despues: 120 }));
        cont.push(par(run('Orden de Compra: ' + (oc.numeroOC || ''), { b: true, sz: 21 }), { despues: 120 }));
        cont.push(par(run(`Con fecha ${fc(d.fecha)}, en calidad de contraparte técnica, certifico lo siguiente:`, { sz: 21 }), { despues: 160 }));
        const celdaTxt = (t, o) => par(run(t, o), { despues: 60 });
        const items = d.lineas.map(l => par(run('• ' + String(l.producto).toUpperCase() + ` (CANTIDAD:${String(Math.round(num(l.recibido))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')})`, { sz: 21 }), { ind: { left: 360, hanging: 240 }, despues: 60 })).join('');
        const encab = celdaTxt(`Que se recibió conforme en forma ${d.parcial ? 'Parcial' : 'Total'} de los productos, donde se recibió lo siguiente:`, { sz: 17 });
        const obs = d.observaciones ? celdaTxt('Observaciones: ' + d.observaciones, { sz: 17 }) : '';
        cont.push(`<w:tbl><w:tblPr><w:tblW w:w="8640" w:type="dxa"/><w:tblBorders>${A.borde}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="8640"/></w:tblGrid><w:tr>${A.celda(8640, encab + items + obs)}</w:tr></w:tbl>`);
        cont.push(par('', { antes: 700, despues: 0 }));
        cont.push(par(run('________________________________', { sz: 21 }), { jc: 'center', despues: 40 }));
        cont.push(par(run('Firma contraparte técnica', { sz: 21 }), { jc: 'center', despues: 120 }));
        cont.push(par(run('Nombre Contraparte Técnica: ' + (d.contraparte || ''), { sz: 21 }), { jc: 'center', despues: 0 }));
        return cont;
    }
    async function docx(oc, rec, parcial) {
        const logo = await logoPNG();
        return AD().empaquetar(cuerpoWord(oc, datos(oc, rec, parcial), logo), logo ? logo.bytes : null);
    }
    function bajarArchivo(bytes, nombre, mime) {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: mime })); a.download = nombre; document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
    const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    async function descargar(oc, rec, tipo, toast) {
        const prog = window.SAR_Progreso ? window.SAR_Progreso.iniciar(`Preparando la recepción conforme ${rec.recId}…`, [tipo === 'docx' ? 'Armando el documento Word…' : 'Armando el PDF…']) : null;
        try {
            const parcial = hayPendiente(oc), base = nombreBase(oc, rec);
            if (tipo === 'docx') bajarArchivo(await docx(oc, rec, parcial), base + '.docx', MIME_DOCX); else bajarArchivo(await pdf(oc, rec, parcial), base + '.pdf', 'application/pdf');
            if (prog) prog.listo(`${base}.${tipo} listo y descargado`, { informe: false, ms: 4000 });
        } catch (e) { if (prog) prog.error(); if (toast) toast('No se pudo generar', e.message || String(e), 'error'); }
    }

    /** Ventana para editar el documento de una recepción conforme (no toca el stock). */
    function editar(ctx) {
        const { oc, rec, toast } = ctx, d = datos(oc, rec, hayPendiente(oc));
        const ov = document.createElement('div'); ov.className = 'cierre-overlay';
        const filaL = (l) => `<div class="soc-fila rce-l"><label>Producto<input class="rce-p" value="${esc(l.producto)}"></label><label>Cantidad<input class="rce-c" type="number" min="1" value="${num(l.recibido)}"></label><button type="button" class="btn btn-outline btn-sm rce-q" aria-label="Quitar">✕</button></div>`;
        ov.innerHTML = `<div class="cierre-box" role="dialog" aria-modal="true"><h3>Editar recepción conforme ${esc(rec.recId)}</h3>
            <p class="cierre-hint">Cambia solo el documento (no mueve el stock). Al guardar puedes descargar el PDF y el Word con estos datos.</p>
            <div class="soc-fila"><label>Fecha<input type="date" id="rcx-fecha" value="${esc(d.fecha)}"></label><label>Documento<select id="rcx-tipo"><option value="GUIA"${d.tipoDoc !== 'FACTURA' ? ' selected' : ''}>Guía de despacho</option><option value="FACTURA"${d.tipoDoc === 'FACTURA' ? ' selected' : ''}>Factura</option></select></label><label>N° documento<input id="rcx-num" value="${esc(d.numeroDoc)}"></label></div>
            <label>Contraparte técnica<input id="rcx-ct" value="${esc(d.contraparte)}"></label>
            <label class="soc-toggle"><input type="checkbox" id="rcx-par"${d.parcial ? ' checked' : ''}> Recepción parcial</label>
            <label class="soc-toggle"><input type="checkbox" id="rcx-firma"${d.conFirma ? ' checked' : ''}> Incluir firma de la contraparte en el PDF</label>
            <h4>Productos del documento</h4><div id="rcx-ls">${d.lineas.map(filaL).join('')}</div>
            <button type="button" class="btn btn-outline btn-sm" id="rcx-add">+ Agregar línea</button>
            <label>Observaciones<textarea id="rcx-obs" rows="2">${esc(d.observaciones)}</textarea></label>
            <div class="cierre-acciones"><button type="button" class="btn btn-outline" id="rcx-x">Cancelar</button><button type="button" class="btn btn-primary" id="rcx-ok">Guardar cambios</button></div></div>`;
        document.body.appendChild(ov);
        const q = (s) => ov.querySelector(s);
        q('#rcx-x').addEventListener('click', () => ov.remove());
        q('#rcx-add').addEventListener('click', () => q('#rcx-ls').insertAdjacentHTML('beforeend', filaL({ producto: '', recibido: 1 })));
        ov.addEventListener('click', (e) => { const b = e.target.closest('.rce-q'); if (b) b.closest('.rce-l').remove(); });
        q('#rcx-ok').addEventListener('click', async () => {
            const lineas = [...ov.querySelectorAll('.rce-l')].map(r => ({ producto: r.querySelector('.rce-p').value.trim(), cantidad: Math.floor(num(r.querySelector('.rce-c').value)) })).filter(l => l.producto && l.cantidad > 0);
            if (!lineas.length) { toast('Sin productos', 'El documento debe tener al menos un producto con cantidad.', 'warning'); return; }
            const conforme = { fecha: q('#rcx-fecha').value || d.fecha, tipoDoc: q('#rcx-tipo').value, numeroDoc: q('#rcx-num').value.trim(), contraparte: q('#rcx-ct').value.trim() || RC().CONTRAPARTE_BASE, parcial: q('#rcx-par').checked, conFirma: q('#rcx-firma').checked, observaciones: q('#rcx-obs').value.trim(), lineas, editadoPor: ctx.usuario || '', editadoEn: hoyISO() };
            const prog = window.SAR_Progreso ? window.SAR_Progreso.iniciar('Guardando la recepción conforme…', ['Guardando los cambios en la orden…']) : null;
            try {
                ov.remove();
                const f = fs(), ref = f.doc(f.collection(db(), 'Seguimiento_OC'), oc.id), snap = await f.getDoc(ref);
                const recs = (snap.data().recepciones || []).map(r => r.recId === rec.recId ? { ...r, conforme } : r);
                await f.updateDoc(ref, { recepciones: recs, actualizadoEn: f.serverTimestamp() });
                await f.setDoc(f.doc(f.collection(db(), 'Seguimiento_OC', oc.id, 'Eventos')), { tipo: 'CONFORME', texto: `Recepción conforme ${rec.recId} editada (${conforme.tipoDoc === 'FACTURA' ? 'factura' : 'guía'} N° ${conforme.numeroDoc || 's/n'}${conforme.parcial ? ', parcial' : ''}).`, autor: ctx.usuario || 'Usuario', fecha: f.serverTimestamp() });
                if (prog) prog.listo(`Recepción conforme ${rec.recId} actualizada. Descarga el PDF o el Word desde la lista de recepciones.`, { informe: false, ms: 6000 });
            } catch (e) { if (prog) prog.error(); toast('No se guardó', e.message || String(e), 'error'); }
        });
    }

    /** Ventana que aparece al terminar de guardar una recepción: ofrece sus documentos. */
    function ofrecer(ctx) {
        const { oc, rec, toast } = ctx;
        const ov = document.createElement('div'); ov.className = 'cierre-overlay';
        ov.innerHTML = `<div class="cierre-box" role="dialog" aria-modal="true"><h3>Recepción ${esc(rec.recId)} guardada</h3>
            <p class="cierre-hint">Quedó cargada. Estos son los documentos de la recepción conforme (también los encuentras después en "Recepciones" de la orden, donde se pueden editar).</p>
            <ul class="soc-arch"><li><i class="ph-bold ph-file-pdf"></i><div><strong>Recepción conforme (PDF)</strong><small>${num(rec.unidades)} unidades · modelo de la Corporación</small></div><button type="button" class="btn btn-primary btn-sm" id="rco-pdf">Descargar PDF</button></li>
            <li><i class="ph-bold ph-file-doc"></i><div><strong>Recepción conforme (Word)</strong><small>Editable</small></div><button type="button" class="btn btn-outline btn-sm" id="rco-docx">Descargar Word</button></li></ul>
            <div class="cierre-acciones"><button type="button" class="btn btn-outline" id="rco-ed">Editar datos</button><button type="button" class="btn btn-outline" id="rco-x">Cerrar</button></div></div>`;
        document.body.appendChild(ov);
        const q = (s) => ov.querySelector(s);
        q('#rco-x').addEventListener('click', () => ov.remove());
        q('#rco-pdf').addEventListener('click', () => descargar(oc, rec, 'pdf', toast));
        q('#rco-docx').addEventListener('click', () => descargar(oc, rec, 'docx', toast));
        q('#rco-ed').addEventListener('click', () => { ov.remove(); editar({ oc, rec, toast, usuario: ctx.usuario }); });
    }
    window.SAR_RecepConf = { ofrecer, editar, descargar, lineasDe, datos, cuerpoWord, hayPendiente };
    if (typeof module !== 'undefined') module.exports = window.SAR_RecepConf;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
