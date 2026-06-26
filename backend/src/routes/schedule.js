// ════════════════════════════════════════
// ROUTE: /api/schedule — Configuración del scheduler
// ════════════════════════════════════════

import { Router } from 'express';
import { getSchedulerStatus, updateConfig } from '../scheduler/cronScheduler.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/schedule
 * Devuelve la configuración actual del scheduler
 */
router.get('/', (req, res) => {
  try {
    const status = getSchedulerStatus();
    res.json({ success: true, schedule: status });
  } catch (error) {
    logger.error(`Error leyendo scheduler: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/schedule
 * Actualiza la configuración del scheduler
 * Body: { enabled, cronExpression, categoryRotation, autoUpload, voice }
 */
router.post('/', (req, res) => {
  try {
    const { enabled, cronExpression, categoryRotation, autoUpload, voice } = req.body;

    const newConfig = {};
    if (typeof enabled     !== 'undefined') newConfig.enabled = enabled;
    if (cronExpression)    newConfig.cronExpression = cronExpression;
    if (categoryRotation)  newConfig.categoryRotation = categoryRotation;
    if (typeof autoUpload  !== 'undefined') newConfig.autoUpload = autoUpload;
    if (voice)             newConfig.voice = voice;

    const updated = updateConfig(newConfig);

    logger.ok(`Configuración del scheduler actualizada`);
    res.json({ success: true, schedule: updated });

  } catch (error) {
    logger.error(`Error actualizando scheduler: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
