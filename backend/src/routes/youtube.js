// ════════════════════════════════════════
// ROUTE: /api/youtube — Autenticación y subida a YouTube
// ════════════════════════════════════════

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  getAuthUrl,
  saveTokenFromCode,
  uploadToYoutube,
  checkYoutubeStatus,
  hasValidToken,
} from '../modules/youtubeUploader.js';
import { getHistoryEntry, saveToHistory } from '../utils/fileManager.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/youtube/status
 * Verificar si YouTube está conectado y el token es válido
 */
router.get('/status', async (req, res) => {
  try {
    const status = await checkYoutubeStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.json({ success: true, connected: false, reason: error.message });
  }
});

/**
 * GET /api/youtube/auth
 * Devuelve la URL de autorización OAuth para abrir en el navegador
 */
router.get('/auth', (req, res) => {
  try {
    const authUrl = getAuthUrl();
    res.json({ success: true, authUrl });
  } catch (error) {
    logger.error(`Error generando URL de auth: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      hint: 'Asegurate de tener credentials.json en ./credentials/',
    });
  }
});

/**
 * POST /api/youtube/auth
 * Recibir el código OAuth y guardar el token
 * Body: { code }
 */
router.post('/auth', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ success: false, error: 'Se requiere el código de autorización' });
  }

  try {
    const tokens = await saveTokenFromCode(code);
    res.json({ success: true, message: 'YouTube conectado exitosamente', tokens });
  } catch (error) {
    logger.error(`Error guardando token: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/upload/:id
 * Subir a YouTube un video ya generado localmente
 * Param: id — UUID del historial
 */
router.post('/upload/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const entry = getHistoryEntry(id);

    if (!entry) {
      return res.status(404).json({ success: false, error: 'Video no encontrado en el historial' });
    }
    if (!fs.existsSync(entry.filePath)) {
      return res.status(404).json({ success: false, error: 'El archivo de video no existe en disco' });
    }
    if (!hasValidToken()) {
      return res.status(401).json({ success: false, error: 'No hay token de YouTube. Autorizá la app primero.' });
    }

    logger.step(`Subiendo video manual: "${entry.title}"`);
    res.json({ success: true, message: 'Subida iniciada. Esto puede tardar unos minutos.' });

    // Ejecutar en background
    (async () => {
      try {
        const { videoId, url } = await uploadToYoutube(entry.filePath, {
          title: entry.title,
          description: entry.description || `${entry.title} #Shorts`,
          tags: entry.tags || ['shorts', 'historias'],
          categoryId: '24',
        });

        saveToHistory({ ...entry, youtubeUrl: url, youtubeId: videoId, status: 'uploaded' });
        logger.ok(`Video subido: ${url}`);
      } catch (error) {
        logger.error(`Error en subida manual: ${error.message}`);
        saveToHistory({ ...entry, status: 'failed', error: error.message });
      }
    })();

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/preview/:id
 * Stream del archivo MP4 local para preview en el navegador
 */
router.get('/preview/:id', (req, res) => {
  try {
    const entry = getHistoryEntry(req.params.id);

    if (!entry || !entry.filePath) {
      return res.status(404).json({ error: 'Video no encontrado' });
    }
    if (!fs.existsSync(entry.filePath)) {
      return res.status(404).json({ error: 'Archivo de video no disponible' });
    }

    const stat = fs.statSync(entry.filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Streaming parcial (para seek en el video)
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });

      fs.createReadStream(entry.filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(entry.filePath).pipe(res);
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
