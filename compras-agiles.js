/* ==========================================================================
   COMPRAS ÁGILES (v20.42) — etapa previa a la orden de compra
   --------------------------------------------------------------------------
   Sigue una compra ágil de Mercado Público desde la publicación de los términos
   de referencia hasta que llega la OC: oferta(s), revisión de documentos del
   oferente, V°B° de cada centro, observaciones y bitácora. Avisa lo que no cuadra
   (sobre presupuesto, plazo/vigencia fuera de bases, documentos vencidos, fichas
   técnicas faltantes, cuenta bancaria a nombre de un tercero, etc.).

   Se enlaza con el seguimiento de OC por el prefijo del número (1298355-1122-COT26
   -> OC 1298355-1122-AG26).

   Datos (sin datos de pacientes):
   - Compras_Agiles/{id}            la compra, ítems, cuadro por centro, oferta, documentos, V°B°.
   - Compras_Agiles/{id}/Eventos/*  bitácora INMUTABLE.
   ========================================================================== */
(function (window, document) {
    'use strict';

    const fs = () => window.firebaseFirestore;
    const db = () => window.firebaseDb;
    const esc = (s) => (window.escapeHTML ? window.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
    const num = (v) => Number(v) || 0;
    const peso = (n) => '$' + Math.round(num(n)).toLocaleString('es-CL');
    const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const pad = (n) => String(n).padStart(2, '0');
    const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const fmtFecha = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}-${m}-${y}`; };
    const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
    const habilesEntre = (a, b) => (window.SAR_SeguimientoOC && window.SAR_SeguimientoOC.habilesEntre) ? window.SAR_SeguimientoOC.habilesEntre(a, b) : Math.round(diasEntre(a, b) * 5 / 7);
    const root = () => document.getElementById('cag-root');
    const usuario = () => (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || 'Usuario';

    const DOCS_BASE = [
        { clave: 'tdr', nombre: 'Términos de referencia firmados' },
        { clave: 'cotizacion', nombre: 'Cotización' },
        { clave: 'identificacion', nombre: 'Identificación del oferente' },
        { clave: 'habilidad', nombre: 'Certificado de habilidad (Mercado Público)' },
        { clave: 'patente', nombre: 'Patente comercial vigente' },
        { clave: 'ficha', nombre: 'Ficha técnica (documento separado)' },
        { clave: 'ce', nombre: 'Certificado CE / registro del dispositivo médico' },
        { clave: 'iso', nombre: 'Certificado de calidad ISO 13485' }
    ];
    const ESTADOS = {
        PUBLICADA: 'Publicada', EN_EVALUACION: 'Oferta recibida', EN_VB: 'Esperando V°B°', ESPERANDO_OC: 'V°B° completo · esperando OC',
        OC_EMITIDA: 'OC emitida', CERRADA: 'Cerrada / desierta'
    };

    // ---------------------------------------------------------------
    // Cálculos puros
    // ---------------------------------------------------------------
    function ofertaElegida(ca) { return (ca.ofertas || []).find(o => o.admisible) || null; }
    function centrosVB(ca) { return Object.keys(ca.vistoBueno || {}); }
    function vbCompleto(ca) {
        const v = ca.vistoBueno || {}; const k = Object.keys(v);
        return k.length > 0 && k.every(c => v[c] && v[c].estado === 'VB');
    }
    function estadoCA(ca) {
        if (ca.cerrada) return 'CERRADA';
        if (ca.ocNumero) return 'OC_EMITIDA';
        if (ofertaElegida(ca) && vbCompleto(ca)) return 'ESPERANDO_OC';
        if (ofertaElegida(ca)) return 'EN_VB';
        if ((ca.ofertas || []).length) return 'EN_EVALUACION';
        return 'PUBLICADA';
    }
    /** Alertas de revisión. nivel: alta | media | info */
    function alertas(ca, hoy) {
        hoy = hoy || hoyISO();
        const out = [], of = ofertaElegida(ca);
        const add = (nivel, texto) => out.push({ nivel, texto });
        if (!of) return out;
        const fechaOferta = of.fecha || hoy;
        if (ca.presupuesto && num(of.total) > num(ca.presupuesto)) add('alta', `La oferta (${peso(of.total)}) supera el presupuesto disponible (${peso(ca.presupuesto)}).`);
        else if (ca.presupuesto) add('info', `Oferta ${peso(of.total)} dentro del presupuesto ${peso(ca.presupuesto)} (sobran ${peso(num(ca.presupuesto) - num(of.total))}).`);
        if (ca.plazoMaxEntregaHabiles && num(of.plazoEntregaDias) > num(ca.plazoMaxEntregaHabiles)) add('alta', `Plazo de entrega ofertado (${of.plazoEntregaDias} días) mayor al máximo de las bases (${ca.plazoMaxEntregaHabiles} días hábiles).`);
        if (ca.vigenciaMinDias && num(of.vigenciaDias) < num(ca.vigenciaMinDias)) add('alta', `Vigencia de la cotización (${of.vigenciaDias} días) menor al mínimo de las bases (${ca.vigenciaMinDias} días).`);
        const vigHasta = of.vigenciaDias ? addDias(fechaOferta, num(of.vigenciaDias)) : null;
        if (vigHasta && vigHasta < hoy && !ca.ocNumero) add('alta', `La cotización venció el ${fmtFecha(vigHasta)} y aún no hay OC: pedir al proveedor que la renueve antes de emitirla.`);
        else if (vigHasta && !ca.ocNumero) add('info', `La cotización vale hasta el ${fmtFecha(vigHasta)}.`);
        (ca.documentos || []).forEach(d => {
            if (d.estado !== 'RECIBIDO') { add('media', `Falta el documento: ${d.nombre}.`); return; }
            if (d.vence && d.vence < fechaOferta) add('alta', `${d.nombre}: venció el ${fmtFecha(d.vence)}, antes de presentarse la oferta (${fmtFecha(fechaOferta)}).`);
            else if (d.vence && d.vence < hoy) add('media', `${d.nombre}: vence/venció el ${fmtFecha(d.vence)}.`);
            if (d.clave === 'habilidad' && d.emitido) {
                const dias = diasEntre(d.emitido, hoy);
                if (dias > 30) add('media', `Certificado de habilidad emitido el ${fmtFecha(d.emitido)} (hace ${dias} días): consultar de nuevo en Mercado Público antes de emitir la OC.`);
            }
        });
        const sinFicha = (ca.items || []).filter(i => !i.ficha);
        if (sinFicha.length) add('media', `Las bases exigen ficha técnica por producto y faltan ${sinFicha.length} de ${(ca.items || []).length} ítems: ${sinFicha.map((i, n) => 'ítem ' + (ca.items.indexOf(i) + 1)).join(', ')}.`);
        (ca.items || []).forEach((i, n) => { if (i.observacion) add('media', `Ítem ${n + 1}: ${i.observacion}`); });
        if (of.cuentaTitular && of.proveedor && slug(of.cuentaTitular) !== slug(of.proveedor)) add('alta', `La cuenta bancaria de pago está a nombre de "${of.cuentaTitular}", distinto del proveedor "${of.proveedor}". Confirmar por escrito con el proveedor antes de pagar.`);
        const vb = ca.vistoBueno || {};
        Object.keys(vb).forEach(c => { if (vb[c].estado === 'OBSERVADO') add('media', `${c}: V°B° con observación — ${vb[c].nota || 'ver bitácora'}.`); if (vb[c].estado !== 'VB' && vb[c].estado !== 'OBSERVADO') add('media', `${c}: falta V°B°.`); });
        if (!ca.ocNumero && vbCompleto(ca)) {
            const ult = Object.values(vb).map(v => v.fecha || '').sort().pop();
            if (ult) { const h = habilesEntre(ult, hoy); if (h >= 5) add('media', `Hace ${h} días hábiles que se completó el V°B° y la OC aún no llega: consultar a Compras (${ca.analista || 'analista de compras'}).`); }
        }
        const orden = { alta: 0, media: 1, info: 2 };
        return out.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
    }
    function addDias(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    /** Prefijo para enlazar con la OC: 1298355-1122-COT26 -> 1298355-1122 */
    function prefijo(codigo) { const m = String(codigo || '').match(/^(\d+-\d+)-/); return m ? m[1] : ''; }
    function totalItems(ca) { return (ca.items || []).reduce((t, i) => t + num(i.cantidad) * num(i.valorNeto), 0); }
    function distTotal(ca) { return (ca.items || []).map(i => Object.values(i.dist || {}).reduce((t, v) => t + num(v), 0)); }

    // ---------------------------------------------------------------
    // Datos iniciales: compra ágil de termómetros (según los documentos recibidos)
    // ---------------------------------------------------------------
    function datosTermometros() {
        const docs = DOCS_BASE.map(d => ({ ...d, estado: 'RECIBIDO' }));
        const set = (k, p) => Object.assign(docs.find(d => d.clave === k), p);
        set('habilidad', { emitido: '2026-05-04', nota: 'Estado HÁBIL al 04-05-2026' });
        set('patente', { vence: '2026-12-31', nota: 'Patente Vitacura, período julio–diciembre 2026' });
        set('ce', { vence: '2028-07-01', nota: 'Fabricante Wenzhou Bokang (DEKRA); cubre termómetros infrarrojos de frente' });
        set('iso', { vence: '2026-04-01', nota: 'ISO 13485 del fabricante, vigencia 29-11-2024 a 01-04-2026' });
        set('ficha', { nota: 'Solo se entregó la ficha del ítem 1 (BK-8005)' });
        return {
            codigo: '1298355-1122-COT26', titulo: 'Adquisición de termómetros para distintos centros de salud',
            publicada: '2026-10-13', analista: 'Catalina Calderón Araneda', presupuesto: 338000,
            plazoMaxEntregaHabiles: 10, vigenciaMinDias: 15, aceptaHoras: 48,
            contrapartes: [{ centro: 'Dirección de Salud / CESFAM Elgueta / Aliwen', nombre: 'Ximena Paredes', contacto: '996310452', correo: 'ximena.paredes@cormumel.cl', despacho: 'Eleuterio Ramírez 0387, Melipilla' },
                { centro: 'SAR', nombre: 'Mariel Quintanilla (directora técnica)', contacto: '225688651-652', correo: 'sar.melipilla@cormumel.cl', despacho: 'Real Audiencia 980, Melipilla' }],
            columnas: [{ key: 'elgueta', centro: 'CESFAM Elgueta', memo: 'MEMO 57', cdp: '4433' }, { key: 'aliwen', centro: 'Centro Aliwen', memo: 'MEMO 18', cdp: '4092-4093-4094-4095' },
                { key: 'sar55', centro: 'SAR', memo: 'MEMO 55', cdp: '4390-4391-4392-4393' }, { key: 'sar41', centro: 'SAR', memo: 'MEMO 41', cdp: '3633-3634-3635-3636' }],
            items: [
                { descripcion: 'Termómetro infrarrojo de frente/oído, set de 9 memorias, lectura 1 segundo, alarma visual y sonora, sin contacto', cantidad: 5, valorNeto: 15990, dist: { sar55: 5 }, ficha: true },
                { descripcion: 'Termómetro digital punta flexible, lectura en 30 segundos, uso axilar, oral o rectal, apagado automático, alarma sonora y resistente al agua', cantidad: 10, valorNeto: 2990, dist: { elgueta: 10 }, ficha: false },
                { descripcion: 'Termómetro digital lectura rápida 8 segundos, punta flexible, pantalla LCD, memoria de última medición, alarma de fiebre y tecnología Age Precision, equivalente o similar a termómetro lápiz Braun PRT-200', cantidad: 7, valorNeto: 2700, dist: { sar41: 7 }, ficha: false,
                    observacion: 'Se ofertó el mismo modelo MC-201 del ítem 2 (lectura 30 s según bases del ítem 2); las bases piden lectura de 8 s y equivalencia a Braun PRT-200. Verificar equivalencia técnica.' },
                { descripcion: 'Termómetro digital axilar, punta rígida', cantidad: 78, valorNeto: 1990, dist: { elgueta: 20, aliwen: 8, sar55: 50 }, ficha: false }
            ],
            ofertas: [{ proveedor: 'OLTRACARE SPA', rut: '78.066.317-0', fecha: '2026-10-14', neto: 283970, iva: 53954, total: 337924, plazoEntregaDias: 7, vigenciaDias: 30, formaPago: 'Crédito contra factura 30 días', flete: 'Incluido', cuentaTitular: 'DEVCONMAX SPA', admisible: true, contacto: 'Myriam Huerta Zamorano · myriam@oltracare.cl · 228955621' }],
            documentos: docs,
            vistoBueno: {
                'CESFAM Elgueta': { estado: 'VB', fecha: '2026-10-19', nota: 'V°B° de la Subdirección' },
                'Centro Aliwen': { estado: 'VB', fecha: '2026-10-19', nota: '' },
                'SAR': { estado: 'VB', fecha: '2026-10-19', nota: 'Oferta declarada admisible por Compras SAR. Observación de J. Mesa: son termómetros universales, de características menores a lo conversado; en futuras compras, cantidades menores para probar el producto.' }
            },
            eventos: [
                ['2026-10-13', 'HITO', 'Se publica la compra ágil con los términos de referencia (C. Calderón).'],
                ['2026-10-14', 'HITO', 'Cotización de Oltracare SpA por $337.924 con IVA (7 días de entrega, vigencia 30 días).'],
                ['2026-10-16', 'HITO', 'Compras informa la única oferta admisible; Compras SAR la envía a J. Mesa y M. Bustos para autorización.'],
                ['2026-10-19', 'NOTA', 'J. Mesa: los termómetros son universales y con características menores a lo conversado inicialmente; recomienda que la cantidad no sea tan elevada para establecer confianza en el producto.'],
                ['2026-10-19', 'VB', 'Compras SAR informa a Compras que la oferta es admisible para el establecimiento.'],
                ['2026-10-19', 'VB', 'V°B° de la Subdirección CESFAM Elgueta y del Centro Aliwen.']
            ]
        };
    }

    // ---------------------------------------------------------------
    // Firestore / UI
    // ---------------------------------------------------------------
    let lista = [], ocs = [], unsubLista = null, unsubEv = null, actual = null, eventos = [];

    async function abrir() {
        if (!root()) return;
        if (unsubLista) { try { unsubLista(); } catch (e) { /* noop */ } }
        root().innerHTML = '<div class="home-empty">Cargando compras ágiles…</div>';
        try { const s = await fs().getDocs(fs().collection(db(), 'Seguimiento_OC')); ocs = []; s.forEach(d => ocs.push({ id: d.id, ...d.data() })); } catch (e) { ocs = []; }
        unsubLista = fs().onSnapshot(fs().collection(db(), 'Compras_Agiles'), (snap) => {
            lista = []; snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
            lista.sort((a, b) => String(b.publicada || '').localeCompare(String(a.publicada || '')));
            if (!actual) pintarLista(); else { const n = lista.find(x => x.id === actual.id); if (n) { actual = n; pintarDetalle(); } }
        }, (e) => { root().innerHTML = `<div class="home-empty">No se pudo leer: ${esc(e.code || e.message)}</div>`; });
    }
    function ocDe(ca) {
        const p = prefijo(ca.codigo); if (!p) return null;
        return ocs.find(o => String(o.numeroOC || '').startsWith(p + '-')) || null;
    }
    function chipE(cod) { return `<span class="soc-chip cag-chip--${cod.toLowerCase()}">${esc(ESTADOS[cod])}</span>`; }

    function pintarLista() {
        actual = null; if (unsubEv) { try { unsubEv(); } catch (e) { /* noop */ } unsubEv = null; }
        const hayTermo = lista.some(c => c.id === slug('1298355-1122-COT26'));
        root().innerHTML = `
            <div class="page-header mb-24"><div class="page-title"><h1>Compras ágiles</h1>
                <p>Desde la publicación hasta la orden de compra: oferta, documentos del proveedor, V°B° de los centros y alertas.</p></div>
                <div class="soc-acc"><button type="button" class="btn btn-primary" id="cag-nueva"><i class="ph-bold ph-plus"></i> Nueva compra ágil</button>
                ${hayTermo ? '' : '<button type="button" class="btn btn-outline" id="cag-termo"><i class="ph-bold ph-thermometer"></i> Cargar termómetros (1298355-1122)</button>'}</div></div>
            <div class="soc-lista">${lista.length ? lista.map(ca => {
                const cod = estadoCA(ca), al = alertas(ca), altas = al.filter(a => a.nivel === 'alta').length, med = al.filter(a => a.nivel === 'media').length, of = ofertaElegida(ca);
                return `<button type="button" class="erp-card soc-card" data-ca="${esc(ca.id)}">
                    <div class="soc-card__top"><strong>${esc(ca.codigo)}</strong>${chipE(cod)}</div>
                    <div class="soc-card__sub">${esc(ca.titulo || '')}</div>
                    <div class="soc-card__sub">${of ? esc(of.proveedor) + ' · ' + peso(of.total) : 'Sin oferta admisible'} · publicada ${fmtFecha(ca.publicada)}</div>
                    ${(altas || med) ? `<small>${altas ? `<span class="cag-pill cag-pill--alta">${altas} alerta${altas > 1 ? 's' : ''}</span> ` : ''}${med ? `<span class="cag-pill cag-pill--media">${med} por revisar</span>` : ''}</small>` : ''}
                </button>`; }).join('') : '<div class="home-empty">Aún no hay compras ágiles. Usa "Nueva compra ágil".</div>'}</div>`;
        root().querySelector('#cag-nueva').addEventListener('click', formNueva);
        const bt = root().querySelector('#cag-termo'); if (bt) bt.addEventListener('click', cargarTermometros);
        root().querySelectorAll('[data-ca]').forEach(b => b.addEventListener('click', () => abrirDetalle(b.dataset.ca)));
    }

    function abrirDetalle(id) {
        actual = lista.find(x => x.id === id); if (!actual) return;
        if (unsubEv) { try { unsubEv(); } catch (e) { /* noop */ } }
        unsubEv = fs().onSnapshot(fs().query(fs().collection(db(), 'Compras_Agiles', id, 'Eventos'), fs().orderBy('fecha', 'desc'), fs().limit(100)), (snap) => {
            eventos = []; snap.forEach(d => eventos.push({ id: d.id, ...d.data() })); pintarBitacora();
        });
        pintarDetalle();
    }

    function pintarDetalle() {
        const ca = actual, cod = estadoCA(ca), of = ofertaElegida(ca), al = alertas(ca), oc = ocDe(ca), dt = distTotal(ca);
        const cols = ca.columnas || [];
        root().innerHTML = `
            <div class="page-header mb-24"><div class="page-title"><h1>${esc(ca.codigo)}</h1><p>${esc(ca.titulo || '')}</p></div>
                <div class="soc-acc"><button type="button" class="btn btn-outline" id="cag-volver"><i class="ph-bold ph-arrow-left"></i> Volver</button></div></div>
            <div class="erp-card"><div class="soc-fechas">
                <div><small>Estado</small>${chipE(cod)}</div><div><small>Publicada</small><strong>${fmtFecha(ca.publicada)}</strong></div>
                <div><small>Presupuesto (IVA incl.)</small><strong>${peso(ca.presupuesto)}</strong></div>
                <div><small>Entrega máx. (bases)</small><strong>${num(ca.plazoMaxEntregaHabiles)} días hábiles</strong></div>
                <div><small>Aceptación de la OC</small><strong>${num(ca.aceptaHoras) || 48} h</strong></div>
                <div><small>Analista de compras</small><strong>${esc(ca.analista || '—')}</strong></div></div>
                <div class="soc-acc"><button type="button" class="btn btn-outline" id="cag-oferta"><i class="ph-bold ph-receipt"></i> Registrar oferta</button>
                <button type="button" class="btn btn-outline" id="cag-item"><i class="ph-bold ph-list-plus"></i> Agregar ítem</button>
                <button type="button" class="btn btn-outline" id="cag-vb"><i class="ph-bold ph-check-circle"></i> V°B° de un centro</button>
                <button type="button" class="btn btn-outline" id="cag-oc"><i class="ph-bold ph-link"></i> Vincular OC</button>
                <button type="button" class="btn btn-outline" id="cag-nota"><i class="ph-bold ph-note"></i> Agregar nota</button>
                ${ca.cerrada ? '' : '<button type="button" class="btn btn-outline" id="cag-cerrar"><i class="ph-bold ph-x-circle"></i> Cerrar / desierta</button>'}</div></div>
            ${oc ? `<div class="erp-card"><h3>Orden de compra asociada</h3><p><strong>${esc(oc.numeroOC)}</strong> · ${esc(oc.proveedor || '')} · ${oc.aceptada ? 'aceptada ' + fmtFecha(oc.aceptada) : 'sin aceptar'}. Se sigue en "Seguimiento de OC".</p></div>`
                : (ca.ocNumero ? `<div class="erp-card"><h3>Orden de compra asociada</h3><p><strong>${esc(ca.ocNumero)}</strong> (aún no ingresada al seguimiento de OC).</p></div>` : '')}
            <div class="erp-card"><h3>Alertas y revisión <span class="soc-n">${al.filter(a => a.nivel !== 'info').length}</span></h3>
                ${al.length ? `<ul class="soc-disc cag-al">${al.map(a => `<li class="cag-al--${a.nivel}">${esc(a.texto)}</li>`).join('')}</ul>` : '<p class="soc-card__sub">Sin oferta admisible registrada todavía.</p>'}</div>
            ${of ? `<div class="erp-card"><h3>Oferta admisible</h3><div class="soc-fechas">
                <div><small>Proveedor</small><strong>${esc(of.proveedor)}</strong><small>${esc(of.rut || '')}</small></div>
                <div><small>Neto / IVA / Total</small><strong>${peso(of.neto)} / ${peso(of.iva)} / ${peso(of.total)}</strong></div>
                <div><small>Plazo de entrega</small><strong>${num(of.plazoEntregaDias)} días</strong></div><div><small>Vigencia</small><strong>${num(of.vigenciaDias)} días</strong></div>
                <div><small>Forma de pago</small><strong>${esc(of.formaPago || '—')}</strong></div><div><small>Cuenta a nombre de</small><strong>${esc(of.cuentaTitular || '—')}</strong></div></div>
                ${of.contacto ? `<small>Contacto: ${esc(of.contacto)}</small>` : ''}</div>` : ''}
            <div class="erp-card"><h3>Ítems y distribución por centro</h3>
                <div class="soc-tabla"><table><thead><tr><th>#</th><th>Descripción</th><th>Cant.</th><th>Neto un.</th>${cols.map(c => `<th>${esc(c.centro)}<br><small>${esc(c.memo || '')}${c.cdp ? ' · CDP ' + esc(c.cdp) : ''}</small></th>`).join('')}<th>Ficha</th></tr></thead>
                <tbody>${(ca.items || []).map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.descripcion)}${i.observacion ? `<br><small class="cag-obs">${esc(i.observacion)}</small>` : ''}</td><td>${num(i.cantidad)}${dt[n] !== num(i.cantidad) ? ` <span class="cag-pill cag-pill--alta">dist. ${dt[n]}</span>` : ''}</td><td>${peso(i.valorNeto)}</td>${cols.map(c => `<td>${num(i.dist && i.dist[c.key]) || ''}</td>`).join('')}<td>${i.ficha ? '✔' : '✖'}</td></tr>`).join('')}</tbody></table></div>
                <small>Neto según ítems: ${peso(totalItems(ca))} · con IVA ${peso(totalItems(ca) * 1.19)}</small></div>
            <div class="erp-card"><h3>Documentos del oferente</h3><div class="soc-tabla"><table><thead><tr><th>Documento</th><th>Estado</th><th>Vence</th><th>Nota</th><th></th></tr></thead>
                <tbody>${(ca.documentos || []).map((d, n) => `<tr><td>${esc(d.nombre)}</td><td>${d.estado === 'RECIBIDO' ? 'Recibido' : '<strong>Falta</strong>'}</td><td>${d.vence ? fmtFecha(d.vence) : (d.emitido ? 'emitido ' + fmtFecha(d.emitido) : '—')}</td><td><small>${esc(d.nota || '')}</small></td><td><button type="button" class="btn btn-outline" data-doc="${n}">Editar</button></td></tr>`).join('')}</tbody></table></div></div>
            <div class="erp-card"><h3>V°B° por centro</h3>${Object.keys(ca.vistoBueno || {}).length ? `<ul class="soc-disc">${Object.entries(ca.vistoBueno).map(([c, v]) => `<li><strong>${esc(c)}</strong>: ${v.estado === 'VB' ? 'V°B° ✔' : esc(v.estado)} ${v.fecha ? '(' + fmtFecha(v.fecha) + ')' : ''}${v.nota ? ' — ' + esc(v.nota) : ''}</li>`).join('')}</ul>` : '<p class="soc-card__sub">Aún sin V°B°.</p>'}</div>
            <div class="erp-card"><h3>Bitácora</h3><div id="cag-bitacora"></div></div>`;
        const q = (s) => root().querySelector(s);
        q('#cag-volver').addEventListener('click', () => { actual = null; pintarLista(); });
        q('#cag-oferta').addEventListener('click', formOferta); q('#cag-item').addEventListener('click', formItem); q('#cag-vb').addEventListener('click', formVB);
        q('#cag-oc').addEventListener('click', formOC); q('#cag-nota').addEventListener('click', formNota);
        const bc = q('#cag-cerrar'); if (bc) bc.addEventListener('click', formCerrar);
        root().querySelectorAll('[data-doc]').forEach(b => b.addEventListener('click', () => formDoc(Number(b.dataset.doc))));
        pintarBitacora();
    }
    function pintarBitacora() {
        const el = document.getElementById('cag-bitacora'); if (!el) return;
        const f = (e) => e.fechaTxt ? fmtFecha(e.fechaTxt) : (e.fecha && e.fecha.toDate ? e.fecha.toDate().toLocaleDateString('es-CL') : '');
        const ord = eventos.slice().sort((a, b) => String(b.fechaTxt || '').localeCompare(String(a.fechaTxt || '')));
        el.innerHTML = ord.length ? `<ul class="soc-disc">${ord.map(e => `<li><small>${f(e)} · ${esc(e.tipo)} · ${esc(e.autor || '')}</small><br>${esc(e.texto)}</li>`).join('')}</ul>` : '<p class="soc-card__sub">Sin registros.</p>';
    }

    function modal(titulo, html, onListo) {
        const ov = document.createElement('div'); ov.className = 'cierre-overlay';
        ov.innerHTML = `<div class="cierre-box" role="dialog" aria-modal="true" aria-label="${esc(titulo)}"><h3>${esc(titulo)}</h3>${html}<div class="cierre-acciones"><button type="button" class="btn btn-outline" data-x>Cancelar</button><button type="button" class="btn btn-primary" data-ok>Guardar</button></div></div>`;
        document.body.appendChild(ov);
        const cerrar = () => ov.remove();
        ov.querySelector('[data-x]').addEventListener('click', cerrar);
        ov.querySelector('[data-ok]').addEventListener('click', async (e) => { e.target.disabled = true; try { const r = await onListo(ov); if (r !== false) cerrar(); else e.target.disabled = false; } catch (err) { toast('Error', (err.code || '') + ' ' + err.message, 'error'); e.target.disabled = false; } });
        return ov;
    }
    const campo = (id, etq, tipo, val, extra) => `<label class="cag-f">${esc(etq)}<input id="${id}" type="${tipo || 'text'}" value="${esc(val == null ? '' : val)}" ${extra || ''}></label>`;
    const v = (ov, id) => (ov.querySelector('#' + id) || {}).value || '';

    async function evento(id, tipo, texto, fechaTxt) {
        await fs().setDoc(fs().doc(fs().collection(db(), 'Compras_Agiles', id, 'Eventos')), { tipo, texto, autor: usuario(), fechaTxt: fechaTxt || hoyISO(), fecha: fs().serverTimestamp() });
    }
    async function guardar(id, cambios) { await fs().updateDoc(fs().doc(db(), 'Compras_Agiles', id), { ...cambios, actualizado: fs().serverTimestamp() }); }

    async function crear(datos) {
        const id = slug(datos.codigo);
        const { eventos: evs, ...doc } = datos;
        const ref = fs().doc(db(), 'Compras_Agiles', id);
        const ex = await fs().getDoc(ref);
        if (ex.exists()) throw new Error('Esa compra ágil ya existe.');
        await fs().setDoc(ref, { ...doc, creado: fs().serverTimestamp(), creadoPor: usuario() });
        for (const [f, t, x] of (evs || [])) await evento(id, t, x, f);
        if (!evs || !evs.length) await evento(id, 'HITO', 'Compra ágil ingresada al sistema.');
        return id;
    }
    async function cargarTermometros() {
        try { await crear(datosTermometros()); toast('Listo', 'Compra ágil de termómetros cargada con sus documentos, V°B° y alertas.', 'success'); }
        catch (e) { toast('Error', e.message, 'error'); }
    }

    function formNueva() {
        modal('Nueva compra ágil', `${campo('n-cod', 'ID de la compra (ej. 1298355-1234-COT26)')}${campo('n-tit', 'Título')}${campo('n-pub', 'Fecha de publicación', 'date', hoyISO())}
            ${campo('n-pre', 'Presupuesto disponible (con IVA)', 'number')}${campo('n-ana', 'Analista de compras')}${campo('n-ent', 'Plazo máx. de entrega (días hábiles)', 'number', 10)}${campo('n-vig', 'Vigencia mínima de la cotización (días)', 'number', 15)}`, async (ov) => {
            const cod = v(ov, 'n-cod').trim(); if (!/^\d+-\d+-[A-Za-z0-9]+$/.test(cod)) { toast('Falta dato', 'El ID debe verse como 1298355-1122-COT26.', 'warning'); return false; }
            await crear({ codigo: cod, titulo: v(ov, 'n-tit').trim(), publicada: v(ov, 'n-pub'), analista: v(ov, 'n-ana').trim(), presupuesto: num(v(ov, 'n-pre')), plazoMaxEntregaHabiles: num(v(ov, 'n-ent')), vigenciaMinDias: num(v(ov, 'n-vig')), aceptaHoras: 48,
                columnas: [], items: [], ofertas: [], documentos: DOCS_BASE.map(d => ({ ...d, estado: 'PENDIENTE' })), vistoBueno: {}, contrapartes: [] });
        });
    }
    function formOferta() {
        const o = ofertaElegida(actual) || {};
        modal('Oferta admisible', `${campo('o-prov', 'Proveedor', 'text', o.proveedor)}${campo('o-rut', 'RUT del proveedor', 'text', o.rut)}${campo('o-fec', 'Fecha de la cotización', 'date', o.fecha || hoyISO())}
            ${campo('o-neto', 'Neto', 'number', o.neto)}${campo('o-iva', 'IVA', 'number', o.iva)}${campo('o-tot', 'Total con IVA', 'number', o.total)}${campo('o-pla', 'Plazo de entrega (días)', 'number', o.plazoEntregaDias)}${campo('o-vig', 'Vigencia (días)', 'number', o.vigenciaDias)}
            ${campo('o-pag', 'Forma de pago', 'text', o.formaPago)}${campo('o-cta', 'Cuenta bancaria a nombre de (titular)', 'text', o.cuentaTitular)}${campo('o-con', 'Contacto del proveedor', 'text', o.contacto)}`, async (ov) => {
            if (!v(ov, 'o-prov').trim()) { toast('Falta dato', 'Indica el proveedor.', 'warning'); return false; }
            const of = { proveedor: v(ov, 'o-prov').trim(), rut: v(ov, 'o-rut').trim(), fecha: v(ov, 'o-fec'), neto: num(v(ov, 'o-neto')), iva: num(v(ov, 'o-iva')), total: num(v(ov, 'o-tot')), plazoEntregaDias: num(v(ov, 'o-pla')), vigenciaDias: num(v(ov, 'o-vig')), formaPago: v(ov, 'o-pag').trim(), cuentaTitular: v(ov, 'o-cta').trim(), contacto: v(ov, 'o-con').trim(), admisible: true };
            await guardar(actual.id, { ofertas: [of] });
            await evento(actual.id, 'HITO', `Oferta admisible registrada: ${of.proveedor} por ${peso(of.total)}.`);
        });
    }
    function formItem() {
        const cols = actual.columnas || [];
        modal('Agregar ítem', `${campo('i-des', 'Descripción')}${campo('i-can', 'Cantidad total', 'number')}${campo('i-val', 'Valor neto unitario', 'number')}
            <label class="cag-f">Distribución (centro: cantidad, uno por línea)<textarea id="i-dis" rows="3" placeholder="${esc(cols.map(c => c.centro + ': 0').join('\n') || 'CESFAM Elgueta: 10')}"></textarea></label>
            <label class="cag-f"><input type="checkbox" id="i-fic"> Se entregó ficha técnica de este ítem</label>${campo('i-obs', 'Observación (opcional)')}`, async (ov) => {
            const des = v(ov, 'i-des').trim(); if (!des || num(v(ov, 'i-can')) <= 0) { toast('Falta dato', 'Descripción y cantidad son obligatorias.', 'warning'); return false; }
            const columnas = (actual.columnas || []).slice(), dist = {};
            v(ov, 'i-dis').split('\n').forEach(l => {
                const m = l.match(/^(.+?):\s*(\d+)\s*$/); if (!m) return; const nombre = m[1].trim();
                let c = columnas.find(x => slug(x.centro) === slug(nombre)); if (!c) { c = { key: slug(nombre), centro: nombre, memo: '', cdp: '' }; columnas.push(c); }
                dist[c.key] = (dist[c.key] || 0) + Number(m[2]);
            });
            const sum = Object.values(dist).reduce((t, x) => t + x, 0);
            if (sum && sum !== num(v(ov, 'i-can'))) { toast('No cuadra', `La distribución suma ${sum} y la cantidad es ${v(ov, 'i-can')}.`, 'warning'); return false; }
            const items = (actual.items || []).concat([{ descripcion: des, cantidad: num(v(ov, 'i-can')), valorNeto: num(v(ov, 'i-val')), dist, ficha: ov.querySelector('#i-fic').checked, observacion: v(ov, 'i-obs').trim() }]);
            await guardar(actual.id, { items, columnas });
            await evento(actual.id, 'HITO', `Ítem agregado: ${des}.`);
        });
    }
    function formVB() {
        const centros = Object.keys(actual.vistoBueno || {}); const cols = [...new Set((actual.columnas || []).map(c => c.centro))];
        const opciones = [...new Set([...centros, ...cols])];
        modal('V°B° de un centro', `<label class="cag-f">Centro<input id="v-cen" list="v-lista" value="">${`<datalist id="v-lista">${opciones.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`}</label>
            <label class="cag-f">Resultado<select id="v-est"><option value="VB">V°B° (conforme)</option><option value="OBSERVADO">Con observación</option><option value="PENDIENTE">Pendiente</option></select></label>${campo('v-fec', 'Fecha', 'date', hoyISO())}${campo('v-not', 'Nota u observación')}`, async (ov) => {
            const c = v(ov, 'v-cen').trim(); if (!c) { toast('Falta dato', 'Indica el centro.', 'warning'); return false; }
            const vb = { ...(actual.vistoBueno || {}), [c]: { estado: v(ov, 'v-est'), fecha: v(ov, 'v-fec'), nota: v(ov, 'v-not').trim() } };
            await guardar(actual.id, { vistoBueno: vb });
            await evento(actual.id, 'VB', `${c}: ${v(ov, 'v-est') === 'VB' ? 'V°B° conforme' : v(ov, 'v-est')}${v(ov, 'v-not') ? ' — ' + v(ov, 'v-not') : ''}.`, v(ov, 'v-fec'));
        });
    }
    function formDoc(n) {
        const d = (actual.documentos || [])[n]; if (!d) return;
        modal(d.nombre, `<label class="cag-f">Estado<select id="d-est"><option value="RECIBIDO" ${d.estado === 'RECIBIDO' ? 'selected' : ''}>Recibido</option><option value="PENDIENTE" ${d.estado !== 'RECIBIDO' ? 'selected' : ''}>Falta</option></select></label>
            ${campo('d-ven', 'Fecha de vencimiento (si aplica)', 'date', d.vence)}${campo('d-emi', 'Fecha de emisión (si aplica)', 'date', d.emitido)}${campo('d-not', 'Nota', 'text', d.nota)}`, async (ov) => {
            const docs = (actual.documentos || []).map((x, i) => i === n ? { ...x, estado: v(ov, 'd-est'), vence: v(ov, 'd-ven') || '', emitido: v(ov, 'd-emi') || '', nota: v(ov, 'd-not').trim() } : x);
            await guardar(actual.id, { documentos: docs });
            await evento(actual.id, 'DOC', `Documento "${d.nombre}": ${v(ov, 'd-est') === 'RECIBIDO' ? 'recibido' : 'falta'}${v(ov, 'd-ven') ? ', vence ' + fmtFecha(v(ov, 'd-ven')) : ''}.`);
        });
    }
    function formOC() {
        modal('Vincular orden de compra', `${campo('c-oc', 'N° de la OC (ej. 1298355-1122-AG26)', 'text', actual.ocNumero)}<small>Si la OC se ingresa en "Seguimiento de OC" con el mismo prefijo, se enlazan solas.</small>`, async (ov) => {
            const o = v(ov, 'c-oc').trim(); if (!/^\d+-\d+-[A-Za-z0-9]+$/.test(o)) { toast('Falta dato', 'El N° de OC debe verse como 1298355-1122-AG26.', 'warning'); return false; }
            await guardar(actual.id, { ocNumero: o }); await evento(actual.id, 'HITO', `OC emitida: ${o}.`);
        });
    }
    function formNota() {
        modal('Agregar nota', `<label class="cag-f">Nota<textarea id="t-not" rows="4"></textarea></label>`, async (ov) => {
            const t = v(ov, 't-not').trim(); if (!t) return false; await evento(actual.id, 'NOTA', t);
        });
    }
    function formCerrar() {
        modal('Cerrar la compra ágil', `<label class="cag-f">Motivo (desierta, anulada, sin ofertas, etc.)<textarea id="x-mot" rows="3"></textarea></label>`, async (ov) => {
            const m = v(ov, 'x-mot').trim(); if (!m) { toast('Falta dato', 'Indica el motivo.', 'warning'); return false; }
            await guardar(actual.id, { cerrada: true, motivoCierre: m }); await evento(actual.id, 'HITO', `Compra cerrada: ${m}`);
        });
    }

    window.SAR_ComprasAgiles = { abrir, estadoCA, alertas, vbCompleto, prefijo, ofertaElegida, datosTermometros, distTotal, totalItems, _setOcs: (o) => { ocs = o; }, ocDe };
})(window, document);
