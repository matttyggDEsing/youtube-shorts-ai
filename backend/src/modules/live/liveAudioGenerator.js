// ════════════════════════════════════════
// LIVE AUDIO GENERATOR
// Selecciona el audio de fondo para el directo.
// Prioridad: assets/audio/<category>/ → carpeta genérica → silencio FFmpeg
// El audio se combina con narración TTS en liveStreamManager.
// ════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

const AUDIO_DIR = process.env.LIVE_AUDIO_DIR
  || path.join(process.cwd(), 'assets', 'audio');

// Volúmenes de mezcla por categoría (el audio de fondo baja para no tapar narración)
export const AUDIO_MIX_VOLUME = {
  terror_misterio: 0.25,  // oscuro, que no tape las historias
  musica_estudiar: 0.80,  // es el producto principal
  motivacion:      0.35,  // acompaña las frases
  musica_dormir:   0.85,  // es el producto principal
  lofi:            0.90,  // es el producto principal
};

// Géneros/subtipos de audio recomendados por categoría
const AUDIO_HINTS = {
  terror_misterio: ['dark_ambient', 'horror', 'tension', 'piano_oscuro'],
  musica_estudiar: ['lofi', 'piano', 'ambient', 'jazz'],
  motivacion:      ['epic', 'motivational', 'cinematic', 'piano'],
  musica_dormir:   ['sleep', 'rain', 'ocean', 'white_noise', 'piano'],
  lofi:            ['lofi', 'chill', 'beats'],
};

/**
 * Selecciona o genera el archivo de audio de fondo para el directo.
 *
 * @param {string} category     - Categoría del directo
 * @param {number} durationSecs - Duración del directo en segundos
 * @param {string} tempDir      - Directorio temporal para audio generado
 * @returns {Promise<{ audioPath: string, volume: number }>}
 */
export async function selectAudio(category, durationSecs = 28800, tempDir = './temp') {
  const volume = AUDIO_MIX_VOLUME[category] ?? 0.5;

  const localFile = findLocalAudio(category);
  if (localFile) {
    logger.ok(`Audio: archivo local → ${localFile}`);
    return { audioPath: localFile, volume };
  }

  logger.warn(`Audio: no hay archivo para "${category}", usando silencio lavfi en FFmpeg.`);
  logger.warn(`→ Colocá archivos MP3 en: assets/audio/${category}/`);

  // Devolver null — liveStreamManager usará anullsrc directo
  return { audioPath: null, volume: 1.0 };
}

// ── Local ─────────────────────────────────────────────────────────────────────

function findLocalAudio(category) {
  const hints = AUDIO_HINTS[category] ?? [];
  const exts  = ['.mp3', '.wav', '.ogg', '.flac', '.m4a'];

  // Buscar en orden: carpeta de categoría, subcarpetas de hints, genérica
  const searchDirs = [
    path.join(AUDIO_DIR, category),
    ...hints.map(h => path.join(AUDIO_DIR, h)),
    path.join(AUDIO_DIR, 'generic'),
    AUDIO_DIR,
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir)
      .filter(f => exts.includes(path.extname(f).toLowerCase()))
      .map(f => path.join(dir, f));

    if (files.length > 0) {
      // Rotar de manera pseudo-aleatoria por día
      const idx = Math.floor(Date.now() / 86400000) % files.length;
      return files[idx];
    }
  }

  return null;
}

/**
 * Lista todos los archivos de audio disponibles para una categoría.
 * Útil para diagnóstico desde la API.
 */
export function listAvailableAudio(category) {
  const exts = ['.mp3', '.wav', '.ogg', '.flac', '.m4a'];
  const dirs  = [
    path.join(AUDIO_DIR, category),
    path.join(AUDIO_DIR, 'generic'),
    AUDIO_DIR,
  ];

  const result = {};

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter(f => exts.includes(path.extname(f).toLowerCase()));
    if (files.length) result[dir] = files;
  }

  return result;
}

// ── Silencio FFmpeg ───────────────────────────────────────────────────────────

async function generateSilence(durationSecs, tempDir) {
  fs.mkdirSync(tempDir, { recursive: true });
  const outPath = path.join(tempDir, 'silence.mp3');

  if (fs.existsSync(outPath)) return outPath;

  const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
  const args = [
    '-f', 'lavfi',
    '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(durationSecs),
    '-c:a', 'libmp3lame',
    '-b:a', '128k',
    '-y',
    outPath,
  ];

  await execFileAsync(ffmpegBin, args, { timeout: 30_000 });
  return outPath;
}
