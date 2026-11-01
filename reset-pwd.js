/**
 * Restablece la contraseña de un usuario de Firebase Authentication.
 *
 * Uso (PowerShell):
 *   $env:RESET_EMAIL="usuario@dominio.cl"; $env:RESET_PASSWORD="<nueva-clave>"; node reset-pwd.js
 * Uso (bash):
 *   RESET_EMAIL="usuario@dominio.cl" RESET_PASSWORD="<nueva-clave>" node reset-pwd.js
 *
 * Credenciales de administración: archivo serviceAccountKey.json (ignorado por Git)
 * o la ruta indicada en GOOGLE_SERVICE_ACCOUNT.
 *
 * NUNCA escribas el correo ni la contraseña dentro de este archivo.
 */
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const email = process.env.RESET_EMAIL;
const password = process.env.RESET_PASSWORD;

if (!email || !password) {
  console.error('Faltan RESET_EMAIL y/o RESET_PASSWORD (variables de entorno). Nada se modificó.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('La contraseña debe tener al menos 12 caracteres. Nada se modificó.');
  process.exit(1);
}

const keyPath = path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT || './serviceAccountKey.json');
const serviceAccount = require(keyPath);

initializeApp({ credential: cert(serviceAccount) });

async function run() {
  try {
    const user = await getAuth().getUserByEmail(email);
    await getAuth().updateUser(user.uid, { password });
    console.log('Contraseña actualizada para el usuario', user.uid);
    process.exit(0);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
run();
