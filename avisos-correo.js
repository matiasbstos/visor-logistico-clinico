/* ==========================================================================
   AVISOS POR CORREO DE ACTAS Y MOVIMIENTOS (v21.51)
   Misma identidad visual y mismos destinatarios que el correo de recepción (María, compras SAR y
   Matías). Dos caminos:
   1) Actas de entrega: emisión, confirmación de entrega, acta firmada y eliminación llevan el
      detalle de lo entregado y el PDF (o el acta firmada) adjunto. Cada envío queda registrado en
      Contadores/aviso-<acta>-<evento> y se muestra en la bitácora del acta.
   2) Movimientos de inventario (ajustes, traspasos entre bodegas, ingresos, mermas, cierres…):
      un oyente de Historial_Movimientos agrupa lo que escribe ESTE navegador y manda un solo correo
      por operación. Los consumos del día a día (salidas a paciente) y los movimientos que ya
      tienen su propio correo no se avisan.
   Si el envío automático no está configurado no abre borradores: queda registrado como "sin enviar".
   ========================================================================== */
(function (window) {
    'use strict';
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const SO = () => window.SAR_SeguimientoOC;
    const num = (v) => Number(v) || 0;
    const DESTINOS = ['mariel.quintanilla@cormumel.cl', 'compras.sar@cormumel.cl', 'matias.bustos@cormumel.cl'];
    const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || 'Usuario'; };

    // Tipo de movimiento → [título del correo, avisar?]
    const TIPOS = {
        ajuste: 'Ajuste de inventario', AJUSTE_CRITICO: 'Ajuste crítico de inventario', auditoria_modificacion_inventario: 'Modificación de inventario',
        traspaso: 'Traspaso entre bodegas', entrada: 'Ingreso de productos', 'carga masiva': 'Carga masiva de productos', INGRESO_PROVEEDOR: 'Ingreso de proveedor', INGRESO_INVENTARIO: 'Ingreso de inventario',
        merma_despacho: 'Merma', merma_inventario: 'Merma de inventario', eliminacion_inventario: 'Eliminación de inventario', toma_inventario: 'Toma de inventario',
        reinicio_total: 'Reinicio total del inventario', CIERRE_BODEGA: 'Cierre de bodega', EDICION_ACTA: 'Edición de acta de entrega', ANULACION_RECEPCION: 'Anulación de recepción'
    };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    async function listo() {
        const so = SO(); if (!so) return null;
        try { if (so.cargarConfig) await so.cargarConfig(); } catch (e) { /* sin permiso */ }
        return so;
    }
    function aB64(bytes) { const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let b = ''; for (let i = 0; i < u.length; i += 0x8000) b += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(b); }
    const fechaHora = (d) => (d || new Date()).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    /**
     * Arma y envía un aviso. o: { id (para registrar), titulo, sujeto, asunto, intro, filas:[{nombre,cantidad,extra}], notas:[], adjuntos:[{name,mime,bytes}], actaId }
     * Devuelve el estado ('enviado' | 'error' | 'sin_configurar' | …). Nunca lanza.
     */
    async function avisar(o) {
        let res = { estado: 'error', detalle: 'sin módulo de correo' };
        try {
            const so = await listo(); const H = window.SAR_CorreoHTML;
            const texto = [o.intro || '', ...(o.filas || []).map(x => `- ${x.nombre}: ${num(x.cantidad)} un.${x.extra ? ' · ' + x.extra : ''}`), ...(o.notas || [])].filter(Boolean).join('\n');
            const cuando = fechaHora();
            if (!so || !so.enviarCorreo || !H) res = { estado: 'error', detalle: 'El módulo de correo no está cargado.' };
            else if (!so.configurado || !so.configurado()) res = { estado: 'sin_configurar', destinatarios: DESTINOS };
            else {
                const html = H.armar({ titulo: o.titulo, texto, autor: usuario() + ' · ' + cuando, orden: { numeroOC: '', proveedor: '' }, sujeto: o.sujeto });
                const adj = (o.adjuntos || []).map(a => ({ name: a.name, mime: a.mime || 'application/pdf', base64: aB64(a.bytes) }));
                const plano = `${o.titulo}\n${o.sujeto || ''}\n${cuando} · ${usuario()}\n\n${texto}\n\nCorreo de respaldo generado automáticamente por el sistema Visor Logístico SAR.`;
                res = await so.enviarCorreo(o.destinos && o.destinos.length ? o.destinos : DESTINOS, { subject: o.asunto, text: plano, html }, { attachments: adj, respaldo: true, avisoId: o.id || '' });
            }
        } catch (e) { res = { estado: 'error', detalle: String((e && e.message) || e) }; }
        if (o.id) {
            try {
                await fs().setDoc(fs().doc(fs().collection(db(), 'Contadores'), o.id), { tipo: 'aviso-correo', actaId: o.actaId || '', evento: o.evento || '', titulo: o.titulo, asunto: o.asunto, estado: res.estado, detalle: res.detalle || '', destinatarios: res.destinatarios || (o.destinos && o.destinos.length ? o.destinos : DESTINOS), adjuntos: (o.adjuntos || []).map(a => a.name), por: usuario(), fecha: new Date().toISOString(), updatedAt: fs().serverTimestamp() });
            } catch (e) { /* el registro es secundario */ }
        }
        return res;
    }

    /** Lee los avisos registrados de un acta: [{evento, estado, fecha, destinatarios, adjuntos, titulo}] */
    async function avisosDeActa(numero) {
        const out = [];
        for (const ev of ['emision', 'confirmacion', 'firmada', 'anulacion']) {
            try { const d = await fs().getDoc(fs().doc(fs().collection(db(), 'Contadores'), `aviso-${numero}-${ev}`)); if (d.exists()) out.push({ evento: ev, ...d.data() }); } catch (e) { /* sin permiso */ }
        }
        return out;
    }

    const filasActa = (a) => (a.items || []).map(i => ({ nombre: i.nombre, cantidad: i.cantidad, extra: i.codigoMP ? 'Cód. ' + i.codigoMP : '' }));
    const baseActa = (a) => `Acta ${a.numero} · entrega a ${a.centro} desde ${a.bodegaOrigen}`;
    /** evento: 'emision' | 'confirmacion' | 'firmada' | 'anulacion'. extra: { pdf:{bytes,nombre}, firmada:{bytes,mime,nombre}, motivo } */
    function avisarActa(evento, a, extra) {
        extra = extra || {};
        const T = { emision: 'Acta de entrega emitida', confirmacion: 'Entrega confirmada · stock descontado', firmada: 'Acta firmada guardada', anulacion: 'Acta de entrega eliminada' }[evento];
        const notas = [];
        if (evento === 'emision') notas.push('El stock sigue en bodega (reservado) hasta que se suba el acta firmada y se confirme la entrega.');
        if (evento === 'confirmacion') notas.push(`Entrega confirmada el ${fechaHora()} por ${usuario()}. Se descontó el stock de ${a.bodegaOrigen}.`);
        if (evento === 'firmada') notas.push('Se guardó el respaldo firmado. El stock no cambia con esta acción.');
        if (evento === 'anulacion') notas.push(`Motivo: ${extra.motivo || '—'}. ${a.stockDescontado === false ? 'El stock no se había descontado.' : 'El stock volvió a la bodega de origen.'}`);
        if ((a.pendientes || []).length) notas.push('Pendientes del centro: ' + a.pendientes.map(p => `${p.nombre} (${p.cantidad} u.)`).join('; '));
        if (a.recibe && a.recibe.nombre) notas.push(`Recibe: ${a.recibe.nombre}${a.recibe.cargo ? ' (' + a.recibe.cargo + ')' : ''}.`);
        const adj = [];
        if (extra.pdf) adj.push({ name: extra.pdf.nombre, mime: 'application/pdf', bytes: extra.pdf.bytes });
        if (extra.firmada) adj.push({ name: extra.firmada.nombre, mime: extra.firmada.mime, bytes: extra.firmada.bytes });
        return avisar({ id: `aviso-${a.numero}-${evento}`, actaId: a.numero, evento, titulo: T, sujeto: `Acta ${a.numero}`, asunto: `[Visor SAR] ${T} · ${a.numero} · ${a.centro}`, intro: baseActa(a), filas: filasActa(a), notas, adjuntos: adj });
    }

    // ---------------- movimientos de inventario ----------------
    const buf = new Map(); let iniciado = false;
    function volcar(clave) {
        const g = buf.get(clave); buf.delete(clave); if (!g || !g.filas.length) return;
        const t = TIPOS[g.type] || 'Movimiento de inventario';
        const ruta = g.origen || g.dest ? `${g.origen || '—'} → ${g.dest || '—'}` : '';
        const total = g.filas.reduce((s, x) => s + num(x.cantidad), 0);
        avisar({ id: `aviso-mov-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, evento: 'movimiento', titulo: t, sujeto: g.doc ? `Documento ${g.doc}` : t, asunto: `[Visor SAR] ${t}${ruta ? ' · ' + ruta : ''}`, intro: `${t}${ruta ? ' · ' + ruta : ''} · ${g.filas.length} producto${g.filas.length === 1 ? '' : 's'} (${total} u.)`, filas: g.filas, notas: [...new Set(g.notas)].slice(0, 6), actaId: g.acta || '' });
    }
    function entra(m) {
        const t = String(m.type || ''); if (!TIPOS[t]) return;
        if (m.sinEfectoStock) return;
        const clave = [m.user, t, m.document || '', m.origin || '', m.dest || m.destination || ''].join('|');
        const g = buf.get(clave) || { filas: [], notas: [], type: t, doc: m.document || '', origen: m.origin || '', dest: m.dest || m.destination || '', acta: m.actaId || '', t: null };
        g.filas.push({ nombre: m.insumoName || m.item || '—', cantidad: num(m.quantity), extra: [m.batch && m.batch !== 'N/A' && m.batch !== 'MULTI-LOTE' ? 'Lote ' + m.batch : '', m.expirationDate ? 'vence ' + m.expirationDate : ''].filter(Boolean).join(' · ') });
        if (m.observacion) g.notas.push(m.observacion);
        buf.set(clave, g); clearTimeout(g.t); g.t = setTimeout(() => volcar(clave), 4500);
    }
    function iniciar() {
        if (iniciado || !fs() || !fs().onSnapshot || !db()) return; iniciado = true;
        const visto = new Set();
        try {
            fs().onSnapshot(fs().query(fs().collection(db(), 'Historial_Movimientos'), fs().orderBy('date', 'desc'), fs().limit(40)), (sn) => {
                sn.docChanges().forEach(ch => {
                    if (ch.type !== 'added' || !ch.doc.metadata.hasPendingWrites || visto.has(ch.doc.id)) return;   // solo lo que escribió este navegador
                    visto.add(ch.doc.id); entra(ch.doc.data());
                });
            }, () => { /* sin permiso: no hay avisos */ });
        } catch (e) { iniciado = false; }
    }
    function arrancar() {
        const a = window.firebaseAuth; let n = 0;
        const t = setInterval(() => { n++; if (a && a.currentUser && fs() && db()) { clearInterval(t); iniciar(); } else if (n > 120) clearInterval(t); }, 2000);
    }
    arrancar();
    window.SAR_Avisos = { avisar, avisarActa, avisosDeActa, DESTINOS, TIPOS };
})(typeof window !== 'undefined' ? window : globalThis);
