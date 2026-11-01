<div align="center">

<img src="assets/logo-sar.png" alt="Logo SAR" height="96">

# Visor Logístico Clínico

**Sistema web para controlar insumos médicos y su movimiento dentro de la red de bodegas, bandejas y carros de paro del SAR.**

![Versión](https://img.shields.io/badge/versi%C3%B3n-20.11-blue)
![JavaScript](https://img.shields.io/badge/JavaScript-ES%20Modules-F7DF1E?logo=javascript&logoColor=black)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%7C%20Firestore%20%7C%20Hosting-FFCA28?logo=firebase&logoColor=black)
![PWA](https://img.shields.io/badge/PWA-instalable-5A0FC8)
![Licencia](https://img.shields.io/badge/licencia-propietaria-red)

[Decisiones de diseño](docs/DECISIONES.md) · [Guía para agentes y desarrolladores](AGENTS.md) · [Hoja de ruta](#-hoja-de-ruta)

</div>

---

## 🌟 Acerca del proyecto

El Visor Logístico Clínico responde a una pregunta simple: **¿dónde está cada insumo, cuánto hay, cuándo vence y quién lo movió?**

Nació para ordenar la cadena de suministro de un servicio de urgencia: desde que el insumo llega del proveedor hasta que queda en una bandeja de turno o en el carro de paro, incluyendo los traspasos a otros centros. Funciona en tiempo real: todos los operadores ven los cambios de stock al instante.

> **Es un sistema logístico, no clínico.** Registra ubicaciones, lotes, cantidades y responsables. No guarda datos de pacientes (ver [Datos personales](#-seguridad-y-datos-personales)).

### Cadena de movimiento

```
Proveedor → Bodega Central → Bodega Transitoria → Transitoria de Farmacia → Bandeja / Carro de Paro
                  └──→ Otros centros (traspaso externo)
```

### Principios

- 🎯 **Trazabilidad:** cada movimiento queda registrado con origen, destino, lote, cantidad y responsable.
- 🛡️ **Integridad:** el stock y su historial se modifican juntos; nada se pierde por un corte de conexión.
- 🔒 **Mínimo dato necesario:** se guarda solo lo que la operación logística requiere.
- ⚡ **Velocidad:** JavaScript puro, sin frameworks pesados, pensado para uso en turno.

---

## ✨ Funcionalidades

| Módulo | Qué permite |
|---|---|
| **Panel de control** | Stock total, insumos críticos, próximos vencimientos y alertas |
| **Inventario** | Catálogo por categoría, lotes, vencimientos y precio unitario |
| **Bodegas** | Alta y gestión de recintos, stock por ubicación y comparativa entre bodegas |
| **Transferencias** | Traspasos entre bodegas con registro de auditoría |
| **Bandejas de turno** | Armado, despacho, recepción, arqueo y reasignación; plantillas (packs) reutilizables |
| **Toma de inventario** | Conteo físico, conteo semanal por racks y respaldos de cada toma |
| **Ajustes** | Solicitudes de ajuste con flujo de aprobación del administrador |
| **Adquisiciones** | Solicitudes de compra, seguimiento, backorders y división de órdenes de compra |
| **Informes** | Reportes logísticos y exportación a Excel y PDF |
| **Triaje con IA** | Lectura de etiquetas de insumos desde una fotografía |
| **Usuarios y roles** | Acceso por rol, con permisos distintos para administración, operación y enfermería |
| **Historial** | Bitácora de movimientos con responsable y fecha |

Además: cargas masivas desde Excel, escaneo de códigos, modo instalable (PWA) y caché local para trabajar con conexión intermitente.

---

## 🧰 Stack tecnológico

- **Cliente:** HTML5, CSS3 y JavaScript (módulos ES), sin framework.
- **Backend como servicio:** Firebase Authentication, Cloud Firestore y Firebase Hosting.
- **Librerías:** SheetJS (Excel), jsPDF y jsPDF-AutoTable (PDF), Chart.js (gráficos), html5-qrcode (escáner), Phosphor Icons.
- **PWA:** service worker con estrategia *network-first* y versionado de caché.
- **Funciones en la nube:** `functions/` contiene un servicio de OCR con Google Cloud Vision (aún no conectado a la aplicación).

---

## 📂 Estructura del repositorio

```text
visor-logistico-clinico/
├── index.html                  # Interfaz (aplicación de una sola página)
├── style.css                   # Sistema de diseño y temas
├── script.js                   # Lógica central: autenticación, roles, inventario, bandejas
├── excelUtils.js               # Importación y exportación masiva con Excel
├── visor-adquisiciones.js      # Módulo de adquisiciones y seguimiento
├── visor-triaje.js             # Escáner inteligente de etiquetas
├── patch-plantillas.js         # Plantillas (packs) de bandejas
├── sw.js · manifest.json       # Service worker y manifiesto PWA
├── firebase.json               # Hosting: qué se publica y cabeceras de caché
├── firestore.rules             # Reglas de seguridad de la base de datos
├── firestore.indexes.json      # Índices compuestos
├── functions/                  # Cloud Functions (OCR)
├── docs/DECISIONES.md         # Decisiones de diseño y plan por fases
└── AGENTS.md                   # Reglas de trabajo para desarrolladores y agentes
```

> El repositorio conserva además copias históricas (`backups/`, `.rollbacks/`) y scripts de mantenimiento puntuales. Están **excluidos de la publicación** en `firebase.json` y se retirarán progresivamente (ver hoja de ruta).

---

## 🚀 Puesta en marcha

### Requisitos
- Node.js 18 o superior
- [Firebase CLI](https://firebase.google.com/docs/cli): `npm install -g firebase-tools`
- Acceso al proyecto de Firebase (solicitar al administrador)

### Pasos

```bash
git clone https://github.com/matiasbstos/visor-logistico-clinico.git
cd visor-logistico-clinico
npm install
firebase login
firebase emulators:start --only hosting     # http://localhost:5000
```

> ⚠️ **Atención:** hoy la aplicación se conecta directamente al proyecto de Firebase de producción, también cuando se sirve en local. **No pruebes cambios de datos contra el sistema real.** Conectar la aplicación a los emuladores de Firebase y crear un proyecto de pruebas (*staging*) están en la hoja de ruta.

### Cómo trabajar los cambios
1. Crear una rama: `git checkout -b feat/<tema>`.
2. Verificar sintaxis y los puntos del protocolo de [AGENTS.md](AGENTS.md).
3. Abrir un *Pull Request* hacia `main`.
4. El responsable del proyecto revisa, aprueba y despliega a producción.

---

## 🔒 Seguridad y datos personales

- **Acceso por roles**, aplicado en la interfaz y en las reglas de Firestore.
- **Sin datos de pacientes:** el sistema no almacena RUT, nombre, domicilio ni cama. Para medicamentos controlados se prevé guardar únicamente el **folio DAU**, en un registro separado de acceso restringido (ver [decisiones de diseño](docs/DECISIONES.md)).
- **Datos de funcionarios** (correo, nombre, rol y bitácora de acciones): tratados con finalidad logística y acceso por rol. Se está adecuando el sistema a la Ley 21.719 de protección de datos personales.
- **Credenciales:** no deben existir contraseñas ni claves en el repositorio. Si encuentras alguna, avisa al responsable de inmediato.

Para reportar una vulnerabilidad, escribe directamente al responsable del proyecto; no abras un *issue* público.

---

## 🧭 Hoja de ruta

- [ ] **Fase 0 · Seguridad inmediata:** rotación de credenciales, reglas de usuarios, escape de datos en pantalla, restricción de lectura del historial.
- [ ] **Fase 1 · Ubicaciones por identificador:** renombrar, archivar y crear bodegas transitorias sin perder historial; vista «¿Dónde está?».
- [ ] **Fase 2 · Medicamentos controlados:** folio DAU en registro separado y eliminación de datos de pacientes ya guardados.
- [ ] **Fase 3 · Movimientos en dos pasos:** despacho y recepción con stock en tránsito; transiciones válidas entre tipos de ubicación.
- [ ] **Fase 4 · Reglas por rol y por campo**, pruebas con el emulador y entorno de pruebas.
- [ ] **Fase 5 · Modularización** del código, actualización de dependencias y retiro de respaldos duplicados.

Detalle y justificación en [docs/DECISIONES.md](docs/DECISIONES.md).

---

## 📄 Propiedad y derechos de uso

⚠️ Este repositorio y su código fuente son de **propiedad exclusiva y uso restringido** (código propietario). Su único propósito es mostrar el avance del proyecto. **No está permitida** su copia, distribución, modificación ni uso comercial o personal sin autorización expresa de los autores. Todos los derechos reservados.
