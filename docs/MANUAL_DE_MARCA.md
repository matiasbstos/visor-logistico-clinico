# Manual de marca — Visor Logístico (SAR Arpillerista Elsa Romo Aravena)

Versión 1.0 · v20.58 del sitio. Esta guía es la fuente de verdad del **aspecto del sitio**. Los documentos
oficiales (actas de entrega, recepción conforme, informes PDF/Word) tienen su propio formato estándar y
**no se tocan** desde aquí. La versión visual vive en `manual-marca.html` (se publica con el sitio).

## 1. Idea de marca
Una cruz clínica dentro de un hexágono, con un punto verde que "orbita": **cuidado + logística + orden**.
El tono es sobrio, claro y confiable: mucho blanco, un azul profundo para estructura y títulos, y el verde
solo como acento de "todo bien / acción positiva". Nada recargado: una pantalla debe leerse en 3 segundos.

## 2. Logo
Archivos en `assets/logo/`:
| Uso | Archivo |
|---|---|
| Marca sola (fondo claro) | `marca.svg` |
| Marca sobre fondo azul/oscuro | `marca-sobre-oscuro.svg` |
| Monocromo (sellos, impresión 1 tinta) | `marca-monocromo.svg` |
| Horizontal (encabezados) | `horizontal.svg` |
| Vertical | `vertical.svg` |
| Ícono de la app / PWA | `icono-app.svg`, `icono-app-512.png`, `assets/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon-32.png` |
- Zona de respeto: al menos la mitad del alto del hexágono por todos lados.
- Tamaño mínimo: 24 px de alto en pantalla (favicon 32 px).
- No deformar, no girar, no cambiar los colores, no poner sobre fotos ni degradados que le quiten contraste.
- El logo del SAR (`assets/logo-sar.png`) acompaña a la marca en el encabezado de la app y en el login. El logo de la Corporación **no** va en el login; sí en documentos oficiales.

## 3. Color
| Token | Valor | Para qué |
|---|---|---|
| `--brand-blue` (`--sar-blue`) | `#1A3668` | Estructura: barra lateral, títulos, botón primario, enlaces |
| `--brand-blue-deep` | `#122650` | Hover del primario, fondos oscuros, degradados |
| `--brand-blue-bright` | `#2C5AA8` | Luz del degradado del panel, detalles |
| `--brand-green` (`--sar-green`) | `#8CC63F` | Acento positivo: foco de campos, íconos de marca, "recepcionado/conforme" |
| `--brand-green-ink` | `#4D7C0F` | Texto verde sobre fondo claro (contraste AA) |
| `--sar-red` | `#CC1B23` | Alerta, atraso, error, acción destructiva |
| `--sar-orange` | `#E85D1E` (texto: `#C2410C`) | Parcial, advertencia |
| `--sar-yellow` | `#F3D015` | En análisis / pendiente de revisión |
| Neutros | `#0F172A` texto · `#64748B` secundario · `#E2E8F0` bordes · `#F8F9FA` fondo app | |

El azul cielo `#0284C7` ya no se usa (no es de la marca y no cumple contraste AA como texto): usar el azul de marca.

Reglas: el color **significa** algo (rojo = problema, naranja = parcial, amarillo = en análisis, verde = ok).
Nunca decorar con rojo. Texto sobre naranja/verde claro: usar las variantes "ink"/"text" para cumplir contraste AA.
Estados con color siempre llevan además texto o ícono (no solo color).

## 4. Tipografía
**Inter** (400, 500, 600, 700, 800). Monoespaciada solo para códigos (N° de OC, lotes, folios).
| Rol | Tamaño / peso |
|---|---|
| Título de página (`h1`) | 28 px · 800 · azul · tracking −0,01 em |
| Título de tarjeta (`h3`) | 16–18 px · 700 · azul |
| Texto | 14 px · 400/500 · `#0F172A` |
| Secundario / ayudas | 12–13 px · `#64748B` |
| Etiquetas de tabla y de campo | 11–12 px · 700 · MAYÚSCULAS · tracking +0,04 em |
Las cifras importantes (KPI) van en 24–28 px · 800.

## 5. Forma, sombra y movimiento
- **Forma firma**: `--shape-card` = `8px 8px 8px 0` (la esquina inferior izquierda recta repite los cuadrados del logo). Se usa en botones, campos y tarjetas; no la reemplace por un radio uniforme.
- **Radios**: `--r-sm 8 px` · `--r-md 12 px` · `--r-lg 16 px` (modales) · `--r-xl 24 px` (el contenedor del login) · `--r-pill` (botones fantasma y chips de estado).
- **Sombras** (siempre teñidas de azul, nunca negro puro): `--sh-1` reposo · `--sh-2` elevada (hover, menús) · `--sh-3` modal/login.
- **Movimiento**: curva `cubic-bezier(.2,.7,.2,1)`; 150–250 ms en controles, 600–800 ms solo en transiciones de marca (login). Se respeta `prefers-reduced-motion`.
- **Foco**: anillo verde `0 0 0 3px rgba(140,198,63,.35)` + borde verde en campos; `outline` verde de 3 px en botones/enlaces.

## 6. Componentes
- **Botón primario**: fondo azul, texto blanco, radio 8, sombra azul suave; hover = azul profundo + sube 1 px. Una sola acción primaria por zona.
- **Botón secundario (`btn-outline`)**: blanco con borde gris; hover gris muy claro.
- **Botón fantasma de marca** (sobre azul): borde blanco, píldora; hover invierte.
- **Peligro**: borde/texto rojo; el relleno rojo solo en confirmaciones irreversibles.
- **Campos**: fondo `#F8FAFC`, borde `#E2E8F0`, radio 8, etiqueta en mayúsculas pequeñas arriba; foco verde.
- **Tarjetas** (`.card`, `.erp-card`): blancas, borde `#E2E8F0`, forma firma, sombra `--sh-1`.
- **Tablas**: encabezado en mayúsculas pequeñas azules sobre `#F8FAFC`; filas con separador fino; hover `#F8FAFC`.
- **Chips/estado**: píldora con fondo claro del color semántico + texto "text"; p. ej. Entregado completo (verde), Entrega parcial (naranja), Atrasada (rojo), En análisis (amarillo).
- **Modales**: blanco, radio 16, sombra `--sh-3`, título azul, acciones a la derecha (Cancelar · Guardar).
- **Avisos (toasts)**: título en negrita + mensaje + "Ref. CÓDIGO" (ver `errores.js`).
- **Íconos**: Phosphor (regular para menú, bold para acciones). Un ícono por acción, nunca solo ícono sin etiqueta salvo en barras compactas.

## 7. Voz y textos
Español de Chile, trato de **usted** en pantallas de acceso y avisos formales; directo y breve en el trabajo diario.
Verbos de acción en botones ("Registrar recepción", "Generar acta"). Errores: qué pasó + qué hacer + código de referencia.
Sin datos de pacientes ni RUT en pantallas (ver `docs/DECISIONES.md`).

## 8. Cómo trabajar sin romper la identidad
1. Usar tokens (`var(--brand-blue)`, `var(--r-md)`, `var(--sh-1)`), no valores sueltos.
2. Reusar clases existentes (`.btn`, `.card`, `.erp-card`, `.soc-chip`) antes de crear nuevas.
3. Pantalla nueva = encabezado `.page-header`, tarjetas, una acción primaria.
4. Revisar en 1440 px y en 390 px (móvil) y con "reducir movimiento".
5. Los documentos (`acta-documentos.js`, plantillas) no se modifican por cambios de marca del sitio.
