/* ==========================================================================
   INICIO: "Stock agregado últimamente" (v21.34)
   Alerta en la portada con los últimos ingresos al stock (recepción de órdenes de compra,
   ingreso rápido / inventario y de proveedor): qué producto, cuántas unidades, a qué bodega
   y con qué documento. Solo personal. Lee Historial_Movimientos; no escribe nada.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const STAFF = ['admin', 'administrador', 'operador', 'global', 'superadmin'];
    const ETIQ = { INGRESO_OC: 'Recepción de orden', INGRESO_INVENTARIO: 'Ingreso de inventario', INGRESO_PROVEEDOR: 'Ingreso de proveedor' };
    let movs = [], iniciado = false;

    const ms = (d) => d && d.toMillis ? d.toMillis() : (d && d.seconds ? d.seconds * 1000 : (d ? new Date(d).getTime() : 0));
    /** Puro: toma movimientos y deja los ingresos al stock, del más reciente al más antiguo. */
    function ingresos(lista, ahora) {
        ahora = ahora || Date.now();
        return (lista || []).filter(m => m && /^INGRESO/.test(String(m.type || '')) && Number(m.quantity) > 0)
            .map(m => ({ t: ms(m.date), nombre: m.insumoName || m.item || '', cantidad: Number(m.quantity), bodega: m.destination || m.dest || '', doc: m.document || '', tipo: ETIQ[m.type] || 'Ingreso', usuario: m.user || '' }))
            .filter(x => x.nombre).sort((a, b) => b.t - a.t);
    }
    const hace = (t, ahora) => { const m = Math.max(0, Math.round(((ahora || Date.now()) - t) / 60000)); if (m < 60) return `hace ${m} min`; const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`; const d = Math.round(h / 24); return d === 1 ? 'ayer' : `hace ${d} días`; };

    function pintar() {
        const host = document.getElementById('home-ingresos'); if (!host) return;
        const f = ingresos(movs), sem = f.filter(x => Date.now() - x.t < 7 * 86400000), ver = f.slice(0, 8);
        const n = host.querySelector('[data-n]'); n.textContent = sem.length ? `${sem.length} en 7 días` : 'Sin ingresos recientes'; n.className = 'badge ' + (sem.length ? 'badge-sar-green' : 'badge-warning');
        host.querySelector('[data-lista]').innerHTML = ver.length ? ver.map(x => `<div class="hc-fila hc-fila--info"><strong>+${x.cantidad} · ${esc(x.nombre)}</strong><span>${esc(x.bodega || 'bodega')} · ${esc(x.tipo)}${x.doc ? ' · ' + esc(String(x.doc).slice(0, 48)) : ''} · ${hace(x.t)}</span></div>`).join('')
            : '<div class="home-empty">Aún no hay ingresos al stock registrados.</div>';
    }
    function iniciar() {
        if (iniciado) return; const fs = window.firebaseFirestore, db = window.firebaseDb; if (!fs || !db) return;
        const anchor = document.querySelector('#view-home .erp-dashboard-mid-grid, .erp-dashboard-mid-grid'); if (!anchor) return;
        iniciado = true;
        const card = document.createElement('div'); card.className = 'erp-card home-only-staff'; card.id = 'home-ingresos';
        card.innerHTML = '<div class="hc-cab"><h3>Stock agregado últimamente</h3><span data-n class="badge">…</span></div><div data-lista><div class="home-empty">Cargando…</div></div>';
        anchor.parentNode.insertBefore(card, anchor);
        const cargar = () => fs.getDocs(fs.query(fs.collection(db, 'Historial_Movimientos'), fs.orderBy('date', 'desc'), fs.limit(120))).then(sn => { movs = []; sn.forEach(d => movs.push(d.data())); pintar(); }).catch(() => { /* sin permiso */ });
        cargar(); setInterval(cargar, 5 * 60 * 1000); pintar();
    }
    const t = typeof document.body === 'undefined' ? 0 : setInterval(() => { const r = String(document.body.dataset.userRole || '').toLowerCase(); if (STAFF.includes(r)) { clearInterval(t); iniciar(); } }, 1500);
    window.SAR_HomeIngresos = { ingresos, hace };
    if (typeof module !== 'undefined') module.exports = window.SAR_HomeIngresos;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
