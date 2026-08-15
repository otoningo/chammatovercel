const { isValidSession, destroySession } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const { username, token } = req.body || {};
  if (username && (await isValidSession(username, token))) {
    await destroySession(username);
  }
  res.json({ ok: true });
};
