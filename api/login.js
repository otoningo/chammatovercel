const bcrypt = require('bcryptjs');
const { getServiceClient } = require('../lib/supabase');
const { createSession } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });
  }
  const uname = String(username).trim().toLowerCase();

  // --- DEBUG TEMPORAL: quitar este bloque una vez resuelto el problema ---
  console.log('[debug login] uname=%s', JSON.stringify(uname));
  console.log('[debug login] SUPABASE_URL=%s', process.env.SUPABASE_URL || '(vacío)');
  console.log('[debug login] SUPABASE_SERVICE_ROLE_KEY presente=%s largo=%s prefijo=%s',
    !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.length : 0,
    process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.slice(0, 10) : '');
  // --- fin bloque debug ---

  const supabase = getServiceClient();
  const { data: user, error } = await supabase
    .from('users')
    .select('username, password_hash')
    .eq('username', uname)
    .maybeSingle();

  // --- DEBUG TEMPORAL ---
  console.log('[debug login] error de Supabase=%s', error ? JSON.stringify(error) : 'ninguno');
  console.log('[debug login] usuario encontrado=%s', !!user);
  if (user) {
    console.log('[debug login] hash guardado (primeros 15 chars)=%s', user.password_hash.slice(0, 15));
  }
  // --- fin bloque debug ---

  if (error || !user) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);

  // --- DEBUG TEMPORAL ---
  console.log('[debug login] bcrypt.compare resultado=%s', ok);
  // --- fin bloque debug ---

  if (!ok) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  const token = await createSession(uname);
  res.json({ username: uname, token });
};

