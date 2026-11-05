// Auditoría automática de UX: solapes, desbordes, objetivos pequeños. Uso: node tools/auditoria-ux.js [puerto]
const { chromium } = require(process.env.PW_PATH || '/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process');
const port = process.argv[2] || '8790';
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', port], { cwd: __dirname + '/..', stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const b = await chromium.launch();
  const out = [];
  for (const w of [1440, 1024, 390]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.route(/^https?:\/\/(?!localhost)/, r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`); await p.waitForTimeout(700);
    const vistas = await p.evaluate(() => { document.getElementById('login-view').style.display = 'none'; document.getElementById('main-app').style.display = 'flex'; return [...document.querySelectorAll('.view-section')].map(s => s.id); });
    for (const v of vistas) {
      const r = await p.evaluate((id) => {
        document.querySelectorAll('.view-section').forEach(s => s.style.display = s.id === id ? 'block' : 'none');
        const sec = document.getElementById(id), res = [];
        const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
        const sel = (e) => e.id ? '#' + e.id : (e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : '')) + ((e.textContent || '').trim().slice(0, 24) ? ` «${e.textContent.trim().slice(0, 24)}»` : '');
        const ctl = [...sec.querySelectorAll('button, a.btn, input, select, textarea, [role=tab]')].filter(vis);
        for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
          const a = ctl[i].getBoundingClientRect(), c = ctl[j].getBoundingClientRect();
          if (ctl[i].contains(ctl[j]) || ctl[j].contains(ctl[i])) continue;
          const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left), oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
          if (ox > 2 && oy > 2) res.push('SOLAPE ' + sel(ctl[i]) + ' × ' + sel(ctl[j]));
        }
        ctl.forEach(e => { const r = e.getBoundingClientRect(); if (r.height < 28 && e.type !== 'checkbox' && e.type !== 'radio' && e.type !== 'hidden') res.push(`PEQUEÑO ${Math.round(r.width)}×${Math.round(r.height)} ${sel(e)}`); });
        [...sec.querySelectorAll('button, a, label, h1, h2, h3, h4, th, .btn, .chip, span')].filter(vis).forEach(e => { if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible' && e.clientWidth > 0) res.push('TEXTO RECORTADO ' + sel(e)); });
        if (document.documentElement.scrollWidth > innerWidth + 2) res.push('SCROLL HORIZONTAL de página (' + document.documentElement.scrollWidth + ' > ' + innerWidth + ')');
        const rows = {}; [...sec.querySelectorAll('.btn, button')].filter(vis).forEach(e => { const r = e.getBoundingClientRect(); const k = Math.round(r.top / 4); (rows[k] = rows[k] || []).push(Math.round(r.height)); });
        Object.values(rows).forEach(h => { if (h.length > 1 && Math.max(...h) - Math.min(...h) > 4) res.push('ALTURAS DISTINTAS en una fila de botones: ' + h.join('/')); });
        return [...new Set(res)].slice(0, 25);
      }, v);
      r.forEach(x => out.push(`[${w}px] ${v}: ${x}`));
    }
    await p.close();
  }
  await b.close(); srv.kill();
  console.log(out.length ? out.join('\n') : 'Sin hallazgos automáticos.'); console.log(`\n${out.length} hallazgo(s) candidato(s).`);
})();
