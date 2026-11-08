/* Pruebas de humo del Visor (no se publican). Uso:
     python3 -m http.server 8765 &   # desde la carpeta del proyecto
     node tests/humo.js              # requiere: npm i -D playwright
   Comprueba que la página carga sin errores propios, que las tablas tienen su barra «Columnas»,
   que ocultar una columna funciona y se guarda, y que la ventana de licencias abre y cierra. */
const { chromium } = require('playwright');
const URL = process.env.VISOR_URL || 'http://localhost:8765/index.html';
(async () => {
    const b = await chromium.launch(), p = await b.newPage(), errs = [], fallos = [];
    p.on('pageerror', (e) => errs.push(e.message));
    const ok = (c, m) => { if (!c) fallos.push(m); console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); };
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
    ok(await p.locator('.tc-bar').count() >= 8, 'barras de columnas en las tablas principales');
    const oculta = await p.evaluate(() => { const cb = document.querySelector('.tc-bar [data-i="2"]'); if (!cb) return null; cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); const t = cb.closest('.tc-bar').parentElement.querySelector('table[data-tc]') || document.querySelector('table[data-tc]'); return { d: getComputedStyle(t.querySelectorAll('thead th')[1]).display, g: !!localStorage.getItem('sar_cols_v1_' + t.dataset.tc) }; });
    ok(oculta && oculta.d === 'none' && oculta.g, 'ocultar una columna funciona y se guarda');
    await p.evaluate(() => document.getElementById('menu-acerca').click()); await p.waitForTimeout(200);
    ok(await p.locator('#ac-t').count() === 1, 'abre licencias y términos'); await p.keyboard.press('Escape'); ok(await p.locator('#ac-t').count() === 0, 'Esc cierra licencias y términos');
    const propios = errs.filter(e => !/firebase|gstatic|import|module|fetch|Failed to load|net::/i.test(e)); ok(!propios.length, 'sin errores de JavaScript propios ' + JSON.stringify(propios.slice(0, 2)));
    await b.close(); process.exit(fallos.length ? 1 : 0);
})();
