const { isValidSession } = require('../lib/auth');
const { createUploadUrl } = require('../lib/storage');

const MAX_NAME_LENGTH = 180;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const username = req.headers['x-username'];
  const token = req.headers['x-session-token'];
  const valid = await isValidSession(username, token);
  if (!valid) return res.status(401).json({ error: 'session_invalid' });

  const fileName = String((req.body || {}).fileName || 'archivo').slice(0, MAX_NAME_LENGTH);

  try {
    const { path, signedUrl, token: uploadToken } = await createUploadUrl(username, fileName);
    res.json({ path, signedUrl, uploadToken });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo preparar la subida.' });
  }
};
