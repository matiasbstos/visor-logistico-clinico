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
        // "MEMO N°36-68-5 - COMPRA DE INSUMOS…": puede traer varios memos (uno por centro/CDP) y a veces está en la 2.ª hoja
        const mm = /MEMO\s*N\s*[°º]?\s*(\d+(?:\s*[-,/y]\s*\d+)*)(?:\s*-\s*([^\n]+))?/i.exec(todo);
        r.memos = mm ? mm[1].split(/\s*[-,/y]\s*/).filter(Boolean) : [];
        r.memo = r.memos.join('-');
        r.descripcion = mm && mm[2] ? limpiar(mm[2]) : '';
        r.contraparte = dato(/CONTRAPARTE TECNICA\s*:\s*([^\n]+)/);
        r.contacto = dato(/CONTACTO\s*:\s*([^\n]+)/);
        r.horario = dato(/HORARIO\s*:\s*([^\n]+)/);
        r.convenioMarco = /convenio marco/i.test(todo) || /-CM\d{2}$/.test(r.numeroOC);
        // Totales (líneas "Neto $ 620.650", "Total $ 738.562")
        const tot = (palabra) => {
            const re = new RegExp('^' + palabra + '$', 'i');
            for (const l of L) { const k = l.items.findIndex(i => i.x > 380 && re.test(limpiar(i.str))); if (k >= 0) { const resto = l.items.slice(k + 1).map(i => limpiar(i.str)).filter(t => /^[\d.,]+$/.test(t)); if (resto.length) return monto(resto[resto.length - 1]); } }
            return 0;
        };
        r.totalNeto = tot('Neto'); r.iva = tot('19% IVA'); r.total = tot('Total');
        if (!r.iva && r.total && r.totalNeto) r.iva = r.total - r.totalNeto;

        // --- Tabla de productos: columnas según el encabezado ---
        const h = (re) => { for (const l of L) for (const i of l.items) if (re.test(limpiar(i.str))) return i; return null; };
        const hProd = h(/^Producto$/), hCant = h(/^Cantidad(\s*\/)?$/);
        const hEsp = L.flatMap(l => l.items).filter(i => /^Especificaciones$/.test(limpiar(i.str)) && hCant && Math.abs(i.y - hCant.y) <= TOL).sort((a, b) => a.x - b.x);
        const hPrecio = h(/^Precio$/), hTotal = h(/Valor Total/);
        if (!hProd || !hCant || !hPrecio || !hTotal) { r.avisos.push('No se reconoció la tabla de productos: ingrésalos a mano.'); r.lineas = []; return r; }
        const yH = Math.max(hCant.y, hPrecio.y, hTotal.y) + 18;          // bajo las dos líneas del encabezado
        const finTabla = L.find(l => l.y > yH && l.items.some(i => /^Orden de Compra/.test(limpiar(i.str)) && i.x > 250));
        const finNeto = L.find(l => l.y > yH && l.items.some(i => /^Neto$/i.test(limpiar(i.str)) && i.x > 380));   // formato "compra ágil": sin pie "Orden de Compra…"
        const yFin = finTabla ? finTabla.y - 1 : finNeto ? finNeto.y - 2 : Infinity;
        const xProd = hProd.x, xCant = hCant.x, xEspC = hEsp[0] ? hEsp[0].x : xCant + 45, xPrecio = hPrecio.x - 12;
        const enTabla = items.filter(i => i.y >= yH - 12 && i.y < yFin && limpiar(i.str));
        // Filas: cada cantidad entera en la columna "Cantidad" inicia un producto
        const starts = enTabla.filter(i => i.x >= xCant - 6 && i.x < xEspC - 6 && /^\d+(\s+[A-Za-zÁÉÍÓÚáéíóú.]+)?$/.test(limpiar(i.str)) && i.y >= yH - 12).sort((a, b) => a.y - b.y);
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
            const recorte = (t) => limpiar(String(t).replace(/\s*(PRESUPUESTO\s+(M[AÁ]XIMO|DISPONIBLE)|\*\s*EL PROVEEDOR).*$/i, ''));   // quita las notas de presupuesto de la compra ágil
            const desc = recorte(limpiar(comprador.replace(/^\(\d+\)\s*/, ''))) || producto;
            const cantidad = Number(limpiar(s.str).split(/\s+/)[0]);
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


    // ------------------------------------------------------------------
    // Lector: "Cuadro de distribución" de la orden (PDF, tabla apaisada)  — v20.55
    // Columnas = memo/centro (cada una con su financiamiento y CDP). Se leen por posición:
    // las columnas de cantidades salen del encabezado "CANTIDAD"; las filas de datos, de las etiquetas
    // de la izquierda (FINANCIAMIENTO, CDP, NETO, IVA, TOTAL, DIRECCIÓN, CONTRAPARTE, CONTACTO, CORREO, HORARIO).
    // ------------------------------------------------------------------
    const entero = (s) => Number(String(s || '').replace(/[^\d]/g, '')) || 0;
    function reconoceDistribucion(texto) { return /MEMO\s*N\s*[°º]?\s*\d+/i.test(texto) && /\bCDP\b/.test(texto) && /CANTIDAD/i.test(texto) && (/FINANCIAMIENTO/i.test(texto) || (/PRESUPUESTO/i.test(texto) && /SALDO/i.test(texto))); }
    function extraerDistribucion(items) {
        const r = { tipo: 'DIST_OC', avisos: [], columnas: [], lineas: [] };
        const its = items.filter(i => limpiar(i.str));
        // 1) columnas de cantidades: los "CANTIDAD" de una misma fila; el que va solo (con "TOTAL" debajo) es el total
        // v21.176: las posiciones se calibran con el encabezado «VALOR NETO» (el cuadro puede venir corrido a la izquierda según el emisor)
        const vn = its.find(i => /^VALOR\s*NETO$/i.test(limpiar(i.str))), xMinCant = vn ? Math.min(330, vn.x + 40) : 330, xPrecio = vn ? Math.min(330, vn.x - 20) : 330;
        const cants = its.filter(i => /^CANTIDAD$/i.test(limpiar(i.str)) && i.x > xMinCant);
        const porY = []; cants.forEach(i => { const g = porY.find(o => Math.abs(o.y - i.y) <= TOL); if (g) g.items.push(i); else porY.push({ y: i.y, items: [i] }); });
        const gCols = porY.sort((a, b) => b.items.length - a.items.length)[0];
        if (!gCols || gCols.items.length < 1) { r.avisos.push('No encontré las columnas de cantidades (encabezado "CANTIDAD").'); return r; }
        const xs = gCols.items.map(i => i.x).sort((a, b) => a - b), CH = 19;                 // ≈ mitad del ancho del texto "CANTIDAD"
        const total = cants.filter(i => !gCols.items.includes(i)).sort((a, b) => b.x - a.x)[0];
        const xTotal = total ? total.x - 8 : xs[xs.length - 1] + 70;
        const centros = xs.map(x => x + CH), paso = xs.length > 1 ? centros[1] - centros[0] : 90;
        const lim = centros.map((c, k) => k === 0 ? c - paso / 2 : (centros[k - 1] + c) / 2); lim.push(xTotal);
        const banda = (x) => { for (let k = 0; k < centros.length; k++) if (x >= lim[k] && x < lim[k + 1]) return k; return -1; };
        const yEnc = gCols.y;
        // 2) etiquetas de la izquierda
        const ETQ = [['financiamiento', /^FINANCIAMIENTO$/i], ['cdp', /^CDP$/], ['neto', /^NETO$/], ['iva', /^IVA$/], ['total', /^TOTAL$/], ['direccion', /^DIRECCI[OÓ]N/i], ['contraparte', /^CONTRAPARTE/i], ['contacto', /^CONTACTO$/i], ['correo', /^(CORREO|EMAIL|E-MAIL)/i], ['horario', /^HORARIO/i]];
        const etiquetas = []; ETQ.forEach(([k, re]) => { const it = its.filter(i => i.x < lim[0] - 20 && i.x > 230 && re.test(limpiar(i.str)) && (k === 'cdp' ? i.y < yEnc : k === 'financiamiento' ? true : i.y > yEnc)).sort((a, b) => a.y - b.y)[0]; if (it) etiquetas.push({ k, y0: it.y, y1: it.y }); });
        etiquetas.sort((a, b) => a.y0 - b.y0);
        // etiquetas de dos líneas ("DIRECCION DE / DESPACHO"): su extensión llega hasta la última palabra de esa columna antes de la siguiente
        const izq = its.filter(i => i.x > 230 && i.x < lim[0] - 20 && i.y > yEnc);
        etiquetas.forEach((e, n) => { const sig = etiquetas[n + 1]; izq.forEach(i => { if (i.y > e.y1 && (!sig || i.y < sig.y0 - 3) && i.y - e.y1 < 20) e.y1 = i.y; }); });
        const sec = {};
        etiquetas.forEach((e, n) => {
            const ant = etiquetas[n - 1], sig = etiquetas[n + 1];
            const desde = ant && e.y0 - ant.y1 < 45 ? (ant.y1 + e.y0) / 2 : e.y0 - (e.k === 'neto' ? 9 : 18), hasta = sig ? (e.y1 + sig.y0) / 2 : e.y1 + 25;
            sec[e.k] = [e.k === 'cdp' ? Math.max(desde, (ant ? ant.y1 + e.y0 : 0) / 2) : desde, e.k === 'cdp' ? Math.min(hasta, yEnc - 8) : hasta];
        });
        const hastaEnc = [sec.financiamiento, sec.cdp].filter(Boolean).map(x => x[0]).filter(y => y < yEnc), encabezadoHasta = hastaEnc.length ? Math.min(...hastaEnc) : yEnc - 60;   // financiamiento puede ir arriba o al pie
        const ysEnc = its.filter(i => i.y < encabezadoHasta && banda(i.x) >= 0);
        const texto = (k, y0, y1, junta) => { const v = its.filter(i => i.y >= y0 && i.y < y1 && banda(i.x) === k).sort((a, b) => a.y - b.y || a.x - b.x).map(i => limpiar(i.str)); return limpiar(junta === '' ? v.join('').replace(/-\s+/g, '-') : v.join(' ')); };
        // 3) columnas
        const cols = centros.map((c, k) => {
            const cab = texto(k, 0, encabezadoHasta); // "MEMO N°68 CESFAM BORIS SOLER"
            const m = /MEMO\s*N\s*[°º]?\s*(\d+)\s*(.*)$/i.exec(cab);
            const col = { memo: m ? m[1] : '', centro: m ? limpiar(m[2]).toUpperCase() : '', _k: k };
            col.financiamiento = sec.financiamiento ? texto(k, sec.financiamiento[0], sec.financiamiento[1]) : '';
            const cdpTxt = sec.cdp ? texto(k, sec.cdp[0], sec.cdp[1], '') : '';
            col.cdps = (cdpTxt.match(/\d+/g) || []); col.cdp = col.cdps.join('-');
            ['neto', 'iva', 'total'].forEach(n => { col[n] = sec[n] ? entero(its.filter(i => i.y >= sec[n][0] && i.y < sec[n][1] && banda(i.x) === k && /\d/.test(i.str)).map(i => i.str).join('')) : 0; });
            col.direccion = sec.direccion ? texto(k, sec.direccion[0], sec.direccion[1]) : '';
            col.contraparte = sec.contraparte ? texto(k, sec.contraparte[0], sec.contraparte[1]) : '';
            col.contacto = sec.contacto ? texto(k, sec.contacto[0], sec.contacto[1]) : '';
            col.correo = sec.correo ? texto(k, sec.correo[0], sec.correo[1], '') : '';
            col.horario = sec.horario ? texto(k, sec.horario[0], sec.horario[1]) : '';
            return col;
        });
        // celdas combinadas (dirección, contraparte… de dos columnas del mismo centro; el horario suele abarcar todo): se heredan
        cols.forEach((c, k) => { if (k) ['direccion', 'contraparte', 'contacto', 'correo', 'horario'].forEach(f => { const p = cols[k - 1]; if (!c[f] && p[f] && (f === 'horario' || p.centro === c.centro)) c[f] = p[f]; }); });
        cols.forEach(c => { if (!c.memo) r.avisos.push(`No se leyó el memo de la columna ${c._k + 1}.`); c.key = `${slug(c.centro) || 'col' + (c._k + 1)}-${c.memo || c._k + 1}`; });
        // 4) filas de productos: cada ID (código MP) ancla una fila; el resto del texto se asigna a la fila más cercana
        const ids = its.filter(i => i.x < 100 && /^\d{5,9}$/.test(limpiar(i.str)) && i.y > yEnc + 8 && (!etiquetas[0] || i.y < (sec.neto ? sec.neto[0] : 1e9))).sort((a, b) => a.y - b.y);
        const yFinTabla = sec.neto ? sec.neto[0] : Infinity;
        const cercana = (y) => { let b = 0, d = Infinity; ids.forEach((x, n) => { const dd = Math.abs(x.y - y); if (dd < d) { d = dd; b = n; } }); return b; };
        const zona = its.filter(i => i.y > yEnc + 8 && i.y < yFinTabla);
        r.lineas = ids.map(() => ({ id: '', descripcion: [], valorNeto: 0, dist: {}, totalDeclarado: null }));
        ids.forEach((x, n) => { r.lineas[n].id = limpiar(x.str); });
        const xDesc = (ids.length ? Math.max(...ids.map(x => x.x)) : 75) + 25;
        zona.filter(i => i.x >= Math.min(100, xDesc) && i.x < xPrecio).sort((a, b) => a.y - b.y).forEach(i => { if (ids.length) r.lineas[cercana(i.y)].descripcion.push(limpiar(i.str)); });
        zona.filter(i => i.x >= xPrecio && i.x < lim[0] - 4 && /\d/.test(i.str)).forEach(i => { if (ids.length && !r.lineas[cercana(i.y)].valorNeto) r.lineas[cercana(i.y)].valorNeto = entero(i.str); });
        zona.filter(i => /^\d+$/.test(limpiar(i.str)) && i.x >= lim[0] - 4).forEach(i => {
            if (!ids.length) return; const l = r.lineas[cercana(i.y)], q = Number(limpiar(i.str)), k = banda(i.x);
            if (k >= 0) l.dist[cols[k].key] = (l.dist[cols[k].key] || 0) + q; else if (i.x >= xTotal) l.totalDeclarado = q;
        });
        r.lineas.forEach(l => { l.descripcion = limpiar(l.descripcion.join(' ')); });
        r.columnas = cols.map(({ _k, ...c }) => c);
        // 5) controles
        if (!r.columnas.length) r.avisos.push('No se detectaron columnas de memo/centro.');
        if (!r.lineas.length) r.avisos.push('No se detectaron productos en el cuadro.');
        r.lineas.forEach(l => { const s = Object.values(l.dist).reduce((t, x) => t + x, 0); if (l.totalDeclarado != null && s !== l.totalDeclarado) r.avisos.push(`"${l.descripcion.slice(0, 40)}": las columnas suman ${s} y el cuadro declara ${l.totalDeclarado}.`); });
        r.columnas.forEach(c => {
            const calc = r.lineas.reduce((t, l) => t + (l.dist[c.key] || 0) * l.valorNeto, 0);
            if (c.neto && calc && Math.abs(calc - c.neto) > 1) r.avisos.push(`Memo ${c.memo}: cantidades × precio = ${calc.toLocaleString('es-CL')} y el cuadro indica neto ${c.neto.toLocaleString('es-CL')}.`);
            if (!c.cdp) r.avisos.push(`Memo ${c.memo}: no se leyó el CDP.`);
        });
        return r;
    }

    // ------------------------------------------------------------------
    // Cuadro de distribución, variante B (v20.65): memo y CDP en el encabezado de la columna
    // ("MEMO N°54 SAR CDP N°4387"), código MP entre paréntesis al inicio de cada producto y pie con
    // NETO / IVA / TOTAL / PRESUPUESTO / SALDO. Mismo resultado que la variante A (+ presupuesto y saldo).
    // ------------------------------------------------------------------
    function extraerDistribucionB(items) {
        const r = { tipo: 'DIST_OC', avisos: [], columnas: [], lineas: [], variante: 'B' };
        const its = items.filter(i => limpiar(i.str));
        const cants = its.filter(i => /^CANTIDAD$/i.test(limpiar(i.str)) && i.x > 200);
        if (!cants.length) { r.avisos.push('No encontré las columnas de cantidades (encabezado "CANTIDAD").'); return r; }
        const yEnc = cants.sort((a, b) => b.y - a.y).filter(i => Math.abs(i.y - cants[0].y) <= TOL).length ? cants[0].y : cants[0].y;
        const fila = cants.filter(i => Math.abs(i.y - yEnc) <= TOL).sort((a, b) => a.x - b.x);
        const CH = 19, centros = fila.map(i => i.x + CH), paso = centros.length > 1 ? centros[1] - centros[0] : 90;
        const hTotal = its.find(i => /^TOTAL$/i.test(limpiar(i.str)) && Math.abs(i.y - yEnc) <= TOL && i.x > fila[fila.length - 1].x);
        const xTotal = hTotal ? hTotal.x - 8 : centros[centros.length - 1] + paso / 2;
        const lim = centros.map((c, k) => k === 0 ? c - paso / 2 : (centros[k - 1] + c) / 2); lim.push(xTotal);
        const banda = (x) => { for (let k = 0; k < centros.length; k++) if (x >= lim[k] && x < lim[k + 1]) return k; return -1; };
        const unir = (arr, junta) => limpiar(arr.sort((a, b) => a.y - b.y || a.x - b.x).map(i => limpiar(i.str)).join(junta === '' ? '' : ' '));
        // pie: etiquetas de la izquierda (x < primera columna)
        const xIzq = lim[0] - 15;
        const ETQ = [['neto', /^NETO$/i], ['iva', /^IVA$/i], ['total', /^TOTAL$/i], ['presupuesto', /^PRESUPUESTO$/i], ['saldo', /^SALDO$/i], ['direccion', /^DIRECCI[OÓ]N/i], ['contraparte', /^CONTRAPARTE/i], ['contacto', /^CONTACTO$/i], ['correo', /^CORREO$/i], ['horario', /^HORARIO$/i]];
        const etq = []; ETQ.forEach(([k, re]) => { const it = its.filter(i => i.x < xIzq && i.y > yEnc + 20 && re.test(limpiar(i.str))).sort((a, b) => b.y - a.y)[0]; if (it) etq.push({ k, y: it.y }); });
        etq.sort((a, b) => a.y - b.y);
        const yNeto = (etq.find(e => e.k === 'neto') || { y: Infinity }).y;
        // columnas: encabezado = texto sobre la fila "CANTIDAD"
        const cols = centros.map((c, k) => {
            const cab = unir(its.filter(i => i.y < yEnc - 2 && banda(i.x) === k));
            const m = /MEMO\s*N\s*[°º]?\s*(\d+)\s*(.*?)\s*CDP\s*N?\s*[°º]?\s*([\d\s\-–y,]+)/i.exec(cab) || /MEMO\s*N\s*[°º]?\s*(\d+)\s*(.*)$/i.exec(cab);
            const col = { memo: m ? m[1] : '', centro: m ? limpiar(String(m[2]).replace(/^CENTRO\s+/i, '')).toUpperCase() : '', financiamiento: '', _k: k };
            col.cdps = m && m[3] ? (String(m[3]).match(/\d+/g) || []) : []; col.cdp = col.cdps.join('-');
            etq.forEach((e, n) => {
                const sig = etq[n + 1], ant = etq[n - 1];
                const y0 = ant ? (ant.y + e.y) / 2 : e.y - 8, y1 = sig ? (e.y + sig.y) / 2 : e.y + 25;
                const zona = its.filter(i => i.y >= y0 && i.y < y1 && banda(i.x) === k);
                if (['neto', 'iva', 'total', 'presupuesto', 'saldo'].includes(e.k)) col[e.k] = entero(zona.filter(i => /\d/.test(i.str)).map(i => i.str).join(''));
                else col[e.k] = unir(zona, e.k === 'correo' ? '' : ' ');
            });
            return col;
        });
        cols.forEach((c, k) => { if (k) ['direccion', 'contraparte', 'contacto', 'correo', 'horario'].forEach(f => { const pr = cols[k - 1]; if (!c[f] && pr[f] && (f === 'horario' || pr.centro === c.centro)) c[f] = pr[f]; }); });
        cols.forEach(c => { if (!c.memo) r.avisos.push(`No se leyó el memo de la columna ${c._k + 1}.`); c.key = `${slug(c.centro) || 'col' + (c._k + 1)}-${c.memo || c._k + 1}`; });
        // productos: cada "(código) descripción" ancla una fila
        const anc = its.filter(i => i.x < 100 && /^\(\d{5,9}\)/.test(limpiar(i.str)) && i.y > yEnc && i.y < yNeto).sort((a, b) => a.y - b.y);
        r.lineas = anc.map((a, n) => {
            const y0 = n ? a.y - 8 : yEnc, y1 = anc[n + 1] ? anc[n + 1].y - 8 : yNeto - 3;   // la cantidad de una fila de 1 línea queda ~6 pt sobre el código
            const zona = its.filter(i => i.y >= y0 && i.y < y1);
            const id = (/^\((\d+)\)/.exec(limpiar(a.str)) || [])[1];
            const desc = zona.filter(i => i.x < 300).sort((x, y) => x.y - y.y || x.x - y.x).map(i => limpiar(i.str)).join(' ').replace(/^\(\d+\)\s*/, '');
            const pr = zona.filter(i => i.x >= 290 && i.x < lim[0] - 4 && /\d/.test(i.str)).map(i => entero(i.str))[0] || 0;
            const l = { id, descripcion: limpiar(desc), valorNeto: pr, dist: {}, totalDeclarado: null };
            zona.filter(i => /^\d+$/.test(limpiar(i.str)) && i.x >= lim[0] - 4).forEach(i => { const k = banda(i.x), q = Number(limpiar(i.str)); if (k >= 0) l.dist[cols[k].key] = (l.dist[cols[k].key] || 0) + q; else if (i.x >= xTotal) l.totalDeclarado = q; });
            return l;
        });
        r.columnas = cols.map(({ _k, ...c }) => c);
        if (!r.columnas.length) r.avisos.push('No se detectaron columnas de memo/centro.');
        if (!r.lineas.length) r.avisos.push('No se detectaron productos en el cuadro.');
        r.lineas.forEach(l => { const sm = Object.values(l.dist).reduce((t, x) => t + x, 0); if (l.totalDeclarado != null && sm !== l.totalDeclarado) r.avisos.push(`"${l.descripcion.slice(0, 40)}": las columnas suman ${sm} y el cuadro indica ${l.totalDeclarado}.`); });
        r.columnas.forEach(c => {
            const calc = r.lineas.reduce((t, l) => t + (l.dist[c.key] || 0) * l.valorNeto, 0);
            if (c.neto && calc && Math.abs(calc - c.neto) > 1) r.avisos.push(`Memo ${c.memo}: cantidades × precio = ${calc.toLocaleString('es-CL')} y el cuadro indica neto ${c.neto.toLocaleString('es-CL')}.`);
            if (!c.cdp) r.avisos.push(`Memo ${c.memo}: no se leyó el CDP.`);
        });
        return r;
    }
    /** Montos de cada columna coherentes: IVA = 19 % del neto y total = neto + IVA. Si lo leído no cuadra (celdas pegadas), se corrige y se avisa. */
    function cuadrarTotales(r) {
        (r.columnas || []).forEach(c => {
            if (!c.neto) return;
            const iva = Math.round(c.neto * 0.19), tot = c.neto + iva;
            if (Math.abs((c.iva || 0) - iva) > 2) { if (c.iva) r.avisos.push(`Memo ${c.memo} ${c.centro}: el IVA leído (${c.iva.toLocaleString('es-CL')}) no cuadra; se usó ${iva.toLocaleString('es-CL')}.`); c.iva = iva; }
            if (Math.abs((c.total || 0) - tot) > 2) { if (c.total) r.avisos.push(`Memo ${c.memo} ${c.centro}: el total leído (${c.total.toLocaleString('es-CL')}) no cuadra con neto + IVA; se usó ${tot.toLocaleString('es-CL')}.`); c.total = tot; }
        });
        return r;
    }
    /** Elige la variante del cuadro según lo que trae el documento. */
    function extraerDistribucionAuto(items) { const t = items.map(i => i.str).join(' '); return cuadrarTotales(/FINANCIAMIENTO/i.test(t) ? extraerDistribucion(items) : extraerDistribucionB(items)); }

    /** Cruza el cuadro con las líneas de la OC (por código MP, o por parecido de la descripción).
     *  Devuelve {columnas, dist:[{key:cant}…] (una por línea de la OC), avisos}. Puro. */
    function unirDistribucion(oc, dist) {
        const avisos = [], usada = new Set();
        const toks = (t) => new Set(String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 1));
        // Parecido entre la descripción de la orden (suele ser larga) y la del cuadro (suele ser corta): se mide qué parte de la más corta está contenida en la otra,
        // y se refuerza con el precio neto y la cantidad total (así «CARRETE 40 m» y «CARRETE 20 m» no se confunden).
        const sim = (a, b) => { const A = toks(a), B = toks(b); let i = 0; A.forEach(x => { if (B.has(x)) i++; }); const u = A.size + B.size - i, mn = Math.min(A.size, B.size); return { jac: u ? i / u : 0, cont: mn ? i / mn : 0, comun: i }; };
        const distLineas = dist.lineas.map((d, n) => ({ d, n }));
        const sumaD = (d) => Object.values(d.dist).reduce((t, x) => t + x, 0);
        const lineasOC = oc.lineas || [], asign = new Array(lineasOC.length).fill(null);
        lineasOC.forEach((l, i) => { const h = distLineas.find(x => !usada.has(x.n) && l.codigoMP && x.d.id === String(l.codigoMP)); if (h) { asign[i] = h; usada.add(h.n); } });
        const pares = [];
        lineasOC.forEach((l, i) => { if (asign[i]) return; distLineas.forEach(x => {
            if (usada.has(x.n)) return; const q = sim(l.descripcion, x.d.descripcion);
            const mismoPrecio = Number(l.valorNeto) > 0 && Math.abs(Number(l.valorNeto) - Number(x.d.valorNeto || 0)) < 1, mismaCant = Number(l.cantidad) === sumaD(x.d);
            let sc = Math.max(q.jac, q.cont * 0.9) + (mismoPrecio ? 0.35 : 0) + (mismaCant ? 0.15 : 0);
            if (q.comun < 1 && !mismoPrecio) return;
            if (sc >= 0.5) pares.push({ i, x, sc });
        }); });
        pares.sort((p, q) => q.sc - p.sc);
        pares.forEach(p => { if (asign[p.i] || usada.has(p.x.n)) return; asign[p.i] = p.x; usada.add(p.x.n); });
        const out = lineasOC.map((l, i) => {
            const hit = asign[i];
            if (!hit) { avisos.push(`"${String(l.descripcion).slice(0, 50)}" no aparece en el cuadro de distribución.`); return {}; }
            const sum = sumaD(hit.d);
            if (sum !== Number(l.cantidad)) avisos.push(`"${String(l.descripcion).slice(0, 40)}": la orden dice ${l.cantidad} y el cuadro reparte ${sum}.`);
            return { ...hit.d.dist };
        });
        distLineas.forEach(x => { if (!usada.has(x.n)) avisos.push(`El cuadro trae un producto que no está en la orden: ${x.d.descripcion}.`); });
        const omemos = oc.memos || [];
        if (omemos.length) dist.columnas.forEach(c => { if (c.memo && !omemos.includes(c.memo)) avisos.push(`El memo ${c.memo} del cuadro no figura en las observaciones de la orden (${omemos.join('-')}).`); });
        return { columnas: dist.columnas, dist: out, avisos };
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

    // ------------------------------------------------------------------
    // Hojas de Excel (v20.88): el cuadro de distribución también viene en Excel; la orden puede venir en Excel.
    // Entrada: filas ya convertidas a arreglos (XLSX.utils.sheet_to_json con header:1).
    // ------------------------------------------------------------------
    const celda = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
    function extraerDistribucionExcel(filas) {
        const r = { tipo: 'DIST_OC', avisos: [], columnas: [], lineas: [], variante: 'EXCEL' };
        { const f0 = filas.slice(0, 3).map(f => (f || []).map(celda).join(' ')).join(' '), mo = /(\d{3,8}-\d{1,5}-[A-Z]{2}\d{2})/.exec(f0); if (mo) r.numeroOC = mo[1]; }
        const iCab = filas.findIndex((f, n) => n < 15 && (f || []).some(c => /MEMO\s*(?:N|#)/i.test(celda(c))));
        if (iCab < 0) { r.avisos.push('No encontré las columnas "MEMO N° …" en el Excel.'); return r; }
        const cab = filas[iCab] || [];
        const grupos = [];                       // una columna por memo+centro; si el centro trae varios CDP (columnas) se juntan
        cab.forEach((c, i) => {
            const t = celda(c); const m = /MEMO\s*(?:N\s*[°º.]?|#)\s*(\d+)\s*(.*?)\s*(?:CDP\s*(?:N\s*[°º.]?|#)?\s*([\d\s\-–y,]+))?$/i.exec(t); if (!m) return;
            let centro = limpiar(String(m[2]).replace(/^[\s\-–:]+|[\s\-–:]+$/g, '').replace(/^CENTRO\s+/i, '')).toUpperCase(); if (/(^|[^A-Z])SAR([^A-Z]|$)/.test(centro)) centro = 'SAR';
            const cdps = m[3] ? (m[3].match(/\d+/g) || []) : [];
            let g = grupos.find(x => x.memo === m[1] && x.centro === centro);
            if (!g) { g = { memo: m[1], centro, financiamiento: '', cdps: [], idx: [], key: `${slug(centro) || 'col' + (grupos.length + 1)}-${m[1]}` }; grupos.push(g); }
            cdps.forEach(d => { if (!g.cdps.includes(d)) g.cdps.push(d); }); g.idx.push(i);
        });
        if (!grupos.length) { r.avisos.push('No se leyó ningún memo en el encabezado del Excel.'); return r; }
        // fila de títulos (DESCRIPCION / VALOR NETO / CANTIDAD…)
        const iTit = filas.findIndex((f, n) => n >= iCab && (f || []).some(c => /^(descripci|productos?$|detalle|insumos?$|art[ií]culos?$|[ií]tem$|nombre)/i.test(celda(c))));
        const tit = filas[iTit >= 0 ? iTit : iCab + 1] || [];
        const esCant = (i) => /^cant/i.test(celda(tit[i])), esTot = (i) => /^total/i.test(celda(tit[i]));
        grupos.forEach(g => { g.idx = g.idx.map(i => esCant(i) ? i : (esTot(i) && esCant(i - 1)) ? i - 1 : esCant(i + 1) ? i + 1 : i); });
        const cDesc = Math.max(0, tit.findIndex(c => /^(descripci|productos?$|detalle|insumos?$|art[ií]culos?$|[ií]tem$|nombre)/i.test(celda(c)))), cNeto = tit.findIndex(c => /valor\s*neto|precio|neto\s*unit|v\.?\s*unit/i.test(celda(c))), cTot = tit.findIndex(c => /cantidad\s*total/i.test(celda(c)));
        const num = (v) => typeof v === 'number' ? v : (Number(String(v == null ? '' : v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0);
        const ETQ = { NETO: 'neto', IVA: 'iva', TOTAL: 'total', PRESUPUESTO: 'presupuesto', SALDO: 'saldo' };
        const pie = {}, pares = grupos.some(g => esTot(g.idx[0] + 1)), desp = pares ? 1 : 0, iPrim = Math.min(...grupos.map(g => g.idx[0]));   // formato «CANTIDAD | TOTAL» por memo: los montos del pie están en la columna TOTAL
        for (let n = (iTit >= 0 ? iTit : iCab + 1) + 1; n < filas.length; n++) {
            const f = filas[n] || [], d = celda(f[cDesc]), e = ETQ[celda(f[cDesc + 1]).toUpperCase()] || ETQ[d.toUpperCase()] || (!d ? ETQ[(f.slice(0, iPrim).map(x => celda(x).toUpperCase()).find(x => ETQ[x]) || '')] : undefined);
            if (e && (!d || ETQ[d.toUpperCase()])) { pie[e] = f; continue; }
            if (!d || (cNeto >= 0 && f[cNeto] != null && typeof f[cNeto] !== 'number' && num(f[cNeto]) === 0)) continue;
            const id = (/^\((\d{5,9})\)/.exec(d) || [])[1] || '';
            const l = { id, descripcion: limpiar(d.replace(/^\(\d+\)\s*/, '')), valorNeto: cNeto >= 0 ? num(f[cNeto]) : 0, dist: {}, totalDeclarado: cTot >= 0 && f[cTot] != null && f[cTot] !== '' ? num(f[cTot]) : null };
            grupos.forEach(g => { const q = g.idx.reduce((t, i) => t + num(f[i]), 0); if (q > 0) l.dist[g.key] = q; });
            if (Object.keys(l.dist).length || l.valorNeto) r.lineas.push(l);
        }
        r.columnas = grupos.map(g => { const c = { memo: g.memo, centro: g.centro, financiamiento: '', cdps: g.cdps, cdp: g.cdps.join('-'), key: g.key }; Object.keys(ETQ).forEach(k => { const v = pie[ETQ[k]]; if (v) c[ETQ[k]] = Math.round(g.idx.reduce((t, i) => t + num(v[i + desp]), 0)); }); return c; });
        cuadrarTotales(r);
        if (!r.lineas.length) r.avisos.push('No se detectaron productos en el Excel.');
        r.lineas.forEach(l => { const sm = Object.values(l.dist).reduce((t, x) => t + x, 0); if (l.totalDeclarado != null && sm !== l.totalDeclarado) r.avisos.push(`"${l.descripcion.slice(0, 40)}": las columnas suman ${sm} y el cuadro indica ${l.totalDeclarado}.`); });
        r.columnas.forEach(c => {
            const calc = r.lineas.reduce((t, l) => t + (l.dist[c.key] || 0) * l.valorNeto, 0);
            if (c.neto && calc && Math.abs(calc - c.neto) > 1) r.avisos.push(`Memo ${c.memo} ${c.centro}: cantidades × precio = ${calc.toLocaleString('es-CL')} y el cuadro indica neto ${c.neto.toLocaleString('es-CL')}.`);
            if (!c.cdp) r.avisos.push(`Memo ${c.memo} ${c.centro}: no se leyó el CDP.`);
        });
        return r;
    }
    /** Orden de compra en Excel (lectura genérica: busca el N° de orden y la tabla Producto/Cantidad/Precio). */
    function extraerOCExcel(filas) {
        const r = { tipo: 'OC_MP', avisos: ['Orden leída desde Excel: revisa cada dato.'], lineas: [], memos: [] };
        const todo = filas.map(f => (f || []).map(celda).join(' | ')).join('\n');
        r.numeroOC = ((/(\d{3,8}-\d{1,5}-[A-Z]{2}\d{2})/.exec(todo)) || [])[1] || '';
        const dato = (re) => { const m = re.exec(todo); return m ? limpiar(m[1]) : ''; };
        r.proveedor = dato(/(?:SE[ÑN]OR\s*\(ES\)|PROVEEDOR)\s*:?\s*\|?\s*([^|\n]+)/i);
        r.rutProveedor = ((/(\d{1,2}\.\d{3}\.\d{3}-[\dkK])/.exec(todo)) || [])[1] || '';
        const fe = /(\d{2}-\d{2}-\d{4})/.exec(dato(/FECHA\s*(?:ENV[IÍ]O|EMISI[OÓ]N)[^|\n]*\|?\s*([^|\n]+)/i)); r.emitida = fe ? fechaISO(fe[1]) : '';
        const mm = /MEMO\s*N\s*[°º]?\s*(\d+(?:\s*[-,/y]\s*\d+)*)(?:\s*-\s*([^|\n]+))?/i.exec(todo);
        r.memos = mm ? mm[1].split(/\s*[-,/y]\s*/).filter(Boolean) : []; r.memo = r.memos.join('-'); r.descripcion = mm && mm[2] ? limpiar(mm[2]) : '';
        const iH = filas.findIndex(f => { const t = (f || []).map(celda).join('|'); return /producto|descripci/i.test(t) && /cantidad/i.test(t) && /precio|valor|neto/i.test(t); });
        if (iH < 0) { r.avisos.push('No encontré la tabla de productos (Producto / Cantidad / Precio): ingrésalos a mano.'); return r; }
        const h = (filas[iH] || []).map(celda), col = (re) => h.findIndex(c => re.test(c));
        const cD = col(/descripci|producto|especificaciones\s*comprador/i), cQ = col(/^cantidad/i), cP = col(/precio|neto\s*unit|valor\s*neto/i), cT = col(/valor\s*total|^total/i), cC = col(/c[oó]digo|^id$/i);
        const nm = (v) => typeof v === 'number' ? v : (Number(String(v == null ? '' : v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0);
        for (let n = iH + 1; n < filas.length; n++) {
            const f = filas[n] || [], d = celda(f[cD]), q = nm(f[cQ]); if (!d && !q) { if (r.lineas.length) break; else continue; } if (!d || !(q > 0) || /^(neto|total|iva|subtotal)/i.test(d)) { if (r.lineas.length) break; else continue; }
            const cod = /^\((\d{4,9})\)/.exec(d);
            r.lineas.push({ descripcion: limpiar(d.replace(/^\(\d+\)\s*/, '')), codigoMP: cod ? cod[1] : '', licitacion: '', cantidad: q, valorNeto: nm(f[cP]), totalLinea: cT >= 0 ? nm(f[cT]) : 0 });
        }
        if (!r.lineas.length) r.avisos.push('No se detectaron productos: ingrésalos a mano.');
        ['numeroOC', 'proveedor'].forEach(k => { if (!r[k]) r.avisos.push(`No se encontró: ${k === 'numeroOC' ? 'N° de orden' : 'proveedor'}.`); });
        return r;
    }
    /** Dice qué parece ser un texto que no se reconoció (para un mensaje útil). */
    function parecidoA(texto) {
        const t = String(texto || '');
        if (/RECEPCI[OÓ]N\s+CONFORME/i.test(t)) return 'una Recepción conforme (se sube en la propia orden, no al ingresarla)';
        if (/GU[IÍ]A\s+DE\s+DESPACHO/i.test(t)) return 'una guía de despacho (se sube al recibir la mercadería)';
        if (/FACTURA/i.test(t)) return 'una factura';
        if (/ACTA\s+DE\s+ENTREGA/i.test(t)) return 'un acta de entrega';
        return '';
    }
    function leerHoja(filas) {
        const d = extraerDistribucionExcel(filas);
        if (d.columnas.length && d.lineas.length) return d;
        const o = extraerOCExcel(filas); if (o.lineas.length || o.numeroOC) return o;
        throw new Error('No reconozco este Excel. Busco un cuadro de distribución (columnas "MEMO N° … CDP N° …") o una orden de compra (tabla Producto / Cantidad / Precio).');
    }
    const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const LECTORES = { OC_MP: { nombre: 'Orden de compra (Mercado Público)', reconoce: reconoceOC, extraer: extraerOC }, DIST_OC: { nombre: 'Cuadro de distribución de la orden', reconoce: reconoceDistribucion, extraer: extraerDistribucionAuto } };
    function detectar(items) { const txt = lineas(items).map(l => l.texto).join('\n'); return Object.keys(LECTORES).find(k => LECTORES[k].reconoce(txt)) || null; }
    function leer(items) {
        const k = detectar(items);
        if (!k) { const p = parecidoA(lineas(items).map(l => l.texto).join('\n')); throw new Error(p ? `Este archivo parece ${p}. Aquí va la orden de compra de Mercado Público (o su cuadro de distribución).` : 'No reconozco este documento. Leo órdenes de compra de Mercado Público y cuadros de distribución; puedes ingresar los datos a mano.'); }
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
    const esExcel = (f) => /\.(xlsx|xls|xlsm)$/i.test(f.name || '') || /spreadsheet|excel/i.test(f.type || '');
    async function filasDeExcel(file) {
        if (typeof XLSX === 'undefined') throw new Error('No cargó la librería de Excel.');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        for (const n of wb.SheetNames) { const filas = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null }); try { return leerHoja(filas); } catch (e) { /* prueba la hoja siguiente */ } }
        throw new Error('No reconozco este Excel. Busco un cuadro de distribución (columnas "MEMO N° … CDP N° …") o una orden de compra (tabla Producto / Cantidad / Precio).');
    }
    /** PDF o Excel: devuelve la orden (OC_MP) o el cuadro (DIST_OC), según lo que sea el archivo. */
    async function leerArchivo(file) { return esExcel(file) ? filasDeExcel(file) : leer(await itemsDePDF(await file.arrayBuffer())); }
    async function leerDistribucion(file) { const r = await leerArchivo(file); if (r.tipo === 'OC_MP') throw new Error('Ese archivo es una orden de compra: súbelo en el primer recuadro (el cuadro va aquí).'); if (r.tipo !== 'DIST_OC') throw new Error('Ese archivo no es un cuadro de distribución (busco columnas "MEMO N° …", FINANCIAMIENTO y CDP).'); return r; }

    window.SAR_Lector = { cargarPdfJs, leerHoja, extraerDistribucionExcel, extraerOCExcel, esExcel, leer, leerArchivo, leerDistribucion, extraerDistribucion, extraerDistribucionB, unirDistribucion, detectar, extraerOC, extraerCorreo, lineas, LECTORES };
    if (typeof module !== 'undefined') module.exports = window.SAR_Lector;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
