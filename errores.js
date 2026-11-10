/* ==========================================================================
   DIRECTORIO DE ERRORES Y ALERTAS (v20.51)
   Catálogo único: código, qué significa, causa probable y cómo resolverlo.
   - Los avisos (toast) de error/advertencia que coinciden con el catálogo muestran "Ref. SAR-XXX-000".
   - Cada aparición se anota en este equipo (localStorage, máx. 100). NO se guarda ningún dato de pacientes.
   - Vista solo para administración: buscar, filtrar, ver causa/solución y las apariciones recientes.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const esc = (s) => (window.escapeHTML ? window.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const LLAVE = 'sar_errores_log_v1';

    const CATEGORIAS = { AUT: 'Acceso y sesión', DAT: 'Datos y conexión', INV: 'Inventario y bodegas', COM: 'Compras y OC', DOC: 'Archivos y documentos', CLI: 'Seguridad clínica', SIS: 'Sistema' };

    // [codigo, nivel, titulo, mensaje, causa, solucion, quien, [textos que lo identifican]]
    const C = [
        ['SAR-AUT-001', 'error', 'Credenciales incorrectas', 'Correo o contraseña no coinciden.', 'Contraseña mal escrita o cambiada; correo de otra cuenta.', 'Revisar mayúsculas y el correo institucional. Si no la recuerda, usar "¿Olvidó su contraseña?".', 'Usuario', ['auth/wrong-password', 'auth/invalid-credential', 'credenciales incorrectas']],
        ['SAR-AUT-002', 'error', 'Cuenta no registrada', 'El correo no figura en la base de datos.', 'Cuenta no creada por administración o correo mal escrito.', 'Verificar el correo; si es correcto, pedir el alta a un administrador.', 'Usuario / Admin', ['no figura en nuestra base de datos', 'auth/user-not-found']],
        ['SAR-AUT-003', 'warning', 'Demasiados intentos', 'Acceso bloqueado temporalmente por intentos repetidos.', 'Varios intentos fallidos seguidos.', 'Esperar unos minutos o restablecer la contraseña por correo.', 'Usuario', ['auth/too-many-requests', 'demasiados intentos']],
        ['SAR-AUT-004', 'warning', 'Falta el correo para recuperar', 'Ingrese su correo para recuperar la contraseña.', 'Se pidió recuperar la contraseña con el campo de correo vacío.', 'Escribir el correo institucional y reintentar.', 'Usuario', ['ingrese su correo para recuperar']],
        ['SAR-AUT-005', 'error', 'Acceso denegado (solo administración)', 'La acción está reservada a administradores.', 'El rol del usuario no tiene el permiso.', 'Pedir la acción a un administrador o solicitar cambio de rol.', 'Usuario / Admin', ['acceso denegado']],
        ['SAR-AUT-006', 'warning', 'Sección no permitida para su rol', 'Su rol no tiene acceso a esa sección.', 'Enlace o marcador a una vista restringida.', 'Volver al inicio; si la necesita, solicitar permiso a administración.', 'Usuario', ['su rol no tiene acceso']],
        ['SAR-DAT-001', 'error', 'Sin permisos en la base de datos', 'Las reglas de seguridad rechazaron la operación.', 'Rol sin permiso en Firestore, sesión vencida o regla no desplegada.', 'Cerrar sesión y volver a entrar; si persiste, revisar firestore.rules y desplegarlas.', 'Admin / TI', ['revisa reglas de seguridad', 'fallo de permisos', 'permission-denied']],
        ['SAR-DAT-002', 'error', 'Sin conexión con la base de datos', 'No fue posible leer o sincronizar datos.', 'Internet caído o intermitente; servicio no disponible.', 'Verificar la conexión y reintentar. Los cambios no guardados deben repetirse.', 'Usuario', ['fallo al conectar con la red', 'no se pudo sincronizar', 'verifique su conexión', 'no se pudieron recuperar los datos', 'no se pudieron cargar']],
        ['SAR-DAT-003', 'error', 'No se pudo guardar', 'La operación de guardado falló.', 'Pérdida de conexión, regla de seguridad o dato inválido.', 'Reintentar; si repite, anotar el código y avisar a soporte.', 'Usuario / TI', ['fallo al guardar', 'no se pudo guardar', 'fallo al sincronizar cambios', 'fallo al registrar']],
        ['SAR-DAT-004', 'error', 'No se pudo eliminar', 'La eliminación no se completó.', 'Falta de permiso de administrador o conexión.', 'Confirmar el rol; reintentar. Las eliminaciones son solo de administración.', 'Admin', ['no se pudo eliminar', 'fallo al eliminar', 'fallo durante el borrado']],
        ['SAR-DAT-005', 'error', 'Fallo de lectura de historial', 'No se pudo cargar el historial o registros adicionales.', 'Consulta sin índice o conexión inestable.', 'Reintentar; si es por fecha, revisar índices de Firestore.', 'TI', ['historial en tiempo real', 'más registros', 'buscar por fecha', 'detalle del log']],
        ['SAR-INV-001', 'error', 'Stock insuficiente en origen', 'La bodega de origen no tiene la cantidad pedida.', 'Cantidad solicitada mayor al saldo.', 'Reducir la cantidad o revisar el saldo antes de transferir.', 'Usuario', ['stock insuficiente']],
        ['SAR-INV-002', 'error', 'Consumo y merma superan el saldo', 'El consumo más la merma excede lo disponible.', 'Datos mal digitados o saldo desactualizado.', 'Corregir cantidades; si el saldo es incorrecto, hacer un ajuste justificado.', 'Usuario', ['superan el saldo disponible', 'supera el stock asignado']],
        ['SAR-INV-003', 'warning', 'Falta justificar la diferencia', 'Se requiere una observación por diferencia o merma.', 'Diferencia de cantidad sin motivo.', 'Escribir el motivo en el campo de observación.', 'Usuario', ['observación', 'justificar', 'motivo de la merma', 'ingresar el motivo']],
        ['SAR-INV-004', 'error', 'Bodega de destino igual al origen', 'Origen y destino deben ser distintos.', 'Selección repetida.', 'Elegir otra bodega de destino.', 'Usuario', ['bodega de destino debe ser distinta']],
        ['SAR-INV-005', 'warning', 'Cantidad no válida', 'La cantidad debe ser mayor a 0 (o 0 o más, según el caso).', 'Campo vacío, cero o negativo.', 'Ingresar un número válido.', 'Usuario', ['cantidad debe ser mayor', 'cantidad no válida', 'indica una cantidad', 'no puede ser 0', 'por debajo de 0']],
        ['SAR-INV-006', 'warning', 'No se puede recibir más de lo despachado', 'La cantidad recibida excede lo enviado.', 'Error de digitación o exceso físico.', 'Recibir solo lo despachado; devolver el exceso a bodega sin ingresarlo.', 'Usuario', ['más cantidad de la que fue despachada']],
        ['SAR-INV-007', 'error', 'Insumo no existe o no seleccionado', 'Debe seleccionar un insumo válido.', 'Texto libre sin elegir de la lista o insumo eliminado.', 'Elegir el insumo desde el buscador.', 'Usuario', ['insumo clínico válido', 'seleccionar un insumo', 'insumo de origen no existe', 'escribir o seleccionar un insumo']],
        ['SAR-INV-008', 'warning', 'Demasiadas ubicaciones', 'Máximo 600 ubicaciones por vez.', 'Generación masiva de estantes.', 'Generar en lotes menores.', 'Usuario', ['demasiadas ubicaciones']],
        ['SAR-COM-001', 'warning', 'Formato de ID de compra ágil', 'El ID debe verse como 1298355-1122-COT26.', 'ID escrito sin el formato de Mercado Público.', 'Copiar el ID completo desde el correo de la compra.', 'Usuario', ['1298355-1122-cot26']],
        ['SAR-COM-002', 'warning', 'Formato de N° de OC', 'El N° de OC debe verse como 1298355-1122-AG26.', 'N° de OC mal digitado.', 'Copiar el N° exacto desde la orden de compra.', 'Usuario', ['1298355-1122-ag26', 'escribe el n° de la orden']],
        ['SAR-COM-003', 'warning', 'Faltan datos obligatorios de compra', 'Proveedor, centro, motivo o fundamento sin completar.', 'Formulario incompleto.', 'Completar el campo indicado en el aviso.', 'Usuario', ['falta dato', 'falta el fundamento', 'falta el motivo', 'indica el proveedor', 'indica el centro']],
        ['SAR-COM-004', 'warning', 'Falta el cuadro de distribución', 'Se debe subir el Excel del cuadro por centro.', 'OC o compra sin cuadro cargado.', 'Subir el Excel del cuadro de distribución.', 'Usuario', ['falta el cuadro']],
        ['SAR-COM-005', 'warning', 'Recepción conforme incompleta', 'Falta el número de documento o el PDF de la guía/factura.', 'Recepción sin documento adjunto.', 'Ingresar el N° y adjuntar el PDF (máx. 8 MB).', 'Usuario', ['escribe el número del documento', 'adjunta los archivos']],
        ['SAR-COM-006', 'warning', 'Envío de correo no configurado', 'Se descargaron los documentos; adjúntelos al borrador.', 'Apps Script sin actualizar o sin configurar.', 'Pegar y re-desplegar el script en "Configurar correo".', 'Admin', ['envío automático no está configurado']],
        ['SAR-DOC-001', 'error', 'No se pudo leer el archivo', 'Error de lectura del archivo.', 'Archivo dañado, protegido o formato no soportado.', 'Abrirlo y guardarlo de nuevo; probar con otro archivo.', 'Usuario', ['error de lectura del archivo', 'procesar el archivo excel']],
        ['SAR-DOC-002', 'error', 'Archivo fuera del esquema SAR', 'El archivo no cumple el esquema.', 'Columnas o estructura distintas a la plantilla.', 'Usar la plantilla oficial de carga.', 'Usuario', ['esquema sar']],
        ['SAR-DOC-003', 'warning', 'No hay datos para exportar', 'La lista está vacía.', 'Filtros sin resultados.', 'Ajustar filtros y reintentar.', 'Usuario', ['no hay datos para exportar']],
        ['SAR-DOC-004', 'error', 'Librería no cargada', 'Excel o escáner aún no disponibles.', 'Sin internet al cargar la página o bloqueo del CDN.', 'Recargar con Ctrl+F5 y reintentar.', 'Usuario', ['librería de excel', 'librería del escáner']],
        ['SAR-DOC-005', 'error', 'Cámara no disponible', 'No se pudo acceder a la cámara.', 'Permiso de cámara denegado.', 'Habilitar el permiso de cámara del navegador.', 'Usuario', ['acceder a la cámara']],
        ['SAR-CLI-001', 'error', 'Producto en cuarentena', 'No puede moverse ni dispensarse.', 'Lote bloqueado por calidad.', 'Contactar a calidad/administración; no usar el producto.', 'Admin', ['cuarentena']],
        ['SAR-CLI-002', 'warning', 'Confirmar medicamentos controlados', 'Debe confirmar lo de los medicamentos controlados.', 'Falta la confirmación con folio DAU en registro separado.', 'Marcar la confirmación; el folio va en el registro aparte (sin datos de pacientes).', 'Usuario', ['medicamentos controlados']],
        ['SAR-CLI-003', 'warning', 'Falta observación por faltante', 'Debe justificar el medicamento faltante o la diferencia.', 'Diferencia detectada al recibir.', 'Describir la diferencia en la observación.', 'Usuario', ['medicamento faltante', 'diferencia detectada']],
        ['SAR-SIS-001', 'error', 'Anomalía del sistema', 'Se detectó un error inesperado.', 'Error de código no controlado.', 'Recargar; si persiste, enviar el código y la hora a soporte.', 'Soporte', ['anomalía', 'error crítico', 'error de sistema']],
        ['SAR-SIS-002', 'error', 'Error del análisis de inventario (IA)', 'No se pudo completar el análisis.', 'Servicio de análisis no disponible.', 'Reintentar más tarde.', 'Soporte', ['error ia', 'análisis de inventario']],
        ['SAR-SIS-003', 'warning', 'Cierre incompleto', 'Un cierre quedó con pasos pendientes.', 'Fallo parcial al cerrar una bodega.', 'Revisar el detalle y repetir el cierre.', 'Usuario', ['cierre incompleto']]
    ].map(a => ({ codigo: a[0], cat: a[0].split('-')[1], nivel: a[1], titulo: a[2], mensaje: a[3], causa: a[4], solucion: a[5], quien: a[6], coincide: a[7] }));

    const porCodigo = {}; C.forEach(e => { porCodigo[e.codigo] = e; });

    function buscar(texto) {
        const t = String(texto || '').toLowerCase();
        return C.find(e => e.coincide.some(k => t.includes(k))) || null;
    }
    function traducir(err) {   // error de Firebase/JS -> entrada del catálogo
        const t = (err && (err.code || err.message)) ? `${err.code || ''} ${err.message || ''}` : String(err || '');
        return buscar(t);
    }

    // --- registro local (sin datos personales) ---
    function leer() { try { return JSON.parse(localStorage.getItem(LLAVE) || '[]'); } catch (e) { return []; } }
    function guardar(a) { try { localStorage.setItem(LLAVE, JSON.stringify(a.slice(-100))); } catch (e) { /* noop */ } }
    function anotar(codigo) {
        const a = leer(); const ahora = Date.now(); const ult = a[a.length - 1];
        if (ult && ult.c === codigo && ahora - ult.t < 3000) { ult.n = (ult.n || 1) + 1; } else { a.push({ c: codigo, t: ahora, n: 1, v: (location.hash || '').replace('#', '') }); }
        guardar(a);
    }

    // --- aviso: agrega la referencia del catálogo a los toast de error/advertencia ---
    function instalar() {
        const original = window.showToast;
        if (typeof original !== 'function' || original.__sarErr) return;
        const envuelto = function (titulo, texto, tipo) {
            if (tipo === 'error' || tipo === 'warning') {
                const e = buscar(`${titulo} ${texto}`);
                if (e) { anotar(e.codigo); return original(titulo, `${texto} · Ref. ${e.codigo}`, tipo); }
            }
            return original(titulo, texto, tipo);
        };
        envuelto.__sarErr = true; window.showToast = envuelto;
    }
    window.addEventListener('unhandledrejection', (ev) => { const e = traducir(ev.reason) || porCodigo['SAR-SIS-001']; anotar(e.codigo); });
    window.addEventListener('error', () => { anotar('SAR-SIS-001'); });

    // --- vista ---
    let filtroCat = '', q = '', abierto = '', pestana = 'err';
    function root() { return document.getElementById('err-root'); }
    function pestanas() {
        return `<div class="aud-tabs" role="tablist"><button type="button" role="tab" class="aud-tab${pestana === 'err' ? ' on' : ''}" data-pest="err" aria-selected="${pestana === 'err'}"><i class="ph ph-bug"></i> Errores y alertas</button><button type="button" role="tab" class="aud-tab${pestana === 'nom' ? ' on' : ''}" data-pest="nom" aria-selected="${pestana === 'nom'}"><i class="ph ph-hash"></i> Nomenclaturas y correlativos</button></div>`;
    }
    function ligarPestanas(r) { r.querySelectorAll('[data-pest]').forEach(b => b.addEventListener('click', () => { pestana = b.dataset.pest; pintar(); })); }
    function pintar() {
        const r = root(); if (!r) return;
        if (pestana === 'nom' && window.SAR_Nomenclaturas) {
            r.innerHTML = `<div class="err-cab"><div><h2>Directorio</h2><p>Errores del sistema y nomenclaturas de todos los códigos.</p></div></div>${pestanas()}<div id="nom-root"></div>`;
            ligarPestanas(r); window.SAR_Nomenclaturas.montar(r.querySelector('#nom-root')); return;
        }
        const log = leer(); const cuenta = {}; log.forEach(x => { cuenta[x.c] = (cuenta[x.c] || 0) + (x.n || 1); });
        const lista = C.filter(e => (!filtroCat || e.cat === filtroCat) && (!q || `${e.codigo} ${e.titulo} ${e.mensaje} ${e.causa} ${e.solucion}`.toLowerCase().includes(q)));
        r.innerHTML = `
        <div class="err-cab"><div><h2>Directorio</h2><p>Errores del sistema y nomenclaturas de todos los códigos.</p></div></div>${pestanas()}
        <p class="act-hint">${C.length} códigos de error · cada aviso del sistema muestra su <b>Ref.</b> para ubicarlo aquí.</p>
        <div class="err-barra">
          <input id="err-q" class="form-control" type="search" placeholder="Buscar por código, texto, causa o solución…" value="${esc(q)}">
          <div class="err-chips">
            <button type="button" class="err-chip ${filtroCat ? '' : 'on'}" data-cat="">Todos</button>
            ${Object.keys(CATEGORIAS).map(k => `<button type="button" class="err-chip ${filtroCat === k ? 'on' : ''}" data-cat="${k}">${esc(CATEGORIAS[k])}</button>`).join('')}
          </div>
        </div>
        <div class="err-lista">${lista.map(e => `
          <article class="err-item ${abierto === e.codigo ? 'abierto' : ''}">
            <button type="button" class="err-fila" data-cod="${e.codigo}" aria-expanded="${abierto === e.codigo}">
              <span class="err-cod">${e.codigo}</span><span class="err-niv err-niv--${e.nivel}">${e.nivel === 'error' ? 'Error' : 'Alerta'}</span>
              <span class="err-tit">${esc(e.titulo)}</span><span class="err-cnt">${cuenta[e.codigo] ? cuenta[e.codigo] + '×' : ''}</span>
            </button>
            <div class="err-det">
              <p><b>Qué ve el usuario:</b> ${esc(e.mensaje)}</p>
              <p><b>Causa probable:</b> ${esc(e.causa)}</p>
              <p><b>Cómo resolverlo:</b> ${esc(e.solucion)}</p>
              <p><b>Quién actúa:</b> ${esc(e.quien)} · <b>Área:</b> ${esc(CATEGORIAS[e.cat])}</p>
            </div>
          </article>`).join('') || '<p class="err-vacio">Sin resultados.</p>'}</div>
        <section class="err-recientes"><h3>Apariciones recientes en este equipo</h3>
          ${log.length ? `<ul>${log.slice(-15).reverse().map(x => `<li><b>${esc(x.c)}</b> · ${esc((porCodigo[x.c] || {}).titulo || '')} <span>${new Date(x.t).toLocaleString('es-CL')}${x.n > 1 ? ' · ' + x.n + '×' : ''}${x.v ? ' · ' + esc(x.v) : ''}</span></li>`).join('')}</ul><button type="button" class="btn btn-secondary" id="err-limpiar">Borrar registro local</button>` : '<p class="err-vacio">Aún no hay apariciones registradas.</p>'}
        </section>`;
        ligarPestanas(r);
        const inp = r.querySelector('#err-q'); inp.addEventListener('input', () => { q = inp.value.trim().toLowerCase(); const p = inp.selectionStart; pintar(); const n = root().querySelector('#err-q'); n.focus(); n.setSelectionRange(p, p); });
        r.querySelectorAll('.err-chip').forEach(b => b.addEventListener('click', () => { filtroCat = b.dataset.cat; pintar(); }));
        r.querySelectorAll('.err-fila').forEach(b => b.addEventListener('click', () => { abierto = abierto === b.dataset.cod ? '' : b.dataset.cod; pintar(); }));
        const l = r.querySelector('#err-limpiar'); if (l) l.addEventListener('click', () => { guardar([]); pintar(); });
    }
    function abrir() { pintar(); }

    instalar(); document.addEventListener('DOMContentLoaded', instalar); setTimeout(instalar, 500);
    window.SAR_Errores = { catalogo: C, categorias: CATEGORIAS, buscar, traducir, abrir, _log: leer };
})(window, document);
