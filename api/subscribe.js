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

  const { subscription } = req.body || {};
  if (!subscription) return res.status(400).json({ error: 'subscription requerida' });

  const supabase = getServiceClient();
  const { error } = await supabase.from('push_subscriptions').upsert({ username, subscription });
  if (error) return res.status(500).json({ error: 'db_error' });

  res.json({ ok: true });
};
