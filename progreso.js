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
    /** Tarea en segundo plano (v21.167): no tapa la pantalla; muestra una insignia arriba (junto a «Nube actualizada») con el avance y avisa al terminar. */
    const bgTareas = new Map();
    function bgChip() {
        let c = document.getElementById('bg-tareas'); if (c) return c;
        const ref = document.querySelector('.status-badge'); if (!ref || !ref.parentNode) return null;
        c = document.createElement('button'); c.type = 'button'; c.id = 'bg-tareas'; c.className = 'bg-tareas'; c.hidden = true; c.setAttribute('aria-live', 'polite');
        ref.parentNode.insertBefore(c, ref); return c;
    }
    function bgPintar() {
        const c = bgChip(); if (!c) return; const v = [...bgTareas.values()];
        if (!v.length) { c.hidden = true; return; }
        c.hidden = false; const t = v[0]; c.className = 'bg-tareas' + (v.every(x => x.fin) ? ' ok' : '');
        c.innerHTML = (t.fin ? '<i class="ph-bold ph-check-circle"></i>' : '<i class="ph-bold ph-circle-notch bg-giro"></i>') + `<span>${esc(t.titulo)}${v.length > 1 ? ' +' + (v.length - 1) : ''} · ${Math.round(t.pct)}%</span><em style="width:${t.pct}%"></em>`;
        c.title = v.map(x => `${x.titulo}: ${Math.round(x.pct)}% ${x.det || ''}`).join('\n');
    }
    function segundoPlano(titulo) {
        const id = Symbol(titulo), t = { titulo, pct: 0, det: '', fin: false }; bgTareas.set(id, t); bgPintar();
        const quitar = (ms) => setTimeout(() => { bgTareas.delete(id); bgPintar(); }, ms);
        return {
            paso(txt) { t.det = txt; const m = /(\d+)\s*(?:de|\/)\s*(\d+)/.exec(String(txt)); if (m && Number(m[2]) > 0) t.pct = Math.max(t.pct, Math.min(99, Number(m[1]) / Number(m[2]) * 100)); else t.pct = Math.max(t.pct, Math.min(90, t.pct + 3)); bgPintar(); },
            avance(v, d) { t.pct = Math.max(t.pct, Math.min(100, v)); if (d != null) t.det = d; bgPintar(); },
            listo(txt) { t.pct = 100; t.fin = true; t.det = txt; bgPintar(); try { if (window.SAR_Sonidos) window.SAR_Sonidos.tocar('listo'); } catch (e) { /* sin sonido */ } if (typeof window.showToast === 'function') try { window.showToast('Listo', txt, 'success'); } catch (e) { /* sin aviso */ } quitar(4000); },
            error(msg) { t.fin = true; bgPintar(); if (typeof window.showToast === 'function') try { window.showToast(titulo, msg || 'No se pudo completar', 'error'); } catch (e) { /* sin aviso */ } quitar(300); }
        };
    }
    /** Confirmación con la marca (reemplaza al cuadro «sarinventario.web.app says»): SAR_Confirmar({titulo, texto, lineas:[…], si, no, peligro}) → Promise<boolean>. */
    function confirmar(o) {
        o = o || {};
        return new Promise(resolve => {
            const prev = document.activeElement, d = document.createElement('div'); d.className = 'sar-conf'; d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'sar-conf-t');
            d.innerHTML = `<div class="sar-conf__c"><div class="sar-conf__marca" aria-hidden="true"><img src="assets/logo-sar.png" alt=""></div><h3 id="sar-conf-t" class="sar-conf__t">${esc(o.titulo || '¿Confirmas?')}</h3>${o.texto ? `<p class="sar-conf__x">${o.texto}</p>` : ''}${(o.lineas || []).length ? `<ul class="sar-conf__l">${o.lineas.map(l => `<li>${l}</li>`).join('')}</ul>` : ''}<div class="sar-conf__b">${o.soloSi ? '' : `<button type="button" class="btn btn-secondary" data-r="0">${esc(o.no || 'Cancelar')}</button>`}<button type="button" class="btn ${o.peligro ? 'btn-danger' : 'btn-primary'}" data-r="1">${esc(o.si || 'Confirmar')}</button></div></div>`;
            const cierra = (v) => { document.removeEventListener('keydown', tecla, true); d.remove(); try { if (prev && prev.focus) prev.focus(); } catch (e) { /* sin foco */ } resolve(v); };
            const tecla = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cierra(false); } };
            d.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) cierra(b.dataset.r === '1'); else if (e.target === d) cierra(false); });
            document.addEventListener('keydown', tecla, true); document.body.appendChild(d);
            const ok = d.querySelector('[data-r="1"]'); if (ok) ok.focus();
        });
    }
    /** v21.233: pedir un texto con la marca (reemplaza a window.prompt). SAR_Progreso.pedir({titulo, texto, valor, placeholder, si, no, peligro, exacto}) → Promise<string|null>.
     *  exacto: el botón se habilita solo si lo escrito coincide (para confirmar algo que no se puede deshacer). */
    function pedir(o) {
        o = o || {};
        return new Promise(resolve => {
            const prev = document.activeElement, d = document.createElement('div'); d.className = 'sar-conf'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'sar-conf-t');
            d.innerHTML = `<div class="sar-conf__c"><div class="sar-conf__marca" aria-hidden="true"><img src="assets/logo-sar.png" alt=""></div><h3 id="sar-conf-t" class="sar-conf__t">${esc(o.titulo || 'Escribe')}</h3>${o.texto ? `<p class="sar-conf__x">${o.texto}</p>` : ''}<input type="text" class="form-control sar-conf__in" aria-label="${esc(o.titulo || 'Texto')}" placeholder="${esc(o.placeholder || '')}" value="${esc(o.valor || '')}" autocomplete="off"><div class="sar-conf__b"><button type="button" class="btn btn-secondary" data-r="0">${esc(o.no || 'Cancelar')}</button><button type="button" class="btn ${o.peligro ? 'btn-danger' : 'btn-primary'}" data-r="1">${esc(o.si || 'Aceptar')}</button></div></div>`;
            const inp = d.querySelector('input'), ok = d.querySelector('[data-r="1"]');
            const valido = () => { const v = inp.value.trim(); return o.exacto ? v === String(o.exacto) : !!v; };
            const sync = () => { ok.disabled = !valido(); };
            const cierra = (v) => { document.removeEventListener('keydown', tecla, true); d.remove(); try { if (prev && prev.focus) prev.focus(); } catch (e) { /* sin foco */ } resolve(v); };
            const tecla = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cierra(null); } else if (e.key === 'Enter' && e.target === inp && valido()) { e.preventDefault(); cierra(inp.value.trim()); } };
            d.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { if (b.dataset.r === '1') { if (valido()) cierra(inp.value.trim()); } else cierra(null); } else if (e.target === d) cierra(null); });
            inp.addEventListener('input', sync); sync();
            document.addEventListener('keydown', tecla, true); document.body.appendChild(d);
            inp.focus(); try { inp.select(); } catch (e) { /* sin selección */ }
        });
    }
    /** v21.233: aviso con un solo botón (reemplaza a window.alert). */
    function avisar(o) {
        o = typeof o === 'string' ? { texto: esc(o).replace(/\n/g, '<br>') } : (o || {});
        return confirmar({ titulo: o.titulo || 'Aviso', texto: o.texto, lineas: o.lineas, si: o.si || 'Entendido', soloSi: true });
    }
    /** Animación de «guardado» con la marca de Visor: hexágono que se arma y un ✓ que se dibuja. SAR_Progreso.exito({titulo, texto, ms}) → Promise. */
    const HEX = '<svg class="sar-ok__svg" viewBox="0 0 200 200" aria-hidden="true"><polygon class="sar-ok__hex" points="100,12 176.2,56 176.2,144 100,188 23.8,144 23.8,56"/><path class="sar-ok__chk" d="M62 102 l26 26 l52 -56"/><circle class="sar-ok__pt" cx="146" cy="146" r="11"/></svg>';
    function exito(o) {
        o = o || {};
        return new Promise(res => {
            const d = document.createElement('div'); d.className = 'sar-ok'; d.setAttribute('role', 'status'); d.setAttribute('aria-live', 'polite');
            d.innerHTML = `<div class="sar-ok__c">${HEX}<strong>${esc(o.titulo || 'Guardado')}</strong>${o.texto ? `<span>${o.texto}</span>` : ''}</div>`;
            const fin = () => { if (!d.isConnected) return; d.classList.add('sar-ok--fuera'); setTimeout(() => { d.remove(); res(); }, 250); };
            d.addEventListener('click', fin); document.body.appendChild(d);
            try { if (window.SAR_Sonidos) window.SAR_Sonidos.tocar('ok'); } catch (e) { /* sin sonido */ }
            setTimeout(fin, o.ms || 1900);
        });
    }
    /** Ventana de notificación con la marca (v21.211): entra deslizando, el hexágono late según el estado y se cierra sola.
     *  SAR_Progreso.aviso({ titulo, texto, estado: 'enviada'|'procesando'|'procesada'|'cerrada'|'anulada'|'info', boton, alTocar, ms }) */
    function aviso(o) {
        o = o || {}; let caja = document.getElementById('sar-avisos-pila');
        if (!caja) { caja = document.createElement('div'); caja.id = 'sar-avisos-pila'; caja.className = 'sar-av-pila'; caja.setAttribute('aria-live', 'polite'); document.body.appendChild(caja); }
        const d = document.createElement('div'), est = String(o.estado || 'info');
        d.className = 'sar-av sar-av--' + est; d.setAttribute('role', 'status');
        d.innerHTML = `<span class="sar-av__ic" aria-hidden="true"><svg viewBox="0 0 200 200"><polygon class="sar-av__hex" points="100,12 176.2,56 176.2,144 100,188 23.8,144 23.8,56"/>${est === 'cerrada' || est === 'procesada' ? '<path class="sar-av__chk" d="M62 102 l26 26 l52 -56"/>' : est === 'anulada' ? '<path class="sar-av__chk" d="M70 70 L130 130 M130 70 L70 130"/>' : '<circle class="sar-av__pt" cx="100" cy="100" r="22"/>'}</svg></span>
            <span class="sar-av__tx"><b>${esc(o.titulo || '')}</b>${o.texto ? `<span>${o.texto}</span>` : ''}${o.boton ? `<button type="button" class="sar-av__btn">${esc(o.boton)}</button>` : ''}</span><button type="button" class="sar-av__x" aria-label="Cerrar">✕</button><i class="sar-av__t" style="animation-duration:${o.ms || 8000}ms"></i>`;
        const fin = () => { if (!d.isConnected) return; d.classList.add('sar-av--fuera'); setTimeout(() => d.remove(), 260); };
        d.querySelector('.sar-av__x').onclick = (e) => { e.stopPropagation(); fin(); };
        if (o.alTocar) d.addEventListener('click', () => { fin(); o.alTocar(); });
        caja.prepend(d); while (caja.children.length > 3) caja.lastElementChild.remove();
        try { if (window.SAR_Sonidos) window.SAR_Sonidos.tocar('ok'); } catch (e) { /* sin sonido */ }
        setTimeout(fin, o.ms || 8000); return d;
    }
    window.SAR_Progreso = { exito, confirmar, pedir, avisar, iniciar, correr, cargando, segundoPlano, aviso };
    /* v21.233: los alert() que queden en el sitio se muestran con la ventana de la marca, al centro */
    try { window.alert = (m) => { avisar(String(m == null ? '' : m)); }; } catch (e) { /* navegador sin reemplazo */ }
})(window, document);
