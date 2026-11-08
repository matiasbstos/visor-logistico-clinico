/* ==========================================================================
   RESPALDO DIARIO AUTOMÁTICO (v21.59)
   La primera vez que el personal abre el Visor cada día se guarda una copia comprimida de lo esencial
   (Insumos, Bodegas, Actas de entrega, Órdenes de compra, Catálogo y Centros) en Contadores, en 7
   casillas rotativas (una por día de la semana: se conservan los últimos 7 días; las reglas no
   permiten borrar en Contadores, por eso se sobrescribe). Cada copia lleva su suma de control.
   En Configuración (administración) se ven las copias, se pueden VERIFICAR (se descomprimen y se
   comprueba la suma y los conteos, sin tocar datos) y DESCARGAR como JSON. La restauración no es
   automática a propósito: se hace con la copia descargada y revisión previa.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const COLECCIONES = ['Insumos', 'Bodegas', 'Actas_Entrega', 'Seguimiento_OC', 'Catalogo_Productos', 'Centros_Entrega'];
    const STAFF = ['admin', 'administrador', 'operador', 'global', 'superadmin'], TROZO = 700000;
    const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const diaKey = (d) => d.toISOString().slice(0, 10);

    // ---- puros ----
    const reemplazo = (k, v) => (v && typeof v === 'object' && typeof v.toDate === 'function') ? { __ts: v.toDate().toISOString() } : v;
    function serializar(datos) { return JSON.stringify(datos, reemplazo); }
    function suma(txt) { let h = 2166136261; for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
    function trocear(b64) { const p = []; for (let i = 0; i < b64.length; i += TROZO) p.push(b64.slice(i, i + TROZO)); return p.length ? p : ['']; }
    async function aBytes(stream) { const b = await new Response(stream).arrayBuffer(); return new Uint8Array(b); }
    async function comprimir(txt) { const cs = new Blob([txt]).stream().pipeThrough(new CompressionStream('gzip')); const u = await aBytes(cs); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
    async function descomprimir(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); const ds = new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip')); return new TextDecoder().decode(await aBytes(ds)); }
    const conteos = (datos) => Object.fromEntries(Object.keys(datos).map(k => [k, datos[k].length]));

    // ---- Firestore ----
    const F = () => window.firebaseFirestore, DB = () => window.firebaseDb;
    const ref = (id) => F().doc(F().collection(DB(), 'Contadores'), id);
    async function respaldar(forzar) {
        const f = F(), db = DB(); if (!f || !db) return null;
        const ahora = new Date(), slot = ahora.getDay(), metaRef = ref(`bk-${slot}-meta`);
        if (!forzar) { try { const m = await f.getDoc(metaRef); if (m.exists() && m.data().dia === diaKey(ahora)) return null; } catch (e) { return null; } }
        const datos = {};
        for (const c of COLECCIONES) { const l = []; try { const sn = await f.getDocs(f.query(f.collection(db, c), f.limit(5000))); sn.forEach(d => l.push({ _id: d.id, ...d.data() })); } catch (e) { return null; } datos[c] = l; }
        const txt = serializar(datos), b64 = await comprimir(txt), partes = trocear(b64), usuario = (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || '';
        for (let i = 0; i < partes.length; i++) await f.setDoc(ref(`bk-${slot}-${String(i).padStart(2, '0')}`), { tipo: 'respaldo-diario', slot, n: i, b64: partes[i], updatedAt: f.serverTimestamp() });
        await f.setDoc(metaRef, { tipo: 'respaldo-diario-meta', slot, dia: diaKey(ahora), diaSemana: DIAS[slot], partes: partes.length, bytesJson: txt.length, bytesZip: b64.length, suma: suma(txt), conteos: conteos(datos), por: usuario, creado: ahora.toISOString(), updatedAt: f.serverTimestamp() });
        return { slot, conteos: conteos(datos) };
    }
    async function listar() { const out = []; for (let s = 0; s < 7; s++) { try { const m = await F().getDoc(ref(`bk-${s}-meta`)); if (m.exists()) out.push(m.data()); } catch (e) { /* sin permiso */ } } return out.sort((a, b) => String(b.creado).localeCompare(String(a.creado))); }
    async function leerCopia(meta) {
        const bs = []; for (let i = 0; i < meta.partes; i++) { const d = await F().getDoc(ref(`bk-${meta.slot}-${String(i).padStart(2, '0')}`)); if (!d.exists()) throw new Error(`Falta la parte ${i + 1} de ${meta.partes}.`); bs.push(d.data().b64); }
        const txt = await descomprimir(bs.join(''));
        return { txt, datos: JSON.parse(txt) };
    }
    async function verificar(meta) {
        const { txt, datos } = await leerCopia(meta), c = conteos(datos), dif = Object.keys(meta.conteos || {}).filter(k => c[k] !== meta.conteos[k]);
        return { ok: suma(txt) === meta.suma && !dif.length, sumaOk: suma(txt) === meta.suma, dif, conteos: c };
    }
    async function descargar(meta) {
        const { txt } = await leerCopia(meta), a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = `Respaldo_Visor_${meta.dia}.json`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    }

    // ---- panel en Configuración ----
    let cargando = false;
    async function panel() {
        const v = document.getElementById('view-configuracion'); if (!v || !F()) return;
        let sec = document.getElementById('bk-panel'); if (!sec) { sec = document.createElement('div'); sec.id = 'bk-panel'; sec.className = 'bk-panel'; (v.querySelector('.dashboard-container') || v).appendChild(sec); }
        sec.innerHTML = '<h3>Respaldo diario</h3><p class="act-hint">Cargando copias…</p>';
        let l = []; try { l = await listar(); } catch (e) { /* sin permiso */ }
        sec.innerHTML = `<h3>Respaldo diario</h3><p class="act-hint">Cada día, la primera vez que el personal abre el Visor, se guarda una copia comprimida de inventario, bodegas, actas, órdenes de compra y catálogo. Se conservan los últimos 7 días. «Verificar» comprueba que la copia se puede leer completa; «Descargar» baja el archivo para restaurarlo con revisión previa.</p>
          ${l.length ? `<div class="sal-tabla">${l.map(m => `<div class="bk-fila"><div><b>${esc(m.diaSemana)} ${esc(m.dia)}</b><small>${esc(Object.keys(m.conteos || {}).map(k => k.replace(/_/g, ' ') + ': ' + m.conteos[k]).join(' · '))} · ${Math.round((m.bytesZip || 0) / 1024)} KB · por ${esc(m.por || '—')}</small><small class="bk-res" data-r="${m.slot}"></small></div><div class="bk-acc"><button type="button" class="btn btn-outline btn-sm" data-v="${m.slot}">Verificar</button><button type="button" class="btn btn-outline btn-sm" data-d="${m.slot}">Descargar</button></div></div>`).join('')}</div>` : '<p class="act-hint">Todavía no hay copias. La primera se crea al abrir el Visor un día hábil, o puedes crearla ahora.</p>'}
          <div class="bk-pie"><button type="button" class="btn btn-primary btn-sm" id="bk-ahora">Crear copia ahora</button></div>`;
        const porSlot = (s) => l.find(m => String(m.slot) === String(s));
        sec.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', async () => { const m = porSlot(b.dataset.v), out = sec.querySelector(`[data-r="${b.dataset.v}"]`); b.disabled = true; out.textContent = 'Verificando…'; try { const r = await verificar(m); out.textContent = r.ok ? '✓ Copia íntegra: se leyó completa y coincide.' : `✗ Problema: ${r.sumaOk ? '' : 'suma de control distinta. '}${r.dif.length ? 'conteos distintos en ' + r.dif.join(', ') : ''}`; out.className = 'bk-res ' + (r.ok ? 'bk-ok' : 'bk-mal'); } catch (e) { out.textContent = '✗ No se pudo leer: ' + (e.message || e); out.className = 'bk-res bk-mal'; } b.disabled = false; }));
        sec.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', async () => { b.disabled = true; try { await descargar(porSlot(b.dataset.d)); } catch (e) { if (window.showToast) window.showToast('Respaldo', 'No se pudo descargar: ' + (e.message || e), 'error'); } b.disabled = false; }));
        sec.querySelector('#bk-ahora').addEventListener('click', async (e) => { e.target.disabled = true; e.target.textContent = 'Guardando…'; try { await respaldar(true); } catch (x) { if (window.showToast) window.showToast('Respaldo', 'No se pudo crear: ' + (x.message || x), 'error'); } panel(); });
    }
    function iniciar() {
        const t = setInterval(() => { const rol = String(document.body.dataset.userRole || '').toLowerCase(); if (STAFF.includes(rol) && F() && DB()) { clearInterval(t); setTimeout(() => respaldar(false).catch(() => {}), 15000); } }, 2500);
        const m = document.querySelector('.menu-item[data-target="view-configuracion"]'); if (m) m.addEventListener('click', () => setTimeout(panel, 300));
    }
    if (typeof document !== 'undefined' && document.body) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar(); }
    window.SAR_RespaldoDiario = { serializar, suma, trocear, comprimir, descomprimir, conteos, respaldar, verificar, listar, COLECCIONES };
    if (typeof module !== 'undefined') module.exports = { serializar, suma, trocear, comprimir, descomprimir, conteos };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
