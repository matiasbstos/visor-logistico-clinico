/* ==========================================================================
   FACTURACIÓN, PRESUPUESTO ANTI-SOBREGIRO Y RECEPCIÓN CONFORME DE OXÍGENO (v21.260)
   --------------------------------------------------------------------------
   Módulo aislado dentro de Oxígeno (#view-oxigeno -> pestaña Facturación).
   Colecciones Firestore:
     - oxigeno_proveedores
     - oxigeno_presupuestos
     - oxigeno_facturas
   Respaldos en Firebase Storage:
     - oxigeno/facturas/{rut}/{folio}.{ext}
   Correlativo de Actas de Recepción Conforme (Ley 19.983):
     - RCO-AAAA-NNNNN (Contadores/ctr-rco-AAAA)
   No almacena datos de pacientes.
   ========================================================================== */
(function (window, document) {
    'use strict';

    const RECINTO_BASE = 'SAR Arpillerista Elsa Romo Aravena';
    const GEMINI_ENDPOINT_DEFAULT = 'https://us-central1-sarinventario.cloudfunctions.net/extraerFacturaOxigeno';
    const TOLERANCIA_REDONDEO = 2;

    const fs = () => window.firebaseFirestore;
    const db = () => window.firebaseDb;
    const stg = () => window.firebaseStorage;
    const stgSdk = () => window.firebaseStorageSdk;
    const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
    const esc = (s) => {
        if (typeof window.escapeHTML === 'function') return window.escapeHTML(String(s == null ? '' : s));
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    };
    const num = (v) => {
        if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
        const s = String(v == null ? '' : v).trim().replace(/\$/g, '').replace(/\s+/g, '');
        if (!s) return 0;
        if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.')) || 0;
        if (/^-?\d+,\d+$/.test(s)) return Number(s.replace(',', '.')) || 0;
        return Number(s.replace(/[^\d.-]/g, '')) || 0;
    };
    const clp = (n) => '$' + Math.round(num(n)).toLocaleString('es-CL');
    const pctFmt = (p) => (Math.round(num(p) * 10) / 10).toFixed(1).replace('.', ',') + '%';
    const pad = (n, w) => String(Math.max(0, Math.floor(Number(n) || 0))).padStart(w || 2, '0');
    const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };
    const normRut = (r) => String(r || '').toUpperCase().replace(/[^0-9K]/g, '');
    const fmtRut = (r) => {
        const c = normRut(r);
        if (c.length < 2) return String(r || '').trim();
        const cuerpo = c.slice(0, -1), dv = c.slice(-1);
        return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
    };
    const slug = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const fechaCL = (iso) => {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '—');
    };
    const fmtPeriodo = (p) => {
        const m = String(p || '').match(/^(\d{4})-(\d{2})$/);
        if (!m) return String(p || '—');
        const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return `${meses[Number(m[2]) - 1] || m[2]} ${m[1]}`;
    };

    // =========================================================================
    // 1. LÓGICA PURA (exportada y verificable en tests/unidad.js sin navegador)
    // =========================================================================

    /** Detecta tipo de servicio (ARRIENDO | RECARGA | MIXTO) a partir de texto e ítems. */
    function detectarTipoServicio(texto, items) {
        const corpus = [
            String(texto || ''),
            ...(Array.isArray(items) ? items.map(i => `${i.codigo || ''} ${i.descripcion || ''} ${i.unidad || ''}`) : [])
        ].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

        const esArriendo = /\b(RENTAL|ARRIENDO|ARRENDAMIENTO|RENTA|DIA[S]?[-\s]?CILINDRO|MANTENCION\s+CILINDRO|CANON)\b/.test(corpus);
        const esRecarga = /\b(RECARGA|CARGA\s+DE\s+OXIGENO|OXIGENO\s+MEDICINAL|OXIGENO\s+LIQUIDO|OXIGENO\s+GASEOSO|M3|METRO[S]?\s+CUBICO[S]?|GAS\s+MEDICINAL|AIRE\s+COMPRIMIDO)\b/.test(corpus);
        if (esArriendo && esRecarga) return 'MIXTO';
        if (esArriendo) return 'ARRIENDO';
        if (esRecarga) return 'RECARGA';
        return 'ARRIENDO';
    }

    /** Extrae texto de una etiqueta XML sin depender de DOMParser (soporta Node tests y navegador). */
    function xmlTag(xml, tag) {
        const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, 'i');
        const m = String(xml || '').match(re);
        return m ? decodificarXml(m[1].trim()) : '';
    }
    function xmlBloques(xml, tag) {
        const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, 'gi');
        const out = []; let m;
        while ((m = re.exec(String(xml || ''))) !== null) out.push(m[1]);
        return out;
    }
    function decodificarXml(s) {
        return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    }

    /** Parsea un XML DTE del SII Chile (<Encabezado>, <Emisor>, <Totales>, <Detalle>, <Referencia>). */
    function parsearXmlDte(xmlString) {
        const raw = String(xmlString || '');
        if (!/<(?:[a-zA-Z0-9_]+:)?(DTE|Documento|Encabezado)\b/i.test(raw)) {
            throw new Error('El archivo XML no corresponde a un DTE válido del SII.');
        }
        const enc = xmlTag(raw, 'Encabezado') || raw;
        const idDoc = xmlTag(enc, 'IdDoc') || enc;
        const emisor = xmlTag(enc, 'Emisor') || enc;
        const totales = xmlTag(enc, 'Totales') || enc;

        const folio = xmlTag(idDoc, 'Folio').replace(/^0+(?=\d)/, '');
        const fechaEmision = xmlTag(idDoc, 'FchEmis').slice(0, 10);
        const fechaVencimiento = xmlTag(idDoc, 'FchVenc').slice(0, 10);
        const rutEmisor = fmtRut(xmlTag(emisor, 'RUTEmisor'));
        const razonSocial = xmlTag(emisor, 'RznSoc');

        const neto = Math.round(num(xmlTag(totales, 'MntNeto')));
        const exento = Math.round(num(xmlTag(totales, 'MntExe')));
        const iva = Math.round(num(xmlTag(totales, 'IVA')));
        const totalBruto = Math.round(num(xmlTag(totales, 'MntTotal'))) || (neto + exento + iva);

        const detalles = xmlBloques(raw, 'Detalle');
        const items = detalles.map((det) => {
            const cdgBlock = xmlTag(det, 'CdgItem');
            const codigo = xmlTag(cdgBlock, 'VlrCodigo') || xmlTag(det, 'VlrCodigo') || '';
            const nmb = xmlTag(det, 'NmbItem');
            const dsc = xmlTag(det, 'DscItem');
            const descripcion = dsc && !nmb.toLowerCase().includes(dsc.toLowerCase()) ? `${nmb} — ${dsc}` : (nmb || dsc);
            const cantidad = num(xmlTag(det, 'QtyItem')) || 1;
            const unidad = xmlTag(det, 'UnmdItem') || 'UN';
            const valorUnitario = num(xmlTag(det, 'PrcItem'));
            const valorTotal = Math.round(num(xmlTag(det, 'MontoItem'))) || Math.round(cantidad * valorUnitario);
            return { codigo, descripcion, cantidad, unidad, valorUnitario: valorUnitario || (cantidad ? Math.round(valorTotal / cantidad) : valorTotal), valorTotal };
        });

        let numeroOC = '', reemplazaFactura = '', facturaSAP = '';
        const refs = xmlBloques(raw, 'Referencia');
        refs.forEach((rf) => {
            const tpo = xmlTag(rf, 'TpoDocRef').toUpperCase();
            const folRef = xmlTag(rf, 'FolioRef').trim();
            const razon = xmlTag(rf, 'RazonRef').trim();
            if ((tpo === '801' || /ORDEN\s+DE\s+COMPRA|\bOC\b/i.test(razon)) && folRef && !numeroOC) {
                numeroOC = folRef.toUpperCase();
            } else if ((['33', '34', '61', '56'].includes(tpo) || /REEMPLAZ|ANULA|REFACTUR|SUSTITUY/i.test(razon)) && folRef && !reemplazaFactura) {
                reemplazaFactura = folRef.replace(/^0+(?=\d)/, '');
            } else if (/SAP|HES|MIGO/i.test(tpo + ' ' + razon) && folRef && !facturaSAP) {
                facturaSAP = folRef;
            }
        });

        // También busca factura reemplazada o SAP en glosas / ítems si no vino en Referencia
        const textoGlobal = `${razonSocial} ${items.map(i => i.descripcion).join(' ')} ${refs.map(r => xmlTag(r, 'RazonRef')).join(' ')}`;
        if (!reemplazaFactura) {
            const mr = textoGlobal.match(/REEMPLAZA\s*(?:A\s*)?(?:FACT(?:URA)?\.?\s*(?:N[°º.]?\s*)?)?(\d{4,12})/i);
            if (mr) reemplazaFactura = mr[1];
        }
        if (!facturaSAP) {
            const ms = textoGlobal.match(/(?:FACTURA\s*SAP|DOC\.?\s*SAP|SAP\s*N[°º.:]?)\s*[:#-]?\s*([A-Z0-9-]{4,20})/i);
            if (ms) facturaSAP = ms[1];
        }

        const periodoServicio = detectarPeriodoServicio(textoGlobal, fechaEmision);
        const tipoServicio = detectarTipoServicio(textoGlobal, items);

        return {
            origenLectura: 'XML_DTE',
            razonSocial,
            rutEmisor,
            folio,
            fechaEmision,
            fechaVencimiento,
            numeroOC,
            facturaSAP,
            reemplazaFactura,
            periodoServicio,
            tipoServicio,
            items,
            neto: neto || exento,
            iva,
            totalBruto
        };
    }

    /** Infiere el período de servicio YYYY-MM desde el texto (ej. "Julio 2026" o "07/2026") o fecha de emisión. */
    function detectarPeriodoServicio(texto, fechaEmision) {
        const t = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
        const meses = { ENERO: '01', FEBRERO: '02', MARZO: '03', ABRIL: '04', MAYO: '05', JUNIO: '06', JULIO: '07', AGOSTO: '08', SEPTIEMBRE: '09', SETIEMBRE: '09', OCTUBRE: '10', NOVIEMBRE: '11', DICIEMBRE: '12' };
        const mMes = t.match(/\b(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s*(?:DE\s+|DEL\s+|[-/]\s*)?(20\d{2})\b/);
        if (mMes) return `${mMes[2]}-${meses[mMes[1]]}`;
        const mPer = t.match(/PERIODO\s*(?:DE\s*SERVICIO)?[:\s-]*(\d{2})[-/](20\d{2})/i);
        if (mPer) return `${mPer[2]}-${mPer[1]}`;
        if (/^\d{4}-\d{2}/.test(String(fechaEmision || ''))) return String(fechaEmision).slice(0, 7);
        return hoyISO().slice(0, 7);
    }

    /** Normaliza fechas DD/MM/AAAA, DD-MM-AAAA o AAAA-MM-DD a ISO AAAA-MM-DD. */
    function fechaAISO(txt) {
        const s = String(txt || '').trim();
        let m = s.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
        if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
        m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
        if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
        return '';
    }

    /** Parser heurístico de texto OCR (respaldo local con Tesseract.js / PDF texto). */
    function parsearTextoFacturaOcr(texto) {
        const raw = String(texto || '').replace(/\r\n/g, '\n');
        const mRut = raw.match(/R\.?U\.?T\.?\s*[:#-]?\s*(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])/i) || raw.match(/\b(\d{2}\.\d{3}\.\d{3}-[\dkK])\b/);
        const rutEmisor = mRut ? fmtRut(mRut[1]) : '';

        let razonSocial = '';
        if (/INDURA/i.test(raw)) razonSocial = 'INDURA S.A.';
        else if (/LINDE/i.test(raw)) razonSocial = 'LINDE GAS CHILE S.A.';
        else if (/AIR\s*LIQUIDE/i.test(raw)) razonSocial = 'AIR LIQUIDE CHILE S.A.';
        else if (/MESSER/i.test(raw)) razonSocial = 'MESSER CHILE S.A.';
        else {
            const l0 = raw.split('\n').map(l => l.trim()).find(l => l.length > 4 && /(S\.A\.|LTDA|SPA|LIMITADA|GASES|OXIGENO)/i.test(l) && !/R\.?U\.?T|FACTURA|SII/i.test(l));
            if (l0) razonSocial = l0.slice(0, 80);
        }

        const mFolio = raw.match(/(?:FACTURA\s+ELECTR[OÓ]NICA[\s\S]{0,40}?N[°º.:]?\s*|FOLIO\s*(?:N[°º.:]?)?\s*)(\d{4,12})/i);
        const folio = mFolio ? mFolio[1].replace(/^0+(?=\d)/, '') : '';

        const mOC = raw.match(/\b(\d{5,8}\s*-\s*\d{1,5}\s*-\s*[A-Z]{2}\d{2})\b/i) || raw.match(/(?:ORDEN\s+DE\s+COMPRA|O\.?\s*C\.?)\s*[:#N°º.-]*\s*([A-Z0-9-]{5,25})/i);
        const numeroOC = mOC ? mOC[1].replace(/\s+/g, '').toUpperCase() : '';

        const mSap = raw.match(/(?:FACTURA\s*SAP|DOC\.?\s*SAP|SAP\s*N[°º.:]?)\s*[:#-]?\s*([A-Z0-9-]{4,20})/i);
        const facturaSAP = mSap ? mSap[1].trim() : '';

        const mReemp = raw.match(/(?:REEMPLAZA|ANULA|REFACTURA)\s*(?:A\s*)?(?:FACT(?:URA)?\.?\s*(?:N[°º.:]?\s*)?)?(\d{4,12})/i);
        const reemplazaFactura = mReemp ? mReemp[1].replace(/^0+(?=\d)/, '') : '';

        const mEmis = raw.match(/FECHA\s*(?:DE\s*)?EMISI[OÓ]N\s*[:|-]?\s*([0-9./-]{8,10})/i);
        const mVenc = raw.match(/FECHA\s*(?:DE\s*)?VENC(?:IMIENTO)?\s*[:|-]?\s*([0-9./-]{8,10})/i);
        const fechaEmision = mEmis ? fechaAISO(mEmis[1]) : '';
        const fechaVencimiento = mVenc ? fechaAISO(mVenc[1]) : '';

        const montoPor = (re) => {
            const m = raw.match(re);
            return m ? Math.round(num(m[1])) : 0;
        };
        const neto = montoPor(/(?:MONTO\s+NETO|VALOR\s+NETO|\bNETO\b)\s*[:$]?\s*\$?\s*([\d.,]{3,15})/i);
        const iva = montoPor(/(?:I\.?V\.?A\.?\s*(?:19%?)?)\s*[:$]?\s*\$?\s*([\d.,]{3,15})/i);
        const totalBruto = montoPor(/(?:MONTO\s+TOTAL|TOTAL\s+BRUTO|TOTAL\s+A\s+PAGAR|\bTOTAL\b)\s*[:$]?\s*\$?\s*([\d.,]{3,15})/i) || (neto + iva);

        const items = [];
        const mDias = raw.match(/(\d{1,5})\s*(?:D[IÍ]AS?[-\s]?CILINDRO|CILINDRO[-\s]?D[IÍ]A)/i);
        if (mDias) {
            const cant = Number(mDias[1]) || 1;
            const vt = neto || totalBruto;
            items.push({ codigo: 'RENTA', descripcion: `Arriendo cilindros oxígeno medicinal (${cant} días-cilindro)`, cantidad: cant, unidad: 'días-cilindro', valorUnitario: cant ? Math.round(vt / cant) : vt, valorTotal: vt });
        } else if (neto || totalBruto) {
            items.push({ codigo: '', descripcion: detectarTipoServicio(raw, []) === 'RECARGA' ? 'Recarga oxígeno medicinal' : 'Arriendo / servicio oxígeno medicinal', cantidad: 1, unidad: 'GL', valorUnitario: neto || totalBruto, valorTotal: neto || totalBruto });
        }

        return {
            origenLectura: 'OCR_LOCAL',
            razonSocial,
            rutEmisor,
            folio,
            fechaEmision,
            fechaVencimiento,
            numeroOC,
            facturaSAP,
            reemplazaFactura,
            periodoServicio: detectarPeriodoServicio(raw, fechaEmision),
            tipoServicio: detectarTipoServicio(raw, items),
            items,
            neto,
            iva,
            totalBruto
        };
    }

    /** Normaliza la respuesta JSON proveniente de Gemini Vision (Cloud Function). */
    function normalizarRespuestaIA(d) {
        const x = d || {};
        const items = Array.isArray(x.items) ? x.items.map(it => ({
            codigo: String(it.codigo || '').trim(),
            descripcion: String(it.descripcion || '').trim(),
            cantidad: num(it.cantidad) || 1,
            unidad: String(it.unidad || 'UN').trim(),
            valorUnitario: Math.round(num(it.valorUnitario)),
            valorTotal: Math.round(num(it.valorTotal))
        })).filter(it => it.descripcion || it.valorTotal) : [];
        const neto = Math.round(num(x.neto));
        const iva = Math.round(num(x.iva));
        const totalBruto = Math.round(num(x.totalBruto)) || (neto + iva);
        const tipoServicio = ['ARRIENDO', 'RECARGA', 'MIXTO'].includes(String(x.tipoServicio || '').toUpperCase())
            ? String(x.tipoServicio).toUpperCase()
            : detectarTipoServicio(`${x.razonSocial || ''} ${x.periodoServicio || ''}`, items);
        return {
            origenLectura: 'GEMINI_VISION',
            razonSocial: String(x.razonSocial || '').trim(),
            rutEmisor: x.rutEmisor ? fmtRut(x.rutEmisor) : '',
            folio: String(x.folio || '').trim().replace(/^0+(?=\d)/, ''),
            fechaEmision: fechaAISO(x.fechaEmision) || String(x.fechaEmision || '').slice(0, 10),
            fechaVencimiento: fechaAISO(x.fechaVencimiento) || String(x.fechaVencimiento || '').slice(0, 10),
            numeroOC: String(x.numeroOC || '').trim().toUpperCase(),
            facturaSAP: String(x.facturaSAP || '').trim(),
            reemplazaFactura: String(x.reemplazaFactura || '').trim().replace(/^0+(?=\d)/, ''),
            periodoServicio: String(x.periodoServicio || '').trim() || detectarPeriodoServicio('', x.fechaEmision),
            tipoServicio,
            items,
            neto,
            iva,
            totalBruto
        };
    }

    /** Valida una factura antes de guardar: duplicado por proveedor, cuadratura Neto+IVA=Total (±$2), campos mínimos. */
    function validarFactura(factura, existentes) {
        const errores = [], advertencias = [];
        const f = factura || {};
        if (!String(f.proveedorId || '').trim()) errores.push('Selecciona un proveedor.');
        const folio = String(f.folio || '').trim();
        if (!folio) errores.push('Ingresa el N° de folio de la factura.');
        if (!String(f.periodoServicio || '').trim()) errores.push('Indica el período de servicio (ej. 2026-07).');

        const neto = Math.round(num(f.neto));
        const iva = Math.round(num(f.iva));
        const total = Math.round(num(f.totalBruto));
        if (total <= 0) errores.push('El monto total bruto debe ser mayor a $0.');

        const diff = Math.abs((neto + iva) - total);
        if (diff > TOLERANCIA_REDONDEO) {
            advertencias.push(`Descuadre aritmético: Neto (${clp(neto)}) + IVA (${clp(iva)}) = ${clp(neto + iva)} ≠ Total Bruto (${clp(total)}). Diferencia: ${clp(diff)} (tolerancia ±$${TOLERANCIA_REDONDEO}).`);
        }

        const dup = (existentes || []).find(e => e.id !== f.id && e.proveedorId === f.proveedorId && String(e.folio || '').trim() === folio);
        if (dup) {
            errores.push(`Ya existe la factura folio ${folio} registrada para este proveedor (estado: ${dup.estado || 'VIGENTE'}).`);
        }

        if (String(f.reemplazaFactura || '').trim() && String(f.reemplazaFactura || '').trim() === folio) {
            errores.push('Una factura no puede reemplazarse a sí misma.');
        }

        if (f.fuenteFinanciamiento === 'CAJA_CHICA' && !String(f.motivoCajaChica || '').trim()) {
            errores.push('Indica el motivo o justificación para derivar a Caja Chica.');
        }

        return { ok: errores.length === 0, errores, advertencias, diff };
    }

    /** Monto imputable de una factura según el tipoMonto del presupuesto (BRUTO | NETO). */
    function montoComputableFactura(factura, presupuesto) {
        if (!factura) return 0;
        const tipo = (presupuesto && presupuesto.tipoMonto === 'NETO') ? 'NETO' : 'BRUTO';
        return Math.round(tipo === 'NETO' ? num(factura.neto) : num(factura.totalBruto));
    }

    /** Calcula en tiempo real el estado del presupuesto / OC y el total derivado a Caja Chica. */
    function calcularEstadoPresupuesto(presupuesto, facturas) {
        const base = presupuesto ? Math.round(num(presupuesto.montoTope)) : 0;
        const tipoMonto = (presupuesto && presupuesto.tipoMonto === 'NETO') ? 'NETO' : 'BRUTO';
        const lista = (facturas || []).filter(f => {
            if (!f) return false;
            if (presupuesto && f.presupuestoId !== presupuesto.id) return false;
            return f.estado !== 'REEMPLAZADA';
        });

        let ejecutadoOC = 0, totalCajaChica = 0, arriendoOC = 0, recargaOC = 0, mixtoOC = 0;
        lista.forEach((f) => {
            const impOC = f.montoImputadoOC != null
                ? Math.round(num(f.montoImputadoOC))
                : (f.fuenteFinanciamiento === 'CAJA_CHICA' ? 0 : montoComputableFactura(f, presupuesto));
            const impCC = f.montoCajaChica != null
                ? Math.round(num(f.montoCajaChica))
                : (f.fuenteFinanciamiento === 'CAJA_CHICA' ? montoComputableFactura(f, presupuesto) : 0);
            ejecutadoOC += impOC;
            totalCajaChica += impCC;
            if (f.tipoServicio === 'RECARGA') recargaOC += impOC;
            else if (f.tipoServicio === 'MIXTO') mixtoOC += impOC;
            else arriendoOC += impOC;
        });

        const saldoDisponible = base - ejecutadoOC;
        const porcentaje = base > 0 ? (ejecutadoOC / base) * 100 : 0;
        const semaforo = porcentaje > 90 ? 'rojo' : (porcentaje >= 75 ? 'ambar' : 'verde');

        return {
            presupuestoBase: base,
            tipoMonto,
            ejecutadoOC,
            saldoDisponible,
            porcentaje,
            porcentajeTexto: pctFmt(porcentaje),
            semaforo,
            totalCajaChica,
            desglose: { ARRIENDO: arriendoOC, RECARGA: recargaOC, MIXTO: mixtoOC },
            cantidadVigentes: lista.length
        };
    }

    /** Simula la imputación de una factura nueva contra el saldo disponible de la OC. */
    function simularImputacion(saldoActual, montoFactura, montoLiberadoPorReemplazo) {
        const saldo = Math.round(num(saldoActual)) + Math.round(num(montoLiberadoPorReemplazo));
        const monto = Math.round(num(montoFactura));
        const saldoProyectado = saldo - monto;
        const haySobregiro = saldoProyectado < 0;
        const montoSobregiro = haySobregiro ? Math.abs(saldoProyectado) : 0;
        const sugeridoOC = haySobregiro ? Math.max(0, saldo) : monto;
        const sugeridoCajaChica = haySobregiro ? Math.max(0, monto - sugeridoOC) : 0;
        return { saldoActual: saldo, montoFactura: monto, saldoProyectado, haySobregiro, montoSobregiro, sugeridoOC, sugeridoCajaChica };
    }

    /** Datos de control reales de Indura S.A. (Paso 5: Semilla / Verificación). */
    function datosSemillaIndura() {
        const proveedor = {
            id: 'prov-indura-76150343-k',
            razonSocial: 'Indura S.A.',
            rut: '76.150.343-K',
            estado: 'HISTORICO',
            contactoEmail: '',
            cuentaBancaria: ''
        };
        const presupuesto = {
            id: 'pres-1298355-493-ag25',
            proveedorId: proveedor.id,
            numeroOC: '1298355-493-AG25',
            nombreContrato: 'Arriendo cilindros oxígeno medicinal — Indura S.A. (Histórico)',
            conceptoPermitido: 'ARRIENDO',
            montoTope: 1078000,
            tipoMonto: 'BRUTO',
            vigenciaDesde: '2025-08-01',
            vigenciaHasta: '2026-12-31',
            estado: 'ACTIVO'
        };
        const baseFact = {
            proveedorId: proveedor.id,
            presupuestoId: presupuesto.id,
            numeroOC: presupuesto.numeroOC,
            facturaSAP: '',
            tipoServicio: 'ARRIENDO',
            fuenteFinanciamiento: 'PRESUPUESTO_OC',
            montoCajaChica: 0,
            motivoCajaChica: '',
            estado: 'VIGENTE',
            archivoUrl: '',
            archivoNombre: '',
            recepcionConforme: { emitida: false, fecha: '', receptorNombre: '', receptorRut: '', receptorCargo: '', recinto: RECINTO_BASE, observaciones: '', numeroActa: '' }
        };
        const facturas = [
            {
                ...baseFact,
                id: 'fact-indura-2074903',
                folio: '2074903',
                reemplazaFactura: '2051884',
                periodoServicio: '2026-07',
                fechaEmision: '2026-07-31',
                fechaVencimiento: '2026-08-30',
                items: [{ codigo: 'RENTA-CIL', descripcion: 'Arriendo cilindros oxígeno medicinal — Julio 2026 (reemplaza 2051884)', cantidad: 620, unidad: 'días-cilindro', valorUnitario: 517, valorTotal: 320540 }],
                neto: 320540,
                iva: 60903,
                totalBruto: 381443,
                montoImputadoOC: 381443
            },
            {
                ...baseFact,
                id: 'fact-indura-2074909',
                folio: '2074909',
                reemplazaFactura: '2051891',
                periodoServicio: '2026-08',
                fechaEmision: '2026-08-31',
                fechaVencimiento: '2026-09-30',
                items: [{ codigo: 'RENTA-CIL', descripcion: 'Arriendo cilindros oxígeno medicinal — Agosto 2026 (reemplaza 2051891)', cantidad: 620, unidad: 'días-cilindro', valorUnitario: 517, valorTotal: 320540 }],
                neto: 320540,
                iva: 60903,
                totalBruto: 381443,
                montoImputadoOC: 381443
            },
            {
                ...baseFact,
                id: 'fact-indura-2074906',
                folio: '2074906',
                reemplazaFactura: '2048700',
                periodoServicio: '2026-09',
                fechaEmision: '2026-09-30',
                fechaVencimiento: '2026-10-30',
                items: [{ codigo: 'RENTA-CIL', descripcion: 'Arriendo cilindros oxígeno medicinal — Septiembre 2026 (reemplaza 2048700)', cantidad: 413, unidad: 'días-cilindro', valorUnitario: 517, valorTotal: 213521 }],
                neto: 213521,
                iva: 40569,
                totalBruto: 254090,
                montoImputadoOC: 254090
            }
        ];
        return { proveedor, presupuesto, facturas };
    }

    // =========================================================================
    // 2. ESTADO Y PERSISTENCIA (Firestore + Storage)
    // =========================================================================

    let proveedores = [];
    let presupuestos = [];
    let facturas = [];
    let filtroProv = 'TODOS';       // 'TODOS' | 'ACTIVO' | 'HISTORICO' | proveedorId
    let filtroPresId = '';          // presupuestoId activo seleccionado
    let filtroConcepto = 'TODOS';   // 'TODOS' | 'ARRIENDO' | 'RECARGA'
    let buscador = '';
    let contenedorActivo = null;

    async function cargarDatos() {
        const f = fs(), d = db();
        if (!f || !d) return;
        const [sp, sbp, sf] = await Promise.all([
            f.getDocs(f.collection(d, 'oxigeno_proveedores')),
            f.getDocs(f.collection(d, 'oxigeno_presupuestos')),
            f.getDocs(f.collection(d, 'oxigeno_facturas'))
        ]);
        proveedores = []; sp.forEach(doc => proveedores.push({ id: doc.id, ...doc.data() }));
        presupuestos = []; sbp.forEach(doc => presupuestos.push({ id: doc.id, ...doc.data() }));
        facturas = []; sf.forEach(doc => facturas.push({ id: doc.id, ...doc.data() }));

        proveedores.sort((a, b) => (a.estado === 'ACTIVO' ? 0 : 1) - (b.estado === 'ACTIVO' ? 0 : 1) || String(a.razonSocial || '').localeCompare(String(b.razonSocial || ''), 'es'));
        presupuestos.sort((a, b) => (a.estado === 'ACTIVO' ? 0 : 1) - (b.estado === 'ACTIVO' ? 0 : 1) || String(b.vigenciaDesde || '').localeCompare(String(a.vigenciaDesde || '')));
        facturas.sort((a, b) => String(b.periodoServicio || '').localeCompare(String(a.periodoServicio || '')) || String(b.folio || '').localeCompare(String(a.folio || '')));

        if (filtroPresId && !presupuestos.some(p => p.id === filtroPresId)) filtroPresId = '';
        if (!filtroPresId && presupuestos.length) filtroPresId = presupuestos[0].id;
    }

    async function guardarProveedor(datos) {
        const f = fs(), d = db();
        const rutLimpio = fmtRut(datos.rut);
        if (!String(datos.razonSocial || '').trim()) throw new Error('Ingresa la razón social del proveedor.');
        if (!rutLimpio) throw new Error('Ingresa el RUT del proveedor.');
        const id = datos.id || ('prov-' + slug(`${datos.razonSocial}-${normRut(rutLimpio)}`));
        const ref = f.doc(f.collection(d, 'oxigeno_proveedores'), id);
        await f.setDoc(ref, {
            id,
            razonSocial: String(datos.razonSocial).trim(),
            rut: rutLimpio,
            estado: datos.estado === 'HISTORICO' ? 'HISTORICO' : 'ACTIVO',
            contactoEmail: String(datos.contactoEmail || '').trim(),
            cuentaBancaria: String(datos.cuentaBancaria || '').trim(),
            actualizadoEl: f.serverTimestamp(),
            creadoEl: datos.creadoEl || f.serverTimestamp()
        }, { merge: true });
        return id;
    }

    async function guardarPresupuesto(datos) {
        const f = fs(), d = db();
        if (!datos.proveedorId) throw new Error('Selecciona el proveedor del contrato/OC.');
        const numeroOC = String(datos.numeroOC || '').trim().toUpperCase();
        if (!numeroOC) throw new Error('Ingresa el N° de Orden de Compra.');
        const montoTope = Math.round(num(datos.montoTope));
        if (montoTope <= 0) throw new Error('El monto tope debe ser mayor a $0.');
        const id = datos.id || ('pres-' + slug(numeroOC));
        const ref = f.doc(f.collection(d, 'oxigeno_presupuestos'), id);
        await f.setDoc(ref, {
            id,
            proveedorId: datos.proveedorId,
            numeroOC,
            nombreContrato: String(datos.nombreContrato || '').trim() || `OC ${numeroOC}`,
            conceptoPermitido: ['ARRIENDO', 'RECARGA', 'MIXTO'].includes(datos.conceptoPermitido) ? datos.conceptoPermitido : 'MIXTO',
            montoTope,
            tipoMonto: datos.tipoMonto === 'NETO' ? 'NETO' : 'BRUTO',
            vigenciaDesde: String(datos.vigenciaDesde || ''),
            vigenciaHasta: String(datos.vigenciaHasta || ''),
            estado: datos.estado === 'CERRADO' ? 'CERRADO' : 'ACTIVO',
            actualizadoEl: f.serverTimestamp(),
            creadoEl: datos.creadoEl || f.serverTimestamp()
        }, { merge: true });
        return id;
    }

    /** Sube el respaldo original a Firebase Storage: oxigeno/facturas/{rut}/{folio}.{ext} */
    async function subirRespaldoStorage(archivo, rut, folio) {
        if (!archivo) return { archivoUrl: '', archivoNombre: '', archivoStoragePath: '' };
        const ext = (String(archivo.name || '').split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
        const rutPath = normRut(rut) || 'sin-rut';
        const folioPath = String(folio || 'sin-folio').replace(/[^A-Za-z0-9_-]/g, '');
        const storagePath = `oxigeno/facturas/${rutPath}/${folioPath}.${ext}`;
        const storage = stg(), sdk = stgSdk();
        if (!storage || !sdk) {
            return { archivoUrl: '', archivoNombre: archivo.name || `${folioPath}.${ext}`, archivoStoragePath: storagePath, avisoStorage: 'Firebase Storage no inicializado en cliente.' };
        }
        try {
            const sRef = sdk.ref(storage, storagePath);
            await sdk.uploadBytes(sRef, archivo, { contentType: archivo.type || 'application/octet-stream' });
            const url = await sdk.getDownloadURL(sRef);
            return { archivoUrl: url, archivoNombre: archivo.name || `${folioPath}.${ext}`, archivoStoragePath: storagePath };
        } catch (e) {
            console.warn('[OxiFact] No se pudo subir respaldo a Storage:', e);
            return { archivoUrl: '', archivoNombre: archivo.name || `${folioPath}.${ext}`, archivoStoragePath: storagePath, avisoStorage: 'Factura guardada, pero el respaldo no pudo subirse a Storage (revisa reglas/red): ' + (e.message || e) };
        }
    }

    /** Guarda factura en transacción atómica (bloqueo duplicados + marca factura reemplazada como REEMPLAZADA). */
    async function guardarFacturaAtomica(datos, archivoOriginal) {
        const f = fs(), d = db();
        const val = validarFactura(datos, facturas);
        if (!val.ok) throw new Error(val.errores[0]);

        const prov = proveedores.find(p => p.id === datos.proveedorId);
        const pres = presupuestos.find(p => p.id === datos.presupuestoId);

        // Si viene reemplazaFactura, buscamos si existe ese folio previo del mismo proveedor
        const folioReemp = String(datos.reemplazaFactura || '').trim();
        const prevDoc = folioReemp
            ? facturas.find(x => x.proveedorId === datos.proveedorId && String(x.folio || '').trim() === folioReemp && x.estado !== 'REEMPLAZADA')
            : null;

        // Validación anti-sobregiro dura antes de escribir
        if (pres && datos.fuenteFinanciamiento === 'PRESUPUESTO_OC') {
            const est = calcularEstadoPresupuesto(pres, facturas);
            const liberado = prevDoc && prevDoc.presupuestoId === pres.id ? num(prevDoc.montoImputadoOC) : 0;
            const sim = simularImputacion(est.saldoDisponible, num(datos.montoImputadoOC), liberado);
            if (sim.haySobregiro) {
                throw new Error(`SOBREGIRO DETECTADO (+${clp(sim.montoSobregiro)} sobre el tope de la OC). Deriva el exceso o la factura a Caja Chica.`);
            }
        }

        const subido = await subirRespaldoStorage(archivoOriginal, prov ? prov.rut : datos.rutEmisor, datos.folio);
        const id = datos.id || (`fact-${slug(datos.proveedorId)}-${slug(datos.folio)}`);
        const factRef = f.doc(f.collection(d, 'oxigeno_facturas'), id);
        const prevRef = prevDoc ? f.doc(f.collection(d, 'oxigeno_facturas'), prevDoc.id) : null;

        await f.runTransaction(d, async (tx) => {
            const existe = await tx.get(factRef);
            if (!datos.id && existe.exists()) {
                throw new Error(`Ya existe una factura con folio ${datos.folio} para este proveedor.`);
            }
            let prevSnap = null;
            if (prevRef) prevSnap = await tx.get(prevRef);

            const registro = {
                id,
                proveedorId: datos.proveedorId,
                presupuestoId: datos.presupuestoId || '',
                numeroOC: String(datos.numeroOC || (pres ? pres.numeroOC : '')).trim().toUpperCase(),
                folio: String(datos.folio).trim(),
                facturaSAP: String(datos.facturaSAP || '').trim(),
                reemplazaFactura: folioReemp,
                tipoServicio: ['ARRIENDO', 'RECARGA', 'MIXTO'].includes(datos.tipoServicio) ? datos.tipoServicio : 'ARRIENDO',
                periodoServicio: String(datos.periodoServicio || '').trim(),
                fechaEmision: String(datos.fechaEmision || ''),
                fechaVencimiento: String(datos.fechaVencimiento || ''),
                items: Array.isArray(datos.items) ? datos.items : [],
                neto: Math.round(num(datos.neto)),
                iva: Math.round(num(datos.iva)),
                totalBruto: Math.round(num(datos.totalBruto)),
                fuenteFinanciamiento: datos.fuenteFinanciamiento === 'CAJA_CHICA' ? 'CAJA_CHICA' : 'PRESUPUESTO_OC',
                montoImputadoOC: Math.round(num(datos.montoImputadoOC)),
                montoCajaChica: Math.round(num(datos.montoCajaChica)),
                motivoCajaChica: String(datos.motivoCajaChica || '').trim(),
                estado: 'VIGENTE',
                archivoUrl: subido.archivoUrl || datos.archivoUrl || '',
                archivoNombre: subido.archivoNombre || datos.archivoNombre || '',
                archivoStoragePath: subido.archivoStoragePath || datos.archivoStoragePath || '',
                recepcionConforme: datos.recepcionConforme || { emitida: false, fecha: '', receptorNombre: '', receptorRut: '', receptorCargo: '', recinto: RECINTO_BASE, observaciones: '', numeroActa: '' },
                creadoPor: usuario(),
                creadoEl: f.serverTimestamp()
            };

            tx.set(factRef, registro);
            if (prevRef && prevSnap && prevSnap.exists()) {
                tx.update(prevRef, {
                    estado: 'REEMPLAZADA',
                    reemplazadaPor: registro.folio,
                    reemplazadaEl: f.serverTimestamp()
                });
            }
        });

        return { id, avisoStorage: subido.avisoStorage || '', reemplazoMarcado: prevDoc ? prevDoc.folio : '' };
    }

    /** Registra la Recepción Conforme (Ley 19.983) asignando correlativo RCO-AAAA-NNNNN en una sola transacción. */
    async function registrarRecepcionConforme(facturaId, datosRC) {
        const f = fs(), d = db();
        if (!String(datosRC.receptorNombre || '').trim()) throw new Error('Ingresa el nombre de quien recibe conforme.');
        if (!String(datosRC.receptorRut || '').trim()) throw new Error('Ingresa el RUT de quien recibe conforme.');
        if (!String(datosRC.receptorCargo || '').trim()) throw new Error('Ingresa el cargo de quien recibe conforme.');
        if (!String(datosRC.fecha || '').trim()) throw new Error('Indica la fecha de recepción conforme.');

        const anio = new Date().getFullYear();
        const ctrRef = f.doc(f.collection(d, 'Contadores'), `ctr-rco-${anio}`);
        const factRef = f.doc(f.collection(d, 'oxigeno_facturas'), facturaId);

        return f.runTransaction(d, async (tx) => {
            const [fSnap, cSnap] = await Promise.all([tx.get(factRef), tx.get(ctrRef)]);
            if (!fSnap.exists()) throw new Error('La factura ya no existe.');
            const actual = fSnap.data();
            const rcPrev = actual.recepcionConforme || {};
            let numeroActa = rcPrev.numeroActa || '';
            if (!numeroActa) {
                const ultimo = (cSnap.exists() ? Number(cSnap.data().ultimo) || 0 : 0) + 1;
                numeroActa = `RCO-${anio}-${pad(ultimo, 5)}`;
                tx.set(ctrRef, { ultimo, tipo: 'RCO', anio, updatedAt: f.serverTimestamp() }, { merge: true });
            }
            const rc = {
                emitida: true,
                fecha: String(datosRC.fecha).slice(0, 10),
                receptorNombre: String(datosRC.receptorNombre).trim(),
                receptorRut: fmtRut(datosRC.receptorRut),
                receptorCargo: String(datosRC.receptorCargo).trim(),
                recinto: String(datosRC.recinto || RECINTO_BASE).trim() || RECINTO_BASE,
                observaciones: String(datosRC.observaciones || '').trim(),
                numeroActa,
                registradoPor: usuario(),
                registradoEl: new Date().toISOString()
            };
            tx.update(factRef, { recepcionConforme: rc });
            return rc;
        });
    }

    /** Semilla idempotente de control con datos reales de Indura S.A. (Paso 5). */
    async function cargarSemillaIndura() {
        const f = fs(), d = db();
        const sem = datosSemillaIndura();
        await f.runTransaction(d, async (tx) => {
            const pRef = f.doc(f.collection(d, 'oxigeno_proveedores'), sem.proveedor.id);
            const bRef = f.doc(f.collection(d, 'oxigeno_presupuestos'), sem.presupuesto.id);
            const fRefs = sem.facturas.map(x => f.doc(f.collection(d, 'oxigeno_facturas'), x.id));
            const snaps = await Promise.all([tx.get(pRef), tx.get(bRef), ...fRefs.map(r => tx.get(r))]);

            if (!snaps[0].exists()) tx.set(pRef, { ...sem.proveedor, creadoEl: f.serverTimestamp(), actualizadoEl: f.serverTimestamp() });
            if (!snaps[1].exists()) tx.set(bRef, { ...sem.presupuesto, creadoEl: f.serverTimestamp(), actualizadoEl: f.serverTimestamp() });
            sem.facturas.forEach((fac, idx) => {
                if (!snaps[idx + 2].exists()) {
                    tx.set(fRefs[idx], { ...fac, creadoPor: usuario(), creadoEl: f.serverTimestamp() });
                }
            });
        });
        filtroProv = 'TODOS';
        filtroPresId = sem.presupuesto.id;
        filtroConcepto = 'TODOS';
    }

    // =========================================================================
    // 3. LECTURA MULTIMODAL (XML DTE + GEMINI VISION + OCR LOCAL TESSERACT)
    // =========================================================================

    function rotarCanvas(srcCanvas, grados) {
        const ang = ((grados % 360) + 360) % 360;
        const c = document.createElement('canvas');
        if (ang === 90 || ang === 270) { c.width = srcCanvas.height; c.height = srcCanvas.width; }
        else { c.width = srcCanvas.width; c.height = srcCanvas.height; }
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate((ang * Math.PI) / 180);
        ctx.drawImage(srcCanvas, -srcCanvas.width / 2, -srcCanvas.height / 2);
        return c;
    }

    async function renderizarArchivoACanvas(file) {
        const name = String(file.name || '').toLowerCase();
        const esPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
        if (esPdf) {
            if (!window.SAR_Lector || !window.SAR_Lector.cargarPdfJs) {
                throw new Error('No se encontró el motor PDF.js para previsualizar el PDF.');
            }
            const pdfjs = await window.SAR_Lector.cargarPdfJs();
            const buf = await file.arrayBuffer();
            const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
            const page = await pdf.getPage(1);
            const vp = page.getViewport({ scale: 1.8 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(vp.width);
            canvas.height = Math.round(vp.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            let textoDigital = '';
            try {
                const tc = await page.getTextContent();
                textoDigital = tc.items.map(i => i.str).join(' ');
            } catch (_) { /* escaneo sin capa texto */ }
            return { canvas, textoDigital };
        }
        // Imagen JPG / PNG
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((ok, fail) => {
                const el = new Image();
                el.onload = () => ok(el);
                el.onerror = () => fail(new Error('No se pudo cargar la imagen.'));
                el.src = url;
            });
            const canvas = document.createElement('canvas');
            const maxDim = 2200;
            const escala = Math.min(1, maxDim / Math.max(img.width, img.height));
            canvas.width = Math.round(img.width * escala);
            canvas.height = Math.round(img.height * escala);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            return { canvas, textoDigital: '' };
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    /** Envía el canvas (ya rotado) a Gemini Vision (Cloud Function) y cae a PDF texto / Tesseract OCR local si falla. */
    async function extraerFacturaDesdeVisual(canvasRotado, textoDigital, alProgreso) {
        const avisar = (m) => { if (typeof alProgreso === 'function') alProgreso(m); };
        const endpoint = window.SAR_OXI_GEMINI_URL || GEMINI_ENDPOINT_DEFAULT;
        const dataUrl = canvasRotado.toDataURL('image/jpeg', 0.88);

        // 1) Intentar Cloud Function con Gemini Vision API
        try {
            avisar('Consultando lectura multimodal (Gemini Vision)…');
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 20000);
            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64: dataUrl, mimeType: 'image/jpeg' }),
                signal: ctrl.signal
            });
            clearTimeout(timer);
            if (resp.ok) {
                const json = await resp.json();
                if (json && json.success && json.datos) {
                    return normalizarRespuestaIA(json.datos);
                }
            }
        } catch (_) {
            // Silencioso: cae al motor local gratuito
        }

        // 2) Respaldo rápido: capa de texto digital del PDF si trae datos suficientes
        if (textoDigital && textoDigital.trim().length > 80) {
            avisar('Leyendo capa de texto digital del PDF…');
            const parsed = parsearTextoFacturaOcr(textoDigital);
            if (parsed.folio || parsed.totalBruto > 0 || parsed.rutEmisor) {
                return { ...parsed, origenLectura: 'PDF_TEXTO' };
            }
        }

        // 3) Respaldo universal local: Tesseract.js v5 en el navegador (sin clave API)
        if (window.SAR_Lector && window.SAR_Lector.cargarTesseract) {
            avisar('Ejecutando OCR local en navegador (Tesseract.js)…');
            const Tess = await window.SAR_Lector.cargarTesseract();
            const res = await Tess.recognize(canvasRotado, 'spa', {
                logger: (m) => { if (m && m.status === 'recognizing text') avisar(`OCR local: ${Math.round((m.progress || 0) * 100)}%…`); }
            });
            const txt = (res && res.data && res.data.text) || '';
            return parsearTextoFacturaOcr(txt);
        }

        throw new Error('No se pudo leer automáticamente la imagen (ni Cloud Function ni OCR local disponibles). Completa los campos manualmente.');
    }

    // =========================================================================
    // 4. ACTA DE RECEPCIÓN CONFORME (LEY 19.983) — PDF Y VISTA IMPRIMIBLE
    // =========================================================================

    function construirHtmlActaRC(factura, proveedor, presupuesto, estadoPres) {
        const rc = factura.recepcionConforme || {};
        const items = Array.isArray(factura.items) && factura.items.length
            ? factura.items
            : [{ codigo: '—', descripcion: factura.tipoServicio === 'RECARGA' ? 'Recarga oxígeno medicinal' : 'Arriendo cilindros oxígeno medicinal', cantidad: 1, unidad: 'GL', valorUnitario: factura.neto, valorTotal: factura.neto }];
        const fuenteTxt = factura.fuenteFinanciamiento === 'CAJA_CHICA'
            ? (num(factura.montoImputadoOC) > 0
                ? `Mixto: OC (${clp(factura.montoImputadoOC)}) + Caja Chica (${clp(factura.montoCajaChica)})`
                : `Caja Chica (${clp(factura.montoCajaChica || factura.totalBruto)})`)
            : `Presupuesto Orden de Compra (${clp(factura.montoImputadoOC || factura.totalBruto)})`;

        return `
        <div class="oxf-acta-hoja" id="oxf-acta-hoja">
            <div class="oxf-acta-head">
                <div>
                    <div class="oxf-acta-inst">CORPORACIÓN MUNICIPAL DE MELIPILLA</div>
                    <div class="oxf-acta-sub">${esc(rc.recinto || RECINTO_BASE)}</div>
                    <div class="oxf-acta-sub">Unidad de Gestión Logística y Abastecimiento — Módulo Oxígeno Medicinal</div>
                </div>
                <div class="oxf-acta-nro">
                    <span>ACTA DE RECEPCIÓN CONFORME</span>
                    <strong>${esc(rc.numeroActa || 'BORRADOR')}</strong>
                    <small>Art. 5° Ley N° 19.983 · ${esc(fechaCL(rc.fecha || hoyISO()))}</small>
                </div>
            </div>

            <div class="oxf-acta-grid">
                <div class="oxf-acta-box">
                    <h4>1. Antecedentes del Proveedor y Documento</h4>
                    <table class="oxf-acta-kv">
                        <tr><td>Razón Social:</td><td><b>${esc(proveedor ? proveedor.razonSocial : '—')}</b></td></tr>
                        <tr><td>RUT Proveedor:</td><td>${esc(proveedor ? proveedor.rut : '—')}</td></tr>
                        <tr><td>Factura Electrónica N°:</td><td><b>${esc(factura.folio)}</b>${factura.facturaSAP ? ` · SAP: ${esc(factura.facturaSAP)}` : ''}</td></tr>
                        ${factura.reemplazaFactura ? `<tr><td>Reemplaza Factura N°:</td><td>${esc(factura.reemplazaFactura)}</td></tr>` : ''}
                        <tr><td>Fecha Emisión / Venc.:</td><td>${esc(fechaCL(factura.fechaEmision))} / ${esc(fechaCL(factura.fechaVencimiento))}</td></tr>
                    </table>
                </div>
                <div class="oxf-acta-box">
                    <h4>2. Antecedentes Contractuales y Servicio</h4>
                    <table class="oxf-acta-kv">
                        <tr><td>Orden de Compra:</td><td><b>${esc(factura.numeroOC || (presupuesto ? presupuesto.numeroOC : '—'))}</b></td></tr>
                        <tr><td>Contrato / Bolsa:</td><td>${esc(presupuesto ? presupuesto.nombreContrato : '—')}</td></tr>
                        <tr><td>Tipo de Servicio:</td><td>${esc(factura.tipoServicio || 'ARRIENDO')}</td></tr>
                        <tr><td>Período de Servicio:</td><td>${esc(fmtPeriodo(factura.periodoServicio))}</td></tr>
                        <tr><td>Fuente Financiamiento:</td><td>${esc(fuenteTxt)}</td></tr>
                    </table>
                </div>
            </div>

            <div class="oxf-acta-sec">
                <h4>3. Detalle de Ítems / Cilindros Recibidos</h4>
                <table class="oxf-acta-tbl">
                    <thead><tr><th>Código</th><th>Descripción</th><th class="num">Cantidad</th><th>Unidad</th><th class="num">Valor Unit.</th><th class="num">Valor Total</th></tr></thead>
                    <tbody>
                        ${items.map(it => `<tr>
                            <td>${esc(it.codigo || '—')}</td>
                            <td>${esc(it.descripcion || '')}</td>
                            <td class="num">${num(it.cantidad).toLocaleString('es-CL')}</td>
                            <td>${esc(it.unidad || 'UN')}</td>
                            <td class="num">${clp(it.valorUnitario)}</td>
                            <td class="num">${clp(it.valorTotal)}</td>
                        </tr>`).join('')}
                    </tbody>
                    <tfoot>
                        <tr><td colspan="5" class="num">Monto Neto</td><td class="num">${clp(factura.neto)}</td></tr>
                        <tr><td colspan="5" class="num">IVA (19%)</td><td class="num">${clp(factura.iva)}</td></tr>
                        <tr class="oxf-acta-tot"><td colspan="5" class="num"><b>TOTAL BRUTO FACTURA</b></td><td class="num"><b>${clp(factura.totalBruto)}</b></td></tr>
                    </tfoot>
                </table>
            </div>

            ${presupuesto && estadoPres ? `
            <div class="oxf-acta-sec">
                <h4>4. Estado del Saldo Presupuestario de la Orden de Compra (${esc(presupuesto.numeroOC)})</h4>
                <div class="oxf-acta-pres">
                    <div><span>Presupuesto Base (${esc(presupuesto.tipoMonto || 'BRUTO')})</span><strong>${clp(estadoPres.presupuestoBase)}</strong></div>
                    <div><span>Ejecutado Acumulado OC</span><strong>${clp(estadoPres.ejecutadoOC)} (${esc(estadoPres.porcentajeTexto)})</strong></div>
                    <div><span>Saldo Disponible OC</span><strong>${clp(estadoPres.saldoDisponible)}</strong></div>
                    <div><span>Derivado a Caja Chica</span><strong>${clp(estadoPres.totalCajaChica)}</strong></div>
                </div>
            </div>` : ''}

            <div class="oxf-acta-ley">
                <h4>5. Declaración de Recepción Conforme (Art. 5° Ley N° 19.983)</h4>
                <p>En <b>${esc(rc.recinto || RECINTO_BASE)}</b>, con fecha <b>${esc(fechaCL(rc.fecha || hoyISO()))}</b>, el/la funcionario(a) abajo firmante certifica que los servicios y/o suministros de oxígeno medicinal detallados en la Factura Electrónica N° <b>${esc(factura.folio)}</b>, emitida por <b>${esc(proveedor ? proveedor.razonSocial : 'el proveedor')}</b> (RUT ${esc(proveedor ? proveedor.rut : '—')}), asociados a la Orden de Compra N° <b>${esc(factura.numeroOC || '—')}</b> correspondiente al período <b>${esc(fmtPeriodo(factura.periodoServicio))}</b>, han sido recibidos a entera conformidad en cantidad, calidad y oportunidad, otorgando la presente Recepción Conforme para los efectos establecidos en el artículo 5° de la Ley N° 19.983 y su posterior tramitación de pago.</p>
                ${rc.observaciones ? `<p><b>Observaciones:</b> ${esc(rc.observaciones)}</p>` : ''}
                ${factura.motivoCajaChica ? `<p><b>Trazabilidad Caja Chica:</b> ${esc(factura.motivoCajaChica)}</p>` : ''}
            </div>

            <div class="oxf-acta-firmas">
                <div class="oxf-acta-firma">
                    <div class="oxf-acta-linea"></div>
                    <b>${esc(rc.receptorNombre || 'Nombre Receptor Conforme')}</b>
                    <span>RUT: ${esc(rc.receptorRut || '—')}</span>
                    <span>${esc(rc.receptorCargo || 'Cargo / Contraparte Técnica')}</span>
                    <span>${esc(rc.recinto || RECINTO_BASE)}</span>
                </div>
                <div class="oxf-acta-timbre">
                    <span>TIMBRE DEL ESTABLECIMIENTO</span>
                </div>
            </div>
        </div>`;
    }

    /** Genera y descarga el Acta de Recepción Conforme en PDF nativo usando jsPDF + autoTable (fondo blanco limpio). */
    function descargarActaRCPDF(factura, proveedor, presupuesto, estadoPres) {
        const jspdfNS = window.jspdf;
        if (!jspdfNS || !jspdfNS.jsPDF) {
            toast('PDF', 'jsPDF no está disponible; usa el botón Imprimir / Guardar PDF.', 'warning');
            return;
        }
        const rc = factura.recepcionConforme || {};
        const doc = new jspdfNS.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
        const W = doc.internal.pageSize.getWidth();
        const M = 14;
        let y = 14;

        // Fondo blanco forzado
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, W, doc.internal.pageSize.getHeight(), 'F');

        // Encabezado institucional
        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.5);
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.text('CORPORACIÓN MUNICIPAL DE MELIPILLA', M, y);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        doc.text(String(rc.recinto || RECINTO_BASE), M, y + 5);
        doc.text('Gestión Logística y Abastecimiento — Módulo Oxígeno Medicinal', M, y + 9.5);

        // Caja número de acta a la derecha
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(W - M - 66, y - 4, 66, 17, 2, 2, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(71, 85, 105);
        doc.text('ACTA DE RECEPCIÓN CONFORME', W - M - 33, y + 0.5, { align: 'center' });
        doc.setFontSize(11); doc.setTextColor(15, 23, 42);
        doc.text(String(rc.numeroActa || 'BORRADOR'), W - M - 33, y + 6, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
        doc.text(`Art. 5° Ley N° 19.983 · ${fechaCL(rc.fecha || hoyISO())}`, W - M - 33, y + 10.5, { align: 'center' });

        y += 17;
        doc.line(M, y, W - M, y);
        y += 6;

        // 1 y 2. Antecedentes
        const fuenteTxt = factura.fuenteFinanciamiento === 'CAJA_CHICA'
            ? (num(factura.montoImputadoOC) > 0 ? `Mixto OC (${clp(factura.montoImputadoOC)}) + Caja Chica (${clp(factura.montoCajaChica)})` : `Caja Chica (${clp(factura.montoCajaChica || factura.totalBruto)})`)
            : `Presupuesto OC (${clp(factura.montoImputadoOC || factura.totalBruto)})`;

        if (typeof doc.autoTable === 'function') {
            doc.autoTable({
                startY: y,
                margin: { left: M, right: M },
                theme: 'grid',
                styles: { fontSize: 8.5, textColor: [15, 23, 42], fillColor: [255, 255, 255], lineColor: [203, 213, 225], cellPadding: 2.2 },
                headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
                head: [['Antecedentes del Proveedor y Factura', 'Antecedentes Contractuales y Servicio']],
                body: [
                    [`Razón Social: ${proveedor ? proveedor.razonSocial : '—'}\nRUT: ${proveedor ? proveedor.rut : '—'}\nFactura N°: ${factura.folio}${factura.facturaSAP ? ' · SAP: ' + factura.facturaSAP : ''}${factura.reemplazaFactura ? '\nReemplaza Factura: ' + factura.reemplazaFactura : ''}\nEmisión / Venc.: ${fechaCL(factura.fechaEmision)} / ${fechaCL(factura.fechaVencimiento)}`,
                     `Orden de Compra: ${factura.numeroOC || (presupuesto ? presupuesto.numeroOC : '—')}\nContrato: ${presupuesto ? presupuesto.nombreContrato : '—'}\nTipo Servicio: ${factura.tipoServicio || 'ARRIENDO'}\nPeríodo: ${fmtPeriodo(factura.periodoServicio)}\nFinanciamiento: ${fuenteTxt}`]
                ]
            });
            y = doc.lastAutoTable.finalY + 5;

            // 3. Tabla de ítems / cilindros
            const items = Array.isArray(factura.items) && factura.items.length
                ? factura.items
                : [{ codigo: '—', descripcion: factura.tipoServicio === 'RECARGA' ? 'Recarga oxígeno medicinal' : 'Arriendo cilindros oxígeno medicinal', cantidad: 1, unidad: 'GL', valorUnitario: factura.neto, valorTotal: factura.neto }];
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(15, 23, 42);
            doc.text('Detalle de Ítems / Cilindros Recibidos', M, y);
            y += 2;
            doc.autoTable({
                startY: y,
                margin: { left: M, right: M },
                theme: 'grid',
                styles: { fontSize: 8.2, textColor: [15, 23, 42], fillColor: [255, 255, 255], lineColor: [203, 213, 225], cellPadding: 2 },
                headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
                columnStyles: { 2: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
                head: [['Código', 'Descripción', 'Cant.', 'Unidad', 'V. Unitario', 'V. Total']],
                body: [
                    ...items.map(it => [it.codigo || '—', it.descripcion || '', num(it.cantidad).toLocaleString('es-CL'), it.unidad || 'UN', clp(it.valorUnitario), clp(it.valorTotal)]),
                    [{ content: 'Monto Neto', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } }, { content: clp(factura.neto), styles: { halign: 'right' } }],
                    [{ content: 'IVA (19%)', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } }, { content: clp(factura.iva), styles: { halign: 'right' } }],
                    [{ content: 'TOTAL BRUTO FACTURA', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249] } }, { content: clp(factura.totalBruto), styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249] } }]
                ]
            });
            y = doc.lastAutoTable.finalY + 5;

            // 4. Estado presupuestario OC
            if (presupuesto && estadoPres) {
                doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
                doc.text(`Estado del Saldo Presupuestario — OC ${presupuesto.numeroOC}`, M, y);
                y += 2;
                doc.autoTable({
                    startY: y,
                    margin: { left: M, right: M },
                    theme: 'grid',
                    styles: { fontSize: 8.2, textColor: [15, 23, 42], fillColor: [255, 255, 255], lineColor: [203, 213, 225], halign: 'center' },
                    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
                    head: [[`Presupuesto Base (${presupuesto.tipoMonto || 'BRUTO'})`, 'Ejecutado Acumulado OC', 'Saldo Disponible OC', 'Total Derivado Caja Chica']],
                    body: [[clp(estadoPres.presupuestoBase), `${clp(estadoPres.ejecutadoOC)} (${estadoPres.porcentajeTexto})`, clp(estadoPres.saldoDisponible), clp(estadoPres.totalCajaChica)]]
                });
                y = doc.lastAutoTable.finalY + 6;
            }
        }

        // 5. Declaración Ley 19.983
        if (y > 210) { doc.addPage(); y = 18; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(15, 23, 42);
        doc.text('Declaración de Recepción Conforme (Art. 5° Ley N° 19.983)', M, y);
        y += 4.5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        const decl = `En ${rc.recinto || RECINTO_BASE}, con fecha ${fechaCL(rc.fecha || hoyISO())}, el/la funcionario(a) abajo firmante certifica que los servicios y/o suministros de oxígeno medicinal detallados en la Factura Electrónica N° ${factura.folio}, emitida por ${proveedor ? proveedor.razonSocial : 'el proveedor'} (RUT ${proveedor ? proveedor.rut : '—'}), asociados a la Orden de Compra N° ${factura.numeroOC || '—'} correspondiente al período ${fmtPeriodo(factura.periodoServicio)}, han sido recibidos a entera conformidad en cantidad, calidad y oportunidad, otorgando la presente Recepción Conforme para los efectos establecidos en el artículo 5° de la Ley N° 19.983 y su posterior tramitación de pago.`;
        const lineasDecl = doc.splitTextToSize(decl, W - M * 2);
        doc.text(lineasDecl, M, y);
        y += lineasDecl.length * 4 + 3;

        if (rc.observaciones) {
            const obsL = doc.splitTextToSize(`Observaciones: ${rc.observaciones}`, W - M * 2);
            doc.text(obsL, M, y);
            y += obsL.length * 4 + 3;
        }
        if (factura.motivoCajaChica) {
            const ccL = doc.splitTextToSize(`Trazabilidad Caja Chica: ${factura.motivoCajaChica}`, W - M * 2);
            doc.text(ccL, M, y);
            y += ccL.length * 4 + 3;
        }

        // Firma y timbre
        if (y > 235) { doc.addPage(); y = 30; }
        const yFirma = Math.max(y + 18, 232);
        doc.setDrawColor(15, 23, 42);
        doc.line(M + 6, yFirma, M + 86, yFirma);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
        doc.text(String(rc.receptorNombre || 'Receptor Conforme'), M + 46, yFirma + 5, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
        doc.text(`RUT: ${rc.receptorRut || '—'}`, M + 46, yFirma + 9.5, { align: 'center' });
        doc.text(String(rc.receptorCargo || 'Cargo'), M + 46, yFirma + 13.5, { align: 'center' });
        doc.text(String(rc.recinto || RECINTO_BASE), M + 46, yFirma + 17.5, { align: 'center' });

        // Recuadro timbre
        doc.setDrawColor(148, 163, 184);
        doc.roundedRect(W - M - 72, yFirma - 18, 68, 36, 2, 2);
        doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
        doc.text('TIMBRE DEL ESTABLECIMIENTO', W - M - 38, yFirma + 1, { align: 'center' });

        const nombreArch = `Acta_RC_${String(rc.numeroActa || 'Oxi').replace(/[^A-Za-z0-9-]/g, '')}_Folio_${String(factura.folio || '').replace(/[^A-Za-z0-9-]/g, '')}.pdf`;
        doc.save(nombreArch);
    }

    function imprimirActaRC(htmlHoja, titulo) {
        const w = window.open('', '_blank', 'width=900,height=1050');
        if (!w) { toast('Impresión', 'Permite ventanas emergentes para imprimir el acta.', 'warning'); return; }
        w.document.open();
        w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
        <style>
            @page { size: letter portrait; margin: 12mm; }
            html, body { background: #ffffff !important; color: #0f172a !important; font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            .oxf-acta-hoja { background: #ffffff !important; color: #0f172a !important; padding: 14px; max-width: 780px; margin: 0 auto; }
            .oxf-acta-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; gap: 16px; }
            .oxf-acta-inst { font-weight: 800; font-size: 15px; color: #0f172a; }
            .oxf-acta-sub { font-size: 12px; color: #334155; }
            .oxf-acta-nro { border: 1.5px solid #0f172a; border-radius: 6px; padding: 8px 14px; text-align: center; background: #f8fafc !important; }
            .oxf-acta-nro span { display: block; font-size: 10px; font-weight: 700; color: #475569; }
            .oxf-acta-nro strong { display: block; font-size: 15px; color: #0f172a; margin: 2px 0; }
            .oxf-acta-nro small { font-size: 10px; color: #475569; }
            .oxf-acta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
            .oxf-acta-box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; background: #ffffff !important; }
            .oxf-acta-box h4, .oxf-acta-sec h4, .oxf-acta-ley h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
            .oxf-acta-kv { width: 100%; border-collapse: collapse; font-size: 12px; }
            .oxf-acta-kv td { padding: 2.5px 4px; vertical-align: top; }
            .oxf-acta-kv td:first-child { color: #475569; width: 42%; }
            .oxf-acta-sec { margin-bottom: 14px; }
            .oxf-acta-tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
            .oxf-acta-tbl th, .oxf-acta-tbl td { border: 1px solid #cbd5e1; padding: 6px 8px; }
            .oxf-acta-tbl thead th { background: #0f172a !important; color: #ffffff !important; text-align: left; }
            .oxf-acta-tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
            .oxf-acta-tot td { background: #f1f5f9 !important; font-size: 13px; }
            .oxf-acta-pres { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
            .oxf-acta-pres > div { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; text-align: center; background: #f8fafc !important; }
            .oxf-acta-pres span { display: block; font-size: 10px; color: #475569; }
            .oxf-acta-pres strong { display: block; font-size: 13px; color: #0f172a; margin-top: 2px; }
            .oxf-acta-ley { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; background: #ffffff !important; margin-bottom: 24px; font-size: 12px; line-height: 1.5; }
            .oxf-acta-ley p { margin: 6px 0 0; text-align: justify; }
            .oxf-acta-firmas { display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; align-items: end; margin-top: 42px; }
            .oxf-acta-firma { text-align: center; font-size: 12px; }
            .oxf-acta-linea { border-top: 1px solid #0f172a; margin: 0 18px 6px; }
            .oxf-acta-firma b, .oxf-acta-firma span { display: block; }
            .oxf-acta-timbre { border: 1px dashed #94a3b8; border-radius: 6px; height: 96px; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 11px; }
        </style></head><body>${htmlHoja}</body></html>`);
        w.document.close();
        setTimeout(() => { w.focus(); w.print(); }, 250);
    }

    // =========================================================================
    // 5. INTERFAZ DE USUARIO (Cabecera, Contador Anti-Sobregiro, Tabla, Modales)
    // =========================================================================

    function proveedoresFiltrados() {
        if (filtroProv === 'ACTIVO') return proveedores.filter(p => p.estado !== 'HISTORICO');
        if (filtroProv === 'HISTORICO') return proveedores.filter(p => p.estado === 'HISTORICO');
        if (filtroProv !== 'TODOS') return proveedores.filter(p => p.id === filtroProv);
        return proveedores;
    }

    function presupuestosVisibles() {
        const provIds = new Set(proveedoresFiltrados().map(p => p.id));
        return presupuestos.filter(b => {
            if (filtroProv !== 'TODOS' && !provIds.has(b.proveedorId)) return false;
            if (filtroConcepto !== 'TODOS' && b.conceptoPermitido !== 'MIXTO' && b.conceptoPermitido !== filtroConcepto) return false;
            return true;
        });
    }

    function presupuestoActual() {
        const vis = presupuestosVisibles();
        return vis.find(b => b.id === filtroPresId) || vis[0] || null;
    }

    function facturasVisibles(pres) {
        const provIds = new Set(proveedoresFiltrados().map(p => p.id));
        const q = buscador.trim().toLowerCase();
        return facturas.filter(f => {
            if (pres && f.presupuestoId !== pres.id) return false;
            if (!pres && filtroProv !== 'TODOS' && !provIds.has(f.proveedorId)) return false;
            if (filtroConcepto !== 'TODOS' && f.tipoServicio !== filtroConcepto && f.tipoServicio !== 'MIXTO') return false;
            if (q) {
                const prov = proveedores.find(p => p.id === f.proveedorId);
                const hay = `${f.folio} ${f.numeroOC} ${f.facturaSAP || ''} ${f.reemplazaFactura || ''} ${f.periodoServicio} ${f.tipoServicio} ${prov ? prov.razonSocial + ' ' + prov.rut : ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }

    function pintar(cont) {
        if (cont) contenedorActivo = cont;
        const r = contenedorActivo;
        if (!r) return;

        const visPres = presupuestosVisibles();
        const pres = presupuestoActual();
        if (pres && filtroPresId !== pres.id) filtroPresId = pres.id;

        const est = pres ? calcularEstadoPresupuesto(pres, facturas) : null;
        const filas = facturasVisibles(pres);
        const provPres = pres ? proveedores.find(p => p.id === pres.proveedorId) : null;

        const semColor = est ? (est.semaforo === 'rojo' ? '#dc2626' : (est.semaforo === 'ambar' ? '#d97706' : '#16a34a')) : '#64748b';
        const semBg = est ? (est.semaforo === 'rojo' ? '#fef2f2' : (est.semaforo === 'ambar' ? '#fffbeb' : '#f0fdf4')) : '#f8fafc';
        const barraPct = est ? Math.min(100, Math.max(0, est.porcentaje)) : 0;

        r.innerHTML = `
        <div class="oxf-wrap">
            <div class="oxf-toolbar">
                <div class="oxf-filtros">
                    <label class="oxf-fld">
                        <span>Proveedor</span>
                        <select id="oxf-f-prov">
                            <option value="TODOS"${filtroProv === 'TODOS' ? ' selected' : ''}>Todos los proveedores</option>
                            <option value="ACTIVO"${filtroProv === 'ACTIVO' ? ' selected' : ''}>Empresas Activas</option>
                            <option value="HISTORICO"${filtroProv === 'HISTORICO' ? ' selected' : ''}>Históricos (ej. Indura S.A.)</option>
                            ${proveedores.map(p => `<option value="${esc(p.id)}"${filtroProv === p.id ? ' selected' : ''}>${esc(p.razonSocial)} (${esc(p.rut)})${p.estado === 'HISTORICO' ? ' [Histórico]' : ''}</option>`).join('')}
                        </select>
                    </label>
                    <label class="oxf-fld oxf-fld-grow">
                        <span>Presupuesto / Orden de Compra Activa</span>
                        <select id="oxf-f-pres">
                            ${visPres.length
                                ? visPres.map(b => {
                                    const pv = proveedores.find(p => p.id === b.proveedorId);
                                    return `<option value="${esc(b.id)}"${pres && pres.id === b.id ? ' selected' : ''}>OC ${esc(b.numeroOC)} — ${esc(pv ? pv.razonSocial : '')} · ${esc(b.conceptoPermitido)} (${clp(b.montoTope)} ${esc(b.tipoMonto)})</option>`;
                                }).join('')
                                : '<option value="">Sin presupuestos / OC en este filtro</option>'}
                        </select>
                    </label>
                    <div class="oxf-pills" role="group" aria-label="Filtrar concepto">
                        <button type="button" class="oxf-pill${filtroConcepto === 'TODOS' ? ' on' : ''}" data-c="TODOS">Todos</button>
                        <button type="button" class="oxf-pill${filtroConcepto === 'ARRIENDO' ? ' on' : ''}" data-c="ARRIENDO">Arriendo / Renta</button>
                        <button type="button" class="oxf-pill${filtroConcepto === 'RECARGA' ? ' on' : ''}" data-c="RECARGA">Recargas</button>
                    </div>
                </div>
                <div class="oxf-acciones">
                    <button type="button" class="btn btn-outline btn-sm" id="oxf-btn-prov">+ Proveedor</button>
                    <button type="button" class="btn btn-outline btn-sm" id="oxf-btn-pres">+ Presupuesto / OC</button>
                    <button type="button" class="btn btn-outline btn-sm" id="oxf-btn-semilla" title="Carga idempotente de control con Indura S.A. OC 1298355-493-AG25">Cargar control Indura</button>
                    <button type="button" class="btn btn-primary" id="oxf-btn-nueva">+ Ingresar Factura (OCR / XML)</button>
                </div>
            </div>

            ${pres && est ? `
            <div class="oxf-panel-pres" style="border-color:${semColor}; background:${semBg};">
                <div class="oxf-pres-meta">
                    <div>
                        <span class="oxf-badge ${provPres && provPres.estado === 'HISTORICO' ? 'oxf-b-hist' : 'oxf-b-act'}">${esc(provPres && provPres.estado === 'HISTORICO' ? 'HISTÓRICO' : 'ACTIVO')}</span>
                        <span class="oxf-badge oxf-b-tipo">${esc(pres.conceptoPermitido)}</span>
                        <strong>OC ${esc(pres.numeroOC)}</strong>
                        <span>· ${esc(pres.nombreContrato)}</span>
                    </div>
                    <small>${esc(provPres ? `${provPres.razonSocial} (${provPres.rut})` : '')} · Tope ${esc(pres.tipoMonto)}${pres.vigenciaDesde ? ` · Vigencia ${esc(fechaCL(pres.vigenciaDesde))} a ${esc(fechaCL(pres.vigenciaHasta))}` : ''}</small>
                </div>
                <div class="oxf-kpis">
                    <div class="oxf-kpi">
                        <span>Presupuesto Base</span>
                        <strong>${clp(est.presupuestoBase)}</strong>
                        <small>${esc(pres.tipoMonto)}</small>
                    </div>
                    <div class="oxf-kpi">
                        <span>Ejecutado en OC</span>
                        <strong style="color:${semColor}">${clp(est.ejecutadoOC)}</strong>
                        <small>${est.cantidadVigentes} factura(s) vigente(s)</small>
                    </div>
                    <div class="oxf-kpi">
                        <span>Saldo Disponible</span>
                        <strong style="color:${est.saldoDisponible < 0 ? '#dc2626' : '#0f172a'}">${clp(est.saldoDisponible)}</strong>
                        <small>${est.semaforo === 'rojo' ? 'Alerta crítica (>90%)' : est.semaforo === 'ambar' ? 'Precaución (75–90%)' : 'Saludable (<75%)'}</small>
                    </div>
                    <div class="oxf-kpi oxf-kpi-cc">
                        <span>Derivado a Caja Chica</span>
                        <strong>${clp(est.totalCajaChica)}</strong>
                        <small>Fuera del tope de OC</small>
                    </div>
                </div>
                <div class="oxf-prog-wrap">
                    <div class="oxf-prog-lbl">
                        <span>Consumo del Presupuesto OC</span>
                        <b style="color:${semColor}">${esc(est.porcentajeTexto)}</b>
                    </div>
                    <div class="oxf-prog-bar"><div class="oxf-prog-fill" style="width:${barraPct.toFixed(1)}%; background:${semColor};"></div></div>
                    ${(est.desglose.ARRIENDO > 0 && est.desglose.RECARGA > 0) ? `<div class="oxf-desglose">Renta/Arriendo: <b>${clp(est.desglose.ARRIENDO)}</b> · Recargas: <b>${clp(est.desglose.RECARGA)}</b></div>` : ''}
                </div>
            </div>` : `
            <div class="oxf-empty">
                <p>No hay presupuestos/OC cargados todavía. Puedes crear un proveedor y una OC o usar <b>«Cargar control Indura»</b> para verificar el contador con los datos reales de Indura S.A. (OC 1298355-493-AG25).</p>
            </div>`}

            <div class="oxf-tabla-head">
                <input id="oxf-buscar" type="search" placeholder="Buscar folio, SAP, reemplaza, período o proveedor…" value="${esc(buscador)}" autocomplete="off">
                <span class="oxf-count">${filas.length} factura(s)</span>
            </div>

            <div class="oxf-tabla-wrap">
                <table class="soc-tabla oxf-tabla">
                    <thead>
                        <tr>
                            <th>Folio</th>
                            <th>Proveedor</th>
                            <th>Período</th>
                            <th>Tipo</th>
                            <th>Reemplaza</th>
                            <th>Fuente</th>
                            <th class="num">Total</th>
                            <th>Estado Recepción</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filas.length ? filas.map(fac => {
                            const pv = proveedores.find(p => p.id === fac.proveedorId);
                            const rc = fac.recepcionConforme || {};
                            const reemp = fac.estado === 'REEMPLAZADA';
                            const fuenteBadge = fac.fuenteFinanciamiento === 'CAJA_CHICA'
                                ? (num(fac.montoImputadoOC) > 0
                                    ? `<span class="oxf-badge oxf-b-cc">OC ${clp(fac.montoImputadoOC)} + CC ${clp(fac.montoCajaChica)}</span>`
                                    : `<span class="oxf-badge oxf-b-cc">Caja Chica</span>`)
                                : `<span class="oxf-badge oxf-b-oc">Presupuesto OC</span>`;
                            return `<tr class="${reemp ? 'oxf-tr-reemp' : ''}">
                                <td>
                                    <b>${esc(fac.folio)}</b>
                                    ${fac.facturaSAP ? `<small class="oxf-sub">SAP: ${esc(fac.facturaSAP)}</small>` : ''}
                                    ${reemp ? `<span class="oxf-badge oxf-b-reemp">REEMPLAZADA${fac.reemplazadaPor ? ' por ' + esc(fac.reemplazadaPor) : ''}</span>` : ''}
                                </td>
                                <td>${esc(pv ? pv.razonSocial : '—')}<small class="oxf-sub">${esc(pv ? pv.rut : '')}</small></td>
                                <td>${esc(fmtPeriodo(fac.periodoServicio))}<small class="oxf-sub">${esc(fechaCL(fac.fechaEmision))}</small></td>
                                <td><span class="oxf-badge oxf-b-tipo">${esc(fac.tipoServicio || 'ARRIENDO')}</span></td>
                                <td>${fac.reemplazaFactura ? `<code>${esc(fac.reemplazaFactura)}</code>` : '—'}</td>
                                <td>${fuenteBadge}${fac.motivoCajaChica ? `<small class="oxf-sub" title="${esc(fac.motivoCajaChica)}">${esc(fac.motivoCajaChica.slice(0, 38))}</small>` : ''}</td>
                                <td class="num"><b>${clp(fac.totalBruto)}</b><small class="oxf-sub">Neto ${clp(fac.neto)} · IVA ${clp(fac.iva)}</small></td>
                                <td>${rc.emitida
                                    ? `<span class="oxf-badge oxf-b-ok">Conforme · ${esc(rc.numeroActa || '')}</span><small class="oxf-sub">${esc(fechaCL(rc.fecha))} · ${esc(rc.receptorNombre || '')}</small>`
                                    : `<span class="oxf-badge oxf-b-pend">Pendiente Ley 19.983</span>`}</td>
                                <td class="oxf-cell-acc">
                                    ${fac.archivoUrl ? `<a class="btn btn-outline btn-sm" href="${esc(fac.archivoUrl)}" target="_blank" rel="noopener">Ver respaldo</a>` : `<button type="button" class="btn btn-outline btn-sm" disabled title="Sin archivo adjunto en Storage">Sin respaldo</button>`}
                                    <button type="button" class="btn btn-outline btn-sm oxf-btn-rc" data-id="${esc(fac.id)}">${rc.emitida ? 'Editar RC' : 'Recepción Conforme'}</button>
                                    <button type="button" class="btn btn-primary btn-sm oxf-btn-pdf" data-id="${esc(fac.id)}"${rc.emitida ? '' : ' title="Vista preliminar / emitir RC primero"'}>Acta PDF</button>
                                </td>
                            </tr>`;
                        }).join('') : `<tr><td colspan="9" class="oxf-td-vacio">No hay facturas registradas para este filtro.</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>`;

        enlazarEventos(r);
    }

    function enlazarEventos(r) {
        const $ = (s) => r.querySelector(s);
        const $$ = (s) => r.querySelectorAll(s);
        const selProv = $('#oxf-f-prov');
        if (selProv) selProv.addEventListener('change', () => { filtroProv = selProv.value; filtroPresId = ''; pintar(); });
        const selPres = $('#oxf-f-pres');
        if (selPres) selPres.addEventListener('change', () => { filtroPresId = selPres.value; pintar(); });
        $$('.oxf-pill').forEach(b => b.addEventListener('click', () => { filtroConcepto = b.dataset.c; pintar(); }));
        const inpB = $('#oxf-buscar');
        if (inpB) inpB.addEventListener('input', (e) => {
            buscador = e.target.value;
            const pos = e.target.selectionStart;
            pintar();
            const n = document.getElementById('oxf-buscar');
            if (n) { n.focus(); n.setSelectionRange(pos, pos); }
        });

        const bProv = $('#oxf-btn-prov');
        if (bProv) bProv.addEventListener('click', abrirModalProveedor);
        const bPres = $('#oxf-btn-pres');
        if (bPres) bPres.addEventListener('click', abrirModalPresupuesto);
        const bNueva = $('#oxf-btn-nueva');
        if (bNueva) bNueva.addEventListener('click', abrirModalFactura);
        const bSem = $('#oxf-btn-semilla');
        if (bSem) bSem.addEventListener('click', async () => {
            bSem.disabled = true;
            try {
                await cargarSemillaIndura();
                await cargarDatos();
                pintar();
                toast('Semilla Indura cargada', 'OC 1298355-493-AG25 · Ejecutado $1.016.976 (94,3%) · Saldo $61.024.', 'success');
            } catch (e) {
                toast('Error', 'No se pudo cargar la semilla: ' + (e.message || e), 'error');
            } finally {
                bSem.disabled = false;
            }
        });

        $$('.oxf-btn-rc').forEach(b => b.addEventListener('click', () => {
            const fac = facturas.find(x => x.id === b.dataset.id);
            if (fac) abrirModalRecepcionConforme(fac);
        }));
        $$('.oxf-btn-pdf').forEach(b => b.addEventListener('click', () => {
            const fac = facturas.find(x => x.id === b.dataset.id);
            if (fac) abrirModalVistaActaPDF(fac);
        }));
    }

    function crearModal(titulo, bodyHtml, extraClass) {
        const ov = document.createElement('div');
        ov.className = 'cierre-overlay oxf-overlay';
        ov.innerHTML = `<div class="cierre-box oxf-modal ${extraClass || ''}" role="dialog" aria-modal="true">
            <div class="oxf-m-head"><h3>${esc(titulo)}</h3><button type="button" class="btn btn-outline btn-sm oxf-m-x" aria-label="Cerrar">✕</button></div>
            <div class="oxf-m-body">${bodyHtml}</div>
        </div>`;
        document.body.appendChild(ov);
        ov.querySelector('.oxf-m-x').addEventListener('click', () => ov.remove());
        return ov;
    }

    function abrirModalProveedor() {
        const ov = crearModal('Registrar Proveedor de Oxígeno', `
            <div class="oxf-form-grid">
                <label class="act-l">Razón Social *<input id="oxf-p-rs" placeholder="Ej: Linde Gas Chile S.A."></label>
                <label class="act-l">RUT *<input id="oxf-p-rut" placeholder="Ej: 76.150.343-K"></label>
                <label class="act-l">Estado<select id="oxf-p-est"><option value="ACTIVO">Activo (Empresa Actual)</option><option value="HISTORICO">Histórico</option></select></label>
                <label class="act-l">Email contacto<input id="oxf-p-mail" type="email" placeholder="facturacion@proveedor.cl"></label>
                <label class="act-l oxf-span2">Cuenta bancaria (referencia pagos)<input id="oxf-p-cta" placeholder="Banco · Tipo cuenta · N°"></label>
            </div>
            <p class="cierre-error" id="oxf-p-err"></p>
            <div class="cierre-acciones">
                <button type="button" class="btn btn-outline" id="oxf-p-no">Cancelar</button>
                <button type="button" class="btn btn-primary" id="oxf-p-ok">Guardar proveedor</button>
            </div>`);
        ov.querySelector('#oxf-p-no').addEventListener('click', () => ov.remove());
        ov.querySelector('#oxf-p-ok').addEventListener('click', async () => {
            const btn = ov.querySelector('#oxf-p-ok'); btn.disabled = true;
            ov.querySelector('#oxf-p-err').textContent = '';
            try {
                await guardarProveedor({
                    razonSocial: ov.querySelector('#oxf-p-rs').value,
                    rut: ov.querySelector('#oxf-p-rut').value,
                    estado: ov.querySelector('#oxf-p-est').value,
                    contactoEmail: ov.querySelector('#oxf-p-mail').value,
                    cuentaBancaria: ov.querySelector('#oxf-p-cta').value
                });
                await cargarDatos();
                pintar();
                ov.remove();
                toast('Proveedor', 'Proveedor de oxígeno guardado.', 'success');
            } catch (e) {
                ov.querySelector('#oxf-p-err').textContent = e.message || String(e);
                btn.disabled = false;
            }
        });
    }

    function abrirModalPresupuesto() {
        if (!proveedores.length) {
            toast('Proveedor requerido', 'Primero registra un proveedor o carga el control Indura.', 'warning');
            abrirModalProveedor();
            return;
        }
        const ov = crearModal('Nuevo Presupuesto / Orden de Compra de Oxígeno', `
            <div class="oxf-form-grid">
                <label class="act-l">Proveedor *<select id="oxf-b-prov">${proveedores.map(p => `<option value="${esc(p.id)}">${esc(p.razonSocial)} (${esc(p.rut)})</option>`).join('')}</select></label>
                <label class="act-l">N° Orden de Compra *<input id="oxf-b-oc" placeholder="Ej: 1298355-493-AG25"></label>
                <label class="act-l oxf-span2">Nombre del Contrato / Bolsa<input id="oxf-b-nom" placeholder="Ej: Arriendo cilindros oxígeno 2026"></label>
                <label class="act-l">Concepto Permitido<select id="oxf-b-con"><option value="ARRIENDO">Arriendo / Renta</option><option value="RECARGA">Recarga</option><option value="MIXTO">Mixto (Arriendo y Recarga)</option></select></label>
                <label class="act-l">Tipo de Monto<select id="oxf-b-tm"><option value="BRUTO">Bruto (IVA incluido)</option><option value="NETO">Neto</option></select></label>
                <label class="act-l">Monto Tope ($) *<input id="oxf-b-tope" type="number" min="1" step="1" placeholder="Ej: 1078000"></label>
                <label class="act-l">Estado<select id="oxf-b-est"><option value="ACTIVO">Activo</option><option value="CERRADO">Cerrado</option></select></label>
                <label class="act-l">Vigencia Desde<input id="oxf-b-des" type="date" value="${hoyISO()}"></label>
                <label class="act-l">Vigencia Hasta<input id="oxf-b-has" type="date"></label>
            </div>
            <p class="cierre-error" id="oxf-b-err"></p>
            <div class="cierre-acciones">
                <button type="button" class="btn btn-outline" id="oxf-b-no">Cancelar</button>
                <button type="button" class="btn btn-primary" id="oxf-b-ok">Guardar presupuesto / OC</button>
            </div>`);
        ov.querySelector('#oxf-b-no').addEventListener('click', () => ov.remove());
        ov.querySelector('#oxf-b-ok').addEventListener('click', async () => {
            const btn = ov.querySelector('#oxf-b-ok'); btn.disabled = true;
            ov.querySelector('#oxf-b-err').textContent = '';
            try {
                const id = await guardarPresupuesto({
                    proveedorId: ov.querySelector('#oxf-b-prov').value,
                    numeroOC: ov.querySelector('#oxf-b-oc').value,
                    nombreContrato: ov.querySelector('#oxf-b-nom').value,
                    conceptoPermitido: ov.querySelector('#oxf-b-con').value,
                    tipoMonto: ov.querySelector('#oxf-b-tm').value,
                    montoTope: ov.querySelector('#oxf-b-tope').value,
                    estado: ov.querySelector('#oxf-b-est').value,
                    vigenciaDesde: ov.querySelector('#oxf-b-des').value,
                    vigenciaHasta: ov.querySelector('#oxf-b-has').value
                });
                filtroPresId = id;
                await cargarDatos();
                pintar();
                ov.remove();
                toast('Presupuesto', 'Orden de compra / presupuesto guardado.', 'success');
            } catch (e) {
                ov.querySelector('#oxf-b-err').textContent = e.message || String(e);
                btn.disabled = false;
            }
        });
    }

    /** Paso 2 + Paso 3: Modal de Ingreso de Factura (Drag & Drop XML/PDF/IMG + Rotación + OCR/Gemini + Simulador Anti-Sobregiro). */
    function abrirModalFactura() {
        if (!proveedores.length) {
            toast('Sin proveedores', 'Primero registra un proveedor o carga el control Indura.', 'warning');
            return;
        }
        const presSel = presupuestoActual();
        const provInicial = presSel ? presSel.proveedorId : proveedores[0].id;

        const ov = crearModal('Ingresar Factura de Oxígeno (Lector XML DTE / OCR Multimodal)', `
            <div class="oxf-dropzone" id="oxf-drop" tabindex="0">
                <input type="file" id="oxf-file" accept=".xml,.pdf,.jpg,.jpeg,.png,application/xml,text/xml,application/pdf,image/jpeg,image/png" hidden>
                <strong>Arrastra aquí la factura (.xml DTE SII, .pdf, .jpg o .png) o haz clic para seleccionar</strong>
                <small>XML DTE se lee al instante en navegador · PDF/imagen permite rotar 90°/180° y extrae con Gemini Vision / OCR local.</small>
                <div id="oxf-drop-status" class="oxf-drop-status"></div>
            </div>

            <div id="oxf-prev-wrap" class="oxf-prev-wrap" style="display:none;">
                <div class="oxf-prev-bar">
                    <span>Vista previa del documento (corrige orientación si llegó escaneado al revés):</span>
                    <div>
                        <button type="button" class="btn btn-outline btn-sm" id="oxf-rot-izq">↺ -90°</button>
                        <button type="button" class="btn btn-outline btn-sm" id="oxf-rot-der">↻ +90°</button>
                        <button type="button" class="btn btn-outline btn-sm" id="oxf-rot-180">⇅ 180°</button>
                        <button type="button" class="btn btn-primary btn-sm" id="oxf-reextraer">Re-leer con esta orientación</button>
                    </div>
                </div>
                <div class="oxf-prev-canvas-box"><canvas id="oxf-prev-canvas"></canvas></div>
            </div>

            <div class="oxf-form-grid">
                <label class="act-l">Proveedor *
                    <select id="oxf-f-proveedor">${proveedores.map(p => `<option value="${esc(p.id)}"${p.id === provInicial ? ' selected' : ''}>${esc(p.razonSocial)} (${esc(p.rut)})</option>`).join('')}</select>
                </label>
                <label class="act-l">Presupuesto / OC asociada
                    <select id="oxf-f-presupuesto">
                        <option value="">— Sin OC (solo Caja Chica) —</option>
                        ${presupuestos.map(b => `<option value="${esc(b.id)}"${presSel && presSel.id === b.id ? ' selected' : ''}>OC ${esc(b.numeroOC)} · ${esc(b.conceptoPermitido)} (${clp(b.montoTope)})</option>`).join('')}
                    </select>
                </label>
                <label class="act-l">Folio Factura *<input id="oxf-f-folio" placeholder="Ej: 2074903" autocomplete="off"></label>
                <label class="act-l">N° Orden de Compra<input id="oxf-f-oc" value="${esc(presSel ? presSel.numeroOC : '')}" placeholder="Ej: 1298355-493-AG25"></label>
                <label class="act-l">Factura SAP (opcional)<input id="oxf-f-sap" placeholder="N° documento SAP"></label>
                <label class="act-l">Reemplaza Factura N° (opcional)<input id="oxf-f-reemp" placeholder="Si reemplaza folio previo, lo marca REEMPLAZADA"></label>
                <label class="act-l">Tipo de Servicio
                    <select id="oxf-f-tipo">
                        <option value="ARRIENDO">Arriendo / Renta cilindros</option>
                        <option value="RECARGA">Recarga oxígeno / gas medicinal</option>
                        <option value="MIXTO">Mixto (Arriendo y Recarga)</option>
                    </select>
                </label>
                <label class="act-l">Período Servicio (AAAA-MM) *<input id="oxf-f-per" type="month" value="${hoyISO().slice(0, 7)}"></label>
                <label class="act-l">Fecha Emisión<input id="oxf-f-femis" type="date" value="${hoyISO()}"></label>
                <label class="act-l">Fecha Vencimiento<input id="oxf-f-fvenc" type="date"></label>
                <label class="act-l">Monto Neto ($)<input id="oxf-f-neto" type="number" min="0" step="1" value="0"></label>
                <label class="act-l">IVA ($)<input id="oxf-f-iva" type="number" min="0" step="1" value="0"></label>
                <label class="act-l">Total Bruto ($) *<input id="oxf-f-total" type="number" min="0" step="1" value="0"></label>
                <div class="oxf-calc-btn-wrap"><button type="button" class="btn btn-outline btn-sm" id="oxf-calc-iva">Calcular IVA 19%</button></div>
            </div>

            <div id="oxf-alerta-cuadre" class="oxf-alert-warn" style="display:none;"></div>

            <div class="oxf-items-sec">
                <div class="oxf-items-head">
                    <b>Detalle de Ítems / Cilindros</b>
                    <button type="button" class="btn btn-outline btn-sm" id="oxf-add-item">+ Agregar ítem</button>
                </div>
                <div id="oxf-items-list"></div>
            </div>

            <div id="oxf-sim-card" class="oxf-sim-card"></div>

            <div id="oxf-cc-box" class="oxf-cc-box" style="display:none;">
                <label class="act-l">Modalidad de Financiamiento / Derivación a Caja Chica
                    <select id="oxf-f-modo">
                        <option value="OC_100">Imputar 100% a Presupuesto OC</option>
                        <option value="SPLIT_CC">Imputar saldo disponible a OC y derivar diferencia a Caja Chica</option>
                        <option value="CC_100">Derivar 100% de la factura a Caja Chica</option>
                    </select>
                </label>
                <label class="act-l">Motivo / trazabilidad de derivación a Caja Chica *
                    <input id="oxf-f-motivo-cc" placeholder="Ej: Sobregiro en OC de arriendo por término de bolsa anual; aprobado por Dirección.">
                </label>
            </div>

            <p class="cierre-error" id="oxf-f-err"></p>
            <div class="cierre-acciones">
                <button type="button" class="btn btn-outline" id="oxf-f-no">Cancelar</button>
                <button type="button" class="btn btn-primary" id="oxf-f-ok">Guardar Factura</button>
            </div>`, 'oxf-modal-xl');

        const q = (s) => ov.querySelector(s);
        let archivoActual = null;
        let canvasBase = null;
        let textoDigitalPdf = '';
        let anguloActual = 0;
        let itemsEstado = [];

        function pintarItems() {
            const box = q('#oxf-items-list');
            if (!itemsEstado.length) {
                box.innerHTML = '<p class="act-hint">Sin líneas detalladas (puedes agregar ítems o leer desde XML/OCR).</p>';
                return;
            }
            box.innerHTML = itemsEstado.map((it, i) => `
                <div class="oxf-item-row" data-i="${i}">
                    <input class="oxf-it-cod" placeholder="Cód." value="${esc(it.codigo || '')}">
                    <input class="oxf-it-desc" placeholder="Descripción" value="${esc(it.descripcion || '')}">
                    <input class="oxf-it-cant" type="number" step="any" placeholder="Cant." value="${num(it.cantidad) || 1}">
                    <input class="oxf-it-uni" placeholder="Unid." value="${esc(it.unidad || 'UN')}">
                    <input class="oxf-it-vu" type="number" step="any" placeholder="V. Unit." value="${num(it.valorUnitario)}">
                    <input class="oxf-it-vt" type="number" step="1" placeholder="Total" value="${num(it.valorTotal)}">
                    <button type="button" class="btn btn-outline btn-sm oxf-it-del" title="Quitar">✕</button>
                </div>`).join('');
            box.querySelectorAll('.oxf-item-row').forEach((row) => {
                const idx = Number(row.dataset.i);
                const sync = () => {
                    itemsEstado[idx] = {
                        codigo: row.querySelector('.oxf-it-cod').value.trim(),
                        descripcion: row.querySelector('.oxf-it-desc').value.trim(),
                        cantidad: num(row.querySelector('.oxf-it-cant').value) || 1,
                        unidad: row.querySelector('.oxf-it-uni').value.trim() || 'UN',
                        valorUnitario: num(row.querySelector('.oxf-it-vu').value),
                        valorTotal: Math.round(num(row.querySelector('.oxf-it-vt').value))
                    };
                };
                row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', sync));
                row.querySelector('.oxf-it-del').addEventListener('click', () => { itemsEstado.splice(idx, 1); pintarItems(); });
            });
        }

        function dibujarPreview() {
            if (!canvasBase) return;
            const rotado = rotarCanvas(canvasBase, anguloActual);
            const dst = q('#oxf-prev-canvas');
            dst.width = rotado.width;
            dst.height = rotado.height;
            dst.getContext('2d').drawImage(rotado, 0, 0);
        }

        function aplicarDatosExtraidos(res) {
            if (!res) return;
            if (res.rutEmisor) {
                const rNorm = normRut(res.rutEmisor);
                const matchProv = proveedores.find(p => normRut(p.rut) === rNorm);
                if (matchProv) q('#oxf-f-proveedor').value = matchProv.id;
            }
            if (res.numeroOC) {
                q('#oxf-f-oc').value = res.numeroOC;
                const matchPres = presupuestos.find(b => String(b.numeroOC || '').toUpperCase() === res.numeroOC.toUpperCase());
                if (matchPres) q('#oxf-f-presupuesto').value = matchPres.id;
            }
            if (res.folio) q('#oxf-f-folio').value = res.folio;
            if (res.facturaSAP) q('#oxf-f-sap').value = res.facturaSAP;
            if (res.reemplazaFactura) q('#oxf-f-reemp').value = res.reemplazaFactura;
            if (res.tipoServicio) q('#oxf-f-tipo').value = res.tipoServicio;
            if (res.periodoServicio && /^\d{4}-\d{2}$/.test(res.periodoServicio)) q('#oxf-f-per').value = res.periodoServicio;
            if (res.fechaEmision) q('#oxf-f-femis').value = res.fechaEmision;
            if (res.fechaVencimiento) q('#oxf-f-fvenc').value = res.fechaVencimiento;
            if (res.neto != null) q('#oxf-f-neto').value = Math.round(num(res.neto));
            if (res.iva != null) q('#oxf-f-iva').value = Math.round(num(res.iva));
            if (res.totalBruto != null) q('#oxf-f-total').value = Math.round(num(res.totalBruto));
            if (Array.isArray(res.items) && res.items.length) {
                itemsEstado = res.items.slice();
                pintarItems();
            }
            actualizarSimulador();
        }

        function calcularMontosModo(sim, modo) {
            if (modo === 'CC_100') return { fuente: 'CAJA_CHICA', impOC: 0, impCC: sim.montoFactura };
            if (modo === 'SPLIT_CC') return { fuente: 'CAJA_CHICA', impOC: sim.sugeridoOC, impCC: sim.sugeridoCajaChica };
            return { fuente: 'PRESUPUESTO_OC', impOC: sim.montoFactura, impCC: 0 };
        }

        function actualizarSimulador() {
            const neto = Math.round(num(q('#oxf-f-neto').value));
            const iva = Math.round(num(q('#oxf-f-iva').value));
            const total = Math.round(num(q('#oxf-f-total').value));
            const diff = Math.abs((neto + iva) - total);
            const alCuadre = q('#oxf-alerta-cuadre');
            if (total > 0 && diff > TOLERANCIA_REDONDEO) {
                alCuadre.style.display = 'block';
                alCuadre.textContent = `Atención: Neto (${clp(neto)}) + IVA (${clp(iva)}) = ${clp(neto + iva)} no coincide con Total Bruto (${clp(total)}). Diferencia: ${clp(diff)} (tolerancia ±$${TOLERANCIA_REDONDEO}).`;
            } else {
                alCuadre.style.display = 'none';
            }

            const presId = q('#oxf-f-presupuesto').value;
            const pres = presupuestos.find(b => b.id === presId) || null;
            const provId = q('#oxf-f-proveedor').value;
            const folioReemp = q('#oxf-f-reemp').value.trim();
            const simCard = q('#oxf-sim-card');
            const ccBox = q('#oxf-cc-box');
            const modoSel = q('#oxf-f-modo');
            const btnOk = q('#oxf-f-ok');

            if (!pres) {
                simCard.className = 'oxf-sim-card oxf-sim-cc';
                simCard.innerHTML = `<div><b>Sin OC asociada:</b> Esta factura se registrará 100% bajo <b>Caja Chica</b> (${clp(total)}).</div>`;
                ccBox.style.display = 'block';
                modoSel.value = 'CC_100';
                btnOk.disabled = false;
                return;
            }

            const est = calcularEstadoPresupuesto(pres, facturas);
            const prevDoc = folioReemp ? facturas.find(x => x.proveedorId === provId && String(x.folio || '').trim() === folioReemp && x.estado !== 'REEMPLAZADA') : null;
            const liberado = prevDoc && prevDoc.presupuestoId === pres.id ? num(prevDoc.montoImputadoOC) : 0;
            const montoComp = pres.tipoMonto === 'NETO' ? neto : total;
            const sim = simularImputacion(est.saldoDisponible, montoComp, liberado);

            if (sim.haySobregiro) {
                ccBox.style.display = 'block';
                if (modoSel.value === 'OC_100') modoSel.value = 'SPLIT_CC';
                const m = calcularMontosModo(sim, modoSel.value);
                const bloqueado = modoSel.value === 'OC_100';
                simCard.className = 'oxf-sim-card oxf-sim-danger';
                simCard.innerHTML = `
                    <div class="oxf-sim-alerta">SOBREGIRO DETECTADO (+${clp(sim.montoSobregiro)} sobre el tope de la OC ${esc(pres.numeroOC)})</div>
                    <div class="oxf-sim-flujo">
                        <div><span>Saldo actual OC</span><b>${clp(sim.saldoActual)}</b></div>
                        <span class="oxf-arrow">→</span>
                        <div><span>Monto factura (${esc(pres.tipoMonto)})</span><b>${clp(sim.montoFactura)}</b></div>
                        <span class="oxf-arrow">→</span>
                        <div><span>Saldo proyectado</span><b style="color:#dc2626">${clp(sim.saldoProyectado)}</b></div>
                    </div>
                    <div class="oxf-sim-plan">Guardado directo 100% contra OC <b>bloqueado</b>. Distribución seleccionada: <b>OC ${clp(m.impOC)}</b> · <b>Caja Chica ${clp(m.impCC)}</b>.</div>`;
                btnOk.disabled = bloqueado;
            } else {
                simCard.className = 'oxf-sim-card oxf-sim-ok';
                simCard.innerHTML = `
                    <div class="oxf-sim-flujo">
                        <div><span>Saldo actual OC${liberado ? ` (incl. liberación ${clp(liberado)})` : ''}</span><b>${clp(sim.saldoActual)}</b></div>
                        <span class="oxf-arrow">→</span>
                        <div><span>Monto factura (${esc(pres.tipoMonto)})</span><b>${clp(sim.montoFactura)}</b></div>
                        <span class="oxf-arrow">→</span>
                        <div><span>Saldo proyectado</span><b style="color:#15803d">${clp(sim.saldoProyectado)}</b></div>
                    </div>`;
                // Permite derivar voluntariamente a Caja Chica si el usuario ya eligió CC, pero por defecto va a OC
                if (modoSel.value === 'OC_100') ccBox.style.display = 'none';
                btnOk.disabled = false;
            }
        }

        async function procesarArchivo(file) {
            if (!file) return;
            archivoActual = file;
            const st = q('#oxf-drop-status');
            const name = String(file.name || '').toLowerCase();
            st.textContent = `Procesando ${file.name}…`;
            try {
                if (name.endsWith('.xml') || file.type === 'text/xml' || file.type === 'application/xml') {
                    q('#oxf-prev-wrap').style.display = 'none';
                    const txt = await file.text();
                    const res = parsearXmlDte(txt);
                    aplicarDatosExtraidos(res);
                    st.textContent = `XML DTE SII leído correctamente (Folio ${res.folio || '—'} · ${res.items.length} ítem(s)). Revisa los campos antes de guardar.`;
                    return;
                }
                const { canvas, textoDigital } = await renderizarArchivoACanvas(file);
                canvasBase = canvas;
                textoDigitalPdf = textoDigital;
                anguloActual = 0;
                q('#oxf-prev-wrap').style.display = 'block';
                dibujarPreview();
                const res = await extraerFacturaDesdeVisual(canvasBase, textoDigitalPdf, (msg) => { st.textContent = msg; });
                aplicarDatosExtraidos(res);
                st.textContent = `Lectura completada (${res.origenLectura}). Si el documento estaba invertido, rótalos arriba y pulsa «Re-leer».`;
            } catch (e) {
                st.textContent = 'Aviso: ' + (e.message || String(e));
            }
        }

        // Eventos Drag & Drop y rotación
        const dz = q('#oxf-drop'), fi = q('#oxf-file');
        dz.addEventListener('click', () => fi.click());
        dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
        dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('over'));
        dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) procesarArchivo(e.dataTransfer.files[0]); });
        fi.addEventListener('change', () => { if (fi.files[0]) procesarArchivo(fi.files[0]); });

        q('#oxf-rot-izq').addEventListener('click', () => { anguloActual = (anguloActual + 270) % 360; dibujarPreview(); });
        q('#oxf-rot-der').addEventListener('click', () => { anguloActual = (anguloActual + 90) % 360; dibujarPreview(); });
        q('#oxf-rot-180').addEventListener('click', () => { anguloActual = (anguloActual + 180) % 360; dibujarPreview(); });
        q('#oxf-reextraer').addEventListener('click', async () => {
            if (!canvasBase) return;
            const st = q('#oxf-drop-status');
            try {
                const rotado = rotarCanvas(canvasBase, anguloActual);
                const res = await extraerFacturaDesdeVisual(rotado, '', (msg) => { st.textContent = msg; });
                aplicarDatosExtraidos(res);
                st.textContent = `Re-lectura completada (${res.origenLectura}) con rotación ${anguloActual}°.`;
            } catch (e) {
                st.textContent = 'Error al re-leer: ' + (e.message || e);
            }
        });

        q('#oxf-add-item').addEventListener('click', () => {
            itemsEstado.push({ codigo: '', descripcion: '', cantidad: 1, unidad: 'UN', valorUnitario: 0, valorTotal: 0 });
            pintarItems();
        });
        q('#oxf-calc-iva').addEventListener('click', () => {
            const n = Math.round(num(q('#oxf-f-neto').value));
            const i = Math.round(n * 0.19);
            q('#oxf-f-iva').value = i;
            q('#oxf-f-total').value = n + i;
            actualizarSimulador();
        });
        ['#oxf-f-proveedor', '#oxf-f-presupuesto', '#oxf-f-neto', '#oxf-f-iva', '#oxf-f-total', '#oxf-f-reemp', '#oxf-f-modo'].forEach(sel => {
            q(sel).addEventListener('input', actualizarSimulador);
            q(sel).addEventListener('change', actualizarSimulador);
        });
        q('#oxf-f-presupuesto').addEventListener('change', () => {
            const p = presupuestos.find(b => b.id === q('#oxf-f-presupuesto').value);
            if (p) { q('#oxf-f-oc').value = p.numeroOC; q('#oxf-f-proveedor').value = p.proveedorId; }
            actualizarSimulador();
        });

        q('#oxf-f-no').addEventListener('click', () => ov.remove());
        q('#oxf-f-ok').addEventListener('click', async () => {
            const btn = q('#oxf-f-ok');
            const errEl = q('#oxf-f-err');
            errEl.textContent = '';

            const presId = q('#oxf-f-presupuesto').value;
            const pres = presupuestos.find(b => b.id === presId) || null;
            const provId = q('#oxf-f-proveedor').value;
            const folioReemp = q('#oxf-f-reemp').value.trim();
            const neto = Math.round(num(q('#oxf-f-neto').value));
            const iva = Math.round(num(q('#oxf-f-iva').value));
            const totalBruto = Math.round(num(q('#oxf-f-total').value));

            const est = pres ? calcularEstadoPresupuesto(pres, facturas) : { saldoDisponible: 0 };
            const prevDoc = folioReemp ? facturas.find(x => x.proveedorId === provId && String(x.folio || '').trim() === folioReemp && x.estado !== 'REEMPLAZADA') : null;
            const liberado = pres && prevDoc && prevDoc.presupuestoId === pres.id ? num(prevDoc.montoImputadoOC) : 0;
            const montoComp = pres && pres.tipoMonto === 'NETO' ? neto : totalBruto;
            const sim = simularImputacion(est.saldoDisponible, montoComp, liberado);
            const modo = !pres ? 'CC_100' : (sim.haySobregiro ? q('#oxf-f-modo').value : (q('#oxf-f-modo').value === 'CC_100' ? 'CC_100' : 'OC_100'));
            const dist = calcularMontosModo(sim, modo);

            const payload = {
                proveedorId: provId,
                presupuestoId: presId,
                numeroOC: q('#oxf-f-oc').value.trim().toUpperCase(),
                folio: q('#oxf-f-folio').value.trim(),
                facturaSAP: q('#oxf-f-sap').value.trim(),
                reemplazaFactura: folioReemp,
                tipoServicio: q('#oxf-f-tipo').value,
                periodoServicio: q('#oxf-f-per').value,
                fechaEmision: q('#oxf-f-femis').value,
                fechaVencimiento: q('#oxf-f-fvenc').value,
                items: itemsEstado,
                neto,
                iva,
                totalBruto,
                fuenteFinanciamiento: dist.fuente,
                montoImputadoOC: dist.impOC,
                montoCajaChica: dist.impCC,
                motivoCajaChica: q('#oxf-f-motivo-cc').value.trim()
            };

            const val = validarFactura(payload, facturas);
            if (!val.ok) { errEl.textContent = val.errores.join(' '); return; }
            if (val.advertencias.length && !window.confirm(val.advertencias.join('\n') + '\n\n¿Deseas guardar igualmente?')) return;

            btn.disabled = true;
            try {
                const res = await guardarFacturaAtomica(payload, archivoActual);
                await cargarDatos();
                pintar();
                ov.remove();
                const extra = res.reemplazoMarcado ? ` · Folio ${res.reemplazoMarcado} marcado REEMPLAZADA` : '';
                toast('Factura registrada', `Folio ${payload.folio} guardado (${clp(payload.totalBruto)})${extra}.`, res.avisoStorage ? 'warning' : 'success');
                if (res.avisoStorage) toast('Respaldo Storage', res.avisoStorage, 'warning');
            } catch (e) {
                errEl.textContent = e.message || String(e);
                btn.disabled = false;
            }
        });

        pintarItems();
        actualizarSimulador();
    }

    /** Paso 4: Modal de Recepción Conforme (Ley 19.983). */
    function abrirModalRecepcionConforme(factura) {
        const rc = factura.recepcionConforme || {};
        const pv = proveedores.find(p => p.id === factura.proveedorId);
        const ov = crearModal(`Recepción Conforme (Ley 19.983) · Factura N° ${factura.folio}`, `
            <p class="cierre-hint">Proveedor: <b>${esc(pv ? pv.razonSocial : '—')}</b> (${esc(pv ? pv.rut : '—')}) · OC <b>${esc(factura.numeroOC || '—')}</b> · Total <b>${clp(factura.totalBruto)}</b></p>
            <div class="oxf-form-grid">
                <label class="act-l">Fecha de Recepción Conforme *<input id="oxf-rc-fec" type="date" value="${esc(rc.fecha || hoyISO())}"></label>
                <label class="act-l">Recinto / Establecimiento *<input id="oxf-rc-rec" value="${esc(rc.recinto || RECINTO_BASE)}"></label>
                <label class="act-l">Nombre Receptor Conforme *<input id="oxf-rc-nom" value="${esc(rc.receptorNombre || '')}" placeholder="Ej: Matías Bustos Huerta"></label>
                <label class="act-l">RUT Receptor *<input id="oxf-rc-rut" value="${esc(rc.receptorRut || '')}" placeholder="Ej: 12.345.678-9"></label>
                <label class="act-l oxf-span2">Cargo *<input id="oxf-rc-car" value="${esc(rc.receptorCargo || '')}" placeholder="Ej: Encargado de Insumos / Contraparte Técnica"></label>
                <label class="act-l oxf-span2">Observaciones de conformidad<textarea id="oxf-rc-obs" rows="3" placeholder="Servicios / cilindros verificados conforme al contrato y guía de despacho…">${esc(rc.observaciones || '')}</textarea></label>
            </div>
            <p class="cierre-error" id="oxf-rc-err"></p>
            <div class="cierre-acciones">
                <button type="button" class="btn btn-outline" id="oxf-rc-no">Cancelar</button>
                <button type="button" class="btn btn-primary" id="oxf-rc-ok">Guardar Recepción Conforme</button>
            </div>`);
        ov.querySelector('#oxf-rc-no').addEventListener('click', () => ov.remove());
        ov.querySelector('#oxf-rc-ok').addEventListener('click', async () => {
            const btn = ov.querySelector('#oxf-rc-ok'); btn.disabled = true;
            ov.querySelector('#oxf-rc-err').textContent = '';
            try {
                const nuevaRC = await registrarRecepcionConforme(factura.id, {
                    fecha: ov.querySelector('#oxf-rc-fec').value,
                    recinto: ov.querySelector('#oxf-rc-rec').value,
                    receptorNombre: ov.querySelector('#oxf-rc-nom').value,
                    receptorRut: ov.querySelector('#oxf-rc-rut').value,
                    receptorCargo: ov.querySelector('#oxf-rc-car').value,
                    observaciones: ov.querySelector('#oxf-rc-obs').value
                });
                await cargarDatos();
                pintar();
                ov.remove();
                toast('Recepción Conforme', `Acta ${nuevaRC.numeroActa} registrada para Factura ${factura.folio}.`, 'success');
                const actFac = facturas.find(x => x.id === factura.id);
                if (actFac) abrirModalVistaActaPDF(actFac);
            } catch (e) {
                ov.querySelector('#oxf-rc-err').textContent = e.message || String(e);
                btn.disabled = false;
            }
        });
    }

    /** Vista previa limpia (fondo blanco forzado) + botón Descargar PDF e Imprimir Acta RC. */
    function abrirModalVistaActaPDF(factura) {
        const pv = proveedores.find(p => p.id === factura.proveedorId);
        const pres = presupuestos.find(b => b.id === factura.presupuestoId) || null;
        const estPres = pres ? calcularEstadoPresupuesto(pres, facturas) : null;
        const htmlHoja = construirHtmlActaRC(factura, pv, pres, estPres);
        const rc = factura.recepcionConforme || {};

        const ov = crearModal(`Acta de Recepción Conforme · Factura ${factura.folio}`, `
            ${!rc.emitida ? '<div class="oxf-alert-warn">Esta factura aún no tiene Recepción Conforme registrada. Puedes previsualizar el borrador o registrarla primero para asignar correlativo oficial RCO.</div>' : ''}
            <div class="oxf-acta-preview-scroll">${htmlHoja}</div>
            <div class="cierre-acciones">
                <button type="button" class="btn btn-outline" id="oxf-ap-no">Cerrar</button>
                <button type="button" class="btn btn-outline" id="oxf-ap-print">Imprimir / Guardar PDF (Navegador)</button>
                <button type="button" class="btn btn-primary" id="oxf-ap-pdf">Generar Acta de Recepción Conforme (PDF)</button>
            </div>`, 'oxf-modal-xl');

        ov.querySelector('#oxf-ap-no').addEventListener('click', () => ov.remove());
        ov.querySelector('#oxf-ap-print').addEventListener('click', () => imprimirActaRC(htmlHoja, `Acta RC ${rc.numeroActa || factura.folio}`));
        ov.querySelector('#oxf-ap-pdf').addEventListener('click', () => descargarActaRCPDF(factura, pv, pres, estPres));
    }

    async function montar(cont) {
        contenedorActivo = cont;
        if (!cont) return;
        cont.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando facturación y presupuestos de oxígeno…') : '<p style="padding:20px;">Cargando facturación de oxígeno…</p>';
        try {
            await cargarDatos();
            pintar(cont);
        } catch (e) {
            cont.innerHTML = `<p class="act-err" style="padding:24px;">No se pudo cargar Facturación de Oxígeno: ${esc(e.message || e)}</p>`;
        }
    }

    const api = {
        montar,
        pintar,
        cargarDatos,
        cargarSemillaIndura,
        // Funciones puras para pruebas unitarias
        parsearXmlDte,
        parsearTextoFacturaOcr,
        normalizarRespuestaIA,
        detectarTipoServicio,
        detectarPeriodoServicio,
        validarFactura,
        calcularEstadoPresupuesto,
        simularImputacion,
        datosSemillaIndura,
        construirHtmlActaRC,
        fmtRut,
        RECINTO_BASE
    };

    if (typeof window !== 'undefined') window.SAR_OxiFacturacion = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: { dataset: {} } });
