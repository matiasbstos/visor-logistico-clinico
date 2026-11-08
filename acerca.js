/* ==========================================================================
   LICENCIAS Y TÉRMINOS DE USO (v21.55)
   Ventana accesible desde el menú lateral: qué es el Visor, términos de uso internos, tratamiento de
   datos y las licencias de las bibliotecas de terceros que usa (todas con licencia que permite este
   uso). Sin datos: solo texto estático.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const LIBS = [
        ['Firebase JS SDK (Auth, Firestore)', 'Apache-2.0', 'Google'], ['Chart.js 4.4', 'MIT', 'Chart.js contributors'], ['jsPDF 2.5 y AutoTable 3.8', 'MIT', 'Parallax / S. Hakimi'],
        ['SheetJS (xlsx) 0.18', 'Apache-2.0', 'SheetJS LLC'], ['pdf-lib 1.17', 'MIT', 'Andrew Dillon'], ['Phosphor Icons 2.1', 'MIT', 'Phosphor Icons'],
        ['html5-qrcode 2.3', 'Apache-2.0', 'Minhaz'], ['Fuente Outfit (Google Fonts)', 'SIL OFL 1.1', 'The Outfit Project Authors']
    ];
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function abrir() {
        const o = document.createElement('div'); o.className = 'bit-modal'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-labelledby', 'ac-t');
        o.innerHTML = `<div class="ac-c" tabindex="-1"><div class="ac-h"><h3 id="ac-t">Visor Logístico SAR · licencias y términos</h3><button type="button" class="btn btn-outline" id="ac-x" aria-label="Cerrar">✕</button></div>
          <div class="ac-b"><h4>Uso del sistema</h4><ul><li>Es una herramienta interna del SAR Elsa Romo Aravena para controlar insumos, compras y entregas. El acceso es personal e intransferible: cada acción queda registrada con el correo de quien la hizo.</li>
          <li>Las actas, recepciones y movimientos tienen valor de respaldo interno. Un acta solo descuenta stock al confirmar la entrega con el acta firmada.</li>
          <li>Los correos de aviso los genera el sistema automáticamente y no requieren respuesta.</li></ul>
          <h4>Datos</h4><ul><li>No se deben ingresar datos de pacientes (RUT, nombres, camas). Los registros antiguos que los tenían se anonimizan.</li>
          <li>El acceso a la información depende del rol asignado por administración; sin rol no se ve nada.</li></ul>
          <h4>Bibliotecas de terceros</h4><table class="bit-tabla"><thead><tr><th scope="col">Componente</th><th scope="col">Licencia</th><th scope="col">Autor</th></tr></thead><tbody>${LIBS.map(l => `<tr><td>${esc(l[0])}</td><td>${esc(l[1])}</td><td>${esc(l[2])}</td></tr>`).join('')}</tbody></table>
          <p class="act-hint">Las licencias MIT, Apache-2.0 y SIL OFL permiten el uso en software institucional; los avisos de cada una se conservan en sus archivos fuente.</p></div></div>`;
        document.body.appendChild(o); document.body.style.overflow = 'hidden';
        const prev = document.activeElement;
        const cerrar = () => { document.removeEventListener('keydown', tec); document.body.style.overflow = ''; o.remove(); if (prev && prev.focus) prev.focus(); };
        const tec = (k) => { if (k.key === 'Escape') cerrar(); if (k.key === 'Tab') { k.preventDefault(); o.querySelector('#ac-x').focus(); } };
        document.addEventListener('keydown', tec); o.querySelector('#ac-x').addEventListener('click', cerrar); o.addEventListener('mousedown', (e) => { if (e.target === o) cerrar(); });
        o.querySelector('#ac-x').focus();
    }
    function iniciar() { const m = document.getElementById('menu-acerca'); if (m && !m.dataset.ok) { m.dataset.ok = '1'; m.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); abrir(); }); } }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
    window.SAR_Acerca = { abrir, LIBS };
})(window, document);
