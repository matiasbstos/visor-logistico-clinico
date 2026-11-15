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
  const ESTADOS = { NUEVA: 'Enviada', PREPARACION: 'Procesando', LISTA: 'Procesada', ENTREGADA: 'Cerrada', ANULADA: 'Anulada' };
  // Recorrido que ven ambas partes (v21.211): Enviada → Procesando → Procesada (bodega movió el stock) → Cerrada (entregada)
  const PASOS = ['NUEVA', 'PREPARACION', 'LISTA', 'ENTREGADA'], AV_EST = { NUEVA: 'enviada', PREPARACION: 'procesando', LISTA: 'procesada', ENTREGADA: 'cerrada', ANULADA: 'anulada' };
  function recorridoHTML(estado) {
    if (estado === 'ANULADA') return '<div class="si-rec si-rec--anulada"><span class="si-rec-p on">Anulada</span></div>';
    const k = estado === 'ENTREGADA' ? PASOS.length : Math.max(0, PASOS.indexOf(estado === 'POR_ENVIAR' ? 'NUEVA' : estado));   // cerrada: todos los pasos hechos, nada late
    return `<ol class="si-rec" aria-label="Estado: ${esc(ESTADOS[estado] || 'Por enviar')}">${PASOS.map((p, i) => `<li class="si-rec-p${i < k ? ' hecho' : i === k ? ' on' : ''}"><i aria-hidden="true"></i><span>${ESTADOS[p]}</span></li>`).join('')}</ol>`;
  }
  const avisar = (o) => { const P = window.SAR_Progreso; if (P && P.aviso) P.aviso(o); else toast(o.titulo, o.texto || '', 'info'); };

  // ---------------- datos que vienen de Firestore: se limpian antes de mostrarlos o usarlos (v21.212) ----------------
  // Quien pide escribe sin cuenta: nada de lo que manda se pinta sin escapar, los números se fuerzan a enteros y las
  // decisiones de bodega (estado de línea, lotes, movido…) en una solicitud aún «Enviada» se descartan: solo bodega las escribe.
  const FOTO_OK = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  const ent = (v, max) => Math.max(0, Math.min(max || 1e6, Math.floor(num(v))));
  const CAMPOS_BODEGA = ['estado', 'entregar', 'seleccion', 'movido', 'movidos', 'recibido', 'recibidos', 'transito', 'asociado', 'asociadoPor', 'insumoIdOrig', 'revisadoPor', 'revisadoEn', 'grupos'];
  function limpiarSol(x, id) {
    if (!x || typeof x !== 'object') return x; const s = { ...x }; if (id) s.numero = id;
    const nueva = s.estado === 'NUEVA';
    s.lineas = (Array.isArray(s.lineas) ? s.lineas : []).slice(0, 200).map(l0 => { const l = { ...(l0 && typeof l0 === 'object' ? l0 : {}) };
      if (nueva && !l.soloConteo) CAMPOS_BODEGA.forEach(k => { delete l[k]; });
      l.nombre = String(l.nombre || '').slice(0, 300); l.cantidad = ent(l.cantidad); if ('entregar' in l) l.entregar = ent(l.entregar); if ('reiterado' in l) l.reiterado = ent(l.reiterado, 365);
      l.foto = FOTO_OK.test(String(l.foto || '')) ? l.foto : ''; if (!l.foto) delete l.foto;
      if (l.estado && !['pendiente', 'ok', 'parcial', 'no_hay'].includes(l.estado)) delete l.estado;
      if (Array.isArray(l.seleccion)) l.seleccion = l.seleccion.map(z => ({ ...z, qty: ent(z.qty), lote: String(z.lote || ''), bodega: String(z.bodega || ''), clave: String(z.clave || ''), vence: String(z.vence || ''), insumoId: String(z.insumoId || '') })); else delete l.seleccion;
      return l; });
    ['solicitante', 'correo', 'servicio', 'nota', 'bodega', 'requester'].forEach(k => { if (k in s) s[k] = String(s[k] == null ? '' : s[k]).slice(0, 300); });
    if (s.correlativo && !/^SOL-\d{4}-\d{4,6}$/.test(String(s.correlativo))) delete s.correlativo;
    if (!ESTADOS[s.estado]) s.estado = 'NUEVA';
    if (s.conteo && typeof s.conteo === 'object') { const c = { ...s.conteo };
      c.items = (Array.isArray(c.items) ? c.items : []).slice(0, 500).map(i => ({ k: String(i.k || ''), n: String(i.n || '').slice(0, 300), sis: ent(i.sis), obj: ent(i.obj), contado: ent(i.contado), ...(i.recontado !== undefined ? { recontado: ent(i.recontado) } : {}) }));
      ['descontado', 'sobrantes'].forEach(k => { c[k] = (Array.isArray(c[k]) ? c[k] : []).map(z => ({ nombre: String(z.nombre || ''), sistema: ent(z.sistema), contado: ent(z.contado), usado: ent(z.usado), sobrante: ent(z.sobrante) })); });
      if (nueva && c.estado && !['reconteo', 'recontado', 'aplicado'].includes(c.estado)) delete c.estado;
      c.reconteo = (Array.isArray(c.reconteo) ? c.reconteo : []).map(String); s.conteo = c; }
    return s;
  }

  // ---------------- lógica pura ----------------
  /** Código de la solicitud: SI-AAAAMMDD-HHMM-XXX (se calcula en el teléfono, sirve sin internet). */
  function numeroSolicitud(d, azar) { const p = (n) => String(n).padStart(2, '0'); return `SI-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${azar !== undefined ? String(azar).padStart(3, '0') : String(azarSeguro()).padStart(6, '0')}`; }
  /** 6 dígitos al azar (antes 3: dos teléfonos en el mismo minuto podían chocar y la segunda se perdía). */
  function azarSeguro() { try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % 1000000; } catch (e) { return Math.floor(Math.random() * 1000000); } }
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
    // todos los productos (antes solo 3000) y la ubicación aunque venga solo como bodegaNombre (v21.214)
    const f = fs(), a = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(20000))), l = []; a.forEach(d => { const x = d.data(); l.push({ id: d.id, ...x, location: x.location || x.bodegaNombre || '' }); }); insumos = l;
    try { const b = await f.getDocs(f.collection(db(), 'Bodegas')), n = []; destinosStaff = {}; b.forEach(d => { const x = d.data(), nm = x.nombre || x.name || d.id; n.push(nm); if (x.type === 'transitoria') { const ped = x.pedidos !== undefined ? x.pedidos : 'medico'; if (ped && !destinosStaff[ped]) destinosStaff[ped] = nm; } }); bodegas = n.filter(Boolean).sort(); } catch (e) { bodegas = []; }
    // también las ubicaciones que tienen productos aunque no estén en Bodegas (antes esos productos no salían en la lista pública)
    bodegas = [...new Set(bodegas.concat(insumos.map(i => i.location)).filter(b => b && b !== 'En tránsito'))].sort();
    cargado = true;
  }
  const listaDe = (bodega, cat) => { const m = new Map(); insumos.filter(i => i.location === bodega && i.status !== 'CUARENTENA').forEach(i => { const k = norm(i.name), t = tipoDe(i); if (k && !m.has(k) && (!cat || cat === '*' || t === cat)) m.set(k, { nombre: i.name, id: i.id, codigo: i.codigoMP || '', tipo: t }); }); return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')); };

  // ---------------- catálogo público para quien pide ----------------
  // Quien pide sin cuenta no puede leer Insumos ni el Catálogo. Al abrir la bandeja (cada 6 h) o «Descargar para usar sin internet»,
  // bodega publica en Solicitudes_Insumos/catalogo-publico: bodegas, nombres de productos por bodega (SIN stock) y fotos confirmadas.
  async function publicarCatalogo(forzar) {
    try { const ult = Number(localStorage.getItem('si-pub') || 0); if (!forzar && Date.now() - ult < 3600e3) return; /* cada 1 h (antes 6): lo recién ingresado aparece pronto */ } catch (e) { /* sigue */ }
    const f = fs(); if (!cargado || forzar) await cargarBase();   // forzar: relee Bodegas (destinos por tipo recién cambiados)
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
    await f.setDoc(f.doc(f.collection(db(), COL), ID_PUB), { tipo: 'CATALOGO_PUBLICO', bodegas: Object.keys(productos).sort(), productos, fotos: { c, n }, destinos: destinosStaff, actualizado: new Date().toISOString() });
    try { localStorage.setItem('si-pub', String(Date.now())); } catch (e) { /* sin almacenamiento */ }
  }

  // ---------------- pantalla de quien pide ----------------
  let manualAbierto = false, catSel = '', bodegaSel = '', lineas = [], busca = '', form = { solicitante: '', correo: '', servicio: '', nota: '' }, manual = { nombre: '', cantidad: 1, foto: '' }, enviando = false, editando = null, misDatos = {};
  const rootPide = () => document.getElementById('si-pide');
  /** Primer paso: ¿qué necesitas pedir? */
  const correoOk = (c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c || '').trim());
  let cambiandoQuien = false;
  /** Paso 0 (v21.211): quien pide se identifica al entrar; todas sus solicitudes quedan a su nombre y correo. */
  function pintarQuien(r) {
    const cat = catDe(catSel);
    r.innerHTML = `<div class="si-wrap">${cat ? `<div class="si-catsel si-cat--${cat.k}"><span class="si-cat-ic">${cat.ic}</span><span><small>Vas a pedir</small><b>${cat.t}</b></span><button type="button" class="btn btn-secondary btn-sm" id="si-volver">Volver</button></div>` : ''}<h2 class="si-t">¿Quién pide?</h2><p class="si-s">No necesitas usuario: solo tu nombre y correo. Tus solicitudes quedan a tu nombre y aquí verás cuando bodega las procese.</p>
      <label class="si-l">Tu nombre<input id="si-q-nom" class="si-in" value="${esc(form.solicitante)}" placeholder="Nombre y apellido" autocomplete="name"></label>
      <label class="si-l">Tu correo<input id="si-q-cor" class="si-in" type="email" value="${esc(form.correo)}" placeholder="nombre@cormumel.cl" autocomplete="email" inputmode="email"></label>
      <button type="button" class="btn btn-primary si-env" id="si-q-ok">Continuar</button><div id="si-mias"></div></div>`;
    pintarMias();
  }
  const quienHTML = () => `<div class="si-quien"><span>Pidiendo como <b>${esc(form.solicitante)}</b><small>${esc(form.correo)}</small></span><button type="button" class="btn btn-secondary btn-sm" id="si-q-x">Cambiar</button></div>`;
  // Sesión con usuario: solo para quien hace inventario de una bodega de uso (rol transitoria). Quien solo pide no la necesita.
  let sesForm = false, sesEntrando = false;
  function sesionHTML() {
    const S = window.SAR_Sesion; if (!S) return ''; const u = S.usuario();
    if (u) return `<div class="si-ses"><span>Sesión de <b>${esc(u)}</b>${window.SAR_Rol ? ' · ' + esc(window.SAR_Rol) : ''}</span><button type="button" class="btn btn-secondary btn-sm" id="si-ses-x">Cerrar sesión</button></div>`;
    if (!sesForm) return '<button type="button" class="si-ses-link" id="si-ses-in">¿Haces el inventario de una bodega? Ingresa con tu usuario</button>';
    return `<form class="si-ses-f" id="si-ses-f" autocomplete="on"><b>Ingresar con tu usuario</b><label class="si-l">Correo<input id="si-ses-c" class="si-in" type="email" autocomplete="username" inputmode="email" required></label><label class="si-l">Contraseña<input id="si-ses-p" class="si-in" type="password" autocomplete="current-password" required></label>
      <div class="si-lb"><button type="button" class="btn btn-secondary btn-sm" id="si-ses-cancel">Cancelar</button><button type="submit" class="btn btn-primary btn-sm"${sesEntrando ? ' disabled' : ''}>${sesEntrando ? 'Ingresando…' : 'Ingresar'}</button></div></form>`;
  }
  // Inicio (v21.213): dos botones principales. «Pedir insumos» se despliega en médicos/aseo/oficina y recién ahí se piden
  // nombre y correo (sin usuario). «Inventario» es lo único que pide usuario y contraseña.
  let pedirAbierto = false, vista = '';
  const IC_PEDIR = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 14h32l-3 24a4 4 0 0 1-4 3.5H15A4 4 0 0 1 11 38z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M17 14a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="3"/><path d="M20.5 24h7v4.5H32v7h-4.5V40" fill="none"/><path d="M21 22h6v5h5v6h-5v5h-6v-5h-5v-6h5z" fill="currentColor"/></svg>';
  const IC_INV = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="8" width="28" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M18 8V5h12v3" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="m17 24 4 4 9-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 35h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="38" cy="40" r="3" fill="#8CC63F"/></svg>';
  const conUsuario = () => !!(window.SAR_Sesion && window.SAR_Sesion.usuario());
  function pintarCategorias(r) {
    const u = conUsuario();
    r.innerHTML = `<div class="si-wrap"><h2 class="si-t">¿Qué necesitas hacer?</h2>
      <div class="si-home">
        <button type="button" class="si-hbtn" id="si-h-pedir" aria-expanded="${pedirAbierto}"><span class="si-hic">${IC_PEDIR}</span><span class="si-cat-tx"><b>Pedir insumos</b><small>Médicos, aseo u oficina · no necesitas usuario</small></span><i aria-hidden="true">${pedirAbierto ? '▴' : '▾'}</i></button>
        ${pedirAbierto ? `<div class="si-cats si-cats--sub">${CATS.map(c => `<button type="button" class="si-cat si-cat--${c.k}" data-cat="${c.k}"><span class="si-cat-ic">${c.ic}</span><span class="si-cat-tx"><b>${c.t}</b><small>${c.s}</small></span><i aria-hidden="true">›</i></button>`).join('')}</div>` : ''}
        <button type="button" class="si-hbtn si-hbtn--inv" id="si-h-inv"><span class="si-hic">${IC_INV}</span><span class="si-cat-tx"><b>Inventario de bodega</b><small>${u ? 'Sesión de ' + esc(window.SAR_Sesion.usuario()) : 'Para encargadas de bodega · con tu usuario'}</small></span><i aria-hidden="true">›</i></button>
      </div>
      ${u ? `<div id="si-inv"></div><div id="si-ses">${sesionHTML()}</div>` : ''}<div id="si-mias"></div></div>`;
    if (u && window.SAR_InvMovil) window.SAR_InvMovil.boton(document.getElementById('si-inv'), { soloAvisos: true });
    pintarMias();
  }
  /** Ingreso con usuario, solo para el inventario. */
  function pintarLogin(r) {
    sesForm = true;
    r.innerHTML = `<div class="si-wrap"><div class="si-catsel si-cat--inv"><span class="si-cat-ic">${IC_INV}</span><span><small>Inventario de bodega</small><b>Ingresa con tu usuario</b></span><button type="button" class="btn btn-secondary btn-sm" id="si-volver">Volver</button></div>
      <p class="si-s">El inventario mueve el stock, por eso necesita tu usuario (el mismo del Visor). Pedir insumos no lo necesita.</p>${sesionHTML()}</div>`;
    const c = document.getElementById('si-ses-c'); if (c) setTimeout(() => c.focus(), 50);
  }
  function abrirInventario() {
    const I = window.SAR_InvMovil, rolOk = /^(transitoria|admin|superadmin|operador|administrador|global)$/i.test(String(window.SAR_Rol || ''));
    if (!conUsuario()) { vista = 'login'; pintarPide(); return; }
    if (!rolOk) { toast('Sin inventario asignado', 'Tu usuario no tiene una bodega para inventariar. Avísale a bodega.', 'warning'); return; }
    vista = ''; if (I && I.abrir) I.abrir();
  }
  // Ícono de cámara con el trazo del Visor (reemplaza el emoji).
  const IC_CAM = '<svg class="si-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="10" r="1" fill="#8CC63F"/></svg>';
  /** Productos del tipo elegido en todas las bodegas, sin repetir (quien pide no elige bodega). */
  function listaTodos() { const m = new Map(); bodegas.forEach(b => listaDe(b, '*').forEach(p => { const k = norm(p.nombre); if (!m.has(k)) m.set(k, { ...p, bodega: b }); })); return [...m.values()]; }
  let eligiendo = '';
  function listaCat() { const m = new Map(); bodegas.forEach(b => listaDe(b, catSel).forEach(p => { const k = norm(p.nombre); if (!m.has(k)) m.set(k, { ...p, bodega: b }); })); return [...m.values()].sort((x, y) => x.nombre.localeCompare(y.nombre, 'es')); }
  /** Búsqueda por palabras: cada palabra escrita debe estar en el nombre (en cualquier orden, «cat 22» encuentra «Catéter … 22G»). */
  function buscarEn(lista, texto) { const t = norm(texto).split(' ').filter(Boolean); if (!t.length) return []; return lista.filter(p => { const n = norm(p.nombre); return t.every(w => n.includes(w)); }).sort((x, y) => (norm(y.nombre).startsWith(t[0]) ? 1 : 0) - (norm(x.nombre).startsWith(t[0]) ? 1 : 0)); }
  /** Bodega a la que va la solicitud: la que tiene más de los productos pedidos; si son todos a mano, la que tiene más productos de ese tipo. */
  /** Bodega transitoria (destino de los insumos médicos que se piden): del catálogo público o de Bodegas. */
  let destinosStaff = {};
  /** Bodega de uso que recibe los pedidos de ese tipo (transitoria → médicos, bodega de aseo, de oficina). Vacío = se entrega como salida. */
  function destinoDe(cat) { const d = (window.SAR_CatalogoPublico && window.SAR_CatalogoPublico.destinos) || destinosStaff; return (d && d[cat]) || ''; }
  function bodegaAuto() {
    const c = {}; lineas.forEach(l => { const i = l.insumoId && insumos.find(x => x.id === l.insumoId) || insumos.find(x => norm(x.name) === norm(l.nombre)); if (i && i.location) c[i.location] = (c[i.location] || 0) + 1; });
    const top = Object.keys(c).sort((x, y) => c[y] - c[x])[0]; if (top) return top;
    return bodegas.slice().sort((x, y) => listaDe(y, catSel).length - listaDe(x, catSel).length)[0] || '';
  }
  function pintarPide() {
    const r = rootPide(); if (!r) return;
    if (!editando && vista === 'login') { if (conUsuario()) vista = ''; else { pintarLogin(r); return; } }
    if (!catSel && !editando) { if (window.SAR_InvMovil && window.SAR_InvMovil.enCurso()) { window.SAR_InvMovil.pintar(r); return; } pintarCategorias(r); return; }
    if (!editando && (cambiandoQuien || !form.solicitante.trim() || !correoOk(form.correo))) { pintarQuien(r); return; }
    const cat = catDe(catSel);
    r.innerHTML = `<div class="si-wrap">
      ${editando ? `<div class="si-edit"><span>Modificando <b>${esc(editando.ver)}</b>: agrega, quita o cambia cantidades y guarda.</span><button type="button" class="btn btn-secondary btn-sm" id="si-edit-x">Cancelar</button></div>` : ''}
      ${cat ? `<div class="si-catsel si-cat--${cat.k}"><span class="si-cat-ic">${cat.ic}</span><span><small>Estás pidiendo</small><b>${cat.t}</b></span>${editando ? '' : '<button type="button" class="btn btn-secondary btn-sm" id="si-cat-x">Cambiar</button>'}</div>` : ''}
      <h2 class="si-t">Solicitud de ${cat ? esc(cat.t.toLowerCase()) : 'insumos'}</h2><p class="si-s">Busca lo que necesitas, agrégalo y envía. Bodega confirmará lo que hay.</p>
      ${quienHTML()}
      <div class="si-dos"><label class="si-l">Servicio / unidad<input id="si-ser" class="si-in" value="${esc(form.servicio)}" placeholder="Ej: Box 3, Urgencia"></label><span></span></div>
      <div class="si-busca">${manualAbierto ? '' : `<label class="si-l">Agregar producto<input id="si-bus" class="si-in" value="${esc(busca)}" placeholder="Escribe las primeras palabras… (${esc((cat || CATS[0]).ej.replace(/^Ej: /, 'ej: '))})" autocomplete="off" enterkeyhint="search"></label><div id="si-res"></div>`}
        ${manualAbierto ? `<div class="si-manbox"><div class="si-cab"><b>Agregar a mano</b><button type="button" class="btn btn-secondary btn-sm" id="si-man-x">Volver a buscar</button></div><small>Escribe el <b>nombre completo</b> (qué es, marca, medida o tamaño). Si puedes, <b>agrega una foto</b> (cámara o galería): de la caja, la etiqueta o uno igual. Si no tienes cómo, describe para qué se usa.</small>
          <div class="si-man"><input id="si-mt" class="si-in" placeholder="${esc((cat || CATS[0]).ej)}" value="${esc(manual.nombre)}" autocomplete="off"><input id="si-mc" class="si-in si-cn" type="number" min="1" value="${manual.cantidad}" inputmode="numeric" aria-label="Cantidad"></div>
          <div id="si-sug"></div>
          <div class="si-man"><label class="btn btn-secondary si-fbtn${manual.foto ? ' si-fbtn--ok' : ''}"><input type="file" accept="image/*" hidden id="si-mf">${manual.foto ? '<img src="' + manual.foto + '" alt="">Cambiar foto' : IC_CAM + 'Foto (opcional)'}</label><button type="button" class="btn btn-primary" id="si-ma">Agregar</button></div>
        </div>` : ''}</div>
      <h3 class="si-h">Tu solicitud (${lineas.length})</h3>
      <div class="si-car">${lineas.map((l, i) => `<div class="si-fila">${l.foto ? `<img class="si-lfoto" src="${l.foto}" alt="">` : ''}<span class="si-fn">${esc(l.nombre)}${l.manual ? ' <em>escrito a mano</em>' : ''}</span><span class="si-q"><button type="button" data-m="${i}" aria-label="Uno menos">−</button><input class="si-qn" type="number" min="1" inputmode="numeric" value="${l.cantidad}" data-qn="${i}" aria-label="Cantidad de ${esc(l.nombre)}"><button type="button" data-p="${i}" aria-label="Uno más">+</button></span><button type="button" class="si-x" data-x="${i}" aria-label="Quitar">✕</button></div>`).join('') || '<p class="si-v">Aún no agregas nada.</p>'}</div>
      <label class="si-l">Nota (opcional)<input id="si-not" class="si-in" value="${esc(form.nota)}" placeholder="Ej: urgente para hoy"></label>
      <button type="button" class="btn btn-primary si-env" id="si-env"${enviando ? ' disabled' : ''}>${editando ? 'Guardar cambios' : 'Enviar solicitud'}</button>
      <p class="si-v" id="si-red"></p><div id="si-mias"></div></div>`;
    estadoRed(); if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(r); pintarRes(); pintarSug(); pintarMias();
  }
  /** Coincidencias mientras se escribe; al final, «No está en la lista» abre el ingreso a mano con foto. */
  /** Coincidencias mientras se escribe. Al tocar una, aparece el recuadro de cantidad y «Agregar».
   *  Si no hay en el tipo elegido, se buscan en los otros tipos (puede estar clasificado distinto) antes de «No está». */
  function pintarRes() {
    const el = document.getElementById('si-res'); if (!el) return; const q = busca.trim();
    if (q.length < 2) { el.innerHTML = ''; return; }
    let exacto = buscarEn(listaCat(), q), otros = false;
    if (!exacto.length && catSel && catSel !== '*') { const o = buscarEn(listaTodos(), q); if (o.length) { exacto = o; otros = true; } }
    const res = exacto.length ? exacto : parecidos(q, listaCat(), 8), vis = res.slice(0, 12), cat = catDe(catSel);
    const fila = (x) => { const on = eligiendo === norm(x.nombre), ot = otros && x.tipo !== catSel ? catDe(x.tipo) : null;
      return `<div class="si-pr${on ? ' on' : ''}"><button type="button" class="si-p" data-elige="${esc(x.nombre)}" data-id="${esc(x.id)}" aria-expanded="${on}">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(x.nombre, { codigo: x.codigo }) : ''}<span>${esc(x.nombre)}${ot ? `<small class="si-otro">está en ${esc(ot.t)}</small>` : ''}</span><b>${on ? '' : '+'}</b></button>
        ${on ? `<div class="si-pq"><span>Cantidad</span><button type="button" class="si-pqb" data-pq="-1" aria-label="Uno menos">−</button><input id="si-pq-in" class="si-qn" type="number" min="1" value="1" inputmode="numeric" enterkeyhint="done" aria-label="Cantidad de ${esc(x.nombre)}"><button type="button" class="si-pqb" data-pq="1" aria-label="Uno más">+</button><button type="button" class="btn btn-primary" data-add="${esc(x.nombre)}" data-id="${esc(x.id)}">Agregar</button></div>` : ''}</div>`; };
    el.innerHTML = `<div class="si-drop">${otros ? `<p class="si-v">No está en ${esc(cat ? cat.t : 'este tipo')}, pero sí en otro tipo:</p>` : !exacto.length && vis.length ? '<p class="si-v">No hay uno exacto. ¿Es alguno de estos?</p>' : ''}${vis.map(fila).join('')}
      ${res.length > vis.length ? `<p class="si-v">Hay ${res.length - vis.length} más: escribe otra palabra para afinar.</p>` : ''}
      ${vis.length ? '' : '<p class="si-v">No encontré productos con esas palabras.</p>'}
      <button type="button" class="si-noesta" id="si-noesta"><span>${IC_CAM}</span><span><b>No está en la lista</b><small>Agrégalo a mano (foto opcional)</small></span><i aria-hidden="true">›</i></button></div>`;
    if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(el);
    const qi = el.querySelector('#si-pq-in'); if (qi) qi.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const b = el.querySelector('.si-pr.on [data-add]'); if (b) b.click(); } });
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
  /** Lo que bodega no tenía (no hay / parcial), para que quien pidió lo vea de un vistazo. */
  function resumenNoHay(x) { const l = (x.lineas || []).filter(y => !y.soloConteo && (y.estado === 'no_hay' || y.estado === 'parcial')); if (!l.length || x.estado === 'NUEVA') return ''; return `<p class="si-nohay"><b>No disponible:</b> ${l.map(y => `${esc(y.nombre)} (${y.estado === 'no_hay' ? y.cantidad : y.cantidad - num(y.entregar)} u.)`).join(' · ')}</p>`; }
  const miaHTML = (x, k) => `<details class="si-mia"${k === 0 ? ' open' : ''}><summary><span class="si-fn"><b>${x.correlativo ? esc(x.correlativo) : 'N° oficial en camino'}</b><br><small>${esc(x.bodega || '')}${x.creadoEn ? ' · ' + esc(new Date(x.creadoEn).toLocaleString('es-CL')) : ''}</small></span><span class="si-est si-e-${esc(x.estado)}">${esc(x.estado === 'POR_ENVIAR' || x._pend ? 'Por enviar (sin internet)' : (ESTADOS[x.estado] || x.estado))}</span></summary>${recorridoHTML(x._pend ? 'POR_ENVIAR' : x.estado)}${resumenNoHay(x)}
      ${x.conteo ? `<div class="si-mia-l"><span>Inventario ${x.conteo.bodega ? esc(x.conteo.bodega) : ''}</span><span class="si-le si-le-${x.conteo.estado === 'aplicado' ? 'ok' : x.conteo.estado === 'reconteo' ? 'parcial' : 'pendiente'}">${x.conteo.estado === 'aplicado' ? '✔ Aceptado por bodega' : x.conteo.estado === 'reconteo' ? 'Recontar: bodega lo pidió' : x.conteo.estado === 'recontado' ? 'Reconteo enviado' : 'Bodega lo revisa'}</span></div>` : ''}${(x.lineas || []).filter(l => !l.soloConteo).map(l => `<div class="si-mia-l"><span>${esc(l.nombre)} × ${l.cantidad}${num(l.reiterado) > 1 ? ' <em class="si-reit">sigue faltando</em>' : ''}</span>${chipL(l)}</div>`).join('')}${x.estado === 'LISTA' && esRepo(x) && /transitoria/i.test(String(window.SAR_Rol || '')) ? (x.recibidoSolicitado ? '<p class="si-v">Marcaste recibido: bodega lo registra en un momento.</p>' : `<div class="si-lb"><small>¿Ya llegó a ${esc(x.bodega)}?</small><button type="button" class="btn btn-primary btn-sm" data-recibi="${esc(x.numero)}">Recibido</button></div>`) : ''}${x.estado === 'NUEVA' && !x.conteo && misDatos[x.numero] ? `<div class="si-lb"><small>Mientras bodega no empiece a prepararla puedes cambiarla.</small><button type="button" class="btn btn-primary btn-sm" data-mod="${esc(x.numero)}">Modificar</button></div>` : ''}</details>`;
  // Quien pide (página pública): sus solicitudes en vivo (solo las de este teléfono), buscador y aviso cuando cambian de estado (v21.211)
  let misSub = null, misLista = [], misQ = '', misUid = '';
  /** Al entrar o salir con usuario cambia el uid: se vuelve a escuchar lo de esa cuenta. */
  function reiniciarMias() { if (typeof misSub === 'function') { try { misSub(); } catch (e) { /* ya cerrada */ } } misSub = null; misLista = []; misDatos = {}; }
  if (typeof window.addEventListener === 'function') window.addEventListener('sar-rol', () => { const au = window.firebaseAuth && window.firebaseAuth.currentUser; if (!au || au.uid !== misUid) reiniciarMias(); });
  const TXT_AV = { PREPARACION: 'Bodega la está revisando.', LISTA: 'Bodega ya preparó tus productos. Revisa el detalle.', ENTREGADA: 'Solicitud cerrada: entregada.', ANULADA: 'Bodega la anuló.' };
  function vigilarMias() {
    if (misSub) return true; const f = fs(), au = window.firebaseAuth && window.firebaseAuth.currentUser; if (!au || !f.onSnapshot) return false;
    try {
      misUid = au.uid;   // con metadatos: al confirmar el servidor, «Por enviar» cambia solo (v21.212)
      misSub = f.onSnapshot(f.query(f.collection(db(), COL), f.where('uid', '==', au.uid)), { includeMetadataChanges: true }, (sn) => {
        const l = []; sn.forEach(d => { if (d.data().tipo === TIPO) l.push({ ...limpiarSol(d.data(), d.id), _col: COL, _pend: !!(d.metadata && d.metadata.hasPendingWrites) }); });
        misLista = l.sort((a, b) => String(b.creadoEn).localeCompare(String(a.creadoEn))); misDatos = {}; misLista.forEach(x => { misDatos[x.numero] = x; });
        let vistos = {}; try { vistos = JSON.parse(localStorage.getItem('si-estados') || '{}'); } catch (e) { vistos = {}; }
        misLista.forEach(x => { const antes = vistos[x.numero]; if (antes && antes !== x.estado && TXT_AV[x.estado]) avisar({ titulo: `Solicitud ${x.correlativo || x.numero} ${String(ESTADOS[x.estado]).toLowerCase()}`, texto: TXT_AV[x.estado], estado: AV_EST[x.estado], boton: 'Ver', alTocar: () => { misQ = x.correlativo || x.numero; pintarMiasLista(); const e = document.getElementById('si-mias'); if (e) e.scrollIntoView({ behavior: 'smooth' }); } }); vistos[x.numero] = x.estado; });
        try { localStorage.setItem('si-estados', JSON.stringify(vistos)); } catch (e) { /* sin almacenamiento */ }
        pintarMiasLista(); if (window.SAR_InvMovil) { const e = document.getElementById('si-inv'); if (e) window.SAR_InvMovil.boton(e); }
      }, () => { misSub = null; });
      return true;
    } catch (e) { misSub = null; return false; }
  }
  function pintarMiasLista() {
    const el = document.getElementById('si-mias'); if (!el) return;
    if (!misLista.length) { el.innerHTML = ''; return; }
    if (!el.querySelector('#si-mq')) el.innerHTML = `<div class="si-cab"><h3 class="si-h">Tus solicitudes</h3><small class="si-v">${misLista.length} en total</small></div><input id="si-mq" class="si-in" type="search" value="${esc(misQ)}" placeholder="Buscar por N° de solicitud (SOL-…) o producto" autocomplete="off" aria-label="Buscar tus solicitudes"><div id="si-mias-l" class="si-car"></div>`;
    const q = el.querySelector('#si-mq'); if (q && q.value !== misQ && document.activeElement !== q) q.value = misQ;
    const l = misLista.filter(x => coincideSol(x, misQ)).slice(0, misQ ? 30 : 8);
    const c = el.querySelector('#si-mias-l'); c.innerHTML = l.map((x, k) => miaHTML(x, misQ ? 0 : k)).join('') || '<p class="si-v">No encontré solicitudes con eso.</p>';
    c.querySelectorAll('[data-mod]').forEach(b => b.onclick = () => editar(b.dataset.mod));
    c.querySelectorAll('[data-recibi]').forEach(b => b.onclick = async () => { const x = misDatos[b.dataset.recibi]; if (!x) return; const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: '¿Llegó todo?', texto: `${esc(x.correlativo || x.numero)} a ${esc(x.bodega)}.`, lineas: (x.lineas || []).filter(l => !l.soloConteo && num(l.entregar) > 0).map(l => `${esc(l.asociado || l.nombre)} · <b>${num(l.entregar)}</b>`), si: 'Recibido' }) : confirm('¿Recibido?'); if (!ok) return;
      b.disabled = true; const f = fs(), ahora = new Date().toISOString(), yo = (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || form.correo; try { const sn = await f.getDoc(f.doc(f.collection(db(), COL), x.numero)); await f.updateDoc(f.doc(f.collection(db(), COL), x.numero), { recibidoSolicitado: { por: yo, en: ahora }, historial: (sn.data().historial || []).concat([{ estado: 'LISTA', por: yo, en: ahora, nota: 'Recibido en ' + x.bodega }]) }); avisar({ titulo: 'Recibido', texto: 'Bodega lo registra en tu bodega en un momento.', estado: 'cerrada' }); } catch (e) { b.disabled = false; toast('No se pudo', esc(e.message || e), 'error'); } });
  }
  async function pintarMias() {
    const el = document.getElementById('si-mias'); if (!el) return;
    if (publica() && vigilarMias()) { pintarMiasLista(); return; }
    let l = [];
    try { l = JSON.parse(localStorage.getItem('si-mias') || '[]'); } catch (e) { l = []; } if (!l.length) { el.innerHTML = ''; return; }
    const f = fs(); misDatos = {}; const filas = await Promise.all(l.slice(0, 6).map(async (n) => { try { let d = await f.getDoc(f.doc(f.collection(db(), COL), n)); if (!d.exists() && !publica()) d = await f.getDoc(f.doc(f.collection(db(), COL_ANT), n)).catch(() => d); if (d.exists()) { const x = { ...limpiarSol(d.data(), d.id), _col: d.ref && d.ref.parent ? d.ref.parent.id : COL }; misDatos[n] = x; return x; } return { numero: n, estado: 'POR_ENVIAR' }; } catch (e) { return { numero: n, estado: 'POR_ENVIAR' }; } }));
    el.innerHTML = `<div class="si-cab"><h3 class="si-h">Tus últimas solicitudes</h3><button type="button" class="btn btn-secondary btn-sm" id="si-mias-act">Actualizar</button></div><div class="si-car">${filas.map(miaHTML).join('')}</div>`;
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
    const ahora = new Date(), numero = numeroSolicitud(ahora), f = fs(); const bt = destinoDe(catSel); bodegaSel = bt || bodegaAuto();
    const au = window.firebaseAuth && window.firebaseAuth.currentUser, data = { tipo: TIPO, numero, estado: 'NUEVA', uid: (au && au.uid) || '', requester: (au && au.email) || form.correo.trim().toLowerCase(), solicitante: form.solicitante.trim(), correo: form.correo.trim().toLowerCase(), servicio: form.servicio.trim(), bodega: bodegaSel, ...(bt ? { destino: 'transitoria' } : {}), ...(catDe(catSel) ? { categoria: catSel } : {}), nota: form.nota.trim(), lineas: lineas.map(l => ({ ...l })), creadoEn: ahora.toISOString(), historial: [{ estado: 'NUEVA', por: usuario(), en: ahora.toISOString() }] };
    const p = f.setDoc(f.doc(f.collection(db(), COL), numero), data);
    const r = await Promise.race([p.then(() => 'ok'), new Promise(res => setTimeout(() => res('cola'), 2500))]).catch(e => 'error:' + (e.message || e));
    enviando = false;
    if (String(r).startsWith('error')) { toast('No se envió', String(r).slice(6) || 'Revisa tu conexión e intenta de nuevo.', 'error'); pintarPide(); return; }
    p.catch(() => { /* se reintenta sola al volver internet */ });
    try { const m = JSON.parse(localStorage.getItem('si-mias') || '[]'); m.unshift(numero); localStorage.setItem('si-mias', JSON.stringify(m.slice(0, 20))); } catch (e) { /* sin almacenamiento */ }
    lineas = []; busca = ''; form.nota = ''; bodegaSel = ''; catSel = ''; manualAbierto = false; pintarPide();
    if (window.SAR_Progreso && window.SAR_Progreso.exito) window.SAR_Progreso.exito({ titulo: r === 'ok' ? 'Solicitud enviada' : 'Guardada en el teléfono', texto: r === 'ok' ? 'Bodega ya la puede ver. Abajo verás cómo avanza.' : 'Se enviará sola cuando haya internet.' });
    const r2 = rootPide(); if (r2) r2.insertAdjacentHTML('afterbegin', `<div class="si-ok"><b>${r === 'ok' ? 'Solicitud enviada' : 'Solicitud guardada en el teléfono'}</b><br>${r === 'ok' ? 'Bodega le asigna el N° oficial (SOL-…) al recibirla. La ves abajo en «Tus solicitudes».' : 'Se enviará sola cuando haya internet.'}</div>`);
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
      if (e.target.id === 'si-bus') { busca = e.target.value; eligiendo = ''; pintarRes(); }
      if (e.target.id === 'si-mq') { misQ = e.target.value; pintarMiasLista(); }
      if (e.target.dataset && e.target.dataset.qn !== undefined) { const l = lineas[+e.target.dataset.qn]; if (l) l.cantidad = Math.max(1, Math.min(9999, Math.floor(num(e.target.value) || 1))); } });
    r.addEventListener('submit', async (e) => { if (e.target.id !== 'si-ses-f') return; e.preventDefault(); const c = document.getElementById('si-ses-c'), p = document.getElementById('si-ses-p'); if (!window.SAR_Sesion || sesEntrando) return;
      sesEntrando = true; const correo = c.value, clave = p.value; const btn = e.target.querySelector('[type=submit]'); if (btn) { btn.disabled = true; btn.textContent = 'Ingresando…'; }
      try { await window.SAR_Sesion.entrar(correo, clave); sesForm = false; if (vista === 'login') { vista = ''; window.__abrirInvTrasLogin = true; } toast('Sesión iniciada', 'Abriendo el inventario…', 'success'); }
      catch (er) { const m = String(er && er.code || ''); toast('No se pudo ingresar', /wrong-password|invalid-credential|user-not-found|invalid-email/.test(m) ? 'Correo o contraseña incorrectos.' : /network/.test(m) ? 'Sin internet: para ingresar se necesita conexión.' : m === 'pendientes' ? esc(er.message) : 'Intenta de nuevo (' + esc(m) + ').', 'error'); }
      sesEntrando = false; pintarPide(); });
    r.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; leerCampos();
      if (b.dataset.elige) { const k = norm(b.dataset.elige); eligiendo = eligiendo === k ? '' : k; pintarRes(); const i = document.getElementById('si-pq-in'); if (i) { i.focus({ preventScroll: true }); i.select(); i.closest('.si-pr').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } return; }
      if (b.dataset.pq) { const i = document.getElementById('si-pq-in'); if (i) i.value = Math.max(1, Math.floor(num(i.value) || 1) + Number(b.dataset.pq)); return; }
      if (b.dataset.add) { const qi = document.getElementById('si-pq-in'), cant = Math.max(1, Math.min(9999, Math.floor(num(qi && qi.value) || 1))); eligiendo = ''; agregarLinea(lineas, { nombre: b.dataset.add, cantidad: cant }); if (lineas.length) { const l = lineas.find(x => norm(x.nombre) === norm(b.dataset.add)); if (l && b.dataset.id) l.insumoId = b.dataset.id; } busca = ''; pintarPide(); const sb = document.getElementById('si-bus'); if (sb) sb.focus({ preventScroll: true }); toast('Agregado', `${cant} × ${esc(b.dataset.add)}`, 'success'); }
      else if (b.id === 'si-noesta') { manualAbierto = true; manual.nombre = manual.nombre || busca.trim(); busca = ''; pintarPide(); const t = document.getElementById('si-mt'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
      else if (b.id === 'si-man-x') { manualAbierto = false; manual = { nombre: '', cantidad: 1, foto: '' }; pintarPide(); const t = document.getElementById('si-bus'); if (t) t.focus(); }
      else if (b.id === 'si-ma') {
        const t = document.getElementById('si-mt'), c = document.getElementById('si-mc'); manual.nombre = t ? t.value : manual.nombre; manual.cantidad = Math.max(1, Math.floor(num(c && c.value) || 1));
        const nom = manual.nombre.trim();
        if (nom.split(/\s+/).length < 2 || nom.length < 8) { toast('Nombre completo', 'Escribe el nombre completo del producto (qué es, medida o tamaño).', 'warning'); return; }
        if (!manual.foto && (nom.split(/\s+/).length < 3 || nom.length < 15)) { toast('Más detalle', 'Sin foto, describe un poco más: qué es, marca, medida o para qué se usa.', 'warning'); return; }
        lineas.push({ nombre: nom, cantidad: manual.cantidad, manual: true, foto: manual.foto }); manual = { nombre: '', cantidad: 1, foto: '' }; manualAbierto = false; pintarPide();
      }
      else if (b.dataset.sug) { agregarLinea(lineas, { nombre: b.dataset.sug, cantidad: manual.cantidad || 1 }); const l = lineas.find(x => norm(x.nombre) === norm(b.dataset.sug)); if (l && b.dataset.id) l.insumoId = b.dataset.id; manual = { nombre: '', cantidad: 1, foto: '' }; manualAbierto = false; pintarPide(); }
      else if (b.dataset.p !== undefined) { lineas[+b.dataset.p].cantidad++; pintarPide(); }
      else if (b.dataset.m !== undefined) { const l = lineas[+b.dataset.m]; l.cantidad = Math.max(1, l.cantidad - 1); pintarPide(); }
      else if (b.dataset.x !== undefined) { lineas.splice(+b.dataset.x, 1); pintarPide(); }
      else if (b.id === 'si-env') enviar();
      else if (b.id === 'si-q-ok') { const n = document.getElementById('si-q-nom'), c = document.getElementById('si-q-cor'); const nn = n ? n.value.trim() : '', cc = c ? c.value.trim() : '';
        if (nn.split(/\s+/).length < 2) { toast('Tu nombre', 'Escribe tu nombre y apellido.', 'warning'); return; } if (!correoOk(cc)) { toast('Tu correo', 'Escribe un correo válido (ej: nombre@cormumel.cl).', 'warning'); return; }
        form.solicitante = nn; form.correo = cc; cambiandoQuien = false; try { const y = JSON.parse(localStorage.getItem('si-yo') || '{}'); localStorage.setItem('si-yo', JSON.stringify({ ...y, n: nn, c: cc })); } catch (e) { /* sin almacenamiento */ } pintarPide(); }
      else if (b.id === 'si-q-x') { cambiandoQuien = true; pintarPide(); }
      else if (b.id === 'si-h-pedir') { pedirAbierto = !pedirAbierto; pintarPide(); }
      else if (b.id === 'si-h-inv') abrirInventario();
      else if (b.id === 'si-volver') { vista = ''; sesForm = false; cambiandoQuien = false; catSel = ''; pintarPide(); window.scrollTo && window.scrollTo(0, 0); }
      else if (b.id === 'si-ses-in') { sesForm = true; pintarPide(); const c = document.getElementById('si-ses-c'); if (c) c.focus(); }
      else if (b.id === 'si-ses-cancel') { sesForm = false; vista = ''; pintarPide(); }
      else if (b.id === 'si-ses-x') { if (window.SAR_Sesion) window.SAR_Sesion.salir().then(() => { sesForm = false; toast('Sesión cerrada', 'Sigues pudiendo pedir sin usuario.', 'info'); }); }
      else if (b.id === 'si-edit-x') { editando = null; lineas = []; bodegaSel = ''; catSel = ''; form.nota = ''; pintarPide(); }
      else if (b.dataset.cat) { catSel = b.dataset.cat; bodegaSel = ''; busca = ''; pintarPide(); window.scrollTo && window.scrollTo(0, 0); }
      else if (b.id === 'si-cat-x') { cambiarCategoria(); }
    });
    window.addEventListener('online', () => { estadoRed(); if (publica()) { cargado = false; cargarBase().then(() => { const a = document.activeElement; if (a && /INPUT|TEXTAREA/.test(a.tagName)) return; leerCampos(); pintarPide(); }).catch(() => {}); } });   // no borra lo que se está escribiendo   // al volver internet: lista y estados al día
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
  async function asignarCorrelativos(lista) {
    if (asignando) return; const sin = (lista || solicitudes).filter(x => !x.correlativo && x._col === COL).sort((a, b) => String(a.creadoEn).localeCompare(String(b.creadoEn))); if (!sin.length) return;
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
  let solicitudes = [], desuscribir = null, filtro = 'ABIERTAS', bq = '';
  const coincideSol = (s, q) => { const t = norm(q).split(' ').filter(Boolean); if (!t.length) return true; const h = norm([s.correlativo, s.numero, s.solicitante, s.correo, s.servicio, s.bodega, ...(s.lineas || []).map(l => l.nombre + ' ' + (l.asociado || ''))].join(' ')); return t.every(w => h.includes(w)); };
  const rootBandeja = () => document.getElementById('si-bandeja');
  // ---- checklist por producto: lotes candidatos (bodega · estante · lote · vence) y reparto FEFO ----
  const lotesDeDoc = (d) => (Array.isArray(d.batches) && d.batches.length ? d.batches : (num(d.quantity) > 0 ? [{ batch: d.batch || 'S/L', quantity: num(d.quantity), expirationDate: d.expirationDate || '' }] : []));
  /** Lotes con saldo de este producto en cualquier bodega. Primero la bodega a la que se pidió (no hay que mover), luego lo que vence antes. */
  function lotesCandidatos(l, lista, bodegaPedida, sinDestino) {
    const k = norm(l.asociado || l.nombre), out = [];
    lista.filter(i => ((l.insumoId && i.id === l.insumoId) || norm(i.name) === k) && i.status !== 'CUARENTENA' && i.location !== TRANSITO && !(sinDestino && i.location === bodegaPedida)).forEach(i => lotesDeDoc(i).forEach(b => { const disp = num(b.quantity); if (disp > 0) out.push({ insumoId: i.id, bodega: i.location || '', estante: i.ubicacionEstante || '', clave: String(b.batch || 'S/L') + '|' + String(b.expirationDate || ''), lote: b.batch || 'S/L', vence: b.expirationDate || '', disp }); }));
    return out.sort((a, b) => ((a.bodega === bodegaPedida ? 0 : 1) - (b.bodega === bodegaPedida ? 0 : 1)) || (a.vence || '9999').localeCompare(b.vence || '9999'));
  }
  /** Reparte lo pedido entre los lotes en ese orden. Devuelve [cantidad por lote]. */
  function repartir(cands, pide) { let falta = Math.max(0, num(pide)); return cands.map(c => { const q = Math.min(c.disp, falta); falta -= q; return q; }); }
  /** Estado de una línea según lo que bodega confirmó. */
  function estadoLinea(pide, entregar, noHay) { if (noHay) return 'no_hay'; const e = num(entregar); return e <= 0 ? 'pendiente' : e >= num(pide) ? 'ok' : 'parcial'; }
  /** Reposición de una bodega de uso (transitoria, aseo, oficina): el stock sale de las OTRAS bodegas, pasa por «En tránsito»
   *  al procesar y entra a la bodega cuando se marca «Recibido» (v21.212). Lo demás se entrega como salida por lote. */
  const esRepo = (s) => s.origen === 'transitoria' || s.destino === 'transitoria';
  const TRANSITO = 'En tránsito';
  const grupoDe = (x) => `${x.insumoId}|${x.clave}`;
  const gruposDe = (l) => (l.seleccion || []).filter(x => num(x.qty) > 0).map(grupoDe);
  // l.movido === true: solicitud de una versión anterior (v21.211 o antes) ya traída a su bodega: cuenta como movida y recibida
  const tocadaL = (l) => l.movido === true || (l.movidos || []).length > 0;
  const movidaL = (l) => l.movido === true || l.estado === 'no_hay' || l.soloConteo || (gruposDe(l).length > 0 && gruposDe(l).every(k => (l.movidos || []).includes(k)));
  const recibidaL = (l) => l.movido === true || !(l.movidos || []).length || (l.movidos || []).every(k => (l.recibidos || []).includes(k));
  /** Solicitudes ya procesadas antes de v21.212 (sin marcas por lote): no se vuelve a mover nada; solo se pueden cerrar. */
  const legado = (s) => (s.estado === 'LISTA' || s.estado === 'ENTREGADA') && !(s.lineas || []).some(l => Array.isArray(l.movidos)) && String(s.creadoEn || '') < '2026-11-16';
  const ocupado = new Set();   // solicitudes procesándose en esta sesión: el botón queda bloqueado
  const candDe = (l, s) => lotesCandidatos(l, insumos, s.bodega, esRepo(s));
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
    if (tocadaL(l)) { toast('Ya movido', 'Este producto ya salió de su bodega: no se puede cambiar la asociación.', 'warning'); return; }
    if (nombreInv) { const d = insumos.find(x => norm(x.name) === norm(nombreInv) && x.location !== s.bodega && x.location !== TRANSITO) || insumos.find(x => norm(x.name) === norm(nombreInv)); lin[i] = { ...l, asociado: nombreInv, ...(d ? { insumoId: d.id } : {}), insumoIdOrig: l.insumoIdOrig !== undefined ? l.insumoIdOrig : (l.insumoId || ''), asociadoPor: usuario() }; delete lin[i].estado; delete lin[i].seleccion; delete lin[i].entregar; }
    else { const x = { ...l }; delete x.asociado; delete x.asociadoPor; if (x.insumoIdOrig) x.insumoId = x.insumoIdOrig; else delete x.insumoId; delete x.insumoIdOrig; delete x.estado; delete x.seleccion; delete x.entregar; lin[i] = x; }
    asoc = null; s.lineas = lin; pintarBandeja();
    try { const c = await guardarLinea(s, i, lin[i], { nombreOrig: l.nombre }); Object.assign(s, c); pintarBandeja(); } catch (e) { toast('No se guardó', esc(e.message || String(e)), 'error'); return; }
    if (nombreInv && norm(l.nombre) !== norm(nombreInv)) { alias[norm(l.nombre)] = nombreInv; f.setDoc(f.doc(f.collection(db(), 'Contadores'), ALIAS_ID), { tipo: 'alias-solicitudes', items: alias, actualizado: new Date().toISOString() }).catch(() => {}); }
    toast('Asociado', nombreInv ? `Se moverá y descontará como «${esc(nombreInv)}».` : 'Asociación quitada.', 'success');
  }
  const escritas = {};   // lo que bodega va escribiendo en «Sacar»: sobrevive a las actualizaciones en vivo
  const revs = {};   // revisión de inventarios por solicitud
  async function cargarRevision(s) { const ver = String((s.conteo || {}).recontadoEn || (s.conteo || {}).fin || ''); revs[s.numero] = { estado: 'cargando', ver }; try { const F = await window.SAR_Transitoria.revisar(s); const pre = new Set(F.filter(x => x.usado > 0 && x.alContar > 0 && x.usado / x.alContar >= 0.3).map(x => x.k)); revs[s.numero] = { estado: 'ok', filas: F, sel: pre, ver }; } catch (e) { revs[s.numero] = { estado: 'error', error: e.message || String(e), ver }; } pintarBandeja(); }
  let abiertoL = {}, sel = '';   // sel: solicitud abierta en el panel lateral ('' = la primera; null = cerrado)   // numero|i → mostrar lotes aunque ya esté decidida

  function pintarBandeja() {
    const r = rootBandeja(); if (!r) return;
    if (asoc) queueMicrotask(() => { const x = r.querySelector('.si-asoc-in'); if (x && document.activeElement !== x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } });
    const ab = (s) => s.estado !== 'ENTREGADA' && s.estado !== 'ANULADA', vis = solicitudes.filter(s => (bq.trim() ? true : filtro === 'TODAS' ? true : filtro === 'ABIERTAS' ? ab(s) : s.estado === filtro) && coincideSol(s, bq));
    const enfocado = document.activeElement && document.activeElement.id === 'si-bq';
    if (enfocado) queueMicrotask(() => { const x = r.querySelector('#si-bq'); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } });
    const IM = window.SAR_Imagenes;
    // «Costado»: en pantallas anchas la lista queda a la izquierda y el detalle se abre al lado, sin perder la lista
    const costado = window.innerWidth >= 1000;
    if (costado && (!sel || !vis.some(x => x.numero === sel)) && sel !== null) sel = vis.length ? vis[0].numero : '';
    const asocHTML = (s, l, i) => {
      if (l.asociado) return `<div class="si-asoc si-asoc--ok"><small>${l.manual ? 'Pedido como «' + esc(l.nombre) + '» · ' : ''}asociado a <b>${esc(l.asociado)}</b></small><button type="button" class="btn btn-secondary btn-sm" data-desasoc="${i}">Quitar asociación</button></div>`;
      const ali = aliasDe(l), abierto = asoc && asoc.n === s.numero && asoc.i === i;
      if (!l.manual && !abierto && candDe(l, s).length) return '';
      return `<div class="si-asoc">${ali ? `<button type="button" class="btn btn-primary btn-sm" data-asocsi="${i}" data-nom="${esc(ali)}">¿Es «${esc(ali)}»? Asociar (ya lo asociaste antes)</button>` : ''}
        ${abierto ? `<input class="si-in si-asoc-in" data-i="${i}" value="${esc(asoc.q)}" placeholder="Buscar en el inventario (nombre del fabricante)…" autocomplete="off" aria-label="Buscar producto para asociar"><div class="si-asoc-res">${resAsoc(asoc.q)}</div>` : `<button type="button" class="btn btn-secondary btn-sm" data-asoc="${i}">Asociar a producto del inventario</button>`}</div>`; };
    const cuadreHTML = (s) => { const c = s.conteo, us = (c.descontado || []).reduce((t, x) => t + num(x.usado), 0);
      if (c.estado === 'aplicado') return `<div class="si-cuadre si-cuadre--ok"><b>Inventario aceptado</b> · se descontaron <b>${us}</b> u. usadas en ${(c.descontado || []).length} producto(s)${c.aplicadoPor ? ' · ' + esc(c.aplicadoPor) : ''}${(c.sobrantes || []).length ? ` · sobran: ${c.sobrantes.map(x => esc(x.nombre) + ' +' + x.sobrante).join(', ')} (no se suman solos)` : ''}<details><summary>Ver detalle</summary>${(c.descontado || []).map(x => `<div>${esc(x.nombre)}: sistema ${x.sistema} · contado ${x.contado} · <b>usado ${x.usado}</b></div>`).join('') || 'Sin diferencias.'}</details></div>`;
      if (c.estado === 'reconteo') return `<div class="si-cuadre si-cuadre--esp"><b>Reconteo pedido</b> de ${(c.reconteo || []).length} producto(s)${c.reconteoPedidoEn ? ' · ' + esc(new Date(c.reconteoPedidoEn).toLocaleString('es-CL')) : ''}. Cuando lo envíen, lo revisas aquí.</div>`;
      const ver = String(c.recontadoEn || c.fin || ''); let rv = revs[s.numero]; if (rv && rv.ver !== ver) { delete revs[s.numero]; rv = null; }
      if (!rv || rv.estado === 'cargando') { if (!rv) cargarRevision(s); return '<div class="si-cuadre">Calculando lo usado por producto…</div>'; }
      if (rv.estado === 'error') return `<div class="si-cuadre si-cuadre--mal"><b>No pude revisar el inventario:</b> ${esc(rv.error)} <button type="button" class="btn btn-secondary btn-sm" data-rev="1">Reintentar</button></div>`;
      const F = rv.filas, us2 = F.reduce((t, x) => t + x.usado, 0), dif = F.filter(x => x.usado > 0 || x.sobra > 0).length;
      return `<div class="si-cuadre si-cuadre--rev"><b>Inventario por revisar${c.estado === 'recontado' ? ' · ya recontado' : ''}</b><small>Usado = lo que había al contar − lo contado. Lo que entró o salió de ${esc(s.bodega)} después del conteo ya está descontado del cálculo.</small>
        <div class="fp-tw"><table class="si-tb si-rv"><thead><tr><th><span class="sr-only">Recontar</span></th><th>Producto</th><th title="Lo que había según el sistema al momento de contar">Sistema</th><th>Contó</th><th>Usado</th></tr></thead><tbody>${F.map(x => `<tr class="${x.usado > 0 ? 'si-rv-u' : x.sobra > 0 ? 'si-rv-s' : ''}"><td><input type="checkbox" class="si-rc" data-k="${esc(x.k)}"${rv.sel.has(x.k) ? ' checked' : ''} aria-label="Pedir reconteo de ${esc(x.nombre)}"></td><td>${esc(x.nombre)}${x.recontado ? ' <em class="si-tag">recontado</em>' : ''}${x.movPost ? ` <small>(${x.movPost > 0 ? '+' : ''}${x.movPost} movido después)</small>` : ''}</td><td>${x.alContar}</td><td>${x.contado}</td><td><b>${x.usado}</b>${x.sobra ? ` <small>sobran ${x.sobra}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="si-lb"><small>${us2} u. usadas · ${dif} con diferencia</small><button type="button" class="btn btn-secondary btn-sm" data-reconteo="1">Pedir reconteo (${rv.sel.size})</button><button type="button" class="btn btn-primary btn-sm" data-aceptar="1">Aceptar y descontar</button></div></div>`; };
    const cardHTML = (s) => {
        return `<article class="si-card" data-n="${esc(s.numero)}"><header><b>${esc(s.correlativo || s.numero)}</b>${s.correlativo ? '' : ' <small>(asignando N°…)</small>'}<span class="si-est si-e-${esc(s.estado)}">${esc(ESTADOS[s.estado] || s.estado)}</span></header>
        <p class="si-m">${esc(s.solicitante || s.requester)}${s.correo ? ` (<a href="mailto:${esc(s.correo)}">${esc(s.correo)}</a>)` : ''}${s.servicio ? ' · ' + esc(s.servicio) : ''}${catDe(s.categoria) ? ' · <b>' + esc(catDe(s.categoria).t) + '</b>' : ''}${esRepo(s) ? ' · reponer <b>' + esc(s.bodega) + '</b>' : ' · pide a <b>' + esc(s.bodega) + '</b>'} · ${esc(new Date(s.creadoEn).toLocaleString('es-CL'))}</p>
        ${s.nota ? `<p class="si-m">Nota: ${esc(s.nota)}</p>` : ''}${s.conteo ? cuadreHTML(s) : ''}
        <div class="si-lns">${(s.lineas || []).map((l, i) => { if (l.soloConteo) return ''; const cands = candDe(l, s), decid = l.estado && l.estado !== 'pendiente', ver = (!decid || abiertoL[s.numero + '|' + i]) && !tocadaL(l) && !(s.conteo && s.conteo.estado !== 'aplicado');
          const pre = (l.seleccion && l.seleccion.length) ? cands.map(c => { const x = l.seleccion.find(y => y.insumoId === c.insumoId && y.clave === c.clave); return x ? x.qty : 0; }) : repartir(cands, l.cantidad), hay = cands.reduce((t, c) => t + c.disp, 0);
          return `<div class="si-ln${decid ? ' si-ln--ok' : ''}" data-i="${i}"><div class="si-lh">${l.foto ? `<span class="prod-img"><img src="${l.foto}" alt="${esc(l.nombre)}"></span>` : IM ? IM.thumb(l.nombre, { codigo: (insumos.find(x => x.id === l.insumoId) || {}).codigoMP || '' }) : ''}<div class="si-ln-t"><b>${esc(l.nombre)}</b>${l.manual ? ' <em>escrito a mano</em>' : ''}${num(l.reiterado) > 1 ? ` <em class="si-reit">Sigue faltando · ${num(l.reiterado)}.º día</em>` : ''}<small>Pide <b>${l.cantidad}</b> · hay ${hay} en otras bodegas${tocadaL(l) ? (esRepo(s) ? (recibidaL(l) ? ' · <b>recibido en ' + esc(s.bodega) + '</b>' : ' · <b>en camino</b>') : ' · <b>entregado</b>') : ''}</small></div>${chipL(l)}</div>
            ${ab(s) && ver ? (cands.length ? `<table class="si-tb si-lt"><thead><tr><th>Dónde</th><th>Lote</th><th>Vence</th><th>Hay</th><th>Sacar</th></tr></thead><tbody>${cands.map((c, j) => `<tr><td>${esc(c.bodega)}${c.estante ? ' · ' + esc(c.estante) : ''}</td><td>${esc(c.lote)}<small class="si-vm"> · vence ${esc(fmtV(c.vence))}</small></td><td>${esc(fmtV(c.vence))}</td><td>${c.disp}</td><td><input type="number" min="0" max="${c.disp}" value="${escritas[s.numero + '|' + i + '|' + c.insumoId + '|' + c.clave] !== undefined ? esc(escritas[s.numero + '|' + i + '|' + c.insumoId + '|' + c.clave]) : pre[j]}" class="si-q-in" data-j="${j}" data-g="${esc(s.numero + '|' + i + '|' + c.insumoId + '|' + c.clave)}" inputmode="numeric" aria-label="Cantidad a sacar del lote ${esc(c.lote)}"></td></tr>`).join('')}</tbody></table>` : '<p class="si-v">No está en el inventario con ese nombre: asócialo al producto que corresponde.</p>') + asocHTML(s, l, i)
              + `<div class="si-lb"><button type="button" class="btn btn-primary btn-sm" data-ok="${i}"${cands.length ? '' : ' disabled'}>Confirmar</button><button type="button" class="btn btn-secondary btn-sm" data-nh="${i}">No hay</button></div>`
              : (ab(s) && !(s.conteo && s.conteo.estado !== 'aplicado') ? `<div class="si-lb"><small>${(l.seleccion || []).filter(x => x.qty > 0).map(x => `${esc(x.lote)} · ${esc(x.bodega)}: ${x.qty}`).join(' · ')}</small>${tocadaL(l) ? (movidaL(l) ? '' : `<button type="button" class="btn btn-secondary btn-sm" data-solomov="${i}" title="Un lote no se pudo mover: deja la línea solo con lo que sí salió">Quedarse con lo movido</button>`) : `<button type="button" class="btn btn-secondary btn-sm" data-ver="${i}">Cambiar</button>`}</div>` : '')}</div>`; }).join('')}</div>
        ${recorridoHTML(s.estado)}<footer>${(() => { const L = (s.lineas || []).filter(l => !l.soloConteo), faltan = L.filter(l => !l.estado || l.estado === 'pendiente').length, inv = s.conteo && s.conteo.estado !== 'aplicado', busy = ocupado.has(s.numero), repo = esRepo(s);
          const tocada = L.some(tocadaL), viejo = legado(s), todoMov = viejo || L.every(movidaL), todoRec = viejo || L.every(recibidaL); let h = '';
          if (s.estado === 'NUEVA' || s.estado === 'PREPARACION') h += `<button class="btn btn-primary" data-procesar="1"${faltan || inv || busy ? ' disabled' : ''} title="${inv ? 'Primero acepta el inventario' : faltan ? 'Confirma o marca «No hay» en cada producto' : ''}">${busy ? 'Procesando…' : inv ? 'Procesar (acepta el inventario)' : faltan ? `Procesar (faltan ${faltan})` : repo ? `Procesar: enviar a ${esc(s.bodega)}` : 'Procesar: entregar'}</button>`;
          if (s.estado === 'LISTA' && !todoMov) h += `<button class="btn btn-primary" data-procesar="1"${busy ? ' disabled' : ''}>Reintentar lo que no se movió</button>`;
          if (s.estado === 'LISTA' && repo && todoMov && !todoRec) h += `<button class="btn btn-primary" data-recibir="1"${busy ? ' disabled' : ''}>${s.recibidoSolicitado ? 'Confirmar recibido (lo marcó ' + esc(s.recibidoSolicitado.por || 'la encargada') + ')' : `Marcar recibido en ${esc(s.bodega)}`}</button>`;
          if (s.estado === 'LISTA' && (!repo || todoRec) && todoMov) h += '<button class="btn btn-primary" data-e="ENTREGADA">Cerrar solicitud (entregada)</button>';
          h += '<button class="btn btn-secondary" data-c="1">Copiar para WhatsApp</button>';
          if (ab(s) && !tocada) h += '<button class="btn btn-secondary si-peligro" data-e="ANULADA">Anular</button>';
          return h; })()}</footer></article>`; };
    r.innerHTML = `<div class="si-wrap si-ancho${costado ? ' si-wrap--costado' : ''}"><div class="si-cab"><div><h2 class="si-t">Solicitudes de insumos</h2><p class="si-s">Revisa cada producto: foto, dónde hay y de qué lote sacar. Confirma o marca «No hay»; quien pidió lo ve en su teléfono.</p></div>
      <div class="si-acc"><input id="si-bq" class="si-in si-bq" type="search" value="${esc(bq)}" placeholder="Buscar N° (SOL-…), nombre, correo o producto" autocomplete="off" aria-label="Buscar solicitud"><select id="si-fil" class="si-in">${[['ABIERTAS', 'Abiertas'], ['NUEVA', 'Enviadas'], ['PREPARACION', 'Procesando'], ['LISTA', 'Procesadas'], ['ENTREGADA', 'Cerradas'], ['TODAS', 'Todas']].map(([v, t]) => `<option value="${v}"${v === filtro ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <button type="button" class="btn btn-secondary" id="si-off" title="Guarda en el teléfono el inventario y las solicitudes para trabajar sin internet">Descargar para usar sin internet</button></div></div><p class="si-v" id="si-offm">${esc(localStorage.getItem('si-off') ? 'Última descarga: ' + new Date(localStorage.getItem('si-off')).toLocaleString('es-CL') : '')}</p>
      ${costado ? `<div class="si-costado"><div class="si-lsol" role="listbox" aria-label="Solicitudes">${vis.map(s => `<button type="button" role="option" class="si-fsol${s.numero === sel ? ' on' : ''}" data-sel="${esc(s.numero)}" aria-selected="${s.numero === sel}"><span><b>${esc(s.correlativo || s.numero)}</b><small>${esc(s.solicitante || '')}${s.servicio ? ' · ' + esc(s.servicio) : ''} · ${(s.lineas || []).length} prod.</small></span><span class="si-est si-e-${esc(s.estado)}">${esc(ESTADOS[s.estado] || s.estado)}</span></button>`).join('') || '<div class="home-empty">No hay solicitudes en este filtro.</div>'}</div>
        <section class="si-panel" aria-live="polite">${vis.find(s => s.numero === sel) ? `<div class="si-pcab"><small>↑ ↓ recorre · Esc cierra</small><button type="button" class="si-pnav" data-nav="-1" aria-label="Anterior">▲</button><button type="button" class="si-pnav" data-nav="1" aria-label="Siguiente">▼</button><button type="button" class="si-pnav" data-cerrar="1" aria-label="Cerrar">✕</button></div>` + cardHTML(vis.find(s => s.numero === sel)) : '<div class="si-pvacio">Elige una solicitud de la lista para ver el detalle.</div>'}</section></div>`
        : vis.map(cardHTML).join('') || '<div class="home-empty">No hay solicitudes en este filtro.</div>'}</div>`;
    if (IM) IM.rellenar(r);
  }
  /** Guarda el resultado de una línea (y pasa la solicitud a «En preparación» o «Lista» según corresponda). */
  /** Guarda UNA línea leyendo la solicitud en una transacción: no pisa las marcas de movimiento de las demás líneas
   *  ni lo que otra sesión hizo entre medio. Sin internet (las transacciones no funcionan) guarda como antes. */
  async function guardarLinea(s, i, nueva, opc) {
    const f = fs(), ref = f.doc(f.collection(db(), s._col || COL), s.numero), ahora = new Date().toISOString();
    const aplicar = (x) => { const L = (x.lineas || []).map(y => ({ ...y })), act = L[i]; if (!act || norm(act.nombre) !== norm((opc && opc.nombreOrig) || nueva.nombre)) throw new Error('La solicitud cambió: actualiza y vuelve a intentar.');
      if (tocadaL(act) && !(opc && opc.permitirTocada)) throw new Error('Este producto ya salió de su bodega: no se puede cambiar.');
      L[i] = { ...nueva, ...(act.movidos ? { movidos: act.movidos } : {}), ...(act.recibidos ? { recibidos: act.recibidos } : {}), ...(act.transito ? { transito: act.transito } : {}) };
      const cambios = { lineas: L }; if (x.estado === 'NUEVA') { cambios.estado = 'PREPARACION'; cambios.historial = (x.historial || []).concat([{ estado: 'PREPARACION', por: usuario(), en: ahora }]); } return cambios; };
    try { let c; await f.runTransaction(db(), async (tx) => { const sn = await tx.get(ref); if (!sn.exists()) throw new Error('La solicitud ya no existe.'); c = aplicar(sn.data()); tx.update(ref, c); }); return c; }
    catch (e) { if (!/offline|unavailable|network|failed to get/i.test(String(e && (e.code || '') + ' ' + (e.message || '')))) throw e; const c = aplicar(s); await Promise.race([f.updateDoc(ref, c), new Promise(r => setTimeout(r, 2500))]); return c; }
  }
  /** Guarda el resultado de una línea (y pasa la solicitud a «Procesando»). */
  async function decidirLinea(n, i, noHay, cards) {
    const s = solicitudes.find(x => x.numero === n); if (!s) return; const l = (s.lineas || [])[i]; if (!l) return;
    const cands = candDe(l, s); if (tocadaL(l)) { toast('Ya movido', 'Este producto ya salió de su bodega: no se puede cambiar.', 'warning'); return; }
    const qs = cards ? [...cards.querySelectorAll('.si-q-in')].map(x => Math.max(0, Math.floor(num(x.value)))) : [];
    const mal = cands.find((c, j) => qs[j] > c.disp); if (mal) { toast('Cantidad', `El lote ${mal.lote} solo tiene ${mal.disp}.`, 'warning'); return; }
    const sel = noHay ? [] : cands.map((c, j) => ({ insumoId: c.insumoId, bodega: c.bodega, clave: c.clave, lote: c.lote, vence: c.vence, qty: qs[j] || 0 })).filter(x => x.qty > 0);
    const entregar = sel.reduce((t, x) => t + x.qty, 0);
    if (!noHay && entregar <= 0) noHay = true;   // dejar todo en 0 = no tenemos: queda «No hay» en la solicitud
    const nueva = { ...l, estado: estadoLinea(l.cantidad, entregar, noHay), entregar, seleccion: sel, revisadoPor: usuario(), revisadoEn: new Date().toISOString() }; delete nueva.movido;
    Object.keys(escritas).forEach(k => { if (k.startsWith(n + '|' + i + '|')) delete escritas[k]; }); delete abiertoL[n + '|' + i];
    try { const c = await guardarLinea(s, i, nueva); Object.assign(s, c); pintarBandeja(); }
    catch (e) { toast('No se pudo guardar', esc(e.message || String(e)), 'error'); }
  }
  /** Línea con un lote movido y otro que falló: queda solo con lo que sí salió (lo demás se informa como no entregado). */
  async function soloMovido(n, i) {
    const s = solicitudes.find(x => x.numero === n), l = s && (s.lineas || [])[i]; if (!l) return;
    const sel = (l.seleccion || []).filter(x => (l.movidos || []).includes(grupoDe(x))), e = sel.reduce((t, x) => t + num(x.qty), 0);
    try { const c = await guardarLinea(s, i, { ...l, seleccion: sel, entregar: e, estado: estadoLinea(l.cantidad, e, e === 0), revisadoPor: usuario(), revisadoEn: new Date().toISOString() }, { permitirTocada: true }); Object.assign(s, c); pintarBandeja(); toast('Listo', 'La línea quedó con lo que sí se movió.', 'success'); }
    catch (er) { toast('No se pudo', esc(er.message || er), 'error'); }
  }
  /** Procesar (v21.212): con todos los productos decididos y con internet, mueve cada lote elegido.
   *  · Reposición de una bodega de uso: sale de su bodega y queda «En tránsito» hasta que se marque recibido.
   *  · Pedido de una persona sin bodega de uso: salida por lote (se descuenta del stock).
   *  Cada lote movido queda anotado en la línea dentro de la misma transacción: reintentar o procesar desde dos
   *  sesiones nunca mueve dos veces. La solicitud pasa a «Procesada» solo si todo se movió. */
  async function procesar(n, sDoc) {
    const s = sDoc || solicitudes.find(x => x.numero === n); if (!s || ocupado.has(n)) return; const T = window.SAR_Traspaso, P = window.SAR_Progreso;
    if (!T || !T.moverUno || !T.salidaUno) { toast('Procesar', 'El módulo de traspasos aún no carga. Espera un momento.', 'warning'); return; }
    if (s.conteo && s.conteo.estado !== 'aplicado') { toast('Inventario', 'Primero acepta el inventario (o espera el reconteo).', 'warning'); return; }
    if (window.SAR_Cola && !(await window.SAR_Cola.hayConexion())) { toast('Sin internet', 'Procesar mueve stock y necesita conexión. Puedes ir confirmando productos; procesa cuando vuelva internet.', 'warning'); return; }
    const repo = esRepo(s), tareas = [];
    if (legado(s)) { toast('Procesar', 'Esta solicitud se procesó con la versión anterior: ciérrala directamente.', 'info'); return; }
    (s.lineas || []).forEach((l, i) => { if (l.soloConteo || l.estado === 'no_hay' || l.movido === true) return; (l.seleccion || []).filter(x => num(x.qty) > 0 && !(l.movidos || []).includes(grupoDe(x))).forEach(x => tareas.push({ l, i, x })); });
    const L = (s.lineas || []).filter(l => !l.soloConteo), ok = L.filter(l => l.estado === 'ok').length, par = L.filter(l => l.estado === 'parcial').length, nh = L.filter(l => l.estado === 'no_hay').length, u = tareas.reduce((t, z) => t + num(z.x.qty), 0);
    if (!sDoc) { const si = P && P.confirmar ? await P.confirmar({ titulo: `¿Procesar ${esc(s.correlativo || n)}?`, texto: `Para <b>${esc(s.solicitante || s.requester)}</b>${s.servicio ? ' · ' + esc(s.servicio) : ''}.`, lineas: [`${ok} completo(s)${par ? ` · ${par} parcial(es)` : ''}${nh ? ` · ${nh} sin stock (quedan avisados)` : ''}`, u ? (repo ? `Salen <b>${u}</b> u. de su bodega y quedan <b>en camino</b> a ${esc(s.bodega)} hasta que se marquen recibidas.` : `Se entregan <b>${u}</b> u.: salen del stock por lote.`) : 'No hay nada que mover.', 'Quien pidió verá la solicitud como «Procesada».'], si: 'Procesar' }) : confirm('¿Procesar?'); if (!si) return; }
    ocupado.add(n); pintarBandeja(); const nota = `Solicitud ${s.correlativo || n}`, prog = P && tareas.length ? P.iniciar('Procesando la solicitud…', []) : null; let mal = 0; const errs = [];
    for (const [k, t] of tareas.entries()) {
      if (prog) prog.paso(`${k + 1} de ${tareas.length}: ${t.l.asociado || t.l.nombre}`);
      const marca = { numero: n, i: t.i, grupo: grupoDe(t.x), campo: 'movidos', nombre: t.l.nombre, transito: repo };
      try { if (repo) await T.moverUno(t.x.insumoId, t.x.bodega, TRANSITO, [{ clave: t.x.clave, qty: num(t.x.qty) }], nota + ' · en camino a ' + s.bodega, marca); else await T.salidaUno(t.x.insumoId, t.x.bodega, [{ clave: t.x.clave, qty: num(t.x.qty) }], nota + ' · entregado a ' + (s.solicitante || '') + (s.servicio ? ' (' + s.servicio + ')' : ''), marca); }
      catch (e) { if (!e.ya) { mal++; errs.push(`${t.l.nombre}: ${e.message || e}`); } }
    }
    try { const f = fs(), sn = await f.getDoc(f.doc(f.collection(db(), COL), n)), x = sn.exists() ? limpiarSol(sn.data(), n) : null;
      if (x && (x.lineas || []).filter(l => !l.soloConteo).every(movidaL) && x.estado !== 'LISTA' && x.estado !== 'ENTREGADA') { const ahora = new Date().toISOString(); await f.updateDoc(f.doc(f.collection(db(), COL), n), { estado: 'LISTA', historial: (x.historial || []).concat([{ estado: 'LISTA', por: usuario(), en: ahora }]) }); } } catch (e) { mal++; errs.push(e.message || String(e)); }
    ocupado.delete(n); if (prog) { if (mal) prog.error(); else prog.listo(repo ? `En camino a ${s.bodega}` : 'Entregado', { aviso: false }); }
    try { await cargarBase(); } catch (e) { /* sigue */ } pintarBandeja();
    if (mal) { toast('Procesar', `${mal} lote(s) no se movieron: ${esc(errs.slice(0, 2).join(' · '))}. Revisa y toca «Reintentar».`, 'error'); return; }
    avisar({ titulo: `Solicitud ${s.correlativo || n} procesada`, texto: repo ? `${u} u. en camino a ${esc(s.bodega)}.` : `${esc(s.solicitante || '')} ya lo ve.`, estado: 'procesada' });
  }
  /** Recibido: lo que está «En tránsito» de esta solicitud entra a la bodega de uso; con todo recibido, se cierra. */
  async function recibir(n, sDoc) {
    const s = sDoc || solicitudes.find(x => x.numero === n); if (!s || ocupado.has(n)) return; const T = window.SAR_Traspaso, P = window.SAR_Progreso;
    if (!T || !T.moverUno) return; if (window.SAR_Cola && !(await window.SAR_Cola.hayConexion())) { if (!sDoc) toast('Sin internet', 'Marcar recibido mueve stock y necesita conexión.', 'warning'); return; }
    const tareas = []; (s.lineas || []).forEach((l, i) => (l.movidos || []).filter(g => !(l.recibidos || []).includes(g)).forEach(g => { const x = (l.seleccion || []).find(y => grupoDe(y) === g), tid = (l.transito || {})[g]; if (x && tid) tareas.push({ l, i, g, x, tid }); }));
    if (!sDoc) { const si = P && P.confirmar ? await P.confirmar({ titulo: `¿Recibido en ${esc(s.bodega)}?`, texto: `${esc(s.correlativo || n)}: entra a ${esc(s.bodega)} lo que estaba en camino.`, lineas: tareas.map(t => `${esc(t.l.asociado || t.l.nombre)} · <b>${num(t.x.qty)}</b> u. · lote ${esc(t.x.lote)}`), si: 'Recibido' }) : confirm('¿Recibido?'); if (!si) return; }
    ocupado.add(n); pintarBandeja(); let mal = 0; const nota = `Solicitud ${s.correlativo || n} · recibido`;
    for (const t of tareas) { try { await T.moverUno(t.tid, TRANSITO, s.bodega, [{ clave: t.x.clave, qty: num(t.x.qty) }], nota, { numero: n, i: t.i, grupo: t.g, campo: 'recibidos', nombre: t.l.nombre }); } catch (e) { if (!e.ya) { mal++; toast('No se recibió', `${esc(t.l.nombre)}: ${esc(e.message || e)}`, 'error'); } } }
    try { const f = fs(), sn = await f.getDoc(f.doc(f.collection(db(), COL), n)), x = sn.exists() ? limpiarSol(sn.data(), n) : null;
      if (x && (x.lineas || []).every(recibidaL) && x.estado === 'LISTA') { const ahora = new Date().toISOString(); await f.updateDoc(f.doc(f.collection(db(), COL), n), { estado: 'ENTREGADA', recibidoEn: ahora, historial: (x.historial || []).concat([{ estado: 'ENTREGADA', por: usuario(), en: ahora, nota: 'Recibido en ' + s.bodega }]) }); } } catch (e) { mal++; }
    ocupado.delete(n); try { await cargarBase(); } catch (e) { /* sigue */ } pintarBandeja();
    if (!mal) avisar({ titulo: `Solicitud ${s.correlativo || n} cerrada`, texto: `Recibido en ${esc(s.bodega)}.`, estado: 'cerrada' });
  }
  async function cambiarEstado(n, e, callado) {
    const f = fs(), s = solicitudes.find(x => x.numero === n); if (!s) return;
    if (e === 'ANULADA') { if ((s.lineas || []).some(tocadaL)) { toast('Anular', 'Ya se movió stock de esta solicitud: no se puede anular.', 'warning'); return; } const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: `¿Anular ${esc(s.correlativo || n)}?`, texto: 'Quien pidió la verá como «Anulada».', si: 'Anular' }) : confirm('¿Anular esta solicitud?'); if (!ok) return; }
    const hist = (s.historial || []).concat([{ estado: e, por: usuario(), en: new Date().toISOString() }]);
    try { await Promise.race([f.updateDoc(f.doc(f.collection(db(), s._col || COL), n), { estado: e, historial: hist }), new Promise(res => setTimeout(res, 2500))]); if (!callado) avisar({ titulo: `Solicitud ${s.correlativo || n} ${String(ESTADOS[e]).toLowerCase()}`, texto: esc(s.solicitante || ''), estado: AV_EST[e] }); } catch (err) { toast('No se pudo', err.message || String(err), 'error'); }
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
  /** Aceptar (descuenta lo usado y ajusta lo que se pide) o pedir reconteo de los productos marcados. */
  async function revisarAccion(n, aceptar, btn) {
    const s = solicitudes.find(x => x.numero === n), rv = revs[n], T = window.SAR_Transitoria, P = window.SAR_Progreso; if (!s || !rv || rv.estado !== 'ok' || !T) return;
    if (!aceptar) {
      if (!rv.sel.size) { toast('Reconteo', 'Marca los productos que quieres que vuelvan a contar.', 'warning'); return; }
      const ok = P && P.confirmar ? await P.confirmar({ titulo: '¿Pedir reconteo?', texto: `${esc(s.solicitante || '')} verá en su teléfono que debe volver a contar:`, lineas: rv.filas.filter(x => rv.sel.has(x.k)).map(x => `${esc(x.nombre)} (contó ${x.contado}, había ${x.alContar})`), si: 'Pedir reconteo' }) : confirm('¿Pedir reconteo?');
      if (!ok) return; btn.disabled = true; try { await T.pedirReconteo(s, [...rv.sel]); delete revs[n]; avisar({ titulo: 'Reconteo pedido', texto: `${rv.sel.size} producto(s) a ${esc(s.solicitante || '')}.`, estado: 'procesando' }); } catch (e) { toast('No se pudo', esc(e.message || e), 'error'); btn.disabled = false; } return;
    }
    // lo que se pide = dotación − contado − lo que ya viene en camino o está pedido sin procesar para esa bodega (no se pide dos veces)
    const pend = {}; solicitudes.filter(x => x.numero !== n && x.bodega === s.bodega && esRepo(x) && x.estado !== 'ANULADA' && x.estado !== 'ENTREGADA').forEach(x => (x.lineas || []).forEach(l => { if (l.soloConteo || l.estado === 'no_hay') return; const k = norm(l.asociado || l.nombre), q = l.estado ? (recibidaL(l) && tocadaL(l) ? 0 : num(l.entregar)) : num(l.cantidad); pend[k] = (pend[k] || 0) + q; }));
    const viejas = new Map((s.lineas || []).filter(l => l.k).map(l => [l.k, l]));
    let lineas = rv.filas.map(x => { const q = Math.max(0, x.objetivo - x.contado - (pend[norm(x.nombre)] || 0)); if (!q) return null; const v = viejas.get(x.k) || {}; return { nombre: x.nombre, cantidad: q, k: x.k, ...(v.insumoId ? { insumoId: v.insumoId } : {}), ...(v.reiterado ? { reiterado: v.reiterado } : {}) }; }).filter(Boolean);
    const us = rv.filas.reduce((t, x) => t + x.usado, 0), pedidos = lineas.length;
    if (!lineas.length) lineas = [{ nombre: 'Inventario completo: sin reposición', cantidad: 0, soloConteo: true }];
    const ok = P && P.confirmar ? await P.confirmar({ titulo: '¿Aceptar el inventario?', texto: `${esc(s.bodega)} · ${esc(s.solicitante || '')}.`, lineas: [`Se descuentan <b>${us}</b> u. usadas (por lote, el que vence primero).`, pedidos ? `Quedan <b>${pedidos}</b> producto(s) para reponer${Object.keys(pend).length ? ' (ya restado lo que viene en camino)' : ''}.` : 'No hay nada que reponer.'], si: 'Aceptar y descontar' }) : confirm('¿Aceptar?');
    if (!ok) return; btn.disabled = true;
    try { await T.aceptarConteo(s, rv.filas, lineas); delete revs[n]; avisar({ titulo: 'Inventario aceptado', texto: `${us} u. descontadas · ${pedidos} producto(s) por reponer.`, estado: 'procesada' }); try { await cargarBase(); } catch (e) { /* sigue */ } pintarBandeja(); }
    catch (e) { toast('No se aceptó', esc(e.message || e), 'error'); btn.disabled = false; }
  }
  function enlazarBandeja() {
    const r = rootBandeja(); if (!r || r.dataset.ok) return; r.dataset.ok = '1';
    r.addEventListener('change', (e) => { if (e.target.id === 'si-fil') { filtro = e.target.value; pintarBandeja(); return; } if (e.target.classList.contains('si-rc')) { const c = e.target.closest('.si-card'), rv = c && revs[c.dataset.n]; if (rv && rv.sel) { if (e.target.checked) rv.sel.add(e.target.dataset.k); else rv.sel.delete(e.target.dataset.k); pintarBandeja(); } } });
    r.addEventListener('input', (e) => { if (e.target.classList.contains('si-q-in') && e.target.dataset.g) { escritas[e.target.dataset.g] = e.target.value; return; } if (e.target.id === 'si-bq') { bq = e.target.value; clearTimeout(window.__siBq); window.__siBq = setTimeout(pintarBandeja, 150); return; } if (!e.target.classList.contains('si-asoc-in') || !asoc) return; asoc.q = e.target.value; const res = e.target.parentElement.querySelector('.si-asoc-res'); if (res) res.innerHTML = resAsoc(asoc.q); });
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
      if (b.dataset.procesar) return procesar(n);
      if (b.dataset.solomov !== undefined) return soloMovido(n, +b.dataset.solomov);
      if (b.dataset.recibir) return recibir(n);
      if (b.dataset.rev) { const s = solicitudes.find(x => x.numero === n); if (s) cargarRevision(s); return; }
      if (b.dataset.aceptar || b.dataset.reconteo) return revisarAccion(n, !!b.dataset.aceptar, b);
      if (b.dataset.asoc !== undefined) { asoc = { n, i: +b.dataset.asoc, q: '' }; pintarBandeja(); const x = r.querySelector('.si-asoc-in'); if (x) x.focus(); return; }
      if (b.dataset.asocsi !== undefined && b.dataset.nom) return asociar(n, +b.dataset.asocsi, b.dataset.nom);
      if (b.dataset.desasoc !== undefined) return asociar(n, +b.dataset.desasoc, '');
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
    const oir = (col) => f.onSnapshot(f.query(f.collection(db(), col), f.where('tipo', '==', TIPO)), (sn) => { const l = []; sn.forEach(d => l.push({ ...limpiarSol(d.data(), d.id), _col: col })); por[col] = l; juntar(); }, () => { por[col] = []; juntar(); });
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
  async function leerTodas() { const f = fs(), l = []; for (const c of [COL, COL_ANT]) { try { const sn = await f.getDocs(f.query(f.collection(db(), c), f.where('tipo', '==', TIPO))); sn.forEach(d => l.push({ ...limpiarSol(d.data(), d.id), _col: c })); } catch (e) { /* sin permiso */ } } return l; }
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

  // ---------------- «Recibido» marcado por la encargada en su teléfono: la sesión de bodega mueve lo que estaba en camino (v21.212) ----------------
  const recibiendo = new Set();
  function recibirMarcados(l) { l.filter(x => x.recibidoSolicitado && x.estado === 'LISTA' && !recibiendo.has(x.numero) && (x.lineas || []).every(movidaL) && !(x.lineas || []).every(recibidaL)).forEach(x => { recibiendo.add(x.numero); recibir(x.numero, x).finally(() => setTimeout(() => recibiendo.delete(x.numero), 60000)); }); }
  // ---------------- aviso en la campana: solicitudes nuevas (solo bodega) ----------------
  if (typeof module === 'undefined' && typeof document.addEventListener === 'function' && !window.SAR_SOLICITUD_PUBLICA) {
    let n = 0; const t = setInterval(() => { n++; const u = usuario(); if (!(u && esGestor() && fs() && db()) && n < 90) return; clearInterval(t); if (!(u && esGestor())) return;
      try { const f = fs(); f.onSnapshot(f.query(f.collection(db(), COL), f.where('estado', '==', 'NUEVA')), (sn) => { const l = []; sn.forEach(d => { if (d.data().tipo === TIPO) l.push({ ...limpiarSol(d.data(), d.id), _col: COL }); }); asignarCorrelativos(l); window.SAR_SolicitudesNuevas = l.sort((a, b) => String(b.creadoEn).localeCompare(String(a.creadoEn)));
        const b = document.getElementById('si-badge'); if (b) { b.textContent = l.length || ''; b.style.display = l.length ? '' : 'none'; }
        if (l.length > (window.__solNuevasAntes || 0) && window.__solNuevasAntes !== undefined) avisar({ titulo: l[0].conteo ? `Inventario por revisar · ${esc(l[0].bodega || '')}` : `Solicitud enviada${l[0].correlativo ? ' · ' + l[0].correlativo : ''}`, texto: `${esc(l[0].solicitante || '')}${l[0].servicio ? ' · ' + esc(l[0].servicio) : ''}: ${(l[0].lineas || []).filter(x => !x.soloConteo).length} producto(s).`, estado: 'enviada', boton: 'Ver solicitud', alTocar: () => { location.hash = 'view-solicitudes-insumos'; } });
        window.__solNuevasAntes = l.length; window.dispatchEvent(new Event('sar-avisos')); }, () => { /* sin permiso */ });
        f.onSnapshot(f.query(f.collection(db(), COL), f.where('estado', '==', 'LISTA')), (sn) => { const l = []; sn.forEach(d => { if (d.data().tipo === TIPO) l.push({ ...limpiarSol(d.data(), d.id), _col: COL }); }); recibirMarcados(l); }, () => { /* sin permiso */ }); } catch (e) { /* sin conexión */ } }, 2000);
  }

  function recordarMia(n) { try { const m = JSON.parse(localStorage.getItem('si-mias') || '[]'); m.unshift(n); localStorage.setItem('si-mias', JSON.stringify(m.slice(0, 20))); } catch (e) { /* sin almacenamiento */ } }
  window.SAR_Solicitudes = { _prueba: { procesar, recibir, limpiarSol, movidaL, recibidaL, set solicitudes(v) { solicitudes = v; } }, repintar: () => pintarPide(), recordarMia, misSolicitudes: () => misLista.slice(), limpiarSol, TIPO, COL, abrirPide, abrirBandeja, publicarCatalogo, numeroSolicitud, agregarLinea, textoPicking, infoLinea, lotesCandidatos, repartir, estadoLinea, comprometido, filasInforme, parecidos, CAB_INFORME, leerTodas, pintarAuditoria };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SAR_Solicitudes;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: null });
