/* Menú lateral (v21.65): grupos y submenús desplegables, orden por prioridad, buscador y «Más opciones» abajo.
   Reordena el menú existente sin cambiar sus enlaces (data-target) ni sus eventos. */
(function () {
    'use strict';
    const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    /** ¿La etiqueta coincide con la búsqueda? Todas las palabras deben aparecer (sin tildes ni mayúsculas). */
    function coincide(etiqueta, consulta) { const q = norm(consulta).split(/\s+/).filter(Boolean), t = norm(etiqueta); return q.length > 0 && q.every(w => t.includes(w)); }
    // Orden por prioridad de uso y submenús (por data-target)
    const ORDEN = {
        INVENTARIO: ['view-inventario', 'view-donde-esta', 'view-toma-inventario', 'view-bodegas', 'view-inventario-semanal'],
        MOVIMIENTOS: ['view-movimientos', 'view-transferencias', 'view-actas-entrega', 'view-pendientes-entrega', 'view-bitacora-oc', 'view-ajustes', 'view-historial'],
        COMPRAS: ['view-compras', 'view-seguimiento-oc', 'view-compras-agiles', 'view-ingreso-rapido'],
        ADMINISTRACIÓN: ['view-informes', 'view-usuarios']
    };
    const SUBMENUS = {
        MOVIMIENTOS: { titulo: 'Revisión y control', icono: 'ph-magnifying-glass', items: ['view-sustituciones', 'view-duplicados', 'view-oxigeno', 'view-auditoria'] },
        COMPRAS: { titulo: 'Flujo y plazos', icono: 'ph-calendar-check', items: ['view-erp-adquisiciones', 'view-adquisiciones'] }
    };
    // Orden de los bloques: inventario → movimientos → compras → turno clínico → administración
    const BLOQUES = ['INVENTARIO', 'MOVIMIENTOS', 'COMPRAS', 'TURNO CLÍNICO', 'ADMINISTRACIÓN'];
    if (typeof module !== 'undefined') module.exports = { norm, coincide, ORDEN, SUBMENUS, BLOQUES };
    if (typeof document === 'undefined' || !document.querySelector) return;
    if (typeof location !== 'undefined' && /[?&]seguro=1/.test(location.search || '')) return;   // modo seguro: abre el sitio sin este módulo

    const LS = 'sar_menu_v1';
    let estado = {}; try { estado = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { estado = {}; }
    const guardar = () => { try { localStorage.setItem(LS, JSON.stringify(estado)); } catch (e) { /* sin almacenamiento */ } };
    const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
    const tituloDe = box => { const t = box.querySelector('.sidebar-group-title .menu-label'); return t ? t.textContent.replace(/\s+/g, ' ').trim().toUpperCase() : ''; };
    const clave = t => (t.startsWith('COMPRAS') ? 'COMPRAS' : t);
    const porTarget = (root, t) => root.querySelector(`.menu-item[data-target="${t}"]`);

    /** Panel plegable con animación (rejilla 0fr → 1fr). */
    function plegable(id, titulo, abiertoPorDefecto) {
        const cuerpo = mk('div', 'ml-body'), dentro = mk('div', 'ml-in'); cuerpo.appendChild(dentro);
        const abierto = id in estado ? !!estado[id] : abiertoPorDefecto;
        const poner = v => { cuerpo.classList.toggle('ml-abierto', v); if (titulo) { titulo.setAttribute('aria-expanded', String(v)); } };
        poner(abierto);
        if (titulo) {
            titulo.setAttribute('role', 'button'); titulo.setAttribute('tabindex', '0'); titulo.classList.add('ml-tit');
            const alt = () => { const v = !cuerpo.classList.contains('ml-abierto'); poner(v); estado[id] = v; guardar(); };
            titulo.addEventListener('click', alt); titulo.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alt(); } });
        }
        return { cuerpo, dentro, abrir: () => poner(true), poner };
    }

    function construir() {
        const sb = document.getElementById('app-sidebar'), wrap = sb && sb.querySelector('.sidebar-menu-wrapper');
        if (!wrap || wrap.dataset.ml) return; wrap.dataset.ml = '1';
        const cajas = [...wrap.querySelectorAll(':scope > .sidebar-box')];
        const porClave = {}; cajas.forEach(c => { porClave[clave(tituloDe(c))] = c; });
        const grupos = [];
        BLOQUES.forEach(k => {
            const box = porClave[k]; if (!box) return;
            const tit = box.querySelector('.sidebar-group-title'); if (!tit) return;
            const items = [...box.querySelectorAll(':scope > .menu-item')];
            const g = plegable('g:' + k, tit, true);
            tit.insertAdjacentHTML('beforeend', '<i class="ph-bold ph-caret-down ml-chev" aria-hidden="true"></i>');
            const ord = ORDEN[k];
            if (ord) ord.forEach(t => { const it = porTarget(box, t) || items.find(x => x.dataset.target === t); if (it) g.dentro.appendChild(it); });
            const sub = SUBMENUS[k];
            if (sub) {
                const boton = mk('button', 'ml-subbtn', `<i class="ph-bold ${sub.icono}"></i><span class="menu-label">${sub.titulo}</span><i class="ph-bold ph-caret-down ml-chev"></i>`);
                boton.type = 'button'; boton.setAttribute('aria-expanded', 'false');
                const s = plegable('s:' + k, null, false); s.cuerpo.classList.add('ml-subcuerpo');
                const poner = v => { s.poner(v); boton.setAttribute('aria-expanded', String(v)); boton.classList.toggle('ml-on', v); };
                poner(!!estado['s:' + k]);
                boton.addEventListener('click', () => { const v = !s.cuerpo.classList.contains('ml-abierto'); poner(v); estado['s:' + k] = v; guardar(); });
                const cont = mk('div', 'ml-sub'); cont.append(boton, s.cuerpo); cont.__poner = poner;
                sub.items.forEach(t => { const it = porTarget(box, t); if (it) s.dentro.appendChild(it); });
                g.dentro.appendChild(cont);
            }
            // lo que quede sin clasificar se conserva al final
            items.forEach(it => { if (!it.parentNode || it.parentNode === box) g.dentro.appendChild(it); });
            box.appendChild(g.cuerpo); grupos.push({ k, box, g });
        });
        // mover bloques en el orden de prioridad (los desconocidos quedan al final)
        const sueltas = cajas.filter(c => !grupos.some(x => x.box === c)); sueltas.filter(c => !c.querySelector('.sidebar-group-title')).forEach(c => wrap.appendChild(c)); grupos.forEach(x => wrap.appendChild(x.box)); sueltas.filter(c => c.querySelector('.sidebar-group-title')).forEach(c => wrap.appendChild(c));
        buscador(sb, wrap); pie(sb); abrirActivo(sb);
        new MutationObserver(() => abrirActivo(sb)).observe(wrap, { attributes: true, subtree: true, attributeFilter: ['class'] });
        document.addEventListener('keydown', e => { const t = e.target; const escribiendo = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); if (((e.key === '/' && !escribiendo) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) && document.getElementById('ml-buscar')) { e.preventDefault(); if (sb.classList.contains('collapsed')) { const b = document.getElementById('sidebar-toggle-btn'); if (b) b.click(); } document.getElementById('ml-buscar').focus(); } });
    }

    /** Abre el grupo (y submenú) del elemento activo, sin cerrar nada. */
    function abrirActivo(sb) {
        const act = sb.querySelector('.menu-item.active'); if (!act) return;
        const c = act.closest('.ml-body'); if (c && c.classList.contains('ml-subcuerpo')) { c.classList.add('ml-abierto'); const b = c.previousElementSibling; if (b) { b.classList.add('ml-on'); b.setAttribute('aria-expanded', 'true'); } }
        const g = act.closest('.sidebar-box > .ml-body'); if (g) { g.classList.add('ml-abierto'); const t = g.parentNode.querySelector('.ml-tit'); if (t) t.setAttribute('aria-expanded', 'true'); }
        const m = act.closest('.ml-mas-cuerpo'); if (m) { m.classList.add('ml-abierto'); const b = document.getElementById('ml-mas-btn'); if (b) b.setAttribute('aria-expanded', 'true'); }
    }

    function buscador(sb, wrap) {
        const caja = mk('div', 'ml-busq', '<i class="ph-bold ph-magnifying-glass" aria-hidden="true"></i><input id="ml-buscar" type="search" autocomplete="off" placeholder="Buscar en el menú…" aria-label="Buscar en el menú"><kbd>/</kbd>');
        const vacio = mk('p', 'ml-vacio', 'Nada coincide con esa búsqueda.'); vacio.hidden = true;
        wrap.insertBefore(caja, wrap.firstChild); wrap.appendChild(vacio);
        const inp = caja.querySelector('input');
        const items = () => [...sb.querySelectorAll('.sidebar-menu-wrapper .menu-item, .sidebar-footer .ml-mas-cuerpo .menu-item')];
        const aplicar = () => {
            const q = inp.value; sb.classList.toggle('ml-buscando', !!q.trim());
            const todos = items(); todos.forEach(i => i.classList.remove('ml-oculto', 'ml-hit'));
            wrap.querySelectorAll('.sidebar-box, .ml-sub').forEach(x => x.classList.remove('ml-oculto'));
            if (!q.trim()) { vacio.hidden = true; return; }
            let hay = 0, primero = null;
            todos.forEach(i => {
                const disp = i.offsetParent !== null; if (!disp) return;
                const etiqueta = (i.querySelector('.menu-label') || i).textContent + ' ' + (i.dataset.title || '');
                const grupo = i.closest('.sidebar-box'); const nombreGrupo = grupo ? tituloDe(grupo) : '';
                if (coincide(etiqueta + ' ' + nombreGrupo, q)) { i.classList.add('ml-hit'); hay++; if (!primero) primero = i; } else i.classList.add('ml-oculto');
            });
            wrap.querySelectorAll('.ml-sub').forEach(s => { if (!s.querySelector('.ml-hit')) s.classList.add('ml-oculto'); });
            wrap.querySelectorAll('.sidebar-box').forEach(b => { if (!b.querySelector('.ml-hit') && b.querySelector('.menu-item')) b.classList.add('ml-oculto'); });
            vacio.hidden = hay > 0; inp.__primero = primero;
        };
        inp.addEventListener('input', aplicar);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter' && inp.__primero) { e.preventDefault(); inp.__primero.click(); inp.value = ''; aplicar(); inp.blur(); } else if (e.key === 'Escape') { inp.value = ''; aplicar(); inp.blur(); } });
    }

    function pie(sb) {
        const pie = sb.querySelector('.sidebar-footer'); if (!pie || pie.dataset.ml) return; pie.dataset.ml = '1';
        const ids = [document.getElementById('menu-acerca'), pie.querySelector('[data-target="view-errores"]'), document.getElementById('menu-config')].filter(Boolean);
        if (!ids.length) return;
        const abierto = !!estado.mas;
        const btn = mk('button', 'ml-mas-btn', '<i class="ph-bold ph-dots-three-circle"></i><span class="menu-label">Más opciones</span><i class="ph-bold ph-caret-up ml-chev"></i>');
        btn.type = 'button'; btn.id = 'ml-mas-btn'; btn.setAttribute('aria-expanded', String(abierto)); btn.setAttribute('aria-controls', 'ml-mas-cuerpo'); btn.dataset.title = 'Más opciones';
        const cuerpo = mk('div', 'ml-body ml-mas-cuerpo' + (abierto ? ' ml-abierto' : '')), dentro = mk('div', 'ml-in'); cuerpo.id = 'ml-mas-cuerpo'; cuerpo.appendChild(dentro);
        ids.forEach(i => dentro.appendChild(i));
        btn.addEventListener('click', () => { const v = !cuerpo.classList.contains('ml-abierto'); cuerpo.classList.toggle('ml-abierto', v); btn.setAttribute('aria-expanded', String(v)); estado.mas = v; guardar(); });
        const salir = pie.querySelector('.danger'); pie.insertBefore(cuerpo, salir); pie.insertBefore(btn, cuerpo);
        // oculta el botón si el rol no ve ninguna de las opciones
        const rev = () => { btn.hidden = !ids.some(i => i.offsetParent !== null); }; rev(); new MutationObserver(rev).observe(document.body, { attributes: true, attributeFilter: ['data-user-role'] });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', construir); else construir();
})();
