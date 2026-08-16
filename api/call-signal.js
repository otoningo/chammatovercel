const { getServiceClient } = require('../lib/supabase');
const { isValidSession } = require('../lib/auth');

const ALLOWED_TYPES = ['offer', 'answer', 'candidate', 'hangup', 'ring'];

module.exports = async (req, res) => {
  const username = req.headers['x-username'];
  const token = req.headers['x-session-token'];
  const valid = await isValidSession(username, token);
  if (!valid) return res.status(401).json({ error: 'session_invalid' });

  const supabase = getServiceClient();

  if (req.method === 'POST') {
    const { type, payload, toUser } = req.body || {};
    if (!ALLOWED_TYPES.includes(type) || !toUser) {
      return res.status(400).json({ error: 'type y toUser requeridos' });
    }
    const { error } = await supabase
      .from('call_signals')
      .insert({ from_user: username, to_user: toUser, type, payload: payload || null });
    if (error) return res.status(500).json({ error: 'db_error' });
    return res.json({ ok: true });
  }

  if (req.method === 'GET') {
    const sinceId = Number(req.query && req.query.sinceId) || 0;
    const { data, error } = await supabase
      .from('call_signals')
      .select('*')
      .eq('to_user', username)
      .gt('id', sinceId)
      .order('id', { ascending: true })
      .limit(50);
    if (error) return res.status(500).json({ error: 'db_error' });

    return res.json({
      signals: (data || []).map((s) => ({ id: s.id, from: s.from_user, type: s.type, payload: s.payload })),
    });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
};
