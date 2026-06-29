// src/modules/loopManager.js
import { runPipeline } from '../scheduler/cronScheduler.js';
import { deleteVideoFile, readHistory } from '../utils/fileManager.js';
import { logger } from '../utils/logger.js';

const DEFAULT_CATEGORIES = [
  'terror', 'misterio', 'motivacion', 'romance',
  'ciencia_ficcion', 'historias_reales', 'leyendas', 'suspenso'
];

const MAX_CONSECUTIVE_ERRORS = 3;

let loopState = {
  running: false,
  currentCategory: null,
  completedCount: 0,
  errorCount: 0,
  consecutiveErrors: 0,
  lastVideoUrl: null,
  lastError: null,
  categoryIndex: 0,
  stopRequested: false,
};

let loopAbortController = null;

function delay(ms) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    if (loopAbortController) {
      loopAbortController.signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Loop stopped'));
      });
    }
  });
}

// Obtiene el último entry del historial (el más reciente)
function getLatestHistoryEntry() {
  try {
    const history = readHistory(); // síncrono, como el original
    if (!history || history.length === 0) return null;
    return history.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  } catch (err) {
    logger.warn('No se pudo leer el historial: ' + err.message);
    return null;
  }
}

async function runLoop({ voice, categoryRotation, delayBetweenVideos, autoUpload }) {
  const categories = (categoryRotation && categoryRotation.length > 0)
    ? categoryRotation
    : DEFAULT_CATEGORIES;

  loopState.stopRequested = false;
  loopState.running = true;
  loopState.consecutiveErrors = 0;

  logger.info('Loop iniciado', JSON.stringify({ voice, delayBetweenVideos, autoUpload }));

  while (!loopState.stopRequested) {
    const category = categories[loopState.categoryIndex % categories.length];
    loopState.currentCategory = category;

    logger.step(`Loop: generando video [${loopState.completedCount + 1}] - categoría: ${category}`);

    try {
      await runPipeline({
        category,
        voice: voice || 'es-AR-ElenaNeural',
        autoUpload: autoUpload !== false,
        onProgress: (data) => {
          logger.info(`Loop progress: ${data?.step || ''} ${data?.message || ''}`);
        },
      });

      const historyEntry = getLatestHistoryEntry();

      if (historyEntry) {
        loopState.lastVideoUrl = historyEntry.youtubeUrl || null;

        // Limpieza automática si fue subido exitosamente
        if (
          historyEntry.status === 'uploaded' &&
          historyEntry.youtubeUrl &&
          historyEntry.filePath
        ) {
          try {
            await deleteVideoFile(historyEntry.filePath, historyEntry.id);
          } catch (delErr) {
            logger.warn('No se pudo eliminar el archivo local: ' + delErr.message);
          }
        }
      }

      loopState.completedCount++;
      loopState.consecutiveErrors = 0;
      loopState.categoryIndex++;

      logger.ok(`Loop: video completado #${loopState.completedCount} (${category})`);

    } catch (err) {
      loopState.errorCount++;
      loopState.consecutiveErrors++;
      loopState.lastError = err.message || String(err);

      logger.error(`Loop: error en categoría ${category} — ${err.message}`);

      if (loopState.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger.error(`Loop detenido automáticamente: ${MAX_CONSECUTIVE_ERRORS} errores consecutivos`);
        loopState.stopRequested = true;
        break;
      }

      loopState.categoryIndex++;
    }

    if (!loopState.stopRequested) {
      const waitMs = (delayBetweenVideos ?? 30) * 1000;
      logger.info(`Loop: esperando ${waitMs / 1000}s antes del siguiente video...`);
      try {
        await delay(waitMs);
      } catch {
        // delay abortado por stopLoop()
        break;
      }
    }
  }

  loopState.running = false;
  loopState.currentCategory = null;
  logger.ok(`Loop finalizado. Completados: ${loopState.completedCount}, Errores: ${loopState.errorCount}`);
}

export function startLoop({ voice, categoryRotation, delayBetweenVideos, autoUpload } = {}) {
  if (loopState.running) {
    return { success: false, message: 'El loop ya está activo.' };
  }

  loopState = {
    running: false,
    currentCategory: null,
    completedCount: 0,
    errorCount: 0,
    consecutiveErrors: 0,
    lastVideoUrl: null,
    lastError: null,
    categoryIndex: 0,
    stopRequested: false,
  };

  loopAbortController = new AbortController();

  runLoop({ voice, categoryRotation, delayBetweenVideos, autoUpload }).catch((err) => {
    logger.error('Error fatal en runLoop: ' + err.message);
    loopState.running = false;
  });

  return { success: true, message: 'Loop iniciado.' };
}

export function stopLoop() {
  if (!loopState.running) {
    return { success: false, message: 'El loop no está activo.' };
  }

  loopState.stopRequested = true;
  if (loopAbortController) {
    loopAbortController.abort();
  }

  logger.info('Stop loop solicitado por el usuario.');
  return { success: true, message: 'Loop detenido.' };
}

export function getLoopStatus() {
  return {
    running: loopState.running,
    currentCategory: loopState.currentCategory,
    completedCount: loopState.completedCount,
    errorCount: loopState.errorCount,
    consecutiveErrors: loopState.consecutiveErrors,
    lastVideoUrl: loopState.lastVideoUrl,
    lastError: loopState.lastError,
  };
}
