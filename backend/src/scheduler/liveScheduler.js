// ════════════════════════════════════════
// LIVE SCHEDULER
// Programa directos automáticos con node-cron.
// Se integra con el cronScheduler.js existente de Shorts.
// Lee config.json sección "live".
// ════════════════════════════════════════

import cron   from 'node-cron';
import fs     from 'fs';
import path   from 'path';
import { logger }              from '../utils/logger.js';
import { startLiveStream, stopLiveStream, getLiveStreamStatus } from '../modules/live/liveStreamManager.js';
import { startRestarter, stopRestarter, scheduleStop }          from '../modules/live/liveRestarter.js';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

let liveTask  = null;   // tarea cron activa
let isRunning = false;  // flag para evitar solapamiento

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Inicia el scheduler de directos.
 * Lee la configuración de config.json sección "live".
 */
export function startLiveScheduler() {
  stopLiveScheduler(); // limpiar tarea anterior si existe

  const cfg = readLiveConfig();

  if (!cfg.enabled) {
    logger.info('LiveScheduler: desactivado en config.json (live.enabled = false).');
    return;
  }

  const cronExpr = cfg.cronExpression || '0 20 * * *';

  if (!cron.validate(cronExpr)) {
    logger.warn(`LiveScheduler: expresión cron inválida: "${cronExpr}"`);
    return;
  }

  liveTask = cron.schedule(
    cronExpr,
    async () => { await triggerLive(); },
    { timezone: cfg.scheduleOptimization?.timezone || 'America/Argentina/Buenos_Aires' }
  );

  logger.ok(`LiveScheduler activo: ${cronExpr} (${cfg.scheduleOptimization?.timezone ?? 'UTC'})`);
}

/**
 * Detiene el scheduler (no detiene el directo si está activo).
 */
export function stopLiveScheduler() {
  if (liveTask) {
    liveTask.stop();
    liveTask = null;
    logger.info('LiveScheduler: tarea cron detenida.');
  }
}

/**
 * Dispara un directo inmediatamente (útil desde la API).
 */
export async function triggerLiveNow(overrides = {}) {
  return triggerLive(overrides);
}

/**
 * Estado actual del scheduler.
 */
export function getLiveSchedulerStatus() {
  const cfg = readLiveConfig();
  return {
    enabled:       cfg.enabled ?? false,
    cronExpression: cfg.cronExpression ?? '0 20 * * *',
    category:      cfg.category ?? cfg.categoryRotation?.[cfg.currentLiveIndex ?? 0] ?? 'musica_estudiar',
    durationHours: cfg.durationHours ?? 8,
    autoRestart:   cfg.autoRestart ?? true,
    active:        !!liveTask,
    streamStatus:  getLiveStreamStatus(),
  };
}

/**
 * Actualiza la configuración del scheduler de directos en config.json.
 */
export function updateLiveSchedulerConfig(newConfig) {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  raw.live  = { ...(raw.live ?? {}), ...newConfig };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');

  logger.ok('LiveScheduler: configuración actualizada.');

  // Reiniciar scheduler con nueva config si ya estaba activo
  if (liveTask) {
    startLiveScheduler();
  }

  return getLiveSchedulerStatus();
}

// ── Lógica interna ────────────────────────────────────────────────────────────

async function triggerLive(overrides = {}) {
  if (isRunning) {
    logger.warn('LiveScheduler: ya hay un directo activo, salteando este ciclo.');
    return;
  }

  const cfg = readLiveConfig();

  // Determinar categoría (rotación o fija)
  let category = overrides.category ?? cfg.category;
  if (!category && cfg.categoryRotation?.length > 0) {
    const idx = cfg.currentLiveIndex ?? 0;
    category  = cfg.categoryRotation[idx % cfg.categoryRotation.length];
    // Avanzar índice para la próxima vez
    saveCurrentLiveIndex((idx + 1) % cfg.categoryRotation.length, category);
  }
  category = category || 'musica_estudiar';

  const options = {
    category,
    voice:          overrides.voice          ?? cfg.voice          ?? 'es-MX-DaliaNeural',
    durationHours:  overrides.durationHours  ?? cfg.durationHours  ?? 8,
    privacyStatus:  overrides.privacyStatus  ?? cfg.privacyStatus  ?? 'public',
    enableDvr:      overrides.enableDvr      ?? cfg.enableDvr      ?? true,
    recordFromStart: overrides.recordFromStart ?? cfg.recordFromStart ?? true,
    autoRestart:    overrides.autoRestart    ?? cfg.autoRestart    ?? true,
    restartDelayMinutes: cfg.restartDelayMinutes ?? 5,
    maxConsecutiveErrors: cfg.maxConsecutiveErrors ?? 3,
    pinnedComment:  cfg.pinnedCommentEnabled ?? true,
  };

  isRunning = true;

  try {
    logger.ok(`LiveScheduler: iniciando directo de "${category}"...`);

    const { broadcastId, url } = await startLiveStream(options);
    logger.ok(`LiveScheduler: directo iniciado → ${url}`);

    // Activar restarter si está configurado
    if (options.autoRestart) {
      startRestarter(options);
    }

    // Programar detención automática
    scheduleStop(options.durationHours);

  } catch (error) {
    logger.error(`LiveScheduler: error al iniciar directo — ${error.message}`);
    isRunning = false;
  }
}

function readLiveConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw).live ?? {};
  } catch {
    return {};
  }
}

function saveCurrentLiveIndex(newIndex, newCategory) {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    raw.live.currentLiveIndex = newIndex;
    if (newCategory) raw.live.category = newCategory;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(`No se pudo guardar índice de rotación: ${err.message}`);
  }
}
