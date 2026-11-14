/* ==========================================================================
   FICHA DE PRODUCTO (v21.190)
   Clic en un producto del Catálogo: foto, stock total, stock por bodega/estante/lote/vencimiento,
   cuándo y cómo ingresó, último movimiento y los movimientos recientes (Historial_Movimientos).
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v) || 0;
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const soloDig = (t) => String(t || '').replace(/\D/g, '');
  const TIPOS = { INGRESO_PROVEEDOR: 'Ingreso de proveedor', INGRESO_INVENTARIO: 'Ingreso de inventario', RECEPCION_OC: 'Recepción de orden', INGRESO: 'Ingreso', EGRESO: 'Salida', SALIDA: 'Salida', TRASPASO: 'Traspaso', traspaso: 'Traspaso', TRANSFERENCIA: 'Transferencia', AJUSTE: 'Ajuste', ACTA_ENTREGA: 'Acta de entrega', ENTREGA_ACTA: 'Acta de entrega', TRANSITORIA_FALTANTE: 'Faltante bodega transitoria', CUADRE_SOBREGIRO: 'Cuadre de sobregiro', MERMA: 'Merma' };
  const tipoTxt = (t) => TIPOS[t] || String(t || '—').replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
  const esIngreso = (t) => /INGRESO|RECEP/i.test(String(t || ''));

  // ---------------- lógica pura ----------------
  /** Fecha de un movimiento (Timestamp de Firestore, Date, número o texto) → Date | null. */
  function fechaDe(v) { if (!v) return null; if (typeof v.toDate === 'function') return v.toDate(); if (typeof v.seconds === 'number') return new Date(v.seconds * 1000); const d = new Date(v); return isNaN(d) ? null : d; }
  /** Filas de stock por bodega · estante · lote · vencimiento, ordenadas por vencimiento (lo que vence antes, primero). */
  function filasStock(docs) {
    const out = [];
    (docs || []).forEach(d => {
      const lotes = (d.batches || []).filter(b => num(b.quantity) > 0);
      if (lotes.length) lotes.forEach(b => out.push({ bodega: d.location || 'Sin bodega', estante: d.ubicacionEstante || '', lote: b.batch || 'S/L', vence: b.expirationDate || '', cantidad: num(b.quantity) }));
      else if (num(d.quantity) > 0) out.push({ bodega: d.location || 'Sin bodega', estante: d.ubicacionEstante || '', lote: 'S/L', vence: '', cantidad: num(d.quantity) });
    });
    return out.sort((a, b) => (a.vence || '9999').localeCompare(b.vence || '9999') || a.bodega.localeCompare(b.bodega));
  }
  /** Resumen de movimientos: primer ingreso, último ingreso, último movimiento (lista ya ordenada del más nuevo al más viejo). */
  function resumenMovs(movs) {
    const ing = movs.filter(m => esIngreso(m.type));
    return { primerIngreso: ing[ing.length - 1] || null, ultimoIngreso: ing[0] || null, ultimo: movs[0] || null };
  }
  /** ¿Este documento de Insumos es el mismo producto? por código MP o por nombre. */
  const coincide = (d, nombre, codigo) => (soloDig(codigo) && soloDig(d.codigoMP || d.code) === soloDig(codigo)) || norm(d.name) === norm(nombre);

  // ---------------- fotos del producto (v21.199) ----------------
  // Foto principal (caja/envase) en `imagen`; fotos extra de cómo es el producto (p. ej. el catéter fuera de la caja) en `fotosExtra`.
  const slugF = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  function reducir(file, max, q) {
    return new Promise((ok, mal) => { const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', q || 0.72)); };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la imagen.')); }; img.src = url; });
  }
  /** Documento del catálogo de este producto (por código, nombre de inventario o descripción); si no existe, el id que tendría. */
  async function docCatalogo(nombre, codigo) {
    const f = fs(), col = f.collection(db(), 'Catalogo_Productos');
    for (const [campo, v] of [['codigoMP', codigo], ['insumoName', nombre], ['descripcion', nombre]]) { if (!v) continue; try { const sn = await f.getDocs(f.query(col, f.where(campo, '==', campo === 'codigoMP' ? String(v) : v), f.limit(1))); if (!sn.empty) return { id: sn.docs[0].id, data: sn.docs[0].data(), existe: true }; } catch (e) { /* sigue */ } }
    return { id: slugF(String(codigo || nombre)).slice(0, 120), data: {}, existe: false };
  }
  async function guardarCat(cat, nombre, codigo, cambios) {
    const f = fs(), base = cat.existe ? {} : { descripcion: nombre, descripcion_lower: String(nombre).toLowerCase(), insumoName: nombre, ...(codigo ? { codigoMP: String(codigo) } : {}), sinOrden: true };
    await f.setDoc(f.doc(f.collection(db(), 'Catalogo_Productos'), cat.id), { ...base, ...cambios, actualizado: f.serverTimestamp() }, { merge: true });
    cat.existe = true; cat.data = { ...cat.data, ...base, ...cambios };
    if (window.SAR_Imagenes) await window.SAR_Imagenes.cargar(true).catch(() => {});
    if (window.SAR_CatalogoVista) window.SAR_CatalogoVista.recargar();
  }
  function pintarFotos(el, cat, nombre, codigo) {
    const d = cat.data || {}, IM = window.SAR_Imagenes, extras = Array.isArray(d.fotosExtra) ? d.fotosExtra : [];
    const prin = d.imagen ? `<img src="${esc(d.imagen)}" alt="">` : (d.imagenMP && d.fotoEstado !== 'descartada' && IM ? `<img src="${esc(IM.urlMP(d.imagenMP, 400))}" alt="" referrerpolicy="no-referrer">` : '');
    el.innerHTML = `<div class="fp-fotos">
        <figure class="fp-foto">${prin ? `<span class="prod-img prod-img--g${!d.imagen && d.fotoEstado === 'por_confirmar' ? ' prod-img--pend' : ''}" data-img-name="${esc(nombre)}">${prin}</span>` : '<span class="fp-vacia"><i class="ph-bold ph-image"></i></span>'}<figcaption>Caja / envase${!d.imagen && d.fotoEstado === 'por_confirmar' ? ' · <b>por confirmar</b>' : d.imagen ? ' · foto propia' : ''}</figcaption></figure>
        ${extras.map((x, i) => `<figure class="fp-foto"><span class="prod-img prod-img--g" data-img-name="${esc(nombre)}"><img src="${esc(x.img)}" alt="${esc(x.tipo)}"></span><figcaption>${esc(x.tipo === 'producto' ? 'Cómo es el producto' : x.tipo)} <button type="button" class="fp-quitar" data-q="${i}" aria-label="Quitar foto">✕</button></figcaption></figure>`).join('')}
      </div>
      <div class="fp-facc">
        <label class="btn btn-primary btn-sm"><input type="file" accept="image/*" capture="environment" hidden data-f="caja"><i class="ph-bold ph-camera"></i> Foto de la caja</label>
        <label class="btn btn-primary btn-sm"><input type="file" accept="image/*" capture="environment" hidden data-f="producto"><i class="ph-bold ph-camera"></i> Foto del producto (cómo es)</label>
        <button type="button" class="btn btn-secondary btn-sm" data-buscar="1"><i class="ph-bold ph-magnifying-glass"></i> Buscar en internet</button>
        ${!d.imagen && d.fotoEstado === 'por_confirmar' ? '<button type="button" class="btn btn-secondary btn-sm" data-conf="1">✔ Es correcta</button><button type="button" class="btn btn-secondary btn-sm" data-desc="1">✖ No es</button>' : ''}
      </div><div class="fp-cand"></div>`;
    const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); }, rehacer = () => pintarFotos(el, cat, nombre, codigo);
    el.querySelectorAll('input[data-f]').forEach(inp => inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0]; if (!file) return;
      try {
        if (inp.dataset.f === 'caja') await guardarCat(cat, nombre, codigo, { imagen: await reducir(file, 320, 0.75) });
        else { if (extras.length >= 4) { toast('Fotos', 'Máximo 4 fotos extra: quita una antes.', 'warning'); return; } await guardarCat(cat, nombre, codigo, { fotosExtra: extras.concat([{ tipo: 'producto', img: await reducir(file, 640, 0.7), por: (window.firebaseAuth && window.firebaseAuth.currentUser || {}).email || '', en: new Date().toISOString() }]) }); }
        rehacer(); if (window.SAR_Progreso && window.SAR_Progreso.exito) window.SAR_Progreso.exito({ titulo: 'Foto guardada', texto: esc(nombre) });
      } catch (e) { toast('No se guardó la foto', e.message || String(e), 'error'); }
    }));
    el.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', async () => { if (!confirm('¿Quitar esta foto?')) return; const l = extras.slice(); l.splice(+b.dataset.q, 1); await guardarCat(cat, nombre, codigo, { fotosExtra: l }).catch(e => toast('No se pudo', e.message, 'error')); rehacer(); }));
    const bc = el.querySelector('[data-conf]'), bd = el.querySelector('[data-desc]');
    if (bc) bc.onclick = async () => { await guardarCat(cat, nombre, codigo, { fotoEstado: 'confirmada' }); rehacer(); };
    if (bd) bd.onclick = async () => { await guardarCat(cat, nombre, codigo, { fotoEstado: 'descartada' }); rehacer(); };
    const bb = el.querySelector('[data-buscar]'); if (bb) bb.onclick = async () => {
      const cand = el.querySelector('.fp-cand'); bb.disabled = true; cand.innerHTML = '<p class="fp-v">Buscando en la tienda de Convenio Marco por código y descripción (puede tardar 20–30 s)…</p>';
      let r = null; try {
        const f = fs(), cfgS = await f.getDoc(f.doc(f.collection(db(), 'Config_Correo'), 'principal')), cfg = cfgS.exists() ? cfgS.data() : {};
        if (codigo && IM) { const x = await IM.buscarFoto(codigo, cfg); if (x && x.archivo) r = { archivo: x.archivo, titulo: 'Mismo código de Mercado Público' }; }
        if (!r && IM) r = await IM.buscarPorDescripcion(nombre, cfg);
      } catch (e) { /* sin resultado */ }
      bb.disabled = false;
      const google = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(nombre)}`;
      cand.innerHTML = r && r.archivo
        ? `<div class="fp-candc"><img src="${esc(IM.urlMP(r.archivo, 300))}" alt="" referrerpolicy="no-referrer"><div><b>¿Es este producto?</b><small>${esc(r.titulo || '')}</small><div class="fp-facc"><button type="button" class="btn btn-primary btn-sm" data-usar="1">Usar esta foto</button><button type="button" class="btn btn-secondary btn-sm" data-no="1">No es</button><a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="${google}">Ver en Google Imágenes</a></div></div></div>`
        : `<p class="fp-v">No la encontré en la tienda. Sácale una foto con los botones de arriba, o búscala en <a target="_blank" rel="noopener" href="${google}">Google Imágenes</a>.</p>`;
      const u = cand.querySelector('[data-usar]'), n = cand.querySelector('[data-no]');
      if (u) u.onclick = async () => { await guardarCat(cat, nombre, codigo, { imagenMP: r.archivo, fotoEstado: 'confirmada', fotoTitulo: r.titulo || '' }); rehacer(); };
      if (n) n.onclick = () => { cand.innerHTML = `<p class="fp-v">Entendido. Sácale una foto con los botones de arriba.</p>`; };
    };
    if (IM) IM.rellenar(el);
  }

  // ---------------- pantalla ----------------
  const fmtF = (d) => d ? d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtV = (v) => { if (!v) return '—'; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); return m ? `${m[3]}-${m[2]}-${m[1]}` : esc(v); };
  const venceClase = (v) => { if (!v) return ''; const d = new Date(v), dias = (d - new Date()) / 864e5; return dias < 0 ? 'fp-venc' : dias < 90 ? 'fp-prox' : ''; };
  const comoTxt = (m) => [tipoTxt(m.type), m.document, m.provider ? 'Proveedor ' + m.provider : '', m.origin && !/^Inventario inicial$/i.test(m.origin) ? 'desde ' + m.origin : ''].filter(Boolean).map(esc).join(' · ');

  async function abrir(p) {
    const nombre = p.nombre || p.descripcion || '', codigo = p.codigo || p.codigoMP || '';
    const ov = document.createElement('div'); ov.className = 'fp-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Ficha de ' + nombre);
    ov.innerHTML = `<div class="fp-c"><button type="button" class="fp-x" aria-label="Cerrar">×</button><div class="fp-body">${window.SAR_Progreso ? window.SAR_Progreso.cargando('Buscando stock, lotes y movimientos…') : 'Cargando…'}</div></div>`;
    const cerrar = () => { ov.remove(); document.removeEventListener('keydown', tecla, true); };
    const tecla = (e) => { if (e.key === 'Escape' && !document.querySelector('.prod-zoom')) { e.stopPropagation(); cerrar(); } };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.fp-x')) cerrar(); });
    document.addEventListener('keydown', tecla, true); document.body.appendChild(ov);
    const cuerpo = ov.querySelector('.fp-body'), f = fs();
    try {
      const sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(5000))), docs = [];
      sn.forEach(d => { const x = { id: d.id, ...d.data() }; if (coincide(x, nombre, codigo)) docs.push(x); });
      const nombres = [...new Set([nombre, ...docs.map(d => d.name)].filter(Boolean))].slice(0, 6), movs = [], vistos = new Set();
      for (const n of nombres) { const hs = await f.getDocs(f.query(f.collection(db(), 'Historial_Movimientos'), f.where('insumoName', '==', n), f.limit(300))); hs.forEach(d => { if (vistos.has(d.id)) return; vistos.add(d.id); const m = d.data(); if (m.sinEfectoStock) return; movs.push({ ...m, _f: fechaDe(m.date || m.timestamp || m.fecha) }); }); }
      movs.sort((a, b) => (b._f || 0) - (a._f || 0));
      const filas = filasStock(docs), total = docs.reduce((t, d) => t + num(d.quantity), 0), r = resumenMovs(movs);
      const porBod = {}; filas.forEach(x => { porBod[x.bodega] = (porBod[x.bodega] || 0) + x.cantidad; });
      const cat = (docs.find(d => d.category && d.category !== 'General') || docs[0] || {}).category || '';
      cuerpo.innerHTML = `<div class="fp-cab">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(nombre, { codigo, grande: true }) : ''}<div><h2 class="fp-t">${esc(nombre)}</h2><p class="fp-s">${codigo ? 'Cód. MP ' + esc(codigo) + ' · ' : ''}${cat ? esc(cat) + ' · ' : ''}${docs.length} registro(s) en inventario</p>
          <div class="fp-kpis"><div><b>${total.toLocaleString('es-CL')}</b><span>unidades en stock</span></div><div><b>${Object.keys(porBod).length}</b><span>bodega(s)</span></div><div><b>${filas.length ? fmtV(filas[0].vence) : '—'}</b><span>próximo vencimiento</span></div></div></div></div>
        <h3 class="fp-h">Fotos</h3><div id="fp-fotos-c"><p class="fp-v">Cargando fotos…</p></div>
        <h3 class="fp-h">Dónde está y por lote</h3>
        ${filas.length ? `<div class="fp-tw"><table class="fp-tb"><thead><tr><th>Bodega</th><th>Estante</th><th>Lote</th><th>Vence</th><th>Cantidad</th></tr></thead><tbody>${filas.map(x => `<tr><td>${esc(x.bodega)}</td><td>${esc(x.estante || '—')}</td><td>${esc(x.lote)}</td><td class="${venceClase(x.vence)}">${fmtV(x.vence)}</td><td><b>${x.cantidad.toLocaleString('es-CL')}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="fp-v">Sin stock en ninguna bodega.</p>'}
        <h3 class="fp-h">Ingresos y movimientos</h3>
        <div class="fp-res">
          <div><span>Primer ingreso</span><b>${r.primerIngreso ? fmtF(r.primerIngreso._f) : '—'}</b><small>${r.primerIngreso ? comoTxt(r.primerIngreso) + ' · ' + num(r.primerIngreso.quantity) + ' u.' : 'Sin registro de ingreso'}</small></div>
          <div><span>Último ingreso</span><b>${r.ultimoIngreso ? fmtF(r.ultimoIngreso._f) : '—'}</b><small>${r.ultimoIngreso ? comoTxt(r.ultimoIngreso) + ' · ' + num(r.ultimoIngreso.quantity) + ' u.' : ''}</small></div>
          <div><span>Último movimiento</span><b>${r.ultimo ? fmtF(r.ultimo._f) : '—'}</b><small>${r.ultimo ? comoTxt(r.ultimo) + ' · ' + num(r.ultimo.quantity) + ' u.' + (r.ultimo.user ? ' · ' + esc(r.ultimo.user) : '') : 'Sin movimientos'}</small></div>
        </div>
        ${movs.length ? `<div class="fp-tw"><table class="fp-tb"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Cant.</th><th>Lote</th><th>Desde → hacia</th><th>Documento</th><th>Usuario</th></tr></thead><tbody>${movs.slice(0, 25).map(m => `<tr><td>${fmtF(m._f)}</td><td>${esc(tipoTxt(m.type))}</td><td>${num(m.quantity)}</td><td>${esc(m.batch || '—')}</td><td>${esc([m.origin, m.destination || m.dest].filter(Boolean).join(' → ') || '—')}</td><td>${esc(m.document || m.actaId || '—')}</td><td>${esc(m.user || '—')}</td></tr>`).join('')}</tbody></table></div>${movs.length > 25 ? `<p class="fp-v">Mostrando los 25 más recientes de ${movs.length}. El detalle completo está en Historial.</p>` : ''}` : '<p class="fp-v">Sin movimientos registrados.</p>'}`;
      if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(cuerpo);
      const fc = cuerpo.querySelector('#fp-fotos-c'); if (fc) docCatalogo(nombre, codigo).then(cat => pintarFotos(fc, cat, nombre, codigo)).catch(() => { fc.innerHTML = '<p class="fp-v">No se pudieron leer las fotos.</p>'; });
    } catch (e) { cuerpo.innerHTML = `<p class="fp-v">No pude leer la información (${esc(e.message || e)}).</p>`; }
  }

  window.SAR_Ficha = { abrir, filasStock, resumenMovs, fechaDe };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SAR_Ficha;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : null);
