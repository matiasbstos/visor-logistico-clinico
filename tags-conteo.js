/* ==========================================================================
   TAGS DE CONTEO «CONTADO» (v21.249) — DECISIONES 4.305 · Inventario → Tags de conteo (admin y superadmin)
   · Reservar e imprimir N tags preimpresos (PDF 100×60 para la Zebra ZD230, un tag por página).
     El folio es un BUL reservado con la misma lógica que las etiquetas de caja (SAR_Bultos.reservarFolios:
     tramo por equipo y navigator.locks sin internet); será el folio de la etiqueta definitiva de la caja grande.
     Cada tag deja Contadores/bulto-<folio> con tipo 'tag-conteo' y estado 'TAG' (aún no es una caja: no tiene contenido).
   · Tabla de todos los tags: une Contadores (tags) con Conteos_Cajas (lo que contó el teléfono).
   ========================================================================== */
(function (window, document) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const ent = (v) => Math.max(0, Math.floor(num(v)));
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || ''; };
  const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); };
  /* v21.249 (Howard): URL corta con los 10 dígitos para que el QR quepa en 33 módulos con corrección M; el teléfono acepta también #tag= */
  const URL_TAG = 'https://sarinventario.web.app/solicitar.html#t=';
  const urlTag = (folio) => URL_TAG + String(folio || '').replace(/\D/g, '');
  const hora = (iso) => { try { return iso ? new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; } catch (e) { return ''; } };
  const mesCL = (v) => { const m = /^(\d{4})-(\d{2})$/.exec(v || ''); return m ? `${m[2]}/${m[1]}` : (v === 'N/A' ? 's/v' : (v || '')); };

  // ---------------- lógica pura ----------------
  const numero = (folio) => String(folio || '').slice(-6);
  const ESTADOS = { sin: 'Sin usar', contado: 'Contado', reconteo: 'Reconteo pedido', etiquetado: 'Etiquetado', incorporado: 'Incorporado', rechazado: 'Rechazado' };
  /** Estado del tag según su conteo: sin usar → contado (REGISTRADO/RECONTEO) → incorporado (ACEPTADO) → etiquetado. */
  function estadoDe(tag, conteo) {
    const e = conteo && conteo.estado;
    if (e === 'ETIQUETADO' || (tag && tag.tipo === 'bulto')) return 'etiquetado';
    if (e === 'ACEPTADO') return 'incorporado';
    if (e === 'RECHAZADO') return 'rechazado';
    if (e === 'RECONTEO') return 'reconteo';
    return conteo ? 'contado' : 'sin';
  }
  /** Misma regla que SAR_Lev.estructuraCorta (teléfono): «9×50 + 1 abierta (30)». */
  function estructuraCorta(e) {
    const ints = (e && Array.isArray(e.interiores) ? e.interiores : []), sue = ent(e && e.sueltas);
    if (!ints.length) return e && e.estado === 'ABIERTA' ? `Granel (${sue})` : `Sin subdivisión (${sue})`;
    const g = new Map(); ints.filter(x => !x.abierta).forEach(x => g.set(ent(x.q), (g.get(ent(x.q)) || 0) + 1));
    const ab = ints.filter(x => x.abierta), p = [...g].map(([q, n]) => `${n}×${q}`);
    if (ab.length) p.push(`${ab.length} abierta${ab.length === 1 ? '' : 's'} (${ab.map(x => ent(x.q)).join(' + ')})`);
    if (sue) p.push(`${sue} sueltas`);
    return p.join(' + ');
  }
  /** Une tags y conteos por folio (un conteo sin tag registrado también aparece). Más nuevos primero. */
  function unir(tags, conteos) {
    const m = new Map();
    (tags || []).forEach(t => { if (t && t.folio) m.set(t.folio, { folio: t.folio, tag: t, conteo: null }); });
    (conteos || []).forEach(c => { if (!c || !c.folio) return; const e = m.get(c.folio) || { folio: c.folio, tag: null, conteo: null }; e.conteo = c; m.set(c.folio, e); });
    return [...m.values()].map(x => ({ ...x, estado: estadoDe(x.tag, x.conteo) })).sort((a, b) => b.folio.localeCompare(a.folio));
  }
  function filtrar(filas, f) {
    const q = String(f.q || '').replace(/\D/g, '');
    return filas.filter(x => (!f.bodega || (x.conteo && x.conteo.bodega === f.bodega)) && (!f.estado || x.estado === f.estado) && (!q || x.folio.replace(/\D/g, '').endsWith(q) || numero(x.folio).includes(q)));
  }

  // ---------------- datos ----------------
  const refTag = (folio) => fs().doc(fs().collection(db(), 'Contadores'), 'bulto-' + folio);
  async function reservar(n) {
    const B = window.SAR_Bultos; if (!B || !B.reservarFolios) throw new Error('Falta el módulo de bultos.');
    const k = Math.floor(num(n)); if (k < 1 || k > 200) throw new Error('Indica entre 1 y 200 tags.');
    const { anio, ini, enLinea } = await B.reservarFolios(k), ahora = new Date().toISOString(), f = fs();
    const lista = Array.from({ length: k }, (_, i) => ({ tipo: 'tag-conteo', folio: `BUL-${anio}-${String(ini + i).padStart(6, '0')}`, estado: 'TAG', creadoEn: ahora, creadoPor: usuario(), impresiones: 0 }));
    if (enLinea) { for (const t of lista) await f.setDoc(refTag(t.folio), t); }
    else lista.forEach(t => { t.sinConexion = true; f.setDoc(refTag(t.folio), t).catch(e => console.warn('[Tags] se subirá al volver internet', t.folio, e)); });
    return lista;
  }
  async function listar() {
    const f = fs(), [st, sc] = await Promise.all([f.getDocs(f.query(f.collection(db(), 'Contadores'), f.where('tipo', '==', 'tag-conteo'), f.limit(5000))), f.getDocs(f.query(f.collection(db(), 'Conteos_Cajas'), f.limit(5000)))]);
    const t = [], c = []; st.forEach(x => t.push(x.data())); sc.forEach(x => c.push({ ...x.data(), folio: x.data().folio || x.id })); return { tags: t, conteos: c };
  }

  // ---------------- PDF 100×60 (Howard) ----------------
  let logo = null;
  function cargarLogo() {
    if (logo) return Promise.resolve(logo);
    return new Promise(ok => { const im = new Image(); im.onload = () => { try { const c = document.createElement('canvas'); c.width = 560; c.height = 175; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); logo = { d: c.toDataURL('image/jpeg', 0.92), r: 640 / 200 }; ok(logo); } catch (e) { ok(null); } }; im.onerror = () => ok(null); im.src = 'assets/logo/horizontal.svg'; });
  }
  async function pdf(lista, opc) {
    const J = window.jspdf && window.jspdf.jsPDF, B = window.SAR_Bultos, P = window.SAR_Precintos; if (!J) throw new Error('La librería de PDF aún no carga; intenta de nuevo en unos segundos.');
    if (B && B.cargarQR) await B.cargarQR(); const lg = await cargarLogo(), d = new J({ orientation: 'landscape', unit: 'mm', format: [100, 60] });
    /* misma geometría que la etiqueta BUL: punto de 203 dpi, módulo entero de 5 puntos y zona libre de 10 módulos */
    const PUNTO = 25.4 / 203, MOD = 5 * PUNTO, g = (v) => Math.round(v / PUNTO) * PUNTO;
    const caja = (x, y) => { d.setLineWidth(0.3); d.rect(x, y - 2.5, 2.8, 2.8); };
    const linea = (x1, x2, y) => { d.setLineWidth(0.2); d.line(x1, y + 0.6, x2, y + 0.6); };
    lista.forEach((t, k) => {
      if (k) d.addPage([100, 60], 'landscape'); d.setTextColor(0); d.setDrawColor(0); d.setFillColor(0);
      /* 0–11 mm: logo, franja invertida «CONTADO» y N° grande */
      if (lg) d.addImage(lg.d, 'JPEG', 3, 2, 17, 17 / lg.r, 'logo', 'FAST');
      d.rect(22, 1.6, 34, 8, 'F'); d.setTextColor(255); d.setFont('helvetica', 'bold'); d.setFontSize(15); d.text('CONTADO', 39, 7.6, { align: 'center' }); d.setTextColor(0);
      d.setFontSize(19); d.text(`N° ${numero(t.folio)}`, 97, 8.6, { align: 'right' });
      d.setLineWidth(0.35); d.line(3, 11, 97, 11);
      /* 12–40 mm: líneas para escribir a mano */
      d.setFont('helvetica', 'normal'); d.setFontSize(8);
      d.text('Insumo', 3, 16); linea(14, 97, 16);
      d.text('Lote', 3, 21.5); linea(10, 56, 21.5); d.text('Vence', 59, 21.5); d.text('__ / ____', 70, 21.5);
      d.setFont('helvetica', 'bold'); d.setFontSize(9.5); d.text('Total', 3, 27.5); linea(13, 38, 27.5); d.text('u.', 39, 27.5);
      d.setFont('helvetica', 'normal'); d.setFontSize(8); caja(50, 27.5); d.text('Sin subdivisión', 54, 27.5);
      caja(3, 33); d.text('___ cajas  ×  ___ u.', 7, 33); caja(45, 33); d.text('Granel', 49, 33); d.setFont('helvetica', 'bold'); caja(66, 33); d.text('ABIERTA', 70, 33); d.setFont('helvetica', 'normal');
      d.text('Contó', 3, 38.8); linea(13, 53, 38.8); d.text('Fecha', 56, 38.8); d.text('__ / __', 66, 38.8);
      /* 42–57 mm: Code 128 C a la izquierda, QR de 16,5 mm a la derecha y el folio legible */
      let cx = 38;
      if (P && P.barras) { const a = P.barras(String(t.folio).replace(/\D/g, '')), tot = a.reduce((s, w) => s + w, 0), mod = Math.min(MOD, Math.max(1, Math.floor(66 / tot / PUNTO)) * PUNTO), x0 = g(3 + 10 * mod); let xx = x0; a.forEach((w, i) => { if (i % 2 === 0) d.rect(xx, 42, w * mod, 10.5, 'F'); xx += w * mod; }); cx = (x0 + xx) / 2; }
      if (B && B.matrizQR && window.qrcode) {
        const q = window.qrcode(0, 'M'); q.addData(urlTag(t.folio)); q.make(); const n = q.getModuleCount(), cel = 4 * PUNTO, lado = n * cel, x0 = g(97 - lado), y0 = g(41);   /* módulo entero: lado = m.length*4*PUNTO (33 módulos = 16,5 mm) */
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d.rect(x0 + c * cel, y0 + r * cel, cel + 0.02, cel + 0.02, 'F');
      }
      d.setFont('helvetica', 'bold'); d.setFontSize(8); d.text(t.folio, cx, 56.8, { align: 'center' });
    });
    const blob = d.output('blob'); if (opc && opc.soloBlob) return blob;
    const url = URL.createObjectURL(blob), w = window.open(url, '_blank'); if (!w) d.save(`tags-${lista[0].folio}${lista.length > 1 ? '_a_' + lista[lista.length - 1].folio : ''}.pdf`); setTimeout(() => URL.revokeObjectURL(url), 120000);
    return { paginas: lista.length, bytes: blob.size };
  }
  async function imprimir(lista) {
    const r = await pdf(lista), ahora = new Date().toISOString(), f = fs();
    await Promise.all(lista.map(t => Promise.race([f.setDoc(refTag(t.folio), { impresiones: num(t.impresiones) + 1, ultimaImpresion: ahora, ...(t.primeraImpresion ? {} : { primeraImpresion: ahora }), actualizado: ahora }, { merge: true }), new Promise(x => setTimeout(x, 2500))]).catch(() => null)));
    return r;
  }

  // ---------------- pantalla ----------------
  let filas = [], fil = { bodega: '', estado: '', q: '' };
  function tabla(root) {
    const l = filtrar(filas, fil), bods = [...new Set(filas.map(x => x.conteo && x.conteo.bodega).filter(Boolean))].sort(), cnt = {}; filas.forEach(x => { cnt[x.estado] = (cnt[x.estado] || 0) + 1; });
    const el = root.querySelector('#tg-tabla'); if (!el) return;
    el.innerHTML = `<div class="sal-barra tg-fil"><select id="tg-fb" class="form-control" aria-label="Bodega"><option value="">Todas las bodegas</option>${bods.map(b => `<option${fil.bodega === b ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>
      <select id="tg-fe" class="form-control" aria-label="Estado"><option value="">Todos los estados</option>${Object.keys(ESTADOS).map(k => `<option value="${k}"${fil.estado === k ? ' selected' : ''}>${ESTADOS[k]} (${cnt[k] || 0})</option>`).join('')}</select>
      <input id="tg-fq" class="form-control" type="search" inputmode="numeric" placeholder="Buscar N° de tag…" value="${esc(fil.q)}" aria-label="Buscar número"></div>
      <p class="act-hint">${l.length} de ${filas.length} tags.</p>
      <div class="sal-tabla"><table class="aud-lib tg-t"><thead><tr><th>N°</th><th>Impreso</th><th>Estado</th><th>Bodega</th><th>Producto</th><th>Lote · vence</th><th>Total</th><th>Estructura</th><th>Contó</th><th></th></tr></thead><tbody>
      ${l.slice(0, 600).map(x => { const c = x.conteo, t = x.tag; return `<tr><td><b>${esc(numero(x.folio))}</b><small>${esc(x.folio)}</small></td><td>${t && t.primeraImpresion ? esc(hora(t.primeraImpresion)) : (t ? 'Sin imprimir' : '—')}</td><td><span class="tg-est tg-est--${x.estado}">${ESTADOS[x.estado]}</span></td>
        <td>${c ? esc(c.bodega) : ''}</td><td>${c ? `${esc(c.nombre)}${c.nuevo ? ' <small>nuevo</small>' : ''}` : ''}</td><td>${c ? `${esc(c.lote)} · ${esc(mesCL(c.vence))}` : ''}</td><td>${c ? `<b>${num(c.total)}</b> u.` : ''}</td><td>${c ? esc(estructuraCorta(c.estructura)) : ''}</td>
        <td>${c ? `${esc(c.contadoNombre || c.contadoPor || '')}<small>${esc(hora(c.en))}</small>` : ''}</td><td>${t && x.estado === 'sin' ? `<button type="button" class="btn btn-secondary btn-sm" data-tg-re="${esc(x.folio)}">Reimprimir</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="10" class="err-vacio">Sin tags.</td></tr>'}</tbody></table></div>`;
    el.querySelector('#tg-fb').onchange = (e) => { fil.bodega = e.target.value; tabla(root); };
    el.querySelector('#tg-fe').onchange = (e) => { fil.estado = e.target.value; tabla(root); };
    const q = el.querySelector('#tg-fq'); q.oninput = () => { fil.q = q.value; const p = q.selectionStart; tabla(root); const n = root.querySelector('#tg-fq'); if (n) { n.focus(); n.setSelectionRange(p, p); } };
    el.querySelectorAll('[data-tg-re]').forEach(b => b.onclick = async () => { const x = filas.find(y => y.folio === b.dataset.tgRe); if (!x) return; b.disabled = true; try { await imprimir([x.tag]); toast('Tag', 'Reimpreso.', 'success'); await cargar(root); } catch (e) { toast('No se pudo', esc(e.message || e), 'error'); b.disabled = false; } });
  }
  async function cargar(root) {
    const el = root.querySelector('#tg-tabla'); if (el && !filas.length) el.innerHTML = window.SAR_Progreso && window.SAR_Progreso.cargando ? window.SAR_Progreso.cargando('Leyendo los tags…') : 'Cargando…';
    try { const r = await listar(); filas = unir(r.tags, r.conteos); tabla(root); } catch (e) { if (el) el.innerHTML = `<p class="err-vacio">No pude leer los tags (${esc(e.code || e.message || e)}).</p>`; }
  }
  function abrir() {
    const root = document.getElementById('tags-root'); if (!root) return;
    root.innerHTML = `<div class="tg"><div class="act-card tg-res"><h3 class="act-h">Reservar e imprimir tags «CONTADO»</h3>
      <p class="act-hint">Cada tag lleva un número BUL reservado: será el folio de la etiqueta definitiva de la caja grande. El teléfono registra lo contado; el stock no cambia.</p>
      <div class="tg-fila"><label class="form-label" for="tg-n">Cantidad de tags</label><input id="tg-n" class="form-control" type="number" min="1" max="200" value="20" inputmode="numeric"><button type="button" class="btn btn-primary" id="tg-go"><i class="ph-bold ph-printer" aria-hidden="true"></i> Reservar e imprimir</button></div>
      <p class="act-hint">PDF de 100 × 60 mm, un tag por página, para la Zebra ZD230 (imprimir a tamaño real).</p></div>
      <h3 class="act-h" style="margin-top:18px;">Todos los tags</h3><div id="tg-tabla"></div></div>`;
    root.querySelector('#tg-go').onclick = async (e) => {
      const n = Math.floor(num(root.querySelector('#tg-n').value)), b = e.currentTarget; if (n < 1 || n > 200) { toast('Tags', 'Indica entre 1 y 200.', 'warning'); return; }
      const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: `¿Reservar ${n} tag${n === 1 ? '' : 's'}?`, texto: 'Se reservan números BUL seguidos y se abre el PDF para imprimir.', si: 'Reservar e imprimir' }) : true; if (!ok) return;
      b.disabled = true; try { const l = await reservar(n); await imprimir(l); toast('Tags', `${l.length} tags: N° ${numero(l[0].folio)} a ${numero(l[l.length - 1].folio)}.`, 'success'); await cargar(root); } catch (er) { toast('No se pudo', esc(er.message || er), 'error'); } b.disabled = false;
    };
    cargar(root);
  }

  const api = { urlTag, abrir, reservar, listar, pdf, imprimir, unir, filtrar, estadoDe, estructuraCorta, numero, ESTADOS };
  window.SAR_TagsConteo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
