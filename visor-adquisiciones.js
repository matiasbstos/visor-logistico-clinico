/**
 * ============================================================================
 * MÓDULO ERP: ADQUISICIONES, SEGUIMIENTO Y CROSS-DOCKING (visor-adquisiciones.js)
 * ============================================================================
 * Arquitectura SPA Vanilla JS | Modelos JSON Serializables para Firebase Firestore.
 *
 * Incluye:
 * 1. Backend Schema (Clases y Esquemas):
 *    - SDC: id, fecha, creador, estado, itemsSolicitados
 *    - OC: id, sdc_id (FK), proveedor, fechaAceptacion, deadlineDespacho, items (cantidadPedida, cantidadRecepcionada)
 *    - Recepcion: id, oc_id (FK), fecha, esParcial (boolean), actaConforme
 * 2. Appflow Interactivo:
 *    - Navegación lateral dentro de #view-erp-adquisiciones
 *    - Clic en tarjeta Kanban -> Abre Panel Lateral (Drawer) con el detalle
 *      de ítems y registro en vivo de Recepciones Parciales / Totales.
 *
 * REGLA DE ORO: Módulo 100% aislado. No altera la lógica del inventario actual,
 * el enrutador SPA principal ni el módulo de Triaje Logístico.
 */

(function (window, document) {
    'use strict';

    // =========================================================================
    // 1. CONSTANTES DE ESTADOS KANBAN Y SLA
    // =========================================================================
    const ESTADOS_KANBAN = Object.freeze({
        SDC_CREADA: 'SDC_CREADA',               // Columna 1: SDC Creada
        PUBLICADA: 'PUBLICADA',                 // Columna 2: OC Publicada
        OC_ACEPTADA: 'OC_ACEPTADA',             // Columna intermedia (vista 5 cols)
        EN_DESPACHO: 'EN_DESPACHO',             // Columna 3: En Despacho (SLA)
        RECEPCIONADA: 'RECEPCIONADA'            // Columna 4: Recepcionada
    });

    const SLA_LIMITS_HOURS = Object.freeze({
        OC_ACEPTADA: 48,
        EN_DESPACHO: 120
    });

    // =========================================================================
    // 2. BACKEND SCHEMA — CLASES SERIALIZABLES A JSON PARA FIREBASE FIRESTORE
    // =========================================================================

    /**
     * @class SDC (Solicitud de Compra)
     * Representa el requerimiento inicial originado por un centro o unidad clínica.
     * Colección destino en Firestore: `ERP_SDC`
     */
    class SDC {
        /**
         * @param {Object} params
         * @param {string} params.id - Identificador único de la SDC (ej: "SDC-2026-101")
         * @param {string|Date} [params.fecha] - Fecha ISO de emisión de la solicitud
         * @param {string} [params.creador] - Analista o profesional creador de la solicitud
         * @param {string} [params.estado] - Estado en el flujo ('SDC_CREADA' | 'PUBLICADA' | 'EN_DESPACHO' | 'RECEPCIONADA')
         * @param {Array<{codigo: string, nombre: string, cantidadSolicitada: number, unidad?: string, centroDestino?: string}>} [params.itemsSolicitados]
         */
        constructor({
            id,
            fecha = new Date().toISOString(),
             fechaCreacion = null,
            creador = 'Sin Asignar',
            analistaAsignado = null,
            estado = ESTADOS_KANBAN.SDC_CREADA,
            itemsSolicitados = [],
            productosSolicitados = null
        } = {}) {
            if (!id) throw new Error('[SDC Schema] El campo "id" es obligatorio.');

            const rawFecha = fechaCreacion || fecha;
            const rawCreador = analistaAsignado || creador;
            const rawItems = Array.isArray(productosSolicitados) ? productosSolicitados : itemsSolicitados;

            this.id = String(id).trim();
            this.fecha = rawFecha instanceof Date ? rawFecha.toISOString() : String(rawFecha);
            this.creador = String(rawCreador).trim();
            this.estado = String(estado).trim();
            this.itemsSolicitados = Array.isArray(rawItems)
                ? rawItems.map(item => ({
                    codigo: String(item.codigo || 'S/C').trim(),
                    nombre: String(item.nombre || 'INSUMO SIN NOMBRE').trim().toUpperCase(),
                    cantidadSolicitada: Math.max(0, Number(item.cantidadSolicitada || item.cantidadPedida) || 0),
                    unidad: String(item.unidad || 'UN').trim().toUpperCase(),
                    centroDestino: String(item.centroDestino || 'Bodega Central SAR').trim()
                }))
                : [];

            // Propiedades espejo para compatibilidad con vistas de Fase 1
            this.fechaCreacion = this.fecha;
            this.analistaAsignado = this.creador;
            this.productosSolicitados = this.itemsSolicitados;
        }

        /**
         * Retorna un objeto JSON plano 100% serializable para Firebase Firestore.
         */
        toJSON() {
            return {
                id: this.id,
                fecha: this.fecha,
                creador: this.creador,
                estado: this.estado,
                itemsSolicitados: this.itemsSolicitados.map(i => ({ ...i })),
                updatedAt: new Date().toISOString()
            };
        }

        toFirestore() {
            return this.toJSON();
        }

        static fromFirestore(docSnapOrData) {
            const raw = typeof docSnapOrData?.data === 'function'
                ? { id: docSnapOrData.id, ...docSnapOrData.data() }
                : docSnapOrData;
            return new SDC(raw);
        }
    }

    /**
     * @class OC (Orden de Compra — Mercado Público / Cenabast)
     * Vinculada a una SDC mediante la clave foránea `sdc_id`.
     * Soporta múltiples ítems con control de `cantidadPedida` y `cantidadRecepcionada`
     * para gestionar recepciones parciales y despachos a red (Cross-docking).
     * Colección destino en Firestore: `ERP_OC`
     */
    class OC {
        /**
         * @param {Object} params
         * @param {string} params.id - Identificador único de la OC (ej: "OC-109190-SE26")
         * @param {string} params.sdc_id - Clave foránea (Foreign Key) hacia `SDC.id`
         * @param {string} params.proveedor - Razón social del proveedor adjudicado
         * @param {string|Date} [params.fechaAceptacion] - Timestamp ISO de aceptación en Mercado Público
         * @param {string|Date} [params.deadlineDespacho] - Timestamp ISO límite comprometido según SLA
         * @param {Array<{codigo?: string, nombre: string, cantidadPedida: number, cantidadRecepcionada?: number, centroDestino?: string}>} [params.items]
         */
        constructor({
            id,
            sdc_id = null,
            sdcId = null,
            proveedor = 'Proveedor No Especificado',
            fechaAceptacion = new Date().toISOString(),
            deadlineDespacho = null,
            fechaLimiteDespacho = null,
            items = [],
            productos = null
        } = {}) {
            const fkSdc = sdc_id || sdcId;
            if (!id) throw new Error('[OC Schema] El campo "id" es obligatorio.');
            if (!fkSdc) throw new Error('[OC Schema] El campo "sdc_id" (Foreign Key a SDC) es obligatorio.');

            this.id = String(id).trim();
            this.sdc_id = String(fkSdc).trim();
            this.proveedor = String(proveedor).trim();
            this.fechaAceptacion = fechaAceptacion instanceof Date
                ? fechaAceptacion.toISOString()
                : String(fechaAceptacion);

            const rawDeadline = deadlineDespacho || fechaLimiteDespacho;
            if (rawDeadline) {
                this.deadlineDespacho = rawDeadline instanceof Date
                    ? rawDeadline.toISOString()
                    : String(rawDeadline);
            } else {
                const base = new Date(this.fechaAceptacion);
                const fallback = isNaN(base.getTime()) ? new Date() : base;
                fallback.setHours(fallback.getHours() + SLA_LIMITS_HOURS.EN_DESPACHO);
                this.deadlineDespacho = fallback.toISOString();
            }

            const rawItems = Array.isArray(productos) ? productos : items;
            this.items = Array.isArray(rawItems)
                ? rawItems.map(item => {
                    const pedida = Math.max(0, Number(item.cantidadPedida ?? item.cantidadComprada) || 0);
                    const recepcionada = Math.max(0, Number(item.cantidadRecepcionada ?? item.cantidadRecibida) || 0);
                    return {
                        codigo: String(item.codigo || 'S/C').trim(),
                        nombre: String(item.nombre || 'INSUMO SIN NOMBRE').trim().toUpperCase(),
                        cantidadPedida: pedida,
                        cantidadRecepcionada: recepcionada,
                        // Alias de compatibilidad
                        cantidadComprada: pedida,
                        cantidadRecibida: recepcionada,
                        centroDestino: String(item.centroDestino || 'Bodega Central SAR').trim()
                    };
                })
                : [];

            // Propiedades espejo para compatibilidad
            this.sdcId = this.sdc_id;
            this.fechaLimiteDespacho = this.deadlineDespacho;
            this.productos = this.items;
        }

        /**
         * Porcentaje global recepcionado sobre el total pedido (0 a 100).
         */
        getPorcentajeRecepcion() {
            const totalPedido = this.items.reduce((acc, it) => acc + it.cantidadPedida, 0);
            if (totalPedido <= 0) return 0;
            const totalRecibido = this.items.reduce(
                (acc, it) => acc + Math.min(it.cantidadRecepcionada, it.cantidadPedida),
                0
            );
            return Math.round((totalRecibido / totalPedido) * 100);
        }

        /**
         * Retorna 'PENDIENTE', 'PARCIAL' o 'TOTAL' según el avance de recepción.
         */
        getEstadoRecepcion() {
            const pct = this.getPorcentajeRecepcion();
            if (pct === 0) return 'PENDIENTE';
            if (pct >= 100) return 'TOTAL';
            return 'PARCIAL';
        }

        /**
         * Evalúa el cumplimiento del SLA frente a `deadlineDespacho`.
         */
        evaluarSLA(estadoColumna = ESTADOS_KANBAN.EN_DESPACHO, now = new Date()) {
            if (estadoColumna === ESTADOS_KANBAN.RECEPCIONADA && this.getEstadoRecepcion() === 'TOTAL') {
                return { status: 'en-plazo', label: 'Conforme 100%', horasRestantes: 0 };
            }

            const limiteDate = new Date(this.deadlineDespacho);
            if (isNaN(limiteDate.getTime())) {
                return { status: 'en-plazo', label: 'En Plazo', horasRestantes: 24 };
            }

            const diffMs = limiteDate.getTime() - now.getTime();
            const diffHours = Math.round(diffMs / (1000 * 60 * 60));

            if (diffMs < 0) {
                const atrasoHoras = Math.abs(diffHours);
                const atrasoTexto = atrasoHoras >= 24
                    ? `SLA Atrasado (+${Math.floor(atrasoHoras / 24)}d)`
                    : `SLA Atrasado (+${atrasoHoras}h)`;
                return { status: 'vencido', label: atrasoTexto, horasRestantes: diffHours };
            }

            const restanteTexto = diffHours >= 24
                ? `En plazo (${Math.floor(diffHours / 24)}d rest.)`
                : `En plazo (${diffHours}h rest.)`;
            return { status: 'en-plazo', label: restanteTexto, horasRestantes: diffHours };
        }

        /**
         * Objeto JSON plano serializable para Firebase Firestore.
         */
        toJSON() {
            return {
                id: this.id,
                sdc_id: this.sdc_id,
                proveedor: this.proveedor,
                fechaAceptacion: this.fechaAceptacion,
                deadlineDespacho: this.deadlineDespacho,
                items: this.items.map(it => ({
                    codigo: it.codigo,
                    nombre: it.nombre,
                    cantidadPedida: it.cantidadPedida,
                    cantidadRecepcionada: it.cantidadRecepcionada,
                    centroDestino: it.centroDestino
                })),
                estadoRecepcion: this.getEstadoRecepcion(),
                porcentajeRecepcion: this.getPorcentajeRecepcion(),
                updatedAt: new Date().toISOString()
            };
        }

        toFirestore() {
            return this.toJSON();
        }

        static fromFirestore(docSnapOrData) {
            const raw = typeof docSnapOrData?.data === 'function'
                ? { id: docSnapOrData.id, ...docSnapOrData.data() }
                : docSnapOrData;
            return new OC(raw);
        }
    }

    /**
     * @class Recepcion (Acta de Recepción Logística Parcial o Total)
     * Registra cada evento de ingreso físico asociado a una Orden de Compra (`oc_id`).
     * Colección destino en Firestore: `ERP_Recepciones`
     */
    class Recepcion {
        /**
         * @param {Object} params
         * @param {string} params.id - Identificador único de la recepción (ej: "REC-2026-0081")
         * @param {string} params.oc_id - Clave foránea (Foreign Key) hacia `OC.id`
         * @param {string|Date} [params.fecha] - Fecha/hora ISO de la recepción en bodega
         * @param {boolean} [params.esParcial] - `true` si es entrega parcial, `false` si completa la OC
         * @param {boolean|string} [params.actaConforme] - Estado o folio de conformidad del acta clínica
         * @param {Array<{codigo: string, nombre: string, cantidadIngresada: number}>} [params.detalleRecibido]
         */
        constructor({
            id,
            oc_id,
            fecha = new Date().toISOString(),
            esParcial = false,
            actaConforme = true,
            detalleRecibido = []
        } = {}) {
            if (!id) throw new Error('[Recepcion Schema] El campo "id" es obligatorio.');
            if (!oc_id) throw new Error('[Recepcion Schema] El campo "oc_id" (Foreign Key a OC) es obligatorio.');

            this.id = String(id).trim();
            this.oc_id = String(oc_id).trim();
            this.fecha = fecha instanceof Date ? fecha.toISOString() : String(fecha);
            this.esParcial = Boolean(esParcial);
            this.actaConforme = actaConforme;
            this.detalleRecibido = Array.isArray(detalleRecibido) ? detalleRecibido : [];
        }

        /**
         * Objeto JSON plano serializable para Firebase Firestore.
         */
        toJSON() {
            return {
                id: this.id,
                oc_id: this.oc_id,
                fecha: this.fecha,
                esParcial: this.esParcial,
                actaConforme: this.actaConforme,
                detalleRecibido: this.detalleRecibido,
                createdAt: new Date().toISOString()
            };
        }

        toFirestore() {
            return this.toJSON();
        }

        static fromFirestore(docSnapOrData) {
            const raw = typeof docSnapOrData?.data === 'function'
                ? { id: docSnapOrData.id, ...docSnapOrData.data() }
                : docSnapOrData;
            return new Recepcion(raw);
        }
    }

    // Esquemas documentales de referencia para Firestore
    const BACKEND_SCHEMAS = Object.freeze({
        SDC: {
            collection: 'ERP_SDC',
            fields: ['id', 'fecha', 'creador', 'estado', 'itemsSolicitados']
        },
        OC: {
            collection: 'ERP_OC',
            fields: ['id', 'sdc_id', 'proveedor', 'fechaAceptacion', 'deadlineDespacho', 'items']
        },
        Recepcion: {
            collection: 'ERP_Recepciones',
            fields: ['id', 'oc_id', 'fecha', 'esParcial', 'actaConforme']
        }
    });

    // =========================================================================
    // 3. ESTADO EN MEMORIA Y DATOS SEMILLA DEL MINI-ERP
    // =========================================================================
    function inicializarDatosERP() {
        const ahora = new Date();
        const haceHoras = (h) => new Date(ahora.getTime() - h * 3600 * 1000).toISOString();
        const enHoras = (h) => new Date(ahora.getTime() + h * 3600 * 1000).toISOString();

        const sdcList = [
            new SDC({
                id: 'SDC-2026-101',
                fecha: haceHoras(5),
                creador: 'C. Rojas (Abastecimiento)',
                estado: 'SDC_CREADA',
                itemsSolicitados: [
                    { codigo: 'SAR-1002', nombre: 'PARACETAMOL 500 MG', cantidadSolicitada: 5000, unidad: 'COMP', centroDestino: 'SAR Central' },
                    { codigo: 'SAR-1088', nombre: 'METAMIZOL SÓDICO 1G/2ML', cantidadSolicitada: 1200, unidad: 'AMP', centroDestino: 'CESFAM Norte (Cross-docking)' }
                ]
            }),
            new SDC({
                id: 'SDC-2026-098',
                fecha: haceHoras(28),
                creador: 'M. Valdés (Farmacia)',
                estado: 'PUBLICADA',
                itemsSolicitados: [
                    { codigo: 'SAR-1045', nombre: 'SUERO FISIOLÓGICO 0.9% 500 ML', cantidadSolicitada: 600, unidad: 'MATRAZ', centroDestino: 'SAR Central' }
                ]
            }),
            new SDC({
                id: 'SDC-2026-085',
                fecha: haceHoras(150),
                creador: 'M. Valdés (Farmacia)',
                estado: 'EN_DESPACHO',
                itemsSolicitados: [
                    { codigo: 'SAR-5001', nombre: 'KETOROLACO 30 MG/ML AMPOLLA', cantidadSolicitada: 800, unidad: 'AMP', centroDestino: 'SAR Urgencias' },
                    { codigo: 'SAR-5008', nombre: 'ONDANSETRÓN 4 MG/2ML AMPOLLA', cantidadSolicitada: 400, unidad: 'AMP', centroDestino: 'CECOSF Sur (Cross-docking)' }
                ]
            }),
            new SDC({
                id: 'SDC-2026-079',
                fecha: haceHoras(180),
                creador: 'C. Rojas (Abastecimiento)',
                estado: 'RECEPCIONADA',
                itemsSolicitados: [
                    { codigo: 'SAR-1015', nombre: 'IBUPROFENO 400 MG', cantidadSolicitada: 4000, unidad: 'COMP', centroDestino: 'SAR Central' }
                ]
            }),
            new SDC({
                id: 'SDC-2026-072',
                fecha: haceHoras(210),
                creador: 'A. Soto (Logística)',
                estado: 'RECEPCIONADA',
                itemsSolicitados: [
                    { codigo: 'SAR-3012', nombre: 'GUANTES DE NITRILO TALLA M', cantidadSolicitada: 150, unidad: 'CAJA', centroDestino: 'Red Comunal APS' }
                ]
            })
        ];

        const ocList = [
            new OC({
                id: 'OC-109510-SE26',
                sdc_id: 'SDC-2026-098',
                proveedor: 'B. Braun Medical SpA',
                fechaAceptacion: haceHoras(12),
                deadlineDespacho: enHoras(108),
                items: [
                    { codigo: 'SAR-1045', nombre: 'SUERO FISIOLÓGICO 0.9% 500 ML', cantidadPedida: 600, cantidadRecepcionada: 0, centroDestino: 'SAR Central' }
                ]
            }),
            new OC({
                id: 'OC-109311-SE26',
                sdc_id: 'SDC-2026-085',
                proveedor: 'Lab. Sanderson / Fresenius Kabi',
                fechaAceptacion: haceHoras(145),
                deadlineDespacho: haceHoras(30), // SLA Vencido (+30h)
                items: [
                    { codigo: 'SAR-5001', nombre: 'KETOROLACO 30 MG/ML AMPOLLA', cantidadPedida: 800, cantidadRecepcionada: 0, centroDestino: 'SAR Urgencias' },
                    { codigo: 'SAR-5008', nombre: 'ONDANSETRÓN 4 MG/2ML AMPOLLA', cantidadPedida: 400, cantidadRecepcionada: 0, centroDestino: 'CECOSF Sur (Cross-docking)' }
                ]
            }),
            new OC({
                id: 'OC-109190-SE26',
                sdc_id: 'SDC-2026-079',
                proveedor: 'Laboratorio Chile / Teva',
                fechaAceptacion: haceHoras(170),
                deadlineDespacho: enHoras(20),
                items: [
                    { codigo: 'SAR-1015', nombre: 'IBUPROFENO 400 MG', cantidadPedida: 4000, cantidadRecepcionada: 2500, centroDestino: 'SAR Central' }
                ]
            }),
            new OC({
                id: 'OC-109044-SE26',
                sdc_id: 'SDC-2026-072',
                proveedor: 'Cenabast / Diprolab S.A.',
                fechaAceptacion: haceHoras(200),
                deadlineDespacho: haceHoras(80),
                items: [
                    { codigo: 'SAR-3012', nombre: 'GUANTES DE NITRILO TALLA M', cantidadPedida: 150, cantidadRecepcionada: 150, centroDestino: 'Red Comunal APS' }
                ]
            })
        ];

        const recepcionesList = [
            new Recepcion({
                id: 'REC-2026-0041',
                oc_id: 'OC-109190-SE26',
                fecha: haceHoras(18),
                esParcial: true,
                actaConforme: 'ACTA-PARCIAL-881',
                detalleRecibido: [
                    { codigo: 'SAR-1015', nombre: 'IBUPROFENO 400 MG', cantidadIngresada: 2500 }
                ]
            }),
            new Recepcion({
                id: 'REC-2026-0038',
                oc_id: 'OC-109044-SE26',
                fecha: haceHoras(85),
                esParcial: false,
                actaConforme: 'ACTA-FINAL-874',
                detalleRecibido: [
                    { codigo: 'SAR-3012', nombre: 'GUANTES DE NITRILO TALLA M', cantidadIngresada: 150 }
                ]
            })
        ];

        return { sdcList, ocList, recepcionesList };
    }

    const estadoMemoria = inicializarDatosERP();

    // =========================================================================
    // 4. APPFLOW: RENDERIZADO DEL KANBAN CORPORATIVO Y DRAWER DE RECEPCIÓN
    // =========================================================================

    function formatearFechaCorta(isoStr) {
        if (!isoStr) return 'S/F';
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return isoStr;
        return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    /**
     * Abre el Drawer Lateral (Modal de Detalle y Recepción Parcial) al hacer clic
     * en cualquier tarjeta del Tablero Kanban (#view-erp-adquisiciones o #view-adquisiciones).
     */
    function abrirDrawerDetalleKanban({ sdcId, ocId }) {
        const overlay = document.getElementById('erp-kanban-drawer-overlay');
        const bodyContainer = document.getElementById('erp-drawer-body');
        const titleEl = document.getElementById('erp-drawer-title');
        const subtitleEl = document.getElementById('erp-drawer-subtitle');
        const btnGuardarRecepcion = document.getElementById('btn-erp-guardar-recepcion');

        if (!overlay || !bodyContainer) return;

        const oc = ocId
            ? estadoMemoria.ocList.find(o => o.id === ocId)
            : estadoMemoria.ocList.find(o => o.sdc_id === sdcId);
        const sdc = sdcId
            ? estadoMemoria.sdcList.find(s => s.id === sdcId)
            : (oc ? estadoMemoria.sdcList.find(s => s.id === oc.sdc_id) : null);

        if (!sdc && !oc) return;

        if (titleEl) {
            titleEl.textContent = oc ? `${oc.id} — ${oc.proveedor}` : `${sdc.id} — Solicitud de Compra`;
        }
        if (subtitleEl) {
            subtitleEl.textContent = sdc
                ? `Origen: ${sdc.id} | Creador: ${sdc.creador} | Fecha: ${formatearFechaCorta(sdc.fecha)}`
                : '';
        }

        const itemsMostrar = oc
            ? oc.items
            : sdc.itemsSolicitados.map(it => ({
                codigo: it.codigo,
                nombre: it.nombre,
                cantidadPedida: it.cantidadSolicitada,
                cantidadRecepcionada: 0,
                centroDestino: it.centroDestino || 'SAR Central'
            }));

        const historialOC = oc
            ? estadoMemoria.recepcionesList.filter(r => r.oc_id === oc.id)
            : [];

        bodyContainer.innerHTML = `
            <div class="erp-drawer__section">
                <h4 class="erp-drawer__section-title">
                    <i class="ph-fill ph-info"></i> Resumen del Documento
                </h4>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12.5px;">
                    <div><strong>SDC Origen:</strong> ${sdc ? sdc.id : 'N/A'}</div>
                    <div><strong>Orden de Compra:</strong> ${oc ? oc.id : 'Pendiente Emisión'}</div>
                    <div><strong>Proveedor:</strong> ${oc ? oc.proveedor : 'En Licitación'}</div>
                    <div><strong>Avance Recepción:</strong> ${oc ? `${oc.getPorcentajeRecepcion()}% (${oc.getEstadoRecepcion()})` : '0%'}</div>
                </div>
            </div>

            <div class="erp-drawer__section">
                <h4 class="erp-drawer__section-title">
                    <i class="ph-fill ph-package"></i> Detalle de Productos y Recepción Parcial
                </h4>
                <table class="erp-items-table">
                    <thead>
                        <tr>
                            <th>Insumo / Destino</th>
                            <th>Pedido</th>
                            <th>Recibido</th>
                            <th>Nuevo Ingreso</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsMostrar.map((item, idx) => {
                            const pendiente = Math.max(0, item.cantidadPedida - item.cantidadRecepcionada);
                            return `
                                <tr>
                                    <td>
                                        <div style="font-weight:700; color:#0f172a;">${item.nombre}</div>
                                        <div style="font-size:11px; color:#64748b;">${item.codigo} • Destino: <strong>${item.centroDestino || 'SAR Central'}</strong></div>
                                    </td>
                                    <td style="font-weight:700;">${item.cantidadPedida.toLocaleString('es-CL')}</td>
                                    <td style="font-weight:700; color:var(--sar-blue);">${item.cantidadRecepcionada.toLocaleString('es-CL')}</td>
                                    <td>
                                        ${oc ? `
                                            <input type="number"
                                                class="erp-input-qty"
                                                data-item-index="${idx}"
                                                min="0"
                                                max="${pendiente}"
                                                value="${pendiente}"
                                                ${pendiente === 0 ? 'disabled' : ''}>
                                        ` : '<span style="font-size:11px; color:#94a3b8;">Sin OC aún</span>'}
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>

                ${oc ? `
                    <div style="margin-top: 14px; display:flex; align-items:center; justify-content:space-between; gap:12px; background:#f8fafc; padding:10px 12px; border-radius:var(--shape-card); border:1px solid #e2e8f0;">
                        <label style="font-size:12.5px; font-weight:700; color:var(--sar-blue); display:flex; align-items:center; gap:8px; cursor:pointer;">
                            <input type="checkbox" id="erp-chk-acta-conforme" checked>
                            Firmar Acta de Recepción Conforme (Bodega / Cross-Docking)
                        </label>
                    </div>
                ` : ''}
            </div>

            <div class="erp-drawer__section">
                <h4 class="erp-drawer__section-title">
                    <i class="ph-fill ph-clock-counter-clockwise"></i> Historial de Recepciones (${historialOC.length})
                </h4>
                ${historialOC.length === 0 ? `
                    <p style="font-size:12px; color:#64748b; margin:0;">No se registran recepciones previas para esta orden.</p>
                ` : historialOC.map(rec => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px dashed #e2e8f0; font-size:12px;">
                        <div>
                            <strong style="color:var(--sar-blue);">${rec.id}</strong>
                            <span style="color:#64748b; margin-left:6px;">${formatearFechaCorta(rec.fecha)}</span>
                        </div>
                        <span class="badge ${rec.esParcial ? 'badge-sar-orange' : 'badge-sar-green'}">
                            ${rec.esParcial ? 'Recepción Parcial' : 'Acta Conforme Total'}
                        </span>
                    </div>
                `).join('')}
            </div>
        `;

        if (btnGuardarRecepcion) {
            if (oc && oc.getPorcentajeRecepcion() < 100) {
                btnGuardarRecepcion.style.display = 'inline-flex';
                btnGuardarRecepcion.onclick = () => registrarRecepcionDesdeDrawer(oc, sdc);
            } else {
                btnGuardarRecepcion.style.display = 'none';
            }
        }

        overlay.classList.add('active');
    }

    /**
     * Procesa el formulario del Drawer Lateral, crea una instancia `Recepcion`,
     * actualiza `cantidadRecepcionada` en la `OC` y refresca ambos tableros Kanban.
     */
    function registrarRecepcionDesdeDrawer(oc, sdc) {
        const overlay = document.getElementById('erp-kanban-drawer-overlay');
        const inputs = overlay ? overlay.querySelectorAll('.erp-input-qty') : [];
        const chkConforme = document.getElementById('erp-chk-acta-conforme');

        const detalleRecibido = [];
        let huboIngreso = false;

        inputs.forEach(input => {
            const idx = Number(input.getAttribute('data-item-index'));
            const cantIngresada = Math.max(0, Number(input.value) || 0);
            const itemOC = oc.items[idx];
            if (itemOC && cantIngresada > 0) {
                const maxPermitido = Math.max(0, itemOC.cantidadPedida - itemOC.cantidadRecepcionada);
                const ingresoReal = Math.min(cantIngresada, maxPermitido);
                if (ingresoReal > 0) {
                    itemOC.cantidadRecepcionada += ingresoReal;
                    itemOC.cantidadRecibida = itemOC.cantidadRecepcionada;
                    detalleRecibido.push({
                        codigo: itemOC.codigo,
                        nombre: itemOC.nombre,
                        cantidadIngresada: ingresoReal
                    });
                    huboIngreso = true;
                }
            }
        });

        if (!huboIngreso) return;

        const esParcial = oc.getPorcentajeRecepcion() < 100;
        const nuevaRecepcion = new Recepcion({
            id: `REC-2026-${String(estadoMemoria.recepcionesList.length + 42).padStart(4, '0')}`,
            oc_id: oc.id,
            fecha: new Date().toISOString(),
            esParcial,
            actaConforme: chkConforme ? chkConforme.checked : true,
            detalleRecibido
        });

        estadoMemoria.recepcionesList.unshift(nuevaRecepcion);

        if (sdc) {
            sdc.estado = ESTADOS_KANBAN.RECEPCIONADA;
        }

        // Refrescar vistas Kanban y reabrir el drawer actualizado
        renderizarTableroKanban5Cols();
        sincronizarTarjetasKanbanCorporativo();
        abrirDrawerDetalleKanban({ sdcId: sdc ? sdc.id : null, ocId: oc.id });

        if (typeof window.showToast === 'function') {
            window.showToast(
                esParcial ? 'Recepción Parcial Registrada' : 'Recepción Total Conforme',
                `${nuevaRecepcion.id} vinculada a ${oc.id} (${oc.getPorcentajeRecepcion()}% recibido).`,
                'success'
            );
        }
    }

    /**
     * Vincula eventos de clic a las tarjetas del Kanban Corporativo (#view-erp-adquisiciones)
     * y su navegación lateral.
     */
    function sincronizarTarjetasKanbanCorporativo() {
        const erpSection = document.getElementById('view-erp-adquisiciones');
        if (!erpSection) return;

        const cards = erpSection.querySelectorAll('.kanban-card');
        cards.forEach(card => {
            if (card.dataset.boundClick === 'true') return;
            card.dataset.boundClick = 'true';
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => {
                const idText = card.querySelector('.kanban-card__id')?.textContent?.trim() || '';
                if (idText.startsWith('OC-')) {
                    abrirDrawerDetalleKanban({ ocId: idText });
                } else {
                    abrirDrawerDetalleKanban({ sdcId: idText });
                }
            });
        });

        // Navegación del menú lateral de #view-erp-adquisiciones
        const navBtns = erpSection.querySelectorAll('.erp-sidebar__item');
        const panels = erpSection.querySelectorAll('.erp-main-view-panel');
        navBtns.forEach(btn => {
            if (btn.dataset.boundNav === 'true') return;
            btn.dataset.boundNav = 'true';
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-erp-panel');
                navBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (panels.length > 0 && targetId) {
                    panels.forEach(p => {
                        p.style.display = p.id === targetId ? 'block' : 'none';
                    });
                }
            });
        });
    }

    // =========================================================================
    // 5. COMPATIBILIDAD CON TABLERO DE 5 COLUMNAS (#view-adquisiciones)
    // =========================================================================
    function crearCardKanban5ColsHTML(sdc, ocAsociada) {
        const ahora = new Date();
        const slaInfo = ocAsociada
            ? ocAsociada.evaluarSLA(sdc.estado, ahora)
            : { status: 'en-plazo', label: 'En Plazo' };

        const isVencido = slaInfo.status === 'vencido';
        const cardSlaClass = isVencido ? 'kanban-card--sla-vencido' : 'kanban-card--sla-ok';
        const badgeSlaClass = isVencido ? 'sla-pill--danger' : 'sla-pill--success';

        const totalItems = ocAsociada ? ocAsociada.items.length : sdc.itemsSolicitados.length;
        const primerProducto = ocAsociada
            ? (ocAsociada.items[0]?.nombre || 'Sin detalle')
            : (sdc.itemsSolicitados[0]?.nombre || 'Sin detalle');

        const recepcionPct = ocAsociada ? ocAsociada.getPorcentajeRecepcion() : 0;
        const estadoRecepcion = ocAsociada ? ocAsociada.getEstadoRecepcion() : 'PENDIENTE';

        const bloqueOC = ocAsociada ? `
            <div class="kanban-card__oc-box">
                <div class="kanban-card__oc-row">
                    <span class="kanban-card__oc-id"><i class="ph-bold ph-receipt"></i> ${ocAsociada.id}</span>
                    <span class="kanban-card__oc-status">${estadoRecepcion} (${recepcionPct}%)</span>
                </div>
                <div class="kanban-card__provider" title="${ocAsociada.proveedor}">
                    <i class="ph ph-buildings"></i> ${ocAsociada.proveedor}
                </div>
                ${sdc.estado === ESTADOS_KANBAN.RECEPCIONADA || recepcionPct > 0 ? `
                <div class="kanban-card__progress-track">
                    <div class="kanban-card__progress-bar" style="width: ${recepcionPct}%;"></div>
                </div>
                ` : ''}
            </div>
        ` : '';

        return `
            <article class="kanban-card ${cardSlaClass}" data-sdc-id="${sdc.id}" ${ocAsociada ? `data-oc-id="${ocAsociada.id}"` : ''}>
                <div class="kanban-card__top">
                    <span class="kanban-card__code">${sdc.id}</span>
                    <span class="sla-pill ${badgeSlaClass}">
                        <span class="sla-dot"></span>
                        ${slaInfo.label}
                    </span>
                </div>
                <div class="kanban-card__title" title="${primerProducto}">
                    ${primerProducto}
                    ${totalItems > 1 ? `<span class="kanban-card__more-items">+${totalItems - 1} ítem(s)</span>` : ''}
                </div>
                ${bloqueOC}
                <div class="kanban-card__footer">
                    <span class="kanban-card__meta"><i class="ph ph-user-circle"></i> ${sdc.creador}</span>
                    <span class="kanban-card__date"><i class="ph ph-calendar-blank"></i> ${formatearFechaCorta(sdc.fecha)}</span>
                </div>
            </article>
        `;
    }

    function renderizarTableroKanban5Cols() {
        const mapaColumnas = {
            [ESTADOS_KANBAN.SDC_CREADA]: document.getElementById('kanban-col-sdc-creada'),
            [ESTADOS_KANBAN.PUBLICADA]: document.getElementById('kanban-col-publicada'),
            [ESTADOS_KANBAN.OC_ACEPTADA]: document.getElementById('kanban-col-oc-aceptada'),
            [ESTADOS_KANBAN.EN_DESPACHO]: document.getElementById('kanban-col-en-despacho'),
            [ESTADOS_KANBAN.RECEPCIONADA]: document.getElementById('kanban-col-recepcionada')
        };

        const mapaContadores = {
            [ESTADOS_KANBAN.SDC_CREADA]: document.getElementById('kanban-count-sdc-creada'),
            [ESTADOS_KANBAN.PUBLICADA]: document.getElementById('kanban-count-publicada'),
            [ESTADOS_KANBAN.OC_ACEPTADA]: document.getElementById('kanban-count-oc-aceptada'),
            [ESTADOS_KANBAN.EN_DESPACHO]: document.getElementById('kanban-count-en-despacho'),
            [ESTADOS_KANBAN.RECEPCIONADA]: document.getElementById('kanban-count-recepcionada')
        };

        if (!mapaColumnas[ESTADOS_KANBAN.SDC_CREADA]) return;

        Object.values(mapaColumnas).forEach(col => { if (col) col.innerHTML = ''; });

        const conteo = {
            [ESTADOS_KANBAN.SDC_CREADA]: 0,
            [ESTADOS_KANBAN.PUBLICADA]: 0,
            [ESTADOS_KANBAN.OC_ACEPTADA]: 0,
            [ESTADOS_KANBAN.EN_DESPACHO]: 0,
            [ESTADOS_KANBAN.RECEPCIONADA]: 0
        };

        estadoMemoria.sdcList.forEach(sdc => {
            const col = mapaColumnas[sdc.estado];
            if (!col) return;
            const ocAsociada = estadoMemoria.ocList.find(oc => oc.sdc_id === sdc.id) || null;
            col.insertAdjacentHTML('beforeend', crearCardKanban5ColsHTML(sdc, ocAsociada));
            conteo[sdc.estado] = (conteo[sdc.estado] || 0) + 1;
        });

        Object.keys(mapaColumnas).forEach(k => {
            const col = mapaColumnas[k];
            const badge = mapaContadores[k];
            const total = conteo[k] || 0;
            if (badge) badge.textContent = total;
            if (col && total === 0) {
                col.innerHTML = `<div class="kanban-empty-slot"><i class="ph ph-tray"></i><span>Sin solicitudes en esta etapa</span></div>`;
            }
        });

        // Permitir clic en tarjetas de #view-adquisiciones para abrir el mismo Drawer
        document.querySelectorAll('#view-adquisiciones .kanban-card').forEach(card => {
            card.addEventListener('click', () => {
                abrirDrawerDetalleKanban({
                    sdcId: card.getAttribute('data-sdc-id'),
                    ocId: card.getAttribute('data-oc-id')
                });
            });
        });
    }

    function inicializarSubTabsAdquisiciones() {
        const viewSection = document.getElementById('view-adquisiciones');
        if (!viewSection) return;

        const tabButtons = viewSection.querySelectorAll('.adq-subtab-btn');
        const tabPanels = viewSection.querySelectorAll('.adq-subtab-panel');

        tabButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetPanelId = btn.getAttribute('data-adq-tab');
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                tabPanels.forEach(panel => {
                    panel.style.display = panel.id === targetPanelId ? 'block' : 'none';
                    panel.classList.toggle('active', panel.id === targetPanelId);
                });
            });
        });
    }

    function inicializarEventosDrawer() {
        const overlay = document.getElementById('erp-kanban-drawer-overlay');
        const btnCerrar = document.getElementById('btn-erp-cerrar-drawer');
        const btnCancelar = document.getElementById('btn-erp-cancelar-drawer');

        const cerrar = () => {
            if (overlay) overlay.classList.remove('active');
        };

        if (btnCerrar) btnCerrar.addEventListener('click', cerrar);
        if (btnCancelar) btnCancelar.addEventListener('click', cerrar);
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cerrar();
            });
        }
    }

    function initModuloAdquisiciones() {
        inicializarSubTabsAdquisiciones();
        renderizarTableroKanban5Cols();
        sincronizarTarjetasKanbanCorporativo();
        inicializarEventosDrawer();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initModuloAdquisiciones);
    } else {
        initModuloAdquisiciones();
    }

    // Exponer API Pública y Modelos serializables en window.VisorAdquisiciones
    window.VisorAdquisiciones = {
        ESTADOS_KANBAN,
        SLA_LIMITS_HOURS,
        BACKEND_SCHEMAS,
        // Clases oficiales del Backend Schema (PRD/TRD)
        SDC,
        OC,
        Recepcion,
        // Alias de retrocompatibilidad Fase 1
        ModeloSDC: SDC,
        ModeloOC: OC,
        estadoMemoria,
        abrirDrawerDetalleKanban,
        renderizarTableroKanban: renderizarTableroKanban5Cols,
        initModuloAdquisiciones
    };

})(window, document);
