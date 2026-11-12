# Formatos de cuadro de distribución que el visor sabe leer

Regla: cada formato que el usuario entrega queda **como prueba permanente** (`tests/unidad.js` + `tests/fixtures/`). Un formato nuevo se agrega al lector sin romper los anteriores; `node tests/unidad.js` debe pasar siempre antes de publicar.

| # | Formato | Dónde se lee | Prueba |
|---|---|---|---|
| 1 | PDF «Cuadro de distribución» de la orden (OC Mercado Público, columnas CANTIDAD por memo; variantes con/sin FINANCIAMIENTO, corrido a la izquierda) | `oc-lector.js` `extraerDistribucion` / `extraerDistribucionB` | `fixtures/cuadro-oc-948.json` |
| 2 | Excel «MEMO N° … CDP N° …» (descripción, valor neto, cantidad por memo, pie NETO/IVA/TOTAL) | `extraerDistribucionExcel` | pruebas de lector Excel |
| 3 | Excel «MEMO # N-CENTRO-CDP #», columnas PRODUCTOS / PROVEEDOR / VALOR NETO y CANTIDAD\|TOTAL por memo (insumos eléctricos, OC 1298355-933-AG26) | `extraerDistribucionExcel` | `fixtures/dist-electricos.json` |
| 4 | Solicitud de insumos por centro (planilla sin descripción, con ID convenio marco/equivalente/valor/cantidad) | `distribucion-centros.js` `parsearHoja` | pruebas de distribución |

## Tolerancia (formatos 2 y 3)
Se aceptan columnas corridas o vacías a la izquierda, filas vacías arriba, «Memo N°/Nº/#», encabezados de producto «Descripción/Productos/Detalle/Insumo/Ítem», precio «Valor neto/Precio/Neto unitario», cantidad «Cantidad/Cant.», el memo escrito sobre CANTIDAD, sobre TOTAL o combinado, y el pie de montos en la columna de cantidad o de total. Un memo con «SAR» en el centro se toma como el centro propio.
