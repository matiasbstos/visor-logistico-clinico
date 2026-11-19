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
  /** Jerarquía caja completa (master) → cajas individuales (subcajas) (v21.234). */
  const esSubcaja = (b) => !!(b && (b.nivel === 'subcaja' || b.padreFolio));
  const esMaster = (b) => !!(b && !esSubcaja(b) && (b.nivel === 'master' || num(b.subcajasPorCaja) > 0 || b.subcajasCreadas));
  /** Folio de subcaja: BUL-2026-000123-01 (12 dígitos) o -0100 (14 dígitos si >= 100), siempre par para Code 128 C. */
  function folioSubcaja(padreFolio, idx, totalSubcajas) {
    const ancho = num(totalSubcajas) >= 100 ? 4 : 2;
    return `${padreFolio}-${String(Math.max(1, Math.floor(num(idx)))).padStart(ancho, '0')}`;
  }
  /** Reparte el contenido de una caja completa en sus cajas individuales. */
  function repartirSubcajas(totalCaja, cantSubcajas, uPorSubcaja) {
    const t = Math.max(0, Math.floor(num(totalCaja))); if (!t) return [];
    if (num(uPorSubcaja) > 0) return repartirCajas(t, num(uPorSubcaja));
    if (num(cantSubcajas) > 0) return repartirEnCajas(t, num(cantSubcajas));
    return [];
  }
  /** Folio ↔ código de barras (solo dígitos, Code 128 C): BUL-2026-000123 ↔ 2026000123 · BUL-2026-000123-03 ↔ 202600012303. */
  const digitos = (folio) => String(folio || '').replace(/\D/g, '');
  /** Lo que se lee (QR con URL, texto del folio o dígitos de la pistola) → folio (master o subcaja). */
  function folioDe(leido) {
    const t = String(leido || '').trim();
    const ms = /BUL-?(\d{4})-?(\d{6})-(\d{2,4})\b/i.exec(t);
    if (ms) return `BUL-${ms[1]}-${ms[2]}-${ms[3]}`;
    const m = /BUL-?(\d{4})-?(\d{6})/i.exec(t);
    if (m) return `BUL-${m[1]}-${m[2]}`;
    const d = t.replace(/\D/g, '');
    if (/^\d{14}$/.test(d)) return `BUL-${d.slice(0, 4)}-${d.slice(4, 10)}-${d.slice(10)}`;
    if (/^\d{12}$/.test(d)) return `BUL-${d.slice(0, 4)}-${d.slice(4, 10)}-${d.slice(10)}`;
    return /^\d{10}$/.test(d) ? `BUL-${d.slice(0, 4)}-${d.slice(4)}` : '';
  }
  /** Evita doble conteo entre una caja completa y sus cajas individuales al pistolear. */
  function conflictoJerarquia(leidos, candidato) {
    if (!candidato) return { bloqueo: false };
    const lista = leidos || [];
    if (!esSubcaja(candidato)) {
      if (candidato.estado === 'DESGLOSADA') {
        return { bloqueo: true, motivo: `La caja completa ${candidato.folio} ya fue desglosada en cajas individuales: escanea las cajas individuales que queden.` };
      }
      const hija = lista.find(x => esSubcaja(x) && x.padreFolio === candidato.folio);
      if (hija) {
        return { bloqueo: true, motivo: `Ya escaneaste cajas individuales de ${candidato.folio} (ej. ${hija.folio}): no se suma la caja completa para evitar doble conteo.` };
      }
    } else if (candidato.padreFolio) {
      const padre = lista.find(x => x.folio === candidato.padreFolio);
      if (padre) {
        return { bloqueo: true, motivo: `Ya escaneaste la caja completa ${candidato.padreFolio}: no se suman además sus cajas individuales para evitar doble conteo.` };
      }
    }
    return { bloqueo: false };
  }
  /** Conteo por bultos: suma por producto|lote|bodega (cerrada = su contenido; abierta = lo que se informó; sin doble conteo padre↔hija). */
  function resumirConteo(leidos) {
    const arr = (leidos || []).filter(Boolean);
    const padresConHija = new Set(arr.filter(esSubcaja).map(b => b.padreFolio).filter(Boolean));
    const m = new Map();
    arr.forEach(b => {
      if (!esSubcaja(b) && (b.estado === 'DESGLOSADA' || padresConHija.has(b.folio))) return;
      const k = [norm(b.nombre), b.lote || 'S/L', b.bodega || ''].join('|');
      const e = m.get(k) || { nombre: b.nombre, lote: b.lote || 'S/L', vence: b.vence || '', bodega: b.bodega || '', cajas: 0, abiertas: 0, unidades: 0, insumoId: b.insumoId || '' };
      e.cajas++; if (b.estado === 'ABIERTA') e.abiertas++; e.unidades += num(b.contado != null ? b.contado : b.contenido); m.set(k, e);
    });
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
    lista.forEach((b, k) => {
      if (k) d.addPage([100, 60], 'landscape');
      d.setTextColor(0); d.setDrawColor(0);
      const sub = esSubcaja(b), mast = esMaster(b);
      // cabecera: logo + tipo de caja (CAJA COMPLETA / CAJA INDIVIDUAL / BULTO) y numeración n/N
      if (logo) d.addImage(logo.d, 'JPEG', 2.5, 2, 22, 22 / logo.r, 'logo', 'FAST');
      if (mast) {
        d.setFillColor(0); d.rect(26.5, 2.2, 24.5, 4.4, 'F');
        d.setTextColor(255); d.setFont('helvetica', 'bold'); d.setFontSize(6.5); d.text('CAJA COMPLETA', 38.75, 5.2, { align: 'center' });
        d.setTextColor(0); d.setFontSize(15); d.text(`${b.n} / ${b.de}`, 63.5, 10.2, { align: 'right' });
      } else if (sub) {
        d.setLineWidth(0.45); d.rect(26.5, 2.2, 25.5, 4.4);
        d.setFont('helvetica', 'bold'); d.setFontSize(6.3); d.text('CAJA INDIVIDUAL', 39.25, 5.2, { align: 'center' });
        d.setFontSize(15); d.text(`${b.subN || b.n} / ${b.subDe || b.de}`, 63.5, 10.2, { align: 'right' });
      } else {
        d.setFont('helvetica', 'bold'); d.setFontSize(7); d.text('BULTO', 63, 4.6, { align: 'right' }); d.setFontSize(16); d.text(`${b.n} / ${b.de}`, 63, 10.2, { align: 'right' });
      }
      d.setLineWidth(0.35); d.line(2.5, 11.8, 64, 11.8);
      // producto
      d.setFont('helvetica', 'bold'); d.setFontSize(9.5); const nom = d.splitTextToSize(String(b.nombre || '').toUpperCase(), 61).slice(0, sub ? 2 : 3); d.text(nom, 2.5, 15.4); let y = 15.4 + nom.length * 3.6;
      d.setFontSize(8.5); d.text(`Lote ${b.lote || 'S/L'}`, 2.5, y + 0.5); d.text(`Vence ${b.vence ? fechaCL(b.vence) : '—'}`, 64, y + 0.5, { align: 'right' }); y += 4.2;
      d.setFont('helvetica', 'normal'); d.setFontSize(6.8);
      const meta = sub
        ? [['De caja', `${b.padreFolio || ''}${b.subDe ? ` (${b.subDe} bultos internos)` : ''}`], ['Proveedor', b.proveedor], ['OC', b.oc], ['Recibido', (b.fechaRecepcion ? fechaCL(b.fechaRecepcion) : '') + (b.bodega ? ' · ' + b.bodega : '')]]
        : [['Proveedor', b.proveedor], ['OC', b.oc], ['Recepción', b.rec], ['Recibido', (b.fechaRecepcion ? fechaCL(b.fechaRecepcion) : '') + (b.bodega ? ' · ' + b.bodega : '')]];
      meta.forEach(([t, v]) => { if (!v || y > 41.2) return; d.setFont('helvetica', 'normal'); d.text(t + ':', 2.5, y); d.setFont('helvetica', 'bold'); d.text(String(v).slice(0, 42), 18, y); y += 3.1; });
      // QR a la derecha (teléfono)
      const m = matrizQR(URL_APP + '#bulto=' + b.folio), lado = 32, cel = lado / m.length, x0 = 66, y0 = 2;
      m.forEach((fila, r) => fila.forEach((on, c) => { if (on) d.rect(x0 + c * cel, y0 + r * cel, cel + 0.02, cel + 0.02, 'F'); }));
      d.setFont('helvetica', 'bold'); d.setFontSize(sub ? 6.6 : 7.5); d.text(b.folio, x0 + lado / 2, y0 + lado + 3.2, { align: 'center' });
      // banda de cantidades
      d.setLineWidth(0.35); d.line(2.5, 42.6, 97.5, 42.6);
      if (mast) {
        const totCaja = num(b.inicial != null ? b.inicial : b.contenido);
        const subCant = num(b.subcajasEnEsta || b.subcajasPorCaja);
        const uSub = num(b.unidadesPorSubcaja);
        const subPartes = subCant > 0 ? repartirSubcajas(totCaja, subCant, uSub) : [];
        const restoDistinto = subPartes.length > 1 && subPartes[subPartes.length - 1] !== subPartes[0];
        const detAdentro = subPartes.length
          ? (restoDistinto
              ? `Adentro: ${subPartes.length} bultos (${subPartes.length - 1}×${subPartes[0]} + 1×${subPartes[subPartes.length - 1]} u.)`
              : `Adentro: ${subPartes.length} bulto${subPartes.length === 1 ? '' : 's'} × ${subPartes[0]} u. c/u`)
          : `${b.de} caja${b.de === 1 ? '' : 's'} completa${b.de === 1 ? '' : 's'} · total ${b.totalGrupo} u.`;
        d.setFont('helvetica', 'bold'); d.setFontSize(8.8); d.text(`${totCaja} u. en total`, 2.5, 46.6);
        d.setFont('helvetica', 'bold'); d.setFontSize(7.2); d.text(detAdentro, 97.5, 46.6, { align: 'right' });
      } else if (sub) {
        d.setFont('helvetica', 'bold'); d.setFontSize(8.8); d.text(`${b.contenido} u. en este bulto`, 2.5, 46.6);
        d.setFont('helvetica', 'normal'); d.setFontSize(7); d.text(`Bulto interno ${b.subN || b.n}/${b.subDe || b.de}${b.padreTotal ? ' · Total caja: ' + b.padreTotal + ' u.' : ''}`, 97.5, 46.6, { align: 'right' });
      } else {
        d.setFont('helvetica', 'bold'); d.setFontSize(9); d.text(`${b.contenido} u. en esta caja`, 2.5, 46.6); d.setFont('helvetica', 'normal'); d.setFontSize(7); d.text(`${b.porCaja} u. por caja · ${b.de} caja${b.de === 1 ? '' : 's'} · total ${b.totalGrupo} u.`, 97.5, 46.6, { align: 'right' });
      }
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
  async function guardar(b, cambios, accion, det) {
    /* v21.223: relee la caja antes de escribir (otro equipo pudo abrirla, contarla o imprimirla) para no pisar su historial */
    try { const fr = await Promise.race([leer(b.folio), new Promise(r => setTimeout(() => r(null), 2500))]); if (fr) Object.assign(b, fr); } catch (e) { /* sin conexión: sigue con lo local */ }
    if (typeof cambios === 'function') cambios = cambios(b);
    const h = (b.historial || []).concat([{ accion, por: usuario(), en: new Date().toISOString(), ...(cambios.contenido != null ? { contenido: cambios.contenido } : {}), ...(det || {}) }]).slice(-40);
    const x = { ...cambios, historial: h, actualizado: new Date().toISOString() };
    await Promise.race([fs().setDoc(ref(b.folio), x, { merge: true }), new Promise(r => setTimeout(r, 2500))]); Object.assign(b, x); return b;
  }
  /** Arma los documentos de cajas individuales (subcajas) a partir de una caja completa (puro). */
  function armarSubcajas(padre, cantSubcajas, uPorSubcaja, ahora, por) {
    const base = num(padre.inicial != null ? padre.inicial : padre.contenido);
    const partes = repartirSubcajas(base, cantSubcajas, uPorSubcaja);
    if (!partes.length) throw new Error('Indica cuántas cajas individuales trae o cuántas unidades viene en cada una.');
    if (partes.length > 200) throw new Error('Son más de 200 cajas individuales en una sola caja: revisa los valores.');
    const t = ahora || new Date().toISOString(), u = por || '';
    return partes.map((q, j) => ({
      tipo: 'bulto', nivel: 'subcaja',
      folio: folioSubcaja(padre.folio, j + 1, partes.length),
      padreFolio: padre.folio, padreN: padre.n, padreDe: padre.de, padreTotal: base,
      grupo: padre.grupo || padre.folio,
      n: j + 1, de: partes.length, subN: j + 1, subDe: partes.length,
      contenido: q, inicial: q, porCaja: num(uPorSubcaja) > 0 ? num(uPorSubcaja) : Math.max(...partes), totalGrupo: padre.totalGrupo || base,
      estado: 'CERRADA',
      nombre: padre.nombre, insumoId: padre.insumoId || '', codigoMP: padre.codigoMP || '', bodega: padre.bodega || '',
      lote: padre.lote || 'S/L', vence: padre.vence || '', proveedor: padre.proveedor || '', oc: padre.oc || '', rec: padre.rec || '',
      fechaRecepcion: padre.fechaRecepcion || hoyISO(),
      creadoEn: t, creadoPor: u, impresiones: 0,
      historial: [{ accion: 'CREADO_SUBCAJA', padre: padre.folio, por: u, en: t }]
    }));
  }
  /** Crea los bultos de un grupo (mismo producto, lote y vencimiento) con folios correlativos reservados de una vez.
      Si g.conSubcajas está activo, marca las cajas como nivel 'master' y opcionalmente crea sus cajas individuales ahora. */
  async function crear(g) {
    const cajas = num(g.cajas) > 0 ? repartirEnCajas(g.total, g.cajas) : repartirCajas(g.total, g.porCaja); if (!cajas.length) throw new Error('Indica el total de unidades y cuántas cajas son (o cuántas vienen por caja).');
    if (cajas.length > 300) throw new Error('Son más de 300 cajas: revisa las unidades por caja.');
    const conSub = !!g.conSubcajas && (num(g.subcajasPorCaja) > 0 || num(g.unidadesPorSubcaja) > 0);
    const genAhora = conSub && !!g.generarSubcajasAhora;
    if (genAhora) {
      const totEtq = cajas.reduce((s, q) => s + 1 + repartirSubcajas(q, g.subcajasPorCaja, g.unidadesPorSubcaja).length, 0);
      if (totEtq > 400) throw new Error(`Se generarían ${totEtq} etiquetas de una vez (máx. 400). Genera primero las cajas completas y desglosa cada caja cuando la abras.`);
    }
    const f = fs(), anio = new Date().getFullYear(), rc = f.doc(f.collection(db(), 'Contadores'), 'correlativo-bultos-' + anio);
    const ini = await f.runTransaction(db(), async (tx) => { const s = await tx.get(rc), v = s.exists() ? num(s.data().valor) : 0; tx.set(rc, { valor: v + cajas.length, actualizado: new Date().toISOString() }); return v + 1; });
    const ahora = new Date().toISOString(), grupo = `BUL-${anio}-${String(ini).padStart(6, '0')}`, u = usuario();
    const todas = [];
    const masters = cajas.map((q, i) => {
      const subPartes = conSub ? repartirSubcajas(q, g.subcajasPorCaja, g.unidadesPorSubcaja) : [];
      return {
        tipo: 'bulto', ...(conSub ? { nivel: 'master', subcajasPorCaja: num(g.subcajasPorCaja) || subPartes.length, subcajasEnEsta: subPartes.length, unidadesPorSubcaja: num(g.unidadesPorSubcaja) || (subPartes[0] || 0), subcajasCreadas: genAhora } : {}),
        folio: `BUL-${anio}-${String(ini + i).padStart(6, '0')}`, grupo, n: i + 1, de: cajas.length, contenido: q, inicial: q, porCaja: num(g.cajas) > 0 ? Math.max(...cajas) : num(g.porCaja), totalGrupo: cajas.reduce((s, x) => s + x, 0), estado: 'CERRADA',
        nombre: g.nombre, insumoId: g.insumoId || '', codigoMP: g.codigoMP || '', bodega: g.bodega || '', lote: g.lote || 'S/L', vence: g.vence || '', proveedor: g.proveedor || '', oc: g.oc || '', rec: g.rec || '', fechaRecepcion: g.fechaRecepcion || hoyISO(), creadoEn: ahora, creadoPor: u, impresiones: 0, historial: [{ accion: 'CREADO', por: u, en: ahora }]
      };
    });
    for (const m of masters) {
      await f.setDoc(ref(m.folio), m);
      todas.push(m);
      if (genAhora) {
        const subs = armarSubcajas(m, g.subcajasPorCaja, g.unidadesPorSubcaja, ahora, u);
        for (const s of subs) { await f.setDoc(ref(s.folio), s); todas.push(s); }
      }
    }
    try { sessionStorage.removeItem('etq-pend'); } catch (e) { /* sin almacenamiento */ }
    return todas;
  }
  /** Lee las cajas individuales que ya existen para una caja completa. */
  async function subcajasDe(padreFolio) {
    const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Contadores'), f.where('padreFolio', '==', padreFolio), f.limit(250))), l = [];
    sn.forEach(d => l.push(d.data()));
    return l.sort((a, b) => num(a.subN || a.n) - num(b.subN || b.n));
  }
  /** Desglosa una caja completa en sus cajas individuales (si ya existían, devuelve las existentes; si marcaAbierta, marca la caja madre DESGLOSADA para evitar doble conteo). */
  async function desglosar(padre, opc) {
    const o = opc || {};
    if (!padre || esSubcaja(padre)) throw new Error('Solo se puede desglosar una caja completa.');
    const existentes = await subcajasDe(padre.folio);
    if (existentes.length) {
      if (o.marcarDesglosada && padre.estado !== 'DESGLOSADA') {
        await guardar(padre, { estado: 'DESGLOSADA', subcajasCreadas: true, nivel: 'master' }, 'DESGLOSADA', { subcajas: existentes.length });
      }
      return { subcajas: existentes, yaExistian: true };
    }
    const cant = num(o.subcajasPorCaja || padre.subcajasEnEsta || padre.subcajasPorCaja);
    const uSub = num(o.unidadesPorSubcaja || padre.unidadesPorSubcaja);
    const ahora = new Date().toISOString(), subs = armarSubcajas(padre, cant, uSub, ahora, usuario());
    const f = fs();
    for (const s of subs) await f.setDoc(ref(s.folio), s);
    const cambiosPadre = {
      nivel: 'master',
      subcajasPorCaja: cant || subs.length,
      subcajasEnEsta: subs.length,
      unidadesPorSubcaja: uSub || (subs[0] ? subs[0].contenido : 0),
      subcajasCreadas: true,
      ...(o.marcarDesglosada ? { estado: 'DESGLOSADA' } : {})
    };
    await guardar(padre, cambiosPadre, o.marcarDesglosada ? 'DESGLOSADA' : 'SUBCAJAS_CREADAS', { subcajas: subs.length });
    try { sessionStorage.removeItem('etq-pend'); } catch (e) { /* sin almacenamiento */ }
    return { subcajas: subs, yaExistian: false };
  }
  async function listar(lim) { const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Contadores'), f.where('tipo', '==', 'bulto'), f.limit(lim || 2000))), l = []; sn.forEach(d => l.push(d.data())); return l.sort((a, b) => String(b.folio).localeCompare(String(a.folio))); }

  // ---------------- diálogo: crear o reimprimir etiquetas ----------------
  let insumos = null;
  async function cargarInsumos() { if (insumos) return insumos; const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(5000))), l = []; sn.forEach(d => l.push({ id: d.id, ...d.data() })); insumos = l; return l; }
  const lotesDe = (d) => (Array.isArray(d.batches) && d.batches.length ? d.batches : [{ batch: d.batch || 'S/L', quantity: d.quantity, expirationDate: d.expirationDate || '' }]).filter(b => num(b.quantity) > 0);

  function ventana(titulo, html, opc) {
    if (!(opc && opc.encima)) document.querySelectorAll('.bu-ov').forEach(x => x.remove());
    const ov = document.createElement('div'); ov.className = 'bu-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="bu-c"><div class="bu-cab"><h3>${esc(titulo)}</h3><button type="button" class="fp-x bu-x" aria-label="Cerrar">×</button></div><div class="bu-b">${html}</div></div>`;
    const cerrar = () => { ov.remove(); document.removeEventListener('keydown', tecla, true); if (ov._fin) ov._fin(); };
    const tecla = (e) => { if (e.key !== 'Escape') return; const v = document.querySelectorAll('.bu-ov'); if (v[v.length - 1] !== ov) return; e.stopPropagation(); cerrar(); };   /* con dos ventanas, Escape cierra solo la de arriba */
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.bu-x')) cerrar(); }); document.addEventListener('keydown', tecla, true);
    document.body.appendChild(ov); ov.cerrar = cerrar; return ov;
  }

  /** Diálogo para definir bultos internos y/o desglosar una caja completa (bajo demanda o al reimprimir). */
  function abrirDesglose(padre, alTerminar, opc) {
    const base = num(padre.inicial != null ? padre.inicial : padre.contenido);
    let cantSub = num(padre.subcajasEnEsta || padre.subcajasPorCaja) || 0;
    let uSub = num(padre.unidadesPorSubcaja) || 0;
    let modoImp = (opc && opc.incluirPadre) ? 'ambas' : 'solo_sub';   // 'solo_ext' | 'ambas' | 'solo_sub'
    if (!cantSub && !uSub && base > 1) { uSub = sugerirPorCaja(padre.nombre) || 0; if (uSub && uSub < base) cantSub = Math.ceil(base / uSub); }
    const ov = ventana(`División de bultos internos · ${padre.folio}`, '', { encima: true });
    const cuerpo = ov.querySelector('.bu-b');
    const pinta = () => {
      const partes = repartirSubcajas(base, cantSub, uSub);
      const detPartes = partes.length > 1 && partes[partes.length - 1] !== partes[0]
        ? `${partes.length - 1} × ${partes[0]} u. + 1 × ${partes[partes.length - 1]} u.`
        : `${partes.length} × ${partes[0] || 0} u. c/u`;
      const prevTxt = !partes.length
        ? 'Indica cuántos bultos internos trae esta caja o cuántas unidades contiene cada uno.'
        : modoImp === 'solo_ext'
          ? `Se imprimirá <b>1 etiqueta exterior (CAJA COMPLETA)</b> indicando <b>${base} u. en total</b> y <b>Adentro: ${partes.length} bultos (${detPartes})</b>.`
          : modoImp === 'ambas'
            ? `Se imprimirán <b>1 etiqueta exterior (CAJA COMPLETA) + ${partes.length} etiqueta${partes.length === 1 ? '' : 's'} de CAJA INDIVIDUAL</b> (${folioSubcaja(padre.folio, 1, partes.length)} a ${folioSubcaja(padre.folio, partes.length, partes.length)}): ${detPartes} · total ${base} u.`
            : `Se generarán <b>${partes.length} etiqueta${partes.length === 1 ? '' : 's'} de CAJA INDIVIDUAL</b> (${folioSubcaja(padre.folio, 1, partes.length)} a ${folioSubcaja(padre.folio, partes.length, partes.length)}): ${detPartes} · total ${base} u.`;
      const txtBtn = modoImp === 'solo_ext'
        ? 'Imprimir solo etiqueta exterior'
        : modoImp === 'ambas'
          ? 'Imprimir exterior + bultos internos'
          : 'Imprimir solo bultos internos';
      cuerpo.innerHTML = `<p class="si-v"><b>${esc(padre.nombre)}</b> · lote ${esc(padre.lote || 'S/L')} · <b>${base} u. en total</b> en esta caja.</p>
        <div class="bu-g3">
          <label class="bu-l">Bultos / cajas adentro<input id="bd-cant" type="number" min="1" max="200" class="si-in" inputmode="numeric" value="${cantSub || partes.length || ''}"></label>
          <label class="bu-l">Unidades por bulto interno<input id="bd-u" type="number" min="1" class="si-in" inputmode="numeric" value="${uSub || (partes[0] || '')}"></label>
          <label class="bu-l">¿Qué etiquetas imprimir?<select id="bd-modo" class="si-in">
            <option value="solo_ext"${modoImp === 'solo_ext' ? ' selected' : ''}>Solo etiqueta exterior (con detalle interno)</option>
            <option value="ambas"${modoImp === 'ambas' ? ' selected' : ''}>Exterior + etiquetas de bultos internos</option>
            <option value="solo_sub"${modoImp === 'solo_sub' ? ' selected' : ''}>Solo etiquetas de bultos internos</option>
          </select></label>
        </div>
        ${modoImp !== 'solo_ext' ? `<label class="bu-l">Estado de la caja exterior<select id="bd-est" class="si-in"><option value="1" selected>Marcar DESGLOSADA (recomendado: al contar suman solo los bultos internos)</option><option value="0">Mantener CERRADA (etiquetas listas para cuando se abra)</option></select></label>` : ''}
        <div class="bu-prev">${prevTxt}</div>
        <div class="fp-facc"><button type="button" class="btn btn-secondary" id="bd-x">Cancelar</button><button type="button" class="btn btn-primary" id="bd-ok"${partes.length ? '' : ' disabled'}><i class="ph-bold ph-printer"></i> ${txtBtn}</button></div>`;
      cuerpo.querySelector('#bd-x').onclick = () => ov.cerrar();
      cuerpo.querySelector('#bd-cant').onchange = (e) => { cantSub = Math.max(1, num(e.target.value)); uSub = base ? Math.ceil(base / cantSub) : 0; pinta(); };
      cuerpo.querySelector('#bd-u').onchange = (e) => { uSub = Math.max(1, num(e.target.value)); cantSub = base ? Math.ceil(base / uSub) : 0; pinta(); };
      cuerpo.querySelector('#bd-modo').onchange = (e) => { modoImp = e.target.value; pinta(); };
      cuerpo.querySelector('#bd-ok').onclick = async (e) => {
        e.target.disabled = true;
        try {
          if (modoImp === 'solo_ext') {
            const pAct = repartirSubcajas(base, cantSub, uSub);
            await guardar(padre, { nivel: 'master', subcajasPorCaja: cantSub || pAct.length, subcajasEnEsta: pAct.length, unidadesPorSubcaja: uSub || (pAct[0] || 0) }, 'ACTUALIZAR_BULTOS', { subcajas: pAct.length, unidadesPorSubcaja: uSub || (pAct[0] || 0) });
            await imprimir([padre], `caja-completa-${padre.folio}.pdf`);
            if (window.SAR_Progreso && window.SAR_Progreso.exito) window.SAR_Progreso.exito({ titulo: 'Etiqueta exterior lista', texto: `${padre.folio} · ${base} u. (${pAct.length} bultos internos)` });
            ov.cerrar(); if (alTerminar) alTerminar([padre]);
            return;
          }
          const marcarDesglosada = cuerpo.querySelector('#bd-est') && cuerpo.querySelector('#bd-est').value === '1';
          const r = await desglosar(padre, { subcajasPorCaja: cantSub, unidadesPorSubcaja: uSub, marcarDesglosada });
          const aImprimir = modoImp === 'ambas' ? [padre, ...r.subcajas] : r.subcajas;
          await imprimir(aImprimir, `subcajas-${padre.folio}.pdf`);
          if (window.SAR_Progreso && window.SAR_Progreso.exito) window.SAR_Progreso.exito({ titulo: `${aImprimir.length} etiqueta${aImprimir.length === 1 ? '' : 's'} lista${aImprimir.length === 1 ? '' : 's'}`, texto: `${aImprimir[0].folio} a ${aImprimir[aImprimir.length - 1].folio}` });
          ov.cerrar(); if (alTerminar) alTerminar(r.subcajas);
        } catch (er) { toast('No se pudo generar', er.message || String(er), 'error'); e.target.disabled = false; }
      };
    };
    pinta();
    return ov;
  }

  /** pref: {nombre, insumoId, codigoMP, bodega, lote, vence, total, proveedor, oc, rec, fechaRecepcion, lineas:[…mismos campos]} */
  async function etiquetar(pref) {
    const p = pref || {}, lineas = Array.isArray(p.lineas) && p.lineas.length ? p.lineas : null;
    const ov = ventana('Etiquetas de bulto', `<div class="bu-tabs"><button type="button" class="on" data-t="nueva">Nuevas etiquetas</button><button type="button" class="bu-tab-re" data-t="re">Reimprimir existentes</button></div><div class="bu-pane" data-p="nueva"></div><div class="bu-pane" data-p="re" hidden></div>`, { encima: !!p.encima });
    ov.querySelectorAll('.bu-tabs button').forEach(b => b.onclick = () => { ov.querySelectorAll('.bu-tabs button').forEach(x => x.classList.toggle('on', x === b)); ov.querySelectorAll('.bu-pane').forEach(x => { x.hidden = x.dataset.p !== b.dataset.t; }); if (b.dataset.t === 're') pintarReimprimir(ov.querySelector('[data-p="re"]')); });
    const pane = ov.querySelector('[data-p="nueva"]');
    let sel = lineas ? { ...lineas[0], idx: 0 } : { ...p };
    const pintar = () => {
      const sug = sugerirPorCaja(sel.nombre), porCaja = num(sel.porCaja) || sug || '', cajas = repartirCajas(sel.total, porCaja);
      const conSub = !!sel.conSubcajas;
      const subCant = num(sel.subcajasPorCaja) || 0, uSub = num(sel.unidadesPorSubcaja) || 0;
      const totSub = conSub ? cajas.reduce((s, q) => s + repartirSubcajas(q, subCant, uSub).length, 0) : 0;
      const genAhora = conSub && !!sel.generarSubcajasAhora;
      const listaValida = cajas.length > 0 && (!conSub || totSub > 0);
      pane.innerHTML = `${lineas ? `<label class="bu-l">Producto de esta recepción<select id="bu-lin" class="si-in">${lineas.map((l, i) => `<option value="${i}"${i === sel.idx ? ' selected' : ''}>${esc(l.nombre)} · ${num(l.total)} u.${l.lote ? ' · lote ' + esc(l.lote) : ''}${l.hecho ? ' ✔' : ''}</option>`).join('')}</select></label>`
          : `<label class="bu-l">Producto<input id="bu-q" class="si-in" placeholder="Busca por nombre…" value="${esc(sel.nombre || '')}" autocomplete="off"></label><div id="bu-sug" class="bu-sug"></div>`}
        <div class="bu-g3"><label class="bu-l">Lote<input id="bu-lote" class="si-in" value="${esc(sel.lote || '')}"></label><label class="bu-l">Vence<input id="bu-vence" type="date" class="si-in" value="${esc(sel.vence || '')}"></label><label class="bu-l">Bodega<input id="bu-bod" class="si-in" value="${esc(sel.bodega || '')}"></label></div>
        <div class="bu-g3"><label class="bu-l">Total de unidades<input id="bu-total" type="number" min="1" class="si-in" value="${num(sel.total) || ''}" inputmode="numeric"></label><label class="bu-l">${conSub ? 'Unidades por caja completa' : 'Unidades por caja'}<input id="bu-pc" type="number" min="1" class="si-in" value="${porCaja}" inputmode="numeric">${sug && !num(sel.porCaja) ? '<small>Sugerido por la descripción («caja x ' + sug + '»)</small>' : ''}</label><label class="bu-l">${conSub ? 'Cajas completas' : 'Cajas'}<input id="bu-cajas" type="number" min="1" class="si-in" value="${cajas.length || ''}" inputmode="numeric"><small>Si cambias las cajas, se recalculan las unidades.</small></label></div>
        <div class="bu-subbox">
          <label class="bu-chk"><input type="checkbox" id="bu-con-sub"${conSub ? ' checked' : ''}><span><b>Esta caja completa trae cajas individuales adentro</b> <small>(ej. 1 caja master con 10 cajitas de 100 u.)</small></span></label>
          ${conSub ? `<div class="bu-g3" style="margin-top:8px;">
            <label class="bu-l">Cajas individuales por caja completa<input id="bu-sub-n" type="number" min="1" max="200" class="si-in" inputmode="numeric" value="${subCant || ''}" placeholder="Ej: 10"></label>
            <label class="bu-l">Unidades por caja individual<input id="bu-sub-u" type="number" min="1" class="si-in" inputmode="numeric" value="${uSub || ''}" placeholder="Ej: 100"></label>
            <label class="bu-l">¿Qué etiquetas imprimir ahora?<select id="bu-sub-modo" class="si-in"><option value="0"${genAhora ? '' : ' selected'}>Solo caja(s) completa(s) ahora (desglosar al abrir)</option><option value="1"${genAhora ? ' selected' : ''}>Caja(s) completa(s) + cajas individuales ahora</option></select></label>
          </div>` : ''}
        </div>
        <div class="bu-g3"><label class="bu-l">Proveedor<input id="bu-prov" class="si-in" value="${esc(sel.proveedor || '')}"></label><label class="bu-l">Orden de compra<input id="bu-oc" class="si-in" value="${esc(sel.oc || '')}"></label><label class="bu-l">Fecha de recepción<input id="bu-fr" type="date" class="si-in" value="${esc(sel.fechaRecepcion || hoyISO())}"></label></div>
        ${sel.rec ? `<p class="si-v">Recepción ${esc(sel.rec)}</p>` : ''}
        <div class="bu-prev">${!cajas.length ? 'Indica el total y las unidades por caja.'
          : conSub
            ? (totSub ? (genAhora
                ? `<b>${cajas.length} etiqueta${cajas.length === 1 ? '' : 's'} de CAJA COMPLETA + ${totSub} etiqueta${totSub === 1 ? '' : 's'} de CAJA INDIVIDUAL</b> (total ${cajas.length + totSub} etiquetas · ${cajas.reduce((s, x) => s + x, 0)} u. reales, sin doble conteo).`
                : `<b>${cajas.length} etiqueta${cajas.length === 1 ? '' : 's'} de CAJA COMPLETA</b> (c/u con ${subCant || Math.round(totSub / cajas.length)} cajas individuales${uSub ? ' × ' + uSub + ' u.' : ''} · total ${cajas.reduce((s, x) => s + x, 0)} u.). Podrás generar las etiquetas individuales al abrir cada caja.`)
              : 'Indica cuántas cajas individuales trae cada caja completa (o cuántas unidades viene en cada una).')
            : `<b>${cajas.length} etiqueta${cajas.length === 1 ? '' : 's'}</b>: ${cajas.length > 1 && cajas[cajas.length - 1] !== cajas[0] ? `${cajas.length - 1} caja(s) de ${cajas[0]} u. y la última de ${cajas[cajas.length - 1]} u.` : `cajas de ${cajas[0]} u.`} · total ${cajas.reduce((s, x) => s + x, 0)} u.`}</div>
        <div class="fp-facc"><button type="button" class="btn btn-primary" id="bu-gen"${listaValida ? '' : ' disabled'}><i class="ph-bold ph-printer"></i> Generar e imprimir</button></div>`;
      const v = (id) => (pane.querySelector('#' + id) || {}).value;
      const leer2 = () => {
        sel.lote = v('bu-lote'); sel.vence = v('bu-vence'); sel.bodega = v('bu-bod');
        sel.total = num(v('bu-total')); sel.porCaja = num(v('bu-pc'));
        sel.proveedor = v('bu-prov'); sel.oc = v('bu-oc'); sel.fechaRecepcion = v('bu-fr');
        if (sel.conSubcajas) {
          sel.subcajasPorCaja = num(v('bu-sub-n'));
          sel.unidadesPorSubcaja = num(v('bu-sub-u'));
          sel.generarSubcajasAhora = v('bu-sub-modo') === '1';
        }
      };
      ['bu-total', 'bu-pc'].forEach(id => { const e = pane.querySelector('#' + id); if (e) e.onchange = () => { leer2(); if (sel.conSubcajas && sel.porCaja && sel.unidadesPorSubcaja) sel.subcajasPorCaja = Math.ceil(sel.porCaja / sel.unidadesPorSubcaja); pintar(); }; });
      const ec = pane.querySelector('#bu-cajas'); if (ec) ec.onchange = () => { leer2(); const n = Math.max(1, num(ec.value)); if (sel.total) sel.porCaja = Math.ceil(sel.total / n); pintar(); };
      const chkSub = pane.querySelector('#bu-con-sub');
      if (chkSub) chkSub.onchange = () => {
        leer2(); sel.conSubcajas = chkSub.checked;
        if (sel.conSubcajas && sel.porCaja && !sel.subcajasPorCaja && !sel.unidadesPorSubcaja) {
          const sU = sugerirPorCaja(sel.nombre);
          if (sU && sU < sel.porCaja) { sel.unidadesPorSubcaja = sU; sel.subcajasPorCaja = Math.ceil(sel.porCaja / sU); }
        }
        pintar();
      };
      const sn = pane.querySelector('#bu-sub-n');
      if (sn) sn.onchange = () => { leer2(); if (sel.subcajasPorCaja && sel.unidadesPorSubcaja && !sel.porCaja) sel.porCaja = sel.subcajasPorCaja * sel.unidadesPorSubcaja; else if (sel.subcajasPorCaja && sel.porCaja) sel.unidadesPorSubcaja = Math.ceil(sel.porCaja / sel.subcajasPorCaja); pintar(); };
      const su = pane.querySelector('#bu-sub-u');
      if (su) su.onchange = () => { leer2(); if (sel.subcajasPorCaja && sel.unidadesPorSubcaja) { if (!sel.porCaja || sel.porCaja === num(porCaja)) sel.porCaja = sel.subcajasPorCaja * sel.unidadesPorSubcaja; else sel.subcajasPorCaja = Math.ceil(sel.porCaja / sel.unidadesPorSubcaja); } else if (sel.unidadesPorSubcaja && sel.porCaja) { sel.subcajasPorCaja = Math.ceil(sel.porCaja / sel.unidadesPorSubcaja); } pintar(); };
      const sm = pane.querySelector('#bu-sub-modo'); if (sm) sm.onchange = () => { leer2(); pintar(); };
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
          const l = await crear(sel); await imprimir(l);
          if (lineas) { lineas[sel.idx].hecho = true; const sig = lineas.findIndex(x => !x.hecho); if (sig >= 0) { sel = { ...lineas[sig], idx: sig }; } }
          if (window.SAR_Progreso && window.SAR_Progreso.exito) window.SAR_Progreso.exito({ titulo: `${l.length} etiqueta${l.length === 1 ? '' : 's'} lista${l.length === 1 ? '' : 's'}`, texto: esc(l[0].folio) + (l.length > 1 ? ' a ' + esc(l[l.length - 1].folio) : '') });
          pintar();
        } catch (er) { toast('No se generaron', er.message || String(er), 'error'); e.target.disabled = false; }
      };
    };
    pintar();
    return ov;
  }
  async function pintarReimprimir(el) {
    el.innerHTML = '<p class="si-v">Cargando bultos…</p>';
    let todos = [];
    const recargar = async () => { todos = await listar(); };
    try { await recargar(); } catch (e) { el.innerHTML = '<p class="si-v">No pude leer los bultos.</p>'; return; }
    let q = '', filtroNivel = ''; const marcados = new Set();
    const pinta = () => {
      const t = norm(q), l = todos.filter(b => (!filtroNivel || (filtroNivel === 'sub' ? esSubcaja(b) : !esSubcaja(b))) && (!t || norm(b.folio + ' ' + (b.padreFolio || '') + ' ' + b.nombre + ' ' + b.lote + ' ' + b.oc).includes(t))).slice(0, 150);
      const selLista = todos.filter(b => marcados.has(b.folio));
      const unicaMaster = selLista.length === 1 && !esSubcaja(selLista[0]) ? selLista[0] : null;
      el.innerHTML = `<input class="si-in" id="bu-rq" placeholder="Folio, producto, lote u OC…" value="${esc(q)}">
        <div class="bu-chips" style="margin:4px 0;"><button type="button" class="bu-chip${filtroNivel === '' ? ' on' : ''}" data-nv="">Todas</button><button type="button" class="bu-chip${filtroNivel === 'master' ? ' on' : ''}" data-nv="master">Cajas completas</button><button type="button" class="bu-chip${filtroNivel === 'sub' ? ' on' : ''}" data-nv="sub">Cajas individuales</button></div>
        <div class="bu-lista">${l.map(b => { const sub = esSubcaja(b); return `<label class="bu-fila${sub ? ' bu-fila--sub' : ''}"><input type="checkbox" data-f="${esc(b.folio)}"${marcados.has(b.folio) ? ' checked' : ''}><span><b>${esc(b.folio)}</b> ${esMaster(b) ? '<span class="bu-nv bu-nv-m">Caja completa</span>' : sub ? '<span class="bu-nv bu-nv-s">Individual ' + num(b.subN || b.n) + '/' + num(b.subDe || b.de) + '</span>' : '· bulto ' + b.n + '/' + b.de} · ${esc(b.nombre)}<small>lote ${esc(b.lote)} · ${b.contenido} u. · ${esc(b.estado)}${b.bodega ? ' · ' + esc(b.bodega) : ''}</small></span>${!sub ? (b.subcajasCreadas ? `<button type="button" class="btn btn-secondary btn-sm bu-desg" data-subre="${esc(b.folio)}" title="Reimprimir solo sus cajas individuales"><i class="ph-bold ph-printer"></i> Individuales</button>` : `<button type="button" class="btn btn-secondary btn-sm bu-desg" data-desg="${esc(b.folio)}" title="Desglosar en cajas individuales y/o reimprimir con la caja completa"><i class="ph-bold ph-squares-four"></i> Desglosar</button>`) : ''}</label>`; }).join('') || '<p class="si-v">Sin bultos.</p>'}</div>
        <div class="fp-facc">${unicaMaster ? `<button type="button" class="btn btn-secondary" id="bu-rp-desg"><i class="ph-bold ph-squares-four"></i> ${unicaMaster.subcajasCreadas ? 'Reimprimir caja + individuales' : 'Reimprimir y desglosar en individuales'}</button>` : ''}<button type="button" class="btn btn-primary" id="bu-rp"${marcados.size ? '' : ' disabled'}><i class="ph-bold ph-printer"></i> Reimprimir ${marcados.size || ''}</button></div>`;
      const i = el.querySelector('#bu-rq'); i.oninput = () => { q = i.value; const p0 = i.selectionStart; pinta(); const j = el.querySelector('#bu-rq'); j.focus(); j.setSelectionRange(p0, p0); };
      el.querySelectorAll('[data-nv]').forEach(btn => btn.onclick = () => { filtroNivel = btn.dataset.nv; pinta(); });
      el.querySelectorAll('[data-f]').forEach(c => c.onchange = () => { if (c.checked) marcados.add(c.dataset.f); else marcados.delete(c.dataset.f); pinta(); });
      el.querySelectorAll('[data-desg]').forEach(btn => btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const pad = todos.find(x => x.folio === btn.dataset.desg); if (pad) abrirDesglose(pad, async () => { try { await recargar(); } catch (_) {} pinta(); }, { incluirPadre: true }); });
      el.querySelectorAll('[data-subre]').forEach(btn => btn.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); btn.disabled = true; try { const subs = await subcajasDe(btn.dataset.subre); if (!subs.length) { const pad = todos.find(x => x.folio === btn.dataset.subre); if (pad) abrirDesglose(pad, async () => { try { await recargar(); } catch (_) {} pinta(); }, { incluirPadre: true }); return; } await imprimir(subs, `subcajas-${btn.dataset.subre}.pdf`); } catch (er) { toast('No se pudo', er.message, 'error'); } finally { btn.disabled = false; } });
      const bDesgSel = el.querySelector('#bu-rp-desg');
      if (bDesgSel && unicaMaster) bDesgSel.onclick = async () => {
        if (unicaMaster.subcajasCreadas) {
          bDesgSel.disabled = true;
          try { const subs = await subcajasDe(unicaMaster.folio); await imprimir([unicaMaster, ...subs], `caja-y-subcajas-${unicaMaster.folio}.pdf`); }
          catch (er) { toast('No se pudo', er.message, 'error'); } finally { bDesgSel.disabled = false; }
        } else {
          abrirDesglose(unicaMaster, async () => { try { await recargar(); } catch (_) {} pinta(); }, { incluirPadre: true });
        }
      };
      el.querySelector('#bu-rp').onclick = async () => { try { await imprimir(todos.filter(b => marcados.has(b.folio)).sort((a, b) => a.folio.localeCompare(b.folio))); } catch (e) { toast('No se pudo', e.message, 'error'); } };
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
    const sub = esSubcaja(b), mast = esMaster(b);
    const estTxt = b.estado === 'CERRADA' ? 'Cerrada' : b.estado === 'ABIERTA' ? 'Abierta' : b.estado === 'DESGLOSADA' ? 'Desglosada' : 'Vacía';
    const nivelBadge = mast ? '<span class="bu-nv bu-nv-m">Caja completa</span>' : sub ? '<span class="bu-nv bu-nv-s">Caja individual</span>' : '';
    const subInfo = mast && num(b.subcajasEnEsta || b.subcajasPorCaja) > 0
      ? ` · ${num(b.subcajasEnEsta || b.subcajasPorCaja)} caja(s) individual(es)${num(b.unidadesPorSubcaja) ? ' × ' + num(b.unidadesPorSubcaja) + ' u.' : ''}`
      : (sub && b.padreFolio ? ` · de caja completa ${esc(b.padreFolio)}` : '');
    return `<div class="bu-card"><div class="bu-card-h"><span><b>${esc(b.folio)}</b> ${nivelBadge}</span><span class="bu-est bu-est-${esc(b.estado)}">${esc(estTxt)}</span></div>
      <p class="bu-n">${esc(b.nombre)}</p><p class="si-v">${sub ? `Caja individual ${num(b.subN || b.n)} de ${num(b.subDe || b.de)}` : `Bulto ${b.n} de ${b.de}`}${subInfo} · lote ${esc(b.lote)}${b.vence ? ' · vence ' + esc(fechaCL(b.vence)) : ''}</p>
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
          const puedeDesglosar = !esSubcaja(b) && b.estado !== 'VACIA';
          res.innerHTML = fichaBulto(b) + `<div class="fp-facc">${b.estado === 'CERRADA' ? '<button type="button" class="btn btn-primary" data-a="abrir">Abrir caja</button>' : ''}${b.estado === 'ABIERTA' ? '<button type="button" class="btn btn-primary" data-a="queda">¿Cuánto queda?</button>' : ''}${puedeDesglosar ? (b.subcajasCreadas ? '<button type="button" class="btn btn-primary" data-a="subre"><i class="ph-bold ph-printer"></i> Reimprimir cajas individuales</button>' : '<button type="button" class="btn btn-primary" data-a="desglosar"><i class="ph-bold ph-squares-four"></i> Desglosar en cajas individuales</button>') : ''}${b.estado !== 'VACIA' && b.estado !== 'DESGLOSADA' ? '<button type="button" class="btn btn-secondary" data-a="vacia">Marcar vacía</button>' : '<button type="button" class="btn btn-secondary" data-a="cerrar">Volver a cerrada (llena)</button>'}<button type="button" class="btn btn-secondary" data-a="re">Reimprimir etiqueta</button></div>`;
          res.querySelectorAll('[data-a]').forEach(x => x.onclick = async () => {
            const a = x.dataset.a;
            if (a === 'abrir' || a === 'queda') pedirQueda(b, () => { ultimo = ''; procesar(folio); });
            else if (a === 'desglosar') abrirDesglose(b, () => { ultimo = ''; procesar(folio); });
            else if (a === 'subre') { try { const subs = await subcajasDe(b.folio); if (!subs.length) return abrirDesglose(b, () => { ultimo = ''; procesar(folio); }); await imprimir(subs, `subcajas-${b.folio}.pdf`); } catch (e) { toast('No se pudo', e.message, 'error'); } }
            else if (a === 'vacia') { await guardar(b, { contenido: 0, estado: 'VACIA' }, 'VACIA'); ultimo = ''; procesar(folio); }
            else if (a === 'cerrar') { await guardar(b, { contenido: b.inicial || b.porCaja, estado: 'CERRADA' }, 'CERRADA'); ultimo = ''; procesar(folio); }
            else if (a === 're') imprimir([b]).catch(e => toast('No se pudo', e.message, 'error'));
          });
          return;
        }
        if (vistos.has(folio)) { res.innerHTML = `<p class="si-v">${esc(folio)} ya estaba contado: no se suma dos veces.</p>`; return; }
        const conf = conflictoJerarquia(leidos, b);
        if (conf.bloqueo) { res.innerHTML = fichaBulto(b) + `<p class="cfg-mal">${esc(conf.motivo)}</p>`; return; }
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
    /* Solo cuentan cajas principales (!esSubcaja) para no duplicar las unidades de una caja completa y sus subcajas */
    (bultos || []).filter(b => !esSubcaja(b)).forEach(b => { const key = k(b.nombreOrig || b.nombre, b.loteOrig || b.lote); et.set(key, (et.get(key) || 0) + num(b.inicial != null ? b.inicial : b.contenido)); });
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
  async function marcarImpresas(lista) {
    const ahora = new Date().toISOString();
    const r = await Promise.all((lista || []).map(b => guardar(b, (x) => ({ impresiones: num(x.impresiones) + 1, ultimaImpresion: ahora, primeraImpresion: x.primeraImpresion || ahora, editadoTrasImprimir: false }), num(b.impresiones) >= 1 ? 'REIMPRESO' : 'IMPRESO').then(() => true, () => false)));
    try { sessionStorage.removeItem('etq-pend'); } catch (e) { /* sin almacenamiento */ }
    const mal = r.filter(x => !x).length; if (mal) toast('Impresión no registrada', `${mal} etiqueta(s) se imprimieron pero no se pudo anotar la impresión (revisa la conexión o tu sesión).`, 'warning');
  }
  async function imprimir(lista, nombre) { if (!lista || !lista.length) return null; const r = await pdf(lista, nombre); await marcarImpresas(lista); return r; }

  // ---------------- etiquetas por orden de compra (v21.223) ----------------
  async function leerOCs() { const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Seguimiento_OC'), f.limit(1500))), l = []; sn.forEach(d => l.push({ id: d.id, ...d.data() })); return l; }
  const SIN_OC = '(sin orden de compra)', DESDE_ETQ = '2026-11-14';   /* las etiquetas por caja existen desde v21.205: lo recibido antes no cuenta como «falta etiquetar» */
  /** v21.232: foto del producto (catálogo / Mercado Público), igual que en Existencias */
  const foto = (nombre, codigo) => window.SAR_Imagenes && window.SAR_Imagenes.thumb ? window.SAR_Imagenes.thumb(nombre || '', { codigo: codigo || '' }) : '';
  const rellenarFotos = (el) => { const I = window.SAR_Imagenes; if (!I || !I.cargar) return; I.cargar().then(() => I.rellenar(el)).catch(() => {}); };
  async function porOC(opc) {
    /* opc.en: se dibuja en una página (menú «Impresión de etiquetas») en vez de una ventana */
    const en = opc && opc.en;
    if (en) en.innerHTML = `<div class="si-wrap si-ancho"><div class="si-cab"><div><h2 class="si-t">Impresión de etiquetas</h2><p class="si-s">Las etiquetas de bulto de cada orden de compra: imprime las que quedaron pendientes al recibir, reimprime o corrige datos.</p></div></div><div class="bu-b etq-pag"><p class="si-v">Cargando órdenes y etiquetas…</p></div></div>`;
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
        g.forEach((bs, k) => {
          const principales = bs.filter(b => !esSubcaja(b));
          const uBase = (principales.length ? principales : bs).reduce((t, b) => t + num(b.inicial != null ? b.inicial : b.contenido), 0);
          l.push({ x, k, cod: bs[0].codigoMP || '', nombre: bs[0].nombre, lote: bs[0].lote || 'S/L', vence: bs[0].vence || '', cajas: principales.length || bs.length, subcajas: bs.filter(esSubcaja).length, u: uBase, est: estadoOC(bs, 0), txt: norm(bs.map(b => b.nombre + ' ' + (b.nombreOrig || '') + ' ' + b.folio + ' ' + b.lote).join(' ') + ' ' + x.num + ' ' + x.prov) });
        });
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
        const soloMasters = bs.filter(b => !esSubcaja(b)), soloSubs = bs.filter(esSubcaja);
        /* v21.234: recibido cuenta solo cajas principales (!esSubcaja) para no duplicar caja completa + cajas individuales */
        const recibido = soloMasters.reduce((t, b) => t + num(b.inicial != null ? b.inicial : b.contenido), 0) + ft;
        const corto = (t) => { const c = String(t || '').split(/\s+-\s+|\.\s+-/)[0].trim(); return c.length > 90 ? c.slice(0, 88) + '…' : c; };
        const recs = [...new Set((x.oc.recepciones || []).filter(r => r && !r.anulada && r.ingresoAStock).map(r => r.recId).filter(Boolean))];
        const ordenarGrupo = (g) => {
          const pads = g.filter(b => !esSubcaja(b)), hijasPorPadre = new Map();
          g.filter(esSubcaja).forEach(s => { const k = s.padreFolio || ''; if (!hijasPorPadre.has(k)) hijasPorPadre.set(k, []); hijasPorPadre.get(k).push(s); });
          const out = [];
          pads.forEach(p => { out.push(p); (hijasPorPadre.get(p.folio) || []).sort((a, b) => num(a.subN || a.n) - num(b.subN || b.n)).forEach(s => out.push(s)); hijasPorPadre.delete(p.folio); });
          hijasPorPadre.forEach(list => list.forEach(s => out.push(s)));
          return out;
        };
        caja.innerHTML = `<div class="bu-det-top"><button type="button" class="bu-volver" id="bu-vol"><i class="ph-bold ph-arrow-left"></i> Órdenes</button></div>
          <section class="bu-det-cab">
            <div class="bu-det-tit"><div><span class="bu-det-k">${x.num === SIN_OC ? 'Etiquetas' : 'Orden de compra'}</span><h4>${esc(x.num === SIN_OC ? 'Sin orden de compra' : x.num)}</h4><p>${esc(x.prov || '—')}${x.fecha ? ' · recibida ' + esc(fechaCL(String(x.fecha).slice(0, 10))) : ''}${recs.length ? ' · ' + esc(recs.join(', ')) : ''}</p></div><span class="bu-imp bu-imp-${x.est.k}">${esc(x.est.t)}</span></div>
            <div class="bu-det-cifras"><div><b>${recibido}</b><small>unidades recibidas</small></div><div><b>${bs.length}</b><small>etiqueta${bs.length === 1 ? '' : 's'} (${soloMasters.length} caja${soloMasters.length === 1 ? '' : 's'}${soloSubs.length ? ' + ' + soloSubs.length + ' indiv.' : ''})</small></div><div class="${pend.length ? 'bu-c-warn' : ''}"><b>${pend.length}</b><small>por imprimir</small></div><div class="${ft ? 'bu-c-warn' : ''}"><b>${ft}</b><small>u. sin etiqueta</small></div></div>
          </section>
          ${ft ? `<section class="bu-falta2"><header><div><h5><i class="ph-bold ph-tag"></i> Falta etiquetar ${ft} u.</h5><small>Productos recibidos que aún no tienen etiqueta de bulto.</small></div><button type="button" class="btn btn-primary btn-sm" id="bu-crea"><i class="ph-bold ph-plus"></i> Crear las que faltan</button></header>
            <ul>${x.faltan.map(f => `<li title="${esc(f.nombre)}">${foto(f.nombre, f.codigoMP)}<span class="bu-f-n">${esc(corto(f.nombre))}</span><span class="bu-f-m">${f.lote && f.lote !== 'S/L' ? 'lote ' + esc(f.lote) : 'sin lote'}${f.vence ? ' · vence ' + esc(fechaCL(f.vence)) : ''}</span><span class="bu-f-q">${f.total} u.</span></li>`).join('')}</ul></section>` : ''}
          <div class="fp-facc bu-ocacc"${bs.length ? '' : ' style="display:none"'}><button type="button" class="btn btn-primary" id="bu-pend"${pend.length ? '' : ' disabled'}><i class="ph-bold ph-printer"></i> Imprimir pendientes${pend.length ? ' (' + pend.length + ')' : ''}</button><button type="button" class="btn btn-secondary" id="bu-sel"${marcados.size ? '' : ' disabled'}><i class="ph-bold ph-arrows-clockwise"></i> Reimprimir seleccionadas${marcados.size ? ' (' + marcados.size + ')' : ''}</button><button type="button" class="btn btn-secondary btn-sm" id="bu-todas">${marcados.size === bs.length && bs.length ? 'Quitar selección' : 'Seleccionar todas'}</button>${soloSubs.length ? `<button type="button" class="btn btn-secondary btn-sm" id="bu-sel-m">Solo cajas completas (${soloMasters.length})</button><button type="button" class="btn btn-secondary btn-sm" id="bu-sel-s">Solo individuales (${soloSubs.length})</button>` : ''}</div>
          ${[...grupos.values()].map(g0 => { const g = ordenarGrupo(g0), gP = g.filter(b => !esSubcaja(b)), gS = g.filter(esSubcaja), a = gP[0] || g[0]; const uGrp = (gP.length ? gP : g).reduce((t, b) => t + num(b.inicial != null ? b.inicial : b.contenido), 0); return `<div class="bu-grp${foco && (a.grupo || a.folio) === foco ? ' bu-grp--foco' : ''}" data-grp="${esc(a.grupo || a.folio)}"><div class="bu-grp-h">${foto(a.nombre, a.codigoMP)}<span class="bu-grp-t"><b>${esc(a.nombre)}</b><small>lote ${esc(a.lote || 'S/L')}${a.vence ? ' · vence ' + esc(fechaCL(a.vence)) : ''} · ${gP.length || g.length} caja${(gP.length || g.length) === 1 ? '' : 's'}${gS.length ? ` · ${gS.length} indiv.` : ''} · ${uGrp} u.${a.rec ? ' · ' + esc(a.rec) : ''}</small></span><button type="button" class="btn btn-secondary btn-sm" data-eg="${esc(a.grupo || a.folio)}"><i class="ph-bold ph-pencil-simple"></i> Editar datos</button></div>
            ${g.map(b => { const sub = esSubcaja(b), mast = esMaster(b); return `<label class="bu-fila bu-et${sub ? ' bu-fila--sub' : ''}"><input type="checkbox" data-f="${esc(b.folio)}"${marcados.has(b.folio) ? ' checked' : ''}><span><b>${esc(b.folio)}</b> ${mast ? '<span class="bu-nv bu-nv-m">Caja completa</span>' : sub ? `<span class="bu-nv bu-nv-s">Individual ${num(b.subN || b.n)}/${num(b.subDe || b.de)}</span>` : `· bulto ${num(b.n)}/${num(b.de)}`} · ${num(b.contenido)} u.${b.estado === 'DESGLOSADA' ? ' · <i>Desglosada</i>' : ''}<small>${b.ultimaImpresion ? 'Última impresión ' + esc(fechaCL(b.ultimaImpresion.slice(0, 10))) + ' ' + esc(new Date(b.ultimaImpresion).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })) : ''}</small></span>${!sub ? (b.subcajasCreadas ? `<button type="button" class="btn btn-secondary btn-sm bu-desg" data-subre="${esc(b.folio)}" title="Reimprimir solo las cajas individuales de esta caja"><i class="ph-bold ph-printer"></i> Reimp. indiv.</button>` : `<button type="button" class="btn btn-secondary btn-sm bu-desg" data-desg="${esc(b.folio)}" title="Desglosar en cajas individuales (con opción de reimprimir también la caja completa)"><i class="ph-bold ph-squares-four"></i> Individuales</button>`) : ''}<span class="bu-imp bu-imp-${estadoImp(b)}">${esc(textoImp(b))}</span><button type="button" class="bu-ed" data-eb="${esc(b.folio)}" aria-label="Editar etiqueta ${esc(b.folio)}"><i class="ph-bold ph-pencil-simple"></i></button></label>`; }).join('')}</div>`; }).join('') || `<div class="bu-vacio"><i class="ph-bold ph-tag-simple"></i><b>Esta orden aún no tiene etiquetas</b><small>${ft ? 'Usa «Crear las que faltan»: indicas cuántas cajas son y se imprimen.' : 'No hay productos recibidos por etiquetar.'}</small></div>`}`;
        caja.querySelector('#bu-vol').onclick = lista;
        rellenarFotos(caja);
        caja.querySelectorAll('[data-f]').forEach(c => c.onchange = () => { if (c.checked) marcados.add(c.dataset.f); else marcados.delete(c.dataset.f); pinta(); });
        caja.querySelector('#bu-todas').onclick = () => { if (marcados.size === bs.length) marcados.clear(); else bs.forEach(b => marcados.add(b.folio)); pinta(); };
        const bm = caja.querySelector('#bu-sel-m'); if (bm) bm.onclick = () => { marcados.clear(); soloMasters.forEach(b => marcados.add(b.folio)); pinta(); };
        const bsBtn = caja.querySelector('#bu-sel-s'); if (bsBtn) bsBtn.onclick = () => { marcados.clear(); soloSubs.forEach(b => marcados.add(b.folio)); pinta(); };
        const correr = async (btn, l, txt) => { btn.disabled = true; const prog = window.SAR_Progreso ? window.SAR_Progreso.iniciar(txt, ['Armando el PDF de etiquetas…']) : null;
          try { await pdf(l); if (prog) prog.paso('Registrando la impresión…'); await marcarImpresas(l); if (prog) prog.listo(`${l.length} etiqueta${l.length === 1 ? '' : 's'} para imprimir`); marcados.clear(); pinta(); }
          catch (e) { if (prog) prog.error(); toast('No se pudo', e.message || String(e), 'error'); btn.disabled = false; } };
        caja.querySelector('#bu-pend').onclick = (e) => correr(e.currentTarget, pend, 'Imprimiendo etiquetas pendientes…');
        caja.querySelector('#bu-sel').onclick = (e) => correr(e.currentTarget, bs.filter(b => marcados.has(b.folio)), 'Reimprimiendo etiquetas…');
        caja.querySelectorAll('[data-eg]').forEach(b => b.onclick = () => editar(bs.filter(y => (y.grupo || y.folio) === b.dataset.eg), false, pinta));
        caja.querySelectorAll('[data-eb]').forEach(b => b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const un = bs.find(y => y.folio === b.dataset.eb); editar(bs.filter(y => (y.grupo || y.folio) === (un.grupo || un.folio)), un, pinta); });
        caja.querySelectorAll('[data-desg]').forEach(b => b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const pad = bs.find(y => y.folio === b.dataset.desg); if (pad) abrirDesglose(pad, async () => { try { bultos = await listar(5000); } catch (_) {} pinta(); }, { incluirPadre: false }); });
        caja.querySelectorAll('[data-subre]').forEach(b => b.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); const subs = bs.filter(y => y.padreFolio === b.dataset.subre).sort((a, z) => num(a.subN || a.n) - num(z.subN || z.n)); if (subs.length) correr(e.currentTarget, subs, 'Reimprimiendo cajas individuales…'); else { const pad = bs.find(y => y.folio === b.dataset.subre); if (pad) abrirDesglose(pad, async () => { try { bultos = await listar(5000); } catch (_) {} pinta(); }); } });
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
    const a = uno || grupo[0], unaSola = !!uno, puedeCant = unaSola && a.estado === 'CERRADA';
    const ov = ventana(unaSola ? `Editar etiqueta ${a.folio}` : `Editar ${grupo.length} etiqueta${grupo.length === 1 ? '' : 's'}`, `
      <p class="si-v">Cambia solo lo que dice la etiqueta, no el stock. ${unaSola ? '' : 'Se aplica a todas las cajas de este producto y lote. '}Después queda marcada «Editada · reimprimir».</p>
      <label class="bu-l">Producto (como sale en la etiqueta)<input id="be-nom" class="si-in" value="${esc(a.nombre || '')}"></label>
      <div class="bu-g3"><label class="bu-l">Lote<input id="be-lote" class="si-in" value="${esc(a.lote || '')}"></label><label class="bu-l">Vence<input id="be-vence" type="date" class="si-in" value="${esc(a.vence || '')}"></label><label class="bu-l">Bodega<input id="be-bod" class="si-in" value="${esc(a.bodega || '')}"></label></div>
      <div class="bu-g3"><label class="bu-l">Proveedor<input id="be-prov" class="si-in" value="${esc(a.proveedor || '')}"></label><label class="bu-l">Fecha de recepción<input id="be-fr" type="date" class="si-in" value="${esc(a.fechaRecepcion || '')}"></label>${puedeCant ? `<label class="bu-l">Unidades en esta caja<input id="be-cant" type="number" min="1" class="si-in" inputmode="numeric" value="${num(a.contenido)}"></label>` : ''}</div>
      ${unaSola && !puedeCant ? '<p class="si-v">La caja ya está abierta: su cantidad se cambia al escanearla.</p>' : ''}
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
        if (cant != null && !esSubcaja(a) && conCambios.some(([, c]) => c.contenido != null)) {   // el total del lote y las unidades por caja salen en todas las etiquetas del grupo (solo cajas principales)
          const mains = grupo.filter(b => !esSubcaja(b));
          const tot = mains.reduce((t, b) => t + num(b.inicial != null ? b.inicial : b.contenido), 0), pc = Math.max(...mains.map(b => num(b.inicial != null ? b.inicial : b.contenido)));
          await Promise.all(mains.filter(b => num(b.totalGrupo) !== tot || num(b.porCaja) !== pc).map(b => guardar(b, { totalGrupo: tot, porCaja: pc, editadoTrasImprimir: estadoImp(b) !== 'sin' }, 'EDITADO', { campos: ['totalGrupo'] })));
        }
        if (prog) prog.listo('Etiqueta corregida · queda para reimprimir'); ov.cerrar(); if (alGuardar) alGuardar();
      } catch (er) { if (prog) prog.error(); toast('No se guardó', er.message || String(er), 'error'); e.target.disabled = false; }
    };
    return ov;
  }

  async function abrir() {
    const r = document.getElementById('bu-root'); if (!r) return;
    r.innerHTML = `<div class="si-wrap si-ancho"><div class="si-cab"><div><h2 class="si-t">Bultos y etiquetas</h2><p class="si-s">Cada caja con su etiqueta: producto, lote, vencimiento, cuántas unidades trae y «bulto 3 de 10». Se lee con el teléfono (QR) o con pistola (código de barras).</p></div></div>
      <div class="bu-acc"><button type="button" class="bu-big" data-x="oc"><i class="ph-bold ph-clipboard-text"></i><b>Etiquetas por orden de compra</b><small>Estado de impresión, reimprimir o corregir datos</small></button><button type="button" class="bu-big" data-x="nueva"><i class="ph-bold ph-tag"></i><b>Crear etiquetas</b><small>Para un producto y lote (o reimprimir)</small></button><button type="button" class="bu-big" data-x="ver"><i class="ph-bold ph-scan"></i><b>Escanear bulto</b><small>Ver qué tiene, abrir la caja, cuánto queda</small></button><button type="button" class="bu-big" data-x="contar"><i class="ph-bold ph-barcode"></i><b>Contar por bultos</b><small>Pistolea las cajas: las cerradas suman solas</small></button></div>
      <h3 class="si-h">Bultos registrados</h3><div id="bu-tab"><p class="si-v">Cargando…</p></div></div>`;
    r.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { const x = b.dataset.x; if (x === 'oc') porOC().then(ov => { if (ov) { const o = ov._fin; ov._fin = () => { if (o) o(); abrir(); }; } }); else if (x === 'nueva') etiquetar({}); else escanear(x === 'contar' ? 'conteo' : 'ver').then(ov => { if (ov) { const o = ov._fin; ov._fin = () => { o(); abrir(); }; } }); });
    try {
      const l = await listar(), t = r.querySelector('#bu-tab'), est = (e) => l.filter(b => b.estado === e).length;
      t.innerHTML = l.length ? `<p class="si-v">${l.length} etiqueta(s): ${est('CERRADA')} cerradas · ${est('ABIERTA')} abiertas · ${est('DESGLOSADA')} desglosadas · ${est('VACIA')} vacías.</p><div class="fp-tw"><table class="si-tb"><thead><tr><th>Folio</th><th>Tipo</th><th>Producto</th><th>Lote</th><th>N°</th><th>Contenido</th><th>Estado</th><th>Etiqueta</th><th>Bodega</th><th>Acciones</th></tr></thead><tbody>${l.slice(0, 300).map(b => `<tr><td>${esc(b.folio)}</td><td>${esMaster(b) ? '<span class="bu-nv bu-nv-m">Completa</span>' : esSubcaja(b) ? '<span class="bu-nv bu-nv-s">Individual</span>' : 'Bulto'}</td><td>${esc(b.nombre)}</td><td>${esc(b.lote)}</td><td>${esSubcaja(b) ? `${num(b.subN || b.n)}/${num(b.subDe || b.de)}` : `${b.n}/${b.de}`}</td><td>${b.contenido}/${b.inicial || b.porCaja}</td><td><span class="bu-est bu-est-${esc(b.estado)}">${esc(b.estado)}</span></td><td><span class="bu-imp bu-imp-${estadoImp(b)}">${esc(textoImp(b))}</span></td><td>${esc(b.bodega)}</td><td style="white-space:nowrap;display:flex;gap:4px;"><button type="button" class="btn btn-secondary btn-sm bu-desg" data-tre="${esc(b.folio)}" title="Reimprimir etiqueta"><i class="ph-bold ph-printer"></i></button>${!esSubcaja(b) ? (b.subcajasCreadas ? `<button type="button" class="btn btn-secondary btn-sm bu-desg" data-tsub="${esc(b.folio)}" title="Reimprimir cajas individuales">Indiv.</button>` : `<button type="button" class="btn btn-secondary btn-sm bu-desg" data-tdesg="${esc(b.folio)}" title="Desglosar en cajas individuales">Desglosar</button>`) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="si-v">Aún no hay bultos etiquetados.</p>';
      t.querySelectorAll('[data-tre]').forEach(btn => btn.onclick = async () => { const b = l.find(x => x.folio === btn.dataset.tre); if (b) try { await imprimir([b]); abrir(); } catch (e) { toast('No se pudo', e.message, 'error'); } });
      t.querySelectorAll('[data-tdesg]').forEach(btn => btn.onclick = () => { const b = l.find(x => x.folio === btn.dataset.tdesg); if (b) abrirDesglose(b, () => abrir(), { incluirPadre: true }); });
      t.querySelectorAll('[data-tsub]').forEach(btn => btn.onclick = async () => { try { const subs = await subcajasDe(btn.dataset.tsub); if (subs.length) { await imprimir(subs, `subcajas-${btn.dataset.tsub}.pdf`); abrir(); } else { const b = l.find(x => x.folio === btn.dataset.tsub); if (b) abrirDesglose(b, () => abrir(), { incluirPadre: true }); } } catch (e) { toast('No se pudo', e.message, 'error'); } });
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

  window.SAR_Bultos = { porOC, abrirEtiquetas, editar, imprimir, marcarImpresas, estadoImp, estadoOC, faltantesOC, desdeRecepcion, repartirEnCajas, repartirSubcajas, armarSubcajas, desglosar, abrirDesglose, subcajasDe, esSubcaja, esMaster, folioSubcaja, conflictoJerarquia, cargarQR, matrizQR, abrir, etiquetar, escanear, ofrecerRecepcion, pdf, crear, listar, sugerirPorCaja, repartirCajas, folioDe, digitos, resumirConteo };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SAR_Bultos;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: null, addEventListener() {} });
