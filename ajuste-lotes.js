/* ==========================================================================
   AJUSTE DE STOCK POR LOTE Y DIAGNÓSTICO DE CUOTA (v21.234)
   - Permite seleccionar el lote específico al ajustar un insumo (o crear uno
     nuevo al sumar stock) sin depender de un descuento FEFO a ciegas ni sumar
     siempre al primer lote.
   - Lógica pura reutilizable desde script.js (transacción atómica) y pruebas
     de unidad (tests/unidad.js).
   ========================================================================== */
(function (window) {
    'use strict';

    const norm = (s) => String(s == null ? '' : s).trim().toUpperCase();
    const normFecha = (s) => String(s == null ? '' : s).trim();
    const claveLote = (batch, exp) => `${norm(batch || 'S/L')}|${normFecha(exp)}`;

    function compararVencimiento(a, b) {
        if (typeof window !== 'undefined' && typeof window.fefoCompare === 'function') {
            return window.fefoCompare(a, b);
        }
        const fa = normFecha(a && a.expirationDate);
        const fb = normFecha(b && b.expirationDate);
        if (!fa && !fb) return 0;
        if (!fa) return 1;
        if (!fb) return -1;
        return fa.localeCompare(fb);
    }

    /**
     * Normaliza los lotes de un insumo para mostrarlos en el selector y operar en transacción.
     * Devuelve [{ key, batch, expirationDate, quantity, ...extras }] ordenados por FEFO.
     */
    function listarLotes(insumo) {
        if (!insumo || typeof insumo !== 'object') return [];
        const stockTotal = Number(insumo.quantity) || 0;
        let base = [];

        if (Array.isArray(insumo.batches) && insumo.batches.length > 0) {
            base = insumo.batches
                .filter(b => b && typeof b === 'object')
                .map(b => ({
                    ...b,
                    batch: String(b.batch || 'S/L').trim() || 'S/L',
                    expirationDate: normFecha(b.expirationDate),
                    quantity: Number(b.quantity) || 0
                }));
        } else if (insumo.batch || stockTotal > 0) {
            base = [{
                batch: String(insumo.batch || 'S/L').trim() || 'S/L',
                expirationDate: normFecha(insumo.expirationDate),
                quantity: stockTotal
            }];
        }

        // Mostrar lotes con stock > 0; si todos están en 0, mostrar los existentes para poder sumarles
        const conStock = base.filter(b => b.quantity > 0);
        const lista = (conStock.length > 0 ? conStock : base).slice().sort(compararVencimiento);
        return lista.map(b => ({
            ...b,
            key: claveLote(b.batch, b.expirationDate)
        }));
    }

    /**
     * Aplica un ajuste (+delta o -delta) sobre los lotes de un insumo.
     * - selLote: { key?, batch?, expirationDate?, esNuevo? } | null
     * Devuelve { nuevoStock, batches, batch, expirationDate, loteAfectado } o lanza Error.
     */
    function aplicarAjusteEnLotes(dataActual, delta, selLote) {
        const d = Number(delta);
        if (!Number.isFinite(d) || d === 0) {
            throw new Error('La cantidad a ajustar debe ser un número distinto de 0.');
        }
        if (!Number.isInteger(d)) {
            throw new Error('La cantidad a ajustar debe ser un número entero.');
        }

        const stockReal = Number(dataActual && dataActual.quantity) || 0;
        const nuevoStock = stockReal + d;
        if (nuevoStock < 0) {
            throw new Error(`Operación denegada: El stock no puede ser menor a 0. Stock actual: ${stockReal}.`);
        }

        // Clonar lotes actuales sin mutar dataActual
        let currentBatches = Array.isArray(dataActual && dataActual.batches)
            ? dataActual.batches
                .filter(b => b && typeof b === 'object')
                .map(b => ({
                    ...b,
                    batch: String(b.batch || 'S/L').trim() || 'S/L',
                    expirationDate: normFecha(b.expirationDate),
                    quantity: Number(b.quantity) || 0
                }))
            : [];

        if (currentBatches.length === 0 && ((dataActual && dataActual.batch) || stockReal > 0)) {
            currentBatches.push({
                batch: String((dataActual && dataActual.batch) || 'S/L').trim() || 'S/L',
                quantity: stockReal,
                expirationDate: normFecha(dataActual && dataActual.expirationDate)
            });
        }

        let loteAfectado = { batch: '', expirationDate: '' };

        if (selLote && selLote.esNuevo) {
            if (d < 0) {
                throw new Error('No se puede restar stock a un lote nuevo.');
            }
            const cleanBatch = String(selLote.batch || '').trim();
            if (!cleanBatch) {
                throw new Error('Debe indicar el número de lote nuevo.');
            }
            const cleanExp = normFecha(selLote.expirationDate);
            const targetKey = claveLote(cleanBatch, cleanExp);
            const existente = currentBatches.find(b => claveLote(b.batch, b.expirationDate) === targetKey);
            if (existente) {
                existente.quantity += d;
            } else {
                currentBatches.push({
                    batch: cleanBatch,
                    quantity: d,
                    expirationDate: cleanExp
                });
            }
            loteAfectado = { batch: cleanBatch, expirationDate: cleanExp };
        } else if (selLote && (selLote.key || selLote.batch)) {
            const targetKey = selLote.key ? norm(selLote.key) : claveLote(selLote.batch, selLote.expirationDate);
            let idx = currentBatches.findIndex(b => claveLote(b.batch, b.expirationDate) === targetKey);
            if (idx < 0 && selLote.batch) {
                const nb = norm(selLote.batch);
                idx = currentBatches.findIndex(b => norm(b.batch) === nb);
            }

            if (d < 0) {
                if (idx < 0) {
                    throw new Error(`El lote seleccionado (${selLote.batch || selLote.key}) ya no existe en este insumo.`);
                }
                const disp = Number(currentBatches[idx].quantity) || 0;
                if (disp + d < 0) {
                    throw new Error(`Stock insuficiente en el lote ${currentBatches[idx].batch}. Disponible en ese lote: ${disp}.`);
                }
                currentBatches[idx].quantity = disp + d;
                loteAfectado = { batch: currentBatches[idx].batch, expirationDate: currentBatches[idx].expirationDate };
            } else {
                if (idx >= 0) {
                    currentBatches[idx].quantity = (Number(currentBatches[idx].quantity) || 0) + d;
                    loteAfectado = { batch: currentBatches[idx].batch, expirationDate: currentBatches[idx].expirationDate };
                } else {
                    const cleanBatch = String(selLote.batch || 'S/L').trim() || 'S/L';
                    const cleanExp = normFecha(selLote.expirationDate);
                    currentBatches.push({
                        batch: cleanBatch,
                        quantity: d,
                        expirationDate: cleanExp
                    });
                    loteAfectado = { batch: cleanBatch, expirationDate: cleanExp };
                }
            }
        } else {
            // Compatibilidad con solicitudes antiguas sin lote especificado
            if (d < 0) {
                let qtyToReduce = Math.abs(d);
                currentBatches.sort(compararVencimiento);
                const tocados = [];
                for (let i = 0; i < currentBatches.length && qtyToReduce > 0; i++) {
                    if (currentBatches[i].quantity > 0) {
                        const available = currentBatches[i].quantity;
                        tocados.push(currentBatches[i].batch);
                        if (available >= qtyToReduce) {
                            currentBatches[i].quantity -= qtyToReduce;
                            qtyToReduce = 0;
                        } else {
                            qtyToReduce -= available;
                            currentBatches[i].quantity = 0;
                        }
                    }
                }
                loteAfectado = { batch: tocados.length === 1 ? tocados[0] : (tocados.length > 1 ? 'MULTI-LOTE' : ''), expirationDate: '' };
            } else {
                if (currentBatches.length > 0) {
                    currentBatches[0].quantity += d;
                    loteAfectado = { batch: currentBatches[0].batch, expirationDate: currentBatches[0].expirationDate };
                } else {
                    currentBatches.push({ batch: 'AJUSTE', quantity: d, expirationDate: '' });
                    loteAfectado = { batch: 'AJUSTE', expirationDate: '' };
                }
            }
        }

        const restantes = currentBatches
            .filter(b => (Number(b.quantity) || 0) > 0)
            .sort(compararVencimiento);

        const principal = restantes[0] || { batch: '', expirationDate: '' };

        return {
            nuevoStock,
            batches: restantes,
            batch: principal.batch || '',
            expirationDate: principal.expirationDate || '',
            loteAfectado
        };
    }

    function esErrorCuota(err) {
        const texto = String((err && ((err.code || '') + ' ' + (err.message || ''))) || err || '');
        return /resource-exhausted|quota\s*exceeded/i.test(texto);
    }

    function mensajeErrorAmigable(err) {
        if (esErrorCuota(err)) {
            return 'Se alcanzó el límite diario de operaciones de la base de datos (cuota de Firebase Firestore agotada). Los cambios no se pueden guardar hasta que se restablezca la cuota diaria (aprox. 04:00–05:00 hora de Chile) o se amplíe el plan en Firebase Console. Ref. ERR-DAT-006';
        }
        return (err && err.message) ? err.message : String(err || 'Error desconocido');
    }

    const api = { claveLote, listarLotes, aplicarAjusteEnLotes, esErrorCuota, mensajeErrorAmigable };
    if (typeof window !== 'undefined') window.SAR_AjusteLotes = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
