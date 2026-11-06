/* ==========================================================================
   Cuadre de sustituciones (v21.24) — uso interno, no sale en el acta.
   Cuando en un acta se entrega físicamente un producto similar al pedido, el acta (y el
   stock del sistema) queda con el producto pedido, pero físicamente salió otro. El acta
   guarda ese respaldo en cada ítem (entregaFisica). Esta vista lo junta para cuadrar:
   - producto del acta: el sistema lo descontó, pero físicamente sigue en bodega → sobra físico (+);
   - producto entregado: físicamente salió, pero el sistema lo sigue mostrando → falta físico (−).
   Las marcas "cuadrada" se guardan en Contadores/cuadre-sustituciones (no requiere reglas nuevas).
   ========================================================================== */
(function (window, document) {
    'use strict';
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (v) => Number(v) || 0;
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const root = () => document.getElementById('sus-root');
    const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
    const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };

    /** Lógica pura: actas + marcas → filas de sustitución y resumen por producto (solo las no cuadradas). */
    function calcular(actas, marcas) {
        marcas = marcas || {};
        const filas = [];
        (actas || []).filter(a => a && a.estado !== 'ANULADA').forEach(a => (a.items || []).forEach((i, k) => {
            if (!i.entregaFisica || !i.entregaFisica.nombre || num(i.cantidad) <= 0) return;
            const key = `${a.numero}#${k}`;
            filas.push({ key, acta: a.numero, fecha: a.fecha, centro: a.centro, enActa: i.nombre, codigoActa: i.codigoMP || '', fisico: i.entregaFisica.nombre, codigoFisico: i.entregaFisica.codigoMP || '', cantidad: num(i.cantidad), marca: marcas[key] || null });
        }));
        filas.sort((x, y) => String(y.fecha).localeCompare(String(x.fecha)) || String(y.acta).localeCompare(String(x.acta)));
        const res = new Map();
        const sumar = (nombre, codigo, d) => { const k = norm(nombre), r = res.get(k) || { nombre, codigo: codigo || '', ajuste: 0 }; r.ajuste += d; if (!r.codigo && codigo) r.codigo = codigo; res.set(k, r); };
        filas.filter(f => !f.marca).forEach(f => { sumar(f.enActa, f.codigoActa, +f.cantidad); sumar(f.fisico, f.codigoFisico, -f.cantidad); });
        return { filas, resumen: [...res.values()].filter(r => r.ajuste !== 0).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) };
    }

    let datos = { filas: [], resumen: [] }, marcas = {}, verTodo = false;
    const refMarcas = () => fs().doc(fs().collection(db(), 'Contadores'), 'cuadre-sustituciones');
    async function traer() {
        const f = fs();
        const [sa, sm] = await Promise.all([
            f.getDocs(f.query(f.collection(db(), 'Actas_Entrega'), f.orderBy('creadoEn', 'desc'), f.limit(600))),
            f.getDoc(refMarcas()).catch(() => null)
        ]);
        const actas = []; sa.forEach(d => actas.push({ id: d.id, ...d.data() }));
        marcas = (sm && sm.exists() && sm.data().marcas) || {};
        datos = calcular(actas, marcas);
    }
    async function marcar(keys, quitar) {
        const f = fs(); const nuevas = { ...marcas };
        keys.forEach(k => { if (quitar) delete nuevas[k]; else nuevas[k] = { por: usuario(), fecha: new Date().toISOString().slice(0, 10) }; });
        await f.setDoc(refMarcas(), { marcas: nuevas, actualizado: new Date().toISOString() });
        marcas = nuevas;
    }

    function pintar() {
        const r = root(); if (!r) return;
        const pend = datos.filas.filter(f => !f.marca), ver = verTodo ? datos.filas : pend;
        const signo = (n) => (n > 0 ? '+' : '') + n;
        r.innerHTML = `<div class="sus-w">
          <h2>Cuadre de sustituciones</h2>
          <p class="act-hint">Uso interno: aquí queda registrado cuando en un acta se entregó físicamente un producto similar al pedido. El acta que ve el centro no cambia. Con esto cuadras sistema vs. bodega física.</p>
          <div class="sus-acc"><button type="button" class="btn btn-outline btn-sm" id="sus-rec">Actualizar</button>
            <label class="sus-chk"><input type="checkbox" id="sus-todo"${verTodo ? ' checked' : ''}> Ver también las ya cuadradas</label></div>
          <h3>Qué ajustar (${datos.resumen.length} producto(s))</h3>
          ${datos.resumen.length ? `<table class="sus-t"><thead><tr><th>Producto</th><th>ID</th><th>Ajuste físico vs sistema</th><th>Qué significa</th></tr></thead><tbody>${datos.resumen.map(x => `<tr><td>${esc(x.nombre)}</td><td>${esc(x.codigo)}</td><td class="n"><b class="${x.ajuste > 0 ? 'sus-mas' : 'sus-menos'}">${signo(x.ajuste)}</b></td><td>${x.ajuste > 0 ? `El sistema ya descontó ${x.ajuste} u. pero físicamente siguen en bodega: físico ${x.ajuste} más que el sistema.` : `Físicamente salieron ${-x.ajuste} u. pero el sistema aún las muestra: físico ${-x.ajuste} menos que el sistema.`}</td></tr>`).join('')}</tbody></table>` : '<p class="act-hint">Todo cuadrado: no hay sustituciones pendientes.</p>'}
          <h3>Detalle por acta (${pend.length} pendiente(s))</h3>
          ${ver.length ? `<table class="sus-t"><thead><tr><th>Acta</th><th>Fecha</th><th>Centro</th><th>En el acta figura</th><th>Se entregó físicamente</th><th>Cant.</th><th></th></tr></thead><tbody>${ver.map(f => `<tr${f.marca ? ' class="sus-ok"' : ''}><td>${esc(f.acta)}</td><td>${esc(f.fecha)}</td><td>${esc(f.centro)}</td><td>${esc(f.enActa)}${f.codigoActa ? '<br><small>ID ' + esc(f.codigoActa) + '</small>' : ''}</td><td>${esc(f.fisico)}${f.codigoFisico ? '<br><small>ID ' + esc(f.codigoFisico) + '</small>' : ''}</td><td class="n"><b>${f.cantidad}</b></td><td>${f.marca ? `<small>Cuadrada ${esc(f.marca.fecha)}</small> <button type="button" class="btn btn-outline btn-sm" data-sus-q="${esc(f.key)}">Deshacer</button>` : `<button type="button" class="btn btn-outline btn-sm" data-sus-m="${esc(f.key)}">Marcar cuadrada</button>`}</td></tr>`).join('')}</tbody></table>${pend.length > 1 ? '<div class="sus-acc"><button type="button" class="btn btn-outline btn-sm" id="sus-todas">Marcar todas como cuadradas</button></div>' : ''}` : '<p class="act-hint">Aún no hay actas con sustituciones. En el acta, escribe en "¿Entregas físicamente otro similar?" el producto que realmente sale.</p>'}
        </div>`;
        const go = async (keys, q) => { try { await marcar(keys, q); await traer(); pintar(); } catch (e) { toast('Cuadre', 'No se pudo guardar: ' + (e.message || e), 'error'); } };
        r.querySelector('#sus-rec').addEventListener('click', abrir);
        r.querySelector('#sus-todo').addEventListener('change', (e) => { verTodo = e.target.checked; pintar(); });
        r.querySelectorAll('[data-sus-m]').forEach(b => b.addEventListener('click', () => go([b.dataset.susM], false)));
        r.querySelectorAll('[data-sus-q]').forEach(b => b.addEventListener('click', () => go([b.dataset.susQ], true)));
        const t = r.querySelector('#sus-todas'); if (t) t.addEventListener('click', () => { if (confirm('¿Marcar todas las sustituciones pendientes como cuadradas? Confirma que ya ajustaste el stock físico y el sistema.')) go(pend.map(f => f.key), false); });
    }
    async function abrir() {
        const r = root(); if (!r) return;
        r.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Revisando las sustituciones…') : 'Cargando…';
        try { await traer(); pintar(); } catch (e) { r.innerHTML = `<p class="act-err" style="padding:24px;">No se pudo cargar: ${esc(e.message || e)}</p>`; }
    }
    window.SAR_Sustituciones = { abrir, calcular };
    if (typeof module !== 'undefined') module.exports = window.SAR_Sustituciones;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
