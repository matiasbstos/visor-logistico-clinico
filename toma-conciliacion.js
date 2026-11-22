/* ==========================================================================
   TOMA DE INVENTARIO · CONCILIACIÓN POR LOTE (v21.246) — DECISIONES 4.302
   Funciones puras (sin Firestore ni pantalla): comparan lo que dice el sistema con lo contado, lote por lote,
   y calculan qué queda al cerrar. El cierre FIJA lo contado (nunca lo suma).
   · Clave de lote: LOTE (mayúsculas, sin espacios de más; vacío = S/L) | vencimiento AAAA-MM (vacío = N/A).
   · Estados: ok · sobra · falta · nuevo (lote que no estaba) · sin_contar (toma parcial) .
     En una toma COMPLETA lo no contado cuenta como 0 (falta); en una PARCIAL queda «sin_contar» y no cambia.
   · Recuento: diferencia > 5 % o > 10 u.; en controlados, cualquier diferencia.
   ========================================================================== */
(function (root) {
  'use strict';
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const lote = (b) => { const t = String(b == null ? '' : b).trim().replace(/\s+/g, ' ').toUpperCase(); return !t || /^(S\/?L|SIN LOTE|N\/?A|-)$/.test(t) ? 'S/L' : t; };
  /** Vencimiento → AAAA-MM (acepta AAAA-MM-DD, AAAA-MM, MM/AAAA, DD/MM/AAAA, DD-MM-AAAA, ISO). Vacío o N/A → 'N/A'. */
  function mes(v) {
    const t = String(v == null ? '' : v).trim(); if (!t || /^(n\/?a|s\/v|-|sin)/i.test(t)) return 'N/A';
    let m = /^(\d{4})-(\d{1,2})/.exec(t); if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
    m = /^(\d{1,2})[\/\-.](\d{4})$/.exec(t); if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(t); if (m) return `${m[3]}-${m[2].padStart(2, '0')}`;
    return t.toUpperCase();
  }
  const clave = (b, v) => `${lote(b)}|${mes(v)}`;
  /** Junta lotes repetidos (mismo lote y mes) sumando cantidades. Entrada: [{batch, expirationDate, quantity}] */
  function agrupar(lista) {
    const m = new Map();
    (lista || []).forEach(x => { if (!x) return; const k = clave(x.batch, x.expirationDate), e = m.get(k) || { clave: k, batch: lote(x.batch), vence: mes(x.expirationDate), quantity: 0, original: x.expirationDate || '', crudo: x.batch == null ? '' : String(x.batch) }; e.quantity += num(x.quantity); if (!e.original && x.expirationDate) e.original = x.expirationDate; m.set(k, e); });
    return m;
  }
  /**
   * conciliar(sistema, contado, opc) → { lineas:[{clave,batch,vence,sistema,contado,delta,estado}], totales }
   * sistema / contado: [{batch, expirationDate, quantity}] (contado puede traer lotes que no están en el sistema).
   * opc.completa: lo no contado = 0 (falta). Si no, queda 'sin_contar' (delta 0).
   */
  function conciliar(sistema, contado, opc) {
    const o = opc || {}, S = agrupar(sistema), C0 = agrupar(contado), lineas = [];
    /* el mismo lote contado con otro mes (error al leer el vencimiento) se concilia con el del sistema si ese lote no se contó con su mes */
    const C = new Map(); C0.forEach((c, k) => { if (S.has(k)) { C.set(k, c); return; } const mismos = [...S.values()].filter(s => s.batch === c.batch && !C0.has(s.clave)); if (mismos.length === 1) { const k2 = mismos[0].clave, prev = C.get(k2); C.set(k2, prev ? { ...prev, quantity: prev.quantity + c.quantity } : { ...c, clave: k2, mesContado: c.vence }); } else C.set(k, c); });
    S.forEach((s, k) => {
      const c = C.get(k);
      if (!c) { if (o.completa) lineas.push({ clave: k, batch: s.batch, loteSistema: s.crudo, vence: s.vence, sistema: s.quantity, contado: 0, delta: -s.quantity, estado: s.quantity > 0 ? 'falta' : 'ok' }); else lineas.push({ clave: k, batch: s.batch, loteSistema: s.crudo, vence: s.vence, sistema: s.quantity, contado: null, delta: 0, estado: 'sin_contar' }); return; }
      const d = c.quantity - s.quantity; lineas.push({ clave: k, batch: s.batch, loteSistema: s.crudo, vence: s.vence, sistema: s.quantity, contado: c.quantity, delta: d, estado: d === 0 ? 'ok' : d > 0 ? 'sobra' : 'falta', ...(c.mesContado ? { mesContado: c.mesContado } : {}) });
    });
    C.forEach((c, k) => { if (!S.has(k)) lineas.push({ clave: k, batch: c.batch, vence: c.vence, venceOriginal: c.original, sistema: 0, contado: c.quantity, delta: c.quantity, estado: c.quantity > 0 ? 'nuevo' : 'ok' }); });
    const t = { sistema: 0, contado: 0, sobra: 0, falta: 0, nuevo: 0, sinContar: 0 };
    lineas.forEach(l => { t.sistema += l.sistema; if (l.contado != null) t.contado += l.contado; if (l.estado === 'sobra') t.sobra += l.delta; if (l.estado === 'nuevo') t.nuevo += l.delta; if (l.estado === 'falta') t.falta += -l.delta; if (l.estado === 'sin_contar') t.sinContar++; });
    return { lineas, totales: t };
  }
  /** ¿Exige recontar? > 5 % o > 10 u.; en controlados, cualquier diferencia. */
  function requiereReconteo(l, opc) {
    const d = Math.abs(num(l && l.delta)); if (!d) return false; if (opc && opc.controlado) return true;
    return d > 10 || (num(l.sistema) > 0 && d / num(l.sistema) > 0.05);   /* un lote nuevo pequeño (≤ 10 u.) no exige recontar */
  }
  /**
   * Cierre: aplica las diferencias calculadas AL CONTAR sobre los lotes ACTUALES (lo que salió entre el conteo y el cierre no se pierde).
   * lineas: las de conciliar() (solo se usan las con delta ≠ 0 y no sin_contar); filtro(l) decide cuáles aplicar (p. ej. solo sobras).
   * Devuelve { batches, quantity, negativos:[clave] } — negativos: lotes que quedarían bajo 0 (se dejan en 0 y se informan).
   */
  function aplicar(lotesActuales, lineas, filtro) {
    const m = agrupar(lotesActuales), negativos = [];
    (lineas || []).filter(l => l && l.estado !== 'sin_contar' && num(l.delta) !== 0 && (!filtro || filtro(l))).forEach(l => {
      const e = m.get(l.clave) || { clave: l.clave, batch: l.batch, vence: l.vence, quantity: 0, original: l.venceOriginal || (l.vence === 'N/A' ? '' : l.vence) };
      e.quantity += num(l.delta); if (e.quantity < 0) { negativos.push(l.clave); e.quantity = 0; } m.set(l.clave, e);
    });
    const batches = [...m.values()].filter(e => e.quantity > 0).map(e => ({ batch: e.batch, quantity: e.quantity, expirationDate: e.original || (e.vence === 'N/A' ? 'N/A' : e.vence) }));
    return { batches, quantity: batches.reduce((t, b) => t + b.quantity, 0), negativos };
  }
  /** Para la pantalla en vivo: cuánto falta por pistolear de cada lote (sistema − contado), y si ya sobra. */
  function avance(sistema, contado) {
    return conciliar(sistema, contado, { completa: false }).lineas.map(l => ({ ...l, queda: l.contado == null ? l.sistema : Math.max(0, l.sistema - l.contado), sobran: l.contado != null && l.contado > l.sistema ? l.contado - l.sistema : 0 }));
  }
  /** Lo reservado en actas sigue físicamente en la bodega: se descuenta de lo contado en orden de vencimiento (como se reservó), antes de comparar. */
  function quitarReservado(contado, reservado) {
    let r = Math.max(0, num(reservado)); if (!r) { const o0 = (contado || []).slice(); o0.reservadoSinCubrir = 0; return o0; }
    const ord = (contado || []).map((x, i) => ({ ...x, _i: i })).sort((a, b) => String(mes(a.expirationDate)).localeCompare(String(mes(b.expirationDate))));
    ord.forEach(x => { const q = Math.min(num(x.quantity), r); x.quantity = num(x.quantity) - q; r -= q; });
    const out = ord.sort((a, b) => a._i - b._i).map(({ _i, ...x }) => x); out.reservadoSinCubrir = r;   /* reservado que no apareció en el conteo */
    return out;
  }
  const api = { lote, mes, clave, agrupar, conciliar, requiereReconteo, aplicar, avance, quitarReservado };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SAR_Toma = api;
})(typeof window !== 'undefined' ? window : null);
