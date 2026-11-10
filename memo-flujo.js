/* ==========================================================================
   MEMO INFORMATIVO · FLUJO DE RECEPCIÓN CONFORME (v21.155)
   Solo para el administrador global (rol superadmin). Explica, con la identidad visual del sitio, cómo se
   decide una recepción conforme total o parcial cuando una orden de compra se distribuye entre varios
   centros. Solo texto estático: no lee ni escribe datos.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const PASOS = [
        ['1', 'Llega la orden de compra', 'La orden trae un cuadro de distribución: cada producto se reparte en columnas, una por centro (SAR y otros).', 'oc.columnas · linea.dist[columna]'],
        ['2', 'Se registran las recepciones del SAR', 'Al llegar los productos se anota cuánto se recibió, en la columna del SAR. Las columnas de otros centros no se tocan.', 'linea.recibido[columna] · oc.recepciones[].fecha'],
        ['3', 'Se revisan las incidencias', 'Con alguna incidencia abierta no se puede dar la conformidad: primero se resuelve.', 'oc.incidencias[].estado = ABIERTA'],
        ['4', 'El sistema compara solo lo del SAR', 'Pedido del SAR = suma de lo asignado a sus columnas. Recibido del SAR = suma de lo recibido en sus columnas.', 'pedido SAR · recibido SAR'],
    ];
    const VARS = [
        ['Pedido del SAR', 'Unidades que la orden asignó al SAR en el cuadro de distribución.', 'Suma de dist en las columnas del SAR'],
        ['Recibido del SAR', 'Unidades que el SAR efectivamente recibió.', 'Suma de recibido en las columnas del SAR'],
        ['Pendiente del SAR', 'Lo que falta para completar lo asignado al SAR. Nunca es negativo.', 'máx(0, pedido SAR − recibido SAR)'],
        ['Tipo de recepción', 'Total si el pendiente del SAR es 0. Parcial solo si el SAR no recibió todo lo que se le asignó.', 'recepcionConforme.parcial'],
        ['Otros centros', 'No influyen: que la orden se reparta o no a otros centros jamás vuelve parcial la recepción del SAR.', '—'],
        ['Fecha del acta', 'Se pregunta siempre. Se propone el día en que se registró la recepción, pero se puede cambiar; no es la de hoy por defecto.', 'recepcionConforme.fecha'],
        ['Encabezado y detalle', 'Texto del acta y lista de productos con cantidades; se pueden corregir antes de emitir y al editar.', 'recepcionConforme.encabezado · .lineas'],
        ['Documento del proveedor', 'Guía de despacho o factura, con su número y su PDF adjunto.', 'tipoDoc · numeroDoc'],
    ];
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function esAdminGlobal() { return document.body.getAttribute('data-user-role') === 'superadmin'; }
    function html() {
        return `<div class="mf-c" tabindex="-1"><div class="mf-h"><div><span class="mf-sello">MEMO INFORMATIVO · SOLO ADMINISTRACIÓN GLOBAL</span><h3 id="mf-t">Recepción conforme: cómo se decide si es total o parcial</h3></div><button type="button" class="btn btn-outline" id="mf-x" aria-label="Cerrar">✕</button></div>
        <div class="mf-b">
          <p class="mf-idea"><b>Idea central:</b> el SAR responde solo por lo que la orden le asignó. Que la misma orden se haya repartido a otros centros <b>no</b> hace parcial la recepción del SAR.</p>
          <h4>Flujo</h4>
          <ol class="mf-flujo">${PASOS.map(p => `<li class="mf-paso"><span class="mf-num">${p[0]}</span><div><b>${esc(p[1])}</b><p>${esc(p[2])}</p><code>${esc(p[3])}</code></div></li>`).join('')}
            <li class="mf-decide"><span class="mf-rombo">¿Pendiente del SAR = 0?</span>
              <div class="mf-ramas"><div class="mf-rama mf-si"><b>Sí → Total</b><p>Se recibió todo lo asignado al SAR, aunque otros centros reciban en otra fecha o por otra vía.</p></div><div class="mf-rama mf-no"><b>No → Parcial</b><p>Al SAR le falta parte de lo asignado. El acta lo dice y el sistema obliga a marcarlo.</p></div></div></li>
            <li class="mf-paso"><span class="mf-num">5</span><div><b>Se emite el acta</b><p>Se pregunta la fecha; se revisan encabezado y detalle; se adjunta la guía o factura y se envía el correo a la lista.</p><code>recepcionConforme · Seguimiento_OC/Eventos</code></div></li>
          </ol>
          <h4>Ejemplo</h4>
          <div class="mf-ej"><div><b>Orden de 100 unidades</b><span>SAR 10 · Centro B 40 · Centro C 50</span></div><div><b>El SAR recibe 10</b><span>Pendiente del SAR 0 → <i class="mf-chip mf-ok">Total</i></span></div><div><b>El SAR recibe 7</b><span>Pendiente del SAR 3 → <i class="mf-chip mf-warn">Parcial</i></span></div></div>
          <h4>Variables</h4>
          <div class="mf-tabla-w"><table class="bit-tabla"><thead><tr><th scope="col">Variable</th><th scope="col">Qué es</th><th scope="col">Dónde / cómo</th></tr></thead><tbody>${VARS.map(v => `<tr><td><b>${esc(v[0])}</b></td><td>${esc(v[1])}</td><td><code>${esc(v[2])}</code></td></tr>`).join('')}</tbody></table></div>
          <p class="act-hint">Documento informativo: no modifica datos ni reglas.</p>
        </div></div>`;
    }
    function abrir() {
        if (!esAdminGlobal()) return;
        const o = document.createElement('div'); o.className = 'bit-modal'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-labelledby', 'mf-t');
        o.innerHTML = html(); document.body.appendChild(o); document.body.style.overflow = 'hidden';
        const prev = document.activeElement;
        const cerrar = () => { document.removeEventListener('keydown', tec); document.body.style.overflow = ''; o.remove(); if (prev && prev.focus) prev.focus(); };
        const tec = (k) => { if (k.key === 'Escape') cerrar(); if (k.key === 'Tab') { k.preventDefault(); o.querySelector('#mf-x').focus(); } };
        document.addEventListener('keydown', tec); o.querySelector('#mf-x').addEventListener('click', cerrar); o.addEventListener('mousedown', (e) => { if (e.target === o) cerrar(); });
        o.querySelector('#mf-x').focus();
    }
    function iniciar() { const m = document.getElementById('menu-memo-flujo'); if (m && !m.dataset.ok) { m.dataset.ok = '1'; m.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); abrir(); }); } }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
    window.SAR_MemoFlujo = { abrir };
})(window, document);
