const crypto = require('crypto');
const { getServiceClient } = require('./supabase');

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Crea una sesión nueva para `username`. Al hacer upsert sobre la fila
// existente, cualquier sesión anterior de esa cuenta queda invalidada de
// inmediato: el dispositivo viejo lo va a notar en su próximo sondeo
// (como mucho, unos segundos después) porque su token ya no coincide.
async function createSession(username) {
  const supabase = getServiceClient();
  const token = newToken();
  const { error } = await supabase
    .from('sessions')
    .upsert({ username, token, created_at: new Date().toISOString(), last_seen: new Date().toISOString() });
  if (error) throw error;
  return token;
}

async function isValidSession(username, token) {
  if (!username || !token) return false;
  const supabase = getServiceClient();
  const { data, error } = await supabase.from('sessions').select('token').eq('username', username).maybeSingle();
  if (error || !data) return false;
  return data.token === token;
}

async function destroySession(username) {
  const supabase = getServiceClient();
  await supabase.from('sessions').delete().eq('username', username);
}

async function touchSession(username) {
  const supabase = getServiceClient();
  await supabase.from('sessions').update({ last_seen: new Date().toISOString() }).eq('username', username);
}

module.exports = { createSession, isValidSession, destroySession, touchSession };
