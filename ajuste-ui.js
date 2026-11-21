/* ==========================================================================
   AJUSTES DE STOCK · VISTA DE PRODUCTOS Y LOTES (v21.239)
   Pedido del usuario: en las coincidencias ver el nombre completo, la foto, el stock y los lotes
   disponibles con su vencimiento, y al ajustar (sumar o restar) elegir el lote exacto («si no
   aparece voy a estar totalmente a ciegas»).
   Usa el <select id="ajuste-insumo"> existente como fuente de datos (queda oculto): cada opción trae
   dataset.lotes / bodega / codigo (script.js). Elegir una tarjeta selecciona la opción y dispara «change».
   ========================================================================== */
(function (window, document) {
    'use strict';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (v) => Number(v) || 0;
    const fecha = (v) => { const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(v || '')); return m ? (m[3] ? `${m[3]}-${m[2]}-${m[1]}` : `${m[2]}-${m[1]}`) : (String(v || '') === 'N/A' ? '' : String(v || '')); };
    const diasA = (v) => { const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(v || '')); if (!m) return null; const d = new Date(+m[1], +m[2] - 1, m[3] ? +m[3] : 28); return Math.floor((d - new Date()) / 86400000); };
    const lotesDe = (op) => { try { return JSON.parse(op.dataset.lotes || '[]'); } catch (e) { return []; } };
    const foto = (nombre, codigo) => window.SAR_Imagenes && window.SAR_Imagenes.thumb ? window.SAR_Imagenes.thumb(nombre || '', { codigo: codigo || '' }) : '';
    const rellenar = (el) => { const I = window.SAR_Imagenes; if (I && I.cargar) I.cargar().then(() => I.rellenar(el)).catch(() => {}); };
    const chipLote = (l) => { const d = diasA(l.vence), cl = d == null ? '' : d < 0 ? ' aj-venc' : d <= 90 ? ' aj-pronto' : ''; return `<span class="aj-chip${cl}"><b>${esc(l.lote)}</b> · ${num(l.q)} u.${l.vence && fecha(l.vence) ? ' · vence ' + esc(fecha(l.vence)) : ''}</span>`; };
    let elegidoLote = null;

    /** Tarjetas con foto, nombre completo, bodega, stock y lotes (bajo el buscador). */
    function lista(sel) {
        let box = document.getElementById('ajuste-lista');
        if (!box) { box = document.createElement('div'); box.id = 'ajuste-lista'; box.className = 'aj-lista'; box.setAttribute('role', 'listbox'); box.setAttribute('aria-label', 'Coincidencias'); sel.parentNode.insertBefore(box, sel); }
        sel.classList.add('aj-oculto');
        const ops = [...sel.options].filter(o => o.value);
        box.innerHTML = ops.length ? ops.map(o => { const l = lotesDe(o), rv = num(o.dataset.reservado);
            return `<button type="button" class="aj-item${sel.value === o.value ? ' on' : ''}" data-v="${esc(o.value)}" role="option" aria-selected="${sel.value === o.value}">${foto(o.dataset.nombre, o.dataset.codigo)}<span class="aj-txt"><b>${esc(o.dataset.nombre)}</b><small>${esc(o.dataset.bodega || 'Sin bodega')}${o.dataset.codigo ? ' · ID ' + esc(o.dataset.codigo) : ''}</small><span class="aj-chips">${l.filter(x => x.q > 0).map(chipLote).join('') || '<span class="aj-chip">sin lotes con stock</span>'}</span></span><span class="aj-stock"><b>${num(o.dataset.stock)}</b><small>u.${rv ? ` + ${rv} res.` : ''}</small></span></button>`; }).join('')
            : `<p class="aj-vacio">${esc((sel.options[0] && sel.options[0].textContent) || 'Sin coincidencias.')}</p>`;
        box.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { sel.value = b.dataset.v; sel.dispatchEvent(new Event('change')); box.querySelectorAll('.aj-item').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); }); const c = document.getElementById('ajuste-cantidad'); if (c && window.innerWidth > 900) c.focus(); });
        rellenar(box);
    }
    /** Lotes del producto elegido, para decidir a cuál va el ajuste (+ «lote nuevo» para sumar). */
    function lotes(op) {
        elegidoLote = null;
        const info = document.getElementById('lbl-insumo-seleccionado-lotes'); if (!info) return;
        let box = document.getElementById('ajuste-lotes');
        if (!box) { box = document.createElement('div'); box.id = 'ajuste-lotes'; box.className = 'aj-lotes'; info.parentNode.parentNode.insertBefore(box, info.parentNode.nextSibling); }
        const l = lotesDe(op).filter(x => x.q > 0);
        if (l.length === 1) elegidoLote = { ...l[0] };
        const pinta = () => {
            box.innerHTML = `<div class="aj-lot-h"><span class="form-label" style="margin:0">¿A qué lote va el ajuste?</span>${foto(op.dataset.nombre, op.dataset.codigo)}</div>
              <div class="aj-lot-g" role="radiogroup" aria-label="Lote a ajustar">${l.map((x, i) => `<label class="aj-lot${elegidoLote && !elegidoLote.nuevo && elegidoLote.lote === x.lote ? ' on' : ''}"><input type="radio" name="aj-lote" value="${i}"${elegidoLote && !elegidoLote.nuevo && elegidoLote.lote === x.lote ? ' checked' : ''}><span><b>${esc(x.lote)}</b><small>${num(x.q)} u.${x.vence && fecha(x.vence) ? ' · vence ' + esc(fecha(x.vence)) : ''}</small></span></label>`).join('')}
              <label class="aj-lot${elegidoLote && elegidoLote.nuevo ? ' on' : ''}"><input type="radio" name="aj-lote" value="n"${elegidoLote && elegidoLote.nuevo ? ' checked' : ''}><span><b>Lote nuevo</b><small>solo para sumar</small></span></label></div>
              ${elegidoLote && elegidoLote.nuevo ? `<div class="grid-2-col-even aj-nuevo"><label class="form-label">Lote<input id="aj-nl" class="form-control" value="${esc(elegidoLote.lote)}" placeholder="Ej: L2405 o S/L"></label><label class="form-label">Vencimiento<input id="aj-nv" type="date" class="form-control" value="${esc(elegidoLote.vence)}"></label></div>` : ''}
              <p class="aj-proy" id="aj-proy"></p>`;
            box.querySelectorAll('input[name="aj-lote"]').forEach(r => r.onchange = () => { elegidoLote = r.value === 'n' ? { lote: '', vence: '', q: 0, nuevo: true } : { ...l[Number(r.value)] }; pinta(); proyectar(); });
            const nl = box.querySelector('#aj-nl'), nv = box.querySelector('#aj-nv');
            if (nl) nl.oninput = () => { elegidoLote.lote = nl.value.trim().toUpperCase(); }; if (nv) nv.onchange = () => { elegidoLote.vence = nv.value; };
            rellenar(box); proyectar();
        };
        pinta();
    }
    function proyectar() {
        const p = document.getElementById('aj-proy'); if (!p) return;
        const c = num((document.getElementById('ajuste-cantidad') || {}).value);
        if (!elegidoLote) { p.textContent = 'Elige el lote.'; return; }
        const base = elegidoLote.nuevo ? 0 : num(elegidoLote.q), r = base + c;
        p.innerHTML = c ? `Lote <b>${esc(elegidoLote.lote || '(nuevo)')}</b>: ${base} → <b class="${r < 0 ? 'aj-neg' : ''}">${r}</b> u.${r < 0 ? ' · no alcanza' : ''}` : `Lote <b>${esc(elegidoLote.lote || '(nuevo)')}</b>: ${base} u.`;
    }
    function elegido() { if (!elegidoLote) return null; if (elegidoLote.nuevo && !elegidoLote.lote) elegidoLote.lote = 'S/L'; return { ...elegidoLote }; }
    document.addEventListener('input', (e) => { if (e.target && e.target.id === 'ajuste-cantidad') proyectar(); });
    window.SAR_AjusteUI = { lista, lotes, elegido };
})(window, document);
