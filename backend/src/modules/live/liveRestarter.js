// ════════════════════════════════════════
// LIVE RESTARTER
// Vigila el directo activo y lo reinicia automáticamente si se cae.
// También rota la categoría según config.json.
// ════════════════════════════════════════

import { logger }                   from '../../utils/logger.js';
import { startLiveStream, stopLiveStream, getLiveStreamStatus } from './liveStreamManager.js';
import fs   from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

// Estado del restarter
let watchInterval   = null;
let restartCount    = 0;
let consecutiveErrors = 0;
let active          = false;
let scheduledStop   = null;

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Activa el watcher del directo.
 * El watcher revisa cada 30 segundos si FFmpeg sigue corriendo;
 * si se cayó, espera el delay configurado y reinicia.
 *
 * @param {object} options - Config del directo (se lee de config.json si no se pasa)
 */
export function startRestarter(options = {}) {
  if (active) {
    logger.warn('Restarter ya activo.');
    return;
  }

  active = true;
  restartCount = 0;
  consecutiveErrors = 0;

  const cfg = readLiveConfig();
  const effectiveOptions = { ...cfg, ...options };

  logger.ok(`LiveRestarter: vigilancia activa (check cada 30s, delay ${effectiveOptions.restartDelayMinutes}m)`);

  watchInterval = setInterval(async () => {
    await checkAndRestart(effectiveOptions);
  }, 30_000);
}

/**
 * Desactiva el restarter.
 */
export function stopRestarter() {
  if (watchInterval) {
    clearInterval(watchInterval);
    watchInterval = null;
  }
  if (scheduledStop) {
    clearTimeout(scheduledStop);
    scheduledStop = null;
  }
  active = false;
  logger.ok('LiveRestarter: desactivado.');
}

/**
 * Programa la detención automática del directo después de N horas.
 * @param {number} durationHours
 */
export function scheduleStop(durationHours) {
  if (scheduledStop) clearTimeout(scheduledStop);

  const ms = durationHours * 3600 * 1000;
  scheduledStop = setTimeout(async () => {
    logger.ok(`LiveRestarter: duración máxima alcanzada (${durationHours}h). Deteniendo directo.`);
    stopRestarter();
    try {
      await stopLiveStream();
    } catch (err) {
      logger.warn(`Error deteniendo stream en stop programado: ${err.message}`);
    }
    // Rotar categoría para el próximo directo
    rotateLiveCategory();
  }, ms);

  logger.ok(`LiveRestarter: detención automática en ${durationHours} horas.`);
}

/**
 * Devuelve el estado del restarter.
 */
export function getRestarterStatus() {
  return {
    active,
    restartCount,
    consecutiveErrors,
    hasScheduledStop: !!scheduledStop,
  };
}

// ── Lógica interna ────────────────────────────────────────────────────────────

async function checkAndRestart(options) {
  const status = getLiveStreamStatus();

  if (status.running) {
    // Todo bien, resetear contador de errores consecutivos
    consecutiveErrors = 0;
    return;
  }

  const cfg = readLiveConfig();
  const maxErrors = options.maxConsecutiveErrors ?? cfg.maxConsecutiveErrors ?? 3;

  if (!cfg.autoRestart && !options.autoRestart) {
    logger.info('Restarter: stream caído pero autoRestart=false. Sin acción.');
    return;
  }

  consecutiveErrors++;
  logger.warn(`LiveRestarter: stream caído. Error consecutivo #${consecutiveErrors}/${maxErrors}`);

  if (consecutiveErrors >= maxErrors) {
    logger.error(`LiveRestarter: demasiados errores consecutivos (${consecutiveErrors}). Deteniendo watcher.`);
    stopRestarter();
    return;
  }

  const delayMinutes = options.restartDelayMinutes ?? cfg.restartDelayMinutes ?? 5;
  logger.step(`LiveRestarter: reiniciando en ${delayMinutes} minutos...`);

  await sleep(delayMinutes * 60 * 1000);

  // Verificar que sigue caído (podría haberse iniciado manualmente)
  const statusAfterDelay = getLiveStreamStatus();
  if (statusAfterDelay.running) {
    logger.info('LiveRestarter: stream activo nuevamente (inicio manual). Sin acción.');
    consecutiveErrors = 0;
    return;
  }

  try {
    restartCount++;
    logger.ok(`LiveRestarter: iniciando restart #${restartCount}...`);
    await startLiveStream(options);
    consecutiveErrors = 0;
    logger.ok(`LiveRestarter: stream reiniciado exitosamente.`);
  } catch (err) {
    logger.error(`LiveRestarter: error en restart: ${err.message}`);
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

function readLiveConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw).live ?? {};
  } catch {
    return {};
  }
}

function rotateLiveCategory() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const live = raw.live ?? {};
    const rotation = live.categoryRotation ?? [];
    if (rotation.length === 0) return;

    const currentIndex = (live.currentLiveIndex ?? 0);
    const nextIndex    = (currentIndex + 1) % rotation.length;
    raw.live.currentLiveIndex = nextIndex;
    raw.live.category         = rotation[nextIndex];

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');
    logger.ok(`LiveRestarter: categoría rotada → ${rotation[nextIndex]}`);
  } catch (err) {
    logger.warn(`No se pudo rotar categoría: ${err.message}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
