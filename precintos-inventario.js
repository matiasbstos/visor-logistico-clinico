/* Precintos de inventario (v21.80): etiqueta 100×60 mm horizontal para Zebra ZD230 (térmica, monocroma),
   con folio correlativo. Se imprime directo (@page 100×60) o se baja en PDF. Cada folio queda registrado en
   Contadores/pin-<folio>. Basado en el manual del precinto de oxígeno. */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); };
  const hoy = () => new Date().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || ''; };
  const nombreDe = (e) => String(e || '').split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const folio = (anio, n) => 'PI-' + anio + '-' + String(n).padStart(4, '0');
  const ESTADOS = ['Conteo completo', 'Reconteo requerido', 'Con diferencia', 'Caja abierta / dañada', 'Verificado 2.ª persona'];
  let lote = [];

  /** Texto de cada precinto (un solo lugar para pantalla, impresión y PDF). */
  function campos(p) {
    return [['Bodega', p.bodega], ['Ubicación', p.ubicacion], ['Categoría', p.categoria], ['Conteo N°', p.conteo], ['Fecha', p.fecha], ['Responsable', p.responsable]];
  }
  function etiquetaHTML(p) {
    return '<section class="precinto"><header class="pr-cab"><img src="assets/logo-sar.png" alt="SAR" class="pr-logo"><div class="pr-tit">PRECINTO DE INVENTARIO</div><div class="pr-folio">' + esc(p.folio) + '</div></header>' +
      '<div class="pr-cuerpo"><div class="pr-izq">' + campos(p).map(c => '<div class="pr-campo"><span>' + esc(c[0]) + ':</span> <b>' + esc(c[1] || '—') + '</b></div>').join('') +
      '<div class="pr-campo"><span>Contado:</span> <i class="pr-linea"></i> un.</div></div>' +
      '<div class="pr-der">' + ESTADOS.map(e => '<div class="pr-chk"><i></i>' + esc(e) + '</div>').join('') + '</div></div>' +
      '<footer class="pr-pie"><div><span>Reporta incid.:</span> <i class="pr-linea l2"></i></div><div><span>Motivo:</span> <i class="pr-linea l3"></i></div></footer></section>';
  }

  async function reservar(n, anio) {
    const f = fs(), ref = f.doc(f.collection(db(), 'Contadores'), 'precinto-' + anio);
    return f.runTransaction(db(), async (tx) => { const s = await tx.get(ref); const ult = s.exists() ? Number(s.data().ultimo) || 0 : 0; tx.set(ref, { ultimo: ult + n, tipo: 'contador-precinto', updatedAt: f.serverTimestamp() }, { merge: true }); return ult + 1; });
  }
  async function generar(datos, copias) {
    const anio = new Date().getFullYear(), f = fs();
    const primero = await reservar(copias, anio);
    const out = [];
    for (let i = 0; i < copias; i++) {
      const p = Object.assign({}, datos, { folio: folio(anio, primero + i), fecha: hoy() });
      out.push(p);
      await f.setDoc(f.doc(f.collection(db(), 'Contadores'), 'pin-' + p.folio), Object.assign({ tipo: 'precinto-inventario', creadoPor: usuario(), updatedAt: f.serverTimestamp() }, p));
    }
    return out;
  }

  function imprimir() {
    if (!lote.length) return;
    let zona = document.getElementById('precinto-print');
    if (!zona) { zona = document.createElement('div'); zona.id = 'precinto-print'; document.body.appendChild(zona); }
    zona.innerHTML = lote.map(etiquetaHTML).join('');
    document.body.classList.add('imprimiendo-precinto');
    const fin = () => { document.body.classList.remove('imprimiendo-precinto'); window.removeEventListener('afterprint', fin); };
    window.addEventListener('afterprint', fin);
    setTimeout(() => window.print(), 80);
  }

  function cargarLogo() {
    return new Promise((ok) => { const im = new Image(); im.onload = () => { try { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0); ok({ d: c.toDataURL('image/png'), r: im.naturalWidth / im.naturalHeight }); } catch (e) { ok(null); } }; im.onerror = () => ok(null); im.src = 'assets/logo-sar.png'; });
  }
  async function pdf() {
    if (!lote.length) return;
    const J = window.jspdf && window.jspdf.jsPDF; if (!J) { toast('PDF', 'La librería de PDF aún no carga; intenta de nuevo.', 'error'); return; }
    const logo = await cargarLogo();
    const d = new J({ orientation: 'landscape', unit: 'mm', format: [100, 60] });
    lote.forEach((p, k) => {
      if (k) d.addPage([100, 60], 'landscape');
      d.setDrawColor(0); d.setTextColor(0); d.setLineWidth(0.4); d.rect(1.5, 1.5, 97, 57);
      if (logo) { const h = 7, w = Math.min(h * logo.r, 22); d.addImage(logo.d, 'PNG', 3, 3, w, w / logo.r); }
      d.setFont('helvetica', 'bold'); d.setFontSize(9); d.text('PRECINTO DE INVENTARIO', 27, 7);
      d.setFontSize(13); d.text(p.folio, 97, 8, { align: 'right' });
      d.setLineWidth(0.3); d.line(3, 11.5, 97, 11.5);
      d.setFontSize(7.5); let y = 16;
      campos(p).forEach(c => { d.setFont('helvetica', 'normal'); d.text(c[0] + ':', 3, y); d.setFont('helvetica', 'bold'); d.text(String(c[1] || '—').slice(0, 26), 22, y); y += 5; });
      d.setFont('helvetica', 'normal'); d.text('Contado:', 3, y); d.line(18, y, 38, y); d.text('un.', 39, y);
      d.setLineWidth(0.3); d.line(56, 13, 56, 44);
      ESTADOS.forEach((e, i) => { const yy = 17 + i * 6; d.rect(58, yy - 2.6, 3, 3); d.setFont('helvetica', 'bold'); d.setFontSize(7); d.text(e, 63, yy); });
      d.line(3, 46, 97, 46); d.setFont('helvetica', 'normal'); d.setFontSize(7.5);
      d.text('Reporta incid.:', 3, 51); d.line(25, 51, 97, 51); d.text('Motivo:', 3, 56); d.line(17, 56, 97, 56);
    });
    d.save('precintos-' + lote[0].folio + (lote.length > 1 ? '_a_' + lote[lote.length - 1].folio : '') + '.pdf');
  }

  async function bodegasNombres() {
    try { const f = fs(); const s = await f.getDocs(f.collection(db(), 'Bodegas')); const l = []; s.forEach(d => { const n = d.data().name; if (n) l.push(n); }); return l.sort((a, b) => a.localeCompare(b, 'es')); } catch (e) { return []; }
  }
  async function abrir() {
    let m = document.getElementById('modal-precinto');
    if (!m) { m = document.createElement('div'); m.id = 'modal-precinto'; m.className = 'modal-overlay'; document.body.appendChild(m); }
    const bod = await bodegasNombres();
    m.innerHTML = '<div class="modal-content pr-modal"><div class="modal-header"><div><span class="text-primary font-bold text-sm">TOMA DE INVENTARIO</span><h2>Precinto de conteo</h2></div><button type="button" class="btn btn-icon close-modal-btn" data-pr="cerrar"><i class="ph ph-x"></i></button></div>' +
      '<div class="modal-body"><div class="pr-form">' +
      '<label>Bodega<select id="pr-bodega">' + bod.map(b => '<option>' + esc(b) + '</option>').join('') + '</select></label>' +
      '<label>Ubicación / estante<input id="pr-ubic" placeholder="Ej. Estante 3, nivel B"></label>' +
      '<label>Categoría<input id="pr-cat" placeholder="Ej. Fármacos (opcional)"></label>' +
      '<label>Conteo<select id="pr-conteo"><option>1.° conteo</option><option>2.° conteo</option><option>3.° conteo</option></select></label>' +
      '<label>Responsable<input id="pr-resp" value="' + esc(nombreDe(usuario())) + '"></label>' +
      '<label>Cantidad de etiquetas<input id="pr-n" type="number" min="1" max="60" value="1"></label></div>' +
      '<button type="button" class="btn btn-primary" data-pr="generar"><i class="ph-bold ph-tag"></i> Generar folios</button>' +
      '<div id="pr-vista" class="pr-vista"></div></div>' +
      '<div class="modal-footer pr-pie-m"><button type="button" class="btn btn-outline" data-pr="cerrar">Cerrar</button><button type="button" class="btn btn-outline" data-pr="pdf" disabled><i class="ph-bold ph-file-pdf"></i> Descargar PDF</button><button type="button" class="btn btn-primary" data-pr="imprimir" disabled><i class="ph-bold ph-printer"></i> Imprimir</button></div></div>';
    lote = []; m.classList.add('active');
    m.onclick = async (e) => {
      const b = e.target.closest('[data-pr]'); if (!b) return; const a = b.dataset.pr;
      if (a === 'cerrar') m.classList.remove('active');
      else if (a === 'imprimir') imprimir(); else if (a === 'pdf') pdf();
      else if (a === 'generar') {
        const v = (id) => (m.querySelector(id) || {}).value || '';
        const n = Math.max(1, Math.min(60, parseInt(v('#pr-n'), 10) || 1));
        if (!v('#pr-bodega')) { toast('Falta la bodega', 'Elige la bodega que se está contando.', 'error'); return; }
        b.disabled = true; const vista = m.querySelector('#pr-vista'); vista.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Reservando folios…') : 'Reservando folios…';
        try {
          lote = await generar({ bodega: v('#pr-bodega'), ubicacion: v('#pr-ubic').trim(), categoria: v('#pr-cat').trim(), conteo: v('#pr-conteo'), responsable: v('#pr-resp').trim() }, n);
          vista.innerHTML = '<p class="sub-text">' + lote.length + ' precinto(s): ' + esc(lote[0].folio) + (lote.length > 1 ? ' a ' + esc(lote[lote.length - 1].folio) : '') + '. Se imprimen a 100×60 mm.</p>' + etiquetaHTML(lote[0]);
          m.querySelectorAll('[data-pr="pdf"],[data-pr="imprimir"]').forEach(x => x.disabled = false);
          toast('Folios listos', lote.length + ' precinto(s) registrados.', 'success');
        } catch (err) { console.error('[Precintos]', err); vista.innerHTML = '<p class="sub-text">No se pudieron reservar los folios (código PI-01). Revisa la conexión.</p>'; }
        b.disabled = false;
      }
    };
  }

  function montarBoton() {
    if (document.getElementById('btn-precinto-abrir')) return;
    const h = document.querySelector('#view-toma-inventario .page-tabs__spacer'); if (!h) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'btn-precinto-abrir'; b.className = 'btn btn-outline'; b.innerHTML = '<i class="ph-bold ph-tag"></i> Precinto de conteo';
    b.addEventListener('click', abrir); h.insertAdjacentElement('afterend', b);
  }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('DOMContentLoaded', montarBoton);
  const api = { folio, etiquetaHTML, campos, abrir, imprimir, pdf, ESTADOS };
  if (typeof window !== 'undefined') window.SAR_Precintos = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : {}, typeof document !== 'undefined' ? document : {});
