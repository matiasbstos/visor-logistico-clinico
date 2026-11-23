# Parte 1 · Inventario: existencias, toma, etiquetas y pedidos desde el teléfono

> Versión del Visor revisada: v21.247. Los nombres de botones y mensajes están copiados del sistema tal como aparecen en pantalla.

**Antes de empezar: el Visor sin internet**
- Arriba a la derecha hay un aviso que dice **«En vivo · hh:mm»** cuando hay conexión, o **«Sin conexión · datos de las hh:mm»** cuando no hay. Sin conexión, lo que ves es la última copia que bajó el equipo.
- Lo que hagas sin internet queda guardado en el equipo. Abajo a la derecha aparece **«N sin sincronizar»** y se envía solo cuando vuelve la conexión. Si lo tocas, ves el detalle y el botón **Sincronizar ahora**.
- Para que funcione sin internet, el equipo tiene que haber abierto el Visor al menos una vez con conexión. En iPhone, instala el Visor en la pantalla de inicio y déjalo abierto hasta que se sincronice.

---

## Existencias

**Para qué sirve:** ver cuánto hay de cada producto, en qué bodega, con qué lotes y cuándo vencen.

**Quién lo usa:** operador, administrador y superadministrador. No aparece para los roles «Solo Bodega transitoria» ni «Solicitante». En el teléfono también está en la barra de abajo (**Existencias**).

**Paso a paso**
1. En el menú lateral, entra a **INVENTARIO → Existencias**.
2. Escribe en el buscador **«Buscar medicamento por nombre o código...»** (desde 2 letras). También puedes buscar por el ID de Mercado Público.
3. Si quieres, filtra con las tres listas de arriba:
   - Ubicación: **Todas las Ubicaciones**, **Bodega Central**, **Bodegas Transitorias**, **Bandejas en Turno**.
   - Categoría: **Todas las Categorías**, **Insumo Médico**, **Medicamento**.
   - Estado: **Con stock** (es el que viene marcado), **Todos (incluye agotados)**, **Agotados**, **Stock Crítico**, **Stock Normal**.
4. Lee la fila de cada producto:
   - **CANT. (FÍSICO):** verde = normal; naranjo = bajo el mínimo; rojo con **STOCK CRÍTICO** o **AGOTADO** = queda poco o nada. Si dice **«+N reservado»**, esas unidades están apartadas para actas de entrega por confirmar y no están disponibles.
   - **VTO.:** los lotes con su cantidad y vencimiento. Un lote vencido o por vencer sale en color y con aviso ⚠.
5. Para ver el detalle por lote, toca **Ver desglose** (para cerrarlo, **Ocultar desglose**).
6. Botones de la fila:
   - Flechas (**Mover a otra bodega**): abre la transferencia con el producto ya elegido.
   - Gráfico (**Ver Kardex y Trazabilidad**): abre el **Historial Clínico de Insumo**, con los movimientos del producto.
   - Lápiz: editar los datos del producto.
7. Al pie de la tabla cambias de página con los números o las flechas (20 productos por página). Lo último que entró o se movió aparece primero.


**Si pasa esto…**
- **No aparece un producto que sé que existe:** probablemente tiene stock 0 y el filtro está en «Con stock». Escribe su nombre (así aparece igual) o cambia el filtro a **Todos (incluye agotados)**.
- **«Mover» dice «No hay otra bodega a la que mover. Crea una en Bodegas.»:** solo existe una bodega activa. Pídele al administrador que cree la otra.
- **La tabla se queda en «Cargando inventario...»:** revisa la conexión y vuelve a entrar a Existencias.

**Reglas**
- Lo «reservado» no se entrega a otro servicio: ya está comprometido en un acta.
- No corrijas cantidades con el lápiz para «cuadrar»: para eso están la **Toma de inventario** o los **Ajustes de Stock**, que dejan registro y código.

**Sin internet:** muestra la última copia guardada en el equipo. **Mover a otra bodega** queda en cola y se aplica sola al volver la conexión.

---

## ¿Dónde está?

**Para qué sirve:** saber rápido en qué bodega y en qué estante está un producto.

**Quién lo usa:** todo el personal con acceso al Visor (también lo ve enfermería). No aparece para «Solo Bodega transitoria» ni «Solicitante».

**Paso a paso**
1. Menú lateral → **INVENTARIO → ¿Dónde está?**
2. Antes de escribir ves atajos:
   - **Búsquedas recientes:** tócalas para repetirlas.
   - **Bodegas:** cada una con su total. Si la tocas, se abre la ficha de esa bodega.
   - **Críticos ahora:** los productos más bajos de stock.
3. Escribe al menos **3 letras** del nombre en **«Escribe el nombre del producto…»**. También sirve el ID de Mercado Público (3 números o más).
4. En cada producto ves las bodegas donde hay y cuántas unidades tiene cada una:
   - En una bodega con estantes salen los códigos de estante con su cantidad (por ejemplo «A-01 · 30»). Toca uno para abrir ese estante.
   - **«N sin ubicar»** = unidades que están en la bodega pero no tienen un estante asignado.
   - **«Bodega sin estantes»** = esa bodega no usa estantes.
5. En la ficha de una bodega o de un estante están los botones **Ver stock** e **Inventario**. Con rol de bodega (operador o administrador) aparecen además **Ingresar**, **Sacar**, **Ajuste** y **Ubicar**.


**Si pasa esto…**
- **«No encontré productos con ese nombre.»:** prueba con otra palabra del nombre o con menos letras (aquí la búsqueda es exacta; no corrige errores de escritura).
- **«No se pudo buscar. Intenta de nuevo (ref. DE-01).»:** falló la lectura. Sal y vuelve a entrar a la pantalla.
- **Toqué «Inventario» en la ficha de la bodega y la toma no viene con la bodega elegida:** elígela tú en **Bodega** antes de **Abrir toma**.

**Reglas**
- Si mueves producto de un estante a otro, actualízalo con **Ubicar** en la ficha de la bodega. Si no, la próxima persona lo va a buscar donde ya no está.

**Sin internet:** busca en la última copia guardada en el equipo. No confirmado en terreno (ver notas).

---

## Toma de inventario

**Para qué sirve:** contar una bodega lote por lote. Al cerrar la toma, el sistema queda con lo contado y cada diferencia queda registrada con su código. Esta toma **no suma** lo contado al stock: lo **reemplaza**.

**Quién lo usa:** operador, administrador y superadministrador. Cualquiera de los tres puede contar y cerrar, pero cada rol aplica cosas distintas:

| Rol | Sobrantes y lotes nuevos | Faltantes |
|---|---|---|
| Superadministrador | Entran al cerrar | Se descuentan al cerrar |
| Administrador | Entran al cerrar | Quedan esperando al superadministrador |
| Operador | Quedan esperando al superadministrador | Quedan esperando al superadministrador |

Lo que queda esperando aparece en **Ajustes de Stock → Aprobaciones Pendientes** (solo lo ve el superadministrador). Cada uno ve lo suyo en **Mis Solicitudes**.

### Abrir la toma
1. Menú lateral → **INVENTARIO → Toma de inventario** (o **Accesos → Conteos de inventario**).
2. Elige la **Bodega**.
3. Elige el **Tipo de toma**:
   - **Parcial** (es la que viene marcada): lo que no cuentes queda igual.
   - **Completa**: lo que no cuentes queda en 0 y sale como faltante. Úsala solo si vas a contar **toda** la bodega.
4. Toca **Abrir toma**. Arriba aparece **«Toma INV-…»** con la bodega, el tipo y cuántos productos llevas contados.
5. Si aparece **«Ya hay una toma abierta»**, alguien ya está contando esa bodega. Toca **Volver** y ponte de acuerdo con esa persona. Usa **Abrir igual** solo si de verdad corresponde.


### Contar
6. En el recuadro **«Pistolea la etiqueta o escribe el producto…»**:
   - **Con pistola:** pistolea la etiqueta de la caja (BUL). Una caja **cerrada** suma sola todo su contenido al lote que corresponde y aparece **«Caja contada»**. Si la caja está **abierta**, aparece **«Caja abierta»**: cuenta las unidades y anótalas a mano (paso 8).
   - **Con la cámara del teléfono:** toca **QR** y apunta a la etiqueta.
   - **Sin etiqueta:** escribe parte del nombre o del código (desde 2 letras) y toca el producto en la lista, que muestra su foto.
7. Se abre la ficha del producto con la tabla **Lote · Vence · Sistema · Contado · Estado**. El estado cambia a medida que cuentas:
   - **«Quedan N»**: todavía faltan N unidades para llegar a lo que dice el sistema.
   - **«Coincide»**: está cuadrado.
   - **«Sobran N»** o **«Lote nuevo N»**: contaste más de lo que hay en el sistema, o un lote que el sistema no tiene.
8. Para anotar a mano:
   1. En **«¿De qué lote es lo que cuentas?»**, toca el lote (si el producto tiene un solo lote, ya viene marcado). También puedes tocar la fila del lote en la tabla.
   2. Si el lote no aparece, toca **+ Lote que no está** y escribe el **Lote** y el **Vencimiento**. Si el producto no trae ninguno de los dos, toca **No trae lote ni vencimiento**.
   3. Escribe la cantidad en **«Cantidad (0 si no hay)»** y toca **Sumar al conteo** (Enter también funciona).
9. Puedes contar el mismo lote por partes (un estante, después otro): las cantidades se van sumando. Cada parte queda en una lista con una ✕ para quitarla si te equivocaste.
10. Para seguir con otro producto, toca **Otro producto** o pistolea la siguiente caja. Lo que ya contaste queda abajo, en **Contados (N)**. Si tocas una tarjeta de esa lista, vuelves a ese producto.


### Revisar y cerrar
11. Toca **Revisar y cerrar** (se activa cuando llevas al menos un producto contado, o desde el inicio si la toma es completa).
12. Revisa la tabla de diferencias (**Producto · Lote · Sistema · Contado · Diferencia**). Las filas marcadas **«por recontar»** aparecen cuando:
    - la diferencia es mayor a 5 % o a 10 unidades, o
    - el producto es un medicamento controlado (en ese caso, cualquier diferencia).

    Vuelve a contar ese lote. Si el número está bien, toca **Volví a contar: está bien**. Si no, vuelve a **Contar** y corrígelo.
13. Si un producto tiene unidades reservadas en actas por confirmar y lo contado no las cubre, el sistema pregunta **«¿Esas actas ya se entregaron?»** y muestra los folios de las actas. Responde:
    - **Sí, ya se entregaron**: el material ya salió de la bodega y no se descuenta del conteo.
    - **No, siguen aquí**: lo que no encontraste cuenta como faltante.
    Sin esta respuesta no se puede cerrar.
14. Si un producto dice **«cuenta todos sus lotes (pon 0 en los que no estén)»**, toca **Contar** y anota 0 en los lotes que no encontraste.
15. Si hay faltantes, elige el **Motivo de los faltantes** y, si quieres, escribe una **Observación**.
16. Toca **Cerrar toma INV-…** y confirma con **Cerrar toma**. Al terminar aparece **«Toma cerrada»** con cuántos ajustes se aplicaron y cuántos quedaron esperando al superadministrador.


**Si pasa esto…**
- **«No hay un producto así en esta bodega. Si llegó nuevo, regístralo en Ingresos.»:** el producto no está registrado en esa bodega. No lo cuentes aquí: ingrésalo por **Ingresos**.
- **«… no existe en el sistema.»** al pistolear: esa etiqueta no está registrada. Busca el producto por su nombre.
- **«La caja es de «…», que no está en (bodega).»:** esa caja figura en otra bodega. Avisa a bodega para hacer la transferencia y no la cuentes en esta toma.
- **«Ya contada»:** esa caja ya está en el conteo y no se suma dos veces.
- **«Elige de qué lote es lo que contaste.»** o **«Escribe cuántas unidades contaste (0 si no hay).»:** falta marcar el lote o escribir la cantidad.
- **El botón Cerrar está gris:** quedan filas por recontar o preguntas sin responder.
- **«No se cerró la toma» … «tuvieron movimientos mientras contabas»:** alguien movió esos productos mientras contabas. El sistema borró su conteo y actualizó lo que dice el sistema: vuelve a contarlos y cierra de nuevo. Lo que ya se aplicó no se repite.
- **«Sin internet: cierre en cola»:** la toma se aplica sola cuando vuelva la conexión. Deja el Visor abierto con tu mismo usuario.
- **«Toma … con errores»:** algunos lotes no se pudieron ajustar. Cuéntalos en una toma nueva.

**Reglas**
- **No descartes una toma que ya tiene conteo.** **Descartar esta toma** (abajo de todo, pide confirmar con **Descartar**) borra todo lo contado en ese equipo. El stock no cambia, pero el conteo se pierde.
- **No cuentes en dos pestañas ni en dos ventanas del mismo equipo.** Comparten el mismo borrador y queda guardado lo último que se grabó, así que puedes perder conteos.
- **Termina la toma en el mismo equipo y navegador donde la abriste.** El conteo queda guardado solo en ese equipo hasta que la cierres.
- **No abras dos tomas de la misma bodega** en equipos distintos. Si lo haces, el segundo cierre se rechaza lote por lote.
- Usa la **Completa** solo si vas a contar todo: lo que no cuentes queda en 0.
- Lo que está en cuarentena no entra en la toma.

**Sin internet:**
- Se puede abrir la toma (el folio sale provisional, «INV-P-…»), contar con la pistola o a mano, y cerrar. El cierre queda en cola y se aplica solo al volver la conexión.
- Para que esto funcione, el equipo tiene que haber cargado esa bodega antes con conexión.
- La cámara (**QR**) puede no funcionar sin internet; usa la pistola o escribe el producto (ver notas).

---

## Bultos y etiquetas

**Para qué sirve:** cada caja física lleva una etiqueta con producto, lote, vencimiento, unidades y «bulto 3 de 10», un QR (para la cámara del teléfono) y un código de barras (para la pistola). Desde aquí se crean las etiquetas, se consulta qué tiene una caja y se cuenta pistoleando cajas.

**Quién lo usa:** operador, administrador y superadministrador. No aparece para enfermería, «Solo Bodega transitoria» ni «Solicitante».

Menú lateral → **INVENTARIO → Bultos y etiquetas**. Tiene cinco botones grandes y, abajo, la tabla **Bultos registrados** (Folio, Producto, Lote, Bulto, Contenido, Estado, Etiqueta, Bodega).


### Crear etiquetas (producto nuevo o caja sin etiqueta)
1. Toca **Crear etiquetas**. Se abre **Etiquetas de bulto**, en la pestaña **Nuevas etiquetas**.
2. En **Producto**, escribe el nombre y elige el producto y el lote de la lista.
3. Revisa **Lote**, **Vence** y **Bodega**.
4. En **¿Cómo viene?**, completa **Total de unidades**, **Unidades por caja grande** y **Cajas grandes**. Si cambias las cajas, se recalculan las unidades por caja. La última caja lleva lo que sobra.
5. Si la caja grande trae cajas más chicas, marca **La caja grande trae cajas interiores** y escribe las **Unidades por caja interior**.
6. Si quieres, completa **Proveedor**, **Orden de compra** y **Fecha de recepción**.
7. Revisa el resumen (por ejemplo «10 etiquetas: 10 cajas grandes de 220 u.») y toca **Crear etiquetas**.
8. Toca **Imprimir ahora** (se abre el PDF para la Zebra) o **Después** (las etiquetas quedan «Sin imprimir» en **Impresión de etiquetas**).

### Etiquetar stock existente (lo que ya estaba en el sistema sin etiqueta)
1. Toca **Etiquetar stock existente**. Se abre en la pestaña **Contar y etiquetar**.
2. Busca el producto y toca **el lote que estás contando**. Si el lote no está, toca la opción que dice **otro lote** y escríbelo.
3. Anota las **Cajas grandes** (solo las completas), las **Unidades por caja grande** y las **Unidades sueltas (sin caja)**. El **Total contado** se calcula solo. Si una caja está incompleta, corrige el total a mano (**Volver a calcular** deshace el cambio).
4. Compara con **En el sistema (este lote)** y mira la **Diferencia**.
5. Toca **Registrar conteo y crear etiquetas**. Si solo hay unidades sueltas, el botón dice **Registrar conteo**.
6. Si hay diferencia, el sistema pide confirmar:
   - El superadministrador ve **Sumar y seguir** o **Descontar y seguir**.
   - Los demás ven **Enviar solicitud y seguir**: la diferencia queda como solicitud para el superadministrador.
   - **Revisar** vuelve atrás sin guardar.
7. Al final ofrece **Imprimir ahora** o **Después**.


### Escanear bulto (ver qué tiene una caja)
1. Toca **Escanear bulto**. Se abre la cámara y el recuadro **«Pistola: escanea aquí · o escribe el folio y Enter»**.
2. Pistolea la etiqueta, apunta la cámara o escribe el folio y toca **Buscar**.
3. Aparece la ficha de la caja: producto, lote, vencimiento, unidades que tiene y estado (**Cerrada**, **Abierta** o **Vacía**).
4. Según lo que pase con la caja:
   - **Abrir caja** (si estaba cerrada) o **¿Cuánto queda?** (si estaba abierta): ajusta con − / + y toca **Listo**, o toca **Está vacía**.
   - **Marcar vacía**: la caja ya no tiene nada.
   - **Volver a cerrada (llena)**: si se marcó vacía por error y está completa.
   - **Reimprimir etiqueta**: pide el motivo.
5. Si lees el QR de la etiqueta con la cámara normal del teléfono, se abre el Visor directo en esa caja (tienes que tener la sesión iniciada).

### Contar por bultos (pistolear cajas)
1. Toca **Contar por bultos**.
2. Pistolea cada caja:
   - **Cerrada:** suma sola su contenido. Si es una caja grande, sus cajas interiores ya quedan contadas.
   - **Abierta:** pregunta **«¿cuántas unidades quedan?»**. Responde con − / + y **Listo**, o toca **Está vacía**.
   - **Caja grande abierta:** pregunta cuántas unidades **sueltas** hay dentro (**Listo**). Después pistolea sus cajas interiores una por una.
   - **Vacía:** no suma.
3. Abajo se arma la tabla **Producto · Lote · Cajas · Contado · Sistema**. Lo que no cuadra sale en rojo. «Sistema» incluye todo el lote de esa bodega, también lo que no tiene etiqueta.
4. Toca **Guardar conteo**. **Ojo:** este conteo **no cambia el stock**. Para dejar el stock igual a lo contado, usa **Toma de inventario**.


**Si pasa esto…**
- **«… no es una etiqueta de bulto.»:** pistoleaste otro código (por ejemplo, el del fabricante). Busca la etiqueta del Visor, la que tiene el logo y dice «BULTO n / N».
- **«… ya estaba contado … no se suma dos veces.»:** está bien, esa caja ya se contó.
- **«Eso parece una etiqueta: primero indica cuánto queda en esta caja.»:** la pistola escribió un folio en el campo de cantidad. Escribe la cantidad a mano y después pistolea la caja siguiente.
- **«No se pudo abrir la cámara…» / «La cámara no está disponible…»:** da permiso de cámara al navegador, o usa la pistola o escribe el folio.
- **«Sin internet solo puedes crear N etiqueta(s)…»:** sin internet hay un número limitado de folios guardados en el equipo. Crea menos cajas o espera la conexión.
- **«Este producto tiene … reservadas para actas por confirmar y varios lotes…»:** no se sabe de qué lote salen esas unidades. Confirma o elimina esas actas antes de contar.
- **«Ya hay una solicitud de ajuste pendiente para este lote…»:** pídele al superadministrador que la rechace y vuelve a contar.

**Reglas**
- **Una etiqueta por caja física.** No pegues la misma etiqueta en dos cajas ni reimprimas «por si acaso».
- Si el lote ya tiene cajas etiquetadas (aparece el aviso **«cuéntalas igual, pero no les crees etiqueta otra vez»**), no crees etiquetas nuevas para esas cajas.
- Cuando saques unidades de una caja, márcala como abierta o vacía. Si no, en el próximo conteo va a sumar como llena.
- No uses «Etiquetar stock existente» para mercadería que recién llegó: eso se ingresa por **Ingresos** o por la recepción de la orden de compra.

**Sin internet:**
- Se pueden crear etiquetas (con los folios reservados en ese equipo), imprimirlas, escanear cajas, abrirlas o vaciarlas y contar por bultos. Todo se sube solo al volver la conexión.
- Para que esto funcione, el equipo tiene que haber abierto el Visor antes con conexión.
- La cámara puede no funcionar sin internet: usa la pistola (ver notas).

---

## Impresión de etiquetas

**Para qué sirve:** ver todas las etiquetas por orden de compra o por producto, imprimir las que quedaron pendientes al recibir, reimprimir y corregir datos.

**Quién lo usa:** operador, administrador y superadministrador. No aparece para enfermería, «Solo Bodega transitoria» ni «Solicitante». El número rojo junto al menú indica cuántas órdenes tienen etiquetas pendientes.

**Paso a paso**
1. Menú lateral → **INVENTARIO → Impresión de etiquetas**.
2. Elige la vista **Por orden de compra** o **Por producto**.
3. Busca por N° de orden, proveedor, producto, lote o folio. Sirven varias palabras, sin tildes ni mayúsculas.
4. Filtra con **Todas**, **Pendientes**, **Impresas** o **Reimpresas**.
5. Toca una orden (o un producto) para abrir el detalle:
   - Arriba ves las cifras: unidades recibidas, etiquetas creadas, etiquetas por imprimir y unidades sin etiqueta.
   - Si dice **«Falta etiquetar N u.»**, toca **Crear las que faltan**, indica las cajas y créalas.
   - **Imprimir pendientes (N)**: imprime las que nunca se imprimieron y las editadas.
   - Para reimprimir, marca las etiquetas (o **Seleccionar todas**) y toca **Reimprimir seleccionadas (N)**. Te pide el motivo (**¿Por qué se reimprime?**) y lo confirmas con **Reimprimir**.
   - **Editar datos** (por grupo) o el lápiz de una etiqueta: cambia el producto, lote, vencimiento, bodega, proveedor o fecha. Las unidades solo se pueden cambiar si la caja está cerrada. **Guardar cambios** no toca el stock: la etiqueta queda **«Editada · reimprimir»**.
   - **Órdenes** te devuelve a la lista.
6. Abajo de los botones grandes hay tres enlaces: **Diferencias de conteo** (lo registrado al etiquetar stock existente), **Contar por bultos (pistola)** y **Probar la pistola**.

Qué significa cada estado:

| Estado | Qué significa |
|---|---|
| Faltan etiquetas / Sin etiquetas | Llegó mercadería que todavía no tiene etiqueta |
| Sin imprimir | Las etiquetas existen, pero nunca se imprimieron |
| Impresión parcial | Algunas se imprimieron y otras no |
| Cambios por reimprimir / Editada · reimprimir | Se corrigieron datos después de imprimir |
| Impresa / Reimpresa | Ya se imprimieron una vez / más de una vez |
| Sin registro (anterior) | Etiqueta de antes de que el sistema anotara las impresiones |


**Cómo imprimir en la Zebra**
- El PDF se abre en una pestaña nueva. Si el teléfono bloquea las ventanas emergentes, se descarga.
- Imprime en papel de **100 × 60 mm**, a **tamaño real**, sin «ajustar a la página». Si la hoja sale escalada, la pistola no lee el código.

**Si pasa esto…**
- **«Impresión no registrada»:** el PDF salió, pero no se pudo anotar la impresión (falló la conexión o la sesión). Revisa la conexión; la etiqueta seguirá apareciendo como pendiente.
- **La etiqueta dice «Impresa» pero el papel no salió:** el sistema la marca como impresa cuando abre el PDF, no cuando sale el papel. Reimprímela y en el motivo pon «no salió de la impresora».
- **«No pude leer las etiquetas.»:** falta conexión o la sesión expiró. Vuelve a entrar.

**Reglas**
- Siempre anota un motivo real al reimprimir (etiqueta dañada, se cayó, se corrigieron datos).
- Si corriges datos de una etiqueta ya pegada, reimprímela y reemplaza la etiqueta de la caja.

**Sin internet:** se puede imprimir lo que ya estaba cargado en el equipo y la impresión se anota al volver la conexión. La lista de órdenes puede no estar al día (ver notas).

---

## Probar la pistola

**Para qué sirve:** ver si la pistola lee el código de barras de las etiquetas y si la impresora está imprimiendo a tamaño real.

**Quién lo usa:** el mismo personal de Impresión de etiquetas. Conviene hacerlo al recibir una pistola nueva o cuando una no lee.

**Paso a paso**
1. Entra a **Impresión de etiquetas** y toca el enlace **Probar la pistola**.
2. Toca **Hoja de prueba (PDF)** e imprímela en la Zebra a **tamaño real** (100 × 60 mm, sin «ajustar a la página»).
3. Con una regla, mide la línea de abajo de la hoja: **debe medir 50 mm**. Si mide otra cosa, la impresora está escalando la hoja y hay que corregir el tamaño de papel en la impresora.
4. Haz clic en **«Pistolea aquí cada código de la hoja»** y pistolea los códigos **A** a **F**, uno por uno.
5. La tabla marca cada código:
   - **Sí** (en verde): lo leyó bien.
   - **«Sí, pero escribió «…» (revisar idioma del teclado de la pistola)»**: lo leyó, pero escribe otros caracteres.
   - **—**: no lo leyó.
6. Anota cuáles leyó y avísale al encargado del sistema. Con ese resultado se define el formato definitivo de la etiqueta.


**Si pasa esto…**
- **«La pistola termina con Tab / nada en vez de Enter»:** el Visor la acepta igual, pero conviene configurarla con Enter (sufijo CR) usando el manual de la pistola.
- **No lee ninguno:** revisa la medida de la línea de 50 mm. Si está bien, puede que la pistola tenga desactivado Code 128: hay que activarlo con los códigos de su manual.
- **«La librería de PDF aún no carga; intenta de nuevo en unos segundos.»:** espera un momento y vuelve a tocar el botón.

**Reglas**
- No uses la hoja de prueba para contar: sus números no son cajas.

**Sin internet:** la hoja de prueba se genera en el equipo y la prueba de lectura no necesita conexión. No confirmado en terreno.

---

## Pedir insumos desde el teléfono

**Para qué sirve:** que cualquier funcionario (enfermería, TENS, administrativos) pida insumos médicos, de aseo o de oficina desde su teléfono, sin usuario ni clave, y vea cómo avanza su pedido.

**Quién lo usa:** cualquier persona del SAR, con solo su nombre y su correo. El botón **Inventario de bodega** de esa misma página es para las encargadas de bodegas de uso y pide usuario (se explica en el módulo Bodega transitoria).

**El link**
- La página es **https://sarinventario.web.app/solicitar.html**. Es una página aparte, que solo sirve para pedir: no muestra el resto del Visor.
- El superadministrador tiene el link y su QR en **INVENTARIO → Fotos de productos → Accesos directos para el teléfono → Pedir insumos** (botón **QR** para mostrarlo o compartirlo).
- **Para dejarlo como app en el teléfono**, abre el link y despliega:
  - **Cómo instalar en Android:** en Chrome, toca ⋮ → **Agregar a pantalla de inicio** (o **Instalar app**) → **Agregar**. Si aparece el botón **Instalar «Pedir insumos» ahora**, basta con tocarlo.
  - **Cómo instalar en iPhone:** si lo abriste desde WhatsApp, toca ⋯ → **Abrir en Safari**. Después toca **Compartir** → **Agregar a inicio** → **Agregar**.
  - Queda el ícono verde **«Pedir insumos»** en la pantalla de inicio.


**Paso a paso (pedir)**
1. Abre **Pedir insumos**. En **¿Qué necesitas hacer?**, toca **Pedir insumos**.
2. Elige el tipo: **Insumos médicos**, **Aseo** u **Oficina**.
3. En **¿Quién pide?**, escribe **Tu nombre** (nombre y apellido) y **Tu correo**, y toca **Continuar**. El teléfono los recuerda para la próxima vez. Si otra persona usa el mismo teléfono, toca **Cambiar** al lado de «Pidiendo como…».
4. En **Agregar producto**, escribe las primeras palabras (desde 2 letras). La búsqueda tolera tildes y errores chicos («dimer» encuentra «D-DIMMER»), pero los números tienen que ser exactos (suero 250 no encuentra suero 500).
5. Toca el producto. Ajusta la **Cantidad** con − / + y toca **Agregar**.
6. Si no lo encuentras, toca **No está en la lista**:
   - Escribe el **Nombre del producto** completo: qué es, marca, medida o tamaño.
   - Ajusta la **Cantidad**.
   - Si puedes, toca **Foto (opcional)** y saca una foto de la caja o la etiqueta.
   - Toca **Agregar**. Si aparece **«¿Es alguno de estos?»**, revisa si tu producto ya estaba en la lista y tócalo.
7. Revisa **Tu solicitud (N)**: cambia las cantidades con − / + o quita productos con ✕.
8. Si quieres, escribe una **Nota (opcional)** (por ejemplo, «urgente para hoy»).
9. Toca **Enviar solicitud**. Aparece **«Solicitud enviada»** con tu número **SOL-AAAA-NNNN**. Si el número todavía no llega, dice **«N° oficial en camino»**.


**La vista del que pide: «Tus solicitudes»**
- Debajo del formulario aparecen tus solicitudes hechas desde ese teléfono. Puedes buscarlas por N° (SOL-…) o por producto.
- Cada solicitud muestra su recorrido:

| Estado | Qué significa |
|---|---|
| Enviada | Llegó a bodega |
| Procesando | Bodega la está revisando |
| Procesada | Bodega ya preparó y movió lo que había |
| Cerrada | Entregada |
| Anulada | Bodega la anuló |
| Por enviar (sin internet) | Todavía está solo en tu teléfono |

- Si bodega no tenía algo, aparece **«No disponible: …»** con el producto y la cantidad que faltó.
- Cuando tu solicitud cambia de estado aparece un aviso en pantalla. Toca **Ver** para ir a ella.
- **Modificar:** mientras la solicitud siga en **Enviada**, puedes cambiarla desde el mismo teléfono. Toca **Modificar**, haz los cambios y toca **Guardar cambios** (o **Cancelar**). Cuando bodega empieza a prepararla, ya no se puede cambiar.
- Si tu correo es institucional (cormumel.cl o vivirsalud.cl), también te llegan avisos por correo en horario hábil.


**Si pasa esto…**
- **«Escribe tu nombre y apellido.» / «Escribe un correo válido…»:** completa los dos datos.
- **«Nombre completo» / «Más detalle»** al agregar a mano: el nombre es muy corto. Sin foto hay que describir más (qué es, marca, medida o para qué se usa).
- **«No está en (tipo), pero sí en otro tipo»:** el producto está clasificado en otro tipo. Puedes agregarlo igual.
- **«Sin internet: se guardará en este teléfono y se enviará sola al volver la conexión.»:** está bien. La solicitud queda **«Guardada en el teléfono»** y se envía sola.
- **«No pude cargar la lista. Si no tienes internet, ábrela una vez con conexión para dejarla guardada.»:** la primera vez se necesita internet.
- **«Aún no disponible»:** bodega todavía no activa el acceso sin cuenta. Avisa a bodega.
- **«Bodega ya empezó a prepararla: no se puede cambiar.»:** si necesitas algo más, haz una solicitud nueva.
- **No me aparecen mis solicitudes anteriores:** solo se ven las hechas desde ese mismo teléfono y navegador.

**Reglas**
- Una solicitud por pedido. No mandes la misma dos veces «por si no llegó»: revisa **Tus solicitudes**.
- Usa tu nombre y tu correo reales. No pidas a nombre de otra persona.
- No escribas datos de pacientes (nombre, RUT, cama) en la nota ni en los productos.
- Usa **No está en la lista** solo si de verdad no aparece. Antes prueba con otra palabra.

**Sin internet:**
- La primera vez necesita conexión.
- Después, la página abre sin internet y puedes armar y **enviar** la solicitud: queda **«Por enviar (sin internet)»** y se envía sola cuando vuelve la conexión.
- El N° SOL se asigna cuando llega a bodega.

---

