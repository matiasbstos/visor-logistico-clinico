/* Vista previa en vivo del formulario de agenda (v21.63): resume lo que se va a crear y cuántos días faltan. */
(function () {
    'use strict';
    function diasHasta(fechaISO, hoy) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO || '')) return null;
        const a = Date.UTC(+fechaISO.slice(0, 4), +fechaISO.slice(5, 7) - 1, +fechaISO.slice(8, 10));
        const h = hoy || new Date(); const b = Date.UTC(h.getFullYear(), h.getMonth(), h.getDate());
        return Math.round((a - b) / 86400000);
    }
    function texto(d) { return d === null ? 'sin fecha' : d === 0 ? 'hoy' : d === 1 ? 'mañana' : d > 1 ? `en ${d} días` : d === -1 ? 'ayer' : `hace ${-d} días`; }
    function resumen(v, hoy) {
        const d = diasHasta(v.fecha, hoy), tipo = v.tipo === 'RECORDATORIO' ? 'Recordatorio' : 'Envío / recepción';
        const f = d === null ? '' : v.fecha.split('-').reverse().join('-');
        return { tipo, titulo: (v.titulo || '').trim() || 'Sin título aún', fecha: f, cuando: texto(d), pasado: d !== null && d < 0 };
    }
    if (typeof module !== 'undefined') module.exports = { diasHasta, resumen, texto };
    if (typeof document === 'undefined' || !document.getElementById) return;
    function montar() {
        const f = document.getElementById('form-erp-calendar-event'); if (!f || f.querySelector('.vp-ag')) return;
        const box = document.createElement('div'); box.className = 'vp-ag'; box.setAttribute('aria-live', 'polite');
        f.insertBefore(box, f.firstElementChild);
        const g = id => (document.getElementById(id) || {}).value || '';
        const pintar = () => {
            const r = resumen({ tipo: g('erp-cal-event-type'), titulo: g('erp-cal-event-title'), fecha: g('erp-cal-event-date') });
            box.className = 'vp-ag' + (r.pasado ? ' vp-ag--past' : '');
            box.innerHTML = '<i class="ph-bold ph-eye"></i> <span><b></b> · <span class="vp-t"></span> · <em></em>' + (r.pasado ? ' <strong>Fecha ya pasada</strong>' : '') + '</span>';
            box.querySelector('b').textContent = r.tipo; box.querySelector('.vp-t').textContent = r.titulo; box.querySelector('em').textContent = (r.fecha ? r.fecha + ' (' + r.cuando + ')' : r.cuando);
        };
        ['erp-cal-event-type', 'erp-cal-event-title', 'erp-cal-event-date'].forEach(id => { const e = document.getElementById(id); if (e) { e.addEventListener('input', pintar); e.addEventListener('change', pintar); } });
        const ov = document.getElementById('erp-calendar-modal-overlay');
        if (ov && window.MutationObserver) new MutationObserver(pintar).observe(ov, { attributes: true, attributeFilter: ['class'] });
        pintar();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
})();
