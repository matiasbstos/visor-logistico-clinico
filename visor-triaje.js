/**
 * ============================================================================
 * MÓDULO: ESCÁNER INTELIGENTE DE INGRESO Y TRIAJE (visor-triaje.js)
 * ============================================================================
 * Motor de extracción OCR clínica multilínea, diccionario médico inteligente,
 * control de condición de caja (Abierta/Cerrada), reseteo de estado previo
 * y vuelco directo a formulario de Ingreso.
 */

(function (window, document) {
  'use strict';

  // --- 1. ESTADO LOCAL EN MEMORIA (Tránsito temporal de la sesión) ---
  const articulosEnTransito = [];

  // --- 2. DICCIONARIO MÉDICO CLÍNICO PARA EXTRACCIÓN DE INSUMOS ---
  // Palabras clave requeridas y complementarias para evitar capturar marcas
  // de laboratorios, distribuidores o importadores (ej: Reutter, Cranberry, etc.)
  const DICCIONARIO_MEDICO = [
    'GASA', 'BISTURI', 'GUANTES', 'MASCARILLA', 'JERINGA', 'SUERO',
    'PARACETAMOL', 'IBUPROFENO', 'AMOXICILINA', 'ALCOHOL', 'AGUJA',
    'APOSITO', 'SONDA', 'CATETER', 'ALGODON', 'TERMOMETRO', 'VENDA',
    'COMPRESA', 'JABON', 'CLORHEXIDINA', 'SUTURA', 'CANULA', 'JABON'
  ];

  // --- 3. SELECTORES DEL MODAL Y FORMULARIO DE INGRESO ---
  const DOM = {
    modal: () => document.getElementById('modal-escaner-triaje'),
    bannerTrigger: () => document.getElementById('banner-trigger-triaje'),
    btnCloseModal: () => document.getElementById('btn-cerrar-triaje-modal'),
    
    // Captura Dual y Botón Foto Etiqueta
    btnFotoEtiqueta: () => document.getElementById('btn-triaje-foto-etiqueta'),
    fileInput: () => document.getElementById('triaje-file-input'),
    btnModoManual: () => document.getElementById('btn-triaje-modo-manual'),
    processingIndicator: () => document.getElementById('triaje-processing-indicator'),

    // Inputs del Modal Escáner de Triaje
    inputInsumo: () => document.getElementById('triaje-input-insumo'),
    inputCantidad: () => document.getElementById('triaje-input-cantidad'),
    inputLote: () => document.getElementById('triaje-input-lote'),
    inputVencimiento: () => document.getElementById('triaje-input-vencimiento'),
    inputFabricacion: () => document.getElementById('triaje-input-fabricacion'),
    inputFabricante: () => document.getElementById('triaje-input-fabricante'),
    
    // Condición de Caja
    radioCerrada: () => document.getElementById('radio-caja-cerrada'),
    radioAbierta: () => document.getElementById('radio-caja-abierta'),
    lblAlertaAbierta: () => document.getElementById('triaje-alerta-caja-abierta'),
    badgeTipoConteo: () => document.getElementById('badge-triaje-tipo-conteo'),
    
    // Botones de acción
    btnAgregarTransito: () => document.getElementById('btn-triaje-agregar-transito'),
    btnCargarAIngreso: () => document.getElementById('btn-triaje-volcar-ingreso'),
    btnLimpiarModal: () => document.getElementById('btn-triaje-limpiar-modal'),
    btnVaciarTransito: () => document.getElementById('btn-triaje-vaciar-transito'),

    // Tabla de tránsito
    transitoTbody: () => document.getElementById('triaje-transito-tbody'),
    transitoCount: () => document.getElementById('triaje-transito-count'),

    // Campos del formulario nativo de Ingresos (#view-movimientos)
    ingresoInsumo: () => document.getElementById('ingreso-insumo'),
    ingresoLote: () => document.getElementById('movimiento-lote'),
    ingresoVto: () => document.getElementById('movimiento-fechaVto'),
    ingresoCantidad: () => document.getElementById('movimiento-cantidad'),
    formMovimiento: () => document.getElementById('form-movimiento')
  };

  /**
   * --- PASO 1: LIMPIEZA DE ESTADO (RESET) ---
   * Vacía explícitamente todos los inputs del formulario antes de cada escaneo.
   */
  function resetCamposFormulario() {
    const elInsumo = DOM.inputInsumo();
    const elCantidad = DOM.inputCantidad();
    const elLote = DOM.inputLote();
    const elVencimiento = DOM.inputVencimiento();
    const elFabricacion = DOM.inputFabricacion();
    const elFabricante = DOM.inputFabricante();

    if (elInsumo) elInsumo.value = '';
    if (elCantidad) elCantidad.value = '';
    if (elLote) elLote.value = '';
    if (elVencimiento) elVencimiento.value = '';
    if (elFabricacion) elFabricacion.value = '';
    if (elFabricante) elFabricante.value = '';
  }

  /**
   * Normaliza cualquier formato de fecha a MM-YYYY.
   */
  function normalizarFechaMMYYYY(fechaRaw) {
    if (!fechaRaw) return '';
    const limpia = fechaRaw.replace(/[\/\.]/g, '-').trim();
    const partes = limpia.split('-');

    if (partes.length >= 2) {
      if (partes[0].length === 4) {
        // Formato YYYY-MM
        return `${partes[1].padStart(2, '0')}-${partes[0]}`;
      } else {
        // Formato MM-YY o MM-YYYY
        const mes = partes[0].padStart(2, '0');
        const anio = partes[1].length === 2 ? `20${partes[1]}` : partes[1];
        return `${mes}-${anio}`;
      }
    }
    return limpia;
  }

  /**
   * --- PASO 2 Y 3: MOTOR DE EXTRACCIÓN AVANZADA CON REGEX MULTILÍNEA Y DICCIONARIO ---
   * Tolera saltos de línea (\n), extrae Lote, Fechas, Cantidades y discrimina Insumos.
   * @param {string} rawText Texto sin formato devuelto por el OCR.
   * @returns {Object} Objeto estructurado con datos normalizados.
   */
  function extraerDatosEtiqueta(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { insumo: null, cantidad: null, lote: null, vencimiento: null, fabricacion: null, fabricante: null };
    }

    const texto = rawText.replace(/\r\n/g, '\n').trim();
    const datos = {
      insumo: null,
      cantidad: null,
      lote: null,
      vencimiento: null,
      fabricacion: null,
      fabricante: null
    };

    // -------------------------------------------------------------
    // 2.A. LOTE (REGEX MULTILÍNEA)
    // Busca: /LOTE\s*N?[°o]?\s*[\r\n]*\s*(?:LOT)?\s*([A-Z0-9]{5,20})/i
    // Tolera saltos de línea y captura el valor alfanumérico que sigue a LOTE o LOT
    // -------------------------------------------------------------
    const regexLotePrincipal = /LOTE\s*N?[°oº.]?\s*[:\-]?\s*[\r\n]*\s*(?:LOT)?\s*[:\-]?\s*([A-Z0-9\-_]{4,25})/i;
    const regexLoteSecundario = /LOT\s*[:\-]?\s*[\r\n]*\s*([A-Z0-9\-_]{4,25})/i;
    const matchLote = texto.match(regexLotePrincipal) || texto.match(regexLoteSecundario);
    if (matchLote && matchLote[1]) {
      datos.lote = matchLote[1].trim().toUpperCase();
    }

    // -------------------------------------------------------------
    // 2.B. VENCIMIENTO (REGEX MULTILÍNEA)
    // Busca: /(?:VENCE|VENCIMIENTO|EXP\.?DATE|EXP)\s*[:\-]?\s*[\r\n]*\s*([0-9]{2}[-/][0-9]{2,4})/i
    // -------------------------------------------------------------
    const regexVence = /(?:VENCE|VENCIMIENTO|EXP\.?\s*DATE|EXP)\s*[:\-]?\s*[\r\n]*\s*([0-9]{2}[-/][0-9]{2,4})/i;
    const matchVence = texto.match(regexVence);
    if (matchVence && matchVence[1]) {
      datos.vencimiento = normalizarFechaMMYYYY(matchVence[1]);
    } else {
      // Fallback para fechas invertidas año-mes (ej: 2028-05)
      const regexVenceInvertido = /(?:VENCE|VENCIMIENTO|EXP\.?\s*DATE|EXP)\s*[:\-]?\s*[\r\n]*\s*(20[0-9]{2}[-/][0-9]{2})/i;
      const matchVenceInv = texto.match(regexVenceInvertido);
      if (matchVenceInv && matchVenceInv[1]) {
        datos.vencimiento = normalizarFechaMMYYYY(matchVenceInv[1]);
      }
    }

    // -------------------------------------------------------------
    // 2.C. FABRICACIÓN (REGEX MULTILÍNEA)
    // Busca: /(?:FABRICACI[OÓ]N|MFG\.?DATE|MFG|ESTERILIZACI[OÓ]N)\s*[:\-]?\s*[\r\n]*\s*([0-9]{2}[-/][0-9]{2,4})/i
    // -------------------------------------------------------------
    const regexFab = /(?:FABRICACI[OÓ]N|MFG\.?\s*DATE|MFG|ESTERILIZACI[OÓ]N)\s*[:\-]?\s*[\r\n]*\s*([0-9]{2}[-/][0-9]{2,4})/i;
    const matchFab = texto.match(regexFab);
    if (matchFab && matchFab[1]) {
      datos.fabricacion = normalizarFechaMMYYYY(matchFab[1]);
    }

    // -------------------------------------------------------------
    // 3.A. CANTIDAD MATEMÁTICA O DIRECTA
    // Multiplicación: /(\d+)\s*[xX]\s*(\d+)/ -> ej: "50 x 50" = 2500
    // Si no: /(?:QTY|CANTIDAD|CONTENIDO)\s*[:\-]?\s*(\d+)/i
    // -------------------------------------------------------------
    const regexMultiplicador = /(\d+)\s*[xX*]\s*(\d+)/;
    const matchMultiplicador = texto.match(regexMultiplicador);

    if (matchMultiplicador) {
      const f1 = parseInt(matchMultiplicador[1], 10);
      const f2 = parseInt(matchMultiplicador[2], 10);
      datos.cantidad = (f1 * f2).toString();
    } else {
      const regexQty = /(?:QTY|CANTIDAD|CONTENIDO)\s*[:\-]?\s*[\r\n]*\s*(\d+)/i;
      const matchQty = texto.match(regexQty);
      if (matchQty && matchQty[1]) {
        datos.cantidad = matchQty[1].trim();
      }
    }

    // -------------------------------------------------------------
    // 3.B. NOMBRE DEL INSUMO (DICCIONARIO CLÍNICO INTELIGENTE)
    // Busca palabras clave médicas. Si encuentra alguna, extrae la LÍNEA COMPLETA
    // para evitar capturar laboratorios o importadores (Reutter, Cranberry, etc.)
    // -------------------------------------------------------------
    const lineas = texto.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2);

    let insumoDetectado = null;

    // 1er intento: Búsqueda estricta por diccionario clínico
    for (const linea of lineas) {
      for (const palabra of DICCIONARIO_MEDICO) {
        const regexPalabra = new RegExp(`\\b${palabra}`, 'i');
        if (regexPalabra.test(linea)) {
          insumoDetectado = linea.toUpperCase();
          break;
        }
      }
      if (insumoDetectado) break;
    }

    if (insumoDetectado) {
      datos.insumo = insumoDetectado;
    } else {
      // 2do intento: Heurística con filtro estricto anti-laboratorios y anti-importadores
      for (const linea of lineas) {
        const esLabOImportador = /(REUTTER|CRANBERRY|LABORATORIO|DISTRIBUIDORA|IMPORTADORA|IMPORTADO|FABRICADO|MANUFACTURED|RUT|DIRECCI[OÓ]N|CHILE|S\.A\.|LTDA|HECHO EN|MADE IN|PRODUCIDO)/i.test(linea);
        const esMetadato = /(LOTE|LOT|EXP|VENC|MFG|FAB|ESTERILIZACI|QTY|CANTIDAD|CONTENIDO|REF|CAT|MODELO)/i.test(linea);
        if (!esLabOImportador && !esMetadato && !datos.insumo) {
          datos.insumo = linea.toUpperCase();
          break;
        }
      }
    }

    // -------------------------------------------------------------
    // 3.C. FABRICANTE / LABORATORIO (Si existe explícitamente en el empaque)
    // -------------------------------------------------------------
    const regexFabricante = /(?:FABRICADO\s*POR|MANUFACTURED\s*BY|MFR|LABORATORIO|DISTRIBUIDO\s*POR|IMPORTADO\s*POR)[\s.:#-]+([A-Z0-9\s.,&'-]{3,35})/i;
    const matchFabr = texto.match(regexFabricante);
    if (matchFabr && matchFabr[1]) {
      datos.fabricante = matchFabr[1].split('\n')[0].trim().toUpperCase();
    } else {
      // Detectar marcas habituales si están presentes en la cabecera
      const marcaConocida = /(REUTTER|CRANBERRY|BRAUN|BECTON|NIPRO|BAXTER|MEDICORP)/i.exec(texto);
      if (marcaConocida && marcaConocida[1]) {
        datos.fabricante = marcaConocida[1].toUpperCase();
      }
    }

    return datos;
  }

  /**
   * --- 4. APLICACIÓN DE DATOS AL FORMULARIO ---
   */
  function aplicarRellenoAcumulativo(datos) {
    const elInsumo = DOM.inputInsumo();
    const elCantidad = DOM.inputCantidad();
    const elLote = DOM.inputLote();
    const elVencimiento = DOM.inputVencimiento();
    const elFab = DOM.inputFabricacion();
    const elFabricante = DOM.inputFabricante();
    const radioAbierta = DOM.radioAbierta();

    const cajaAbierta = radioAbierta ? radioAbierta.checked : false;

    // Asignación de datos extraídos
    if (elInsumo && datos.insumo) elInsumo.value = datos.insumo;
    if (elLote && datos.lote) elLote.value = datos.lote;
    if (elVencimiento && datos.vencimiento) elVencimiento.value = datos.vencimiento;
    if (elFab && datos.fabricacion) elFab.value = datos.fabricacion;
    if (elFabricante && datos.fabricante) elFabricante.value = datos.fabricante;

    // Control de Cantidad según Estado de la Caja
    if (elCantidad) {
      if (cajaAbierta) {
        elCantidad.value = '';
        elCantidad.placeholder = '¡Caja abierta! Ingrese conteo manual...';
        elCantidad.focus();
        actualizarEstadoCajaVisual(true);
        return;
      } else {
        actualizarEstadoCajaVisual(false);
        if (datos.cantidad) {
          elCantidad.value = datos.cantidad;
        }
      }
    }

    // Llevar foco al primer campo pendiente
    const secuencia = [
      elInsumo,
      elCantidad,
      elLote,
      elVencimiento,
      elFab,
      elFabricante
    ].filter(Boolean);

    const primerVacio = secuencia.find(inp => !inp.value.trim());
    if (primerVacio) primerVacio.focus();
  }

  function actualizarEstadoCajaVisual(estaAbierta) {
    const alerta = DOM.lblAlertaAbierta();
    const badge = DOM.badgeTipoConteo();
    const elCant = DOM.inputCantidad();

    if (alerta) alerta.style.display = estaAbierta ? 'block' : 'none';

    if (badge) {
      if (estaAbierta) {
        badge.textContent = 'MANUAL';
        badge.style.background = '#fef3c7';
        badge.style.color = '#b45309';
      } else {
        badge.textContent = 'AUTO';
        badge.style.background = '#e0f2fe';
        badge.style.color = '#0369a1';
      }
    }

    if (estaAbierta && elCant) {
      elCant.placeholder = 'Digite conteo físico manual...';
      elCant.focus();
    } else if (elCant) {
      elCant.placeholder = 'Ej: 500';
    }
  }

  /**
   * --- 5. APERTURA Y CIERRE DEL MODAL ---
   */
  function abrirModal() {
    const modal = DOM.modal();
    if (modal) {
      modal.style.display = 'flex';
      setTimeout(() => modal.classList.add('active'), 10);
      if (DOM.inputInsumo()) DOM.inputInsumo().focus();
    }
  }

  function cerrarModal() {
    const modal = DOM.modal();
    if (modal) {
      modal.classList.remove('active');
      setTimeout(() => { modal.style.display = 'none'; }, 200);
    }
  }

  /**
   * --- 6. AGREGAR A LISTA DE TRÁNSITO LOCAL ---
   */
  function agregarATransito() {
    const insumo = DOM.inputInsumo() ? DOM.inputInsumo().value.trim() : '';
    const cantidad = DOM.inputCantidad() ? DOM.inputCantidad().value.trim() : '';
    const lote = DOM.inputLote() ? DOM.inputLote().value.trim() : '';
    const vencimiento = DOM.inputVencimiento() ? DOM.inputVencimiento().value.trim() : '';
    const fabricacion = DOM.inputFabricacion() ? DOM.inputFabricacion().value.trim() : '';
    const fabricante = DOM.inputFabricante() ? DOM.inputFabricante().value.trim() : '';
    const estaAbierta = DOM.radioAbierta() ? DOM.radioAbierta().checked : false;

    if (!insumo || !cantidad) {
      alert('Por favor complete al menos el Insumo y la Cantidad antes de agregar a tránsito.');
      return;
    }

    const item = {
      id: `TRJ-${Date.now()}`,
      insumo,
      cantidad: Number(cantidad) || cantidad,
      lote: lote || 'S/L',
      vencimiento: vencimiento || 'S/V',
      fabricacion: fabricacion || 'N/A',
      fabricante: fabricante || 'N/A',
      cajaAbierta: estaAbierta,
      fechaCaptura: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    };

    articulosEnTransito.push(item);
    renderizarTablaTransito();
    limpiarCamposModal();
  }

  function renderizarTablaTransito() {
    const tbody = DOM.transitoTbody();
    const countEl = DOM.transitoCount();
    const btnVaciar = DOM.btnVaciarTransito();

    if (countEl) countEl.textContent = articulosEnTransito.length;
    if (btnVaciar) btnVaciar.style.display = articulosEnTransito.length > 0 ? 'inline-block' : 'none';

    if (!tbody) return;

    if (articulosEnTransito.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="padding: 16px; text-align: center; color: var(--text-muted);">
            No hay cajas en tránsito acumuladas en esta sesión.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = articulosEnTransito.map((item, idx) => `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 8px 10px; font-weight: 600;">${item.insumo}</td>
        <td style="padding: 8px 10px;"><strong>${item.cantidad}</strong></td>
        <td style="padding: 8px 10px;"><span style="font-family:monospace; background:#f1f5f9; padding:2px 6px; border-radius:4px;">${item.lote}</span></td>
        <td style="padding: 8px 10px;">${item.vencimiento}</td>
        <td style="padding: 8px 10px;">
          ${item.cajaAbierta 
            ? '<span style="color:#d97706; background:#fef3c7; padding:2px 6px; border-radius:4px; font-weight:600; font-size:11px;">Abierta</span>' 
            : '<span style="color:#16a34a; background:#dcfce7; padding:2px 6px; border-radius:4px; font-weight:600; font-size:11px;">Cerrada</span>'}
        </td>
        <td style="padding: 8px 10px; text-align: right;">
          <button type="button" class="btn-cargar-fila" data-idx="${idx}" style="background:#0284c7; color:white; border:none; border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer;" title="Cargar a formulario">
            Cargar
          </button>
          <button type="button" class="btn-eliminar-fila" data-idx="${idx}" style="background:none; color:var(--danger); border:none; padding:3px 6px; font-size:14px; cursor:pointer;" title="Quitar">
            &times;
          </button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.btn-cargar-fila').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const item = articulosEnTransito[idx];
        if (item) cargarItemDirectoAIngreso(item);
      });
    });

    tbody.querySelectorAll('.btn-eliminar-fila').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        articulosEnTransito.splice(idx, 1);
        renderizarTablaTransito();
      });
    });
  }

  /**
   * --- 7. VUELCO DIRECTO AL APARTADO DE INGRESO (#view-movimientos) ---
   */
  function volcarAIngresoActual() {
    const insumoVal = DOM.inputInsumo() ? DOM.inputInsumo().value.trim() : '';
    const loteVal = DOM.inputLote() ? DOM.inputLote().value.trim() : '';
    const vencimientoVal = DOM.inputVencimiento() ? DOM.inputVencimiento().value.trim() : '';
    const cantidadVal = DOM.inputCantidad() ? DOM.inputCantidad().value.trim() : '';

    if (!insumoVal || !cantidadVal) {
      alert('Debe especificar al menos Insumo y Cantidad para transferir al formulario de Ingreso.');
      return;
    }

    cargarValoresAIngreso(insumoVal, loteVal, vencimientoVal, cantidadVal);
    cerrarModal();
  }

  function cargarItemDirectoAIngreso(item) {
    cargarValoresAIngreso(item.insumo, item.lote, item.vencimiento, item.cantidad);
    cerrarModal();
  }

  function cargarValoresAIngreso(insumo, lote, vencimiento, cantidad) {
    if (DOM.ingresoInsumo()) DOM.ingresoInsumo().value = insumo;
    if (DOM.ingresoLote()) DOM.ingresoLote().value = (lote === 'S/L') ? '' : lote;
    if (DOM.ingresoCantidad()) DOM.ingresoCantidad().value = cantidad;

    // Formateo de fecha para el input type="date" de Ingresos (YYYY-MM-DD)
    if (DOM.ingresoVto() && vencimiento && vencimiento !== 'S/V') {
      const parts = vencimiento.split('-');
      if (parts.length === 2) {
        const mes = parseInt(parts[0], 10);
        const anio = parseInt(parts[1], 10);
        const ultimoDia = new Date(anio, mes, 0).getDate();
        DOM.ingresoVto().value = `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
      } else if (parts.length === 3) {
        DOM.ingresoVto().value = vencimiento;
      }
    }

    const form = DOM.formMovimiento();
    if (form) {
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * --- 8. LIMPIEZA DE CAMPOS ---
   */
  function limpiarCamposModal() {
    resetCamposFormulario();

    if (DOM.radioCerrada()) DOM.radioCerrada().checked = true;
    actualizarEstadoCajaVisual(false);

    if (DOM.inputInsumo()) DOM.inputInsumo().focus();
  }

  /**
   * Ejecuta reconocimiento de texto (OCR) sobre imagen base64.
   * Utiliza Tesseract en cliente (o Google Cloud Function) con fallback.
   */
  async function reconocerTextoOCR(base64Data) {
    // 1. Cargar Tesseract.js bajo demanda si no existe
    if (typeof Tesseract === 'undefined') {
      await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        script.onload = resolve;
        script.onerror = resolve;
        document.head.appendChild(script);
      });
    }

    if (typeof Tesseract !== 'undefined') {
      try {
        const worker = await Tesseract.createWorker('spa+eng');
        const ret = await worker.recognize(base64Data);
        await worker.terminate();
        if (ret && ret.data && ret.data.text && ret.data.text.trim().length > 6) {
          return ret.data.text;
        }
      } catch (ocrErr) {
        console.warn('[OCR Tesseract] Fallback a backend:', ocrErr);
      }
    }

    // 2. Intentar backend Cloud Function si está desplegada
    try {
      const resp = await fetch('https://us-central1-sarinventario.cloudfunctions.net/detectarEtiquetaClinica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Data })
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.rawText) return data.rawText;
      }
    } catch (cfErr) {
      console.warn('[Cloud Function OCR]:', cfErr);
    }

    return null;
  }

  /**
   * --- 9. PROCESAMIENTO DE ARCHIVO DE FOTO DE ETIQUETA ---
   */
  async function procesarFotoEtiqueta(file) {
    if (!file) return;

    // PASO 1 OBLIGATORIO: RESET EXPLÍCITO DE CAMPOS ANTES DE ENVIAR A OCR
    resetCamposFormulario();

    const ind = DOM.processingIndicator();
    if (ind) ind.style.display = 'block';

    const reader = new FileReader();
    reader.onload = async function (e) {
      const base64Data = e.target.result;

      try {
        const textoDetectado = await reconocerTextoOCR(base64Data);

        if (textoDetectado) {
          const datos = extraerDatosEtiqueta(textoDetectado);
          aplicarRellenoAcumulativo(datos);
        } else {
          // Si el OCR no detectó texto legible (ej: imagen borrosa),
          // los campos permanecen limpios y con foco para ingreso manual inmediato
          const elInsumo = DOM.inputInsumo();
          if (elInsumo) elInsumo.focus();
        }
      } catch (err) {
        console.error('[Triaje OCR Error]:', err);
      } finally {
        if (ind) ind.style.display = 'none';
        // Reset del input file para permitir volver a capturar la misma imagen si es necesario
        const fileInp = DOM.fileInput();
        if (fileInp) fileInp.value = '';
      }
    };
    reader.readAsDataURL(file);
  }

  /**
   * --- 10. INICIALIZACIÓN Y ENLACE DE EVENTOS SEGURO ---
   */
  function inicializarModuloTriaje() {
    // Abrir Modal desde banner de escáner
    const banner = DOM.bannerTrigger();
    if (banner && !banner.dataset.bound) {
      banner.addEventListener('click', abrirModal);
      banner.dataset.bound = 'true';
    }

    // Cerrar Modal
    const btnClose = DOM.btnCloseModal();
    if (btnClose && !btnClose.dataset.bound) {
      btnClose.addEventListener('click', cerrarModal);
      btnClose.dataset.bound = 'true';
    }

    // Modo Manual
    const btnManual = DOM.btnModoManual();
    if (btnManual && !btnManual.dataset.bound) {
      btnManual.addEventListener('click', () => {
        if (DOM.inputInsumo()) DOM.inputInsumo().focus();
      });
      btnManual.dataset.bound = 'true';
    }

    // PASO 1: Intercepción de captura al presionar botón "Foto Etiqueta"
    const btnFoto = DOM.btnFotoEtiqueta();
    if (btnFoto && !btnFoto.dataset.boundReset) {
      btnFoto.addEventListener('click', () => {
        resetCamposFormulario();
      });
      btnFoto.dataset.boundReset = 'true';
    }

    // Input de Foto
    const fileInp = DOM.fileInput();
    if (fileInp && !fileInp.dataset.bound) {
      fileInp.addEventListener('click', () => {
        resetCamposFormulario();
      });
      fileInp.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          procesarFotoEtiqueta(e.target.files[0]);
        }
      });
      fileInp.dataset.bound = 'true';
    }

    // Radios de condición de caja
    const radCerrada = DOM.radioCerrada();
    const radAbierta = DOM.radioAbierta();

    if (radCerrada && !radCerrada.dataset.bound) {
      radCerrada.addEventListener('change', () => actualizarEstadoCajaVisual(false));
      radCerrada.dataset.bound = 'true';
    }
    if (radAbierta && !radAbierta.dataset.bound) {
      radAbierta.addEventListener('change', () => actualizarEstadoCajaVisual(true));
      radAbierta.dataset.bound = 'true';
    }

    // Botones de acción
    const btnVolcar = DOM.btnCargarAIngreso();
    if (btnVolcar && !btnVolcar.dataset.bound) {
      btnVolcar.addEventListener('click', volcarAIngresoActual);
      btnVolcar.dataset.bound = 'true';
    }

    const btnTransito = DOM.btnAgregarTransito();
    if (btnTransito && !btnTransito.dataset.bound) {
      btnTransito.addEventListener('click', agregarATransito);
      btnTransito.dataset.bound = 'true';
    }

    const btnReset = DOM.btnLimpiarModal();
    if (btnReset && !btnReset.dataset.bound) {
      btnReset.addEventListener('click', limpiarCamposModal);
      btnReset.dataset.bound = 'true';
    }

    const btnVaciar = DOM.btnVaciarTransito();
    if (btnVaciar && !btnVaciar.dataset.bound) {
      btnVaciar.addEventListener('click', () => {
        if (confirm('¿Desea vaciar la lista de cajas en tránsito de esta sesión?')) {
          articulosEnTransito.length = 0;
          renderizarTablaTransito();
        }
      });
      btnVaciar.dataset.bound = 'true';
    }

    // Cerrar al hacer clic en backdrop
    const modal = DOM.modal();
    if (modal && !modal.dataset.boundBackdrop) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) cerrarModal();
      });
      modal.dataset.boundBackdrop = 'true';
    }
  }

  // Ejecución segura sin interferir con scripts existentes
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarModuloTriaje);
  } else {
    inicializarModuloTriaje();
  }

  // API pública en window para testing o llamadas programáticas
  window.TriajeIngreso = {
    abrirModal: abrirModal,
    cerrarModal: cerrarModal,
    resetCampos: resetCamposFormulario,
    extraerDatosEtiqueta: extraerDatosEtiqueta,
    procesarOCR: function (rawText) {
      resetCamposFormulario();
      const extraidos = extraerDatosEtiqueta(rawText);
      aplicarRellenoAcumulativo(extraidos);
      return extraidos;
    },
    volcarAIngreso: volcarAIngresoActual,
    agregarATransito: agregarATransito,
    limpiar: limpiarCamposModal,
    obtenerTransito: () => [...articulosEnTransito]
  };

})(window, document);
