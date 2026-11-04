/* ==========================================================================
   ANONIMIZAR DATOS DE PACIENTES ANTIGUOS (v20.41)
   --------------------------------------------------------------------------
   Decisión (docs/DECISIONES.md §2): el sistema no guarda RUT, nombre ni cama de pacientes.
   Esta herramienta limpia lo que quedó de versiones anteriores:
     - Historial_Movimientos: rutPaciente, nombrePaciente, camaPaciente y el documento "RECETA-<rut>".
     - Bandejas_Turno: rutPaciente por medicamento y el texto "(RUT: …)" de las observaciones.
   Pasos: 1) "Revisar" (no cambia nada), 2) descargar el respaldo (archivo en tu computador:
   guárdalo en un lugar seguro o destrúyelo cuando ya no lo necesites), 3) "Anonimizar".
   Solo superadministrador (las reglas de la base de datos permiten únicamente estos campos).
   ========================================================================== */
(function (window, document) {
    'use strict';
    const fs = () => window.firebaseFirestore;
    const db = () => window.firebaseDb;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const rol = () => String(document.body.dataset.userRole || '').toLowerCase();
    const toast = (t, m, tipo) => { if (typeof window.showToast === 'function') window.showToast(t, m, tipo || 'info'); };
    const RE_RUT_OBS = /\s*\(RUT:\s*[^)]*\)/g;
    const CAMPOS = ['rutPaciente', 'nombrePaciente', 'camaPaciente'];

    // ---------- Lógica pura ----------
    function limpiarHistorial(d) {
        const cambios = {};
        CAMPOS.forEach(c => { if (String(d[c] || '').trim()) cambios[c] = ''; });
        if (/^RECETA-/i.test(String(d.document || ''))) cambios.document = 'SALIDA-CONSUMO';
        return cambios;
    }
    function limpiarBandeja(d) {
        const meds = Array.isArray(d.medicamentos) ? d.medicamentos : [];
        let tocado = false;
        const nuevos = meds.map(m => {
            const n = { ...m };
            if (String(n.rutPaciente || '').trim()) { n.rutPaciente = ''; tocado = true; }
            ['observacionAdicional', 'observacion', 'observacionOperador'].forEach(k => {
                if (typeof n[k] === 'string' && RE_RUT_OBS.test(n[k])) { n[k] = n[k].replace(RE_RUT_OBS, ''); tocado = true; }
                RE_RUT_OBS.lastIndex = 0;
            });
            return n;
        });
        return tocado ? { medicamentos: nuevos } : null;
    }

    // ---------- Búsqueda ----------
    async function revisar() {
        const f = fs(), hist = new Map(), ban = [];
        for (const c of CAMPOS) {
            const snap = await f.getDocs(f.query(f.collection(db(), 'Historial_Movimientos'), f.where(c, '>', ''), f.limit(5000)));
            snap.forEach(d => hist.set(d.id, d.data()));
        }
        const snapR = await f.getDocs(f.query(f.collection(db(), 'Historial_Movimientos'), f.where('document', '>=', 'RECETA-'), f.where('document', '<', 'RECETA-'), f.limit(5000)));
        snapR.forEach(d => hist.set(d.id, d.data()));
        const histCambios = [];
        hist.forEach((d, id) => { const c = limpiarHistorial(d); if (Object.keys(c).length) histCambios.push({ id, antes: Object.fromEntries([...CAMPOS, 'document'].filter(k => d[k]).map(k => [k, d[k]])), cambios: c }); });
        const snapB = await f.getDocs(f.collection(db(), 'Bandejas_Turno'));
        snapB.forEach(d => { const c = limpiarBandeja(d.data()); if (c) ban.push({ id: d.id, antes: { medicamentos: d.data().medicamentos }, cambios: c }); });
        return { historial: histCambios, bandejas: ban };
    }
    async function aplicar(plan, onProgreso) {
        const f = fs(); let hechos = 0, fallos = 0; const total = plan.historial.length + plan.bandejas.length;
        const tick = () => { hechos++; if (onProgreso) onProgreso(hechos, total); };
        for (const h of plan.historial) { try { await f.updateDoc(f.doc(f.collection(db(), 'Historial_Movimientos'), h.id), h.cambios); } catch (e) { fallos++; } tick(); }
        for (const b of plan.bandejas) { try { await f.updateDoc(f.doc(f.collection(db(), 'Bandejas_Turno'), b.id), b.cambios); } catch (e) { fallos++; } tick(); }
        return { hechos, fallos };
    }
    function bajarRespaldo(plan) {
        const blob = new Blob([JSON.stringify({ generado: new Date().toISOString(), aviso: 'Contiene datos de pacientes. Guárdalo en un lugar seguro o elimínalo.', historial: plan.historial.map(h => ({ id: h.id, antes: h.antes })), bandejas: plan.bandejas.map(b => ({ id: b.id, antes: b.antes })) }, null, 1)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `respaldo_antes_de_anonimizar_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 1500);
    }

    // ---------- Interfaz ----------
    function abrir() {
        if (!['superadmin', 'global'].includes(rol())) { toast('Sin permiso', 'Solo el superadministrador puede anonimizar datos antiguos.', 'warning'); return; }
        let plan = null, respaldado = false;
        const ov = document.createElement('div'); ov.className = 'cierre-overlay';
        ov.innerHTML = `<div class="cierre-box" role="dialog" aria-modal="true"><h3>Anonimizar datos de pacientes</h3>
            <p class="cierre-hint">Quita RUT, nombre y cama de pacientes del historial y de las bandejas antiguas. No borra movimientos ni stock.</p>
            <div id="an-res" class="cierre-hint">Pulsa "Revisar" para ver cuánto hay (no cambia nada).</div>
            <div class="cierre-acciones"><button type="button" class="btn btn-outline" id="an-x">Cerrar</button><button type="button" class="btn btn-outline" id="an-rev">Revisar</button>
            <button type="button" class="btn btn-outline" id="an-resp" disabled>Descargar respaldo</button><button type="button" class="btn btn-primary" id="an-ok" disabled>Anonimizar</button></div></div>`;
        document.body.appendChild(ov);
        const q = (s) => ov.querySelector(s);
        q('#an-x').addEventListener('click', () => ov.remove());
        q('#an-rev').addEventListener('click', async () => {
            q('#an-res').textContent = 'Revisando…'; respaldado = false;
            try {
                plan = await revisar();
                q('#an-res').innerHTML = `Movimientos del historial a limpiar: <strong>${plan.historial.length}</strong> · Bandejas a limpiar: <strong>${plan.bandejas.length}</strong>.${plan.historial.length + plan.bandejas.length ? ' Descarga el respaldo y luego anonimiza.' : ' No hay nada que limpiar en estas colecciones.'}`;
                q('#an-resp').disabled = !(plan.historial.length + plan.bandejas.length); q('#an-ok').disabled = true;
            } catch (e) { q('#an-res').innerHTML = `<span class="cierre-error">${esc(e.message)}</span>`; }
        });
        q('#an-resp').addEventListener('click', () => { bajarRespaldo(plan); respaldado = true; q('#an-ok').disabled = false; toast('Respaldo', 'Guarda el archivo en un lugar seguro.', 'info'); });
        q('#an-ok').addEventListener('click', async () => {
            if (!plan || !respaldado) return;
            if (!confirm(`Se anonimizarán ${plan.historial.length} movimientos y ${plan.bandejas.length} bandejas. Esto no se puede deshacer salvo con el archivo de respaldo. ¿Continuar?`)) return;
            q('#an-ok').disabled = true; q('#an-rev').disabled = true;
            const r = await aplicar(plan, (h, t) => { q('#an-res').textContent = `Procesando ${h} de ${t}…`; });
            q('#an-res').innerHTML = `<strong>Listo.</strong> ${r.hechos - r.fallos} limpiados${r.fallos ? `, <span class="cierre-error">${r.fallos} con error (revisa permisos y repite "Revisar")</span>` : ''}.`;
            toast('Anonimización', r.fallos ? 'Terminó con errores.' : 'Datos de pacientes antiguos eliminados.', r.fallos ? 'warning' : 'success');
        });
    }

    window.SAR_Anonimizar = { abrir, limpiarHistorial, limpiarBandeja, revisar, aplicar };
    if (typeof module !== 'undefined') module.exports = window.SAR_Anonimizar;
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { body: { dataset: {} } });
