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

4. **Protocolo de Publicación (rama + revisión humana)**:
   - **Un agente NUNCA hace `git push origin main` ni despliega a producción por iniciativa propia.** Eso lo decide y ejecuta el usuario, después de revisar.
   - Flujo obligatorio para cada cambio:
     1. Crear una rama (`git checkout -b feat/<tema>`); no trabajar directo sobre `main`.
     2. Comprobar sintaxis (`node --check <archivo>.js`).
     3. Incrementar la versión de Cache Busting (`sw.js` e `index.html`) cuando cambie código de la aplicación.
     4. Commit en la rama y push **de la rama**; abrir Pull Request hacia `main`.
     5. El usuario revisa, prueba (emulador o entorno de pruebas), hace el merge y despliega.
   - **No ejecutar** `node publish-release.js`, `npm run release` ni `npm run deploy`: hacen `git add .`, push a `main` y despliegan Hosting **y reglas de Firestore** a producción en un solo paso. Solo los ejecuta el usuario, a mano.
   - No agregar a Git archivos con credenciales (`serviceAccountKey.json`, `.env`, contraseñas, claves de API).

5. **Datos de pacientes**: este sistema no guarda RUT, nombre, domicilio ni cama de pacientes. Excepción prevista: folio DAU de medicamentos controlados, en un registro separado. Si una función nueva captura datos de personas, no se implementa sin consultar.

6. **Referencias**: reglas completas en `AGENTS.md`; decisiones y plan por fases en `docs/DECISIONES.md`.
