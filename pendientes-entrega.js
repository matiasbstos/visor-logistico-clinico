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
        const kc = (c, it) => it.codigo && String(it.codigo).replace(/\D/g, '') ? norm(c) + '|c:' + String(it.codigo).replace(/\D/g, '') : '', kn = (c, it) => norm(c) + '|n:' + norm(it.nombre);
        // Un mismo producto puede figurar primero solo por nombre y después con su ID (o al revés): se busca por ambas claves para que no queden pendientes duplicados ni "fantasma".
        const buscar = (c, it) => (kc(c, it) && mapa.get(kc(c, it))) || mapa.get(kn(c, it));
        const fijar = (centro, it, valor, acta) => {
            const p = buscar(centro, it) || { centro, nombre: it.nombre, codigo: it.codigo ? String(it.codigo) : '', pendiente: 0, desde: acta.numero };
            if (!p.codigo && it.codigo) p.codigo = String(it.codigo);
            if (valor > 0 && !(p.pendiente > 0)) p.desde = acta.numero;
            p.pendiente = Math.max(0, valor); p.ultima = acta.numero;
            mapa.set(kn(centro, it), p); if (kc(centro, it)) mapa.set(kc(centro, it), p);
        };
        lista.forEach(a => {
            const centro = String(a.centro || '').trim(); if (!centro) return;
            (a.items || []).forEach(i => {
                const it = { nombre: i.nombre, codigo: i.codigoMP || '' }, ant = buscar(centro, it);
                if (num(i.solicitado) > 0) fijar(centro, it, num(i.solicitado) - num(i.entregadoTotal != null ? i.entregadoTotal : i.cantidad), a);
                else if (ant) fijar(centro, it, ant.pendiente - num(i.cantidad), a);
            });
            (a.pendientes || []).forEach(p => { if (p && p.nombre && num(p.cantidad) > 0) fijar(centro, { nombre: p.nombre, codigo: p.codigoMP || '' }, num(p.cantidad), a); });
        });
        const porCentro = new Map();
        [...new Set(mapa.values())].filter(p => p.pendiente > 0).forEach(p => { if (!porCentro.has(p.centro)) porCentro.set(p.centro, []); porCentro.get(p.centro).push(p); });
        return [...porCentro.entries()].map(([centro, items]) => ({ centro, items })).sort((a, b) => a.centro.localeCompare(b.centro, 'es'));
    }

    /** Órdenes abiertas con mercadería por recibir de SAR (parcial = ya llegó algo y falta el resto). */
    function calcularPorRecibir(ocs, centro) {
        centro = centro || 'SAR';
        return (ocs || []).filter(o => o && !o.cerrada).map(oc => {
            const lineas = []; let recibido = 0, pendiente = 0;
            (oc.columnas || []).filter(c => c.centro === centro).forEach(c => (oc.lineas || []).forEach(l => {
                const p = num(l.dist && l.dist[c.key]), r = num(l.recibido && l.recibido[c.key]); if (!p) return;
                recibido += r; if (p > r) { pendiente += p - r; lineas.push({ producto: l.descripcion, codigoMP: l.codigoMP || '', pedido: p, recibido: r, pendiente: p - r }); }
            }));
            return { ocId: oc.id, numeroOC: oc.numeroOC, proveedor: oc.proveedor || '', recibido, pendiente, parcial: recibido > 0, lineas };
        }).filter(o => o.pendiente > 0).sort((a, b) => String(a.numeroOC).localeCompare(String(b.numeroOC)));
    }

    /** Cruza cada pendiente con el stock (por ID o por nombre, usando el catálogo para traducir descripciones)
     *  y anota dónde está (bodega y estante) y el lote que vence primero. */
    function cruzarStock(grupos, insumos, catalogo, asign, bodegas) {
        const porCod = new Map(), porNom = new Map(), push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
        (insumos || []).forEach(x => {
            if (x.status === 'CUARENTENA') return;
            const c = String(x.codigoMP || '').replace(/\D/g, ''); if (c) push(porCod, c, x); push(porNom, norm(x.name), x);
        });
        const cat = new Map(); (catalogo || []).forEach(c => { cat.set(norm(c.descripcion), c); });
        const avail = (x) => Math.max(0, num(x.quantity) - num(x.sobregiro));
        const idBodega = new Map((bodegas || []).map(b => [b.name, b.id]));
        grupos.forEach(g => g.items.forEach(p => {
            let docs = []; const c = String(p.codigo || '').replace(/\D/g, ''), ce = cat.get(norm(p.nombre)), cc = ce && ce.codigoMP ? String(ce.codigoMP).replace(/\D/g, '') : '';
            if (c && porCod.has(c)) docs = porCod.get(c);
            else if (cc && porCod.has(cc)) docs = porCod.get(cc);
            else if (ce && ce.insumoName && porNom.has(norm(ce.insumoName))) docs = porNom.get(norm(ce.insumoName));
            else if (porNom.has(norm(p.nombre))) docs = porNom.get(norm(p.nombre));
            p.disponible = docs.reduce((t, x) => t + avail(x), 0); p.entregable = Math.min(p.pendiente, p.disponible);
            p.donde = docs.filter(x => avail(x) > 0).map(x => {
                const bid = idBodega.get(x.location), ub = (asign || []).filter(a => a.bodegaId === bid && norm(a.insumoName) === norm(x.name) && num(a.cantidad) > 0).map(a => a.codigo);
                return { bodega: x.location || 'Sin bodega', cantidad: avail(x), ubicaciones: ub };
            });
            const lotes = []; docs.forEach(x => (x.batches || []).forEach(b => { if (num(b.quantity) > 0) lotes.push(b); }));
            lotes.sort((a, b) => String(a.expirationDate || '9999').localeCompare(String(b.expirationDate || '9999')));
            p.lote = lotes[0] ? { batch: lotes[0].batch || '', vence: lotes[0].expirationDate || '' } : null;
        }));
        grupos.forEach(g => { g.listos = g.items.filter(p => p.entregable > 0).length; });
        return grupos;
    }

    let grupos = [], cargado = false, catalogoDocs = [], porRecibir = [];
    async function traer() {
        const f = fs();
        const [sa, si, sc, sb, sg, so] = await Promise.all([
            f.getDocs(f.query(f.collection(db(), 'Actas_Entrega'), f.orderBy('creadoEn', 'desc'), f.limit(600))),
            f.getDocs(f.query(f.collection(db(), 'Insumos'), f.limit(3000))),
            f.getDocs(f.query(f.collection(db(), 'Catalogo_Productos'), f.limit(3000))).catch(() => null),
            f.getDocs(f.query(f.collection(db(), 'Bodegas'), f.limit(100))).catch(() => null),
            f.getDocs(f.query(f.collection(db(), 'Asignaciones_Ubicacion'), f.limit(3000))).catch(() => null),
            f.getDocs(f.query(f.collection(db(), 'Seguimiento_OC'), f.limit(400))).catch(() => null)
        ]);
        { const ocs = []; if (so) so.forEach(d => ocs.push({ id: d.id, ...d.data() })); porRecibir = calcularPorRecibir(ocs); }
        const actas = [], ins = [], cat = [], bod = [], asg = [];
        sa.forEach(d => actas.push({ id: d.id, ...d.data() })); si.forEach(d => ins.push(d.data())); if (sc) sc.forEach(d => cat.push({ id: d.id, ...d.data() }));
        if (sb) sb.forEach(d => bod.push({ id: d.id, ...d.data() })); if (sg) sg.forEach(d => asg.push(d.data()));
        catalogoDocs = cat; grupos = cruzarStock(calcularPendientes(actas), ins, cat, asg, bod); cargado = true;
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
            ${grupos.length ? '<button type="button" class="btn btn-outline btn-sm" id="pen-fotos"><i class="ph-bold ph-images"></i> Buscar fotos que faltan</button><button type="button" class="btn btn-outline btn-sm" id="pen-imp-todo"><i class="ph-bold ph-printer"></i> Imprimir pendientes</button><button type="button" class="btn btn-primary btn-sm" id="pen-pick-todo"><i class="ph-bold ph-clipboard-text"></i> Hoja de picking (todos)</button>' : ''}</div></div></div>
            ${grupos.length ? `<div class="erp-card pen-lista">${grupos.map((g, gi) => `<details class="pen-centro" data-gi="${gi}"${abiertos.has(g.centro) ? ' open' : ''}><summary>
                <strong>${esc(g.centro)}</strong><span class="soc-n">${g.items.length}</span><span class="pen-res">${resumen(g)}</span></summary>
                <div class="pen-det"><div class="pen-acc"><button type="button" class="btn btn-primary btn-sm" data-pen-pick="${gi}"${g.listos ? '' : ' disabled'}><i class="ph-bold ph-clipboard-text"></i> Hoja de picking</button><button type="button" class="btn btn-outline btn-sm" data-pen-imp="${gi}"><i class="ph-bold ph-printer"></i> Imprimir pendientes</button></div>${filas(g)}</div></details>`).join('')}</div>`
            : '<div class="erp-card"><p class="act-hint">No hay pendientes por entregar. Cuando en un acta pongas un pedido mayor a lo que entregas (o agregues pendientes), aparecen aquí.</p></div>'}`;
        r.querySelector('#pen-recargar').addEventListener('click', abrir);
        const bt = r.querySelector('#pen-imp-todo'); if (bt) bt.addEventListener('click', () => imprimir(grupos));
        const bp = r.querySelector('#pen-pick-todo'); if (bp) bp.addEventListener('click', () => picking(grupos.filter(g => g.listos)));
        const bf = r.querySelector('#pen-fotos'); if (bf) bf.addEventListener('click', buscarFotos);
        r.querySelectorAll('[data-pen-pick]').forEach(b => b.addEventListener('click', () => picking([grupos[+b.dataset.penPick]])));
        r.querySelectorAll('[data-pen-imp]').forEach(b => b.addEventListener('click', () => imprimir([grupos[+b.dataset.penImp]])));
        r.querySelectorAll('.pen-centro').forEach(d => d.addEventListener('toggle', () => { const g = grupos[+d.dataset.gi]; if (!g) return; if (d.open) abiertos.add(g.centro); else abiertos.delete(g.centro); if (d.open && window.SAR_Imagenes) window.SAR_Imagenes.rellenar(d); }));
    }

    /** Listado imprimible (con fotos) de lo que falta por entregar: una hoja por centro. */
    function imprimir(lista) {
        const IM = window.SAR_Imagenes, hoy = new Date().toLocaleDateString('es-CL');
        const logo = new URL('assets/logo-corpo-melipilla.jpg', window.location.href).href;
        const foto = (p) => { try { const e = IM && (IM.buscarConCandidata ? IM.buscarConCandidata(p.nombre, p.codigo) : IM.buscar(p.nombre, p.codigo)); const s = e && IM.src(e, 160); return s ? `<img src="${esc(s)}" alt="" referrerpolicy="no-referrer">` : '<span class="sf">sin foto</span>'; } catch (e) { return '<span class="sf">sin foto</span>'; } };
        const hojas = (lista || []).filter(Boolean).map(g => `<section><header><img class="lg" src="${esc(logo)}" alt=""><div><h1>Productos pendientes de entrega</h1><h2>${esc(g.centro)}</h2><p>SAR Elsa Romo Arpillerista · ${esc(hoy)}</p></div></header>
            <table><thead><tr><th>Foto</th><th>Producto</th><th>ID</th><th class="n">Pendiente</th><th class="n">Disponible</th></tr></thead><tbody>
            ${g.items.map(p => `<tr><td class="f">${foto(p)}</td><td>${esc(p.nombre)}</td><td>${esc(p.codigo || '')}</td><td class="n"><b>${p.pendiente}</b></td><td class="n">${p.disponible}</td></tr>`).join('')}</tbody></table>
            <p class="pie">${g.items.length} producto(s) pendiente(s).</p></section>`).join('');
        ventana('Pendientes por entregar', hojas);
    }
    const CSS_DOC = `body{font:12px/1.25 Arial,sans-serif;color:#111;margin:0;padding:10px}section{margin:0 0 16px;padding-bottom:6px;border-bottom:1px dashed #aaa}section:last-child{border-bottom:0}
        header{display:flex;gap:10px;align-items:center;border-bottom:2px solid #1a3668;padding-bottom:4px;margin-bottom:6px;page-break-after:avoid;break-after:avoid}.lg{height:38px;width:auto}
        h1{font-size:15px;margin:0}h2{font-size:14px;margin:1px 0;color:#1a3668}h3{font-size:12px;margin:8px 0 3px;page-break-after:avoid}header p{margin:0;color:#555}
        table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:2px 5px;text-align:left;vertical-align:middle}th{background:#eef1f6;font-size:12px}
        .n{text-align:right;white-space:nowrap}.f{width:54px}.f img{width:48px;height:48px;object-fit:contain}.sf{color:#999;font-size:11px}tr{page-break-inside:avoid}.pie{margin:4px 0 0;color:#555;font-size:12px}
        .ck{width:26px}.ck i{display:inline-block;width:18px;height:18px;border:2px solid #333;border-radius:3px}.big{font-size:17px;font-weight:700}small{color:#555}
        .pk h1{font-size:24px}.pk h2{font-size:22px}.pk header p{font-size:15px}.pk .lg{height:54px}.pk th{font-size:15px;padding:6px 8px}.pk td{font-size:19px;font-weight:600;padding:8px 8px;border-bottom:2px solid #bbb}
        .pk td small{font-size:14px;font-weight:400}.pk .f{width:132px}.pk .f img{width:120px;height:120px}.pk .ck{width:44px}.pk .ck i{width:34px;height:34px;border-width:3px}.pk .big{font-size:46px;line-height:1}.pk .pie{font-size:16px;font-weight:700}
        @page{margin:10mm}@media print{body{padding:0}}`;
    function ventana(titulo, cuerpo) {
        const w = window.open('', '_blank'); if (!w) { toast('Ventana bloqueada', 'Permite las ventanas emergentes para imprimir.', 'warning'); return; }
        w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS_DOC}</style></head><body>${cuerpo}<script>window.onload=function(){setTimeout(function(){window.print()},700)}<\/script></body></html>`);
        w.document.close();
    }
    /** Hoja de picking: qué retirar de la bodega para cada centro, con foto, dónde está, lote y cantidad. */
    function picking(lista) {
        const IM = window.SAR_Imagenes, hoy = new Date().toLocaleDateString('es-CL');
        const logo = new URL('assets/logo-corpo-melipilla.jpg', window.location.href).href;
        const foto = (p) => { try { const e = IM && (IM.buscarConCandidata ? IM.buscarConCandidata(p.nombre, p.codigo) : IM.buscar(p.nombre, p.codigo)); const s = e && IM.src(e, 160); return s ? `<img src="${esc(s)}" alt="" referrerpolicy="no-referrer">` : '<span class="sf">sin foto</span>'; } catch (e) { return '<span class="sf">sin foto</span>'; } };
        const dondeTxt = (p) => (p.donde || []).map(d => `${esc(d.bodega)}${d.ubicaciones && d.ubicaciones.length ? ' · <b>' + esc(d.ubicaciones.join(', ')) + '</b>' : ''} <small>(${d.cantidad})</small>`).join('<br>') || '—';
        const venceTxt = (p) => p.lote ? `${esc(p.lote.batch || 's/lote')}${p.lote.vence ? '<br><small>vence ' + esc(p.lote.vence) + '</small>' : ''}` : '—';
        const hojas = (lista || []).filter(Boolean).map(g => {
            const si = g.items.filter(p => p.entregable > 0), no = g.items.filter(p => !(p.entregable > 0));
            return `<section class="pk"><header><img class="lg" src="${esc(logo)}" alt=""><div><h1>Hoja de picking · retirar de bodega</h1><h2>Para: ${esc(g.centro)}</h2><p>SAR Elsa Romo Arpillerista · ${esc(hoy)}</p></div></header>
            <table><thead><tr><th class="ck"></th><th>Foto</th><th>Producto</th><th>Dónde está</th><th>Lote (vence primero)</th><th class="n">Retirar</th><th class="n">Pendiente</th></tr></thead><tbody>
            ${si.map(p => `<tr><td class="ck"><i></i></td><td class="f">${foto(p)}</td><td>${esc(p.nombre)}${p.codigo ? '<br><small>ID ' + esc(p.codigo) + '</small>' : ''}</td><td>${dondeTxt(p)}</td><td>${venceTxt(p)}</td><td class="n big">${p.entregable}</td><td class="n">${p.pendiente}</td></tr>`).join('')}</tbody></table>
            <p class="pie">${si.length} producto(s) para retirar.</p>
            ${no.length ? `<h3>Pendientes sin stock (no hay que retirar)</h3><table><tbody>${no.map(p => `<tr><td>${esc(p.nombre)}</td><td class="n">pendiente ${p.pendiente}</td></tr>`).join('')}</tbody></table>` : ''}</section>`;
        }).join('');
        ventana('Hoja de picking', hojas);
    }
    /** Hoja de picking de un acta ya emitida: qué se retiró (o se retira) de la bodega, con foto, lote(s) y cantidad. */
    function pickingActa(a) {
        if (!a || !(a.items || []).length) { toast('Hoja de picking', 'El acta no tiene productos.', 'warning'); return; }
        const IM = window.SAR_Imagenes, logo = new URL('assets/logo-corpo-melipilla.jpg', window.location.href).href;
        const foto = (i) => { try { const e = IM && (IM.buscarConCandidata ? IM.buscarConCandidata(i.nombre, i.codigoMP) : IM.buscar(i.nombre, i.codigoMP)); const s = e && IM.src(e, 160); return s ? `<img src="${esc(s)}" alt="" referrerpolicy="no-referrer">` : '<span class="sf">sin foto</span>'; } catch (e) { return '<span class="sf">sin foto</span>'; } };
        const lotes = (i) => (i.lotes || []).length ? i.lotes.map(l => `${esc(l.batch || 's/lote')}${l.expirationDate ? ' <small>vence ' + esc(l.expirationDate) + '</small>' : ''} <small>(${num(l.quantity)})</small>`).join('<br>') : '—';
        const filas = a.items.filter(i => num(i.cantidad) > 0);
        const total = filas.reduce((t, i) => t + num(i.cantidad), 0);
        const cuerpo = `<section class="pk"><header><img class="lg" src="${esc(logo)}" alt=""><div><h1>Hoja de picking · ${esc(a.numero || '')}</h1><h2>Para: ${esc(a.centro || '')}</h2><p>SAR Elsa Romo Arpillerista · retirar de ${esc(a.bodegaOrigen || 'bodega')} · acta del ${esc(a.fecha || '')}${a.estado === 'ANULADA' ? ' · <b>ANULADA</b>' : ''}</p></div></header>
            <table><thead><tr><th class="ck"></th><th>Foto</th><th>Producto</th><th>Lote (vence primero)</th><th class="n">Retirar</th></tr></thead><tbody>
            ${filas.map(i => `<tr><td class="ck"><i></i></td><td class="f">${foto(i)}</td><td>${esc(i.nombre)}${i.codigoMP ? '<br><small>ID ' + esc(i.codigoMP) + '</small>' : ''}</td><td>${lotes(i)}</td><td class="n big">${num(i.cantidad)}</td></tr>`).join('')}</tbody></table>
            <p class="pie">${filas.length} producto(s) · ${total} unidad(es) en total.</p></section>`;
        ventana('Hoja de picking ' + (a.numero || ''), cuerpo);
    }
    /** Busca las fotos de los productos pendientes que aún no tienen (por ID o por descripción) y las deja "por confirmar". */
    async function buscarFotos() {
        const IM = window.SAR_Imagenes, f = fs(); if (!IM) return;
        const vistos = new Set(), faltan = [];
        grupos.forEach(g => g.items.forEach(p => { const k = (p.codigo ? 'c' + p.codigo : 'n' + norm(p.nombre)); if (vistos.has(k)) return; vistos.add(k); const e = IM.buscarConCandidata ? IM.buscarConCandidata(p.nombre, p.codigo) : IM.buscar(p.nombre, p.codigo); if (!e) faltan.push(p); }));
        if (!faltan.length) { toast('Fotos', 'Todos los productos pendientes ya tienen foto.', 'success'); return; }
        let cfg = null; try { const sn = await f.getDoc(f.doc(f.collection(db(), 'Config_Correo'), 'principal')); cfg = sn.exists() ? sn.data() : null; } catch (e) { /* sin config */ }
        if (!(cfg && cfg.webhookUrl && cfg.token)) { toast('Falta el script', 'Configura el script en Seguimiento de OC → Configurar correo para buscar fotos.', 'warning'); return; }
        const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
        let n = 0, ok = 0;
        try {
            await window.SAR_Progreso.correr('Buscando las fotos que faltan…', async (prog) => {
                prog.paso(`${faltan.length} producto(s) sin foto`);
                for (const p of faltan) {
                    n++; let r = null;
                    try { r = p.codigo ? await IM.buscarFoto(p.codigo, cfg) : await IM.buscarPorDescripcion(p.nombre, cfg); } catch (e) { r = null; }
                    if (r && r.archivo) {
                        const prev = catalogoDocs.find(c => (p.codigo && String(c.codigoMP || '') === String(p.codigo)) || norm(c.descripcion) === norm(p.nombre));
                        const id = prev ? prev.id : slug(p.codigo || p.nombre) || 'pendiente';
                        try { await f.setDoc(f.doc(f.collection(db(), 'Catalogo_Productos'), id), { descripcion: p.nombre, descripcion_lower: String(p.nombre).toLowerCase(), codigoMP: p.codigo || '', imagenMP: r.archivo, fotoEstado: (r.origen === 'semilla') ? 'confirmada' : 'por_confirmar', ...(r.titulo ? { fotoTitulo: r.titulo } : {}), actualizado: f.serverTimestamp() }, { merge: true }); ok++; } catch (e) { r = null; }
                    }
                    prog.paso(`${n} de ${faltan.length} · ${String(p.nombre).slice(0, 55)}… → ${r && r.archivo ? '✔ foto encontrada (por confirmar)' : '✖ sin foto'}`);
                }
                await IM.recargar();
            }, 'Búsqueda terminada');
            toast(ok ? 'Fotos encontradas' : 'Sin coincidencias', ok ? `${ok} de ${faltan.length} con foto nueva: confírmalas en Catálogo de productos.` : 'No hubo coincidencias claras: sube la foto a mano en el Catálogo de productos.', ok ? 'success' : 'warning');
        } catch (e) { toast('No se pudo buscar', e.message || String(e), 'error'); }
        pintar();
    }
    async function abrir() {
        const r = root(); if (!r) return;
        r.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Revisando los pendientes y el stock…') : 'Cargando…';
        try { await traer(); pintar(); } catch (e) { r.innerHTML = `<p class="act-err" style="padding:24px;">No se pudieron cargar los pendientes: ${esc(e.message || e)}</p>`; }
    }

    // ---------------- Campana de notificaciones ----------------
    function pintarCampana() {
        const b = document.getElementById('btn-notificaciones'); if (!b) return;
        const extra = window.SAR_AvisosCampana ? window.SAR_AvisosCampana.datosActuales() : { total: 0 };
        const n = grupos.reduce((s, g) => s + g.listos, 0) + porRecibir.filter(o => o.parcial).length + extra.total;
        let ins = b.querySelector('.noti-n'); if (!ins) { ins = document.createElement('span'); ins.className = 'noti-n'; b.appendChild(ins); }
        ins.textContent = n > 9 ? '9+' : String(n); ins.style.display = n ? '' : 'none';
        const antes = Number(b.dataset.n || 0); b.dataset.n = String(n); b.classList.toggle('noti-activa', n > 0);
        if (n > antes && antes >= 0 && b.dataset.visto) { b.classList.remove('noti-vibra'); void b.offsetWidth; b.classList.add('noti-vibra'); try { if (window.SAR_Sonidos) window.SAR_Sonidos.tocar('notificacion'); } catch (e) { /* sin sonido */ } }
        b.dataset.visto = '1';
        b.title = n ? `${n} aviso(s) por revisar: entregas, recepciones, vencimientos, stock bajo y préstamos` : 'Notificaciones';
    }
    function abrirPanel() {
        let p = document.getElementById('noti-panel'); if (p) { p.remove(); return; }
        p = document.createElement('div'); p.id = 'noti-panel'; p.className = 'noti-panel';
        const con = grupos.filter(g => g.listos);
        const parc = porRecibir.filter(o => o.parcial);
        const bloqueRec = parc.length ? `<div class="noti-sec"><b>Por recibir (recepción parcial)</b>${parc.map(o => `<div class="noti-it"><b>OC ${esc(o.numeroOC)}</b> · ${esc(o.proveedor)}: faltan ${o.pendiente} un. (${o.lineas.length} producto(s))<small>${o.lineas.slice(0, 3).map(x => esc(String(x.producto).slice(0, 40)) + ' (' + x.pendiente + ')').join(' · ')}</small></div>`).join('')}</div>` : '';
        const ext = window.SAR_AvisosCampana ? window.SAR_AvisosCampana.html(window.SAR_AvisosCampana.datosActuales()) : '';
        p.innerHTML = `<strong class="noti-tit"><i class="ph-fill ph-bell-ringing"></i> Avisos</strong>${ext}${bloqueRec}${con.length ? con.map(g => `<div class="noti-it"><b>${esc(g.centro)}</b>: hay stock para entregar ${g.listos} de ${g.items.length} producto(s) pendiente(s)
            <small>${g.items.filter(x => x.entregable > 0).slice(0, 3).map(x => esc(x.nombre.slice(0, 40)) + ' (' + x.entregable + ')').join(' · ')}</small></div>`).join('') : (parc.length ? '' : '<p class="act-hint">Sin avisos por ahora.</p>')}
            <button type="button" class="btn btn-outline btn-sm" id="noti-ir">Ver pendientes por entregar</button>`;
        document.body.appendChild(p);
        p.querySelector('#noti-ir').addEventListener('click', () => { p.remove(); window.location.hash = 'view-pendientes-entrega'; });
        p.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => { const v = b.dataset.ir; p.remove(); window.location.hash = v; }));
        setTimeout(() => document.addEventListener('click', function cerrar(e) { if (!p.contains(e.target) && !e.target.closest('#btn-notificaciones')) { p.remove(); document.removeEventListener('click', cerrar); } }), 0);
    }
    function iniciar() {
        const b = document.getElementById('btn-notificaciones'); if (b) b.addEventListener('click', () => { if (!cargado) traer().then(abrirPanel).catch(() => abrirPanel()); else abrirPanel(); });
        const ok = () => ['admin', 'administrador', 'global', 'superadmin', 'operador'].includes(rol()) && window.firebaseDb && window.firebaseAuth && window.firebaseAuth.currentUser;
        const ciclo = () => { if (ok()) traer().catch(() => { /* sin aviso */ }); };
        setTimeout(ciclo, 8000); setInterval(ciclo, 10 * 60 * 1000);
        setInterval(pintarCampana, 60 * 1000); setTimeout(pintarCampana, 6000);
    }
    if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar(); }

    window.SAR_Pendientes = { pickingActa, abrir, calcularPendientes, calcularPorRecibir, cruzarStock, datos: async () => { await traer(); return { grupos, porRecibir }; }, refrescar: () => traer().catch(() => {}) };
    if (typeof module !== 'undefined') module.exports = window.SAR_Pendientes;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: { dataset: {} } });
