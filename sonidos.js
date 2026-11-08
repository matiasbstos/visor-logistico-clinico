/* Sonidos de la interfaz (v21.90): tonos sintetizados con Web Audio (sin archivos), cortos y suaves.
   ingreso = arpegio ascendente de 4 notas (los 4 colores del logo) · carga = toque corto · listo = 2 notas que suben ·
   error = 2 notas graves que bajan · aviso = 2 notas iguales · notificación = campanilla · info = una nota suave.
   Se silencian con el botón de la barra superior (se recuerda en el equipo). */
(function (window, document) {
  'use strict';
  const CLAVE = 'sar_sonido'; let ctx = null, ultimo = {}, activo = true, vol = 0.14;
  try { activo = localStorage.getItem(CLAVE) !== 'off'; } catch (e) { /* sin almacenamiento */ }
  const NOTAS = { C4: 261.63, G4: 392, C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, E3: 164.81, C3: 130.81, A3: 220, D5: 587.33 };
  /** Cada sonido: lista de [nota, inicio_s, duración_s, forma, volumen_relativo]. */
  const SONIDOS = {
    ingreso: [['C5', 0, .16, 'sine', 1], ['E5', .11, .16, 'sine', 1], ['G5', .22, .16, 'sine', 1], ['C6', .33, .38, 'sine', 1]],
    carga: [['A5', 0, .07, 'sine', .55]],
    listo: [['G5', 0, .12, 'sine', 1], ['C6', .09, .3, 'sine', 1]],
    error: [['E3', 0, .18, 'triangle', 1.4], ['C3', .15, .34, 'triangle', 1.4]],
    aviso: [['D5', 0, .11, 'triangle', 1], ['D5', .16, .16, 'triangle', 1]],
    notificacion: [['E6', 0, .5, 'sine', .9], ['A5', 0, .6, 'sine', .5]],
    info: [['E5', 0, .14, 'sine', .6]]
  };
  const DE_TIPO = { success: 'listo', error: 'error', warning: 'aviso', info: 'info' };
  function contexto() {
    if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; try { ctx = new A(); } catch (e) { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  /** Reproduce un sonido por nombre. Si el navegador aún no permite audio (sin gesto del usuario), no hace nada. */
  function tocar(nombre) {
    if (!activo || !SONIDOS[nombre]) return false;
    const ahora = Date.now(); if (ultimo[nombre] && ahora - ultimo[nombre] < 250) return false; ultimo[nombre] = ahora;
    const c = contexto(); if (!c || c.state !== 'running') return false;
    const t0 = c.currentTime + 0.01;
    SONIDOS[nombre].forEach(([nota, ini, dur, forma, v]) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = forma; o.frequency.value = NOTAS[nota];
      g.gain.setValueAtTime(0.0001, t0 + ini); g.gain.exponentialRampToValueAtTime(vol * v, t0 + ini + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + ini + dur);
      o.connect(g); g.connect(c.destination); o.start(t0 + ini); o.stop(t0 + ini + dur + 0.05);
    });
    return true;
  }
  const tipo = (t) => tocar(DE_TIPO[t] || 'info');
  function alternar(on) {
    activo = typeof on === 'boolean' ? on : !activo;
    try { localStorage.setItem(CLAVE, activo ? 'on' : 'off'); } catch (e) { /* ok */ }
    pintarBoton(); if (activo) tocar('info'); return activo;
  }
  function pintarBoton() {
    const b = document.getElementById('btn-sonido'); if (!b) return;
    b.innerHTML = '<i class="ph-bold ' + (activo ? 'ph-speaker-high' : 'ph-speaker-slash') + '"></i>';
    b.title = activo ? 'Sonidos activados (clic para silenciar)' : 'Sonidos silenciados (clic para activar)'; b.setAttribute('aria-pressed', activo ? 'true' : 'false');
  }
  function montar() {
    const camp = document.getElementById('btn-notificaciones'); if (!camp || document.getElementById('btn-sonido')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'btn-sonido'; b.className = 'btn btn-icon'; b.setAttribute('aria-label', 'Sonidos');
    b.addEventListener('click', () => alternar()); camp.insertAdjacentElement('afterend', b); pintarBoton();
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    const desbloquear = () => { contexto(); document.removeEventListener('pointerdown', desbloquear, true); document.removeEventListener('keydown', desbloquear, true); };
    document.addEventListener('pointerdown', desbloquear, true); document.addEventListener('keydown', desbloquear, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
  }
  const api = { tocar, tipo, alternar, SONIDOS, estaActivo: () => activo };
  if (typeof window !== 'undefined') window.SAR_Sonidos = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : {}, typeof document !== 'undefined' ? document : {});
