/* Editar actas ya emitidas (v20.93): actas de entrega (productos, cantidades, centro, pendientes, documentos, firmas) y actas de
   oxígeno (balones: quitar, agregar o cambiar la serie). Cada edición reajusta el stock/estado de los balones en una sola
   transacción, deja su movimiento EDICION_ACTA en el historial, rehace el documento y reemplaza el archivo guardado en la orden. */
(function (window, document) {
    'use strict';
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const num = (v) => Number(v) || 0;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };
    const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); };

    /** Edita un acta de entrega de productos: devuelve lo entregado antes y aplica lo nuevo, todo en una transacción. */
    async function editarEntrega(numero, N) {
        const f = fs(), A = window.SAR_ActasEntrega, user = usuario();
        const actaRef = f.doc(f.collection(db(), 'Actas_Entrega'), numero);
        return f.runTransaction(db(), async (tx) => {
            const as = await tx.get(actaRef); if (!as.exists()) throw new Error('El acta no existe.');
            const a = as.data(); if (a.estado !== 'EMITIDA') throw new Error('Solo se pueden editar actas emitidas.');
            if (a.confirmacion && a.confirmacion.estado === 'PENDIENTE') throw new Error('Esta acta aún no descuenta stock (entrega por confirmar). Confirma la entrega con el acta firmada o elimínala y emite otra.');
            const centro = String(N.centro || '').trim(); if (!centro) throw new Error('Indica el centro.');
            if (!N.items.length) throw new Error('El acta debe tener al menos un producto (si no corresponde, elimínala).');
            const ids = [...new Set([...(a.items || []).map(i => i.id), ...N.items.map(i => i.id)])];
            if (new Set(N.items.map(i => i.id)).size !== N.items.length) throw new Error('Hay un producto repetido: suma las cantidades en una sola fila.');
            const refs = {}, W = {}, orig = {};
            for (const id of ids) { refs[id] = f.doc(f.collection(db(), 'Insumos'), id); const s = await tx.get(refs[id]); if (s.exists()) { orig[id] = s.data(); W[id] = { ...s.data() }; } }
            let ocRef = null, ocLineas = null;
            if (a.oc && a.oc.id) { ocRef = f.doc(f.collection(db(), 'Seguimiento_OC'), a.oc.id); const os = await tx.get(ocRef); if (os.exists()) ocLineas = (os.data().lineas || []).map(l => ({ ...l, entregado: { ...(l.entregado || {}) } })); }
            // 1) deshacer lo entregado antes
            (a.items || []).forEach(i => {
                const d = W[i.id]; if (!d) throw new Error(`${i.nombre} ya no existe: no se puede reajustar el acta.`);
                const r = A.restaurarConSobregiro(d, i.lotes, i.sinRespaldo, numero);
                Object.assign(d, { quantity: r.quantity, batches: r.batches, sobregiro: r.sobregiro, sobregiroDetalle: r.sobregiroDetalle });
                const l = ocLineas && ocLineas[i.ocI]; if (l) l.entregado[a.oc.columna] = Math.max(0, num(l.entregado[a.oc.columna]) - num(i.cantidad));
            });
            // 2) aplicar lo nuevo
            const itemsActa = N.items.map(it => {
                const d = W[it.id]; if (!d) throw new Error(`${it.nombre} ya no existe.`);
                if ((d.location || '') !== a.bodegaOrigen) throw new Error(`${d.name} no está en ${a.bodegaOrigen}.`);
                if (d.status === 'CUARENTENA') throw new Error(`${d.name} está en CUARENTENA.`);
                const p = A.planificar({ ...d }, it.cantidad, numero);
                if (d.controlado && p.faltante > 0) throw new Error(`${d.name} es medicamento controlado: no puede entregarse sin stock en sistema.`);
                Object.assign(d, { quantity: p.quantity, batches: p.batches, sobregiro: p.sobregiro, sobregiroDetalle: p.sobregiroDetalle });
                const row = { id: it.id, nombre: d.name, cantidad: num(it.cantidad), lotes: p.usados, sinRespaldo: p.faltante, ...(d.codigoMP ? { codigoMP: String(d.codigoMP) } : {}), ...(it.entregaFisica ? { entregaFisica: it.entregaFisica } : {}), ...(it.ocI == null && num(it.solicitado) > num(it.cantidad) ? { solicitado: num(it.solicitado), entregadoTotal: num(it.cantidad) } : {}) };
                const l = it.ocI != null && ocLineas ? ocLineas[it.ocI] : null;
                if (l) {
                    const disp = num(l.ingresado && l.ingresado[a.oc.columna]) - num(l.entregado[a.oc.columna]);
                    if (num(it.cantidad) > disp) throw new Error(`${d.name}: solo quedan ${Math.max(0, disp)} u. por entregar de esta orden.`);
                    l.entregado[a.oc.columna] = num(l.entregado[a.oc.columna]) + num(it.cantidad);
                    Object.assign(row, { ocI: it.ocI, solicitado: num(l.dist && l.dist[a.oc.columna]), entregadoTotal: l.entregado[a.oc.columna] });
                }
                return row;
            });
            // 3) escribir
            let hubo = 0;
            ids.forEach(id => {
                const d = W[id]; if (!d) return;
                const limite = num(d.criticalLimit || d.stock_minimo || 50);
                tx.update(refs[id], { quantity: d.quantity, batches: d.batches, sobregiro: d.sobregiro, sobregiroDetalle: d.sobregiroDetalle, isCritical: d.quantity <= limite, updatedAt: f.serverTimestamp() });
                const antes = ((a.items || []).find(x => x.id === id) || {}).cantidad || 0, ahora = (itemsActa.find(x => x.id === id) || {}).cantidad || 0;
                if (antes !== ahora) { hubo++; tx.set(f.doc(f.collection(db(), 'Historial_Movimientos')), { insumoName: d.name, quantity: Math.abs(ahora - antes), type: 'EDICION_ACTA', user, date: f.serverTimestamp(), document: numero, batch: 'MULTI-LOTE', origin: a.bodegaOrigen, dest: centro, idInsumoOrigen: id, actaId: numero, observacion: `Edición del acta ${numero}: ${d.name} de ${antes} a ${ahora} u.` }); }
            });
            if (!hubo) tx.set(f.doc(f.collection(db(), 'Historial_Movimientos')), { insumoName: `ACTA ${numero} (editada)`, quantity: 0, type: 'EDICION_ACTA', user, date: f.serverTimestamp(), document: numero, batch: 'N/A', origin: a.bodegaOrigen, dest: centro, actaId: numero, observacion: `Edición del acta ${numero}: datos del documento (centro, fecha, pendientes, documentos o firmas).` });
            if (ocLineas) {
                tx.update(ocRef, { lineas: ocLineas, actualizadoEn: f.serverTimestamp() });
                tx.set(f.doc(f.collection(db(), 'Seguimiento_OC', a.oc.id, 'Eventos')), { tipo: 'ENTREGA', texto: `Acta ${numero} editada (${centro}):\n` + itemsActa.map(i => `- ${i.nombre}: ${i.cantidad} un.`).join('\n'), autor: user, fecha: f.serverTimestamp(), columna: a.oc.columna, actaId: numero });
            }
            const cambios = { centro, fecha: N.fecha || a.fecha, items: itemsActa, conSobregiro: itemsActa.some(i => i.sinRespaldo > 0), pendientes: N.pendientes || [], documentos: N.documentos || [], entrega: N.entrega || a.entrega, recibe: N.recibe || a.recibe, editadaEn: f.serverTimestamp(), editadaPor: user, ediciones: num(a.ediciones) + 1 };
            tx.update(actaRef, cambios);
            return { ...a, ...cambios, editadaEn: new Date().toISOString() };
        });
    }

    // ---------------------------------------------------------------
    // Ventana de edición
    // ---------------------------------------------------------------
    async function abrir(acta, ctx) {
        const oxi = acta.tipo === 'OXIGENO', f = fs();
        const S = { centro: acta.centro || '', fecha: acta.fecha || '', items: (acta.items || []).map(i => ({ ...i })), pendientes: (acta.pendientes || []).map(p => ({ ...p })), documentos: (acta.documentos || []).map(d => ({ ...d })),
            entrega: { ...(acta.entrega || {}) }, recibe: { ...(acta.recibe || {}) } };
        let opciones = [];
        const prog0 = window.SAR_Progreso.iniciar('Cargando el acta…', [oxi ? 'Leyendo los balones llenos disponibles…' : `Leyendo el stock de ${acta.bodegaOrigen}…`]);
        try {
            if (oxi) opciones = (await window.SAR_Oxigeno.listarLlenos()).map(e => ({ id: e.id, nombre: `N° ${e.serie} · ${e.capacidad || ''}`, serie: e.serie, e }));
            else { const sn = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('location', '==', acta.bodegaOrigen), f.limit(1500))); sn.forEach(d => { const x = d.data(); if (x.status !== 'CUARENTENA') opciones.push({ id: d.id, nombre: x.name || '', disp: Math.max(0, num(x.quantity) - num(x.sobregiro)) }); }); opciones.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')); }
            prog0.cerrar();
        } catch (e) { prog0.error(); toast('No se pudo abrir la edición', e.message || String(e), 'error'); return; }
        const ov = document.createElement('div'); ov.className = 'cierre-overlay';
        document.body.appendChild(ov);
        const cerrar = () => ov.remove();
        function pintar() {
            const usados = new Set(S.items.map(i => i.id));
            ov.innerHTML = `<div class="cierre-box cierre-box--ancho" role="dialog" aria-modal="true"><h3>Editar acta ${esc(acta.numero)}${oxi ? ' · oxígeno' : ''}</h3>
              <p class="cierre-hint">${oxi ? 'Quita o agrega balones, o cambia la serie (quita el balón y agrega el correcto). Los balones quitados vuelven a SAR como llenos.' : `Los cambios reajustan el stock de ${esc(acta.bodegaOrigen)}${acta.oc ? ' y lo entregado de la orden ' + esc(acta.oc.numeroOC || '') : ''}.`} Al guardar se rehace el documento.</p>
              <div class="soc-fila"><label>Centro<input id="ed-centro" list="ed-centros" value="${esc(S.centro)}"><datalist id="ed-centros">${(ctx.centros || []).map(c => `<option value="${esc(c)}">`).join('')}</datalist></label><label>Fecha<input id="ed-fecha" type="date" value="${esc(S.fecha)}"></label></div>
              <h4 class="act-h4">${oxi ? 'Balones' : 'Productos entregados'} (${S.items.length})</h4>
              ${S.items.map((i, k) => `<div class="act-fila"><div class="act-fn">${esc(i.nombre)}</div>${oxi ? '' : `<input type="number" min="1" class="act-qty ed-q" data-k="${k}" value="${i.cantidad}" aria-label="Cantidad">`}<button type="button" class="btn btn-outline ed-del" data-k="${k}" aria-label="Quitar">✕</button></div>`).join('')}
              <div class="act-fila act-docs"><select id="ed-sel"><option value="">${oxi ? 'Agregar balón lleno…' : 'Agregar producto de la bodega…'}</option>${opciones.filter(o => !usados.has(o.id)).map(o => `<option value="${esc(o.id)}">${esc(o.nombre)}${oxi ? '' : ' (disp. ' + o.disp + ')'}</option>`).join('')}</select>${oxi ? '' : '<input id="ed-selq" type="number" min="1" value="1" class="act-qty" aria-label="Cantidad">'}<button type="button" class="btn btn-outline" id="ed-add">Agregar</button></div>
              ${oxi ? '' : `<h4 class="act-h4">Productos pendientes de entrega</h4>
              ${S.pendientes.map((p, k) => `<div class="act-fila"><div class="act-fn">${esc(p.nombre)}</div><input type="number" min="1" class="act-qty ed-pq" data-k="${k}" value="${p.cantidad}"><button type="button" class="btn btn-outline ed-pdel" data-k="${k}">✕</button></div>`).join('')}
              <div class="act-fila act-docs"><input id="ed-pn" placeholder="Producto pendiente"><input id="ed-pc" type="number" min="1" value="1" class="act-qty"><button type="button" class="btn btn-outline" id="ed-padd">Añadir</button></div>`}
              <h4 class="act-h4">Documentos asociados</h4>
              ${S.documentos.map((d, k) => `<div class="act-fila"><div class="act-fn">${esc(d.tipo)} N° ${esc(d.numero)}${d.detalle ? ' — ' + esc(d.detalle) : ''}</div><button type="button" class="btn btn-outline ed-ddel" data-k="${k}">✕</button></div>`).join('')}
              <div class="act-fila act-docs"><input id="ed-dt" placeholder="Tipo (SDC, OC, factura…)"><input id="ed-dn" placeholder="Número"><button type="button" class="btn btn-outline" id="ed-dadd">Añadir</button></div>
              <h4 class="act-h4">Firmas</h4>
              <div class="act-fila act-docs"><input id="ed-en" placeholder="Entrega: nombre" value="${esc(S.entrega.nombre || '')}"><input id="ed-ec" placeholder="Entrega: cargo" value="${esc(S.entrega.cargo || '')}"></div>
              <div class="act-fila act-docs"><input id="ed-rn" placeholder="Recibe: nombre" value="${esc(S.recibe.nombre || '')}"><input id="ed-rc" placeholder="Recibe: cargo" value="${esc(S.recibe.cargo || '')}"></div>
              <div class="cierre-acciones"><button type="button" class="btn btn-outline" id="ed-x">Cancelar</button><button type="button" class="btn btn-primary" id="ed-ok">Guardar cambios</button></div></div>`;
            const $ = (s) => ov.querySelector(s), leer = () => { S.centro = $('#ed-centro').value; S.fecha = $('#ed-fecha').value; S.entrega = { nombre: $('#ed-en').value.trim(), cargo: $('#ed-ec').value.trim() }; S.recibe = { nombre: $('#ed-rn').value.trim(), cargo: $('#ed-rc').value.trim() }; ov.querySelectorAll('.ed-q').forEach(i => { S.items[+i.dataset.k].cantidad = Math.floor(num(i.value)); }); ov.querySelectorAll('.ed-pq').forEach(i => { S.pendientes[+i.dataset.k].cantidad = Math.floor(num(i.value)) || 1; }); };
            const re = () => { leer(); pintar(); };
            $('#ed-x').addEventListener('click', cerrar);
            ov.querySelectorAll('.ed-q').forEach(i => i.addEventListener('change', leer));
            ov.querySelectorAll('.ed-del').forEach(b => b.addEventListener('click', () => { leer(); S.items.splice(+b.dataset.k, 1); pintar(); }));
            ov.querySelectorAll('.ed-pdel').forEach(b => b.addEventListener('click', () => { leer(); S.pendientes.splice(+b.dataset.k, 1); pintar(); }));
            ov.querySelectorAll('.ed-ddel').forEach(b => b.addEventListener('click', () => { leer(); S.documentos.splice(+b.dataset.k, 1); pintar(); }));
            $('#ed-add').addEventListener('click', () => {
                leer(); const o = opciones.find(x => x.id === $('#ed-sel').value); if (!o) { toast('Agregar', 'Elige qué agregar.', 'warning'); return; }
                if (oxi) S.items.push({ id: o.id, nombre: window.SAR_Oxigeno.nombreEnActa(o.e), cantidad: 1, serie: o.serie });
                else { const q = Math.floor(num($('#ed-selq').value)); if (!(q > 0)) { toast('Cantidad', 'Indica una cantidad mayor que 0.', 'warning'); return; } S.items.push({ id: o.id, nombre: o.nombre, cantidad: q }); }
                pintar();
            });
            if (!oxi) $('#ed-padd').addEventListener('click', () => { leer(); const n = $('#ed-pn').value.trim().toUpperCase(), c = Math.floor(num($('#ed-pc').value)); if (!n || !(c > 0)) { toast('Pendiente', 'Escribe el producto y la cantidad.', 'warning'); return; } S.pendientes.push({ nombre: n, cantidad: c }); pintar(); });
            $('#ed-dadd').addEventListener('click', () => { leer(); const t = $('#ed-dt').value.trim() || 'Documento', n = $('#ed-dn').value.trim(); if (!n) { toast('Documento', 'Escribe el número.', 'warning'); return; } S.documentos.push({ tipo: t, numero: n, detalle: '' }); pintar(); });
            $('#ed-ok').addEventListener('click', async (e) => {
                leer(); if (!S.items.length) { toast('Sin productos', 'El acta necesita al menos un ' + (oxi ? 'balón.' : 'producto.'), 'warning'); return; }
                if (!S.items.every(i => oxi || i.cantidad > 0)) { toast('Cantidad', 'Todas las cantidades deben ser mayores que 0.', 'warning'); return; }
                e.target.disabled = true; cerrar();
                const prog = window.SAR_Progreso.iniciar(`Guardando los cambios del acta ${acta.numero}…`, [oxi ? 'Reajustando el estado de los balones…' : 'Reajustando el stock y la orden…']);
                try {
                    const nueva = oxi ? await window.SAR_Oxigeno.editarActa(acta.numero, { centro: S.centro, fecha: S.fecha, ids: S.items.map(i => i.id), documentos: S.documentos, entrega: S.entrega, recibe: S.recibe })
                        : await editarEntrega(acta.numero, { centro: S.centro, fecha: S.fecha, items: S.items.map(i => ({ id: i.id, nombre: i.nombre, cantidad: i.cantidad, ocI: i.ocI, solicitado: i.ocI == null ? i.solicitado : undefined })), pendientes: S.pendientes, documentos: S.documentos, entrega: S.entrega, recibe: S.recibe });
                    prog.paso('Rehaciendo el documento…');
                    let r = null; try { r = await window.SAR_ActasEntrega.descargarActa(nueva, 'pdf'); } catch (x) { toast('Documento', 'Se guardó el acta, pero el PDF no se pudo generar: ' + (x.message || x), 'warning'); }
                    const SO = window.SAR_SeguimientoOC;
                    if (r && nueva.oc && nueva.oc.id && SO && SO.guardarArchivo) { prog.paso('Reemplazando el archivo guardado en la orden…'); try { await SO.eliminarArchivosActa(nueva.oc.id, nueva.numero); await SO.guardarArchivo(nueva.oc.id, { nombre: r.nombre, categoria: 'Acta de entrega ' + nueva.numero, bytes: r.bytes }); } catch (x) { toast('Archivo de la orden', 'No se pudo reemplazar: ' + (x.message || x), 'warning'); } }
                    prog.listo(`Acta ${acta.numero} actualizada`, { informe: true });
                    if (ctx.refrescar) await ctx.refrescar();
                } catch (err) { prog.error(); toast('No se guardó la edición', err.message || String(err), 'error'); }
            });
        }
        pintar();
    }
    window.SAR_ActaEdicion = { abrir, editarEntrega };
})(window, document);
