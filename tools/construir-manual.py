#!/usr/bin/env python3
"""Arma manual.html (se publica con el sitio) a partir de docs/manual/*.md.
Uso:  python3 tools/construir-manual.py  [--pdf]
--pdf  además genera manual/Manual-Visor-SAR.pdf con Chromium (Playwright).
Orden: Introducción · Reglas del sitio · Inventario · Movimientos · Catálogo, OC y ajustes.
"""
import re, sys, html, datetime, pathlib, markdown

R = pathlib.Path(__file__).resolve().parent.parent
D = R / 'docs' / 'manual'
VERSION = re.search(r"visor-logistico-v(21\.\d+)", (R / 'sw.js').read_text()).group(1)

def leer(n):
    return (D / n).read_text(encoding='utf-8')

def sin_titulo(md):
    """Quita el '# Parte N…' y la línea '> Versión del Visor revisada…'."""
    md = re.sub(r'^# .*\n', '', md, count=1)
    md = re.sub(r'^> Versión del Visor revisada.*\n', '', md, flags=re.M)
    return md

def partir(md):
    """Separa intro (antes del primer ##) y secciones ## (título, cuerpo)."""
    trozos = re.split(r'^## (.+)$', md, flags=re.M)
    intro, secs = trozos[0], []
    for i in range(1, len(trozos), 2):
        t = re.sub(r'^\d+(?:[.-]\w+)*\.?\s+', '', trozos[i].strip())
        secs.append((t, trozos[i + 1]))
    return intro, secs

inv = sin_titulo(leer('01-inventario.md'))
mov_all = sin_titulo(leer('02-movimientos-y-reglas.md'))
cat = sin_titulo(leer('03-catalogo-oc-ajustes.md'))
mov, reglas = re.split(r'^# 8\. REGLAS DEL SITIO.*$', mov_all, flags=re.M)

mov_intro, mov_secs = partir(mov)
reg_intro, reg_secs = partir(reglas)
inv_intro, inv_secs = partir(inv)
cat_intro, cat_secs = partir(cat)

INTRO = f"""
El **Visor Logístico SAR** es el sistema donde se registra todo lo que entra, se mueve y sale de las bodegas del SAR Elsa Romo Aravena:
existencias por lote y vencimiento, ingresos, transferencias, actas de entrega, solicitudes de insumos, órdenes de compra, tomas de inventario y etiquetas.

**Cómo entrar.** Abre **sarinventario.web.app** en el computador o en el teléfono y entra con tu correo y tu clave personal.
En el teléfono conviene **instalarlo** («Agregar a pantalla de inicio») para que funcione mejor sin internet.

**Cómo usar este manual.**
- Empieza por **Reglas del sitio**: son obligatorias para todo el personal.
- Después busca el módulo que vas a usar. Cada uno explica **para qué sirve**, **quién lo usa**, el **paso a paso**, **qué hacer si pasa algo** y sus **reglas**.
- Los nombres de botones van en **negrita**, tal como aparecen en pantalla.
- Este manual describe solo lo que está en uso hoy (versión {VERSION}). Si ves en el Visor algo que no está aquí, no lo uses sin preguntar al encargado de insumos.
"""

capitulos = [
    ('intro', 'Introducción', INTRO + mov_intro, []),
    ('reglas', 'Reglas del sitio', reg_intro, reg_secs),
    ('inventario', 'Inventario', inv_intro, inv_secs),
    ('movimientos', 'Movimientos y bodegas', '', mov_secs),
    ('catalogo', 'Catálogo, órdenes de compra y ajustes', cat_intro, cat_secs),
]

def md2html(t):
    t = t.strip()
    t = re.sub(r'^---\s*$', '', t, flags=re.M)
    return markdown.markdown(t, extensions=['tables', 'sane_lists']) if t else ''

def slug(s):
    s = s.lower()
    for a, b in (('á', 'a'), ('é', 'e'), ('í', 'i'), ('ó', 'o'), ('ú', 'u'), ('ñ', 'n'), ('ü', 'u')):
        s = s.replace(a, b)
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')

toc, cuerpo = [], []
for n, (cid, ctit, cintro, secs) in enumerate(capitulos):
    num = '' if n == 0 else f'{n}.'
    sub = []
    secs_html = []
    for k, (t, b) in enumerate(secs, 1):
        sid = f'{cid}-{slug(t)}'
        sub.append(f'<li><a href="#{sid}">{num}{k} {html.escape(t)}</a></li>')
        secs_html.append(f'<section class="mod" id="{sid}"><h3><span class="n">{num}{k}</span> {html.escape(t)}</h3>{md2html(b)}</section>')
    toc.append(f'<li><a href="#{cid}"><b>{(num + " ") if num else ""}{html.escape(ctit)}</b></a>' + (f'<ul>{"".join(sub)}</ul>' if sub else '') + '</li>')
    cuerpo.append(f'<section class="cap" id="{cid}"><h2>{(f"<span class=n>{n}</span> ") if num else ""}{html.escape(ctit)}</h2>{md2html(cintro)}{"".join(secs_html)}</section>')

hoy = datetime.date.today().strftime('%d/%m/%Y')
PAGE = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manual de uso · Visor SAR</title>
<meta name="description" content="Manual de uso y reglas del Visor Logístico SAR Elsa Romo Aravena">
<link rel="icon" href="assets/favicon-32.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{{--azul:#1A3668;--azul-o:#122650;--verde:#8CC63F;--verde-t:#4D7C0F;--rojo:#CC1B23;--naranja-t:#C2410C;--tx:#0F172A;--tx2:#64748B;--borde:#E2E8F0;--fondo:#F8F9FA;--card:#fff}}
*{{box-sizing:border-box}} html{{scroll-behavior:smooth;scroll-padding-top:72px}}
body{{margin:0;font:15px/1.6 Inter,system-ui,sans-serif;color:var(--tx);background:var(--fondo)}}
header.top{{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--azul);color:#fff}}
header.top img{{height:30px}} header.top h1{{font-size:16px;margin:0;font-weight:700;flex:1}}
header.top a,header.top button{{color:#fff;text-decoration:none;font:600 13px Inter,sans-serif;border:1px solid rgba(255,255,255,.4);background:transparent;border-radius:8px;padding:7px 12px;cursor:pointer;white-space:nowrap}}
header.top .pdf{{background:var(--verde);border-color:var(--verde);color:var(--azul-o)}}
.wrap{{display:grid;grid-template-columns:290px 1fr;max-width:1240px;margin:0 auto}}
nav.toc{{position:sticky;top:52px;height:calc(100vh - 52px);overflow:auto;padding:16px;border-right:1px solid var(--borde);background:#fff}}
nav.toc input{{width:100%;padding:9px 11px;border:1px solid var(--borde);border-radius:8px;font:14px Inter,sans-serif;margin-bottom:10px}}
nav.toc input:focus{{outline:2px solid var(--verde);border-color:var(--verde)}}
nav.toc ul{{list-style:none;margin:0;padding:0}} nav.toc li{{margin:2px 0}} nav.toc ul ul{{padding-left:12px;margin:2px 0 10px}}
nav.toc a{{color:var(--tx);text-decoration:none;font-size:13.5px;display:block;padding:3px 6px;border-radius:6px}} nav.toc a:hover{{background:#EEF2F8;color:var(--azul)}}
nav.toc b{{color:var(--azul)}}
main{{padding:24px 32px 80px;min-width:0}}
.portada{{background:linear-gradient(135deg,var(--azul-o),var(--azul) 60%,#2C5AA8);color:#fff;border-radius:16px;padding:28px;margin-bottom:24px}}
.portada h1{{margin:0 0 6px;font-size:28px;font-weight:800;letter-spacing:-.01em}} .portada p{{margin:0;opacity:.9}}
.portada .meta{{margin-top:14px;font-size:13px;opacity:.85}}
.cap{{margin-bottom:36px}} .cap>h2{{font-size:24px;font-weight:800;color:var(--azul);border-bottom:3px solid var(--verde);padding-bottom:6px;margin:28px 0 14px}}
.n{{display:inline-block;min-width:1.6em;color:var(--verde-t)}}
.mod{{background:var(--card);border:1px solid var(--borde);border-radius:12px;padding:18px 22px;margin:16px 0}}
.mod h3{{margin:0 0 10px;font-size:19px;color:var(--azul)}} h4{{color:var(--azul);margin:18px 0 6px}}
p strong:only-child{{color:var(--azul)}}
table{{border-collapse:collapse;width:100%;margin:10px 0;font-size:14px;display:block;overflow-x:auto}}
th{{background:#EEF2F8;color:var(--azul);text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em}}
th,td{{border:1px solid var(--borde);padding:7px 9px;vertical-align:top}}
code{{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;background:#F1F5F9;padding:1px 5px;border-radius:4px}}
blockquote{{margin:10px 0;padding:8px 14px;border-left:4px solid var(--verde);background:#F4FAEA;border-radius:0 8px 8px 0}}
ol li,ul li{{margin:3px 0}}
.oculto{{display:none!important}} .sinres{{color:var(--tx2);font-size:13px;padding:4px 6px}}
.menu-btn{{display:none}}
@media (max-width:860px){{
  .wrap{{grid-template-columns:1fr}} nav.toc{{position:fixed;inset:52px 0 0 0;height:auto;z-index:4;display:none}} nav.toc.abierto{{display:block}}
  .menu-btn{{display:inline-block}} main{{padding:16px}} .mod{{padding:14px 16px}} header.top h1{{font-size:14px}}
  header.top .volver{{display:none}}
}}
@media print{{
  header.top,nav.toc{{display:none}} .wrap{{display:block}} main{{padding:0}} body{{background:#fff;font-size:11pt}}
  .portada{{-webkit-print-color-adjust:exact;print-color-adjust:exact;break-after:page}} .cap{{break-before:page}} .cap#intro{{break-before:auto}}
  .mod{{break-inside:auto;border:none;padding:0;margin:14px 0}} .mod h3{{break-after:avoid}} th{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  a{{color:inherit;text-decoration:none}}
}}
</style></head>
<body>
<header class="top"><button type="button" class="menu-btn" id="mb" aria-expanded="false" aria-controls="toc">Índice</button><img src="assets/logo/marca-sobre-oscuro.svg" alt=""><h1>Manual de uso · Visor SAR</h1>
<a class="pdf" href="manual/Manual-Visor-SAR.pdf" download>Descargar PDF</a><a class="volver" href="./">Volver al Visor</a></header>
<div class="wrap">
<nav class="toc" id="toc" aria-label="Índice"><input type="search" id="q" placeholder="Buscar en el manual…" aria-label="Buscar en el manual"><p class="sinres oculto" id="sr">No hay resultados.</p><ul>{''.join(toc)}</ul></nav>
<main>
<div class="portada"><h1>Manual de uso y reglas del sitio</h1><p>Visor Logístico · SAR Arpillerista Elsa Romo Aravena</p><p class="meta">Versión del sistema {VERSION} · actualizado el {hoy}</p></div>
{''.join(cuerpo)}
</main></div>
<script>
(function(){{
  var mb=document.getElementById('mb'),toc=document.getElementById('toc');
  mb.addEventListener('click',function(){{var a=toc.classList.toggle('abierto');mb.setAttribute('aria-expanded',a);}});
  toc.addEventListener('click',function(e){{if(e.target.closest('a')&&window.innerWidth<=860){{toc.classList.remove('abierto');mb.setAttribute('aria-expanded','false');}}}});
  var q=document.getElementById('q'),mods=[].slice.call(document.querySelectorAll('.mod')),sr=document.getElementById('sr');
  var norm=function(s){{return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();}};
  var txt=mods.map(function(m){{return norm(m.textContent);}});
  q.addEventListener('input',function(){{var t=norm(q.value.trim()),n=0;
    mods.forEach(function(m,i){{var ok=!t||txt[i].indexOf(t)>=0;m.classList.toggle('oculto',!ok);if(ok)n++;
      var l=toc.querySelector('a[href="#'+m.id+'"]');if(l)l.parentNode.classList.toggle('oculto',!ok);}});
    sr.classList.toggle('oculto',n>0||!t);}});
}})();
</script>
</body></html>
"""
(R / 'manual.html').write_text(PAGE, encoding='utf-8')
print('manual.html', len(PAGE) // 1024, 'KB ·', sum(len(c[3]) for c in capitulos), 'módulos')

if '--pdf' in sys.argv:
    from playwright.sync_api import sync_playwright
    (R / 'manual').mkdir(exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        pg.goto((R / 'manual.html').as_uri()); pg.wait_for_timeout(800)
        pie = f'<div style="font:8px Inter,sans-serif;color:#64748B;width:100%;padding:0 12mm;display:flex;justify-content:space-between"><span>Manual de uso · Visor SAR · v{VERSION}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
        pg.pdf(path=str(R / 'manual' / 'Manual-Visor-SAR.pdf'), format='A4', print_background=True, margin={'top': '14mm', 'bottom': '16mm', 'left': '14mm', 'right': '14mm'},
               display_header_footer=True, header_template='<div></div>', footer_template=pie)
        b.close()
    print('manual/Manual-Visor-SAR.pdf', (R / 'manual' / 'Manual-Visor-SAR.pdf').stat().st_size // 1024, 'KB')
