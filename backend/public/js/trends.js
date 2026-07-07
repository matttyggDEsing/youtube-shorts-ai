/* ══════════════════════════════════════════════════════════════
   MÓDULO: Trends — Nichos en tendencia → keywords/hashtags → generar
   Requiere: $(), showToast(), setSystemStatus() ya definidos en app.js
══════════════════════════════════════════════════════════════ */
const Trends = (() => {
  let nichoSeleccionado = null;   // { query, label }
  let analisisActual    = null;   // { keywords, hashtags, titulosReferencia }
  let keywordsActivas   = new Set();
  let hashtagsActivos   = new Set();
  let eventSource       = null;
  let generating        = false;

  /* ── Paso 1: cargar nichos en tendencia ── */
  async function loadTrends() {
    $('trendsLoading').hidden = false;
    $('trendsContent').hidden = true;
    $('trendsAnalysis').hidden = true;

    try {
      const res  = await fetch('/api/trends');
      const data = await res.json();

      if (!data.success) {
        showToast('No se pudieron cargar las tendencias.');
        $('trendsLoading').hidden = true;
        return;
      }

      renderNichos(data.tendenciasActuales || [], data.nichosBase || []);
    } catch (err) {
      showToast('No se pudo conectar con el servidor.');
    } finally {
      $('trendsLoading').hidden = true;
      $('trendsContent').hidden = false;
    }
  }

  function renderNichos(tendencias, evergreen) {
    const gridTendencias = $('trendsGridActuales');
    const gridEvergreen  = $('trendsGridEvergreen');
    gridTendencias.innerHTML = '';
    gridEvergreen.innerHTML  = '';

    if (tendencias.length === 0) {
      $('trendsGroupActuales').hidden = true;
    } else {
      $('trendsGroupActuales').hidden = false;
      tendencias.forEach(t => {
        gridTendencias.appendChild(buildChip({
          query: t.termino,
          label: t.termino,
          meta: t.relacionados?.slice(0, 3).join(', ') || 'Tendencia actual',
          badge: t.trafico || null,
        }));
      });
    }

    evergreen.forEach(n => {
      gridEvergreen.appendChild(buildChip({
        query: n.query,
        label: n.id.replace(/_/g, ' '),
        meta: n.query,
        badge: null,
      }));
    });
  }

  function buildChip({ query, label, meta, badge }) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'niche-chip';
    chip.innerHTML = `
      <span class="niche-chip-title">${capitalize(label)}${badge ? `<span class="niche-chip-badge">🔥 ${badge}</span>` : ''}</span>
      <span class="niche-chip-meta">${meta}</span>
    `;
    chip.addEventListener('click', () => selectNicho(query, label, chip));
    return chip;
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /* ── Paso 2: elegir nicho → analizar keywords/hashtags reales ── */
  async function selectNicho(query, label, chipEl) {
    document.querySelectorAll('.niche-chip').forEach(c => c.classList.remove('is-selected'));
    if (chipEl) chipEl.classList.add('is-selected');

    nichoSeleccionado = { query, label };
    await analizarNicho(query);
  }

  async function analizarNichoManual() {
    const valor = $('trendsManualInput').value.trim();
    if (!valor) return;
    nichoSeleccionado = { query: valor, label: valor };
    await analizarNicho(valor);
  }

  async function analizarNicho(query) {
    $('trendsAnalysis').hidden = false;
    $('trendsAnalysisBody').innerHTML = '<p class="trends-loading">Analizando videos top de este nicho en YouTube…</p>';
    $('trendsAnalysisTitle').textContent = `Analizando: "${query}"`;

    try {
      const res  = await fetch('/api/trends/analizar', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query }),
      });
      const data = await res.json();

      if (!data.success) {
        $('trendsAnalysisBody').innerHTML = `<p class="trends-loading">Error: ${data.error}</p>`;
        return;
      }

      analisisActual  = data.analisis;
      keywordsActivas = new Set(analisisActual.keywords.map(k => k.keyword));
      hashtagsActivos = new Set(analisisActual.hashtags.map(h => h.hashtag));
      renderAnalisis();
    } catch (err) {
      $('trendsAnalysisBody').innerHTML = '<p class="trends-loading">No se pudo conectar con el servidor.</p>';
    }
  }

  function renderAnalisis() {
    const { keywords, hashtags, titulosReferencia, videosAnalizados } = analisisActual;

    $('trendsAnalysisTitle').textContent = `¿Generar en el estilo de "${nichoSeleccionado.label}"?`;

    const keywordsHtml = keywords.map(k => `
      <span class="trend-tag" data-type="kw" data-value="${escapeHtml(k.keyword)}">
        ${escapeHtml(k.keyword)} <span class="trend-tag-count">${k.apariciones}</span>
      </span>
    `).join('');

    const hashtagsHtml = hashtags.map(h => `
      <span class="trend-tag" data-type="ht" data-value="${escapeHtml(h.hashtag)}">
        ${escapeHtml(h.hashtag)} <span class="trend-tag-count">${h.apariciones}</span>
      </span>
    `).join('');

    const titulosHtml = (titulosReferencia || []).slice(0, 5)
      .map(t => `<li>${escapeHtml(t)}</li>`).join('');

    $('trendsAnalysisBody').innerHTML = `
      <p class="trends-analysis-subtitle">Basado en ${videosAnalizados} videos que mejor están funcionando ahora en este nicho. Desmarcá lo que no quieras usar.</p>

      <div class="trends-tags-block">
        <div class="trends-tags-label">Keywords más usadas (para SEO/visitas)</div>
        <div class="trends-tags-wrap" id="trendsKeywordsWrap">${keywordsHtml || '<span class="trends-empty">Sin datos suficientes</span>'}</div>
      </div>

      <div class="trends-tags-block">
        <div class="trends-tags-label">Hashtags más usados (para alcance)</div>
        <div class="trends-tags-wrap" id="trendsHashtagsWrap">${hashtagsHtml || '<span class="trends-empty">Sin datos suficientes</span>'}</div>
      </div>

      ${titulosHtml ? `
      <div class="trends-tags-block">
        <div class="trends-tags-label">Títulos de referencia (top del nicho)</div>
        <ul class="trends-titles-list">${titulosHtml}</ul>
      </div>` : ''}

      <button class="trends-generate-btn" id="trendsGenerateBtn">
        ▶ Generar Short en este estilo
      </button>
    `;

    // Toggle de tags individuales
    document.querySelectorAll('#trendsKeywordsWrap .trend-tag, #trendsHashtagsWrap .trend-tag')
      .forEach(el => el.addEventListener('click', () => toggleTag(el)));

    $('trendsGenerateBtn').addEventListener('click', startGenerationFromTrend);
  }

  function toggleTag(el) {
    const type  = el.dataset.type;
    const value = el.dataset.value;
    const set   = type === 'kw' ? keywordsActivas : hashtagsActivos;

    if (set.has(value)) {
      set.delete(value);
      el.classList.add('is-off');
    } else {
      set.add(value);
      el.classList.remove('is-off');
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ── Paso 3: generar el Short con lo confirmado ── */
  async function startGenerationFromTrend() {
    if (generating || !nichoSeleccionado) return;
    generating = true;

    const btn = $('trendsGenerateBtn');
    btn.disabled = true;
    btn.textContent = 'Generando…';

    // Reutiliza el mismo panel de progreso de la card principal de generación
    $('progressPanel').hidden = false;
    $('resultPanel').hidden   = true;
    $('errorPanel').hidden    = true;
    document.getElementById('generateCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setSystemStatus('running', 'Generando');

    const clientId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);

    eventSource = new EventSource(`/api/generate/stream?clientId=${clientId}`);
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleTrendSSEEvent(data);
      } catch (err) { /* noop */ }
    };
    eventSource.onerror = () => {
      eventSource.close();
      resetGenerateBtn();
    };

    const keywordsPayload = analisisActual.keywords.filter(k => keywordsActivas.has(k.keyword));
    const hashtagsPayload = analisisActual.hashtags.filter(h => hashtagsActivos.has(h.hashtag));

    try {
      const res = await fetch('/api/trends/generar', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query:      nichoSeleccionado.query,
          keywords:   keywordsPayload,
          hashtags:   hashtagsPayload,
          voice:      $('voiceSelect') ? $('voiceSelect').value : undefined,
          autoUpload: $('autoUploadToggle') ? $('autoUploadToggle').checked : false,
          clientId,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.error || 'No se pudo iniciar la generación.');
        resetGenerateBtn();
      }
    } catch (err) {
      showToast('No se pudo conectar con el servidor.');
      resetGenerateBtn();
    }
  }

  function handleTrendSSEEvent(data) {
    const { step, progress, message, url, error } = data;

    if (step === 'error' || error) {
      eventSource.close();
      showToast('Error: ' + (error || message || 'desconocido'));
      setSystemStatus('error', 'Error');
      resetGenerateBtn();
      return;
    }
    if (step === 'connected') return;

    setProgressFillTrend(progress ?? 0);
    if (message) $('progressMessage').textContent = message;

    if (step === 'done' || progress >= 100) {
      eventSource.close();
      setSystemStatus('idle', 'Listo');
      showToast('✓ Short generado con éxito');
      $('resultPanel').hidden = false;
      if (url) {
        $('ytLink').href = url;
        $('ytLink').hidden = false;
      }
      resetGenerateBtn();
    }
  }

  function setProgressFillTrend(pct) {
    const fill = $('progressFill');
    if (fill) fill.style.width = pct + '%';
  }

  function resetGenerateBtn() {
    generating = false;
    const btn = $('trendsGenerateBtn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '▶ Generar Short en este estilo';
    }
  }

  return { loadTrends, analizarNichoManual };
})();

document.addEventListener('DOMContentLoaded', () => {
  Trends.loadTrends();
});
