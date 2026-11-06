/* ==========================================================================
   PENDIENTES POR ENTREGAR (v21.10)
   --------------------------------------------------------------------------
   Lo que un centro pidió y aún no se le entrega (queda anotado en cada acta: pedido vs
   entregado, y la lista de pendientes). Se agrupa por centro, se cruza con el stock
   disponible y la campana avisa cuando ya hay stock para hacer la entrega.
   Pendiente por producto y centro, siguiendo las actas en orden cronológico:
   - un ítem con pedido mayor a lo entregado fija el pendiente (pedido − entregado);
   - un ítem con pedido cumplido lo deja en 0;
   - un ítem sin pedido descuenta lo entregado del pendiente que hubiera;
   - la lista "pendientes" del acta fija el pendiente de ese producto.
   Las actas anuladas no cuentan.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (v) => Number(v) || 0;
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const root = () => document.getElementById('pen-root');
    const rol = () => String(document.body.dataset.userRole || '').toLowerCase();
    const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };

    /** Lógica pura: actas (cualquier orden) → pendientes vigentes por centro. */
    function calcularPendientes(actas) {
        const orden = (a) => String(a.fecha || '') + String(a.numero || '');
        const lista = (actas || []).filter(a => a && a.estado !== 'ANULADA').slice().sort((a, b) => orden(a) < orden(b) ? -1 : 1);
        const mapa = new Map();   // centro|clave → {centro, nombre, codigo, pendiente, desde}
        const clave = (c, it) => norm(c) + '|' + (it.codigo ? 'c:' + String(it.codigo).replace(/\D/g, '') : 'n:' + norm(it.nombre));
        const fijar = (centro, it, valor, acta) => {
            const k = clave(centro, it), p = mapa.get(k) || { centro, nombre: it.nombre, codigo: it.codigo ? String(it.codigo) : '', pendiente: 0, desde: acta.numero };
            if (!p.codigo && it.codigo) p.codigo = String(it.codigo);
            if (valor > 0 && !(p.pendiente > 0)) p.desde = acta.numero;
            p.pendiente = Math.max(0, valor); p.ultima = acta.numero; mapa.set(k, p);
        };
        lista.forEach(a => {
            const centro = String(a.centro || '').trim(); if (!centro) return;
            (a.items || []).forEach(i => {
                const it = { nombre: i.nombre, codigo: i.codigoMP || '' }, ant = mapa.get(clave(centro, it));
                if (num(i.solicitado) > 0) fijar(centro, it, num(i.solicitado) - num(i.entregadoTotal != null ? i.entregadoTotal : i.cantidad), a);
                else if (ant) fijar(centro, it, ant.pendiente - num(i.cantidad), a);
            });
            (a.pendientes || []).forEach(p => { if (p && p.nombre && num(p.cantidad) > 0) fijar(centro, { nombre: p.nombre, codigo: '' }, num(p.cantidad), a); });
        });
        const porCentro = new Map();
        [...mapa.values()].filter(p => p.pendiente > 0).forEach(p => { if (!porCentro.has(p.centro)) porCentro.set(p.centro, []); porCentro.get(p.centro).push(p); });
        return [...porCentro.entries()].map(([centro, items]) => ({ centro, items })).sort((a, b) => a.centro.localeCompare(b.centro, 'es'));
    }

    /** Cruza cada pendiente con el stock (por ID o por nombre, usando el catálogo para traducir descripciones). */
    function cruzarStock(grupos, insumos, catalogo) {
        const porCod = new Map(), porNom = new Map();
        (insumos || []).forEach(x => {
            if (x.status === 'CUARENTENA') return;
            const q = Math.max(0, num(x.quantity) - num(x.sobregiro)), c = String(x.codigoMP || '').replace(/\D/g, '');
            if (c) porCod.set(c, (porCod.get(c) || 0) + q);
            const n = norm(x.name); porNom.set(n, (porNom.get(n) || 0) + q);
        });
        const cat = new Map(); (catalogo || []).forEach(c => { cat.set(norm(c.descripcion), c); });
        grupos.forEach(g => g.items.forEach(p => {
            let disp = 0; const c = String(p.codigo || '').replace(/\D/g, '');
            if (c && porCod.has(c)) disp = porCod.get(c);
            else {
                const ce = cat.get(norm(p.nombre));
                if (ce && ce.codigoMP && porCod.has(String(ce.codigoMP).replace(/\D/g, ''))) disp = porCod.get(String(ce.codigoMP).replace(/\D/g, ''));
                else if (ce && ce.insumoName && porNom.has(norm(ce.insumoName))) disp = porNom.get(norm(ce.insumoName));
                else if (porNom.has(norm(p.nombre))) disp = porNom.get(norm(p.nombre));
            }
            p.disponible = disp; p.entregable = Math.min(p.pendiente, disp);
        }));
        grupos.forEach(g => { g.listos = g.items.filter(p => p.entregable > 0).length; });
        return grupos;
    }

    let grupos = [], cargado = false;
    async function traer() {
        const f = fs();
        const [sa, si, sc] = await Promise.all([
            f.getDocs(f.query(f.collection(db(), 'Actas_Entrega'), f.orderBy('creadoEn', 'desc'), f.limit(600))),
            f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(3000))),
            f.getDocs(f.query(f.collection(db(), 'Catalogo_Productos'), f.limit(3000))).catch(() => null)
        ]);
        const actas = [], ins = [], cat = [];
        sa.forEach(d => actas.push({ id: d.id, ...d.data() })); si.forEach(d => ins.push(d.data())); if (sc) sc.forEach(d => cat.push(d.data()));
        grupos = cruzarStock(calcularPendientes(actas), ins, cat); cargado = true;
        pintarCampana();
        return grupos;
    }

    // ---------------- Pantalla ----------------
    const abiertos = new Set();
    const resumen = (g) => g.listos
        ? `<span class="pen-ok">Hay stock para entregar ${g.listos} de ${g.items.length}</span>`
        : '<span class="pen-sin">Sin stock por ahora</span>';
    function filas(g) {
        return `<div class="soc-tabla"><table><thead><tr><th>Producto</th><th>Pendiente</th><th>Disponible</th><th>Estado</th></tr></thead><tbody>
            ${g.items.map(p => `<tr><td>${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(p.nombre, { codigo: p.codigo }) : ''}${esc(p.nombre)}${p.codigo ? ` <small class="soc-id">ID ${esc(p.codigo)}</small>` : ''}</td>
                <td><strong>${p.pendiente}</strong></td><td>${p.disponible}</td>
                <td>${p.entregable >= p.pendiente ? '<span class="pen-ok">Completo</span>' : p.entregable > 0 ? `<span class="pen-parcial">Se pueden ${p.entregable}</span>` : '<span class="pen-sin">Sin stock</span>'}</td></tr>`).join('')}
            </tbody></table></div>`;
    }
    function pintar() {
        const r = root(); if (!r) return;
        const total = grupos.reduce((s, g) => s + g.items.length, 0), listos = grupos.reduce((s, g) => s + g.listos, 0);
        r.innerHTML = `<div class="erp-card pen-cab"><div class="pen-grupo__cab"><div><h3>Pendientes por entregar</h3>
            <p class="act-hint">${total ? `<b>${grupos.length}</b> centro(s) · <b>${total}</b> producto(s) pendiente(s) · <b>${listos}</b> con stock para entregar ahora.` : 'Lo que cada centro pidió y aún no se le entrega, según las actas.'}</p></div>
            <div class="pen-acc"><button type="button" class="btn btn-outline btn-sm" id="pen-recargar"><i class="ph-bold ph-arrows-clockwise"></i> Actualizar</button>
            ${grupos.length ? '<button type="button" class="btn btn-primary btn-sm" id="pen-imp-todo"><i class="ph-bold ph-printer"></i> Imprimir listado con fotos</button>' : ''}</div></div></div>
            ${grupos.length ? `<div class="erp-card pen-lista">${grupos.map((g, gi) => `<details class="pen-centro" data-gi="${gi}"${abiertos.has(g.centro) ? ' open' : ''}><summary>
                <strong>${esc(g.centro)}</strong><span class="soc-n">${g.items.length}</span><span class="pen-res">${resumen(g)}</span></summary>
                <div class="pen-det"><div class="pen-acc"><button type="button" class="btn btn-outline btn-sm" data-pen-imp="${gi}"><i class="ph-bold ph-printer"></i> Imprimir este centro</button></div>${filas(g)}</div></details>`).join('')}</div>`
            : '<div class="erp-card"><p class="act-hint">No hay pendientes por entregar. Cuando en un acta pongas un pedido mayor a lo que entregas (o agregues pendientes), aparecen aquí.</p></div>'}`;
        r.querySelector('#pen-recargar').addEventListener('click', abrir);
        const bt = r.querySelector('#pen-imp-todo'); if (bt) bt.addEventListener('click', () => imprimir(grupos));
        r.querySelectorAll('[data-pen-imp]').forEach(b => b.addEventListener('click', () => imprimir([grupos[+b.dataset.penImp]])));
        r.querySelectorAll('.pen-centro').forEach(d => d.addEventListener('toggle', () => { const g = grupos[+d.dataset.gi]; if (!g) return; if (d.open) abiertos.add(g.centro); else abiertos.delete(g.centro); if (d.open && window.SAR_Imagenes) window.SAR_Imagenes.rellenar(d); }));
    }

    /** Listado imprimible (con fotos) de lo que falta por entregar: una hoja por centro. */
    function imprimir(lista) {
        const w = window.open('', '_blank'); if (!w) { toast('Ventana bloqueada', 'Permite las ventanas emergentes para imprimir el listado.', 'warning'); return; }
        const IM = window.SAR_Imagenes, hoy = new Date().toLocaleDateString('es-CL');
        const logo = new URL('assets/logo-corpo-melipilla.jpg', window.location.href).href;
        const foto = (p) => { try { const e = IM && IM.buscar(p.nombre, p.codigo); const s = e && IM.src(e, 160); return s ? `<img src="${esc(s)}" alt="" referrerpolicy="no-referrer">` : '<span class="sf">sin foto</span>'; } catch (e) { return '<span class="sf">sin foto</span>'; } };
        const hojas = lista.filter(Boolean).map(g => `<section><header><img class="lg" src="${esc(logo)}" alt=""><div><h1>Productos pendientes de entrega</h1><h2>${esc(g.centro)}</h2><p>SAR Elsa Romo Arpillerista · ${esc(hoy)}</p></div></header>
            <table><thead><tr><th>Foto</th><th>Producto</th><th>ID</th><th class="n">Pendiente</th><th class="n">Disponible</th></tr></thead><tbody>
            ${g.items.map(p => `<tr><td class="f">${foto(p)}</td><td>${esc(p.nombre)}</td><td>${esc(p.codigo || '')}</td><td class="n"><b>${p.pendiente}</b></td><td class="n">${p.disponible}</td></tr>`).join('')}</tbody></table>
            <p class="pie">${g.items.length} producto(s) pendiente(s).</p></section>`).join('');
        w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Pendientes por entregar</title><style>
            body{font:13px/1.35 Arial,sans-serif;color:#111;margin:0;padding:18px}section{page-break-after:always}section:last-child{page-break-after:auto}
            header{display:flex;gap:14px;align-items:center;border-bottom:2px solid #1a3668;padding-bottom:8px;margin-bottom:10px}.lg{height:54px;width:auto}
            h1{font-size:17px;margin:0}h2{font-size:15px;margin:2px 0;color:#1a3668}header p{margin:0;color:#555}
            table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:middle}th{background:#eef1f6;font-size:12px}
            .n{text-align:right;white-space:nowrap}.f{width:84px}.f img{width:76px;height:76px;object-fit:contain}.sf{color:#999;font-size:11px}tr{page-break-inside:avoid}.pie{margin-top:8px;color:#555}
            @media print{body{padding:0}}</style></head><body>${hojas}<script>window.onload=function(){setTimeout(function(){window.print()},700)}<\/script></body></html>`);
        w.document.close();
    }
    async function abrir() {
        const r = root(); if (!r) return;
        r.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Revisando los pendientes y el stock…') : 'Cargando…';
        try { await traer(); pintar(); } catch (e) { r.innerHTML = `<p class="act-err" style="padding:24px;">No se pudieron cargar los pendientes: ${esc(e.message || e)}</p>`; }
    }

    // ---------------- Campana de notificaciones ----------------
    function pintarCampana() {
        const b = document.getElementById('btn-notificaciones'); if (!b) return;
        const n = grupos.reduce((s, g) => s + g.listos, 0);
        let ins = b.querySelector('.noti-n'); if (!ins) { ins = document.createElement('span'); ins.className = 'noti-n'; b.appendChild(ins); }
        ins.textContent = n > 9 ? '9+' : String(n); ins.style.display = n ? '' : 'none';
        b.title = n ? `${n} producto(s) pendientes ya tienen stock para entregar` : 'Notificaciones';
    }
    function abrirPanel() {
        let p = document.getElementById('noti-panel'); if (p) { p.remove(); return; }
        p = document.createElement('div'); p.id = 'noti-panel'; p.className = 'noti-panel';
        const con = grupos.filter(g => g.listos);
        p.innerHTML = `<strong>Notificaciones</strong>${con.length ? con.map(g => `<div class="noti-it"><b>${esc(g.centro)}</b>: hay stock para entregar ${g.listos} de ${g.items.length} producto(s) pendiente(s)
            <small>${g.items.filter(x => x.entregable > 0).slice(0, 3).map(x => esc(x.nombre.slice(0, 40)) + ' (' + x.entregable + ')').join(' · ')}</small></div>`).join('') : '<p class="act-hint">Sin avisos por ahora.</p>'}
            <button type="button" class="btn btn-outline btn-sm" id="noti-ir">Ver pendientes por entregar</button>`;
        document.body.appendChild(p);
        p.querySelector('#noti-ir').addEventListener('click', () => { p.remove(); window.location.hash = 'view-pendientes-entrega'; });
        setTimeout(() => document.addEventListener('click', function cerrar(e) { if (!p.contains(e.target) && !e.target.closest('#btn-notificaciones')) { p.remove(); document.removeEventListener('click', cerrar); } }), 0);
    }
    function iniciar() {
        const b = document.getElementById('btn-notificaciones'); if (b) b.addEventListener('click', () => { if (!cargado) traer().then(abrirPanel).catch(() => abrirPanel()); else abrirPanel(); });
        const ok = () => ['admin', 'administrador', 'global', 'superadmin', 'operador'].includes(rol()) && window.firebaseDb && window.firebaseAuth && window.firebaseAuth.currentUser;
        const ciclo = () => { if (ok()) traer().catch(() => { /* sin aviso */ }); };
        setTimeout(ciclo, 8000); setInterval(ciclo, 10 * 60 * 1000);
    }
    if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar(); }

    window.SAR_Pendientes = { abrir, calcularPendientes, cruzarStock, refrescar: () => traer().catch(() => {}) };
    if (typeof module !== 'undefined') module.exports = window.SAR_Pendientes;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: { dataset: {} } });
