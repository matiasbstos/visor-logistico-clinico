/* ==========================================================================
   TAGS DE CONTEO «CONTADO», CREDENCIAL DE CONTADOR Y ETIQUETAS DE CAJAS (v21.273)
   DECISIONES 4.305 / 4.319 · Inventario → Tags de conteo (admin y superadmin)
   · Credencial de contador (rol «contador»): crea cuenta @cormumel.cl con clave temporal
     e imprime tarjeta 100×60 mm con QR directo a solicitar.html?modo=contar.
   · Reservar e imprimir N tags «CONTADO» preimpresos (PDF 100×60 Zebra ZD230) con
     correlativo BUL reservado y QR (solicitar.html#t=<10 dígitos>).
   · De vuelta del teléfono: muestra el conteo asociado a cada correlativo, el contador
     total de etiquetas (cajas grandes + subdivisiones interiores y cuánto contiene cada una)
     y permite aceptar + generar e imprimir las etiquetas definitivas de cajas (100×60 mm).
   ========================================================================== */
(function (window, document) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const ent = (v) => Math.max(0, Math.floor(num(v)));
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const usuario = () => { const a = window.firebaseAuth; return (a && a.currentUser && a.currentUser.email) || ''; };
  const toast = (t, m, k) => { if (typeof window.showToast === 'function') window.showToast(t, m, k || 'info'); };
  /* v21.249 (Howard): URL corta con los 10 dígitos para que el QR quepa en 33 módulos con corrección M; el teléfono acepta también #tag= */
  const URL_TAG = 'https://sarinventario.web.app/solicitar.html#t=';
  const URL_CONTEO = 'https://sarinventario.web.app/solicitar.html?modo=contar';
  const urlTag = (folio) => URL_TAG + String(folio || '').replace(/\D/g, '');
  const hora = (iso) => { try { return iso ? new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; } catch (e) { return ''; } };
  const mesCL = (v) => { const m = /^(\d{4})-(\d{2})$/.exec(v || ''); return m ? `${m[2]}/${m[1]}` : (v === 'N/A' ? 's/v' : (v || '')); };
  const fechaElabCL = (v) => {
    const s = String(v || '');
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    m = /^(\d{4})-(\d{2})$/.exec(s);
    if (m) return `${m[2]}/${m[1]}`;
    return '';
  };

  // ---------------- lógica pura ----------------
  const numero = (folio) => String(folio || '').slice(-6);
  const ESTADOS = { sin: 'Sin usar', contado: 'Contado', reconteo: 'Reconteo pedido', etiquetado: 'Etiquetado', incorporado: 'Incorporado', rechazado: 'Rechazado' };
  /** Estado del tag según su conteo: sin usar → contado (REGISTRADO/RECONTEO) → incorporado (ACEPTADO) → etiquetado. */
  function estadoDe(tag, conteo) {
    const e = conteo && conteo.estado;
    if (e === 'ETIQUETADO' || (tag && tag.tipo === 'bulto')) return 'etiquetado';
    if (e === 'ACEPTADO') return 'incorporado';
    if (e === 'RECHAZADO') return 'rechazado';
    if (e === 'RECONTEO') return 'reconteo';
    return conteo ? 'contado' : 'sin';
  }
  /** Misma regla que SAR_Lev.estructuraCorta (teléfono): «9×50 + 1 abierta (30)». */
  function estructuraCorta(e) {
    const ints = (e && Array.isArray(e.interiores) ? e.interiores : []), sue = ent(e && e.sueltas);
    if (!ints.length) return e && e.estado === 'ABIERTA' ? `Granel (${sue})` : `Sin subdivisión (${sue})`;
    const g = new Map(); ints.filter(x => !x.abierta).forEach(x => g.set(ent(x.q), (g.get(ent(x.q)) || 0) + 1));
    const ab = ints.filter(x => x.abierta), p = [...g].map(([q, n]) => `${n}×${q}`);
    if (ab.length) p.push(`${ab.length} abierta${ab.length === 1 ? '' : 's'} (${ab.map(x => ent(x.q)).join(' + ')})`);
    if (sue) p.push(`${sue} sueltas`);
    return p.join(' + ');
  }
  /** Plan de etiquetas de una caja contada: cuántas etiquetas genera (1 grande + N interiores) y cuánto contiene cada una. */
  function planEtiquetasConteo(conteo, opc) {
    if (!conteo) return { subdividida: false, totalUnidades: 0, etiquetasGrande: 0, etiquetasInteriores: 0, totalEtiquetas: 0, sueltas: 0, detalleInteriores: [], resumenCorto: '' };
    const est = conteo.estructura || { estado: 'CERRADA', interiores: [], sueltas: 0 };
    const ints = Array.isArray(est.interiores) ? est.interiores : [];
    const incluirInteriores = !(opc && opc.soloGrande);
    const subdividida = ints.length > 0;
    const etiquetasGrande = 1;
    const etiquetasInteriores = incluirInteriores ? ints.length : 0;
    const totalEtiquetas = etiquetasGrande + etiquetasInteriores;
    const totalUnidades = ent(conteo.total);
    const sueltas = ent(est.sueltas);
    const detalleInteriores = ints.map((x, idx) => ({
      n: idx + 1,
      de: ints.length,
      q: ent(x && x.q),
      abierta: !!(x && x.abierta)
    }));
    let resumenCorto = '';
    if (!subdividida) {
      resumenCorto = `1 caja${est.estado === 'ABIERTA' ? ' abierta' : ''} de ${totalUnidades} u.`;
    } else if (incluirInteriores) {
      resumenCorto = `1 grande (${totalUnidades} u.) + ${ints.length} int. (${estructuraCorta(est)})`;
    } else {
      resumenCorto = `Solo caja grande (${totalUnidades} u. · ${estructuraCorta(est)})`;
    }
    return {
      subdividida,
      estadoCaja: est.estado === 'ABIERTA' ? 'ABIERTA' : 'CERRADA',
      totalUnidades,
      etiquetasGrande,
      etiquetasInteriores,
      totalEtiquetas,
      sueltas,
      detalleInteriores,
      resumenCorto
    };
  }
  /** Contadores agregados de etiquetas sobre una lista de filas (para la barra de resumen). */
  function contadoresEtiquetas(listaFilas) {
    const out = {
      tagsTotal: 0, sinUsar: 0, pendientesEtiquetar: 0, reconteo: 0, etiquetados: 0, rechazados: 0,
      cajasContadas: 0, cajasSubdivididas: 0,
      etiquetasGrandes: 0, etiquetasInteriores: 0, etiquetasTotal: 0,
      etiquetasPendientes: 0, etiquetasGeneradas: 0, unidadesTotal: 0
    };
    (listaFilas || []).forEach(x => {
      out.tagsTotal++;
      if (x.estado === 'sin') { out.sinUsar++; return; }
      if (x.estado === 'reconteo') { out.reconteo++; return; }
      if (x.estado === 'rechazado') { out.rechazados++; return; }
      if (!x.conteo) return;
      out.cajasContadas++;
      out.unidadesTotal += ent(x.conteo.total);
      const pl = planEtiquetasConteo(x.conteo);
      if (pl.subdividida) out.cajasSubdivididas++;
      if (x.estado === 'etiquetado') {
        out.etiquetados++;
        const nHijos = Array.isArray(x.conteo.hijos) ? x.conteo.hijos.length : 0;
        const nGen = 1 + nHijos;
        out.etiquetasGrandes += 1;
        out.etiquetasInteriores += nHijos;
        out.etiquetasGeneradas += nGen;
        out.etiquetasTotal += nGen;
      } else {
        out.pendientesEtiquetar++;
        out.etiquetasGrandes += pl.etiquetasGrande;
        out.etiquetasInteriores += pl.etiquetasInteriores;
        out.etiquetasPendientes += pl.totalEtiquetas;
        out.etiquetasTotal += pl.totalEtiquetas;
      }
    });
    return out;
  }
  const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const slug = (t) => norm(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  const CAT_POR_TIPO = { medico: 'INSUMOS MEDICOS', medicamento: 'MEDICAMENTOS', aseo: 'ASEO', oficina: 'OFICINA' };
  /** Agrupa cajas etiquetadas (sin folio LEV previo) por bodega + producto + lote para ingresarlas al stock. */
  function agruparParaIngreso(conteos) {
    const porProd = new Map();
    (conteos || []).forEach(c => {
      if (!c || c.estado !== 'ETIQUETADO' || c.lev) return;
      const nombre = String(c.nombre || '').trim().toUpperCase();
      const bodega = String(c.bodega || '').trim();
      const bodegaId = String(c.bodegaId || '').trim();
      if (!nombre || !bodega || !(ent(c.total) > 0)) return;
      const k = `${norm(bodega)}|${norm(nombre)}`;
      const g = porProd.get(k) || {
        bodega, bodegaId, nombre, insumoId: c.insumoId || '',
        controlado: c.controlado || null,
        category: CAT_POR_TIPO[c.tipo] || 'General',
        folios: [], lotes: new Map(), total: 0
      };
      if (!g.insumoId && c.insumoId) g.insumoId = c.insumoId;
      if (!g.bodegaId && bodegaId) g.bodegaId = bodegaId;
      g.folios.push(c.folio);
      g.total += ent(c.total);
      const lote = String(c.lote || 'S/L').trim().toUpperCase() || 'S/L';
      const vence = c.vence && c.vence !== 'N/A' ? c.vence : 'N/A';
      const kl = `${lote}|${vence}`;
      const e = g.lotes.get(kl) || { batch: lote, expirationDate: vence, elaboracion: c.elaboracion || '', quantity: 0 };
      e.quantity += ent(c.total);
      if (c.elaboracion && !e.elaboracion) e.elaboracion = c.elaboracion;
      g.lotes.set(kl, e);
      porProd.set(k, g);
    });
    return [...porProd.values()].map(g => ({ ...g, ingresos: [...g.lotes.values()] }));
  }
  /** Mezcla lotes nuevos con los existentes en Insumos: suma lotes iguales y agrega lotes distintos. */
  function mezclarLotesIngreso(actual, ingresos) {
    const m = new Map();
    const prev = actual ? (Array.isArray(actual.batches) && actual.batches.length ? actual.batches : (num(actual.quantity) > 0 ? [{ batch: actual.batch || 'S/L', quantity: num(actual.quantity), expirationDate: actual.expirationDate || 'N/A' }] : [])) : [];
    prev.forEach(b => {
      if (!b) return;
      const q = ent(b.quantity); if (!q) return;
      const lote = String(b.batch || 'S/L').trim().toUpperCase() || 'S/L';
      const vence = String(b.expirationDate || 'N/A').trim() || 'N/A';
      const k = `${lote}|${vence}`;
      const e = m.get(k) || { ...b, batch: lote, expirationDate: vence, quantity: 0 };
      e.quantity += q;
      m.set(k, e);
    });
    (ingresos || []).forEach(ing => {
      const q = ent(ing.quantity); if (!q) return;
      const lote = String(ing.batch || 'S/L').trim().toUpperCase() || 'S/L';
      const vence = String(ing.expirationDate || 'N/A').trim() || 'N/A';
      const k = `${lote}|${vence}`;
      const e = m.get(k) || { batch: lote, expirationDate: vence, quantity: 0 };
      e.quantity += q;
      if (ing.elaboracion && !e.elaboracion) e.elaboracion = ing.elaboracion;
      m.set(k, e);
    });
    const batches = [...m.values()].sort((a, b) => (a.expirationDate === 'N/A' ? 1 : 0) - (b.expirationDate === 'N/A' ? 1 : 0) || String(a.expirationDate).localeCompare(String(b.expirationDate)));
    return { batches, quantity: batches.reduce((t, b) => t + ent(b.quantity), 0) };
  }
  /** Arma los documentos bulto [cajaGrande, ...interiores] a partir de un conteo y los folios BUL reservados para las interiores. */
  function armarBultosDeConteo(conteo, foliosHijos, opc) {
    if (!conteo || !conteo.folio) throw new Error('Falta el conteo de la caja.');
    const plan = planEtiquetasConteo(conteo, opc);
    const hijosFol = Array.isArray(foliosHijos) ? foliosHijos : [];
    if (plan.etiquetasInteriores !== hijosFol.length) {
      throw new Error(`Se esperaban ${plan.etiquetasInteriores} folios para cajas interiores y llegaron ${hijosFol.length}.`);
    }
    const ahora = (opc && opc.ahora) || new Date().toISOString();
    const por = (opc && opc.por) != null ? opc.por : usuario();
    const est = conteo.estructura || { estado: 'CERRADA', interiores: [], sueltas: 0 };
    const comun = {
      tipo: 'bulto',
      grupo: conteo.folio,
      nombre: conteo.nombre || '',
      insumoId: conteo.insumoId || '',
      codigoMP: '',
      bodega: conteo.bodega || '',
      bodegaId: conteo.bodegaId || '',
      lote: conteo.lote || 'S/L',
      ...(conteo.elaboracion ? { elaboracion: conteo.elaboracion } : {}),
      vence: conteo.vence && conteo.vence !== 'N/A' ? conteo.vence : '',
      proveedor: '',
      oc: '',
      rec: '',
      fechaRecepcion: ahora.slice(0, 10),
      creadoEn: ahora,
      creadoPor: por,
      impresiones: 0,
      origen: 'levantamiento',
      contadoPor: conteo.contadoPor || '',
      contadoNombre: conteo.contadoNombre || '',
      historial: [{ accion: 'ETIQUETADO_LEVANTAMIENTO', por, en: ahora }]
    };
    const porSub = plan.detalleInteriores.length ? plan.detalleInteriores[0].q : 0;
    const padre = {
      ...comun,
      folio: conteo.folio,
      estado: plan.estadoCaja,
      n: 1,
      de: 1,
      contenido: plan.totalUnidades,
      inicial: plan.totalUnidades,
      porCaja: plan.totalUnidades,
      totalGrupo: plan.totalUnidades,
      ...(hijosFol.length ? { hijos: hijosFol, subcajas: hijosFol.length, porSubcaja: porSub } : {}),
      ...(plan.subdividida ? { estructuraTexto: estructuraCorta(est) } : {})
    };
    const lista = [padre];
    if (plan.etiquetasInteriores > 0) {
      plan.detalleInteriores.forEach((h, idx) => {
        lista.push({
          ...comun,
          folio: hijosFol[idx],
          nivel: 'interior',
          padre: conteo.folio,
          padreN: 1,
          padreDe: 1,
          estado: h.abierta ? 'ABIERTA' : 'CERRADA',
          n: idx + 1,
          de: plan.detalleInteriores.length,
          contenido: h.q,
          inicial: h.q,
          porCaja: h.q,
          totalGrupo: plan.totalUnidades
        });
      });
    }
    return lista;
  }
  /** Une tags y conteos por folio (un conteo sin tag registrado también aparece). Más nuevos primero. */
  function unir(tags, conteos) {
    const m = new Map();
    (tags || []).forEach(t => { if (t && t.folio) m.set(t.folio, { folio: t.folio, tag: t, conteo: null }); });
    (conteos || []).forEach(c => { if (!c || !c.folio) return; const e = m.get(c.folio) || { folio: c.folio, tag: null, conteo: null }; e.conteo = c; m.set(c.folio, e); });
    return [...m.values()].map(x => ({ ...x, estado: estadoDe(x.tag, x.conteo) })).sort((a, b) => b.folio.localeCompare(a.folio));
  }
  function filtrar(filas, f) {
    const q = String(f.q || '').trim().toLowerCase();
    const qDig = q.replace(/\D/g, '');
    return filas.filter(x => {
      const bodFila = (x.conteo && x.conteo.bodega) || (x.tag && x.tag.bodega) || '';
      return (!f.bodega || bodFila === f.bodega)
        && (!f.estado || x.estado === f.estado)
        && (!q || (qDig && (x.folio.replace(/\D/g, '').endsWith(qDig) || numero(x.folio).includes(qDig))) || (x.conteo && String(x.conteo.nombre || '').toLowerCase().includes(q)));
    });
  }

  // ---------------- datos ----------------
  const refTag = (folio) => fs().doc(fs().collection(db(), 'Contadores'), 'bulto-' + folio);
  const refConteo = (folio) => fs().doc(fs().collection(db(), 'Conteos_Cajas'), folio);
  async function listarBodegas() {
    try {
      const f = fs(), sn = await f.getDocs(f.collection(db(), 'Bodegas')), out = [];
      sn.forEach(d => {
        const b = d.data() || {};
        if (!b.archivada && b.estado !== 'ARCHIVADA' && b.isActive !== false) {
          out.push({ id: d.id, name: String(b.name || b.nombre || d.id).trim() });
        }
      });
      return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    } catch (e) { return []; }
  }
  async function crearBodegaRapida(nombre) {
    const n = String(nombre || '').trim().replace(/\s+/g, ' ');
    if (n.length < 3) throw new Error('Escribe un nombre de bodega válido (mínimo 3 letras).');
    const f = fs();
    const id = 'bod-' + n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + Date.now().toString(36).slice(-4);
    const ref = f.doc(f.collection(db(), 'Bodegas'), id);
    await f.setDoc(ref, {
      name: n,
      type: 'transitoria',
      managerName: usuario() || 'Bodega',
      isActive: true,
      usaEstantes: false,
      prefijo: '',
      createdAt: f.serverTimestamp()
    });
    return { id, name: n };
  }
  async function reservar(n, bod) {
    const B = window.SAR_Bultos; if (!B || !B.reservarFolios) throw new Error('Falta el módulo de bultos.');
    const k = Math.floor(num(n)); if (k < 1 || k > 200) throw new Error('Indica entre 1 y 200 tags.');
    const { anio, ini, enLinea } = await B.reservarFolios(k), ahora = new Date().toISOString(), f = fs();
    const bodMeta = bod && bod.name ? { bodega: bod.name, bodegaId: bod.id || '' } : {};
    const lista = Array.from({ length: k }, (_, i) => ({ tipo: 'tag-conteo', folio: `BUL-${anio}-${String(ini + i).padStart(6, '0')}`, estado: 'TAG', ...bodMeta, creadoEn: ahora, creadoPor: usuario(), impresiones: 0 }));
    if (enLinea) { for (const t of lista) await f.setDoc(refTag(t.folio), t); }
    else lista.forEach(t => { t.sinConexion = true; f.setDoc(refTag(t.folio), t).catch(e => console.warn('[Tags] se subirá al volver internet', t.folio, e)); });
    return lista;
  }
  async function listar() {
    const f = fs(), [st, sc] = await Promise.all([
      f.getDocs(f.query(f.collection(db(), 'Contadores'), f.where('tipo', '==', 'tag-conteo'), f.limit(5000))),
      f.getDocs(f.query(f.collection(db(), 'Conteos_Cajas'), f.limit(5000)))
    ]);
    const t = [], c = [];
    st.forEach(x => t.push(x.data()));
    sc.forEach(x => c.push({ ...x.data(), folio: x.data().folio || x.id }));
    return { tags: t, conteos: c };
  }
  async function listarContadores() {
    try {
      const f = fs(), sn = await f.getDocs(f.query(f.collection(db(), 'Usuarios'), f.where('rol', '==', 'contador'), f.limit(200)));
      const out = [];
      sn.forEach(d => out.push({ id: d.id, ...(d.data() || {}) }));
      return out.sort((a, b) => String(a.nombre || a.email || '').localeCompare(String(b.nombre || b.email || ''), 'es'));
    } catch (e) { return []; }
  }

  /** Acepta un conteo (si aún está REGISTRADO), genera sus bultos (padre + interiores), marca ETIQUETADO y retorna los bultos creados. */
  async function generarBultosParaConteo(conteo, opc) {
    const B = window.SAR_Bultos, f = fs();
    if (!B || !B.reservarFolios || !B.pdf) throw new Error('Falta el módulo de etiquetas (bultos.js).');
    const sn = await f.getDoc(refConteo(conteo.folio));
    const fresh = sn.exists() ? { ...sn.data(), folio: sn.data().folio || sn.id } : conteo;
    if (fresh.estado === 'ETIQUETADO') throw new Error(`El tag N° ${numero(fresh.folio)} ya tiene etiquetas generadas. Usa «Reimprimir».`);
    if (fresh.estado === 'RECHAZADO') throw new Error(`El tag N° ${numero(fresh.folio)} está rechazado.`);
    if (fresh.estado === 'RECONTEO') throw new Error(`El tag N° ${numero(fresh.folio)} está esperando reconteo en el teléfono.`);

    const plan = planEtiquetasConteo(fresh, opc);
    const ahora = new Date().toISOString();
    const por = usuario();

    // Paso 1: transición REGISTRADO → ACEPTADO (exigida por firestore.rules antes de pasar a ETIQUETADO)
    if (fresh.estado === 'REGISTRADO') {
      await f.updateDoc(refConteo(fresh.folio), {
        estado: 'ACEPTADO',
        aceptadoPor: por,
        aceptadoEn: ahora,
        aceptadoTotal: fresh.total,
        aceptadoLote: fresh.lote,
        aceptadoVence: fresh.vence,
        aceptadoInsumoId: fresh.insumoId || null,
        insumoId: fresh.insumoId || null
      });
    }

    // Paso 2: reservar folios BUL solo para las cajas interiores (la caja grande conserva el correlativo del tag)
    let foliosHijos = [];
    if (plan.etiquetasInteriores > 0) {
      const { anio, ini } = await B.reservarFolios(plan.etiquetasInteriores);
      foliosHijos = Array.from({ length: plan.etiquetasInteriores }, (_, i) => `BUL-${anio}-${String(ini + i).padStart(6, '0')}`);
    }

    const bultos = armarBultosDeConteo(fresh, foliosHijos, { ...opc, ahora, por });

    // Paso 3: guardar caja grande (actualiza Contadores/bulto-<folio> a tipo 'bulto') y cada caja interior
    for (const b of bultos) {
      await f.setDoc(refTag(b.folio), { ...b, impresiones: 1, primeraImpresion: ahora, ultimaImpresion: ahora, actualizado: ahora }, { merge: true });
    }

    // Paso 4: transición ACEPTADO → ETIQUETADO registrando los folios hijos
    await f.updateDoc(refConteo(fresh.folio), {
      estado: 'ETIQUETADO',
      hijos: foliosHijos
    });

    return bultos;
  }

  /** Carga los bultos ya generados (padre + hijos) para reimprimir o consultar detalle. */
  async function leerBultosDeConteo(conteo) {
    const f = fs();
    const folios = [conteo.folio].concat(Array.isArray(conteo.hijos) ? conteo.hijos : []);
    const snaps = await Promise.all(folios.map(fo => f.getDoc(refTag(fo))));
    return snaps.filter(s => s.exists()).map(s => s.data());
  }

  async function reimprimirBultosDeConteo(conteo) {
    const B = window.SAR_Bultos, f = fs();
    const bultos = await leerBultosDeConteo(conteo);
    if (!bultos.length) throw new Error('No se encontraron las etiquetas guardadas para este tag.');
    await B.pdf(bultos, `etiquetas-${conteo.folio}.pdf`);
    const ahora = new Date().toISOString();
    await Promise.all(bultos.map(b => f.setDoc(refTag(b.folio), { impresiones: num(b.impresiones) + 1, ultimaImpresion: ahora, actualizado: ahora }, { merge: true }).catch(() => null)));
    return bultos;
  }

  async function pedirReconteo(conteo, nota) {
    const f = fs();
    await f.updateDoc(refConteo(conteo.folio), {
      estado: 'RECONTEO',
      reconteoPedidoPor: usuario(),
      reconteoEn: new Date().toISOString(),
      ...(nota ? { nota: String(nota).slice(0, 300) } : {})
    });
  }
  async function aceptarConteo(conteo) {
    const f = fs();
    const sn = await f.getDoc(refConteo(conteo.folio));
    const fresh = sn.exists() ? { ...sn.data(), folio: sn.data().folio || sn.id } : conteo;
    if (fresh.estado !== 'REGISTRADO') throw new Error(`Este tag está en estado ${fresh.estado}.`);
    await f.updateDoc(refConteo(fresh.folio), {
      estado: 'ACEPTADO',
      aceptadoPor: usuario(),
      aceptadoEn: new Date().toISOString(),
      aceptadoTotal: fresh.total,
      aceptadoLote: fresh.lote,
      aceptadoVence: fresh.vence,
      aceptadoInsumoId: fresh.insumoId || null,
      insumoId: fresh.insumoId || null
    });
  }
  async function rechazarConteo(conteo, motivo) {
    const f = fs();
    await f.updateDoc(refConteo(conteo.folio), {
      estado: 'RECHAZADO',
      rechazadoPor: usuario(),
      rechazadoEn: new Date().toISOString(),
      motivoRechazo: String(motivo || 'Rechazado por bodega').slice(0, 300)
    });
  }

  /** Incorpora al stock de Insumos (y registra Historial_Movimientos en una sola transacción por producto) las cajas etiquetadas sin folio LEV. */
  async function ingresarStockLevantamiento(conteos) {
    const grupos = agruparParaIngreso(conteos);
    if (!grupos.length) throw new Error('No hay cajas etiquetadas pendientes de ingresar al stock.');
    const f = fs(), por = usuario();
    const lev = window.SAR_Folio ? await window.SAR_Folio.siguiente('LEV') : `LEV-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
    let totalUnidades = 0, totalCajas = 0;

    for (let gi = 0; gi < grupos.length; gi++) {
      const g = grupos[gi];
      let ref = null;
      if (g.insumoId) {
        const snId = await f.getDoc(f.doc(f.collection(db(), 'Insumos'), g.insumoId));
        if (snId.exists()) {
          const x = snId.data() || {};
          if ((g.bodegaId && x.bodegaId === g.bodegaId) || norm(x.location || x.bodegaNombre) === norm(g.bodega)) {
            ref = f.doc(f.collection(db(), 'Insumos'), snId.id);
          }
        }
      }
      if (!ref) {
        const s1 = await f.getDocs(f.query(f.collection(db(), 'Insumos'), f.where('name', '==', g.nombre), f.limit(15)));
        s1.forEach(d => {
          const x = d.data() || {};
          if (!ref && ((g.bodegaId && x.bodegaId === g.bodegaId) || norm(x.location || x.bodegaNombre) === norm(g.bodega))) {
            ref = f.doc(f.collection(db(), 'Insumos'), d.id);
          }
        });
      }
      if (!ref) {
        ref = f.doc(f.collection(db(), 'Insumos'), `inv_${slug(g.nombre)}__${slug(g.bodega)}`);
      }

      const refsH = g.ingresos.map((_, j) => f.doc(f.collection(db(), 'Historial_Movimientos'), `lev-${lev}-${gi}-${j}`));
      await f.runTransaction(db(), async (tx) => {
        const ya = await tx.get(refsH[0]);
        if (ya.exists()) return;
        const sn = await tx.get(ref), actual = sn.exists() ? sn.data() : null;
        const m = mezclarLotesIngreso(actual, g.ingresos);
        const limite = num(actual && (actual.criticalLimit || actual.stock_minimo)) || 50;
        const prox = m.batches[0];
        const base = {
          origenOC: true,
          origenIngreso: (actual && actual.origenIngreso) || 'LEVANTAMIENTO',
          quantity: m.quantity,
          batches: m.batches,
          isCritical: m.quantity <= limite,
          batch: prox ? prox.batch : '',
          expirationDate: prox ? prox.expirationDate : 'N/A',
          bodegaNombre: g.bodega,
          location: g.bodega,
          ...(g.bodegaId ? { bodegaId: g.bodegaId } : {}),
          updatedAt: f.serverTimestamp()
        };
        if (actual) {
          tx.update(ref, base);
        } else {
          tx.set(ref, {
            code: 'LEV-' + slug(g.nombre).slice(0, 8).toUpperCase() + '-' + String(gi + 1).padStart(2, '0'),
            name: g.nombre,
            name_lowercase: g.nombre.toLowerCase(),
            category: g.category || 'General',
            ...(g.controlado ? { controlado: g.controlado } : {}),
            unitPrice: 0,
            criticalLimit: 50,
            ...base
          });
        }
        g.ingresos.forEach((ing, j) => {
          tx.set(refsH[j], {
            insumoName: g.nombre,
            item: g.nombre,
            quantity: ing.quantity,
            type: 'INGRESO_LEVANTAMIENTO',
            batch: ing.batch,
            expirationDate: ing.expirationDate,
            ...(ing.elaboracion ? { elaboracion: ing.elaboracion } : {}),
            destination: g.bodega,
            dest: g.bodega,
            ...(g.bodegaId ? { destinoId: g.bodegaId } : {}),
            destinoNombre: g.bodega,
            origin: 'Levantamiento con teléfono',
            user: por,
            idInsumoDestino: ref.id,
            observacion: `Ingreso desde levantamiento ${lev} (${g.folios.length} caja${g.folios.length === 1 ? '' : 's'}: ${g.folios.slice(0, 5).map(numero).join(', ')}${g.folios.length > 5 ? '…' : ''})`,
            date: f.serverTimestamp(),
            document: `${lev} · Levantamiento`
          });
        });
      });

      // Estampa el folio LEV en cada caja contada (regla firestore.rules: ETIQUETADO + !('lev' in resource.data))
      await Promise.all(g.folios.map(fo => f.updateDoc(refConteo(fo), { lev }).catch(() => null)));
      totalUnidades += g.total;
      totalCajas += g.folios.length;
    }

    return { lev, productos: grupos.length, cajas: totalCajas, unidades: totalUnidades };
  }

  // ---------------- PDF 100×60 (Tags CONTADO y Credencial de Contador) ----------------
  let logo = null;
  function cargarLogo() {
    if (logo) return Promise.resolve(logo);
    return new Promise(ok => { const im = new Image(); im.onload = () => { try { const c = document.createElement('canvas'); c.width = 560; c.height = 175; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); logo = { d: c.toDataURL('image/jpeg', 0.92), r: 640 / 200 }; ok(logo); } catch (e) { ok(null); } }; im.onerror = () => ok(null); im.src = 'assets/logo/horizontal.svg'; });
  }
  async function pdfCredencial(cred, opc) {
    const J = window.jspdf && window.jspdf.jsPDF, B = window.SAR_Bultos;
    if (!J) throw new Error('La librería de PDF aún no carga; intenta de nuevo en unos segundos.');
    if (B && B.cargarQR) await B.cargarQR();
    const lg = await cargarLogo();
    const d = new J({ orientation: 'landscape', unit: 'mm', format: [100, 60] });
    const PUNTO = 25.4 / 203, g = (v) => Math.round(v / PUNTO) * PUNTO;
    d.setTextColor(0); d.setDrawColor(0); d.setFillColor(0);
    if (lg) d.addImage(lg.d, 'JPEG', 3, 2, 17, 17 / lg.r, 'logo', 'FAST');
    d.rect(22, 1.8, 52, 8, 'F');
    d.setTextColor(255); d.setFont('helvetica', 'bold'); d.setFontSize(10.5);
    d.text('CREDENCIAL CONTADOR', 48, 7.2, { align: 'center' });
    d.setTextColor(0); d.setFontSize(8);
    d.text('TELÉFONO', 97, 7.2, { align: 'right' });
    d.setLineWidth(0.35); d.line(3, 11, 97, 11);

    // Columna izquierda: datos de acceso
    const nombreTxt = String(cred.nombre || '').toUpperCase();
    d.setFont('helvetica', 'bold'); d.setFontSize(11);
    const nomL = d.splitTextToSize(nombreTxt || 'CONTADOR INVENTARIO', 62).slice(0, 2);
    d.text(nomL, 3, 17);
    let y = 17 + nomL.length * 4.5 + 2;
    d.setFont('helvetica', 'normal'); d.setFontSize(7.5); d.text('Usuario / Correo:', 3, y);
    d.setFont('helvetica', 'bold'); d.setFontSize(9); d.text(String(cred.email || ''), 3, y + 4.2);
    y += 10.5;
    d.setFont('helvetica', 'normal'); d.setFontSize(7.5); d.text('Clave de acceso:', 3, y);
    d.setFont('helvetica', 'bold'); d.setFontSize(12);
    d.text(cred.password ? String(cred.password) : '(Clave ya asignada)', 3, y + 5);
    d.setFont('helvetica', 'normal'); d.setFontSize(6.8);
    d.text('Escanea el QR con la cámara del teléfono', 3, 52.5);
    d.text('para abrir Conteo SAR e iniciar sesión.', 3, 56.2);

    // Columna derecha: QR a solicitar.html?modo=contar
    if (window.qrcode) {
      const q = window.qrcode(0, 'M'); q.addData(URL_CONTEO); q.make();
      const n = q.getModuleCount(), cel = Math.max(2, Math.floor(26 / n / PUNTO)) * PUNTO, lado = n * cel;
      const x0 = g(97 - lado), y0 = g(14);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d.rect(x0 + c * cel, y0 + r * cel, cel + 0.02, cel + 0.02, 'F');
      d.setFont('helvetica', 'bold'); d.setFontSize(7);
      d.text('ACCESO CONTEO SAR', x0 + lado / 2, y0 + lado + 3.8, { align: 'center' });
    }
    const blob = d.output('blob'); if (opc && opc.soloBlob) return blob;
    const url = URL.createObjectURL(blob), w = window.open(url, '_blank');
    if (!w) d.save(`credencial-contador-${String(cred.email || 'usuario').split('@')[0]}.pdf`);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return { bytes: blob.size };
  }

  async function pdf(lista, opc) {
    const J = window.jspdf && window.jspdf.jsPDF, B = window.SAR_Bultos, P = window.SAR_Precintos; if (!J) throw new Error('La librería de PDF aún no carga; intenta de nuevo en unos segundos.');
    if (B && B.cargarQR) await B.cargarQR(); const lg = await cargarLogo(), d = new J({ orientation: 'landscape', unit: 'mm', format: [100, 60] });
    /* misma geometría que la etiqueta BUL: punto de 203 dpi, módulo entero de 5 puntos y zona libre de 10 módulos */
    const PUNTO = 25.4 / 203, MOD = 5 * PUNTO, g = (v) => Math.round(v / PUNTO) * PUNTO;
    const caja = (x, y) => { d.setLineWidth(0.3); d.rect(x, y - 2.5, 2.8, 2.8); };
    const linea = (x1, x2, y) => { d.setLineWidth(0.2); d.line(x1, y + 0.6, x2, y + 0.6); };
    lista.forEach((t, k) => {
      if (k) d.addPage([100, 60], 'landscape'); d.setTextColor(0); d.setDrawColor(0); d.setFillColor(0);
      /* 0–11 mm: logo, franja invertida «CONTADO» y N° grande */
      if (lg) d.addImage(lg.d, 'JPEG', 3, 2, 17, 17 / lg.r, 'logo', 'FAST');
      d.rect(22, 1.6, 34, 8, 'F'); d.setTextColor(255); d.setFont('helvetica', 'bold'); d.setFontSize(15); d.text('CONTADO', 39, 7.6, { align: 'center' }); d.setTextColor(0);
      d.setFontSize(19); d.text(`N° ${numero(t.folio)}`, 97, 8.6, { align: 'right' });
      d.setLineWidth(0.35); d.line(3, 11, 97, 11);
      /* 12–40 mm: líneas para escribir a mano */
      d.setFont('helvetica', 'normal'); d.setFontSize(8);
      d.text('Insumo', 3, 16); linea(14, 97, 16);
      d.text('Lote', 3, 21.5); linea(10, 56, 21.5); d.text('Vence', 59, 21.5); d.text('__ / ____', 70, 21.5);
      d.setFont('helvetica', 'bold'); d.setFontSize(9.5); d.text('Total', 3, 27.5); linea(13, 38, 27.5); d.text('u.', 39, 27.5);
      d.setFont('helvetica', 'normal'); d.setFontSize(8); caja(50, 27.5); d.text('Sin subdivisión', 54, 27.5);
      caja(3, 33); d.text('___ cajas  ×  ___ u.', 7, 33); caja(45, 33); d.text('Granel', 49, 33); d.setFont('helvetica', 'bold'); caja(66, 33); d.text('ABIERTA', 70, 33); d.setFont('helvetica', 'normal');
      d.text('Contó', 3, 38.8); linea(13, 53, 38.8); d.text('Fecha', 56, 38.8); d.text('__ / __', 66, 38.8);
      /* 42–57 mm: Code 128 C a la izquierda, QR de 16,5 mm a la derecha y el folio legible (+ bodega asignada) */
      let cx = 38;
      if (P && P.barras) { const a = P.barras(String(t.folio).replace(/\D/g, '')), tot = a.reduce((s, w) => s + w, 0), mod = Math.min(MOD, Math.max(1, Math.floor(66 / tot / PUNTO)) * PUNTO), x0 = g(3 + 10 * mod); let xx = x0; a.forEach((w, i) => { if (i % 2 === 0) d.rect(xx, 42, w * mod, 10.5, 'F'); xx += w * mod; }); cx = (x0 + xx) / 2; }
      if (B && B.matrizQR && window.qrcode) {
        const q = window.qrcode(0, 'M'); q.addData(urlTag(t.folio)); q.make(); const n = q.getModuleCount(), cel = 4 * PUNTO, lado = n * cel, x0 = g(97 - lado), y0 = g(41);   /* módulo entero: lado = m.length*4*PUNTO (33 módulos = 16,5 mm) */
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d.rect(x0 + c * cel, y0 + r * cel, cel + 0.02, cel + 0.02, 'F');
      }
      d.setFont('helvetica', 'bold'); d.setFontSize(8);
      d.text(t.bodega ? `${t.folio} · ${String(t.bodega).slice(0, 26)}` : t.folio, cx, 56.8, { align: 'center' });
    });
    const blob = d.output('blob'); if (opc && opc.soloBlob) return blob;
    const url = URL.createObjectURL(blob), w = window.open(url, '_blank'); if (!w) d.save(`tags-${lista[0].folio}${lista.length > 1 ? '_a_' + lista[lista.length - 1].folio : ''}.pdf`); setTimeout(() => URL.revokeObjectURL(url), 120000);
    return { paginas: lista.length, bytes: blob.size };
  }
  async function imprimir(lista) {
    const r = await pdf(lista), ahora = new Date().toISOString(), f = fs();
    await Promise.all(lista.map(t => Promise.race([f.setDoc(refTag(t.folio), { impresiones: num(t.impresiones) + 1, ultimaImpresion: ahora, ...(t.primeraImpresion ? {} : { primeraImpresion: ahora }), actualizado: ahora }, { merge: true }), new Promise(x => setTimeout(x, 2500))]).catch(() => null)));
    return r;
  }

  // ---------------- modal de vista previa / detalle de etiquetas de caja ----------------
  function abrirModal(titulo, html) {
    document.querySelectorAll('.tg-ov').forEach(x => x.remove());
    const ov = document.createElement('div'); ov.className = 'bu-ov tg-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="bu-c"><div class="bu-cab"><h3>${esc(titulo)}</h3><button type="button" class="fp-x bu-x" aria-label="Cerrar">×</button></div><div class="bu-b">${html}</div></div>`;
    const cerrar = () => { ov.remove(); document.removeEventListener('keydown', tecla, true); };
    const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.bu-x')) cerrar(); });
    document.addEventListener('keydown', tecla, true);
    document.body.appendChild(ov);
    ov.cerrar = cerrar;
    return ov;
  }

  function modalGenerarEtiquetas(x, root) {
    const c = x.conteo; if (!c) return;
    const planFull = planEtiquetasConteo(c);
    const elabTxt = fechaElabCL(c.elaboracion);
    const ov = abrirModal(`Etiquetas de caja · Tag N° ${numero(c.folio)}`, `
      <div class="bu-card">
        <div class="bu-n">${esc(c.nombre)}</div>
        <p class="act-hint" style="margin:4px 0 0;">Bodega: <b>${esc(c.bodega)}</b> · Lote: <b>${esc(c.lote)}</b>${elabTxt ? ` · Elab.: <b>${esc(elabTxt)}</b>` : ''} · Vence: <b>${esc(mesCL(c.vence))}</b></p>
        <p class="bu-q">Total contado: <b>${ent(c.total)} u.</b> · ${esc(estructuraCorta(c.estructura))}</p>
      </div>
      ${planFull.subdividida ? `<label class="bu-chk"><input type="checkbox" id="tg-inc-int" checked> Imprimir también las <b>${planFull.etiquetasInteriores} etiqueta${planFull.etiquetasInteriores === 1 ? '' : 's'} de cajas interiores</b> (subdivisión)</label>` : ''}
      <div class="bu-prev" id="tg-plan-prev"></div>
      <ul class="tg-det-list" id="tg-plan-list"></ul>
      <div class="fp-facc" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary" data-tg-cerrar>Cancelar</button>
        <button type="button" class="btn btn-primary" id="tg-gen-go"><i class="ph-bold ph-printer" aria-hidden="true"></i> Generar e imprimir etiquetas</button>
      </div>`);
    const pintarPlan = () => {
      const chk = ov.querySelector('#tg-inc-int');
      const soloGrande = chk ? !chk.checked : false;
      const pl = planEtiquetasConteo(c, { soloGrande });
      ov.querySelector('#tg-plan-prev').innerHTML = `Se generarán <b>${pl.totalEtiquetas} etiqueta${pl.totalEtiquetas === 1 ? '' : 's'}</b> en total: <b>1 caja grande</b> (${pl.totalUnidades} u., conserva el correlativo <b>${esc(c.folio)}</b>)${pl.etiquetasInteriores ? ` + <b>${pl.etiquetasInteriores} cajas interiores</b> (con correlativos BUL nuevos vinculados a la caja grande)` : ''}${pl.sueltas && pl.subdividida ? ` · incluye ${pl.sueltas} u. sueltas` : ''}.`;
      const items = [`<li><span><b>Etiqueta 1 · Caja grande${pl.estadoCaja === 'ABIERTA' ? ' (ABIERTA)' : ''}</b><small>Correlativo: ${esc(c.folio)}</small></span><b>${pl.totalUnidades} u.</b></li>`];
      if (!soloGrande && pl.detalleInteriores.length) {
        pl.detalleInteriores.forEach(h => {
          items.push(`<li><span>Etiqueta ${h.n + 1} · Caja interior ${h.n}/${h.de}${h.abierta ? ' <b>(ABIERTA)</b>' : ''}<small>Dentro de ${esc(c.folio)}</small></span><b>${h.q} u.</b></li>`);
        });
      }
      ov.querySelector('#tg-plan-list').innerHTML = items.join('');
      const b = ov.querySelector('#tg-gen-go');
      b.innerHTML = `<i class="ph-bold ph-printer" aria-hidden="true"></i> Generar e imprimir (${pl.totalEtiquetas} etq.)`;
    };
    pintarPlan();
    const chk = ov.querySelector('#tg-inc-int');
    if (chk) chk.onchange = pintarPlan;
    ov.querySelector('[data-tg-cerrar]').onclick = () => ov.cerrar();
    ov.querySelector('#tg-gen-go').onclick = async (e) => {
      const b = e.currentTarget;
      const soloGrande = chk ? !chk.checked : false;
      b.disabled = true; b.textContent = 'Generando…';
      try {
        const bultos = await generarBultosParaConteo(c, { soloGrande });
        await window.SAR_Bultos.pdf(bultos, `etiquetas-${c.folio}.pdf`);
        toast('Etiquetas generadas', `${bultos.length} etiqueta${bultos.length === 1 ? '' : 's'} para ${c.nombre} (${ent(c.total)} u.).`, 'success');
        ov.cerrar();
        await cargar(root);
      } catch (er) {
        toast('No se pudo generar', esc(er.message || er), 'error');
        b.disabled = false;
        pintarPlan();
      }
    };
  }

  async function modalVerEtiquetas(x, root) {
    const c = x.conteo; if (!c) return;
    const ov = abrirModal(`Etiquetas generadas · ${c.folio}`, `<p class="act-hint">Cargando etiquetas…</p>`);
    try {
      const bultos = await leerBultosDeConteo(c);
      const grandes = bultos.filter(b => b.nivel !== 'interior'), ints = bultos.filter(b => b.nivel === 'interior');
      const elabTxt = fechaElabCL(c.elaboracion);
      ov.querySelector('.bu-b').innerHTML = `
        <div class="bu-card">
          <div class="bu-n">${esc(c.nombre)}</div>
          <p class="act-hint" style="margin:4px 0 0;">Bodega: <b>${esc(c.bodega)}</b> · Lote: <b>${esc(c.lote)}</b>${elabTxt ? ` · Elab.: <b>${esc(elabTxt)}</b>` : ''} · Vence: <b>${esc(mesCL(c.vence))}</b></p>
          <p class="bu-q"><b>${bultos.length}</b> etiqueta${bultos.length === 1 ? '' : 's'} generadas: <b>${grandes.length} grande</b>${ints.length ? ` + <b>${ints.length} interiores</b>` : ''} · Total <b>${ent(c.total)} u.</b></p>
        </div>
        <ul class="tg-det-list">${bultos.map((b, i) => `<li><span><b>${esc(b.folio)}</b> · ${b.nivel === 'interior' ? `Interior ${b.n}/${b.de}` : 'Caja grande'}${b.estado === 'ABIERTA' ? ' (ABIERTA)' : ''}<small>Impresa ${num(b.impresiones)}×</small></span><b>${ent(b.inicial != null ? b.inicial : b.contenido)} u.</b></li>`).join('')}</ul>
        <div class="fp-facc" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary" data-tg-cerrar>Cerrar</button>
          <button type="button" class="btn btn-primary" id="tg-reimp-all"><i class="ph-bold ph-printer" aria-hidden="true"></i> Reimprimir todas (${bultos.length} etq.)</button>
        </div>`;
      ov.querySelector('[data-tg-cerrar]').onclick = () => ov.cerrar();
      ov.querySelector('#tg-reimp-all').onclick = async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { await reimprimirBultosDeConteo(c); toast('Etiquetas', `Reimpresas ${bultos.length} etiquetas.`, 'success'); ov.cerrar(); await cargar(root); }
        catch (er) { toast('No se pudo', esc(er.message || er), 'error'); b.disabled = false; }
      };
    } catch (er) {
      ov.querySelector('.bu-b').innerHTML = `<p class="err-vacio">No pude leer las etiquetas (${esc(er.message || er)}).</p>`;
    }
  }

  // ---------------- pantalla ----------------
  let filas = [], fil = { bodega: '', estado: '', q: '' }, ultCred = null, contadoresLista = [], bodegasLista = [], bodSelId = '';
  function pintarBodegaSel(root) {
    const sel = root.querySelector('#tg-bod-res'); if (!sel) return;
    sel.innerHTML = `<option value="">Sin asignar (el contador elige en el teléfono)</option>${bodegasLista.map(b => `<option value="${esc(b.id)}"${bodSelId === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}`;
  }
  function tabla(root) {
    const l = filtrar(filas, fil);
    const bods = [...new Set(filas.map(x => (x.conteo && x.conteo.bodega) || (x.tag && x.tag.bodega)).filter(Boolean))].sort();
    const cnt = {}; filas.forEach(x => { cnt[x.estado] = (cnt[x.estado] || 0) + 1; });
    const kpi = contadoresEtiquetas(l);
    const pendFilas = l.filter(x => x.conteo && (x.estado === 'contado' || x.estado === 'incorporado'));
    const porAceptar = pendFilas.filter(x => x.estado === 'contado').length;
    const listasIngreso = l.filter(x => x.conteo && x.estado === 'etiquetado' && !x.conteo.lev).map(x => x.conteo);
    const gruposIng = agruparParaIngreso(listasIngreso);
    const unidIng = gruposIng.reduce((t, g) => t + g.total, 0);
    const el = root.querySelector('#tg-tabla'); if (!el) return;
    el.innerHTML = `
      <div class="tg-kpis">
        <div class="tg-kpi"><b>${kpi.cajasContadas}</b><span>Cajas contadas</span><small>${kpi.cajasSubdivididas} subdividida${kpi.cajasSubdivididas === 1 ? '' : 's'} · ${kpi.sinUsar} tag(s) sin usar</small></div>
        <div class="tg-kpi"><b>${kpi.etiquetasTotal}</b><span>Total etiquetas de cajas</span><small>${kpi.etiquetasGrandes} grande${kpi.etiquetasGrandes === 1 ? '' : 's'} + ${kpi.etiquetasInteriores} interior${kpi.etiquetasInteriores === 1 ? '' : 'es'}</small></div>
        <div class="tg-kpi ${kpi.etiquetasPendientes ? 'tg-kpi--pend' : ''}"><b>${kpi.etiquetasPendientes}</b><span>Etiquetas por procesar</span><small>${porAceptar} por aceptar · ${kpi.pendientesEtiquetar} caja${kpi.pendientesEtiquetar === 1 ? '' : 's'}</small></div>
        <div class="tg-kpi ${kpi.etiquetasGeneradas ? 'tg-kpi--ok' : ''}"><b>${kpi.etiquetasGeneradas}</b><span>Etiquetas ya generadas</span><small>en ${kpi.etiquetados} caja${kpi.etiquetados === 1 ? '' : 's'} etiquetada${kpi.etiquetados === 1 ? '' : 's'}</small></div>
        <div class="tg-kpi"><b>${kpi.unidadesTotal.toLocaleString('es-CL')} u.</b><span>Unidades contadas</span><small>en las cajas mostradas</small></div>
      </div>
      ${pendFilas.length ? `<div class="tg-bar-masivo"><span><b>${pendFilas.length} caja${pendFilas.length === 1 ? '' : 's'}</b> recibida${pendFilas.length === 1 ? '' : 's'} del teléfono (${porAceptar} por aceptar · <b>${kpi.etiquetasPendientes} etiqueta${kpi.etiquetasPendientes === 1 ? '' : 's'}</b> por procesar).</span><div class="tg-acc-col"><button type="button" class="btn btn-primary btn-sm" id="tg-imp-pend"><i class="ph-bold ph-printer" aria-hidden="true"></i> Aceptar e imprimir todas (${kpi.etiquetasPendientes} etq.)</button></div></div>` : ''}
      ${listasIngreso.length ? `<div class="tg-bar-masivo" style="background:#f0fdf4;border-color:#86efac;"><span><b>${listasIngreso.length} caja${listasIngreso.length === 1 ? '' : 's'} etiquetada${listasIngreso.length === 1 ? '' : 's'}</b> listas para ingresar al stock (<b>${gruposIng.length} producto${gruposIng.length === 1 ? '' : 's'}</b> · <b>${unidIng.toLocaleString('es-CL')} u.</b>). Suma lotes iguales y agrega lotes nuevos.</span><button type="button" class="btn btn-primary btn-sm" id="tg-ing-lev"><i class="ph-bold ph-package" aria-hidden="true"></i> Ingresar al stock (LEV)</button></div>` : ''}
      <div class="sal-barra tg-fil"><select id="tg-fb" class="form-control" aria-label="Bodega"><option value="">Todas las bodegas</option>${bods.map(b => `<option${fil.bodega === b ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>
        <select id="tg-fe" class="form-control" aria-label="Estado"><option value="">Todos los estados</option>${Object.keys(ESTADOS).map(k => `<option value="${k}"${fil.estado === k ? ' selected' : ''}>${ESTADOS[k]} (${cnt[k] || 0})</option>`).join('')}</select>
        <input id="tg-fq" class="form-control" type="search" placeholder="Buscar N° de tag o producto…" value="${esc(fil.q)}" aria-label="Buscar número o producto">
        <button type="button" class="btn btn-secondary btn-sm" id="tg-ref" title="Actualizar conteos recibidos"><i class="ph ph-arrows-clockwise" aria-hidden="true"></i> Actualizar</button></div>
      <p class="act-hint">${l.length} de ${filas.length} tags.</p>
      <div class="sal-tabla"><table class="aud-lib tg-t"><thead><tr><th>N°</th><th>Impreso</th><th>Estado</th><th>Bodega</th><th>Producto</th><th>Lote · Elab. · Vence</th><th>Total</th><th>Etiquetas / Contenido</th><th>Contó</th><th>Acciones</th></tr></thead><tbody>
      ${l.slice(0, 600).map(x => {
        const c = x.conteo, t = x.tag;
        const bodMostrar = (c && c.bodega) || (t && t.bodega) || '';
        const pl = c ? planEtiquetasConteo(c) : null;
        const elabTxt = c ? fechaElabCL(c.elaboracion) : '';
        const nGen = c && x.estado === 'etiquetado' ? (1 + (Array.isArray(c.hijos) ? c.hijos.length : 0)) : (pl ? pl.totalEtiquetas : 0);
        const celdaEtq = c
          ? `<span class="tg-etq-badge${pl.subdividida ? ' tg-etq-badge--sub' : ''}">${nGen} etq.</span><small>${esc(pl.resumenCorto)}</small>`
          : '';
        let acc = '';
        if (t && x.estado === 'sin') {
          acc = `<button type="button" class="btn btn-secondary btn-sm" data-tg-re="${esc(x.folio)}">Reimprimir tag</button>`;
        } else if (c && x.estado === 'contado') {
          acc = `<div class="tg-acc-col"><button type="button" class="btn btn-primary btn-sm" data-tg-etq="${esc(x.folio)}"><i class="ph-bold ph-printer" aria-hidden="true"></i> Aceptar y etiquetar (${pl.totalEtiquetas})</button><button type="button" class="btn btn-secondary btn-sm" data-tg-acep="${esc(x.folio)}" title="Aceptar conteo sin imprimir todavía">Aceptar</button><button type="button" class="btn btn-secondary btn-sm" data-tg-rec="${esc(x.folio)}" title="Pedir al contador que vuelva a contar esta caja">Reconteo</button><button type="button" class="btn btn-outline btn-sm" data-tg-rech="${esc(x.folio)}" title="Rechazar este conteo">✕</button></div>`;
        } else if (c && x.estado === 'incorporado') {
          acc = `<div class="tg-acc-col"><button type="button" class="btn btn-primary btn-sm" data-tg-etq="${esc(x.folio)}"><i class="ph-bold ph-printer" aria-hidden="true"></i> Imprimir etiquetas (${pl.totalEtiquetas})</button></div>`;
        } else if (c && x.estado === 'etiquetado') {
          acc = `<div class="tg-acc-col"><button type="button" class="btn btn-secondary btn-sm" data-tg-reimp="${esc(x.folio)}"><i class="ph-bold ph-printer" aria-hidden="true"></i> Reimprimir (${nGen})</button><button type="button" class="btn btn-outline btn-sm" data-tg-ver="${esc(x.folio)}">Detalle</button></div>`;
        }
        return `<tr><td><b>${esc(numero(x.folio))}</b><small>${esc(x.folio)}</small></td><td>${t && t.primeraImpresion ? esc(hora(t.primeraImpresion)) : (t ? 'Sin imprimir' : '—')}</td><td><span class="tg-est tg-est--${x.estado}">${ESTADOS[x.estado]}</span>${c && c.lev ? `<small style="color:#166534;font-weight:600;">Ingresado · ${esc(c.lev)}</small>` : ''}</td>
          <td>${esc(bodMostrar)}</td><td>${c ? `${esc(c.nombre)}${c.nuevo ? ' <small>nuevo</small>' : ''}` : ''}</td><td>${c ? `${esc(c.lote)}${elabTxt ? ' · Elab. ' + esc(elabTxt) : ''} · ${esc(mesCL(c.vence))}` : ''}</td><td>${c ? `<b>${num(c.total)}</b> u.` : ''}</td><td>${celdaEtq}</td>
          <td>${c ? `${esc(c.contadoNombre || c.contadoPor || '')}<small>${esc(hora(c.en))}</small>` : ''}</td><td>${acc}</td></tr>`;
      }).join('') || '<tr><td colspan="10" class="err-vacio">Sin tags.</td></tr>'}</tbody></table></div>`;

    el.querySelector('#tg-fb').onchange = (e) => { fil.bodega = e.target.value; tabla(root); };
    el.querySelector('#tg-fe').onchange = (e) => { fil.estado = e.target.value; tabla(root); };
    el.querySelector('#tg-ref').onclick = () => cargar(root);
    const q = el.querySelector('#tg-fq'); q.oninput = () => { fil.q = q.value; const p = q.selectionStart; tabla(root); const n = root.querySelector('#tg-fq'); if (n) { n.focus(); n.setSelectionRange(p, p); } };
    const bIng = el.querySelector('#tg-ing-lev');
    if (bIng) bIng.onclick = async () => {
      const resumenG = gruposIng.slice(0, 8).map(g => `• ${g.nombre} (${g.bodega}): +${g.total} u. en ${g.ingresos.length} lote(s)`).join('\n') + (gruposIng.length > 8 ? `\n… y ${gruposIng.length - 8} producto(s) más.` : '');
      const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({
        titulo: `¿Ingresar ${unidIng.toLocaleString('es-CL')} u. al stock?`,
        texto: `Se incorporarán ${listasIngreso.length} caja(s) etiquetada(s) en ${gruposIng.length} producto(s) (suma lotes iguales y agrega lotes nuevos) con folio LEV:\n\n${resumenG}`,
        si: 'Ingresar al stock'
      }) : true;
      if (!ok) return;
      bIng.disabled = true; bIng.textContent = 'Ingresando…';
      try {
        const res = await ingresarStockLevantamiento(listasIngreso);
        toast('Stock ingresado', `${res.lev}: +${res.unidades.toLocaleString('es-CL')} u. de ${res.productos} producto(s) (${res.cajas} cajas) sumadas al inventario.`, 'success');
        await cargar(root);
      } catch (e) {
        toast('No se pudo ingresar', esc(e.message || e), 'error');
        await cargar(root);
      }
    };
    el.querySelectorAll('[data-tg-re]').forEach(b => b.onclick = async () => { const x = filas.find(y => y.folio === b.dataset.tgRe); if (!x) return; b.disabled = true; try { await imprimir([x.tag]); toast('Tag', 'Reimpreso.', 'success'); await cargar(root); } catch (e) { toast('No se pudo', esc(e.message || e), 'error'); b.disabled = false; } });
    el.querySelectorAll('[data-tg-etq]').forEach(b => b.onclick = () => { const x = filas.find(y => y.folio === b.dataset.tgEtq); if (x) modalGenerarEtiquetas(x, root); });
    el.querySelectorAll('[data-tg-ver]').forEach(b => b.onclick = () => { const x = filas.find(y => y.folio === b.dataset.tgVer); if (x) modalVerEtiquetas(x, root); });
    el.querySelectorAll('[data-tg-acep]').forEach(b => b.onclick = async () => {
      const x = filas.find(y => y.folio === b.dataset.tgAcep); if (!x || !x.conteo) return;
      b.disabled = true;
      try { await aceptarConteo(x.conteo); toast('Conteo aceptado', `Tag N° ${numero(x.folio)} aceptado (${ent(x.conteo.total)} u.). Ya puedes imprimir sus etiquetas.`, 'success'); await cargar(root); }
      catch (e) { toast('No se pudo aceptar', esc(e.message || e), 'error'); b.disabled = false; }
    });
    el.querySelectorAll('[data-tg-rech]').forEach(b => b.onclick = async () => {
      const x = filas.find(y => y.folio === b.dataset.tgRech); if (!x || !x.conteo) return;
      const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: `¿Rechazar el conteo del tag N° ${numero(x.folio)}?`, texto: `Quedará marcado como RECHAZADO (${x.conteo.nombre} · ${ent(x.conteo.total)} u.).`, si: 'Rechazar', peligro: true }) : true;
      if (!ok) return;
      b.disabled = true;
      try { await rechazarConteo(x.conteo); toast('Conteo rechazado', `Tag N° ${numero(x.folio)} marcado como rechazado.`, 'warning'); await cargar(root); }
      catch (e) { toast('No se pudo rechazar', esc(e.message || e), 'error'); b.disabled = false; }
    });
    el.querySelectorAll('[data-tg-reimp]').forEach(b => b.onclick = async () => {
      const x = filas.find(y => y.folio === b.dataset.tgReimp); if (!x || !x.conteo) return;
      b.disabled = true;
      try { const bl = await reimprimirBultosDeConteo(x.conteo); toast('Etiquetas', `Reimpresas ${bl.length} etiqueta(s).`, 'success'); await cargar(root); }
      catch (e) { toast('No se pudo', esc(e.message || e), 'error'); b.disabled = false; }
    });
    el.querySelectorAll('[data-tg-rec]').forEach(b => b.onclick = async () => {
      const x = filas.find(y => y.folio === b.dataset.tgRec); if (!x || !x.conteo) return;
      const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: `¿Pedir reconteo del tag N° ${numero(x.folio)}?`, texto: `La caja de ${x.conteo.nombre} (${ent(x.conteo.total)} u.) aparecerá en el teléfono del contador para volver a contarla.`, si: 'Pedir reconteo' }) : true;
      if (!ok) return;
      b.disabled = true;
      try { await pedirReconteo(x.conteo); toast('Reconteo pedido', `Se notificó al teléfono para el tag N° ${numero(x.folio)}.`, 'info'); await cargar(root); }
      catch (e) { toast('No se pudo', esc(e.message || e), 'error'); b.disabled = false; }
    });
    const bMas = el.querySelector('#tg-imp-pend');
    if (bMas) bMas.onclick = async () => {
      const P = window.SAR_Progreso;
      const ok = P && P.confirmar ? await P.confirmar({
        titulo: `¿Aceptar e imprimir ${kpi.etiquetasPendientes} etiquetas?`,
        texto: `Se aceptarán ${pendFilas.length} cajas contadas (${kpi.etiquetasGrandes} grandes + ${kpi.etiquetasInteriores} interiores) y se abrirá un solo PDF 100×60 mm para imprimir.`,
        si: 'Aceptar e imprimir'
      }) : true;
      if (!ok) return;
      bMas.disabled = true; bMas.textContent = 'Generando…';
      try {
        const todosBultos = [];
        for (const x of pendFilas) {
          const bl = await generarBultosParaConteo(x.conteo);
          todosBultos.push(...bl);
        }
        if (todosBultos.length) await window.SAR_Bultos.pdf(todosBultos, `etiquetas-levantamiento-${new Date().toISOString().slice(0, 10)}.pdf`);
        toast('Etiquetas listas', `${todosBultos.length} etiqueta(s) generadas de ${pendFilas.length} caja(s).`, 'success');
        await cargar(root);
      } catch (e) {
        toast('No se pudo completar', esc(e.message || e), 'error');
        await cargar(root);
      }
    };
  }

  function pintarCredBox(root) {
    const box = root.querySelector('#tg-cred-res');
    if (box) {
      if (!ultCred) { box.innerHTML = ''; }
      else {
        box.innerHTML = `<div class="tg-cred-box">
          <b>${ultCred.yaExistia ? 'Usuario sincronizado con rol Contador' : 'Credencial de Contador creada'}</b>
          <div>Nombre: <b>${esc(ultCred.nombre)}</b> · Correo: <b>${esc(ultCred.email)}</b></div>
          <div>Clave temporal: ${ultCred.password ? `<span class="tg-cred-pass">${esc(ultCred.password)}</span>` : '<em>(La cuenta ya existía; conserva su clave actual)</em>'}</div>
          <small>Acceso teléfono: <code>${esc(URL_CONTEO)}</code></small>
          <div class="tg-cred-acc">
            <button type="button" class="btn btn-primary btn-sm" id="tg-cred-pdf"><i class="ph-bold ph-printer" aria-hidden="true"></i> Imprimir credencial (100×60)</button>
            <button type="button" class="btn btn-secondary btn-sm" id="tg-cred-cop"><i class="ph ph-copy" aria-hidden="true"></i> Copiar acceso</button>
          </div>
        </div>`;
        box.querySelector('#tg-cred-pdf').onclick = () => pdfCredencial(ultCred).catch(e => toast('PDF', esc(e.message || e), 'error'));
        box.querySelector('#tg-cred-cop').onclick = async () => {
          const txt = `Acceso Conteo SAR (Teléfono)\nNombre: ${ultCred.nombre}\nCorreo: ${ultCred.email}${ultCred.password ? '\nClave: ' + ultCred.password : ''}\nLink: ${URL_CONTEO}`;
          try { await navigator.clipboard.writeText(txt); toast('Copiado', 'Credencial copiada al portapapeles.', 'success'); }
          catch (e) { toast('Copiado', txt, 'info'); }
        };
      }
    }
    const lst = root.querySelector('#tg-cred-lista');
    if (lst) {
      lst.innerHTML = contadoresLista.length
        ? `<details class="tg-cred-list"><summary>Contadores registrados (${contadoresLista.length})</summary><ul>${contadoresLista.map((u, idx) => `<li><span><b>${esc(u.nombre || u.email || u.id)}</b> <small>${esc(u.email || u.id)}</small></span><button type="button" class="btn btn-secondary btn-sm" data-tg-cqr="${idx}"><i class="ph ph-qr-code" aria-hidden="true"></i> Tarjeta QR</button></li>`).join('')}</ul></details>`
        : '';
      lst.querySelectorAll('[data-tg-cqr]').forEach(b => b.onclick = () => {
        const u = contadoresLista[Number(b.dataset.tgCqr)];
        if (u) pdfCredencial({ nombre: u.nombre || u.email || u.id, email: u.email || u.id, password: '' }).catch(e => toast('PDF', esc(e.message || e), 'error'));
      });
    }
  }

  async function cargar(root) {
    const el = root.querySelector('#tg-tabla'); if (el && !filas.length) el.innerHTML = window.SAR_Progreso && window.SAR_Progreso.cargando ? window.SAR_Progreso.cargando('Leyendo los tags…') : 'Cargando…';
    try {
      const [r, ctrs, bods] = await Promise.all([listar(), listarContadores(), listarBodegas()]);
      filas = unir(r.tags, r.conteos);
      contadoresLista = ctrs;
      bodegasLista = bods;
      pintarBodegaSel(root);
      pintarCredBox(root);
      tabla(root);
    } catch (e) { if (el) el.innerHTML = `<p class="err-vacio">No pude leer los tags (${esc(e.code || e.message || e)}).</p>`; }
  }

  function abrir() {
    const root = document.getElementById('tags-root'); if (!root) return;
    root.innerHTML = `<div class="tg">
      <div class="tg-grid">
        <div class="act-card tg-res">
          <h3 class="act-h">1. Reservar e imprimir tags «CONTADO»</h3>
          <p class="act-hint">Cada tag imprime un correlativo BUL único y su QR. Si eliges una bodega (ej. Bodega Satélite Vestidor), el teléfono la selecciona automáticamente al escanear el tag.</p>
          <div class="tg-fila" style="margin-bottom:8px;">
            <label class="form-label" for="tg-bod-res" style="flex:1;min-width:190px;margin:0;">Bodega asociada (opcional)
              <select id="tg-bod-res" class="form-control" style="width:100%;margin-top:4px;"><option value="">Cargando bodegas…</option></select>
            </label>
            <button type="button" class="btn btn-secondary btn-sm" id="tg-bod-new" style="align-self:flex-end;height:38px;">+ Nueva bodega</button>
          </div>
          <div class="tg-fila"><label class="form-label" for="tg-n">Cantidad de tags</label><input id="tg-n" class="form-control" type="number" min="1" max="200" value="20" inputmode="numeric"><button type="button" class="btn btn-primary" id="tg-go"><i class="ph-bold ph-printer" aria-hidden="true"></i> Reservar e imprimir</button></div>
          <p class="act-hint">PDF de 100 × 60 mm, un tag por página, para la Zebra ZD230 (imprimir a tamaño real).</p>
        </div>
        <div class="act-card tg-cred">
          <h3 class="act-h">2. Credencial de contador (teléfono)</h3>
          <p class="act-hint">Crea un usuario con rol <b>Contador</b> (solo lee productos/bodegas y registra cajas; nunca toca stock ni ve compras/historial) e imprime su tarjeta con QR.</p>
          <form id="tg-cred-f" class="tg-cred-form">
            <label class="form-label">Nombre completo<input id="tg-cn" class="form-control" placeholder="Ej. María González" required></label>
            <label class="form-label">Usuario (@cormumel.cl)<input id="tg-cu" class="form-control" placeholder="ej. conteo1" required></label>
            <button type="submit" class="btn btn-primary" id="tg-cred-go" style="grid-column:1/-1;"><i class="ph-bold ph-identification-card" aria-hidden="true"></i> Crear credencial de contador</button>
          </form>
          <div id="tg-cred-res"></div>
          <div id="tg-cred-lista"></div>
        </div>
      </div>
      <h3 class="act-h" style="margin-top:18px;">3. Conteos recibidos del teléfono · Aceptar y generar etiquetas de cajas</h3>
      <div id="tg-tabla"></div>
    </div>`;

    root.querySelector('#tg-bod-res').onchange = (e) => { bodSelId = e.target.value; };
    root.querySelector('#tg-bod-new').onclick = async () => {
      const nom = window.prompt('Nombre de la nueva bodega (ej. Bodega Satélite Vestidor):', 'Bodega Satélite Vestidor');
      if (!nom || !nom.trim()) return;
      try {
        const nb = await crearBodegaRapida(nom);
        bodegasLista = await listarBodegas();
        bodSelId = nb.id;
        pintarBodegaSel(root);
        toast('Bodega creada', `«${nb.name}» quedó creada y seleccionada para tus próximos tags.`, 'success');
      } catch (er) { toast('No se pudo crear', esc(er.message || er), 'error'); }
    };

    root.querySelector('#tg-go').onclick = async (e) => {
      const n = Math.floor(num(root.querySelector('#tg-n').value)), b = e.currentTarget; if (n < 1 || n > 200) { toast('Tags', 'Indica entre 1 y 200.', 'warning'); return; }
      const bod = bodegasLista.find(x => x.id === bodSelId) || null;
      const P = window.SAR_Progreso, ok = P && P.confirmar ? await P.confirmar({ titulo: `¿Reservar ${n} tag${n === 1 ? '' : 's'}?`, texto: `Se reservan números BUL seguidos${bod ? ' asociados a «' + bod.name + '»' : ''} y se abre el PDF para imprimir.`, si: 'Reservar e imprimir' }) : true; if (!ok) return;
      b.disabled = true; try { const l = await reservar(n, bod); await imprimir(l); toast('Tags', `${l.length} tags${bod ? ' (' + bod.name + ')' : ''}: N° ${numero(l[0].folio)} a ${numero(l[l.length - 1].folio)}.`, 'success'); await cargar(root); } catch (er) { toast('No se pudo', esc(er.message || er), 'error'); } b.disabled = false;
    };

    root.querySelector('#tg-cred-f').onsubmit = async (e) => {
      e.preventDefault();
      if (typeof window.SAR_CrearUsuario !== 'function') { toast('Error', 'Falta el módulo de usuarios (recarga la página).', 'error'); return; }
      const inpN = root.querySelector('#tg-cn'), inpU = root.querySelector('#tg-cu'), btn = root.querySelector('#tg-cred-go');
      const nombre = inpN.value.trim(), prefijo = inpU.value.trim();
      if (!nombre || !prefijo) { toast('Campos incompletos', 'Ingresa nombre y usuario.', 'warning'); return; }
      btn.disabled = true; const orig = btn.innerHTML; btn.textContent = 'Creando…';
      try {
        ultCred = await window.SAR_CrearUsuario({ nombre, prefijo, rol: 'contador' });
        inpN.value = ''; inpU.value = '';
        contadoresLista = await listarContadores();
        pintarCredBox(root);
        toast('Credencial lista', ultCred.yaExistia ? `Rol contador asignado a ${ultCred.email}.` : `Cuenta ${ultCred.email} creada. Ya puedes imprimir o copiar su credencial.`, 'success');
      } catch (er) {
        toast('No se pudo crear', esc(er.message || er), 'error');
      } finally {
        btn.disabled = false; btn.innerHTML = orig;
      }
    };

    pintarCredBox(root);
    cargar(root);
  }

  const api = { urlTag, URL_CONTEO, abrir, reservar, listar, listarBodegas, crearBodegaRapida, pdf, pdfCredencial, imprimir, unir, filtrar, estadoDe, estructuraCorta, planEtiquetasConteo, contadoresEtiquetas, agruparParaIngreso, mezclarLotesIngreso, armarBultosDeConteo, generarBultosParaConteo, leerBultosDeConteo, reimprimirBultosDeConteo, aceptarConteo, rechazarConteo, pedirReconteo, ingresarStockLevantamiento, numero, ESTADOS };
  window.SAR_TagsConteo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
