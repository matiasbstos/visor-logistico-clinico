---
description: Guardián de integridad y reglas inquebrantables del Visor Logístico Clínico
always_on: true
---

# 🛡️ Guardián de Integridad — Visor Logístico Clínico

Ante cualquier instrucción, cambio de código, optimización o agregado de nuevas funciones, debes seguir obligatoriamente estas pautas:

1. **Chequeo de Integridad Previo**:
   - Nunca romper la sincronización entre Firestore (`Insumos`, `Historial_Movimientos`), Google Sheets (`CONSOLIDADO_GENERAL`, pestañas de categorías, `📊 DASHBOARD`) y la interfaz web del Visor.
   - Preservar los IDs y selectores del DOM en `index.html`.

2. **Formato de Fechas y Cálculos**:
   - Usar siempre el parseador universal de fechas `window.SAR_Utils.parseDate` / `parseDateGAS` para cálculo de días restantes y semáforos (< 30 días, 1-6 meses, > 6 meses).

3. **Verificación Sintáctica y Cache**:
   - Validar sintaxis con `node -c <file>.js` tras cada cambio.
   - Incrementar la versión del Service Worker en `sw.js` y en los scripts de `index.html` (`?v=X.X`) para evitar que el navegador del usuario sirva versiones obsoletas en caché.
   - Desplegar siempre con `npx firebase-tools deploy --only hosting`.
