// ════════════════════════════════════════
// VIDEO FETCHER v2 — B-roll de Pexels sincronizado con escenas
// La duración de cada clip = duración de su escena en el guión
// ════════════════════════════════════════

//arreglo de bugs

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { sleep } from '../utils/fileManager.js';
import { logger } from '../utils/logger.js';

const PEXELS_BASE = 'https://api.pexels.com/videos';
const DELAY_BETWEEN_CLIPS = 1200;

const BROLL_FALLBACK_KEYWORDS = [
  'coffee pouring slow motion',
  'rain window night cinematic',
  'city lights night bokeh',
  'candle flame close up dark',
  'ocean waves slow motion',
  'forest sunlight rays',
  'hands close up cinematic',
  'walking street rainy night',
  'fire burning close up',
  'empty road fog cinematic',
];

async function searchPexelsVideos(query, perPage = 8) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY no configurada en .env');

  const response = await axios.get(`${PEXELS_BASE}/search`, {
    headers: { Authorization: apiKey },
    params: { query, per_page: perPage, orientation: 'portrait', size: 'medium' },
    timeout: 15000,
  });

  return response.data.videos || [];
}

function pickBestVideoFile(video) {
  const files = video.video_files || [];
  return (
    files.find(f => f.quality === 'hd' && f.width < f.height) ||
    files.find(f => f.width < f.height) ||
    files.find(f => f.quality === 'hd') ||
    files[0] ||
    null
  );
}

async function downloadClip(url, outputPath) {
  const response = await axios({
    method: 'GET', url,
    responseType: 'stream',
    timeout: 90000,
    headers: { 'User-Agent': 'YoutubeShorts-AI/2.0' },
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  const stat = fs.statSync(outputPath);
  if (stat.size < 50 * 1024) throw new Error(`Clip muy pequeño: ${stat.size} bytes`);
  return outputPath;
}

async function fetchClipForScene(keywords, outputPath, sceneIndex, sceneDuration) {
  const queries = Array.isArray(keywords)
    ? [...keywords, BROLL_FALLBACK_KEYWORDS[sceneIndex % BROLL_FALLBACK_KEYWORDS.length]]
    : [keywords, BROLL_FALLBACK_KEYWORDS[sceneIndex % BROLL_FALLBACK_KEYWORDS.length]];

  for (const query of queries) {
    try {
      logger.info(`Buscando B-roll escena ${sceneIndex + 1}: "${query}"`);
      const videos = await searchPexelsVideos(query, 8);
      if (!videos.length) continue;

      // Filtrar videos que tengan al menos la duración de la escena
      const suficienteDuracion = videos.filter(v => (v.duration || 0) >= sceneDuration);
      const pool = suficienteDuracion.length > 0 ? suficienteDuracion : videos;

      const video = pool[Math.floor(Math.random() * Math.min(pool.length, 5))];
      const file  = pickBestVideoFile(video);
      if (!file?.link) continue;

      logger.info(`Descargando: ${file.width}x${file.height} (${file.quality}) — ${video.duration}s`);
      await downloadClip(file.link, outputPath);
      logger.ok(`Clip ${sceneIndex + 1} descargado (necesita ${sceneDuration}s, clip tiene ${video.duration}s)`);

      // Retornar con la duración EXACTA de la escena del guión
      return { path: outputPath, duration: sceneDuration, sourceDuration: video.duration || sceneDuration };

    } catch (error) {
      logger.warn(`Error con "${query}": ${error.message}`);
    }
  }

  throw new Error(`No se pudo obtener clip para escena ${sceneIndex + 1}`);
}

/**
 * Función principal — descarga clips sincronizados con las escenas
 * @param {Array} scenes - Escenas del guión (con videoKeywords y duration)
 * @param {string} outputDir - Directorio de salida
 */
export async function fetchSceneVideos(scenes, outputDir) {
  logger.step(`Descargando ${scenes.length} clips de Pexels sincronizados con escenas...`);
  fs.mkdirSync(outputDir, { recursive: true });

  const clips  = [];
  let exitosos = 0;
  let fallidos = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene        = scenes[i];
    const sceneDuration = scene.duration || 10;
    const filename     = `raw_clip_${String(i + 1).padStart(3, '0')}.mp4`;
    const outPath      = path.join(outputDir, filename);

    const keywords = scene.videoKeywords
      || scene.imagePrompt?.split(',').slice(0, 2).join(' ')
      || BROLL_FALLBACK_KEYWORDS[i % BROLL_FALLBACK_KEYWORDS.length];

    try {
      const clip = await fetchClipForScene(keywords, outPath, i, sceneDuration);
      clips.push(clip);
      exitosos++;
    } catch (error) {
      logger.error(`Escena ${i + 1} sin clip: ${error.message}`);
      // Fallback genérico
      try {
        const fallbackQuery = BROLL_FALLBACK_KEYWORDS[Math.floor(Math.random() * BROLL_FALLBACK_KEYWORDS.length)];
        const clip = await fetchClipForScene([fallbackQuery], outPath, i, sceneDuration);
        clips.push(clip);
        exitosos++;
        logger.warn(`Escena ${i + 1}: usando fallback genérico`);
      } catch {
        clips.push(null);
        fallidos++;
      }
    }

    if (i < scenes.length - 1) await sleep(DELAY_BETWEEN_CLIPS);
  }

  logger.ok(`B-roll listo: ${exitosos} clips sincronizados, ${fallidos} fallidos`);
  return clips;
}