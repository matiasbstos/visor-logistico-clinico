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
- Tipos de ubicación (confirmados por el usuario el 2026-11-01): `central`, `transitoria` (creadas por el usuario por falta de espacio, p. ej. una bodega en la Corporación), `stock_turno` (bodega pequeña con el stock de uso por turno, desde donde se repone si algo se acaba antes del fin del turno; **requiere un nombre definido por el usuario**), `farmacia`, `carro_paro` y `externa` (otros centros). Las **bandejas** no son bodegas: son una entidad aparte con su propio ciclo (sección 5.1).
- **Stock global del centro** = Bodega Central + bodegas transitorias + stock de turno + farmacia + carro de paro + lo que va en bandejas y en tránsito. Cada unidad está en un solo lugar a la vez.
- Campos: `motivo`, `descripcionUbicacion`, `responsableUid` (usuario real), `activa`, `archivada`, `aptaControlados`, `fechaRetornoEstimada`.
- Eliminar solo sin stock; con stock, asistente "Cerrar bodega" → devuelve todo a Central en un movimiento; con historial, se archiva.
- Vista "¿Dónde está?": búsqueda por insumo (incluye aseo) → bodegas y cantidades.
- Regla (a validar con el químico farmacéutico): los controlados solo en ubicaciones `aptaControlados`.
- **Migración en etapas:** (1) agregar `bodegaId` junto a `location`; (2) migrar datos con respaldo; (3) cambiar la lectura; (4) retirar la dependencia del nombre.

## 4.1 Estantes, códigos y etiquetas ✅ (decisiones del usuario, 2026-11-01)

- Jerarquía: **Ubicación → Estante → Nivel → Espacio (opcional)**.
- **Código**: `PREFIJO-LETRA+NÚMERO`, p. ej. `BS-A01`. Prefijo propio de cada bodega (se define al crearla; `BS` = Bodega Central). **Letra = nivel**, de abajo hacia arriba (A el más bajo, luego B, C, D, E). **Número = estante** correlativo (01, 02, 03…).
- **Subdivisión**: un nivel de un estante puede subdividirse en espacios numerados (p. ej. una bandeja completa dividida por tipo de medicamento): `BS-A01-1`, `BS-A01-2`. Es opcional.
- **Cada bodega decide si usa estantes**: al crearla (y luego, editándola) un interruptor "Usar estantes/ubicaciones" sí/no. Activarlo después deja los productos existentes como "sin ubicar"; desactivarlo archiva las ubicaciones (no las borra) y los productos quedan asignados a la bodega.
- **Bodegas "sin estantes"** (modo simple): los productos se asignan a la bodega y se cuentan como una lista (p. ej. transitorias por espacio). Una bodega con estantes admite productos **"sin ubicar"** (pendientes) mientras se asignan.
- Un producto puede estar repartido en varias ubicaciones, con cantidad por ubicación.
- **Etiquetas**: el sistema las genera para imprimir, con código en letra grande, **código de barras (pistola lectora, que actúa como teclado)** y **QR** (celular). Al leer el código se abre esa ubicación: qué productos hay, cantidades, lotes por vencer y opción de contarla.
- **Etiqueta general de bodega** (QR + código de barras, p. ej. `BS`): abre una pantalla de **acceso rápido** pensada para el celular, con el stock completo de esa bodega y botones grandes: *Ver stock · Ingresar · Sacar · Ajuste · Ubicar · Inventario*. Requiere iniciar sesión (el QR solo lleva el identificador de la bodega, nunca datos) y respeta los permisos por rol. Desde ahí se puede pasar a la vista completa del sitio. Si la sesión no está abierta, se inicia sesión y se vuelve a esa misma bodega.
- Vista **"¿Dónde está?"**: bodega → estante → nivel → espacio de cada producto.
- Ubicaciones por identificador inmutable; renombrar la bodega no cambia los códigos.

## 4.2 Tomas de inventario ✅ (decisiones del usuario, 2026-11-01)

| Tipo | Alcance | Frecuencia |
|---|---|---|
| Semanal | Parcial: se eligen categorías o estantes | Semanal |
| Bimestral | Completo (obligatorio) | Cada 2 meses 🟡 |
| Pre-campaña de invierno | Completo (obligatorio) | Antes de la campaña |
| Post-campaña de invierno | Completo (obligatorio) | Al terminar la campaña |

- Aplica por ubicación: Bodega Central, Bodega Transitoria, Farmacia, Carro de Paro y bodegas adicionales.
- Los completos solo cierran con conteo de **todo** el catálogo de la ubicación (0 incluido). Cada inventario queda marcado con su tipo.
- Fechas de campaña definidas por un administrador cada año. Consumo de campaña = stock pre + ingresos − stock post; respalda la solicitud de compra.
- Conteo guiado: ruta ordenada por ubicación, confirmación escaneando la etiqueta, conteo de los productos de esa ubicación, aviso de lo no contado.
- El cierre fija la cantidad contada (no suma) en una sola transacción, con lotes/vencimientos y historial por diferencia; las diferencias grandes exigen justificación 🟡 (umbral y aprobación por definir).
- 🟡 Pendiente: si los bimestrales continúan además de los dos de campaña.

## 5. Flujo de movimientos ✅ (implementación 🟡)
```
Proveedor → Bodega Central → Bodega Transitoria → Transitoria de Farmacia → Bandeja / Carro de Paro
                  └──→ Otro centro (traspaso externo)
```
- Catálogo de ubicaciones con tipo y transiciones permitidas.
- Movimiento en dos pasos (despacho → recepción); el stock en tránsito no está disponible.
- Consumo en bandeja/carro: salida con motivo (uso clínico, merma, vencido, reposición). Trazabilidad por lote → ubicación → turno → funcionario.
- Traspasos a otros centros: tipo propio, con catálogo de centros y documento de respaldo.

### 5.1 Bandejas y carro de paro ✅ (decisiones del usuario, 2026-11-01)
- Las bandejas **siempre se cargan desde la Bodega Central**; lo que sobra vuelve a la Bodega Central.
- Se preparan 3 bandejas por turno, cada una asignada a un enfermero de turno. Contienen medicamentos inyectables, incluidos controlados.
- Ciclo: la bodega crea la bandeja → el enfermero cuadra lo recibido → registra consumos y mermas durante el turno → al cierre carga el informe de Rayen APS «Informe de consumo de prestaciones» y el sistema cruza lo reportado en el Visor con lo de Rayen; cada diferencia exige justificación → pérdidas, quiebres y eliminaciones se reportan → la bandeja pasa a «enviada a bodega» (en tránsito) → el encargado de bodega cuadra nuevamente y recién ahí el sobrante vuelve al stock de la Bodega Central.
- **El carro de paro funciona como una bandeja**: contenido fijo, se cuadra cada cierto tiempo y se repone cuando se usa. Se modelará con el mismo ciclo que las bandejas.
- **Stock en tránsito:** mientras la bandeja está en uso o en camino, sus unidades deben verse en el stock global («en bandejas»). Los consumos y pérdidas reportados deben reflejarse en el historial y en el stock global en el momento del reporte, no solo al cerrar la bandeja.
- Pendiente: muestra del informe de Rayen (sin datos de pacientes) para definir el cruce, y confirmar si trae folio DAU. El archivo se lee en el navegador y no se guardan datos de pacientes.
- Pendiente técnico: eliminar el cierre antiguo («Entregar bandeja a bodega») que devuelve stock sin el cuadre del encargado de bodega.

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

### 4.3 Inventario general: fechas (decidido 2026-11-01)
- El inventario general se hace **2 veces al año**: antes y después de la campaña de invierno. No hay inventarios bimestrales.
- El administrador define en Configuración → Logística: inicio y término de la campaña y las fechas de ambos conteos (`ajustes_sistema/global_config`: `invCampanaInicio`, `invCampanaFin`, `invPreFecha`, `invPostFecha`).
- El Inicio muestra la próxima fecha (roja si faltan 7 días o menos) y hace cuánto fue el último conteo semanal (rojo si pasan más de 8 días). Lo ven todos los roles.

## 4.4 Seguimiento de órdenes de compra (v20.36)
- Una OC de Mercado Público puede reunir varios memos/CDP de distintos centros (ej. 1298355-840-AG26: 7 memos/CDP de 5 centros). El seguimiento (`Seguimiento_OC`) guarda el cuadro de distribución y lo recibido por memo/CDP; la vista por defecto muestra solo los del SAR.
- Plazo en **días hábiles** (lun–vie sin feriados) contados desde el día siguiente a la aceptación de la OC por el proveedor. Feriados de Chile 2026 incluidos; otros años se agregan en "Configurar correo".
- Bitácora `Seguimiento_OC/{id}/Eventos` **inmutable** (notas, recepciones, decisión de multa, resultado del correo).
- Cada notificación puede enviar correo a la lista de destinatarios de la OC. Envío por Google Apps Script propio (sin plan Blaze); el código y los pasos están en "Configurar correo". Config en `Config_Correo/principal` (URL + clave; lectura staff, escritura admin). Sin configurar, se abre un borrador de correo.
- No se guardan datos de pacientes. La decisión de multa (ej. "bajo $100.000 no se cursa") se registra como evento, no se calcula automáticamente: la tasa de multa depende del anexo económico de cada compra.

## 4.5 Actas de entrega (v20.37)
- Formato fiel al acta oficial (encabezado con logo SAR, "Se hace entrega al centro X de lo siguiente", lista numerada, pendientes, tabla de firmas) en **PDF y Word editable**. Se agregó el **N° de acta** (AE-AAAA-NNNN). "Cantidad/Entregado" del modelo se unificó a "Entregado".
- Correlativo atómico (`Contadores/acta-AAAA`). Acta en `Actas_Entrega/{numero}`; no se borra. Anulación solo por administrador: devuelve el stock, queda ANULADA y el número no se reutiliza.
- **Emitir descuenta stock** de la bodega de origen (FEFO por lote) en la misma transacción, con movimiento `ENTREGA_ACTA` en el historial (documento = N° de acta). El borrador no toca stock. Productos en CUARENTENA no se pueden entregar.
- Sección "Documentos asociados" (SDC, OC, factura, guía, memo) opcional. Sin datos de pacientes.

## 4.6 Oxígeno portátil (v20.38)
- Los balones portátiles son **equipos médicos**, no insumos: se llevan en `Equipos_Oxigeno/{serie}` (uno por N° de serie, capacidad por defecto 1 m³) con estado LLENO / VACÍO / EN RECARGA / ENTREGADO A CENTRO / FUERA DE SERVICIO y bitácora inmutable `Eventos` (alta, envío a recarga, recarga recibida, vacío, devolución, incidencia, entrega con acta).
- La entrega a un centro usa el mismo formato y correlativo AE-AAAA-NNNN que las actas de insumos (`Actas_Entrega` con `tipo: 'OXIGENO'`, una línea por balón con su N° de serie). Solo se entregan balones LLENOS. No descuenta Insumos; no se anula (se registra la devolución).
- Pendiente: balones grandes (bombonas) cuando se conozca su manejo. No se registran datos de pacientes.

## 4.7 Órdenes de compra desde el PDF, aceptación y recepción con stock (v20.39)
- **Lectores de documentos** (`oc-lector.js`): cada tipo de documento tiene su propio lector, porque cada emisor distribuye la información distinto. Hoy solo la OC de Mercado Público (formato estándar). Guías y facturas de proveedores se agregan después como lectores nuevos. Un lector **nunca guarda solo**: muestra una pantalla de revisión y la persona confirma. Si algo no se lee, se completa a mano.
- Plazos de una OC con convenio marco: **aceptación del proveedor** (ej. 48 horas desde el envío) y **entrega en N días hábiles desde la aceptación** (ej. 2). Ambos vienen en el correo; se pueden pegar para leerlos. Sin aceptación vencida = alerta; con aceptación, vence a los N días hábiles.
- "Stock pendiente de recepción": lo pedido al SAR que aún no llega, de las OC abiertas (no es stock disponible).
- **Recepción**: por producto se indica cantidad, lote, vencimiento, producto del inventario y, si corresponde, una **incidencia** (dañado, vencimiento corto, distinto, faltante, otro). Lo recibido se **ingresa a Bodega Central** (movimiento `INGRESO_OC` con N° de OC y guía) en la misma transacción que actualiza la OC. Las incidencias quedan abiertas como discrepancia hasta resolverlas con una nota.
- No se guarda el PDF (solo los datos leídos y revisados).

## 4.8 Bandejas: producto del inventario central (v20.40)
- Al reintegrar o reponer desde una bandeja, el producto se busca por nombre y, si existe en varias bodegas, se usa el de **Bodega Central** (o el registro antiguo sin bodega), no uno al azar.

## 4.9 Sin datos de pacientes en el código (v20.41)
- Se eliminó la captura de RUT, nombre y cama: la transferencia "Dispensación nominal a paciente" pasó a **"Salida por consumo (sin datos de paciente)"** (documento `SALIDA-CONSUMO`) y el arqueo parcial de bandejas ya no pide RUT. Se quitaron también los lugares que mostraban esos datos y los datos de ejemplo.
- Datos ya guardados: herramienta **"Anonimizar datos antiguos"** (Configuración, solo superadministrador): revisa sin cambiar nada, descarga un respaldo local y luego limpia `Historial_Movimientos` (rutPaciente, nombrePaciente, camaPaciente, documento `RECETA-…`) y `Bandejas_Turno` (rutPaciente y "(RUT: …)"). Las reglas permiten ese único cambio al historial.
- Pendiente: revisar respaldos existentes (`Respaldos_Toma_Inventario`, respaldos del borrado) y el historial de git; y la fase 2 (folio DAU para controlados).

### Revisión de respaldos y código (noviembre 2026)
- `Respaldos_Toma_Inventario` guarda solo stock (producto, cantidad, lote, vencimiento): **no contiene datos de pacientes**.
- En el código solo quedan RUT de proveedores (públicos) y el RUT de la enfermera firmante de las actas (funcionaria, no paciente). Los RUT de pacientes que aparecían eran datos de ejemplo del demo (ya eliminados en v20.41); en el historial de git solo existen esos ejemplos, no datos reales.
- Los datos reales de pacientes (si los hubo) estaban en Firestore: `Historial_Movimientos` y `Bandejas_Turno`, cubiertos por la herramienta de anonimización.

### 4.10 Compras ágiles (etapa previa a la OC) — v20.42
- Una compra ágil (ID `1298355-1122-COT26`) se sigue desde la publicación de los TDR hasta que llega la OC (`1298355-1122-AG26`); se enlazan por el prefijo `1298355-1122`.
- Estados: Publicada → Oferta recibida → Esperando V°B° → V°B° completo · esperando OC → OC emitida (o Cerrada/desierta).
- Se registran: ítems y cuadro por centro (memo/CDP), oferta admisible, documentos del oferente (con vencimiento), V°B° por centro y bitácora inmutable.
- Alertas automáticas: sobre presupuesto, plazo/vigencia fuera de bases, documento vencido antes de la oferta, certificado de habilidad con más de 30 días, ficha técnica faltante por ítem, observaciones de equivalencia, cuenta bancaria a nombre de un tercero, OC que no llega 5+ días hábiles después del V°B°.
- Las alertas informan; la decisión de adjudicar o pagar sigue siendo de las personas autorizadas.
- Al ingresar la OC desde el PDF, si existe la compra ágil con el mismo prefijo y las cantidades calzan (mismo orden o por cantidad), el cuadro por centro (memo/CDP) se copia a la OC y las dos quedan enlazadas (v20.43). Si no calza, se ingresa todo al SAR y se avisa.
