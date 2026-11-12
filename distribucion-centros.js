/* ==========================================================================
   DISTRIBUCIÓN A CENTROS (v21.162)
   Una compra global (SDC → orden de compra) se reparte después entre los centros. Aquí se arma esa lista por centro
   (mismo formato de las planillas «Convenio Marco» y «No Marco»: una hoja por centro), se importa desde esas planillas,
   se descarga en Excel para enviar a confirmación, y se entrega con las Actas de entrega (botón «Entregar» → acta
   precargada con lo que hay en stock). Cada distribución se guarda en Contadores (id «distribucion-…», tipo
   «distribucion»): no requiere reglas nuevas.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const digs = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  const num = (v) => { if (typeof v === 'number') return isFinite(v) ? v : 0; const t = String(v == null ? '' : v).replace(/[^0-9,.\-]/g, ''); if (!t) return 0; const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const peso = (n) => '$' + Math.round(num(n)).toLocaleString('es-CL');
  const toast = (t, m, k) => { if (window.showToast) window.showToast(t, m, k || 'info'); };
  const usuario = () => { const a = window.firebaseAuth || window.auth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };
  const ESTADOS = [['borrador', 'Borrador'], ['enviada', 'Enviada a confirmar'], ['confirmada', 'Confirmada'], ['entrega', 'En entrega'], ['cerrada', 'Cerrada'], ['archivada', 'Archivada']];
  const MODOS = [['CONVENIO', 'Convenio Marco'], ['NO_MARCO', 'No Marco']];

  /** Puro: de las filas de una hoja (arreglo de arreglos) saca las líneas del centro. */
  function parsearHoja(filas) {
    const hi = filas.findIndex(r => (r || []).some(c => /^descripci/i.test(norm(c))));
    if (hi < 0) return { lineas: [], convenio: false };
    const cab = filas[hi].map(norm), col = (re) => cab.findIndex(h => re.test(h));
    const c = { d: col(/^descripci/), id: col(/id convenio|^id\b/), eq: col(/^equivalente/), pr: col(/^presentaci/), v: col(/^valor$/), q: col(/^cantidad( |$)/), u: col(/^unidad/), py: col(/proyecto/), rf: col(/^referencia/), en: col(/^entregad|cantidad entregada|cantidacantidad entregada/) };
    // Algunas hojas traen el encabezado «ID CONVENIO MARCO» sin esa columna en los datos (todo corrido una a la izquierda)
    const muestra = filas.slice(hi + 1).map(r => (r || [])[c.id]).filter(v => v !== '' && v != null && !/^total/i.test(String(v)));
    const corrido = c.id >= 0 && muestra.length > 0 && muestra.filter(v => /^\d{3,}$/.test(String(v).trim())).length / muestra.length < 0.5;
    if (corrido) { const dec = (k) => (k > c.id ? k - 1 : k); Object.keys(c).forEach(k => { if (c[k] > c.id) c[k] = dec(c[k]); }); c.id = -1; c.py = c.u >= 0 ? c.u + 1 : -1; c.rf = -1; }
    const lineas = [];
    for (let i = hi + 1; i < filas.length; i++) {
      const r = filas[i] || [], d = String(r[c.d] == null ? '' : r[c.d]).trim();
      if (/^total/i.test(d)) break; if (!d) continue;
      lineas.push({ descripcion: d, idCM: c.id >= 0 ? digs(r[c.id]) : '', equivalente: c.eq >= 0 ? String(r[c.eq] == null ? '' : r[c.eq]).trim() : '', presentacion: c.pr >= 0 ? String(r[c.pr] == null ? '' : r[c.pr]).trim() : '', valor: c.v >= 0 ? num(r[c.v]) : 0, cantidad: c.q >= 0 ? num(r[c.q]) : 0, unidad: c.u >= 0 ? String(r[c.u] == null ? '' : r[c.u]).trim() : '', proyecto: c.py >= 0 ? String(r[c.py] == null ? '' : r[c.py]).trim() : '', referencia: c.rf >= 0 ? String(r[c.rf] == null ? '' : r[c.rf]).trim() : '', entregado: c.en >= 0 ? num(r[c.en]) : 0 });
    }
    return { lineas, convenio: c.id >= 0 };
  }
  const totalCentro = (ce) => (ce.lineas || []).reduce((s, l) => s + num(l.valor) * num(l.cantidad), 0);

  /** Puro: filas de la hoja de un centro en el formato de las planillas. */
  function filasHoja(centro, modo, conEntregado) {
    const cv = modo === 'CONVENIO';
    const cab = cv ? ['DESCRIPCIÓN - CARACTERÍSTICAS TÉCNICAS', 'ID CONVENIO MARCO', 'EQUIVALENTE', 'PRESENTACIÓN', 'VALOR', 'CANTIDAD ', 'TOTAL', 'NOMBRE DEL PROYECTO'] : ['DESCRIPCIÓN - CARACTERÍSTICAS TÉCNICAS', 'EQUIVALENTE', 'PRESENTACIÓN', 'VALOR', 'CANTIDAD ', 'UNIDAD O CAJA', 'VALOR + IVA', 'NOMBRE DEL PROYECTO', 'REFERENCIA'];
    if (conEntregado) cab.push('ENTREGADO');
    const filas = [cab];
    (centro.lineas || []).forEach(l => { const f = cv ? [l.descripcion, l.idCM || '', l.equivalente || '', l.presentacion || '', num(l.valor), num(l.cantidad), null, l.proyecto || ''] : [l.descripcion, l.equivalente || '', l.presentacion || '', num(l.valor), num(l.cantidad), l.unidad || '', null, l.proyecto || '', l.referencia || '']; if (conEntregado) f.push(num(l.entregado)); filas.push(f); });
    return filas;
  }

  let lista = [], act = null, ci = 0, stockIdx = null, nombresCat = new Map(), sucio = false;
  const root = () => document.getElementById('dis-root');

  async function cargarStock() {
    const f = fs(), idx = { cod: new Map(), nom: new Map() };
    try {
      const sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(5000)));
      sn.forEach(d => { const x = d.data(); if (x.status === 'CUARENTENA') return; const q = num(x.quantity), central = /central/i.test(String(x.location || ''));
        const add = (m, k) => { if (!k) return; const e = m.get(k) || { central: 0, otras: 0, nombre: x.name, codigo: x.codigoMP || '' }; if (central) e.central += q; else e.otras += q; m.set(k, e); };
        add(idx.cod, digs(x.codigoMP)); add(idx.nom, norm(x.name)); });
    } catch (e) { /* sin lectura */ }
    nombresCat = new Map();
    try { const sn = await f.getDocs(f.query(f.collection(db(), 'Catalogo_Productos'), f.limit(3000))); sn.forEach(d => { const x = d.data(); if (x.insumoName) { if (x.descripcion) nombresCat.set(norm(x.descripcion), norm(x.insumoName)); if (x.codigoMP) nombresCat.set('c' + digs(x.codigoMP), norm(x.insumoName)); } }); } catch (e) { /* sin catálogo */ }
    stockIdx = idx;
  }
  /** Stock de una línea del plan: por ID de Mercado Público, o por nombre (propio, equivalente o el aprendido en el catálogo). */
  function stockDe(l) {
    if (!stockIdx) return null;
    const por = (m, k) => (k && m.get(k)) || null;
    return por(stockIdx.cod, digs(l.idCM)) || por(stockIdx.nom, norm(l.descripcion)) || por(stockIdx.nom, norm(l.equivalente)) || por(stockIdx.nom, nombresCat.get(norm(l.descripcion)) || nombresCat.get('c' + digs(l.idCM))) || null;
  }

  async function cargarLista() {
    const f = fs(); const sn = await f.getDocs(f.query(f.collection(db(), 'Contadores'), f.where('tipo', '==', 'distribucion')));
    lista = []; sn.forEach(d => lista.push({ id: d.id, ...d.data() }));
    lista.sort((a, b) => String(b.creadoEnTxt || '').localeCompare(String(a.creadoEnTxt || '')));
  }
  async function guardar(silencioso) {
    if (!act) return; const f = fs(); act.actualizadoPor = usuario(); act.actualizadoEn = f.serverTimestamp();
    const { id, ...datos } = act; await f.setDoc(f.doc(f.collection(db(), 'Contadores'), id), datos, { merge: false }); sucio = false;
    const i = lista.findIndex(x => x.id === id); if (i >= 0) lista[i] = { ...act }; else lista.unshift({ ...act });
    if (!silencioso) toast('Distribución guardada', act.nombre, 'success');
  }
  const nueva = (nombre, modo, centros) => ({ id: 'distribucion-' + Date.now().toString(36), tipo: 'distribucion', nombre: nombre || 'Distribución', modalidad: modo || 'CONVENIO', referencia: '', estado: 'borrador', centros: centros || [{ nombre: 'CENTRO 1', lineas: [] }], creadoPor: usuario(), creadoEnTxt: new Date().toISOString() });

  function pintarLista() {
    const el = root(); if (!el) return; act = null;
    const vis = lista.filter(d => d.estado !== 'archivada');
    el.innerHTML = `<div class="dis-cab"><div><h2>Distribución a centros</h2><p class="act-hint">Reparte lo comprado entre los centros, descárgalo en Excel para confirmar y entrégalo con las actas.</p></div><div class="dis-acc"><button type="button" class="btn btn-primary" id="dis-nueva"><i class="ph-bold ph-plus"></i> Nueva distribución</button><label class="btn btn-outline" for="dis-imp"><i class="ph-bold ph-upload-simple"></i> Importar Excel</label><input type="file" id="dis-imp" accept=".xlsx,.xls" hidden></div></div>
      ${vis.length ? `<div class="dis-grid">${vis.map(d => `<article class="dis-card" data-id="${esc(d.id)}" tabindex="0" role="button"><b>${esc(d.nombre)}</b><small>${esc((MODOS.find(m => m[0] === d.modalidad) || [])[1] || '')}${d.referencia ? ' · ' + esc(d.referencia) : ''}</small><span>${(d.centros || []).length} centro(s) · ${(d.centros || []).reduce((s, c) => s + (c.lineas || []).length, 0)} línea(s)</span><span class="dis-est">${esc((ESTADOS.find(e => e[0] === d.estado) || [])[1] || '')}</span></article>`).join('')}</div>` : '<p class="act-hint" style="padding:24px 0;">Aún no hay distribuciones. Crea una nueva o importa la planilla Excel de los centros.</p>'}`;
  }
  function stockHTML(l) { const s = stockDe(l), pend = Math.max(0, num(l.cantidad) - num(l.entregado)); return s ? `<b class="${s.central >= pend && pend > 0 ? 'dis-ok' : (s.central > 0 ? 'dis-par' : 'dis-no')}">${s.central}</b><small>en Central${s.otras ? ' · ' + s.otras + ' otras' : ''}</small>` : '<small class="dis-no">sin stock en sistema</small>'; }
  function pintarDetalle() {
    const el = root(); if (!el || !act) return; const cv = act.modalidad === 'CONVENIO', ce = act.centros[ci] || act.centros[0]; if (!ce) return;
    const tot = totalCentro(ce);
    const fila = (l, i) => { return `<tr data-i="${i}"><td><input data-k="descripcion" value="${esc(l.descripcion)}" class="dis-w"></td>${cv ? `<td><input data-k="idCM" value="${esc(l.idCM)}" class="dis-s"></td>` : ''}<td><input data-k="equivalente" value="${esc(l.equivalente)}" class="dis-w"></td><td><input data-k="presentacion" value="${esc(l.presentacion)}" class="dis-m"></td><td><input data-k="valor" type="number" min="0" step="any" value="${num(l.valor)}" class="dis-s"></td><td><input data-k="cantidad" type="number" min="0" step="any" value="${num(l.cantidad)}" class="dis-s"></td>${cv ? '' : `<td><input data-k="unidad" value="${esc(l.unidad)}" class="dis-s"></td>`}<td class="dis-tot">${peso(num(l.valor) * num(l.cantidad))}</td><td><input data-k="proyecto" value="${esc(l.proyecto)}" class="dis-m"></td>${cv ? '' : `<td><input data-k="referencia" value="${esc(l.referencia)}" class="dis-m"></td>`}<td><input data-k="entregado" type="number" min="0" step="any" value="${num(l.entregado)}" class="dis-s"></td><td class="dis-stk">${stockHTML(l)}</td><td><button type="button" class="btn btn-outline btn-sm dis-del" title="Quitar línea" aria-label="Quitar línea">✕</button></td></tr>`; };
    el.innerHTML = `<div class="dis-cab"><button type="button" class="btn btn-outline" id="dis-volver">← Distribuciones</button><div class="dis-acc"><button type="button" class="btn btn-primary" id="dis-guardar"><i class="ph-bold ph-floppy-disk"></i> Guardar</button><button type="button" class="btn btn-outline" id="dis-xls"><i class="ph-bold ph-download-simple"></i> Descargar Excel</button><label class="dis-chk"><input type="checkbox" id="dis-xl-ent"> con columna Entregado</label></div></div>
      <div class="dis-datos"><label>Nombre<input id="dis-nom" value="${esc(act.nombre)}"></label><label>Tipo de compra<select id="dis-mod">${MODOS.map(m => `<option value="${m[0]}"${m[0] === act.modalidad ? ' selected' : ''}>${m[1]}</option>`).join('')}</select></label><label>SDC / Orden de compra<input id="dis-ref" value="${esc(act.referencia)}" placeholder="Ej: 1298355-1122-COT26"></label><label>Estado<select id="dis-est">${ESTADOS.map(e => `<option value="${e[0]}"${e[0] === act.estado ? ' selected' : ''}>${e[1]}</option>`).join('')}</select></label></div>
      <div class="dis-tabs" role="tablist">${act.centros.map((c, i) => `<button type="button" role="tab" class="dis-tab${i === ci ? ' on' : ''}" data-ci="${i}">${esc(c.nombre)}<small>${(c.lineas || []).length}</small></button>`).join('')}<button type="button" class="dis-tab dis-mas" id="dis-addc">+ Centro</button></div>
      <div class="dis-centro-h"><b>${esc(ce.nombre)}</b><button type="button" class="btn btn-outline btn-sm" id="dis-ren">Renombrar</button><button type="button" class="btn btn-outline btn-sm" id="dis-quitc">Quitar centro</button><span class="dis-sp"></span><span>Total: <b id="dis-total">${peso(tot)}</b></span><button type="button" class="btn btn-primary" id="dis-entregar"><i class="ph-bold ph-file-text"></i> Entregar a este centro (acta)</button></div>
      <div class="dis-tw"><table class="bit-tabla dis-t"><thead><tr><th>Descripción</th>${cv ? '<th>ID CM</th>' : ''}<th>Equivalente</th><th>Presentación</th><th>Valor</th><th>Cantidad</th>${cv ? '' : '<th>Unidad / caja</th>'}<th>${cv ? 'Total' : 'Valor + IVA'}</th><th>Proyecto</th>${cv ? '' : '<th>Referencia</th>'}<th>Entregado</th><th>Stock</th><th></th></tr></thead><tbody>${ce.lineas.length ? ce.lineas.map(fila).join('') : '<tr><td colspan="13">Este centro aún no tiene líneas.</td></tr>'}</tbody></table></div>
      <div class="dis-pie"><button type="button" class="btn btn-outline btn-sm" id="dis-addl">+ Agregar línea</button><span class="act-hint">El stock se lee de la Bodega Central: lo que aún no llega aparece «sin stock» hasta que se ingrese la orden de compra.</span></div>`;
  }

  function pedirTexto(titulo, valor) { const v = window.prompt(titulo, valor || ''); return v == null ? null : v.trim(); }
  async function importar(file) {
    if (!window.XLSX) { toast('Excel', 'La librería de Excel aún no carga. Intenta de nuevo en unos segundos.', 'warning'); return; }
    try {
      const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' }); const centros = []; let cv = false;
      wb.SheetNames.forEach(n => { const r = parsearHoja(window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true })); if (r.lineas.length) { centros.push({ nombre: n.trim(), lineas: r.lineas }); if (r.convenio) cv = true; } });
      if (!centros.length) { toast('Importar', 'No encontré líneas en ninguna hoja (se busca la columna «DESCRIPCIÓN»).', 'warning'); return; }
      act = nueva(file.name.replace(/\.xlsx?$/i, '').replace(/[_-]+/g, ' ').trim(), cv ? 'CONVENIO' : 'NO_MARCO', centros); ci = 0; await guardar(true);
      toast('Importado', `${centros.length} centro(s), ${centros.reduce((s, c) => s + c.lineas.length, 0)} línea(s). Revísalo y guárdalo.`, 'success'); pintarDetalle();
    } catch (e) { toast('No se pudo importar', (e && e.message) || String(e), 'error'); }
  }
  function descargar() {
    if (!window.XLSX || !act) return; const XL = window.XLSX, wb = XL.utils.book_new(), cv = act.modalidad === 'CONVENIO', ent = !!(document.getElementById('dis-xl-ent') || {}).checked, usados = new Set();
    act.centros.forEach(c => {
      const filas = filasHoja(c, act.modalidad, ent), n = filas.length - 1, cq = cv ? 'F' : 'E', cvl = cv ? 'E' : 'D', ct = cv ? 'G' : 'G';
      const ws = XL.utils.aoa_to_sheet(filas);
      for (let i = 0; i < n; i++) { const r = i + 2; ws[ct + r] = { t: 'n', f: `${cvl}${r}*${cq}${r}`, v: num(c.lineas[i].valor) * num(c.lineas[i].cantidad), z: '"$"#,##0' }; ws[cvl + r].z = '"$"#,##0'; }
      const tr = n + 3; ws['A' + tr] = { t: 's', v: 'TOTAL' }; ws[ct + tr] = { t: 'n', f: n ? `SUM(${ct}2:${ct}${n + 1})` : '0', v: totalCentro(c), z: '"$"#,##0' };
      const ult = filas[0].length - 1; ws['!ref'] = XL.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: tr - 1, c: ult } });
      ws['!cols'] = filas[0].map((h, k) => ({ wch: k === 0 ? 52 : (k === 1 || k === 2 ? 30 : 16) }));
      let nom = String(c.nombre || 'Centro').replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31).trim() || 'Centro'; let k = 2; const base = nom; while (usados.has(nom.toLowerCase())) nom = base.slice(0, 28) + ' ' + k++; usados.add(nom.toLowerCase());
      XL.utils.book_append_sheet(wb, ws, nom);
    });
    XL.writeFile(wb, `${String(act.nombre || 'distribucion').replace(/[^\w\- ]+/g, '').trim() || 'distribucion'} - ${cv ? 'CONVENIO MARCO' : 'NO MARCO'}.xlsx`);
  }
  function entregar() {
    const ce = act.centros[ci]; if (!ce) return; const A = window.SAR_ActasEntrega; if (!A || !A.precargar) { toast('Actas', 'El módulo de actas no está disponible.', 'warning'); return; }
    const lst = []; ce.lineas.forEach(l => { const pend = Math.max(0, num(l.cantidad) - num(l.entregado)); if (!pend) return; const s = stockDe(l); lst.push({ codigo: digs(l.idCM) || (s && digs(s.codigo)) || '', nombre: (s && s.nombre) || l.descripcion, entregable: pend, pendiente: pend }); });
    if (!lst.length) { toast('Entregar', 'Este centro no tiene cantidades pendientes de entrega.', 'info'); return; }
    guardar(true).catch(() => {}).finally(() => A.precargar(ce.nombre, lst));
  }

  function enlazar() {
    const el = root(); if (!el || el.dataset.ok) return; el.dataset.ok = '1';
    el.addEventListener('click', async (e) => {
      const t = e.target, b = (s) => t.closest(s);
      try {
        if (b('#dis-nueva')) { const n = pedirTexto('Nombre de la distribución (ej: SDC 1122 · insumos de curación):', ''); if (!n) return; const m = window.confirm('¿Es una compra por CONVENIO MARCO?\n\nAceptar = Convenio Marco · Cancelar = No Marco') ? 'CONVENIO' : 'NO_MARCO'; act = nueva(n, m); ci = 0; await guardar(true); pintarDetalle(); }
        else if (b('.dis-card')) { act = JSON.parse(JSON.stringify(lista.find(d => d.id === b('.dis-card').dataset.id))); ci = 0; if (!stockIdx) await cargarStock(); pintarDetalle(); }
        else if (b('#dis-volver')) { if (sucio && !window.confirm('Hay cambios sin guardar. ¿Salir igual?')) return; await cargarLista(); pintarLista(); }
        else if (b('#dis-guardar')) { await guardar(); pintarDetalle(); }
        else if (b('#dis-xls')) descargar();
        else if (b('.dis-tab[data-ci]')) { ci = Number(b('.dis-tab').dataset.ci); pintarDetalle(); }
        else if (b('#dis-addc')) { const n = pedirTexto('Nombre del centro:', ''); if (!n) return; act.centros.push({ nombre: n, lineas: [] }); ci = act.centros.length - 1; sucio = true; pintarDetalle(); }
        else if (b('#dis-ren')) { const n = pedirTexto('Nuevo nombre del centro:', act.centros[ci].nombre); if (!n) return; act.centros[ci].nombre = n; sucio = true; pintarDetalle(); }
        else if (b('#dis-quitc')) { if (act.centros.length < 2) { toast('Centros', 'Debe quedar al menos un centro.', 'warning'); return; } if (!window.confirm(`¿Quitar «${act.centros[ci].nombre}» y sus ${act.centros[ci].lineas.length} línea(s)?`)) return; act.centros.splice(ci, 1); ci = 0; sucio = true; pintarDetalle(); }
        else if (b('#dis-addl')) { act.centros[ci].lineas.push({ descripcion: '', idCM: '', equivalente: '', presentacion: '', valor: 0, cantidad: 0, unidad: '', proyecto: '', referencia: '', entregado: 0 }); sucio = true; pintarDetalle(); }
        else if (b('.dis-del')) { act.centros[ci].lineas.splice(Number(b('tr').dataset.i), 1); sucio = true; pintarDetalle(); }
        else if (b('#dis-entregar')) entregar();
      } catch (err) { toast('Distribución', (err && err.message) || String(err), 'error'); }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'dis-imp' && t.files[0]) { importar(t.files[0]); t.value = ''; return; }
      if (!act) return; sucio = true;
      if (t.id === 'dis-nom') act.nombre = t.value.trim() || act.nombre; else if (t.id === 'dis-ref') act.referencia = t.value.trim();
      else if (t.id === 'dis-mod') { act.modalidad = t.value; pintarDetalle(); } else if (t.id === 'dis-est') act.estado = t.value;
      else if (t.dataset && t.dataset.k) {
        const tr = t.closest('tr'), l = act.centros[ci].lineas[Number(tr.dataset.i)], k = t.dataset.k; l[k] = ['valor', 'cantidad', 'entregado'].includes(k) ? num(t.value) : (k === 'idCM' ? digs(t.value) : t.value.trim());
        const tot = tr.querySelector('.dis-tot'); if (tot) tot.textContent = peso(num(l.valor) * num(l.cantidad));
        const gt = document.getElementById('dis-total'); if (gt) gt.textContent = peso(totalCentro(act.centros[ci]));
        if (['idCM', 'descripcion', 'equivalente', 'cantidad', 'entregado'].includes(k)) { const sc = tr.querySelector('.dis-stk'); if (sc) sc.innerHTML = stockHTML(l); }
      }
    });
    document.querySelectorAll('.menu-item[data-target="view-distribucion-centros"]').forEach(m => m.addEventListener('click', () => setTimeout(abrir, 50)));
    window.addEventListener('beforeunload', (e) => { if (sucio) { e.preventDefault(); e.returnValue = ''; } });
  }
  async function abrir() {
    const el = root(); if (!el) return; enlazar();
    if (act && sucio) { pintarDetalle(); return; }
    el.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando distribuciones…') : 'Cargando…';
    try { await cargarLista(); stockIdx = null; cargarStock().then(() => { if (act) pintarDetalle(); }); pintarLista(); }
    catch (e) { el.innerHTML = '<p class="act-err" style="padding:24px;">No se pudo cargar: ' + esc((e && e.message) || e) + '</p>'; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enlazar); else enlazar();
  if (typeof module !== 'undefined' && module.exports) module.exports = { parsearHoja, filasHoja, totalCentro, num };
  window.SAR_Distribucion = { abrir, parsearHoja, filasHoja };
})(typeof window !== 'undefined' ? window : {}, typeof document !== 'undefined' ? document : { querySelectorAll: () => [], getElementById: () => null, readyState: 'complete', addEventListener() {} });
