/* ==========================================================================
   BODEGAS: ASISTENTE "CERRAR BODEGA" (v20.35)
   --------------------------------------------------------------------------
   Regla (docs/DECISIONES.md y AGENTS.md, Regla 2): una bodega con stock no se
   elimina; se CIERRA devolviendo todo a otra bodega (normalmente la Central) y
   luego se ARCHIVA. Nada se borra: el historial y el documento de la bodega quedan.

   Modelo de datos: hay un documento en `Insumos` por cada (producto, bodega).
   Mover el stock = sumar cada producto al documento del mismo nombre en la bodega
   destino (se crea si no existe) y dejar el origen en 0, con su historial,
   TODO en una sola transacción por producto.

   Seguridad: solo administradores; siempre muestra primero una vista previa
   (simulación) y exige motivo y escribir el nombre de la bodega para confirmar.
   ========================================================================== */
(function (window, document) {
    'use strict';

    const fs = () => window.firebaseFirestore;
    const db = () => window.firebaseDb;
    const esc = (s) => (window.escapeHTML ? window.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s));
    const esAdmin = () => ['admin', 'administrador', 'global', 'superadmin'].includes(String(document.body.dataset.userRole || '').toLowerCase());
    const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
    const num = (v) => Number(v) || 0;
    const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const LIMITE = 600;

    // ---------------------------------------------------------------
    // Lotes (puro, probado aparte)
    // ---------------------------------------------------------------
    /** Lotes de un documento de insumo; si no tiene arreglo, usa el lote raíz. */
    function lotesDeDoc(d) {
        const b = (Array.isArray(d.batches) ? d.batches : []).map(x => ({ ...x }));
        if (!b.length && d.batch) b.push({ batch: d.batch, quantity: num(d.quantity), expirationDate: d.expirationDate || '' });
        return b;
    }
    /** Lotes que se mueven para llevar exactamente `cantidad` unidades (FEFO si hay comparador). */
    function lotesAMover(d) {
        const cantidad = num(d.quantity);
        const cmp = typeof window.fefoCompare === 'function' ? window.fefoCompare : null;
        const lotes = lotesDeDoc(d).filter(l => num(l.quantity) > 0);
        if (cmp) lotes.sort(cmp);
        const out = []; let falta = cantidad;
        for (const l of lotes) {
            if (falta <= 0) break;
            const usa = Math.min(num(l.quantity), falta);
            out.push({ batch: l.batch || 'S/L', quantity: usa, expirationDate: l.expirationDate || '' });
            falta -= usa;
        }
        if (falta > 0) out.push({ batch: 'S/L', quantity: falta, expirationDate: '' }); // stock sin lote registrado
        return out;
    }
    /** Suma los lotes movidos a los lotes del destino (mismo código y vencimiento se acumulan). */
    function mezclarLotes(destino, movidos) {
        const arr = destino.map(b => ({ ...b }));
        for (const m of movidos) {
            const ex = arr.find(b => b.batch === m.batch && (b.expirationDate || '') === (m.expirationDate || ''));
            if (ex) ex.quantity = num(ex.quantity) + m.quantity; else arr.push({ ...m });
        }
        return arr;
    }

    // ---------------------------------------------------------------
    // Simulación (no escribe nada)
    // ---------------------------------------------------------------
    async function planificar(origen, destino) {
        const f = fs();
        if (!origen || !destino || origen.id === destino.id) throw new Error('Elige una bodega destino distinta.');
        const snap = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('location', '==', origen.name), f.limit(LIMITE)));
        const items = [];
        snap.forEach(d => {
            const data = d.data();
            if (num(data.quantity) <= 0) return;
            items.push({ id: d.id, ref: d.ref, name: data.name, quantity: num(data.quantity), lotes: lotesAMover(data),
                controlado: !!data.controlado, cuarentena: data.status === 'CUARENTENA' });
        });
        items.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
        for (const it of items) {
            const s = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('name', '==', it.name), f.where('location', '==', destino.name), f.limit(1)));
            it.destRef = s.empty ? f.doc(db(), 'Insumos', `tras_${slug(it.name)}__${slug(destino.name)}`) : s.docs[0].ref;
            it.existeDestino = !s.empty;
        }
        return { items, truncado: snap.size >= LIMITE, total: items.reduce((t, i) => t + i.quantity, 0) };
    }

    // ---------------------------------------------------------------
    // Ejecución: una transacción por producto
    // ---------------------------------------------------------------
    async function moverUno(it, origen, destino, ctx) {
        const f = fs();
        const histRef = f.doc(f.collection(db(), 'Historial_Movimientos'));
        return f.runTransaction(db(), async (tx) => {
            const sO = await tx.get(it.ref);
            if (!sO.exists()) throw new Error('El producto de origen ya no existe.');
            const o = sO.data();
            const sD = await tx.get(it.destRef);
            const qty = num(o.quantity);
            if (qty <= 0) return 0;                       // ya se había movido: no hace nada
            if (o.status === 'CUARENTENA') throw new Error('Producto en CUARENTENA: resuélvelo antes de cerrar.');
            const movidos = lotesAMover(o);
            const dData = sD.exists() ? sD.data() : null;
            const dLimite = num((dData && (dData.criticalLimit || dData.stock_minimo)) || o.criticalLimit || o.stock_minimo || 50);
            const dBase = dData ? lotesDeDoc(dData) : [];
            const dLotes = mezclarLotes(dBase, movidos);
            const dQty = num(dData && dData.quantity) + qty;
            const prox = [...dLotes].sort(typeof window.fefoCompare === 'function' ? window.fefoCompare : () => 0)[0];
            // Escrituras (después de todas las lecturas)
            tx.update(it.ref, { quantity: 0, batches: [], isCritical: true, updatedAt: f.serverTimestamp() });
            if (dData) {
                tx.update(it.destRef, { quantity: dQty, isCritical: dQty <= dLimite, batches: dLotes, updatedAt: f.serverTimestamp() });
            } else {
                tx.set(it.destRef, { ...o, location: destino.name, quantity: dQty, isCritical: dQty <= dLimite, criticalLimit: dLimite, batches: dLotes,
                    batch: prox ? prox.batch : (o.batch || ''), expirationDate: prox && prox.expirationDate ? prox.expirationDate : (o.expirationDate || ''), updatedAt: f.serverTimestamp() });
            }
            tx.set(histRef, {
                insumoName: o.name, quantity: qty, type: 'CIERRE_BODEGA', user: ctx.usuario, date: f.serverTimestamp(),
                document: ctx.documento, batch: movidos.length === 1 ? movidos[0].batch : 'MULTI-LOTE', origin: origen.name, dest: destino.name,
                lotes: movidos.map(m => ({ batch: m.batch, used: m.quantity, expirationDate: m.expirationDate })),
                idInsumoOrigen: it.id, idInsumoDestino: it.destRef.id, observacion: ctx.motivo, cierreId: ctx.cierreId
            });
            return qty;
        });
    }

    async function ejecutar(origen, destino, motivo, items, onProgreso) {
        const f = fs();
        const auth = window.firebaseAuth;
        const usuario = (auth && auth.currentUser && auth.currentUser.email) || 'Admin';
        const cierreId = `CIE-${Date.now()}`;
        const ctx = { usuario, motivo, cierreId, documento: `CIERRE-${slug(origen.name).slice(0, 20)}` };
        const fallos = []; let movidos = 0, unidades = 0;
        for (let i = 0; i < items.length; i++) {
            try { const q = await moverUno(items[i], origen, destino, ctx); if (q > 0) { movidos++; unidades += q; } }
            catch (e) { fallos.push({ name: items[i].name, error: (e && e.message) || String(e) }); }
            if (onProgreso) onProgreso(i + 1, items.length);
        }
        // Solo se archiva si no quedó stock en la bodega (se vuelve a consultar)
        let archivada = false, restantes = null;
        if (!fallos.length) {
            const snap = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('location', '==', origen.name), f.limit(LIMITE)));
            restantes = 0; snap.forEach(d => { if (num(d.data().quantity) > 0) restantes++; });
            if (restantes === 0) {
                await f.updateDoc(f.doc(f.collection(db(), 'Bodegas'), origen.id), {
                    isActive: false, archivada: true, cerradaEn: f.serverTimestamp(), cerradaPor: usuario, cierreId, cierreDestino: destino.name, cierreMotivo: motivo
                });
                archivada = true;
            }
        }
        return { movidos, unidades, fallos, archivada, restantes, cierreId };
    }

    // ---------------------------------------------------------------
    // Interfaz
    // ---------------------------------------------------------------
    async function abrir(origen) {
        if (!esAdmin()) { toast('Sin permiso', 'Solo un administrador puede cerrar una bodega.', 'warning'); return; }
        const f = fs();
        let otras = [];
        try {
            const snap = await f.getDocs(f.collection(db(), 'Bodegas'));
            snap.forEach(d => { const b = { id: d.id, ...d.data() }; if (b.id !== origen.id && b.isActive !== false) otras.push(b); });
        } catch (e) { toast('Error', 'No se pudieron cargar las bodegas: ' + e.message, 'error'); return; }
        if (!otras.length) { toast('Sin destino', 'No hay otra bodega activa a la que devolver el stock.', 'warning'); return; }
        const esCentral = (b) => /central/i.test(String(b.name || '')) || String(b.type || '').toLowerCase() === 'central' || String(b.type || '').toLowerCase() === 'principal';
        otras.sort((a, b) => (esCentral(b) - esCentral(a)) || String(a.name).localeCompare(String(b.name), 'es'));

        const ov = document.createElement('div');
        ov.className = 'cierre-overlay';
        ov.innerHTML = `<div class="cierre-box" role="dialog" aria-modal="true" aria-label="Cerrar bodega">
            <h3>Cerrar bodega: ${esc(origen.name)}</h3>
            <p class="cierre-hint">Todo el stock pasa a la bodega que elijas, queda registrado en el historial y esta bodega se archiva. No se borra nada.</p>
            <label>Devolver el stock a
                <select id="cierre-dest">${otras.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label>
            <div id="cierre-prev"></div>
            <div class="cierre-acciones"><button type="button" class="btn btn-outline" id="cierre-cancelar">Cancelar</button>
                <button type="button" class="btn btn-primary" id="cierre-simular">Ver qué se movería</button></div>
        </div>`;
        document.body.appendChild(ov);
        const q = (s) => ov.querySelector(s);
        const cerrar = () => ov.remove();
        q('#cierre-cancelar').addEventListener('click', cerrar);

        q('#cierre-simular').addEventListener('click', async () => {
            const destino = otras.find(b => b.id === q('#cierre-dest').value);
            const prev = q('#cierre-prev'); prev.innerHTML = '<p class="cierre-hint">Calculando…</p>';
            let plan;
            try { plan = await planificar(origen, destino); } catch (e) { prev.innerHTML = `<p class="cierre-error">${esc(e.message)}</p>`; return; }
            const hayControlados = plan.items.some(i => i.controlado), hayCuarentena = plan.items.filter(i => i.cuarentena);
            prev.innerHTML = `
                <p><strong>${plan.items.length}</strong> productos • <strong>${plan.total}</strong> unidades hacia <strong>${esc(destino.name)}</strong>.
                ${plan.truncado ? ' <span class="cierre-error">Hay más de ' + LIMITE + ' productos: se mueven los primeros ' + LIMITE + ' y luego repites el cierre.</span>' : ''}</p>
                ${plan.items.length ? `<div class="cierre-tabla"><table><thead><tr><th>Producto</th><th>Cant.</th><th>En destino</th></tr></thead><tbody>
                    ${plan.items.map(i => `<tr${i.cuarentena ? ' class="cierre-fila-err"' : ''}><td>${esc(i.name)}${i.controlado ? ' <small>(controlado)</small>' : ''}${i.cuarentena ? ' <small>CUARENTENA</small>' : ''}</td><td>${i.quantity}</td><td>${i.existeDestino ? 'se suma' : 'se crea'}</td></tr>`).join('')}
                </tbody></table></div>` : '<p class="cierre-hint">La bodega no tiene stock: solo se archivará.</p>'}
                ${hayCuarentena.length ? `<p class="cierre-error">${hayCuarentena.length} producto(s) en cuarentena no se pueden mover; resuélvelos antes.</p>` : ''}
                ${hayControlados ? '<label class="cierre-check"><input type="checkbox" id="cierre-ctrl"> Confirmo que la bodega destino puede guardar medicamentos controlados (bajo llave).</label>' : ''}
                <label>Motivo del cierre <input type="text" id="cierre-motivo" maxlength="200" placeholder="Ej.: se terminó el espacio transitorio"></label>
                <label>Para confirmar escribe el nombre de la bodega <input type="text" id="cierre-nombre" placeholder="${esc(origen.name)}" autocomplete="off"></label>
                <div class="cierre-progreso" id="cierre-prog" hidden></div>
                <button type="button" class="btn btn-danger" id="cierre-ejecutar">Cerrar y mover el stock</button>`;
            q('#cierre-simular').textContent = 'Recalcular';
            q('#cierre-ejecutar').addEventListener('click', async (ev) => {
                const motivo = q('#cierre-motivo').value.trim();
                if (!motivo) { toast('Falta el motivo', 'Escribe por qué se cierra la bodega.', 'warning'); return; }
                if (q('#cierre-nombre').value.trim().toLowerCase() !== String(origen.name).trim().toLowerCase()) { toast('Nombre distinto', 'Escribe el nombre exacto de la bodega para confirmar.', 'warning'); return; }
                if (hayControlados && !q('#cierre-ctrl').checked) { toast('Falta confirmar', 'Confirma lo de los medicamentos controlados.', 'warning'); return; }
                if (hayCuarentena.length) { toast('Hay productos en cuarentena', 'No se puede cerrar hasta resolverlos.', 'warning'); return; }
                ev.target.disabled = true; q('#cierre-simular').disabled = true;
                const prog = q('#cierre-prog'); prog.hidden = false;
                const res = await ejecutar(origen, destino, motivo, plan.items, (n, t) => { prog.textContent = `Moviendo… ${n} de ${t}`; });
                if (res.archivada) {
                    prog.innerHTML = `<strong>Listo.</strong> ${res.movidos} productos (${res.unidades} unidades) pasaron a ${esc(destino.name)} y la bodega quedó archivada.`;
                    toast('Bodega cerrada', `${res.movidos} productos movidos a ${destino.name}.`, 'success');
                    const modal = document.getElementById('bodega-modal'); if (modal) modal.classList.remove('active');
                    setTimeout(cerrar, 2500);
                } else {
                    prog.innerHTML = `<span class="cierre-error"><strong>No se archivó.</strong> Se movieron ${res.movidos} productos (${res.unidades} unidades).
                        ${res.fallos.length ? 'Fallaron: ' + res.fallos.map(x => esc(x.name) + ' (' + esc(x.error) + ')').join('; ') : (res.restantes ? `Quedan ${res.restantes} productos con stock; repite el cierre.` : '')}
                        Lo ya movido quedó registrado; puedes repetir el cierre sin duplicar nada.</span>`;
                    toast('Cierre incompleto', 'Revisa el detalle; puedes repetirlo.', 'warning');
                    ev.target.disabled = false; q('#cierre-simular').disabled = false;
                }
            });
        });
    }

    window.SAR_Cierre = { abrir, planificar, ejecutar, lotesDeDoc, lotesAMover, mezclarLotes };
})(window, document);
