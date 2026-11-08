# Fichas de componentes (patrón de especificación)

Cada componente se describe igual: **anatomía → estados → tokens → responsive → movimiento → accesibilidad**. Se actualiza al crear o rehacer uno (ver `.claude/agents/ux-ui-flujo.md`).

## 1. Ficha de registro (Registros de la jornada, `.toma-fila`)
**Anatomía:** 1 nombre y código · 2 cantidad de la toma · 3 total acumulado · 4 hora/toma · 5 categoría · 6 lote · 7 vencimiento · 8 ubicación · 9 estado Google Sheets · 10 acciones (editar, incidencia, reintentar, eliminar).
**Estados:** vacío (mensaje + qué hacer), cargando (esqueleto), normal, pendiente de envío, con error de envío (texto + ícono, no solo color).
**Tokens:** `--id-borde`, `--id-r-sm`, `--text-muted`; sin acento lateral.
**Responsive:** fichas flex que bajan de línea; sin scroll horizontal a 390 px.
**Movimiento:** ninguno propio. **Accesibilidad:** acciones con `title`/nombre accesible.

## 2. Fila del explorador de bodega (`.bx-fila`)
**Anatomía:** 1 foto · 2 nombre · 3 categoría/lote/código · 4 vencimiento · 5 stock · 6 acciones Ajuste y Mover.
**Estados:** cargando (esqueleto), vacío («aún no tiene productos»), sin coincidencias, error con código BX-01; stock 0 y vencido en rojo, por vencer en naranja (siempre con texto «vencido/por vencer»).
**Tokens:** `--sar-red`, `--sar-orange`, `--sar-blue`, `--id-borde`. **Responsive:** acciones a todo el ancho en celular. **Accesibilidad:** buscador y filtro con `aria-label`; campo de 16 px (sin zoom en iPhone).

## 3. Carga de pantalla (`SAR_Progreso.cargando`)
**Anatomía:** bloques `.sar-esq` con barrido. **Cuándo:** al entrar a una vista, antes de leer datos. **Acciones** (guardar, subir, emitir acta) usan en cambio el logo con anillo. **Movimiento:** ≤1,6 s en bucle, desactivado con `prefers-reduced-motion`.

## 4. ¿Dónde está? (estado inicial)
**Anatomía:** 1 buscador · 2 recientes (máx. 6) · 3 bodegas con total · 4 críticos con foto. **Estados:** cargando, sin resultados, error DE-01.

## Pendiente de documentar
Tarjeta KPI, botones (primario/secundario/peligro), insignias de estado, modales, tablas (Existencias, Seguimiento de OC).
