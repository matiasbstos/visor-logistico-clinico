/* ==========================================================================
   INVENTARIO DE BODEGAS DE USO DESDE EL TELÉFONO (página «Pedir insumos», v21.212)
   · Solo con usuario: la encargada entra con su cuenta de rol «transitoria» (o bodega con la suya). Sin código público.
   · Lee directo del sistema (Bodegas, dotación en Contadores/transitoria-obj-<id>, Insumos): «debería haber» es el
     stock del momento en que se empieza a contar, y queda guardado en el borrador con su fecha.
   · Cada número se guarda en el teléfono al instante (sin internet también). El borrador NO se borra hasta que
     Firestore confirma el envío; si no se confirmó, al volver se ofrece reenviar.
   · Al enviar: una solicitud (origen «transitoria») con el conteo. NADA se descuenta solo: bodega lo revisa en
     «Solicitudes recibidas» y acepta (descuenta lo usado y deja la reposición) o pide reconteo de algunos productos.
   · Reconteo: aparece «Bodega pidió recontar N productos»; se cuentan solo esos y se reenvía.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const K_BOR = 'inv-borrador-v2', ROLES = ['transitoria', 'admin', 'superadmin', 'operador', 'administrador', 'global'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v) || 0;
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } } };
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k) { try { sessionStorage.setItem(k, '1'); } catch (e) { /* nada */ } }, del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* nada */ } } };
  const fecha = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}-${m[2]}` : ''; };
  const hora = (iso) => { try { return new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  const IC = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="8" width="28" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M18 8V5h12v3" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="m17 24 4 4 9-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 35h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="38" cy="40" r="3" fill="#8CC63F"/></svg>';

  // ---------------- lógica pura ----------------
  /** Resultado de un producto contado: usado (lo calcula y confirma bodega) y a pedir (para volver a la dotación). */
  function calc(it, contado) {
    if (contado === null || contado === undefined || contado === '') return null;
    const c = Math.max(0, Math.floor(num(contado)));
    return { contado: c, usado: Math.max(0, num(it.sis) - c), sobra: Math.max(0, c - num(it.sis)), pide: Math.max(0, num(it.obj) - c) };
  }
  /** Líneas propuestas: lo que falta para la dotación; primero lo que sigue faltando de antes. Bodega las ajusta al aceptar. */
  function lineasDe(items, cont) {
    const l = items.map(it => { const r = calc(it, cont[it.k]); if (!r || r.pide <= 0) return null; return { nombre: it.n, cantidad: r.pide, k: it.k, ...(it.i ? { insumoId: it.i } : {}), ...(it.p ? { reiterado: num(it.p.dias || 1) + 1 } : {}) }; }).filter(Boolean);
    return l.sort((a, b) => num(b.reiterado) - num(a.reiterado) || a.nombre.localeCompare(b.nombre, 'es'));
  }

  // ---------------- estado ----------------
  let mostrar = false, busca = '', filtro = 'todos', enviando = false, bodegasU = null, cargando = false;
  const rol = () => String(window.SAR_Rol || '').toLowerCase();
  const habil = () => ROLES.includes(rol());
  const bor = () => ls.get(K_BOR);
  const repintar = () => { if (window.SAR_Solicitudes && window.SAR_Solicitudes.repintar) window.SAR_Solicitudes.repintar(); };
  const mias = () => (window.SAR_Solicitudes && window.SAR_Solicitudes.misSolicitudes ? window.SAR_Solicitudes.misSolicitudes() : []);
  const reconteos = () => mias().filter(x => x.origen === 'transitoria' && x.conteo && x.conteo.estado === 'reconteo');
  function enCurso() { const b = bor(); return habil() && (mostrar || (!!b && !ss.get('inv-oculto'))); }

  async function cargarBodegas() {
    if (bodegasU || cargando || !window.SAR_Transitoria) return; cargando = true;
    try { bodegasU = await window.SAR_Transitoria.bodegasUso(); } catch (e) { bodegasU = null; } cargando = false;
  }
  /** Lee la dotación y el stock de la bodega AHORA (con internet) o lo último guardado (sin internet). */
  async function datosBodega(b) {
    const T = window.SAR_Transitoria, au = window.firebaseAuth && window.firebaseAuth.currentUser;
    try {
      const [items, pend] = await Promise.all([T.itemsParaContar(b), T.pendientesDe(b.name, au && au.uid).catch(() => ({}))]);
      items.forEach(it => { if (pend[it.k]) it.p = pend[it.k]; });
      const d = { items, al: new Date().toISOString() }; ls.set('inv-datos-' + b.id, d); return d;
    } catch (e) { const d = ls.get('inv-datos-' + b.id); if (d) return { ...d, cache: true }; throw e; }
  }

  // ---------------- interfaz ----------------
  function abrir() { ss.del('inv-oculto'); mostrar = true; repintar(); window.scrollTo && window.scrollTo(0, 0); }
  function boton(el, opc) {
    if (!el) return; const soloAvisos = !!(opc && opc.soloAvisos);
    if (!habil()) { el.innerHTML = ''; return; }
    if (!bodegasU) { cargarBodegas().then(() => { if (bodegasU) boton(el); }); }
    const b = bor(), rc = reconteos(), n = b ? (b.items || []).length : 0, c = b ? Object.keys(b.cont || {}).length : 0;
    el.innerHTML = `<p class="si-sep">${soloAvisos ? 'Pendiente en tu inventario' : 'Bodegas de uso'}</p>
      ${rc.map(x => `<button type="button" class="si-cat si-cat--rc" data-iv-rc="${esc(x.numero)}"><span class="si-cat-ic">${IC}</span><span class="si-cat-tx"><b>Recontar ${(x.conteo.reconteo || []).length} producto(s)</b><small>Bodega pidió volver a contar en ${esc(x.bodega || '')}${x.correlativo ? ' (' + esc(x.correlativo) + ')' : ''}.</small></span><i aria-hidden="true">›</i></button>`).join('')}
      ${soloAvisos && !b ? '' : `<button type="button" class="si-cat si-cat--inv" id="iv-abrir"><span class="si-cat-ic">${IC}</span><span class="si-cat-tx"><b>Inventario</b><small>${b && b.enviando ? 'Inventario enviado: esperando confirmación.' : b ? `En curso (${esc(b.bodega)}): ${c} de ${n} contados. Toca para seguir.` : 'Cuenta lo que hay en tu bodega y envíalo a bodega para revisar.'}</small></span><i aria-hidden="true">›</i></button>`}`;
    if (soloAvisos && !b && !rc.length) { el.innerHTML = ''; return; }
    if (el.querySelector('#iv-abrir')) el.querySelector('#iv-abrir').onclick = () => { ss.del('inv-oculto'); mostrar = true; repintar(); window.scrollTo && window.scrollTo(0, 0); };
    el.querySelectorAll('[data-iv-rc]').forEach(x => x.onclick = () => iniciarReconteo(x.dataset.ivRc));
  }
  function filaHTML(it, v, b) {
    const r = calc(it, v), p = it.p, est = !r ? 'pend' : r.usado > 0 ? 'falta' : r.sobra > 0 ? 'sobra' : 'ok', IM = window.SAR_Imagenes, prev = b.modo === 'reconteo' ? (b.antes || {})[it.k] : undefined;
    return `<div class="iv-row iv-${est}" data-k="${esc(it.k)}" data-nom="${esc(norm(it.n))}">
      <div class="iv-h">${IM ? IM.thumb(it.n, { codigo: it.c || '' }) : ''}<div class="iv-t"><b>${esc(it.n)}</b><small>Debería haber <b>${num(it.sis)}</b> · dotación ${num(it.obj)}${prev !== undefined ? ` · antes contaste <b>${num(prev)}</b>` : ''}</small>
        ${p ? `<span class="iv-quiebre">${p.est === 'no_hay' ? 'La vez pasada bodega no tenía' : `La vez pasada llegaron ${num(p.dio)} de ${num(p.pidio)}`} (${esc(fecha(p.fecha))})${num(p.dias) > 1 ? ` · ${num(p.dias)} veces seguidas` : ''}</span>` : ''}</div></div>
      <div class="iv-c"><button type="button" class="iv-b" data-iv-m aria-label="Uno menos">−</button><input type="number" min="0" inputmode="numeric" class="iv-in" value="${v === undefined || v === null ? '' : esc(v)}" placeholder="?" aria-label="Contado de ${esc(it.n)}"><button type="button" class="iv-b" data-iv-p aria-label="Uno más">+</button>
        <button type="button" class="iv-igual" data-iv-igual>${num(it.sis) > 0 ? `Están las ${num(it.sis)}` : 'No hay ninguno'}</button></div>
      <p class="iv-res"><i class="iv-dot" aria-hidden="true"></i><span>${resTxt(r)}</span></p></div>`;
  }
  function resTxt(r) {
    if (!r) return 'Sin contar';
    if (r.usado > 0) return `Se usaron <b>${r.usado}</b>${r.pide > 0 ? ` · se pedirían <b>${r.pide}</b>` : ''}`;
    if (r.sobra > 0) return `Hay <b>${r.sobra}</b> más de lo que dice el sistema${r.pide > 0 ? ` · se pedirían ${r.pide}` : ''}`;
    return r.pide > 0 ? `Sin uso · se pedirían <b>${r.pide}</b> para la dotación` : 'Completo';
  }
  async function pintar(r) {
    const b = bor(), yo = ls.get('si-yo') || {};
    if (b && b.enviando) { pintarEnviando(r, b); return; }
    if (!b) {
      r.innerHTML = `<div class="si-wrap"><div class="si-catsel si-cat--inv"><span class="si-cat-ic">${IC}</span><span><small>Bodegas de uso</small><b>Inventario</b></span><button type="button" class="btn btn-secondary btn-sm" data-iv-salir>Volver</button></div>
        <h2 class="si-t">Inventario</h2><p class="si-s">Elige la bodega. Para cada producto verás cuánto <b>debería haber</b> según el sistema; anota lo que <b>realmente hay</b>. Todo queda guardado en este teléfono hasta que envíes, aunque se corte internet.</p>
        <p class="si-s">Al enviar, bodega lo revisa: acepta (se descuenta lo usado y te reponen lo que falta) o te pide recontar algún producto.</p><div id="iv-bods">${window.SAR_Progreso && window.SAR_Progreso.cargando ? window.SAR_Progreso.cargando('Buscando tus bodegas…') : 'Cargando…'}</div><div id="si-mias"></div></div>`;
      await cargarBodegas(); const el = r.querySelector('#iv-bods'); if (!el) return;
      el.innerHTML = bodegasU && bodegasU.length ? bodegasU.map(x => `<button type="button" class="btn btn-primary si-env" data-iv-iniciar="${esc(x.id)}">Iniciar inventario · ${esc(x.name)}</button>`).join('') : '<p class="si-v">No hay bodegas de uso con dotación, o no tienes permiso para verlas. Avísale a bodega.</p>';
      return;
    }
    const cont = b.cont || {}, items = (b.items || []).slice().sort((x, y) => (y.p ? 1 : 0) - (x.p ? 1 : 0) || x.n.localeCompare(y.n, 'es'));
    const nSin = items.filter(it => !calc(it, cont[it.k])).length, nDif = items.filter(it => { const c = calc(it, cont[it.k]); return c && (c.usado > 0 || c.sobra > 0); }).length;
    r.innerHTML = `<div class="si-wrap iv-wrap"><div class="si-catsel si-cat--inv"><span class="si-cat-ic">${IC}</span><span><small>${b.modo === 'reconteo' ? 'Reconteo pedido por bodega' : 'Inventario en curso · desde ' + esc(hora(b.inicio))}</small><b>${esc(b.bodega)}</b></span><button type="button" class="btn btn-secondary btn-sm" data-iv-salir>Salir</button></div>
      <p class="si-v">Datos del sistema al ${esc(hora(b.datosAl))}${b.cache ? ' (sin internet: los últimos guardados)' : ''} · se guarda en este teléfono a medida que cuentas.</p>
      ${yo.n && yo.c ? '' : `<div class="si-dos"><label class="si-l">Tu nombre<input id="iv-nom" class="si-in" value="${esc(yo.n || '')}" placeholder="Nombre y apellido" autocomplete="name"></label><label class="si-l">Tu correo<input id="iv-cor" class="si-in" type="email" value="${esc(yo.c || '')}" placeholder="nombre@cormumel.cl" autocomplete="email" inputmode="email"></label></div>`}
      <div class="iv-fil" role="group" aria-label="Filtrar productos">${[['todos', `Todos (${items.length})`], ['sin', `Sin contar (${nSin})`], ['dif', `Con diferencia (${nDif})`]].map(([v, t]) => `<button type="button" class="iv-chip${filtro === v ? ' on' : ''}" data-iv-fil="${v}" aria-pressed="${filtro === v}">${t}</button>`).join('')}</div>
      <label class="si-l">Buscar producto<input id="iv-bus" class="si-in" type="search" value="${esc(busca)}" placeholder="Escribe parte del nombre…" autocomplete="off"></label>
      <div class="iv-lista">${items.map(it => filaHTML(it, cont[it.k], b)).join('')}</div>
      <div class="iv-bar"><span id="iv-prog"></span><button type="button" class="btn btn-secondary btn-sm" data-iv-sig>Siguiente sin contar</button><button type="button" class="btn btn-primary" data-iv-enviar${enviando ? ' disabled' : ''}>${enviando ? 'Enviando…' : b.modo === 'reconteo' ? 'Enviar reconteo' : 'Enviar inventario'}</button></div>
      <button type="button" class="iv-desc" data-iv-descartar>${b.modo === 'reconteo' ? 'Dejar el reconteo para después' : 'Descartar este inventario y empezar de nuevo'}</button></div>`;
    if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(r);
    filtrar(r); progreso(r);
  }
  function pintarEnviando(r, b) {
    const x = mias().find(y => y.numero === b.enviando);
    r.innerHTML = `<div class="si-wrap"><div class="si-catsel si-cat--inv"><span class="si-cat-ic">${IC}</span><span><small>Inventario enviado</small><b>${esc(b.bodega)}</b></span><button type="button" class="btn btn-secondary btn-sm" data-iv-salir>Volver</button></div>
      <h2 class="si-t">${x && !x._pend ? 'Inventario recibido por bodega' : 'Esperando conexión'}</h2>
      <p class="si-s">${x && !x._pend ? 'Bodega ya lo tiene. Lo verás abajo en «Tus solicitudes».' : 'Lo contado está guardado en este teléfono y se enviará solo al volver internet. No cierres la sesión.'}</p>
      ${x && !x._pend ? '' : '<button type="button" class="btn btn-secondary si-env" data-iv-reenviar>Reintentar ahora</button>'}<div id="si-mias"></div></div>`;
    if (x && !x._pend) { ls.del(K_BOR); mostrar = false; }
  }
  function progreso(r) {
    const b = bor(), el = r.querySelector('#iv-prog'); if (!el || !b) return; const items = b.items || [];
    const c = items.filter(it => calc(it, (b.cont || {})[it.k])).length;
    el.innerHTML = `<b>${c}</b> de ${items.length} contados<i style="--p:${items.length ? Math.round(c / items.length * 100) : 0}%"></i>`;
  }
  function filtrar(r) {
    const q = norm(busca).split(' ').filter(Boolean), b = bor() || {}, cont = b.cont || {};
    r.querySelectorAll('.iv-row').forEach(x => { const it = (b.items || []).find(y => y.k === x.dataset.k), c = it && calc(it, cont[it.k]);
      const okF = filtro === 'todos' || (filtro === 'sin' && !c) || (filtro === 'dif' && c && (c.usado > 0 || c.sobra > 0));
      x.hidden = !okF || (q.length > 0 && !q.every(w => x.dataset.nom.includes(w))); });
  }
  function guardarValor(r, row, v) {
    const b = bor(); if (!b) return; b.cont = b.cont || {}; if (v === '' || v === null) delete b.cont[row.dataset.k]; else b.cont[row.dataset.k] = Math.max(0, Math.floor(num(v))); ls.set(K_BOR, b);
    const it = (b.items || []).find(x => x.k === row.dataset.k), res = calc(it, b.cont[row.dataset.k]);
    row.className = 'iv-row iv-' + (!res ? 'pend' : res.usado > 0 ? 'falta' : res.sobra > 0 ? 'sobra' : 'ok');
    row.querySelector('.iv-res span').innerHTML = resTxt(res); progreso(r);
  }
  async function iniciar(r, id) {
    await cargarBodegas(); const B = (bodegasU || []).find(x => x.id === id); if (!B) return;
    const el = r.querySelector('#iv-bods'); if (el) el.innerHTML = window.SAR_Progreso && window.SAR_Progreso.cargando ? window.SAR_Progreso.cargando('Leyendo la dotación y el stock…') : 'Cargando…';
    try { const d = await datosBodega(B); if (!d.items.length) { toast('Inventario', 'Esta bodega aún no tiene dotación definida.', 'warning'); pintar(r); return; }
      ls.set(K_BOR, { modo: 'inventario', bodegaId: B.id, bodega: B.name, inicio: new Date().toISOString(), datosAl: d.al, cache: !!d.cache, items: d.items, cont: {} }); busca = ''; filtro = 'todos'; pintar(r); window.scrollTo && window.scrollTo(0, 0);
    } catch (e) { toast('Sin datos', 'Abre el inventario una vez con internet para dejar la bodega guardada en el teléfono.', 'warning'); pintar(r); }
  }
  async function iniciarReconteo(numero) {
    const x = mias().find(y => y.numero === numero); if (!x) return; const ks = new Set(x.conteo.reconteo || []);
    const items = (x.conteo.items || []).filter(it => ks.has(it.k)).map(it => ({ k: it.k, n: it.n, sis: it.sis, obj: it.obj })), antes = {}; items.forEach(it => { antes[it.k] = ((x.conteo.items || []).find(y => y.k === it.k) || {}).contado; });
    ls.set(K_BOR, { modo: 'reconteo', numero, bodegaId: x.conteo.bodegaId, bodega: x.bodega, inicio: new Date().toISOString(), datosAl: x.conteo.fin || x.creadoEn, items, antes, cont: {} });
    ss.del('inv-oculto'); mostrar = true; busca = ''; filtro = 'todos'; repintar(); window.scrollTo && window.scrollTo(0, 0);
  }
  async function enviar(r) {
    const b = bor(); if (!b || enviando) return;
    const n = document.getElementById('iv-nom'), c = document.getElementById('iv-cor'), yo = ls.get('si-yo') || {}, au = window.firebaseAuth && window.firebaseAuth.currentUser;
    if (n) yo.n = n.value.trim(); if (c) yo.c = c.value.trim(); if (!yo.c && au && au.email) yo.c = au.email; ls.set('si-yo', yo);
    const cont = b.cont || {}, items = b.items || [], falta = items.filter(it => !calc(it, cont[it.k]));
    if (falta.length) { toast('Faltan productos', `Te faltan ${falta.length} por contar (pon 0 si no hay).`, 'warning'); filtro = 'sin'; busca = ''; pintar(r); return; }
    if (!yo.n) { toast('Inventario', 'Escribe tu nombre.', 'warning'); return; }
    const rs = items.map(it => ({ it, r: calc(it, cont[it.k]) })), dif = rs.filter(x => x.r.usado > 0 || x.r.sobra > 0).length;
    const P = window.SAR_Progreso, f = window.firebaseFirestore, db = window.firebaseDb, S = window.SAR_Solicitudes;
    const ok = P && P.confirmar ? await P.confirmar({ titulo: b.modo === 'reconteo' ? '¿Enviar reconteo?' : '¿Enviar inventario?', texto: `${esc(b.bodega)} · ${items.length} producto(s) contados.`, lineas: [`${dif} con diferencia respecto del sistema.`, 'Bodega lo revisa: acepta (se descuenta lo usado y te reponen) o te pide recontar.'], si: 'Enviar' }) : confirm('¿Enviar?');
    if (!ok) return;
    enviando = true; pintar(r); let pr, numero;
    if (b.modo === 'reconteo') {
      numero = b.numero; const ref = f.doc(f.collection(db, S.COL), numero);
      try { const sn = await f.getDoc(ref); if (!sn.exists()) throw new Error('La solicitud ya no existe.'); const x = sn.data(), ahora = new Date().toISOString();
        const nuevos = (x.conteo.items || []).map(it => cont[it.k] !== undefined ? { ...it, contado1: it.contado1 !== undefined ? it.contado1 : it.contado, contado: num(cont[it.k]), recontado: num(cont[it.k]) } : it);
        pr = f.updateDoc(ref, { conteo: { ...x.conteo, items: nuevos, estado: 'recontado', recontadoEn: ahora }, historial: (x.historial || []).concat([{ estado: x.estado, por: yo.c || '', en: ahora, nota: `Reconteo enviado (${Object.keys(cont).length})` }]), editadoEn: ahora });
      } catch (e) { enviando = false; toast('No se envió', esc(e.message || e), 'error'); pintar(r); return; }
    } else {
      const ahora = new Date(); numero = S.numeroSolicitud(ahora);
      const data = { tipo: S.TIPO, numero, estado: 'NUEVA', origen: 'transitoria', destino: 'transitoria', uid: (au && au.uid) || '', requester: String(yo.c || '').toLowerCase(), solicitante: yo.n, correo: String(yo.c || '').toLowerCase(), servicio: 'Inventario ' + b.bodega, bodega: b.bodega, nota: 'Inventario de ' + b.bodega,
        lineas: (() => { const l = lineasDe(items, cont); return l.length ? l.slice(0, 200) : [{ nombre: 'Inventario completo: sin reposición', cantidad: 0, soloConteo: true }]; })(),
        conteo: { bodegaId: b.bodegaId, bodega: b.bodega, inicio: b.inicio, fin: ahora.toISOString(), datosAl: b.datosAl, items: items.map(it => ({ k: it.k, n: it.n, i: it.i || '', sis: num(it.sis), obj: num(it.obj), contado: num(cont[it.k]) })) },
        creadoEn: ahora.toISOString(), historial: [{ estado: 'NUEVA', por: String(yo.c || '').toLowerCase(), en: ahora.toISOString() }] };
      b.datos = data; pr = f.setDoc(f.doc(f.collection(db, S.COL), numero), data);
    }
    // el borrador queda marcado «enviando» hasta que el servidor confirme; si se rechaza, vuelve a quedar para reenviar
    b.enviando = numero; ls.set(K_BOR, b);
    const res = await Promise.race([pr.then(() => 'ok'), new Promise(x => setTimeout(() => x('cola'), 4000))]).catch(e => 'error:' + (e.message || e));
    pr.then(() => { const z = bor(); if (z && z.enviando === numero) ls.del(K_BOR); }).catch((e) => { const z = bor(); if (z && z.enviando === numero) { delete z.enviando; ls.set(K_BOR, z); } toast('No se envió', 'Bodega no recibió el inventario: ' + esc(e.message || e) + '. Revisa y vuelve a enviar.', 'error'); repintar(); });
    enviando = false;
    if (String(res).startsWith('error')) { const z = bor(); if (z) { delete z.enviando; ls.set(K_BOR, z); } toast('No se envió', esc(res.slice(6)) || 'Intenta de nuevo.', 'error'); pintar(r); return; }
    if (b.modo !== 'reconteo') S.recordarMia(numero);
    if (res === 'ok') { ls.del(K_BOR); mostrar = false; busca = ''; repintar(); }
    else pintar(r);
    if (P && P.exito) P.exito({ titulo: res === 'ok' ? (b.modo === 'reconteo' ? 'Reconteo enviado' : 'Inventario enviado') : 'Guardado en el teléfono', texto: res === 'ok' ? 'Bodega lo revisará. Abajo verás cuando lo acepte.' : 'Se enviará solo cuando vuelva internet.' });
    window.scrollTo && window.scrollTo(0, 0);
  }
  /** Reintentar SIN crear otro inventario: si ya llegó, listo; si no, se vuelve a escribir el MISMO documento (mismo N°). */
  async function reenviar(r, btn) {
    const b = bor(); if (!b || !b.enviando) return; const f = window.firebaseFirestore, db = window.firebaseDb, S = window.SAR_Solicitudes, ref = f.doc(f.collection(db, S.COL), b.enviando);
    btn.disabled = true; btn.textContent = 'Revisando…';
    try { const sn = await f.getDoc(ref);
      if (sn.exists() && (b.modo !== 'reconteo' || (sn.data().conteo || {}).estado === 'recontado')) { ls.del(K_BOR); mostrar = false; toast('Inventario', 'Ya lo tiene bodega.', 'success'); repintar(); return; }
      if (b.modo === 'reconteo') { delete b.enviando; ls.set(K_BOR, b); enviar(r); return; }   // un reconteo es una actualización del mismo documento: no duplica
      if (b.datos) { await Promise.race([f.setDoc(ref, b.datos), new Promise((_, x) => setTimeout(() => x(new Error('sin respuesta')), 6000))]); ls.del(K_BOR); mostrar = false; toast('Inventario', 'Enviado.', 'success'); repintar(); return; }
    } catch (e) { toast('Sin conexión', 'Sigue guardado en el teléfono; se enviará solo al volver internet.', 'warning'); }
    btn.disabled = false; btn.textContent = 'Reintentar ahora';
  }
  /** Eventos delegados en el contenedor de la página (se enlazan una sola vez). */
  function enlazar(r) {
    if (!r || r.dataset.iv) return; r.dataset.iv = '1';
    r.addEventListener('click', async (e) => {
      const t = e.target.closest('button'); if (!t || !enCurso()) return;
      const row = t.closest('.iv-row'), inp = row && row.querySelector('.iv-in');
      if (t.hasAttribute('data-iv-salir')) { mostrar = false; if (bor()) ss.set('inv-oculto'); repintar(); }
      else if (t.dataset.ivIniciar) iniciar(r, t.dataset.ivIniciar);
      else if (t.dataset.ivFil) { filtro = t.dataset.ivFil; pintar(r); }
      else if (t.hasAttribute('data-iv-m') && inp) { inp.value = Math.max(0, num(inp.value) - 1); guardarValor(r, row, inp.value); }
      else if (t.hasAttribute('data-iv-p') && inp) { inp.value = inp.value === '' ? 1 : num(inp.value) + 1; guardarValor(r, row, inp.value); }
      else if (t.hasAttribute('data-iv-igual') && inp) { const it = ((bor() || {}).items || []).find(x => x.k === row.dataset.k); inp.value = num(it && it.sis); guardarValor(r, row, inp.value); }
      else if (t.hasAttribute('data-iv-sig')) { const x = [...r.querySelectorAll('.iv-row.iv-pend')].find(y => !y.hidden) || r.querySelector('.iv-row.iv-pend'); if (x) { x.hidden = false; x.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = x.querySelector('.iv-in'); if (i) setTimeout(() => i.focus({ preventScroll: true }), 300); } else toast('Inventario', 'Ya contaste todo.', 'success'); }
      else if (t.hasAttribute('data-iv-enviar')) enviar(r);
      else if (t.hasAttribute('data-iv-reenviar')) reenviar(r, t);
      else if (t.hasAttribute('data-iv-descartar')) { const b = bor(); if (b && b.modo === 'reconteo') { ls.del(K_BOR); mostrar = false; repintar(); return; } const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: '¿Descartar el inventario?', texto: 'Se borra lo contado en este teléfono. No se envía nada.', si: 'Descartar' }) : confirm('¿Descartar lo contado?'); if (ok) { ls.del(K_BOR); pintar(r); } }
    });
    r.addEventListener('input', (e) => {
      if (!enCurso()) return;
      if (e.target.id === 'iv-bus') { busca = e.target.value; filtrar(r); return; }
      if (e.target.id === 'iv-nom' || e.target.id === 'iv-cor') { const yo = ls.get('si-yo') || {}; yo[e.target.id === 'iv-nom' ? 'n' : 'c'] = e.target.value.trim(); ls.set('si-yo', yo); return; }
      if (e.target.classList.contains('iv-in')) guardarValor(r, e.target.closest('.iv-row'), e.target.value);
    });
  }

  if (typeof document.addEventListener === 'function' && typeof window.addEventListener === 'function' && window.SAR_SOLICITUD_PUBLICA !== false) {
    let n = 0; const t = setInterval(() => { n++; const r = document.getElementById('si-pide'); if (r) { enlazar(r); clearInterval(t); } else if (n > 240) clearInterval(t); }, 250);
    window.addEventListener('sar-rol', () => { bodegasU = null; if (habil() && (bor() || window.__abrirInvTrasLogin)) mostrar = true; else if (window.__abrirInvTrasLogin && window.SAR_Sesion && window.SAR_Sesion.usuario()) toast('Sin inventario asignado', 'Tu usuario no tiene una bodega para inventariar. Avísale a bodega.', 'warning'); window.__abrirInvTrasLogin = false; repintar(); });
  }

  const api = { boton, pintar, enCurso, calc, lineasDe, abrir };
  window.SAR_InvMovil = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
