/**
 * ============================================================================
 * SCRIPT DE SINCRONIZACIÓN DE CACHÉ Y PRE-DESPLIEGUE (sync-deploy.js)
 * ============================================================================
 * Fase 5 — DevOps & Cache Busting:
 * 1. Sincroniza la versión (?v=19.00) en index.html, sw.js, importmap y patch-plantillas.js.
 * 2. Verifica el directorio "public" en firebase.json ("." = raíz del proyecto).
 *    Si "public" apunta a una subcarpeta (ej. "public" o "dist"), copia automáticamente
 *    index.html, style.css, script.js, patch-plantillas.js, visor-triaje.js,
 *    visor-adquisiciones.js, excelUtils.js, sw.js y manifest.json a dicho destino.
 * 3. Valida la sintaxis de todos los módulos JS antes del despliegue.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TARGET_VERSION = process.argv[2] || '19.00';
const rootDir = __dirname;

console.log(`\n🚀 [DevOps Sync] Iniciando sincronización de Cache Busting a ?v=${TARGET_VERSION}...`);

// 1. Actualizar index.html
const indexPath = path.join(rootDir, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');

// Actualizar APP_VERSION y bloque de invalidación de caché en caliente
const headScriptBlock = `<head>
    <script type="importmap">
        {
            "imports": {
                "./script.js": "./script.js?v=${TARGET_VERSION}",
                "./excelUtils.js": "./excelUtils.js?v=${TARGET_VERSION}"
            }
        }
    </script>
    <script>
        const APP_VERSION = '${TARGET_VERSION}';
        if (localStorage.getItem('APP_VERSION') !== APP_VERSION) {
            localStorage.setItem('APP_VERSION', APP_VERSION);
            const cleanupPromises = [];
            if ('serviceWorker' in navigator) {
                cleanupPromises.push(
                    navigator.serviceWorker.getRegistrations().then(regs =>
                        Promise.all(regs.map(reg => reg.unregister()))
                    )
                );
            }
            if ('caches' in window) {
                cleanupPromises.push(
                    caches.keys().then(keys =>
                        Promise.all(keys.map(key => caches.delete(key)))
                    )
                );
            }
            if ('indexedDB' in window) {
                try {
                    indexedDB.deleteDatabase('firestore/[DEFAULT]/sarinventario/main');
                } catch (e) {}
            }
            Promise.allSettled(cleanupPromises).then(() => {
                if (!sessionStorage.getItem('SAR_FORCE_RELOAD_' + APP_VERSION)) {
                    sessionStorage.setItem('SAR_FORCE_RELOAD_' + APP_VERSION, '1');
                    window.location.reload();
                }
            });
            console.log('Cache Busting forzado aplicado exitosamente:', APP_VERSION);
        }

        window.addEventListener('error', function (ev) {
            const msg = String((ev && (ev.message || (ev.error && ev.error.message))) || '');
            if (msg.includes('INTERNAL ASSERTION FAILED')) {
                ev.stopImmediatePropagation();
                ev.preventDefault();
                if (!sessionStorage.getItem('SAR_FS_IDB_RECOVERED_' + APP_VERSION)) {
                    sessionStorage.setItem('SAR_FS_IDB_RECOVERED_' + APP_VERSION, '1');
                    try {
                        indexedDB.deleteDatabase('firestore/[DEFAULT]/sarinventario/main');
                    } catch (e) {}
                    setTimeout(() => window.location.reload(), 150);
                }
            }
        }, true);
    </script>`;

indexHtml = indexHtml.replace(/<head>\s*<script type="importmap">[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/, headScriptBlock);
indexHtml = indexHtml.replace(/style\.css\?v=[\w.-]+/g, `style.css?v=${TARGET_VERSION}`);
indexHtml = indexHtml.replace(/script\.js\?v=[\w.-]+/g, `script.js?v=${TARGET_VERSION}`);
indexHtml = indexHtml.replace(/patch-plantillas\.js\?v=[\w.-]+/g, `patch-plantillas.js?v=${TARGET_VERSION}`);
indexHtml = indexHtml.replace(/visor-triaje\.js\?v=[\w.-]+/g, `visor-triaje.js?v=${TARGET_VERSION}`);
indexHtml = indexHtml.replace(/visor-adquisiciones\.js\?v=[\w.-]+/g, `visor-adquisiciones.js?v=${TARGET_VERSION}`);

// Agregar botón de acceso directo al nuevo ERP en la cabecera del Panel de Control si no existe aún
if (!indexHtml.includes('id="btn-goto-erp-adquisiciones"')) {
    indexHtml = indexHtml.replace(
        '<button class="btn btn-primary" id="btn-ia-analisis">',
        `<button type="button" class="btn" id="btn-goto-erp-adquisiciones" onclick="const item = document.querySelector('.menu-item[data-target=\\'view-erp-adquisiciones\\']'); if(item) item.click();" style="background-color:#1A3668; color:#ffffff; font-weight:700; border-radius:8px 8px 8px 0px; border:none; padding:10px 16px; display:inline-flex; align-items:center; gap:8px; cursor:pointer; box-shadow:0 4px 12px rgba(26,54,104,0.22);">
                                <i class="ph-bold ph-kanban"></i> Abrir Visor ERP (Nuevo)
                            </button>
                            <button class="btn btn-primary" id="btn-ia-analisis">`
    );
}

fs.writeFileSync(indexPath, indexHtml, 'utf8');
console.log(`✅ index.html actualizado con sufijos ?v=${TARGET_VERSION}`);

// 2. Actualizar patch-plantillas.js
const patchPath = path.join(rootDir, 'patch-plantillas.js');
if (fs.existsSync(patchPath)) {
    let patchContent = fs.readFileSync(patchPath, 'utf8');
    patchContent = patchContent.replace(
        /import\s+\{\s*db,\s*auth\s*\}\s+from\s+['"]\.\/script\.js(\?v=[\w.-]+)?['"];/,
        `import { db, auth } from './script.js?v=${TARGET_VERSION}';`
    );
    fs.writeFileSync(patchPath, patchContent, 'utf8');
    console.log(`✅ patch-plantillas.js sincronizado con ./script.js?v=${TARGET_VERSION}`);
}

// 3. Actualizar sw.js
const swPath = path.join(rootDir, 'sw.js');
if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    swContent = swContent.replace(/visor-logistico-v[\w.-]+/g, `visor-logistico-v${TARGET_VERSION}`);
    swContent = swContent.replace(/\?v=[\w.-]+/g, `?v=${TARGET_VERSION}`);
    fs.writeFileSync(swPath, swContent, 'utf8');
    console.log(`✅ sw.js actualizado a CACHE_NAME = 'visor-logistico-v${TARGET_VERSION}'`);
}

// 4. Verificar firebase.json y copiar archivos si "public" es distinto de "."
const fbConfigPath = path.join(rootDir, 'firebase.json');
if (fs.existsSync(fbConfigPath)) {
    const fbConfig = JSON.parse(fs.readFileSync(fbConfigPath, 'utf8'));
    const publicDir = (fbConfig.hosting && fbConfig.hosting.public) || '.';
    const resolvedPublic = path.resolve(rootDir, publicDir);

    console.log(`📂 Directorio "public" en firebase.json: "${publicDir}" (${resolvedPublic})`);

    if (resolvedPublic !== rootDir) {
        if (!fs.existsSync(resolvedPublic)) {
            fs.mkdirSync(resolvedPublic, { recursive: true });
        }
        const assetsToCopy = [
            'index.html',
            'style.css',
            'script.js',
            'patch-plantillas.js',
            'visor-triaje.js',
            'visor-adquisiciones.js',
            'excelUtils.js',
            'sw.js',
            'manifest.json'
        ];
        assetsToCopy.forEach(file => {
            const src = path.join(rootDir, file);
            const dest = path.join(resolvedPublic, file);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, dest);
                console.log(`   -> Copiado ${file} a ${publicDir}/`);
            }
        });
    } else {
        console.log('ℹ️  El directorio "public" es la raíz ("."). Los archivos estáticos ya están en la ruta de distribución.');
    }
}

// 5. Validar sintaxis JS
['script.js', 'patch-plantillas.js', 'visor-triaje.js', 'visor-adquisiciones.js', 'excelUtils.js'].forEach(file => {
    const full = path.join(rootDir, file);
    if (fs.existsSync(full)) {
        execSync(`node -c "${full}"`, { stdio: 'inherit' });
    }
});
console.log(`✅ Validación sintáctica completada sin errores (v${TARGET_VERSION}).\n`);
