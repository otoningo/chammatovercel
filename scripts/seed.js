// Crea o actualiza una cuenta directamente en Supabase. Corre esto en TU
// computadora (no en Vercel) — necesita las mismas variables de entorno
// que configuraste en Vercel (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
// puestas en un archivo .env local. No existe endpoint público de
// registro a propósito.
//
// Uso:
//   node scripts/seed.js
// y sigue las instrucciones. Ejecútalo dos veces, una por cada persona.

require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { getServiceClient } = require('../lib/supabase');

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n== Nodo · crear cuenta (Supabase) ==\n');
  const username = (await ask(rl, 'Usuario (sin espacios): ')).trim().toLowerCase();
  if (!username || /\s/.test(username)) {
    console.error('Usuario inválido.');
    rl.close();
    process.exit(1);
  }
  const password = (await ask(rl, 'Contraseña (mínimo 8 caracteres): ')).trim();
  if (!password || password.length < 8) {
    console.error('La contraseña debe tener al menos 8 caracteres.');
    rl.close();
    process.exit(1);
  }

  const supabase = getServiceClient();
  const hash = await bcrypt.hash(password, 12);

  const { data: existingUsers, error: listErr } = await supabase.from('users').select('username');
  if (listErr) {
    console.error('Error consultando Supabase:', listErr.message);
    rl.close();
    process.exit(1);
  }

  if ((existingUsers || []).length >= 2 && !existingUsers.some((u) => u.username === username)) {
    const proceed = (
      await ask(
        rl,
        `\nYa hay ${existingUsers.length} cuentas (${existingUsers.map((u) => u.username).join(', ')}). ¿Agregar otra de todos modos? (s/N): `
      )
    )
      .trim()
      .toLowerCase();
    if (proceed !== 's') {
      console.log('Cancelado.');
      rl.close();
      process.exit(0);
    }
  }

  const { error } = await supabase.from('users').upsert({ username, password_hash: hash });
  if (error) {
    console.error('Error guardando en Supabase:', error.message);
    rl.close();
    process.exit(1);
  }

  console.log(`\nListo: cuenta "${username}" creada/actualizada en Supabase.`);
  rl.close();
}

main();
