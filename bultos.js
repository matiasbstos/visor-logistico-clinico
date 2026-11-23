/* ==========================================================================
   BULTOS Y ETIQUETAS (v21.205 · por orden de compra y registro de impresión v21.223)
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
  /** v21.238: unidades que aporta una etiqueta al total (las cajas interiores ya están dentro de su caja grande) */
  const uds = (b) => b && b.nivel === 'interior' ? 0 : num(b && b.inicial != null ? b.inicial : b && b.contenido);
  const grandes = (l) => (l || []).filter(b => b.nivel !== 'interior');

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
  /** Reparte el total en N cajas contadas (lo más parejo posible): 2200 en 10 → 10 × 220; 105 en 10 → 5 × 11 y 5 × 10. */
  function repartirEnCajas(total, cajas) {
    const t = Math.max(0, Math.floor(num(total))), c = Math.max(0, Math.floor(num(cajas))); if (!t || !c) return [];
    const n = Math.min(c, t), base = Math.floor(t / n), resto = t % n; return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
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
    return new Promise(ok => { const im = new Image(); im.onload = () => { try { const c = document.createElement('canvas'); c.width = 560; c.height = 175; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); logoPNG = { d: c.toDataURL('image/jpeg', 0.92), r: 640 / 200 }; ok(logoPNG); } catch (e) { ok(null); } }; im.onerror = () => ok(null); im.src = 'assets/logo/horizontal.svg'; });
  }

  // ---------------- etiqueta PDF 100×60 (página completa) ----------------
  async function pdf(lista, nombreArchivo, opc) {
    const J = window.jspdf && window.jspdf.jsPDF; if (!J) throw new Error('La librería de PDF aún no carga; intenta de nuevo en unos segundos.');
    await cargarQR(); const logo = await cargarLogo(), P = window.SAR_Precintos;
    const d = new J({ orientation: 'landscape', unit: 'mm', format: [100, 60] });
    /* v21.238: etiqueta «tipo tienda»: descripción grande, cantidad grande y código de barras ancho para la pistola.
       Caja grande: «1000 u. = 20 cajas × 50». Caja interior: «50 u.» y a qué caja grande pertenece. */
    /* módulo entero de 5 puntos a 203 dpi (0,625 mm) y zona libre de 10 módulos a cada lado (la pistola láser la necesita) */
    const PUNTO = 25.4 / 203, MOD = 5 * PUNTO;
    const barras = (b, y, h) => { if (!(P && P.barras)) return 0; const a = P.barras(digitos(b.folio)), tot = a.reduce((s2, w) => s2 + w, 0), mod = Math.min(MOD, Math.max(1, Math.floor(66 / tot / PUNTO)) * PUNTO), x0 = Math.round((3 + 10 * mod) / PUNTO) * PUNTO;   /* v21.242: cada borde de barra cae justo en un punto de la impresora */ let xx = x0; a.forEach((w, i) => { if (i % 2 === 0) d.rect(xx, y, w * mod, h, 'F'); xx += w * mod; }); return (x0 + xx) / 2; };
    const qr = (b, x0, y0, lado) => { const m = matrizQR(URL_APP + '#bulto=' + b.folio), cel = lado / m.length; m.forEach((fila, r) => fila.forEach((on, c) => { if (on) d.rect(x0 + c * cel, y0 + r * cel, cel + 0.02, cel + 0.02, 'F'); })); };
    lista.forEach((b, k) => {
      if (k) d.addPage([100, 60], 'landscape');
      d.setTextColor(0); d.setDrawColor(0);
      const interior = b.nivel === 'interior';
      if (logo) d.addImage(logo.d, 'JPEG', 3, 2.2, 18, 18 / logo.r, 'logo', 'FAST');
      d.setFont('helvetica', 'bold'); d.setFontSize(7); d.text(interior ? `CAJA ${num(b.padreN)}/${num(b.padreDe)} · INTERIOR` : 'CAJA', 97, 4.4, { align: 'right' });
      d.setFontSize(13); d.text(`${b.n} / ${b.de}`, 97, 9.4, { align: 'right' });
      d.setLineWidth(0.35); d.line(3, 11, 97, 11);
      // descripción grande (como etiqueta de tienda)
      const nomT = String(b.nombre || '').toUpperCase(); let tam = 12; d.setFontSize(tam); let nom = d.splitTextToSize(nomT, 94);
      if (nom.length > 2) { tam = 10; d.setFontSize(tam); nom = d.splitTextToSize(nomT, 94); if (nom.length > 3) { nom = nom.slice(0, 3); nom[2] = nom[2].replace(/\s*\S*$/, '') + '…'; } }
      const paso = tam === 12 ? 4.6 : 3.9; d.text(nom, 3, 16); let y = 16 + nom.length * paso;
      d.setFontSize(8.5); d.text(`Lote ${b.lote || 'S/L'}`, 3, y); d.text(`Vence ${b.vence ? fechaCL(b.vence) : '—'}`, 97, y, { align: 'right' }); y += 1.5;
      // cantidad grande
      const cant = `${num(b.inicial != null ? b.inicial : b.contenido)} u.`; d.setFontSize(24); d.text(cant, 3, y + 9); const finCant = 3 + d.getTextWidth(cant) + 4;
      d.setFont('helvetica', 'normal'); d.setFontSize(7.5);
      const ajusta = (t, ancho) => { let x = String(t); while (x.length > 4 && d.getTextWidth(x) > ancho) x = x.slice(0, -2); return x === String(t) ? x : x.replace(/\s*$/, '') + '…'; };
      const det = interior ? [`Va dentro de ${b.padre || 'la caja grande'}`, b.bodega || ''] : [b.subcajas ? `= ${num(b.subcajas)} cajas interiores × ${num(b.porSubcaja)} u.` : `${num(b.porCaja)} u. por caja · ${num(b.de)} caja${num(b.de) === 1 ? '' : 's'}`, `Total en cajas: ${num(b.totalGrupo)} u.${b.bodega ? ' · ' + b.bodega : ''}`];
      det.filter(Boolean).forEach((t, i) => d.text(ajusta(t, 97 - finCant), 97, y + 4.2 + i * 3.4, { align: 'right' }));
      y += 12;
      if (!interior) { const inf = [b.proveedor, b.oc ? 'OC ' + b.oc : '', b.rec, b.fechaRecepcion ? 'Recibido ' + fechaCL(b.fechaRecepcion) : ''].filter(Boolean).join(' · '); if (inf) { d.setFontSize(7); d.text(ajusta(inf, 94), 3, y); } }
      // código de barras (pistola) + QR chico (teléfono)
      const cx = barras(b, 44, 10.5) || 40; qr(b, 81.5, 41.5, 15.5);
      d.setFont('helvetica', 'bold'); d.setFontSize(7.5); d.text(b.folio, cx, 57.6, { align: 'center' });
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
  /** v21.249 (Howard): un tag «CONTADO» (estado TAG) usa un folio BUL pero aún no es una caja: no se cuenta ni se despacha. */
  const esTag = (b) => !!b && b.tipo === 'tag-conteo';
  const avisoTag = (folio) => `N° ${String(folio || '').slice(-6)} es un tag CONTADO: todavía no es una caja.`;
  async function guardar(b, cambios, accion, det) {
    /* v21.223: relee la caja antes de escribir (otro equipo pudo abrirla, contarla o imprimirla) para no pisar su historial */
    try { const fr = await Promise.race([leer(b.folio), new Promise(r => setTimeout(() => r(null), 2500))]); if (fr) Object.assign(b, fr); } catch (e) { /* sin conexión: sigue con lo local */ }
    if (typeof cambios === 'function') cambios = cambios(b);
    const h = (b.historial || []).concat([{ accion, por: usuario(), en: new Date().toISOString(), ...(cambios.contenido != null ? { contenido: cambios.contenido } : {}), ...(det || {}) }]).slice(-40);
    const x = { ...cambios, historial: h, actualizado: new Date().toISOString() };
    await Promise.race([fs().setDoc(ref(b.folio), x, { merge: true }), new Promise(r => setTimeout(r, 2500))]); Object.assign(b, x); return b;
  }
  /** Crea los bultos de un grupo (mismo producto, lote y vencimiento) con folios correlativos reservados de una vez. */
  /** v21.238: plan de cajas: [{q, hijos:[q…]}] (cajas grandes y, si se indica, sus cajas interiores). Puro. */
  function planCajas(g) {
    const cajas = num(g.cajas) > 0 ? repartirEnCajas(g.total, g.cajas) : repartirCajas(g.total, g.porCaja), sub = Math.floor(num(g.subPor));
    return cajas.map(q => ({ q, hijos: sub > 0 && sub < q ? repartirCajas(q, sub) : [] }));
  }
  /* v21.247: etiquetas sin internet. El folio va impreso y lo lee la pistola (10 dígitos), así que no puede ser provisional:
     con internet cada equipo reserva un tramo de folios BUL (60) del mismo contador; sin internet usa los de su tramo.
     Las cajas se guardan con setDoc (id = folio), que la copia local de Firestore sube sola al volver la conexión. Los folios
     reservados que no se usen quedan como hueco justificado (registro reserva-bul-…). */
  const RANGO = 'sar-bul-rango', TRAMO = 60;
  const equipo = () => { try { let e = localStorage.getItem('sar-equipo'); if (!e) { e = Math.random().toString(36).slice(2, 8); localStorage.setItem('sar-equipo', e); } return e; } catch (e) { return 'x'; } };
  function rangos() { try { const r = JSON.parse(localStorage.getItem(RANGO) || '[]'); return Array.isArray(r) ? r.filter(x => x.anio === new Date().getFullYear() && x.sig <= x.fin) : []; } catch (e) { return []; } }
  const guardarRangos = (r) => { try { localStorage.setItem(RANGO, JSON.stringify(r)); } catch (e) { /* sin almacenamiento */ } };
  const quedanReservados = () => rangos().reduce((t, x) => t + (x.fin - x.sig + 1), 0);
  /** Con internet: si quedan menos de 20 reservados, reserva otro tramo (una transacción sobre el contador de BUL). */
  async function reservarTramo(forzar) {
    if (!forzar && quedanReservados() >= 20) return quedanReservados();
    const f = fs(), anio = new Date().getFullYear(), rc = f.doc(f.collection(db(), 'Contadores'), 'correlativo-bultos-' + anio);
    const ini = await f.runTransaction(db(), async (tx) => { const s = await tx.get(rc), v = s.exists() ? num(s.data().valor) : 0; tx.set(rc, { valor: v + TRAMO, actualizado: new Date().toISOString() }); return v + 1; });
    /* v21.249 (Howard): leer y guardar los tramos dentro del mismo candado que tomarReservados (dos pestañas no se pisan) */
    const anotar = () => { const r = rangos(); r.push({ anio, ini, fin: ini + TRAMO - 1, sig: ini }); guardarRangos(r); };
    if (navigator.locks && navigator.locks.request) await navigator.locks.request('sar-bul', anotar); else anotar();
    try { await f.setDoc(f.doc(f.collection(db(), 'Contadores'), `reserva-bul-${equipo()}-${anio}-${ini}`), { tipo: 'reserva-bul', equipo: equipo(), anio, desde: ini, hasta: ini + TRAMO - 1, por: usuario(), en: new Date().toISOString() }); } catch (e) { /* el tramo ya quedó reservado en el contador */ }
    return quedanReservados();
  }
  /** Sin internet: toma n folios seguidos de un tramo reservado (o lanza error si no alcanzan). */
  function tomarReservados(n) {
    const r = rangos(), t = r.find(x => x.fin - x.sig + 1 >= n);
    if (!t) throw new Error(`Sin internet solo quedan ${Math.max(0, ...r.map(x => x.fin - x.sig + 1), 0)} folio(s) seguidos reservados en este equipo (necesitas ${n}). Pide menos folios o espera la conexión.`);
    const ini = t.sig; t.sig += n; guardarRangos(r); return ini;
  }
  /** v21.249: reserva n folios BUL seguidos (con internet: transacción sobre el contador; sin internet: del tramo del equipo,
   *  con navigator.locks para que dos pestañas no tomen el mismo). Lo usan las etiquetas de caja y los tags «CONTADO». */
  async function reservarFolios(n) {
    const f = fs(), anio = new Date().getFullYear(), rc = f.doc(f.collection(db(), 'Contadores'), 'correlativo-bultos-' + anio);
    const enLinea = !(window.SAR_Cola && !(await window.SAR_Cola.hayConexion()));
    const ini = enLinea ? await f.runTransaction(db(), async (tx) => { const s = await tx.get(rc), v = s.exists() ? num(s.data().valor) : 0; tx.set(rc, { valor: v + n, actualizado: new Date().toISOString() }); return v + 1; }) : (navigator.locks && navigator.locks.request ? await navigator.locks.request('sar-bul', () => tomarReservados(n)) : tomarReservados(n));   /* dos pestañas no toman el mismo folio */
    if (enLinea) reservarTramo().catch(() => {});   /* deja folios listos para la próxima vez sin internet */
    return { anio, ini, enLinea };
  }
  async function crear(g) {
    const plan = planCajas(g), cajas = plan.map(p => p.q); if (!cajas.length) throw new Error('Indica el total de unidades y cuántas cajas son (o cuántas vienen por caja).');
    const nFol = plan.reduce((t, p) => t + 1 + p.hijos.length, 0);
    if (cajas.length > 300) throw new Error('Son más de 300 cajas: revisa las unidades por caja.');
    if (nFol > 600) throw new Error(`Serían ${nFol} etiquetas (cajas grandes + interiores): revisa las unidades por caja interior.`);
    const f = fs(), { anio, ini, enLinea } = await reservarFolios(nFol);
    const ahora = new Date().toISOString(), fol = (k) => `BUL-${anio}-${String(ini + k).padStart(6, '0')}`, grupo = fol(0);
    const comun = { tipo: 'bulto', grupo, estado: 'CERRADA', nombre: g.nombre, insumoId: g.insumoId || '', codigoMP: g.codigoMP || '', bodega: g.bodega || '', lote: g.lote || 'S/L', vence: g.vence || '', proveedor: g.proveedor || '', oc: g.oc || '', rec: g.rec || '', fechaRecepcion: g.fechaRecepcion || hoyISO(), creadoEn: ahora, creadoPor: usuario(), impresiones: 0, historial: [{ accion: 'CREADO', por: usuario(), en: ahora }], ...(g.origen ? { origen: g.origen } : {}) };
    const lista = []; let k = 0;
    const porCaja = num(g.cajas) > 0 ? Math.max(...cajas) : num(g.porCaja), totalGrupo = cajas.reduce((s, x) => s + x, 0);
    plan.forEach((p, i) => {
      const fp = fol(k++), hijos = p.hijos.map(() => fol(k++));
      lista.push({ ...comun, folio: fp, n: i + 1, de: cajas.length, contenido: p.q, inicial: p.q, porCaja, totalGrupo, ...(hijos.length ? { hijos, subcajas: hijos.length, porSubcaja: Math.floor(num(g.subPor)) } : {}) });
      p.hijos.forEach((q, j) => lista.push({ ...comun, folio: hijos[j], nivel: 'interior', padre: fp, padreN: i + 1, padreDe: cajas.length, n: j + 1, de: hijos.length, contenido: q, inicial: q, porCaja: Math.floor(num(g.subPor)), totalGrupo }));
    });
    if (enLinea) { for (const b of lista) await f.setDoc(ref(b.folio), b); }
    else { lista.forEach(b => { b.sinConexion = true; f.setDoc(ref(b.folio), b).catch(e => console.warn('[Bultos] se subirá al volver internet', b.folio, e)); }); }   /* sin internet: no se espera al servidor; la copia local la sube sola */
    try { sessionStorage.removeItem('etq-pend'); } catch (e) { /* sin almacenamiento */ }
    return lista;
  }
  async function listar(lim) { const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Contadores'), f.where('tipo', '==', 'bulto'), f.limit(lim || 2000))), l = []; sn.forEach(d => l.push(d.data())); return l.sort((a, b) => String(b.folio).localeCompare(String(a.folio))); }

  // ---------------- diálogo: crear o reimprimir etiquetas ----------------
  let insumos = null;
  async function cargarInsumos() { if (insumos) return insumos; const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(5000))), l = []; sn.forEach(d => l.push({ id: d.id, ...d.data() })); insumos = l; return l; }
  const lotesDe = (d) => (Array.isArray(d.batches) && d.batches.length ? d.batches : [{ batch: d.batch || 'S/L', quantity: d.quantity, expirationDate: d.expirationDate || '' }]).filter(b => num(b.quantity) > 0);

  function ventana(titulo, html, opc) {
    if (!(opc && opc.encima)) document.querySelectorAll('.bu-ov').forEach(x => (x.cerrar ? x.cerrar() : x.remove()));   /* cerrar: también apaga su cámara */
    const ov = document.createElement('div'); ov.className = 'bu-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="bu-c"><div class="bu-cab"><h3>${esc(titulo)}</h3><button type="button" class="fp-x bu-x" aria-label="Cerrar">×</button></div><div class="bu-b">${html}</div></div>`;
    const cerrar = () => { ov.remove(); document.removeEventListener('keydown', tecla, true); if (ov._fin) ov._fin(); };
    const tecla = (e) => { if (e.key !== 'Escape') return; const v = document.querySelectorAll('.bu-ov'); if (v[v.length - 1] !== ov) return; e.stopPropagation(); cerrar(); };   /* con dos ventanas, Escape cierra solo la de arriba */
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.bu-x')) cerrar(); }); document.addEventListener('keydown', tecla, true);
    document.body.appendChild(ov); ov.cerrar = cerrar; return ov;
  }

  /** pref: {nombre, insumoId, codigoMP, bodega, lote, vence, total, proveedor, oc, rec, fechaRecepcion, lineas:[…mismos campos], conteo}
   *  v21.238: cajas grandes con cajas interiores (subPor) y modo «conteo»: etiquetar stock que ya estaba en el sistema contándolo
   *  (si se cuenta más, se suma con un ajuste AJU; si se cuenta menos, queda en el informe de diferencias). */
  const textoDif = (dif, esSuper) => dif > 0 ? (esSuper ? 'Se sumará al stock (ajuste por conteo, con código).' : 'Quedará como solicitud de ajuste para el superadministrador.') : dif < 0 ? (esSuper ? 'Faltan unidades: se descontarán de este lote (ajuste por conteo, con código).' : 'Faltan unidades: quedará como solicitud de ajuste a la baja.') : dif === 0 ? 'Cuadra con el sistema.' : '';
  async function etiquetar(pref) {
    const p = pref || {}, lineas = Array.isArray(p.lineas) && p.lineas.length ? p.lineas : null, conteo = !!p.conteo;
    const ov = ventana(conteo ? 'Etiquetar stock existente (con conteo)' : 'Etiquetas de bulto', `<div class="bu-tabs"><button type="button" class="on" data-t="nueva">${conteo ? 'Contar y etiquetar' : 'Nuevas etiquetas'}</button><button type="button" data-t="re">Reimprimir existentes</button></div><div class="bu-pane" data-p="nueva"></div><div class="bu-pane" data-p="re" hidden></div>`, { encima: !!p.encima });
    ov.querySelectorAll('.bu-tabs button').forEach(b => b.onclick = () => { ov.querySelectorAll('.bu-tabs button').forEach(x => x.classList.toggle('on', x === b)); ov.querySelectorAll('.bu-pane').forEach(x => { x.hidden = x.dataset.p !== b.dataset.t; }); if (b.dataset.t === 're') pintarReimprimir(ov.querySelector('[data-p="re"]')); });
    const pane = ov.querySelector('[data-p="nueva"]');
    let sel = lineas ? { ...lineas[0], idx: 0 } : { ...p }, totalManual = false;
    if (conteo) { sel.total = 0; sel.sistema = num(p.total) || null; }
    const totalDe = () => conteo && !totalManual ? num(sel.cajas) * num(sel.porCaja) + num(sel.sueltas) : num(sel.total);
    const pintar = () => {
      const sug = sugerirPorCaja(sel.nombre);
      if (sug && sel.tieneSub) { if (!num(sel.subPor)) sel.subPor = sug; if (num(sel.porCaja) === sug && sel._sugPc) { sel.porCaja = 0; sel._sugPc = false; } }
      else if (!num(sel.porCaja) && sug) { sel.porCaja = sug; sel._sugPc = true; }
      const esSuper = String(document.body && document.body.dataset.userRole || '').toLowerCase() === 'superadmin';
      if (conteo && !totalManual) sel.total = totalDe();
      const enCajas = Math.max(0, num(sel.total) - (conteo ? num(sel.sueltas) : 0));
      const plan = planCajas({ total: enCajas, porCaja: sel.porCaja, subPor: sel.tieneSub ? sel.subPor : 0 });
      const nG = plan.length, nI = plan.reduce((t, x) => t + x.hijos.length, 0);
      const dif = conteo && sel.sistema != null && sel.insumoId ? num(sel.total) - num(sel.sistema) - num(sel.reservado) : null;
      pane.innerHTML = `${conteo ? '<p class="si-v">Para productos que <b>ya están en el sistema</b> y no tienen etiqueta: cuenta lo que hay, compara con el sistema y crea las etiquetas. No es un ingreso nuevo.</p>' : ''}
        ${lineas ? `<label class="bu-l">Producto de esta recepción<select id="bu-lin" class="si-in">${lineas.map((l, i) => `<option value="${i}"${i === sel.idx ? ' selected' : ''}>${esc(l.nombre)} · ${num(l.total)} u.${l.lote ? ' · lote ' + esc(l.lote) : ''}${l.hecho ? ' ✔' : ''}</option>`).join('')}</select></label>`
          : `<label class="bu-l">Producto${conteo ? ' (elige el lote que estás contando)' : ''}<input id="bu-q" class="si-in" placeholder="Busca por nombre…" value="${esc(sel.nombre || '')}" autocomplete="off"></label><div id="bu-sug" class="bu-sug"></div>`}
        <div class="bu-g3"><label class="bu-l">Lote<input id="bu-lote" class="si-in" value="${esc(sel.lote || '')}"${conteo ? ' placeholder="S/L si no trae"' : ''}></label><label class="bu-l">Vence<input id="bu-vence" type="date" class="si-in" value="${esc(sel.vence || '')}"></label><label class="bu-l">Bodega<input id="bu-bod" class="si-in" value="${esc(sel.bodega || '')}"${conteo && sel.insumoId ? ' readonly title="Bodega del producto en el sistema"' : ''}></label></div>
        <h4 class="fp-sub">¿Cómo viene?</h4>
        <div class="bu-g3">
          ${conteo ? `<label class="bu-l">Cajas grandes<input id="bu-cajas" type="number" min="0" class="si-in" value="${num(sel.cajas) || ''}" inputmode="numeric"><small>Las completas (una incompleta: corrige el total abajo).</small></label>` : `<label class="bu-l">Total de unidades<input id="bu-total" type="number" min="1" class="si-in" value="${num(sel.total) || ''}" inputmode="numeric"></label>`}
          <label class="bu-l">Unidades por caja grande<input id="bu-pc" type="number" min="1" class="si-in" value="${num(sel.porCaja) || ''}" inputmode="numeric">${sug && !sel.tieneSub && num(sel.porCaja) === sug ? '<small>Sugerido por la descripción («caja x ' + sug + '»)</small>' : ''}</label>
          ${conteo ? '' : `<label class="bu-l">Cajas grandes<input id="bu-cajas" type="number" min="1" class="si-in" value="${nG || ''}" inputmode="numeric"><small>Si cambias las cajas, se recalculan las unidades por caja.</small></label>`}
        </div>
        <label class="bu-chk"><input type="checkbox" id="bu-tsub"${sel.tieneSub ? ' checked' : ''}> La caja grande trae <b>cajas interiores</b> (ej. 1000 u. en 20 cajas de 50)</label>
        ${sel.tieneSub ? `<div class="bu-g3"><label class="bu-l">Unidades por caja interior<input id="bu-sp" type="number" min="1" class="si-in" value="${num(sel.subPor) || ''}" inputmode="numeric"></label><div class="bu-l"><span>Cajas interiores por caja grande</span><b class="bu-cifra" id="bu-nint">${num(sel.subPor) > 0 && num(sel.porCaja) > 0 ? Math.ceil(num(sel.porCaja) / num(sel.subPor)) : '—'}</b></div></div>` : ''}
        ${conteo ? `<div class="bu-g3"><label class="bu-l">Unidades sueltas (sin caja)<input id="bu-sue" type="number" min="0" class="si-in" value="${num(sel.sueltas) || ''}" inputmode="numeric"><small>No llevan etiqueta.</small></label></div>` : ''}
        ${conteo ? `<div class="bu-g3"><label class="bu-l">Total contado (u.)<input id="bu-total" type="number" min="0" class="si-in" value="${num(sel.total) || ''}" inputmode="numeric"><small>${totalManual ? 'Escrito a mano. <button type="button" class="bu-lnk" id="bu-recalc">Volver a calcular</button>' : 'Se calcula solo: cajas × unidades + sueltas. Corrígelo si una caja no está completa.'}</small></label>
          <div class="bu-l"><span>En el sistema (este lote)</span><b class="bu-cifra" id="bu-sis">${sel.sistema == null ? '—' : num(sel.sistema) + num(sel.reservado)}</b>${sel.reservado ? `<small>Incluye ${num(sel.reservado)} reservadas para actas (siguen en el estante).</small>` : ''}${sel.deuda ? `<small>Deuda del producto: ${num(sel.deuda)} u. (si sobra, se salda y el stock queda igual a lo contado).</small>` : ''}${sel.etiquetadas && sel.etiquetadas.n ? `<small class="bu-av">Este lote ya tiene ${sel.etiquetadas.n} caja(s) etiquetada(s) con ${sel.etiquetadas.u} u.: cuéntalas igual, pero no les crees etiqueta otra vez.</small>` : ''}</div>
          <div class="bu-l"><span>Diferencia</span><b id="bu-dif" class="bu-cifra ${dif > 0 ? 'bu-mas' : dif < 0 ? 'bu-menos' : ''}">${dif == null ? '—' : (dif > 0 ? '+' : '') + dif}</b><small id="bu-difm">${textoDif(dif, esSuper)}</small></div></div>` : ''}
        ${conteo ? '<details class="bu-opc"><summary>Datos opcionales para la etiqueta (proveedor, OC, fecha)</summary>' : ''}<div class="bu-g3"><label class="bu-l">Proveedor<input id="bu-prov" class="si-in" value="${esc(sel.proveedor || '')}"></label><label class="bu-l">Orden de compra<input id="bu-oc" class="si-in" value="${esc(sel.oc || '')}"></label><label class="bu-l">Fecha de recepción<input id="bu-fr" type="date" class="si-in" value="${esc(sel.fechaRecepcion || hoyISO())}"></label></div>${conteo ? '</details>' : ''}
        ${sel.rec ? `<p class="si-v">Recepción ${esc(sel.rec)}</p>` : ''}
        <div class="bu-prev" id="bu-prevt">${nG ? `<b>${nG + nI} etiqueta${nG + nI === 1 ? '' : 's'}</b>: ${nG} caja${nG === 1 ? '' : 's'} grande${nG === 1 ? '' : 's'}${nG > 1 && plan[nG - 1].q !== plan[0].q ? ` (${nG - 1} de ${plan[0].q} u. y la última de ${plan[nG - 1].q} u.)` : ` de ${plan[0].q} u.`}${nI ? ` + ${nI} cajas interiores de ${num(sel.subPor)} u.` : ''} · ${enCajas} u. en cajas${conteo && num(sel.sueltas) ? ` + ${num(sel.sueltas)} sueltas` : ''}` : (conteo ? 'Indica las cajas y las unidades por caja (o el total contado).' : 'Indica el total y las unidades por caja.')}</div>
        <div class="fp-facc"><button type="button" class="btn btn-primary" id="bu-gen"${(nG || (conteo && num(sel.total) > 0)) ? '' : ' disabled'}><i class="ph-bold ph-${conteo ? 'check-circle' : 'tag'}"></i> ${conteo ? (nG ? 'Registrar conteo y crear etiquetas' : 'Registrar conteo') : 'Crear etiquetas'}</button></div>`;
      const v = (id) => (pane.querySelector('#' + id) || {}).value;
      const leer2 = () => { sel.lote = v('bu-lote'); sel.vence = v('bu-vence'); sel.bodega = v('bu-bod'); sel.porCaja = num(v('bu-pc')); sel.proveedor = v('bu-prov'); sel.oc = v('bu-oc'); sel.fechaRecepcion = v('bu-fr');
        if (sel.tieneSub) sel.subPor = num(v('bu-sp')); if (conteo) { sel.cajas = num(v('bu-cajas')); sel.sueltas = num(v('bu-sue')); } else sel.total = num(v('bu-total')); };
      /* v21.238: se recalcula mientras se escribe, sin redibujar (no se pierde el foco ni se cierra el teclado del teléfono) */
      const vivo = () => {
        if (conteo && !totalManual) { sel.total = totalDe(); const et = pane.querySelector('#bu-total'); if (et) et.value = sel.total || ''; }
        const enC = Math.max(0, num(sel.total) - (conteo ? num(sel.sueltas) : 0)), pl = planCajas({ total: enC, porCaja: sel.porCaja, subPor: sel.tieneSub ? sel.subPor : 0 }), g = pl.length, it = pl.reduce((t, x) => t + x.hijos.length, 0);
        const pv = pane.querySelector('#bu-prevt'); if (pv) pv.innerHTML = g ? `<b>${g + it} etiqueta${g + it === 1 ? '' : 's'}</b>: ${g} caja${g === 1 ? '' : 's'} grande${g === 1 ? '' : 's'}${g > 1 && pl[g - 1].q !== pl[0].q ? ` (${g - 1} de ${pl[0].q} u. y la última de ${pl[g - 1].q} u.)` : ` de ${pl[0].q} u.`}${it ? ` + ${it} cajas interiores de ${num(sel.subPor)} u.` : ''} · ${enC} u. en cajas${conteo && num(sel.sueltas) ? ` + ${num(sel.sueltas)} sueltas` : ''}` : 'Indica las cajas y las unidades por caja.';
        const ni = pane.querySelector('#bu-nint'); if (ni) ni.textContent = num(sel.subPor) > 0 && num(sel.porCaja) > 0 ? Math.ceil(num(sel.porCaja) / num(sel.subPor)) : '—';
        const df = conteo && sel.sistema != null && sel.insumoId ? num(sel.total) - num(sel.sistema) - num(sel.reservado) : null, ed = pane.querySelector('#bu-dif'), em = pane.querySelector('#bu-difm');
        if (ed) { ed.textContent = df == null ? '—' : (df > 0 ? '+' : '') + df; ed.className = 'bu-cifra ' + (df > 0 ? 'bu-mas' : df < 0 ? 'bu-menos' : ''); } if (em) em.textContent = textoDif(df, esSuper);
        const bg = pane.querySelector('#bu-gen'); if (bg) { bg.disabled = !(g || (conteo && num(sel.total) > 0)); bg.lastChild.textContent = ' ' + (conteo ? (g ? 'Registrar conteo y crear etiquetas' : 'Registrar conteo') : 'Crear etiquetas'); }
      };
      ['bu-pc', 'bu-sp', 'bu-sue'].concat(conteo ? ['bu-cajas'] : ['bu-total']).forEach(id => { const e = pane.querySelector('#' + id); if (e) e.oninput = () => { leer2(); vivo(); }; });
      if (conteo) { const et = pane.querySelector('#bu-total'); if (et) et.oninput = () => { leer2(); const t = Math.max(0, Math.floor(num(et.value))); totalManual = t !== num(sel.cajas) * num(sel.porCaja) + num(sel.sueltas); sel.total = t; vivo(); }; }
      else { const ec = pane.querySelector('#bu-cajas'); if (ec) ec.onchange = () => { leer2(); const n = Math.max(1, num(ec.value)); if (sel.total) sel.porCaja = Math.ceil(sel.total / n); pintar(); }; }
      const rc = pane.querySelector('#bu-recalc'); if (rc) rc.onclick = () => { totalManual = false; leer2(); pintar(); };
      if (conteo) { const el = pane.querySelector('#bu-lote'); if (el) el.onchange = () => { leer2(); const i = (insumos || []).find(x => x.id === sel.insumoId); if (i) { sel.sistema = enLote(i, sel.lote || 'S/L'); } pintar(); }; }
      const ts = pane.querySelector('#bu-tsub'); if (ts) ts.onchange = () => { leer2(); sel.tieneSub = ts.checked; pintar(); };
      const ls = pane.querySelector('#bu-lin'); if (ls) ls.onchange = () => { const i = num(ls.value); sel = { ...lineas[i], idx: i }; pintar(); };
      const q = pane.querySelector('#bu-q'); if (q) q.oninput = async () => {
        const t = norm(q.value), box = pane.querySelector('#bu-sug'); if (t.length < 2) { box.innerHTML = ''; return; }
        const l = (await cargarInsumos()).filter(i => i.status !== 'CUARENTENA' && t.split(' ').every(w => norm(i.name).includes(w))).slice(0, 8);
        box.innerHTML = l.map(i => (conteo ? lotesTodos(i).concat([{ batch: '', quantity: 0, expirationDate: '', nuevo: true }]) : lotesDe(i)).map(b => b.nuevo ? `<button type="button" class="bu-op bu-op-n" data-id="${esc(i.id)}" data-lote="" data-v="" data-q="0"><b>${esc(i.name)}</b><small>${esc(i.location || '')} · <u>otro lote</u> (lo escribes tú: no está en el sistema)</small></button>` : `<button type="button" class="bu-op" data-id="${esc(i.id)}" data-lote="${esc(b.batch || 'S/L')}" data-v="${esc(b.expirationDate || '')}" data-q="${num(b.quantity)}"><b>${esc(i.name)}</b><small>${esc(i.location || '')} · lote ${esc(b.batch || 'S/L')}${b.expirationDate ? ' · vence ' + esc(fechaCL(b.expirationDate)) : ''} · ${num(b.quantity)} u.</small></button>`).join('')).join('') || '<p class="si-v">Sin coincidencias.</p>';
        box.querySelectorAll('.bu-op').forEach(b => b.onclick = () => { const i = insumos.find(x => x.id === b.dataset.id);
          sel = { ...sel, nombre: i.name, insumoId: i.id, codigoMP: i.codigoMP || '', bodega: i.location || '', lote: b.dataset.lote, vence: b.dataset.v, porCaja: num(i.unidadesPorCaja) || 0, proveedor: sel.proveedor || i.provider || '' };
          if (conteo) { sel.sistema = num(b.dataset.q); sel.reservado = num(i.reservado); sel.deuda = num(i.sobregiro); sel.cajas = 0; sel.sueltas = 0; totalManual = false; sel.etiquetadas = null;
            listar(5000).then(bs => { const m = bs.filter(x => x.nivel !== 'interior' && x.estado !== 'VACIA' && (x.insumoId === i.id || norm(x.nombre) === norm(i.name)) && (x.lote || 'S/L') === (sel.lote || 'S/L')); sel.etiquetadas = { n: m.length, u: m.reduce((t2, x) => t2 + num(x.contenido), 0) }; pintar(); }).catch(() => {}); }
          else sel.total = num(b.dataset.q);
          pintar(); });
      };
      pane.querySelector('#bu-gen').onclick = async (e) => {
        leer2(); if (!sel.nombre) { toast('Etiquetas', 'Elige el producto.', 'warning'); return; }
        if (sel.tieneSub && !(num(sel.subPor) > 0)) { toast('Cajas interiores', 'Indica cuántas unidades trae cada caja interior.', 'warning'); return; }
        const btn = e.currentTarget; btn.disabled = true;
        try {
          let msgConteo = '';
          if (conteo) {
            if (!sel.insumoId) throw new Error('Elige el producto y lote desde la lista (debe existir en el sistema).');
            const dif = num(sel.total) - num(sel.sistema) - num(sel.reservado), P0 = window.SAR_Progreso;
            /* primero se valida que las etiquetas se puedan crear (si no, el ajuste quedaría hecho sin etiquetas) */
            const enC0 = Math.max(0, num(sel.total) - num(sel.sueltas)), g0 = { total: enC0, porCaja: sel.porCaja, cajas: num(sel.porCaja) > 0 ? 0 : sel.cajas, subPor: sel.tieneSub ? sel.subPor : 0 }, pl0 = enC0 > 0 ? planCajas(g0) : [];
            if (enC0 > 0 && !pl0.length) throw new Error('Indica las unidades por caja grande (o cuántas cajas son).');
            if (pl0.length > 300 || pl0.reduce((t, x) => t + 1 + x.hijos.length, 0) > 600) throw new Error('Serían demasiadas etiquetas: revisa las unidades por caja.');
            if (dif !== 0 && P0 && P0.confirmar && !(await P0.confirmar({ titulo: dif > 0 ? `¿Sumar ${dif} u. al stock?` : `¿Descontar ${-dif} u. (faltante)?`, texto: `<b>${esc(sel.nombre)}</b> · lote ${esc(sel.lote || 'S/L')}: sistema <b>${num(sel.sistema) + num(sel.reservado)}</b>, contado <b>${num(sel.total)}</b>.`, lineas: [esSuper ? `Se ${dif > 0 ? 'suman' : 'descuentan'} ${Math.abs(dif)} u. ${dif > 0 ? 'al' : 'del'} lote con un ajuste por conteo (código AJU).` : `Queda una solicitud de ajuste por ${dif > 0 ? '+' : ''}${dif} u. para el superadministrador.`, ...(dif < 0 ? ['Antes de confirmar un faltante, vuelve a contar ese lote.'] : [])], si: esSuper ? (dif > 0 ? 'Sumar y seguir' : 'Descontar y seguir') : 'Enviar solicitud y seguir', no: 'Revisar' }))) { btn.disabled = false; return; }
            msgConteo = await registrarConteo(sel);
          }
          const enC = Math.max(0, num(sel.total) - (conteo ? num(sel.sueltas) : 0));
          let l = [];
          if (enC > 0) l = await crear({ ...sel, total: enC, subPor: sel.tieneSub ? sel.subPor : 0, cajas: conteo && !(num(sel.porCaja) > 0) ? sel.cajas : 0, origen: conteo ? 'conteo' : (sel.rec ? 'recepcion' : 'manual') });
          if (lineas) { lineas[sel.idx].hecho = true; const sig = lineas.findIndex(x => !x.hecho); if (sig >= 0) { sel = { ...lineas[sig], idx: sig }; } }
          if (l.length) {
            const P = window.SAR_Progreso, nI = l.filter(b => b.nivel === 'interior').length;
            const ok = P && P.confirmar ? await P.confirmar({ titulo: `${l.length} etiqueta${l.length === 1 ? '' : 's'} creada${l.length === 1 ? '' : 's'}`, texto: `${esc(l[0].folio)}${l.length > 1 ? ' a ' + esc(l[l.length - 1].folio) : ''}${msgConteo ? '<br>' + msgConteo : ''}`, lineas: [`${l.length - nI} caja(s) grande(s)${nI ? ` + ${nI} interior(es)` : ''}`, 'Puedes corregir los datos después en «Impresión de etiquetas» (quedan para reimprimir).'], si: 'Imprimir ahora', no: 'Después' }) : true;
            if (ok) await imprimir(l); else toast('Etiquetas guardadas', 'Quedan «sin imprimir» en Impresión de etiquetas.', 'info');
          } else if (msgConteo && window.SAR_Progreso && window.SAR_Progreso.exito) window.SAR_Progreso.exito({ titulo: 'Conteo registrado', texto: msgConteo });
          insumos = null; if (conteo) { sel = { fechaRecepcion: hoyISO() }; totalManual = false; }
          pintar();
        } catch (er) { toast('No se completó', er.message || String(er), 'error'); btn.disabled = false; }
      };
    };
    pintar();
    return ov;
  }
  /** v21.238: compara lo contado con el sistema. Más → ajuste AJU «Conteo físico» (superadmin: directo; otros: solicitud). Menos → informe de diferencias. */
  /** v21.238: unidades del sistema en un lote (suma todas sus entradas: el mismo lote puede estar dos veces con distinto vencimiento). */
  const enLote = (d, lote) => { const l = Array.isArray(d.batches) && d.batches.length ? d.batches : [{ batch: d.batch || 'S/L', quantity: d.quantity }]; return l.filter(b => (b.batch || 'S/L') === (lote || 'S/L')).reduce((t, b) => t + num(b.quantity), 0); };
  /** Lotes del producto, también los de 0 (para etiquetar lo que el sistema no tiene). */
  const lotesTodos = (d) => { const l = Array.isArray(d.batches) && d.batches.length ? d.batches : [{ batch: d.batch || 'S/L', quantity: d.quantity, expirationDate: d.expirationDate || '' }]; const m = new Map(); l.forEach(b => { const k = b.batch || 'S/L'; const e = m.get(k) || { batch: k, quantity: 0, expirationDate: b.expirationDate || '' }; e.quantity += num(b.quantity); m.set(k, e); }); return [...m.values()]; };
  const idConteo = () => 'conteo-etq-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  /** v21.238: compara lo contado con el sistema. Más → ajuste AJU «Conteo físico» (superadmin: directo; otros: solicitud, una por lote). Menos → informe de diferencias.
   *  Lo reservado por actas sigue en el estante: se suma a lo esperado. Si hay deuda, el stock queda igual a lo contado y la deuda se salda (ver ejecutarAjusteDirecto). */
  async function registrarConteo(sel) {
    const f = fs(), sn = await f.getDoc(f.doc(f.collection(db(), 'Insumos'), sel.insumoId)); if (!sn.exists()) throw new Error('El producto ya no existe.');
    const d = sn.data(); if (d.status === 'CUARENTENA') throw new Error('El producto está en CUARENTENA: resuélvelo antes de contarlo.');
    const lote = sel.lote || 'S/L', sistema = enLote(d, lote), nLotes = lotesTodos(d).filter(b => b.quantity > 0).length, res = num(d.reservado);
    const conStock = lotesTodos(d).filter(b => b.quantity > 0);
    if (res > 0 && (nLotes > 1 || (conStock.length === 1 && conStock[0].batch !== lote))) throw new Error(`Este producto tiene ${res} u. reservadas para actas por confirmar y varios lotes: no se puede saber en qué lote están. Confirma o elimina esas actas antes de contarlo.`);
    const esperado = sistema + (res > 0 ? res : 0), contado = Math.max(0, Math.floor(num(sel.total))), dif = contado - esperado;
    const obs = `Conteo físico al etiquetar · lote ${lote} · sistema ${sistema}${res ? ` + ${res} reservadas` : ''}, contado ${contado}${num(sel.sueltas) ? ` (${num(sel.sueltas)} sueltas)` : ''}${num(d.sobregiro) > 0 ? ` · deuda ${num(d.sobregiro)} u.` : ''}`;
    const base = { tipo: 'conteo-etiquetado', insumoId: sel.insumoId, nombre: d.name, bodega: d.location || '', lote, sistema, reservado: res, contado, diferencia: dif, por: usuario(), en: new Date().toISOString() };
    if (dif === 0) { await f.setDoc(f.doc(f.collection(db(), 'Contadores'), idConteo()), { ...base, estado: 'CUADRA' }); return `Conteo cuadrado: ${contado} u.`; }
    const rol = String(document.body && document.body.dataset.userRole || '').toLowerCase(), G = window.SAR_Gobernanza, just = `[Conteo físico (toma de inventario)] ${obs}`;
    /* v21.238 (decisión del usuario): si falta, también se ajusta (a la baja, en ese lote) */
    if (dif < 0 && -dif > sistema) throw new Error(`Faltan ${-dif} u. pero el lote solo tiene ${sistema} en el sistema (el resto está reservado para actas): revisa las actas por confirmar.`);
    if (rol === 'superadmin' && typeof window.ejecutarAjusteDirecto === 'function') {
      const codigo = G && G.codigo ? await G.codigo('AJU').catch(() => '') : '';
      const r = await window.ejecutarAjusteDirecto(sel.insumoId, num(d.quantity), d.name, dif, just, codigo || null, { motivo: 'Conteo físico (toma de inventario)', observacion: obs, lote, vence: sel.vence || '', esperadoLote: sistema, saldarDeuda: true });
      try { if (G && G.registrar) G.registrar({ nombre: d.name, lote, delta: dif, codigo: r.codigoAjuste, motivo: 'Conteo físico (toma de inventario)', nota: obs, origen: 'CONTEO_ETIQUETAS', antes: { cantidad: num(d.quantity) }, despues: { cantidad: num(d.quantity) + dif }, insumoId: sel.insumoId }).catch(() => {}); } catch (e) { /* sin gobernanza */ }
      await f.setDoc(f.doc(f.collection(db(), 'Contadores'), idConteo()), { ...base, estado: dif > 0 ? 'SUMADO' : 'DESCONTADO', codigo: r.codigoAjuste });
      return dif > 0 ? `<b>+${dif} u.</b> sumadas al stock con el ajuste <b>${esc(r.codigoAjuste)}</b>.${num(d.sobregiro) > 0 ? ' La deuda del producto quedó saldada.' : ''}` : `<b>${dif} u.</b> descontadas del lote con el ajuste <b>${esc(r.codigoAjuste)}</b>.`;
    }
    /* una sola solicitud pendiente por producto y lote (un reintento no la duplica) */
    const ps = await f.getDocs(f.query(f.collection(db(), 'Solicitudes_Ajuste'), f.where('insumoId', '==', sel.insumoId), f.limit(200))); let pend = null;
    ps.forEach(x => { const y = x.data(); if (y.status === 'pendiente' && y.conteo && (y.lote || 'S/L') === lote) pend = y; });
    if (pend && num(pend.cantidad) === dif) return `Ya había una solicitud pendiente por <b>${dif > 0 ? '+' : ''}${dif} u.</b> para este lote (${esc(pend.code || '')}): no se duplicó.`;
    if (pend) throw new Error(`Ya hay una solicitud de ajuste pendiente para este lote (${pend.code || ''}) por ${num(pend.cantidad)} u. Pide al superadministrador que la rechace antes de volver a contar.`);
    const sref = f.doc(f.collection(db(), 'Solicitudes_Ajuste'));
    const codigo = G && G.codigo ? await G.codigo('AJU').catch(() => '') : '';
    await f.setDoc(sref, { code: codigo || ('AJU-' + Date.now()), insumoId: sel.insumoId, insumoName: d.name, cantidad: dif, justificacion: just, previousStock: num(d.quantity), projectedStock: num(d.quantity) + dif, motivo: 'Conteo físico (toma de inventario)', observacion: obs, lote, vence: sel.vence || '', loteSistema: sistema, conteo: true, status: 'pendiente', date: f.serverTimestamp(), requester: usuario() });
    await f.setDoc(f.doc(f.collection(db(), 'Contadores'), idConteo()), { ...base, estado: 'SOLICITADO', codigo });
    return `<b>${dif > 0 ? '+' : ''}${dif} u.</b> quedaron como solicitud de ajuste${codigo ? ' <b>' + esc(codigo) + '</b>' : ''} (la aprueba el superadministrador).`;
  }
  /** v21.238: «Diferencias de conteo»: lo registrado al etiquetar stock existente (faltantes, sobrantes y solicitudes). */
  async function diferencias() {
    const ov = ventana('Diferencias de conteo', '<p class="si-v">Cargando…</p>', { encima: true }), b = ov.querySelector('.bu-b');
    try {
      const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Contadores'), f.where('tipo', '==', 'conteo-etiquetado'), f.limit(1000))), l = []; sn.forEach(x => l.push(x.data()));
      l.sort((a, c) => String(c.en).localeCompare(String(a.en)));
      const est = { FALTANTE: 'Faltan', SUMADO: 'Sumado al stock', SOLICITADO: 'Solicitud de ajuste', CUADRA: 'Cuadra' };
      b.innerHTML = l.length ? `<p class="si-v">${l.filter(x => x.estado === 'FALTANTE').length} con faltante · ${l.filter(x => x.estado === 'SOLICITADO').length} solicitudes · ${l.filter(x => x.estado === 'SUMADO').length} sumados.</p><div class="fp-tw"><table class="si-tb"><thead><tr><th>Fecha</th><th>Producto</th><th>Lote</th><th>Sistema</th><th>Contado</th><th>Dif.</th><th>Estado</th><th>Por</th></tr></thead><tbody>${l.slice(0, 400).map(x => `<tr><td>${esc(fechaCL(String(x.en).slice(0, 10)))}</td><td>${esc(x.nombre)}<small class="si-v"> ${esc(x.bodega || '')}</small></td><td>${esc(x.lote)}</td><td>${num(x.sistema)}${num(x.reservado) ? ' + ' + num(x.reservado) + ' res.' : ''}</td><td>${num(x.contado)}</td><td class="${num(x.diferencia) < 0 ? 'si-poco' : ''}"><b>${num(x.diferencia) > 0 ? '+' : ''}${num(x.diferencia)}</b></td><td>${esc(est[x.estado] || x.estado || '')}${x.codigo ? ' · ' + esc(x.codigo) : ''}</td><td>${esc(x.por || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="si-v">Aún no hay conteos registrados.</p>';
    } catch (e) { b.innerHTML = '<p class="si-v">No pude leer los conteos.</p>'; }
    return ov;
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
      el.querySelector('#bu-rp').onclick = async () => { try { await imprimir(todos.filter(b => marcados.has(b.folio)).sort((a, b) => a.folio.localeCompare(b.folio))); } catch (e) { toast('No se pudo', e.message, 'error'); } };
    };
    pinta();
  }

  // ---------------- escanear: consultar y contar ----------------
  let lector = null;
  async function camara(el, alLeer) {
    if (!window.Html5Qrcode) { el.innerHTML = '<p class="si-v">La cámara no está disponible: usa la pistola o escribe el folio.</p>'; return; }
    const mio = new window.Html5Qrcode(el.id); lector = mio;
    try { await mio.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.8, height: Math.min(w, h) * 0.55 }) }, (txt) => alLeer(txt), () => {});
      /* v21.243: si la ventana se cerró mientras la cámara arrancaba (p. ej. aviso de permiso), se apaga aquí */
      if (!el.isConnected) { await pararCamara(mio); return null; } }
    catch (e) { el.innerHTML = '<p class="si-v">No se pudo abrir la cámara (permiso o equipo sin cámara). Usa la pistola o escribe el folio.</p>'; if (lector === mio) lector = null; return null; }
    return mio;
  }
  /** v21.243: abre la cámara del teléfono en una ventana y devuelve lo primero que lea (QR o código de barras de la etiqueta); null si se cierra. */
  let camAbierta = null;   /* una sola lectura a la vez: un doble toque devuelve la misma */
  function leerConCamara(titulo) {
    if (camAbierta) return camAbierta;
    camAbierta = new Promise((ok) => {
      let listo = false, mio = null; const id = 'bu-cam-' + Date.now();
      const fin = (v) => { if (listo) return; listo = true; Promise.resolve(arranque).then(() => pararCamara(mio)).finally(() => { if (ov.parentNode) ov.remove(); camAbierta = null; ok(v); }); };
      const ov = ventana(titulo || 'Leer la etiqueta con la cámara', `<div id="${id}" class="bu-cam"></div><p class="si-s">Apunta al QR (o al código de barras) de la etiqueta de la caja.</p>`, { encima: true });
      ov._fin = () => fin(null);
      const arranque = camara(ov.querySelector('#' + id), (txt) => { if (folioDe(txt)) { try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* sin vibración */ } fin(txt); } }).then(l => { mio = l; if (listo) pararCamara(l); });
    });
    return camAbierta;
  }
  /** Detiene un lector (el indicado, o el último abierto). */
  async function pararCamara(cual) { const l = cual && cual.stop ? cual : lector; if (!l) return; try { await l.stop(); } catch (e) { /* ya detenida */ } try { l.clear(); } catch (e) { /* nada */ } if (lector === l) lector = null; }

  function fichaBulto(b) {
    return `<div class="bu-card"><div class="bu-card-h"><b>${esc(b.folio)}</b><span class="bu-est bu-est-${esc(b.estado)}">${esc(b.estado === 'CERRADA' ? 'Cerrada' : b.estado === 'ABIERTA' ? 'Abierta' : 'Vacía')}</span></div>
      <p class="bu-n">${esc(b.nombre)}</p><p class="si-v">${b.nivel === 'interior' ? `Caja interior ${b.n} de ${b.de} · dentro de la caja ${num(b.padreN)}/${num(b.padreDe)} (${esc(b.padre || '')})` : `Caja ${b.n} de ${b.de}${b.subcajas ? ` · ${num(b.subcajas)} cajas interiores de ${num(b.porSubcaja)} u.` : ''}`} · lote ${esc(b.lote)}${b.vence ? ' · vence ' + esc(fechaCL(b.vence)) : ''}</p>
      <p class="bu-q"><b>${b.contenido}</b> u. en la caja <small>(${b.nivel === 'interior' ? 'caja interior' : b.porCaja + ' por caja'} · total del lote ${b.totalGrupo} u.)</small></p>
      <p class="si-v">${esc(b.bodega || '')}${b.proveedor ? ' · ' + esc(b.proveedor) : ''}${b.oc ? ' · OC ' + esc(b.oc) : ''}${b.rec ? ' · ' + esc(b.rec) : ''}</p></div>`;
  }
  /** v21.238: tocar una caja interior (abrirla, vaciarla o pistolearla) significa que su caja grande está abierta. */
  function abrirPadre(b) { if (!b || !b.padre) return; leer(b.padre).then(pa => { if (pa && pa.estado === 'CERRADA') guardar(pa, { estado: 'ABIERTA' }, 'ABIERTA', { porInterior: b.folio }).catch(() => {}); }).catch(() => {}); }
  /** v21.243 (B.A.): cajas pistoleadas dentro de la MISMA transacción del movimiento de stock (Regla 7).
   *  leerCajasTx lee todas las cajas involucradas (y su caja grande / sus interiores) ANTES de cualquier escritura y
   *  devuelve una función que escribe. cajas = [{folio, qty}]; opc = {ref, destino} (destino: reposición → la caja entera cambia de bodega).
   *  Nunca baja más de lo que la caja tiene (si el sistema decía menos, queda anotado). */
  async function leerCajasTx(tx, F, D, cajas, opc) {
    const o = opc || {}, rf = (fo) => F.doc(D, 'Contadores', 'bulto-' + fo), mapa = new Map();
    const traer = async (fo) => { if (!fo || mapa.has(fo)) return mapa.get(fo); const sn = await tx.get(rf(fo)); const d = sn.exists() ? { ...sn.data() } : null; mapa.set(fo, d); return d; };
    const plan = [];
    for (const c of (cajas || [])) { const b = await traer(c.folio); if (!b || esTag(b)) continue; const q = Math.max(0, Math.floor(num(c.qty))); if (!q) continue;
      const entera = q >= num(b.contenido) && num(b.contenido) > 0;
      if (b.nivel === 'interior' && b.padre) await traer(b.padre);
      if (Array.isArray(b.hijos) && entera) for (const h of b.hijos) await traer(h);
      plan.push({ b, q, entera }); }
    /* una caja pequeña y su caja grande en el mismo movimiento contarían dos veces la misma mercadería */
    if (!o.soloTraslado) { const fs2 = new Set(plan.map(x => x.b.folio)); if (plan.some(x => x.b.padre && fs2.has(x.b.padre))) throw new Error('Se eligió una caja grande y también una de sus cajas pequeñas: quita una de las dos.'); }
    return () => {
      const ahora = new Date().toISOString(), por = usuario(), cambios = new Map();
      const mod = (b, campos, accion, det) => { const prev = cambios.get(b.folio) || { ...b }; Object.assign(prev, campos); prev.historial = (prev.historial || b.historial || []).concat([{ accion, por, en: ahora, ...det }]).slice(-40); prev.actualizado = ahora; cambios.set(b.folio, prev); return prev; };
      const actual = (fo) => cambios.get(fo) || mapa.get(fo);
      if (o.soloTraslado) { plan.forEach(({ b: b0 }) => { const b = actual(b0.folio); if (b.bodega === 'En tránsito') { mod(b, { bodega: o.destino }, 'TRASLADO', { ref: o.ref || '', a: o.destino, recibido: true }); (b.hijos || []).forEach(h => { const hb = actual(h); if (hb && hb.bodega === 'En tránsito') mod(hb, { bodega: o.destino }, 'TRASLADO', { ref: o.ref || '', a: o.destino, recibido: true }); }); } }); cambios.forEach((x, fo) => tx.set(rf(fo), x, { merge: true })); return; }   /* recepción de una reposición: la caja llega a su bodega */
      plan.forEach(({ b: b0, q, entera }) => { const b = actual(b0.folio), tiene = num(b.contenido), sale = Math.min(q, tiene), det = { qty: sale, ref: o.ref || '', ...(q > tiene ? { pedido: q, nota: 'la caja tenía menos según el sistema' } : {}) };
        if (o.destino && entera) mod(b, { bodega: 'En tránsito', ...(b.padre ? { padre: null, padreAntes: b.padre } : {}) }, 'TRASLADO', { ...det, a: o.destino, enCamino: true });   /* reposición: la caja completa viaja («En tránsito» hasta que se reciba); una caja pequeña que viaja sola deja de colgar de su caja grande */
        else mod(b, { contenido: tiene - sale, estado: tiene - sale > 0 ? 'ABIERTA' : 'VACIA' }, 'SALIDA', det);
        if (b.nivel === 'interior' && b.padre && actual(b.padre)) { const pa = actual(b.padre), r = Math.max(0, num(pa.contenido) - sale); mod(pa, o.destino && entera ? { contenido: r, estado: r > 0 ? 'ABIERTA' : 'VACIA' } : { contenido: r, estado: r > 0 ? 'ABIERTA' : 'VACIA' }, 'SALIDA', { qty: sale, ref: o.ref || '', porInterior: b.folio }); }
        if (Array.isArray(b.hijos) && entera) b.hijos.forEach(h => { const hb = actual(h); if (hb && hb.estado !== 'VACIA') mod(hb, o.destino ? { bodega: 'En tránsito' } : { contenido: 0, estado: 'VACIA' }, o.destino ? 'TRASLADO' : 'SALIDA', { ref: o.ref || '', enCajaGrande: b.folio }); });
      });
      cambios.forEach((x, fo) => tx.set(rf(fo), x, { merge: true }));
    };
  }
  /** v21.243: salida desde una caja pistoleada (p. ej. al despachar una solicitud): baja su contenido y lo deja en el historial.
   *  Caja interior → baja también la caja grande (y la marca abierta). Caja grande con `cajasChicas` → esas interiores salen enteras (VACIA en la caja). */
  async function sacar(folio, qty, ref, cajasChicas) {
    const b = await leer(folio); if (!b) throw new Error(folio + ' no existe.'); if (esTag(b)) throw new Error(avisoTag(folio)); const q = Math.max(0, Math.floor(num(qty))); if (!q) return b;
    const baja = (x, n) => { const r = Math.max(0, num(x.contenido) - n); return { contenido: r, estado: r > 0 ? 'ABIERTA' : 'VACIA' }; };
    await guardar(b, (x) => baja(x, q), 'SALIDA', { qty: q, ref: ref || '' });
    if (b.nivel === 'interior' && b.padre) { const pa = await leer(b.padre); if (pa) await guardar(pa, (x) => baja(x, q), 'SALIDA', { qty: q, ref: ref || '', porInterior: folio }); }
    else if (Array.isArray(b.hijos) && num(cajasChicas) > 0) { let k = 0; for (const h of b.hijos) { if (k >= num(cajasChicas)) break; const hb = await leer(h); if (hb && hb.estado !== 'VACIA') { await guardar(hb, { contenido: 0, estado: 'VACIA' }, 'SALIDA', { qty: num(hb.contenido), ref: ref || '', enCajaGrande: folio }); k++; } } }
    return b;
  }
  async function escanear(modo) {
    const conteo = modo === 'conteo', leidos = [], vistos = new Set(), cubiertos = new Set(), abiertosPadre = new Set(), grandesCerradas = new Set();
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
      const fin = async (n) => { const q = Math.max(0, Math.floor(n)); await guardar(b, q === 0 ? { contenido: 0, estado: 'VACIA' } : { contenido: q, estado: 'ABIERTA' }, q === 0 ? 'VACIA' : 'QUEDAN'); if (b.padre) abrirPadre(b); ok(q); };
      /* v21.238: si la pistola escribió aquí un folio (o una cifra mayor que lo que cabe), no es la cantidad */
      const valida = () => { const raw = String(qq.value || '').trim(), n = num(raw); if (raw.replace(/\D/g, '').length >= 7 || n > num(b.inicial || b.porCaja || b.contenido)) { qq.value = b.contenido; toast('Cantidad', folioDe(raw) ? 'Eso parece una etiqueta: primero indica cuánto queda en esta caja.' : `No puede quedar más de ${num(b.inicial || b.porCaja)} u.`, 'warning'); return false; } return true; };
      res.querySelector('#bu-qok').onclick = () => { if (valida()) fin(num(qq.value)); }; qq.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (valida()) fin(num(qq.value)); } };
      res.querySelector('#bu-vac').onclick = () => fin(0);
    };
    const procesar = async (txt) => {
      const folio = folioDe(txt); if (!folio) { res.innerHTML = `<p class="cfg-mal">«${esc(String(txt).slice(0, 40))}» no es una etiqueta de bulto.</p>`; return; }
      if (ocupado || (folio === ultimo && Date.now() - tUlt < 2500)) return; ultimo = folio; tUlt = Date.now(); ocupado = true;
      try {
        const b = await leer(folio); if (!b) { res.innerHTML = `<p class="cfg-mal">${esc(folio)} no existe en el sistema.</p>`; return; }
        if (esTag(b)) { res.innerHTML = `<p class="cfg-mal">${esc(avisoTag(folio))}</p>`; return; }   /* escanear y contar por bultos */
        try { if (window.SAR_Sonidos) window.SAR_Sonidos.tocar('ok'); } catch (e) { /* sin sonido */ }
        if (navigator.vibrate) navigator.vibrate(60);
        if (!conteo) {
          res.innerHTML = fichaBulto(b) + `<div class="fp-facc">${b.estado === 'CERRADA' ? '<button type="button" class="btn btn-primary" data-a="abrir">Abrir caja</button>' : ''}${b.estado === 'ABIERTA' ? '<button type="button" class="btn btn-primary" data-a="queda">¿Cuánto queda?</button>' : ''}${b.estado !== 'VACIA' ? '<button type="button" class="btn btn-secondary" data-a="vacia">Marcar vacía</button>' : '<button type="button" class="btn btn-secondary" data-a="cerrar">Volver a cerrada (llena)</button>'}<button type="button" class="btn btn-secondary" data-a="re">Reimprimir etiqueta</button></div>`;
          res.querySelectorAll('[data-a]').forEach(x => x.onclick = async () => {
            const a = x.dataset.a;
            if (a === 'abrir' || a === 'queda') pedirQueda(b, () => { ultimo = ''; procesar(folio); });
            else if (a === 'vacia') { await guardar(b, { contenido: 0, estado: 'VACIA' }, 'VACIA'); if (b.padre) abrirPadre(b); ultimo = ''; procesar(folio); }
            else if (a === 'cerrar') { await guardar(b, { contenido: b.inicial || b.porCaja, estado: 'CERRADA' }, 'CERRADA'); ultimo = ''; procesar(folio); }
            else if (a === 're') imprimir([b]).catch(e => toast('No se pudo', e.message, 'error'));
          });
          return;
        }
        if (vistos.has(folio)) { res.innerHTML = `<p class="si-v">${esc(folio)} ya estaba contado${cubiertos.has(folio) ? ' (va dentro de su caja grande, que se contó cerrada)' : ''}: no se suma dos veces.</p>`; return; }
        if (b.estado === 'VACIA') { res.innerHTML = fichaBulto(b) + '<p class="si-v">Esta caja figura vacía: no suma. Si tiene producto, ábrela desde «Escanear bulto».</p>'; return; }
        /* v21.238: niveles. Caja grande cerrada = todo su contenido (sus interiores quedan contadas); si la caja grande está abierta,
           se pistolean sus cajas interiores y se pregunta solo por las unidades sueltas dentro de ella. Pistolear una interior marca abierta su caja grande. */
        if (b.nivel === 'interior' && b.padre) {
          if (grandesCerradas.has(b.padre)) { res.innerHTML = `<p class="si-v">${esc(folio)} va dentro de ${esc(b.padre)}, que ya se contó cerrada: no se suma dos veces.</p>`; return; }
          abiertosPadre.add(b.padre);
          abrirPadre(b);
        }
        const grande = Array.isArray(b.hijos) && b.hijos.length;
        if (grande && (b.estado === 'ABIERTA' || abiertosPadre.has(folio))) {
          res.innerHTML = fichaBulto(b) + `<div class="bu-queda"><b>Caja grande abierta: pistolea sus cajas interiores.</b> ¿Cuántas unidades <u>sueltas</u> (fuera de cajas interiores) hay dentro?<div class="bu-man"><input id="bu-sq" type="number" min="0" class="si-in si-cn" value="0" inputmode="numeric"><button type="button" class="btn btn-primary" id="bu-sok">Listo</button></div></div>`;
          const sq = res.querySelector('#bu-sq'); sq.focus(); sq.select();
          const fin = () => { const raw = String(sq.value || '').trim(), q = Math.max(0, Math.floor(num(raw)));
            /* si la pistola escribió aquí un folio (o una cifra imposible), no son sueltas: se toma como lectura */
            if (q > num(b.inicial != null ? b.inicial : b.contenido) || raw.replace(/\D/g, '').length >= 7) { sq.value = '0'; if (folioDe(raw)) { fin(); setTimeout(() => procesar(raw), 0); } else toast('Sueltas', 'Esa cifra es mayor que lo que cabe en la caja: revísala.', 'warning'); return; }
            b.contado = q; vistos.add(folio); leidos.push(b); if (b.estado === 'CERRADA') guardar(b, { estado: 'ABIERTA' }, 'ABIERTA').catch(() => {}); res.innerHTML = `<p class="cfg-ok">✔ ${esc(folio)}: caja grande abierta · ${q} u. sueltas. Sigue con sus cajas interiores.</p>`; pintarSuma(); inp.focus(); };
          res.querySelector('#bu-sok').onclick = fin; sq.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); fin(); } };
          return;
        }
        if (b.estado === 'ABIERTA') { pedirQueda(b, (q) => { b.contado = q; vistos.add(folio); leidos.push(b); res.innerHTML = `<p class="cfg-ok">✔ ${esc(folio)}: ${q} u. (abierta)</p>`; pintarSuma(); inp.focus(); }); return; }
        b.contado = b.contenido; vistos.add(folio); leidos.push(b); if (grande) { grandesCerradas.add(folio); b.hijos.forEach(h => { vistos.add(h); cubiertos.add(h); }); }
        res.innerHTML = `<p class="cfg-ok">✔ ${esc(folio)} · ${esc(b.nombre)}: ${b.contenido} u. (cerrada${grande ? `, con sus ${b.hijos.length} cajas interiores` : ''})</p>`; pintarSuma();
      } catch (e) { res.innerHTML = `<p class="cfg-mal">No se pudo leer: ${esc(e.message || e)}</p>`; }
      finally { ocupado = false; }
    };
    /* v21.242: la pistola puede terminar con Enter, Tab o nada; sin nada, se toma cuando ya hay un folio completo y deja de escribir */
    let tmIn = null; const tomar = () => { clearTimeout(tmIn); const t = inp.value; inp.value = ''; procesar(t); };
    inp.onkeydown = (e) => { if (e.key === 'Enter' || (e.key === 'Tab' && inp.value.trim())) { e.preventDefault(); tomar(); } };
    inp.oninput = () => { clearTimeout(tmIn); if (folioDe(inp.value)) tmIn = setTimeout(tomar, 300); };
    ov.querySelector('#bu-ok').onclick = () => { const t = inp.value; inp.value = ''; procesar(t); };
    pintarSuma(); const camE = camara(ov.querySelector('#bu-cam'), procesar); ov._fin = () => camE.then(l => { if (l) pararCamara(l); }); setTimeout(() => inp.focus(), 200);
    return ov;
  }

  // ---------------- pantalla «Bultos y etiquetas» ----------------
  // ---------------- registro de impresión (v21.223) ----------------
  /** Estado de impresión de una etiqueta: sin | impresa | reimpresa | editada | legado (creada antes de llevar el registro). */
  function estadoImp(b) {
    if (!b || b.impresiones == null) return b && b.editadoTrasImprimir ? 'editada' : 'legado';
    if (b.editadoTrasImprimir) return 'editada';
    const n = num(b.impresiones); return n <= 0 ? 'sin' : n === 1 ? 'impresa' : 'reimpresa';
  }
  const ETQ_IMP = { sin: 'Sin imprimir', impresa: 'Impresa', reimpresa: 'Reimpresa', editada: 'Editada · reimprimir', legado: 'Sin registro (anterior)' };
  const textoImp = (b) => { const e = estadoImp(b); return e === 'reimpresa' ? `Reimpresa ${num(b.impresiones) - 1} ${num(b.impresiones) - 1 === 1 ? 'vez' : 'veces'}` : ETQ_IMP[e]; };
  /** Estado de toda una orden: lo más urgente primero. */
  function estadoOC(bultos, faltan) {
    const e = (bultos || []).map(estadoImp), hay = (k) => e.includes(k);
    if (num(faltan) > 0) return { k: 'faltan', t: bultos && bultos.length ? 'Faltan etiquetas' : 'Sin etiquetas' };
    if (!e.length) return { k: 'vacia', t: 'Sin etiquetas (anterior)' };
    if (hay('editada')) return { k: 'editada', t: 'Cambios por reimprimir' };
    if (hay('sin')) return { k: 'sin', t: e.every(x => x === 'sin') ? 'Sin imprimir' : 'Impresión parcial' };
    if (e.every(x => x === 'legado')) return { k: 'legado', t: 'Sin registro (anterior)' };
    if (hay('reimpresa')) return { k: 'reimpresa', t: 'Reimpresa' };
    return { k: 'impresa', t: 'Impresa' };
  }
  /** Lo recibido en las recepciones de la orden que aún no tiene etiqueta (por producto). */
  function faltantesOC(oc, bultos, desde) {
    /* se compara por producto + lote tal como llegaron (nombreOrig/loteOrig: editar la etiqueta no crea faltantes falsos) */
    const rec = new Map(), et = new Map(), k = (n, l) => norm(n) + '|' + norm(l || 'S/L');
    (oc.recepciones || []).filter(r => r && !r.anulada && r.ingresoAStock && (!desde || String(r.fecha || '').slice(0, 10) >= desde)).forEach(r => (r.detalle || []).forEach(d => {
      const nombre = d.insumoName || d.descripcion || '', key = k(nombre, d.lote), x = rec.get(key) || { nombre, descripcion: d.descripcion || '', total: 0, lote: d.lote || 'S/L', vence: '', recs: [], bodega: r.bodega || '', fecha: '' };
      x.total += num(d.cantidad); if (d.vence) x.vence = d.vence; if (r.recId && !x.recs.includes(r.recId)) x.recs.push(r.recId); x.fecha = String(r.fecha || '').slice(0, 10) || x.fecha; if (r.bodega) x.bodega = r.bodega; rec.set(key, x);
    }));
    (bultos || []).forEach(b => { const key = k(b.nombreOrig || b.nombre, b.loteOrig || b.lote); et.set(key, (et.get(key) || 0) + uds(b)); });
    /* 1.º lo recibido con lote se cubre con etiquetas de ese lote; 2.º lo recibido sin lote (S/L) con cualquier etiqueta sobrante del mismo producto */
    const sobra = new Map(), sl = norm('S/L'), prod = (key) => key.slice(0, key.lastIndexOf('|')), loteK = (key) => key.slice(key.lastIndexOf('|') + 1);
    const falta = new Map();
    rec.forEach((x, key) => { if (loteK(key) === sl) return; const c = Math.min(x.total, et.get(key) || 0); falta.set(key, x.total - c); et.set(key, (et.get(key) || 0) - c); });
    et.forEach((v, key) => { if (v > 0) sobra.set(prod(key), (sobra.get(prod(key)) || 0) + v); });
    rec.forEach((x, key) => { if (loteK(key) !== sl) return; const p = prod(key), c = Math.min(x.total, sobra.get(p) || 0); falta.set(key, x.total - c); sobra.set(p, (sobra.get(p) || 0) - c); });
    return [...rec.entries()].map(([key, x]) => ({ ...x, falta: Math.max(0, falta.get(key) || 0) })).filter(x => x.falta > 0)
      .map(x => ({ nombre: x.nombre, codigoMP: ((oc.lineas || []).find(l => l.descripcion === x.descripcion) || {}).codigoMP || '', total: x.falta, lote: x.lote, vence: x.vence, bodega: x.bodega, proveedor: oc.proveedor || '', oc: oc.numeroOC || '', rec: x.recs.join(' + '), fechaRecepcion: x.fecha || hoyISO() }));
  }
  /** Anota que se imprimieron (1.ª vez = impresa; siguientes = reimpresa) y limpia la marca de «editada». */
  /** v21.238: al reimprimir se pide el motivo (queda en el historial de la etiqueta). '' = ninguna es reimpresión · null = cancelado. */
  async function motivoReimp(lista) {
    const re = (lista || []).filter(b => num(b.impresiones) >= 1); if (!re.length) return '';
    const P = window.SAR_Progreso; if (!(P && P.pedir)) return 'Reimpresión';
    const m = await P.pedir({ titulo: `¿Por qué se reimprime${re.length === 1 ? '' : 'n'}?`, texto: `${re.length} etiqueta${re.length === 1 ? ' ya fue impresa' : 's ya fueron impresas'} (${re.slice(0, 3).map(b => esc(b.folio)).join(', ')}${re.length > 3 ? '…' : ''}). Ej.: etiqueta dañada, se cayó, se corrigieron datos, cambio de caja.`, valor: re.some(b => b.editadoTrasImprimir) ? 'Se corrigieron datos' : 'Etiqueta dañada o perdida', si: 'Reimprimir', no: 'Cancelar' });
    return m == null ? null : String(m).trim().slice(0, 140);
  }
  async function marcarImpresas(lista, motivo) {
    const ahora = new Date().toISOString();
    const r = await Promise.all((lista || []).map(b => guardar(b, (x) => ({ impresiones: num(x.impresiones) + 1, ultimaImpresion: ahora, primeraImpresion: x.primeraImpresion || ahora, editadoTrasImprimir: false, ...(num(x.impresiones) >= 1 && motivo ? { ultimoMotivoReimpresion: motivo } : {}) }), num(b.impresiones) >= 1 ? 'REIMPRESO' : 'IMPRESO', num(b.impresiones) >= 1 && motivo ? { motivo } : null).then(() => true, () => false)));
    try { sessionStorage.removeItem('etq-pend'); } catch (e) { /* sin almacenamiento */ }
    const mal = r.filter(x => !x).length; if (mal) toast('Impresión no registrada', `${mal} etiqueta(s) se imprimieron pero no se pudo anotar la impresión (revisa la conexión o tu sesión).`, 'warning');
  }
  async function imprimir(lista, nombre) { if (!lista || !lista.length) return null; const mot = await motivoReimp(lista); if (mot === null) return null; const r = await pdf(lista, nombre); await marcarImpresas(lista, mot); return r; }

  // ---------------- etiquetas por orden de compra (v21.223) ----------------
  async function leerOCs() { const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Seguimiento_OC'), f.limit(1500))), l = []; sn.forEach(d => l.push({ id: d.id, ...d.data() })); return l; }
  const SIN_OC = '(sin orden de compra)', DESDE_ETQ = '2026-11-14';   /* las etiquetas por caja existen desde v21.205: lo recibido antes no cuenta como «falta etiquetar» */
  /** v21.232: foto del producto (catálogo / Mercado Público), igual que en Existencias */
  const foto = (nombre, codigo) => window.SAR_Imagenes && window.SAR_Imagenes.thumb ? window.SAR_Imagenes.thumb(nombre || '', { codigo: codigo || '' }) : '';
  const rellenarFotos = (el) => { const I = window.SAR_Imagenes; if (!I || !I.cargar) return; I.cargar().then(() => I.rellenar(el)).catch(() => {}); };
  async function porOC(opc) {
    /* opc.en: se dibuja en una página (menú «Impresión de etiquetas») en vez de una ventana */
    const en = opc && opc.en;
    if (en) en.innerHTML = `<div class="si-wrap si-ancho"><div class="si-cab"><div><h2 class="si-t">Impresión de etiquetas</h2><p class="si-s">Las etiquetas de bulto de cada orden de compra: imprime las que quedaron pendientes al recibir, reimprime o corrige datos.</p></div></div>
      <div class="etq-acc"><button type="button" class="bu-big" data-ex="conteo"><i class="ph-bold ph-list-checks"></i><b>Etiquetar stock existente</b><small>Lo que ya estaba en el sistema sin etiqueta: cuéntalo, compara y etiqueta</small></button><button type="button" class="bu-big" data-ex="nueva"><i class="ph-bold ph-tag"></i><b>Crear etiquetas</b><small>Para un producto y lote, con cajas interiores</small></button></div><p class="etq-dif"><button type="button" class="bu-lnk" data-ex="dif"><i class="ph-bold ph-scales"></i> Diferencias de conteo</button> · <button type="button" class="bu-lnk" data-ex="contar"><i class="ph-bold ph-barcode"></i> Contar por bultos (pistola)</button> · <button type="button" class="bu-lnk" data-ex="probar"><i class="ph-bold ph-scan"></i> Probar la pistola</button></p>
      <div class="bu-b etq-pag"><p class="si-v">Cargando órdenes y etiquetas…</p></div></div>`;
    if (en) en.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { const x = b.dataset.ex, re = (ov2) => { if (ov2) { const o = ov2._fin; ov2._fin = () => { if (o) o(); porOC({ en }); }; } };
      if (x === 'probar') probarPistola(); else if (x === 'dif') diferencias(); else if (x === 'contar') escanear('conteo').then(re); else etiquetar(x === 'conteo' ? { conteo: true } : {}).then(re); });
    const ov = en || ventana('Etiquetas por orden de compra', '<p class="si-v">Cargando órdenes y etiquetas…</p>');
    const caja = ov.querySelector('.bu-b');
    let ocs = [], bultos = [];
    try { [ocs, bultos] = await Promise.all([leerOCs().catch(() => []), listar(5000)]); }
    catch (e) { caja.innerHTML = '<p class="si-v">No pude leer las etiquetas.</p>'; return ov; }
    const filas = () => {
      const porNum = new Map(); bultos.forEach(b => { const k = String(b.oc || '').trim() || SIN_OC; if (!porNum.has(k)) porNum.set(k, []); porNum.get(k).push(b); });
      const l = ocs.filter(o => (o.recepciones || []).some(r => r && !r.anulada && r.ingresoAStock) || porNum.has(String(o.numeroOC || '').trim()))
        .map(o => { const bs = porNum.get(String(o.numeroOC || '').trim()) || [], fal = faltantesOC(o, bs, DESDE_ETQ); return { oc: o, num: o.numeroOC || o.id, prov: o.proveedor || '', bultos: bs, faltan: fal, est: estadoOC(bs, fal.reduce((t, x) => t + x.total, 0)), fecha: o.ultimaRecepcion || '' }; });
      const conocidas = new Set(l.map(x => String(x.num).trim()));
      porNum.forEach((bs, k) => { if (!conocidas.has(k)) l.push({ oc: { numeroOC: k === SIN_OC ? '' : k, proveedor: bs[0].proveedor || '' }, num: k, prov: bs[0].proveedor || '', bultos: bs, faltan: [], est: estadoOC(bs, 0), fecha: bs[0].fechaRecepcion || '' }); });
      const peso = { faltan: 0, editada: 1, sin: 2, legado: 3, reimpresa: 4, impresa: 5, vacia: 6 };
      return l.sort((a, b) => (peso[a.est.k] - peso[b.est.k]) || String(b.fecha).localeCompare(String(a.fecha)));
    };
    let q = '', filtro = '', modo = 'oc';
    const PEND = ['faltan', 'editada', 'sin'], pasa = (k) => !filtro || k === filtro || (filtro === 'pend' && PEND.includes(k));
    const textoOC = (x) => norm([x.num, x.prov, ...x.bultos.map(b => b.nombre + ' ' + (b.nombreOrig || '') + ' ' + b.folio + ' ' + b.lote), ...(x.oc.lineas || []).map(l => l.descripcion), ...(x.oc.recepciones || []).flatMap(r => (r.detalle || []).map(d => (d.insumoName || '') + ' ' + (d.descripcion || '')))].join(' '));
    /** Vista por producto: cada grupo de etiquetas (producto + lote) y lo recibido que aún no tiene etiqueta. */
    const productos = (todas) => {
      const l = [];
      todas.forEach(x => {
        const g = new Map(); x.bultos.forEach(b => { const k = b.grupo || b.folio; if (!g.has(k)) g.set(k, []); g.get(k).push(b); });
        g.forEach((bs, k) => l.push({ x, k, cod: bs[0].codigoMP || '', nombre: bs[0].nombre, lote: bs[0].lote || 'S/L', vence: bs[0].vence || '', cajas: grandes(bs).length, u: bs.reduce((t, b) => t + uds(b), 0), est: estadoOC(bs, 0), txt: norm(bs.map(b => b.nombre + ' ' + (b.nombreOrig || '') + ' ' + b.folio + ' ' + b.lote).join(' ') + ' ' + x.num + ' ' + x.prov) }));
        x.faltan.forEach(f => l.push({ x, k: '', cod: f.codigoMP || '', nombre: f.nombre, lote: f.lote || 'S/L', vence: f.vence || '', cajas: 0, u: f.total, est: { k: 'faltan', t: 'Sin etiqueta' }, txt: norm(f.nombre + ' ' + f.lote + ' ' + x.num + ' ' + x.prov) }));
      });
      const peso = { faltan: 0, editada: 1, sin: 2, legado: 3, reimpresa: 4, impresa: 5 };
      return l.sort((a, b) => (peso[a.est.k] - peso[b.est.k]) || a.nombre.localeCompare(b.nombre, 'es'));
    };
    const lista = () => {
      const t = norm(q), todas = filas(); pintarBadge(todas);
      const items = modo === 'oc' ? todas.map(x => ({ x, k: x.est.k })) : productos(todas).map(p => ({ p, k: p.est.k }));
      const cuenta = (k) => items.filter(y => y.k === k).length;
      const vis = modo === 'oc' ? todas.filter(x => pasa(x.est.k) && (!t || t.split(' ').every(w => textoOC(x).includes(w))))
        : productos(todas).filter(p => pasa(p.est.k) && (!t || t.split(' ').every(w => p.txt.includes(w))));
      caja.innerHTML = `<p class="si-v"${en ? ' hidden' : ''}>Cada orden con sus etiquetas de bulto: si ya se imprimieron, si se reimprimieron o si falta etiquetar algo. Entra a una orden para imprimir, reimprimir o corregir datos.</p>
        <div class="bu-tabs bu-modo"><button type="button" class="${modo === 'oc' ? 'on' : ''}" data-modo="oc"><i class="ph-bold ph-clipboard-text"></i> Por orden de compra</button><button type="button" class="${modo === 'prod' ? 'on' : ''}" data-modo="prod"><i class="ph-bold ph-pill"></i> Por producto</button></div>
        <div class="bu-ocbar"><input class="si-in" id="bu-oq" type="search" placeholder="${modo === 'oc' ? 'Busca por N° de orden, proveedor o producto…' : 'Busca el producto o medicamento (también lote, folio u OC)…'}" value="${esc(q)}" autocomplete="off">
        <div class="bu-chips">${[['', 'Todas', items.length], ['pend', 'Pendientes', items.filter(y => PEND.includes(y.k)).length], ['impresa', 'Impresas', cuenta('impresa')], ['reimpresa', 'Reimpresas', cuenta('reimpresa')]].map(([k, n, c]) => `<button type="button" class="bu-chip${filtro === k ? ' on' : ''}" data-fl="${k}">${n} <b>${c}</b></button>`).join('')}</div></div>
        ${t ? `<p class="si-v">${vis.length} resultado${vis.length === 1 ? '' : 's'} para «${esc(q)}»</p>` : ''}
        <div class="bu-ocs">${modo === 'oc' ? vis.slice(0, 200).map((x) => { const tot = x.bultos.length, imp = x.bultos.filter(b => ['impresa', 'reimpresa'].includes(estadoImp(b))).length, ft = x.faltan.reduce((s2, f) => s2 + f.total, 0);
          return `<button type="button" class="bu-oc" data-i="${todas.indexOf(x)}"><span class="bu-oc-n"><b>${esc(x.num === SIN_OC ? 'Sin orden de compra' : 'OC ' + x.num)}</b><small>${esc(x.prov)}${x.fecha ? ' · recibida ' + esc(fechaCL(String(x.fecha).slice(0, 10))) : ''}</small></span>
            <span class="bu-oc-c"><small>${tot} etiqueta${tot === 1 ? '' : 's'}${tot ? ` · ${imp} impresa${imp === 1 ? '' : 's'}` : ''}${ft ? ` · faltan ${ft} u.` : ''}</small><span class="bu-imp bu-imp-${x.est.k}">${esc(x.est.t)}</span></span><i class="ph-bold ph-caret-right"></i></button>`; }).join('')
          : vis.slice(0, 300).map((p) => `<button type="button" class="bu-oc bu-oc--foto" data-i="${todas.indexOf(p.x)}" data-g="${esc(p.k)}">${foto(p.nombre, p.cod)}<span class="bu-oc-n"><b>${esc(p.nombre)}</b><small>lote ${esc(p.lote)}${p.vence ? ' · vence ' + esc(fechaCL(p.vence)) : ''} · ${esc(p.x.num === SIN_OC ? 'sin orden de compra' : 'OC ' + p.x.num)}</small></span>
            <span class="bu-oc-c"><small>${p.cajas ? `${p.cajas} caja${p.cajas === 1 ? '' : 's'} · ` : ''}${p.u} u.</small><span class="bu-imp bu-imp-${p.est.k}">${esc(p.est.t)}</span></span><i class="ph-bold ph-caret-right"></i></button>`).join('')}
          ${vis.length ? '' : `<p class="si-v">${t ? 'Nada coincide con la búsqueda.' : 'Sin resultados.'}</p>`}</div>`;
      const i = caja.querySelector('#bu-oq'); i.oninput = () => { q = i.value; const p0 = i.selectionStart; lista(); const j2 = caja.querySelector('#bu-oq'); j2.focus(); j2.setSelectionRange(p0, p0); };
      caja.querySelectorAll('[data-fl]').forEach(b => b.onclick = () => { filtro = b.dataset.fl; lista(); });
      caja.querySelectorAll('[data-modo]').forEach(b => b.onclick = () => { modo = b.dataset.modo; lista(); });
      caja.querySelectorAll('.bu-oc').forEach(b => b.onclick = () => detalle(todas[Number(b.dataset.i)], b.dataset.g));
      rellenarFotos(caja);
    };
    const detalle = (x, foco) => {
      const marcados = new Set();
      const pinta = () => {
        const fila = filas().find(y => y.num === x.num) || x; x = fila;
        const bs = x.bultos.slice().sort((a, b) => String(a.folio).localeCompare(String(b.folio))), grupos = new Map();
        bs.forEach(b => { const k = b.grupo || b.folio; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(b); });
        const pend = bs.filter(b => ['sin', 'editada'].includes(estadoImp(b))), ft = x.faltan.reduce((t, f) => t + f.total, 0);
        /* v21.232: cabecera ordenada (volver, datos de la orden, cifras), faltantes en lista legible y estado vacío claro */
        const recibido = x.bultos.reduce((t, b) => t + uds(b), 0) + ft;
        const corto = (t) => { const c = String(t || '').split(/\s+-\s+|\.\s+-/)[0].trim(); return c.length > 90 ? c.slice(0, 88) + '…' : c; };
        const recs = [...new Set((x.oc.recepciones || []).filter(r => r && !r.anulada && r.ingresoAStock).map(r => r.recId).filter(Boolean))];
        caja.innerHTML = `<div class="bu-det-top"><button type="button" class="bu-volver" id="bu-vol"><i class="ph-bold ph-arrow-left"></i> Órdenes</button></div>
          <section class="bu-det-cab">
            <div class="bu-det-tit"><div><span class="bu-det-k">${x.num === SIN_OC ? 'Etiquetas' : 'Orden de compra'}</span><h4>${esc(x.num === SIN_OC ? 'Sin orden de compra' : x.num)}</h4><p>${esc(x.prov || '—')}${x.fecha ? ' · recibida ' + esc(fechaCL(String(x.fecha).slice(0, 10))) : ''}${recs.length ? ' · ' + esc(recs.join(', ')) : ''}</p></div><span class="bu-imp bu-imp-${x.est.k}">${esc(x.est.t)}</span></div>
            <div class="bu-det-cifras"><div><b>${recibido}</b><small>unidades recibidas</small></div><div><b>${bs.length}</b><small>etiqueta${bs.length === 1 ? '' : 's'} creada${bs.length === 1 ? '' : 's'}</small></div><div class="${pend.length ? 'bu-c-warn' : ''}"><b>${pend.length}</b><small>por imprimir</small></div><div class="${ft ? 'bu-c-warn' : ''}"><b>${ft}</b><small>u. sin etiqueta</small></div></div>
          </section>
          ${ft ? `<section class="bu-falta2"><header><div><h5><i class="ph-bold ph-tag"></i> Falta etiquetar ${ft} u.</h5><small>Productos recibidos que aún no tienen etiqueta de bulto.</small></div><button type="button" class="btn btn-primary btn-sm" id="bu-crea"><i class="ph-bold ph-plus"></i> Crear las que faltan</button></header>
            <ul>${x.faltan.map(f => `<li title="${esc(f.nombre)}">${foto(f.nombre, f.codigoMP)}<span class="bu-f-n">${esc(corto(f.nombre))}</span><span class="bu-f-m">${f.lote && f.lote !== 'S/L' ? 'lote ' + esc(f.lote) : 'sin lote'}${f.vence ? ' · vence ' + esc(fechaCL(f.vence)) : ''}</span><span class="bu-f-q">${f.total} u.</span></li>`).join('')}</ul></section>` : ''}
          <div class="fp-facc bu-ocacc"${bs.length ? '' : ' style="display:none"'}><button type="button" class="btn btn-primary" id="bu-pend"${pend.length ? '' : ' disabled'}><i class="ph-bold ph-printer"></i> Imprimir pendientes${pend.length ? ' (' + pend.length + ')' : ''}</button><button type="button" class="btn btn-secondary" id="bu-sel"${marcados.size ? '' : ' disabled'}><i class="ph-bold ph-arrows-clockwise"></i> Reimprimir seleccionadas${marcados.size ? ' (' + marcados.size + ')' : ''}</button><button type="button" class="btn btn-secondary btn-sm" id="bu-todas">${marcados.size === bs.length && bs.length ? 'Quitar selección' : 'Seleccionar todas'}</button></div>
          ${[...grupos.values()].map(g => { const a = g[0]; return `<div class="bu-grp${foco && (a.grupo || a.folio) === foco ? ' bu-grp--foco' : ''}" data-grp="${esc(a.grupo || a.folio)}"><div class="bu-grp-h">${foto(a.nombre, a.codigoMP)}<span class="bu-grp-t"><b>${esc(a.nombre)}</b><small>lote ${esc(a.lote || 'S/L')}${a.vence ? ' · vence ' + esc(fechaCL(a.vence)) : ''} · ${grandes(g).length} caja${grandes(g).length === 1 ? '' : 's'}${g.length > grandes(g).length ? ' + ' + (g.length - grandes(g).length) + ' interiores' : ''} · ${g.reduce((t, b) => t + uds(b), 0)} u.${a.rec ? ' · ' + esc(a.rec) : ''}</small></span><button type="button" class="btn btn-secondary btn-sm" data-eg="${esc(a.grupo || a.folio)}"><i class="ph-bold ph-pencil-simple"></i> Editar datos</button></div>
            ${g.map(b => `<label class="bu-fila bu-et"><input type="checkbox" data-f="${esc(b.folio)}"${marcados.has(b.folio) ? ' checked' : ''}><span><b>${esc(b.folio)}</b> · ${b.nivel === 'interior' ? `↳ interior ${num(b.n)}/${num(b.de)} de la caja ${num(b.padreN)}` : `bulto ${num(b.n)}/${num(b.de)}${b.subcajas ? ` (${num(b.subcajas)} interiores)` : ''}`} · ${num(b.contenido)} u.<small>${b.ultimaImpresion ? 'Última impresión ' + esc(fechaCL(b.ultimaImpresion.slice(0, 10))) + ' ' + esc(new Date(b.ultimaImpresion).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })) : ''}</small></span><span class="bu-imp bu-imp-${estadoImp(b)}">${esc(textoImp(b))}</span><button type="button" class="bu-ed" data-eb="${esc(b.folio)}" aria-label="Editar etiqueta ${esc(b.folio)}"><i class="ph-bold ph-pencil-simple"></i></button></label>`).join('')}</div>`; }).join('') || `<div class="bu-vacio"><i class="ph-bold ph-tag-simple"></i><b>Esta orden aún no tiene etiquetas</b><small>${ft ? 'Usa «Crear las que faltan»: indicas cuántas cajas son y se imprimen.' : 'No hay productos recibidos por etiquetar.'}</small></div>`}`;
        caja.querySelector('#bu-vol').onclick = lista;
        rellenarFotos(caja);
        caja.querySelectorAll('[data-f]').forEach(c => c.onchange = () => { if (c.checked) marcados.add(c.dataset.f); else marcados.delete(c.dataset.f); pinta(); });
        caja.querySelector('#bu-todas').onclick = () => { if (marcados.size === bs.length) marcados.clear(); else bs.forEach(b => marcados.add(b.folio)); pinta(); };
        const correr = async (btn, l, txt) => { const mot = await motivoReimp(l); if (mot === null) return; btn.disabled = true; const prog = window.SAR_Progreso ? window.SAR_Progreso.iniciar(txt, ['Armando el PDF de etiquetas…']) : null;
          try { await pdf(l); if (prog) prog.paso('Registrando la impresión…'); await marcarImpresas(l, mot); if (prog) prog.listo(`${l.length} etiqueta${l.length === 1 ? '' : 's'} para imprimir`); marcados.clear(); pinta(); }
          catch (e) { if (prog) prog.error(); toast('No se pudo', e.message || String(e), 'error'); btn.disabled = false; } };
        caja.querySelector('#bu-pend').onclick = (e) => correr(e.currentTarget, pend, 'Imprimiendo etiquetas pendientes…');
        caja.querySelector('#bu-sel').onclick = (e) => correr(e.currentTarget, bs.filter(b => marcados.has(b.folio)), 'Reimprimiendo etiquetas…');
        caja.querySelectorAll('[data-eg]').forEach(b => b.onclick = () => editar(bs.filter(y => (y.grupo || y.folio) === b.dataset.eg), false, pinta));
        caja.querySelectorAll('[data-eb]').forEach(b => b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const un = bs.find(y => y.folio === b.dataset.eb); editar(bs.filter(y => (y.grupo || y.folio) === (un.grupo || un.folio)), un, pinta); });
        const cr = caja.querySelector('#bu-crea'); if (cr) cr.onclick = async () => {   /* abre «Nuevas etiquetas» con lo que falta: ahí se indican las cajas de cada producto */
          const ve = await etiquetar({ lineas: x.faltan.map(f => ({ ...f })), encima: true });
          if (ve) ve._fin = async () => { try { bultos = await listar(5000); } catch (e) { /* queda lo que había */ } pinta(); };
        };
      };
      pinta();
      if (foco) { const g = [...caja.querySelectorAll('[data-grp]')].find(e => e.dataset.grp === foco); if (g && g.scrollIntoView) g.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      else if (foco === '' && x.faltan.length) { const fz = caja.querySelector('.bu-falta'); if (fz && fz.scrollIntoView) fz.scrollIntoView({ block: 'center' }); }
    };
    lista();
    return ov;
  }
  /** Cantidad de órdenes con etiquetas pendientes (faltan, sin imprimir o editadas) en el menú lateral. */
  function pintarBadge(l) { if (!Array.isArray(l)) return; const n = l.filter(x => ['faltan', 'editada', 'sin'].includes(x.est.k)).length; try { sessionStorage.setItem('etq-pend', JSON.stringify({ n, en: Date.now() })); } catch (e) { /* sin almacenamiento */ } ponerBadge(n); }
  function ponerBadge(n) { const b = document.getElementById('etq-badge'); if (!b) return; b.style.display = n ? '' : 'none'; b.textContent = n > 99 ? '99+' : String(n); b.title = n ? `${n} orden(es) con etiquetas pendientes` : ''; }
  /** Al entrar al sistema: cuenta las órdenes con etiquetas pendientes (una vez cada 30 min por pestaña) para el aviso del menú. */
  function contarAlIniciar() {
    let k = 0; const t = setInterval(async () => {
      k++; const rol = String((document.body && document.body.dataset.userRole) || '').toLowerCase(); if (!(usuario() && fs() && db() && rol) && k < 40) return; clearInterval(t);
      if (!rol || ['enfermero', 'solicitante', 'transitoria'].includes(rol)) return;
      try { const c = JSON.parse(sessionStorage.getItem('etq-pend') || 'null'); if (c && Date.now() - c.en < 30 * 60 * 1000) { ponerBadge(c.n); return; } } catch (e) { /* sigue */ }
      try { const [ocs, bs] = await Promise.all([leerOCs(), listar(5000)]), porNum = new Map(); bs.forEach(b => { const kk = String(b.oc || '').trim(); if (!porNum.has(kk)) porNum.set(kk, []); porNum.get(kk).push(b); });
        pintarBadge(ocs.map(o => { const l = porNum.get(String(o.numeroOC || '').trim()) || []; return { est: estadoOC(l, faltantesOC(o, l, '2026-11-14').reduce((s2, x) => s2 + x.total, 0)) }; }).concat((porNum.get('') || []).length ? [{ est: estadoOC(porNum.get(''), 0) }] : []));
      } catch (e) { /* sin aviso */ }
    }, 3000);
  }
  /** Página del menú «Impresión de etiquetas». */
  function abrirEtiquetas() { const r = document.getElementById('etq-root'); if (r) return porOC({ en: r }); }
  /** Corrige los datos impresos de una etiqueta o de todo su grupo (mismo producto y lote). No cambia el stock. */
  function editar(grupo, uno, alGuardar) {
    const a = uno || grupo[0], unaSola = !!uno, puedeCant = unaSola && a.estado === 'CERRADA' && a.nivel !== 'interior' && !a.subcajas;   /* v21.238: con cajas interiores la cantidad sale de ellas */
    const ov = ventana(unaSola ? `Editar etiqueta ${a.folio}` : `Editar ${grupo.length} etiqueta${grupo.length === 1 ? '' : 's'}`, `
      <p class="si-v">Cambia solo lo que dice la etiqueta, no el stock. ${unaSola ? '' : 'Se aplica a todas las cajas de este producto y lote. '}Después queda marcada «Editada · reimprimir».</p>
      <label class="bu-l">Producto (como sale en la etiqueta)<input id="be-nom" class="si-in" value="${esc(a.nombre || '')}"></label>
      <div class="bu-g3"><label class="bu-l">Lote<input id="be-lote" class="si-in" value="${esc(a.lote || '')}"></label><label class="bu-l">Vence<input id="be-vence" type="date" class="si-in" value="${esc(a.vence || '')}"></label><label class="bu-l">Bodega<input id="be-bod" class="si-in" value="${esc(a.bodega || '')}"></label></div>
      <div class="bu-g3"><label class="bu-l">Proveedor<input id="be-prov" class="si-in" value="${esc(a.proveedor || '')}"></label><label class="bu-l">Fecha de recepción<input id="be-fr" type="date" class="si-in" value="${esc(a.fechaRecepcion || '')}"></label>${puedeCant ? `<label class="bu-l">Unidades en esta caja<input id="be-cant" type="number" min="1" class="si-in" inputmode="numeric" value="${num(a.contenido)}"></label>` : ''}</div>
      ${unaSola && !puedeCant ? `<p class="si-v">${a.estado !== 'CERRADA' ? 'La caja ya está abierta: su cantidad se cambia al escanearla.' : 'Esta caja tiene cajas interiores (o es una): su cantidad no se edita aquí.'}</p>` : ''}
      <div class="fp-facc"><button type="button" class="btn btn-secondary" id="be-x">Cancelar</button><button type="button" class="btn btn-primary" id="be-ok">Guardar cambios</button></div>`, { encima: true });
    const v = (id) => { const e = ov.querySelector('#' + id); return e ? e.value.trim() : null; };
    ov.querySelector('#be-x').onclick = () => ov.cerrar();
    ov.querySelector('#be-ok').onclick = async (e) => {
      const nuevo = { nombre: v('be-nom'), lote: v('be-lote') || 'S/L', vence: v('be-vence'), bodega: v('be-bod'), proveedor: v('be-prov'), fechaRecepcion: v('be-fr') };
      if (!nuevo.nombre) { toast('Etiqueta', 'El producto no puede quedar vacío.', 'warning'); return; }
      const cant = puedeCant ? Math.floor(num(v('be-cant'))) : null; if (puedeCant && cant < 1) { toast('Etiqueta', 'Indica las unidades de la caja (1 o más).', 'warning'); return; }
      const objetivo = unaSola ? [a] : grupo, cambiosDe = (b) => { const c = {}; Object.keys(nuevo).forEach(k => { if (String(b[k] || '') !== String(nuevo[k] || '')) c[k] = nuevo[k]; }); if (cant != null && b === a && cant !== num(b.contenido)) { c.contenido = cant; c.inicial = cant; } return c; };
      const conCambios = objetivo.map(b => [b, cambiosDe(b)]).filter(([, c]) => Object.keys(c).length);
      if (!conCambios.length) { ov.cerrar(); return; }
      e.target.disabled = true; const prog = window.SAR_Progreso ? window.SAR_Progreso.iniciar('Guardando los cambios de la etiqueta…', ['Actualizando ' + conCambios.length + ' etiqueta(s)…']) : null;
      try {
        const orig = (b, c) => ({ ...(c.nombre != null && b.nombreOrig == null ? { nombreOrig: b.nombre } : {}), ...(c.lote != null && b.loteOrig == null ? { loteOrig: b.lote } : {}) });
        await Promise.all(conCambios.map(([b, c]) => guardar(b, (x) => { if (c.contenido != null && x.estado !== 'CERRADA') throw new Error(`La caja ${x.folio} ya se abrió en otro equipo: su cantidad se cambia al escanearla.`); return { ...c, ...orig(x, c), editadoTrasImprimir: estadoImp(x) !== 'sin' }; }, 'EDITADO', { campos: Object.keys(c) })));
        if (cant != null && conCambios.some(([, c]) => c.contenido != null)) {   // el total del lote y las unidades por caja salen en todas las etiquetas del grupo
          const tot = grupo.reduce((t, b) => t + uds(b), 0), pc = Math.max(...grandes(grupo).map(b => uds(b)));
          await Promise.all(grupo.filter(b => num(b.totalGrupo) !== tot || (b.nivel !== 'interior' && num(b.porCaja) !== pc)).map(b => guardar(b, { totalGrupo: tot, ...(b.nivel === 'interior' ? {} : { porCaja: pc }), editadoTrasImprimir: estadoImp(b) !== 'sin' }, 'EDITADO', { campos: ['totalGrupo'] })));
        }
        if (prog) prog.listo('Etiqueta corregida · queda para reimprimir'); ov.cerrar(); if (alGuardar) alGuardar();
      } catch (er) { if (prog) prog.error(); toast('No se guardó', er.message || String(er), 'error'); e.target.disabled = false; }
    };
    return ov;
  }

  async function abrir() {
    const r = document.getElementById('bu-root'); if (!r) return;
    r.innerHTML = `<div class="si-wrap si-ancho"><div class="si-cab"><div><h2 class="si-t">Bultos y etiquetas</h2><p class="si-s">Cada caja con su etiqueta: producto, lote, vencimiento, cuántas unidades trae y «bulto 3 de 10». Se lee con el teléfono (QR) o con pistola (código de barras).</p></div></div>
      <div class="bu-acc"><button type="button" class="bu-big" data-x="oc"><i class="ph-bold ph-clipboard-text"></i><b>Etiquetas por orden de compra</b><small>Estado de impresión, reimprimir o corregir datos</small></button><button type="button" class="bu-big" data-x="nueva"><i class="ph-bold ph-tag"></i><b>Crear etiquetas</b><small>Para un producto y lote (o reimprimir)</small></button><button type="button" class="bu-big" data-x="existente"><i class="ph-bold ph-list-checks"></i><b>Etiquetar stock existente</b><small>Contar lo que ya estaba en el sistema y etiquetarlo</small></button><button type="button" class="bu-big" data-x="ver"><i class="ph-bold ph-scan"></i><b>Escanear bulto</b><small>Ver qué tiene, abrir la caja, cuánto queda</small></button><button type="button" class="bu-big" data-x="contar"><i class="ph-bold ph-barcode"></i><b>Contar por bultos</b><small>Pistolea las cajas: las cerradas suman solas</small></button></div>
      <h3 class="si-h">Bultos registrados</h3><div id="bu-tab"><p class="si-v">Cargando…</p></div></div>`;
    r.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { const x = b.dataset.x; if (x === 'oc') porOC().then(ov => { if (ov) { const o = ov._fin; ov._fin = () => { if (o) o(); abrir(); }; } }); else if (x === 'nueva') etiquetar({}); else if (x === 'existente') etiquetar({ conteo: true }); else escanear(x === 'contar' ? 'conteo' : 'ver').then(ov => { if (ov) { const o = ov._fin; ov._fin = () => { o(); abrir(); }; } }); });
    try {
      const l = await listar(), t = r.querySelector('#bu-tab'), est = (e) => l.filter(b => b.estado === e).length;
      t.innerHTML = l.length ? `<p class="si-v">${l.length} bulto(s): ${est('CERRADA')} cerrados · ${est('ABIERTA')} abiertos · ${est('VACIA')} vacíos.</p><div class="fp-tw"><table class="si-tb"><thead><tr><th>Folio</th><th>Producto</th><th>Lote</th><th>Bulto</th><th>Contenido</th><th>Estado</th><th>Etiqueta</th><th>Bodega</th></tr></thead><tbody>${l.slice(0, 300).map(b => `<tr><td>${esc(b.folio)}</td><td>${esc(b.nombre)}</td><td>${esc(b.lote)}</td><td>${b.n}/${b.de}</td><td>${b.contenido}/${b.inicial || b.porCaja}</td><td><span class="bu-est bu-est-${esc(b.estado)}">${esc(b.estado)}</span></td><td><span class="bu-imp bu-imp-${estadoImp(b)}">${esc(textoImp(b))}</span></td><td>${esc(b.bodega)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="si-v">Aún no hay bultos etiquetados.</p>';
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
  /** Al terminar una recepción: los productos con cajas contadas generan sus etiquetas solas (un PDF con todas);
      los que quedaron sin cajas se ofrecen para etiquetar después. */
  async function desdeRecepcion(o) {
    const con = (o.lineas || []).filter(l => num(l.cajas) > 0 && num(l.total) > 0), sin = (o.lineas || []).filter(l => !(num(l.cajas) > 0) && num(l.total) > 0);
    if (con.length) {
      const bg = window.SAR_Progreso && window.SAR_Progreso.segundoPlano ? window.SAR_Progreso.segundoPlano('Etiquetas de bultos') : null, todas = [];
      try {
        for (const [k, l] of con.entries()) { if (bg) bg.paso(`${k + 1} de ${con.length}: ${String(l.nombre).slice(0, 40)} (${l.cajas} cajas)`); todas.push(...await crear(l)); }
        if (bg) bg.listo(`${todas.length} etiqueta(s) creadas: ${todas[0].folio}${todas.length > 1 ? ' a ' + todas[todas.length - 1].folio : ''}`);
        const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: `${todas.length} etiqueta${todas.length === 1 ? '' : 's'} lista${todas.length === 1 ? '' : 's'}`, texto: `Una por caja de la recepción <b>${esc(o.rec || '')}</b>.`, lineas: con.map(l => `${esc(l.nombre)} · <b>${l.cajas}</b> caja(s) · ${num(l.total)} u.`), si: 'Imprimir ahora', no: 'Después' }) : true;
        if (ok) await imprimir(todas, `bultos-${String(o.rec || '').replace(/[^A-Za-z0-9-]+/g, '_')}.pdf`);
        else toast('Etiquetas guardadas', 'Quedan «sin imprimir» en Bultos y etiquetas → Etiquetas por orden de compra.', 'info');
      } catch (e) { if (bg) bg.error(e.message || String(e)); toast('Etiquetas', e.message || String(e), 'error'); }
    }
    if (sin.length) ofrecerRecepcion({ rec: o.rec, lineas: sin });
  }
  /** Al abrir el visor desde el QR de una etiqueta (#bulto=BUL-…). */
  function revisarHash() { const m = /bulto=([A-Z0-9-]+)/i.exec(window.location.hash || ''); if (!m) return; const folio = folioDe(m[1]); history.replaceState(null, '', window.location.pathname + '#view-bultos'); let k = 0; const t = setInterval(() => { k++; if (!(usuario() && fs() && db()) && k < 60) return; clearInterval(t); escanear('ver').then(ov => { const i = ov && ov.querySelector('#bu-in'); if (i) { i.value = folio; ov.querySelector('#bu-ok').click(); } }); }, 1000); }
  if (typeof module === 'undefined' && typeof window.addEventListener === 'function' && document.getElementById) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', contarAlIniciar); else contarAlIniciar(); }
  if (typeof module === 'undefined' && typeof window.addEventListener === 'function') { window.addEventListener('hashchange', revisarHash); if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', revisarHash); else revisarHash(); }

  // ---------------- prueba de la pistola (v21.242) ----------------
  /* Hoja con el mismo número en varios tipos y grosores de código de barras, para ver cuál lee la pistola.
     Cada variante lleva un número distinto (999000000N) para saber cuál se leyó. */
  const C39 = { '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000', '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101', '8': '100100100', '9': '001100100', '*': '010010100' };
  /** Code 39 → anchos en «puntos» (n = angosto, w = ancho), con 1 angosto entre caracteres. */
  function code39(txt, n, w) { const r = []; ('*' + txt + '*').split('').forEach((ch, k, arr) => { (C39[ch] || '').split('').forEach(b => r.push(b === '1' ? w : n)); if (k < arr.length - 1) r.push(n); }); return r; }
  const I25 = ['00110', '10001', '01001', '11000', '00101', '10100', '01100', '00011', '10010', '01010'];
  /** Interleaved 2 of 5 (cantidad par de dígitos) → anchos en puntos. */
  function i2de5(dig, n, w) { const r = [n, n, n, n]; for (let i = 0; i + 1 < dig.length; i += 2) { const a = I25[+dig[i]], b = I25[+dig[i + 1]]; for (let k = 0; k < 5; k++) { r.push(a[k] === '1' ? w : n, b[k] === '1' ? w : n); } } r.push(w, n, n); return r; }
  const PRUEBAS = [
    { id: 'A', t: 'Code 128 · grosor actual (5 puntos)', txt: '9990000001', anchos: (P) => P.barras('9990000001').map(x => x * 5), alto: 10.5 },
    { id: 'B', t: 'Code 128 · 4 puntos, más alto', txt: '9990000002', anchos: (P) => P.barras('9990000002').map(x => x * 4), alto: 14 },
    { id: 'C', t: 'Code 128 · corto (3 puntos)', txt: '9990000003', anchos: (P) => P.barras('9990000003').map(x => x * 3), alto: 12 },
    { id: 'D', t: 'Code 39 · el más compatible', txt: '9990000004', anchos: () => code39('9990000004', 2, 5), alto: 12 },
    { id: 'E', t: 'Code 128 con letras', txt: 'PRUEBA-E', anchos: (P) => P.barrasB('PRUEBA-E').map(x => x * 4), alto: 12 },
    { id: 'F', t: 'Interleaved 2 de 5 (14 dígitos)', txt: '99900000000006', anchos: () => i2de5('99900000000006', 3, 8), alto: 12 }];   /* muchas pistolas solo leen I2of5 de 14 */
  async function hojaPrueba() {
    const J = window.jspdf && window.jspdf.jsPDF, P = window.SAR_Precintos; if (!J || !P) throw new Error('La librería de PDF aún no carga; intenta de nuevo en unos segundos.');
    const d = new J({ orientation: 'landscape', unit: 'mm', format: [100, 60] }), PUNTO = 25.4 / 203;
    const dibujar = (v, y) => { const a = v.anchos(P), tot = a.reduce((s2, w) => s2 + w, 0) * PUNTO, x0 = Math.round(((100 - tot) / 2) / PUNTO) * PUNTO; let xx = x0;
      a.forEach((w, i) => { if (i % 2 === 0) d.rect(xx, y, w * PUNTO, v.alto, 'F'); xx += w * PUNTO; });
      d.setFont('helvetica', 'bold'); d.setFontSize(9); d.text(`${v.id}`, 3, y - 1.2); d.setFont('helvetica', 'normal'); d.setFontSize(7); d.text(`${v.t} · ${v.txt} · ${tot.toFixed(1)} mm`, 7, y - 1.2); };
    for (let k = 0; k < PRUEBAS.length; k += 2) {
      if (k) d.addPage([100, 60], 'landscape');
      dibujar(PRUEBAS[k], 6); dibujar(PRUEBAS[k + 1], 6 + PRUEBAS[k].alto + 8);
      /* regla: si al imprimir no mide 50 mm, la impresora está escalando la hoja y las barras salen deformes */
      d.setLineWidth(0.3); d.line(25, 55.5, 75, 55.5); d.line(25, 54, 25, 57); d.line(75, 54, 75, 57); d.setFontSize(6.5); d.text('Esta línea debe medir 50 mm (imprimir a tamaño real, sin «ajustar»)', 50, 59, { align: 'center' });
    }
    const url = URL.createObjectURL(d.output('blob')), w = window.open(url, '_blank'); if (!w) d.save('prueba-pistola.pdf'); setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  /** Ventana: descargar la hoja, escanear cada código y ver cuál leyó (y qué texto escribió la pistola). */
  function probarPistola() {
    const ov = ventana('Probar la pistola', `<p class="si-s">1) Imprime la hoja de prueba en la Zebra a <b>tamaño real</b> (100 × 60 mm, sin «ajustar a la página»). 2) Mide la línea de abajo: debe medir 50 mm. 3) Pistolea cada código aquí abajo.</p>
      <p><button type="button" class="btn btn-secondary" id="bu-hp"><i class="ph-bold ph-printer" aria-hidden="true"></i> Hoja de prueba (PDF)</button></p>
      <div class="bu-man"><input id="bu-pin" class="si-in" placeholder="Pistolea aquí cada código de la hoja" autocomplete="off"></div>
      <div id="bu-pres" aria-live="polite"></div>`);
    const inp = ov.querySelector('#bu-pin'), res = ov.querySelector('#bu-pres'), leidas = new Map();
    ov.querySelector('#bu-hp').onclick = () => hojaPrueba().catch(e => alert(e.message));
    const pintar = (ultimo, vu) => { res.innerHTML = `<table class="si-tb"><thead><tr><th></th><th>Código</th><th>¿Lo leyó?</th></tr></thead><tbody>${PRUEBAS.map(v => { const l = leidas.get(v.id); return `<tr><td><b>${v.id}</b></td><td>${esc(v.t)}</td><td>${l ? (l === v.txt ? '<b style="color:#4D7C0F">Sí</b>' : `Sí, pero escribió «${esc(l)}» (revisar idioma del teclado de la pistola)`) : '—'}</td></tr>`; }).join('')}</tbody></table>${ultimo ? `<p class="si-s">Último leído: «${esc(ultimo)}»${vu ? ` (prueba ${vu.id})` : ' (no es de la hoja de prueba)'}${sufijo && sufijo !== 'Enter' ? ` · La pistola termina con <b>${sufijo === 'Tab' ? 'Tab' : 'nada'}</b> en vez de Enter: el Visor ya lo acepta en esta prueba, pero conviene configurarla con Enter (sufijo CR) desde su manual.` : ''}</p>` : ''}`; };
    const buscarV = (t) => PRUEBAS.find(x => x.txt === t) || PRUEBAS.find(x => x.txt.replace(/\D/g, '') && x.txt.replace(/\D/g, '') === t.replace(/\D/g, '')) || (/PRUEBA/i.test(t) ? PRUEBAS[4] : null);
    let tm = null, sufijo = '';
    const registrar = (como) => { clearTimeout(tm); const t = inp.value.trim(); inp.value = ''; if (!t) return; if (!sufijo) sufijo = como; const v = buscarV(t); if (v) leidas.set(v.id, t); pintar(t, v); };
    /* la pistola termina con Enter, con Tab o sin nada: se aceptan los tres (sin nada = deja de escribir 250 ms) */
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); registrar(e.key === 'Enter' ? 'Enter' : 'Tab'); } });
    inp.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => registrar('nada'), 250); });
    pintar(''); setTimeout(() => inp.focus(), 50); return ov;
  }
  window.SAR_Bultos = { esTag, avisoTag, reservarFolios, reservarTramo, quedanReservados, leerCajasTx, leerConCamara, leer, sacar, probarPistola, hojaPrueba, code39, i2de5, planCajas, registrarConteo, diferencias, enLote, porOC, abrirEtiquetas, editar, imprimir, marcarImpresas, estadoImp, estadoOC, faltantesOC, desdeRecepcion, repartirEnCajas, cargarQR, matrizQR, abrir, etiquetar, escanear, ofrecerRecepcion, pdf, crear, listar, sugerirPorCaja, repartirCajas, folioDe, digitos, resumirConteo };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SAR_Bultos;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: null, addEventListener() {} });
