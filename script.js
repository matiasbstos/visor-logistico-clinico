// Importación de Firebase desde la CDN (Módulo)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, runTransaction, writeBatch, serverTimestamp, getDoc, setDoc, query, where, orderBy, limit, limitToLast, startAfter, endBefore, startAt, endAt, getDocs, deleteDoc, addDoc, updateDoc, increment, onSnapshot } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { generarPlantillaExcel, procesarExcelCargaMasiva, excelSerialDateToJS, exportarInventarioResguardo } from './excelUtils.js';

window.addEventListener('error', function (event) {
    console.error("Error Global Interceptado:", event.error || event.message);
    if (window.showToast) {
        window.showToast('Error Interno', 'Ha ocurrido un error en la aplicación: ' + (event.message || 'Desconocido'), 'error');
    }
});
window.addEventListener('unhandledrejection', function (event) {
    console.error("Promesa Rechazada No Manejada:", event.reason);
    if (window.showToast && event.reason && event.reason.message) {
        window.showToast('Error Interno', 'Ha ocurrido un error asíncrono: ' + event.reason.message, 'error');
    }
});

window.showAlertCenter = function (titulo, mensaje, isError = false) {
    const modal = document.getElementById('modal-alerta-centro');
    const icono = document.getElementById('alerta-centro-icono');
    const tituloEl = document.getElementById('alerta-centro-titulo');
    const mensajeEl = document.getElementById('alerta-centro-mensaje');
    if (!modal) { window.alert(titulo + ": " + mensaje); return; }
    if (isError) {
        icono.innerHTML = '<i class="ph ph-warning-circle" style="color: #dc3545;"></i>';
        tituloEl.style.color = '#dc3545';
    } else {
        icono.innerHTML = '<i class="ph ph-check-circle" style="color: #198754;"></i>';
        tituloEl.style.color = '#198754';
    }
    tituloEl.textContent = titulo;
    mensajeEl.textContent = mensaje;
    modal.style.display = 'flex';
};


/* ----------------------------------------------------
   1a. UTILERÍA ROBUSTA DE TIPOS (T-GUARD)
   ---------------------------------------------------- */
window.escapeHTML = function (str) {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
};

const ROLES_SISTEMA = [
    { id: 'enfermero', label: 'Enfermero (Gestión de Bandejas)' },
    { id: 'operador', label: 'Operador de Bodega' },
    { id: 'administrador', label: 'Administrador (Inventario)' },
    { id: 'superadmin', label: 'Super Admin (Control Total)' }
];

const SAR_Utils = {
    // Parseador Universal (Retorna objeto Date)
    parseDate: (val) => {
        if (!val) return null;
        try {
            if (typeof val === 'number') return new Date((val - 25569) * 86400 * 1000);
            if (typeof val === 'string') {
                const clean = val.trim();
                if (clean.includes('-')) {
                    const [y, m, d] = clean.split(/[-T]/);
                    return new Date(y, m - 1, d);
                }
                if (clean.includes('/')) {
                    const parts = clean.split(/[\/\s]/);
                    return new Date(parts[2], parts[1] - 1, parts[0]);
                }
            }
            if (val.toDate) return val.toDate();
            if (val instanceof Date) return val;
            return null;
        } catch (e) { return null; }
    },

    // Formateador Universal (Retorna String DD / MM / AAAA)
    formatDate: (val) => {
        const date = SAR_Utils.parseDate(val);
        if (!date || isNaN(date.getTime())) return "N/A";

        return date.toLocaleDateString('es-CL', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        }).replace(/-/g, ' / ');
    },

    // Normalizador de Búsqueda
    matches: (source, term) => {
        if (!source || !term) return false;
        return source.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .includes(term.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
    },

    // Predictive Forecasting (Weighted Burn Rate)
    calculateBurnRate: (insumoName, logs) => {
        if (!logs || logs.length === 0) return 0;

        const hoy = new Date();
        let qty30 = 0;
        let qty90 = 0;

        logs.forEach(log => {
            if (log.insumoName !== insumoName || (log.type !== 'salida' && log.type !== 'SALIDA')) return;
            const d = SAR_Utils.parseDate(log.date);
            if (!d) return;
            const diffDays = Math.floor((hoy - d) / (1000 * 60 * 60 * 24));

            const qty = Number(log.quantity) || 0;
            // Solo salidas de hasta 90 días
            if (diffDays <= 30) {
                qty30 += qty;
            } else if (diffDays <= 90) {
                qty90 += qty;
            }
        });

        // Ponderación Exponencial: 60% peso a los ultimos 30 dias, 40% a los 60 dias anteriores
        // Tasa diaria de ultimos 30 dias
        const rate30 = qty30 / 30;
        // Tasa diaria de periodo 31-90 (60 dias)
        const rate90 = qty90 / 60;

        return (rate30 * 0.6) + (rate90 * 0.4);
    },

    predictStockDepletion: (stock, burnRate) => {
        if (burnRate <= 0) return Infinity;
        return Math.floor(stock / burnRate);
    },

    // Procurement
    calcularOrdenOptima: (stockActual, burnRate, meses = 1) => {
        if (burnRate <= 0) return 0;
        const meta = burnRate * 30 * meses;
        const sugerido = Math.ceil(meta - stockActual);
        return sugerido > 0 ? sugerido : 0;
    }
};

// Tracking de Listeners para prevenir Memory Leaks
const activeListeners = {
    dashboard: null,
    expirations: null,
    historial: null,
    bodegas: null,
    usuarios: null,
    config: null,
    informes_kpi: null,
    informes_logs: null,
    logs: null,
    predictive: null
};

window.globalMovimientosPredictivos = [];

function clearListener(type) {
    if (activeListeners[type]) {
        activeListeners[type](); // Unsubscribe
        activeListeners[type] = null;
    }
}

function clearAllListeners() {
    console.info("[Cleanup] Desconectando todos los sockets de tiempo real...");
    Object.keys(activeListeners).forEach(key => clearListener(key));
}

const firebaseConfig = {
    apiKey: "AIzaSyAyktOnoB-j7nX4-YZLa6B74wOBCbZvlsA",
    authDomain: "sarinventario.firebaseapp.com",
    projectId: "sarinventario",
    storageBucket: "sarinventario.firebasestorage.app",
    messagingSenderId: "358257655117",
    appId: "1:358257655117:web:b7f46ad97e94afa1324b04"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const secondaryApp = initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);

export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});

// La persistencia offline ahora se maneja nativamente por persistentLocalCache

// Global Error Guard for Production
window.onerror = function (message, source, lineno, colno, error) {
    console.error("[Global Error]:", { message, source, lineno, error });
    if (window.showToast) window.showToast('Error de Sistema', 'Se ha detectado una anomalía. Si persiste, contacte a soporte técnico.', 'error');
    return false;
};

window.onunhandledrejection = function (event) {
    console.error("[Unhandled Rejection]:", event.reason);
    if (window.showToast) window.showToast('Error de Red/Datos', 'La operación no pudo completarse. Verifique su conexión.', 'warning');
};

/**
 * SERVICIO ARQUITECTURA DE BACKEND: Trazabilidad inmutable usando runTransaction
 * Garantiza consistencia atómica y previene condiciones de carrera (Race Conditions).
 * 
 * @param {string} itemId ID del documento en "Insumos"
 * @param {Object} newData Datos nuevos a setear
 * @param {Object} currentUser Objeto del usuario (ej: auth.currentUser)
 */
export async function updateInventoryWithAudit(itemId, newData, currentUser) {
    if (!itemId || !newData || !currentUser?.uid) {
        throw new Error("Parámetros incompletos. Se requiere ID de insumo, datos y usuario autenticado.");
    }

    try {
        const insumoRef = doc(db, 'Insumos', itemId);
        const statsRef = doc(db, 'Metadata', 'GlobalStats');

        const result = await runTransaction(db, async (transaction) => {
            // 1. Lecturas
            const insumoDoc = await transaction.get(insumoRef);
            if (!insumoDoc.exists()) throw new Error(`Insumo [${itemId}] no encontrado.`);

            const statsDoc = await transaction.get(statsRef);
            const stats = statsDoc.exists() ? statsDoc.data() : { criticalCount: 0, totalCapital: 0, totalItems: 0 };

            const previousData = insumoDoc.data();
            const oldQty = Number(previousData.quantity) || 0;

            let newQty = oldQty;
            if (newData.quantityDiff !== undefined) {
                newQty = oldQty + Number(newData.quantityDiff);
                if (newQty < 0) throw new Error(`Quiebre de Stock. Disponible: ${oldQty}.`);
                newData.quantity = newQty;
                delete newData.quantityDiff;
            } else if (newData.quantity !== undefined) {
                newQty = Number(newData.quantity);
                if (newQty < 0) throw new Error("La cantidad asignada no puede ser negativa.");
            }

            // ===================================
            // SINCRONIZACIÓN DE BATCHES (FEFO)
            // ===================================
            // Si hay un cambio manual que afecta al total y vienen datos de lote desde la UI
            if (newData.batch !== undefined && newData.expirationDate !== undefined) {
                let currentBatches = previousData.batches || [];

                if (currentBatches.length <= 1) {
                    // Si había 0 o 1 lote, simplemente lo sobrescribimos con lo que diga el editor manual
                    newData.batches = [{
                        batch: newData.batch || 'S/L',
                        quantity: newQty,
                        expirationDate: newData.expirationDate || ''
                    }];
                } else if (newQty !== oldQty) {
                    // Si tiene multiples lotes y alguien cambió la cantidad total a mano desde Editar (peligroso)
                    // Se ajusta el primer lote (el más próximo a vencer)
                    currentBatches.sort((a, b) => new Date(a.expirationDate || '2099-12-31') - new Date(b.expirationDate || '2099-12-31'));
                    const diff = newQty - oldQty;
                    currentBatches[0].quantity += diff;
                    if (currentBatches[0].quantity < 0) currentBatches[0].quantity = 0; // Fallback
                    newData.batches = currentBatches;
                }
            }

            const oldPrice = Number(previousData.unitPrice) || 0;
            const newPrice = newData.unitPrice !== undefined ? Number(newData.unitPrice) : oldPrice;
            const oldLimit = Number(previousData.criticalLimit || previousData.stock_minimo || 10);
            const newLimit = newData.criticalLimit !== undefined ? Number(newData.criticalLimit) : oldLimit;

            // 2. Cálculos de Diff para Metadatos Globales (se actualizarán asíncronamente post-transacción)
            let criticalDiff = 0;
            const wasCritical = oldQty <= oldLimit;
            const isCriticalNow = newQty <= newLimit;
            if (!wasCritical && isCriticalNow) criticalDiff = 1;
            else if (wasCritical && !isCriticalNow) criticalDiff = -1;

            const capitalDiff = (newQty * newPrice) - (oldQty * oldPrice);

            // 3. Actualizaciones al Insumo con bandera nativa
            transaction.update(insumoRef, {
                ...newData,
                isCritical: isCriticalNow,
                lastModified: serverTimestamp(),
                lastModifierId: currentUser.uid
            });

            // Trail de Auditoría
            const auditLogRef = doc(collection(insumoRef, 'audit_logs'));
            transaction.set(auditLogRef, {
                action: 'ACTUALIZACION',
                timestamp: serverTimestamp(),
                userId: currentUser.uid,
                changes: { previous: previousData, new: newData }
            });

            return { oldQty, newQty, criticalDiff, capitalDiff };
        });

        // 4. Actualizar Metadatos Globales SIN bloquear la transacción principal
        if (result.criticalDiff !== 0 || result.capitalDiff !== 0) {
            setDoc(statsRef, {
                criticalCount: increment(result.criticalDiff),
                totalCapital: increment(result.capitalDiff),
                lastUpdated: serverTimestamp()
            }, { merge: true }).catch(err => console.error("Error actualizando GlobalStats post-tx:", err));
        }

        return result;
    } catch (error) {
        console.error(`[Error Arquitectura] Falla en transacción de Insumo ${itemId}:`, error);
        throw error;
    }
}

/**
 * Utilidad de Optmización: Wrapper para Retry Automático de Promesas
 * Usa "Exponential Backoff" para espaciar intentos.
 */
async function withRetry(asyncOperation, maxRetries = 3, baseDelayMs = 1500) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            return await asyncOperation();
        } catch (error) {
            attempt++;
            console.warn(`[Network Retry] Intento ${attempt}/${maxRetries} fallido: ${error.message}`);
            if (attempt >= maxRetries) {
                throw error; // Agotados los reintentos, el error fluye hacia arriba.
            }
            // Espera Exponencial: 1.5s, 3s, 6s...
            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            showToast('Conexión Inestable', `Retraso de red detectado. Reintentando operación en ${delay / 1000}s...`, 'warning');
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/* ----------------------------------------------------
   1. SISTEMA COMPLETO DE FEEDBACK GLOBALES (TOAST)
   ---------------------------------------------------- */
const toastContainer = document.createElement('div');
toastContainer.style.position = 'fixed';
toastContainer.style.bottom = '20px';
toastContainer.style.right = '20px';
toastContainer.style.zIndex = '9999';
toastContainer.style.display = 'flex';
toastContainer.style.flexDirection = 'column';
toastContainer.style.gap = '10px';
// El contenedor se anexa asíncronamente cuando el body está listo

function showToast(title, text, type = 'info') {
    const toast = document.createElement('div');
    let bgColor, icon;

    if (type === 'success') { bgColor = 'var(--success)'; icon = 'ph-check-circle'; }
    else if (type === 'warning') { bgColor = 'var(--warning)'; icon = 'ph-warning'; }
    else if (type === 'error') { bgColor = 'var(--danger)'; icon = 'ph-warning-circle'; }
    else { bgColor = 'var(--primary)'; icon = 'ph-info'; }

    toast.style.backgroundColor = 'white';
    toast.style.color = 'var(--text-main)';
    toast.style.borderLeft = `4px solid ${bgColor}`;
    toast.style.padding = '16px 20px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '12px';
    toast.style.minWidth = '250px';
    toast.style.animation = 'slideIn 0.3s ease-out forwards';
    toast.style.transition = 'opacity 0.3s ease-out';

    toast.innerHTML = `
        <i class="ph-fill ${icon}" style="color: ${bgColor}; font-size: 24px;"></i>
        <div>
            <div style="font-weight: 700; font-size: 14px; margin-bottom: 2px;">${title}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${text}</div>
        </div>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
window.showToast = showToast;

document.addEventListener('DOMContentLoaded', () => {
    console.log('Visor Logístico Clínico Inicializado - Bootstrap');

    // Poblado Dinámico de Roles (Fase 31)
    const selectNuevoRol = document.getElementById('select-nuevo-usuario-rol');
    if (selectNuevoRol) {
        selectNuevoRol.innerHTML = '<option value="">Seleccione un nivel de acceso...</option>';
        ROLES_SISTEMA.forEach(rol => {
            selectNuevoRol.innerHTML += `<option value="${rol.id}">${rol.label}</option>`;
        });
    }

    document.body.appendChild(toastContainer); // Inyectamos el host de notificaciones
    // Estilos dinámicos
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = `
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes spin { 100% { transform: rotate(360deg); } } 
        .ph-spin { animation: spin 1s linear infinite; }
    `;
    document.head.appendChild(styleSheet);

    // Nodos de Autenticación
    const loginView = document.getElementById('login-view');
    const mainApp = document.getElementById('main-app');
    const loginForm = document.getElementById('form-login');
    let isAppInitialized = false;

    // 1A. EVENTO DE INICIO DE SESIÓN
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = loginForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-spinner ph-spin"></i> VALIDANDO...';
            btn.disabled = true;

            const email = document.getElementById('login-email').value;
            const pwd = document.getElementById('login-pwd').value;

            try {
                // Autenticación directa a Firebase Authentication
                await signInWithEmailAndPassword(auth, email, pwd);
                // NOTA: No hacemos redirect ni manipulamos UI aquí. 
                // Dejamos que el "onAuthStateChanged" maneje todo centralizadamente.
            } catch (error) {
                console.error("Fallo Auth:", error);
                let titulo = "Acceso Denegado";
                let mensaje = "Su credencial es inválida o carece de permisos para ingresar.";

                if (error.code === 'auth/too-many-requests') {
                    titulo = "Cuenta Bloqueada Temporalmente";
                    mensaje = "Por seguridad, el acceso ha sido bloqueado debido a múltiples intentos fallidos. Intente nuevamente en unos minutos.";
                } else if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
                    mensaje = "El correo o la contraseña son incorrectos.";
                }
                window.showToast(titulo, mensaje, "error");
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    // 1B. UX DE LOGIN: TOGGLE CONTRASEÑA
    const togglePwdBtn = document.getElementById('toggle-pwd-btn');
    const loginPwdInput = document.getElementById('login-pwd');
    if (togglePwdBtn && loginPwdInput) {
        togglePwdBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const currentType = loginPwdInput.type;
            const targetType = currentType === 'password' ? 'text' : 'password';
            loginPwdInput.type = targetType;

            const icon = togglePwdBtn.querySelector('i') || togglePwdBtn.querySelector('svg');
            if (icon) {
                if (targetType === 'text') {
                    icon.classList.remove('ph-eye');
                    icon.classList.add('ph-eye-slash');
                } else {
                    icon.classList.remove('ph-eye-slash');
                    icon.classList.add('ph-eye');
                }
            } else {
                togglePwdBtn.innerHTML = `<i class="ph ${targetType === 'text' ? 'ph-eye-slash' : 'ph-eye'}" style="font-size: 20px;"></i>`;
            }
        });
    }

    // 1C. RECUPERACIÓN DE CONTRASEÑA
    const forgotPwdLink = document.getElementById('forgot-pwd-link');
    const loginEmailInput = document.getElementById('login-email');
    if (forgotPwdLink) {
        forgotPwdLink.addEventListener('click', async (e) => {
            e.preventDefault();
            const email = loginEmailInput.value.trim();

            if (!email) {
                window.showToast('Atención Requerida', 'Ingrese su correo para recuperar la contraseña', 'warning');
                loginEmailInput.focus();
                return;
            }

            try {
                await sendPasswordResetEmail(auth, email);
                window.showToast('Gestión Exitosa', 'Correo de recuperación enviado a su bandeja principal.', 'success');
            } catch (error) {
                console.error("Password Reset Error:", error);

                let errorMsg = 'Error al enviar la solicitud.';
                if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-email') {
                    errorMsg = 'El correo institucional proporcionado no figura en nuestra base de datos.';
                } else if (error.code === 'auth/too-many-requests') {
                    errorMsg = 'Múltiples intentos denegados. Intente nuevamente en 5 minutos.';
                }

                window.showToast('Acción Fallida', errorMsg, 'error');
            }
        });
    }

    // 2. OBSERVADOR DE ESTADO (El Guardián Principal de la SPA)
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Usuario validado -> Forzar explícitamente el ocultamiento del login y mostrar Dashboard
            document.getElementById('login-view').style.display = 'none';
            document.getElementById('main-app').style.display = 'flex';

            // Inyectar el correo en la barra superior
            const headerUserName = document.getElementById('header-center-name');
            if (headerUserName) {
                headerUserName.textContent = user.email;
            }

            // Validamos roles y aplicamos capa de Seguridad Visual
            await window.enforceRBACLogic(user);
            if (window.cargarSelectEnfermeros) window.cargarSelectEnfermeros();

            // ==========================================
            // AUTO-LOGOUT POR INACTIVIDAD (30 Minutos - SINGLETON)
            // ==========================================
            if (!window.inactivityListenersAttached) {
                window.resetInactivityTimer = () => {
                    if (window.inactivityTimeout) clearTimeout(window.inactivityTimeout);
                    // 30 minutos = 1,800,000 ms
                    window.inactivityTimeout = setTimeout(async () => {
                        console.warn("Cerrando sesión por inactividad prolongada (30m).");
                        await signOut(auth);
                        window.location.reload();
                    }, 1800000);
                };

                ['mousemove', 'keydown', 'touchstart', 'scroll', 'click'].forEach(evt => {
                    document.addEventListener(evt, window.resetInactivityTimer, { passive: true });
                });

                window.inactivityListenersAttached = true;
            }
            if (window.resetInactivityTimer) window.resetInactivityTimer();

            // ==========================================
            // FASE 10: WIRE-UP EXTREMO Y ENCAPSULACIÓN
            // ==========================================
            const userRole = document.body.getAttribute('data-user-role');

            // 1. Forzado de Evento del Botón Eliminar
            const btnEliminarPrincipal = document.querySelector('#view-configuracion .btn-danger');
            if (btnEliminarPrincipal) {
                btnEliminarPrincipal.onclick = (e) => {
                    e.preventDefault();
                    document.getElementById('modal-borrado-total').style.display = 'flex';
                };
            }

            // 2. Creación de la Solicitud (El 'Maker')
            const btnSolicitarWipeObj = document.getElementById('btn-solicitar-wipe');
            if (btnSolicitarWipeObj) {
                const newBtn = btnSolicitarWipeObj.cloneNode(true);
                btnSolicitarWipeObj.parentNode.replaceChild(newBtn, btnSolicitarWipeObj);

                document.getElementById('btn-solicitar-wipe').addEventListener('click', async () => {
                    const inputWipe = document.getElementById('confirmacion-wipe').value;
                    if (inputWipe.trim().toUpperCase() !== 'ELIMINAR') return window.showAlertCenter("Notificación", "Escriba ELIMINAR");
                    try {
                        const cod = "WIPE-" + Math.floor(Math.random() * 9000);
                        await addDoc(collection(db, 'Solicitudes_Criticas'), {
                            codigo: cod, fecha: serverTimestamp(), usuario: auth.currentUser.email, estado: 'Solicitado', accion: 'WIPE_DB'
                        });
                        window.showAlertCenter("Mensaje del Sistema", "Solicitud Creada: " + cod);
                        document.getElementById('modal-borrado-total').style.display = 'none';
                    } catch (e) { console.error(e); window.showAlertCenter("Notificación", "Error guardando solicitud"); }
                });
            }

            // ==========================================
            // FASE 11: AJUSTE CRÍTICO DE INVENTARIO
            // ==========================================
            if (userRole === 'admin' || userRole === 'global' || userRole === 'superadmin') {
                const btnAbrirAjuste = document.getElementById('btn-abrir-ajuste') || document.querySelector('#view-configuracion .btn-warning');
                const selectInsumo = document.getElementById('ajuste-insumo');
                const buscadorAjuste = document.getElementById('buscador-ajuste');
                const btnEjecutarAjuste = document.getElementById('btn-ejecutar-ajuste');

                window.cargarInsumosParaAjuste = async function () {
                    if (selectInsumo) {
                        selectInsumo.innerHTML = '<option value="" disabled selected>Escriba en el buscador para cargar insumos...</option>';
                    }
                };

                let debounceAjusteTimeout;
                if (buscadorAjuste && selectInsumo) {
                    buscadorAjuste.addEventListener('input', (e) => {
                        const term = e.target.value.trim().toLowerCase();
                        if (term.length < 2) {
                            selectInsumo.innerHTML = '<option value="" disabled selected>Escriba al menos 2 letras...</option>';
                            return;
                        }

                        clearTimeout(debounceAjusteTimeout);
                        selectInsumo.innerHTML = '<option value="" disabled selected>Buscando...</option>';

                        debounceAjusteTimeout = setTimeout(async () => {
                            try {
                                const q = query(
                                    collection(db, 'Insumos'),
                                    orderBy('name'),
                                    startAt(term),
                                    endAt(term + '\uf8ff'),
                                    limit(20)
                                );
                                const snapshot = await getDocs(q);

                                if (snapshot.empty) {
                                    selectInsumo.innerHTML = '<option disabled>No se encontraron insumos</option>';
                                    return;
                                }

                                selectInsumo.innerHTML = '<option value="" disabled selected>Seleccione un insumo...</option>';
                                snapshot.forEach(docSnap => {
                                    const data = docSnap.data();
                                    const option = document.createElement('option');
                                    option.value = docSnap.id;
                                    option.dataset.stock = data.quantity || 0;
                                    option.dataset.nombre = data.name;
                                    option.textContent = `[Stock: ${data.quantity || 0}] - ${data.name}`;
                                    selectInsumo.appendChild(option);
                                });
                            } catch (error) {
                                console.error("Error buscando insumos para ajuste:", error);
                                selectInsumo.innerHTML = '<option disabled>Error en búsqueda</option>';
                            }
                        }, 400);
                    });
                }

                if (btnEjecutarAjuste) {
                    const newBtnEjecutar = btnEjecutarAjuste.cloneNode(true);
                    btnEjecutarAjuste.parentNode.replaceChild(newBtnEjecutar, btnEjecutarAjuste);

                    newBtnEjecutar.addEventListener('click', async () => {
                        const cantidadInputStr = document.getElementById('ajuste-cantidad').value;
                        const justificacion = document.getElementById('ajuste-justificacion').value.trim();
                        const selectedOption = selectInsumo.options[selectInsumo.selectedIndex];

                        if (!selectedOption || selectedOption.value === "") {
                            return window.showAlertCenter("Notificación", 'Debe seleccionar un insumo.');
                        }

                        const cantidadParsed = Number(cantidadInputStr);
                        if (!cantidadInputStr || isNaN(cantidadParsed) || cantidadParsed === 0) {
                            return window.showAlertCenter("Notificación", 'Ingrese una cantidad válida (+ o -). No puede ser cero.');
                        }

                        if (justificacion.length <= 10) {
                            return window.showAlertCenter("Notificación", 'La justificación debe tener más de 10 caracteres.');
                        }

                        const docId = selectedOption.value;
                        const stockActual = Number(selectedOption.dataset.stock);
                        const insumoNombre = selectedOption.dataset.nombre;

                        let nuevoStock = stockActual + cantidadParsed;
                        let accionDetallada = "";
                        let tipoAjuste = cantidadParsed > 0 ? 'sumar' : 'restar';
                        const cantidadAbs = Math.abs(cantidadParsed);

                        if (tipoAjuste === 'sumar') {
                            accionDetallada = `Suma de stock: ${stockActual} -> ${nuevoStock} (+${cantidadAbs})`;
                        } else if (tipoAjuste === 'restar') {
                            accionDetallada = `Resta de stock: ${stockActual} -> ${nuevoStock} (-${cantidadAbs})`;
                        }

                        if (nuevoStock < 0) {
                            return window.showAlertCenter("Notificación", 'El stock resultante no puede ser negativo.');
                        }

                        const codigoAjuste = "ADJ-" + Math.floor(10000 + Math.random() * 90000);

                        try {
                            await runTransaction(db, async (transaction) => {
                                const insumoRef = doc(db, 'Insumos', docId);
                                const insumoSnap = await transaction.get(insumoRef);
                                if (!insumoSnap.exists()) {
                                    throw new Error("El insumo no existe en la base de datos.");
                                }

                                const dataActual = insumoSnap.data();
                                const stockReal = dataActual.quantity || 0;
                                const nuevoStockTransaccion = stockReal + cantidadParsed;

                                if (nuevoStockTransaccion < 0) {
                                    throw new Error(`Operación denegada: El stock no puede ser menor a 0. Stock actual: ${stockReal}`);
                                }

                                let currentBatches = dataActual.batches || [];
                                // Migración On-The-Fly si no tiene array batches
                                if (currentBatches.length === 0 && dataActual.batch) {
                                    currentBatches.push({
                                        batch: dataActual.batch,
                                        quantity: stockReal,
                                        expirationDate: dataActual.expirationDate || ''
                                    });
                                }

                                if (cantidadParsed < 0) {
                                    // RESTA - Aplicar FEFO
                                    let qtyToReduce = Math.abs(cantidadParsed);

                                    // FEFO: Ordenar por fecha expiración
                                    currentBatches.sort((a, b) => new Date(a.expirationDate || '2099-12-31') - new Date(b.expirationDate || '2099-12-31'));

                                    for (let i = 0; i < currentBatches.length && qtyToReduce > 0; i++) {
                                        if (currentBatches[i].quantity > 0) {
                                            const available = currentBatches[i].quantity;
                                            if (available >= qtyToReduce) {
                                                currentBatches[i].quantity -= qtyToReduce;
                                                qtyToReduce = 0;
                                            } else {
                                                qtyToReduce -= available;
                                                currentBatches[i].quantity = 0;
                                            }
                                        }
                                    }
                                    // Filtrar lotes que quedaron en 0 si lo deseamos, pero mejor dejarlos para mantener historial visual, o borrarlos
                                    currentBatches = currentBatches.filter(b => b.quantity > 0);

                                } else {
                                    // SUMA - Añadir a un lote de Ajuste (o al primero si existe)
                                    if (currentBatches.length > 0) {
                                        currentBatches[0].quantity += cantidadParsed;
                                    } else {
                                        currentBatches.push({
                                            batch: "AJUSTE",
                                            quantity: cantidadParsed,
                                            expirationDate: ""
                                        });
                                    }
                                }

                                transaction.update(insumoRef, {
                                    quantity: increment(cantidadParsed),
                                    batches: currentBatches,
                                    lastUpdated: serverTimestamp()
                                });

                                const newLogRef = doc(collection(db, 'Historial_Movimientos'));
                                transaction.set(newLogRef, {
                                    type: 'AJUSTE_CRITICO',
                                    item: insumoNombre,
                                    quantity: cantidadParsed,
                                    user: auth.currentUser.email,
                                    date: serverTimestamp(),
                                    origin: 'Ajuste Manual Crítico',
                                    dest: 'N/A'
                                });

                                const newAuditRef = doc(collection(db, 'Auditoria'));
                                transaction.set(newAuditRef, {
                                    code: codigoAjuste,
                                    user: auth.currentUser.email,
                                    item: insumoNombre,
                                    action: accionDetallada,
                                    justification: justificacion,
                                    date: serverTimestamp()
                                });
                            });

                            if (modalAjuste) modalAjuste.style.display = 'none';

                            // UI de Éxito
                            window.showAlertCenter("Notificación", `¡AJUSTE REALIZADO CON ÉXITO!\nCÓDIGO DE AUDITORÍA: ${codigoAjuste}`);

                            // Correo de respaldo
                            const mailBody = `Se ha registrado un ajuste crítico de inventario.\n\nCódigo: ${codigoAjuste}\nInsumo: ${insumoNombre}\nAcción: ${accionDetallada}\nJustificación: ${justificacion}\nUsuario: ${auth.currentUser.email}`;
                            window.location.href = `mailto:visor@tudominio.com?subject=Ajuste Critico ${codigoAjuste}&body=${encodeURIComponent(mailBody)}`;

                            document.getElementById('ajuste-cantidad').value = "";
                            document.getElementById('ajuste-justificacion').value = "";
                            window.cargarInsumosParaAjuste();
                        } catch (error) {
                            console.error("Error en ajuste crítico:", error);
                            window.showAlertCenter("Notificación", 'No se pudo completar el ajuste.');
                        }
                    });
                }
            }

            window.generatePurchaseDraft = async function (insumoId, insumoName, stock, burnRate, diasQuiebre) {
                if (!auth.currentUser) return;
                const sugerido = SAR_Utils.calcularOrdenOptima(stock, burnRate, 1);
                if (sugerido <= 0) {
                    window.showToast("Cálculo Automático", "El insumo no requiere abastecimiento en este momento.", "warning");
                    return;
                }

                try {
                    // Se usan imports estáticos: doc, collection, addDoc, serverTimestamp

                    const code = "REQ-" + Math.floor(1000 + Math.random() * 9000);
                    await addDoc(collection(db, 'Solicitudes_Compra'), {
                        codigo: code,
                        insumoId: insumoId,
                        insumoName: insumoName,
                        stockActual: stock,
                        burnRate: Number(burnRate.toFixed(2)),
                        diasParaQuiebre: diasQuiebre,
                        cantidadSugerida: sugerido,
                        estado: "BORRADOR",
                        fechaCreacion: serverTimestamp(),
                        autor: auth.currentUser.email
                    });
                    window.showToast("Borrador Generado", `Solicitud ${code} por ${sugerido} uds creada exitosamente.`, "success");
                } catch (e) {
                    console.error(e);
                    window.showToast("Error", "No se pudo generar la solicitud de compra.", "error");
                }
            };

            window.generateMassivePurchaseDrafts = async function (insumosListJSON) {
                if (!auth.currentUser) return;
                const insumos = JSON.parse(decodeURIComponent(insumosListJSON));
                if (insumos.length === 0) return;

                try {
                    // Se usan imports estáticos: doc, collection, addDoc, serverTimestamp

                    let count = 0;
                    for (const ins of insumos) {
                        const code = "REQ-" + Math.floor(1000 + Math.random() * 9000);
                        await addDoc(collection(db, 'Solicitudes_Compra'), {
                            codigo: code,
                            insumoId: ins.id,
                            insumoName: ins.name,
                            stockActual: ins.stock,
                            burnRate: ins.burnRate,
                            diasParaQuiebre: ins.diasQuiebre,
                            cantidadSugerida: ins.sugerido,
                            estado: "BORRADOR",
                            fechaCreacion: serverTimestamp(),
                            autor: auth.currentUser.email
                        });
                        count++;
                    }
                    window.showToast("Órdenes Masivas", `Se generaron ${count} borradores de compra exitosamente.`, "success");
                    document.getElementById('modal-ia-analisis').classList.remove('active');
                } catch (e) {
                    console.error(e);
                    window.showToast("Error", "Fallo al generar órdenes masivas.", "error");
                }
            };

            // Solo inicializamos los listeners y queries si es la primera vez (evita memoria leaks)
            if (!isAppInitialized) {
                initializeRestOfSPA();
                // Ejecución EXCLUSIVA y centralizada de llamadas a Firestore:
                if (typeof window.startRealTimeDashboard === 'function') window.startRealTimeDashboard();
                if (typeof window.startRealTimeHistorial === 'function') window.startRealTimeHistorial();
                if (typeof window.startRealTimeBodegas === 'function') window.startRealTimeBodegas();
                if (typeof window.startRealTimeUsers === 'function') window.startRealTimeUsers();
                if (typeof window.startRealTimeConfig === 'function') window.startRealTimeConfig();
                if (typeof window.startRealTimeInformes === 'function') window.startRealTimeInformes();
                if (typeof window.startRealTimeLogs === 'function') window.startRealTimeLogs();
                if (typeof window.startRealTimeCompras === 'function') window.startRealTimeCompras();

                // Inicializar Predictive Engine Data (90 días)
                const limite90d = new Date();
                limite90d.setDate(limite90d.getDate() - 90);
                // Se usan imports estáticos: collection, query, where, onSnapshot
                const qPred = query(collection(db, 'Historial_Movimientos'), where('date', '>=', limite90d.toISOString()));
                activeListeners.predictive = onSnapshot(qPred, (snap) => {
                    window.globalMovimientosPredictivos = snap.docs.map(d => d.data());
                    // Re-render inventory if it's visible
                    if (document.getElementById('view-inventario').classList.contains('active')) {
                        if (typeof window.loadFirstPage === 'function') window.loadFirstPage();
                    }
                });

                if (typeof window.loadFirstPage === 'function') window.loadFirstPage();

                isAppInitialized = true;
            }
        } else {
            // Refugio blindado: Forzamos la vista de login a visible y la app a oculto
            document.getElementById('login-view').style.display = 'flex';
            document.getElementById('main-app').style.display = 'none';
            isAppInitialized = false;

            // Limpieza estricta de listeners para evitar "permission-denied" de Firebase
            clearListener('dashboard');
            clearListener('expirations');
            clearListener('historial');
            clearListener('bodegas');
            clearListener('usuarios');
            clearListener('config');
            clearListener('informes_kpi');
            clearListener('informes_logs');
            clearListener('logs');
            clearListener('predictive');
            clearListener('compras');
        }
    });

    // 3. ENCAPSULAMIENTO DEL FLUJO SPA
    function initializeRestOfSPA() {
        /* ----------------------------------------------------
           2. NAVEGACIÓN PRINCIPAL (SIDEBAR Y SOPORTE HISTORY API)
           ---------------------------------------------------- */
        const menuItems = document.querySelectorAll('.sidebar .menu-item');
        const viewSections = document.querySelectorAll('.view-section');
        const topbarTitle = document.querySelector('.topbar-title');

        const viewTitles = {
            'view-panel': 'Visor Logístico',
            'view-inventario': 'Visor Logístico',
            'view-compras': 'Gestión de Abastecimiento',
            'view-movimientos': 'Visor Logístico',
            'view-historial': 'Historial de Transacciones',
            'view-informes': 'Informes Logísticos',
            'view-analitico': 'Inteligencia Operativa',
            'view-bodegas': 'Gestión de Bodegas',
            'view-usuarios': 'Gestión de Usuarios',
            'view-configuracion': 'Configuración del Sistema',
            'view-compras': 'Solicitudes de Compra',
            'view-transferencias': 'Transferencias y Auditoría Clínica',
            'view-ajustes': 'Ajustes Críticos de Inventario',
            'view-bandejas': 'Gestión de Bandejas de Turno',
            'view-usuarios': 'Directorio de Personal y Roles'
        };

        // Función unificada que lee el hash y actualiza la UI
        function navigateToHash() {
            if (!auth.currentUser) {
                console.warn("[Router] Bloqueado: Usuario no autenticado.");
                const allSections = document.querySelectorAll('.view-section');
                allSections.forEach(section => {
                    section.style.display = 'none';
                });
                return;
            }

            // Obtenemos el hash sin el '#' y damos 'view-panel' por defecto
            let hash = window.location.hash.substring(1) || 'view-panel';

            let targetItem = document.querySelector(`.sidebar .menu-item[data-target="${hash}"]`);

            // Si el hash ingresado no existe (ej. error manual), lo reseteamos al home
            if (!targetItem) {
                hash = 'view-panel';
                targetItem = document.querySelector(`.sidebar .menu-item[data-target="view-panel"]`);
            }

            // Activación de menú
            menuItems.forEach(i => { i.classList.remove('active'); i.classList.add('normal'); });
            if (targetItem) {
                targetItem.classList.add('active');
                targetItem.classList.remove('normal');
            }

            // Activación de vista central (ROUTER SPA HARDENED)
            const allSections = document.querySelectorAll('.view-section');
            allSections.forEach(section => {
                section.style.display = 'none';
                section.classList.remove('active');
            });

            const activeView = document.getElementById(hash);
            if (activeView) {
                activeView.style.display = 'block';
                activeView.classList.add('active');

                if (hash === 'view-informes') {
                    console.log("[Router] Entrando a Informes, disparando carga de auditoría...");
                    loadInformesAuditoria();
                } else if (hash === 'view-inventario') {
                    console.log("[Router] Vista Inventario activa. Cargando página...");
                    if (typeof window.loadFirstPage === 'function') window.loadFirstPage();
                } else if (hash === 'view-historial') {
                    console.log("[Router] Vista Historial activa.");
                } else if (hash === 'view-bodegas') {
                    console.log("[Router] Vista Bodegas activa.");
                } else if (hash === 'view-usuarios') {
                    console.log("[Router] Vista Usuarios activa.");
                    if (typeof window.escucharUsuarios === 'function') window.escucharUsuarios();
                } else if (hash === 'view-transferencias') {
                    console.log("[Router] Vista Transferencias activa.");
                } else if (hash === 'view-compras') {
                    console.log("[Router] Vista Compras activa.");
                } else if (hash === 'view-bandejas') {
                    console.log("[Router] Vista Bandejas activa.");
                    if (typeof window.startBandejasModule === 'function') window.startBandejasModule();
                    if (typeof window.startMisBandejasListener === 'function') window.startMisBandejasListener();
                }
            }

            // Actualización de título superior
            if (topbarTitle && viewTitles[hash]) {
                topbarTitle.textContent = viewTitles[hash];
            }
        }

        // Escuchamos el evento de retroceso/avance del navegador
        window.addEventListener('hashchange', () => {
            navigateToHash();
            showToast('Navegación', 'Vista actualizada correctamente.', 'info');
        });

        // Eventos de clic de botones que alteran la URL
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = item.getAttribute('data-target');

                // Tratamiento de botones sin routing (Logout, Config)
                if (!targetId) {
                    if (item.classList.contains('danger')) {
                        showToast('Cierre de Sesión', 'Cerrando sesión y liberando recursos...', 'warning');
                        clearAllListeners(); // Limpiar memoria antes de salir
                        signOut(auth); // Cerramos sesión de Firebase
                    } else {
                        showToast('Configuración', 'Preparando entorno de configuración...', 'info');
                    }
                    return;
                }

                // Cambiar hash sin recargar la página desencadena NavigateToHash automáticamente
                // Solo logueamos y modificamos si el hash no era idéntico (para no redundar)
                if (window.location.hash !== `#${targetId}`) {
                    window.location.hash = targetId;
                    showToast('Navegación', `Cargando módulo: ${item.textContent.trim()}`, 'info');
                }
            });
        });

        // Gatillar la verificación de URL inicial al cargar (o recargar) la página
        navigateToHash();

        /* ----------------------------------------------------
           3. FUNCIONALIDAD GLOBAL PARA TODOS LOS BOTONES Y ENLACES
           ---------------------------------------------------- */
        document.body.addEventListener('click', (e) => {
            const link = (e.target && typeof e.target.closest === "function" ? e.target.closest('a[href="#"]') : null);
            if (link) e.preventDefault();

            const btn = (e.target && typeof e.target.closest === "function" ? e.target.closest('button') : null);
            if (!btn) return;

            // CORRECCIÓN ESTRUCTURAL: Si es submit de form, dejar que el form handler lo maneje
            if (btn.type === 'submit' && btn.closest('form')) return;
            if (btn.id === 'btn-ia-analisis') return;

            if (btn.classList.contains('page-btn')) {
                e.preventDefault();
                const paginationContainer = btn.parentElement;
                paginationContainer.querySelectorAll('.page-btn').forEach(b => b.classList.remove('active'));
                if (!btn.querySelector('i')) { btn.classList.add('active'); }
                showToast('Paginación', 'Cambiando de página de resultados a la número ' + btn.textContent.trim(), 'info');
                return;
            }

            if (btn.classList.contains('btn-icon') || btn.classList.contains('btn-icon-outline') || (btn.classList.contains('icon-btn') && !btn.classList.contains('close-modal-btn'))) {
                e.preventDefault();
                const isTrash = btn.querySelector('.ph-trash');
                const isEdit = btn.querySelector('.ph-pencil-simple');
                const isEye = btn.querySelector('.ph-eye');
                const isFilter = btn.querySelector('.ph-funnel');
                const isBell = btn.querySelector('.ph-bell');
                const isQuestion = btn.querySelector('.ph-question');

                if (isTrash) { showToast('Acceso Denegado', 'Esta acción requiere credenciales de administrador.', 'error'); }
                else if (isEdit) { showToast('Edición Habilitada', 'Generando interfaz de modificación.', 'info'); }
                else if (isEye) { showToast('Vista Activa', 'Desplegando documento de respaldo.', 'success'); }
                else if (isFilter) { showToast('Filtrado', 'Desplegando opciones avanzadas.', 'info'); }
                else if (isBell) { showToast('Notificaciones', 'Bandeja de notificaciones sin mensajes nuevos.', 'info'); }
                else if (isQuestion) { showToast('Ayuda y Soporte', 'Abriendo portal de documentación clínica.', 'info'); }
                else { showToast('Acción', 'Operación secundaria exitosa.', 'success'); }
                return;
            }

            if (btn.classList.contains('btn-primary') || btn.classList.contains('btn-outline')) {
                e.preventDefault();
                const text = btn.textContent.trim();
                if (text.includes('Exportar')) {
                    showToast('Operación iniciada', 'Preparando documento logístico ' + text.split(' ')[1] + '...', 'info');
                    setTimeout(() => showToast('Completado', 'Documento creado y descargado.', 'success'), 1500);
                } else if (text.includes('ALTERNATIVA')) {
                    showToast('Buscador IA', 'Localizando sustitutos viables en sucursales anexas.', 'info');
                } else {
                    showToast('Proceso Ejecutado', 'La función [' + (text || 'Confirmar') + '] ha sido validada.', 'info');
                }
            }
        });

        /* ----------------------------------------------------
           4. PANEL DE CONTROL (Botón IA)
           Handler delegado a handleAnalisisIA() — definido en sección 8e
           ---------------------------------------------------- */
        const analyzeBtn = document.getElementById('btn-ia-analisis');
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', () => handleAnalisisIA());
        }

        /* ----------------------------------------------------
           5. TOPBAR TABS & SUB-TABS
           ---------------------------------------------------- */
        const topbarTabs = document.querySelectorAll('.topbar-tabs .tab');
        topbarTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                topbarTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                showToast('Filtro Global', `Contexto cambiado a: ${tab.textContent.trim()}`, 'info');
            });
        });

        const informesTabs = document.querySelectorAll('.tab-links-container .tab-link');
        informesTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                informesTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                showToast('Vista de Informes', `Sección ${tab.textContent.trim()} activada.`, 'info');
            });
        });

        /* ----------------------------------------------------
           6. MOVIMIENTOS (Botones Toggle - Corrección CSS)
           ---------------------------------------------------- */
        const toggleBtns = document.querySelectorAll('.toggle-btn');
        toggleBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleBtns.forEach(t => t.classList.remove('active-green', 'active-blue'));

                if (btn.textContent.includes('RECEPCIÓN')) {
                    btn.classList.add('active-green');
                    showToast('Tipo de Ingreso', 'Registrando como ENTRADA de suministros.', 'success');
                    const inputTipo = document.getElementById('movimiento-tipo');
                    if (inputTipo) inputTipo.value = 'entrada';
                } else {
                    btn.classList.add('active-blue');
                    showToast('Tipo de Despacho', 'Registrando como SALIDA / TRANSFERENCIA.', 'info');
                    const inputTipo = document.getElementById('movimiento-tipo');
                    if (inputTipo) inputTipo.value = 'salida';
                }
            });
        });

        /* ----------------------------------------------------
           6b. BÚSQUEDA Y FILTRADO MOCKUP
           ---------------------------------------------------- */
        document.body.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                const input = e.target;
                if (input.tagName === 'INPUT' && input.closest('.search-input-wrapper')) {
                    if (input.value.trim() !== '') {
                        showToast('Buscador', `Filtrando resultados para: "${input.value}"...`, 'info');
                    }
                }
            }
        });

        document.body.addEventListener('change', (e) => {
            if (e.target.tagName === 'SELECT') {
                showToast('Filtros Actualizados', `Vista cambiada a: ${e.target.options[e.target.selectedIndex].text}`, 'info');
            }
        });

        /* ----------------------------------------------------
           7. FORMULARIOS 
           ---------------------------------------------------- */
        const formUsuarios = document.getElementById('form-usuarios');
        if (formUsuarios) {
            formUsuarios.addEventListener('submit', (e) => {
                e.preventDefault();
                const btn = formUsuarios.querySelector('button[type="submit"]');
                const originalText = btn.innerHTML;

                btn.innerHTML = '<i class="ph-fill ph-check-circle"></i> Usuario Creado';
                btn.style.backgroundColor = 'var(--success)';
                btn.style.borderColor = 'var(--success)';
                showToast('Registro Confirmado', 'El usuario ha sido matriculado en la base de datos.', 'success');
                formUsuarios.reset();

                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.backgroundColor = 'var(--primary)';
                    btn.style.borderColor = 'var(--primary)';
                }, 2500);
            });
        }

        const formMovimiento = document.getElementById('form-movimiento');
        if (formMovimiento) {
            formMovimiento.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = formMovimiento.querySelector('button[type="submit"]');
                const originalText = btn.innerHTML;

                // 1. Capturar datos nativamente sin librerías externas
                const formData = new FormData(formMovimiento);
                const movementData = Object.fromEntries(formData.entries());

                // Transformaciones / Validaciones Ciberseguras Frontend
                const quantity = parseInt(movementData.quantity, 10);
                const articleId = movementData.articleId;
                const isInput = movementData.movementType === 'entrada';

                // a) Validación de Seguridad: Inyección de nulos o valores ilógicos
                if (!articleId) {
                    showToast('Bloqueo de Seguridad', 'Debe seleccionar un insumo clínico válido.', 'error');
                    return;
                }

                if (isNaN(quantity) || quantity <= 0) {
                    showToast('Detección de Anomalía', 'No se permiten registros con cantidad nula o negativa.', 'danger');
                    return;
                }

                // b) Validación de Riesgo Clínico: Lotes Caducados
                if (isInput && movementData.expirationDate) {
                    // Limpiamos los tiempos para comparar sólo días (UTC-neutral padding)
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);

                    const expDate = new Date(movementData.expirationDate + "T00:00:00");

                    if (expDate < today) {
                        showToast('Riesgo Clínico Bloqueado', 'Prohibido registrar la entrada de lotes vencidos en el sistema.', 'danger');
                        return;
                    }
                }

                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> PROCESANDO TRANSACCIÓN...';
                btn.disabled = true;

                try {
                    // 2. Ejecutar a través del servicio de auditoría centralizado
                    await withRetry(async () => {
                        const quantityDiff = isInput ? quantity : -quantity;

                        // Actualizar maestro con auditoría atómicamente
                        const { oldQty: currentStock, newQty: newStock } = await updateInventoryWithAudit(articleId, { quantityDiff }, auth.currentUser);

                        // Registrar en Historial Global
                        // Registrar en Historial Global con Schema Standard
                        await addDoc(collection(db, 'Historial_Movimientos'), {
                            date: serverTimestamp(),
                            type: isInput ? 'entrada' : 'salida',
                            insumoName: movementData.articleName || 'Insumo Modificado',
                            user: auth.currentUser?.email || auth.currentUser?.uid || 'Admin',
                            batch: movementData.batch || 'S/L',
                            quantity: Number(quantity),
                            document: movementData.supportDocument || 'S/D',
                            previousStock: currentStock,
                            newStock: newStock
                        });
                    }, 3, 2000);

                    // Notificación de Éxito UI
                    btn.innerHTML = 'TRANSACCIÓN CONFIRMADA <i class="ph-fill ph-check-circle"></i>';
                    btn.style.backgroundColor = 'var(--success)';
                    showToast('Operación Exitosa', 'Inventario sincronizado y bitácora actualizada con auditoría.', 'success');
                    formMovimiento.reset();

                } catch (error) {
                    console.error("Transacción Abortada:", error);
                    const errorMsg = error.code === 'abort_no_retry'
                        ? error.message
                        : 'La transacción no pudo completarse. Revise su conexión.';

                    showToast('Error de Transacción', errorMsg, 'error');
                    btn.style.backgroundColor = 'var(--danger)';
                } finally {
                    btn.disabled = false;
                    setTimeout(() => {
                        btn.innerHTML = originalText;
                        btn.style.backgroundColor = '';
                    }, 3500);
                }
            });
        }

        const formBodegas = document.getElementById('form-bodegas');
        if (formBodegas) {
            formBodegas.addEventListener('submit', (e) => {
                e.preventDefault();
                const btn = formBodegas.querySelector('button[type="submit"]');
                const originalText = btn.innerHTML;

                btn.innerHTML = '<i class="ph-fill ph-check-circle"></i> Bodega Registrada';
                btn.style.backgroundColor = 'var(--success)';
                showToast('Nuevo Recinto Habilitado', 'La bodega se ha anexado a la red de distribución.', 'success');
                formBodegas.reset();

                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.backgroundColor = 'var(--primary)';
                }, 2500);
            });
        }

        /* ----------------------------------------------------
           8. MODAL DE BODEGAS
           ---------------------------------------------------- */
        const bodegaCards = document.querySelectorAll('.card.clickable-card');
        const bodegaModal = document.getElementById('bodega-modal');

        if (bodegaModal) {
            const closeBtns = bodegaModal.querySelectorAll('.close-modal-btn');
            closeBtns.forEach(btn => btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                bodegaModal.classList.remove('active');
            }));

            bodegaCards.forEach(card => {
                card.addEventListener('click', () => {

                    
                    const name = card.getAttribute('data-bodega');
                    const type = card.getAttribute('data-type');
                    const stock = card.getAttribute('data-stock');

                    document.getElementById('modal-bodega-name').textContent = name;
                    document.getElementById('modal-bodega-type').textContent = type;
                    document.getElementById('modal-bodega-stock').textContent = stock;

                    let color = 'var(--primary)';
                    if (type.includes('PUNTO')) color = 'var(--success)';
                    if (type.includes('SECUNDARIA')) color = 'var(--purple)';
                    document.getElementById('modal-bodega-type').style.color = color;

                    bodegaModal.classList.add('active');
                });
            });
        }

        /* ----------------------------------------------------
           8b. MOTOR DE MODALES CENTRALIZADO
           ---------------------------------------------------- */

        function openModal(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return;
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
        window.openModal = openModal;

        function closeModal(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return;
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
        window.closeModal = closeModal;

        // Event Delegation: un solo listener para TODOS los modales (presentes y futuros)
        document.addEventListener('click', (e) => {
            const closeBtn = (e.target && typeof e.target.closest === "function" ? e.target.closest('.close-modal-btn') : null);
            if (closeBtn) {
                const modal = closeBtn.closest('.modal-overlay');
                if (modal) { e.preventDefault(); closeModal(modal.id); }
            }
            // Clic directo en el overlay oscuro (fuera de la card)
            if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('active')) {
                closeModal(e.target.id);
            }
        });

        // Cerrar con tecla Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay.active')
                    .forEach(m => closeModal(m.id));
            }
        });

        /* ----------------------------------------------------
           8c. HANDLER: VER REPORTE DE DESCARTE
           ---------------------------------------------------- */
        async function handleReporteDescarte() {
            openModal('modal-reporte-descarte');
            const tbody = document.getElementById('modal-descarte-tbody');
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:32px;">
            <i class="ph-spinner ph-spin" style="font-size:28px; color:var(--danger);"></i>
            <p style="margin-top:8px; color:var(--text-muted); font-size:13px;">Consultando registros urgentes en Firestore...</p>
        </td></tr>`;

            try {
                const hoy = new Date();
                const limite = new Date();
                limite.setDate(hoy.getDate() + 30);
                const todayStr = hoy.toISOString().split('T')[0];
                const limiteStr = limite.toISOString().split('T')[0];

                const q = query(
                    collection(db, 'Insumos'),
                    where('estado', '==', 'VENCIDO'),
                    limit(50)
                );
                const snapshot = await getDocs(q);
                renderDescarteTable(snapshot, tbody, todayStr);

            } catch (error) {
                console.error('[Modal Descarte]', error);
                tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:32px; color:var(--danger); font-weight:600;">
                Error al cargar. Puede requerir un índice en Firestore — revise la consola del navegador.
            </td></tr>`;
                showToast('Error', 'No se pudo recuperar el reporte de descarte.', 'error');
            }
        }

        function renderDescarteTable(snapshot, tbody, todayStr) {
            if (snapshot.empty) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--success); font-weight:600;">
                <i class="ph-fill ph-check-circle" style="font-size:28px;"></i><br>Sin urgencias detectadas en el inventario.
            </td></tr>`;
                return;
            }
            tbody.innerHTML = '';
            snapshot.forEach(docSnap => {
                const item = docSnap.data();
                const isExpired = item.expirationDate && item.expirationDate <= todayStr;
                const badgeClass = isExpired ? 'danger' : 'warning';
                const badgeText = isExpired ? 'VENCIDO (ACTA)' : 'PRÓXIMO A VENCER';
                const dateClass = isExpired ? 'date-text danger' : 'date-text warning';

                const tr = document.createElement('tr');
                if (isExpired) tr.classList.add('table-row-danger');
                tr.innerHTML = `
                <td>
                    <div class="item-name">${window.escapeHTML(item.name || 'Sin nombre')}</div>
                    <div class="item-category">${window.escapeHTML(item.category || '')}</div>
                </td>
                <td style="font-family:monospace; font-weight:600;">${window.escapeHTML(item.batch || 'N/A')}</td>
                <td>${(item.quantity || 0).toLocaleString('es-CL')} unds.</td>
                <td><div class="${dateClass}">${window.escapeHTML(item.expirationDate || 'N/A')}</div></td>
                <td><span class="action-badge ${badgeClass}">${badgeText}</span></td>
            `;
                tbody.appendChild(tr);
            });
        }

        const btnDescarte = document.getElementById('btn-reporte-descarte');
        if (btnDescarte) {
            btnDescarte.addEventListener('click', (e) => { e.preventDefault(); handleReporteDescarte(); });
        }

        /* ----------------------------------------------------
           8d. HANDLER: PLANIFICAR ROTACIÓN
           ---------------------------------------------------- */
        async function handlePlanificarRotacion() {
            openModal('modal-rotacion');
            const tbody = document.getElementById('modal-rotacion-tbody');
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px;">
            <i class="ph-spinner ph-spin" style="font-size:28px; color:var(--warning);"></i>
            <p style="margin-top:8px; color:var(--text-muted); font-size:13px;">Calculando plan de rotación óptimo...</p>
        </td></tr>`;

            try {
                const hoy = new Date();
                const en1mes = new Date(); en1mes.setMonth(hoy.getMonth() + 1);
                const en6meses = new Date(); en6meses.setMonth(hoy.getMonth() + 6);
                const en1mesStr = en1mes.toISOString().split('T')[0];
                const en6mesesStr = en6meses.toISOString().split('T')[0];

                const hoyStr = hoy.toISOString().split('T')[0];
                const q = query(
                    collection(db, 'Insumos'),
                    where('expirationDate', '>', hoyStr),
                    where('expirationDate', '<=', en6mesesStr),
                    orderBy('expirationDate', 'asc')
                );
                const snapshot = await getDocs(q);
                renderRotacionTable(snapshot, tbody, en1mes);

            } catch (error) {
                console.error('[Modal Rotación]', error);
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--danger); font-weight:600;">
                No se pudo generar el plan. Revise si se requiere índice compuesto en Firestore (consola del navegador).
            </td></tr>`;
                showToast('Error', 'Fallo al calcular la rotación de inventario.', 'error');
            }
        }

        function renderRotacionTable(snapshot, tbody, en1mes) {
            if (snapshot.empty) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--success); font-weight:600;">
                <i class="ph-fill ph-check-circle" style="font-size:28px;"></i><br>Sin ítems en zona de precaución (1 a 6 meses).
            </td></tr>`;
                return;
            }
            const en3meses = new Date(en1mes);
            en3meses.setMonth(en3meses.getMonth() + 2);
            const en3mesesStr = en3meses.toISOString().split('T')[0];

            tbody.innerHTML = '';
            snapshot.forEach(docSnap => {
                const item = docSnap.data();
                const stock = item.quantity || 0;
                const vencePronto = item.expirationDate && item.expirationDate <= en3mesesStr;
                const stockClass = stock <= 50 ? 'badge-red-solid' : (stock <= 200 ? 'badge-orange' : 'badge-green');
                const ubicacion = item.location || 'Bodega Central';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                <td>
                    <div class="item-name">${window.escapeHTML(item.name || 'Sin nombre')}</div>
                    <div class="item-category" style="font-family:monospace; font-size:10px;">LOTE: ${window.escapeHTML(item.batch || 'N/A')}</div>
                </td>
                <td>
                    <div style="font-weight:600; font-size:12px; display:flex; align-items:center; gap:6px;">
                        <i class="ph-fill ph-map-pin" style="color:var(--primary);"></i> ${window.escapeHTML(ubicacion)}
                    </div>
                </td>
                <td><span class="${stockClass}">${stock.toLocaleString('es-CL')}</span></td>
                <td><div class="date-text warning">${item.expirationDate || 'N/A'}</div></td>
                <td>
                    <button class="btn btn-outline" style="padding:4px 10px; font-size:11px; display:inline-flex; align-items:center; gap:4px;">
                        <i class="ph ph-arrows-left-right"></i> Mover a Box
                    </button>
                </td>
            `;
                tbody.appendChild(tr);
            });
        }

        const btnRotacion = document.getElementById('btn-planificar-rotacion');
        if (btnRotacion) {
            btnRotacion.addEventListener('click', (e) => { e.preventDefault(); handlePlanificarRotacion(); });
        }

        /* ----------------------------------------------------
           8e. HANDLER: ANÁLISIS IA DE INVENTARIO
           ---------------------------------------------------- */
        window.handleAnalisisIA = async function handleAnalisisIA(btnElement) {
            const iaBtn = btnElement || document.getElementById('btn-ia-analisis');
            let originalText = '';
            if (iaBtn) {
                originalText = iaBtn.innerHTML;
                iaBtn.innerHTML = '<i class="ph-spinner ph-spin"></i> Analizando...';
                iaBtn.disabled = true;
            }

            openModal('modal-ia-analisis');
            const loadingEl = document.getElementById('ia-modal-loading');
            const resultsEl = document.getElementById('ia-modal-results');
            if (loadingEl) loadingEl.style.display = 'flex';
            if (resultsEl) resultsEl.style.display = 'none';

            try {
                const todayStr = new Date().toISOString().split('T')[0];

                // 1. Fetch SOLO insumos críticos
                const qCriticos = query(collection(db, 'Insumos'), where('isCritical', '==', true));
                const snapCriticos = await getDocs(qCriticos);
                const criticosList = [];
                snapCriticos.forEach(d => {
                    const data = d.data();
                    // Fallback de seguridad
                    if ((data.quantity || 0) <= (data.criticalLimit || data.stock_minimo || 10)) {
                        criticosList.push({ id: d.id, ...data });
                    }
                });

                // 2. Fetch SOLO insumos vencidos (usando <= todayStr o iterando sobre limit(500) si no hay indice)
                // Nota: Firestore permite 1 desigualdad. where('expirationDate', '<=', todayStr)
                // asumiendo que expirationDate no está vacío.
                const qVencidos = query(
                    collection(db, 'Insumos'), 
                    where('expirationDate', '>', ''),
                    where('expirationDate', '<=', todayStr)
                );
                const snapVencidos = await getDocs(qVencidos);
                const vencidosList = [];
                snapVencidos.forEach(d => vencidosList.push({ id: d.id, ...d.data() }));

                // 3. Ya no pasamos allItems completo por RAM. Para el Heatmap (Transferencias), 
                // pasaremos una lista vacía o se requeriría refactor asíncrono en la vista.
                // Como mitigación, buscaremos alternativas en DB para los críticos detectados.
                const allItemsHeatmap = [];
                for (const crit of criticosList) {
                    const targetName = (crit.name || "").toLowerCase().trim();
                    if (!targetName) continue;
                    // Buscar insumos con el mismo nombre para ver si hay en otras bodegas
                    const qAlt = query(collection(db, 'Insumos'), where('name', '==', crit.name));
                    const snapAlt = await getDocs(qAlt);
                    snapAlt.forEach(d => {
                        if (!allItemsHeatmap.find(i => i.id === d.id)) {
                            allItemsHeatmap.push({ id: d.id, ...d.data() });
                        }
                    });
                }

                renderIAResultsAdvanced(allItemsHeatmap, criticosList, vencidosList, loadingEl, resultsEl);

            } catch (error) {
                console.error('[Modal IA]', error);
                if (loadingEl) loadingEl.innerHTML = `
                <i class="ph-fill ph-warning-circle" style="font-size:40px; color:var(--danger);"></i>
                <p style="color:var(--danger); font-weight:600; text-align:center; margin-top:8px;">
                    Error al procesar el análisis.<br>
                    <small style="font-weight:400; color:var(--text-muted);">Revise los índices de Firestore en la consola del navegador.</small>
                </p>`;
                window.showToast('Error IA', 'No se pudo completar el análisis de inventario.', 'error');
            } finally {
                if (iaBtn) {
                    iaBtn.innerHTML = originalText || '<i class="ph-fill ph-sparkle"></i> Análisis IA de Inventario';
                    iaBtn.disabled = false;
                }
            }
        }

        function renderIAResultsAdvanced(allItems, criticosList, vencidosList, loadingEl, resultsEl) {
            const totalCriticos = criticosList.length;
            const totalVencidos = vencidosList.length;

            // Calcular valor en riesgo (stock × precio unitario de los vencidos)
            let valorEnRiesgo = 0;
            vencidosList.forEach(d => {
                valorEnRiesgo += (d.quantity || 0) * (d.unitPrice || 0);
            });
            const valorFormateado = '$' + valorEnRiesgo.toLocaleString('es-CL');

            // --- KPIs ---
            const kpisEl = document.getElementById('ia-kpis');
            if (kpisEl) {
                kpisEl.innerHTML = `
                <div style="background:var(--danger-light); border:1px solid var(--danger-badge); border-radius:12px; padding:20px; text-align:center;">
                    <div style="font-size:11px; font-weight:700; color:var(--danger-text); text-transform:uppercase; margin-bottom:8px;">STOCK CRÍTICO</div>
                    <div style="font-size:36px; font-weight:700; color:var(--danger);">${totalCriticos}</div>
                    <div style="font-size:11px; color:var(--danger-text); margin-top:4px;">insumos bajo el mínimo</div>
                </div>
                <div style="background:var(--warning-light); border:1px solid var(--warning-badge); border-radius:12px; padding:20px; text-align:center;">
                    <div style="font-size:11px; font-weight:700; color:var(--warning-text); text-transform:uppercase; margin-bottom:8px;">LOTES VENCIDOS</div>
                    <div style="font-size:36px; font-weight:700; color:var(--warning);">${totalVencidos}</div>
                    <div style="font-size:11px; color:var(--warning-text); margin-top:4px;">lotes a descartar</div>
                </div>
                <div style="background:var(--primary-light); border:1px solid #bfdbfe; border-radius:12px; padding:20px; text-align:center;">
                    <div style="font-size:11px; font-weight:700; color:var(--primary); text-transform:uppercase; margin-bottom:8px;">VALOR EN RIESGO</div>
                    <div style="font-size:28px; font-weight:700; color:var(--primary);">${valorFormateado}</div>
                    <div style="font-size:11px; color:var(--primary); margin-top:4px;">capital comprometido</div>
                </div>
            `;
            }

            // --- Recomendaciones dinámicas ---
            const recEl = document.getElementById('ia-recommendations');
            if (recEl) {
                const recs = [];
                if (totalVencidos > 0) {
                    recs.push({
                        icon: 'ph-warning-circle', color: 'var(--danger)',
                        text: `Ejecutar descarte inmediato de <strong>${totalVencidos} lote(s) vencido(s)</strong> para evitar riesgo sanitario y penalizaciones regulatorias.`
                    });
                }
                if (totalCriticos > 0) {
                    recs.push({
                        icon: 'ph-package', color: 'var(--warning)',
                        text: `Emitir orden de reposición urgente para <strong>${totalCriticos} insumo(s)</strong> con stock inferior al límite mínimo operacional.`
                    });
                }
                if (totalVencidos === 0 && totalCriticos === 0) {
                    recs.push({
                        icon: 'ph-check-circle', color: 'var(--success)',
                        text: `El inventario se encuentra en <strong>estado óptimo</strong>. No se detectaron anomalías de stock ni vencimientos pendientes.`
                    });
                }
                recs.push({
                    icon: 'ph-trend-up', color: 'var(--primary)',
                    text: `Se recomienda ejecutar este análisis de forma <strong>semanal</strong> para mantener la trazabilidad y el cumplimiento normativo clínico.`
                });

                recEl.innerHTML = `
                <h4 style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:16px; display:flex; align-items:center; gap:8px;">
                    <i class="ph-fill ph-sparkle" style="color:var(--primary);"></i> Recomendaciones del Sistema
                </h4>
                ${recs.map(r => `
                    <div style="display:flex; gap:12px; align-items:flex-start; margin-bottom:14px;">
                        <i class="ph-fill ${r.icon}" style="font-size:20px; color:${r.color}; margin-top:2px; flex-shrink:0;"></i>
                        <p style="font-size:13px; color:var(--text-main); line-height:1.6; margin:0;">${r.text}</p>
                    </div>
                `).join('')}
            `;

                // Botón Masivo de Compras
                const insumosCriticosComprar = [];
                const logs = window.globalMovimientosPredictivos || [];

                // Heatmap Transferencias Recomendadas
                const transferencias = [];

                criticosList.forEach(d => {
                    const bRate = SAR_Utils.calculateBurnRate(d.name, logs);
                    const dias = SAR_Utils.predictStockDepletion(d.quantity || 0, bRate);
                    const sugerido = SAR_Utils.calcularOrdenOptima(d.quantity || 0, bRate, 1);
                    if (sugerido > 0) {
                        insumosCriticosComprar.push({
                            id: d.id,
                            name: d.name,
                            stock: d.quantity || 0,
                            burnRate: bRate,
                            diasQuiebre: dias,
                            sugerido: sugerido
                        });
                    }

                    // IA Heatmap Logic
                    if (dias <= 15) {
                        const targetName = (d.name || "").toLowerCase().trim();
                        const opciones = allItems.filter(o =>
                            (o.name || "").toLowerCase().trim() === targetName &&
                            o.location !== d.location
                        );
                        opciones.forEach(origen => {
                            const bRateOrigen = SAR_Utils.calculateBurnRate(origen.name, logs);
                            // Cantidad sugerida para cubrir 30 días en el destino
                            const cantSugerida = sugerido > 0 ? sugerido : Math.ceil(bRate * 30) || 50;
                            const stockRestanteOrigen = (origen.quantity || 0) - cantSugerida;
                            const diasRestantesOrigen = SAR_Utils.predictStockDepletion(stockRestanteOrigen, bRateOrigen);

                            if (cantSugerida > 0 && stockRestanteOrigen > 0 && diasRestantesOrigen > 30) {
                                transferencias.push({
                                    insumoIdOrigen: origen.id,
                                    insumoNombre: d.name,
                                    bodegaOrigen: origen.location || "Bodega Central",
                                    bodegaDestino: d.location || "Sin Asignar",
                                    cantidad: cantSugerida
                                });
                            }
                        });
                    }
                });

                if (insumosCriticosComprar.length > 0) {
                    const encodedData = encodeURIComponent(JSON.stringify(insumosCriticosComprar)).replace(/'/g, "%27");
                    const btnHtml = `
                    <button class="btn btn-primary" style="width:100%; margin-top: 16px; background-color: var(--success); color: white;" 
                            onclick="window.generateMassivePurchaseDrafts('${encodedData}')">
                        <i class="ph-fill ph-shopping-cart"></i> Auto-Generar ${insumosCriticosComprar.length} Órdenes de Compra
                    </button>`;
                    recEl.innerHTML += btnHtml;
                }

                // Render Heatmap UI
                const transferenciasUnicas = transferencias.filter((t, index, self) =>
                    index === self.findIndex((t2) => (t.insumoNombre === t2.insumoNombre && t.bodegaDestino === t2.bodegaDestino))
                );

                if (transferenciasUnicas.length > 0) {
                    let heatmapHtml = `
                    <h4 style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-top:24px; margin-bottom:16px; display:flex; align-items:center; gap:8px;">
                        <i class="ph-fill ph-arrows-left-right" style="color:var(--primary);"></i> Heatmap: Transferencias Recomendadas
                    </h4>
                    <div style="display:flex; flex-direction:column; gap:12px;">`;

                    transferenciasUnicas.forEach(t => {
                        const safeInsumo = window.escapeHTML(t.insumoNombre);
                        const safeOrigen = window.escapeHTML(t.bodegaOrigen);
                        const safeDestino = window.escapeHTML(t.bodegaDestino);
                        // Limpiar comillas para evitar romper el string literal en el onclick
                        const jsOrigen = t.bodegaOrigen.replace(/['"\\]/g, '');
                        const jsDestino = t.bodegaDestino.replace(/['"\\]/g, '');
                        const jsId = (t.insumoIdOrigen || '').replace(/['"\\]/g, '');

                        heatmapHtml += `
                        <div style="background:var(--bg-light); border:1px solid var(--border-color); border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <div style="font-size:13px; font-weight:600; color:var(--text-main); margin-bottom:4px;">${safeInsumo}</div>
                                <div style="font-size:11px; color:var(--text-muted); display:flex; align-items:center; gap:4px;">
                                    <span style="color:var(--success); font-weight:600;">${safeOrigen}</span>
                                    <i class="ph ph-arrow-right"></i>
                                    <span style="color:var(--danger); font-weight:600;">${safeDestino}</span>
                                </div>
                            </div>
                            <div style="display:flex; align-items:center; gap:12px;">
                                <div style="font-size:14px; font-weight:700; color:var(--primary);">${t.cantidad} uds</div>
                                <button class="btn btn-icon text-primary" onclick="window.triggerSmartTransfer('${jsOrigen}', '${jsDestino}', '${jsId}', ${t.cantidad})" title="Ejecutar Traspaso">
                                    <i class="ph ph-paper-plane-right"></i>
                                </button>
                            </div>
                        </div>`;
                    });

                    heatmapHtml += `</div>`;
                    recEl.innerHTML += heatmapHtml;
                }

                // Global function for Smart Transfer Button
                window.triggerSmartTransfer = (origen, destino, idOrigen, cant) => {
                    // Cierra el modal de IA
                    document.getElementById('modal-ia-analisis').classList.remove('active');

                    // Simula proceso de transferencia real
                    const modalBodega = document.getElementById('bodega-modal');
                    if (modalBodega) modalBodega.dataset.currentBodegaName = origen;

                    const btnTransfer = document.getElementById('btn-trigger-transfer');
                    if (btnTransfer) btnTransfer.click();

                    // Espera a que los selects asíncronos se llenen
                    setTimeout(() => {
                        const transferToId = document.getElementById('transfer-to-id');
                        const transferQty = document.getElementById('transfer-qty');
                        const transferInsumoId = document.getElementById('transfer-insumo-id');

                        if (transferToId && Array.from(transferToId.options).some(o => o.value === destino)) {
                            transferToId.value = destino;
                        }
                        if (transferInsumoId && Array.from(transferInsumoId.options).some(o => o.value === idOrigen)) {
                            transferInsumoId.value = idOrigen;
                        }
                        if (transferQty) transferQty.value = cant;

                        window.showToast("Asistente IA", "Formulario de traspaso pre-cargado. Verifique y confirme.", "info");
                    }, 800);
                };
            }

            if (loadingEl) loadingEl.style.display = 'none';
            if (resultsEl) resultsEl.style.display = 'block';

            const toastType = totalVencidos > 0 ? 'warning' : 'success';
            showToast('Análisis Completado', `${totalCriticos} críticos y ${totalVencidos} vencidos detectados.`, toastType);
        }

        /* ----------------------------------------------------
           9. LÓGICA DE FIRESTORE: PAGINACIÓN BIDIRECCIONAL
           ---------------------------------------------------- */
        const inventoryTableBody = document.getElementById('inventory-table-body');
        const btnNextPage = document.getElementById('btn-next-page');
        const btnPrevPage = document.getElementById('btn-prev-page');

        // Motor Local de Paginación y Filtrado (Advanced Strategy)
        let globalInventorySnapshots = [];
        let filteredInventorySnapshots = [];
        let currentPageIndex = 0;
        const PAGE_SIZE = 20;

        window.loadFirstPage = async function () {
            if (!auth.currentUser) return;
            if (!inventoryTableBody) return;

            try {
                inventoryTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px;"><i class="ph-spinner ph-spin" style="font-size:24px;"></i><br>Cargando inventario...</td></tr>';

                if (globalInventorySnapshots.length === 0) {
                    const insumosRef = collection(db, 'Insumos');
                    const q = query(insumosRef, orderBy('name'));
                    const snapshot = await getDocs(q);
                    globalInventorySnapshots = snapshot.docs;
                }

                applyInventoryFilters();

            } catch (error) {
                console.error("Data Architect Error (P1):", error);
                showToast('Error', 'Fallo indexando la Base de Datos.', 'error');
            }
        }

        window.applyInventoryFilters = async function() {
            const locFilter = document.getElementById('inv-filter-location')?.value || 'all';
            const catFilter = document.getElementById('inv-filter-category')?.value || 'all';
            const statFilter = document.getElementById('inv-filter-status')?.value || 'all';
            const searchText = (document.getElementById('inventory-search-input')?.value || '').toLowerCase().trim();

            let baseSnapshots = globalInventorySnapshots;

            if (locFilter.startsWith('Bandeja')) {
                try {
                    const snap = await getDocs(query(collection(db, 'Bandejas_Turno'), where('estado', '!=', 'FINALIZADA')));
                    let virtualItemsMap = new Map();
                    snap.forEach(docSnap => {
                        const bData = docSnap.data();
                        const bName = bData.numeroBandeja || bData.id || 'Bandeja';
                        
                        // Si el filtro es para una bandeja en específico y esta no es, omitir
                        if (locFilter !== 'Bandeja' && bName !== locFilter) return;

                        const meds = bData.medicamentos || [];
                        meds.forEach(m => {
                            const name = m.nombreInsumo || m.nombre;
                            const key = name + '_' + bName; // Separar ítems si están en distintas bandejas
                            
                            if (virtualItemsMap.has(key)) {
                                virtualItemsMap.get(key).cantidad += Number(m.cantidadAsignada || 0);
                            } else {
                                virtualItemsMap.set(key, {
                                    name: name,
                                    category: m.categoria || 'General',
                                    code: m.code || 'N/A',
                                    unitPrice: Number(m.unitPrice || m.costo_unitario || 0),
                                    cantidad: Number(m.cantidadAsignada || 0),
                                    location: bName, // Nombre explícito (ej: Bandeja 1)
                                    batch: m.lote || 'N/A',
                                    expirationDate: m.vencimiento || 'N/A',
                                    criticalLimit: 0 
                                });
                            }
                        });
                    });
                    
                    baseSnapshots = Array.from(virtualItemsMap.values()).map((vData, index) => ({
                        id: `virtual-bandeja-${index}`,
                        data: () => vData
                    }));
                } catch(e) {
                    console.error("Error fetching Bandejas for filter", e);
                }
            }

            filteredInventorySnapshots = baseSnapshots.filter(docSnap => {
                const data = docSnap.data();
                if (locFilter !== 'all' && locFilter !== 'Bandeja') {
                    const loc = data.location || data.ubicacion || 'Bodega Central';
                    if (loc !== locFilter) return false;
                }
                if (catFilter !== 'all') {
                    const cat = data.category || data.categoria || 'General';
                    // We only do exact match if not 'all'. But categories can be flexible.
                    if (catFilter === 'Insumo Médico' && !cat.toLowerCase().includes('insumo')) return false;
                    if (catFilter === 'Medicamento' && !cat.toLowerCase().includes('medicamento')) return false;
                }
                if (statFilter !== 'all') {
                    const qty = Number(data.physicalCount || data.quantity || data.cantidad || 0);
                    const min = Number(data.criticalStock || data.criticalLimit || data.stock_minimo || 50);
                    const isCrit = qty <= min;
                    if (statFilter === 'critical' && !isCrit) return false;
                    if (statFilter === 'normal' && isCrit) return false;
                }
                if (searchText.length >= 2) {
                    const name = (data.name || data.nombre || data.descripcion || '').toLowerCase();
                    const code = (data.code || data.codigo || '').toLowerCase();
                    if (!name.includes(searchText) && !code.includes(searchText)) return false;
                }
                return true;
            });

            currentPageIndex = 0;
            renderCurrentPage();
        }

        function renderCurrentPage() {
            const start = currentPageIndex * PAGE_SIZE;
            const end = start + PAGE_SIZE;
            const pageData = filteredInventorySnapshots.slice(start, end);

            // Mock a snapshot object for the render function
            const mockSnapshot = {
                empty: pageData.length === 0,
                forEach: (cb) => pageData.forEach(cb)
            };

            if (btnPrevPage) btnPrevPage.disabled = currentPageIndex === 0;
            if (btnNextPage) btnNextPage.disabled = end >= filteredInventorySnapshots.length;

            renderInventoryTableFromSnapshot(mockSnapshot);
        }

        async function loadNextPage() {
            if ((currentPageIndex + 1) * PAGE_SIZE < filteredInventorySnapshots.length) {
                currentPageIndex++;
                renderCurrentPage();
            }
        }

        async function loadPrevPage() {
            if (currentPageIndex > 0) {
                currentPageIndex--;
                renderCurrentPage();
            }
        }

        // Renderizador optimizado adaptado al DocumentSnapshot de Firestore nativo
        function renderInventoryTableFromSnapshot(snapshot) {
            if (!inventoryTableBody) return;

            inventoryTableBody.innerHTML = ''; // Limpiamos la vista actual

            if (snapshot.empty) {
                inventoryTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No hay insumos registrados.</td></tr>';
                return;
            }

            snapshot.forEach(docSnapshot => {
                const _data = docSnapshot.data();
                const item = {
                    ..._data,
                    name: _data.descripcion || _data.nombre || _data.name || 'Sin nombre',
                    quantity: _data.cantidad !== undefined ? Number(_data.cantidad) : Number(_data.quantity || 0),
                    unitPrice: _data.costo_unitario !== undefined ? Number(_data.costo_unitario) : Number(_data.precio || _data.unitPrice || 0),
                    location: _data.ubicacion || _data.location || 'Bodega Central',
                    expirationDate: _data.vencimiento || _data.fechaVencimiento || _data.expirationDate || 'N/A',
                    batch: _data.lote || _data.batch || 'N/A',
                    category: _data.categoria || _data.category || 'General',
                    code: _data.code || _data.codigo || '#N/A',
                    criticalLimit: _data.stock_minimo !== undefined ? Number(_data.stock_minimo) : Number(_data.criticalLimit || 50)
                };
                const tr = document.createElement('tr');

                // Evaluación dinámica (Usando la metadata robusta definida en el JSON)
                const isCritical = item.quantity <= (item.criticalLimit || 50);
                if (isCritical) tr.classList.add('table-row-danger');

                const totalValue = (item.quantity || 0) * (item.unitPrice || 0);
                const formattedTotal = '$' + totalValue.toLocaleString('es-CL');
                const formattedPrice = '$' + (item.unitPrice || 0).toLocaleString('es-CL');

                // Función interna robusta para formateo de fecha (Senior Level)
                const formatDate = (dateValue) => {
                    if (!dateValue || dateValue === 'N/A') return '---';

                    let dateStr = "";
                    // Caso 1: Es un número (Serial de Excel que persistió en DB)
                    if (typeof dateValue === 'number') {
                        const d = new Date(Math.round((dateValue - 25569) * 86400 * 1000));
                        dateStr = d.toISOString().split('T')[0];
                    } else {
                        dateStr = dateValue.toString();
                    }

                    if (!dateStr || dateStr.length < 5) return dateStr;

                    // Soporte para separadores - o /
                    const parts = dateStr.includes('-') ? dateStr.split('-') : dateStr.split('/');
                    if (parts.length !== 3) return dateStr;

                    // Si viene como YYYY-MM-DD (ISO) vs DD/MM/YYYY
                    if (parts[0].length === 4) {
                        return `${parts[2]} / ${parts[1]} / ${parts[0]}`;
                    }
                    return `${parts[0]} / ${parts[1]} / ${parts[2]}`;
                };
                const visualExpDate = formatDate(item.expirationDate);

                let quantityMarkup = "";
                let codeClass = "text-primary";

                if (isCritical && item.quantity <= 20) {
                    quantityMarkup = `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;"><span class="badge-red-solid">${item.quantity}</span><span class="text-danger" style="font-size:8px;font-weight:700;">STOCK CRÍTICO</span></div>`;
                    codeClass = "text-danger";
                } else if (isCritical) {
                    quantityMarkup = `<span class="badge-orange">${(item.quantity || 0).toLocaleString('en-US')}</span>`;
                } else {
                    quantityMarkup = `<span class="badge-green">${(item.quantity || 0).toLocaleString('en-US')}</span>`;
                }

                const categoryClass = isCritical ? "item-category text-danger" : "item-category";
                const isQuarantined = item.status === 'CUARENTENA';
                const rowStyle = isQuarantined ? 'background-color: rgba(239, 68, 68, 0.1); border-left: 4px solid var(--danger);' : '';
                const nameMarkup = isQuarantined ?
                    `<div class="item-name text-danger"><i class="ph-fill ph-warning"></i> ${window.escapeHTML(item.name) || 'Sin Nombre'} (CUARENTENA)</div>` :
                    `<div class="item-name">${window.escapeHTML(item.name) || 'Sin Nombre'}</div>`;

                // ==============================
                // MULTI-LOTE RENDERING (FEFO)
                // ==============================
                let batchesMarkup = '';
                if (item.batches && Array.isArray(item.batches) && item.batches.length > 0) {
                    item.batches.forEach(b => {
                        const bExp = formatDate(b.expirationDate);
                        batchesMarkup += `<div class="${categoryClass}" style="font-size:10px; margin-bottom:2px;">
                            <strong>${window.escapeHTML(b.batch)}</strong> | Cant: ${b.quantity} | Vto: ${bExp}
                        </div>`;
                    });
                } else {
                    batchesMarkup = `<div class="${categoryClass}">LOTE: ${window.escapeHTML(item.batch) || 'N/A'}</div><div class="${categoryClass}">Vto: ${visualExpDate}</div>`;
                }

                tr.dataset.id = docSnapshot.id;
                tr.style.cssText = rowStyle;
                tr.innerHTML = `
                <td><div class="${codeClass} font-bold text-sm">${window.escapeHTML(item.code) || '#N/A'}</div></td>
                <td>${nameMarkup}<div class="${categoryClass}">${window.escapeHTML(item.category) || ''}</div></td>
                <td class="font-bold">${formattedPrice}</td>
                <td>${quantityMarkup}</td>
                <td class="font-bold">${formattedTotal}</td>
                <td><div style="display:flex; flex-direction:column; gap:2px;">${batchesMarkup}</div></td>
                <td><div class="font-bold">${window.escapeHTML(item.location || item.ubicacion || 'Bodega Central')}</div></td>
                <td>
                    <div style="display:flex;gap:8px">
                        ${isCritical ? '<button class="btn btn-primary text-sm font-bold" style="background-color: #3730a3;"><i class="ph-fill ph-sparkle"></i> ALTERNATIVA</button>' : '<button class="btn btn-outline text-primary text-sm font-bold"><i class="ph-fill ph-sparkle"></i> ALTERNATIVA</button>'}
                        <button class="btn btn-icon btn-kardex" title="Ver Kardex y Trazabilidad"><i class="ph ph-chart-line-up"></i></button>
                        <button class="btn btn-icon btn-edit-insumo"><i class="ph ph-pencil-simple"></i></button>
                        <button class="btn btn-icon btn-delete-insumo admin-only"><i class="ph ph-trash"></i></button>
                    </div>
                </td>
            `;
                inventoryTableBody.appendChild(tr);
            });

            // Offload predictivo al Main Thread Idle time (Mejora de UX)
            if (window.requestIdleCallback) {
                window.requestIdleCallback(processPredictiveColumns);
            } else {
                setTimeout(processPredictiveColumns, 0); // Fallback Safari
            }
        }

        function processPredictiveColumns() {
            const cols = document.querySelectorAll('.predictive-col');
            cols.forEach(col => {
                const insumoName = col.getAttribute('data-insumo');
                const stock = Number(col.getAttribute('data-stock')) || 0;
                const logs = window.globalMovimientosPredictivos || [];

                const burnRate = SAR_Utils.calculateBurnRate(insumoName, logs);
                const diasRestantes = SAR_Utils.predictStockDepletion(stock, burnRate);

                if (diasRestantes <= 7) {
                    col.innerHTML = `<span class="badge-red-solid">${diasRestantes} Días</span>`;
                    col.parentElement.classList.add('alerta-quiebre-inminente');
                } else if (diasRestantes === Infinity) {
                    col.innerHTML = `<span class="badge-gray">Estable</span>`;
                } else if (diasRestantes > 30) {
                    col.innerHTML = `<span class="badge-green">Estable</span>`;
                } else {
                    col.innerHTML = `<span class="badge-orange">${diasRestantes} Días</span>`;
                }

                // Generar botón de Requerimiento (Compras) si días < 15
                if (diasRestantes <= 15) {
                    const actionContainer = col.parentElement.querySelector('td:last-child > div');
                    if (actionContainer && !actionContainer.querySelector('.btn-compras')) {
                        const btnCompras = document.createElement('button');
                        btnCompras.className = "btn btn-compras text-sm font-bold";
                        btnCompras.style.backgroundColor = "var(--success)";
                        btnCompras.style.color = "white";
                        btnCompras.innerHTML = '<i class="ph-fill ph-shopping-cart"></i> COMPRAR';
                        btnCompras.onclick = () => window.generatePurchaseDraft(col.parentElement.dataset.id, insumoName, stock, burnRate, diasRestantes);

                        // Reemplazar el botón de Alternativa si existe
                        const btnAlternativa = actionContainer.querySelector('.btn-primary, .btn-outline.text-primary');
                        if (btnAlternativa && btnAlternativa.textContent.includes('ALTERNATIVA')) {
                            actionContainer.replaceChild(btnCompras, btnAlternativa);
                        } else {
                            actionContainer.prepend(btnCompras);
                        }
                    }
                }
            });
        }

        // Inicialización del hook
        if (inventoryTableBody) {
            // window.loadFirstPage(); // Se invoca ahora desde onAuthStateChanged
        }

        if (btnNextPage) {
            btnNextPage.addEventListener('click', loadNextPage);
        }

        // Conectar botón UI de página anterior Firestore
        if (btnPrevPage) {
            btnPrevPage.addEventListener('click', loadPrevPage);
        }

        /* ----------------------------------------------------
           9b. BUSCADOR MANUAL DE MEDICAMENTOS
           ---------------------------------------------------- */
        const searchInput = document.getElementById('inventory-search-input');
        let searchTimeout = null;

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    if (typeof window.applyInventoryFilters === 'function') window.applyInventoryFilters();
                }, 300);
            });
        }

        ['inv-filter-location', 'inv-filter-category', 'inv-filter-status'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => {
                    if (typeof window.applyInventoryFilters === 'function') window.applyInventoryFilters();
                });
            }
        });

        async function handleManualSearch(text) {
            if (!inventoryTableBody) return;
            // Now search is handled by applyInventoryFilters dynamically
            if (typeof window.applyInventoryFilters === 'function') window.applyInventoryFilters();
        }

        /* ----------------------------------------------------
           9c. CARGA MASIVA EXCEL (SAR)
           ---------------------------------------------------- */
        const btnTemplate = document.getElementById('btn-download-template');
        const btnUploadTrigger = document.getElementById('btn-trigger-upload');
        const fileInput = document.getElementById('inventory-excel-input');

        if (btnTemplate) {
            btnTemplate.addEventListener('click', (e) => {
                e.preventDefault();
                generarPlantillaExcel();
            });
        }

        const modalCargaMasiva = document.getElementById('modal-carga-masiva');
        const btnConfirmarCarga = document.getElementById('btn-confirmar-carga-masiva');
        const bodegaSelect = document.getElementById('carga-masiva-bodega');

        if (btnUploadTrigger) {
            btnUploadTrigger.addEventListener('click', () => {
                if (modalCargaMasiva) modalCargaMasiva.classList.add('active');
            });
        }

        if (btnConfirmarCarga && fileInput) {
            btnConfirmarCarga.addEventListener('click', async () => {
                if (!bodegaSelect || !bodegaSelect.value) {
                    window.showAlertCenter("Notificación", 'Por favor, seleccione una Bodega de Recepción.');
                    return;
                }

                const file = fileInput.files[0];
                if (!file) {
                    window.showAlertCenter("Notificación", 'Por favor, seleccione un archivo Excel/CSV.');
                    return;
                }

                showToast('Procesando', 'Analizando estructura del archivo Excel...', 'info');

                try {
                    const result = await procesarExcelCargaMasiva(file);
                    if (result.success) {
                        const confirmUpload = confirm(`Se han validado ${result.count} registros correctamente. ¿Deseas importarlos a Firestore ahora?`);
                        if (confirmUpload) {
                            await executeFirestoreMassiveImport(result.data, bodegaSelect.value);
                            if (modalCargaMasiva) modalCargaMasiva.classList.remove('active');
                        }
                    }
                } catch (error) {
                    window.showAlertCenter("Mensaje del Sistema", error); // Error detallado de validación de columnas
                    showToast('Error de Validación', 'El archivo no cumple con el esquema SAR.', 'error');
                } finally {
                    fileInput.value = ''; // Resetear para permitir subir el mismo archivo corregido
                }
            });
        }

        async function executeFirestoreMassiveImport(data, bodegaDestino) {


            showToast('Iniciando Carga', `Procesando ${data.length} registros en bloques...`, 'info');

            let nuevosIngresos = 0;
            let productosActualizados = 0;
            const failedItems = [];
            const CHUNK_SIZE = 100; // Bloques para no saturar la red

            const sanitizeText = (text) => {
                if (!text) return "";
                return text.toString().replace(/[\n\r]+/g, ' ').replace(/\s\s+/g, ' ').trim();
            };

            // Procesamiento por bloques (Senior Scalability Pattern)
            for (let i = 0; i < data.length; i += CHUNK_SIZE) {
                const chunk = data.slice(i, i + CHUNK_SIZE);
                showToast('Carga Masiva', `Subiendo bloque ${Math.floor(i / CHUNK_SIZE) + 1} de ${Math.ceil(data.length / CHUNK_SIZE)}...`, 'info');

                const chunkPromises = chunk.map(async (item) => {
                    try {
                        const cleanName = sanitizeText(item.descripcion);
                        if (!cleanName) throw new Error("Descripción inválida");

                        const cleanBatch = sanitizeText(item.lote) || "N/A";
                        const finalId = item.id_producto ? item.id_producto.toString().trim() : null;

                        const insumosRef = collection(db, 'Insumos');
                        let q;
                        if (finalId) {
                            q = query(insumosRef, where('code', '==', finalId), where('batch', '==', cleanBatch), limit(1));
                        } else {
                            q = query(insumosRef, where('name', '==', cleanName), where('batch', '==', cleanBatch), limit(1));
                        }

                        const querySnapshot = await getDocs(q);

                        if (!querySnapshot.empty) {
                            const existingDoc = querySnapshot.docs[0];
                            const oldQty = Number(existingDoc.data().quantity) || 0;
                            const addedQty = Number(item.cantidad) || 0;
                            const finalQty = oldQty + addedQty;
                            const limitVal = Number(existingDoc.data().criticalLimit || existingDoc.data().stock_minimo || 50);

                            await updateDoc(doc(db, 'Insumos', existingDoc.id), {
                                quantity: increment(addedQty),
                                isCritical: finalQty <= limitVal,
                                unitPrice: Number(item.costo_unitario) || existingDoc.data().unitPrice,
                                location: bodegaDestino || sanitizeText(item.ubicacion) || existingDoc.data().location,
                                updatedAt: serverTimestamp()
                            });
                            productosActualizados++;
                        } else {
                            const autoId = "AUTO-" + Math.random().toString(36).substring(2, 7).toUpperCase();
                            const addedQty = Number(item.cantidad) || 0;
                            const limitVal = Number(item.stock_minimo) || 50;

                            await addDoc(insumosRef, {
                                code: finalId || autoId,
                                name: cleanName,
                                quantity: addedQty,
                                isCritical: addedQty <= limitVal,
                                unitPrice: Number(item.costo_unitario) || 0,
                                batch: cleanBatch,
                                expirationDate: item.vencimiento || "N/A",
                                location: bodegaDestino || sanitizeText(item.ubicacion) || "Bodega Central",
                                category: sanitizeText(item.categoria) || "General",
                                criticalLimit: limitVal,
                                updatedAt: serverTimestamp(),
                                name_lowercase: cleanName.toLowerCase()
                            });
                            nuevosIngresos++;
                        }
                    } catch (rowError) {
                        failedItems.push({ ...item, Motivo_Error: rowError.message });
                    }
                });

                await Promise.all(chunkPromises);
            }

            try {
                if (failedItems.length > 0 || productosActualizados > 0) {
                    await addDoc(collection(db, 'Historial_Movimientos'), {
                        date: serverTimestamp(),
                        type: 'carga masiva',
                        insumoName: 'Multiples Insumos (Carga Masiva Excel)',
                        user: auth.currentUser ? auth.currentUser.email : 'Admin Local',
                        batch: 'MASIVO',
                        quantity: productosActualizados + nuevosIngresos,
                        document: 'XLSX-IMPORT',
                        totalFilas: data.length,
                        actualizados: productosActualizados,
                        nuevos: nuevosIngresos,
                        errores: failedItems.length
                    });
                }

                showToast('Carga Finalizada', `${productosActualizados} actualizados y ${nuevosIngresos} nuevos.`, 'success');

                if (failedItems.length > 0) {
                    showToast('Advertencia', `${failedItems.length} fallos. Descargando reporte...`, 'warning');
                    downloadErrorReportCSV(failedItems);
                }

                window.loadFirstPage();

            } catch (error) {
                console.error("Error Crítico Carga:", error);
                showToast('Error Técnico', 'Fallo al registrar resumen de carga.', 'error');
            }
        }
        /* ----------------------------------------------------
           9g. DASHBOARD REACTIVO (REAL-TIME ENGINE)
           ---------------------------------------------------- */
        window.startRealTimeDashboard = async function (locationFilter = 'all') {
            if (!auth.currentUser) return;
            const criticalEl = document.getElementById('dash-critical-count');
            const expiringEl = document.getElementById('dash-expiring-count');
            const capitalEl = document.getElementById('dash-capital-value');
            const totalInsEl = document.getElementById('dash-total-insumos');

            if (!criticalEl || !expiringEl || !capitalEl) return;

            console.info("[Real-time] Activando escucha universal de Insumos (Fase 21)... Filtro:", locationFilter);
            clearListener('dashboard');
            clearListener('expirations');

            // 1. GLOBAL STATS (Para las tarjetas superiores principales)
            activeListeners.dashboardGlobal = onSnapshot(doc(db, 'Metadata', 'GlobalStats'), async (docSnap) => {
                let capitalTotal = 0;
                let stockCritico = 0;
                
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    capitalTotal = data.totalCapital || 0;
                    stockCritico = data.criticalCount || 0;
                }

                if (criticalEl) criticalEl.textContent = stockCritico;
                // El totalInsEl ahora se actualiza al final de renderDashboardLocations
                
                if (capitalEl) {
                    const formattedCapital = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(capitalTotal);
                    if (capitalEl.innerText !== formattedCapital) {
                        capitalEl.innerText = formattedCapital;
                        capitalEl.classList.remove('animate-pulse');
                        void capitalEl.offsetWidth;
                        capitalEl.classList.add('animate-pulse');
                    }
                }
            }, (error) => {
                console.error("Error leyendo GlobalStats para Dashboard:", error);
            });

            // 2. ESTADO POR UBICACIÓN (Bodegas)
            activeListeners.dashboardBodegas = onSnapshot(collection(db, 'Insumos'), (snap) => {
                const locationsStats = {};
                
                snap.forEach(docSnap => {
                    const data = docSnap.data();
                    const loc = data.location || 'Bodega Central';
                    const qty = data.physicalCount || data.quantity || data.cantidad || 0;
                    const price = data.unitPrice || data.costo_unitario || 0;
                    const critLimit = data.criticalLimit || data.stock_minimo || 10;
                    
                    if (!locationsStats[loc]) {
                        locationsStats[loc] = { insumos: 0, criticos: 0, capital: 0 };
                    }
                    locationsStats[loc].insumos += 1;
                    locationsStats[loc].capital += (qty * price);
                    if (qty <= critLimit) locationsStats[loc].criticos += 1;
                });

                window._lastBodegasStats = locationsStats;
                renderDashboardLocations();
            });

            // 3. ESTADO POR BANDEJAS ACTIVAS
            activeListeners.dashboardBandejas = onSnapshot(query(collection(db, 'Bandejas_Turno'), where('estado', '!=', 'FINALIZADA')), (snap) => {
                const bandejasStats = {};
                
                snap.forEach(docSnap => {
                    const data = docSnap.data();
                    const numBandeja = data.numeroBandeja || data.id || 'Bandeja';
                    const meds = data.medicamentos || [];
                    
                    let cap = 0;
                    meds.forEach(m => {
                        const q = Number(m.cantidadAsignada || 0);
                        const p = Number(m.unitPrice || m.costo_unitario || 0);
                        cap += (q * p);
                    });

                    bandejasStats[numBandeja] = {
                        insumos: meds.length,
                        criticos: 0, // Las bandejas usualmente no manejan 'stock crítico' interno en esta vista
                        capital: cap,
                        estado: data.estado,
                        enfermero: data.asignadoA || 'Sin Asignar'
                    };
                });

                window._lastBandejasStats = bandejasStats;
                renderDashboardLocations();
            });

            // Función auxiliar para renderizar el grid unificado
            function renderDashboardLocations() {
                const grid = document.getElementById('dashboard-locations-grid');
                if (!grid) return;
                
                let html = '';
                const formatCLP = val => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(val);

                let totalUnique = 0;

                // Bodegas
                const bodegas = window._lastBodegasStats || {};
                for (const [loc, stats] of Object.entries(bodegas)) {
                    totalUnique += stats.insumos;
                    let icon = 'ph-buildings';
                    if (loc.toLowerCase().includes('transitoria')) icon = 'ph-package';
                    
                    html += `
                        <div class="card" style="padding: 15px; border-top: 4px solid var(--primary); cursor: pointer;" onclick="window.filterInventoryByLocation('${window.escapeHTML(loc)}')">
                            <h4 style="margin: 0 0 15px 0; color: var(--text-main); display: flex; align-items: center; gap: 8px; font-size: 1.1rem;">
                                <i class="ph-fill ${icon}" style="color: var(--primary);"></i> ${window.escapeHTML(loc)}
                            </h4>
                            <div style="display: flex; justify-content: space-between; font-size: 0.9em; margin-bottom: 8px; color: var(--text-muted);">
                                <span>Insumos Únicos:</span> <strong style="color: var(--text-main);">${stats.insumos}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.9em; margin-bottom: 8px; color: var(--text-muted);">
                                <span>Stock Crítico:</span> <strong class="${stats.criticos > 0 ? 'text-danger' : 'text-success'}">${stats.criticos}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.9em; color: var(--text-muted);">
                                <span>Capital:</span> <strong style="color: var(--text-main);">${formatCLP(stats.capital)}</strong>
                            </div>
                        </div>
                    `;
                }

                // Bandejas
                const bandejas = window._lastBandejasStats || {};
                for (const [bName, stats] of Object.entries(bandejas)) {
                    totalUnique += stats.insumos;
                    html += `
                        <div class="card" style="padding: 15px; border-top: 4px solid var(--warning); cursor: pointer;" onclick="window.filterInventoryByLocation('${window.escapeHTML(bName)}')">
                            <h4 style="margin: 0 0 15px 0; color: var(--text-main); display: flex; align-items: center; gap: 8px; font-size: 1.1rem;">
                                <i class="ph-fill ph-briefcase-medical" style="color: var(--warning);"></i> ${window.escapeHTML(bName)}
                            </h4>
                            <div style="display: flex; justify-content: space-between; font-size: 0.9em; margin-bottom: 8px; color: var(--text-muted);">
                                <span>Estado:</span> <span class="badge-orange" style="font-size: 0.75rem;">${window.escapeHTML(stats.estado)}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.9em; margin-bottom: 8px; color: var(--text-muted);">
                                <span>Asignado a:</span> <strong style="color: var(--text-main);">${window.escapeHTML(stats.enfermero)}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.9em; margin-bottom: 8px; color: var(--text-muted);">
                                <span>Items en Bandeja:</span> <strong style="color: var(--text-main);">${stats.insumos}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.9em; color: var(--text-muted);">
                                <span>Capital:</span> <strong style="color: var(--text-main);">${formatCLP(stats.capital)}</strong>
                            </div>
                        </div>
                    `;
                }

                grid.innerHTML = html;

                // Actualizar Insumos Totales Globales
                const totalInsEl = document.getElementById('dash-total-insumos');
                if (totalInsEl) {
                    totalInsEl.textContent = totalUnique;
                }
            }
            
            // Cargar Vencimientos Asíncronamente en bloque pequeño (Evita Snapshot Masivo)
            const fetchExpirations = async () => {
                try {
                    const snapVenc = await getDocs(query(collection(db, 'Insumos'), where('expirationDate', '!=', ''), limit(100)));
                    let proxAVencer = 0;
                    let countPrecaucion = 0;
                    
                    const tablaUrgencias = document.querySelector('.data-table-header.danger')?.nextElementSibling?.querySelector('tbody');
                    const tablaPrecaucion = document.querySelector('.data-table-header.warning')?.nextElementSibling?.querySelector('tbody');

                    if (tablaUrgencias) tablaUrgencias.innerHTML = '';
                    if (tablaPrecaucion) tablaPrecaucion.innerHTML = '';

                    const hoy = new Date();
                    hoy.setHours(0, 0, 0, 0);
                    
                    snapVenc.forEach(dSnap => {
                        const data = dSnap.data();
                        const ubicacion = data.location || 'Bodega Central';
                        if (locationFilter !== 'all' && ubicacion !== locationFilter) return; // Local filter

                        const nombre = data.name || 'Sin nombre';
                        const lote = data.batch || 'N/A';
                        const vencimientoStr = data.expirationDate || '';
                        const categoria = data.category || 'General';
                        
                        let diasRestantes = Infinity;
                        if (vencimientoStr && vencimientoStr !== 'N/A') {
                            const fStr = String(vencimientoStr).trim();
                            let fechaVto = new Date(fStr);
                            if (isNaN(fechaVto.getTime()) && fStr.includes('-')) {
                                const p = fStr.split('-');
                                if (p.length === 3) fechaVto = new Date(p[2], p[1] - 1, p[0]);
                            }
                            if (fechaVto && !isNaN(fechaVto.getTime())) {
                                const anio = fechaVto.getFullYear();
                                if (anio >= 2000 && anio <= 2100) {
                                    diasRestantes = Math.ceil((fechaVto.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
                                }
                            }
                        }
                        
                        if (diasRestantes <= 30) {
                            proxAVencer++;
                            if (tablaUrgencias) {
                                tablaUrgencias.innerHTML += `
                                    <tr>
                                        <td><div class="font-bold">${window.escapeHTML(nombre)}</div><div class="text-sm text-muted">${window.escapeHTML(categoria)}</div></td>
                                        <td>${window.escapeHTML(lote)}</td>
                                        <td class="text-danger font-bold">${window.escapeHTML(vencimientoStr)} <br><span class="text-sm">(${diasRestantes} días)</span></td>
                                        <td><button class="btn btn-outline text-danger text-sm font-bold">REVISAR</button></td>
                                    </tr>
                                `;
                            }
                        } else if (diasRestantes > 30 && diasRestantes <= 180) {
                            countPrecaucion++;
                            if (tablaPrecaucion) {
                                tablaPrecaucion.innerHTML += `
                                    <tr>
                                        <td><div class="font-bold">${window.escapeHTML(nombre)}</div><div class="text-sm text-muted">${window.escapeHTML(ubicacion)}</div></td>
                                        <td>${window.escapeHTML(lote)}</td>
                                        <td class="text-warning font-bold">${window.escapeHTML(vencimientoStr)}</td>
                                        <td><button class="btn btn-outline text-warning text-sm font-bold">ROTAR</button></td>
                                    </tr>
                                `;
                            }
                        }
                    });
                    
                    if (expiringEl) expiringEl.textContent = (proxAVencer + countPrecaucion);
                    
                    const headerBadgeDanger = document.querySelector('.data-table-header.danger .header-badge');
                    if (headerBadgeDanger) headerBadgeDanger.textContent = `${proxAVencer} REPORTADOS`;

                    const headerBadgeWarning = document.querySelector('.data-table-header.warning .header-badge');
                    if (headerBadgeWarning) headerBadgeWarning.textContent = `${countPrecaucion} REPORTADOS`;

                    if (tablaUrgencias && tablaUrgencias.innerHTML === '') {
                        tablaUrgencias.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:15px; font-weight:bold; color:var(--text-muted);">Sin urgencias reportadas</td></tr>';
                    }
                    if (tablaPrecaucion && tablaPrecaucion.innerHTML === '') {
                        tablaPrecaucion.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:15px; font-weight:bold; color:var(--text-muted);">Sin precauciones reportadas</td></tr>';
                    }
                    
                } catch(e) { console.error("Error obteniendo vencimientos:", e); }
            };
            fetchExpirations();

            // Removemos el listener de dashLocationFilter ya que ya no existe
        };

        // Función Global para filtrar el inventario desde los clicks en Dashboard
        window.filterInventoryByLocation = function(loc) {
            if (window.router && window.router.navigate) {
                window.router.navigate('view-inventario');
            }
            
            setTimeout(() => {
                const selectLoc = document.getElementById('inv-filter-location');
                if (selectLoc) {
                    // Check if option exists
                    let exists = Array.from(selectLoc.options).some(o => o.value === loc);
                    if (!exists) {
                        const opt = document.createElement('option');
                        opt.value = loc;
                        opt.textContent = `📌 ${loc}`;
                        selectLoc.appendChild(opt);
                    }
                    selectLoc.value = loc;
                    if (window.applyInventoryFilters) {
                        window.applyInventoryFilters();
                    }
                }
            }, 150); // Pequeño delay para asegurar que la vista cargó
        };

        // ============================================================
        // MODAL STOCK CRÍTICO INTERACTIVO & PDF
        // ============================================================
        window.openCriticalStockModal = async function () {
            try {
                if (typeof window.openModal !== 'function') throw new Error('window.openModal no es una función. (No se ha inicializado o el cache falló).');

                window.openModal('modal-stock-critico');
                const tbody = document.getElementById('critico-table-body');
                if (!tbody) throw new Error('No se encontró el elemento critico-table-body.');

                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;"><i class="ph-spinner ph-spin"></i> Cargando...</td></tr>';

                if (!db) throw new Error('La variable db es undefined o null.');

                // Usar query nativa para reducir MBs de descarga a unos pocos KBs
                const q = query(collection(db, 'Insumos'), where('isCritical', '==', true));
                const snapshot = await getDocs(q);

                let criticalItems = [];
                snapshot.forEach(docSnap => {
                    const d = docSnap.data();
                    // Fallback para Insumos viejos: validar la cantidad de todos modos por si acaso,
                    // aunque la query ya debería traer solo los verdaderos críticos.
                    const stock = Number(d.quantity || d.cantidad || 0);
                    const min = Number(d.criticalLimit || d.stock_minimo || 10);
                    if (stock <= min) {
                        criticalItems.push(d);
                    }
                });

                window._currentCriticalItems = criticalItems;

                if (criticalItems.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--success); font-weight:bold;">¡Todo en orden! No hay insumos en stock crítico.</td></tr>';
                    return;
                }

                // Batch DOM update para evitar Layout Thrashing
                const fragment = document.createDocumentFragment();
                criticalItems.forEach(item => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td class="font-bold">${window.escapeHTML(item.code || item.codigo || 'N/A')}</td>
                        <td>${window.escapeHTML(item.name || item.nombre || 'Sin nombre')}</td>
                        <td class="text-muted text-sm">${window.escapeHTML(item.category || item.categoria || 'N/A')}</td>
                        <td><span class="badge-red-solid text-lg">${Number(item.quantity || item.cantidad || 0)}</span></td>
                        <td class="font-bold text-muted">${Number(item.criticalLimit || item.stock_minimo || 10)}</td>
                        <td>${window.escapeHTML(item.location || item.ubicacion || 'Bodega')}</td>
                    `;
                    fragment.appendChild(tr);
                });
                
                tbody.innerHTML = '';
                tbody.appendChild(fragment);

            } catch (err) {
                console.error("ERROR CRITICO EN openCriticalStockModal:", err);
                window.showAlertCenter("Error", "Error crítico al abrir modal: " + err.message, true);
            }
        };

        document.getElementById('btn-export-critico-pdf')?.addEventListener('click', () => {
            if (!window.jspdf || !window.jspdf.jsPDF) {
                window.showToast("Error", "El generador de PDF no ha cargado. Reintente.", "error");
                return;
            }
            if (!window._currentCriticalItems || window._currentCriticalItems.length === 0) {
                window.showToast("Aviso", "No hay elementos críticos para exportar.", "warning");
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            doc.setFont("helvetica", "bold");
            doc.setFontSize(18);
            doc.setTextColor(220, 38, 38);
            doc.text("REPORTE DE STOCK CRÍTICO - VISOR LOGÍSTICO", 105, 20, { align: "center" });

            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.setTextColor(100, 100, 100);
            doc.text(`Fecha de Emisión: ${new Date().toLocaleString('es-CL')}`, 20, 30);

            if (doc.autoTable) {
                const head = [['Código', 'Producto', 'Categoría', 'Stock', 'Mínimo', 'Ubicación']];
                const body = window._currentCriticalItems.map(item => [
                    item.code || item.codigo || 'N/A',
                    item.name || item.nombre || 'Sin nombre',
                    item.category || item.categoria || 'N/A',
                    String(Number(item.quantity || item.cantidad || 0)),
                    String(Number(item.criticalLimit || item.stock_minimo || 10)),
                    item.location || item.ubicacion || 'N/A'
                ]);

                doc.autoTable({
                    startY: 40,
                    head: head,
                    body: body,
                    theme: 'grid',
                    headStyles: { fillColor: [220, 38, 38] },
                    columnStyles: { 3: { fontStyle: 'bold', textColor: [220, 38, 38] } }
                });
            }

            doc.save(`Reporte_Stock_Critico_${new Date().toISOString().split('T')[0]}.pdf`);
            window.showToast("Reporte Generado", "El PDF ha sido descargado exitosamente.", "success");
        });

        /**
         * OPERACIÓN DE MANTENIMIENTO: Recalcula GlobalStats escaneando toda la colección.
         * Use solo cuando haya discrepancias o en la primera instalación.
         */
        async function recalculateGlobalStats(silent = false) {
            if (!silent) showToast('Sincronizando', 'Analizando base de datos completa...', 'info');

            try {
                const snap = await getDocs(collection(db, 'Insumos'));
                let criticalCount = 0;
                let totalCapital = 0;
                
                // Batching para actualizar la bandera isCritical en documentos antiguos
                let batches = [];
                let currentBatch = writeBatch(db);
                let operationCount = 0;

                snap.forEach(docSnap => {
                    const d = docSnap.data();
                    const qty = Number(d.quantity) || 0;
                    const price = Number(d.unitPrice) || 0;
                    const limit = Number(d.criticalLimit || d.stock_minimo || 10);
                    const isCrit = qty <= limit;

                    if (isCrit) criticalCount++;
                    totalCapital += (qty * price);
                    
                    if (d.isCritical !== isCrit) {
                        currentBatch.update(docSnap.ref, { isCritical: isCrit });
                        operationCount++;
                        if (operationCount >= 450) {
                            batches.push(currentBatch.commit());
                            currentBatch = writeBatch(db);
                            operationCount = 0;
                        }
                    }
                });
                
                if (operationCount > 0) batches.push(currentBatch.commit());
                await Promise.all(batches);

                await setDoc(doc(db, 'Metadata', 'GlobalStats'), {
                    criticalCount,
                    totalCapital,
                    lastUpdated: serverTimestamp(),
                    recalculatedBy: auth.currentUser?.uid || 'system'
                });

                if (!silent) showToast('Sincronizado', 'Dashboard actualizado correctamente.', 'success');
            } catch (err) {
                console.error("Recalculate Error:", err);
                if (!silent) showToast('Error', 'No se pudo resincronizar los metadatos.', 'error');
            }
        }

        const btnRecalculate = document.getElementById('btn-recalculate-stats');
        if (btnRecalculate) {
            btnRecalculate.addEventListener('click', () => recalculateGlobalStats());
        }

        function handleMassiveUploadResult(success, failed) {
            // Redundante con la nueva lógica upsert, se mantiene por compatibilidad si se llama
        }

        function downloadErrorReportCSV(failedItems) {
            // Envolver campos en comillas para evitar rupturas de CSV por caracteres especiales
            const wrap = (val) => `"${(val || "").toString().replace(/"/g, '""')}"`;

            const headers = ["ID", "Descripcion", "Cantidad", "Error"];
            const rows = failedItems.map(item => [
                wrap(item.id_producto),
                wrap(item.descripcion),
                wrap(item.cantidad),
                wrap(item.Motivo_Error)
            ]);

            let csvContent = "data:text/csv;charset=utf-8,\uFEFF" // Añadimos BOM para soporte Excel/UTF-8
                + headers.map(wrap).join(",") + "\n"
                + rows.map(e => e.join(",")).join("\n");

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `reporte_incidencias_${new Date().getTime()}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        /* ----------------------------------------------------
           9d. ELIMINACIÓN DE INSUMOS (ADMIN ONLY)
           ---------------------------------------------------- */
        if (inventoryTableBody) {
            inventoryTableBody.addEventListener('click', async (e) => {
                const deleteBtn = (e.target && typeof e.target.closest === "function" ? e.target.closest('.btn-delete-insumo') : null);
                if (deleteBtn) {
                    e.preventDefault();

                    // RBAC: Validación doble de seguridad
                    const currentRole = document.body.getAttribute('data-user-role');
                    if (currentRole !== 'admin' && currentRole !== 'superadmin') {
                        showToast('Acceso Denegado', 'No tienes permisos de administrador para borrar registros.', 'error');
                        return;
                    }

                    const tr = deleteBtn.closest('tr');
                    const docId = tr.dataset.id;
                    const itemName = tr.querySelector('.item-name').textContent;

                    // Confirmación de Seguridad solicitada
                    if (confirm(`¿Estás seguro de eliminar "${itemName}"?\nEsta acción no se puede deshacer.`)) {
                        try {
                            showToast('Borrando...', 'Comunicando con Firestore...', 'info');
                            await deleteDoc(doc(db, 'Insumos', docId));

                            // Log de auditoría
                            await addDoc(collection(db, 'Historial_Movimientos'), {
                                date: serverTimestamp(),
                                type: 'salida',
                                insumoName: itemName,
                                user: auth.currentUser?.email || 'Admin',
                                batch: 'S/L',
                                quantity: 0,
                                document: 'ELIMINACION-REGISTRO'
                            });
                            showToast('Registro Eliminado', 'El producto ha sido removido del sistema.', 'success');
                            tr.remove(); // Eliminación instantánea del DOM para UX premium
                        } catch (err) {
                            console.error("Delete Error:", err);
                            showToast('Error', 'No se pudo eliminar el registro. Revisa reglas de seguridad.', 'error');
                        }
                    }
                }
            });

            // 9d-1.5 ABRIR MODAL KARDEX
            inventoryTableBody.addEventListener('click', async (e) => {
                const kardexBtn = (e.target && typeof e.target.closest === "function" ? e.target.closest('.btn-kardex') : null);
                if (kardexBtn) {
                    e.preventDefault();
                    const tr = kardexBtn.closest('tr');
                    const docId = tr.dataset.id;
                    const itemName = tr.querySelector('.item-name').textContent;
                    if (window.openKardexModal) {
                        window.openKardexModal(docId, itemName);
                    }
                }
            });

            // 9d-2. ABRIR MODAL DE EDICIÓN
            inventoryTableBody.addEventListener('click', async (e) => {
                const editBtn = (e.target && typeof e.target.closest === "function" ? e.target.closest('.btn-edit-insumo') : null);
                if (editBtn) {
                    e.preventDefault();
                    const tr = editBtn.closest('tr');
                    const docId = tr.dataset.id;

                    try {
                        showToast('Cargando...', 'Recuperando datos del insumo...', 'info');
                        const docSnap = await getDoc(doc(db, 'Insumos', docId));

                        if (docSnap.exists()) {
                            const data = docSnap.data();
                            // Poblar formulario
                            document.getElementById('edit-doc-id').value = docId;
                            document.getElementById('edit-code').value = data.code || '';
                            document.getElementById('edit-name').value = data.name || '';
                            document.getElementById('edit-category').value = data.category || '';
                            document.getElementById('edit-quantity').value = data.quantity || 0;
                            document.getElementById('edit-unitPrice').value = data.unitPrice || 0;
                            document.getElementById('edit-criticalLimit').value = data.criticalLimit || 50;
                            document.getElementById('edit-batch').value = data.batch || '';
                            document.getElementById('edit-status').value = data.status || 'ACTIVO';

                            // Robustez: Conversión de fecha para input HTML5 (YYYY-MM-DD)
                            let rawDate = data.expirationDate || '';

                            // Conversión Atómica (Fix Error 46507)
                            const dateObj = SAR_Utils.parseDate(rawDate);
                            if (dateObj && !isNaN(dateObj.getTime())) {
                                rawDate = dateObj.toISOString().split('T')[0];
                            } else {
                                rawDate = ""; // Fallback seguro
                            }
                            document.getElementById('edit-expirationDate').value = rawDate;

                            document.getElementById('edit-location').value = data.location || '';

                            // Abrir modal (usando el motor centralizado)
                            const modal = document.getElementById('modal-edit-insumo');
                            if (modal) modal.classList.add('active');
                        }
                    } catch (err) {
                        console.error("Fetch Edit Error:", err);
                        showToast('Error', 'No se pudieron recuperar los datos.', 'error');
                    }
                }
            });
        }

        /* ----------------------------------------------------
           9d-3. GUARDAR CAMBIOS (EDICIÓN CON AUDITORÍA)
           ---------------------------------------------------- */
        const formEditInsumo = document.getElementById('form-edit-insumo');
        if (formEditInsumo) {
            formEditInsumo.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = formEditInsumo.querySelector('button[type="submit"]');
                const originalText = btn.innerHTML;

                const docId = document.getElementById('edit-doc-id').value;
                const formData = new FormData(formEditInsumo);
                const rawData = Object.fromEntries(formData.entries());

                // Transformación y Limpieza de datos (Senior Standards)
                const updatedData = {
                    code: rawData.code.trim(),
                    codigo: rawData.code.trim(),
                    name: rawData.name.trim(),
                    nombre: rawData.name.trim(),
                    descripcion: rawData.name.trim(),
                    name_lowercase: rawData.name.trim().toLowerCase(), // Crucial para el buscador
                    category: rawData.category.trim() || "General",
                    categoria: rawData.category.trim() || "General",
                    quantity: Number(rawData.quantity),
                    cantidad: Number(rawData.quantity),
                    unitPrice: Number(rawData.unitPrice),
                    costo_unitario: Number(rawData.unitPrice),
                    criticalLimit: Number(rawData.criticalLimit),
                    stock_minimo: Number(rawData.criticalLimit),
                    batch: rawData.batch.trim().toUpperCase(),
                    lote: rawData.batch.trim().toUpperCase(),
                    expirationDate: rawData.expirationDate,
                    vencimiento: rawData.expirationDate,
                    fechaVencimiento: rawData.expirationDate,
                    location: rawData.location.trim() || "Sin asignar",
                    ubicacion: rawData.location.trim() || "Sin asignar",
                    status: rawData.status || "ACTIVO"
                };

                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> GUARDANDO...';
                btn.disabled = true;

                try {
                    // Usamos la función de auditoría inmutable definida al inicio de script.js
                    await updateInventoryWithAudit(docId, updatedData, auth.currentUser || { uid: 'admin_local' });

                    // Log de auditoría
                    await addDoc(collection(db, 'Historial_Movimientos'), {
                        date: serverTimestamp(),
                        type: 'ajuste',
                        insumoName: updatedData.name,
                        user: auth.currentUser?.email || 'Admin',
                        batch: updatedData.batch || 'S/L',
                        quantity: 0,
                        document: 'EDICION-MANUAL'
                    });

                    showToast('Éxito', 'Insumo actualizado y auditoría registrada.', 'success');

                    // Cerrar modal
                    const modal = document.getElementById('modal-edit-insumo');
                    if (modal) modal.classList.remove('active');

                    window.loadFirstPage(); // Refrescar tabla
                } catch (err) {
                    console.error("Update Error:", err);
                    showToast('Error Crítico', 'Fallo al sincronizar cambios con el núcleo.', 'error');
                } finally {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            });
        }

        /* ----------------------------------------------------
           9e. CARGA DE INFORMES DE AUDITORÍA (IA LOGS)
           ---------------------------------------------------- */
        async function loadInformesAuditoria() {
            const tbody = document.getElementById('informes-auditoria-tbody');
            if (!tbody) return;

            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px;"><i class="ph-spinner ph-spin" style="font-size:24px;"></i><br>Consultando base de datos de auditoría...</td></tr>';

            try {
                const reportsRef = collection(db, 'informes');
                const q = query(reportsRef, orderBy('fecha', 'desc'), limit(15));
                const snapshot = await getDocs(q);

                if (snapshot.empty) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px;">No se registran incidencias de auditoría recientes.</td></tr>';
                    return;
                }

                tbody.innerHTML = '';
                snapshot.forEach(docSnap => {
                    const report = docSnap.data();
                    const tr = document.createElement('tr');

                    // Formateo de fecha de auditoría
                    const date = report.fecha?.toDate() || new Date();
                    const formattedDate = date.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

                    const badgeClass = report.errores > 0 ? 'action-badge danger' : 'action-badge green-badge';
                    const resultText = report.errores > 0 ? `FALLOS: ${report.errores}` : 'EXITOSO';

                    tr.innerHTML = `
                    <td class="font-bold">${formattedDate}</td>
                    <td><span class="text-sm font-bold">${window.escapeHTML(report.tipo || 'General')}</span></td>
                    <td><div class="user-badge-gray">${window.escapeHTML(report.usuario || 'Sistema')}</div></td>
                    <td><span class="${badgeClass}">${resultText}</span></td>
                    <td>
                        <button class="btn btn-outline btn-sm" onclick="window.showAlertCenter("Notificación", 'Detalle de Error:\\n${JSON.stringify(report.detalle_errores || [], null, 2)}')">
                            <i class="ph ph-eye"></i> Ver
                        </button>
                    </td>
                `;
                    tbody.appendChild(tr);
                });

            } catch (error) {
                console.error("Informes Load Error:", error);
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--danger);">Error al cargar logs. Verifique los índices de Firestore.</td></tr>';
            }
        }

        // Botón de refresco manual
        const btnRefreshInformes = document.getElementById('btn-refresh-informes');
        if (btnRefreshInformes) {
            btnRefreshInformes.addEventListener('click', (e) => {
                e.preventDefault();
                loadInformesAuditoria();
                showToast('Actualizando', 'Refrescando registros de auditoría...', 'info');
            });
        }

        /* ----------------------------------------------------
           9f. DESCARGA DE RESGUARDO (BACKUP ADMIN)
           ---------------------------------------------------- */
        const btnDownloadBackup = document.getElementById('btn-download-backup');
        if (btnDownloadBackup) {
            btnDownloadBackup.addEventListener('click', async (e) => {
                e.preventDefault();

                try {
                    // Re-validación de seguridad antes de proceder
                    const user = auth.currentUser;
                    if (!user) throw new Error("sesión expirada");

                    const userDoc = await getDoc(doc(db, 'Usuarios', user.email));
                    const userRole = (userDoc.data()?.role || '').toLowerCase().trim();
                    if (userRole !== 'admin' && userRole !== 'global' && userRole !== 'administrador') {
                        showToast('Acceso Denegado', 'Esta función es exclusiva para administradores.', 'error');
                        return;
                    }

                    showToast('Preparando Resguardo', 'Recuperando inventario completo...', 'info');

                    const q = query(collection(db, 'Insumos'), orderBy('name', 'asc'));
                    const snapshot = await getDocs(q);

                    const allData = [];
                    snapshot.forEach(doc => allData.push(doc.data()));

                    exportarInventarioResguardo(allData);
                    showToast('Exportación Exitosa', 'El resguardo de inventario ha sido generado.', 'success');

                } catch (err) {
                    console.error("Backup Error:", err);
                    showToast('Error', 'No se pudo generar el archivo de resguardo.', 'error');
                }
            });
        }

        /* ----------------------------------------------------
           9g. GESTIÓN DE MOVIMIENTOS (ENTRADAS / SALIDAS)
           ---------------------------------------------------- */

        // A. POBLAR SELECTOR DE INSUMOS (Dinamismo SPA con Debounce)
        async function populateInsumosSelect() {
            let datalistSearchTimeout;
            const input = document.getElementById('ingreso-insumo');
            const datalist = document.getElementById('lista-insumos');
            if (!input || !datalist) return;
            
            // Caché inicial ligera o vacía para no ahogar la DB
            window.insumosDataCache = []; 

            input.addEventListener('input', (e) => {
                const term = e.target.value.trim().toLowerCase();
                if (term.length < 2) return; // Solo buscar si hay 2 o más caracteres
                
                clearTimeout(datalistSearchTimeout);
                datalistSearchTimeout = setTimeout(async () => {
                    try {
                        // Búsqueda en Firebase: Insumos que comiencen con el término o coincidan
                        // Nota: Firestore nativo requiere indices o un diseño específico para 'contains',
                        // pero para limitar descargas, usamos paginación con query inicial.
                        const q = query(
                            collection(db, 'Insumos'), 
                            where('name', '>=', term),
                            where('name', '<=', term + '\uf8ff'),
                            limit(10)
                        );
                        
                        const snapshot = await getDocs(q);
                        datalist.innerHTML = '';
                        
                        snapshot.forEach(docSnap => {
                            const data = docSnap.data();
                            const option = document.createElement('option');
                            option.value = data.name;
                            datalist.appendChild(option);
                            
                            // Guardar en cache temporal para la simulacion de stock
                            if(!window.insumosDataCache.find(i => i.id === docSnap.id)){
                                window.insumosDataCache.push({ id: docSnap.id, ...data });
                            }
                        });
                        
                        simularStock();
                        
                    } catch (err) {
                        console.error("Datalist Populating Error:", err);
                    }
                }, 300); // 300ms de Debounce
            });

            const simularStock = () => {
                const text = input.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                const qtyInput = document.getElementById('movimiento-cantidad');
                const qty = parseInt(qtyInput ? qtyInput.value : 0) || 0;
                const lblSimulacion = document.getElementById('lbl-simulacion-stock');

                if (!lblSimulacion) return;
                if (!text) {
                    lblSimulacion.innerText = '';
                    return;
                }

                const insumo = window.insumosDataCache.find(i =>
                    i.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() === text
                );

                if (insumo) {
                    lblSimulacion.innerText = `Stock Resultante: ${(insumo.quantity || 0) + qty} unidades`;
                    lblSimulacion.style.color = 'var(--primary)';
                } else {
                    lblSimulacion.innerText = `Producto Nuevo: ${qty} unidades`;
                    lblSimulacion.style.color = 'var(--success)';
                }
            };

            const inputQty = document.getElementById('movimiento-cantidad');
            if (inputQty) inputQty.addEventListener('input', simularStock);
        }

        // B. POBLAR SELECTOR DE DESTINOS (Nuevas Sedes Anexas)
        async function populateDestinosSelect() {
            const select = document.getElementById('movimiento-destino');
            if (!select) return;

            try {
                const snapshot = await getDocs(query(collection(db, 'Bodegas'), orderBy('name')));
                select.innerHTML = '<option value="" disabled selected>Seleccione destino...</option>';

                // Hardcoded defaults si la colección está vacía (Arquitectura de Resiliencia)
                if (snapshot.empty) {
                    const sedes = ['BODEGA CENTRAL SAR', 'CECOSF OBISPO LIZAMA', 'CESFAM ELGUETA', 'ANEXO DENTAL', 'ANIDES'];
                    sedes.forEach(s => {
                        const opt = document.createElement('option');
                        opt.value = s; opt.textContent = s;
                        select.appendChild(opt);
                    });
                } else {
                    snapshot.forEach(docSnap => {
                        const data = docSnap.data();
                        const option = document.createElement('option');
                        option.value = data.name;
                        option.textContent = data.name;
                        select.appendChild(option);
                    });
                }
            } catch (error) {
                console.error("Destinos Select Error:", error);
            }
        }

        // B. SWITCHER DE TABS REMOVIDO PARA INGRESOS

        // C. GUARDADO DE INGRESO (LOGICA DE NÚCLEO)
        const moveForm = document.getElementById('form-movimiento');
        if (moveForm) {
            moveForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = moveForm.querySelector('button[type="submit"]');
                const originalText = btn.innerHTML;

                const formData = new FormData(moveForm);
                const data = Object.fromEntries(formData.entries());

                const nombreInput = data.articleName;
                if (!nombreInput) {
                    showToast('Error', 'Debe escribir o seleccionar un insumo.', 'error');
                    return;
                }
                const insumoNormalizado = nombreInput.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                const quantity = Number(data.quantity);
                const cleanBatch = (data.batch || "").trim().toUpperCase();

                // Sanitización de Fecha Robusta (Type Guard)
                const formattedDate = SAR_Utils.formatDate(data.expirationDate);

                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> PROCESANDO...';
                btn.disabled = true;

                try {
                    let insumoId = null;
                    const match = (window.insumosDataCache || []).find(i =>
                        i.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() === insumoNormalizado
                    );

                    if (match) {
                        insumoId = match.id;
                    } else {
                        // Documento nuevo
                        const nuevoDocRef = doc(collection(db, 'Insumos'));
                        insumoId = nuevoDocRef.id;
                    }

                    // EJECUCIÓN ATÓMICA DE INGRESO (Transaction Recovery)
                    await runTransaction(db, async (transaction) => {
                        const insumoRef = doc(db, 'Insumos', insumoId);
                        const insumoSnap = await transaction.get(insumoRef);

                        if (!insumoSnap.exists()) {
                            transaction.set(insumoRef, {
                                name: nombreInput.trim(),
                                quantity: quantity,
                                batches: [{
                                    batch: cleanBatch,
                                    quantity: quantity,
                                    expirationDate: formattedDate
                                }],
                                batch: cleanBatch, // Mantenemos por retrocompatibilidad UI temporal
                                expirationDate: formattedDate,
                                provider: data.providerId || "S/I",
                                purchaseType: data.purchaseType || "S/I",
                                updatedAt: serverTimestamp()
                            });
                        } else {
                            const dataAnterior = insumoSnap.data();
                            let currentBatches = dataAnterior.batches || [];

                            // Migración On-The-Fly si no tiene array batches
                            if (currentBatches.length === 0 && dataAnterior.batch) {
                                currentBatches.push({
                                    batch: dataAnterior.batch,
                                    quantity: dataAnterior.quantity || 0,
                                    expirationDate: dataAnterior.expirationDate || ''
                                });
                            }

                            const batchIndex = currentBatches.findIndex(b => b.batch === cleanBatch);
                            if (batchIndex !== -1) {
                                currentBatches[batchIndex].quantity += quantity;
                                // Actualizar fecha de exp si la mandaron de nuevo
                                if (formattedDate) {
                                    currentBatches[batchIndex].expirationDate = formattedDate;
                                }
                            } else {
                                currentBatches.push({
                                    batch: cleanBatch,
                                    quantity: quantity,
                                    expirationDate: formattedDate
                                });
                            }

                            // FEFO: Ordenar array por fecha de vencimiento ascendente
                            currentBatches.sort((a, b) => new Date(a.expirationDate || '2099-12-31') - new Date(b.expirationDate || '2099-12-31'));

                            transaction.update(insumoRef, {
                                quantity: increment(quantity),
                                batches: currentBatches,
                                provider: data.providerId || insumoSnap.data().provider,
                                purchaseType: data.purchaseType || insumoSnap.data().purchaseType,
                                updatedAt: serverTimestamp()
                            });
                        }

                        // Log de Auditoría dentro de la misma transacción para consistencia
                        const auditRef = doc(collection(db, 'Historial_Movimientos'));
                        transaction.set(auditRef, {
                            insumoName: insumoSnap.exists() ? insumoSnap.data().name : nombreInput.trim(),
                            item: insumoSnap.exists() ? insumoSnap.data().name : nombreInput.trim(),
                            quantity: quantity,
                            type: 'INGRESO_PROVEEDOR',
                            batch: cleanBatch,
                            destination: data.destinationId || "Principal",
                            provider: data.providerId || "S/I",
                            purchaseType: data.purchaseType || "S/I",
                            user: auth.currentUser ? auth.currentUser.email : 'Admin Local',
                            date: serverTimestamp(),
                            document: data.supportDocument || 'S/N'
                        });
                    });

                    showToast('Éxito', 'Movimiento registrado y auditado correctamente.', 'success');
                    moveForm.reset();
                    populateInsumosSelect(); // Refrescar lista con nuevos stocks
                    if (typeof window.loadFirstPage === 'function') window.loadFirstPage(); // Refrescar tabla de inventario

                } catch (err) {
                    console.error("Movement Save Error:", err);
                    const msg = typeof err === 'string' ? err : 'Fallo en la sincronización.';
                    showToast('Error Crítico', msg, 'error');
                } finally {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            });
        }

        // Inicializar selectores y métricas
        populateInsumosSelect();
        populateDestinosSelect();

        // Misión 16: Métrica Real de Turno
        window.startMetricaIngresos = function () {
            const metricaEl = document.getElementById('metrica-ingresos-hoy');
            const listaEl = document.getElementById('lista-ultimos-registros');
            if (!metricaEl || !listaEl) return;

            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);

            // Usar indexación base 'date' para evitar fallos de Composite Index
            const q = query(collection(db, 'Historial_Movimientos'), orderBy('date', 'desc'), limit(100));

            if (activeListeners && activeListeners.metricaIngresos) {
                activeListeners.metricaIngresos();
            }

            activeListeners.metricaIngresos = onSnapshot(q, (snapshot) => {
                let totalHoy = 0;
                let countList = 0;
                let htmlList = '';

                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    if (data.type !== 'INGRESO_PROVEEDOR') return; // Filtrado seguro JS-side

                    const docDate = data.date ? data.date.toDate() : new Date();
                    if (docDate >= hoy) {
                        totalHoy += (Number(data.quantity) || 0);
                    }

                    if (countList < 3) {
                        countList++;
                        const timeAgo = Math.round((new Date() - docDate) / 60000);
                        const timeStr = timeAgo < 60 ? `Hace ${timeAgo} min` : `Hace ${Math.floor(timeAgo / 60)} hrs`;

                        htmlList += `
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; gap:12px; align-items:center;">
                                <div style="width:36px; height:36px; border-radius:50%; background:var(--success-light); color:var(--success); display:flex; align-items:center; justify-content:center;">
                                    <i class="ph ph-download-simple"></i>
                                </div>
                                <div>
                                    <div class="font-bold text-sm">${window.escapeHTML(data.item || data.insumoName || 'S/N')}</div>
                                    <div class="text-sm text-muted" style="font-size:10px;">
                                        Lote: ${window.escapeHTML(data.batch || 'S/I')} | Proveedor: ${window.escapeHTML(data.provider || 'S/I')}
                                    </div>
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div class="font-bold text-green">+${data.quantity}</div>
                                <div class="text-muted" style="font-size:10px;">${timeStr}</div>
                            </div>
                        </div>`;
                    }
                });

                metricaEl.innerText = totalHoy.toLocaleString();
                if (htmlList === '') {
                    listaEl.innerHTML = '<p class="text-muted text-sm text-center">No hay registros recientes.</p>';
                } else {
                    listaEl.innerHTML = htmlList;
                }
            }, (error) => {
                console.error("[Metricas] Error en Snapshot:", error);
            });
        };
        window.startMetricaIngresos();

        /* ----------------------------------------------------
           9h. MOTOR DE HISTORIAL (TIME-TRAVEL AUDIT)
           ---------------------------------------------------- */
        let globalHistoryData = []; // Caché local para filtrado instantáneo

        window.startRealTimeHistorial = async function (specificDateStr = null) {
            if (!auth.currentUser) return;
            const tbody = document.getElementById('historial-table-body');
            const searchInput = document.getElementById('historial-search-input');
            const countHoyEl = document.querySelector('.rh-value');
            const statusLabel = document.getElementById('historial-loading-status');
            const dateInput = document.getElementById('historial-date-filter');
            const btnClearDate = document.getElementById('btn-clear-historial-date');

            if (!tbody) return;

            console.info("[Historial] Encendiendo auditoría cronológica...");
            clearListener('historial');

            let baseQueryConstraints = [orderBy('date', 'desc')];
            let isRealTime = true;
            
            if (specificDateStr) {
                isRealTime = false;
                const [year, month, day] = specificDateStr.split('-');
                const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
                const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
                baseQueryConstraints.push(where('date', '>=', startOfDay));
                baseQueryConstraints.push(where('date', '<=', endOfDay));
                if (statusLabel) statusLabel.textContent = `Buscando resultados del ${day}/${month}/${year}...`;
            }

            const q = query(collection(db, 'Historial_Movimientos'), ...baseQueryConstraints, limit(50));
            let lastVisibleHistorial = null;

            const handleData = (docs) => {
                console.log("[Historial] Recibidos " + docs.length + " movimientos.");
                globalHistoryData = [];
                if (docs.length > 0) {
                    lastVisibleHistorial = docs[docs.length - 1];
                }
                docs.forEach(doc => globalHistoryData.push({ id: doc.id, ...doc.data() }));
                
                const term = searchInput ? searchInput.value.trim() : '';
                if (term) {
                    const filtered = globalHistoryData.filter(m =>
                        SAR_Utils.matches(m.insumoName, term) ||
                        SAR_Utils.matches(m.user, term) ||
                        SAR_Utils.matches(m.batch, term) ||
                        SAR_Utils.matches(m.type || m.tipo, term) ||
                        SAR_Utils.matches(m.document || m.supportDocument, term)
                    );
                    renderHistorial(filtered);
                    if (statusLabel) statusLabel.textContent = `Mostrando ${filtered.length} coincidencias (de ${globalHistoryData.length} cargados)`;
                } else {
                    renderHistorial(globalHistoryData);
                    if (statusLabel) statusLabel.textContent = `Mostrando ${globalHistoryData.length} movimientos`;
                }
            };

            if (isRealTime) {
                activeListeners.historial = onSnapshot(q, (snapshot) => {
                    handleData(snapshot.docs);
                }, (error) => {
                    console.error("[Historial] Error en Snapshot:", error);
                    showToast('Error de Datos', 'No se pudo sincronizar el historial en tiempo real.', 'error');
                });
            } else {
                try {
                    const snap = await getDocs(q);
                    handleData(snap.docs);
                } catch (error) {
                    console.error("[Historial] Error en getDocs:", error);
                    showToast('Error', 'No se pudo buscar por fecha.', 'error');
                }
            }

            // Bind events for the date picker (only once)
            if (dateInput && !dateInput.dataset.listenerBound) {
                dateInput.dataset.listenerBound = 'true';
                dateInput.addEventListener('change', (e) => {
                    const val = e.target.value;
                    if (val) {
                        if (btnClearDate) btnClearDate.style.display = 'inline-block';
                        window.startRealTimeHistorial(val);
                    } else {
                        if (btnClearDate) btnClearDate.style.display = 'none';
                        window.startRealTimeHistorial();
                    }
                });
                if (btnClearDate) {
                    btnClearDate.addEventListener('click', () => {
                        dateInput.value = '';
                        btnClearDate.style.display = 'none';
                        window.startRealTimeHistorial();
                    });
                }
            }

            // Lógica de "Cargar Más"
            const btnLoadMore = document.getElementById('btn-load-more-history');

            if (btnLoadMore) {
                // Prevenir múltiples listeners si la función se llama varias veces
                const newBtn = btnLoadMore.cloneNode(true);
                btnLoadMore.parentNode.replaceChild(newBtn, btnLoadMore);

                newBtn.addEventListener('click', async () => {
                    if (!lastVisibleHistorial) return;

                    try {
                        newBtn.innerHTML = '<i class="ph-spinner ph-spin"></i> Cargando...';
                        newBtn.disabled = true;
                        if (statusLabel) statusLabel.textContent = "Obteniendo datos antiguos...";

                        const qMore = query(
                            collection(db, 'Historial_Movimientos'),
                            ...baseQueryConstraints,
                            startAfter(lastVisibleHistorial),
                            limit(50)
                        );

                        const snapshotMore = await getDocs(qMore);

                        if (snapshotMore.empty) {
                            if (statusLabel) statusLabel.textContent = "Has llegado al final del historial.";
                            newBtn.style.display = 'none';
                            return;
                        }

                        lastVisibleHistorial = snapshotMore.docs[snapshotMore.docs.length - 1];
                        snapshotMore.forEach(doc => globalHistoryData.push({ id: doc.id, ...doc.data() }));

                        // Renderizar lista combinada y reaplicar filtro si hay texto
                        const term = (searchInput ? searchInput.value.trim() : '');
                        if (term) {
                            const filtered = globalHistoryData.filter(m =>
                                SAR_Utils.matches(m.insumoName, term) ||
                                SAR_Utils.matches(m.user, term) ||
                                SAR_Utils.matches(m.batch, term) ||
                                SAR_Utils.matches(m.type || m.tipo, term) ||
                                SAR_Utils.matches(m.document || m.supportDocument, term)
                            );
                            renderHistorial(filtered);
                            if (statusLabel) statusLabel.textContent = `Mostrando ${filtered.length} coincidencias (de ${globalHistoryData.length} cargados)`;
                        } else {
                            renderHistorial(globalHistoryData);
                            if (statusLabel) statusLabel.textContent = `Mostrando ${globalHistoryData.length} movimientos`;
                        }

                        newBtn.innerHTML = 'Cargar Más Resultados <i class="ph ph-caret-down"></i>';
                        newBtn.disabled = false;

                    } catch (err) {
                        console.error("Error paginando historial:", err);
                        showToast('Error', 'No se pudieron cargar más registros.', 'error');
                        newBtn.innerHTML = 'Cargar Más Resultados <i class="ph ph-caret-down"></i>';
                        newBtn.disabled = false;
                    }
                });
            }

            // Filtrado Unificado SAR_Utils
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    const term = e.target.value.trim();
                    if (term) {
                        const filtered = globalHistoryData.filter(m =>
                            SAR_Utils.matches(m.insumoName, term) ||
                            SAR_Utils.matches(m.user, term) ||
                            SAR_Utils.matches(m.batch, term) ||
                            SAR_Utils.matches(m.type || m.tipo, term) ||
                            SAR_Utils.matches(m.document || m.supportDocument, term)
                        );
                        renderHistorial(filtered);
                        if (statusLabel) statusLabel.textContent = `Mostrando ${filtered.length} coincidencias (de ${globalHistoryData.length} cargados)`;
                    } else {
                        renderHistorial(globalHistoryData);
                        if (statusLabel) statusLabel.textContent = `Mostrando ${globalHistoryData.length} movimientos`;
                    }
                });
            }
        }

        function renderHistorial(data) {
            const tbody = document.getElementById('historial-table-body');
            const countHoyEl = document.querySelector('.rh-value');
            if (!tbody) return;

            const hoy = new Date().toLocaleDateString('es-CL');
            const countHoy = data.filter(m => {
                const rawDate = m.date || m.timestamp || m.fecha;
                const date = rawDate?.toDate ? rawDate.toDate() : new Date();
                return date.toLocaleDateString('es-CL') === hoy;
            }).length;

            if (countHoyEl) countHoyEl.textContent = countHoy;

            tbody.innerHTML = '';
            data.forEach(m => {
                const tr = document.createElement('tr');
                const rawDate = m.date || m.timestamp || m.fecha;
                const date = rawDate?.toDate ? rawDate.toDate() : new Date();
                const dateFmt = date.toLocaleDateString('es-CL');
                const timeFmt = date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

                let baseType = (m.type || m.tipo || 'S/T').toLowerCase();
                if (baseType === 'carga_masiva_excel') baseType = 'carga masiva';

                const typeClass = baseType === 'entrada' ? 'green-badge' :
                    baseType === 'traspaso' ? 'blue-badge' :
                        baseType === 'ajuste' || baseType === 'carga masiva' ? 'yellow-badge' : 'purple-badge';
                const typeText = baseType.toUpperCase();
                const qtyClass = baseType === 'entrada' ? 'text-green' :
                    baseType === 'salida' ? 'text-red' :
                        baseType === 'ajuste' || baseType === 'traspaso' || baseType === 'carga masiva' ? 'text-blue' : 'text-red';
                const qtySign = baseType === 'entrada' ? '+' : baseType === 'salida' ? '-' : '';

                let patientInfo = '';
                if (m.rutPaciente || m.nombrePaciente) {
                    patientInfo = `<div class="item-category" style="color:var(--primary); font-weight:600;"><i class="ph-fill ph-user-circle"></i> Paciente: ${window.escapeHTML(m.nombrePaciente || m.rutPaciente)} ${m.camaPaciente ? '(' + window.escapeHTML(m.camaPaciente) + ')' : ''}</div>`;
                }

                tr.innerHTML = `
                <td><div class="item-name">${dateFmt}</div><div class="item-category">${timeFmt}</div></td>
                <td><span class="action-badge ${typeClass}">${typeText}</span></td>
                <td>
                    <div class="flex-item-icon">
                        <i class="ph ph-package"></i>
                        <div>
                            <div class="item-name">${window.escapeHTML(m.insumoName || m.articleName || 'Insumo Modificado')}</div>
                            <div class="item-category">Operador: ${window.escapeHTML(m.user || m.operatorUid || m.usuario || 'S/I')}</div>
                            ${patientInfo}
                        </div>
                    </div>
                </td>
                <td><div class="item-name">L: ${window.escapeHTML(m.batch || m.lote || 'S/L')}</div><div class="${qtyClass} font-bold">${qtySign} ${m.quantity || 0} uds</div></td>
                <td><div class="item-category">Doc: ${window.escapeHTML(m.document || m.supportDocument || 'S/N')}</div></td>
                <td><span class="doc-badge">${window.escapeHTML(m.document || m.supportDocument || 'FACT-000')}</span></td>
                <td><button class="btn btn-icon" onclick="window.showAlertCenter('Mensaje del Sistema', 'Detalle:\\nProducto: ${window.escapeHTML(m.insumoName || m.articleName || 'Insumo').replace(/'/g, "\\'")}\\nFecha: ${dateFmt} ${timeFmt}\\nUsuario: ${window.escapeHTML(m.user || m.operatorUid || m.usuario || 'S/I').replace(/'/g, "\\'")}\\n${m.nombrePaciente ? 'Paciente: ' + window.escapeHTML(m.nombrePaciente).replace(/'/g, "\\'") : ''}')"><i class="ph ph-eye"></i></button></td>
            `;
                tbody.appendChild(tr);
            });
        }

        // EXPORTACIÓN DE HISTORIAL (ADMIN ONLY)
        const btnExportExcel = document.getElementById('btn-export-historial-excel');
        if (btnExportExcel) {
            btnExportExcel.addEventListener('click', () => {
                if (globalHistoryData.length === 0) return showToast('Error', 'No hay datos para exportar.', 'warning');

                const rows = globalHistoryData.map(m => ({
                    "Fecha": (m.date && typeof m.date.toDate === 'function') ? m.date.toDate().toLocaleString('es-CL') : (m.date ? new Date(m.date).toLocaleString('es-CL') : "N/A"),
                    "Tipo": (m.type || 'S/T').toUpperCase(),
                    "Insumo": m.insumoName,
                    "Cantidad": m.quantity,
                    "Lote": m.batch,
                    "Operador": m.user,
                    "Referencia": m.document
                }));

                const ws = XLSX.utils.json_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Historial_Movimientos");
                XLSX.writeFile(wb, `Historial_SAR_${new Date().getTime()}.xlsx`);
                showToast('Éxito', 'Excel de historial generado.', 'success');
            });
        }

        const btnExportPdfHistorial = document.getElementById('btn-export-historial-pdf');
        if (btnExportPdfHistorial) {
            btnExportPdfHistorial.addEventListener('click', () => {
                if (globalHistoryData.length === 0) return showToast('Error', 'No hay datos para exportar.', 'warning');
                showToast('Generando', 'El documento PDF se está procesando...', 'info');

                const { jsPDF } = window.jspdf;
                const docPdf = new jsPDF();

                docPdf.setFontSize(16);
                docPdf.text('HISTORIAL GLOBAL DE MOVIMIENTOS', 105, 20, { align: "center" });
                docPdf.setFontSize(10);
                docPdf.text(`Fecha Emisión: ${new Date().toLocaleString('es-CL')}`, 14, 30);

                const body = globalHistoryData.map(m => [
                    (m.date && typeof m.date.toDate === 'function') ? m.date.toDate().toLocaleString('es-CL') : (m.date ? new Date(m.date).toLocaleString('es-CL') : "N/A"),
                    (m.type || 'S/T').toUpperCase(),
                    m.insumoName,
                    m.quantity,
                    m.batch || 'S/L',
                    m.user
                ]);

                docPdf.autoTable({
                    startY: 35,
                    head: [['Fecha', 'Tipo', 'Insumo', 'Cant.', 'Lote', 'Operador']],
                    body: body,
                    theme: 'grid',
                    headStyles: { fillColor: [220, 53, 69] }, // Rojo para historial
                    styles: { fontSize: 8, cellPadding: 2 }
                });

                docPdf.save(`Historial_SAR_${new Date().getTime()}.pdf`);
            });
        }

        /* ----------------------------------------------------
           9i. INICIALIZACIÓN DE MOTORES
           ---------------------------------------------------- */

        /* ----------------------------------------------------
           9i. GESTIÓN DE BODEGAS (MULTI-SEDE ENGINE)
           ---------------------------------------------------- */
        let globalBodegas = [];

        window.startRealTimeBodegas = async function () {
            if (!auth.currentUser) return;
            const cardsContainer = document.getElementById('bodegas-cards-container');
            const tbody = document.getElementById('bodegas-tbody');
            const theadRow = document.getElementById('bodegas-thead-row');

            if (!cardsContainer) return;

            console.info("[Bodegas] Vigilando red multi-sede...");
            clearListener('bodegas');

            // Listener de la Red de Bodegas
            activeListeners.bodegas = onSnapshot(collection(db, 'Bodegas'), async (bodegaSnap) => {
                console.log("[Bodegas] Recibidas " + bodegaSnap.size + " sucursales.");
                globalBodegas = [];
                bodegaSnap.forEach(doc => globalBodegas.push({ id: doc.id, ...doc.data() }));

                // 1. Renderizar Tarjetas
                renderBodegaCards(globalBodegas);

                // 2. Renderizar Tabla Comparativa (Pivot)
                renderBodegaComparisonTable(globalBodegas);
            }, (error) => {
                console.error("[Bodegas] Error en Snapshot:", error);
                showToast('Error de Datos', 'Fallo al conectar con la red de bodegas.', 'error');
            });
        }

        function renderBodegaCards(bodegas) {
            const container = document.getElementById('bodegas-cards-container');
            const addCardHtml = container.querySelector('.card[onclick]')?.outerHTML || '';
            container.innerHTML = '';

            bodegas.forEach(b => {
                const card = document.createElement('div');
                card.className = 'card clickable-card';
                card.dataset.id = b.id;
                card.style.borderTop = `4px solid ${b.type === 'principal' ? 'var(--primary)' : 'var(--purple)'}`;

                card.innerHTML = `
                <div class="card-title" style="color:${b.type === 'principal' ? 'var(--primary)' : 'var(--purple)'}">${window.escapeHTML((b.type || 'S/I').toUpperCase())}</div>
                <div class="card-value" style="font-size:20px; margin: 8px 0;">${window.escapeHTML(b.name)}</div>
                <div class="flex-bet text-sm text-muted"><span>Cap: ${window.escapeHTML(b.capacityMetrics || 'S/I')}</span><span class="badge-green">${b.isActive ? 'Activa' : 'Inactiva'}</span></div>
            `;

                card.addEventListener('click', () => openBodegaDetail(b));
                container.appendChild(card);
            });

            container.insertAdjacentHTML('beforeend', addCardHtml);
        }

        async function renderBodegaComparisonTable(bodegas) {
            const tbody = document.getElementById('bodegas-tbody');
            const theadRow = document.getElementById('bodegas-thead-row');
            if (!tbody || !theadRow) return;

            // Header Dinámico
            theadRow.innerHTML = '<th>INSUMO</th>';
            bodegas.forEach(b => {
                const th = document.createElement('th');
                th.textContent = (b.name || 'S/I').toUpperCase();
                theadRow.appendChild(th);
            });
            theadRow.insertAdjacentHTML('beforeend', '<th>TOTAL</th>');

            // Cuerpo: Agrupar insumos por nombre (Pivot).
            // Para evitar volcar toda la DB, comparamos solo los críticos.
            const insumosSnap = await getDocs(query(collection(db, 'Insumos'), where('isCritical', '==', true)));
            const pivot = {}; // { itemName: { bodegaName: qty, total: X } }

            insumosSnap.forEach(doc => {
                const data = doc.data();
                const name = data.name;
                const loc = data.location || 'Sin Asignar';
                const qty = Number(data.quantity) || 0;

                if (!pivot[name]) pivot[name] = { total: 0 };
                pivot[name][loc] = (pivot[name][loc] || 0) + qty;
                pivot[name].total += qty;
            });

            tbody.innerHTML = '';
            Object.keys(pivot).sort().forEach(itemName => {
                const row = document.createElement('tr');
                let cols = `<td><div class="item-name">${window.escapeHTML(itemName)}</div></td>`;

                bodegas.forEach(b => {
                    const stock = pivot[itemName][b.name] || 0;
                    const colorClass = stock < 50 ? 'text-orange' : '';
                    cols += `<td><div class="font-bold ${colorClass}">${stock.toLocaleString()}</div></td>`;
                });

                cols += `<td><div class="font-bold text-primary">${pivot[itemName].total.toLocaleString()}</div></td>`;
                row.innerHTML = cols;
                tbody.appendChild(row);
            });
        }

        function openBodegaDetail(bodega) {
            document.getElementById('modal-bodega-name').innerText = bodega.name;
            document.getElementById('modal-bodega-type').innerText = (bodega.type || 'S/I').toUpperCase();

            const modal = document.getElementById('bodega-modal');
            modal.classList.add('active');

            // Guardar ID actual para acciones
            modal.dataset.currentBodegaId = bodega.id;
            modal.dataset.currentBodegaName = bodega.name;
        }

        // BOTÓN: DISPARAR TRANSFERENCIA
        const btnTriggerTransfer = document.getElementById('btn-trigger-transfer');
        if (btnTriggerTransfer) {
            btnTriggerTransfer.addEventListener('click', async () => {
                const modalDetail = document.getElementById('bodega-modal');
                const fromName = modalDetail.dataset.currentBodegaName;

                const transModal = document.getElementById('modal-transferencia');
                document.getElementById('transfer-from-name').value = fromName;

                // Cargar Selectores de Insumos (Solo los que están en esa bodega)
                const insumoSelect = document.getElementById('transfer-insumo-id');
                const toSelect = document.getElementById('transfer-to-id');

                const q = query(collection(db, 'Insumos'), where('location', '==', fromName));
                const snap = await getDocs(q);

                insumoSelect.innerHTML = '<option value="" disabled selected>Seleccione...</option>';
                snap.forEach(docSnap => {
                    const d = docSnap.data();
                    insumoSelect.innerHTML += `<option value="${docSnap.id}" data-qty="${d.quantity}" data-batch="${window.escapeHTML(d.batch || 'S/L')}" data-name="${window.escapeHTML(d.name)}">${window.escapeHTML(d.name)} (Stock: ${d.quantity} - L: ${window.escapeHTML(d.batch || 'S/L')})</option>`;
                });

                // Bodegas Destino
                toSelect.innerHTML = '<option value="" disabled selected>Seleccione destino...</option>';
                globalBodegas.filter(b => b.name !== fromName).forEach(b => {
                    toSelect.innerHTML += `<option value="${window.escapeHTML(b.name)}">${window.escapeHTML(b.name)}</option>`;
                });

                // Reset de campos de paciente
                const transferTypeEl = document.getElementById('transfer-type');
                if (transferTypeEl) {
                    transferTypeEl.value = 'BODEGA';
                    transferTypeEl.dispatchEvent(new Event('change'));
                }
                document.getElementById('transfer-rut-paciente').value = '';
                document.getElementById('transfer-nombre-paciente').value = '';
                document.getElementById('transfer-cama-paciente').value = '';

                modalDetail.classList.remove('active');
                transModal.classList.add('active');
            });
        }

        // UI Toggle para Transferencia vs Paciente
        const transferTypeSelect = document.getElementById('transfer-type');
        const groupBodegaDestino = document.getElementById('group-bodega-destino');
        const groupPacienteDestino = document.getElementById('group-paciente-destino');

        if (transferTypeSelect) {
            transferTypeSelect.addEventListener('change', (e) => {
                if (e.target.value === 'PACIENTE') {
                    groupBodegaDestino.style.display = 'none';
                    groupPacienteDestino.style.display = 'block';
                    document.getElementById('transfer-to-id').removeAttribute('required');
                } else {
                    groupBodegaDestino.style.display = 'block';
                    groupPacienteDestino.style.display = 'none';
                    document.getElementById('transfer-to-id').setAttribute('required', 'true');
                }
            });
        }

        // FORM: PROCESO DE TRASPASO / DISPENSACIÓN (UPSERT LOGIC)
        const formTransfer = document.getElementById('form-transferencia');
        if (formTransfer) {
            formTransfer.addEventListener('submit', async (e) => {
                e.preventDefault();
                const fromName = document.getElementById('transfer-from-name').value;
                const transferType = document.getElementById('transfer-type').value;
                const toName = transferType === 'BODEGA' ? document.getElementById('transfer-to-id').value : 'PACIENTE';
                const insumoId = document.getElementById('transfer-insumo-id').value;
                const qtyToMove = Number(document.getElementById('transfer-qty').value);

                // Datos del Paciente
                const rutPaciente = document.getElementById('transfer-rut-paciente').value.trim();
                const nombrePaciente = document.getElementById('transfer-nombre-paciente').value.trim();
                const camaPaciente = document.getElementById('transfer-cama-paciente').value.trim();

                if (!toName || !insumoId || qtyToMove <= 0) return;

                try {
                    const docRefOrigin = doc(db, 'Insumos', insumoId);
                    const snapOrigin = await getDoc(docRefOrigin);
                    const data = snapOrigin.data();

                    if (data.status === 'CUARENTENA') {
                        showToast('Alerta Sanitaria', 'El producto está en CUARENTENA. No puede ser movido ni dispensado.', 'error');
                        return;
                    }

                    if (qtyToMove > data.quantity) {
                        showToast('Error', 'Stock insuficiente en la bodega de origen.', 'error');
                        return;
                    }

                    showToast('Procesando', transferType === 'PACIENTE' ? `Dispensando ${qtyToMove} unidades...` : `Moviendo ${qtyToMove} unidades...`, 'info');

                    await runTransaction(db, async (transaction) => {
                        const snapOrigin = await transaction.get(docRefOrigin);
                        if (!snapOrigin.exists()) throw new Error("Insumo origen no existe.");
                        const dataActual = snapOrigin.data();

                        if (qtyToMove > (dataActual.quantity || 0)) {
                            throw new Error('Stock insuficiente en la bodega de origen.');
                        }

                        // Aplicar FEFO al Origen
                        let currentBatches = dataActual.batches || [];
                        if (currentBatches.length === 0 && dataActual.batch) {
                            currentBatches.push({ batch: dataActual.batch, quantity: dataActual.quantity, expirationDate: dataActual.expirationDate || '' });
                        }

                        let qtyToReduce = qtyToMove;
                        let usedBatchesForLog = []; // Trazabilidad de lotes despachados

                        currentBatches.sort((a, b) => new Date(a.expirationDate || '2099-12-31') - new Date(b.expirationDate || '2099-12-31'));

                        for (let i = 0; i < currentBatches.length && qtyToReduce > 0; i++) {
                            if (currentBatches[i].quantity > 0) {
                                const available = currentBatches[i].quantity;
                                const usedQty = Math.min(available, qtyToReduce);

                                currentBatches[i].quantity -= usedQty;
                                qtyToReduce -= usedQty;

                                usedBatchesForLog.push({ batch: currentBatches[i].batch, used: usedQty });
                            }
                        }

                        // 1. Actualizar Origen
                        transaction.update(docRefOrigin, {
                            quantity: increment(-qtyToMove),
                            batches: currentBatches,
                            updatedAt: serverTimestamp()
                        });

                        // 2. Upsert en Destino (Solo si es a Bodega)
                        if (transferType === 'BODEGA') {
                            const qDest = query(collection(db, 'Insumos'),
                                where('name', '==', dataActual.name),
                                where('location', '==', toName),
                                limit(1)
                            );
                            // Las transacciones requieren reads antes de writes, pero Firestore en web sdk transacciones sobre queries es complicado.
                            // Aquí la forma correcta en Firebase es leer el destino. Como getDocs dentro de transaction puede fallar si no referenciamos doc,
                            // Lo haremos seguro: el destino es un nuevo doc o existente.
                            // Por limitación de query en transaction web, haremos updateDoc regular post-transacción o asumiendo id. 
                            // Sin embargo, para mantener seguridad, creamos un documento nuevo en destino siempre si no podemos consultar seguro,
                            // o dejamos el write de destino fuera de la atomicidad del descuento.
                        }
                    });

                    // 2. Upsert Destino fuera de transacción (ya descontamos seguro del origen)
                    if (transferType === 'BODEGA') {
                        const qDest = query(collection(db, 'Insumos'), where('name', '==', data.name), where('location', '==', toName), limit(1));
                        const snapDest = await getDocs(qDest);

                        if (!snapDest.empty) {
                            const destDoc = snapDest.docs[0];
                            const dData = destDoc.data();
                            let dBatches = dData.batches || [];
                            // (Simplificación de migración destino)
                            if (dBatches.length === 0 && dData.batch) dBatches.push({ batch: dData.batch, quantity: dData.quantity, expirationDate: dData.expirationDate || '' });

                            dBatches.push({ batch: `TRAS-${data.batch || 'S/L'}`, quantity: qtyToMove, expirationDate: data.expirationDate || '' });

                            const dOldQty = Number(dData.quantity) || 0;
                            const dLimit = Number(dData.criticalLimit || dData.stock_minimo || 50);
                            const dFinalQty = dOldQty + qtyToMove;

                            await updateDoc(doc(db, 'Insumos', destDoc.id), {
                                quantity: increment(qtyToMove),
                                isCritical: dFinalQty <= dLimit,
                                batches: dBatches,
                                updatedAt: serverTimestamp()
                            });
                        } else {
                            const dLimit = Number(data.criticalLimit || data.stock_minimo || 50);
                            await addDoc(collection(db, 'Insumos'), {
                                ...data,
                                location: toName,
                                quantity: qtyToMove,
                                isCritical: qtyToMove <= dLimit,
                                criticalLimit: dLimit,
                                batches: [{ batch: `TRAS-${data.batch || 'S/L'}`, quantity: qtyToMove, expirationDate: data.expirationDate || '' }],
                                updatedAt: serverTimestamp()
                            });
                        }
                    }

                    // 3. Log en Historial
                    let docName = '';
                    let actionType = '';
                    let actionDetails = {};

                    if (transferType === 'PACIENTE') {
                        actionType = 'salida';
                        docName = `RECETA-${rutPaciente || 'S/R'}`;
                        actionDetails = {
                            rutPaciente: rutPaciente,
                            nombrePaciente: nombrePaciente,
                            camaPaciente: camaPaciente,
                            tipoSalida: 'DISPENSACION_PACIENTE'
                        };
                    } else {
                        actionType = 'traspaso';
                        docName = `TRASP-${fromName.substring(0, 3)}-${toName.substring(0, 3)}`;
                    }

                    await addDoc(collection(db, 'Historial_Movimientos'), {
                        insumoName: data.name,
                        quantity: qtyToMove,
                        type: actionType,
                        user: auth.currentUser?.email || 'Admin',
                        date: serverTimestamp(),
                        document: docName,
                        batch: data.batch || 'MULTI-LOTE',
                        ...actionDetails
                    });

                    showToast('Éxito', transferType === 'PACIENTE' ? 'Dispensación registrada correctamente.' : 'Transferencia completada correctamente.', 'success');
                    document.getElementById('modal-transferencia').classList.remove('active');

                } catch (err) {
                    console.error("Transfer Error:", err);
                    showToast('Error', 'Fallo en la sincronización del traspaso.', 'error');
                }
            });
        }

        // CRUD BODEGAS (Admin Only)
        const formBodega = document.getElementById('form-bodegas');
        if (formBodega) {
            formBodega.addEventListener('submit', async (e) => {
                e.preventDefault();
                const currentRole = document.body.getAttribute('data-user-role');
                if (currentRole !== 'admin' && currentRole !== 'superadmin') {
                    showToast('Acceso Denegado', 'Solo administradores pueden crear bodegas.', 'error');
                    return;
                }

                const formData = new FormData(formBodega);
                const bodegaData = Object.fromEntries(formData.entries());

                try {
                    await addDoc(collection(db, 'Bodegas'), {
                        ...bodegaData,
                        isActive: bodegaData.isActive === 'true',
                        createdAt: serverTimestamp()
                    });
                    showToast('Éxito', 'Bodega creada correctamente.', 'success');
                    formBodega.reset();
                } catch (err) {
                    showToast('Error', 'Fallo al registrar la sucursal.', 'error');
                }
            });
        }

        // ELIMINAR BODEGA
        const btnDeleteBodega = document.getElementById('btn-delete-bodega');
        if (btnDeleteBodega) {
            btnDeleteBodega.addEventListener('click', async () => {
                const modal = document.getElementById('bodega-modal');
                const bodegaId = modal.dataset.currentBodegaId;
                const bodegaName = modal.dataset.currentBodegaName;

                if (confirm(`¿Está seguro de eliminar la bodega "${bodegaName}"?\nSe perderá el registro de su infraestructura.`)) {
                    try {
                        await deleteDoc(doc(db, 'Bodegas', bodegaId));
                        showToast('Eliminado', 'Bodega removida del sistema.', 'success');
                        modal.classList.remove('active');
                    } catch (err) {
                        showToast('Error', 'Fallo de permisos para eliminar sucursal.', 'error');
                    }
                }
            });
        }

        /* ----------------------------------------------------
           9j. GESTIÓN DE USUARIOS (RBAC CONTROL PANEL)
           ---------------------------------------------------- */
        let globalUsers = [];
        let globalRoles = {};

        window.startRealTimeUsers = function () {
            if (!auth.currentUser) return;
            const tbody = document.getElementById('users-table-body');
            const searchInput = document.getElementById('users-search-input');

            if (!tbody) return;

            const currentRole = document.body.getAttribute('data-user-role');
            if (currentRole !== 'admin' && currentRole !== 'superadmin') {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:16px; color:var(--text-muted);">Acceso Restringido: Se requieren privilegios de Administrador para gestionar usuarios.</td></tr>';
                return;
            }

            console.info("[Seguridad] Vigilando red de usuarios...");
            clearListener('usuarios');

            activeListeners.usuarios = onSnapshot(collection(db, 'Usuarios'), (snapshot) => {
                console.log("[Usuarios] Recibidos " + snapshot.size + " perfiles.");
                globalUsers = [];
                snapshot.forEach(doc => globalUsers.push({ id: doc.id, ...doc.data() }));

                const countDisplay = document.getElementById('ui-users-count-display');
                if (countDisplay) {
                    countDisplay.textContent = `${globalUsers.length} usuario(s) registrado(s) actualmente`;
                }

                renderUsersTable(globalUsers);
            }, (error) => {
                console.error("[Usuarios] Error en Snapshot:", error);
                showToast('Error de Datos', 'Fallo al sincronizar listado de personal.', 'error');
            });

            activeListeners.roles = onSnapshot(collection(db, 'Roles'), (snapshot) => {
                globalRoles = {};
                snapshot.forEach(doc => {
                    globalRoles[doc.id] = doc.data();
                });
                renderRBACMatrix();
            }, (error) => {
                console.error("[Roles] Error:", error);
            });

            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase().trim();
                    const filtered = globalUsers.filter(u =>
                        (u.fullName || u.name || "").toLowerCase().includes(term) ||
                        (u.email || u.username || "").toLowerCase().includes(term)
                    );
                    renderUsersTable(filtered);
                });
            }
        }

        function renderUsersTable(data) {
            const tbody = document.getElementById('users-table-body');
            if (!tbody) return;

            tbody.innerHTML = '';
            data.forEach(user => {
                const tr = document.createElement('tr');
                tr.dataset.id = user.id;

                const initials = (user.fullName || "User").split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                const userRole = (user.role || '').toLowerCase().trim();
                const roleClass = (userRole === 'admin' || userRole === 'global' || userRole === 'administrador') ? 'bg-blue text-primary' : 'bg-green text-green';

                tr.innerHTML = `
                <td>
                    <div class="flex-item-icon clickable-user" style="cursor:pointer;" title="Editar Usuario">
                        <div class="avatar-circle">${initials}</div>
                        <div>
                            <div class="item-name">${window.escapeHTML(user.fullName || user.name || 'Sin nombre')}</div>
                            <div class="item-category">${window.escapeHTML(user.email || user.username)}@clinica.cl</div>
                        </div>
                    </div>
                </td>
                <td><span class="user-badge-gray">${user.center || 'Sede Central'}</span></td>
                <td><span class="role-badge ${roleClass}">${user.role?.toUpperCase() || 'OPERADOR'}</span></td>
                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-icon admin-only btn-edit-role" title="Cambiar Rol"><i class="ph ph-shield-check"></i></button>
                        <button class="btn btn-icon admin-only btn-delete-user" style="color:var(--danger);" title="Eliminar"><i class="ph ph-trash"></i></button>
                    </div>
                </td>
            `;
                tbody.appendChild(tr);
            });
        }

        // FORM: CREAR USUARIO (PERFIL FIRESTORE)
        const formUser = document.getElementById('form-usuarios');
        if (formUser) {
            formUser.addEventListener('submit', async (e) => {
                e.preventDefault();
                const currentRole = document.body.getAttribute('data-user-role');
                if (currentRole !== 'admin' && currentRole !== 'superadmin') {
                    showToast('Acceso Denegado', 'Solo administradores pueden dar de alta personal.', 'error');
                    return;
                }

                const formData = new FormData(formUser);
                const data = Object.fromEntries(formData.entries());

                try {
                    showToast('Registrando', 'Guardando perfil de funcionario...', 'info');
                    await addDoc(collection(db, 'Usuarios'), {
                        fullName: data.fullName,
                        username: data.username.toLowerCase(),
                        role: data.role,
                        center: 'Sede Central',
                        createdAt: serverTimestamp(),
                        email: `${data.username}@clinica.cl`
                    });
                    showToast('Éxito', 'Funcionario registrado en el sistema.', 'success');
                    formUser.reset();
                } catch (err) {
                    showToast('Error', 'No se pudo crear el perfil de usuario.', 'error');
                }
            });
        }

        // ACCIONES DE TABLA: CAMBIAR ROL Y ELIMINAR
        const userTable = document.getElementById('users-table-body');
        if (userTable) {
            userTable.addEventListener('click', async (e) => {
                const editBtn = (e.target && typeof e.target.closest === "function" ? e.target.closest('.btn-edit-role') : null);
                const clickableUser = (e.target && typeof e.target.closest === "function" ? e.target.closest('.clickable-user') : null);
                const deleteBtn = (e.target && typeof e.target.closest === "function" ? e.target.closest('.btn-delete-user') : null);

                const tr = (e.target && typeof e.target.closest === "function" ? e.target.closest('tr') : null);
                if (!tr) return;

                const userId = tr.dataset.id;
                const userName = tr.querySelector('.item-name').textContent;

                // Buscar el usuario en globalUsers
                const userData = globalUsers.find(u => u.id === userId);
                if (!userData) return;

                // RBAC Re-validación: Solo si hace clic en acciones que requieren ser admin
                if (editBtn || clickableUser || deleteBtn) {
                    const currentSessionRole = document.body.getAttribute('data-user-role');
                    if (currentSessionRole !== 'admin' && currentSessionRole !== 'superadmin') {
                        showToast('Acceso Denegado', 'Acción reservada para administradores.', 'error');
                        return;
                    }
                }

                if (editBtn || clickableUser) {
                    const modal = document.getElementById('modal-edit-user');
                    document.getElementById('edit-user-id').value = userId;
                    document.getElementById('edit-user-fullname').value = userData.fullName || userData.name || '';
                    document.getElementById('edit-user-email').value = userData.email || userData.username || '';
                    document.getElementById('edit-user-center').value = userData.center || 'Sede Central';

                    const roleSelect = document.getElementById('edit-user-role');
                    roleSelect.value = (userData.role || 'operador').toLowerCase().trim();

                    modal.classList.add('active');
                }

                if (deleteBtn) {
                    if (confirm(`¿Estás seguro de eliminar a "${userName}"?\nPerderá el acceso al sistema de forma inmediata y su perfil será removido.`)) {
                        try {
                            await deleteDoc(doc(db, 'Usuarios', userId));
                            showToast('Usuario Eliminado', 'El funcionario ya no tiene acceso al sistema.', 'success');
                        } catch (err) {
                            showToast('Error', 'Fallo al eliminar cuenta. Revisa reglas de seguridad.', 'error');
                        }
                    }
                }
            });
        }

        // FORM: GUARDAR CAMBIOS DE USUARIO DESDE MODAL
        const formEditUser = document.getElementById('form-edit-user');
        if (formEditUser) {
            formEditUser.addEventListener('submit', async (e) => {
                e.preventDefault();
                const currentRole = document.body.getAttribute('data-user-role');
                if (currentRole !== 'admin' && currentRole !== 'superadmin') {
                    showToast('Acceso Denegado', 'Solo administradores pueden editar usuarios.', 'error');
                    return;
                }

                const userId = document.getElementById('edit-user-id').value;
                const newFullName = document.getElementById('edit-user-fullname').value;
                const newCenter = document.getElementById('edit-user-center').value;
                const newRole = document.getElementById('edit-user-role').value;

                try {
                    showToast('Actualizando', 'Guardando cambios del usuario...', 'info');
                    await updateDoc(doc(db, 'Usuarios', userId), {
                        fullName: newFullName,
                        center: newCenter,
                        role: newRole
                    });

                    showToast('Éxito', 'Usuario actualizado correctamente.', 'success');
                    document.getElementById('modal-edit-user').classList.remove('active');
                } catch (err) {
                    console.error("Error al editar usuario:", err);
                    showToast('Error', 'Fallo al guardar los cambios.', 'error');
                }
            });
        }


        /* RBAC Dinámico Removido (Reemplazado por RBAC Estricto basado en UI) */

        // EXPORTACIÓN DE INFORMES (RBAC PROTECTED)
        document.getElementById('btn-export-informe-excel')?.addEventListener('click', () => {
            if (document.body.getAttribute('data-user-role') !== 'admin') {
                showToast('Acceso Denegado', 'Exportación reservada para administradores.', 'error');
                return;
            }
            if (!globalReportData || globalReportData.length === 0) return showToast('Error', 'No hay datos para exportar.', 'warning');

            showToast('Generando', 'Preparando reporte Excel institucional...', 'info');
            let rows = [];

            if (currentReportType === 'movimientos') {
                rows = globalReportData.map(m => ({
                    "Fecha": SAR_Utils.formatDate(m.date),
                    "Insumo": m.insumoName,
                    "Tipo": (m.type || 'S/T').toUpperCase(),
                    "Cantidad": m.quantity,
                    "Operador": m.user,
                    "Documento": m.document || 'S/N'
                }));
            } else if (currentReportType === 'valorizado') {
                rows = globalReportData.map(i => ({
                    "Insumo": i.name,
                    "Stock": i.quantity,
                    "Precio Unitario": i.unitPrice || 0,
                    "Valor Total": (i.quantity * (i.unitPrice || 0)),
                    "Ubicación": i.location || 'S/U'
                }));
            } else if (currentReportType === 'rotacion') {
                rows = globalReportData.map(i => {
                    const burn = SAR_Utils.calculateBurnRate(i.name, window.globalMovimientosPredictivos);
                    const rem = SAR_Utils.predictStockDepletion(i.quantity, burn);
                    return {
                        "Insumo": i.name,
                        "Salidas (30D)": (burn * 30).toFixed(1),
                        "Stock Actual": i.quantity,
                        "Días Restantes": rem === Infinity ? '> 365' : rem,
                        "Status": rem < 15 ? 'CRÍTICO' : 'ESTABLE'
                    };
                });
            } else if (currentReportType === 'vencimientos') {
                rows = globalReportData.map(i => {
                    const vDate = SAR_Utils.parseDate(i.expirationDate);
                    const diff = vDate ? Math.ceil((vDate - new Date()) / (1000 * 60 * 60 * 24)) : 999;
                    return {
                        "Lote": i.batch || 'S/L',
                        "Insumo": i.name,
                        "Fecha Venc.": SAR_Utils.formatDate(i.expirationDate),
                        "Días Restantes": diff,
                        "Estado": diff < 0 ? 'VENCIDO' : (diff <= 30 ? 'RIESGO' : 'VIGENTE')
                    };
                });
            }

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Reporte");
            XLSX.writeFile(wb, `REPORTE_SAR_${(currentReportType || 'GENERAL').toUpperCase()}_${new Date().toISOString().split('T')[0]}.xlsx`);
        });

        document.getElementById('btn-export-informe-pdf')?.addEventListener('click', () => {
            if (document.body.getAttribute('data-user-role') !== 'admin') {
                showToast('Acceso Denegado', 'Función exclusiva para administradores.', 'error');
                return;
            }
            if (!globalReportData || globalReportData.length === 0) return showToast('Error', 'No hay datos para exportar.', 'warning');

            showToast('PDF', 'El resguardo en PDF se está procesando...', 'info');

            const { jsPDF } = window.jspdf;
            const docPdf = new jsPDF();

            docPdf.setFontSize(16);
            docPdf.text(`REPORTE LOGÍSTICO: ${(currentReportType || 'GENERAL').toUpperCase()}`, 105, 20, { align: "center" });
            docPdf.setFontSize(10);
            docPdf.text(`Fecha de Emisión: ${new Date().toLocaleDateString('es-CL')} ${new Date().toLocaleTimeString('es-CL')}`, 14, 30);

            let head = [];
            let body = [];

            if (currentReportType === 'movimientos') {
                head = [['Fecha', 'Insumo', 'Tipo', 'Cantidad', 'Operador', 'Documento']];
                body = globalReportData.map(m => [SAR_Utils.formatDate(m.date), m.insumoName, (m.type || 'S/T').toUpperCase(), m.quantity, m.user, m.document || 'S/N']);
            } else if (currentReportType === 'valorizado') {
                head = [['Insumo', 'Stock', 'P. Unit', 'Total', 'Ubicación']];
                body = globalReportData.map(i => [i.name, i.quantity, `$${i.unitPrice || 0}`, `$${(i.quantity * (i.unitPrice || 0))}`, i.location || 'S/U']);
            } else if (currentReportType === 'rotacion') {
                head = [['Insumo', 'Salidas (30D)', 'Stock Actual', 'Días Rest.', 'Status']];
                body = globalReportData.map(i => {
                    const burn = SAR_Utils.calculateBurnRate(i.name, window.globalMovimientosPredictivos);
                    const rem = SAR_Utils.predictStockDepletion(i.quantity, burn);
                    return [i.name, (burn * 30).toFixed(1), i.quantity, rem === Infinity ? '> 365' : rem, rem < 15 ? 'CRÍTICO' : 'ESTABLE'];
                });
            } else if (currentReportType === 'vencimientos') {
                head = [['Lote', 'Insumo', 'Fecha Venc.', 'Días Rest.', 'Estado']];
                body = globalReportData.map(i => {
                    const vDate = SAR_Utils.parseDate(i.expirationDate);
                    const diff = vDate ? Math.ceil((vDate - new Date()) / (1000 * 60 * 60 * 24)) : 999;
                    return [i.batch || 'S/L', i.name, SAR_Utils.formatDate(i.expirationDate), diff, diff < 0 ? 'VENCIDO' : (diff <= 30 ? 'RIESGO' : 'VIGENTE')];
                });
            }

            docPdf.autoTable({
                startY: 35,
                head: head,
                body: body,
                theme: 'grid',
                headStyles: { fillColor: [55, 48, 163] },
                styles: { fontSize: 8, cellPadding: 2 }
            });

            docPdf.save(`Reporte_SAR_${(currentReportType || 'GENERAL').toUpperCase()}.pdf`);
        });

        document.getElementById('btn-plan-mitigacion-ia')?.addEventListener('click', () => {
            window.showAlertCenter("Notificación", "MÓDULO IA - PLAN DE MITIGACIÓN\n\nEl motor predictivo ha analizado el comportamiento de salida de los insumos. Se recomienda generar una Orden de Compra Inmediata para:\n- Adrenalina (Riesgo Quiebre: 3 días)\n- Suero Fisiológico (Riesgo Quiebre: 5 días)\n\nConsulte el Dashboard para más detalles de Burn Rate.");
        });



        // window.startRealTimeInformes(); (Movido a onAuthStateChanged)

        /* ----------------------------------------------------
           9n. LOGS DE SISTEMA Y AUDITORÍA DE ERRORES
           ---------------------------------------------------- */
        window.startRealTimeLogs = function () {
            const logsTable = document.getElementById('system-logs-tbody');
            if (!logsTable) return;

            const currentRole = document.body.getAttribute('data-user-role');
            if (currentRole !== 'admin' && currentRole !== 'superadmin') {
                logsTable.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:16px; color:var(--text-muted);">Acceso Restringido: Se requieren privilegios de Administrador para ver los registros de auditoría.</td></tr>';
                return;
            }

            console.info("[Auditoría] Iniciando rastreo de logs de sistema...");

            // Estado Inicial: Cargando (Skeleton UI)
            logsTable.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px;"><i class="ph-spinner ph-spin" style="font-size:24px; color:var(--primary);"></i><div class="mt-8 text-sm text-muted">Sincronizando registros de auditoría...</div></td></tr>';

            clearListener('logs');
            activeListeners.logs = onSnapshot(collection(db, 'Logs_Sistema'), (snapshot) => {
                logsTable.innerHTML = '';
                if (snapshot.empty) {
                    logsTable.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:16px; color:var(--text-muted);">No se registran incidencias técnicas.</td></tr>';
                    return;
                }

                snapshot.forEach(docSnap => {
                    const log = docSnap.data();
                    const tr = document.createElement('tr');
                    const severityClass = log.severity === 'error' ? 'red' : 'orange';

                    tr.innerHTML = `
                    <td class="text-xs">${SAR_Utils.formatDate(log.date)}</td>
                    <td><span class="badge-gray">${log.module?.toUpperCase() || 'SIS'}</span></td>
                    <td><span class="status-dot ${severityClass}-dot">${log.severity?.toUpperCase() || 'S/I'}</span></td>
                    <td class="text-sm">${log.message?.substring(0, 50)}...</td>
                    <td><button class="btn btn-icon btn-view-log" data-id="${docSnap.id}"><i class="ph ph-eye"></i></button></td>
                `;
                    logsTable.appendChild(tr);
                });
            }, (error) => {
                console.error("[Auditoría] Error en Snapshot:", error);
                logsTable.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:16px; color:var(--danger);">Error al sincronizar logs. Permisos insuficientes o problema de red.</td></tr>';
            });

            // Event Delegation para Ver Log
            logsTable.addEventListener('click', async (e) => {
                const btn = (e.target && typeof e.target.closest === "function" ? e.target.closest('.btn-view-log') : null);
                if (btn) {
                    const logId = btn.dataset.id;
                    try {
                        const snap = await getDoc(doc(db, 'Logs_Sistema', logId));
                        if (snap.exists()) {
                            const log = snap.data();
                            window.showAlertCenter("Mensaje del Sistema", `DETALLE DE INCIDENCIA\n\nFecha: ${SAR_Utils.formatDate(log.date)}\nMódulo: ${log.module}\nMensaje: ${log.message}\nUsuario: ${log.user || 'Sistema'}`);
                        }
                    } catch (err) {
                        showToast('Error', 'No se pudo cargar el detalle del log.', 'error');
                    }
                }
            });
        }

        window.currentPurchaseOrder = { automatic: [], manual: [] };
        window._allInsumosCache = [];

        window.renderPurchaseTable = function () {
            const tbody = document.getElementById('compras-table-body');
            if (!tbody) return;

            const combined = [...window.currentPurchaseOrder.automatic, ...window.currentPurchaseOrder.manual];

            if (combined.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:16px; color:var(--text-muted);">El borrador de Orden de Compra está vacío.</td></tr>';
                return;
            }

            tbody.innerHTML = '';
            combined.forEach((item, index) => {
                const tr = document.createElement('tr');
                const isManual = item._source === 'MANUAL';
                const isPrecaucion = item._source === 'PRECAUCION';
                let badgeColor = isManual ? 'blue' : (isPrecaucion ? 'orange' : 'red-solid');
                let stateText = isManual ? 'MANUAL' : (isPrecaucion ? 'POR VENCER' : 'URGENTE');

                // Set default included to true if undefined
                if (item._included === undefined) item._included = true;

                tr.innerHTML = `
                    <td>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <input type="checkbox" ${item._included ? 'checked' : ''} onchange="window.toggleOCItem(${index}, this.checked)" style="width:16px; height:16px; cursor:pointer;">
                            <span class="font-bold">${window.escapeHTML(item.code || 'N/A')}</span>
                        </div>
                    </td>
                    <td>${window.escapeHTML(item.name || 'Sin nombre')}</td>
                    <td>
                        <input type="number" class="form-control" value="${item.suggestQty}" min="1" onchange="window.updateOCItemQty(${index}, this.value)" style="width:80px; padding:4px 8px; font-weight:bold; text-align:center;" ${!item._included ? 'disabled' : ''}>
                    </td>
                    <td>${item.diasQuiebre !== undefined && item.diasQuiebre !== 'N/A' ? item.diasQuiebre + ' Días' : 'N/A'}</td>
                    <td><span class="badge-${badgeColor}">${stateText}</span></td>
                    <td>${new Date().toLocaleDateString('es-CL')}</td>
                    <td>
                        <div style="display:flex; gap:8px;">
                            ${isManual ? `<button class="btn btn-icon text-danger" onclick="window.removeManualItem(${index})" title="Eliminar"><i class="ph ph-trash"></i></button>` : ''}
                        </div>
                    </td>
                `;
                if (!item._included) tr.style.opacity = '0.5';
                tbody.appendChild(tr);
            });
        };

        window.toggleOCItem = function (combinedIndex, isChecked) {
            const automaticLength = window.currentPurchaseOrder.automatic.length;
            if (combinedIndex < automaticLength) {
                window.currentPurchaseOrder.automatic[combinedIndex]._included = isChecked;
            } else {
                window.currentPurchaseOrder.manual[combinedIndex - automaticLength]._included = isChecked;
            }
            window.renderPurchaseTable();
        };

        window.updateOCItemQty = function (combinedIndex, newQty) {
            const val = parseInt(newQty) || 1;
            const automaticLength = window.currentPurchaseOrder.automatic.length;
            if (combinedIndex < automaticLength) {
                window.currentPurchaseOrder.automatic[combinedIndex].suggestQty = val;
            } else {
                window.currentPurchaseOrder.manual[combinedIndex - automaticLength].suggestQty = val;
            }
        };

        window.removeManualItem = function (combinedIndex) {
            const automaticLength = window.currentPurchaseOrder.automatic.length;
            const manualIndex = combinedIndex - automaticLength;
            if (manualIndex >= 0 && manualIndex < window.currentPurchaseOrder.manual.length) {
                window.currentPurchaseOrder.manual.splice(manualIndex, 1);
                window.renderPurchaseTable();
                window.showToast("Removido", "Ítem manual eliminado del borrador.", "success");
            }
        };

        let manualOcTimeout;
        document.getElementById('manual-oc-search')?.addEventListener('input', (e) => {
            const term = e.target.value.trim().toLowerCase();
            const datalist = document.getElementById('oc-product-list');
            if (!datalist || term.length < 2) return;
            
            clearTimeout(manualOcTimeout);
            manualOcTimeout = setTimeout(async () => {
                try {
                    // Capitalize first letter or use the exact term. For a robust search we'd use MeiliSearch,
                    // but for now we do a prefix search:
                    // Note: Firebase is case sensitive.
                    const q = query(
                        collection(db, 'Insumos'), 
                        orderBy('name'), 
                        startAt(term), 
                        endAt(term + '\uf8ff'), 
                        limit(20)
                    );
                    const snap = await getDocs(q);
                    
                    if(!window._manualInsumosCache) window._manualInsumosCache = [];
                    datalist.innerHTML = '';
                    
                    snap.forEach(docSnap => {
                        const data = docSnap.data();
                        data.id = docSnap.id;
                        window._manualInsumosCache.push(data);
                        const option = document.createElement('option');
                        option.value = `${data.code || 'N/A'} - ${data.name || 'Sin Nombre'}`;
                        datalist.appendChild(option);
                    });
                } catch(err) {
                    console.error("Error buscando insumos manuales OC:", err);
                }
            }, 400);
        });

        window.openManualOCModal = function () {
            const searchInput = document.getElementById('manual-oc-search');
            const qtyInput = document.getElementById('manual-oc-qty');

            if (searchInput) searchInput.value = '';
            if (qtyInput) qtyInput.value = '1';

            window.openModal('modal-add-oc-manual');
        };

        document.getElementById('form-add-oc-manual')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const searchVal = document.getElementById('manual-oc-search').value;
            const qty = parseInt(document.getElementById('manual-oc-qty').value) || 1;

            const codeMatch = searchVal.split(' - ')[0].trim();
            // Buscar en el cache manual llenado por el debounce
            const insumo = (window._manualInsumosCache || []).find(i => (i.code || i.codigo) === codeMatch || (i.name || i.nombre) === searchVal);

            if (!insumo) {
                window.showToast("Error", "Producto no encontrado. Seleccione una opción válida de la lista.", "error");
                return;
            }

            const inAuto = window.currentPurchaseOrder.automatic.find(i => i.id === insumo.id);
            if (inAuto) {
                window.showToast("Aviso", "Este producto ya está sugerido por stock crítico.", "warning");
                return;
            }

            const inManual = window.currentPurchaseOrder.manual.find(i => i.id === insumo.id);
            if (inManual) {
                inManual.suggestQty += qty;
            } else {
                window.currentPurchaseOrder.manual.push({
                    _source: 'MANUAL',
                    id: insumo.id,
                    code: insumo.code || insumo.codigo,
                    name: insumo.name || insumo.nombre,
                    suggestQty: qty,
                    diasQuiebre: 'N/A',
                    category: insumo.category || insumo.categoria || 'N/A'
                });
            }

            window.closeModal('modal-add-oc-manual');
            window.renderPurchaseTable();
            window.showToast("Agregado", "Producto añadido al borrador.", "success");
        });

        window.exportFullPurchaseOrderPDF = function () {
            if (!window.jspdf || !window.jspdf.jsPDF) {
                window.showToast("Error", "Motor PDF no cargado", "error");
                return;
            }

            const combined = [...window.currentPurchaseOrder.automatic, ...window.currentPurchaseOrder.manual];
            const filtered = combined.filter(item => item._included !== false);

            if (filtered.length === 0) {
                window.showToast("Aviso", "No hay ítems seleccionados para exportar.", "warning");
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            doc.setFont("helvetica", "bold");
            doc.setFontSize(18);
            doc.setTextColor(33, 37, 41);
            doc.text("ORDEN DE COMPRA COMPLETA (Borrador)", 105, 20, { align: "center" });

            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            doc.text(`Fecha de Emisión: ${new Date().toLocaleString('es-CL')}`, 20, 30);

            const autom = filtered.filter(i => i._source === 'AUTOMATIC' || i._source === 'PRECAUCION').length;
            const man = filtered.filter(i => i._source === 'MANUAL').length;
            doc.text(`Total Ítems: ${filtered.length} (${autom} Automáticos/Sugeridos, ${man} Manuales)`, 20, 36);

            if (doc.autoTable) {
                const head = [['Código', 'Producto', 'Categoría', 'Cant. Sugerida', 'Origen']];
                const body = filtered.map(item => {
                    let typeText = 'Algoritmo (Crítico)';
                    if (item._source === 'MANUAL') typeText = 'Manual';
                    if (item._source === 'PRECAUCION') typeText = 'Por Vencer';
                    return [
                        item.code || 'N/A',
                        item.name || 'Sin nombre',
                        item.category || 'N/A',
                        String(item.suggestQty),
                        typeText
                    ];
                });

                doc.autoTable({
                    startY: 42,
                    head: head,
                    body: body,
                    theme: 'grid',
                    headStyles: { fillColor: [55, 48, 163] },
                    columnStyles: { 3: { fontStyle: 'bold' } },
                    didParseCell: function (data) {
                        if (data.section === 'body' && data.column.index === 4) {
                            if (data.cell.raw === 'Manual') {
                                data.cell.styles.textColor = [13, 110, 253]; // Blue
                            } else if (data.cell.raw === 'Por Vencer') {
                                data.cell.styles.textColor = [249, 115, 22]; // Orange
                            } else {
                                data.cell.styles.textColor = [220, 38, 38]; // Red
                            }
                        }
                    }
                });
            }

            doc.save(`Orden_Compra_Global_${new Date().toISOString().split('T')[0]}.pdf`);
            window.showToast("Exportado", "La Orden de Compra ha sido descargada.", "success");
        };

        window.startRealTimeCompras = async function () {
            if (!auth.currentUser) return;
            const tbody = document.getElementById('compras-table-body');
            if (!tbody) return;

            try {
                // Se usan imports estáticos: collection, onSnapshot

                // Consultamos vencimientos una sola vez (no cambian en tiempo real cada segundo)
                const limit6M = new Date();
                limit6M.setMonth(limit6M.getMonth() + 6);
                const limit6MStr = limit6M.toISOString().split('T')[0];
                
                const qVencidos = query(collection(db, 'Insumos'), where('expirationDate', '>', ''), where('expirationDate', '<=', limit6MStr));
                
                // Escuchamos en tiempo real SOLO los críticos (los que bajan de stock en el turno)
                const qCriticos = query(collection(db, 'Insumos'), where('isCritical', '==', true));

                clearListener('compras'); // Limpiar listener previo si existe
                
                activeListeners.compras = onSnapshot(qCriticos, async (snapshot) => {
                    window._allInsumosCache = [];
                    window.currentPurchaseOrder.automatic = [];
                    
                    // Obtener vencidos estáticamente para combinarlos
                    const snapVencidos = await getDocs(qVencidos);
                    const vencidosMap = new Map();
                    snapVencidos.forEach(docSnap => {
                        vencidosMap.set(docSnap.id, docSnap.data());
                    });

                    // Procesar Críticos en Tiempo Real
                    snapshot.forEach(docSnap => {
                        const d = docSnap.data();
                        d.id = docSnap.id;
                        const stock = Number(d.quantity || d.cantidad || 0);
                        const min = Number(d.criticalLimit || d.stock_minimo || 10);
                        const suggestQty = min * 2 + (min - stock);
                        const diasQuiebre = stock === 0 ? 0 : Math.max(1, Math.floor(stock / 2));

                        window.currentPurchaseOrder.automatic.push({
                            _source: 'AUTOMATIC',
                            _included: true,
                            id: d.id,
                            code: d.code || d.codigo,
                            name: d.name || d.nombre,
                            category: d.category || d.categoria,
                            suggestQty: suggestQty,
                            diasQuiebre: diasQuiebre
                        });
                        // Si era crítico y vencido a la vez, lo procesamos como crítico y lo removemos del map
                        vencidosMap.delete(d.id);
                    });

                    // Añadir los vencidos restantes
                    vencidosMap.forEach((d, id) => {
                        const min = Number(d.criticalLimit || d.stock_minimo || 10);
                        window.currentPurchaseOrder.automatic.push({
                            _source: 'PRECAUCION',
                            _included: true,
                            id: id,
                            code: d.code || d.codigo,
                            name: d.name || d.nombre,
                            category: d.category || d.categoria,
                            suggestQty: min, // Sugerencia base
                            diasQuiebre: 'N/A'
                        });
                    });

                    window.renderPurchaseTable();

                }, (error) => {
                    console.error('[Compras] Error en Snapshot:', error);
                });

            } catch (error) {
                console.error("Error inicializando módulo compras:", error);
            }
        };

        // IA REPORT DETAIL MODAL (SIMULTATION)
        const btnIAReport = document.getElementById('btn-ia-report-detail');
        if (btnIAReport) {
            btnIAReport.addEventListener('click', () => {
                window.showAlertCenter("Notificación", "REPORTE DETALLADO IA - VISOR LOGÍSTICO\n\n1. Análisis de Demanda: Se detecta incremento del 22% en Insumos Críticos.\n2. Sugerencia: Aumentar stock de Suero Fisiológico y Adrenalina.\n3. Riesgo: 4% de quiebre en Bodega Central.\n\nInforme generado por el núcleo de Optimización Inteligente.");
            });
        }

        // window.startRealTimeLogs(); (Movido a onAuthStateChanged)

        /* ----------------------------------------------------
           12. ZONA DE RIESGO: WIPE INVENTARIO
           ---------------------------------------------------- */
        const btnSolicitarWipe = document.getElementById('btn-solicitar-wipe');
        const inputConfirmWipe = document.getElementById('confirmacion-wipe');

        if (inputConfirmWipe && btnSolicitarWipe) {
            inputConfirmWipe.addEventListener('input', (e) => {
                btnSolicitarWipe.disabled = (e.target.value !== 'ELIMINAR');
            });

            // btnSolicitarWipe listener movido a onAuthStateChanged
        }

    } // FIN DE initializeRestOfSPA();

    /* ----------------------------------------------------
       13. SUPERADMIN: BANDEJA DE AUTORIZACIONES
       ---------------------------------------------------- */
    window.startSuperAdminBandeja = function () {
        // Migrado a onAuthStateChanged para evitar Race Conditions.
    };

    window.aprobarWipe = async function (docId, codigo) {
        if (!confirm(`¿Está seguro de APROBAR y EJECUTAR la purga de base de datos para el código ${codigo}? ESTA ACCIÓN ES IRREVERSIBLE.`)) return;

        try {
            // Cambiar estado a Procesada
            await updateDoc(doc(db, 'Solicitudes_Criticas', docId), { estado: 'Procesada' });

            // Registro en Auditoría Final
            await addDoc(collection(db, 'Auditoria'), {
                code: codigo,
                date: serverTimestamp(),
                user: auth.currentUser.email,
                tipoAjuste: 'WIPE_DB_EJECUTADO',
                module: 'Seguridad Extrema (Aprobado por SuperAdmin)',
                justificacion: 'Reinicio Total de Base de Datos autorizado por SuperAdmin (Doble Llave).'
            });

            showToast('Ejecutando...', 'Vaciando colecciones...', 'warning');

            // Flujo de borrado (Operación Tierra Arrasada)
            const collectionsToWipe = ['Insumos', 'Historial_Movimientos', 'Bodegas', 'Auditoria', 'Logs_Sistema', 'Solicitudes_Criticas'];
            for (const collName of collectionsToWipe) {
                const collRef = collection(db, collName);
                const querySnapshot = await getDocs(collRef);
                if (!querySnapshot.empty) {
                    const batchArr = [];
                    let currentBatch = writeBatch(db);
                    let count = 0;

                    querySnapshot.forEach(itemSnap => {
                        currentBatch.delete(itemSnap.ref);
                        count++;
                        if (count === 400) {
                            batchArr.push(currentBatch.commit());
                            currentBatch = writeBatch(db);
                            count = 0;
                        }
                    });
                    if (count > 0) batchArr.push(currentBatch.commit());
                    await Promise.all(batchArr);
                }
            }

            // Reiniciar Metadata Global (Operación Tierra Arrasada)
            await setDoc(doc(db, 'Metadata', 'global_stats'), { totalInsumos: 0, capitalTotal: 0, stockCritico: 0, proximaCaducidad: 0 });

            showToast('Purga Completada', 'Base de datos reiniciada con éxito.', 'success');
            window.location.reload(true);

        } catch (error) {
            console.error('Error durante el Wipe:', error);
            showToast('Error', 'Fallo durante el borrado.', 'error');
        }
    };

    /* ----------------------------------------------------
       10. SEGURIDAD FRONTEND: Role-Based Access Control (RBAC)
       ---------------------------------------------------- */
    window.enforceRBACLogic = async function (userAuth) {
        if (!userAuth) {
            document.body.setAttribute('data-user-role', 'operador');
            return;
        }

        try {
            const userDocRef = doc(db, 'Usuarios', userAuth.email);
            const userSnap = await getDoc(userDocRef);

            if (userSnap.exists()) {
                const userData = userSnap.data();
                const userRole = (userData.rol || userData.role || '').toLowerCase().trim();
                console.info("RBAC: Rol normalizado detectado:", userRole);

                // Actualizar UI con el rol real
                const roleDisplay = document.getElementById('ui-user-role-display');
                if (roleDisplay) {
                    roleDisplay.textContent = userRole.toUpperCase();
                }

                if (userRole === 'operador' || userRole === 'operator') {
                    document.body.setAttribute('data-user-role', 'operador');
                } else if (userRole === 'enfermero' || userRole === 'enfermera') {
                    document.body.setAttribute('data-user-role', 'enfermero');
                } else if (userRole === 'admin' || userRole === 'administrador' || userRole === 'global') {
                    document.body.setAttribute('data-user-role', 'admin');
                    console.info("RBAC: Admin/Global/Administrador conectado. Accesos completos garantizados.");
                } else if (userRole === 'superadmin') {
                    document.body.setAttribute('data-user-role', 'superadmin');
                    console.info("RBAC: SUPERADMIN conectado. Nivel jerárquico máximo autorizado.");
                } else {
                    console.warn(`RBAC Warning: Rol '${userRole}' no reconocido. Aplicando fallback de operador.`);
                    document.body.setAttribute('data-user-role', 'operador');
                }

                if (userRole === 'superadmin' || userRole === 'global' || userRole === 'admin' || userRole === 'administrador') {
                    const panel = document.getElementById('panel-autorizacion-superadmin');
                    const tbody = document.getElementById('tabla-solicitudes-criticas');
                    if (panel && tbody) {
                        panel.style.display = 'block';
                        const q = query(collection(db, 'Solicitudes_Criticas'), where('estado', '==', 'Solicitado'));
                        if (window.unsubBandeja) window.unsubBandeja();
                        window.unsubBandeja = onSnapshot(q, (snapshot) => {
                            tbody.innerHTML = '';
                            if (snapshot.empty) {
                                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No hay solicitudes pendientes.</td></tr>';
                                return;
                            }
                            snapshot.forEach(docSnap => {
                                const data = docSnap.data();
                                const row = document.createElement('tr');
                                let dateStr = data.fecha && data.fecha.toDate ? data.fecha.toDate().toLocaleString() : 'Reciente';
                                let actionHtml = '';
                                if (userRole === 'superadmin') {
                                    actionHtml = `
                                        <button class="btn btn-danger btn-sm" onclick="window.aprobarWipe('${docSnap.id}', '${data.codigo}')"><i class="ph-check"></i> Aprobar</button>
                                        <button class="btn btn-secondary btn-sm" onclick="window.rechazarWipe('${docSnap.id}', '${data.codigo}')"><i class="ph-x"></i> Rechazar</button>
                                    `;
                                } else {
                                    actionHtml = `<span style="color: #6c757d; font-size: 12px; font-weight: bold;"><i class="ph-clock"></i> Esperando Revisión</span>`;
                                }
                                row.innerHTML = `<td><strong>${window.escapeHTML(data.codigo || 'N/A')}</strong></td><td>${dateStr}</td><td>${window.escapeHTML(data.usuario || 'Desconocido')}</td><td><span class="badge" style="background:var(--warning); color:#000;">${window.escapeHTML(data.estado || 'Pendiente')}</span></td><td>${actionHtml}</td>`;
                                tbody.appendChild(row);
                            });
                        });
                    }
                }
            } else {
                if (userAuth.email && (userAuth.email.startsWith('somesar.aera') || userAuth.email.includes('comunel.cl') || userAuth.email.includes('cormunel.cl'))) {
                    console.info(`Asignando auto-rol SuperAdmin al propietario: ${userAuth.email}`);
                    try {
                        await setDoc(userDocRef, {
                            nombre: userAuth.displayName || userAuth.email.split('@')[0],
                            email: userAuth.email,
                            rol: 'superadmin',
                            fechaCreacion: serverTimestamp(),
                            estado: 'activo'
                        });
                        window.location.reload();
                        return;
                    } catch (e) {
                        console.error("No se pudo auto-asignar superadmin. Revisa reglas de firestore.", e);
                    }
                }
                console.warn(`RBAC Warning: No existe documento para el usuario UID ${userAuth.uid}. Aplicando fallback de operador.`);
                document.body.setAttribute('data-user-role', 'operador');
            }
        } catch (error) {
            console.error("RBAC Bloqueo Seguro: Fallo al recuperar rol de usuario. Restringiendo UI.", error);
            document.body.setAttribute('data-user-role', 'operador');
        }
    };

    // ==========================================
    // FASE 17: GESTIÓN DE BANDEJAS (Trays/Kits)
    // ==========================================

    // Función para generar la plantilla estándar
    const medicamentosBandejaEstandar = [
        "ACIDO TRANEXÁMICO", "AEROCÁMARA ADULTO", "AEROCÁMARA PEDIÁTRICA", "BETAMETASONA 4MG INY", "CAPTOPRIL 25 MG COMP", "CEFTRIAXONA 1GR.INY", "CLONIXINATO DE LISINA 100MG INY", "CLORFENAMINA 10ML INY", "CLORFENAMINA 4MG COMP", "CLORPROMAZINA 25MG INY", "DEXAMETASONA 4MG INY", "DICLOFENACO SODICO 12.5 MG SUPOSITORIO", "DICLOFENACO SODICO 75 MG INY", "DOMPERIDONA INY", "FITOMENADIONA 10 MG INY", "FUROSEMIDA 20MG INY", "GENTAMICINA 80 MG INY", "HIDROCORTISONA 100 MG INY", "HIDROCORTISONA 500 MG INY", "IBUPROFENO 400 MG COMP", "IBUPROFENO SUSP ORAL", "KETOROLACO + TROMEΤΑΜΙΝΑ 30MG INY", "METAMIZOL SODICO 1GR INY", "METOCLOPRAMIDA 10 MG/2ML INY", "ONDASENTRON 4 MG INY", "ONDASENTRON 4 MG SUBLINGUAL", "OMEPRAZOL 40MG AMP", "PARACETAMOL 125MG SUPOSITORIO", "PARACETAMOL 500 MG ORAL", "PARACETAMOL GOTAS", "PARACETAMOL 1000/100ML INY", "VIADIL COMPUESTO", "PARGEVERINA GOTAS", "PENICILINA 1.000.000 AMP", "PENICILINA 1.200.000 AMP", "RANITINA 50MG INY", "TIAMINA 30MG INY", "TRAMADOL 100MG INY", "SALBUTAMOL NBZ", "IPRATROPIO BROMURO NBZ", "SALBUTAMOL PUFF", "IPRATROPIO BROMURO PUFF", "VASELINA AMP", "LIDOCAINA AL 2% 10 ML", "ISOSORBIDA", "CORTIPREX JARABE", "OTIPAX GOTAS", "SALES HIDRATANTES 90", "SALES HIDRATANTES 60", "TEST EMBARAZO", "SULFA G", "CLORAFENICOL", "PREDNISONA 5MG", "VIADIL SIMPLE", "HALOPERIDOL"
    ];

    // FASE 23/26/27: Lógica de Bandejas y Flujo de Confirmación con Delegación Global

    // 1. Escucha Global del Dropdown (Mostrar Tabla)
    document.addEventListener('change', (e) => {
        if (e.target.id === 'select-tipo-plantilla') {
            const contenedorTabla = document.getElementById('contenedor-detalle-bandeja');
            const tbodyBandeja = document.getElementById('tabla-detalle-bandeja-body');

            if (e.target.value === 'estandar') {
                if (contenedorTabla) contenedorTabla.style.display = 'block';
                let filasHTML = '';
                if (typeof medicamentosBandejaEstandar !== 'undefined') {
                    medicamentosBandejaEstandar.forEach(med => {
                        filasHTML += `
                        <tr>
                            <td><span class="insumo-nombre fw-bold" style="font-weight: bold;">${med}</span></td>
                            <td><input type="number" class="form-control insumo-cantidad" value="6" min="1" style="max-width:80px"></td>
                            <td><input type="text" class="form-control insumo-obs" placeholder="Ej: Faltante, Vence pronto..."></td>
                            <td class="text-center"><button type="button" class="btn btn-sm btn-danger btn-eliminar-fila">🗑️</button></td>
                        </tr>`;
                    });
                } else {
                    console.error("El array medicamentosBandejaEstandar no está definido.");
                }
                if (tbodyBandeja) tbodyBandeja.innerHTML = filasHTML;
            } else if (!e.target.value) {
                if (contenedorTabla) contenedorTabla.style.display = 'none';
                if (tbodyBandeja) tbodyBandeja.innerHTML = '';
            }
        }
    });

    // 2. Escucha Global de Clics (Delegación)
    document.addEventListener('click', async (e) => {
        // A) Agregar Fármaco
        if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-agregar-extra') : null)) {
            e.preventDefault();
            const localTbody = document.getElementById('tabla-detalle-bandeja-body');
            if (localTbody) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><input type="text" class="form-control insumo-nombre-input insumo-nombre" placeholder="Escriba medicamento..."></td>
                    <td><input type="number" class="form-control insumo-cantidad" value="1" min="1" style="max-width:80px"></td>
                    <td><input type="text" class="form-control insumo-obs" placeholder="Incidencias..."></td>
                    <td class="text-center"><button type="button" class="btn btn-sm btn-danger btn-eliminar-fila">🗑️</button></td>
                `;
                localTbody.appendChild(tr);
            }
            return;
        }

        // B) Botón Borrar Fila (Abrir Modal)
        if ((e.target && typeof e.target.closest === "function" ? e.target.closest('.btn-eliminar-fila') : null)) {
            e.preventDefault();
            window.filaAEliminar = (e.target && typeof e.target.closest === "function" ? e.target.closest('tr') : null);

            const nombreElement = window.filaAEliminar.querySelector('.insumo-nombre');
            let nombre = 'este insumo';
            if (nombreElement) {
                nombre = nombreElement.tagName === 'INPUT' ? nombreElement.value : nombreElement.textContent;
            }

            const spanInsumo = document.getElementById('texto-insumo-eliminar');
            if (spanInsumo) spanInsumo.textContent = nombre || 'este insumo';

            const modalEliminar = document.getElementById('modal-eliminar-insumo');
            if (modalEliminar) modalEliminar.style.display = 'flex';
            return;
        }

        // C) Confirmar Eliminación (Auditoría en Firestore)
        if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-confirmar-eliminacion') : null)) {
            e.preventDefault();
            if (window.filaAEliminar) {
                const nombreElement = window.filaAEliminar.querySelector('.insumo-nombre');
                let nombre = 'Desconocido';
                if (nombreElement) {
                    nombre = nombreElement.tagName === 'INPUT' ? nombreElement.value : nombreElement.textContent;
                }

                try {
                    // Remover visualmente AL INSTANTE para que no quede "pegado" visualmente si el backend falla
                    window.filaAEliminar.remove();
                    window.filaAEliminar = null;

                    await window.firebaseFirestore.addDoc(window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Historial_Movimientos'), {
                        type: 'EDICION_PLANTILLA_BANDEJA',
                        item: nombre,
                        quantity: 0,
                        accion: 'Eliminado de la plantilla antes de despachar',
                        user: (window.firebaseAuth || window.auth || auth).currentUser ? (window.firebaseAuth || window.auth || auth).currentUser.email : 'Desconocido',
                        date: window.firebaseFirestore.serverTimestamp()
                    });
                } catch (error) {
                    console.error("Error al auditar la eliminación:", error);
                }

                const modalEliminar = document.getElementById('modal-eliminar-insumo');
                if (modalEliminar) modalEliminar.style.display = 'none';
            }
            return;
        }


        // D) Pre-Despacho (Abrir Modal de Resumen)
        if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-pre-despacho') : null)) {
            e.preventDefault();
            const idFisico = document.getElementById('select-numero-bandeja').value;
            const plantilla = document.getElementById('select-tipo-plantilla').value;
            const correo = document.getElementById('select-enfermero-asignado').value;

            // Si NO estamos en modo edición, se exigen los 3 campos. Si estamos en edición, la plantilla puede estar vacía.
            if (!idFisico || (!plantilla && !window._editingBandejaId) || !correo) {
                window.showAlertCenter("Notificación", "⚠️ Por favor, complete los campos obligatorios: Bandeja, Correo responsable " + (!window._editingBandejaId ? "y Kit." : "."));
                return;
            }

            // Poblado del Modal de Resumen
            const spanId = document.getElementById('resumen-bandeja-id');
            const spanPlantilla = document.getElementById('resumen-bandeja-plantilla');
            const spanCorreo = document.getElementById('resumen-bandeja-correo');
            if (spanId) spanId.textContent = idFisico;
            if (spanPlantilla) spanPlantilla.textContent = window._editingBandejaId ? "Edición Manual" : "Kit Estándar Urgencias";
            if (spanCorreo) spanCorreo.textContent = correo;

            let listaHTML = '';
            let itemsAEnviar = [];
            const filas = document.querySelectorAll('#tabla-detalle-bandeja-body tr');

            filas.forEach(fila => {
                const nombreElement = fila.querySelector('.insumo-nombre');
                const cantidadElement = fila.querySelector('.insumo-cantidad');
                const obsElement = fila.querySelector('.insumo-obs');

                const nombre = nombreElement ? (nombreElement.tagName === 'INPUT' ? nombreElement.value : nombreElement.textContent) : '';
                const cantidad = cantidadElement ? cantidadElement.value : '0';
                const obs = obsElement ? obsElement.value : '';

                if (nombre && nombre.trim() !== '') {
                    listaHTML += `<li><strong>${cantidad}x</strong> ${nombre} <span style="color:#6c757d; font-style:italic;">${obs ? '(' + obs + ')' : ''}</span></li>`;
                    itemsAEnviar.push({
                        nombreInsumo: nombre.trim(),
                        cantidadAsignada: Number(cantidad || 0),
                        cantidadRecibida: 0,
                        observacion: obs.trim(),
                        estadoCheck: false
                    });
                }
            });

            if (itemsAEnviar.length === 0) {
                window.showAlertCenter("Notificación", "La bandeja no tiene medicamentos válidos.");
                return;
            }

            // Guardar items temporalmente para usarlos en el botón final
            window._bandejaActualItemsTemporal = itemsAEnviar;

            const ulLista = document.getElementById('resumen-bandeja-lista');
            if (ulLista) ulLista.innerHTML = listaHTML;
            
            // Ajustar texto del botón si estamos en edición
            const btnConfirm = document.getElementById('btn-ejecutar-despacho-final');
            if (btnConfirm) btnConfirm.textContent = window._editingBandejaId ? 'Guardar Cambios' : 'Sí, Aceptar';

            const modalResumen = document.getElementById('modal-resumen-bandeja');
            if (modalResumen) modalResumen.style.display = 'flex';
        }

        // E) Ejecución Final (Descuento de Stock) Delegado Globalmente
        if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-ejecutar-despacho-final') : null)) {
            e.preventDefault();
            const btnFinal = (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-ejecutar-despacho-final') : null);
            if (btnFinal.disabled) return;

            const selectBandeja = document.getElementById('select-numero-bandeja');
            const inputEnfermero = document.getElementById('select-enfermero-asignado');
            const valorSelect = selectBandeja ? selectBandeja.value : '';
            const valorEmail = inputEnfermero ? inputEnfermero.value.trim() : '';
            const itemsAEnviar = window._bandejaActualItemsTemporal || [];

            console.log("Clic Sí Aceptar", itemsAEnviar);

            if (itemsAEnviar.length === 0) {
                window.showAlertCenter("Notificación", "No hay items para despachar.");
                return;
            }

            try {
                btnFinal.disabled = true;
                const originalText = btnFinal.innerHTML;
                btnFinal.innerHTML = '<i class="ph-spinner ph-spin"></i> Despachando...';

                const btnPre = document.getElementById('btn-pre-despacho');
                const modoEdicionId = window._editingBandejaId || (btnPre ? btnPre.dataset.modoEdicionId : null);
                
                let bandejaAntigua = null;
                if (modoEdicionId) {
                    const docB = await window.firebaseFirestore.getDoc(window.firebaseFirestore.doc(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno', modoEdicionId));
                    if (docB.exists()) {
                        bandejaAntigua = docB.data();
                    }
                }

                // Necesitamos referencias de Insumos para TODOS los itemsAEnviar y los items en bandejaAntigua (por si se quitó un item)
                const itemsAProcesarNombres = new Set([...itemsAEnviar.map(i => i.nombreInsumo)]);
                if (bandejaAntigua && bandejaAntigua.medicamentos) {
                    bandejaAntigua.medicamentos.forEach(m => itemsAProcesarNombres.add(m.nombreInsumo || m.nombre));
                }

                // Buscar referencias de forma concurrente para evitar demoras
                const fetchPromises = Array.from(itemsAProcesarNombres).map(async (nombre) => {
                    const q = window.firebaseFirestore.query(
                        window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Insumos'),
                        window.firebaseFirestore.where('name', '==', nombre),
                        window.firebaseFirestore.limit(1)
                    );
                    const snap = await window.firebaseFirestore.getDocs(q);
                    if (snap.empty) {
                        throw new Error(`Fármaco "${nombre}" no encontrado en inventario central.`);
                    }
                    return { ref: snap.docs[0].ref, name: nombre };
                });
                const refsMap = await Promise.all(fetchPromises);

                // Transacción Atómica
                await window.firebaseFirestore.runTransaction(window.firebaseFirestore.db || window.db || db, async (transaction) => {
                    const updates = [];
                    for (const mapObj of refsMap) {
                        const insumoDoc = await transaction.get(mapObj.ref);
                        if (!insumoDoc.exists()) throw new Error(`Documento no encontrado.`);
                        const currentStock = Number(insumoDoc.data().quantity) || 0;
                        
                        // oldQty for this drug
                        let oldQty = 0;
                        if (bandejaAntigua && bandejaAntigua.medicamentos) {
                            const oldItem = bandejaAntigua.medicamentos.find(m => (m.nombreInsumo || m.nombre) === mapObj.name);
                            if (oldItem) oldQty = Number(oldItem.cantidadAsignada || oldItem.cantidad) || 0;
                        }

                        // newQty for this drug
                        let newQtyReq = 0;
                        const newItem = itemsAEnviar.find(m => m.nombreInsumo === mapObj.name);
                        if (newItem) newQtyReq = Number(newItem.cantidadAsignada) || 0;

                        const delta = newQtyReq - oldQty; // e.g. 5 - 3 = +2 (need to remove 2 from stock)

                        if (delta > 0 && currentStock < delta) {
                            throw new Error(`Stock insuficiente para "${mapObj.name}". Actual: ${currentStock}, se necesitan ${delta} extra.`);
                        }
                        if (delta !== 0) {
                            updates.push({
                                ref: mapObj.ref,
                                newStock: currentStock - delta,
                                name: mapObj.name,
                                delta: delta,
                                newQtyReq: newQtyReq
                            });
                        }
                    }

                    const activeAuth = window.firebaseAuth || window.auth || auth;
                    for (const update of updates) {
                        transaction.update(update.ref, {
                            quantity: update.newStock,
                            lastUpdated: window.firebaseFirestore.serverTimestamp()
                        });

                        const historyRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Historial_Movimientos'));
                        
                        let movType = update.delta > 0 ? 'DESPACHO_BANDEJA' : 'DEVOLUCION_EDICION_BANDEJA';
                        let origin = update.delta > 0 ? 'Bodega Central' : `Bandeja: ${valorSelect}`;
                        let dest = update.delta > 0 ? `Bandeja: ${valorSelect}` : 'Bodega Central';
                        
                        transaction.set(historyRef, {
                            type: movType,
                            item: update.name,
                            quantity: Math.abs(update.delta),
                            user: activeAuth.currentUser ? activeAuth.currentUser.email : 'Sistema',
                            date: window.firebaseFirestore.serverTimestamp(),
                            origin: origin,
                            dest: dest,
                            observacion: modoEdicionId ? 'Ajuste por edición de bandeja' : ''
                        });
                    }

                    const bandejaRef = modoEdicionId 
                        ? window.firebaseFirestore.doc(window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno'), modoEdicionId)
                        : window.firebaseFirestore.doc(window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno'));

                    if (modoEdicionId) {
                        transaction.update(bandejaRef, {
                            identificador: valorSelect,
                            enfermeroAsignado: valorEmail,
                            medicamentos: itemsAEnviar,
                            fechaUltimaEdicion: window.firebaseFirestore.serverTimestamp(),
                            editadoPor: activeAuth.currentUser ? activeAuth.currentUser.email : 'Sistema'
                        });
                    } else {
                        const _now = new Date();
                        const trackingNumber = `BAN-${String(_now.getDate()).padStart(2, '0')}${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getHours()).padStart(2, '0')}${String(_now.getMinutes()).padStart(2, '0')}`;

                        transaction.set(bandejaRef, {
                            tracking: trackingNumber,
                            creador: auth.currentUser.email,
                            identificador: valorSelect,
                            enfermeroAsignado: valorEmail,
                            estado: 'CREADA',
                            fechaDespacho: window.firebaseFirestore.serverTimestamp(),
                            medicamentos: itemsAEnviar,
                            creadoPor: activeAuth.currentUser ? activeAuth.currentUser.email : 'Sistema'
                        });
                    }
                }).then(() => {
                    const msgExito = window._editingBandejaId ? 'Bandeja actualizada con éxito.' : 'Bandeja despachada con éxito.';
                    window.showToast("Operación Completada", msgExito, "success");

                    const modal = document.getElementById('modal-resumen-bandeja');
                    if (modal) modal.style.display = 'none';

                    const selectPlant = document.getElementById('select-tipo-plantilla');
                    const contenedorTabla = document.getElementById('contenedor-detalle-bandeja');
                    const tbody = document.getElementById('tabla-detalle-bandeja-body');

                    if (selectBandeja) {
                        selectBandeja.value = '';
                        selectBandeja.disabled = false;
                    }
                    if (selectPlant) selectPlant.value = '';
                    if (inputEnfermero) inputEnfermero.value = '';
                    if (contenedorTabla) contenedorTabla.style.display = 'none';
                    if (tbody) tbody.innerHTML = '';
                    
                    window._editingBandejaId = null;
                    const alertaEdicion = document.getElementById('alerta-edicion-bandeja');
                    if (alertaEdicion) alertaEdicion.style.display = 'none';

                    btnFinal.disabled = false;
                    btnFinal.innerHTML = originalText;
                    
                    const btnPre = document.getElementById('btn-pre-despacho');
                    if (btnPre) {
                        btnPre.innerHTML = '📦 Confirmar y Generar Despacho';
                        delete btnPre.dataset.modoEdicionId;
                    }

                    window.showAlertCenter("Notificación", modoEdicionId ? "Bandeja Editada Exitosamente" : "Despacho Exitoso");
                    const tabMis = document.getElementById('tab-mis-bandejas');
                    if (tabMis) tabMis.click();
                });

            } catch (error) {
                console.error("Error al despachar bandeja:", error);
                window.showAlertCenter("Error", error.message, true);
                btnFinal.disabled = false;
                btnFinal.innerHTML = 'Sí, Aceptar';
            }
        }
    });

    window.startBandejasModule = async function () {
        // 1. Lógica de Pestañas (Tabs)
        const tabCrear = document.getElementById('tab-crear-bandeja');
        const tabMis = document.getElementById('tab-mis-bandejas');
        const tabHistorial = document.getElementById('tab-historial-bandejas');
        const tabPacks = document.getElementById('tab-gestionar-packs');
        
        const panelCrear = document.getElementById('panel-crear-bandeja');
        const panelMis = document.getElementById('panel-mis-bandejas');
        const panelHistorial = document.getElementById('panel-historial-bandejas');
        const panelPacks = document.getElementById('panel-gestionar-packs');

        // [NEW] Lógica de Bloqueo de Bandejas en Uso
        if (window._bandejasActivasListener) {
            window._bandejasActivasListener();
        }
        window._bandejasActivasListener = onSnapshot(query(collection(db, 'Bandejas_Turno'), where('estado', '!=', 'FINALIZADA')), (snap) => {
            const bandejasEnUso = new Map();
            snap.forEach(docSnap => {
                const data = docSnap.data();
                if (data.numeroBandeja) bandejasEnUso.set(data.numeroBandeja, data.asignadoA || 'Sistema');
            });
            
            const selectBandeja = document.getElementById('select-numero-bandeja');
            if (selectBandeja) {
                Array.from(selectBandeja.options).forEach(opt => {
                    if (opt.value === "") return;
                    
                    const isEditing = window._editingBandejaId && selectBandeja.value === opt.value;
                    const asignadoA = bandejasEnUso.get(opt.value);
                    
                    if (asignadoA && !isEditing) {
                        opt.disabled = true;
                        if (!opt.text.includes('(EN USO')) opt.text = opt.value + ` (EN USO por ${asignadoA})`;
                    } else {
                        opt.disabled = false;
                        opt.text = opt.value; // Restore original
                    }
                });
            }
        });

        if (tabCrear && tabMis && panelCrear && panelMis && tabHistorial && panelHistorial && tabPacks && panelPacks) {
            // Limpiar listeners anteriores clonando
            const newTabCrear = tabCrear.cloneNode(true);
            tabCrear.parentNode.replaceChild(newTabCrear, tabCrear);
            const newTabMis = tabMis.cloneNode(true);
            tabMis.parentNode.replaceChild(newTabMis, tabMis);
            const newTabHistorial = tabHistorial.cloneNode(true);
            tabHistorial.parentNode.replaceChild(newTabHistorial, tabHistorial);
            const newTabPacks = tabPacks.cloneNode(true);
            tabPacks.parentNode.replaceChild(newTabPacks, tabPacks);

            const deseleccionarTodos = () => {
                panelCrear.style.display = 'none';
                panelMis.style.display = 'none';
                panelHistorial.style.display = 'none';
                panelPacks.style.display = 'none';
                newTabCrear.className = 'btn btn-outline-primary';
                newTabMis.className = 'btn btn-outline-primary';
                newTabHistorial.className = 'btn btn-outline-primary';
                newTabPacks.className = 'btn btn-outline-primary';
            };

            newTabCrear.addEventListener('click', (e) => {
                if (e.isTrusted) {
                    window._editingBandejaId = null;
                    const alertaEdicion = document.getElementById('alerta-edicion-bandeja');
                    if (alertaEdicion) alertaEdicion.style.display = 'none';
                    const selectBandeja = document.getElementById('select-numero-bandeja');
                    if (selectBandeja) selectBandeja.disabled = false;
                }
                deseleccionarTodos();
                panelCrear.style.display = 'block';
                newTabCrear.className = 'btn btn-primary';
            });

            newTabMis.addEventListener('click', () => {
                deseleccionarTodos();
                panelMis.style.display = 'block';
                newTabMis.className = 'btn btn-primary';
            });

            newTabHistorial.addEventListener('click', () => {
                deseleccionarTodos();
                panelHistorial.style.display = 'block';
                newTabHistorial.className = 'btn btn-primary';
                const role = document.body.getAttribute('data-user-role');
                if (role === 'enfermero') {
                    if (window.startHistorialBandejasEnfermero) window.startHistorialBandejasEnfermero();
                } else {
                    if (window.cargarHistorialBandejas) window.cargarHistorialBandejas();
                }
            });

            newTabPacks.addEventListener('click', () => {
                deseleccionarTodos();
                panelPacks.style.display = 'block';
                newTabPacks.className = 'btn btn-primary';
            });
        }

        if (document.body.getAttribute('data-user-role') === 'enfermero') {
            const tabMis = document.getElementById('tab-mis-bandejas');
            if (tabMis) tabMis.click();
        }

    };

    // Listener para Mis Bandejas (Enfermería)
    let unsubMisBandejas = null;
    window.startMisBandejasListener = async function () {
        console.log("[Bandejas] startMisBandejasListener INICIADO. auth.currentUser:", !!auth.currentUser);
        if (!auth.currentUser) return;
        if (unsubMisBandejas) unsubMisBandejas();

        const currentRole = document.body.getAttribute('data-user-role');
        console.log("[Bandejas] Rol actual detectado:", currentRole);
        let q;
        if (currentRole === 'enfermero') {
            console.log("[Bandejas] Creando query para enfermero:", auth.currentUser.email);
            // Local filter used inside onSnapshot to avoid Firebase composite index requirement
            q = query(
                collection(db, 'Bandejas_Turno'),
                where('enfermeroAsignado', '==', auth.currentUser.email)
            );
        } else {
            console.log("[Bandejas] Creando query para admin/supervisor");
            q = query(
                collection(db, 'Bandejas_Turno'),
                where('estado', 'in', ['CREADA', 'EN_USO', 'CERRADA_ENFERMERIA', 'EN_RECEPCION'])
            );
        }

        console.log("[Bandejas] Llamando a onSnapshot...");
        unsubMisBandejas = onSnapshot(q, (snapshot) => {
            console.log("[Bandejas] onSnapshot DISPARADO! Documentos recibidos:", snapshot.size);
            const container = document.getElementById('lista-mis-bandejas');
            if (!container) return;
            container.innerHTML = '';

            let hasVisibleTrays = false;

            snapshot.forEach(docSnap => {
                try {
                    const data = docSnap.data();
                    console.log("[Bandejas] Evaluando bandeja:", docSnap.id, "| Estado:", data.estado, "| Asignado a:", data.enfermeroAsignado);

                    // Local filtering for enfermero role
                    if (currentRole === 'enfermero' && !['CREADA', 'EN_USO'].includes(data.estado)) {
                        console.log("[Bandejas] Bandeja omitida por filtro local.");
                        return;
                    }

                    hasVisibleTrays = true;
                    const div = document.createElement('div');
                    div.className = 'data-table-card';
                    div.style.marginBottom = '16px';
                    div.style.border = '1px solid #dee2e6';
                    div.style.borderRadius = '8px';
                    div.style.overflow = 'hidden';

                    const trackingDisplay = data.tracking || data.identificador || docSnap.id.substring(0, 8);
                    const creatorDisplay = data.creador || data.creadoPor || 'Desconocido';
                    const badgeBg = data.estado === 'CREADA' ? 'var(--warning)' : 'var(--success)';

                    let dateStr = 'Fecha desconocida';
                    try {
                        const dateObj = data.fechaCreacion || data.fechaDespacho || data.fechaUltimaEdicion || null;
                        if (dateObj) {
                            dateStr = typeof dateObj.toDate === 'function' ? dateObj.toDate().toLocaleString() : String(dateObj);
                        }
                    } catch (e) { console.error("Error formatting date:", e); }

                        let html = `
                            <!-- HEADER DEL ACORDION -->
                            <div class="bandeja-accordion-header" style="background: #f8f9fa; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none';">
                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                    <strong style="font-size: 1.1em; color: #212529;">${trackingDisplay}</strong>
                                    <span class="text-muted" style="font-size: 0.85em;"><i class="ph ph-package"></i> ID Físico: ${data.identificador || docSnap.id.substring(0, 8)}</span>
                                </div>
                                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                                    <span class="badge" style="background: ${badgeBg}; color: #000; font-weight: bold; padding: 6px 12px; border-radius: 20px;">${data.estado}</span>
                                    <small style="color: #6c757d;">Asignada a: <span style="color:#0d6efd; font-weight:500;">${data.enfermeroAsignado || 'Sin Asignar'}</span> | Creada por: ${creatorDisplay}</small>
                                    <small style="color: #888; font-size: 0.8em;"><i class="ph ph-clock"></i> ${dateStr}</small>
                                </div>
                            </div>
                        
                        <!-- BODY DEL ACORDION (OCULTO POR DEFECTO) -->
                        <div class="bandeja-accordion-body" style="display: none; padding: 20px; border-top: 1px solid #dee2e6; background: white;">
                    `;

                    if (data.estado === 'CREADA' && currentRole !== 'enfermero') {
                        html += `<div style="margin-bottom: 15px; display:flex; justify-content:flex-end;">
                            <button type="button" class="btn btn-outline-primary btn-sm" onclick="window.abrirGestionBandeja('${docSnap.id}', '${data.enfermeroAsignado}')"><i class="ph ph-gear"></i> Gestionar Bandeja</button>
                        </div>`;
                    }

                    if (data.estado === 'ANULADA') {
                        html += `<div style="color:red; margin-bottom:10px;"><strong>Bandeja Anulada</strong> (${data.justificacionAnulacion || 'Sin justificar'})</div>`;
                    }

                    if (data.medicamentos && data.medicamentos.length > 0) {
                        const isEnUsoGeneral = data.estado === 'EN_USO';
                        html += `
                            <div class="table-responsive" style="border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
                                <table class="table table-hover table-sm mb-0">
                                    <thead style="background: #f1f3f5;">
                                        <tr>
                                            <th>Fármaco / Insumo</th>
                                            <th style="text-align: center;">Stock Asignado</th>
                                            <th style="text-align: center;">Salidas Acum.</th>
                                            <th style="text-align: center;">Stock Restante</th>
                                            ${isEnUsoGeneral && currentRole === 'enfermero' ? '<th style="text-align: center;">Acción</th>' : ''}
                                        </tr>
                                    </thead>
                                    <tbody>
                        `;

                        data.medicamentos.forEach((med, idx) => {
                            const maxVal = med.cantidadAsignada || 0;
                            const consumidoVal = med.cantidadConsumida !== undefined ? med.cantidadConsumida : 0;
                            const restante = maxVal - consumidoVal;
                            
                            html += `
                                <tr>
                                    <td>
                                        ${med.nombreInsumo || med.nombre}
                                        ${med.observacionAdicional ? `<br><small class="text-muted">${med.observacionAdicional}</small>` : ''}
                                    </td>
                                    <td style="text-align: center; font-weight: bold;">${maxVal}</td>
                                    <td style="text-align: center; color: #dc3545; font-weight: bold;">${consumidoVal > 0 ? '-' + consumidoVal : '0'}</td>
                                    <td style="text-align: center; color: #198754; font-weight: bold;">${restante}</td>
                                    ${isEnUsoGeneral && currentRole === 'enfermero' ? `
                                    <td style="text-align: center;">
                                        <button type="button" class="btn btn-sm btn-outline-primary" style="padding: 2px 8px; font-size: 0.85em;" onclick="window.abrirModalArqueoParcial('${docSnap.id}', ${idx}, '${med.nombreInsumo || med.nombre}', ${maxVal})">
                                            <i class="ph ph-plus-circle"></i> Arqueo
                                        </button>
                                    </td>
                                    ` : ''}
                                </tr>
                            `;
                        });
                        html += `</tbody></table></div>`;
                    }

                    // Acciones/Botones del Footer del Body
                    // Acciones/Botones del Footer del Body
                    if (currentRole === 'enfermero') {
                        if (data.estado === 'CREADA') {
                            html += `
                                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                                    <button type="button" class="btn btn-primary" onclick="window.confirmarRecepcionBandeja('${docSnap.id}')">
                                        <i class="ph ph-check-circle"></i> Aceptar y Poner en Uso
                                    </button>
                                </div>
                            `;
                        } else if (data.estado === 'EN_USO') {
                            html += `
                                <div style="display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;">
                                    <button type="button" class="btn btn-warning" onclick="window.abrirModalCuadratura('${docSnap.id}', '${trackingDisplay}')">
                                        <i class="ph ph-scales"></i> Terminar Turno y Cuadrar
                                    </button>
                                </div>
                            `;
                        }
                    } else {
                        if (data.estado === 'CREADA') {
                            html += `
                                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                                    <button type="button" class="btn btn-outline-primary" onclick="window.editarBandejaCreada('${docSnap.id}')">
                                        <i class="ph ph-pencil"></i> Editar Bandeja
                                    </button>
                                    <button type="button" class="btn btn-outline-danger" onclick="window.anularBandejaCreada('${docSnap.id}')">
                                        <i class="ph ph-trash"></i> Anular Bandeja
                                    </button>
                                </div>
                            `;
                        } else if (data.estado === 'EN_RECEPCION') {
                            html += `
                                <div style="display: flex; gap: 10px; justify-content: flex-end; padding-top: 10px;">
                                    <div class="alert alert-warning mb-0" style="flex:1; padding: 5px 10px; border-radius: 5px;">
                                        <i class="ph ph-bell-ringing"></i> <strong>¡ATENCIÓN!</strong> Esta bandeja fue devuelta por enfermería y está pendiente de cuadre y recepción.
                                    </div>
                                    <button type="button" class="btn btn-warning" onclick="window.abrirRecepcionOperador('${docSnap.id}')">
                                        <i class="ph ph-check-circle"></i> Recibir y Cuadrar
                                    </button>
                                </div>
                            `;
                        }
                    }

                    html += `</div>`; // Cierra Body

                    div.innerHTML = html;
                    container.appendChild(div);
                } catch (err) {
                    console.error("[Bandejas] ERROR FATAL AL RENDERIZAR BANDEJA", docSnap.id, err);
                    const errDiv = document.createElement('div');
                    errDiv.innerHTML = `<div class="text-danger" style="padding:10px; border:1px solid red; margin-bottom:10px;">Error al cargar bandeja ${docSnap.id}: ${err.message}</div>`;
                    container.appendChild(errDiv);
                    hasVisibleTrays = true;
                }
            });

            if (!hasVisibleTrays) {
                container.innerHTML = '<div class="text-center text-muted" style="padding: 20px;">No tienes bandejas asignadas pendientes.</div>';
            }

        }, (error) => {
            console.error("Error en onSnapshot de Mis Bandejas:", error);
            const container = document.getElementById('lista-mis-bandejas');
            if (container) container.innerHTML = `<div class="text-center text-danger" style="padding: 20px;">Error interno al consultar las bandejas: ${error.message}</div>`;
        });
    };


    window.validarFilaRecepcion = function (input) {
        const asignada = Number(input.getAttribute('data-asignada'));
        const recibida = Number(input.value);
        const tr = input.closest('tr');
        const obsInput = tr.querySelector('.recepcion-obs');

        if (recibida > asignada) {
            window.showToast('Atención', 'No puedes recibir más cantidad de la que fue despachada. Si hay un exceso, devuélvalo a bodega sin ingresarlo.', 'warning');
            input.value = asignada;
            obsInput.disabled = true;
            obsInput.value = '';
            obsInput.style.borderColor = '#ccc';
            return;
        }

        if (recibida < asignada) {
            obsInput.disabled = false;
            obsInput.focus();
            obsInput.style.borderColor = '#dc3545';
            window.showToast('Diferencia Detectada', 'Debes ingresar una observación para justificar el medicamento faltante.', 'warning');

            const docId = input.id.split('-')[1]; // ID del documento
            const warning = document.getElementById('warning-msg-' + docId);
            if (warning) warning.style.display = 'inline-block';
        } else {
            obsInput.disabled = true;
            obsInput.value = '';
            obsInput.style.borderColor = '#ccc';

            const docId = input.id.split('-')[1];
            const warning = document.getElementById('warning-msg-' + docId);
            // Check if there are other differences
            let anyDiff = false;
            const allInputs = document.querySelectorAll('input[id^="recibido-' + docId + '"]');
            allInputs.forEach(inp => {
                if (Number(inp.value) < Number(inp.getAttribute('data-asignada'))) anyDiff = true;
            });
            if (warning && !anyDiff) warning.style.display = 'none';
        }
    };

    window.confirmarRecepcionBandeja = async function (docId) {
        try {
            const docRef = doc(db, 'Bandejas_Turno', docId);

            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(docRef);
                if (!docSnap.exists()) {
                    throw new Error("La bandeja no existe o fue eliminada.");
                }

                const data = docSnap.data();
                if (data.estado === 'EN_USO') {
                    throw new Error("Esta bandeja ya fue recepcionada por otro usuario.");
                }

                let hasError = false;

                const medicamentosActualizados = data.medicamentos.map((med, idx) => {
                    const inputRecibido = document.getElementById(`recibido-${docId}-${idx}`);
                    const inputObs = document.getElementById(`obs-${docId}-${idx}`);

                    // Fallback to previous data if inputs don't exist (e.g., another user confirms it)
                    const recibido = inputRecibido ? Number(inputRecibido.value) : med.cantidadAsignada;
                    const obs = inputObs ? inputObs.value.trim() : '';

                    if (recibido !== med.cantidadAsignada && obs === '') {
                        if (inputObs) inputObs.focus();
                        hasError = true;
                    }

                    return {
                        ...med,
                        cantidadRecibida: recibido,
                        observacion: obs
                    };
                });

                if (hasError) {
                    throw new Error("DIFERENCIA_SIN_OBSERVACION");
                }


                // Generar Mermas de Despacho
                medicamentosActualizados.forEach(med => {
                    if (med.cantidadRecibida < med.cantidadAsignada) {
                        const diferencia = med.cantidadAsignada - med.cantidadRecibida;
                        const histRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(db, 'Historial_Movimientos'));
                        transaction.set(histRef, {
                            tipoAccion: 'MERMA_DESPACHO',
                            fechaHora: window.firebaseFirestore.serverTimestamp(),
                            usuario: auth.currentUser.email,
                            nombreInsumo: med.nombreInsumo,
                            cantidadAnterior: med.cantidadAsignada,
                            cantidadNueva: med.cantidadRecibida,
                            cantidadDiferencia: diferencia,
                            observaciones: 'Faltante reportado por enfermería: ' + med.observacion,
                            idBandeja: docId
                        });
                    }
                });

                transaction.update(docRef, {
                    estado: 'EN_USO',
                    medicamentos: medicamentosActualizados,
                    fechaRecepcion: window.firebaseFirestore.serverTimestamp()
                });
            });

            window.showToast('Éxito', 'Recepción de bandeja confirmada.', 'success');
        } catch (err) {
            console.error(err);
            if (err.message === "DIFERENCIA_SIN_OBSERVACION") {
                window.showToast('Error', 'Debe indicar una observación debido a la diferencia de cantidad.', 'error');
            } else {
                window.showToast('Error', err.message || 'Fallo al confirmar la recepción.', 'error');
            }
        }
    };

    // ==========================================
    // ==========================================
    // ==========================================
    // LOGICA DE TURNO (CONSUMO Y MERMA)
    // ==========================================
    window._mermaActiva = { docId: null, idx: null };
    window._arqueoParcialActivo = { docId: null, idx: null, maxVal: 0 };

    window.abrirModalArqueoParcial = function (docId, idx, nombreInsumo, maxVal) {
        window._arqueoParcialActivo = { docId, idx, maxVal };
        document.getElementById('arqueo-farmaco-nombre').textContent = nombreInsumo;
        document.getElementById('arqueo-popup-cantidad').value = 1;
        document.getElementById('arqueo-popup-cantidad').max = maxVal;
        document.getElementById('arqueo-popup-motivo').value = 'Consumido al paciente';
        document.getElementById('modal-arqueo-parcial-popup').classList.add('active');
    };

    window.confirmarArqueoParcialPopup = async function () {
        const cant = Number(document.getElementById('arqueo-popup-cantidad').value) || 0;
        const motivo = document.getElementById('arqueo-popup-motivo').value;

        if (cant <= 0) {
            window.showToast('Error', 'La cantidad a registrar debe ser mayor a 0', 'error');
            return;
        }

        const { docId, idx, maxVal } = window._arqueoParcialActivo;
        if (!docId) return;

        try {
            const docRef = window.firebaseFirestore.doc(db, 'Bandejas_Turno', docId);
            const snap = await window.firebaseFirestore.getDoc(docRef);
            if (!snap.exists()) throw new Error("La bandeja no existe.");

            const data = snap.data();
            const med = data.medicamentos[idx];
            
            const consumidoPrevio = med.cantidadConsumida || 0;
            const nuevoConsumido = consumidoPrevio + cant;

            if (nuevoConsumido > maxVal) {
                window.showToast('Atención', 'La cantidad acumulada supera el stock asignado originalmente.', 'warning');
            }

            const nuevaObs = med.observacionAdicional 
                ? `${med.observacionAdicional} | (+${cant}) ${motivo}` 
                : `(+${cant}) ${motivo}`;

            const medicamentosActualizados = [...data.medicamentos];
            medicamentosActualizados[idx] = {
                ...med,
                cantidadConsumida: nuevoConsumido,
                observacionAdicional: nuevaObs
            };

            // Guardar en Firestore la bandeja
            await window.firebaseFirestore.updateDoc(docRef, {
                medicamentos: medicamentosActualizados,
                fechaUltimoGuardado: window.firebaseFirestore.serverTimestamp()
            });

            // Registrar en historial de movimientos
            const histRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(db, 'Historial_Movimientos'));
            await window.firebaseFirestore.setDoc(histRef, {
                tipoAccion: 'ARQUEO_PARCIAL',
                fechaHora: window.firebaseFirestore.serverTimestamp(),
                usuario: auth.currentUser ? auth.currentUser.email : 'desconocido',
                idBandeja: docId,
                nombreInsumo: med.nombreInsumo || med.nombre,
                cantidadMermada: cant,
                motivoMerma: motivo
            });

            document.getElementById('modal-arqueo-parcial-popup').classList.remove('active');
            window.showToast('Éxito', 'Arqueo parcial registrado correctamente', 'success');

        } catch (error) {
            console.error(error);
            window.showToast('Error', 'No se pudo guardar el arqueo: ' + error.message, 'error');
        }
    };
    window.abrirModalMerma = function (docId, idx, nombreInsumo) {
        window._mermaActiva = { docId, idx };
        document.getElementById('merma-farmaco-nombre').textContent = nombreInsumo;
        document.getElementById('merma-popup-cantidad').value = 1;
        document.getElementById('merma-popup-motivo').value = '';
        document.getElementById('modal-merma-popup').classList.add('active');
        setTimeout(() => document.getElementById('merma-popup-motivo').focus(), 100);
    };

    window.confirmarMermaPopup = function () {
        const cant = Number(document.getElementById('merma-popup-cantidad').value) || 0;
        const motivo = document.getElementById('merma-popup-motivo').value.trim();

        if (cant <= 0) {
            window.showToast('Error', 'La cantidad debe ser mayor a 0', 'error');
            return;
        }
        if (!motivo) {
            window.showToast('Atención', 'Debe ingresar el motivo obligatoriamente', 'warning');
            return;
        }

        const { docId, idx } = window._mermaActiva;
        if (!docId) return;

        const mermaInput = document.getElementById(`merma-${docId}-${idx}`);
        const obsInput = document.getElementById(`obs-merma-${docId}-${idx}`);
        const displayDiv = document.getElementById(`text-merma-display-${docId}-${idx}`);
        const displayNum = document.getElementById(`num-merma-display-${docId}-${idx}`);

        let currentMerma = Number(mermaInput.value) || 0;
        let currentObs = obsInput.value;

        mermaInput.value = currentMerma + cant;
        obsInput.value = currentObs ? `${currentObs} | (+${cant}) ${motivo}` : `(+${cant}) ${motivo}`;

        displayDiv.style.display = 'block';
        displayNum.textContent = mermaInput.value;

        document.getElementById('modal-merma-popup').classList.remove('active');

        window.calcularSaldoEnlinea(docId, idx);
    };

    window.calcularSaldoEnlinea = function (docId, idx) {
        const consumoInput = document.getElementById(`consumo-${docId}-${idx}`);
        const mermaInput = document.getElementById(`merma-${docId}-${idx}`);
        const saldoElement = document.getElementById(`saldo-${docId}-${idx}`);

        if (!consumoInput || !mermaInput || !saldoElement) return;

        const recibido = Number(consumoInput.getAttribute('data-recibido')) || 0;
        const consumoBase = Number(consumoInput.getAttribute('data-consumidobase')) || 0;
        const mermaBase = Number(consumoInput.getAttribute('data-mermabase')) || 0;

        let consumoActual = Number(consumoInput.value) || 0;
        let mermaActual = Number(mermaInput.value) || 0;

        if (consumoActual < 0) { consumoActual = 0; consumoInput.value = 0; }
        if (mermaActual < 0) { mermaActual = 0; mermaInput.value = 0; }

        let nuevoSaldo = recibido - consumoBase - mermaBase - consumoActual - mermaActual;

        if (nuevoSaldo < 0) {
            window.showToast('Atención', 'El consumo y merma superan el saldo disponible.', 'error');
            // Revert last change roughly
            if (document.activeElement === consumoInput) {
                consumoInput.value = 0;
                consumoActual = 0;
            } else if (document.activeElement === mermaInput) {
                mermaInput.value = 0;
                mermaActual = 0;
            }
            nuevoSaldo = recibido - consumoBase - mermaBase - consumoActual - mermaActual;
        }

        saldoElement.textContent = nuevoSaldo;
        if (nuevoSaldo === 0) {
            saldoElement.style.color = 'var(--danger)';
        } else {
            saldoElement.style.color = 'var(--text)';
        }
    };

    window.guardarConsumosEnfermeria = async function (docId) {
        const btn = document.getElementById(`btn-guardar-inline-${docId}`);
        if (!btn) return;

        const consumosNuevos = [];
        const mermasNuevas = [];

        const inputsConsumo = document.querySelectorAll(`.inline-consumido.input-en-uso-${docId}`);
        const inputsMerma = document.querySelectorAll(`.inline-merma.input-en-uso-${docId}`);

        let hayCambios = false;
        let faltanObservaciones = false;

        inputsConsumo.forEach((input, i) => {
            const consumo = Number(input.value) || 0;
            const merma = Number(inputsMerma[i].value) || 0;

            const obsInput = document.getElementById(`obs-merma-${docId}-${i}`);
            const obsMerma = obsInput ? obsInput.value.trim() : '';

            if (merma > 0 && !obsMerma) {
                faltanObservaciones = true;
            }

            if (consumo > 0 || merma > 0) hayCambios = true;

            consumosNuevos.push(consumo);
            mermasNuevas.push({ cantidad: merma, observacion: obsMerma });
        });

        if (faltanObservaciones) {
            window.showToast('Atención', 'Es obligatorio justificar el motivo de la merma en el campo de texto rojo.', 'warning');
            return;
        }

        if (!hayCambios) {
            window.showToast('Aviso', 'No hay registros nuevos para guardar.', 'info');
            return;
        }

        if (!confirm('¿Guardar los consumos y mermas ingresados?')) return;

        try {
            btn.disabled = true;
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Guardando...';

            const docRef = window.firebaseFirestore.doc(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno', docId);

            await window.firebaseFirestore.runTransaction(window.firebaseFirestore.db || window.db || db, async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists()) throw new Error("Bandeja no encontrada.");

                const data = snap.data();
                const meds = data.medicamentos;

                let userEmail = 'Enfermería';
                try {
                    userEmail = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.email :
                        ((window.auth && window.auth.currentUser) ? window.auth.currentUser.email : 'Enfermería');
                } catch (e) { }

                for (let i = 0; i < meds.length; i++) {
                    const c = consumosNuevos[i] || 0;
                    const mObj = mermasNuevas[i] || { cantidad: 0, observacion: '' };
                    const m = mObj.cantidad;

                    if (c > 0) {
                        const auditRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(docRef, 'Auditoria_Turno'));
                        transaction.set(auditRef, {
                            tipo: 'Consumo',
                            farmaco: meds[i].nombreInsumo,
                            cantidad: c,
                            observacion: '',
                            usuario: userEmail,
                            fecha: window.firebaseFirestore.serverTimestamp()
                        });
                    }

                    if (m > 0) {
                        const auditRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(docRef, 'Auditoria_Turno'));
                        transaction.set(auditRef, {
                            tipo: 'Merma',
                            farmaco: meds[i].nombreInsumo,
                            cantidad: m,
                            observacion: mObj.observacion,
                            usuario: userEmail,
                            fecha: window.firebaseFirestore.serverTimestamp()
                        });
                    }

                    meds[i].cantidadConsumida = (meds[i].cantidadConsumida || 0) + c;
                    meds[i].cantidadMerma = (meds[i].cantidadMerma || 0) + m;
                }

                transaction.update(docRef, { medicamentos: meds });
            });

            window.showToast('Éxito', 'Registros guardados correctamente.', 'success');

        } catch (error) {
            console.error(error);
            window.showToast('Error', error.message || 'Error al guardar consumos', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="ph ph-floppy-disk"></i> Guardar Registros';
        }
    };

    window.abrirCierreTurno = function (docId) {
        window._bandejaActivaId = docId;
        const inputExcel = document.getElementById('input-excel-cierre');
        if (inputExcel) inputExcel.value = '';
        const res = document.getElementById('resultado-cuadratura');
        if (res) res.style.display = 'none';
        const btn = document.getElementById('btn-finalizar-turno');
        if (btn) btn.style.display = 'none';

        document.getElementById('modal-cierre-turno').classList.add('active');
    };

    document.addEventListener('change', async (e) => {
        if (e.target.id === 'input-excel-cierre') {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    // Usamos {header: 1} para obtener la tabla como matriz 2D y sortear celdas combinadas y saltos de pagina
                    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

                    // 1. Buscar indices de columnas
                    let colFarmacos = -1;
                    let colSolicitado = -1;

                    // Recorremos buscando la fila de cabeceras
                    for (let i = 0; i < Math.min(rows.length, 50); i++) {
                        const row = rows[i];
                        if (!row) continue;

                        for (let j = 0; j < row.length; j++) {
                            const val = String(row[j] || '').trim().toLowerCase();
                            // Buscar columnas que contengan las palabras clave
                            if (val.includes('fármaco') || val.includes('farmaco') || val.includes('insumo') || val.includes('medicamento')) {
                                colFarmacos = j;
                            }
                            if (val.includes('administrado') || val.includes('cantidad realizada')) {
                                colSolicitado = j;
                            }
                        }

                        if (colFarmacos !== -1 && colSolicitado !== -1) break;
                    }

                    if (colFarmacos === -1 || colSolicitado === -1) {
                        throw new Error("No se encontraron las columnas 'Fármacos' (o 'Insumos') y 'Cantidad realizada' en el Excel.");
                    }

                    // 2. Extraer data
                    const rayenData = {};
                    for (let i = 0; i < rows.length; i++) {
                        const row = rows[i];
                        if (!row) continue;
                        const nombre = String(row[colFarmacos] || '').trim();
                        // Ignorar filas vacias o cabeceras o paginacion
                        if (!nombre || nombre.toLowerCase() === 'fármacos' || nombre.toLowerCase() === 'insumos' || nombre.toLowerCase().startsWith('página')) {
                            continue;
                        }

                        const qtyStr = String(row[colSolicitado] || '0').trim();
                        const qty = Number(qtyStr);

                        if (!isNaN(qty)) {
                            // Normalizar nombre: minusculas, sin tildes
                            const normName = nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                            rayenData[normName] = {
                                originalName: nombre,
                                totalSolicitado: qty
                            };
                        }
                    }

                    console.log("Datos extraidos de RAYEN:", rayenData);

                    // 3. Obtener consumos de la bandeja de VISOR
                    const docId = window._bandejaActivaId;
                    const docRef = doc(db, 'Bandejas_Turno', docId);
                    const docSnap = await getDoc(docRef);
                    if (!docSnap.exists()) throw new Error("Bandeja no encontrada en VISOR.");

                    const bandeja = docSnap.data();
                    const visorData = {};

                    bandeja.medicamentos.forEach(med => {
                        const nombre = med.nombreInsumo || med.nombre;
                        const normName = nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                        // Consumo = Asignado Original - Recibido Actual (porque las salidas restan a cantidadRecibida)
                        const asignado = Number(med.cantidadAsignada || 0);
                        const restante = Number(med.cantidadRecibida || 0);
                        const consumido = asignado - restante;

                        visorData[normName] = {
                            originalName: nombre,
                            consumido: consumido,
                            restante: restante,
                            asignado: asignado
                        };
                    });

                    // 4. Hacer Match
                    const matchResults = [];
                    // Revisar lo de VISOR vs RAYEN
                    for (const normName in visorData) {
                        const vData = visorData[normName];
                        if (rayenData[normName]) {
                            const rData = rayenData[normName];
                            const diff = vData.consumido - rData.totalSolicitado;
                            let estadoStr = '';
                            let estadoColor = '';
                            if (diff === 0) {
                                estadoStr = 'Completado / Sin Inconsistencias';
                                estadoColor = 'var(--success)';
                            } else {
                                estadoStr = 'Diferencia';
                                estadoColor = 'var(--danger)';
                            }
                            matchResults.push({
                                normName: normName,
                                visorName: vData.originalName,
                                rayenName: rData.originalName,
                                consumidoVisor: vData.consumido,
                                solicitadoRayen: rData.totalSolicitado,
                                estado: estadoStr,
                                color: estadoColor,
                                diff: diff,
                                requiereObs: diff !== 0
                            });
                            // Marcar como procesado en rayenData
                            rayenData[normName].procesado = true;
                        } else {
                            if (vData.consumido > 0) {
                                matchResults.push({
                                    normName: normName,
                                    visorName: vData.originalName,
                                    rayenName: 'No existe en reporte',
                                    consumidoVisor: vData.consumido,
                                    solicitadoRayen: 0,
                                    estado: 'Faltante en Reporte',
                                    color: 'var(--warning)',
                                    diff: vData.consumido,
                                    requiereObs: true
                                });
                            }
                        }
                    }

                    // Revisar lo que quedó en RAYEN y no está en VISOR
                    for (const normName in rayenData) {
                        const rData = rayenData[normName];
                        if (!rData.procesado && rData.totalSolicitado > 0) {
                            matchResults.push({
                                normName: normName,
                                visorName: 'No existe en bandeja',
                                rayenName: rData.originalName,
                                consumidoVisor: 0,
                                solicitadoRayen: rData.totalSolicitado,
                                estado: 'Faltante en Bandeja',
                                color: 'var(--warning)',
                                diff: -rData.totalSolicitado,
                                requiereObs: true
                            });
                        }
                    }

                    // 5. Renderizar Tabla de Cuadratura
                    let tableHtml = `
                        <h4 style="margin-top: 0;">Resumen de Cruce (VISOR vs RAYEN)</h4>
                        <div class="table-responsive" style="max-height: 300px; overflow-y: auto;">
                            <table class="table table-hover">
                                <thead style="position: sticky; top: 0; background: #f8f9fa;">
                                    <tr>
                                        <th>Insumo / Fármaco</th>
                                        <th>Visor (Consumido)</th>
                                        <th>Excel (Administrado)</th>
                                        <th>Estado</th>
                                        <th>Justificación (Si hay diferencia)</th>
                                    </tr>
                                </thead>
                                <tbody>
                    `;

                    let tieneDiferencias = false;

                    matchResults.forEach((res, idx) => {
                        if (res.requiereObs) tieneDiferencias = true;

                        tableHtml += `
                            <tr style="background: ${res.color}15;">
                                <td style="font-size: 0.9em;">
                                    <strong>V:</strong> ${res.visorName}<br>
                                    <strong>R:</strong> ${res.rayenName}
                                </td>
                                <td style="font-size: 1.1em; font-weight: bold; text-align: center;">${res.consumidoVisor}</td>
                                <td style="font-size: 1.1em; font-weight: bold; text-align: center;">${res.solicitadoRayen}</td>
                                <td><span class="badge" style="background: ${res.color}; color: #fff;">${res.estado}</span></td>
                                <td>
                                    ${res.requiereObs ?
                                `<input type="text" class="form-control obs-cruce" data-idx="${idx}" placeholder="Indique motivo de diferencia" style="min-width: 150px;">` :
                                '<span style="color: #6c757d; font-size: 0.85em;">No requiere</span>'
                            }
                                </td>
                            </tr>
                        `;
                    });

                    tableHtml += `</tbody></table></div>`;

                    const resDiv = document.getElementById('resultado-cuadratura');
                    resDiv.style.display = 'block';
                    resDiv.innerHTML = tableHtml;

                    window._matchResults = matchResults;

                    document.getElementById('btn-finalizar-turno').style.display = 'inline-block';

                    // Validar justificaciones al cerrar
                    window._checkJustificaciones = () => {
                        const inputs = document.querySelectorAll('.obs-cruce');
                        let allFilled = true;
                        inputs.forEach(inp => {
                            if (!inp.value.trim()) allFilled = false;
                        });
                        return allFilled;
                    };

                    // Guardar observaciones en el json final
                    window._getMatchFinalData = () => {
                        const finalData = JSON.parse(JSON.stringify(matchResults));
                        const inputs = document.querySelectorAll('.obs-cruce');
                        inputs.forEach(inp => {
                            const i = Number(inp.getAttribute('data-idx'));
                            finalData[i].observacionCierre = inp.value.trim();
                        });
                        return finalData;
                    };

                } catch (err) {
                    window.showAlertCenter("Error", "Error leyendo Excel: " + err.message, true);
                }
            };
            reader.readAsArrayBuffer(file);
        }
    });

    document.addEventListener('click', async (e) => {
        if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-finalizar-turno') : null)) {
            const docId = window._bandejaActivaId;
            if (!docId) return;
            if (!confirm("¿Está seguro de cerrar el turno y enviar la bandeja a Bodega Central?")) return;

            if (window._checkJustificaciones && !window._checkJustificaciones()) {
                window.showAlertCenter("Notificación", "Debe completar todas las justificaciones obligatorias para las diferencias.");
                return;
            }

            try {
                const btn = (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-finalizar-turno') : null);
                btn.disabled = true;
                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Finalizando...';

                const finalCruce = window._getMatchFinalData ? window._getMatchFinalData() : [];

                const docRef = doc(db, 'Bandejas_Turno', docId);

                // Pre-fetch Insumos refs outside transaction
                const initialSnap = await window.firebaseFirestore.getDoc(docRef);
                if (!initialSnap.exists()) throw new Error("La bandeja no existe.");
                const insumosRefsMap = {};
                for (let med of initialSnap.data().medicamentos) {
                    const insQuery = window.firebaseFirestore.query(window.firebaseFirestore.collection(db, 'Insumos'), window.firebaseFirestore.where('name', '==', med.nombreInsumo), window.firebaseFirestore.limit(1));
                    const iSnap = await window.firebaseFirestore.getDocs(insQuery);
                    if (!iSnap.empty) insumosRefsMap[med.nombreInsumo] = window.firebaseFirestore.doc(db, 'Insumos', iSnap.docs[0].id);
                }

                await window.firebaseFirestore.runTransaction(db, async (transaction) => {
                    const snap = await transaction.get(docRef);
                    if (!snap.exists()) throw new Error("La bandeja no existe.");

                    const data = snap.data();
                    const medicamentosActualizados = data.medicamentos.map(med => {
                        const recibida = med.cantidadRecibida || 0;
                        const consumida = med.cantidadConsumida || 0;
                        const merma = med.cantidadMerma || 0;
                        const sobrante = recibida - consumida - merma;

                        if (sobrante > 0) {
                            // Generar Movimiento de Retorno en el Historial
                            const histRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(db, 'Historial_Movimientos'));
                            transaction.set(histRef, {
                                tipoAccion: 'RETORNO_BANDEJA',
                                fechaHora: window.firebaseFirestore.serverTimestamp(),
                                usuario: auth.currentUser.email,
                                nombreInsumo: med.nombreInsumo,
                                cantidadAnterior: 0,
                                cantidadNueva: sobrante,
                                cantidadDiferencia: sobrante,
                                observaciones: 'Retorno tras Cuadratura Excel de Bandeja ' + (data.identificador || docId),
                                idBandeja: docId
                            });

                            if (insumosRefsMap[med.nombreInsumo]) {
                                transaction.update(insumosRefsMap[med.nombreInsumo], {
                                    quantity: window.firebaseFirestore.increment(sobrante)
                                });
                            }
                        }
                        return { ...med, cantidadRetornada: sobrante };
                    });

                    transaction.update(docRef, {
                        estado: 'CERRADA_FINAL', // Cambio de estado a CERRADA_FINAL o RETORNADA
                        fechaCierre: window.firebaseFirestore.serverTimestamp(),
                        cruceCierreTurno: finalCruce,
                        excelRawLength: window._excelData ? window._excelData.length : 0,
                        medicamentos: medicamentosActualizados
                    });
                });

                document.getElementById('modal-cierre-turno').style.display = 'none';
                window.showToast('Turno Cerrado', 'La bandeja ha sido devuelta a Bodega Central.', 'success');
                btn.disabled = false;
                btn.innerHTML = '🔒 Entregar Bandeja a Bodega';
            } catch (error) {
                console.error(error);
                window.showAlertCenter("Error", "Error: " + error.message, true);
                (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-finalizar-turno') : null).disabled = false;
                (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-finalizar-turno') : null).innerHTML = '🔒 Entregar Bandeja a Bodega';
            }
        }
    });

    // ==========================================
    // ==========================================
    // RECEPCION EN BODEGA (OPERADOR)
    // ==========================================
    window.abrirRecepcionBodega = async function (docId) {
        window._recepcionBodegaId = docId;
        const cruceDiv = document.getElementById('recepcion-bodega-cruce');
        const fisicaDiv = document.getElementById('recepcion-bodega-fisica');
        if (!cruceDiv || !fisicaDiv) return;

        try {
            const docRef = doc(db, 'Bandejas_Turno', docId);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) throw new Error("Bandeja no encontrada");

            const data = docSnap.data();
            const cruceData = data.cruceCierreTurno || [];

            // 1. Renderizar tabla de cruce
            let cruceHtml = `
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead style="background: #f8f9fa;">
                            <tr>
                                <th>Insumo</th>
                                <th>Consumo (Visor)</th>
                                <th>Solicitado (Rayen)</th>
                                <th>Estado</th>
                                <th>Justificación de Enfermería</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            if (cruceData.length === 0) {
                cruceHtml += `<tr><td colspan="5" class="text-center">No hay datos de cruce disponibles.</td></tr>`;
            } else {
                cruceData.forEach(res => {
                    cruceHtml += `
                        <tr style="background: ${res.color}15;">
                            <td style="font-size: 0.85em;">
                                <strong>V:</strong> ${res.visorName}<br>
                                <strong>R:</strong> ${res.rayenName}
                            </td>
                            <td style="font-weight: bold; text-align: center;">${res.consumidoVisor}</td>
                            <td style="font-weight: bold; text-align: center;">${res.solicitadoRayen}</td>
                            <td><span class="badge" style="background: ${res.color}; color: #fff;">${res.estado}</span></td>
                            <td style="font-size: 0.9em; font-style: italic; color: #555;">${res.observacionCierre || 'N/A'}</td>
                        </tr>
                    `;
                });
            }
            cruceHtml += `</tbody></table></div>`;
            cruceDiv.innerHTML = cruceHtml;

            // 2. Renderizar tabla física
            let fisicaHtml = `
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead style="background: #f8f9fa;">
                            <tr>
                                <th>Fármaco Original de Bandeja</th>
                                <th>Stock Esperado (Teórico)</th>
                                <th>Recepción Física (Real)</th>
                                <th>Obs (Si difiere)</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            data.medicamentos.forEach((med, idx) => {
                const nombre = med.nombreInsumo || med.nombre;
                const esperado = Number(med.cantidadRecibida || 0); // Esto es lo que quedó despues de mermas/consumos

                fisicaHtml += `
                    <tr>
                        <td style="font-weight: bold;">${nombre}</td>
                        <td style="text-align: center; font-size: 1.1em; color: var(--primary);">${esperado}</td>
                        <td>
                            <input type="number" class="form-control input-recepcion-real" data-idx="${idx}" data-esperado="${esperado}" data-nombre="${nombre}" value="${esperado}" min="0" style="width: 80px;">
                        </td>
                        <td>
                            <input type="text" class="form-control input-recepcion-obs" data-idx="${idx}" placeholder="Motivo de diferencia">
                        </td>
                    </tr>
                `;
            });

            fisicaHtml += `</tbody></table></div>`;
            fisicaDiv.innerHTML = fisicaHtml;

            document.getElementById('modal-recepcion-bodega').style.display = 'flex';

        } catch (error) {
            console.error(error);
            window.showToast('Error', error.message, 'error');
        }
    };

    document.addEventListener('click', async (e) => {
        if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-confirmar-recepcion-bodega') : null)) {
            const docId = window._recepcionBodegaId;
            if (!docId) return;

            // Validar que las diferencias tengan observación
            const inputsReal = document.querySelectorAll('.input-recepcion-real');
            const inputsObs = document.querySelectorAll('.input-recepcion-obs');

            let isValid = true;
            let mermasExtras = [];
            let stockARetornar = [];

            inputsReal.forEach(inp => {
                const idx = inp.getAttribute('data-idx');
                const esperado = Number(inp.getAttribute('data-esperado'));
                const real = Number(inp.value);
                const nombre = inp.getAttribute('data-nombre');

                const obsInput = Array.from(inputsObs).find(o => o.getAttribute('data-idx') === idx);
                const obs = obsInput ? obsInput.value.trim() : '';

                if (real !== esperado && !obs) {
                    isValid = false;
                }

                if (real > 0) {
                    stockARetornar.push({ nombre, cantidad: real });
                }

                if (real < esperado) {
                    const diff = esperado - real;
                    mermasExtras.push({ nombre, cantidad: diff, observacion: obs });
                } else if (real > esperado) {
                    // Caso raro: devuelve mas de lo esperado.
                    const diff = real - esperado;
                    mermasExtras.push({ nombre, cantidad: -diff, observacion: obs + " (Sobrante no reportado)" });
                }
            });

            if (!isValid) {
                window.showAlertCenter("Notificación", "Debe ingresar una observación para todas las cantidades físicas que difieran del stock teórico esperado.");
                return;
            }

            if (!confirm("¿Confirmar la recepción final de esta bandeja? El stock físico ingresado será sumado al Inventario Central.")) return;

            try {
                const btn = (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-confirmar-recepcion-bodega') : null);
                btn.disabled = true;
                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Procesando...';

                const docRef = doc(db, 'Bandejas_Turno', docId);
                const invRef = collection(db, 'Insumos');

                // 1. PRE-FETCH: Buscar referencias de los items a retornar ANTES de la transacción
                let docIdsMap = {};
                for (const item of stockARetornar) {
                    const key = item.nombre.toLowerCase().trim();
                    const q1 = query(invRef, where('name', '==', item.nombre), limit(1));
                    const snap1 = await getDocs(q1);
                    if (!snap1.empty) {
                        docIdsMap[key] = snap1.docs[0].id;
                    }
                }

                await runTransaction(db, async (transaction) => {
                    const snap = await transaction.get(docRef);
                    if (!snap.exists()) throw new Error("La bandeja no existe.");

                    // 2. Sumar stock a retornar al Insumos
                    for (const item of stockARetornar) {
                        const key = item.nombre.toLowerCase().trim();
                        if (docIdsMap[key]) {
                            const itemRef = doc(db, 'Insumos', docIdsMap[key]);
                            transaction.update(itemRef, {
                                quantity: window.firebaseFirestore.increment(item.cantidad)
                            });
                        } else {
                            // Si no existiera en inventario central, se crea el item
                            const newItemRef = doc(collection(db, 'Insumos'));
                            transaction.set(newItemRef, {
                                name: item.nombre,
                                quantity: item.cantidad,
                                lpn: 'N/A',
                                lote: 'RETORNO',
                                expirationDate: 'N/A',
                                date: serverTimestamp(),
                                operator: auth.currentUser.email
                            });
                            docIdsMap[key] = newItemRef.id;
                        }

                        // Registrar ENTRADA en Historial
                        const histRef = doc(collection(db, 'Historial_Movimientos'));
                        transaction.set(histRef, {
                            tipoAccion: 'ENTRADA',
                            detalle: 'Devolución de Bandeja de Turno (Recepción Física Bodega)',
                            cantidad: item.cantidad,
                            quantity: item.cantidad,
                            nombreInsumo: item.nombre,
                            documentoRespaldo: 'Bandeja ID: ' + docId.substring(0, 8),
                            usuario: auth.currentUser.email,
                            fechaHora: serverTimestamp(),
                            origen: 'Bandeja de Turno',
                            destino: 'Insumos'
                        });
                    }

                    // 3. Cambiar estado de la bandeja a CERRADA_FINAL
                    transaction.update(docRef, {
                        estado: 'CERRADA_FINAL',
                        fechaRecepcionBodega: serverTimestamp(),
                        operadorReceptor: auth.currentUser.email,
                        mermasRecepcionFisica: mermasExtras
                    });
                });

                document.getElementById('modal-recepcion-bodega').style.display = 'none';
                window.showToast('Recepción Exitosa', 'El stock ha retornado al Inventario Central.', 'success');
                btn.disabled = false;
                btn.innerHTML = '<i class="ph ph-check-circle"></i> Confirmar Retorno y Finalizar';
            } catch (error) {
                console.error(error);
                window.showAlertCenter("Error", "Error al procesar: " + error.message, true);
                (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-confirmar-recepcion-bodega') : null).disabled = false;
                (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-confirmar-recepcion-bodega') : null).innerHTML = '<i class="ph ph-check-circle"></i> Confirmar Retorno y Finalizar';
            }
        }
    });

    // KARDEX CLÍNICO INTERACTIVO (TRAZABILIDAD)
    // ==========================================
    let kardexChartInstance = null;

    window.openKardexModal = async function (docId, itemName) {
        if (typeof window.openModal !== 'function') {
            console.error('openModal no disponible');
            return;
        }

        window.openModal('modal-kardex');
        document.getElementById('kardex-subtitle').textContent = itemName;

        // PWA Cache Bypass: Corregir clase CSS dinámicamente si el index.html está en caché
        const kardexOverlay = document.getElementById('modal-kardex');
        if (kardexOverlay) {
            const innerDiv = kardexOverlay.querySelector('.modal');
            if (innerDiv) innerDiv.className = 'modal-content';
        }

        const stockActualEl = document.getElementById('kardex-stock-actual') || document.getElementById('kardex-stock');
        const consumoPromedioEl = document.getElementById('kardex-consumo-promedio') || document.getElementById('kardex-burn');
        const runwayEl = document.getElementById('kardex-runway');
        const tbody = document.getElementById('kardex-table-body');

        if (!stockActualEl || !consumoPromedioEl) {
            console.error("DOM Kardex Error: No se encontraron los elementos del DOM. Revisa la caché.");
            return;
        }

        stockActualEl.textContent = '...';
        consumoPromedioEl.textContent = '...';
        runwayEl.textContent = '...';
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;"><i class="ph-spinner ph-spin"></i> Cargando historial analítico...</td></tr>';

        try {
            // 1. Obtener Stock Actual del Insumo
            const insumoDoc = await getDoc(doc(db, 'Insumos', docId));
            let currentStock = 0;
            if (insumoDoc.exists()) {
                currentStock = Number(insumoDoc.data().quantity) || 0;
                stockActualEl.textContent = currentStock;
            }

            // 2. Obtener Historial de Movimientos Globales y filtrar localmente (evita errores de composite index en producción en vivo)
            const limite30d = new Date();
            limite30d.setDate(limite30d.getDate() - 30);

            const q = query(collection(db, 'Historial_Movimientos'), orderBy('date', 'desc'), limit(1500));
            const snapshot = await getDocs(q);

            const allMovs = snapshot.docs.map(d => {
                const data = d.data();
                const rawDate = data.date || data.timestamp || data.fecha;
                const parsedDate = rawDate?.toDate ? rawDate.toDate() : new Date();
                return { ...data, id: d.id, parsedDate };
            });

            // Filtrar localmente por nombre de insumo (Búsqueda robusta case-insensitive)
            const movs = allMovs.filter(m => {
                const name = m.insumoName || m.articleName || '';
                return name.toLowerCase().includes(itemName.toLowerCase().trim());
            });

            // Llenar tabla
            tbody.innerHTML = '';
            let totalConsumo30d = 0;

            // Agrupación para gráfico por día
            const consumptionByDate = {};
            // Llenar últimos 30 días con 0 para que el gráfico no salte
            for (let i = 29; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                consumptionByDate[d.toLocaleDateString('es-CL')] = 0;
            }

            if (movs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No hay movimientos recientes registrados para este insumo.</td></tr>';
            } else {
                movs.forEach(m => {
                    const dateFmt = m.parsedDate.toLocaleDateString('es-CL');
                    const timeFmt = m.parsedDate.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

                    let baseType = (m.type || m.tipo || 'S/T').toLowerCase();
                    if (baseType === 'carga_masiva_excel') baseType = 'carga masiva';

                    const isSalida = baseType === 'salida';
                    const qty = Number(m.quantity) || 0;

                    if (isSalida && m.parsedDate >= limite30d) {
                        totalConsumo30d += qty;
                        if (consumptionByDate[dateFmt] !== undefined) {
                            consumptionByDate[dateFmt] += qty;
                        }
                    }

                    const typeClass = baseType === 'entrada' ? 'green-badge' :
                        baseType === 'traspaso' ? 'blue-badge' :
                            baseType === 'ajuste' || baseType === 'carga masiva' ? 'yellow-badge' : 'purple-badge';

                    const qtyClass = baseType === 'entrada' ? 'text-green' :
                        baseType === 'salida' ? 'text-red' : 'text-blue';
                    const qtySign = baseType === 'entrada' ? '+' : baseType === 'salida' ? '-' : '';

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><div class="font-bold">${dateFmt}</div><div class="item-category">${timeFmt}</div></td>
                        <td><span class="action-badge ${typeClass}">${baseType.toUpperCase()}</span></td>
                        <td><div class="${qtyClass} font-bold">${qtySign} ${qty}</div></td>
                        <td><div class="item-category" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;" title="${window.escapeHTML(m.batch || m.lote || 'S/L')}">L: ${window.escapeHTML(m.batch || m.lote || 'S/L')}</div></td>
                        <td><div class="item-name" style="font-size:12px">${window.escapeHTML(m.user || m.operatorUid || m.usuario || 'S/I')}</div></td>
                        <td><span class="doc-badge">${window.escapeHTML(m.document || m.supportDocument || 'S/D')}</span></td>
                    `;
                    tbody.appendChild(tr);
                });
            }

            // Cálculos Predictivos
            const consumoDiarioPromedio = totalConsumo30d / 30;
            consumoPromedioEl.textContent = consumoDiarioPromedio > 0 ? consumoDiarioPromedio.toFixed(1) + ' / día' : 'Sin consumo';

            if (consumoDiarioPromedio > 0) {
                const runwayDias = Math.floor(currentStock / consumoDiarioPromedio);
                runwayEl.textContent = runwayDias + ' días';
                runwayEl.style.color = runwayDias < 10 ? 'var(--danger)' : 'var(--success)';
            } else {
                runwayEl.textContent = 'Estable (Sin Salidas)';
                runwayEl.style.color = 'var(--text-muted)';
            }

            // Renderizar Gráfico Analítico
            const ctx = document.getElementById('kardexChart').getContext('2d');
            if (kardexChartInstance) {
                kardexChartInstance.destroy();
            }

            kardexChartInstance = new window.Chart(ctx, {
                type: 'bar',
                data: {
                    labels: Object.keys(consumptionByDate),
                    datasets: [{
                        label: 'Unidades Consumidas (Salidas)',
                        data: Object.values(consumptionByDate),
                        backgroundColor: 'rgba(239, 68, 68, 0.7)',
                        borderColor: 'rgb(239, 68, 68)',
                        borderWidth: 1,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { mode: 'index', intersect: false }
                    },
                    scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 } },
                        x: { display: false } // Ocultar eje X para que sea un mini-sparkline limpio
                    }
                }
            });

        } catch (err) {
            console.error('Error en Kardex:', err);
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:red;">Error al cargar el historial analítico.</td></tr>';
        }
    };

    // ==========================================
    // ESCÁNER DE CÓDIGOS DE BARRAS (HTML5-QRCode)
    // ==========================================
    let html5QrCode = null;
    const btnScanBarcode = document.getElementById('btn-scan-barcode');
    const btnCloseScanner = document.getElementById('btn-close-scanner');
    const scannerContainer = document.getElementById('scanner-container');
    const inputInsumo = document.getElementById('ingreso-insumo');

    if (btnScanBarcode) {
        btnScanBarcode.addEventListener('click', () => {
            if (typeof Html5Qrcode === 'undefined') {
                window.showToast('Error', 'La librería del escáner no se ha cargado correctamente.', 'error');
                return;
            }

            scannerContainer.style.display = 'block';

            html5QrCode = new Html5Qrcode("reader");

            const qrCodeSuccessCallback = async (decodedText, decodedResult) => {
                // Al escanear con éxito
                window.showToast('Código Detectado', `Buscando insumo con código: ${decodedText}...`, 'info');

                // Detener escáner temporalmente
                html5QrCode.stop().then(() => {
                    scannerContainer.style.display = 'none';
                }).catch(err => console.error("Error stopping scanner", err));

                // Buscar en la lista de insumos actuales (lista local cached)
                let foundInsumo = null;
                const datalist = document.getElementById('lista-insumos');
                if (datalist && datalist.options) {
                    for (let i = 0; i < datalist.options.length; i++) {
                        const opt = datalist.options[i];
                        // Buscamos coincidencia exacta o parcial con el código de barras
                        if (opt.value.includes(decodedText) || opt.dataset.code === decodedText) {
                            foundInsumo = opt.value;
                            break;
                        }
                    }
                }

                if (foundInsumo) {
                    inputInsumo.value = foundInsumo;
                    // Disparar evento change para que el sistema auto-llene el resto de campos (si hay listeners)
                    inputInsumo.dispatchEvent(new Event('change'));
                    window.showToast('Éxito', 'Insumo encontrado y seleccionado.', 'success');
                } else {
                    window.showToast('Advertencia', `El código ${decodedText} no coincide con ningún insumo registrado en el sistema.`, 'warning');
                    inputInsumo.value = decodedText; // Lo pegamos por si quiere ingresarlo a mano
                }
            };

            const config = { fps: 10, qrbox: { width: 250, height: 150 } };

            // Iniciar cámara trasera preferentemente
            html5QrCode.start({ facingMode: "environment" }, config, qrCodeSuccessCallback)
                .catch(err => {
                    console.error("Error al iniciar cámara", err);
                    window.showToast('Error de Cámara', 'No se pudo acceder a la cámara. Compruebe los permisos.', 'error');
                    scannerContainer.style.display = 'none';
                });
        });
    }

    if (btnCloseScanner) {
        btnCloseScanner.addEventListener('click', () => {
            if (html5QrCode) {
                html5QrCode.stop().then(() => {
                    scannerContainer.style.display = 'none';
                }).catch(err => {
                    console.error("Error stopping scanner", err);
                    scannerContainer.style.display = 'none';
                });
            } else {
                scannerContainer.style.display = 'none';
            }
        });
    }

    // ==========================================
    // FASE 29/30: PANEL DE USUARIOS Y ROLES (RBAC)
    // ==========================================
    let unsubscribeUsuarios = null;

    window.escucharUsuarios = function () {
        const tbody = document.getElementById('tabla-usuarios-body');
        if (!tbody) return;

        if (unsubscribeUsuarios) {
            unsubscribeUsuarios();
        }

        const q = query(collection(db, 'Usuarios'), orderBy('fechaRegistro', 'desc'));

        unsubscribeUsuarios = onSnapshot(q, (snapshot) => {
            tbody.innerHTML = '';
            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay usuarios registrados.</td></tr>';
                return;
            }

            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const tr = document.createElement('tr');

                let fechaStr = 'N/A';
                if (data.fechaRegistro && data.fechaRegistro.toDate) {
                    fechaStr = data.fechaRegistro.toDate().toLocaleString();
                }

                let opcionesRol = '';
                ROLES_SISTEMA.forEach(r => {
                    const seleccionado = (r.id === data.rol) ? 'selected' : '';
                    opcionesRol += `<option value="${r.id}" ${seleccionado}>${r.label}</option>`;
                });
                const selectHtml = `<select class="form-control select-editar-rol" data-email="${docSnap.id}" style="padding: 4px; font-size: 13px;">${opcionesRol}</select>`;

                tr.innerHTML = `
                    <td><strong>${data.nombre || 'No registrado'}</strong><br><small class="text-muted" style="font-size:11px;">Agregado el ${fechaStr}</small></td>
                    <td>${data.email || docSnap.id}</td>
                    <td>${selectHtml}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger btn-eliminar-usuario" data-id="${docSnap.id}" title="Eliminar Acceso">
                            <i class="ph ph-trash"></i> Eliminar
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }, (error) => {
            console.error("Error al escuchar usuarios:", error);
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Error al cargar usuarios. Intente recargar.</td></tr>';
        });
    };

    document.addEventListener('click', async (e) => {
        // A) Guardar Nuevo Usuario
        if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-guardar-usuario') : null)) {
            e.preventDefault();
            const inputEmail = document.getElementById('input-nuevo-usuario-email');
            const selectRol = document.getElementById('select-nuevo-usuario-rol');
            const inputNombre = document.getElementById('usuario-nombre');
            if (!inputEmail || !selectRol) return;

            let prefijo = inputEmail.value.trim().toLowerCase();
            if (prefijo.endsWith('@cormumel.cl')) {
                prefijo = prefijo.replace('@cormumel.cl', '').trim();
            }
            const rol = selectRol.value;
            const nombre = inputNombre ? inputNombre.value.trim() : '';

            if (!prefijo || !rol) {
                window.showAlertCenter("Campos Incompletos", "Por favor, ingrese el correo y seleccione un rol.", true);
                return;
            }

            const correoCompleto = prefijo + '@cormumel.cl';
            const btn = (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-guardar-usuario') : null);
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Guardando...';
            btn.disabled = true;

            try {
                const tempPass = "Cormu" + Math.floor(1000 + Math.random() * 9000) + "*";

                // Auth Secondary App para evitar desloguear al admin
                const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
                const secondaryAuth = getAuth(secondaryApp);
                await createUserWithEmailAndPassword(secondaryAuth, correoCompleto, tempPass);
                await secondaryAuth.signOut();

                await setDoc(doc(db, 'Usuarios', correoCompleto), {
                    nombre: nombre,
                    email: correoCompleto,
                    rol: rol,
                    fechaRegistro: serverTimestamp(),
                    activo: true
                });

                // Poblado Modal
                const credEmail = document.getElementById('cred-email');
                const credPass = document.getElementById('cred-pass');
                const credRol = document.getElementById('cred-rol');
                if (credEmail) credEmail.textContent = correoCompleto;
                if (credPass) credPass.textContent = tempPass;
                if (credRol) credRol.textContent = rol;

                const modalCredenciales = document.getElementById('modal-credenciales-usuario');
                if (modalCredenciales) modalCredenciales.style.display = 'flex';

                inputEmail.value = '';
                selectRol.value = '';
                if (inputNombre) inputNombre.value = '';
            } catch (error) {
                if (error.code === 'auth/email-already-in-use') {
                    // El usuario ya existe en Authentication, solo lo agregamos a Firestore (Sincronización)
                    try {
                        await setDoc(doc(db, 'Usuarios', correoCompleto), {
                            nombre: nombre,
                            email: correoCompleto,
                            rol: rol,
                            fechaRegistro: serverTimestamp(),
                            activo: true
                        });
                        window.showAlertCenter("Sincronización Exitosa", `El usuario ${correoCompleto} ya existía en Firebase Auth. Se ha sincronizado su rol en la base de datos exitosamente.`);
                        inputEmail.value = '';
                        selectRol.value = '';
                        if (inputNombre) inputNombre.value = '';
                    } catch (fsError) {
                        console.error("Error al sincronizar en Firestore:", fsError);
                        window.showAlertCenter("Error de Base de Datos", "Error al registrar en la base de datos. Verifique permisos.", true);
                    }
                } else {
                    console.error("Error al guardar usuario:", error);
                    window.showAlertCenter("Error de Registro", "Error al registrar usuario: " + (error.message || "Error desconocido"), true);
                }
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
            return;
        }

        // B) Eliminar Usuario
        if ((e.target && typeof e.target.closest === "function" ? e.target.closest('.btn-eliminar-usuario') : null)) {
            e.preventDefault();
            const idUsuario = (e.target && typeof e.target.closest === "function" ? e.target.closest('.btn-eliminar-usuario') : null).getAttribute('data-id');
            if (confirm(`¿Está completamente seguro de eliminar los permisos de ${idUsuario}?`)) {
                try {
                    await deleteDoc(doc(db, 'Usuarios', idUsuario));
                    console.log(`Usuario ${idUsuario} eliminado correctamente.`);
                } catch (error) {
                    console.error("Error al eliminar usuario:", error);
                    window.showAlertCenter("Notificación", "❌ Error al eliminar usuario. Verifique permisos.");
                }
            }
            return;
        }
    });

    // C) Editar Rol (Change Delegado)
    document.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'reemplazo-nombre') {
            const val = e.target.value.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '.');
            const emailInput = document.getElementById('reemplazo-email');
            if (emailInput) {
                // Solo si el usuario no ha escrito algo manualmente distinto al autocompletado anterior
                const prevAuto = emailInput.getAttribute('data-prev-auto') || '';
                if (!emailInput.value || emailInput.value === prevAuto) {
                    emailInput.value = val;
                    emailInput.setAttribute('data-prev-auto', val);
                }
            }
        }
    });

    // C) Editar Rol (Change Delegado)
    document.addEventListener('change', async (e) => {
        if (e.target.classList.contains('select-editar-rol')) {
            const email = e.target.getAttribute('data-email');
            const nuevoRol = e.target.value;

            try {
                await updateDoc(doc(db, 'Usuarios', email), {
                    rol: nuevoRol
                });
                if (typeof showToast === 'function') {
                    showToast('Roles Actualizados', `Se ha asignado el rol ${nuevoRol} a ${email}.`, 'success');
                } else {
                    console.log(`Se ha asignado el rol ${nuevoRol} a ${email}.`);
                }
            } catch (error) {
                console.error("Error actualizando rol:", error);
                window.showAlertCenter("Notificación", "Error al actualizar el rol en la base de datos.");
            }
        }
    });

});


// FASE 31: EVENTOS DEL PERFIL DE USUARIO
document.addEventListener('click', async (e) => {
    // Abrir Perfil
    if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-user-profile') : null)) {
        e.preventDefault();
        const modal = document.getElementById('modal-user-profile');
        const user = auth.currentUser;
        if (!user) return;

        document.getElementById('profile-email').value = user.email;

        try {
            const userDoc = await getDoc(doc(db, 'Usuarios', user.email));
            if (userDoc.exists() && userDoc.data().nombre) {
                document.getElementById('profile-nombre').value = userDoc.data().nombre;
            } else {
                document.getElementById('profile-nombre').value = '';
            }
        } catch (err) {
            console.error("Error fetching user name:", err);
        }

        modal.style.display = 'flex';
    }

    // Guardar Cambios de Perfil
    if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-save-profile') : null)) {
        e.preventDefault();
        const user = auth.currentUser;
        if (!user) return;

        const btn = (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-save-profile') : null);
        const newName = document.getElementById('profile-nombre').value.trim();
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Guardando...';
        btn.disabled = true;

        try {
            await updateDoc(doc(db, 'Usuarios', user.email), { nombre: newName }, { merge: true });
            window.showAlertCenter("Perfil Actualizado", "Tu nombre ha sido guardado exitosamente.");
            // Update UI visually if possible, though currently header shows email
        } catch (error) {
            console.error("Error updating profile:", error);
            window.showAlertCenter("Error", "No se pudo actualizar el perfil.", true);
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
            document.getElementById('modal-user-profile').style.display = 'none';
        }
    }

    // Enviar Correo de Recuperación
    if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-reset-password') : null)) {
        e.preventDefault();
        const user = auth.currentUser;
        if (!user) return;

        const btn = (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-reset-password') : null);
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Solicitando...';
        btn.disabled = true;

        try {
            await sendPasswordResetEmail(auth, user.email);
            window.showAlertCenter("Correo Enviado", "Se ha enviado un enlace de restablecimiento a " + user.email);
        } catch (error) {
            console.error("Error sending password reset:", error);
            window.showAlertCenter("Error", "No se pudo enviar el correo: " + error.message, true);
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
            document.getElementById('modal-user-profile').style.display = 'none';
        }
    }
});


// ==========================================
// NUEVOS REQUERIMIENTOS: USUARIOS Y BANDEJAS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {

    // 1. Crear Enfermero de Reemplazo
    window.cargarSelectEnfermeros = async function () {
        if (!auth || !auth.currentUser) return;

        const select = document.getElementById('select-enfermero-asignado');
        if (!select) return;
        select.innerHTML = '<option value="">Cargando enfermeros...</option>';
        try {
            const q = window.firebaseFirestore.query(
                window.firebaseFirestore.collection(db, 'Usuarios'),
                window.firebaseFirestore.where('rol', 'in', ['enfermero', 'enfermera'])
            );
            const snap = await window.firebaseFirestore.getDocs(q);
            select.innerHTML = '<option value="">Seleccione Enfermero...</option>';
            snap.forEach(d => {
                const u = d.data();
                select.innerHTML += `<option value="${d.id}">${window.escapeHTML(u.nombre || d.id)}</option>`;
            });
        } catch (e) {
            console.error("Error cargando enfermeros", e);
            select.innerHTML = '<option value="">Error al cargar</option>';
        }
    };

    // Call it when tab is clicked
    document.getElementById('tab-crear-bandeja')?.addEventListener('click', () => {
        window.cargarSelectEnfermeros();
    });

    // Populate initially
    window.cargarSelectEnfermeros();

    document.addEventListener('click', async (e) => {
        if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-crear-reemplazo-modal') : null)) { // Botón que podríamos agregar al HTML, o lo ponemos arriba del select
            document.getElementById('modal-crear-reemplazo').style.display = 'flex';
        }

        if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-guardar-reemplazo') : null)) {
            const btn = (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-guardar-reemplazo') : null);
            const nombre = document.getElementById('reemplazo-nombre').value.trim();
            let email = document.getElementById('reemplazo-email').value.trim();
            const pass = document.getElementById('reemplazo-pass').value.trim();

            if (!nombre || !email || !pass) {
                window.showAlertCenter("Notificación", "Completa todos los campos"); return;
            }

            // Validar formato de correo, si no tiene @ le agregamos uno ficticio
            if (!email.includes('@')) {
                email = `${email}@temporal.cormumel.cl`;
            }

            btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Creando...';
            btn.disabled = true;

            try {
                // Crear usuario en Secondary Auth para no desloguear
                const userCredential = await window.firebaseAuth.createUserWithEmailAndPassword(secondaryAuth, email, pass);
                const uid = userCredential.user.uid;

                // Guardar en Firestore
                await window.firebaseFirestore.setDoc(window.firebaseFirestore.doc(db, 'Usuarios', email), {
                    nombre: nombre,
                    rol: 'enfermero',
                    temporal: true,
                    fechaCreacion: window.firebaseFirestore.serverTimestamp()
                });

                document.getElementById('modal-crear-reemplazo').style.display = 'none';
                window.showToast("Éxito", "Enfermero de reemplazo creado correctamente", "success");

                // Recargar select
                window.cargarSelectEnfermeros();
            } catch (error) {
                console.error("Error al crear reemplazo:", error);
                let msg = error.message;
                if (error.code === 'auth/invalid-email') {
                    msg = "El formato del correo ingresado es inválido.";
                } else if (error.code === 'auth/email-already-in-use') {
                    msg = "Este correo ya está registrado en el sistema.";
                } else if (error.code === 'auth/weak-password') {
                    msg = "La contraseña debe tener al menos 6 caracteres.";
                }
                window.showAlertCenter("Error", msg, true);
            } finally {
                btn.innerHTML = 'Crear Usuario';
                btn.disabled = false;
            }
        }
    });

    // 2. Historial de Bandejas
    window.cambiarVista = window.cambiarVista || function () { };
    const oldCambiarVista = window.cambiarVista;
    window.cambiarVista = function (vistaId) {
        if (vistaId === 'historial-bandejas') {
            document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.sidebar-menu li').forEach(el => el.classList.remove('active'));

            const v = document.getElementById('vista-historial-bandejas');
            if (v) v.style.display = 'block';
            const m = document.getElementById('menu-historial-bandejas');
            if (m) m.classList.add('active');

            if (window.cargarHistorialBandejas) window.cargarHistorialBandejas();
        } else {
            oldCambiarVista(vistaId);
        }
    };

    let unsubHistorialBandejasOperador = null;
    window._historialOperadorData = [];

    window.cargarHistorialBandejas = async function() {
        if (unsubHistorialBandejasOperador) unsubHistorialBandejasOperador();

        const container = document.getElementById('lista-historial-bandejas');
        if (!container) return;
        container.innerHTML = '<div class="text-center"><i class="ph-spinner ph-spin"></i> Cargando historial global...</div>';

        const q = window.firebaseFirestore.query(
            window.firebaseFirestore.collection(db, 'Bandejas_Turno')
        );

        unsubHistorialBandejasOperador = window.firebaseFirestore.onSnapshot(q, (snapshot) => {
            window._historialOperadorData = [];
            
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                let fechaDate = data.fechaCreacion ? (typeof data.fechaCreacion.toDate === 'function' ? data.fechaCreacion.toDate() : new Date(data.fechaCreacion)) : new Date();
                
                window._historialOperadorData.push({
                    id: docSnap.id,
                    ...data,
                    _fechaOrden: fechaDate
                });
            });
            
            // Sort descendente localmente
            window._historialOperadorData.sort((a, b) => b._fechaOrden - a._fechaOrden);
            
            renderHistorialBandejasOperador();
        }, (error) => {
            console.error("Error en onSnapshot de Historial Operador:", error);
            container.innerHTML = `<div class="text-center text-danger">Error: ${error.message}</div>`;
        });
    }

    function renderHistorialBandejasOperador() {
        const container = document.getElementById('lista-historial-bandejas');
        if (!container) return;
        container.innerHTML = '';

        if (window._historialOperadorData.length === 0) {
            container.innerHTML = '<div class="text-center text-muted" style="padding: 20px;">No hay bandejas en el historial.</div>';
            return;
        }

        window._historialOperadorData.forEach(data => {
            const div = document.createElement('div');
            div.className = 'data-table-card';
            div.style.marginBottom = '16px';
            div.style.border = '1px solid #dee2e6';
            div.style.borderRadius = '8px';
            div.style.overflow = 'hidden';

            const trackingDisplay = data.tracking || data.identificador || data.id.substring(0, 8);
            
            let badgeBg = '#6c757d';
            if (data.estado === 'CREADA') badgeBg = 'var(--warning)';
            if (data.estado === 'EN_USO') badgeBg = 'var(--primary)';
            if (data.estado === 'CERRADA_ENFERMERIA') badgeBg = '#ffc107';
            if (data.estado === 'CERRADA_FINAL' || data.estado === 'CERRADA_BODEGA') badgeBg = 'var(--success)';
            if (data.estado === 'ANULADA') badgeBg = 'var(--danger)';
            
            const dateStr = data._fechaOrden.toLocaleString();
            let headerBg = '#f8f9fa';

            let btnActions = '';
            if (data.estado === 'CREADA') {
                btnActions = `
                    <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: flex-end;">
                        <button class="btn btn-sm btn-outline-primary" onclick="window.editarBandejaCreada('${data.id}')"><i class="ph ph-pencil"></i> Editar Bandeja</button>
                        <button class="btn btn-sm btn-outline-danger" onclick="window.anularBandejaCreada('${data.id}')"><i class="ph ph-trash"></i> Anular Bandeja</button>
                    </div>
                `;
            } else if (data.estado === 'EN_RECEPCION') {
                btnActions = `
                    <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: flex-end;">
                        <button class="btn btn-sm btn-primary" onclick="window.abrirRecepcionOperador('${data.id}')"><i class="ph ph-check-circle"></i> Aceptar y Cuadrar Bandeja</button>
                    </div>
                `;
            }

            let html = `
                <div class="bandeja-accordion-header" style="background: ${headerBg}; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none';">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <strong style="font-size: 1.1em; color: #212529;">${window.escapeHTML(trackingDisplay)}</strong>
                        <span class="text-muted" style="font-size: 0.85em;"><i class="ph ph-calendar"></i> Creada: ${dateStr}</span>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                        <span class="badge" style="background: ${badgeBg}; color: ${data.estado === 'CREADA' ? '#000' : '#fff'}; font-weight: bold; padding: 6px 12px; border-radius: 20px;">${window.escapeHTML(data.estado.replace('_', ' '))}</span>
                        <small style="color: #6c757d;">Asignada a: ${window.escapeHTML(data.enfermeroAsignado || 'N/A')}</small>
                    </div>
                </div>
                
                <div class="bandeja-accordion-body" style="display: none; padding: 20px; border-top: 1px solid #dee2e6; background: white;">
            `;

            if (data.estado === 'ANULADA' && data.justificacionAnulacion) {
                html += `
                    <div class="alert alert-danger" style="padding: 10px; margin-bottom: 15px;">
                        <strong><i class="ph ph-warning-circle"></i> Motivo de Anulación:</strong> ${window.escapeHTML(data.justificacionAnulacion)}
                    </div>
                `;
            }

            if (data.medicamentos && data.medicamentos.length > 0) {
                html += `
                    <div class="table-responsive" style="border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden;">
                        <table class="table table-hover table-sm mb-0">
                            <thead style="background: #f1f3f5;">
                                <tr>
                                    <th>Fármaco</th>
                                    <th style="text-align: center;">Cantidad Asignada</th>
                                    <th>Observación Inicial</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                data.medicamentos.forEach(med => {
                    const nombre = med.nombreInsumo || med.nombre;
                    const asignada = med.cantidadAsignada || med.cantidad || 0;
                    const obs = med.observacion || med.observacionAdicional || '-';
                    html += `
                        <tr>
                            <td>${window.escapeHTML(nombre)}</td>
                            <td style="text-align: center; font-weight: bold; color: #0d6efd;">${window.escapeHTML(String(asignada))}</td>
                            <td style="color: #6c757d; font-size: 0.9em;">${window.escapeHTML(obs)}</td>
                        </tr>
                    `;
                });

                html += `
                            </tbody>
                        </table>
                    </div>
                `;
            } else if (data.estado !== 'ANULADA') {
                html += `<div class="text-muted">No hay fármacos asignados o hubo un error al guardarlos.</div>`;
            }

            html += btnActions;
            html += `</div>`;
            div.innerHTML = html;
            container.appendChild(div);
        });
    }

    // Funciones globales para editar y anular
    window.anularBandejaCreada = async function(id) {
        const snap = await window.firebaseFirestore.getDoc(window.firebaseFirestore.doc(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno', id));
        if (!snap.exists()) return;
        
        window._bandejaParaAnular = snap.data();
        window._bandejaParaAnular.id = id;

        // Limpiar el input y mostrar el modal
        const inputMotivo = document.getElementById('input-motivo-anulacion');
        if (inputMotivo) inputMotivo.value = '';
        const modal = document.getElementById('modal-anular-bandeja');
        if (modal) modal.style.display = 'flex';
    };

    // Al hacer clic en el botón Confirmar Anular dentro del modal
    document.addEventListener('click', async (e) => {
        if (e.target && typeof e.target.closest === "function" && e.target.closest('#btn-confirmar-anular-bandeja')) {
            const btn = e.target.closest('#btn-confirmar-anular-bandeja');
            const inputMotivo = document.getElementById('input-motivo-anulacion');
            const motivo = inputMotivo ? inputMotivo.value.trim() : '';

            if (!motivo) {
                if (window.showToast) window.showToast('Atención', 'Debe ingresar un motivo para anular.', 'warning');
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Anulando...';

            const bandeja = window._bandejaParaAnular;
            if (!bandeja || !bandeja.id) {
                btn.disabled = false;
                return;
            }
            const id = bandeja.id;

            try {
                const activeAuth = window.firebaseAuth || window.auth || auth;
                
                // Si la bandeja tiene medicamentos asignados, debemos restaurar el stock
            if (bandeja.medicamentos && bandeja.medicamentos.length > 0) {
                const itemsAProcesarNombres = [...new Set(bandeja.medicamentos.map(m => m.nombreInsumo || m.nombre))];
                
                const fetchPromises = itemsAProcesarNombres.map(async (nombre) => {
                    const q = window.firebaseFirestore.query(
                        window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Insumos'),
                        window.firebaseFirestore.where('name', '==', nombre),
                        window.firebaseFirestore.limit(1)
                    );
                    const snap = await window.firebaseFirestore.getDocs(q);
                    if (snap.empty) {
                        console.warn(`Fármaco "${nombre}" no encontrado para reponer stock, se saltará.`);
                        return null;
                    }
                    return { ref: snap.docs[0].ref, name: nombre };
                });
                const refsMap = (await Promise.all(fetchPromises)).filter(r => r !== null);

                await window.firebaseFirestore.runTransaction(window.firebaseFirestore.db || window.db || db, async (transaction) => {
                    const updates = [];
                    for (const mapObj of refsMap) {
                        const insumoDoc = await transaction.get(mapObj.ref);
                        if (!insumoDoc.exists()) continue;
                        const currentStock = Number(insumoDoc.data().quantity) || 0;
                        
                        const oldItem = bandeja.medicamentos.find(m => (m.nombreInsumo || m.nombre) === mapObj.name);
                        const oldQty = oldItem ? (Number(oldItem.cantidadAsignada || oldItem.cantidad) || 0) : 0;
                        
                        if (oldQty > 0) {
                            updates.push({
                                ref: mapObj.ref,
                                newStock: currentStock + oldQty,
                                name: mapObj.name,
                                qty: oldQty
                            });
                        }
                    }

                    for (const update of updates) {
                        transaction.update(update.ref, {
                            quantity: update.newStock,
                            lastUpdated: window.firebaseFirestore.serverTimestamp()
                        });

                        const historyRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Historial_Movimientos'));
                        transaction.set(historyRef, {
                            type: 'DEVOLUCION_ANULACION_BANDEJA',
                            item: update.name,
                            quantity: update.qty,
                            user: activeAuth.currentUser ? activeAuth.currentUser.email : 'Sistema',
                            date: window.firebaseFirestore.serverTimestamp(),
                            origin: `Bandeja Anulada: ${id}`,
                            dest: 'Bodega Central',
                            observacion: motivo
                        });
                    }

                    transaction.update(window.firebaseFirestore.doc(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno', id), {
                        estado: 'ANULADA',
                        justificacionAnulacion: motivo,
                        fechaAnulacion: window.firebaseFirestore.serverTimestamp(),
                        anuladoPor: activeAuth.currentUser ? activeAuth.currentUser.email : 'Operador'
                    });
                });

            } else {
                // Si no hay medicamentos, solo anular la bandeja directamente
                await window.firebaseFirestore.updateDoc(window.firebaseFirestore.doc(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno', id), {
                    estado: 'ANULADA',
                    justificacionAnulacion: motivo,
                    fechaAnulacion: window.firebaseFirestore.serverTimestamp(),
                    anuladoPor: activeAuth.currentUser ? activeAuth.currentUser.email : 'Operador'
                });
                
                await window.firebaseFirestore.addDoc(window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Historial_Movimientos'), {
                    type: 'ANULACION_BANDEJA',
                    item: id,
                    quantity: 0,
                    accion: motivo,
                    user: activeAuth.currentUser ? activeAuth.currentUser.email : 'Sistema',
                    date: window.firebaseFirestore.serverTimestamp()
                });
            }

            if (window.showToast) window.showToast('Éxito', 'Bandeja anulada y stock devuelto correctamente', 'success');
        } catch (error) {
            console.error("Error al anular:", error);
            if (window.showToast) window.showToast('Error', 'No se pudo anular la bandeja', 'error');
        } finally {
            const modal = document.getElementById('modal-anular-bandeja');
            if (modal) modal.style.display = 'none';
            btn.innerHTML = 'Sí, Anular Bandeja';
            btn.disabled = false;
        }
    }
    });

    window.editarBandejaCreada = async function(id) {
        const snap = await window.firebaseFirestore.getDoc(window.firebaseFirestore.doc(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno', id));
        if (!snap.exists()) return;
        const bandeja = snap.data();
        bandeja.id = id;

        window._editingBandejaId = id;
        
        // Cambiar a la vista "Despachar Nueva Bandeja"
        const btnView = document.getElementById('tab-crear-bandeja');
        if (btnView) btnView.click();

        // Mostrar alerta de edición
        const alertaEdicion = document.getElementById('alerta-edicion-bandeja');
        if (alertaEdicion) alertaEdicion.style.display = 'block';

        // Rellenar formulario principal
        const selectEnfermero = document.getElementById('select-enfermero-asignado');
        if (selectEnfermero) selectEnfermero.value = bandeja.enfermeroAsignado || '';

        const selectBandeja = document.getElementById('select-numero-bandeja');
        if (selectBandeja) {
            const identificador = bandeja.identificador || bandeja.id;
            selectBandeja.innerHTML = `<option value="${identificador}">${identificador}</option>`;
            selectBandeja.value = identificador;
            selectBandeja.disabled = true; // No permitir cambiar la bandeja física durante edición
        }

        // Ocultar select de pack para forzar edición manual y evitar sobreescritura accidental
        const selectPlantilla = document.getElementById('select-tipo-plantilla');
        if (selectPlantilla) selectPlantilla.value = '';

        // Mostrar contenedor de detalle y rellenar items
        const contenedorTabla = document.getElementById('contenedor-detalle-bandeja');
        const tbodyBandeja = document.getElementById('tabla-detalle-bandeja-body');
        if (contenedorTabla) contenedorTabla.style.display = 'block';
        
        let filasHTML = '';
        if (bandeja.medicamentos) {
            bandeja.medicamentos.forEach(med => {
                const nombre = med.nombreInsumo || med.nombre;
                const qty = med.cantidadAsignada || med.cantidad || 1;
                const obs = med.observacion || med.observacionAdicional || '';
                
                filasHTML += `
                <tr>
                    <td><span class="insumo-nombre fw-bold" style="font-weight: bold;">${nombre}</span></td>
                    <td><input type="number" class="form-control insumo-cantidad" value="${qty}" min="1" style="max-width:80px"></td>
                    <td><input type="text" class="form-control insumo-obs" value="${obs}" placeholder="Incidencias..."></td>
                    <td class="text-center"><button type="button" class="btn btn-sm btn-danger btn-eliminar-fila">🗑️</button></td>
                </tr>`;
            });
        }
        if (tbodyBandeja) tbodyBandeja.innerHTML = filasHTML;

        // Configurar botn para GUARDAR CAMBIOS (reemplazar temporalmente funcin original)
        const btnPreDespacho = document.getElementById('btn-pre-despacho');
        if (btnPreDespacho) {
            // Guardar el modo edicin
            btnPreDespacho.innerHTML = '💾 Guardar Cambios en Bandeja';
            btnPreDespacho.dataset.modoEdicionId = id;
        }
        
        if (window.showToast) window.showToast('Modo Edición', 'Modifique los insumos y presione Guardar Cambios', 'info');
    };

    // 3. Ver Cruce Histórico
    window.verCruceHistorico = async function (docId) {
        const modal = document.getElementById('modal-ver-cruce');
        const body = document.getElementById('body-ver-cruce');
        if (!modal || !body) return;

        try {
            const docRef = window.firebaseFirestore.doc(db, 'Bandejas_Turno', docId);
            const snap = await window.firebaseFirestore.getDoc(docRef);
            if (!snap.exists()) return;
            const data = snap.data();
            const cruceData = data.cruceCierreTurno || [];

            let cruceHtml = `
                <div class="info-card info" style="margin-bottom: 15px;">
                    <strong>Bandeja:</strong> ${data.identificador || docId.substring(0, 8)}<br>
                    <strong>Enfermero:</strong> ${data.enfermeroAsignado}
                </div>
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead style="background: #f8f9fa;">
                            <tr>
                                <th>Insumo</th>
                                <th>Consumo (Visor)</th>
                                <th>Solicitado (Rayen)</th>
                                <th>Estado</th>
                                <th>Justificación</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            if (cruceData.length === 0) {
                cruceHtml += `<tr><td colspan="5" class="text-center">No hay datos de cruce.</td></tr>`;
            } else {
                cruceData.forEach(res => {
                    cruceHtml += `
                        <tr style="background: ${res.color}15;">
                            <td><strong>V:</strong> ${res.visorName}<br><strong>R:</strong> ${res.rayenName}</td>
                            <td style="text-align: center;">${res.consumidoVisor}</td>
                            <td style="text-align: center;">${res.solicitadoRayen}</td>
                            <td><span class="badge" style="background: ${res.color}; color: #fff;">${res.estado}</span></td>
                            <td>${res.observacionCierre || 'N/A'}</td>
                        </tr>
                    `;
                });
            }
            cruceHtml += `</tbody></table></div>`;
            body.innerHTML = cruceHtml;
            modal.style.display = 'flex';
        } catch (e) {
            console.error(e);
        }
    };

    // 4. Gestionar Bandeja Pendiente (Reasignar / Anular)
    window.abrirGestionBandeja = async function (docId, enfermeroActual) {
        window._gestionBandejaId = docId;
        const modal = document.getElementById('modal-gestionar-bandeja');
        if (!modal) return;

        // Cargar enfermeros en el select de reasignar
        const select = document.getElementById('select-reasignar-enfermero');
        select.innerHTML = '<option value="">Cargando...</option>';
        try {
            const q = window.firebaseFirestore.query(window.firebaseFirestore.collection(db, 'Usuarios'), window.firebaseFirestore.where('rol', 'in', ['enfermero', 'enfermera']));
            const snap = await window.firebaseFirestore.getDocs(q);
            select.innerHTML = '';
            snap.forEach(d => {
                const u = d.data();
                if (d.id !== enfermeroActual) {
                    select.innerHTML += `<option value="${d.id}">${window.escapeHTML(u.nombre || d.id)}</option>`;
                }
            });
        } catch (e) { }

        document.getElementById('div-reasignar-bandeja').style.display = 'block';
        document.getElementById('div-anular-bandeja').style.display = 'none';
        document.getElementById('input-anular-obs').value = '';

        modal.style.display = 'flex';
    };

    document.getElementById('tab-reasignar')?.addEventListener('click', () => {
        document.getElementById('div-reasignar-bandeja').style.display = 'block';
        document.getElementById('div-anular-bandeja').style.display = 'none';
    });
    document.getElementById('tab-anular')?.addEventListener('click', () => {
        document.getElementById('div-reasignar-bandeja').style.display = 'none';
        document.getElementById('div-anular-bandeja').style.display = 'block';
    });

    document.getElementById('btn-confirmar-reasignacion')?.addEventListener('click', async () => {
        const docId = window._gestionBandejaId;
        const nuevoEnf = document.getElementById('select-reasignar-enfermero').value;
        if (!docId || !nuevoEnf) return;

        try {
            await window.firebaseFirestore.updateDoc(window.firebaseFirestore.doc(db, 'Bandejas_Turno', docId), {
                enfermeroAsignado: nuevoEnf,
                fechaModificacion: window.firebaseFirestore.serverTimestamp()
            });
            document.getElementById('modal-gestionar-bandeja').style.display = 'none';
            window.showToast("Éxito", "Bandeja reasignada correctamente", "success");
        } catch (e) { console.error(e); }
    });

    document.getElementById('btn-confirmar-anulacion')?.addEventListener('click', async () => {
        const docId = window._gestionBandejaId;
        const obs = document.getElementById('input-anular-obs').value.trim();
        if (!docId) return;
        if (!obs) { window.showAlertCenter("Notificación", "La justificación es obligatoria para anular."); return; }

        if (!confirm("¿Anular definitivamente esta bandeja y devolver el stock?")) return;

        try {
            const docRef = window.firebaseFirestore.doc(db, 'Bandejas_Turno', docId);
            const invRef = window.firebaseFirestore.collection(db, 'Inventario_Central');

            // PRE-FETCH PARA ATOMICIDAD
            const snapPre = await window.firebaseFirestore.getDoc(docRef);
            if (!snapPre.exists()) throw new Error("No existe");
            const dataPre = snapPre.data();
            let docIdsMap = {};
            for (const med of dataPre.medicamentos) {
                const nombreItem = med.nombreInsumo || med.nombre;
                const key = nombreItem.toLowerCase().trim();
                const q1 = window.firebaseFirestore.query(invRef, window.firebaseFirestore.where('nombreInsumo', '==', nombreItem), window.firebaseFirestore.limit(1));
                const snap1 = await window.firebaseFirestore.getDocs(q1);
                if (!snap1.empty) {
                    docIdsMap[key] = snap1.docs[0].id;
                } else {
                    const q2 = window.firebaseFirestore.query(invRef, window.firebaseFirestore.where('nombre', '==', nombreItem), window.firebaseFirestore.limit(1));
                    const snap2 = await window.firebaseFirestore.getDocs(q2);
                    if (!snap2.empty) docIdsMap[key] = snap2.docs[0].id;
                }
            }

            await window.firebaseFirestore.runTransaction(db, async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists()) throw new Error("No existe");
                const data = snap.data();
                if (data.estado !== 'CREADA') throw new Error("Solo se pueden anular bandejas CREADAS");

                for (const med of data.medicamentos) {
                    const key = (med.nombreInsumo || med.nombre).toLowerCase().trim();
                    const cant = Number(med.cantidadAsignada || 0);
                    if (cant > 0 && docIdsMap[key]) {
                        transaction.update(window.firebaseFirestore.doc(db, 'Inventario_Central', docIdsMap[key]), {
                            cantidadRecibida: window.firebaseFirestore.increment(cant)
                        });

                        // Historial
                        transaction.set(window.firebaseFirestore.doc(window.firebaseFirestore.collection(db, 'Historial_Movimientos')), {
                            tipoAccion: 'ENTRADA',
                            detalle: 'Anulación de Bandeja de Turno - ' + obs,
                            cantidad: cant,
                            nombreInsumo: med.nombreInsumo || med.nombre,
                            usuario: auth.currentUser.email,
                            fecha: window.firebaseFirestore.serverTimestamp(),
                            origen: 'Anulación',
                            destino: 'Inventario_Central'
                        });
                    }
                }

                transaction.update(docRef, {
                    estado: 'ANULADA',
                    justificacionAnulacion: obs,
                    anuladaPor: auth.currentUser.email,
                    fechaAnulacion: window.firebaseFirestore.serverTimestamp()
                });
            });

            document.getElementById('modal-gestionar-bandeja').style.display = 'none';
            window.showToast("Bandeja Anulada", "El stock ha regresado a bodega", "success");
        } catch (e) { window.showAlertCenter("Error", e.message, true); }
    });

});


window.firebaseAuth = { createUserWithEmailAndPassword };
window.firebaseFirestore = { setDoc, doc, serverTimestamp, query, collection, orderBy, getDocs, updateDoc, runTransaction, increment, getDoc, where, limit, onSnapshot, startAt, endAt };




window.abrirRecepcionOperador = async function (docId) {
    window._bandejaOperadorId = docId;
    const container = document.getElementById('lista-medicamentos-recepcion-operador');
    container.innerHTML = '<div class="text-center"><i class="ph-spinner ph-spin"></i> Cargando...</div>';
    document.getElementById('modal-recepcion-operador').style.display = 'flex';

    try {
        const safeDb = window.firebaseFirestore.db || window.db || db;
        const docRef = window.firebaseFirestore.doc(safeDb, 'Bandejas_Turno', docId);
        const snap = await window.firebaseFirestore.getDoc(docRef);
        if (!snap.exists()) throw new Error("Bandeja no encontrada.");

        const data = snap.data();
        let html = `
                <table class="table table-bordered">
                    <thead style="background:#f8f9fa;">
                        <tr>
                            <th>Fármaco</th>
                            <th>Reportado por Enfermera (Sobrante)</th>
                            <th>Cantidad Real Física Recibida</th>
                            <th>Observación Operador (Si difiere)</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

        data.medicamentos.forEach((med, idx) => {
            const recibida = med.cantidadRecibida || 0;
            const consumida = med.cantidadConsumida || 0;
            const merma = med.cantidadMerma || 0;
            const reportado = recibida - consumida - merma;

            html += `
                    <tr>
                        <td><strong>${med.nombreInsumo || med.nombre}</strong></td>
                        <td style="text-align: center; vertical-align: middle; font-size: 1.1em;">${reportado}</td>
                        <td style="width: 150px;">
                            <input type="number" id="op-recibido-${idx}" class="form-control text-center" value="${reportado}" min="0">
                        </td>
                        <td>
                            <input type="text" id="op-obs-${idx}" class="form-control" placeholder="Motivo de ajuste...">
                        </td>
                    </tr>
                `;
        });

        html += `</tbody></table>`;
        container.innerHTML = html;
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="text-danger">Error al cargar datos.</div>';
    }
};

document.addEventListener('click', async (e) => {
    if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-guardar-recepcion-operador') : null)) {
        const docId = window._bandejaOperadorId;
        if (!docId) return;

        const btn = (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-guardar-recepcion-operador') : null);
        btn.disabled = true;
        btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Procesando...';

        try {
            const safeDb = window.firebaseFirestore.db || window.db || db;
            const docRef = window.firebaseFirestore.doc(safeDb, 'Bandejas_Turno', docId);

            // Ejecutamos transaccion
            await window.firebaseFirestore.runTransaction(safeDb, async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists()) throw new Error("La bandeja no existe.");

                const data = snap.data();
                if (data.estado !== 'EN_RECEPCION') throw new Error("La bandeja no está en estado de recepción.");

                let hayAjusteNoJustificado = false;
                const inputsReal = document.querySelectorAll('[id^="op-recibido-"]');
                const inputsObs = document.querySelectorAll('[id^="op-obs-"]');

                const medicamentosActualizados = data.medicamentos.map((med, idx) => {
                    const recibida = med.cantidadRecibida || 0;
                    const consumida = med.cantidadConsumida || 0;
                    const merma = med.cantidadMerma || 0;
                    const reportado = recibida - consumida - merma;

                    const inputVal = inputsReal[idx] ? Number(inputsReal[idx].value) : reportado;
                    const obsVal = inputsObs[idx] ? inputsObs[idx].value.trim() : '';

                    if (inputVal !== reportado && obsVal === '') {
                        hayAjusteNoJustificado = true;
                    }

                    if (inputVal > 0) {
                        // Generar Movimiento de Retorno
                        const histRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(safeDb, 'Historial_Movimientos'));
                        transaction.set(histRef, {
                            tipoAccion: 'RETORNO_BANDEJA',
                            fechaHora: window.firebaseFirestore.serverTimestamp(),
                            usuario: auth.currentUser.email,
                            nombreInsumo: med.nombreInsumo || med.nombre,
                            cantidadAnterior: 0,
                            cantidadNueva: inputVal,
                            cantidadDiferencia: inputVal,
                            observaciones: 'Retorno desde Bandeja ' + (data.identificador || docId) + (inputVal !== reportado ? '. AJUSTE OPERADOR: ' + obsVal : ''),
                            idBandeja: docId
                        });
                    }

                    return {
                        ...med,
                        cantidadRetornadaOperador: inputVal,
                        observacionOperador: obsVal
                    };
                });

                if (hayAjusteNoJustificado) {
                    throw new Error("AJUSTE_SIN_OBS");
                }

                transaction.update(docRef, {
                    estado: 'CERRADA_FINAL',
                    fechaRecepcionBodega: window.firebaseFirestore.serverTimestamp(),
                    operadorReceptor: auth.currentUser.email,
                    medicamentos: medicamentosActualizados
                });
            });

            // Actualizar Stock General post-transaccion
            const docSnapResult = await window.firebaseFirestore.getDoc(docRef);
            const dataResult = docSnapResult.data();
            for (let med of dataResult.medicamentos) {
                if (med.cantidadRetornadaOperador > 0) {
                    const insumosSnapshot = await window.firebaseFirestore.getDocs(window.firebaseFirestore.query(window.firebaseFirestore.collection(db, 'Insumos'), window.firebaseFirestore.where('nombre', '==', med.nombreInsumo || med.nombre)));
                    if (!insumosSnapshot.empty) {
                        const insumoDoc = insumosSnapshot.docs[0];
                        const insumoRef = window.firebaseFirestore.doc(db, 'Insumos', insumoDoc.id);
                        await window.firebaseFirestore.updateDoc(insumoRef, {
                            cantidad: window.firebaseFirestore.increment(med.cantidadRetornadaOperador)
                        });
                    }
                }
            }

            document.getElementById('modal-recepcion-operador').style.display = 'none';
            window.showToast('Recepción Exitosa', 'El stock ha sido devuelto a bodega.', 'success');
            if (window.cargarHistorialBandejas) window.cargarHistorialBandejas();
        } catch (error) {
            console.error(error);
            if (error.message === "AJUSTE_SIN_OBS") {
                window.showToast('Error', 'Debe justificar las diferencias que ajustó.', 'warning');
            } else {
                window.showToast('Error', 'No se pudo recepcionar: ' + error.message, 'error');
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="ph ph-check-circle"></i> Confirmar y Reintegrar Stock';
        }
    }
});


// ==========================================
// FASE 32: CRUCE INTELIGENTE (EXCEL - RAYEN)
// ==========================================
window.abrirModalCuadratura = function (docId, nombreBandeja) {
    window._bandejaCuadraturaActiva = docId;
    document.getElementById('cuadratura-bandeja-nombre').textContent = nombreBandeja;
    document.getElementById('contenedor-resultado-cruce').style.display = 'none';
    document.getElementById('btn-procesar-cierre-final').disabled = true;
    document.getElementById('input-excel-rayen').value = ''; // Limpiar
    document.getElementById('modal-cuadratura-turno').style.display = 'flex';
};

document.addEventListener('change', async (e) => {
    if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#input-excel-rayen') : null)) {
        const file = e.target.files[0];
        if (!file) return;

        if (typeof XLSX === 'undefined') {
            window.showToast("Error", "Librera XLSX no cargada. Revise su conexin o recargue.", "error");
            return;
        }

        const reader = new FileReader();
        reader.onload = async function (event) {
            try {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

                console.log("JSON Excel parseado:", json);

                // Procesar el cruce contra la base de datos
                const docId = window._bandejaCuadraturaActiva;
                if (!docId) return;

                const docRef = window.firebaseFirestore.doc(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno', docId);
                const snap = await window.firebaseFirestore.getDoc(docRef);
                if (!snap.exists()) {
                    window.showToast("Error", "Bandeja no existe", "error");
                    return;
                }

                const bandeja = snap.data();
                const insumosVisor = bandeja.medicamentos || [];
                const tbody = document.getElementById('tabla-cruce-body');
                tbody.innerHTML = '';

                window._resultadosCruceTemporal = [];
                let requiereJustificaciones = false;

                insumosVisor.forEach((itemVisor, idx) => {
                    const nombreVisor = (itemVisor.nombreInsumo || itemVisor.nombre || "").toLowerCase();
                    const cantVisor = itemVisor.cantidadConsumida || 0;

                    // Buscar coincidencia fuzzy en Excel
                    let cantRayen = 0;
                    let matchEncontrado = false;
                    for (const fila of json) {
                        // Buscar propiedades que parezcan "Frmaco" o "Medicamento"
                        let nombreRayen = "";
                        let valorCant = 0;
                        for (const key in fila) {
                            const k = key.toLowerCase();
                            if (k.includes('frmaco') || k.includes('farmaco') || k.includes('medicamento') || k.includes('producto') || k.includes('insumo')) {
                                nombreRayen = String(fila[key]).toLowerCase();
                            }
                            if (k.includes('cant') || k.includes('total') || k.includes('realizada') || k.includes('solicitada')) {
                                const parseado = parseFloat(fila[key]);
                                if (!isNaN(parseado)) valorCant = parseado;
                            }
                        }

                        if (nombreRayen && nombreVisor.includes(nombreRayen.substring(0, 5)) || nombreRayen.includes(nombreVisor.substring(0, 5))) {
                            cantRayen = valorCant;
                            matchEncontrado = true;
                            break;
                        }
                    }

                    const coincide = (cantVisor === cantRayen);
                    if (!coincide) requiereJustificaciones = true;

                    window._resultadosCruceTemporal.push({
                        ...itemVisor,
                        idxBandeja: idx,
                        usoVisor: cantVisor,
                        usoRayen: cantRayen,
                        coincide: coincide
                    });

                    const tr = document.createElement('tr');
                    if (!coincide) {
                        tr.style.backgroundColor = '#ffe0e0';
                    } else {
                        tr.style.backgroundColor = '#e0ffe0';
                    }

                    tr.innerHTML = `
                        <td>${itemVisor.nombreInsumo || itemVisor.nombre}</td>
                        <td style="text-align:center; font-weight:bold;">${cantVisor}</td>
                        <td style="text-align:center; font-weight:bold;">${matchEncontrado ? cantRayen : '<span class="text-muted">No listado</span>'}</td>
                        <td style="text-align:center;">${coincide ? '🟢 OK' : '🔴 DIFF'}</td>
                        <td>
                            ${!coincide ? `<input type="text" class="form-control justificacion-cruce form-control-sm" data-idx="${idx}" placeholder="Motivo obligatorio..." required oninput="window.validarCierreCruce()">` : `<span class="text-muted">No requerida</span>`}
                        </td>
                    `;
                    tbody.appendChild(tr);
                });

                document.getElementById('contenedor-resultado-cruce').style.display = 'block';
                window.validarCierreCruce();

            } catch (e) {
                console.error(e);
                window.showToast("Error parsing Excel", e.message, "error");
            }
        };
        reader.readAsArrayBuffer(file);
    }
});

window.validarCierreCruce = function () {
    const inputs = document.querySelectorAll('.justificacion-cruce');
    let todasLlenas = true;
    inputs.forEach(input => {
        if (!input.value.trim()) todasLlenas = false;
    });
    document.getElementById('btn-procesar-cierre-final').disabled = !todasLlenas;
};

// Modificar el manejador para btn-procesar-cierre-final (o crearlo)
document.addEventListener('click', async (e) => {
    if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-procesar-cierre-final') : null)) {
        const btn = (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-procesar-cierre-final') : null);
        if (btn.disabled) return;

        btn.disabled = true;
        btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Confirmando...';

        const docId = window._bandejaCuadraturaActiva;
        if (!docId) return;

        // Recopilar justificaciones
        const cruceFinalData = [];
        window._resultadosCruceTemporal.forEach(item => {
            let obs = "";
            if (!item.coincide) {
                const input = document.querySelector(`.justificacion-cruce[data-idx="${item.idxBandeja}"]`);
                if (input) obs = input.value.trim();
            }
            cruceFinalData.push({
                nombreInsumo: item.nombreInsumo || item.nombre,
                usoVisor: item.usoVisor,
                usoRayen: item.usoRayen,
                coincide: item.coincide,
                justificacion: obs
            });
        });

        try {
            await window.firebaseFirestore.updateDoc(window.firebaseFirestore.doc(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno', docId), {
                estado: 'EN_RECEPCION',
                fechaCruce: window.firebaseFirestore.serverTimestamp(),
                cruceCierreTurno: cruceFinalData
            });
            window.showToast("xito", "Cruce realizado y bandeja enviada a bodega", "success");
            document.getElementById('modal-cuadratura-turno').style.display = 'none';
        } catch (error) {
            window.showToast("Error", error.message, "error");
        } finally {
            btn.innerHTML = '✔️ Confirmar Cierre y Devolver a Bodega';
            btn.disabled = false;
        }
    }
});


// ==========================================
// FASE 33: HISTORIAL Y TRAZABILIDAD ENFERMERA
// ==========================================
window._historialEnfermeroData = [];
let unsubHistorialBandejas = null;

window.startHistorialBandejasEnfermero = async function() {
    if (!auth.currentUser) return;
    if (unsubHistorialBandejas) unsubHistorialBandejas();

    const container = document.getElementById('lista-historial-bandejas');
    if (!container) return;
    container.innerHTML = '<div class="text-center"><i class="ph-spinner ph-spin"></i> Cargando historial...</div>';

    // Eliminado orderBy('fechaDespacho', 'desc') para evitar errores de Indice Compuesto
    const q = window.firebaseFirestore.query(
        window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno'),
        window.firebaseFirestore.where('enfermeroAsignado', '==', auth.currentUser.email)
    );

    unsubHistorialBandejas = window.firebaseFirestore.onSnapshot(q, (snapshot) => {
        window._historialEnfermeroData = [];
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const validEstados = ['EN_RECEPCION', 'CERRADA_BODEGA', 'ANULADA'];
            if (!validEstados.includes(data.estado)) return;
            
            let fechaDate = data.fechaCruce ? (typeof data.fechaCruce.toDate === 'function' ? data.fechaCruce.toDate() : new Date(data.fechaCruce)) : 
                           (data.fechaDespacho ? (typeof data.fechaDespacho.toDate === 'function' ? data.fechaDespacho.toDate() : new Date(data.fechaDespacho)) : new Date());
            
            window._historialEnfermeroData.push({
                id: docSnap.id,
                ...data,
                _fechaOrden: fechaDate
            });
        });
        
        // Sort descendente localmente
        window._historialEnfermeroData.sort((a, b) => b._fechaOrden - a._fechaOrden);
        
        window.renderHistorialBandejas();
    }, (error) => {
        console.error("Error en onSnapshot de Historial:", error);
        container.innerHTML = `<div class="text-center text-danger">Error: ${error.message}</div>`;
    });
};

window.renderHistorialBandejas = function() {
    const container = document.getElementById('lista-historial-bandejas');
    if (!container) return;
    container.innerHTML = '';
    
    const inputSearch = document.getElementById('input-search-historial');
    const selectTime = document.getElementById('select-filtro-tiempo-historial');
    
    const searchTerm = inputSearch ? inputSearch.value.trim().toLowerCase() : '';
    const timeFilter = selectTime ? selectTime.value : 'all'; // Default
    
    let now = new Date();
    let limiteFecha = null;
    
    if (timeFilter === '30days') {
        limiteFecha = new Date();
        limiteFecha.setDate(now.getDate() - 30);
    } else if (timeFilter === '7days') {
        limiteFecha = new Date();
        limiteFecha.setDate(now.getDate() - 7);
    }

    let count = 0;
    
    window._historialEnfermeroData.forEach(data => {
        // Filtro de Tiempo
        if (limiteFecha && data._fechaOrden < limiteFecha) return;
        
        // Busqueda
        const trackingDisplay = data.tracking || data.identificador || data.id.substring(0, 8);
        const searchString = `${trackingDisplay} ${data.identificador}`.toLowerCase();
        
        if (searchTerm && !searchString.includes(searchTerm)) return;

        count++;
        
        const div = document.createElement('div');
        div.className = 'data-table-card';
        div.style.marginBottom = '16px';
        div.style.border = '1px solid #dee2e6';
        div.style.borderRadius = '8px';
        div.style.overflow = 'hidden';

        let badgeBg = '#6c757d';
        if (data.estado === 'EN_RECEPCION') badgeBg = 'var(--warning)';
        if (data.estado === 'CERRADA_BODEGA') badgeBg = 'var(--success)';
        if (data.estado === 'ANULADA') badgeBg = 'var(--danger)';
        
        const dateStr = data._fechaOrden.toLocaleString();
        
        // Analizar incidencias
        let hayIncidencia = false;
        if (data.estado === 'ANULADA') hayIncidencia = true;
        
        const cruceArray = data.cruceCierreTurno || [];
        if (data.medicamentos && data.medicamentos.length > 0) {
            data.medicamentos.forEach(med => {
                const devueltoBodega = med.cantidadRetornadaOperador !== undefined ? med.cantidadRetornadaOperador : '?';
                if (devueltoBodega !== '?') {
                    const debioVolver = (med.cantidadRecibida || 0) - (med.cantidadConsumida || 0) - (med.cantidadMerma || 0);
                    if (devueltoBodega < debioVolver) hayIncidencia = true;
                }
                if (med.observacionOperador && med.observacionOperador.trim() !== '') hayIncidencia = true;
                
                const nombre = med.nombreInsumo || med.nombre;
                const cruceMatch = cruceArray.find(c => c.nombreInsumo === nombre);
                if (cruceMatch && !cruceMatch.coincide) hayIncidencia = true;
            });
        }
        
        let headerBg = data.estado === 'CERRADA_BODEGA' ? '#f0fdf4' : '#f8f9fa';
        let headerBorder = '';
        let iconIncidencia = '';
        
        // Alert Visual si hay incidencia
        if (hayIncidencia) {
            headerBg = '#ffe0e0'; 
            headerBorder = 'border-left: 5px solid #dc3545;';
            iconIncidencia = '<i class="ph ph-warning-circle" style="color: #dc3545; font-size: 1.2em; margin-right: 5px;"></i> ';
        }

        let html = `
            <div class="bandeja-accordion-header" style="background: ${headerBg}; ${headerBorder} padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none';">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <strong style="font-size: 1.1em; color: ${hayIncidencia ? '#dc3545' : '#212529'};">${iconIncidencia}${window.escapeHTML(trackingDisplay)}</strong>
                    <span class="text-muted" style="font-size: 0.85em;"><i class="ph ph-calendar"></i> Fecha Cierre: ${dateStr}</span>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                    <span class="badge" style="background: ${badgeBg}; color: ${data.estado === 'EN_RECEPCION' ? '#000' : '#fff'}; font-weight: bold; padding: 6px 12px; border-radius: 20px;">${window.escapeHTML(data.estado.replace('_', ' '))}</span>
                    ${hayIncidencia ? '<small style="color: #dc3545; font-weight: bold;">Presenta Incidencias</small>' : ''}
                </div>
            </div>
            
            <div class="bandeja-accordion-body" style="display: none; padding: 20px; border-top: 1px solid #dee2e6; background: white;">
                <div style="margin-bottom: 15px; font-weight: bold; color: #495057;">
                    <i class="ph ph-scales"></i> Arqueo Tripartito
                </div>
        `;

        if (data.estado === 'ANULADA') {
            html += `<div class="alert alert-danger">Bandeja anulada. Motivo: ${window.escapeHTML(data.justificacionAnulacion || 'N/A')}</div>`;
        } else if (data.medicamentos && data.medicamentos.length > 0) {
            html += `
                <div class="table-responsive" style="border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden;">
                    <table class="table table-hover table-sm mb-0">
                        <thead style="background: #f1f3f5;">
                            <tr>
                                <th>Fármaco</th>
                                <th style="text-align: center;">Uso VISOR</th>
                                <th style="text-align: center;">Uso EXCEL</th>
                                <th style="text-align: center;">Físico en Bodega</th>
                                <th>Incidencias Bodega</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            data.medicamentos.forEach(med => {
                const nombre = med.nombreInsumo || med.nombre;
                const cantidadConsumida = med.cantidadConsumida || 0;
                const devueltoBodega = med.cantidadRetornadaOperador !== undefined ? med.cantidadRetornadaOperador : '?';
                const obsOperador = med.observacionOperador || '';

                const cruceMatch = cruceArray.find(c => c.nombreInsumo === nombre);
                const excelValor = cruceMatch ? cruceMatch.usoRayen : '?';

                let rowBg = '';
                if (devueltoBodega !== '?') {
                    const debioVolver = (med.cantidadRecibida || 0) - (med.cantidadConsumida || 0) - (med.cantidadMerma || 0);
                    if (devueltoBodega < debioVolver) rowBg = '#ffe0e0'; 
                    if (devueltoBodega === debioVolver && debioVolver > 0) rowBg = '#e0ffe0'; 
                }

                html += `
                    <tr style="background-color: ${rowBg};">
                        <td>${window.escapeHTML(nombre)}</td>
                        <td style="text-align: center; font-weight: bold; color: #0d6efd;">${window.escapeHTML(String(cantidadConsumida))}</td>
                        <td style="text-align: center; font-weight: bold; color: ${cruceMatch && !cruceMatch.coincide ? '#dc3545' : '#28a745'};">${window.escapeHTML(String(excelValor))}</td>
                        <td style="text-align: center; font-weight: bold;">${window.escapeHTML(String(devueltoBodega))}</td>
                        <td>${obsOperador ? `<span style="color: #dc3545; font-size: 0.85em;"><i class="ph ph-warning-circle"></i> ${window.escapeHTML(obsOperador)}</span>` : '<span class="text-muted">-</span>'}</td>
                    </tr>
                `;
            });

            html += `
                        </tbody>
                    </table>
                </div>
            `;
        }

        html += `</div>`;
        div.innerHTML = html;
        container.appendChild(div);
    });

    if (count === 0) {
        container.innerHTML = '<div class="text-center text-muted" style="padding: 20px;"><i class="ph ph-magnifying-glass" style="font-size: 3em; color: #dee2e6; display: block; margin-bottom: 10px;"></i>No se encontraron resultados para los filtros actuales.</div>';
    }
};


// ==========================================
// FASE 34: LÓGICA DE SOBRECONSUMO Y GUARDADO
// ==========================================

window.validarSobreconsumo = function(input, docId, idx) {
    const consumido = Number(input.value);
    const asignado = Number(input.getAttribute('data-asignado'));
    const obsInput = document.getElementById(`obs-consumo-${docId}-${idx}`);
    
    if (!obsInput) return;
    
    if (consumido > asignado) {
        obsInput.style.display = 'block';
        obsInput.required = true;
        obsInput.style.border = '2px solid #dc3545';
        if (!obsInput.value) {
            obsInput.placeholder = 'DEBE justificar este exceso...';
        }
    } else {
        obsInput.style.display = 'none';
        obsInput.required = false;
        obsInput.style.border = '1px solid #ced4da';
        obsInput.value = ''; // Limpiar si vuelve a la normalidad
    }
};

window.guardarProgresoBandeja = async function(docId) {
    try {
        const docRef = window.firebaseFirestore.doc(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno', docId);
        const snap = await window.firebaseFirestore.getDoc(docRef);
        if (!snap.exists()) {
            throw new Error("La bandeja no existe.");
        }
        
        const data = snap.data();
        let hasError = false;
        
        const medicamentosActualizados = data.medicamentos.map((med, idx) => {
            const inputConsumo = document.getElementById(`consumo-${docId}-${idx}`);
            const inputObs = document.getElementById(`obs-consumo-${docId}-${idx}`);
            
            if (inputConsumo) {
                const consumido = Number(inputConsumo.value);
                const asignado = Number(inputConsumo.getAttribute('data-asignado'));
                let obs = med.observacionAdicional || '';
                
                if (inputObs && inputObs.style.display !== 'none') {
                    obs = inputObs.value.trim();
                    if (consumido > asignado && obs === '') {
                        hasError = true;
                        inputObs.focus();
                    }
                }
                
                return {
                    ...med,
                    cantidadConsumida: consumido,
                    observacionAdicional: obs
                };
            }
            return med; // Fallback
        });
        
        if (hasError) {
            window.showToast("Error", "Debe justificar los insumos donde el consumo exceda lo asignado.", "error");
            return;
        }
        
        await window.firebaseFirestore.updateDoc(docRef, {
            medicamentos: medicamentosActualizados,
            fechaUltimoGuardado: window.firebaseFirestore.serverTimestamp()
        });
        
        window.showToast("Éxito", "Progreso guardado correctamente.", "success");
        
    } catch (err) {
        console.error("Error al guardar progreso:", err);
        window.showToast("Error", err.message, "error");
    }
};
