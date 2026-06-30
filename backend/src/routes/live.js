// ════════════════════════════════════════
// ROUTE: /api/live — Control del módulo de directos
// ════════════════════════════════════════

import { Router } from 'express';
import { logger }                      from '../utils/logger.js';
import { startLiveStream, stopLiveStream, getLiveStreamStatus } from '../modules/live/liveStreamManager.js';
import { startRestarter, stopRestarter, getRestarterStatus }    from '../modules/live/liveRestarter.js';
import {
  startLiveScheduler,
  stopLiveScheduler,
  triggerLiveNow,
  getLiveSchedulerStatus,
  updateLiveSchedulerConfig,
} from '../scheduler/liveScheduler.js';
import { hasValidToken } from '../modules/live/liveUploader.js';
import { listAvailableAudio } from '../modules/live/liveAudioGenerator.js';

const router = Router();

// ── GET /api/live/status ──────────────────────────────────────────────────────
/**
 * Estado completo del módulo de directos:
 * stream activo, scheduler, restarter y disponibilidad de assets.
 */
router.get('/status', (req, res) => {
  try {
    res.json({
      success: true,
      stream:    getLiveStreamStatus(),
      scheduler: getLiveSchedulerStatus(),
      restarter: getRestarterStatus(),
      youtubeConnected: hasValidToken(),
    });
  } catch (error) {
    logger.error(`/api/live/status: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/live/start ──────────────────────────────────────────────────────
/**
 * Inicia un directo inmediatamente.
 * Body (todos opcionales):
 *   { category, voice, durationHours, privacyStatus, enableDvr, recordFromStart, pinnedComment }
 */
router.post('/start', async (req, res) => {
  if (!hasValidToken()) {
    return res.status(401).json({
      success: false,
      error:   'YouTube no conectado. Autorizá la app desde /api/youtube/auth.',
    });
  }

  const status = getLiveStreamStatus();
  if (status.running) {
    return res.status(409).json({
      success: false,
      error:   'Ya hay un directo activo.',
      url:     status.url,
    });
  }

  const {
    category        = 'musica_estudiar',
    voice           = 'es-MX-DaliaNeural',
    durationHours   = 8,
    privacyStatus   = 'public',
    enableDvr       = true,
    recordFromStart = true,
    pinnedComment   = true,
    autoRestart     = true,
  } = req.body ?? {};

  // Responder inmediatamente — el inicio del stream es async
  res.json({
    success: true,
    message: `Iniciando directo de "${category}"... El stream estará listo en ~30 segundos.`,
  });

  // Ejecutar en background
  (async () => {
    try {
      const { broadcastId, url } = await startLiveStream({
        category, voice, durationHours, privacyStatus,
        enableDvr, recordFromStart, pinnedComment,
      });

      if (autoRestart) {
        startRestarter({ category, voice, durationHours, autoRestart: true });
      }

      logger.ok(`Directo iniciado desde API: ${url}`);
    } catch (err) {
      logger.error(`Error iniciando directo desde API: ${err.message}`);
    }
  })();
});

// ── POST /api/live/stop ───────────────────────────────────────────────────────
/**
 * Detiene el directo activo.
 */
router.post('/stop', async (req, res) => {
  const status = getLiveStreamStatus();
  if (!status.running) {
    return res.status(409).json({ success: false, error: 'No hay directo activo.' });
  }

  try {
    stopRestarter();
    const result = await stopLiveStream();
    res.json({ success: true, message: 'Directo detenido.', url: result.url });
  } catch (error) {
    logger.error(`/api/live/stop: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/live/trigger ────────────────────────────────────────────────────
/**
 * Dispara el ciclo del scheduler de directos ahora (respeta config.json).
 * Útil para testing sin esperar el cron.
 */
router.post('/trigger', async (req, res) => {
  if (!hasValidToken()) {
    return res.status(401).json({
      success: false,
      error:   'YouTube no conectado.',
    });
  }

  try {
    res.json({ success: true, message: 'Directo programado en background...' });
    await triggerLiveNow(req.body ?? {});
  } catch (error) {
    logger.error(`/api/live/trigger: ${error.message}`);
  }
});

// ── GET /api/live/config ──────────────────────────────────────────────────────
/**
 * Devuelve la configuración actual del scheduler de directos.
 */
router.get('/config', (req, res) => {
  try {
    res.json({ success: true, ...getLiveSchedulerStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/live/config ─────────────────────────────────────────────────────
/**
 * Actualiza la configuración del scheduler de directos.
 * Body: campos de config.json["live"] a actualizar.
 */
router.post('/config', (req, res) => {
  try {
    const updated = updateLiveSchedulerConfig(req.body ?? {});
    res.json({ success: true, message: 'Configuración actualizada.', ...updated });
  } catch (error) {
    logger.error(`/api/live/config: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/live/scheduler/start ───────────────────────────────────────────
/**
 * Activa el cron de directos.
 */
router.post('/scheduler/start', (req, res) => {
  try {
    startLiveScheduler();
    res.json({ success: true, message: 'Scheduler de directos activado.', ...getLiveSchedulerStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/live/scheduler/stop ────────────────────────────────────────────
/**
 * Desactiva el cron de directos (sin detener el stream activo).
 */
router.post('/scheduler/stop', (req, res) => {
  try {
    stopLiveScheduler();
    res.json({ success: true, message: 'Scheduler de directos detenido.', ...getLiveSchedulerStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── GET /api/live/assets ──────────────────────────────────────────────────────
/**
 * Lista los assets de audio disponibles por categoría (diagnóstico).
 */
router.get('/assets', (req, res) => {
  const { category = 'musica_estudiar' } = req.query;
  try {
    const audio = listAvailableAudio(category);
    res.json({ success: true, category, audio });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
