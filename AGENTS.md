# 🛡️ GUARDIÁN DE INTEGRIDAD Y REGLAS DE ORO — VISOR LOGÍSTICO CLÍNICO

Este archivo actúa como la directiva maestra (`AGENTS.md`) para cualquier agente o desarrollador que trabaje en el repositorio **Visor Logístico Clínico**. Establece las reglas inquebrantables, contratos de datos y protocolos de verificación de integridad antes, durante y después de cualquier actualización.

---

## 🏛️ 1. PILARES ARQUITECTÓNICOS DEL SISTEMA

1. **Persistencia Híbrida y Sincronizada**:
   - **Firebase Firestore**: Base de datos NoSQL transaccional en tiempo real (Colecciones: `Insumos`, `Historial_Movimientos`, `Incidencias`, `Usuarios_Roles`, `Bandejas_Turno`, `Configuracion`).
   - **Google Sheets**: Libro maestro de categorías individuales (`COMPRIMIDOS`, `JARABES`, etc.), `CONSOLIDADO_GENERAL` y la hoja ejecutiva `📊 DASHBOARD`.
   - **Bóveda Local (Cache / LocalStorage / IndexedDB)**: Resguardo de contingencia ante cortes de conectividad.

2. **Regla de No Regresión (Zero Regression)**:
   - Ninguna modificación a un módulo (ej. Bandejas o Compras) puede alterar o romper las funciones ya estabilizadas (Toma de Inventario, Panel de Control, Sincronizador de Sheets, Descarte de Vencidos).

---

## 🔒 2. REGLAS DE ORO DE INTEGRIDAD DE DATOS

### Regla 1: Contrato de Datos del Insumo / Medicamento
Todo objeto de insumo DEBE cumplir con los campos estándar:
```typescript
interface InsumoRecord {
  code: string;              // Código único (ej: "SAR-1002" o "S/I")
  name: string;              // Nombre clínico en mayúsculas (ej: "PARACETAMOL 500 MG")
  name_lowercase: string;    // Búsqueda insensible a mayúsculas
  category: string;          // Categoría exacta (COMPRIMIDOS, JARABES, GOTAS, etc.)
  quantity: number;          // Stock contable físico actual
  totalAcumulado?: number;   // Stock acumulado entre tomas
  batch: string;             // Número de lote
  expirationDate: string;    // Fecha formateada (MM/AAAA o YYYY-MM-DD)
  location: string;          // Bodega o servicio (ej: "Bodega Central")
  unitPrice: number;         // Costo unitario en CLP ($)
  criticalLimit: number;     // Stock mínimo para alarma (default: 50)
  isCritical?: boolean;      // quantity <= criticalLimit
  fase?: string;             // "1ra Toma (Inicial)", "2da Toma", etc.
  user?: string;             // Email del operador responsable
  observations?: string;     // Notas clínicas o motivo de ajuste
  updatedAt?: Timestamp;     // Fecha de última modificación
}
```

### Regla 2: Eliminación e Inserción Transaccional
- **Al Insertar**: Se registra en Firestore (`Insumos`), se agrega en `Historial_Movimientos`, se envía a la pestaña de categoría en Google Sheets, a `CONSOLIDADO_GENERAL` y se refresca `📊 DASHBOARD`.
- **Al Eliminar**: Se descuenta o borra el doc en Firestore, se registra evento negativo en `Historial_Movimientos`, se elimina la fila en Google Sheets y se recalcula `📊 DASHBOARD`.
- **Al Limpiar Sesión**: Se vacía Firestore conservando la estructura, se borran filas de Google Sheets conservando los encabezados (Fila 1) y se limpia la sesión local.

### Regla 3: Parseo Universal de Fechas Clínicas
- Todas las fechas deben ser procesadas a través del motor `window.SAR_Utils.parseDate` o `parseDateGAS`, tolerando formatos `MM/AAAA`, `YYYY-MM-DD`, `DD/MM/YYYY`, `YYYY-MM` y timestamps ISO.

---

## 📋 3. PROTOCOLO DE VERIFICACIÓN OBLIGATORIO ANTE ACTUALIZACIONES

Antes de dar por completado cualquier cambio o despliegue:

```bash
# 1. Validación de sintaxis JS
node -c script.js
node -c patch-plantillas.js

# 2. Comprobar que los selectores del DOM sigan existiendo en index.html
# IDs críticos:
# - dash-urgencias-tbody, dash-precaucion-tbody, total-stock, total-insumos, stock-critico-badge
# - toma-table-body, toma-quick-scan, form-toma-inventario, btn-sync-sheets-dashboard
# - btn-clear-toma-session, btn-pull-from-sheets, btn-open-config-sheets

# 3. Bump de versión para Cache Busting
# - Actualizar CACHE_NAME en sw.js (ej: v18.8 -> v18.9)
# - Actualizar referencias ?v=X.X en index.html

# 4. Despliegue a Firebase Hosting
npx firebase-tools deploy --only hosting
```

---

## 🛡️ 4. ACCIONES ANTE NUEVAS FUNCIONES
Si el usuario solicita una nueva función (ej: reportes PDF avanzados, módulo de farmacia de turno, control de lotes múltiples):
1. **Analizar Dependencias**: Identificar si interactúa con `script.js`, `index.html` o Google Apps Script.
2. **Aislar Componentes**: Utilizar funciones modulares o scripts complementarios sin sobreescribir lógica de sincronización central.
3. **Verificar Integridad**: Ejecutar el checklist del punto 3.
4. **Respaldo de Emergencia**: Registrar los cambios con trazabilidad en el control de versiones.
