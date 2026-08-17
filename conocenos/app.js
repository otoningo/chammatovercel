(function () {
  const SESSION_KEY = 'nodo_session';
  const POLL_INTERVAL_MS = 2500;
  const POLL_MAX_BACKOFF_MS = 12000;
  const CALL_POLL_INTERVAL_MS = 2000;
  const TYPING_SEND_THROTTLE_MS = 2000;
  const TYPING_STOP_AFTER_MS = 3000;
  const RTC_CONFIG = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
  };

  let currentUser = null;
  let currentToken = null;
  let otherUsername = null;
  let pollTimer = null;
  let pollBackoff = POLL_INTERVAL_MS;
  let consecutiveFailures = 0;
  let lastMessageId = 0;
  let messagesById = new Map();
  let lastTypingSentAt = 0;
  let typingStopTimer = null;
  let uploadConfig = null;

  // --- estado de llamada ---
  let callPollTimer = null;
  let lastSignalId = 0;
  let pc = null;
  let localStream = null;
  let callState = 'idle'; // idle | calling | ringing | connected
  let pendingOffer = null;
  let pendingCandidates = [];
  let micOn = true;
  let camOn = true;

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
  const fileInput = document.getElementById('fileInput');
  const attachBtn = document.getElementById('attachBtn');
  const voiceBtn = document.getElementById('voiceBtn');
  const callBtn = document.getElementById('callBtn');
  const uploadProgress = document.getElementById('uploadProgress');

  const callOverlay = document.getElementById('callOverlay');
  const callStatus = document.getElementById('callStatus');
  const remoteVideo = document.getElementById('remoteVideo');
  const localVideo = document.getElementById('localVideo');
  const muteBtn = document.getElementById('muteBtn');
  const camBtn = document.getElementById('camBtn');
  const hangupBtn = document.getElementById('hangupBtn');
  const incomingCall = document.getElementById('incomingCall');
  const incomingText = document.getElementById('incomingText');
  const acceptCallBtn = document.getElementById('acceptCallBtn');
  const rejectCallBtn = document.getElementById('rejectCallBtn');

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
    fetchUploadConfig();
    startCallPolling();
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
    if (consecutiveFailures >= 3) showConnErrorBanner();
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
    otherUsername = presence.username;
    typingIndicator.style.display = presence.typing ? 'block' : 'none';

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

  // ---------- leído ----------
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

  // ---------- render de mensajes: incremental, nunca destruye lo que ya existe ----------
  // Cada mensaje se crea UNA sola vez como nodo del DOM. En sondeos
  // posteriores, si ese mensaje ya existía, solo se actualiza su
  // "packet-meta" (check de leído, etiqueta de editado) — nunca se toca ni
  // recrea la imagen/audio/archivo adjunto ni el resto del nodo. Así una
  // imagen no "parpadea" y un audio en reproducción no se detiene solo,
  // sin importar qué tan seguido cambie la URL firmada que manda el
  // servidor en cada sondeo.
  let renderedNodes = new Map(); // id -> elemento DOM del <div class="packet">

  function removeEmptyState() {
    const empty = thread.querySelector('.empty-state');
    if (empty) empty.remove();
  }

  function buildMetaHtml(m) {
    return (m.editedAt ? '<span class="edited-tag">editado</span>' : '') + ticksHtml(m);
  }

  function createMessageElement(m) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = messageHtml(m);
    const el = wrapper.firstElementChild;
    attachHandlersForNode(el);
    return el;
  }

  function attachHandlersForNode(el) {
    const body = el.querySelector('.packet-body.editable');
    if (body) body.addEventListener('click', () => startEdit(Number(body.dataset.id)));
    const img = el.querySelector('.attachment-image');
    if (img) img.addEventListener('click', () => window.open(img.dataset.lightbox, '_blank'));
  }

  function insertOrUpdateMessage(m) {
    let el = renderedNodes.get(m.id);
    if (!el) {
      removeEmptyState();
      el = createMessageElement(m);
      renderedNodes.set(m.id, el);
      thread.appendChild(el);
      return true; // es un mensaje nuevo
    }
    // Ya existía: solo tocar lo que puede cambiar (checks, "editado"), y el
    // texto SOLO si de verdad cambió (edición) y no está en modo edición
    // ahora mismo — nunca tocar el adjunto.
    const metaEl = el.querySelector('.packet-meta');
    if (metaEl) metaEl.innerHTML = buildMetaHtml(m);
    const bodyEl = el.querySelector('.packet-body');
    if (bodyEl && !bodyEl.querySelector('.edit-box') && bodyEl.textContent !== m.text) {
      bodyEl.textContent = m.text;
    }
    return false;
  }

  function applyMessages(list, isInitial) {
    if (isInitial) {
      thread.innerHTML = '';
      renderedNodes = new Map();
      messagesById = new Map();
      if (list.length === 0) {
        thread.innerHTML = '<div class="empty-state">— sin mensajes todavía —</div>';
      }
      for (const m of list) {
        messagesById.set(m.id, m);
        insertOrUpdateMessage(m);
        if (m.id > lastMessageId) lastMessageId = m.id;
      }
      thread.scrollTop = thread.scrollHeight;
      return;
    }

    const wasNearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
    let addedNew = false;
    for (const m of list) {
      messagesById.set(m.id, m);
      if (insertOrUpdateMessage(m)) addedNew = true;
      if (m.id > lastMessageId) lastMessageId = m.id;
    }
    if (addedNew && wasNearBottom) thread.scrollTop = thread.scrollHeight;
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

  function humanFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function attachmentHtml(a) {
    if (!a || !a.url) return '';
    if (a.kind === 'image') {
      return '<img class="attachment-image" src="' + a.url + '" alt="' + escapeHtml(a.name) + '" data-lightbox="' + a.url + '">';
    }
    if (a.kind === 'audio') {
      return '<audio class="attachment-audio" controls src="' + a.url + '"></audio>';
    }
    return (
      '<a class="attachment-file" href="' + a.url + '" target="_blank" rel="noopener">' +
      '<span class="file-icon">📄</span>' +
      '<span><div>' + escapeHtml(a.name) + '</div><div class="file-meta">' + humanFileSize(a.size) + '</div></span>' +
      '</a>'
    );
  }

  function messageHtml(m) {
    const mine = m.from === currentUser;
    const time = new Date(m.ts).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
    const bodyEditable = mine && !m.attachment; // los mensajes con adjunto no se editan, solo texto
    return (
      '<div class="packet ' + (mine ? 'mine' : '') + '" data-id="' + m.id + '">' +
      '<div class="packet-head"><span class="uid">@' + escapeHtml(m.from) + '</span><span>' + time + '</span></div>' +
      attachmentHtml(m.attachment) +
      (m.text
        ? '<div class="packet-body' + (bodyEditable ? ' editable' : '') + '" data-id="' + m.id + '">' + escapeHtml(m.text) + '</div>'
        : '') +
      '<div class="packet-meta">' + buildMetaHtml(m) + '</div>' +
      '</div>'
    );
  }

  // ---------- editar mensaje propio ----------
  function startEdit(id) {
    if (thread.querySelector('.edit-box')) return;
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
      packet.textContent = original; // solo restaura el texto, no toca el resto del mensaje
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
    const packet = thread.querySelector('.packet[data-id="' + id + '"] .packet-body');
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
        if (packet) packet.textContent = messagesById.get(id).text; // revertir a lo que había
        return;
      }
      const updated = await res.json();
      messagesById.set(updated.id, updated);
      if (packet) packet.textContent = updated.text;
      const metaEl = thread.querySelector('.packet[data-id="' + id + '"] .packet-meta');
      if (metaEl) metaEl.innerHTML = buildMetaHtml(updated);
    } catch (err) {
      if (packet) packet.textContent = messagesById.get(id).text;
    }
  }

  // ---------- enviar texto ----------
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
      insertOrUpdateMessage(msg);
      thread.scrollTop = thread.scrollHeight;
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

  // ---------- adjuntos: archivos e imágenes ----------
  async function fetchUploadConfig() {
    try {
      const res = await fetch('/api/config');
      uploadConfig = await res.json();
    } catch (err) {
      uploadConfig = null;
    }
  }

  function showUploadProgress(show, label) {
    uploadProgress.style.display = show ? 'block' : 'none';
    if (label) uploadProgress.textContent = label;
  }

  async function uploadAndSend(file, kind) {
    if (!uploadConfig || !uploadConfig.supabaseUrl || !uploadConfig.supabaseAnonKey) {
      alert('El envío de archivos no está configurado todavía en el servidor (faltan variables de Supabase).');
      return;
    }
    if (!window.supabase || !window.supabase.createClient) {
      alert('No se pudo cargar la librería necesaria para subir archivos.');
      return;
    }
    showUploadProgress(true, 'Subiendo…');
    try {
      const signRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ fileName: file.name || 'archivo' }),
      });
      if (signRes.status === 401) {
        forceLogout('Se inició sesión con este usuario desde otro dispositivo, o tu sesión expiró.');
        return;
      }
      if (!signRes.ok) throw new Error('no se pudo preparar la subida');
      const { path, uploadToken } = await signRes.json();

      const publicClient = window.supabase.createClient(uploadConfig.supabaseUrl, uploadConfig.supabaseAnonKey);
      const { error: upErr } = await publicClient.storage
        .from(uploadConfig.bucket)
        .uploadToSignedUrl(path, uploadToken, file, { contentType: file.type || 'application/octet-stream' });
      if (upErr) throw upErr;

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          text: '',
          attachment: { path, kind, name: file.name || 'archivo', mime: file.type || '', size: file.size || 0 },
        }),
      });
      if (res.status === 401) {
        forceLogout('Se inició sesión con este usuario desde otro dispositivo, o tu sesión expiró.');
        return;
      }
      const msg = await res.json();
      messagesById.set(msg.id, msg);
      if (msg.id > lastMessageId) lastMessageId = msg.id;
      insertOrUpdateMessage(msg);
      thread.scrollTop = thread.scrollHeight;
    } catch (err) {
      alert('No se pudo enviar el archivo. Intenta de nuevo.');
    }
    showUploadProgress(false);
  }

  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const kind = file.type.startsWith('image/') ? 'image' : 'file';
    uploadAndSend(file, kind);
    fileInput.value = '';
  });

  // ---------- nota de voz ----------
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingStream = null;

  voiceBtn.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      return;
    }
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert('No se pudo acceder al micrófono.');
      return;
    }
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(recordingStream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      recordingStream.getTracks().forEach((t) => t.stop());
      voiceBtn.classList.remove('recording');
      voiceBtn.textContent = '🎙️';
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      if (blob.size === 0) return;
      const file = new File([blob], 'nota-de-voz.webm', { type: blob.type });
      uploadAndSend(file, 'audio');
    };
    mediaRecorder.start();
    voiceBtn.classList.add('recording');
    voiceBtn.textContent = '⏹️';
  });

  // ---------- cierre de sesión forzado (expulsado) ----------
  function forceLogout(reason) {
    clearSession();
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    stopCallPolling();
    endCall(true);
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
    endCall(true);
    stopCallPolling();
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

  // ---------- notificaciones push ----------
  async function setupPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.register('/conocenos/sw.js');
      const keyRes = await fetch('/api/push-key');
      const { key } = await keyRes.json();
      if (!key) return;

      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
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
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  window.addEventListener('focus', () => {
    if (currentUser) maybeMarkRead(Array.from(messagesById.values()));
  });

  // ================== LLAMADAS (WebRTC, señalización por sondeo) ==================

  function startCallPolling() {
    if (callPollTimer) clearInterval(callPollTimer);
    callPollTimer = setInterval(pollCallSignals, CALL_POLL_INTERVAL_MS);
  }
  function stopCallPolling() {
    if (callPollTimer) clearInterval(callPollTimer);
    callPollTimer = null;
  }

  async function pollCallSignals() {
    if (!currentUser) return;
    try {
      const res = await fetch('/api/call-signal?sinceId=' + lastSignalId, { headers: authHeaders() });
      if (!res.ok) return;
      const { signals } = await res.json();
      for (const sig of signals || []) {
        if (sig.id > lastSignalId) lastSignalId = sig.id;
        await handleSignal(sig);
      }
    } catch (err) {}
  }

  async function sendSignal(type, payload) {
    if (!otherUsername) return;
    try {
      await fetch('/api/call-signal', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ type, payload, toUser: otherUsername }),
      });
    } catch (err) {}
  }

  async function handleSignal(sig) {
    if (sig.type === 'offer') {
      if (callState !== 'idle') {
        // ya estamos en una llamada: rechazar automáticamente la nueva
        sendSignal('hangup', null);
        return;
      }
      pendingOffer = sig;
      callState = 'ringing';
      incomingText.textContent = '@' + sig.from + ' te está llamando';
      incomingCall.style.display = 'flex';
      return;
    }
    if (sig.type === 'answer') {
      if (pc && callState === 'calling') {
        await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));
        await flushPendingCandidates();
        callState = 'connected';
        callStatus.textContent = 'En llamada';
      }
      return;
    }
    if (sig.type === 'candidate') {
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(sig.payload));
        } catch (err) {}
      } else {
        pendingCandidates.push(sig.payload);
      }
      return;
    }
    if (sig.type === 'hangup') {
      if (callState !== 'idle') endCall(false);
      incomingCall.style.display = 'none';
      pendingOffer = null;
      return;
    }
  }

  async function flushPendingCandidates() {
    for (const c of pendingCandidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {}
    }
    pendingCandidates = [];
  }

  function createPeerConnection() {
    const conn = new RTCPeerConnection(RTC_CONFIG);
    conn.onicecandidate = (e) => {
      if (e.candidate) sendSignal('candidate', e.candidate.toJSON());
    };
    conn.ontrack = (e) => {
      remoteVideo.srcObject = e.streams[0];
    };
    conn.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(conn.connectionState) && callState !== 'idle') {
        endCall(true);
      }
    };
    return conn;
  }

  async function startCall() {
    if (!otherUsername) {
      alert('Todavía no se detecta a la otra persona (espera a que inicie sesión al menos una vez).');
      return;
    }
    if (callState !== 'idle') return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch (err) {
      alert('No se pudo acceder a la cámara/micrófono.');
      return;
    }
    localVideo.srcObject = localStream;
    pc = createPeerConnection();
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    callState = 'calling';
    callStatus.textContent = 'Llamando…';
    callOverlay.style.display = 'flex';
    sendSignal('offer', offer);
  }
  callBtn.addEventListener('click', startCall);

  async function acceptCall() {
    if (!pendingOffer) return;
    const from = pendingOffer.from;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch (err) {
      alert('No se pudo acceder a la cámara/micrófono.');
      sendSignal('hangup', null);
      pendingOffer = null;
      incomingCall.style.display = 'none';
      callState = 'idle';
      return;
    }
    incomingCall.style.display = 'none';
    localVideo.srcObject = localStream;
    pc = createPeerConnection();
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.payload));
    await flushPendingCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    otherUsername = from; // por si acaso, aseguramos a quién responderle
    sendSignal('answer', answer);

    callState = 'connected';
    callStatus.textContent = 'En llamada';
    callOverlay.style.display = 'flex';
    pendingOffer = null;
  }
  acceptCallBtn.addEventListener('click', acceptCall);

  rejectCallBtn.addEventListener('click', () => {
    if (pendingOffer) {
      otherUsername = pendingOffer.from;
      sendSignal('hangup', null);
    }
    pendingOffer = null;
    incomingCall.style.display = 'none';
    callState = 'idle';
  });

  function endCall(notifyRemote) {
    if (callState === 'idle' && !pc && !localStream) return;
    if (notifyRemote && callState !== 'idle') sendSignal('hangup', null);
    if (pc) {
      pc.close();
      pc = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    callOverlay.style.display = 'none';
    incomingCall.style.display = 'none';
    pendingOffer = null;
    pendingCandidates = [];
    callState = 'idle';
    micOn = true;
    camOn = true;
    muteBtn.classList.remove('off');
    camBtn.classList.remove('off');
  }
  hangupBtn.addEventListener('click', () => endCall(true));

  muteBtn.addEventListener('click', () => {
    if (!localStream) return;
    micOn = !micOn;
    localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    muteBtn.classList.toggle('off', !micOn);
  });
  camBtn.addEventListener('click', () => {
    if (!localStream) return;
    camOn = !camOn;
    localStream.getVideoTracks().forEach((t) => (t.enabled = camOn));
    camBtn.classList.toggle('off', !camOn);
  });

  // ---------- restaurar sesión si la pestaña se refrescó (no si se cerró) ----------
  const existing = loadSession();
  if (existing && existing.username && existing.token) {
    enterChat(existing.username, existing.token);
  }
})();
