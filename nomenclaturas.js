/* ==========================================================================
   NOMENCLATURAS Y CORRELATIVOS (v21.139) — pestaña del «Directorio».
   Lista de TODO código o correlativo que el sitio asigna: formato, ejemplo, dónde se usa, quién lo asigna,
   si reinicia cada año y el último número emitido (leído de Contadores). Solo lectura.
   Al crear un código nuevo en el sitio, agrégalo aquí (regla del proyecto).
   ========================================================================== */
(function (window, document) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fs = () => window.firebaseFirestore, db = () => window.firebaseDb;
  const pad = (n, w) => String(Math.max(0, Math.floor(Number(n) || 0))).padStart(w, '0');
  const ANIO = () => new Date().getFullYear();

  const GRUPOS = { producto: 'Productos y lotes', mov: 'Ingresos, cambios y ajustes', ent: 'Entregas y correos', compra: 'Compras y recepciones', prec: 'Precintos y etiquetas', sis: 'Sistema' };
  // contador: función que devuelve {doc, campo, formato(n)} para leer el último emitido.
  const N = [
    { g: 'producto', nombre: 'Código SAR del producto', formato: 'SAR-NNNNNN', ejemplo: 'SAR-000013', uso: 'Identifica al producto (por nombre) en todas las bodegas. Existencias, Editar insumo, búsquedas y etiquetas.', asigna: 'Automático al ingresar o editar el producto', reinicio: 'No reinicia', donde: 'Contadores/codigo-sar-contador y codigo-sar-<producto>', ultimo: { doc: () => 'codigo-sar-contador', campo: 'n', fmt: (n) => 'SAR-' + pad(n, 6) } },
    { g: 'producto', nombre: 'Código del lote', formato: 'SAR-NNNNNN-LNN', ejemplo: 'SAR-000013-L02', uso: 'Cada lote + vencimiento de un producto. Viaja con el lote entre bodegas (traspasos). Se ve en el desglose y en el Contable.', asigna: 'Automático al ingresar, editar o abrir el desglose', reinicio: 'Correlativo por producto', donde: 'Contadores/codigo-lote-<producto>; batches[].codigoLote' },
    { g: 'producto', nombre: 'ID del producto (Mercado Público)', formato: 'Número de 6–7 dígitos', ejemplo: '2228845', uso: 'Une el producto con el catálogo, la orden de compra y su foto.', asigna: 'Manual o desde la orden de compra (externo)', reinicio: 'Lo define Mercado Público', donde: 'Insumos.codigoMP; Catalogo_Productos (id del documento)' },
    { g: 'producto', nombre: 'Traspaso de stock entre bodegas', formato: 'tras_<producto>__<destino>', ejemplo: 'tras_guante-nitrilo-m__bodega-cam', uso: 'Identificador interno del registro del producto en la bodega de destino (no se muestra al usuario).', asigna: 'Automático al traspasar', reinicio: 'No aplica', donde: 'Insumos (id del documento)' },
    { g: 'mov', nombre: 'Código de ingreso', formato: 'ING-AAAA-NNNNNN', ejemplo: 'ING-2026-000045', uso: 'Seguimiento de cada ingreso (también de productos que ya existían sin OC vigente). Historial y editar ingreso.', asigna: 'Automático al ingresar', reinicio: 'Cada año; comparte el contador con CAM y AJU', donde: 'Contadores/codigo-cambio-AAAA; Historial.codigoIngreso', ultimo: { doc: () => 'codigo-cambio-' + ANIO(), campo: 'valor', fmt: (n) => 'N° ' + pad(n, 6) + ' (último entre ING, CAM y AJU)' } },
    { g: 'mov', nombre: 'Cambio con código de seguimiento', formato: 'CAM-AAAA-NNNNNN', ejemplo: 'CAM-2026-000046', uso: 'Cambio de cantidad, lote, vencimiento, bodega o ingreso con su motivo. Auditoría → Contable.', asigna: 'Automático al guardar el cambio', reinicio: 'Cada año (contador compartido)', donde: 'Historial (tipo CAMBIO_CONTROLADO)' },
    { g: 'mov', nombre: 'Ajuste / desajuste de stock', formato: 'AJU-AAAA-NNNNNN', ejemplo: 'AJU-2026-000047', uso: 'Ajustes de stock (suma o resta) con motivo. Reemplaza al antiguo ADJ.', asigna: 'Automático al ajustar', reinicio: 'Cada año (contador compartido)', donde: 'Auditoria (code) y Historial' },
    { g: 'mov', nombre: 'Código de ajuste antiguo / de respaldo', formato: 'ADJ-NNNNN', ejemplo: 'ADJ-48213', uso: 'Ajustes anteriores a v21.130 o si no se pudo generar el correlativo. No es correlativo: es aleatorio.', asigna: 'Automático (aleatorio)', reinicio: 'No aplica', donde: 'Auditoria; Solicitudes_Ajuste' },
    { g: 'mov', nombre: 'Registro de inventario / carga', formato: 'INV-AAAAMMDD-XXXX', ejemplo: 'INV-20261109-A7K2', uso: 'Identifica un registro creado por una toma de inventario o carga masiva.', asigna: 'Automático (fecha + 4 caracteres al azar)', reinicio: 'No aplica', donde: 'Historial / tomas de inventario' },
    { g: 'ent', nombre: 'Acta de entrega', formato: 'AE-AAAA-NNNN', ejemplo: 'AE-2026-0021', uso: 'Cada acta de entrega a un centro (también entregas de oxígeno). Búsqueda, seguimiento y correos.', asigna: 'Automático al emitir', reinicio: 'Cada año', donde: 'Contadores/acta-AAAA; Actas_Entrega.numero', ultimo: { doc: () => 'acta-' + ANIO(), campo: 'ultimo', fmt: (n) => 'AE-' + ANIO() + '-' + pad(n, 4) } },
    { g: 'ent', nombre: 'Distribución a centros', formato: 'DIST-AAAA-NNNN', ejemplo: 'DIST-2026-0003', uso: 'Seguimiento de cada distribución de una compra entre centros (se crea al armar la lista o importar la planilla; después se asocia a su orden de compra). Se muestra en las actas que salen de ella.', asigna: 'Automático al crear la distribución', reinicio: 'Cada año', donde: 'Contadores/dist-AAAA; Contadores/distribucion-DIST-…; Actas_Entrega.distribucion', ultimo: { doc: () => 'dist-' + ANIO(), campo: 'ultimo', fmt: (n) => 'DIST-' + ANIO() + '-' + pad(n, 4) } },
    { g: 'ent', nombre: 'Respaldo de acta firmada', formato: 'respaldo-<acta>-NNN', ejemplo: 'respaldo-AE-2026-0018-001', uso: 'Páginas/imágenes del acta firmada subidas como respaldo (uso interno).', asigna: 'Automático al subir el respaldo', reinicio: 'Por acta', donde: 'Contadores' },
    { g: 'ent', nombre: 'Aviso por correo', formato: 'aviso-<acta>-<evento>', ejemplo: 'aviso-AE-2026-0018-firmada', uso: 'Registra si el correo de cada evento del acta quedó pendiente o enviado (bitácora del acta).', asigna: 'Automático', reinicio: 'Por acta y evento', donde: 'Contadores' },
    { g: 'ent', nombre: 'Correo en cola', formato: 'cola-correo-<fecha>-<n>', ejemplo: 'cola-correo-1762729200000-4821', uso: 'Correos que esperan el horario hábil (lunes a viernes, 8:00–17:00) para salir.', asigna: 'Automático', reinicio: 'No aplica', donde: 'Contadores' },
    { g: 'compra', nombre: 'N° de orden de compra', formato: 'NNNNNNN-NNN-XXNN', ejemplo: '1298355-936-CM26', uso: 'Orden de compra de Mercado Público. Seguimiento de OC, recepciones y catálogo.', asigna: 'Externo (Mercado Público); se lee o se digita', reinicio: 'Lo define Mercado Público', donde: 'Seguimiento_OC' },
    { g: 'compra', nombre: 'Recepción de mercadería', formato: 'REC-<orden>-NN', ejemplo: 'REC-1298355-936-CM26-01', uso: 'Cada recepción de una orden de compra (parcial o total). Auditoría → Contable.', asigna: 'Automático al registrar la recepción', reinicio: 'Correlativo por orden', donde: 'Seguimiento_OC.recepciones[].recId' },
    { g: 'compra', nombre: 'Memo, SDC y CDP', formato: 'Número libre', ejemplo: 'Memo 36 · SDC 1234 · CDP 567', uso: 'Documentos del proceso de compra del municipio; se registran a mano en la orden.', asigna: 'Externo; manual', reinicio: 'Lo define el municipio', donde: 'Seguimiento_OC' },
    { g: 'prec', nombre: 'Precinto de inventario', formato: 'PI-AAAA-NNNN', ejemplo: 'PI-2026-0007', uso: 'Etiqueta física de precinto para inventarios; se escanea para registrar el conteo.', asigna: 'Automático al generar etiquetas', reinicio: 'Cada año', donde: 'Contadores/precinto-AAAA y pin-<folio>', ultimo: { doc: () => 'precinto-' + ANIO(), campo: 'ultimo', fmt: (n) => 'PI-' + ANIO() + '-' + pad(n, 4) } },
    { g: 'prec', nombre: 'Precinto de oxígeno', formato: 'PO-AAAA-NNNN', ejemplo: 'PO-2026-0003', uso: 'Etiqueta de precinto de cada balón de oxígeno.', asigna: 'Automático al generar etiquetas', reinicio: 'Cada año', donde: 'Contadores/precinto-oxi-AAAA', ultimo: { doc: () => 'precinto-oxi-' + ANIO(), campo: 'ultimo', fmt: (n) => 'PO-' + ANIO() + '-' + pad(n, 4) } },
    { g: 'sis', nombre: 'Código de error o alerta', formato: 'SAR-XXX-NNN', ejemplo: 'SAR-AUT-001', uso: 'Cada aviso del sistema muestra su «Ref.» para ubicarlo en la pestaña Errores y alertas.', asigna: 'Fijo (catálogo del sistema)', reinicio: 'No aplica', donde: 'errores.js' }
  ];

  const ultimos = {};
  async function cargarUltimos() {
    const f = fs(); if (!f || !db()) return;
    await Promise.all(N.filter((x) => x.ultimo).map(async (x) => {
      try { const s = await f.getDoc(f.doc(f.collection(db(), 'Contadores'), x.ultimo.doc())); ultimos[x.nombre] = s.exists() && s.data()[x.ultimo.campo] != null ? x.ultimo.fmt(s.data()[x.ultimo.campo]) : 'Aún sin emitir'; }
      catch (e) { ultimos[x.nombre] = ''; }
    }));
  }

  let q = '';
  function html() {
    const t = q.trim().toLowerCase();
    const vis = N.filter((x) => !t || [x.nombre, x.formato, x.ejemplo, x.uso, x.asigna, x.donde].join(' ').toLowerCase().includes(t));
    const grupos = Object.keys(GRUPOS).map((k) => ({ k, items: vis.filter((x) => x.g === k) })).filter((g) => g.items.length);
    return `<p class="act-hint">Todo código o correlativo que el sitio asigna: cómo se escribe, para qué sirve, quién lo asigna y cuál fue el último emitido. ${N.length} nomenclaturas.</p>
      <div class="sal-barra"><input id="nom-q" class="form-control" type="search" placeholder="Buscar formato, ejemplo o uso…" value="${esc(q)}" autocomplete="off" aria-label="Buscar nomenclatura"></div>
      ${grupos.map((g) => `<h3 class="act-h" style="margin-top:18px;">${esc(GRUPOS[g.k])}</h3><div class="sal-tabla"><table class="aud-lib nom-t"><thead><tr><th>Nombre</th><th>Formato</th><th>Ejemplo</th><th>Para qué sirve</th><th>Quién lo asigna</th><th>Último emitido</th></tr></thead><tbody>
        ${g.items.map((x) => `<tr><td><b>${esc(x.nombre)}</b><small>${esc(x.reinicio)}</small></td><td><code>${esc(x.formato)}</code></td><td><code>${esc(x.ejemplo)}</code></td><td>${esc(x.uso)}<small>Se guarda en: ${esc(x.donde)}</small></td><td>${esc(x.asigna)}</td><td>${x.ultimo ? esc(ultimos[x.nombre] || '…') : '—'}</td></tr>`).join('')}</tbody></table></div>`).join('') || '<p class="err-vacio">Sin resultados.</p>'}`;
  }
  function pintar(cont) {
    cont.innerHTML = html();
    const i = cont.querySelector('#nom-q'); if (i) i.addEventListener('input', () => { q = i.value; const p = i.selectionStart; pintar(cont); const n = cont.querySelector('#nom-q'); if (n) { n.focus(); n.setSelectionRange(p, p); } });
  }
  async function montar(cont) { pintar(cont); await cargarUltimos(); if (cont.isConnected) pintar(cont); }

  const api = { catalogo: N, montar, html };
  if (typeof window !== 'undefined') window.SAR_Nomenclaturas = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
