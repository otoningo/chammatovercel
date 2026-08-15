// Genera un par de claves VAPID (necesarias para las notificaciones push).
// Corre esto en tu computadora una sola vez: node scripts/generate-vapid.js
// Copia el resultado a las variables de entorno de Vercel.

const webPush = require('web-push');
const keys = webPush.generateVAPIDKeys();

console.log('\nAgrega esto en Vercel (Project Settings > Environment Variables):\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}\n`);
