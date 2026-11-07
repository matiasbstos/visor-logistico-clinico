/* ==========================================================================
   Bitácora de órdenes de compra (v21.44) — estilo "casos/tickets".
   Un script de Apps Script, instalado con la cuenta compras.sar@cormumel.cl, revisa el correo
   (recibidos, enviados y reenviados) 3 veces al día (07:00, 12:00 y 17:00), agrupa los correos por
   N° de orden (1298355-NNN-XX26) y los clasifica (OC, despacho, guía, factura, reclamo, recepción
   conforme…). Esta vista los cruza con Seguimiento_OC (pedido / recibido) y arma un caso por orden:
   estado, faltante, último movimiento y línea de tiempo.
   Configuración (URL + token del script) en Contadores/config-bitacora (sin reglas nuevas).
   ========================================================================== */
(function (window, document) {
    'use strict';
    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (v) => Number(v) || 0;
    const root = () => document.getElementById('bit-root');
    const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
    const CUENTA = 'compras.sar@cormumel.cl';
    const DIAS_SIN_GESTION = 7;

    /** Clave única de una orden: "1298355-936-CM26" (acepta 1298-355-936-CM26, con espacios, etc.). */
    function claveOC(t) {
        const m = /(\d{4})\s?-?\s?(\d{3})\s?-\s?(\d{1,5})\s?-\s?([A-Za-z]{1,3}\d{2})/.exec(String(t || ''));
        return m ? `${m[1]}${m[2]}-${parseInt(m[3], 10)}-${m[4].toUpperCase()}` : '';
    }
    const TIPOS = { CM: 'Convenio Marco', AG: 'Compra Ágil', SE: 'Sin emisión automática', CC: 'Compra Coordinada', MC: 'Microcompra', R1: 'Menor a 3 UTM', CA: 'Sin resolución', D1: 'Trato directo', C1: 'Trato directo', F3: 'Trato directo', G1: 'Trato directo', FG: 'Trato directo', TL: 'Tienda de libros' };
    const tipoDe = (k) => { const m = /-([A-Z]{1,3})\d{2}$/.exec(k || ''); return m ? (TIPOS[m[1]] || m[1]) : ''; };

    const CLASES = {
        oc_enviada: ['ph-file-text', 'Orden / aceptación'], despacho: ['ph-truck', 'Despacho'], guia: ['ph-receipt', 'Guía de despacho'], factura: ['ph-invoice', 'Factura'],
        recepcion_conforme: ['ph-seal-check', 'Recepción conforme'], reclamo: ['ph-warning', 'Reclamo / atraso'], otro: ['ph-envelope-simple', 'Correo']
    };
    const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const digs = (t) => (String(t || '').match(/\d{1,6}/g) || []).map(x => String(parseInt(x, 10)));
    const GENERICAS = new Set(['cesfam', 'cecosf', 'posta', 'comunal', 'salud', 'rural', 'centro', 'familiar', 'sapu', 'sar', 'dir', 'direccion', 'departamento', 'depto', 'municipal', 'corporacion', 'melipilla']);
    const ETIQ_ENT = { ENTREGADO: 'Entregado completo', PARCIAL: 'Entrega parcial', EN_STOCK: 'En bodega, por entregar', RECIBIDO: 'Recibido, sin ingresar', SIN_RECIBIR: 'Aún no llega' };
    const ESTADOS = {
        DISCREPANCIA: { n: 0, cls: 'bit-e-disc', txt: 'Discrepancia', ico: 'ph-warning-octagon' }, SIN_GESTION: { n: 1, cls: 'bit-e-sin', txt: 'Sin gestión', ico: 'ph-clock' }, PARCIAL: { n: 2, cls: 'bit-e-par', txt: 'Parcial', ico: 'ph-chart-pie-slice' },
        GESTION: { n: 3, cls: 'bit-e-ges', txt: 'En gestión', ico: 'ph-chat-circle' }, COMPLETA: { n: 4, cls: 'bit-e-ok', txt: 'Completa', ico: 'ph-check-circle' }, CERRADA: { n: 5, cls: 'bit-e-cer', txt: 'Cerrada', ico: 'ph-lock-simple' }, SOLO_CORREO: { n: 2, cls: 'bit-e-cor', txt: 'Solo en correo', ico: 'ph-envelope-simple', tip: 'Aparece en el correo pero no está ingresada en el Visor' }
    };

    /** Lógica pura: orden del Visor (o null) + correos → caso con estado, faltante y alertas. */
    function calcularCaso(oc, eventos, ahora) {
        ahora = ahora || Date.now();
        const ev = (eventos || []).slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
        const SO = window.SAR_SeguimientoOC;
        const lin = oc && SO && SO.pendientesDe ? SO.pendientesDe(oc) : [];
        const pedido = lin.reduce((t, x) => t + x.pedido, 0), recibido = lin.reduce((t, x) => t + Math.min(x.pedido, x.recibido), 0), falta = Math.max(0, pedido - recibido);
        const dias = (iso) => iso ? Math.floor((ahora - new Date(iso).getTime()) / 86400000) : null;
        const ultimo = ev[0] || null, diasSin = ultimo ? dias(ultimo.fecha) : (oc && oc.creadoEn && oc.creadoEn.toMillis ? Math.floor((ahora - oc.creadoEn.toMillis()) / 86400000) : null);
        const conformes = ev.filter(e => e.clase === 'recepcion_conforme' && e.dir === 'ENVIADO'), ultimaConf = conformes[0] || null;
        const despachos = ev.filter(e => e.clase === 'guia' || e.clase === 'despacho').length;
        const alertas = [];
        const centros = oc && SO && SO.estadoEntregas ? SO.estadoEntregas(oc) : [];
        const otros = centros.filter(x => x.centro !== 'SAR' && (x.entregable > 0 || x.recibido > x.entregado));
        otros.forEach(x => alertas.push(`Para ${x.centro}${x.memo ? ' (memo ' + x.memo + ')' : ''}: ${x.recibido} u. recibidas, ${x.entregado} entregadas${x.entregable > 0 ? ' y ' + x.entregable + ' u. en bodega esperando entrega a ese centro' : ''}. No son stock del SAR.`));
        let estado;
        if (!oc) estado = 'SOLO_CORREO';
        else if (oc.cerrada) estado = 'CERRADA';
        else if (ultimaConf && ultimaConf.declara === 'TOTAL' && falta > 0) { estado = 'DISCREPANCIA'; alertas.push(`El correo de recepción conforme del ${fecha(ultimaConf.fecha)} dice TOTAL, pero en el Visor faltan ${falta} u. por recibir.`); }
        else if (ultimaConf && ultimaConf.declara === 'PARCIAL' && falta === 0 && pedido > 0) { estado = 'DISCREPANCIA'; alertas.push(`El correo de recepción conforme del ${fecha(ultimaConf.fecha)} dice PARCIAL, pero el Visor ya tiene todo recibido: revisa si faltó informar la recepción total.`); }
        else if (pedido > 0 && falta === 0) { estado = 'COMPLETA'; if (!ultimaConf) alertas.push('Está todo recibido, pero no hay correo de recepción conforme enviado.'); }
        else if (recibido > 0) estado = 'PARCIAL';
        else if (!ev.length || (diasSin != null && diasSin > DIAS_SIN_GESTION)) estado = 'SIN_GESTION';
        else estado = 'GESTION';
        if (estado === 'PARCIAL' && diasSin != null && diasSin > DIAS_SIN_GESTION) alertas.push(`Faltan ${falta} u. y no hay movimientos hace ${diasSin} días.`);
        if (estado === 'SIN_GESTION' && !ev.length) alertas.push('No hay ningún correo asociado a esta orden.');
        if (despachos > 1) alertas.push(`El proveedor la despachó en ${despachos} envíos (guías/despachos): el pedido llegó fragmentado.`);
        return { estado, otros: otros.reduce((t, x) => t + Math.max(x.entregable, x.recibido - x.entregado, 0), 0), centros, pedido, recibido, falta, ultimo, diasSin, conformes: conformes.length, ultimaConf, despachos, alertas, eventos: ev, productos: lin.filter(x => x.pendiente > 0) };
    }
    function fecha(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    function fechaHora(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    const hace = (d) => d == null ? 'sin datos' : d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;

    // ---------------------------------------------------------------
    // Datos
    // ---------------------------------------------------------------
    let verMas = false, cfg = { url: '', token: '' }, ordenes = [], correos = null, casos = [], filtro = 'TODOS', texto = '', abierto = null, cargando = false, error = '';
    const refCfg = () => fs().doc(fs().collection(db(), 'Contadores'), 'config-bitacora');
    async function cargarCfg() { try { const s = await fs().getDoc(refCfg()); cfg = s.exists() ? { url: s.data().url || '', token: s.data().token || '' } : { url: '', token: '' }; } catch (e) { /* sin config */ } }
    async function cargarOrdenes() { const sn = await fs().getDocs(fs().query(fs().collection(db(), 'Seguimiento_OC'), fs().limit(500))); ordenes = []; sn.forEach(d => ordenes.push({ id: d.id, ...d.data() })); }
    async function llamar(accion) {
        if (!cfg.url || !cfg.token) throw new Error('Falta configurar el script de la bitácora.');
        const r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: cfg.token, accion }) });
        const j = await r.json(); if (!j || !j.ok) throw new Error((j && j.error) === 'token' ? 'El token no coincide con el del script.' : ((j && j.error) || 'El script no respondió bien.'));
        return j;
    }
    function armarCasos() {
        const porClave = new Map(); ordenes.forEach(o => { const k = claveOC(o.numeroOC); if (k) porClave.set(k, o); });
        const cor = (correos && correos.ocs) || {}, sueltos = (correos && correos.sueltos) || [], claves = new Set([...porClave.keys(), ...Object.keys(cor)]);
        casos = [...claves].map(k => {
            const oc = porClave.get(k) || null; let evs = ((cor[k] && cor[k].eventos) || []).map(e => ({ ...e }));
            if (oc) {
                const memos = new Set((oc.columnas || []).flatMap(c => digs(c.memo))), cdps = new Set((oc.columnas || []).flatMap(c => digs(c.cdp))), ya = new Set(evs.map(e => e.id));
                sueltos.forEach(e => { if (ya.has(e.id)) return; const r = e.refs || {}, m = (r.memo || []).find(x => memos.has(String(parseInt(x, 10)))), c = (r.cdp || []).concat(r.sdc || []).find(x => cdps.has(String(parseInt(x, 10)))); if (m || c) evs.push({ ...e, vinculo: m ? 'memo ' + m : 'CDP/SDC ' + c }); });
                // centros mencionados en cada correo (para ver a quién corresponde lo comprado)
                const otros = [...new Set((oc.columnas || []).map(c => c.centro).filter(x => x && x !== 'SAR'))].map(n => ({ n, t: norm(n).split(' ').filter(w => w.length >= 4 && !GENERICAS.has(w)) })).filter(x => x.t.length);
                evs.forEach(e => { const tx = norm([e.asunto, e.resumen, e.para, e.cc, e.de].join(' ')); const m = otros.filter(x => x.t.some(w => tx.includes(w))).map(x => x.n); if (m.length) e.centros = m; });
            }
            const c = calcularCaso(oc, evs); return { clave: k, oc, ...c };
        });
        casos.sort((a, b) => ESTADOS[a.estado].n - ESTADOS[b.estado].n || b.falta - a.falta || String(b.ultimo ? b.ultimo.fecha : '').localeCompare(String(a.ultimo ? a.ultimo.fecha : '')));
    }

    // ---------------------------------------------------------------
    // Interfaz
    // ---------------------------------------------------------------
    function pintar() {
        const r = root(); if (!r) return;
        const conteo = (e) => casos.filter(c => c.estado === e).length;
        const q = texto.trim().toLowerCase();
        const lista = casos.filter(c => (filtro === 'TODOS' || (filtro === 'OTROS' ? c.otros > 0 : c.estado === filtro)) && (!q || c.clave.toLowerCase().includes(q) || String((c.oc && c.oc.proveedor) || '').toLowerCase().includes(q)));
        const chips = [['TODOS', 'Todas', casos.length], ['DISCREPANCIA', 'Discrepancia', conteo('DISCREPANCIA')], ['SIN_GESTION', 'Sin gestión', conteo('SIN_GESTION')], ['PARCIAL', 'Parciales', conteo('PARCIAL')], ['GESTION', 'En gestión', conteo('GESTION')], ['OTROS', 'Para otros centros', casos.filter(c => c.otros > 0).length], ['COMPLETA', 'Completas', conteo('COMPLETA')], ['SOLO_CORREO', 'Solo en correo', conteo('SOLO_CORREO')]];
        r.innerHTML = `
        <div class="page-header mb-24"><div class="page-title"><h2>Bitácora de órdenes</h2>
            <p>Cada orden como un caso: qué falta, qué se ha gestionado por correo y desde cuándo. ${correos && correos.ultima ? 'Última revisión del correo: <b>' + esc(fechaHora(correos.ultima)) + '</b> (07:00, 12:00 y 17:00).' : ''}</p></div>
            <div class="page-actions"><button type="button" class="btn btn-outline" id="bit-cfg"><i class="ph-bold ph-gear"></i> Configurar</button><button type="button" class="btn btn-primary" id="bit-act"${cargando ? ' disabled' : ''}><i class="ph-bold ph-arrows-clockwise"></i> ${cargando ? 'Revisando…' : 'Revisar el correo ahora'}</button></div></div>
        ${error ? `<div class="bit-aviso" role="alert">${esc(error)}</div>` : ''}
        ${correos && correos.completo === false ? '<div class="bit-aviso">La primera revisión del correo todavía está en curso (es larga): se completa sola en las próximas revisiones de las 07:00, 12:00 y 17:00, o aprieta "Revisar el correo ahora" otra vez.</div>' : ''}
        ${!correos && !error ? '<div class="bit-aviso">Aún no hay datos del correo. Configura el script (botón "Configurar") para empezar. Mientras tanto se muestran las órdenes del Visor.</div>' : ''}
        <div class="bit-barra bit-barra-q"><input type="search" id="bit-q" class="form-control" placeholder="Buscar por N° de orden o proveedor" value="${esc(texto)}" aria-label="Buscar orden"></div>
        <div class="bit-chips" role="group" aria-label="Filtrar por estado">${chips.map(c => `<button type="button" class="bit-chip${filtro === c[0] ? ' on' : ''}" data-f="${c[0]}">${c[1]} <em>${c[2]}</em></button>`).join('')}</div>
        <p class="bit-ley">Sin gestión = sin correos o más de ${DIAS_SIN_GESTION} días sin movimiento. Discrepancia = la recepción conforme enviada no coincide con lo que el Visor tiene recibido.</p>
        <div class="bit-lista">${lista.length ? lista.map(c => { const e = ESTADOS[c.estado], pct = c.pedido ? Math.round(c.recibido * 100 / c.pedido) : 0; return `
          <button type="button" class="bit-fila" data-k="${esc(c.clave)}">
            <span class="bit-f1"><strong>${esc(c.clave)}</strong><small>${esc(tipoDe(c.clave))}${c.oc && c.oc.proveedor ? ' · ' + esc(c.oc.proveedor) : ''}</small></span>
            <span class="bit-f2"><span class="bit-est ${e.cls}" ${e.tip ? 'title="' + esc(e.tip) + '"' : ''}><i class="ph-bold ${e.ico}"></i> ${e.txt}</span></span>
            <span class="bit-f3">${c.pedido ? `<span class="bit-barra-av" aria-hidden="true"><i style="width:${pct}%"></i></span><small>${c.recibido}/${c.pedido} u. · ${c.falta ? 'faltan ' + c.falta : 'completo'}</small>` : '<small>—</small>'}</span>
            <span class="bit-f4"><small>${c.ultimo ? esc(hace(c.diasSin)) + ' · ' + esc((CLASES[c.ultimo.clase] || CLASES.otro)[1]) : 'Sin correos todavía'}</small>${c.alertas.length ? `<small class="bit-avf"><i class="ph-bold ph-warning-circle"></i> ${c.alertas.length} alerta${c.alertas.length > 1 ? 's' : ''}</small>` : ''}</span></button>`; }).join('') : '<p class="act-hint" style="padding:16px;">No hay órdenes en este filtro.</p>'}</div>
        <div id="bit-panel"></div>`;
        r.querySelectorAll('.bit-chip').forEach(b => b.addEventListener('click', () => { filtro = b.dataset.f; pintar(); }));
        const qi = r.querySelector('#bit-q'); if (qi) qi.addEventListener('input', () => { texto = qi.value; const pos = qi.selectionStart; pintar(); const n = root().querySelector('#bit-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
        r.querySelectorAll('.bit-fila').forEach(b => b.addEventListener('click', () => { abierto = b.dataset.k; verMas = false; panel(); }));
        r.querySelector('#bit-cfg').addEventListener('click', configurar);
        r.querySelector('#bit-act').addEventListener('click', () => actualizar(true));
        if (abierto && !document.getElementById('bit-vel')) panel();
    }
    function panel() {
        const c = casos.find(x => x.clave === abierto), p = document.getElementById('bit-panel'); if (!c || !p) return;
        const e = ESTADOS[c.estado];
        p.innerHTML = `<div class="bit-vel" id="bit-vel"></div><aside class="bit-drawer" role="dialog" aria-modal="true" aria-labelledby="bit-h3" tabindex="-1">
          <div class="bit-dh"><div><h3 id="bit-h3">${esc(c.clave)}</h3><small>${esc(tipoDe(c.clave))}${c.oc && c.oc.proveedor ? ' · ' + esc(c.oc.proveedor) : ''}</small></div><div class="bit-dhb">${c.oc ? '<button type="button" class="btn btn-outline" id="bit-ir"><i class="ph-bold ph-arrow-square-out"></i> Abrir en Seguimiento de OC</button>' : ''}<button type="button" class="btn btn-outline" id="bit-x" aria-label="Cerrar">✕</button></div></div>
          <div class="bit-resumen"><span class="bit-est ${e.cls}"><i class="ph-bold ${e.ico}"></i> ${e.txt}</span></div>
          ${c.alertas.length ? `<div class="bit-alertas" role="note"><strong>Qué revisar</strong>${c.alertas.map(a => `<p>${esc(a)}</p>`).join('')}</div>` : ''}
          <div class="bit-kpis"><div><b>${c.pedido || '—'}</b><small>pedido</small></div><div><b>${c.pedido ? c.recibido : '—'}</b><small>recibido</small></div><div class="${c.falta ? 'bit-falta' : ''}"><b>${c.pedido ? c.falta : '—'}</b><small>faltan</small></div></div>
          ${c.centros.length > 1 ? `<details class="bit-det" open><summary>Trazabilidad por centro y memo (${c.centros.length})</summary><table class="bit-tabla"><thead><tr><th>Centro</th><th>Memo</th><th>Pedido</th><th>Recibido</th><th>Entregado</th><th>Estado</th></tr></thead><tbody>${c.centros.map(x => `<tr${x.centro !== 'SAR' && x.entregable > 0 ? ' class="bit-otro"' : ''}><td>${esc(x.centro)}</td><td>${esc(x.memo || '—')}</td><td>${x.pedido}</td><td>${x.recibido}</td><td>${x.entregado}</td><td>${esc(ETIQ_ENT[x.estado] || x.estado)}</td></tr>`).join('')}</tbody></table></details>` : ''}
          <p class="bit-sub">${c.conformes} recepción${c.conformes === 1 ? '' : 'es'} conforme${c.conformes === 1 ? '' : 's'} informada${c.conformes === 1 ? '' : 's'} por correo.</p>
          ${c.productos.length ? `<details class="bit-det" open><summary>Qué falta recibir (${c.productos.length} productos)</summary><table class="bit-tabla"><thead><tr><th>Producto</th><th>Pedido</th><th>Recibido</th><th>Falta</th></tr></thead><tbody>${c.productos.map(x => `<tr><td>${esc(x.producto)}</td><td>${x.pedido}</td><td>${x.recibido}</td><td><b>${x.pendiente}</b></td></tr>`).join('')}</tbody></table></details>` : ''}
          <h4 class="bit-h">Correos de esta orden (${c.eventos.length})</h4>
          <ol class="bit-tl">${c.eventos.length ? c.eventos.map((ev, ix) => { const cl = CLASES[ev.clase] || CLASES.otro; return `
            <li class="bit-ev bit-${esc(ev.clase || 'otro')}"${ix >= 5 && !verMas ? ' hidden data-mas="1"' : ''}><span class="bit-ico"><i class="ph-bold ${cl[0]}"></i></span>
              <div class="bit-evc"><div class="bit-evh"><b>${cl[1]}</b>${ev.declara ? `<span class="bit-tag">declara ${esc(ev.declara)}</span>` : ''}<span class="bit-dir ${ev.dir === 'ENVIADO' ? 'env' : 'rec'}">${ev.dir === 'ENVIADO' ? (ev.reenviado ? 'Reenviado' : 'Enviado') : 'Recibido'}</span><small>${esc(fechaHora(ev.fecha))}</small></div>
              <div class="bit-asunto">${esc(ev.asunto)}</div>
              ${(() => { const r = ev.refs || {}, ch = []; (r.memo || []).forEach(x => ch.push('memo ' + x)); (r.sdc || []).forEach(x => ch.push('SDC ' + x)); (r.cdp || []).forEach(x => ch.push('CDP ' + x)); return (ch.length || ev.vinculo || ev.porHilo || (ev.centros || []).length) ? `<div class="bit-adj">${ch.map(x => `<span>${esc(x)}</span>`).join('')}${ev.vinculo ? `<span class="bit-vin">vinculado por ${esc(ev.vinculo)}</span>` : ''}${ev.porHilo ? '<span class="bit-vin">del mismo hilo</span>' : ''}${(ev.centros || []).map(x => `<span class="bit-cen">menciona: ${esc(x)}</span>`).join('')}</div>` : ''; })()}<small class="bit-qs">${ev.dir === 'ENVIADO' ? 'Para: ' + esc(ev.para) : 'De: ' + esc(ev.de)}</small>
              ${ev.resumen ? `<details class="bit-res"><summary>Ver extracto</summary><p>${esc(ev.resumen)}</p></details>` : ''}
              ${(ev.adjuntos || []).length ? `<div class="bit-adj">${ev.adjuntos.map(a => `<span><i class="ph-bold ph-paperclip"></i> ${esc(a)}</span>`).join('')}</div>` : ''}
              ${ev.hilo ? `<a class="bit-gm" target="_blank" rel="noopener" href="https://mail.google.com/mail/?authuser=${encodeURIComponent(CUENTA)}#all/${encodeURIComponent(ev.hilo)}">Abrir en Gmail</a>` : ''}</div></li>`; }).join('') : '<li class="act-hint">Sin correos todavía.</li>'}</ol>${c.eventos.length > 5 && !verMas ? `<button type="button" class="btn btn-outline" id="bit-mas">Ver los ${c.eventos.length - 5} anteriores</button>` : ''}</aside>`;
        const origen = document.activeElement, dr = p.querySelector('.bit-drawer');
        const cerrar = () => { document.removeEventListener('keydown', teclas); document.body.style.overflow = ''; abierto = null; verMas = false; p.innerHTML = ''; if (origen && origen.focus && document.contains(origen)) origen.focus(); };
        const teclas = (k) => {
            if (k.key === 'Escape') { cerrar(); return; }
            if (k.key !== 'Tab') return;
            const fs2 = [...dr.querySelectorAll('button, a[href], summary, input')].filter(el => !el.closest('[hidden]') && el.offsetParent !== null); if (!fs2.length) return;
            const a0 = fs2[0], z = fs2[fs2.length - 1];
            if (k.shiftKey && (document.activeElement === a0 || document.activeElement === dr)) { k.preventDefault(); z.focus(); } else if (!k.shiftKey && document.activeElement === z) { k.preventDefault(); a0.focus(); }
        };
        document.addEventListener('keydown', teclas); document.body.style.overflow = 'hidden';
        p.querySelector('#bit-x').addEventListener('click', cerrar); p.querySelector('#bit-vel').addEventListener('click', cerrar);
        const mas = p.querySelector('#bit-mas'); if (mas) mas.addEventListener('click', () => { verMas = true; p.querySelectorAll('[data-mas]').forEach(li => li.hidden = false); mas.remove(); });
        const ir = p.querySelector('#bit-ir'); if (ir) ir.addEventListener('click', () => { const so = window.SAR_SeguimientoOC; const m = document.querySelector('.menu-item[data-target="view-seguimiento-oc"]'); cerrar(); if (m) m.click(); if (so && so.abrirCuando) so.abrirCuando(c.oc.id); });
        const x = p.querySelector('#bit-x'); if (x) x.focus();
    }

    // ---------------------------------------------------------------
    // Configuración + código del script
    // ---------------------------------------------------------------
    const SCRIPT_BITACORA = String.raw`// Bitácora de órdenes de compra · Visor Logístico SAR
// 1) Entra a script.google.com CON LA CUENTA compras.sar@cormumel.cl y crea un proyecto nuevo.
// 2) Pega este código, cambia el TOKEN por una clave larga (la misma que pondrás en el Visor).
// 3) Ejecuta la función "instalar" (Google pedirá permisos de lectura del correo y de Drive: Aceptar).
//    Eso programa la revisión a las 07:00, 12:00 y 17:00 y hace la primera revisión.
// 4) Implementar > Nueva implementación > Aplicación web · Ejecutar como: Yo · Acceso: Cualquier persona.
//    Copia la URL en el Visor (Bitácora > Configurar).
const TOKEN = 'CAMBIA-ESTE-TOKEN-POR-UNA-CLAVE-LARGA';
const UNIDAD = '1298355';                 // unidad de compra: las órdenes son 1298355-NNN-XX26
const DIAS_PRIMERA_VEZ = 150;             // cuánto hacia atrás mira la primera vez
const ARCHIVO = 'visor_bitacora_oc_v2.json';   // v2: vuelve a revisar todo con la lectura por hilo y memo/SDC/CDP
const ZONA = 'America/Santiago';
const RE_OC = new RegExp(UNIDAD.slice(0, 4) + '-?' + UNIDAD.slice(4) + '-(\\d{1,5})-([A-Za-z]{1,3}\\d{2})', 'g');

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'revisar') ScriptApp.deleteTrigger(t); });
  [7, 12, 17].forEach(function (h) { ScriptApp.newTrigger('revisar').timeBased().everyDays(1).atHour(h).inTimezone(ZONA).create(); });
  revisar();
}
function archivo_() { const it = DriveApp.getFilesByName(ARCHIVO); return it.hasNext() ? it.next() : DriveApp.createFile(ARCHIVO, '{"ultima":"","ocs":{},"sueltos":[]}', 'application/json'); }
function leer_() { try { const d = JSON.parse(archivo_().getBlob().getDataAsString()); d.ocs = d.ocs || {}; d.sueltos = d.sueltos || []; return d; } catch (e) { return { ultima: '', ocs: {}, sueltos: [] }; } }
function guardar_(d) { archivo_().setContent(JSON.stringify(d)); }
function sinAcentos_(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function clavesEn_(texto) {
  const out = {}; let m; RE_OC.lastIndex = 0;
  while ((m = RE_OC.exec(texto)) !== null) { out[UNIDAD + '-' + parseInt(m[1], 10) + '-' + m[2].toUpperCase()] = 1; }
  return Object.keys(out);
}
const RE_REF = {
  memo: /memo(?:rando|randum)?\s*(?:n(?:°|º|ro\.?|o\.?|um(?:ero)?\.?)?\s*)?[:#.\-]?\s*(\d{1,6})/gi,
  sdc: /\bsdc\s*(?:n(?:°|º|ro\.?)?\s*)?[:#.\-]?\s*(\d{1,6})/gi,
  cdp: /\bcdp\s*(?:n(?:°|º|ro\.?)?\s*)?[:#.\-]?\s*(\d{1,6})/gi
};
function refsEn_(t, o) {   // memo / SDC / CDP mencionados en el texto (se suman a "o")
  o = o || { memo: [], sdc: [], cdp: [] };
  Object.keys(RE_REF).forEach(function (k) { const re = RE_REF[k]; re.lastIndex = 0; let m; while ((m = re.exec(t)) !== null) { if (o[k].indexOf(m[1]) < 0 && o[k].length < 8) o[k].push(m[1]); } });
  return o;
}
function clasificar_(asunto, cuerpo) {
  const t = sinAcentos_(asunto + ' ' + String(cuerpo).slice(0, 3000));
  if (/recepcion conforme|\brec-?\s?\d{7}|acta de recepcion/.test(t)) return 'recepcion_conforme';
  if (/guia de despacho|guia n|\bgd\b/.test(t)) return 'guia';
  if (/factura|\bdte\b/.test(t)) return 'factura';
  if (/reclamo|incumplimiento|atraso|retraso|multa|no han llegado|no hemos recibido|faltante/.test(t)) return 'reclamo';
  if (/despach|coordinar (la )?entrega|fecha de entrega|ruta de entrega|en camino|retiro/.test(t)) return 'despacho';
  if (/orden de compra|\boc\b|aceptacion de orden|orden aceptada/.test(t)) return 'oc_enviada';
  return 'otro';
}
function limpiar_(c) {
  const lineas = String(c || '').split(/\r?\n/), out = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (/^>/.test(l) || /^(el|on) .+(escribi|wrote)/i.test(l) || /^-{2,}\s*(mensaje|forwarded|original)/i.test(l) || /^de:\s/i.test(l) && out.length > 2) break;
    if (l) out.push(l);
  }
  return out.join(' ').replace(/\s+/g, ' ').slice(0, 450);
}
function revisar() {
  const t0 = Date.now(), d = leer_(), dias = d.completo ? 10 : DIAS_PRIMERA_VEZ, corto = false, yo = Session.getEffectiveUser().getEmail().toLowerCase();
  const vistos = {};
  Object.keys(d.ocs).forEach(function (k) { d.ocs[k].eventos.forEach(function (e) { vistos[e.id] = 1; }); });
  d.sueltos.forEach(function (e) { vistos[e.id] = 1; });
  for (let ini = 0; ini < 2000; ini += 100) {
    if (Date.now() - t0 > 270000) { corto = true; break; }
    const hilos = GmailApp.search('newer_than:' + dias + 'd', ini, 100);
    if (!hilos.length) break;
    const grupos = GmailApp.getMessagesForThreads(hilos);
    for (let i = 0; i < grupos.length; i++) {
      const msgs = grupos[i]; if (msgs.every(function (m) { return vistos[m.getId()]; })) continue;
      const asuntoHilo = hilos[i].getFirstMessageSubject() || '';
      // 1) se lee TODO el hilo: si un mensaje nombra la orden (o el memo/SDC), los demás del hilo (respuestas sin citar) quedan asociados
      const info = msgs.map(function (m) {
        const asunto = m.getSubject() || '', cuerpo = (m.getPlainBody() || '').slice(0, 20000), adj = m.getAttachments({ includeInlineImages: false }).map(function (a) { return a.getName(); });
        return { m: m, asunto: asunto, cuerpo: cuerpo, adj: adj, texto: asuntoHilo + '\n' + asunto + '\n' + cuerpo + '\n' + adj.join('\n') };
      });
      const claves = {}, refs = { memo: [], sdc: [], cdp: [] };
      info.forEach(function (x) { clavesEn_(x.texto).forEach(function (k) { claves[k] = 1; }); refsEn_(x.texto, refs); });
      const listaClaves = Object.keys(claves), hayRefs = refs.memo.length + refs.sdc.length + refs.cdp.length > 0;
      if (!listaClaves.length && !hayRefs) continue;
      info.forEach(function (x) {
        const m = x.m, id = m.getId(); if (vistos[id]) return;
        const de = m.getFrom() || '', clase = clasificar_(x.asunto, x.cuerpo), tx = sinAcentos_(x.asunto + ' ' + x.cuerpo.slice(0, 3000));
        const ev = { id: id, fecha: m.getDate().toISOString(), dir: sinAcentos_(de).indexOf(yo) >= 0 ? 'ENVIADO' : 'RECIBIDO', reenviado: /^\s*(fwd?|rv|reenv)\s*:/i.test(x.asunto), de: de, para: m.getTo() || '', cc: m.getCc() || '', asunto: x.asunto.slice(0, 200), resumen: limpiar_(x.cuerpo), adjuntos: x.adj.slice(0, 8), hilo: hilos[i].getId(), clase: clase, refs: refs, porHilo: clavesEn_(x.texto).length === 0 && listaClaves.length > 0, declara: clase === 'recepcion_conforme' ? (/parcial/.test(tx) ? 'PARCIAL' : (/total|completa|integra/.test(tx) ? 'TOTAL' : '')) : '' };
        if (listaClaves.length) listaClaves.forEach(function (k) { (d.ocs[k] = d.ocs[k] || { eventos: [] }).eventos.push(ev); });
        else { d.sueltos.push(ev); if (d.sueltos.length > 4000) d.sueltos.shift(); }   // correos que solo traen memo/SDC/CDP: el Visor los asocia a la orden
        vistos[id] = 1;
      });
    }
  }
  d.ultima = new Date().toISOString(); if (!corto) d.completo = true; guardar_(d); return d;   // si se acabó el tiempo, la próxima revisión sigue con lo que falta
}
function salida_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return salida_({ ok: true, servicio: 'bitacora' }); }
function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    if (p.token !== TOKEN) return salida_({ ok: false, error: 'token' });
    const d = p.accion === 'revisar' ? revisar() : leer_(), ocs = {};
    Object.keys(d.ocs).forEach(function (k) { ocs[k] = { eventos: d.ocs[k].eventos.sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; }).slice(0, 120) }; });
    return salida_({ ok: true, ultima: d.ultima, completo: !!d.completo, ocs: ocs, sueltos: d.sueltos.slice(-800) });
  } catch (err) { return salida_({ ok: false, error: String(err) }); }
}
`;
    function configurar() {
        const o = document.createElement('div'); o.className = 'bit-modal'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
        o.innerHTML = `<div class="bit-mc"><h3>Configurar la bitácora</h3>
          <ol class="bit-pasos"><li>Entra a <b>script.google.com</b> con la cuenta <b>${CUENTA}</b> y crea un proyecto nuevo.</li><li>Pega el código (botón de abajo) y cambia el <b>TOKEN</b> por una clave larga.</li><li>Ejecuta la función <b>instalar</b> y acepta los permisos (lectura del correo y de Drive). Programa la revisión a las 07:00, 12:00 y 17:00.</li><li>Implementar › Nueva implementación › Aplicación web · Ejecutar como: <b>Yo</b> · Acceso: <b>Cualquier persona</b>. Copia la URL acá.</li></ol>
          <button type="button" class="btn btn-outline" id="bit-copy">Copiar el código del script</button>
          <label class="bit-lbl">URL de la aplicación web<input id="bit-url" class="form-control" value="${esc(cfg.url)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
          <label class="bit-lbl">Token (el mismo del script)<input id="bit-tok" type="password" class="form-control" value="${esc(cfg.token)}" autocomplete="off"></label>
          <div class="bit-mb"><button type="button" class="btn btn-outline" id="bit-no">Cancelar</button><button type="button" class="btn btn-primary" id="bit-ok">Guardar y revisar</button></div></div>`;
        document.body.appendChild(o);
        const cerrar = () => o.remove();
        o.querySelector('#bit-no').addEventListener('click', cerrar);
        o.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
        o.querySelector('#bit-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(SCRIPT_BITACORA); toast('Código copiado', 'Pégalo en el proyecto de Apps Script.', 'success'); } catch (e) { toast('No se pudo copiar', 'Copia el código manualmente desde el repositorio (bitacora-oc.js).', 'warning'); } });
        o.querySelector('#bit-ok').addEventListener('click', async () => {
            const url = o.querySelector('#bit-url').value.trim(), token = o.querySelector('#bit-tok').value.trim();
            if (!/^https:\/\/script\.google\.com\//.test(url) || token.length < 12) { toast('Revisa los datos', 'La URL debe ser de script.google.com y el token de al menos 12 caracteres.', 'warning'); return; }
            try { await fs().setDoc(refCfg(), { url, token, actualizado: fs().serverTimestamp(), por: (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || '' }, { merge: true }); } catch (e) { toast('No se guardó', e.message || String(e), 'error'); return; }
            cfg = { url, token }; cerrar(); actualizar(false);
        });
        o.querySelector('#bit-url').focus();
    }

    async function actualizar(forzar) {
        if (cargando) return;
        cargando = true; error = ''; pintar();
        try {
            await cargarOrdenes();
            if (cfg.url && cfg.token) correos = await llamar(forzar ? 'revisar' : 'leer');
        } catch (e) { error = 'No se pudo leer el correo: ' + (e.message || e); }
        cargando = false; armarCasos(); pintar();
    }
    async function abrir() {
        const r = root(); if (!r) return;
        r.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando la bitácora…') : 'Cargando…';
        await cargarCfg(); cargando = false; error = '';
        try { await cargarOrdenes(); if (cfg.url && cfg.token) correos = await llamar('leer'); } catch (e) { error = 'No se pudo leer el correo: ' + (e.message || e); }
        armarCasos(); pintar();
    }
    window.SAR_Bitacora = { abrir, calcularCaso, claveOC, SCRIPT_BITACORA };
    if (typeof module !== 'undefined') module.exports = window.SAR_Bitacora;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
