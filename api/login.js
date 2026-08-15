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

  const supabase = getServiceClient();
  const { data: user, error } = await supabase
    .from('users')
    .select('username, password_hash')
    .eq('username', uname)
    .maybeSingle();

  if (error || !user) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  const token = await createSession(uname);
  res.json({ username: uname, token });
};
