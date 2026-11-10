/* ==========================================================================
   MONITOREO DE ERRORES DEL SISTEMA (v21.57)
   Antes, un error de JavaScript solo quedaba anotado en el equipo de quien lo vio. Ahora, si es personal
   (admin/operador) quien lo sufre, queda en Contadores/err-<día>-<huella> (cuántas veces, quién, en qué
   pantalla y versión) y, la primera vez del día, sale un correo de aviso a los tres destinatarios.
   - Sin datos de pacientes: los RUT del texto se enmascaran y el mensaje se corta a 300 caracteres.
   - Anti-ruido: se ignoran errores de extensiones, de red intermitente y de ResizeObserver; máx. 3
     correos por día y por equipo.
   - Se ve en «Directorio de errores» (administración), sección «Errores registrados en el sistema».
   ========================================================================== */
(function (window, document) {
    'use strict';
    const IGNORAR = /ResizeObserver|^Script error\.?$|Non-Error promise rejection|Failed to fetch|NetworkError|Load failed|AbortError|ChunkLoadError|network-request-failed|unavailable/i;
    const MAX_CORREOS = 1, DESTINO_ERRORES = ['matias.bustos@cormumel.cl'], vistos = new Set();
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** Puro: enmascara RUT y recorta. */
    const limpiar = (t) => String(t == null ? '' : t).replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/g, '[RUT]').replace(/\s+/g, ' ').trim().slice(0, 300);
    /** Puro: huella estable de un error (mensaje sin números + lugar). */
    function huella(msg, archivo, linea) {
        const base = `${String(msg).replace(/\d+/g, '#')}|${String(archivo || '').split('/').pop().split('?')[0]}|${linea || ''}`; let h = 5381;
        for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36);
    }
    const dia = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const version = () => { const s = [...document.scripts].map(x => x.src).find(x => /avisos-correo\.js\?v=/.test(x)); return s ? s.split('v=')[1] : ''; };
    const correosHoy = () => { try { const o = JSON.parse(localStorage.getItem('sar_err_correos') || '{}'); return o.d === dia() ? o.n : 0; } catch (e) { return 0; } };
    const sumaCorreo = () => { try { localStorage.setItem('sar_err_correos', JSON.stringify({ d: dia(), n: correosHoy() + 1 })); } catch (e) { /* sin storage */ } };
    const rol = () => String(document.body.dataset.userRole || '').toLowerCase();
    const STAFF = ['admin', 'administrador', 'operador', 'global', 'superadmin'];

    async function registrar(msg, archivo, linea, tipo) {
        msg = limpiar(msg); if (!msg || IGNORAR.test(msg) || /^(chrome|moz|safari)-extension/.test(archivo || '')) return;
        if (!STAFF.includes(rol())) return;
        const f = window.firebaseFirestore, db = window.firebaseDb; if (!f || !db) return;
        const h = huella(msg, archivo, linea), id = `err-${dia()}-${h}`; if (vistos.has(id) || vistos.size >= 8) return; vistos.add(id);
        const usuario = (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || '';
        try {
            const ref = f.doc(f.collection(db, 'Contadores'), id), ya = await f.getDoc(ref), ahora = new Date().toISOString();
            await f.setDoc(ref, { tipo: 'error-app', clase: tipo, mensaje: msg, archivo: String(archivo || '').split('/').pop().split('?')[0], linea: linea || 0, vista: (location.hash || '').replace('#', ''), version: version(), ultimoUsuario: usuario, ultimoRol: rol(), navegador: String(navigator.userAgent || '').slice(0, 120), veces: f.increment ? f.increment(1) : 1, dia: dia(), ultimo: ahora, ...(ya.exists() ? {} : { primero: ahora }) }, { merge: true });
            if (!ya.exists() && correosHoy() < MAX_CORREOS && window.SAR_Avisos) {
                sumaCorreo();
                window.SAR_Avisos.avisar({ destinos: DESTINO_ERRORES, titulo: 'Error detectado en el Visor', sujeto: 'Aviso automático de error', asunto: `[Visor SAR] Error detectado: ${msg.slice(0, 80)}`, intro: 'Un usuario del Visor tuvo un error de programa. No hace falta actuar de inmediato; revisa el «Directorio» (Errores y alertas) si se repite.',
                    filas: [], notas: [`Error: ${msg}`, `Dónde: ${String(archivo || '').split('/').pop().split('?')[0]}${linea ? ':' + linea : ''} · pantalla ${(location.hash || 'inicio').replace('#', '')} · versión ${version() || '—'}`, `Usuario: ${usuario || '—'} (${rol()})`] });
            }
        } catch (e) { /* el monitoreo nunca debe causar otro error */ }
    }
    if (window.addEventListener) window.addEventListener('error', (ev) => { if (ev && ev.message) registrar(ev.message, ev.filename, ev.lineno, 'js'); });
    if (window.addEventListener) window.addEventListener('unhandledrejection', (ev) => { const r = ev && ev.reason; registrar((r && (r.code ? r.code + ': ' : '') + (r.message || r)) || 'Promesa rechazada', (r && r.fileName) || '', 0, 'promesa'); });

    // ---- errores recientes para la campana de avisos (solo administración) ----
    async function cargarRecientes() {
        const f = window.firebaseFirestore, db = window.firebaseDb; if (!f || !db || !STAFF.includes(rol())) return;
        try {
            const sn = await f.getDocs(f.query(f.collection(db, 'Contadores'), f.where('tipo', '==', 'error-app')));
            const l = []; sn.forEach(d => l.push(d.data())); l.sort((a, b) => String(b.ultimo).localeCompare(String(a.ultimo)));
            window.SAR_ErroresRecientes = l.slice(0, 30);
        } catch (e) { /* sin permiso: la campana no muestra errores */ }
    }
    setTimeout(cargarRecientes, 8000); setInterval(cargarRecientes, 600000);

    // ---- panel en «Directorio de errores» ----
    async function panel() {
        const r = document.getElementById('err-root'), f = window.firebaseFirestore, db = window.firebaseDb; if (!r || !f || !db) return;
        let sec = document.getElementById('err-sistema'); if (!sec) { sec = document.createElement('section'); sec.id = 'err-sistema'; sec.className = 'err-recientes'; r.appendChild(sec); }
        sec.innerHTML = '<h3>Errores registrados en el sistema</h3><p class="err-vacio">Cargando…</p>';
        try {
            const sn = await f.getDocs(f.query(f.collection(db, 'Contadores'), f.where('tipo', '==', 'error-app')));
            const l = []; sn.forEach(d => l.push({ id: d.id, ...d.data() })); l.sort((a, b) => String(b.ultimo).localeCompare(String(a.ultimo)));
            sec.innerHTML = `<h3>Errores registrados en el sistema</h3><p class="err-vacio" style="text-align:left">Errores de programa vividos por el personal, en todos los equipos. Si uno se repite o aparece justo después de una versión nueva, avísame con el mensaje.</p>
              ${l.length ? `<ul>${l.slice(0, 25).map(x => `<li><b>${esc(x.mensaje)}</b><span>${esc(x.archivo)}${x.linea ? ':' + x.linea : ''} · ${esc(x.vista || 'inicio')} · v${esc(x.version || '—')} · ${x.veces || 1}× · ${esc(x.ultimoUsuario || '')} · ${x.ultimo ? new Date(x.ultimo).toLocaleString('es-CL') : ''}</span></li>`).join('')}</ul>` : '<p class="err-vacio" style="text-align:left">Sin errores registrados. Buena señal.</p>'}`;
        } catch (e) { sec.innerHTML = '<h3>Errores registrados en el sistema</h3><p class="err-vacio" style="text-align:left">No se pudieron leer (se necesita rol de administración).</p>'; }
    }
    function enganchar() {
        const E = window.SAR_Errores; if (!E || E.__monitor) return; E.__monitor = true;
        const orig = E.abrir; E.abrir = function () { const x = orig.apply(this, arguments); panel(); return x; };
    }
    enganchar(); document.addEventListener('DOMContentLoaded', enganchar); setTimeout(enganchar, 800);
    window.SAR_MonitorErrores = { limpiar, huella, registrar };
    if (typeof module !== 'undefined') module.exports = { limpiar, huella };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : { scripts: [], addEventListener() {}, body: { dataset: {} } });
