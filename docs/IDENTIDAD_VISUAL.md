# Identidad visual del Visor Logístico

Guía viva para quien diseñe o revise pantallas (personas y el agente `face`, antes `ux-ui-flujo`). Base: la pantalla de **login**. Meta del usuario: un sitio **muy limpio, moderno y reconocible**, que no se vea «hecho con IA».

## Principios
1. **Limpio primero:** una sola idea por tarjeta, mucho aire, pocos colores a la vez. Si algo no ayuda a decidir, se quita.
2. **Marca = login:** azul `#1A3668` como color de estructura y títulos; rojo, naranja, amarillo y verde solo como *significado* (alerta, atraso, análisis, conforme), nunca como decoración.
3. **Forma firma:** tarjetas `--shape-card` (`14px 14px 14px 0`: esquina inferior izquierda recta, como los cuadrados del logo SAR). Botones y campos 10 px (`--id-r-sm`). Ventanas 20 px. Chips en píldora. Sombra suave `--id-sombra`. *Esto es lo que dice el CSS vigente y manda sobre cualquier otro documento (MANUAL_DE_MARCA.md quedó alineado en 4.306).*
4. **Movimiento con sentido:** cada animación explica algo (entra, cambia de estado, avanza un proceso). Máx. 0,4 s, `prefers-reduced-motion` respetado.
5. **Carga:** pantallas y listas → **esqueleto con barrido de luz**; acciones (guardar, crear acta, recepción conforme, subir) → **logo con anillo** (`SAR_Progreso`).

## Prohibido (huellas típicas de sitios hechos con IA)
- **Borde de color a un costado** de tarjetas, alertas, avisos o filas (acento lateral). El estado se indica con: punto de color junto al título, ícono, texto, o fondo suave del tono.
- Degradados morados/azules decorativos, brillos y tarjetas de vidrio sin razón.
- Emojis como íconos; usar Phosphor (`ph-bold`).
- Sombras fuertes, bordes gruesos, varias formas distintas de botón en una misma pantalla.
- Colores escritos a mano: usar tokens (`--sar-*`, `--id-*`).

## Reglas rápidas
- Una acción primaria por zona (azul sólido); secundaria con borde; peligro rojo, lejos de la primaria.
- Títulos: `h1` 1,6 rem / 800 / azul. Etiquetas de tabla en mayúsculas pequeñas.
- Estados vacíos, de carga y de error siempre diseñados; sin «Cargando…» suelto.
- Color nunca es el único indicador (WCAG 2.2 AA): acompañar con texto o ícono.
- Espaciado en múltiplos de 4/8 px; objetivos táctiles ≥ 40 px.

## Plantilla de pantalla (4.306)
Toda vista del sitio sigue este orden. Revisar siempre a **1280 × 575** (portátil del SAR) y a **390 px** (teléfono).
1. **Encabezado** `.page-header`: `h1` con el **mismo nombre que el menú** (p. ej. «Ajustes de stock», «Seguimiento de OC», «Solicitudes recibidas») y una **bajada** (`p`) con la forma larga o los totales. Sin ícono dentro del `h1`. Las acciones de la pantalla van a la derecha en `.page-actions`: **una sola primaria** (azul) y el resto `.btn-outline`.
2. **Pestañas** (si hay): siempre `.aud-tabs` / `.aud-tab` (`.page-tabs`, `.act-tabs` y `.bu-tabs` se ven igual): texto gris, la activa en azul con **subrayado azul de 3 px**. Sin rojo. Un contador va en `<em>`, no en una insignia roja. El encabezado va **antes** de las pestañas.
3. **Filtros en una fila**: buscador con `flex: 1` y los `select` a su lado; en teléfono se apilan. El texto del buscador dice qué busca («Buscar producto por nombre o código…»).
4. **Contenido**: tablas o tarjetas `.erp-card` (borde gris, sin acento de color arriba ni al costado). Indicadores con **punto de color** junto al número, sin borde de color.
5. **Chips** de filtro: 40 px de alto, píldora (`.bit-chip`, `.err-chip`, `.ft-chip`, `.bu-chip`).
6. **Números**: siempre `toLocaleString('es-CL')` (miles con punto) y «u.» en cantidades. Lote y vencimiento con letra de 12 px como mínimo.
7. **Datos que faltan**: «—» (sin documento), «Sin ubicación», «Registro incompleto», «Capacidad: sin definir». Nunca valores de ejemplo («FACT-000», «12 % más que ayer») ni cifras escritas en el HTML: mientras carga, **esqueleto**.
8. **Base**: `.dashboard-container` con padding `24px 32px` (16 px en teléfono); `.btn` con alto mínimo 40 px; `title` en todo botón que solo tiene ícono.
9. **Barra superior** en una línea desde 768 px (el título se corta con «…»); el estado de la nube es un punto verde. El menú lateral desplaza todos sus ítems; en el pie fijo solo queda «Salir».

## Referencias de estudio (revisadas)
- KTUI (Keenthemes, MIT, JS puro sobre Tailwind): modelo de componentes (tarjetas, tablas, pasos, esqueletos, avisos). Solo referencia, no se instala.
- Rive (runtimes MIT): opción futura para animaciones de marca livianas; hoy basta CSS.
- Animate.css (MIT): catálogo de ideas de movimiento; no se instala.
- Pendiente de revisar: skills de diseño de la comunidad (p. ej. Swiftner/design-skill, design-system de everything-claude-code) cuando sus páginas sean legibles.

## Estado de la migración
- v21.69: radios, sombras, campos, títulos y tablas unificados.
- v21.70: sin acentos laterales; estado con punto de color.
- 4.306 (próxima versión): plantilla de pantalla aplicada a todas las vistas del menú (títulos h1, pestañas, chips, filtros, números es-CL, menú lateral y barra superior).
- Siguiente: tokens en lugar de colores escritos a mano, eliminar estilos de botón duplicados.

## Referencias de movimiento y método (revisadas v21.79)
- **Bibliotecas de componentes animados** (Vengeance UI, Animate UI, UI Lora): son React/Tailwind y no se instalan en este sitio (JS puro). Se toman como **referencia de patrón**: números que cuentan hasta su valor, indicador deslizante en pestañas/segmentos, entradas escalonadas de listas, tarjetas que reaccionan al puntero. Reglas: ≤0,4 s, solo si explican un cambio, respetan `prefers-reduced-motion`.
- **Skills de diseño** (/design-critique, /design-handoff, /figma-use-motion): el sitio no usa Figma, por lo que se adoptan los **métodos**, no las herramientas: crítica con severidad y cordura de datos, y ficha de especificación por componente (`docs/COMPONENTES.md`).
