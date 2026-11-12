/* Avance con la marca (v20.92): una sola animación para toda carga, guardado, generación de documentos o modificación.
   SAR_Progreso.iniciar('Guardando…', ['paso 1']) → { paso(txt), listo(txt, {aviso}), error(msg) }.
   Muestra el logo SAR con un anillo que gira, la lista de pasos y, al terminar, un ✔ y una notificación al costado. */
(function (window, document) {
    'use strict';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function iniciar(titulo, pasos, padre) {
        const p = document.createElement('div'); p.className = 'r-prog sar-prog'; p.setAttribute('role', 'status'); p.setAttribute('aria-live', 'polite');
        p.innerHTML = `<div class="r-prog__c"><div class="sar-prog__marca" aria-hidden="true"><span class="sar-prog__anillo"></span><img src="assets/logo-sar.png" alt=""></div><strong class="r-prog__t"></strong><div class="sar-prog__barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><div class="sar-prog__info"><span class="sar-prog__det"></span><b class="sar-prog__pct">0%</b></div><ul class="r-prog__l"></ul></div>`;
        (padre || document.body).appendChild(p);
        try { if (window.SAR_Sonidos) window.SAR_Sonidos.tocar('carga'); } catch (e) { /* sin sonido */ }
        const t = p.querySelector('.r-prog__t'), l = p.querySelector('.r-prog__l');
        t.textContent = titulo || 'Procesando…';
        const bar = p.querySelector('.sar-prog__barra'), fill = bar.firstElementChild, det = p.querySelector('.sar-prog__det'), pc = p.querySelector('.sar-prog__pct');
        let pct = 0, real = false;
        const pinta = (v, d) => { pct = Math.max(pct, Math.min(100, v)); const n = Math.round(pct); fill.style.width = pct + '%'; pc.textContent = n + '%'; bar.setAttribute('aria-valuenow', String(n)); if (d != null) det.textContent = d; };
        // Sin porcentaje real, la barra avanza sola y despacio hasta ~90% para que se note que sigue trabajando.
        const reloj = setInterval(() => { if (!real && pct < 90) pinta(pct + (92 - pct) * 0.04); }, 500);
        const fin = () => clearInterval(reloj);
        const paso = (txt) => { const ult = l.lastElementChild; if (ult) ult.classList.add('ok'); const li = document.createElement('li'); li.textContent = txt; l.appendChild(li); l.scrollTop = l.scrollHeight; t.textContent = titulo || txt;
            const m = /(\d+)\s*(?:de|\/)\s*(\d+)/.exec(String(txt)); if (m && Number(m[2]) > 0) { real = true; pinta(Math.min(99, Number(m[1]) / Number(m[2]) * 100), txt); } else { pinta(pct + (90 - pct) * 0.18, txt); } };
        (pasos || []).forEach(paso);
        return {
            paso,
            listo(txt, opc) {
                fin(); [...l.children].forEach(x => x.classList.add('ok')); p.classList.add('r-prog--ok'); t.textContent = txt; pct = 0; pinta(100, ''); 
                if (opc && opc.informe) { const li = document.createElement('li'); li.className = 'ok'; li.textContent = 'Informes contable y disponible actualizados'; l.appendChild(li); }
                if (opc && opc.aviso === false) { try { if (window.SAR_Sonidos) window.SAR_Sonidos.tocar('listo'); } catch (e) { /* sin sonido */ } }
                if (!(opc && opc.aviso === false) && typeof window.showToast === 'function') try { window.showToast('Listo', txt, 'success'); } catch (e) { /* sin aviso */ }
                setTimeout(() => p.remove(), (opc && opc.ms) || 1400);
            },
            avance(v, d) { real = true; pinta(v, d); },
            error() { fin(); p.remove(); try { if (window.SAR_Sonidos) window.SAR_Sonidos.tocar('error'); } catch (e) { /* sin sonido */ } },
            cerrar() { fin(); p.remove(); }
        };
    }
    /** Ejecuta fn(prog) con el avance visible; si falla lo cierra y relanza. */
    async function correr(titulo, fn, okTxt, opc) {
        const prog = iniciar(titulo); try { const r = await fn(prog); prog.listo(typeof okTxt === 'function' ? okTxt(r) : (okTxt || 'Listo'), opc); return r; } catch (e) { prog.error(); throw e; }
    }
    /** Bloque de carga para dentro de una pantalla (no tapa nada): logo con anillo girando + texto. */
    function cargando(texto) {
        // Carga de pantalla (v21.68): esqueleto con barrido de luz. El logo con anillo queda para guardar, crear y subir (iniciar/correr).
        const t = esc(texto || 'Cargando…');
        return `<div class="sar-cargando sar-esq" role="status" aria-live="polite" aria-label="${t}"><span class="sar-esq__t">${t}</span><div class="sar-esq__fila"><i></i><i></i><i></i></div><div class="sar-esq__lin"></div><div class="sar-esq__lin"></div><div class="sar-esq__lin sar-esq__lin--c"></div></div>`;
    }
    window.SAR_Progreso = { iniciar, correr, cargando };
})(window, document);
