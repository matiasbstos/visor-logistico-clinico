/* ==========================================================================
   GUÍA / FACTURA → LOTE, VENCIMIENTO Y EMPRESA (v21.147 → v21.257)
   Al recibir mercadería de una orden de compra, el documento (foto o PDF de la guía de despacho o factura)
   completa solos, en cada producto de la orden: lote, vencimiento y cantidad; además empresa y N° documento.
   - Modelo local integrado (v21.257): REUTTER S.A. (Factura Electrónica / Guía, digital o escaneada con OCR
     incluyendo escaneos rotados 180° y sublíneas L:<lote>;C:<cant>;V:<vence>).
   - Respaldo/prioridad IA visual (Apps Script acción "documento") para cualquier otro proveedor o escaneos sin OCR,
     descartando hojas en blanco.
   Siempre se revisa antes de guardar. Lo puro (Reutter, emparejar, fechas) se prueba en tests/unidad.js.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const ABREV = {
    sond: 'sonda', fol: 'foley', silic: 'silicona', '2v': '2 vias', '3v': '3 vias',
    fransparente: 'transparente', oraouada: 'graduada', nasogastbica: 'nasogastrica',
    locm: '10cm', '1oo': '100', apos: 'aposito', elast: 'elastica', transp: 'transparente',
    bal: 'balon', grad: 'graduada', nasogast: 'nasogastrica', nasog: 'nasogastrica'
  };
  const norm = (s) => {
    let t = String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    t = t.replace(/\bc\s*\/\s*balon\b/g, 'balon').replace(/(\d+)\s*(fr|cc|cm|mm|ml)\b/g, '$1 $2');
    t = t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t.split(' ').map(w => ABREV[w] || w).join(' ');
  };
  const PAR = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'y', 'o', 'a', 'en', 'un', 'una', 'unidad', 'unidades', 'caja', 'cajas', 'formato', 'cj', 'x']);
  const toks = (s) => norm(s).split(' ').filter(w => w && !PAR.has(w) && (w.length > 2 || /\d/.test(w)));

  /** Puro: 'AAAA-MM-DD' desde 'AAAA-MM-DD', 'DD/MM/AAAA', 'MM/AAAA' (último día del mes) o ''. */
  function fechaISO(v) {
    const s = String(v || '').trim(); let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return s;
    if ((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s))) {
      const dd = Number(m[1]), mm = Number(m[2]), yy = Number(m[3]);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yy >= 2000 && yy <= 2099) {
        return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }
      return '';
    }
    if ((m = /^(\d{1,2})[\/.-](\d{4})$/.exec(s))) {
      const mm = Number(m[1]), yy = Number(m[2]);
      if (mm >= 1 && mm <= 12 && yy >= 2000 && yy <= 2099) {
        const d = new Date(yy, mm, 0).getDate();
        return `${yy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
      return '';
    }
    return '';
  }

  /** Puro: limpia errores típicos de OCR en una fecha DD-MM-AAAA (ej. "01 -1 l -2030", "01 -06'203r", "20/11t2026"). */
  function fechaOCRaISO(v) {
    if (!v) return '';
    let s = String(v).trim();
    // Normalizar dígitos confundidos por OCR en contexto de fecha
    s = s.replace(/[lI¡í|]/g, '1').replace(/[Oo]/g, '0').replace(/(\d{3})r\b/gi, '$11');
    // Unir dígitos separados por un espacio dentro de día/mes/año (ej. "1 1" → "11")
    s = s.replace(/(\d)\s+(\d)/g, '$1$2');
    // Reemplazar separadores ruidosos (t, ', ., espacios alrededor de guiones) por guion
    s = s.replace(/\s*[-/.',t]\s*/gi, '-').replace(/^-+|-+$/g, '');
    const m = /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(s);
    if (m) return fechaISO(`${m[1]}-${m[2]}-${m[3]}`);
    const m8 = /^(\d{2})(\d{2})(20\d{2})$/.exec(s.replace(/\D/g, ''));
    if (m8) return fechaISO(`${m8[1]}-${m8[2]}-${m8[3]}`);
    return fechaISO(s);
  }

  const puntaje = (a, b) => { const A = toks(a), B = new Set(toks(b)); if (!A.length) return 0; return A.filter(w => B.has(w)).length / A.length; };
  /** Puro: une las líneas leídas del documento con las líneas de la orden. Devuelve {pares:[{i, doc}], extras:[doc], sinPar:[doc]}.
      lineasOC: [{descripcion, codigoMP}] · doc: [{descripcion, cantidad, lote, vence}] */
  function emparejar(lineasOC, doc) {
    const usadas = new Set(), pares = [], sinPar = [], extras = [];
    (doc || []).forEach(d => {
      let mejor = -1, mp = 0;
      (lineasOC || []).forEach((l, i) => {
        const cod = l.codigoMP && String(d.descripcion || '').includes(String(l.codigoMP)) ? 1 : 0;
        const p = Math.max(cod, Math.min(puntaje(l.descripcion, d.descripcion), puntaje(d.descripcion, l.descripcion) + 0.15));
        if (p > mp && p >= 0.5) { mp = p; mejor = i; }
      });
      if (mejor < 0) { sinPar.push(d); return; }
      if (usadas.has(mejor)) { extras.push({ ...d, i: mejor }); return; }
      usadas.add(mejor); pares.push({ i: mejor, doc: d });
    });
    return { pares, extras, sinPar };
  }

  // ------------------------------------------------------------------
  // Modelo local: REUTTER S.A. (Factura Electrónica / Guía de Despacho)
  // Soporta PDF digital y PDF escaneado con capa OCR (incluso rotado 180°)
  // Sublínea característica: L:<lote>;C:<cantidad>;V:<DD-MM-AAAA>
  // ------------------------------------------------------------------
  const RE_SUBLINEA_REUTTER = /\bL\s*[:;i¡l]\s*([A-Za-z0-9 ]{4,18}?)\s*[;i¡,]\s*C\s*[:;r¡i]\s*([0-9lIoO]{1,6})\s*[;i¡,r]\s*V\s*[:;r¡i]\s*([^\n]{6,22})/i;

  function agruparLineas(items, tol) {
    const T = tol || 5;
    const orden = [...(items || [])].filter(i => limpiar(i.str)).sort((a, b) => a.y - b.y || a.x - b.x);
    const L = [];
    for (const it of orden) {
      const l = L.find(o => Math.abs(o.y - it.y) <= T);
      if (l) l.items.push(it); else L.push({ y: it.y, items: [it] });
    }
    L.forEach(l => {
      l.items.sort((a, b) => a.x - b.x);
      l.x = l.items[0].x;
      l.texto = limpiar(l.items.map(i => i.str).join(' '));
    });
    return L.sort((a, b) => a.y - b.y);
  }

  /** Puro: true si el texto corresponde al modelo Reutter S.A. (o trae sublíneas L:;C:;V:). */
  function reconoceReutter(texto) {
    const t = String(texto || '');
    const esMarcaReutter = /\bREUTTER\b/i.test(t) || /81\.210\.400-4/.test(t) || /reutt[e€]r\.cl/i.test(t);
    const tieneSublineas = RE_SUBLINEA_REUTTER.test(t);
    return (esMarcaReutter && (/FACTU[RH]A|GU[IÍ]A|DETALLE|CANTIDAD/i.test(t) || tieneSublineas)) || tieneSublineas;
  }

  /** Puro: true si el documento Reutter viene como PDF digital limpio (sin ruido OCR). */
  function esReutterDigitalLimpio(texto) {
    const t = String(texto || '');
    if (!/\bREUTTER\b/i.test(t) || !/(FACTURA\s+ELECTR[OÓ]NICA|GU[IÍ]A\s+DE\s+DESPACHO)/i.test(t)) return false;
    const limpias = t.match(/\bL:\d{6,14};C:\d+;V:\d{2}-\d{2}-\d{4}\b/g) || [];
    const ruidosas = t.match(/\bL\s*[:;i¡l]\s*[A-Za-z0-9 ]{4,18}\s*[;i¡,]\s*C\s*[:;r¡i]/gi) || [];
    return limpias.length > 0 && limpias.length === ruidosas.length;
  }

  function limpiarDescReutter(s) {
    return limpiar(String(s || '')
      .replace(/\bfRANSPARENTE\b/g, 'TRANSPARENTE')
      .replace(/\blOCM\b/g, '10CM')
      .replace(/\b1OO\b/g, '100')
      .replace(/\bORAOUADA\b/gi, 'GRADUADA')
      .replace(/\bNASOGASTBICA\b/gi, 'NASOGASTRICA'));
  }

  /** Puro: extrae empresa, tipo, número, fecha, OC y líneas (descripción, cantidad, lote, vencimiento) del modelo Reutter. */
  function extraerReutter(items) {
    const L = agruparLineas(items, 5);
    const T = L.map(l => l.texto), todo = T.join('\n');
    const esDigital = esReutterDigitalLimpio(todo);
    const empresa = (/\bREUTTER\b/i.test(todo) || /81\.210\.400-4/.test(todo)) ? 'REUTTER S.A.' : (T[0] || '');
    const tipoDocumento = /GU[IÍ]A\s+DE\s+DESPACHO/i.test(todo) ? 'GUIA' : 'FACTURA';

    // N° de factura o guía (ej. "N'0001075247" o "N° 0001075247" → "1075247")
    let numero = '';
    const mNum = /N\s*[°º'":.]\s*0*(\d{4,10})\b/i.exec(todo);
    if (mNum) numero = mNum[1];

    // Fecha emisión ("FECHA EMISION | 20/11t2026")
    let fecha = '';
    const lFec = T.find(t => /FECHA\s+EMISI[OÓ]N/i.test(t));
    if (lFec) {
      const mF = /FECHA\s+EMISI[OÓ]N[^0-9]{0,12}([0-9lIoO]{1,2}\s*[-/.',t]\s*[0-9lIoO]{1,2}\s*[-/.',t]\s*20\d{2})/i.exec(lFec);
      if (mF) fecha = fechaOCRaISO(mF[1]);
    }

    // Referencia OC ("oc 18-11-2026 1 298355- 1 002-CM26")
    let numeroOC = '';
    const mOC = /\b(\d[\d ]{3,8}-\s*[\d ]{1,6}-(?:AG|CM|SE|LE|LP|TD)\d{2})\b/i.exec(todo);
    if (mOC) numeroOC = mOC[1].replace(/\s+/g, '').toUpperCase();

    // Calibrar límites X de columnas según encabezados (CODIGO | CANTIDAD | DETALLE | CLAS | UN MED | PRECIO UN. | TOTAL)
    const lEnc = L.find(l => /DETALLE/i.test(l.texto) && /CANTIDAD|PRECIO/i.test(l.texto));
    const itEnc = (re) => lEnc && lEnc.items.find(i => re.test(limpiar(i.str)));
    const hCant = itEnc(/CANTIDAD/i), hClas = itEnc(/CLAS/i), hUn = itEnc(/UN\s*MED/i), hPrec = itEnc(/PRECIO/i);
    const xMinDesc = hCant ? hCant.x + 40 : 116;
    const xMaxDesc = hClas ? hClas.x - 8 : (hUn ? hUn.x - 16 : (hPrec ? hPrec.x - 50 : 398));

    const lineas = [];
    for (let i = 0; i < L.length; i++) {
      const mSub = RE_SUBLINEA_REUTTER.exec(L[i].texto);
      if (!mSub) continue;

      const rawLote = mSub[1].replace(/\s+/g, '').toUpperCase();
      const cantSub = Number(mSub[2].replace(/[lI¡]/g, '1').replace(/[Oo]/g, '0')) || 0;
      const vence = fechaOCRaISO(mSub[3]);

      // La fila del producto está inmediatamente arriba (generalmente 6..18 px arriba)
      const prev = i > 0 ? L[i - 1] : null;
      let descripcion = '', codigo = '', cantLinea = 0;
      if (prev && Math.abs(L[i].y - prev.y) <= 24 && !RE_SUBLINEA_REUTTER.test(prev.texto)) {
        const tiene2D = prev.items.length > 1;
        if (tiene2D) {
          const codIt = prev.items.find(it => it.x < (hCant ? hCant.x - 5 : 70));
          codigo = codIt ? limpiar(codIt.str).toUpperCase() : '';
          const cantIt = prev.items.find(it => it.x >= (hCant ? hCant.x - 5 : 70) && it.x < xMinDesc);
          if (cantIt) cantLinea = Number(limpiar(cantIt.str).replace(/^['"]/, '').replace(/[lI¡]/g, '1').replace(/[OoAa]/g, '0').replace(/\D/g, '')) || 0;
          descripcion = limpiarDescReutter(prev.items.filter(it => it.x >= xMinDesc && it.x < xMaxDesc).map(it => it.str).join(' '));
        } else {
          // Respaldo 1D (pruebas de texto plano)
          const limpio = prev.texto.replace(/^[A-Z0-9]{5,12}\s+/, '').replace(/\s+(?:DM|OM|RM|MT|INF)\s+(?:CJ|UN|PQ|FR)\b.*$/i, '');
          const mC = /^'?(\d{1,5})\s+(.+)$/.exec(limpio);
          if (mC) { cantLinea = Number(mC[1]) || 0; descripcion = limpiarDescReutter(mC[2]); }
          else descripcion = limpiarDescReutter(limpio);
        }
      }

      if (descripcion) {
        lineas.push({
          codigo,
          descripcion,
          cantidad: cantSub || cantLinea,
          lote: rawLote,
          vence
        });
      }
    }

    return {
      empresa,
      tipoDocumento,
      numero,
      fecha,
      numeroOC,
      lineas,
      origenLectura: esDigital ? 'LOCAL_REUTTER' : 'LOCAL_REUTTER_OCR'
    };
  }

  const cfgConectada = (c) => !!(c && c.webhookUrl && c.token);
  function aJpeg(canvas) { return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]; }

  /** Extrae elementos de texto de un PDF respetando rotación de página (vp.transform). */
  async function itemsDePDF(buffer) {
    const lib = await window.SAR_Lector.cargarPdfJs();
    const pdf = await lib.getDocument({ data: buffer.slice(0) }).promise;
    const out = []; let offset = 0;
    for (let p = 1; p <= Math.min(pdf.numPages, 6); p++) {
      const pg = await pdf.getPage(p), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
      const m = vp.transform;
      tc.items.forEach(i => {
        if (i.str && i.str.trim()) {
          const tx = i.transform[4], ty = i.transform[5];
          const vx = m ? (m[0] * tx + m[2] * ty + m[4]) : tx;
          const vy = m ? (m[1] * tx + m[3] * ty + m[5]) : (vp.height - ty);
          out.push({ str: i.str, x: vx, y: offset + vy });
        }
      });
      offset += vp.height + 20;
    }
    return out;
  }

  /** Páginas del archivo como JPEG base64 (foto o PDF; máx. 4 útiles, descartando hojas en blanco si existe SAR_Lector.paginaConContenido). */
  async function paginas(file, bufferOpt) {
    if (/^image\//.test(file.type)) {
      const url = URL.createObjectURL(file);
      try { return [await new Promise((ok, mal) => { const im = new Image(); im.onload = () => { const k = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); ok(aJpeg(c)); }; im.onerror = () => mal(new Error('No pude abrir la foto.')); im.src = url; })]; }
      finally { URL.revokeObjectURL(url); }
    }
    if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name || '')) {
      const lib = await window.SAR_Lector.cargarPdfJs();
      const data = bufferOpt ? bufferOpt.slice(0) : await file.arrayBuffer();
      const pdf = await lib.getDocument({ data }).promise, out = [];
      let primera = null;
      const conContenido = window.SAR_Lector && typeof window.SAR_Lector.paginaConContenido === 'function' ? window.SAR_Lector.paginaConContenido : null;
      for (let p = 1; p <= Math.min(pdf.numPages, 8) && out.length < 4; p++) {
        const pg = await pdf.getPage(p), vp = pg.getViewport({ scale: 1.6 }), c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const jpg = aJpeg(c);
        if (!primera) primera = jpg;
        if (!conContenido || conContenido(c)) out.push(jpg);
      }
      return out.length ? out : (primera ? [primera] : []);
    }
    throw new Error('El documento debe ser una foto o un PDF.');
  }

  /** Lee el documento: modelo local Reutter (digital inmediato o respaldo OCR) + IA visual (Apps Script). */
  async function leer(file, cfg) {
    const esPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name || '');
    let buffer = null, localReutter = null;
    if (esPdf && window.SAR_Lector && window.SAR_Lector.cargarPdfJs) {
      try {
        buffer = await file.arrayBuffer();
        const items = await itemsDePDF(buffer);
        const txt = agruparLineas(items, 5).map(l => l.texto).join('\n');
        if (reconoceReutter(txt)) {
          const rLoc = extraerReutter(items);
          if (rLoc.lineas.length > 0) {
            if (rLoc.origenLectura === 'LOCAL_REUTTER') return rLoc;   // PDF digital Reutter: lectura local exacta e instantánea
            localReutter = rLoc;                                       // PDF escaneado OCR: se usa como respaldo si falla o falta IA
          }
        }
      } catch (e) { /* sigue con vía visual IA */ }
    }
    if (cfgConectada(cfg)) {
      try {
        const pags = await paginas(file, buffer);
        const r = await fetch(cfg.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: cfg.token, accion: 'documento', paginas: pags }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error === 'sin_clave' ? 'SIN_CLAVE' : (j.error === 'token' ? 'El token del script no coincide.' : (j.error === 'accion' || j.error === undefined ? 'SCRIPT_VIEJO' : String(j.error))));
        return { empresa: String(j.empresa || '').trim(), numero: String(j.numero || '').trim(), fecha: fechaISO(j.fecha), origenLectura: 'IA', lineas: (j.lineas || []).map(x => ({ descripcion: String(x.descripcion || '').trim(), cantidad: Math.floor(Number(x.cantidad) || 0), lote: String(x.lote || '').trim().toUpperCase(), vence: fechaISO(x.vence) })).filter(x => x.descripcion) };
      } catch (errIA) {
        if (localReutter) return localReutter;
        throw errIA;
      }
    }
    if (localReutter) return localReutter;
    throw new Error('SIN_SCRIPT');
  }

  const api = { fechaISO, fechaOCRaISO, emparejar, reconoceReutter, extraerReutter, leer, paginas, cfgConectada };
  window.SAR_GuiaLector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : null);
