const webPush = require('web-push');
const { getServiceClient } = require('../lib/supabase');
const { isValidSession, touchSession } = require('../lib/auth');
const { getOtherUserPresence } = require('../lib/presence');

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
// asumimos que tiene el chat abierto y no le mandamos push.
const ACTIVE_WINDOW_MS = 12000;

function serializeMessage(m) {
  return {
    id: m.id,
    from: m.from_user,
    text: m.text,
    ts: new Date(m.ts).getTime(),
    editedAt: m.edited_at ? new Date(m.edited_at).getTime() : null,
    deliveredAt: m.delivered_at ? new Date(m.delivered_at).getTime() : null,
    readAt: m.read_at ? new Date(m.read_at).getTime() : null,
  };
}

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

    // Marcar como "entregados" los mensajes del otro usuario que todavía no
    // lo estaban: si estás pidiendo el historial, es porque tu app los
    // recibió.
    await supabase
      .from('messages')
      .update({ delivered_at: new Date().toISOString() })
      .neq('from_user', username)
      .is('delivered_at', null);

    const [{ data, error }, presence] = await Promise.all([
      supabase.from('messages').select('*').order('id', { ascending: true }).limit(300),
      getOtherUserPresence(username),
    ]);
    if (error) return res.status(500).json({ error: 'db_error' });

    return res.json({ messages: data.map(serializeMessage), presence });
  }

  if (req.method === 'POST') {
    const text = String((req.body || {}).text || '').slice(0, 4000).trim();
    if (!text) return res.status(400).json({ error: 'empty' });

    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({ from_user: username, text })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: 'db_error' });

    // Al mandar, ya dejamos de "escribiendo" del lado del remitente.
    await supabase.from('sessions').update({ typing_at: null }).eq('username', username);

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

    return res.json(serializeMessage(inserted));
  }

  if (req.method === 'PATCH') {
    const { id, text } = req.body || {};
    const clean = String(text || '').slice(0, 4000).trim();
    if (!id || !clean) return res.status(400).json({ error: 'id y text requeridos' });

    // Solo puedes editar tus propios mensajes.
    const { data: existing, error: findErr } = await supabase
      .from('messages')
      .select('id, from_user')
      .eq('id', id)
      .maybeSingle();
    if (findErr || !existing) return res.status(404).json({ error: 'not_found' });
    if (existing.from_user !== username) return res.status(403).json({ error: 'forbidden' });

    const { data: updated, error } = await supabase
      .from('messages')
      .update({ text: clean, edited_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: 'db_error' });

    return res.json(serializeMessage(updated));
  }

  return res.status(405).json({ error: 'method_not_allowed' });
};
