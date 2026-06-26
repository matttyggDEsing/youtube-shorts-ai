/**
 * app.js — Panel de control de Shorts Automático
 * Comunicación con Express mediante fetch() + EventSource (SSE)
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
  let generating = false;

  function startGeneration() {
    if (generating) return;

    const category   = $('categorySelect').value;
    const voice      = $('voiceSelect').value;
    const autoUpload = $('autoUploadToggle').checked;

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

    // Conectar al SSE
    const params = new URLSearchParams({ category, voice, autoUpload });
    eventSource = new EventSource(`/api/generate/stream?${params}`);

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleSSEEvent(data);
      } catch (err) {
        console.error('Error parseando SSE:', err);
      }
    };

    eventSource.onerror = () => {
      closeSSE();
      showError('Error de conexión con el servidor. Revisá que esté corriendo en localhost:3000.');
      setSystemStatus('error', 'Error');
      generating = false;
    };
  }

  function handleSSEEvent(data) {
    const { step, progress, message, url, videoPath, error } = data;

    if (error) {
      closeSSE();
      showError(error);
      setSystemStatus('error', 'Error');
      $('generateBtn').disabled = false;
      generating = false;
      return;
    }

    setProgressFill(progress ?? 0);
    if (message) setProgressMessage(message);

    // Actualizar steps
    if (step && step !== 'done') {
      const idx = STEP_ORDER.indexOf(step);
      STEP_ORDER.forEach((s, i) => {
        const el = $('step-' + s);
        if (!el) return;
        if (i < idx)  el.className = 'step done';
        if (i === idx) el.className = 'step active';
        if (i > idx)  el.className = 'step';
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
      video.src = videoPath; // ruta relativa o URL de preview
      video.hidden = false;
    } else {
      video.hidden = true;
    }

    const ytLink = $('ytLink');
    if (youtubeUrl) {
      ytLink.href = youtubeUrl;
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
      render(Array.isArray(data) ? data : []);
    } catch {
      render([]);
    }
  }

  function render(items) {
    const grid  = $('historyGrid');
    const empty = $('historyEmpty');

    if (!items.length) {
      empty.hidden = false;
      // Limpiar cards previos (excepto el empty)
      [...grid.children].forEach(c => { if (c !== empty) c.remove(); });
      return;
    }

    empty.hidden = true;
    [...grid.children].forEach(c => { if (c !== empty) c.remove(); });

    [...items].reverse().forEach(item => {
      const card = buildCard(item);
      grid.appendChild(card);
    });
  }

  function buildCard(item) {
    const cat   = CATEGORIES[item.category] ?? { label: item.category, emoji: '📹' };
    const date  = formatDate(item.createdAt);
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
      const res  = await fetch(`/api/upload/${id}`, { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        showToast('✓ Subido: ' + data.url);
        load();
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
      const res  = await fetch('/api/schedule');
      const cfg  = await res.json();

      $('scheduleEnabled').checked = cfg.enabled ?? false;
      toggleEnabled(cfg.enabled);

      if (cfg.cronExpression) {
        // Parsear hora desde cron "0 HH * * *"
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
      // No se pudo cargar config, usar defaults
    }

    renderRotation();
  }

  function toggleEnabled(force) {
    const enabled = force !== undefined ? force : $('scheduleEnabled').checked;
    $('scheduleOptions').style.opacity = enabled ? '1' : '0.45';
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

      // Drag & drop
      item.addEventListener('dragstart', onDragStart);
      item.addEventListener('dragover',  onDragOver);
      item.addEventListener('drop',      onDrop);

      list.appendChild(item);
    });

    // Agregar categorías no incluidas
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

    // Días seleccionados
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
      if (data.ok) {
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
    statusEl.className = 'config-status check';
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
    const badge     = $('ytStatusBadge');
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
        const panel  = $('oauthPanel');
        const link   = $('oauthLink');
        panel.hidden = false;
        link.href    = data.authUrl;
        link.textContent = 'Abrir autorización ↗';
        showToast('Abrí el enlace de autorización.');
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

      if (data.ok) {
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
  // Inicializar módulos
  History.load();
  await Schedule.init();
  await Config.init();

  // Comprobar conexión con el servidor
  try {
    await fetch('/api/categories');
    setSystemStatus('idle', 'Listo');
  } catch {
    setSystemStatus('error', 'Servidor inactivo');
    showToast('⚠ No se puede conectar con localhost:3000');
  }

  // Estado inicial del dot
  $('statusDot').className = 'status-dot idle';
});
