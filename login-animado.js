/* ==========================================================================
   LOGIN ANIMADO (v20.48)
   Solo presentación: un panel de marca que se desliza entre "Ingresar" y
   "Recuperar acceso". La autenticación sigue en script.js (form-login y
   forgot-pwd-link no cambian); aquí el formulario de recuperación reutiliza ese
   mismo enlace, así que el envío del correo es idéntico al de antes.
   ========================================================================== */
(function (window, document) {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const shell = $('lg-shell'); if (!shell) return;
    const ing = $('lg-ingreso'), rec = $('lg-recuperar');

    function modo(m) {
        shell.dataset.modo = m;
        const enRec = m === 'recuperar';
        ing.setAttribute('aria-hidden', String(enRec)); rec.setAttribute('aria-hidden', String(!enRec));
        ing.inert = enRec; rec.inert = !enRec;
        // lleva el correo escrito de un lado al otro
        if (enRec) { const e = $('login-email').value.trim(); if (e && !$('reset-email').value) $('reset-email').value = e; }
        else { const e = $('reset-email').value.trim(); if (e && !$('login-email').value) $('login-email').value = e; }
        setTimeout(() => { const f = enRec ? $('reset-email') : $('login-email'); if (f) f.focus({ preventScroll: true }); }, 380);
    }
    rec.inert = true;
    $('lg-ir-recuperar').addEventListener('click', () => modo('recuperar'));
    $('lg-ir-recuperar-m').addEventListener('click', (e) => { e.preventDefault(); modo('recuperar'); });
    $('lg-ir-ingreso').addEventListener('click', () => modo('ingreso'));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && shell.dataset.modo === 'recuperar' && $('login-view').style.display !== 'none') modo('ingreso'); });
    $('form-recuperar').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = $('reset-email').value.trim();
        if (!email) { window.showToast && window.showToast('Atención Requerida', 'Ingrese su correo para recuperar la contraseña', 'warning'); $('reset-email').focus(); return; }
        $('login-email').value = email;               // el manejador existente lee este campo
        $('forgot-pwd-link').click();                 // valida, envía y muestra el aviso
    });
    // estado "enviando": el punto verde orbita mientras se valida (máx. 6 s)
    let t;
    function cargando() { shell.classList.add('lg-cargando'); clearTimeout(t); t = setTimeout(() => shell.classList.remove('lg-cargando'), 6000); }
    $('form-login').addEventListener('submit', cargando);
    $('form-recuperar').addEventListener('submit', cargando);
    $('forgot-pwd-link').addEventListener('click', cargando);
    // #forgot-pwd-link (oculto) conserva el envío del correo; lo dispara el formulario de Recuperar acceso
})(window, document);
