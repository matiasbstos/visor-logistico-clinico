/* ==========================================================================
   BULTOS Y ETIQUETAS (v21.205)
   Como en el retail (orden → despacho/recepción → bulto): una ORDEN DE COMPRA llega en una RECEPCIÓN (REC-…, la guía)
   y cada caja física es un BULTO con su propio folio BUL-AAAA-NNNNNN y «bulto 3 de 10».
   · Etiqueta Zebra 100×60 mm a página completa: logo Visor, producto, lote, vencimiento, proveedor, OC, recepción,
     fecha, bodega, unidades por caja / cajas / total, «BULTO n / N», QR (teléfono) y código de barras (pistola).
   · Escanear: con la cámara (QR o barras) o con una pistola (escribe el código + Enter).
       – Consultar: qué hay en la caja; abrirla, decir cuánto queda, marcarla vacía.
       – Contar (pistolear): caja cerrada suma sola sus unidades; caja abierta pregunta cuánto queda; no cuenta dos veces la misma.
   Datos (sin reglas nuevas): Contadores/bulto-<folio> (tipo 'bulto'), correlativo en Contadores/correlativo-bultos-AAAA,
   conteos en Contadores/conteo-bultos-<fecha>.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v) || 0;
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || ''; };
  const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); };
  const hoyISO = () => new Date().toISOString().slice(0, 10);
  const fechaCL = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : (iso || ''); };
  const URL_APP = 'https://sarinventario.web.app/';

  // ---------------- lógica pura ----------------
  /** «CAJA X 100», «CAJA DE 50 UNIDADES», «X100», «CAJA 100 UNIDADES» → 100 (unidades por caja sugeridas). */
  function sugerirPorCaja(desc) {
    const t = String(desc || '').toUpperCase();
    const m = /CAJA\s*(?:X|DE|CON)?\s*(\d{1,5})/.exec(t) || /(?:^|\s)X\s*(\d{2,5})\s*(?:UN|UNIDADES|U\.?)?(?:\s|$)/.exec(t) || /(\d{2,5})\s*(?:UNIDADES|UN\.?|UDS?)\b/.exec(t);
    const n = m ? Number(m[1]) : 0; return n > 1 && n < 100000 ? n : 0;
  }
  /** Reparte el total en cajas: [50, 50, …, resto]. */
  function repartirCajas(total, porCaja) {
    const t = Math.max(0, Math.floor(num(total))), p = Math.max(1, Math.floor(num(porCaja))); if (!t) return [];
    const out = []; for (let r = t; r > 0; r -= p) out.push(Math.min(p, r)); return out;
  }
  /** Folio ↔ código de barras (solo dígitos, Code 128 C): BUL-2026-000123 ↔ 2026000123. */
  const digitos = (folio) => String(folio || '').replace(/\D/g, '');
  /** Lo que se lee (QR con URL, texto del folio o dígitos de la pistola) → folio. */
  function folioDe(leido) {
    const t = String(leido || '').trim(), m = /BUL-?(\d{4})-?(\d{6})/i.exec(t); if (m) return `BUL-${m[1]}-${m[2]}`;
    const d = t.replace(/\D/g, ''); return /^\d{10}$/.test(d) ? `BUL-${d.slice(0, 4)}-${d.slice(4)}` : '';
  }
  /** Conteo por bultos: suma por producto|lote|bodega (cerrada = su contenido; abierta = lo que se informó). */
  function resumirConteo(leidos) {
    const m = new Map();
    (leidos || []).forEach(b => { const k = [norm(b.nombre), b.lote || 'S/L', b.bodega || ''].join('|'); const e = m.get(k) || { nombre: b.nombre, lote: b.lote || 'S/L', vence: b.vence || '', bodega: b.bodega || '', cajas: 0, abiertas: 0, unidades: 0, insumoId: b.insumoId || '' }; e.cajas++; if (b.estado === 'ABIERTA') e.abiertas++; e.unidades += num(b.contado != null ? b.contado : b.contenido); m.set(k, e); });
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  // ---------------- librerías (QR y PDF) ----------------
  let qrLib = null;
  function cargarQR() {
    if (window.qrcode) return Promise.resolve(window.qrcode); if (qrLib) return qrLib;
    const urls = ['https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js', 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'];
    qrLib = new Promise((ok, mal) => { const prueba = (i) => { if (i >= urls.length) { qrLib = null; mal(new Error('No se pudo cargar el generador de QR (revisa la conexión).')); return; } const s = document.createElement('script'); s.src = urls[i]; s.onload = () => window.qrcode ? ok(window.qrcode) : prueba(i + 1); s.onerror = () => prueba(i + 1); document.head.appendChild(s); }; prueba(0); });
    return qrLib;
  }
  function matrizQR(texto) { const q = window.qrcode(0, 'M'); q.addData(texto); q.make(); const n = q.getModuleCount(), m = []; for (let r = 0; r < n; r++) { m.push([]); for (let c = 0; c < n; c++) m[r].push(q.isDark(r, c)); } return m; }
  let logoPNG = null;
  function cargarLogo() {
    if (logoPNG) return Promise.resolve(logoPNG);
    return new Promise(ok => { const im = new Image(); im.onload = () => { try { const c = document.createElement('canvas'); c.width = 1280; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); logoPNG = { d: c.toDataURL('image/png'), r: 640 / 200 }; ok(logoPNG); } catch (e) { ok(null); } }; im.onerror = () => ok(null); im.src = 'assets/logo/horizontal.svg'; });
  }

  // ---------------- etiqueta PDF 100×60 (página completa) ----------------
  async function pdf(lista, nombreArchivo, opc) {
    const J = window.jspdf && window.jspdf.jsPDF; if (!J) throw new Error('La librería de PDF aún no carga; intenta de nuevo en unos segundos.');
    await cargarQR(); const logo = await cargarLogo(), P = window.SAR_Precintos;
    const d = new J({ orientation: 'landscape', unit: 'mm', format: [100, 60] });
    lista.forEach((b, k) => {
      if (k) d.addPage([100, 60], 'landscape');
      d.setTextColor(0); d.setDrawColor(0);
      // cabecera: logo + BULTO n/N
      if (logo) d.addImage(logo.d, 'PNG', 2.5, 2, 22, 22 / logo.r);
      d.setFont('helvetica', 'bold'); d.setFontSize(7); d.text('BULTO', 63, 4.6, { align: 'right' }); d.setFontSize(16); d.text(`${b.n} / ${b.de}`, 63, 10.2, { align: 'right' });
      d.setLineWidth(0.35); d.line(2.5, 11.8, 64, 11.8);
      // producto
      d.setFontSize(9.5); const nom = d.splitTextToSize(String(b.nombre || '').toUpperCase(), 61).slice(0, 3); d.text(nom, 2.5, 15.6); let y = 15.6 + nom.length * 3.7;
      d.setFontSize(8.5); d.text(`Lote ${b.lote || 'S/L'}`, 2.5, y + 0.6); d.text(`Vence ${b.vence ? fechaCL(b.vence) : '—'}`, 64, y + 0.6, { align: 'right' }); y += 4.4;
      d.setFont('helvetica', 'normal'); d.setFontSize(6.8);
      [['Proveedor', b.proveedor], ['OC', b.oc], ['Recepción', b.rec], ['Recibido', (b.fechaRecepcion ? fechaCL(b.fechaRecepcion) : '') + (b.bodega ? ' · ' + b.bodega : '')]].forEach(([t, v]) => { if (!v) return; d.setFont('helvetica', 'normal'); d.text(t + ':', 2.5, y); d.setFont('helvetica', 'bold'); d.text(String(v).slice(0, 44), 17, y); y += 3.2; });
      // QR a la derecha (teléfono)
      const m = matrizQR(URL_APP + '#bulto=' + b.folio), lado = 32, cel = lado / m.length, x0 = 66, y0 = 2;
      m.forEach((fila, r) => fila.forEach((on, c) => { if (on) d.rect(x0 + c * cel, y0 + r * cel, cel + 0.02, cel + 0.02, 'F'); }));
      d.setFont('helvetica', 'bold'); d.setFontSize(7.5); d.text(b.folio, x0 + lado / 2, y0 + lado + 3.2, { align: 'center' });
      // banda de cantidades
      d.setLineWidth(0.35); d.line(2.5, 42.6, 97.5, 42.6);
      d.setFontSize(9); d.text(`${b.contenido} u. en esta caja`, 2.5, 46.6); d.setFont('helvetica', 'normal'); d.setFontSize(7); d.text(`${b.porCaja} u. por caja · ${b.de} caja${b.de === 1 ? '' : 's'} · total ${b.totalGrupo} u.`, 97.5, 46.6, { align: 'right' });
      // código de barras (pistola), ancho completo
      if (P && P.barras) { const a = P.barras(digitos(b.folio)), tot = a.reduce((s, w) => s + w, 0), mod = 90 / tot; let xx = 5; a.forEach((w, i) => { if (i % 2 === 0) d.rect(xx, 48.6, w * mod, 8.6, 'F'); xx += w * mod; }); }
    });
    const nom = nombreArchivo || ('bultos-' + lista[0].folio + (lista.length > 1 ? '_a_' + lista[lista.length - 1].folio : '') + '.pdf');
    const blob = d.output('blob'); if (opc && opc.soloBlob) return blob;
    const url = URL.createObjectURL(blob), w = window.open(url, '_blank');
    if (!w) d.save(nom); setTimeout(() => URL.revokeObjectURL(url), 120000);
    return { bytes: blob.size, paginas: lista.length };
  }

  // ---------------- datos ----------------
  const ref = (folio) => fs().doc(fs().collection(db(), 'Contadores'), 'bulto-' + folio);
  async function leer(folio) { const s = await fs().getDoc(ref(folio)); return s.exists() ? s.data() : null; }
  async function guardar(b, cambios, accion) {
    const h = (b.historial || []).concat([{ accion, por: usuario(), en: new Date().toISOString(), ...(cambios.contenido != null ? { contenido: cambios.contenido } : {}) }]).slice(-40);
    const x = { ...cambios, historial: h, actualizado: new Date().toISOString() };
    await Promise.race([fs().setDoc(ref(b.folio), x, { merge: true }), new Promise(r => setTimeout(r, 2500))]); Object.assign(b, x); return b;
  }
  /** Crea los bultos de un grupo (mismo producto, lote y vencimiento) con folios correlativos reservados de una vez. */
  async function crear(g) {
    const cajas = repartirCajas(g.total, g.porCaja); if (!cajas.length) throw new Error('Indica el total de unidades y cuántas vienen por caja.');
    if (cajas.length > 300) throw new Error('Son más de 300 cajas: revisa las unidades por caja.');
    const f = fs(), anio = new Date().getFullYear(), rc = f.doc(f.collection(db(), 'Contadores'), 'correlativo-bultos-' + anio);
    const ini = await f.runTransaction(db(), async (tx) => { const s = await tx.get(rc), v = s.exists() ? num(s.data().valor) : 0; tx.set(rc, { valor: v + cajas.length, actualizado: new Date().toISOString() }); return v + 1; });
    const ahora = new Date().toISOString(), grupo = `BUL-${anio}-${String(ini).padStart(6, '0')}`;
    const lista = cajas.map((q, i) => ({ tipo: 'bulto', folio: `BUL-${anio}-${String(ini + i).padStart(6, '0')}`, grupo, n: i + 1, de: cajas.length, contenido: q, inicial: q, porCaja: num(g.porCaja), totalGrupo: cajas.reduce((s, x) => s + x, 0), estado: 'CERRADA',
      nombre: g.nombre, insumoId: g.insumoId || '', codigoMP: g.codigoMP || '', bodega: g.bodega || '', lote: g.lote || 'S/L', vence: g.vence || '', proveedor: g.proveedor || '', oc: g.oc || '', rec: g.rec || '', fechaRecepcion: g.fechaRecepcion || hoyISO(), creadoEn: ahora, creadoPor: usuario(), historial: [{ accion: 'CREADO', por: usuario(), en: ahora }] }));
    for (const b of lista) await f.setDoc(ref(b.folio), b);
    return lista;
  }
  async function listar(lim) { const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Contadores'), f.where('tipo', '==', 'bulto'), f.limit(lim || 2000))), l = []; sn.forEach(d => l.push(d.data())); return l.sort((a, b) => String(b.folio).localeCompare(String(a.folio))); }

  // ---------------- diálogo: crear o reimprimir etiquetas ----------------
  let insumos = null;
  async function cargarInsumos() { if (insumos) return insumos; const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(5000))), l = []; sn.forEach(d => l.push({ id: d.id, ...d.data() })); insumos = l; return l; }
  const lotesDe = (d) => (Array.isArray(d.batches) && d.batches.length ? d.batches : [{ batch: d.batch || 'S/L', quantity: d.quantity, expirationDate: d.expirationDate || '' }]).filter(b => num(b.quantity) > 0);

  function ventana(titulo, html) {
    document.querySelectorAll('.bu-ov').forEach(x => x.remove());
    const ov = document.createElement('div'); ov.className = 'bu-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="bu-c"><div class="bu-cab"><h3>${esc(titulo)}</h3><button type="button" class="fp-x bu-x" aria-label="Cerrar">×</button></div><div class="bu-b">${html}</div></div>`;
    const cerrar = () => { ov.remove(); document.removeEventListener('keydown', tecla, true); if (ov._fin) ov._fin(); };
    const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.bu-x')) cerrar(); }); document.addEventListener('keydown', tecla, true);
    document.body.appendChild(ov); ov.cerrar = cerrar; return ov;
  }

  /** pref: {nombre, insumoId, codigoMP, bodega, lote, vence, total, proveedor, oc, rec, fechaRecepcion, lineas:[…mismos campos]} */
  async function etiquetar(pref) {
    const p = pref || {}, lineas = Array.isArray(p.lineas) && p.lineas.length ? p.lineas : null;
    const ov = ventana('Etiquetas de bulto', `<div class="bu-tabs"><button type="button" class="on" data-t="nueva">Nuevas etiquetas</button><button type="button" data-t="re">Reimprimir existentes</button></div><div class="bu-pane" data-p="nueva"></div><div class="bu-pane" data-p="re" hidden></div>`);
    ov.querySelectorAll('.bu-tabs button').forEach(b => b.onclick = () => { ov.querySelectorAll('.bu-tabs button').forEach(x => x.classList.toggle('on', x === b)); ov.querySelectorAll('.bu-pane').forEach(x => { x.hidden = x.dataset.p !== b.dataset.t; }); if (b.dataset.t === 're') pintarReimprimir(ov.querySelector('[data-p="re"]')); });
    const pane = ov.querySelector('[data-p="nueva"]');
    let sel = lineas ? { ...lineas[0], idx: 0 } : { ...p };
    const pintar = () => {
      const sug = sugerirPorCaja(sel.nombre), porCaja = num(sel.porCaja) || sug || '', cajas = repartirCajas(sel.total, porCaja);
      pane.innerHTML = `${lineas ? `<label class="bu-l">Producto de esta recepción<select id="bu-lin" class="si-in">${lineas.map((l, i) => `<option value="${i}"${i === sel.idx ? ' selected' : ''}>${esc(l.nombre)} · ${num(l.total)} u.${l.lote ? ' · lote ' + esc(l.lote) : ''}${l.hecho ? ' ✔' : ''}</option>`).join('')}</select></label>`
          : `<label class="bu-l">Producto<input id="bu-q" class="si-in" placeholder="Busca por nombre…" value="${esc(sel.nombre || '')}" autocomplete="off"></label><div id="bu-sug" class="bu-sug"></div>`}
        <div class="bu-g3"><label class="bu-l">Lote<input id="bu-lote" class="si-in" value="${esc(sel.lote || '')}"></label><label class="bu-l">Vence<input id="bu-vence" type="date" class="si-in" value="${esc(sel.vence || '')}"></label><label class="bu-l">Bodega<input id="bu-bod" class="si-in" value="${esc(sel.bodega || '')}"></label></div>
        <div class="bu-g3"><label class="bu-l">Total de unidades<input id="bu-total" type="number" min="1" class="si-in" value="${num(sel.total) || ''}" inputmode="numeric"></label><label class="bu-l">Unidades por caja<input id="bu-pc" type="number" min="1" class="si-in" value="${porCaja}" inputmode="numeric">${sug && !num(sel.porCaja) ? '<small>Sugerido por la descripción («caja x ' + sug + '»)</small>' : ''}</label><label class="bu-l">Cajas<input id="bu-cajas" type="number" min="1" class="si-in" value="${cajas.length || ''}" inputmode="numeric"><small>Si cambias las cajas, se recalculan las unidades por caja.</small></label></div>
        <div class="bu-g3"><label class="bu-l">Proveedor<input id="bu-prov" class="si-in" value="${esc(sel.proveedor || '')}"></label><label class="bu-l">Orden de compra<input id="bu-oc" class="si-in" value="${esc(sel.oc || '')}"></label><label class="bu-l">Fecha de recepción<input id="bu-fr" type="date" class="si-in" value="${esc(sel.fechaRecepcion || hoyISO())}"></label></div>
        ${sel.rec ? `<p class="si-v">Recepción ${esc(sel.rec)}</p>` : ''}
        <div class="bu-prev">${cajas.length ? `<b>${cajas.length} etiqueta${cajas.length === 1 ? '' : 's'}</b>: ${cajas.length > 1 && cajas[cajas.length - 1] !== cajas[0] ? `${cajas.length - 1} caja(s) de ${cajas[0]} u. y la última de ${cajas[cajas.length - 1]} u.` : `cajas de ${cajas[0]} u.`} · total ${cajas.reduce((s, x) => s + x, 0)} u.` : 'Indica el total y las unidades por caja.'}</div>
        <div class="fp-facc"><button type="button" class="btn btn-primary" id="bu-gen"${cajas.length ? '' : ' disabled'}><i class="ph-bold ph-printer"></i> Generar e imprimir</button></div>`;
      const v = (id) => (pane.querySelector('#' + id) || {}).value;
      const leer2 = () => { sel.lote = v('bu-lote'); sel.vence = v('bu-vence'); sel.bodega = v('bu-bod'); sel.total = num(v('bu-total')); sel.porCaja = num(v('bu-pc')); sel.proveedor = v('bu-prov'); sel.oc = v('bu-oc'); sel.fechaRecepcion = v('bu-fr'); };
      ['bu-total', 'bu-pc'].forEach(id => { const e = pane.querySelector('#' + id); if (e) e.onchange = () => { leer2(); pintar(); }; });
      const ec = pane.querySelector('#bu-cajas'); if (ec) ec.onchange = () => { leer2(); const n = Math.max(1, num(ec.value)); if (sel.total) sel.porCaja = Math.ceil(sel.total / n); pintar(); };
      const ls = pane.querySelector('#bu-lin'); if (ls) ls.onchange = () => { const i = num(ls.value); sel = { ...lineas[i], idx: i }; pintar(); };
      const q = pane.querySelector('#bu-q'); if (q) q.oninput = async () => {
        const t = norm(q.value), box = pane.querySelector('#bu-sug'); if (t.length < 2) { box.innerHTML = ''; return; }
        const l = (await cargarInsumos()).filter(i => norm(i.name).includes(t)).slice(0, 8);
        box.innerHTML = l.map(i => lotesDe(i).map(b => `<button type="button" class="bu-op" data-id="${esc(i.id)}" data-lote="${esc(b.batch || 'S/L')}" data-v="${esc(b.expirationDate || '')}" data-q="${num(b.quantity)}"><b>${esc(i.name)}</b><small>${esc(i.location || '')} · lote ${esc(b.batch || 'S/L')}${b.expirationDate ? ' · vence ' + esc(fechaCL(b.expirationDate)) : ''} · ${num(b.quantity)} u.</small></button>`).join('')).join('') || '<p class="si-v">Sin coincidencias.</p>';
        box.querySelectorAll('.bu-op').forEach(b => b.onclick = () => { const i = insumos.find(x => x.id === b.dataset.id); sel = { ...sel, nombre: i.name, insumoId: i.id, codigoMP: i.codigoMP || '', bodega: i.location || '', lote: b.dataset.lote, vence: b.dataset.v, total: num(b.dataset.q), porCaja: 0, proveedor: sel.proveedor || i.provider || '' }; pintar(); });
      };
      pane.querySelector('#bu-gen').onclick = async (e) => {
        leer2(); if (!sel.nombre) { toast('Etiquetas', 'Elige el producto.', 'warning'); return; }
        e.target.disabled = true;
        try {
          const l = await crear(sel); await pdf(l);
          if (lineas) { lineas[sel.idx].hecho = true; const sig = lineas.findIndex(x => !x.hecho); if (sig >= 0) { sel = { ...lineas[sig], idx: sig }; } }
          if (window.SAR_Progreso && window.SAR_Progreso.exito) window.SAR_Progreso.exito({ titulo: `${l.length} etiqueta${l.length === 1 ? '' : 's'} lista${l.length === 1 ? '' : 's'}`, texto: esc(l[0].folio) + (l.length > 1 ? ' a ' + esc(l[l.length - 1].folio) : '') });
          pintar();
        } catch (er) { toast('No se generaron', er.message || String(er), 'error'); e.target.disabled = false; }
      };
    };
    pintar();
  }
  async function pintarReimprimir(el) {
    el.innerHTML = '<p class="si-v">Cargando bultos…</p>';
    let todos = []; try { todos = await listar(); } catch (e) { el.innerHTML = '<p class="si-v">No pude leer los bultos.</p>'; return; }
    let q = ''; const marcados = new Set();
    const pinta = () => {
      const t = norm(q), l = todos.filter(b => !t || norm(b.folio + ' ' + b.nombre + ' ' + b.lote + ' ' + b.oc).includes(t)).slice(0, 150);
      el.innerHTML = `<input class="si-in" id="bu-rq" placeholder="Folio, producto, lote u OC…" value="${esc(q)}"><div class="bu-lista">${l.map(b => `<label class="bu-fila"><input type="checkbox" data-f="${esc(b.folio)}"${marcados.has(b.folio) ? ' checked' : ''}><span><b>${esc(b.folio)}</b> · bulto ${b.n}/${b.de} · ${esc(b.nombre)}<small>lote ${esc(b.lote)} · ${b.contenido} u. · ${esc(b.estado)}${b.bodega ? ' · ' + esc(b.bodega) : ''}</small></span></label>`).join('') || '<p class="si-v">Sin bultos.</p>'}</div><div class="fp-facc"><button type="button" class="btn btn-primary" id="bu-rp"${marcados.size ? '' : ' disabled'}>Reimprimir ${marcados.size || ''}</button></div>`;
      const i = el.querySelector('#bu-rq'); i.oninput = () => { q = i.value; const p0 = i.selectionStart; pinta(); const j = el.querySelector('#bu-rq'); j.focus(); j.setSelectionRange(p0, p0); };
      el.querySelectorAll('[data-f]').forEach(c => c.onchange = () => { if (c.checked) marcados.add(c.dataset.f); else marcados.delete(c.dataset.f); el.querySelector('#bu-rp').disabled = !marcados.size; el.querySelector('#bu-rp').textContent = 'Reimprimir ' + (marcados.size || ''); });
      el.querySelector('#bu-rp').onclick = async () => { try { await pdf(todos.filter(b => marcados.has(b.folio)).sort((a, b) => a.folio.localeCompare(b.folio))); } catch (e) { toast('No se pudo', e.message, 'error'); } };
    };
    pinta();
  }

  // ---------------- escanear: consultar y contar ----------------
  let lector = null;
  async function camara(el, alLeer) {
    if (!window.Html5Qrcode) { el.innerHTML = '<p class="si-v">La cámara no está disponible: usa la pistola o escribe el folio.</p>'; return; }
    try { lector = new window.Html5Qrcode(el.id); await lector.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.8, height: Math.min(w, h) * 0.55 }) }, (txt) => alLeer(txt), () => {}); }
    catch (e) { el.innerHTML = '<p class="si-v">No se pudo abrir la cámara (permiso o equipo sin cámara). Usa la pistola o escribe el folio.</p>'; lector = null; }
  }
  async function pararCamara() { if (lector) { try { await lector.stop(); } catch (e) { /* ya detenida */ } try { lector.clear(); } catch (e) { /* nada */ } lector = null; } }

  function fichaBulto(b) {
    return `<div class="bu-card"><div class="bu-card-h"><b>${esc(b.folio)}</b><span class="bu-est bu-est-${esc(b.estado)}">${esc(b.estado === 'CERRADA' ? 'Cerrada' : b.estado === 'ABIERTA' ? 'Abierta' : 'Vacía')}</span></div>
      <p class="bu-n">${esc(b.nombre)}</p><p class="si-v">Bulto ${b.n} de ${b.de} · lote ${esc(b.lote)}${b.vence ? ' · vence ' + esc(fechaCL(b.vence)) : ''}</p>
      <p class="bu-q"><b>${b.contenido}</b> u. en la caja <small>(${b.porCaja} por caja · total del lote ${b.totalGrupo} u.)</small></p>
      <p class="si-v">${esc(b.bodega || '')}${b.proveedor ? ' · ' + esc(b.proveedor) : ''}${b.oc ? ' · OC ' + esc(b.oc) : ''}${b.rec ? ' · ' + esc(b.rec) : ''}</p></div>`;
  }
  async function escanear(modo) {
    const conteo = modo === 'conteo', leidos = [], vistos = new Set();
    const ov = ventana(conteo ? 'Contar por bultos (pistolear)' : 'Escanear bulto', `
      <div id="bu-cam" class="bu-cam"></div>
      <div class="bu-man"><input id="bu-in" class="si-in" placeholder="Pistola: escanea aquí · o escribe el folio y Enter" autocomplete="off" inputmode="numeric"><button type="button" class="btn btn-secondary" id="bu-ok">Buscar</button></div>
      <div id="bu-res"></div>${conteo ? '<div id="bu-sum"></div>' : ''}`);
    ov._fin = pararCamara;
    const res = ov.querySelector('#bu-res'), inp = ov.querySelector('#bu-in'); let ocupado = false, ultimo = '', tUlt = 0;
    const pintarSuma = async () => {
      if (!conteo) return; const el = ov.querySelector('#bu-sum'), r = resumirConteo(leidos); let ins = []; try { ins = await cargarInsumos(); } catch (e) { /* sin datos */ }
      const sistema = (x) => { const d = ins.filter(i => (x.insumoId && i.id === x.insumoId) || (norm(i.name) === norm(x.nombre) && (i.location || '') === x.bodega)); let q = 0; d.forEach(i => lotesDe(i).forEach(b => { if ((b.batch || 'S/L') === x.lote) q += num(b.quantity); })); return d.length ? q : null; };
      el.innerHTML = r.length ? `<h4 class="fp-sub">Contado: ${leidos.length} caja(s)</h4><div class="fp-tw"><table class="si-tb"><thead><tr><th>Producto</th><th>Lote</th><th>Cajas</th><th>Contado</th><th>Sistema</th></tr></thead><tbody>${r.map(x => { const s = sistema(x); return `<tr><td>${esc(x.nombre)}<small class="si-v"> ${esc(x.bodega)}</small></td><td>${esc(x.lote)}</td><td>${x.cajas}${x.abiertas ? ` (${x.abiertas} abierta${x.abiertas > 1 ? 's' : ''})` : ''}</td><td><b>${x.unidades}</b></td><td class="${s != null && s !== x.unidades ? 'si-poco' : ''}">${s == null ? '—' : s}</td></tr>`; }).join('')}</tbody></table></div><p class="si-v">«Sistema» incluye todo el lote en esa bodega, también lo que no tiene etiqueta.</p><div class="fp-facc"><button type="button" class="btn btn-primary" id="bu-guardar">Guardar conteo</button></div>` : '<p class="si-v">Escanea las cajas: las cerradas suman solas; en las abiertas te pregunto cuánto queda.</p>';
      const g = el.querySelector('#bu-guardar'); if (g) g.onclick = async () => { const f = fs(), id = 'conteo-bultos-' + new Date().toISOString().replace(/[:.]/g, '-'); try { await Promise.race([f.setDoc(f.doc(f.collection(db(), 'Contadores'), id), { tipo: 'conteo-bultos', por: usuario(), en: new Date().toISOString(), cajas: leidos.map(b => ({ folio: b.folio, contado: num(b.contado != null ? b.contado : b.contenido) })), resumen: r }), new Promise(x => setTimeout(x, 2500))]); if (window.SAR_Progreso && window.SAR_Progreso.exito) window.SAR_Progreso.exito({ titulo: 'Conteo guardado', texto: `${leidos.length} caja(s)` }); } catch (e) { toast('No se guardó', e.message, 'error'); } };
    };
    const pedirQueda = (b, ok) => {
      res.innerHTML = fichaBulto(b) + `<div class="bu-queda"><b>Caja abierta: ¿cuántas unidades quedan?</b><div class="bu-man"><button type="button" class="si-pnav" data-d="-1">−</button><input id="bu-qq" type="number" min="0" max="${b.inicial || b.porCaja}" class="si-in si-cn" value="${b.contenido}" inputmode="numeric"><button type="button" class="si-pnav" data-d="1">+</button><button type="button" class="btn btn-primary" id="bu-qok">Listo</button><button type="button" class="btn btn-secondary" id="bu-vac">Está vacía</button></div></div>`;
      const qq = res.querySelector('#bu-qq'); qq.focus(); qq.select();
      res.querySelectorAll('[data-d]').forEach(x => x.onclick = () => { qq.value = Math.max(0, num(qq.value) + num(x.dataset.d)); });
      const fin = async (n) => { const q = Math.max(0, Math.floor(n)); await guardar(b, q === 0 ? { contenido: 0, estado: 'VACIA' } : { contenido: q, estado: 'ABIERTA' }, q === 0 ? 'VACIA' : 'QUEDAN'); ok(q); };
      res.querySelector('#bu-qok').onclick = () => fin(num(qq.value)); qq.onkeydown = (e) => { if (e.key === 'Enter') fin(num(qq.value)); };
      res.querySelector('#bu-vac').onclick = () => fin(0);
    };
    const procesar = async (txt) => {
      const folio = folioDe(txt); if (!folio) { res.innerHTML = `<p class="cfg-mal">«${esc(String(txt).slice(0, 40))}» no es una etiqueta de bulto.</p>`; return; }
      if (ocupado || (folio === ultimo && Date.now() - tUlt < 2500)) return; ultimo = folio; tUlt = Date.now(); ocupado = true;
      try {
        const b = await leer(folio); if (!b) { res.innerHTML = `<p class="cfg-mal">${esc(folio)} no existe en el sistema.</p>`; return; }
        try { if (window.SAR_Sonidos) window.SAR_Sonidos.tocar('ok'); } catch (e) { /* sin sonido */ }
        if (navigator.vibrate) navigator.vibrate(60);
        if (!conteo) {
          res.innerHTML = fichaBulto(b) + `<div class="fp-facc">${b.estado === 'CERRADA' ? '<button type="button" class="btn btn-primary" data-a="abrir">Abrir caja</button>' : ''}${b.estado === 'ABIERTA' ? '<button type="button" class="btn btn-primary" data-a="queda">¿Cuánto queda?</button>' : ''}${b.estado !== 'VACIA' ? '<button type="button" class="btn btn-secondary" data-a="vacia">Marcar vacía</button>' : '<button type="button" class="btn btn-secondary" data-a="cerrar">Volver a cerrada (llena)</button>'}<button type="button" class="btn btn-secondary" data-a="re">Reimprimir etiqueta</button></div>`;
          res.querySelectorAll('[data-a]').forEach(x => x.onclick = async () => {
            const a = x.dataset.a;
            if (a === 'abrir' || a === 'queda') pedirQueda(b, () => { ultimo = ''; procesar(folio); });
            else if (a === 'vacia') { await guardar(b, { contenido: 0, estado: 'VACIA' }, 'VACIA'); ultimo = ''; procesar(folio); }
            else if (a === 'cerrar') { await guardar(b, { contenido: b.inicial || b.porCaja, estado: 'CERRADA' }, 'CERRADA'); ultimo = ''; procesar(folio); }
            else if (a === 're') pdf([b]).catch(e => toast('No se pudo', e.message, 'error'));
          });
          return;
        }
        if (vistos.has(folio)) { res.innerHTML = `<p class="si-v">${esc(folio)} ya estaba contado: no se suma dos veces.</p>`; return; }
        if (b.estado === 'VACIA') { res.innerHTML = fichaBulto(b) + '<p class="si-v">Esta caja figura vacía: no suma. Si tiene producto, ábrela desde «Escanear bulto».</p>'; return; }
        if (b.estado === 'ABIERTA') { pedirQueda(b, (q) => { b.contado = q; vistos.add(folio); leidos.push(b); res.innerHTML = `<p class="cfg-ok">✔ ${esc(folio)}: ${q} u. (abierta)</p>`; pintarSuma(); inp.focus(); }); return; }
        b.contado = b.contenido; vistos.add(folio); leidos.push(b); res.innerHTML = `<p class="cfg-ok">✔ ${esc(folio)} · ${esc(b.nombre)}: ${b.contenido} u. (cerrada)</p>`; pintarSuma();
      } catch (e) { res.innerHTML = `<p class="cfg-mal">No se pudo leer: ${esc(e.message || e)}</p>`; }
      finally { ocupado = false; }
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const t = inp.value; inp.value = ''; procesar(t); } };
    ov.querySelector('#bu-ok').onclick = () => { const t = inp.value; inp.value = ''; procesar(t); };
    pintarSuma(); camara(ov.querySelector('#bu-cam'), procesar); setTimeout(() => inp.focus(), 200);
    return ov;
  }

  // ---------------- pantalla «Bultos y etiquetas» ----------------
  async function abrir() {
    const r = document.getElementById('bu-root'); if (!r) return;
    r.innerHTML = `<div class="si-wrap si-ancho"><div class="si-cab"><div><h2 class="si-t">Bultos y etiquetas</h2><p class="si-s">Cada caja con su etiqueta: producto, lote, vencimiento, cuántas unidades trae y «bulto 3 de 10». Se lee con el teléfono (QR) o con pistola (código de barras).</p></div></div>
      <div class="bu-acc"><button type="button" class="bu-big" data-x="nueva"><i class="ph-bold ph-tag"></i><b>Crear etiquetas</b><small>Para un producto y lote (o reimprimir)</small></button><button type="button" class="bu-big" data-x="ver"><i class="ph-bold ph-scan"></i><b>Escanear bulto</b><small>Ver qué tiene, abrir la caja, cuánto queda</small></button><button type="button" class="bu-big" data-x="contar"><i class="ph-bold ph-barcode"></i><b>Contar por bultos</b><small>Pistolea las cajas: las cerradas suman solas</small></button></div>
      <h3 class="si-h">Bultos registrados</h3><div id="bu-tab"><p class="si-v">Cargando…</p></div></div>`;
    r.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { const x = b.dataset.x; if (x === 'nueva') etiquetar({}); else escanear(x === 'contar' ? 'conteo' : 'ver').then(ov => { if (ov) { const o = ov._fin; ov._fin = () => { o(); abrir(); }; } }); });
    try {
      const l = await listar(), t = r.querySelector('#bu-tab'), est = (e) => l.filter(b => b.estado === e).length;
      t.innerHTML = l.length ? `<p class="si-v">${l.length} bulto(s): ${est('CERRADA')} cerrados · ${est('ABIERTA')} abiertos · ${est('VACIA')} vacíos.</p><div class="fp-tw"><table class="si-tb"><thead><tr><th>Folio</th><th>Producto</th><th>Lote</th><th>Bulto</th><th>Contenido</th><th>Estado</th><th>Bodega</th></tr></thead><tbody>${l.slice(0, 300).map(b => `<tr><td>${esc(b.folio)}</td><td>${esc(b.nombre)}</td><td>${esc(b.lote)}</td><td>${b.n}/${b.de}</td><td>${b.contenido}/${b.inicial || b.porCaja}</td><td><span class="bu-est bu-est-${esc(b.estado)}">${esc(b.estado)}</span></td><td>${esc(b.bodega)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="si-v">Aún no hay bultos etiquetados.</p>';
    } catch (e) { r.querySelector('#bu-tab').innerHTML = '<p class="si-v">No pude leer los bultos.</p>'; }
  }

  /** Después de una recepción: ofrece etiquetar sus productos (espera a que no haya otra ventana abierta). */
  function ofrecerRecepcion(o) {
    let n = 0; const t = setInterval(async () => {
      n++; if (document.querySelector('.modal-overlay, .sar-conf, .r-prog, .bu-ov, .sar-ok') && n < 120) return; clearInterval(t);
      const P = window.SAR_Progreso; const si = P && P.confirmar ? await P.confirmar({ titulo: '¿Etiquetar los bultos?', texto: `Recepción <b>${esc(o.rec || '')}</b>: imprime una etiqueta por caja con lote, vencimiento y cantidad.`, si: 'Etiquetar', no: 'Ahora no' }) : false;
      if (si) etiquetar({ lineas: o.lineas });
    }, 1000);
  }
  /** Al abrir el visor desde el QR de una etiqueta (#bulto=BUL-…). */
  function revisarHash() { const m = /bulto=([A-Z0-9-]+)/i.exec(window.location.hash || ''); if (!m) return; const folio = folioDe(m[1]); history.replaceState(null, '', window.location.pathname + '#view-bultos'); let k = 0; const t = setInterval(() => { k++; if (!(usuario() && fs() && db()) && k < 60) return; clearInterval(t); escanear('ver').then(ov => { const i = ov && ov.querySelector('#bu-in'); if (i) { i.value = folio; ov.querySelector('#bu-ok').click(); } }); }, 1000); }
  if (typeof module === 'undefined' && typeof window.addEventListener === 'function') { window.addEventListener('hashchange', revisarHash); if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', revisarHash); else revisarHash(); }

  window.SAR_Bultos = { cargarQR, matrizQR, abrir, etiquetar, escanear, ofrecerRecepcion, pdf, crear, listar, sugerirPorCaja, repartirCajas, folioDe, digitos, resumirConteo };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SAR_Bultos;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: null, addEventListener() {} });
