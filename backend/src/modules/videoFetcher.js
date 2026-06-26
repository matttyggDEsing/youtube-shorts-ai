// ════════════════════════════════════════
// VIDEO FETCHER — Descarga de B-roll desde Pexels API
// v2: retry inteligente con simplificación progresiva de keywords
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
const CLIP_DURATION_MIN = 1.2;
const CLIP_DURATION_MAX = 2.0;

// Keywords de último recurso por categoría — se usan solo si todos los intentos fallan
// Son visuales que Pexels siempre tiene disponibles para cada tipo de historia
const CATEGORY_FALLBACKS = {
  terror:           ['dark hallway', 'shadow wall', 'candle flame', 'fog forest night', 'door old'],
  misterio:         ['fog street', 'old letter paper', 'clock vintage', 'empty room', 'window rain'],
  motivacion:       ['sunrise horizon', 'person running', 'hands fist', 'road ahead', 'mountain top'],
  romance:          ['hands holding', 'coffee morning', 'flowers close up', 'rain window', 'smile close up'],
  ciencia_ficcion:  ['city lights night', 'technology screen', 'space stars', 'neon lights', 'server room'],
  historias_reales: ['person walking street', 'hands writing', 'phone screen', 'city crowd', 'car driving'],
  leyendas:         ['forest fog', 'old building', 'fire burning', 'night sky stars', 'river dark'],
  suspenso:         ['eye close up', 'footsteps floor', 'car headlights', 'phone ringing', 'shadow figure'],
};

// Fallback genérico si no tenemos categoría
const GENERIC_FALLBACKS = [
  'cinematic nature',
  'city night lights',
  'person silhouette',
  'dark atmosphere',
  'dramatic clouds',
];

/**
 * Buscar videos en Pexels por keyword
 */
async function searchPexelsVideos(query, perPage = 8) {
  const apiKey = PEXELS_API_KEY || process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY no configurada en .env');

  const response = await axios.get(`${PEXELS_BASE}/search`, {
    headers: { Authorization: apiKey },
    params: {
      query,
      per_page: perPage,
      orientation: 'portrait',
      size: 'medium',
    },
    timeout: 15000,
  });

  return response.data.videos || [];
}

/**
 * Elegir el mejor archivo de video de entre los disponibles
 * Preferencia: HD portrait → SD portrait → HD landscape → cualquier cosa
 */
function pickBestVideoFile(video) {
  const files = video.video_files || [];
  return (
    files.find(f => f.quality === 'hd' && f.width < f.height) ||
    files.find(f => f.width < f.height) ||
    files.find(f => f.quality === 'hd') ||
    files[0] || null
  );
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
 * Intentar buscar y descargar con un keyword específico.
 * Devuelve el clip si tuvo éxito, null si no encontró nada.
 */
async function tryQuery(query, outputPath, sceneIndex) {
  try {
    logger.info(`  → buscando: "${query}"`);
    const videos = await searchPexelsVideos(query, 8);

    if (!videos.length) {
      logger.warn(`    sin resultados para "${query}"`);
      return null;
    }

    const randomIndex = Math.floor(Math.random() * Math.min(videos.length, 5));
    const video = videos[randomIndex];
    const file  = pickBestVideoFile(video);

    if (!file?.link) {
      logger.warn(`    video sin archivo descargable`);
      return null;
    }

    await downloadClip(file.link, outputPath);
    logger.ok(`    ✓ clip descargado (${file.width}x${file.height} ${file.quality})`);
    return { path: outputPath, duration: getClipDuration() };

  } catch (error) {
    logger.warn(`    error: ${error.message}`);
    return null;
  }
}

/**
 * Simplificar un keyword quitando palabras de a una desde el final.
 * "abandoned house dark interior" → "abandoned house dark" → "abandoned house" → "abandoned"
 *
 * Devuelve array de versiones simplificadas (sin el original).
 */
function simplifyKeyword(keyword) {
  const words  = keyword.trim().split(/\s+/);
  const simpler = [];
  for (let i = words.length - 1; i >= 1; i--) {
    simpler.push(words.slice(0, i).join(' '));
  }
  return simpler;
}

/**
 * Buscar y descargar un clip para una escena.
 *
 * Estrategia de retry (de más a menos específico):
 *   1. keyword[0] — específico (objeto/lugar de la escena)
 *   2. keyword[1] — acción + emoción
 *   3. keyword[2] — visual atmosférico
 *   4. Versiones simplificadas de keyword[0] (quitando palabras)
 *   5. Versiones simplificadas de keyword[1]
 *   6. Fallbacks de la categoría (siempre disponibles en Pexels)
 */
async function fetchClipForScene(keywords, outputPath, sceneIndex, category) {
  const kw = Array.isArray(keywords) ? keywords : [keywords];

  logger.step(`Escena ${sceneIndex + 1} — buscando B-roll:`);

  // ── Fase 1: intentar cada keyword tal cual ────────────────
  for (const query of kw) {
    if (!query) continue;
    const result = await tryQuery(query, outputPath, sceneIndex);
    if (result) return result;
    await sleep(500);
  }

  // ── Fase 2: simplificar keyword[0] progresivamente ────────
  if (kw[0]) {
    logger.info(`  simplificando keyword[0]: "${kw[0]}"...`);
    for (const simplified of simplifyKeyword(kw[0])) {
      const result = await tryQuery(simplified, outputPath, sceneIndex);
      if (result) return result;
      await sleep(400);
    }
  }

  // ── Fase 3: simplificar keyword[1] progresivamente ────────
  if (kw[1]) {
    logger.info(`  simplificando keyword[1]: "${kw[1]}"...`);
    for (const simplified of simplifyKeyword(kw[1])) {
      const result = await tryQuery(simplified, outputPath, sceneIndex);
      if (result) return result;
      await sleep(400);
    }
  }

  // ── Fase 4: fallbacks de la categoría ────────────────────
  const categoryFallbacks = CATEGORY_FALLBACKS[category] || GENERIC_FALLBACKS;
  logger.warn(`  usando fallback de categoría "${category}"...`);

  // Rotar los fallbacks según el índice de la escena para variedad
  const startIdx = sceneIndex % categoryFallbacks.length;
  const orderedFallbacks = [
    ...categoryFallbacks.slice(startIdx),
    ...categoryFallbacks.slice(0, startIdx),
  ];

  for (const fallback of orderedFallbacks) {
    const result = await tryQuery(fallback, outputPath, sceneIndex);
    if (result) return result;
    await sleep(400);
  }

  throw new Error(`No se pudo obtener clip para escena ${sceneIndex + 1} tras todos los intentos`);
}

/**
 * Función principal — descarga clips para todas las escenas
 * @param {Array}  scenes    - Array de escenas del guión (con campo videoKeywords)
 * @param {string} outputDir - Directorio donde guardar los clips
 * @param {string} category  - Categoría de la historia (para fallbacks temáticos)
 */
export async function fetchSceneVideos(scenes, outputDir, category = 'terror') {
  logger.step(`Descargando ${scenes.length} clips de B-roll desde Pexels...`);
  fs.mkdirSync(outputDir, { recursive: true });

  const clips  = [];
  let exitosos = 0;
  let fallidos = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene    = scenes[i];
    const filename = `raw_clip_${String(i + 1).padStart(3, '0')}.mp4`;
    const outPath  = path.join(outputDir, filename);

    const keywords = scene.videoKeywords
      || scene.imagePrompt?.split(',').slice(0, 2).join(' ')
      || CATEGORY_FALLBACKS[category]?.[i % (CATEGORY_FALLBACKS[category]?.length || 1)]
      || GENERIC_FALLBACKS[i % GENERIC_FALLBACKS.length];

    try {
      const clip = await fetchClipForScene(keywords, outPath, i, category);
      clips.push(clip);
      exitosos++;
    } catch (error) {
      logger.error(`Escena ${i + 1} sin clip: ${error.message}`);
      fallidos++;
      clips.push(null);
    }

    if (i < scenes.length - 1) {
      await sleep(DELAY_BETWEEN_CLIPS);
    }
  }

  logger.ok(`B-roll listo: ${exitosos} clips, ${fallidos} fallidos`);
  return clips;
}
