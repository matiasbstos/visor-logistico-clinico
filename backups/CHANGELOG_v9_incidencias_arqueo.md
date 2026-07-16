# 📦 Registro de Cambios V9: Incidencias y Arqueo de Bandejas
**Fecha del Backup**: 16 de Julio de 2026
**Versión**: `20260716_v9_IncidenciasArqueo`

## 🚀 Nuevas Capacidades de Incidencias y Arqueo Clínico
Esta versión introduce un control estricto de incidencias, validación y formateo obligatorio de RUT del paciente y soporte para sumas y restas de unidades durante el arqueo de bandejas.

### 1. 🔍 Selector de Incidencias y Motivos Estructurados
- **Selector Sí/No**: Se agregó una pregunta obligatoria para determinar si existe una incidencia clínica con el medicamento.
- **Catálogo de Incidencias**: En caso afirmativo, el sistema despliega un dropdown con las opciones obligatorias:
  - *Precipitado*
  - *Quiebre por conteo*
  - *Quiebre por preparación*
  - *Rechazo de tratamiento*
  - *Contaminación de tratamiento*
  - *Imposible de aplicar*
- **Consumo Normal**: Si no se reporta incidencia, se registra el movimiento bajo la categoría "Consumo".

### 2. 🔐 Validación y Formateo Obligatorio de RUT
- **Algoritmo de Validación**: Se implementó una verificación estricta basada en el dígito verificador (Módulo 11) de Chile. No se permite guardar el arqueo sin un RUT válido.
- **Formateo Automático**: El RUT se limpia de caracteres innecesarios y se guarda con formato estándar `XX.XXX.XXX-X`.
- **Trazabilidad en Tabla**: El RUT del paciente receptor se muestra directamente debajo del insumo clínico en la tabla de la bandeja de turno.

### 3. ➕ Ajustes Incrementales y Decrementales (Sumar/Restar)
- **Correcciones y Devoluciones**: Se removió el límite mínimo de cantidad (`min="1"`) en el formulario de arqueo, permitiendo registrar cantidades negativas (devoluciones de stock) y cantidades positivas de consumo.
- **Validación de Límites**: El sistema asegura que el stock consumido acumulado de un insumo no quede por debajo de 0.

### 4. 👥 Acceso Multi-Rol al Arqueo
- **Soporte Multiperfil**: Se habilitó el botón y la acción de arqueo no solo para enfermeros, sino también para `superadmin`, `logistica` y `bodega` cuando la bandeja está en uso.

---
**Backup realizado por Antigravity - Senior Fullstack Developer**
