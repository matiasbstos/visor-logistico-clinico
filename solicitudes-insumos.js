/* ==========================================================================
   SOLICITUDES DE INSUMOS (v21.189)
   · Quien pide (rol «solicitante» o cualquier usuario): elige la bodega, marca productos de la lista (sin ver stock) o escribe lo que no encuentra, y envía.
     Si no hay internet, queda guardada en el teléfono y se envía sola al volver la conexión.
   · Quien gestiona (bodega): bandeja con las solicitudes, el stock y la ubicación de cada producto, estados, texto para picking y
     «Descargar para usar sin internet».
   Datos (sin reglas nuevas): colección Solicitudes_Ajuste con tipo 'SOLICITUD_INSUMOS' (sin campo `date`, así la pantalla de ajustes no las muestra).
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const COL_ANT = 'Solicitudes_Ajuste', COL = 'Solicitudes_Insumos', TIPO = 'SOLICITUD_INSUMOS', ID_PUB = 'catalogo-publico';
  // Página pública (solicitar.html, sin cuenta): no puede leer el inventario; usa el catálogo público que publica bodega.
  const publica = () => !!window.SAR_SOLICITUD_PUBLICA;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v) || 0;
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || ''; };
  const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
  const rolActual = () => String((document.body && document.body.getAttribute('data-user-role')) || '').toLowerCase();
  const esGestor = () => ['admin', 'superadmin', 'operador'].includes(rolActual());
  const ESTADOS = { NUEVA: 'Nueva', PREPARACION: 'En preparación', LISTA: 'Lista para retirar', ENTREGADA: 'Entregada', ANULADA: 'Anulada' };

  // ---------------- lógica pura ----------------
  /** Código de la solicitud: SI-AAAAMMDD-HHMM-XXX (se calcula en el teléfono, sirve sin internet). */
  function numeroSolicitud(d, azar) { const p = (n) => String(n).padStart(2, '0'); return `SI-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${String(azar || Math.floor(Math.random() * 1000)).padStart(3, '0')}`; }
  /** Agrega o suma una línea; las líneas manuales se juntan por nombre. */
  function agregarLinea(lineas, n) { const k = norm(n.nombre); if (!k) return lineas; const x = lineas.find(l => norm(l.nombre) === k && !!l.manual === !!n.manual); if (x) x.cantidad += Math.max(1, Math.floor(num(n.cantidad) || 1)); else lineas.push({ nombre: String(n.nombre).trim(), cantidad: Math.max(1, Math.floor(num(n.cantidad) || 1)), manual: !!n.manual }); return lineas; }
  /** Texto para pegar en WhatsApp / picking. */
  function textoPicking(s, info) {
    const L = (s.lineas || []).map((l, i) => { const x = info && info[i]; return `${i + 1}. ${l.nombre} × ${l.cantidad}${x && x.ubicacion ? ` · ${x.ubicacion}` : ''}${x && x.stock != null ? ` (hay ${x.stock})` : ''}`; });
    return `Solicitud ${s.correlativo || s.numero} · ${s.bodega || ''}\nPide: ${s.solicitante || s.requester}${s.correo ? ' <' + s.correo + '>' : ''}${s.servicio ? ' (' + s.servicio + ')' : ''}\n${L.join('\n')}${s.nota ? '\nNota: ' + s.nota : ''}`;
  }
  /** Stock y ubicación de una línea a partir de los insumos leídos: coincide por id o por nombre. */
  function infoLinea(l, insumos, bodega) {
    const k = norm(l.nombre), docs = insumos.filter(i => (l.insumoId && i.id === l.insumoId) || norm(i.name) === k);
    if (!docs.length) return { stock: null, ubicacion: '', otras: [] };
    const enBod = docs.filter(d => !bodega || d.location === bodega), pool = enBod.length ? enBod : docs;
    const otras = [...new Set(docs.filter(d => num(d.quantity) > 0 && d.location !== bodega).map(d => `${d.location}: ${num(d.quantity)}`))];
    const est = (pool.find(d => d.ubicacionEstante) || {}).ubicacionEstante;
    return { stock: pool.reduce((t, d) => t + num(d.quantity), 0), ubicacion: [pool[0].location, est].filter(Boolean).join(' · '), otras };
  }

  // ---------------- datos ----------------
  let insumos = [], bodegas = [], cargado = false;
  async function cargarBase() {
    if (publica()) {
      const f = fs(), d = await f.getDoc(f.doc(f.collection(db(), COL), ID_PUB)); if (!d.exists()) throw new Error('Bodega aún no publica la lista de productos.');
      const x = d.data(); bodegas = x.bodegas || []; insumos = []; Object.keys(x.productos || {}).forEach(b => (x.productos[b] || []).forEach(p => insumos.push({ id: p.i || '', name: p.n, location: b, codigoMP: p.c || '' })));
      if (window.SAR_Imagenes && window.SAR_Imagenes.sumarIndice && x.fotos) window.SAR_Imagenes.sumarIndice(x.fotos);
      cargado = true; return;
    }
    const f = fs(), a = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(3000))), l = []; a.forEach(d => l.push({ id: d.id, ...d.data() })); insumos = l;
    try { const b = await f.getDocs(f.collection(db(), 'Bodegas')), n = []; b.forEach(d => n.push((d.data().nombre || d.data().name || d.id))); bodegas = n.filter(Boolean).sort(); } catch (e) { bodegas = []; }
    if (!bodegas.length) bodegas = [...new Set(insumos.map(i => i.location).filter(Boolean))].sort();
    cargado = true;
  }
  const listaDe = (bodega) => { const m = new Map(); insumos.filter(i => i.location === bodega && i.status !== 'CUARENTENA').forEach(i => { const k = norm(i.name); if (k && !m.has(k)) m.set(k, { nombre: i.name, id: i.id, codigo: i.codigoMP || '' }); }); return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')); };

  // ---------------- catálogo público para quien pide ----------------
  // Quien pide sin cuenta no puede leer Insumos ni el Catálogo. Al abrir la bandeja (cada 6 h) o «Descargar para usar sin internet»,
  // bodega publica en Solicitudes_Insumos/catalogo-publico: bodegas, nombres de productos por bodega (SIN stock) y fotos confirmadas.
  async function publicarCatalogo(forzar) {
    try { const ult = Number(localStorage.getItem('si-pub') || 0); if (!forzar && Date.now() - ult < 6 * 3600e3) return; } catch (e) { /* sigue */ }
    const f = fs(); if (!cargado) await cargarBase();
    const c = {}, n = {};
    try { const sn = await f.getDocs(f.query(f.collection(db(), 'Catalogo_Productos'), f.limit(3000)));
      sn.forEach(d => { const x = d.data(); if (x.fotoEstado === 'por_confirmar' || x.fotoEstado === 'descartada') return;
        const url = /^https?:/.test(x.imagen || '') ? x.imagen : '', arch = x.imagenMP || ''; if (!url && !arch) return;
        if (x.codigoMP && arch) c[String(x.codigoMP)] = arch;
        [x.descripcion, x.insumoName].forEach(t => { const k = norm(t); if (k) n[k] = url ? { i: url } : { a: arch }; }); }); } catch (e) { /* sin fotos */ }
    const productos = {}; bodegas.forEach(b => { const l = listaDe(b); if (l.length) productos[b] = l.map(p => ({ n: p.nombre, i: p.id, ...(p.codigo ? { c: String(p.codigo) } : {}) })); });
    await f.setDoc(f.doc(f.collection(db(), COL), ID_PUB), { tipo: 'CATALOGO_PUBLICO', bodegas: Object.keys(productos).sort(), productos, fotos: { c, n }, actualizado: new Date().toISOString() });
    try { localStorage.setItem('si-pub', String(Date.now())); } catch (e) { /* sin almacenamiento */ }
  }

  // ---------------- pantalla de quien pide ----------------
  let bodegaSel = '', lineas = [], busca = '', form = { solicitante: '', correo: '', servicio: '', nota: '' }, enviando = false, editando = null, misDatos = {};
  const rootPide = () => document.getElementById('si-pide');
  function pintarPide() {
    const r = rootPide(); if (!r) return;
    const lista = bodegaSel ? listaDe(bodegaSel) : [], q = norm(busca), vis = q ? lista.filter(x => norm(x.nombre).includes(q)).slice(0, 40) : lista.slice(0, 40);
    r.innerHTML = `<div class="si-wrap">
      ${editando ? `<div class="si-edit"><span>Modificando <b>${esc(editando.ver)}</b>: agrega, quita o cambia cantidades y guarda.</span><button type="button" class="btn btn-secondary btn-sm" id="si-edit-x">Cancelar</button></div>` : ''}
      <h2 class="si-t">Solicitud de insumos</h2><p class="si-s">Elige la bodega, marca lo que necesitas y envía. Bodega confirmará lo que hay.</p>
      <label class="si-l">¿A qué bodega le pides?<select id="si-bod" class="si-in"${editando ? ' disabled' : ''}><option value="">— Elegir —</option>${bodegas.map(b => `<option value="${esc(b)}"${b === bodegaSel ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select></label>
      <div class="si-dos"><label class="si-l">Tu nombre<input id="si-nom" class="si-in" value="${esc(form.solicitante)}" placeholder="Nombre y apellido" autocomplete="name"></label><label class="si-l">Tu correo<input id="si-cor" class="si-in" type="email" value="${esc(form.correo)}" placeholder="nombre@cormumel.cl" autocomplete="email" inputmode="email"></label></div>
      <div class="si-dos"><label class="si-l">Servicio / unidad<input id="si-ser" class="si-in" value="${esc(form.servicio)}" placeholder="Ej: Box 3, Urgencia"></label><span></span></div>
      ${bodegaSel ? `<label class="si-l">Buscar en la lista de la bodega<input id="si-bus" class="si-in" value="${esc(busca)}" placeholder="Escribe parte del nombre…" autocomplete="off"></label>
      <div class="si-lista">${vis.map(x => `<button type="button" class="si-p" data-add="${esc(x.nombre)}" data-id="${esc(x.id)}">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(x.nombre, { codigo: x.codigo }) : ''}<span>${esc(x.nombre)}</span><b>+</b></button>`).join('') || '<p class="si-v">No hay coincidencias: escríbelo abajo.</p>'}${lista.length > vis.length && !q ? `<p class="si-v">Mostrando ${vis.length} de ${lista.length}: usa el buscador.</p>` : ''}</div>` : ''}
      <div class="si-man"><input id="si-mt" class="si-in" placeholder="¿No está? Escribe el producto" ><input id="si-mc" class="si-in si-cn" type="number" min="1" value="1" inputmode="numeric"><button type="button" class="btn btn-secondary" id="si-ma">Agregar</button></div>
      <h3 class="si-h">Tu solicitud (${lineas.length})</h3>
      <div class="si-car">${lineas.map((l, i) => `<div class="si-fila"><span class="si-fn">${esc(l.nombre)}${l.manual ? ' <em>escrito a mano</em>' : ''}</span><span class="si-q"><button type="button" data-m="${i}">−</button><b>${l.cantidad}</b><button type="button" data-p="${i}">+</button></span><button type="button" class="si-x" data-x="${i}" aria-label="Quitar">✕</button></div>`).join('') || '<p class="si-v">Aún no agregas nada.</p>'}</div>
      <label class="si-l">Nota (opcional)<input id="si-not" class="si-in" value="${esc(form.nota)}" placeholder="Ej: urgente para hoy"></label>
      <button type="button" class="btn btn-primary si-env" id="si-env"${enviando ? ' disabled' : ''}>${editando ? 'Guardar cambios' : 'Enviar solicitud'}</button>
      <p class="si-v" id="si-red"></p><div id="si-mias"></div></div>`;
    estadoRed(); if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(r); pintarMias();
  }
  /** Las últimas solicitudes hechas desde este teléfono y en qué estado van (bodega las va moviendo). */
  async function pintarMias() {
    const el = document.getElementById('si-mias'); if (!el) return; let l = [];
    try { l = JSON.parse(localStorage.getItem('si-mias') || '[]'); } catch (e) { l = []; } if (!l.length) { el.innerHTML = ''; return; }
    const f = fs(); misDatos = {}; const filas = await Promise.all(l.slice(0, 6).map(async (n) => { try { let d = await f.getDoc(f.doc(f.collection(db(), COL), n)); if (!d.exists() && !publica()) d = await f.getDoc(f.doc(f.collection(db(), COL_ANT), n)).catch(() => d); if (d.exists()) { const x = { ...d.data(), _col: d.ref && d.ref.parent ? d.ref.parent.id : COL }; misDatos[n] = x; return x; } return { numero: n, estado: 'POR_ENVIAR' }; } catch (e) { return { numero: n, estado: 'POR_ENVIAR' }; } }));
    el.innerHTML = `<div class="si-cab"><h3 class="si-h">Tus últimas solicitudes</h3><button type="button" class="btn btn-secondary btn-sm" id="si-mias-act">Actualizar</button></div><div class="si-car">${filas.map((x, k) => `<details class="si-mia"${k === 0 ? ' open' : ''}><summary><span class="si-fn"><b>${esc(x.correlativo || x.numero)}</b>${x.correlativo ? '' : ' <small>(provisional)</small>'}<br><small>${esc(x.bodega || '')}${x.creadoEn ? ' · ' + esc(new Date(x.creadoEn).toLocaleString('es-CL')) : ''}</small></span><span class="si-est si-e-${esc(x.estado)}">${esc(x.estado === 'POR_ENVIAR' ? 'Por enviar (sin internet)' : (ESTADOS[x.estado] || x.estado))}</span></summary>
      ${(x.lineas || []).map(l => `<div class="si-mia-l"><span>${esc(l.nombre)} × ${l.cantidad}</span>${chipL(l)}</div>`).join('')}${x.estado === 'NUEVA' && misDatos[x.numero] ? `<div class="si-lb"><small>Mientras bodega no empiece a prepararla puedes cambiarla.</small><button type="button" class="btn btn-primary btn-sm" data-mod="${esc(x.numero)}">Modificar</button></div>` : ''}</details>`).join('')}</div>`;
    el.querySelectorAll('[data-mod]').forEach(b => b.onclick = () => editar(b.dataset.mod));
    const ac = document.getElementById('si-mias-act'); if (ac) ac.onclick = () => pintarMias();
  }
  /** Carga una solicitud propia (aún «Nueva») en el formulario para cambiarla. */
  function editar(n) {
    const x = misDatos[n]; if (!x || x.estado !== 'NUEVA') { toast('Solicitud', 'Bodega ya empezó a prepararla: no se puede cambiar.', 'warning'); return; }
    editando = { numero: n, col: x._col || COL, ver: x.correlativo || n, historial: x.historial || [] };
    bodegaSel = x.bodega || ''; lineas = (x.lineas || []).map(l => ({ nombre: l.nombre, cantidad: l.cantidad, manual: !!l.manual, ...(l.insumoId ? { insumoId: l.insumoId } : {}) }));
    form.nota = x.nota || ''; form.servicio = x.servicio || form.servicio; busca = ''; pintarPide(); window.scrollTo && window.scrollTo(0, 0);
  }
  function estadoRed() { const e = document.getElementById('si-red'); if (e) e.textContent = navigator.onLine === false ? 'Sin internet: se guardará en este teléfono y se enviará sola al volver la conexión.' : ''; }
  function leerCampos() { const g = (id) => { const e = document.getElementById(id); return e ? e.value : null; }; const n = g('si-nom'), s = g('si-ser'), o = g('si-not'), c = g('si-cor'); if (c !== null) form.correo = c; if (n !== null) form.solicitante = n; if (s !== null) form.servicio = s; if (o !== null) form.nota = o; }
  async function enviar() {
    leerCampos();
    if (!bodegaSel) { toast('Solicitud', 'Elige la bodega a la que le pides.', 'warning'); return; }
    if (!lineas.length) { toast('Solicitud', 'Agrega al menos un producto.', 'warning'); return; }
    if (!form.solicitante.trim()) { toast('Solicitud', 'Escribe tu nombre.', 'warning'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.correo.trim())) { toast('Solicitud', 'Escribe tu correo (ej: nombre@cormumel.cl).', 'warning'); return; }
    try { localStorage.setItem('si-yo', JSON.stringify({ n: form.solicitante.trim(), c: form.correo.trim(), s: form.servicio.trim() })); } catch (e) { /* sin almacenamiento */ }
    enviando = true; pintarPide();
    if (editando) {   // guardar cambios de una solicitud propia aún «Nueva»
      const f = fs(), ed = editando, cambios = { lineas: lineas.map(l => ({ ...l })), nota: form.nota.trim(), servicio: form.servicio.trim(), solicitante: form.solicitante.trim(), correo: form.correo.trim().toLowerCase(), editadoEn: new Date().toISOString(), historial: ed.historial.concat([{ estado: 'MODIFICADA', por: form.correo.trim().toLowerCase(), en: new Date().toISOString() }]) };
      const p = f.updateDoc(f.doc(f.collection(db(), ed.col), ed.numero), cambios);
      const r = await Promise.race([p.then(() => 'ok'), new Promise(res => setTimeout(() => res('cola'), 2500))]).catch(e => 'error:' + (e.message || e));
      enviando = false;
      if (String(r).startsWith('error')) { toast('No se guardó', /permission/i.test(r) ? 'Bodega ya empezó a prepararla: no se puede cambiar.' : String(r).slice(6), 'error'); pintarPide(); return; }
      p.catch(() => {}); editando = null; lineas = []; busca = ''; form.nota = ''; bodegaSel = ''; pintarPide();
      if (window.SAR_Progreso && window.SAR_Progreso.exito) window.SAR_Progreso.exito({ titulo: r === 'ok' ? 'Cambios guardados' : 'Guardado en el teléfono', texto: esc(ed.ver) + (r === 'ok' ? '' : '<br>Se enviará solo al volver internet.') });
      return;
    }
    const ahora = new Date(), numero = numeroSolicitud(ahora), f = fs();
    const au = window.firebaseAuth && window.firebaseAuth.currentUser, data = { tipo: TIPO, numero, estado: 'NUEVA', uid: (au && au.uid) || '', requester: (au && au.email) || form.correo.trim().toLowerCase(), solicitante: form.solicitante.trim(), correo: form.correo.trim().toLowerCase(), servicio: form.servicio.trim(), bodega: bodegaSel, nota: form.nota.trim(), lineas: lineas.map(l => ({ ...l })), creadoEn: ahora.toISOString(), historial: [{ estado: 'NUEVA', por: usuario(), en: ahora.toISOString() }] };
    const p = f.setDoc(f.doc(f.collection(db(), COL), numero), data);
    const r = await Promise.race([p.then(() => 'ok'), new Promise(res => setTimeout(() => res('cola'), 2500))]).catch(e => 'error:' + (e.message || e));
    enviando = false;
    if (String(r).startsWith('error')) { toast('No se envió', String(r).slice(6) || 'Revisa tu conexión e intenta de nuevo.', 'error'); pintarPide(); return; }
    p.catch(() => { /* se reintenta sola al volver internet */ });
    try { const m = JSON.parse(localStorage.getItem('si-mias') || '[]'); m.unshift(numero); localStorage.setItem('si-mias', JSON.stringify(m.slice(0, 20))); } catch (e) { /* sin almacenamiento */ }
    lineas = []; busca = ''; form.nota = ''; bodegaSel = ''; pintarPide();
    if (window.SAR_Progreso && window.SAR_Progreso.exito) window.SAR_Progreso.exito({ titulo: r === 'ok' ? 'Solicitud enviada' : 'Guardada en el teléfono', texto: r === 'ok' ? 'Bodega ya la puede ver. Abajo verás cómo avanza.' : 'Se enviará sola cuando haya internet.' });
    const r2 = rootPide(); if (r2) r2.insertAdjacentHTML('afterbegin', `<div class="si-ok"><b>${r === 'ok' ? 'Solicitud enviada' : 'Solicitud guardada en el teléfono'}</b><br>${numero}${r === 'ok' ? '' : ' · se enviará sola cuando haya internet.'}</div>`);
    window.scrollTo && window.scrollTo(0, 0);
  }
  function enlazarPide() {
    const r = rootPide(); if (!r || r.dataset.ok) return; r.dataset.ok = '1';
    r.addEventListener('change', (e) => { if (e.target.id === 'si-bod') { leerCampos(); bodegaSel = e.target.value; busca = ''; pintarPide(); } });
    r.addEventListener('input', (e) => { if (e.target.id === 'si-bus') { busca = e.target.value; const p = e.target.selectionStart; leerCampos(); pintarPide(); const b = document.getElementById('si-bus'); if (b) { b.focus(); b.setSelectionRange(p, p); } } });
    r.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; leerCampos();
      if (b.dataset.add) { agregarLinea(lineas, { nombre: b.dataset.add, cantidad: 1 }); if (lineas.length) { const l = lineas.find(x => norm(x.nombre) === norm(b.dataset.add)); if (l && b.dataset.id) l.insumoId = b.dataset.id; } pintarPide(); }
      else if (b.id === 'si-ma') { const t = document.getElementById('si-mt'), c = document.getElementById('si-mc'); if (t && t.value.trim()) { agregarLinea(lineas, { nombre: t.value, cantidad: c ? c.value : 1, manual: true }); pintarPide(); } }
      else if (b.dataset.p !== undefined) { lineas[+b.dataset.p].cantidad++; pintarPide(); }
      else if (b.dataset.m !== undefined) { const l = lineas[+b.dataset.m]; l.cantidad = Math.max(1, l.cantidad - 1); pintarPide(); }
      else if (b.dataset.x !== undefined) { lineas.splice(+b.dataset.x, 1); pintarPide(); }
      else if (b.id === 'si-env') enviar();
      else if (b.id === 'si-edit-x') { editando = null; lineas = []; bodegaSel = ''; form.nota = ''; pintarPide(); }
    });
    window.addEventListener('online', () => { estadoRed(); if (publica()) { cargado = false; cargarBase().then(pintarPide).catch(() => {}); } });   // al volver internet: lista y estados al día
    window.addEventListener('offline', estadoRed);
  }
  async function abrirPide() {
    const r = rootPide(); if (!r) return; enlazarPide();
    try { const y = JSON.parse(localStorage.getItem('si-yo') || 'null'); if (y && !form.solicitante) { form.solicitante = y.n || ''; form.correo = y.c || ''; form.servicio = y.s || ''; } } catch (e) { /* sin almacenamiento */ }
    if (window.SAR_Imagenes && !publica()) window.SAR_Imagenes.cargar().catch(() => {});
    if (!cargado) { r.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando la lista de productos…') : 'Cargando…'; try { await cargarBase(); } catch (e) { r.innerHTML = '<div class="home-empty">No pude cargar la lista. Si no tienes internet, ábrela una vez con conexión para dejarla guardada.</div>'; return; } }
    pintarPide();
  }

  // ---------------- correlativo SOL-AAAA-NNNN ----------------
  // Quien pide no puede numerar (no accede a Contadores): el número oficial lo pone bodega al recibirla, en orden de llegada.
  let asignando = false;
  async function asignarCorrelativos() {
    if (asignando) return; const sin = solicitudes.filter(x => !x.correlativo && x._col === COL).sort((a, b) => String(a.creadoEn).localeCompare(String(b.creadoEn))); if (!sin.length) return;
    asignando = true; const f = fs();
    try {
      for (const x of sin) {
        const anio = new Date(x.creadoEn || Date.now()).getFullYear(), refC = f.doc(f.collection(db(), 'Contadores'), 'correlativo-solicitudes-' + anio), refS = f.doc(f.collection(db(), COL), x.numero);
        await f.runTransaction(db(), async (tx) => { const s1 = await tx.get(refS); if (!s1.exists() || s1.data().correlativo) return; const c = await tx.get(refC), v = (c.exists() ? num(c.data().valor) : 0) + 1;
          tx.set(refC, { valor: v, actualizado: new Date().toISOString() }); tx.update(refS, { correlativo: `SOL-${anio}-${String(v).padStart(4, '0')}` }); });
      }
    } catch (e) { console.warn('[Solicitudes] correlativo pendiente:', e && e.message); }
    finally { asignando = false; }
  }

  // ---------------- bandeja de bodega ----------------
  let solicitudes = [], desuscribir = null, filtro = 'ABIERTAS';
  const rootBandeja = () => document.getElementById('si-bandeja');
  // ---- checklist por producto: lotes candidatos (bodega · estante · lote · vence) y reparto FEFO ----
  const lotesDeDoc = (d) => (Array.isArray(d.batches) && d.batches.length ? d.batches : (num(d.quantity) > 0 ? [{ batch: d.batch || 'S/L', quantity: num(d.quantity), expirationDate: d.expirationDate || '' }] : []));
  /** Lotes con saldo de este producto en cualquier bodega. Primero la bodega a la que se pidió (no hay que mover), luego lo que vence antes. */
  function lotesCandidatos(l, lista, bodegaPedida) {
    const k = norm(l.nombre), out = [];
    lista.filter(i => ((l.insumoId && i.id === l.insumoId) || norm(i.name) === k) && i.status !== 'CUARENTENA').forEach(i => lotesDeDoc(i).forEach(b => { const disp = num(b.quantity); if (disp > 0) out.push({ insumoId: i.id, bodega: i.location || '', estante: i.ubicacionEstante || '', clave: String(b.batch || 'S/L') + '|' + String(b.expirationDate || ''), lote: b.batch || 'S/L', vence: b.expirationDate || '', disp }); }));
    return out.sort((a, b) => ((a.bodega === bodegaPedida ? 0 : 1) - (b.bodega === bodegaPedida ? 0 : 1)) || (a.vence || '9999').localeCompare(b.vence || '9999'));
  }
  /** Reparte lo pedido entre los lotes en ese orden. Devuelve [cantidad por lote]. */
  function repartir(cands, pide) { let falta = Math.max(0, num(pide)); return cands.map(c => { const q = Math.min(c.disp, falta); falta -= q; return q; }); }
  /** Estado de una línea según lo que bodega confirmó. */
  function estadoLinea(pide, entregar, noHay) { if (noHay) return 'no_hay'; const e = num(entregar); return e <= 0 ? 'pendiente' : e >= num(pide) ? 'ok' : 'parcial'; }
  const EST_L = { pendiente: 'Pendiente', ok: 'Confirmado', parcial: 'Parcial', no_hay: 'No hay' };
  const chipL = (l) => { const e = l.estado || 'pendiente'; return `<span class="si-le si-le-${e}">${e === 'ok' ? '✔ ' + num(l.entregar) + ' confirmado' + (num(l.entregar) === 1 ? '' : 's') : e === 'parcial' ? `Parcial: ${num(l.entregar)} de ${l.cantidad}` : EST_L[e]}</span>`; };
  const fmtV = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : (v || '—'); };
  let abiertoL = {};   // numero|i → mostrar lotes aunque ya esté decidida

  function pintarBandeja() {
    const r = rootBandeja(); if (!r) return;
    const ab = (s) => s.estado !== 'ENTREGADA' && s.estado !== 'ANULADA', vis = solicitudes.filter(s => filtro === 'TODAS' ? true : filtro === 'ABIERTAS' ? ab(s) : s.estado === filtro);
    const IM = window.SAR_Imagenes;
    r.innerHTML = `<div class="si-wrap si-ancho"><div class="si-cab"><div><h2 class="si-t">Solicitudes de insumos</h2><p class="si-s">Revisa cada producto: foto, dónde hay y de qué lote sacar. Confirma o marca «No hay»; quien pidió lo ve en su teléfono.</p></div>
      <div class="si-acc"><select id="si-fil" class="si-in">${[['ABIERTAS', 'Abiertas'], ['NUEVA', 'Nuevas'], ['PREPARACION', 'En preparación'], ['LISTA', 'Listas'], ['ENTREGADA', 'Entregadas'], ['TODAS', 'Todas']].map(([v, t]) => `<option value="${v}"${v === filtro ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <button type="button" class="btn btn-secondary" id="si-off" title="Guarda en el teléfono el inventario y las solicitudes para trabajar sin internet">Descargar para usar sin internet</button></div></div><p class="si-v" id="si-offm">${esc(localStorage.getItem('si-off') ? 'Última descarga: ' + new Date(localStorage.getItem('si-off')).toLocaleString('es-CL') : '')}</p>
      ${vis.map(s => { const mover = (s.lineas || []).some(l => !l.movido && (l.seleccion || []).some(x => x.bodega !== s.bodega && x.qty > 0));
        return `<article class="si-card" data-n="${esc(s.numero)}"><header><b>${esc(s.correlativo || s.numero)}</b>${s.correlativo ? '' : ' <small>(asignando N°…)</small>'}<span class="si-est si-e-${esc(s.estado)}">${esc(ESTADOS[s.estado] || s.estado)}</span></header>
        <p class="si-m">${esc(s.solicitante || s.requester)}${s.correo ? ` (<a href="mailto:${esc(s.correo)}">${esc(s.correo)}</a>)` : ''}${s.servicio ? ' · ' + esc(s.servicio) : ''} · pide a <b>${esc(s.bodega)}</b> · ${esc(new Date(s.creadoEn).toLocaleString('es-CL'))}</p>
        ${s.nota ? `<p class="si-m">Nota: ${esc(s.nota)}</p>` : ''}
        <div class="si-lns">${(s.lineas || []).map((l, i) => { const cands = lotesCandidatos(l, insumos, s.bodega), decid = l.estado && l.estado !== 'pendiente', ver = !decid || abiertoL[s.numero + '|' + i] || !ab(s) && false;
          const pre = (l.seleccion && l.seleccion.length) ? cands.map(c => { const x = l.seleccion.find(y => y.insumoId === c.insumoId && y.clave === c.clave); return x ? x.qty : 0; }) : repartir(cands, l.cantidad), hay = cands.reduce((t, c) => t + c.disp, 0);
          return `<div class="si-ln${decid ? ' si-ln--ok' : ''}" data-i="${i}"><div class="si-lh">${IM ? IM.thumb(l.nombre, { codigo: (insumos.find(x => x.id === l.insumoId) || {}).codigoMP || '' }) : ''}<div class="si-ln-t"><b>${esc(l.nombre)}</b>${l.manual ? ' <em>escrito a mano</em>' : ''}<small>Pide <b>${l.cantidad}</b> · hay ${hay} en total${l.movido ? ' · traído a ' + esc(s.bodega) : ''}</small></div>${chipL(l)}</div>
            ${ab(s) && ver ? (cands.length ? `<table class="si-tb si-lt"><thead><tr><th>Dónde</th><th>Lote</th><th>Vence</th><th>Hay</th><th>Sacar</th></tr></thead><tbody>${cands.map((c, j) => `<tr><td>${esc(c.bodega)}${c.estante ? ' · ' + esc(c.estante) : ''}${c.bodega !== s.bodega ? ' <small class="si-mv">hay que traer</small>' : ''}</td><td>${esc(c.lote)}</td><td>${esc(fmtV(c.vence))}</td><td>${c.disp}</td><td><input type="number" min="0" max="${c.disp}" value="${pre[j]}" class="si-q-in" data-j="${j}" inputmode="numeric" aria-label="Cantidad a sacar del lote ${esc(c.lote)}"></td></tr>`).join('')}</tbody></table>` : '<p class="si-v">No está en el inventario.</p>')
              + `<div class="si-lb"><button type="button" class="btn btn-primary btn-sm" data-ok="${i}"${cands.length ? '' : ' disabled'}>Confirmar</button><button type="button" class="btn btn-secondary btn-sm" data-nh="${i}">No hay</button></div>`
              : (ab(s) ? `<div class="si-lb"><small>${(l.seleccion || []).filter(x => x.qty > 0).map(x => `${esc(x.lote)} · ${esc(x.bodega)}: ${x.qty}`).join(' · ')}</small><button type="button" class="btn btn-secondary btn-sm" data-ver="${i}">Cambiar</button></div>` : '')}</div>`; }).join('')}</div>
        <footer>${mover && ab(s) ? `<button class="btn btn-primary" data-mv="1">Traer lo elegido a ${esc(s.bodega)}</button>` : ''}${s.estado === 'LISTA' ? '<button class="btn btn-primary" data-e="ENTREGADA">Marcar entregada</button>' : ''}${s.estado === 'PREPARACION' ? '<button class="btn btn-secondary" data-e="LISTA">Lista para retirar</button>' : ''}<button class="btn btn-secondary" data-c="1">Copiar para WhatsApp</button>${ab(s) ? '<button class="btn btn-secondary" data-e="ANULADA">Anular</button>' : ''}</footer></article>`; }).join('') || '<div class="home-empty">No hay solicitudes en este filtro.</div>'}</div>`;
    if (IM) IM.rellenar(r);
  }
  /** Guarda el resultado de una línea (y pasa la solicitud a «En preparación» o «Lista» según corresponda). */
  async function decidirLinea(n, i, noHay, cards) {
    const f = fs(), s = solicitudes.find(x => x.numero === n); if (!s) return; const lin = (s.lineas || []).map(x => ({ ...x }));
    const l = lin[i], cands = lotesCandidatos(l, insumos, s.bodega);
    const qs = cards ? [...cards.querySelectorAll('.si-q-in')].map(x => Math.max(0, Math.floor(num(x.value)))) : [];
    const mal = cands.find((c, j) => qs[j] > c.disp); if (mal) { toast('Cantidad', `El lote ${mal.lote} solo tiene ${mal.disp}.`, 'warning'); return; }
    const sel = noHay ? [] : cands.map((c, j) => ({ insumoId: c.insumoId, bodega: c.bodega, clave: c.clave, lote: c.lote, vence: c.vence, qty: qs[j] || 0 })).filter(x => x.qty > 0);
    const entregar = sel.reduce((t, x) => t + x.qty, 0);
    if (!noHay && entregar <= 0) { toast('Solicitud', 'Indica cuánto sacar de algún lote, o marca «No hay».', 'warning'); return; }
    lin[i] = { ...l, estado: estadoLinea(l.cantidad, entregar, noHay), entregar, seleccion: sel, movido: false, revisadoPor: usuario(), revisadoEn: new Date().toISOString() };
    const todas = lin.every(x => x.estado && x.estado !== 'pendiente'), est = todas ? (lin.some(x => x.estado === 'ok' || x.estado === 'parcial') ? 'LISTA' : s.estado) : (s.estado === 'NUEVA' ? 'PREPARACION' : s.estado);
    const cambios = { lineas: lin }; if (est !== s.estado) { cambios.estado = est; cambios.historial = (s.historial || []).concat([{ estado: est, por: usuario(), en: new Date().toISOString() }]); }
    delete abiertoL[n + '|' + i];
    Object.assign(s, cambios); pintarBandeja();
    try { await Promise.race([f.updateDoc(f.doc(f.collection(db(), s._col || COL), n), cambios), new Promise(res => setTimeout(res, 2500))]); }
    catch (e) { toast('No se pudo guardar', e.message || String(e), 'error'); }
  }
  /** Trae a la bodega pedida lo elegido de otras bodegas (transferencia normal; sin internet queda en la cola). */
  async function traer(n) {
    const s = solicitudes.find(x => x.numero === n); if (!s || !window.SAR_Traspaso) return;
    const mov = []; (s.lineas || []).forEach((l, i) => { if (l.movido) return; const g = {}; (l.seleccion || []).filter(x => x.bodega !== s.bodega && x.qty > 0).forEach(x => { const k = x.insumoId + '|' + x.bodega; (g[k] = g[k] || { i, nombre: l.nombre, id: x.insumoId, desde: x.bodega, lotes: [] }).lotes.push({ clave: x.clave, qty: x.qty }); }); Object.values(g).forEach(m => mov.push(m)); });
    if (!mov.length) return;
    const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: `¿Traer a ${s.bodega}?`, texto: `Para la solicitud <b>${esc(n)}</b>:`, lineas: mov.map(m => `${esc(m.nombre)} · <b>${m.lotes.reduce((t, x) => t + x.qty, 0)}</b> u. desde ${esc(m.desde)}`), si: 'Traer' }) : confirm('¿Traer lo elegido?');
    if (!ok) return;
    const nota = `Solicitud ${n}`, enLinea = !window.SAR_Cola || await window.SAR_Cola.hayConexion(), hechos = new Set(), prog = enLinea && P ? P.iniciar('Trayendo productos…', []) : null; let mal = 0;
    for (const [k, m] of mov.entries()) {
      if (prog) prog.paso(`${k + 1} de ${mov.length}: ${m.nombre}`);
      try { if (enLinea) await window.SAR_Traspaso.moverUno(m.id, m.desde, s.bodega, m.lotes, nota); else window.SAR_Cola.encolar({ tipo: 'traspaso', titulo: `Mover ${m.lotes.reduce((t, x) => t + x.qty, 0)} · ${m.nombre}: ${m.desde} → ${s.bodega}`, datos: { id: m.id, desde: m.desde, hasta: s.bodega, lotes: m.lotes, nota, en: Date.now() } }); hechos.add(m.i); }
      catch (e) { mal++; toast('No se movió', `${m.nombre}: ${e.message || e}`, 'error'); }
    }
    if (prog) { if (mal && !hechos.size) prog.error(); else prog.listo(`${hechos.size} producto(s) traídos a ${s.bodega}`, { aviso: false }); }
    if (!enLinea) toast('Guardado sin conexión', 'Los movimientos se aplicarán solos al volver internet.', 'warning');
    const lin = (s.lineas || []).map((l, i) => hechos.has(i) ? { ...l, movido: true } : l); s.lineas = lin; pintarBandeja();
    const f = fs(); try { await Promise.race([f.updateDoc(f.doc(f.collection(db(), s._col || COL), n), { lineas: lin }), new Promise(res => setTimeout(res, 2500))]); } catch (e) { /* queda en pantalla */ }
    if (enLinea) { try { await cargarBase(); pintarBandeja(); } catch (e) { /* sigue */ } }
  }
  async function cambiarEstado(n, e) {
    const f = fs(), s = solicitudes.find(x => x.numero === n); if (!s) return;
    if (e === 'ANULADA' && !confirm('¿Anular esta solicitud?')) return;
    const hist = (s.historial || []).concat([{ estado: e, por: usuario(), en: new Date().toISOString() }]);
    try { await Promise.race([f.updateDoc(f.doc(f.collection(db(), s._col || COL), n), { estado: e, historial: hist }), new Promise(res => setTimeout(res, 2500))]); toast('Solicitud', `${n}: ${ESTADOS[e]}.`, 'success'); } catch (err) { toast('No se pudo', err.message || String(err), 'error'); }
  }
  async function descargarOffline() {
    const f = fs(), btn = document.getElementById('si-off'), m = document.getElementById('si-offm'); if (btn) btn.disabled = true;
    const prog = window.SAR_Progreso ? window.SAR_Progreso.iniciar('Descargando para usar sin internet…', []) : null;
    try {
      const partes = [['Insumos', 'Insumos'], ['Bodegas', 'Bodegas'], ['Asignaciones_Ubicacion', 'Ubicaciones'], ['Catalogo_Productos', 'Catálogo'], [COL, 'Solicitudes'], [COL_ANT, 'Solicitudes anteriores']]; let n = 0, k = 0;
      for (const [c, t] of partes) { if (prog) prog.paso(`Descargando ${t} (${++k} de ${partes.length})`); const sn = await f.getDocs(f.query(f.collection(db(), c), f.limit(3000))); n += sn.size; }
      await cargarBase(); await publicarCatalogo(true).catch(() => {}); localStorage.setItem('si-off', new Date().toISOString());
      if (prog) prog.listo(`Listo: ${n} registros guardados en este teléfono`, { aviso: false });
    } catch (e) { if (prog) prog.error(); toast('Descarga', 'No se pudo completar: ' + (e.message || e), 'error'); }
    pintarBandeja();
  }
  function enlazarBandeja() {
    const r = rootBandeja(); if (!r || r.dataset.ok) return; r.dataset.ok = '1';
    r.addEventListener('change', (e) => { if (e.target.id === 'si-fil') { filtro = e.target.value; pintarBandeja(); } });
    r.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return; const card = b.closest('.si-card');
      if (b.id === 'si-off') return descargarOffline();
      if (!card) return; const n = card.dataset.n;
      if (b.dataset.ok !== undefined) return decidirLinea(n, +b.dataset.ok, false, b.closest('.si-ln'));
      if (b.dataset.nh !== undefined) return decidirLinea(n, +b.dataset.nh, true, null);
      if (b.dataset.ver !== undefined) { abiertoL[n + '|' + b.dataset.ver] = true; return pintarBandeja(); }
      if (b.dataset.mv) return traer(n);
      if (b.dataset.e) return cambiarEstado(n, b.dataset.e);
      if (b.dataset.c) { const s = solicitudes.find(x => x.numero === n), t = textoPicking(s, (s.lineas || []).map(l => infoLinea(l, insumos, s.bodega))); try { await navigator.clipboard.writeText(t); toast('Copiado', 'Pégalo en WhatsApp.', 'success'); } catch (er) { window.prompt('Copia este texto:', t); } }
    });
  }
  async function abrirBandeja() {
    const r = rootBandeja(); if (!r) return; enlazarBandeja();
    if (!cargado) { r.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando solicitudes…') : 'Cargando…'; try { await cargarBase(); } catch (e) { /* con lo guardado */ } }
    publicarCatalogo().catch((e) => console.warn('[Solicitudes] catálogo público no publicado:', e && e.message));
    if (desuscribir) { try { desuscribir(); } catch (e) { /* ya cerradas */ } }
    const f = fs(), por = { [COL]: [], [COL_ANT]: [] };
    const juntar = () => { solicitudes = por[COL].concat(por[COL_ANT].filter(x => !por[COL].some(y => y.numero === x.numero))).sort((a, b) => String(b.creadoEn).localeCompare(String(a.creadoEn))); pintarBandeja(); asignarCorrelativos(); const nu = solicitudes.filter(s => s.estado === 'NUEVA').length; const ins = document.getElementById('si-badge'); if (ins) { ins.textContent = nu || ''; ins.style.display = nu ? '' : 'none'; } };
    const oir = (col) => f.onSnapshot(f.query(f.collection(db(), col), f.where('tipo', '==', TIPO)), (sn) => { const l = []; sn.forEach(d => l.push({ ...d.data(), _col: col })); por[col] = l; juntar(); }, () => { por[col] = []; juntar(); });
    const u1 = oir(COL), u2 = oir(COL_ANT); desuscribir = () => { u1(); u2(); };
  }

  // ---------------- informes contable y disponible (Auditoría) ----------------
  /** Lógica pura: lo comprometido por solicitudes confirmadas y aún no entregadas, por producto y bodega de origen. */
  function comprometido(lista) {
    const m = new Map();
    (lista || []).filter(s => s.estado !== 'ENTREGADA' && s.estado !== 'ANULADA').forEach(s => (s.lineas || []).forEach(l => (l.seleccion || []).forEach(x => { if (!(x.qty > 0)) return; const k = norm(l.nombre) + '|' + x.bodega; const e = m.get(k) || { nombre: l.nombre, bodega: x.bodega, qty: 0, sols: [] }; e.qty += x.qty; const id = s.correlativo || s.numero; if (!e.sols.includes(id)) e.sols.push(id); m.set(k, e); })));
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  /** Filas para el CSV: cada producto de cada solicitud. */
  function filasInforme(lista) {
    const out = [];
    (lista || []).slice().sort((a, b) => String(a.creadoEn).localeCompare(String(b.creadoEn))).forEach(s => (s.lineas || []).forEach(l => out.push([s.correlativo || s.numero, (s.creadoEn || '').slice(0, 10), s.solicitante || '', s.correo || '', s.servicio || '', s.bodega || '', ESTADOS[s.estado] || s.estado, l.nombre, l.cantidad, num(l.entregar), EST_L[l.estado || 'pendiente'], (l.seleccion || []).map(x => `${x.lote} ${x.bodega}: ${x.qty}`).join(' · ')])));
    return out;
  }
  const CAB_INFORME = ['N° solicitud', 'Fecha', 'Solicitante', 'Correo', 'Servicio', 'Bodega pedida', 'Estado', 'Producto', 'Pedido', 'Confirmado', 'Estado del producto', 'Lotes elegidos'];
  async function leerTodas() { const f = fs(), l = []; for (const c of [COL, COL_ANT]) { try { const sn = await f.getDocs(f.query(f.collection(db(), c), f.where('tipo', '==', TIPO))); sn.forEach(d => l.push({ ...d.data(), _col: c })); } catch (e) { /* sin permiso */ } } return l; }
  async function pintarAuditoria(el, tipo) {
    if (!el) return; el.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando solicitudes…') : '';
    const l = await leerTodas(), comp = comprometido(l), ab = l.filter(s => s.estado !== 'ENTREGADA' && s.estado !== 'ANULADA'), ent = l.filter(s => s.estado === 'ENTREGADA');
    const csvBtn = '<button type="button" class="btn btn-outline btn-sm" data-sol-csv="1"><i class="ph ph-download-simple"></i> Solicitudes (Excel)</button>';
    el.innerHTML = tipo === 'disp'
      ? `<h3 class="si-h">Solicitudes de insumos</h3><p class="act-hint">${ab.length} abierta(s). <b>Comprometido</b> = lo que bodega ya confirmó para una solicitud y aún no se entrega: sigue en stock, pero ya tiene destino. ${csvBtn}</p>
        ${comp.length ? `<div class="fp-tw"><table class="si-tb"><thead><tr><th>Producto</th><th>Bodega</th><th>Comprometido</th><th>Solicitudes</th></tr></thead><tbody>${comp.map(c => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.bodega)}</td><td><b>${c.qty}</b></td><td>${esc(c.sols.join(', '))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="act-hint">Nada comprometido por solicitudes.</p>'}`
      : `<h3 class="si-h">Solicitudes de insumos (historial)</h3><p class="act-hint">${l.length} solicitud(es): ${ent.length} entregada(s), ${ab.length} abierta(s). ${csvBtn}</p>
        <div class="fp-tw"><table class="si-tb"><thead><tr><th>N°</th><th>Fecha</th><th>Pide</th><th>Bodega</th><th>Estado</th><th>Productos</th></tr></thead><tbody>${l.sort((a, b) => String(b.creadoEn).localeCompare(String(a.creadoEn))).slice(0, 60).map(s => `<tr><td>${esc(s.correlativo || s.numero)}</td><td>${esc(new Date(s.creadoEn).toLocaleDateString('es-CL'))}</td><td>${esc(s.solicitante || '')}${s.servicio ? ' · ' + esc(s.servicio) : ''}</td><td>${esc(s.bodega || '')}</td><td>${esc(ESTADOS[s.estado] || s.estado)}</td><td>${(s.lineas || []).map(x => `${esc(x.nombre)} ${num(x.entregar) || 0}/${x.cantidad}`).join(' · ')}</td></tr>`).join('')}</tbody></table></div>`;
    const b = el.querySelector('[data-sol-csv]'); if (b) b.onclick = () => {
      const celda = (v) => { const t = String(v == null ? '' : v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      const txt = '\ufeff' + [CAB_INFORME, ...filasInforme(l), [], ['COMPROMETIDO POR SOLICITUDES (confirmado y no entregado)'], ['Producto', 'Bodega', 'Comprometido', 'Solicitudes'], ...comp.map(c => [c.nombre, c.bodega, c.qty, c.sols.join(', ')])].map(x => x.map(celda).join(';')).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })); a.download = `solicitudes-insumos-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
  }

  window.SAR_Solicitudes = { abrirPide, abrirBandeja, publicarCatalogo, numeroSolicitud, agregarLinea, textoPicking, infoLinea, lotesCandidatos, repartir, estadoLinea, comprometido, filasInforme, CAB_INFORME, leerTodas, pintarAuditoria };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SAR_Solicitudes;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: null });
