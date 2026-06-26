// ════════════════════════════════════════
// ROUTE: /api/generate — Generación de Shorts con SSE
// ════════════════════════════════════════

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { addClient, sendProgress, closeClient } from '../utils/sseManager.js';
import { runPipeline } from '../scheduler/cronScheduler.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Mapa de pipelines activos para prevenir concurrencia
const activePipelines = new Set();

/**
 * GET /api/generate/stream?clientId=xxx
 * Abre un canal SSE para recibir actualizaciones de progreso
 */
router.get('/stream', (req, res) => {
  const clientId = req.query.clientId || uuidv4();
  addClient(clientId, res);
  logger.info(`Cliente SSE conectado: ${clientId}`);
});

/**
 * POST /api/generate
 * Iniciar pipeline de generación completo
 * Body: { category, autoUpload, voice, clientId }
 */
router.post('/', async (req, res) => {
  const {
    category   = process.env.DEFAULT_CATEGORY || 'terror',
    autoUpload = process.env.AUTO_UPLOAD === 'true',
    voice      = process.env.DEFAULT_VOICE || 'es-AR-ElenaNeural',
    clientId,
  } = req.body;

  // Verificar si ya hay un pipeline activo
  if (activePipelines.size > 0) {
    return res.status(409).json({
      success: false,
      error: 'Ya hay un video en generación. Esperá que termine antes de iniciar otro.',
    });
  }

  const pipelineId = uuidv4();
  activePipelines.add(pipelineId);

  // Responder inmediatamente con el ID para tracking
  res.json({ success: true, pipelineId, message: 'Pipeline iniciado' });

  // Ejecutar pipeline en background
  (async () => {
    try {
      await runPipeline({
        category,
        voice,
        autoUpload,
        onProgress: (data) => {
          if (clientId) sendProgress(clientId, data);
        },
      });
    } catch (error) {
      logger.error(`Pipeline ${pipelineId} falló: ${error.message}`);
      if (clientId) {
        sendProgress(clientId, {
          step: 'error',
          progress: 0,
          message: `Error: ${error.message}`,
          error: error.message,
        });
      }
    } finally {
      activePipelines.delete(pipelineId);
      if (clientId) {
        setTimeout(() => closeClient(clientId), 2000);
      }
    }
  })();
});

/**
 * GET /api/generate/status
 * Verificar si hay un pipeline activo
 */
router.get('/status', (req, res) => {
  res.json({
    busy: activePipelines.size > 0,
    activePipelines: activePipelines.size,
  });
});

export default router;
