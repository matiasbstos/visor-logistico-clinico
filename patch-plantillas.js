import { db, auth } from './script.js';
import { collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

// Global state
let plantillasActuales = [];
let unsubscribePlantillas = null;

const selectPlantilla = document.getElementById('select-tipo-plantilla');

const vistaLista = document.getElementById('vista-lista-plantillas');
const vistaEditar = document.getElementById('vista-editar-plantilla');
const tbodyLista = document.getElementById('tbody-lista-plantillas');

const btnNuevaPlantilla = document.getElementById('btn-nueva-plantilla');
const btnCancelarEdicion = document.getElementById('btn-cancelar-edicion-plantilla');
const btnGuardarPlantilla = document.getElementById('btn-guardar-plantilla');

const inputId = document.getElementById('plantilla-id-actual');
const inputNombre = document.getElementById('plantilla-nombre-input');
const inputBuscarInsumo = document.getElementById('plantilla-buscar-insumo');
const datalistInsumos = document.getElementById('plantillas-insumos-list');
const inputCantidadInsumo = document.getElementById('plantilla-cantidad-insumo');
const btnAddInsumo = document.getElementById('btn-add-insumo-plantilla');
const tbodyDetalleEdit = document.getElementById('tbody-detalle-plantilla-edit');

let insumosEditando = [];
let insumosBase = [];

// Initialize
export function initPlantillasModule() {
    if (!selectPlantilla) return;

    // Listeners
    btnNuevaPlantilla.addEventListener('click', () => abrirEditorPlantilla());
    btnCancelarEdicion.addEventListener('click', volverALista);
    btnGuardarPlantilla.addEventListener('click', guardarPlantilla);
    btnAddInsumo.addEventListener('click', agregarInsumoEditando);

    const btnDescargarExcel = document.getElementById('btn-descargar-base-pack');
    const inputExcel = document.getElementById('input-excel-pack');
    if (btnDescargarExcel) btnDescargarExcel.addEventListener('click', descargarBaseExcelPlantilla);
    if (inputExcel) inputExcel.addEventListener('change', procesarExcelPlantilla);

    // Cargar insumos para el datalist
    cargarInsumosBase();

    // Escuchar colección
    escucharPlantillas();
    
    // Interceptar el select
    selectPlantilla.addEventListener('change', (e) => {
        cargarDetallePlantillaSeleccionada(e.target.value);
    });
}

async function cargarInsumosBase() {
    try {
        const q = query(collection(db, 'Insumos'), orderBy('name'));
        const snap = await getDocs(q);
        insumosBase = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        datalistInsumos.innerHTML = '';
        insumosBase.forEach(ins => {
            const opt = document.createElement('option');
            opt.value = ins.name;
            datalistInsumos.appendChild(opt);
        });
    } catch (e) {
        console.error("Error cargando insumos base", e);
    }
}

function escucharPlantillas() {
    if (unsubscribePlantillas) unsubscribePlantillas();
    const q = query(collection(db, 'Plantillas_Bandejas'), orderBy('fechaCreacion', 'desc'));
    
    unsubscribePlantillas = onSnapshot(q, (snapshot) => {
        plantillasActuales = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderizarSelectPlantillas();
        renderizarListaPlantillas();
    }, (error) => {
        console.error("Error escuchando plantillas", error);
    });
}

function renderizarSelectPlantillas() {
    // Preserve current selection if possible
    const currentVal = selectPlantilla.value;
    
    selectPlantilla.innerHTML = '<option value="">Seleccione Plantilla...</option>';
    plantillasActuales.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.nombre;
        selectPlantilla.appendChild(opt);
    });
    
    // Retrocompatibilidad o hardcoded
    const optEst = document.createElement('option');
    optEst.value = 'estandar';
    optEst.textContent = 'Kit Estándar Urgencias (56 Ítems)';
    selectPlantilla.appendChild(optEst);

    if (currentVal) {
        selectPlantilla.value = currentVal;
    }
}

function renderizarListaPlantillas() {
    if (plantillasActuales.length === 0) {
        tbodyLista.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No hay plantillas creadas.</td></tr>';
        return;
    }
    
    tbodyLista.innerHTML = '';
    plantillasActuales.forEach(p => {
        const tr = document.createElement('tr');
        const fecha = p.ultimaModificacion ? p.ultimaModificacion.toDate().toLocaleString() : 
                     (p.fechaCreacion ? p.fechaCreacion.toDate().toLocaleString() : 'N/A');
        
        tr.innerHTML = `
            <td class="fw-bold">${p.nombre}</td>
            <td>${p.medicamentos ? p.medicamentos.length : 0} ítems</td>
            <td><small class="text-muted">${fecha}</small></td>
            <td>
                <button class="btn btn-sm btn-outline-primary btn-editar-p" data-id="${p.id}" title="Editar"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn btn-sm btn-outline-danger btn-eliminar-p" data-id="${p.id}" title="Eliminar"><i class="ph ph-trash"></i></button>
            </td>
        `;
        tbodyLista.appendChild(tr);
    });
    
    document.querySelectorAll('.btn-editar-p').forEach(b => {
        b.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const plantilla = plantillasActuales.find(x => x.id === id);
            if (plantilla) abrirEditorPlantilla(plantilla);
        });
    });
    
    document.querySelectorAll('.btn-eliminar-p').forEach(b => {
        b.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const plantilla = plantillasActuales.find(x => x.id === id);
            if (!plantilla) return;
            if (confirm(`¿Estás seguro de eliminar el pack "${plantilla.nombre}"?`)) {
                try {
                    await deleteDoc(doc(db, 'Plantillas_Bandejas', id));
                    
                    const currentUser = auth ? auth.currentUser : null;
                    const email = currentUser ? currentUser.email : 'Desconocido';
                    
                    await addDoc(collection(db, 'Historial_Movimientos'), {
                        action: 'ELIMINACION_PACK',
                        module: 'Plantillas_Bandejas',
                        itemName: plantilla.nombre,
                        date: new Date().toISOString(),
                        user: email,
                        details: `Pack ${plantilla.nombre} eliminado. Contenía ${plantilla.medicamentos ? plantilla.medicamentos.length : 0} ítems.`
                    });

                    if (window.showToast) window.showToast('Eliminada', 'Plantilla eliminada correctamente', 'success');
                } catch (err) {
                    console.error(err);
                    if (window.showToast) window.showToast('Error', 'No se pudo eliminar', 'error');
                }
            }
        });
    });
}


function volverALista() {
    vistaEditar.style.display = 'none';
    vistaLista.style.display = 'block';
    insumosEditando = [];
}

function abrirEditorPlantilla(plantilla = null) {
    vistaLista.style.display = 'none';
    vistaEditar.style.display = 'block';
    
    if (plantilla) {
        inputId.value = plantilla.id;
        inputNombre.value = plantilla.nombre;
        insumosEditando = JSON.parse(JSON.stringify(plantilla.medicamentos || []));
    } else {
        inputId.value = '';
        inputNombre.value = '';
        insumosEditando = [];
    }
    inputBuscarInsumo.value = '';
    inputCantidadInsumo.value = '1';
    
    renderizarInsumosEditando();
}

function renderizarInsumosEditando() {
    tbodyDetalleEdit.innerHTML = '';
    if (insumosEditando.length === 0) {
        tbodyDetalleEdit.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Añade fármacos usando el buscador de arriba.</td></tr>';
        return;
    }
    
    insumosEditando.forEach((med, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="fw-bold">${med.nombre}</td>
            <td>
                <input type="number" class="form-control form-control-sm cantidad-edit" data-idx="${index}" value="${med.cantidad}" min="1" style="width: 70px;">
            </td>
            <td class="text-center">
                <button class="btn btn-sm btn-danger btn-quitar-ins" data-idx="${index}"><i class="ph ph-trash"></i></button>
            </td>
        `;
        tbodyDetalleEdit.appendChild(tr);
    });
    
    document.querySelectorAll('.cantidad-edit').forEach(inp => {
        inp.addEventListener('change', (e) => {
            const idx = e.target.getAttribute('data-idx');
            insumosEditando[idx].cantidad = Number(e.target.value);
        });
    });
    
    document.querySelectorAll('.btn-quitar-ins').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = e.currentTarget.getAttribute('data-idx');
            insumosEditando.splice(idx, 1);
            renderizarInsumosEditando();
        });
    });
}

function agregarInsumoEditando() {
    const val = inputBuscarInsumo.value.trim();
    const cant = Number(inputCantidadInsumo.value);
    
    if (!val) {
        if (window.showToast) window.showToast('Atención', 'Escribe el nombre de un fármaco', 'warning');
        return;
    }
    if (cant <= 0) return;
    
    // Verificar si ya existe en la lista
    const existe = insumosEditando.find(x => x.nombre.toLowerCase() === val.toLowerCase());
    if (existe) {
        existe.cantidad += cant;
    } else {
        insumosEditando.push({
            nombre: val,
            cantidad: cant,
            observacion: ''
        });
    }
    
    inputBuscarInsumo.value = '';
    inputCantidadInsumo.value = '1';
    renderizarInsumosEditando();
}

async function guardarPlantilla() {
    const nombre = inputNombre.value.trim();
    const id = inputId.value;
    
    if (!nombre) {
        if (window.showToast) window.showToast('Atención', 'Debes ingresar un nombre para el pack', 'warning');
        return;
    }
    
    if (insumosEditando.length === 0) {
        if (window.showToast) window.showToast('Atención', 'La plantilla debe tener al menos un insumo', 'warning');
        return;
    }
    
    const data = {
        nombre: nombre,
        medicamentos: insumosEditando,
        ultimaModificacion: serverTimestamp()
    };
    
    try {
        btnGuardarPlantilla.disabled = true;
        btnGuardarPlantilla.innerHTML = '<i class="ph-spinner ph-spin"></i> Guardando...';
        
        const currentUser = auth ? auth.currentUser : null;
        const email = currentUser ? currentUser.email : 'Desconocido';

        if (id) {
            // Actualizar
            await updateDoc(doc(db, 'Plantillas_Bandejas', id), data);
            await addDoc(collection(db, 'Historial_Movimientos'), {
                action: 'EDICION_PACK',
                module: 'Plantillas_Bandejas',
                itemName: nombre,
                date: new Date().toISOString(),
                user: email,
                details: `Pack ${nombre} actualizado. Contiene ${insumosEditando.length} ítems.`
            });
            if (window.showToast) window.showToast('Éxito', 'Plantilla actualizada y auditada', 'success');
        } else {
            // Crear
            data.fechaCreacion = serverTimestamp();
            await addDoc(collection(db, 'Plantillas_Bandejas'), data);
            await addDoc(collection(db, 'Historial_Movimientos'), {
                action: 'CREACION_PACK',
                module: 'Plantillas_Bandejas',
                itemName: nombre,
                date: new Date().toISOString(),
                user: email,
                details: `Pack ${nombre} creado con ${insumosEditando.length} ítems.`
            });
            if (window.showToast) window.showToast('Éxito', 'Plantilla creada y auditada', 'success');
        }
        
        volverALista();
    } catch (err) {
        console.error(err);
        if (window.showToast) window.showToast('Error', 'Fallo al guardar la plantilla', 'error');
    } finally {
        btnGuardarPlantilla.disabled = false;
        btnGuardarPlantilla.innerHTML = '<i class="ph ph-floppy-disk"></i> Guardar Plantilla';
    }
}

// Interceptamos la generación de la tabla en el panel de creación de bandejas
function cargarDetallePlantillaSeleccionada(plantillaId) {
    const contenedorTabla = document.getElementById('contenedor-detalle-bandeja');
    const tbodyBandeja = document.getElementById('tabla-detalle-bandeja-body');
    
    if (!contenedorTabla || !tbodyBandeja) return;

    if (!plantillaId) {
        contenedorTabla.style.display = 'none';
        tbodyBandeja.innerHTML = '';
        return;
    }

    // El caso "estandar" ya es manejado por script.js, pero para evitar conflictos
    // podemos re-manejarlo o dejar que script.js lo haga.
    // Script.js escucha en document.addEventListener('change').
    // Dado que script.js ya dibuja el "estandar", solo dibujaremos los nuestros si no es "estandar".
    if (plantillaId === 'estandar') return;

    const plantilla = plantillasActuales.find(x => x.id === plantillaId);
    if (!plantilla) return;

    contenedorTabla.style.display = 'block';
    let filasHTML = '';
    
    plantilla.medicamentos.forEach(med => {
        filasHTML += `
        <tr>
            <td><span class="insumo-nombre fw-bold" style="font-weight: bold;">${med.nombre}</span></td>
            <td><input type="number" class="form-control insumo-cantidad" value="${med.cantidad}" min="1" style="max-width:80px"></td>
            <td><input type="text" class="form-control insumo-obs" value="${med.observacion || ''}" placeholder="Ej: Faltante, Vence pronto..."></td>
            <td class="text-center"><button type="button" class="btn btn-sm btn-danger btn-eliminar-fila"><i class="ph ph-trash"></i></button></td>
        </tr>`;
    });
    
    tbodyBandeja.innerHTML = filasHTML;
}

// Auto-init reactivo para evitar condiciones de carrera (race conditions)
let unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    if (user) {
        initPlantillasModule();
    } else {
        if (unsubscribePlantillas) {
            unsubscribePlantillas();
            unsubscribePlantillas = null;
        }
    }
});

// Excel Export/Import logic
function descargarBaseExcelPlantilla() {
    if (typeof XLSX === 'undefined') {
        if (window.showToast) window.showToast('Error', 'La librería de Excel no está cargada aún.', 'error');
        return;
    }

    let data = [];
    if (insumosEditando.length > 0) {
        data = insumosEditando.map(ins => ({
            "Fármaco": ins.nombre,
            "Cantidad": ins.cantidad
        }));
    } else {
        // Formato base vacío
        data = [
            { "Fármaco": "Paracetamol 500mg", "Cantidad": 10 },
            { "Fármaco": "Ibuprofeno 400mg", "Cantidad": 5 }
        ];
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pack");
    XLSX.writeFile(wb, "Formato_Base_Pack.xlsx");
}

function procesarExcelPlantilla(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        if (window.showToast) window.showToast('Error', 'La librería de Excel no está cargada aún.', 'error');
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
        const data = evt.target.result;
        try {
            const workbook = XLSX.read(data, { type: 'binary' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            if (json.length < 2) throw new Error("El archivo está vacío o no tiene encabezados.");

            let colFarmaco = -1;
            let colCantidad = -1;
            
            // Buscar cabeceras
            const headers = json[0];
            for (let i = 0; i < headers.length; i++) {
                const h = String(headers[i] || '').trim().toLowerCase();
                if (h.includes('fármaco') || h.includes('farmaco') || h.includes('insumo') || h.includes('medicamento')) {
                    colFarmaco = i;
                }
                if (h.includes('cantidad') || h.includes('cant')) {
                    colCantidad = i;
                }
            }

            if (colFarmaco === -1 || colCantidad === -1) {
                // Asumir que la columna 0 es fármaco y la 1 es cantidad si no las encuentra
                colFarmaco = 0;
                colCantidad = 1;
            }

            let agregados = 0;
            let noEncontrados = 0;
            
            // Vaciar la lista actual para reemplazarla con el Excel, como solicitó el usuario
            insumosEditando = [];

            for (let i = 1; i < json.length; i++) {
                const row = json[i];
                if (!row || row.length === 0) continue;
                
                const farmacoStr = String(row[colFarmaco] || '').trim();
                const cantStr = String(row[colCantidad] || '1').trim();
                const cantidad = parseInt(cantStr, 10) || 1;

                if (farmacoStr) {
                    // Normalizar nombres para hacer la búsqueda más flexible (quita espacios y signos de puntuación)
                    const normalizeName = (name) => name.toLowerCase().replace(/[^a-z0-9]/gi, '');
                    const farmacoNormalized = normalizeName(farmacoStr);

                    // Buscar coincidencia exacta o normalizada con la base de datos
                    const baseMatch = insumosBase.find(x => 
                        x.name.toLowerCase() === farmacoStr.toLowerCase() || 
                        normalizeName(x.name) === farmacoNormalized
                    );
                    const nombreFinal = baseMatch ? baseMatch.name : farmacoStr;
                    
                    if (!baseMatch) {
                        noEncontrados++;
                    }

                    const existente = insumosEditando.find(x => x.nombre.toLowerCase() === nombreFinal.toLowerCase());
                    if (existente) {
                        existente.cantidad += cantidad;
                    } else {
                        insumosEditando.push({
                            nombre: nombreFinal,
                            cantidad: cantidad,
                            observacion: ''
                        });
                    }
                    agregados++;
                }
            }

            renderizarInsumosEditando();
            let msj = `Se importaron ${agregados} ítems al pack.`;
            if (noEncontrados > 0) {
                msj += ` Hay ${noEncontrados} ítem(s) que no coinciden exactamente con la bodega, podrían causar error al despachar.`;
                if (window.showToast) window.showToast('Atención', msj, 'warning');
            } else {
                if (window.showToast) window.showToast('Excel Procesado', msj, 'success');
            }

        } catch (error) {
            console.error("Error leyendo Excel de Pack:", error);
            if (window.showToast) window.showToast('Error', 'Fallo al procesar el archivo Excel.', 'error');
        }
        e.target.value = ''; // Reset
    };
    
    reader.onerror = function() {
        if (window.showToast) window.showToast('Error', 'Error de lectura del archivo.', 'error');
        e.target.value = '';
    };

    reader.readAsBinaryString(file);
}
