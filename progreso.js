/* Avance con la marca (v20.92): una sola animación para toda carga, guardado, generación de documentos o modificación.
   SAR_Progreso.iniciar('Guardando…', ['paso 1']) → { paso(txt), listo(txt, {aviso}), error(msg) }.
   Muestra el logo SAR con un anillo que gira, la lista de pasos y, al terminar, un ✔ y una notificación al costado. */
(function (window, document) {
    'use strict';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function iniciar(titulo, pasos, padre) {
        const p = document.createElement('div'); p.className = 'r-prog sar-prog'; p.setAttribute('role', 'status'); p.setAttribute('aria-live', 'polite');
        p.innerHTML = `<div class="r-prog__c"><div class="sar-prog__marca" aria-hidden="true"><span class="sar-prog__anillo"></span><img src="assets/logo-sar.png" alt=""></div><strong class="r-prog__t"></strong><ul class="r-prog__l"></ul></div>`;
        (padre || document.body).appendChild(p);
        const t = p.querySelector('.r-prog__t'), l = p.querySelector('.r-prog__l');
        t.textContent = titulo || 'Procesando…';
        const paso = (txt) => { const ult = l.lastElementChild; if (ult) ult.classList.add('ok'); const li = document.createElement('li'); li.textContent = txt; l.appendChild(li); t.textContent = txt; };
        (pasos || []).forEach(paso);
        return {
            paso,
            listo(txt, opc) {
                [...l.children].forEach(x => x.classList.add('ok')); p.classList.add('r-prog--ok'); t.textContent = txt;
                if (opc && opc.informe) { const li = document.createElement('li'); li.className = 'ok'; li.textContent = 'Informes contable y disponible actualizados'; l.appendChild(li); }
                if (!(opc && opc.aviso === false) && typeof window.showToast === 'function') try { window.showToast('Listo', txt, 'success'); } catch (e) { /* sin aviso */ }
                setTimeout(() => p.remove(), (opc && opc.ms) || 1400);
            },
            error() { p.remove(); },
            cerrar() { p.remove(); }
        };
    }
    /** Ejecuta fn(prog) con el avance visible; si falla lo cierra y relanza. */
    async function correr(titulo, fn, okTxt, opc) {
        const prog = iniciar(titulo); try { const r = await fn(prog); prog.listo(typeof okTxt === 'function' ? okTxt(r) : (okTxt || 'Listo'), opc); return r; } catch (e) { prog.error(); throw e; }
    }
    window.SAR_Progreso = { iniciar, correr };
})(window, document);
