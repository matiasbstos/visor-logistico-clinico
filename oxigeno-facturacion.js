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
    const CONTRAPARTE_BASE = 'Mariel Quintanilla L.';
    const encabezadoRCBase = (parcial) => `Que se recibió conforme en forma ${parcial ? 'Parcial' : 'Total'} de los productos, donde se recibió lo siguiente:`;
    const PDFLIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
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

    /** Detecta tipo de servicio (ARRIENDO | RECARGA | MIXTO) a partir de texto e ítems sin falsos positivos en arriendos de cilindros de O2/Aire. */
    function detectarTipoServicio(texto, items) {
        const reArr = /\b(RENTAL|RG_RENTAL|ARRIENDO|ARRENDAMIENTO|RENTA|DIA[S]?[-\s]?CILINDRO|MANTENCION\s+CILINDRO|CANON)\b/;
        const reRec = /\b(RECARGA|CARGA\s+DE\s+OXIGENO|OXIGENO\s+MEDICINAL|OXIGENO\s+LIQUIDO|OXIGENO\s+GASEOSO|OXIGENO\s+\d|M3|METRO[S]?\s+CUBICO[S]?|GAS\s+MEDICINAL|AIRE\s+COMPRIMIDO|VALVULA[S]?\s+(?:ROSETA|PIN))\b/;
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

        if (Array.isArray(items) && items.length) {
            let hayArr = false, hayRec = false;
            items.forEach((it) => {
                const l = norm(`${it.codigo || ''} ${it.grupo || ''} ${it.descripcion || ''} ${it.unidad || ''}`);
                if (reArr.test(l)) hayArr = true;
                else if (reRec.test(l)) hayRec = true;
            });
            if (hayArr && hayRec) return 'MIXTO';
            if (hayArr) return 'ARRIENDO';
            if (hayRec) return 'RECARGA';
        }

        // Sin ítems: si el texto del documento menciona arriendo de cilindros explícitamente, priorizar arriendo salvo que también indique recarga
        const corpus = norm(texto).replace(/GIRO\s*:[^\n]+/g, '');
        const esArr = reArr.test(corpus);
        const esRec = /\b(RECARGA|CARGA\s+DE\s+OXIGENO|OXIGENO\s+\d+\s*M3|VALVULA[S]?\s+(?:ROSETA|PIN))\b/.test(corpus)
            || (!esArr && reRec.test(corpus));
        if (esArr && esRec) return 'MIXTO';
        if (esArr) return 'ARRIENDO';
        if (esRec) return 'RECARGA';
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

    /** Normaliza fechas DD/MM/AAAA, DD-MM-AAAA, DD.MM.AAAA, AAAA-MM-DD o "09 de Noviembre del 2026" a ISO AAAA-MM-DD. */
    function fechaAISO(txt) {
        const s = String(txt || '').trim();
        let m = s.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
        if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
        m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
        if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
        const meses = { ENERO: '01', FEBRERO: '02', MARZO: '03', ABRIL: '04', MAYO: '05', JUNIO: '06', JULIO: '07', AGOSTO: '08', SEPTIEMBRE: '09', SETIEMBRE: '09', OCTUBRE: '10', NOVIEMBRE: '11', DICIEMBRE: '12' };
        const sn = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
        m = sn.match(/\b(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(20\d{2})\b/);
        if (m) return `${m[3]}-${meses[m[2]]}-${pad(m[1])}`;
        return '';
    }

    /** Modelo 1: Factura Electrónica INDURA S.A. (RUT 76.150.343-K, RG_RENTAL por tramos). */
    function parsearIndura(raw) {
        const mFolio = raw.match(/FACTURA\s+ELECTR[OÓ]NICA[\s\S]{0,40}?N[°º.:]?\s*(\d{4,12})/i) || raw.match(/N[°º]\s*(\d{6,10})/);
        const folio = mFolio ? mFolio[1].replace(/^0+(?=\d)/, '') : '';
        const mEmis = raw.match(/Fecha\s+de\s+Emisi[oó]n[\s\n:|-]*([0-9./-]{8,10})/i);
        const mVenc = raw.match(/Fecha\s+(?:de\s+)?Vencimiento[\s\n:|-]*([0-9./-]{8,10})/i);
        const fechaEmision = mEmis ? fechaAISO(mEmis[1]) : '';
        const fechaVencimiento = mVenc ? fechaAISO(mVenc[1]) : '';
        const mOC = raw.match(/O\.?\s*de\s*Compra\s*N[o°º.:]*\s*([A-Z0-9-]{6,25})/i) || raw.match(/\b(\d{5,8}-\d{1,5}-[A-Z]{2}\d{1,2})\b/i);
        const numeroOC = mOC ? mOC[1].replace(/\s+/g, '').toUpperCase() : '';
        const mSap = raw.match(/Factura\s+SAP[\s\n:]*(\d{5,15})/i);
        const facturaSAP = mSap ? mSap[1].trim() : '';
        const mReemp = raw.match(/Reemplaza\s+Factura\s*[:#]?\s*(\d{4,12})/i);
        const reemplazaFactura = mReemp ? mReemp[1].replace(/^0+(?=\d)/, '') : '';
        const mPer = raw.match(/Servicios\s+de\s+Arriendo\s+Per[ií]odo\s*[:#]?\s*([A-Za-zÁÉÍÓÚáéíóú]+\s+20\d{2})/i);
        const periodoServicio = detectarPeriodoServicio(mPer ? mPer[1] : raw, fechaEmision);

        const montoPor = (re) => { const m = raw.match(re); return m ? Math.round(num(m[1])) : 0; };
        const neto = montoPor(/SUBTOTAL\s*[:$]?\s*\$?\s*([\d.,]{3,15})/i);
        const iva = montoPor(/IVA\s*19(?:[.,]00)?\s*%?\s*[:$]?\s*\$?\s*([\d.,]{3,15})/i);
        const totalBruto = montoPor(/(?:^|\n)\s*TOTAL\s*[:$]?\s*\$?\s*([\d.,]{3,15})/im) || (neto + iva);

        // Extraer bloques RG_RENTAL y sus sublíneas ("Arriendo Entre 2 y 4 meses", "Arriendo Más de 4 meses", etc.)
        const items = [];
        const bloquesRC = [];
        const normTituloIndura = (t) => String(t || '')
            .replace(/RG[_ -]?RENTAL/i, 'RG_RENTAL')
            .replace(/MEDICAL_?\s*(?:=>|⇒|->|>=|=)\s*200[B8]/i, 'MEDICAL_=>200B')
            .replace(/CILINDRO_?\s*<\s*200[B8]/i, 'CILINDRO_<200B')
            .replace(/\s+\d+\s+d[ií]as[\s\S]*$/i, '')
            .replace(/\s+/g, ' ')
            .trim();
        const idxIni = raw.search(/Valor\s+Total/i);
        const desdeIni = idxIni >= 0 ? raw.slice(idxIni + 11) : raw;
        const idxFin = desdeIni.search(/(?:^|\n)\s*(?:Nombre\s*:|Firma\s*:|SUBTOTAL|El\s+acuse\s+de\s+recibo)/im);
        const zonaDet = idxFin >= 0 ? desdeIni.slice(0, idxFin) : desdeIni;

        const reGrupo = /(?:^|\n)\s*(?:(\d{3,8})\s+)?(RG[_ -]?RENTAL[^\n]+)/gi;
        const posGrupos = [];
        let mg;
        while ((mg = reGrupo.exec(zonaDet)) !== null) {
            const tituloLimpio = normTituloIndura(mg[2]);
            let cod = (mg[1] || '').trim();
            if (!cod) {
                const antes = zonaDet.slice(Math.max(0, mg.index - 24), mg.index).match(/\b(\d{4,6})\b\s*$/);
                if (antes) cod = antes[1];
                else if (/MEDICAL_=>200B/i.test(tituloLimpio)) cod = '1519';
                else if (/CILINDRO_<200B/i.test(tituloLimpio)) cod = '112596';
            }
            posGrupos.push({ codigo: cod, titulo: tituloLimpio, idx: mg.index, finCab: mg.index + mg[0].length });
        }

        const extraerTripleLinea = (linea) => {
            const limpia = String(linea || '').replace(/1\s*\/\s*d[ií]a/gi, ' ').replace(/\bd[ií]as?\b/gi, ' ').replace(/[|¦$]/g, ' ');
            const ns = (limpia.match(/\d{1,3}(?:\.\d{3})+|\d+/g) || []).map(x => Math.round(num(x))).filter(x => x > 0);
            if (ns.length >= 3) {
                for (let i = 0; i + 2 < ns.length; i++) {
                    const c = ns[i], vu = ns[i + 1], vt = ns[i + 2];
                    if (Math.abs(c * vu - vt) <= Math.max(5, vt * 0.02)) return { c, vu, vt };
                }
                return { c: ns[0], vu: ns[1], vt: ns[2] };
            }
            if (ns.length === 2) {
                const vu = ns[0], vt = ns[1];
                if (vu >= 100 && vt >= vu) {
                    const cInf = Math.round(vt / vu);
                    if (cInf > 0 && Math.abs(cInf * vu - vt) <= Math.max(5, vu * 0.05)) return { c: cInf, vu, vt };
                }
            }
            return null;
        };

        posGrupos.forEach((g, idx) => {
            const seg = zonaDet.slice(g.finCab, idx + 1 < posGrupos.length ? posGrupos[idx + 1].idx : zonaDet.length);
            const sublineas = [];
            const triplesFila = [];
            const reSub = /(Arriendo\s+(?:Entre\s+\d+\s+y\s+\d+\s+meses|M[aá]s\s+de\s+\d+\s+meses|Menos\s+de\s+\d+\s+meses))([^\n]*)/gi;
            let ms;
            while ((ms = reSub.exec(seg)) !== null) {
                sublineas.push(ms[1].replace(/\s+/g, ' ').trim());
                triplesFila.push(extraerTripleLinea(ms[2]));
            }
            const k = sublineas.length;
            bloquesRC.push({ titulo: g.titulo, sublineas: sublineas.slice() });

            if (k > 0) {
                if (triplesFila.some(Boolean)) {
                    for (let j = 0; j < k; j++) {
                        const tr = triplesFila[j];
                        items.push({ codigo: g.codigo, grupo: g.titulo, sublinea: sublineas[j], descripcion: `${g.titulo} — ${sublineas[j]}`, cantidad: tr ? tr.c : 1, unidad: 'dias', valorUnitario: tr ? tr.vu : 0, valorTotal: tr ? tr.vt : 0 });
                    }
                } else {
                    const sinTextos = seg.replace(/Arriendo\s+(?:Entre\s+\d+\s+y\s+\d+\s+meses|M[aá]s\s+de\s+\d+\s+meses|Menos\s+de\s+\d+\s+meses)/gi, ' ').replace(/1\s*\/\s*d[ií]a/gi, ' ').replace(/\bd[ií]as?\b/gi, ' ');
                    const nums = (sinTextos.match(/\d{1,3}(?:\.\d{3})+|\d+/g) || []).map(x => Math.round(num(x))).filter(x => x > 0);
                    if (nums.length >= k * 3) {
                        const esColAgrupada = k > 1 && nums.slice(0, k).every((c, j) => {
                            const vu = nums[k + j], tot = nums[2 * k + j];
                            return Math.abs(c * vu - tot) <= Math.max(5, tot * 0.02);
                        });
                        for (let j = 0; j < k; j++) {
                            const cant = esColAgrupada ? nums[j] : nums[j * 3];
                            const vu = esColAgrupada ? nums[k + j] : nums[j * 3 + 1];
                            const vt = esColAgrupada ? nums[2 * k + j] : nums[j * 3 + 2];
                            items.push({ codigo: g.codigo, grupo: g.titulo, sublinea: sublineas[j], descripcion: `${g.titulo} — ${sublineas[j]}`, cantidad: cant || 1, unidad: 'dias', valorUnitario: vu || 0, valorTotal: vt || 0 });
                        }
                    } else {
                        sublineas.forEach(sl => items.push({ codigo: g.codigo, grupo: g.titulo, sublinea: sl, descripcion: `${g.titulo} — ${sl}`, cantidad: 1, unidad: 'dias', valorUnitario: 0, valorTotal: 0 }));
                    }
                }
            }
        });

        if (!items.length && (neto || totalBruto)) {
            items.push({ codigo: 'RENTA', descripcion: 'Arriendo cilindros oxígeno medicinal Indura', cantidad: 1, unidad: 'GL', valorUnitario: neto || totalBruto, valorTotal: neto || totalBruto });
        }

        return {
            origenLectura: 'MODELO_INDURA',
            tipoDocumento: 'FACTURA',
            razonSocial: 'Indura S.A.',
            rutEmisor: '76.150.343-K',
            contactoEmail: 'pagoscl@airproducts.com',
            cuentaBancaria: 'Banco Santander · Cta. Cte. 001525144147',
            folio,
            fechaEmision,
            fechaVencimiento,
            numeroOC,
            facturaSAP,
            reemplazaFactura,
            periodoServicio,
            tipoServicio: 'ARRIENDO',
            items,
            bloquesRC,
            neto,
            iva,
            totalBruto
        };
    }

    /** Modelo 2: Factura Electrónica COMERCIAL VR LIMITADA (RUT 76.866.699-7, arriendo mensual cilindros 9m3 / 10m3). */
    function parsearComercialVR(raw) {
        const mFolio = raw.match(/Folio\s*N[°º.:]?\s*(\d{2,12})/i);
        const folio = mFolio ? mFolio[1].replace(/^0+(?=\d)/, '') : '';
        const mEmis = raw.match(/Fecha\s+Documento\s*[:|-]?\s*([0-9./-]{8,10})/i);
        const mVenc = raw.match(/Fecha\s+de\s+Vencimiento\s*[:|-]?\s*([0-9./-]{8,10})/i);
        const fechaEmision = mEmis ? fechaAISO(mEmis[1]) : '';
        const fechaVencimiento = mVenc ? fechaAISO(mVenc[1]) : '';
        const mOC = raw.match(/801\s*[-–]?\s*Orden\s+de\s+Compra\s+([A-Z0-9-]{6,25})/i) || raw.match(/\b(\d{5,8}-\d{1,5}-[A-Z]{2}\d{1,2})\b/i);
        const numeroOC = mOC ? mOC[1].replace(/\s+/g, '').toUpperCase() : '';

        const montoPor = (re) => { const m = raw.match(re); return m ? Math.round(num(m[1])) : 0; };
        const neto = montoPor(/Afecto\s*\$?\s*([\d.,]{3,15})/i) || montoPor(/Neto\s*\$?\s*([\d.,]{3,15})/i);
        const iva = montoPor(/19%\s*IVA\s*\$?\s*([\d.,]{3,15})/i) || montoPor(/IVA\s*19%?\s*\$?\s*([\d.,]{3,15})/i);
        const totalBruto = montoPor(/(?:^|\n)\s*Total\s*\$?\s*([\d.,]{3,15})/im) || (neto + iva);

        // Unir palabras partidas por salto de línea (ej. "MENSU\nAL" -> "MENSUAL")
        const limpio = raw.replace(/MENSU\s*\n\s*AL/gi, 'MENSUAL');
        const items = [];
        const bloquesRC = [];
        const reItem = /(?:^|\n)\s*\d+\s+(VR\d+)\s+([^\n]+?)\s+(\d+)\s+(UN|GL|CL|M3)\s+\$?\s*([\d.,]+)\s+\$?\s*[\d.,]+\s+\$?\s*([\d.,]+)/gi;
        let mi;
        while ((mi = reItem.exec(limpio)) !== null) {
            const desc = mi[2].replace(/\s+/g, ' ').trim();
            const cant = Math.round(num(mi[3])) || 1;
            const uni = mi[4].trim();
            const vu = Math.round(num(mi[5]));
            const vt = Math.round(num(mi[6]));
            items.push({ codigo: mi[1].trim(), descripcion: desc, cantidad: cant, unidad: uni, valorUnitario: vu, valorTotal: vt });
            bloquesRC.push({ titulo: `${desc} (CANTIDAD:${cant})`, sublineas: [] });
        }
        if (!items.length && (neto || totalBruto)) {
            items.push({ codigo: '', descripcion: 'Arriendo mensual de cilindros de gases medicinales', cantidad: 1, unidad: 'GL', valorUnitario: neto || totalBruto, valorTotal: neto || totalBruto });
        }

        return {
            origenLectura: 'MODELO_COMERCIAL_VR',
            tipoDocumento: 'FACTURA',
            razonSocial: 'COMERCIAL VR LIMITADA',
            rutEmisor: '76.866.699-7',
            contactoEmail: 'ventas@comercialvr.cl',
            cuentaBancaria: '',
            folio,
            fechaEmision,
            fechaVencimiento,
            numeroOC,
            facturaSAP: '',
            reemplazaFactura: '',
            periodoServicio: detectarPeriodoServicio(raw, fechaEmision),
            tipoServicio: detectarTipoServicio(raw, items),
            items,
            bloquesRC,
            neto,
            iva,
            totalBruto
        };
    }

    /** Modelo 3: Guía de Despacho / Factura Electrónica WELDING SPA (RUT 77.115.711-4, recarga oxígeno 1m3 + válvulas). */
    function parsearWelding(raw) {
        const esGuia = /(?:GUIA|CUIA|GU[IÍ]A)\s+DE\s+DE[S§]PACHO/i.test(raw);
        const mFolio = raw.match(/(?:GUIA|CUIA|FACTURA)[\s\S]{0,60}?N[°ºeE.:]?\s*(\d{2,10})/i) || raw.match(/\bN[°ºe]\s*(\d{2,10})\b/);
        const folio = mFolio ? mFolio[1].replace(/^0+(?=\d)/, '') : '';
        const mEmis = raw.match(/Fecha\s+Emisi[oó]n\s*[:|-]?\s*([^\n]+)/i);
        const fechaEmision = mEmis ? fechaAISO(mEmis[1]) : '';
        const mOC = raw.match(/Orden\s+(?:de\s+)?Compra[^\d\n]{0,12}(\d{5,8}\s*-\s*\d{1,5}\s*-\s*[A-Za-z]{2}\d{2})/i) || raw.match(/\b(\d{5,8}-\d{1,5}-[A-Za-z]{2}\d{2})\b/);
        let numeroOC = mOC ? mOC[1].replace(/\s+/g, '').toUpperCase() : '';
        // Corrige ruido OCR típico en Welding ("AE26" -> "AG26")
        if (/-\d+-AE\d{2}$/.test(numeroOC)) numeroOC = numeroOC.replace(/-AE(\d{2})$/, '-AG$1');

        const montoPor = (re) => { const m = raw.match(re); return m ? Math.round(num(m[1])) : 0; };
        let neto = montoPor(/MONTO\s+NETO\s*\$?\s*([\d.,]{3,15})/i);
        let iva = montoPor(/I\.?V\.?A\.?\s*19%?\s*\$?\s*([\d.,]{3,15})/i);
        let totalBruto = montoPor(/(?:^|\n)\s*TOTAL\s*\$?\s*([\d.,]{3,15})/im);

        // En escaneos OCR de Welding, los montos pueden venir apilados después de "TOTAL $" (ej. 180.000 / 34.200 / 0 / 214.200)
        if (!neto && !totalBruto) {
            const idxTot = raw.search(/TOTAL\s*\$/i);
            const cola = idxTot >= 0 ? raw.slice(idxTot) : raw;
            const nums = (cola.match(/\b\d{1,3}(?:\.\d{3})+\b/g) || []).map(x => Math.round(num(x)));
            for (let i = 0; i + 2 < nums.length; i++) {
                if (Math.abs((nums[i] + nums[i + 1]) - nums[i + 2]) <= 5) {
                    neto = nums[i]; iva = nums[i + 1]; totalBruto = nums[i + 2]; break;
                }
            }
        }
        if (!totalBruto && (neto || iva)) totalBruto = neto + iva;

        // Extraer línea principal (ej. "12 CL 15.000 180.000") y desglose de válvulas
        const mLinea = raw.match(/(\d{1,4})\s*(CL|UN|M3)\s+([\d.,]{3,10})\s+([\d.,]{3,12})/i);
        const cant = mLinea ? Math.round(num(mLinea[1])) : 1;
        const uni = mLinea ? mLinea[2].toUpperCase() : 'CL';
        const vu = mLinea ? Math.round(num(mLinea[3])) : (neto || totalBruto);
        const vt = mLinea ? Math.round(num(mLinea[4])) : (neto || totalBruto);
        const descBase = /OXIGENO\s*,?\s*1\s*M3/i.test(raw) ? 'OXIGENO 1M3' : 'RECARGA OXIGENO MEDICINAL';

        const sublineas = [];
        const reValv = /(\d+\s+VALVULA[S]?\s+(?:ROSETA|PIN)[^\n]*)/gi;
        let mv;
        while ((mv = reValv.exec(raw)) !== null) {
            const limpia = mv[1].replace(/O,4I!I3|0,4M3/gi, '0.4M3').replace(/\s+/g, ' ').trim();
            if (!sublineas.includes(limpia)) sublineas.push(limpia);
        }

        const items = [{ codigo: '', descripcion: descBase, cantidad: cant, unidad: uni, valorUnitario: vu, valorTotal: vt }];
        const bloquesRC = [{ titulo: `${descBase} (CANTIDAD:${cant})`, sublineas }];

        return {
            origenLectura: 'MODELO_WELDING',
            tipoDocumento: esGuia ? 'GUIA_DESPACHO' : 'FACTURA',
            razonSocial: 'WELDING SPA',
            rutEmisor: '77.115.711-4',
            contactoEmail: '0cristian.valenzuela0@gmail.com',
            cuentaBancaria: '',
            folio,
            fechaEmision,
            fechaVencimiento: '',
            numeroOC,
            facturaSAP: '',
            reemplazaFactura: '',
            periodoServicio: detectarPeriodoServicio(raw, fechaEmision),
            tipoServicio: 'RECARGA',
            items,
            bloquesRC,
            neto,
            iva,
            totalBruto
        };
    }

    /** Parser heurístico de texto OCR / PDF texto con modelos dedicados para Indura, Comercial VR y Welding SpA. */
    function parsearTextoFacturaOcr(texto) {
        const raw = String(texto || '').replace(/\r\n/g, '\n');

        // 1) Modelos locales dedicados para los 3 proveedores reales de oxígeno
        if (/INDURA|76\.?150\.?343-?K|RG_RENTAL/i.test(raw)) return parsearIndura(raw);
        if (/COMERCIAL\s+VR|76\.?866\.?699-?7|\bVR00\d{3,}/i.test(raw)) return parsearComercialVR(raw);
        if (/WELDING|77\.?115\.?711-?4|LAS\s+FRUTILLAS\s+244/i.test(raw)) return parsearWelding(raw);

        // 2) Parser genérico de respaldo
        const esGuia = /(?:GU[IÍ]A|CUIA)\s+DE\s+DE[S§]PACHO/i.test(raw);
        const mRut = raw.match(/R\.?U\.?T\.?\s*[:#-]?\s*(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])/i) || raw.match(/\b(\d{2}\.\d{3}\.\d{3}-[\dkK])\b/);
        const rutEmisor = mRut ? fmtRut(mRut[1]) : '';

        let razonSocial = '';
        if (/LINDE/i.test(raw)) razonSocial = 'LINDE GAS CHILE S.A.';
        else if (/AIR\s*LIQUIDE/i.test(raw)) razonSocial = 'AIR LIQUIDE CHILE S.A.';
        else if (/MESSER/i.test(raw)) razonSocial = 'MESSER CHILE S.A.';
        else {
            const l0 = raw.split('\n').map(l => l.trim()).find(l => l.length > 4 && /(S\.A\.|LTDA|SPA|LIMITADA|GASES|OXIGENO)/i.test(l) && !/R\.?U\.?T|FACTURA|SII/i.test(l));
            if (l0) razonSocial = l0.slice(0, 80);
        }

        const mFolio = raw.match(/(?:FACTURA\s+ELECTR[OÓ]NICA|GU[IÍ]A\s+DE\s+DESPACHO)[\s\S]{0,40}?N[°º.:]?\s*(\d{2,12})/i) || raw.match(/FOLIO\s*(?:N[°º.:]?)?\s*(\d{2,12})/i);
        const folio = mFolio ? mFolio[1].replace(/^0+(?=\d)/, '') : '';

        const mOC = raw.match(/\b(\d{5,8}\s*-\s*\d{1,5}\s*-\s*[A-Z]{2}\d{1,2})\b/i) || raw.match(/(?:ORDEN\s+DE\s+COMPRA|O\.?\s*C\.?)\s*[:#N°º.-]*\s*([A-Z0-9-]{5,25})/i);
        const numeroOC = mOC ? mOC[1].replace(/\s+/g, '').toUpperCase() : '';

        const mSap = raw.match(/(?:FACTURA\s*SAP|DOC\.?\s*SAP|SAP\s*N[°º.:]?)[\s\n:#-]*([A-Z0-9-]{4,20})/i);
        const facturaSAP = mSap ? mSap[1].trim() : '';

        const mReemp = raw.match(/(?:REEMPLAZA|ANULA|REFACTURA)\s*(?:A\s*)?(?:FACT(?:URA)?\.?\s*(?:N[°º.:]?\s*)?)?(\d{4,12})/i);
        const reemplazaFactura = mReemp ? mReemp[1].replace(/^0+(?=\d)/, '') : '';

        const mEmis = raw.match(/FECHA\s*(?:DE\s*)?(?:EMISI[OÓ]N|DOCUMENTO)[\s\n:|-]*([^\n]{8,30})/i);
        const mVenc = raw.match(/FECHA\s*(?:DE\s*)?VENC(?:IMIENTO)?[\s\n:|-]*([0-9./-]{8,10})/i);
        const fechaEmision = mEmis ? fechaAISO(mEmis[1]) : '';
        const fechaVencimiento = mVenc ? fechaAISO(mVenc[1]) : '';

        const montoPor = (re) => {
            const m = raw.match(re);
            return m ? Math.round(num(m[1])) : 0;
        };
        const neto = montoPor(/(?:MONTO\s+NETO|VALOR\s+NETO|SUBTOTAL|AFECTO|\bNETO\b)\s*[:$]?\s*\$?\s*([\d.,]{3,15})/i);
        const iva = montoPor(/(?:19%\s*I\.?V\.?A\.?|I\.?V\.?A\.?\s*(?:19(?:[.,]00)?\s*%?)?)\s*[:$]?\s*\$?\s*([\d.,]{3,15})/i);
        const totalBruto = montoPor(/(?:MONTO\s+TOTAL|TOTAL\s+BRUTO|TOTAL\s+A\s+PAGAR|(?:^|\n)\s*TOTAL)\s*[:$]?\s*\$?\s*([\d.,]{3,15})/im) || (neto + iva);

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
            tipoDocumento: esGuia ? 'GUIA_DESPACHO' : 'FACTURA',
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
            bloquesRC: [],
            neto,
            iva,
            totalBruto
        };
    }

    /** Construye los bloques con viñetas y sublíneas para replicar el detalle de la factura/guía en la Recepción Conforme oficial. */
    function construirBloquesRC(factura) {
        if (Array.isArray(factura.bloquesRC) && factura.bloquesRC.length) return factura.bloquesRC;
        const items = Array.isArray(factura.items) ? factura.items : [];
        if (!items.length) return [];
        const grupos = new Map();
        const sueltos = [];
        items.forEach((it) => {
            if (it.grupo) {
                if (!grupos.has(it.grupo)) grupos.set(it.grupo, []);
                if (it.sublinea) grupos.get(it.grupo).push(it.sublinea);
            } else {
                const cantTxt = num(it.cantidad) > 0 ? ` (CANTIDAD:${num(it.cantidad).toLocaleString('es-CL')})` : '';
                sueltos.push({ titulo: `${String(it.descripcion || '').trim()}${cantTxt}`, sublineas: [] });
            }
        });
        const out = [];
        grupos.forEach((subs, tit) => out.push({ titulo: tit, sublineas: subs }));
        return out.concat(sueltos);
    }

    /** Convierte bloques RC <-> texto editable en el modal ("• Título" y líneas sangradas "  Sublínea"). */
    function bloquesRCTexto(bloques) {
        return (bloques || []).map((b) => {
            const subs = (b.sublineas || []).map(s => `  ${s}`).join('\n');
            return `• ${b.titulo}${subs ? '\n' + subs : ''}`;
        }).join('\n');
    }
    function parsearTextoBloquesRC(texto) {
        const out = [];
        let cur = null;
        String(texto || '').split(/\r?\n/).forEach((linea) => {
            if (!linea.trim()) return;
            if (/^\s{2,}/.test(linea) && cur) {
                cur.sublineas.push(linea.trim().replace(/^[-•*]\s*/, ''));
            } else {
                cur = { titulo: linea.trim().replace(/^[•*-]\s*/, ''), sublineas: [] };
                out.push(cur);
            }
        });
        return out;
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
        const bloquesInduraBase = [
            { titulo: 'RG_RENTAL CILINDRO MEDICAL_=>200B', sublineas: ['Arriendo Entre 2 y 4 meses', 'Arriendo Más de 4 meses'] },
            { titulo: 'RG_RENTAL CILINDRO_<200B', sublineas: ['Arriendo Entre 2 y 4 meses', 'Arriendo Más de 4 meses'] }
        ];
        const facturas = [
            {
                ...baseFact,
                id: 'fact-indura-2074903',
                folio: '2074903',
                reemplazaFactura: '2051884',
                periodoServicio: '2026-07',
                fechaEmision: '2026-07-31',
                fechaVencimiento: '2026-08-30',
                items: [{ codigo: '1519', grupo: 'RG_RENTAL CILINDRO MEDICAL_=>200B', sublinea: 'Arriendo Entre 2 y 4 meses', descripcion: 'RG_RENTAL CILINDRO MEDICAL_=>200B — Arriendo cilindros (620 días-cilindro)', cantidad: 620, unidad: 'dias', valorUnitario: 517, valorTotal: 320540 }],
                bloquesRC: bloquesInduraBase,
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
                items: [{ codigo: '1519', grupo: 'RG_RENTAL CILINDRO MEDICAL_=>200B', sublinea: 'Arriendo Entre 2 y 4 meses', descripcion: 'RG_RENTAL CILINDRO MEDICAL_=>200B — Arriendo cilindros (620 días-cilindro)', cantidad: 620, unidad: 'dias', valorUnitario: 517, valorTotal: 320540 }],
                bloquesRC: bloquesInduraBase,
                neto: 320540,
                iva: 60903,
                totalBruto: 381443,
                montoImputadoOC: 381443
            },
            {
                ...baseFact,
                id: 'fact-indura-2074906',
                folio: '2074906',
                facturaSAP: '437137402',
                reemplazaFactura: '2048700',
                periodoServicio: '2026-09',
                fechaEmision: '2026-11-19',
                fechaVencimiento: '2026-12-19',
                items: [
                    { codigo: '1519', grupo: 'RG_RENTAL CILINDRO MEDICAL_=>200B', sublinea: 'Arriendo Entre 2 y 4 meses', descripcion: 'RG_RENTAL CILINDRO MEDICAL_=>200B — Arriendo Entre 2 y 4 meses', cantidad: 151, unidad: 'dias', valorUnitario: 517, valorTotal: 78067 },
                    { codigo: '1519', grupo: 'RG_RENTAL CILINDRO MEDICAL_=>200B', sublinea: 'Arriendo Más de 4 meses', descripcion: 'RG_RENTAL CILINDRO MEDICAL_=>200B — Arriendo Más de 4 meses', cantidad: 141, unidad: 'dias', valorUnitario: 517, valorTotal: 72897 },
                    { codigo: '112596', grupo: 'RG_RENTAL CILINDRO_<200B', sublinea: 'Arriendo Entre 2 y 4 meses', descripcion: 'RG_RENTAL CILINDRO_<200B — Arriendo Entre 2 y 4 meses', cantidad: 90, unidad: 'dias', valorUnitario: 517, valorTotal: 46530 },
                    { codigo: '112596', grupo: 'RG_RENTAL CILINDRO_<200B', sublinea: 'Arriendo Más de 4 meses', descripcion: 'RG_RENTAL CILINDRO_<200B — Arriendo Más de 4 meses', cantidad: 31, unidad: 'dias', valorUnitario: 517, valorTotal: 16027 }
                ],
                bloquesRC: bloquesInduraBase,
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
    let filtroRC = 'TODOS';         // 'TODOS' | 'CON_RC' | 'SIN_RC'
    let buscador = '';
    let contenedorActivo = null;

    /** Arma el objeto de registro inmutable para Historial_Movimientos (Informe Contable). */
    function construirEventoContable(tipo, documento, titulo, observacion, extra) {
        return {
            type: tipo,
            insumoName: String(titulo || '').trim(),
            quantity: num(extra && extra.monto),
            document: String(documento || '').trim(),
            actaId: String((extra && extra.correlativo) || documento || '').trim(),
            batch: 'OXIGENO',
            origin: String((extra && extra.proveedor) || 'OXIGENO').trim(),
            dest: String((extra && extra.numeroOC) || '').trim(),
            user: usuario(),
            observacion: String(observacion || '').trim(),
            modulo: 'OXIGENO_FACTURACION',
            ...(extra || {})
        };
    }

    async function registrarEventoContable(tipo, documento, titulo, observacion, extra) {
        const f = fs(), d = db();
        if (!f || !d) return;
        try {
            await f.setDoc(f.doc(f.collection(d, 'Historial_Movimientos')), {
                ...construirEventoContable(tipo, documento, titulo, observacion, extra),
                date: f.serverTimestamp()
            });
        } catch (e) {
            console.warn('[OxiFact] No se pudo registrar evento contable:', e);
        }
    }

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
        const esEdicion = !!datos.id;
        const prev = esEdicion ? proveedores.find(p => p.id === datos.id) : null;
        const id = datos.id || ('prov-' + slug(`${datos.razonSocial}-${normRut(rutLimpio)}`));
        const ref = f.doc(f.collection(d, 'oxigeno_proveedores'), id);
        const nuevo = {
            id,
            razonSocial: String(datos.razonSocial).trim(),
            rut: rutLimpio,
            estado: datos.estado === 'HISTORICO' ? 'HISTORICO' : 'ACTIVO',
            contactoEmail: String(datos.contactoEmail || '').trim(),
            cuentaBancaria: String(datos.cuentaBancaria || '').trim(),
            actualizadoEl: f.serverTimestamp(),
            creadoEl: datos.creadoEl || f.serverTimestamp()
        };
        await f.setDoc(ref, nuevo, { merge: true });
        const cambios = prev ? [
            prev.razonSocial !== nuevo.razonSocial ? `Razón social: ${prev.razonSocial} → ${nuevo.razonSocial}` : '',
            prev.rut !== nuevo.rut ? `RUT: ${prev.rut} → ${nuevo.rut}` : '',
            prev.estado !== nuevo.estado ? `Estado: ${prev.estado} → ${nuevo.estado}` : '',
            (prev.contactoEmail || '') !== nuevo.contactoEmail ? `Email: ${prev.contactoEmail || '—'} → ${nuevo.contactoEmail || '—'}` : '',
            (prev.cuentaBancaria || '') !== nuevo.cuentaBancaria ? `Cuenta: ${prev.cuentaBancaria || '—'} → ${nuevo.cuentaBancaria || '—'}` : ''
        ].filter(Boolean).join('; ') : '';
        await registrarEventoContable(
            'OXIGENO_PROVEEDOR',
            nuevo.rut,
            `PROVEEDOR OXÍGENO · ${nuevo.razonSocial}`,
            esEdicion ? `Proveedor editado (${nuevo.rut}): ${cambios || 'datos actualizados'}.` : `Proveedor creado: ${nuevo.razonSocial} (${nuevo.rut}, ${nuevo.estado}).`,
            { proveedor: nuevo.razonSocial, accion: esEdicion ? 'EDICION' : 'ALTA' }
        );
        return id;
    }

    async function guardarPresupuesto(datos) {
        const f = fs(), d = db();
        if (!datos.proveedorId) throw new Error('Selecciona el proveedor del contrato/OC.');
        const numeroOC = String(datos.numeroOC || '').trim().toUpperCase();
        if (!numeroOC) throw new Error('Ingresa el N° de Orden de Compra.');
        const montoTope = Math.round(num(datos.montoTope));
        if (montoTope <= 0) throw new Error('El monto tope debe ser mayor a $0.');
        const esEdicion = !!datos.id;
        const prev = esEdicion ? presupuestos.find(b => b.id === datos.id) : null;
        const pv = proveedores.find(p => p.id === datos.proveedorId);
        const id = datos.id || ('pres-' + slug(numeroOC));
        const ref = f.doc(f.collection(d, 'oxigeno_presupuestos'), id);
        const nuevo = {
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
        };
        await f.setDoc(ref, nuevo, { merge: true });
        const cambios = prev ? [
            prev.numeroOC !== nuevo.numeroOC ? `OC: ${prev.numeroOC} → ${nuevo.numeroOC}` : '',
            Math.round(num(prev.montoTope)) !== nuevo.montoTope ? `Tope: ${clp(prev.montoTope)} → ${clp(nuevo.montoTope)}` : '',
            prev.tipoMonto !== nuevo.tipoMonto ? `Tipo monto: ${prev.tipoMonto} → ${nuevo.tipoMonto}` : '',
            prev.conceptoPermitido !== nuevo.conceptoPermitido ? `Concepto: ${prev.conceptoPermitido} → ${nuevo.conceptoPermitido}` : '',
            prev.estado !== nuevo.estado ? `Estado: ${prev.estado} → ${nuevo.estado}` : '',
            (prev.nombreContrato || '') !== nuevo.nombreContrato ? `Contrato: ${prev.nombreContrato || '—'} → ${nuevo.nombreContrato}` : ''
        ].filter(Boolean).join('; ') : '';
        await registrarEventoContable(
            'OXIGENO_PRESUPUESTO',
            nuevo.numeroOC,
            `PRESUPUESTO OXÍGENO · OC ${nuevo.numeroOC}`,
            esEdicion ? `Presupuesto editado (${nuevo.numeroOC}): ${cambios || 'datos actualizados'}.` : `Presupuesto creado: OC ${nuevo.numeroOC} · ${nuevo.conceptoPermitido} · Tope ${clp(nuevo.montoTope)} (${nuevo.tipoMonto}).`,
            { proveedor: pv ? pv.razonSocial : '', numeroOC: nuevo.numeroOC, monto: nuevo.montoTope, accion: esEdicion ? 'EDICION' : 'ALTA' }
        );
        return id;
    }

    /** Valida si un proveedor puede eliminarse (bloquea si tiene presupuestos/OC o facturas vinculadas). */
    function validarEliminacionProveedor(provId, listaPres, listaFact) {
        const nPres = (listaPres || []).filter(p => p && p.proveedorId === provId).length;
        const nFact = (listaFact || []).filter(f => f && f.proveedorId === provId).length;
        if (nPres > 0 || nFact > 0) {
            return {
                ok: false,
                nPres,
                nFact,
                mensaje: `No se puede eliminar este proveedor porque tiene ${nPres} presupuesto(s)/OC y ${nFact} documento(s) asociados. Márcalo como «Histórico» o elimina primero sus registros.`
            };
        }
        return { ok: true, nPres: 0, nFact: 0, mensaje: '' };
    }

    async function eliminarProveedor(id) {
        const f = fs(), d = db();
        const check = validarEliminacionProveedor(id, presupuestos, facturas);
        if (!check.ok) throw new Error(check.mensaje);
        const pv = proveedores.find(p => p.id === id);
        await f.deleteDoc(f.doc(f.collection(d, 'oxigeno_proveedores'), id));
        await registrarEventoContable('OXIGENO_PROVEEDOR', pv ? pv.rut : id, `PROVEEDOR OXÍGENO · ${pv ? pv.razonSocial : id}`, `Proveedor eliminado: ${pv ? pv.razonSocial + ' (' + pv.rut + ')' : id}.`, { proveedor: pv ? pv.razonSocial : '', accion: 'ELIMINACION' });
    }

    async function eliminarPresupuesto(id) {
        const f = fs(), d = db();
        const nFact = facturas.filter(x => x.presupuestoId === id).length;
        if (nFact > 0) throw new Error(`No se puede eliminar esta OC/presupuesto porque tiene ${nFact} documento(s) asociados. Cámbiala a estado «Cerrado».`);
        const b = presupuestos.find(x => x.id === id);
        await f.deleteDoc(f.doc(f.collection(d, 'oxigeno_presupuestos'), id));
        await registrarEventoContable('OXIGENO_PRESUPUESTO', b ? b.numeroOC : id, `PRESUPUESTO OXÍGENO · OC ${b ? b.numeroOC : id}`, `Presupuesto/OC eliminado: ${b ? b.numeroOC + ' (' + clp(b.montoTope) + ')' : id}.`, { numeroOC: b ? b.numeroOC : '', monto: b ? b.montoTope : 0, accion: 'ELIMINACION' });
    }

    async function eliminarFactura(id) {
        const f = fs(), d = db();
        const fac = facturas.find(x => x.id === id);
        const pv = fac ? proveedores.find(p => p.id === fac.proveedorId) : null;
        await f.deleteDoc(f.doc(f.collection(d, 'oxigeno_facturas'), id));
        await registrarEventoContable('OXIGENO_FACTURA', fac ? fac.folio : id, `OXÍGENO · ${fac && fac.tipoDocumento === 'GUIA_DESPACHO' ? 'GUÍA' : 'FACTURA'} ${fac ? fac.folio : id}`, `Documento eliminado: Folio ${fac ? fac.folio : id}${fac && fac.recepcionConforme && fac.recepcionConforme.numeroActa ? ' · Acta ' + fac.recepcionConforme.numeroActa : ''} (${fac ? clp(fac.totalBruto) : ''}).`, { proveedor: pv ? pv.razonSocial : '', numeroOC: fac ? fac.numeroOC : '', monto: fac ? fac.totalBruto : 0, accion: 'ELIMINACION' });
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
                tipoDocumento: datos.tipoDocumento === 'GUIA_DESPACHO' ? 'GUIA_DESPACHO' : 'FACTURA',
                folio: String(datos.folio).trim(),
                facturaSAP: String(datos.facturaSAP || '').trim(),
                reemplazaFactura: folioReemp,
                tipoServicio: ['ARRIENDO', 'RECARGA', 'MIXTO'].includes(datos.tipoServicio) ? datos.tipoServicio : 'ARRIENDO',
                periodoServicio: String(datos.periodoServicio || '').trim(),
                fechaEmision: String(datos.fechaEmision || ''),
                fechaVencimiento: String(datos.fechaVencimiento || ''),
                items: Array.isArray(datos.items) ? datos.items : [],
                bloquesRC: Array.isArray(datos.bloquesRC) ? datos.bloquesRC : [],
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
                recepcionConforme: datos.recepcionConforme || { emitida: false, tipoRecepcion: 'PARCIAL', fecha: '', contraparte: CONTRAPARTE_BASE, conFirma: true, encabezado: '', bloquesRC: [], receptorNombre: '', receptorRut: '', receptorCargo: '', recinto: RECINTO_BASE, observaciones: '', numeroActa: '' },
                creadoPor: usuario(),
                creadoEl: f.serverTimestamp()
            };

            tx.set(factRef, registro);
            tx.set(f.doc(f.collection(d, 'Historial_Movimientos')), {
                ...construirEventoContable(
                    'OXIGENO_FACTURA',
                    registro.folio,
                    `OXÍGENO · ${registro.tipoDocumento === 'GUIA_DESPACHO' ? 'GUÍA' : 'FACTURA'} ${registro.folio}`,
                    `Ingreso ${registro.tipoDocumento === 'GUIA_DESPACHO' ? 'guía' : 'factura'} ${registro.folio} (${prov ? prov.razonSocial : ''}) · OC ${registro.numeroOC || 'S/OC'} · ${registro.tipoServicio} · Total ${clp(registro.totalBruto)} (OC ${clp(registro.montoImputadoOC)} / CC ${clp(registro.montoCajaChica)})${folioReemp ? ' · reemplaza ' + folioReemp : ''}.`,
                    { proveedor: prov ? prov.razonSocial : '', numeroOC: registro.numeroOC, monto: registro.totalBruto, accion: 'ALTA' }
                ),
                date: f.serverTimestamp()
            });
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

    /** Registra la Recepción Conforme (Parcial o Total, formato Corporación + Ley 19.983) asignando correlativo RCO-AAAA-NNNNN. */
    async function registrarRecepcionConforme(facturaId, datosRC) {
        const f = fs(), d = db();
        const contraparte = String(datosRC.contraparte || datosRC.receptorNombre || CONTRAPARTE_BASE).trim();
        if (!contraparte) throw new Error('Ingresa el nombre de la contraparte técnica o receptor.');
        if (!String(datosRC.fecha || '').trim()) throw new Error('Indica la fecha de recepción conforme.');
        const bloques = Array.isArray(datosRC.bloquesRC) ? datosRC.bloquesRC : parsearTextoBloquesRC(datosRC.detalleTexto || '');
        if (!bloques.length) throw new Error('El detalle de lo recibido no puede quedar vacío.');

        const anio = new Date().getFullYear();
        const ctrRef = f.doc(f.collection(d, 'Contadores'), `ctr-rco-${anio}`);
        const factRef = f.doc(f.collection(d, 'oxigeno_facturas'), facturaId);

        return f.runTransaction(d, async (tx) => {
            const [fSnap, cSnap] = await Promise.all([tx.get(factRef), tx.get(ctrRef)]);
            if (!fSnap.exists()) throw new Error('El documento ya no existe.');
            const actual = fSnap.data();
            const rcPrev = actual.recepcionConforme || {};
            let numeroActa = rcPrev.numeroActa || '';
            if (!numeroActa) {
                const ultimo = (cSnap.exists() ? Number(cSnap.data().ultimo) || 0 : 0) + 1;
                numeroActa = `RCO-${anio}-${pad(ultimo, 5)}`;
                tx.set(ctrRef, { ultimo, tipo: 'RCO', anio, updatedAt: f.serverTimestamp() }, { merge: true });
            }
            const parcial = datosRC.tipoRecepcion !== 'TOTAL';
            const rc = {
                emitida: true,
                tipoRecepcion: parcial ? 'PARCIAL' : 'TOTAL',
                fecha: String(datosRC.fecha).slice(0, 10),
                tipoDocumento: datosRC.tipoDocumento || actual.tipoDocumento || 'FACTURA',
                numeroDoc: String(datosRC.numeroDoc != null ? datosRC.numeroDoc : (actual.folio || '')).trim(),
                contraparte,
                conFirma: datosRC.conFirma !== false,
                encabezado: String(datosRC.encabezado || '').trim() || encabezadoRCBase(parcial),
                bloquesRC: bloques,
                receptorNombre: String(datosRC.receptorNombre || contraparte).trim(),
                receptorRut: datosRC.receptorRut ? fmtRut(datosRC.receptorRut) : '',
                receptorCargo: String(datosRC.receptorCargo || 'Contraparte Técnica').trim(),
                recinto: String(datosRC.recinto || RECINTO_BASE).trim() || RECINTO_BASE,
                observaciones: String(datosRC.observaciones || '').trim(),
                numeroActa,
                registradoPor: rcPrev.registradoPor || usuario(),
                registradoEl: rcPrev.registradoEl || new Date().toISOString(),
                editadoPor: usuario(),
                editadoEn: new Date().toISOString()
            };
            const upd = { recepcionConforme: rc };
            if (datosRC.tipoDocumento) upd.tipoDocumento = datosRC.tipoDocumento === 'GUIA_DESPACHO' ? 'GUIA_DESPACHO' : 'FACTURA';
            tx.update(factRef, upd);
            const pvRC = proveedores.find(p => p.id === actual.proveedorId);
            tx.set(f.doc(f.collection(d, 'Historial_Movimientos')), {
                ...construirEventoContable(
                    'OXIGENO_RC',
                    rc.numeroActa,
                    `ACTA RC OXÍGENO · ${rc.numeroActa}`,
                    `${rcPrev.emitida ? 'Edición' : 'Emisión'} RC ${rc.tipoRecepcion} ${rc.numeroActa} · Fecha ${fechaCL(rc.fecha)} · ${rc.tipoDocumento === 'GUIA_DESPACHO' ? 'Guía' : 'Factura'} ${rc.numeroDoc || actual.folio} · OC ${actual.numeroOC || 'S/OC'} · ${pvRC ? pvRC.razonSocial : ''} · Contraparte: ${rc.contraparte}.`,
                    { correlativo: rc.numeroActa, proveedor: pvRC ? pvRC.razonSocial : '', numeroOC: actual.numeroOC || '', folio: actual.folio || '', monto: actual.totalBruto || 0, accion: rcPrev.emitida ? 'EDICION' : 'EMISION' }
                ),
                date: f.serverTimestamp()
            });
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
                // Reconstruir saltos de línea reales por coordenada Y para leer tablas y totales exactamente
                const filas = [];
                (tc.items || []).forEach((it) => {
                    const str = String(it.str || '').trim();
                    if (!str) return;
                    const y = it.transform ? Math.round(it.transform[5]) : 0;
                    const x = it.transform ? Math.round(it.transform[4]) : 0;
                    let fila = filas.find(f => Math.abs(f.y - y) <= 3);
                    if (!fila) { fila = { y, cols: [] }; filas.push(fila); }
                    fila.cols.push({ x, str });
                });
                filas.sort((a, b) => b.y - a.y);
                textoDigital = filas.map(f => f.cols.sort((a, b) => a.x - b.x).map(c => c.str).join(' ')).join('\n');
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

        // 1) Lectura local instantánea para PDF digitales de Indura, Comercial VR o Welding SpA (sin espera de red)
        if (textoDigital && textoDigital.trim().length > 80) {
            avisar('Leyendo capa de texto digital del PDF…');
            const parsed = parsearTextoFacturaOcr(textoDigital);
            if (parsed.folio && (parsed.totalBruto > 0 || parsed.neto > 0)) {
                return { ...parsed, origenLectura: parsed.origenLectura || 'PDF_TEXTO' };
            }
        }

        // 2) Intentar Cloud Function con Gemini Vision API (para escaneos/fotos)
        try {
            avisar('Consultando lectura multimodal (Gemini Vision)…');
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 15000);
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
    // 4. RECEPCIÓN CONFORME OFICIAL CORPORACIÓN (RC<OC>.pdf) + ACTA LEY 19.983
    // =========================================================================

    let pdfLibPromesa = null;
    function cargarPDFLib() {
        if (window.PDFLib) return Promise.resolve(window.PDFLib);
        if (!pdfLibPromesa) pdfLibPromesa = new Promise((ok, mal) => {
            const s = document.createElement('script');
            s.src = PDFLIB_URL;
            s.onload = () => ok(window.PDFLib);
            s.onerror = () => { pdfLibPromesa = null; mal(new Error('No se pudo cargar pdf-lib.')); };
            document.head.appendChild(s);
        });
        return pdfLibPromesa;
    }
    async function cargarAssetBytes(url) {
        try { const r = await fetch(url); if (!r.ok) return null; return new Uint8Array(await r.arrayBuffer()); } catch (_) { return null; }
    }

    /**
     * Genera el PDF oficial de la Corporación Municipal de Melipilla (idéntico a RC1298355-794-AG25.pdf):
     * Logo CORPO + "RECEPCIÓN CONFORME PRODUCTO O SERVICIO PARCIAL/TOTAL" + Datos Proveedor +
     * cuadro con viñetas/sublíneas replicadas desde la factura/guía + firma y timbre de Contraparte Técnica.
     */
    async function descargarRCOficialCorporacionPDF(factura, proveedor) {
        const PDFLib = await cargarPDFLib();
        const [logoBytes, firmaBytes] = await Promise.all([
            cargarAssetBytes('assets/logo-corpo-melipilla.jpg'),
            cargarAssetBytes('assets/firma-contraparte-mariel.png')
        ]);
        const rc = factura.recepcionConforme || {};
        const parcial = rc.tipoRecepcion !== 'TOTAL';
        const contraparte = rc.contraparte || rc.receptorNombre || CONTRAPARTE_BASE;
        const bloques = (Array.isArray(rc.bloquesRC) && rc.bloquesRC.length) ? rc.bloquesRC : construirBloquesRC(factura);

        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        const doc = await PDFDocument.create();
        const numOC = factura.numeroOC || '';
        doc.setTitle(`Recepción conforme OC ${numOC || factura.folio}`);
        doc.setAuthor('Corporación Municipal de Melipilla');
        doc.setCreator('Visor Logístico SAR');

        const F = await doc.embedFont(StandardFonts.Helvetica);
        const FB = await doc.embedFont(StandardFonts.HelveticaBold);
        let logo = null;
        if (logoBytes) { try { logo = await doc.embedJpg(logoBytes); } catch (_) { try { logo = await doc.embedPng(logoBytes); } catch (_2) { logo = null; } } }
        let firmaImg = null;
        if (firmaBytes && rc.conFirma !== false && /quintanilla/i.test(contraparte)) {
            try { firmaImg = await doc.embedPng(firmaBytes); } catch (_) { firmaImg = null; }
        }

        const W = 612, H = 792, ML = 84, MR = 552, negro = rgb(0, 0, 0);
        const seguro = (font, s) => {
            const set = font.getCharacterSet();
            return Array.from(String(s == null ? '' : s).replace(/³/g, '3').replace(/²/g, '2').replace(/\s+/g, ' ')).map(c => set.includes(c.codePointAt(0)) ? c : ' ').join('');
        };
        let page = doc.addPage([W, H]);
        const T = (s, x, yy, size, bold) => page.drawText(seguro(bold ? FB : F, s), { x, y: H - yy, size, font: bold ? FB : F, color: negro });
        const ancho = (s, size, bold) => (bold ? FB : F).widthOfTextAtSize(seguro(bold ? FB : F, s), size);
        const envolver = (s, size, bold, maxW) => {
            const out = []; let cur = '';
            for (const w of String(s || '').split(' ')) {
                const t = cur ? cur + ' ' + w : w;
                if (ancho(t, size, bold) <= maxW || !cur) cur = t; else { out.push(cur); cur = w; }
            }
            if (cur) out.push(cur);
            return out;
        };
        const centrar = (s, size, bold, yy, x0, x1) => T(s, (x0 + x1 - ancho(s, size, bold)) / 2, yy, size, bold);
        const caja = (x0, x1, yTop, yBot) => {
            const t = 0.8;
            [[x0, yTop, x1, yTop], [x0, yBot, x1, yBot], [x0, yTop, x0, yBot], [x1, yTop, x1, yBot]]
                .forEach(([a, b, c, e]) => page.drawLine({ start: { x: a, y: H - b }, end: { x: c, y: H - e }, thickness: t, color: negro }));
        };

        // Geometría exacta del modelo oficial de Seguimiento de OC (recepcion-conforme.js)
        if (logo) { const h = 66, w = logo.width * h / logo.height; page.drawImage(logo, { x: ML, y: H - 62 - h, width: w, height: h }); }
        const titulo = `RECEPCIÓN CONFORME PRODUCTO O SERVICIO ${parcial ? 'PARCIAL' : 'TOTAL'}`;
        centrar(titulo, 10, true, 100, ML + 90, MR + 20);

        let y = 150;
        T('DATOS DEL PROVEEDOR', 160, y, 10.5, true); y += 24;
        const nomEmp = proveedor ? proveedor.razonSocial : '';
        envolver(`Nombre de la empresa: ${nomEmp}`, 10.5, true, MR - ML + 8).forEach(t => { T(t, ML, y, 10.5, true); y += 15; });
        y += 7;
        T(`RUT: ${proveedor ? proveedor.rut : ''}`, ML, y, 10.5, true); y += 22;
        T(`Orden de Compra: ${numOC}`, ML, y, 10.5, true); y += 22;
        T(`Con fecha ${fechaCL(rc.fecha || hoyISO())}, en calidad de contraparte técnica, certifico lo siguiente:`, ML, y, 10.5, false);
        y += 22;

        const encab = (rc.encabezado && String(rc.encabezado).trim()) || encabezadoRCBase(parcial);
        let top = y, cy = y + 16;
        envolver(encab, 8.5, false, MR - ML - 12).forEach(t => { T(t, ML + 6, cy, 8.5, false); cy += 12; });
        cy += 4;

        bloques.forEach((b) => {
            const tieneSubs = Array.isArray(b.sublineas) && b.sublineas.length > 0;
            const titLineas = envolver(b.titulo, 10.5, tieneSubs, MR - ML - 44);
            const subLineas = (b.sublineas || []).flatMap(sl => envolver(sl, 10.5, false, MR - ML - 48));
            const alto = titLineas.length * 13.5 + subLineas.length * 13.5 + 8;
            if (cy + alto > H - 120) {
                caja(ML, MR, top, cy + 2);
                page = doc.addPage([W, H]);
                top = 60; cy = 76;
                T(`Recepción conforme OC ${numOC} (continuación)`, ML + 6, cy, 8.5, true);
                cy += 16;
            }
            page.drawCircle({ x: ML + 26, y: H - cy + 3, size: 2.2, color: negro });
            titLineas.forEach((t) => { T(t, ML + 40, cy, 10.5, tieneSubs); cy += 13.5; });
            subLineas.forEach((t) => { T(t, ML + 40, cy, 10.5, false); cy += 13.5; });
            cy += 8;
        });

        if (rc.observaciones) {
            envolver(`Observaciones: ${rc.observaciones}`, 8.5, false, MR - ML - 12).forEach(t => { T(t, ML + 6, cy, 8.5, false); cy += 11; });
            cy += 4;
        }
        caja(ML, MR, top, cy + 2);

        let yf = cy + 80;
        if (yf > H - 90) { page = doc.addPage([W, H]); yf = 160; }
        if (firmaImg) {
            const w = 196, h = w * firmaImg.height / firmaImg.width;
            page.drawImage(firmaImg, { x: (W - w) / 2, y: H - yf - 4, width: w, height: h });
        } else {
            page.drawLine({ start: { x: 190, y: H - yf }, end: { x: 420, y: H - yf }, thickness: 0.8, color: negro });
        }
        centrar('Firma contraparte técnica', 10.5, false, yf + 24, 0, W);
        centrar(`Nombre Contraparte Técnica: ${contraparte}`, 10.5, false, yf + 46, 0, W);

        const bytes = await doc.save();
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = document.createElement('a');
        const ocClean = String(numOC || factura.folio || 'Oxigeno').replace(/[^A-Za-z0-9-]+/g, '');
        a.href = url;
        a.download = `RC${ocClean}.pdf`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
    }

    const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    async function cargarLogoPNGWord() {
        try {
            const bytes = await cargarAssetBytes('assets/logo-corpo-melipilla.jpg');
            if (!bytes) return null;
            const url = URL.createObjectURL(new Blob([bytes]));
            try {
                const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; });
                const c = document.createElement('canvas');
                c.width = img.naturalWidth; c.height = img.naturalHeight;
                c.getContext('2d').drawImage(img, 0, 0);
                const blob = await new Promise(r => c.toBlob(r, 'image/png'));
                return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
            } finally {
                URL.revokeObjectURL(url);
            }
        } catch (_) { return null; }
    }

    /** Construye el cuerpo OOXML (Word .docx) exacto al modelo oficial de Seguimiento de OC (recepciones-conformes.js). */
    function construirCuerpoWordRC(factura, proveedor, logo, firma, AD) {
        const { run, par } = AD;
        const rc = factura.recepcionConforme || {};
        const parcial = rc.tipoRecepcion !== 'TOTAL';
        const contraparte = rc.contraparte || rc.receptorNombre || CONTRAPARTE_BASE;
        const bloques = (Array.isArray(rc.bloquesRC) && rc.bloquesRC.length) ? rc.bloquesRC : construirBloquesRC(factura);
        const encabTxt = (rc.encabezado && String(rc.encabezado).trim()) || encabezadoRCBase(parcial);
        const cont = [];

        if (logo) {
            const w = Math.round(1.1 * 914400), h = Math.round(w * logo.h / logo.w);
            cont.push(par(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="1" name="Logo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, { despues: 120 }));
        }
        cont.push(par(run(`RECEPCIÓN CONFORME PRODUCTO O SERVICIO ${parcial ? 'PARCIAL' : 'TOTAL'}`, { b: true, sz: 22 }), { jc: 'center', despues: 360 }));
        cont.push(par(run('DATOS DEL PROVEEDOR', { b: true, sz: 21 }), { jc: 'center', despues: 200 }));
        cont.push(par(run(`Nombre de la empresa: ${proveedor ? proveedor.razonSocial : ''}`, { b: true, sz: 21 }), { despues: 120 }));
        cont.push(par(run(`RUT: ${proveedor ? proveedor.rut : ''}`, { b: true, sz: 21 }), { despues: 120 }));
        cont.push(par(run(`Orden de Compra: ${factura.numeroOC || ''}`, { b: true, sz: 21 }), { despues: 120 }));
        cont.push(par(run(`Con fecha ${fechaCL(rc.fecha || hoyISO())}, en calidad de contraparte técnica, certifico lo siguiente:`, { sz: 21 }), { despues: 160 }));

        const encabP = par(run(encabTxt, { sz: 17 }), { despues: 60 });
        const bloquesP = bloques.map((b) => {
            const tieneSubs = Array.isArray(b.sublineas) && b.sublineas.length > 0;
            const pTit = par(run(`• ${b.titulo}`, { b: tieneSubs, sz: 21 }), { ind: { left: 360, hanging: 240 }, despues: tieneSubs ? 30 : 60 });
            const pSubs = (b.sublineas || []).map((sl, i, arr) => par(run(sl, { sz: 21 }), { ind: { left: 360 }, despues: i === arr.length - 1 ? 60 : 30 })).join('');
            return pTit + pSubs;
        }).join('');
        const obsP = rc.observaciones ? par(run(`Observaciones: ${rc.observaciones}`, { sz: 17 }), { despues: 60 }) : '';
        cont.push(`<w:tbl><w:tblPr><w:tblW w:w="8640" w:type="dxa"/><w:tblBorders>${AD.borde}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="8640"/></w:tblGrid><w:tr>${AD.celda(8640, encabP + bloquesP + obsP)}</w:tr></w:tbl>`);
        cont.push(par('', { antes: 700, despues: 0 }));

        if (firma) {
            const w = Math.round(2.4 * 914400), h = Math.round(w * firma.h / firma.w);
            cont.push(par(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="2" name="Firma y timbre"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="firma.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdFirma"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, { jc: 'center', despues: 0 }));
        } else {
            cont.push(par(run('________________________________', { sz: 21 }), { jc: 'center', despues: 40 }));
        }
        cont.push(par(run('Firma contraparte técnica', { sz: 21 }), { jc: 'center', despues: 120 }));
        cont.push(par(run(`Nombre Contraparte Técnica: ${contraparte}`, { sz: 21 }), { jc: 'center', despues: 0 }));
        return cont;
    }

    /** Descarga el Acta RC Oficial Corporación en Word (.docx) con logo y firma/timbre oficial. */
    async function descargarRCOficialCorporacionWord(factura, proveedor) {
        const AD = window.SAR_ActaDoc;
        if (!AD || !AD.empaquetar) throw new Error('El módulo generador de Word (acta-documentos.js) no está disponible.');
        const rc = factura.recepcionConforme || {};
        const contraparte = rc.contraparte || rc.receptorNombre || CONTRAPARTE_BASE;
        const logo = await cargarLogoPNGWord();
        let firma = null;
        if (rc.conFirma !== false && /quintanilla/i.test(contraparte)) {
            try {
                const b = await cargarAssetBytes('assets/firma-contraparte-mariel.png');
                if (b && b.length > 24) {
                    const w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
                    const h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
                    if (w && h) firma = { bytes: b, w, h };
                }
            } catch (_) { firma = null; }
        }
        const bytes = AD.empaquetar(
            construirCuerpoWordRC(factura, proveedor, logo, firma, AD),
            logo ? logo.bytes : null,
            firma ? [{ id: 'rIdFirma', nombre: 'firma.png', bytes: firma.bytes }] : []
        );
        const ocClean = String(factura.numeroOC || factura.folio || 'Oxigeno').replace(/[^A-Za-z0-9-]+/g, '');
        const nombre = `RC${ocClean}.docx`;
        const url = URL.createObjectURL(new Blob([bytes], { type: MIME_DOCX }));
        const a = document.createElement('a');
        a.href = url; a.download = nombre;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    }

    /** Vista previa HTML exacta del formato oficial Corporación Municipal de Melipilla (idéntica a Seguimiento de OC). */
    function construirHtmlRCOficial(factura, proveedor) {
        const rc = factura.recepcionConforme || {};
        const parcial = rc.tipoRecepcion !== 'TOTAL';
        const contraparte = rc.contraparte || rc.receptorNombre || CONTRAPARTE_BASE;
        const bloques = (Array.isArray(rc.bloquesRC) && rc.bloquesRC.length) ? rc.bloquesRC : construirBloquesRC(factura);
        const encab = (rc.encabezado && String(rc.encabezado).trim()) || encabezadoRCBase(parcial);
        const mostrarFirma = rc.conFirma !== false && /quintanilla/i.test(contraparte);

        return `
        <div class="oxf-acta-hoja" id="oxf-rc-oficial-hoja" style="padding:44px 56px; font-family:Helvetica,Arial,sans-serif; color:#000 !important;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:18px; margin-bottom:22px;">
                <img src="assets/logo-corpo-melipilla.jpg" alt="Corporación Municipal de Melipilla" style="height:72px; width:auto;" onerror="this.style.display='none'">
                <div style="flex:1; text-align:center; font-weight:700; font-size:14px; color:#000;">
                    RECEPCIÓN CONFORME PRODUCTO O SERVICIO ${parcial ? 'PARCIAL' : 'TOTAL'}
                </div>
            </div>
            <div style="font-size:13.5px; line-height:1.9; color:#000; margin-bottom:14px;">
                <div style="font-weight:700; padding-left:92px; margin-bottom:6px;">DATOS DEL PROVEEDOR</div>
                <div style="font-weight:700;">Nombre de la empresa: ${esc(proveedor ? proveedor.razonSocial : '')}</div>
                <div style="font-weight:700;">RUT: ${esc(proveedor ? proveedor.rut : '')}</div>
                <div style="font-weight:700;">Orden de Compra: ${esc(factura.numeroOC || '')}</div>
                <div style="margin-top:6px;">Con fecha ${esc(fechaCL(rc.fecha || hoyISO()))}, en calidad de contraparte técnica, certifico lo siguiente:</div>
            </div>
            <div style="border:1px solid #000; padding:12px 14px 16px; font-size:13.5px; color:#000; line-height:1.5;">
                <div style="font-size:11px; margin-bottom:10px;">${esc(encab)}</div>
                <ul style="margin:0; padding-left:34px;">
                    ${bloques.map(b => {
                        const tieneSubs = Array.isArray(b.sublineas) && b.sublineas.length > 0;
                        return `<li style="margin-bottom:6px;">${tieneSubs ? `<b>${esc(b.titulo)}</b>` : esc(b.titulo)}${(b.sublineas || []).map(sl => `<div style="font-weight:400;">${esc(sl)}</div>`).join('')}</li>`;
                    }).join('')}
                </ul>
                ${rc.observaciones ? `<div style="margin-top:10px; font-size:11px;">Observaciones: ${esc(rc.observaciones)}</div>` : ''}
            </div>
            <div style="margin-top:46px; text-align:center; color:#000;">
                ${mostrarFirma
                    ? `<img src="assets/firma-contraparte-mariel.png" alt="Firma Contraparte Técnica" style="max-width:210px; height:auto; display:block; margin:0 auto 2px;" onerror="this.style.display='none'">`
                    : `<div style="border-top:1px solid #000; width:240px; margin:34px auto 6px;"></div>`}
                <div style="font-size:13.5px;">Firma contraparte técnica</div>
                <div style="font-size:13.5px; margin-top:16px;">Nombre Contraparte Técnica: ${esc(contraparte)}</div>
            </div>
        </div>`;
    }

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
            const rc = f.recepcionConforme || {};
            if (filtroRC === 'CON_RC' && !rc.emitida) return false;
            if (filtroRC === 'SIN_RC' && rc.emitida) return false;
            // Si el usuario escribe en el buscador (ej. RCO-2026-00001 o un folio/OC), busca en TODAS las OC para seguimiento rápido
            if (!q) {
                if (pres && f.presupuestoId !== pres.id) return false;
                if (!pres && filtroProv !== 'TODOS' && !provIds.has(f.proveedorId)) return false;
                if (filtroConcepto !== 'TODOS' && f.tipoServicio !== filtroConcepto && f.tipoServicio !== 'MIXTO') return false;
            } else {
                const prov = proveedores.find(p => p.id === f.proveedorId);
                const detTxt = (f.items || []).map(i => i.descripcion || '').join(' ') + ' ' + (rc.bloquesRC || []).map(b => `${b.titulo} ${(b.sublineas || []).join(' ')}`).join(' ');
                const hay = `${rc.numeroActa || ''} ${f.folio} ${f.numeroOC} ${f.facturaSAP || ''} ${f.reemplazaFactura || ''} ${f.periodoServicio} ${f.tipoServicio} ${rc.contraparte || ''} ${rc.fecha || ''} ${prov ? prov.razonSocial + ' ' + prov.rut : ''} ${detTxt}`.toLowerCase();
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
                    <button type="button" class="btn btn-outline btn-sm" id="oxf-btn-provs">Proveedores (${proveedores.length})</button>
                    <button type="button" class="btn btn-outline btn-sm" id="oxf-btn-press">Presupuestos / OC (${presupuestos.length})</button>
                    <button type="button" class="btn btn-outline btn-sm" id="oxf-btn-semilla" title="Carga idempotente de control con Indura S.A. OC 1298355-493-AG25">Cargar control Indura</button>
                    <button type="button" class="btn btn-primary" id="oxf-btn-nueva">+ Ingresar Factura / Guía (OCR / XML)</button>
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
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <small>${esc(provPres ? `${provPres.razonSocial} (${provPres.rut})` : '')} · Tope ${esc(pres.tipoMonto)}${pres.vigenciaDesde ? ` · Vigencia ${esc(fechaCL(pres.vigenciaDesde))} a ${esc(fechaCL(pres.vigenciaHasta))}` : ''}</small>
                        <button type="button" class="btn btn-outline btn-sm" id="oxf-btn-edit-pres" data-id="${esc(pres.id)}">Editar OC / Presupuesto</button>
                    </div>
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
                <input id="oxf-buscar" type="search" placeholder="Buscar por correlativo RCO-2026-…, folio, OC, proveedor, RUT o detalle…" value="${esc(buscador)}" autocomplete="off">
                <div class="oxf-pills" role="group" aria-label="Seguimiento de actas RC">
                    <button type="button" class="oxf-pill oxf-pill-rc${filtroRC === 'TODOS' ? ' on' : ''}" data-rc="TODOS">Todos (${facturas.length})</button>
                    <button type="button" class="oxf-pill oxf-pill-rc${filtroRC === 'CON_RC' ? ' on' : ''}" data-rc="CON_RC">Actas RC / RCO (${facturas.filter(x => x.recepcionConforme && x.recepcionConforme.emitida).length})</button>
                    <button type="button" class="oxf-pill oxf-pill-rc${filtroRC === 'SIN_RC' ? ' on' : ''}" data-rc="SIN_RC">Pendientes RC</button>
                </div>
                <span class="oxf-count">${filas.length} registro(s)${buscador.trim() ? ' (búsqueda global)' : ''}</span>
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
                                    <b>${esc(fac.folio)}</b> <span class="oxf-badge ${fac.tipoDocumento === 'GUIA_DESPACHO' ? 'oxf-b-cc' : 'oxf-b-hist'}">${fac.tipoDocumento === 'GUIA_DESPACHO' ? 'GUÍA' : 'FACT'}</span>
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
                                    ? `<span class="oxf-badge oxf-b-ok">RC ${esc(rc.tipoRecepcion === 'TOTAL' ? 'Total' : 'Parcial')} · ${esc(rc.numeroActa || '')}</span><small class="oxf-sub">${esc(fechaCL(rc.fecha))} · ${esc(rc.contraparte || rc.receptorNombre || '')}</small>`
                                    : `<span class="oxf-badge oxf-b-pend">Pendiente RC</span>`}</td>
                                <td class="oxf-cell-acc">
                                    ${fac.archivoUrl ? `<a class="btn btn-outline btn-sm" href="${esc(fac.archivoUrl)}" target="_blank" rel="noopener">Respaldo</a>` : ''}
                                    <button type="button" class="btn btn-outline btn-sm oxf-btn-rc" data-id="${esc(fac.id)}">${rc.emitida ? 'Editar acta' : 'Recepción Conforme'}</button>
                                    <button type="button" class="btn btn-primary btn-sm oxf-btn-rc-pdf" data-id="${esc(fac.id)}" title="Descargar RC oficial en PDF">PDF</button>
                                    <button type="button" class="btn btn-outline btn-sm oxf-btn-rc-word" data-id="${esc(fac.id)}" title="Descargar RC oficial en Word (.docx)">Word</button>
                                    <button type="button" class="btn btn-outline btn-sm oxf-btn-pdf" data-id="${esc(fac.id)}" title="Ver vista previa y saldo OC">Ver</button>
                                    <button type="button" class="btn btn-outline btn-sm oxf-btn-del-fac" data-id="${esc(fac.id)}" title="Eliminar documento">✕</button>
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
        $$('.oxf-pill:not(.oxf-pill-rc)').forEach(b => b.addEventListener('click', () => { filtroConcepto = b.dataset.c; pintar(); }));
        $$('.oxf-pill-rc').forEach(b => b.addEventListener('click', () => { filtroRC = b.dataset.rc; pintar(); }));
        const inpB = $('#oxf-buscar');
        if (inpB) inpB.addEventListener('input', (e) => {
            buscador = e.target.value;
            const pos = e.target.selectionStart;
            pintar();
            const n = document.getElementById('oxf-buscar');
            if (n) { n.focus(); n.setSelectionRange(pos, pos); }
        });

        const bProvs = $('#oxf-btn-provs');
        if (bProvs) bProvs.addEventListener('click', abrirModalGestionProveedores);
        const bPress = $('#oxf-btn-press');
        if (bPress) bPress.addEventListener('click', abrirModalGestionPresupuestos);
        const bEditPres = $('#oxf-btn-edit-pres');
        if (bEditPres) bEditPres.addEventListener('click', () => {
            const p = presupuestos.find(x => x.id === bEditPres.dataset.id);
            if (p) abrirModalPresupuesto(p);
        });
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
        $$('.oxf-btn-rc-pdf').forEach(b => b.addEventListener('click', async () => {
            const fac = facturas.find(x => x.id === b.dataset.id);
            if (!fac) return;
            const pv = proveedores.find(p => p.id === fac.proveedorId);
            b.disabled = true;
            try { await descargarRCOficialCorporacionPDF(fac, pv); }
            catch (e) { toast('Error PDF', e.message || String(e), 'error'); }
            finally { b.disabled = false; }
        }));
        $$('.oxf-btn-rc-word').forEach(b => b.addEventListener('click', async () => {
            const fac = facturas.find(x => x.id === b.dataset.id);
            if (!fac) return;
            const pv = proveedores.find(p => p.id === fac.proveedorId);
            b.disabled = true;
            try { await descargarRCOficialCorporacionWord(fac, pv); }
            catch (e) { toast('Error Word', e.message || String(e), 'error'); }
            finally { b.disabled = false; }
        }));
        $$('.oxf-btn-pdf').forEach(b => b.addEventListener('click', () => {
            const fac = facturas.find(x => x.id === b.dataset.id);
            if (fac) abrirModalVistaActaPDF(fac);
        }));
        $$('.oxf-btn-del-fac').forEach(b => b.addEventListener('click', async () => {
            const fac = facturas.find(x => x.id === b.dataset.id);
            if (!fac) return;
            if (!window.confirm(`¿Eliminar el documento Folio ${fac.folio} (${clp(fac.totalBruto)})? Esta acción recalculará el saldo de la OC.`)) return;
            b.disabled = true;
            try {
                await eliminarFactura(fac.id);
                await cargarDatos();
                pintar();
                toast('Documento eliminado', `Folio ${fac.folio} eliminado.`, 'success');
            } catch (e) {
                toast('No se pudo eliminar', e.message || String(e), 'error');
                b.disabled = false;
            }
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

    /** Administrador de Proveedores: listar, crear, editar y eliminar (protegido si tiene OC/facturas). */
    function abrirModalGestionProveedores() {
        const filasHtml = () => proveedores.length
            ? proveedores.map(p => {
                const nPres = presupuestos.filter(b => b.proveedorId === p.id).length;
                const nFact = facturas.filter(f => f.proveedorId === p.id).length;
                return `<tr>
                    <td><b>${esc(p.razonSocial)}</b><small class="oxf-sub">${esc(p.rut)}${p.contactoEmail ? ' · ' + esc(p.contactoEmail) : ''}</small></td>
                    <td><span class="oxf-badge ${p.estado === 'HISTORICO' ? 'oxf-b-hist' : 'oxf-b-act'}">${esc(p.estado === 'HISTORICO' ? 'HISTÓRICO' : 'ACTIVO')}</span></td>
                    <td>${nPres} OC · ${nFact} doc(s)</td>
                    <td class="oxf-cell-acc">
                        <button type="button" class="btn btn-outline btn-sm oxf-gp-edit" data-id="${esc(p.id)}">Editar</button>
                        <button type="button" class="btn btn-outline btn-sm oxf-gp-del" data-id="${esc(p.id)}">Eliminar</button>
                    </td>
                </tr>`;
            }).join('')
            : `<tr><td colspan="4" class="oxf-td-vacio">No hay proveedores registrados aún.</td></tr>`;

        const ov = crearModal('Proveedores de Oxígeno (Crear / Editar / Eliminar)', `
            <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
                <button type="button" class="btn btn-primary btn-sm" id="oxf-gp-nuevo">+ Nuevo proveedor</button>
            </div>
            <div class="oxf-tabla-wrap">
                <table class="soc-tabla oxf-tabla">
                    <thead><tr><th>Proveedor / RUT</th><th>Estado</th><th>Vínculos</th><th>Acciones</th></tr></thead>
                    <tbody id="oxf-gp-body">${filasHtml()}</tbody>
                </table>
            </div>
            <p class="cierre-error" id="oxf-gp-err"></p>
            <div class="cierre-acciones"><button type="button" class="btn btn-outline" id="oxf-gp-cerrar">Cerrar</button></div>`, 'oxf-modal-xl');

        ov.querySelector('#oxf-gp-cerrar').addEventListener('click', () => ov.remove());
        ov.querySelector('#oxf-gp-nuevo').addEventListener('click', () => { ov.remove(); abrirModalProveedor(null); });
        ov.querySelectorAll('.oxf-gp-edit').forEach(b => b.addEventListener('click', () => {
            const pv = proveedores.find(x => x.id === b.dataset.id);
            if (pv) { ov.remove(); abrirModalProveedor(pv); }
        }));
        ov.querySelectorAll('.oxf-gp-del').forEach(b => b.addEventListener('click', async () => {
            const pv = proveedores.find(x => x.id === b.dataset.id);
            if (!pv) return;
            const errEl = ov.querySelector('#oxf-gp-err');
            errEl.textContent = '';
            const check = validarEliminacionProveedor(pv.id, presupuestos, facturas);
            if (!check.ok) { errEl.textContent = check.mensaje; return; }
            if (!window.confirm(`¿Eliminar definitivamente al proveedor "${pv.razonSocial}" (${pv.rut})?`)) return;
            b.disabled = true;
            try {
                await eliminarProveedor(pv.id);
                if (filtroProv === pv.id) filtroProv = 'TODOS';
                await cargarDatos();
                pintar();
                ov.remove();
                toast('Proveedor eliminado', `${pv.razonSocial} fue eliminado.`, 'success');
            } catch (e) {
                errEl.textContent = e.message || String(e);
                b.disabled = false;
            }
        }));
    }

    function abrirModalProveedor(provEditar) {
        const p = provEditar && provEditar.id ? provEditar : null;
        const ov = crearModal(p ? `Editar Proveedor · ${p.razonSocial}` : 'Registrar Proveedor de Oxígeno', `
            <div class="oxf-form-grid">
                <label class="act-l">Razón Social *<input id="oxf-p-rs" value="${esc(p ? p.razonSocial : '')}" placeholder="Ej: Linde Gas Chile S.A."></label>
                <label class="act-l">RUT *<input id="oxf-p-rut" value="${esc(p ? p.rut : '')}" placeholder="Ej: 76.150.343-K"></label>
                <label class="act-l">Estado<select id="oxf-p-est"><option value="ACTIVO"${!p || p.estado !== 'HISTORICO' ? ' selected' : ''}>Activo (Empresa Actual)</option><option value="HISTORICO"${p && p.estado === 'HISTORICO' ? ' selected' : ''}>Histórico</option></select></label>
                <label class="act-l">Email contacto<input id="oxf-p-mail" type="email" value="${esc(p ? p.contactoEmail || '' : '')}" placeholder="facturacion@proveedor.cl"></label>
                <label class="act-l oxf-span2">Cuenta bancaria (referencia pagos)<input id="oxf-p-cta" value="${esc(p ? p.cuentaBancaria || '' : '')}" placeholder="Banco · Tipo cuenta · N°"></label>
            </div>
            <p class="cierre-error" id="oxf-p-err"></p>
            <div class="cierre-acciones">
                ${p ? '<button type="button" class="btn btn-outline" id="oxf-p-del" style="margin-right:auto;color:#b91c1c;border-color:#fca5a5;">Eliminar proveedor</button>' : ''}
                <button type="button" class="btn btn-outline" id="oxf-p-no">Cancelar</button>
                <button type="button" class="btn btn-primary" id="oxf-p-ok">${p ? 'Guardar cambios' : 'Guardar proveedor'}</button>
            </div>`);
        ov.querySelector('#oxf-p-no').addEventListener('click', () => ov.remove());
        const bDel = ov.querySelector('#oxf-p-del');
        if (bDel && p) {
            bDel.addEventListener('click', async () => {
                ov.querySelector('#oxf-p-err').textContent = '';
                const check = validarEliminacionProveedor(p.id, presupuestos, facturas);
                if (!check.ok) { ov.querySelector('#oxf-p-err').textContent = check.mensaje; return; }
                if (!window.confirm(`¿Eliminar definitivamente al proveedor "${p.razonSocial}"?`)) return;
                bDel.disabled = true;
                try {
                    await eliminarProveedor(p.id);
                    if (filtroProv === p.id) filtroProv = 'TODOS';
                    await cargarDatos();
                    pintar();
                    ov.remove();
                    toast('Proveedor eliminado', `${p.razonSocial} fue eliminado.`, 'success');
                } catch (e) {
                    ov.querySelector('#oxf-p-err').textContent = e.message || String(e);
                    bDel.disabled = false;
                }
            });
        }
        ov.querySelector('#oxf-p-ok').addEventListener('click', async () => {
            const btn = ov.querySelector('#oxf-p-ok'); btn.disabled = true;
            ov.querySelector('#oxf-p-err').textContent = '';
            try {
                await guardarProveedor({
                    id: p ? p.id : undefined,
                    creadoEl: p ? p.creadoEl : undefined,
                    razonSocial: ov.querySelector('#oxf-p-rs').value,
                    rut: ov.querySelector('#oxf-p-rut').value,
                    estado: ov.querySelector('#oxf-p-est').value,
                    contactoEmail: ov.querySelector('#oxf-p-mail').value,
                    cuentaBancaria: ov.querySelector('#oxf-p-cta').value
                });
                await cargarDatos();
                pintar();
                ov.remove();
                toast('Proveedor', p ? 'Proveedor actualizado.' : 'Proveedor de oxígeno guardado.', 'success');
            } catch (e) {
                ov.querySelector('#oxf-p-err').textContent = e.message || String(e);
                btn.disabled = false;
            }
        });
    }

    /** Administrador de Presupuestos / OC: listar todos, crear, editar, cerrar y eliminar (protegido si tiene documentos). */
    function abrirModalGestionPresupuestos() {
        const filasHtml = presupuestos.length
            ? presupuestos.map(b => {
                const pv = proveedores.find(p => p.id === b.proveedorId);
                const est = calcularEstadoPresupuesto(b, facturas);
                return `<tr>
                    <td><b>OC ${esc(b.numeroOC)}</b><small class="oxf-sub">${esc(b.nombreContrato || '')}</small></td>
                    <td>${esc(pv ? pv.razonSocial : '—')}<small class="oxf-sub">${esc(pv ? pv.rut : '')}</small></td>
                    <td><span class="oxf-badge oxf-b-tipo">${esc(b.conceptoPermitido)}</span> <span class="oxf-badge ${b.estado === 'CERRADO' ? 'oxf-b-hist' : 'oxf-b-act'}">${esc(b.estado)}</span></td>
                    <td class="num"><b>${clp(est.presupuestoBase)}</b><small class="oxf-sub">Ejec: ${clp(est.ejecutadoOC)} (${esc(est.porcentajeTexto)}) · Saldo: ${clp(est.saldoDisponible)}</small></td>
                    <td class="oxf-cell-acc">
                        <button type="button" class="btn btn-outline btn-sm oxf-gb-ver" data-id="${esc(b.id)}">Seleccionar</button>
                        <button type="button" class="btn btn-outline btn-sm oxf-gb-edit" data-id="${esc(b.id)}">Editar</button>
                        <button type="button" class="btn btn-outline btn-sm oxf-gb-del" data-id="${esc(b.id)}">Eliminar</button>
                    </td>
                </tr>`;
            }).join('')
            : `<tr><td colspan="5" class="oxf-td-vacio">No hay presupuestos / OC registrados aún.</td></tr>`;

        const ov = crearModal('Presupuestos / Órdenes de Compra de Oxígeno (Crear / Editar / Eliminar)', `
            <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
                <button type="button" class="btn btn-primary btn-sm" id="oxf-gb-nuevo">+ Nuevo presupuesto / OC</button>
            </div>
            <div class="oxf-tabla-wrap">
                <table class="soc-tabla oxf-tabla">
                    <thead><tr><th>Orden de Compra / Contrato</th><th>Proveedor</th><th>Concepto / Estado</th><th class="num">Tope / Ejecución</th><th>Acciones</th></tr></thead>
                    <tbody>${filasHtml}</tbody>
                </table>
            </div>
            <p class="cierre-error" id="oxf-gb-err"></p>
            <div class="cierre-acciones"><button type="button" class="btn btn-outline" id="oxf-gb-cerrar">Cerrar</button></div>`, 'oxf-modal-xl');

        ov.querySelector('#oxf-gb-cerrar').addEventListener('click', () => ov.remove());
        ov.querySelector('#oxf-gb-nuevo').addEventListener('click', () => { ov.remove(); abrirModalPresupuesto(null); });
        ov.querySelectorAll('.oxf-gb-ver').forEach(b => b.addEventListener('click', () => { filtroProv = 'TODOS'; filtroConcepto = 'TODOS'; filtroPresId = b.dataset.id; ov.remove(); pintar(); }));
        ov.querySelectorAll('.oxf-gb-edit').forEach(b => b.addEventListener('click', () => {
            const p = presupuestos.find(x => x.id === b.dataset.id);
            if (p) { ov.remove(); abrirModalPresupuesto(p); }
        }));
        ov.querySelectorAll('.oxf-gb-del').forEach(b => b.addEventListener('click', async () => {
            const p = presupuestos.find(x => x.id === b.dataset.id);
            if (!p) return;
            const errEl = ov.querySelector('#oxf-gb-err');
            errEl.textContent = '';
            if (!window.confirm(`¿Eliminar el presupuesto / OC "${p.numeroOC}"?`)) return;
            b.disabled = true;
            try {
                await eliminarPresupuesto(p.id);
                if (filtroPresId === p.id) filtroPresId = '';
                await cargarDatos();
                pintar();
                ov.remove();
                toast('Presupuesto eliminado', `OC ${p.numeroOC} eliminada.`, 'success');
            } catch (e) {
                errEl.textContent = e.message || String(e);
                b.disabled = false;
            }
        }));
    }

    function abrirModalPresupuesto(presEditar) {
        const b = presEditar && presEditar.id ? presEditar : null;
        if (!proveedores.length) {
            toast('Proveedor requerido', 'Primero registra un proveedor o carga el control Indura.', 'warning');
            abrirModalProveedor(null);
            return;
        }
        const ov = crearModal(b ? `Editar Presupuesto / OC ${b.numeroOC}` : 'Nuevo Presupuesto / Orden de Compra de Oxígeno', `
            <div class="oxf-form-grid">
                <label class="act-l">Proveedor *<select id="oxf-b-prov">${proveedores.map(p => `<option value="${esc(p.id)}"${b && b.proveedorId === p.id ? ' selected' : ''}>${esc(p.razonSocial)} (${esc(p.rut)})</option>`).join('')}</select></label>
                <label class="act-l">N° Orden de Compra *<input id="oxf-b-oc" value="${esc(b ? b.numeroOC : '')}" placeholder="Ej: 1298355-493-AG25"></label>
                <label class="act-l oxf-span2">Nombre del Contrato / Bolsa<input id="oxf-b-nom" value="${esc(b ? b.nombreContrato || '' : '')}" placeholder="Ej: Arriendo cilindros oxígeno 2026"></label>
                <label class="act-l">Concepto Permitido<select id="oxf-b-con"><option value="ARRIENDO"${!b || b.conceptoPermitido === 'ARRIENDO' ? ' selected' : ''}>Arriendo / Renta</option><option value="RECARGA"${b && b.conceptoPermitido === 'RECARGA' ? ' selected' : ''}>Recarga</option><option value="MIXTO"${b && b.conceptoPermitido === 'MIXTO' ? ' selected' : ''}>Mixto (Arriendo y Recarga)</option></select></label>
                <label class="act-l">Tipo de Monto<select id="oxf-b-tm"><option value="BRUTO"${!b || b.tipoMonto !== 'NETO' ? ' selected' : ''}>Bruto (IVA incluido)</option><option value="NETO"${b && b.tipoMonto === 'NETO' ? ' selected' : ''}>Neto</option></select></label>
                <label class="act-l">Monto Tope ($) *<input id="oxf-b-tope" type="number" min="1" step="1" value="${b ? Math.round(num(b.montoTope)) : ''}" placeholder="Ej: 1078000"></label>
                <label class="act-l">Estado<select id="oxf-b-est"><option value="ACTIVO"${!b || b.estado !== 'CERRADO' ? ' selected' : ''}>Activo</option><option value="CERRADO"${b && b.estado === 'CERRADO' ? ' selected' : ''}>Cerrado</option></select></label>
                <label class="act-l">Vigencia Desde<input id="oxf-b-des" type="date" value="${esc(b ? b.vigenciaDesde || '' : hoyISO())}"></label>
                <label class="act-l">Vigencia Hasta<input id="oxf-b-has" type="date" value="${esc(b ? b.vigenciaHasta || '' : '')}"></label>
            </div>
            <p class="cierre-error" id="oxf-b-err"></p>
            <div class="cierre-acciones">
                ${b ? '<button type="button" class="btn btn-outline" id="oxf-b-del" style="margin-right:auto;color:#b91c1c;border-color:#fca5a5;">Eliminar OC</button>' : ''}
                <button type="button" class="btn btn-outline" id="oxf-b-no">Cancelar</button>
                <button type="button" class="btn btn-primary" id="oxf-b-ok">${b ? 'Guardar cambios' : 'Guardar presupuesto / OC'}</button>
            </div>`);
        ov.querySelector('#oxf-b-no').addEventListener('click', () => ov.remove());
        const bDel = ov.querySelector('#oxf-b-del');
        if (bDel && b) {
            bDel.addEventListener('click', async () => {
                ov.querySelector('#oxf-b-err').textContent = '';
                if (!window.confirm(`¿Eliminar la OC / presupuesto "${b.numeroOC}"?`)) return;
                bDel.disabled = true;
                try {
                    await eliminarPresupuesto(b.id);
                    if (filtroPresId === b.id) filtroPresId = '';
                    await cargarDatos();
                    pintar();
                    ov.remove();
                    toast('Presupuesto eliminado', `OC ${b.numeroOC} eliminada.`, 'success');
                } catch (e) {
                    ov.querySelector('#oxf-b-err').textContent = e.message || String(e);
                    bDel.disabled = false;
                }
            });
        }
        ov.querySelector('#oxf-b-ok').addEventListener('click', async () => {
            const btn = ov.querySelector('#oxf-b-ok'); btn.disabled = true;
            ov.querySelector('#oxf-b-err').textContent = '';
            try {
                const id = await guardarPresupuesto({
                    id: b ? b.id : undefined,
                    creadoEl: b ? b.creadoEl : undefined,
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
                toast('Presupuesto', b ? 'Presupuesto / OC actualizado.' : 'Orden de compra / presupuesto guardado.', 'success');
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

        const ov = crearModal('Ingresar Factura o Guía de Oxígeno (Indura / Comercial VR / Welding / XML)', `
            <div class="oxf-dropzone" id="oxf-drop" tabindex="0">
                <input type="file" id="oxf-file" accept=".xml,.pdf,.jpg,.jpeg,.png,application/xml,text/xml,application/pdf,image/jpeg,image/png" hidden>
                <strong>Arrastra aquí la factura o guía (.xml DTE, .pdf, .jpg o .png) o haz clic para seleccionar</strong>
                <small>Reconoce automáticamente Indura S.A., Comercial VR Limitada, Welding SpA y XML DTE · Permite rotar 90°/180°.</small>
                <div id="oxf-drop-status" class="oxf-drop-status"></div>
            </div>
            <div id="oxf-prov-nuevo" class="oxf-alert-warn" style="display:none;"></div>

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
                <label class="act-l">Tipo de Documento
                    <select id="oxf-f-tipodoc">
                        <option value="FACTURA">Factura Electrónica</option>
                        <option value="GUIA_DESPACHO">Guía de Despacho Electrónica</option>
                    </select>
                </label>
                <label class="act-l">Folio Documento *<input id="oxf-f-folio" placeholder="Ej: 2074906, 4321, 882" autocomplete="off"></label>
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
                <label class="act-l">Monto Neto / Subtotal / Afecto ($)<input id="oxf-f-neto" type="number" min="0" step="1" value="0"></label>
                <label class="act-l">IVA 19% ($)<input id="oxf-f-iva" type="number" min="0" step="1" value="0"></label>
                <label class="act-l">Total Bruto (Total Factura) ($) *<input id="oxf-f-total" type="number" min="0" step="1" value="0"></label>
                <div class="oxf-calc-btn-wrap"><button type="button" class="btn btn-outline btn-sm" id="oxf-calc-iva">Calcular IVA 19%</button></div>
            </div>

            <div id="oxf-alerta-cuadre" class="oxf-alert-warn" style="display:none;"></div>

            <div class="oxf-items-sec">
                <div class="oxf-items-head">
                    <b>Detalle de Ítems / Cilindros (se replicará en la Recepción Conforme)</b>
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

            <label class="soc-toggle" style="margin-top:8px;"><input type="checkbox" id="oxf-f-abrir-rc" checked> Abrir <b>Recepción Conforme (Parcial/Total)</b> inmediatamente al guardar</label>
            <p class="cierre-error" id="oxf-f-err"></p>
            <div class="cierre-acciones">
                <button type="button" class="btn btn-outline" id="oxf-f-no">Cancelar</button>
                <button type="button" class="btn btn-primary" id="oxf-f-ok">Guardar Documento</button>
            </div>`, 'oxf-modal-xl');

        const q = (s) => ov.querySelector(s);
        let archivoActual = null;
        let canvasBase = null;
        let textoDigitalPdf = '';
        let anguloActual = 0;
        let itemsEstado = [];
        let bloquesRCEstado = [];

        function pintarItems() {
            const box = q('#oxf-items-list');
            if (!itemsEstado.length) {
                box.innerHTML = '<p class="act-hint">Sin líneas detalladas (puedes agregar ítems o leer desde XML/OCR).</p>';
                return;
            }
            box.innerHTML = itemsEstado.map((it, i) => `
                <div class="oxf-item-row" data-i="${i}">
                    <input class="oxf-it-cod" placeholder="Cód." value="${esc(it.codigo || '')}">
                    <input class="oxf-it-desc" placeholder="Descripción" value="${esc(it.descripcion || '')}" title="${esc(it.descripcion || '')}">
                    <input class="oxf-it-cant" type="number" step="any" placeholder="Cant." value="${num(it.cantidad) || 1}">
                    <input class="oxf-it-uni" placeholder="Unid." value="${esc(it.unidad || 'UN')}">
                    <input class="oxf-it-vu" type="number" step="any" placeholder="V. Unit." value="${num(it.valorUnitario)}">
                    <input class="oxf-it-vt" type="number" step="1" placeholder="Total" value="${num(it.valorTotal)}">
                    <button type="button" class="btn btn-outline btn-sm oxf-it-del" title="Quitar">✕</button>
                </div>`).join('');
            box.querySelectorAll('.oxf-item-row').forEach((row) => {
                const idx = Number(row.dataset.i);
                const sync = () => {
                    const prev = itemsEstado[idx] || {};
                    const nuevaDesc = row.querySelector('.oxf-it-desc').value.trim();
                    itemsEstado[idx] = {
                        ...prev,
                        codigo: row.querySelector('.oxf-it-cod').value.trim(),
                        descripcion: nuevaDesc,
                        cantidad: num(row.querySelector('.oxf-it-cant').value) || 1,
                        unidad: row.querySelector('.oxf-it-uni').value.trim() || 'UN',
                        valorUnitario: num(row.querySelector('.oxf-it-vu').value),
                        valorTotal: Math.round(num(row.querySelector('.oxf-it-vt').value))
                    };
                    if (prev.descripcion !== nuevaDesc) {
                        delete itemsEstado[idx].grupo;
                        delete itemsEstado[idx].sublinea;
                        bloquesRCEstado = [];
                    }
                };
                row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', sync));
                row.querySelector('.oxf-it-del').addEventListener('click', () => { itemsEstado.splice(idx, 1); bloquesRCEstado = []; pintarItems(); });
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
            const boxProvNuevo = q('#oxf-prov-nuevo');
            boxProvNuevo.style.display = 'none';
            boxProvNuevo.innerHTML = '';

            if (res.tipoDocumento) q('#oxf-f-tipodoc').value = res.tipoDocumento === 'GUIA_DESPACHO' ? 'GUIA_DESPACHO' : 'FACTURA';

            if (res.rutEmisor) {
                const rNorm = normRut(res.rutEmisor);
                const matchProv = proveedores.find(p => normRut(p.rut) === rNorm);
                if (matchProv) {
                    q('#oxf-f-proveedor').value = matchProv.id;
                } else if (res.razonSocial) {
                    boxProvNuevo.style.display = 'block';
                    boxProvNuevo.innerHTML = `Proveedor detectado <b>${esc(res.razonSocial)}</b> (${esc(res.rutEmisor)}) aún no está creado. <button type="button" class="btn btn-primary btn-sm" id="oxf-crear-prov-rap" style="margin-left:8px;">+ Crear proveedor ahora</button>`;
                    const bRap = boxProvNuevo.querySelector('#oxf-crear-prov-rap');
                    if (bRap) bRap.addEventListener('click', async () => {
                        bRap.disabled = true;
                        try {
                            const nuevoId = await guardarProveedor({ razonSocial: res.razonSocial, rut: res.rutEmisor, estado: 'ACTIVO', contactoEmail: res.contactoEmail || '', cuentaBancaria: res.cuentaBancaria || '' });
                            await cargarDatos();
                            const selP = q('#oxf-f-proveedor');
                            selP.innerHTML = proveedores.map(p => `<option value="${esc(p.id)}"${p.id === nuevoId ? ' selected' : ''}>${esc(p.razonSocial)} (${esc(p.rut)})</option>`).join('');
                            selP.value = nuevoId;
                            boxProvNuevo.style.display = 'none';
                            toast('Proveedor creado', `${res.razonSocial} (${res.rutEmisor}) agregado.`, 'success');
                        } catch (e) {
                            toast('Error', e.message || String(e), 'error');
                            bRap.disabled = false;
                        }
                    });
                }
            }
            if (res.numeroOC) {
                q('#oxf-f-oc').value = res.numeroOC;
                const ocU = res.numeroOC.toUpperCase();
                // Match exacto o por prefijo (ej. Comercial VR trunca "1298355-641-AG2" para "1298355-641-AG26")
                const matchPres = presupuestos.find(b => {
                    const bo = String(b.numeroOC || '').toUpperCase();
                    return bo === ocU || (ocU.length >= 12 && (bo.startsWith(ocU) || ocU.startsWith(bo)));
                });
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
            bloquesRCEstado = Array.isArray(res.bloquesRC) ? res.bloquesRC.slice() : [];
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
                tipoDocumento: q('#oxf-f-tipodoc').value,
                folio: q('#oxf-f-folio').value.trim(),
                facturaSAP: q('#oxf-f-sap').value.trim(),
                reemplazaFactura: folioReemp,
                tipoServicio: q('#oxf-f-tipo').value,
                periodoServicio: q('#oxf-f-per').value,
                fechaEmision: q('#oxf-f-femis').value,
                fechaVencimiento: q('#oxf-f-fvenc').value,
                items: itemsEstado,
                bloquesRC: bloquesRCEstado,
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

            const abrirRCDespues = q('#oxf-f-abrir-rc') && q('#oxf-f-abrir-rc').checked;
            btn.disabled = true;
            try {
                const res = await guardarFacturaAtomica(payload, archivoActual);
                await cargarDatos();
                pintar();
                ov.remove();
                const extra = res.reemplazoMarcado ? ` · Folio ${res.reemplazoMarcado} marcado REEMPLAZADA` : '';
                toast('Documento registrado', `Folio ${payload.folio} guardado (${clp(payload.totalBruto)})${extra}.`, res.avisoStorage ? 'warning' : 'success');
                if (res.avisoStorage) toast('Respaldo Storage', res.avisoStorage, 'warning');
                if (abrirRCDespues) {
                    const guardada = facturas.find(x => x.id === res.id);
                    if (guardada) abrirModalRecepcionConforme(guardada);
                }
            } catch (e) {
                errEl.textContent = e.message || String(e);
                btn.disabled = false;
            }
        });

        pintarItems();
        actualizarSimulador();
    }

    /** Paso 4: Modal de Recepción Conforme (Parcial / Total, fecha editable, formato oficial Corporación PDF + Word .docx). */
    function abrirModalRecepcionConforme(factura) {
        const rc = factura.recepcionConforme || {};
        const pv = proveedores.find(p => p.id === factura.proveedorId);
        const tipoActual = rc.tipoRecepcion === 'TOTAL' ? 'TOTAL' : 'PARCIAL';
        const encBase = (tp) => encabezadoRCBase(tp !== 'TOTAL');
        const bloquesOriginales = construirBloquesRC(factura);
        const bloquesIni = (Array.isArray(rc.bloquesRC) && rc.bloquesRC.length) ? rc.bloquesRC : bloquesOriginales;
        const docTipoActual = rc.tipoDocumento || factura.tipoDocumento || 'FACTURA';
        const docTipoTxt = docTipoActual === 'GUIA_DESPACHO' ? 'Guía de Despacho' : 'Factura';
        const fechaProp = rc.fecha || factura.fechaEmision || hoyISO();

        const ov = crearModal(`${rc.emitida ? 'Editar acta de Recepción Conforme' : 'Recepción Conforme'} · ${docTipoTxt} N° ${factura.folio}`, `
            <p class="cierre-hint">Proveedor: <b>${esc(pv ? pv.razonSocial : '—')}</b> (${esc(pv ? pv.rut : '—')}) · OC <b>${esc(factura.numeroOC || '—')}</b> · Total <b>${clp(factura.totalBruto)}</b>. Al guardar puedes descargar el acta actualizada en <b>PDF</b> y <b>Word (.docx)</b>.</p>
            <div class="oxf-form-grid">
                <label class="act-l">Tipo de Recepción Conforme *
                    <select id="oxf-rc-tipo">
                        <option value="PARCIAL"${tipoActual === 'PARCIAL' ? ' selected' : ''}>Parcial (RECEPCIÓN CONFORME PRODUCTO O SERVICIO PARCIAL)</option>
                        <option value="TOTAL"${tipoActual === 'TOTAL' ? ' selected' : ''}>Total (RECEPCIÓN CONFORME PRODUCTO O SERVICIO TOTAL)</option>
                    </select>
                </label>
                <label class="act-l">Fecha de Recepción Conforme (editable) *
                    <input id="oxf-rc-fec" type="date" value="${esc(fechaProp)}">
                    <span class="oxf-sub" style="margin-top:4px;">
                        ${factura.fechaEmision ? `<a href="#" id="oxf-rc-f-doc">Usar fecha documento (${esc(fechaCL(factura.fechaEmision))})</a> · ` : ''}
                        <a href="#" id="oxf-rc-f-hoy">Usar hoy (${esc(fechaCL(hoyISO()))})</a>
                    </span>
                </label>
                <label class="act-l">Documento asociado
                    <select id="oxf-rc-tdoc">
                        <option value="FACTURA"${docTipoActual !== 'GUIA_DESPACHO' ? ' selected' : ''}>Factura Electrónica</option>
                        <option value="GUIA_DESPACHO"${docTipoActual === 'GUIA_DESPACHO' ? ' selected' : ''}>Guía de Despacho Electrónica</option>
                    </select>
                </label>
                <label class="act-l">N° Documento<input id="oxf-rc-ndoc" value="${esc(rc.numeroDoc || factura.folio || '')}"></label>
                <label class="act-l oxf-span2">Encabezado del cuadro (editable)<input id="oxf-rc-enc" value="${esc(rc.encabezado || encBase(tipoActual))}"></label>
                <label class="act-l oxf-span2">
                    <span style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span>Detalle replicado de la factura/guía (editable — «• » inicia viñeta; 2 espacios = sublínea)</span>
                        <button type="button" class="btn btn-outline btn-sm" id="oxf-rc-restaurar">Restaurar descripción de factura</button>
                    </span>
                    <textarea id="oxf-rc-det" rows="7" style="font-family:monospace;font-size:.86rem;margin-top:4px;">${esc(bloquesRCTexto(bloquesIni))}</textarea>
                </label>
                <label class="act-l">Contraparte Técnica (firma del acta) *<input id="oxf-rc-ct" value="${esc(rc.contraparte || CONTRAPARTE_BASE)}"></label>
                <label class="act-l">Recinto / Establecimiento<input id="oxf-rc-rec" value="${esc(rc.recinto || RECINTO_BASE)}"></label>
                <label class="act-l">RUT Receptor (opcional acta saldo OC)<input id="oxf-rc-rut" value="${esc(rc.receptorRut || '')}" placeholder="Ej: 12.345.678-9"></label>
                <label class="act-l">Cargo Receptor<input id="oxf-rc-car" value="${esc(rc.receptorCargo || 'Directora Técnica / Contraparte Técnica')}"></label>
                <label class="act-l oxf-span2">Observaciones (opcional)<textarea id="oxf-rc-obs" rows="2" placeholder="Observaciones adicionales…">${esc(rc.observaciones || '')}</textarea></label>
            </div>
            <label class="soc-toggle"><input type="checkbox" id="oxf-rc-firma"${rc.conFirma !== false ? ' checked' : ''}> Incluir firma y timbre oficial de la Contraparte Técnica en PDF y Word</label>
            <p class="cierre-error" id="oxf-rc-err"></p>
            <div class="cierre-acciones">
                <button type="button" class="btn btn-outline" id="oxf-rc-no">Cancelar</button>
                <button type="button" class="btn btn-primary" id="oxf-rc-ok">Guardar acta (PDF y Word)</button>
            </div>`, 'oxf-modal-xl');

        const selTipo = ov.querySelector('#oxf-rc-tipo');
        const inpEnc = ov.querySelector('#oxf-rc-enc');
        const inpFec = ov.querySelector('#oxf-rc-fec');
        selTipo.addEventListener('change', () => {
            if (/^Que se recibió conforme en forma (parcial|total)/i.test(inpEnc.value.trim())) {
                inpEnc.value = encBase(selTipo.value);
            }
        });
        const aDoc = ov.querySelector('#oxf-rc-f-doc');
        if (aDoc) aDoc.addEventListener('click', (e) => { e.preventDefault(); inpFec.value = factura.fechaEmision; });
        const aHoy = ov.querySelector('#oxf-rc-f-hoy');
        if (aHoy) aHoy.addEventListener('click', (e) => { e.preventDefault(); inpFec.value = hoyISO(); });
        ov.querySelector('#oxf-rc-restaurar').addEventListener('click', () => {
            ov.querySelector('#oxf-rc-det').value = bloquesRCTexto(bloquesOriginales);
            toast('Restaurado', 'Se copió la descripción original de la factura/guía.', 'info');
        });

        ov.querySelector('#oxf-rc-no').addEventListener('click', () => ov.remove());
        ov.querySelector('#oxf-rc-ok').addEventListener('click', async () => {
            const btn = ov.querySelector('#oxf-rc-ok'); btn.disabled = true;
            ov.querySelector('#oxf-rc-err').textContent = '';
            try {
                const nuevaRC = await registrarRecepcionConforme(factura.id, {
                    tipoRecepcion: selTipo.value,
                    fecha: inpFec.value,
                    tipoDocumento: ov.querySelector('#oxf-rc-tdoc').value,
                    numeroDoc: ov.querySelector('#oxf-rc-ndoc').value,
                    encabezado: inpEnc.value,
                    detalleTexto: ov.querySelector('#oxf-rc-det').value,
                    contraparte: ov.querySelector('#oxf-rc-ct').value,
                    conFirma: ov.querySelector('#oxf-rc-firma').checked,
                    recinto: ov.querySelector('#oxf-rc-rec').value,
                    receptorNombre: ov.querySelector('#oxf-rc-ct').value,
                    receptorRut: ov.querySelector('#oxf-rc-rut').value,
                    receptorCargo: ov.querySelector('#oxf-rc-car').value,
                    observaciones: ov.querySelector('#oxf-rc-obs').value
                });
                await cargarDatos();
                pintar();
                ov.remove();
                toast('Acta actualizada', `RC ${nuevaRC.tipoRecepcion} (${nuevaRC.numeroActa}) lista en PDF y Word.`, 'success');
                const actFac = facturas.find(x => x.id === factura.id);
                if (actFac) abrirModalVistaActaPDF(actFac);
            } catch (e) {
                ov.querySelector('#oxf-rc-err').textContent = e.message || String(e);
                btn.disabled = false;
            }
        });
    }

    /** Vista previa limpia (fondo blanco forzado) mostrando RC Oficial Corporación (PDF y Word .docx) + Acta detallada Ley 19.983. */
    function abrirModalVistaActaPDF(factura) {
        const pv = proveedores.find(p => p.id === factura.proveedorId);
        const pres = presupuestos.find(b => b.id === factura.presupuestoId) || null;
        const estPres = pres ? calcularEstadoPresupuesto(pres, facturas) : null;
        const htmlOficial = construirHtmlRCOficial(factura, pv);
        const htmlDetallada = construirHtmlActaRC(factura, pv, pres, estPres);
        const rc = factura.recepcionConforme || {};
        let vistaActual = 'oficial';

        const ov = crearModal(`Recepción Conforme · Folio ${factura.folio}`, `
            ${!rc.emitida ? '<div class="oxf-alert-warn">Este documento aún no tiene Recepción Conforme emitida. Puedes editarla ahora para fijar fecha, Parcial/Total y detalle exacto.</div>' : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                <div class="oxf-pills">
                    <button type="button" class="oxf-pill on" data-v="oficial">RC Oficial Corporación (mismo formato)</button>
                    <button type="button" class="oxf-pill" data-v="detallada">Acta Detallada con Saldo OC (Ley 19.983)</button>
                </div>
                <button type="button" class="btn btn-outline btn-sm" id="oxf-ap-editar">Editar acta / fecha</button>
            </div>
            <div class="oxf-acta-preview-scroll" id="oxf-ap-cont">${htmlOficial}</div>
            <div class="cierre-acciones">
                <button type="button" class="btn btn-outline" id="oxf-ap-no">Cerrar</button>
                <button type="button" class="btn btn-outline" id="oxf-ap-print">Imprimir</button>
                <button type="button" class="btn btn-outline" id="oxf-ap-pdf">Saldo OC (PDF)</button>
                <button type="button" class="btn btn-outline" id="oxf-ap-rc-word">Descargar Word (.docx)</button>
                <button type="button" class="btn btn-primary" id="oxf-ap-rc-oficial">Descargar PDF Oficial</button>
            </div>`, 'oxf-modal-xl');

        ov.querySelectorAll('.oxf-pill').forEach(b => b.addEventListener('click', () => {
            vistaActual = b.dataset.v;
            ov.querySelectorAll('.oxf-pill').forEach(x => x.classList.toggle('on', x.dataset.v === vistaActual));
            ov.querySelector('#oxf-ap-cont').innerHTML = vistaActual === 'oficial' ? htmlOficial : htmlDetallada;
        }));
        ov.querySelector('#oxf-ap-editar').addEventListener('click', () => { ov.remove(); abrirModalRecepcionConforme(factura); });
        ov.querySelector('#oxf-ap-no').addEventListener('click', () => ov.remove());
        ov.querySelector('#oxf-ap-print').addEventListener('click', () => imprimirActaRC(vistaActual === 'oficial' ? htmlOficial : htmlDetallada, `RC ${factura.numeroOC || factura.folio}`));
        ov.querySelector('#oxf-ap-pdf').addEventListener('click', () => descargarActaRCPDF(factura, pv, pres, estPres));
        ov.querySelector('#oxf-ap-rc-word').addEventListener('click', async () => {
            const b = ov.querySelector('#oxf-ap-rc-word'); b.disabled = true;
            try { await descargarRCOficialCorporacionWord(factura, pv); }
            catch (e) { toast('Error Word', e.message || String(e), 'error'); }
            finally { b.disabled = false; }
        });
        ov.querySelector('#oxf-ap-rc-oficial').addEventListener('click', async () => {
            const b = ov.querySelector('#oxf-ap-rc-oficial'); b.disabled = true;
            try { await descargarRCOficialCorporacionPDF(factura, pv); }
            catch (e) { toast('Error PDF', e.message || String(e), 'error'); }
            finally { b.disabled = false; }
        });
    }

    // =========================================================================
    // 6. INFORME CONTABLE Y SEGUIMIENTO POR CORRELATIVO RCO-AAAA-NNNNN
    // =========================================================================

    const TIPOS_CONTABLES_OXI = {
        OXIGENO_PROVEEDOR: 'Proveedor oxígeno',
        OXIGENO_PRESUPUESTO: 'Presupuesto / OC oxígeno',
        OXIGENO_FACTURA: 'Factura / Guía oxígeno',
        OXIGENO_RC: 'Acta RC oxígeno (RCO)'
    };

    /** Filtra presupuestos, actas/facturas y bitácora contable de oxígeno por cualquier término (RCO, OC, folio, proveedor, RUT, acción). */
    function filtrarContable(datos, consulta) {
        const q = String(consulta || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const provs = (datos && datos.proveedores) || [];
        const press = (datos && datos.presupuestos) || [];
        const facts = (datos && datos.facturas) || [];
        const movs = (datos && datos.movimientos) || [];
        const provDe = (id) => provs.find(p => p.id === id);
        const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

        const actas = facts.filter(f => {
            if (!q) return true;
            const pv = provDe(f.proveedorId);
            const rc = f.recepcionConforme || {};
            const txt = norm([rc.numeroActa, f.folio, f.numeroOC, f.facturaSAP, f.reemplazaFactura, f.periodoServicio, f.tipoServicio, f.fuenteFinanciamiento, rc.tipoRecepcion, rc.fecha, rc.contraparte, pv && pv.razonSocial, pv && pv.rut, ...(f.items || []).map(i => i.descripcion)].join(' '));
            return txt.includes(q);
        });
        const presupuestosFil = press.filter(b => {
            if (!q) return true;
            const pv = provDe(b.proveedorId);
            const txt = norm([b.numeroOC, b.nombreContrato, b.conceptoPermitido, b.tipoMonto, b.estado, pv && pv.razonSocial, pv && pv.rut].join(' '));
            return txt.includes(q);
        });
        const movimientosFil = movs.filter(m => {
            if (!q) return true;
            const txt = norm([m.type, TIPOS_CONTABLES_OXI[m.type], m.document, m.actaId, m.insumoName, m.observacion, m.origin, m.dest, m.user, m.accion].join(' '));
            return txt.includes(q);
        });
        return { actas, presupuestos: presupuestosFil, movimientos: movimientosFil };
    }

    /** Genera CSV contable (Excel) con Presupuestos OC, Actas RC (correlativo RCO) y Bitácora de cambios. */
    function csvContableOxigeno(datos) {
        const celda = (v) => { const t = String(v == null ? '' : v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        const provs = (datos && datos.proveedores) || [];
        const press = (datos && datos.presupuestos) || [];
        const facts = (datos && datos.facturas) || [];
        const movs = (datos && datos.movimientos) || [];
        const provDe = (id) => provs.find(p => p.id === id);

        const secPres = [
            ['OXÍGENO — PRESUPUESTOS Y ÓRDENES DE COMPRA'],
            ['OC', 'Contrato', 'Proveedor', 'RUT', 'Concepto', 'Tipo Monto', 'Tope', 'Ejecutado OC', 'Saldo Disponible', '% Consumido', 'Caja Chica', 'Estado'],
            ...press.map(b => {
                const pv = provDe(b.proveedorId);
                const est = calcularEstadoPresupuesto(b, facts);
                return [b.numeroOC, b.nombreContrato || '', pv ? pv.razonSocial : '', pv ? pv.rut : '', b.conceptoPermitido, b.tipoMonto, est.presupuestoBase, est.ejecutadoOC, est.saldoDisponible, est.porcentajeTexto, est.totalCajaChica, b.estado];
            })
        ];
        const secActas = [
            [],
            ['OXÍGENO — FACTURAS, GUÍAS Y ACTAS DE RECEPCIÓN CONFORME (RCO)'],
            ['Correlativo RC', 'Tipo RC', 'Fecha RC', 'Contraparte', 'Tipo Doc', 'Folio', 'OC', 'Proveedor', 'RUT', 'Período', 'Servicio', 'Fuente', 'Neto', 'IVA', 'Total Bruto', 'Imputado OC', 'Caja Chica', 'Reemplaza', 'Estado'],
            ...facts.map(f => {
                const pv = provDe(f.proveedorId);
                const rc = f.recepcionConforme || {};
                return [rc.numeroActa || 'PENDIENTE', rc.emitida ? (rc.tipoRecepcion || 'PARCIAL') : '', rc.fecha || '', rc.contraparte || '', f.tipoDocumento === 'GUIA_DESPACHO' ? 'GUIA' : 'FACTURA', f.folio, f.numeroOC || '', pv ? pv.razonSocial : '', pv ? pv.rut : '', f.periodoServicio || '', f.tipoServicio || '', f.fuenteFinanciamiento || '', num(f.neto), num(f.iva), num(f.totalBruto), num(f.montoImputadoOC), num(f.montoCajaChica), f.reemplazaFactura || '', f.estado || 'VIGENTE'];
            })
        ];
        const secMovs = movs.length ? [
            [],
            ['OXÍGENO — BITÁCORA CONTABLE DE CAMBIOS (PROVEEDORES, PRESUPUESTOS, FACTURAS Y ACTAS)'],
            ['Fecha', 'Tipo', 'Correlativo / Doc', 'Proveedor', 'OC', 'Monto', 'Responsable', 'Detalle'],
            ...movs.map(m => [m._fechaTxt || '', TIPOS_CONTABLES_OXI[m.type] || m.type, m.actaId || m.document || '', m.origin || '', m.dest || '', num(m.quantity), m.user || '', m.observacion || ''])
        ] : [];
        return '\ufeff' + [...secPres, ...secActas, ...secMovs].map(r => r.map(celda).join(';')).join('\r\n');
    }

    let audQ = '', audMovs = [], audCargando = false, audCargado = false;

    async function cargarDatosContable() {
        await cargarDatos();
        const f = fs(), d = db();
        if (!f || !d) return { proveedores, presupuestos, facturas, movimientos: [] };
        try {
            const sn = await f.getDocs(f.query(f.collection(d, 'Historial_Movimientos'), f.where('modulo', '==', 'OXIGENO_FACTURACION'), f.limit(400)));
            audMovs = [];
            sn.forEach(doc => {
                const m = doc.data();
                const ms = m.date && m.date.toDate ? m.date.toDate().getTime() : (Date.parse(m.date) || 0);
                audMovs.push({ ...m, _ms: ms, _fechaTxt: ms ? new Date(ms).toLocaleString('es-CL') : '' });
            });
            audMovs.sort((a, b) => b._ms - a._ms);
        } catch (e) {
            audMovs = [];
        }
        audCargado = true;
        return { proveedores, presupuestos, facturas, movimientos: audMovs };
    }

    /** Busca un acta RCO-AAAA-NNNNN por su correlativo exacto (usado también en Seguimiento de un acta). */
    async function buscarActaRCO(correlativo) {
        const c = String(correlativo || '').trim().toUpperCase();
        if (!/^RCO-\d{4}-\d{4,6}$/.test(c)) return null;
        const datos = await cargarDatosContable();
        const fac = datos.facturas.find(f => f.recepcionConforme && String(f.recepcionConforme.numeroActa || '').toUpperCase() === c);
        if (!fac) return { vacio: true, correlativo: c };
        const prov = datos.proveedores.find(p => p.id === fac.proveedorId) || null;
        const pres = datos.presupuestos.find(b => b.id === fac.presupuestoId) || null;
        const movs = datos.movimientos.filter(m => String(m.actaId || m.document || '').toUpperCase() === c || String(m.folio || '') === String(fac.folio));
        return { vacio: false, correlativo: c, factura: fac, proveedor: prov, presupuesto: pres, movimientos: movs };
    }

    /** Sección embebida en Auditoría → Contable (saldos-contables.js) con barra de búsqueda de RCO, presupuestos y bitácora. */
    async function pintarContable(el) {
        if (!el) return;
        if (!audCargado && !audCargando) {
            audCargando = true;
            el.innerHTML = '<h3 class="act-h" style="margin-top:24px;">Oxígeno — Informe Contable, Presupuestos y Actas RC (RCO)</h3><p class="act-hint">Cargando registros contables de oxígeno…</p>';
            try { await cargarDatosContable(); } finally { audCargando = false; }
            if (!el.isConnected) return;
        }
        const datos = { proveedores, presupuestos, facturas, movimientos: audMovs };
        const fil = filtrarContable(datos, audQ);
        const totalEmitidas = facturas.filter(f => f.recepcionConforme && f.recepcionConforme.emitida).length;

        el.innerHTML = `
        <div class="oxf-aud-sec" style="margin-top:26px;">
            <h3 class="act-h">Oxígeno — Informe Contable, Presupuestos y Actas RC (RCO)</h3>
            <p class="act-hint">Cada acta de recepción conforme de oxígeno lleva correlativo propio (<b>RCO-AAAA-NNNNN</b>) y todo cambio en proveedores, presupuestos/OC, facturas o actas queda registrado aquí.</p>
            <div class="sal-barra">
                <input id="oxf-aud-q" type="search" class="form-control" placeholder="Buscar RCO-2026-…, OC, folio, proveedor, RUT o cambio…" value="${esc(audQ)}" autocomplete="off" style="max-width:360px">
                <button type="button" class="btn btn-outline" id="oxf-aud-ref">Actualizar</button>
                <button type="button" class="btn btn-outline" id="oxf-aud-csv">Descargar Contable Oxígeno (Excel)</button>
                <span class="oxf-count">${totalEmitidas} acta(s) RCO · ${presupuestos.length} OC · ${audMovs.length} evento(s)</span>
            </div>

            <h4 class="act-h4" style="margin-top:12px;">Actas de Recepción Conforme (RCO) y Facturas / Guías (${fil.actas.length})</h4>
            <div class="oxf-tabla-wrap">
                <table class="soc-tabla oxf-tabla">
                    <thead><tr><th>Correlativo RC</th><th>Documento / OC</th><th>Proveedor</th><th>Fecha RC / Período</th><th class="num">Total</th><th>Acciones</th></tr></thead>
                    <tbody>
                        ${fil.actas.length ? fil.actas.slice(0, 100).map(f => {
                            const pv = proveedores.find(p => p.id === f.proveedorId);
                            const rc = f.recepcionConforme || {};
                            return `<tr>
                                <td>${rc.emitida ? `<b>${esc(rc.numeroActa)}</b><small class="oxf-sub">RC ${esc(rc.tipoRecepcion === 'TOTAL' ? 'Total' : 'Parcial')} · ${esc(rc.contraparte || '')}</small>` : '<span class="oxf-badge oxf-b-pend">Pendiente RC</span>'}</td>
                                <td><b>${f.tipoDocumento === 'GUIA_DESPACHO' ? 'Guía' : 'Factura'} ${esc(f.folio)}</b><small class="oxf-sub">OC ${esc(f.numeroOC || '—')}${f.reemplazaFactura ? ' · Reemplaza ' + esc(f.reemplazaFactura) : ''}</small></td>
                                <td>${esc(pv ? pv.razonSocial : '—')}<small class="oxf-sub">${esc(pv ? pv.rut : '')}</small></td>
                                <td>${rc.emitida ? esc(fechaCL(rc.fecha)) : '—'}<small class="oxf-sub">${esc(fmtPeriodo(f.periodoServicio))}</small></td>
                                <td class="num"><b>${clp(f.totalBruto)}</b><small class="oxf-sub">${f.fuenteFinanciamiento === 'CAJA_CHICA' ? 'Caja Chica ' + clp(f.montoCajaChica) : 'OC ' + clp(f.montoImputadoOC)}</small></td>
                                <td class="oxf-cell-acc">
                                    <button type="button" class="btn btn-outline btn-sm oxf-aud-ed" data-id="${esc(f.id)}">${rc.emitida ? 'Editar acta' : 'Emitir RC'}</button>
                                    <button type="button" class="btn btn-primary btn-sm oxf-aud-pdf" data-id="${esc(f.id)}">PDF</button>
                                    <button type="button" class="btn btn-outline btn-sm oxf-aud-word" data-id="${esc(f.id)}">Word</button>
                                </td>
                            </tr>`;
                        }).join('') : '<tr><td colspan="6" class="oxf-td-vacio">Sin actas o facturas de oxígeno con ese filtro.</td></tr>'}
                    </tbody>
                </table>
            </div>

            <h4 class="act-h4" style="margin-top:16px;">Estado Contable de Presupuestos / OC de Oxígeno (${fil.presupuestos.length})</h4>
            <div class="oxf-tabla-wrap">
                <table class="soc-tabla oxf-tabla">
                    <thead><tr><th>OC / Contrato</th><th>Proveedor</th><th>Concepto</th><th class="num">Tope</th><th class="num">Ejecutado OC</th><th class="num">Saldo</th><th class="num">Caja Chica</th></tr></thead>
                    <tbody>
                        ${fil.presupuestos.length ? fil.presupuestos.map(b => {
                            const pv = proveedores.find(p => p.id === b.proveedorId);
                            const est = calcularEstadoPresupuesto(b, facturas);
                            return `<tr>
                                <td><b>${esc(b.numeroOC)}</b><small class="oxf-sub">${esc(b.nombreContrato || '')}</small></td>
                                <td>${esc(pv ? pv.razonSocial : '—')}<small class="oxf-sub">${esc(pv ? pv.rut : '')}</small></td>
                                <td><span class="oxf-badge oxf-b-tipo">${esc(b.conceptoPermitido)}</span> <span class="oxf-badge ${b.estado === 'CERRADO' ? 'oxf-b-hist' : 'oxf-b-act'}">${esc(b.estado)}</span></td>
                                <td class="num">${clp(est.presupuestoBase)}</td>
                                <td class="num"><b>${clp(est.ejecutadoOC)}</b> <small>(${esc(est.porcentajeTexto)})</small></td>
                                <td class="num">${clp(est.saldoDisponible)}</td>
                                <td class="num">${clp(est.totalCajaChica)}</td>
                            </tr>`;
                        }).join('') : '<tr><td colspan="7" class="oxf-td-vacio">Sin presupuestos de oxígeno con ese filtro.</td></tr>'}
                    </tbody>
                </table>
            </div>

            <h4 class="act-h4" style="margin-top:16px;">Bitácora Contable de Cambios de Oxígeno (${fil.movimientos.length})</h4>
            <div class="oxf-tabla-wrap">
                <table class="soc-tabla oxf-tabla">
                    <thead><tr><th>Fecha</th><th>Tipo</th><th>Correlativo / Doc</th><th>Detalle del cambio</th><th>Responsable</th></tr></thead>
                    <tbody>
                        ${fil.movimientos.length ? fil.movimientos.slice(0, 120).map(m => `<tr>
                            <td>${esc(m._fechaTxt || '—')}</td>
                            <td><span class="oxf-badge oxf-b-hist">${esc(TIPOS_CONTABLES_OXI[m.type] || m.type)}</span></td>
                            <td><code>${esc(m.actaId || m.document || '—')}</code></td>
                            <td>${esc(m.observacion || m.insumoName || '')}</td>
                            <td>${esc(m.user || '')}</td>
                        </tr>`).join('') : '<tr><td colspan="5" class="oxf-td-vacio">Sin cambios registrados aún en la bitácora contable de oxígeno.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>`;

        const qInp = el.querySelector('#oxf-aud-q');
        if (qInp) qInp.addEventListener('input', () => {
            audQ = qInp.value;
            const pos = qInp.selectionStart;
            pintarContable(el);
            const n = el.querySelector('#oxf-aud-q');
            if (n) { n.focus(); n.setSelectionRange(pos, pos); }
        });
        const bRef = el.querySelector('#oxf-aud-ref');
        if (bRef) bRef.addEventListener('click', async () => { audCargado = false; await pintarContable(el); });
        const bCsv = el.querySelector('#oxf-aud-csv');
        if (bCsv) bCsv.addEventListener('click', () => {
            const blob = new Blob([csvContableOxigeno(datos)], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `Contable_Oxigeno_${hoyISO()}.csv`;
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        });
        el.querySelectorAll('.oxf-aud-ed').forEach(b => b.addEventListener('click', () => {
            const fac = facturas.find(x => x.id === b.dataset.id);
            if (fac) abrirModalRecepcionConforme(fac);
        }));
        el.querySelectorAll('.oxf-aud-pdf').forEach(b => b.addEventListener('click', async () => {
            const fac = facturas.find(x => x.id === b.dataset.id);
            if (!fac) return;
            const pv = proveedores.find(p => p.id === fac.proveedorId);
            b.disabled = true;
            try { await descargarRCOficialCorporacionPDF(fac, pv); }
            catch (e) { toast('Error PDF', e.message || String(e), 'error'); }
            finally { b.disabled = false; }
        }));
        el.querySelectorAll('.oxf-aud-word').forEach(b => b.addEventListener('click', async () => {
            const fac = facturas.find(x => x.id === b.dataset.id);
            if (!fac) return;
            const pv = proveedores.find(p => p.id === fac.proveedorId);
            b.disabled = true;
            try { await descargarRCOficialCorporacionWord(fac, pv); }
            catch (e) { toast('Error Word', e.message || String(e), 'error'); }
            finally { b.disabled = false; }
        }));
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
        pintarContable,
        cargarDatos,
        cargarDatosContable,
        buscarActaRCO,
        cargarSemillaIndura,
        // Funciones puras para pruebas unitarias
        construirEventoContable,
        filtrarContable,
        csvContableOxigeno,
        parsearXmlDte,
        parsearTextoFacturaOcr,
        parsearIndura,
        parsearComercialVR,
        parsearWelding,
        construirBloquesRC,
        bloquesRCTexto,
        parsearTextoBloquesRC,
        normalizarRespuestaIA,
        detectarTipoServicio,
        detectarPeriodoServicio,
        fechaAISO,
        validarFactura,
        validarEliminacionProveedor,
        calcularEstadoPresupuesto,
        simularImputacion,
        datosSemillaIndura,
        construirHtmlRCOficial,
        construirCuerpoWordRC,
        construirHtmlActaRC,
        fmtRut,
        RECINTO_BASE,
        CONTRAPARTE_BASE
    };

    if (typeof window !== 'undefined') window.SAR_OxiFacturacion = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: { dataset: {} } });
