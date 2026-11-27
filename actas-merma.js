/* ==========================================================================
   ACTA DE MERMA / BAJA DE INVENTARIO + ETIQUETA TÉRMICA MERMADO / VENCIDO
   (v21.278)
   --------------------------------------------------------------------------
   - Detecta automáticamente ajustes de salida por Merma, Dañado o Vencido
     (incluyendo lotes cuya fecha de vencimiento ya expiró).
   - Genera folio correlativo atómico AM-AAAA-NNNN dentro de la misma
     transacción del ajuste (Contadores/acta-merma-AAAA) y guarda el acta en
     Contadores/acta-merma-<folio> + espejo en Actas_Merma/<folio>.
   - Produce PDF institucional gemelo al Acta de Entrega (pdf-lib, logo SAR,
     encabezado, tabla de detalle y bloque de 3 firmas) + vista imprimible
     HTML fondo blanco puro.
   - Produce etiqueta térmica monocroma Zebra ZD230 (100×60 mm y 50×30 mm a
     203 dpi) con franja superior invertida negra (MERMADO - BAJA o
     VENCIDO - NO USAR), alternador manual, copias y código de barras Code 128
     con quiet zone segura.
   ========================================================================== */
(function (window, document) {
    'use strict';

    const PDFLIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
    const FMT_KEY = 'sar_etq_merma_fmt';
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const num = (v) => Number(v) || 0;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); };
    const lim = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim();

    // ---------------- lógica pura (unit-testable) ----------------
    const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    function folioMerma(anio, n) {
        return `AM-${anio}-${String(Math.max(1, Math.floor(num(n)))).padStart(4, '0')}`;
    }

    /** Convierte fecha (AAAA-MM-DD, AAAA-MM, DD/MM/AAAA, Timestamp, Date) a Date local o null. */
    function parseFecha(v) {
        if (!v || v === 'N/A' || v === 'S/R' || v === '—') return null;
        if (typeof v.toDate === 'function') return v.toDate();
        if (v instanceof Date) return isNaN(v) ? null : v;
        if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
        const s = String(v).trim();
        let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
        m = /^(\d{4})-(\d{2})$/.exec(s);
        if (m) return new Date(Number(m[1]), Number(m[2]), 0, 23, 59, 59); // último día del mes
        m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59);
        m = /^(\d{1,2})[\/\-](\d{4})$/.exec(s);
        if (m) return new Date(Number(m[2]), Number(m[1]), 0, 23, 59, 59);
        if (window.SAR_Utils && typeof window.SAR_Utils.parseDate === 'function') {
            try { const d = window.SAR_Utils.parseDate(s); if (d && !isNaN(d)) return d; } catch (_) { /* sigue */ }
        }
        const d = new Date(s);
        return isNaN(d) ? null : d;
    }

    function estaVencido(vence, refDate) {
        const d = parseFecha(vence);
        if (!d) return false;
        const hoy = refDate ? parseFecha(refDate) || new Date(refDate) : new Date();
        const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
        return d.getTime() < inicioHoy.getTime();
    }

    function fechaCL(v) {
        if (!v || v === 'N/A') return '—';
        const s = String(v).trim();
        let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        m = /^(\d{4})-(\d{2})$/.exec(s);
        if (m) return `${m[2]}/${m[1]}`;
        const d = parseFecha(v);
        if (!d) return s;
        return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    }

    function fechaHoraCL(v) {
        const d = parseFecha(v) || new Date();
        return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
            d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    }

    function fechaLarga(iso) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return '';
        return `${m[3]} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
    }

    const MOTIVOS_NO_MERMA = /conteo|digitaci[oó]n|traslado|cambio de bodega|devoluci[oó]n|correcci[oó]n|no se encontr[oó]|no est[aá]/i;
    const MOTIVOS_VENCIDO = /vencid|caduc|expir/i;
    const MOTIVOS_DANADO = /da[ñn]|rotura|quebr|averi|deterior/i;
    const MOTIVOS_MERMA = /merma|baja|desmedro/i;

    /**
     * Clasifica si un ajuste de salida dispara Acta de Merma + Etiqueta MERMADO/VENCIDO.
     * Devuelve { aplica, causal: 'VENCIDO'|'DANADO'|'MERMA'|null, etiqueta: 'VENCIDO'|'MERMADO'|null, textoCausal }.
     */
    function evaluarCausalAjuste({ motivo, cantidad, vence, fechaRef }) {
        const q = Number(cantidad);
        if (!(q < 0)) return { aplica: false, causal: null, etiqueta: null, textoCausal: '' };
        const m = String(motivo || '').trim();
        const venc = estaVencido(vence, fechaRef);
        const esVencMot = MOTIVOS_VENCIDO.test(m);
        const esDanMot = MOTIVOS_DANADO.test(m);
        const esMerMot = MOTIVOS_MERMA.test(m);
        const esExplicitoMerma = esVencMot || esDanMot || esMerMot;
        const esOtroExplicit = !esExplicitoMerma && MOTIVOS_NO_MERMA.test(m);

        if (!esExplicitoMerma && (!venc || esOtroExplicit)) {
            return { aplica: false, causal: null, etiqueta: null, textoCausal: '' };
        }
        if (esVencMot || venc) {
            return { aplica: true, causal: 'VENCIDO', etiqueta: 'VENCIDO', textoCausal: esVencMot ? 'Vencido' : (esDanMot ? 'Merma / Dañado (lote vencido)' : 'Vencido (lote expirado)') };
        }
        if (esDanMot && !esMerMot) {
            return { aplica: true, causal: 'DANADO', etiqueta: 'MERMADO', textoCausal: 'Dañado' };
        }
        return { aplica: true, causal: 'MERMA', etiqueta: 'MERMADO', textoCausal: esDanMot ? 'Merma / Dañado' : 'Merma' };
    }

    function textoFranjaEtiqueta(modo) {
        return String(modo || '').toUpperCase() === 'VENCIDO' ? 'VENCIDO - NO USAR' : 'MERMADO - BAJA';
    }

    /** Código compacto para Code 128 (prioriza folio AM dígitos o código SKU/lote). */
    function codigoBarrasDe(acta) {
        const fol = String((acta && (acta.folio || acta.numero)) || '').trim().toUpperCase();
        if (/^AM-\d{4}-\d{4,6}$/.test(fol)) return fol;
        const cod = String((acta && (acta.codigo || acta.codigoMP || acta.codigoAjuste)) || '').trim().toUpperCase();
        if (cod) return cod.slice(0, 18);
        return String((acta && acta.lote) || 'MERMA').trim().toUpperCase().slice(0, 18);
    }

    // ---------------- datos / consulta de fecha de ingreso ----------------
    async function buscarFechaIngresoLote(insumoNombre, insumoId, lote) {
        try {
            const f = fs(); if (!f || !db()) return '';
            const H = f.collection(db(), 'Historial_Movimientos');
            const qs = [];
            if (insumoNombre) qs.push(f.getDocs(f.query(H, f.where('insumoName', '==', insumoNombre), f.limit(120))).catch(() => null));
            if (insumoId) qs.push(f.getDocs(f.query(H, f.where('idInsumoDestino', '==', insumoId), f.limit(80))).catch(() => null));
            const snaps = await Promise.all(qs);
            const movs = [];
            snaps.forEach(sn => sn && sn.forEach(d => {
                const m = d.data();
                if (/INGRESO|entrada|carga masiva/i.test(String(m.type || ''))) movs.push(m);
            }));
            if (!movs.length) return '';
            const loteNorm = norm(lote);
            const ts = (m) => { const d = parseFecha(m.date || m.fechaDocumento || m.timestamp); return d ? d.getTime() : 0; };
            movs.sort((a, b) => ts(b) - ts(a));
            const exact = loteNorm && loteNorm !== 's/l' ? movs.find(m => norm(m.batch || m.lote) === loteNorm) : null;
            const pick = exact || movs[0];
            const d = parseFecha(pick.date || pick.fechaDocumento || pick.timestamp);
            return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
        } catch (_) { return ''; }
    }

    /** Espeja el acta en la colección Actas_Merma (si las reglas ya están publicadas; no falla si aún no). */
    async function espejarEnColeccion(acta) {
        if (!acta || !acta.folio) return;
        try {
            const f = fs();
            await f.setDoc(f.doc(f.collection(db(), 'Actas_Merma'), acta.folio), {
                ...acta,
                creadoEn: f.serverTimestamp()
            }, { merge: true });
        } catch (_) { /* Contadores/acta-merma-<folio> ya quedó guardado atómicamente en la transacción */ }
    }

    async function leerActa(folio) {
        const fol = String(folio || '').trim();
        if (!fol) return null;
        const f = fs();
        try {
            const s1 = await f.getDoc(f.doc(f.collection(db(), 'Actas_Merma'), fol));
            if (s1.exists()) return { id: s1.id, ...s1.data() };
        } catch (_) { /* lee desde Contadores */ }
        try {
            const s2 = await f.getDoc(f.doc(f.collection(db(), 'Contadores'), 'acta-merma-' + fol));
            if (s2.exists()) return { id: s2.id, ...s2.data() };
        } catch (_) { /* sin lectura */ }
        return null;
    }

    async function listarActas(lim) {
        const f = fs(), mapa = new Map();
        const max = lim || 300;
        const agregar = (d) => { const x = { id: d.id, ...d.data() }; const k = x.folio || x.numero || d.id; if (k && !mapa.has(k)) mapa.set(k, x); };
        try {
            const s1 = await f.getDocs(f.query(f.collection(db(), 'Actas_Merma'), f.limit(max)));
            s1.forEach(agregar);
        } catch (_) { /* aún sin regla o vacía */ }
        try {
            const s2 = await f.getDocs(f.query(f.collection(db(), 'Contadores'), f.where('tipo', '==', 'acta-merma'), f.limit(max)));
            s2.forEach(agregar);
        } catch (_) { /* sin lectura */ }
        return [...mapa.values()].sort((a, b) => String(b.fechaISO || b.fecha || '').localeCompare(String(a.fechaISO || a.fecha || '')) || String(b.folio || '').localeCompare(String(a.folio || '')));
    }

    // ---------------- PDF ACTA DE MERMA (gemelo institucional a Acta de Entrega) ----------------
    let pdfLibPromesa = null, logoPromesa = null;
    function cargarPDFLib() {
        if (window.PDFLib) return Promise.resolve(window.PDFLib);
        if (!pdfLibPromesa) pdfLibPromesa = new Promise((ok, mal) => {
            const s = document.createElement('script'); s.src = PDFLIB_URL;
            s.onload = () => ok(window.PDFLib);
            s.onerror = () => { pdfLibPromesa = null; mal(new Error('No se pudo cargar el generador de PDF (revisa tu conexión).')); };
            document.head.appendChild(s);
        });
        return pdfLibPromesa;
    }
    function cargarLogo() {
        if (!logoPromesa) logoPromesa = fetch('assets/logo-acta.png').then(r => { if (!r.ok) throw new Error('logo'); return r.arrayBuffer(); }).then(b => new Uint8Array(b)).catch(() => { logoPromesa = null; return null; });
        return logoPromesa;
    }

    async function generarPDFActa(acta, opc) {
        const PDFLib = await cargarPDFLib();
        const logoBytes = await cargarLogo();
        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        const doc = await PDFDocument.create();
        const fol = lim(acta.folio || acta.numero || 'AM-S/N');
        doc.setTitle(`Acta de Merma ${fol}`);
        doc.setAuthor('SAR Arpillerista Elsa Romo Aravena');
        doc.setCreator('Visor Logístico Clínico SAR');

        const F = await doc.embedFont(StandardFonts.Helvetica);
        const FB = await doc.embedFont(StandardFonts.HelveticaBold);
        const logo = logoBytes ? await doc.embedPng(logoBytes) : null;
        const W = 612, H = 792, negro = rgb(0, 0, 0), gris = rgb(0.28, 0.33, 0.4), grisClaro = rgb(0.95, 0.96, 0.97), borde = rgb(0.75, 0.78, 0.82);
        const Y = (y) => H - y;
        let page = doc.addPage([W, H]);

        const seguro = (font, s) => {
            const set = font.getCharacterSet();
            return Array.from(String(s == null ? '' : s).replace(/³/g, '3').replace(/²/g, '2').replace(/—/g, '-').replace(/–/g, '-')).map(c => set.includes(c.codePointAt(0)) ? c : '?').join('');
        };
        const ancho = (s, size, bold) => (bold ? FB : F).widthOfTextAtSize(seguro(bold ? FB : F, s), size);
        const texto = (s, x, y, size, bold, color) => {
            if (!s) return;
            page.drawText(seguro(bold ? FB : F, s), { x, y: Y(y), size, font: bold ? FB : F, color: color || negro });
        };
        const centrado = (s, cx, y, size, bold, color) => texto(s, cx - ancho(s, size, bold) / 2, y, size, bold, color);
        const linea = (x1, y1, x2, y2, g, col) => page.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, thickness: g || 0.75, color: col || negro });
        const rect = (x, y, w, h, fill, stroke) => page.drawRectangle({ x, y: Y(y + h), width: w, height: h, ...(fill ? { color: fill } : {}), ...(stroke ? { borderColor: stroke, borderWidth: 0.6 } : {}) });
        const caja = (x1, y1, x2, y2) => { linea(x1, y1, x2, y1); linea(x2, y1, x2, y2); linea(x2, y2, x1, y2); linea(x1, y2, x1, y1); };
        function envolver(s, size, bold, maxW) {
            const out = []; let cur = '';
            for (const w of String(s || '').split(/\s+/).filter(Boolean)) {
                const t = cur ? cur + ' ' + w : w;
                if (ancho(t, size, bold) <= maxW || !cur) cur = t; else { out.push(cur); cur = w; }
            }
            if (cur) out.push(cur);
            return out.length ? out : ['—'];
        }

        const ML = 45, MR = 567;
        // 1) Encabezado institucional idéntico al Acta de Entrega
        caja(40.6, 52, 567.5, 148);
        linea(142, 52, 142, 148);
        linea(142, 100, 567.5, 100);
        if (logo) { const w = 92, h = w * logo.height / logo.width; page.drawImage(logo, { x: 91.3 - w / 2, y: Y(100 + h / 2), width: w, height: h }); }
        centrado('ACTA DE MERMA / BAJA DE INVENTARIO', 354.7, 82, 14.5, true);
        centrado('SAR Arpillerista Elsa Romo Aravena', 354.7, 130, 15, true);

        // 2) Folio + Fecha/hora
        const fechaStr = fechaLarga(acta.fecha || (acta.fechaISO || '').slice(0, 10)) || fechaCL(acta.fechaISO || new Date());
        const horaStr = acta.hora || (acta.fechaISO ? new Date(acta.fechaISO).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '');
        texto(`N° ${fol}`, ML, 174, 12, true);
        const fDer = `${fechaStr}${horaStr ? ' · ' + horaStr + ' hrs.' : ''}`;
        texto(fDer, MR - ancho(fDer, 10.5, false), 174, 10.5, false);

        centrado('ACTA DE MERMA / BAJA DE INVENTARIO', 306, 204, 13, true);
        const wT = ancho('ACTA DE MERMA / BAJA DE INVENTARIO', 13, true);
        linea(306 - wT / 2, 207, 306 + wT / 2, 207, 0.9);

        // 3) Metadatos del ajuste
        let y = 224;
        rect(ML, y, MR - ML, 74, grisClaro, borde);
        const col2 = 315;
        texto('Bodega:', ML + 10, y + 16, 9, true, gris);
        texto(lim(acta.bodega || 'Bodega Central'), ML + 62, y + 16, 9.5, false);
        texto('Causal:', col2, y + 16, 9, true, gris);
        texto(lim(acta.textoCausal || acta.causal || 'Merma').toUpperCase(), col2 + 52, y + 16, 9.5, true);

        texto('Responsable:', ML + 10, y + 33, 9, true, gris);
        texto(lim(acta.responsable || acta.usuario || '—'), ML + 78, y + 33, 9.5, false);
        texto('Ajuste ref.:', col2, y + 33, 9, true, gris);
        texto(lim(acta.codigoAjuste || '—'), col2 + 58, y + 33, 9.5, false);

        texto('Observación:', ML + 10, y + 50, 9, true, gris);
        const obsL = envolver(lim(acta.observacion || 'Sin observación adicional.'), 9, false, MR - ML - 86).slice(0, 2);
        obsL.forEach((l, idx) => texto(l, ML + 78, y + 50 + idx * 11.5, 9, false));

        y += 92;
        texto('Se deja constancia de la baja / merma de inventario del siguiente insumo, debidamente rebajado y segregado:', ML, y, 9.8, false);
        y += 16;

        // 4) Tabla de detalle (Código / SKU, Descripción, Lote, Venc., Ingreso, Cant., Causal, Observación)
        const cols = [
            { t: 'Código / SKU', w: 58 },
            { t: 'Descripción', w: 144 },
            { t: 'Lote', w: 56 },
            { t: 'Vencim.', w: 52 },
            { t: 'Ingreso', w: 52 },
            { t: 'Cant.', w: 38, r: true },
            { t: 'Causal', w: 54 },
            { t: 'Observación', w: 68 }
        ];
        const xCols = []; let xc = ML;
        cols.forEach(c => { xCols.push(xc); xc += c.w; });
        const TW = xc - ML;

        // Cabecera tabla
        rect(ML, y, TW, 20, rgb(0.1, 0.21, 0.41), rgb(0.1, 0.21, 0.41));
        cols.forEach((c, i) => {
            const tx = c.r ? xCols[i] + c.w - 4 - ancho(c.t, 7.5, true) : xCols[i] + 4;
            texto(c.t, tx, y + 13, 7.5, true, rgb(1, 1, 1));
        });
        y += 20;

        const items = Array.isArray(acta.items) && acta.items.length ? acta.items : [{
            codigo: acta.codigo || acta.codigoMP || '—',
            descripcion: acta.descripcion || acta.insumoName || '—',
            lote: acta.lote || 'S/L',
            vence: acta.vence || '',
            fechaIngreso: acta.fechaIngreso || '',
            cantidad: Math.abs(num(acta.cantidad)),
            causal: acta.textoCausal || acta.causal || 'Merma',
            observacion: acta.observacion || ''
        }];

        items.forEach(it => {
            const vals = [
                lim(it.codigo || '—'),
                lim(it.descripcion || '—'),
                lim(it.lote || 'S/L'),
                fechaCL(it.vence),
                fechaCL(it.fechaIngreso),
                `${Math.abs(num(it.cantidad))} u.`,
                lim(it.causal || acta.textoCausal || acta.causal || 'Merma'),
                lim(it.observacion || '—')
            ];
            const wrapped = vals.map((v, i) => envolver(v, 7.8, i === 5, cols[i].w - 7));
            const maxLines = Math.max(1, ...wrapped.map(a => a.length));
            const rowH = Math.max(22, maxLines * 10.5 + 10);
            if (y + rowH > 620) {
                page = doc.addPage([W, H]);
                texto(`Acta de Merma N° ${fol} (continuación)`, ML, 55, 10, true);
                y = 80;
            }
            rect(ML, y, TW, rowH, rgb(1, 1, 1), borde);
            cols.forEach((c, i) => {
                if (i > 0) linea(xCols[i], y, xCols[i], y + rowH, 0.4, borde);
                wrapped[i].forEach((ln, li) => {
                    const tx = c.r ? xCols[i] + c.w - 4 - ancho(ln, 7.8, i === 5) : xCols[i] + 4;
                    texto(ln, tx, y + 12 + li * 10.5, 7.8, i === 5);
                });
            });
            y += rowH;
        });

        // Total mermado
        const tot = items.reduce((s, i) => s + Math.abs(num(i.cantidad)), 0);
        y += 14;
        texto(`Total unidades dadas de baja: ${tot.toLocaleString('es-CL')} unidad${tot === 1 ? '' : 'es'}.`, ML, y, 9.5, true);
        y += 16;
        texto('El producto rebajado queda físicamente segregado y rotulado conforme a procedimiento interno de bodega.', ML, y, 8.8, false, gris);

        // 5) Bloque de 3 firmas institucionales (siempre en bloque indivisible)
        let yf = Math.max(y + 82, 650);
        if (yf > 720) { page = doc.addPage([W, H]); yf = 160; }
        const firmas = [
            { tit: 'Responsable de Bodega / Logística', sub: lim(acta.responsable || '') },
            { tit: 'Revisión Clínica / Supervisión', sub: 'Nombre y firma' },
            { tit: 'Dirección Técnica / V°B°', sub: 'Nombre y firma' }
        ];
        const colW = (MR - ML - 32) / 3;
        firmas.forEach((fm, i) => {
            const x1 = ML + i * (colW + 16), x2 = x1 + colW, cx = (x1 + x2) / 2;
            linea(x1 + 6, yf, x2 - 6, yf, 0.75, negro);
            centrado(fm.tit, cx, yf + 13, 8.2, true);
            if (fm.sub) centrado(fm.sub.slice(0, 34), cx, yf + 24, 7.5, false, gris);
        });

        // Pie de página
        const pie = `Documento generado por Visor Logístico Clínico SAR · Folio ${fol} · Movimiento ${lim(acta.codigoAjuste || acta.movimientoId || '—')}`;
        centrado(pie, 306, 765, 7.5, false, gris);

        const bytes = await doc.save();
        if (opc && opc.soloBytes) return bytes;
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const nomArch = `ACTA_DE_MERMA_${fol}_${String(acta.fecha || new Date().toISOString().slice(0, 10))}.pdf`;
        const w = window.open(url, '_blank');
        if (!w) {
            const a = document.createElement('a'); a.href = url; a.download = nomArch; document.body.appendChild(a); a.click(); a.remove();
        }
        setTimeout(() => URL.revokeObjectURL(url), 120000);
        return { bytes, nombre: nomArch };
    }

    /** Vista HTML de impresión limpia (fondo blanco puro, print-color-adjust exact, break-inside avoid). */
    function imprimirHTMLActa(acta) {
        const fol = esc(acta.folio || 'AM-S/N');
        const items = Array.isArray(acta.items) && acta.items.length ? acta.items : [{
            codigo: acta.codigo || acta.codigoMP || '—',
            descripcion: acta.descripcion || acta.insumoName || '—',
            lote: acta.lote || 'S/L',
            vence: acta.vence || '',
            fechaIngreso: acta.fechaIngreso || '',
            cantidad: Math.abs(num(acta.cantidad)),
            causal: acta.textoCausal || acta.causal || 'Merma',
            observacion: acta.observacion || ''
        }];
        const logoUrl = new URL('assets/logo-acta.png', window.location.href).href;
        const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Acta de Merma ${fol}</title><style>
            @page { size: letter; margin: 16mm; }
            * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            body { margin: 0; background: #ffffff; color: #0f172a; font: 12px/1.45 "Segoe UI", Arial, sans-serif; }
            .hoja { max-width: 740px; margin: 0 auto; background: #ffffff; color: #0f172a; }
            .cab { display: grid; grid-template-columns: 140px 1fr; border: 1.5px solid #000; }
            .cab-lg { display: flex; align-items: center; justify-content: center; padding: 10px; border-right: 1.5px solid #000; }
            .cab-lg img { max-width: 112px; max-height: 76px; object-fit: contain; }
            .cab-t > div { padding: 12px 14px; text-align: center; font-weight: 700; font-size: 15px; }
            .cab-t > div:first-child { border-bottom: 1.5px solid #000; }
            .meta-top { display: flex; justify-content: space-between; margin: 16px 0 10px; font-size: 13px; }
            .titulo { text-align: center; font-size: 15px; font-weight: 700; text-decoration: underline; margin: 6px 0 14px; }
            .ficha { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; border: 1px solid #cbd5e1; background: #f8fafc; padding: 10px 14px; border-radius: 4px; margin-bottom: 14px; }
            .ficha .full { grid-column: 1 / -1; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; break-inside: avoid; page-break-inside: avoid; }
            th { background: #1A3668; color: #ffffff; font-size: 11px; text-align: left; padding: 7px 6px; border: 1px solid #1A3668; }
            td { padding: 7px 6px; border: 1px solid #cbd5e1; font-size: 11px; vertical-align: top; }
            td.num, th.num { text-align: right; white-space: nowrap; }
            .firmas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin-top: 64px; break-inside: avoid; page-break-inside: avoid; }
            .firma { text-align: center; border-top: 1px solid #000; padding-top: 6px; }
            .firma b { display: block; font-size: 11px; }
            .firma small { color: #475569; font-size: 10px; }
            .pie { margin-top: 28px; text-align: center; font-size: 10px; color: #475569; }
            @media print { body { background: #fff !important; color: #000 !important; } .no-print { display: none !important; } }
        </style></head><body><div class="hoja">
            <div class="no-print" style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;"><button onclick="window.print()" style="padding:8px 14px;background:#1A3668;color:#fff;border:0;border-radius:6px;font-weight:700;cursor:pointer;">Imprimir / Guardar PDF</button></div>
            <div class="cab"><div class="cab-lg"><img src="${esc(logoUrl)}" alt="SAR"></div><div class="cab-t"><div>ACTA DE MERMA / BAJA DE INVENTARIO</div><div>SAR Arpillerista Elsa Romo Aravena</div></div></div>
            <div class="meta-top"><b>N° ${fol}</b><span>${esc(fechaHoraCL(acta.fechaISO || acta.fecha))}</span></div>
            <div class="titulo">ACTA DE MERMA / BAJA DE INVENTARIO</div>
            <div class="ficha">
                <div><b>Bodega:</b> ${esc(acta.bodega || 'Bodega Central')}</div>
                <div><b>Causal:</b> ${esc((acta.textoCausal || acta.causal || 'Merma').toUpperCase())}</div>
                <div><b>Responsable:</b> ${esc(acta.responsable || acta.usuario || '—')}</div>
                <div><b>Ajuste ref.:</b> ${esc(acta.codigoAjuste || '—')}</div>
                <div class="full"><b>Observación:</b> ${esc(acta.observacion || '—')}</div>
            </div>
            <table><thead><tr><th>Código / SKU</th><th>Descripción</th><th>Lote</th><th>Vencimiento</th><th>Ingreso</th><th class="num">Cant.</th><th>Causal</th><th>Observación</th></tr></thead>
            <tbody>${items.map(i => `<tr><td>${esc(i.codigo || '—')}</td><td><b>${esc(i.descripcion || '—')}</b></td><td>${esc(i.lote || 'S/L')}</td><td>${esc(fechaCL(i.vence))}</td><td>${esc(fechaCL(i.fechaIngreso))}</td><td class="num"><b>${Math.abs(num(i.cantidad))} u.</b></td><td>${esc(i.causal || acta.textoCausal || 'Merma')}</td><td>${esc(i.observacion || '—')}</td></tr>`).join('')}</tbody></table>
            <div class="firmas">
                <div class="firma"><b>Responsable de Bodega / Logística</b><small>${esc(acta.responsable || '')}</small></div>
                <div class="firma"><b>Revisión Clínica / Supervisión</b><small>Nombre y firma</small></div>
                <div class="firma"><b>Dirección Técnica / V°B°</b><small>Nombre y firma</small></div>
            </div>
            <div class="pie">Visor Logístico Clínico SAR · Folio ${fol} · Ref. ${esc(acta.codigoAjuste || acta.movimientoId || '—')}</div>
        </div></body></html>`;
        const w = window.open('', '_blank');
        if (!w) { toast('Ventana bloqueada', 'Permite ventanas emergentes para imprimir.', 'warning'); return; }
        w.document.open(); w.document.write(html); w.document.close();
    }

    // ---------------- ETIQUETA TÉRMICA MERMADO / VENCIDO (Zebra ZD230 · 203 dpi · 100×60 y 50×30) ----------------
    async function pdfEtiquetaMerma(datos, opc) {
        const J = window.jspdf && window.jspdf.jsPDF;
        const P = window.SAR_Precintos;
        if (!J) throw new Error('La librería de PDF aún no carga; intenta de nuevo en unos segundos.');
        const o = opc || {};
        const formato = o.formato === '50x30' ? '50x30' : '100x60';
        const copias = Math.max(1, Math.min(100, Math.floor(num(o.copias || 1))));
        const modo = String(o.modo || datos.etiqueta || (datos.causal === 'VENCIDO' ? 'VENCIDO' : 'MERMADO')).toUpperCase() === 'VENCIDO' ? 'VENCIDO' : 'MERMADO';
        const franja = textoFranjaEtiqueta(modo);
        const W = formato === '50x30' ? 50 : 100;
        const H = formato === '50x30' ? 30 : 60;
        const PUNTO = 25.4 / 203;
        const snap = (v) => Math.round(v / PUNTO) * PUNTO;

        const d = new J({ orientation: 'landscape', unit: 'mm', format: [W, H] });
        const codeTxt = codigoBarrasDe(datos);
        const modulos = P && P.barrasB ? P.barrasB(codeTxt) : (P && P.barras ? P.barras(codeTxt) : null);

        const dibujarBarras = (y, alto, anchoMax, xIzq) => {
            if (!modulos || !modulos.length) return W / 2;
            const totMod = modulos.reduce((s, w) => s + w, 0);
            // Quiet zone >= 10 módulos a cada lado (estándar Code 128)
            const totConQZ = totMod + 20;
            const mod = Math.max(1, Math.floor((anchoMax / totConQZ) / PUNTO)) * PUNTO;
            const anchoReal = totMod * mod;
            const x0 = snap(xIzq + (anchoMax - anchoReal) / 2);
            let xx = x0;
            d.setFillColor(0, 0, 0);
            modulos.forEach((w, i) => {
                if (i % 2 === 0) d.rect(xx, y, w * mod, alto, 'F');
                xx += w * mod;
            });
            return x0 + anchoReal / 2;
        };

        const desc = lim(datos.descripcion || datos.insumoName || 'PRODUCTO').toUpperCase();
        const lote = lim(datos.lote || 'S/L');
        const venc = fechaCL(datos.vence);
        const ing = fechaCL(datos.fechaIngreso);
        const fol = lim(datos.folio || '');
        const fBaja = fechaCL(datos.fecha || datos.fechaISO || new Date());
        const cant = Math.abs(num(datos.cantidad));

        for (let c = 0; c < copias; c++) {
            if (c) d.addPage([W, H], 'landscape');
            d.setDrawColor(0, 0, 0);
            d.setTextColor(0, 0, 0);

            if (formato === '50x30') {
                // Franja superior invertida negra (alto contraste térmico)
                d.setFillColor(0, 0, 0);
                d.rect(0, 0, 50, 6.2, 'F');
                d.setTextColor(255, 255, 255);
                d.setFont('helvetica', 'bold');
                d.setFontSize(8.2);
                d.text(franja, 25, 4.4, { align: 'center' });

                d.setTextColor(0, 0, 0);
                d.setFont('helvetica', 'bold');
                d.setFontSize(6.6);
                const ln = d.splitTextToSize(desc, 46).slice(0, 2);
                d.text(ln, 2, 9.6);

                const yDat = ln.length > 1 ? 15.2 : 13.4;
                d.setFont('helvetica', 'bold'); d.setFontSize(6);
                d.text(`LOTE: ${lote.slice(0, 14)}`, 2, yDat);
                d.text(`VENC: ${venc}`, 48, yDat, { align: 'right' });
                d.setFont('helvetica', 'normal'); d.setFontSize(5.6);
                d.text(`ING: ${ing}${cant ? ' · ' + cant + ' u.' : ''}`, 2, yDat + 2.8);
                if (fol) d.text(fol, 48, yDat + 2.8, { align: 'right' });

                const cx = dibujarBarras(19.6, 6.8, 46, 2);
                d.setFont('helvetica', 'bold'); d.setFontSize(5.5);
                d.text(codeTxt, cx, 28.6, { align: 'center' });
            } else {
                // 100×60 mm Zebra ZD230
                d.setFillColor(0, 0, 0);
                d.rect(0, 0, 100, 11.5, 'F');
                d.setTextColor(255, 255, 255);
                d.setFont('helvetica', 'bold');
                d.setFontSize(15);
                d.text(franja, 50, 8.2, { align: 'center' });

                d.setTextColor(0, 0, 0);
                d.setFont('helvetica', 'bold');
                let tam = 11.5; d.setFontSize(tam);
                let ln = d.splitTextToSize(desc, 94);
                if (ln.length > 2) { tam = 9.5; d.setFontSize(tam); ln = d.splitTextToSize(desc, 94).slice(0, 2); }
                d.text(ln, 3, 17);

                let y = 17 + ln.length * (tam === 11.5 ? 4.6 : 3.9) + 1.5;
                d.setLineWidth(0.35); d.line(3, y - 2.2, 97, y - 2.2);

                d.setFont('helvetica', 'bold'); d.setFontSize(9.5);
                d.text(`LOTE: ${lote}`, 3, y + 2);
                d.text(`VENC: ${venc}`, 97, y + 2, { align: 'right' });

                d.setFont('helvetica', 'normal'); d.setFontSize(8.5);
                d.text(`ING: ${ing}${datos.bodega ? ' · ' + lim(datos.bodega).slice(0, 24) : ''}`, 3, y + 6.8);
                if (cant) { d.setFont('helvetica', 'bold'); d.text(`BAJA: ${cant} u.`, 97, y + 6.8, { align: 'right' }); }

                d.setFont('helvetica', 'bold'); d.setFontSize(8.2);
                d.text(`ACTA: ${fol || '—'}`, 3, y + 11.6);
                d.setFont('helvetica', 'normal');
                d.text(`FECHA BAJA: ${fBaja}`, 97, y + 11.6, { align: 'right' });

                const cx = dibujarBarras(43.5, 11, 94, 3);
                d.setFont('helvetica', 'bold'); d.setFontSize(7.8);
                d.text(codeTxt, cx, 57.8, { align: 'center' });
            }
        }

        const blob = d.output('blob');
        if (o.soloBlob) return blob;
        const nomArch = `etiqueta-${modo.toLowerCase()}-${fol || 'baja'}-${formato}.pdf`;
        const url = URL.createObjectURL(blob), w = window.open(url, '_blank');
        if (!w) d.save(nomArch);
        setTimeout(() => URL.revokeObjectURL(url), 120000);
        return { paginas: copias, bytes: blob.size, formato, modo, nombre: nomArch };
    }

    // ---------------- Modales UI (sin emojis, solo iconografía Phosphor SVG/font) ----------------
    function abrirModal(titulo, html, opc) {
        if (!(opc && opc.encima)) document.querySelectorAll('.am-ov').forEach(x => x.remove());
        const ov = document.createElement('div');
        ov.className = 'bu-ov am-ov';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.innerHTML = `<div class="bu-c am-c"><div class="bu-cab"><h3>${esc(titulo)}</h3><button type="button" class="fp-x bu-x" aria-label="Cerrar">×</button></div><div class="bu-b">${html}</div></div>`;
        const cerrar = () => { ov.remove(); document.removeEventListener('keydown', tecla, true); };
        const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } };
        ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.bu-x')) cerrar(); });
        document.addEventListener('keydown', tecla, true);
        document.body.appendChild(ov);
        ov.cerrar = cerrar;
        return ov;
    }

    /** Modal de etiqueta térmica MERMADO / VENCIDO con alternador manual, formato, copias y vista previa en vivo. */
    function abrirModalEtiqueta(datos, opc) {
        let modo = String((datos && (datos.etiqueta || (datos.causal === 'VENCIDO' ? 'VENCIDO' : 'MERMADO'))) || 'MERMADO').toUpperCase() === 'VENCIDO' ? 'VENCIDO' : 'MERMADO';
        let formato = '100x60';
        try { const sv = localStorage.getItem(FMT_KEY); if (sv === '50x30' || sv === '100x60') formato = sv; } catch (_) { /* sin storage */ }
        let copias = 1;

        const ov = abrirModal('Etiqueta térmica de baja (Zebra ZD230)', '<div id="am-etq-body"></div>', { encima: !!(opc && opc.encima) });
        const body = ov.querySelector('#am-etq-body');
        const P = window.SAR_Precintos;
        const codeTxt = codigoBarrasDe(datos);
        const svgBar = P && P.barrasSVG ? P.barrasSVG(codeTxt, 32, true) : '';

        const pintar = () => {
            const franja = textoFranjaEtiqueta(modo);
            const desc = lim(datos.descripcion || datos.insumoName || 'PRODUCTO').toUpperCase();
            const lote = lim(datos.lote || 'S/L');
            const venc = fechaCL(datos.vence);
            const ing = fechaCL(datos.fechaIngreso);
            const fol = lim(datos.folio || '—');
            const fBaja = fechaCL(datos.fecha || datos.fechaISO || new Date());
            const cant = Math.abs(num(datos.cantidad));

            body.innerHTML = `
              <div class="am-ctrl-grid">
                <div>
                  <span class="am-lbl">Franja superior (alto contraste térmico)</span>
                  <div class="am-seg" role="group" aria-label="Tipo de etiqueta">
                    <button type="button" class="btn btn-sm ${modo === 'MERMADO' ? 'btn-primary' : 'btn-outline'}" data-am-modo="MERMADO"><i class="ph-bold ph-warning-octagon"></i> MERMADO - BAJA</button>
                    <button type="button" class="btn btn-sm ${modo === 'VENCIDO' ? 'btn-primary' : 'btn-outline'}" data-am-modo="VENCIDO"><i class="ph-bold ph-calendar-x"></i> VENCIDO - NO USAR</button>
                  </div>
                </div>
                <div>
                  <span class="am-lbl">Formato térmico (203 dpi)</span>
                  <div class="am-seg" role="group" aria-label="Tamaño de etiqueta">
                    <button type="button" class="btn btn-sm ${formato === '100x60' ? 'btn-primary' : 'btn-outline'}" data-am-fmt="100x60">100 × 60 mm</button>
                    <button type="button" class="btn btn-sm ${formato === '50x30' ? 'btn-primary' : 'btn-outline'}" data-am-fmt="50x30">50 × 30 mm</button>
                  </div>
                </div>
                <div>
                  <label class="am-lbl" for="am-cop">Copias (cajas segregadas)</label>
                  <input id="am-cop" type="number" min="1" max="100" value="${copias}" class="form-control am-cop-in" inputmode="numeric">
                </div>
              </div>

              <div class="am-prev-wrap">
                <span class="am-lbl">Vista previa térmica (${formato === '50x30' ? '50 × 30 mm' : '100 × 60 mm'} · B/N)</span>
                <div class="am-thermal am-thermal--${formato}">
                  <div class="am-th-bar">${esc(franja)}</div>
                  <div class="am-th-body">
                    <div class="am-th-desc">${esc(desc)}</div>
                    <div class="am-th-row"><span><b>LOTE:</b> ${esc(lote)}</span><span><b>VENC:</b> ${esc(venc)}</span></div>
                    <div class="am-th-row"><span><b>ING:</b> ${esc(ing)}</span>${cant ? `<span><b>BAJA:</b> ${cant} u.</span>` : ''}</div>
                    ${formato === '100x60' ? `<div class="am-th-row am-th-meta"><span><b>ACTA:</b> ${esc(fol)}</span><span><b>BAJA:</b> ${esc(fBaja)}</span></div>` : ''}
                    <div class="am-th-code">${svgBar}<small>${esc(codeTxt)}</small></div>
                  </div>
                </div>
              </div>

              <div class="am-acc">
                <button type="button" class="btn btn-outline" id="am-etq-x">Cerrar</button>
                <button type="button" class="btn btn-primary" id="am-etq-go"><i class="ph-bold ph-printer"></i> Imprimir etiqueta (${copias} ${copias === 1 ? 'copia' : 'copias'})</button>
              </div>`;

            body.querySelectorAll('[data-am-modo]').forEach(b => b.onclick = () => { modo = b.dataset.amModo; pintar(); });
            body.querySelectorAll('[data-am-fmt]').forEach(b => b.onclick = () => {
                formato = b.dataset.amFmt;
                try { localStorage.setItem(FMT_KEY, formato); } catch (_) { /* nada */ }
                pintar();
            });
            const inpCop = body.querySelector('#am-cop');
            if (inpCop) inpCop.oninput = () => {
                copias = Math.max(1, Math.min(100, Math.floor(num(inpCop.value) || 1)));
                const bg = body.querySelector('#am-etq-go');
                if (bg) bg.innerHTML = `<i class="ph-bold ph-printer"></i> Imprimir etiqueta (${copias} ${copias === 1 ? 'copia' : 'copias'})`;
            };
            body.querySelector('#am-etq-x').onclick = () => ov.cerrar();
            body.querySelector('#am-etq-go').onclick = async (e) => {
                const btn = e.currentTarget; btn.disabled = true;
                try {
                    await pdfEtiquetaMerma(datos, { modo, formato, copias });
                    toast('Etiqueta generada', `${copias} etiqueta(s) ${textoFranjaEtiqueta(modo)} (${formato}).`, 'success');
                } catch (err) {
                    toast('No se pudo imprimir', err.message || String(err), 'error');
                } finally { btn.disabled = false; }
            };
        };
        pintar();
        return ov;
    }

    /** Pantalla de cierre inmediata tras ejecutar un ajuste por Merma / Dañado / Vencido. */
    function mostrarCierre(acta) {
        const causalBadge = acta.causal === 'VENCIDO' ? 'VENCIDO' : (acta.causal === 'DANADO' ? 'DAÑADO' : 'MERMA');
        const ov = abrirModal(`Baja registrada · ${acta.folio}`, `
          <div class="am-cierre">
            <div class="am-cierre-top">
              <div class="am-cierre-ico"><i class="ph-bold ph-file-check"></i></div>
              <div>
                <div class="am-badges">
                  <span class="am-badge am-badge--folio">${esc(acta.folio)}</span>
                  <span class="am-badge am-badge--causal">${esc(causalBadge)}</span>
                  ${acta.codigoAjuste ? `<span class="am-badge am-badge--ref">${esc(acta.codigoAjuste)}</span>` : ''}
                </div>
                <p class="am-cierre-sub">El ajuste de stock fue aplicado y el Acta de Merma quedó guardada en el sistema.</p>
              </div>
            </div>
            <div class="am-res-grid">
              <div><span>Producto</span><b>${esc(acta.descripcion || acta.insumoName || '—')}</b></div>
              <div><span>Bodega</span><b>${esc(acta.bodega || '—')}</b></div>
              <div><span>Lote</span><b>${esc(acta.lote || 'S/L')}</b></div>
              <div><span>Vencimiento</span><b>${esc(fechaCL(acta.vence))}</b></div>
              <div><span>Fecha de ingreso</span><b>${esc(fechaCL(acta.fechaIngreso))}</b></div>
              <div><span>Cantidad mermada</span><b class="text-danger">-${Math.abs(num(acta.cantidad)).toLocaleString('es-CL')} u.</b></div>
              <div class="full"><span>Observación</span><b>${esc(acta.observacion || '—')}</b></div>
            </div>
            <div class="am-acc am-acc--dest">
              <button type="button" class="btn btn-primary" id="am-btn-pdf"><i class="ph-bold ph-file-pdf"></i> Imprimir / Descargar Acta de Merma (PDF)</button>
              <button type="button" class="btn btn-secondary" id="am-btn-etq"><i class="ph-bold ph-barcode"></i> Imprimir Etiqueta MERMADO / VENCIDO</button>
            </div>
            <div class="am-acc am-acc--sec">
              <button type="button" class="btn btn-outline btn-sm" id="am-btn-html"><i class="ph-bold ph-printer"></i> Vista imprimible (HTML)</button>
              <button type="button" class="btn btn-outline btn-sm" id="am-btn-ok">Finalizar</button>
            </div>
          </div>`);
        ov.querySelector('#am-btn-pdf').onclick = async (e) => {
            const b = e.currentTarget; b.disabled = true;
            try { await generarPDFActa(acta); } catch (err) { toast('Acta PDF', err.message || String(err), 'error'); }
            finally { b.disabled = false; }
        };
        ov.querySelector('#am-btn-etq').onclick = () => abrirModalEtiqueta(acta, { encima: true });
        ov.querySelector('#am-btn-html').onclick = () => imprimirHTMLActa(acta);
        ov.querySelector('#am-btn-ok').onclick = () => ov.cerrar();
        return ov;
    }

    /** Reimpresión desde Historial de Movimientos o Actas de Merma por folio (o fallback con datos del movimiento). */
    async function reimprimirActa(folio, fallbackMov) {
        let acta = folio ? await leerActa(folio) : null;
        if (!acta && fallbackMov) {
            const ev = evaluarCausalAjuste({ motivo: fallbackMov.motivo || 'Merma', cantidad: -Math.abs(num(fallbackMov.quantity || 1)), vence: fallbackMov.venceLote || fallbackMov.expirationDate || '' });
            acta = {
                folio: folio || fallbackMov.actaMermaFolio || fallbackMov.document || 'AM-REF',
                codigoAjuste: fallbackMov.codigoSeguimiento || fallbackMov.document || '',
                movimientoId: fallbackMov.id || '',
                fecha: (fallbackMov.date && fallbackMov.date.toDate ? fallbackMov.date.toDate().toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)),
                fechaISO: (fallbackMov.date && fallbackMov.date.toDate ? fallbackMov.date.toDate().toISOString() : new Date().toISOString()),
                bodega: fallbackMov.bodega || fallbackMov.origin || 'Bodega Central',
                responsable: fallbackMov.user || '',
                causal: fallbackMov.causalMerma || ev.causal || 'MERMA',
                textoCausal: fallbackMov.motivo || ev.textoCausal || 'Merma',
                etiqueta: fallbackMov.etiquetaMerma || ev.etiqueta || 'MERMADO',
                observacion: fallbackMov.observacion || '',
                codigo: fallbackMov.codigoMP || fallbackMov.codigo || '',
                descripcion: fallbackMov.insumoName || fallbackMov.item || '',
                lote: fallbackMov.batch || fallbackMov.lote || 'S/L',
                vence: fallbackMov.venceLote || fallbackMov.expirationDate || '',
                fechaIngreso: fallbackMov.fechaIngresoLote || '',
                cantidad: Math.abs(num(fallbackMov.quantity))
            };
        }
        if (!acta) { toast('Acta de Merma', 'No se encontró el documento del acta.', 'warning'); return; }
        await generarPDFActa(acta);
    }

    async function reimprimirEtiqueta(folio, fallbackMov) {
        let acta = folio ? await leerActa(folio) : null;
        if (!acta && fallbackMov) {
            const ev = evaluarCausalAjuste({ motivo: fallbackMov.motivo || 'Merma', cantidad: -Math.abs(num(fallbackMov.quantity || 1)), vence: fallbackMov.venceLote || fallbackMov.expirationDate || '' });
            acta = {
                folio: folio || fallbackMov.actaMermaFolio || '',
                fecha: (fallbackMov.date && fallbackMov.date.toDate ? fallbackMov.date.toDate().toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)),
                bodega: fallbackMov.bodega || fallbackMov.origin || '',
                causal: fallbackMov.causalMerma || ev.causal || 'MERMA',
                etiqueta: fallbackMov.etiquetaMerma || ev.etiqueta || 'MERMADO',
                codigo: fallbackMov.codigoMP || fallbackMov.codigo || '',
                descripcion: fallbackMov.insumoName || fallbackMov.item || '',
                lote: fallbackMov.batch || fallbackMov.lote || 'S/L',
                vence: fallbackMov.venceLote || fallbackMov.expirationDate || '',
                fechaIngreso: fallbackMov.fechaIngresoLote || '',
                cantidad: Math.abs(num(fallbackMov.quantity))
            };
        }
        if (!acta) { toast('Etiqueta de Merma', 'No se encontraron datos para la etiqueta.', 'warning'); return; }
        abrirModalEtiqueta(acta);
    }

    /** Panel listado de Actas de Merma dentro de Ajustes de Stock (para reimprimir PDF o etiqueta en cualquier momento). */
    async function renderListado(container) {
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:18px;">Cargando actas de merma registradas…</p>';
        let lista = [];
        try { lista = await listarActas(300); } catch (e) { container.innerHTML = `<p class="text-danger" style="padding:18px;">No se pudieron cargar las actas de merma: ${esc(e.message || e)}</p>`; return; }
        let q = '';
        const pintar = () => {
            const t = norm(q);
            const vis = lista.filter(a => !t || norm([a.folio, a.descripcion, a.lote, a.bodega, a.responsable, a.textoCausal, a.codigoAjuste].join(' ')).includes(t));
            container.innerHTML = `
              <div class="am-list-bar">
                <input type="search" id="am-lst-q" class="form-control" value="${esc(q)}" placeholder="Buscar por folio AM, producto, lote, bodega o responsable…" autocomplete="off">
                <button type="button" class="btn btn-outline btn-sm" id="am-lst-ref"><i class="ph-bold ph-arrows-clockwise"></i> Actualizar</button>
              </div>
              ${vis.length ? `<div class="table-responsive"><table class="table"><thead><tr><th>Folio</th><th>Fecha</th><th>Producto</th><th>Lote / Vence</th><th>Bodega</th><th>Cantidad</th><th>Causal</th><th>Acciones</th></tr></thead><tbody>
                ${vis.map((a, idx) => `<tr>
                  <td><b>${esc(a.folio || '—')}</b>${a.codigoAjuste ? `<br><small class="text-muted">${esc(a.codigoAjuste)}</small>` : ''}</td>
                  <td>${esc(fechaCL(a.fecha || a.fechaISO))}</td>
                  <td><b>${esc(a.descripcion || '—')}</b>${a.codigo ? `<br><small class="text-muted">SKU ${esc(a.codigo)}</small>` : ''}</td>
                  <td>${esc(a.lote || 'S/L')}<br><small class="text-muted">Vence: ${esc(fechaCL(a.vence))}</small></td>
                  <td>${esc(a.bodega || '—')}</td>
                  <td class="text-danger font-bold">-${Math.abs(num(a.cantidad)).toLocaleString('es-CL')} u.</td>
                  <td><span class="am-badge am-badge--causal">${esc((a.causal || 'MERMA').toUpperCase())}</span></td>
                  <td><div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-primary btn-sm" data-am-pdf="${idx}"><i class="ph-bold ph-file-pdf"></i> Acta PDF</button>
                    <button type="button" class="btn btn-outline btn-sm" data-am-etq="${idx}"><i class="ph-bold ph-barcode"></i> Etiqueta</button>
                  </div></td>
                </tr>`).join('')}</tbody></table></div>` : '<p class="text-muted" style="padding:20px;text-align:center;">No hay actas de merma registradas.</p>'}`;
            const iq = container.querySelector('#am-lst-q');
            if (iq) iq.oninput = (e) => { const p = e.target.selectionStart; q = e.target.value; pintar(); const n = container.querySelector('#am-lst-q'); if (n) { n.focus(); n.setSelectionRange(p, p); } };
            const br = container.querySelector('#am-lst-ref');
            if (br) br.onclick = () => renderListado(container);
            container.querySelectorAll('[data-am-pdf]').forEach(b => b.onclick = () => generarPDFActa(vis[Number(b.dataset.amPdf)]).catch(e => toast('PDF', e.message || String(e), 'error')));
            container.querySelectorAll('[data-am-etq]').forEach(b => b.onclick = () => abrirModalEtiqueta(vis[Number(b.dataset.amEtq)]));
        };
        pintar();
    }

    const api = {
        folioMerma, parseFecha, estaVencido, fechaCL, evaluarCausalAjuste, textoFranjaEtiqueta, codigoBarrasDe,
        buscarFechaIngresoLote, espejarEnColeccion, leerActa, listarActas,
        generarPDFActa, imprimirHTMLActa, pdfEtiquetaMerma,
        abrirModalEtiqueta, mostrarCierre, reimprimirActa, reimprimirEtiqueta, renderListado
    };
    window.SAR_ActasMerma = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
