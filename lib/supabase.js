// Este cliente usa la Service Role Key de Supabase, que ignora RLS por
// completo. SOLO se debe usar dentro de las funciones serverless de
// /api — nunca en código que corra en el navegador.

const { createClient } = require('@supabase/supabase-js');

let client = null;

function getServiceClient() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno.');
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

module.exports = { getServiceClient };
