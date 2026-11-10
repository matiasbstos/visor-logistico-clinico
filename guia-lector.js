/* ==========================================================================
   GUÍA / FACTURA → LOTE, VENCIMIENTO Y EMPRESA (v21.147)
   Al recibir mercadería de una orden de compra, el documento (foto o PDF de la guía de despacho o factura)
   se lee con el mismo Apps Script que las fotos de cajas (acción "documento") y se completan solos, en cada
   producto de la orden: lote, vencimiento y cantidad; además la empresa y el N° de guía. Siempre se revisa
   antes de guardar. Lo puro (emparejar productos, fechas) se prueba en tests/unidad.js.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const PAR = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'y', 'o', 'a', 'en', 'un', 'una', 'unidad', 'unidades', 'caja', 'cajas', 'formato']);
  const toks = (s) => norm(s).split(' ').filter(w => w && !PAR.has(w) && (w.length > 2 || /\d/.test(w)));
  /** Puro: 'AAAA-MM-DD' desde 'AAAA-MM-DD', 'DD/MM/AAAA', 'MM/AAAA' (último día del mes) o ''. */
  function fechaISO(v) {
    const s = String(v || '').trim(); let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return s;
    if ((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if ((m = /^(\d{1,2})[\/.-](\d{4})$/.exec(s))) { const d = new Date(Number(m[2]), Number(m[1]), 0).getDate(); return `${m[2]}-${m[1].padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
    return '';
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

  const cfgConectada = (c) => !!(c && c.webhookUrl && c.token);
  function aJpeg(canvas) { return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]; }
  /** Páginas del archivo como JPEG base64 (foto o PDF; máx. 4). */
  async function paginas(file) {
    if (/^image\//.test(file.type)) {
      const url = URL.createObjectURL(file);
      try { return [await new Promise((ok, mal) => { const im = new Image(); im.onload = () => { const k = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); ok(aJpeg(c)); }; im.onerror = () => mal(new Error('No pude abrir la foto.')); im.src = url; })]; }
      finally { URL.revokeObjectURL(url); }
    }
    if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name || '')) {
      const lib = await window.SAR_Lector.cargarPdfJs(), pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise, out = [];
      for (let p = 1; p <= Math.min(pdf.numPages, 4); p++) { const pg = await pdf.getPage(p), vp = pg.getViewport({ scale: 1.6 }), c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; out.push(aJpeg(c)); }
      return out;
    }
    throw new Error('El documento debe ser una foto o un PDF.');
  }
  /** Lee el documento con el Apps Script. Devuelve {empresa, numero, fecha, lineas:[{descripcion,cantidad,lote,vence}]}. */
  async function leer(file, cfg) {
    if (!cfgConectada(cfg)) throw new Error('SIN_SCRIPT');
    const pags = await paginas(file);
    const r = await fetch(cfg.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: cfg.token, accion: 'documento', paginas: pags }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error === 'sin_clave' ? 'SIN_CLAVE' : (j.error === 'token' ? 'El token del script no coincide.' : (j.error === 'accion' || j.error === undefined ? 'SCRIPT_VIEJO' : String(j.error))));
    return { empresa: String(j.empresa || '').trim(), numero: String(j.numero || '').trim(), fecha: fechaISO(j.fecha), lineas: (j.lineas || []).map(x => ({ descripcion: String(x.descripcion || '').trim(), cantidad: Math.floor(Number(x.cantidad) || 0), lote: String(x.lote || '').trim().toUpperCase(), vence: fechaISO(x.vence) })).filter(x => x.descripcion) };
  }
  const api = { fechaISO, emparejar, leer, paginas, cfgConectada };
  window.SAR_GuiaLector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : null);
