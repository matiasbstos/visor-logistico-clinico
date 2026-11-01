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
        RECEPCIONADA: 'RECEPCIONADA'            // Columna 4: Recepcionada
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
                        cantidadComprada: pedida,
                        cantidadRecibida: recepcionada,
                        centroDestino: String(item.centroDestino || 'Bodega Central SAR').trim()
                    };
                })
                : [];

            this.sdcId = this.sdc_id;
            this.fechaLimiteDespacho = this.deadlineDespacho;
            this.productos = this.items;
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
            const pct = this.getPorcentajeRecepcion();
            if (pct === 0) return 'PENDIENTE';
            if (pct >= 100) return 'TOTAL';
            return 'PARCIAL';
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

    // =========================================================================
    // 4. RENDERIZADO DINÁMICO DE LAS 5 VISTAS EN #view-erp-adquisiciones
    // =========================================================================

    /**
     * Renderiza el Tablero Kanban Corporativo de 4 Columnas (#erp-kanban-board)
     * utilizando el índice en memoria `ERPIndexEngine` para evitar consultas a Firebase.
     */
    function renderizarKanbanCorporativo4Cols() {
        try {
            const colSdc = document.getElementById('erp-col-cards-sdc');
            const colPub = document.getElementById('erp-col-cards-publicada');
            const colDesp = document.getElementById('erp-col-cards-despacho');
            const colRec = document.getElementById('erp-col-cards-recepcionada');

            if (!colSdc || !colPub || !colDesp || !colRec) return;

            colSdc.innerHTML = '';
            colPub.innerHTML = '';
            colDesp.innerHTML = '';
            colRec.innerHTML = '';

            const counts = {
                SDC_CREADA: 0,
                PUBLICADA: 0,
                EN_DESPACHO: 0,
                RECEPCIONADA: 0
            };

            let totalParciales = 0;
            let totalVencidos = 0;
            const ahora = new Date();
            const query = estadoMemoria.busquedaGlobal || '';
            const filtro = estadoMemoria.filtroKanbanActivo || 'ALL';

            estadoMemoria.sdcList.forEach(sdc => {
                const oc = estadoMemoria.ocList.find(o => o.sdc_id === sdc.id) || null;
                const sla = oc ? oc.evaluarSLA(sdc.estado, ahora) : { status: 'en-plazo', label: 'En Análisis' };
                const estadoRec = oc ? oc.getEstadoRecepcion() : 'PENDIENTE';
                const pctRec = oc ? oc.getPorcentajeRecepcion() : 0;

                if (estadoRec === 'PARCIAL') totalParciales++;
                if (sla.status === 'vencido') totalVencidos++;

                if (filtro === 'SLA_VENCIDO' && sla.status !== 'vencido') return;
                if (filtro === 'PARCIAL' && estadoRec !== 'PARCIAL') return;

                // Búsqueda indexada en memoria O(1) sin lecturas a Firebase
                if (query && !ERPIndexEngine.matchesKanbanQuery(sdc.id, query)) return;

                const cardId = oc ? oc.id : sdc.id;
                const primerItem = oc ? (oc.items[0] || {}) : (sdc.itemsSolicitados[0] || {});
                const tituloItem = primerItem.nombre || 'INSUMO CLÍNICO';
                const subMeta = oc ? oc.proveedor : `Analista: ${sdc.creador}`;

                let badgeClass = 'badge-sar-yellow';
                let badgeLabel = 'En Análisis';
                let derechaMeta = formatearFechaCorta(sdc.fecha);

                if (sdc.estado === ESTADOS_KANBAN.PUBLICADA || sdc.estado === ESTADOS_KANBAN.OC_ACEPTADA) {
                    badgeClass = 'badge-sar-blue';
                    badgeLabel = 'Publicada';
                    derechaMeta = `Ref: ${sdc.id}`;
                } else if (sdc.estado === ESTADOS_KANBAN.EN_DESPACHO) {
                    if (sla.status === 'vencido') {
                        badgeClass = 'badge-sar-red';
                        badgeLabel = sla.label;
                        derechaMeta = 'SLA 5d Vencido';
                    } else {
                        badgeClass = 'badge-sar-blue';
                        badgeLabel = sla.label;
                        derechaMeta = 'En Ruta';
                    }
                } else if (sdc.estado === ESTADOS_KANBAN.RECEPCIONADA) {
                    if (estadoRec === 'PARCIAL') {
                        badgeClass = 'badge-sar-orange';
                        badgeLabel = 'Despacho Parcial';
                        derechaMeta = `${pctRec}% Recibido`;
                    } else {
                        badgeClass = 'badge-sar-green';
                        badgeLabel = 'Conforme 100%';
                        derechaMeta = `${pctRec}% Recibido`;
                    }
                }

                const cantTexto = oc && primerItem.cantidadPedida
                    ? ` (${primerItem.cantidadRecepcionada.toLocaleString('es-CL')} / ${primerItem.cantidadPedida.toLocaleString('es-CL')})`
                    : (primerItem.cantidadSolicitada ? ` (${primerItem.cantidadSolicitada.toLocaleString('es-CL')} ${primerItem.unidad || 'UN'})` : '');

                const cardHTML = `
                    <article class="kanban-card" data-sdc-id="${sdc.id}" ${oc ? `data-oc-id="${oc.id}"` : ''}>
                        <div class="kanban-card__header">
                            <span class="kanban-card__id">${cardId}</span>
                            <span class="badge ${badgeClass}">${badgeLabel}</span>
                        </div>
                        <h4 class="kanban-card__title">${tituloItem}${cantTexto}</h4>
                        ${oc && pctRec > 0 ? `
                            <div class="kanban-card__progress-track">
                                <div class="kanban-card__progress-bar" style="width:${pctRec}%; background:${estadoRec === 'PARCIAL' ? 'var(--sar-orange)' : 'var(--sar-green)'};"></div>
                            </div>
                        ` : ''}
                        <div class="kanban-card__meta">
                            <span><i class="ph ${oc ? 'ph-buildings' : 'ph-user'}"></i> ${subMeta}</span>
                            <span>${derechaMeta}</span>
                        </div>
                    </article>
                `;

                if (sdc.estado === ESTADOS_KANBAN.SDC_CREADA) {
                    colSdc.insertAdjacentHTML('beforeend', cardHTML);
                    counts.SDC_CREADA++;
                } else if (sdc.estado === ESTADOS_KANBAN.PUBLICADA || sdc.estado === ESTADOS_KANBAN.OC_ACEPTADA) {
                    colPub.insertAdjacentHTML('beforeend', cardHTML);
                    counts.PUBLICADA++;
                } else if (sdc.estado === ESTADOS_KANBAN.EN_DESPACHO) {
                    colDesp.insertAdjacentHTML('beforeend', cardHTML);
                    counts.EN_DESPACHO++;
                } else {
                    colRec.insertAdjacentHTML('beforeend', cardHTML);
                    counts.RECEPCIONADA++;
                }
            });

            const setElText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = String(val);
            };

            setElText('erp-col-count-sdc', counts.SDC_CREADA);
            setElText('erp-col-count-publicada', counts.PUBLICADA);
            setElText('erp-col-count-despacho', counts.EN_DESPACHO);
            setElText('erp-col-count-recepcionada', counts.RECEPCIONADA);

            setElText('erp-kanban-kpi-total', estadoMemoria.sdcList.length);
            setElText('erp-kanban-kpi-parciales', totalParciales);
            setElText('erp-kanban-kpi-vencidos', totalVencidos);

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
                if (estadoRec === 'PARCIAL') countDiscrepancias++;

                if (filtro !== 'ALL' && estadoRec !== filtro) return;

                oc.items.forEach((item, itemIdx) => {
                    const textoFila = ERPIndexEngine.normalizarTexto(`${oc.id} ${oc.sdc_id} ${oc.proveedor} ${item.nombre} ${item.codigo}`);
                    if (query && !textoFila.includes(query)) return;

                    let badgeHTML = '<span class="badge badge-sar-blue">Pendiente</span>';
                    if (item.cantidadRecepcionada >= item.cantidadPedida && item.cantidadPedida > 0) {
                        badgeHTML = '<span class="badge badge-sar-green">Conforme 100%</span>';
                    } else if (item.cantidadRecepcionada > 0 && item.cantidadRecepcionada < item.cantidadPedida) {
                        badgeHTML = '<span class="badge badge-sar-orange">Parcial / Discrepancia</span>';
                    }

                    filasHTML += `
                        <tr>
                            <td>
                                <div style="font-family:monospace; font-weight:800; color:var(--sar-blue);">${oc.id}</div>
                                <div style="font-size:11px; color:#64748B;">Origen: ${oc.sdc_id}</div>
                            </td>
                            <td>
                                <div style="font-weight:700; color:#0F172A;">${oc.proveedor}</div>
                                <div style="font-size:11px; color:#64748B;">Destino: ${item.centroDestino}</div>
                            </td>
                            <td>
                                <div style="font-weight:700; color:#0F172A;">${item.nombre}</div>
                                <div style="font-size:11px; color:#64748B; font-family:monospace;">SKU: ${item.codigo}</div>
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
                                <button type="button" class="erp-btn ${item.cantidadRecepcionada < item.cantidadPedida ? 'erp-btn--primary' : 'erp-btn--outline'}"
                                    style="padding:6px 12px; font-size:12px;"
                                    data-audit-oc="${oc.id}" data-audit-idx="${itemIdx}">
                                    <i class="ph-bold ph-clipboard-text"></i>
                                    ${item.cantidadRecepcionada < item.cantidadPedida ? 'Auditar' : 'Ver Acta'}
                                </button>
                            </td>
                        </tr>
                    `;
                });
            });

            if (!filasHTML) {
                filasHTML = `
                    <tr>
                        <td colspan="7" style="text-align:center; padding:32px; color:#64748B;">
                            No se encontraron órdenes de compra para el criterio seleccionado.
                        </td>
                    </tr>
                `;
            }

            tbody.innerHTML = filasHTML;

            const elPend = document.getElementById('erp-rec-kpi-pendientes');
            const elConf = document.getElementById('erp-rec-kpi-conformes');
            const elDisc = document.getElementById('erp-rec-kpi-discrepancias');
            if (elPend) elPend.textContent = String(estadoMemoria.ocList.length);
            if (elConf) elConf.textContent = String(countConformes);
            if (elDisc) elDisc.textContent = String(countDiscrepancias);

            tbody.querySelectorAll('[data-audit-oc]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const ocId = btn.getAttribute('data-audit-oc');
                    const itemIdx = Number(btn.getAttribute('data-audit-idx') || 0);
                    abrirModalAuditoriaRecepcion(ocId, itemIdx);
                });
            });
        } catch (error) {
            SentryMonitor.captureException(error, { operation: 'renderizarTablaRecepcionDinamica' });
        }
    }

    /**
     * Abre el Modal de Auditoría de Recepción Dinámica (#erp-audit-modal-overlay)
     * con monitoreo de errores Sentry en la confirmación de recepción parcial/total.
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
            const destEl = document.getElementById('erp-audit-destino');
            const inputQty = document.getElementById('erp-audit-input-qty');
            const discBox = document.getElementById('erp-audit-discrepancy-box');
            const discTitle = document.getElementById('erp-audit-discrepancy-title');
            const discDesc = document.getElementById('erp-audit-discrepancy-desc');
            const btnConfirm = document.getElementById('btn-erp-confirm-audit-modal');
            const txtConfirm = document.getElementById('erp-audit-confirm-text');

            if (titleEl) titleEl.textContent = `Auditoría de Recepción: ${oc.id}`;
            if (subEl) subEl.textContent = `Proveedor: ${oc.proveedor} • SDC Origen: ${oc.sdc_id}`;
            if (nameEl) nameEl.textContent = item.nombre;
            if (skuEl) skuEl.textContent = `Código: ${item.codigo}`;
            if (expEl) expEl.textContent = item.cantidadPedida.toLocaleString('es-CL');
            if (prevEl) prevEl.textContent = item.cantidadRecepcionada.toLocaleString('es-CL');
            if (destEl) destEl.textContent = item.centroDestino || 'SAR Central';

            const actualizarCalculoDiscrepancia = () => {
                const val = Math.max(0, Math.min(item.cantidadPedida, Number(inputQty.value) || 0));
                const diff = item.cantidadPedida - val;

                if (diff > 0) {
                    if (discBox) {
                        discBox.style.borderLeftColor = 'var(--sar-orange)';
                        discBox.style.background = 'rgba(232,93,30,0.08)';
                    }
                    if (discTitle) {
                        discTitle.style.color = 'var(--sar-orange)';
                        discTitle.textContent = `Recepción Parcial Detectada (-${diff.toLocaleString('es-CL')} u.)`;
                    }
                    if (discDesc) {
                        discDesc.textContent = `Se generará acta parcial para ${oc.id} y se mantendrá abierto el saldo de ${diff.toLocaleString('es-CL')} unidades.`;
                    }
                    if (btnConfirm) {
                        btnConfirm.className = 'erp-btn erp-btn--warning';
                    }
                    if (txtConfirm) txtConfirm.textContent = 'Confirmar Recepción Parcial';
                } else {
                    if (discBox) {
                        discBox.style.borderLeftColor = 'var(--sar-green)';
                        discBox.style.background = 'rgba(140,198,63,0.12)';
                    }
                    if (discTitle) {
                        discTitle.style.color = '#3f6212';
                        discTitle.textContent = 'Conciliación Exacta 100% Conforme';
                    }
                    if (discDesc) {
                        discDesc.textContent = `La cantidad verificada coincide con las ${item.cantidadPedida.toLocaleString('es-CL')} unidades solicitadas en la OC.`;
                    }
                    if (btnConfirm) {
                        btnConfirm.className = 'erp-btn erp-btn--primary';
                    }
                    if (txtConfirm) txtConfirm.textContent = 'Confirmar Recepción Total (100%)';
                }
            };

            if (inputQty) {
                inputQty.max = String(item.cantidadPedida);
                inputQty.value = String(item.cantidadRecepcionada > 0 ? item.cantidadRecepcionada : item.cantidadPedida);
                inputQty.oninput = actualizarCalculoDiscrepancia;
                actualizarCalculoDiscrepancia();
            }

            if (btnConfirm) {
                btnConfirm.onclick = () => {
                    try {
                        const rawVal = Number(inputQty ? inputQty.value : 0);
                        if (isNaN(rawVal) || rawVal < 0) {
                            throw new Error(`Cantidad de recepción inválida (${inputQty?.value}) en ${oc.id}`);
                        }

                        const nuevaCantidadAcum = Math.max(0, Math.min(item.cantidadPedida, rawVal));
                        const delta = Math.max(0, nuevaCantidadAcum - item.cantidadRecepcionada);
                        item.cantidadRecepcionada = nuevaCantidadAcum;
                        item.cantidadRecibida = nuevaCantidadAcum;

                        const esParcial = oc.getPorcentajeRecepcion() < 100;
                        const nuevaRec = new Recepcion({
                            id: `REC-2026-${String(estadoMemoria.recepcionesList.length + 42).padStart(4, '0')}`,
                            oc_id: oc.id,
                            fecha: new Date().toISOString(),
                            esParcial,
                            actaConforme: true,
                            detalleRecibido: [
                                { codigo: item.codigo, nombre: item.nombre, cantidadIngresada: delta || nuevaCantidadAcum }
                            ]
                        });
                        estadoMemoria.recepcionesList.unshift(nuevaRec);

                        const sdc = estadoMemoria.sdcList.find(s => s.id === oc.sdc_id);
                        if (sdc && nuevaCantidadAcum > 0) {
                            sdc.estado = ESTADOS_KANBAN.RECEPCIONADA;
                        }

                        // Invalidar caché de recepciones y reconstruir índice Kanban
                        ERPCacheManager.invalidate('ERP_OC_LIST');
                        ERPIndexEngine.rebuildKanbanIndex(estadoMemoria.sdcList, estadoMemoria.ocList);

                        modal.classList.remove('active');
                        refrescarTodoElERP();
                        notificarERP(
                            esParcial ? 'Auditoría Parcial Confirmada' : 'Acta Conforme 100% Emitida',
                            `${oc.id}: ${item.nombre} actualizado a ${nuevaCantidadAcum.toLocaleString('es-CL')} / ${item.cantidadPedida.toLocaleString('es-CL')} u.`
                        );
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

            if (sdc) {
                sdc.estado = ESTADOS_KANBAN.RECEPCIONADA;
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

    function refrescarTodoElERP() {
        renderizarTableroKanban5Cols();
        renderizarKanbanCorporativo4Cols();
        renderizarTablaRecepcionDinamica();
        renderizarCatalogoInsumos();
        renderizarTablaDespachosRed();
    }

    function initModuloAdquisiciones() {
        try {
            inicializarSubTabsAdquisiciones();
            inicializarControlesERP();
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

    // Exponer API Pública, Modelos y Motores de Fase 4 en window.VisorAdquisiciones
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
        abrirDrawerDetalleKanban,
        abrirModalAuditoriaRecepcion,
        activarPanelERP,
        renderizarTableroKanban: refrescarTodoElERP,
        initModuloAdquisiciones
    };

})(window, document);
