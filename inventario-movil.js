/* ==========================================================================
   INVENTARIO DE BODEGA TRANSITORIA DESDE EL TELÉFONO (página «Pedir insumos», v21.210)
   · Solo para la persona asignada: bodega genera un enlace (solicitar.html?inv=CÓDIGO); el teléfono guarda el código y
     el catálogo público trae solo su huella, así el botón aparece únicamente en ese teléfono.
   · «Iniciar inventario»: por producto muestra cuánto debería haber según el sistema y la dotación; se anota lo contado.
     Cada número queda guardado en el teléfono (sin internet también) y la pantalla vuelve a abrirse con lo contado
     hasta que se toque «Enviar inventario».
   · Al enviar: una solicitud (origen «transitoria») con el conteo y las líneas de reposición (dotación − contado).
     La sesión de bodega la cuadra sola (descuenta lo usado = sistema − contado) y la reposición queda en la bandeja.
   · Quiebres: si lo pedido la vez anterior no llegó completo, se avisa en el producto y la línea va marcada
     «sigue faltando» con los días seguidos.
   ========================================================================== */
(function (window, document) {
  'use strict';
  const K_COD = 'inv-codigo', K_BOR = 'inv-borrador';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v) || 0;
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } } };
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k) { try { sessionStorage.setItem(k, '1'); } catch (e) { /* nada */ } }, del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* nada */ } } };
  const fecha = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}-${m[2]}` : ''; };
  const IC = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="8" width="28" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M18 8V5h12v3" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="m17 24 4 4 9-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 35h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="38" cy="40" r="3" fill="#8CC63F"/></svg>';

  // ---------------- lógica pura ----------------
  /** Resultado de un producto contado: usado (se descuenta) y a pedir (para volver a la dotación). */
  function calc(it, contado) {
    if (contado === null || contado === undefined || contado === '') return null;
    const c = Math.max(0, Math.floor(num(contado)));
    return { contado: c, usado: Math.max(0, num(it.sis) - c), sobra: Math.max(0, c - num(it.sis)), pide: Math.max(0, num(it.obj) - c) };
  }
  /** Líneas de la solicitud: lo que falta para la dotación; primero lo que sigue faltando de antes. */
  function lineasDe(items, cont) {
    const l = items.map(it => { const r = calc(it, cont[it.k]); if (!r || r.pide <= 0) return null; return { nombre: it.n, cantidad: r.pide, k: it.k, ...(it.i ? { insumoId: it.i } : {}), ...(it.p ? { reiterado: num(it.p.dias || 1) + 1 } : {}) }; }).filter(Boolean);
    return l.sort((a, b) => num(b.reiterado) - num(a.reiterado) || a.nombre.localeCompare(b.nombre, 'es'));
  }
  async function sha(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sar-inv|' + String(t || '').trim())); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }

  // ---------------- estado ----------------
  let habil = false, invalido = false, mostrar = false, busca = '', enviando = false;
  const trans = () => (window.SAR_CatalogoPublico && window.SAR_CatalogoPublico.transitoria) || null;
  const bodegasT = () => ((trans() || {}).bodegas || []).filter(b => (b.items || []).length);
  const bor = () => ls.get(K_BOR);
  const bodDe = (b) => b && bodegasT().find(x => x.id === b.bodegaId);
  const repintar = () => { if (window.SAR_Solicitudes && window.SAR_Solicitudes.repintar) window.SAR_Solicitudes.repintar(); };

  async function revisar() {
    const t = trans(), cod = ls.get(K_COD); if (!t || !cod) { habil = false; invalido = false; return; }
    try { habil = !!t.hash && (await sha(cod)) === t.hash; } catch (e) { habil = false; }
    invalido = !habil;
    if (habil && bor() && !ss.get('inv-oculto')) mostrar = true;
  }
  function enCurso() { return habil && mostrar; }

  // ---------------- interfaz ----------------
  function boton(el) {
    if (!el) return;
    if (!habil) { el.innerHTML = invalido ? '<p class="si-v">Tu enlace de inventario ya no es válido: pide uno nuevo a bodega.</p>' : ''; return; }
    const b = bor(), B = bodDe(b), n = B ? B.items.length : 0, c = b ? Object.keys(b.cont || {}).filter(k => b.cont[k] !== '' && b.cont[k] != null).length : 0;
    el.innerHTML = `<p class="si-sep">Bodega transitoria</p><button type="button" class="si-cat si-cat--inv" id="iv-abrir"><span class="si-cat-ic">${IC}</span><span class="si-cat-tx"><b>Inventario bodega transitoria</b><small>${b && B ? `Inventario en curso: ${c} de ${n} contados. Toca para seguir.` : 'Cuenta lo que hay; se descuenta lo usado y se pide la reposición.'}</small></span><i aria-hidden="true">›</i></button>`;
    el.querySelector('#iv-abrir').onclick = () => { ss.del('inv-oculto'); mostrar = true; repintar(); window.scrollTo && window.scrollTo(0, 0); };
  }
  function filaHTML(it, v) {
    const r = calc(it, v), p = it.p, est = !r ? '' : r.usado > 0 ? 'falta' : r.sobra > 0 ? 'sobra' : 'ok';
    const IM = window.SAR_Imagenes;
    return `<div class="iv-row${est ? ' iv-' + est : ''}" data-k="${esc(it.k)}" data-nom="${esc(norm(it.n))}">
      <div class="iv-h">${IM ? IM.thumb(it.n, { codigo: it.c || '' }) : ''}<div class="iv-t"><b>${esc(it.n)}</b><small>Debería haber <b>${num(it.sis)}</b> · dotación ${num(it.obj)}</small>
        ${p ? `<span class="iv-quiebre">${p.est === 'no_hay' ? 'Bodega no tenía' : p.est === 'parcial' ? `Llegaron ${p.dio} de ${p.pidio}` : `Pedido sin entregar (${p.pidio})`} · pedido el ${esc(fecha(p.fecha))}${num(p.dias) > 1 ? ` · ${num(p.dias)} días seguidos` : ''}</span>` : ''}</div></div>
      <div class="iv-c"><button type="button" class="iv-b" data-iv-m aria-label="Uno menos">−</button><input type="number" min="0" inputmode="numeric" class="iv-in" value="${v === undefined || v === null ? '' : esc(v)}" placeholder="?" aria-label="Contado de ${esc(it.n)}"><button type="button" class="iv-b" data-iv-p aria-label="Uno más">+</button>
        <button type="button" class="iv-igual" data-iv-igual>Están las ${num(it.sis)}</button></div>
      <p class="iv-res">${resTxt(r)}</p></div>`;
  }
  function resTxt(r) {
    if (!r) return '';
    if (r.usado > 0) return `Se usaron <b>${r.usado}</b>${r.pide > 0 ? ` · se piden <b>${r.pide}</b>` : ''}`;
    if (r.sobra > 0) return `Hay <b>${r.sobra}</b> más de lo que dice el sistema${r.pide > 0 ? ` · se piden ${r.pide}` : ''}`;
    return r.pide > 0 ? `Sin uso · se piden <b>${r.pide}</b> para la dotación` : '✔ Completo';
  }
  function pintar(r) {
    const b = bor(), B = bodDe(b), yo = ls.get('si-yo') || {};
    if (!b || !B) {
      const bs = bodegasT();
      r.innerHTML = `<div class="si-wrap"><div class="si-catsel si-cat--inv"><span class="si-cat-ic">${IC}</span><span><small>Bodega transitoria</small><b>Inventario</b></span><button type="button" class="btn btn-secondary btn-sm" data-iv-salir>Volver</button></div>
        <h2 class="si-t">Inventario de la bodega transitoria</h2>
        <p class="si-s">Cuenta lo que hay de cada producto. Para cada uno verás cuánto <b>debería haber</b>; anota lo que <b>realmente hay</b>. Todo queda guardado en este teléfono (aunque se corte internet) hasta que envíes.</p>
        <p class="si-s">Al enviar, se descuenta lo que se usó y se pide a bodega lo necesario para completar la dotación.</p>
        ${bs.length ? bs.map(x => `<button type="button" class="btn btn-primary si-env" data-iv-iniciar="${esc(x.id)}">Iniciar inventario · ${esc(x.bodega)} (${x.items.length} productos)</button>`).join('') : '<p class="si-v">Bodega aún no define qué productos van en la bodega transitoria.</p>'}
        <div id="si-mias"></div></div>`;
      return;
    }
    const cont = b.cont || {}, items = B.items.slice().sort((x, y) => (y.p ? 1 : 0) - (x.p ? 1 : 0) || x.n.localeCompare(y.n, 'es'));
    r.innerHTML = `<div class="si-wrap iv-wrap"><div class="si-catsel si-cat--inv"><span class="si-cat-ic">${IC}</span><span><small>Inventario en curso · desde ${esc(new Date(b.inicio).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</small><b>${esc(B.bodega)}</b></span><button type="button" class="btn btn-secondary btn-sm" data-iv-salir>Salir</button></div>
      <p class="si-v">Se guarda en este teléfono a medida que cuentas. Si sales, al volver sigue donde quedaste.</p>
      ${yo.n && yo.c ? '' : `<div class="si-dos"><label class="si-l">Tu nombre<input id="iv-nom" class="si-in" value="${esc(yo.n || '')}" placeholder="Nombre y apellido" autocomplete="name"></label><label class="si-l">Tu correo<input id="iv-cor" class="si-in" type="email" value="${esc(yo.c || '')}" placeholder="nombre@cormumel.cl" autocomplete="email" inputmode="email"></label></div>`}
      <label class="si-l">Buscar producto<input id="iv-bus" class="si-in" value="${esc(busca)}" placeholder="Escribe parte del nombre…" autocomplete="off"></label>
      <div class="iv-lista">${items.map(it => filaHTML(it, cont[it.k])).join('')}</div>
      <div class="iv-bar"><span id="iv-prog"></span><button type="button" class="btn btn-primary" data-iv-enviar${enviando ? ' disabled' : ''}>Enviar inventario</button></div>
      <button type="button" class="iv-desc" data-iv-descartar>Descartar este inventario y empezar de nuevo</button></div>`;
    if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(r);
    filtrar(r); progreso(r);
  }
  function progreso(r) {
    const b = bor(), B = bodDe(b), el = r.querySelector('#iv-prog'); if (!el || !B) return;
    const c = B.items.filter(it => calc(it, (b.cont || {})[it.k])).length;
    el.innerHTML = `<b>${c}</b> de ${B.items.length} contados<i style="--p:${Math.round(c / B.items.length * 100)}%"></i>`;
  }
  function filtrar(r) { const q = norm(busca).split(' ').filter(Boolean); r.querySelectorAll('.iv-row').forEach(x => { x.hidden = q.length > 0 && !q.every(w => x.dataset.nom.includes(w)); }); }
  function guardarValor(r, row, v) {
    const b = bor(); if (!b) return; b.cont = b.cont || {}; if (v === '' || v === null) delete b.cont[row.dataset.k]; else b.cont[row.dataset.k] = Math.max(0, Math.floor(num(v))); ls.set(K_BOR, b);
    const B = bodDe(b), it = B && B.items.find(x => x.k === row.dataset.k), res = calc(it, b.cont[row.dataset.k]);
    row.className = 'iv-row' + (!res ? '' : res.usado > 0 ? ' iv-falta' : res.sobra > 0 ? ' iv-sobra' : ' iv-ok');
    row.querySelector('.iv-res').innerHTML = resTxt(res); progreso(r);
  }
  async function enviar(r) {
    const b = bor(), B = bodDe(b); if (!b || !B) return;
    const n = document.getElementById('iv-nom'), c = document.getElementById('iv-cor'), yo = ls.get('si-yo') || {};
    if (n) yo.n = n.value.trim(); if (c) yo.c = c.value.trim(); ls.set('si-yo', yo);
    const cont = b.cont || {}, falta = B.items.filter(it => !calc(it, cont[it.k]));
    if (falta.length) { toast('Faltan productos', `Te faltan ${falta.length} por contar (pon 0 si no hay).`, 'warning'); const x = r.querySelector(`.iv-row[data-k="${CSS.escape(falta[0].k)}"]`); if (x) { busca = ''; filtrar(r); x.scrollIntoView({ behavior: 'smooth', block: 'center' }); x.classList.add('iv-marca'); } return; }
    if (!yo.n) { toast('Inventario', 'Escribe tu nombre.', 'warning'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(yo.c || '')) { toast('Inventario', 'Escribe tu correo.', 'warning'); return; }
    const rs = B.items.map(it => ({ it, r: calc(it, cont[it.k]) })), usado = rs.reduce((t, x) => t + x.r.usado, 0), conUso = rs.filter(x => x.r.usado > 0).length;
    let lineas = lineasDe(B.items, cont); const nRep = lineas.length, sigue = lineas.filter(l => num(l.reiterado) > 1).length;
    const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: '¿Enviar inventario?', texto: `${esc(B.bodega)} · ${B.items.length} productos contados.`, lineas: [`Se usaron <b>${usado}</b> unidades en ${conUso} producto(s): se descuentan del stock.`, nRep ? `Se piden <b>${nRep}</b> producto(s) para completar la dotación.` : 'Está todo completo: no se pide reposición.', ...(sigue ? [`<b>${sigue}</b> producto(s) siguen faltando desde el pedido anterior.`] : [])], si: 'Enviar' }) : confirm('¿Enviar inventario?');
    if (!ok) return;
    if (!lineas.length) lineas = [{ nombre: 'Inventario completo: sin reposición', cantidad: 0, soloConteo: true, estado: 'ok', entregar: 0 }];
    const S = window.SAR_Solicitudes, f = window.firebaseFirestore, db = window.firebaseDb, au = window.firebaseAuth && window.firebaseAuth.currentUser, ahora = new Date(), numero = S.numeroSolicitud(ahora);
    const data = { tipo: S.TIPO, numero, estado: 'NUEVA', origen: 'transitoria', uid: (au && au.uid) || '', requester: yo.c.toLowerCase(), solicitante: yo.n, correo: yo.c.toLowerCase(), servicio: 'Inventario ' + B.bodega, bodega: B.bodega, nota: 'Inventario de la bodega transitoria', lineas,
      conteo: { bodegaId: B.id, bodega: B.bodega, codigo: ls.get(K_COD) || '', inicio: b.inicio, fin: ahora.toISOString(), items: B.items.map(it => ({ k: it.k, n: it.n, i: it.i || '', sis: num(it.sis), obj: num(it.obj), contado: num(cont[it.k]) })) },
      creadoEn: ahora.toISOString(), historial: [{ estado: 'NUEVA', por: yo.c.toLowerCase(), en: ahora.toISOString() }] };
    enviando = true; pintar(r);
    const pr = f.setDoc(f.doc(f.collection(db, S.COL), numero), data);
    const res = await Promise.race([pr.then(() => 'ok'), new Promise(x => setTimeout(() => x('cola'), 2500))]).catch(e => 'error:' + (e.message || e));
    enviando = false;
    if (String(res).startsWith('error')) { toast('No se envió', res.slice(6) || 'Intenta de nuevo.', 'error'); pintar(r); return; }
    pr.catch(() => { /* se reintenta sola al volver internet */ });
    ls.del(K_BOR); S.recordarMia(numero); mostrar = false; busca = ''; repintar();
    if (P && P.exito) P.exito({ titulo: res === 'ok' ? 'Inventario enviado' : 'Guardado en el teléfono', texto: res === 'ok' ? 'Se descuenta lo usado y bodega ya ve tu pedido de reposición.' : 'Se enviará solo cuando vuelva internet.' });
    window.scrollTo && window.scrollTo(0, 0);
  }
  /** Eventos delegados en el contenedor de la página (se enlazan una sola vez). */
  function enlazar(r) {
    if (!r || r.dataset.iv) return; r.dataset.iv = '1';
    r.addEventListener('click', async (e) => {
      const t = e.target.closest('button'); if (!t || !enCurso()) return;
      const row = t.closest('.iv-row'), inp = row && row.querySelector('.iv-in');
      if (t.hasAttribute('data-iv-salir')) { mostrar = false; if (bor()) ss.set('inv-oculto'); repintar(); }
      else if (t.dataset.ivIniciar) { ls.set(K_BOR, { bodegaId: t.dataset.ivIniciar, inicio: new Date().toISOString(), cont: {} }); busca = ''; pintar(r); window.scrollTo && window.scrollTo(0, 0); }
      else if (t.hasAttribute('data-iv-m') && inp) { inp.value = Math.max(0, num(inp.value) - 1); guardarValor(r, row, inp.value); }
      else if (t.hasAttribute('data-iv-p') && inp) { inp.value = inp.value === '' ? 1 : num(inp.value) + 1; guardarValor(r, row, inp.value); }
      else if (t.hasAttribute('data-iv-igual') && inp) { const B = bodDe(bor()), it = B && B.items.find(x => x.k === row.dataset.k); inp.value = num(it && it.sis); guardarValor(r, row, inp.value); row.classList.remove('iv-marca'); }
      else if (t.hasAttribute('data-iv-enviar')) enviar(r);
      else if (t.hasAttribute('data-iv-descartar')) { const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: '¿Descartar el inventario?', texto: 'Se borra lo contado en este teléfono. No se envía nada.', si: 'Descartar' }) : confirm('¿Descartar lo contado?'); if (ok) { ls.del(K_BOR); pintar(r); } }
    });
    r.addEventListener('input', (e) => {
      if (!enCurso()) return;
      if (e.target.id === 'iv-bus') { busca = e.target.value; filtrar(r); return; }
      if (e.target.id === 'iv-nom' || e.target.id === 'iv-cor') { const yo = ls.get('si-yo') || {}; yo[e.target.id === 'iv-nom' ? 'n' : 'c'] = e.target.value.trim(); ls.set('si-yo', yo); return; }
      if (e.target.classList.contains('iv-in')) { const row = e.target.closest('.iv-row'); guardarValor(r, row, e.target.value); row.classList.remove('iv-marca'); }
    });
  }

  // enlace de la persona asignada: solicitar.html?inv=CÓDIGO (se guarda y se quita de la barra de direcciones)
  try { const u = new URL(location.href), c = u.searchParams.get('inv'); if (c) { ls.set(K_COD, c); ss.del('inv-oculto'); u.searchParams.delete('inv'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); } } catch (e) { /* sin URL */ }
  // cuando llega el catálogo público: revisar el código y, si hay un inventario a medias, volver a mostrarlo
  if (typeof document.addEventListener === 'function' && typeof window.addEventListener === 'function' && window.SAR_SOLICITUD_PUBLICA !== false) {
    let n = 0; const t = setInterval(async () => { n++; const r = document.getElementById('si-pide');
      if (r) enlazar(r);
      if (!trans() && n < 120) return; clearInterval(t);
      await revisar(); if (habil || invalido) repintar(); }, 500);
    window.addEventListener('online', () => { setTimeout(() => revisar().then(repintar), 3000); });
  }

  const api = { boton, pintar, enCurso, calc, lineasDe, sha };
  window.SAR_InvMovil = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
