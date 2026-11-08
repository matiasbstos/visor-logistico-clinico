# Identidad visual del Visor Logístico

Guía viva para quien diseñe o revise pantallas (personas y el agente `ux-ui-flujo`). Base: la pantalla de **login**. Meta del usuario: un sitio **muy limpio, moderno y reconocible**, que no se vea «hecho con IA».

## Principios
1. **Limpio primero:** una sola idea por tarjeta, mucho aire, pocos colores a la vez. Si algo no ayuda a decidir, se quita.
2. **Marca = login:** azul `#1A3668` como color de estructura y títulos; rojo, naranja, amarillo y verde solo como *significado* (alerta, atraso, análisis, conforme), nunca como decoración.
3. **Forma firma:** tarjetas `--shape-card` (14 px, esquina inferior izquierda recta, como los cuadrados del logo SAR). Botones y campos 10 px (`--id-r-sm`). Ventanas 20 px. Sombra suave `--id-sombra`.
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

## Referencias de estudio (revisadas)
- KTUI (Keenthemes, MIT, JS puro sobre Tailwind): modelo de componentes (tarjetas, tablas, pasos, esqueletos, avisos). Solo referencia, no se instala.
- Rive (runtimes MIT): opción futura para animaciones de marca livianas; hoy basta CSS.
- Animate.css (MIT): catálogo de ideas de movimiento; no se instala.
- Pendiente de revisar: skills de diseño de la comunidad (p. ej. Swiftner/design-skill, design-system de everything-claude-code) cuando sus páginas sean legibles.

## Estado de la migración
- v21.69: radios, sombras, campos, títulos y tablas unificados.
- v21.70: sin acentos laterales; estado con punto de color.
- Siguiente: tokens en lugar de colores escritos a mano, eliminar estilos de botón duplicados, revisar Existencias, Seguimiento de OC y ventanas con datos reales.

## Referencias de movimiento y método (revisadas v21.79)
- **Bibliotecas de componentes animados** (Vengeance UI, Animate UI, UI Lora): son React/Tailwind y no se instalan en este sitio (JS puro). Se toman como **referencia de patrón**: números que cuentan hasta su valor, indicador deslizante en pestañas/segmentos, entradas escalonadas de listas, tarjetas que reaccionan al puntero. Reglas: ≤0,4 s, solo si explican un cambio, respetan `prefers-reduced-motion`.
- **Skills de diseño** (/design-critique, /design-handoff, /figma-use-motion): el sitio no usa Figma, por lo que se adoptan los **métodos**, no las herramientas: crítica con severidad y cordura de datos, y ficha de especificación por componente (`docs/COMPONENTES.md`).
