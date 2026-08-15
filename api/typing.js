const { isValidSession, setTyping } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const username = req.headers['x-username'];
  const token = req.headers['x-session-token'];
  const valid = await isValidSession(username, token);
  if (!valid) return res.status(401).json({ error: 'session_invalid' });

  const { typing } = req.body || {};
  await setTyping(username, !!typing);
  res.json({ ok: true });
};
