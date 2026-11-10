/* ==========================================================================
   PRESUPUESTO POR CDP (v20.55)
   --------------------------------------------------------------------------
   Opcional. Se registra una categoría de financiamiento (p. ej. "PERCAPITA") y/o uno o más
   N° de CDP con un monto inicial. Cada orden que trae esa categoría o esos CDP en su cuadro de
   distribución se descuenta sola (monto total con IVA de la columna). El "comprometido" se CALCULA
   a partir de las órdenes (no se guarda), por lo que ingresar una orden dos veces o corregirla
   nunca descuenta doble. Avisa cuando un CDP/categoría quedaría sobregirado.
   Colección: CDP_Presupuesto/{id} → { nombre, codigos:[…], montoInicial, nota }
   ========================================================================== */
(function (window, document) {
    'use strict';
    const fs = () => window.firebaseFirestore;
    const db = () => window.firebaseDb;
    const num = (v) => Number(v) || 0;
    const peso = (n) => (num(n) < 0 ? '-$' : '$') + Math.abs(Math.round(num(n))).toLocaleString('es-CL');
    const esc = (s) => (window.escapeHTML ? window.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const rol = () => String(document.body.dataset.userRole || '').toLowerCase();
    const esAdmin = () => ['admin', 'administrador', 'global', 'superadmin'].includes(rol());
    const usuario = () => (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || 'Usuario';
    const codigosDe = (t) => [...new Set(String(t || '').match(/\d+/g) || [])];

    // ---------------- puro ----------------
    /** Monto que una columna de la orden compromete (total con IVA; si falta, neto + 19 %). */
    function montoColumna(c) { return num(c && c.total) || Math.round(num(c && c.neto) * 1.19); }
    /** Entrada del presupuesto a la que pertenece una columna: primero por N° de CDP, luego por categoría. */
    function entradaDe(entradas, col) {
        const cdps = (col && col.cdps) || codigosDe(col && col.cdp);
        const porCodigo = entradas.find(e => (e.codigos || []).some(x => cdps.includes(String(x))));
        if (porCodigo) return porCodigo;
        const fin = norm(col && col.financiamiento);
        if (!fin) return null;
        return entradas.find(e => !(e.codigos || []).length && norm(e.nombre) && fin.includes(norm(e.nombre))) || null;
    }
    /** Estado de cada entrada: comprometido, saldo y detalle por orden. `ordenes` = Seguimiento_OC (sin anuladas). */
    function calcular(entradas, ordenes) {
        const res = new Map(entradas.map(e => [e.id, { entrada: e, comprometido: 0, detalle: [] }]));
        const sinAsignar = [];
        (ordenes || []).filter(o => !o.anulada).forEach(oc => (oc.columnas || []).forEach(c => {
            const m = montoColumna(c); if (!m) return;
            const e = entradaDe(entradas, c);
            if (e) { const r = res.get(e.id); r.comprometido += m; r.detalle.push({ ocId: oc.id, numeroOC: oc.numeroOC, memo: c.memo, centro: c.centro, cdp: c.cdp, monto: m }); }
            else if (c.cdp || c.financiamiento) sinAsignar.push({ ocId: oc.id, numeroOC: oc.numeroOC, memo: c.memo, centro: c.centro, cdp: c.cdp, financiamiento: c.financiamiento, monto: m });
        }));
        const filas = [...res.values()].map(r => ({ ...r, inicial: num(r.entrada.montoInicial), saldo: num(r.entrada.montoInicial) - r.comprometido, excedido: num(r.entrada.montoInicial) > 0 && r.comprometido > num(r.entrada.montoInicial) }));
        return { filas, sinAsignar };
    }
    /** Avisos al ingresar una orden nueva: entradas que quedarían sobregiradas por ella. Idempotente (la orden se cuenta una sola vez). */
    function alertasDeOrden(entradas, ordenes, ocNueva) {
        const otras = (ordenes || []).filter(o => o.id !== ocNueva.id && o.numeroOC !== ocNueva.numeroOC);
        const antes = calcular(entradas, otras), despues = calcular(entradas, [...otras, ocNueva]);
        const out = [];
        despues.filas.forEach((f, i) => {
            const a = antes.filas[i];
            if (num(f.entrada.montoInicial) > 0 && f.comprometido > a.comprometido && f.saldo < 0) out.push(`${f.entrada.nombre || 'CDP ' + (f.entrada.codigos || []).join('-')}: quedaría sobregirado en ${peso(-f.saldo)} (inicial ${peso(f.inicial)}, comprometido con esta orden ${peso(f.comprometido)}).`);
        });
        return out;
    }

    // ---------------- datos ----------------
    let entradas = [];
    async function cargar() {
        try { const s = await fs().getDocs(fs().collection(db(), 'CDP_Presupuesto')); entradas = []; s.forEach(d => entradas.push({ id: d.id, ...d.data() })); entradas.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es')); }
        catch (e) { entradas = []; }
        return entradas;
    }
    async function alertaNuevaOC(ocNueva, ordenes) { await cargar(); return alertasDeOrden(entradas, ordenes, ocNueva); }

    // ---------------- pantalla ----------------
    function cardHTML(ordenes) {
        const { filas, sinAsignar } = calcular(entradas, ordenes);
        const sin = sinAsignar.reduce((t, x) => t + x.monto, 0);
        return `<div class="erp-card cdp-card"><div class="soc-sub"><h3>Presupuesto por CDP <span class="soc-n">${filas.length}</span></h3>
            <button type="button" class="btn btn-outline btn-sm" id="cdp-nuevo"><i class="ph-bold ph-plus"></i> Agregar CDP / categoría</button></div>
            ${filas.length ? `<div class="soc-tabla"><table><thead><tr><th>Categoría / CDP</th><th>Inicial</th><th>Comprometido</th><th>Saldo</th><th></th></tr></thead><tbody>${filas.map(f => {
                const pct = f.inicial ? Math.min(100, Math.round(f.comprometido * 100 / f.inicial)) : 0;
                return `<tr class="${f.excedido ? 'cdp-exc' : ''}"><td><strong>${esc(f.entrada.nombre || '—')}</strong>${(f.entrada.codigos || []).length ? `<br><small>CDP ${esc(f.entrada.codigos.join('-'))}</small>` : ''}${f.entrada.nota ? `<br><small>${esc(f.entrada.nota)}</small>` : ''}</td>
                    <td>${f.inicial ? peso(f.inicial) : '<small>sin monto</small>'}</td><td>${peso(f.comprometido)}${f.detalle.length ? `<br><small>${f.detalle.map(d => esc(d.numeroOC) + ' · memo ' + esc(d.memo) + ' · ' + peso(d.monto)).join('<br>')}</small>` : ''}</td>
                    <td><strong class="${f.saldo < 0 ? 'cierre-error' : ''}">${f.inicial ? peso(f.saldo) : '—'}</strong>${f.inicial ? `<div class="soc-barra"><span style="width:${pct}%${f.excedido ? ';background:#B91C1C' : ''}"></span></div>` : ''}${f.excedido ? '<small class="cierre-error">Sobregirado</small>' : ''}</td>
                    <td><button type="button" class="btn btn-outline btn-sm" data-cdp-ed="${esc(f.entrada.id)}">Editar</button></td></tr>`; }).join('')}</tbody></table></div>`
                : '<p class="bodega-estantes__hint">Opcional: agrega una categoría (p. ej. PERCAPITA) o un N° de CDP con su monto inicial y cada orden que lo use se descuenta sola.</p>'}
            ${sinAsignar.length ? `<p class="bodega-estantes__hint">${sinAsignar.length} columna(s) de órdenes (${peso(sin)}) no pertenecen a ninguna categoría/CDP registrada.</p>` : ''}</div>`;
    }
    function enlazar(host, ordenes, modal, toast, repintar) {
        const nuevo = host.querySelector('#cdp-nuevo'); if (nuevo) nuevo.addEventListener('click', () => form(null, modal, toast, repintar));
        host.querySelectorAll('[data-cdp-ed]').forEach(b => b.addEventListener('click', () => form(entradas.find(e => e.id === b.dataset.cdpEd), modal, toast, repintar)));
    }
    function form(e, modal, toast, repintar) {
        const ov = modal(e ? 'Editar CDP / categoría' : 'Agregar CDP / categoría', `
            <label>Categoría de financiamiento (como aparece en el cuadro, p. ej. PERCAPITA)<input type="text" id="cdp-n" maxlength="80" value="${esc(e ? e.nombre : '')}" placeholder="PERCAPITA"></label>
            <label>N° de CDP (opcional; varios separados por coma o guion)<input type="text" id="cdp-c" maxlength="80" value="${esc(e ? (e.codigos || []).join('-') : '')}" placeholder="3549-3550"></label>
            <label>Monto inicial del certificado ($, con IVA)<input type="number" id="cdp-m" min="0" step="1" value="${e ? num(e.montoInicial) || '' : ''}"></label>
            <label>Nota (opcional)<input type="text" id="cdp-t" maxlength="200" value="${esc(e ? e.nota : '')}"></label>
            <small>Si indicas N° de CDP, se descuentan solo las columnas con esos CDP. Si solo indicas la categoría, las que tengan ese financiamiento.</small>
            ${e && esAdmin() ? '<button type="button" class="btn btn-outline btn-sm" id="cdp-del">Eliminar</button>' : ''}`, async (o) => {
            const nombre = o.querySelector('#cdp-n').value.trim(), codigos = codigosDe(o.querySelector('#cdp-c').value), monto = num(o.querySelector('#cdp-m').value);
            if (!nombre && !codigos.length) { toast('Falta el dato', 'Indica la categoría o al menos un N° de CDP.', 'warning'); return false; }
            const datos = { nombre, codigos, montoInicial: monto, nota: o.querySelector('#cdp-t').value.trim(), actualizadoPor: usuario(), actualizadoEn: fs().serverTimestamp() };
            if (e) await fs().updateDoc(fs().doc(db(), 'CDP_Presupuesto', e.id), datos);
            else await fs().setDoc(fs().doc(fs().collection(db(), 'CDP_Presupuesto')), { ...datos, creadoPor: usuario(), creadoEn: fs().serverTimestamp() });
            await cargar(); toast('Presupuesto guardado', nombre || codigos.join('-'), 'success'); if (repintar) repintar();
        });
        const del = ov.querySelector('#cdp-del');
        if (del) del.addEventListener('click', async () => { if (!window.confirm('¿Eliminar este CDP/categoría del presupuesto? Las órdenes no se tocan.')) return; await fs().deleteDoc(fs().doc(db(), 'CDP_Presupuesto', e.id)); await cargar(); ov.remove(); toast('Eliminado', '', 'success'); if (repintar) repintar(); });
    }

    window.SAR_CDP = { cargar, cardHTML, enlazar, alertaNuevaOC, calcular, alertasDeOrden, entradaDe, montoColumna, codigosDe, _set: (e) => { entradas = e; } };
    if (typeof module !== 'undefined') module.exports = window.SAR_CDP;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: { dataset: {} } });
