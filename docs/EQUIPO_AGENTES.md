# Equipo de agentes: Los Magníficos

Cuando el usuario dice «llama a …», se lanza ese agente (definido en `.claude/agents/<nombre>.md`). «Llama a Los Magníficos» o «a todo el equipo» = Hannibal arma el plan y se lanzan en paralelo B.A., Face, Decker y Frankie (y Murdock si hace falta investigar fuera); Amy revisa al final, antes de publicar.

| Nombre | Personaje | Para qué |
|---|---|---|
| **Hannibal** | John «Hannibal» Smith, el líder | Plan de un cambio grande: pasos, decisiones del usuario, riesgos, a quién llamar |
| **Face** | Templeton «Faceman» Peck, la imagen | UX/UI e identidad visual (antes «ux-ui-flujo») |
| **B.A.** | B.A. Baracus, el mecánico | Integridad del stock: transacciones, descuentos dobles, carreras, simulación |
| **Murdock** | H.M. «Aullador» Murdock, el piloto | Investigación externa: normas, sistemas europeos, referencias, con fuentes |
| **Decker** | Coronel Decker, el perseguidor | Seguridad: reglas, página pública, XSS, datos expuestos |
| **Frankie** | Frankie Santana, efectos especiales | Sin internet: cola, caché, service worker, borradores |
| **Amy** | Amy Allen, la periodista | Revisión independiente del cambio justo antes de publicar |

Todos son de **solo lectura**: revisan, prueban y proponen; los cambios los hace la sesión principal y los decide el usuario.

# Equipo logístico: La Teoría del Big Bang

Dedicado **solo a logística e inventario** de insumos clínicos, con cada cargo basado en referencias europeas (y la norma chilena en paralelo cuando aplique). «Llama al equipo Big Bang» = **Leonard** arma el plan y reparte; los demás revisan en paralelo; **Fowler** revisa al final. Los Magníficos siguen a cargo de lo técnico (código, diseño, seguridad, sin internet); en un cambio grande trabajan los dos equipos y cierran Fowler (logística) y Amy (técnica).

| Nombre | Personaje | Cargo (referencia europea) | Para qué |
|---|---|---|---|
| **Leonard** | Leonard Hofstadter | Jefe de bodega, nivel ESLog (ELA) · Buenas Prácticas de Distribución UE | Coordina; procesos de recepción, ubicación, picking, despacho, devoluciones |
| **Sheldon** | Sheldon Cooper | Especialista en normas, nivel EMLog · GS1, UDI (MDR), Reglamento 2016/161 | Trazabilidad, códigos, lotes, vencimientos, correlativos |
| **Howard** | Howard Wolowitz | Técnico de identificación automática · ISO/IEC 15417 y 15416, etiqueta GS1 | Pistolas, Zebra, etiquetas, simbologías, calidad de impresión |
| **Raj** | Rajesh Koothrappali | Planificador, nivel ESLog · Dynamics 365, EAHP | Consumo, ABC/XYZ, mínimos, stock de seguridad, punto de pedido |
| **Penny** | Penny | Operaria, nivel EJLog · ISO 11228-1, EU-OSHA (+ 5S/Lean, de origen japonés) | Uso real en bodega: pasos, teléfono, guantes, orden físico |
| **Bernadette** | Bernadette Rostenkowski | Farmacia hospitalaria · EAHP, Buenas Prácticas de Distribución UE | FEFO, vencimientos, cadena de frío, controlados, bandejas, carro de paro |
| **Stuart** | Stuart Bloom | Datos maestros · EMDN, EDQM Standard Terms, eCl@ss | Catálogo, duplicados, unidades de empaque, categorías, fotos |
| **Fowler** | Amy Farrah Fowler | Auditora interna · ISO 19011, conteo cíclico (SAP) | Revisión final: tomas, ajustes, exactitud (IRA), conciliación |

Fowler se llama así (y no «Amy») porque Amy ya es la periodista de Los Magníficos. Todos son de **solo lectura**, igual que Los Magníficos. Investigación de los cargos: Murdock, nov. 2026 (fuentes en cada `.claude/agents/<nombre>.md`).
