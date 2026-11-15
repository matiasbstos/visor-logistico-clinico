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
  // Tipo de pedido (v21.209): quien pide elige primero médicos, aseo u oficina y ve solo esos productos.
  const CATS = [
    { k: 'medico', t: 'Insumos médicos', s: 'Curaciones, jeringas, catéteres, guantes de procedimiento…', ej: 'Ej: Catéter venoso periférico 22G con alas', ic: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 41.3 14v20L24 44 6.7 34V14z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M20.5 15h7v5.5H33v7h-5.5V33h-7v-5.5H15v-7h5.5z" fill="currentColor"/></svg>' },
    { k: 'aseo', t: 'Aseo', s: 'Limpieza, papel higiénico, toallas, bolsas, jabón…', ej: 'Ej: Cloro gel 900 ml', ic: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 6h10v6h-4l8 4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 12h12l3 8v20a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3V20z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M14 26h18" stroke="currentColor" stroke-width="3"/><circle cx="38" cy="10" r="2" fill="currentColor"/><circle cx="42" cy="15" r="1.6" fill="currentColor"/><circle cx="37" cy="17" r="1.4" fill="currentColor"/></svg>' },
    { k: 'oficina', t: 'Oficina', s: 'Resmas, lápices, carpetas, tóner, corchetes…', ej: 'Ej: Resma papel carta 75 g', ic: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 6h17l9 9v27H12z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M29 6v9h9" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M18 24h14M18 30h14M18 36h9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>' }
  ];
  const catDe = (k) => CATS.find(c => c.k === k) || null;
  // Mismas palabras que usa el ingreso para proponer el tipo (script.js); lo marcado como aseo u oficina en el producto manda.
  const RX_ASEO = /\b(cloro|detergente|desinfectante|lavaloza|jab[oó]n|toalla\s+(de\s+)?(papel|nova)|papel\s+higi[eé]nico|bolsa\s+(de\s+)?(basura|residuo)|escobill|trapero|paño|pa[nñ]o\s+de\s+limpieza|limpia|ambientador|alcohol\s+gel|sanitizante|virutilla|esponja|basurero|guante\s+(de\s+)?(aseo|goma|dom[eé]stico)|dispensador)/i;
  const RX_OFI = /\b(l[aá]piz|lapicera|bol[ií]grafo|resma|carpeta|archivador|cuaderno|corchete|grapa|post[\s-]?it|plum[oó]n|tinta|toner|t[oó]ner|sobre|cinta\s+adhesiva|cartulina|regla|tijera\s+de\s+oficina)\b/i;
  function tipoDe(i) { const t = String((i && (i.tipoInsumo || i.t)) || ''); if (t === 'aseo' || t === 'oficina') return t; const n = String((i && (i.name || i.nombre)) || ''); return RX_ASEO.test(n) ? 'aseo' : RX_OFI.test(n) ? 'oficina' : 'medico'; }
  const ESTADOS = { NUEVA: 'Nueva', PREPARACION: 'En preparación', LISTA: 'Lista para retirar', ENTREGADA: 'Entregada', ANULADA: 'Anulada' };

  // ---------------- lógica pura ----------------
  /** Código de la solicitud: SI-AAAAMMDD-HHMM-XXX (se calcula en el teléfono, sirve sin internet). */
  function numeroSolicitud(d, azar) { const p = (n) => String(n).padStart(2, '0'); return `SI-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${String(azar || Math.floor(Math.random() * 1000)).padStart(3, '0')}`; }
  /** Agrega o suma una línea; las líneas manuales se juntan por nombre. */
  function agregarLinea(lineas, n) { const k = norm(n.nombre); if (!k) return lineas; const x = lineas.find(l => norm(l.nombre) === k && !!l.manual === !!n.manual); if (x) x.cantidad += Math.max(1, Math.floor(num(n.cantidad) || 1)); else lineas.push({ nombre: String(n.nombre).trim(), cantidad: Math.max(1, Math.floor(num(n.cantidad) || 1)), manual: !!n.manual }); return lineas; }
  /** Texto para pegar en WhatsApp / picking. */
  function textoPicking(s, info) {
    const L = (s.lineas || []).map((l, i) => { if (l.soloConteo) return null; const x = info && info[i]; return `${i + 1}. ${l.nombre} × ${l.cantidad}${x && x.ubicacion ? ` · ${x.ubicacion}` : ''}${x && x.stock != null ? ` (hay ${x.stock})` : ''}`; });
    return `Solicitud ${s.correlativo || s.numero}${catDe(s.categoria) ? ' · ' + catDe(s.categoria).t : ''} · ${s.bodega || ''}\nPide: ${s.solicitante || s.requester}${s.correo ? ' <' + s.correo + '>' : ''}${s.servicio ? ' (' + s.servicio + ')' : ''}\n${L.filter(Boolean).join('\n')}${s.nota ? '\nNota: ' + s.nota : ''}`;
  }
  /** Stock y ubicación de una línea a partir de los insumos leídos: coincide por id o por nombre. */
  function infoLinea(l, insumos, bodega) {
    const k = norm(l.asociado || l.nombre), docs = insumos.filter(i => (l.insumoId && i.id === l.insumoId) || norm(i.name) === k);
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
      const x = d.data(); window.SAR_CatalogoPublico = x; bodegas = x.bodegas || []; insumos = []; Object.keys(x.productos || {}).forEach(b => (x.productos[b] || []).forEach(p => insumos.push({ id: p.i || '', name: p.n, location: b, codigoMP: p.c || '', ...(p.t ? { tipoInsumo: p.t } : {}) })));
      if (window.SAR_Imagenes && window.SAR_Imagenes.sumarIndice && x.fotos) window.SAR_Imagenes.sumarIndice(x.fotos);
      cargado = true; return;
    }
    const f = fs(), a = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(3000))), l = []; a.forEach(d => l.push({ id: d.id, ...d.data() })); insumos = l;
    try { const b = await f.getDocs(f.collection(db(), 'Bodegas')), n = []; b.forEach(d => n.push((d.data().nombre || d.data().name || d.id))); bodegas = n.filter(Boolean).sort(); } catch (e) { bodegas = []; }
    if (!bodegas.length) bodegas = [...new Set(insumos.map(i => i.location).filter(Boolean))].sort();
    cargado = true;
  }
  const listaDe = (bodega, cat) => { const m = new Map(); insumos.filter(i => i.location === bodega && i.status !== 'CUARENTENA').forEach(i => { const k = norm(i.name), t = tipoDe(i); if (k && !m.has(k) && (!cat || cat === '*' || t === cat)) m.set(k, { nombre: i.name, id: i.id, codigo: i.codigoMP || '', tipo: t }); }); return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')); };

  // ---------------- catálogo público para quien pide ----------------
  // Quien pide sin cuenta no puede leer Insumos ni el Catálogo. Al abrir la bandeja (cada 6 h) o «Descargar para usar sin internet»,
  // bodega publica en Solicitudes_Insumos/catalogo-publico: bodegas, nombres de productos por bodega (SIN stock) y fotos confirmadas.
  async function publicarCatalogo(forzar) {
    try { const ult = Number(localStorage.getItem('si-pub') || 0); if (!forzar && Date.now() - ult < 6 * 3600e3) return; } catch (e) { /* sigue */ }
    const f = fs(); if (!cargado) await cargarBase();
    const c = {}, n = {};
    try { const sn = await f.getDocs(f.query(f.collection(db(), 'Catalogo_Productos'), f.limit(3000)));
      const mini = (src) => new Promise(ok => { const im = new Image(); im.onload = () => { const k = Math.min(1, 96 / Math.max(im.width, im.height)), cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); try { ok(cv.toDataURL('image/jpeg', 0.6)); } catch (e) { ok(''); } }; im.onerror = () => ok(''); im.src = src; });
    let peso = 0; const docs = []; sn.forEach(d => docs.push(d.data()));
    for (const x of docs) { if (x.fotoEstado === 'descartada') continue;
        const propia = x.imagen || x.imagenWeb || '', arch = x.imagenMP || ''; if (!propia && !arch) continue;
        if (x.codigoMP && arch && !x.imagen) { c[String(x.codigoMP)] = arch; continue; }
        // foto propia o de internet (guardada en el producto): miniatura de 96 px para que la lista pública no pase el límite de tamaño
        let v = null; if (x.imagen && /^https?:/.test(x.imagen)) v = { i: x.imagen }; else if (propia && peso < 700000) { const m = await mini(propia); if (m) { v = { i: m }; peso += m.length; } } else if (arch) v = { a: arch };
        if (v) [x.descripcion, x.insumoName].forEach(t => { const k = norm(t); if (k) n[k] = v; }); }
    } catch (e) { /* sin fotos */ }
    const productos = {}; bodegas.forEach(b => { const l = listaDe(b); if (l.length) productos[b] = l.map(p => ({ n: p.nombre, i: p.id, ...(p.codigo ? { c: String(p.codigo) } : {}), ...(p.tipo !== 'medico' ? { t: p.tipo } : {}) })); });
    await f.setDoc(f.doc(f.collection(db(), COL), ID_PUB), { tipo: 'CATALOGO_PUBLICO', bodegas: Object.keys(productos).sort(), productos, fotos: { c, n }, ...(window.SAR_Transitoria && window.SAR_Transitoria.bloquePublico ? { transitoria: await window.SAR_Transitoria.bloquePublico().catch(() => null) } : {}), actualizado: new Date().toISOString() });
    try { localStorage.setItem('si-pub', String(Date.now())); } catch (e) { /* sin almacenamiento */ }
  }

  // ---------------- pantalla de quien pide ----------------
  let manualAbierto = false, catSel = '', bodegaSel = '', lineas = [], busca = '', form = { solicitante: '', correo: '', servicio: '', nota: '' }, manual = { nombre: '', cantidad: 1, foto: '' }, enviando = false, editando = null, misDatos = {};
  const rootPide = () => document.getElementById('si-pide');
  /** Primer paso: ¿qué necesitas pedir? */
  function pintarCategorias(r) {
    r.innerHTML = `<div class="si-wrap"><h2 class="si-t">¿Qué necesitas pedir?</h2><p class="si-s">Elige el tipo de insumo y después busca los productos que necesitas.</p>
      <div class="si-cats">${CATS.map(c => `<button type="button" class="si-cat si-cat--${c.k}" data-cat="${c.k}"><span class="si-cat-ic">${c.ic}</span><span class="si-cat-tx"><b>${c.t}</b><small>${c.s}</small></span><i aria-hidden="true">›</i></button>`).join('')}</div>
      <div id="si-inv"></div><div id="si-mias"></div></div>`;
    if (window.SAR_InvMovil) window.SAR_InvMovil.boton(document.getElementById('si-inv'));
    pintarMias();
  }
  // Ícono de cámara con el trazo del Visor (reemplaza el emoji).
  const IC_CAM = '<svg class="si-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="10" r="1" fill="#8CC63F"/></svg>';
  /** Productos del tipo elegido en todas las bodegas, sin repetir (quien pide no elige bodega). */
  function listaCat() { const m = new Map(); bodegas.forEach(b => listaDe(b, catSel).forEach(p => { const k = norm(p.nombre); if (!m.has(k)) m.set(k, { ...p, bodega: b }); })); return [...m.values()].sort((x, y) => x.nombre.localeCompare(y.nombre, 'es')); }
  /** Búsqueda por palabras: cada palabra escrita debe estar en el nombre (en cualquier orden, «cat 22» encuentra «Catéter … 22G»). */
  function buscarEn(lista, texto) { const t = norm(texto).split(' ').filter(Boolean); if (!t.length) return []; return lista.filter(p => { const n = norm(p.nombre); return t.every(w => n.includes(w)); }).sort((x, y) => (norm(y.nombre).startsWith(t[0]) ? 1 : 0) - (norm(x.nombre).startsWith(t[0]) ? 1 : 0)); }
  /** Bodega a la que va la solicitud: la que tiene más de los productos pedidos; si son todos a mano, la que tiene más productos de ese tipo. */
  function bodegaAuto() {
    const c = {}; lineas.forEach(l => { const i = l.insumoId && insumos.find(x => x.id === l.insumoId) || insumos.find(x => norm(x.name) === norm(l.nombre)); if (i && i.location) c[i.location] = (c[i.location] || 0) + 1; });
    const top = Object.keys(c).sort((x, y) => c[y] - c[x])[0]; if (top) return top;
    return bodegas.slice().sort((x, y) => listaDe(y, catSel).length - listaDe(x, catSel).length)[0] || '';
  }
  function pintarPide() {
    const r = rootPide(); if (!r) return;
    if (!catSel && !editando) { if (window.SAR_InvMovil && window.SAR_InvMovil.enCurso()) { window.SAR_InvMovil.pintar(r); return; } pintarCategorias(r); return; }
    const cat = catDe(catSel);
    r.innerHTML = `<div class="si-wrap">
      ${editando ? `<div class="si-edit"><span>Modificando <b>${esc(editando.ver)}</b>: agrega, quita o cambia cantidades y guarda.</span><button type="button" class="btn btn-secondary btn-sm" id="si-edit-x">Cancelar</button></div>` : ''}
      ${cat ? `<div class="si-catsel si-cat--${cat.k}"><span class="si-cat-ic">${cat.ic}</span><span><small>Estás pidiendo</small><b>${cat.t}</b></span>${editando ? '' : '<button type="button" class="btn btn-secondary btn-sm" id="si-cat-x">Cambiar</button>'}</div>` : ''}
      <h2 class="si-t">Solicitud de ${cat ? esc(cat.t.toLowerCase()) : 'insumos'}</h2><p class="si-s">Busca lo que necesitas, agrégalo y envía. Bodega confirmará lo que hay.</p>
      <div class="si-dos"><label class="si-l">Tu nombre<input id="si-nom" class="si-in" value="${esc(form.solicitante)}" placeholder="Nombre y apellido" autocomplete="name"></label><label class="si-l">Tu correo<input id="si-cor" class="si-in" type="email" value="${esc(form.correo)}" placeholder="nombre@cormumel.cl" autocomplete="email" inputmode="email"></label></div>
      <div class="si-dos"><label class="si-l">Servicio / unidad<input id="si-ser" class="si-in" value="${esc(form.servicio)}" placeholder="Ej: Box 3, Urgencia"></label><span></span></div>
      <div class="si-busca">${manualAbierto ? '' : `<label class="si-l">Agregar producto<input id="si-bus" class="si-in" value="${esc(busca)}" placeholder="Escribe las primeras palabras… (${esc((cat || CATS[0]).ej.replace(/^Ej: /, 'ej: '))})" autocomplete="off" enterkeyhint="search"></label><div id="si-res"></div>`}
        ${manualAbierto ? `<div class="si-manbox"><div class="si-cab"><b>Agregar a mano</b><button type="button" class="btn btn-secondary btn-sm" id="si-man-x">Volver a buscar</button></div><small>Escribe el <b>nombre completo</b> (qué es, marca, medida o tamaño) y <b>saca una foto</b> del producto: así bodega sabe exactamente qué es.</small>
          <div class="si-man"><input id="si-mt" class="si-in" placeholder="${esc((cat || CATS[0]).ej)}" value="${esc(manual.nombre)}" autocomplete="off"><input id="si-mc" class="si-in si-cn" type="number" min="1" value="${manual.cantidad}" inputmode="numeric" aria-label="Cantidad"></div>
          <div id="si-sug"></div>
          <div class="si-man"><label class="btn btn-secondary si-fbtn${manual.foto ? ' si-fbtn--ok' : ''}"><input type="file" accept="image/*" capture="environment" hidden id="si-mf">${manual.foto ? '<img src="' + manual.foto + '" alt="">Cambiar foto' : IC_CAM + 'Sacar foto del producto'}</label><button type="button" class="btn btn-primary" id="si-ma">Agregar</button></div>
        </div>` : ''}</div>
      <h3 class="si-h">Tu solicitud (${lineas.length})</h3>
      <div class="si-car">${lineas.map((l, i) => `<div class="si-fila">${l.foto ? `<img class="si-lfoto" src="${l.foto}" alt="">` : ''}<span class="si-fn">${esc(l.nombre)}${l.manual ? ' <em>escrito a mano</em>' : ''}</span><span class="si-q"><button type="button" data-m="${i}">−</button><b>${l.cantidad}</b><button type="button" data-p="${i}">+</button></span><button type="button" class="si-x" data-x="${i}" aria-label="Quitar">✕</button></div>`).join('') || '<p class="si-v">Aún no agregas nada.</p>'}</div>
      <label class="si-l">Nota (opcional)<input id="si-not" class="si-in" value="${esc(form.nota)}" placeholder="Ej: urgente para hoy"></label>
      <button type="button" class="btn btn-primary si-env" id="si-env"${enviando ? ' disabled' : ''}>${editando ? 'Guardar cambios' : 'Enviar solicitud'}</button>
      <p class="si-v" id="si-red"></p><div id="si-mias"></div></div>`;
    estadoRed(); if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(r); pintarRes(); pintarSug(); pintarMias();
  }
  /** Coincidencias mientras se escribe; al final, «No está en la lista» abre el ingreso a mano con foto. */
  function pintarRes() {
    const el = document.getElementById('si-res'); if (!el) return; const q = busca.trim();
    if (q.length < 2) { el.innerHTML = ''; return; }
    const exacto = buscarEn(listaCat(), q), res = exacto.length ? exacto : parecidos(q, listaCat(), 8), vis = res.slice(0, 12);
    el.innerHTML = `<div class="si-drop">${!exacto.length && vis.length ? '<p class="si-v">No hay uno exacto. ¿Es alguno de estos?</p>' : ''}${vis.map(x => `<button type="button" class="si-p" data-add="${esc(x.nombre)}" data-id="${esc(x.id)}">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(x.nombre, { codigo: x.codigo }) : ''}<span>${esc(x.nombre)}</span><b>+</b></button>`).join('')}
      ${res.length > vis.length ? `<p class="si-v">Hay ${res.length - vis.length} más: escribe otra palabra para afinar.</p>` : ''}
      ${vis.length ? '' : '<p class="si-v">No encontré productos con esas palabras.</p>'}
      <button type="button" class="si-noesta" id="si-noesta"><span>${IC_CAM}</span><span><b>No está en la lista</b><small>Agrégalo a mano con una foto</small></span><i aria-hidden="true">›</i></button></div>`;
    if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(el);
  }
  /** «¿Es alguno de estos?»: productos de la lista parecidos a lo que se escribe a mano. */
  function parecidos(texto, lista, max) {
    const t = norm(texto).split(' ').filter(w => w.length > 2); if (!t.length) return [];
    return lista.map(p => { const n = norm(p.nombre); return { p, sc: t.filter(w => n.includes(w)).length / t.length }; }).filter(x => x.sc >= 0.5).sort((a, b) => b.sc - a.sc).slice(0, max || 5).map(x => x.p);
  }
  function pintarSug() {
    const el = document.getElementById('si-sug'); if (!el) return; const txt = manual.nombre || '';
    const l = txt.trim().length >= 3 ? parecidos(txt, listaCat(), 5) : [];
    el.innerHTML = l.length ? `<p class="si-v">¿Es alguno de estos? Tócalo para agregarlo:</p><div class="si-lista si-lista--sug">${l.map(x => `<button type="button" class="si-p" data-sug="${esc(x.nombre)}" data-id="${esc(x.id)}">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(x.nombre, { codigo: x.codigo }) : ''}<span>${esc(x.nombre)}</span><b>+</b></button>`).join('')}</div>` : '';
    if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(el);
  }
  function reducirFoto(file, max) {
    return new Promise((ok, mal) => { const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.7)); };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la foto.')); }; img.src = url; });
  }
  /** Las últimas solicitudes hechas desde este teléfono y en qué estado van (bodega las va moviendo). */
  async function pintarMias() {
    const el = document.getElementById('si-mias'); if (!el) return; let l = [];
    try { l = JSON.parse(localStorage.getItem('si-mias') || '[]'); } catch (e) { l = []; } if (!l.length) { el.innerHTML = ''; return; }
    const f = fs(); misDatos = {}; const filas = await Promise.all(l.slice(0, 6).map(async (n) => { try { let d = await f.getDoc(f.doc(f.collection(db(), COL), n)); if (!d.exists() && !publica()) d = await f.getDoc(f.doc(f.collection(db(), COL_ANT), n)).catch(() => d); if (d.exists()) { const x = { ...d.data(), _col: d.ref && d.ref.parent ? d.ref.parent.id : COL }; misDatos[n] = x; return x; } return { numero: n, estado: 'POR_ENVIAR' }; } catch (e) { return { numero: n, estado: 'POR_ENVIAR' }; } }));
    el.innerHTML = `<div class="si-cab"><h3 class="si-h">Tus últimas solicitudes</h3><button type="button" class="btn btn-secondary btn-sm" id="si-mias-act">Actualizar</button></div><div class="si-car">${filas.map((x, k) => `<details class="si-mia"${k === 0 ? ' open' : ''}><summary><span class="si-fn"><b>${esc(x.correlativo || x.numero)}</b>${x.correlativo ? '' : ' <small>(provisional)</small>'}<br><small>${esc(x.bodega || '')}${x.creadoEn ? ' · ' + esc(new Date(x.creadoEn).toLocaleString('es-CL')) : ''}</small></span><span class="si-est si-e-${esc(x.estado)}">${esc(x.estado === 'POR_ENVIAR' ? 'Por enviar (sin internet)' : (ESTADOS[x.estado] || x.estado))}</span></summary>
      ${x.conteo ? `<div class="si-mia-l"><span>Inventario ${x.conteo.bodega ? esc(x.conteo.bodega) : ''}</span><span class="si-le si-le-${x.conteo.estado === 'aplicado' ? 'ok' : 'pendiente'}">${x.conteo.estado === 'aplicado' ? '✔ Cuadrado' : x.conteo.estado ? 'Bodega lo revisa' : 'Por cuadrar'}</span></div>` : ''}${(x.lineas || []).filter(l => !l.soloConteo).map(l => `<div class="si-mia-l"><span>${esc(l.nombre)} × ${l.cantidad}${num(l.reiterado) > 1 ? ' <em class="si-reit">sigue faltando</em>' : ''}</span>${chipL(l)}</div>`).join('')}${x.estado === 'NUEVA' && misDatos[x.numero] ? `<div class="si-lb"><small>Mientras bodega no empiece a prepararla puedes cambiarla.</small><button type="button" class="btn btn-primary btn-sm" data-mod="${esc(x.numero)}">Modificar</button></div>` : ''}</details>`).join('')}</div>`;
    el.querySelectorAll('[data-mod]').forEach(b => b.onclick = () => editar(b.dataset.mod));
    const ac = document.getElementById('si-mias-act'); if (ac) ac.onclick = () => pintarMias();
  }
  /** Carga una solicitud propia (aún «Nueva») en el formulario para cambiarla. */
  function editar(n) {
    const x = misDatos[n]; if (!x || x.estado !== 'NUEVA') { toast('Solicitud', 'Bodega ya empezó a prepararla: no se puede cambiar.', 'warning'); return; }
    editando = { numero: n, col: x._col || COL, ver: x.correlativo || n, historial: x.historial || [] };
    catSel = x.categoria || '*'; bodegaSel = x.bodega || ''; lineas = (x.lineas || []).map(l => ({ nombre: l.nombre, cantidad: l.cantidad, manual: !!l.manual, ...(l.insumoId ? { insumoId: l.insumoId } : {}), ...(l.foto ? { foto: l.foto } : {}) }));
    form.nota = x.nota || ''; form.servicio = x.servicio || form.servicio; busca = ''; pintarPide(); window.scrollTo && window.scrollTo(0, 0);
  }
  function estadoRed() { const e = document.getElementById('si-red'); if (e) e.textContent = navigator.onLine === false ? 'Sin internet: se guardará en este teléfono y se enviará sola al volver la conexión.' : ''; }
  function leerCampos() { const g = (id) => { const e = document.getElementById(id); return e ? e.value : null; }; const n = g('si-nom'), s = g('si-ser'), o = g('si-not'), c = g('si-cor'); if (c !== null) form.correo = c; if (n !== null) form.solicitante = n; if (s !== null) form.servicio = s; if (o !== null) form.nota = o; }
  async function enviar() {
    leerCampos();
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
      p.catch(() => {}); editando = null; lineas = []; busca = ''; form.nota = ''; bodegaSel = ''; catSel = ''; manualAbierto = false; pintarPide();
      if (window.SAR_Progreso && window.SAR_Progreso.exito) window.SAR_Progreso.exito({ titulo: r === 'ok' ? 'Cambios guardados' : 'Guardado en el teléfono', texto: esc(ed.ver) + (r === 'ok' ? '' : '<br>Se enviará solo al volver internet.') });
      return;
    }
    const ahora = new Date(), numero = numeroSolicitud(ahora), f = fs(); bodegaSel = bodegaAuto();
    const au = window.firebaseAuth && window.firebaseAuth.currentUser, data = { tipo: TIPO, numero, estado: 'NUEVA', uid: (au && au.uid) || '', requester: (au && au.email) || form.correo.trim().toLowerCase(), solicitante: form.solicitante.trim(), correo: form.correo.trim().toLowerCase(), servicio: form.servicio.trim(), bodega: bodegaSel, ...(catDe(catSel) ? { categoria: catSel } : {}), nota: form.nota.trim(), lineas: lineas.map(l => ({ ...l })), creadoEn: ahora.toISOString(), historial: [{ estado: 'NUEVA', por: usuario(), en: ahora.toISOString() }] };
    const p = f.setDoc(f.doc(f.collection(db(), COL), numero), data);
    const r = await Promise.race([p.then(() => 'ok'), new Promise(res => setTimeout(() => res('cola'), 2500))]).catch(e => 'error:' + (e.message || e));
    enviando = false;
    if (String(r).startsWith('error')) { toast('No se envió', String(r).slice(6) || 'Revisa tu conexión e intenta de nuevo.', 'error'); pintarPide(); return; }
    p.catch(() => { /* se reintenta sola al volver internet */ });
    try { const m = JSON.parse(localStorage.getItem('si-mias') || '[]'); m.unshift(numero); localStorage.setItem('si-mias', JSON.stringify(m.slice(0, 20))); } catch (e) { /* sin almacenamiento */ }
    lineas = []; busca = ''; form.nota = ''; bodegaSel = ''; catSel = ''; manualAbierto = false; pintarPide();
    if (window.SAR_Progreso && window.SAR_Progreso.exito) window.SAR_Progreso.exito({ titulo: r === 'ok' ? 'Solicitud enviada' : 'Guardada en el teléfono', texto: r === 'ok' ? 'Bodega ya la puede ver. Abajo verás cómo avanza.' : 'Se enviará sola cuando haya internet.' });
    const r2 = rootPide(); if (r2) r2.insertAdjacentHTML('afterbegin', `<div class="si-ok"><b>${r === 'ok' ? 'Solicitud enviada' : 'Solicitud guardada en el teléfono'}</b><br>${numero}${r === 'ok' ? '' : ' · se enviará sola cuando haya internet.'}</div>`);
    window.scrollTo && window.scrollTo(0, 0);
  }
  async function cambiarCategoria() {
    if (lineas.length) {
      const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: '¿Cambiar el tipo de pedido?', texto: `Se quitarán los <b>${lineas.length}</b> producto(s) que ya agregaste.`, si: 'Cambiar' }) : confirm('Se quitarán los productos agregados. ¿Cambiar?');
      if (!ok) return;
    }
    lineas = []; bodegaSel = ''; busca = ''; manual = { nombre: '', cantidad: 1, foto: '' }; catSel = ''; manualAbierto = false; pintarPide(); window.scrollTo && window.scrollTo(0, 0);
  }
  function enlazarPide() {
    const r = rootPide(); if (!r || r.dataset.ok) return; r.dataset.ok = '1';
    r.addEventListener('change', async (e) => { if (e.target.id !== 'si-mf') return; const fl = e.target.files && e.target.files[0]; if (!fl) return;
      try { manual.foto = await reducirFoto(fl, 480); const t = document.getElementById('si-mt'), c = document.getElementById('si-mc'); if (t) manual.nombre = t.value; if (c) manual.cantidad = Math.max(1, Math.floor(num(c.value) || 1)); leerCampos(); pintarPide(); }
      catch (er) { toast('Foto', er.message || 'No se pudo leer la foto.', 'error'); } });
    r.addEventListener('input', (e) => { if (e.target.id === 'si-mt') { manual.nombre = e.target.value; pintarSug(); return; }
      if (e.target.id === 'si-bus') { busca = e.target.value; pintarRes(); } });
    r.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; leerCampos();
      if (b.dataset.add) { agregarLinea(lineas, { nombre: b.dataset.add, cantidad: 1 }); if (lineas.length) { const l = lineas.find(x => norm(x.nombre) === norm(b.dataset.add)); if (l && b.dataset.id) l.insumoId = b.dataset.id; } busca = ''; pintarPide(); toast('Agregado', esc(b.dataset.add), 'success'); }
      else if (b.id === 'si-noesta') { manualAbierto = true; manual.nombre = manual.nombre || busca.trim(); busca = ''; pintarPide(); const t = document.getElementById('si-mt'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
      else if (b.id === 'si-man-x') { manualAbierto = false; manual = { nombre: '', cantidad: 1, foto: '' }; pintarPide(); const t = document.getElementById('si-bus'); if (t) t.focus(); }
      else if (b.id === 'si-ma') {
        const t = document.getElementById('si-mt'), c = document.getElementById('si-mc'); manual.nombre = t ? t.value : manual.nombre; manual.cantidad = Math.max(1, Math.floor(num(c && c.value) || 1));
        const nom = manual.nombre.trim();
        if (nom.split(/\s+/).length < 2 || nom.length < 8) { toast('Nombre completo', 'Escribe el nombre completo del producto (qué es, medida o tamaño).', 'warning'); return; }
        if (!manual.foto) { toast('Falta la foto', 'Saca una foto del producto para que bodega sepa exactamente qué es.', 'warning'); return; }
        lineas.push({ nombre: nom, cantidad: manual.cantidad, manual: true, foto: manual.foto }); manual = { nombre: '', cantidad: 1, foto: '' }; manualAbierto = false; pintarPide();
      }
      else if (b.dataset.sug) { agregarLinea(lineas, { nombre: b.dataset.sug, cantidad: manual.cantidad || 1 }); const l = lineas.find(x => norm(x.nombre) === norm(b.dataset.sug)); if (l && b.dataset.id) l.insumoId = b.dataset.id; manual = { nombre: '', cantidad: 1, foto: '' }; manualAbierto = false; pintarPide(); }
      else if (b.dataset.p !== undefined) { lineas[+b.dataset.p].cantidad++; pintarPide(); }
      else if (b.dataset.m !== undefined) { const l = lineas[+b.dataset.m]; l.cantidad = Math.max(1, l.cantidad - 1); pintarPide(); }
      else if (b.dataset.x !== undefined) { lineas.splice(+b.dataset.x, 1); pintarPide(); }
      else if (b.id === 'si-env') enviar();
      else if (b.id === 'si-edit-x') { editando = null; lineas = []; bodegaSel = ''; catSel = ''; form.nota = ''; pintarPide(); }
      else if (b.dataset.cat) { catSel = b.dataset.cat; bodegaSel = ''; busca = ''; pintarPide(); window.scrollTo && window.scrollTo(0, 0); }
      else if (b.id === 'si-cat-x') { cambiarCategoria(); }
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
    const k = norm(l.asociado || l.nombre), out = [];
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
  // ---- asociar lo pedido (nombre escrito por quien pide) a un producto del inventario (v21.210) ----
  let asoc = null, alias = {}; const ALIAS_ID = 'solicitudes-alias';
  const aliasDe = (l) => { const a = alias[norm(l.nombre)]; return a && insumos.some(i => norm(i.name) === norm(a)) ? a : ''; };
  function productosInv(q) { const t = norm(q).split(' ').filter(Boolean); if (!t.length) return []; const m = new Map(); insumos.forEach(i => { if (i.status === 'CUARENTENA') return; const k = norm(i.name); if (!t.every(w => k.includes(w))) return; const e = m.get(k) || { nombre: i.name, id: i.id, total: 0, bods: new Set() }; e.total += num(i.quantity); if (num(i.quantity) > 0 && i.location) e.bods.add(i.location); m.set(k, e); }); return [...m.values()].sort((a, b) => b.total - a.total).slice(0, 10); }
  function resAsoc(q) { if (norm(q).length < 2) return '<p class="si-v">Escribe parte del nombre como está en el inventario.</p>'; const l = productosInv(q); return l.length ? l.map(p => `<button type="button" class="si-p" data-asocsi="${asoc ? asoc.i : ''}" data-nom="${esc(p.nombre)}"><span>${esc(p.nombre)}<br><small>${p.total} u. · ${esc([...p.bods].join(', ') || 'sin stock')}</small></span><b>✓</b></button>`).join('') : '<p class="si-v">Sin coincidencias.</p>'; }
  async function cargarAlias() { try { const d = await fs().getDoc(fs().doc(fs().collection(db(), 'Contadores'), ALIAS_ID)); alias = d.exists() ? (d.data().items || {}) : {}; } catch (e) { alias = {}; } }
  async function asociar(n, i, nombreInv) {
    const s = solicitudes.find(x => x.numero === n); if (!s) return; const f = fs(), lin = (s.lineas || []).map(x => ({ ...x })), l = lin[i];
    if (nombreInv) { const d = insumos.find(x => norm(x.name) === norm(nombreInv) && x.location === s.bodega) || insumos.find(x => norm(x.name) === norm(nombreInv)); lin[i] = { ...l, asociado: nombreInv, ...(d ? { insumoId: d.id } : {}), asociadoPor: usuario() }; }
    else { const x = { ...l }; delete x.asociado; delete x.asociadoPor; if (x.manual) delete x.insumoId; lin[i] = x; }
    asoc = null; s.lineas = lin; pintarBandeja();
    try { await Promise.race([f.updateDoc(f.doc(f.collection(db(), s._col || COL), n), { lineas: lin }), new Promise(r => setTimeout(r, 2500))]); } catch (e) { toast('No se guardó', e.message || String(e), 'error'); }
    if (nombreInv && norm(l.nombre) !== norm(nombreInv)) { alias[norm(l.nombre)] = nombreInv; f.setDoc(f.doc(f.collection(db(), 'Contadores'), ALIAS_ID), { tipo: 'alias-solicitudes', items: alias, actualizado: new Date().toISOString() }).catch(() => {}); }
    toast('Asociado', nombreInv ? `Se moverá y descontará como «${esc(nombreInv)}».` : 'Asociación quitada.', 'success');
  }
  let abiertoL = {}, sel = '';   // sel: solicitud abierta en el panel lateral ('' = la primera; null = cerrado)   // numero|i → mostrar lotes aunque ya esté decidida

  function pintarBandeja() {
    const r = rootBandeja(); if (!r) return;
    if (asoc) queueMicrotask(() => { const x = r.querySelector('.si-asoc-in'); if (x && document.activeElement !== x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } });
    const ab = (s) => s.estado !== 'ENTREGADA' && s.estado !== 'ANULADA', vis = solicitudes.filter(s => filtro === 'TODAS' ? true : filtro === 'ABIERTAS' ? ab(s) : s.estado === filtro);
    const IM = window.SAR_Imagenes;
    // «Costado»: en pantallas anchas la lista queda a la izquierda y el detalle se abre al lado, sin perder la lista
    const costado = window.innerWidth >= 1000;
    if (costado && (!sel || !vis.some(x => x.numero === sel)) && sel !== null) sel = vis.length ? vis[0].numero : '';
    const asocHTML = (s, l, i) => {
      if (l.asociado) return `<div class="si-asoc si-asoc--ok"><small>${l.manual ? 'Pedido como «' + esc(l.nombre) + '» · ' : ''}asociado a <b>${esc(l.asociado)}</b></small><button type="button" class="btn btn-secondary btn-sm" data-desasoc="${i}">Quitar asociación</button></div>`;
      const ali = aliasDe(l), abierto = asoc && asoc.n === s.numero && asoc.i === i;
      if (!l.manual && !abierto && lotesCandidatos(l, insumos, s.bodega).length) return '';
      return `<div class="si-asoc">${ali ? `<button type="button" class="btn btn-primary btn-sm" data-asocsi="${i}" data-nom="${esc(ali)}">¿Es «${esc(ali)}»? Asociar (ya lo asociaste antes)</button>` : ''}
        ${abierto ? `<input class="si-in si-asoc-in" data-i="${i}" value="${esc(asoc.q)}" placeholder="Buscar en el inventario (nombre del fabricante)…" autocomplete="off" aria-label="Buscar producto para asociar"><div class="si-asoc-res">${resAsoc(asoc.q)}</div>` : `<button type="button" class="btn btn-secondary btn-sm" data-asoc="${i}">Asociar a producto del inventario</button>`}</div>`; };
    const cuadreHTML = (s) => { const c = s.conteo, us = (c.descontado || []).reduce((t, x) => t + num(x.usado), 0);
      if (c.estado === 'aplicado') return `<div class="si-cuadre si-cuadre--ok"><b>Inventario cuadrado</b> · se descontaron <b>${us}</b> u. usadas en ${(c.descontado || []).length} producto(s)${(c.sobrantes || []).length ? ` · sobran: ${c.sobrantes.map(x => esc(x.nombre) + ' +' + x.sobrante).join(', ')} (no se suman solos)` : ''}<details><summary>Ver detalle</summary>${(c.descontado || []).map(x => `<div>${esc(x.nombre)}: sistema ${x.sistema} · contado ${x.contado} · <b>usado ${x.usado}</b></div>`).join('') || 'Sin diferencias.'}</details></div>`;
      if (!c.estado) return '<div class="si-cuadre">Cuadrando el inventario…</div>';
      return `<div class="si-cuadre si-cuadre--mal"><b>El inventario no se cuadró solo:</b> ${esc(c.detalle || '')}<button type="button" class="btn btn-primary btn-sm" data-cuadrar="1">Cuadrar ahora</button></div>`; };
    const cardHTML = (s) => { const mover = (s.lineas || []).some(l => !l.movido && (l.seleccion || []).some(x => x.bodega !== s.bodega && x.qty > 0));
        return `<article class="si-card" data-n="${esc(s.numero)}"><header><b>${esc(s.correlativo || s.numero)}</b>${s.correlativo ? '' : ' <small>(asignando N°…)</small>'}<span class="si-est si-e-${esc(s.estado)}">${esc(ESTADOS[s.estado] || s.estado)}</span></header>
        <p class="si-m">${esc(s.solicitante || s.requester)}${s.correo ? ` (<a href="mailto:${esc(s.correo)}">${esc(s.correo)}</a>)` : ''}${s.servicio ? ' · ' + esc(s.servicio) : ''}${catDe(s.categoria) ? ' · <b>' + esc(catDe(s.categoria).t) + '</b>' : ''} · pide a <b>${esc(s.bodega)}</b> · ${esc(new Date(s.creadoEn).toLocaleString('es-CL'))}</p>
        ${s.nota ? `<p class="si-m">Nota: ${esc(s.nota)}</p>` : ''}${s.conteo ? cuadreHTML(s) : ''}
        <div class="si-lns">${(s.lineas || []).map((l, i) => { if (l.soloConteo) return ''; const cands = lotesCandidatos(l, insumos, s.bodega), decid = l.estado && l.estado !== 'pendiente', ver = !decid || abiertoL[s.numero + '|' + i] || !ab(s) && false;
          const pre = (l.seleccion && l.seleccion.length) ? cands.map(c => { const x = l.seleccion.find(y => y.insumoId === c.insumoId && y.clave === c.clave); return x ? x.qty : 0; }) : repartir(cands, l.cantidad), hay = cands.reduce((t, c) => t + c.disp, 0);
          return `<div class="si-ln${decid ? ' si-ln--ok' : ''}" data-i="${i}"><div class="si-lh">${l.foto ? `<span class="prod-img"><img src="${l.foto}" alt="${esc(l.nombre)}"></span>` : IM ? IM.thumb(l.nombre, { codigo: (insumos.find(x => x.id === l.insumoId) || {}).codigoMP || '' }) : ''}<div class="si-ln-t"><b>${esc(l.nombre)}</b>${l.manual ? ' <em>escrito a mano</em>' : ''}${num(l.reiterado) > 1 ? ` <em class="si-reit">Sigue faltando · ${num(l.reiterado)}.º día</em>` : ''}<small>Pide <b>${l.cantidad}</b> · hay ${hay} en total${l.movido ? ' · traído a ' + esc(s.bodega) : ''}</small></div>${chipL(l)}</div>
            ${ab(s) && ver ? (cands.length ? `<table class="si-tb si-lt"><thead><tr><th>Dónde</th><th>Lote</th><th>Vence</th><th>Hay</th><th>Sacar</th></tr></thead><tbody>${cands.map((c, j) => `<tr><td>${esc(c.bodega)}${c.estante ? ' · ' + esc(c.estante) : ''}${c.bodega !== s.bodega ? ' <small class="si-mv">hay que traer</small>' : ''}</td><td>${esc(c.lote)}</td><td>${esc(fmtV(c.vence))}</td><td>${c.disp}</td><td><input type="number" min="0" max="${c.disp}" value="${pre[j]}" class="si-q-in" data-j="${j}" inputmode="numeric" aria-label="Cantidad a sacar del lote ${esc(c.lote)}"></td></tr>`).join('')}</tbody></table>` : '<p class="si-v">No está en el inventario con ese nombre: asócialo al producto que corresponde.</p>') + asocHTML(s, l, i)
              + `<div class="si-lb"><button type="button" class="btn btn-primary btn-sm" data-ok="${i}"${cands.length ? '' : ' disabled'}>Confirmar</button><button type="button" class="btn btn-secondary btn-sm" data-nh="${i}">No hay</button></div>`
              : (ab(s) ? `<div class="si-lb"><small>${(l.seleccion || []).filter(x => x.qty > 0).map(x => `${esc(x.lote)} · ${esc(x.bodega)}: ${x.qty}`).join(' · ')}</small><button type="button" class="btn btn-secondary btn-sm" data-ver="${i}">Cambiar</button></div>` : '')}</div>`; }).join('')}</div>
        <footer>${mover && ab(s) ? `<button class="btn btn-primary" data-mv="1">Traer lo elegido a ${esc(s.bodega)}</button>` : ''}${s.estado === 'LISTA' ? '<button class="btn btn-primary" data-e="ENTREGADA">Marcar entregada</button>' : ''}${s.estado === 'PREPARACION' ? '<button class="btn btn-secondary" data-e="LISTA">Lista para retirar</button>' : ''}<button class="btn btn-secondary" data-c="1">Copiar para WhatsApp</button>${ab(s) ? '<button class="btn btn-secondary" data-e="ANULADA">Anular</button>' : ''}</footer></article>`; };
    r.innerHTML = `<div class="si-wrap si-ancho${costado ? ' si-wrap--costado' : ''}"><div class="si-cab"><div><h2 class="si-t">Solicitudes de insumos</h2><p class="si-s">Revisa cada producto: foto, dónde hay y de qué lote sacar. Confirma o marca «No hay»; quien pidió lo ve en su teléfono.</p></div>
      <div class="si-acc"><select id="si-fil" class="si-in">${[['ABIERTAS', 'Abiertas'], ['NUEVA', 'Nuevas'], ['PREPARACION', 'En preparación'], ['LISTA', 'Listas'], ['ENTREGADA', 'Entregadas'], ['TODAS', 'Todas']].map(([v, t]) => `<option value="${v}"${v === filtro ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <button type="button" class="btn btn-secondary" id="si-off" title="Guarda en el teléfono el inventario y las solicitudes para trabajar sin internet">Descargar para usar sin internet</button></div></div><p class="si-v" id="si-offm">${esc(localStorage.getItem('si-off') ? 'Última descarga: ' + new Date(localStorage.getItem('si-off')).toLocaleString('es-CL') : '')}</p>
      ${costado ? `<div class="si-costado"><div class="si-lsol" role="listbox" aria-label="Solicitudes">${vis.map(s => `<button type="button" role="option" class="si-fsol${s.numero === sel ? ' on' : ''}" data-sel="${esc(s.numero)}" aria-selected="${s.numero === sel}"><span><b>${esc(s.correlativo || s.numero)}</b><small>${esc(s.solicitante || '')}${s.servicio ? ' · ' + esc(s.servicio) : ''} · ${(s.lineas || []).length} prod.</small></span><span class="si-est si-e-${esc(s.estado)}">${esc(ESTADOS[s.estado] || s.estado)}</span></button>`).join('') || '<div class="home-empty">No hay solicitudes en este filtro.</div>'}</div>
        <section class="si-panel" aria-live="polite">${vis.find(s => s.numero === sel) ? `<div class="si-pcab"><small>↑ ↓ recorre · Esc cierra</small><button type="button" class="si-pnav" data-nav="-1" aria-label="Anterior">▲</button><button type="button" class="si-pnav" data-nav="1" aria-label="Siguiente">▼</button><button type="button" class="si-pnav" data-cerrar="1" aria-label="Cerrar">✕</button></div>` + cardHTML(vis.find(s => s.numero === sel)) : '<div class="si-pvacio">Elige una solicitud de la lista para ver el detalle.</div>'}</section></div>`
        : vis.map(cardHTML).join('') || '<div class="home-empty">No hay solicitudes en este filtro.</div>'}</div>`;
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
    if (s.origen === 'transitoria' && window.SAR_Transitoria) window.SAR_Transitoria.refrescarPublico();
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
    if (s.origen === 'transitoria' && window.SAR_Transitoria) window.SAR_Transitoria.refrescarPublico();
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
  function moverSel(d) {
    const ab = (x) => x.estado !== 'ENTREGADA' && x.estado !== 'ANULADA', vis = solicitudes.filter(x => filtro === 'TODAS' ? true : filtro === 'ABIERTAS' ? ab(x) : x.estado === filtro);
    if (!vis.length) return; const i = Math.max(0, vis.findIndex(x => x.numero === sel)); sel = vis[Math.min(vis.length - 1, Math.max(0, i + d))].numero; pintarBandeja();
    const on = document.querySelector('.si-fsol.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  if (typeof document.addEventListener === 'function') document.addEventListener('keydown', (e) => {
    const r = rootBandeja(); if (!r || !r.offsetParent || window.innerWidth < 1000 || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') || document.querySelector('.sar-conf, .fp-ov, .r-prog')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moverSel(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Escape' && sel) { sel = null; pintarBandeja(); }
  });
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', () => { const r = rootBandeja(); if (r && r.offsetParent) { clearTimeout(window.__siRz); window.__siRz = setTimeout(pintarBandeja, 200); } });
  function enlazarBandeja() {
    const r = rootBandeja(); if (!r || r.dataset.ok) return; r.dataset.ok = '1';
    r.addEventListener('change', (e) => { if (e.target.id === 'si-fil') { filtro = e.target.value; pintarBandeja(); } });
    r.addEventListener('input', (e) => { if (!e.target.classList.contains('si-asoc-in') || !asoc) return; asoc.q = e.target.value; const res = e.target.parentElement.querySelector('.si-asoc-res'); if (res) res.innerHTML = resAsoc(asoc.q); });
    r.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return; const card = b.closest('.si-card');
      if (b.id === 'si-off') return descargarOffline();
      if (b.dataset.sel) { sel = b.dataset.sel; return pintarBandeja(); }
      if (b.dataset.cerrar) { sel = null; return pintarBandeja(); }
      if (b.dataset.nav) return moverSel(+b.dataset.nav);
      if (!card) return; const n = card.dataset.n;
      if (b.dataset.ok !== undefined) return decidirLinea(n, +b.dataset.ok, false, b.closest('.si-ln'));
      if (b.dataset.nh !== undefined) return decidirLinea(n, +b.dataset.nh, true, null);
      if (b.dataset.ver !== undefined) { abiertoL[n + '|' + b.dataset.ver] = true; return pintarBandeja(); }
      if (b.dataset.mv) return traer(n);
      if (b.dataset.asoc !== undefined) { asoc = { n, i: +b.dataset.asoc, q: '' }; pintarBandeja(); const x = r.querySelector('.si-asoc-in'); if (x) x.focus(); return; }
      if (b.dataset.asocsi !== undefined && b.dataset.nom) return asociar(n, +b.dataset.asocsi, b.dataset.nom);
      if (b.dataset.desasoc !== undefined) return asociar(n, +b.dataset.desasoc, '');
      if (b.dataset.cuadrar) { const s = solicitudes.find(x => x.numero === n), T = window.SAR_Transitoria; if (!s || !T) return; b.disabled = true;
        try { const f = fs(); await f.updateDoc(f.doc(f.collection(db(), COL), n), { 'conteo.estado': null }); const r = await T.aplicarRemoto({ ...s, conteo: { ...s.conteo, estado: null } }, { manual: true }); toast('Inventario', r && r.ok ? 'Cuadrado: se descontó lo usado.' : 'No se pudo cuadrar: revisa el detalle.', r && r.ok ? 'success' : 'error'); } catch (e) { toast('Inventario', e.message || String(e), 'error'); }
        b.disabled = false; return; }
      if (b.dataset.e) return cambiarEstado(n, b.dataset.e);
      if (b.dataset.c) { const s = solicitudes.find(x => x.numero === n), t = textoPicking(s, (s.lineas || []).map(l => infoLinea(l, insumos, s.bodega))); try { await navigator.clipboard.writeText(t); toast('Copiado', 'Pégalo en WhatsApp.', 'success'); } catch (er) { window.prompt('Copia este texto:', t); } }
    });
  }
  async function abrirBandeja() {
    const r = rootBandeja(); if (!r) return; enlazarBandeja();
    if (!cargado) { r.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando solicitudes…') : 'Cargando…'; try { await cargarBase(); } catch (e) { /* con lo guardado */ } }
    cargarAlias().then(() => pintarBandeja()).catch(() => {});
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

  // ---------------- inventario de bodega transitoria enviado desde el teléfono: se cuadra solo (v21.210) ----------------
  const intentados = new Set();
  function cuadrarLlegados(l) {
    const T = window.SAR_Transitoria; if (!T || !T.aplicarRemoto) return;
    l.filter(x => x.conteo && !x.conteo.estado && !intentados.has(x.numero)).forEach(x => { intentados.add(x.numero);
      T.aplicarRemoto(x).then(r => { if (r && r.ok) toast('Inventario cuadrado', `${x.conteo.bodega || 'Bodega transitoria'}: se descontaron ${r.usado} u. usadas. La reposición está en la bandeja.`, 'success'); }).catch(() => { intentados.delete(x.numero); }); });
  }
  // ---------------- aviso en la campana: solicitudes nuevas (solo bodega) ----------------
  if (typeof module === 'undefined' && typeof document.addEventListener === 'function' && !window.SAR_SOLICITUD_PUBLICA) {
    let n = 0; const t = setInterval(() => { n++; const u = usuario(); if (!(u && esGestor() && fs() && db()) && n < 90) return; clearInterval(t); if (!(u && esGestor())) return;
      try { const f = fs(); f.onSnapshot(f.query(f.collection(db(), COL), f.where('estado', '==', 'NUEVA')), (sn) => { const l = []; sn.forEach(d => { if (d.data().tipo === TIPO) l.push(d.data()); }); cuadrarLlegados(l); window.SAR_SolicitudesNuevas = l.sort((a, b) => String(b.creadoEn).localeCompare(String(a.creadoEn)));
        const b = document.getElementById('si-badge'); if (b) { b.textContent = l.length || ''; b.style.display = l.length ? '' : 'none'; }
        if (l.length > (window.__solNuevasAntes || 0) && window.__solNuevasAntes !== undefined && typeof window.showToast === 'function') window.showToast('Solicitud de insumos nueva', `${l[0].solicitante || ''}${l[0].servicio ? ' · ' + l[0].servicio : ''}: ${(l[0].lineas || []).length} producto(s).`, 'info');
        window.__solNuevasAntes = l.length; window.dispatchEvent(new Event('sar-avisos')); }, () => { /* sin permiso */ }); } catch (e) { /* sin conexión */ } }, 2000);
  }

  function recordarMia(n) { try { const m = JSON.parse(localStorage.getItem('si-mias') || '[]'); m.unshift(n); localStorage.setItem('si-mias', JSON.stringify(m.slice(0, 20))); } catch (e) { /* sin almacenamiento */ } }
  window.SAR_Solicitudes = { repintar: () => pintarPide(), recordarMia, TIPO, COL, abrirPide, abrirBandeja, publicarCatalogo, numeroSolicitud, agregarLinea, textoPicking, infoLinea, lotesCandidatos, repartir, estadoLinea, comprometido, filasInforme, parecidos, CAB_INFORME, leerTodas, pintarAuditoria };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SAR_Solicitudes;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: null });
