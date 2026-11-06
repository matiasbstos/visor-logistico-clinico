/* ==========================================================================
   CORREO CON IDENTIDAD VISUAL (v21.37)
   Arma el HTML de los avisos de Seguimiento de OC (recepciones, incidencias, notas…) con la
   paleta del SAR (azul #1A3668, rojo, naranja, amarillo y verde de los cuadrados del logo),
   el logo, tablas para los productos y barras de avance por centro. Es HTML con estilos en
   línea (tablas), que es lo que soportan Gmail y Outlook; el logo va por URL pública del
   sitio (los correos no cargan imágenes incrustadas de forma fiable). Si el cliente de correo
   bloquea imágenes, el encabezado igual se lee (texto "SAR").
   ========================================================================== */
(function (window) {
    'use strict';
    const SITIO = 'https://sarinventario.web.app';
    const C = { azul: '#1A3668', azulOsc: '#12274D', azulClaro: '#EEF2F9', rojo: '#CC1B23', naranja: '#E85D1E', amarillo: '#F3D015', verde: '#8CC63F', verdeOsc: '#3F6B0E', fondo: '#F4F6FA', texto: '#1F2937', suave: '#6B7280', borde: '#DDE3EE' };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const F = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

    /** Puro: separa el texto de una recepción/aviso en partes. */
    function parsear(texto) {
        const lineas = String(texto || '').split('\n').map(l => l.replace(/\s+$/, ''));
        const out = { encabezado: '', items: [], incidencias: [], obs: '', notas: [], ingreso: '' };
        let modo = 'cab';
        lineas.forEach((l, i) => {
            if (!l.trim()) return;
            if (i === 0) { out.encabezado = l.replace(/:$/, ''); return; }
            if (/^INCIDENCIAS:/i.test(l)) { modo = 'inc'; return; }
            if (/^Obs\.:/i.test(l)) { out.obs = l.replace(/^Obs\.:\s*/i, ''); return; }
            if (/^Ingresado al stock/i.test(l)) { out.ingreso = l; return; }
            const m = l.match(/^- (.+?): (\d+) un\.(.*)$/);
            if (m && modo === 'cab') { out.items.push({ nombre: m[1], cantidad: m[2], extra: m[3].replace(/^\s*·\s*/, '') }); return; }
            if (/^- /.test(l) && modo === 'inc') { out.incidencias.push(l.replace(/^- /, '')); return; }
            if (/^- /.test(l) && modo === 'cab') { out.items.push({ nombre: l.replace(/^- /, ''), cantidad: '', extra: '' }); return; }
            out.notas.push(l);
        });
        return out;
    }
    const barra = (rec, ped) => { const p = ped > 0 ? Math.max(0, Math.min(100, Math.round(rec * 100 / ped))) : 0; return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td style="background:${C.borde};border-radius:6px;height:10px;font-size:0;line-height:0;"><table role="presentation" width="${p}%" cellpadding="0" cellspacing="0"><tr><td style="background:${p >= 100 ? C.verde : C.naranja};border-radius:6px;height:10px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr></table>`; };

    /** opts: { titulo, texto, autor, orden:{numeroOC, proveedor, plazo, centros:[{centro, recibido, pedido, pendiente}]} } */
    function armar(opts) {
        const p = parsear(opts.texto), o = opts.orden || {}, cen = o.centros || [];
        const completa = cen.length && cen.every(c => !c.pendiente);
        const chip = completa ? `<span style="background:${C.verde};color:${C.verdeOsc};border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;">Orden completa</span>` : (cen.length ? `<span style="background:#FDE7DA;color:#9A3412;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;">Recepción parcial</span>` : '');
        const filas = p.items.map((x, i) => `<tr><td style="padding:9px 12px;border-bottom:1px solid ${C.borde};${F}font-size:14px;color:${C.texto};background:${i % 2 ? '#FBFCFE' : '#fff'};">${esc(x.nombre)}${x.extra ? `<div style="font-size:12px;color:${C.suave};">${esc(x.extra)}</div>` : ''}</td><td align="right" style="padding:9px 12px;border-bottom:1px solid ${C.borde};${F}font-size:15px;font-weight:700;color:${C.azul};white-space:nowrap;background:${i % 2 ? '#FBFCFE' : '#fff'};">${esc(x.cantidad)}${x.cantidad ? ' un.' : ''}</td></tr>`).join('');
        const tabla = p.items.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${C.borde};border-radius:8px;overflow:hidden;margin:14px 0;"><tr><td style="background:${C.azul};color:#fff;padding:9px 12px;${F}font-size:12px;letter-spacing:.06em;font-weight:700;">PRODUCTO</td><td align="right" style="background:${C.azul};color:#fff;padding:9px 12px;${F}font-size:12px;letter-spacing:.06em;font-weight:700;">CANTIDAD</td></tr>${filas}</table>` : '';
        const aviso = (txt, col, bg) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0;"><tr><td style="border-left:4px solid ${col};background:${bg};padding:10px 14px;${F}font-size:14px;color:${C.texto};">${txt}</td></tr></table>`;
        const inc = p.incidencias.length ? aviso(`<b style="color:${C.rojo};">Incidencias</b><br>${p.incidencias.map(esc).join('<br>')}`, C.rojo, '#FDECEC') : '';
        const ing = p.ingreso ? aviso(esc(p.ingreso), C.verde, '#F3FAE8') : '';
        const obs = p.obs ? aviso(`<b>Observaciones:</b> ${esc(p.obs)}`, C.amarillo, '#FFFBE0') : '';
        const notas = p.notas.length ? `<p style="${F}font-size:14px;color:${C.texto};line-height:1.5;margin:10px 0;">${p.notas.map(esc).join('<br>')}</p>` : '';
        const centros = cen.map(c => `<tr><td style="padding:8px 0;${F}font-size:13px;color:${C.texto};"><b>${esc(c.centro)}</b> &nbsp;<span style="color:${C.suave};">recibido ${c.recibido} de ${c.pedido} un.${c.pendiente ? ` · <b style="color:#9A3412;">pendiente ${c.pendiente}</b>` : ' · completo'}</span>${barra(c.recibido, c.pedido)}</td></tr>`).join('');
        const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Language" content="es"></head>
<body style="margin:0;padding:0;background:${C.fondo};" lang="es">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.fondo};"><tr><td align="center" style="padding:18px 10px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#fff;border-radius:10px 10px 10px 0;overflow:hidden;border:1px solid ${C.borde};">
<tr><td style="font-size:0;line-height:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="25%" style="background:${C.rojo};height:6px;">&nbsp;</td><td width="25%" style="background:${C.naranja};height:6px;">&nbsp;</td><td width="25%" style="background:${C.amarillo};height:6px;">&nbsp;</td><td width="25%" style="background:${C.verde};height:6px;">&nbsp;</td></tr></table></td></tr>
<tr><td style="background:${C.azul};padding:16px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="76" style="vertical-align:middle;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#fff;border-radius:8px 8px 8px 0;padding:6px 8px;"><img src="${SITIO}/assets/logo-sar.png" width="60" alt="SAR" style="display:block;border:0;height:auto;font-family:Arial;color:${C.azul};font-weight:700;"></td></tr></table></td>
<td style="vertical-align:middle;padding-left:12px;${F}"><div style="color:#fff;font-size:18px;font-weight:700;line-height:1.2;">Visor Logístico</div><div style="color:#C9D6EE;font-size:12px;letter-spacing:.04em;">SAR Elsa Romo Aravena · Corp. Municipal de Melipilla</div></td>
<td align="right" style="vertical-align:middle;">${chip}</td></tr></table></td></tr>
<tr><td style="padding:14px 24px 0;${F}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#FFF7E0;border:1px solid ${C.amarillo};border-left:5px solid ${C.amarillo};border-radius:6px;padding:10px 14px;font-size:13px;color:${C.texto};line-height:1.45;"><b style="color:${C.azul};">CORREO DE RESPALDO.</b> Informa <b>solamente</b> ${/recepci/i.test(String(opts.titulo || '')) ? 'el registro de la recepción de los productos' : 'el registro de esta acción'} en el sistema. Fue <b>generado automáticamente por el sistema Visor Logístico SAR</b>; no requiere respuesta.</td></tr></table></td></tr>
<tr><td style="padding:14px 24px 8px;${F}"><div style="font-size:12px;letter-spacing:.08em;color:${C.suave};font-weight:700;">${esc(String(opts.titulo || 'AVISO').toUpperCase())}</div>
<div style="font-size:20px;font-weight:700;color:${C.azul};margin:4px 0 2px;">OC ${esc(o.numeroOC || '')}</div><div style="font-size:14px;color:${C.suave};">${esc(o.proveedor || '')}</div>
${p.encabezado ? `<div style="margin-top:12px;font-size:14px;color:${C.texto};line-height:1.45;background:${C.azulClaro};border-radius:8px;padding:10px 12px;">${esc(p.encabezado)}</div>` : ''}
${tabla}${inc}${ing}${obs}${notas}</td></tr>
${cen.length ? `<tr><td style="padding:6px 24px 18px;${F}"><div style="font-size:12px;letter-spacing:.08em;color:${C.suave};font-weight:700;margin-bottom:2px;">ESTADO DE LA ORDEN</div>${o.plazo ? `<div style="font-size:12px;color:${C.suave};margin-bottom:4px;">${esc(o.plazo)}</div>` : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${centros}</table></td></tr>` : ''}
<tr><td style="background:${C.azulClaro};padding:12px 24px;${F}font-size:12px;color:${C.suave};line-height:1.5;">Correo de respaldo generado por el sistema <b style="color:${C.azul};">Visor Logístico SAR</b> (registrado por ${esc(opts.autor || 'el sistema')}).<br><a href="${SITIO}" style="color:${C.azul};">${SITIO.replace('https://', '')}</a></td></tr>
</table></td></tr></table></body></html>`;
        return html;
    }
    window.SAR_CorreoHTML = { armar, parsear };
    if (typeof module !== 'undefined') module.exports = window.SAR_CorreoHTML;
})(typeof window !== 'undefined' ? window : globalThis);
