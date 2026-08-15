(function () {
  const SESSION_KEY = 'nodo_session';
  const POLL_INTERVAL_MS = 2500;
  const POLL_MAX_BACKOFF_MS = 12000;
  const TYPING_SEND_THROTTLE_MS = 2000;
  const TYPING_STOP_AFTER_MS = 3000;

  let currentUser = null;
  let currentToken = null;
  let pollTimer = null;
  let pollBackoff = POLL_INTERVAL_MS;
  let consecutiveFailures = 0;
  let lastMessageId = 0;
  let messagesById = new Map();
  let lastTypingSentAt = 0;
  let typingStopTimer = null;

  const authScreen = document.getElementById('authScreen');
  const chatScreen = document.getElementById('chatScreen');
  const linkbar = document.getElementById('linkbar');
  const linkDot = document.getElementById('linkDot');
  const linkbarStatus = document.getElementById('linkbarStatus');
  const authMsg = document.getElementById('authMsg');
  const authSubmit = document.getElementById('authSubmit');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const thread = document.getElementById('thread');
  const typingIndicator = document.getElementById('typingIndicator');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const kickedOverlay = document.getElementById('kickedOverlay');
  const kickedText = document.getElementById('kickedText');
  const kickedOk = document.getElementById('kickedOk');

  // Nombre aleatorio en el campo de contraseña en cada carga: dificulta que
  // un gestor de contraseñas lo reconozca como un login para ofrecer
  // guardarlo.
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  passwordInput.name = 'f_' + randomSuffix;
  usernameInput.name = 'u_' + randomSuffix;

  function showMsg(text, type) {
    authMsg.innerHTML = '<div class="msg-inline ' + type + '">' + text + '</div>';
  }
  function clearMsg() {
    authMsg.innerHTML = '';
  }
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function saveSession(username, token) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ username, token }));
  }
  function loadSession() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch (err) {
      return null;
    }
  }
  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function authHeaders(extra) {
    return Object.assign({ 'x-username': currentUser, 'x-session-token': currentToken }, extra || {});
  }

  // ---------- login ----------
  async function doLogin() {
    clearMsg();
    const username = usernameInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!username || !password) return;
    authSubmit.disabled = true;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error || 'No se pudo iniciar sesión.', 'error');
        authSubmit.disabled = false;
        return;
      }
      passwordInput.value = '';
      saveSession(data.username, data.token);
      await enterChat(data.username, data.token);
    } catch (err) {
      showMsg('No se pudo conectar con el servidor.', 'error');
    }
    authSubmit.disabled = false;
  }
  authSubmit.addEventListener('click', doLogin);
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  // ---------- entrar al chat ----------
  async function enterChat(username, token) {
    currentUser = username;
    currentToken = token;
    authScreen.style.display = 'none';
    linkbar.style.display = 'flex';
    document.getElementById('linkbarUser').textContent = '@' + username;
    chatScreen.classList.add('active');
    kickedOverlay.classList.remove('show');
    messageInput.disabled = false;
    sendBtn.disabled = false;

    lastMessageId = 0;
    messagesById = new Map();
    thread.innerHTML = '<div class="empty-state">— cargando —</div>';
    pollBackoff = POLL_INTERVAL_MS;
    consecutiveFailures = 0;
    await pollMessages(true);
    schedulePoll();
    setupPush();
  }

  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => pollMessages(false).then(schedulePoll), pollBackoff);
  }

  // ---------- sondeo: mensajes + presencia, y detecta si nos expulsaron ----------
  async function pollMessages(isInitial) {
    try {
      const res = await fetch('/api/messages', { headers: authHeaders() });
      if (res.status === 401) {
        forceLogout(
          'Se inició sesión con este usuario desde otro dispositivo, o tu sesión expiró. Solo se permite una sesión activa a la vez.'
        );
        return;
      }
      if (!res.ok) {
        handlePollFailure();
        return;
      }
      const payload = await res.json();
      if (!payload || !Array.isArray(payload.messages)) {
        handlePollFailure();
        return;
      }

      consecutiveFailures = 0;
      pollBackoff = POLL_INTERVAL_MS;
      linkDot.classList.remove('off');
      hideConnErrorBanner();

      applyMessages(payload.messages, isInitial);
      applyPresence(payload.presence);
      maybeMarkRead(payload.messages);
    } catch (err) {
      handlePollFailure();
    }
  }

  function handlePollFailure() {
    consecutiveFailures += 1;
    linkDot.classList.add('off');
    pollBackoff = Math.min(pollBackoff * 1.6, POLL_MAX_BACKOFF_MS);
    if (consecutiveFailures >= 3) {
      showConnErrorBanner();
    }
  }

  function showConnErrorBanner() {
    let banner = document.getElementById('connErrorBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'connErrorBanner';
      banner.className = 'msg-inline error';
      banner.style.margin = '10px 16px 0';
      banner.textContent = 'No se pudo conectar con el servidor. Reintentando…';
      chatScreen.insertBefore(banner, thread);
    }
  }
  function hideConnErrorBanner() {
    const banner = document.getElementById('connErrorBanner');
    if (banner) banner.remove();
  }

  // ---------- presencia (en línea / última vez / escribiendo) ----------
  function applyPresence(presence) {
    if (!presence) {
      linkbarStatus.textContent = 'conectado';
      typingIndicator.style.display = 'none';
      return;
    }
    if (presence.typing) {
      typingIndicator.style.display = 'block';
    } else {
      typingIndicator.style.display = 'none';
    }
    if (presence.online) {
      linkbarStatus.innerHTML = '@' + escapeHtml(presence.username) + ' <span class="presence-online">en línea</span>';
    } else if (presence.lastSeen) {
      const d = new Date(presence.lastSeen);
      const today = new Date();
      const sameDay = d.toDateString() === today.toDateString();
      const label = sameDay
        ? d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit' }) +
          ' ' +
          d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
      linkbarStatus.innerHTML =
        '@' + escapeHtml(presence.username) + ' <span class="presence-offline">últ. vez ' + label + '</span>';
    } else {
      linkbarStatus.textContent = '@' + presence.username + ' sin conectarse todavía';
    }
  }

  // ---------- leído: si la pestaña está enfocada, marca lo que llegó como leído ----------
  function maybeMarkRead(list) {
    if (!document.hasFocus()) return;
    const fromOther = list.filter((m) => m.from !== currentUser && !m.readAt);
    if (fromOther.length === 0) return;
    const upToId = Math.max(...fromOther.map((m) => m.id));
    fetch('/api/read', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ upToId }),
    }).catch(() => {});
  }

  // ---------- render de mensajes ----------
  function applyMessages(list, isInitial) {
    let changed = false;
    for (const m of list) {
      const prev = messagesById.get(m.id);
      if (!prev || prev.text !== m.text || prev.editedAt !== m.editedAt || prev.deliveredAt !== m.deliveredAt || prev.readAt !== m.readAt) {
        messagesById.set(m.id, m);
        changed = true;
      }
      if (m.id > lastMessageId) lastMessageId = m.id;
    }
    if (isInitial || changed) {
      renderAll();
    }
  }

  function renderAll() {
    const list = Array.from(messagesById.values()).sort((a, b) => a.id - b.id);
    if (list.length === 0) {
      thread.innerHTML = '<div class="empty-state">— sin mensajes todavía —</div>';
      return;
    }
    const wasNearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
    thread.innerHTML = list.map(messageHtml).join('');
    attachMessageHandlers();
    if (wasNearBottom) thread.scrollTop = thread.scrollHeight;
  }

  function ticksHtml(m) {
    if (m.from !== currentUser) return '';
    let cls = 'sent';
    let icon = '✓';
    if (m.readAt) {
      cls = 'read';
      icon = '✓✓';
    } else if (m.deliveredAt) {
      cls = 'delivered';
      icon = '✓✓';
    }
    return '<span class="ticks ' + cls + '">' + icon + '</span>';
  }

  function messageHtml(m) {
    const mine = m.from === currentUser;
    const time = new Date(m.ts).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
    return (
      '<div class="packet ' + (mine ? 'mine' : '') + '" data-id="' + m.id + '">' +
      '<div class="packet-head"><span class="uid">@' + escapeHtml(m.from) + '</span><span>' + time + '</span></div>' +
      '<div class="packet-body' + (mine ? ' editable' : '') + '" data-id="' + m.id + '">' + escapeHtml(m.text) + '</div>' +
      '<div class="packet-meta">' +
      (m.editedAt ? '<span class="edited-tag">editado</span>' : '') +
      ticksHtml(m) +
      '</div>' +
      '</div>'
    );
  }

  function attachMessageHandlers() {
    thread.querySelectorAll('.packet-body.editable').forEach((el) => {
      el.addEventListener('click', () => startEdit(Number(el.dataset.id)));
    });
  }

  // ---------- editar mensaje propio ----------
  function startEdit(id) {
    if (thread.querySelector('.edit-box')) return; // ya hay una edición en curso
    const m = messagesById.get(id);
    if (!m || m.from !== currentUser) return;
    const packet = thread.querySelector('.packet[data-id="' + id + '"] .packet-body');
    if (!packet) return;

    const original = m.text;
    packet.innerHTML =
      '<div class="edit-box">' +
      '<input type="text" value="' + escapeHtml(original) + '" maxlength="4000">' +
      '<button class="save-btn">Guardar</button>' +
      '<button class="cancel-btn">Cancelar</button>' +
      '</div>';
    const input = packet.querySelector('input');
    const saveBtn = packet.querySelector('.save-btn');
    const cancelBtn = packet.querySelector('.cancel-btn');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    function cancel() {
      renderAll();
    }
    saveBtn.addEventListener('click', () => submitEdit(id, input.value));
    cancelBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitEdit(id, input.value);
      if (e.key === 'Escape') cancel();
    });
  }

  async function submitEdit(id, newText) {
    const clean = newText.trim();
    if (!clean) return;
    try {
      const res = await fetch('/api/messages', {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id, text: clean }),
      });
      if (res.status === 401) {
        forceLogout('Se inició sesión con este usuario desde otro dispositivo, o tu sesión expiró.');
        return;
      }
      if (!res.ok) {
        renderAll();
        return;
      }
      const updated = await res.json();
      messagesById.set(updated.id, updated);
      renderAll();
    } catch (err) {
      renderAll();
    }
  }

  // ---------- enviar ----------
  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    messageInput.value = '';
    sendTyping(false);
    sendBtn.disabled = true;
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text }),
      });
      if (res.status === 401) {
        forceLogout('Se inició sesión con este usuario desde otro dispositivo, o tu sesión expiró.');
        return;
      }
      const msg = await res.json();
      messagesById.set(msg.id, msg);
      if (msg.id > lastMessageId) lastMessageId = msg.id;
      renderAll();
    } catch (err) {
      messageInput.placeholder = 'No se pudo enviar. Intenta de nuevo.';
    }
    sendBtn.disabled = false;
  }
  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // ---------- "escribiendo…" ----------
  function sendTyping(isTyping) {
    if (!currentUser) return;
    fetch('/api/typing', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ typing: isTyping }),
    }).catch(() => {});
  }
  messageInput.addEventListener('input', () => {
    const now = Date.now();
    if (now - lastTypingSentAt > TYPING_SEND_THROTTLE_MS) {
      lastTypingSentAt = now;
      sendTyping(true);
    }
    if (typingStopTimer) clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(() => sendTyping(false), TYPING_STOP_AFTER_MS);
  });

  // ---------- cierre de sesión forzado (expulsado) ----------
  function forceLogout(reason) {
    clearSession();
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    currentUser = null;
    currentToken = null;
    linkbar.style.display = 'none';
    chatScreen.classList.remove('active');
    messageInput.disabled = true;
    sendBtn.disabled = true;
    authScreen.style.display = 'block';
    usernameInput.value = '';
    passwordInput.value = '';
    hideConnErrorBanner();
    kickedText.textContent = reason;
    kickedOverlay.classList.add('show');
  }
  kickedOk.addEventListener('click', () => kickedOverlay.classList.remove('show'));

  // ---------- cierre de sesión manual ----------
  logoutBtn.addEventListener('click', async () => {
    sendTyping(false);
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, token: currentToken }),
      });
    } catch (err) {}
    clearSession();
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    currentUser = null;
    currentToken = null;
    linkbar.style.display = 'none';
    chatScreen.classList.remove('active');
    messageInput.disabled = true;
    sendBtn.disabled = true;
    authScreen.style.display = 'block';
    usernameInput.value = '';
    passwordInput.value = '';
    hideConnErrorBanner();
    clearMsg();
  });

  // ---------- notificaciones push (funcionan con la app cerrada) ----------
  async function setupPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const keyRes = await fetch('/api/push-key');
      const { key } = await keyRes.json();
      if (!key) return;

      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }
      if (permission !== 'granted') return;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
      }
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ subscription: sub }),
      });
    } catch (err) {
      console.warn('[push] no se pudo activar:', err);
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // marcar leído también cuando la pestaña recupera el foco, sin esperar al próximo sondeo
  window.addEventListener('focus', () => {
    if (currentUser) maybeMarkRead(Array.from(messagesById.values()));
  });

  // ---------- restaurar sesión si la pestaña se refrescó (no si se cerró) ----------
  const existing = loadSession();
  if (existing && existing.username && existing.token) {
    enterChat(existing.username, existing.token);
  }
})();
