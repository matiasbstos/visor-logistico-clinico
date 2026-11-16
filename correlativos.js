/* ==========================================================================
   ESTÁNDAR DE CORRELATIVOS (v21.220) — investigación «Murdock» (SAP, Dynamics 365, Odoo, Directiva IVA UE art. 226,
   GS1, ISO 8601) y decisiones del usuario (docs/DECISIONES.md 4.272, Directorio → Nomenclaturas).
   · Formato: TIPO-AAAA-NNNNN  (prefijo único de 2–4 letras · año de emisión, hora de Chile · 5 dígitos, BUL 6).
   · Una serie por tipo y año, contador `Contadores/ctr-<tipo>-<AAAA>` ({ultimo}) siempre dentro de una transacción:
     dos personas a la vez nunca sacan el mismo número. Nunca se reutiliza ni se borra un folio (lo mal hecho queda ANULADO).
   · Sin conexión: folio provisional TIPO-P-AAAAMMDD-XXXX (sin O, I, L ni U, para no confundir al leer).
   · Transición: lo que ya tenía correlativo (AE, SOL, DIST, BUL, PI, PO, ING/CAM/AJU) sigue igual durante 2026;
     desde el 1-ene-2027 a las 00:01 todos usan 5 dígitos e ING, CAM y AJU tienen cada uno su contador.
     Lo que antes se numeraba al azar o con la hora (REC, TRA, INV, BAN, CIE, REP, SUG) usa este formato desde ya.
   ========================================================================== */
(function (window) {
  'use strict';
  const CORTE = Date.parse('2027-01-01T03:01:00Z');   // 1-ene-2027 00:01 en Chile (UTC-3 en verano)
  const ANCHO = { BUL: 6 };
  const ANCHO_2026 = { AE: 4, SOL: 4, DIST: 4, PI: 4, PO: 4, BUL: 6, ING: 6, CAM: 6, AJU: 6 };
  const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const ms = (f) => f === undefined || f === null || f === '' ? Date.now() : (typeof f === 'number' ? f : (f && f.toMillis ? f.toMillis() : Date.parse(f) || Date.now()));
  /** ¿Ya rige el estándar completo (desde el 1-ene-2027 00:01)? */
  const nuevo = (fecha) => ms(fecha) >= CORTE;
  /** Año de emisión en hora de Chile (no el del reloj UTC). */
  function anio(fecha) {
    const d = new Date(ms(fecha));
    try { return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric' }).format(d)); } catch (e) { return d.getFullYear(); }
  }
  /** Dígitos del número: 5 (BUL 6); en 2026 los tipos que ya existían conservan su ancho. */
  const ancho = (tipo, fecha) => nuevo(fecha) ? (ANCHO[tipo] || 5) : (ANCHO_2026[tipo] || ANCHO[tipo] || 5);
  const formato = (tipo, a, n, fecha) => `${tipo}-${a}-${String(Math.max(0, Math.floor(Number(n) || 0))).padStart(ancho(tipo, fecha), '0')}`;
  const contadorId = (tipo, a) => `ctr-${String(tipo).toLowerCase()}-${a}`;
  /** Folio provisional (sin conexión): TIPO-P-AAAAMMDD-XXXX. */
  function provisional(tipo, fecha) {
    const d = new Date(ms(fecha)), p = (n) => String(n).padStart(2, '0'); let x = '';
    try { const a = new Uint8Array(4); crypto.getRandomValues(a); a.forEach(v => { x += CROCK[v % 32]; }); } catch (e) { for (let i = 0; i < 4; i++) x += CROCK[Math.floor(Math.random() * 32)]; }
    return `${tipo}-P-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${x}`;
  }
  const F = () => window.firebaseFirestore, D = () => window.firebaseDb;
  /** Dentro de una transacción ya abierta (leer ANTES de escribir): const c = await leer(tx, 'TRA'); … const folio = escribir(tx, c). */
  async function leer(tx, tipo, fecha) {
    const f = F(), a = anio(fecha), ref = f.doc(f.collection(D(), 'Contadores'), contadorId(tipo, a)), s = await tx.get(ref);
    return { ref, tipo, a, fecha, ultimo: s.exists() ? Number(s.data().ultimo) || 0 : 0 };
  }
  function escribir(tx, c, cuantos) {
    const k = Math.max(1, Math.floor(Number(cuantos) || 1)), ini = c.ultimo + 1; c.ultimo += k;
    tx.set(c.ref, { tipo: 'correlativo', serie: c.tipo, anio: c.a, ultimo: c.ultimo, actualizado: new Date().toISOString() });
    const lista = []; for (let i = 0; i < k; i++) lista.push(formato(c.tipo, c.a, ini + i, c.fecha));
    return k === 1 ? lista[0] : lista;
  }
  /** `cuantos` folios seguidos del tipo (una transacción). Sin conexión o sin permiso: provisionales (opts.estricto = lanza). */
  async function varios(tipo, cuantos, opts) {
    const k = Math.max(1, Math.floor(Number(cuantos) || 1)), o = opts || {}, f = F();
    try {
      if (!f || !f.runTransaction) throw new Error('sin base');
      const r = await Promise.race([f.runTransaction(D(), async (tx) => { const c = await leer(tx, tipo, o.fecha); return escribir(tx, c, k); }), new Promise((_, x) => setTimeout(() => x(new Error('sin respuesta')), o.esperaMs || 8000))]);
      return Array.isArray(r) ? r : [r];
    } catch (e) {
      if (o.estricto) throw e;
      console.warn('[Correlativos] provisional para', tipo, '·', e && e.message);
      const out = []; for (let i = 0; i < k; i++) out.push(provisional(tipo, o.fecha)); return out;
    }
  }
  const siguiente = async (tipo, opts) => (await varios(tipo, 1, opts))[0];
  const esProvisional = (folio) => /^[A-Z]{2,4}-P-\d{8}-[0-9A-Z]{4}$/.test(String(folio || ''));

  const api = { CORTE, nuevo, anio, ancho, formato, contadorId, provisional, leer, escribir, varios, siguiente, esProvisional };
  window.SAR_Folio = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
