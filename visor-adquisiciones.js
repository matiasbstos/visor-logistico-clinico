/**
 * ============================================================================
 * MÓDULO ERP: ADQUISICIONES Y SEGUIMIENTO LOGÍSTICO (visor-adquisiciones.js)
 * ============================================================================
 * Fase 1: Arquitectura de Datos (Modelos SDC y OC para Firebase Firestore),
 * motor de evaluación de SLA (48h / 5d), control de sub-pestañas y
 * renderizado de tarjetas compactas en el Tablero Kanban.
 *
 * REGLA DE ORO: Módulo 100% aislado e independiente. No altera la lógica
 * de inventario actual, el enrutador SPA ni el módulo de Triaje Logístico.
 */

(function (window, document) {
    'use strict';

    // =========================================================================
    // 1. CONSTANTES DE ESTADOS KANBAN Y SLA
    // =========================================================================
    const ESTADOS_KANBAN = Object.freeze({
        SDC_CREADA: 'SDC_CREADA',               // Columna 1: SDC Creada
        PUBLICADA: 'PUBLICADA',                 // Columna 2: Publicada
        OC_ACEPTADA: 'OC_ACEPTADA',             // Columna 3: OC Aceptada (SLA 48h)
        EN_DESPACHO: 'EN_DESPACHO',             // Columna 4: En Despacho (SLA 5d)
        RECEPCIONADA: 'RECEPCIONADA'            // Columna 5: Recepcionada (Parcial/Total)
    });

    const SLA_LIMITS_HOURS = Object.freeze({
        OC_ACEPTADA: 48,        // 48 horas desde aceptación
        EN_DESPACHO: 120        // 5 días (120 horas) para despacho
    });

    // =========================================================================
    // 2. ESQUEMAS Y MODELOS DE DATOS PARA FIREBASE FIRESTORE
    // =========================================================================

    /**
     * Esquema documental de Solicitud de Compra (SDC) para colección `Adquisiciones_SDC`
     */
    const SDC_SCHEMA = Object.freeze({
        collection: 'Adquisiciones_SDC',
        fields: {
            id: 'string (PK - Ej: "SDC-2026-001")',
            fechaCreacion: 'string (ISO 8601) | Firestore Timestamp',
            analistaAsignado: 'string (Nombre o correo del analista)',
            estado: 'string (SDC_CREADA | PUBLICADA | OC_ACEPTADA | EN_DESPACHO | RECEPCIONADA)',
            productosSolicitados: 'Array<{ codigo: string, nombre: string, cantidadSolicitada: number, unidad: string }>'
        }
    });

    /**
     * Esquema documental de Orden de Compra (OC) para colección `Adquisiciones_OC`
     */
    const OC_SCHEMA = Object.freeze({
        collection: 'Adquisiciones_OC',
        fields: {
            id: 'string (PK - Ej: "OC-45000129")',
            sdcId: 'string (FK -> Adquisiciones_SDC.id)',
            proveedor: 'string (Razón social o nombre proveedor)',
            fechaAceptacion: 'string (ISO 8601) | Firestore Timestamp',
            fechaLimiteDespacho: 'string (ISO 8601) | Firestore Timestamp',
            productos: 'Array<{ codigo: string, nombre: string, cantidadComprada: number, cantidadRecibida: number }>'
        }
    });

    /**
     * Clase Modelo SDC (Solicitud de Compra)
     * Estructura base para persistencia en Firebase Firestore.
     */
    class ModeloSDC {
        /**
         * @param {Object} data
         * @param {string} data.id - Identificador único de la SDC (ej: "SDC-2026-104")
         * @param {string|Date} [data.fechaCreacion] - Fecha de creación de la solicitud
         * @param {string} data.analistaAsignado - Analista responsable del proceso
         * @param {string} [data.estado] - Estado actual en el flujo Kanban
         * @param {Array<{codigo?: string, nombre: string, cantidadSolicitada: number, unidad?: string}>} [data.productosSolicitados]
         */
        constructor({
            id,
            fechaCreacion = new Date().toISOString(),
            analistaAsignado = 'Sin Asignar',
            estado = ESTADOS_KANBAN.SDC_CREADA,
            productosSolicitados = []
        } = {}) {
            if (!id) throw new Error('[ModeloSDC] El campo "id" es obligatorio.');

            this.id = String(id).trim();
            this.fechaCreacion = fechaCreacion instanceof Date ? fechaCreacion.toISOString() : String(fechaCreacion);
            this.analistaAsignado = String(analistaAsignado).trim();
            this.estado = ESTADOS_KANBAN[estado] ? estado : ESTADOS_KANBAN.SDC_CREADA;
            this.productosSolicitados = Array.isArray(productosSolicitados)
                ? productosSolicitados.map(item => ({
                    codigo: String(item.codigo || 'S/C').trim(),
                    nombre: String(item.nombre || 'INSUMO SIN NOMBRE').trim().toUpperCase(),
                    cantidadSolicitada: Math.max(0, Number(item.cantidadSolicitada) || 0),
                    unidad: String(item.unidad || 'UN').trim().toUpperCase()
                }))
                : [];
        }

        /**
         * Serializa la instancia a un objeto plano compatible con Firestore `setDoc` / `addDoc`.
         */
        toFirestore() {
            return {
                id: this.id,
                fechaCreacion: this.fechaCreacion,
                analistaAsignado: this.analistaAsignado,
                estado: this.estado,
                productosSolicitados: this.productosSolicitados,
                updatedAt: new Date().toISOString()
            };
        }

        /**
         * Reconstruye una instancia `ModeloSDC` desde un documento de Firestore.
         */
        static fromFirestore(docSnapOrData) {
            const raw = typeof docSnapOrData?.data === 'function'
                ? { id: docSnapOrData.id, ...docSnapOrData.data() }
                : docSnapOrData;
            return new ModeloSDC(raw);
        }
    }

    /**
     * Clase Modelo OC (Orden de Compra)
     * Vinculada mediante clave foránea `sdcId` a la SDC original y preparada
     * para recepciones parciales o totales.
     */
    class ModeloOC {
        /**
         * @param {Object} data
         * @param {string} data.id - Identificador único de la OC (ej: "OC-884920")
         * @param {string} data.sdcId - Clave foránea hacia `ModeloSDC.id`
         * @param {string} data.proveedor - Nombre del laboratorio o proveedor adjudicado
         * @param {string|Date} [data.fechaAceptacion] - Fecha/hora en que se aceptó la OC
         * @param {string|Date} [data.fechaLimiteDespacho] - Fecha/hora límite comprometida para el despacho
         * @param {Array<{codigo?: string, nombre: string, cantidadComprada: number, cantidadRecibida?: number}>} [data.productos]
         */
        constructor({
            id,
            sdcId,
            proveedor = 'Proveedor No Especificado',
            fechaAceptacion = new Date().toISOString(),
            fechaLimiteDespacho = null,
            productos = []
        } = {}) {
            if (!id) throw new Error('[ModeloOC] El campo "id" es obligatorio.');
            if (!sdcId) throw new Error('[ModeloOC] El campo "sdcId" (clave foránea a SDC) es obligatorio.');

            this.id = String(id).trim();
            this.sdcId = String(sdcId).trim();
            this.proveedor = String(proveedor).trim();
            this.fechaAceptacion = fechaAceptacion instanceof Date ? fechaAceptacion.toISOString() : String(fechaAceptacion);

            // Si no se especifica fechaLimiteDespacho, se calcula por defecto +5 días (SLA 5d) desde fechaAceptacion
            if (fechaLimiteDespacho) {
                this.fechaLimiteDespacho = fechaLimiteDespacho instanceof Date
                    ? fechaLimiteDespacho.toISOString()
                    : String(fechaLimiteDespacho);
            } else {
                const baseDate = new Date(this.fechaAceptacion);
                const fallbackDate = isNaN(baseDate.getTime()) ? new Date() : baseDate;
                fallbackDate.setHours(fallbackDate.getHours() + SLA_LIMITS_HOURS.EN_DESPACHO);
                this.fechaLimiteDespacho = fallbackDate.toISOString();
            }

            this.productos = Array.isArray(productos)
                ? productos.map(prod => ({
                    codigo: String(prod.codigo || 'S/C').trim(),
                    nombre: String(prod.nombre || 'INSUMO SIN NOMBRE').trim().toUpperCase(),
                    cantidadComprada: Math.max(0, Number(prod.cantidadComprada) || 0),
                    cantidadRecibida: Math.max(0, Number(prod.cantidadRecibida) || 0)
                }))
                : [];
        }

        /**
         * Calcula el porcentaje de avance de recepción física de la OC (0 a 100%).
         */
        getPorcentajeRecepcion() {
            const totalComprado = this.productos.reduce((acc, p) => acc + p.cantidadComprada, 0);
            if (totalComprado <= 0) return 0;
            const totalRecibido = this.productos.reduce((acc, p) => acc + Math.min(p.cantidadRecibida, p.cantidadComprada), 0);
            return Math.round((totalRecibido / totalComprado) * 100);
        }

        /**
         * Determina el sub-estado de recepción ('PENDIENTE' | 'PARCIAL' | 'TOTAL').
         */
        getEstadoRecepcion() {
            const pct = this.getPorcentajeRecepcion();
            if (pct === 0) return 'PENDIENTE';
            if (pct >= 100) return 'TOTAL';
            return 'PARCIAL';
        }

        /**
         * Evalúa si el SLA está en plazo ('verde') o vencido ('rojo') respecto a la fecha actual.
         * @param {string} [estadoColumna] - Estado actual de la tarjeta en el Kanban
         * @param {Date} [now] - Fecha de referencia (default: new Date())
         * @returns {{ status: 'en-plazo' | 'vencido', label: string, horasRestantes: number }}
         */
        evaluarSLA(estadoColumna = ESTADOS_KANBAN.EN_DESPACHO, now = new Date()) {
            // Si ya fue recepcionada al 100%, se considera cumplida en plazo
            if (estadoColumna === ESTADOS_KANBAN.RECEPCIONADA && this.getEstadoRecepcion() === 'TOTAL') {
                return { status: 'en-plazo', label: 'Recepción Completa', horasRestantes: 0 };
            }

            let limiteDate;
            if (estadoColumna === ESTADOS_KANBAN.OC_ACEPTADA) {
                const aceptacion = new Date(this.fechaAceptacion);
                limiteDate = new Date(aceptacion.getTime() + SLA_LIMITS_HOURS.OC_ACEPTADA * 3600 * 1000);
            } else {
                limiteDate = new Date(this.fechaLimiteDespacho);
            }

            if (isNaN(limiteDate.getTime())) {
                return { status: 'en-plazo', label: 'En Plazo', horasRestantes: 24 };
            }

            const diffMs = limiteDate.getTime() - now.getTime();
            const diffHours = Math.round(diffMs / (1000 * 60 * 60));

            if (diffMs < 0) {
                const atrasoHoras = Math.abs(diffHours);
                const atrasoTexto = atrasoHoras >= 24
                    ? `Vencido hace ${Math.floor(atrasoHoras / 24)}d ${atrasoHoras % 24}h`
                    : `SLA Vencido (${atrasoHoras}h)`;
                return { status: 'vencido', label: atrasoTexto, horasRestantes: diffHours };
            }

            const restanteTexto = diffHours >= 24
                ? `En plazo (${Math.floor(diffHours / 24)}d ${diffHours % 24}h rest.)`
                : `En plazo (${diffHours}h rest.)`;
            return { status: 'en-plazo', label: restanteTexto, horasRestantes: diffHours };
        }

        /**
         * Serializa la instancia a un objeto plano compatible con Firestore `setDoc` / `addDoc`.
         */
        toFirestore() {
            return {
                id: this.id,
                sdcId: this.sdcId,
                proveedor: this.proveedor,
                fechaAceptacion: this.fechaAceptacion,
                fechaLimiteDespacho: this.fechaLimiteDespacho,
                productos: this.productos,
                estadoRecepcion: this.getEstadoRecepcion(),
                porcentajeRecepcion: this.getPorcentajeRecepcion(),
                updatedAt: new Date().toISOString()
            };
        }

        /**
         * Reconstruye una instancia `ModeloOC` desde un documento de Firestore.
         */
        static fromFirestore(docSnapOrData) {
            const raw = typeof docSnapOrData?.data === 'function'
                ? { id: docSnapOrData.id, ...docSnapOrData.data() }
                : docSnapOrData;
            return new ModeloOC(raw);
        }
    }

    // =========================================================================
    // 3. DATOS SEMILLA DEMOSTRATIVOS (MOCK INICIAL PARA VISUALIZACIÓN KANBAN)
    // =========================================================================
    function generarSemillaKanban() {
        const ahora = new Date();
        const haceHoras = (h) => new Date(ahora.getTime() - h * 3600 * 1000).toISOString();
        const enHoras = (h) => new Date(ahora.getTime() + h * 3600 * 1000).toISOString();

        const sdcList = [
            new ModeloSDC({
                id: 'SDC-2026-041',
                fechaCreacion: haceHoras(6),
                analistaAsignado: 'C. Rojas (Abastecimiento)',
                estado: ESTADOS_KANBAN.SDC_CREADA,
                productosSolicitados: [
                    { codigo: 'SAR-1002', nombre: 'PARACETAMOL 500 MG', cantidadSolicitada: 5000, unidad: 'COMP' },
                    { codigo: 'SAR-1045', nombre: 'SUERO FISIOLÓGICO 0.9% 500ML', cantidadSolicitada: 600, unidad: 'MATRAZ' }
                ]
            }),
            new ModeloSDC({
                id: 'SDC-2026-039',
                fechaCreacion: haceHoras(30),
                analistaAsignado: 'M. Valdés (Farmacia)',
                estado: ESTADOS_KANBAN.PUBLICADA,
                productosSolicitados: [
                    { codigo: 'SAR-2010', nombre: 'AMOXICILINA 500 MG', cantidadSolicitada: 2400, unidad: 'CAPS' }
                ]
            }),
            new ModeloSDC({
                id: 'SDC-2026-035',
                fechaCreacion: haceHoras(72),
                analistaAsignado: 'C. Rojas (Abastecimiento)',
                estado: ESTADOS_KANBAN.OC_ACEPTADA,
                productosSolicitados: [
                    { codigo: 'SAR-3012', nombre: 'GUANTES DE NITRILO TALLA M', cantidadSolicitada: 150, unidad: 'CAJA' }
                ]
            }),
            new ModeloSDC({
                id: 'SDC-2026-036',
                fechaCreacion: haceHoras(24),
                analistaAsignado: 'A. Soto (Logística)',
                estado: ESTADOS_KANBAN.OC_ACEPTADA,
                productosSolicitados: [
                    { codigo: 'SAR-4019', nombre: 'JERINGA DESCARTABLE 10 ML', cantidadSolicitada: 1200, unidad: 'UN' }
                ]
            }),
            new ModeloSDC({
                id: 'SDC-2026-028',
                fechaCreacion: haceHoras(160),
                analistaAsignado: 'M. Valdés (Farmacia)',
                estado: ESTADOS_KANBAN.EN_DESPACHO,
                productosSolicitados: [
                    { codigo: 'SAR-5001', nombre: 'KETOROLACO 30 MG/ML AMPOLLA', cantidadSolicitada: 800, unidad: 'AMP' },
                    { codigo: 'SAR-5008', nombre: 'ONDANSETRÓN 4 MG/2ML AMPOLLA', cantidadSolicitada: 400, unidad: 'AMP' }
                ]
            }),
            new ModeloSDC({
                id: 'SDC-2026-031',
                fechaCreacion: haceHoras(70),
                analistaAsignado: 'A. Soto (Logística)',
                estado: ESTADOS_KANBAN.EN_DESPACHO,
                productosSolicitados: [
                    { codigo: 'SAR-6011', nombre: 'MASCARILLA QUIRÚRGICA TRIPLE CAPA', cantidadSolicitada: 300, unidad: 'CAJA' }
                ]
            }),
            new ModeloSDC({
                id: 'SDC-2026-022',
                fechaCreacion: haceHoras(190),
                analistaAsignado: 'C. Rojas (Abastecimiento)',
                estado: ESTADOS_KANBAN.RECEPCIONADA,
                productosSolicitados: [
                    { codigo: 'SAR-1015', nombre: 'IBUPROFENO 400 MG', cantidadSolicitada: 4000, unidad: 'COMP' }
                ]
            })
        ];

        const ocList = [
            // OC con SLA Vencido en columna OC Aceptada (> 48h desde aceptación)
            new ModeloOC({
                id: 'OC-109482-SE26',
                sdcId: 'SDC-2026-035',
                proveedor: 'Cenabast / Diprolab S.A.',
                fechaAceptacion: haceHoras(58),
                fechaLimiteDespacho: enHoras(62),
                productos: [
                    { codigo: 'SAR-3012', nombre: 'GUANTES DE NITRILO TALLA M', cantidadComprada: 150, cantidadRecibida: 0 }
                ]
            }),
            // OC En Plazo en columna OC Aceptada (< 48h desde aceptación)
            new ModeloOC({
                id: 'OC-109510-SE26',
                sdcId: 'SDC-2026-036',
                proveedor: 'B. Braun Medical SpA',
                fechaAceptacion: haceHoras(14),
                fechaLimiteDespacho: enHoras(106),
                productos: [
                    { codigo: 'SAR-4019', nombre: 'JERINGA DESCARTABLE 10 ML', cantidadComprada: 1200, cantidadRecibida: 0 }
                ]
            }),
            // OC con SLA Vencido en columna En Despacho (fechaLimiteDespacho superada)
            new ModeloOC({
                id: 'OC-109311-SE26',
                sdcId: 'SDC-2026-028',
                proveedor: 'Laboratorio Sanderson / Fresenius',
                fechaAceptacion: haceHoras(150),
                fechaLimiteDespacho: haceHoras(30),
                productos: [
                    { codigo: 'SAR-5001', nombre: 'KETOROLACO 30 MG/ML AMPOLLA', cantidadComprada: 800, cantidadRecibida: 0 },
                    { codigo: 'SAR-5008', nombre: 'ONDANSETRÓN 4 MG/2ML AMPOLLA', cantidadComprada: 400, cantidadRecibida: 0 }
                ]
            }),
            // OC En Plazo en columna En Despacho
            new ModeloOC({
                id: 'OC-109405-SE26',
                sdcId: 'SDC-2026-031',
                proveedor: 'Insumos Clínicos Reutter S.A.',
                fechaAceptacion: haceHoras(48),
                fechaLimiteDespacho: enHoras(72),
                productos: [
                    { codigo: 'SAR-6011', nombre: 'MASCARILLA QUIRÚRGICA TRIPLE CAPA', cantidadComprada: 300, cantidadRecibida: 0 }
                ]
            }),
            // OC con Recepción Parcial en columna Recepcionada
            new ModeloOC({
                id: 'OC-109190-SE26',
                sdcId: 'SDC-2026-022',
                proveedor: 'Laboratorio Chile / Teva',
                fechaAceptacion: haceHoras(180),
                fechaLimiteDespacho: enHoras(24),
                productos: [
                    { codigo: 'SAR-1015', nombre: 'IBUPROFENO 400 MG', cantidadComprada: 4000, cantidadRecibida: 2500 }
                ]
            })
        ];

        return { sdcList, ocList };
    }

    // =========================================================================
    // 4. CONTROL DE INTERFAZ: SUB-PESTAÑAS Y RENDERIZADO KANBAN
    // =========================================================================

    const estadoMemoria = generarSemillaKanban();

    function formatearFechaCorta(isoStr) {
        if (!isoStr) return 'S/F';
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return isoStr;
        return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    /**
     * Construye el HTML de una tarjeta compacta para el Tablero Kanban.
     * Incluye indicador semafórico de SLA (Verde = en plazo, Rojo = vencido).
     */
    function crearCardKanbanHTML(sdc, ocAsociada) {
        const ahora = new Date();
        let slaInfo = { status: 'en-plazo', label: 'En Plazo' };

        if (ocAsociada) {
            slaInfo = ocAsociada.evaluarSLA(sdc.estado, ahora);
        } else {
            // Para SDC Creada o Publicada, evaluamos 48h desde creación como umbral operativo
            const creacion = new Date(sdc.fechaCreacion);
            const horasTranscurridas = (ahora.getTime() - creacion.getTime()) / (1000 * 3600);
            if (horasTranscurridas > 48) {
                slaInfo = { status: 'vencido', label: `Demora (${Math.round(horasTranscurridas)}h)` };
            } else {
                slaInfo = { status: 'en-plazo', label: `En Plazo (${Math.max(1, Math.round(48 - horasTranscurridas))}h rest.)` };
            }
        }

        const isVencido = slaInfo.status === 'vencido';
        const cardSlaClass = isVencido ? 'kanban-card--sla-vencido' : 'kanban-card--sla-ok';
        const badgeSlaClass = isVencido ? 'sla-pill--danger' : 'sla-pill--success';

        const totalItems = ocAsociada
            ? ocAsociada.productos.length
            : sdc.productosSolicitados.length;

        const primerProducto = ocAsociada
            ? (ocAsociada.productos[0]?.nombre || 'Sin detalle')
            : (sdc.productosSolicitados[0]?.nombre || 'Sin detalle');

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
                    <span class="kanban-card__meta" title="Analista Asignado">
                        <i class="ph ph-user-circle"></i> ${sdc.analistaAsignado}
                    </span>
                    <span class="kanban-card__date" title="Fecha de Creación">
                        <i class="ph ph-calendar-blank"></i> ${formatearFechaCorta(sdc.fechaCreacion)}
                    </span>
                </div>
            </article>
        `;
    }

    /**
     * Renderiza todas las tarjetas en sus respectivas 5 columnas del Tablero Kanban.
     */
    function renderizarTableroKanban() {
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

        // Si los contenedores aún no están en el DOM, salir silenciosamente
        if (!mapaColumnas[ESTADOS_KANBAN.SDC_CREADA]) return;

        // Limpiar columnas
        Object.values(mapaColumnas).forEach(col => {
            if (col) col.innerHTML = '';
        });

        const conteoPorEstado = {
            [ESTADOS_KANBAN.SDC_CREADA]: 0,
            [ESTADOS_KANBAN.PUBLICADA]: 0,
            [ESTADOS_KANBAN.OC_ACEPTADA]: 0,
            [ESTADOS_KANBAN.EN_DESPACHO]: 0,
            [ESTADOS_KANBAN.RECEPCIONADA]: 0
        };

        estadoMemoria.sdcList.forEach(sdc => {
            const colContainer = mapaColumnas[sdc.estado];
            if (!colContainer) return;

            const ocAsociada = estadoMemoria.ocList.find(oc => oc.sdcId === sdc.id) || null;
            colContainer.insertAdjacentHTML('beforeend', crearCardKanbanHTML(sdc, ocAsociada));
            conteoPorEstado[sdc.estado] = (conteoPorEstado[sdc.estado] || 0) + 1;
        });

        // Actualizar badges de conteo y estados vacíos
        Object.keys(mapaColumnas).forEach(estadoKey => {
            const col = mapaColumnas[estadoKey];
            const badge = mapaContadores[estadoKey];
            const total = conteoPorEstado[estadoKey] || 0;

            if (badge) badge.textContent = total;
            if (col && total === 0) {
                col.innerHTML = `
                    <div class="kanban-empty-slot">
                        <i class="ph ph-tray"></i>
                        <span>Sin solicitudes en esta etapa</span>
                    </div>
                `;
            }
        });
    }

    /**
     * Inicializa la navegación por sub-pestañas dentro de #view-adquisiciones.
     */
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
                    if (panel.id === targetPanelId) {
                        panel.style.display = 'block';
                        panel.classList.add('active');
                    } else {
                        panel.style.display = 'none';
                        panel.classList.remove('active');
                    }
                });
            });
        });
    }

    // =========================================================================
    // 5. INICIALIZACIÓN SEGURA Y EXPOSICIÓN DE API PÚBLICA
    // =========================================================================
    function initModuloAdquisiciones() {
        inicializarSubTabsAdquisiciones();
        renderizarTableroKanban();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initModuloAdquisiciones);
    } else {
        initModuloAdquisiciones();
    }

    // Exponer modelos y utilidades en el namespace global para fases futuras
    window.VisorAdquisiciones = {
        ESTADOS_KANBAN,
        SLA_LIMITS_HOURS,
        SDC_SCHEMA,
        OC_SCHEMA,
        ModeloSDC,
        ModeloOC,
        estadoMemoria,
        renderizarTableroKanban,
        initModuloAdquisiciones
    };

})(window, document);

