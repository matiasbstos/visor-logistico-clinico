/* Carga visible en todo el sitio (v21.65): barra superior con la marca, textos «Cargando…» sueltos convertidos al logo con anillo,
   y botones ocupados (Guardando…, Creando…, Generando…) con ruedita. */
(function () {
    'use strict';
    const RE_CARGA = /^\s*(cargando|recuperando|buscando|leyendo|actualizando datos)\b/i;
    const RE_BOTON = /(guardando|creando|generando|enviando|procesando|subiendo|cargando|registrando|emitiendo|anulando|confirmando|importando|descargando|calculando)/i;
    /** ¿Es un texto suelto de carga (corto, sin otros elementos)? */
    function esCarga(t) { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > 0 && t.length < 90 && RE_CARGA.test(t); }
    function etiqueta(t) { t = String(t).replace(/\s+/g, ' ').trim().replace(/\.{2,}$|…$/, ''); return t + '…'; }
    function boton(t) { return RE_BOTON.test(String(t || '')) && String(t).trim().length < 60; }
    if (typeof module !== 'undefined') module.exports = { esCarga, etiqueta, boton };
    if (typeof document === 'undefined' || !document.createElement || !document.addEventListener) return;

    let barra = null, navHasta = 0, temporizador = null, seguro = null;
    function elBarra() { if (!barra) { barra = document.createElement('div'); barra.id = 'sar-topbar'; barra.setAttribute('role', 'progressbar'); barra.setAttribute('aria-label', 'Cargando'); barra.innerHTML = '<span></span>'; document.body.appendChild(barra); } return barra; }
    function activo() { return Date.now() < navHasta || !!document.querySelector('.ml-busy, .sar-cargando'); }
    function revisar() {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => {
            const on = activo(); const b = elBarra(); b.classList.toggle('on', on);
            if (on) { clearTimeout(seguro); seguro = setTimeout(() => { navHasta = 0; b.classList.remove('on'); }, 30000); if (Date.now() < navHasta) setTimeout(revisar, navHasta - Date.now() + 30); }
        }, 80);
    }
    function navegando() { navHasta = Date.now() + 700; revisar(); }

    const RE_RAPIDO = /cargando|recuperando|buscando|leyendo|actualizando/i;
    function mejorar(el) {
        if (!el || el.nodeType !== 1) return;
        const t = el.textContent; if (!t || t.length > 600 || !RE_RAPIDO.test(t)) return;   // revisión barata: casi ningún nodo pasa
        if (el.closest('.sar-cargando, .sar-prog, button, option, select, textarea, input, script, style')) return;
        if (!window.SAR_Progreso || !window.SAR_Progreso.cargando) return;
        const cand = el.matches('td,div,p,li,span,small') ? [el] : [];
        el.querySelectorAll('td,div,p,li,span').forEach(x => { if (x.children.length <= 1) cand.push(x); });
        cand.forEach(x => {
            if (x.closest('.sar-cargando, .sar-prog')) return;
            const hijos = [...x.children]; if (hijos.some(h => !h.matches('i.ph-spin, i[class*="ph-spinner"]'))) return;
            if (!esCarga(x.textContent)) return;
            x.innerHTML = window.SAR_Progreso.cargando(etiqueta(x.textContent));
        });
    }
    function botones(el) {
        if (!el || el.nodeType !== 1) return;
        if (el.tagName !== 'BUTTON' && !el.querySelector('button[disabled], button[aria-busy="true"], button.ml-busy')) return;
        const lista = el.tagName === 'BUTTON' ? [el] : [...el.querySelectorAll('button[disabled], button[aria-busy="true"], button.ml-busy')];
        lista.forEach(b => { const ocupado = (b.disabled || b.getAttribute('aria-busy') === 'true') && boton(b.textContent); b.classList.toggle('ml-busy', !!ocupado); });
    }
    function iniciar() {
        elBarra();
        // revisión inicial (una vez): textos «Cargando…» que ya vienen en el HTML
        if (window.SAR_Progreso) document.querySelectorAll('td,div,p,li,span').forEach(x => { if (x.children.length <= 1 && x.textContent.length < 90 && esCarga(x.textContent) && ![...x.children].some(h => !h.matches('i.ph-spin, i[class*="ph-spinner"]')) && !x.closest('.sar-cargando, .sar-prog, button, option')) x.innerHTML = window.SAR_Progreso.cargando(etiqueta(x.textContent)); });
        let llamadas = 0, ventana = Date.now(), obs = null;
        obs = new MutationObserver(ms => {
            // freno de seguridad: si algo dispara el observador sin parar, se apaga en vez de congelar la página
            const ahora = Date.now(); if (ahora - ventana > 1000) { ventana = ahora; llamadas = 0; } if (++llamadas > 150) { obs.disconnect(); console.warn('[cargando-global] desactivado por exceso de cambios'); return; }
            const t0 = performance.now(); let toca = false, n = 0;
            for (const m of ms) {
                if (m.type === 'attributes') { botones(m.target); toca = true; continue; }
                for (const x of m.addedNodes) { if (x.nodeType === 1 && ++n <= 300 && performance.now() - t0 < 10) { mejorar(x); botones(x); } }
                if (m.target && m.target.tagName === 'BUTTON') botones(m.target);
                toca = true;
            }
            if (toca) revisar();
        });
        obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-busy'] });
        document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.menu-item[data-target], .menu-item[data-erp-panel]')) navegando(); }, true);
        window.addEventListener('hashchange', navegando);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
