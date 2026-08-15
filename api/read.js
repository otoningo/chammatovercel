const { getServiceClient } = require('../lib/supabase');
const { isValidSession } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const username = req.headers['x-username'];
  const token = req.headers['x-session-token'];
  const valid = await isValidSession(username, token);
  if (!valid) return res.status(401).json({ error: 'session_invalid' });

  const upToId = Number((req.body || {}).upToId);
  if (!upToId || Number.isNaN(upToId)) return res.status(400).json({ error: 'upToId requerido' });

  const supabase = getServiceClient();
  // Marca como leídos los mensajes que NO son míos, hasta ese id, que
  // todavía no tuvieran fecha de lectura.
  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .neq('from_user', username)
    .lte('id', upToId)
    .is('read_at', null);

  res.json({ ok: true });
};
