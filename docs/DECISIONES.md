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

### 4.54 PENDIENTE para la próxima fase: insumos sin orden, ID de producto y actas con pendientes (pedido 05-11-2026)
Registrado para retomarlo cuando haya sistema; aún NO implementado.
1. **Insumo no existente en el catálogo (al crear un acta):** si el usuario ingresa un insumo que no viene de ninguna orden, el sistema guarda su nombre en el catálogo para futuras coincidencias/referencias y pide en ese momento el **ID del producto** (Mercado Público; después sirve para asociar la foto).
2. **Productos ingresados a mano ("sin respaldo"):** deben quedar en una lista para poder **asociarlos después a una orden de compra**. Lo mismo para las actas con productos pendientes (sea un producto ya en el sistema o uno nuevo que no estaba).
3. **Stock al agregar un producto al acta:** el sistema pregunta cuánto se agrega: stock total (ej. 30), cantidad entregada, y el **pendiente** se toma de la diferencia. El acta queda con la subdivisión entregado/pendiente y se hace la cuadratura completa ya acordada (stock, contable/disponible, auditoría).
4. **Buscador de productos en el acta:** cada resultado muestra **disponible, descripción completa, fotografía e ID**.
5. **El ID del producto debe mostrarse en todos los lugares donde aparece un producto** (existencias, actas, recepción, catálogo, toma de inventario, ¿Dónde está?, etc.).

### 4.55 Implementado (v21.00): ID de producto, insumos sin orden y pedido/pendiente en actas
- El ID del producto (código Mercado Público) se guarda en cada insumo (`codigoMP`) y se muestra en el buscador del acta (con foto y disponible), en el acta, en Pedido y recibido/Recibir/Entregar de las órdenes, en Existencias y en los informes contable/disponible (columna "ID producto"). El buscador del acta también busca por ID.
- Ingreso manual en un acta: pide nombre (con sugerencias del catálogo) e ID; si falta el ID pregunta antes de seguir. Al emitir, el nombre y el ID quedan en el catálogo (`sinOrden`, origen MANUAL) y el insumo provisional lleva el ID.
- Al recibir una orden, si ya existe un insumo con ese ID (p. ej. el ingresado a mano) se suma a ese mismo insumo y se cuadra el sobregiro.
- Acta: cada producto admite "Pedido" (total solicitado) y "Entregar"; la diferencia queda como pendiente y el acta muestra "Solicitado | Entregado | Pendiente" (modelo ANIDES).

### 4.56 Animación en bodegas y "Asignar ID" en informes (v21.01)
- Guardar nombre y configuración de bodegas, y cuadrar un insumo, usan la animación única de avance.
- En el informe contable/disponible, los insumos provisionales sin ID tienen "Asignar ID": guarda el ID en el insumo y en el catálogo; al recibir la orden con ese ID se suman al mismo insumo.

### 4.57 Toda pantalla que carga muestra la animación de la marca (v21.02)
- `SAR_Progreso.cargando(texto)` pinta el logo SAR con anillo girando dentro de la pantalla mientras carga. Reemplaza los textos "Cargando…" sueltos (actas, oxígeno, informes, órdenes, compras ágiles, bodegas, catálogo). Toda pantalla nueva que cargue datos debe usarlo.
- Actas de entrega carga catálogo, bodegas, centros e historial en paralelo para abrir más rápido.

### 4.58 Anular una recepción de mercadería (v21.03)
- Solo administradores. En la ficha de la orden, "Recepciones registradas" → Anular (pide motivo). Lo recibido vuelve a "por recibir", se retira del stock lo que ingresó (primero el lote registrado, luego S/L, luego FEFO inverso) y queda en la bitácora ("Recepción anulada"), en el historial (ANULACION_RECEPCION) y en el informe de recepciones con estado ANULADA.
- Se bloquea si ese stock ya se usó (actas de entrega u otros movimientos): primero se eliminan esas actas. La recepción conforme ya emitida no cambia sola: se edita o regenera aparte.
- Las recepciones anteriores al registro detallado (sin detalle por línea en la bitácora) no se pueden anular automáticamente.

### 4.59 Ingreso rápido de inventario (v21.04)
- Nueva pantalla "Ingreso rápido" (Inventario): se elige o crea una bodega (p. ej. el camión), se pega la lista (Excel/texto, o lo que se lea de una fotografía) o se escribe en una tabla editable y se confirma. Cada producto entra con ID, lote y vencimiento, queda en el historial (INGRESO_INVENTARIO, "Inventario inicial") y se ve en todo el sistema (origenOC). El nombre y el ID quedan en el catálogo.
- Reemplaza para este uso a la "Carga masiva (Excel)" antigua, cuyos insumos no se muestran en la fase actual y no llevan ID ni lotes.
- Las fotografías de productos se leen en la conversación (Claude) y se vuelcan a esta pantalla; leer fotos directamente desde el sitio requiere una clave de API y queda para más adelante.

### 4.60 Ingreso rápido leyendo fotografías (v21.06)
- "Leer desde fotos" en Ingreso rápido: la app reduce las fotos y las envía al Apps Script (acción `foto`), que las lee con la API de Claude y devuelve nombre, código del fabricante (ART), lote, vencimiento (nunca la fecha de fabricación/esterilización), contenido, cajas visibles y dudas. Los productos quedan en la tabla editable para revisar antes de ingresar; las dudas se muestran sobre cada fila.
- La clave de la API (`ANTHROPIC_API_KEY`) se guarda solo en Propiedades de la secuencia de comandos del Apps Script; nunca en el repositorio ni en el sitio. La cantidad es una sugerencia (cajas visibles): siempre se confirma.

### 4.61 Productos que ya están en bodega pero llegaron con una orden (v21.06)
- El Ingreso rápido es donde esos productos entran al stock del centro. Tiene un campo opcional "N° de orden de compra de origen" que queda en el historial y en el insumo (`ultimaOC`).
- Para no contar el stock dos veces, en esa orden la recepción se registra SIN marcar "Ingresar al stock" (queda como "Recibido, sin ingresar a stock").

### 4.62 Foto por descripción cuando el producto no tiene ID (v21.07)
- Si una línea de la orden no trae código, "Buscar fotos de esta orden" pide al Apps Script (acción `porDescripcion`) buscar la descripción en todas las tiendas de Convenio Marco y elegir el resultado más parecido (mínimo 60 % de las palabras clave). La foto queda SIEMPRE "por confirmar" y se guarda el título hallado (`fotoTitulo`) para compararlo.

### 4.63 Avance por producto al buscar fotos (v21.08)
- "Buscar fotos de esta orden" muestra una línea por producto (N de M, descripción y resultado: encontrada / por descripción / ya tenía / sin foto).

### 4.64 Tiendas de Convenio Marco en el script (v21.09)
- El script solo buscaba en `aseo3` (la portada no publica las tiendas), por eso las fotos de insumos médicos no aparecían. Ahora usa lista fija: `insumos2` (Insumos y Dispositivos Médicos), `aseo3` y `escritorio3`. Los glucómetros/tiras Accu-Chek no están en esas tiendas: su foto va a mano.

### 4.65 Pendientes por entregar y aviso en la campana (v21.10)
- Pantalla "Pendientes por entregar" (menú, junto a Actas): por centro, lo pedido y aún no entregado según las actas (pedido − entregado; las actas anuladas no cuentan; entregas posteriores lo descuentan), con el stock disponible y estado (completo / parcial / sin stock).
- Botón "Preparar acta con lo disponible": abre Actas de entrega con el centro y los productos ya cargados (cantidad = lo que hay en stock, pedido = lo pendiente).
- La campana muestra un número cuando hay stock para entregar algo pendiente (se revisa al abrir la app y cada 10 min); al pulsarla lista los centros.
- Todo producto ingresado a mano en un acta queda en el Catálogo de productos (antes solo si era nuevo en la bodega).

### 4.66 Pendientes por entregar: vista condensada e impresión (v21.11)
- Una fila por centro (pendientes y si hay stock para entregar); al pulsar se abre el listado de ese centro. Botón "Imprimir listado con fotos" (todos los centros, una hoja por centro) o "Imprimir este centro". El encabezado del documento lleva el logo de la Corporación.
- Se quitó de esta pantalla el botón "Preparar acta"; generar el acta desde aquí queda pendiente (la función `precargar` sigue en actas-entrega.js).

### 4.67 Hoja de picking, fotos pendientes e ID desde el acta (v21.12)
- Pendientes por entregar: "Hoja de picking" (por centro o de todos): casilla, foto, producto/ID, dónde está (bodega y estante), lote que vence primero, cantidad a retirar y pendiente; abajo, lo que no tiene stock. Solo se retira lo que hay (mín. entre pendiente y disponible).
- "Buscar fotos que faltan": busca por ID (o por descripción si no hay ID) las fotos de los productos pendientes sin foto y las deja "por confirmar" en el catálogo.
- En un acta, un producto del stock sin ID muestra un campo para escribirlo; al emitir, el ID queda en el insumo y en el catálogo, y desde ahí se busca la foto.

### 4.68 Foto por descripción al emitir un acta (v21.13)
- Al emitir un acta, los productos sin foto se buscan en segundo plano (por ID; si no hay ID, por la descripción en las tiendas de Convenio Marco) y quedan "por confirmar" en el catálogo. No se asigna ID automáticamente: el número que muestra la tienda puede no coincidir con el ID de la orden (sin verificar), por eso el ID lo escribe el usuario.

### 4.69 Impresión más compacta (v21.14)
- Hoja de picking y listado de pendientes: los centros ya no empiezan cada uno en una hoja nueva (quedaban hojas casi vacías); se siguen uno tras otro separados por una línea, con fotos y espaciado más pequeños. Una fila nunca se corta entre dos hojas.

### 4.70 Búsqueda por ID en todos los buscadores y foto desde el acta (v21.15)
- `id-producto.js` une por nombre el ID de insumos y catálogo: Existencias, Ajuste de stock, Historial, Toma de inventario y ¿Dónde está? ahora encuentran un producto escribiendo su ID (Catálogo y Actas ya lo hacían).
- En cada producto del acta que aún no tiene foto, un desplegable "Agregar foto del producto" permite cargarla (se reduce y se guarda en el catálogo al emitir).

### 4.71 Fotos de producto: WEBP y todos los formatos (v21.16)
- Los selectores de foto (acta, catálogo "Subir", Ingreso rápido) aceptan explícitamente WEBP, JPG, PNG, GIF, BMP y AVIF (la tienda de Convenio Marco entrega WEBP). Cualquier formato se reduce y se guarda como JPEG; se verificó que un WEBP se lee y convierte bien.

### 4.72 Foto en el formulario de ingreso manual del acta (v21.17)
- El formulario "¿No está en el sistema? Ingreso manual" tiene el botón "Cargar foto del producto (opcional)" (WEBP, JPG, PNG…): la foto se ve en miniatura, se agrega con el producto y queda en el catálogo al emitir. (Antes solo aparecía en la fila ya agregada.)

### 4.73 Aviso de versión nueva (v21.18)
- Si hay una versión publicada distinta de la que tiene abierta el navegador, aparece abajo el aviso "Hay una versión nueva del visor" con el botón Actualizar (se revisa cada 3 min y al volver a la pestaña). Motivo: el botón de foto del acta ya estaba desplegado pero la pantalla abierta seguía en la versión anterior.

### 4.74 Entrega 0 con pedido = pendiente del centro (v21.19)
- En el acta (ingreso manual o producto del stock) se puede poner cantidad a entregar 0 con un pedido mayor: el producto no mueve stock ni genera sobregiro, queda en la lista de pendientes del acta con su ID y aparece en "Pendientes por entregar" del centro. Su nombre/ID/foto se guardan en el catálogo.
- El acta debe llevar al menos un producto con cantidad a entregar mayor que 0 (un acta solo de pendientes queda para después si se necesita).

### 4.75 Ingreso manual no se cierra al cargar foto (v21.20)
- Al elegir o quitar la foto del producto manual en el acta, solo se actualiza la vista previa en el sitio; ya no se redibuja el acta, así que el apartado "Ingreso manual" queda abierto y con lo escrito.
- El estado abierto/cerrado del apartado se recuerda durante la edición del borrador.

### 4.76 Acta solo de pendientes (v21.21)
- Si el centro pidió un producto que aún no se recibe, se deja cantidad a entregar 0 con el pedido: el acta se puede emitir aunque TODOS los productos vayan en 0; no mueve stock y todo queda en "Pendientes por entregar" del centro (con nombre, ID y foto al catálogo).
- Sigue siendo obligatorio que cada línea tenga entrega mayor que 0, o 0 con pedido mayor que 0.

### 4.77 Pendientes coherentes con el stock (v21.22)
- Una línea con entrega 0 y pedido N no toca el stock ni crea el insumo: solo registra N como pendiente del centro. Cuando llega el producto y se ingresa, el stock sube normal y el pendiente sigue ahí hasta que una acta lo entregue.
- El pendiente se calcula solo a partir de las actas (pedido − entregado), nunca del stock, y el estado "Sin stock / Se pueden X / Completo" se obtiene cruzando con el stock actual: no hay doble descuento.
- Un producto se reconoce por ID o por nombre indistintamente: si el pendiente se dejó solo con nombre y la entrega posterior trae el ID (o al revés), se descuenta del mismo pendiente y no queda uno "fantasma".

### 4.78 Entrega 0 se muestra en "Productos pendientes de entrega" (v21.23)
- En el acta en preparación, un producto con entrega 0 y pedido mayor ya no figura en "Productos entregados": pasa a la sección "Productos pendientes de entrega" (que se abre sola y indica cuántos van sin stock), con los mismos campos editables (pedido, entrega, quitar). Si luego se pone una entrega mayor que 0, vuelve a "Productos entregados".
- El contador "Productos entregados (n)" cuenta solo los que realmente se entregan.

### 4.79 Entrega de un producto similar + Cuadre de sustituciones (v21.24)
- En cada producto del acta hay un campo interno "¿Entregas físicamente otro similar?". Si se completa, el acta, el PDF y el descuento del sistema siguen con el producto PEDIDO (el centro no ve el cambio); el producto realmente entregado queda guardado en el ítem como `entregaFisica {nombre, codigoMP}`.
- Nueva pantalla "Cuadre de sustituciones" (solo para quienes ven Actas): por producto muestra el ajuste físico vs sistema (+ el sistema ya descontó pero sigue físicamente; − salió físicamente pero el sistema lo sigue mostrando), y el detalle por acta, con "Marcar cuadrada / Deshacer". No modifica stock: el ajuste lo hace el usuario con las herramientas de ajuste y luego marca la sustitución.
- Las marcas de cuadre se guardan en Contadores/cuadre-sustituciones (colección ya permitida a staff; no hace falta desplegar reglas nuevas). Actas anuladas no cuentan.

### 4.80 Sugerencias con foto y revisión de productos parecidos (v21.25)
- Al escribir una o más letras (o parte del ID) en el nombre del ingreso manual, en "¿Entregas físicamente otro similar?" y en el nombre de pendientes, aparece una lista con el nombre sugerido, su ID y su fotografía. La fuente es el stock de la bodega de origen (incluye los provisionales) más el catálogo (incluye lo ingresado manualmente en actas anteriores). Basta que todas las palabras escritas estén en el nombre, en cualquier orden.
- Nueva pantalla "Revisar productos parecidos" (solo lectura): agrupa productos del stock de todas las bodegas y del catálogo con nombres casi iguales (diferencia de una letra, punto, espacio o acento; los números del nombre deben coincidir) o con el mismo ID y nombres distintos, y lista aparte los manuales aún provisionales. No unifica nada automáticamente: es para revisar uno a uno antes de cuadrar.

### 4.81 Agregar en la recepción un producto que el lector no leyó (v21.26)
- En "Recibir mercadería" hay un botón "Agregar producto": se escribe el producto (con sugerencias y foto), ID opcional, pedido según el documento (si se deja vacío, igual a lo que llega) y lo que llega ahora. La línea entra a la tabla de recepción y se completa como cualquier otra (producto en inventario, lote, vencimiento, incidencia).
- La línea se guarda en la orden solo al confirmar la recepción, marcada como `agregada` (con quién y cuándo), y el registro de la recepción indica "(agregado en la recepción)". Si el pedido es mayor que lo recibido, el resto queda pendiente de recibir. Si la orden fue modificada por otra persona mientras tanto, se pide reabrir la recepción para no desalinear las líneas.
- Mientras la orden no se recibe completa sigue en su estado de pendiente de recepción.

### 4.82 Agregar producto en la recepción: solo con el nombre (v21.28)
- "Agregar producto" exige únicamente el nombre. El producto entra a la tabla aunque no tenga pedido ni unidades; las unidades se digitan después en "Llega ahora" y, si no había pedido, esa cantidad pasa a ser su pedido (queda en la orden como producto agregado). Si se agrega y no se digitan unidades, al guardar se pide indicarlas o quitarlo.
- El producto agregado también se guarda en el catálogo (nombre/ID) aunque la recepción no ingrese al stock. Al agregar, el formulario se cierra y el cursor queda en "Llega ahora" del producto nuevo.

### 4.83 Recepción conforme por recepción (PDF/Word/edición) y avisos visibles (v21.29)
- Los avisos de "Guardar recepción" (p. ej. "N producto(s) no existen en el inventario y se crearían como nuevos… pulsa Guardar otra vez") ahora también se escriben dentro de la ventana, en un recuadro sobre los botones, y los toasts quedan por encima de cualquier ventana (antes podían quedar tapados y parecía que el botón se quedaba pegado).
- Al terminar de guardar una recepción (con el indicador de carga y el aviso "Recepción cargada") se abre una ventana con sus documentos de recepción conforme: PDF (modelo de la Corporación) y Word, más "Editar datos".
- En la OC, la lista pasa a llamarse "Recepciones y recepción conforme": cada recepción (REC-…) tiene botones PDF, Word y Editar. El documento se arma con lo recibido en ESA recepción (productos y cantidades), y se puede editar fecha, tipo y N° de guía/factura, contraparte, total/parcial, firma, observaciones y las líneas. Los cambios se guardan en `recepciones[].conforme` y no tocan el stock; los archivos se rehacen al descargarlos, por eso siempre salen con los datos vigentes. Queda evento CONFORME en la bitácora.
- El flujo antiguo "Recepción conforme" de la orden (con envío de correo y guía adjunta) sigue disponible.

### 4.84 Parcial/Total elegible y recepción conforme guardada dentro de la orden (v21.30)
- Al guardar una recepción, la ventana de documentos propone Parcial o Total según lo que falte por recibir, pero se puede cambiar: Parcial = solo lo que llegó en esa recepción; Total = todo lo recibido de la orden hasta ahora. La elección queda en `recepciones[].conforme.parcial` y rige también para los botones PDF/Word de la lista. En "Editar" se puede cambiar además a mano las líneas del documento.
- El PDF y el Word de cada recepción conforme se guardan solos en los archivos de la orden (categoría "Recepción conforme REC-…", con el mismo modelo de la Corporación); al cambiar el tipo o editar, se reemplazan los de esa recepción, para no tener que buscarlos en otro lugar.

### 4.85 Pendiente de recibir por orden, aviso en la campana e informes (v21.31)
- Dentro de cada orden aparece el cuadro "Pendiente de recibir (recepción parcial)" cuando ya llegó algo y falta el resto: producto, ID, pedido, recibido y falta. Se actualiza solo con cada recepción y desaparece cuando todo llegó. Al guardar una recepción se avisa cuántas unidades quedan por recibir (o que la orden quedó completa).
- La campana de notificaciones suma las órdenes con recepción parcial (faltan N un.) junto a los avisos de pendientes por entregar con stock; el número de la campana cuenta ambos.
- Los informes "contable" y "disponible" (Excel/CSV) agregan: la columna "Recepción conforme" (Parcial/Total) en las recepciones de OC, la sección "Pendiente de recibir" (órdenes abiertas, línea por línea) y la sección "Pendiente de entrega a centros" (con disponible y cuánto se puede entregar). Las recepciones y sus ingresos al stock ya salían en ambos informes.

### 4.86 Descarga de la recepción conforme siempre visible, con el nombre del modelo (v21.32)
- Sea parcial o total, el documento de recepción conforme (PDF con el modelo de la Corporación y Word) se puede descargar siempre: botón "Descargar recepción conforme (PDF / Word)" en la barra de la orden (última recepción registrada) y botones PDF/Word/Editar en cada recepción de la lista, que ahora aparece abierta. Las recepciones registradas antes de existir esta función también sirven (se arman desde lo recibido en cada una).
- Nombre de archivo igual al modelo: `RC<N° de orden>.pdf` / `.docx` (la 2.ª recepción de la orden en adelante lleva `_02`, `_03`…). El botón antiguo de la orden se renombra "Recepción conforme con correo" para distinguirlo.

### 4.87 Editar recepción conforme: incluir los productos de la orden (v21.33)
- El documento de una recepción lista solo lo que se registró como recibido en esa recepción (lo no recibido queda en "Pendiente de recibir"). En "Editar" hay un botón para incluir todos los productos de la orden con su cantidad pedida (ajustable), para cuando la conformidad abarca más de lo digitado en "Llega ahora".

### 4.88 Alerta de stock agregado en Inicio y mover de bodega desde el stock (v21.34)
- Inicio muestra la tarjeta "Stock agregado últimamente": últimos ingresos al stock (recepción de órdenes, ingreso de inventario/rápido y de proveedor) con unidades, producto, bodega de destino, documento y hace cuánto; solo personal; se refresca cada 5 minutos. Lee Historial_Movimientos (no escribe).
- En la tabla de Existencias cada producto tiene el botón "Mover a otra bodega" (flechas): abre la transferencia entre bodegas con el producto y su bodega de origen ya elegidos; se elige destino y cantidad. Usa el mismo traspaso de siempre (deja historial y conserva lote y vencimiento).

### 4.89 Existencias: lo último que ingresó va primero (v21.35)
- La tabla de Existencias se leía en orden de ID de documento y en páginas de 20: los productos creados o ingresados después (IDs "tras_…") quedaban en una página lejana y parecía que no estaban. Ahora se ordena por última modificación (lo recién ingresado, movido o entregado arriba) y, al guardar una recepción que ingresa al stock, la tabla se vuelve a leer sola.

### 4.90 Existencias: paginación numerada (v21.35→v21.36)
- Abajo de la tabla ahora se ven los números de página (1 2 3 … con la actual marcada), las flechas anterior/siguiente y el texto "Página X de Y · N producto(s)".

### 4.91 Correo de recepción con identidad visual y aviso de respaldo (v21.37)
- El correo de recepción/estado de orden se envía ahora también como HTML (Apps Script ya acepta `html`; sin redeploy): franja de 4 colores SAR, cabecera azul con logo y "Visor Logístico", tabla de productos, incidencias/observaciones, barras de avance por centro.
- Aviso destacado: "CORREO DE RESPALDO… generado automáticamente por el sistema Visor Logístico SAR; no requiere respuesta". También en el pie del texto plano (fallback).
- Módulo nuevo `correo-html.js` (`SAR_CorreoHTML`); si falla, se envía el HTML simple anterior.

### 4.92 Correo de recepción: logo del Visor y sin mención de la Corporación (v21.38)
- La cabecera del correo muestra el logo del Visor (assets/logo/marca-512.png) junto al logo del SAR.
- Se elimina toda mención a la Corporación Municipal de Melipilla en el correo; el subtítulo queda "SAR Elsa Romo Aravena".

### 4.93 Acta: el buscador de "Stock disponible" también muestra el catálogo (v21.39)
- Al buscar (2+ letras), además del stock de la bodega se listan los productos del catálogo que no están en ella (p. ej. ingresados a mano antes), con ID y foto, bajo "Del catálogo, sin stock en esta bodega".
- Al agregarlos quedan como manual · provisional (mismo tratamiento del ingreso manual), con pedido/entrega y pendiente si es 0.

### 4.94 Acta: la búsqueda de productos abarca todo lo registrado (v21.40)
- Además del catálogo (ahora hasta 5000), se suman a las sugerencias y a la lista "sin stock en esta bodega" los productos de Insumos de otras bodegas, líneas de Seguimiento_OC y actas anteriores (items/pendientes), sin duplicar por nombre o ID. Se indica "registrado en …".
- Motivo: un producto cargado antes (p. ej. BOLSA DE BASURA IMPEKE, ID 4538976) no aparecía si no estaba en Catalogo_Productos ni en la bodega elegida.

### 4.95 Actas de entrega: el stock sale al confirmar la entrega con el acta firmada (v21.41)
- Actas nuevas: al emitir se numera y se genera el documento, pero NO se descuenta stock ni se actualiza lo entregado de la OC. Quedan `confirmacion.estado = 'PENDIENTE'` (chip "ENTREGA POR CONFIRMAR"). Su cantidad queda **reservada**: en nuevas actas el disponible = existencias − sobregiro − reservado en actas por confirmar (y la línea de la OC resta lo reservado).
- "Confirmar entrega (subir acta firmada)": exige subir PDF/foto (≤6 MB) y ejecuta la misma transacción de siempre (lotes FEFO, sobregiro, historial ENTREGA_ACTA, OC entregado). Pasa a `CONFIRMADA`, `stockDescontado: true`.
- Actas ya emitidas (stock ya descontado): solo "Subir acta firmada" (respaldo; no toca stock). "Ver acta firmada" abre el archivo.
- Respaldo guardado en partes en `Contadores/respaldo-<N>-<i>` (colección ya abierta al personal, sin cambiar reglas) y, si hay OC, también en sus archivos ("Acta firmada N").
- Eliminar un acta por confirmar no toca stock (solo la marca ANULADA). Editar un acta por confirmar está bloqueado.
- Confirmar/subir firmada exige rol administrador (reglas actuales de Actas_Entrega).

### 4.96 Actas: menos pestañas y filas ordenadas (v21.42)
- Pestañas solo "Emitir acta" y "Actas emitidas"; "Seguimiento de actas" pasa a botón en la cabecera (con "Volver a actas").
- Filas de actas emitidas: número, centro y estado (Por confirmar / Firmada / Sin acta firmada / Anulada); acción principal visible (Confirmar entrega / Subir firmada), PDF, Word, Ver firmada; Editar y Eliminar en menú "⋯".
- Código de OC (ChileCompra): 1298355 = unidad de compra, 936 = correlativo, CM/AG/SE… = tipo de compra (CM Convenio Marco, AG Compra Ágil, SE sin emisión automática, CC Compra Coordinada, MC Microcompra, R1 <3 UTM, CA sin resolución; D1/C1/F3/G1/FG tratos directos), 26 = año.

### 4.97 Actas: ajustes de la revisión UX (v21.43)
- Menú "⋯" se cierra con clic fuera, Escape y al elegir; en la última fila abre hacia arriba; foco al título al ir/volver de Seguimiento; botones de 40 px (44 px en móvil); anuladas con número tachado en vez de opacidad; estado vacío con botón "Emitir la primera acta".

### 4.98 Bitácora de órdenes de compra (casos tipo ticket) con revisión del correo (v21.44)
- Nueva vista "Bitácora de órdenes" (bitacora-oc.js): cada OC es un caso con estado (Discrepancia, Sin gestión, Parcial, En gestión, Completa, Cerrada, Solo en correo), avance pedido/recibido/falta, último movimiento y línea de tiempo de correos (recibidos, enviados, reenviados) con adjuntos y enlace a Gmail.
- Script de Apps Script propio (código dentro de la vista, botón "Configurar"), que se instala con la cuenta compras.sar@cormumel.cl (distinta de la del script de fotos). `instalar` programa revisiones a las 07:00, 12:00 y 17:00; guarda el resultado en un JSON en Drive de esa cuenta; el Visor lo lee con URL + token (Contadores/config-bitacora, sin reglas nuevas).
- Las órdenes se agrupan por clave `1298355-NNN-XX26`; cada correo se clasifica por palabras clave (OC, despacho, guía, factura, reclamo, recepción conforme) y, en recepciones conformes, se detecta si declara TOTAL o PARCIAL.
- Discrepancia = el correo de recepción conforme dice TOTAL pero el Visor tiene faltantes (o dice PARCIAL y ya está todo recibido). Sin gestión = sin correos o más de 7 días sin movimiento y sin recibir nada. Varias guías/despachos = pedido fragmentado.
- Solo lectura del correo: no envía ni modifica nada.

### 4.99 Bitácora: ajustes de la revisión UX (v21.45)
- Panel: foco atrapado, Escape global, vuelve a la fila de origen, no se repinta con el panel abierto; orden título/estado/alerta/KPIs; solo los 5 correos más recientes con "Ver los N anteriores".
- Lista: estados con ícono, alerta visible como texto, buscador antes de los filtros, leyenda de reglas, filas más compactas en celular.

### 4.100 Actas: ver el acta sin descargar, buscador y bitácora por acta (v21.46)
- "Seguimiento de actas" deja de ser una vista aparte: en "Actas emitidas" hay un buscador que recorta la lista en vivo (número, centro, producto, fecha, estado).
- Al pinchar una fila se abre el acta (vista previa del PDF, sin descargar) con su bitácora (emitida, entrega confirmada/stock descontado, modificaciones, acta firmada subida, eliminación) y las acciones: Descargar ▾ (PDF/Word), Confirmar entrega / Subir firmada / Ver acta firmada y ⋯ (Editar, Eliminar).

- v21.47: corrección de un cierre de etiqueta sobrante en las filas de actas emitidas.

### 4.101 Bitácora: análisis por hilo, memo/SDC/CDP y trazabilidad por centro (v21.48)
- El script lee el hilo completo: si un mensaje nombra la orden, las respuestas del mismo hilo quedan asociadas ("del mismo hilo"). Extrae memo, SDC y CDP de cada correo; los correos que solo traen esas referencias se guardan como "sueltos" y el Visor los vincula a la orden por el memo/CDP de sus columnas ("vinculado por memo N").
- El Visor detecta qué centros se mencionan en cada correo (asunto, extracto, destinatarios) y muestra la tabla "Trazabilidad por centro y memo" (pedido, recibido, entregado, estado). Si hay unidades recibidas para otros centros sin entregar, la orden recibe una alerta ("No son stock del SAR") y el filtro "Para otros centros".
- Archivo del script pasa a `visor_bitacora_oc_v2.json` (reescanea 150 días). Si la primera pasada no alcanza el tiempo, continúa en la siguiente (campo `completo`).
- Requiere pegar el código nuevo y publicar una nueva versión de la implementación.

### 4.102 Bitácora: caso en ventana completa con ciclo de vida y análisis profundo (v21.49)
- El detalle de cada orden deja de ser un panel lateral y pasa a ventana a pantalla completa (diálogo modal, Esc / «Volver a la lista», foco devuelto a la fila).
- Arriba: línea de ciclo de vida de 6 etapas (Orden → Despacho y guías → Recepción en bodega → Recepción conforme → Factura → Distribución a centros) con estado hecho / en curso / pendiente / revisar / sin datos.
- Hallazgos agrupados (Discrepancia, Revisar, Información, Concordancia): memos distintos en correos vs. cuadro del Visor, centros mencionados (compra a nombre del SAR para varios centros), guías sin conforme, conforme TOTAL/PARCIAL vs. Visor, último correo sin respuesta, adjuntos. Cada hallazgo enlaza a los correos que lo respaldan.
- Bitácora debajo, subdividida por etapa (o cronológica); no se pierde ningún dato, solo se estructura. Menciones de centros ahora usan el conjunto global de centros del Visor, también para órdenes «Solo en correo».

### 4.103 Bitácora: ajustes de la revisión UX/UI de la ventana (v21.50)
- Foco visible azul y sin recorte; aria-pressed en el selector de vista; el cambio de vista conserva scroll y foco; la evidencia mueve el foco al correo; chip de etapa propio; contador de discrepancias/por revisar en la cabecera; tablas con región enfocable; respeto de prefers-reduced-motion; stepper en 2 columnas en móvil.

### 4.104 Avisos por correo de actas de entrega y movimientos de inventario (v21.51)
- Nuevo módulo `avisos-correo.js`: mismo correo HTML con identidad visual, mismos tres destinatarios y mismo Apps Script que la recepción de OC.
- Actas de entrega: correo al emitir (PDF adjunto), al confirmar la entrega (acta firmada adjunta, detalle y fecha), al subir la firmada y al eliminar. Cada envío queda registrado en `Contadores/aviso-<acta>-<evento>` y aparece en la bitácora del acta ("Correo de respaldo enviado").
- Movimientos: un oyente de Historial_Movimientos avisa (una vez por operación, agrupando líneas) ajustes, traspasos entre bodegas, ingresos, cargas masivas, mermas, tomas/eliminaciones/reinicios de inventario, cierres de bodega y ediciones de acta. No avisa los consumos a paciente (salidas), ni lo que ya tiene correo propio (recepción de OC, entrega de acta, anulación de acta, cuadres).
- Solo envía el navegador que hizo la operación; si el envío automático no está configurado no abre borradores y queda registrado "sin configurar".

### 4.105 Revisión de seguridad: cuentas sin rol y errores técnicos (v21.52)
- `firestore.rules`: las colecciones de datos (Insumos, Bodegas, Historial_Movimientos —escritura—, Metadata, Configuracion, Bandejas, Plantillas, Racks, Inventarios semanales, Respaldos de toma, Solicitudes de ajuste) exigen `hasRole()` en vez de solo estar autenticado: una cuenta creada sin perfil en /Usuarios ya no lee ni escribe nada. **Las reglas las despliega el usuario a mano** (la Action solo publica el sitio).
- Los errores globales del navegador ya no muestran el texto técnico al usuario (queda en la consola); se muestra un mensaje simple.
- Revisado sin cambios: la apiKey de Firebase en el cliente es pública por diseño (protege la regla, no la clave); los scripts de administración (reset-pwd, make-superadmin, etc.) están excluidos del hosting.
- Pendiente sugerido: App Check (límite de peticiones), restringir la apiKey por dominio en Google Cloud, rotar la contraseña expuesta en el commit 9c54373, página de licencias/términos, pruebas automáticas con Playwright.

### 4.106 Tablas a tu gusto: columnas, ancho, fijar y densidad (v21.53)
- Nuevo `tabla-columnas.js`: barra «Columnas» en Existencias, Historial, Compras, Kardex, Usuarios, Bodegas, Informes, Stock crítico, Recepciones y Solicitudes críticas. Mostrar/ocultar columnas, arrastrar el borde del encabezado para el ancho (doble clic lo restablece), fijar la primera columna y filas compactas.
- Es no destructivo (reglas CSS por posición de columna) y se guarda por tabla y por equipo en localStorage; «Restablecer» vuelve a lo original. No se reordenan columnas para no romper el código de cada pantalla.

### 4.107 Primeros pasos con barra de avance en el Inicio (v21.54)
- Nuevo `primeros-pasos.js`: tarjeta en el Inicio (solo personal) con 6 pasos que se marcan solos al detectar el dato: bodegas, inventario, orden de compra, correo de avisos configurado, acta emitida y acta firmada confirmada. Barra de avance, botón «Ir» a cada pantalla y paso siguiente resaltado.
- Al completar todo se celebra una vez y luego desaparece; «Ocultar por ahora» la oculta en ese equipo. Solo lee datos; respeta prefers-reduced-motion.

### 4.108 Licencias y términos, versiones fijas de bibliotecas y pruebas de humo (v21.55)
- Nuevo `acerca.js`: ventana «Licencias y términos» en el menú lateral (uso del sistema, datos y licencias de las bibliotecas de terceros). Accesible: foco, Esc y rol de diálogo.
- Se fijan las versiones de Phosphor Icons (2.1.1), Chart.js (4.4.1) y html5-qrcode (2.3.8): antes se cargaba «la última» desde un CDN, lo que podía romper el sitio o inyectar código sin que nadie lo notara.
- `tests/humo.js` (no se publica): pruebas de humo con Playwright (carga sin errores, barras de columnas, licencias). Se corre en local contra `python3 -m http.server`.

### 4.109 Bitácora: filtros «Compra compartida», «Con conforme» y «Falta conforme» (v21.56)
- Vista global de recepciones conformes: «Con conforme» (ya se envió al menos una) y «Falta conforme» (todo recibido o con guía/despacho, pero sin conforme enviada). «Compra compartida» reúne las órdenes con señales de reparto entre centros (varios memos, centros mencionados o frases de distribución).

### 4.110 Monitoreo de errores del sistema con aviso por correo (v21.57)
- Nuevo `monitor-errores.js`: los errores de JavaScript y promesas rechazadas que vive el personal (admin/operador) se guardan en `Contadores/err-<día>-<huella>` (mensaje, archivo, línea, pantalla, versión, quién, cuántas veces) y, la primera vez del día, se avisa por correo a los tres destinatarios (máx. 3 por equipo y día).
- Sin datos de pacientes (RUT enmascarados, mensaje a 300 caracteres) y sin ruido (extensiones, red intermitente, ResizeObserver). Nunca lanza errores propios.
- Se ve en «Directorio de errores» → «Errores registrados en el sistema» (solo administración). Los errores de enfermería no se registran (las reglas de Contadores son solo para personal).

### 4.111 Pruebas de unidad de la lógica pura (v21.57)
- `tests/unidad.js` (no se publica; `node tests/unidad.js`): 8 pruebas sin navegador ni Firebase sobre la bitácora (estado, análisis), el monitor de errores, las columnas, Primeros pasos y el correo HTML. Los flujos con sesión (emitir acta, confirmar, recibir OC) no se automatizan porque exigirían contraseñas de prueba en el repositorio; quedan para una prueba con el emulador de Firebase.

### 4.112 Resumen diario de vencimientos y bajo stock por correo (v21.58)
- Nuevo `resumen-stock.js`: la primera vez que el personal abre el Visor cada día (después de las 07:00) se revisa Insumos; si hay lotes vencidos, por vencer en ≤30 días o productos bajo el mínimo, sale un correo a los tres destinatarios (hasta 30 filas por sección, con el resto indicado). Sin urgencias, solo se manda el resumen los lunes. Los lotes que vencen entre 31 y 90 días se mencionan como nota.
- `Contadores/resumen-stock-<día>` evita duplicados aunque abran el Visor varias personas. No es un proceso programado en servidor: si nadie abre el Visor ese día, no sale (para un envío garantizado haría falta una Cloud Function programada, que exige el plan Blaze y despliegue manual).
- Mínimo y fechas con la misma lógica del panel de Inicio (criticalLimit/stock_minimo, 50 por defecto; lotes en `batches[]`).

### 4.113 Respaldo diario automático con verificación y descarga (v21.59)
- Nuevo `respaldo-diario.js`: la primera vez que el personal abre el Visor cada día (tras 15 s) se guarda una copia comprimida (gzip) de Insumos, Bodegas, Actas de entrega, Seguimiento de OC, Catálogo y Centros en `Contadores/bk-<día de la semana>-NN` + `bk-<día>-meta` (fecha, conteos, suma de control). 7 casillas rotativas = últimos 7 días (las reglas no permiten borrar en Contadores, se sobrescribe).
- En Configuración (administración): lista de copias, «Verificar» (descomprime, compara suma y conteos; no toca datos), «Descargar» (JSON) y «Crear copia ahora».
- La restauración es deliberadamente manual (con el JSON descargado y revisión previa): una restauración automática sobre producción es más riesgosa que útil. Una copia en el mismo proyecto protege de errores humanos, no de perder el proyecto: conviene además una exportación programada de Firestore a Cloud Storage (plan Blaze) o la descarga semanal del JSON.
- Costo: ~5.000 lecturas de Firestore por día (la cuota gratuita es de 50.000).

### 4.114 Informe de cierre mensual en Excel (v21.60)
- Nuevo `cierre-mensual.js`: en Informes (administración), selector de mes y botón «Generar Excel» con 9 hojas: Resumen, Entradas, Salidas, Traspasos, Ajustes y mermas, Actas del mes, Órdenes abiertas, Vencimientos y bajo stock, Saldos actuales. Solo lee; no modifica datos.
- Los movimientos se clasifican por tipo (ingresos/entradas/carga masiva; salida y entrega de acta; traspaso; ajustes, mermas, tomas, cuadres). Los movimientos antiguos con fecha en texto (no Timestamp) no entran en la consulta por mes.
- Los saldos son los de hoy: el sistema no guarda foto del stock a fin de mes; para un cierre exacto se genera el último día del mes o el primero del siguiente.

### 4.115 Ruta animada del ciclo y higiene SEO (v21.61)
- Bitácora: sobre las 6 etapas se muestra una ruta con marcador que avanza (1,25 s) hasta la última etapa lograda; CSS puro, sin librerías (no se agrega GSAP), respeta `prefers-reduced-motion` y se oculta en celular.
- SEO: se agregan título y descripción, `canonical`, Open Graph y `robots.txt`. **Decisión:** la app es interna y con login, por lo que se mantiene `noindex` y `Disallow: /` (contrario al consejo del video, pensado para sitios públicos). Sin `sitemap.xml` ni `llms.txt` por la misma razón. Ya cumplía: HTTPS, `lang="es"`, responsive, un `<h1>` por vista.

### 4.116 Capa de movimiento (v21.62)
- Inspirado en los reels de alta de proveedor y calendario de muelles: tarjetas de resumen y primeras 10 filas de tablas entran de forma escalonada (≤0,6 s), botones responden al toque, avisos y hallazgos de la bitácora aparecen suavemente.
- Solo CSS, sin librerías; se desactiva con `prefers-reduced-motion`. Las filas con animación solo cubren las 10 primeras para no afectar tablas grandes.
- Instagram no es legible de forma automática (bloquea robots): se trabajó con los 2 reels adjuntos. Ideas futuras: formulario de alta con vista previa en vivo y línea «ahora» en calendarios.

### 4.117 Vista previa en vivo en el formulario de agenda (v21.63)
- Nuevo `vista-previa-agenda.js`: al crear un envío/recordatorio, una franja arriba del formulario resume tipo, título y fecha («en 3 días», «mañana»), y avisa si la fecha ya pasó. No cambia lo que se guarda.
- La «línea de hoy» del calendario ya existía (`erp-cal-day--today`), por lo que no se duplicó. Queda pendiente la idea de chips de categoría (sin formulario de proveedores en el sistema).

### 4.118 Ver Excel dentro del sitio (v21.64)
- En Seguimiento de OC, «Ver» sobre un .xlsx/.xls/.csv abre una ventana de solo lectura con una pestaña por hoja (máx. 12 hojas, 500 filas, 40 columnas) y botón «Descargar»; ya no se descarga solo. Usa la librería SheetJS ya cargada; si falla, se descarga como antes.
- Los valores se muestran como texto (se escapan); no se ejecutan fórmulas ni macros. Los PDF siguen abriéndose en pestaña nueva.

### 4.119 Menú lateral ordenado y buscador; carga visible en todo el sitio (v21.65)
- Nuevo `menu-lateral.js` (reordena el menú existente sin tocar enlaces ni eventos): cada bloque se pliega con animación (estado recordado por dispositivo; se abre solo el del ítem activo). Orden de prioridad: Inicio → Inventario → Movimientos → Compras → Turno clínico → Administración; dentro de cada uno, lo de uso diario primero.
- Submenús: Movimientos → «Revisión y control» (cuadre de sustituciones, productos parecidos, oxígeno, auditoría); Compras → «Flujo y plazos» (SLA, tablero, recepción dinámica, catálogo, despachos).
- Buscador arriba del menú (sin tildes ni mayúsculas; atajo `/` o Ctrl+K; Enter abre la primera coincidencia; Esc limpia). Busca por nombre de pantalla o de bloque y solo muestra lo que el rol puede ver.
- Pie: «Licencias y términos», «Directorio de errores» y «Configuración» quedan en «Más opciones» (desplegable); «Salir» siempre visible. Con la barra contraída, todo sigue accesible por íconos.
- Nuevo `cargando-global.js`: barra superior con los colores de la marca al navegar y mientras haya algo cargando; cualquier texto suelto «Cargando…» (con o sin ruedita) se convierte al bloque con logo y anillo (`SAR_Progreso.cargando`); los botones en «Guardando…/Creando…/Generando…/Enviando…» muestran ruedita. Seguridad: la barra se apaga sola a los 30 s.
- No se tocó el flujo de guardado con pantalla de avance (`SAR_Progreso.correr`), que ya existía.

### 4.120 Ajuste de pruebas de la carga global (v21.66)
- `cargando-global.js` solo se inicia cuando existe un DOM real (corrige la prueba en Node). Sin cambios de comportamiento.

### 4.121 Búsqueda global en el buscador del menú (v21.67)
- Nuevo `buscador-global.js`: al escribir 2+ letras en el buscador del menú, además de las pantallas aparecen resultados agrupados de **Productos** (por código o nombre, con total y número de ubicaciones), **Órdenes de compra** (número, proveedor o producto), **Actas de entrega** (número, centro, producto o documento) y **Bodegas**. Al elegir uno lleva a la pantalla: producto → Existencias con el nombre ya filtrado; OC → abre su detalle; acta → abre el acta; bodega → Bodegas. Enter abre el primer resultado.
- Costo: la primera búsqueda lee una vez Insumos, Seguimiento_OC, Actas_Entrega (últimas 300), Bodegas y deja un índice en memoria por 10 minutos (se precarga al enfocar el buscador). Solo lee lo que el rol ve en el menú. Si el índice se vuelve pesado, se puede limitar o pasar a Cloud Function.
- Sin tildes ni mayúsculas; todas las palabras deben aparecer.

### 4.122 Corrección de congelamiento y carga tipo esqueleto (v21.68)
- **Falla:** tras v21.65 Chrome mostró «La página no responde». Causa probable: `cargando-global.js` recorría cada fila de las tablas grandes en cada actualización en tiempo real. Ahora revisa solo nodos cuyo texto contiene «cargando…» (prueba barata), con tope de 300 nodos y 10 ms por ciclo, y un freno: si el observador se dispara más de 150 veces por segundo se apaga solo.
- **Criterio de carga (pedido del usuario):** al entrar a una pantalla o listar datos se muestra un **esqueleto con barrido de luz** (`SAR_Progreso.cargando`); el **logo con anillo** queda solo para acciones: guardar, crear actas, recepción conforme y subir archivos (`SAR_Progreso.iniciar/correr`). La barra superior se mantiene.

### 4.123 Primer paso de identidad visual unificada con el login (v21.69)
- **Auditoría (login vs pantallas internas):** el login usa radios grandes (24 px), campos de 10 px, sombras suaves y título de 1,7 rem en 800; el interior mezclaba radios de 4/6/8/10/12 px, bordes y grises distintos (más de 20 tonos de gris), botones definidos 4+ veces en la hoja y tarjetas con borde plano sin sombra. Hay tokens de marca, pero muchos colores están escritos a mano.
- **Cambio:** bloque final «Identidad visual unificada» con tokens (`--id-r`, `--id-sombra`…): tarjetas de 14 px conservando la esquina inferior izquierda recta del logo SAR, sombra suave, botones y campos de 10 px con foco azul, cabeceras de tabla uniformes, ventanas de 20 px y títulos como en el login.
- **Carga:** corrección de v21.68: los «Cargando…» que vienen en el HTML inicial también pasan a esqueleto (revisión única al abrir). Esqueleto más compacto.
- **Pendiente (siguientes pasos):** reemplazar colores escritos a mano por tokens, quitar botones duplicados de la hoja y revisar Existencias, Seguimiento de OC y modales con datos reales.

### 4.124 Sin bordes de acento lateral y guía de identidad (v21.70)
- **Pedido del usuario:** quitar el borde de color a un costado (Urgencias, tarjetas de Inicio, etc.), por ser huella típica de sitios hechos con IA.
- **Cambio:** se neutralizan en tarjetas de resumen, tablas de Inicio, avisos, hallazgos de la bitácora, kanban, flujo, calendario, notificaciones y menú activo (incluye los estilos escritos en línea). El estado ahora se indica con **punto de color** junto al título, ícono/texto y fondo suave por tono.
- **Entrenamiento del agente UX/UI:** nueva guía `docs/IDENTIDAD_VISUAL.md` (principios, prohibiciones, referencias estudiadas, estado de migración) y `ux-ui-flujo` actualizado para auditar identidad (huellas de IA, tokens, movimiento, densidad) con «antes → después».

### 4.125 Colores de marca como tokens en toda la hoja de estilos (v21.71)
- 286 colores escritos a mano (`#1A3668`, `#E2E8F0`, `#64748B`, `#0F172A`, verde, rojo, naranja, amarillo, azul oscuro y azul claro) pasan a variables (`--sar-*`, `--id-borde`, `--text-*`). Comparación de capturas antes/después de Inicio y Existencias: sin diferencias visibles. Ahora cambiar la paleta es editar un solo lugar.
- Pendiente: grises intermedios, estilos de botón duplicados y revisión con datos reales de Seguimiento de OC.

### 4.126 Modo seguro (v21.72)
- Ante el aviso «La página no responde»: abrir `https://sarinventario.web.app/?seguro=1` carga el sitio sin `menu-lateral.js`, `cargando-global.js` ni `buscador-global.js` (los módulos nuevos de la sesión). Sirve para aislar si alguno causa un congelamiento. Si el sitio abre bien con `?seguro=1` y mal sin él, el problema está en esos módulos; si falla igual, está en otra parte.
- La pestaña ya congelada no se actualiza sola: hay que elegir «Salir de la página» y abrir el sitio de nuevo (Ctrl+Shift+R).

### 4.127 Módulos nuevos apagados por defecto mientras se aísla el congelamiento (v21.74)
- El sitio seguía mostrando «La página no responde» tras v21.68–v21.72. Como no se puede reproducir sin la sesión real, `menu-lateral.js`, `cargando-global.js` y `buscador-global.js` quedan **desactivados por defecto** (el menú vuelve a su diseño anterior). Se activan uno a uno con `?activar=menu`, `?activar=carga`, `?activar=busqueda` (se recuerda en el equipo) y se apagan con `?desactivar=…`. Así se identifica cuál causa el problema sin dejar el sitio inutilizable.
- Siguen activos: esqueleto de carga (CSS + `progreso.js`), identidad visual (CSS), vista previa de agenda y Ver Excel.

### 4.128 Inicio reorganizado: lo urgente a la vista sin hacer scroll (v21.74)
- **Orden nuevo:** accesos rápidos → **Acción inmediata** (izquierda) junto a **6 indicadores** compactos (stock crítico, vencimientos, solicitudes de compra, recepciones, despachos fuera de fecha, bandejas) → franja de estado → «Más indicadores» (plegado: movimientos de hoy y conteo de inventario) → Urgencias y Precaución → Flujo logístico semanal → «Estado por ubicación» (plegado, antes ocupaba mucho espacio) → Agenda.
- Los bloques «Compras y órdenes en curso», «Ingresos» y «Primeros pasos» se siguen insertando justo bajo el panel de prioridades mediante el ancla `#home-anchor` (antes era la rejilla central). No se cambió ningún id usado por el código.
- En pantallas de menos de 1100 px las prioridades se apilan.

### 4.129 ¿Dónde está? con atajos, Toma de inventario sin desborde y carga de Seguimiento de OC (v21.75)
- **Seguimiento de OC:** la animación de carga aparecía solo después de leer la configuración; ahora se muestra al instante al entrar (antes se veía el fondo gris vacío).
- **¿Dónde está?:** el estado inicial muestra búsquedas recientes (se recuerdan en el equipo, máx. 6), bodegas con su total y productos críticos con foto, stock y bodega principal; un clic busca. Estados con esqueleto de carga y mensaje de error con código de referencia (DE-01). Campo de búsqueda de 16 px (evita el zoom en iPhone).
- **Toma de inventario:** corregido el desborde de la tabla en pantallas medianas (columna `minmax(0,1fr)`, tabla con scroll propio) y la barra «Todas las categorías» ya no se corta (cabecera que baja de línea). En celular el formulario de Ingreso de existencias va primero, los indicadores pasan a 2 columnas compactas debajo y se ocultan los distintivos de estado.
- Propuesta del agente UX/UI aún pendiente: agrupar campos opcionales (código, dosis, lote) en «Más datos» y un solo menú de exportación en celular.

### 4.130 «Ingreso de Existencias» y registros de la jornada en fichas (v21.76)
- La pantalla pasa a llamarse **Ingreso de Existencias** (menú, título y barra superior), que es lo que se hace en ella.
- «Registros de la Jornada» deja la tabla de 10 columnas con scroll lateral (se cortaba y escondía datos) y muestra cada registro como ficha: nombre y código, cantidad de la toma y total a la derecha; debajo hora/toma, categoría, lote, vencimiento y ubicación; al pie estado de Google Sheets y acciones. Sin scroll horizontal, nada oculto.

### 4.131 Ingreso por préstamo / traspaso desde otro centro (v21.77)
- En Ingresos, «Tipo de compra» incluye **Préstamo / traspaso desde otro centro** para quiebres de stock sin solicitud de compra. Al elegirlo, «Proveedor» pasa a llamarse **Centro de origen** y el documento de respaldo deja de ser obligatorio (guía o memo opcional).
- El historial guarda `origenTipo: 'prestamo_otro_centro'` y `origenCentro`, de modo que siempre se sepa de dónde provino. Sigue sumando stock y auditándose igual que cualquier ingreso.
- Pendiente: registrar la devolución al centro de origen y mostrar el origen en el historial.

### 4.132 Explorador dentro del detalle de bodega (v21.78)
- El detalle de bodega ya no muestra «últimos movimientos» de ejemplo ni responsable fijo (eran datos ficticios): ahora muestra **qué hay en la bodega**, con buscador, filtro por categoría, foto, stock, lote, código y vencimiento (por vencer en rojo/naranja).
- Cada producto tiene **Ajuste** (lleva a Ajustes con el producto buscado) y **Mover** (abre la transferencia con el producto ya elegido). Las bodegas se siguen creando desde el formulario «Nueva Bodega».
- Módulo `bodega-explorador.js` (`SAR_BodegaExplorador`). Lee `Insumos` por `location` = nombre de la bodega.

### 4.133 Método de crítica y fichas de componentes (v21.79)
- Se revisaron dos videos de referencia: bibliotecas de componentes animados (React, no instalables aquí) y tres skills de diseño (crítica, traspaso de especificación, animación en Figma).
- **Adoptado:** el agente UX/UI ahora entrega hallazgos con severidad y revisa primero que los datos y textos tengan sentido; y cada componente nuevo se documenta en `docs/COMPONENTES.md` (anatomía, estados, tokens, responsive, movimiento, accesibilidad).
- **No adoptado:** instalar las bibliotecas o la skill de Figma (el proyecto no usa React ni Figma). Los patrones de movimiento (contador de cifras, indicador deslizante, entradas escalonadas) quedan como candidatos, a aplicar uno a la vez.

### 4.134 Precinto de inventario con folio correlativo (v21.80)
- Botón **Precinto de conteo** en Ingreso de Existencias: se elige bodega, ubicación/estante, categoría, N.° de conteo (1.°/2.°/3.°), responsable y cantidad de etiquetas (1–60).
- Cada precinto recibe un folio correlativo anual **PI-AAAA-NNNN** (contador `Contadores/precinto-AAAA`, reservado en una transacción) y queda registrado en `Contadores/pin-<folio>` con todos sus datos.
- Formato basado en el manual del precinto de oxígeno: **100×60 mm horizontal**, Arial Bold, monocromo, dos columnas (datos a la izquierda, estados a la derecha: Conteo completo, Reconteo requerido, Con diferencia, Caja abierta/dañada, Verificado 2.ª persona), «Contado ___ un.», «Reporta incid.» y «Motivo», logo SAR en escala de grises.
- **Imprimir** usa `@page 100mm 60mm` sin márgenes (una etiqueta por hoja, Zebra ZD230); **Descargar PDF** genera el mismo tamaño con jsPDF.
- Pendiente: código de barras/QR del folio y escaneo del precinto al ingresar el conteo (reutilizando el escáner inteligente).

### 4.135 Código de barras en el precinto y origen del ingreso en la lista (v21.81)
- El precinto lleva un **código de barras Code 128 (juego C)** con los dígitos del folio: `PI-2026-0001` se lee como `20260001` (79 módulos, legible a 203 dpi de la Zebra). Se dibuja igual en pantalla/impresión (SVG) y en el PDF. Verificado: la secuencia de símbolos coincide con la de la biblioteca de referencia (reportlab).
- La lista «últimos ingresos» muestra **«Préstamo desde: <centro>»** cuando el ingreso vino de otro centro, en vez de «Proveedor».
- Pendiente: escanear el precinto al registrar el conteo; devolución al centro que prestó.

### 4.136 Devolución de préstamos recibidos de otros centros (v21.82)
- Cada ingreso por «Préstamo / traspaso desde otro centro» crea, en la misma transacción, un registro `Contadores/prestamo-<id>` con centro, producto, lote y cantidad, en estado PENDIENTE.
- En Ingresos aparece el panel **Préstamos de otros centros por devolver** (solo si hay pendientes): por cada uno, cantidad pendiente y botón **Devolver** (parcial o total). Devolver descuenta el stock (primero el lote prestado, luego los más próximos a vencer), valida que haya stock suficiente, actualiza lo devuelto y registra en el historial un movimiento `DEVOLUCION_PRESTAMO` hacia el centro.
- Al devolver todo, el préstamo pasa a DEVUELTO y desaparece del panel. Los préstamos anteriores a esta versión no tienen registro pendiente.

### 4.137 Escaneo del precinto en el ingreso de existencias (v21.83)
- Al escanear (o teclear + Enter) el código del precinto en «Escaneo rápido» —`PI-AAAA-NNNN` o sus 8 dígitos— el sistema lo busca en `Contadores/pin-<folio>` y **rellena bodega, conteo/toma y categoría**; aparece un recuadro «precinto activo» con el folio y una × para quitarlo.
- Mientras haya precinto activo, **cada registro guardado lleva `[Precinto PI-…]` en Observaciones** y suma al contador `registros` del precinto, que pasa a estado EN_CONTEO. Así se sabe qué productos se contaron dentro de qué caja/estante.
- Los códigos de producto no se ven afectados (solo se interceptan los que tienen formato de folio). Si el folio no existe, avisa y no cambia nada.
- Pendiente: marcar el precinto como CERRADO (con total contado y diferencia) y un listado de precintos abiertos.

### 4.138 Oxígeno portátil: capacidad normalizada, filtro y cambio de capacidad (v21.84)
- **N.° de serie:** siempre se guarda como texto tal cual se escribe (ceros a la izquierda incluidos); es el identificador de seguimiento del balón y no se puede duplicar.
- **Estados:** se cambian después de crear el balón con el selector «Acción» de cada fila (recarga, vacío, entrega, devolución, fuera de servicio, volver a servicio). Fuera de servicio exige explicar el motivo; todo queda en el historial del balón.
- **Capacidad:** se normaliza al guardar («1m3», «1 M3» → «1 m³»; «0.5» → «0,5 m³») para que no se separen balones iguales; en el alta se sugieren 0,5/1/2/3/5 m³ y las ya usadas. Nueva acción **Cambiar capacidad** (queda en el historial con «De X a Y»).
- **Visualización:** fila de filtros por capacidad con conteo; los indicadores (Lleno/Vacío/…) se recalculan para la capacidad elegida; el buscador también busca por capacidad.

### 4.139 Precinto de control de oxígeno con N° de serie automático (v21.85)
- Cada balón tiene el botón **Precinto**, y la barra tiene **Precintos (N)** que imprime los balones visibles (respeta filtros de estado y capacidad). El modelo es el «Precinto Zebra Oxígeno 100×60» entregado: logo SAR, «CONTROL DE OXÍGENO», Proveedor, Fecha carga, Revisado por, Reporta incid., casillas LLENO/NUEVO · EN USO · VACÍO · FUERA DE SERVICIO y Motivo F. Servicio (2 líneas).
- **Agregado automático:** N° de serie (grande), capacidad y un código de barras Code 128 del serie, para leerlo con pistola. El resto queda en blanco para llenar a mano.
- Imprimir directo (`@page 100×60`, una etiqueta por hoja, monocromo) o descargar PDF del mismo tamaño. Comparte módulo con el precinto de inventario.

### 4.140 Oxígeno: tipo de gas, proveedor y fecha de carga (v21.86)
- Al agregar balones se pregunta el **tipo de gas** (Oxígeno medicinal, Aire comprimido medicinal o texto libre), el **proveedor** y la **fecha de carga** (si queda lleno). Los equipos antiguos sin gas se tratan como oxígeno medicinal.
- El proveedor y la fecha de carga se actualizan solos con cada «Enviado a recarga» / «Recarga recibida», y el **precinto los imprime ya llenos** junto al N.° de serie, el tipo de gas y la capacidad (título «CONTROL DE AIRE COMPRIMIDO» cuando corresponde). Revisado por, Reporta incid. y Motivo quedan en blanco para llenar a mano.
- Nueva acción **Cambiar tipo de gas** (con historial «De X a Y»), filtro por gas junto al de capacidad, y el acta de entrega nombra «BALÓN DE AIRE COMPRIMIDO» cuando corresponde.
- **Pendiente del usuario:** entregar la lista de proveedores para dejarla como sugerencias (hoy se sugieren los ya usados) y confirmar si hay otros tipos de gas además de oxígeno y aire comprimido.

### 4.141 Folio correlativo en el precinto de oxígeno (v21.87)
- Cada etiqueta de oxígeno lleva un **folio correlativo anual PO-AAAA-NNNN** (contador `Contadores/precinto-oxi-AAAA`, reservado en una transacción), impreso abajo a la izquierda, además del N.° de serie. Cada folio queda registrado en `Contadores/pin-<folio>` con serie, gas, capacidad, proveedor y fecha de carga.
- El folio se asigna al **primer** «Imprimir» o «Descargar PDF» del diálogo; volver a imprimir en el mismo diálogo usa los mismos folios (no consume números). Un precinto nuevo, aunque sea del mismo balón, recibe un folio nuevo.
