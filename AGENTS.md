# 🛡️ GUARDIÁN DE INTEGRIDAD Y REGLAS DE ORO — VISOR LOGÍSTICO CLÍNICO

Directiva maestra para cualquier agente o desarrollador que trabaje en este repositorio. Las decisiones de diseño y su justificación están en `docs/DECISIONES.md`: **léelo antes de proponer cambios de modelo de datos, reglas o flujos.**

---

## 0. REGLAS NO NEGOCIABLES

1. **Nada llega a producción sin revisión humana.** Un agente NO ejecuta `git push origin main` ni `firebase deploy` por iniciativa propia. Flujo obligatorio: rama → cambios → Pull Request → prueba en emulador/staging → merge y despliegue **hechos por el usuario**.
   - **Tampoco** se ejecutan `node publish-release.js`, `npm run release` ni `npm run deploy`: hacen `git add .`, push a `main` y despliegan Hosting **y las reglas de Firestore** de una sola vez. Las reglas del repositorio pueden diferir de las desplegadas; solo el usuario los corre, a mano. (`.agents/rules/guardian_integridad.md` replica esta regla para Antigravity.)
2. **Cero credenciales en el repositorio.** Prohibido escribir contraseñas, claves de API, tokens o `serviceAccountKey.json`. Los scripts administrativos leen credenciales de variables de entorno o de un archivo fuera del repo.
3. **Hosting publica solo lo necesario.** `firebase.json` excluye (`hosting.ignore`) scripts administrativos, parches, respaldos, documentación y `functions/`. Todo archivo nuevo que NO sea parte de la app debe quedar excluido; todo archivo nuevo de la app debe cargarse desde `index.html`.
4. **No se guardan datos de pacientes en este sistema** (ni RUT, nombre, domicilio, cama). Única excepción: el folio DAU de medicamentos controlados, en `Registro_Controlados` (ver sección 2, Regla 4).
5. **Toda colección nueva exige regla en `firestore.rules`** y prueba con el emulador. Firestore deniega por defecto: una colección sin regla deja la función rota.
6. **Todo dato proveniente de Firestore que se inserte en HTML** pasa por `window.escapeHTML(...)` o se asigna con `textContent`. Prohibido interpolarlo crudo en `innerHTML`.
7. **Una mutación de stock y su registro en historial ocurren en una sola transacción** (`runTransaction` o `writeBatch`). Prohibido descontar en origen y acreditar en destino en pasos separados.

---

## 1. PILARES ARQUITECTÓNICOS

1. **Persistencia**:
   - **Firebase Firestore**: base transaccional en tiempo real (`Insumos`, `Bodegas`, `Historial_Movimientos`, `Bandejas_Turno`, `Usuarios`, `Registro_Controlados`, entre otras).
   - **Google Sheets** *(pendiente de verificar: la integración descrita en versiones anteriores de este archivo no se encontró en el código actual)*.
   - **Caché local de Firestore (IndexedDB)**: resguardo ante cortes de conectividad. **No se borra automáticamente al cambiar de versión**: contiene escrituras pendientes de sincronizar.
2. **Zero Regression**: ninguna modificación puede romper funciones estabilizadas (Toma de Inventario, Panel de Control, Bandejas, Descarte de Vencidos, Transferencias).

---

## 2. REGLAS DE ORO DE DATOS

### Regla 1: Contrato del Insumo
```typescript
interface InsumoRecord {
  code: string;              // Código único
  name: string;              // Nombre en mayúsculas
  name_lowercase: string;
  category: string;          // COMPRIMIDOS, JARABES, ... o ASEO (insumos no clínicos)
  controlado?: 'estupefaciente' | 'psicotropico' | null; // null = no controlado
  quantity: number;          // Nunca negativo
  batch: string;
  expirationDate: string;
  bodegaId: string;          // ID de la ubicación (referencia PRINCIPAL)
  bodegaNombre: string;      // Nombre denormalizado, solo para mostrar
  unitPrice: number;
  criticalLimit: number;
  updatedAt?: Timestamp;
}
```
`location` (nombre en texto) está en desuso: durante la migración se escriben ambos campos; la lectura migra a `bodegaId`.

### Regla 2: Ubicaciones (Bodegas)
- Cada ubicación tiene **ID inmutable**; el nombre puede cambiar cuantas veces se quiera sin afectar stock ni historial.
- Tipos: `central`, `transitoria`, `farmacia_transitoria`, `bandeja`, `carro_paro`, `externa` (otro centro).
- Las bodegas **transitorias** (p. ej. por falta de espacio) las crea, renombra y cierra el administrador.
- **Eliminar solo si no tiene stock.** Con stock: asistente "Cerrar bodega" que devuelve todo a la Central en un solo movimiento. Si tuvo movimientos: se **archiva**, no se borra.
- Los medicamentos controlados solo pueden estar en ubicaciones con `aptaControlados: true` (guardado bajo llave).

### Regla 3: Movimientos
- Cadena operativa: Proveedor → Bodega Central → Bodega Transitoria → Transitoria de Farmacia → Bandeja / Carro de Paro; además, Bodega Central → otros centros.
- Cada movimiento guarda `origenId`, `origenNombre`, `destinoId`, `destinoNombre`, insumo, lote, vencimiento, cantidad, responsable, documento asociado y estado (`despachado` → `recibido`; en tránsito no es stock disponible).
- `Historial_Movimientos` **no contiene datos de pacientes** y es inmutable (sin update; delete solo superadmin).

### Regla 4: Medicamentos controlados y folio DAU
- Cuando un insumo con `controlado != null` se **consume** (bandeja o carro de paro), el formulario exige el **folio DAU**. Los traspasos entre ubicaciones no lo piden.
- El folio se guarda **solo** en `Registro_Controlados` (append-only, lectura restringida a roles autorizados, con registro de consultas). El historial general guarda únicamente la referencia al registro.

### Regla 5: Fechas
Todas las fechas pasan por `window.SAR_Utils.parseDate` o `parseDateGAS` (formatos `MM/AAAA`, `YYYY-MM-DD`, `DD/MM/YYYY`, `YYYY-MM`, ISO).

---

## 3. PROTOCOLO DE VERIFICACIÓN ANTES DE PEDIR REVISIÓN

```bash
# 1. Sintaxis
node --check script.js
node --check excelUtils.js
node --check visor-adquisiciones.js
node --check visor-triaje.js
node --check patch-plantillas.js
node --check sw.js

# 2. IDs críticos del DOM siguen existiendo en index.html
#    dash-urgencias-tbody, dash-precaucion-tbody, total-stock, total-insumos,
#    stock-critico-badge, toma-table-body, toma-quick-scan, form-toma-inventario

# 3. Reglas de Firestore (si se tocaron): probar con el emulador
firebase emulators:start --only firestore,auth

# 4. Versión (las TRES deben coincidir)
#    - CACHE_NAME en sw.js
#    - APP_VERSION en index.html
#    - parámetros ?v=X.X en index.html y sw.js

# 5. Qué se publicaría en Hosting: desplegar primero a un canal de vista previa
#    (no toca producción) y comprobar que NO se sirvan scripts internos
#    ni documentación, p. ej. <url-del-canal>/reset-pwd.js debe responder
#    como página inexistente, no con el contenido del archivo.
firebase hosting:channel:deploy prueba
```

**Flujo de trabajo:**
1. Crear rama: `git checkout -b feat/<tema>`.
2. Commits pequeños y descriptivos; abrir Pull Request hacia `main`.
3. Probar en emulador o proyecto de staging.
4. El **usuario** hace el merge y ejecuta el despliegue a producción.

Antes de desplegar reglas por primera vez, **exportar las reglas actualmente desplegadas y compararlas** con `firestore.rules` del repo: pueden diferir.

---

## 4. ACCIONES ANTE NUEVAS FUNCIONES
1. **Analizar dependencias**: qué archivos toca (`script.js`, `index.html`, reglas, índices).
2. **Aislar**: preferir módulos nuevos antes que ampliar `script.js`.
3. **Reglas y datos**: ¿colección nueva? ¿regla? ¿migración con respaldo previo y modo de prueba (dry-run)?
4. **Datos personales**: ¿la función captura algún dato de personas? Si es de pacientes, no se implementa; consultar antes.
5. **Verificar** con el protocolo de la sección 3.
6. **Códigos y correlativos**: si la función crea un código o correlativo nuevo, agrégalo a `nomenclaturas.js` (Directorio → Nomenclaturas) con formato, ejemplo, quién lo asigna y su contador.
