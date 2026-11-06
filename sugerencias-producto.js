/* ==========================================================================
   Sugerencias de producto con foto (v21.25)
   Al escribir una o más letras (o parte del ID) en un campo de producto, muestra una lista
   con el nombre sugerido, su ID y su fotografía. Se usa en el acta (ingreso manual, "otro
   similar" y pendientes). La fuente es una función que devuelve [{nombre, codigo, nota}].
   ========================================================================== */
(function (window, document) {
    'use strict';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    /** Lógica pura: todas las palabras escritas deben estar en el nombre (en cualquier orden); un número largo busca por ID. */
    function filtrar(fuente, texto, max) {
        const q = norm(texto); if (!q) return [];
        const toks = q.split(' '), digitos = String(texto).replace(/\D/g, '');
        const vistos = new Set(), out = [];
        for (const x of fuente) {
            const n = norm(x.nombre), cod = String(x.codigo || '').replace(/\D/g, '');
            const ok = toks.every(t => n.includes(t)) || (digitos.length >= 3 && cod && cod.includes(digitos));
            if (!ok) continue;
            const k = cod ? 'c' + cod : 'n' + n; if (vistos.has(k) || vistos.has('n' + n)) continue;
            vistos.add(k); vistos.add('n' + n);
            // primero los que empiezan igual
            out.push({ ...x, _p: n.startsWith(q) ? 0 : 1 });
        }
        return out.sort((a, b) => a._p - b._p).slice(0, max || 8);
    }

    let caja = null, activo = null;
    const cerrar = () => { if (caja) { caja.remove(); caja = null; } activo = null; };
    function enlazar(input, fuente, alElegir) {
        if (!input || input.dataset.sug) return; input.dataset.sug = '1'; input.removeAttribute('list'); input.setAttribute('autocomplete', 'off');
        const pintar = () => {
            const lista = filtrar(fuente(), input.value, 8);
            if (!lista.length || document.activeElement !== input) { cerrar(); return; }
            if (!caja) { caja = document.createElement('div'); caja.className = 'sug-caja'; document.body.appendChild(caja); }
            activo = input;
            const r = input.getBoundingClientRect();
            caja.style.left = Math.max(4, r.left) + 'px'; caja.style.top = (r.bottom + 2) + 'px'; caja.style.width = Math.max(320, r.width) + 'px';
            caja.innerHTML = lista.map((x, i) => `<div class="sug-it" data-i="${i}"><span class="sug-f">${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(x.nombre, { codigo: x.codigo }) : ''}</span><span class="sug-t"><b>${esc(x.nombre)}</b><small>${x.codigo ? 'ID ' + esc(x.codigo) : 'sin ID'}${x.nota ? ' · ' + esc(x.nota) : ''}</small></span></div>`).join('');
            if (window.SAR_Imagenes && window.SAR_Imagenes.rellenar) window.SAR_Imagenes.rellenar(caja);
            caja.querySelectorAll('.sug-it').forEach(el => el.addEventListener('mousedown', (e) => {
                e.preventDefault(); const x = lista[+el.dataset.i]; input.value = x.nombre; cerrar();
                if (alElegir) alElegir(x); input.dispatchEvent(new Event('change', { bubbles: true }));
            }));
        };
        input.addEventListener('input', pintar); input.addEventListener('focus', pintar);
        input.addEventListener('blur', () => setTimeout(() => { if (activo === input) cerrar(); }, 120));
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
    }
    window.addEventListener && window.addEventListener('scroll', () => { if (caja) cerrar(); }, true);
    window.SAR_Sugerir = { enlazar, filtrar, norm };
    if (typeof module !== 'undefined') module.exports = window.SAR_Sugerir;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
