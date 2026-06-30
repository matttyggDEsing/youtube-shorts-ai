// ════════════════════════════════════════
// LIVE BACKGROUND GENERATOR
// Selecciona o genera el video de fondo para el directo.
// Soporta: archivos locales (assets/backgrounds/) y descarga desde Pexels.
// ════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);
const __dirname     = path.dirname(fileURLToPath(import.meta.url));

// Directorio donde el usuario guarda fondos descargados manualmente
const BACKGROUNDS_DIR = process.env.LIVE_BACKGROUNDS_DIR
  || path.join(process.cwd(), 'assets', 'backgrounds');

// Fondos de Pexels (libres de derechos) por categoría
// Estos son IDs de videos de Pexels que funcionan para cada nicho.
// El usuario puede reemplazarlos con sus propios archivos locales.
const PEXELS_VIDEOS = {
  terror_misterio: [
    'https://www.pexels.com/download/video/857251/',   // niebla oscura
    'https://www.pexels.com/download/video/3571264/',  // lluvia nocturna
  ],
  musica_estudiar: [
    'https://www.pexels.com/download/video/4065907/',  // cafe con lluvia
    'https://www.pexels.com/download/video/3571264/',  // ventana lluvia
  ],
  motivacion: [
    'https://www.pexels.com/download/video/3571264/',  // amanecer montaña
    'https://www.pexels.com/download/video/2499611/',  // ciudad timelapse
  ],
  musica_dormir: [
    'https://www.pexels.com/download/video/1448735/',  // estrellas
    'https://www.pexels.com/download/video/854967/',   // olas de mar
  ],
  lofi: [
    'https://www.pexels.com/download/video/4065907/',  // ventana lluvia ciudad
    'https://www.pexels.com/download/video/3571264/',  // cafe nocturno
  ],
};

// Fondos fallback generados con FFmpeg (sin archivo externo)
const FALLBACK_COLORS = {
  terror_misterio: '#0a0a0f',
  musica_estudiar: '#0d1b2a',
  motivacion:      '#111827',
  musica_dormir:   '#050a14',
  lofi:            '#1a1525',
};

/**
 * Obtiene el path al video de fondo para el directo.
 * Prioridad: 1) carpeta local assets/backgrounds/  2) descarga Pexels  3) fallback FFmpeg sólido
 *
 * @param {string} category     - Categoría del directo
 * @param {number} durationSecs - Duración deseada en segundos (para el fallback)
 * @param {string} tempDir      - Directorio temporal donde poner el fallback si se genera
 * @returns {Promise<string>}   - Path al archivo de video de fondo
 */
export async function selectBackground(category, durationSecs = 28800, tempDir = './temp') {
  // 1. Buscar archivo local en assets/backgrounds/<category>/
  const localFile = findLocalBackground(category);
  if (localFile) {
    logger.ok(`Background: usando archivo local → ${localFile}`);
    return localFile;
  }

  // 2. Intentar descargar desde Pexels
  const pexelsFile = await downloadPexelsBackground(category, tempDir);
  if (pexelsFile) {
    logger.ok(`Background: descargado de Pexels → ${pexelsFile}`);
    return pexelsFile;
  }

  // 3. Fallback: generar video sólido con FFmpeg
  logger.warn(`Background: sin archivo disponible, generando fallback con FFmpeg`);
  return generateFallbackBackground(category, durationSecs, tempDir);
}

// ── 1. Local ─────────────────────────────────────────────────────────────────

function findLocalBackground(category) {
  const dirs = [
    path.join(BACKGROUNDS_DIR, category),
    path.join(BACKGROUNDS_DIR, 'generic'),
    BACKGROUNDS_DIR,
  ];

  const exts = ['.mp4', '.mov', '.mkv', '.webm'];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir)
      .filter(f => exts.includes(path.extname(f).toLowerCase()))
      .map(f => path.join(dir, f));

    if (files.length > 0) {
      // Rotar de manera pseudo-aleatoria por fecha
      const idx = Math.floor(Date.now() / 86400000) % files.length;
      return files[idx];
    }
  }

  return null;
}

// ── 2. Pexels ─────────────────────────────────────────────────────────────────

async function downloadPexelsBackground(category, tempDir) {
  const urls = PEXELS_VIDEOS[category] ?? PEXELS_VIDEOS['musica_estudiar'];
  if (!urls || urls.length === 0) return null;

  // Caché: si ya descargamos antes, reusar
  const cacheDir  = path.join(BACKGROUNDS_DIR, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  const idx      = Math.floor(Date.now() / 86400000) % urls.length;
  const url      = urls[idx];
  const filename = `bg_${category}_${idx}.mp4`;
  const cachePath = path.join(cacheDir, filename);

  if (fs.existsSync(cachePath)) {
    logger.info(`Background: usando caché Pexels → ${cachePath}`);
    return cachePath;
  }

  try {
    await downloadFile(url, cachePath);
    return cachePath;
  } catch (err) {
    logger.warn(`Background: no se pudo descargar de Pexels (${err.message})`);
    // Limpiar archivo parcial
    try { fs.unlinkSync(cachePath); } catch { /* ignorar */ }
    return null;
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file   = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });

    req.on('error', (err) => { fs.unlinkSync(dest); reject(err); });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── 3. Fallback FFmpeg ────────────────────────────────────────────────────────

async function generateFallbackBackground(category, durationSecs, tempDir) {
  fs.mkdirSync(tempDir, { recursive: true });

  const color    = FALLBACK_COLORS[category] ?? '#0a0a12';
  const outPath  = path.join(tempDir, `bg_fallback_${category}.mp4`);

  // Color sólido + partículas sutiles con lavfi
  const ffmpegArgs = [
    '-f', 'lavfi',
    '-i', `color=${color}:size=1920x1080:rate=30`,
    '-f', 'lavfi',
    '-i', 'nullsrc=size=1920x1080:rate=30,geq=\'r=0:g=0:b=0:a=if(lt(random(1)*100,0.3),255,0)\'',
    '-filter_complex', '[0:v][1:v]blend=all_mode=screen',
    '-t', String(durationSecs),
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '35',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-y',
    outPath,
  ];

  try {
    const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
    await execFileAsync(ffmpegBin, ffmpegArgs, { timeout: 120_000 });
    logger.ok(`Background fallback generado: ${outPath}`);
    return outPath;
  } catch (err) {
    // Ultra-fallback: color puro sin lavfi complejo
    logger.warn(`Background: fallback complejo falló, intentando color puro`);
    const simpleArgs = [
      '-f', 'lavfi',
      '-i', `color=${color}:size=1920x1080:rate=30`,
      '-t', String(durationSecs),
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '35',
      '-pix_fmt', 'yuv420p',
      '-an',
      '-y',
      outPath,
    ];
    const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
    await execFileAsync(ffmpegBin, simpleArgs, { timeout: 120_000 });
    return outPath;
  }
}
