/* ==========================================================================
   INICIO: "Compras y órdenes en curso" (v20.46)
   Resume en la portada lo que requiere atención: OC por aceptar / atrasadas y
   alertas de compras ágiles. Solo personal (operador/administrador). Lee en
   tiempo real Seguimiento_OC y Compras_Agiles; no escribe nada.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const esc = (s) => (window.escapeHTML ? window.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const STAFF = ['admin', 'administrador', 'operador', 'global', 'superadmin'];
    let ocs = [], cas = [], iniciado = false;

    /** Puro: arma las filas a mostrar (más urgentes primero). */
    function filas(ocs, cas, hoy) {
        const out = [];
        const S = window.SAR_SeguimientoOC, C = window.SAR_ComprasAgiles;
        (ocs || []).filter(o => !o.cerrada).forEach(oc => {
            const pl = S ? S.estadoPlazo(oc, hoy) : { codigo: '', texto: '' };
            const peso = { ACEPT_VENCIDA: 0, ATRASADA: 1, POR_ACEPTAR: 2, EN_PLAZO: 3 }[pl.codigo];
            if (peso === undefined) return;
            out.push({ orden: peso, nivel: peso <= 1 ? 'alta' : (peso === 2 ? 'media' : 'info'), titulo: `OC ${oc.numeroOC}`, detalle: `${oc.proveedor || ''} · ${pl.texto}`, destino: 'view-seguimiento-oc' });
        });
        (cas || []).forEach(ca => {
            if (!C) return; const est = C.estadoCA(ca); if (est === 'CERRADA' || est === 'OC_EMITIDA') return;
            const al = C.alertas(ca, hoy), altas = al.filter(a => a.nivel === 'alta').length, med = al.filter(a => a.nivel === 'media').length;
            if (!altas && !med && est !== 'ESPERANDO_OC') return;
            out.push({ orden: altas ? 1 : 2, nivel: altas ? 'alta' : 'media', titulo: `Compra ágil ${ca.codigo}`, detalle: `${altas ? altas + ' alerta(s) · ' : ''}${med ? med + ' por revisar · ' : ''}${({ PUBLICADA: 'publicada', EN_EVALUACION: 'oferta recibida', EN_VB: 'esperando V°B°', ESPERANDO_OC: 'esperando la OC' })[est] || ''}`, destino: 'view-compras-agiles' });
        });
        return out.sort((a, b) => a.orden - b.orden);
    }

    function pintar() {
        const host = document.getElementById('home-compras'); if (!host) return;
        const f = filas(ocs, cas), mostrar = f.slice(0, 6);
        host.querySelector('[data-n]').textContent = f.length ? `${f.length} por atender` : 'Todo al día';
        host.querySelector('[data-n]').className = 'badge ' + (f.some(x => x.nivel === 'alta') ? 'badge-danger' : (f.length ? 'badge-warning' : 'badge-sar-green'));
        host.querySelector('[data-lista]').innerHTML = mostrar.length ? mostrar.map(x => `<button type="button" class="hc-fila hc-fila--${x.nivel}" data-go="${x.destino}"><strong>${esc(x.titulo)}</strong><span>${esc(x.detalle)}</span></button>`).join('')
            + (f.length > mostrar.length ? `<small class="hc-mas">y ${f.length - mostrar.length} más en Seguimiento de OC y Compras ágiles</small>` : '')
            : '<div class="home-empty">No hay órdenes ni compras que requieran atención.</div>';
        host.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { const m = document.querySelector(`.menu-item[data-target="${b.dataset.go}"]`); if (m) m.click(); }));
    }

    function iniciar() {
        if (iniciado) return; const fs = window.firebaseFirestore, db = window.firebaseDb; if (!fs || !db) return;
        const anchor = document.querySelector('#view-home .erp-dashboard-mid-grid, .erp-dashboard-mid-grid'); if (!anchor) return;
        iniciado = true;
        const card = document.createElement('div'); card.className = 'erp-card home-only-staff'; card.id = 'home-compras';
        card.innerHTML = '<div class="hc-cab"><h3>Compras y órdenes en curso</h3><span data-n class="badge">…</span></div><div data-lista><div class="home-empty">Cargando…</div></div>';
        anchor.parentNode.insertBefore(card, anchor);
        const ok = (setter) => (snap) => { const a = []; snap.forEach(d => a.push({ id: d.id, ...d.data() })); setter(a); pintar(); };
        try { fs.onSnapshot(fs.collection(db, 'Seguimiento_OC'), ok(a => { ocs = a; }), () => { }); } catch (e) { /* sin permiso */ }
        try { fs.onSnapshot(fs.collection(db, 'Compras_Agiles'), ok(a => { cas = a; }), () => { }); } catch (e) { /* sin permiso */ }
        pintar();
    }
    // espera a que haya sesión de personal
    const t = setInterval(() => { const r = String(document.body.dataset.userRole || '').toLowerCase(); if (STAFF.includes(r)) { clearInterval(t); iniciar(); } }, 1500);
    window.SAR_HomeCompras = { filas };
})(window, document);
