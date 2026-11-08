/* ==========================================================================
   TABLAS A TU GUSTO (v21.53)
   A las tablas principales (Existencias, Historial, Compras, Kardex, Usuarios, Bodegas…) se les suma
   una barra "Columnas": mostrar u ocultar columnas, arrastrar el borde del encabezado para cambiar
   el ancho, fijar la primera columna y elegir la densidad (cómoda / compacta). La elección se guarda
   por tabla y por equipo (localStorage). Es no destructivo: solo agrega reglas CSS por posición de
   columna, así que no altera el HTML que genera cada pantalla ni se pierde al repintar.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const TABLAS = {
        'inventory-table-body': 'Existencias', 'historial-table-body': 'Historial', 'compras-table-body': 'Compras', 'kardex-table-body': 'Kardex',
        'tabla-usuarios-body': 'Usuarios', 'bodegas-tbody': 'Bodegas', 'report-table-body': 'Informes', 'critico-table-body': 'Stock crítico',
        'erp-recepcion-tbody': 'Recepciones', 'tabla-solicitudes-criticas': 'Solicitudes críticas'
    };
    const KEY = (id) => 'sar_cols_v1_' + id;
    const leer = (id) => { try { return JSON.parse(localStorage.getItem(KEY(id))) || {}; } catch (e) { return {}; } };
    const guardar = (id, v) => { try { localStorage.setItem(KEY(id), JSON.stringify(v)); } catch (e) { /* sin storage */ } };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** Puro: CSS de una tabla según su configuración { ocultas:[i], anchos:{i:px}, fijar:bool, compacta:bool }. Índices desde 1. */
    function reglas(id, cfg) {
        const t = `table[data-tc="${id}"]`, out = [];
        (cfg.ocultas || []).forEach(i => out.push(`${t} thead th:nth-child(${i}), ${t} tbody td:nth-child(${i}):not([colspan]) { display: none; }`));
        Object.keys(cfg.anchos || {}).forEach(i => { const w = Math.max(48, Math.min(640, Number(cfg.anchos[i]) || 0)); if (w) out.push(`${t} thead th:nth-child(${i}) { width: ${w}px; min-width: ${w}px; max-width: ${w}px; }`); });
        if (cfg.fijar) out.push(`${t} thead th:first-child, ${t} tbody td:first-child:not([colspan]) { position: sticky; left: 0; z-index: 2; background: #fff; box-shadow: 1px 0 0 #E2E8F0; } ${t} thead th:first-child { background: #F1F5F9; z-index: 3; }`);
        if (cfg.compacta) out.push(`${t} thead th, ${t} tbody td { padding-top: 4px !important; padding-bottom: 4px !important; font-size: 12.5px; }`);
        return out.join('\n');
    }

    function montar(id, nombre) {
        const tb = document.getElementById(id); if (!tb || tb.dataset.tcOk) return; const tabla = tb.closest('table'); if (!tabla) return;
        tb.dataset.tcOk = '1'; tabla.setAttribute('data-tc', id);
        const ths = [...tabla.querySelectorAll('thead th')]; if (ths.length < 3) return;
        const nombres = ths.map((th, i) => (th.textContent || '').replace(/\s+/g, ' ').trim() || `Columna ${i + 1}`);
        let cfg = leer(id); cfg.ocultas = cfg.ocultas || []; cfg.anchos = cfg.anchos || {};
        const st = document.createElement('style'); st.dataset.tcStyle = id; document.head.appendChild(st);
        const aplicar = () => { st.textContent = reglas(id, cfg); guardar(id, cfg); };
        const bar = document.createElement('div'); bar.className = 'tc-bar';
        bar.innerHTML = `<button type="button" class="btn btn-outline btn-sm tc-btn" aria-haspopup="true" aria-expanded="false"><i class="ph-bold ph-columns"></i> Columnas</button>
          <div class="tc-menu" role="group" aria-label="Columnas de ${esc(nombre)}" hidden>
            <div class="tc-lista">${nombres.map((n, i) => `<label><input type="checkbox" data-i="${i + 1}"> <span>${esc(n)}</span></label>`).join('')}</div>
            <div class="tc-sep"></div>
            <label><input type="checkbox" data-f="fijar"> <span>Fijar la primera columna</span></label>
            <label><input type="checkbox" data-f="compacta"> <span>Filas compactas</span></label>
            <button type="button" class="btn btn-outline btn-sm tc-reset">Restablecer</button>
            <small class="tc-hint">Arrastra el borde de un encabezado para cambiar su ancho.</small>
          </div>`;
        const padre = tabla.parentElement; (padre && padre.children.length === 1 ? padre : tabla).insertAdjacentElement('beforebegin', bar);
        const btn = bar.querySelector('.tc-btn'), menu = bar.querySelector('.tc-menu');
        const pintar = () => {
            bar.querySelectorAll('[data-i]').forEach(c => { c.checked = !cfg.ocultas.includes(Number(c.dataset.i)); });
            bar.querySelector('[data-f="fijar"]').checked = !!cfg.fijar; bar.querySelector('[data-f="compacta"]').checked = !!cfg.compacta;
            const n = cfg.ocultas.length; btn.innerHTML = `<i class="ph-bold ph-columns"></i> Columnas${n ? ` (${n} oculta${n > 1 ? 's' : ''})` : ''}`;
        };
        const abrir = (v) => { menu.hidden = !v; btn.setAttribute('aria-expanded', String(v)); };
        btn.addEventListener('click', () => abrir(menu.hidden));
        document.addEventListener('click', (e) => { if (!menu.hidden && !bar.contains(e.target)) abrir(false); });
        bar.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { abrir(false); btn.focus(); } });
        menu.addEventListener('change', (e) => {
            const c = e.target;
            if (c.dataset.i) { const i = Number(c.dataset.i); const vis = menu.querySelectorAll('[data-i]:checked').length; if (!c.checked && vis < 1) { c.checked = true; return; } cfg.ocultas = c.checked ? cfg.ocultas.filter(x => x !== i) : [...new Set([...cfg.ocultas, i])]; }
            else if (c.dataset.f) cfg[c.dataset.f] = c.checked;
            aplicar(); pintar();
        });
        menu.querySelector('.tc-reset').addEventListener('click', () => { cfg = { ocultas: [], anchos: {} }; aplicar(); pintar(); });
        // ancho: manija en el borde derecho de cada encabezado
        ths.forEach((th, i) => {
            const m = document.createElement('span'); m.className = 'tc-grip'; m.setAttribute('aria-hidden', 'true'); th.style.position = th.style.position || 'relative'; th.appendChild(m);
            m.addEventListener('pointerdown', (e) => {
                e.preventDefault(); e.stopPropagation(); const x0 = e.clientX, w0 = th.getBoundingClientRect().width; m.setPointerCapture(e.pointerId);
                const mv = (ev) => { cfg.anchos[i + 1] = Math.round(w0 + ev.clientX - x0); st.textContent = reglas(id, cfg); };
                const up = () => { m.removeEventListener('pointermove', mv); m.removeEventListener('pointerup', up); aplicar(); };
                m.addEventListener('pointermove', mv); m.addEventListener('pointerup', up);
            });
            m.addEventListener('dblclick', () => { delete cfg.anchos[i + 1]; aplicar(); });
        });
        aplicar(); pintar();
    }
    function iniciar() { if (!document.getElementById) return; Object.keys(TABLAS).forEach(id => montar(id, TABLAS[id])); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
    if (window.addEventListener) window.addEventListener('load', iniciar);
    window.SAR_TablaColumnas = { reglas, iniciar };
    if (typeof module !== 'undefined') module.exports = { reglas };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { readyState: 'complete', addEventListener() {} });
