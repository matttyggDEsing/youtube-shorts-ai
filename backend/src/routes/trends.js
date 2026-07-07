// ════════════════════════════════════════
// ROUTE: /api/trends — Flujo de detección de nichos en tendencia
// Guardar como: src/routes/trends.js
// ════════════════════════════════════════

import { Router } from 'express';
import { getNichosEnTendencia, analizarNicho } from '../modules/trendDetector.js';
import { generateStoryFromTrend } from '../modules/storyGenerator.js';
import { runPipeline } from '../scheduler/cronScheduler.js';
import { sendProgress, closeClient } from '../utils/sseManager.js';
import { logger } from '../utils/logger.js';

const router = Router();
let trendPipelineActive = false;

/**
 * GET /api/trends
 * Paso 1: Devuelve los nichos en tendencia AHORA + nichos evergreen
 * El frontend le muestra esta lista al usuario para que elija uno.
 */
router.get('/', async (req, res) => {
  try {
    const data = await getNichosEnTendencia(req.query.region || 'AR');
    res.json({ success: true, ...data });
  } catch (error) {
    logger.error(`Error obteniendo tendencias: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/trends/analizar
 * Paso 2: El usuario eligió un nicho (de la lista o uno escrito a mano).
 * Body: { query: "true crime historias reales shorts" }
 * Devuelve keywords y hashtags reales para CONFIRMAR antes de generar.
 */
router.post('/analizar', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ success: false, error: 'Falta el parámetro "query"' });
  }

  try {
    const analisis = await analizarNicho(query);
    res.json({ success: true, analisis });
  } catch (error) {
    logger.error(`Error analizando nicho: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/trends/generar
 * Paso 3: El usuario confirmó nicho + keywords + hashtags.
 * Dispara el pipeline completo usando esos datos en vez de una categoría fija.
 * Body: { query, keywords: [...], hashtags: [...], voice, autoUpload, clientId }
 */
router.post('/generar', async (req, res) => {
  const {
    query,
    keywords = [],
    hashtags = [],
    voice = process.env.DEFAULT_VOICE,
    autoUpload = process.env.AUTO_UPLOAD === 'true',
    clientId,
  } = req.body;

  if (!query) {
    return res.status(400).json({ success: false, error: 'Falta el nicho ("query")' });
  }
  if (trendPipelineActive) {
    return res.status(409).json({ success: false, error: 'Ya hay un video en generación. Esperá que termine.' });
  }

  trendPipelineActive = true;
  res.json({ success: true, message: 'Generación por tendencia iniciada' });

  (async () => {
    try {
      if (clientId) sendProgress(clientId, { step: 'story', progress: 5, message: `Analizando nicho "${query}"...` });
      const story = await generateStoryFromTrend({ query, keywords, hashtags });

      await runPipeline({
        precomputedStory: story,
        category: query,
        voice,
        autoUpload,
        onProgress: (data) => {
          if (clientId) sendProgress(clientId, data);
        },
      });
    } catch (error) {
      logger.error(`Pipeline por tendencia falló: ${error.message}`);
      if (clientId) {
        sendProgress(clientId, { step: 'error', progress: 0, message: `Error: ${error.message}`, error: error.message });
      }
    } finally {
      trendPipelineActive = false;
      if (clientId) setTimeout(() => closeClient(clientId), 2000);
    }
  })();
});

export default router;
