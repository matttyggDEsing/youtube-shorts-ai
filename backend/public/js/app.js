/**
 * app.js — Panel de control de Shorts Automático
 * Fix #2: History.load() ahora lee data.history (el endpoint devuelve { success, history: [] })
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

    // Reset UI
    $('progressPanel').hidden = false;
    $('resultPanel').hidden   = true;
    $('errorPanel').hidden    = true;
    $('generateBtn').disabled = true;

    STEP_ORDER.forEach(s => {
      const el = $('step-' + s);
      if (el) el.className = 'step';
    });
    setProgressFill(0);
    setProgressMessage('Iniciando…');
    setSystemStatus('running', 'Generando');
    generating = true;

    // ── PASO 1: Abrir canal SSE con clientId único ──────────
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
      generating = false;
    };

    // ── PASO 2: Disparar el pipeline con POST ───────────────
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
        generating = false;
      }
    } catch (err) {
      showError('No se pudo conectar con el servidor.');
      closeSSE();
      $('generateBtn').disabled = false;
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
    try {
      const res  = await fetch('/api/history');
      const data = await res.json();
      // FIX: el endpoint devuelve { success, history: [] }, no un array directo
      const items = Array.isArray(data.history) ? data.history : [];
      render(items);
    } catch {
      render([]);
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
      renderYTStatus(data.connected);
    } catch {
      renderYTStatus(false);
    }
  }

  function renderYTStatus(connected) {
    const badge      = $('ytStatusBadge');
    const connectBtn = $('ytConnectBtn');
    const toggleHint = $('ytToggleHint');

    if (connected) {
      badge.className   = 'yt-status-badge connected';
      badge.textContent = '✓ Conectado';
      connectBtn.hidden = true;
      if (toggleHint) toggleHint.textContent = 'Cuenta conectada';
    } else {
      badge.className   = 'yt-status-badge disconnected';
      badge.textContent = '✗ No conectado';
      connectBtn.hidden = false;
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
   INIT — Al cargar la página
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  History.load();
  await Schedule.init();
  await Config.init();

  try {
    await fetch('/api/categories');
    setSystemStatus('idle', 'Listo');
  } catch {
    setSystemStatus('error', 'Servidor inactivo');
    showToast('⚠ No se puede conectar con localhost:3000');
  }

  $('statusDot').className = 'status-dot idle';
});
