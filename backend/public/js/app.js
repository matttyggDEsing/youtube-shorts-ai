/**
 * app.js — Panel de control de Shorts Automático
 * Fix #2: History.load() ahora lee data.history (el endpoint devuelve { success, history: [] })
 * + Loop: módulo Loop para modo de generación continua
 */

/* ══════════════════════════════════════════════════════════════
   DATOS
══════════════════════════════════════════════════════════════ */
const CATEGORIES = {
  terror:          { label: 'Terror',           emoji: '👻' },
  misterio:        { label: 'Misterio',         emoji: '🔍' },
  motivacion:      { label: 'Motivación',       emoji: '🌟' },
  romance:         { label: 'Romance',          emoji: '💫' },
  ciencia_ficcion: { label: 'Ciencia Ficción',  emoji: '🚀' },
  historias_reales:{ label: 'Historias Reales', emoji: '📖' },
  leyendas:        { label: 'Leyendas',         emoji: '🌑' },
  suspenso:        { label: 'Suspenso',         emoji: '🎭' },
};

const STEP_ORDER = ['story', 'tts', 'images', 'video', 'upload'];

/* ══════════════════════════════════════════════════════════════
   MÓDULO: Theme — modo claro/oscuro persistente
══════════════════════════════════════════════════════════════ */
const Theme = (() => {
  const KEY = 'shorts-ai-theme';

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('themeToggleIcon');
    if (icon) icon.textContent = theme === 'dark' ? '☀' : '🌙';
  }

  function toggle() {
    const current = localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    apply(next);
  }

  function init() {
    const saved = localStorage.getItem(KEY);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    apply(theme);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', toggle);
  }

  return { init, toggle };
})();

/* ══════════════════════════════════════════════════════════════
   UTILIDADES GLOBALES
══════════════════════════════════════════════════════════════ */
function $(id) { return document.getElementById(id); }

let toastTimer = null;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function setSystemStatus(state, label) {
  const dot = $('statusDot');
  dot.className = 'status-dot ' + state;
  $('statusLabel').textContent = label;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ══════════════════════════════════════════════════════════════
   MÓDULO: App — Generación de Short
══════════════════════════════════════════════════════════════ */
const App = (() => {
  let eventSource = null;
  let generating  = false;

  async function startGeneration() {
    if (generating) return;

    $('progressPanel').hidden = false;
    $('resultPanel').hidden   = true;
    $('errorPanel').hidden    = true;
    $('generateBtn').disabled = true;
    $('generateBtn').classList.add('is-loading');

    STEP_ORDER.forEach(s => {
      const el = $('step-' + s);
      if (el) el.className = 'step';
    });
    setProgressFill(0);
    setProgressMessage('Iniciando…');
    setSystemStatus('running', 'Generando');
    generating = true;

    const clientId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);

    eventSource = new EventSource(`/api/generate/stream?clientId=${clientId}`);

    eventSource.onmessage = (e) => {
      try {
        handleSSEEvent(JSON.parse(e.data));
      } catch (err) {
        console.error('Error parseando SSE:', err);
      }
    };

    eventSource.onerror = () => {
      closeSSE();
      showError('Error de conexión con el servidor. Verificá que esté corriendo en localhost:3000.');
      setSystemStatus('error', 'Error');
      $('generateBtn').disabled = false;
      $('generateBtn').classList.remove('is-loading');
      generating = false;
    };

    try {
      const res = await fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category:   $('categorySelect').value,
          voice:      $('voiceSelect').value,
          autoUpload: $('autoUploadToggle').checked,
          clientId,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        showError(data.error ?? 'No se pudo iniciar el pipeline.');
        closeSSE();
        $('generateBtn').disabled = false;
        $('generateBtn').classList.remove('is-loading');
        generating = false;
      }
    } catch (err) {
      showError('No se pudo conectar con el servidor.');
      closeSSE();
      $('generateBtn').disabled = false;
      $('generateBtn').classList.remove('is-loading');
      generating = false;
    }
  }

  function handleSSEEvent(data) {
    const { step, progress, message, url, videoPath, error } = data;

    if (step === 'error' || error) {
      closeSSE();
      showError(error || message || 'Error desconocido en el pipeline.');
      setSystemStatus('error', 'Error');
      $('generateBtn').disabled = false;
      $('generateBtn').classList.remove('is-loading');
      generating = false;
      return;
    }

    if (step === 'connected') return;

    setProgressFill(progress ?? 0);
    if (message) setProgressMessage(message);

    if (step && step !== 'done') {
      const idx = STEP_ORDER.indexOf(step);
      STEP_ORDER.forEach((s, i) => {
        const el = $('step-' + s);
        if (!el) return;
        if (i < idx)   el.className = 'step done';
        if (i === idx) el.className = 'step active';
        if (i > idx)   el.className = 'step';
      });
    }

    if (step === 'done') {
      STEP_ORDER.forEach(s => {
        const el = $('step-' + s);
        if (el) el.className = 'step done';
      });
      setProgressFill(100);
      setProgressMessage('¡Video listo!');
      showResult(url, videoPath);
      closeSSE();
      setSystemStatus('done', 'Listo');
      $('generateBtn').disabled = false;
      $('generateBtn').classList.remove('is-loading');
      generating = false;
      History.load();
    }
  }

  function showResult(youtubeUrl, videoPath) {
    $('progressPanel').hidden = true;
    $('resultPanel').hidden   = false;

    const video = $('resultVideo');
    if (videoPath) {
      const previewUrl = videoPath.startsWith('/output')
        ? videoPath
        : '/output/' + videoPath.split(/[\\/]/).pop();
      video.src    = previewUrl;
      video.hidden = false;
    } else {
      video.hidden = true;
    }

    const ytLink = $('ytLink');
    if (youtubeUrl) {
      ytLink.href   = youtubeUrl;
      ytLink.hidden = false;
    } else {
      ytLink.hidden = true;
    }
  }

  function showError(msg) {
    $('progressPanel').hidden = true;
    $('errorPanel').hidden    = false;
    $('errorMsg').textContent = msg;
  }

  function setProgressFill(pct) {
    $('progressFill').style.width = pct + '%';
  }

  function setProgressMessage(msg) {
    $('progressMessage').textContent = msg;
  }

  function closeSSE() {
    if (eventSource) { eventSource.close(); eventSource = null; }
  }

  function resetForm() {
    $('resultPanel').hidden   = true;
    $('errorPanel').hidden    = true;
    $('progressPanel').hidden = true;
    $('generateBtn').disabled = false;
    $('generateBtn').classList.remove('is-loading');
    setProgressFill(0);
    STEP_ORDER.forEach(s => {
      const el = $('step-' + s);
      if (el) el.className = 'step';
    });
    setSystemStatus('idle', 'Listo');
    generating = false;
  }

  return { startGeneration, resetForm };
})();

/* ══════════════════════════════════════════════════════════════
   MÓDULO: History — Historial de videos
══════════════════════════════════════════════════════════════ */
const History = (() => {
  async function load() {
    showSkeleton();
    try {
      const res  = await fetch('/api/history');
      const data = await res.json();
      const items = Array.isArray(data.history) ? data.history : [];
      render(items);
    } catch {
      render([]);
    }
  }

  function showSkeleton(count = 4) {
    const grid  = $('historyGrid');
    const empty = $('historyEmpty');
    empty.hidden = true;
    [...grid.children].forEach(c => { if (c !== empty) c.remove(); });

    for (let i = 0; i < count; i++) {
      const sk = document.createElement('div');
      sk.className = 'hcard-skeleton';
      sk.innerHTML = `
        <div class="sk-thumb"></div>
        <div class="sk-line"></div>
        <div class="sk-line sk-line--short"></div>
      `;
      grid.appendChild(sk);
    }
  }

  function render(items) {
    const grid  = $('historyGrid');
    const empty = $('historyEmpty');

    if (!items.length) {
      empty.hidden = false;
      [...grid.children].forEach(c => { if (c !== empty) c.remove(); });
      return;
    }

    empty.hidden = true;
    [...grid.children].forEach(c => { if (c !== empty) c.remove(); });

    items.forEach(item => {
      const card = buildCard(item);
      grid.appendChild(card);
    });
  }

  function buildCard(item) {
    const cat = CATEGORIES[item.category] ?? { label: item.category, emoji: '📹' };
    const date = formatDate(item.createdAt);
    const statusMap = {
      local:    { text: '⬤ Local',     cls: 'local' },
      uploaded: { text: '✓ Publicado', cls: 'uploaded' },
      failed:   { text: '✗ Error',     cls: 'failed' },
    };
    const s = statusMap[item.status] ?? statusMap.local;

    const div = document.createElement('div');
    div.className = 'hcard';
    div.innerHTML = `
      <div class="hcard-thumb-placeholder">${cat.emoji}</div>
      <div class="hcard-body">
        <div class="hcard-category">${cat.label}</div>
        <div class="hcard-title">${escapeHtml(item.title ?? 'Sin título')}</div>
        <div class="hcard-meta">${date} · ${item.duration ?? '?'}s</div>
        <span class="hcard-status ${s.cls}">${s.text}</span>
        <div class="hcard-actions">
          ${item.youtubeUrl
            ? `<a class="btn btn--sm" href="${escapeHtml(item.youtubeUrl)}" target="_blank">Ver en YouTube ↗</a>`
            : ''}
          ${item.status === 'local'
            ? `<button class="btn btn--sm" onclick="History.uploadItem('${escapeHtml(item.id)}')">Subir ahora</button>`
            : ''}
        </div>
      </div>
    `;
    return div;
  }

  async function uploadItem(id) {
    showToast('Iniciando subida…');
    try {
      const res  = await fetch(`/api/youtube/upload/${id}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('✓ Subida iniciada. Puede tardar unos minutos.');
        setTimeout(() => load(), 5000);
      } else {
        showToast('Error: ' + (data.error ?? 'desconocido'));
      }
    } catch {
      showToast('No se pudo conectar con el servidor.');
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { load, uploadItem };
})();

/* ══════════════════════════════════════════════════════════════
   MÓDULO: Schedule — Automatización / cron
══════════════════════════════════════════════════════════════ */
const Schedule = (() => {
  let rotationOrder = ['terror', 'misterio', 'motivacion', 'ciencia_ficcion', 'suspenso'];

  async function init() {
    try {
      const res = await fetch('/api/schedule');
      const cfg = await res.json();

      $('scheduleEnabled').checked = cfg.enabled ?? false;
      toggleEnabled(cfg.enabled);

      if (cfg.cronExpression) {
        const parts = cfg.cronExpression.split(' ');
        if (parts.length >= 2) {
          const hh = parts[1].padStart(2, '0');
          const mm = parts[0].padStart(2, '0');
          $('scheduleTime').value = `${hh}:${mm}`;
        }
      }

      if (Array.isArray(cfg.categoryRotation)) {
        rotationOrder = cfg.categoryRotation;
      }
    } catch {
      // Sin config, usar defaults
    }

    renderRotation();
  }

  function toggleEnabled(force) {
    const enabled = force !== undefined ? force : $('scheduleEnabled').checked;
    $('scheduleOptions').style.opacity       = enabled ? '1' : '0.45';
    $('scheduleOptions').style.pointerEvents = enabled ? 'auto' : 'none';
  }

  function renderRotation() {
    const list = $('rotationList');
    list.innerHTML = '';

    rotationOrder.forEach((key, idx) => {
      const cat = CATEGORIES[key];
      if (!cat) return;

      const item = document.createElement('div');
      item.className   = 'rotation-item';
      item.draggable   = true;
      item.dataset.key = key;
      item.dataset.idx = idx;
      item.innerHTML = `
        <span class="rotation-drag">⠿</span>
        <span class="rotation-emoji">${cat.emoji}</span>
        <span class="rotation-name">${cat.label}</span>
        <button class="rotation-remove" onclick="Schedule._removeFromRotation('${key}')" title="Quitar">×</button>
      `;

      item.addEventListener('dragstart', onDragStart);
      item.addEventListener('dragover',  onDragOver);
      item.addEventListener('drop',      onDrop);

      list.appendChild(item);
    });

    const missing = Object.keys(CATEGORIES).filter(k => !rotationOrder.includes(k));
    if (missing.length) {
      const addRow = document.createElement('div');
      addRow.style.cssText = 'margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;';
      missing.forEach(key => {
        const cat = CATEGORIES[key];
        const btn = document.createElement('button');
        btn.className   = 'btn btn--sm';
        btn.title       = 'Agregar a rotación';
        btn.textContent = `+ ${cat.emoji} ${cat.label}`;
        btn.onclick     = () => _addToRotation(key);
        addRow.appendChild(btn);
      });
      list.appendChild(addRow);
    }
  }

  let dragSrcIdx = null;

  function onDragStart(e) {
    dragSrcIdx = +e.currentTarget.dataset.idx;
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function onDrop(e) {
    e.preventDefault();
    const targetIdx = +e.currentTarget.dataset.idx;
    if (dragSrcIdx === null || dragSrcIdx === targetIdx) return;
    const moved = rotationOrder.splice(dragSrcIdx, 1)[0];
    rotationOrder.splice(targetIdx, 0, moved);
    renderRotation();
    dragSrcIdx = null;
  }

  function _removeFromRotation(key) {
    rotationOrder = rotationOrder.filter(k => k !== key);
    renderRotation();
  }

  function _addToRotation(key) {
    if (!rotationOrder.includes(key)) rotationOrder.push(key);
    renderRotation();
  }

  async function save() {
    const timeVal = $('scheduleTime').value || '18:00';
    const [hh, mm] = timeVal.split(':').map(Number);

    const days = [...document.querySelectorAll('.days-grid input:checked')]
      .map(el => el.value);

    const dayPart = days.length === 7 ? '*' : days.join(',');
    const cronExpression = `${mm} ${hh} * * ${dayPart}`;

    const cfg = {
      enabled:          $('scheduleEnabled').checked,
      cronExpression,
      categoryRotation: rotationOrder,
      currentIndex:     0,
      autoUpload:       true,
      voice:            $('voiceSelect').value,
    };

    try {
      const res = await fetch('/api/schedule', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(cfg),
      });
      const data = await res.json();
      if (data.ok || data.success) {
        $('scheduleFeedback').textContent = '✓ Configuración guardada';
        setTimeout(() => { $('scheduleFeedback').textContent = ''; }, 3000);
        showToast('Automatización guardada.');
      } else {
        showToast('Error al guardar: ' + (data.error ?? 'desconocido'));
      }
    } catch {
      showToast('No se pudo conectar con el servidor.');
    }
  }

  return { init, toggleEnabled, save, _removeFromRotation, _addToRotation };
})();

/* ══════════════════════════════════════════════════════════════
   MÓDULO: Config — API Keys y YouTube
══════════════════════════════════════════════════════════════ */
const Config = (() => {
  async function init() {
    await checkYoutubeStatus();
  }

  async function verifyGroq() {
    const key = $('groqKeyInput').value.trim();
    if (!key) { showToast('Ingresá una API key.'); return; }

    const statusEl = $('groqStatus');
    statusEl.className   = 'config-status check';
    statusEl.textContent = 'Verificando…';

    try {
      const res  = await fetch('/api/config/groq', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ apiKey: key }),
      });
      const data = await res.json();

      if (data.ok) {
        statusEl.className   = 'config-status ok';
        statusEl.textContent = '✓ API Key válida';
      } else {
        statusEl.className   = 'config-status fail';
        statusEl.textContent = '✗ ' + (data.error ?? 'Key inválida');
      }
    } catch {
      statusEl.className   = 'config-status fail';
      statusEl.textContent = '✗ Sin respuesta del servidor';
    }
  }

  async function checkYoutubeStatus() {
    try {
      const res  = await fetch('/api/youtube/status');
      const data = await res.json();
      renderYTStatus(data.connected, data.scopesOk);
    } catch {
      renderYTStatus(false, false);
    }
  }

  function renderYTStatus(connected, scopesOk) {
    const badge      = $('ytStatusBadge');
    const connectBtn = $('ytConnectBtn');
    const toggleHint = $('ytToggleHint');

    if (connected && scopesOk) {
      badge.className    = 'yt-status-badge connected';
      badge.textContent  = '✓ Conectado';
      connectBtn.hidden  = true;
      if (toggleHint) toggleHint.textContent = 'Cuenta conectada';
    } else if (connected && !scopesOk) {
      badge.className    = 'yt-status-badge warning';
      badge.textContent  = '⚠ Falta permiso nuevo';
      connectBtn.hidden  = false;
      connectBtn.textContent = 'Reconectar YouTube';
      if (toggleHint) toggleHint.textContent = 'Reconectá para habilitar borrado de videos';
    } else {
      badge.className    = 'yt-status-badge disconnected';
      badge.textContent  = '✗ No conectado';
      connectBtn.hidden  = false;
      connectBtn.textContent = 'Conectar YouTube';
      if (toggleHint) toggleHint.textContent = 'Requiere cuenta conectada';
    }
  }

  async function connectYoutube() {
    try {
      const res  = await fetch('/api/youtube/auth');
      const data = await res.json();

      if (data.authUrl) {
        $('oauthPanel').hidden     = false;
        $('oauthLink').href        = data.authUrl;
        $('oauthLink').textContent = 'Abrir autorización ↗';
        showToast('Abrí el enlace de autorización en tu navegador.');
      } else {
        showToast('No se pudo generar la URL de autorización.');
      }
    } catch {
      showToast('Error conectando con el servidor.');
    }
  }

  async function submitOAuthCode() {
    const code = $('oauthCodeInput').value.trim();
    if (!code) { showToast('Pegá el código de autorización.'); return; }

    try {
      const res  = await fetch('/api/youtube/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code }),
      });
      const data = await res.json();

      if (data.ok || data.success) {
        $('oauthPanel').hidden    = true;
        $('oauthCodeInput').value = '';
        renderYTStatus(true);
        showToast('✓ YouTube conectado correctamente.');
      } else {
        showToast('Error: ' + (data.error ?? 'Código inválido'));
      }
    } catch {
      showToast('Error conectando con el servidor.');
    }
  }

  return { init, verifyGroq, connectYoutube, submitOAuthCode, checkYoutubeStatus };
})();

/* ══════════════════════════════════════════════════════════════
   MÓDULO: Loop — Generación continua
══════════════════════════════════════════════════════════════ */
const Loop = (() => {
  let pollInterval = null;

  function el(id) { return document.getElementById(id); }

  function setBadge(text, type) {
    const badge = el('loopStatusBadge');
    if (!badge) return;
    // tipos: idle | active | error | warning
    badge.className = `loop-badge loop-badge--${type}`;
    badge.innerHTML = `<span class="loop-badge-dot"></span>${text}`;
  }

  function setError(msg) {
    const panel    = el('loopErrorMsg');
    const textSpan = el('loopErrorText');
    if (!panel) return;
    if (msg) {
      if (textSpan) textSpan.textContent = msg;
      panel.classList.add('visible');
    } else {
      panel.classList.remove('visible');
    }
  }

  function updateUI(status) {
    const { running, currentCategory, completedCount, consecutiveErrors, lastVideoUrl, lastError } = status;

    if (running) {
      setBadge('Activo', 'active');
    } else if (consecutiveErrors >= 3) {
      setBadge('Detenido por errores', 'error');
    } else {
      setBadge('Inactivo', 'idle');
    }

    const counterEl = el('loopCompletedCount');
    if (counterEl) counterEl.textContent = completedCount;

    const catEl = el('loopCurrentCategory');
    if (catEl) catEl.textContent = currentCategory ?? '—';

    const linkEl = el('loopLastVideoUrl');
    if (linkEl) {
      if (lastVideoUrl) {
        linkEl.innerHTML = `<a href="${lastVideoUrl}" target="_blank" rel="noopener">${lastVideoUrl}</a>`;
      } else {
        linkEl.textContent = '—';
      }
    }

    if (!running && consecutiveErrors >= 3 && lastError) {
      setError(`Loop detenido tras 3 errores consecutivos. Último error: ${lastError}`);
    } else {
      setError(null);
    }

    const startBtn = el('loopStartBtn');
    const stopBtn  = el('loopStopBtn');
    if (startBtn) startBtn.disabled = running;
    if (stopBtn)  stopBtn.disabled  = !running;
  }

  function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(async () => {
      const status = await pollStatus();
      if (!status.running) stopPolling();
    }, 3000);
  }

  function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }

  async function pollStatus() {
    try {
      const res = await fetch('/api/loop/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const status = await res.json();
      updateUI(status);
      return status;
    } catch (err) {
      console.error('[Loop] Error al obtener estado:', err);
      return { running: false, consecutiveErrors: 0 };
    }
  }

  async function start() {
    setError(null);
    setBadge('Iniciando…', 'warning');

    try {
      const res = await fetch('/api/loop/start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice:             el('loopVoiceSelect')?.value || undefined,
          delayBetweenVideos: Number(el('loopDelayInput')?.value || 30),
          autoUpload:        true,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || 'No se pudo iniciar el loop.');
        setBadge('Error', 'error');
        return;
      }

      setBadge('Activo', 'active');
      const startBtn = el('loopStartBtn');
      const stopBtn  = el('loopStopBtn');
      if (startBtn) startBtn.disabled = true;
      if (stopBtn)  stopBtn.disabled  = false;

      startPolling();
    } catch (err) {
      console.error('[Loop] Error al iniciar:', err);
      setError('Error de red al iniciar el loop.');
      setBadge('Error', 'error');
    }
  }

  async function stop() {
    setBadge('Deteniendo…', 'warning');
    try {
      const res  = await fetch('/api/loop/stop', { method: 'POST' });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || 'No se pudo detener el loop.');
        setBadge('Activo', 'active');
        return;
      }

      stopPolling();
      setBadge('Inactivo', 'idle');
      const startBtn = el('loopStartBtn');
      const stopBtn  = el('loopStopBtn');
      if (startBtn) startBtn.disabled = false;
      if (stopBtn)  stopBtn.disabled  = true;
    } catch (err) {
      console.error('[Loop] Error al detener:', err);
      setError('Error de red al detener el loop.');
    }
  }

  function init() {
    pollStatus(); // carga estado inicial sin arrancar polling
  }

  return { start, stop, pollStatus, init };
})();

/* ══════════════════════════════════════════════════════════════
   MÓDULO: Cleanup — buscar y borrar videos con pocas vistas
══════════════════════════════════════════════════════════════ */
const Cleanup = (() => {
  let videos = []; // último resultado de búsqueda

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function search() {
    const max = Number($('cleanupMaxViews').value) || 10;
    const btn = $('cleanupSearchBtn');
    const resultsEl = $('cleanupResults');
    const emptyEl = $('cleanupEmpty');

    btn.disabled = true;
    btn.textContent = 'Buscando…';
    resultsEl.innerHTML = '';
    emptyEl.hidden = true;
    $('cleanupSelectAllBtn').hidden = true;
    $('cleanupDeleteBtn').hidden = true;

    try {
      const res = await fetch(`/api/youtube/low-views?max=${encodeURIComponent(max)}`);
      const data = await res.json();

      if (!data.success) {
        showToast(data.hint ? `${data.error} — ${data.hint}` : `Error: ${data.error ?? 'no se pudo buscar'}`);
        return;
      }

      videos = data.videos ?? [];

      if (!videos.length) {
        emptyEl.hidden = false;
        return;
      }

      render();
      $('cleanupSelectAllBtn').hidden = false;
      updateSelectedCount();
    } catch {
      showToast('No se pudo conectar con el servidor.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Buscar videos';
    }
  }

  function render() {
    const resultsEl = $('cleanupResults');
    resultsEl.innerHTML = '';

    videos.forEach(v => {
      const row = document.createElement('div');
      row.className = 'cleanup-row';
      row.dataset.videoId = v.videoId;
      row.innerHTML = `
        <input type="checkbox" class="cleanup-check" checked onchange="Cleanup.updateSelectedCount()" />
        <img class="cleanup-thumb" src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy" />
        <div class="cleanup-info">
          <div class="cleanup-title">${escapeHtml(v.title)}</div>
          <div class="cleanup-meta">${formatDate(v.publishedAt)}</div>
        </div>
        <span class="cleanup-views">${v.viewCount} vistas</span>
        <a href="${escapeHtml(v.url)}" target="_blank">Ver ↗</a>
      `;
      resultsEl.appendChild(row);
    });
  }

  function toggleSelectAll() {
    const checks = document.querySelectorAll('.cleanup-check');
    const allChecked = [...checks].every(c => c.checked);
    checks.forEach(c => { c.checked = !allChecked; });
    updateSelectedCount();
  }

  function updateSelectedCount() {
    const checks = [...document.querySelectorAll('.cleanup-check')];
    const selected = checks.filter(c => c.checked).length;
    $('cleanupSelectedCount').textContent = selected;
    $('cleanupDeleteBtn').hidden = selected === 0;
  }

  async function deleteSelected() {
    const checks = [...document.querySelectorAll('.cleanup-check')].filter(c => c.checked);
    if (!checks.length) return;

    const count = checks.length;
    const confirmed = confirm(
      `Vas a borrar ${count} video${count === 1 ? '' : 's'} de YouTube de forma permanente. ¿Confirmás?`
    );
    if (!confirmed) return;

    const btn = $('cleanupDeleteBtn');
    btn.disabled = true;

    const rows = checks.map(c => c.closest('.cleanup-row'));
    rows.forEach(r => r.classList.add('is-deleting'));

    const videoIds = rows.map(r => r.dataset.videoId);

    try {
      const res = await fetch('/api/youtube/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds }),
      });
      const data = await res.json();

      if (!data.success) {
        showToast('Error: ' + (data.error ?? 'no se pudo borrar'));
        rows.forEach(r => r.classList.remove('is-deleting'));
        return;
      }

      const deletedSet = new Set(data.deleted || []);
      const failedMap = new Map((data.failed || []).map(f => [f.videoId, f.error]));

      rows.forEach(r => {
        const id = r.dataset.videoId;
        r.classList.remove('is-deleting');
        if (deletedSet.has(id)) {
          r.classList.add('is-deleted');
          setTimeout(() => r.remove(), 600);
        } else if (failedMap.has(id)) {
          r.classList.add('is-failed');
          const meta = r.querySelector('.cleanup-meta');
          if (meta) meta.textContent = 'Error: ' + failedMap.get(id);
        }
      });

      videos = videos.filter(v => !deletedSet.has(v.videoId));

      showToast(`✓ ${data.deleted.length} borrados${data.failed.length ? `, ${data.failed.length} con error` : ''}.`);
      updateSelectedCount();

      if (!videos.length) {
        setTimeout(() => { $('cleanupEmpty').hidden = false; }, 700);
      }
    } catch {
      showToast('No se pudo conectar con el servidor.');
      rows.forEach(r => r.classList.remove('is-deleting'));
    } finally {
      btn.disabled = false;
    }
  }

  return { search, toggleSelectAll, updateSelectedCount, deleteSelected };
})();

/* ══════════════════════════════════════════════════════════════
   INIT — Al cargar la página
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  Theme.init();
  History.load();
  await Schedule.init();
  await Config.init();
  Loop.init();

  try {
    await fetch('/api/categories');
    setSystemStatus('idle', 'Listo');
  } catch {
    setSystemStatus('error', 'Servidor inactivo');
    showToast('⚠ No se puede conectar con localhost:3000');
  }

  $('statusDot').className = 'status-dot idle';
});



