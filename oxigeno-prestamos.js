/* ==========================================================================
   OXÍGENO PRESTADO A OTROS CENTROS (v21.105)
   Panel dentro de «Oxígeno portátil» con los balones que están en otro centro:
   centro, N° de serie, tipo de gas, capacidad, desde cuándo y con qué respaldo.
   - Registrar préstamo: elige el centro y los balones (llenos o vacíos), con fecha y nota. Sirve también
     para préstamos anteriores al sistema. El acta AE del flujo «Acta de entrega» sigue funcionando igual.
   - Acta firmada de quien recibe: PDF o foto (Contadores/ox-resp-<id>-NNN, en trozos).
   - Fotos de respaldo: se achican a ~1280 px y se guardan una por documento (Contadores/ox-foto-<id>-<n>).
   - Cada acción queda en el historial del balón (Equipos_Oxigeno/<id>/Eventos).
   ========================================================================== */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hoy = () => new Date().toISOString().slice(0, 10);
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };
  const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
  const MAX_DOC = 6 * 1024 * 1024, TROZO = 700000;
  const fCL = (iso) => { const s = String(iso || '').slice(0, 10).split('-'); return s.length === 3 ? s[2] + '/' + s[1] + '/' + s[0] : '—'; };

  /** Puro: balones prestados agrupados por centro: [{centro, equipos:[…]}] ordenado por centro y serie. */
  function agrupar(equipos) {
    const m = new Map();
    (equipos || []).filter(e => e && e.estado === 'PRESTADO').forEach(e => { const c = String(e.prestadoA || e.ubicacion || 'Sin centro').trim() || 'Sin centro'; if (!m.has(c)) m.set(c, []); m.get(c).push(e); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([centro, l]) => ({ centro, equipos: l.sort((a, b) => String(a.serie).localeCompare(String(b.serie), 'es', { numeric: true })) }));
  }
  /** Puro: estado del respaldo de un balón prestado. */
  function respaldoDe(e) {
    const p = (e && e.prestamo) || {};
    return { firmada: !!(p.actaFirmada || (e && e.ultimaEntregaActa && p.actaAE)), fotos: (p.fotos || []).length, actaAE: (e && e.ultimaEntregaActa) || '' };
  }

  function modal(titulo, cuerpo, aceptar, textoOk) {
    const ov = document.createElement('div'); ov.className = 'cierre-overlay';
    ov.innerHTML = `<div class="cierre-box" role="dialog" aria-modal="true"><h3>${esc(titulo)}</h3>${cuerpo}<div class="cierre-error" id="op-err"></div><div class="cierre-acciones"><button type="button" class="btn btn-outline" id="op-x">Cancelar</button>${aceptar ? `<button type="button" class="btn btn-primary" id="op-ok">${esc(textoOk || 'Guardar')}</button>` : ''}</div></div>`;
    document.body.appendChild(ov);
    const q = (s) => ov.querySelector(s); q('#op-x').addEventListener('click', () => ov.remove());
    if (aceptar) q('#op-ok').addEventListener('click', async () => { const b = q('#op-ok'); b.disabled = true; q('#op-err').textContent = ''; try { await aceptar(q); ov.remove(); } catch (e) { q('#op-err').textContent = e.message || String(e); b.disabled = false; } });
    return ov;
  }
  async function evento(id, o) {
    const f = fs(); await f.setDoc(f.doc(f.collection(db(), 'Equipos_Oxigeno', id, 'Eventos')), Object.assign({ fecha: hoy(), usuario: usuario(), creadoEn: f.serverTimestamp() }, o));
  }
  const aB64 = (bytes) => { let b = ''; for (let i = 0; i < bytes.length; i += 0x8000) b += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(b); };
  function achicar(file, max) {
    return new Promise((ok, mal) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.72).split(',')[1]); };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la foto.')); };
      img.src = url;
    });
  }
  const bajarB64 = (b64, mime) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); window.open(URL.createObjectURL(new Blob([u], { type: mime })), '_blank'); };

  async function subirActa(e, file) {
    if (!file) throw new Error('Elige el archivo del acta firmada.');
    if (!/^(application\/pdf|image\/)/.test(file.type || '')) throw new Error('El acta debe ser PDF o una foto.');
    if (file.size > MAX_DOC) throw new Error('El archivo pesa más de 6 MB. Reduce la calidad del escaneo.');
    const f = fs(), b64 = aB64(new Uint8Array(await file.arrayBuffer())), partes = []; for (let i = 0; i < b64.length; i += TROZO) partes.push(b64.slice(i, i + TROZO));
    for (let i = 0; i < partes.length; i++) await f.setDoc(f.doc(f.collection(db(), 'Contadores'), `ox-resp-${e.id}-${String(i).padStart(3, '0')}`), { tipo: 'ox-respaldo', equipoId: e.id, n: i, b64: partes[i], mime: file.type, updatedAt: f.serverTimestamp() });
    const prestamo = Object.assign({}, e.prestamo || {}, { actaFirmada: { nombre: file.name, mime: file.type, partes: partes.length, subidoPor: usuario(), fecha: new Date().toISOString() } });
    await f.updateDoc(f.doc(f.collection(db(), 'Equipos_Oxigeno'), e.id), { prestamo, updatedAt: f.serverTimestamp() });
    await evento(e.id, { tipo: 'PRESTAMO_RESPALDO', detalle: `Acta firmada de ${e.prestadoA || 'otro centro'} subida (${file.name})`, estadoAnterior: 'PRESTADO', estadoNuevo: 'PRESTADO', ubicacion: e.prestadoA || e.ubicacion || '' });
  }
  async function verActa(e) {
    const f = fs(), r = e.prestamo && e.prestamo.actaFirmada; if (!r) return;
    const bs = []; for (let i = 0; i < r.partes; i++) { const d = await f.getDoc(f.doc(f.collection(db(), 'Contadores'), `ox-resp-${e.id}-${String(i).padStart(3, '0')}`)); if (!d.exists()) throw new Error('Falta una parte del archivo.'); bs.push(d.data().b64); }
    bajarB64(bs.join(''), r.mime || 'application/pdf');
  }
  async function subirFotos(e, files) {
    const lista = [...(files || [])].filter(x => /^image\//.test(x.type || '')); if (!lista.length) throw new Error('Elige una o más fotos.');
    const f = fs(), fotos = ((e.prestamo && e.prestamo.fotos) || []).slice();
    for (const file of lista) {
      const b64 = await achicar(file, 1280); if (b64.length > 900000) throw new Error(`La foto ${file.name} sigue muy pesada; usa una de menor resolución.`);
      const id = `ox-foto-${e.id}-${Date.now()}-${fotos.length}`;
      await f.setDoc(f.doc(f.collection(db(), 'Contadores'), id), { tipo: 'ox-foto', equipoId: e.id, b64, mime: 'image/jpeg', updatedAt: f.serverTimestamp() });
      fotos.push({ id, nombre: file.name, fecha: new Date().toISOString(), por: usuario() });
    }
    const prestamo = Object.assign({}, e.prestamo || {}, { fotos });
    await f.updateDoc(f.doc(f.collection(db(), 'Equipos_Oxigeno'), e.id), { prestamo, updatedAt: f.serverTimestamp() });
    await evento(e.id, { tipo: 'PRESTAMO_RESPALDO', detalle: `${lista.length} foto(s) de respaldo agregadas (préstamo a ${e.prestadoA || 'otro centro'})`, estadoAnterior: 'PRESTADO', estadoNuevo: 'PRESTADO', ubicacion: e.prestadoA || e.ubicacion || '' });
  }
  async function verFoto(id) { const d = await fs().getDoc(fs().doc(fs().collection(db(), 'Contadores'), id)); if (!d.exists()) throw new Error('La foto ya no está.'); bajarB64(d.data().b64, d.data().mime || 'image/jpeg'); }

  /** Registra que balones (no prestados) quedaron en otro centro. series: ids de Equipos_Oxigeno. */
  async function registrarPrestamo(equipos, ids, centro, fecha, nota) {
    centro = String(centro || '').trim(); if (!centro) throw new Error('Indica el centro al que se prestó.');
    if (!ids.length) throw new Error('Elige al menos un balón.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '') || fecha > hoy()) throw new Error('La fecha del préstamo no es válida.');
    const f = fs();
    for (const id of ids) {
      const e = equipos.find(x => x.id === id); if (!e) throw new Error('Un balón ya no existe.'); if (e.estado === 'PRESTADO') throw new Error(`El balón ${e.serie} ya figura prestado.`);
      await f.updateDoc(f.doc(f.collection(db(), 'Equipos_Oxigeno'), id), { estado: 'PRESTADO', ubicacion: centro, prestadoA: centro, prestamo: { desde: fecha, nota: String(nota || '').trim(), registradoPor: usuario(), fotos: [] }, updatedAt: f.serverTimestamp() });
      await evento(id, { tipo: 'PRESTAMO', fecha, detalle: `Prestado a ${centro}${nota ? ' · ' + String(nota).trim() : ''}`, estadoAnterior: e.estado, estadoNuevo: 'PRESTADO', ubicacion: centro });
    }
  }

  function html(equipos) {
    const g = agrupar(equipos);
    const filas = (e) => { const r = respaldoDe(e), p = e.prestamo || {};
      return `<div class="op-fila"><div class="op-main"><b class="op-serie">N° ${esc(e.serie)}</b><span>${esc((window.SAR_Oxigeno && window.SAR_Oxigeno.normGas ? window.SAR_Oxigeno.normGas(e.gas) : e.gas) || '')} · ${esc(e.capacidad || 'Sin capacidad')}</span><small>desde ${esc(fCL(p.desde || (e.updatedAt && e.updatedAt.toDate ? e.updatedAt.toDate().toISOString() : '')))}${r.actaAE ? ' · acta ' + esc(r.actaAE) : ''}</small></div>
        <div class="op-resp"><span class="act-chip ${r.firmada ? 'act-c-ok' : 'act-c-sin'}">${r.firmada ? 'Acta firmada' : 'Sin acta firmada'}</span><span class="act-chip">${r.fotos} foto${r.fotos === 1 ? '' : 's'}</span></div>
        <div class="op-acc"><button type="button" class="btn btn-outline btn-sm op-acta" data-id="${esc(e.id)}">${r.firmada ? 'Cambiar acta' : 'Subir acta firmada'}</button>${r.firmada ? `<button type="button" class="btn btn-outline btn-sm op-veracta" data-id="${esc(e.id)}">Ver acta</button>` : ''}<button type="button" class="btn btn-outline btn-sm op-fotos" data-id="${esc(e.id)}">Agregar fotos</button>${r.fotos ? `<button type="button" class="btn btn-outline btn-sm op-verfotos" data-id="${esc(e.id)}">Ver fotos</button>` : ''}</div></div>`; };
    const total = g.reduce((s, x) => s + x.equipos.length, 0), sin = g.reduce((s, x) => s + x.equipos.filter(e => !respaldoDe(e).firmada).length, 0);
    return `<section class="op-panel" id="oxi-prest"><div class="op-cab"><div><h3>Prestados a otros centros <span class="act-chip">${total}</span>${sin ? `<span class="act-chip act-c-sin">${sin} sin acta firmada</span>` : ''}</h3><small>Dónde está cada balón prestado, con su acta firmada y fotos de respaldo.</small></div><button type="button" class="btn btn-primary" id="op-nuevo"><i class="ph-bold ph-plus"></i> Registrar préstamo</button></div>
      ${g.length ? g.map(x => `<div class="op-centro"><h4>${esc(x.centro)} <small>${x.equipos.length} balón(es)</small></h4>${x.equipos.map(filas).join('')}</div>`).join('') : '<p class="act-hint">No hay balones prestados a otros centros.</p>'}</section>`;
  }

  function pintar(root, equipos, ctx) {
    if (!root) return;
    const viejo = root.querySelector('#oxi-prest'); if (viejo) viejo.remove();
    root.insertAdjacentHTML('beforeend', html(equipos));
    const sec = root.querySelector('#oxi-prest'), porId = (id) => equipos.find(e => e.id === id);
    const refrescar = async () => { if (ctx && ctx.refrescar) await ctx.refrescar(); };
    const archivo = (accept, multiple) => new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = !!multiple; i.onchange = () => ok(i.files); i.oncancel = () => ok(null); i.click(); });
    const proteger = async (fn, okTxt) => { try { await fn(); if (okTxt) toast('Oxígeno', okTxt, 'success'); await refrescar(); } catch (e) { toast('No se pudo', e.message || String(e), 'error'); } };
    sec.querySelectorAll('.op-acta').forEach(b => b.addEventListener('click', async () => { const fl = await archivo('application/pdf,image/*', false); if (fl && fl[0]) proteger(() => subirActa(porId(b.dataset.id), fl[0]), 'Acta firmada guardada.'); }));
    sec.querySelectorAll('.op-veracta').forEach(b => b.addEventListener('click', () => proteger(() => verActa(porId(b.dataset.id)))));
    sec.querySelectorAll('.op-fotos').forEach(b => b.addEventListener('click', async () => { const fl = await archivo('image/*', true); if (fl && fl.length) proteger(() => subirFotos(porId(b.dataset.id), fl), 'Fotos guardadas.'); }));
    sec.querySelectorAll('.op-verfotos').forEach(b => b.addEventListener('click', () => { const e = porId(b.dataset.id); ((e.prestamo && e.prestamo.fotos) || []).forEach(x => proteger(() => verFoto(x.id))); }));
    sec.querySelector('#op-nuevo').addEventListener('click', () => {
      const libres = equipos.filter(e => e.estado === 'LLENO' || e.estado === 'VACIO'), centros = (window.SAR_ActasEntrega && window.SAR_ActasEntrega.listaCentros ? window.SAR_ActasEntrega.listaCentros() : []);
      modal('Registrar préstamo de balones', `<label class="act-l">Centro al que se prestó<input id="op-centro" list="op-centros" placeholder="Ej: Pomaire"><datalist id="op-centros">${centros.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="act-l">Fecha del préstamo<input type="date" id="op-fecha" value="${hoy()}" max="${hoy()}"></label>
        <p class="act-hint">Balones (solo los que están en el SAR):</p><div class="op-lista">${libres.length ? libres.map(e => `<label class="pr-sel"><input type="checkbox" class="op-chk" value="${esc(e.id)}"> <b>N° ${esc(e.serie)}</b> <small>· ${esc((window.SAR_Oxigeno && window.SAR_Oxigeno.normGas ? window.SAR_Oxigeno.normGas(e.gas) : e.gas) || '')} · ${esc(e.capacidad || '')} (${esc(e.estado === 'LLENO' ? 'lleno' : 'vacío')})</small></label>`).join('') : '<p class="act-hint">No hay balones disponibles.</p>'}</div>
        <label class="act-l">Nota (opcional)<input id="op-nota" placeholder="Ej: por cambio de balón en ambulancia"></label>`,
      async (q) => { const ids = [...document.querySelectorAll('.op-chk:checked')].map(c => c.value); await registrarPrestamo(equipos, ids, q('#op-centro').value, q('#op-fecha').value, q('#op-nota').value); toast('Préstamo registrado', `${ids.length} balón(es) en ${q('#op-centro').value.trim()}. Sube el acta firmada y las fotos desde el panel.`, 'success'); await refrescar(); }, 'Registrar préstamo');
    });
  }

  const api = { agrupar, respaldoDe, pintar, registrarPrestamo, subirActa, subirFotos };
  if (typeof window !== 'undefined') window.SAR_OxiPrestamos = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
