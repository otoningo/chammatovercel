(function () {
  // El token vive en sessionStorage a propósito: sobrevive a un refresh de
  // la misma pestaña, pero desaparece al cerrar la pestaña/app. Eso es lo
  // que hace que "al volver a entrar" siempre pida contraseña de nuevo.
  const SESSION_KEY = 'nodo_session';
  const POLL_INTERVAL_MS = 2500;

  let currentUser = null;
  let currentToken = null;
  let pollTimer = null;
  let lastMessageId = 0;

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
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const kickedOverlay = document.getElementById('kickedOverlay');
  const kickedText = document.getElementById('kickedText');
  const kickedOk = document.getElementById('kickedOk');

  // Nombre aleatorio en el campo de contraseña en cada carga: dificulta que
  // un gestor de contraseñas lo reconozca como un login para ofrecer
  // guardarlo. No es garantía al 100% (Chrome/Firefox ignoran
  // autocomplete="off" a propósito), pero ayuda bastante en la práctica.
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
    return Object.assign(
      { 'x-username': currentUser, 'x-session-token': currentToken },
      extra || {}
    );
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
    thread.innerHTML = '<div class="empty-state">— cargando —</div>';
    await pollMessages(true);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => pollMessages(false), POLL_INTERVAL_MS);
    setupPush();
  }

  // ---------- sondeo: trae mensajes nuevos Y detecta si nos expulsaron ----------
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
        linkDot.classList.add('off');
        linkbarStatus.textContent = 'sin conexión…';
        return;
      }
      linkDot.classList.remove('off');
      linkbarStatus.textContent = 'conectado';

      const list = await res.json();
      if (isInitial) {
        renderMessages(list);
        lastMessageId = list.length ? list[list.length - 1].id : 0;
      } else {
        const newer = list.filter((m) => m.id > lastMessageId);
        newer.forEach(appendMessage);
        if (newer.length) lastMessageId = newer[newer.length - 1].id;
      }
    } catch (err) {
      linkDot.classList.add('off');
      linkbarStatus.textContent = 'sin conexión…';
    }
  }

  function renderMessages(list) {
    if (list.length === 0) {
      thread.innerHTML = '<div class="empty-state">— sin mensajes todavía —</div>';
      return;
    }
    thread.innerHTML = list.map(messageHtml).join('');
    thread.scrollTop = thread.scrollHeight;
  }

  function messageHtml(m) {
    const mine = m.from === currentUser;
    const time = new Date(m.ts).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
    return (
      '<div class="packet ' + (mine ? 'mine' : '') + '">' +
      '<div class="packet-head"><span class="uid">@' + escapeHtml(m.from) + '</span><span>' + time + '</span></div>' +
      '<div class="packet-body">' + escapeHtml(m.text) + '</div>' +
      '</div>'
    );
  }

  function appendMessage(m) {
    const empty = thread.querySelector('.empty-state');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.innerHTML = messageHtml(m);
    thread.appendChild(div.firstElementChild);
    thread.scrollTop = thread.scrollHeight;
  }

  // ---------- enviar ----------
  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    messageInput.value = '';
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
      if (msg.id > lastMessageId) {
        appendMessage(msg);
        lastMessageId = msg.id;
      }
    } catch (err) {
      messageInput.placeholder = 'No se pudo enviar. Intenta de nuevo.';
    }
    sendBtn.disabled = false;
  }
  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // ---------- cierre de sesión forzado (expulsado) ----------
  function forceLogout(reason) {
    clearSession();
    if (pollTimer) clearInterval(pollTimer);
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
    kickedText.textContent = reason;
    kickedOverlay.classList.add('show');
  }
  kickedOk.addEventListener('click', () => kickedOverlay.classList.remove('show'));

  // ---------- cierre de sesión manual ----------
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, token: currentToken }),
      });
    } catch (err) {}
    clearSession();
    if (pollTimer) clearInterval(pollTimer);
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
    clearMsg();
  });

  // ---------- notificaciones push (funcionan con la app cerrada) ----------
  async function setupPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const keyRes = await fetch('/api/push-key');
      const { key } = await keyRes.json();
      if (!key) return; // servidor sin VAPID configurado todavía

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

  // ---------- restaurar sesión si la pestaña se refrescó (no si se cerró) ----------
  const existing = loadSession();
  if (existing && existing.username && existing.token) {
    enterChat(existing.username, existing.token);
  }
})();
