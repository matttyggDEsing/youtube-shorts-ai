// src/routes/loop.js
import { Router } from 'express';
import { startLoop, stopLoop, getLoopStatus } from '../modules/loopManager.js';

const router = Router();

/**
 * POST /api/loop/start
 * Body (todos opcionales):
 *   voice: string
 *   delayBetweenVideos: number (segundos, default 30)
 *   categoryRotation: string[] (default: todas las categorías en orden)
 *   autoUpload: boolean (default true)
 */
router.post('/start', (req, res) => {
  const { voice, delayBetweenVideos, categoryRotation, autoUpload } = req.body ?? {};

  const result = startLoop({
    voice,
    delayBetweenVideos: delayBetweenVideos !== undefined ? Number(delayBetweenVideos) : undefined,
    categoryRotation: Array.isArray(categoryRotation) ? categoryRotation : undefined,
    autoUpload: autoUpload !== undefined ? Boolean(autoUpload) : true,
  });

  const statusCode = result.success ? 200 : 409;
  res.status(statusCode).json(result);
});

/**
 * POST /api/loop/stop
 */
router.post('/stop', (req, res) => {
  const result = stopLoop();
  const statusCode = result.success ? 200 : 409;
  res.status(statusCode).json(result);
});

/**
 * GET /api/loop/status
 */
router.get('/status', (req, res) => {
  res.json(getLoopStatus());
});

export default router;
