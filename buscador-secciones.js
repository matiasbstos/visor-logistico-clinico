/* ==========================================================================
   BUSCADOR DE SECCIONES DEL VISOR (v21.239) · paleta «Buscar» (Ctrl+K). No lee la base de datos (no es buscador-global.js, que sigue apagado por defecto desde v21.73)
   Pedido del usuario: «si quiero llegar a ajustes y no tener que buscarlo en la lista, escriba
   "ajustes" y me lo muestre». Botón «Buscar» en la barra superior (atajo Ctrl+K o «/»):
   - secciones del menú lateral que el usuario puede ver (respeta los roles: solo las visibles),
   - sinónimos de uso diario (merma → ajustes, OC → seguimiento, etc.),
   - productos: lleva a Existencias con la búsqueda escrita.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    /* palabras con que se buscan las secciones (además de su nombre) */
    const SINONIMOS = {
        'view-ajustes': 'ajuste sumar restar corregir stock merma perdida aju diferencia',
        'view-inventario': 'stock existencias productos insumos medicamentos buscar producto',
        'view-toma-inventario': 'conteo inventario toma contar ingreso existencias',
        'view-movimientos': 'ingreso entrada recibir guia factura ing',
        'view-transferencias': 'traspaso mover trasladar bodega',
        'view-actas-entrega': 'acta entrega centro cesfam despacho ae firmada',
        'view-seguimiento-oc': 'orden compra oc proveedor recepcion conforme mercado publico',
        'view-solicitudes-insumos': 'pedidos solicitudes recibidas sol bandeja pedido',
        'view-solicitud-insumos': 'pedir solicitar pedido nuevo',
        'view-etiquetas': 'etiqueta imprimir zebra bulto reimprimir codigo barras pistola probar lector escaner',
        'view-bultos': 'bulto caja pistola escanear contar cajas',
        'view-fotos': 'fotos fotografia imagen camara caja catalogo enlaces links accesos directos telefono qr',
        'view-historial': 'historial movimientos kardex',
        'view-informes': 'informe contable disponible reporte excel kardex saldos',
        'view-bodegas': 'bodega ubicacion estante cerrar bodega',
        'view-salud-inventario': 'repetidos duplicados salud unificar deuda sobregiro',
        'view-configuracion': 'configuracion respaldo correo backup excel semanal',
        'view-usuarios': 'usuarios cuentas roles permisos',
        'view-bandejas': 'bandeja turno carro',
        'view-oxigeno': 'oxigeno balon cilindro',
        'view-auditoria': 'auditoria registro cambios gobernanza',
        'view-errores': 'directorio nomenclaturas codigos errores contactos',
        'view-donde-esta': 'donde esta ubicar encontrar estante'
    };
    const visible = (el) => { if (!el) return false; const cs = window.getComputedStyle(el); if (cs.display === 'none') return false;   /* solo display: el menú lateral pliega grupos con visibility */ let p = el.parentElement; while (p && p !== document.body) { if (window.getComputedStyle(p).display === 'none') return false; p = p.parentElement; } return true; };
    function secciones() {
        const vistos = new Set(), out = [];
        document.querySelectorAll('#app-sidebar .menu-item').forEach(a => {
            const t = a.getAttribute('data-title') || a.textContent.trim(), dest = a.getAttribute('data-target') || '';
            if (!t || /cerrar sesi/i.test(t) || !visible(a)) return;
            const k = dest + '|' + t; if (vistos.has(k)) return; vistos.add(k);
            const ic = a.querySelector('i'); out.push({ t, dest, el: a, ico: ic ? ic.className : 'ph-bold ph-arrow-right', txt: norm(t + ' ' + (SINONIMOS[dest] || '')) });
        });
        return out;
    }
    function puntaje(s, q) {
        const w = q.split(' ').filter(Boolean); if (!w.length) return 0;
        if (!w.every(x => s.txt.includes(x))) return 0;
        const t = norm(s.t); return (t.startsWith(q) ? 3 : t.includes(q) ? 2 : 1);
    }
    let ov = null;
    function cerrar() { if (ov) { ov.remove(); ov = null; } }
    function abrir() {
        if (ov) { ov.querySelector('input').focus(); return; }
        const lista = secciones();
        ov = document.createElement('div'); ov.className = 'bs-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Buscar en el Visor');
        ov.innerHTML = `<div class="bs-c"><div class="bs-in"><i class="ph-bold ph-magnifying-glass" aria-hidden="true"></i><input type="search" placeholder="¿Qué buscas? Ej: ajustes, actas, etiquetas, un producto…" aria-label="Buscar en el Visor" autocomplete="off"><kbd>Esc</kbd></div><div class="bs-res" role="listbox"></div><p class="bs-pie">Enter abre el primero · ↑ ↓ para moverte · Ctrl+K para volver a abrir</p></div>`;
        document.body.appendChild(ov);
        const inp = ov.querySelector('input'), res = ov.querySelector('.bs-res'); let sel = 0, items = [];
        const pintar = () => {
            const q = norm(inp.value);
            const secs = q ? lista.map(s => ({ s, p: puntaje(s, q) })).filter(x => x.p).sort((a, b) => b.p - a.p).map(x => x.s).slice(0, 8) : lista.slice(0, 8);
            items = secs.map(s => ({ tipo: 'sec', s }));
            if (q.length >= 2 && visible(document.querySelector('#app-sidebar .menu-item[data-target="view-inventario"]'))) items.push({ tipo: 'prod', q: inp.value.trim() });
            if (sel >= items.length) sel = 0;
            res.innerHTML = items.map((x, i) => x.tipo === 'sec'
                ? `<button type="button" class="bs-it${i === sel ? ' on' : ''}" data-i="${i}" role="option"><i class="${esc(x.s.ico)}" aria-hidden="true"></i><span>${esc(x.s.t)}</span><small>Sección</small></button>`
                : `<button type="button" class="bs-it${i === sel ? ' on' : ''}" data-i="${i}" role="option"><i class="ph-bold ph-pill" aria-hidden="true"></i><span>Buscar «${esc(x.q)}» en Existencias</span><small>Producto</small></button>`).join('') || '<p class="bs-nada">Sin resultados.</p>';
        };
        const ir = (i) => {
            const x = items[i]; if (!x) return; cerrar();
            if (x.tipo === 'sec') { x.s.el.click(); return; }
            const m = document.querySelector('#app-sidebar .menu-item[data-target="view-inventario"]'); if (m) m.click();
            setTimeout(() => { const b = document.getElementById('inventory-search-input'); if (b) { b.value = x.q; b.dispatchEvent(new Event('input', { bubbles: true })); b.focus(); } }, 350);
        };
        inp.addEventListener('input', () => { sel = 0; pintar(); });
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); pintar(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); pintar(); }
            else if (e.key === 'Enter') { e.preventDefault(); ir(sel); }
            else if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
        });
        res.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) ir(Number(b.dataset.i)); });
        ov.addEventListener('click', (e) => { if (e.target === ov) cerrar(); });
        pintar(); inp.focus();
    }
    function iniciar() {
        const qa = document.getElementById('quick-access');
        if (qa && !document.getElementById('btn-buscar-global')) {
            const b = document.createElement('button'); b.type = 'button'; b.id = 'btn-buscar-global'; b.className = 'erp-btn erp-btn--outline bs-btn'; b.title = 'Buscar en el Visor (Ctrl+K)';
            b.innerHTML = '<i class="ph-bold ph-magnifying-glass" aria-hidden="true"></i><span>Buscar</span><kbd>Ctrl K</kbd>';
            b.addEventListener('click', abrir); qa.parentNode.insertBefore(b, qa);
        }
        /* fase de captura en window: gana sobre el atajo de menu-lateral.js (?activar=menu), así no se disparan los dos */
        window.addEventListener('keydown', (e) => {
            const enCampo = /^(input|textarea|select)$/i.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
            const hayVentana = [...document.querySelectorAll('.sar-conf, .bu-ov, .modal-overlay, .bs-ov')].some(m => { const cs = getComputedStyle(m); return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05; })   /* los .modal-overlay ocultos siguen en la página con opacidad 0 */;
            if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); e.stopPropagation(); if (!document.querySelector('.bs-ov')) abrir(); }
            else if (e.key === '/' && !enCampo && !hayVentana) { e.preventDefault(); e.stopPropagation(); abrir(); }
        }, true);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
    window.SAR_Buscador = { abrir, secciones };
})(window, document);
