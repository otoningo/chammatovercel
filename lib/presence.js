const { getServiceClient } = require('./supabase');

const ONLINE_WINDOW_MS = 8000; // si hizo un sondeo hace menos de esto, se considera "en línea"
const TYPING_WINDOW_MS = 5000; // si marcó "escribiendo" hace menos de esto, se sigue mostrando

// Como esta app es siempre de exactamente 2 personas, "el otro usuario" es
// simplemente cualquier cuenta que no sea la que está pidiendo el estado.
async function getOtherUserPresence(currentUsername) {
  const supabase = getServiceClient();
  const [{ data: users }, { data: sessionsRows }] = await Promise.all([
    supabase.from('users').select('username'),
    supabase.from('sessions').select('username, last_seen, typing_at'),
  ]);

  const other = (users || []).find((u) => u.username !== currentUsername);
  if (!other) return null;

  const sessionRow = (sessionsRows || []).find((s) => s.username === other.username);
  const now = Date.now();
  const lastSeenMs = sessionRow && sessionRow.last_seen ? new Date(sessionRow.last_seen).getTime() : null;
  const typingAtMs = sessionRow && sessionRow.typing_at ? new Date(sessionRow.typing_at).getTime() : null;

  return {
    username: other.username,
    online: lastSeenMs !== null && now - lastSeenMs < ONLINE_WINDOW_MS,
    lastSeen: lastSeenMs,
    typing: typingAtMs !== null && now - typingAtMs < TYPING_WINDOW_MS,
  };
}

module.exports = { getOtherUserPresence };
