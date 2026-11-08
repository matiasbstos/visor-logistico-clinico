/* Escaneo de precinto en Ingreso de Existencias (v21.83): al escanear el código de barras del precinto
   (PI-AAAA-NNNN o sus 8 dígitos) se rellenan bodega, conteo y categoría, y cada registro queda marcado
   con el folio en observaciones hasta que se quite el precinto activo. */
(function (window, document) {
  'use strict';
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); };
  let activo = null;

  /** Devuelve el folio PI-AAAA-NNNN si el texto escaneado corresponde a un precinto; si no, null. */
  function leerFolio(txt) {
    const t = String(txt || '').trim().toUpperCase();
    let m = t.match(/^PI-(\d{4})-(\d{4})$/); if (m) return 'PI-' + m[1] + '-' + m[2];
    m = t.match(/^(20\d{2})(\d{4})$/); if (m) return 'PI-' + m[1] + '-' + m[2];
    return null;
  }
  /** Conteo del precinto → opción de «Conteo / Toma» del formulario. */
  function faseDe(conteo) {
    const c = String(conteo || ''); if (/^1/.test(c)) return '1ra Toma (Inicial)'; if (/^2/.test(c)) return '2da Toma (2da Bodega / Suma)'; return 'Reconteo / Ajuste';
  }
  const etiquetaObs = (f) => '[Precinto ' + f + ']';
  function conEtiqueta(obs, folio) { const e = etiquetaObs(folio); return String(obs || '').indexOf(e) === 0 ? obs : (e + ' ' + String(obs || '')).trim(); }

  function poner(id, valor) {
    const el = document.getElementById(id); if (!el || valor == null || valor === '') return;
    if (el.tagName === 'SELECT' && ![].some.call(el.options, o => o.value === valor)) el.add(new Option(valor, valor));
    el.value = valor; el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function chip() {
    let c = document.getElementById('precinto-activo'); const cont = document.getElementById('toma-quick-scan');
    if (!activo) { if (c) c.remove(); return; }
    if (!c) { c = document.createElement('div'); c.id = 'precinto-activo'; c.className = 'pr-activo'; const caja = cont && (cont.closest('.form-group') || cont.parentElement.parentElement); if (caja) caja.insertAdjacentElement('afterend', c); else return; }
    c.innerHTML = '<i class="ph-bold ph-tag"></i><span><b>' + esc(activo.folio) + '</b> · ' + esc(activo.bodega || '') + (activo.ubicacion ? ' · ' + esc(activo.ubicacion) : '') + ' · ' + esc(activo.conteo || '') + '</span><button type="button" aria-label="Quitar precinto activo" title="Quitar precinto">×</button>';
    c.querySelector('button').onclick = () => { activo = null; chip(); const o = document.getElementById('toma-observaciones'); if (o) o.value = o.value.replace(/^\[Precinto [^\]]+\]\s*/, ''); };
  }
  async function activar(folio) {
    const f = fs(); let d = null;
    try { const s = await f.getDoc(f.doc(f.collection(db(), 'Contadores'), 'pin-' + folio)); if (s.exists()) d = s.data(); } catch (e) { console.warn('[Precinto]', e && e.code); }
    if (!d) { toast('Precinto no registrado', folio + ' no existe en el sistema. Genera el precinto desde «Precinto de conteo».', 'error'); return; }
    activo = { folio, bodega: d.bodega, ubicacion: d.ubicacion, categoria: d.categoria, conteo: d.conteo };
    poner('toma-ubicacion', d.bodega); poner('toma-fase', faseDe(d.conteo)); poner('toma-categoria', d.categoria);
    const o = document.getElementById('toma-observaciones'); if (o) o.value = conEtiqueta(o.value, folio);
    chip(); toast('Precinto ' + folio, (d.bodega || '') + (d.ubicacion ? ' · ' + d.ubicacion : '') + ' · ' + (d.conteo || ''), 'success');
    try { await f.setDoc(f.doc(f.collection(db(), 'Contadores'), 'pin-' + folio), { estado: 'EN_CONTEO', escaneadoAt: f.serverTimestamp() }, { merge: true }); } catch (e) {}
  }
  function iniciar() {
    // Fase de captura en document: se ejecuta antes que el lector de productos y lo detiene si es un precinto
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target || e.target.id !== 'toma-quick-scan') return;
      const folio = leerFolio(e.target.value); if (!folio) return;
      e.preventDefault(); e.stopImmediatePropagation(); e.target.value = ''; activar(folio);
    }, true);
    // Cada registro guardado lleva el folio activo y suma al contador del precinto
    document.addEventListener('submit', (e) => {
      if (!activo || !e.target || e.target.id !== 'form-toma-inventario') return;
      const o = document.getElementById('toma-observaciones'); if (o) o.value = conEtiqueta(o.value, activo.folio);
      try { const f = fs(); f.setDoc(f.doc(f.collection(db(), 'Contadores'), 'pin-' + activo.folio), { registros: f.increment ? f.increment(1) : 1, ultimoRegistroAt: f.serverTimestamp() }, { merge: true }); } catch (x) {}
    }, true);
  }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('DOMContentLoaded', iniciar);
  const api = { leerFolio, faseDe, conEtiqueta };
  if (typeof window !== 'undefined') window.SAR_PrecintoEscaneo = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : {}, typeof document !== 'undefined' ? document : {});
