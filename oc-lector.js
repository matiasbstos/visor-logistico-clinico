/* ==========================================================================
   LECTOR DE DOCUMENTOS (v20.39) — "Orden de compra de Mercado Público" (PDF)
   --------------------------------------------------------------------------
   Cada tipo de documento tiene su propio lector, porque cada emisor (Mercado Público,
   cada proveedor para guías y facturas) distribuye la información distinto. Un lector:
     1. reconoce el documento (`reconoce(texto)`),
     2. extrae los datos (`extraer(items)`) y
     3. NUNCA guarda nada solo: el resultado se muestra en una pantalla de revisión
        donde la persona corrige y confirma.
   Hoy: OC_MP (orden de compra de Mercado Público). Guías/facturas se agregan después
   como nuevos lectores en `LECTORES`.

   Entrada de `extraer`: elementos de texto del PDF [{str, x, y}] con y creciente hacia abajo
   (así los entrega `leerArchivo`, que usa pdf.js desde cdnjs).
   ========================================================================== */
(function (window, document) {
    'use strict';

    const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const TOL = 3.5;                       // tolerancia vertical para considerar "la misma línea"
    const monto = (s) => { const t = String(s == null ? '' : s).replace(/[^\d,.-]/g, ''); if (!t) return 0; return Number(t.replace(/\./g, '').replace(',', '.')) || 0; };
    const limpiar = (s) => String(s || '').replace(/\s+/g, ' ').trim();

    /** Agrupa elementos en líneas de texto [{y, x, texto, items}] ordenadas. */
    function lineas(items) {
        const orden = [...items].filter(i => limpiar(i.str)).sort((a, b) => a.y - b.y || a.x - b.x);
        const out = [];
        for (const it of orden) {
            const l = out.find(o => Math.abs(o.y - it.y) <= TOL);
            if (l) { l.items.push(it); } else out.push({ y: it.y, items: [it] });
        }
        out.forEach(l => { l.items.sort((a, b) => a.x - b.x); l.x = l.items[0].x; l.texto = limpiar(l.items.map(i => i.str).join(' ')); });
        return out.sort((a, b) => a.y - b.y);
    }
    const fechaISO = (dmy) => { const m = /(\d{2})-(\d{2})-(\d{4})/.exec(dmy || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };

    // ------------------------------------------------------------------
    // Lector: Orden de compra de Mercado Público
    // ------------------------------------------------------------------
    function reconoceOC(texto) { return /ORDEN DE COMPRA/i.test(texto) && /N°\s*:?\s*\d+-\d+-[A-Z]{2}\d{2}/.test(texto) && /Cantidad/.test(texto); }

    function extraerOC(items) {
        const L = lineas(items), T = L.map(l => l.texto), todo = T.join('\n');
        const dato = (re) => { const m = re.exec(todo); return m ? limpiar(m[1]) : ''; };
        const r = { tipo: 'OC_MP', avisos: [] };
        r.numeroOC = dato(/N°\s*:?\s*(\d+-\d+-[A-Z]{2}\d{2})/);
        const iProv = T.findIndex(t => /SEÑOR\s*\(ES\)/i.test(t));
        r.proveedor = iProv >= 0 ? limpiar(T[iProv].replace(/^.*SEÑOR\s*\(ES\)\s*:?/i, '')) : '';
        const rutProv = iProv >= 0 ? /(\d{1,2}\.\d{3}\.\d{3}-[\dkK])/.exec(T.slice(iProv + 1, iProv + 5).join(' ')) : null;
        r.rutProveedor = rutProv ? rutProv[1] : '';
        const fe = /Fecha\s*Envio\s*OC\.?\s*:?\s*(\d{2}-\d{2}-\d{4})(?:\s+(\d{2}:\d{2})(?::\d{2})?)?/i.exec(todo);
        r.emitida = fe ? fechaISO(fe[1]) : ''; r.emitidaHora = fe && fe[2] ? fe[2] : '';
        r.estadoMP = dato(/Estado\s*:\s*([^\n]+)/);
        r.unidadCompra = dato(/Unidad de Compra\s*:\s*([^\n]+)/);
        r.direccionDespacho = dato(/DIRECCION DE DESPACHO\s*:\s*([^\n]+)/);
        r.formaPago = dato(/FORMA DE PAGO\s*:\s*([^\n]+)/);
        r.emailFactura = dato(/EMAIL ENVIO FACTURA\s*:\s*(\S+@\S+)/);
        r.fuenteFinanciamiento = dato(/Fuente Financiamento\s*:\s*(\S+)/);
        r.memo = dato(/MEMO\s*N\s*[°º]?\s*(\d+)/);
        r.descripcion = dato(/MEMO\s*N\s*[°º]?\s*\d+\s*-\s*([^\n]+)/);
        r.contraparte = dato(/CONTRAPARTE TECNICA\s*:\s*([^\n]+)/);
        r.contacto = dato(/CONTACTO\s*:\s*([^\n]+)/);
        r.horario = dato(/HORARIO\s*:\s*([^\n]+)/);
        r.convenioMarco = /convenio marco/i.test(todo) || /-CM\d{2}$/.test(r.numeroOC);
        // Totales (líneas "Neto $ 620.640", "Total $ 738.562")
        const tot = (palabra) => {
            const re = new RegExp('^' + palabra + '$', 'i');
            for (const l of L) { const k = l.items.findIndex(i => i.x > 380 && re.test(limpiar(i.str))); if (k >= 0) { const resto = l.items.slice(k + 1).map(i => limpiar(i.str)).filter(t => /^[\d.,]+$/.test(t)); if (resto.length) return monto(resto[resto.length - 1]); } }
            return 0;
        };
        r.totalNeto = tot('Neto'); r.iva = tot('19% IVA'); r.total = tot('Total');

        // --- Tabla de productos: columnas según el encabezado ---
        const h = (re) => { for (const l of L) for (const i of l.items) if (re.test(limpiar(i.str))) return i; return null; };
        const hProd = h(/^Producto$/), hCant = h(/^Cantidad$/);
        const hEsp = L.flatMap(l => l.items).filter(i => /^Especificaciones$/.test(limpiar(i.str)) && hCant && Math.abs(i.y - hCant.y) <= TOL).sort((a, b) => a.x - b.x);
        const hPrecio = h(/^Precio$/), hTotal = h(/Valor Total/);
        if (!hProd || !hCant || !hPrecio || !hTotal) { r.avisos.push('No se reconoció la tabla de productos: ingrésalos a mano.'); r.lineas = []; return r; }
        const yH = Math.max(hCant.y, hPrecio.y, hTotal.y) + 18;          // bajo las dos líneas del encabezado
        const finTabla = L.find(l => l.y > yH && l.items.some(i => /^Orden de Compra/.test(limpiar(i.str)) && i.x > 250));
        const yFin = finTabla ? finTabla.y - 1 : Infinity;
        const xProd = hProd.x, xCant = hCant.x, xEspC = hEsp[0] ? hEsp[0].x : xCant + 45, xPrecio = hPrecio.x - 12;
        const enTabla = items.filter(i => i.y >= yH - 12 && i.y < yFin && limpiar(i.str));
        // Filas: cada cantidad entera en la columna "Cantidad" inicia un producto
        const starts = enTabla.filter(i => i.x >= xCant - 6 && i.x < xEspC - 6 && /^\d+$/.test(limpiar(i.str)) && i.y >= yH - 12).sort((a, b) => a.y - b.y);
        r.lineas = starts.map((s, k) => {
            const y0 = s.y - TOL, y1 = k + 1 < starts.length ? starts[k + 1].y - TOL : yFin;
            const fila = enTabla.filter(i => i.y >= y0 && i.y < y1);
            const col = (xa, xb) => fila.filter(i => i.x >= xa && i.x < xb).sort((a, b) => a.y - b.y || a.x - b.x);
            const xEspP = hEsp[1] ? hEsp[1].x : xEspC + 93;
            const comprador = limpiar(col(xEspC - 4, xEspP - 4).map(i => i.str).join(' '));
            const col0 = col(0, xProd - 4).map(i => limpiar(i.str));
            const cod = /^\((\d{4,9})\)\s*/.exec(comprador);
            const nums = fila.filter(i => i.x >= xPrecio && Math.abs(i.y - s.y) <= TOL + 1).sort((a, b) => a.x - b.x).map(i => limpiar(i.str)).filter(t => /^[\d.,]+$/.test(t));
            const producto = limpiar(col(xProd - 4, xCant - 4).map(i => i.str).join(' '));
            const desc = limpiar(comprador.replace(/^\(\d+\)\s*/, '')) || producto;
            const cantidad = Number(limpiar(s.str));
            const precio = monto(nums[0]), valor = monto(nums[nums.length - 1]);
            const linea = { descripcion: desc, codigoMP: cod ? cod[1] : '', licitacion: col0.find(t => /^\d+-\d+-[A-Z]+\d+$/.test(t)) || '', cantidad, valorNeto: precio, totalLinea: valor };
            if (precio && valor && Math.round(precio * cantidad) !== Math.round(valor)) r.avisos.push(`Línea "${desc.slice(0, 40)}": cantidad × precio (${Math.round(precio * cantidad).toLocaleString('es-CL')}) no coincide con el valor total (${valor.toLocaleString('es-CL')}). Revísala.`);
            return linea;
        });
        if (!r.lineas.length) r.avisos.push('No se detectaron productos: ingrésalos a mano.');
        const suma = r.lineas.reduce((t, l) => t + (l.totalLinea || 0), 0);
        if (r.totalNeto && suma && suma !== r.totalNeto) r.avisos.push(`La suma de las líneas (${suma.toLocaleString('es-CL')}) no coincide con el neto de la orden (${r.totalNeto.toLocaleString('es-CL')}).`);
        ['numeroOC', 'proveedor', 'emitida'].forEach(k => { if (!r[k]) r.avisos.push(`No se encontró: ${({ numeroOC: 'N° de orden', proveedor: 'proveedor', emitida: 'fecha de envío' })[k]}.`); });
        return r;
    }

    /** Lee el correo pegado (opcional): plazo de aceptación y de entrega. */
    function extraerCorreo(texto) {
        const t = String(texto || ''), out = {};
        let m = /plazo\s+para\s+aceptar[^:]*:\s*(\d+)\s*horas?/i.exec(t); if (m) out.aceptarHoras = Number(m[1]);
        m = /(?:d[ií]as\s+de\s+entrega)[^:]*:\s*(\d+)\s*d[ií]as?\s*h[aá]biles?/i.exec(t) || /entrega[^.\n]{0,40}?(\d+)\s*d[ií]as?\s*h[aá]biles?/i.exec(t); if (m) out.entregaDias = Number(m[1]);
        m = /contraparte\s+t[eé]cnica\s*:?\s*([^\n.]+)/i.exec(t); if (m) out.contraparte = limpiar(m[1]);
        m = /horario\s*:?\s*([^\n]+)/i.exec(t); if (m) out.horario = limpiar(m[1]);
        return out;
    }

    const LECTORES = { OC_MP: { nombre: 'Orden de compra (Mercado Público)', reconoce: reconoceOC, extraer: extraerOC } };
    function detectar(items) { const txt = lineas(items).map(l => l.texto).join('\n'); return Object.keys(LECTORES).find(k => LECTORES[k].reconoce(txt)) || null; }
    function leer(items) {
        const k = detectar(items);
        if (!k) throw new Error('No reconozco este documento. Por ahora solo leo órdenes de compra de Mercado Público; puedes ingresar los datos a mano.');
        return LECTORES[k].extraer(items);
    }

    // ------------------------------------------------------------------
    // Navegador: carga de pdf.js y extracción de elementos con posición
    // ------------------------------------------------------------------
    let pdfjsP = null;
    function cargarPdfJs() {
        if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return Promise.resolve(window.pdfjsLib); }
        if (!pdfjsP) pdfjsP = new Promise((ok, mal) => {
            const s = document.createElement('script'); s.src = PDFJS_URL;
            s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; ok(window.pdfjsLib); };
            s.onerror = () => { pdfjsP = null; mal(new Error('No se pudo cargar el lector de PDF (revisa tu conexión).')); };
            document.head.appendChild(s);
        });
        return pdfjsP;
    }
    async function itemsDePDF(buffer) {
        const lib = await cargarPdfJs();
        const pdf = await lib.getDocument({ data: buffer }).promise;
        const out = []; let offset = 0;
        for (let p = 1; p <= Math.min(pdf.numPages, 6); p++) {
            const page = await pdf.getPage(p), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
            tc.items.forEach(i => { if (i.str && i.str.trim()) out.push({ str: i.str, x: i.transform[4], y: offset + (vp.height - i.transform[5]) }); });
            offset += vp.height + 20;
        }
        return out;
    }
    async function leerArchivo(file) { return leer(await itemsDePDF(await file.arrayBuffer())); }

    window.SAR_Lector = { leer, leerArchivo, detectar, extraerOC, extraerCorreo, lineas, LECTORES };
    if (typeof module !== 'undefined') module.exports = window.SAR_Lector;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
