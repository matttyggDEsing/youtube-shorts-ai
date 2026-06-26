// ════════════════════════════════════════
// VIDEO FETCHER — Descarga de B-roll desde Pexels API
// Reemplaza imageGenerator.js
// ════════════════════════════════════════

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { sleep } from '../utils/fileManager.js';
import { logger } from '../utils/logger.js';

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const PEXELS_BASE    = 'https://api.pexels.com/videos';

// Delay entre descargas para no saturar la API
const DELAY_BETWEEN_CLIPS = 1500;

// Duración de cada clip en el video final (segundos)
// Entre 1 y 2 para ritmo adictivo tipo Short viral
const CLIP_DURATION_MIN = 1.2;
const CLIP_DURATION_MAX = 2.0;

// Keywords de B-roll genérico cinematográfico para usar como fallback
// cuando la búsqueda específica de la escena no devuelve resultados
const BROLL_FALLBACK_KEYWORDS = [
  'coffee pouring slow motion',
  'rain window cinematic',
  'city lights night',
  'candle flame close up',
  'ocean waves slow motion',
  'forest sunlight',
  'food cooking close up',
  'hands writing',
  'walking street cinematic',
  'fire burning close up',
];

/**
 * Buscar videos en Pexels por keyword
 * @param {string} query - Término de búsqueda
 * @param {number} perPage - Cantidad de resultados
 * @returns {Promise<Array>} Lista de videos
 */
async function searchPexelsVideos(query, perPage = 5) {
  const apiKey = PEXELS_API_KEY || process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY no configurada en .env');

  const response = await axios.get(`${PEXELS_BASE}/search`, {
    headers: { Authorization: apiKey },
    params: {
      query,
      per_page: perPage,
      orientation: 'portrait', // preferir vertical (9:16)
      size: 'medium',
    },
    timeout: 15000,
  });

  return response.data.videos || [];
}

/**
 * Elegir el mejor archivo de video de entre los disponibles
 * Preferencia: HD portrait, luego landscape, luego lo que haya
 */
function pickBestVideoFile(video) {
  const files = video.video_files || [];

  // Preferir calidad HD vertical
  const hdPortrait = files.find(f =>
    f.quality === 'hd' && f.width < f.height
  );
  if (hdPortrait) return hdPortrait;

  // Luego SD vertical
  const sdPortrait = files.find(f => f.width < f.height);
  if (sdPortrait) return sdPortrait;

  // Luego HD landscape (FFmpeg lo rotará)
  const hd = files.find(f => f.quality === 'hd');
  if (hd) return hd;

  // Último recurso: cualquier archivo
  return files[0] || null;
}

/**
 * Descargar un clip de video desde una URL
 */
async function downloadClip(url, outputPath) {
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: 60000,
    headers: { 'User-Agent': 'YoutubeShorts-AI/2.0' },
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  const stat = fs.statSync(outputPath);
  if (stat.size < 50 * 1024) {
    throw new Error(`Clip muy pequeño: ${stat.size} bytes`);
  }

  return outputPath;
}

/**
 * Obtener duración aleatoria para el clip dentro del rango configurado
 */
export function getClipDuration() {
  return parseFloat(
    (CLIP_DURATION_MIN + Math.random() * (CLIP_DURATION_MAX - CLIP_DURATION_MIN)).toFixed(2)
  );
}

/**
 * Buscar y descargar un clip para una escena
 * Intenta con las keywords de la escena y hace fallback si falla
 */
async function fetchClipForScene(keywords, outputPath, sceneIndex) {
  const queries = Array.isArray(keywords)
    ? keywords
    : [keywords, BROLL_FALLBACK_KEYWORDS[sceneIndex % BROLL_FALLBACK_KEYWORDS.length]];

  for (const query of queries) {
    try {
      logger.info(`Buscando B-roll: "${query}"`);
      const videos = await searchPexelsVideos(query, 8);

      if (!videos.length) {
        logger.warn(`Sin resultados para "${query}", probando siguiente...`);
        continue;
      }

      // Elegir video al azar entre los primeros resultados para variedad
      const randomIndex = Math.floor(Math.random() * Math.min(videos.length, 5));
      const video = videos[randomIndex];
      const file  = pickBestVideoFile(video);

      if (!file?.link) {
        logger.warn(`Video sin archivo descargable para "${query}"`);
        continue;
      }

      logger.info(`Descargando clip ${sceneIndex + 1}: ${file.width}x${file.height} (${file.quality})`);
      await downloadClip(file.link, outputPath);
      logger.ok(`Clip descargado: ${path.basename(outputPath)}`);
      return { path: outputPath, duration: getClipDuration() };

    } catch (error) {
      logger.warn(`Error buscando "${query}": ${error.message}`);
    }
  }

  // Fallback final: keyword genérica completamente distinta
  const fallbackQuery = BROLL_FALLBACK_KEYWORDS[Math.floor(Math.random() * BROLL_FALLBACK_KEYWORDS.length)];
  try {
    logger.warn(`Usando fallback genérico: "${fallbackQuery}"`);
    const videos = await searchPexelsVideos(fallbackQuery, 5);
    if (videos.length) {
      const file = pickBestVideoFile(videos[0]);
      if (file?.link) {
        await downloadClip(file.link, outputPath);
        return { path: outputPath, duration: getClipDuration() };
      }
    }
  } catch (err) {
    logger.error(`Fallback también falló: ${err.message}`);
  }

  throw new Error(`No se pudo obtener clip para escena ${sceneIndex + 1}`);
}

/**
 * Función principal — descarga clips para todas las escenas
 * @param {Array} scenes - Array de escenas del guión (con campo videoKeywords)
 * @param {string} outputDir - Directorio donde guardar los clips descargados
 * @returns {Promise<Array<{path, duration}>>} Lista de clips con sus duraciones
 */
export async function fetchSceneVideos(scenes, outputDir) {
  logger.step(`Descargando ${scenes.length} clips de B-roll desde Pexels...`);
  fs.mkdirSync(outputDir, { recursive: true });

  const clips    = [];
  let exitosos   = 0;
  let fallidos   = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene    = scenes[i];
    const filename = `raw_clip_${String(i + 1).padStart(3, '0')}.mp4`;
    const outPath  = path.join(outputDir, filename);

    // Usar videoKeywords si existe, si no caer en imagePrompt convertido, si no keyword genérica
    const keywords = scene.videoKeywords
      || scene.imagePrompt?.split(',').slice(0, 2).join(' ')
      || BROLL_FALLBACK_KEYWORDS[i % BROLL_FALLBACK_KEYWORDS.length];

    try {
      const clip = await fetchClipForScene(keywords, outPath, i);
      clips.push(clip);
      exitosos++;
    } catch (error) {
      logger.error(`Escena ${i + 1} sin clip: ${error.message}`);
      fallidos++;
      // Empujar null — videoEditor lo saltea
      clips.push(null);
    }

    if (i < scenes.length - 1) {
      await sleep(DELAY_BETWEEN_CLIPS);
    }
  }

  logger.ok(`B-roll listo: ${exitosos} clips, ${fallidos} fallidos`);
  return clips;
}
