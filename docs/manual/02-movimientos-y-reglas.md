# Manual de uso del Visor Logístico SAR — Parte 2: Movimientos, bodegas y reglas del sitio

Esta parte explica cómo entra, se mueve y sale la mercadería en el Visor: ingresos, transferencias, actas de entrega, solicitudes, distribución a centros, oxígeno portátil y bodegas. Al final está el capítulo **«Reglas del sitio»**, que aplica a todo el personal.

**Nombres de los roles.** Así aparecen en **Usuarios**:

| Rol en el Visor | En este manual |
|---|---|
| Super Admin (Control Total) | Superadministrador |
| Administrador (Inventario) | Administrador |
| Administrador de Bodega | Encargado de bodega |
| Enfermero (Gestión de Bandejas) | Enfermería |
| Solo Bodega transitoria (conteo) | Encargada de transitoria |
| Solicitante (solo pide insumos) | Solicitante |

**Cómo saber si tienes internet.** Arriba se ve **«En vivo · hh:mm»** cuando hay conexión, o **«Sin conexión · datos de las hh:mm»** cuando no la hay. Si algo quedó guardado en el equipo esperando internet, abajo a la derecha aparece **«N sin sincronizar»**.


---

## 1. Ingresos

**Para qué sirve**
Para registrar la mercadería que llega: de un proveedor, de una compra sin orden o en préstamo desde otro centro. Al confirmar, el producto queda **disponible de inmediato** en la bodega que elijas y el movimiento queda en el Historial con su código **ING**.

**Quién lo usa**
Encargado de bodega, Administrador y Superadministrador. Enfermería no tiene acceso.

**Paso a paso**
1. En el menú, entra a **MOVIMIENTOS → Ingresos**. La pantalla se titula «Registro de Ingresos».
2. En **TIPO DE INSUMO**, elige primero **Insumos médicos**, **Insumos de aseo** o **Insumos de oficina**. Esto define si el lote y el vencimiento son obligatorios.
3. En **INSUMO SELECCIONADO**, escribe el nombre. El Visor te sugiere los nombres que ya existen: si el producto ya está, **elige el nombre sugerido** en vez de escribir otro parecido. El botón con el código de barras, al lado, abre la cámara para leer el código de la caja (se cierra con **Cancelar Escáner**).
4. Escribe el **LOTE** y la **FECHA VENCIMIENTO** tal como vienen en la caja.
   - En insumos médicos son obligatorios. Si el producto de verdad no los trae, marca **«Este producto no trae lote ni fecha de vencimiento»**. Quedará como **S/L** (sin lote).
   - En aseo y oficina son opcionales.
5. **TALLA** (opcional): úsala en guantes, ropa o sondas. Si eliges **«Otra (escribir número u otra medida)…»**, escribe la medida. Cada talla queda como un producto aparte.
6. **ID MERCADO PÚBLICO** (opcional): sirve para encontrar la foto del producto.
7. Indica la cantidad:
   - **Por unidades**: escribe la **CANTIDAD**.
   - **Por cajas**: escribe **N° DE CAJAS** y **UNIDADES POR CAJA**; el total se calcula solo.
8. **CATEGORÍA**: elige una de la lista o crea una nueva.
9. **PROVEEDOR**: escribe o elige el proveedor. Si en **TIPO DE COMPRA** eliges **«Préstamo / traspaso desde otro centro»**, el campo pasa a llamarse **CENTRO DE ORIGEN**: escribe ahí el centro que lo envía.
10. **DESTINO**: elige la bodega donde queda guardado. Revísalo siempre: el stock queda en esa bodega.
11. **N° DE OC O DOCUMENTO** (opcional, se puede asociar después), **DOC. RESPALDO** (PDF o foto, opcional) y **OBSERVACIONES**.
12. Pulsa **CONFIRMAR INGRESO**. Debe aparecer el aviso **«Éxito — Movimiento registrado y auditado correctamente.»** y el formulario queda en blanco.
13. Abajo, en **ÚLTIMOS REGISTRADOS**, verás los tres últimos ingresos.


**Préstamos que debemos devolver.** Si ingresaste algo como préstamo de otro centro, aparece el recuadro **«PRÉSTAMOS DE OTROS CENTROS POR DEVOLVER»**. Al devolverlo, escribe la cantidad y pulsa **Devolver**.

**Sin internet:** el ingreso **sí funciona**. Queda guardado en el equipo con un folio provisional **ING-P-…** y aparece el aviso **«Sin internet: ingreso en cola»**. Se aplica solo cuando vuelve la conexión. El archivo de respaldo no viaja en la cola: adjúntalo después.

**Si pasa esto…**
- **«Falta la talla»**: elegiste «Otra» y no escribiste la medida. Escríbela o elige «Sin talla».
- **«Revisar ingreso»** (el movimiento quedó en el historial pero el producto no aparece en Existencias): **no sigas ingresando**. Avisa al administrador.
- **«Error Crítico — Fallo en la sincronización»**: revisa en **Historial** si el ingreso quedó antes de repetirlo. **Si envías el formulario dos veces, quedan dos ingresos.**
- **Entró menos de lo que escribiste**: ese producto tenía una **deuda** (se entregó con acta antes de que existiera stock en el sistema). El ingreso salda primero esa deuda. Es correcto; queda registrado.
- **Me equivoqué en la cantidad, el lote o el vencimiento**: puedes corregirlo desde el **Historial** durante las **12 horas** siguientes, siempre que no haya salido nada de ese producto. Después, solo con **Ajustes de Stock** (con motivo y código AJU).

**Reglas**
- El lote y el vencimiento se copian **tal cual** de la caja. No inventes un lote.
- Un producto que ya existe se ingresa con **su mismo nombre**: no crees variantes («GUANTE M», «GUANTES TALLA M»…).
- El ingreso no tiene paso de cuarentena: lo que confirmas queda disponible para entregar. Revisa el estado y el vencimiento **antes** de confirmar.

---

## 1-b. Ingreso rápido

**Para qué sirve**
Para cargar de una sola vez el inventario de una bodega completa (por ejemplo, el camión): pegas una lista o lees fotos de las cajas, la revisas en una tabla y la ingresas toda junta. Queda con un folio **INV**.

**Quién lo usa**
Administrador y Superadministrador. Para el Encargado de bodega la pantalla dice «Esta sección es para administradores y encargados de bodega» y no deja usarla.

**Paso a paso**
1. Entra a **COMPRAS · ADQUISICIONES SAR → Ingreso rápido**.
2. En **«— Elige la bodega de destino —»** elige la bodega. Si no existe, pulsa **+ Nueva bodega** y escribe el nombre en la ventana del navegador.
3. Si los productos llegaron con una orden de compra, escribe su número en el campo de la orden (es opcional). **Ojo:** en esa orden registra la recepción **sin marcar «Ingresar al stock»**, para no contar el stock dos veces.
4. Carga la lista de una de estas tres formas:
   - **Leer desde fotos**: saca o elige fotos de las cajas (la cara con el nombre, el lote y el vencimiento), hasta unas 20 por vez. Los productos aparecen en la tabla para revisar.
   - **Pegar una lista**: abre el desplegable, pega una línea por producto (*producto ; ID ; cantidad ; lote ; vencimiento*) y pulsa **Agregar a la tabla**.
   - **+ Agregar fila**: escribe cada producto a mano.
5. Revisa la tabla, fila por fila. Las filas en rojo necesitan **producto y cantidad**. Si una fila trae un aviso amarillo (una duda de la lectura de la foto), revísalo con la caja en la mano.
6. Pulsa **Ingresar a «bodega»**. El navegador pregunta «Se ingresarán N unidades de M productos a "…". ¿Confirmas?»: acepta.
7. Al terminar aparece «N unidades de M productos ingresadas a … (INV-…)».


**Sin internet:** el ingreso **sí funciona** (folio provisional **INV-P-…**) y se aplica solo al volver la conexión. **Leer desde fotos** y **+ Nueva bodega** necesitan internet.

**Si pasa esto…**
- **«Falta conectar el script»** o **«Falta la clave de lectura»**: la lectura de fotos no está configurada. Avisa al administrador; mientras tanto, pega la lista o escribe las filas.
- **«No se terminó el ingreso»**: lo que alcanzó a guardarse ya está en la bodega. **Revisa la bodega antes de repetir**, para no ingresar dos veces.

**Reglas**
- Úsalo para lo que **contaste físicamente**. A diferencia del ingreso normal, no salda deudas de actas anteriores.
- Vacía la tabla (**Vaciar tabla**) si cambias de bodega a mitad de la carga.

---

## 2. Transferencias entre bodegas

**Para qué sirve**
Para mover productos de una bodega a otra (por ejemplo, del camión a la transitoria). Se conservan el lote y el vencimiento, y queda registro en el Historial con folio **TRA**. El stock **sale del origen y entra al destino en el mismo momento**.

**Quién lo usa**
Encargado de bodega, Administrador y Superadministrador. Enfermería no tiene acceso.

**Paso a paso**
1. Entra a **MOVIMIENTOS → Transferencias**.
2. Elige la **Bodega de origen** y la **Bodega de destino**.
3. Aparecen los productos con stock del origen. Usa **«Buscar producto o ID Mercado Público…»** para filtrar.
4. Marca la casilla de cada producto que vas a mover (**Marcar todo lo visible** los marca todos).
5. En **Cantidad a mover**:
   - Si el producto tiene **un solo lote**, viene escrita la cantidad total; corrígela si mueves menos.
   - Si tiene **varios lotes**, aparece un casillero por lote, en **0**. Escribe cuánto sacas de cada lote. Los lotes vienen ordenados por vencimiento: **saca primero el que vence antes**.
6. Si quieres, escribe una **Nota (opcional)** (por ejemplo, «reposición de la bodega de turno»).
7. Pulsa **Mover seleccionados**. Revisa el resumen de la ventana «¿Mover N productos?» y pulsa **Mover**.
8. Abajo verás **«N movido(s)»** y, si alguno falló, **«No se movieron N»** con el motivo. Si todo salió bien, la pantalla queda en blanco para otra transferencia.


**Otra forma:** desde **Bodegas** (detalle de una bodega) el botón **Transferir / Traspaso** abre la ventana «Transferencia de Stock» para mover un solo producto. Para varios productos, usa siempre el menú **Transferencias**.

**Sin internet:** **sí funciona**. Sale el mensaje **«Sin conexión: N movimiento(s) guardado(s) en este teléfono»**. Se aplica solo cuando vuelve internet, con el stock que haya en ese momento. Si ya no alcanza (porque alguien movió el producto entre medio), queda **«para revisar»** y nunca se descuenta a ciegas.

**Si pasa esto…**
- **«El destino debe ser distinto del origen.»** / **«Marca al menos un producto.»**: corrige y vuelve a pulsar.
- **«…: indica cuánto mover (en productos con varios lotes, de qué lote).»**: dejaste todos los lotes en 0 o escribiste más de lo que hay.
- **El producto dice «Cuarentena» y no se puede marcar**: no se mueve hasta que se resuelva la cuarentena.
- **«No pude leer el stock»**: la lista puede salir vacía aunque haya productos. Vuelve a elegir la bodega o recarga la página.

**Reglas**
- Mueve físicamente lo mismo que registras: **mismo producto, mismo lote y misma cantidad**.
- Saca primero el lote que vence antes (FEFO).
- Lo reservado en actas por confirmar no aparece como disponible y no se puede mover.

---

## 3. Actas de entrega

**Para qué sirve**
Para entregar productos a otro centro con un acta oficial numerada (**AE-AAAA-NNNN**), en PDF y Word. El stock pasa por tres momentos:

| Momento | Qué pasa con el stock |
|---|---|
| **Borrador** (mientras armas el acta) | No cambia. El borrador queda guardado en este equipo. |
| **Emitir acta** | El stock queda **reservado**: sigue en la bodega, pero nadie más lo puede usar. |
| **Confirmar entrega** (subir el acta firmada) | Recién ahí **se descuenta** del stock. |

**Quién lo usa**
- **Armar y emitir actas:** Encargado de bodega, Administrador y Superadministrador.
- **Confirmar entrega, Subir firmada, Editar y Eliminar acta:** solo Administrador y Superadministrador.
- Enfermería no tiene acceso.

**Paso a paso — Emitir un acta (pestaña «Emitir acta»)**
1. Entra a **MOVIMIENTOS → Actas de entrega**, pestaña **Emitir acta**.
2. En **1 · Stock disponible**, elige la **Bodega de origen**.
3. Busca el producto en **«Buscar por nombre o ID del producto…»**. En cada producto verás lo **Disponible** y lo que está reservado en otras actas.
4. En la fila del producto escribe:
   - **Pedido** (opcional): lo que el centro pidió en total.
   - **Cantidad a entregar**: lo que entregas ahora.
   Luego pulsa **Agregar**.
   - Si lo que entregas es menos que lo pedido, la diferencia queda como **pendiente** del centro.
   - Si no tienes nada, pon **0** y el pedido: queda todo como pendiente.
   - Si el producto no tiene stock aquí pero sí en otra bodega, el origen **cambia solo** a esa bodega y aparece un aviso con **Correcto** o **Volver a …**.
5. **¿No está en el sistema? Ingreso manual**: úsalo solo si tienes el producto físicamente y no está registrado. Queda como **provisional** y como **sobregiro** (deuda) hasta que ingrese su orden de compra. Si es un medicamento controlado, marca **«Es medicamento controlado (no se permite sin stock)»**.
6. En **2 · Acta**, escribe el **Centro al que se entrega** (con **+ Guardar este centro en la lista** queda en la lista para la próxima vez).
7. Revisa **Productos entregados**. Si corresponde, abre los desplegables:
   - **Productos pendientes de entrega**.
   - **Documentos asociados: SDC, OC, factura… (opcional)**.
   - **Firmas**: nombre y cargo de quien **entrega** (queda guardado en el equipo) y de quien **recibe** (opcional).
8. Si no estás seguro del formato, pulsa **Acta de prueba · PDF** o **Acta de prueba · Word**. No descuenta stock ni gasta número.
9. Pulsa **Emitir acta y reservar stock**. La ventana **«¿Emitir el acta?»** te recuerda que el stock **no se descuenta ahora**: queda reservado hasta que subas el acta firmada. Si hay productos **sin respaldo en sistema**, los lista. Pulsa **Emitir acta** (o **Revisar** para volver).
10. Aparece **«Acta emitida — AE-… · el stock sale al subir el acta firmada.»** y se descarga el PDF. Imprímelo y hazlo firmar al entregar.


**Paso a paso — Preparar la mercadería (picking)**
1. En la pestaña **Actas emitidas**, pulsa **Picking** en la fila del acta, o **Hoja de picking** dentro del acta.
2. Imprime la hoja y retira de la bodega lo que indica.

**Paso a paso — Confirmar la entrega (Administrador o Superadministrador)**
1. Escanea o fotografía el acta **firmada** (PDF o foto, máximo 6 MB).
2. En **Actas emitidas**, abre el acta con **Ver acta**. Su estado dice **«Por confirmar · stock reservado»**.
3. Pulsa **Confirmar entrega**. En la ventana «Confirmar la entrega AE-…» pulsa **Subir acta firmada** y elige el archivo.
4. Aparece **«Entrega AE-… confirmada · stock descontado»**. El acta pasa a **Firmada**.


**Otras acciones en «Actas emitidas»**
- **Filtros:** **Pendientes por firmar**, **Firmadas**, **Con productos pendientes**, **Todas**, y el buscador por número, centro, producto, fecha o estado.
- **Pendientes (N):** lista lo que le falta entregar a ese centro según esa acta.
- Dentro de **Ver acta**:
  - **Descargar ▾** (PDF o Word).
  - **Ver acta firmada** y **Descargar firmada**.
  - **Bitácora del acta**: quién la emitió, si se envió el correo y cuándo se confirmó.
- **Subir firmada:** solo aparece en actas ya confirmadas que no tienen archivo (por ejemplo, las históricas) y en actas de oxígeno. **No cambia el stock.**
- **⋯ → Editar** (Administrador): corrige un acta emitida.
- **⋯ → Eliminar acta** (Administrador): pide un **motivo**. El stock reservado o entregado vuelve a la bodega, el acta queda **ANULADA** y su número no se vuelve a usar.
- **Reservar su stock ahora** (Administrador): aparece si hay actas antiguas, emitidas antes de que existiera la reserva, cuyo stock todavía se puede usar en otros movimientos.
- **Acta anterior al sistema (histórica)**: sirve para registrar un acta en papel ya entregada. Queda como **HIS-N°** con su fecha original y **descuenta el stock de inmediato**.

**Distribución a centros dentro de Actas.** Si llegas desde **Distribución a centros**, arriba del stock aparece el panel de esa distribución, con **Agregar los que tienen stock** y **Armar acta con lo agregado** (ver capítulo 5).

**Sin internet:**
- **Emitir sí funciona.** El acta queda en cola con folio **AE-P-…** y se descarga un **PDF provisional** (dice «PROVISIONAL») para firmar. Al volver internet se emite con su número AE definitivo y reserva el stock; lo que no alcance queda como sobregiro. Descarga después el PDF definitivo desde **Actas emitidas**.
- **Necesitan internet:** las actas que vienen de una **orden de compra**, **Confirmar entrega**, **Subir firmada** y **Eliminar acta**.

**Si pasa esto…**
- **El botón Emitir está gris**: arriba de los botones aparece la lista de lo que falta (centro, bodega, cantidades).
- **«…: es medicamento controlado, no puede entregarse sin stock en sistema»**: un controlado solo se entrega con stock registrado.
- **«Sin respaldo: N»** en un producto: estás entregando más de lo que hay en el sistema. Quedará como sobregiro. Antes de emitir, confirma que de verdad lo tienes físicamente.
- **«Esta acta ya no está pendiente de confirmar»**: otra persona la confirmó o la eliminó. Actualiza la pantalla.
- **«El archivo pesa más de 6 MB»**: escanea con menos calidad o en blanco y negro.
- **El correo no salió**: la bitácora del acta dice si quedó **pendiente** (sale en horario hábil, de lunes a viernes de 8:00 a 17:00) o **NO enviado**.

**Reglas**
- **Un acta emitida no es una entrega.** La entrega existe cuando se sube el acta **firmada** con **Confirmar entrega**.
- Máximo **60 productos** por acta.
- Para probar el formato, usa **Acta de prueba**, nunca un acta real que después tengas que eliminar.
- Lo que escribas en **«¿Entregas físicamente otro similar?…»** es solo interno: no sale en el acta.

---

## 4. Solicitudes recibidas

**Para qué sirve**
Es la bandeja de bodega para atender lo que piden los servicios desde **«Pedir insumos»** (la página del teléfono) y los inventarios de las bodegas de uso (transitoria, aseo, oficina). Cada solicitud tiene un número **SOL-AAAA-NNNN** y pasa por estos estados:

| Estado | Significa |
|---|---|
| **Enviada** | Llegó; nadie la ha revisado. |
| **Procesando** | Bodega empezó a revisar los productos. |
| **Procesada** | El stock ya se movió (salió de bodega o va **en camino**). |
| **Cerrada** | Entregada o recibida. |
| **Anulada** | Se canceló sin mover stock. |

Quien pidió ve el estado en su teléfono.

**Quién lo usa**
Encargado de bodega, Administrador y Superadministrador. El menú muestra un número con las solicitudes nuevas.

**Paso a paso — Revisar cada producto**
1. Entra a **MOVIMIENTOS → Solicitudes recibidas**. Usa el filtro (**Abiertas**, **Enviadas**, **Procesando**, **Procesadas**, **Cerradas**, **Todas**) o busca por N° SOL, nombre, correo o producto.
2. Abre la solicitud. Cada producto pedido trae su foto y una tabla **Dónde · Lote · Vence · Hay · Sacar**.
   - La columna **Sacar** viene prellenada: primero la bodega a la que se pidió y, después, **el lote que vence antes**. Corrígela si sacas de otro lote.
   - En las **reposiciones** de una bodega de uso, solo aparecen lotes de **otras** bodegas (Central, camión, etc.).
3. Si el producto fue **escrito a mano** por quien pidió y no aparece en el inventario, pulsa **Asociar a producto del inventario** y búscalo por su nombre de fábrica.
4. Pulsa **Confirmar** para guardar lo elegido (queda **Confirmado** o **Parcial**), o **No hay** si no tienes. Dejar todo en 0 también cuenta como «No hay» y quien pidió queda avisado.
5. Si te equivocaste, pulsa **Cambiar** para reabrir el producto, siempre que todavía no se haya movido.

**Paso a paso — Pistolear la caja**
Úsalo cuando la caja tiene etiqueta **BUL**: así el stock y la caja quedan cuadrados.
1. En el producto, pulsa **Pistolear o leer QR de la caja**.
2. Pistolea la etiqueta, o pulsa **Cámara (QR)** para leerla con el teléfono.
3. El Visor revisa que la caja sea de ese producto, que no esté vacía y que su lote tenga stock. Luego pregunta **«¿Qué vas a sacar de esta caja?»**:
   - **La caja completa (N u.)**, o
   - **Unidades sueltas**: escribe cuántas.
   - En una **caja grande** con cajas pequeñas: sale **la caja grande completa**, o pistoleas **cada caja pequeña** que sacas.
4. Pulsa **Sacar de esta caja**. La caja queda en la lista (con **✕** se quita). Para agregar otra, pulsa **Otra caja (pistola o QR)**; al terminar, **Listo**.
5. Lo pistoleado pasa a la columna **Sacar**. Pulsa **Confirmar**.


**Paso a paso — Procesar**
1. Cuando todos los productos están decididos, el botón de abajo dice:
   - **Procesar: enviar a «bodega»** si es una reposición, o
   - **Procesar: entregar** si es un pedido de una persona.
   Si todavía dice **Procesar (faltan N)**, te quedan productos por decidir.
2. Revisa la ventana «¿Procesar SOL-…?» y pulsa **Procesar**.
   - **Reposición:** el stock sale de su bodega y queda **«En tránsito»** (en camino). Todavía no está disponible en la bodega de destino.
   - **Pedido de una persona:** el stock sale de la bodega por lote (salida).
3. La solicitud pasa a **Procesada**.

**Paso a paso — En tránsito y recibir (solo reposiciones)**
1. Lleva la mercadería a la bodega de uso.
2. Cuando llegue, pulsa **Marcar recibido en «bodega»**. Si la encargada ya lo marcó en su teléfono, el botón dice **Confirmar recibido (lo marcó …)**.
3. En la ventana «¿Recibido en …?» revisa producto, cantidad y lote, y pulsa **Recibido**.
4. El stock entra a la bodega de uso y la solicitud se **cierra** sola.

**Paso a paso — Cerrar (pedidos de personas)**
- Cuando entregues la mercadería, pulsa **Cerrar solicitud (entregada)**.

**Otras acciones**
- **Copiar para WhatsApp**: copia el texto de picking.
- **Anular**: solo mientras no se haya movido stock.
- **Inventario por revisar** (inventarios de bodegas de uso): muestra por producto lo que decía el sistema, lo contado y lo **usado**.
  - **Aceptar y descontar** aplica lo usado.
  - **Pedir reconteo (N)** devuelve los productos marcados a la encargada para que los cuente de nuevo.
  - Mientras el inventario no esté aceptado, el botón dice **Procesar (acepta el inventario)**.

**Sin internet:** **Confirmar**, **Procesar** y **Marcar recibido** quedan en cola (se ve **«en cola»** o **«En cola: se hará solo al volver internet»**) y se aplican solos al volver la conexión, sin duplicarse. La pantalla usa la copia del equipo, que se actualiza sola; la línea de estado dice **«Copia para trabajar sin internet: se actualiza sola · última …»**.

**Si pasa esto…**
- **«… no es una etiqueta de caja (BUL).»**: pistoleaste otro código. Busca la etiqueta BUL de la caja.
- **«Esa caja es de «…», no de lo que se pide aquí.»**: tomaste otra caja.
- **«… ya está elegida en …: una caja sale una sola vez.»**: esa caja (o su caja grande o sus cajas pequeñas) ya está asignada en otra solicitud.
- **«La caja dice X, pero el lote … tiene stock en Y…»** o **«El lote … de esta caja no tiene stock en el sistema…»**: no adivines otro lote. Avisa al encargado para corregir la caja o el stock.
- **«En el lote … pistoleaste más de lo que pusiste en «Sacar»…»**: corrige la cantidad o quita la caja con ✕.
- **«N lote(s) no se movieron…»**: pulsa **Reintentar lo que no se movió**. Si un lote ya no se puede mover, pulsa **Quedarse con lo movido**.
- **«Ya movido — Este producto ya salió de su bodega: no se puede cambiar.»**: es correcto; lo movido no se deshace desde aquí.

**Reglas**
- Lo que está **«En tránsito» no es stock disponible**: no lo entregues ni lo cuentes en ninguna bodega hasta marcarlo recibido.
- Marca **Recibido** solo cuando la mercadería está físicamente en la bodega de destino.
- Saca primero el lote que vence antes, salvo que la caja pistoleada diga otro.

---

## 5. Distribución a centros

**Para qué sirve**
Para repartir entre los centros una compra global (SDC → orden de compra). Se arma una lista por centro con el mismo formato de las planillas de los centros (**Convenio Marco** o **No Marco**), se descarga en Excel para confirmar y se entrega con actas. Cada distribución lleva un correlativo **DIST-AAAA-NNNN**.

**Quién lo usa**
Encargado de bodega, Administrador y Superadministrador.

**Paso a paso**
1. Entra a **MOVIMIENTOS → Distribución a centros**.
2. Crea la distribución de una de dos formas:
   - **Nueva distribución**: escribe el nombre (por ejemplo, «SDC 1122 · insumos de curación») y elige el tipo de compra (**Convenio Marco** o **No Marco**).
   - **Importar Excel**: elige la planilla de los centros (una hoja por centro).
3. En el detalle completa **Nombre**, **Tipo de compra**, **N° de SDC**, **Orden de compra asociada** (cuando exista) y **Estado**.
4. Cada centro tiene su pestaña. Con **+ Centro**, **Renombrar**, **Quitar centro** y **+ Agregar línea** ajustas la lista.
5. Por cada línea verás:
   - **Entregado antes**: escríbelo a mano solo si se entregó antes de usar el Visor.
   - **Entregado con actas**: se calcula solo.
   - **Pendiente**.
   - **Stock / se puede entregar**: lo que hay en Bodega Central.
6. Pulsa **Guardar**.
7. Para mandarla a confirmar: **Descargar Excel** (marca **con columna Entregado** si quieres incluir lo ya entregado).
8. Para entregar: en la pestaña del centro pulsa **Entregar a este centro (acta)**. Se abre **Actas de entrega** con el acta precargada: lo que hay en stock se entrega y lo que falta queda pendiente. Sigue el capítulo 3.


**Sin internet:** no verificado. Trabaja esta pantalla con conexión.

**Si pasa esto…**
- **«No encontré líneas en ninguna hoja (se busca la columna «DESCRIPCIÓN»)»**: la planilla no tiene la columna DESCRIPCIÓN. Revisa el archivo.
- **«Un acta admite 60 productos: se armó con los primeros 60…»**: emite esa acta y repite para el resto.
- **«Este centro no tiene cantidades pendientes de entrega.»**: ya se entregó todo.
- **Aparece «sin stock en sistema»**: la orden aún no se ha ingresado. Se podrá entregar cuando se ingrese.

**Reglas**
- No anotes a mano en «Entregado antes» lo que ya salió con actas del Visor: se contaría dos veces.
- Las distribuciones no se borran: se archivan (estado **Archivada**).

---

## 5-b. Pendientes por entregar

**Para qué sirve**
Muestra, por centro, lo que se pidió en las actas y todavía no se entrega, cruzado con el stock disponible. La campana avisa cuando ya hay stock para entregar.

**Quién lo usa**
Encargado de bodega, Administrador y Superadministrador.

**Paso a paso**
1. Entra a **MOVIMIENTOS → Pendientes por entregar**.
2. Arriba ves el resumen: centros, productos pendientes y cuántos tienen stock para entregar ahora.
3. Abre un centro. Cada producto aparece agrupado por fecha, acta, orden o distribución, con su estado: **Completo**, **Se pueden N** o **Sin stock**.
4. **Hoja de picking** (de un centro) o **Hoja de picking (todos)**: imprime lo que hay que retirar de bodega.
5. **Imprimir pendientes**: imprime la lista para enviar al centro.
6. Para entregar, arma el acta en **Actas de entrega** (capítulo 3).
7. **Actualizar** recarga los datos.


**Sin internet:** muestra lo último descargado; para ver datos al día, necesita conexión.

**Reglas**
- Esta pantalla **no entrega nada**: solo informa. La entrega siempre es con acta.

---

## 6. Oxígeno portátil

**Para qué sirve**
Para llevar el control de cada balón de oxígeno portátil por su **N° de serie**: estado, recargas, préstamos o entregas a centros e incidencias. Los balones son **equipos**, no insumos: no se descuentan del inventario.

Estados: **Lleno**, **Vacío**, **En recarga**, **Entregado a centro**, **Fuera de servicio**.

**Quién lo usa**
Encargado de bodega, Administrador y Superadministrador. Enfermería no tiene acceso.

**Paso a paso — Dar de alta balones**
1. Entra a **MOVIMIENTOS → Oxígeno portátil**.
2. Pulsa **+ Agregar balones**.
3. Escribe los **N° de serie** (uno por línea o separados por coma), y elige **Capacidad**, **Tipo de gas**, **Proveedor**, **Estado actual** y **Fecha de carga**.
4. Pulsa **Guardar**.

**Paso a paso — Registrar lo que pasa con un balón**
1. En la fila del balón, abre **Acción…** y elige una opción:
   - **Enviado a recarga**
   - **Recarga recibida (lleno)**
   - **Marcar como vacío (se usó)**
   - **Devuelto al SAR**
   - **Registrar incidencia (sin cambiar estado)**
   - **Fuera de servicio**
   - **Volver a servicio (vacío)**
   - **Cambiar capacidad**
   - **Cambiar tipo de gas**
2. Completa la fecha y los datos que pida, y pulsa **Guardar**.
3. **Historial** muestra todo lo que le ha pasado al balón.
4. **Editar** corrige datos mal escritos (serie, capacidad, gas, proveedor, fecha, recargas). Pide un **motivo** y deja un código **CAM**. El estado no se cambia desde Editar: se cambia con **Acción…**.

**Paso a paso — Entregar balones a un centro con acta**
1. Marca la casilla de los balones **llenos** que salen (solo los llenos tienen casilla).
2. Pulsa **Acta de entrega (N)**.
3. Escribe el **Centro**, el documento asociado (opcional), quién **Entrega** y quién **Recibe**.
4. Pulsa **Emitir acta**. Sale un acta **AE** con el mismo formato y correlativo de las actas de insumos, y se descarga el PDF.
5. Cuando esté firmada, súbela con **Subir firmada** (en el panel «Prestados a otros centros» o en Actas de entrega).

**Paso a paso — Préstamo de balones (llenos o vacíos)**
1. En el panel **«Prestados a otros centros»**, pulsa **Registrar préstamo**.
2. Elige el centro, la fecha de entrega y los balones (solo los que están en el SAR), y escribe quién entrega y quién recibe.
3. Pulsa **Generar acta y registrar**: se emite un acta AE y se descarga para firmar.
4. Después usa **Subir firmada**, **Agregar fotos**, **Ver acta firmada** o **Ver acta y bitácora**.

**Precintos:** **Precinto** (por balón) o **Precintos (N)** (todos los de la lista filtrada) imprimen la etiqueta de control con el N° de serie.


**Sin internet:** **necesita internet**. Esta pantalla no tiene cola sin conexión.

**Si pasa esto…**
- **«El balón … no está lleno»**: solo se entregan con acta los balones **Lleno**.
- **«Ya existe otro balón con el N° de serie …»**: revisa la serie; no se repite.
- **«Elige el motivo de la corrección.»**: en **Editar**, el motivo es obligatorio.

**Reglas**
- El estado del balón en el Visor debe ser **el mismo que en la realidad** en todo momento.
- No se registran datos de pacientes (ni a quién se le puso el balón).
- Un acta de oxígeno no se anula: cuando el balón vuelve, se registra **Devuelto al SAR**.

---

## 7. Bodegas (administración)

**Para qué sirve**
Para crear bodegas, cambiarles el nombre, definir si usan estantes, cambiar el encargado, cerrarlas y archivarlas.

**Quién lo usa**
Administrador y Superadministrador. El Encargado de bodega no ve este menú.

**Paso a paso — Crear una bodega**
1. Entra a **INVENTARIO → Bodegas** («Gestión de Bodegas»).
2. En **Nueva Bodega**, completa:
   - **Nombre del Recinto**.
   - **Tipo de Recinto**: Bodega Principal, Farmacia / Despacho, Bodega Satélite, Bodega Transitoria (stock de turno), Carro de paro o Centro externo.
   - **Responsable**: escribe el nombre del encargado; se sugieren los ya usados.
   - **Capacidad (Pallets / M2)**.
   - **Prefijo de códigos (opcional)**, por ejemplo BS.
3. Marca **Usar estantes / ubicaciones** si la bodega se ordena por estante. Deja **Bodega Operativa** marcada.
4. Pulsa **Crear Bodega**. Aparece **«Éxito — Bodega creada correctamente.»**

**Paso a paso — Ver y editar una bodega**
1. Pulsa la tarjeta de la bodega. Se abre el detalle: **Stock Total**, **Estado**, **Responsable** y **Qué hay en esta bodega**.
2. **Cambiar encargado**: pulsa el lápiz junto al Responsable.
3. **Nombre de la bodega**: escríbelo y pulsa **Guardar nombre**. Si hay productos con el nombre anterior, el Visor pregunta si pasan al nombre nuevo; el stock sigue en la misma bodega.
4. **Estantes y etiquetas**: activa o desactiva **Usar estantes / ubicaciones en esta bodega**, define el **Prefijo** y pulsa **Guardar**. Desde aquí también se imprime la **Etiqueta general de la bodega**.
5. Una bodega inactiva o archivada muestra **Reactivar**.

**Paso a paso — Cerrar una bodega con stock**
1. En el detalle, pulsa **Cerrar bodega…**.
2. En **Devolver el stock a**, elige el destino (normalmente la Bodega Central).
3. Pulsa **Ver qué se movería** y revisa la lista.
4. Escribe el **Motivo del cierre** y, para confirmar, **el nombre exacto de la bodega**. Si hay controlados, confirma que el destino puede guardarlos bajo llave.
5. Pulsa **Cerrar y mover el stock**. Todo pasa al destino, queda en el Historial (folio **CIE**) y la bodega queda **archivada**.

**Paso a paso — Eliminar**
- **Eliminar** (abajo, en rojo) solo borra una bodega **sin stock** (incluido lo reservado y lo adeudado).
- Si tiene stock, ofrece **archivarla**: queda inactiva, conserva su stock e historial y se puede reactivar.


**Bodegas de uso (transitoria, aseo, oficina):** qué tipo de pedidos recibe cada bodega de uso se fija en **MOVIMIENTOS → Bodega transitoria** (ver la parte del manual correspondiente).

**Sin internet:** **necesita internet**.

**Si pasa esto…**
- **«Acceso Denegado — Solo administradores pueden crear bodegas.»**: tu rol no lo permite.
- **«Ya existe otra bodega con ese nombre.»**: elige otro nombre.
- **«Hay productos en cuarentena — No se puede cerrar hasta resolverlos.»**
- **«Cierre incompleto»**: lo ya movido quedó registrado; repite el cierre y no se duplica nada.

**Reglas**
- Una bodega con stock **no se elimina**: se cierra (el stock vuelve a otra bodega) o se archiva.
- Los medicamentos controlados solo van en bodegas que se guardan bajo llave.
- Escribe el nombre sin espacios de más y no crees dos bodegas para el mismo lugar.

---

# 8. REGLAS DEL SITIO

Estas reglas valen para **todo el personal** que usa el Visor: bodega, enfermería, TENS y administrativos. Vienen de las decisiones del proyecto y de cómo funciona hoy el sistema.

## 8.1 Tu cuenta es personal

- Entra siempre con **tu propio correo y tu clave**. **No prestes tu clave** ni uses la sesión abierta de otra persona.
- Todo lo que haces queda registrado **a tu nombre** (tu correo): ingresos, traspasos, actas, ajustes, solicitudes procesadas. Si otra persona usa tu cuenta, lo que ella haga queda como tuyo.
- Al terminar el turno en un equipo compartido, pulsa **Salir**. Si quedan operaciones sin internet, el Visor te avisa: espera a que se envíen (o pulsa **Sincronizar ahora**) antes de salir.
- Las cuentas las crea el administrador en **Usuarios**. Cada persona tiene un rol y solo ve lo que su rol permite.
- Excepción: la página **«Pedir insumos»** (la de los servicios, en el teléfono) no usa cuenta: quien pide escribe su **nombre y correo**. El **inventario de la bodega de uso** sí se hace con usuario y clave personal.

## 8.2 No hay datos de pacientes

El Visor es un sistema **logístico**: registra dónde está cada insumo y quién lo movió, **no a quién se le administró**.

- **Nunca** escribas nombre, RUT, domicilio, número de cama ni ningún otro dato de un paciente: ni en observaciones, ni en notas, ni en el nombre de un producto, ni en el texto «Copiar para WhatsApp».
- No subas fotos ni escaneos donde aparezca un paciente (por ejemplo, una receta o una etiqueta con nombre).
- **Única excepción:** el **folio DAU** de los **medicamentos controlados** (estupefacientes y psicotrópicos), que se pide al registrar su consumo en bandeja o carro de paro. Se guarda en un registro aparte, de acceso restringido. Los traspasos entre bodegas no lo piden.
- El Libro de Control de estupefacientes y psicotrópicos (DS 404 y DS 405) sigue siendo obligación del establecimiento y del Director Técnico, en su propio libro. **El Visor no lo reemplaza.**

## 8.3 Quién aprueba qué

| Acción | Quién la hace | Quién la aprueba |
|---|---|---|
| Ajuste de stock (sumar o restar) | Cualquier rol de bodega | **Superadministrador**. Si lo hace el Superadministrador, se aplica directo; si lo hace otro rol, queda como solicitud con código AJU hasta que el Superadministrador lo apruebe. |
| **Faltantes** de una toma de inventario | Quien cierra la toma | **Superadministrador**. Si no eres administrador, también los sobrantes quedan como solicitud. |
| Corregir cantidad, lote o vencimiento de un ingreso | Quien ingresó | Directo, dentro de las **12 h** y si no salió nada del producto. Después, solo con Ajuste. |
| Emitir acta de entrega | Encargado de bodega, Administrador, Superadministrador | — |
| Confirmar entrega, editar o eliminar un acta | **Administrador o Superadministrador** | — |
| Procesar y recibir solicitudes | Encargado de bodega, Administrador, Superadministrador | — |
| Inventario de una bodega de uso | Encargada de transitoria (cuenta) | Bodega: **Aceptar y descontar** o **Pedir reconteo** |
| Crear, renombrar, cerrar o eliminar bodegas | **Administrador o Superadministrador** | — |

## 8.4 FEFO: sale primero lo que vence primero

- En toda salida (acta, transferencia, solicitud) se usa primero el **lote que vence antes** (FEFO: *First Expired, First Out*). Es la práctica que piden las Buenas Prácticas de Distribución de la UE para la rotación de existencias.
- El Visor ya lo propone:
  - Las **actas** reservan por el lote que vence primero.
  - Las **solicitudes** prellenan ese lote.
  - En **Transferencias**, los lotes aparecen ordenados por vencimiento, pero **tú eliges** cuánto sacar de cada uno.
- Si sacas físicamente otro lote (por ejemplo, porque la caja pistoleada es de otro), **registra ese lote**: lo que dice el Visor debe ser lo que salió de verdad.
- Lo **vencido** no se entrega. Lo que está en **CUARENTENA** no se puede mover ni entregar.

## 8.5 Lote obligatorio al despachar

- Regla decidida: un producto que entró **sin lote (S/L)** debe tener su lote **antes de despacharlo** (acta, transferencia o solicitud). Sin lote no hay trazabilidad si se retira un producto del mercado.
- **El Visor todavía no lo exige solo.** Mientras tanto, es una norma de trabajo:
  - Si vas a despachar algo que figura **S/L** y la caja sí trae lote, **avisa al encargado** para corregirlo antes (Editar ingreso dentro de 12 h, o Ajuste).
  - No despaches un controlado sin lote.
- Al ingresar, marca «Este producto no trae lote ni fecha de vencimiento» **solo** si de verdad no los trae.

## 8.6 Sin internet: deja el Visor abierto

El Visor guarda una copia de los datos en el equipo y la mantiene al día sola. Sin conexión:

- **Funcionan sin internet:**
  - Ingresos e Ingreso rápido.
  - Transferencias.
  - Ajustes.
  - Emitir actas (salvo las de una orden de compra).
  - Confirmar productos, Procesar y Marcar recibido en Solicitudes.
  - Toma de inventario.
  - Etiquetas de cajas.
  Todo eso queda guardado en el equipo con un **folio provisional** (por ejemplo, ING-P-…, AE-P-…) y se envía solo.
- **Necesitan internet:**
  - Confirmar entrega de un acta, subir actas firmadas, eliminar actas.
  - Actas de una orden de compra.
  - Leer fotos en Ingreso rápido.
  - Oxígeno portátil.
  - Crear o cerrar bodegas.
- **Qué hacer:**
  1. **Mantén el Visor abierto** y con **tu misma sesión**. La cola se envía sola al volver internet, cada minuto y al volver a la pantalla.
  2. Mira abajo a la derecha: **«N sin sincronizar»**. Al tocarlo se abre «Hecho sin conexión», con **Sincronizar ahora**.
  3. Si algo quedó **«para revisar»**, el stock cambió entre medio (otra persona movió el producto). Avisa al encargado: se reintenta o se **Descarta**. El Visor **nunca descuenta a ciegas**.
  4. **No cierres sesión** con operaciones pendientes. Cada persona aplica solo las suyas: lo que hiciste tú se envía cuando **tú** vuelves a entrar en ese equipo.
- Mientras no haya internet, lo que ves en pantalla es lo último descargado. Lo que hiciste sin conexión todavía no se resta de la vista.
- En **iPhone** la cola avanza solo con el Visor abierto. **Instala el Visor en la pantalla de inicio**: si lo usas solo en Safari y pasan unos 7 días sin abrirlo, el teléfono puede borrar los datos guardados.

## 8.7 No borres los datos del navegador

En el navegador del equipo quedan:
- las **operaciones hechas sin internet** que aún no se envían;
- el **borrador del acta** que estás armando y la firma de quien entrega;
- el **conteo de la toma de inventario** en curso;
- la copia de los datos para trabajar sin internet.

Por eso:
- **No uses** «Borrar datos de navegación», «Borrar caché» ni limpiadores del teléfono en los equipos del SAR.
- **No uses ventanas de incógnito** para trabajar en el Visor: al cerrarlas se pierde lo guardado.
- Si el Visor dice **«Hay una versión nueva del visor»**, pulsa **Actualizar**: no se pierde lo pendiente. Si el Visor va mal, **pregunta antes** de borrar nada.

## 8.8 Correlativos y folios

Cada documento tiene un número que **no se repite ni se reutiliza**. Si un documento se anula, su número queda registrado como **ANULADO**. Puede haber saltos en la numeración (un número que se tomó y la operación falló): es normal y queda a la vista de la auditoría. En el menú **Directorio → Nomenclaturas** (administradores) está la lista completa.

| Código | Formato (2026) | Qué es |
|---|---|---|
| **AE** | AE-2026-0021 | Acta de entrega (también de oxígeno) |
| **HIS** | HIS-45 | Acta histórica (de antes del sistema) |
| **SOL** | SOL-2026-0001 | Solicitud de insumos. Mientras llega el número oficial, se ve uno provisional **SI-AAAAMMDD-HHMM-…** |
| **DIST** | DIST-2026-0003 | Distribución a centros |
| **ING** | ING-2026-000045 | Ingreso |
| **INV** | INV-2026-00012 | Ingreso rápido y toma de inventario |
| **AJU** | AJU-2026-000047 | Ajuste de stock |
| **CAM** | CAM-2026-000046 | Corrección de datos con código de seguimiento |
| **TRA** | TRA-2026-00031 | Traspaso entre bodegas (también en solicitudes) |
| **REP** | REP-2026-00004 | Reposición de bodega de uso |
| **CIE** | CIE-2026-00002 | Cierre de bodega |
| **REC** | REC-2026-00015 | Recepción de mercadería de una orden |
| **BAN** | BAN-2026-00118 | Bandeja de turno |
| **SUG** | SUG-2026-00009 | Sugerencia de compra |
| **BUL** | BUL-2026-000123 | Caja etiquetada (la que se pistolea) |
| **PI** / **PO** | PI-2026-0007 / PO-2026-0003 | Precinto de inventario / precinto de oxígeno |
| **SAR** | SAR-000013 (lote: SAR-000013-L02) | Código del producto y de su lote |
| **ERR** | ERR-AUT-001 | Código de un aviso de error |
| **…-P-…** | AJU-P-20261115-7KQ2 | Folio **provisional**, hecho sin internet. Se reemplaza por el definitivo al sincronizar. |

Desde el **1 de enero de 2027**, AE, SOL, DIST, PI y PO pasan a 5 dígitos, e ING, CAM y AJU tienen cada uno su propio contador. Los números antiguos no cambian.

**Reglas:**
- Anota el folio en los papeles físicos (guía, acta, caja). Con él se encuentra todo en el Visor.
- Nunca escribas un folio «a mano» inventado. Si es provisional (con **-P-**), espera el definitivo antes de enviarlo a otra persona.

## 8.9 Cada firma tiene una responsabilidad

| Quién | Qué declara |
|---|---|
| **Quien registra en el Visor** (cualquier acción) | Que lo registrado es lo que pasó físicamente. Tu correo queda en el historial, que **no se puede modificar**. |
| **Quien entrega** (firma del acta) | Que entregó esos productos, en esas cantidades, a ese centro. Su nombre y cargo salen impresos. |
| **Quien recibe** (firma del acta) | Que recibió conforme lo que dice el acta. Si falta algo, debe anotarlo en el acta **antes** de firmar. |
| **Quien confirma la entrega** (sube el acta firmada) | Que el documento está firmado y corresponde a esa acta. Con eso el stock se descuenta. **No confirmes un acta sin la firma de quien recibe.** |
| **Quien marca «Recibido»** en una solicitud | Que la mercadería llegó a la bodega de destino. |
| **Quien aprueba un ajuste** (Superadministrador) | Que la diferencia está justificada con el motivo indicado. |

## 8.10 Qué hacer ante un error

1. **Lee el aviso completo.** Los avisos de error traen una referencia **«Ref. ERR-XXX-NNN»**. El aviso desaparece a los pocos segundos: **sácale una foto o una captura de pantalla**.
2. **No repitas la operación a ciegas.** Primero revisa si quedó hecha:
   - en **Historial**;
   - en la bitácora del acta;
   - en el indicador **«N sin sincronizar»**.
   Repetir un ingreso crea un segundo ingreso.
3. **No intentes «arreglarlo» con otro movimiento** (por ejemplo, un traspaso de vuelta o un ingreso inventado). Las diferencias se corrigen con **Ajustes de Stock** (motivo y código AJU), que aprueba el Superadministrador.
4. **Avisa al encargado o al administrador** con:
   - la foto del aviso (con su Ref.);
   - qué estabas haciendo;
   - la pantalla y la hora;
   - el folio (AE, SOL, ING…).
5. Si la página se congela («La página no responde»), cierra la pestaña y vuelve a abrir el Visor. **No borres los datos del navegador** (8.7).

---

