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

### 4.11 Recepción conforme y correo con documentos — v20.44
- Botón "Recepción conforme" en el seguimiento de OC: genera el acta de recepción conforme (PDF) y toma la guía de despacho o factura (PDF). El archivo se nombra con su número (`Guia_<N°>.pdf` / `Factura_<N°>.pdf`).
- Correo: Para Paulina Carrasco; Cc Daniela Medina, Carolina Ortiz, Nadia Sánchez, SAR Melipilla y Matías Bustos. Editable en cada envío; la lista fija puede cambiarse en `Config_Correo/principal.recepcionConforme {to, cc}`.
- Se bloquea con incidencias abiertas; con unidades pendientes exige marcar "Recepción parcial". Los PDF no se guardan en la base de datos: queda tipo, número, fecha, quién recibe y el resultado del envío (visible en la OC y en la bitácora).
- El envío con adjuntos requiere el script de Apps Script actualizado (Configurar correo → copiar código nuevo → nueva implementación). Si el script es antiguo, el sistema avisa "enviado SIN adjuntos".

### 4.12 UX/UI — capa de interfaz (v20.46)
- Portada: tarjeta "Compras y órdenes en curso" (OC por aceptar/atrasadas y alertas de compras ágiles), solo personal.
- Capa de CSS al final de `style.css`: entrada de vistas y modales, realce de tarjetas, foco visible con teclado, cifras tabulares, cabeceras de tabla fijas, áreas táctiles de 44 px en móvil y respeto a "reducir movimiento".
- No se agregan librerías ni dependencias de terceros: el sistema sigue siendo JavaScript simple con Firebase.
- v20.47: en celular el encabezado cabe en una fila (56 px en vez de 117 px: se ocultan el segundo logo, la ruta de navegación, la campana y la ayuda); en el Inicio, "Acción inmediata" va antes del gráfico semanal; el ejemplo del login usa el dominio institucional.

### 4.13 Login animado (v20.48)
- Solo presentación: panel de marca (azul SAR, acento verde) que se desliza entre "Ingresar" y "Recuperar acceso". IDs y manejadores de autenticación (`form-login`, `login-email`, `login-pwd`, `forgot-pwd-link`) no cambian; el formulario de recuperación reutiliza el mismo manejador.
- Sin "crear cuenta": las cuentas las crea el administrador. En móvil (<760px) no hay panel; se mantiene el enlace "¿Olvidó su contraseña?". Respeta `prefers-reduced-motion`. Archivo: `login-animado.js`.

### 4.14 Marca del Visor y animación del login (v20.49)
- Marca: hexágono (caja de insumos) + cruz clínica + punto verde SAR; archivos en `assets/logo/`. Aplicada por ahora solo en el login; falta favicon/ícono de app/encabezado.
- Login: el hexágono se dibuja, la cruz crece y el punto cae y late; al cambiar a "Recuperar" el hexágono gira 60° y el punto orbita 180°; al enviar credenciales el punto orbita (máx. 6 s). Respeta `prefers-reduced-motion`.

### 4.15 Marca en toda la app (v20.50)
- Marca en barra lateral, favicon (SVG + PNG 32), apple-touch-icon y manifest PWA (iconos 192/512 maskable, theme-color #1A3668). Reemplaza la "S" roja.

### 4.16 Directorio de errores y alertas (v20.51)
- `errores.js`: catálogo único de 36 códigos `SAR-<ÁREA>-NNN` (acceso, datos, inventario, compras, documentos, seguridad clínica, sistema) con significado, causa, solución y quién actúa.
- Los avisos de error/advertencia que coinciden con el catálogo muestran "Ref. CÓDIGO"; cada aparición se anota solo en el equipo local (máx. 100, sin datos de pacientes). Vista exclusiva de administración (menú "Directorio de errores").
- Para sumar un error nuevo: agregar una fila en el arreglo `C` de `errores.js` con los textos que lo identifican.

### 4.17 Sobregiro en actas de entrega y saldos contables (v20.52)
- Se puede entregar en un acta lo que aún no está cargado en el sistema (insumo existente sin stock o **ingreso manual**, que se asume físico). `quantity` nunca baja de 0: lo que falta queda como `sobregiro` del insumo. **Saldo contable = en sistema − sobregiro** (puede ser negativo); **disponible = máx(0, contable)**.
- Ingreso manual crea un insumo `provisional` en la bodega (o usa el existente con ese nombre). Se fusiona/valida al hacer el inventario.
- **Cuadre:** al ingresar la OC/SDC, "Cuadrar" (por insumo o todos) descuenta lo ya entregado del stock ingresado, deja el resto disponible y registra `CUADRE_SOBREGIRO` en el historial. Si se emite otra acta antes, cuadra automáticamente primero. Anular un acta retira el sobregiro correspondiente.
- Medicamentos controlados **no** pueden entregarse sin stock en sistema (circuito con folio DAU en registro separado).
- El documento del acta (PDF/Word) **no cambia de formato**: el sobregiro es solo registro interno (acta `conSobregiro`, item `sinRespaldo`, historial). Informes Excel (CSV): contable valorizado y disponible, en la vista Actas de entrega.
- Pendiente: mostrar el sobregiro en Existencias/Informes generales y cuadrar automáticamente en cada vía de ingreso.

### 4.18 ID de seguimiento del acta (v20.53)
- El ID de seguimiento es el número del acta (AE-AAAA-NNNN), que ya sale impreso; el documento no cambia.
- Cada insumo guarda `sobregiroDetalle` [{acta, qty}] (cuadre FIFO: se cubre primero el acta más antigua). Cada cuadre/anulación queda en el historial con `actaId`.
- Vista Actas de entrega → "Seguimiento de un acta": se escribe el ID y muestra por insumo entregado / con respaldo / sin respaldo / cuadrado / pendiente, más la línea de movimientos (entrega, cuadres con su OC/SDC, anulación). Descarga Excel (CSV).
- Los informes contable y disponible incluyen la columna "Actas con sobregiro (unidades)".

### 4.19 Flujo de compra SDC/Memo → OC → recepción (v20.54)
Según el cuaderno del encargado: CDP (lo genera Presupuesto, por centro) · SDC del encargado del centro (o memo) · publicación en Mercado Público (ID COT, adjudicación) · OC `1298355-XXX-AG26` (XXX = N° de orden) · guía de despacho/factura del proveedor · recepción conforme parcial o total · cuadro de distribución por centro (Adquisiciones Salud).
- Compra ágil: nuevo bloque **Origen (SDC/Memo)** y barra **Flujo de la compra** de 7 pasos (SDC/Memo → CDP → Publicada → Adjudicación → OC → Guía/factura → Recepción parcial/total).
- Nueva tarjeta **Pedido (SDC) vs orden de compra**: por producto pedido / comprado / recibido / falta comprar / falta recibir; avisa si "se compró la totalidad". Emparejamiento pedido↔OC: descripción igual → mismo orden → mayor parecido (≥0,5).
- Pendiente: lista de pedido de la SDC con sus propias cantidades distintas al ítem de la compra; alerta cuando la OC trae menos de lo pedido; enlazar recepción con el cuadre de sobregiro.

### 4.20 Memos, cuadro de distribución, presupuesto CDP y entregas por centro (v20.55)
- **Memos**: la OC trae `MEMO N°36-68-5 - …` (a veces en la 2.ª hoja). El lector guarda la lista `memos` (36, 68, 5) y se muestra en la OC.
- **Cuadro de distribución (PDF)**: segundo archivo opcional al ingresar la OC. Lee por posición cada columna (memo, centro, financiamiento, N° de CDP, neto/IVA/total, dirección de despacho, contraparte, contacto, correo, horario) y la cantidad de cada producto por columna; cruza con las líneas de la OC por código MP (o por parecido de descripción) y avisa si algo no cuadra. Las celdas combinadas (p. ej. dos memos de un mismo centro) se heredan. Manda sobre el cuadro de la compra ágil.
- **Presupuesto CDP (opcional)**: colección `CDP_Presupuesto` (categoría y/o N° de CDP + monto inicial). Lo comprometido **se calcula** desde las órdenes (total con IVA de cada columna), por N° de CDP o, si no hay, por la categoría de financiamiento: no se descuenta doble si la orden se corrige o se reingresa. Al ingresar una orden avisa si algún CDP/categoría quedaría sobregirado (se puede continuar).
- **Entregas por centro**: cada línea guarda `recibido`, `ingresado` (a stock) y `entregado` por columna. La recepción permite ingresar a stock de Bodega Central **cualquier columna** (así lo de otros centros se descuenta al entregarlo). Desde la OC, "Generar acta" arma el acta del centro con lo que está en bodega y aún no se entrega: mismo documento de siempre, descuenta FEFO, usa el sobregiro si falta respaldo, deja `oc` (OC, memo, CDP) en el acta y un evento en la bitácora. Se valida en la transacción que no se entregue más de lo ingresado; anular el acta devuelve stock y pendiente. Estados por columna: Aún no llega · En bodega · Entrega parcial · Entregado completo.
- Pendiente: que la entrega de una columna sin ingreso a stock (despacho directo del proveedor al centro) cierre sola con la guía; avisar cuando llega menos de lo pedido.

### 4.21 Actas con pestañas y sección Auditoría (v20.62)
- **Actas de entrega** se divide en tres pestañas, con el mismo estilo de la barra superior: *Emitir acta* (el formulario de siempre), *Actas emitidas* (historial con PDF/Word/Anular) y *Seguimiento de acta* (búsqueda por ID).
- **Saldos contables y disponibles** salen de Actas y pasan a una sección propia de la barra lateral, **Auditoría** (grupo Movimientos), con el mismo bloqueo por rol que Actas (el enfermero no la ve). Datos y cuadre de sobregiro no cambian.
- Los documentos (actas, informes) no se tocan.

### 4.22 Auditoría UX y primeros arreglos (v20.63)
- Agente `ux-ui-flujo` (`.claude/agents/`) y `tools/auditoria-ux.js` (solapes, recortes, objetivos < 28 px; ignora campos dentro de `<details>` cerrados).
- **Toma de inventario**: la cabecera deja visibles solo Exportar + dos menús (*Google Sheets ▾* y *Más ▾*, con Limpiar sesión al final y en rojo); los IDs de los botones no cambian. El panel del formulario deja de quedar cortado en pantallas bajas (sticky solo si caben 800 px de alto). Menú y título se llaman igual: *Toma de Inventario*.
- Objetivos táctiles ≥ 40 px en enlaces de pie del Panel, "+ Nueva categoría", búsqueda y selectores; el recuadro del escáner enfoca el campo al hacer clic.
- Pendiente (auditoría): reordenar el formulario de toma, ubicaciones desde `Bodegas`, unificar pestañas del Inventario semanal, mover "Cerrar inventario", una sola primaria en Ingresos, modal de cuadre en Auditoría.

### 4.23 Recepción de mercadería solo SAR (v20.64)
- **Alcance**: del cuadro de distribución solo importa la columna **SAR**; las demás (p. ej. Nehuén) se omiten y la OC guarda solo la lista `otrosCentros` (centro y memo) como referencia. Las líneas de otros centros quedan en la OC sin cantidad para SAR.
- **Lector**: nueva variante B del cuadro (memo y CDP en el encabezado de la columna, código MP entre paréntesis, pie con NETO/IVA/TOTAL/PRESUPUESTO/SALDO). Presupuesto y saldo se leen y guardan en la columna, **sin descontar** todavía (el CDP se trabaja más adelante). Probado con la OC 1298355-911-CM26: 22 líneas SAR, sin avisos.
- **Flujo**: llega la OC → se ingresa con su cuadro → al llegar el camión, **Recibir mercadería** (lista de pendientes con ✔ por línea, *Recepción total*, cantidades parciales, guía, lote y vencimiento, incidencias) → lo recibido entra al stock de Bodega Central → las actas de entrega descuentan desde ahí. Lo no recibido queda pendiente y se baja con **Pendientes (CSV)**.
- Pendiente: vista "por recibir" en Existencias, adjuntar el archivo de la guía/factura.

### 4.24 v20.65 — Recepción de OC: ficha y validaciones
- Modal de recepción ancho, acciones fijas abajo, tarjetas en móvil; "Guardar recepción" con confirmación en dos pasos si hay avisos (producto nuevo, sin vencimiento, guía repetida).
- Bloqueo duro: cantidad entera y sin superar lo pendiente (también dentro de la transacción); vencimiento pasado rechazado.
- Ficha: banner "siguiente paso", datos/memos plegables, líneas sin SAR ocultas, aviso de otros centros; entregas solo si hay otros centros.
- Aceptación implícita si ya se recibió mercadería; totales acotados por línea; correo se envía después de guardar; cerrar con pendientes advierte las unidades.
- Insumos nuevos llevan name_lowercase; se guarda ultimaGuia (prefill en Recepción conforme); al ingresar una OC desde PDF se abre su ficha.
- Pendiente: descuento de CDP/presupuesto, "por recibir" en Existencias, adjuntar guía, anular recepción, multi-lote por línea, actas ligadas a OC.


### 4.25 v20.66 — Ajustes tras la prueba de recepción (video del usuario)
- Seguimiento de OC: buscador de órdenes en la lista; el título de la ruta superior vuelve a la lista cuando hay una ficha abierta.
- Menú lateral: queda un solo botón de expandir/contraer (el del menú); ya no tapa el texto "ERP MÉDICO • RED ASISTENCIAL".
- La aceptación del proveedor es opcional: el banner lleva directo a "Recibir mercadería"; "Registrar aceptación" queda en un solo lugar.
- Avisos de confirmación (cerrar seguimiento, emitir acta, presupuesto) con ventana centrada de la identidad visual (sin window.confirm).
- Recibir mercadería: lote y vencimiento son opcionales (casilla "Anotar lote y vencimiento ahora"); la hora de llegada la pone el sistema; cada recepción tiene ID propio `REC-<orden>-NN` (evento, historial y texto).
- Recepción conforme: archivo `RC_<orden>.pdf`; Total/Parcial viene preseleccionado según lo pendiente.
- Pendiente: editar lote/vencimiento después del ingreso, reportar REC-ID en Auditoría, destinatarios fijos (compras, M. Quintanilla, M. Bustos) cargados en la lista de la orden.

### 4.26 v20.67 — Correos de recepción, lotes posteriores y ID en Auditoría
- Correo de cada recepción: siempre a mariel.quintanilla@, compras.sar@ y matias.bustos@ (cormumel.cl). Recepción conforme: Para paulina.carrasco@; Cc daniela.medina@, carolina.ortiz@, nadia.sanchez@, sar.melipilla@, matias.bustos@.
- Botón "Lotes y vencimientos" en la ficha: completa lote/vencimiento de lo ingresado sin ellos (parcial o total); mueve unidades del lote "S/L" al nuevo en el stock y deja un evento LOTE en la bitácora.
- Cada recepción guarda `recepciones[{recId, fecha, hora, guia, unidades, usuario, detalle}]` en la orden; Auditoría muestra "Recepciones de mercadería" con buscador por REC-ID, orden o guía.

### 4.27 v20.68 — Ficha de la orden por etapas
- El estado de plazo (chip rojo/verde) va dentro de la tarjeta de fechas, no suelto en el encabezado.
- Un solo botón "Recibir mercadería": vive en el banner "Siguiente paso". "Lotes y vencimientos" y "Descargar pendientes" aparecen recién cuando ya se recibió algo; "Recepción conforme" aparece en el banner (parcial si falta mercadería, normal si está todo).
- La sección "Destinatarios del correo" sale de la ficha; los destinatarios fijos (recepción y recepción conforme) se muestran en "Configurar correo".

### 4.28 v20.69 — Cabecera de la orden, lista y recibir mercadería
- Tarjeta "Plazo de la orden": estado (chip) arriba a la derecha dentro del recuadro, fechas en rejilla pareja, "Registrar aceptación" como enlace discreto (aceptación opcional).
- Lista de órdenes: tarjetas de 340 px mínimo; el chip de plazo baja bajo el número y ya no se sale de la tarjeta.
- "Pedido y recibido" es plegable (cerrado por defecto; recuerda lo que eliges) y muestra las unidades recibidas en el título.
- "Recibir mercadería" abre al instante: el inventario y la bodega se leen en segundo plano; si algo falla se muestra un aviso en vez de quedar mudo.
- Pendiente de diseño: guardar productos y proveedores de cada OC en un catálogo propio (con foto por ID de producto).

### 4.29 v20.70 — Pulido UX de la ficha (revisión del agente ux-ui-flujo)
- "Registrar aceptación" pasa al banner como botón secundario (la tarjeta de plazo queda pareja); pie administrativo separado con "Cerrar seguimiento" a la derecha; títulos de tarjeta en azul de marca; "Registrar nota" más discreto; radios con --shape-card.

### 4.30 v20.71 — Bodega de destino en la recepción
- "Recibir mercadería" pide la bodega de destino (por defecto Bodega Central, listada primero); el stock, el historial y el evento guardan esa bodega y la lista de productos corresponde a ella.
- "Lotes y vencimientos" respeta la bodega de cada ingreso (las recepciones anteriores cuentan como Bodega Central).

### 4.31 v20.72 — Fase "órdenes de compra": accesos rápidos, bodega nueva al recibir, lo clínico oculto
- Recibir mercadería: botón "+ Nueva bodega" (solo admin) crea la bodega en la misma colección que la sección Bodegas; los estantes/ubicaciones se asignan después desde Bodegas (por ahora solo la bodega transitoria los usa).
- Flujo acordado: crear/elegir bodega → recibir mercadería → recepción conforme → en Existencias ubicar los productos en la bodega asignada.
- Accesos rápidos con nombre explícito (menú "Accesos" y bloque en Inicio): Ingresar orden de compra (PDF), Seguimiento de órdenes, Bodegas, Actas de entrega.
- (Corregido en 4.32: lo clínico no se oculta como sección; queda sin datos.)

### 4.32 v20.73 — Fase "órdenes de compra": secciones visibles pero sin datos de prueba
- Las secciones (indicadores, urgencias, precaución, flujo semanal, Bandejas de Turno) y el menú vuelven a estar; lo que no aparece es la información de prueba.
- Interruptor `FASE_SOLO_OC` (script.js, true): las lecturas de Firestore filtran los Insumos sin `origenOC:true` y todas las Bandejas_Turno. No se borra nada.
- Cada recepción de OC marca el insumo con `origenOC:true`; desde ahí aparece en Existencias, Inicio y demás. Para ver todo otra vez: `FASE_SOLO_OC = false`.
- Los movimientos del Historial no se filtran.

### 4.33 v20.74 — Avance de la recepción e informes
- Al guardar una recepción se muestra un panel de avance (validando → buscando productos → guardando y subiendo unidades al stock → correo) y al final un aviso "Recepción cargada" con el ID, las unidades y la bodega.
- La recepción queda registrada en la orden (`recepciones[]` con bodega, productos, lote y vencimiento), en Auditoría y en los informes contable y disponible: ahora incluyen todo el stock (no solo lo con sobregiro) y una sección "Recepciones de orden de compra".

### 4.34 Archivos de la orden y envío opcional de la recepción conforme (v20.75)
- Cada archivo cargado en una orden (PDF de la OC, cuadro de distribución, guía de despacho, acta y guía/factura de la recepción conforme) se guarda en `Seguimiento_OC/{id}/Archivos` (contenido en `Partes`, trozos de ~700 KB; máx. 8 MB). Se listan en la ficha ("Archivos de la orden") y se pueden abrir cuando se necesite. No se modifican; solo un administrador puede borrar. Requiere desplegar `firestore.rules`.
- Recepción conforme: casilla "Enviar correo a la lista" siempre marcada por defecto; si se desmarca, el acta se emite y se guarda sin enviar correo.
- Los datos viven en Firestore: los despliegues del sitio (hosting) no los tocan. BigQuery no es necesario por ahora; una copia periódica de Firestore queda como opción.

### 4.35 Catálogo de productos (v20.76)
- Colección `Catalogo_Productos` (clave: código Mercado Público, o la descripción). Se alimenta sola al ingresar cada orden (descripción, código, proveedor, última OC, neto) y aprende el nombre de inventario usado al recibir; en la recepción ese nombre se autocompleta y se sugiere en la lista.
- Botón "Catálogo de productos" en Seguimiento de órdenes: búsqueda y foto opcional por producto (reducida a ~220 px y guardada en el propio documento).
- Notas, incidencias y recepciones siguen quedando en la bitácora inmutable de la orden (`Eventos`) y en `incidencias`/`recepciones`.

### 4.36 Acta de recepción conforme según modelo y bodegas en Actas (v20.77)
- El PDF reproduce el modelo "Recepción conforme producto o servicio (parcial)" de la Corporación: logo Corpo, datos del proveedor (nombre, RUT, OC), fecha, caja "Que se recibió conforme en forma PARCIAL/TOTAL…" con viñetas "DESCRIPCIÓN (CANTIDAD: n)", línea de firma y "Nombre Contraparte Técnica: Mariel Quintanilla L." (editable). Archivo: `RC<N° orden>.pdf`.
- Actas de entrega: la lista de bodegas de origen incluye las fichas de Bodegas más toda bodega con stock y la Central, para que lo recibido siempre se pueda entregar.

### 4.37 Acta de entrega según el modelo del 03-11-2026 (v20.78)
- Cada producto entregado dice "— Entregado: N unidades con fecha del dd/mm/aa". El archivo se llama "ACTA DE ENTREGA - <BODEGA DE ORIGEN> - dd-mm-aaaa".
- Si el acta se emite desde una orden de compra, el PDF queda guardado además en "Archivos de la orden".

### 4.38 Nombre de la bodega editable (v20.79)
- La bodega activa existente no tenía nombre (se veía "S/I" y no aparecía en Actas ni en la tabla de stock). En la ficha de cada bodega, el administrador puede poner/cambiar el nombre (por defecto propone "Bodega Central"); si cambia, el stock que figuraba con el nombre anterior pasa al nuevo. Las bodegas sin nombre se muestran como "Sin nombre".
- "Stock Local por Sucursal" pasa a "Stock Local por Bodega".

### 4.39 Pendientes en el acta de entrega desde una orden (v20.80)
- Modelo ANIDES (16-10-2026): si una línea se entrega solo en parte, el acta dice "— Solicitado: S | Entregado: E | Pendiente: P" (E acumulado de la orden para ese centro). Lo solicitado que no entra en el acta (no llegó o no se entrega ahora) se agrega solo a "PRODUCTOS SOLICITADOS QUE AÚN NO LLEGAN (pendientes de entrega)" con su cantidad pendiente.

### 4.40 Recepción conforme con firma y timbre, modal de bodega y centros guardados (v20.82)
- El acta de recepción conforme lleva la firma y timbre de la contraparte técnica (Mariel Quintanilla L.) tomados del modelo vigente (`assets/firma-contraparte-mariel.png`); solo se incluye si la contraparte es ella y la casilla está marcada. Texto "Que se recibió conforme en forma Parcial/Total de los productos…" y "(CANTIDAD:n)" como en el modelo RC128355-684-AG26.
- Ficha de bodega: modal ancho en dos columnas (datos a la izquierda, estantes a la derecha) con scroll.
- Actas de entrega: lista de centros = base + centros guardados (`Centros_Entrega`) + centros de actas anteriores; botón "+ Guardar este centro" y guardado automático al emitir. Requiere desplegar `firestore.rules`.

### 4.41 Agregar archivos a una orden y regenerar la recepción conforme (v20.84)
- "Archivos de la orden" tiene "Agregar archivo" (orden de compra, cuadro, guía, factura, etc.) para documentos cargados antes de existir esta función.
- "Regenerar recepción conforme (modelo vigente)" rehace el acta de una recepción ya registrada con el modelo actual (firma y timbre incluidos), la descarga y la guarda como `RC<orden>.pdf`; la versión anterior queda en los archivos y el evento queda en la bitácora.

### 4.42 Fotos de productos desde Mercado Público (v20.85)
- El código entre paréntesis de cada producto del cuadro de distribución (p. ej. "(4540135)") se busca en la tienda de Convenio Marco (`/aseo3/catalogsearch/result/?q=<código>`): la página del producto trae la foto (og:image). El archivo de la foto NO es el código (4540135 → 4/5/4540128.jpg), por eso se guarda el archivo en `Catalogo_Productos.imagenMP`; la imagen se muestra directo desde la tienda.
- `assets/imagenes-mp.json` trae las 23 fotos del cuadro 1298355-911-CM26 ya resueltas. Para códigos nuevos el Apps Script (acción `imagenes`, hay que volver a pegarlo) consulta la tienda; sin eso, la foto se puede subir a mano en el catálogo.
- La foto aparece en Catálogo de productos, Recibir mercadería, Actas de entrega (stock) y Existencias, asociada por código o por nombre. Una foto subida a mano tiene prioridad sobre la de la tienda.
- Limitación: la búsqueda automática solo usa la tienda "aseo3"; para otras (p. ej. útiles de oficina) hay que agregarlas en `TIENDAS` del script.

### 4.43 Fotos ampliables, más pantallas con foto y Catálogo de Insumos real (v20.86)
- Clic en cualquier foto de producto la abre ampliada (Esc o clic fuera cierra). Aplica a Existencias, catálogo, recepción, actas y bodegas.
- Fotos también en "Pedido y recibido", "Entregar" (OC) y Stock Local por Bodega.
- Códigos nuevos sin Apps Script: se prueban los nombres de archivo habituales (código−7, con o sin `_1`) cargando la imagen; si ninguno existe queda sin foto. Los 23 códigos conocidos siguen este patrón.
- "Catálogo de Insumos" (menú Compras) deja de mostrar datos de ejemplo: lista Catalogo_Productos con foto, código MP, proveedor y stock por bodega (`catalogo-vista.js`). Los KPI cuentan productos, con stock y sin stock.

### 4.44 Acta de prueba y eliminar acta (v20.87)
- Actas de entrega → "Probar el formato": genera PDF o Word con los productos elegidos (y los pendientes/solicitado de la OC si corresponde) para compararlo con el modelo. N° `PRUEBA-…`; NO descuenta stock, no toca la orden ni el correlativo. Queda en Historial_Movimientos como `ACTA_PRUEBA` (sin efecto en stock) para los informes contable y disponible.
- "Eliminar acta" (antes "Anular", solo administrador): devuelve el stock a la bodega de origen, vuelve lo entregado a pendiente en la OC, borra el archivo del acta en los archivos de la orden y deja el registro `ANULACION_ACTA` en el historial. El acta queda marcada ANULADA (no se borra el registro, por trazabilidad).

### 4.45 Lector de órdenes: formato "compra ágil" y Excel (v20.88)
- La orden de compra de compra ágil (N° …-AG26) trae la cantidad como "124 Unidad", el encabezado "Cantidad / Unidad", sin pie "Orden de Compra…" y con notas "PRESUPUESTO MÁXIMO/DISPONIBLE" y "*EL PROVEEDOR DEBE AJUSTARSE…" dentro de la especificación: el lector ya las entiende y recorta esas notas de la descripción. El código de la 1.ª columna es el rubro (41115830 para todos), no un ID de producto: NO se usa como código MP (sin ID no hay foto automática).
- El cuadro de distribución puede venir en Excel (`extraerDistribucionExcel`): memos/CDP en el encabezado; si un centro trae varias columnas con el mismo memo (SAR 3565 y 3568) se juntan en una sola (clave `centro-memo`, CDP "3565-3568", montos sumados). Lee NETO/IVA/TOTAL/PRESUPUESTO/SALDO del pie.
- La orden también puede subirse en Excel (lectura genérica, con aviso de revisar). Los dos recuadros aceptan PDF o Excel y se acomodan solos si el archivo está en el recuadro equivocado. Si el archivo es una recepción conforme, guía o factura, el mensaje lo dice.
- Para que el lector aprenda otras variaciones: enviar el archivo y se agrega como caso al lector (no hay aprendizaje automático).

### 4.46 Foto de productos sin ID de Mercado Público (v20.89)
- Compras ágiles y otros productos sin ID: en el Catálogo de productos cada fila tiene "Buscar foto" (abre Google Imágenes con el nombre), "Pegar" (imagen copiada con clic derecho → Copiar imagen; se reduce y se guarda en el producto) y "Subir". No hay búsqueda automática por nombre: requeriría un servicio de búsqueda con clave.

### 4.47 Ajustes móviles tras revisión UX/UI (v20.90)
- Tabla de revisión de "Ingresar orden" apilada en teléfono; catálogo de productos con botones a todo el ancho (y sin "Pegar" en pantallas táctiles); recepción con Pedido/Recibido/Pendiente en una fila; pestañas de actas con scroll horizontal; botones táctiles ≥44 px; Eliminar acta separado en rojo; `accept` de Excel con tipos MIME para el selector del teléfono; modal con `90dvh`.

### 4.48 Fotos de la tienda: se confirman antes de usarse (v20.91)
- Una foto de Mercado Público solo se muestra si está **confirmada**. Las de la tabla `assets/imagenes-mp.json` (verificadas contra la tienda) entran confirmadas; las que obtiene el Apps Script o las que se "suponen" por el nombre de archivo quedan `por_confirmar` y NO se ven en ninguna pantalla.
- Si la descripción ya existe en el catálogo con otro código, el producto nuevo queda con `avisoCodigo` y su foto `por_confirmar`; además la búsqueda por nombre nunca devuelve la foto de un producto con otro código.
- Catálogo de productos → "Fotos por confirmar": muestra el candidato, enlace a la tienda ("Ver en la tienda") y los botones "Es este producto" / "No es" (descartada). Queda quién confirmó (`confirmadaPor`).

### 4.49 Avance con la marca, foto candidata en la orden y totales coherentes (v20.92)
- `progreso.js` (`SAR_Progreso`): una sola animación con el logo SAR (anillo que gira, pasos, ✔ final y aviso al costado) para ingresar orden, recepción, emitir/eliminar acta, acta de prueba, regenerar recepción conforme y actualizar catálogo. Toda carga, guardado o modificación nueva debe usarla.
- En "Pedido y recibido" (y en las tablas de la orden) la foto aparece aunque esté por confirmar: con borde punteado y "?" (título "Foto por confirmar"); al ampliarla avisa que falta confirmar. En el resto del sistema solo se ven las confirmadas.
- Cuadro de distribución: IVA y total de cada columna se verifican (IVA = 19 % del neto, total = neto + IVA); si lo leído no cuadra (celdas pegadas, p. ej. $138.623.686.281) se corrige y se avisa.

### 4.50 Editar actas ya emitidas y recepción conforme (v20.93)
- Actas de entrega → Actas emitidas → **Editar** (administrador): cambia centro, fecha, productos y cantidades (quitar/agregar de la bodega de origen), pendientes, documentos y firmas. En una transacción deshace lo entregado antes (lotes, sobregiro, lo entregado de la OC) y aplica lo nuevo; deja `EDICION_ACTA` en el historial (informes contable/disponible), rehace el PDF y reemplaza el archivo de la orden. `firestore.rules` permite al administrador actualizar actas EMITIDA→EMITIDA.
- Actas de oxígeno: Editar permite quitar balones (vuelven a SAR como llenos), agregar balones llenos o cambiar la serie, y cambiar centro/documentos/firmas; cada balón deja su evento.
- Recepción conforme: botón **Editar recepción conforme** (fecha, guía/factura y N°, contraparte, quien recibe, parcial, observaciones); rehace el acta y reemplaza el archivo. Productos y cantidades siguen lo recibido en la orden.
- Catálogo de Insumos: los productos con recepción pendiente llevan "Pendiente de recepción: N un. (OC …) · aún no está en stock".

### 4.51 Órdenes históricas y auditoría de ediciones (v20.94)
- Al ingresar una orden, la casilla **Orden histórica** la carga solo para trazabilidad: queda cerrada, con lo pedido marcado como recibido en la fecha indicada, con orden, cuadro, recepción conforme y acta de entrega adjuntos, y **no mueve stock** (ese stock ya se consumió o se cuenta en la toma de inventario). Evento ESTADO "Orden HISTÓRICA".
- Toda edición de acta de entrega/oxígeno pasa por la misma transacción que la emisión: lo quitado vuelve a bodega/lotes, lo agregado descuenta con FEFO y, si falta, queda como sobregiro visible; el movimiento EDICION_ACTA entra a los informes contable/disponible y al seguimiento del acta.
- Animación del logo (SAR_Progreso) también en entrega y acciones de oxígeno.

- v20.95: botón "Cargar productos y fotos" también en Catálogo de Insumos; la etiqueta "Pendiente de recepción" reconoce la columna SAR por nombre.

- v20.96: el script de Apps Script descubre solo las tiendas de Convenio Marco y busca el código en todas (antes solo aseo3); recuerda resultados 6 h.

- v20.97: botón "Buscar fotos de esta orden" en Pedido y recibido.

### 4.52 Correo de recepción conforme según el modelo real y diagnóstico de fotos (v20.98)
- Correo tipo (copiado del enviado por Compras SAR): asunto `RC<N° de orden>`; cuerpo "Estimada: / Espero se encuentre bien. Adjunto RC<N° de orden> de <PROVEEDOR> / Saludos Cordiales. / <nombre>."; firma HTML con logo SAR, "Compras SAR · Analista de compras y adquisiciones · Real audiencia #980, Melipilla · 2 2568 8652 · www.corpomelipilla.cl". Adjuntos: acta `RC<N° de orden>.pdf` y la guía/factura. Para: Paulina Carrasco; Cc: lista base (configurable).
- Apps Script: remitente visible "Compras SAR" y Responder-a compras.sar@cormumel.cl. El envío sale de la cuenta donde corre el script (hoy datosgestionsaraera@gmail.com); para que salga desde compras.sar@cormumel.cl el script debe correr en esa cuenta (requiere que TI de la Corporación permita scripts propios) o configurarse como alias "Enviar como".
- "Buscar fotos de esta orden" explica el resultado: productos sin código, ya con foto, encontrados, y por qué no se encontró (tienda, clave o conexión).

### 4.53 Bitácora de la orden con comentarios, etapa y archivos (v20.99)
- La bitácora de cada orden (también cerradas o históricas) admite comentarios con fecha, hora y autor, etapa opcional (en proceso, despachada…), y archivos adjuntos que se abren desde el propio comentario.
- "Agregar archivo" acepta un comentario y deja un evento "Archivo" en la bitácora. Todo es inmutable.
- El envío de correo en los comentarios queda desmarcado por defecto; el correo automático sigue pendiente por decisión del usuario.
