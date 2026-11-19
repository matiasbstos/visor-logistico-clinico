/* ==========================================================================
   RESPALDO SEMANAL EN EXCEL POR CORREO (v21.237)
   Como en otros sistemas de inventario (informe programado + copia fuera del sistema, regla 3-2-1):
   una vez por semana se arma un Excel con el inventario completo y se envía por correo a las
   casillas configuradas en Configuración → «Respaldo semanal en Excel».
   - Lo dispara el primer equipo del personal que abre el Visor desde el día configurado (lunes por
     defecto). No hay servidor: igual que el respaldo diario, se usa el navegador.
   - Una sola vez por semana: Contadores/respaldo-semanal-AAAA-Sxx se reserva en una transacción
     (si dos equipos abren a la vez, envía uno). Si el correo falla, queda en la cola de correos
     (reintento solo en horario hábil) o se puede reintentar desde el panel.
   - El correo sale por el mismo Apps Script de «Configurar correo» (adjunto en base64).
   Hojas: Inventario (por lote), Resumen por bodega, Por vencer (≤ 90 días), Actas por confirmar,
   Información (fecha, conteos y suma de control).
   ========================================================================== */
(function (window, document) {
    'use strict';
    const STAFF = ['admin', 'administrador', 'operador', 'global', 'superadmin'];
    const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const emailOk = (e) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(e || '').trim());

    // ---------------- puros ----------------
    /** Semana ISO: 2026-11-19 → «2026-S47». */
    function semanaISO(d) {
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), dia = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - dia);
        const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)), w = Math.ceil(((t - y0) / 86400000 + 1) / 7);
        return `${t.getUTCFullYear()}-S${String(w).padStart(2, '0')}`;
    }
    /** ¿Ya toca enviar esta semana? (desde el día configurado; 1 = lunes … 7 = domingo) */
    function toca(d, diaCfg) { const hoy = d.getDay() || 7, cfg = Math.min(7, Math.max(1, Math.floor(num(diaCfg)) || 1)); return hoy >= cfg; }
    const fechaTxt = (v) => { if (!v) return ''; const t = typeof v.toDate === 'function' ? v.toDate() : new Date(v); return isNaN(t) ? String(v) : t.toISOString().slice(0, 10); };
    const venceTxt = (v) => { const s = String(v || '').trim(); return /^(n\/?a|s\/v|-)$/i.test(s) ? '' : s; };
    function diasA(v, hoy) {
        const s = venceTxt(v); if (!s) return null;
        const p = window.SAR_Utils && window.SAR_Utils.parseDate ? window.SAR_Utils.parseDate(s) : new Date(s);
        if (!p || isNaN(p)) return null;
        return Math.floor((p - hoy) / 86400000);
    }
    /** Filas del Excel a partir de los documentos de Insumos (y actas por confirmar). Puro. */
    function armarFilas(insumos, actas, hoy) {
        hoy = hoy || new Date();
        const inv = [], porBod = new Map(), vencer = [];
        insumos.forEach(x => {
            if (x.status === 'ELIMINADO') return;
            const bod = String(x.location || x.bodegaNombre || 'Sin bodega').trim() || 'Sin bodega';
            const lotes = Array.isArray(x.batches) && x.batches.length ? x.batches : [{ batch: x.batch || 'S/L', quantity: num(x.quantity), expirationDate: x.expirationDate || '' }];
            const precio = num(x.unitPrice), total = num(x.quantity), res = num(x.reservado), sg = num(x.sobregiro);
            const base = { 'Código SAR': x.codigoSAR || x.code || '', 'ID producto (MP)': x.codigoMP || '', 'Producto': x.name || '', 'Categoría': x.category || '', 'Clase': x.tipoInsumo || '', 'Bodega': bod, 'Estante': x.ubicacionEstante || '' };
            const vivos = lotes.filter(l => num(l.quantity) > 0);
            (vivos.length ? vivos : [{ batch: '', quantity: 0, expirationDate: '' }]).forEach((l, i) => {
                inv.push({ ...base, 'Lote': l.batch || '', 'Vence': venceTxt(l.expirationDate), 'Cantidad del lote': num(l.quantity), 'U. por caja': num(l.porCaja) || '',
                    'Total disponible del producto': i === 0 ? total : '', 'Reservado (actas por confirmar)': i === 0 && res ? res : '', 'Adeudado (sobregiro)': i === 0 && sg ? sg : '',
                    'Costo unitario': precio || '', 'Valor del lote': precio ? Math.round(precio * num(l.quantity)) : '', 'Estado': x.status || 'ACTIVO', 'ID interno': x._id || '' });
                const d = diasA(l.expirationDate, hoy);
                if (num(l.quantity) > 0 && d !== null && d <= 90) vencer.push({ 'Producto': x.name || '', 'Bodega': bod, 'Lote': l.batch || '', 'Vence': venceTxt(l.expirationDate), 'Días': d, 'Cantidad': num(l.quantity), 'Situación': d < 0 ? 'VENCIDO' : d <= 30 ? '≤ 30 días' : '≤ 90 días' });
            });
            const b = porBod.get(bod) || { 'Bodega': bod, 'Productos con stock': 0, 'Unidades disponibles': 0, 'Unidades reservadas': 0, 'Unidades adeudadas': 0, 'Valor (costo unitario)': 0 };
            if (total > 0) b['Productos con stock']++;
            b['Unidades disponibles'] += total; b['Unidades reservadas'] += res; b['Unidades adeudadas'] += sg; b['Valor (costo unitario)'] += Math.round(precio * total);
            porBod.set(bod, b);
        });
        inv.sort((a, b) => a['Bodega'].localeCompare(b['Bodega'], 'es') || String(a['Producto']).localeCompare(String(b['Producto']), 'es'));
        vencer.sort((a, b) => a['Días'] - b['Días']);
        const pend = (actas || []).filter(a => a.estado === 'EMITIDA' && a.confirmacion && a.confirmacion.estado === 'PENDIENTE').flatMap(a => (a.items || []).map(i => ({
            'Acta': a.numero || a._id || '', 'Fecha': a.fecha || fechaTxt(a.creadoEn), 'Centro': a.centro || '', 'Bodega de origen': a.bodegaOrigen || '', 'Producto': i.nombre || '', 'Cantidad': num(i.cantidad), 'Reservado en stock': i.reserva ? num(i.reserva.qty) : '' })));
        const resumen = [...porBod.values()].sort((a, b) => a['Bodega'].localeCompare(b['Bodega'], 'es'));
        const tot = resumen.reduce((t, b) => ({ u: t.u + b['Unidades disponibles'], r: t.r + b['Unidades reservadas'], v: t.v + b['Valor (costo unitario)'], p: t.p + b['Productos con stock'] }), { u: 0, r: 0, v: 0, p: 0 });
        resumen.push({ 'Bodega': 'TOTAL', 'Productos con stock': tot.p, 'Unidades disponibles': tot.u, 'Unidades reservadas': tot.r, 'Unidades adeudadas': resumen.reduce((t, b) => t + b['Unidades adeudadas'], 0), 'Valor (costo unitario)': tot.v });
        return { inv, resumen, vencer, pend, totales: { productos: insumos.length, filas: inv.length, unidades: tot.u, reservadas: tot.r, valor: tot.v, bodegas: porBod.size, actasPend: new Set(pend.map(p => p['Acta'])).size } };
    }
    function suma(txt) { let h = 2166136261; for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }

    // ---------------- Excel ----------------
    function libro(f, semana, ahora, usuario) {
        const X = window.XLSX; if (!X) throw new Error('La librería de Excel aún no carga.');
        const wb = X.utils.book_new(), hoja = (filas, nombre, anchos) => { const ws = X.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin datos' }]); if (anchos) ws['!cols'] = anchos.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, nombre); };
        hoja(f.inv, 'Inventario', [12, 12, 44, 16, 10, 22, 10, 14, 12, 10, 8, 12, 12, 12, 10, 12, 10, 22]);
        hoja(f.resumen, 'Resumen por bodega', [26, 12, 14, 14, 14, 16]);
        hoja(f.vencer, 'Por vencer (90 días)', [44, 22, 14, 12, 8, 10, 12]);
        hoja(f.pend, 'Actas por confirmar', [16, 12, 26, 22, 44, 10, 12]);
        const control = suma(JSON.stringify(f.inv));
        hoja([
            { 'Dato': 'Sistema', 'Valor': 'Visor Logístico Clínico · SAR' }, { 'Dato': 'Semana', 'Valor': semana }, { 'Dato': 'Generado', 'Valor': ahora.toLocaleString('es-CL') }, { 'Dato': 'Generado por', 'Valor': usuario || '' },
            { 'Dato': 'Productos (registros)', 'Valor': f.totales.productos }, { 'Dato': 'Filas por lote', 'Valor': f.totales.filas }, { 'Dato': 'Bodegas', 'Valor': f.totales.bodegas },
            { 'Dato': 'Unidades disponibles', 'Valor': f.totales.unidades }, { 'Dato': 'Unidades reservadas por actas', 'Valor': f.totales.reservadas }, { 'Dato': 'Actas por confirmar', 'Valor': f.totales.actasPend },
            { 'Dato': 'Valor total (costo unitario registrado)', 'Valor': f.totales.valor }, { 'Dato': 'Suma de control (hoja Inventario)', 'Valor': control },
            { 'Dato': 'Nota', 'Valor': 'Copia de respaldo de solo lectura. Para restaurar se usa la copia diaria (Configuración → Respaldo diario) con revisión previa.' }
        ], 'Información', [36, 70]);
        return { wb, control };
    }
    const bytesAb64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

    // ---------------- Firestore ----------------
    const F = () => window.firebaseFirestore, DB = () => window.firebaseDb;
    const usuario = () => (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || '';
    async function config() {
        const f = F(); const s = await f.getDoc(f.doc(f.collection(DB(), 'Config_Correo'), 'principal'));
        const c = (s.exists() && s.data().respaldoSemanal) || {};
        return { activo: !!c.activo, destinatarios: (c.destinatarios || []).filter(emailOk), dia: Math.min(7, Math.max(1, Math.floor(num(c.dia)) || 1)) };
    }
    async function leerDatos() {
        const f = F(), db = DB(), ins = [], actas = [];
        (await f.getDocs(f.query(f.collection(db, 'Insumos'), f.limit(10000)))).forEach(d => ins.push({ _id: d.id, ...d.data() }));
        try { (await f.getDocs(f.query(f.collection(db, 'Actas_Entrega'), f.where('confirmacion.estado', '==', 'PENDIENTE'), f.limit(500)))).forEach(d => actas.push({ _id: d.id, ...d.data() })); } catch (e) { /* sin índice o permiso: la hoja sale vacía */ }
        return { ins, actas };
    }
    /** Arma el Excel (Uint8Array) con el inventario actual. */
    async function generar() {
        const ahora = new Date(), semana = semanaISO(ahora), { ins, actas } = await leerDatos();
        const filas = armarFilas(ins, actas, ahora), { wb, control } = libro(filas, semana, ahora, usuario());
        const bytes = new Uint8Array(window.XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }));
        return { bytes, nombre: `Respaldo_Inventario_SAR_${ahora.toLocaleDateString('sv-SE')}_${semana}.xlsx`, semana, filas, control };
    }
    function descargarBytes(bytes, nombre) {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = nombre;
        document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    /** Envía el respaldo de la semana. forzar = desde el panel (aunque ya se haya enviado). */
    async function enviar(opc) {
        opc = opc || {}; const f = F(), db = DB(), S = window.SAR_SeguimientoOC; if (!f || !db) return { estado: 'sin_conexion' };
        if (!S || !S.enviarCorreo) return { estado: 'sin_correo' };
        if (S.cargarConfig) await S.cargarConfig();
        const cfg = await config(); if (!cfg.destinatarios.length) return { estado: 'sin_destinatarios' };
        if (!opc.forzar && !cfg.activo) return { estado: 'inactivo' };
        const ahora = new Date(), semana = semanaISO(ahora), ref = f.doc(f.collection(db, 'Contadores'), `respaldo-semanal-${semana}`);
        if (!opc.forzar && !toca(ahora, cfg.dia)) return { estado: 'aun_no' };
        /* reserva: solo un equipo envía por semana (si quedó «en curso» más de 30 min, se retoma) */
        const tomado = await f.runTransaction(db, async (tx) => {
            const s = await tx.get(ref), d = s.exists() ? s.data() : null;
            if (d && !opc.forzar && (['enviado', 'programado'].includes(d.estado) || (d.estado === 'en curso' && Date.now() - num(d.enMs) < 1800000))) return false;
            tx.set(ref, { tipo: 'respaldo-semanal', semana, estado: 'en curso', enMs: Date.now(), por: usuario(), intentos: num(d && d.intentos) + 1, actualizado: new Date().toISOString() });
            return true;
        });
        if (!tomado) return { estado: 'ya_enviado' };
        try {
            const g = await generar(), t = g.filas.totales;
            const texto = `Respaldo semanal del inventario (${semana}).\n\nAdjunto: ${g.nombre}\n- ${t.productos} productos, ${t.filas} filas por lote, ${t.bodegas} bodegas\n- ${t.unidades.toLocaleString('es-CL')} unidades disponibles · ${t.reservadas.toLocaleString('es-CL')} reservadas por ${t.actasPend} actas por confirmar\n- Suma de control: ${g.control}\n\nGuarde este correo: es una copia fuera del sistema. Generado automáticamente por el Visor Logístico Clínico.`;
            const html = `<p>Respaldo semanal del inventario <b>${esc(semana)}</b>.</p><ul><li>${t.productos} productos · ${t.filas} filas por lote · ${t.bodegas} bodegas</li><li>${t.unidades.toLocaleString('es-CL')} unidades disponibles · ${t.reservadas.toLocaleString('es-CL')} reservadas por ${t.actasPend} actas por confirmar</li><li>Suma de control: <code>${esc(g.control)}</code></li></ul><p>Adjunto: <b>${esc(g.nombre)}</b> (hojas: Inventario, Resumen por bodega, Por vencer, Actas por confirmar, Información).</p><p style="color:#64748b">Guarde este correo: es una copia fuera del sistema. Generado automáticamente por el Visor Logístico Clínico.</p>`;
            const r = await S.enviarCorreo(cfg.destinatarios, { subject: `Respaldo semanal de inventario SAR · ${semana}`, text: texto, html }, { respaldo: true, attachments: [{ name: g.nombre, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: bytesAb64(g.bytes) }] });
            const estado = r.estado === 'enviado' ? 'enviado' : r.estado === 'programado' ? 'programado' : 'error';
            await f.setDoc(ref, { tipo: 'respaldo-semanal', semana, estado, enMs: Date.now(), por: usuario(), archivo: g.nombre, control: g.control, filas: t.filas, unidades: t.unidades, destinatarios: cfg.destinatarios, detalle: String(r.detalle || r.estado || ''), actualizado: new Date().toISOString() }, { merge: true });
            return { estado, detalle: r.detalle || '', archivo: g.nombre };
        } catch (e) {
            try { await f.setDoc(ref, { estado: 'error', detalle: String((e && e.message) || e), enMs: Date.now(), actualizado: new Date().toISOString() }, { merge: true }); } catch (x) { /* sin conexión */ }
            return { estado: 'error', detalle: String((e && e.message) || e) };
        }
    }

    // ---------------- panel en Configuración ----------------
    const esAdmin = () => ['admin', 'administrador', 'superadmin', 'global'].includes(String(document.body.dataset.userRole || '').toLowerCase());
    async function ultimos() {
        const f = F(), out = [], hoy = new Date();
        for (let i = 0; i < 4; i++) { const sem = semanaISO(new Date(hoy.getTime() - i * 7 * 86400000)); try { const s = await f.getDoc(f.doc(f.collection(DB(), 'Contadores'), `respaldo-semanal-${sem}`)); if (s.exists()) out.push(s.data()); } catch (e) { /* sin permiso */ } }
        return out;
    }
    async function panel() {
        const v = document.getElementById('view-configuracion'); if (!v || !F()) return;
        let sec = document.getElementById('bks-panel');
        if (!sec) { sec = document.createElement('div'); sec.id = 'bks-panel'; sec.className = 'bk-panel'; const diario = document.getElementById('bk-panel'); if (diario && diario.parentNode) diario.parentNode.insertBefore(sec, diario.nextSibling); else (v.querySelector('.dashboard-container') || v).appendChild(sec); }
        sec.innerHTML = '<h3>Respaldo semanal en Excel</h3><p class="act-hint">Cargando…</p>';
        let cfg = { activo: false, destinatarios: [], dia: 1 }, l = []; try { cfg = await config(); l = await ultimos(); } catch (e) { /* sin permiso */ }
        const adm = esAdmin(), est = { enviado: ['bk-ok', 'Enviado'], programado: ['', 'En cola (sale en horario hábil)'], error: ['bk-mal', 'Error'], 'en curso': ['', 'En curso'] };
        sec.innerHTML = `<h3>Respaldo semanal en Excel</h3>
          <p class="act-hint">Una vez por semana, desde el día elegido, el primer equipo que abre el Visor envía por correo un Excel con el inventario completo (por lote, con bodega, vencimiento, reservado y valor), un resumen por bodega, lo que vence en 90 días y las actas por confirmar. Es la copia «fuera del sistema» (regla 3-2-1): consérvala en el correo institucional.</p>
          <div class="bks-form">
            <label class="bks-chk"><input type="checkbox" id="bks-activo" ${cfg.activo ? 'checked' : ''} ${adm ? '' : 'disabled'}> Enviar automáticamente cada semana</label>
            <label>Correos que lo reciben <small>(separados por coma)</small><input type="text" class="form-control" id="bks-dest" value="${esc(cfg.destinatarios.join(', '))}" placeholder="bodega@…, jefatura@…" ${adm ? '' : 'disabled'}></label>
            <label>Desde el día<select class="form-control" id="bks-dia" ${adm ? '' : 'disabled'}>${[1, 2, 3, 4, 5].map(d => `<option value="${d}"${cfg.dia === d ? ' selected' : ''}>${DIAS[d]}</option>`).join('')}</select></label>
          </div>
          ${l.length ? `<div class="sal-tabla">${l.map(m => { const e = est[m.estado] || ['', m.estado]; return `<div class="bk-fila"><div><b>${esc(m.semana)}</b> <span class="bk-res ${e[0]}">${esc(e[1])}</span><small>${esc(m.archivo || '')}${m.filas ? ' · ' + num(m.filas) + ' filas' : ''}${m.control ? ' · control ' + esc(m.control) : ''} · por ${esc(m.por || '—')} · ${esc(String(m.actualizado || '').slice(0, 16).replace('T', ' '))}${m.estado === 'error' && m.detalle ? ' · ' + esc(m.detalle) : ''}</small></div></div>`; }).join('')}</div>` : '<p class="act-hint">Aún no se ha enviado ningún respaldo semanal.</p>'}
          <div class="bk-pie bks-pie">${adm ? '<button type="button" class="btn btn-primary btn-sm" id="bks-guardar">Guardar</button> <button type="button" class="btn btn-outline btn-sm" id="bks-enviar">Enviar ahora</button> ' : ''}<button type="button" class="btn btn-outline btn-sm" id="bks-bajar">Descargar el Excel</button></div>`;
        const toast = (t, m, k) => { if (window.showToast) window.showToast(t, m, k); };
        sec.querySelector('#bks-bajar').addEventListener('click', async (e) => { const b = e.currentTarget; b.disabled = true; try { const g = await generar(); descargarBytes(g.bytes, g.nombre); } catch (x) { toast('Respaldo', 'No se pudo armar el Excel: ' + (x.message || x), 'error'); } b.disabled = false; });
        const g = sec.querySelector('#bks-guardar');
        if (g) g.addEventListener('click', async () => {
            const dest = String(sec.querySelector('#bks-dest').value || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean), malos = dest.filter(d => !emailOk(d));
            if (malos.length) { toast('Correos', 'Revisa: ' + malos.join(', '), 'warning'); return; }
            const activo = sec.querySelector('#bks-activo').checked; if (activo && !dest.length) { toast('Correos', 'Indica al menos un correo para activar el envío.', 'warning'); return; }
            g.disabled = true;
            try { const f = F(); await f.setDoc(f.doc(f.collection(DB(), 'Config_Correo'), 'principal'), { respaldoSemanal: { activo, destinatarios: dest, dia: Number(sec.querySelector('#bks-dia').value) || 1, por: usuario(), actualizado: new Date().toISOString() } }, { merge: true }); toast('Respaldo semanal', activo ? 'Guardado: se enviará cada semana.' : 'Guardado (envío automático apagado).', 'success'); panel(); }
            catch (x) { toast('No se guardó', x.message || String(x), 'error'); g.disabled = false; }
        });
        const en = sec.querySelector('#bks-enviar');
        if (en) en.addEventListener('click', async () => {
            const ok = window.SAR_Progreso && window.SAR_Progreso.confirmar ? await window.SAR_Progreso.confirmar({ titulo: '¿Enviar el respaldo ahora?', texto: `Se arma el Excel con el inventario actual y se envía a: <b>${esc(cfg.destinatarios.join(', ') || '(sin correos guardados)')}</b>.`, si: 'Enviar', no: 'Cancelar' }) : true;
            if (!ok) return; en.disabled = true; en.textContent = 'Enviando…';
            const r = await enviar({ forzar: true });
            const msg = { enviado: ['Respaldo enviado', 'success'], programado: ['Quedó en la cola de correos: sale solo en horario hábil (lunes a viernes, 8 a 17 h).', 'info'], sin_destinatarios: ['Guarda primero los correos que lo reciben.', 'warning'], sin_correo: ['Falta configurar el correo (Seguimiento OC → Configurar correo).', 'warning'], error: ['No se pudo enviar: ' + (r.detalle || ''), 'error'] }[r.estado] || [r.estado, 'info'];
            toast('Respaldo semanal', msg[0], msg[1]); panel();
        });
    }
    function iniciar() {
        let n = 0; const t = setInterval(() => {
            n++; const rol = String(document.body.dataset.userRole || '').toLowerCase();
            if (n > 120) { clearInterval(t); return; }
            if (STAFF.includes(rol) && F() && DB() && window.XLSX && window.SAR_SeguimientoOC) { clearInterval(t); setTimeout(() => enviar().catch(() => {}), 45000); }
        }, 2500);
        const m = document.querySelector('.menu-item[data-target="view-configuracion"]'); if (m) m.addEventListener('click', () => setTimeout(panel, 600));
    }
    if (typeof document !== 'undefined' && document.body) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar(); }
    window.SAR_RespaldoSemanal = { semanaISO, toca, armarFilas, generar, enviar, panel };
    if (typeof module !== 'undefined') module.exports = { semanaISO, toca, armarFilas };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : null);
