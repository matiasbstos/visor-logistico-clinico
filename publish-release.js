/**
 * ============================================================================
 * SCRIPT AUTOMATIZADO: PROTOCOLO DE DESPLIEGUE Y PUBLICACIÓN EN GITHUB
 * ============================================================================
 * Ejecuta el protocolo obligatorio:
 * 1. Validación de sintaxis JS (node -c)
 * 2. Bump de versión para Cache Busting (sw.js e index.html)
 * 3. Commit semántico y Push a GitHub (actualización del muro / repo)
 * 4. Despliegue de producción a Firebase Hosting
 *
 * Uso:
 *   node publish-release.js "Descripción del cambio realizado"
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const commitMsg = process.argv.slice(2).join(' ') || 'Actualización y mejoras en Visor Logístico';

console.log('\n=============================================================');
console.log('🚀 INICIANDO PROTOCOLO OFICIAL DE PUBLICACIÓN Y DESPLIEGUE');
console.log('=============================================================\n');

function run(cmd, desc) {
  console.log(`▶️  ${desc}...`);
  try {
    const out = execSync(cmd, { stdio: 'inherit', encoding: 'utf-8' });
    return true;
  } catch (err) {
    console.error(`❌ Error en: ${desc}`);
    process.exit(1);
  }
}

// 1. VALIDACIÓN SINTÁCTICA JS
console.log('--- PASO 1: Comprobación de Integridad Sintáctica ---');
const filesToCheck = ['script.js', 'patch-plantillas.js', 'excelUtils.js'];
filesToCheck.forEach(file => {
  if (fs.existsSync(path.join(__dirname, file))) {
    run(`node -c "${file}"`, `Validando ${file}`);
  }
});
console.log('✅ Integridad sintáctica verificada.\n');

// 2. BUMP DE VERSIÓN PARA CACHE BUSTING
console.log('--- PASO 2: Cache Busting (sw.js e index.html) ---');
const swPath = path.join(__dirname, 'sw.js');
const indexPath = path.join(__dirname, 'index.html');

let newVersionStr = '';

if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf-8');
  const cacheMatch = swContent.match(/const\s+CACHE_NAME\s*=\s*['"]visor-logistico-v(\d+)\.(\d+)['"]/);
  if (cacheMatch) {
    const major = cacheMatch[1];
    const minor = parseInt(cacheMatch[2], 10) + 1;
    newVersionStr = `v${major}.${minor}`;
    swContent = swContent.replace(/const\s+CACHE_NAME\s*=\s*['"]visor-logistico-v\d+\.\d+['"]/, `const CACHE_NAME = 'visor-logistico-${newVersionStr}'`);
    // Reemplaza referencias ?v=... en sw.js
    swContent = swContent.replace(/\?v=\d+\.\d+/g, `?v=${major}.${minor}`);
    fs.writeFileSync(swPath, swContent, 'utf-8');
    console.log(`✅ sw.js actualizado a: ${newVersionStr}`);
  }
}

if (fs.existsSync(indexPath) && newVersionStr) {
  let indexContent = fs.readFileSync(indexPath, 'utf-8');
  const versionSimple = newVersionStr.replace('v', '');
  indexContent = indexContent.replace(/const APP_VERSION = '[\d.]+';/, `const APP_VERSION = '${versionSimple}';`);
  indexContent = indexContent.replace(/style\.css\?v=[\d.]+/g, `style.css?v=${versionSimple}`);
  indexContent = indexContent.replace(/script\.js\?v=[\d.]+/g, `script.js?v=${versionSimple}`);
  indexContent = indexContent.replace(/patch-plantillas\.js\?v=[\d.]+/g, `patch-plantillas.js?v=${versionSimple}`);
  fs.writeFileSync(indexPath, indexContent, 'utf-8');
  console.log(`✅ index.html actualizado con versión: ${versionSimple}\n`);
}

// 3. COMMIT Y PUSH A GITHUB
console.log('--- PASO 3: Sincronización con GitHub ---');
run('git add .', 'git add de archivos modificados');
try {
  run(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, 'git commit');
} catch (e) {
  console.log('ℹ️  No hay cambios nuevos pendientes de commit.');
}
run('git push origin main', 'git push a GitHub (muro de actualizaciones)');
console.log('✅ GitHub actualizado exitosamente.\n');

// 4. DESPLIEGUE A FIREBASE HOSTING
console.log('--- PASO 4: Despliegue en Producción (Firebase Hosting) ---');
run('npx firebase-tools deploy --only hosting', 'Desplegando en Firebase');
console.log('\n=============================================================');
console.log('🎉 DESPLIEGUE Y PUBLICACIÓN COMPLETADOS EXITOSAMENTE');
console.log(`📦 Versión desplegada: ${newVersionStr || 'Actual'}`);
console.log(`📝 Mensaje: ${commitMsg}`);
console.log('=============================================================\n');
