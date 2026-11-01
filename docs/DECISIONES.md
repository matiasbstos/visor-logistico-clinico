# Decisiones de diseño — Visor Logístico Clínico (SAR)

Registro de decisiones tomadas el **2026-11-01**. Estado: ✅ decidido por el responsable del proyecto · 🟡 propuesto, pendiente de validación.

---

## 1. Qué es este sistema
Mini-ERP/WMS clínico: inventario multi-ubicación con lotes y vencimientos, bandejas de turno, transferencias, toma de inventario, ajustes con aprobación, adquisiciones e informes. **Es un sistema logístico**: registra dónde está cada insumo y quién lo movió, no a quién se le administró.

## 2. Sin datos de pacientes ✅
- No se guarda RUT, nombre, domicilio ni cama de pacientes.
- Hoy el código lo hace en: transferencia "Dispensación Nominal a Paciente" (`script.js` ~4752-4880), arqueo parcial de bandejas (~7446-7471) y datos de ejemplo en `visor-adquisiciones.js` (~4059-4079). Todo debe eliminarse.
- **Datos ya guardados:** anonimizar `Historial_Movimientos` (`rutPaciente`, `nombrePaciente`, `camaPaciente`), `Bandejas_Turno.medicamentos[].rutPaciente` y el texto `(RUT: …)` en observaciones; revisar respaldos (`Respaldos_Toma_Inventario`, respaldos del borrado) y el historial de git. Migración con respaldo previo y modo de prueba.

## 3. Medicamentos controlados y folio DAU ✅ (detalle técnico 🟡)
**Decisión:** para medicamentos controlados, cuando se consumen en bandeja o carro de paro, se registra el **folio DAU** (Dato de Atención de Urgencia) para poder hacer seguimiento con la ficha del paciente. Solo para esos medicamentos.

**Marco normativo revisado** (fuentes al final):
- DS 404 (estupefacientes) y DS 405 (psicotrópicos), art. 18: Libro de Control visado por el ISP o el Servicio de Salud, con ingresos, egresos y saldos. En los egresos se consigna nombre y domicilio del paciente, datos de la receta y del profesional. **Es obligación del establecimiento (Director Técnico), en su libro; no es del Visor.**
- DS 404 art. 33: los establecimientos asistenciales pueden usar recetarios internos autorizados por el Servicio de Salud. Art. 35: almacenamiento bajo llave.
- Los decretos revisados **no regulan** la administración al paciente desde bandejas o carros. Eso depende del DS 466, instrucciones del ISP/Servicio de Salud y el procedimiento interno: **pendiente de confirmar con el químico farmacéutico.**

**Diseño propuesto:**
- Campo `controlado` en el catálogo de insumos (`estupefaciente` | `psicotropico` | null).
- Colección `Registro_Controlados` (solo-agregar): `insumoId`, `nombreInsumo`, `lote`, `cantidad`, `folioDAU`, `ubicacionId`, `ubicacionNombre`, `movimientoId`, `tipoControl`, `usuario`, `fecha`.
- Reglas: `create` para operador/enfermero/admin; `read` solo para roles autorizados (propuesta: nuevo rol `farmacia`, admin, superadmin); `update` y `delete` prohibidos; registro de cada consulta.
- `Historial_Movimientos` guarda solo `registroControladoId`, nunca el folio.
- El folio sigue siendo dato personal (indirecto): acceso restringido, plazo de retención definido, sin exportaciones masivas.

## 4. Ubicaciones y bodegas transitorias ✅ (detalle técnico 🟡)
**Necesidad:** poder agregar bodegas transitorias (por ejemplo, por falta de espacio, para guardar insumos de aseo en otras dependencias), saber dónde están los productos, y crear, renombrar y eliminar esas ubicaciones cuantas veces haga falta.

**Problema actual:** los insumos referencian la bodega por **nombre** (68 usos de `location` en `script.js`, con 'Bodega Central' escrito a mano 51 veces). Renombrar dejaría stock huérfano; eliminar una bodega con stock deja ghost stock. Hoy solo existe crear y eliminar (sin editar), con 3 tipos fijos y un responsable de lista fija.

**Diseño propuesto:**
- ID inmutable por ubicación; nombre editable; `bodegaId` + `bodegaNombre` en Insumos y movimientos (el historial conserva el nombre vigente al momento).
- Tipos: `central`, `transitoria`, `farmacia_transitoria`, `bandeja`, `carro_paro`, `externa`.
- Campos: `motivo`, `descripcionUbicacion`, `responsableUid` (usuario real), `activa`, `archivada`, `aptaControlados`, `fechaRetornoEstimada`.
- Eliminar solo sin stock; con stock, asistente "Cerrar bodega" → devuelve todo a Central en un movimiento; con historial, se archiva.
- Vista "¿Dónde está?": búsqueda por insumo (incluye aseo) → bodegas y cantidades.
- Regla (a validar con el químico farmacéutico): los controlados solo en ubicaciones `aptaControlados`.
- **Migración en etapas:** (1) agregar `bodegaId` junto a `location`; (2) migrar datos con respaldo; (3) cambiar la lectura; (4) retirar la dependencia del nombre.

## 5. Flujo de movimientos ✅ (implementación 🟡)
```
Proveedor → Bodega Central → Bodega Transitoria → Transitoria de Farmacia → Bandeja / Carro de Paro
                  └──→ Otro centro (traspaso externo)
```
- Catálogo de ubicaciones con tipo y transiciones permitidas.
- Movimiento en dos pasos (despacho → recepción); el stock en tránsito no está disponible.
- Consumo en bandeja/carro: salida con motivo (uso clínico, merma, vencido, reposición). Trazabilidad por lote → ubicación → turno → funcionario.
- Traspasos a otros centros: tipo propio, con catálogo de centros y documento de respaldo.

## 6. Protección de datos personales 🟡
- Con la eliminación de datos de pacientes, el tratamiento de datos de salud sale del sistema, excepto el folio DAU. Siguen siendo datos personales los de funcionarios (correo, nombre, rol, bitácora, firmantes en actas): finalidad, retención y acceso por rol.
- Ley 21.719: entrada en vigor prevista para el 1 de diciembre de 2026, con un proyecto en trámite para postergarla un año. **Confirmar estado vigente** con el asesor jurídico de la Corporación.
- Pendientes: región del proyecto Firestore (transferencia internacional), fotos de etiquetas enviadas a Gemini desde el navegador (mover a backend), plazo de retención del historial, procedimiento ante brechas de seguridad, registro de actividades de tratamiento.

## 7. Preguntas abiertas para el Director Técnico / Servicio de Salud
1. ¿Se exige registro nominal al administrar un estupefaciente o psicotrópico desde una bandeja o el carro de paro? ¿Con qué datos?
2. ¿Basta el folio DAU como vínculo con la ficha, o se requiere algo adicional?
3. ¿Qué plazo de conservación aplica a este registro?
4. ¿Quién debe poder consultarlo?
5. ¿Qué formato tiene el folio DAU (largo, solo dígitos)? ¿Se valida?
6. ¿Qué ubicaciones califican como "bajo llave" para controlados?

## 8. Plan por fases 🟡
- **Fase 0 — Seguridad inmediata:** rotar la contraseña expuesta en `reset-pwd.js`; restringir la clave de API; aplicar el `firebase.json` endurecido; corregir la regla de creación de `/Usuarios` (el patrón de dominio no está anclado); escapar `nombre` y revisar `innerHTML`; restringir la lectura de `Historial_Movimientos`.
- **Fase 1 — Ubicaciones por ID y bodegas transitorias** (sección 4).
- **Fase 2 — Registro de controlados con folio DAU** y limpieza de RUT existente (secciones 2 y 3).
- **Fase 3 — Movimientos atómicos en dos pasos** y tipos de ubicación (sección 5).
- **Fase 4 — Reglas por rol y por campo**, pruebas de reglas con el emulador, CI.
- **Fase 5 — Modularización** del código y actualización de dependencias.

---

### Fuentes normativas consultadas
- [DS 404, art. 17](https://iura.cl/dto-404-minsal/17) · [art. 18](https://iura.cl/dto-404-minsal/18) · [art. 22](https://iura.cl/dto-404-minsal/22) · [art. 26](https://iura.cl/dto-404-minsal/26) · [texto completo](https://eticayseguridad.uc.cl/images/Decreto_Supremo_404.pdf)
- [DS 405, art. 17](https://iura.cl/dto-405-minsal/17) · [art. 18](https://iura.cl/dto-405-minsal/18) · [art. 29](https://iura.cl/dto-405-minsal/29)
- [Ley 21.719: vigencia](https://www.diarioconstitucional.cl/2026/06/12/la-ley-21-719-entra-en-vigor-el-1-de-diciembre-y-expone-vacios-en-regulacion-de-pequenas-empresas/) · [proyecto de postergación](https://www.carey.cl/gobierno-ingresa-proyecto-de-ley-que-posterga-en-un-ano-entrada-en-vigor-de-la-ley-sobre-proteccion-de-datos-personales)

*Este documento no constituye asesoría jurídica; las interpretaciones normativas deben validarse con el Director Técnico y el asesor legal.*
