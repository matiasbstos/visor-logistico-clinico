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
 * 2. Vistas Auditadas "Visor Logístico" (#view-erp-adquisiciones):
 *    - Vista 1: Dashboard Principal (KPIs, Flujo Semanal SVG, Acción Inmediata, Accesos Rápidos)
 *    - Vista 2: Tablero Kanban SDC/OC (4 columnas responsivas, filtros SLA/Parcial, Drawer y Modal)
 *    - Vista 3: Recepción Dinámica + Modal de Auditoría con cálculo de discrepancias en vivo
 *    - Vista 4: Catálogo Maestro de Insumos (Grilla responsiva 4 -> 2 -> 1 con búsqueda y filtros)
 *    - Vista 5: Despachos a Red Asistencial (Cross-Docking)
 * 3. Fase 4 — Optimización de Arquitectura Backend y Escalabilidad:
 *    - Connection Pooling & Caché Híbrido (Memoria + sessionStorage con TTL e invalidación selectiva)
 *    - Motor de Índices en Memoria (Búsqueda instantánea sin lecturas a Firebase por pulsación)
 *    - Monitoreo de Errores Tipo Sentry (try...catch con console.error("SENTRY_LOG:", error))
 *    - Resolución de Assets Estáticos vía CDN / Rutas Relativas Optimizadas
 *
 * REGLA DE ORO: Módulo 100% aislado. No altera la lógica del inventario actual,
 * el enrutador SPA principal ni el módulo de Triaje Logístico.
 */

(function (window, document) {
    'use strict';

    // =========================================================================
    // 1. CONSTANTES DE ESTADOS KANBAN, SLA Y CDN DE ASSETS ESTÁTICOS
    // =========================================================================
    const ESTADOS_KANBAN = Object.freeze({
        SDC_CREADA: 'SDC_CREADA',               // Columna 1: SDC Creada
        PUBLICADA: 'PUBLICADA',                 // Columna 2: OC Publicada
        OC_ACEPTADA: 'OC_ACEPTADA',             // Columna intermedia (vista 5 cols)
        EN_DESPACHO: 'EN_DESPACHO',             // Columna 3: En Despacho (SLA)
        PARTIAL: 'PARTIAL',                     // Excepción Fase 7: Recepción Parcial (Backorder activo en Kanban)
        RECEPCIONADA: 'RECEPCIONADA',           // Columna 4: Recepcionada (100% Completado)
        CANCELLED: 'CANCELLED'                  // Excepción Fase 7: Anulada por Quiebre Proveedor (Fuera de flujo activo)
    });

    const SLA_LIMITS_HOURS = Object.freeze({
        OC_ACEPTADA: 48,
        EN_DESPACHO: 120
    });

    /**
     * 4. CDN PARA ASSETS ESTÁTICOS Y RUTAS RELATIVAS OPTIMIZADAS
     * Evita almacenar o solicitar imágenes/iconos pesados desde Firebase Firestore.
     */
    const ERP_CDN_CONFIG = Object.freeze({
        CDN_BASE_URL: 'https://cdn.sar-logistica.cl/static/erp/v1',
        LOCAL_FALLBACK_BASE: './assets/erp',
        USE_CDN: true
    });

    function resolveStaticAsset(assetPath = '') {
        const cleanPath = String(assetPath).replace(/^\/+/, '');
        if (!cleanPath) return `${ERP_CDN_CONFIG.LOCAL_FALLBACK_BASE}/placeholder-insumo.svg`;
        if (/^https?:\/\//i.test(cleanPath) || cleanPath.startsWith('./') || cleanPath.startsWith('../')) {
            return cleanPath;
        }
        return ERP_CDN_CONFIG.USE_CDN
            ? `${ERP_CDN_CONFIG.CDN_BASE_URL}/${cleanPath}`
            : `${ERP_CDN_CONFIG.LOCAL_FALLBACK_BASE}/${cleanPath}`;
    }

    // =========================================================================
    // 1.B MONITOREO DE ERRORES (SENTRY SIMULADO)
    // =========================================================================
    const SentryMonitor = {
        events: [],
        captureException(error, context = {}) {
            const eventPayload = {
                timestamp: new Date().toISOString(),
                module: 'visor-adquisiciones',
                message: error?.message || String(error),
                stack: error?.stack || null,
                context
            };
            this.events.unshift(eventPayload);
            if (this.events.length > 50) this.events.pop();
            console.error('SENTRY_LOG:', error, eventPayload);
            return eventPayload;
        }
    };

    // =========================================================================
    // 1.C CONNECTION POOLING Y CACHÉ MULTINIVEL (MEMORIA + SESSIONSTORAGE)
    // =========================================================================
    const ERPCacheManager = (function () {
        const STORAGE_PREFIX = 'SAR_ERP_CACHE_V1_';
        const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutos de TTL por defecto
        const memoryStore = new Map();
        const stats = {
            hitsMemory: 0,
            hitsSession: 0,
            misses: 0,
            invalidations: 0,
            dbReadsSaved: 0
        };

        function get(key) {
            try {
                const now = Date.now();
                // Nivel 1: Memoria RAM (O(1))
                if (memoryStore.has(key)) {
                    const entry = memoryStore.get(key);
                    if (!entry.dirty && now < entry.expiresAt) {
                        stats.hitsMemory++;
                        stats.dbReadsSaved++;
                        return entry.data;
                    }
                }

                // Nivel 2: sessionStorage (Sobrevive recargas suaves sin golpear Firebase)
                if (typeof window.sessionStorage !== 'undefined') {
                    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (parsed && !parsed.dirty && now < parsed.expiresAt) {
                            memoryStore.set(key, parsed);
                            stats.hitsSession++;
                            stats.dbReadsSaved++;
                            return parsed.data;
                        }
                    }
                }

                stats.misses++;
                return null;
            } catch (error) {
                SentryMonitor.captureException(error, { operation: 'ERPCacheManager.get', key });
                return null;
            }
        }

        function set(key, data, ttlMs = DEFAULT_TTL_MS) {
            try {
                const payload = {
                    data,
                    updatedAt: Date.now(),
                    expiresAt: Date.now() + ttlMs,
                    dirty: false
                };
                memoryStore.set(key, payload);
                if (typeof window.sessionStorage !== 'undefined') {
                    window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(payload));
                }
                return data;
            } catch (error) {
                SentryMonitor.captureException(error, { operation: 'ERPCacheManager.set', key });
                return data;
            }
        }

        function invalidate(key) {
            try {
                stats.invalidations++;
                if (memoryStore.has(key)) {
                    const entry = memoryStore.get(key);
                    entry.dirty = true;
                    memoryStore.delete(key);
                }
                if (typeof window.sessionStorage !== 'undefined') {
                    window.sessionStorage.removeItem(STORAGE_PREFIX + key);
                }
            } catch (error) {
                SentryMonitor.captureException(error, { operation: 'ERPCacheManager.invalidate', key });
            }
        }

        function getStats() {
            return { ...stats, cachedKeys: Array.from(memoryStore.keys()) };
        }

        return { get, set, invalidate, getStats };
    })();

    /**
     * Simulador de Connection Pool hacia Firebase Firestore.
     * Reutiliza la conexión compartida sin abrir múltiples instancias ni re-consultar
     * colecciones cuyos datos ya están vigentes en ERPCacheManager.
     */
    const ERPConnectionPool = (function () {
        let activeConnection = null;
        let connectionCount = 0;

        function acquireConnection() {
            try {
                if (!activeConnection) {
                    connectionCount++;
                    activeConnection = {
                        poolId: `SAR-FS-POOL-${connectionCount}`,
                        connectedAt: new Date().toISOString(),
                        firestoreInstance: window.db || null,
                        status: 'READY'
                    };
                }
                return activeConnection;
            } catch (error) {
                SentryMonitor.captureException(error, { operation: 'ERPConnectionPool.acquireConnection' });
                return { poolId: 'FALLBACK-POOL', status: 'DEGRADED' };
            }
        }

        async function queryCollectionCached(cacheKey, fetcherFn, forceRefresh = false) {
            try {
                if (!forceRefresh) {
                    const cached = ERPCacheManager.get(cacheKey);
                    if (cached !== null) {
                        return cached;
                    }
                }
                acquireConnection();
                const freshData = await Promise.resolve(fetcherFn());
                ERPCacheManager.set(cacheKey, freshData);
                return freshData;
            } catch (error) {
                SentryMonitor.captureException(error, {
                    operation: 'ERPConnectionPool.queryCollectionCached',
                    cacheKey
                });
                return [];
            }
        }

        return { acquireConnection, queryCollectionCached };
    })();

    // =========================================================================
    // 1.D MOTOR DE ÍNDICES EN MEMORIA PARA BÚSQUEDAS O(1) / O(K) SIN LECTURAS DB
    // =========================================================================
    const ERPIndexEngine = (function () {
        const indices = {
            catalogoBySku: new Map(),
            catalogoByCategory: new Map(),
            catalogoByStatus: new Map(),
            catalogoSearchTokens: [],
            kanbanBySdcId: new Map(),
            kanbanByOcId: new Map(),
            kanbanSearchEntries: [],
            lastIndexedAt: null
        };

        function normalizarTexto(str) {
            return String(str || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim();
        }

        function rebuildCatalogIndex(catalogoList = []) {
            try {
                indices.catalogoBySku.clear();
                indices.catalogoByCategory.clear();
                indices.catalogoByStatus.clear();
                indices.catalogoSearchTokens = [];

                catalogoList.forEach(prod => {
                    indices.catalogoBySku.set(prod.sku, prod);

                    if (!indices.catalogoByCategory.has(prod.categoria)) {
                        indices.catalogoByCategory.set(prod.categoria, []);
                    }
                    indices.catalogoByCategory.get(prod.categoria).push(prod);

                    if (!indices.catalogoByStatus.has(prod.estadoStock)) {
                        indices.catalogoByStatus.set(prod.estadoStock, []);
                    }
                    indices.catalogoByStatus.get(prod.estadoStock).push(prod);

                    const searchBlob = normalizarTexto(
                        `${prod.sku} ${prod.nombre} ${prod.descripcion} ${prod.lote} ${prod.ubicacion} ${prod.categoriaLabel}`
                    );
                    indices.catalogoSearchTokens.push({
                        sku: prod.sku,
                        searchBlob,
                        categoria: prod.categoria,
                        estadoStock: prod.estadoStock,
                        record: prod
                    });
                });

                indices.lastIndexedAt = new Date().toISOString();
            } catch (error) {
                SentryMonitor.captureException(error, { operation: 'ERPIndexEngine.rebuildCatalogIndex' });
            }
        }

        function rebuildKanbanIndex(sdcList = [], ocList = []) {
            try {
                indices.kanbanBySdcId.clear();
                indices.kanbanByOcId.clear();
                indices.kanbanSearchEntries = [];

                ocList.forEach(oc => {
                    indices.kanbanByOcId.set(oc.id, oc);
                });

                sdcList.forEach(sdc => {
                    indices.kanbanBySdcId.set(sdc.id, sdc);
                    const oc = ocList.find(o => o.sdc_id === sdc.id) || null;
                    const itemsText = (oc ? oc.items : sdc.itemsSolicitados)
                        .map(i => `${i.codigo} ${i.nombre} ${i.centroDestino || ''}`)
                        .join(' ');
                    const searchBlob = normalizarTexto(
                        `${sdc.id} ${sdc.creador} ${oc ? oc.id : ''} ${oc ? oc.proveedor : ''} ${itemsText}`
                    );
                    indices.kanbanSearchEntries.push({
                        sdcId: sdc.id,
                        ocId: oc ? oc.id : null,
                        searchBlob,
                        sdc,
                        oc
                    });
                });

                indices.lastIndexedAt = new Date().toISOString();
            } catch (error) {
                SentryMonitor.captureException(error, { operation: 'ERPIndexEngine.rebuildKanbanIndex' });
            }
        }

        /**
         * Consulta el índice de catálogo en memoria sin tocar Firebase.
         */
        function queryCatalog({ query = '', categoria = 'ALL', estadoStock = 'ALL' } = {}) {
            try {
                const qNorm = normalizarTexto(query);

                // Si no hay texto de búsqueda y se filtra por una clave indexada exacta, usamos Map O(1)
                let basePool = indices.catalogoSearchTokens;
                if (!qNorm && categoria !== 'ALL' && estadoStock === 'ALL') {
                    return indices.catalogoByCategory.get(categoria) || [];
                }
                if (!qNorm && estadoStock !== 'ALL' && categoria === 'ALL') {
                    return indices.catalogoByStatus.get(estadoStock) || [];
                }

                return basePool
                    .filter(entry => {
                        if (categoria !== 'ALL' && entry.categoria !== categoria) return false;
                        if (estadoStock !== 'ALL' && entry.estadoStock !== estadoStock) return false;
                        if (qNorm && !entry.searchBlob.includes(qNorm)) return false;
                        return true;
                    })
                    .map(entry => entry.record);
            } catch (error) {
                SentryMonitor.captureException(error, { operation: 'ERPIndexEngine.queryCatalog', query, categoria, estadoStock });
                return [];
            }
        }

        /**
         * Consulta el índice del Kanban en memoria sin tocar Firebase.
         */
        function matchesKanbanQuery(sdcId, query = '') {
            const qNorm = normalizarTexto(query);
            if (!qNorm) return true;
            const entry = indices.kanbanSearchEntries.find(e => e.sdcId === sdcId);
            return entry ? entry.searchBlob.includes(qNorm) : true;
        }

        return {
            rebuildCatalogIndex,
            rebuildKanbanIndex,
            queryCatalog,
            matchesKanbanQuery,
            normalizarTexto,
            getIndexMetadata: () => ({
                catalogIndexedCount: indices.catalogoBySku.size,
                kanbanIndexedCount: indices.kanbanBySdcId.size,
                lastIndexedAt: indices.lastIndexedAt
            })
        };
    })();

    // =========================================================================
    // 2. BACKEND SCHEMA — CLASES SERIALIZABLES A JSON PARA FIREBASE FIRESTORE
    // =========================================================================

    /**
     * @class SDC (Solicitud de Compra)
     * Representa el requerimiento inicial originado por un centro o unidad clínica.
     * Colección destino en Firestore: `ERP_SDC`
     */
    class SDC {
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

            this.fechaCreacion = this.fecha;
            this.analistaAsignado = this.creador;
            this.productosSolicitados = this.itemsSolicitados;
        }

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
     * Colección destino en Firestore: `ERP_OC`
     */
    class OC {
        constructor({
            id,
            sdc_id = null,
            sdcId = null,
            parentOcId = null,
            proveedor = 'Proveedor No Especificado',
            rutProveedor = '77.337.544-5',
            numeroGuiaDespacho = '',
            fechaGuia = '',
            condicionVenta = 'CREDITO A 30 DIAS',
            direccionDespacho = 'REAL AUDIENCIA 980 POB CONDE MANSO DE VELASCO, MELIPILLA',
            contraparteTecnica = 'Mariel Quintanilla Lizama',
            contraparteRutCargo = '15.865.989-4 • Enfermera',
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
            this.parentOcId = parentOcId
                ? String(parentOcId).trim()
                : (/-EXT\d+$/i.test(this.id) ? this.id.replace(/-EXT\d+$/i, '') : null);
            this.proveedor = String(proveedor).trim();
            this.rutProveedor = String(rutProveedor || '77.337.544-5').trim();
            this.numeroGuiaDespacho = String(numeroGuiaDespacho || '').trim();
            this.fechaGuia = String(fechaGuia || '').trim();
            this.condicionVenta = String(condicionVenta || 'CREDITO A 30 DIAS').trim();
            this.direccionDespacho = String(direccionDespacho || 'REAL AUDIENCIA 980, MELIPILLA').trim();
            this.contraparteTecnica = String(contraparteTecnica || 'Mariel Quintanilla Lizama').trim();
            this.contraparteRutCargo = String(contraparteRutCargo || '15.865.989-4 • Enfermera').trim();
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
                        cantidadComprada: pedida,
                        cantidadRecibida: recepcionada,
                        unidad: String(item.unidad || 'UNIDADES').trim().toUpperCase(),
                        lote: String(item.lote || 'S/L').trim(),
                        vencimiento: String(item.vencimiento || 'S/V').trim(),
                        valorUnitario: Number(item.valorUnitario || 0),
                        numeroGuia: String(item.numeroGuia || this.numeroGuiaDespacho || '').trim(),
                        centroDestino: String(item.centroDestino || 'SAR Arpillerista Elsa Romo Aravena').trim()
                    };
                })
                : [];

            this.sdcId = this.sdc_id;
            this.fechaLimiteDespacho = this.deadlineDespacho;
            this.productos = this.items;
            this.estado = this.getEstadoRecepcion();
        }

        getPorcentajeRecepcion() {
            const totalPedido = this.items.reduce((acc, it) => acc + it.cantidadPedida, 0);
            if (totalPedido <= 0) return 0;
            const totalRecibido = this.items.reduce(
                (acc, it) => acc + Math.min(it.cantidadRecepcionada, it.cantidadPedida),
                0
            );
            return Math.round((totalRecibido / totalPedido) * 100);
        }

        getEstadoRecepcion() {
            if (this.estado === ESTADOS_KANBAN.CANCELLED || this.estado === 'CANCELLED') {
                return 'CANCELLED';
            }
            const pct = this.getPorcentajeRecepcion();
            if (pct === 0) return 'PENDIENTE';
            if (pct >= 100) return 'TOTAL';
            return 'PARTIAL';
        }

        /**
         * Detecta si la OC corresponde a una Orden Hija generada por subdivisión de Backorder (-EXT1, -EXT2, etc.)
         */
        esBackorderHija() {
            return Boolean(this.parentOcId || /-EXT\d+$/i.test(this.id));
        }

        /**
         * Retorna el ID de la OC Padre original sin el sufijo secuencial -EXTn
         */
        getOcOriginalId() {
            if (this.parentOcId) return this.parentOcId;
            return this.id.replace(/-EXT\d+$/i, '');
        }

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
     * Colección destino en Firestore: `ERP_Recepciones`
     */
    class Recepcion {
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
    // 3. ESTADO EN MEMORIA, CACHÉ INICIAL E INDEXACIÓN DEL MINI-ERP
    // =========================================================================
    function inicializarDatosERP() {
        try {
            ERPConnectionPool.acquireConnection();

            const ahora = new Date();
            const haceHoras = (h) => new Date(ahora.getTime() - h * 3600 * 1000).toISOString();
            const enHoras = (h) => new Date(ahora.getTime() + h * 3600 * 1000).toISOString();

            const sdcList = [
                new SDC({
                    id: 'SDC-2026-089',
                    fecha: '2026-10-26T09:00:00.000Z',
                    creador: 'Mariel Quintanilla L. (Enfermera SAR)',
                    estado: 'PARTIAL',
                    itemsSolicitados: [
                        { codigo: 'SAR-1048', nombre: 'CLORURO DE SODIO 0.9% SOL INY 100ML X 20 APIROF', cantidadSolicitada: 24, unidad: 'UNIDADES', centroDestino: 'Real Audiencia 980, Melipilla (SAR)' }
                    ]
                }),
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
                    id: 'SDC-2026-089-EXT1',
                    fecha: haceHoras(14),
                    creador: 'Mariel Quintanilla L. (Contraparte Técnica)',
                    centroCosto: 'SAR Arpillerista Elsa Romo Aravena',
                    estado: 'EN_DESPACHO',
                    itemsSolicitados: [
                        {
                            codigo: 'SAR-1048',
                            nombre: 'CLORURO DE SODIO 0.9% SOL INY 100ML X 20 APIROF',
                            cantidadSolicitada: 12,
                            unidad: 'UNIDADES',
                            centroDestino: 'Real Audiencia 980, Melipilla (SAR)'
                        }
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
                    estado: 'PARTIAL',
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
                    id: '1298355-720-AG26',
                    sdc_id: 'SDC-2026-089',
                    proveedor: 'SCM PHARMA SPA',
                    rutProveedor: '77.337.544-5',
                    numeroGuiaDespacho: '6330',
                    fechaGuia: '28/10/2026',
                    condicionVenta: 'CREDITO A 30 DIAS',
                    direccionDespacho: 'REAL AUDIENCIA 980 POB CONDE MANSO DE VELASCO, MELIPILLA',
                    contraparteTecnica: 'Mariel Quintanilla Lizama',
                    contraparteRutCargo: '15.865.989-4 • Enfermera',
                    fechaAceptacion: '2026-10-27T10:00:00.000Z',
                    deadlineDespacho: enHoras(48),
                    items: [
                        {
                            codigo: 'SAR-1048',
                            nombre: 'CLORURO DE SODIO 0.9% SOL INY 100ML X 20 APIROF',
                            cantidadPedida: 24,
                            cantidadRecepcionada: 12,
                            unidad: 'UNIDADES',
                            lote: '75XH0920',
                            vencimiento: '30/08/2029',
                            valorUnitario: 12200,
                            numeroGuia: '6330',
                            centroDestino: 'Real Audiencia 980, Melipilla (SAR)'
                        }
                    ]
                }),
                new OC({
                    id: '1298355-720-AG26-EXT1',
                    sdc_id: 'SDC-2026-089-EXT1',
                    parentOcId: '1298355-720-AG26',
                    proveedor: 'SCM PHARMA SPA',
                    rutProveedor: '77.337.544-5',
                    numeroGuiaDespacho: 'PENDIENTE BACKORDER',
                    fechaGuia: '',
                    condicionVenta: 'CREDITO A 30 DIAS',
                    direccionDespacho: 'REAL AUDIENCIA 980 POB CONDE MANSO DE VELASCO, MELIPILLA',
                    contraparteTecnica: 'Mariel Quintanilla Lizama',
                    contraparteRutCargo: '15.865.989-4 • Enfermera',
                    fechaAceptacion: haceHoras(14),
                    deadlineDespacho: enHoras(96), // SLA recalculado tras acuerdo de entrega parcializada
                    items: [
                        {
                            codigo: 'SAR-1048',
                            nombre: 'CLORURO DE SODIO 0.9% SOL INY 100ML X 20 APIROF',
                            cantidadPedida: 12,
                            cantidadRecepcionada: 0,
                            unidad: 'UNIDADES',
                            lote: 'PENDIENTE',
                            vencimiento: '30/08/2029',
                            valorUnitario: 12200,
                            numeroGuia: 'PENDIENTE',
                            centroDestino: 'Real Audiencia 980, Melipilla (SAR)'
                        }
                    ]
                }),
                new OC({
                    id: 'OC-109510-SE26',
                    sdc_id: 'SDC-2026-098',
                    proveedor: 'B. Braun Medical SpA',
                    rutProveedor: '76.192.410-8',
                    numeroGuiaDespacho: 'Pendiente Guía',
                    fechaAceptacion: haceHoras(12),
                    deadlineDespacho: enHoras(108),
                    items: [
                        { codigo: 'SAR-1045', nombre: 'SUERO FISIOLÓGICO 0.9% 500 ML', cantidadPedida: 600, cantidadRecepcionada: 0, unidad: 'MATRACES', lote: 'BB-4410-S', vencimiento: '30/09/2028', valorUnitario: 1190, centroDestino: 'SAR Central' }
                    ]
                }),
                new OC({
                    id: 'OC-109311-SE26',
                    sdc_id: 'SDC-2026-085',
                    proveedor: 'Lab. Sanderson / Fresenius Kabi',
                    rutProveedor: '80.510.200-3',
                    numeroGuiaDespacho: '88412',
                    fechaAceptacion: haceHoras(145),
                    deadlineDespacho: haceHoras(30), // SLA Vencido (+30h)
                    items: [
                        { codigo: 'SAR-5001', nombre: 'KETOROLACO 30 MG/ML AMPOLLA', cantidadPedida: 800, cantidadRecepcionada: 0, unidad: 'AMPOLLAS', lote: 'LT-9920-K', vencimiento: '30/04/2027', valorUnitario: 420, centroDestino: 'SAR Urgencias' },
                        { codigo: 'SAR-5008', nombre: 'ONDANSETRÓN 4 MG/2ML AMPOLLA', cantidadPedida: 400, cantidadRecepcionada: 0, unidad: 'AMPOLLAS', lote: 'FK-3382-O', vencimiento: '30/08/2027', valorUnitario: 680, centroDestino: 'CECOSF Sur (Cross-docking)' }
                    ]
                }),
                new OC({
                    id: 'OC-109190-SE26',
                    sdc_id: 'SDC-2026-079',
                    proveedor: 'Laboratorio Chile / Teva',
                    rutProveedor: '91.806.000-6',
                    numeroGuiaDespacho: '41209',
                    fechaAceptacion: haceHoras(170),
                    deadlineDespacho: enHoras(20),
                    items: [
                        { codigo: 'SAR-1015', nombre: 'IBUPROFENO 400 MG', cantidadPedida: 4000, cantidadRecepcionada: 2500, unidad: 'COMPRIMIDOS', lote: 'CH-2091-I', vencimiento: '30/06/2027', valorUnitario: 45, centroDestino: 'SAR Central' }
                    ]
                }),
                new OC({
                    id: 'OC-109044-SE26',
                    sdc_id: 'SDC-2026-072',
                    proveedor: 'Cenabast / Diprolab S.A.',
                    rutProveedor: '61.608.700-K',
                    numeroGuiaDespacho: '19402',
                    fechaAceptacion: haceHoras(200),
                    deadlineDespacho: haceHoras(80),
                    items: [
                        { codigo: 'SAR-3012', nombre: 'GUANTES DE NITRILO TALLA M', cantidadPedida: 150, cantidadRecepcionada: 150, unidad: 'CAJAS', lote: 'DP-7741-N', vencimiento: '31/12/2028', valorUnitario: 4850, centroDestino: 'Red Comunal APS' }
                    ]
                })
            ];

            const recepcionesList = [
                new Recepcion({
                    id: 'REC-2026-0042',
                    oc_id: '1298355-720-AG26',
                    fecha: '2026-10-29T10:30:00.000Z',
                    esParcial: true,
                    actaConforme: 'ACTA-PARCIAL-6330',
                    detalleRecibido: [
                        { codigo: 'SAR-1048', nombre: 'CLORURO DE SODIO 0.9% SOL INY 100ML X 20 APIROF', cantidadIngresada: 12, numeroGuia: '6330', lote: '75XH0920', vencimiento: '30/08/2029' }
                    ]
                }),
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

            // Intentar recuperar el Catálogo Maestro desde el Caché (Memoria / sessionStorage)
            let catalogoList = ERPCacheManager.get('ERP_CATALOGO_MAESTRO');
            if (!Array.isArray(catalogoList) || catalogoList.length === 0) {
                catalogoList = [
                    {
                        sku: 'SAR-1002',
                        nombre: 'Paracetamol 500 mg Comprimido',
                        descripcion: 'Analgésico y antipirético oral en blíster clínico bioequivalente.',
                        categoria: 'FARMACOS',
                        categoriaLabel: 'Fármacos Clínicos',
                        ubicacion: 'Bodega A-12',
                        stockActual: 4500,
                        stockMinimo: 1000,
                        unidad: 'COMP',
                        lote: 'LT-2026-88A',
                        vencimiento: '11/2027',
                        estadoStock: 'OPTIMO',
                        icono: 'ph-pill',
                        assetUrl: resolveStaticAsset('catalog/sar-1002-paracetamol.svg')
                    },
                    {
                        sku: 'SAR-5001',
                        nombre: 'Ketorolaco 30 mg/ml Ampolla',
                        descripcion: 'AINE inyectable para manejo de dolor agudo en box de urgencia.',
                        categoria: 'CRITICOS',
                        categoriaLabel: 'Urgencia / Reanimación',
                        ubicacion: 'Bodega Urgencia B-02',
                        stockActual: 40,
                        stockMinimo: 300,
                        unidad: 'AMP',
                        lote: 'LT-9920-K',
                        vencimiento: '04/2027',
                        estadoStock: 'CRITICO',
                        icono: 'ph-syringe',
                        assetUrl: resolveStaticAsset('catalog/sar-5001-ketorolaco.svg')
                    },
                    {
                        sku: 'SAR-1045',
                        nombre: 'Suero Fisiológico NaCl 0.9% 500 ml',
                        descripcion: 'Solución parenteral isotónica estéril libre de pirógenos (Matraz Colapsable).',
                        categoria: 'SUEROS',
                        categoriaLabel: 'Soluciones y Sueros',
                        ubicacion: 'Zona Pallets C-01',
                        stockActual: 820,
                        stockMinimo: 400,
                        unidad: 'MATRAZ',
                        lote: 'BB-4410-S',
                        vencimiento: '09/2028',
                        estadoStock: 'OPTIMO',
                        icono: 'ph-drop',
                        assetUrl: resolveStaticAsset('catalog/sar-1045-suero.svg')
                    },
                    {
                        sku: 'SAR-1015',
                        nombre: 'Ibuprofeno 400 mg Comprimido',
                        descripcion: 'Antiinflamatorio no esteroideo oral para atención primaria y SAR.',
                        categoria: 'FARMACOS',
                        categoriaLabel: 'Fármacos Clínicos',
                        ubicacion: 'Bodega A-14',
                        stockActual: 620,
                        stockMinimo: 800,
                        unidad: 'COMP',
                        lote: 'CH-2091-I',
                        vencimiento: '06/2027',
                        estadoStock: 'BAJO',
                        icono: 'ph-pill',
                        assetUrl: resolveStaticAsset('catalog/sar-1015-ibuprofeno.svg')
                    },
                    {
                        sku: 'SAR-3012',
                        nombre: 'Guantes de Nitrilo Examen Talla M',
                        descripcion: 'Guante clínico ambidiestro libre de polvo y látex, caja dispensadora x 100 u.',
                        categoria: 'INSUMOS',
                        categoriaLabel: 'Insumos Médicos / EPP',
                        ubicacion: 'Rack EPP D-04',
                        stockActual: 310,
                        stockMinimo: 120,
                        unidad: 'CAJA',
                        lote: 'DP-7741-N',
                        vencimiento: '12/2028',
                        estadoStock: 'OPTIMO',
                        icono: 'ph-hand-palm',
                        assetUrl: resolveStaticAsset('catalog/sar-3012-guantes.svg')
                    },
                    {
                        sku: 'SAR-5008',
                        nombre: 'Ondansetrón 4 mg/2ml Ampolla',
                        descripcion: 'Antiemético parenteral de uso en urgencia clínica y observación.',
                        categoria: 'CRITICOS',
                        categoriaLabel: 'Urgencia / Reanimación',
                        ubicacion: 'Bodega Urgencia B-05',
                        stockActual: 190,
                        stockMinimo: 250,
                        unidad: 'AMP',
                        lote: 'FK-3382-O',
                        vencimiento: '08/2027',
                        estadoStock: 'BAJO',
                        icono: 'ph-syringe',
                        assetUrl: resolveStaticAsset('catalog/sar-5008-ondansetron.svg')
                    },
                    {
                        sku: 'SAR-2040',
                        nombre: 'Catéter Venoso Periférico 20G',
                        descripcion: 'Bránula estéril con cámara de reflujo y bioseguridad pasiva.',
                        categoria: 'INSUMOS',
                        categoriaLabel: 'Insumos Médicos / EPP',
                        ubicacion: 'Estante Punción E-02',
                        stockActual: 1200,
                        stockMinimo: 400,
                        unidad: 'UN',
                        lote: 'BD-6612-V',
                        vencimiento: '03/2029',
                        estadoStock: 'OPTIMO',
                        icono: 'ph-first-aid-kit',
                        assetUrl: resolveStaticAsset('catalog/sar-2040-cateter.svg')
                    },
                    {
                        sku: 'SAR-1088',
                        nombre: 'Metamizol Sódico 1g/2ml Ampolla',
                        descripcion: 'Analgésico y antipirético inyectable de alta rotación en SAPU/SAR.',
                        categoria: 'FARMACOS',
                        categoriaLabel: 'Fármacos Clínicos',
                        ubicacion: 'Bodega A-08',
                        stockActual: 950,
                        stockMinimo: 500,
                        unidad: 'AMP',
                        lote: 'SN-5190-M',
                        vencimiento: '10/2027',
                        estadoStock: 'OPTIMO',
                        icono: 'ph-syringe',
                        assetUrl: resolveStaticAsset('catalog/sar-1088-metamizol.svg')
                    }
                ];
                ERPCacheManager.set('ERP_CATALOGO_MAESTRO', catalogoList);
            }

            // Datos de ejemplo ocultos por defecto: todavía no hay datos reales de compras.
            // Para verlos en una prueba: localStorage.setItem('sar_demo','1') y recargar.
            let mostrarEjemplos = false;
            try { mostrarEjemplos = window.localStorage.getItem('sar_demo') === '1'; } catch (e) { /* sin storage */ }
            if (!mostrarEjemplos) {
                sdcList.length = 0;
                ocList.length = 0;
                recepcionesList.length = 0;
                catalogoList.length = 0;
            }

            // Construir índices en memoria para búsquedas instantáneas
            ERPIndexEngine.rebuildCatalogIndex(catalogoList);
            ERPIndexEngine.rebuildKanbanIndex(sdcList, ocList);

            return {
                sdcList,
                ocList,
                recepcionesList,
                catalogoList,
                filtroKanbanActivo: 'ALL',
                filtroRecepcionActivo: 'ALL',
                busquedaGlobal: ''
            };
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'inicializarDatosERP' });
            return {
                sdcList: [],
                ocList: [],
                recepcionesList: [],
                catalogoList: [],
                filtroKanbanActivo: 'ALL',
                filtroRecepcionActivo: 'ALL',
                busquedaGlobal: ''
            };
        }
    }

    const estadoMemoria = inicializarDatosERP();

    function formatearFechaCorta(isoStr) {
        if (!isoStr) return 'S/F';
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return isoStr;
        return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function notificarERP(titulo, mensaje, tipo = 'success') {
        if (typeof window.showToast === 'function') {
            window.showToast(titulo, mensaje, tipo);
        }
    }

    /**
     * Evalúa si una fecha de vencimiento (DD/MM/YYYY, YYYY-MM-DD o MM/YYYY)
     * es menor a 12 meses desde la fecha actual (Fase 7 - Validación de Caducidad Corta).
     */
    function evaluarCaducidadCorta(fechaVtoStr) {
        if (!fechaVtoStr || typeof fechaVtoStr !== 'string') {
            return { esCorta: false, mesesRestantes: null, fechaParseada: null };
        }
        const limpia = fechaVtoStr.trim();
        let fechaObj = null;

        if (window.SAR_Utils && typeof window.SAR_Utils.parseDate === 'function') {
            fechaObj = window.SAR_Utils.parseDate(limpia);
        }

        if (!fechaObj || isNaN(fechaObj.getTime())) {
            // DD/MM/YYYY
            const mDMY = limpia.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (mDMY) {
                fechaObj = new Date(Number(mDMY[3]), Number(mDMY[2]) - 1, Number(mDMY[1]));
            } else {
                // YYYY-MM-DD
                const mYMD = limpia.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
                if (mYMD) {
                    fechaObj = new Date(Number(mYMD[1]), Number(mYMD[2]) - 1, Number(mYMD[3]));
                } else {
                    // MM/YYYY
                    const mMY = limpia.match(/^(\d{1,2})[\/\-](\d{4})$/);
                    if (mMY) {
                        fechaObj = new Date(Number(mMY[2]), Number(mMY[1]), 0);
                    }
                }
            }
        }

        if (!fechaObj || isNaN(fechaObj.getTime())) {
            return { esCorta: false, mesesRestantes: null, fechaParseada: null };
        }

        const ahora = new Date();
        const limite12Meses = new Date(ahora.getFullYear() + 1, ahora.getMonth(), ahora.getDate());
        const diffMs = fechaObj.getTime() - ahora.getTime();
        const mesesRestantes = Math.round((diffMs / (1000 * 60 * 60 * 24 * 30.4375)) * 10) / 10;

        return {
            esCorta: fechaObj < limite12Meses,
            mesesRestantes,
            fechaParseada: fechaObj
        };
    }

    /**
     * Misión Fase 8 — Regla 2 (Cumplimiento Normativo DAF):
     * Valida que el formato de la OC termine en los sufijos oficiales de Mercado Público
     * (-CM para Convenio Marco, -AG para Compra Ágil, -COT para Cotización, o -SE/-LE/-LP/-TD,
     * soportando año opcional ej. -AG26 y subdivisión -EXT1) y que el RUT del proveedor sea válido.
     */
    function validarNomenclaturaOcYRutDAF(ocIdStr, rutProveedorStr) {
        const ocClean = String(ocIdStr || '').trim();
        const rutClean = String(rutProveedorStr || '').trim();

        // Regex oficial Mercado Público: -CM, -AG, -COT (y licitaciones -SE, -LE, -LP, -TD) + año opcional (2 dígitos) + sufijo -EXTn opcional
        const regexOcMercadoPublico = /-(CM|AG|COT|SE|LE|LP|TD)(\d{2})?(-EXT\d+)?$/i;
        const matchOc = ocClean.match(regexOcMercadoPublico);
        const ocValida = Boolean(ocClean.length >= 5 && matchOc);

        // Validación de formato de RUT Chileno (ej: 77.337.544-5 o 77337544-5)
        const regexRutFormato = /^(\d{1,2}\.?\d{3}\.?\d{3})-([\dkK])$/;
        const matchRut = rutClean.match(regexRutFormato);
        let rutValido = false;

        if (matchRut) {
            const cuerpo = matchRut[1].replace(/\./g, '');
            if (cuerpo.length >= 7 && Number(cuerpo) > 0) {
                rutValido = true;
            }
        }

        const mapaTipos = {
            CM: 'Convenio Marco (-CM)',
            AG: 'Compra Ágil (-AG)',
            COT: 'Cotización (-COT)',
            SE: 'Compra / Trato Directo (-SE)',
            LE: 'Licitación Pública (-LE)',
            LP: 'Licitación Pública (-LP)',
            TD: 'Trato Directo (-TD)'
        };
        const codigoTipo = matchOc ? matchOc[1].toUpperCase() : null;

        return {
            esValido: ocValida && rutValido,
            ocValida,
            rutValido,
            tipoOcDetectado: codigoTipo ? (mapaTipos[codigoTipo] || codigoTipo) : null,
            mensajeAlerta: 'Verifique tipo de OC y RUT de proveedor (Regla DAF)'
        };
    }

    /**
     * Misión Fase 8 — Regla 1 (Selector Manual de Fecha Física — Cumplimiento Normativo DAF):
     * Permite el ingreso manual de la "Fecha Real de Recepción Física" (incluyendo fechas pasadas
     * para ingresos atrasados en el sistema o el día actual).
     * Regla de Validación: Bloquea cualquier fecha futura (fecha_ingresada > fecha_actual).
     * Si el usuario selecciona mañana (o cualquier fecha futura), deshabilita el botón de procesar
     * y muestra una alerta naranja.
     */
    function validarFechaRecepcionFisicaDAF(fechaInputStr) {
        const raw = String(fechaInputStr || '').trim();
        if (!raw) {
            return {
                esValida: false,
                esVacia: true,
                esFutura: false,
                fechaFormateadaCL: '',
                mensajeError: 'Ingrese manualmente la "Fecha Real de Recepción Física" (obligatorio).'
            };
        }

        let year, month, day;
        const mYMD = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const mDMY = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (mYMD) {
            year = Number(mYMD[1]);
            month = Number(mYMD[2]);
            day = Number(mYMD[3]);
        } else if (mDMY) {
            day = Number(mDMY[1]);
            month = Number(mDMY[2]);
            year = Number(mDMY[3]);
        } else {
            return {
                esValida: false,
                esVacia: false,
                esFutura: false,
                fechaFormateadaCL: '',
                mensajeError: 'Formato de Fecha Real de Recepción Física inválido.'
            };
        }

        const fechaIngresada = new Date(year, month - 1, day, 0, 0, 0, 0);
        const ahora = new Date();
        const fechaActual = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, 0, 0, 0);

        const esFutura = fechaIngresada.getTime() > fechaActual.getTime();
        const fechaFormateadaCL = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;

        if (esFutura) {
            return {
                esValida: false,
                esVacia: false,
                esFutura: true,
                fechaFormateadaCL,
                mensajeError: `Alerta DAF: La Fecha Real de Recepción Física (${fechaFormateadaCL}) no puede ser futura (fecha_ingresada > fecha_actual).`
            };
        }

        return {
            esValida: true,
            esVacia: false,
            esFutura: false,
            fechaFormateadaCL,
            mensajeError: ''
        };
    }

    /**
     * Fase 7 — Regla 3: Anula una Orden de Compra por Quiebre de Stock del Proveedor (CANCELLED)
     * y la retira inmediatamente del flujo logístico activo del Kanban.
     */
    function anularOrdenPorQuiebre(sdcId, ocId) {
        try {
            const oc = ocId
                ? estadoMemoria.ocList.find(o => o.id === ocId)
                : estadoMemoria.ocList.find(o => o.sdc_id === sdcId);
            const sdc = sdcId
                ? estadoMemoria.sdcList.find(s => s.id === sdcId)
                : (oc ? estadoMemoria.sdcList.find(s => s.id === oc.sdc_id) : null);

            if (!oc && !sdc) return;

            if (oc) {
                oc.estado = ESTADOS_KANBAN.CANCELLED;
                oc.motivoAnulacion = 'Quiebre de stock confirmado por proveedor';
                oc.fechaAnulacion = new Date().toISOString();
            }
            if (sdc) {
                sdc.estado = ESTADOS_KANBAN.CANCELLED;
            }

            ERPCacheManager.invalidate('ERP_OC_LIST');
            ERPCacheManager.invalidate('ERP_SDC_LIST');
            ERPIndexEngine.rebuildKanbanIndex(estadoMemoria.sdcList, estadoMemoria.ocList);

            refrescarTodoElERP();
            notificarERP(
                'OC Anulada por Quiebre (CANCELLED)',
                `${oc ? oc.id : sdc.id} cambió a estado CANCELLED y fue retirada del flujo logístico activo.`,
                'error'
            );
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'anularOrdenPorQuiebre', sdcId, ocId });
        }
    }

    /**
     * Genera el siguiente ID secuencial para una Orden Hija (-EXT1, -EXT2, etc.)
     * a partir de la Orden de Compra original.
     * Ejemplo: "OC-1298355" -> "OC-1298355-EXT1", luego "OC-1298355-EXT2".
     */
    function generarIdOrdenHijaSecuencial(ocOriginal) {
        const baseId = ocOriginal.getOcOriginalId();
        const regexExt = new RegExp(`^${baseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-EXT(\\d+)$`, 'i');
        let maxSeq = 0;

        estadoMemoria.ocList.forEach(o => {
            const match = String(o.id).match(regexExt);
            if (match) {
                const n = parseInt(match[1], 10);
                if (!isNaN(n) && n > maxSeq) maxSeq = n;
            }
        });

        const nextSeq = maxSeq + 1;
        return {
            childOcId: `${baseId}-EXT${nextSeq}`,
            baseOcId: baseId,
            seq: nextSeq
        };
    }

    /**
     * Misión Fase 7.1 — Lógica de Subdivisión de Órdenes (Backorders Automáticos / Split Order Logic)
     * Procesa la recepción de una OC:
     * 1. Si cantidadRecibida < cantidadEsperada:
     *    - Registra la recepción actual con las cantidades entregadas y cierra la OC actual (Completada por lo entregado).
     *    - Clona automáticamente el objeto de la orden original y genera una "Orden Hija" por el saldo restante
     *      (Cantidad Esperada - Cantidad Recibida) con ID secuencial (`OC-XXXX-EXT1`, `-EXT2`, ...).
     *    - Recalcula / resetea el SLA asignando la "Nueva Fecha de Compromiso" acordada para no penalizar falsamente al proveedor.
     *    - Reinyecta la Orden Hija en la columna "En Despacho" del Kanban y en la tabla de Recepción Dinámica.
     * 2. Si cantidadRecibida === cantidadEsperada:
     *    - Registra la recepción total y cierra la OC normalmente.
     */
    function confirmarRecepcion({
        oc,
        itemIdx = 0,
        cantidadRecibida,
        fechaRecepcionFisica = '',
        ocIdConfirmado = '',
        nuevaFechaCompromisoStr = '',
        numeroGuia = '',
        lote = '',
        vencimiento = '',
        contraparteTecnica = '',
        contraparteRutCargo = '',
        caducidadCortaAceptada = false
    }) {
        const item = oc.items[itemIdx] || oc.items[0];
        if (!item) throw new Error(`[SplitOrder] Ítem no encontrado en OC ${oc.id}`);

        if (ocIdConfirmado && ocIdConfirmado.trim()) {
            oc.id = ocIdConfirmado.trim();
        }
        if (fechaRecepcionFisica) {
            oc.fechaRecepcionFisica = fechaRecepcionFisica;
            item.fechaRecepcionFisica = fechaRecepcionFisica;
        }

        const cantidadEsperada = Number(item.cantidadPedida) || 0;
        const cantEntregada = Math.max(0, Math.min(cantidadEsperada, Number(cantidadRecibida) || 0));
        const saldoPendiente = Math.max(0, cantidadEsperada - cantEntregada);
        const requiereSplit = saldoPendiente > 0 && cantEntregada > 0;

        // Actualizar metadatos de Guía, Lote, Vencimiento y Contraparte en la orden actual
        if (numeroGuia) {
            item.numeroGuia = numeroGuia;
            oc.numeroGuiaDespacho = numeroGuia;
        }
        if (lote) item.lote = lote;
        if (vencimiento) item.vencimiento = vencimiento;
        if (contraparteTecnica) oc.contraparteTecnica = contraparteTecnica;
        if (contraparteRutCargo) oc.contraparteRutCargo = contraparteRutCargo;

        let ordenHijaCreada = null;

        if (requiereSplit) {
            // 1. Clonar datos base antes de cerrar la orden actual y generar ID secuencial (-EXT1, -EXT2...)
            const { childOcId, baseOcId, seq } = generarIdOrdenHijaSecuencial(oc);
            const baseSdcId = String(oc.sdc_id).replace(/-EXT\d+$/i, '');
            const childSdcId = `${baseSdcId}-EXT${seq}`;

            // 2. Recalcular SLA (Nueva Fecha de Compromiso o reset de 120h desde hoy)
            let nuevoDeadlineISO;
            if (nuevaFechaCompromisoStr && /^\d{4}-\d{2}-\d{2}$/.test(nuevaFechaCompromisoStr.trim())) {
                const [yr, mo, dy] = nuevaFechaCompromisoStr.trim().split('-').map(Number);
                nuevoDeadlineISO = new Date(yr, mo - 1, dy, 18, 0, 0).toISOString();
            } else {
                const resetSla = new Date();
                resetSla.setHours(resetSla.getHours() + SLA_LIMITS_HOURS.EN_DESPACHO);
                nuevoDeadlineISO = resetSla.toISOString();
            }

            // 3. Cerrar la orden actual con las cantidades efectivamente entregadas
            item.cantidadPedida = cantEntregada;
            item.cantidadComprada = cantEntregada;
            item.cantidadRecepcionada = cantEntregada;
            item.cantidadRecibida = cantEntregada;
            oc.fueSubdivididaPorBackorder = true;
            oc.childOcGenerada = childOcId;
            oc.estado = 'TOTAL';

            const sdcActual = estadoMemoria.sdcList.find(s => s.id === oc.sdc_id);
            if (sdcActual) {
                sdcActual.estado = ESTADOS_KANBAN.RECEPCIONADA;
                if (sdcActual.itemsSolicitados && sdcActual.itemsSolicitados[0]) {
                    sdcActual.itemsSolicitados[0].cantidadSolicitada = cantEntregada;
                }
            }

            // 4. Clonar y construir la "Orden Hija" por el saldo restante (Cantidad Esperada - Cantidad Recibida)
            const sdcPadreRef = sdcActual || {
                creador: 'Unidad de Farmacia SAR',
                centroCosto: 'SAR Arpillerista Elsa Romo Aravena'
            };

            const nuevaSdcHija = new SDC({
                id: childSdcId,
                fecha: new Date().toISOString(),
                creador: sdcPadreRef.creador,
                centroCosto: sdcPadreRef.centroCosto,
                estado: ESTADOS_KANBAN.EN_DESPACHO,
                itemsSolicitados: [
                    {
                        codigo: item.codigo,
                        nombre: item.nombre,
                        cantidadSolicitada: saldoPendiente,
                        unidad: item.unidad || 'UNIDADES'
                    }
                ]
            });

            ordenHijaCreada = new OC({
                id: childOcId,
                sdc_id: childSdcId,
                parentOcId: baseOcId,
                proveedor: oc.proveedor,
                rutProveedor: oc.rutProveedor,
                numeroGuiaDespacho: 'PENDIENTE BACKORDER',
                fechaGuia: '',
                condicionVenta: oc.condicionVenta,
                direccionDespacho: oc.direccionDespacho,
                contraparteTecnica: oc.contraparteTecnica,
                contraparteRutCargo: oc.contraparteRutCargo,
                fechaAceptacion: new Date().toISOString(),
                deadlineDespacho: nuevoDeadlineISO,
                items: [
                    {
                        codigo: item.codigo,
                        nombre: item.nombre,
                        cantidadPedida: saldoPendiente,
                        cantidadRecepcionada: 0,
                        unidad: item.unidad || 'UNIDADES',
                        lote: 'PENDIENTE',
                        vencimiento: item.vencimiento || 'S/V',
                        valorUnitario: item.valorUnitario || 0,
                        numeroGuia: 'PENDIENTE',
                        centroDestino: item.centroDestino
                    }
                ]
            });

            // 5. Reinyectar la Orden Hija en la columna "En Despacho" del Kanban y en la tabla de Recepción Dinámica
            estadoMemoria.sdcList.unshift(nuevaSdcHija);
            estadoMemoria.ocList.unshift(ordenHijaCreada);
        } else {
            // Recepción normal (100% o 0%)
            item.cantidadRecepcionada = cantEntregada;
            item.cantidadRecibida = cantEntregada;
            const esParcialSinSplit = cantEntregada < cantidadEsperada;
            oc.estado = esParcialSinSplit ? ESTADOS_KANBAN.PARTIAL : 'TOTAL';

            const sdcActual = estadoMemoria.sdcList.find(s => s.id === oc.sdc_id);
            if (sdcActual) {
                sdcActual.estado = esParcialSinSplit ? ESTADOS_KANBAN.PARTIAL : ESTADOS_KANBAN.RECEPCIONADA;
            }
        }

        // Registrar el evento en el historial de Recepciones
        const nuevaRec = new Recepcion({
            id: `REC-2026-${String(estadoMemoria.recepcionesList.length + 43).padStart(4, '0')}`,
            oc_id: oc.id,
            fecha: new Date().toISOString(),
            esParcial: requiereSplit,
            actaConforme: `ACTA-${requiereSplit ? 'PARCIAL' : 'TOTAL'}-${item.numeroGuia || 'S/G'}`,
            detalleRecibido: [
                {
                    codigo: item.codigo,
                    nombre: item.nombre,
                    cantidadIngresada: cantEntregada,
                    diferenciaPendiente: saldoPendiente,
                    ordenHijaGenerada: ordenHijaCreada ? ordenHijaCreada.id : null,
                    numeroGuia: item.numeroGuia,
                    lote: item.lote,
                    vencimiento: item.vencimiento,
                    caducidadCortaAceptada,
                    rutVerificado: true
                }
            ]
        });
        estadoMemoria.recepcionesList.unshift(nuevaRec);

        ERPCacheManager.invalidate('ERP_OC_LIST');
        ERPCacheManager.invalidate('ERP_SDC_LIST');
        ERPIndexEngine.rebuildKanbanIndex(estadoMemoria.sdcList, estadoMemoria.ocList);

        return {
            ocCerrada: oc,
            ordenHija: ordenHijaCreada,
            requiereSplit,
            cantidadEntregada: cantEntregada,
            saldoPendiente
        };
    }

    // =========================================================================
    // 4. RENDERIZADO DINÁMICO DE LAS 5 VISTAS EN #view-erp-adquisiciones
    // =========================================================================

    /**
     * Renderiza el Tablero Kanban Corporativo de 4 Columnas (#erp-kanban-board)
     * aplicando las reglas Fase 7:
     * - Órdenes con recepción parcial (PARTIAL) NO pasan a Completado; permanecen activas en seguimiento.
     * - Órdenes en "Publicada" o "En Despacho" incluyen Ghost button "Anular OC (Quiebre)" -> CANCELLED.
     * - Órdenes CANCELLED salen del flujo activo del Kanban.
     */
    function renderizarKanbanCorporativo4Cols() {
        try {
            const colSdc = document.getElementById('erp-col-cards-sdc');
            const colPub = document.getElementById('erp-col-cards-publicada');
            const colDesp = document.getElementById('erp-col-cards-despacho');
            const colRec = document.getElementById('erp-col-cards-recepcionada');
            const cancelledTray = document.getElementById('erp-cancelled-oc-tray');
            const cancelledList = document.getElementById('erp-cancelled-oc-list');
            const cancelledCount = document.getElementById('erp-cancelled-oc-count');

            if (!colSdc || !colPub || !colDesp || !colRec) return;

            colSdc.innerHTML = '';
            colPub.innerHTML = '';
            colDesp.innerHTML = '';
            colRec.innerHTML = '';
            if (cancelledList) cancelledList.innerHTML = '';

            const counts = {
                SDC_CREADA: 0,
                PUBLICADA: 0,
                EN_DESPACHO: 0,
                RECEPCIONADA: 0,
                CANCELLED: 0
            };

            let totalParciales = 0;
            let totalVencidos = 0;
            const ahora = new Date();
            const query = estadoMemoria.busquedaGlobal || '';
            const filtro = estadoMemoria.filtroKanbanActivo || 'ALL';

            estadoMemoria.sdcList.forEach(sdc => {
                const oc = estadoMemoria.ocList.find(o => o.sdc_id === sdc.id) || null;
                const estadoRec = oc ? oc.getEstadoRecepcion() : 'PENDIENTE';
                const isCancelled = sdc.estado === ESTADOS_KANBAN.CANCELLED || estadoRec === 'CANCELLED';

                if (isCancelled) {
                    counts.CANCELLED++;
                    if (cancelledList) {
                        const itemCancel = oc ? (oc.items[0] || {}) : (sdc.itemsSolicitados[0] || {});
                        cancelledList.insertAdjacentHTML('beforeend', `
                            <div style="background:#FFFFFF; border:1px solid #FCA5A5; border-radius:var(--shape-card); padding:10px 12px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
                                <div>
                                    <div style="font-family:monospace; font-size:11.5px; font-weight:800; color:var(--sar-red-dark, #7F1D1D);">${oc ? oc.id : sdc.id}</div>
                                    <div style="font-size:12px; font-weight:700; color:#1E293B;">${itemCancel.nombre || 'Insumo'}</div>
                                    <div style="font-size:10.5px; color:#64748B;">${oc ? oc.proveedor : sdc.creador} • Quiebre Proveedor</div>
                                </div>
                                <span class="badge badge-sar-cancelled">CANCELLED</span>
                            </div>
                        `);
                    }
                    return; // Fuera del flujo logístico activo
                }

                const sla = oc ? oc.evaluarSLA(sdc.estado, ahora) : { status: 'en-plazo', label: 'En Análisis' };
                const pctRec = oc ? oc.getPorcentajeRecepcion() : 0;
                const isPartial = estadoRec === 'PARTIAL' || estadoRec === 'PARCIAL' || sdc.estado === ESTADOS_KANBAN.PARTIAL;

                if (isPartial) totalParciales++;
                if (sla.status === 'vencido') totalVencidos++;

                if (filtro === 'SLA_VENCIDO' && sla.status !== 'vencido') return;
                if (filtro === 'PARCIAL' && !isPartial) return;

                // Búsqueda indexada en memoria O(1) sin lecturas a Firebase
                if (query && !ERPIndexEngine.matchesKanbanQuery(sdc.id, query)) return;

                const cardId = oc ? oc.id : sdc.id;
                const primerItem = oc ? (oc.items[0] || {}) : (sdc.itemsSolicitados[0] || {});
                const tituloItem = primerItem.nombre || 'INSUMO CLÍNICO';
                const subMeta = oc ? oc.proveedor : `Analista: ${sdc.creador}`;
                const saldoPendiente = oc && primerItem.cantidadPedida
                    ? Math.max(0, primerItem.cantidadPedida - primerItem.cantidadRecepcionada)
                    : 0;

                let badgeClass = 'badge-sar-yellow';
                let badgeLabel = 'En Análisis';
                let derechaMeta = formatearFechaCorta(sdc.fecha);
                let mostrarGhostAnular = false;

                if (sdc.estado === ESTADOS_KANBAN.PUBLICADA || sdc.estado === ESTADOS_KANBAN.OC_ACEPTADA) {
                    badgeClass = 'badge-sar-blue';
                    badgeLabel = 'Publicada';
                    derechaMeta = `Ref: ${sdc.id}`;
                    mostrarGhostAnular = true;
                } else if (sdc.estado === ESTADOS_KANBAN.EN_DESPACHO || isPartial) {
                    mostrarGhostAnular = true;
                    if (isPartial) {
                        badgeClass = 'badge-sar-partial';
                        badgeLabel = `PARTIAL (-${saldoPendiente.toLocaleString('es-CL')} u.)`;
                        derechaMeta = `${pctRec}% Recibido • Backorder`;
                    } else if (sla.status === 'vencido') {
                        badgeClass = 'badge-sar-red';
                        badgeLabel = sla.label;
                        derechaMeta = 'SLA 5d Vencido';
                    } else {
                        badgeClass = 'badge-sar-blue';
                        badgeLabel = sla.label;
                        derechaMeta = 'En Ruta';
                    }
                } else if (sdc.estado === ESTADOS_KANBAN.RECEPCIONADA) {
                    badgeClass = 'badge-sar-green';
                    badgeLabel = 'Conforme 100%';
                    derechaMeta = `${pctRec}% Recibido`;
                }

                const cantTexto = oc && primerItem.cantidadPedida
                    ? ` (${primerItem.cantidadRecepcionada.toLocaleString('es-CL')} / ${primerItem.cantidadPedida.toLocaleString('es-CL')})`
                    : (primerItem.cantidadSolicitada ? ` (${primerItem.cantidadSolicitada.toLocaleString('es-CL')} ${primerItem.unidad || 'UN'})` : '');

                const ghostBtnHTML = mostrarGhostAnular ? `
                    <div style="padding-top:8px; border-top:1px solid #F1F5F9; display:flex; justify-content:flex-end;">
                        <button type="button" class="erp-btn--ghost-danger" data-cancel-sdc="${sdc.id}" ${oc ? `data-cancel-oc="${oc.id}"` : ''} title="Sacar orden del flujo activo por quiebre de stock">
                            <i class="ph-bold ph-prohibit"></i> Anular OC (Quiebre)
                        </button>
                    </div>
                ` : '';

                // Regla 2 Fase 7.1: Trazabilidad Visual (Padre-Hijo) si la orden tiene sufijo (-EXT)
                const esOrdenHijaExt = Boolean(oc && oc.esBackorderHija());
                const parentLinkHTML = esOrdenHijaExt ? `
                    <div class="kanban-card__parent-link" style="display:flex; align-items:center; gap:5px; font-size:11px; font-weight:600; color:#64748B; background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:var(--shape-card); padding:4px 8px; margin-bottom:2px;">
                        <i class="ph-bold ph-link" style="color:var(--sar-blue); font-size:12px;"></i>
                        <span>Saldo pendiente de OC original (<strong style="font-family:monospace; color:#334155;">${oc.getOcOriginalId()}</strong>)</span>
                    </div>
                ` : '';

                const cardHTML = `
                    <article class="kanban-card" data-sdc-id="${sdc.id}" ${oc ? `data-oc-id="${oc.id}"` : ''} style="${isPartial || esOrdenHijaExt ? 'border-left:4px solid var(--sar-warning-orange);' : ''}">
                        <div class="kanban-card__header">
                            <span class="kanban-card__id">${cardId}</span>
                            <span class="badge ${badgeClass}">${badgeLabel}</span>
                        </div>
                        ${parentLinkHTML}
                        <h4 class="kanban-card__title">${tituloItem}${cantTexto}</h4>
                        ${oc && pctRec > 0 ? `
                            <div class="kanban-card__progress-track">
                                <div class="kanban-card__progress-bar" style="width:${pctRec}%; background:${isPartial ? 'var(--sar-warning-orange)' : 'var(--sar-green)'};"></div>
                            </div>
                        ` : ''}
                        <div class="kanban-card__meta">
                            <span><i class="ph ${oc ? 'ph-buildings' : 'ph-user'}"></i> ${subMeta}</span>
                            <span>${derechaMeta}</span>
                        </div>
                        ${ghostBtnHTML}
                    </article>
                `;

                // Regla 1 Fase 7: Si es PARTIAL, NO pasa a "Completado" (Col 4), se mantiene activa en el Kanban (Col 3) para seguimiento de saldo pendiente
                if (sdc.estado === ESTADOS_KANBAN.SDC_CREADA) {
                    colSdc.insertAdjacentHTML('beforeend', cardHTML);
                    counts.SDC_CREADA++;
                } else if (sdc.estado === ESTADOS_KANBAN.PUBLICADA || sdc.estado === ESTADOS_KANBAN.OC_ACEPTADA) {
                    colPub.insertAdjacentHTML('beforeend', cardHTML);
                    counts.PUBLICADA++;
                } else if (sdc.estado === ESTADOS_KANBAN.EN_DESPACHO || isPartial) {
                    colDesp.insertAdjacentHTML('beforeend', cardHTML);
                    counts.EN_DESPACHO++;
                } else {
                    colRec.insertAdjacentHTML('beforeend', cardHTML);
                    counts.RECEPCIONADA++;
                }
            });

            if (cancelledTray && cancelledCount) {
                cancelledCount.textContent = String(counts.CANCELLED);
                cancelledTray.style.display = counts.CANCELLED > 0 ? 'block' : 'none';
            }

            const setElText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = String(val);
            };

            setElText('erp-col-count-sdc', counts.SDC_CREADA);
            setElText('erp-col-count-publicada', counts.PUBLICADA);
            setElText('erp-col-count-despacho', counts.EN_DESPACHO);
            setElText('erp-col-count-recepcionada', counts.RECEPCIONADA);

            const totalActivas = estadoMemoria.sdcList.filter(s => s.estado !== ESTADOS_KANBAN.CANCELLED).length;
            setElText('erp-kanban-kpi-total', totalActivas);
            setElText('erp-kanban-kpi-parciales', totalParciales);
            setElText('erp-kanban-kpi-vencidos', totalVencidos);

            // Eventos para el Ghost Button "Anular OC (Quiebre)"
            document.querySelectorAll('#erp-kanban-board [data-cancel-sdc]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const sdcId = btn.getAttribute('data-cancel-sdc');
                    const ocId = btn.getAttribute('data-cancel-oc');
                    anularOrdenPorQuiebre(sdcId, ocId);
                });
            });

            document.querySelectorAll('#erp-kanban-board .kanban-card').forEach(card => {
                card.addEventListener('click', () => {
                    const sdcId = card.getAttribute('data-sdc-id');
                    const ocId = card.getAttribute('data-oc-id');
                    abrirDrawerDetalleKanban({ sdcId, ocId });
                });
            });
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'renderizarKanbanCorporativo4Cols' });
        }
    }

    /**
     * Renderiza la Tabla de Recepción Dinámica (#erp-recepcion-tbody)
     */
    function renderizarTablaRecepcionDinamica() {
        try {
            const tbody = document.getElementById('erp-recepcion-tbody');
            if (!tbody) return;

            const searchInput = document.getElementById('erp-recepcion-search');
            const query = ERPIndexEngine.normalizarTexto((searchInput ? searchInput.value : '') || estadoMemoria.busquedaGlobal || '');
            const filtro = estadoMemoria.filtroRecepcionActivo || 'ALL';

            let filasHTML = '';
            let countConformes = 0;
            let countDiscrepancias = 0;

            estadoMemoria.ocList.forEach(oc => {
                const estadoRec = oc.getEstadoRecepcion();
                if (estadoRec === 'TOTAL') countConformes++;
                if (estadoRec === 'PARTIAL' || estadoRec === 'PARCIAL') countDiscrepancias++;

                const filtroMatch = filtro === 'ALL'
                    || estadoRec === filtro
                    || (filtro === 'PARCIAL' && estadoRec === 'PARTIAL');
                if (!filtroMatch) return;

                oc.items.forEach((item, itemIdx) => {
                    const numGuia = item.numeroGuia || oc.numeroGuiaDespacho || 'S/G';
                    const textoFila = ERPIndexEngine.normalizarTexto(`${oc.id} ${oc.sdc_id} ${oc.proveedor} ${oc.rutProveedor} ${numGuia} ${item.nombre} ${item.codigo} ${item.lote}`);
                    if (query && !textoFila.includes(query)) return;

                    let badgeHTML = '<span class="badge badge-sar-blue">Pendiente</span>';
                    if (estadoRec === 'CANCELLED') {
                        badgeHTML = '<span class="badge badge-sar-cancelled">CANCELLED (Quiebre)</span>';
                    } else if (item.cantidadRecepcionada >= item.cantidadPedida && item.cantidadPedida > 0) {
                        badgeHTML = '<span class="badge badge-sar-green">Conforme Total (100%)</span>';
                    } else if (item.cantidadRecepcionada > 0 && item.cantidadRecepcionada < item.cantidadPedida) {
                        const diff = item.cantidadPedida - item.cantidadRecepcionada;
                        badgeHTML = `<span class="badge badge-sar-partial">PARTIAL (-${diff.toLocaleString('es-CL')} u.)</span>`;
                    }

                    const esOrdenHijaExt = oc.esBackorderHija();
                    const etiquetaPadreHijoTabla = esOrdenHijaExt ? `
                        <div style="display:inline-flex; align-items:center; gap:4px; font-size:10.5px; font-weight:600; color:#64748B; background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:var(--shape-card); padding:2px 6px; margin-top:4px;">
                            <i class="ph-bold ph-link" style="color:var(--sar-blue);"></i>
                            <span>Saldo pendiente de OC original (${oc.getOcOriginalId()})</span>
                        </div>
                    ` : '';

                    filasHTML += `
                        <tr style="${estadoRec === 'CANCELLED' ? 'opacity:0.65; background:#FEF2F2;' : ''}">
                            <td>
                                <div style="font-family:monospace; font-weight:800; color:var(--sar-blue);">${oc.id}</div>
                                ${etiquetaPadreHijoTabla}
                                <div style="font-size:11px; color:#64748B;">SDC: <strong>${oc.sdc_id}</strong></div>
                                <div style="margin-top:3px;">
                                    <span class="badge badge-sar-orange" style="font-size:10px; font-family:monospace;">Guía N° ${numGuia}</span>
                                </div>
                            </td>
                            <td>
                                <div style="font-weight:800; color:#0F172A;">${oc.proveedor}</div>
                                <div style="font-size:11px; color:#475569; font-family:monospace;">RUT: ${oc.rutProveedor || '77.337.544-5'}</div>
                                <div style="font-size:11px; color:#64748B;">Destino: ${item.centroDestino}</div>
                            </td>
                            <td>
                                <div style="font-weight:800; color:#0F172A;">${item.nombre}</div>
                                <div style="font-size:11px; color:#64748B; font-family:monospace;">
                                    SKU: ${item.codigo} • Lote: <strong>${item.lote || 'S/L'}</strong> • Vto: ${item.vencimiento || 'S/V'}
                                </div>
                            </td>
                            <td style="text-align:right; font-weight:800; font-family:monospace;">
                                ${item.cantidadPedida.toLocaleString('es-CL')}
                            </td>
                            <td style="text-align:right; font-weight:900; font-family:monospace; color:var(--sar-blue);">
                                ${item.cantidadRecepcionada.toLocaleString('es-CL')}
                            </td>
                            <td style="text-align:center;">
                                ${badgeHTML}
                            </td>
                            <td style="text-align:right;">
                                <div style="display:inline-flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                                    ${estadoRec !== 'CANCELLED' ? `
                                        <button type="button" class="erp-btn ${item.cantidadRecepcionada < item.cantidadPedida ? 'erp-btn--primary' : 'erp-btn--outline'}"
                                            style="padding:6px 10px; font-size:11.5px;"
                                            data-audit-oc="${oc.id}" data-audit-idx="${itemIdx}">
                                            <i class="ph-bold ph-clipboard-text"></i>
                                            ${item.cantidadRecepcionada < item.cantidadPedida ? 'Auditar / Recibir' : 'Editar Recepción'}
                                        </button>
                                    ` : ''}
                                    ${item.cantidadRecepcionada > 0 ? `
                                        <button type="button" class="erp-btn erp-btn--outline"
                                            style="padding:6px 10px; font-size:11.5px; border-color:var(--sar-blue); color:var(--sar-blue);"
                                            data-acta-oc="${oc.id}" data-acta-idx="${itemIdx}"
                                            title="Ver y descargar documento oficial RECEPCIÓN CONFORME">
                                            <i class="ph-bold ph-file-pdf"></i> Recepción Conforme
                                        </button>
                                    ` : ''}
                                </div>
                            </td>
                        </tr>
                    `;
                });
            });

            if (!filasHTML) {
                filasHTML = `
                    <tr>
                        <td colspan="7" style="text-align:center; padding:32px; color:#64748B;">
                            No se encontraron órdenes de compra o guías de despacho para el criterio seleccionado.
                        </td>
                    </tr>
                `;
            }

            tbody.innerHTML = filasHTML;

            const elPend = document.getElementById('erp-rec-kpi-pendientes');
            const elConf = document.getElementById('erp-rec-kpi-conformes');
            const elDisc = document.getElementById('erp-rec-kpi-discrepancias');
            if (elPend) elPend.textContent = String(estadoMemoria.ocList.filter(o => o.getEstadoRecepcion() !== 'CANCELLED').length);
            if (elConf) elConf.textContent = String(countConformes);
            if (elDisc) elDisc.textContent = String(countDiscrepancias);

            tbody.querySelectorAll('[data-audit-oc]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const ocId = btn.getAttribute('data-audit-oc');
                    const itemIdx = Number(btn.getAttribute('data-audit-idx') || 0);
                    abrirModalAuditoriaRecepcion(ocId, itemIdx);
                });
            });

            tbody.querySelectorAll('[data-acta-oc]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const ocId = btn.getAttribute('data-acta-oc');
                    const itemIdx = Number(btn.getAttribute('data-acta-idx') || 0);
                    abrirModalActaRecepcionConforme(ocId, itemIdx);
                });
            });
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'renderizarTablaRecepcionDinamica' });
        }
    }

    /**
     * Abre el Modal de Auditoría de Recepción Dinámica (#erp-audit-modal-overlay)
     * implementando las reglas de Fase 7:
     * 1. Cálculo dinámico: Diferencia = Cantidad Esperada - Cantidad Recibida -> Estado PARTIAL (activo en Kanban).
     * 2. Validación de Caducidad Corta (< 12 meses): alerta roja + checkbox obligatorio.
     * 4. Verificación Administrativa: RUT Proveedor readonly + checkbox obligatorio de concordancia con Guía/Factura.
     */
    function abrirModalAuditoriaRecepcion(ocId, itemIdx = 0) {
        try {
            const modal = document.getElementById('erp-audit-modal-overlay');
            if (!modal) return;

            const oc = estadoMemoria.ocList.find(o => o.id === ocId) || estadoMemoria.ocList[0];
            if (!oc) return;
            const item = oc.items[itemIdx] || oc.items[0];
            if (!item) return;

            const titleEl = document.getElementById('erp-audit-modal-title');
            const subEl = document.getElementById('erp-audit-modal-subtitle');
            const nameEl = document.getElementById('erp-audit-item-name');
            const skuEl = document.getElementById('erp-audit-item-sku');
            const expEl = document.getElementById('erp-audit-expected-qty');
            const prevEl = document.getElementById('erp-audit-prev-qty');
            const diffEl = document.getElementById('erp-audit-diff-qty');
            const destEl = document.getElementById('erp-audit-destino');
            const precioEl = document.getElementById('erp-audit-precio-neto');
            const inputOcNum = document.getElementById('erp-audit-input-oc-num');
            const inputGuia = document.getElementById('erp-audit-input-guia');
            const inputRutProv = document.getElementById('erp-audit-input-rut-prov');
            const dafErrorBox = document.getElementById('erp-audit-daf-error-box');
            const dafErrorText = document.getElementById('erp-audit-daf-error-text');
            const dafErrorDetail = document.getElementById('erp-audit-daf-error-detail');
            const inputFechaRec = document.getElementById('erp-audit-input-fecha-recepcion');
            const inputFechaRecToolbar = document.getElementById('erp-rec-input-fecha-recepcion');
            const fechaErrorBox = document.getElementById('erp-audit-fecha-error-box');
            const fechaErrorText = document.getElementById('erp-audit-fecha-error-text');
            const chkRutMatch = document.getElementById('erp-audit-chk-rut-match');
            const rutVerifBox = document.getElementById('erp-audit-rut-verification-box');
            const inputLote = document.getElementById('erp-audit-input-lote');
            const inputVto = document.getElementById('erp-audit-input-vto');
            const shortExpiryBox = document.getElementById('erp-audit-short-expiry-box');
            const shortExpiryDetail = document.getElementById('erp-audit-short-expiry-detail');
            const chkShortExpiry = document.getElementById('erp-audit-chk-short-expiry');
            const inputFirmante = document.getElementById('erp-audit-input-firmante');
            const inputFirmanteRut = document.getElementById('erp-audit-input-firmante-rut');
            const inputQty = document.getElementById('erp-audit-input-qty');
            const chkConforme = document.getElementById('erp-audit-chk-conforme');
            const discBox = document.getElementById('erp-audit-discrepancy-box');
            const discTitle = document.getElementById('erp-audit-discrepancy-title');
            const discDesc = document.getElementById('erp-audit-discrepancy-desc');
            const statusPill = document.getElementById('erp-audit-status-pill');
            const splitSlaBox = document.getElementById('erp-audit-split-sla-box');
            const inputNewSlaDate = document.getElementById('erp-audit-input-new-sla-date');
            const btnConfirm = document.getElementById('btn-erp-confirm-audit-modal');
            const txtConfirm = document.getElementById('erp-audit-confirm-text');

            if (titleEl) titleEl.textContent = `Auditoría de Recepción: OC ${oc.id}`;
            if (subEl) subEl.textContent = `Proveedor: ${oc.proveedor} (${oc.rutProveedor || '77.337.544-5'}) • SDC Origen: ${oc.sdc_id}`;
            if (nameEl) nameEl.textContent = item.nombre;
            if (skuEl) skuEl.textContent = `Código: ${item.codigo}`;
            if (expEl) expEl.textContent = item.cantidadPedida.toLocaleString('es-CL');
            if (prevEl) prevEl.textContent = item.cantidadRecepcionada.toLocaleString('es-CL');
            if (destEl) destEl.textContent = item.centroDestino || 'Real Audiencia 980, Melipilla';
            if (precioEl) {
                const vUnit = Number(item.valorUnitario || 0);
                precioEl.textContent = vUnit > 0 ? `Val. Unit: $${vUnit.toLocaleString('es-CL')}` : 'Val. Unit: Seg/OC';
            }

            if (inputOcNum) inputOcNum.value = oc.id;
            if (inputGuia) inputGuia.value = item.numeroGuia || oc.numeroGuiaDespacho || '6330';
            if (inputRutProv) {
                inputRutProv.value = oc.rutProveedor || '77.337.544-5';
                inputRutProv.readOnly = true;
            }

            // Regla 1 Fase 8 (DAF): Selector Manual de "Fecha Real de Recepción Física"
            // Permite ingresar manualmente fechas pasadas (ingresos atrasados) o la fecha actual, sin autocompletar por defecto
            if (inputFechaRec) {
                inputFechaRec.value = (inputFechaRecToolbar && inputFechaRecToolbar.value) ? inputFechaRecToolbar.value : '';
            }
            if (fechaErrorBox) fechaErrorBox.style.display = 'none';

            if (chkRutMatch) chkRutMatch.checked = true;
            if (inputLote) inputLote.value = item.lote || '75XH0920';
            if (inputVto) inputVto.value = item.vencimiento || '30/08/2029';
            if (chkShortExpiry) chkShortExpiry.checked = false;
            if (inputFirmante) inputFirmante.value = oc.contraparteTecnica || 'Mariel Quintanilla Lizama';
            if (inputFirmanteRut) inputFirmanteRut.value = oc.contraparteRutCargo || '15.865.989-4 • Enfermera';

            // Pre-cargar Nueva Fecha de Compromiso por defecto (+5 días / 120h SLA reset)
            if (inputNewSlaDate) {
                const defaultSla = new Date();
                defaultSla.setDate(defaultSla.getDate() + 5);
                inputNewSlaDate.value = defaultSla.toISOString().split('T')[0];
            }

            let requiereConfirmacionCaducidadCorta = false;
            let cumplimientoDafOcRutValido = true;
            let fechaFuturaBloqueada = false;

            const sincronizarEstadoBotonConfirmar = () => {
                if (!btnConfirm) return;
                const deshabilitado = !cumplimientoDafOcRutValido || fechaFuturaBloqueada;
                btnConfirm.disabled = deshabilitado;
                btnConfirm.style.opacity = deshabilitado ? '0.5' : '1';
                btnConfirm.style.cursor = deshabilitado ? 'not-allowed' : 'pointer';
            };

            // Regla 2 Fase 8 (DAF): Validación de Nomenclatura OC (-CM, -AG, -COT) y RUT Proveedor
            const actualizarValidacionDAF = () => {
                const valOc = inputOcNum ? inputOcNum.value : oc.id;
                const valRut = inputRutProv ? inputRutProv.value : oc.rutProveedor;
                const evalDaf = validarNomenclaturaOcYRutDAF(valOc, valRut);
                cumplimientoDafOcRutValido = evalDaf.esValido;

                if (dafErrorBox) {
                    dafErrorBox.style.display = evalDaf.esValido ? 'none' : 'block';
                }
                if (!evalDaf.esValido && dafErrorText) {
                    dafErrorText.textContent = evalDaf.mensajeAlerta;
                }
                if (!evalDaf.esValido && dafErrorDetail) {
                    const motivos = [];
                    if (!evalDaf.ocValida) motivos.push('El número de OC no contiene un sufijo oficial (-CM, -AG, -COT)');
                    if (!evalDaf.rutValido) motivos.push('El RUT del proveedor está vacío o tiene formato erróneo');
                    dafErrorDetail.textContent = `${motivos.join(' • ')}.`;
                }
                sincronizarEstadoBotonConfirmar();
            };

            // Regla 1 Fase 8 (DAF): Validación de Fecha Real de Recepción Física
            // Si fecha_ingresada > fecha_actual (ej. mañana), deshabilita el botón de procesar y muestra alerta naranja
            const actualizarValidacionFechaRecepcion = (mostrarErrorSiVacia = false) => {
                const valFecha = inputFechaRec ? inputFechaRec.value : '';
                const evalFecha = validarFechaRecepcionFisicaDAF(valFecha);
                fechaFuturaBloqueada = evalFecha.esFutura;

                if (evalFecha.esFutura || (mostrarErrorSiVacia && evalFecha.esVacia)) {
                    if (fechaErrorBox) fechaErrorBox.style.display = 'block';
                    if (fechaErrorText) fechaErrorText.textContent = evalFecha.mensajeError;
                } else {
                    if (fechaErrorBox) fechaErrorBox.style.display = 'none';
                }

                sincronizarEstadoBotonConfirmar();
                return evalFecha;
            };

            const actualizarValidacionCaducidad = () => {
                const vtoStr = inputVto ? inputVto.value : '';
                const evalCad = evaluarCaducidadCorta(vtoStr);
                requiereConfirmacionCaducidadCorta = evalCad.esCorta;

                if (shortExpiryBox) {
                    shortExpiryBox.style.display = evalCad.esCorta ? 'block' : 'none';
                }
                if (evalCad.esCorta && shortExpiryDetail) {
                    const textoMeses = evalCad.mesesRestantes !== null
                        ? (evalCad.mesesRestantes <= 0
                            ? 'El lote figura VENCIDO o vence este mes'
                            : `Vigencia restante estimada: ${evalCad.mesesRestantes} meses (< 12 meses)`)
                        : 'Vigencia menor a 12 meses';
                    shortExpiryDetail.textContent = `${textoMeses}. Confirme bajo responsabilidad técnica para autorizar el ingreso:`;
                }
            };

            const actualizarCalculoDiscrepancia = () => {
                const cantidadEsperada = Number(item.cantidadPedida) || 0;
                const cantidadRecibida = Math.max(0, Math.min(cantidadEsperada, Number(inputQty ? inputQty.value : 0) || 0));
                // Regla 1 Fase 7 & 7.1: Diferencia = Cantidad Esperada - Cantidad Recibida
                const diferencia = Math.max(0, cantidadEsperada - cantidadRecibida);
                const { childOcId } = generarIdOrdenHijaSecuencial(oc);

                if (diffEl) {
                    diffEl.textContent = diferencia.toLocaleString('es-CL');
                    diffEl.style.color = diferencia > 0 ? 'var(--sar-warning-orange)' : 'var(--sar-green)';
                }

                if (diferencia > 0) {
                    if (discBox) {
                        discBox.style.borderLeftColor = 'var(--sar-warning-orange)';
                        discBox.style.background = 'rgba(232,93,30,0.08)';
                    }
                    if (discTitle) {
                        discTitle.style.color = 'var(--sar-warning-orange)';
                        discTitle.textContent = `Subdivisión Automática (Split Order): Saldo = ${diferencia.toLocaleString('es-CL')} u.`;
                    }
                    if (statusPill) {
                        statusPill.className = 'badge badge-sar-partial';
                        statusPill.textContent = `GENERA ${childOcId}`;
                    }
                    if (discDesc) {
                        discDesc.textContent = `Se cerrará la OC actual (${oc.id}) por las ${cantidadRecibida.toLocaleString('es-CL')} u. entregadas y se clonará automáticamente la Orden Hija ${childOcId} por el saldo pendiente de ${diferencia.toLocaleString('es-CL')} u. en "En Despacho".`;
                    }
                    if (splitSlaBox) splitSlaBox.style.display = 'block';
                    if (btnConfirm) {
                        btnConfirm.className = 'erp-btn erp-btn--warning';
                    }
                    if (txtConfirm) txtConfirm.textContent = `Cerrar Entrega y Generar ${childOcId}`;
                } else {
                    if (discBox) {
                        discBox.style.borderLeftColor = 'var(--sar-green)';
                        discBox.style.background = 'rgba(140,198,63,0.12)';
                    }
                    if (discTitle) {
                        discTitle.style.color = '#3f6212';
                        discTitle.textContent = 'Conciliación Exacta: Diferencia = 0 u. (100% Conforme)';
                    }
                    if (statusPill) {
                        statusPill.className = 'badge badge-sar-green';
                        statusPill.textContent = 'COMPLETADO';
                    }
                    if (discDesc) {
                        discDesc.textContent = `La cantidad recibida coincide con las ${cantidadEsperada.toLocaleString('es-CL')} ${item.unidad || 'UNIDADES'} de la OC. Se cerrará el ciclo en estado Completado.`;
                    }
                    if (splitSlaBox) splitSlaBox.style.display = 'none';
                    if (btnConfirm) {
                        btnConfirm.className = 'erp-btn erp-btn--primary';
                    }
                    if (txtConfirm) txtConfirm.textContent = 'Confirmar Recepción Total (100%)';
                }
            };

            if (inputOcNum) {
                inputOcNum.oninput = actualizarValidacionDAF;
                inputOcNum.onchange = actualizarValidacionDAF;
            }
            actualizarValidacionDAF();

            if (inputFechaRec) {
                inputFechaRec.oninput = () => actualizarValidacionFechaRecepcion(false);
                inputFechaRec.onchange = () => actualizarValidacionFechaRecepcion(false);
                actualizarValidacionFechaRecepcion(false);
            }

            if (inputQty) {
                inputQty.max = String(item.cantidadPedida);
                inputQty.value = String(item.cantidadRecepcionada > 0 ? item.cantidadRecepcionada : item.cantidadPedida);
                inputQty.oninput = actualizarCalculoDiscrepancia;
                actualizarCalculoDiscrepancia();
            }

            if (inputVto) {
                inputVto.oninput = actualizarValidacionCaducidad;
                inputVto.onchange = actualizarValidacionCaducidad;
                actualizarValidacionCaducidad();
            }

            if (chkRutMatch && rutVerifBox) {
                chkRutMatch.onchange = () => {
                    rutVerifBox.style.borderColor = chkRutMatch.checked ? '#CBD5E1' : 'var(--sar-red)';
                };
            }

            if (btnConfirm) {
                btnConfirm.onclick = () => {
                    try {
                        // Regla 2 Fase 8 (DAF): Validar Nomenclatura OC (-CM, -AG, -COT) y RUT Proveedor
                        actualizarValidacionDAF();
                        if (!cumplimientoDafOcRutValido) {
                            notificarERP(
                                'Error Normativo DAF',
                                'Verifique tipo de OC y RUT de proveedor (Regla DAF)',
                                'error'
                            );
                            return;
                        }

                        // Regla 1 Fase 8 (DAF): Validar Fecha de Recepción Física Manual (No vacía, No futura, Confirmación si es Hoy)
                        const evalFecha = actualizarValidacionFechaRecepcion(true);
                        if (!evalFecha.esValida) {
                            notificarERP(
                                evalFecha.requiereConfirmarHoy ? 'Confirmación de Fecha Actual Requerida' : 'Fecha de Recepción Física Inválida',
                                evalFecha.mensajeError,
                                evalFecha.requiereConfirmarHoy ? 'warning' : 'error'
                            );
                            return;
                        }

                        // Regla 4 Fase 7: Validar Checkbox obligatorio de concordancia de RUT
                        if (chkRutMatch && !chkRutMatch.checked) {
                            if (rutVerifBox) rutVerifBox.style.borderColor = 'var(--sar-red)';
                            notificarERP(
                                'Verificación Administrativa Requerida',
                                'Debe marcar la casilla de concordancia de RUT del Proveedor antes de confirmar.',
                                'error'
                            );
                            return;
                        }

                        // Regla 2 Fase 7: Validar Checkbox obligatorio si el insumo tiene caducidad corta (< 12 meses)
                        actualizarValidacionCaducidad();
                        if (requiereConfirmacionCaducidadCorta && (!chkShortExpiry || !chkShortExpiry.checked)) {
                            notificarERP(
                                'Riesgo de Caducidad Corta (< 12 meses)',
                                'Debe marcar la casilla "Aceptar insumo con riesgo de merma por caducidad corta" para recepcionar este lote.',
                                'error'
                            );
                            return;
                        }

                        const rawVal = Number(inputQty ? inputQty.value : 0);
                        if (isNaN(rawVal) || rawVal < 0) {
                            throw new Error(`Cantidad de recepción inválida (${inputQty?.value}) en ${oc.id}`);
                        }

                        // Ejecutar Misión Fase 7.1 + Fase 8: Subdivisión Automática de Órdenes + Trazabilidad DAF
                        const resultado = confirmarRecepcion({
                            oc,
                            itemIdx,
                            cantidadRecibida: rawVal,
                            fechaRecepcionFisica: evalFecha.fechaFormateadaCL,
                            ocIdConfirmado: inputOcNum ? inputOcNum.value.trim() : oc.id,
                            nuevaFechaCompromisoStr: inputNewSlaDate ? inputNewSlaDate.value : '',
                            numeroGuia: inputGuia ? inputGuia.value.trim() : '',
                            lote: inputLote ? inputLote.value.trim() : '',
                            vencimiento: inputVto ? inputVto.value.trim() : '',
                            contraparteTecnica: inputFirmante ? inputFirmante.value.trim() : '',
                            contraparteRutCargo: inputFirmanteRut ? inputFirmanteRut.value.trim() : '',
                            caducidadCortaAceptada: requiereConfirmacionCaducidadCorta
                        });

                        modal.classList.remove('active');
                        refrescarTodoElERP();

                        if (resultado.requiereSplit && resultado.ordenHija) {
                            notificarERP(
                                `Orden Hija Generada: ${resultado.ordenHija.id}`,
                                `OC ${oc.id} cerrada con ${resultado.cantidadEntregada.toLocaleString('es-CL')} u. Saldo pendiente (${resultado.saldoPendiente.toLocaleString('es-CL')} u.) reinyectado en "En Despacho".`
                            );
                        } else {
                            notificarERP(
                                'Recepción Total Completada (100%)',
                                `OC ${oc.id} (${item.nombre}): Recibidas ${resultado.cantidadEntregada.toLocaleString('es-CL')} u.`
                            );
                        }

                        if (!chkConforme || chkConforme.checked) {
                            abrirModalActaRecepcionConforme(oc.id, itemIdx);
                        }
                    } catch (error) {
                        SentryMonitor.captureException(error, {
                            operation: 'confirmarAuditoriaRecepcion',
                            ocId: oc.id,
                            sku: item.codigo
                        });
                        notificarERP('Error en Auditoría', 'No se pudo registrar la recepción. Evento reportado a Sentry.', 'error');
                    }
                };
            }

            modal.classList.add('active');
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'abrirModalAuditoriaRecepcion', ocId, itemIdx });
        }
    }

    /**
     * Construye el texto legal obligatorio de la DAF para el Acta de Recepción Conforme (RC).
     */
    function construirTextoLegalDAF(fechaRecepcionStr) {
        const fechaLimpia = String(fechaRecepcionStr || '29/10/2026').trim();
        return `Con fecha ${fechaLimpia}, en calidad de contraparte técnica, certifico lo siguiente: Que se recibió conforme PRODUCTO O SERVICIO, por lo tanto, no existe inconveniente en efectuar los trámites administrativos para su pago.`;
    }

    /**
     * Abre el Modal con el Documento Oficial Fiel "RECEPCIÓN CONFORME PRODUCTO O SERVICIO PARCIAL / TOTAL"
     * cumpliendo la Normativa DAF (Misión Fase 8):
     * - Incluye: Nombre y RUT del proveedor, y número exacto de la Orden de Compra.
     * - Excluye absolutamente: Cualquier campo o referencia al número de "Factura".
     * - Inyecta el Texto Legal Obligatorio DAF sobre la firma.
     * - Si es Parcial, inyecta automáticamente una tabla detallando únicamente los SKUs e insumos recibidos en esa partida.
     */
    function abrirModalActaRecepcionConforme(ocId, itemIdx = 0) {
        try {
            const modal = document.getElementById('erp-acta-conforme-modal-overlay');
            if (!modal) return;

            const oc = estadoMemoria.ocList.find(o => o.id === ocId) || estadoMemoria.ocList[0];
            if (!oc) return;
            const item = oc.items[itemIdx] || oc.items[0];
            if (!item) return;

            const esParcial = item.cantidadRecepcionada < item.cantidadPedida || Boolean(oc.fueSubdivididaPorBackorder);
            const modalidad = esParcial ? 'PARCIAL' : 'TOTAL';
            const fechaCert = item.fechaRecepcionFisica
                || oc.fechaRecepcionFisica
                || (oc.id === '1298355-720-AG26' ? '29/10/2026' : new Date().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }));
            const numGuia = item.numeroGuia || oc.numeroGuiaDespacho || '6330';
            const firmanteCompleto = oc.contraparteTecnica || 'Mariel Quintanilla Lizama';
            const partesRutCargo = String(oc.contraparteRutCargo || '15.865.989-4 • Enfermera').split('•');
            const rutFirmante = (partesRutCargo[0] || '15.865.989-4').trim();
            const cargoFirmante = (partesRutCargo[1] || 'Enfermera').trim();

            const partesNombre = firmanteCompleto.trim().split(/\s+/);
            const firmantePie = partesNombre.length >= 3
                ? `${partesNombre[0]} ${partesNombre[1]} ${partesNombre[2].charAt(0)}.`
                : firmanteCompleto;

            // Filtrar estrictamente los SKUs e insumos efectivamente recibidos en esta partida (> 0), omitiendo los pendientes
            const itemsRecibidosPartida = oc.items
                .filter(it => Number(it.cantidadRecepcionada) > 0)
                .map(it => ({
                    codigo: it.codigo || 'S/C',
                    nombre: it.nombre,
                    cantidad: Number(it.cantidadRecepcionada),
                    unidad: it.unidad || 'UNIDADES',
                    lote: it.lote || 'S/L',
                    vencimiento: it.vencimiento || 'S/V'
                }));

            if (itemsRecibidosPartida.length === 0) {
                itemsRecibidosPartida.push({
                    codigo: item.codigo || 'S/C',
                    nombre: item.nombre,
                    cantidad: item.cantidadRecepcionada > 0 ? item.cantidadRecepcionada : item.cantidadPedida,
                    unidad: item.unidad || 'UNIDADES',
                    lote: item.lote || 'S/L',
                    vencimiento: item.vencimiento || 'S/V'
                });
            }

            const setTxt = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val;
            };

            setTxt('erp-acta-match-sdc', oc.sdc_id || 'SDC-2026-089');
            setTxt('erp-acta-match-oc', `OC ${oc.id}`);
            setTxt('erp-acta-match-guia', `Guía Despacho N° ${numGuia}`);
            setTxt('erp-acta-match-lote', `Lote: ${item.lote || '75XH0920'} • Vto: ${item.vencimiento || '30/08/2029'}`);

            setTxt('acta-doc-titulo', `RECEPCIÓN CONFORME PRODUCTO O SERVICIO ${modalidad}`);
            setTxt('acta-doc-proveedor', oc.proveedor);
            setTxt('acta-doc-rut', oc.rutProveedor || '77.337.544-5');
            setTxt('acta-doc-oc', oc.id);
            setTxt('acta-doc-fecha-real', fechaCert);
            setTxt('acta-doc-guia', numGuia);
            setTxt('acta-doc-sdc-ref', `(Ref. Solicitud: ${oc.sdc_id})`);
            setTxt('acta-doc-modalidad-texto', modalidad);

            // Inyectar exactamente la frase legal obligatoria DAF sobre la firma
            const parrafoLegalEl = document.getElementById('acta-doc-texto-legal-daf');
            if (parrafoLegalEl) {
                parrafoLegalEl.textContent = construirTextoLegalDAF(fechaCert);
            }

            const ulItems = document.getElementById('acta-doc-items-list');
            if (ulItems) {
                ulItems.innerHTML = itemsRecibidosPartida
                    .map(it => `<li style="margin-bottom: 6px;">[${it.codigo}] ${it.nombre} (${it.cantidad} ${it.unidad} )</li>`)
                    .join('');
            }

            // Regla 3 Fase 8 (DAF): Si la recepción es parcial, inyectar tabla detallando únicamente los SKUs recibidos en esta partida
            const partialTableContainer = document.getElementById('acta-doc-partial-table-container');
            const partialTbody = document.getElementById('acta-doc-partial-tbody');
            if (partialTableContainer && partialTbody) {
                if (esParcial) {
                    partialTableContainer.style.display = 'block';
                    partialTbody.innerHTML = itemsRecibidosPartida
                        .map(it => `
                            <tr>
                                <td style="border: 1px solid #000000; padding: 5px 8px; font-family: monospace; font-weight: 700;">${it.codigo}</td>
                                <td style="border: 1px solid #000000; padding: 5px 8px; font-weight: 600;">${it.nombre}</td>
                                <td style="border: 1px solid #000000; padding: 5px 8px; text-align: center; font-family: monospace;">${it.lote} • ${it.vencimiento}</td>
                                <td style="border: 1px solid #000000; padding: 5px 8px; text-align: right; font-weight: 800; font-family: monospace;">${it.cantidad.toLocaleString('es-CL')} ${it.unidad}</td>
                            </tr>
                        `)
                        .join('');
                } else {
                    partialTableContainer.style.display = 'none';
                    partialTbody.innerHTML = '';
                }
            }

            setTxt('acta-doc-timbre-nombre', firmanteCompleto);
            setTxt('acta-doc-timbre-rut', `Rut: ${rutFirmante}`);
            setTxt('acta-doc-timbre-cargo', cargoFirmante);
            setTxt('acta-doc-firmante-pie', firmantePie);

            const datosActa = {
                modalidad,
                esParcial,
                proveedor: oc.proveedor,
                rutProveedor: oc.rutProveedor || '77.337.544-5',
                ocId: oc.id,
                sdcId: oc.sdc_id,
                numGuia,
                fechaCert,
                textoLegalDAF: construirTextoLegalDAF(fechaCert),
                items: itemsRecibidosPartida,
                firmanteCompleto,
                rutFirmante,
                cargoFirmante,
                firmantePie
            };

            const btnClose = document.getElementById('btn-erp-close-acta-conforme');
            if (btnClose) {
                btnClose.onclick = () => modal.classList.remove('active');
            }
            modal.onclick = (e) => {
                if (e.target === modal) modal.classList.remove('active');
            };

            const btnPdf = document.getElementById('btn-erp-acta-pdf');
            if (btnPdf) {
                btnPdf.onclick = () => generarActaRC(datosActa);
            }

            const btnPrint = document.getElementById('btn-erp-acta-print');
            if (btnPrint) {
                btnPrint.onclick = () => {
                    window.print();
                };
            }

            const btnEmail = document.getElementById('btn-erp-acta-email-ready');
            if (btnEmail) {
                btnEmail.onclick = () => {
                    notificarERP(
                        'Flujo de Correo Preparado',
                        `Recepción Conforme (OC ${oc.id} • Guía N° ${numGuia}) encolada para despacho automático por correo.`,
                        'info'
                    );
                };
            }

            modal.classList.add('active');
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'abrirModalActaRecepcionConforme', ocId, itemIdx });
        }
    }

    /**
     * Misión Fase 8 — Regla 3: Motor de Plantillas de Recepción Conforme (RC) — `generarActaRC(datos)`
     * Genera y descarga el PDF oficial cumpliendo estrictamente con la Normativa DAF:
     * 1. Incluye: Nombre y RUT del proveedor, y el número exacto de la Orden de Compra.
     * 2. Excluye absolutamente: Cualquier campo o referencia al número de "Factura".
     * 3. Inyecta el Texto Legal Obligatorio sobre la firma:
     *    "Con fecha [FECHA_RECEPCION], en calidad de contraparte técnica, certifico lo siguiente:
     *     Que se recibió conforme PRODUCTO O SERVICIO, por lo tanto, no existe inconveniente en
     *     efectuar los trámites administrativos para su pago."
     * 4. Subdivisión (Parciales): Si la recepción es parcial, inyecta automáticamente una tabla
     *    detallando únicamente los SKUs e insumos recibidos en esa partida, omitiendo los pendientes.
     */
    async function generarActaRC(datos) {
        try {
            if (!window.jspdf || !window.jspdf.jsPDF) {
                notificarERP('Librería PDF no disponible', 'Utilice el botón Imprimir Hoja para guardar como PDF.', 'warning');
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

            // Sanitizador estricto DAF: elimina cualquier mención accidental a "Factura"
            const sanitizarSinFactura = (txt) => String(txt || '').replace(/factura/gi, '').trim();

            // Intentar cargar el logo oficial de CORPO Municipal de Melipilla
            try {
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                await new Promise((resolve) => {
                    img.onload = () => resolve(true);
                    img.onerror = () => resolve(false);
                    img.src = 'assets/logo-corpo-melipilla.jpg';
                });
                if (img.complete && img.naturalWidth > 0) {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                    doc.addImage(dataUrl, 'JPEG', 26, 20, 26, 26);
                }
            } catch (e) {
                // Continúa sin interrumpir si falla carga de imagen
            }

            const modalidad = datos.modalidad || (datos.esParcial ? 'PARCIAL' : 'TOTAL');
            const esParcial = modalidad === 'PARCIAL' || Boolean(datos.esParcial);

            // Título Principal
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(0, 0, 0);
            doc.text(`RECEPCIÓN CONFORME PRODUCTO O SERVICIO ${modalidad}`, 68, 33);

            // Subtítulo DATOS DEL PROVEEDOR
            doc.setFontSize(10);
            doc.text('DATOS DEL PROVEEDOR', 48, 53);

            // 1. Incluir estrictamente: Nombre y RUT del proveedor, número exacto de la Orden de Compra y Fecha Real de Recepción Física
            // 2. Excluir absolutamente cualquier referencia al número de Factura
            doc.setFontSize(10.5);
            doc.text(`Nombre de la empresa: ${sanitizarSinFactura(datos.proveedor)}`, 26, 62);
            doc.text(`RUT: ${sanitizarSinFactura(datos.rutProveedor)}`, 26, 70);
            doc.text(`Orden de Compra: ${sanitizarSinFactura(datos.ocId)}`, 26, 78);
            doc.text(`Fecha Real de Recepción Física: ${sanitizarSinFactura(datos.fechaCert)}`, 26, 86);

            // 3. Texto Legal Obligatorio DAF inyectado sobre el bloque de certificación y firma
            const textoLegal = datos.textoLegalDAF || construirTextoLegalDAF(datos.fechaCert);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.8);
            const lineasLegales = doc.splitTextToSize(textoLegal, 158);
            doc.text(lineasLegales, 26, 95);

            // Recuadro de detalle con borde negro
            const yBoxStart = 109;
            const itemsRecibidos = Array.isArray(datos.items)
                ? datos.items.filter(it => Number(it.cantidad) > 0)
                : [];
            const boxHeight = esParcial ? Math.max(54, 30 + itemsRecibidos.length * 8) : 42;

            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.35);
            doc.rect(26, yBoxStart, 158, boxHeight);

            doc.setFontSize(9.5);
            doc.text(`Que se recibió conforme en forma ${modalidad} el producto, donde se recibió lo siguiente:`, 29, yBoxStart + 9);

            if (esParcial) {
                // 4. Subdivisión (Parciales): Tabla detallando únicamente los SKUs e insumos recibidos en esta partida
                const yTableHead = yBoxStart + 15;
                doc.setFillColor(241, 245, 249);
                doc.rect(29, yTableHead, 152, 7, 'FD');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8.2);
                doc.text('SKU', 31, yTableHead + 4.8);
                doc.text('DESCRIPCIÓN INSUMO RECIBIDO', 54, yTableHead + 4.8);
                doc.text('LOTE / VTO.', 128, yTableHead + 4.8);
                doc.text('CANT. RECIBIDA', 179, yTableHead + 4.8, { align: 'right' });

                doc.setFont('helvetica', 'normal');
                let yRow = yTableHead + 7;
                itemsRecibidos.forEach((it) => {
                    doc.rect(29, yRow, 152, 7);
                    doc.setFont('helvetica', 'bold');
                    doc.text(String(it.codigo || 'S/C').substring(0, 12), 31, yRow + 4.8);
                    doc.setFont('helvetica', 'normal');
                    doc.text(String(it.nombre || '').substring(0, 38), 54, yRow + 4.8);
                    doc.text(`${it.lote || 'S/L'} (${it.vencimiento || 'S/V'})`.substring(0, 22), 128, yRow + 4.8);
                    doc.setFont('helvetica', 'bold');
                    doc.text(`${it.cantidad} ${it.unidad || 'UN'}`, 179, yRow + 4.8, { align: 'right' });
                    yRow += 7;
                });
            } else {
                let yItem = yBoxStart + 18;
                itemsRecibidos.forEach((it) => {
                    const linea = `\u2022  [${it.codigo || 'S/C'}] ${it.nombre} (${it.cantidad} ${it.unidad || 'UNIDADES'} )`;
                    const lineas = doc.splitTextToSize(linea, 144);
                    doc.text(lineas, 34, yItem);
                    yItem += lineas.length * 5.5;
                });
            }

            const yFirmaBase = yBoxStart + boxHeight + 25;

            // Timbre y Firma Contraparte Técnica
            doc.setFont('helvetica', 'bolditalic');
            doc.setFontSize(9.5);
            doc.text(datos.firmanteCompleto, 105, yFirmaBase, { align: 'center', angle: -12 });
            doc.setFontSize(8.5);
            doc.text(`Rut: ${datos.rutFirmante}`, 103, yFirmaBase + 4, { align: 'center', angle: -12 });
            doc.text(datos.cargoFirmante, 101, yFirmaBase + 8, { align: 'center', angle: -12 });

            // Línea de firma
            doc.setLineWidth(0.3);
            doc.line(68, yFirmaBase + 10, 138, yFirmaBase + 10);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.text('Firma contraparte técnica', 103, yFirmaBase + 20, { align: 'center' });
            doc.text(`Nombre Contraparte Técnica: ${datos.firmantePie}`, 105, yFirmaBase + 27, { align: 'center' });

            const nombreArchivo = `Acta_RC_${modalidad}_${sanitizarSinFactura(datos.ocId)}.pdf`;
            doc.save(nombreArchivo);

            notificarERP('Acta RC Oficial Generada (DAF)', `Se descargó "${nombreArchivo}" cumpliendo la normativa DAF.`);
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'generarActaRC' });
            notificarERP('Error al generar Acta RC', 'No fue posible generar el archivo PDF.', 'error');
        }
    }

    const descargarPDFActaRecepcionConforme = generarActaRC;

    /**
     * Renderiza el Catálogo Maestro de Insumos (#erp-catalog-grid)
     * consultando primero el Caché (`ERPCacheManager`) y filtrando localmente
     * mediante el motor de índices (`ERPIndexEngine.queryCatalog`).
     */
    function renderizarCatalogoInsumos() {
        try {
            const grid = document.getElementById('erp-catalog-grid');
            if (!grid) return;

            // Obtener desde caché en memoria / sessionStorage sin re-consultar Firebase
            const cachedCatalog = ERPCacheManager.get('ERP_CATALOGO_MAESTRO');
            if (Array.isArray(cachedCatalog) && cachedCatalog.length > 0 && estadoMemoria.catalogoList !== cachedCatalog) {
                estadoMemoria.catalogoList = cachedCatalog;
                ERPIndexEngine.rebuildCatalogIndex(cachedCatalog);
            }

            const searchInput = document.getElementById('erp-catalog-search');
            const catSelect = document.getElementById('erp-catalog-category-filter');
            const statusSelect = document.getElementById('erp-catalog-status-filter');

            const query = ((searchInput ? searchInput.value : '') || estadoMemoria.busquedaGlobal || '');
            const categoria = catSelect ? catSelect.value : 'ALL';
            const estadoStock = statusSelect ? statusSelect.value : 'ALL';

            // Consulta indexada en memoria (0 lecturas a Firebase por tecla presionada)
            const filtrados = ERPIndexEngine.queryCatalog({ query, categoria, estadoStock });

            if (filtrados.length === 0) {
                grid.innerHTML = `
                    <div class="erp-card" style="grid-column: 1 / -1; text-align:center; padding:32px; color:#64748B;">
                        No se encontraron insumos clínicos que coincidan con el filtro aplicado.
                    </div>
                `;
                return;
            }

            grid.innerHTML = filtrados.map(prod => {
                let badgeClass = 'badge-sar-green';
                let badgeText = 'Stock Óptimo';
                let barColor = 'var(--sar-green)';

                if (prod.estadoStock === 'CRITICO') {
                    badgeClass = 'badge-sar-red';
                    badgeText = 'Quiebre Crítico';
                    barColor = 'var(--sar-red)';
                } else if (prod.estadoStock === 'BAJO') {
                    badgeClass = 'badge-sar-orange';
                    badgeText = 'Stock Bajo';
                    barColor = 'var(--sar-orange)';
                }

                const pct = Math.min(100, Math.round((prod.stockActual / Math.max(1, prod.stockMinimo * 2)) * 100));
                const cdnAssetUrl = prod.assetUrl || resolveStaticAsset(`catalog/${prod.sku.toLowerCase()}.svg`);

                return `
                    <article class="erp-catalog-card" data-cdn-asset="${cdnAssetUrl}">
                        <div class="erp-catalog-card__visual">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-family:monospace; font-size:11px; font-weight:800; background:#ffffff; color:var(--sar-blue); padding:3px 8px; border:1px solid #E2E8F0; border-radius:var(--shape-card);">
                                    ${prod.sku}
                                </span>
                                <span style="font-size:11px; font-weight:700; color:#475569;">
                                    <i class="ph-fill ph-map-pin" style="color:var(--sar-blue);"></i> ${prod.ubicacion}
                                </span>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                                <span style="font-size:10px; font-weight:800; text-transform:uppercase; color:var(--sar-blue); background:rgba(26,54,104,0.08); padding:3px 8px; border-radius:var(--shape-card);">
                                    ${prod.categoriaLabel}
                                </span>
                                <i class="ph-duotone ${prod.icono}" style="font-size:36px; color:rgba(26,54,104,0.35);"></i>
                            </div>
                        </div>

                        <div class="erp-catalog-card__body">
                            <div>
                                <h4 style="margin:0; font-size:14px; font-weight:800; color:#0F172A; line-height:1.3;">${prod.nombre}</h4>
                                <p style="margin:4px 0 0 0; font-size:12px; color:#64748B; line-height:1.4;">${prod.descripcion}</p>
                            </div>

                            <div class="erp-catalog-card__stock-box">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                    <span style="font-size:10px; font-weight:800; text-transform:uppercase; color:#64748B;">Disponibilidad</span>
                                    <span class="badge ${badgeClass}">${badgeText}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; align-items:baseline;">
                                    <span style="font-size:18px; font-weight:900; color:#0F172A;">
                                        ${prod.stockActual.toLocaleString('es-CL')} <small style="font-size:11px; font-weight:600; color:#64748B;">${prod.unidad}</small>
                                    </span>
                                    <span style="font-size:11px; color:#64748B;">Mín: ${prod.stockMinimo.toLocaleString('es-CL')}</span>
                                </div>
                                <div class="kanban-card__progress-track" style="margin-top:8px;">
                                    <div class="kanban-card__progress-bar" style="width:${pct}%; background:${barColor};"></div>
                                </div>
                            </div>

                            <div style="display:flex; justify-content:space-between; font-size:11px; color:#64748B;">
                                <span>Lote: <strong style="font-family:monospace; color:#334155;">${prod.lote}</strong></span>
                                <span>Vence: <strong style="color:#334155;">${prod.vencimiento}</strong></span>
                            </div>
                        </div>

                        <div class="erp-catalog-card__footer">
                            <button type="button" class="erp-btn ${prod.estadoStock === 'CRITICO' ? 'erp-btn--danger' : 'erp-btn--primary'}"
                                style="width:100%;" data-catalog-solicitar="${prod.sku}">
                                <i class="ph-bold ph-plus-circle"></i>
                                ${prod.estadoStock === 'CRITICO' ? 'Generar SDC Urgente' : 'Incluir en Nueva SDC'}
                            </button>
                        </div>
                    </article>
                `;
            }).join('');

            grid.querySelectorAll('[data-catalog-solicitar]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const sku = btn.getAttribute('data-catalog-solicitar');
                    const prod = estadoMemoria.catalogoList.find(p => p.sku === sku);
                    if (!prod) return;
                    crearNuevaSDCDesdeCatalogo(prod);
                });
            });
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'renderizarCatalogoInsumos' });
        }
    }

    /**
     * Renderiza la Tabla de Despachos a Red Asistencial (Cross-Docking)
     */
    function renderizarTablaDespachosRed() {
        try {
            const tbody = document.getElementById('erp-despachos-tbody');
            if (!tbody) return;

            let html = '';
            estadoMemoria.ocList.forEach(oc => {
                oc.items.forEach(item => {
                    const disponible = item.cantidadRecepcionada;
                    const listo = disponible > 0;
                    html += `
                        <tr>
                            <td>
                                <div style="font-family:monospace; font-weight:800; color:var(--sar-blue);">${oc.id}</div>
                                <div style="font-size:11px; color:#64748B;">SDC: ${oc.sdc_id}</div>
                            </td>
                            <td>
                                <div style="font-weight:700; color:#0F172A;">${item.nombre}</div>
                                <div style="font-size:11px; color:#64748B; font-family:monospace;">${item.codigo}</div>
                            </td>
                            <td>
                                <span style="font-weight:700; color:var(--sar-blue);">
                                    <i class="ph-fill ph-hospital"></i> ${item.centroDestino}
                                </span>
                            </td>
                            <td style="text-align:right; font-weight:800; font-family:monospace;">
                                ${item.cantidadPedida.toLocaleString('es-CL')}
                            </td>
                            <td style="text-align:right; font-weight:900; font-family:monospace; color:${listo ? 'var(--sar-green)' : '#94A3B8'};">
                                ${disponible.toLocaleString('es-CL')}
                            </td>
                            <td style="text-align:center;">
                                <span class="badge ${listo ? 'badge-sar-green' : 'badge-sar-yellow'}">
                                    ${listo ? 'Listo para Despacho' : 'En Espera Recepción'}
                                </span>
                            </td>
                            <td style="text-align:right;">
                                <button type="button" class="erp-btn ${listo ? 'erp-btn--primary' : 'erp-btn--outline'}"
                                    style="padding:6px 12px; font-size:12px;"
                                    data-despachar-oc="${oc.id}" data-despachar-destino="${item.centroDestino}">
                                    <i class="ph-bold ph-paper-plane-tilt"></i> Despachar
                                </button>
                            </td>
                        </tr>
                    `;
                });
            });

            tbody.innerHTML = html;

            tbody.querySelectorAll('[data-despachar-oc]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const ocId = btn.getAttribute('data-despachar-oc');
                    const dest = btn.getAttribute('data-despachar-destino');
                    notificarERP(
                        'Guía Cross-Docking Emitida',
                        `Despacho en ruta hacia ${dest} (Ref: ${ocId}).`
                    );
                });
            });
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'renderizarTablaDespachosRed' });
        }
    }

    /**
     * Crea una nueva Solicitud de Compra (SDC), actualiza el índice en memoria
     * y notifica errores a Sentry en caso de fallo.
     */
    function crearNuevaSDCDesdeCatalogo(prod = null) {
        try {
            const correlativo = estadoMemoria.sdcList.length + 102;
            const nuevoId = `SDC-2026-${correlativo}`;
            const item = prod
                ? {
                    codigo: prod.sku,
                    nombre: prod.nombre.toUpperCase(),
                    cantidadSolicitada: Math.max(500, prod.stockMinimo * 2),
                    unidad: prod.unidad,
                    centroDestino: 'SAR Santiago Norte'
                }
                : {
                    codigo: 'SAR-2040',
                    nombre: 'CATÉTER VENOSO PERIFÉRICO 20G',
                    cantidadSolicitada: 1000,
                    unidad: 'UN',
                    centroDestino: 'SAR Urgencias'
                };

            const nuevaSdc = new SDC({
                id: nuevoId,
                fecha: new Date().toISOString(),
                creador: 'Admin SAR (Abastecimiento)',
                estado: ESTADOS_KANBAN.SDC_CREADA,
                itemsSolicitados: [item]
            });

            estadoMemoria.sdcList.unshift(nuevaSdc);
            ERPCacheManager.invalidate('ERP_SDC_LIST');
            ERPIndexEngine.rebuildKanbanIndex(estadoMemoria.sdcList, estadoMemoria.ocList);

            refrescarTodoElERP();
            activarPanelERP('erp-panel-tablero');
            notificarERP(
                'Nueva SDC Creada',
                `${nuevoId} incorporada a la columna "SDC Creada" (${item.nombre}).`
            );
        } catch (error) {
            SentryMonitor.captureException(error, {
                operation: 'crearNuevaSDCDesdeCatalogo',
                sku: prod ? prod.sku : null
            });
        }
    }

    // =========================================================================
    // 5. DRAWER LATERAL DE DETALLE Y RECEPCIÓN PARCIAL (CON MONITOREO SENTRY)
    // =========================================================================
    function abrirDrawerDetalleKanban({ sdcId, ocId }) {
        try {
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
                    <div class="erp-table-scroll">
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
                    </div>

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
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'abrirDrawerDetalleKanban', sdcId, ocId });
        }
    }

    function registrarRecepcionDesdeDrawer(oc, sdc) {
        try {
            if (!oc) {
                throw new Error('No se puede registrar recepción parcial sin una Orden de Compra asociada.');
            }

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
            oc.estado = esParcial ? ESTADOS_KANBAN.PARTIAL : 'TOTAL';

            if (sdc) {
                sdc.estado = esParcial ? ESTADOS_KANBAN.PARTIAL : ESTADOS_KANBAN.RECEPCIONADA;
            }

            // Invalidar caché de OC y reconstruir índice en memoria
            ERPCacheManager.invalidate('ERP_OC_LIST');
            ERPIndexEngine.rebuildKanbanIndex(estadoMemoria.sdcList, estadoMemoria.ocList);

            refrescarTodoElERP();
            abrirDrawerDetalleKanban({ sdcId: sdc ? sdc.id : null, ocId: oc.id });

            notificarERP(
                esParcial ? 'Recepción Parcial Registrada' : 'Recepción Total Conforme',
                `${nuevaRecepcion.id} vinculada a ${oc.id} (${oc.getPorcentajeRecepcion()}% recibido).`
            );
        } catch (error) {
            SentryMonitor.captureException(error, {
                operation: 'registrarRecepcionDesdeDrawer',
                ocId: oc ? oc.id : null,
                sdcId: sdc ? sdc.id : null
            });
            notificarERP('Error en Recepción', 'Ocurrió un fallo al guardar la recepción. Registrado en Sentry.', 'error');
        }
    }

    // =========================================================================
    // 6. NAVEGACIÓN UNIFICADA (SIDEBAR MAESTRA #app-sidebar + SUBNAV ERP)
    // =========================================================================
    function cerrarMenuMovilERP() {
        const sidebar = document.getElementById('app-sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (backdrop) backdrop.classList.remove('active');
    }

    function sincronizarEstadoSidebarUnificado(targetPanelId) {
        const hash = window.location.hash.substring(1) || 'view-panel';
        const isErpView = hash === 'view-erp-adquisiciones';
        const allErpBtns = document.querySelectorAll('.erp-sidebar__item[data-erp-panel]');
        const breadcrumbCurrent = document.getElementById('erp-breadcrumb-current');

        allErpBtns.forEach(btn => {
            const isMatch = btn.getAttribute('data-erp-panel') === targetPanelId;
            if (btn.classList.contains('menu-item')) {
                btn.classList.toggle('active', isErpView && isMatch);
                btn.classList.toggle('normal', !(isErpView && isMatch));
            } else {
                btn.classList.toggle('active', isMatch);
                btn.classList.toggle('erp-btn--primary', isMatch);
                btn.classList.toggle('erp-btn--outline', !isMatch);
            }
            if (isErpView && isMatch && breadcrumbCurrent) {
                breadcrumbCurrent.textContent = btn.getAttribute('data-erp-title') || btn.textContent.trim();
            }
        });
    }

    function activarPanelERP(targetPanelId) {
        const erpSection = document.getElementById('view-erp-adquisiciones');
        if (!erpSection || !targetPanelId) return;

        estadoMemoria.panelERPActivo = targetPanelId;

        if (window.location.hash !== '#view-erp-adquisiciones') {
            window.location.hash = 'view-erp-adquisiciones';
        }

        const panels = erpSection.querySelectorAll('.erp-main-view-panel');
        panels.forEach(panel => {
            panel.style.display = panel.id === targetPanelId ? 'block' : 'none';
        });

        sincronizarEstadoSidebarUnificado(targetPanelId);
        setTimeout(() => sincronizarEstadoSidebarUnificado(targetPanelId), 35);

        cerrarMenuMovilERP();
    }

    function inicializarControlesERP() {
        const erpSection = document.getElementById('view-erp-adquisiciones');
        if (!erpSection || erpSection.dataset.erpInitialized === 'true') return;
        erpSection.dataset.erpInitialized = 'true';
        estadoMemoria.panelERPActivo = estadoMemoria.panelERPActivo || 'erp-panel-tablero';

        // 1. Navegación Global Sidebar Unificada + Sub-navegación rápida
        document.querySelectorAll('.erp-sidebar__item[data-erp-panel]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = btn.getAttribute('data-erp-panel');
                activarPanelERP(targetId);
            });
        });

        // Sincronizar en cambios de hash del enrutador SPA principal
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.substring(1) || 'view-panel';
            if (hash === 'view-erp-adquisiciones') {
                const panelToOpen = estadoMemoria.panelERPActivo || 'erp-panel-tablero';
                setTimeout(() => sincronizarEstadoSidebarUnificado(panelToOpen), 20);
            } else {
                document.querySelectorAll('#app-sidebar .erp-sidebar__item').forEach(btn => {
                    btn.classList.remove('active');
                    btn.classList.add('normal');
                });
                const activeMenu = document.querySelector(`#app-sidebar .menu-item[data-target="${hash}"]:not([data-erp-panel])`);
                const breadcrumbCurrent = document.getElementById('erp-breadcrumb-current');
                if (activeMenu && breadcrumbCurrent) {
                    breadcrumbCurrent.textContent = activeMenu.getAttribute('data-title') || activeMenu.textContent.trim();
                }
                if (hash === 'view-bandejas') {
                    setTimeout(() => renderizarFlujoBandejasTurno(), 80);
                }
            }
        });

        // 2. Accesos rápidos que cambian de sub-panel
        erpSection.querySelectorAll('[data-erp-goto-panel]').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-erp-goto-panel');
                activarPanelERP(targetId);
            });
        });

        // 3. Botones de Acción Inmediata en Dashboard que abren el Modal de Auditoría
        erpSection.querySelectorAll('[data-erp-open-audit]').forEach(btn => {
            btn.addEventListener('click', () => {
                const ocId = btn.getAttribute('data-erp-open-audit');
                abrirModalAuditoriaRecepcion(ocId, 0);
            });
        });

        // 4. Filtros del Kanban
        erpSection.querySelectorAll('.erp-kanban-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                erpSection.querySelectorAll('.erp-kanban-filter-btn').forEach(b => {
                    b.classList.remove('erp-btn--primary');
                    b.classList.add('erp-btn--outline');
                });
                btn.classList.remove('erp-btn--outline');
                btn.classList.add('erp-btn--primary');
                estadoMemoria.filtroKanbanActivo = btn.getAttribute('data-kanban-filter') || 'ALL';
                renderizarKanbanCorporativo4Cols();
            });
        });

        // 5. Filtros de Recepción Dinámica
        erpSection.querySelectorAll('.erp-rec-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                erpSection.querySelectorAll('.erp-rec-filter-btn').forEach(b => {
                    b.classList.remove('erp-btn--primary');
                    b.classList.add('erp-btn--outline');
                });
                btn.classList.remove('erp-btn--outline');
                btn.classList.add('erp-btn--primary');
                estadoMemoria.filtroRecepcionActivo = btn.getAttribute('data-rec-filter') || 'ALL';
                renderizarTablaRecepcionDinamica();
            });
        });

        const recSearch = document.getElementById('erp-recepcion-search');
        if (recSearch) {
            recSearch.addEventListener('input', renderizarTablaRecepcionDinamica);
        }

        // 6. Búsqueda y Filtros del Catálogo de Insumos (Filtra localmente sobre caché indexado)
        const catSearch = document.getElementById('erp-catalog-search');
        const catCategory = document.getElementById('erp-catalog-category-filter');
        const catStatus = document.getElementById('erp-catalog-status-filter');
        if (catSearch) catSearch.addEventListener('input', renderizarCatalogoInsumos);
        if (catCategory) catCategory.addEventListener('change', renderizarCatalogoInsumos);
        if (catStatus) catStatus.addEventListener('change', renderizarCatalogoInsumos);

        // 7. Buscador Global en Topbar Maestra (Filtra localmente sobre índices en memoria)
        const globalSearch = document.getElementById('erp-global-search');
        if (globalSearch) {
            globalSearch.addEventListener('input', () => {
                estadoMemoria.busquedaGlobal = globalSearch.value || '';
                renderizarKanbanCorporativo4Cols();
                renderizarTablaRecepcionDinamica();
                renderizarCatalogoInsumos();
            });
        }

        // 8. Botón "+ Nueva SDC" Global y "Actualizar Datos"
        const btnNuevaSdc = document.getElementById('btn-erp-nueva-sdc');
        if (btnNuevaSdc) {
            btnNuevaSdc.addEventListener('click', () => {
                activarPanelERP('erp-panel-tablero');
                crearNuevaSDCDesdeCatalogo(null);
            });
        }

        const btnRefreshDash = document.getElementById('btn-erp-refresh-dashboard');
        if (btnRefreshDash) {
            btnRefreshDash.addEventListener('click', () => {
                refrescarTodoElERP();
                const cacheStats = ERPCacheManager.getStats();
                notificarERP(
                    'Nodo SAR Sincronizado',
                    `Indicadores al día (Lecturas DB ahorradas por caché: ${cacheStats.dbReadsSaved}).`
                );
            });
        }

        // 9. Cerrar Modal de Auditoría
        const modalAudit = document.getElementById('erp-audit-modal-overlay');
        const btnCloseAudit = document.getElementById('btn-erp-close-audit-modal');
        const btnCancelAudit = document.getElementById('btn-erp-cancel-audit-modal');
        const cerrarAudit = () => {
            if (modalAudit) modalAudit.classList.remove('active');
        };
        if (btnCloseAudit) btnCloseAudit.addEventListener('click', cerrarAudit);
        if (btnCancelAudit) btnCancelAudit.addEventListener('click', cerrarAudit);
        if (modalAudit) {
            modalAudit.addEventListener('click', (e) => {
                if (e.target === modalAudit) cerrarAudit();
            });
        }
    }

    // =========================================================================
    // 7. COMPATIBILIDAD CON TABLERO DE 5 COLUMNAS (#view-adquisiciones)
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
        try {
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
                if (sdc.estado === ESTADOS_KANBAN.CANCELLED) return;
                const estadoMapa = sdc.estado === ESTADOS_KANBAN.PARTIAL
                    ? ESTADOS_KANBAN.EN_DESPACHO
                    : sdc.estado;
                const col = mapaColumnas[estadoMapa];
                if (!col) return;
                const ocAsociada = estadoMemoria.ocList.find(oc => oc.sdc_id === sdc.id) || null;
                col.insertAdjacentHTML('beforeend', crearCardKanban5ColsHTML(sdc, ocAsociada));
                conteo[estadoMapa] = (conteo[estadoMapa] || 0) + 1;
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

            document.querySelectorAll('#view-adquisiciones .kanban-card').forEach(card => {
                card.addEventListener('click', () => {
                    abrirDrawerDetalleKanban({
                        sdcId: card.getAttribute('data-sdc-id'),
                        ocId: card.getAttribute('data-oc-id')
                    });
                });
            });
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'renderizarTableroKanban5Cols' });
        }
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

    // =========================================================================
    // 8. FLUJO TOPOLÓGICO DE SOLICITUDES (REF 2) & CALENDARIO EN INICIO (REF 1)
    // =========================================================================
    estadoMemoria.filtroFlujoSDC = 'ALL';
    estadoMemoria.calendarioMesActual = new Date().getMonth();
    estadoMemoria.calendarioAnioActual = new Date().getFullYear();
    estadoMemoria.calendarioDiaSeleccionado = new Date().toISOString().split('T')[0];
    estadoMemoria.calendarioModoVista = 'ALL'; // 'DAY' | 'ALL'
    estadoMemoria.filtroBandejaFlujo = 'ALL';

    const STORAGE_KEY_CAL_EVENTS = 'SAR_CALENDAR_EVENTS_V1';

    function obtenerEventosCalendarioBase() {
        const hoy = new Date();
        const yyyy = hoy.getFullYear();
        const mm = String(hoy.getMonth() + 1).padStart(2, '0');
        const dd = String(hoy.getDate()).padStart(2, '0');
        const hoyISO = `${yyyy}-${mm}-${dd}`;

        const manana = new Date(hoy.getTime() + 24 * 3600000);
        const mananaISO = manana.toISOString().split('T')[0];

        const ayer = new Date(hoy.getTime() - 24 * 3600000);
        const ayerISO = ayer.toISOString().split('T')[0];

        const en3Dias = new Date(hoy.getTime() + 3 * 24 * 3600000);
        const en3DiasISO = en3Dias.toISOString().split('T')[0];

        const en5Dias = new Date(hoy.getTime() + 5 * 24 * 3600000);
        const en5DiasISO = en5Dias.toISOString().split('T')[0];

        return [
            {
                id: 'CAL-AUTO-1',
                type: 'SOLICITUD',
                date: ayerISO,
                title: 'Vencimiento SLA Despacho: Ketorolaco 30mg/ml Ampolla',
                refId: 'OC-109311-SE26',
                sdcId: 'SDC-2026-085',
                responsable: 'Lab. Sanderson',
                notes: 'Plazo máximo 5 días excedido (+30h). Requiere penalización o recepción inmediata.',
                status: 'ATRASADO'
            },
            {
                id: 'CAL-AUTO-2',
                type: 'ENVIO',
                date: hoyISO,
                title: 'Recepción Parcial y Backorder: Ibuprofeno 400mg (1.500 pend.)',
                refId: 'OC-109190-SE26',
                sdcId: 'SDC-2026-079',
                responsable: 'Laboratorio Chile / Teva',
                notes: 'Entrega de saldo pendiente agendada en andén central.',
                status: 'EN_FECHA'
            },
            {
                id: 'CAL-AUTO-3',
                type: 'RECORDATORIO',
                date: hoyISO,
                title: 'Autorizar firma y vincular OC para Paracetamol 500mg',
                refId: 'SDC-2026-101',
                sdcId: 'SDC-2026-101',
                responsable: 'Analista C. Rojas',
                notes: 'Solicitud en fecha (SLA 48h activo).',
                status: 'EN_FECHA'
            },
            {
                id: 'CAL-AUTO-4',
                type: 'ENVIO',
                date: mananaISO,
                title: 'Llegada Programada: Suero Fisiológico 0.9% 500ml (600 u.)',
                refId: 'OC-109510-SE26',
                sdcId: 'SDC-2026-098',
                responsable: 'B. Braun Medical',
                notes: 'Camión refrigerado / Andén Bodega Central 09:30 hrs.',
                status: 'EN_FECHA'
            },
            {
                id: 'CAL-AUTO-5',
                type: 'AUDITORIA',
                date: en3DiasISO,
                title: 'Auditoría Inventario Semanal por Racks + Cierre Bandejas',
                refId: 'RACK-SEM',
                sdcId: '',
                responsable: 'Equipo Farmacia SAR',
                notes: 'Revisión cíclica de estanterías críticas y cuadratura RAYEN.',
                status: 'PROGRAMADO'
            },
            {
                id: 'CAL-AUTO-6',
                type: 'ENVIO',
                date: en5DiasISO,
                title: 'Despacho Cross-Docking a CESFAM & SAR Santiago Norte',
                refId: 'OC-109044-SE26',
                sdcId: 'SDC-2026-072',
                responsable: 'Cenabast / Ruta Red',
                notes: 'Distribución programada de Guantes de Nitrilo y Salbutamol.',
                status: 'EN_FECHA'
            }
        ];
    }

    function cargarEventosCalendario() {
        // Eventos de ejemplo ocultos por defecto (localStorage sar_demo=1 para verlos); quedan solo los que crea el usuario
        let mostrarEjemplos = false;
        try { mostrarEjemplos = window.localStorage.getItem('sar_demo') === '1'; } catch (e) { /* sin storage */ }
        const base = mostrarEjemplos ? obtenerEventosCalendarioBase() : [];
        try {
            const raw = localStorage.getItem(STORAGE_KEY_CAL_EVENTS);
            if (!raw) return base;
            const custom = JSON.parse(raw);
            if (!Array.isArray(custom)) return base;
            return [...custom, ...base];
        } catch (e) {
            return base;
        }
    }

    function guardarEventoCalendarioUsuario(nuevoEvento) {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_CAL_EVENTS);
            const custom = raw ? JSON.parse(raw) : [];
            custom.unshift(nuevoEvento);
            localStorage.setItem(STORAGE_KEY_CAL_EVENTS, JSON.stringify(custom));
        } catch (e) {
            console.warn('[Calendario SAR] No se pudo persistir en localStorage:', e);
        }
    }

    function renderizarFlujoTopologiaSDC() {
        const canvas = document.getElementById('erp-sdc-node-flow-canvas');
        const timelineBar = document.getElementById('erp-flow-timeline-bar');
        const overviewTbody = document.getElementById('erp-flow-overview-tbody');
        const miniBars = document.getElementById('erp-flow-mini-bars');
        if (!canvas) return;

        const ahora = new Date();
        const registros = estadoMemoria.sdcList
            .filter(sdc => sdc.estado !== ESTADOS_KANBAN.CANCELLED)
            .map(sdc => {
                const oc = ERPIndexEngine.getOCBySdcId(sdc.id) || null;
                const sla = oc ? oc.evaluarSLA(sdc.estado, ahora) : { status: 'en-plazo', label: 'En Fecha (SLA OK)', elapsedHours: 6, limitHours: 48 };
                const pct = oc ? oc.getPorcentajeRecepcion() : 0;
                const estRec = oc ? oc.getEstadoRecepcion() : 'EN ANÁLISIS';
                const insumoPrincipal = oc
                    ? (oc.items[0]?.nombre || 'Insumo Clínico')
                    : (sdc.itemsSolicitados[0]?.nombre || 'Insumo Clínico');

                let plazoCategoria = 'EN_FECHA';
                if (sla.status === 'vencido') {
                    plazoCategoria = 'ATRASADO';
                } else if (estRec === 'PARTIAL' || estRec === 'PARCIAL' || sdc.estado === ESTADOS_KANBAN.PARTIAL || sdc.estado === ESTADOS_KANBAN.SDC_CREADA) {
                    plazoCategoria = 'PARCIAL';
                }

                // Calcular fecha límite estimada a partir de creación/despacho
                const fechaBase = oc && oc.fechaDespacho ? new Date(oc.fechaDespacho) : (oc && oc.fechaAceptacion ? new Date(oc.fechaAceptacion) : new Date(sdc.fecha));
                const horasLimite = (sdc.estado === ESTADOS_KANBAN.EN_DESPACHO || sdc.estado === ESTADOS_KANBAN.PARTIAL) ? 120 : 48;
                const fechaLimite = new Date(fechaBase.getTime() + horasLimite * 3600000);

                return {
                    sdc,
                    oc,
                    sla,
                    pct,
                    estRec,
                    insumoPrincipal,
                    plazoCategoria,
                    fechaLimite
                };
            });

        // Actualizar contadores y métricas globales de cumplimiento de fecha
        const total = registros.length;
        const atrasadas = registros.filter(r => r.plazoCategoria === 'ATRASADO').length;
        const parciales = registros.filter(r => r.plazoCategoria === 'PARCIAL').length;
        const enFecha = total - atrasadas;
        const pctEnFecha = total > 0 ? Math.round((enFecha / total) * 100) : 100;

        const elCountAll = document.getElementById('erp-flow-count-all');
        const elRateBadge = document.getElementById('erp-flow-sla-rate-badge');
        const elScore = document.getElementById('erp-flow-sla-score');
        const elStatAlert = document.getElementById('erp-flow-stat-alert');
        const elStatWarn = document.getElementById('erp-flow-stat-warn');
        const elStatOk = document.getElementById('erp-flow-stat-ok');

        if (elCountAll) elCountAll.textContent = total;
        if (elRateBadge) {
            elRateBadge.textContent = `${pctEnFecha}% En Fecha`;
            elRateBadge.className = `badge ${atrasadas > 0 ? 'badge-sar-orange' : 'badge-sar-green'}`;
        }
        if (elScore) elScore.textContent = `${enFecha} / ${total}`;
        if (elStatAlert) elStatAlert.textContent = atrasadas;
        if (elStatWarn) elStatWarn.textContent = parciales;
        if (elStatOk) elStatOk.textContent = Math.max(0, total - atrasadas - parciales);

        // Renderizar Timeline Superior (Ref 2)
        if (timelineBar) {
            timelineBar.innerHTML = registros.map((r, idx) => {
                const dotClass = r.plazoCategoria === 'ATRASADO'
                    ? 'erp-dot--red'
                    : (r.plazoCategoria === 'PARCIAL' ? 'erp-dot--orange' : 'erp-dot--green');
                const code = r.oc ? r.oc.id : r.sdc.id;
                const fStr = formatearFechaCorta(r.fechaLimite);
                return `
                    <div class="erp-timeline-slot ${idx === 0 ? 'active' : ''}" data-flow-inspect-sdc="${r.sdc.id}" ${r.oc ? `data-flow-inspect-oc="${r.oc.id}"` : ''} title="Click para auditar ${code}">
                        <div style="display:flex; align-items:center; gap:5px;">
                            <span class="erp-dot ${dotClass}"></span>
                            <span class="erp-timeline-slot__date">${fStr}</span>
                        </div>
                        <span class="erp-timeline-slot__label">${code}</span>
                    </div>
                `;
            }).join('');
        }

        // Filtrar registros según botón activo
        const filtro = estadoMemoria.filtroFlujoSDC || 'ALL';
        const filtrados = registros.filter(r => {
            if (filtro === 'ALL') return true;
            if (filtro === 'EN_FECHA') return r.plazoCategoria !== 'ATRASADO';
            return r.plazoCategoria === filtro;
        });

        // Agrupar en las 4 etapas del nodo conectado
        const etapas = [
            {
                key: 'ETAPA_1',
                titulo: '1. Solicitud SDC',
                subtitulo: 'Detección & Firma',
                icon: 'ph-file-plus',
                colorClass: '',
                items: filtrados.filter(r => r.sdc.estado === ESTADOS_KANBAN.SDC_CREADA)
            },
            {
                key: 'ETAPA_2',
                titulo: '2. OC Publicada',
                subtitulo: 'Aceptación SLA 48h',
                icon: 'ph-megaphone',
                colorClass: '',
                items: filtrados.filter(r => r.sdc.estado === ESTADOS_KANBAN.PUBLICADA || r.sdc.estado === ESTADOS_KANBAN.OC_ACEPTADA)
            },
            {
                key: 'ETAPA_3',
                titulo: '3. Tránsito, SLA & Backorder',
                subtitulo: 'Seguimiento 5 Días / PARTIAL',
                icon: 'ph-truck',
                colorClass: 'erp-flow-stage--orange',
                items: filtrados.filter(r => r.sdc.estado === ESTADOS_KANBAN.EN_DESPACHO || r.sdc.estado === ESTADOS_KANBAN.PARTIAL)
            },
            {
                key: 'ETAPA_4',
                titulo: '4. En Bodega SAR',
                subtitulo: 'Recepción 100% Completada',
                icon: 'ph-check-circle',
                colorClass: 'erp-flow-stage--green',
                items: filtrados.filter(r => r.sdc.estado === ESTADOS_KANBAN.RECEPCIONADA)
            }
        ];

        canvas.innerHTML = etapas.map(etapa => {
            const cardsHTML = etapa.items.length > 0
                ? etapa.items.map(r => {
                    const cardStatusClass = r.plazoCategoria === 'ATRASADO'
                        ? 'erp-flow-node-card--alert'
                        : (r.plazoCategoria === 'PARCIAL' ? 'erp-flow-node-card--warn' : 'erp-flow-node-card--ok');
                    const badgeClass = r.plazoCategoria === 'ATRASADO'
                        ? 'badge-sar-red'
                        : (r.plazoCategoria === 'PARCIAL' ? 'badge-sar-partial' : 'badge-sar-green');
                    const badgeLabel = r.plazoCategoria === 'ATRASADO'
                        ? `FUERA DE FECHA (${r.sla.label})`
                        : ((r.estRec === 'PARTIAL' || r.estRec === 'PARCIAL') ? `PARTIAL ${r.pct}%` : 'EN FECHA (SLA OK)');
                    const code = r.oc ? r.oc.id : r.sdc.id;
                    const prov = r.oc ? r.oc.proveedor : `Analista: ${r.sdc.creador}`;

                    return `
                        <article class="erp-flow-node-card ${cardStatusClass}" data-flow-inspect-sdc="${r.sdc.id}" ${r.oc ? `data-flow-inspect-oc="${r.oc.id}"` : ''}>
                            <div class="erp-flow-node-card__top">
                                <span class="erp-flow-node-card__code">${code}</span>
                                <span class="badge ${badgeClass}" style="font-size:9.5px; padding:2px 6px;">${badgeLabel}</span>
                            </div>
                            <div class="erp-flow-node-card__title">${r.insumoPrincipal}</div>
                            <div class="erp-flow-node-card__meta">
                                <span><i class="ph ph-buildings"></i> ${prov}</span>
                                <span><i class="ph ph-calendar-blank"></i> Límite: ${formatearFechaCorta(r.fechaLimite)}</span>
                            </div>
                        </article>
                    `;
                }).join('')
                : `<div class="kanban-empty-slot" style="padding:18px 10px; font-size:11.5px; color:#94A3B8; text-align:center;"><i class="ph ph-check-circle"></i> Sin solicitudes en este nodo</div>`;

            return `
                <div class="erp-flow-stage ${etapa.colorClass}">
                    <div class="erp-flow-stage__header">
                        <div class="erp-flow-stage__pill">
                            <span class="erp-flow-stage__icon"><i class="ph-bold ${etapa.icon}"></i></span>
                            <div>
                                <div>${etapa.titulo}</div>
                                <div style="font-size:10px; color:#64748B; font-weight:600; text-transform:none;">${etapa.subtitulo}</div>
                            </div>
                        </div>
                        <span class="kanban-col__counter">${etapa.items.length}</span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        ${cardsHTML}
                    </div>
                </div>
            `;
        }).join('');

        // Renderizar Mini Barras de Cumplimiento (Ref 2)
        if (miniBars) {
            const dias = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Hoy'];
            const alturas = [72, 85, 78, 92, 65, 88, pctEnFecha];
            miniBars.innerHTML = dias.map((d, i) => `
                <div class="erp-flow-mini-bar-col">
                    <div class="erp-flow-mini-bar-fill" style="height:${Math.max(20, Math.min(100, alturas[i]))}%;"></div>
                    <span style="font-size:9.5px; color:#64748B; font-weight:700;">${d}</span>
                </div>
            `).join('');
        }

        // Renderizar Tabla Service Overview (Ref 2)
        if (overviewTbody) {
            overviewTbody.innerHTML = filtrados.map(r => {
                const code = r.oc ? `${r.oc.id} <span style="color:#94A3B8;">(${r.sdc.id})</span>` : r.sdc.id;
                const etapaNombre = r.sdc.estado === ESTADOS_KANBAN.SDC_CREADA
                    ? 'SDC Creada (Firma)'
                    : (r.sdc.estado === ESTADOS_KANBAN.PUBLICADA || r.sdc.estado === ESTADOS_KANBAN.OC_ACEPTADA
                        ? 'OC Publicada'
                        : (r.sdc.estado === ESTADOS_KANBAN.EN_DESPACHO ? 'En Tránsito (Proveedor)' : 'Recepcionada en Bodega'));
                const badgeClass = r.plazoCategoria === 'ATRASADO'
                    ? 'badge-sar-red'
                    : (r.plazoCategoria === 'PARCIAL' ? 'badge-sar-orange' : 'badge-sar-green');
                const badgeText = r.plazoCategoria === 'ATRASADO'
                    ? 'FUERA DE FECHA'
                    : (r.plazoCategoria === 'PARCIAL' ? 'PARCIAL / EN CURSO' : 'EN FECHA (OK)');

                return `
                    <tr>
                        <td style="font-family:monospace; font-weight:800; color:var(--sar-blue);">${code}</td>
                        <td style="font-weight:700;">${r.insumoPrincipal}</td>
                        <td style="font-size:11.5px; color:#475569;">Bodega SAR ➔ <strong>${etapaNombre}</strong></td>
                        <td style="font-family:monospace; font-size:11.5px;">${formatearFechaCorta(r.fechaLimite)} (${r.sla.label})</td>
                        <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                        <td style="text-align:right;">
                            <button type="button" class="erp-btn erp-btn--outline" style="padding:4px 10px; font-size:11px;" data-flow-inspect-sdc="${r.sdc.id}" ${r.oc ? `data-flow-inspect-oc="${r.oc.id}"` : ''}>
                                <i class="ph-bold ph-magnifying-glass"></i> Auditar
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        // Eventos click en nodos, timeline y tabla para abrir el Drawer/Auditoría
        document.querySelectorAll('[data-flow-inspect-sdc]').forEach(el => {
            el.addEventListener('click', () => {
                const sdcId = el.getAttribute('data-flow-inspect-sdc');
                const ocId = el.getAttribute('data-flow-inspect-oc');
                abrirDrawerDetalleKanban({ sdcId, ocId });
            });
        });
    }

    function renderizarCalendarioInicio() {
        const gridEl = document.getElementById('erp-calendar-days-grid');
        const labelMes = document.getElementById('erp-calendar-month-label');
        const feedList = document.getElementById('erp-calendar-events-list');
        const titleEl = document.getElementById('erp-cal-selected-date-title');
        const subEl = document.getElementById('erp-cal-selected-date-sub');
        if (!gridEl || !feedList) return;

        const nombresMeses = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];

        const anio = estadoMemoria.calendarioAnioActual;
        const mes = estadoMemoria.calendarioMesActual;
        if (labelMes) {
            labelMes.textContent = `${nombresMeses[mes]} ${anio}`;
        }

        const todosEventos = cargarEventosCalendario();
        const primerDiaMes = new Date(anio, mes, 1);
        const ultimoDiaMes = new Date(anio, mes + 1, 0);
        const totalDias = ultimoDiaMes.getDate();

        // Lunes = 0 ... Domingo = 6
        let offsetInicio = primerDiaMes.getDay() - 1;
        if (offsetInicio < 0) offsetInicio = 6;

        const hoyStr = new Date().toISOString().split('T')[0];
        const selStr = estadoMemoria.calendarioDiaSeleccionado || hoyStr;

        let htmlDias = '';
        for (let i = 0; i < offsetInicio; i++) {
            htmlDias += `<div class="erp-cal-day erp-cal-day--muted"></div>`;
        }

        for (let d = 1; d <= totalDias; d++) {
            const iso = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const evsDia = todosEventos.filter(ev => ev.date === iso);
            const isToday = iso === hoyStr;
            const isSelected = iso === selStr;

            const dotsHTML = evsDia.slice(0, 4).map(ev => {
                let color = 'var(--sar-blue)';
                if (ev.status === 'ATRASADO') color = 'var(--sar-red)';
                else if (ev.type === 'RECORDATORIO' || ev.type === 'AUDITORIA') color = 'var(--sar-yellow)';
                else if (ev.status === 'EN_FECHA') color = 'var(--sar-green)';
                return `<span class="erp-cal-day__dot" style="background:${color};"></span>`;
            }).join('');

            htmlDias += `
                <button type="button" class="erp-cal-day ${isToday ? 'erp-cal-day--today' : ''} ${isSelected ? 'erp-cal-day--selected' : ''}" data-cal-date="${iso}" title="${evsDia.length} evento(s) el ${iso}">
                    <span>${d}</span>
                    <div class="erp-cal-day__dots">${dotsHTML}</div>
                </button>
            `;
        }

        gridEl.innerHTML = htmlDias;

        // Bind click en cada día del calendario
        gridEl.querySelectorAll('.erp-cal-day[data-cal-date]').forEach(btn => {
            btn.addEventListener('click', () => {
                estadoMemoria.calendarioDiaSeleccionado = btn.getAttribute('data-cal-date');
                estadoMemoria.calendarioModoVista = 'DAY';
                const btnDay = document.getElementById('btn-erp-cal-view-day');
                const btnAll = document.getElementById('btn-erp-cal-view-all');
                if (btnDay && btnAll) {
                    btnDay.className = 'erp-btn erp-btn--primary';
                    btnAll.className = 'erp-btn erp-btn--outline';
                }
                renderizarCalendarioInicio();
            });
        });

        // Filtrar lista derecha según modo ('DAY' vs 'ALL')
        const prefijoMes = `${anio}-${String(mes + 1).padStart(2, '0')}`;
        let eventosMostrar = [];
        if (estadoMemoria.calendarioModoVista === 'DAY') {
            eventosMostrar = todosEventos.filter(ev => ev.date === selStr);
            if (titleEl) titleEl.textContent = `Agenda Operativa del Día (${selStr.split('-').reverse().join('/')})`;
            if (subEl) subEl.textContent = `${eventosMostrar.length} hito(s) programados para esta fecha`;
        } else {
            eventosMostrar = todosEventos.filter(ev => ev.date && ev.date.startsWith(prefijoMes));
            if (eventosMostrar.length === 0) eventosMostrar = todosEventos;
            if (titleEl) titleEl.textContent = `Bitácora de Envíos, Plazos SDC y Recordatorios (${nombresMeses[mes]})`;
            if (subEl) subEl.textContent = `Mostrando todos los envíos agendados y verificación de solicitudes en fecha`;
        }

        if (eventosMostrar.length === 0) {
            feedList.innerHTML = `
                <div style="padding:28px 16px; text-align:center; color:#64748B; background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:var(--shape-card);">
                    <i class="ph ph-calendar-blank" style="font-size:26px; color:var(--sar-blue); display:block; margin-bottom:6px;"></i>
                    <div style="font-weight:700; color:#334155;">No hay envíos ni recordatorios agendados en esta fecha</div>
                    <div style="font-size:11.5px; margin-top:4px;">Usa el botón <strong>"+ Agendar Envío / Recepción"</strong> o cambia a <strong>"Ver Todo el Mes"</strong>.</div>
                </div>
            `;
            return;
        }

        const escCal = (v) => (typeof window.escapeHTML === 'function' ? window.escapeHTML(v) : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
        feedList.innerHTML = eventosMostrar.map(ev => {
            const itemClass = ev.status === 'ATRASADO'
                ? 'erp-cal-event-item--alert'
                : (ev.type === 'RECORDATORIO' || ev.type === 'AUDITORIA' ? 'erp-cal-event-item--warn' : 'erp-cal-event-item--ok');

            const badgeClass = ev.status === 'ATRASADO'
                ? 'badge-sar-red'
                : (ev.status === 'EN_FECHA' ? 'badge-sar-green' : 'badge-sar-yellow');

            const badgeLabel = ev.status === 'ATRASADO'
                ? 'FUERA DE FECHA (SLA)'
                : (ev.status === 'EN_FECHA' ? 'EN FECHA (OK)' : 'PROGRAMADO');

            const fechaCorta = ev.date ? ev.date.split('-').reverse().slice(0, 2).join('/') : '--';

            return `
                <div class="erp-cal-event-item ${itemClass}">
                    <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span style="font-family:monospace; font-size:11px; font-weight:800; background:#E2E8F0; color:#1E293B; padding:2px 6px; border-radius:4px;">
                                <i class="ph-bold ph-calendar"></i> ${fechaCorta}
                            </span>
                            ${ev.refId ? `<span style="font-family:monospace; font-size:11px; font-weight:800; color:var(--sar-blue);">${escCal(ev.refId)}</span>` : ''}
                            <span class="badge ${badgeClass}" style="font-size:9.5px; padding:2px 7px;">${badgeLabel}</span>
                        </div>
                        <div style="font-size:13px; font-weight:800; color:#0F172A;">${escCal(ev.title)}</div>
                        <div style="font-size:11.5px; color:#64748B;">
                            <strong>Responsable:</strong> ${escCal(ev.responsable || 'Bodega SAR')} ${ev.notes ? `• ${escCal(ev.notes)}` : ''}
                        </div>
                    </div>
                    <div>
                        ${ev.sdcId ? `
                            <button type="button" class="erp-btn erp-btn--outline" style="padding:5px 10px; font-size:11px;" data-cal-open-sdc="${escCal(ev.sdcId)}" ${ev.refId && ev.refId.startsWith('OC-') ? `data-cal-open-oc="${escCal(ev.refId)}"` : ''}>
                                Ver Flujo
                            </button>
                        ` : `
                            <span class="badge badge-sar-blue" style="font-size:9.5px;">Agenda SAR</span>
                        `}
                    </div>
                </div>
            `;
        }).join('');

        feedList.querySelectorAll('[data-cal-open-sdc]').forEach(btn => {
            btn.addEventListener('click', () => {
                abrirDrawerDetalleKanban({
                    sdcId: btn.getAttribute('data-cal-open-sdc'),
                    ocId: btn.getAttribute('data-cal-open-oc')
                });
            });
        });
    }

    function inicializarControlesCalendarioYFlujo() {
        // Filtros del Mapa de Flujo SDC
        document.querySelectorAll('.erp-flow-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.erp-flow-filter-btn').forEach(b => {
                    b.classList.remove('erp-btn--primary');
                    b.classList.add('erp-btn--outline');
                });
                btn.classList.remove('erp-btn--outline');
                btn.classList.add('erp-btn--primary');
                estadoMemoria.filtroFlujoSDC = btn.getAttribute('data-flow-filter') || 'ALL';
                renderizarFlujoTopologiaSDC();
            });
        });

        // Controles de Mes del Calendario
        const btnPrev = document.getElementById('btn-erp-cal-prev');
        const btnNext = document.getElementById('btn-erp-cal-next');
        const btnToday = document.getElementById('btn-erp-cal-today');
        const btnViewDay = document.getElementById('btn-erp-cal-view-day');
        const btnViewAll = document.getElementById('btn-erp-cal-view-all');

        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                estadoMemoria.calendarioMesActual--;
                if (estadoMemoria.calendarioMesActual < 0) {
                    estadoMemoria.calendarioMesActual = 11;
                    estadoMemoria.calendarioAnioActual--;
                }
                renderizarCalendarioInicio();
            });
        }
        if (btnNext) {
            btnNext.addEventListener('click', () => {
                estadoMemoria.calendarioMesActual++;
                if (estadoMemoria.calendarioMesActual > 11) {
                    estadoMemoria.calendarioMesActual = 0;
                    estadoMemoria.calendarioAnioActual++;
                }
                renderizarCalendarioInicio();
            });
        }
        if (btnToday) {
            btnToday.addEventListener('click', () => {
                const now = new Date();
                estadoMemoria.calendarioMesActual = now.getMonth();
                estadoMemoria.calendarioAnioActual = now.getFullYear();
                estadoMemoria.calendarioDiaSeleccionado = now.toISOString().split('T')[0];
                estadoMemoria.calendarioModoVista = 'ALL';
                renderizarCalendarioInicio();
            });
        }
        if (btnViewDay && btnViewAll) {
            btnViewDay.addEventListener('click', () => {
                estadoMemoria.calendarioModoVista = 'DAY';
                btnViewDay.className = 'erp-btn erp-btn--primary';
                btnViewAll.className = 'erp-btn erp-btn--outline';
                renderizarCalendarioInicio();
            });
            btnViewAll.addEventListener('click', () => {
                estadoMemoria.calendarioModoVista = 'ALL';
                btnViewAll.className = 'erp-btn erp-btn--primary';
                btnViewDay.className = 'erp-btn erp-btn--outline';
                renderizarCalendarioInicio();
            });
        }

        // Modal de Agendar Envío / Recordatorio
        const modalCal = document.getElementById('erp-calendar-modal-overlay');
        const btnOpenEnvio = document.getElementById('btn-erp-open-modal-envio');
        const btnOpenRec = document.getElementById('btn-erp-open-modal-recordatorio');
        const btnCloseCal = document.getElementById('btn-erp-close-cal-modal');
        const btnCancelCal = document.getElementById('btn-erp-cancel-cal-modal');
        const formCal = document.getElementById('form-erp-calendar-event');

        const abrirModalCalendario = (tipoInicial) => {
            if (!modalCal) return;
            const selectTipo = document.getElementById('erp-cal-event-type');
            const inputDate = document.getElementById('erp-cal-event-date');
            if (selectTipo && tipoInicial) selectTipo.value = tipoInicial;
            if (inputDate) inputDate.value = estadoMemoria.calendarioDiaSeleccionado || new Date().toISOString().split('T')[0];
            modalCal.classList.add('active');
        };

        const cerrarModalCalendario = () => {
            if (modalCal) modalCal.classList.remove('active');
        };

        if (btnOpenEnvio) btnOpenEnvio.addEventListener('click', () => abrirModalCalendario('ENVIO'));
        if (btnOpenRec) btnOpenRec.addEventListener('click', () => abrirModalCalendario('RECORDATORIO'));
        if (btnCloseCal) btnCloseCal.addEventListener('click', cerrarModalCalendario);
        if (btnCancelCal) btnCancelCal.addEventListener('click', cerrarModalCalendario);

        if (formCal) {
            formCal.addEventListener('submit', (e) => {
                e.preventDefault();
                const type = document.getElementById('erp-cal-event-type')?.value || 'ENVIO';
                const date = document.getElementById('erp-cal-event-date')?.value || new Date().toISOString().split('T')[0];
                const title = document.getElementById('erp-cal-event-title')?.value.trim() || 'Hito Logístico';
                const refId = document.getElementById('erp-cal-event-ref')?.value.trim() || '';
                const responsable = document.getElementById('erp-cal-event-resp')?.value.trim() || 'Operador SAR';
                const notes = document.getElementById('erp-cal-event-notes')?.value.trim() || '';

                guardarEventoCalendarioUsuario({
                    id: 'CAL-USR-' + Date.now(),
                    type,
                    date,
                    title,
                    refId,
                    sdcId: refId.startsWith('SDC-') ? refId : '',
                    responsable,
                    notes,
                    status: 'EN_FECHA'
                });

                estadoMemoria.calendarioDiaSeleccionado = date;
                estadoMemoria.calendarioModoVista = 'DAY';
                formCal.reset();
                cerrarModalCalendario();
                renderizarCalendarioInicio();
                notificarERP('Agenda Actualizada', `Se agendó "${title}" para el ${date.split('-').reverse().join('/')}.`, 'success');
            });
        }
    }

    // =========================================================================
    // 9. FLUJO DE BANDEJAS DE TURNO (BODEGA ➔ TURNO ➔ RETORNO) E INSPECTOR
    // =========================================================================
    const BANDEJAS_DEMO_OPERATIVAS = [
        {
            id: 'BAN-DEMO-01',
            tracking: 'BAN-2026-0841',
            identificador: 'Bandeja 1 (Urgencias)',
            numeroBandeja: 'Bandeja 1',
            plantillaBase: 'Kit Estándar Urgencias SAR',
            estado: 'EN_USO',
            turnoAsignado: 'Turno Diurno A (08:00 - 20:00)',
            enfermeroAsignado: 'enf.camila.soto@sar.cl',
            creador: 'bodega.central@sar.cl',
            fechaDespachoStr: 'Hoy, 08:05 hrs',
            fechaRecepcionStr: 'Hoy, 08:14 hrs',
            medicamentos: [
                {
                    nombreInsumo: 'KETOROLACO 30 MG/ML AMPOLLA',
                    cantidadAsignada: 20,
                    cantidadRecibida: 18,
                    cantidadConsumida: 6,
                    cantidadMerma: 1,
                    observacion: 'Recorte al recibir: Se entregaron 18 ampollas por stock físico en estante.',
                    observacionAdicional: '(+4) Consumo | (+2) Consumo | (+1) Quiebre por preparación (Ampolla trizada)'
                },
                {
                    nombreInsumo: 'PARACETAMOL 500 MG COMPRIMIDO',
                    cantidadAsignada: 50,
                    cantidadRecibida: 50,
                    cantidadConsumida: 12,
                    cantidadMerma: 0,
                    observacion: '',
                    observacionAdicional: '(+12) Consumo'
                },
                {
                    nombreInsumo: 'ONDANSETRÓN 4 MG/2ML AMPOLLA',
                    cantidadAsignada: 15,
                    cantidadRecibida: 15,
                    cantidadConsumida: 3,
                    cantidadMerma: 1,
                    observacion: '',
                    observacionAdicional: '(+3) Consumo | (+1) Precipitado detectado en jeringa'
                }
            ]
        },
        {
            id: 'BAN-DEMO-02',
            tracking: 'BAN-2026-0842',
            identificador: 'Bandeja 2 (Reanimación / Box)',
            numeroBandeja: 'Bandeja 2',
            plantillaBase: 'Kit Reanimación y Vía Aérea',
            estado: 'CREADA',
            turnoAsignado: 'Turno Vespertino B (Por Iniciar)',
            enfermeroAsignado: 'enf.rodrigo.vega@sar.cl',
            creador: 'bodega.central@sar.cl',
            fechaDespachoStr: 'Hoy, 08:30 hrs',
            fechaRecepcionStr: 'Pendiente aceptación enfermería',
            medicamentos: [
                {
                    nombreInsumo: 'ADRENALINA 1 MG/ML AMPOLLA',
                    cantidadAsignada: 10,
                    cantidadRecibida: 10,
                    cantidadConsumida: 0,
                    cantidadMerma: 0,
                    observacion: ''
                },
                {
                    nombreInsumo: 'SUERO FISIOLÓGICO 0.9% 500 ML',
                    cantidadAsignada: 12,
                    cantidadRecibida: 12,
                    cantidadConsumida: 0,
                    cantidadMerma: 0,
                    observacion: ''
                }
            ]
        },
        {
            id: 'BAN-DEMO-03',
            tracking: 'BAN-2026-0839',
            identificador: 'Bandeja 3 (Observación)',
            numeroBandeja: 'Bandeja 3',
            plantillaBase: 'Kit Observación Adulto/Pediátrico',
            estado: 'EN_RECEPCION',
            turnoAsignado: 'Turno Nocturno Saliente',
            enfermeroAsignado: 'enf.patricia.morales@sar.cl',
            creador: 'bodega.central@sar.cl',
            fechaDespachoStr: 'Ayer, 20:00 hrs',
            fechaRecepcionStr: 'Ayer, 20:10 hrs',
            fechaCruceStr: 'Hoy, 07:55 hrs',
            cruceCierreTurno: [
                { nombreInsumo: 'SALBUTAMOL INHALADOR 100 MCG', usoVisor: 4, usoRayen: 3, coincide: false, justificacion: '1 puff de prueba técnica por válvula obstruida' }
            ],
            medicamentos: [
                {
                    nombreInsumo: 'SALBUTAMOL INHALADOR 100 MCG',
                    cantidadAsignada: 8,
                    cantidadRecibida: 8,
                    cantidadConsumida: 4,
                    cantidadMerma: 0,
                    observacion: '',
                    observacionAdicional: '(+4) Consumo y prueba de válvula (Diferencia RAYEN justificada)'
                },
                {
                    nombreInsumo: 'METAMIZOL SÓDICO 1G/2ML AMPOLLA',
                    cantidadAsignada: 20,
                    cantidadRecibida: 20,
                    cantidadConsumida: 9,
                    cantidadMerma: 0,
                    observacion: ''
                }
            ]
        },
        {
            id: 'BAN-DEMO-04',
            tracking: 'BAN-2026-0835',
            identificador: 'Bandeja 1 (Ciclo Anterior)',
            numeroBandeja: 'Bandeja 1',
            plantillaBase: 'Kit Estándar Urgencias SAR',
            estado: 'CERRADA_FINAL',
            turnoAsignado: 'Turno Diurno Anterior (Cerrado)',
            enfermeroAsignado: 'enf.juan.perez@sar.cl',
            creador: 'bodega.central@sar.cl',
            operadorReceptor: 'bodega.central@sar.cl',
            fechaDespachoStr: 'Ayer, 08:00 hrs',
            fechaRecepcionStr: 'Ayer, 08:12 hrs',
            fechaRetornoStr: 'Ayer, 20:05 hrs',
            medicamentos: [
                {
                    nombreInsumo: 'PARACETAMOL 500 MG COMPRIMIDO',
                    cantidadAsignada: 50,
                    cantidadRecibida: 50,
                    cantidadConsumida: 18,
                    cantidadMerma: 0,
                    cantidadRetornadaOperador: 32,
                    observacion: ''
                }
            ]
        }
    ];

    estadoMemoria.bandejasFlujoCache = [...BANDEJAS_DEMO_OPERATIVAS];

    function analizarAnomaliasBandeja(bandeja) {
        const meds = Array.isArray(bandeja.medicamentos) ? bandeja.medicamentos : [];
        let totalAsignado = 0;
        let totalRecibido = 0;
        let totalConsumido = 0;
        let totalMerma = 0;
        let recortesEntrega = [];
        let mermasYDesmedros = [];
        let diferenciasRayen = [];

        meds.forEach(m => {
            const nombre = m.nombreInsumo || m.nombre || 'Fármaco';
            const asig = Number(m.cantidadAsignada ?? 0);
            const rec = Number(m.cantidadRecibida !== undefined ? m.cantidadRecibida : asig);
            const cons = Number(m.cantidadConsumida ?? 0);
            const merma = Number(m.cantidadMerma ?? 0);

            totalAsignado += asig;
            totalRecibido += rec;
            totalConsumido += cons;
            totalMerma += merma;

            if (rec < asig) {
                recortesEntrega.push({
                    nombre,
                    diferencia: asig - rec,
                    motivo: m.observacion || 'Recorte registrado al recibir bandeja en turno'
                });
            }

            const obsAdic = String(m.observacionAdicional || '');
            const tieneIncidenciaTexto = /quiebre|precipitado|contaminaci|rechazo|imposible|merma|rota|trizada/i.test(obsAdic);
            if (merma > 0 || tieneIncidenciaTexto) {
                mermasYDesmedros.push({
                    nombre,
                    merma,
                    detalle: obsAdic || m.observacionOperador || 'Desmedro / anomalía reportada en turno'
                });
            }
        });

        if (Array.isArray(bandeja.cruceCierreTurno)) {
            bandeja.cruceCierreTurno.forEach(c => {
                if (c && c.coincide === false) {
                    diferenciasRayen.push({
                        nombre: c.nombreInsumo,
                        usoVisor: c.usoVisor,
                        usoRayen: c.usoRayen,
                        justificacion: c.justificacion || 'Sin justificación'
                    });
                }
            });
        }

        const tieneAnomalia = recortesEntrega.length > 0 || mermasYDesmedros.length > 0 || diferenciasRayen.length > 0 || bandeja.estado === 'ANULADA';
        const saldoActual = Math.max(0, totalRecibido - totalConsumido - totalMerma);

        return {
            totalAsignado,
            totalRecibido,
            totalConsumido,
            totalMerma,
            saldoActual,
            recortesEntrega,
            mermasYDesmedros,
            diferenciasRayen,
            tieneAnomalia
        };
    }

    function renderizarFlujoBandejasTurno() {
        const canvas = document.getElementById('bandejas-node-flow-canvas');
        if (!canvas) return;

        const lista = estadoMemoria.bandejasFlujoCache || BANDEJAS_DEMO_OPERATIVAS;
        const conAnomalias = lista.filter(b => analizarAnomaliasBandeja(b).tieneAnomalia);

        const elAll = document.getElementById('tray-flow-count-all');
        const elAnom = document.getElementById('tray-flow-count-anomalias');
        if (elAll) elAll.textContent = lista.length;
        if (elAnom) elAnom.textContent = conAnomalias.length;

        const cSalida = lista.filter(b => b.estado === 'CREADA').length;
        const cTurno = lista.filter(b => b.estado === 'EN_USO').length;
        const cRetorno = lista.filter(b => ['EN_RECEPCION', 'CERRADA_ENFERMERIA'].includes(b.estado)).length;
        const cCerradas = lista.filter(b => ['CERRADA_FINAL', 'CERRADA_BODEGA'].includes(b.estado)).length;

        const elStatSalida = document.getElementById('tray-stat-salida');
        const elStatTurno = document.getElementById('tray-stat-turno');
        const elStatRetorno = document.getElementById('tray-stat-retorno');
        const elStatCerradas = document.getElementById('tray-stat-cerradas');
        if (elStatSalida) elStatSalida.textContent = cSalida;
        if (elStatTurno) elStatTurno.textContent = cTurno;
        if (elStatRetorno) elStatRetorno.textContent = cRetorno;
        if (elStatCerradas) elStatCerradas.textContent = cCerradas;

        const filtro = estadoMemoria.filtroBandejaFlujo || 'ALL';
        const filtradas = lista.filter(b => {
            if (filtro === 'EN_TURNO') return b.estado === 'EN_USO';
            if (filtro === 'CON_ANOMALIA') return analizarAnomaliasBandeja(b).tieneAnomalia;
            return true;
        });

        const etapasBandeja = [
            {
                titulo: '1. Salida de Bodega',
                subtitulo: 'Armada y Asignada a Turno',
                icon: 'ph-package',
                colorClass: '',
                items: filtradas.filter(b => b.estado === 'CREADA')
            },
            {
                titulo: '2. En Turno Clínico',
                subtitulo: 'Dispensación, Recortes y Mermas',
                icon: 'ph-stethoscope',
                colorClass: 'erp-flow-stage--orange',
                items: filtradas.filter(b => b.estado === 'EN_USO')
            },
            {
                titulo: '3. En Retorno / Cruce',
                subtitulo: 'Cuadratura RAYEN & Devolución',
                icon: 'ph-scales',
                colorClass: '',
                items: filtradas.filter(b => ['EN_RECEPCION', 'CERRADA_ENFERMERIA'].includes(b.estado))
            },
            {
                titulo: '4. Reintegrada a Bodega',
                subtitulo: 'Stock Devuelto y Ciclo Cerrado',
                icon: 'ph-check-circle',
                colorClass: 'erp-flow-stage--green',
                items: filtradas.filter(b => ['CERRADA_FINAL', 'CERRADA_BODEGA', 'ANULADA'].includes(b.estado))
            }
        ];

        canvas.innerHTML = etapasBandeja.map(etapa => {
            const cardsHTML = etapa.items.length > 0
                ? etapa.items.map(b => {
                    const info = analizarAnomaliasBandeja(b);
                    const cardClass = info.tieneAnomalia
                        ? 'erp-flow-node-card--alert'
                        : (b.estado === 'EN_USO' ? 'erp-flow-node-card--warn' : 'erp-flow-node-card--ok');

                    const tagsAnomalia = [];
                    if (info.recortesEntrega.length > 0) {
                        tagsAnomalia.push(`<span class="badge badge-sar-orange" style="font-size:9px; padding:2px 5px;">✂️ Recorte (-${info.totalAsignado - info.totalRecibido} u.)</span>`);
                    }
                    if (info.mermasYDesmedros.length > 0) {
                        tagsAnomalia.push(`<span class="badge badge-sar-red" style="font-size:9px; padding:2px 5px;">⚠️ Desmedro / Anomalía</span>`);
                    }
                    if (info.diferenciasRayen.length > 0) {
                        tagsAnomalia.push(`<span class="badge badge-sar-red" style="font-size:9px; padding:2px 5px;">📊 Dif. RAYEN</span>`);
                    }
                    if (tagsAnomalia.length === 0) {
                        tagsAnomalia.push(`<span class="badge badge-sar-green" style="font-size:9px; padding:2px 5px;">✓ Sin Anomalías</span>`);
                    }

                    const turnoText = b.turnoAsignado || 'Turno Clínico Activo';
                    const enfText = b.enfermeroAsignado || 'Sin Asignar';

                    return `
                        <article class="erp-flow-node-card ${cardClass}" data-inspect-tray-id="${b.id}">
                            <div class="erp-flow-node-card__top">
                                <span class="erp-flow-node-card__code">${b.tracking || b.identificador || b.id}</span>
                                <span style="font-size:10px; font-weight:800; color:var(--sar-blue);">${b.numeroBandeja || 'Bandeja'}</span>
                            </div>
                            <div class="erp-flow-node-card__title">${b.identificador || b.plantillaBase || 'Kit Clínico'}</div>
                            <div style="font-size:11px; color:#334155; font-weight:700;">
                                <i class="ph-fill ph-user-circle" style="color:var(--sar-blue);"></i> ${enfText}
                            </div>
                            <div style="font-size:10.5px; color:#64748B;">
                                <i class="ph ph-clock"></i> ${turnoText}
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center; background:#F8FAFC; padding:5px 8px; border-radius:4px; border:1px solid #E2E8F0; font-size:10.5px; margin-top:2px;">
                                <span>Entregado: <strong>${info.totalAsignado}</strong></span>
                                <span>Usado: <strong style="color:var(--sar-red);">-${info.totalConsumido + info.totalMerma}</strong></span>
                                <span>Saldo: <strong style="color:var(--sar-green);">${info.saldoActual}</strong></span>
                            </div>
                            <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:2px;">
                                ${tagsAnomalia.join('')}
                            </div>
                        </article>
                    `;
                }).join('')
                : `<div class="kanban-empty-slot" style="padding:18px 10px; font-size:11.5px; color:#94A3B8; text-align:center;"><i class="ph ph-tray"></i> Sin bandejas en esta etapa</div>`;

            return `
                <div class="erp-flow-stage ${etapa.colorClass}">
                    <div class="erp-flow-stage__header">
                        <div class="erp-flow-stage__pill">
                            <span class="erp-flow-stage__icon"><i class="ph-bold ${etapa.icon}"></i></span>
                            <div>
                                <div>${etapa.titulo}</div>
                                <div style="font-size:10px; color:#64748B; font-weight:600; text-transform:none;">${etapa.subtitulo}</div>
                            </div>
                        </div>
                        <span class="kanban-col__counter">${etapa.items.length}</span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        ${cardsHTML}
                    </div>
                </div>
            `;
        }).join('');

        canvas.querySelectorAll('[data-inspect-tray-id]').forEach(card => {
            card.addEventListener('click', () => {
                const trayId = card.getAttribute('data-inspect-tray-id');
                abrirInspectorBandejaFlujo(trayId);
            });
        });
    }

    function abrirInspectorBandejaFlujo(trayId) {
        const modal = document.getElementById('modal-inspector-bandeja-flujo');
        const body = document.getElementById('inspector-bandeja-body');
        const title = document.getElementById('inspector-bandeja-title');
        const subtitle = document.getElementById('inspector-bandeja-subtitle');
        const badge = document.getElementById('inspector-bandeja-estado-badge');
        const actions = document.getElementById('inspector-bandeja-actions');
        if (!modal || !body) return;

        const bandeja = (estadoMemoria.bandejasFlujoCache || []).find(b => b.id === trayId) || BANDEJAS_DEMO_OPERATIVAS[0];
        if (!bandeja) return;

        const info = analizarAnomaliasBandeja(bandeja);
        const tracking = bandeja.tracking || bandeja.identificador || bandeja.id;

        if (title) title.textContent = `Trazabilidad de Bandeja: ${tracking} (${bandeja.numeroBandeja || 'Bandeja'})`;
        if (subtitle) {
            subtitle.textContent = `Asignada a: ${bandeja.enfermeroAsignado || 'Sin asignar'} • ${bandeja.turnoAsignado || 'Turno Clínico'} • Kit: ${bandeja.plantillaBase || 'Estándar'}`;
        }
        if (badge) {
            badge.textContent = bandeja.estado;
            badge.className = `badge ${info.tieneAnomalia ? 'badge-sar-red' : (bandeja.estado === 'EN_USO' ? 'badge-sar-orange' : 'badge-sar-green')}`;
        }

        // Bloques de alerta si hubo recortes, desmedros o descuadres
        let alertasHTML = '';
        if (info.recortesEntrega.length > 0 || info.mermasYDesmedros.length > 0 || info.diferenciasRayen.length > 0) {
            alertasHTML = `
                <div style="background:#FFF5F5; border:1px solid #FECACA; border-left:4px solid var(--sar-red); border-radius:var(--shape-card); padding:14px 16px;">
                    <div style="font-size:13px; font-weight:800; color:var(--sar-red); margin-bottom:8px; display:flex; align-items:center; gap:6px;">
                        <i class="ph-fill ph-warning-octagon" style="font-size:18px;"></i>
                        Modificaciones de Stock, Recortes o Anomalías Detectadas en el Flujo
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px; font-size:12px; color:#1E293B;">
                        ${info.recortesEntrega.map(r => `
                            <div>• <strong>✂️ Recorte en Entrega (${r.nombre}):</strong> Se descontaron <strong>-${r.diferencia} u.</strong> respecto a la carga original (${r.motivo}).</div>
                        `).join('')}
                        ${info.mermasYDesmedros.map(m => `
                            <div>• <strong>⚠️ Desmedro / Incidencia en Turno (${m.nombre}):</strong> ${m.detalle}.</div>
                        `).join('')}
                        ${info.diferenciasRayen.map(d => `
                            <div>• <strong>📊 Diferencia Cruce RAYEN (${d.nombre}):</strong> Uso Visor: ${d.usoVisor} vs RAYEN: ${d.usoRayen} — Justificación: <em>${d.justificacion}</em>.</div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else {
            alertasHTML = `
                <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-left:4px solid var(--sar-green); border-radius:var(--shape-card); padding:12px 16px; font-size:12.5px; color:#166534; font-weight:700;">
                    <i class="ph-fill ph-check-circle"></i> Bandeja íntegra: Sin recortes de entrega, mermas ni anomalías registradas hasta el momento.
                </div>
            `;
        }

        const meds = Array.isArray(bandeja.medicamentos) ? bandeja.medicamentos : [];
        const filasMeds = meds.map((m, idx) => {
            const nombre = m.nombreInsumo || m.nombre || 'Fármaco';
            const asig = Number(m.cantidadAsignada ?? 0);
            const rec = Number(m.cantidadRecibida !== undefined ? m.cantidadRecibida : asig);
            const recorte = asig - rec;
            const cons = Number(m.cantidadConsumida ?? 0);
            const merma = Number(m.cantidadMerma ?? 0);
            const saldo = Math.max(0, rec - cons - merma);
            const obs = [m.observacion, m.observacionAdicional, m.observacionOperador].filter(Boolean).join(' | ');

            return `
                <tr style="${recorte > 0 || merma > 0 ? 'background:#FFFBEB;' : ''}">
                    <td>
                        <div style="font-weight:800; color:#0F172A;">${nombre}</div>
                    </td>
                    <td style="text-align:center; font-weight:800;">${asig}</td>
                    <td style="text-align:center; font-weight:800; color:${recorte > 0 ? 'var(--sar-orange)' : '#1E293B'};">
                        ${rec} ${recorte > 0 ? `<span class="badge badge-sar-orange" style="font-size:9px;">Recorte -${recorte}</span>` : ''}
                    </td>
                    <td style="text-align:center; font-weight:800; color:var(--sar-blue);">${cons > 0 ? `-${cons}` : '0'}</td>
                    <td style="text-align:center; font-weight:800; color:${merma > 0 ? 'var(--sar-red)' : '#64748B'};">${merma > 0 ? `-${merma}` : '0'}</td>
                    <td style="text-align:center; font-weight:900; color:var(--sar-green); font-size:14px;">${saldo}</td>
                    <td style="font-size:11.5px; color:#475569;">
                        ${obs || '<span style="color:#94A3B8;">Sin observaciones</span>'}
                    </td>
                </tr>
            `;
        }).join('');

        body.innerHTML = `
            <!-- Línea de tiempo de las 4 etapas del ciclo cerrado -->
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px;">
                <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-top:3px solid var(--sar-blue); padding:12px; border-radius:var(--shape-card);">
                    <div style="font-size:10.5px; font-weight:800; color:var(--sar-blue); text-transform:uppercase;">1. Salida de Bodega</div>
                    <div style="font-size:12.5px; font-weight:800; color:#0F172A; margin-top:4px;">${bandeja.creador || 'Operador Bodega'}</div>
                    <div style="font-size:11px; color:#64748B; margin-top:2px;">${bandeja.fechaDespachoStr || 'Despachada'}</div>
                </div>
                <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-top:3px solid ${info.recortesEntrega.length > 0 ? 'var(--sar-orange)' : 'var(--sar-green)'}; padding:12px; border-radius:var(--shape-card);">
                    <div style="font-size:10.5px; font-weight:800; color:var(--sar-blue); text-transform:uppercase;">2. Recepción en Turno</div>
                    <div style="font-size:12.5px; font-weight:800; color:#0F172A; margin-top:4px;">${bandeja.enfermeroAsignado || 'Enfermería'}</div>
                    <div style="font-size:11px; color:#64748B; margin-top:2px;">${info.recortesEntrega.length > 0 ? `Con recorte (-${info.totalAsignado - info.totalRecibido} u.)` : 'Recibida 100% conforme'}</div>
                </div>
                <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-top:3px solid ${info.mermasYDesmedros.length > 0 ? 'var(--sar-red)' : 'var(--sar-blue)'}; padding:12px; border-radius:var(--shape-card);">
                    <div style="font-size:10.5px; font-weight:800; color:var(--sar-blue); text-transform:uppercase;">3. Estado en Turno</div>
                    <div style="font-size:12.5px; font-weight:800; color:#0F172A; margin-top:4px;">Consumo: ${info.totalConsumido} u. | Merma: ${info.totalMerma} u.</div>
                    <div style="font-size:11px; color:#64748B; margin-top:2px;">Saldo físico activo: <strong>${info.saldoActual} u.</strong></div>
                </div>
                <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-top:3px solid ${['CERRADA_FINAL', 'CERRADA_BODEGA'].includes(bandeja.estado) ? 'var(--sar-green)' : '#CBD5E1'}; padding:12px; border-radius:var(--shape-card);">
                    <div style="font-size:10.5px; font-weight:800; color:var(--sar-blue); text-transform:uppercase;">4. Retorno a Bodega</div>
                    <div style="font-size:12.5px; font-weight:800; color:#0F172A; margin-top:4px;">${['CERRADA_FINAL', 'CERRADA_BODEGA'].includes(bandeja.estado) ? 'Reintegrada a Stock' : (bandeja.estado === 'EN_RECEPCION' ? 'Pendiente Cuadre Bodega' : 'En Turno Activo')}</div>
                    <div style="font-size:11px; color:#64748B; margin-top:2px;">${bandeja.fechaRetornoStr || bandeja.fechaCruceStr || 'Al finalizar turno'}</div>
                </div>
            </div>

            ${alertasHTML}

            <!-- Tabla de Auditoría de Fármacos de la Bandeja -->
            <div class="erp-table-scroll" style="border:1px solid #E2E8F0; border-radius:var(--shape-card);">
                <table class="erp-flow-overview-table">
                    <thead>
                        <tr>
                            <th>Fármaco / Insumo & Pacientes</th>
                            <th style="text-align:center;">Entregado Bodega</th>
                            <th style="text-align:center;">Recibido Turno (Recorte)</th>
                            <th style="text-align:center;">Consumo Turno</th>
                            <th style="text-align:center;">Desmedro / Merma</th>
                            <th style="text-align:center;">Saldo Actual</th>
                            <th>Registro de Anomalías / Observaciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filasMeds}
                    </tbody>
                </table>
            </div>
        `;

        if (actions) {
            const isRealFirestoreDoc = !String(bandeja.id).startsWith('BAN-DEMO-');
            let btns = '';
            if (isRealFirestoreDoc && bandeja.estado === 'EN_USO' && typeof window.abrirModalCuadratura === 'function') {
                btns += `
                    <button type="button" class="erp-btn erp-btn--warning" onclick="document.getElementById('modal-inspector-bandeja-flujo').classList.remove('active'); window.abrirModalCuadratura('${bandeja.id}', '${tracking}');">
                        <i class="ph-bold ph-scales"></i> Terminar Turno y Cuadrar RAYEN
                    </button>
                `;
            }
            if (isRealFirestoreDoc && bandeja.estado === 'EN_RECEPCION' && typeof window.abrirRecepcionOperador === 'function') {
                btns += `
                    <button type="button" class="erp-btn erp-btn--primary" onclick="document.getElementById('modal-inspector-bandeja-flujo').classList.remove('active'); window.abrirRecepcionOperador('${bandeja.id}');">
                        <i class="ph-bold ph-check-circle"></i> Recibir y Cuadrar en Bodega
                    </button>
                `;
            }
            btns += `
                <button type="button" class="erp-btn erp-btn--outline" onclick="document.getElementById('modal-inspector-bandeja-flujo').classList.remove('active')">
                    Cerrar Inspector
                </button>
            `;
            actions.innerHTML = btns;
        }

        modal.classList.add('active');
    }

    function sincronizarFirestoreBandejasConFlujo() {
        try {
            if (!window.firebaseFirestore || !window.firebaseFirestore.collection) return;
            const dbRef = window.firebaseFirestore.db || window.db;
            if (!dbRef) return;

            const q = window.firebaseFirestore.query(
                window.firebaseFirestore.collection(dbRef, 'Bandejas_Turno')
            );
            window.firebaseFirestore.onSnapshot(q, (snap) => {
                if (snap.empty) {
                    estadoMemoria.bandejasFlujoCache = [...BANDEJAS_DEMO_OPERATIVAS];
                } else {
                    const reales = [];
                    snap.forEach(docSnap => {
                        const d = docSnap.data();
                        let fechaDespachoStr = 'Registrada';
                        try {
                            const f = d.fechaCreacion || d.fechaDespacho;
                            if (f) fechaDespachoStr = typeof f.toDate === 'function' ? f.toDate().toLocaleString() : String(f);
                        } catch (e) {}
                        reales.push({
                            id: docSnap.id,
                            ...d,
                            turnoAsignado: d.turnoAsignado || `Turno Asignado (${d.numeroBandeja || 'SAR'})`,
                            fechaDespachoStr
                        });
                    });
                    estadoMemoria.bandejasFlujoCache = reales;
                }
                renderizarFlujoBandejasTurno();
            });
        } catch (e) {
            // Fallback limpio a datos demostrativos en memoria
            renderizarFlujoBandejasTurno();
        }
    }

    function inicializarMonitorBandejasTurno() {
        const btnToggle = document.getElementById('btn-toggle-bandejas-flow-map');
        const btnRefresh = document.getElementById('btn-refresh-bandejas-flow');
        const container = document.getElementById('bandejas-live-flow-container');
        const modalInspector = document.getElementById('modal-inspector-bandeja-flujo');
        const btnCloseInspector = document.getElementById('btn-close-inspector-bandeja');

        if (btnToggle && container) {
            btnToggle.addEventListener('click', () => {
                container.style.display = container.style.display === 'none' ? 'block' : 'none';
            });
        }

        if (btnRefresh) {
            btnRefresh.addEventListener('click', () => {
                renderizarFlujoBandejasTurno();
                notificarERP('Flujo de Bandejas Actualizado', 'Se sincronizó el estado de salida de bodega, turno activo y retornos.', 'info');
            });
        }

        document.querySelectorAll('.bandeja-flow-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.bandeja-flow-filter-btn').forEach(b => {
                    b.classList.remove('erp-btn--primary');
                    b.classList.add('erp-btn--outline');
                });
                btn.classList.remove('erp-btn--outline');
                btn.classList.add('erp-btn--primary');
                estadoMemoria.filtroBandejaFlujo = btn.getAttribute('data-tray-filter') || 'ALL';
                renderizarFlujoBandejasTurno();
            });
        });

        if (btnCloseInspector && modalInspector) {
            btnCloseInspector.addEventListener('click', () => modalInspector.classList.remove('active'));
            modalInspector.addEventListener('click', (e) => {
                if (e.target === modalInspector) modalInspector.classList.remove('active');
            });
        }

        renderizarFlujoBandejasTurno();
        setTimeout(sincronizarFirestoreBandejasConFlujo, 1200);
    }

    function refrescarTodoElERP() {
        renderizarTableroKanban5Cols();
        renderizarKanbanCorporativo4Cols();
        renderizarTablaRecepcionDinamica();
        renderizarCatalogoInsumos();
        renderizarTablaDespachosRed();
        renderizarFlujoTopologiaSDC();
        renderizarCalendarioInicio();
        renderizarFlujoBandejasTurno();
    }

    // ===================================================================
    // PERSISTENCIA EN FIRESTORE (SDC, OC y Recepciones)
    // Cada documento se guarda en su colección (ERP_SDC, ERP_OC, ERP_Recepciones).
    // - Los cambios locales se detectan por comparación y se suben solos.
    // - Los cambios de otros usuarios llegan por onSnapshot y refrescan la pantalla.
    // - En modo demo (localStorage sar_demo=1) no se lee ni se escribe nada.
    // ===================================================================
    const ERPPersistencia = (() => {
        const ALIAS = {
            SDC: ['fechaCreacion', 'analistaAsignado', 'productosSolicitados'],
            OC: ['sdcId', 'fechaLimiteDespacho', 'productos'],
            Recepcion: []
        };
        const DEFS = [
            { col: 'ERP_SDC', lista: 'sdcList', Clase: SDC, alias: ALIAS.SDC },
            { col: 'ERP_OC', lista: 'ocList', Clase: OC, alias: ALIAS.OC },
            { col: 'ERP_Recepciones', lista: 'recepcionesList', Clase: Recepcion, alias: ALIAS.Recepcion }
        ];
        const guardado = {}; // col -> Map(id -> firma)
        let iniciado = false;

        function aPlano(item, alias) {
            const o = JSON.parse(JSON.stringify(Object.assign({}, item))); // evita toJSON() de la clase (pierde campos)
            alias.forEach(k => { delete o[k]; });
            return o;
        }
        function firma(o) { return JSON.stringify(o); }

        function hidratar(def, raw) {
            const inst = new def.Clase(raw);
            Object.keys(raw).forEach(k => {
                if (!(k in inst) || (k === 'estado' && def.Clase === OC)) inst[k] = raw[k];
            });
            return inst;
        }

        function esDemo() {
            try { return window.localStorage.getItem('sar_demo') === '1'; } catch (e) { return false; }
        }

        function iniciar() {
            if (iniciado) return;
            const fs = window.firebaseFirestore, db = window.firebaseDb;
            if (!fs || !db) return;
            iniciado = true;
            DEFS.forEach(def => {
                guardado[def.col] = new Map();
                fs.onSnapshot(fs.collection(db, def.col), (snap) => {
                    const lista = estadoMemoria[def.lista];
                    const porId = new Map(lista.map(x => [x.id, x]));
                    snap.docChanges().forEach(ch => {
                        const raw = ch.doc.data();
                        const id = ch.doc.id;
                        if (ch.type === 'removed') {
                            const i = lista.findIndex(x => x.id === id);
                            if (i >= 0) lista.splice(i, 1);
                            guardado[def.col].delete(id);
                            return;
                        }
                        try {
                            const inst = hidratar(def, { id, ...raw });
                            const plano = aPlano(inst, def.alias);
                            guardado[def.col].set(id, firma(plano));
                            if (porId.has(id)) lista[lista.indexOf(porId.get(id))] = inst;
                            else lista.push(inst);
                        } catch (e) { console.warn('[ERP] Documento inválido en', def.col, id, e.message); }
                    });
                    lista.sort((a, b) => String(b.fecha || b.fechaAceptacion || '').localeCompare(String(a.fecha || a.fechaAceptacion || '')));
                    try {
                        ERPCacheManager.invalidate('ERP_OC_LIST'); ERPCacheManager.invalidate('ERP_SDC_LIST');
                        ERPIndexEngine.rebuildKanbanIndex(estadoMemoria.sdcList, estadoMemoria.ocList);
                        refrescarTodoElERP();
                    } catch (e) { console.warn('[ERP] No se pudo refrescar:', e.message); }
                }, (err) => console.warn('[ERP] Lectura de', def.col, 'no disponible:', err.message));
            });
            setInterval(sincronizarCambios, 2000);
        }

        function sincronizarCambios() {
            const fs = window.firebaseFirestore, db = window.firebaseDb;
            if (!fs || !db || !document.body.dataset.userRole) return;
            DEFS.forEach(def => {
                const mapa = guardado[def.col];
                estadoMemoria[def.lista].forEach(item => {
                    let plano;
                    try { plano = aPlano(item, def.alias); } catch (e) { return; }
                    const f = firma(plano);
                    if (mapa.get(item.id) === f) return;
                    mapa.set(item.id, f); // se marca antes para no reintentar en bucle
                    const datos = { ...plano, updatedAt: new Date().toISOString(), updatedBy: (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || '' };
                    fs.setDoc(fs.doc(fs.collection(db, def.col), item.id), datos).catch(err => {
                        mapa.delete(item.id);
                        console.warn('[ERP] No se pudo guardar', def.col, item.id, err.message);
                    });
                });
            });
        }

        // Espera a que haya sesión con un rol que pueda usar Compras
        const espera = setInterval(() => {
            if (esDemo()) { clearInterval(espera); return; }
            const rol = String(document.body.dataset.userRole || '').toLowerCase();
            if (['admin', 'administrador', 'global', 'superadmin', 'operador'].includes(rol) && window.firebaseFirestore && window.firebaseDb) {
                clearInterval(espera);
                iniciar();
            }
        }, 1000);

        return { iniciar, sincronizarCambios };
    })();

    function initModuloAdquisiciones() {
        try {
            inicializarSubTabsAdquisiciones();
            inicializarControlesERP();
            inicializarControlesCalendarioYFlujo();
            inicializarMonitorBandejasTurno();
            inicializarEventosDrawer();
            refrescarTodoElERP();
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'initModuloAdquisiciones' });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initModuloAdquisiciones);
    } else {
        initModuloAdquisiciones();
    }

    // Exponer API Pública, Modelos y Motores en window.VisorAdquisiciones
    window.abrirInspectorBandejaFlujo = abrirInspectorBandejaFlujo;
    window.VisorAdquisiciones = {
        ESTADOS_KANBAN,
        SLA_LIMITS_HOURS,
        BACKEND_SCHEMAS,
        ERP_CDN_CONFIG,
        resolveStaticAsset,
        SentryMonitor,
        ERPCacheManager,
        ERPConnectionPool,
        ERPIndexEngine,
        SDC,
        OC,
        Recepcion,
        ModeloSDC: SDC,
        ModeloOC: OC,
        estadoMemoria,
        evaluarCaducidadCorta,
        validarNomenclaturaOcYRutDAF,
        validarFechaRecepcionFisicaDAF,
        construirTextoLegalDAF,
        anularOrdenPorQuiebre,
        generarIdOrdenHijaSecuencial,
        confirmarRecepcion,
        generarActaRC,
        abrirDrawerDetalleKanban,
        abrirModalAuditoriaRecepcion,
        abrirModalActaRecepcionConforme,
        descargarPDFActaRecepcionConforme,
        activarPanelERP,
        renderizarFlujoTopologiaSDC,
        renderizarCalendarioInicio,
        renderizarFlujoBandejasTurno,
        abrirInspectorBandejaFlujo,
        renderizarTableroKanban: refrescarTodoElERP,
        initModuloAdquisiciones
    };

})(window, document);
