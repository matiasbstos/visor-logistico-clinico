# Parte 3 · Catálogo de productos, órdenes de compra, ajustes, historial, auditoría y fotos

> Versión del Visor revisada: v21.247. Los nombres de botones y mensajes están copiados del sistema tal como aparecen en pantalla.

**Roles que se nombran en esta parte** (así aparecen en **Usuarios**):
- **Superadministrador** («Super Admin (Control Total)»): ve y hace todo.
- **Administrador** («Administrador (Inventario)»): todo, menos lo marcado «solo superadministrador».
- **Operador** («Administrador de Bodega»): trabaja la bodega; no ve **Usuarios**, **Configuración**, **Directorio** ni **Repetidos y salud**.
- **Enfermero:** no entra a ninguna de las pantallas de esta parte.
- **Solicitante** y **Solo Bodega transitoria:** tampoco las ven (tienen su propia pantalla).

**Atajo para encontrar una pantalla:** botón **Buscar** de la barra superior (o teclas **Ctrl+K** o **/**). Escribe, por ejemplo, «ajustes», «merma» u «OC».

---

## Catálogo de productos

**Para qué sirve:** tener una sola ficha por producto, con su nombre, su ID de Mercado Público, su proveedor, sus fotos (caja y producto) y dónde está su stock. El catálogo se llena solo: cada orden de compra que se ingresa y cada ingreso de existencias agregan sus productos.

Hoy el catálogo se usa desde cuatro lugares:
- **COMPRAS · ADQUISICIONES SAR → Catálogo de Insumos**: tarjetas con foto, stock y estado. Al tocar una tarjeta se abre la **ficha del producto**.
- **Seguimiento de OC → Catálogo de productos**: lista para confirmar fotos y subirlas a mano.
- **INVENTARIO → Existencias → lápiz (Editar Insumo Clínico)**: el **ID del producto** y la foto principal.
- **Revisar productos parecidos**, **Repetidos y salud** y **Directorio → Nomenclaturas y correlativos**: para mantener el catálogo ordenado.

**Quién lo usa:**
- **Catálogo de Insumos**, la ficha y **Revisar productos parecidos**: operador, administrador y superadministrador.
- **Repetidos y salud** y **Directorio**: administrador y superadministrador.
- **Pedir al teléfono** (en Editar insumo) y la sección **Fotos de productos**: solo superadministrador.

### A. Buscar un producto en el Catálogo de Insumos
1. Menú lateral → **COMPRAS · ADQUISICIONES SAR → Catálogo de Insumos** (también desde **Inicio → Accesos → Catálogo de insumos**).
2. Arriba ves cuatro números: **Stock maestro** (productos en el catálogo), **Stock Saludable**, **Stock Bajo / Reorden** y **Quiebre Crítico** (stock 0).
3. Escribe en el buscador. Busca por **descripción, ID de Mercado Público, nombre de inventario o proveedor**.
4. Si quieres, filtra con **Categoría: Todas** y **Estado Stock: Todos** (**En Stock Óptimo**, **Stock Bajo / Reorden**, **Quiebre Crítico**).
5. Los productos salen agrupados por categoría. Cada tarjeta muestra la foto, el **Cód. MP**, el proveedor, las **un. en stock** por bodega y, si hay una orden abierta, **«Pendiente de recepción: N un. (OC …)»**.
6. Toca la foto para verla en grande. Toca el resto de la tarjeta para abrir la ficha.


### B. La ficha del producto
1. Desde una tarjeta del Catálogo de Insumos, toca el producto. La ficha se abre al costado (en el teléfono, a pantalla completa).
2. Arriba: nombre, **Cód. MP**, categoría, **unidades en stock**, **bodega(s)** y **próximo vencimiento**.
3. **Fotos:** foto de la **Caja / envase** y foto de **Cómo es el producto** (ver letra C).
4. **Dónde está y por lote:** bodega, estante, lote, vencimiento y cantidad. Lo que vence antes va primero; lo vencido sale en rojo y lo que vence en menos de 90 días, en amarillo.
5. **Ingresos y movimientos:** primer ingreso, último ingreso, último movimiento y los 25 movimientos más recientes. El resto está en **Historial** o en **Auditoría → Contable**.
6. Con las flechas **▲ ▼** (o las del teclado) pasas al producto anterior o siguiente. **Esc** o **×** cierra.


### C. Fotos desde la ficha
Cada producto debe tener **dos fotos**: la **caja o envase** (la que se ve en todo el Visor) y **cómo es el producto** fuera de la caja.
1. En la ficha, sección **Fotos**, elige:
   - **Foto de la caja** (o **Cambiar foto de la caja**): abre la cámara del teléfono o el selector de archivos.
   - **Foto del producto (cómo es)** (o **Otra foto del producto**): hasta 4 fotos extra.
   - **Buscar en internet**: busca en la tienda de Convenio Marco y en internet. Tarda 20 a 40 segundos.
2. Si usaste **Buscar en internet**, aparecen dos grupos: **Caja / envase** y **El producto**. Toca una foto y elige **Usar como caja** o **Usar como producto**. Si ninguna sirve, sácale foto con los botones de arriba o abre **Ver más en Google Imágenes**.
3. Al guardar aparece **«Foto guardada»**.
4. Para quitar una foto extra, toca **✕** junto a ella.

### D. Confirmar las fotos que el sistema encontró solo
El Visor busca fotos automáticamente: cada 30 minutos entre 8:00 y 17:00, mientras haya un equipo de bodega con el Visor abierto. Esas fotos se muestran con una marca naranja **«?»** (**por confirmar**) hasta que alguien las revise.
1. En la ficha, debajo de la foto por confirmar:
   - Caja: **✔ Es correcta** o **✖ No es**.
   - Producto: **✔** (confirmar) o **✕** (no es: se quita y no se vuelve a buscar sola).
2. También puedes revisarlas en **Seguimiento de OC → Catálogo de productos → Fotos por confirmar**: **Ver en la tienda**, **Es este producto** o **No es**. Ahí solo salen las fotos de la tienda de Convenio Marco.
3. Para ver qué productos no tienen foto: **Catálogo de Insumos → Productos sin fotografía (N)**. Cada producto dice por qué le falta («Caja: no se encontró (fecha) · se vuelve a buscar el …» o «aún sin buscar») y trae el botón **Buscar o sacar foto**.
4. **Buscar fotos que faltan** lanza la búsqueda ahora mismo y sigue en segundo plano: puedes seguir trabajando, y el Visor avisa al terminar.


### E. Fotos a mano desde Seguimiento de OC → Catálogo de productos
1. **Seguimiento de OC → Catálogo de productos**.
2. Busca con **«Buscar por nombre, código o proveedor…»**.
3. En la fila del producto:
   - **Buscar foto**: abre Google Imágenes con el nombre.
   - **Pegar**: pega una imagen que copiaste (clic derecho → «Copiar imagen»). No aparece en el teléfono.
   - **Subir**: elige un archivo de imagen.
4. **Cargar productos y fotos de las órdenes ya ingresadas** vuelve a leer todas las órdenes y busca sus fotos.
5. Cierra con **Cerrar**.

### F. El ID del producto (ID de Mercado Público)
Es el número de 6 o 7 dígitos que trae la orden de compra entre paréntesis (por ejemplo, 2228845). Sirve para unir el producto con su orden y encontrar su foto. Es distinto del **Código SAR** (SAR-000123), que el Visor asigna solo a cada producto.
- Al ingresar una orden de compra, el ID queda guardado solo.
- En **Ingresos**: campo **ID MERCADO PÚBLICO** (opcional).
- En **Existencias → lápiz → Editar Insumo Clínico**: campo **ID del producto**.
- En **Recibir mercadería → Agregar producto**: campo **ID Mercado Público (opcional)**.
- En **Auditoría → Disponible**: los productos provisionales sin ID traen el botón **Asignar ID**.

### G. Revisar productos parecidos
1. Menú lateral → **MOVIMIENTOS → Revisar productos parecidos**.
2. Verás **Posibles duplicados (N grupo(s))**. Cada grupo dice si son **nombres casi iguales** (una letra, un punto, un espacio o un acento de diferencia), **mismo nombre en varios lugares** o productos que comparten el mismo ID con nombres distintos.
3. Más abajo aparece la lista **Ingresados manualmente, aún provisionales**: productos que se crearon al emitir un acta sin stock.
4. Esta pantalla **no cambia nada**. Anota lo que haya que unir y avísale a un administrador, que lo une en **Repetidos y salud**.
5. **Actualizar** vuelve a comparar.

**Ojo:** el mismo producto en dos bodegas distintas, o tallas distintas («TALLA S», «TALLA M», «TALLA L»), aparecen como parecidos, pero **no son duplicados**. No se unen.

### H. Repetidos y salud del inventario (administrador)
1. Menú lateral → **INVENTARIO → Repetidos y salud** (con un número rojo si hay casos).
2. La pantalla **Salud del inventario** revisa: **Nombres de bodega con espacios de más**, **Productos con stock sin bodega**, **Productos repetidos en una bodega**, **Unidades adeudadas en productos que ya tienen stock**, **Bodega que no existe**, **Lotes que no suman el total** y **Cantidades negativas**.
3. Antes de corregir, **descarga el respaldo del día** (lo pide la misma pantalla).
4. Según el caso, usa **Unificar nombre**, **Asignar**, **Unir**, **Regularizar** o **Descontar N**. Cada botón pide confirmar y explica qué va a pasar.
5. **Volver a revisar** recarga la revisión.


### I. Directorio → Nomenclaturas y correlativos (administrador)
1. Menú lateral (abajo) → **Directorio** → pestaña **Nomenclaturas y correlativos**.
2. Es una tabla, solo para leer, con todos los códigos que usa el Visor: formato, ejemplo, para qué sirve, quién lo asigna y el último número emitido. Por ejemplo: SAR, lote, ING, CAM, AJU, AE, SOL, REC, BUL y TRA.
3. Busca con **«Buscar formato, ejemplo o uso…»**.
4. La otra pestaña, **Errores y alertas**, explica cada aviso del sistema por su código **ERR-XXX-NNN**.

**Si pasa esto…**
- **La tarjeta dice «0 un. en stock», pero el producto sí está en Existencias:** el catálogo suma el stock por nombre. Si el producto está guardado en Existencias con otro nombre, no lo suma. Revisa el nombre en **Revisar productos parecidos**.
- **«Aún no hay productos…»:** espera unos segundos. El catálogo vuelve a intentar mientras esté vacío. Si sigue igual, usa **Cargar productos y fotos de las órdenes ingresadas**.
- **«Para buscar en internet falta actualizar el script…»:** avísale al administrador (**Configuración → SCRIPT Y CORREO**).
- **«No se pudo pegar»:** el navegador no dio permiso. Usa **Subir**.
- **«Máximo 4 fotos extra: quita una antes.»:** quita una foto con **✕** y vuelve a intentar.

**Reglas**
- **Un producto = una ficha.** Antes de crear un producto nuevo (en un ingreso, una recepción o un acta), búscalo por nombre y por ID.
- El nombre del producto va en **MAYÚSCULAS**, igual que en la orden de compra.
- La **categoría** (familia clínica) y el **tipo de insumo** (médico / aseo / oficina) son cosas distintas: llena las dos.
- Una foto propia (subida o sacada con la cámara) manda sobre la foto automática.
- Si una foto automática no corresponde, márcala **No es**: así no vuelve a aparecer.

**Sin internet:** el Catálogo de Insumos y la ficha muestran la última copia guardada en el equipo. Las fotos propias se ven, pero puede que las de la tienda o de internet no carguen. Buscar fotos, confirmar y subir **necesitan conexión**.

---

## Órdenes de compra: Seguimiento de OC

**Para qué sirve:** seguir cada orden de compra (OC) de Mercado Público desde que se ingresa hasta la recepción conforme: plazos, qué llegó, qué falta, incidencias, archivos y una bitácora con fecha y autor.

**Quién lo usa:** operador, administrador y superadministrador. Solo administrador y superadministrador ven **Anular** (una recepción), **Registrar decisión de multa**, **Cerrar seguimiento / Reabrir seguimiento**, **Configurar correo** y **Eliminar orden**.

### A. Ingresar una orden desde el PDF
1. Menú lateral → **COMPRAS · ADQUISICIONES SAR → Seguimiento de OC** (o **Inicio → Ingresar orden de compra**).
2. Toca **Ingresar desde PDF**.
3. En **Orden de compra (Mercado Público): PDF o Excel**, sube el archivo. El Visor lo lee y muestra lo que encontró.
4. Si tienes el **Cuadro de distribución**, súbelo en su recuadro (es opcional). En la tabla de memos, marca en **Cargar** los memos que corresponden (por defecto, los del SAR).
5. Si tienes el correo del despacho, pega su texto en **Correo del despacho**: así se leen el plazo para aceptar y los días de entrega.
6. **Revisa cada dato** (N° de orden, proveedor, fechas, plazos, productos, cantidades y valores). Puedes corregir, quitar una fila (**✕**) o agregarla (**+ Producto**).
7. Toca **Ingresar orden**. Se abre la ficha de la orden.

**Orden histórica:** si la orden ya se recibió y se usó antes de existir el Visor, marca **Orden histórica**, indica **Fecha de recepción** y adjunta, si los tienes, la recepción conforme y el acta. Queda cerrada y **no mueve stock**.

**Con cuadro Excel:** si no tienes el PDF, usa **Con cuadro Excel**. Ahí son obligatorios el **N° de orden**, la fecha **Aceptada por el proveedor** y el Excel del cuadro.


### B. La ficha de la orden
- **Plazo de la orden:** emitida, aceptada (opcional), plazo en días hábiles, fecha en que vence y multa. El cuadro de color dice **Por aceptar**, **Aceptación vencida**, **Vence en N días hábiles**, **Atrasada N días hábiles**, **Recibida completa** o **Seguimiento cerrado**.
- **Barra «Siguiente paso»:** dice qué hacer ahora y trae el botón que corresponde (**Recibir mercadería**, **Recibir lo que falta**, **Recepción conforme**, **Ir a Actas de entrega**). **Registrar aceptación** es opcional.
- **Pedido y recibido:** recibido / pedido por producto (se abre al tocarlo). Desde ahí también: **Buscar fotos de esta orden** y, cuando ya llegó algo, **Lotes y vencimientos** y **Descargar pendientes**.
- **Recepciones y recepción conforme**, **Pendiente de recibir**, **Discrepancias**, **Datos de la orden, memos y distribución**, **Archivos de la orden** y **Bitácora de la orden**.
- **← Órdenes** vuelve a la lista.


### C. Recibir mercadería (cuando llega el camión)
1. En la ficha, toca **Recibir mercadería** (o **Recibir lo que falta**).
2. Si la orden tiene varios memos, marca en **¿Qué memos se recibieron?** los que llegaron juntos.
3. En **Guías de despacho**, escribe el **N° guía de despacho**. Si quieres, sube la **Foto o PDF de la guía**: el Visor intenta leer el lote, el vencimiento y la empresa, y los deja escritos para que los revises. Si llegaron varias guías, usa **Agregar otra guía**.
4. Revisa la **Fecha** (por defecto, hoy).
5. Por cada producto, escribe en **Llega ahora** cuántas **unidades** llegaron. **✔ N** anota que llegó completo. **Marcar todo recibido** marca todos y **Limpiar** borra todo.
6. Revisa **Producto en inventario**: elige de la lista el nombre exacto que ya existe en bodega.
7. Si quieres dejar lote y vencimiento ahora, marca **Anotar lote y vencimiento ahora** (también se puede hacer después).
8. En **Cajas**, anota cuántas cajas o bultos llegaron: se imprime una etiqueta por caja.
9. Si algo vino mal, elige la **Incidencia** (**Dañado / defectuoso**, **Vencimiento corto**, **Producto distinto al pedido**, **Faltante**, **Otro**) y escribe el detalle.
10. Elige la **Bodega de destino** (por defecto, Bodega Central). Si no existe, el administrador la crea con **+ Nueva bodega**.
11. Deja marcado **Ingresar lo recibido al stock de …** para que el stock quede disponible y se descuente al entregarlo con un acta.
12. **Avisar por correo a la lista** viene marcado: avisa a Compras de esta recepción.
13. Toca **Guardar recepción**. Al final aparece **«Recepción cargada»** con su número **REC-AAAA-NNNNN**.
14. Después se abre la ventana **Recepción conforme · REC-…** con **Descargar PDF**, **Descargar Word**, **Editar datos** y **Cerrar**. Elige si es **Parcial** o **Total**.

Si un producto llegó pero no estaba en la lista: **Agregar producto** → escribe la descripción (el Visor sugiere nombres), el ID si lo tienes, **Pedido según el documento** y **Llega ahora** → **Agregar a la lista**.


### D. Recepción conforme con correo
1. Cuando ya está todo recibido, la barra dice **«Todo recibido. Siguiente paso: la recepción conforme…»**. Toca **Recepción conforme**. Si falta mercadería y quieres darla por conforme igual, usa **Recepción conforme con correo (parcial)**.
2. En **Guías o facturas del proveedor**, revisa el tipo (**Guía de despacho** / **Factura**), el **N° del documento** y sube el **PDF** de cada una (**Agregar otra guía o factura** si son varias).
3. Revisa **¿Con qué fecha se emite el acta?**: el Visor propone el día en que se registró la recepción. **Usar hoy** la cambia a hoy.
4. **Tipo de recepción:** **Total** o **Parcial (faltan N unidades)**.
5. Revisa el **Encabezado del acta** y el detalle: puedes quitar o corregir líneas, y queda igual en el PDF.
6. Revisa **Contraparte técnica (firma del acta)**, **Correo firmado por** y **Cargo**.
7. **Enviar correo con el acta y la guía/factura a la lista** viene marcado. Revisa **Para** y **Cc**.
8. Toca **Guardar**. El acta queda en **Archivos de la orden** y en la bitácora.

Después puedes usar **Editar recepción conforme** o **Regenerar recepción conforme (modelo vigente)** desde **Archivos de la orden**. Cada recepción (REC-…) tiene además sus propios botones **PDF**, **Word** y **Editar**.


### E. Otras acciones de la ficha
- **Lotes y vencimientos:** completa el lote y el vencimiento de lo que entró sin ellos («S/L»). Puedes asignar solo una parte de las unidades.
- **Descargar pendientes:** baja un archivo CSV (se abre con Excel) con lo que falta por recibir.
- **Resolver: (producto):** cierra una incidencia. Hay que escribir cómo se resolvió.
- **Agregar archivo:** guarda en la orden un PDF, un Excel o una imagen (máximo 8 MB), con su tipo y un comentario.
- **Bitácora de la orden:** escribe el comentario, elige la **Etapa** (opcional), adjunta archivos si quieres y toca **Registrar comentario**. No se puede editar ni borrar. **Enviar correo a la lista** viene desmarcado.
- **Generar acta (N un.):** si la orden trae productos para otros centros, arma el acta de entrega para ese centro con lo que ya está en bodega.
- **Anular** una recepción (administrador): pide el motivo, devuelve lo recibido a «por recibir» y lo saca del stock. No se puede si ese stock ya se entregó.
- **Eliminar orden** (administrador): solo si no tiene recepciones. Hay que escribir el N° de la orden para confirmar.

**Si pasa esto…**
- **«Ya existe — Esa orden ya está en seguimiento.»:** la orden ya fue ingresada. Búscala en la lista.
- **«Revisa antes de guardar …»** (producto nuevo, guía ya registrada): lee el aviso. Si está correcto, toca **Guardar recepción** otra vez.
- **«N producto(s) no existen en el inventario y se crearían como nuevos»:** casi siempre es un nombre mal elegido en **Producto en inventario**. Corrígelo antes de guardar para no crear un duplicado.
- **«Cantidad no válida»:** escribe un número entero que no supere lo pendiente.
- **«Vencimiento pasado»:** revisa la fecha de vencimiento.
- **Recepción conforme: «Hay N incidencia(s) abierta(s): resuélvelas antes…»:** usa **Resolver** en **Discrepancias**.
- **«Faltan N unidad(es) por recibir. … marca "Recepción parcial".»:** cambia el **Tipo de recepción** a **Parcial**.
- **«Adjunta el PDF de la guía o factura.»:** cada documento necesita su PDF.
- **«Correo programado»:** se hizo fuera del horario de envío (lunes a viernes, 8:00 a 17:00, sin feriados). Sale solo después.
- **«Adjunta los archivos»:** el envío automático no está configurado. Se descargaron el acta y la guía y se abrió un borrador de correo: adjúntalos a mano.
- **«No se puede eliminar» la orden:** primero hay que anular sus recepciones.

**Reglas**
- Lo que entra a stock por una OC queda en la bodega elegida y en el historial con su N° REC.
- La aceptación del proveedor es opcional. Si llegó mercadería, se da por aceptada.
- Los plazos se cuentan en **días hábiles** (lunes a viernes, sin feriados).
- «Llega ahora» se cuenta en **unidades**, igual que en la orden. Si la orden viene por cajas, conversa antes con el encargado (ver notas).
- La recepción conforme lleva siempre la firma y el timbre de la contraparte técnica.
- La bitácora y los archivos de la orden no se modifican.

**Sin internet:** la lista y la ficha muestran la última copia. **Guardar recepción** funciona: queda en cola con un número provisional **REC-P-…**, se aplica sola al volver la conexión y recién ahí sale el correo. Las fotos o PDF de las guías **no** se guardan en la cola: súbelos después con **Agregar archivo**. **Ingresar desde PDF**, **Recepción conforme**, **Buscar fotos**, anular y eliminar **necesitan conexión**.

---

## Bitácora de órdenes

**Para qué sirve:** ver cada orden como un «caso», cruzando lo que dice el Visor (pedido y recibido) con los correos de la cuenta de Compras: despachos, guías, facturas, reclamos y recepciones conformes. Solo lee el correo: no envía ni cambia nada.

**Quién lo usa:** operador, administrador y superadministrador. La configuración del script la hace el administrador.

**Paso a paso**
1. Menú lateral → **MOVIMIENTOS → Bitácora de órdenes**.
2. Arriba ves **Última revisión del correo**. El correo se revisa solo a las 07:00, 12:00 y 17:00. Para revisarlo ahora, toca **Revisar el correo ahora**.
3. Busca con **«Buscar por N° de orden o proveedor»** o filtra con: **Todas**, **Discrepancia**, **Sin gestión**, **Parciales**, **En gestión**, **Para otros centros**, **Compra compartida**, **Con conforme** y **Falta conforme**.
4. Cada fila muestra el estado, el avance (recibido / pedido), el último correo y las alertas.
5. Toca una orden para abrir el caso a pantalla completa: **Ciclo de vida** (6 etapas), **Hallazgos**, **Bitácora** (vista **Por etapa** o **Cronológica**) y **Productos y centros**.
6. **Abrir en Seguimiento de OC** lleva a la ficha de la orden. **Volver a la lista** (o **Esc**) cierra.


**Si pasa esto…**
- **«Aún no hay datos del correo. Configura el script…»:** falta conectar el script de la cuenta de Compras (botón **Configurar**). Mientras tanto se ven solo las órdenes del Visor.
- **«La primera revisión del correo todavía está en curso»:** es normal la primera vez. Se completa sola en las siguientes revisiones.
- **Estado «Solo en correo»:** la orden aparece en los correos, pero no está ingresada en el Visor. Ingrésala en **Seguimiento de OC**.

**Reglas**
- **Discrepancia** = la recepción conforme enviada por correo no coincide con lo recibido en el Visor (por ejemplo, dice TOTAL y faltan unidades).
- **Sin gestión** = sin correos, o más de 7 días sin movimiento y sin nada recibido.

**Sin internet:** no funciona (lee el correo en línea).

---

## Ajustes de stock

**Para qué sirve:** corregir la cantidad de un producto cuando lo que hay en la bodega no coincide con el sistema (merma, daño, error de digitación, conteo, devolución…). Cada ajuste queda con un **motivo**, una **observación** y un código correlativo **AJU-AAAA-NNNNNN**, y aparece en el Historial y en el informe contable.

**Quién lo usa:**
- **Superadministrador:** el ajuste se aplica al tiro. Además, aprueba o rechaza las solicitudes de los demás en **Aprobaciones Pendientes**.
- **Administrador y operador:** el ajuste queda como **solicitud** hasta que el superadministrador la apruebe. Siguen su estado en **Mis Solicitudes**.
- **Enfermero:** no tiene acceso.

### A. Hacer o solicitar un ajuste
1. Menú lateral → **MOVIMIENTOS → Ajustes de Stock**. Se abre en **Solicitar Ajuste**.
2. En **Buscar Medicamento**, escribe al menos 2 letras del nombre, el código, el lote o el ID.
3. En **Coincidencias Encontradas**, toca la tarjeta correcta. Cada tarjeta trae foto, nombre completo, bodega, ID, stock y lotes con su vencimiento (amarillo = vence en 90 días o menos; rojo = vencido). **Fíjate en la bodega:** el mismo producto aparece una vez por cada bodega.
4. En **¿A qué lote va el ajuste?**, elige el lote. Si los lotes no suman el total, aparece **Sin lote específico** (el sistema elige el que vence antes). **Lote nuevo** sirve **solo para sumar**: escribe el lote y el vencimiento.
5. En **Cantidad a Ajustar**, escribe la diferencia con signo: **-10** para restar, **50** para sumar. **Nuevo Proyectado** muestra cómo queda.
6. Elige el **Motivo del ajuste**: **Error de digitación**, **Producto no está / no se encontró**, **Merma o daño**, **Conteo físico (toma de inventario)**, **Devolución**, **Corrección de lote o vencimiento**, **Corrección de proveedor o documento**, **Cambio de bodega** u **Otro**.
7. Escribe la **Observación de Auditoría**: qué pasó y cómo lo comprobaste (más de 10 caracteres).
8. Toca **Ejecutar Ajuste y Auditar**.
9. Revisa el resumen en **¿Confirmar el ajuste?** (producto, antes → después, lote, motivo). Toca **Confirmar ajuste** (superadministrador) o **Enviar solicitud** (los demás). **Revisar** vuelve atrás.
10. Resultado:
    - Superadministrador: **«Ajuste realizado — Código: AJU-…»**.
    - Los demás: **«Solicitud Creada — … código: AJU-… Debe ser aprobada por el Superadministrador.»**


### B. Mis Solicitudes
1. Toca **Mis Solicitudes**.
2. Ves tus solicitudes con **Código**, **Insumo**, **Fecha**, **Variación**, **Stock (Prev -> Proy)**, **Estado** (**PENDIENTE**, **APROBADO**, **RECHAZADO**) y la observación (con el lote, y el motivo si se rechazó).
3. Cuando el superadministrador la aprueba o la rechaza, te llega un aviso: **«Ajuste AJU-… Aprobado»** o **«Ajuste AJU-… Rechazado — Motivo: …»**.
4. El superadministrador ve aquí las solicitudes de todos.

### C. Aprobaciones Pendientes (solo superadministrador)
1. Toca **Aprobaciones Pendientes**. El número rojo indica cuántas hay.
2. Revisa cada fila: código, quién la pidió, insumo, fecha, variación (con lote) y justificación. Aquí también llegan los faltantes de las **tomas de inventario**.
3. Toca **Aprobar**: el ajuste se aplica en ese momento sobre el stock real y aparece **«Solicitud Aprobada»**.
4. O toca **Rechazar**, escribe el motivo en la ventana del navegador y acepta. Aparece **«Solicitud Rechazada»**.


**Si pasa esto…**
- **«Debe seleccionar un insumo.»:** toca una tarjeta de la lista.
- **«Ingrese una cantidad válida (+ o -). No puede ser cero.»:** escribe un número distinto de 0.
- **«Elige el motivo del ajuste.»** o **«La observación debe tener más de 10 caracteres.»:** completa el campo.
- **«El stock resultante no puede ser negativo.»** o **«El lote X tiene N u.: no se pueden restar M.»:** estás restando más de lo que hay. Revisa el lote o la cantidad.
- **«Elige el lote al que va el ajuste…»:** falta elegir el lote, o el «lote nuevo» repite el nombre de uno que ya existe.
- **«A un lote nuevo solo se le puede sumar.»:** para restar, elige un lote existente.
- **«Además hay N u. reservadas por actas por confirmar…»:** esas unidades siguen físicamente en la bodega. Si contaste el estante, réstalas antes de ajustar.
- **Al aprobar: «La solicitud cambió mientras la revisabas…»** o **«El lote … cambió desde el conteo…»:** alguien movió ese stock entremedio. Rechaza la solicitud y pide que se vuelva a contar.
- **«Solicitud ya procesada»:** ya estaba aprobada. No se aplicó dos veces.

**Reglas**
- Un ajuste **no reemplaza** a un traspaso, una entrega con acta ni una corrección de ingreso. Úsalo solo cuando la cantidad física no coincide.
- Corrección directa de un ingreso (lápiz en **Historial**): solo dentro de las 12 horas siguientes y si todavía no ha salido nada de ese producto. Después, se corrige con un ajuste.
- El código AJU se asigna al confirmar. Si después la solicitud se rechaza, ese número no se vuelve a usar.
- El stock nunca puede quedar negativo.

**Sin internet:** el ajuste se guarda en el equipo (**«Guardado sin conexión»**) y se aplica solo al volver la conexión, con el stock de ese momento. El código AJU se asigna al sincronizar. Si ya no alcanza el stock, queda «para revisar» en el indicador **N sin sincronizar**. **Aprobar** y **Rechazar** necesitan conexión.

---

## Historial

**Para qué sirve:** ver todos los movimientos de stock en orden de fecha (ingresos, traspasos, entregas, ajustes, recepciones…), con quién los hizo y su documento de respaldo. El historial no se puede modificar.

**Quién lo usa:** operador, administrador y superadministrador. **Excel**, **PDF** y el lápiz **Editar ingreso** son solo para administrador y superadministrador.

**Paso a paso**
1. Menú lateral → **MOVIMIENTOS → Historial** (pantalla **Historial de Transacciones**).
2. La tabla muestra los últimos 50 movimientos y se actualiza sola: **FECHA/HORA**, **TIPO**, **PRODUCTO** (con el operador), **LOTE / CANT.**, documento y código de ingreso (**ING-…**), **DOC. RESPALDO** y **ACCIÓN**.
3. Para buscar, escribe en **«Buscar por producto u operador...»**. También encuentra lotes, tipos, documentos e IDs, pero **solo entre los movimientos ya cargados**. Para buscar más atrás, toca primero **Cargar Más Resultados** (trae 50 más cada vez).
4. Para ver un día, elige la fecha en el calendario. **LIMPIAR** vuelve al tiempo real.
5. El ojo muestra producto, fecha y usuario.
6. Lápiz (solo en los ingresos de proveedor): abre **Editar ingreso**. Corrige y toca **Guardar cambios**. Si cambias cantidad, lote o vencimiento, el Visor pide el motivo y entrega un código **CAM-…**.
7. **Excel** o **PDF** descargan lo que está cargado en la tabla.


**Para ver la historia completa de un producto** (el kárdex, con el saldo línea a línea) usa **Auditoría → Contable** (siguiente módulo).

**Si pasa esto…**
- **No encuentro un movimiento antiguo:** toca **Cargar Más Resultados** hasta llegar a esa fecha, o filtra por el día.
- **«Has llegado al final del historial.»:** ya no hay más movimientos.
- **«No se pudo buscar por fecha.»:** reintenta con conexión.
- **Al editar: «Pasaron más de 12 h desde el ingreso.»** o **«Ya salió stock de este insumo…»:** ya no se puede corregir directo. Usa **Ajustes de Stock**.
- **«Por ahora solo se editan los ingresos de proveedor…»:** las entregas, traspasos y ajustes no se editan desde aquí.

**Reglas**
- No hay que borrar movimientos: los errores se corrigen con un movimiento nuevo (un ajuste o una edición con código).
- El N° de OC o documento de un ingreso se puede agregar después con el lápiz, sin límite de tiempo.

**Sin internet:** muestra los movimientos recientes guardados en el equipo (hasta 3.000). Lo hecho sin conexión aparece cuando se sincroniza. Editar un ingreso necesita conexión.

---

## Auditoría

**Para qué sirve:** dos informes para cuadrar el inventario:
- **Disponible:** cuántas unidades hay realmente para entregar, por producto y bodega (lo que está en el sistema menos lo ya entregado sin respaldo, el «sobregiro»).
- **Contable:** el libro de cada producto (kárdex): cada entrada y salida con su motivo, bodega, lote, código, responsable y saldo.

**Quién lo usa:** operador, administrador y superadministrador. El enfermero no la ve.

### A. Pestaña Disponible
1. Menú lateral → **MOVIMIENTOS → Auditoría**. Se abre en **Disponible**.
2. Arriba: **unidades disponibles**, **productos en bodega**, **con sobregiro** y **valor disponible**.
3. Busca con **«Buscar insumo, ID o bodega…»**, filtra con **Todas las bodegas** o marca **Solo con sobregiro**.
4. Cada fila muestra **Disponible**, **En sistema**, **Sobregiro**, **Bodega** y **Estado**: **OK**, **Listo para cuadrar**, **Sin respaldo** o **Provisional**.
5. Si el estado es **Listo para cuadrar** (hay stock para cubrir lo entregado sin respaldo), toca **Cuadrar** y escribe, si lo sabes, el N° de la OC o SDC. **Cuadrar N listos** hace todos juntos.
6. Si es un producto provisional sin ID, toca **Asignar ID** y escribe el ID de Mercado Público.
7. **Informe disponible (Excel)** descarga el informe (archivo CSV que se abre con Excel). **Actualizar** recarga.
8. Toca el nombre de un producto para abrir su libro en **Contable**.


### B. Pestaña Contable
1. Toca **Contable**.
2. Escribe en **«Producto o ID de Mercado Público…»** y elige el producto de la lista.
3. Ves **Stock actual (todas las bodegas)**, **Saldo según movimientos**, **Sobregiro** y **Reservado por actas**.
4. Si dice **«El stock actual difiere en N u. de lo que suman los movimientos…»**, hay stock que se cargó antes del sistema, por toma de inventario o sin movimiento. Si dice **«El stock actual coincide…»**, el libro está cuadrado.
5. Toca cualquier línea del libro para ver **todo el detalle** del movimiento (tipo, cantidad, efecto en el stock, lote, desde/hacia, código, responsable, motivo, documentos).
6. **Descargar libro (Excel)** baja el libro del producto.
7. Más abajo están **Recepciones de mercadería** (busca por **REC-…**, orden o guía) y **Cambios con código de seguimiento** (los CAM y AJU con su motivo).


**Si pasa esto…**
- **«No se cuadró»:** léelo y reintenta con conexión. Si sigue, avisa al administrador.
- **No encuentro el producto en Contable:** prueba con el ID de Mercado Público o con parte del nombre.

**Reglas**
- **Disponible** es lo que se puede prometer a un centro. **En sistema** puede incluir unidades ya entregadas sin respaldo.
- Los productos **Provisional** o **Sin respaldo** se crearon al entregar sin stock. **No se borran**: se cuadran al ingresar su OC o SDC.

**Sin internet:** muestra la última copia del inventario y de las órdenes. Cuadrar y Asignar ID necesitan conexión.

---

## Fotos de productos (solo superadministrador)

**Para qué sirve:** completar las dos fotos de cada producto (**producto** y **caja**) desde el teléfono, ver todo el catálogo ordenado por lo que falta y saber quién subió o cambió cada foto.

**Quién lo usa:** solo el **superadministrador**. Para cualquier otro rol, la sección no aparece en el menú y la página del teléfono no lo deja entrar. (Ojo: la ficha del producto, en el Catálogo de Insumos, sí permite subir fotos al resto del personal de bodega.)

### A. En el computador: sección Fotos de productos
1. Menú lateral → **INVENTARIO → Fotos de productos**.
2. **Accesos directos para el teléfono:** **Visor Logístico**, **Pedir insumos** y **Fotos SAR**, cada uno con **QR** y **Copiar**.
3. Pestaña **Catálogo:** todo el catálogo, primero lo que no tiene ninguna foto. Filtros: **Sin ninguna foto**, **Sin foto del producto**, **Sin foto de la caja**, **Pedidas al teléfono**, **Completos** y **Todo el catálogo**. Busca con **«Buscar por nombre, ID o nombre común…»**.
4. En cada producto:
   - Toca el recuadro **Producto** o **Caja** para subir o cambiar esa foto desde el computador.
   - **Pedir al teléfono** lo deja en la lista de pendientes del teléfono (**Quitar pedido** lo saca).
5. Pestaña **Seguimiento de cambios:** fecha, producto, qué foto, qué pasó (**Subió foto nueva** / **Cambió la foto**), quién y desde dónde (teléfono o computador).
6. **Actualizar** recarga.


### B. Instalar «Fotos SAR» en el teléfono (una sola vez)
1. En **Accesos directos para el teléfono**, toca **QR** en **Fotos SAR**.
2. Escanéalo con la cámara del teléfono y abre el enlace.
3. Agrégalo a la pantalla de inicio (**Compartir → Agregar a inicio**). El ícono es naranjo, con una cámara.
4. Entra con tu correo y clave del Visor (**Entrar**). La sesión queda guardada en el teléfono.

### C. En el teléfono: sacar las fotos
1. Abre **Fotos SAR**. Por defecto se ven los **Pendientes**: productos con stock a los que les falta una foto, y los pedidos desde el computador (marcados **pedida**).
2. Para ver todo, toca **Todo el catálogo**.
3. Filtra con los botones (**Todos**, **Pedidas**, **Sin foto del producto**, **Sin foto de la caja**…) o busca con **«Buscar producto…»**.
4. En cada producto, toca:
   - **Foto del producto**: el producto fuera de la caja.
   - **Foto de la caja**: el envase con su etiqueta.
   - **Otra foto**: un detalle extra (rótulo, lote, etc.).
5. Se abre la cámara. Saca la foto y confirma. Aparece **«Foto guardada»** y el recuadro cambia a **«Producto listo · cambiar»** o **«Caja lista · cambiar»**.
6. Cuando el producto tiene las dos fotos, sale solo de los pendientes.
7. **Salir** cierra la sesión.


**Si pasa esto…**
- **«Esta cuenta no puede cargar fotos: solo el superadministrador.»:** la cuenta no tiene ese rol.
- **«Correo o clave incorrectos.»** o **«Sin internet.»:** revisa los datos o la conexión.
- **«Ya tiene 4 fotos adicionales: quita una en la ficha del producto antes de agregar otra.»:** quita una foto desde la ficha del producto (Catálogo de Insumos).
- **«Todo al día: no hay productos sin fotos.»:** no queda nada pendiente.
- **La foto queda «subiendo» y no termina:** probablemente no hay internet. Espera la conexión con la página abierta (ver notas).

**Reglas**
- **Caja** = la foto que se ve en todo el Visor. **Producto** = cómo es por dentro. Si las cambias de lugar, se confunde al personal.
- Saca la foto con buena luz, la etiqueta derecha y legible, y sin datos de pacientes ni personas.
- Las fotos se achican solas en el teléfono para que el catálogo no pese.

**Sin internet:** la página abre si ya se usó antes, pero para entrar la primera vez y para guardar fotos **hace falta conexión**.

---

