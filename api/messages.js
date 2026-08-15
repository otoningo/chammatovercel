const webPush = require('web-push');
const { getServiceClient } = require('../lib/supabase');
const { isValidSession, touchSession } = require('../lib/auth');

function setupVapidIfConfigured() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    return true;
  }
  return false;
}

// Si el destinatario hizo un sondeo (GET) hace menos de este tiempo,
// asumimos que tiene el chat abierto y no le mandamos push — ya lo va a
// ver solo. Si no, le mandamos la notificación del sistema.
const ACTIVE_WINDOW_MS = 12000;

module.exports = async (req, res) => {
  const username = req.headers['x-username'];
  const token = req.headers['x-session-token'];

  const valid = await isValidSession(username, token);
  if (!valid) {
    return res.status(401).json({ error: 'session_invalid' });
  }

  const supabase = getServiceClient();

  if (req.method === 'GET') {
    await touchSession(username);
    const { data, error } = await supabase
      .from('messages')
      .select('id, from_user, text, ts')
      .order('id', { ascending: true })
      .limit(200);
    if (error) return res.status(500).json({ error: 'db_error' });
    return res.json(data.map((m) => ({ id: m.id, from: m.from_user, text: m.text, ts: new Date(m.ts).getTime() })));
  }

  if (req.method === 'POST') {
    const text = String((req.body || {}).text || '').slice(0, 4000).trim();
    if (!text) return res.status(400).json({ error: 'empty' });

    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({ from_user: username, text })
      .select('id, from_user, text, ts')
      .single();
    if (error) return res.status(500).json({ error: 'db_error' });

    // Empujar notificación push a quien no esté activo ahora mismo.
    // A propósito no va ni el remitente ni el texto en la notificación:
    // solo "tienes un mensaje nuevo", nada visible en la pantalla bloqueada.
    if (setupVapidIfConfigured()) {
      try {
        const [{ data: users }, { data: sessionsRows }, { data: subs }] = await Promise.all([
          supabase.from('users').select('username'),
          supabase.from('sessions').select('username, last_seen'),
          supabase.from('push_subscriptions').select('username, subscription'),
        ]);
        const now = Date.now();
        for (const u of users || []) {
          if (u.username === username) continue;
          const sessionRow = (sessionsRows || []).find((s) => s.username === u.username);
          const lastSeenMs = sessionRow && sessionRow.last_seen ? new Date(sessionRow.last_seen).getTime() : 0;
          if (now - lastSeenMs < ACTIVE_WINDOW_MS) continue; // probablemente viendo el chat
          const subRow = (subs || []).find((s) => s.username === u.username);
          if (!subRow) continue;
          try {
            await webPush.sendNotification(
              subRow.subscription,
              JSON.stringify({ title: 'Nodo', body: 'Tienes un mensaje nuevo.' })
            );
          } catch (pushErr) {
            // suscripción vencida u otro fallo puntual: no es crítico
          }
        }
      } catch (notifyErr) {
        // el mensaje ya se guardó; un fallo en el push no debe romper el envío
      }
    }

    return res.json({ id: inserted.id, from: inserted.from_user, text: inserted.text, ts: new Date(inserted.ts).getTime() });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
};
