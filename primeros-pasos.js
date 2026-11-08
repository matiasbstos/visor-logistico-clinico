/* ==========================================================================
   PRIMEROS PASOS (v21.54)
   Lista de activación en el Inicio para el personal: cada paso se marca solo al detectar el dato en
   el sistema (bodegas, inventario, orden de compra, correo de avisos, acta, acta firmada). Barra de
   avance; al completar los pasos se celebra una vez y se puede ocultar. Solo lee; no escribe nada.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const STAFF = ['admin', 'administrador', 'operador', 'global', 'superadmin'];
    const OCULTO = 'sar_primeros_pasos_oculto', FESTEJO = 'sar_primeros_pasos_festejo';
    const PASOS = [
        { id: 'bodegas', t: 'Crear las bodegas', d: 'Define dónde se guarda cada producto.', vista: 'view-bodegas' },
        { id: 'inventario', t: 'Cargar el inventario', d: 'Ingreso rápido o carga masiva de existencias.', vista: 'view-ingreso-rapido' },
        { id: 'orden', t: 'Registrar una orden de compra', d: 'Sube la OC en Seguimiento de OC para controlar lo que llega.', vista: 'view-seguimiento-oc' },
        { id: 'correo', t: 'Configurar el correo de avisos', d: 'Recepciones, actas y movimientos llegan a los tres correos.', vista: 'view-seguimiento-oc' },
        { id: 'acta', t: 'Emitir un acta de entrega', d: 'Entrega a un centro con su PDF.', vista: 'view-actas-entrega' },
        { id: 'firmada', t: 'Confirmar con el acta firmada', d: 'Sube el acta firmada: recién ahí sale el stock.', vista: 'view-actas-entrega' }
    ];
    const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const poner = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin storage */ } };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** Puro: porcentaje y paso siguiente a partir de { id: true|false }. */
    function avance(hechos) {
        const h = PASOS.filter(p => hechos[p.id]).length, sig = PASOS.find(p => !hechos[p.id]) || null;
        return { hechos: h, total: PASOS.length, pct: Math.round(h * 100 / PASOS.length), siguiente: sig };
    }
    async function detectar(fs, db) {
        const hay = async (c, extra) => { try { const sn = await fs.getDocs(fs.query(fs.collection(db, c), ...(extra || []), fs.limit(1))); return !sn.empty; } catch (e) { return false; } };
        const h = {};
        [h.bodegas, h.inventario, h.orden, h.acta] = await Promise.all([hay('Bodegas'), hay('Insumos'), hay('Seguimiento_OC'), hay('Actas_Entrega')]);
        try { const d = await fs.getDoc(fs.doc(fs.collection(db, 'Config_Correo'), 'principal')); h.correo = d.exists() && !!d.data().webhookUrl; } catch (e) { h.correo = false; }
        try { const sn = await fs.getDocs(fs.query(fs.collection(db, 'Actas_Entrega'), fs.orderBy('creadoEn', 'desc'), fs.limit(60))); h.firmada = sn.docs.some(d => !!d.data().respaldo); } catch (e) { h.firmada = false; }
        return h;
    }
    function pintar(host, h) {
        const a = avance(h);
        host.innerHTML = `<div class="hc-cab"><h3>Primeros pasos</h3><span class="badge ${a.pct === 100 ? 'badge-success' : ''}">${a.hechos} de ${a.total}</span></div>
          <div class="pp-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${a.pct}" aria-label="Avance de los primeros pasos"><i style="width:${a.pct}%"></i></div>
          <ol class="pp-lista">${PASOS.map(p => `<li class="${h[p.id] ? 'pp-ok' : (a.siguiente && a.siguiente.id === p.id ? 'pp-sig' : '')}"><span class="pp-ico" aria-hidden="true">${h[p.id] ? '✓' : ''}</span><div><b>${esc(p.t)}</b><small>${esc(p.d)}</small></div>${h[p.id] ? '<span class="pp-listo">Listo</span>' : `<button type="button" class="btn btn-outline btn-sm" data-ir="${p.vista}">Ir</button>`}</li>`).join('')}</ol>
          ${a.pct === 100 ? '<p class="pp-fin"><b>Todo listo.</b> El Visor está en marcha. <button type="button" class="btn btn-outline btn-sm" id="pp-ocultar">Ocultar esta lista</button></p>' : '<div class="pp-pie"><button type="button" class="btn btn-link btn-sm" id="pp-ocultar">Ocultar por ahora</button></div>'}`;
        host.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => { const m = document.querySelector(`.menu-item[data-target="${b.dataset.ir}"]`); if (m) m.click(); }));
        const o = host.querySelector('#pp-ocultar'); if (o) o.addEventListener('click', () => { poner(OCULTO, '1'); host.remove(); });
        if (a.pct === 100 && !leer(FESTEJO)) { poner(FESTEJO, '1'); host.classList.add('pp-festejo'); }
    }
    let iniciado = false;
    function iniciar() {
        if (iniciado || leer(OCULTO)) return; const fs = window.firebaseFirestore, db = window.firebaseDb; if (!fs || !db) return;
        const anchor = document.querySelector('.erp-dashboard-mid-grid'); if (!anchor) return; iniciado = true;
        const host = document.createElement('div'); host.className = 'erp-card home-only-staff'; host.id = 'home-primeros-pasos'; anchor.parentNode.insertBefore(host, anchor);
        host.innerHTML = '<div class="hc-cab"><h3>Primeros pasos</h3><span class="badge">…</span></div>';
        detectar(fs, db).then(h => { const a = avance(h); if (a.pct === 100 && leer(FESTEJO)) { host.remove(); return; } pintar(host, h); }).catch(() => host.remove());
    }
    if (typeof document !== 'undefined' && document.body) { const t = setInterval(() => { const r = String(document.body.dataset.userRole || '').toLowerCase(); if (STAFF.includes(r)) { clearInterval(t); iniciar(); } }, 1500); }
    window.SAR_PrimerosPasos = { avance, PASOS };
    if (typeof module !== 'undefined') module.exports = window.SAR_PrimerosPasos;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
