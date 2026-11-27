/* ==========================================================================
   HISTÓRICO POR CENTRO — ACTAS DE ENTREGA (v21.277)
   --------------------------------------------------------------------------
   Apartado dentro de «Actas de entrega» para consultar todo lo entregado a
   cada centro: resumen consolidado por producto, línea cronológica de actas,
   filtros por fecha/texto/estado y exportación Excel (CSV).
   Solo lee Actas_Entrega; no modifica stock ni requiere nuevas reglas.
   ========================================================================== */
(function (window, document) {
    'use strict';

    const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
    const num = (v) => Number(v) || 0;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); };

    const normalizarCentro = (nombre) => norm(nombre);

    function estadoActa(a) {
        if (!a) return 'porfirmar';
        if (a.estado === 'ANULADA') return 'anulada';
        if (a.tipo !== 'OXIGENO' && a.confirmacion && a.confirmacion.estado === 'PENDIENTE') return 'porfirmar';
        return a.respaldo ? 'firmada' : 'confirmada';
    }

    function fechaISO(a) {
        const f = String((a && a.fecha) || '').trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(f)) return f.slice(0, 10);
        const c = a && a.creadoEn;
        try {
            if (c && typeof c.toDate === 'function') return c.toDate().toISOString().slice(0, 10);
            if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c)) return c.slice(0, 10);
        } catch (e) { /* sin fecha */ }
        return '';
    }

    function fechaCL(iso) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—');
    }

    /** Agrupa todas las actas por centro normalizado con indicadores rápidos. */
    function listarCentrosDeActas(actas) {
        const mapa = new Map();
        (actas || []).forEach(a => {
            const nombre = String((a && a.centro) || '').trim().replace(/\s+/g, ' ');
            const clave = normalizarCentro(nombre);
            if (!clave) return;
            let e = mapa.get(clave);
            if (!e) {
                e = { clave, centro: nombre, nombres: new Map(), actasValidas: 0, actasAnuladas: 0, firmadas: 0, porConfirmar: 0, unidades: 0, prods: new Set(), primeraFecha: '', ultimaFecha: '' };
                mapa.set(clave, e);
            }
            e.nombres.set(nombre, (e.nombres.get(nombre) || 0) + 1);
            const est = estadoActa(a), f = fechaISO(a);
            if (est === 'anulada') { e.actasAnuladas++; return; }
            e.actasValidas++;
            if (est === 'porfirmar') e.porConfirmar++;
            else e.firmadas++;
            if (f) {
                if (!e.primeraFecha || f < e.primeraFecha) e.primeraFecha = f;
                if (!e.ultimaFecha || f > e.ultimaFecha) e.ultimaFecha = f;
            }
            (a.items || []).forEach(i => {
                const q = num(i.cantidad);
                e.unidades += q;
                const pk = i.codigoMP ? 'c:' + String(i.codigoMP).replace(/\D/g, '') : 'n:' + norm(i.nombre);
                if (pk !== 'n:') e.prods.add(pk);
            });
        });
        return [...mapa.values()].map(e => {
            let mejor = e.centro, maxN = 0;
            e.nombres.forEach((c, nm) => { if (c > maxN) { maxN = c; mejor = nm; } });
            return {
                clave: e.clave,
                centro: mejor,
                actasValidas: e.actasValidas,
                actasAnuladas: e.actasAnuladas,
                firmadas: e.firmadas,
                porConfirmar: e.porConfirmar,
                productosUnicos: e.prods.size,
                unidades: e.unidades,
                primeraFecha: e.primeraFecha,
                ultimaFecha: e.ultimaFecha
            };
        }).sort((a, b) => (b.ultimaFecha || '').localeCompare(a.ultimaFecha || '') || b.actasValidas - a.actasValidas || a.centro.localeCompare(b.centro, 'es'));
    }

    /**
     * Construye el histórico filtrado de un centro:
     * - kpis: actasValidas, confirmadas, porConfirmar, anuladas, productosUnicos, unidades, primeraFecha, ultimaFecha
     * - productos: consolidado por producto (total unidades, veces, última fecha/acta, bodegas, detalle de entregas)
     * - actas: lista cronológica (más reciente primero)
     */
    function resumenCentro(actas, centroClave, filtros) {
        const f = filtros || {};
        const claveObj = normalizarCentro(centroClave);
        const q = norm(f.q || '');
        const desde = String(f.desde || '').trim();
        const hasta = String(f.hasta || '').trim();
        const incPorConf = f.incluirPorConfirmar !== false;
        const incAnuladas = !!f.incluirAnuladas;

        const delCentro = (actas || []).filter(a => normalizarCentro(a && a.centro) === claveObj);
        const filtradas = [];
        const prodMap = new Map();
        const kpis = { actasValidas: 0, confirmadas: 0, porConfirmar: 0, anuladas: 0, productosUnicos: 0, unidades: 0, primeraFecha: '', ultimaFecha: '' };

        const ordenadas = delCentro.slice().sort((a, b) => fechaISO(b).localeCompare(fechaISO(a)) || String(b.numero || '').localeCompare(String(a.numero || '')));

        ordenadas.forEach(a => {
            const est = estadoActa(a), fec = fechaISO(a);
            if (desde && fec && fec < desde) return;
            if (hasta && fec && fec > hasta) return;
            if (est === 'anulada') {
                kpis.anuladas++;
                if (!incAnuladas) return;
            } else if (est === 'porfirmar' && !incPorConf) {
                return;
            }
            const itemsAll = (a.items || []).map(i => ({
                nombre: String(i.nombre || '').trim(),
                codigoMP: String(i.codigoMP || i.codigo || '').trim(),
                cantidad: num(i.cantidad),
                solicitado: num(i.solicitado),
                bodega: String(i.bodega || a.bodegaOrigen || '').trim(),
                sinRespaldo: num(i.sinRespaldo),
                serie: i.serie || ''
            }));
            const matchActa = !q || norm([a.numero, a.bodegaOrigen, a.creadoPor, (a.documentos || []).map(d => d.numero).join(' ')].join(' ')).includes(q);
            const itemsVis = matchActa ? itemsAll : itemsAll.filter(i => norm(i.nombre + ' ' + i.codigoMP + ' ' + i.bodega).includes(q));
            if (q && !matchActa && !itemsVis.length) return;

            const unActa = itemsVis.reduce((s, i) => s + i.cantidad, 0);
            filtradas.push({ ...a, _fecha: fec, _estado: est, _itemsVis: itemsVis, _unidades: unActa });

            if (est === 'anulada') return;
            kpis.actasValidas++;
            if (est === 'porfirmar') kpis.porConfirmar++;
            else kpis.confirmadas++;
            if (fec) {
                if (!kpis.primeraFecha || fec < kpis.primeraFecha) kpis.primeraFecha = fec;
                if (!kpis.ultimaFecha || fec > kpis.ultimaFecha) kpis.ultimaFecha = fec;
            }

            itemsVis.forEach(i => {
                if (!(i.cantidad > 0)) return;
                kpis.unidades += i.cantidad;
                const cod = i.codigoMP.replace(/\D/g, '');
                const pk = cod ? 'c:' + cod : 'n:' + norm(i.nombre);
                let p = prodMap.get(pk);
                if (!p) {
                    p = { clave: pk, nombre: i.nombre, codigoMP: cod, total: 0, entregas: 0, actasSet: new Set(), bodegas: new Set(), ultimaFecha: '', ultimaActa: '', tipo: a.tipo || '', detalle: [] };
                    prodMap.set(pk, p);
                }
                if (i.nombre.length > p.nombre.length) p.nombre = i.nombre;
                p.total += i.cantidad;
                p.entregas++;
                if (a.numero) p.actasSet.add(a.numero);
                if (i.bodega) p.bodegas.add(i.bodega);
                if (!p.ultimaFecha || (fec && fec > p.ultimaFecha)) { p.ultimaFecha = fec; p.ultimaActa = a.numero || ''; }
                p.detalle.push({ fecha: fec, numero: a.numero || '', cantidad: i.cantidad, solicitado: i.solicitado, bodega: i.bodega, estado: est, por: a.creadoPor || '', docs: (a.documentos || []).map(d => `${d.tipo || ''} ${d.numero || ''}`.trim()).filter(Boolean).join(', ') });
            });
        });

        const productos = [...prodMap.values()].map(p => ({
            clave: p.clave,
            nombre: p.nombre,
            codigoMP: p.codigoMP,
            total: p.total,
            actas: p.actasSet.size || p.entregas,
            bodegas: [...p.bodegas],
            ultimaFecha: p.ultimaFecha,
            ultimaActa: p.ultimaActa,
            tipo: p.tipo,
            detalle: p.detalle
        })).sort((a, b) => b.total - a.total || (b.ultimaFecha || '').localeCompare(a.ultimaFecha || '') || a.nombre.localeCompare(b.nombre, 'es'));

        kpis.productosUnicos = productos.length;
        return { kpis, productos, actas: filtradas };
    }

    function celdaCSV(v) {
        const s = String(v == null ? '' : v).replace(/\r?\n/g, ' ');
        return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    /** Genera CSV (separador ; para Excel Chile) con el detalle por acta y producto del centro. */
    function generarCSV(centroNombre, res) {
        const cab = ['Fecha', 'N° Acta', 'Estado', 'Centro', 'Bodega origen', 'Código MP', 'Producto', 'Cantidad entregada', 'Solicitado', 'Documentos', 'Emitido por'];
        const filas = [cab.map(celdaCSV).join(';')];
        const estLbl = { firmada: 'Firmada', confirmada: 'Confirmada', porfirmar: 'Por confirmar', anulada: 'Anulada' };
        (res && res.actas || []).forEach(a => {
            const docs = (a.documentos || []).map(d => `${d.tipo || ''} ${d.numero || ''}`.trim()).filter(Boolean).join(' | ');
            (a._itemsVis || a.items || []).forEach(i => {
                filas.push([
                    fechaCL(a._fecha || fechaISO(a)),
                    a.numero || '',
                    estLbl[a._estado] || a.estado || '',
                    a.centro || centroNombre || '',
                    i.bodega || a.bodegaOrigen || '',
                    i.codigoMP || '',
                    i.nombre || '',
                    num(i.cantidad),
                    num(i.solicitado) || '',
                    docs,
                    a.creadoPor || ''
                ].map(celdaCSV).join(';'));
            });
        });
        return '\uFEFF' + filas.join('\r\n');
    }

    // ---------------------------------------------------------------
    // Estado y carga desde Firestore
    // ---------------------------------------------------------------
    let cacheActas = null;
    let cargando = null;
    const estadoUI = { centroClave: '', vista: 'productos', q: '', desde: '', hasta: '', incluirPorConfirmar: true, incluirAnuladas: false, busqCentro: '' };

    function invalidarCache() { cacheActas = null; }

    async function cargarTodas(forzar) {
        if (!forzar && cacheActas) return cacheActas;
        if (cargando) return cargando;
        cargando = (async () => {
            const f = fs();
            const snap = await f.getDocs(f.query(f.collection(db(), 'Actas_Entrega'), f.orderBy('creadoEn', 'desc'), f.limit(1500)));
            const out = [];
            snap.forEach(d => out.push({ id: d.id, ...d.data() }));
            cacheActas = out;
            return out;
        })().finally(() => { cargando = null; });
        return cargando;
    }

    function seleccionarCentro(nombre) {
        const cl = normalizarCentro(nombre);
        estadoUI.centroClave = cl;
        estadoUI.q = '';
    }

    function chipEstado(est) {
        if (est === 'anulada') return '<span class="act-chip act-c-anu">Anulada</span>';
        if (est === 'porfirmar') return '<span class="act-chip act-c-pen">Por confirmar</span>';
        if (est === 'firmada') return '<span class="act-chip act-c-ok">Firmada</span>';
        return '<span class="act-chip act-c-sin">Confirmada</span>';
    }

    async function render(el, opc) {
        if (!el) return;
        const o = opc || {};
        if (o.centro) seleccionarCentro(o.centro);
        if (!cacheActas || o.forzar) {
            el.innerHTML = window.SAR_Progreso ? window.SAR_Progreso.cargando('Cargando histórico de entregas por centro…') : '<p class="act-hint">Cargando histórico por centro…</p>';
            try { await cargarTodas(!!o.forzar); }
            catch (e) { el.innerHTML = `<p class="act-err">No se pudo cargar el histórico por centro: ${esc(e.message || e)}</p>`; return; }
        }
        pintar(el);
    }

    function pintar(el) {
        const centros = listarCentrosDeActas(cacheActas || []);
        if (!centros.length) {
            el.innerHTML = `<div class="act-hc-vacio"><i class="ph-bold ph-buildings"></i><h4>Aún no hay entregas registradas</h4><p class="act-hint">Cuando emitas actas de entrega a otros centros, aquí podrás revisar el histórico consolidado por centro y producto.</p></div>`;
            return;
        }
        const bc = norm(estadoUI.busqCentro);
        const centrosVis = centros.filter(c => !bc || c.clave.includes(bc));
        const activo = centros.find(c => c.clave === estadoUI.centroClave) || null;
        const res = activo ? resumenCentro(cacheActas, activo.clave, estadoUI) : null;

        el.innerHTML = `
        <div class="act-hc">
          <div class="act-hc-bar">
            <div class="act-hc-sel">
              <label class="act-l" for="hc-centro">Centro
                <select id="hc-centro" class="form-control">
                  <option value="">— Ver todos los centros (${centros.length}) —</option>
                  ${centros.map(c => `<option value="${esc(c.clave)}"${c.clave === estadoUI.centroClave ? ' selected' : ''}>${esc(c.centro)} · ${c.actasValidas} acta${c.actasValidas === 1 ? '' : 's'} (${c.unidades.toLocaleString('es-CL')} u.)</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="act-hc-acc">
              ${activo ? `<button type="button" class="btn btn-outline btn-sm" id="hc-todos"><i class="ph-bold ph-squares-four"></i> Todos los centros</button>` : ''}
              ${activo && res && res.actas.length ? `<button type="button" class="btn btn-outline btn-sm" id="hc-csv"><i class="ph-bold ph-file-csv"></i> Exportar Excel (CSV)</button>` : ''}
              <button type="button" class="btn btn-outline btn-sm" id="hc-ref"><i class="ph-bold ph-arrows-clockwise"></i> Actualizar</button>
            </div>
          </div>

          ${!activo ? `
            <div class="act-busq" style="margin-bottom:12px;">
              <input type="search" id="hc-bc" class="form-control" value="${esc(estadoUI.busqCentro)}" placeholder="Filtrar centro (ej. Pomaire, Bollenar, Corpo…)" autocomplete="off" aria-label="Filtrar centros">
              <small>${centrosVis.length} de ${centros.length} centros</small>
            </div>
            <div class="act-hc-grid">
              ${centrosVis.map(c => `
                <button type="button" class="act-hc-card" data-hc-c="${esc(c.clave)}">
                  <div class="act-hc-ctop"><strong>${esc(c.centro)}</strong><span class="act-chip">${c.actasValidas} acta${c.actasValidas === 1 ? '' : 's'}</span></div>
                  <div class="act-hc-cstats">
                    <span><b>${c.unidades.toLocaleString('es-CL')}</b> u. entregadas</span>
                    <span><b>${c.productosUnicos}</b> producto${c.productosUnicos === 1 ? '' : 's'}</span>
                  </div>
                  <small>Última entrega: ${esc(fechaCL(c.ultimaFecha))}${c.porConfirmar ? ` · <b>${c.porConfirmar} por confirmar</b>` : ''}</small>
                </button>`).join('')}
            </div>
          ` : `
            <div class="act-hc-head">
              <div>
                <h3 class="act-h" style="margin:0;">${esc(activo.centro)}</h3>
                <small class="act-hint" style="margin:2px 0 0;">${res.kpis.primeraFecha ? `Entregas desde el ${esc(fechaCL(res.kpis.primeraFecha))} hasta el ${esc(fechaCL(res.kpis.ultimaFecha))}` : 'Sin entregas con los filtros actuales'}</small>
              </div>
              <div class="act-hc-kpis">
                <div class="act-hc-kpi"><b>${res.kpis.actasValidas}</b><span>Actas${res.kpis.porConfirmar ? ` (${res.kpis.porConfirmar} por conf.)` : ''}</span></div>
                <div class="act-hc-kpi"><b>${res.kpis.productosUnicos}</b><span>Productos</span></div>
                <div class="act-hc-kpi"><b>${res.kpis.unidades.toLocaleString('es-CL')}</b><span>Unidades</span></div>
              </div>
            </div>

            <div class="act-hc-filtros">
              <input type="search" id="hc-q" class="form-control" value="${esc(estadoUI.q)}" placeholder="Buscar producto, ID, bodega o N° de acta…" autocomplete="off" aria-label="Buscar en histórico del centro">
              <label class="act-hc-f"><span>Desde</span><input type="date" id="hc-desde" class="form-control" value="${esc(estadoUI.desde)}"></label>
              <label class="act-hc-f"><span>Hasta</span><input type="date" id="hc-hasta" class="form-control" value="${esc(estadoUI.hasta)}"></label>
              <label class="act-hc-chk"><input type="checkbox" id="hc-pconf"${estadoUI.incluirPorConfirmar ? ' checked' : ''}> Por confirmar</label>
              <label class="act-hc-chk"><input type="checkbox" id="hc-anu"${estadoUI.incluirAnuladas ? ' checked' : ''}> Ver anuladas${res.kpis.anuladas ? ` (${res.kpis.anuladas})` : ''}</label>
            </div>

            <div class="act-hc-subtabs" role="tablist">
              <button type="button" class="btn btn-sm ${estadoUI.vista === 'productos' ? 'btn-primary' : 'btn-outline'}" data-hc-v="productos"><i class="ph-bold ph-package"></i> Por producto (${res.productos.length})</button>
              <button type="button" class="btn btn-sm ${estadoUI.vista === 'actas' ? 'btn-primary' : 'btn-outline'}" data-hc-v="actas"><i class="ph-bold ph-files"></i> Por acta (${res.actas.length})</button>
            </div>

            ${estadoUI.vista === 'productos' ? (
              res.productos.length ? `
                <div class="act-hc-tw">
                  <table class="table act-hc-tb">
                    <thead><tr><th>Producto</th><th style="text-align:right;">Total entregado</th><th style="text-align:right;">Actas</th><th>Última entrega</th><th>Bodega(s)</th><th>Detalle</th></tr></thead>
                    <tbody>
                      ${res.productos.map((p, idx) => `
                        <tr>
                          <td>
                            <div class="act-hc-p">
                              ${window.SAR_Imagenes ? window.SAR_Imagenes.thumb(p.nombre, { codigo: p.codigoMP }) : ''}
                              <div><strong>${esc(p.nombre)}</strong>${p.codigoMP ? `<small>ID ${esc(p.codigoMP)}</small>` : ''}${p.tipo === 'OXIGENO' ? '<small>Oxígeno</small>' : ''}</div>
                            </div>
                          </td>
                          <td style="text-align:right;"><b>${p.total.toLocaleString('es-CL')}</b> u.</td>
                          <td style="text-align:right;">${p.actas}</td>
                          <td>${esc(fechaCL(p.ultimaFecha))}${p.ultimaActa ? `<br><button type="button" class="act-hc-link" data-hc-acta="${esc(p.ultimaActa)}">${esc(p.ultimaActa)}</button>` : ''}</td>
                          <td>${p.bodegas.length ? p.bodegas.map(b => `<span class="act-bod-tag">${esc(b)}</span>`).join(' ') : '—'}</td>
                          <td>
                            <details class="act-hc-det">
                              <summary>Ver ${p.detalle.length} entrega${p.detalle.length === 1 ? '' : 's'}</summary>
                              <ul>${p.detalle.map(d => `<li><span>${esc(fechaCL(d.fecha))}</span> · <button type="button" class="act-hc-link" data-hc-acta="${esc(d.numero)}">${esc(d.numero)}</button> · <b>${d.cantidad.toLocaleString('es-CL')} u.</b>${d.bodega ? ` · ${esc(d.bodega)}` : ''} ${chipEstado(d.estado)}</li>`).join('')}</ul>
                            </details>
                          </td>
                        </tr>`).join('')}
                    </tbody>
                  </table>
                </div>` : '<p class="act-hint">No hay productos entregados con los filtros actuales.</p>'
            ) : (
              res.actas.length ? `
                <div class="act-hist">
                  ${res.actas.map(a => `
                    <div class="act-hrow${a._estado === 'anulada' ? ' act-anulada' : ''}" data-hc-acta="${esc(a.numero)}" role="button" tabindex="0">
                      <div class="act-hinfo">
                        <div class="act-htit"><strong>${esc(a.numero)}</strong>${chipEstado(a._estado)}${a.conSobregiro ? '<span class="act-chip act-c-sin">Con sobregiro</span>' : ''}</div>
                        <small>${esc(fechaCL(a._fecha))} · ${a._itemsVis.length} producto${a._itemsVis.length === 1 ? '' : 's'} (${a._unidades.toLocaleString('es-CL')} u.) · ${esc(a.bodegaOrigen || '—')} · ${esc(a.creadoPor || '')}</small>
                        <div class="act-hc-mini">${a._itemsVis.slice(0, 5).map(i => `<span>${esc(i.nombre)} <b>×${i.cantidad}</b></span>`).join('')}${a._itemsVis.length > 5 ? `<span>+${a._itemsVis.length - 5} más…</span>` : ''}</div>
                      </div>
                      <div class="act-hbtns">
                        <button type="button" class="btn btn-primary btn-sm" data-hc-acta="${esc(a.numero)}"><i class="ph-bold ph-eye"></i> Ver acta</button>
                      </div>
                    </div>`).join('')}
                </div>` : '<p class="act-hint">No hay actas con los filtros actuales.</p>'
            )}
          `}
        </div>`;

        if (window.SAR_Imagenes) window.SAR_Imagenes.rellenar(el);

        const sel = el.querySelector('#hc-centro');
        if (sel) sel.addEventListener('change', () => { estadoUI.centroClave = sel.value; pintar(el); });
        const bt = el.querySelector('#hc-todos');
        if (bt) bt.addEventListener('click', () => { estadoUI.centroClave = ''; pintar(el); });
        const br = el.querySelector('#hc-ref');
        if (br) br.addEventListener('click', () => render(el, { forzar: true }));
        const bcsv = el.querySelector('#hc-csv');
        if (bcsv && activo && res) bcsv.addEventListener('click', () => {
            const csv = generarCSV(activo.centro, res);
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a');
            const slug = activo.centro.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'centro';
            a.href = url; a.download = `Historico_Entregas_${slug}_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
            toast('Excel (CSV) descargado', `Histórico de ${activo.centro} exportado.`, 'success');
        });
        const ibc = el.querySelector('#hc-bc');
        if (ibc) ibc.addEventListener('input', (e) => { const pos = e.target.selectionStart; estadoUI.busqCentro = e.target.value; pintar(el); const n = el.querySelector('#hc-bc'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
        el.querySelectorAll('[data-hc-c]').forEach(b => b.addEventListener('click', () => { estadoUI.centroClave = b.dataset.hcC; pintar(el); }));
        const iq = el.querySelector('#hc-q');
        if (iq) iq.addEventListener('input', (e) => { const pos = e.target.selectionStart; estadoUI.q = e.target.value; pintar(el); const n = el.querySelector('#hc-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
        const ides = el.querySelector('#hc-desde'); if (ides) ides.addEventListener('change', () => { estadoUI.desde = ides.value; pintar(el); });
        const ihas = el.querySelector('#hc-hasta'); if (ihas) ihas.addEventListener('change', () => { estadoUI.hasta = ihas.value; pintar(el); });
        const ipc = el.querySelector('#hc-pconf'); if (ipc) ipc.addEventListener('change', () => { estadoUI.incluirPorConfirmar = ipc.checked; pintar(el); });
        const ian = el.querySelector('#hc-anu'); if (ian) ian.addEventListener('change', () => { estadoUI.incluirAnuladas = ian.checked; pintar(el); });
        el.querySelectorAll('[data-hc-v]').forEach(b => b.addEventListener('click', () => { estadoUI.vista = b.dataset.hcV; pintar(el); }));
        el.querySelectorAll('[data-hc-acta]').forEach(b => {
            const abrirA = (e) => {
                e.stopPropagation();
                const n = b.dataset.hcActa;
                if (n && window.SAR_ActasEntrega && window.SAR_ActasEntrega.verPorNumero) window.SAR_ActasEntrega.verPorNumero(n);
            };
            b.addEventListener('click', abrirA);
            if (b.tagName !== 'BUTTON') b.addEventListener('keydown', (k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); abrirA(k); } });
        });
    }

    const api = { normalizarCentro, estadoActa, fechaISO, listarCentrosDeActas, resumenCentro, generarCSV, invalidarCache, seleccionarCentro, render };
    window.SAR_HistoricoCentro = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
